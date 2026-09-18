// WHICH COMMIT A RELEASE BUILD PACKAGES — the two halves of it, in the two git environments that differ.
// Run: node --test scripts/release-ref.test.mjs
//
// 2026-09-18: relay-v0.8.0 was tagged and every platform failed 20 seconds in:
//
//     build-relay-payload: assembling into .../relay-app/desktop/src-tauri/payload
//     build-strict-tgz: release ref 'main' does not resolve
//     Process completed with exit code 3
//
// The SAME commit had built all three platforms minutes earlier when the workflow was run manually against
// main. The difference is entirely in the checkout: actions/checkout@v4 on a TAG push fetches
// `+<sha>:refs/tags/<tag>` at depth 1 and checks it out DETACHED, so there is no local `main` for
// build-strict-tgz.sh's default ref to resolve. A dry run in a normal clone could not have caught it, and a
// test that only runs in a normal clone cannot catch it either — so this file BUILDS BOTH CHECKOUTS and
// drives the real script in each.
//
// The two things asserted pull in opposite directions and both matter:
//
//   1. a CI tag checkout must resolve ITS OWN ref (the bug), and
//   2. a release host must STILL be unable to ship a dirty tree or an unrelated branch (RELEASE-2026-07-20
//      C1, CRITICAL — the release host used to `git archive` its live HEAD, which is how a8 came to run a
//      WIP commit from a parked branch, predating every security fix of that week, signed with the real
//      release key and installed fleet-wide).
//
// "Just use HEAD" satisfies 1 and reintroduces 2. The fix is that the CALLER names the ref: the workflow
// passes RELEASE_REF=${{ github.ref_name }} — the tag on a tag push, the branch on a manual run — and the
// default stays `main` so an unnamed build still cannot ship the checkout.
//
// NOTE the .github/workflows/ half of that fix is NOT covered here or anywhere else: nothing in this repo
// runs a workflow file. Only a real tagged run proves it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, cpSync, symlinkSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SCRIPT = join(ROOT, 'scripts', 'build-strict-tgz.sh');
const TAG = 'relay-v0.0.0-test';

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
// Blob contents must NOT be trimmed — the comparison is byte-for-byte against what the tarball carries.
const gitRaw = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });

// The script refuses to start without esbuild (it transpiles app/*.jsx), and a fresh checkout has no
// node_modules. Copy in the two packages esbuild needs — 11 MB, and `cp -a` so this works across the
// filesystem boundary between the repo and tmpdir (a hard link cannot cross one).
function minimalEsbuild(dir) {
  const nm = join(dir, 'node_modules');
  mkdirSync(join(nm, '.bin'), { recursive: true });
  cpSync(join(ROOT, 'node_modules', 'esbuild'), join(nm, 'esbuild'), { recursive: true, dereference: false });
  cpSync(join(ROOT, 'node_modules', '@esbuild'), join(nm, '@esbuild'), { recursive: true, dereference: false });
  symlinkSync('../esbuild/bin/esbuild', join(nm, '.bin', 'esbuild'));
}

// Drive the script that is in the WORKING TREE right now, inside the scratch checkout's git environment —
// so an uncommitted regression in it goes red here rather than after it lands.
function installScriptUnderTest(dir) {
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  cpSync(SCRIPT, join(dir, 'scripts', 'build-strict-tgz.sh'));
}

