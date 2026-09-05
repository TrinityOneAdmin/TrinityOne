// A RELAY REFUSING THIS DEVICE IS NOT A CHURCH REFUSING THIS PERSON.
// Run: node --test scripts/a-refused-proof-is-not-a-refused-member.test.mjs
//
// Measured on a phone, 2026-09-04 and again 2026-09-05. With the clock 15 minutes out (the relay's NIP-42
// window is 600s) the relay refuses the AUTH and LEAVES THE SOCKET OPEN. relaysHealthy() stays true, every
// gated read comes back empty — and `admitted` is a gated read, so `isPending` (= approval && !isAdmitted)
// goes true for a member the church admitted weeks ago. She was shown:
//
//     Waiting to be let in
//     Your request has been sent. A steward usually lets people in within a day — you don't need to do
//     anything else.                                                                     [ Check again ]
//
// Every word false, and "Check again" could never succeed. Worse, it did not self-heal: nostr-tools caches
// `relay.authPromise`, so once refused NOTHING RE-SIGNS on that socket. Correcting the clock changed
// nothing — soaked eleven minutes at zero drift, eleven polls, still locked out; only closing the socket
// recovered it. The app's own 90s beat could not help because it returns early when relaysHealthy() is true,
// which is exactly what a refused-but-open socket looks like.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');

// Slice an arrow assigned to a const (`const f = () => {…}`) — fnBody hands back the whole statement, which
// is not an expression. Take from the arrow's parameter list to the brace that closes its body.
function arrowBody(src, anchor) {
  const at = src.indexOf(anchor);
  assert.notEqual(at, -1, anchor + ' is missing — re-anchor this test rather than widening a window');
  const arrow = src.indexOf('(', at);
  const open = src.indexOf('{', src.indexOf('=>', arrow));
  let d = 0, i = open;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) break; } }
  const body = src.slice(arrow, i + 1);
  assert.ok(body.length > 120, anchor + ' sliced to a stub — re-anchor rather than widening');
  return body;
}
function lift(src, anchor, name, stubs, arrow) {
  const body = arrow ? arrowBody(src, anchor) : fnBody(src, anchor, name);
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, '');
      if (base in t) return t[base];
      throw new ReferenceError('the lifted function needs `' + String(k) + '` — add a stub');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return new Function('scope', `with (scope) { return (${body}); }`)(scope);
}

test('a refusal is RECORDED, not merely not-recorded as an acceptance', async () => {
  // This handler used to be `() => {}`, so a refused AUTH was indistinguishable from one still in flight,
  // and nothing downstream could tell "the relay would not have us" from "we have not asked yet".
  const stubs = { _relayAuthOkAt: 0, _relayAuthFailedAt: 0, _relayAuthFailReason: '', _relaySkewSec: 0,
    normalizeURL: (u) => u, Promise, Date };
  let reject; const authPromise = new Promise((_, rj) => { reject = rj; });
  authPromise.catch(() => {});
  stubs.pool = { relays: { get: () => ({ authPromise }) } };
  const note = lift(VENDOR, 'function _noteAuthAccepted(url) {', '_noteAuthAccepted', stubs);
  note('wss://relay.example/relay');
  reject(new Error('auth-failed: bad challenge or signature'));
  await new Promise(r => setTimeout(r, 10));
  assert.ok(stubs._relayAuthFailedAt > 0,
    'the relay refused our proof and the client wrote nothing down. Every screen downstream then has to ' +
    'guess, and the one that guessed told an admitted member she was still waiting to be let in.');
  assert.match(stubs._relayAuthFailReason, /bad challenge or signature/, 'the relay said why and we discarded it');
  assert.equal(stubs._relayAuthOkAt, 0, 'a refusal must not look like an acceptance');
});

test('CONTROL: an acceptance clears a previous refusal', async () => {
  const stubs = { _relayAuthOkAt: 0, _relayAuthFailedAt: 5, _relayAuthFailReason: 'old', _relaySkewSec: 0,
    normalizeURL: (u) => u, Promise, Date };
  let resolve; const authPromise = new Promise((rs) => { resolve = rs; });
  stubs.pool = { relays: { get: () => ({ authPromise }) } };
  const note = lift(VENDOR, 'function _noteAuthAccepted(url) {', '_noteAuthAccepted', stubs);
  note('wss://relay.example/relay');
  resolve(true);
  await new Promise(r => setTimeout(r, 10));
  assert.ok(stubs._relayAuthOkAt > 0, 'an accepted proof was not recorded');
  assert.equal(stubs._relayAuthFailedAt, 0,
    'a stale refusal survived a successful auth, so the app would keep reconnecting a connection that works');
});

