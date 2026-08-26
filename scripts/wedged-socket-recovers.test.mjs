// A SOCKET THAT HEARS BUT WILL NOT SPEAK MUST BE HUNG UP ON — AND A SLOW OR GRUMPY ONE MUST NOT BE.
// Run: node --test scripts/wedged-socket-recovers.test.mjs
//
// SIMULATION ROUND 6: six phones in a congregation of twenty reached a moment after which nothing they
// published ever arrived again, while everything sent TO them kept arriving. Measured on the relay's own
// store — one member's last document landed at 19:45:31 while other members' kept storing until 19:56:04.
// A prayer request about a dying mother, a condolence letter, four messages from a 16-year-old to her father.
//
// Queueing means those words are no longer destroyed. It does NOT mean they arrive: nothing in the app ever
// hangs up on a socket that has stopped accepting writes. It never fires a close event, so the connection
// reports itself healthy and every retry goes down the same dead pipe until the app restarts.
//
// HALF THIS FILE GUARDS THE OTHER DIRECTION, AND THAT HALF IS THE HARDER ONE. A church on a thin, slow,
// contended connection is exactly who this product exists for, and disconnecting one for being slow — or for
// being told "rate-limited" — would be worse than the bug: reconnect, congest, reconnect. The first version of
// this fix got four of those wrong at once, and an audit the same day ran each one. Every test below marked
// AUDIT is a fault that shipped for a few hours and is now pinned so it cannot come back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments, fnBody } from './test-slice.mjs';

const V = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const _norm = (u) => { const x = new URL(u); x.pathname = x.pathname.replace(/\/+$/, ''); return x.toString().replace(/\/$/, ''); };

