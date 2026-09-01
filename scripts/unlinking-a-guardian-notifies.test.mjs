// TAKING A PARENT LINK AWAY MUST REACH THE PARENT'S PHONE.
//   Run: node --test scripts/unlinking-a-guardian-notifies.test.mjs
//
// A parent↔child link is stored in two places that do not talk to each other:
//   · the CHURCH's `guardians:<churchpub>` document, which the relay and the console read; and
//   · the PARENT's own device, which stores the link locally because the parent never set it up — the
//     console linked them, and `notifyGuardian` is what told their app the child existed at all
//     (app/stew-dashboard.jsx, linkParent).
// Removing the link rewrites the first and re-seals the child's own clearance. `notifyGuardianRemoved` is
// the only thing that touches the second. Without it the parent's app keeps a child it no longer has any
// standing over — showing them, offering the family conversation, and offering pickup at check-in — while
// the church's own record says the link is gone. That is the shape this repo calls "local state treated as
// truth", and it is exactly why unlinkParent re-seals the CHILD's copy in the line above: the same reasoning
// was applied to one side of the pair and not the other.
//
// The removal is also the safeguarding-critical direction. Adding a link that should not exist is a mistake
// a steward can see on the screen; failing to remove one is invisible on every screen there is.
//
// HOW IT ASSERTS. app/stew-dashboard.jsx ships UNBUNDLED, so CLAUDE.md rule 3 applies: putting `false && ` in
// front of that call leaves the call, its guard and the comment explaining it exactly where they are, and any
// assertion that matches text in this file still passes. Measured on 2026-09-01, nothing anywhere went red.
// So the shipped unlinkParent is sliced out by brace-match and RUN with window.Steward as a recorder — the
// same method scripts/marking-a-child-suppresses-their-photo.test.mjs uses on toggleMinor.
//
// MEASURED RED/GREEN, 2026-09-01, with the anchor asserted to occur exactly once inside unlinkParent and the
// source restored byte-identical:
//   · the shipped console                                                       5 pass / 0 fail
//   · `if (false && window.Steward.notifyGuardianRemoved) …`                    2 pass / 3 fail
//   · the `_reseal(…)` call deleted from unlinkParent                           4 pass / 1 fail
//   · setGuardians given the UNCHANGED map                                      2 pass / 3 fail
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const SRC = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

const KID = 'kid-pubkey', MUM = 'mum-pubkey', DAD = 'dad-pubkey', OTHER_KID = 'otherkid-pubkey';

// Run the SHIPPED unlinkParent with everything it touches injected, and record what it did.
function runUnlink(guardians, childPub, parentPub) {
  const body = fnBody(SRC, 'const unlinkParent = (childPub, parentPub) => {', 'unlinkParent');
  const calls = { guardians: [], reseal: [], notified: [] };
  const sg = { minors: [KID, OTHER_KID], approved: ['cleared-pubkey'] };
  const win = { Steward: {
    setGuardians: (g) => { calls.guardians.push(g); return true; },
    notifyGuardianRemoved: (parent, child) => { calls.notified.push([parent, child]); },
  } };
  const fn = new Function('guardians', 'sg', 'window', '_reseal',
    body + '\nreturn unlinkParent;')(guardians, sg, win, (...a) => calls.reseal.push(a));
  fn(childPub, parentPub);
  return calls;
}

test('CONTROL: unlinking really does rewrite the church’s parent map', async () => {
  // If this failed, everything below would be asserting about a function that no longer does its main job.
  const c = runUnlink({ [KID]: [MUM, DAD], [OTHER_KID]: [MUM] }, KID, MUM);
  assert.equal(c.guardians.length, 1, 'unlinking published no parent map at all');
  assert.deepEqual(c.guardians[0][KID], [DAD], 'the removed parent is still on the child’s list');
  assert.deepEqual(c.guardians[0][OTHER_KID], [MUM],
    'another child’s parent was removed as collateral — setGuardians replaces the WHOLE map');
});

test('REMOVING A PARENT LINK TELLS THE PARENT’S APP', async () => {
  const c = runUnlink({ [KID]: [MUM] }, KID, MUM);
  assert.equal(c.notified.length, 1,
    'the church removed a parent link and nothing reached the parent’s phone. Their app stores the link ' +
    'locally — they never set it up, the console told them it existed — so it keeps showing a child they no ' +
    'longer have any standing over, keeps offering the family conversation, and keeps offering pickup at ' +
    'check-in, while the church’s own record says the link is gone. Nothing on any screen says otherwise');
  assert.deepEqual(c.notified[0], [MUM, KID],
    'the wrong pair was notified — the notice must name the parent to tell and the child it is about');
});

test('…and the CHILD’s sealed copy is re-issued in the same action', async () => {
  // The child's phone holds its own sealed answer about who its parents are. Without this it goes on
  // treating a removed adult as somebody it may always message — the exact hole this function opens up.
  const c = runUnlink({ [KID]: [MUM] }, KID, MUM);
  assert.equal(c.reseal.length, 1, 'the child’s own sealed parent list was never re-issued');
  assert.deepEqual(c.reseal[0][2], [KID], 're-sealed somebody other than the child whose link was removed');
});

test('the child is dropped from the map entirely when their LAST parent goes', async () => {
  const c = runUnlink({ [KID]: [MUM], [OTHER_KID]: [DAD] }, KID, MUM);
  assert.equal(Object.prototype.hasOwnProperty.call(c.guardians[0], KID), false,
    'a child with no parents left is kept in the map as an empty entry, which reads as "linked" everywhere ' +
    'the map is consulted by presence');
  assert.deepEqual(c.guardians[0][OTHER_KID], [DAD], 'the other family was dropped too');
  assert.equal(c.notified.length, 1, 'the last parent to be removed is the one most in need of being told');
});

test('unlinking one of TWO parents leaves the other family link alone, and notifies only the one removed', async () => {
  const c = runUnlink({ [KID]: [MUM, DAD] }, KID, DAD);
  assert.deepEqual(c.guardians[0][KID], [MUM], 'the remaining parent lost their link as well');
  assert.deepEqual(c.notified, [[DAD, KID]],
    'the wrong parent was told their link was removed — a parent who still has one would then stop being ' +
    'shown their own child');
});
