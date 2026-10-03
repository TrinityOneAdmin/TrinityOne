// A RELAY THAT DROPS UNDER A PHONE MUST BE DIALLED AGAIN, EVEN WHEN ANOTHER RELAY IS STILL UP.
// Run: node --test scripts/a-relay-that-drops-is-dialled-again.test.mjs
//
// Sim 2026-10-02, item 18 ("phones stop getting church updates after a relay restart"), first of two gaps.
//
// nostr-tools does not reconnect a socket that closes: the pool forgets the relay and closes its subscriptions.
// It was dialled again only when something ELSE asked the pool for that address. With ONE relay the 90-second beat
// notices (relaysHealthy() goes false) and recovers. With TWO — the ordinary case — relaysHealthy() reads "one
// live socket is enough to work", the beat skips for ever, and the restarted relay is never spoken to again: every
// service, rota and request published after the restart stays invisible until the app restarts. Measured in a
// headless browser against two real gateways: nothing arrived in 108 seconds.
//
// The fix is a watcher on every socket the pool hands out (_watchRelayClose) and a bounded, jittered redial
// (_scheduleRedial / _redialNow). A redial that works goes through the same ensureRelay wrapper as every other dial,
// so `trinity-relay-returned` fires and the app's existing re-subscribe path runs; this adds no recovery logic of
// its own.
//
// HOW THIS TEST IS BUILT (CLAUDE.md rules 1 and 3): the shipped block is LIFTED out of vendor/fellowship.js — the
// ensureRelay wrapper, _relayUp/_relayFailed, the close marker, the watcher and the redial, as one piece — and RUN
// against a fake pool that behaves as nostr-tools' does (a relay that closes calls its own onclose, and the pool
// deletes it). Time is a queue the test advances. Nothing matches text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

function shippedBlock() {
  const anchor = BUNDLE.indexOf('const _ensure = pool.ensureRelay.bind(pool);');
  assert.notEqual(anchor, -1, 'the ensureRelay wrapper is gone from vendor/fellowship.js — rebuild: bash scripts/build-fellowship.sh');
  const start = BUNDLE.lastIndexOf('try {', anchor);
  const redial = fnBody(BUNDLE, 'async function _redialNow(url, key, st)', '_redialNow');
  const end = BUNDLE.indexOf(redial, start) + redial.length;
  assert.ok(end > start, 'could not slice the redial block — re-anchor this test');
  const src = BUNDLE.slice(start, end);
  assert.ok(src.includes('_watchRelayClose') && src.includes('_scheduleRedial'), 'the lifted block does not contain the redial — the bundle is stale');
  const normName = (src.match(/return (normalizeURL\d*)\(url\)/) || [])[1];
  assert.ok(normName, 'the block no longer keys relays by normalizeURL — re-anchor this test');
  return { src, norm: fnBody(BUNDLE, 'function ' + normName + '(url)', normName) };
}
const SHIPPED = shippedBlock();

