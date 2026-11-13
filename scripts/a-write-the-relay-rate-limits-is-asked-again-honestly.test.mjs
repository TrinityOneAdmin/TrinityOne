// A WRITE OR A READ THE RELAY RATE-LIMITS IS ASKED AGAIN — AND NOTHING IS CALLED "SAVED" THAT WAS NOT.
//   Run: node --test scripts/a-write-the-relay-rate-limits-is-asked-again-honestly.test.mjs
//
// The engine half of the rate-limit fix (audit of 651db3cb). The point-of-use half — the real Approve, a real Block
// and a real burst against the real relay — is in a-console-back-from-the-background-can-approve-at-once.test.mjs.
// Everything here runs the SHIPPED functions lifted out of vendor/steward.js (the bundle the console loads, not src/),
// and the real scripts/event-store.mjs.
//
//   M1  an older write that stopped asking because a newer one exists is "saved" only if that newer copy LANDED
//   M2  a newer write that starts DURING the wait still ends the older one's asking
//   N1  publish() and _publishToRelays() report that case the same way
//   L1  "rate-limited: document limit reached" is a cap, not a moment: not retried, and still a refusal
//   N2  the waits carry jitter
//   L2  the pacer: a stalled socket does not release a second batch on top of the first; a subscription the relay
//       CLOSED as rate-limited is asked again (and only that one)
//   L5  a re-sent event is stored once, whatever its kind, and an older copy never displaces a newer one
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { fnBody } from './test-slice.mjs';
import { openStore } from './event-store.mjs';

const SHIP = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const A = 'wss://a.example/relay';
const RL = 'rate-limited: too many messages — try again in a moment';
const CAP = 'rate-limited: document limit reached — please contact a steward';
const ev = (id, at, d = 'trinityone/admitted:c') => ({ kind: 30078, created_at: at, pubkey: 'p1', tags: [['d', d]], id, content: '' });

// ── the two write paths, lifted; `script(id, n)` answers the n-th ask (0-based) for event `id` ─────────────────
function lift(script) {
  const events = [], asks = new Map(), waits = [];
  const pool = {
    publish: (targets, e) => targets.map(() => {
      const n = asks.get(e.id) || 0; asks.set(e.id, n + 1);
      const a = script(e.id, n);
      return a === 'ok' ? Promise.resolve('') : Promise.reject(new Error(a));
    }),
    relays: new Map(),
  };
  // the retry's waits are recorded and shortened, so a row runs in milliseconds
  const fastTimeout = (f, ms) => { waits.push(ms); return setTimeout(f, ms >= 1000 ? 5 : ms); };
  const scope = {
    pool, relays: () => [A], relaysRaw: () => [A], _connectedRelays: () => [A], NO_NETWORK_RELAY: 'no-network-relay',
    _waitForRegistration: async () => {}, _lastOk: new Map(), _noteSpread() {}, _pubLatest: new Map(),
    window: { dispatchEvent: (e) => { events.push(e); } },
    CustomEvent: function (t, d) { this.type = t; this.detail = (d || {}).detail; },
    console: { warn() {}, log() {} }, Promise, Error, Map, Set, String, Array, Date, Math,
    setTimeout: fastTimeout, clearTimeout,
  };
  const names = Object.keys(scope);
  const src = fnBody(SHIP, 'async function publish(evt, opts)', 'publish') + '\n'
    + fnBody(SHIP, 'async function _publishToRelays(evt, urls)', '_publishToRelays')
    + '\nreturn { publish, _publishToRelays };';
  const fns = new Function(...names, src)(...names.map(k => scope[k]));
  return { fns, events, asks, waits, scope };
}
const PATHS = [
  ['publish', (L, e, o) => L.fns.publish(e, o)],
  ['_publishToRelays', (L, e) => L.fns._publishToRelays(e, [A])],
];
const errorsFor = (L, id) => L.events.filter(e => e.type === 'steward-publish-error' && e.detail && e.detail.evt && e.detail.evt.id === id);

