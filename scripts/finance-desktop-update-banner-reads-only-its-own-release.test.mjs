// THE DESKTOP FINANCE PROGRAM'S UPDATE BANNER: ITS OWN MANIFEST, A SEMVER COMPARE, A FIXED LINK, AND IT NEVER DOWNLOADS.
// Run: node --test scripts/finance-desktop-update-banner-reads-only-its-own-release.test.mjs
//
// T1Finance desktop plan §4 + §5 test 7 (unit half; the chromium half is
// scripts/finance-desktop-offers-its-own-update.test.mjs). app/update-check.jsx gains a FOURTH variant,
// 'finance-desktop': it reads ONLY finance-desktop-latest.json's `version`; compares it as SEMVER with
// window.TRINITY_BUILD.version (never parseInt — 1.10.0 is newer than 1.9.0); refuses a prerelease ('-') or anything
// not MAJOR.MINOR.PATCH; builds the link from the version under a FIXED prefix (a url in the manifest is never used);
// keeps its own "Later"; says "download and install it" with an "Open download page" action, never "Downloading…";
// and runs ONLY in the packaged desktop program (window.Steward.packagedOrigin() AND the desktop build stamp, no
// Capacitor). The member / steward / finance-APK variants are unchanged — their own tests prove that
// (finance-update-check-offers-finance-apk, steward-update-check-offers-steward-apk, apk-release-json); the CONTROLs
// here re-check that a desktop environment does not change what they do.
//
// POINT OF USE: the real update-check.jsx compiled into one scope (console-screens.mjs), the real functions called,
// the real banner rendered and its button PRESSED. Nothing is matched in app/*.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const TAG = 'https://github.com/TrinityOneAdmin/TrinityOne/releases/tag/finance-v';
const MANIFEST = 'https://app.trinityone.church/finance-desktop-latest.json';
const SNOOZE = 'trinityone.financeDesktop.updateSnoozed';

function load({ packaged = true, build = { app: 'finance-desktop', version: '1.9.0', sha: '8c30bf1c097e' }, capacitor = null, manifest, snooze, fetchOk = true } = {}) {
  const fr = fakeReact();
  const { window } = fakeBrowser({ Steward: fakeSteward({ hasKey: false, packagedOrigin: () => packaged }) });
  if (build) window.TRINITY_BUILD = build;
  if (capacitor) window.Capacitor = capacitor;
  window.Icon = (props) => fr.React.createElement('span', props);
  const fetched = [];
  let answered; const ready = new Promise((r) => { answered = r; });
  window.fetch = async (u) => { fetched.push(String(u)); answered(); return { ok: fetchOk, json: async () => manifest }; };
  if (snooze !== undefined) window.localStorage.setItem(SNOOZE, snooze);
  const mods = loadConsole({ React: fr.React, window, expr: '{ UpdateBanner, UpdateBannerDesktop, updatePick, updateSemverNewer }', files: ['app/update-check.jsx'] });
  return { fr, window, mods, fetched, ready };
}

// Render the desktop banner (the component UpdateBanner variant='finance-desktop' puts on screen), let the fetch answer.
async function desktopBanner(opts) {
  const L = load(opts);
  L.fr.fresh();
  L.mods.UpdateBannerDesktop(); L.fr.flush();
  await Promise.race([L.ready, new Promise((r) => setTimeout(r, 200))]);
  await new Promise((r) => setTimeout(r, 20));
  L.fr.reset();
  return { ...L, tree: L.mods.UpdateBannerDesktop() };
}
const button = (tree, re) => nodes(tree).filter((n) => n.type === 'button').find((n) => texts(n).some((t) => re.test(t)));

