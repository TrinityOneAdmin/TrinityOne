// THE NAMED TEAMMATE SEES THE SWAP ASK ON THEIR OWN PHONE, AND CAN SAY YES — AND A CHILD'S PHONE KEEPS THE RULE.
// Run: node --test scripts/a-teammate-sees-the-swap-ask-and-answers-it.test.mjs
//
// Sim 2026-10-02, item 25. Owner decisions, same day:
//   · "the MEMBER'S APP asks the named teammate directly (the teammate gets the ask on their own phone and can say
//     yes)" — and "after the teammate says yes, the steward confirms the swap with one tap";
//   · "a child can only swap with cleared adults or their own parent; the child's phone hides any swap ask or
//     answer from anyone else and says so honestly."
//
// This is the SCREEN half (CLAUDE.md rule 1): the real ServingScreen and SwapSheet, mounted and pressed. The
// transport is proved against a real relay in a-swap-ask-reaches-the-teammate-through-the-relay.test.mjs, the
// app wiring in the-member-app-wires-swap-asks-to-the-screen.test.mjs, and the steward's tap in
// a-steward-confirms-a-swap-with-one-tap.test.mjs.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { nodes } from './app-screens.mjs';
import { loadServing, baseCtx, nodeText, slot } from './serving-screen-harness.mjs';

const RUTH = 'aa'.repeat(32), COLIN = 'bb'.repeat(32), DANA = 'cc'.repeat(32), ME = 'dd'.repeat(32);
const ROSTERS = [{ team: 't1', roles: [{ id: 'r1', name: 'Greeter' }], people: [
  { id: 'p1', name: 'Ruth Bexley', pub: RUTH }, { id: 'p2', name: 'Colin Dunn', pub: COLIN }, { id: 'p3', name: 'Dana Hill', pub: DANA },
  { id: 'p4', name: 'Ed Off-app', pub: '' }, { id: 'p5', name: 'Me Myself', pub: ME }] }];
const ASK = { id: 'req1', from: RUTH, church: 'a'.repeat(64), ts: 5,
  slot: { serviceId: 'svc1', teamId: 't1', roleId: 'r1', teamName: 'Welcome', role: 'Greeter', date: '2099-10-04', time: '10:30', service: 'Sunday Gathering' } };

let h;
before(() => { h = loadServing(); });

function screen(ctx) { h.r.fresh(); h.r.reset(); const t = h.mod.ServingScreen({ open: true, onClose() {}, ctx, docked: false }); h.r.flush(); return t; }
const press = (tree, label) => nodes(tree).filter(n => n.type === 'button').find(b => nodeText(b).includes(label));
const mine = (over = {}) => baseCtx({ myPubkey: ME, churchRosters: ROSTERS, swapAsks: [ASK], ...over });

// ── the teammate's card ────────────────────────────────────────────────────────────────────────────────
test('CONTROL: with no ask there is no swap card', () => {
  const out = nodeText(screen(mine({ swapAsks: [] })));
  assert.doesNotMatch(out, /ASKED YOU TO COVER/);
});

test('an ask addressed to me shows who asked, what for, and a yes and a no', () => {
  const tree = screen(mine());
  const out = nodeText(tree);
  assert.match(out, /RUTH BEXLEY ASKED YOU TO COVER/, 'THE DEFECT: the named teammate sees nothing — or sees it without knowing who is asking. The name comes from the church\'s team roster, never from the ask\'s own text');
  assert.match(out, /Welcome · Greeter/, 'the card does not say what is being asked');
  assert.match(out, /10:30 · Sunday Gathering/);
  assert.ok(press(tree, 'Yes, I’ll cover'), 'no way to say yes');
  assert.ok(press(tree, 'Not this time'), 'no way to say no');
});

test('the ask is counted on the Serving tab, so the member is led to it', () => {
  const tabs = nodes(screen(mine())).filter(n => n.type === 'button' && nodeText(n).trim().startsWith('Serving'));
  assert.ok(tabs.some(t => /Serving\s*1$/.test(nodeText(t).trim())), 'the Serving tab carries no count for a waiting swap ask: ' + tabs.map(nodeText).join(' | '));
});

test('"Yes, I\'ll cover" and "Not this time" each send ONE answer for THIS ask', async () => {
  const log = [];
  const ctx = mine({ answerSwap: async (ask, yes) => { log.push([ask.id, ask.from, yes]); return true; }, toast: (t) => log.push(['toast', t]) });
  const tree = screen(ctx);
  await press(tree, 'Yes, I’ll cover').props.onClick();
  await press(tree, 'Not this time').props.onClick();
  assert.deepEqual(log.filter(e => e[0] !== 'toast'), [['req1', RUTH, true], ['req1', RUTH, false]]);
  assert.match(log.filter(e => e[0] === 'toast')[0][1], /Told Ruth you’ll cover — your leader confirms the swap/);
});

