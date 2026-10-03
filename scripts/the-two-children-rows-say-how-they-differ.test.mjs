// THE TWO CHILDREN ROWS SAY WHAT EACH IS FOR. Sim round 2026-10-02, finding #60 ("two near-identical children screens
// for parents").
// Run: node --test scripts/the-two-children-rows-say-how-they-differ.test.mjs
//
// Under MY FAMILY a parent sees "Children at church" and "Children's accounts". They are different jobs - the first is
// the names a parent types for the Sunday check-in desk (kept on this phone, no account anywhere); the second is a real
// account for a child who has their own phone - but their subtitles both talked about "children" and "your church", so
// they read as the same screen twice. The subtitles now say which is which. The LABELS are unchanged on purpose: help
// articles tell parents to tap "Children's accounts".
//
// Consolidating the two screens was the other option in the brief and is NOT done: they hold different data on
// different sides of the relay (one never leaves the phone, one publishes a guardian request), and merging them would
// put the on-phone-only promise next to a control that publishes.
//
// Users of the changed text (rule 2): the two rows are drawn only by ProfileSheet. Their subtitles are not read by any
// other code; scripts/a-parent-shows-a-code-instead-of-typing.test.mjs finds the "Children at church" row by its LABEL,
// which is unchanged, and was run.
//
// HOW IT ASSERTS (rule 3): the real ProfileSheet is drawn and the two rows are read off the tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const CHURCH = 'a'.repeat(64);

function profile() {
  const { React, draw } = miniReact();
  const ls = { getItem: () => null, setItem() {}, removeItem() {} };
  const F = new Proxy({ createChildAccount: async () => ({ ok: true }), relays: ['wss://one.example'], myPubkey: 'b'.repeat(64) }, {
    get(t, k) { if (k in t) return t[k]; if (typeof k === 'string') return () => undefined; return undefined; },
  });
  const globals = {
    React,
    window: { Fellowship: F, TrinityIdentity: { qrSVG: () => '' }, Capacitor: { isNativePlatform: () => false }, TrinityData: { CHURCHES: [], MEMBERS: {} }, TrinityLN: { currency: () => null },
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, localStorage: ls, innerWidth: 390, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) },
    document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
    navigator: { userAgent: '', clipboard: { writeText: async () => {} } }, localStorage: ls,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, console, fetch: async () => ({ ok: false }),
    Icon: Stub('Icon'), IconBtn: Stub('IconBtn'), UserAvatar: Stub('UserAvatar'), AvatarPicker: Stub('AvatarPicker'), QRScanner: Stub('QRScanner'),
    BackupCard: Stub('BackupCard'), ChurchBadge: Stub('ChurchBadge'),
    Overlay: function Overlay(p) { return React.createElement('div', {}, p.open ? p.children : null); },
    BottomSheet: ({ open, children }) => (open ? children : null),
    NotifToggleRow: function NotifToggleRow(p) { return React.createElement('div', {}, String(p.label)); },
    safeCssColor: (c) => c, lsGet: (k, d) => d, lsSet() {}, WALLET_ENABLED: false,
    Math, Date, JSON, Set, Map, Number, String, Array, Promise, Object, isNaN, Boolean, parseInt, parseFloat,
  };
  const mod = loadScreen('app/identity.jsx', ['ProfileSheet'], globals);
  const ctx = { church: { id: 'c1', name: 'St Chad’s', npub: CHURCH }, safeguard: {}, toast() {}, openHelp() {}, openChurchSwitcher() {}, openNotifSettings() {}, openCurrency() {}, openShareApp() {},
    openWallet() {}, openRelays() {}, openBackup() {}, openAbout() {} };
  return draw(mod.ProfileSheet, { open: true, onClose() {}, identity: { name: 'Sarah Okafor', avatar: null, npub: 'npub1' + 'q'.repeat(58) }, onSave() {}, ctx });
}
const row = (tree, label) => {
  const hit = find(tree, n => n.props && typeof n.props.onClick === 'function' && texts(n).join(' ').includes(label))
    .sort((a, b) => texts(a).join(' ').length - texts(b).join(' ').length)[0];   // the innermost match is the row itself
  assert.ok(hit, `no "${label}" row on the You screen - re-anchor this test`);
  return texts(hit).join(' ');
};

test('the two rows say what each is for, in different words', () => {
  const tree = profile();
  const bring = row(tree, 'Children at church');
  const accounts = row(tree, 'Children’s accounts');
  assert.match(bring, /children’s desk/i, 'the first row does not say it is for the Sunday desk');
  assert.match(bring, /no account/i, 'the first row does not say that no account is involved');
  assert.match(accounts, /own phone/i, 'the second row does not say it is for a child with their own phone');
  assert.match(accounts, /link it to you/i, 'the second row does not say it links the child to the parent');
});

test('they are told apart: neither subtitle borrows the other’s distinguishing words', () => {
  const tree = profile();
  const bring = row(tree, 'Children at church');
  const accounts = row(tree, 'Children’s accounts');
  assert.doesNotMatch(bring, /own phone|link it/i);
  assert.doesNotMatch(accounts, /desk|no account/i);
});
