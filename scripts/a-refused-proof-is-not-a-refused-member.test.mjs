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
  const stubs = { _relayAuthOkAt: 0, _relaySkewSec: 0, _skewMeasuredAt: 0, _relayAuth: new Map(),
    normalizeURL: (u) => u, Promise, Date };
  let reject; const authPromise = new Promise((_, rj) => { reject = rj; });
  authPromise.catch(() => {});
  stubs.pool = { relays: { get: () => ({ authPromise }) } };
  const note = lift(VENDOR, 'function _noteAuthAccepted(url) {', '_noteAuthAccepted', stubs);
  note('wss://relay.example/relay');
  reject(new Error('auth-failed: bad challenge or signature'));
  await new Promise(r => setTimeout(r, 10));
  const rec = stubs._relayAuth.get('wss://relay.example/relay') || {};
  assert.ok(rec.failedAt > 0,
    'the relay refused our proof and the client wrote nothing down. Every screen downstream then has to ' +
    'guess, and the one that guessed told an admitted member she was still waiting to be let in.');
  assert.match(rec.reason, /bad challenge or signature/, 'the relay said why and we discarded it');
  assert.equal(rec.okAt, 0, 'a refusal must not look like an acceptance');
});

test('CONTROL: an acceptance clears a previous refusal', async () => {
  const stubs = { _relayAuthOkAt: 0, _relaySkewSec: 0, _skewMeasuredAt: 0, normalizeURL: (u) => u, Promise, Date,
    _relayAuth: new Map([['wss://relay.example/relay', { okAt: 0, failedAt: 5, reason: 'old' }]]) };
  let resolve; const authPromise = new Promise((rs) => { resolve = rs; });
  stubs.pool = { relays: { get: () => ({ authPromise }) } };
  const note = lift(VENDOR, 'function _noteAuthAccepted(url) {', '_noteAuthAccepted', stubs);
  note('wss://relay.example/relay');
  resolve(true);
  await new Promise(r => setTimeout(r, 10));
  const rec2 = stubs._relayAuth.get('wss://relay.example/relay') || {};
  assert.ok(rec2.okAt > 0, 'an accepted proof was not recorded');
  assert.equal(rec2.failedAt, 0,
    'a stale refusal survived a successful auth, so the app would keep reconnecting a connection that works');
});

