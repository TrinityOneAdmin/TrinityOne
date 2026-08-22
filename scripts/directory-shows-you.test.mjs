// YOU ARE IN YOUR OWN CHURCH DIRECTORY, AND A PARTIAL ROSTER SAYS SO.
// Run: node --test scripts/directory-shows-you.test.mjs
//
// Round 9, five members. Every one of them reported a different, smaller number than the church had, and none
// of them could find themselves:
//   Bea    "1 members", four names listed, herself absent
//   Daniel "1 person" (only Priya), then 4 after a reload
//   Samuel "3 members" on the panel, 2 in the directory, 5 named in the welcome post
//   Priya  "2 people", herself absent
//   Grace  "The People list never shows me in it either way, so I can't see what anyone else sees about me."
//
// I FIRST FILED THIS AS DATA LOSS — "the client is not rendering what the relay holds". That was wrong, and
// measuring the shipped apps disproved it: every one of the five ended the session with 5 of 5 members cached
// and visible in its member hub, all with `joined` set and none hidden. Nothing was lost. Two ordinary bugs
// were wearing that costume:
//
//   1. THE DIRECTORY EXCLUDES YOU, and its header counts without you, so a five-person church reads
//      "4 people" and a member cannot confirm their own entry. Grace's "Show me in the directory" toggle is
//      sound (role=switch, aria-checked, and it toasts) but UNVERIFIABLE, because the one place that would
//      show her the answer is the one place she is deliberately removed from. A privacy control you cannot
//      check is not a control.
//   2. THE LOADING HINT ONLY SHOWS WHILE THE LIST IS EMPTY (`loading && people.length === 0`). The roster
//      streams in, so the moment the FIRST person arrives the spinner goes and a partial list looks final.
//      Samuel read "2 people" as his church. He had no way to know more were still coming.
//
// Both are in PeopleScreen. Assertions are on the shipped source with comments stripped — this file names
// both bugs in prose and would otherwise satisfy the checks it exists to make.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const CHAT = stripComments(readFileSync(new URL('../app/screens-chat.jsx', import.meta.url), 'utf8'));
const peopleScreen = (() => {
  const i = CHAT.indexOf('function PeopleScreen(');
  assert.ok(i > 0, 'PeopleScreen not found');
  const j = CHAT.indexOf('\nfunction ', i + 10);
  return CHAT.slice(i, j > 0 ? j : undefined);
})();

test('the directory does not delete you from your own church', () => {
  assert.equal(/members\.filter\(m => m\.pubkey !== me\)/.test(peopleScreen), false,
    'PeopleScreen still filters the member out of the directory, so its count disagrees with the church and ' +
    'nobody can confirm their own entry — which is what makes the "Show me in the directory" toggle ' +
    'unverifiable (Grace, round 9: "a privacy control I can\'t verify isn\'t really a control").');
});

test('your own row is marked, and does not offer to message yourself', () => {
  assert.match(peopleScreen, /isMe/,
    'nothing distinguishes your own row; a directory that lists you must say which one you are');
  assert.match(peopleScreen, /isMe[\s\S]{0,400}?(You|you)\b/,
    'your row is not labelled');
});

test('a still-loading roster says so even once some people have arrived', () => {
  assert.equal(/loading && people\.length === 0/.test(peopleScreen), false,
    'the loading state is shown ONLY while the list is empty, so a partial roster reads as the whole church. ' +
    'Round 9: Samuel saw "2 people" of five and had no way to know more were coming.');
  // Assert the visible words exist AND that they are guarded by `loading` — the string alone could sit
  // anywhere, and a `loading ?` alone could render nothing the member can read.
  assert.match(peopleScreen, /still loading people/i,
    'there is no indication at all that more people may still arrive');
  assert.match(peopleScreen, /\{loading \?[\s\S]{0,700}?still loading people/i,
    'the "more may appear" line is not conditional on the roster still loading, so it would never go away');
});
