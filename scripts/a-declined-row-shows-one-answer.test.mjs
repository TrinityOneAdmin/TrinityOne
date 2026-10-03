// A DECLINED SLOT SHOWS ONE ANSWER AND AN UNDO — NOT "CAN'T MAKE IT" BESIDE "I CAN SERVE".
// Run: node --test scripts/a-declined-row-shows-one-answer.test.mjs
//
// Sim 2026-10-02, item 44. The "Your responses" row on the member's Serving screen carried a "Can't make it"
// badge AND an "I can serve" button, so the row read as two answers given at once. The button was an undo —
// pressing it records "I'll serve" — but it was labelled as an answer.
//
// MOUNTS the shipped ServingScreen and presses the real button (CLAUDE.md rules 1 and 3).
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { nodes } from './app-screens.mjs';
import { loadServing, baseCtx, nodeText, slot } from './serving-screen-harness.mjs';

let h;
before(() => { h = loadServing(); });

const DECLINED = slot({ id: 'rota:svc1:t1::r1', _verdict: 'decline' });
function screen(ctx) {
  h.r.reset();
  const tree = h.mod.ServingScreen({ open: true, onClose() {}, ctx, docked: false });
  h.r.flush();
  return tree;
}
const ctxWith = (declined, calls = []) => baseCtx({
  servDeclined: declined,
  respondServing: async (item, verdict, swapTo) => { calls.push([item.id, verdict, swapTo || '']); return true; },
});
const buttonsOf = (tree) => nodes(tree).filter(n => n.type === 'button');

test('CONTROL: the Your responses row is on screen and says "Can’t make it"', () => {
  const out = nodeText(screen(ctxWith([DECLINED])));
  assert.match(out, /Your responses/, 'the responses section is not on the screen — the fixture proves nothing');
  assert.match(out, /Can’t make it/);
});

test('a declined row shows only the decline state: no "I can serve" answer beside it', () => {
  const tree = screen(ctxWith([DECLINED]));
  const out = nodeText(tree);
  assert.doesNotMatch(out, /I can serve/, 'THE DEFECT: "Can’t make it" and "I can serve" read as two answers on one row');
  assert.doesNotMatch(out, /I’ll serve/);
});

test('…and the way back is labelled as an UNDO', () => {
  const tree = screen(ctxWith([DECLINED]));
  const undo = buttonsOf(tree).find(b => nodeText(b).trim() === 'Undo');
  assert.ok(undo, 'there is no Undo on the declined row, so the member has no way to take the answer back');
  assert.match(undo.props['aria-label'] || '', /serve after all/, 'the Undo has no accessible name saying what it does');
});

test('pressing Undo records "I\'ll serve" — taking the decline back, nothing else', async () => {
  const calls = [];
  const tree = screen(ctxWith([DECLINED], calls));
  const undo = buttonsOf(tree).find(b => nodeText(b).trim() === 'Undo');
  await undo.props.onClick();
  assert.deepEqual(calls, [['rota:svc1:t1::r1', 'accept', '']], 'Undo did not send exactly one accept for this slot');
});