// A pool that behaves the way nostr-tools' SimplePool does for the things this block touches.
function world({ admitted = () => true, random = 0 } = {}) {
  let now = 1_000_000;
  const queue = [];
  const fired = [];
  const dials = [];                         // every address the pool was asked to dial, with the time
  const up = new Map();                     // url -> is the relay reachable right now
  const norm = (u) => String(u).replace(/\/+$/, '');
  const pool = { relays: new Map(), listConnectionStatus: () => new Map() };
  const makeRelay = (url) => {
    const r = { url, connected: true, publishTimeout: 4400, closes: 0 };
    // what the library does: the pool installs onclose to forget the relay; close()/a drop both call it
    r.onclose = () => { pool.relays.delete(norm(url)); };
    r.close = function () { r.connected = false; r.onclose && r.onclose(); };
    return r;
  };
  pool.ensureRelay = async (url) => {
    dials.push({ url, at: now });
    const key = norm(url);
    if (!up.get(key)) throw new Error('connection failed');
    let r = pool.relays.get(key);
    if (!r || !r.connected) { r = makeRelay(url); pool.relays.set(key, r); }
    return r;
  };
  pool.close = (urls) => { for (const u of urls) { const r = pool.relays.get(norm(u)); if (r) r.close(); pool.relays.delete(norm(u)); } };
  const win = { dispatchEvent: (e) => { fired.push(e); return true; } };
  const CustomEvent = function (type, init) { this.type = type; this.detail = init && init.detail; };
  const doc = { visibilityState: 'visible' };
  const fakeMath = Object.create(Math); fakeMath.random = () => random;   // default: no jitter, so delays are exactly the schedule
  // like a real setTimeout: a delay that is not a number (or is negative) fires on the next tick, which is what turns
  // a missing give-up into a hot loop in production
  const setTimeoutQ = (fn, ms) => { const d = Number(ms); const id = queue.length + 1; queue.push({ id, at: now + (d >= 0 ? d : 0), fn, live: true }); return id; };
  new Function('pool', 'window', 'CustomEvent', '_netRelays', 'setTimeout', 'document', 'Math', 'Date',
    SHIPPED.norm + '\n' + SHIPPED.src)(pool, win, CustomEvent, (list) => list.filter(admitted), setTimeoutQ, doc, fakeMath, { now: () => now });
  return {
    pool, fired, dials, doc, up,
    returnedFor: (url) => fired.filter((e) => e.type === 'trinity-relay-returned' && e.detail && e.detail.url === url).length,
    reach: (url, yes = true) => up.set(norm(url), yes),
    async settle() { for (let i = 0; i < 6; i++) await Promise.resolve(); await new Promise((r) => setImmediate(r)); },
    async advance(ms) {
      const target = now + ms;
      for (let spins = 0; ; spins++) {
        if (spins > 500) throw new Error('the redial never settles — a timer re-arms itself with no delay (a hot loop)');
        const due = queue.filter((q) => q.live && q.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        due.live = false; now = due.at; due.fn(); await this.settle();
      }
      now = target; await this.settle();
    },
    at: () => now,
  };
}
const A = 'wss://a.example/relay', B = 'wss://b.example/relay';
const connect = async (w, url) => { w.reach(url); return w.pool.ensureRelay(url); };

test('THE BUG: with a second relay still up, a relay that restarts is dialled again and the app is told it returned', async () => {
  const w = world();
  const a = await connect(w, A); await connect(w, B);
  assert.equal(w.returnedFor(A), 0, 'CONTROL: a first connection is not a "return"');
  // the relay process restarts: the socket closes, the relay is down for a moment, then back
  w.reach(A, false); a.close();
  await w.advance(4000);
  assert.equal(w.dials.filter((d) => d.url === A).length, 1, 'CONTROL: nothing dials before the first wait is over');
  w.reach(A, true);
  await w.advance(2000);
  assert.ok(w.dials.filter((d) => d.url === A).length >= 2, 'NOBODY DIALLED THE RESTARTED RELAY AGAIN: the phone keeps its other socket, relaysHealthy() stays true, and everything that comes through the restarted relay stays invisible until the app restarts.');
  assert.equal(w.returnedFor(A), 1, 'the redial worked but the app was never told, so nothing re-subscribed on the new socket');
  assert.equal(w.pool.relays.get(A).connected, true);
});

test('the redial is watched too: a relay that drops a SECOND time is dialled again', async () => {
  const w = world();
  const a = await connect(w, A);
  a.close(); await w.advance(6000);
  assert.equal(w.returnedFor(A), 1);
  await w.advance(61000);                         // the new socket proves itself by staying up
  w.pool.relays.get(A).close(); await w.advance(6000);
  assert.equal(w.returnedFor(A), 2, 'the redialled socket was not watched, so the second restart is not recovered');
});

test('a socket WE close (reconnectAll, dropping a relay the church removed) is not redialled', async () => {
  const w = world();
  await connect(w, A);
  w.pool.close([A]);
  await w.advance(600000);
  assert.equal(w.dials.filter((d) => d.url === A).length, 1, 'a deliberate close was redialled — reconnectAll() would fight itself');
});

test('an address the gate no longer admits is not redialled (re-dialling must never widen who a church talks to)', async () => {
  let ok = true;
  const w = world({ admitted: () => ok });
  const a = await connect(w, A);
  ok = false; a.close();
  await w.advance(600000);
  assert.equal(w.dials.filter((d) => d.url === A).length, 1, 'a relay the church no longer admits was dialled again');
});

test('an address that never connected is not dialled by the watcher', async () => {
  const w = world();
  w.reach(B, false);
  await assert.rejects(() => w.pool.ensureRelay(B));
  await w.advance(600000);
  assert.equal(w.dials.filter((d) => d.url === B).length, 1, 'a failed first dial was retried in the background — this is not a way to open a relay nobody asked for');
});

test('it does not run while the app is in the background', async () => {
  const w = world();
  const a = await connect(w, A);
  w.doc.visibilityState = 'hidden'; a.close();
  await w.advance(600000);
  assert.equal(w.dials.filter((d) => d.url === A).length, 1, 'a backgrounded app dialled a relay on a timer');
});

test('a relay that stays down is tried on a growing schedule, five times, and then left alone', async () => {
  const w = world();
  const a = await connect(w, A);
  w.reach(A, false); a.close();
  await w.advance(1_000_000);
  const times = w.dials.filter((d) => d.url === A).map((d) => d.at - w.dials[0].at);
  assert.equal(times.length, 1 + 5, `expected the first dial plus five redials, got ${times.length}`);
  assert.equal(times[1], 5000, 'the first wait is 5s');
  const gaps = times.slice(2).map((t, i) => t - times[i + 1]);
  assert.deepEqual(gaps, [15000, 45000, 120000, 300000], 'the waits must grow (5s, 15s, 45s, 2min, 5min)');
});

test('a relay that connects and drops straight away does not earn a fresh set of attempts each time', async () => {
  const w = world();
  w.reach(A, true);
  const first = await w.pool.ensureRelay(A);
  first.close();
  for (let i = 0; i < 40; i++) {
    await w.advance(20000);
    const r = w.pool.relays.get(A);
    if (r) r.close();                              // up for moments, then gone again
  }
  assert.ok(w.dials.filter((d) => d.url === A).length <= 7,
    `a crash-looping relay was dialled ${w.dials.filter((d) => d.url === A).length} times — the count must survive a connection that did not last`);
});

test('if something else has already brought the relay back, the redial does nothing', async () => {
  const w = world();
  const a = await connect(w, A);
  a.close();
  w.reach(A, true);
  await w.pool.ensureRelay(A);                     // the app's own re-subscribe got there first
  const before = w.dials.length;
  await w.advance(30000);
  assert.equal(w.dials.length, before, 'redialled a relay that was already connected');
});

test('every phone does not redial in the same second: the wait carries up to 5s of jitter', async () => {
  // a relay restart drops EVERY phone at one instant; a fixed delay would bring them all back together
  const early = world({ random: 0 }), late = world({ random: 0.999 });
  for (const w of [early, late]) { const a = await connect(w, A); a.close(); }
  await early.advance(5000); await late.advance(5000);
  assert.equal(early.dials.filter((d) => d.url === A).length, 2, 'with no jitter the first redial is at 5s');
  assert.equal(late.dials.filter((d) => d.url === A).length, 1, 'with full jitter the first redial must not have happened yet at 5s');
  await late.advance(5000);
  assert.equal(late.dials.filter((d) => d.url === A).length, 2, 'the jittered redial must still arrive within 10s');
});
