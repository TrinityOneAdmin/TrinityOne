// A MEMBER'S PIN IS JUDGED BY WHERE THE ENCRYPTED SEED LANDS, NOT BY WHICH SCREEN THEY CAME THROUGH.
// Run: node --test scripts/one-pin-rule-that-follows-where-the-seed-is-kept.test.mjs
//
// THE DEFECT (2026-09-05 re-verification audit, finding 3). Two screens, two rules:
//
//   app/identity.jsx        setup wizard    6+ characters, placeholder "At least 6 — digits are fine"
//   app/identity-extras.jsx settings sheet  6+ characters, and refused all-numeric under 8
//
// The 8-digit floor exists to resist OFFLINE guessing, and its own comment said so: "the PIN is the ONLY
// secret protecting the at-rest blob (offline-brute-forceable if the device is imaged)". The screen that
// enforced it is the one almost nobody visits; the wizard, which every member passes through, did not.
//
// OWNER DECISION 2026-09-05 (reference/DOMAIN.md): 8 digits is not the right answer for a phone. Offline
// guessing needs a copy of the blob, and src/identity.src.js:594 puts it in the hardware-backed store on
// native, leaving only {v,native,pub} — a pubkey, no secret — in localStorage. On web/desktop (:606) the
// whole blob is in localStorage and a million combinations is minutes. So the rule follows the storage.
//
// Provisional: revisit after the September 2026 pilot. Do not "fix" the phone rule back to 8 as an
// inconsistency — it is a decision, and DOMAIN.md records why.
//
// LIFTED FROM THE SHIPPED BUNDLE. vendor/identity.js is what the app loads; a test against a re-typed copy
// of the rule would pass while the real one drifted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/identity.js', import.meta.url), 'utf8');

const body = stripComments(fnBody(VENDOR, 'function pinRuleError(pin, native)', 'pinRuleError'));
// The two floors are separate consts in the bundle. READ THE SHIPPED VALUES rather than re-typing them —
// a hard-coded 6 and 8 here would keep passing after someone changed the real ones.
const constFrom = (name) => {
  const m = VENDOR.match(new RegExp(name + ' = (\\d+)'));
  assert.ok(m, `${name} is gone from the bundle — re-anchor this test rather than inlining a number`);
  return Number(m[1]);
};
const PIN_MIN = constFrom('PIN_MIN');
const PIN_MIN_NUMERIC_SOFT = constFrom('PIN_MIN_NUMERIC_SOFT');
assert.equal(PIN_MIN, 6, 'the phone floor moved — DOMAIN.md records 6 as the owner\'s decision');
assert.equal(PIN_MIN_NUMERIC_SOFT, 8, 'the web all-numeric floor moved');
// isNative is only consulted when the caller does not say; every case below is explicit, so a stub here
// cannot answer the question the test is named after.
const pinRuleError = new Function('isNative', 'PIN_MIN', 'PIN_MIN_NUMERIC_SOFT', body + '\nreturn pinRuleError;')(
  () => { throw new Error('isNative consulted despite an explicit platform'); }, PIN_MIN, PIN_MIN_NUMERIC_SOFT);

const ok = (pin, native) => assert.equal(pinRuleError(pin, native), '', `${pin} on ${native ? 'a phone' : 'web'} was refused: ${pinRuleError(pin, native)}`);
const no = (pin, native, why) => assert.notEqual(pinRuleError(pin, native), '', why);

test('on a phone, six digits is enough', () => {
  ok('123456', true);
  ok('918273', true);
  // The whole point of the owner's decision: a PIN typed several times a day must not be so long that
  // members turn protection off altogether, which is strictly worse than six digits behind a secure store.
  ok('abcdef', true);
});

test('on a phone, five characters is still too few', () => {
  no('12345', true, 'a 5-character PIN was accepted — the floor is gone entirely');
  no('', true, 'an empty PIN was accepted');
});

test('on web, an all-numeric PIN under eight is refused', () => {
  // No secure store: the encrypted seed is in localStorage, so the guesser has the file.
  no('123456', false, 'THE DEFECT: six digits accepted where the blob can be copied and guessed offline');
  no('1234567', false, 'seven digits accepted on web');
  ok('12345678', false);
});

test('on web, letters buy back the length', () => {
  ok('abc123', false);
  ok('trinity', false);
});

test('the DEFAULT branch — the one both screens actually use — asks the platform', () => {
  // THE GAP THE AUDIT OF bff954f FOUND. Both callers pass one argument: ID.pinRuleError(pin). So `native` is
  // undefined in production and the real function falls through to isNative() — the exact branch every case
  // above skipped by passing the platform explicitly. Sabotaging `: isNative()` to `: true` (giving web
  // users the phone rule) left all five of those green. This drives the real isNative from the bundle.
  const nat = stripComments(fnBody(VENDOR, 'function isNative()', 'isNative'));
  const make = (capacitor) => new Function('window', 'PIN_MIN', 'PIN_MIN_NUMERIC_SOFT',
    nat + '\n' + body + '\nreturn pinRuleError;')({ Capacitor: capacitor }, PIN_MIN, PIN_MIN_NUMERIC_SOFT);

  const onPhone = make({ isNativePlatform: () => true });
  assert.equal(onPhone('123456'), '', 'a phone refused six digits through the default branch');

  const onWeb = make(undefined);   // no Capacitor at all: a browser
  assert.notEqual(onWeb('123456'), '',
    'THE DEFECT: with no platform argument a browser got the phone rule, so six digits guards a blob that ' +
    'sits in localStorage and can be guessed offline');
  assert.equal(onWeb('12345678'), '');

  // Capacitor present but reporting web (the desktop build loads it and answers false).
  const onDesktop = make({ isNativePlatform: () => false });
  assert.notEqual(onDesktop('123456'), '', 'the desktop build got the phone rule');
});

test('the two screens no longer carry their own competing rules', () => {
  // app/*.jsx ships UNBUNDLED, so a text assertion there cannot prove behaviour (CLAUDE.md rule 3) — a
  // disabled branch keeps every word. What it CAN prove is absence: the old hard-coded literals are gone,
  // so there is no second rule left in the file to drift from this one. The positive claim — that each
  // screen calls pinRuleError — is proved on the device, not here.
  const wiz = readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8');
  const set = readFileSync(new URL('../app/identity-extras.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(wiz, /Use at least 6 digits/, 'the wizard still carries its own PIN rule');
  assert.doesNotMatch(set, /An all-number PIN is easy to guess/, 'the settings sheet still carries its own PIN rule');
});
