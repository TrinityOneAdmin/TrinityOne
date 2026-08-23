// CLEARING SOMEONE FOR YOUTH WORK NAMES THEM, AND CANNOT BE DONE TO A CHILD.
// Run: node --test scripts/clearing-names-the-person.test.mjs
//
// Rev. Miriam, first time doing safeguarding on her console: "every member's button says exactly the same
// words — 'Clear for youth' — with nothing on it saying whose row it is. My press went to the wrong row and
// cleared Ivy, the six-year-old, for youth work. It happened instantly. No 'are you sure?', no name in a
// confirmation, and not a word of objection that I was clearing a child I had marked as a child two minutes
// earlier."
//
// The relay now refuses to store that (see child-cannot-be-cleared.test.mjs). This is the other half: the
// console must not let a steward believe they did it, and must not silently drop the press on the floor.
// Three separate things, all of which Miriam asked for by name:
//   1. the control names the person, so a mis-aimed press is visible before it lands;
//   2. clearing is refused outright when that person is marked as a child;
//   3. UNMARKING a child also drops any clearance, so correcting one mistake cannot activate another.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const DASH = stripComments(readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8'));

test('the clear-for-youth control names the person', () => {
  const i = DASH.indexOf('toggleApproved(m.pubkey)');
  assert.ok(i > 0, 'clear-for-youth button not found');
  const btn = DASH.slice(i, i + 420);
  assert.match(btn, /aria-label=/,
    'every row\'s button reads the same words with nothing naming the row — which is how a six-year-old got ' +
    'cleared for youth work');
  assert.match(btn, /nameOf|memberName|nameByPub|displayName/,
    'the accessible name does not include the member, so it is identical on every row');
});

test('clearing is refused for someone marked as a child', () => {
  const i = DASH.indexOf('const toggleApproved');
  assert.ok(i > 0, 'toggleApproved not found');
  const fn = DASH.slice(i, DASH.indexOf('\n  const ', i + 10));
  assert.match(fn, /minorsSet\.has/,
    'toggleApproved does not check whether the person is a child, so a mis-aimed press still clears one');
});

test('unmarking a child also drops any clearance', () => {
  const i = DASH.indexOf('const toggleMinor');
  assert.ok(i > 0, 'toggleMinor not found');
  const fn = DASH.slice(i, DASH.indexOf('\n  const ', i + 10));
  // Assert the clearance is actually REMOVED, not merely that the word "approved" appears — it already did,
  // as an argument to _reseal, so a looser check passed against unchanged code.
  assert.match(fn, /setApproved|approved[\s\S]{0,120}filter\(/,
    'unmarking a child leaves a stale youth clearance behind. Owner: "a steward should simply be able to ' +
    'unmark a child and they revert to full access" — reverting must not mean becoming a cleared worker.');
});
