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

const SW = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');
const SYNC = readFileSync(new URL('./sync-web.sh', import.meta.url), 'utf8');

test('the precache is derived from index.html, not hand-maintained', () => {
  assert.match(SW, /async function shellUrls/, 'the derived precache is gone — the list will drift from the build again');
  assert.match(SW, /fetch\('\.\/index\.html'/, 'it must read the page it is caching for');
  assert.doesNotMatch(SW, /const CORE = \[/, 'a hand-written CORE list is exactly what went stale');
  assert.doesNotMatch(SW, /'\.\/app\/[a-z-]+\.jsx'/, 'no .jsx paths — the built page loads .js and these 404');
});

test('install caches whatever the page actually references', () => {
  const at = SW.indexOf("addEventListener('install'");
  const body = SW.slice(at, at + 400);
  assert.match(body, /shellUrls\(\)/, 'install must use the derived list');
  assert.match(body, /catch/, 'one 404 must not fail the whole install');
});

test('a navigation always falls back to the cached shell', () => {
  const at = SW.indexOf('if (isShell)');
  const body = SW.slice(at, at + 400);
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

test('the default Bible ships in the APK', () => {
  assert.match(SYNC, /cp modules\/engbsb\.zip "\$WWW\/modules\/"/,
    'the APK ships no Bible again — "Share the app" promises a recipient can read with no internet');
  const at = SYNC.indexOf('cp modules/engbsb.zip');
  const gate = SYNC.lastIndexOf('BUNDLE_MODULES', at);
  const between = gate === -1 ? '' : SYNC.slice(gate, at);
  assert.ok(gate === -1 || between.includes('\n#') || !between.includes('if ['),
    'the default Bible must NOT be behind the opt-in flag — that is how it went missing');
});
