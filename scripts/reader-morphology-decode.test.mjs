// GRAMMAR DECODER: the Define/Study sheets show STEPBible morphology codes as plain English.
// Run: node --test scripts/reader-morphology-decode.test.mjs
// Lifts the REAL greekMorph/morphText out of app/screens-read.jsx (compiled, not text-matched) and runs them on real codes.
// Users of what changed (rule 2): greekMorph <- morphText only; morphText <- OriginalWords and LexDetail in screens-read.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact } from './render-jsx-screen.mjs';

const { React } = miniReact();
const Bible = { subscribe: () => () => {} };
const mod = loadScreen('app/screens-read.jsx', ['greekMorph', 'morphText'], {
  React, Bible, window: { Bible }, Icon: () => null, IconBtn: () => null, BottomSheet: () => null, Btn: () => null,
  Empty: () => null, Pill: () => null, Chip: () => null, setTimeout: () => 0, clearTimeout() {},
});
const { morphText } = mod;

test('digit-prefixed verb codes keep their tense/voice/mood (V-2API-3S is aorist PASSIVE indicative)', () => {
  assert.equal(morphText('V-2API-3S', 'greek'), 'verb · aorist · passive · indicative · 3rd person · singular');
  assert.equal(morphText('V-2AAI-3S', 'greek'), 'verb · aorist · active · indicative · 3rd person · singular');
  assert.equal(morphText('V-2RAI-3S', 'greek'), 'verb · perfect · active · indicative · 3rd person · singular');
  assert.equal(morphText('V-2FMI-1P', 'greek'), 'verb · future · middle · indicative · 1st person · plural');
  // control: the undigited form still works
  assert.equal(morphText('V-AAI-3S', 'greek'), 'verb · aorist · active · indicative · 3rd person · singular');
  assert.equal(morphText('V-PAP-NSM', 'greek'), 'verb · present · active · participle · nominative · singular · masculine');
});

test('Hebrew: the language letter is stripped once, so every / segment decodes (HTd/Aamsa, HC/Acmsc)', () => {
  assert.equal(morphText('HTd/Aamsa', 'hebrew'), 'particle  +  adjective · masculine · singular');
  assert.equal(morphText('HC/Acmsc', 'hebrew'), 'conjunction  +  adjective · masculine · singular');
  assert.ok(!/amsa|acmsc/.test(morphText('HTd/Aamsa', 'hebrew')), 'raw code leaked');
  // control: single segment unchanged
  assert.equal(morphText('HNcmsa', 'hebrew'), 'noun · masculine · singular · absolute');
});

test('Greek pronouns keep person, case and number (P-1NS)', () => {
  assert.equal(morphText('P-1NS', 'greek'), 'personal pronoun · 1st person · nominative · singular');
  assert.equal(morphText('P-2DP', 'greek'), 'personal pronoun · 2nd person · dative · plural');
  // control: a noun is untouched
  assert.equal(morphText('N-NSF', 'greek'), 'noun · nominative · singular · feminine');
});