// Drive the real detector. Time is injected so a minute of "real" delay costs nothing here — the alternative
// is a test that sleeps for minutes, which nobody runs and which would be deleted within a month.
// `statusKeys` is how the POOL spells the relay addresses, which is not necessarily how the church typed them.
function detector({ statusKeys = ['ws://r'], connected = true, hidden = false } = {}) {
  const src = [
    fnBody(V, 'function _poolSaysConnected', '_poolSaysConnected'),
    fnBody(V, 'function _wedgeKey', '_wedgeKey'),
    fnBody(V, 'function _noteSendResult', '_noteSendResult'),
  ].join('\n');
  const reconnects = [];
  let clock = 1000000;
  const scope = {
    _wedge: new Map(),
    WEDGE_SILENCES: 3, WEDGE_WINDOW_MS: 60000, WEDGE_COOLDOWN_MS: 300000,
    _wedgeLastRecovery: 0,
    // The bundler renames the imported helper (normalizeURL -> normalizeURL2), so BOTH names are stubbed:
    // a missing one would throw inside the function's own try/catch and read as "not connected" — the exact
    // silent-failure shape this test exists to catch, hidden by the test's own rig.
    normalizeURL: _norm, normalizeURL2: _norm,
    pool: { listConnectionStatus: () => new Map(statusKeys.map(k => [k, connected])) },
    document: { visibilityState: hidden ? 'hidden' : 'visible' },
    reconnectAll: () => reconnects.push(clock),
    console: { warn: () => {} },
    Date: { now: () => clock },
    URL,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(k in globalThis),
    get: (t, k) => { if (k in t) return t[k]; if (k === Symbol.unscopables) return undefined;
      throw new ReferenceError('needs a stub for ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  // eslint-disable-next-line no-new-func
  const fn = new Function('scope', `with (scope) { ${src}; return _noteSendResult; }`)(proxy);
  const at = (url) => ({
    silent: () => fn(url, 'silent'), spoke: () => fn(url, 'spoke'), ok: () => fn(url, 'ok'),
  });
  return { at, ...at('ws://r'), tick: (ms) => { clock += ms; }, reconnects };
}

test('three unanswered sends across a minute, on a socket that claims to be connected, force a reconnect', () => {
  const d = detector();
  d.silent(); d.tick(30000);
  d.silent(); d.tick(31000);
  assert.equal(d.reconnects.length, 0, 'it reconnected before it had enough evidence');
  d.silent();
  assert.equal(d.reconnects.length, 1, 'a one-way stall was never noticed — the member stays mute until restart');
});

test('a SLOW but honest relay is never hung up on', () => {
  // Any acknowledgement resets the count, so a church whose relay answers in ten seconds every time — inside
  // the eleven-second window the app now allows — is left alone for ever.
  const d = detector();
  for (let i = 0; i < 20; i++) { d.silent(); d.tick(30000); d.ok(); d.tick(30000); }
  assert.equal(d.reconnects.length, 0,
    'a relay that keeps answering, just slowly, gets disconnected — reconnect, congest, reconnect');
});

test('AUDIT: a relay that ANSWERS "rate-limited" or "blocked" is never hung up on either', () => {
  // The fault that shipped. A refusal is two-way traffic: it PROVES the uplink works. The first version
  // counted every failed send, so a relay with a full disk ("error: storage unavailable"), or a congregation
  // locked out by a config change ("blocked: not a member"), would have had every phone in the church
  // rebuilding every subscription every five minutes for the duration.
  const d = detector();
  for (let i = 0; i < 40; i++) { d.spoke(); d.tick(30000); }
  assert.equal(d.reconnects.length, 0,
    'a relay that is talking to us — and refusing — is being treated as a dead pipe');
});

test('AUDIT: a wedged relay is not rescued by a healthy one beside it', () => {
  // The first version judged success for the WHOLE publish, so a church running its own relay alongside the
  // shared fallback had the fallback's success reset its own relay's count for ever. Everything quietly landed
  // on one relay only, the church's redundancy was silently halved, and nothing said so.
  const d = detector({ statusKeys: ['ws://mine', 'ws://fallback'] });
  const mine = d.at('ws://mine'), fallback = d.at('ws://fallback');
  mine.silent(); fallback.ok(); d.tick(30000);
  mine.silent(); fallback.ok(); d.tick(31000);
  mine.silent(); fallback.ok();
  assert.equal(d.reconnects.length, 1,
    'the church’s own relay stays wedged because the fallback is fine — half the redundancy, invisibly');
});

test('AUDIT: the address the church TYPED still finds the pool’s entry', () => {
  // The fault that would have made the whole feature silently do nothing. The pool keys its connection map by
  // a normalised address; the relay list holds it exactly as typed. A steward who types a trailing slash — or
  // a bare hostname — produced a lookup that found nothing, and "nothing" is not "connected", so the detector
  // returned before counting anything, every time, for ever. relaysHealthy() carries a long comment about
  // this exact trap; the first version of this code, twenty lines away, did not copy it.
  const d = detector({ statusKeys: ['wss://church.example/relay'] });   // how the POOL spells it
  const typed = d.at('wss://church.example/relay/');                    // how a steward typed it
  typed.silent(); d.tick(30000); typed.silent(); d.tick(31000); typed.silent();
  assert.equal(d.reconnects.length, 1,
    'a church that typed a trailing slash gets no stall detection at all, and no error to explain it');
});

test('AUDIT: two relays stalling together produce ONE teardown, not two', () => {
  // reconnectAll() rebuilds every socket in the pool, so the cooldown has to be global even though the
  // evidence is per relay. The pilot's default publish set is two addresses to ONE box, which makes both
  // stalling at the same instant the LIKELIEST case rather than an exotic one — and each teardown also
  // rejects other publishes in flight.
  const d = detector({ statusKeys: ['ws://a', 'ws://b'] });
  const a = d.at('ws://a'), b = d.at('ws://b');
  a.silent(); b.silent(); d.tick(30000);
  a.silent(); b.silent(); d.tick(31000);
  a.silent(); b.silent();
  assert.equal(d.reconnects.length, 1, 'one stall tore down every socket twice over');
});

test('three silences in quick succession are a blip, not a stall', () => {
  const d = detector();
  d.silent(); d.tick(500); d.silent(); d.tick(500); d.silent();
  assert.equal(d.reconnects.length, 0, 'a momentary hiccup tears down a healthy connection');
});

test('silence from a relay we are not even connected to is ordinary offline', () => {
  const d = detector({ connected: false });
  d.silent(); d.tick(30000); d.silent(); d.tick(31000); d.silent();
  assert.equal(d.reconnects.length, 0, 'an offline phone is now reconnecting in a loop');
});

test('a backgrounded app manufactures no silences', () => {
  // A phone's WebView defers work when the screen sleeps; counting those would reconnect every church every
  // time somebody pockets their phone.
  const d = detector({ hidden: true });
  d.silent(); d.tick(30000); d.silent(); d.tick(31000); d.silent();
  assert.equal(d.reconnects.length, 0, 'pocketing the phone now triggers a reconnect');
});

test('recovery happens at most once every five minutes', () => {
  const d = detector();
  const stall = () => { d.silent(); d.tick(30000); d.silent(); d.tick(31000); d.silent(); };
  stall();
  assert.equal(d.reconnects.length, 1);
  stall();
  assert.equal(d.reconnects.length, 1, 'a pathological link can now cause a reconnect storm');
  d.tick(300000);
  stall();
  assert.equal(d.reconnects.length, 2, 'recovery never happens again after the first cooldown');
});

// ── the wiring, which a lifted function cannot see ──────────────────────────────────────────────────────
test('every relay in a publish is judged on its OWN result', () => {
  const body = stripComments(fnBody(V, 'function _publishAny', '_publishAny'));
  assert.match(body, /rs\.forEach\(\(r, (\w+)\) =>[\s\S]*targets\[\1\]/,
    'the publish is judged as a whole again, so one healthy relay hides a wedged one');
});

test('a slow relay is given eleven seconds to answer, not four', () => {
  // The vendored library gives up after 4.4s and calls it failure — but a late OK is not a refusal, and the
  // event has usually been stored. The console raised this for its own publishes after round 6 showed a vicar
  // a red "Couldn't save" over three groups that saved perfectly well. Left at 4.4s here, a church whose relay
  // answers in six seconds has EVERY publish recorded as failed AND read as a stalled uplink.
  const body = stripComments(fnBody(V, 'function _publishAny', '_publishAny'));
  assert.match(body, /publishTimeout < WEDGE_ACK_MS[\s\S]{0,40}publishTimeout = WEDGE_ACK_MS/,
    'the member app still gives up on a slow relay after 4.4 seconds');
  const num = (re) => { const m = stripComments(V).match(re); return m ? Number(m[1]) : NaN; };
  const decl = stripComments(V).match(/WEDGE_ACK_MS\s*=\s*([\d.e+]+)/);
  assert.ok(decl, 're-anchor: WEDGE_ACK_MS is gone');
  const ack = Number(decl[1]), bound = num(/PUBLISH_TIMEOUT_MS\s*=\s*([\d.e+]+)/);
  assert.ok(ack > 4400, 'no better than the library default');
  assert.ok(bound && ack < bound,
    'the inner timeout must settle BEFORE the outer bound, or the race is won by the bound and NO per-relay ' +
    `outcome is ever recorded — the whole feature goes quiet (ack ${ack} vs bound ${bound})`);
});

test('recovery uses the full reconnect, not a targeted close', () => {
  // reconnectAll() is the only path that clears the shared-subscription registry. A targeted socket close
  // would leave a re-subscriber joining a dead entry and the screen frozen — a trap already paid for once.
  const body = stripComments(fnBody(V, 'function _noteSendResult', '_noteSendResult'));
  assert.match(body, /reconnectAll\(\)/, 'recovery does not use the proven reconnect path');
  assert.doesNotMatch(body, /pool\.close/, 'a targeted close re-opens the dead shared-subscription trap');
});

test('everything queued is flushed once a socket comes back', () => {
  assert.match(stripComments(V), /trinity-relay-returned[\s\S]{0,200}_outboxFlush/,
    'nothing flushes the outbox when a connection returns');
});
