// A DEBUG/SIMULATOR BUILD REPORTS THE APNs *SANDBOX* ENVIRONMENT; RELEASE REPORTS PRODUCTION.
// Run: node --test scripts/the-sim-build-reports-the-apns-sandbox-environment.test.mjs
//
// WHY THIS MATTERS (relay session, 2026-11-25): the relay's APNs sender ROUTES on the pushtoken doc's
// content.env — "sandbox" → api.sandbox.push.apple.com, "production" → api.push.apple.com. A sim build that
// reported "production" would send to the wrong Apple host and the push would silently never arrive. So the
// env MUST follow the build: a Debug/Simulator build talks to the APNs sandbox.
//
// The env is decided in the NATIVE ApnsBridge.deliver() (appended to AppDelegate.swift by scripts/ios-fixup.sh):
// it defaults to "production" and flips to "sandbox" only under `#if DEBUG`. The iOS project sets
// SWIFT_ACTIVE_COMPILATION_CONDITIONS=DEBUG for the Debug config and "" for Release, and the sim is built
// `-configuration Debug`, so `#if DEBUG` is true there. This can't be run in JS (it's Swift behind a compile
// flag), so this test lifts the exact appended Swift from ios-fixup.sh and pins the decision: flip the default
// to "sandbox", or drop the `#if DEBUG` guard, and this fails. The JS half (the pushtoken doc carries this env
// verbatim, defaulting to production for any non-"sandbox" value) is pinned in
// the-push-token-doc-binds-the-members-own-pubkey.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FIXUP = readFileSync(new URL('../scripts/ios-fixup.sh', import.meta.url), 'utf8');

// the ApnsBridge.deliver() body, as appended to AppDelegate.swift
const deliver = (() => {
  const at = FIXUP.indexOf('func deliver(token: String) {');
  assert.notEqual(at, -1, 'ApnsBridge.deliver() is missing from ios-fixup.sh — re-anchor');
  return FIXUP.slice(at, FIXUP.indexOf('notifyListeners("apnsToken"', at) + 80);
})();

test('env defaults to production and flips to sandbox ONLY under #if DEBUG', () => {
  assert.match(deliver, /var env = "production"/, 'the default env must be production (a Release/App Store build)');
  assert.match(deliver, /#if DEBUG\s*\n\s*env = "sandbox"/, 'a Debug/Simulator build must switch env to sandbox');
  // order: the production default comes first, the DEBUG override after — so a non-DEBUG build keeps production
  assert.ok(deliver.indexOf('var env = "production"') < deliver.indexOf('#if DEBUG'),
    'production must be the default that DEBUG overrides, not the other way round');
  assert.match(deliver, /notifyListeners\("apnsToken", data: \["token": token, "env": env\]\)/,
    'the env must be forwarded to JS on the apnsToken event, not dropped');
});

test('the Debug build config actually defines the DEBUG Swift condition (so #if DEBUG fires on the sim)', () => {
  // The generated project is gitignored; assert against it only when it has been scaffolded (cap add ios).
  let pbx;
  try { pbx = readFileSync(new URL('../ios/App/App.xcodeproj/project.pbxproj', import.meta.url), 'utf8'); }
  catch { return; }   // no ios/ in this checkout (e.g. a fresh worktree) — the ios-fixup assertion above still holds
  assert.match(pbx, /SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;/, 'the Debug config must define DEBUG for #if DEBUG to fire');
});

// ── aps-environment must MATCH the build config (2026-11-28 deploy-audit fix) ──
// Debug signs 'development' (sandbox), Release signs 'production'. Before this, BOTH configs pointed at one
// hardcoded 'development' entitlement, so a Release build registered a sandbox token while reporting env='production'.
// Runs the REAL python wiring block lifted from ios-fixup.sh against a fixture pbxproj (no Xcode needed).
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const wire = (() => {
  const a = FIXUP.indexOf('# BEGIN-WIRE-PY'), b = FIXUP.indexOf('# END-WIRE-PY');
  assert.ok(a !== -1 && b > a, 'wiring block markers missing from ios-fixup.sh');
  const blk = FIXUP.slice(a, b);
  return blk.slice(blk.indexOf("<<'PY'\n") + 7, blk.lastIndexOf('\nPY'));
})();
const cfg = (id, name, extra = '') => `\t\t${id} /* ${name} */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.trinityone.app;${extra}
\t\t\t\tSWIFT_VERSION = 5.0;
\t\t\t};
\t\t\tname = ${name};
\t\t};
`;
const proj = (extraD = '', extraR = '') => `/* Begin XCBuildConfiguration section */
\t\tAAA /* Debug */ = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = { SDKROOT = iphoneos; };
\t\t\tname = Debug;
\t\t};
${cfg('BBB', 'Debug', extraD)}${cfg('CCC', 'Release', extraR)}/* End XCBuildConfiguration section */
`;
function runWire(src) {
  const d = mkdtempSync(join(tmpdir(), 'trin-wire-'));
  try {
    writeFileSync(join(d, 'p.pbxproj'), src); writeFileSync(join(d, 'w.py'), wire);
    const r = spawnSync('python3', ['-I', join(d, 'w.py'), join(d, 'p.pbxproj')], { encoding: 'utf8' });
    return { r, out: readFileSync(join(d, 'p.pbxproj'), 'utf8') };
  } finally { rmSync(d, { recursive: true, force: true }); }
}
const entOf = (out, name) => {
  const m = [...out.matchAll(/isa = XCBuildConfiguration;.*?\n\t\t\};/gs)].map(x => x[0])
    .find(b => b.includes('com.trinityone.app') && new RegExp(`name = ${name};`).test(b));
  return m && (m.match(/CODE_SIGN_ENTITLEMENTS = ([^;]*);/g) || []);
};

test('fresh pbxproj: Debug -> App.entitlements, Release -> AppRelease.entitlements', () => {
  const { r, out } = runWire(proj());
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(entOf(out, 'Debug'), ['CODE_SIGN_ENTITLEMENTS = App/App.entitlements;']);
  assert.deepEqual(entOf(out, 'Release'), ['CODE_SIGN_ENTITLEMENTS = App/AppRelease.entitlements;']);
});

test('already-wired OLD pbxproj (both configs -> App.entitlements) is corrected, and a re-run is idempotent', () => {
  const old = '\n\t\t\t\tCODE_SIGN_ENTITLEMENTS = App/App.entitlements;';
  const first = runWire(proj(old, old));
  assert.deepEqual(entOf(first.out, 'Release'), ['CODE_SIGN_ENTITLEMENTS = App/AppRelease.entitlements;']);
  assert.deepEqual(entOf(first.out, 'Debug'), ['CODE_SIGN_ENTITLEMENTS = App/App.entitlements;']);
  const second = runWire(first.out);
  assert.equal(second.out, first.out, 'a second run must change nothing');
});

test('the two entitlement files carry development / production, and the Release one is written by the script', () => {
  assert.match(FIXUP, /AppRelease\.entitlements"\n(?:.*\n)*?<string>production<\/string>|<key>aps-environment<\/key>\n\t<string>production<\/string>/);
  assert.match(FIXUP, /<key>aps-environment<\/key>\n\t<string>development<\/string>/);
});