test('updatePick(m, "finance-desktop"): only `version`, only a final MAJOR.MINOR.PATCH, and the link is the fixed tag page', () => {
  const { mods } = load();
  assert.deepEqual({ ...mods.updatePick({ version: '1.10.0' }, 'finance-desktop') }, { latest: '1.10.0', pageUrl: TAG + '1.10.0', snoozeKey: SNOOZE });
  // a hostile manifest: every url-ish field is ignored, the link is built from the version
  const hostile = mods.updatePick({ version: '2.0.0', url: 'https://evil.example/x.exe', pageUrl: 'https://evil.example/', financeUrl: 'evil.apk', link: 'javascript:alert(1)' }, 'finance-desktop');
  assert.equal(hostile.pageUrl, TAG + '2.0.0');
  for (const bad of ['1.2.0-rc1', '1.2.0-rc.1', '1.2.0+build5', '1.2', '1.2.0.0', 'v1.2.0', ' 1.2.0', '1.2.0 ', '01.2.0', '1.02.0', '1.2.x', '', '1.2.0/../../evil', '1.2.0?x=1', '1234567.0.0']) {
    assert.equal(mods.updatePick({ version: bad }, 'finance-desktop'), null, JSON.stringify(bad) + ' was offered');
  }
  for (const m of [null, undefined, {}, { version: 120 }, { version: ['1.2.0'] }, { versionCode: 999, versionName: '9.9.9', financeVersionCode: 999, financeUrl: 'trinityone-finance.apk' }]) {
    assert.equal(mods.updatePick(m, 'finance-desktop'), null, JSON.stringify(m) + ' was offered (the APK rows are not this program\'s)');
  }
});

test('updateSemverNewer: semver, not parseInt — 1.10.0 > 1.9.0 — and a final release outranks its own prerelease', () => {
  const { mods } = load();
  const n = mods.updateSemverNewer;
  assert.equal(n('1.10.0', '1.9.0'), true, '1.10.0 must be newer than 1.9.0 (parseInt/string compare says otherwise)');
  assert.equal(n('1.9.0', '1.10.0'), false);
  assert.equal(n('2.0.0', '1.99.99'), true);
  assert.equal(n('1.2.10', '1.2.9'), true);
  assert.equal(n('1.2.0', '1.2.0'), false, 'the same version is not newer');
  assert.equal(n('1.1.9', '1.2.0'), false, 'an older version is not newer');
  assert.equal(n('1.2.0', '1.2.0-rc1'), true, 'the final release is newer than the installed rc of it');
  assert.equal(n('1.2.0-rc1', '1.2.0'), false);
  assert.equal(n('1.2.0', 'garbage'), false, 'an unreadable installed version is never "older"');
  assert.equal(n('1.2.0', undefined), false);
});

test('a newer final release: the banner says "download and install it", and "Open download page" opens EXACTLY the tag page — never a download', async () => {
  const { tree, window, fetched, fr, mods } = await desktopBanner({ manifest: { version: '1.10.0', url: 'https://evil.example/TrinityOneFinance.exe' } });
  assert.notEqual(tree, null, 'no banner for 1.10.0 over an installed 1.9.0');
  assert.deepEqual(fetched.map((u) => u.split('?')[0]), [MANIFEST], 'the desktop banner read a manifest other than finance-desktop-latest.json');
  const words = texts(tree).join(' ');
  assert.match(words, /A newer TrinityOne Finance is ready — download and install it\./);
  assert.match(words, /1\.10\.0/);
  assert.doesNotMatch(words, /Downloading|ready to install\b/, 'the desktop banner claims to download or install by itself');
  assert.ok(!button(tree, /^Update$/), 'an APK-style "Update" button is on the desktop banner');
  const open = button(tree, /^Open download page$/);
  assert.ok(open, 'no "Open download page" button');
  const opened = [];
  window.open = (u, t) => { opened.push([u, t]); return null; };
  open.props.onClick();
  assert.deepEqual(opened, [[TAG + '1.10.0', '_blank']], 'the button did not open exactly the fixed tag page in a new window');
  assert.equal(window.localStorage.getItem(SNOOZE), null, 'opening the page snoozed it — the update is not installed yet, it must return next launch');
  fr.reset();
  assert.equal(mods.UpdateBannerDesktop(), null, 'the banner stayed up after its page was opened');
});

