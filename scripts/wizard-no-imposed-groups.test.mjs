// A NEW CHURCH GETS ONLY THE GROUPS ITS STEWARD CHOSE — AND CANNOT SKIP THE 12 WORDS.
// Run: node --test scripts/wizard-no-imposed-groups.test.mjs
//
// Round 9 (2026-08-21) created a church through the wizard and got NINE groups where three were offered.
// Two seeders ran, neither aware of the other, 86 seconds apart on the relay:
//   15:38:53  steward-root.jsx published five starter groups the moment the church registered — announce,
//             men, women, youth, prayer — silently, with no UI and no choice. Their NAMES came from
//             window.SK, the design MOCK-UP object that also holds "Grace Chapel" and "Pastor John".
//   15:40:19  the wizard published what the steward actually ticked.
// The blurbs collided exactly, because both drew the same strings: "Announcements for everyone" sat on both
// Announcements and Whole Church; "A midweek small group" on both Men's Life Group and Life Group.
//
// It was not a cosmetic duplicate. Members read the imposed rooms as statements about THEMSELVES:
//   Bea, 73: "I'm on the list for Youth and for Men's Life Group. I am a 73-year-old woman."
//   Samuel:  "I'm a man and Women's Bible Study is listed under Your groups and I can read it."
// Neither was in any group — those rooms carry no members field at all — but nothing on screen said so.
//
// The second half: "Skip setup" sat on step 0, BEFORE the recovery-key step. One tap and a steward reached a
// working console having never seen the twelve words that ARE the church. The wizard's quiz is otherwise
// mandatory (canContinue requires saved && verified), so the button was the only way past it.
//
// Comments are stripped before every assertion: this file's own prose names both the seeder and the button,
// and would otherwise satisfy the checks it exists to make (see test-slice.mjs stripComments).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const root = stripComments(readFileSync(new URL('../app/steward-root.jsx', import.meta.url), 'utf8'));
const dash = stripComments(readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8'));

test('no code path publishes the mock-up SK groups to a real church', () => {
  assert.equal(/SK\.groups/.test(root), false,
    'steward-root.jsx still seeds window.SK.groups — a brand-new church gets five rooms nobody chose, ' +
    'named out of the design mock-up that also contains "Grace Chapel" and "Pastor John".');
  assert.equal(/SK\.groups/.test(dash), false,
    'the dashboard seeds window.SK.groups.');
});

test('the wizard offers groups and publishes ONLY what was ticked', () => {
  const save = dash.slice(dash.indexOf('const saveGroups'));
  const body = save.slice(0, save.indexOf('\n  const '));
  assert.match(body, /STARTERS\.filter\(/,
    'saveGroups no longer filters STARTERS by what the steward picked.');
  assert.equal(/SK\b/.test(body), false, 'saveGroups reaches into the mock-up data object.');
});

test('"Skip setup" is NOT reachable before the recovery-key step', () => {
  // step 0 is the church-name step; step 1 shows the twelve words. Locate each block by its own heading and
  // assert on the slice, so a skip button anywhere in steps 0-1 fails regardless of how the footer is built.
  const s0 = dash.indexOf("title=\"Welcome to your console\"");
  const s2 = dash.indexOf('if (step === 2)');
  assert.ok(s0 > 0 && s2 > s0, 'could not locate the wizard steps 0..1');
  const beforeWords = dash.slice(s0, s2);
  assert.equal(/onClick=\{onDone\}/.test(beforeWords), false,
    'a one-tap exit still sits before the twelve-word ceremony: a steward can reach a working console ' +
    'without ever seeing the phrase that IS the church, and there is no way to recover it afterwards.');
});

test('the wizard still HAS an exit, at the groups step or later', () => {
  const s3 = dash.indexOf('if (step === 3)');
  assert.ok(s3 > 0, 'could not locate the groups step');
  assert.match(dash.slice(s3), /onClick=\{onDone\}/,
    'removing the exit entirely traps a steward into inventing a serving team before they can look around. ' +
    'The name and the words are mandatory; groups, meetings and teams are not.');
});
