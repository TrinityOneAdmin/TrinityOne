// The lock screen must UNLOCK an account, never replace or remove one.
// Run: node --test scripts/lock-screen-no-bypass.test.mjs
//
// Adversarial review 2026-08-05, CRITICAL. The "Forgot your PIN? type your 12 words" route called
// importMnemonic, which does `await clearEnc()` BEFORE storing anything. Two consequences on that screen:
//
//   1. LOCK BYPASS. The lock is armed by the mere PRESENCE of the encrypted blob — app/app.jsx's lockNow is
//      `hasEnc() && !sessionMnemonic`. clearEnc() deletes that blob, so the lock did not open, it CEASED TO
//      EXIST. Any valid BIP-39 phrase — including the well-known all-"abandon" test vector — walked past a
//      locked, seized phone and reached the notes, journal, prayer list and outbox that clearCommunityCache
//      deliberately preserves. Under this product's threat model the PIN was the only barrier to that data.
//   2. SILENT ACCOUNT DESTRUCTION. A member typing a valid phrase that was not theirs destroyed the account
//      they were trying to open, before anything was verified, under copy reading "nothing else is lost".
//
// The same action is guarded by a confirm in three other call sites, one annotated "fixed in ONE of the two
// copies" — this was the fourth, and the only unguarded one, on the screen where the stakes are highest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const ID = readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8');
const SRC = readFileSync(new URL('../src/identity.src.js', import.meta.url), 'utf8');
const VENDOR = readFileSync(new URL('../vendor/identity.js', import.meta.url), 'utf8');
const stripComments = (t) => t.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

test('the lock screen never calls the REPLACE path', () => {
  const at = ID.indexOf('function PinUnlockGate');
  assert.notEqual(at, -1, 'PinUnlockGate moved — re-anchor');
  const gate = stripComments(fnBody(ID, ID.indexOf(') {', at), 'PinUnlockGate body'));
  assert.ok(!/importMnemonic\(/.test(gate),
    'the lock screen calls importMnemonic, which deletes the stored key before checking anything — that ' +
    'destroys a wrong-but-valid typist\'s account AND removes the lock for anyone holding the phone');
  assert.match(gate, /unlockWithMnemonic\(/, 'the lock screen must use the unlock-only path');
});

test('unlockWithMnemonic refuses a phrase that is not this account’s', () => {
  const fn = stripComments(fnBody(SRC, 'async unlockWithMnemonic', 'unlockWithMnemonic'));
  assert.match(fn, /whoseMnemonic\(/, 'it no longer checks whose words these are');
  assert.match(fn, /!==\s*'match'/, 'it no longer refuses on anything but a match');
  // The refusal MUST come before any call that mutates storage.
  const check = fn.indexOf('whoseMnemonic('), mutate = fn.indexOf('importMnemonic(');
  assert.ok(check !== -1 && mutate !== -1 && check < mutate,
    'the ownership check must precede the replace — checking after the deletion is not checking');
});

test('an unknown owner is treated as NOT this account', () => {
  const fn = stripComments(fnBody(SRC, '  whoseMnemonic(words)', 'whoseMnemonic'));
  assert.match(fn, /if \(!have\) return 'unknown'/,
    'with no stored public key it must say so rather than guess — and unlockWithMnemonic refuses anything ' +
    'that is not an exact match, so "unknown" fails closed');
});

test('the public key is recorded so a LOCKED phone can make that check', () => {
  const fn = stripComments(fnBody(SRC, 'function apply(profile, meta)', 'apply'));
  assert.match(fn, /setItem\(PUB_KEY/,
    'nothing records which account is on this device, so a locked screen cannot tell "let me back in" from ' +
    '"replace this account" — which is what made the bypass possible');
  assert.match(VENDOR, /trinityone\.nostr\.pub/, 'the shipped bundle does not carry the public-key marker');
});
