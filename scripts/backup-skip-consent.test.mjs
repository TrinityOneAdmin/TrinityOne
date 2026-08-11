// SKIPPING THE 12 WORDS MUST BE A DECISION, NOT A SLIP. Run: node --test scripts/backup-skip-consent.test.mjs
//
// THE DEFECT (user-flow audit, confirmed). "I'll back these up later" jumped straight to the next screen —
// no confirmation, no warning, one tap. The next screen sets a PIN and says "It never leaves your phone, and
// no one — not even us — can reset it", and mentioned the 12 words ZERO times.
//
// So two taps produced an account locked behind a PIN whose only key the member had never seen, on a screen
// that told them nothing can be reset and never named the thing that could have saved them. Losing the words
// is unrecoverable by design — no church, no steward and no operator can return the account.
//
// This is deliberately NOT a dark pattern in reverse. Skipping is still allowed and still one tap from the
// confirmation; it just states the cost first, and the offer to go back is the prominent one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ID = readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8');

test('neither skip jumps straight past the words', () => {
  const skips = ID.match(/onClick=\{\(\) => setStep\(3\)\}[^>]*>(I’ll back these up later|Skip for now)</g) || [];
  assert.deepEqual(skips, [],
    'a skip still goes directly to the PIN screen. That is one tap between a member and an account whose ' +
    'only key they have never seen');
  assert.ok((ID.match(/setConfirmSkip\(true\)/g) || []).length >= 2,
    'both ways out of the backup step must ask — the confirm-words step has its own skip, and it costs the ' +
    'same thing');
});

test('the confirmation says what is actually lost', () => {
  const at = ID.indexOf('Leave without your 12 words?');
  assert.notEqual(at, -1, 'there is no confirmation at all');
  const panel = ID.slice(at, at + 1400);
  assert.match(panel, /only way back/, 'the confirmation does not say the words are the only way back');
  assert.match(panel, /not your church, not us/,
    'it does not say that nobody can recover the account — a member may reasonably assume their steward can');
  assert.match(panel, /Show me the words again/, 'there is no way back to the words from the confirmation');
  assert.match(panel, /Skip anyway/,
    'the member cannot proceed. Refusing to let someone skip is a different product decision and not this one');
});

test('the PIN screen names the words', () => {
  const at = ID.indexOf('You’ll enter this each time you open the app');
  assert.notEqual(at, -1, 'the PIN explanation moved — re-anchor this test');
  const copy = ID.slice(at, at + 460);
  assert.match(copy, /12 words/,
    'the PIN screen still says nothing can be reset without naming the one thing that CAN bring the account ' +
    'back. That is the sentence that makes a skipped backup feel harmless');
  assert.match(copy, /skippedWords \?/,
    'it says the same thing whether or not they actually wrote the words down — the member who skipped is ' +
    'exactly the one who needs telling');
  assert.match(copy, /have not written those down yet/, 'the skipped case does not say so plainly');
});

test('skipping is remembered, so the warning is true', () => {
  assert.match(ID, /const \[skippedWords, setSkippedWords\]/, 'nothing records that the words were skipped');
  assert.match(ID, /setSkippedWords\(true\)/, 'the skip never records itself, so the PIN screen cannot know');
});