test('THE FIX: the app re-challenges a refused proof, whatever the socket looks like', () => {
  // Point of use: this is the real `retryIfRefused` out of app/app.jsx — the file the app ships unbundled,
  // so this executes it rather than matching text in it (rule 3).
  const calls = [];
  let now = 1000000;
  const F = {
    authState: () => ({ failed: true }),
    reconnectAll: () => calls.push('reconnectAll'),
    measureRelaySkew: () => calls.push('measureRelaySkew'),
    relaysHealthy: () => true,   // the socket LOOKS fine — that is the whole trap
  };
  const retry = lift(APP, 'const retryIfRefused = () => {', 'retryIfRefused', {
    window: { Fellowship: F }, Date: { now: () => now }, lastAuthRetry: 0,
  }, true);
  assert.equal(retry(), true, 'it did not recognise a refused proof');
  assert.ok(calls.includes('reconnectAll'),
    'the app saw a refused proof and did nothing. nostr-tools caches relay.authPromise, so no new ' +
    'subscription re-signs — the member stays locked out for ever, and fixing the clock does not help.');
  assert.ok(calls.includes('measureRelaySkew'), 'it recovered but never measured why, so the screen cannot name the cause');

  // …and not in a loop: a genuinely blocked key must not become a reconnect storm.
  calls.length = 0; now += 5000;
  assert.equal(retry(), true, 'still refused, so it should still report true');
  assert.deepEqual(calls, [], 'it reconnected again within a minute — a blocked key would loop for ever');

  now += 61000;
  retry();
  assert.ok(calls.includes('reconnectAll'), 'after the cooldown it must try again — the clock may have been fixed');
});

test('CONTROL: a healthy, accepted connection is left alone', () => {
  const calls = [];
  const retry = lift(APP, 'const retryIfRefused = () => {', 'retryIfRefused', {
    window: { Fellowship: { authState: () => ({ failed: false }), reconnectAll: () => calls.push('x'), measureRelaySkew: () => calls.push('m') } },
    Date, lastAuthRetry: 0,
  }, true);
  assert.equal(retry(), false, 'it claimed a working connection was refused');
  assert.deepEqual(calls, [], 'it tore down a perfectly good socket');
});

test('CONTROL: an older bundle without authState is not treated as refused', () => {
  const calls = [];
  const retry = lift(APP, 'const retryIfRefused = () => {', 'retryIfRefused', {
    window: { Fellowship: { reconnectAll: () => calls.push('x') } }, Date, lastAuthRetry: 0,
  }, true);
  assert.equal(retry(), false);
  assert.deepEqual(calls, [], 'it reconnected on a bundle that cannot even report auth state');
});

test('the join state carries whether we were ABLE to ask', () => {
  // subscribeChurchJoin's `admitted` is a gated read. If it emits only isPending, every screen downstream
  // must guess. It now carries authFailed so the app can say "could not check" instead of "not admitted".
  const body = fnBody(VENDOR, 'subscribeChurchJoin(churchNpub, onState) {', 'subscribeChurchJoin');
  assert.ok(body.length > 400, 'subscribeChurchJoin sliced to a stub — re-anchor rather than widening');
  assert.match(body, /authFailed:\s*authState\(\)\.failed/,
    'the join state no longer says whether the relay would even talk to us, so "waiting to be let in" is ' +
    'reachable again for a member who was admitted long ago');
});

// ── THE SCREEN, AND WHAT THIS TEST CANNOT DO ──────────────────────────────────────────────────────────
// The card lives in TodayScreen, which I could not render in this harness (it dies on a child's ref before
// reaching the card). So this is a SOURCE-SHAPE guard, and rule 3 says exactly what that is worth: app/*.jsx
// ships unbundled, so `false && ` in front of a condition leaves every word of it in place and this would
// still pass. It is here to catch the guard being DELETED, which is the likely regression, and it cannot
// catch it being disabled.
//
// The behaviour itself is proved on hardware instead, which is stronger than either: Oppo J77HDMTC7TKBZDFM,
// clock +15:00, relay refusing the AUTH — measured `waiting:false, cantCheck:true`, and a screenshot of the
// card. Then, clock restored and THE APP NEVER RESTARTED, it recovered inside 30s (`failed:false`, both
// cards gone, care card back) where the unfixed build stayed broken for eleven minutes across eleven polls.
test('the waiting card is gated on having been able to ask (source shape — see the note above)', () => {
  const TODAY = readFileSync(new URL('../app/screens-today.jsx', import.meta.url), 'utf8');
  const at = TODAY.indexOf('Waiting to be let in');
  assert.notEqual(at, -1, 'the waiting card is gone — re-anchor this test');
  const guard = TODAY.slice(Math.max(0, at - 700), at);
  assert.match(guard, /!ctx\.joinState\.authFailed/,
    'the "Waiting to be let in" card is no longer gated on whether we could reach the church at all, so an ' +
    'admitted member whose clock is wrong is told again that her request is still waiting');
  assert.match(TODAY, /Can’t check with your church right now/,
    'the honest card is gone, so a refused proof now shows nothing at all rather than saying what happened');
});
