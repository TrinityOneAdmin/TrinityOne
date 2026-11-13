// "SHARE THE APP" IS NOT OFFERED ON AN iPHONE; SHARING A BIBLE STILL IS.
// Run: node --test scripts/share-the-app-is-not-offered-on-iphone.test.mjs
//
// Owner, 2026-11-13. "Share the app" shares the ANDROID APK, and iOS cannot install an app from a file. The only
// native check the code had, Capacitor.isNativePlatform(), is true on iOS and Android alike, so on an iOS build
// the row was offered and would have downloaded and shared the Android APK, under "no internet needed".
//
// Entry points to the app-share, grepped across app/ src/ index.html (rule 2): the "Share the app" row in
// ProfileSheet (app/identity.jsx), which calls ctx.openShareApp → setIdSheet('shareapp') (app/app.jsx) → the
// ShareAppSheet mount (app/app.jsx). app.jsx's ?id= deep link admits only recovery / invite / relays, so it
// cannot open 'shareapp'. Each layer is covered here: the row is hidden, the sheet renders nothing, and
// shareTrinityOneApp refuses.
//
// Point of use (rule 1), nothing text-matched in app/*.jsx (rule 3): the REAL ProfileSheet, ShareAppSheet,
// shareTrinityOneApp and InstalledBrowser are compiled and drawn through scripts/render-jsx-screen.mjs with
// Capacitor.getPlatform() stubbed to 'ios', 'android' and 'web'. NOT a device (rule 6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const BIBLE = { url: 'modules/eng-kjv.zip', abbr: 'KJV', name: 'King James Version', kind: 'bible', category: 'bibles' };
const BYTES = new Uint8Array(2048).fill(3);

function capacitor(platform) {
  const shares = [], writes = [], fetches = [];
  const native = platform === 'ios' || platform === 'android';
  const Capacitor = {
    isNativePlatform: () => native, getPlatform: () => platform,
    Plugins: native ? {
      App: { addListener: () => ({ remove() {} }) },
      Filesystem: {
        stat: async () => { throw new Error('File does not exist'); },
        writeFile: async ({ path }) => { writes.push(path); return { uri: 'file:///cache/' + path }; },
        deleteFile: async () => {},
      },
      Share: { share: async (a) => { shares.push(a); return {}; } },
    } : {},
  };
  const fetch = async (u) => { fetches.push(u); return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(1_200_000).buffer }; };
  return { Capacitor, shares, writes, fetches, fetch };
}

const rowText = (tree, label) => find(tree, n => n.props && typeof n.props.onClick === 'function' && texts(n).join(' ').includes(label));

function profile(platform) {
  const { React, draw } = miniReact();
  const cap = capacitor(platform);
  const opened = [];
  const ls = { getItem: () => null, setItem() {}, removeItem() {} };
  const globals = {
    React,
    window: { Fellowship: { myPubkey: 'me', relays: ['wss://one.example'] }, TrinityIdentity: { qrSVG: () => '' },
      TrinityData: {}, Capacitor: cap.Capacitor, TrinityLN: { currency: () => null },
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
  };
  const { ProfileSheet } = loadScreen('app/identity.jsx', ['ProfileSheet'], globals);
  const ctx = {
    church: { id: 'c1', name: "St Chad's", npub: 'npub1' + 'c'.repeat(58) }, safeguard: {}, toast() {}, openHelp() {},
    openChurchSwitcher() {}, openNotifSettings() {}, openCurrency() {}, openShareApp() { opened.push('shareapp'); }, openWallet() {},
    openRelays() {}, openBackup() {}, openAbout() {},
  };
  const tree = draw(ProfileSheet, { open: true, onClose() {},
    identity: { name: 'Sarah Okafor', avatar: null, npub: 'npub1' + 'q'.repeat(58) }, onSave() {}, ctx });
  return { tree, opened };
}

function shareScreens(platform) {
  const { React, draw } = miniReact();
  const cap = capacitor(platform);
  const toasts = [];
  const win = {
    Capacitor: cap.Capacitor,
    Bible: {
      installedMap: () => ({ [BIBLE.url]: BIBLE }), activeVersion: 'KJV', activeUrl: 'modules/other.zip',
      removeModule: async () => true, isInstalled: () => true, subscribe: () => () => {}, versions: () => [],
      exportModule: async (u) => (u === BIBLE.url ? { bytes: BYTES, filename: 'eng-kjv.zip' } : null),
    },
    TrinityData: {}, addEventListener() {}, removeEventListener() {},
  };
  const Icon = Stub('Icon');
  const shared = { React, window: win, Icon, btoa, fetch: cap.fetch, File, Blob, setTimeout: () => 0,
    document: { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} }, addEventListener() {}, removeEventListener() {} } };
  const S = loadScreen('app/share-app.jsx', ['ShareAppSheet', 'shareTrinityOneApp'], {
    ...shared, BottomSheet: ({ open, children }) => (open ? children : null), IconBtn: Stub('IconBtn') });
  const { InstalledBrowser } = loadScreen('app/screens-library.jsx', ['InstalledBrowser'], {
    ...shared, Spinner: Stub('Spinner'), ScreenScroll: (p) => p.children, safeCssColor: (c) => c || 'var(--clay)' });
  const ctx = { toast: (t) => toasts.push(t), openStore() {} };
  return {
    cap, toasts, S, ctx,
    sheet: () => draw(S.ShareAppSheet, { open: true, onClose() {}, ctx }),
    installed: () => draw(InstalledBrowser, { ctx, category: null, force: () => {} }),
  };
}

