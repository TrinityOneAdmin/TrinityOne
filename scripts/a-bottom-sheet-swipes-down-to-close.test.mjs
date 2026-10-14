// SWIPE DOWN CLOSES A BOTTOM SHEET (owner, 2026-10-14: the verse card's grey handle was decoration; only the X closed it).
// Run: node --test scripts/a-bottom-sheet-swipes-down-to-close.test.mjs
//
// Users of the changed code (rule 2): app/ui.jsx BottomSheet, 34 <BottomSheet> call sites - share-app, screens-church (1),
// identity-extras (6), screens-read (7 incl. ActionSheet, passthrough; one is `docked` and returns before the gesture),
// screens-giving (6), screens-chat (2), screens-serving (6). All gain swipe-down; none opts out.
// A drag only counts if it is mostly vertical, downward, and no scrolled ancestor inside the panel is below its top.
//
// POINT OF USE: the real ActionSheet (screens-read.jsx) is drawn through the real BottomSheet and the handlers are
// fired on the panel. What no harness can see: the finger feel and that the drag follows the finger - device check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find } from './render-jsx-screen.mjs';

const { React, draw } = miniReact();
const win = { addEventListener() {}, removeEventListener() {}, innerWidth: 360, localStorage: { getItem: () => null, setItem() {} },
  TrinityData: { PLANS: [], VOTD_POOL: [], CROSSREFS: {} }, Fellowship: {}, sanitizeHtml: (h) => h };
const base = { React, window: win, localStorage: win.localStorage,
  document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null, activeElement: null },
  navigator: { userAgent: '' }, location: { search: '', hostname: 'x' }, setTimeout, clearTimeout, setInterval, clearInterval, console,
  history: { back() {}, pushState() {}, replaceState() {}, state: null }, fetch: async () => ({ ok: false, json: async () => ({}) }) };
const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
const { BottomSheet, IconBtn } = loadScreen('app/ui.jsx', ['BottomSheet', 'IconBtn'], { ...base, Icon, PhoneFrame() { return null; } });
const { ActionSheet } = loadScreen('app/screens-read.jsx', ['ActionSheet'], { ...base, BottomSheet, IconBtn, Icon });

const T = (x, y) => ({ touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }], target: { scrollTop: 0, parentElement: null } });
const panelOf = (tree) => find(tree, n => n.type === 'div' && n.props.onTouchStart)[0];
function swipe(Comp, props, moves, target) {
  let closed = 0;
  const p = { open: true, onClose() { closed++; }, ctx: {}, ...props };
  const panel = panelOf(draw(Comp, p));
  assert.ok(panel, 'the sheet has no touch handlers - the handle is decoration again');
  const first = T(100, 300); if (target) first.target = target;
  panel.props.onTouchStart(first);
  for (const [x, y] of moves) { draw(Comp, p); panelOf(draw(Comp, p)).props.onTouchMove(T(x, y)); }
  const [lx, ly] = moves[moves.length - 1];
  panelOf(draw(Comp, p)).props.onTouchEnd(T(lx, ly));
  return closed;
}
const slowDown = [[100, 330], [100, 380], [100, 420]];   // fires onTouchMove only; elapsed time is tiny so even a short drag is a flick - keep "short" cases below 30px

test('dragging the verse card down past the threshold closes it', () => {
  assert.equal(swipe(ActionSheet, {}, slowDown), 1);
});
test('a small downward nudge does not close it', () => {
  assert.equal(swipe(ActionSheet, {}, [[100, 308], [100, 320]]), 0);
});
test('an upward drag does not close it', () => {
  assert.equal(swipe(ActionSheet, {}, [[100, 250], [100, 150]]), 0);
});
test('a mostly-sideways drag does not close it', () => {
  assert.equal(swipe(ActionSheet, {}, [[180, 320], [260, 400]]), 0);
});
test('a drag that starts inside content scrolled away from its top does not close it', () => {
  const scrolled = { scrollTop: 40, parentElement: null };
  assert.equal(swipe(ActionSheet, {}, slowDown, scrolled), 0);
});
test('the plain BottomSheet (every other caller) swipes too', () => {
  assert.equal(swipe(BottomSheet, { children: 'x' }, slowDown), 1);
});
