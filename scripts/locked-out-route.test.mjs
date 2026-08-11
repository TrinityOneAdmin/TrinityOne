// A MEMBER WITH NO 12 WORDS MUST HAVE SOMETHING TO SHOW A STEWARD.
// Run: node --test scripts/locked-out-route.test.mjs
//
// THE DEFECT (user-flow audit, confirmed). "Forgot your PIN?" on the lock screen says:
//
//     "Don't have them? Don't uninstall — that erases this account for good. Ask a steward instead: they can
//      put you back in your place under a new key."
//
// That is the only instruction on the screen, and it was impossible to follow. The steward's re-seat needs
// the member's account code, and the screen showing it lived inside the restore wizard — which opens from the
// You sheet, which the lock gate hides. So the member was told to ask a steward, told (correctly) not to
// uninstall, and handed nothing to act on. They were stuck on a lock screen with a Bible.
//
// It is fixable because the account IS knowable while locked: PUB_KEY survives the lock wipe deliberately,
// and is the same reference used to check a typed recovery phrase. Showing it is a public key — it discloses
// nothing that connecting to a relay would not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ID = readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8');
const SRC = readFileSync(new URL('../src/identity.src.js', import.meta.url), 'utf8');
const VENDOR = readFileSync(new URL('../vendor/identity.js', import.meta.url), 'utf8');

const gate = (() => {
  const at = ID.indexOf('function PinUnlockGate(');
  return ID.slice(at, ID.indexOf('\nwindow.PinUnlockGate', at));
})();

test('the engine can name the account while the app is locked', () => {
  assert.match(SRC, /lockedNpub\(\)/,
    'nothing exposes the account while locked, so the lock screen cannot show a steward anything');
  const at = SRC.indexOf('lockedNpub() {');
  const body = SRC.slice(at, SRC.indexOf('\n    },', at));
  assert.match(body, /_recoveryReference\(\)/,
    'lockedNpub reads something other than the reference that survives a locked boot — it will be empty ' +
    'exactly when it is needed');
  assert.match(body, /return '';/, 'a device with no reference must answer empty, not throw or guess');
});

test('the lock screen shows the code, not just advice about it', () => {
  assert.match(gate, /lockedNpub\(\)/, 'the lock screen never asks for the account code');
  assert.match(gate, /trinityone-reseat:/,
    'the code is not offered in the form the steward scans — a bare npub is not what their scanner expects');
  assert.match(gate, /qrSVG\(/, 'no QR is drawn, so the member must read out a 63-character string');
  assert.match(gate, /Copy the code/, 'there is no way to send it to a steward who is not in the room');
  // …and it must actually be REACHABLE. Every assertion above is satisfied by this markup sitting inside a
  // branch that never renders — the trap this repo has been caught by before, where a guard passes on text
  // that is present but dead. The panel has to be gated on the code existing, and nothing else.
  assert.match(gate, /\{lockedCode \? \(/,
    'the panel is rendered behind a condition that is not "do we have the code" — if that is a constant, ' +
    'every check above still passes while the member sees nothing at all');
});

test('a phone that cannot name the account says so instead of showing nothing', () => {
  assert.match(gate, /can’t show your account code/,
    'on a device locked before it recorded which account it holds, the panel shows an empty box and no ' +
    'explanation — which is the original dead end with extra steps');
});

test('the advice and the way out are on the same screen', () => {
  const advice = gate.indexOf('Ask a steward instead');
  const route = gate.indexOf('Show this to a steward');
  assert.ok(advice !== -1 && route !== -1 && route > advice,
    'the instruction and the thing it asks for are not together. Splitting them is what made this a dead ' +
    'end: the advice was on the lock screen and the code was behind the lock');
});

test('the shipped bundle carries it', () => {
  assert.match(VENDOR, /lockedNpub/, 'vendor/identity.js predates this — run npm run build:bundles');
});
