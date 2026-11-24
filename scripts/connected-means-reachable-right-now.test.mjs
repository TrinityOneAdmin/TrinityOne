// "CONNECTED" MEANS CONNECTED RIGHT NOW — NOT "PROVED ONCE, GREEN FOR EVER".
//   Run: node --test scripts/connected-means-reachable-right-now.test.mjs
//
// Owner decision 2026-11-24. The Relays sheet and the profile's "N connected" row used to call a box
// Connected on PROOF alone, so the list could only ever grow greener. Now a proved box must also answer a
// live probe (Fellowship.relayStatus — throwaway WS, 2.5s timeout) before the screen says Connected; a proved
// box the probe cannot reach reads "Not reachable", and while the probe is still out it reads "Checking" —
// never a flash of "Not reachable" over a box that is merely un-asked.
//
// WHAT MUST NOT MOVE WITH LIVENESS: Remove. canRemove keys off PROOF (plus the canonical exclusion) — a
// proved box that is briefly offline must NEVER grow a Remove button, because removing a church's
// briefly-offline relay removes the church.
//
// POINT OF USE (CLAUDE.md rule 1) + rule 3: this RENDERS the real RelaysSheet and the real ProfileSheet
// through the mini-React harness and reads the tree. Deleting the liveness condition from the SCREEN (not
// the engine) makes these go red — proved by scoped sabotage at build time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, reads } from './render-jsx-screen.mjs';

// Two addresses of ONE self-hosting box (same proved key), one more box, and a stranger still being checked.
const A1 = 'wss://box-a.tunnel.example/relay';
const A2 = 'wss://10.0.0.5/relay';
const B  = 'wss://box-b.example/relay';
const S1 = 'wss://stranger-one.example/relay';
const S2 = 'wss://canon-stranger.example/relay';
const KEY_A = 'a'.repeat(64), KEY_B = 'b'.repeat(64);
const KEYS = { [A1]: KEY_A, [A2]: KEY_A, [B]: KEY_B };

const tick = () => new Promise(r => setImmediate(r));

