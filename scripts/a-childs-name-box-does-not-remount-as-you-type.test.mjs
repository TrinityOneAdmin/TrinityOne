// THE "CHILDREN AT CHURCH" ADD-A-NAME BOX MUST NOT REMOUNT WHILE YOU TYPE.
// Run: node --test scripts/a-childs-name-box-does-not-remount-as-you-type.test.mjs
//
// Pilot (old iPhone): the keyboard closed after every character in the "Children at church" flow. Cause: the
// add-a-child <input> was wrapped in a `Grp` component DEFINED INSIDE ChildrenAtChurchSheet's render, so each
// keystroke minted a new component type and React remounted the input, dropping iOS focus. This renders the
// REAL sheet (CLAUDE.md rules 1 and 3 — nothing here greps app/identity.jsx) and asserts the input's wrapping
// component type is stable across a typed character. It FAILS if a render-defined wrapper returns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact } from './render-jsx-screen.mjs';

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const CHURCH = 'c'.repeat(64);
const NAME_LABEL = 'A child’s name'; // curly apostrophe, matches the shipped aria-label/placeholder

// path (root -> first node matching pred, inclusive), walking kids only; null if not found
function pathTo(node, pred, trail = []) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const c of node) { const r = pathTo(c, pred, trail); if (r) return r; } return null; }
  const here = [...trail, node];
  if (pred(node)) return here;
  for (const c of (node.kids || [])) { const r = pathTo(c, pred, here); if (r) return r; }
  return null;
}
const isAddNameInput = (n) => n.type === 'input' && n.props && n.props['aria-label'] === NAME_LABEL;
function innermostFnAncestorOfInput(tree) {
  const path = pathTo(tree, isAddNameInput);
  assert.ok(path, 're-anchor: the add-a-child name input is not on the rendered sheet');
  for (let i = path.length - 2; i >= 0; i--) if (typeof path[i].type === 'function') return path[i].type;
  return null; // no function ancestor at all is also stable (would pass)
}

function harness() {
  const { React, draw } = miniReact();
  const list = { v: [] };
  const F = {
    bringsChildren: () => true, setBringsChildren: (_c, on) => !!on,
    myChildNames: () => [...list.v],
    setMyChildNames: (_c, l) => { list.v = [...l]; return [...l]; },
  };
  const globals = {
    React,
    window: { Fellowship: F, TrinityIdentity: { qrSVG: () => '' }, Capacitor: { isNativePlatform: () => false },
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, innerWidth: 390,
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) },
    document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
    navigator: { userAgent: '', clipboard: { writeText: async () => {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, console, fetch: async () => ({ ok: false }),
    Icon: Stub('Icon'), IconBtn: Stub('IconBtn'), UserAvatar: Stub('UserAvatar'), AvatarPicker: Stub('AvatarPicker'),
    QRScanner: Stub('QRScanner'), BackupCard: Stub('BackupCard'), ChurchBadge: Stub('ChurchBadge'),
    Overlay: function Overlay(p) { return React.createElement('div', {}, p.open ? p.children : null); },
    BottomSheet: ({ open, children }) => (open ? children : null),
    NotifToggleRow: function NotifToggleRow(p) { return React.createElement('div', {}, React.createElement('div', {}, p.label), React.createElement('div', {}, p.sub || '')); },
    safeCssColor: (c) => c, lsGet: (k, d) => d, lsSet: () => {},
    Math, Date, JSON, Set, Map, Number, String, Array, Promise, Object, isNaN, Boolean, parseInt, parseFloat,
  };
  const mod = loadScreen('app/identity.jsx', ['ChildrenAtChurchSheet'], globals);
  const ctx = { church: { id: 'c1', name: "St Chad's", npub: CHURCH }, safeguard: {}, toast() {}, openHelp() {} };
  return { draw: () => draw(mod.ChildrenAtChurchSheet, { open: true, onClose() {}, ctx }) };
}

test('typing a character does not remount the add-a-child input (keyboard stays up)', () => {
  const h = harness();
  const tree1 = h.draw();
  const input = pathTo(tree1, isAddNameInput).slice(-1)[0];
  assert.ok(input.props.onChange, 're-anchor: the add-a-child input has no onChange');
  const t1 = innermostFnAncestorOfInput(tree1);

  // drive a real keystroke through the shipped handler, then re-render
  input.props.onChange({ target: { value: 'M' } });
  const tree2 = h.draw();
  const input2 = pathTo(tree2, isAddNameInput).slice(-1)[0];
  assert.equal(input2.props.value, 'M', 'the typed character did not reach the input — re-anchor the keystroke path');
  const t2 = innermostFnAncestorOfInput(tree2);

  assert.ok(Object.is(t1, t2),
    'THE ADD-A-CHILD INPUT IS REMOUNTED ON EACH KEYSTROKE. Its wrapping component type changed between renders, ' +
    'which in React unmounts and recreates the input — on an old iPhone the keyboard then closes after every ' +
    'character. A wrapper component must not be defined inside ChildrenAtChurchSheet’s render.');
});