test('a failed answer is not thanked', async () => {
  const toasts = [];
  const ctx = mine({ answerSwap: async () => false, toast: (t) => toasts.push(t) });
  await press(screen(ctx), 'Yes, I’ll cover').props.onClick();
  assert.deepEqual(toasts, [], 'the member was told "Told Ruth you\'ll cover" over an answer that never left the phone');
});

// ── a CHILD's phone ────────────────────────────────────────────────────────────────────────────────────
const childCtx = (canDMPeer, over = {}) => mine({ safeguard: { isMinor: true, minorsKnown: true }, canDMPeer, ...over });

test('a child\'s phone HIDES an ask from someone it could not message, and SAYS so', () => {
  const out = nodeText(screen(childCtx(() => false)));
  assert.doesNotMatch(out, /ASKED YOU TO COVER/, 'a child was shown a swap ask from an adult who is not cleared and not their parent');
  assert.match(out, /1 swap message was hidden — it came from someone you can’t message here/, 'the child is not told something was hidden, so the screen pretends there was nothing');
});

test('…but shows one from a cleared adult or their parent (whom canDMPeer lets through)', () => {
  const out = nodeText(screen(childCtx((p) => p === RUTH)));
  assert.match(out, /ASKED YOU TO COVER/);
  assert.doesNotMatch(out, /was hidden|were hidden/);
});

test('while the phone is only ASSUMING it may be a child (iAmMinor), it hides too', () => {
  const out = nodeText(screen(mine({ iAmMinor: true, canDMPeer: () => false })));
  assert.doesNotMatch(out, /ASKED YOU TO COVER/, 'the conservative reading (isMinor OR assumeMinor) was not applied to swap asks');
});

test('a child phone with no way to ask who may reach it hides everything (default-deny)', () => {
  const out = nodeText(screen(mine({ safeguard: { isMinor: true, minorsKnown: true } })));
  assert.doesNotMatch(out, /ASKED YOU TO COVER/);
});

test('CONTROL: an ADULT phone shows the ask whatever canDMPeer says — an ordinary phone cannot know who is a child', () => {
  const out = nodeText(screen(mine({ canDMPeer: () => false })));
  assert.match(out, /ASKED YOU TO COVER/);
});

// ── the asker's side: who was asked, and who may be offered ───────────────────────────────────────────
function SwapSheetFor(ctx) {
  h.r.fresh(); h.r.reset();
  const t = h.mod.SwapSheet({ open: true, item: slot({ id: 'req1' }), onClose() {}, ctx });
  h.r.flush();
  return nodeText(t);
}

test('a CHILD asking for a swap is offered only people they may message', () => {
  const out = SwapSheetFor(childCtx((p) => p === COLIN));
  assert.match(out, /Colin Dunn/, 'a cleared adult / parent was not offered');
  assert.doesNotMatch(out, /Dana Hill/, 'THE DEFECT: a child was offered an adult they are not allowed to message');
  assert.match(out, /Ed Off-app/, 'an off-app name is a message to the LEADER, not to Ed, so it stays offered');
});

test('CONTROL: an ADULT is offered the whole team', () => {
  const out = SwapSheetFor(mine({ canDMPeer: () => true }));
  for (const n of ['Colin Dunn', 'Dana Hill', 'Ed Off-app']) assert.match(out, new RegExp(n));
  assert.doesNotMatch(out, /Me Myself/, 'the member was offered themselves');
});

const SWAPPED = slot({ id: 'rota:svc1:t1::r1', _verdict: 'swap', req: { id: 'req1' } });
const row = (over) => nodeText(screen(baseCtx({ myPubkey: ME, churchRosters: ROSTERS, servDeclined: [SWAPPED], servSwapTo: { req1: COLIN }, ...over })));

test('my swap row says WHO I asked and that I am waiting', () => {
  assert.match(row({}), /Asked Colin — waiting/);
});

test('…and what they answered', () => {
  const yes = row({ swapAnswers: { req1: { [COLIN]: { by: COLIN, yes: true } } } });
  assert.match(yes, /Colin said yes — your leader will confirm/);
  const no = row({ swapAnswers: { req1: { [COLIN]: { by: COLIN, yes: false } } } });
  assert.match(no, /Colin said no/);
});

test('an answer written by SOMEONE ELSE is not the teammate\'s answer', () => {
  const out = row({ swapAnswers: { req1: { [DANA]: { by: DANA, yes: true } } } });
  assert.doesNotMatch(out, /said yes/, 'a forged yes was shown as the teammate\'s');
  assert.match(out, /Asked Colin — waiting/);
});

test('on a CHILD phone an answer from someone not messageable is hidden, and counted', () => {
  const out = row({ safeguard: { isMinor: true, minorsKnown: true }, canDMPeer: () => false, swapAnswers: { req1: { [COLIN]: { by: COLIN, yes: true } } } });
  assert.doesNotMatch(out, /said yes/, 'a child was shown an answer from someone they cannot message');
  assert.match(out, /1 swap message was hidden/);
});
