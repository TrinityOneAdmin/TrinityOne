// A FOCUSED INPUT ON A SHORT iPHONE MUST SCROLL ABOVE THE KEYBOARD.
// Run: node --test scripts/the-recovery-word-check-scrolls-above-the-keyboard.test.mjs
//
// THE DEFECT THIS CLOSES (pilot report, small iPhone, 2026-11). The signup wizard (IdentityOnboarding,
// app/identity.jsx) is a fixed, full-height sheet and WKWebView does not resize it when the iOS keyboard
// opens (no @capacitor/keyboard plugin). So on a short viewport the bottom-ward inputs — the 3rd
// recovery-word box in the "Quick check" step, and the "Confirm your PIN" box — sit behind the keyboard
// with no cue, and the member cannot see what they type. The step-0 name field already fixed this with an
// onFocus handler that scrolls the focused field to the centre of the scroll area; the same handler is now a
// shared `scrollFocusCenter` wired onto the word-check and PIN inputs.
//
// WHY NOT TEXT-MATCH app/*.jsx FOR BEHAVIOUR (house rule 3). Those files ship unbundled, so dead code is not
// stripped and a text assertion on *behaviour* can pass over a disabled feature. Part A therefore LIFTS the
// real handler out of the source and RUNS it. Part B is a point-of-use wiring check: it asserts each target
// input carries `onFocus={scrollFocusCenter}`. That is a JSX prop, not a `cond && …` that `false &&` can
// hollow out while leaving the words — deleting the feature deletes the attribute, so this goes red (rule 1).
// The absolute ground truth — the box actually clears the keyboard on a small iPhone — is the device test;
// that cannot be done from a worktree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const ID = readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8');

// ── Lift the real handler and run it. Single-line paren-less arrow, so slice the whole const statement
//    (anchor → its terminating `};`) and hand it to new Function, which returns the function itself.
function liftScrollFocusCenter() {
  const at = ID.indexOf('const scrollFocusCenter =');
  assert.notEqual(at, -1, 'scrollFocusCenter is gone from app/identity.jsx — re-anchor this test');
  const rest = ID.slice(at);
  const end = rest.indexOf('};');
  assert.notEqual(end, -1, 'could not find the end of the scrollFocusCenter statement');
  const decl = rest.slice(0, end + 2);
  // eslint-disable-next-line no-new-func
  return new Function(decl + '\nreturn scrollFocusCenter;')();
}

test('the focus handler scrolls the focused field to the centre, after the keyboard-open delay', async () => {
  const scrollFocusCenter = liftScrollFocusCenter();
  const calls = [];
  const target = { scrollIntoView: (opts) => calls.push(opts) };

  scrollFocusCenter({ target });
  // Nothing must happen synchronously — the scroll waits out the iOS keyboard-open animation.
  assert.equal(calls.length, 0, 'the scroll fired immediately; it must wait for the keyboard animation');

  await new Promise(r => setTimeout(r, 450));
  assert.equal(calls.length, 1, 'the focused field was never scrolled into view after the delay');
  assert.deepEqual(calls[0], { block: 'center', behavior: 'smooth' },
    'must centre the field (so it clears the keyboard) and scroll smoothly');
});

test('a browser that throws on scrollIntoView does not crash onboarding', async () => {
  const scrollFocusCenter = liftScrollFocusCenter();
  let reached = 0;
  const target = { scrollIntoView: () => { reached++; throw new Error('older WebView'); } };

  // The throw happens inside the deferred callback; without the try/catch it would be an uncaught timer
  // exception and take the app down mid-signup. Running to the assertion below proves it is swallowed.
  scrollFocusCenter({ target });
  await new Promise(r => setTimeout(r, 450));
  assert.equal(reached, 1, 'scrollIntoView was never attempted');
});

// ── Point-of-use: every bottom-ward input that the keyboard can cover is wired to the handler (rule 1).
function inputSlice(anchor, what) {
  const src = stripComments(ID);
  const at = src.indexOf(anchor);
  assert.notEqual(at, -1, `${what} input is gone — re-anchor this test rather than widening a window`);
  const end = src.indexOf('/>', at);
  assert.notEqual(end, -1, `${what} input tag never closes`);
  return src.slice(at, end + 2);
}

test('the recovery-word check input scrolls above the keyboard on focus', () => {
  const tag = inputSlice("id={'recovery-word-' + idx}", 'recovery-word check');
  assert.match(tag, /onFocus=\{scrollFocusCenter\}/,
    'the word-check box no longer scrolls above the keyboard — the small-iPhone pilot bug is back');
});

test('the "Confirm your PIN" input scrolls above the keyboard on focus', () => {
  const tag = inputSlice('aria-label="Confirm your PIN"', 'confirm-PIN');
  assert.match(tag, /onFocus=\{scrollFocusCenter\}/,
    'the PIN confirm box no longer scrolls above the keyboard');
});

test('the "Choose a PIN" input scrolls above the keyboard on focus', () => {
  const tag = inputSlice('aria-label="Choose a PIN"', 'choose-PIN');
  assert.match(tag, /onFocus=\{scrollFocusCenter\}/,
    'the PIN entry box no longer scrolls above the keyboard');
});