test('THE FIX: the app re-challenges a refused proof, whatever the socket looks like', () => {
  // Point of use: this is the real `retryIfRefused` out of app/app.jsx — the file the app ships unbundled,
  // so this executes it rather than matching text in it (rule 3).
  const calls = [];
  let now = 1000000;
  let mono = 500000;
  const F = {
    authState: () => ({ failed: true, skewAt: now }),   // already measured…
    clockLooksWrong: () => true,                         // …and the clock IS the cause
    reconnectAll: () => calls.push('reconnectAll'),
    measureRelaySkew: () => calls.push('measureRelaySkew'),
    relaysHealthy: () => true,   // the socket LOOKS fine — that is the whole trap
  };
  const retry = lift(APP, 'const retryIfRefused = () => {', 'retryIfRefused', {
    window: { Fellowship: F }, Date: { now: () => now }, performance: { now: () => mono }, lastAuthRetry: 0,
  }, true);
  assert.equal(retry(), true, 'it did not recognise a refused proof');
  assert.ok(calls.includes('reconnectAll'),
    'the app saw a refused proof and did nothing. nostr-tools caches relay.authPromise, so no new ' +
    'subscription re-signs — the member stays locked out for ever, and fixing the clock does not help.');
  assert.ok(calls.includes('measureRelaySkew'), 'it recovered but never measured why, so the screen cannot name the cause');

  // …and not in a loop: a genuinely blocked key must not become a reconnect storm.
  calls.length = 0; now += 5000; mono += 5000;
  assert.equal(retry(), true, 'still refused, so it should still report true');
  assert.deepEqual(calls, [], 'it reconnected again within a minute — a blocked key would loop for ever');

  now += 61000; mono += 61000;
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

// ── THE BLOCKED MEMBER, which dd22062 got wrong ───────────────────────────────────────────────────────
// The relay cannot tell us why it refused: gateway.mjs:5382 makes a stale clock and a BLOCKED key one
// condition with one else-branch, so both return "auth-failed: bad challenge or signature" with the socket
// left open. Proved against the real gateway by an audit, 2026-09-05. Re-challenging cures the first and is
// useless for the second, so doing it blind gave every phone a church had removed a permanent 90-second
// full-teardown loop against the relay that removed them. The measured skew is the only discriminator.
test('a refusal with NO clock fault does not reconnect — a blocked member is not a reconnect loop', () => {
  const calls = [];
  let now = 1000000;
  const retry = lift(APP, 'const retryIfRefused = () => {', 'retryIfRefused', {
    window: { Fellowship: {
      authState: () => ({ failed: true, skewAt: now }),   // measured…
      clockLooksWrong: () => false,                        // …and the clock is fine
      reconnectAll: () => calls.push('reconnectAll'),
      measureRelaySkew: () => calls.push('measure'),
      relaysHealthy: () => true,
    } }, Date: { now: () => now }, lastAuthRetry: 0,
  }, true);
  assert.equal(retry(), true, 'it must still report the refusal so the screen can say something');
  assert.ok(!calls.includes('reconnectAll'),
    'it tore down every socket for a refusal the clock cannot explain. For a member the church has BLOCKED ' +
    'that never ends: reconnectAll() closes every relay and re-runs nine subscriptions, every 90 seconds, ' +
    'for ever, against the relay that removed them.');
  now += 120000;
  retry();
  assert.ok(!calls.includes('reconnectAll'), 'and it must still not, on the next beat');
});

test('it MEASURES before it decides, rather than assuming the clock', () => {
  const calls = [];
  const retry = lift(APP, 'const retryIfRefused = () => {', 'retryIfRefused', {
    window: { Fellowship: {
      authState: () => ({ failed: true, skewAt: 0 }),   // never measured
      clockLooksWrong: () => true,                      // must NOT be trusted before a measurement
      reconnectAll: () => calls.push('reconnectAll'),
      measureRelaySkew: () => calls.push('measure'),
    } }, Date, lastAuthRetry: 0,
  }, true);
  retry();
  assert.deepEqual(calls, ['measure'],
    'it acted on a skew it had never measured — the first tick must find out, not guess');
});

test('a clock fault still reconnects, and still respects the cooldown', () => {
  const calls = [];
  let now = 1000000;
  let mono = 900000;
  const F = { authState: () => ({ failed: true, skewAt: now }), clockLooksWrong: () => true,
    reconnectAll: () => calls.push('reconnectAll'), measureRelaySkew: () => calls.push('measure') };
  const retry = lift(APP, 'const retryIfRefused = () => {', 'retryIfRefused',
    { window: { Fellowship: F }, Date: { now: () => now }, performance: { now: () => mono }, lastAuthRetry: 0 }, true);
  retry();
  assert.ok(calls.includes('reconnectAll'), 'a genuine clock fault must still be re-challenged');
  calls.length = 0; now += 5000; mono += 5000; retry();
  assert.deepEqual(calls, [], 'it reconnected again inside the minute');
  now += 61000; mono += 61000; retry();
  assert.ok(calls.includes('reconnectAll'), 'after the cooldown it must try again — the clock may be fixed');

  // THE CASE THAT BROKE IT ON A DEVICE. The wall clock is corrected BACKWARDS by the fifteen minutes it was
  // out. A cooldown measured on Date.now() then sits in the future and suppresses the retry for exactly as
  // long as the original skew — during the only window the recovery is needed. performance.now() does not
  // move when the system clock is set, so the retry still fires.
  calls.length = 0; now -= 900000; mono += 61000; retry();
  assert.ok(calls.includes('reconnectAll'),
    'correcting the clock backwards suppressed the retry. The cooldown must not be measured on the very ' +
    'clock this feature exists to recover from.');
});

// ── ONE RELAY REFUSING IS NOT A FAILURE ───────────────────────────────────────────────────────────────
// _relayAuthOkAt/_relayAuthFailedAt were two module scalars written by EVERY relay, so with one accepting
// and another refusing the answer depended on which settled last. A member of two churches, banned by one,
// had the ban's relay decide for both — or not — by arrival order.
test('a relay that accepts us outweighs one that refuses, whichever settles last', async () => {
  const stubs = { _relayAuthOkAt: 0, _relaySkewSec: 0, _skewMeasuredAt: 0,
    _relayAuth: new Map(), normalizeURL: (u) => u, Promise, Date };
  const note = lift(VENDOR, 'function _noteAuthAccepted(url) {', '_noteAuthAccepted', stubs);
  const authState = lift(VENDOR, 'function authState() {', 'authState', stubs);

  let rejectB; const good = Promise.resolve(true); const bad = new Promise((_, rj) => { rejectB = rj; });
  bad.catch(() => {});
  stubs.pool = { relays: { get: (u) => ({ authPromise: u === 'wss://bad/relay' ? bad : good }) } };
  note('wss://good/relay');
  note('wss://bad/relay');
  rejectB(new Error('auth-failed: bad challenge or signature'));   // the refusal settles LAST
  await new Promise(r => setTimeout(r, 20));

  assert.equal(authState().failed, false,
    'one refusing relay beside a working one reported total failure, so the app tears down the connection ' +
    'that works and shows the member a card about a church they can actually reach');
  assert.equal(stubs._relayAuth.size, 2, 'auth state is not being tracked per relay');
});

// ── AND IT MUST NOT SAY THE MEMBER WAS REMOVED ────────────────────────────────────────────────────────
// `removed` is `wasAdmitted && approval && !isAdmitted`. A refused proof empties the gated `admitted` read,
// and `wasAdmitted` is true for anyone this phone has ever seen admitted — so every term went true for
// exactly the member the clock fix was for. screens-chat.jsx renders `removed` before `isPending`, so under
// a skewed clock Chat announced "You're no longer in this church — your access has been removed", which is
// worse than the message the Today card was fixed for. It was also cached to localStorage as the offline
// answer, so it survived the reconnect that would have corrected it. Found by audit, 2026-09-05.
import { stmt } from './test-slice.mjs';
test('an admitted member whose proof was refused is NOT reported as removed', () => {
  const body = stmt(APP, 'const removed = !!(', 'removed');
  const evaluate = (s, wasAdmitted) =>
    new Function('s', 'wasAdmitted', body + ' return removed;')(s, wasAdmitted);

  assert.equal(evaluate({ approval: true, isAdmitted: false, isPending: true, authFailed: true }, true), false,
    'a member this phone has seen admitted, whose relay just refused the proof, is announced as REMOVED ' +
    'from her church — and that verdict is then cached as the offline answer');

  // CONTROLS: the real removal, and the real newcomer, must both still read correctly.
  assert.equal(evaluate({ approval: true, isAdmitted: false, isPending: true, authFailed: false }, true), true,
    'a genuinely removed member is no longer detected, so they are shown the newcomer\'s "a steward will ' +
    'let you in within a day" — for a safeguarding removal that is precisely the wrong message');
  assert.equal(evaluate({ approval: true, isAdmitted: false, isPending: true, authFailed: false }, false), false,
    'a brand-new applicant was reported as removed');
  assert.equal(evaluate({ approval: true, isAdmitted: true, isPending: false, authFailed: false }, true), false,
    'an admitted member was reported as removed');
});
