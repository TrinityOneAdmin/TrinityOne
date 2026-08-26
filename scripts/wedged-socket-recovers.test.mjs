// A SOCKET THAT HEARS BUT WILL NOT SPEAK MUST BE HUNG UP ON — AND A SLOW ONE MUST NOT BE.
// Run: node --test scripts/wedged-socket-recovers.test.mjs
//
// SIMULATION ROUND 6: six phones in a congregation of twenty reached a moment after which nothing they
// published ever arrived again, while everything sent TO them kept arriving. Measured on the relay's own
// store — one member's last document landed at 19:45:31 while other members' kept storing until 19:56:04.
// A prayer request about a dying mother, a condolence letter, four messages from a 16-year-old to her father.
//
// Queueing (fixed yesterday) means those words are no longer destroyed. It does NOT mean they arrive: nothing
// in the app ever hangs up on a socket that has stopped accepting writes. It never fires a close event, so
// the connection reports itself healthy and every retry goes down the same dead pipe until the app restarts.
//
// THE HARDER HALF OF THIS FILE IS THE SECOND TEST. A church on a thin, slow, contended connection is exactly
// who this product exists for, and disconnecting one for merely being slow would be worse than the bug —
// reconnect, congest, reconnect. So the same evidence that must trigger recovery must also NOT trigger on a
// relay that is honest but slow. No test in this suite has ever driven either state.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments, fnBody } from './test-slice.mjs';

const V = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

// Drive the real detector. Time is injected so a minute of "real" delay costs nothing here — the alternative
// is a test that sleeps for minutes, which nobody runs and which would be deleted within a month.
function detector({ connected = true, hidden = false } = {}) {
  const src = fnBody(V, 'function _noteSendResult', '_noteSendResult');
  const reconnects = [];
  let clock = 1000000;
  const scope = {
    _wedge: new Map(),
    WEDGE_FAILS: 3, WEDGE_WINDOW_MS: 60000, WEDGE_COOLDOWN_MS: 300000,
    pool: { listConnectionStatus: () => new Map([['ws://r', connected]]) },
    document: { visibilityState: hidden ? 'hidden' : 'visible' },
    reconnectAll: () => reconnects.push(clock),
    console: { warn: () => {} },
    Date: { now: () => clock },
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(k in globalThis),
    get: (t, k) => { if (k in t) return t[k]; if (k === Symbol.unscopables) return undefined;
      throw new ReferenceError('needs a stub for ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  // eslint-disable-next-line no-new-func
  const fn = new Function('scope', `with (scope) { ${src}; return _noteSendResult; }`)(proxy);
  return { fail: () => fn('ws://r', false), ok: () => fn('ws://r', true),
    tick: (ms) => { clock += ms; }, reconnects };
}

test('three failed sends across a minute, on a socket that claims to be connected, force a reconnect', () => {
  const d = detector();
  d.fail(); d.tick(30000);
  d.fail(); d.tick(31000);
  assert.equal(d.reconnects.length, 0, 'it reconnected before it had enough evidence');
  d.fail();
  assert.equal(d.reconnects.length, 1, 'a one-way stall was never noticed — the member stays mute until restart');
});

test('a SLOW but honest relay is never hung up on', () => {
  // The fence that matters most. Any acknowledgement resets the count, so a church whose relay answers in
  // eleven seconds every time — inside the twelve-second bound — is left alone for ever.
  const d = detector();
  for (let i = 0; i < 20; i++) { d.fail(); d.tick(30000); d.ok(); d.tick(30000); }
  assert.equal(d.reconnects.length, 0,
    'a relay that keeps answering, just slowly, gets disconnected — reconnect, congest, reconnect');
});

test('three failures in quick succession are a blip, not a stall', () => {
  const d = detector();
  d.fail(); d.tick(500); d.fail(); d.tick(500); d.fail();
  assert.equal(d.reconnects.length, 0, 'a momentary hiccup tears down a healthy connection');
});

test('failures to a relay we are not even connected to are ordinary offline', () => {
  // Being offline is a different problem with a different remedy; treating it as a stall would make an
  // offline phone reconnect on a loop.
  const d = detector({ connected: false });
  d.fail(); d.tick(30000); d.fail(); d.tick(31000); d.fail();
  assert.equal(d.reconnects.length, 0, 'an offline phone is now reconnecting in a loop');
});

test('a backgrounded app manufactures no failures', () => {
  // A phone's WebView defers work when the screen sleeps; counting those as evidence would reconnect every
  // church every time somebody pockets their phone.
  const d = detector({ hidden: true });
  d.fail(); d.tick(30000); d.fail(); d.tick(31000); d.fail();
  assert.equal(d.reconnects.length, 0, 'pocketing the phone now triggers a reconnect');
});

test('recovery happens at most once every five minutes', () => {
  const d = detector();
  const stall = () => { d.fail(); d.tick(30000); d.fail(); d.tick(31000); d.fail(); };
  stall();
  assert.equal(d.reconnects.length, 1);
  stall();
  assert.equal(d.reconnects.length, 1, 'a pathological link can now cause a reconnect storm');
  d.tick(300000);
  stall();
  assert.equal(d.reconnects.length, 2, 'recovery never happens again after the first cooldown');
});

test('recovery uses the full reconnect, not a targeted close', () => {
  // reconnectAll() is the only path that clears the shared-subscription registry. A targeted socket close
  // would leave a re-subscriber joining a dead entry and the screen frozen — a trap already paid for once.
  const body = stripComments(fnBody(V, 'function _noteSendResult', '_noteSendResult'));
  assert.match(body, /reconnectAll\(\)/, 'recovery does not use the proven reconnect path');
  assert.doesNotMatch(body, /pool\.close/, 'a targeted close re-opens the dead shared-subscription trap');
});

test('everything queued is flushed once a socket comes back', () => {
  // Otherwise recovery restores the connection and the member's waiting words sit there anyway until the
  // 45-second tick happens to come round.
  assert.match(stripComments(V), /trinity-relay-returned[\s\S]{0,200}_outboxFlush/,
    'nothing flushes the outbox when a connection returns');
});
