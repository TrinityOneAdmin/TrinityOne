// A REMOVED MEMBER MUST NOT BE SHOWN THE NEWCOMER'S "WAITING FOR APPROVAL".
// Run: node --test scripts/removed-member-not-pending.test.mjs
//
// Found by a red-team insider on 2026-08-18: after a steward blocked him, Community showed
// "Waiting for approval / Your request to join has been sent. A steward usually lets people in within a day",
// with a "Check again" that re-checks forever. A removed member — especially a safeguarding removal — is told
// they are a hopeful newcomer waiting for a first yes. It is the wrong message, and it never resolves.
//
// The join sub reports only `isPending = approval && !isAdmitted`, which a never-admitted applicant and a
// once-admitted-then-removed member both satisfy. The distinguishing signal is local and certain: this church
// once told us `isAdmitted`, and now does not. app.jsx persists that and sets `removed`.
//
// This drives the ACTUAL decision — the boolean expression app.jsx computes, and the branch order in the chat
// screen — rather than asserting a copy string, which is the trap a sibling test walked into this week.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');
const CHAT = readFileSync(new URL('../app/screens-chat.jsx', import.meta.url), 'utf8');

test('removed is: once admitted, now pending — not a first-time applicant', () => {
  const m = APP.match(/const removed = ([^;]+);/);
  assert.ok(m, 're-anchor: the removed computation is gone');
  const expr = m[1];
  // model the render with (wasAdmitted, approval, isAdmitted) and evaluate the app's own expression
  const removedFor = (wasAdmitted, s) => { const _s = s; return eval(expr.replace(/\bwasAdmitted\b/g, JSON.stringify(wasAdmitted)).replace(/\bs\./g, '_s.')); };  // eslint-disable-line no-eval

  // brand-new applicant: never admitted, approval on, not admitted → NOT removed (they really are pending)
  assert.equal(removedFor(false, { approval: true, isAdmitted: false }), false,
    'a newcomer who has never been admitted is genuinely pending, not removed');
  // once admitted, now pending → REMOVED
  assert.equal(removedFor(true, { approval: true, isAdmitted: false }), true,
    'a member who was admitted and is now pending has been taken out — this is the case that must read as removed');
  // still admitted → not removed
  assert.equal(removedFor(true, { approval: true, isAdmitted: true }), false,
    'an admitted member is not removed');
  // approval OFF (open church): being not-admitted is meaningless, never "removed"
  assert.equal(removedFor(true, { approval: false, isAdmitted: false }), false,
    'with approval off, admitted-ness is not a gate, so this must not read as a removal');
});

test('the persisted flag only ever grows to true on a real admission', () => {
  // it must latch on isAdmitted, so a transient reconnect flicker (isAdmitted:false before the admitted list
  // reloads) does not wrongly flip a genuine member to "removed"
  assert.match(APP, /if \(s\.isAdmitted\) \{ wasAdmitted = true; try \{ lsSet\(WAS_KEY, '1'\)/,
    'the was-admitted flag must be set from a real isAdmitted, and persisted, or a reconnect blip reads as removal');
});

test('the removed screen is checked BEFORE the pending screen, and says the right things', () => {
  // anchor on the RENDER branches (`) : (ctx.joinState && ctx.joinState.X) ?`), not any other use of the flag
  const removedAt = CHAT.indexOf(') : (ctx.joinState && ctx.joinState.removed) ?');
  const pendingAt = CHAT.indexOf(') : (ctx.joinState && ctx.joinState.isPending) ?');
  assert.ok(removedAt !== -1 && pendingAt !== -1, 're-anchor: the join-state render branches moved');
  assert.ok(removedAt < pendingAt,
    'the removed branch must come first — a removed member is also technically isPending, so pending would ' +
    'swallow them and show the newcomer copy');
  const block = stripComments(CHAT.slice(removedAt, pendingAt));   // strip so the comment saying "No Check again" is not itself matched
  assert.match(block, /no longer in this church/i, 'it must say plainly that access was removed');
  assert.match(block, /speak to whoever runs the church/i, 'and point at the real next step');
  assert.doesNotMatch(block, /lets people in within a day/i, 'never the newcomer promise');
  assert.doesNotMatch(block, /Check again/i, 'no re-check button — there is nothing to re-check');
});
