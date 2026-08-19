// A CARE NEED NOBODY CAN SIGN UP TO IS NOT "COVERED".
// Run: node --test scripts/care-coverage-honesty.test.mjs
//
// Found in the simulation round of 2026-08-19. A steward started a care need for a family — the right person,
// the right kind of help — and saved it before choosing any days. The console's care list then showed that
// need with "0/0" in the same green it uses for a need the whole church has already covered, and the word
// "covered" underneath. On the very same row, two inches to the left, it said "· 0 days".
//
// The cause was one condition. Cover was decided by "is anything still open?" and nothing is open when there
// is nothing at all:
//
//     {open.length === 0 ? 'covered' : open.length + ' open'}
//
// So the emptiest possible need read as the most complete one. The steward moved on. No member could sign up,
// because there was no day to sign up to, and nothing anywhere in the console said the need was unfinished.
// In a parish that means a family who was told the church was coming gets nobody, and the steward who told
// them believes it is handled.
//
// The second thing this file guards is smaller and just as human. The Help panel's index closes with a
// control labelled "Back". The ARTICLE view closed with a button whose only name was its visible word,
// "Help" — the word that OPENS help everywhere else in the app. A simulated 82-year-old spent 310 actions in
// that panel and finished none of her four tasks. A screen reader, or anyone reading the button by its name,
// is told the way out is the way in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments, stmt } from './test-slice.mjs';

const MEALS = readFileSync(new URL('../app/stew-meals.jsx', import.meta.url), 'utf8');
const HELP = readFileSync(new URL('../app/screens-help-main.jsx', import.meta.url), 'utf8');

// the shipped decision, lifted and run — not a paraphrase of it
const mealsCoverLabel = new Function(
  fnBody(MEALS, 'function mealsCoverLabel(', 'mealsCoverLabel') + '\nreturn mealsCoverLabel;'
)();

test('a need with no days is NOT covered, and NOT in the done colour', () => {
  const r = mealsCoverLabel(0, 0);
  assert.notEqual(r.tone, 'done',
    'a need with zero days was painted in the "done" tone — the same green as a need the whole church has ' +
    'signed up for. Nobody can sign up to it; it is unfinished, not finished.');
  assert.equal(r.tone, 'empty',
    `zero days should read as the unfinished tone 'empty', got ${JSON.stringify(r.tone)}`);
  assert.doesNotMatch(r.text, /covered/i,
    `the card told the steward a need with no days was ${JSON.stringify(r.text)}`);
  assert.match(r.text, /no days/i,
    `zero days must say there is nothing to sign up to yet, got ${JSON.stringify(r.text)}`);
});

test('a need with days and nothing open is still "covered"', () => {
  assert.deepEqual(mealsCoverLabel(5, 0), { text: 'covered', tone: 'done' },
    'a genuinely covered need stopped reading as covered — the fix for the empty case broke the ordinary one');
});

test('a need with open days still counts them', () => {
  assert.deepEqual(mealsCoverLabel(5, 3), { text: '3 open', tone: 'open' });
  assert.deepEqual(mealsCoverLabel(1, 1), { text: '1 open', tone: 'open' });
});

