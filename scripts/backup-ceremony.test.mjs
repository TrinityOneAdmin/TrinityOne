// The recovery-phrase check must never be answerable from the screen.
// Run: node --test scripts/backup-ceremony.test.mjs
//
// A "type three of your twelve words" confirmation proves the steward wrote the phrase down. It proves NOTHING
// if the twelve words are still visible on the same screen — then it is a copying exercise, and it trains the
// person to click through the one ceremony that stands between them and losing the whole congregation's church
// key. The console had exactly that shape (reported twice by the owner before it was fixed on 2026-07-25).
//
// The member wizard puts the phrase and the quiz on separate STEPS. The console hides the phrase the moment the
// box is ticked, and re-drawing it costs you a different three. Either satisfies the rule; both are guarded here
// because the failure is invisible — the ceremony still looks and feels complete when it has been defeated.
//
// There is now exactly ONE console setup wizard. A second one (StewWizard, stew-console.jsx) was deleted on
// 2026-07-25 — it had the same flaw and I fixed it there FIRST, which changed nothing a steward would ever see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CONSOLE = readFileSync(new URL('../app/stew-console.jsx', import.meta.url), 'utf8');
const MEMBER = readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8');
// THE ONE A STEWARD ACTUALLY SEES. There are two church-key backup screens; the first-run wizard in
// stew-dashboard.jsx is the one on the real path (chooser -> PIN -> "Your church's recovery key"). Fixing only
// stew-console.jsx would have looked complete and changed nothing the owner reported.
const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');




test('the member wizard keeps its phrase and quiz on separate steps', () => {
  // step 1 shows the twelve words; step 2 asks for three. If they ever collapse onto one step it has the same flaw.
  assert.match(MEMBER, /STEP 1 — back up the 12 words/, 'the member backup step is gone or renamed');
  assert.match(MEMBER, /if \(step === 2 && words\.length >= 6\)/, 'the member confirm step must draw its positions on step 2');
  assert.match(MEMBER, /const confirmWords = \(\) => \{[\s\S]*?markBackedUp\(\); setStep\(3\)/,
    'passing the member check must mark the account backed up, or the "secure your account" nag never stops');
});

test('the first-run wizard (the one on the real path) hides the phrase before asking', () => {
  const at = DASH.indexOf("title=\"Your church\u2019s recovery key\"");
  assert.notEqual(at, -1, 'the recovery-key wizard step is gone or retitled');
  const step = DASH.slice(at, at + 4200);
  assert.match(step, /\{!saved \? \(<React\.Fragment>/,
    'the phrase block is not gated on !saved — the words would still be on screen during the quiz');
  assert.match(step, /Phrase hidden/, 'no hidden-state notice, so the steward just sees the phrase vanish');
  assert.match(step, /Show my words again/, 'no way back to the phrase — a typo would trap the steward');
  assert.match(step, /\{phrase && !saved \?/, 'the acknowledgement checkbox must disappear with the phrase');
});

test('the first-run wizard draws its three positions at RANDOM, not hardcoded', () => {
  // They were fixed at #3/#7/#11 — the same question for every church, which is a pattern to learn rather than
  // a check, and trivially defeated once anyone has seen the flow.
  assert.doesNotMatch(DASH, /const challenge = words\.length >= 12 \? \[2, 6, 10\] : \[\];/,
    'the challenge positions are hardcoded again');
  assert.match(DASH, /const \[challenge, setChallenge\] = React\.useState\(\[\]\);/,
    'the challenge must be state so it can be re-drawn');
  assert.match(DASH, /if \(!saved \|\| words\.length < 12\) return;[\s\S]*?Math\.floor\(Math\.random\(\) \* words\.length\)/,
    'the positions must be drawn randomly when the phrase is hidden');
  assert.match(DASH, /\}, \[saved, words\.length\]\);/,
    're-drawn on every saved flip, so going back to read the phrase costs a fresh question');
});

test('there is exactly one console setup wizard', () => {
  // The duplicate is how the meetings step ended up in a flow nobody ran, and how a fix for this very ceremony
  // first landed in a component no steward can reach. One wizard, or the divergence starts again.
  assert.doesNotMatch(CONSOLE, /function StewWizard\(/, 'the second setup wizard is back');
  assert.doesNotMatch(CONSOLE, /window\.StewWizard =/, 'the second setup wizard is still exported');
  assert.match(CONSOLE, /function WizMeetings\(/, 'WizMeetings must stay — the surviving wizard renders it');
  assert.match(CONSOLE, /function ConsoleChrome\(/, 'ConsoleChrome must stay — the dashboard renders it');
});
