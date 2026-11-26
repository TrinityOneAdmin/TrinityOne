// ONE BUILD SCRIPT, TWO CONSOLE APPS: STEWARD (unchanged) AND TRINITYONE FINANCE — AND THE MEMBER PROJECT ALWAYS COMES BACK.
// Run: node --test scripts/console-apk-build-steward-or-finance.test.mjs
//
// T1Finance step 3 (2026-11-17). scripts/build-steward-apk.sh takes `steward` (the default — release.sh calls it with
// no argument) or `finance` (scripts/build-finance-apk.sh). It borrows the MEMBER android/ project: it swaps the
// applicationId, app name, launcher icons, manifest and www/, builds, and must put every one of them back — on
// success, on failure half way, and whichever of the two consoles was swapped in.
//
// THE REAL SCRIPTS ARE RUN, in a scratch tree, with the REAL page (steward.html / finance.html), every file that page
// references copied from this repo, the real committed launcher icons and the real tracked manifest. FAKED, and named:
// gradle, npx cap, esbuild (writes a stub .js), aapt2 and android-env.sh (tiny stubs; the stub gradle copies what it
// was handed — www/, build.gradle, strings.xml, the manifest, the mipmaps — so the test can read what would have been
// packaged). Not proved here: that an APK really builds or installs (no APK can be built from a worktree, and none
// was) or what the icon looks like on a phone.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, copyFileSync, existsSync, chmodSync, readdirSync, cpSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = new URL('../', import.meta.url).pathname;
const MANIFEST_SRC = join(ROOT, 'android/app/src/main/AndroidManifest.xml');
const DENS = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
const ICON_FILES = ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png', 'ic_launcher_background.png'];
const MEMBER_GRADLE = 'android {\n    defaultConfig {\n        applicationId "com.trinityone.app"\n        versionCode 300\n    }\n}\n';
const MEMBER_STRINGS = '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="app_name">TrinityOne</string>\n    <string name="title_activity_main">TrinityOne</string>\n</resources>\n';
const sha = (b) => createHash('sha256').update(b).digest('hex');

