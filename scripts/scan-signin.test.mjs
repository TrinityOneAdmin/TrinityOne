// Scan-to-sign-in: the third way back, and the one the product already promised.
// Run: node --test scripts/scan-signin.test.mjs
//
// AUDIT-2026-07-28. Creating a child account tells the parent to point the child's phone at a code — and
// nothing could consume it. A fresh install's only scanner belonged to device TRANSFER, which needs a live
// mutually-verified exchange with another RUNNING phone, so the child's phone sat showing its own code
// waiting for a partner that never came. The same gap stopped anyone restoring onto a phone that already had
// an identity: the 12-word route exists only in first-launch onboarding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ID = readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8');
// lift the real parser and run it
const seedFromScan = (() => {
  const at = ID.indexOf('const seedFromScan =');
  assert.notEqual(at, -1, 'the scan parser is gone');
  const end = ID.indexOf('\n  const doScanSignIn', at);
  return new Function(ID.slice(at, end) + '\nreturn seedFromScan;')();
})();

const PHRASE = 'ridge lunar absent gospel timber olive candle harvest meadow bishop anchor kindle';

test('it reads the seed out of a real invite link', () => {
  const url = 'https://app.trinityone.church/?follow=npub1abc&relay=wss%3A%2F%2Fx%2Frelay#invite=' + encodeURIComponent(PHRASE);
  assert.equal(seedFromScan(url), PHRASE);
});

test('it accepts a bare 12-word phrase', () => {
  assert.equal(seedFromScan('  ' + PHRASE.toUpperCase() + '  '), PHRASE, 'case and padding should not matter');
});

test('it refuses anything it does not recognise', () => {
  // A QR is scanned from across a room by whoever holds the camera. Guessing at an unrecognised payload is
  // how someone ends up adopting a key a stranger showed them.
  for (const junk of [
    'https://app.trinityone.church/?follow=npub1abc',      // a church JOIN link — no seed, must not be treated as one
    'https://evil.example/#invite=not-a-phrase',           // wrong word count
    'ridge lunar absent',                                  // too few words
    (PHRASE + ' extra'),                                   // too many
    'nostr:npub1abc', 'https://example.com', '', '   ', '{"a":1}',
  ]) {
    assert.equal(seedFromScan(junk), '', 'accepted a payload it should have refused: ' + junk.slice(0, 40));
  }
});

test('an older ?invite= link still works', () => {
  const url = 'https://app.trinityone.church/?invite=' + encodeURIComponent(PHRASE);
  assert.equal(seedFromScan(url), PHRASE, 'links shared before the seed moved into the fragment must still work');
});

test('scanning does not count as proving you have your phrase', () => {
  // Only the typed-words route earns dismissal of the backup nudge — a member who scanned has never seen
  // their 12 words, and silencing the one warning that matters for them would be the worst outcome.
  const at = ID.indexOf('const doScanSignIn');
  const fn = ID.slice(at, at + 1400);
  assert.match(fn, /rTypedWords\.current = false/, 'the scan route claims the member has their phrase');
});

test('it warns before replacing an account that has churches', () => {
  const at = ID.indexOf('const doScanSignIn');
  const fn = ID.slice(at, at + 1400);
  assert.match(fn, /followedChurches/, 'it does not check whether an account is already set up here');
  // Assert the LIVE guard, not merely that the words appear: `if (false && !window.confirm(...))` kept an
  // earlier version of this test green while replacing an account without asking. A test that survives its
  // own sabotage is worse than none.
  assert.match(fn, /if \(existing\.length && !window\.confirm\(/,
    'the confirmation is not actually gating the replacement');
  const guard = fn.indexOf('followedChurches'), imp = fn.indexOf('importMnemonic');
  assert.ok(guard < imp, 'the warning must come BEFORE the identity is replaced');
});

test('the route is reachable from the restore fork', () => {
  assert.match(ID, /Someone set this up for me/, 'nothing offers the scan, so the child still cannot get in');
  assert.match(ID, /rMode === 'scan'/, 'the scanner screen is missing');
  assert.match(ID, /<QRScanner onResult=\{doScanSignIn\}/, 'the scanner is not wired to the handler');
  assert.match(ID, /onManual=\{doScanSignIn\}/, 'no manual fallback — a phone with no camera has no way in');
});