test('iPhone: the profile has no "Share the app" row', () => {
  const p = profile('ios');
  assert.ok(texts(p.tree).join(' ').includes('Notifications'), 're-anchor: the profile did not render its settings');
  assert.equal(rowText(p.tree, 'Share the app').length, 0, 'an iPhone is offered "Share the app", which shares the Android APK');
});

test('Android and web: the "Share the app" row is there and opens the sheet', () => {
  for (const platform of ['android', 'web']) {
    const p = profile(platform);
    const row = rowText(p.tree, 'Share the app');
    assert.ok(row.length >= 1, `${platform}: the "Share the app" row is missing`);
    row[row.length - 1].props.onClick();
    assert.deepEqual(p.opened, ['shareapp'], `${platform}: the row did not open the Share-the-app sheet`);
  }
});

test('iPhone: the Share-the-app sheet renders nothing (no "Choose a Bible" pointer), and shareTrinityOneApp refuses', async () => {
  const s = shareScreens('ios');
  const tree = s.sheet();
  assert.equal(find(tree, n => n.type === 'button').length, 0, 'the sheet still offers buttons on an iPhone');
  assert.ok(!texts(tree).join(' ').includes('Choose a Bible'), 'the "Choose a Bible" pointer is shown on an iPhone');
  const r = await s.S.shareTrinityOneApp(s.ctx, () => {});
  assert.equal(r.ok, false);
  assert.deepEqual(s.cap.fetches, [], 'the Android APK was downloaded on an iPhone');
  assert.deepEqual(s.cap.shares, [], 'a share was opened on an iPhone');
  assert.equal(s.toasts.length, 1, 'the refusal said nothing');
});

test('Android: the sheet still offers "Share the app" and the "Choose a Bible" pointer (control)', () => {
  const s = shareScreens('android');
  const words = texts(s.sheet()).join(' ');
  assert.ok(words.includes('Share the app') && words.includes('Choose a Bible'), 'the Android sheet lost its controls');
});

test('iPhone: Library → Installed still offers Share on a Bible, and it shares that one file', async () => {
  const s = shareScreens('ios');
  const btn = find(s.installed(), n => n.type === 'button' && texts(n).join(' ').includes('Share'));
  assert.equal(btn.length, 1, 'the Bible row lost its Share button on an iPhone');
  await btn[0].props.onClick();
  assert.equal(s.cap.shares.length, 1, 'the module share did not open on an iPhone');
  assert.equal(s.cap.shares[0].files.length, 1);
  assert.match(s.cap.shares[0].files[0], /\/eng-kjv\.zip$/);
  assert.deepEqual(s.cap.fetches, [], 'sharing a Bible fetched the APK');
});