for (const [name, go] of PATHS) {
  test(`${name}: a write refused "rate-limited" is asked again, and lands`, async () => {
    const L = lift((id, n) => (n === 0 ? RL : 'ok'));
    const r = await go(L, ev('o', 10));
    assert.ok(r && r.id === 'o', `${name} returned ${JSON.stringify(r)} for a write the relay accepted on the second ask`);
    assert.equal(L.asks.get('o'), 2);
  });

  test(`${name} (M1): an older write superseded by a newer one that FAILED is NOT reported saved`, async () => {
    const L = lift((id) => (id === 'o' ? RL : 'blocked: not a member or not permitted for this group'));
    const older = go(L, ev('o', 10));
    const newer = go(L, ev('n', 11));            // the steward pressed again — and this one is refused for good
    const [ro, rn] = await Promise.all([older, newer]);
    assert.equal(rn, false, 'CONTROL: the newer write was not refused — this row proves nothing');
    assert.ok(!ro, `${name} REPORTED THE OLDER WRITE SAVED (${JSON.stringify(ro && ro.id)}) — it was never accepted, and the newer copy that `
      + 'superseded it was refused: the steward is told an approval landed that is on no relay');
  });

  test(`${name} (M1/N1): an older write superseded by a newer one that LANDED is saved, quietly`, async () => {
    const L = lift((id) => (id === 'o' ? RL : 'ok'));
    const older = go(L, ev('o', 10));
    const newer = go(L, ev('n', 11));
    const [ro, rn] = await Promise.all([older, newer]);
    assert.ok(rn && rn.id === 'n', 'CONTROL: the newer write did not land');
    assert.ok(ro && ro.id === 'o', `${name} reported the older write NOT saved although the newer copy carrying the steward's latest change landed`);
    assert.deepEqual(errorsFor(L, 'o'), [], `${name} raised a "couldn't save" banner for a change the newer copy saved`);
  });

  test(`${name} (M2): a newer write that starts DURING the wait ends the older one's asking`, async () => {
    // the older copy would be ACCEPTED if it were sent again — so re-sending it is what this row catches
    let release;
    const gate = new Promise(r => { release = r; });
    const L = lift((id, n) => (id === 'o' ? (n === 0 ? RL : 'ok') : 'blocked: not permitted'));
    let started = null;
    // the first retry wait is when the newer call starts (the lifted code records each wait through L.waits)
    const origPush = L.waits.push.bind(L.waits);
    L.waits.push = (ms) => { if (ms >= 1000 && !started) { started = go(L, ev('n', 11)); release(); } return origPush(ms); };
    const ro = await go(L, ev('o', 10));
    await gate; const rn = await started;
    assert.equal(rn, false, 'CONTROL: the newer write was not refused');
    assert.equal(L.asks.get('o'), 1, `${name} RE-SENT THE OLDER COPY after a newer write began during its wait (asked ${L.asks.get('o')} times) — the superseded check runs only before the wait`);
    assert.ok(!ro, `${name} reported the superseded older write saved although the newer one failed`);
  });

  test(`${name} (L1): "rate-limited: document limit reached" is final — not asked again`, async () => {
    const L = lift(() => CAP);
    const o = {};
    const r = await go(L, ev('o', 10), o);
    assert.equal(r, false);
    assert.equal(L.asks.get('o'), 1, `${name} asked ${L.asks.get('o')} times for a write the relay's document CAP refused — the cap does not lift in a moment`);
    if (name === 'publish') assert.equal(o.refused, true, 'the document cap is a rule that will refuse the same write again, so it must count as a refusal');
  });
}

test('publish (N-b): a write of ANOTHER KIND under the same d-tag does not supersede it', async () => {
  // keyed kind + signer + d-tag: a different kind is a different document, so its failure is not this one's outcome
  const L = lift((id, n) => (id === 'o' ? (n === 0 ? RL : 'ok') : 'blocked: not permitted'));
  const older = L.fns.publish(ev('o', 10));
  const other = L.fns.publish({ ...ev('k', 11), kind: 30079 });
  const [ro, rk] = await Promise.all([older, other]);
  assert.equal(rk, false, 'CONTROL: the other-kind write was not refused');
  assert.ok(ro && ro.id === 'o', 'a write was abandoned because a write of ANOTHER KIND with the same d-tag failed — it was never asked again');
});

test('publish: the per-second limiter is retried at most three more times, and is not remembered as a refusal', async () => {
  const L = lift(() => RL);
  const o = {};
  const r = await L.fns.publish(ev('o', 10), o);
  assert.equal(r, false);
  assert.equal(L.asks.get('o'), 4, 'not bounded at 1 + 3 asks');
  assert.equal(o.refused, false, '"too many messages" was remembered as a rule — the media-key memo would then never ask again this session');
});

test('N2: the waits between asks carry jitter, so writes refused together do not come back together', async () => {
  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    const L = lift((id, n) => (n === 0 ? RL : 'ok'));
    await L.fns.publish(ev('o' + i, 10));
    seen.add(L.waits.find(ms => ms >= 1000));
  }
  assert.ok([...seen].every(ms => ms >= 1100 && ms < 1500), 'a first wait outside 1.1–1.5 s: ' + [...seen]);
  assert.ok(seen.size > 1, 'six writes all waited exactly ' + [...seen] + ' ms — no jitter');
});

