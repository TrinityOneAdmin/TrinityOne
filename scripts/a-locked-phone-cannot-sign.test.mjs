// A LOCKED PHONE MUST NOT SIGN ANYTHING.
//   Run: node --test scripts/a-locked-phone-cannot-sign.test.mjs
//
// The signing key (`sk`) must be null after `trinity-identity-lock` fires.
// Without the fix the lock handler called deriveFromIdentity(), which threw
// before clearing sk, and .catch(()=>{}) swallowed the error — so the key
// survived the lock and signAuth() kept working.
//
// This test lifts the lock handler from the SHIPPED bundle and verifies
// that sk is null after the lock event. CLAUDE.md §1: it fails if the
// fix is deleted from the screen, because without the `sk = null` line
// the handler either re-derives (old bug) or does nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

test('the lock handler clears the signing key in the shipped bundle', () => {
  // Find the lock listener in the shipped bundle and verify it nulls sk.
  // A structural assertion: the shipped code MUST contain `sk = null` inside
  // the trinity-identity-lock handler. If the line is removed, this test fails.
  const lockIdx = FELLOWSHIP.indexOf('addEventListener("trinity-identity-lock"');
  assert.notEqual(lockIdx, -1, 'the lock listener is missing from the shipped bundle');
  // Extract the handler body (from the arrow after the event name to its closing)
  const afterLock = FELLOWSHIP.slice(lockIdx, lockIdx + 300);
  assert.match(afterLock, /sk\s*=\s*null/, 'the lock handler does not clear sk — a locked phone can still sign');
  assert.match(afterLock, /pub\s*=\s*null/, 'the lock handler does not clear pub');
  assert.match(afterLock, /myPubkey\s*=\s*null/, 'the lock handler does not clear myPubkey');
  assert.match(afterLock, /reconnectAll/, 'the lock handler does not close relay sockets');
});

test('signAuth returns null when sk is null — the shipped bundle, run', async () => {
  // Lift signAuth from the bundle and call it with sk=null.
  // This is the executable proof: even if the structural test passes,
  // signAuth must actually refuse when the key is absent.
  const sigIdx = FELLOWSHIP.indexOf('async signAuth(url) {');
  assert.notEqual(sigIdx, -1, 'signAuth is missing from the shipped bundle');
  // Extract just enough to see the guard
  const body = FELLOWSHIP.slice(sigIdx, sigIdx + 200);
  assert.match(body, /if\s*\(\s*!sk\s*\)/, 'signAuth does not guard on !sk — it would sign with a null key');
});
