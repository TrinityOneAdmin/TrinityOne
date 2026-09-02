// THE RULE THAT DECIDES WHO A MEMBER MAY MESSAGE PRIVATELY, RUN RATHER THAN READ.
//   Run: node --test scripts/can-dm-peer-runs.test.mjs
//
// `ctx.canDMPeer(peer)` in app/app.jsx is consulted at SEVEN places in the member app before a private
// conversation is offered or opened — the complete list, CLAUDE.md rule 2, from `grep -rn canDMPeer app/`:
//   1. app/screens-chat.jsx:949   a person's row in the church directory ("Message")
//   2. app/screens-chat.jsx:1775  the people picker for sharing a verse to one person
//   3. app/screens-chat.jsx:1998  the DM composer itself (allowDM)
//   4. app/screens-chat.jsx:2293  the DM list's per-thread control
//   5. app/screens-today.jsx:183  the Today card's "message them" action
//   6. app/screens-today.jsx:508  "message" on a care request
//   7. and the relay enforces the same decision independently on kind-4, which is the real boundary
//
// It carries the exemption that lets a child and their own parent always reach each other. That exemption
// was added on 2026-08-04 after a UX audit: a child's device is never served the church's `guardians:` map
// (it names every child in the congregation), so `guardians[me]` was permanently empty on the one device
// that needed it, and a 12-year-old could not message their own mother — while the mother, not being a
// minor, could message them. Asymmetric, and it routed the child to "church leaders" in exactly the case
// where they most need their family. The church now seals the child's OWN confirmed parents into their
// clearance document, and `safeguard.myGuardians` carries it.
//
// WHY THIS FILE EXISTS ALONGSIDE scripts/child-parent-dm.test.mjs. That file says so itself: it is
// STRUCTURAL. It slices canDMPeer out and asserts things about the TEXT inside it — that `myGuardians` is
// mentioned, that the exemption appears before the refusal. app/app.jsx ships UNBUNDLED, so CLAUDE.md rule 3
// applies in full: writing
//     const linked = false && !!(peer && me && (mine.includes(peer) || …
// leaves every word of the exemption, its ordering and the comment above it exactly where they were. The
// structural file cannot go red, and measured on 2026-09-01 neither could anything else. The child is then
// silently cut off from their own parent — silently, because a screen that does not offer a conversation
// says nothing at all (reference/DOMAIN.md).
//
// So this file LIFTS the shipped function by brace-match and CALLS it. Six people, one church.
//
// MEASURED RED/GREEN, 2026-09-01, with the anchor asserted to occur exactly once inside canDMPeer and the
// source restored byte-identical:
//   · the shipped rule                                                  7 pass / 0 fail
//   · `const linked = false && !!(peer && me && (…`                     5 pass / 2 fail
//     …and scripts/child-parent-dm.test.mjs, run in the same command:   5 pass / 0 fail
//   · `if (safeguard.isMinor && …) return false;` -> `if (false && …`   6 pass / 1 fail
//   · the steward-side minors check -> `if (false && minors.length …`   6 pass / 1 fail
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');

const ME = 'me-pubkey', CHURCH = 'church-pubkey';
const MUM = 'mum-pubkey';            // this child's own confirmed parent
const CLEARED = 'cleared-pubkey';    // an adult the church has cleared for youth work
const STRANGER = 'stranger-pubkey';  // an ordinary adult member, not cleared
const KID = 'kid-pubkey';            // somebody else's child

// The SHIPPED canDMPeer, lifted whole and given the two names it closes over. `safeguard` is what the
// member's own device knows; window.Fellowship is where it learns who it is.
function ruleFor(safeguard) {
  const body = fnBody(APP, 'canDMPeer: (peer)', 'canDMPeer');
  const win = { Fellowship: { myPubkey: ME, churchPub: CHURCH } };
  return new Function('safeguard', 'window', 'return { ' + body + ' }.canDMPeer;')(safeguard, win);
}

// ── a child and their own parent ───────────────────────────────────────────────────────────────────────────
test('A CHILD MAY ALWAYS MESSAGE THEIR OWN PARENT', async () => {
  // The child's device holds only its OWN sealed parent list. The congregation's guardians map is not served
  // to it and must not be needed here.
  const can = ruleFor({ isMinor: true, approved: [CLEARED], myGuardians: [MUM], guardians: {}, minors: [] });
  assert.equal(can(MUM), true,
    'a child cannot message their own mother. Her name is on their screen and the conversation is simply not ' +
    'offered — nothing says why, and the app points them at "church leaders" instead of their family');
});

test('…and a parent may always message their own child', async () => {
  // The parent's device DOES hold the church's guardians map, so this arm is read from there. Both arms are
  // one expression: a sabotage of it breaks the family in both directions at once.
  const can = ruleFor({ isMinor: false, approved: [], myGuardians: [], guardians: { [KID]: [ME] }, minors: [KID] });
  assert.equal(can(KID), true,
    'a parent cannot message their own child from an app their whole church is on');
});

// ── the rule the exemption is an exemption FROM ────────────────────────────────────────────────────────────
test('A CHILD MAY NOT MESSAGE AN ADULT THE CHURCH HAS NOT CLEARED', async () => {
  const can = ruleFor({ isMinor: true, approved: [CLEARED], myGuardians: [MUM], guardians: {}, minors: [] });
  assert.equal(can(STRANGER), false,
    'a child was offered a private conversation with an adult their church has never vetted');
});

test('…but may message an adult it HAS cleared, which is what a cleared-worker list is for', async () => {
  const can = ruleFor({ isMinor: true, approved: [CLEARED], myGuardians: [MUM], guardians: {}, minors: [] });
  assert.equal(can(CLEARED), true,
    'a child cannot reach the youth worker their church cleared precisely so they could');
});

test('…and may always reach the church itself, which is the route when nothing else is open', async () => {
  const can = ruleFor({ isMinor: true, approved: [], myGuardians: [], guardians: {}, minors: [] });
  assert.equal(can(CHURCH), true,
    'a child with no cleared adult and no linked parent can reach nobody at all — the one door that must ' +
    'never close');
});

// ── the other direction, on a device that holds the list ───────────────────────────────────────────────────
test('AN UNCLEARED ADULT IS NOT OFFERED A CHILD — on a device that knows who the children are', async () => {
  // Only a steward's device is served `minors:`; an ordinary member's is not, deliberately (AUDIT-2026-07-27,
  // it was a cleartext roll of a congregation's children). So this arm is the console-side courtesy, and the
  // relay enforces the same refusal for everybody else.
  const can = ruleFor({ isMinor: false, approved: [CLEARED], myGuardians: [], guardians: {}, minors: [KID] });
  assert.equal(can(KID), false,
    'an adult the church has not cleared was offered a private conversation with a child, on the one device ' +
    'that had the list in front of it');
});

test('…and a CLEARED adult is', async () => {
  const can = ruleFor({ isMinor: false, approved: [ME], myGuardians: [], guardians: {}, minors: [KID] });
  assert.equal(can(KID), true,
    'the youth worker this church cleared cannot message the young people they were cleared for');
});
