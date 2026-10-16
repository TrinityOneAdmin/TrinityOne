// A member who taps "Your churches" (or the church-name row) in the profile must land the church switcher OVER
// the profile, not over the home tab behind it. The two handlers used to call onClose() first, which closed the
// ProfileSheet and dropped the app back to whatever tab was behind it (Today/Community) BEFORE the switcher
// opened. DEVICE-CONFIRMED on the Oppo 2026-10-16: the sheet opened over the Today home page, losing the profile
// context. The fix removes onClose() from both handlers so the switcher (z=60) simply stacks over the profile
// (z=55); back/escape already return to the profile.
//
// POINT OF USE (CLAUDE.md rule 1): this drives the REAL ProfileSheet rows off the rendered tree and asserts
// onClose is never called when the switcher opens. Restoring onClose() in either handler makes the recorded log
// start with 'close' and this test goes red. It does NOT text-match app/*.jsx for behaviour (rule 3): the row's
// own onClick is invoked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts } from './render-jsx-screen.mjs';

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

function renderProfile() {
  const { React, draw } = miniReact();
  const log = [];
  const ls = { getItem: () => null, setItem() {}, removeItem() {} };
  const globals = {
    React,
    window: { Fellowship: { myPubkey: 'me', relays: ['wss://one.example'] }, TrinityIdentity: { qrSVG: () => '' },
      TrinityData: {}, Capacitor: { isNativePlatform: () => false }, TrinityLN: { currency: () => null },
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, localStorage: ls, innerWidth: 390,
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) },
    document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
    navigator: { userAgent: '', clipboard: { writeText: async () => {} } },
    localStorage: ls,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, console, fetch: async () => ({ ok: false }),
    Icon: Stub('Icon'), IconBtn: Stub('IconBtn'), UserAvatar: Stub('UserAvatar'), AvatarPicker: Stub('AvatarPicker'),
    QRScanner: Stub('QRScanner'), BackupCard: Stub('BackupCard'), ChurchBadge: Stub('ChurchBadge'),
    Overlay: function Overlay(p) { return React.createElement('div', {}, p.open ? p.children : null); },
    BottomSheet: ({ open, children }) => (open ? children : null),
    NotifToggleRow: function NotifToggleRow(p) { return React.createElement('div', {}, String(p.label)); },
    safeCssColor: (c) => c, lsGet: (k, d) => d, lsSet: () => {},
    WALLET_ENABLED: false,
    Math, Date, JSON, Set, Map, Number, String, Array, Promise, Object, isNaN, Boolean, parseInt, parseFloat,
  };
  const mod = loadScreen('app/identity.jsx', ['ProfileSheet'], globals);
  const ctx = {
    church: { id: 'c1', name: "St Chad's", npub: 'npub1' + 'c'.repeat(58) },
    safeguard: {}, toast() {}, openHelp() {},
    openChurchSwitcher(mode) { log.push('switcher:' + mode); },
    openNotifSettings() {}, openCurrency() {}, openShareApp() {}, openWallet() {},
    openRelays() {}, openBackup() {}, openAbout() {},
  };
  const onClose = () => log.push('close');
  const tree = draw(mod.ProfileSheet, { open: true, onClose,
    identity: { name: 'Sarah Okafor', avatar: null, npub: 'npub1' + 'q'.repeat(58) }, onSave() {}, ctx });
  return { tree, log };
}

// The first clickable node on the rendered tree whose visible text contains `label`, returning its onClick.
function rowClick(tree, label) {
  let hit = null;
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    const t = texts(n).join(' ').replace(/\s+/g, ' ').trim();
    if (!hit && n.props && typeof n.props.onClick === 'function' && t.includes(label)) hit = n.props.onClick;
    (n.kids || []).forEach(walk);
  })(tree);
  return hit;
}

test('tapping "Your churches" opens the switcher OVER the profile, not the home tab', () => {
  const { tree, log } = renderProfile();
  const click = rowClick(tree, 'Your churches');
  assert.ok(click, 're-anchor: the "Your churches" row was not found in the rendered ProfileSheet');
  click();
  assert.deepEqual(log, ['switcher:list'],
    'the "Your churches" row closed the profile before opening the switcher, so the sheet lands over the home ' +
    'tab behind it rather than the profile it was launched from (onClose must not be called first)');
});

test('the church-name row also opens the switcher without first closing the profile', () => {
  const { tree, log } = renderProfile();
  const click = rowClick(tree, "St Chad's");
  assert.ok(click, 're-anchor: the church-name row was not found in the rendered ProfileSheet');
  click();
  assert.deepEqual(log, ['switcher:list'],
    'the church-name row closed the profile before opening the switcher');
});
