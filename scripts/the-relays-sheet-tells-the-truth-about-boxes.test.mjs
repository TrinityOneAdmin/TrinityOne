// THE RELAYS SHEET, AND THE "N connected" ROW, TELL THE TRUTH ABOUT BOXES — NOT ADDRESSES.
//   Run: node --test scripts/the-relays-sheet-tells-the-truth-about-boxes.test.mjs
//
// C3 (PLAN-relay-autoconnect-selfhealing-sync-2026-11-20). A self-hosting box is reached by several addresses
// (a tunnel name plus a LAN address, say) and proves ONE key; the sheet must group those into one row, lead
// with the boxes actually in use, and tuck the addresses still being checked under a collapsed disclosure so a
// cold boot does not look empty. The "N connected" row on the profile must count those BOXES, not raw
// addresses, and must follow the gate's background proofs rather than painting a stale 0.
//
// POINT OF USE (CLAUDE.md rule 1) + rule 3: this RENDERS the real RelaysSheet and the real ProfileSheet
// through the mini-React harness and reads the tree. No app/*.jsx text-match for behaviour — deleting the
// grouping, the disclosure or the subscription makes these go red on the SCREEN, which is the only claim that
// matters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, reads } from './render-jsx-screen.mjs';

// Two addresses of ONE self-hosting box (same proved key), one more box, and two strangers still being checked.
const A1 = 'wss://box-a.tunnel.example/relay';
const A2 = 'wss://10.0.0.5/relay';
const B  = 'wss://box-b.example/relay';
const S1 = 'wss://stranger-one.example/relay';
const S2 = 'wss://stranger-two.example/relay';
const KEY_A = 'a'.repeat(64), KEY_B = 'b'.repeat(64);

// relayDetail answers from a mutable verified map, so a test can flip a proof and fire the event the gate fires.
function detailFor(verified) {
  const K = { [A1]: KEY_A, [A2]: KEY_A, [B]: KEY_B };
  return (u) => ({ verified: !!verified[u], key: verified[u] ? (K[u] || '') : '' });
}

function sheet() {
  const { React, draw } = miniReact();
  const listeners = {};
  const verified = { [A1]: true, [A2]: true, [B]: true, [S1]: false, [S2]: false };
  const g = {
    React,
    Icon: () => null,
    IconBtn: () => null,
    BottomSheet: ({ children }) => React.createElement('div', null, children),
    window: {
      Fellowship: { relays: [A1, A2, B, S1, S2], relayDetail: detailFor(verified), relayVerified: (u) => !!verified[u], removeRelay: () => true, CANONICAL_RELAYS: [] },
      TrinityData: { RELAYS: [] },
      addEventListener(n, fn) { (listeners[n] = listeners[n] || []).push(fn); },
      removeEventListener(n, fn) { listeners[n] = (listeners[n] || []).filter(f => f !== fn); },
      localStorage: { getItem: () => null, setItem() {} },
    },
  };
  const { RelaysSheet } = loadScreen('app/identity-extras.jsx', ['RelaysSheet'], g);
  const render = () => { let t; for (let i = 0; i < 3; i++) t = draw(RelaysSheet, { open: true, onClose() {}, ctx: {} }); return t; };
  const btn = (t, re) => find(t, n => n.type === 'button' && re.test(String((n.props && n.props['aria-label']) || '')));
  const statusCount = (t, word) => find(t, n => n.type === 'span' && reads(n) === word).length;
  return { render, btn, statusCount };
}

test('one row per BOX: two addresses that proved the same key show once', () => {
  const s = sheet();
  const t = s.render();
  // Box A (two addresses, one key) + Box B = two Connected rows, not three.
  assert.equal(s.statusCount(t, 'Connected'), 2,
    'the two addresses of one self-hosting box did not collapse to a single row — the sheet groups by URL, not ' +
    'by the proved key, so one machine is shown as two');
});

test('verified boxes lead; the addresses being checked are under a collapsed disclosure', () => {
  const s = sheet();
  const t = s.render();
  const disc = s.btn(t, /Addresses being checked \(2\)/);
  assert.equal(disc.length, 1, 'the two unproven strangers are not behind an "Addresses being checked (2)" disclosure');
  // Collapsed by default: the stranger rows (their "Not in use" status) are not on the screen yet…
  assert.equal(s.statusCount(t, 'Not in use'), 0, 'the collapsed disclosure is already showing the unproven rows');
  // …and the verified boxes are shown ABOVE the disclosure, not hidden until a proof lands (cached-paints-first).
  const txt = reads(t);
  assert.ok(txt.indexOf('Connected') >= 0 && txt.indexOf('Connected') < txt.indexOf('Addresses being checked'),
    'the verified boxes are not shown first, above the "being checked" disclosure');
});

