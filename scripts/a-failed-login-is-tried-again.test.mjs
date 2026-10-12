// A FAILED LOGIN DOES NOT STICK — round 3e (audit of b102dc6, the "delegate stall").
//
// nostr-tools keeps relay.authPromise for the life of a connection — a REJECTED one too — and answers every later AUTH
// challenge with it, so once one login got no OK ("auth timed out") the socket never signed in again and every private
// read on it waited for ever. Measured in console-keys-follow-the-church-switch: the relay (then) silently dropped the
// AUTH inside a burst of 100+ requests, and 60+ later challenges on the same connection were never answered.
// The console's signer glue (pool.automaticallyAuth, vendor/steward.js) now clears a failed login, and tries a TIMED-OUT
// one again at once — once per challenge. A refusal (OK false) is cleared but not retried until the relay challenges
// again. Lifted from the shipped bundle and run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { stmt } from './test-slice.mjs';

const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const GLUE = stmt(BUNDLE, 'pool.automaticallyAuth = (url) => async (authEvent) => {', 'pool.automaticallyAuth in the shipped bundle');
const FIN = (GLUE.match(/const signed = (finalizeEvent\d*)\(authEvent, sk\)/) || [])[1];
const NORM = (GLUE.match(/k = (normalizeURL\d*)\(url\)/) || [])[1];
assert.ok(FIN && NORM, 're-anchor: the signer glue no longer signs with finalizeEvent / normalises with normalizeURL');
const flush = () => new Promise(r => setTimeout(r, 10));
const URL_ = 'wss://relay.example/relay';

function rig() {
  const r = { publishTimeout: 4400, challenge: 'ch-1', connected: true, onauth: null, authCalls: 0, authPromise: null };
  r.auth = (fn) => { r.authCalls++; r.authPromise = new Promise(() => {}); return r.authPromise; };   // a fresh login, in flight
  const accepted = new Map();
  const scope = {
    sk: generateSecretKey(), pool: { relays: new Map([[URL_, r]]) }, _authedRelays: new Map(), _authAccepted: accepted,
    _runKeyReadAuthWaiters: () => {}, [FIN]: (e) => ({ ...e, id: 'x' }), [NORM]: (u) => u, setTimeout, console,
  };
  const install = new Function('scope', `with (scope) { ${GLUE}\n return pool.automaticallyAuth; }`)(scope);
  r.onauth = install(URL_);
  return { r, accepted };
}
async function failWith(r, message) {
  const p = Promise.reject(new Error(message)); p.catch(() => {});
  r.authPromise = p;                                // what nostr-tools' auth() holds while the signer runs
  await r.onauth({ kind: 22242, created_at: 1, tags: [], content: '' });
  await flush(); await flush();
}

test('a login that TIMED OUT is cleared and tried again at once — and only once for the same challenge', async () => {
  const { r } = rig();
  await failWith(r, 'auth timed out');
  assert.equal(r.authCalls, 1, 'A TIMED-OUT LOGIN WAS NOT TRIED AGAIN — nostr-tools would answer every later challenge with the cached failure, and the socket never signs in');
  // the retry times out too, on the SAME challenge: no third attempt (the relay will challenge again on the next read)
  await failWith(r, 'auth timed out');
  assert.equal(r.authCalls, 1, 'a login was retried twice for one challenge — a tight loop against a relay that is not answering');
  assert.equal(r.authPromise, undefined, 'the second failure was left cached — the next challenge would be answered with it');
  // a NEW challenge gets its retry
  r.challenge = 'ch-2';
  await failWith(r, 'auth timed out');
  assert.equal(r.authCalls, 2, 'a timed-out login on a NEW challenge was not tried again');
});

test('a login the relay REFUSED is cleared (so the next challenge is answered) but not retried at once', async () => {
  const { r } = rig();
  await failWith(r, 'auth-failed: bad challenge or signature');
  assert.equal(r.authPromise, undefined, 'A REFUSED LOGIN STAYED CACHED — nostr-tools would answer every later challenge with it');
  assert.equal(r.authCalls, 0, 'a refused login was retried at once — the same frame would be refused again');
});
