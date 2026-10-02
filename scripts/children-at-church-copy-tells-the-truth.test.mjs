// THE "CHILDREN AT CHURCH" SHEET MUST NOT PROMISE A WIPE THAT DOES NOT HAPPEN.
// Run: node --test scripts/children-at-church-copy-tells-the-truth.test.mjs
//
// Sim finding (block A2, item 13). The sheet said: "If you lock the app with a PIN, this list is cleared from
// the phone along with everything else about your church." That is false: clearCommunityCache's KEEP_PREFIX
// deliberately exempts bringkids/mykidnames/arrivedat (owner ruling 2026-09-12, pinned by
// scripts/locked-boot-wipe.test.mjs DELIBERATE_KEEPS). The names stay until the parent removes them.
// A parent who trusts the sentence and hands the phone on believes the list is gone when it is not.
//
// The sheet is RENDERED (CLAUDE.md rules 1 and 3 — nothing here greps app/identity.jsx) and the claim it now
// makes — "until you remove them" — is exercised: the Remove button really takes a name off the list.
// The engine truth the sentence rests on (the locked boot keeps the list) is the other file's job.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts } from './render-jsx-screen.mjs';

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const CHURCH = 'c'.repeat(64);
const shown = (n, pred, out = []) => {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(c => shown(c, pred, out)); return out; }
  if (pred(n)) out.push(n);
  (n.kids || []).forEach(c => shown(c, pred, out));
  return out;
};
const said = (tree) => texts(tree).join(' ').replace(/\s+/g, ' ');

function sheet(names) {
  const { React, draw } = miniReact();
  const list = { v: [...names] };
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
    NotifToggleRow: function NotifToggleRow(p) {
      return React.createElement('div', {}, React.createElement('div', {}, p.label), React.createElement('div', {}, p.sub || ''));
    },
    safeCssColor: (c) => c, lsGet: (k, d) => d, lsSet: () => {},
    Math, Date, JSON, Set, Map, Number, String, Array, Promise, Object, isNaN, Boolean, parseInt, parseFloat,
  };
  const mod = loadScreen('app/identity.jsx', ['ChildrenAtChurchSheet'], globals);
  const ctx = { church: { id: 'c1', name: "St Chad's", npub: CHURCH }, safeguard: {}, toast() {}, openHelp() {} };
  const api = { list };
  api.redraw = () => { api.tree = draw(mod.ChildrenAtChurchSheet, { open: true, onClose() {}, ctx }); return api.tree; };
  api.redraw();
  return api;
}

test('the sheet does not say a PIN lock clears the list — the list is deliberately kept', () => {
  const s = sheet(['Mia']);
  const words = said(s.tree);
  assert.match(words, /Mia/, 're-anchor: the name is not on the rendered sheet');
  assert.ok(!/cleared|wiped|erased/i.test(words),
    'THE SHEET PROMISES A WIPE THE APP DOES NOT PERFORM. The locked boot keeps these names on purpose, so a ' +
    'parent who believes this sentence hands on a phone that still lists their children. Screen read: ' + words);
});

test('it says what is true instead: the names stay until the parent removes them', () => {
  const words = said(sheet(['Mia']).tree);
  assert.match(words, /stay on this phone until you remove them, even if you lock the app/,
    'the sheet no longer tells the parent that locking the app does not remove the names. Screen read: ' + words);
});

test('…and the claim is TRUE on the sheet: Remove takes the name off the list', () => {
  const s = sheet(['Mia', 'Noah']);
  const rm = shown(s.tree, n => n.type === 'button' && n.props && n.props['aria-label'] === 'Remove Mia');
  assert.equal(rm.length, 1, 'there is no Remove control for a listed name — "remove them here" would be a false promise');
  rm[0].props.onClick();
  s.redraw();
  assert.deepEqual(s.list.v, ['Noah'], 'Remove did not take the name off the list');
  assert.ok(!/Mia/.test(said(s.tree)), 'the removed name is still on the screen');
});