test('the card asks the helper — it does not re-decide cover from open.length', () => {
  // The structural half. One honest helper is worth little if the row above it still tests the open list
  // directly; that is the shape the defect was written in. Comments are stripped: this repo has shipped an
  // assertion that was satisfied by the comment explaining the rule.
  const card = fnBody(stripComments(MEALS), 'function MealsNeedCard(', 'MealsNeedCard');
  assert.match(card, /mealsCoverLabel\(/,
    'MealsNeedCard no longer calls mealsCoverLabel — the honest label is not what the steward sees');
  assert.doesNotMatch(card, /open\.length\s*===\s*0/,
    'MealsNeedCard still decides cover from "nothing is open", which is exactly what an empty need looks like');
});

test('every tone the helper can return has a colour on the card', () => {
  const card = fnBody(stripComments(MEALS), 'function MealsNeedCard(', 'MealsNeedCard');
  for (const tone of ['done', 'open', 'empty']) {
    assert.match(card, new RegExp(tone + '\\s*:'),
      `the card has no colour for the '${tone}' tone, so that state renders with no colour at all`);
  }
});

test('the Help article\'s way out is named "Back", like every other dismiss control', () => {
  // fnBody() cannot read a JSX element (it walks a signature's parens), so anchor on the button's own visible
  // text and read back to the tag that opens it. Comments stripped first, as everywhere else here.
  const src = stripComments(HELP);
  const end = src.indexOf('/> Help</button>');
  assert.notEqual(end, -1, 'the Help article back button is gone or reworded — re-anchor this test');
  const btn = src.slice(src.lastIndexOf('<button', end), end);
  assert.match(btn, /aria-label="Back"/,
    'the button that leaves a Help article has no accessible name of its own, so it is announced by its ' +
    'visible word "Help" — the word that OPENS help everywhere else. The way out reads as the way in.');
});

// ── THE MEMBER'S SCREEN. The same defect lived twice: the console card above, and the row a member reads on
// Today. They are different bundles (index.html vs steward.html) so they cannot share a helper, which is
// exactly how one got fixed and the other did not. Both are tested here so the pair stays in step.
const TODAY = readFileSync(new URL('../app/screens-today.jsx', import.meta.url), 'utf8');
const careCoverLabel = new Function(
  fnBody(TODAY, 'function careCoverLabel(', 'careCoverLabel') + '\nreturn careCoverLabel;'
)();

test('a member is NOT told a dayless need is "all covered"', () => {
  const r = careCoverLabel(0, 0);
  assert.equal(r.done, false,
    'the member row painted a need with no days in the done colour — the congregation is told it is handled ' +
    'when in truth there is nothing there to sign up to');
  assert.doesNotMatch(r.text, /covered/i,
    'the summary still reads "all covered" for a need with no days, while the expanded row one tap below it ' +
    'says "No dates set yet" — the two halves of the same card contradict each other');
});

test('the member row still reads correctly when there ARE days', () => {
  assert.deepEqual(careCoverLabel(4, 0), { text: 'all covered', done: true });
  assert.deepEqual(careCoverLabel(4, 1), { text: '1 day still open', done: false });
  assert.deepEqual(careCoverLabel(4, 3), { text: '3 days still open', done: false });
});

test('the member row asks its helper instead of re-deciding from openDays', () => {
  const row = fnBody(stripComments(TODAY), 'function CareNeedRow(', 'CareNeedRow');
  assert.match(row, /careCoverLabel\(/, 'CareNeedRow no longer uses the helper');
  assert.doesNotMatch(row, /openDays\.length\s*===\s*0/,
    'CareNeedRow decides cover from "nothing is open" again, which is what an empty need looks like');
});

// ── AND THE PATH THAT CREATED ONE. The main need form has always refused an empty day list; the sheet a
// steward uses to turn a member's request INTO a need had no guard at all, and its date helper answers []
// for a blank start date rather than throwing. That is how the simulation's dayless need came to exist.
const dayRange = new Function(
  stmt(stripComments(MEALS), 'const dayRange =', 'dayRange') + '\nreturn dayRange;'
)();

test('a blank start date yields NO days — the trap under the sheet', () => {
  assert.deepEqual(dayRange('', ''), [],
    're-anchor: dayRange no longer answers [] for a blank date, so the guard below may be testing nothing');
  assert.equal(dayRange('2026-08-24', '2026-08-26').length, 3, 'a real range no longer expands');
});

test('the approve sheet cannot open a need with no days', () => {
  const sheet = fnBody(stripComments(MEALS), 'function StewApproveSheet(', 'StewApproveSheet');
  assert.match(sheet, /disabled=\{busy \|\| !dates\.length\}/,
    'the sheet publishes whatever the date fields produced, including nothing. A steward converting a ' +
    "member's ask-for-help into a need then opens one the church cannot sign up to, and the list calls it covered.");
});
