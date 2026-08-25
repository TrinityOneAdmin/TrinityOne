// TWO DOORS, NOT THREE — and the app works out where the church lives instead of being told.
// Run: node --test scripts/suite-two-doors.test.mjs
//
// The Suite offered three choices at launch. Two of them opened the SAME console screen and differed only in
// where the church's records were kept: this computer, or the shared community relays. Choosing "console
// only" wrote a hidden marker that STUCK for ever, so every later launch inherited it silently.
//
// The consequences, in a church's terms: the same key opened through different doors showed two different
// churches; invitations handed out under each door pointed members at different places, so one congregation
// became two halves that could not see each other; and because the "setup finished" marker was shared, the
// second door never offered to set anything up — it simply showed a normal-looking console over an empty
// church. That is the "it has lost my church" moment.
//
// A steward has two jobs: run the church, and mind the server. Where the records live is not a job — it is a
// fact about the church, and the app can find it out by asking this computer whether it holds them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const HOME  = readFileSync(new URL('../relay-app/home.html', import.meta.url), 'utf8');
const STEW  = stripComments(readFileSync(new URL('../src/steward.src.js', import.meta.url), 'utf8'));
const SHIP  = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

test('the launcher offers two doors, and neither re-points the data', () => {
  const doors = [...HOME.matchAll(/href="(\/[^"]+)"/g)].map(m => m[1]).filter(h => /steward\.html|control\.html/.test(h));
  assert.deepEqual(doors.sort(), ['/relay-app/control.html', '/steward.html'],
    'the launcher still offers a third door, or still passes a mode in the address');
});

test('the sticky marker is gone from source and from the shipped bundle', () => {
  // It survived in localStorage for ever once written, which is why the choice was invisible afterwards.
  assert.equal(/hostoff/.test(STEW), false, 'the sticky host marker is still written or read');
  assert.equal(/hostoff/.test(SHIP), false, 'the shipped console still carries the sticky marker');
});

test('where the church lives is DETECTED, and fails safe', () => {
  // It asks this computer whether it holds this church. If it cannot tell, it must keep the computer in the
  // list: an extra relay that has nothing costs a dead connection, whereas dropping the one that holds the
  // church loses the church.
  assert.match(STEW, /_boxHostsUs/, 'nothing works out whether this computer holds the church');
  const i = STEW.indexOf('function ownRelay');
  const fn = STEW.slice(i, STEW.indexOf('\nfunction ', i + 10));
  assert.match(fn, /_boxHostsUs === false/,
    'the computer is dropped on anything other than a positive "it does not hold this church"');
});

test('the console says where the church lives, so drift is never silent', () => {
  const D = stripComments(readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8'));
  assert.match(D, /Your church lives on|lives on:/i, 'nothing on screen names where the records are kept');
});