// ── the pacer, lifted, on a fake socket and a fake clock ─────────────────────────────────────────────────────────
function liftPacer({ momentary = false } = {}) {
  let now = 0;
  const timers = [];
  let seq = 0;
  const clock = {
    setTimeout: (f, ms) => { const t = { at: now + Math.max(0, ms || 0), f, id: ++seq }; timers.push(t); return t.id; },
    clearTimeout: (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    Date: { now: () => now },
  };
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      if (!timers.length || timers[0].at > end) break;
      const t = timers.shift(); now = t.at; t.f();
    }
    now = end;
  };
  const decl = ['_PACE_MAX', '_PACE_SPAN', '_PACE_STALL_MS'].map(k => { const m = new RegExp('var ' + k + ' = (\\d+);').exec(SHIP); assert.ok(m, 're-anchor: ' + k + ' not found in the bundle'); return `var ${k} = ${m[1]};`; }).join('\n');
  const src = decl + '\n' + fnBody(SHIP, 'function _paceSocket(r)', '_paceSocket') + '\nreturn _paceSocket;';
  const paceSocket = new Function('setTimeout', 'clearTimeout', 'Date', 'Math', 'Promise', src)(clock.setTimeout, clock.clearTimeout, clock.Date, Math, Promise);
  const out = [], toLib = [];
  const r = {
    ws: { bufferedAmount: 0, readyState: 1, onmessage(ev) { toLib.push(ev.data); } },
    openSubs: new Map(),
    send(m) {
      if (r.ws.readyState > 1) return Promise.reject(new Error('SendingOnClosedConnection: ' + m.slice(0, 20)));
      out.push({ m, at: now, stalled: r.ws.bufferedAmount > 0 });
      // a real socket holds the bytes for a moment after every send, then hands them on
      if (momentary) { r.ws.bufferedAmount += m.length; clock.setTimeout(() => { r.ws.bufferedAmount = 0; }, 5); }
      return Promise.resolve();
    },
  };
  paceSocket(r);
  return { r, out, toLib, advance, now: () => now };
}
const req = (id) => `["REQ","${id}",{"kinds":[30078]}]`;

test('L2: a stalled socket does not release a second batch on top of the first — the relay never sees more than 100 in a second', () => {
  const P = liftPacer();
  for (let i = 0; i < 240; i++) P.r.send(req('s' + i));
  assert.equal(P.out.length, 80, 'CONTROL: the first 80 did not go straight out');
  P.r.ws.bufferedAmount = 4096;                 // the radio stalls with the first batch still in the socket
  P.advance(2000);
  const drainAt = P.now();
  P.r.ws.bufferedAmount = 0;                    // …and everything held in the socket leaves at once
  P.advance(10000);
  assert.equal(P.out.length, 240, 'CONTROL: not every frame was sent in the end');
  // when each frame reaches the relay: anything handed over before the drain arrives AT the drain
  const arrive = P.out.map(o => (o.at <= drainAt ? drainAt : o.at)).sort((a, b) => a - b);
  let most = 0;
  for (let i = 0, j = 0; i < arrive.length; i++) { while (arrive[i] - arrive[j] >= 1000) j++; most = Math.max(most, i - j + 1); }
  assert.ok(most <= 100, `${most} frames reached the relay inside one second after a stall — the relay refuses everything past 100`);
});

test('L2: a moment\'s buffering after an ordinary send is not a stall — frames under the limit are not held back', () => {
  // The stall check's own regression (caught by the browser rows, not by this file, before this row existed): a socket
  // always holds the bytes of the frame just sent for a moment, and taking that for a stall held EVERY frame for a
  // whole window — the console's key reads then waited past nostr-tools' 4.4 s timer and no key was ever ready.
  const P = liftPacer({ momentary: true });
  for (let i = 0; i < 30; i++) P.r.send(req('m' + i));
  P.advance(100);
  assert.equal(P.out.length, 30, `only ${P.out.length} of 30 frames left within 100 ms — ordinary traffic is being held as if the socket had stalled`);
  P.advance(100);
  for (let i = 0; i < 30; i++) P.r.send(req('n' + i));
  P.advance(100);
  assert.equal(P.out.length, 60, `a second ordinary batch was held back: ${P.out.length} of 60 sent`);
});

test('a socket that closes with a burst still queued sends nothing more and raises nothing — the queue is dropped quietly', async () => {
  // Measured in the browser rows: queued REQs released onto a closed socket raised nostr-tools' SendingOnClosedConnection
  // as unhandled rejections ("the console threw"). Those subscriptions died with the socket and are re-opened on the next.
  const P = liftPacer();
  const ps = [];
  for (let i = 0; i < 120; i++) ps.push(P.r.send(req('c' + i)));
  P.r.ws.readyState = 3;
  P.advance(5000);
  assert.equal(P.out.length, 80, `${P.out.length - 80} queued frames were sent after the socket closed`);
  const settled = await Promise.allSettled(ps);
  assert.deepEqual(settled.filter(x => x.status === 'rejected').length, 0, 'a queued frame on a closed socket rejected — nobody awaits send(), so that is an unhandled rejection in the page');
});