// what a page pulls in: the same derivation the build script makes (grep href|src, drop remote/anchor/data)
const refsOf = (html) => [...new Set([...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^https?:|^#|^data:/.test(u)))];

const dirs = [];
after(() => dirs.forEach((d) => { try { rmSync(d, { recursive: true, force: true }); } catch {} }));

function scratch({ page = 'steward.html', gradleFails = false, debuggable = false, dropRef = null, gradle = MEMBER_GRADLE, strings = MEMBER_STRINGS } = {}) {
  const T = mkdtempSync(join(tmpdir(), 'trin-capk-')); dirs.push(T);
  const put = (rel, data, mode) => { const p = join(T, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data); if (mode) chmodSync(p, mode); return p; };
  const copy = (rel) => { mkdirSync(dirname(join(T, rel)), { recursive: true }); copyFileSync(join(ROOT, rel), join(T, rel)); };
  for (const s of ['build-steward-apk.sh', 'build-finance-apk.sh', 'manifest-member-only.sh', 'collect-app-page.sh']) copy('scripts/' + s);
  put('scripts/android-env.sh', `export ANDROID_HOME="${T}/sdk"\n`);
  put('scripts/sync-web.sh', 'echo member-sync\n');
  // the real pages and everything they reference (both, so a run of one cannot lean on the other being absent)
  for (const pg of ['steward.html', 'finance.html']) {
    copy(pg);
    for (const f of refsOf(readFileSync(join(ROOT, pg), 'utf8'))) if (existsSync(join(ROOT, f)) && !existsSync(join(T, f))) copy(f);
  }
  cpSync(join(ROOT, 'vendor/fonts'), join(T, 'vendor/fonts'), { recursive: true });
  cpSync(join(ROOT, 'assets/steward-icons'), join(T, 'assets/steward-icons'), { recursive: true });
  cpSync(join(ROOT, 'assets/finance-icons'), join(T, 'assets/finance-icons'), { recursive: true });
  if (dropRef) rmSync(join(T, dropRef));
  // the member project: gradle, strings, manifest, and member launcher icons (distinct bytes per file)
  put('android/app/build.gradle', gradle);
  put('android/app/src/main/res/values/strings.xml', strings);
  put('android/app/keystore.properties', 'x=1\n');
  copyFileSync(MANIFEST_SRC, put('android/app/src/main/AndroidManifest.xml', ''));
  for (const d of DENS) for (const f of ICON_FILES) put(`android/app/src/main/res/mipmap-${d}/${f}`, 'MEMBER ' + d + ' ' + f);
  // tools
  put('node_modules/.bin/esbuild', '#!/usr/bin/env bash\nfor a in "$@"; do case "$a" in --outfile=*) echo "// js" > "${a#--outfile=}";; esac; done\n', 0o755);
  put('bin/npx', '#!/usr/bin/env bash\nexit 0\n', 0o755);
  put('sdk/build-tools/1.0/aapt2', `#!/usr/bin/env bash\necho "package: name=x"\n${debuggable ? 'echo "application-debuggable"\n' : ''}`, 0o755);
  put('android/gradlew', `#!/usr/bin/env bash
mkdir -p "${T}/at-build"
cp -r ../www "${T}/at-build/www"
cp app/build.gradle app/src/main/res/values/strings.xml app/src/main/AndroidManifest.xml "${T}/at-build/"
cp -r app/src/main/res "${T}/at-build/res"
${gradleFails ? 'exit 1' : 'mkdir -p app/build/outputs/apk/release; echo "apk-bytes" > app/build/outputs/apk/release/app-release.apk'}
`, 0o755);
  const run = (script = 'scripts/build-steward-apk.sh', args = []) => spawnSync('bash', [script, ...args], { cwd: T, encoding: 'utf8', env: { ...process.env, PATH: join(T, 'bin') + ':' + process.env.PATH } });
  const read = (rel) => readFileSync(join(T, rel), 'utf8');
  const icons = (base) => Object.fromEntries(DENS.flatMap((d) => ICON_FILES.map((f) => [`${d}/${f}`, sha(readFileSync(join(T, base, `mipmap-${d}`, f)))])));
  const memberIcons = Object.fromEntries(DENS.flatMap((d) => ICON_FILES.map((f) => [`${d}/${f}`, sha(Buffer.from('MEMBER ' + d + ' ' + f))])));
  return { T, run, read, icons, memberIcons, built: existsSync.bind(null, join(T, 'at-build')) };
}

// the member project is back exactly as it was: gradle, strings, manifest byte for byte, member icons, no backup left
function assertMemberRestored(s, gradle = MEMBER_GRADLE, strings = MEMBER_STRINGS) {
  assert.equal(s.read('android/app/build.gradle'), gradle, 'build.gradle was not put back (applicationId)');
  assert.equal(s.read('android/app/src/main/res/values/strings.xml'), strings, 'strings.xml was not put back (app name)');
  assert.equal(s.read('android/app/src/main/AndroidManifest.xml'), readFileSync(MANIFEST_SRC, 'utf8'), 'the member manifest was not put back byte for byte');
  assert.ok(!existsSync(join(s.T, 'android/app/src/main/AndroidManifest.xml.member-bak')), 'a manifest backup was left behind');
  assert.deepEqual(s.icons('android/app/src/main/res'), s.memberIcons, 'the member launcher icons were not put back');
}

// every local file the page references is in www/ (JSX as its transpiled .js; babel deliberately dropped)
function assertWwwComplete(s, page) {
  const refs = refsOf(readFileSync(join(ROOT, page), 'utf8'));
  assert.ok(refs.length >= 20, `only ${refs.length} refs parsed from ${page}`);
  const missing = refs.filter((f) => f !== 'vendor/babel.min.js')
    .map((f) => f.replace(/^(app\/.*)\.jsx$/, '$1.js'))
    .filter((f) => !existsSync(join(s.T, 'at-build/www', f)));
  assert.deepEqual(missing, [], `the packaged www/ lacks files ${page} asks for — in the APK each is "Unable to open asset URL"`);
  const idx = readFileSync(join(s.T, 'at-build/www/index.html'), 'utf8');
  assert.doesNotMatch(idx, /babel\.min\.js|type="text\/babel"/, 'index.html still loads runtime Babel / .jsx');
  return idx;
}

test('FINANCE: the real finance.html is packaged complete, under com.trinityone.finance / "TrinityOne Finance" with the finance icons; the member project comes back', () => {
  const s = scratch();
  const r = s.run('scripts/build-finance-apk.sh');
  assert.equal(r.status, 0, 'the (stubbed) finance build failed: ' + r.stderr.slice(-600) + r.stdout.slice(-300));
  assert.ok(s.built(), 'gradle never ran');
  const idx = assertWwwComplete(s, 'finance.html');
  assert.match(idx, /<title>TrinityOne Finance<\/title>/, 'www/index.html is not finance.html');
  assert.match(idx, /src="finance-mode\.js"/, 'the finance app flag script is not in the packaged page');
  assert.ok(existsSync(join(s.T, 'at-build/www/finance-mode.js')), 'finance-mode.js was not packaged');
  assert.match(s.read('at-build/build.gradle'), /applicationId "com\.trinityone\.finance"/);
  assert.match(s.read('at-build/strings.xml'), /<string name="app_name">TrinityOne Finance<\/string>/);
  assert.match(s.read('at-build/strings.xml'), /<string name="title_activity_main">TrinityOne Finance<\/string>/, 'the launcher activity label must say TrinityOne Finance');
  assert.deepEqual(s.icons('at-build/res'), s.icons('assets/finance-icons'), 'gradle was not handed the finance launcher icons');
  const m = s.read('at-build/AndroidManifest.xml');
  assert.doesNotMatch(m, /scheme="content"|pathPrefix="\/join"|autoVerify/, 'a member-only filter reached the finance build');
  assert.match(m, /android\.intent\.action\.MAIN/);
  assert.ok(existsSync(join(s.T, 'trinityone-finance.apk')), 'no trinityone-finance.apk was produced');
  assert.ok(!existsSync(join(s.T, 'trinityone-steward.apk')), 'the finance build wrote the steward APK');
  assertMemberRestored(s);
});

test('STEWARD (the default, no argument — how release.sh calls it): steward.html, com.trinityone.steward / "TrinityOne Console", steward icons, trinityone-steward.apk', () => {
  const s = scratch();
  const r = s.run();
  assert.equal(r.status, 0, r.stderr.slice(-600));
  const idx = assertWwwComplete(s, 'steward.html');
  // steward.html with exactly the build's two rewrites (sed: drop the babel line; text/babel .jsx -> plain .js)
  const want = readFileSync(join(ROOT, 'steward.html'), 'utf8').split('\n').filter((l) => !/babel\.min\.js/.test(l)).join('\n')
    .replace(/<script type="text\/babel" src="([^"]*)\.jsx">/g, '<script src="$1.js">');
  assert.equal(idx, want, 'www/index.html is not steward.html with the JSX rewrite');
  assert.match(s.read('at-build/build.gradle'), /applicationId "com\.trinityone\.steward"/);
  assert.match(s.read('at-build/strings.xml'), /<string name="app_name">TrinityOne Console<\/string>/);
  assert.deepEqual(s.icons('at-build/res'), s.icons('assets/steward-icons'), 'gradle was not handed the steward launcher icons');
  assert.ok(existsSync(join(s.T, 'trinityone-steward.apk')));
  assert.ok(!existsSync(join(s.T, 'trinityone-finance.apk')), 'the steward build wrote a finance APK');
  assertMemberRestored(s);
});

for (const app of ['steward', 'finance']) {
  test(`${app.toUpperCase()}: gradle FAILS half way — exit non-zero, and the member id, name, icons and manifest all come back`, () => {
    const s = scratch({ gradleFails: true });
    const r = s.run('scripts/build-steward-apk.sh', [app]);
    assert.notEqual(r.status, 0, 'a failed gradle was reported as success');
    assert.ok(s.built(), 'fixture: the build did not reach gradle, so this does not exercise the mid-way failure');
    assert.match(s.read('at-build/build.gradle'), new RegExp(`com\\.trinityone\\.${app}"`), 'fixture: the swap had not happened when gradle ran');
    assertMemberRestored(s);
  });

  test(`${app.toUpperCase()}: a page that references a missing file FAILS before gradle, and the project comes back`, () => {
    const s = scratch({ dropRef: 'app/error-boundary.jsx' });
    const r = s.run('scripts/build-steward-apk.sh', [app]);
    assert.notEqual(r.status, 0, 'the build shipped a page with a missing file');
    assert.match(r.stderr, new RegExp(`${app}\\.html references app/error-boundary\\.jsx, which does not exist`));
    assert.ok(!s.built(), 'gradle ran despite a missing file');
    assertMemberRestored(s);
  });

  test(`${app.toUpperCase()}: aapt2 reports the APK debuggable — the build refuses (same guard for both)`, () => {
    const s = scratch({ debuggable: true });
    const r = s.run('scripts/build-steward-apk.sh', [app]);
    assert.notEqual(r.status, 0, 'a debuggable APK was not refused');
    assert.match(r.stderr, /DEBUGGABLE — refusing to ship/);
    assertMemberRestored(s);
  });
}

test('a project LEFT IN THE OTHER CONSOLE\'S IDENTITY (a hard-killed steward build) — the finance build refuses rather than ship as com.trinityone.steward, and restore puts the member id back', () => {
  const killedGradle = MEMBER_GRADLE.replace('com.trinityone.app', 'com.trinityone.steward');
  const killedStrings = MEMBER_STRINGS.replace('<string name="app_name">TrinityOne</string>', '<string name="app_name">TrinityOne Console</string>');
  const s = scratch({ gradle: killedGradle, strings: killedStrings });
  const r = s.run('scripts/build-finance-apk.sh');
  assert.notEqual(r.status, 0, 'the finance build went ahead in the steward identity');
  assert.match(r.stderr, /does not carry applicationId "com\.trinityone\.finance"/);
  assert.ok(!s.built(), 'gradle ran in the wrong identity');
  assertMemberRestored(s);
});

test('an unknown app name is refused before anything is touched', () => {
  const s = scratch();
  const r = s.run('scripts/build-steward-apk.sh', ['member']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: .*\[steward\|finance\]/);
  assert.ok(!existsSync(join(s.T, 'www')), 'www/ was touched');
  assertMemberRestored(s);
});
