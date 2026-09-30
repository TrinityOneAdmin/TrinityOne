// THE STEWARD APP OFFERS THE STEWARD APK, NOT THE MEMBER APK.
//   Run: node --test scripts/steward-update-check-offers-steward-apk.test.mjs
//
// S-5: the steward console never offered updates. UpdateBanner was only mounted in the member app.
// The fix mounts it in steward-root.jsx with variant="steward", and the component reads
// stewardVersionCode/stewardUrl from the manifest instead of the member fields.
//
// Without variant="steward" the steward would either (a) not see the banner at all, or (b) see a
// banner that downloads the member APK — which has a different applicationId and installs as a
// second app, leaving the console unchanged.
//
// Callers of UpdateBanner: app/steward-root.jsx (steward, variant="steward"), app/app.jsx (member,
// no variant / default "member").

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes } from './console-screens.mjs';

test('StewardRoot mounts UpdateBanner with variant="steward"', () => {
  const { React, reset, flush, unmount } = fakeReact();
  const Steward = fakeSteward({ hasKey: false, locked: false, needsPin: false });
  const { window } = fakeBrowser({ Steward });
  window.Capacitor = { isNativePlatform: () => false, Plugins: {} };
  const mods = loadConsole({ React, window, expr: '{ StewardRoot, UpdateBanner }' });

  assert.ok(mods.UpdateBanner, 'UpdateBanner is not defined — update-check.jsx is not loaded by steward.html');
  assert.equal(typeof mods.UpdateBanner, 'function', 'UpdateBanner must be a function');

  reset();
  const tree = mods.StewardRoot();
  flush();

  const all = nodes(tree);
  const bannerNode = all.find(n => n.type === mods.UpdateBanner);
  assert.ok(bannerNode, 'StewardRoot does not render UpdateBanner — the steward console has no update check');
  assert.equal(bannerNode.props.variant, 'steward',
    'UpdateBanner is mounted WITHOUT variant="steward" — the steward console would offer the MEMBER APK, ' +
    'which has a different applicationId and installs as a second app');

  unmount();
});

test('UpdateBanner with variant="steward" reads stewardVersionCode from the manifest', async () => {
  const { React, reset, flush, unmount, fresh } = fakeReact();
  const Steward = fakeSteward({ hasKey: false });
  const { window } = fakeBrowser({ Steward });

  let fetchedUrl = null;
  let resolveManifest;
  const manifestReady = new Promise(r => { resolveManifest = r; });

  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: { App: { getInfo: async () => ({ version: '0.9.50', build: '100' }) } },
  };
  window.fetch = async (url) => {
    fetchedUrl = url;
    resolveManifest();
    return {
      ok: true,
      json: async () => ({
        versionCode: 200,
        versionName: '0.9.70',
        url: 'trinityone.apk',
        stewardVersionCode: 200,
        stewardUrl: 'trinityone-steward.apk',
      }),
    };
  };
  window.Icon = (props) => React.createElement('span', props);

  const mods = loadConsole({ React, window, expr: '{ UpdateBanner }', files: ['app/update-check.jsx'] });

  fresh();
  reset();
  let tree = mods.UpdateBanner({ variant: 'steward' });
  flush();

  await manifestReady;
  await new Promise(r => setTimeout(r, 20));

  reset();
  tree = mods.UpdateBanner({ variant: 'steward' });
  flush();

  const all = nodes(tree);
  const buttons = all.filter(n => n.type === 'button');
  const updateBtn = buttons.find(n => (n.kids || []).some(k => typeof k === 'string' && k.includes('Update')));
  assert.ok(updateBtn, 'no Update button rendered — the steward banner did not detect a newer stewardVersionCode');

  assert.ok(updateBtn.props.onClick, 'Update button has no onClick');
  let openedUrl = null;
  window.open = (url) => { openedUrl = url; return null; };
  window.localStorage.setItem('trinityone.steward.updateSnoozed', '0');
  updateBtn.props.onClick();
  assert.ok(openedUrl, 'tapping Update did not call window.open');
  assert.ok(openedUrl.includes('trinityone-steward.apk'),
    `the steward update downloads the WRONG APK. Expected trinityone-steward.apk in URL, got: ${openedUrl}`);
  assert.ok(!openedUrl.includes('/trinityone.apk?'),
    'the steward update downloads the MEMBER APK (trinityone.apk) — different applicationId');

  unmount();
});

test('UpdateBanner with variant="steward" ignores a manifest that only has member fields', async () => {
  const { React, reset, flush, unmount, fresh } = fakeReact();
  const Steward = fakeSteward({ hasKey: false });
  const { window } = fakeBrowser({ Steward });

  let resolveManifest;
  const manifestReady = new Promise(r => { resolveManifest = r; });

  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: { App: { getInfo: async () => ({ version: '0.9.50', build: '100' }) } },
  };
  window.fetch = async () => {
    resolveManifest();
    return {
      ok: true,
      json: async () => ({
        versionCode: 200,
        versionName: '0.9.70',
        url: 'trinityone.apk',
      }),
    };
  };

  const mods = loadConsole({ React, window, expr: '{ UpdateBanner }', files: ['app/update-check.jsx'] });

  fresh();
  reset();
  let tree = mods.UpdateBanner({ variant: 'steward' });
  flush();

  await manifestReady;
  await new Promise(r => setTimeout(r, 20));

  reset();
  tree = mods.UpdateBanner({ variant: 'steward' });

  assert.equal(tree, null,
    'UpdateBanner shows a banner when the manifest has no stewardVersionCode — it would offer the wrong APK');

  unmount();
});

test('UpdateBanner with variant="steward" uses a separate snooze key', async () => {
  const { React, reset, flush, unmount, fresh } = fakeReact();
  const Steward = fakeSteward({ hasKey: false });
  const { window } = fakeBrowser({ Steward });

  let resolveManifest;
  const manifestReady = new Promise(r => { resolveManifest = r; });

  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: { App: { getInfo: async () => ({ version: '0.9.50', build: '100' }) } },
  };
  window.fetch = async () => {
    resolveManifest();
    return {
      ok: true,
      json: async () => ({
        versionCode: 200, versionName: '0.9.70', url: 'trinityone.apk',
        stewardVersionCode: 200, stewardUrl: 'trinityone-steward.apk',
      }),
    };
  };

  window.localStorage.setItem('trinityone.steward.updateSnoozed', '200');

  const mods = loadConsole({ React, window, expr: '{ UpdateBanner }', files: ['app/update-check.jsx'] });

  fresh();
  reset();
  let tree = mods.UpdateBanner({ variant: 'steward' });
  flush();

  await manifestReady;
  await new Promise(r => setTimeout(r, 20));

  reset();
  tree = mods.UpdateBanner({ variant: 'steward' });

  assert.equal(tree, null,
    'UpdateBanner ignores the steward snooze key — a snoozed steward update still shows');

  unmount();
});
