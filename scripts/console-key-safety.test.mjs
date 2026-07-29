// Two console fixes from AUDIT-2026-07-27, guarded here.
// Run: node --test scripts/console-key-safety.test.mjs
//
// HONEST ABOUT ITS OWN STRENGTH: the first test EXECUTES the shipped publishProfile guard; the rest are
// STRUCTURAL checks over vendor/steward.js and app/stew-dashboard.jsx. Structural checks catch a deletion, not
// a subtle break — this repo already has six of them masquerading as coverage. They are here because
// `subscribeMembers`/`block()` sit inside a bundled object literal with a live relay pool and cannot be lifted
// out and run the way `_noteReseat` can. Treat a green tick here as "the guard is still present", nothing more.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
// Brace-match to the REAL end of the function. This was a fixed 1800-character window, and a fixed window is
// a slow-acting trap: adding eight lines to publishProfile pushed its signing call out of view and turned a
// correct fix into a red test with a misleading message ("the guard must come BEFORE the signature" — the
// guard did; the signature had simply fallen off the end). This file has been bitten by the same thing twice.
const body = (name, src) => {
  const i = src.indexOf(name);
  assert.notEqual(i, -1, name + ' missing');
  let depth = 0;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(i, j + 1);
  }
  assert.fail(name + ': could not find the end of the function');
};

test('a delegated steward cannot publish a church profile', () => {
  // The bug: setActiveIdentity's delegated branch sets sk = churchSk (THIS device's church key) with pub = the
  // church being stewarded, and subscribeProfile fills lastProfile from authors:[pub] — the OTHER church. One
  // Settings toggle then republished THIS church's kind-0 carrying the other church's name, logo and lud16.
  const fn = body('publishProfile(meta)', STEWARD);
  assert.match(fn, /actingChurch/, 'publishProfile no longer refuses while acting as a delegated steward');
  const guardAt = fn.indexOf('actingChurch'), signAt = fn.indexOf('finalizeEvent');
  assert.ok(guardAt !== -1 && signAt !== -1 && guardAt < signAt, 'the delegated guard must come BEFORE the signature');
});

test('a profile edit is refused before the profile has been read', () => {
  const fn = body('publishProfile(meta)', STEWARD);
  assert.match(fn, /_profileLoaded/, 'a partial edit on a cold start can wipe picture/banner/accent/features/lud16 again');
  assert.match(STEWARD, /oneose\(\)\s*\{\s*_profileLoaded = true/, 'a church with no profile yet must still be able to publish its first');
});

test('the delegated switch resets the loaded flag as well as the profile', () => {
  assert.match(STEWARD, /lastProfile = \{\};\s*_profileLoaded = false/,
    'switching identity must not carry one church’s loaded-ness into the other’s edits');
});

test('blocking a member rotates every encrypted group they could read', () => {
  // The distributor only republishes when the recipient set GREW; a block shrinks it, so nothing was published
  // and the blocked phone kept decrypting new messages forever.
  // End at the NEXT declaration rather than a fixed byte count. A 2200-char window silently stopped covering
  // the group rotation the moment the name-key rotation was added above it (2026-07-27) — the code was
  // untouched and the test went red. A fixed slice off a moving anchor is this suite's recurring own-goal.
  const start = DASH.indexOf('const block = (pk)');
  assert.notEqual(start, -1, 'block() moved or was renamed');
  const stop = DASH.indexOf('const unblock', start);
  const fn = DASH.slice(start, stop > start ? stop : start + 4000);
  assert.match(fn, /rotateCareKey/, 'care-key rotation on block is gone');
  assert.match(fn, /publishGroupKey\([^)]*\{\s*rotate:\s*true\s*\}/,
    'blocking no longer rotates encrypted GROUP keys — the blocked member keeps reading every future message');
  assert.match(fn, /g\.encrypted/, 'the rotation must iterate the encrypted groups');
});

test('DashMembers actually has the groups it rotates', () => {
  // A silent `typeof groups === "undefined"` would make the loop above a no-op that still matches every regex.
  const i = DASH.indexOf('function DashMembers()');
  assert.notEqual(i, -1);
  assert.match(fnBody(DASH, i), /const groups = window\.useStewardGroups/,
    'block() iterates `groups`, so DashMembers must actually subscribe to them');
});
