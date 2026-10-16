// The MY CHURCH section of the profile is ONE row (owner 2026-10-16):
//   - joined: it is labelled with the church NAME and opens the switcher LIST (switch / follow another live inside it);
//   - not joined: it reads "Join a church" and opens the FOLLOW flow.
// There is no second "Your churches" row. The care batch left a duplicate — two rows that both opened the same
// switcher list — which is what the owner saw on both phones. Either state opens the switcher OVER the profile:
// the handler does NOT call onClose() first, so the switcher (z60) stacks over the profile (z55) instead of
// closing it and landing over the home tab. DEVICE-CONFIRMED on the Oppo 2026-10-16.
//
// POINT OF USE (CLAUDE.md rule 1): drives the REAL ProfileSheet rows off the rendered tree and asserts the row
// count, the switcher mode, and that onClose is never called. No app/*.jsx text-match for behaviour (rule 3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts } from './render-jsx-screen.mjs';

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

function renderProfile(church) {
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
    church, safeguard: {}, toast() {}, openHelp() {},
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

test('joined: the single church-name row opens the switcher LIST over the profile (no duplicate)', () => {
  const church = { id: 'c1', name: "St Chad's", npub: 'npub1' + 'c'.repeat(58) };
  const { tree, log } = renderProfile(church);
  const click = rowClick(tree, "St Chad's");
  assert.ok(click, 're-anchor: the church-name row was not found in the rendered ProfileSheet');
  click();
  assert.deepEqual(log, ['switcher:list'],
    'the church-name row closed the profile before opening the switcher — it lands over the home tab, not the profile');
  assert.ok(!rowClick(tree, 'Your churches'),
    'the duplicate "Your churches" row is back — the MY CHURCH section must be a single row');
});

test('not joined: a "Join a church" row opens the FOLLOW flow over the profile', () => {
  const { tree, log } = renderProfile(null);
  const click = rowClick(tree, 'Join a church');
  assert.ok(click, 're-anchor: the "Join a church" row was not found when no church is joined');
  click();
  assert.deepEqual(log, ['switcher:follow'],
    'the "Join a church" row did not open the follow flow without first closing the profile');
});
