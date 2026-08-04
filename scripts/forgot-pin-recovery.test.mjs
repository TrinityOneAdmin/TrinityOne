// A forgotten PIN must never be a dead end, and must never be answered with "reinstall".
// Run: node --test scripts/forgot-pin-recovery.test.mjs
//
// UX audit 2026-08-04, found independently by two reviewers. The member's lock screen said:
//   "Your PIN can't be reset — not even by us. If you've forgotten it, reinstall the app and restore your
//    account with your 12 words."
// With allowBackup=false a reinstall is a clean wipe, so following that advice destroys every note, journal
// entry and highlight — to recover a key that was never trapped in the first place. The engine states the
// design in its own comment: "RECOVERY ALWAYS WINS: importing clears any community-PIN lock … so a forgotten
// PIN can NEVER trap the key." importMnemonic was the answer all along; the screen just never offered it, and
// the route to it (the profile sheet) is disabled while locked.
//
// The steward console fixed exactly this on 2026-07-30 and ships the pattern in StewardUnlock. This is the
// member-side twin.
//
// STRUCTURAL: PinUnlockGate is a component in a classic-script JSX file with no DOM harness here. Verified to
// FAIL against main.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const ID = readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8');
// Anchor PAST the destructured parameter list. `fnBody` brace-matches from the first `{` it finds, and for
// `function PinUnlockGate({ onUnlocked, onReadBible }) {` that is the PARAMS — so anchoring on the name alone
// silently returns the argument list and every assertion below reads ten characters. This test was written
// that way first and passed against both the fixed and the broken code, which is the whole reason the repo
// keeps a guard for fixed-width windows.
const _at = ID.indexOf('function PinUnlockGate');
assert.notEqual(_at, -1, 'PinUnlockGate is gone — re-anchor this test');
const gate = fnBody(ID, ID.indexOf(') {', _at), 'PinUnlockGate body');

test('the lock screen never tells the member to reinstall', () => {
  // Comments stripped: the code's own note explains what the old copy said, and an assertion that trips on its
  // own rationale punishes documenting the bug.
  const code = gate.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  assert.ok(!/reinstall/i.test(code),
    'the lock screen advises reinstalling. allowBackup=false makes that a clean wipe — it destroys the ' +
    'member\'s notes, journal and highlights to recover a key importMnemonic would have unlocked in place.');
});

test('the lock screen offers the 12 words, in place', () => {
  assert.match(gate, /importMnemonic\(/,
    'PinUnlockGate no longer offers recovery by phrase, so a forgotten PIN is a dead end on the one screen ' +
    'where the member is stuck — while the engine guarantees the key is not trapped');
  assert.match(gate, /<textarea/, 'there is nowhere to type the phrase');
  // A successful recovery must not leave the escalating lockout armed against the member who just proved
  // ownership — otherwise they recover and are immediately told to wait an hour.
  assert.match(gate, /removeItem\(PIN_GUARD_KEY\)/,
    'recovering by phrase leaves the failed-attempt lockout in place');
});

test('and the phrase field is not sabotaged by the keyboard', () => {
  // A BIP-39 phrase typed with autocorrect and sentence-case on is actively hostile: the member types the
  // right words and is told they are wrong.
  for (const attr of ['autoCapitalize="none"', 'autoCorrect="off"', 'spellCheck={false}']) {
    assert.ok(gate.includes(attr), 'the recovery-phrase field is missing ' + attr);
  }
});

test('someone without their words is warned OFF the destructive action', () => {
  assert.match(gate, /Don’t uninstall|Don't uninstall/,
    'the member with no phrase is given no warning that uninstalling ends the account — which is exactly ' +
    'what the old copy told them to do');
});
