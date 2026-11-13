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
// Capacitor.getPlatform() stubbed to 'ios', 'android' and 'web', and — for iOS in a browser, where Capacitor says
// 'web' — navigator stubbed as iPhone Safari, as an iPad that reports itself as a Mac, and as a real Mac. NOT a
// device (rule 6); the user-agent strings are representative, not captured from these devices.
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

// navigator, as each browser presents itself
const NAV = {
  none: { userAgent: '', platform: '', maxTouchPoints: 0 },
  iphoneSafari: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 },
  ipadAsMac: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 },
  macDesktop: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 0 },
  // An Android tablet whose MODEL contains "iPad" (Chuwi HiPad X) — representative strings, not captured from one.
  hipadWebView: { userAgent: 'Mozilla/5.0 (Linux; Android 11; HiPad X Build/RP1A.200720.011; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Safari/537.36', platform: 'Linux armv8l', maxTouchPoints: 10 },
  hipadChrome: { userAgent: 'Mozilla/5.0 (Linux; Android 11; HiPad X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', platform: 'Linux armv8l', maxTouchPoints: 10 },
  android: { userAgent: 'Mozilla/5.0 (Linux; Android 12; CPH2477) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36', platform: 'Linux armv8l', maxTouchPoints: 5 },
};

const rowText = (tree, label) => find(tree, n => n.props && typeof n.props.onClick === 'function' && texts(n).join(' ').includes(label));

function profile(platform, nav = NAV.none) {
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
    navigator: { ...nav, clipboard: { writeText: async () => {} } },
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
  // the real share-app.jsx sets window.shareAppOnIos, which the profile row asks — as in the app
  loadScreen('app/share-app.jsx', ['shareAppOnIos'], { React, window: globals.window, navigator: nav, btoa });
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

function shareScreens(platform, nav = NAV.none) {
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
  const shared = { React, window: win, Icon, btoa, fetch: cap.fetch, File, Blob, setTimeout: () => 0, navigator: nav,
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

// ── iOS in a BROWSER (owner: off iPhone means off iPhone Safari and the Home-Screen web app too) ───────────────
for (const [label, nav] of [['iPhone Safari', NAV.iphoneSafari], ['an iPad reporting itself as a Mac', NAV.ipadAsMac]]) {
  test(`${label} (Capacitor says 'web'): no "Share the app" row, no sheet, no APK — and a Bible is still shared`, async () => {
    const p = profile('web', nav);
    assert.ok(texts(p.tree).join(' ').includes('Notifications'), 're-anchor: the profile did not render its settings');
    assert.equal(rowText(p.tree, 'Share the app').length, 0, `${label} is offered "Share the app", which downloads the Android APK`);

    const s = shareScreens('web', nav);
    assert.equal(find(s.sheet(), n => n.type === 'button').length, 0, `${label}: the Share-the-app sheet still renders`);
    const r = await s.S.shareTrinityOneApp(s.ctx, () => {});
    assert.equal(r.ok, false, `${label}: shareTrinityOneApp did not refuse`);
    assert.equal(s.toasts.length, 1, `${label}: the refusal said nothing`);

    const btn = find(s.installed(), n => n.type === 'button' && texts(n).join(' ').includes('Share'));
    assert.equal(btn.length, 1, `${label}: the Bible row lost its Share button`);
  });
}

for (const [label, nav] of [['a Mac desktop browser', NAV.macDesktop], ['Android Chrome', NAV.android]]) {
  test(`${label} (control): the "Share the app" row is there`, () => {
    const p = profile('web', nav);
    assert.ok(rowText(p.tree, 'Share the app').length >= 1, `${label} lost the "Share the app" row`);
    const s = shareScreens('web', nav);
    assert.ok(texts(s.sheet()).join(' ').includes('Share the app'), `${label}: the Share-the-app sheet renders nothing`);
  });
}

// ── an Android tablet called "HiPad" is not an iPad (audit of a7d5f406, N1) ───────────────────────────────────
test('the Android APP on a "HiPad X" tablet keeps "Share the app", and the sheet shares the APK', async () => {
  const p = profile('android', NAV.hipadWebView);
  const row = rowText(p.tree, 'Share the app');
  assert.ok(row.length >= 1, 'the APK on an Android tablet called HiPad hides "Share the app"');
  row[row.length - 1].props.onClick();
  assert.deepEqual(p.opened, ['shareapp']);

  const s = shareScreens('android', NAV.hipadWebView);
  const go = find(s.sheet(), n => n.type === 'button' && texts(n).join(' ').includes('Share the app'));
  assert.equal(go.length, 1, 'the sheet renders no "Share the app" button on the HiPad');
  await go[0].props.onClick();
  assert.equal(s.cap.shares.length, 1, 'the APK was not shared on the HiPad');
  assert.match(s.cap.shares[0].files[0], /\/TrinityOne\.apk$/);
  assert.deepEqual(s.toasts, []);
});

test('Android Chrome on a "HiPad" tablet (Capacitor says web) keeps the "Share the app" row', () => {
  const p = profile('web', NAV.hipadChrome);
  assert.ok(rowText(p.tree, 'Share the app').length >= 1, 'a browser whose UA says "HiPad" was taken for an iPad');
  const s = shareScreens('web', NAV.hipadChrome);
  assert.ok(texts(s.sheet()).join(' ').includes('Share the app'), 'the sheet renders nothing for a HiPad browser');
});
