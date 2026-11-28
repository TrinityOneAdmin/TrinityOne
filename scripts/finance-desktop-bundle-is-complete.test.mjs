// THE DESKTOP FINANCE PROGRAM'S BUNDLE HAS EVERY FILE ITS PAGE ASKS FOR — AND NOTHING THAT NEEDS A BROWSER BUILD STEP.
// Run: node --test scripts/finance-desktop-bundle-is-complete.test.mjs
//
// T1Finance desktop plan (TrinityOne-internal/PLAN-T1FINANCE-DESKTOP-2026-11-17.md) §5 test 1. The Tauri program ships
// a COPY of finance.html's files (scripts/build-finance-desktop.sh, via scripts/collect-app-page.sh — the same page-
// derived copy the APKs use). A file the page names and the bundle lacks is the 2026-08-19 dead console again: the
// page parses, every repo-root test is green, and the packaged app sits on its splash for ever.
//
// THE REAL BUILD SCRIPT IS RUN, with the real esbuild, into a private temp folder. Then the OUTPUT is checked:
//   · every href/src in the bundled index.html, and every url() in every bundled stylesheet, is a file in the bundle;
//   · no .jsx, no runtime Babel, no text/babel script, no inline <script> (the strict CSP would block one);
//   · no service worker (sw-register.js is neither referenced nor shipped);
//   · desktop-build.js is loaded IMMEDIATELY before finance-mode.js, which is still the first app script, and it sets
//     window.TRINITY_BUILD = { app: 'finance-desktop', version: tauri.conf.json's version, sha: this commit };
//   · the bundle is the APK finance www/ less sw-register.js plus desktop-build.js — the two builds share one copy.
// Not proved here: that the bundle BOOTS (scripts/finance-desktop-boots-at-its-packaged-origin.test.mjs does).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url).pathname;
const CONF = JSON.parse(readFileSync(join(ROOT, 'finance-app/desktop/src-tauri/tauri.conf.json'), 'utf8'));
const refsOf = (html) => [...new Set([...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^https?:|^#|^data:/.test(u)))];
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

const dirs = [];
after(() => dirs.forEach((d) => { try { rmSync(d, { recursive: true, force: true }); } catch {} }));
const T = mkdtempSync(join(tmpdir(), 'trin-fdesk-')); dirs.push(T);
const OUT = join(T, 'dist');
const built = spawnSync('bash', ['scripts/build-finance-desktop.sh', OUT], { cwd: ROOT, encoding: 'utf8' });
const idx = () => readFileSync(join(OUT, 'index.html'), 'utf8');
const files = () => walk(OUT).map((p) => relative(OUT, p)).sort();

test('the real build script runs and writes index.html', () => {
  assert.equal(built.status, 0, 'scripts/build-finance-desktop.sh failed: ' + (built.stderr || '').slice(-800));
  assert.ok(existsSync(join(OUT, 'index.html')));
  assert.match(idx(), /<title>TrinityOne Finance<\/title>/, 'the bundled page is not finance.html');
});

test('every local file the bundled page references is IN the bundle — and every url() its stylesheets name', () => {
  const refs = refsOf(idx());
  assert.ok(refs.length >= 20, `only ${refs.length} refs parsed — the parse has stopped seeing them`);
  const missing = refs.filter((f) => !existsSync(join(OUT, f.split(/[?#]/)[0])));
  assert.deepEqual(missing, [], 'the desktop bundle lacks files its page asks for — in the program each is a dead asset URL');
  const css = files().filter((f) => f.endsWith('.css'));
  assert.ok(css.includes('vendor/fonts/fonts.css') && css.includes('brand.css'), 're-anchor: the stylesheets are not where the page names them');
  const urlMissing = [];
  let urls = 0;
  for (const f of css) {
    for (const m of readFileSync(join(OUT, f), 'utf8').matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
      const u = m[1];
      if (/^(data:|https?:|#)/.test(u)) continue;
      urls++;
      if (!existsSync(join(OUT, dirname(f), u.split(/[?#]/)[0]))) urlMissing.push(f + ' -> ' + u);
    }
  }
  assert.ok(urls >= 3, `only ${urls} local url()s found in the bundled stylesheets — the fonts parse has stopped seeing them`);
  assert.deepEqual(urlMissing, [], 'a stylesheet names a file the bundle does not have (fonts would fall back silently)');
});

test('no JSX, no runtime Babel, no inline script — the strict CSP would refuse each of them', () => {
  const html = idx();
  assert.deepEqual(files().filter((f) => /\.jsx$/.test(f)), [], '.jsx shipped in the bundle');
  assert.ok(!files().includes('vendor/babel.min.js'), 'runtime Babel shipped');
  assert.doesNotMatch(html, /babel\.min\.js|type="text\/babel"/, 'the bundled page still loads Babel / text/babel scripts');
  const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !/\bsrc=/.test(m[1]) || m[2].trim());
  assert.deepEqual(inline.map((m) => m[0].slice(0, 80)), [], 'an inline <script> — script-src \'self\' blocks it in the program');
  assert.ok(refsOf(html).filter((f) => /^app\/.*\.js$/.test(f)).length >= 15, 're-anchor: the transpiled app scripts are not referenced');
});

test('no service worker in the program: sw-register.js is neither referenced nor shipped', () => {
  assert.ok(readFileSync(join(ROOT, 'finance.html'), 'utf8').includes('src="sw-register.js"'), 're-anchor: finance.html no longer registers a service worker, so its absence here proves nothing');
  assert.doesNotMatch(idx(), /sw-register/);
  assert.ok(!existsSync(join(OUT, 'sw-register.js')));
  assert.ok(!existsSync(join(OUT, 'sw.js')));
});

test('desktop-build.js loads IMMEDIATELY before finance-mode.js (still the first app script) and stamps this build', () => {
  const scripts = [...idx().matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(scripts[0], 'desktop-build.js', 'desktop-build.js is not the first script: ' + scripts.slice(0, 3).join(', '));
  assert.equal(scripts[1], 'finance-mode.js', 'finance-mode.js is no longer straight after the build stamp');
  assert.ok(scripts.indexOf('vendor/react.production.min.js') > 1, 'React loads before the app flag');
  const ctx = { window: {} }; ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(OUT, 'desktop-build.js'), 'utf8'), ctx);
  const sha = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.TRINITY_BUILD)), { app: 'finance-desktop', version: CONF.version, sha });
  assert.ok(Object.isFrozen(ctx.TRINITY_BUILD), 'TRINITY_BUILD is writable — a later script could restamp it');
});

test('the bundle is the APK finance www/ less sw-register.js plus desktop-build.js — one page-derived copy for both', () => {
  // the APK's copy is scripts/collect-app-page.sh too; run it alone for finance.html and compare the file sets
  const apk = join(T, 'apk-www');
  const r = spawnSync('bash', ['scripts/collect-app-page.sh', 'finance.html', apk], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const apkFiles = walk(apk).map((p) => relative(apk, p)).sort();
  const want = apkFiles.filter((f) => f !== 'sw-register.js').concat('desktop-build.js').sort();
  assert.ok(apkFiles.includes('sw-register.js'), 're-anchor: the APK copy has no sw-register.js to drop');
  assert.deepEqual(files(), want);
});

test('a page that references a missing file FAILS the desktop build (the 2026-08-19 lesson holds here too)', () => {
  // A scratch copy with EVERYTHING the page references except ONE file (app/error-boundary.jsx — the one that killed
  // the console in 2026-08), and a working esbuild, so the only thing that can stop the build is the missing-file guard.
  const S = join(T, 'broken');
  const keep = refsOf(readFileSync(join(ROOT, 'finance.html'), 'utf8')).filter((f) => f !== 'app/error-boundary.jsx' && existsSync(join(ROOT, f)));
  assert.ok(refsOf(readFileSync(join(ROOT, 'finance.html'), 'utf8')).includes('app/error-boundary.jsx'), 're-anchor: finance.html no longer loads app/error-boundary.jsx');
  execFileSync('bash', ['-c', `mkdir -p "${S}/scripts" "${S}/finance-app/desktop/src-tauri" "${S}/node_modules/.bin" && cp scripts/build-finance-desktop.sh scripts/collect-app-page.sh "${S}/scripts/" && cp finance-app/desktop/src-tauri/tauri.conf.json "${S}/finance-app/desktop/src-tauri/" && cp finance.html "${S}/" && mkdir -p "${S}/vendor" && cp -r vendor/fonts "${S}/vendor/" && for f in "$@"; do mkdir -p "${S}/$(dirname "$f")"; cp "$f" "${S}/$f"; done && printf '#!/usr/bin/env bash\nexec "%s" "$@"\n' "${join(ROOT, 'node_modules/.bin/esbuild')}" > "${S}/node_modules/.bin/esbuild" && chmod +x "${S}/node_modules/.bin/esbuild"`, 'x', ...keep], { cwd: ROOT });
  // CONTROL: with the file put back, the same scratch tree builds — so the failure below is the guard, not the fixture
  copyFileSync(join(ROOT, 'app/error-boundary.jsx'), join(S, 'app/error-boundary.jsx'));
  const ok = spawnSync('bash', ['scripts/build-finance-desktop.sh', join(S, 'out-ok')], { cwd: S, encoding: 'utf8' });
  assert.equal(ok.status, 0, 'CONTROL: the scratch tree does not build even with every file present: ' + ok.stderr.slice(-400));
  rmSync(join(S, 'app/error-boundary.jsx'));
  const r = spawnSync('bash', ['scripts/build-finance-desktop.sh', join(S, 'out')], { cwd: S, encoding: 'utf8' });
  assert.notEqual(r.status, 0, 'the desktop build shipped a page with a missing file');
  assert.match(r.stderr, /finance\.html references app\/error-boundary\.jsx, which does not exist/);
  assert.ok(!existsSync(join(S, 'out', 'desktop-build.js')), 'the build carried on past the missing file');
});
