// THE FINANCE APP OFFERS THE FINANCE APK — AND NOTHING WHEN THE MANIFEST HAS NO FINANCE ROW.
//   Run: node --test scripts/finance-update-check-offers-finance-apk.test.mjs
//
// T1Finance M2. UpdateBanner used to be two-way (variant==='steward' else member), so the finance app — which passes
// variant="finance" — would have read the MEMBER row and offered trinityone.apk: a different applicationId, installed
// as a second app, leaving the finance app as it was. It is three-way now: the finance app reads financeVersionCode /
// financeUrl and its own "Later", and with either field missing it shows NOTHING (no fallback url, unlike the other two).
// That StewardRoot passes variant="finance" on finance.html is proven in scripts/finance-app-shows-only-the-books.test.mjs.
//
// POINT OF USE: the real UpdateBanner compiled out of app/update-check.jsx and rendered with a native Capacitor stub
// and a fetched manifest, its Update button PRESSED (the same harness as
// scripts/steward-update-check-offers-steward-apk.test.mjs, whose four steward cases stay as they were).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes } from './console-screens.mjs';

const FULL = { versionCode: 200, versionName: '0.9.70', url: 'trinityone.apk', stewardVersionCode: 200, stewardUrl: 'trinityone-steward.apk', financeVersionCode: 200, financeUrl: 'trinityone-finance.apk' };

// Render UpdateBanner(variant) against manifest `m`, after the fetch has answered. Returns the tree and the window.
async function bannerFor(variant, m, { snooze = {} } = {}) {
  const fr = fakeReact();
  const { window } = fakeBrowser({ Steward: fakeSteward({ hasKey: false }) });
  let answered; const ready = new Promise(r => { answered = r; });
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { App: { getInfo: async () => ({ version: '0.9.50', build: '100' }) } } };
  window.fetch = async () => { answered(); return { ok: true, json: async () => m }; };
  window.Icon = (props) => fr.React.createElement('span', props);
  for (const [k, v] of Object.entries(snooze)) window.localStorage.setItem(k, v);
  const mods = loadConsole({ React: fr.React, window, expr: '{ UpdateBanner }', files: ['app/update-check.jsx'] });
  fr.fresh(); fr.reset();
  const props = variant ? { variant } : {};
  mods.UpdateBanner(props); fr.flush();
  await ready; await new Promise(r => setTimeout(r, 20));
  fr.reset();
  const tree = mods.UpdateBanner(props);
  return { tree, window };
}
function pressUpdate(tree, window) {
  const btn = nodes(tree).filter(n => n.type === 'button').find(n => (n.kids || []).some(k => typeof k === 'string' && k.includes('Update')));
  assert.ok(btn, 'no Update button rendered');
  let opened = null;
  window.open = (u) => { opened = u; return null; };
  btn.props.onClick();
  return opened;
}

test('finance variant: a newer financeVersionCode offers trinityone-finance.apk — not the steward or member APK', async () => {
  const { tree, window } = await bannerFor('finance', FULL);
  assert.notEqual(tree, null, 'no banner for a newer finance build');
  const url = pressUpdate(tree, window);
  assert.ok(url && url.includes('/trinityone-finance.apk?'), 'the finance app downloads the wrong APK: ' + url);
  assert.equal(window.localStorage.getItem('trinityone.finance.updateSnoozed'), '200', 'the finance app did not remember this version under its OWN key');
  assert.equal(window.localStorage.getItem('trinityone.steward.updateSnoozed'), null, 'the finance app wrote the steward app\'s snooze key');
});

test('finance variant: a manifest with only the member and steward rows offers the finance app NOTHING', async () => {
  const { versionCode, versionName, url, stewardVersionCode, stewardUrl } = FULL;
  const { tree } = await bannerFor('finance', { versionCode, versionName, url, stewardVersionCode, stewardUrl });
  assert.equal(tree, null, 'the finance app offered another app\'s APK when the manifest had no finance row');
});

test('finance variant: a finance versionCode with NO financeUrl offers nothing (there is no fallback for this app)', async () => {
  const { financeUrl, ...noUrl } = FULL;
  assert.equal((await bannerFor('finance', noUrl)).tree, null, 'no financeUrl, yet a banner — it could only point at another app');
  const { financeVersionCode, ...noCode } = FULL;
  assert.equal((await bannerFor('finance', noCode)).tree, null, 'no financeVersionCode, yet a banner');
});

test('finance variant: its own "Later" — the finance snooze hides it, the steward snooze does not', async () => {
  assert.equal((await bannerFor('finance', FULL, { snooze: { 'trinityone.finance.updateSnoozed': '200' } })).tree, null, 'a snoozed finance update still shows');
  assert.notEqual((await bannerFor('finance', FULL, { snooze: { 'trinityone.steward.updateSnoozed': '200', 'trinityone.updateSnoozed': '200' } })).tree, null,
    'the steward/member "Later" hid the finance update — the apps share a snooze');
});

test('CONTROL — the member app (no variant) still reads the member row and downloads trinityone.apk', async () => {
  const { tree, window } = await bannerFor(undefined, FULL);
  assert.notEqual(tree, null, 'the member app lost its update banner');
  const url = pressUpdate(tree, window);
  assert.ok(url && url.includes('/trinityone.apk?'), 'the member app downloads the wrong APK: ' + url);
  assert.equal(window.localStorage.getItem('trinityone.updateSnoozed'), '200');
});