test('no banner: same version, older, prerelease, malformed, a failed fetch — and "Later" holds for that version only', async () => {
  for (const manifest of [{ version: '1.9.0' }, { version: '1.8.12' }, { version: '1.10.0-rc1' }, { version: 'one.ten' }, { version: '' }, {}, null]) {
    assert.equal((await desktopBanner({ manifest })).tree, null, 'a banner for ' + JSON.stringify(manifest));
  }
  assert.equal((await desktopBanner({ manifest: { version: '1.10.0' }, fetchOk: false })).tree, null, 'a banner from a failed fetch');
  // Later: stored per version, under the program's OWN key
  const L = await desktopBanner({ manifest: { version: '1.10.0' } });
  button(L.tree, /^Later$/).props.onClick();
  assert.equal(L.window.localStorage.getItem(SNOOZE), '1.10.0');
  for (const k of ['trinityone.updateSnoozed', 'trinityone.steward.updateSnoozed', 'trinityone.finance.updateSnoozed']) assert.equal(L.window.localStorage.getItem(k), null, 'Later wrote ' + k);
  assert.equal((await desktopBanner({ manifest: { version: '1.10.0' }, snooze: '1.10.0' })).tree, null, '"Later" for 1.10.0 did not hold');
  assert.notEqual((await desktopBanner({ manifest: { version: '1.11.0' }, snooze: '1.10.0' })).tree, null, '"Later" for 1.10.0 hid 1.11.0');
});

test('the gate: not packaged, no desktop stamp, another app\'s stamp, or under Capacitor → no fetch and no banner', async () => {
  for (const [what, opts] of [
    ['a web page (not packaged)', { packaged: false }],
    ['no build stamp', { build: null }],
    ['a stamp from another app', { build: { app: 'finance', version: '1.9.0', sha: 'x' } }],
    ['the Android APK (Capacitor native)', { capacitor: { isNativePlatform: () => true, Plugins: {} } }],
  ]) {
    const r = await desktopBanner({ ...opts, manifest: { version: '9.0.0' } });
    assert.equal(r.tree, null, what + ': a desktop banner');
    assert.deepEqual(r.fetched, [], what + ': the desktop manifest was fetched');
  }
});

test('UpdateBanner variant="finance-desktop" puts the desktop banner on screen; CONTROL: the APK variants still read apk-latest.json, need Capacitor, and ignore the desktop manifest', async () => {
  const { fr, mods } = load({ manifest: { version: '9.0.0' } });
  fr.fresh();
  const el = mods.UpdateBanner({ variant: 'finance-desktop' });
  assert.equal(el && el.type, mods.UpdateBannerDesktop, 'variant "finance-desktop" does not render the desktop banner');
  // in the desktop program, with no Capacitor, the APK variants do nothing at all (they are native-only, as before)
  for (const variant of [undefined, 'steward', 'finance']) {
    const L = load({ manifest: { version: '9.0.0', versionCode: 999, url: 'x.apk', stewardVersionCode: 999, stewardUrl: 'y.apk', financeVersionCode: 999, financeUrl: 'z.apk' } });
    L.fr.fresh();
    L.mods.UpdateBanner(variant ? { variant } : {}); L.fr.flush();
    await new Promise((r) => setTimeout(r, 30));
    L.fr.reset();
    assert.equal(L.mods.UpdateBanner(variant ? { variant } : {}), null, (variant || 'member') + ' showed a banner without Capacitor');
    assert.deepEqual(L.fetched, [], (variant || 'member') + ' fetched without Capacitor');
  }
  // and an APK variant never reads the desktop manifest's version
  const { mods: m2 } = load();
  for (const v of [undefined, 'member', 'steward', 'finance']) assert.equal(m2.updatePick({ version: '9.9.9' }, v), null, (v || 'member') + ' read the desktop manifest\'s version');
  // CONTROL: the APK rows still pick exactly as before
  assert.deepEqual({ ...m2.updatePick({ stewardVersionCode: '201', stewardUrl: 'trinityone-steward.apk' }, 'steward') }, { latest: 201, apkUrl: 'https://app.trinityone.church/trinityone-steward.apk', snoozeKey: 'trinityone.steward.updateSnoozed' });
});
