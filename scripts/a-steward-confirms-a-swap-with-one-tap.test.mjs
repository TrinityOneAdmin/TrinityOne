// THE STEWARD SEES WHO WAS ASKED TO SWAP, AND CONFIRMS IT WITH ONE TAP ONCE THEY HAVE SAID YES.
// Run: node --test scripts/a-steward-confirms-a-swap-with-one-tap.test.mjs
//
// Sim 2026-10-02, item 25: "the console never reads who was suggested — it only shows 'Wants swap'". The member's
// 'swap' reply has always carried `swapTo`; nothing on the rota board read it. Owner decision, same day: the
// member's app asks the teammate directly, and "after the teammate says yes, the steward confirms the swap with
// one tap".
//
// MOUNTS the shipped DashRota (esbuild-compiled app/stew-schedule.jsx) and presses its real buttons
// (CLAUDE.md rules 1 and 3). A confirmation is only ever offered on evidence the console can check: the reply
// came from the person on the slot, it names someone on THIS team's roster, and the "yes" was AUTHORED BY THAT
// PERSON — the author is the one thing nobody can forge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountBoard, PUB_A, PUB_B, PUB_C } from './rota-board-harness.mjs';

const ROSTERS = [{ team: 't1', roles: [{ id: 'r1', name: 'Greeter' }], pods: [], people: [
  { id: 'p1', name: 'Ruth Bexley', pub: PUB_A }, { id: 'p2', name: 'Sam Smith', pub: PUB_B }, { id: 'p3', name: 'Tim Tay', pub: PUB_C }] }];
const REQ = { id: 'req1', serviceId: 'svc1', teamId: 't1', roleId: 'r1', memberPub: PUB_A, ts: 100 };
const SWAP = (to = PUB_B, by = PUB_A) => ({ id: 'req1', v: 'swap', swapTo: to, by, ts: 200 });
const ANS = (v = 'swapyes', by = PUB_B) => ({ id: 'swapans~req1', v, by, ts: 300 });
const board = (replies, over = {}) => mountBoard({ rosters: ROSTERS, requests: [REQ], replies, ...over });
const CONFIRM = /Confirm: Sam Smith covers/;

test('CONTROL: a plain "wants swap" with no teammate named still says so, and offers nothing to confirm', () => {
  const out = board([{ id: 'req1', v: 'swap', swapTo: '', by: PUB_A }]).text();
  assert.match(out, /Wants swap/, 'the fixture is wrong: the swap state is not on the board');
  assert.doesNotMatch(out, CONFIRM);
});

test('the board names WHO was asked: "Wants swap — asked Sam"', () => {
  const out = board([SWAP()]).text();
  assert.match(out, /Wants swap — asked Sam/, 'THE DEFECT: the console never reads who was suggested');
  assert.doesNotMatch(out, CONFIRM, 'a confirmation was offered before the teammate said anything');
});

test('once the teammate says YES, the board says so and offers ONE tap to confirm', () => {
  const m = board([SWAP(), ANS('swapyes')]);
  assert.match(m.text(), /Sam said yes/);
  assert.ok(m.has('Confirm: Sam Smith covers'), 'no confirm button after the teammate said yes');
});

test('the tap puts the teammate on the slot, publishes the rota, and asks THEM — not the member who left it', async () => {
  const m = board([SWAP(), ANS('swapyes')]);
  await m.press('Confirm: Sam Smith covers');
  assert.equal(m.calls.publishRota.length, 1, 'the rota was not published by the tap');
  const r = m.calls.publishRota[0];
  assert.equal(r.service, 'svc1');
  assert.equal(r.published, true);
  assert.deepEqual({ name: r.assign['t1::r1'].name, pub: r.assign['t1::r1'].pub }, { name: 'Sam Smith', pub: PUB_B }, 'the slot still holds the member who asked to swap');
  assert.deepEqual(m.calls.sendServingRequest.map(x => x.memberPub), [PUB_B], 'the "Can you serve?" request went to ' + JSON.stringify(m.calls.sendServingRequest.map(x => x.memberPub)) + ', not to the new person alone');
  assert.equal(m.calls.sendServingRequest[0].roleId, 'r1');
  assert.equal(m.calls.sendServingRequest[0].serviceId, 'svc1');
});

test('a NO from the teammate is shown and nothing is offered to confirm', () => {
  const m = board([SWAP(), ANS('swapno')]);
  assert.match(m.text(), /Wants swap — Sam said no/);
  assert.ok(!m.has('Confirm:'), 'a swap the teammate refused can be confirmed');
});

test('a "yes" authored by SOMEONE ELSE is not the teammate\'s yes', () => {
  const m = board([SWAP(), ANS('swapyes', PUB_C)]);
  assert.ok(!m.has('Confirm:'), 'THE DEFECT: a third member\'s forged "swapyes" unlocks a confirmation');
  assert.match(m.text(), /Wants swap — asked Sam/);
});

test('a reply that is not a swap, or not from the person on the slot, offers nothing', () => {
  assert.ok(!board([{ id: 'req1', v: 'accept', swapTo: PUB_B, by: PUB_A }, ANS()]).has('Confirm:'), 'the member changed their mind and said they will serve — there is nothing to swap');
  assert.ok(!board([SWAP(PUB_B, PUB_C), ANS()]).has('Confirm:'), 'a swap reply authored by somebody other than the person on the slot was honoured');
});

test('a teammate who is NOT on this team\'s roster cannot be confirmed in (there is nobody to put on the slot)', () => {
  const stranger = 'ee'.repeat(32);
  const m = board([SWAP(stranger), ANS('swapyes', stranger)]);
  assert.ok(!m.has('Confirm:'));
  assert.match(m.text(), /Wants swap/);
});

test('a rota that did not save asks nobody', async () => {
  const m = board([SWAP(), ANS('swapyes')], { steward: { publishRota: async () => null } });
  await m.press('Confirm: Sam Smith covers');
  assert.deepEqual(m.calls.sendServingRequest, [], 'outward requests went to a person over a rota that reached no relay');
});