test('opening the disclosure reveals the addresses being checked', () => {
  const s = sheet();
  s.btn(s.render(), /Addresses being checked/)[0].props.onClick();
  const t = s.render();
  assert.equal(s.statusCount(t, 'Not in use'), 2, 'opening the disclosure did not reveal the two unproven addresses');
});

test('collapsing the disclosure clears a half-finished "stop using"', () => {
  const s = sheet();
  // open the disclosure, arm a stranger's confirmation
  s.btn(s.render(), /Addresses being checked/)[0].props.onClick();
  let t = s.render();
  s.btn(t, /Stop using stranger-one/)[0].props.onClick();
  t = s.render();
  assert.equal(s.btn(t, /Confirm: stop using stranger-one/).length, 1, 'fixture: the confirmation did not arm');
  // collapse the disclosure…
  s.btn(t, /Addresses being checked/)[0].props.onClick();
  // …and reopen it: the destructive "Confirm" must not be sitting armed where the harmless button belongs
  s.btn(s.render(), /Addresses being checked/)[0].props.onClick();
  t = s.render();
  assert.equal(s.btn(t, /Confirm: stop using stranger-one/).length, 0,
    'the disclosure reopened with "Confirm: stop using" still armed — a half-finished drop survived the collapse');
});

// ── the profile's "N connected" row ──────────────────────────────────────────────────────────────────────
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

function profile() {
  const { React, draw } = miniReact();
  const listeners = {};
  const verified = { [A1]: false, [A2]: false, [B]: false };
  const ls = { getItem: () => null, setItem() {}, removeItem() {} };
  const globals = {
    React,
    window: {
      Fellowship: { myPubkey: 'me', relays: [A1, A2, B], relayDetail: detailFor(verified), relayVerified: (u) => !!verified[u] },
      TrinityIdentity: { qrSVG: () => '' }, TrinityData: {}, Capacitor: { isNativePlatform: () => false }, TrinityLN: { currency: () => null },
      addEventListener(n, fn) { (listeners[n] = listeners[n] || []).push(fn); },
      removeEventListener(n, fn) { listeners[n] = (listeners[n] || []).filter(f => f !== fn); },
      dispatchEvent(e) { for (const fn of listeners[e && e.type] || []) fn(e); },
      localStorage: ls, innerWidth: 390, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    },
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
  const ctx = { church: { id: 'c1', name: "St Chad's", npub: 'npub1' + 'c'.repeat(58) }, safeguard: {}, toast() {}, openHelp() {},
    openChurchSwitcher() {}, openNotifSettings() {}, openCurrency() {}, openShareApp() {}, openWallet() {}, openRelays() {}, openBackup() {}, openAbout() {},
    openRecovery() {}, openMovePhone() {}, openRestore() {}, openCommunitySecurity() {}, openInvite() {} };
  const render = () => draw(mod.ProfileSheet, { open: true, onClose() {}, identity: { name: 'Sarah Okafor', avatar: null, npub: 'npub1' + 'q'.repeat(58), steward: false }, onSave() {}, ctx });
  const prove = () => { verified[A1] = verified[A2] = verified[B] = true; globals.window.dispatchEvent({ type: 'trinity-relays-verified' }); };
  const connected = (t) => { const m = reads(t).match(/(\d+)\s+connected/); return m ? Number(m[1]) : null; };
  return { render, prove, connected };
}

test('"N connected" counts proved boxes and starts at the cold-boot truth, not the raw list', () => {
  const p = profile();
  // Three addresses, none proved yet: the honest count is 0, NOT "3 connected".
  assert.equal(p.connected(p.render()), 0,
    'the row counted raw addresses (3) before any relay proved itself — a cold-boot overclaim');
});

test('…and it updates — to the BOX count — when the gate fires trinity-relays-verified', () => {
  const p = profile();
  p.render();            // mount: register the listener
  p.prove();             // the gate proves all three addresses and fires the event
  const t = p.render();
  assert.equal(p.connected(t), 2,
    'after the proofs landed the row still showed its old count, or counted 3 addresses instead of 2 boxes — it ' +
    'does not subscribe to trinity-relays-verified, or it counts addresses not boxes');
});