// ── the Relays sheet ──────────────────────────────────────────────────────────────────────────────────────
// `probe` maps url -> 'on'|'off'; probe === null means "the probe never answers" (a pending promise).
function sheet({ probe, canon = [] }) {
  const { React, draw } = miniReact();
  const listeners = {};
  const verified = { [A1]: true, [A2]: true, [B]: true, [S1]: false, [S2]: false };
  const g = {
    React,
    Icon: () => null,
    IconBtn: () => null,
    BottomSheet: ({ children }) => React.createElement('div', null, children),
    window: {
      Fellowship: {
        relays: [A1, A2, B, S1, S2],
        relayDetail: (u) => ({ verified: !!verified[u], key: verified[u] ? (KEYS[u] || '') : '' }),
        relayVerified: (u) => !!verified[u],
        relayStatus: () => probe === null
          ? new Promise(() => {})
          : Promise.resolve(Object.keys(probe).map(u => ({ url: u, status: probe[u] }))),
        removeRelay: () => true,
        CANONICAL_RELAYS: canon,
      },
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

test('a proved box the probe cannot reach does NOT say Connected — it says Not reachable', async () => {
  const s = sheet({ probe: { [A1]: 'off', [A2]: 'off', [B]: 'off', [S1]: 'off', [S2]: 'off' } });
  s.render();          // mount: the open-probe fires
  await tick();        // the probe answers 'off' for everything
  const t = s.render();
  assert.equal(s.statusCount(t, 'Connected'), 0,
    'a proved box whose socket probe said OFF is still shown as Connected — the screen is reporting the old ' +
    'proof-once-forever meaning, not connected-right-now');
  assert.equal(s.statusCount(t, 'Not reachable'), 2,
    'the two proved-but-unreachable boxes did not get their own "Not reachable" state');
});

test('a proved box the probe DOES reach says Connected; one box is as reachable as its best address', async () => {
  // Box A: tunnel address answers, LAN address does not -> the BOX is connected. Box B: unreachable.
  const s = sheet({ probe: { [A1]: 'on', [A2]: 'off', [B]: 'off', [S1]: 'off', [S2]: 'off' } });
  s.render();
  await tick();
  const t = s.render();
  assert.equal(s.statusCount(t, 'Connected'), 1, 'the proved box whose probe answered ON is not shown Connected');
  assert.equal(s.statusCount(t, 'Not reachable'), 1, 'the proved box whose probe answered OFF is not shown Not reachable');
});

test('while the probe is still out, a proved box reads Checking — never a flash of Not reachable', () => {
  const s = sheet({ probe: null });   // the probe never answers
  const t = s.render();
  assert.equal(s.statusCount(t, 'Not reachable'), 0,
    'the sheet flashed "Not reachable" over proved boxes the probe had not answered for yet');
  assert.equal(s.statusCount(t, 'Connected'), 0,
    'the sheet said Connected before the probe answered — that is proof-only Connected again');
  assert.equal(s.statusCount(t, 'Checking'), 2, 'the two proved boxes are not in the pending Checking state');
});

test('Remove keys off PROOF, never liveness: an offline proved box gets none, a stranger still gets one', async () => {
  const s = sheet({ probe: { [A1]: 'off', [A2]: 'off', [B]: 'off', [S1]: 'off', [S2]: 'off' }, canon: [S2] });
  s.render();
  await tick();
  let t = s.render();
  // The proved boxes sit in the lead section, offline, with NO Remove control anywhere on their rows.
  assert.equal(s.btn(t, /Stop using box-a/).length, 0,
    'a proved box that is briefly offline grew a "Stop using" control — Remove is keying off liveness, and a ' +
    'member can now remove their church\'s relay because its socket dropped');
  assert.equal(s.btn(t, /Stop using 10\.0\.0\.5/).length, 0, 'the proved box\'s second address grew a Remove control');
  assert.equal(s.btn(t, /Stop using box-b/).length, 0, 'proved box B grew a Remove control while offline');
  // The unproven stranger, behind the disclosure, still offers Remove…
  s.btn(t, /Addresses being checked/)[0].props.onClick();
  t = s.render();
  assert.equal(s.btn(t, /Stop using stranger-one/).length, 1, 'the unproven address lost its Remove control');
  // …and the canonical exclusion still holds: a shipped default is not removable even unproven.
  assert.equal(s.btn(t, /Stop using canon-stranger/).length, 0, 'a canonical address is offering Remove');
});

// ── the profile's "N connected" row ──────────────────────────────────────────────────────────────────────
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

function profile({ probe }) {
  const { React, draw } = miniReact();
  const listeners = {};
  const verified = { [A1]: true, [A2]: true, [B]: true };
  const ls = { getItem: () => null, setItem() {}, removeItem() {} };
  const globals = {
    React,
    window: {
      Fellowship: {
        myPubkey: 'me', relays: [A1, A2, B],
        relayDetail: (u) => ({ verified: !!verified[u], key: verified[u] ? (KEYS[u] || '') : '' }),
        relayVerified: (u) => !!verified[u],
        relayStatus: () => probe === null
          ? new Promise(() => {})
          : Promise.resolve(Object.keys(probe).map(u => ({ url: u, status: probe[u] }))),
      },
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
  // Draw to a fixed point: a probe answer that landed between draws recounts in an effect, which the NEXT
  // draw paints — same settle loop the sheet harness above uses.
  const render = () => { let t; for (let i = 0; i < 3; i++) t = draw(mod.ProfileSheet, { open: true, onClose() {}, identity: { name: 'Sarah Okafor', avatar: null, npub: 'npub1' + 'q'.repeat(58), steward: false }, onSave() {}, ctx }); return t; };
  const connected = (t) => { const m = reads(t).match(/(\d+)\s+connected/); return m ? Number(m[1]) : null; };
  return { render, connected };
}

test('"N connected" does not count a proved box the probe says is off', async () => {
  const p = profile({ probe: { [A1]: 'off', [A2]: 'off', [B]: 'off' } });
  p.render();          // mount: the open-probe fires
  await tick();
  const t = p.render();
  assert.equal(p.connected(t), 0,
    'three proved addresses, all unreachable, and the row still counted them — the count is proof-only, not ' +
    'connected-right-now');
});

test('"N connected" counts proved AND live BOXES, deduped per key', async () => {
  // Box A reachable on one of its two addresses, box B reachable: 2 boxes, not 3 addresses.
  const p = profile({ probe: { [A1]: 'on', [A2]: 'off', [B]: 'on' } });
  p.render();
  await tick();
  assert.equal(p.connected(p.render()), 2,
    'proved-and-live boxes did not count as 2 — either liveness is ignored or addresses are counted instead of boxes');
  // Both of box A's addresses live, B down: still ONE box.
  const q = profile({ probe: { [A1]: 'on', [A2]: 'on', [B]: 'off' } });
  q.render();
  await tick();
  assert.equal(q.connected(q.render()), 1,
    'one box reached by two live addresses counted twice, or the unreachable box counted');
});
