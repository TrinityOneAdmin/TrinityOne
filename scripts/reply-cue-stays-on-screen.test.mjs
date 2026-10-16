// THE REPLY ARROW STAYS ON SCREEN WHILE A GROUP MESSAGE IS DRAGGED (owner 2026-10-15).
// Run: node --test scripts/reply-cue-stays-on-screen.test.mjs
//
// Point-of-use (CLAUDE.md rule 1/3): the real member group Row is loaded from app/screens-chat.jsx with the
// REAL app/reply-kit.jsx, dragged with the touches a finger sends, and the arrow's drawn `left` is read off
// the tree. The cue is a child of the sliding row, so its position measured from where the row STARTED is
// (dx + left). A received message sits ~16px from the screen edge, so that sum must never be negative.
//
// Users of the shared cue() (rule 2): Row + DMSwipe (via useSwipe), CareChatSheet, StewCareChat,
// GroupChatModal, StewDmWindow. Row and DMSwipe are driven here; DMSwipe shows the surface that already
// looked right is unchanged once the row is well clear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find } from './render-jsx-screen.mjs';

const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }] });

function screens() {
  const { React, draw } = miniReact();
  const mod = loadScreen('app/screens-chat.jsx', ['Row', 'DMSwipe'], {
    React,
    window: { Fellowship: { displayFor: () => ({ handle: 'Bob' }) }, addEventListener() {}, removeEventListener() {} },
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    UserAvatar: () => null, avOf: () => ({}),
  });
  return { mod, draw };
}
const swiper = (t) => find(t, n => n.type === 'div' && n.props && typeof n.props.onTouchStart === 'function')[0];
const cue = (t) => find(t, n => n.props && n.props['data-reply-cue'])[0];
const body = { type: 'p', props: {}, kids: ['hello'] };

// drag a row to each offset and report where the arrow sits measured from the row's starting edge
function sweep(Comp, props, draw) {
  const out = [];
  let t = draw(Comp, props);
  swiper(t).props.onTouchStart(touch(100, 300));
  for (let dx = 2; dx <= 76; dx += 2) {
    swiper(t).props.onTouchMove(touch(100 + dx, 300));
    t = draw(Comp, props);
    const c = cue(t);
    assert.ok(c, 'no reply arrow at dx=' + dx);
    out.push({ dx, left: c.props.style.left, fromStart: c.props.style.left + dx });
  }
  return out;
}

test('group Row (received message): the arrow is never left of the row\'s starting edge during a drag', () => {
  const { mod, draw } = screens();
  const rows = sweep(mod.Row, { me: false, m: { pubkey: 'pk-bob', handle: 'Bob', when: 'now' }, ctx: {}, mod: { onReply() {} }, children: body }, draw);
  assert.equal(rows.length, 38);
  for (const r of rows) assert.ok(r.fromStart >= 4, 'arrow ' + r.fromStart + 'px from the row start at dx=' + r.dx + ' (would clip at the screen edge)');
});

test('member DM bubble: same guarantee, and once the row is well clear the arrow trails exactly where it always did (-34)', () => {
  const { mod, draw } = screens();
  const rows = sweep(mod.DMSwipe, { mine: false, onReply() {}, children: body }, draw);
  for (const r of rows) assert.ok(r.fromStart >= 4, 'DM arrow clipped at dx=' + r.dx);
  const far = rows.filter(r => r.dx >= 40);
  assert.ok(far.length > 10);
  for (const r of far) assert.equal(r.left, -34, 'the working surfaces\' arrow moved at dx=' + r.dx);
});
