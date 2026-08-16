// A ROOM LEFT OPEN MUST NOT GO DEAF, AND THE COMMUNITY LIST MUST NOT FREEZE.
// Run: node --test scripts/chat-reconnect.test.mjs
//
// THE DEFECT THIS GUARDS. When a relay socket drops — a phone backgrounded, a screen off, a signal blip, a
// relay restart — nostr-tools reconnects the socket but does NOT re-issue the REQs that were open on the old
// one. The socket is healthy and the subscriptions are dead. `relaysHealthy()` reads the pool's live
// connection state and so correctly answers TRUE, which is precisely the answer app.jsx's 90-second safety net
// treats as "nothing to do" — so nothing ever recovers.
//
// Fourteen subscription effects in app.jsx list `connTick` in their deps for exactly this reason. The two in
// screens-chat.jsx did not: the Community list's last-message previews, and the messages in an OPEN room.
// Those are the two a member actually watches.
//
// Measured on 2026-08-16, driving the shipped app in a browser against a real relay and reading relay.sqlite:
// background the app, publish three messages, come back. Store holds 7, screen says 4 — and a message
// published a full minute AFTER the app returned never arrived either. The room heals only if you close and
// reopen it, which is why the same room reads "stale" to someone sitting still and "fine" to someone
// wandering between screens. It is the finding the 2026-08-16 simulation recorded as "a room shows old
// messages while its list shows new ones", and it is why the owner remembered it as a slow-connection
// problem: a dropped socket is what a slow connection eventually does.
//
// Three things have to hold, and all three are exercised here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const CHAT   = readFileSync(new URL('../app/screens-chat.jsx', import.meta.url), 'utf8');
const APP    = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');

// The REAL handler, lifted from the SHIPPED bundle and executed against a fake pool — so a source-only fix
// that was never built (or a build that dropped it) fails here rather than passing on the strength of a .js
// file nobody loads.
function loadHandler() {
  const at = BUNDLE.indexOf('pool.onRelayConnectionSuccess =');
  assert.notEqual(at, -1,
    'the reconnect handler is gone from vendor/fellowship.js — rebuild: bash scripts/build-fellowship.sh');
  const src = BUNDLE.slice(at, BUNDLE.indexOf('\n  };', at) + 5);
  const pool = { relays: new Map() };
  const fired = [];
  const win = { dispatchEvent: (e) => { fired.push(e); return true; } };
  const CustomEvent = function (type, init) { this.type = type; this.detail = init && init.detail; };
  const install = new Function('pool', 'window', 'CustomEvent', '_liveRelay', src + '; return pool.onRelayConnectionSuccess;');
  return { onSuccess: install(pool, win, CustomEvent, new Map()), pool, fired };
}

test('a returning socket announces itself, so the subscriptions can be rebuilt', () => {
  const { onSuccess, pool, fired } = loadHandler();
  const first = { id: 'socket-1' };
  pool.relays.set('wss://church/relay', first);

  onSuccess('wss://church/relay');
  assert.equal(fired.length, 0, 'the FIRST connect is not a reconnect — announcing it would re-subscribe at boot');

  onSuccess('wss://church/relay');
  assert.equal(fired.length, 0,
    'nostr-tools calls this on every subscription, not only on a new socket — the same socket must stay silent, ' +
    'or every ordinary read re-subscribes the whole app in a loop');

  pool.relays.set('wss://church/relay', { id: 'socket-2' });   // the drop and reconnect
  onSuccess('wss://church/relay');
  assert.equal(fired.length, 1, 'a NEW socket means the old REQs are gone — this is the only signal that they are');
  assert.equal(fired[0].type, 'trinity-relay-returned',
    'its OWN event: trinity-reconnect is the mandatory post-teardown rebuild and must not be fired per relay');
});

test('a socket that closes mid-callback is not recorded as live', () => {
  const { onSuccess, pool, fired } = loadHandler();
  onSuccess('wss://church/relay');   // pool.relays has no entry — it closed between ensureRelay and here
  assert.equal(fired.length, 0);
  pool.relays.set('wss://church/relay', { id: 'socket-1' });
  onSuccess('wss://church/relay');
  assert.equal(fired.length, 0, 'a stored undefined would make the next real socket look like a reconnect at boot');
});

test('each relay is tracked separately', () => {
  const { onSuccess, pool, fired } = loadHandler();
  pool.relays.set('wss://a/relay', { id: 'a1' }); onSuccess('wss://a/relay');
  pool.relays.set('wss://b/relay', { id: 'b1' }); onSuccess('wss://b/relay');
  assert.equal(fired.length, 0, 'two first-connects, not a reconnect');
  pool.relays.set('wss://b/relay', { id: 'b2' }); onSuccess('wss://b/relay');
  assert.equal(fired.length, 1, 'one relay coming back must be noticed even while the other never moved');
});

