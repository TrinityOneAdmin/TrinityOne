// THE PUSH-TOKEN DOC BINDS THE MEMBER'S OWN PUBKEY TO THE DEVICE TOKEN, VERIFIABLY (reference/SCOPE-notifications.md §15).
// Run: node --test scripts/the-push-token-doc-binds-the-members-own-pubkey.test.mjs
//
// The relay-side registry (Linux) admits a pushtoken doc only if verifyEvent passes AND the author is the <pub> in
// the d-suffix — so a member cannot register a token under someone else's key. This lifts the REAL _buildPushTokenEvent
// from fellowship.src.js, SIGNS it with a throwaway key, and checks the round-trip: valid signature, d =
// trinityone/pushtoken:<author>, a self p-tag for the hook's lookup, and a contentless CLEARTEXT body
// {token, platform:ios, env, ts} with the token lowercased. (An APNs token is a routing handle, not a secret.)
// Delete the d-tag line and the author/d-suffix equality fails; drop the lowercase and the token assert fails.
//
// Callers of the lifted code (rule 2): _buildPushTokenEvent -> Fellowship.publishPushToken (fellowship.src.js) + this test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';
import { finalizeEvent, verifyEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';

const SRC = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
// Lift the object-method as a standalone function (prepend `function`; NET + JSON are its only free names).
const build = new Function('NET', 'function ' + fnBody(SRC, '_buildPushTokenEvent({ pub, token, env, ts }) {', '_buildPushTokenEvent') + '\nreturn _buildPushTokenEvent;')('trinityone');

test('a signed pushtoken doc verifies and binds the author to their own token', () => {
  const sk = generateSecretKey();
  const pub = getPublicKey(sk);
  const tpl = build({ pub, token: 'AABBCCDD11223344', env: 'production' });
  assert.equal(tpl.kind, 30078, 'must be the kind-30078 app-data the relay 30078 branch gates');
  const evt = finalizeEvent(tpl, sk);
  assert.equal(verifyEvent(evt), true, 'the relay verifies every event before storing it');
  const d = (evt.tags.find(t => t[0] === 'd') || [])[1];
  assert.equal(d, 'trinityone/pushtoken:' + evt.pubkey, 'the d-suffix MUST be the signing member — a spoofed binding then fails verify');
  assert.ok(evt.tags.some(t => t[0] === 'p' && t[1] === evt.pubkey), 'a self p-tag, for the ingest hook lookup');
  const body = JSON.parse(evt.content);
  assert.equal(body.platform, 'ios');
  assert.equal(body.env, 'production');
  assert.equal(body.token, 'aabbccdd11223344', 'the token is stored lowercase hex');
  assert.equal(typeof body.ts, 'number');
  assert.equal(body.ts, tpl.created_at, 'the body ts matches created_at (one clock)');
});

test('env is production unless sandbox is explicitly asked (a debug/TestFlight build)', () => {
  const sk = generateSecretKey(); const pub = getPublicKey(sk);
  assert.equal(JSON.parse(build({ pub, token: 'deadbeef', env: 'sandbox' }).content).env, 'sandbox');
  assert.equal(JSON.parse(build({ pub, token: 'deadbeef' }).content).env, 'production', 'no env ⇒ production');
  assert.equal(JSON.parse(build({ pub, token: 'deadbeef', env: 'weird' }).content).env, 'production', 'an unknown env is never trusted');
});
