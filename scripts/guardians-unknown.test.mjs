// AN UNLOADED GUARDIAN MAP MUST NOT READ AS "THIS CHILD HAS NO PARENTS".
// Run: node --test scripts/guardians-unknown.test.mjs
//
// THE DEFECT (pre-merge audit 2026-08-07, finding 4). useStewardGuardians starts as {} with no loaded flag,
// so "the document has not arrived yet" and "this church has confirmed no parent links" are the same value.
// The clearance back-fill gates on the MINORS document having loaded (sg.loaded) but not on the guardians map,
// then passes `guardians || {}`.
//
// This branch is what made that dangerous. Before it, a clearance whose minor/cleared matched was filed as
// correct and skipped however stale its guardian list was. 2026-08-04 fixed that by making the parent link
// part of the comparison — so now a back-fill running with an unloaded map does not merely skip: it decides
// "stored says [dad], want says []" and REWRITES every child's clearance with an empty guardian list.
//
// On the child's phone myGuardians becomes [], `linked` in canDMPeer goes false, and the child can no longer
// message their own parent — which is the bug commit 650e0ab exists to fix. It self-heals only when the map
// arrives AND the effect happens to re-run, and `guardians` is not even in that effect's dependency array.
//
// WHY NOT SIMPLY GATE ON "GUARDIANS LOADED". That was the first fix proposed and it is worse than the bug.
// subscribeSafeguard sets loaded ONLY when the minors document arrives; a guardians document exists only once
// a steward has confirmed at least one parent link, and most churches have none. Gate the back-fill on a
// guardians-loaded flag and the back-fill never runs for those churches at all — silently — while its whole
// purpose is sealing minor:true clearances for children who have none.
//
// So the distinction lives in the engine, where the write is actually decided: an array means "these are the
// parents", anything else means "I do not know", and not knowing is never a reason to write. The screen also
// stops asking before it knows, but nothing destructive rests on the screen getting that right.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = readFileSync(ROOT + 'src/steward.src.js', 'utf8');
const VENDOR = readFileSync(ROOT + 'vendor/steward.js', 'utf8');

function lift() {
  const at = SRC.indexOf('function _guardiansDiffer(');
  assert.notEqual(at, -1,
    '_guardiansDiffer() does not exist in src/steward.src.js.\n\n' +
    '  If this is the first run, that IS the defect: the comparison is inline in _clearancesMatching and\n' +
    '  cannot tell "the guardian map has not loaded" from "this child has no parents", so a back-fill that\n' +
    '  runs early rewrites every child with an empty guardian list.');
  let depth = 0, q = '';
  for (let i = SRC.indexOf('{', at); i < SRC.length; i++) {
    const c = SRC[i], prev = SRC[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && SRC[i + 1] === '/') { i = SRC.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) {
      return new Function(SRC.slice(at, i + 1) + '\nreturn _guardiansDiffer;')();
    }
  }
  assert.fail('could not find the end of _guardiansDiffer');
}

const DAD = 'd'.repeat(64);
const MUM = 'm'.repeat(64);

test('an unknown map is never a reason to rewrite a child', () => {
  const differ = lift();
  assert.equal(differ([DAD], undefined), false,
    'THE BUG: the guardian map had not arrived, the caller passed "I do not know", and this reported a ' +
    'difference — so the back-fill rewrites the child with an empty guardian list and the child can no ' +
    'longer message their own parent');
  assert.equal(differ([DAD, MUM], null), false, 'null must mean unknown too, not "no parents"');
});

test('a genuinely empty list still clears a removed parent', () => {
  const differ = lift();
  assert.equal(differ([DAD], []), true,
    'unlinkParent can no longer reach the child: the church says this child has no parents and the stored ' +
    'copy still names one, and that was reported as no difference');
  assert.equal(differ([], []), false, 'no parents either side is not a difference');
});

test('a real change is still detected, whatever the order', () => {
  const differ = lift();
  assert.equal(differ([DAD], [DAD, MUM]), true, 'a newly linked parent must reach the child');
  assert.equal(differ([DAD, MUM], [DAD]), true, 'a removed parent must reach the child');
  assert.equal(differ([DAD, MUM], [MUM, DAD]), false,
    'the same two parents in a different order were treated as a change, so every child is rewritten on ' +
    'every pass — churn on the most sensitive document in the church');
});

test('a missing stored list is a difference only if parents are actually wanted', () => {
  const differ = lift();
  assert.equal(differ(null, [DAD]), true, 'the child has no stored guardians and the church says they have one');
  assert.equal(differ(null, []), false, 'nothing stored and none wanted is not a reason to write');
  assert.equal(differ(undefined, undefined), false, 'unknown on both sides must never write');
});

test('the shipped bundle carries the guard', () => {
  assert.match(VENDOR, /_guardiansDiffer/,
    'vendor/steward.js predates this fix, so the console still empties guardian lists however green src/ ' +
    'looks — run bash scripts/build-steward.sh');
});
