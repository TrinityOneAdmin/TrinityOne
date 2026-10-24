// TWO CONSOLES SIGNING THE CHURCH'S RELAY LIST AT THE SAME MOMENT LOSE NOTHING (audit finding M-5).
// Run: node --test scripts/two-consoles-signing-the-relay-list-lose-nothing.test.mjs
//
// THE MEASURED DEFECT. `trinityone/relay-net` is one replaceable document. A new Suite box's automatic pass and a
// steward's "Yes, connect" on a phone both read [T], each added its own box and signed; the newer signature replaced
// the older, so the list ended [T,X] or [T,T2] — one change gone — and BOTH consoles reported `published: true`,
// because that answer came from the relay accepting the write, not from the list holding the change. enrolSerial
// only queues within one page, so it cannot help across two consoles.
//
// HOW THIS IS DRIVEN. Real `gateway.mjs` relays (relay-network-harness), a real SimplePool, and enrolRelayNet /
// unenrolRelayNet / enrolSerial / relayNetDoc / _oneComplete / _readCovers lifted out of the SHIPPED
// vendor/steward.js and run. Only `publish` is a stub (it writes to the real relay), and it is the stub that
// stages the race: a barrier makes both consoles finish their READ before either writes, the console with the
// older stamp writes first, the newer one second, and the older one reads back only after that.
//
// THE POINT OF USE (CLAUDE.md rule 1): signRelay / unsignRelay are the shipped Steward calls the Relays card and
// the setup wizard make. Delete the read-back from enrolRelayNet and the first test goes red.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import { normalizeURL } from 'nostr-tools/utils';
import { fnBody, stmt } from './test-slice.mjs';
import * as H from './relay-network-harness.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const D = 'trinityone/relay-net';

const PIECES = [
  ['fn', 'function relayIdentityNonce'], ['fn', 'function relayHttpBase'], ['fn', 'function relayAddrKey'],
  ['fn', 'async function verifyRelayIdentityDetailed'], ['fn', 'async function verifyRelayIdentity(wssUrl) {'],
  ['st', 'var RELAY_NET_D = '], ['st', 'var _isHex64 = '],
  ['fn', 'function isSharedAddress'], ['fn', 'function sharedRelayKeys'], ['fn', 'function _relayKey'],
  ['fn', 'function parseRelayNet'], ['fn', 'function _ownOrigin'], ['fn', 'function relayNetCandidates'],
  ['fn', 'function _oneComplete(filters, ms = 6e3, privateDoc = false) {'],
  ['fn', 'function _readCovers'], ['fn', 'function relayNetDoc'],
  ['fn', 'async function enrolRelayNet'], ['fn', 'async function unenrolRelayNet'], ['fn', 'function normRelay(input) {'],
  ['st', 'var RELAYNET_SEEN = '], ['st', 'var _isLoopbackRelay = '], ['st', 'var _RELAY_NAME_RE = '],
  ['st', 'var _enrolQueue = '], ['fn', 'function enrolSerial'], ['st', 'var _autoEnrolled = '],
  ['fn', 'async function autoEnrolRelayNet'],
];
const LIFT = PIECES.map(([k, a]) => k === 'fn' ? fnBody(STEWARD, a, a) : stmt(STEWARD, a, a)).join('\n');

