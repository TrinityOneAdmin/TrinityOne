// A PROTECTION MUST NOT PROMISE MORE THAN IT DELIVERS.
// Run: node --test scripts/encrypt-all-says-what-it-does.test.mjs
//
// "Encrypt all group chat" told the steward: "Every group's messages will be sealed end-to-end from now on."
// Measured on the live relay, 2026-08-28, with the switch ON: the church's serving-team room was still
// `encrypted: false` and a message posted there was stored in CLEAR.
//
// The sweep skips teams on purpose — they have no encryption control of their own, and the recipient rule
// would seal a team room to every member of the church rather than to its roster, which is the wrong audience
// for a serving team's private channel. So the behaviour is right and the SENTENCE was wrong.
//
// This file exists because the code immediately above that sweep already states the standard it broke:
// "a church shown a protection it does not have is the one failure this project cannot afford."
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
// Slices END on an anchor, never on a character count: scripts/test-windows.test.mjs rejects a fixed window
// that no longer covers what it names, and it caught this file the moment the dialog copy grew.
const between = (from, to) => {
  const a = DASH.indexOf(from);
  assert.ok(a > 0, `re-anchor: could not find ${from}`);
  const b = DASH.indexOf(to, a + from.length);
  assert.ok(b > a, `re-anchor: could not find ${to} after it`);
  return DASH.slice(a, b);
};
const dialog = between('title="Encrypt all group chat?"', 'onCancel=');

test('the confirmation does not claim EVERY group is sealed', () => {
  assert.doesNotMatch(dialog, /Every group’s messages will be sealed/,
    'the dialog promises every group is sealed while the sweep deliberately skips serving teams — a church ' +
    'is told it has a protection it does not have, on the one screen where that matters most');
});

test('…and says plainly that team rooms are left alone', () => {
  assert.match(dialog, /team rooms are not included|Serving team rooms are not included/i,
    'nothing tells the steward which rooms this misses, so they cannot know to check');
});

test('the sweep still skips teams — the behaviour is the part that was right', () => {
  const fn = between('const doEncryptAll', 'const photosOn');
  assert.match(fn, /g\.kind === 'team' \|\| g\.encrypted/,
    'teams are now swept in. That is a real change of audience, not a copy fix: encRecips() seals a ' +
    'non-invite group to EVERY member of the church, so a serving team\'s private room would be handed to ' +
    'people who are not on it.');
});

test('and the switch still refuses to read ON while a room is unsealed', () => {
  // The honesty guard that was already right, pinned so it stays.
  assert.match(between('const encUnsealed', 'const [confirmEnc'), /encryptComms !== false && encUnsealed\.length === 0/,
    'the switch can now read ON while rooms are still unsealed, which is the overclaim this file guards');
});
