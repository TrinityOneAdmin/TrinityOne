// INSTALL A BIBLE FROM A FILE — THE ANDROID MANIFEST, AND KEEPING IT OUT OF THE CONSOLE APK.
// Run: node --test scripts/install-bible-from-file-manifest.test.mjs
//
// "Open with TrinityOne" is one intent-filter in android/app/src/main/AndroidManifest.xml, the ONLY tracked file
// under android/. The Console (steward) APK builds from the SAME manifest — scripts/build-steward-apk.sh swaps only
// the applicationId, name, icons and webDir — so without a strip step the Console would be offered for every zip
// on the phone and do nothing when tapped (audit H2, 2026-11-14).
//
//   M1  the tracked manifest: a VIEW filter for scheme content only, between BEGIN/END markers; the MAIN and the
//       autoVerify /join filters are intact. (A text check on XML is allowed: rule 3 is about app/*.jsx.)
//   M2  THE REAL build-steward-apk.sh IS RUN, in a scratch tree with stubbed tools (gradle, npx, esbuild, aapt2).
//       The stub gradle copies the manifest it was handed. That copy must hold no content filter; afterwards the
//       member manifest is back, byte for byte — on success AND when the build dies half way (the existing trap).
//   M3  scripts/manifest-member-only.sh on its own: strip, restore, a crashed previous run, no marker.
// FAKED, and named: gradle, npx cap, esbuild, aapt2 and android-env.sh (tiny stubs in the scratch tree). Not proved
// here: that Android really lists TrinityOne for a zip (device check), or that an APK builds (APKs cannot be built
// from a worktree — memory: no-apk-build-from-a-worktree).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, copyFileSync, existsSync, chmodSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
const MANIFEST = join(ROOT, 'android/app/src/main/AndroidManifest.xml');
const manifest = () => readFileSync(MANIFEST, 'utf8');
const filters = (xml) => [...xml.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<intent-filter[\s\S]*?<\/intent-filter>/g)].map(m => m[0]);

