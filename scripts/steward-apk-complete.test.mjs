// THE CONSOLE APK MUST CONTAIN EVERYTHING ITS PAGE ASKS FOR.
// Run: node --test scripts/steward-apk-complete.test.mjs
//
// Found on a phone, 2026-08-19: the steward console APK opened to "Opening your console… Getting your church
// ready" and stayed there. Not a hang — a missing file. `app/error-boundary.jsx` was added to steward.html on
// 2026-08-17 by the commit "a render crash stops being a silent white screen", and never added to the APK
// build's hand-written copy list, so:
//
//     Unable to open asset URL: https://localhost/app/error-boundary.js
//     Uncaught ReferenceError: TrinityErrorBoundary is not defined   (steward-root.js:684)
//
// React never mounted. The console — how a church is actually run — was unusable on a phone for two days and
// 31 commits, and nothing caught it: every console test runs headless against the repo root, where every file
// exists. Only the PACKAGED app was broken, and only a device could show it. vendor/recovery.js (the restore
// path), sw-register.js and both launcher icons were missing for the same reason.
//
// The build now derives its payload from steward.html. This test holds it there: the page is the contract,
// the packager may not keep its own list, and every file the page names must exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const html = readFileSync(ROOT + 'steward.html', 'utf8');
const buildRaw = readFileSync(ROOT + 'scripts/build-steward-apk.sh', 'utf8');
// Since 2026-11-18 the page-derived copy lives in scripts/collect-app-page.sh (shared with the desktop finance build),
// which build-steward-apk.sh calls with "$PAGE". The packager is the two together.
const collectRaw = readFileSync(ROOT + 'scripts/collect-app-page.sh', 'utf8');
// Strip shell comments before matching. The first version of this test failed against the FIXED script,
// because the comment explaining the old hand-written list quotes it — the mirror image of this repo's
// comment-satisfies-the-assertion bug, and just as misleading.
const uncomment = (t) => t.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
const build = uncomment(buildRaw) + '\n' + uncomment(collectRaw);
const apkOnly = uncomment(buildRaw);

// every local file the page pulls in
const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
  .map(m => m[1])
  .filter(u => !/^https?:|^#|^data:/.test(u));

// babel is deliberately dropped by the build (JSX is pre-transpiled; runtime Babel is unreliable in the
// Capacitor webview and is what the eval-free CSP exists to remove).
const DELIBERATELY_DROPPED = new Set(['vendor/babel.min.js']);

test('re-anchor: steward.html still pulls in a realistic number of local files', () => {
  assert.ok(refs.length >= 20, `only ${refs.length} local refs found — the parse has stopped seeing them`);
});

test('every file steward.html references exists on disk', () => {
  const missing = refs.filter(f => !existsSync(ROOT + f));
  assert.deepEqual(missing, [],
    'steward.html asks for files that are not in the repo. In the APK these become "Unable to open asset ' +
    'URL", and if one of them defines a symbol the page uses at mount, the console dies on its splash.');
});

test('the packager does NOT keep its own hand-written list of app files', () => {
  // The actual defect was a second list that could drift from the page. One `cp` naming several app/*.jsx
  // files is exactly that list coming back.
  const handList = build.match(/cp\s+(app\/[\w.-]+\.jsx\s+){2,}/);
  assert.equal(handList, null,
    'build-steward-apk.sh is naming app/*.jsx files by hand again. That list drifted from steward.html once ' +
    'and shipped a console that could not start; derive the payload from the page instead.');
});

test('the packager derives its payload from steward.html, and fails loudly on a missing file', () => {
  // Since T1Finance (2026-11-17) one script builds steward (the default) or finance, so it greps "$PAGE", and the
  // default maps PAGE to steward.html. scripts/console-apk-build-steward-or-finance.test.mjs RUNS it on the real
  // steward.html and finance.html and checks the packaged www/; this is the cheap structural half.
  assert.match(build, /grep -oE[^\n]*"\$PAGE"/,
    're-anchor: the build no longer reads the page to decide what to package');
  assert.match(apkOnly, /bash scripts\/collect-app-page\.sh "\$PAGE" "\$WWW"/,
    'build-steward-apk.sh no longer hands its page to collect-app-page.sh — the page-derived copy is not what packages the APK');
  assert.match(build, /APP="\$\{1:-steward\}"/, 'the default app is no longer steward (release.sh calls this with no argument)');
  assert.match(build, /steward\)[^\n]*PAGE="steward\.html"/, 'the steward build no longer packages steward.html');
  assert.match(build, /does not exist[^\n]*(exit 1|>&2)/,
    'a file named by the page but missing from disk must abort the build — shipping the APK anyway is how ' +
    'a console that cannot start gets released');
});
