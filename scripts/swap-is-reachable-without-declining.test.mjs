// SWAP IS ONE TAP FROM A REQUEST, AND DECLINING AFTER A SWAP ASK RECORDS NO "YES" FIRST.
// Run: node --test scripts/swap-is-reachable-without-declining.test.mjs
//
// Sim 2026-10-02, item 46. Two halves of one complaint:
//   1. "Swap is hidden behind Can't make it -> Suggest someone." The request card offered "Yes, I can serve" and
//      "Can't make it"; asking a teammate to swap was only inside the decline sheet.
//   2. "Declining after a swap means pressing I'll serve first." A swap-asked row offered only "I'll serve", so
//      to decline, the member had to record a YES and then decline — and the church saw the yes.
//
// MOUNTS the shipped ServingScreen and presses the real buttons (CLAUDE.md rules 1 and 3).
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { nodes } from './app-screens.mjs';
import { loadServing, baseCtx, nodeText, slot } from './serving-screen-harness.mjs';

let h;
before(() => { h = loadServing(); });

function screen(ctx) {
  h.r.reset();
  const tree = h.mod.ServingScreen({ open: true, onClose() {}, ctx, docked: false });
  h.r.flush();
  return tree;
}
const buttonsOf = (tree) => nodes(tree).filter(n => n.type === 'button');
const pressable = (tree, label) => buttonsOf(tree).find(b => nodeText(b).includes(label));

const REQ = slot({ id: 'req1' });
const SWAPPED = slot({ id: 'rota:svc1:t1::r1', _verdict: 'swap' });

test('a pending request card has a swap control of its own', () => {
  const tree = screen(baseCtx({ servPending: [REQ] }));
  const swap = pressable(tree, 'swap');
  assert.ok(swap, 'THE DEFECT: no control on the request card asks for a swap — it is only inside the decline sheet');
  assert.ok(pressable(tree, 'Yes, I can serve'), 'the fixture is wrong: the request card is not on screen');
});

test('pressing it opens the swap sheet for THAT request, without opening the decline sheet first', () => {
  const ctx = baseCtx({ servPending: [REQ] });
  // one component instance throughout: the sheet state lives in ServingScreen's hooks, so draw again after the press
  let tree = screen(ctx);
  pressable(tree, 'swap').props.onClick();
  tree = screen(ctx);
  const sheets = nodes(tree).filter(n => typeof n.type === 'function' && n.type.name === 'SwapSheet');
  assert.equal(sheets.length, 1, 'SwapSheet is not rendered by the Serving screen');
  assert.equal(sheets[0].props.open, true, 'the swap sheet did not open');
  assert.equal(sheets[0].props.item && sheets[0].props.item.id, 'req1', 'it opened for a different request');
  const respond = nodes(tree).find(n => typeof n.type === 'function' && n.type.name === 'RespondSheet');
  assert.ok(!(respond && respond.props.open), 'the decline sheet opened instead — swap is still behind "Can’t make it"');
});

test('a swap-asked row offers "Can’t make it" directly, beside "I’ll serve"', () => {
  const tree = screen(baseCtx({ servDeclined: [SWAPPED] }));
  const out = nodeText(tree);
  assert.match(out, /Swap asked/, 'the fixture is wrong: the swap row is not on screen');
  assert.ok(pressable(tree, 'I’ll serve'), 'the way to stay on is gone');
  assert.ok(pressable(tree, 'Can’t make it'), 'THE DEFECT: no way to decline from a swap-asked row');
});

test('declining from a swap-asked row sends ONE decline and no accept first', async () => {
  const calls = [];
  const ctx = baseCtx({ servDeclined: [SWAPPED], respondServing: async (item, verdict) => { calls.push(verdict); return true; } });
  const tree = screen(ctx);
  await pressable(tree, 'Can’t make it').props.onClick();
  assert.deepEqual(calls, ['decline'], 'the church was sent ' + JSON.stringify(calls) + ' — an "accept" before the decline records a yes the member never gave');
});
