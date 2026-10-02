// NETWORK RECOVERY WORDS ARE SEALED TO THE CHURCH KEY (S-1).
//   Run: node --test scripts/network-keys-sealed-to-church-key.test.mjs
//
// THE DEFECT. Network recovery words (mnemonics) were stored in plaintext in steward localStorage.
// An adversary who images the steward device's storage (the UK pilot's threat model: lawful
// compulsion + seizure) recovers every network mnemonic without needing the PIN.
//
// THE FIX. saveNetKey seals the mnemonic field with NIP-44 using churchSk. netKeys() decrypts it
// when the church key is in memory (unlocked console). lock() clears churchSk so sealed mnemonics
// cannot be read from a locked console. _migrateNetKeysToSealed re-encrypts plaintext mnemonics
// on unlock.
//
// Callers of saveNetKey: createNetwork (x2), profile-update handler in subscribeDelegatedChurches.
// Callers of netKeys: saveNetKey (filter), setActiveIdentity, ownedNetworks, allIdentities (x2),
// switchIdentity, subscribeDelegatedChurches (x2), profile-update handler.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

test('saveNetKey in the bundle seals the mnemonic with churchSk', () => {
  const fn = fnBody(STEWARD, 'function saveNetKey(rec)', 'saveNetKey');
  assert.match(fn, /sealedMnemonic/,
    'saveNetKey no longer writes a sealedMnemonic field — network recovery words are stored in plaintext');
  assert.match(fn, /nip44e|encrypt/,
    'saveNetKey does not encrypt the mnemonic — the seal is structural but not cryptographic');
  assert.match(fn, /churchSk/,
    'saveNetKey does not use churchSk — the mnemonic is sealed to the wrong key');
});

test('netKeys in the bundle decrypts sealedMnemonic with churchSk', () => {
  const fn = fnBody(STEWARD, 'function netKeys()', 'netKeys');
  assert.match(fn, /sealedMnemonic/,
    'netKeys does not read sealedMnemonic — sealed network keys are invisible to the console');
  assert.match(fn, /nip44d|decrypt/,
    'netKeys does not decrypt — sealed mnemonics are returned as ciphertext');
  assert.match(fn, /churchSk/,
    'netKeys does not use churchSk — decryption uses the wrong key');
});

test('lock clears churchSk so sealed mnemonics cannot be decrypted', () => {
  const fn = fnBody(STEWARD, 'lock()', 'lock');
  assert.match(fn, /churchSk\s*=\s*null/,
    'lock() does not clear churchSk — a locked console can still decrypt sealed network mnemonics');
});

test('setKey calls _migrateNetKeysToSealed to re-encrypt plaintext mnemonics', () => {
  const fn = fnBody(STEWARD, 'function setKey(mnemonic)', 'setKey');
  assert.match(fn, /_migrateNetKeysToSealed/,
    'setKey does not call _migrateNetKeysToSealed — plaintext mnemonics from before the fix stay in plaintext for ever');
});

test('_migrateNetKeysToSealed re-encrypts only plaintext records', () => {
  const fn = fnBody(STEWARD, 'function _migrateNetKeysToSealed()', '_migrateNetKeysToSealed');
  assert.match(fn, /\.mnemonic/,
    '_migrateNetKeysToSealed does not read the mnemonic field — it cannot find plaintext records');
  assert.match(fn, /sealedMnemonic/,
    '_migrateNetKeysToSealed does not write sealedMnemonic — it does not actually seal anything');
  assert.match(fn, /churchSk/,
    '_migrateNetKeysToSealed does not use churchSk — the migration seals to the wrong key');
});
