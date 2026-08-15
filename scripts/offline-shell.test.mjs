// The web app must survive a reload with the server unreachable, and must not need a Bible to exist.
// Run: node --test scripts/offline-shell.test.mjs
//
// AUDIT-2026-07-27, reproduced in a browser before fixing. Two faults compounded:
//   1. sw.js precached a hand-written list of './app/*.jsx'. build-pages.sh transpiles those to .js and
//      rewrites index.html, so the list stopped describing the deployed app — 9 of 43 scripts covered, and 28
//      entries pointing at files the build never emits. That is load-bearing, because the service worker
//      registers on `load`, AFTER the page's own scripts have been fetched without it: on a first visit the
//      precache is the ONLY thing cached. Reloading with the server down showed the browser's error page.
//   2. The whole app was wrapped in `Bible.loaded ? … : <EmptyState/>`, so a module download that failed took
//      Today, Community, Care and the emergency safety check with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const SW = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');
const SYNC = readFileSync(new URL('./sync-web.sh', import.meta.url), 'utf8');
const ENGINE = readFileSync(new URL('../engine.js', import.meta.url), 'utf8');

test('the precache is derived from index.html, not hand-maintained', () => {
  assert.match(SW, /async function shellUrls/, 'the derived precache is gone — the list will drift from the build again');
  assert.match(SW, /fetch\('\.\/index\.html'/, 'it must read the page it is caching for');
  assert.doesNotMatch(SW, /const CORE = \[/, 'a hand-written CORE list is exactly what went stale');
  assert.doesNotMatch(SW, /'\.\/app\/[a-z-]+\.jsx'/, 'no .jsx paths — the built page loads .js and these 404');
});

test('install caches whatever the page actually references', () => {
  // Anchor the handler ARROW, not the addEventListener CALL: fnBody refuses call-shaped anchors now, because
  // the call anchor silently sliced past the install handler into the activate one (AUDIT-2026-08-10 item E).
  // This slice is the handler body alone — which is what this test's prose claims to read.
  const at = SW.indexOf('(e) => {', SW.indexOf("addEventListener('install'"));
  const body = fnBody(SW, at, "the install handler");
  assert.match(body, /shellUrls\(\)/, 'install must use the derived list');
  assert.match(body, /catch/, 'one 404 must not fail the whole install');
});

test('a navigation always falls back to the cached shell', () => {
  const at = SW.indexOf('if (isShell)');
  const body = fnBody(SW, at);
  assert.match(body, /caches\.match\('\.\/index\.html'\)/,
    'without this a reload with the server down renders the browser’s error page instead of the app');
});

test('fonts referenced from CSS are cached too', () => {
  assert.match(SW, /url\\\(/, 'fonts come from fonts.css, not from a tag — text must still render offline');
});

test('the app renders without a Bible; only the Read tab shows the empty state', () => {
  assert.doesNotMatch(APP, /\{Bible\.loaded \? \(/,
    'the whole app is gated on the Bible again — a failed download would cost the safety check');
  const at = APP.indexOf('read: !Bible.loaded');
  assert.notEqual(at, -1, 'the Read tab must own the empty state');
  assert.match(APP.slice(at, at + 220), /EmptyState/);
});

// ── AND the app must actually READ it ─────────────────────────────────────────────────────────────────────
// The test below asserts the BUILD copies the Bible in. For a year that was the only check, and it passed
// happily while the app never once opened the file: resolveAsset() rewrote every relative module url to the
// public gateway on native and both fetch sites used it as a bare fetch target with no local fallback. A
// phone with no connection was told to connect to the internet, with 3 MB of scripture sitting inside the
// APK. UX audit 2026-08-04.
//
// The lesson is the same one the signing-key checklist taught the same day: a test that confirms the SETUP
// step happened is not a test that the thing works. Assert the read path, not just the copy.
test('the shipped Bible is actually reachable on native — local first, gateway second', () => {
  const cands = fnBody(ENGINE, 'function assetCandidates', 'assetCandidates');
  assert.match(cands, /remote === u \? \[u\] : \[u, remote\]/,
    'assetCandidates must try the ORIGINAL (on-device) url before the rewritten gateway one — reversing this ' +
    'order, or dropping the local candidate, silently un-ships the offline Bible again');

  const fetcher = fnBody(ENGINE, 'async function fetchAsset', 'fetchAsset');
  assert.match(fetcher, /assetCandidates\(/, 'fetchAsset no longer walks the candidate list');
  assert.match(fetcher, /AbortController|signal/, 'fetchAsset lost its connection bound — a black-holed host hangs for ever');

  // The two places that actually pull a module must go through it. A bare fetch(resolveAsset(...)) is the bug.
  const install = fnBody(ENGINE, 'async function installModule', 'installModule');
  const cacheFn = fnBody(ENGINE, 'async function fetchAndCacheModule', 'fetchAndCacheModule');
  for (const [name, body] of [['installModule', install], ['fetchAndCacheModule', cacheFn]]) {
    assert.ok(!/fetch\(\s*resolveAsset\(/.test(body),
      name + ' fetches resolveAsset() directly again — that skips the on-device copy and breaks the offline Bible');
    assert.match(body, /fetchAsset\(/, name + ' must fetch through fetchAsset()');
  }
});

test('the default Bible ships in the APK', () => {
  assert.match(SYNC, /cp modules\/engbsb\.zip "\$WWW\/modules\/"/,
    'the APK ships no Bible again — "Share the app" promises a recipient can read with no internet');
  const at = SYNC.indexOf('cp modules/engbsb.zip');
  const gate = SYNC.lastIndexOf('BUNDLE_MODULES', at);
  const between = gate === -1 ? '' : SYNC.slice(gate, at);
  assert.ok(gate === -1 || between.includes('\n#') || !between.includes('if ['),
    'the default Bible must NOT be behind the opt-in flag — that is how it went missing');
});

// ── the last-resort fallback ─────────────────────────────────────────────────────────────────────────────────
// The navigation fallback chain was `c || caches.match('./index.html') || caches.match('./')`. A promise is
// always truthy, so the final term was unreachable — and if index.html happened not to be cached (the install
// loop caches each URL independently and swallows individual failures) the handler resolved `undefined` into
// respondWith, which the browser renders as "site can't be reached": exactly the page this branch exists to
// prevent. AUDIT-2026-07-27.
test('every offline fallback is awaited, so none of them is dead code', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const at = sw.indexOf('if (isShell)');
  assert.notEqual(at, -1, 'the shell branch is gone from the service worker');
  // Strip comments first: the note explaining this fix quotes the broken chain verbatim, and matching it in
  // prose rather than in code is how a test starts failing against a correct fix.
  const branch = sw.slice(at, at + 1400).split('\n').map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');
  assert.doesNotMatch(branch, /c \|\| caches\.match\('\.\/index\.html'\) \|\| caches\.match/,
    'the fallback chain ors together promises — every term after the first is unreachable');
  const awaits = (branch.match(/await caches\.match\(/g) || []).length;
  assert.ok(awaits >= 3, 'expected the request, index.html and ./ each to be awaited; found ' + awaits);
});

test('a shell miss still renders something rather than a browser error page', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const at = sw.indexOf('if (isShell)');
  const branch = sw.slice(at, at + 1400);
  assert.match(branch, /new Response\(/,
    'with nothing cached the handler resolves undefined, and the browser shows "site can’t be reached"');
  assert.match(branch, /offline/i, 'the last-resort page should say what happened in plain words');
});

test('the cache version was bumped, or installed apps keep the old shell', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const m = sw.match(/trinity-shell-v(\d+)/);
  assert.ok(m, 'the cache name no longer carries a version');
  assert.ok(Number(m[1]) >= 229, 'sw.js changed but the cache version is still v' + m[1] + ' — installed PWAs will not pick up the fix');
});