// ── the two subscriptions must actually be wired to the signal ───────────────────────────────────────────
// Comment-stripped: every comment near these lines names `connTick`, and a comment has satisfied an
// assertion in this repo before (HANDOFF-2026-08-05 §4.3).

test('the Community list re-subscribes on reconnect', () => {
  const chat = stripComments(CHAT);
  const at = chat.indexOf('window.Fellowship.subscribeGroups(ids');
  assert.notEqual(at, -1, 'the group-list preview subscription is gone — re-anchor this test');
  const deps = chat.slice(at, chat.indexOf('}, [', at) + 60);
  assert.match(deps, /\}, \[groupIdsKey, ctx\.connTick\]/,
    'opened once and never again: when its socket drops, every last-message preview and unread badge in the ' +
    'Community list freezes for the rest of the session, while the app reports the relay as healthy');
});

test('an open room re-subscribes on reconnect, without blinking itself empty', () => {
  const room = stripComments(fnBody(CHAT, 'function ChatRoom('));
  const at = room.indexOf('window.Fellowship.subscribeGroup(group.id, add)');
  assert.notEqual(at, -1, 'the room subscription is gone — re-anchor this test');
  assert.match(room.slice(at), /\}, \[group, ctx\.connTick\]/,
    'a room left open across a signal drop goes permanently deaf — it recovers only if the member closes and reopens it');

  // …and the re-run must not throw the thread away under someone who is reading it.
  assert.match(room, /const sameRoom = seenRef\.current && seenRef\.current\.gid === group\.id/,
    'the effect now re-runs while the room is on screen, so it must be able to tell a reconnect from a room change');
  assert.match(room, /if \(!sameRoom\) \{\s*setMsgs\(\[\]\)/,
    'clearing on a reconnect would blink every message away mid-read');
  assert.doesNotMatch(room, /const seen = new Set\(\)/,
    'a fresh `seen` on every reconnect appends the relay’s whole replay a second time — 200 duplicate bubbles');
  assert.match(room, /const seen = seenRef\.current\.ids/,
    '`seen` must outlive the effect so the replay after a reconnect is deduped');
});

test('a returning socket is advisory, and does not share the mandatory event', () => {
  // ADVERSARIAL REVIEW, 2026-08-16. `trinity-reconnect` means "reconnectAll() has already torn everything
  // down and only you can rebuild it" — force(), never debounced. This branch first made a RETURNING SOCKET
  // fire that same event, which is once per relay per flap: a full teardown and re-subscribe of ~15 effects
  // per relay, several with no `since`, i.e. a full backlog re-download on a thin pipe. reconnect-storm.test
  // caught the overload; this holds the shape that replaced it.
  const effect = stripComments(APP.slice(APP.indexOf('const [connTick, bumpConn]')));
  const mandatory = effect.slice(effect.indexOf('const onReconnectNeeded'), effect.indexOf('const onReconnectNeeded') + 200);
  assert.match(mandatory, /sched\.force\(\)/, 'reconnectAll() must still force — nothing else rebuilds what it tore down');
  assert.doesNotMatch(mandatory, /sched\.fire\(/, 'and it must never share the advisory gate');

  const advisory = effect.slice(effect.indexOf('const onRelayReturned'), effect.indexOf('const onRelayReturned') + 200);
  assert.match(advisory, /sched\.fire\(false\)/,
    'a returning socket is advisory — collapse it and jitter it across the congregation');
  assert.match(effect, /addEventListener\('trinity-relay-returned',\s*onRelayReturned\)/, 'nothing listens for it');
  assert.match(effect, /removeEventListener\('trinity-relay-returned',\s*onRelayReturned\)/,
    'an unremoved listener survives every remount and multiplies the rebuilds it was added to reduce');

  // …and the sender must use that name, or the listener is dead code.
  assert.match(BUNDLE, /'trinity-relay-returned'|"trinity-relay-returned"/,
    'the socket-return dispatch is gone from the bundle — rebuild: bash scripts/build-fellowship.sh');
  const at = BUNDLE.indexOf('pool.onRelayConnectionSuccess =');
  const handler = BUNDLE.slice(at, BUNDLE.indexOf('\n  };', at));
  assert.doesNotMatch(handler, /trinity-reconnect/,
    'a socket returning must not fire the MANDATORY event — that is the storm this pair of tests exists to stop');
});

test('the screens can see the reconnect signal at all', () => {
  const ctx = stripComments(fnBody(APP, 'const ctx = {'));
  assert.match(ctx, /\bconnTick,/,
    'screens-chat.jsx reads ctx.connTick — without it on the ctx object both deps above are permanently undefined, ' +
    'which is a dependency that never changes and so a subscription that never re-opens');
});
