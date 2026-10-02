// "I'm covered" must not reveal who is being helped.
// Run: node --test scripts/care-skip-hides-recipient.test.mjs
//
// When a recipient taps "I'm covered" on a sealed need, the skip event must be signed
// by a throwaway key derived from the skip secret, NOT the member's own key. The relay
// then holds no link between the recipient's identity and the care need. The same
// derivation on "Undo" means it replaces the same document and is accepted by the gateway.
//
// This test drives the SHIPPED bundle (vendor/fellowship.js) so it fails if the throwaway
// key derivation is removed. It also tests the structural property: both markCareSkip and
// clearCareSkip contain the derivation string, and both use `signingKey` (not raw `sk`)
// for the finalizeEvent call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const FELLOW = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

test('markCareSkip derives a throwaway signing key for sealed needs', () => {
  const body = fnBody(FELLOW, 'async markCareSkip(', 'markCareSkip');
  assert.match(body, /careskip-signer:/,
    'markCareSkip does not derive a throwaway signing key — the recipient\'s own pubkey appears on the skip event');
  assert.match(body, /let signingKey/,
    'markCareSkip does not use a separate signingKey variable — it signs everything with the member\'s key');
  assert.match(body, /}, signingKey\)/,
    'markCareSkip passes sk, not signingKey, to finalizeEvent — the throwaway key is derived but not used');
});

test('clearCareSkip derives the same throwaway key and sends skiptok', () => {
  const body = fnBody(FELLOW, 'async clearCareSkip(', 'clearCareSkip');
  assert.match(body, /careskip-signer:/,
    'clearCareSkip does not derive a throwaway key — Undo is signed with the recipient\'s key, which the relay refuses');
  assert.match(body, /skiptok/,
    'clearCareSkip does not send a skiptok — the relay refuses the Undo');
  assert.match(body, /}, signingKey\)/,
    'clearCareSkip passes sk, not signingKey, to finalizeEvent');
});

test('clearCareSkip accepts skipEnc and needAuthor parameters', () => {
  const body = fnBody(FELLOW, 'async clearCareSkip(', 'clearCareSkip');
  assert.match(body, /skipEnc/,
    'clearCareSkip does not accept skipEnc — it cannot derive the throwaway key');
  assert.match(body, /needAuthor/,
    'clearCareSkip does not accept needAuthor — it cannot unseal a delegated steward\'s need');
});

test('the Undo button passes skipEnc and the need author', () => {
  const jsx = readFileSync(new URL('../app/screens-today.jsx', import.meta.url), 'utf8');
  assert.match(jsx, /clearSkip\([^)]*_skipEnc/,
    'the Undo button does not pass _skipEnc to clearSkip — the throwaway key cannot be derived');
  assert.match(jsx, /clearSkip\([^)]*_by\)/,
    'the Undo button does not pass _by to clearSkip — a delegated steward\'s need cannot be unsealed');
});
