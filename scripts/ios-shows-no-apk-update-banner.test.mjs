// THE iOS APP SHOWS NO "APK UPDATE" BANNER.
//   Run: node --test scripts/ios-shows-no-apk-update-banner.test.mjs
//
// WHY (2026-11-19, reported from the TestFlight pilot): iPhone users were prompted to "Update" and the button
// opened https://app.trinityone.church/trinityone.apk — an ANDROID package offered for download on an iPhone.
// Cause: UpdateBanner (app/update-check.jsx) gated on Capacitor.isNativePlatform(), which is true on iOS AND
// Android. The APK sideload-update mechanism is Android-only (sideloaded apps get no Play Store nudge); iOS
// updates come from TestFlight / the App Store. On iOS the Android versionCode in apk-latest.json (225) also
// parses ABOVE the iOS build number, so `latest > installed` and the banner fired. The fix gates to Android by
// NAME: Capacitor.getPlatform() === 'android'.
//
// POINT OF USE: the real UpdateBanner is loaded and RENDERED through the console harness (not text-matched —
// CLAUDE.md rule 3: app/*.jsx ships unbundled, so a dead-coded condition would leave the text in place and fool a
// grep). On iOS it must render NOTHING and must not even fetch the manifest. The Android control proves the gate
// did not simply disable the feature — and it is the sabotage anchor: revert the gate to isNativePlatform() and
// the iOS case shows the banner again, failing the first test.
//
// Callers of UpdateBanner: app/app.jsx (member) and app/steward-root.jsx (steward) — both now Android-gated; the
// steward side is covered by scripts/steward-update-check-offers-steward-apk.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, nodes } from './console-screens.mjs';

// a manifest offering a build far newer than anything installed — the banner WOULD show if the platform gate let it
const NEWER_MANIFEST = { versionCode: 99999, versionName: '9.9.9', url: 'trinityone.apk', stewardVersionCode: 99999, stewardUrl: 'trinityone-steward.apk' };

test('on iOS the member app shows NO update banner and does not even fetch the APK manifest', async () => {
  const { React, reset, flush, unmount, fresh } = fakeReact();
  const { window } = fakeBrowser({});

  let fetched = false;
  window.Capacitor = {
    isNativePlatform: () => true,            // true on iOS, as it is on Android — the old, wrong gate
    getPlatform: () => 'ios',
    Plugins: { App: { getInfo: async () => ({ version: '0.9.72', build: '1' }) } },   // iOS build parses below versionCode 225
  };
  window.fetch = async () => { fetched = true; return { ok: true, json: async () => NEWER_MANIFEST }; };
  window.Icon = (props) => React.createElement('span', props);

  const mods = loadConsole({ React, window, expr: '{ UpdateBanner }', files: ['app/update-check.jsx'] });

  fresh();
  reset();
  let tree = mods.UpdateBanner({});          // member app mounts it with no variant
  flush();
  await new Promise(r => setTimeout(r, 30));  // give any (wrongly) fired async effect time to fetch + setState

  reset();
  tree = mods.UpdateBanner({});
  flush();

  assert.equal(tree, null, 'the iOS app rendered an update banner — it would offer an Android .apk on an iPhone');
  assert.equal(fetched, false, 'the iOS app fetched apk-latest.json — the Android-only update check must not run on iOS');

  unmount();
});

test('CONTROL: on Android the member app DOES show the banner and it downloads the member APK', async () => {
  const { React, reset, flush, unmount, fresh } = fakeReact();
  const { window } = fakeBrowser({});

  let resolveManifest; const manifestReady = new Promise(r => { resolveManifest = r; });
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    Plugins: { App: { getInfo: async () => ({ version: '0.9.50', build: '100' }) } },   // installed 100 < 225
  };
  window.fetch = async () => { resolveManifest(); return { ok: true, json: async () => ({ ...NEWER_MANIFEST, versionCode: 225 }) }; };
  window.Icon = (props) => React.createElement('span', props);

  const mods = loadConsole({ React, window, expr: '{ UpdateBanner }', files: ['app/update-check.jsx'] });

  fresh();
  reset();
  let tree = mods.UpdateBanner({});
  flush();
  await manifestReady;
  await new Promise(r => setTimeout(r, 20));

  reset();
  tree = mods.UpdateBanner({});
  flush();

  const buttons = nodes(tree).filter(n => n.type === 'button');
  const updateBtn = buttons.find(n => (n.kids || []).some(k => typeof k === 'string' && k.includes('Update')));
  assert.ok(updateBtn, 'CONTROL FAILED: Android showed no update banner — the gate disabled the feature entirely, not just on iOS');

  let openedUrl = null;
  window.open = (url) => { openedUrl = url; return null; };
  window.localStorage.setItem('trinityone.updateSnoozed', '0');
  updateBtn.props.onClick();
  assert.ok(openedUrl && openedUrl.includes('trinityone.apk'), `Android update should download the member APK, got: ${openedUrl}`);

  unmount();
});
