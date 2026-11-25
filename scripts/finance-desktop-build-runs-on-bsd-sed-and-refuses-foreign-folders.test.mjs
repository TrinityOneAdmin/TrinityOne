// THE DESKTOP FINANCE BUILD RUNS ON A MAC'S SED, AND NEVER DELETES A FOLDER IT DID NOT WRITE.
// Run: node --test scripts/finance-desktop-build-runs-on-bsd-sed-and-refuses-foreign-folders.test.mjs
//
// Audit of 854c4115 (T1Finance desktop step 2), items 2 and 5.
//
// 1. scripts/build-finance-desktop.sh and scripts/collect-app-page.sh are run on a Mac for the Mac build. Both used
//    GNU-only `sed -i` forms, which BSD sed reads differently (`sed -i -e X f` takes "-e" as the backup suffix; a `\n`
//    in a replacement is not a newline). The edits are now node. Proof: the REAL scripts run with a `sed` first on
//    PATH that REFUSES any in-place edit (-i in any form) and logs every call — the build must succeed, write the
//    same index.html edits, and never have asked for -i.
// 2. collect-app-page.sh does `rm -rf <out>`. `build-finance-desktop.sh .` used to mean `rm -rf` of the whole
//    checkout. It must now refuse the repo root, any folder above it, $HOME, a plain file, and any non-empty folder
//    that lacks the marker it writes into its own output — and delete NOTHING. Run against a throwaway copy of the
//    scripts in a temp tree (so a regression deletes a temp folder, not this checkout). `/` is refused by the same
//    check but is deliberately NOT run here: a regression would make the test `rm -rf /`.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, copyFileSync, chmodSync, readdirSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
const dirs = [];
after(() => dirs.forEach((d) => { try { rmSync(d, { recursive: true, force: true }); } catch {} }));
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };

test('the real desktop build succeeds with a sed that refuses every in-place edit (BSD/macOS-safe), and edits index.html the same way', () => {
  const T = tmp('trin-fdsed-');
  const shim = join(T, 'bin'); mkdirSync(shim);
  const log = join(T, 'sed.log');
  const realSed = execFileSync('bash', ['-c', 'command -v sed'], { encoding: 'utf8' }).trim();
  writeFileSync(join(shim, 'sed'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
for a in "$@"; do case "$a" in -i*|--in-place*) echo "sed shim: in-place edit refused (BSD sed reads GNU -i differently): $*" >&2; exit 2;; esac; done
exec ${JSON.stringify(realSed)} "$@"
`);
  chmodSync(join(shim, 'sed'), 0o755);
  const OUT = join(T, 'dist');
  const r = spawnSync('bash', ['scripts/build-finance-desktop.sh', OUT], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, PATH: shim + ':' + process.env.PATH } });
  assert.equal(r.status, 0, 'the build failed under a BSD-like sed:\n' + (r.stderr || '').slice(-800));
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
  assert.ok(calls.length >= 1, 're-anchor: the shim saw no sed call at all — is it on PATH?');
  assert.ok(calls.every((c) => !/(^|\s)-i/.test(c)), 'an in-place sed is still used: ' + calls.join(' | '));
  const html = readFileSync(join(OUT, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /babel\.min\.js|text\/babel|\.jsx"/, 'the Babel line / .jsx script tags were not rewritten');
  assert.doesNotMatch(html, /sw-register/, 'sw-register.js is still loaded');
  assert.match(html, /<script src="desktop-build\.js"><\/script>\n<script src="finance-mode\.js"><\/script>/, 'desktop-build.js is not on its own line right before finance-mode.js');
  assert.equal(html.match(/desktop-build\.js/g).length, 1);
  assert.match(html, /<script src="app\/finance-shell\.js">/, 'a JSX script tag did not become its .js');
});

// a throwaway "repo" holding just what build-finance-desktop.sh reads before it deletes anything
function fakeRepo() {
  const T = tmp('trin-fdrm-');
  const repo = join(T, 'outer', 'repo');
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  mkdirSync(join(repo, 'finance-app/desktop/src-tauri'), { recursive: true });
  for (const f of ['scripts/build-finance-desktop.sh', 'scripts/collect-app-page.sh', 'finance.html', 'finance-app/desktop/src-tauri/tauri.conf.json']) copyFileSync(join(ROOT, f), join(repo, f));
  writeFileSync(join(T, 'outer', 'sentinel-outer'), 'x');
  writeFileSync(join(repo, 'sentinel-repo'), 'x');
  mkdirSync(join(T, 'home')); writeFileSync(join(T, 'home', 'sentinel-home'), 'x');
  mkdirSync(join(repo, 'notes')); writeFileSync(join(repo, 'notes', 'sentinel-notes'), 'x');
  writeFileSync(join(repo, 'a-file'), 'x');
  return { T, repo, home: join(T, 'home') };
}
const snapshot = (d) => execFileSync('bash', ['-c', 'find . | LC_ALL=C sort'], { cwd: d, encoding: 'utf8' });

test('`build-finance-desktop.sh .` (and .., $HOME, a file, a foreign folder) refuses and deletes NOTHING', () => {
  const { T, repo, home } = fakeRepo();
  const before = snapshot(T);
  for (const out of ['.', '..', home, join(T, 'outer'), 'a-file', 'notes', './notes/', join(repo, 'scripts')]) {
    const r = spawnSync('bash', ['scripts/build-finance-desktop.sh', out], { cwd: repo, encoding: 'utf8', env: { ...process.env, HOME: home } });
    assert.notEqual(r.status, 0, `build-finance-desktop.sh ${out} succeeded`);
    assert.match(r.stderr, /refusing to use/, `${out}: not refused by the output-folder check:\n${r.stderr.slice(-400)}`);
    assert.equal(snapshot(T), before, `build-finance-desktop.sh ${out} changed files on disk`);
  }
  for (const s of ['outer/sentinel-outer', 'outer/repo/sentinel-repo', 'home/sentinel-home', 'outer/repo/notes/sentinel-notes']) assert.ok(existsSync(join(T, s)), s + ' was deleted');
});

test('a previous output (it carries the marker) and a new or empty folder ARE built into — the refusal is not a blanket no', () => {
  const T = tmp('trin-fdok-');
  const out = join(T, 'dist');
  const r1 = spawnSync('bash', ['scripts/collect-app-page.sh', 'finance.html', out], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r1.status, 0, r1.stderr.slice(-400));
  assert.ok(readdirSync(out).includes('.collect-app-page-output'), 'the output carries no marker');
  writeFileSync(join(out, 'stale-from-last-time'), 'x');
  const r2 = spawnSync('bash', ['scripts/collect-app-page.sh', 'finance.html', out], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r2.status, 0, 'a previous output was refused: ' + r2.stderr.slice(-400));
  assert.ok(!existsSync(join(out, 'stale-from-last-time')), 'the previous output was not cleared');
  const empty = join(T, 'empty'); mkdirSync(empty);
  const r3 = spawnSync('bash', ['scripts/collect-app-page.sh', 'finance.html', empty], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r3.status, 0, 'an empty folder was refused: ' + r3.stderr.slice(-400));
});