// d: { sk, pub, raw: () => [urls], publishTo: () => [urls], shared: [keys], clockSkew: seconds, gate: async (n) => {} }
// `gate(n)` is awaited INSIDE the publish stub, before the n-th write is sent (`before`) and after it landed
// (`after`), so a test can hold a console between "its write is stored" and "it reads back".
function makeConsole(d) {
  const pool = new SimplePool();
  const writes = [];
  const store = new Map();
  const st = {
    pool, normalizeURL, normalizeURL2: normalizeURL, verifyEvent, verifyEvent2: verifyEvent,
    finalizeEvent, finalizeEvent2: finalizeEvent, fetch: globalThis.fetch, AbortController, URL, JSON, Promise,
    setTimeout, clearTimeout, Math, Object, String, Number, Array, Set, Map, Error, encodeURIComponent, console,
    globalThis, Uint8Array, location: undefined, window: undefined,
    relaysRaw: () => d.raw(), _authAccepted: new Map(),
    CANONICAL_RELAY_PUBS: Object.freeze({ 'wss://test-shared.invalid/relay': d.shared || [] }),
    CANONICAL_RELAYS: ['wss://test-shared.invalid/relay'],
    get sk() { return d.sk; }, get pub() { return d.pub; },
    get actingChurch() { return ''; }, _viewingNetwork: () => false,
    get _boxHostsUs() { return null; },
    selfPublicRelay: () => '', selfRelayName: () => '',
    now: () => Math.floor(Date.now() / 1000) + (d.clockSkew || 0), _monotonic: (t) => t,
    lsGet: (k) => store.has(k) ? store.get(k) : null, lsSet: (k, v) => store.set(k, String(v)),
    publish: async (ev) => {
      const n = writes.length; writes.push(ev);
      if (d.gate) await d.gate('before', n, ev);
      const res = await Promise.allSettled(pool.publish(d.publishTo(), ev));
      const ok = res.some(r => r.status === 'fulfilled' && !String(r.value || '').startsWith('connection failure'));
      if (d.gate) await d.gate('after', n, ev);
      return ok ? ev : null;
    },
  };
  const scope = new Proxy(st, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; throw new ReferenceError('lift needs ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const api = new Function('scope', 'with (scope) {' + LIFT +
    '\nreturn { signRelay: (u) => { const x = normRelay(u); return x ? enrolSerial(() => enrolRelayNet({ extra: [x] })) : Promise.resolve(null); }, ' +
    'unsignRelay: (u) => enrolSerial(() => unenrolRelayNet(u)) }; }')(scope);
  api.writes = writes;
  api.close = () => { try { pool.destroy ? pool.destroy() : pool.close(d.raw()); } catch {} };
  return api;
}

// What is stored on the shared relay, read straight off the wire as the church.
async function stored(relay, church) {
  const p = new SimplePool();
  try {
    const evs = await p.querySync([relay.wsUrl], { kinds: [30078], authors: [church.pub], '#d': [D] }, { maxWait: 3000 });
    evs.sort((a, b) => b.created_at - a.created_at);
    return evs[0] ? { ev: evs[0], entries: JSON.parse(evs[0].content) } : null;
  } finally { try { p.close([relay.wsUrl]); } catch {} }
}
const keysOf = (doc) => ((doc && doc.entries) || []).map(e => e.pubkey).sort();

// Two consoles, one church, one shared relay. `low` has the older stamp, `high` the newer. Both finish their read
// of the starting list before either writes; low writes, then high writes; low reads back only after high's write
// is stored. That is the interleaving that loses low's change without the read-back.
function stageRace(church, S, lowClock, highClock) {
  let arrived = 0, release; const bothRead = new Promise(r => { release = r; });
  let lowStored, highStored; const lowWritten = new Promise(r => { lowStored = r; }); const highWritten = new Promise(r => { highStored = r; });
  const mk = (role, skew) => makeConsole({
    sk: church.sk, pub: church.pub, raw: () => [S.wsUrl], publishTo: () => [S.wsUrl], shared: [S.relayPub], clockSkew: skew,
    async gate(phase, n) {
      if (n > 0) return;                        // only the FIRST write is staged; repairs run free
      if (phase === 'before') {
        if (++arrived === 2) release();
        await bothRead;
        if (role === 'high') await lowWritten;  // low writes first
      } else if (role === 'low') { lowStored(); await highWritten; }   // low waits, THEN reads back
      else highStored();
    },
  });
  return { low: mk('low', lowClock), high: mk('high', highClock) };
}

// One church per test, all registered on every relay up front, so each test starts from a list it wrote itself and
// no test's stamps can sit in the way of another's.
let churches, S, T, T2, X, T3;
before(async () => {
  churches = [H.key(), H.key(), H.key(), H.key()];
  const reg = churches.map(c => c.pub);
  [S, T, T2, X, T3] = await Promise.all(['shared', 'box-t', 'box-t2', 'box-x', 'box-t3'].map(name => H.startRelay({ name, churches: reg })));
});
after(() => H.stopAll());

// The church has signed [boxes] twenty seconds ago, before anything a console in the test writes.
async function startList(church, boxes) {
  const at = Math.floor(Date.now() / 1000) - 20;
  await H.publishAll(S, [H.churchDoc(church, D, boxes.map(b => ({ pubkey: b.relayPub, alwaysOn: true, url: b.wsUrl })), at)]);
  return at;
}

test('two consoles connecting different boxes at once: the list holds BOTH, and the one whose change was replaced repairs it and only then says published', async () => {
  const church = churches[0];
  await startList(church, [T]);
  // DECIDES FIRST: the post-publish read-back loop in enrolRelayNet. Both writes are accepted by the relay, so
  // the publish result alone says success for both; only the read-back sees that one change was replaced.
  const { low, high } = stageRace(church, S, 1, 3);
  try {
    const [rl, rh] = await Promise.all([low.signRelay(T2.wsUrl), high.signRelay(X.wsUrl)]);
    assert.deepEqual(keysOf(await stored(S, church)), [T, T2, X].map(r => r.relayPub).sort(),
      'a change was lost and nobody re-signed it: the stored list is ' + JSON.stringify(keysOf(await stored(S, church))));
    assert.equal(rh.published, true, 'the console that wrote last did not report success');
    assert.equal(rl.published, true, 'the console whose write was replaced did not report success after repairing it');
    assert.equal(rl.repaired, 1, 'the replaced write should have been repaired exactly once');
    assert.equal(rh.repaired, 0);
    assert.equal(low.writes.length, 2, 'low should have signed twice: its write, then the repair');
    assert.equal(high.writes.length, 1);
    assert.ok(low.writes[1].created_at > high.writes[0].created_at, 'the repair must be newer than the document it merged onto');
    assert.ok((rl.entries || []).some(e => e.pubkey === X.relayPub) && (rl.entries || []).some(e => e.pubkey === T2.relayPub), 'the result must report the list that is stored');
  } finally { low.close(); high.close(); }
});

test('Remove has the same shape: a newer addition replaces the removal, and Remove repairs it instead of reporting removed', async () => {
  const church = churches[1];
  await startList(church, [T, X]);
  const { low, high } = stageRace(church, S, 1, 3);
  try {
    // DECIDES FIRST: the read-back loop in unenrolRelayNet.
    const [rr, ra] = await Promise.all([low.unsignRelay(X.wsUrl), high.signRelay(T3.wsUrl)]);
    assert.deepEqual(keysOf(await stored(S, church)), [T, T3].map(r => r.relayPub).sort(),
      'the removal was replaced by the concurrent addition and never repaired, or the addition was lost');
    assert.equal(rr.removed, true);
    assert.equal(rr.repaired, 1);
    assert.equal(ra.published, true);
  } finally { low.close(); high.close(); }
});

test('control: a read-back that is incomplete is unknown — it is not success, and it never re-signs over a list it could not see', async () => {
  const church = churches[2];
  const at = await startList(church, [T]);
  const DEAD = 'ws://127.0.0.1:1/relay';
  let raw = [S.wsUrl];
  const con = makeConsole({
    sk: church.sk, pub: church.pub, raw: () => raw, publishTo: () => [S.wsUrl], shared: [S.relayPub], clockSkew: 1,
    async gate(phase, n) {
      // After our write is stored: a newer document appears (the change is "missing"), and one asked relay stops
      // answering, so the read-back cannot be complete.
      if (phase === 'after' && n === 0) {
        await H.publishAll(S, [H.churchDoc(church, D, [{ pubkey: T.relayPub, alwaysOn: true, url: T.wsUrl }], Math.floor(Date.now() / 1000) + 5)]);
        raw = [S.wsUrl, DEAD];
      }
    },
  });
  try {
    const r = await con.signRelay(T2.wsUrl);
    assert.equal(r.published, false, 'an unverifiable write was reported as published');
    assert.equal(r.unknown, true);
    assert.equal(con.writes.length, 1, 'an incomplete read-back led to a second signature');
    assert.deepEqual(keysOf(await stored(S, church)), [T.relayPub], 'the console overwrote a newer list it could not fully read');
  } finally { con.close(); }
});

test('a change that is already in the list is signed once and read back once: the ordinary path is unchanged', async () => {
  const church = churches[3];
  await startList(church, [T]);
  const con = makeConsole({ sk: church.sk, pub: church.pub, raw: () => [S.wsUrl], publishTo: () => [S.wsUrl], shared: [S.relayPub],
    clockSkew: 1 });
  try {
    const r = await con.signRelay(T2.wsUrl);
    assert.equal(r.published, true);
    assert.equal(r.repaired, 0);
    assert.equal(con.writes.length, 1);
    assert.deepEqual(keysOf(await stored(S, church)), [T, T2].map(x => x.relayPub).sort());
  } finally { con.close(); }
});
