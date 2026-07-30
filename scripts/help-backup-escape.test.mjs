// A loading screen must always be escapable. Run: node --test scripts/help-backup-escape.test.mjs
//
// AUDIT-2026-07-30 U2. Help → "Back up your recovery phrase" could show a bare spinning ring, with no text and
// no close button, for ever. TWO independent routes into it, and neither is exotic:
//
//   1. `set(arr)` did `setWords(arr); if (arr.length) setCheckN(…)`. For an EMPTY array — which is what
//      `exportMnemonic()` resolves to for any member with a PIN who has not unlocked this session, because
//      secureGet() returns null while locked — `words` becomes `[]` but `checkN` stays 0. The guard is
//      `if (!words || !checkN)`, so it stays true permanently.
//   2. `ID.exportMnemonic().then(…)` had no `.catch()`. On a rejection neither setter runs, `words` stays null,
//      same permanent spinner. Its twin at app/identity-extras.jsx:128 does have one.
//
// And the close button lived ~20 lines BELOW the early return, so it never rendered. Hardware Back escapes on
// Android; nothing on screen said so, and there is no Back on the web.
//
// Reachable from the Help index's "Begin backup" call to action, so this is the screen a member is sent to
// precisely when they are trying to do the one thing that makes their account recoverable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../app/screens-help-main.jsx', import.meta.url), 'utf8');

// The real component's loading gate, lifted so the stuck condition is executed rather than described.
function liftSetter() {
  // Multi-line tolerant. My first version matched a single-line arrow, and the fix made the setter multi-line —
  // so the lift stopped finding it and the tests failed on the harness rather than on the code.
  const m = SRC.match(/const set = \(arr\) => \{[\s\S]*?\n    \};/);
  assert.ok(m, 'the setter is gone or reshaped — re-anchor this test');
  let words = null, checkN = 0, unavailable = '';
  // eslint-disable-next-line no-new-func
  // the real setter closes over the effect's `live` cancellation flag — supply it rather than editing the lift
  const set = new Function('setWords', 'setCheckN', 'setUnavailable', 'Math', 'live', m[0] + '; return set;')(
    (v) => { words = v; }, (v) => { checkN = v; }, (v) => { unavailable = v; }, Math, true);
  // STUCK is the honest invariant: entering the loading gate is fine, being unable to LEAVE it is the bug. The
  // fix does not stop an empty phrase reaching the gate — it makes the gate say why and offer a way out. My
  // first version defined stuck as `!words || !checkN` alone, which asserted the wrong thing.
  return { set, state: () => ({ words, checkN, unavailable, stuck: (!words || !checkN) && !unavailable }) };
}

test('an empty recovery phrase does not leave the screen stuck loading', () => {
  // This is the PIN-locked member's path, and it is the common one.
  const { set, state } = liftSetter();
  set([]);
  const s = state();
  assert.equal(s.stuck, false,
    'words=' + JSON.stringify(s.words) + ' checkN=' + s.checkN + ' unavailable=' + JSON.stringify(s.unavailable) +
    ' — the screen is in the loading gate with no reason set, so it spins for ever with no way out. Any member ' +
    'with a PIN who has not unlocked this session takes this path.');
  assert.equal(s.unavailable, 'locked', 'the empty case must record WHY, so the screen can explain itself');
});

test('a normal phrase still reaches the real screen', () => {
  // Control: if this fails the test above passes for the wrong reason.
  const { set, state } = liftSetter();
  set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']);
  assert.equal(state().stuck, false, 'a genuine 12-word phrase no longer reaches the screen');
  assert.ok(state().checkN >= 1 && state().checkN <= 12, 'the word to confirm is outside the phrase');
});

test('the close control renders in the loading state', () => {
  // The specific defect: an early return that paints a spinner and nothing else.
  const at = SRC.indexOf('if (!words || !checkN)');
  assert.notEqual(at, -1, 'the loading guard is gone — re-anchor this test');
  const block = SRC.slice(at, SRC.indexOf('\n  }', at));
  // It must be escapable while STILL LOADING, not only once a reason is known. My first version accepted
  // /onClose|IconBtn/ anywhere in the gate — which the "unavailable" branch's own Close button satisfied, so
  // deleting the always-visible X sabotaged nothing. Assert the escape appears BEFORE the unavailable branch.
  const spinnerBranch = block.indexOf('!unavailable ?');
  assert.notEqual(spinnerBranch, -1, 're-anchor: the loading/unavailable split is gone');
  const header = block.slice(0, spinnerBranch);
  assert.match(header, /onClick=\{onClose\}/,
    'the still-loading state has no way out — the only escape is inside the branch that needs a reason to have ' +
    'arrived first. A spinner with no close button is the original defect.');
});

test('a rejected exportMnemonic is handled, not swallowed into a permanent spinner', () => {
  // Anchor on the CALL, not on any mention of the name — the explanatory comment above it also says
  // "exportMnemonic()", and indexOf found that first, so this asserted against prose.
  const at = SRC.indexOf('ID.exportMnemonic()');
  assert.notEqual(at, -1, 'the exportMnemonic call is gone');
  const call = SRC.slice(at, at + 320);
  assert.match(call, /\.catch\(/,
    'exportMnemonic() has no .catch(), so a rejection leaves words null and the screen spins for ever. Its twin ' +
    'at app/identity-extras.jsx:128 has one.');
});

test('the member is told WHY, rather than just being let out', () => {
  // Letting them tap X is the minimum. The screen exists to help them back up their account, so a dead end that
  // closes silently is still a dead end — it must say what to do (unlock first).
  assert.match(SRC, /unlock/i,
    'nothing on this screen mentions unlocking, so a PIN-locked member is shown a blank state with no reason ' +
    'and no next step');
});