test('M1 — the tracked manifest: one VIEW filter, scheme content only, between the BEGIN and END markers; MAIN and /join untouched', () => {
  const xml = manifest();
  const lines = xml.split('\n');
  const b = lines.findIndex(l => /^\s*<!-- BEGIN install-from-file \(member only\) -->\s*$/.test(l));
  const e = lines.findIndex(l => /^\s*<!-- END install-from-file -->\s*$/.test(l));
  assert.ok(b > 0 && e > b, 'the BEGIN/END markers are missing, or not on their own lines in that order');
  assert.equal(lines.filter(l => /BEGIN install-from-file/.test(l)).length, 1);
  assert.equal(lines.filter(l => /END install-from-file/.test(l)).length, 1);
  const inside = filters(lines.slice(b, e + 1).join('\n'));
  assert.equal(inside.length, 1, 'the marked block must hold exactly one intent-filter');
  const f = inside[0];
  assert.match(f, /android\.intent\.action\.VIEW/);
  assert.match(f, /android\.intent\.category\.DEFAULT/);
  assert.doesNotMatch(f, /BROWSABLE/, 'BROWSABLE would offer us links from a web page');
  const schemes = [...f.matchAll(/android:scheme="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual([...new Set(schemes)], ['content'], 'schemes other than content: ' + schemes);
  const mimes = [...f.matchAll(/android:mimeType="([^"]+)"/g)].map(m => m[1]).sort();
  assert.deepEqual(mimes, ['application/octet-stream', 'application/vnd.sqlite3', 'application/x-sqlite3', 'application/x-zip-compressed', 'application/zip']);
  // outside the block: exactly the two filters that were there before, unchanged
  const outside = filters([...lines.slice(0, b), ...lines.slice(e + 1)].join('\n'));
  assert.equal(outside.length, 2, 'filters outside the marked block: ' + outside.length);
  assert.ok(outside.some(x => /android\.intent\.action\.MAIN/.test(x) && /category\.LAUNCHER/.test(x)), 'the MAIN/LAUNCHER filter is gone');
  const join = outside.find(x => /autoVerify/.test(x) || /pathPrefix="\/join"/.test(x));
  assert.ok(join && /android:autoVerify="true"/.test(xml) && /android:host="app\.trinityone\.church"/.test(join) && /android:scheme="https"/.test(join), 'the autoVerify /join filter changed');
  assert.ok(!outside.some(x => /scheme="content"/.test(x)), 'a content filter exists OUTSIDE the markers, where the Console strip cannot reach it');
});

// ── a scratch tree to run the REAL build script in ───────────────────────────────────────────────────────────
const dirs = [];
after(() => dirs.forEach(d => { try { rmSync(d, { recursive: true, force: true }); } catch {} }));
function scratch({ gradleFails = false } = {}) {
  const T = mkdtempSync(join(tmpdir(), 'trin-m-')); dirs.push(T);
  const put = (rel, text, mode) => { const p = join(T, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, text); if (mode) chmodSync(p, mode); return p; };
  mkdirSync(join(T, 'scripts'), { recursive: true });
  copyFileSync(join(ROOT, 'scripts/build-steward-apk.sh'), join(T, 'scripts/build-steward-apk.sh'));
  copyFileSync(join(ROOT, 'scripts/manifest-member-only.sh'), join(T, 'scripts/manifest-member-only.sh'));
  put('scripts/android-env.sh', `export ANDROID_HOME="${T}/sdk"\n`);
  put('scripts/sync-web.sh', 'echo member-sync\n');
  put('steward.html', '<link href="vendor/x.css"><script type="text/babel" src="app/a.jsx"></script>\n');
  put('vendor/x.css', '/* x */'); put('vendor/fonts/f.txt', 'f'); put('app/a.jsx', 'const a = 1;');
  put('node_modules/.bin/esbuild', '#!/usr/bin/env bash\nfor a in "$@"; do case "$a" in --outfile=*) echo "// js" > "${a#--outfile=}";; esac; done\n', 0o755);
  put('bin/npx', '#!/usr/bin/env bash\nexit 0\n', 0o755);
  put('android/app/build.gradle', 'applicationId "com.trinityone.app"\n');
  put('android/app/src/main/res/values/strings.xml', '<string name="app_name">TrinityOne</string>\n');
  put('android/app/keystore.properties', 'x=1\n');
  put('sdk/build-tools/1.0/aapt2', '#!/usr/bin/env bash\necho "package: name=x"\n', 0o755);
  copyFileSync(MANIFEST, put('android/app/src/main/AndroidManifest.xml', ''));
  put('android/gradlew', `#!/usr/bin/env bash\ncp app/src/main/AndroidManifest.xml "${T}/manifest-at-build.xml"\n${gradleFails ? 'exit 1\n' : `mkdir -p app/build/outputs/apk/release; echo apk > app/build/outputs/apk/release/app-release.apk\n`}`, 0o755);
  const run = () => spawnSync('bash', ['scripts/build-steward-apk.sh'], { cwd: T, encoding: 'utf8', env: { ...process.env, PATH: join(T, 'bin') + ':' + process.env.PATH } });
  return { T, run, manifestNow: () => readFileSync(join(T, 'android/app/src/main/AndroidManifest.xml'), 'utf8'), atBuild: () => readFileSync(join(T, 'manifest-at-build.xml'), 'utf8') };
}

test('M2 — THE REAL build-steward-apk.sh hands gradle a manifest with NO content filter, and puts the member manifest back byte for byte', () => {
  const original = manifest();
  const s = scratch();
  assert.equal(s.manifestNow(), original, 'scratch fixture is not the tracked manifest');
  const r = s.run();
  assert.equal(r.status, 0, 'the (stubbed) build failed: ' + r.stderr.slice(-400) + r.stdout.slice(-400));
  assert.ok(existsSync(join(s.T, 'manifest-at-build.xml')), 'gradle never ran — the stub tree no longer reaches the build step');
  const built = s.atBuild();
  assert.doesNotMatch(built, /scheme="content"/, 'THE CONSOLE APK WOULD BE OFFERED FOR EVERY ZIP: a content filter reached the build');
  assert.doesNotMatch(built, /install-from-file/, 'the marker block (or part of it) reached the build');
  assert.match(built, /android\.intent\.action\.MAIN/, 'the strip took the launcher filter with it');
  assert.match(built, /android:autoVerify="true"/, 'the strip took the /join filter with it');
  assert.equal(filters(built).length, 2, 'the Console manifest should keep exactly the launcher and /join filters');
  assert.equal(s.manifestNow(), original, 'the member manifest was not restored byte for byte');
  assert.ok(!existsSync(join(s.T, 'android/app/src/main/AndroidManifest.xml.member-bak')), 'a backup file was left behind');
});

test('M2b — if the build DIES half way, the existing exit trap still puts the member manifest back', () => {
  const original = manifest();
  const s = scratch({ gradleFails: true });
  const r = s.run();
  assert.notEqual(r.status, 0, 'the stub gradle failed but the script reported success — the fixture does not exercise the trap');
  assert.doesNotMatch(s.atBuild(), /scheme="content"/, 'the failing build was handed the member manifest');
  assert.equal(s.manifestNow(), original, 'a failed Console build left the member manifest stripped');
});

test('M3 — manifest-member-only.sh on its own: strip removes only the marked block; restore is exact; a crashed previous run is repaired first', () => {
  const original = manifest();
  const T = mkdtempSync(join(tmpdir(), 'trin-m3-')); dirs.push(T);
  const m = join(T, 'AndroidManifest.xml');
  const sh = (mode, extra = m) => execFileSync('bash', [join(ROOT, 'scripts/manifest-member-only.sh'), mode, extra], { encoding: 'utf8' });
  writeFileSync(m, original);
  sh('strip');
  const stripped = readFileSync(m, 'utf8');
  assert.doesNotMatch(stripped, /scheme="content"/);
  assert.equal(filters(stripped).length, 2);
  assert.ok(stripped.length < original.length);
  sh('strip');                                           // a second strip (a crashed earlier build) must not back up the stripped file
  sh('restore');
  assert.equal(readFileSync(m, 'utf8'), original, 'restore after a double strip lost the original');
  sh('restore');                                         // nothing to restore: harmless
  assert.equal(readFileSync(m, 'utf8'), original);
  // a manifest with no marked block is left alone by strip
  const plain = original.replace(/[ \t]*<!-- BEGIN install-from-file[\s\S]*?<!-- END install-from-file -->\n/, '');
  assert.notEqual(plain, original);
  writeFileSync(m, plain); sh('strip'); assert.equal(readFileSync(m, 'utf8'), plain); sh('restore'); assert.equal(readFileSync(m, 'utf8'), plain);
  const bad = spawnSync('bash', [join(ROOT, 'scripts/manifest-member-only.sh'), 'nonsense'], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0, 'an unknown mode was accepted');
});

// ═══════════ AUDIT 2026-11-14 (67c49830): L3 a hard kill between strip and restore, L8 octet-stream documented ═══════════

function killedBuild() {
  const original = manifest();
  const T = mkdtempSync(join(tmpdir(), 'trin-m4-')); dirs.push(T);
  const m = join(T, 'AndroidManifest.xml');
  writeFileSync(m, original);
  const sh = (mode) => spawnSync('bash', [join(ROOT, 'scripts/manifest-member-only.sh'), mode, m], { encoding: 'utf8' });
  return { original, m, sh, bak: m + '.member-bak', read: () => readFileSync(m, 'utf8') };
}

test('M4 — L3: AFTER A HARD KILL (no trap ran) the next run puts the known-good copy back first, and the next restore is exact', () => {
  const k = killedBuild();
  assert.equal(k.sh('strip').status, 0);
  assert.ok(existsSync(k.bak), 'fixture: strip made no backup');
  assert.doesNotMatch(k.read(), /scheme="content"/);
  // ...SIGKILL: no restore ran. The manifest is stripped and the backup sits beside it. Next Console build:
  assert.equal(k.sh('strip').status, 0, 'the next strip refused to run after a crash');
  assert.equal(readFileSync(k.bak, 'utf8'), k.original, 'the backup is no longer the member manifest (it backed up the stripped file)');
  assert.equal(k.sh('restore').status, 0);
  assert.equal(k.read(), k.original, 'after a crash and a re-run the member manifest did not come back');
  // and a release that follows a kill with NO Console build re-run is stopped, not shipped without the filter
  const k2 = killedBuild(); k2.sh('strip');
  const chk = k2.sh('check');
  assert.notEqual(chk.status, 0, 'check passed on a stripped manifest with a stale backup');
  assert.equal(killedBuild().sh('check').status, 0, 'check failed on an intact member manifest');
});

test('M5 — L3: A MANIFEST EDITED AFTER THE KILL is never overwritten by the stale backup', () => {
  // (a) the member manifest was restored by hand and edited (it HAS its block), the old backup is stale
  const a = killedBuild(); a.sh('strip');
  const edited = a.original.replace('</manifest>', '    <!-- edited by hand after the kill -->\n</manifest>');
  writeFileSync(a.m, edited);
  assert.equal(a.sh('strip').status, 0);
  assert.match(a.read(), /scheme="content"|<manifest/);   // stripped working copy
  assert.equal(a.sh('restore').status, 0);
  assert.equal(a.read(), edited, 'the stale backup was moved over a newer manifest: the edit is lost');
  // (b) the STRIPPED file was edited after the kill: refuse, and lose neither copy
  const b = killedBuild(); b.sh('strip');
  const stripped = b.read();
  const touched = stripped.replace('</manifest>', '    <!-- edited the stripped file -->\n</manifest>');
  writeFileSync(b.m, touched);
  const r = b.sh('strip');
  assert.notEqual(r.status, 0, 'strip ran over a hand-edited stripped manifest');
  assert.equal(b.read(), touched, 'the edit was overwritten');
  assert.equal(readFileSync(b.bak, 'utf8'), b.original, 'the backup was lost');
});

test('M6 — L8: the octet-stream filter is documented in the manifest as deliberate, with the device-check instruction', () => {
  const xml = manifest();
  const block = xml.slice(xml.indexOf('BEGIN install-from-file'), xml.indexOf('END install-from-file'));
  assert.match(block, /application\/octet-stream IS ACCEPTED ON PURPOSE/);
  assert.match(block, /record the MIME\s+type each sender really uses/);
  assert.equal([...block.matchAll(/android:mimeType="application\/octet-stream"/g)].length, 1);
});

test('M7 — L3: release.sh refuses to build from a stripped manifest BEFORE it bumps anything (a refusal must leave nothing half-done)', () => {
  const rel = readFileSync(join(ROOT, 'scripts/release.sh'), 'utf8');
  const at = rel.indexOf('bash scripts/manifest-member-only.sh check');
  assert.ok(at > 0, 'release.sh never checks the member manifest');
  for (const later of ["Release: sw cache", "versionCode", './gradlew assembleRelease']) {
    const i = rel.indexOf(later);
    assert.ok(i > at, `the manifest check comes after "${later}" (${i} <= ${at}): a refusal would leave the release half-done`);
  }
  assert.equal([...rel.matchAll(/manifest-member-only\.sh check/g)].length, 1, 'check should run once, up front');
});

test('M8 — L-d: `restore` brings back a manifest that is MISSING when a backup exists', () => {
  const k = killedBuild();
  k.sh('strip');
  rmSync(k.m);
  assert.equal(k.sh('restore').status, 0);
  assert.equal(k.read(), k.original, 'a deleted manifest was not recovered from the backup');
});
