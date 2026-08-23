// SWITCHING SOMETHING ON IS NOT THE SAME AS ANYONE KNOWING. A steward turns on practical care; every member
// already using the app is told nothing at all. Verity and Callum both had to be TOLD, out of band, where Care
// was — and Miriam's own words about a feature she had never noticed were "I never saw an option for that".
//
// Run: node --test scripts/switching-on-tells-the-church.test.mjs
//
// The church already has a way to tell everyone: a post reaches every member's app, and featuring something
// puts a card on their Today. Nothing connected the two. This does not post ANYTHING by itself — a church
// deciding to offer help is the steward's news to break, in their own words, at a time of their choosing. It
// offers, with the words written for them, and takes "not now" for an answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const MEALS = stripComments(readFileSync(new URL('../app/stew-meals.jsx', import.meta.url), 'utf8'));

test('C9 — turning practical care on offers to tell the church', () => {
  assert.match(MEALS, /announceOn|tellChurch/, 'switching care on still tells nobody');
  assert.match(MEALS, /Ask for help/, 'the offered wording does not name what a member would actually look for');
});

test('C9 — it offers, and never posts on its own', () => {
  // A steward who turns something on to look at it, at eleven at night, has not decided to announce it.
  const i = MEALS.indexOf('const setAll');
  const fn = MEALS.slice(i, MEALS.indexOf('\n  const ', i + 10));
  // This one is a GUARD, not a proof: it passed before the feature existed, because nothing posted at all.
  // It earns its place by catching the tempting future shortcut of posting straight from the toggle.
  assert.equal(/publishPost|publishMessage|postAnnouncement/.test(fn), false,
    'flipping the switch posts to the whole church with nobody having agreed to it');
  // What DOES prove it: the post is behind a button in a dialog the steward can decline.
  const m = MEALS.indexOf('function AnnounceCareModal');
  assert.ok(m > 0, 'no offer dialog');
  const modal = MEALS.slice(m, MEALS.indexOf('\nfunction ', m + 10));
  assert.match(modal, /Not now/, 'the offer cannot be declined');
  assert.match(modal, /publishPost\(text\.trim\(\)/, 'the steward cannot edit what gets posted');
});

test('C9 — turning it OFF announces nothing', () => {
  // "We have withdrawn practical care" is not an announcement any church wants sent on its behalf.
  // A first draft of this matched /on \? / and passed against code that had no offer at all. Assert the gate.
  assert.match(MEALS, /const turningOn = next\.enabled === true && !on/,
    'nothing distinguishes switching on from switching off');
  const i = MEALS.indexOf('const turningOn');
  assert.match(MEALS.slice(i, MEALS.indexOf('};', i)), /if \(turningOn\) setAnnounceOn\(true\)/,
    'the offer is not gated on the switch having just gone ON');
});

test('C9 — the offer posts somewhere members actually read', () => {
  // It fell back to the string 'announce' when a church had no broadcast room, and nothing listens to that:
  // members subscribe to rooms they know about. The relay accepted the event, the sheet closed as though it
  // had worked, and not one person could ever receive it.
  assert.equal(/'announce'\)/.test(MEALS), false, "it can still post to a room nobody is listening to");
  assert.match(MEALS, /const target = broadcast \? broadcast\.id : \(\(groups \|\| \[\]\)\[0\] \|\| \{\}\)\.id/,
    'it does not fall back to a real room the way the ordinary composer does');
  assert.match(MEALS, /ok === false/,
    'publishPost resolves FALSE when every relay refuses, so the sheet still closes as a success');
  assert.match(MEALS, /no chat room yet/, 'a church with nowhere to post is shown a button that cannot work');
});