function build(dir, { ref = null, env = {} } = {}) {
  const out = join(dir, 'out.tgz');
  try { rmSync(out, { force: true }); } catch {}
  const e = { ...process.env, ...env };
  delete e.RELEASE_REF;                       // never inherit the runner's own; each row sets what it means
  if (env.RELEASE_REF !== undefined) e.RELEASE_REF = env.RELEASE_REF;
  const r = spawnSync('bash', [join(dir, 'scripts', 'build-strict-tgz.sh'), out, ...(ref ? [ref] : [])],
    { cwd: dir, env: e, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  return { status: r.status, stderr: r.stderr || '', stdout: r.stdout || '', out };
}

const listing = (tgz) => String(execFileSync('tar', ['tzf', tgz], { maxBuffer: 512 * 1024 * 1024 }))
  .split('\n').map(s => s.trim().replace(/^\.\//, '')).filter(Boolean);
const extract = (tgz, path) => String(execFileSync('tar', ['xzfO', tgz, './' + path], { maxBuffer: 512 * 1024 * 1024 }));

// ── 1. THE BUG: a shallow, DETACHED tag checkout, exactly as actions/checkout@v4 leaves one ───────────────
test('a CI tag checkout has no `main`, and the release build resolves the tag it was cut from', (t) => {
  const scratch = mkdtempSync(join(tmpdir(), 'trinityone-release-ref-tag-'));
  t.after(() => { try { rmSync(scratch, { recursive: true, force: true }); } catch {} });
  const dir = join(scratch, 'ci');
  mkdirSync(dir, { recursive: true });

  // actions/checkout@v4, ref-helper.ts: a ref under refs/ that is not refs/heads/ or refs/pull/ is fetched
  // as `+<commit>:<ref>` at the configured depth (1 by default), then checked out with no start point —
  // i.e. detached. Reproduced here against this very repo.
  git(dir, ['init', '-q']);
  git(dir, ['remote', 'add', 'origin', 'file://' + ROOT]);
  git(dir, ['config', '--local', 'gc.auto', '0']);
  git(dir, ['-c', 'protocol.version=2', 'fetch', '--no-tags', '--prune', '--no-recurse-submodules',
    '--depth=1', 'origin', '+HEAD:refs/tags/' + TAG]);
  git(dir, ['checkout', '--force', 'refs/tags/' + TAG]);

  // PROVE the repro is the real thing before trusting anything built on it. If `main` resolved here, this
  // checkout is not the one CI had and every assertion below would be theatre.
  assert.equal(git(dir, ['rev-parse', '--is-shallow-repository']), 'true', 'the repro must be SHALLOW');
  assert.equal(spawnSync('git', ['-C', dir, 'symbolic-ref', '-q', 'HEAD']).status, 1, 'HEAD must be DETACHED');
  assert.equal(spawnSync('git', ['-C', dir, 'rev-parse', '--verify', '--quiet', 'main']).status, 1,
    '`main` must NOT resolve in the repro — otherwise this is not the checkout that failed in CI');
  const tagSha = git(dir, ['rev-parse', TAG + '^{commit}']);

  installScriptUnderTest(dir);
  minimalEsbuild(dir);

  // (a) the failure as CI reported it: no ref named, `main` absent → the guard fires, exit 3. This is the
  //     guard doing its job, and it must KEEP doing it — it is all that stands between a mis-set ref and a
  //     silently wrong release.
  const unnamed = build(dir);
  assert.equal(unnamed.status, 3, 'with no ref named and no `main`, the build must refuse (exit 3)');
  assert.match(unnamed.stderr, /release ref 'main' does not resolve/);

  // (b) RELEASE_REF names the tag — the workflow's fix. It resolves in this checkout and builds.
  const viaEnv = build(dir, { env: { RELEASE_REF: TAG } });
  assert.equal(viaEnv.status, 0, 'RELEASE_REF=<tag> must build in a tag checkout\n' + viaEnv.stderr);
  assert.ok(existsSync(viaEnv.out));

  // (c) and it packages THE TAGGED COMMIT — compared against that commit's blob, not against the worktree.
  assert.equal(extract(viaEnv.out, 'package.json'), gitRaw(dir, ['show', tagSha + ':package.json']),
    'the tarball must carry the tagged commit\'s files');
  // version.txt carries the answer to "which commit is this?" in the shipped tree itself (.gitattributes
  // export-subst). It must name the tag's commit — /suite-update and relay-update.sh's anti-rollback both
  // read it, so a bundle that names a different commit than it contains misreports every relay's version.
  assert.equal(extract(viaEnv.out, 'version.txt').split('\n')[0].trim(), tagSha,
    'the shipped version.txt must name the tagged commit');

  // (d) the positional argument still works — gateway.mjs's ensureSignedBundle passes the sha that way.
  const viaArg = build(dir, { ref: TAG });
  assert.equal(viaArg.status, 0, 'the positional ref must still build\n' + viaArg.stderr);
});

// ── 2. RELEASE-2026-07-20 C1: the release host still cannot ship what it happens to have checked out ──────
test('a dirty tree and an unrelated branch still cannot reach the release tarball', (t) => {
  const scratch = mkdtempSync(join(tmpdir(), 'trinityone-release-ref-host-'));
  t.after(() => { try { rmSync(scratch, { recursive: true, force: true }); } catch {} });
  const dir = join(scratch, 'host');
  mkdirSync(dir, { recursive: true });

  // A release host: `main` exists, but an unrelated branch is checked out and the tree is dirty — the exact
  // state this dev box is in most of the time, since it is both the dev machine and the release origin.
  git(dir, ['init', '-q']);
  git(dir, ['remote', 'add', 'origin', 'file://' + ROOT]);
  git(dir, ['-c', 'protocol.version=2', 'fetch', '--no-tags', '--depth=1', 'origin', '+HEAD:refs/heads/main']);
  git(dir, ['checkout', '--force', 'main']);
  const mainSha = git(dir, ['rev-parse', 'main^{commit}']);
  const mainLicense = gitRaw(dir, ['show', mainSha + ':LICENSE']);

  git(dir, ['checkout', '-q', '-b', 'wip/not-a-release']);
  writeFileSync(join(dir, 'WIP-SENTINEL.txt'), 'committed on an unrelated branch, must never ship\n');
  git(dir, ['add', 'WIP-SENTINEL.txt']);
  git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'wip: not a release']);
  // …and an uncommitted edit to a tracked file that DOES ship, on top of that. LICENSE, not package.json:
  // esbuild parses the nearest package.json, so dirtying THAT one fails the build for an unrelated reason
  // and this row would then have passed for the wrong cause.
  appendFileSync(join(dir, 'LICENSE'), '\nDIRTY-WORKING-TREE-SENTINEL\n');

  installScriptUnderTest(dir);
  minimalEsbuild(dir);

  // No ref named — the default. It must be `main`, never HEAD.
  const r = build(dir);
  assert.equal(r.status, 0, 'the default build must succeed where `main` exists\n' + r.stderr);

  const files = listing(r.out);
  assert.ok(!files.includes('WIP-SENTINEL.txt'),
    'C1: a commit on the checked-out branch reached the release tarball — the ref is being read from HEAD');
  const lic = extract(r.out, 'LICENSE');
  assert.ok(!lic.includes('DIRTY-WORKING-TREE-SENTINEL'),
    'C1: an uncommitted working-tree edit reached the release tarball');
  assert.equal(lic, mainLicense, 'the tarball must be `main`\'s tree exactly');
  assert.equal(extract(r.out, 'version.txt').split('\n')[0].trim(), mainSha,
    'C1: the shipped version.txt must name `main`, not the branch this host has checked out');

  // And RELEASE_REF cannot be used to smuggle the checkout in either: naming the branch is a deliberate act
  // by whoever sets it, but nothing makes the DEFAULT drift onto HEAD.
  const named = build(dir, { env: { RELEASE_REF: 'main' } });
  assert.equal(named.status, 0, named.stderr);
  assert.ok(!listing(named.out).includes('WIP-SENTINEL.txt'));
});
