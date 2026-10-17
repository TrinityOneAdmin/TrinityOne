// THE STEWARD CONSOLE COUNTS CARE COVERAGE PER MEAL (owner 2026-10-16 / audit fix).
//   Run: node --test scripts/console-care-coverage-is-per-meal.test.mjs
//
// When a meals day needs Lunch AND Dinner and only Lunch is taken, the console must NOT read the day as
// "covered" — the family still has no dinner. Renders the shipped MealsNeedCard (summary) + MealsNeedDetail
// (schedule) through the console harness and reads the drawn tree. Not a source match (rule 3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, texts } from './console-screens.mjs';

const NEED = { id: 'n1', type: 'meals', displayLabel: 'The Okafors', dates: ['2026-10-20'], meals: ['lunch', 'dinner'], dayMeals: {} };
const LUNCH_SLOT = { needId: 'n1', isoDate: '2026-10-20', pubkey: 'c'.repeat(64), meal: 'lunch', note: 'Lasagne' };

function mount(expr) {
  const { React, flush, fresh } = fakeReact();
  const { window } = fakeBrowser({ Steward: fakeSteward() });
  const mod = loadConsole({ React, window, expr });
  fresh();
  return { React, flush, mod };
}

test('MealsNeedCard: a day with one meal taken and another open does NOT read as "covered"', () => {
  const { flush, mod } = mount('{ MealsNeedCard }');
  const tree = mod.MealsNeedCard({ need: NEED, slots: [LUNCH_SLOT], skips: [], onOpen() {} });
  flush();
  const t = texts(tree).join(' | ');
  assert.doesNotMatch(t, /covered/i, 'a half-covered meals day still read as "covered" on the card. Shown: ' + t);
  assert.match(t, /1 open/, 'the card did not report the open meal (Dinner) as still open. Shown: ' + t);
});

test('MealsNeedCard: a day with EVERY meal taken reads as covered', () => {
  const { flush, mod } = mount('{ MealsNeedCard }');
  const both = [LUNCH_SLOT, { needId: 'n1', isoDate: '2026-10-20', pubkey: 'd'.repeat(64), meal: 'dinner', note: '' }];
  const tree = mod.MealsNeedCard({ need: NEED, slots: both, skips: [], onOpen() {} });
  flush();
  assert.match(texts(tree).join(' | '), /covered/i, 'a fully-covered day did not read as covered');
});

test('MealsNeedDetail: the schedule shows who has each meal and which meals are still Open', () => {
  const { flush, mod } = mount('{ MealsNeedDetail }');
  const tree = mod.MealsNeedDetail({ need: NEED, slots: [LUNCH_SLOT], skips: [], onClose() {}, onEdit() {} });
  flush();
  const t = texts(tree).join(' | ');
  assert.match(t, /Lunch/, 'the schedule does not label the Lunch meal');
  assert.match(t, /Dinner/, 'the schedule does not label the Dinner meal');
  assert.match(t, /Open/, 'the still-open Dinner is not shown as Open — a steward would think the day is handled. Shown: ' + t);
});

test('MealsNeedDetail schedule layout (owner 2026-10-17): a covered meal reads "Covered" (no bare tick), the dish shows WITHOUT brackets, open reads "Open"', () => {
  const { flush, mod } = mount('{ MealsNeedDetail }');
  const tree = mod.MealsNeedDetail({ need: NEED, slots: [LUNCH_SLOT], skips: [], onClose() {}, onEdit() {} });
  flush();
  const t = texts(tree).join(' | ');
  assert.match(t, /Covered/, 'a covered meal no longer reads "Covered" — the console should say Covered like the member app, not a bare tick');
  assert.match(t, /Lasagne/, 're-anchor: the dish (note) did not render at all');
  assert.doesNotMatch(t, /\(Lasagne\)/, 'the dish is still wrapped in brackets — it should sit in its own column with no brackets');
  assert.match(t, /Open/, 'the still-open Dinner is not shown as Open');
});
