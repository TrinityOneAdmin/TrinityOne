// ONLY THE PEOPLE A CHURCH CHOSE FOR SAFEGUARDING MAY PRIVATELY MESSAGE A CHILD.
// Run: node --test scripts/child-dm-needs-safeguarding-cap.test.mjs
//
// Found during the steward-identity design pass, 2026-08-26, and verified in the shipped relay: the gate that
// decides who may exchange private messages with a young person accepted ANY delegated steward holding ANY
// capability at all — `stewardCan(other, cp, 'any')`. A treasurer given nothing but Finance could privately
// message every child in the congregation, and so could a rota co-ordinator. Nobody had to be checked, cleared
// or linked to a parent; holding one unrelated tickbox was enough.
//
// Nothing in the app would have shown a parent this. The console's own message composer has no client-side
// check at all, so it would simply have worked. And there was no test in either direction — not one asserting
// a cleared adult CAN, nor one asserting an unrelated steward CANNOT.
//
// The capabilities exist precisely so a church can hand out one job without handing out the others. Applying
// them everywhere except the protection of children is the wrong place to make an exception. What stays
// permitted is deliberate: the church's own key (a child's guaranteed route to the office of last resort),
// a linked guardian, an adult on the cleared-worker list, and a steward the church gave the SAFEGUARDING
// role to.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const GW = stripComments(readFileSync(new URL('./gateway.mjs', import.meta.url), 'utf8'));
const gate = (() => {
  const i = GW.indexOf('function safeguardAllows');
  const j = GW.indexOf('\n}', i);
  return i < 0 ? '' : GW.slice(i, j);
})();

test('the child-message gate exists and is bounded to itself', () => {
  // Bounded on purpose. A fixed-length slice around a function name reaches into its neighbours, and this
  // project has already shipped an assertion that passed because it matched the NEXT function's code.
  assert.ok(gate && gate.includes('minorGoverningChurches'), 'safeguardAllows not found');
});

test('a steward needs the SAFEGUARDING role, not merely some role, to message a child', () => {
  assert.doesNotMatch(gate, /stewardCan\([^)]*,\s*['"]any['"]\s*\)/,
    'any steward with any capability may privately message a child — a Finance-only treasurer included');
  assert.match(gate, /stewardCan\([^)]*,\s*['"]safeguarding['"]\s*\)/,
    'the gate does not require the safeguarding capability');
});

test('the routes a church actually relies on are still open', () => {
  // A gate that is too tight is its own harm: a parent who cannot reach their own child, or a cleared youth
  // worker who cannot answer one, would push both onto channels the church cannot see at all.
  assert.match(gate, /approvedIn\(other, cp\)/, 'a cleared worker can no longer message a child');
  assert.match(gate, /guardianLinkedIn\(minorPub, other, cp\)/, 'a linked parent can no longer message their own child');
  assert.match(gate, /other === cp/, 'the church itself can no longer reach a child — their route of last resort');
});

test('clearance is still required from EVERY church that governs the child', () => {
  // One church's lax list must never open a child governed by two.
  assert.match(gate, /for \(const cp of cps\)/, 'the gate no longer checks every governing church');
  assert.match(gate, /return false;/, 'the gate no longer refuses anyone');
});