test('L2: a subscription the relay CLOSED as rate-limited is asked again — and a third refusal is delivered as before', () => {
  const P = liftPacer();
  P.r.openSubs.set('s1', {});
  P.r.send(req('s1'));
  const closed = `["CLOSED","s1","${'rate-limited: too many messages — ask again in a moment'}"]`;
  P.r.ws.onmessage({ data: closed });
  assert.deepEqual(P.toLib, [], 'the CLOSED reached the library — the subscription is dropped and never asked again');
  P.advance(1600);
  assert.equal(P.out.filter(o => o.m === req('s1')).length, 2, 'the REQ was not asked again after the relay CLOSED it as rate-limited');
  P.r.ws.onmessage({ data: closed }); P.advance(3000);
  P.r.ws.onmessage({ data: closed }); P.advance(5000);
  assert.equal(P.out.filter(o => o.m === req('s1')).length, 4, 'not asked again up to three times');
  P.r.ws.onmessage({ data: closed });
  assert.deepEqual(P.toLib, [closed], 'after three re-asks the refusal must reach the library as it always did');
});

test('L2: only the per-second limiter is re-asked — not the subscription cap, not a closed subscription, not after our own CLOSE', () => {
  const P = liftPacer();
  P.r.openSubs.set('cap', {}); P.r.openSubs.set('mine', {});
  P.r.send(req('cap')); P.r.send(req('mine')); P.r.send(req('gone'));
  const cap = '["CLOSED","cap","rate-limited: too many subscriptions"]';
  P.r.ws.onmessage({ data: cap });
  assert.deepEqual(P.toLib, [cap], 'the 256-subscription cap was held back — asking again cannot help with it');
  P.r.ws.onmessage({ data: '["CLOSED","mine","rate-limited: too many messages — ask again in a moment"]' });
  P.r.send('["CLOSE","mine"]');                  // the reader closed it meanwhile
  const gone = '["CLOSED","gone","rate-limited: too many messages — ask again in a moment"]';
  P.r.ws.onmessage({ data: gone });              // not an open subscription of the library's
  P.advance(6000);
  assert.equal(P.out.filter(o => o.m === req('mine')).length, 1, 'a subscription the reader had CLOSED was asked for again');
  assert.equal(P.out.filter(o => o.m === req('gone')).length, 1, 'a subscription the library no longer holds was asked for again');
  assert.ok(P.toLib.includes(gone), 'the CLOSED for a subscription nobody holds was swallowed');
});

test('the pacer keeps a CLOSE behind its own queued REQ, and never holds an AUTH', () => {
  const P = liftPacer();
  for (let i = 0; i < 81; i++) P.r.send(req('q' + i));
  P.r.send('["CLOSE","q80"]');
  P.r.send('["AUTH",{"id":"x"}]');
  P.advance(3000);
  const ms = P.out.map(o => o.m);
  assert.ok(ms.indexOf('["AUTH",{"id":"x"}]') === 80, 'the AUTH was held behind the burst');
  assert.ok(ms.indexOf(req('q80')) < ms.indexOf('["CLOSE","q80"]'), 'a CLOSE overtook its own REQ — the relay would hold a subscription nobody closes');
});

// ── L5: the real event store, the same signed event three times ───────────────────────────────────────────────────
test('L5: a re-sent event is stored once for every kind the console sends, and an older copy never displaces a newer one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-resend-store-'));
  try {
    const store = openStore(join(dir, 'relay.sqlite'));
    const sk = generateSecretKey();
    const t = Math.floor(Date.now() / 1000) - 60;
    for (const kind of [0, 10002, 30078, 1, 4, 7]) {
      const tags = kind === 30078 ? [['d', 'trinityone/resend-' + kind]] : [];
      const e = finalizeEvent({ kind, created_at: t, tags, content: 'k' + kind }, sk);
      const got = [store.put(e), store.put(e), store.put(e)];
      assert.deepEqual(got, ['stored', 'duplicate', 'duplicate'], `kind ${kind}: a re-sent event was not stored exactly once: ${got}`);
    }
    for (const kind of [0, 10002, 30078]) {
      const tags = kind === 30078 ? [['d', 'trinityone/order-' + kind]] : [];
      const older = finalizeEvent({ kind, created_at: t + 1, tags, content: 'old' }, sk);
      const newer = finalizeEvent({ kind, created_at: t + 2, tags, content: 'new' }, sk);
      assert.equal(store.put(newer), 'stored');
      assert.equal(store.put(older), 'have-newer', `kind ${kind}: an older copy arriving after a newer one was not refused`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
