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
