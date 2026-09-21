// THE SIGNED RELAY BUNDLE IS PUBLISHED TO THE GITHUB RELEASE FOR ITS TAG — FROM THIS BOX, KEY STAYING HERE.
// Run: node --test scripts/the-relay-bundle-is-published-to-the-release.test.mjs
//
// THE FINDING (AUDIT-suite-ABD-2026-09-21 §6, and REPORT-suite-A's own words). The only signed bundle.tgz +
// bundle.sig in existence were served by the release host's gateway (ensureSignedBundle). relay-app/install.sh
// defaulted to SRC=https://app.trinityone.church, and that host — a follower with no release key and no source
// checkout — answers 404 "no bundle" to /relay-app/bundle.tgz. GitHub Releases for every relay-v* tag carried
// the Suite installers and suite-latest.json, and no bundle at all. The documented server route therefore
// stopped at "couldn't download the code bundle" before it checked or installed anything.
//
// Owner's decision (2026-09-21): server boxes fetch the relay code from GitHub Releases. scripts/publish-relay-
// bundle.sh builds and signs the bundle HERE (the key never goes to CI) and uploads it to the tag's Release.
// This file drives the REAL script in a scratch clone with a key of its own and a fake `gh` on PATH — the real
// gh would need the network and the real key, and neither is allowed in a test. The fake records every call and
// keeps what was "uploaded", so the rows below read what would have reached GitHub.
//
//   §1  the guards: no such tag, no Release yet, GitHub's tag names another commit, a key that is not the
//       fleet's — each refuses with a sentence and uploads nothing;
//   §2  the upload: exactly the assets `--list-assets` names, the signature verifies over the very bytes
//       uploaded, bundle.json describes them honestly, install.sh is the tag's; --dry uploads nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, cpSync, symlinkSync, writeFileSync, readFileSync, existsSync, chmodSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const TAG = 'relay-v0.0.0-publish-test';
const HAS_OPENSSL = spawnSync('openssl', ['version'], { encoding: 'utf8' }).status === 0;
const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

// The scratch release host: a clone of this repo's HEAD with the TEST public key committed in place of the real
// one and tagged, so "verifies against relay-app/release-pubkey.pem" can be true for a key a test may hold.
function releaseHost() {
  const scratch = mkdtempSync(join(tmpdir(), 'trin-publish-'));
  const dir = join(scratch, 'host'); mkdirSync(dir);
  git(dir, ['init', '-q']);
  git(dir, ['remote', 'add', 'origin', 'file://' + ROOT]);
  git(dir, ['-c', 'protocol.version=2', 'fetch', '--no-tags', '--depth=1', 'origin', '+HEAD:refs/heads/main']);
  git(dir, ['checkout', '--force', 'main']);
  const gen = (name) => {
    assert.equal(spawnSync('openssl', ['genpkey', '-algorithm', 'ed25519', '-out', join(scratch, name + '.key')]).status, 0);
    assert.equal(spawnSync('openssl', ['pkey', '-in', join(scratch, name + '.key'), '-pubout', '-out', join(scratch, name + '.pub')]).status, 0);
  };
  gen('release'); gen('other');
  writeFileSync(join(dir, 'relay-app', 'release-pubkey.pem'), readFileSync(join(scratch, 'release.pub')));
  git(dir, ['add', 'relay-app/release-pubkey.pem']);
  git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'test: the test key is the release key here']);
  git(dir, ['tag', TAG]);
  const sha = git(dir, ['rev-parse', TAG + '^{commit}']);
  // the working tree then drifts from the tag — a release host is usually on some other branch — so a row
  // can tell "install.sh as of the tag" from "install.sh as it happens to be on disk"
  writeFileSync(join(dir, 'relay-app', 'install.sh'), readFileSync(join(dir, 'relay-app', 'install.sh'), 'utf8') + '# WORKING-TREE-SENTINEL: not at the tag\n');
  // the scripts under test are the WORKING TREE's, not the clone's committed copies
  cpSync(join(ROOT, 'scripts', 'publish-relay-bundle.sh'), join(dir, 'scripts', 'publish-relay-bundle.sh'));
  cpSync(join(ROOT, 'scripts', 'build-strict-tgz.sh'), join(dir, 'scripts', 'build-strict-tgz.sh'));
  const nm = join(dir, 'node_modules'); mkdirSync(join(nm, '.bin'), { recursive: true });
  cpSync(join(ROOT, 'node_modules', 'esbuild'), join(nm, 'esbuild'), { recursive: true, dereference: false });
  cpSync(join(ROOT, 'node_modules', '@esbuild'), join(nm, '@esbuild'), { recursive: true, dereference: false });
  symlinkSync('../esbuild/bin/esbuild', join(nm, '.bin', 'esbuild'));
  // the fake gh: `release view <tag>` answers from gh/releases/<tag>; `api …/git/ref/tags/<tag>` prints
  // "<type> <sha>" from gh/tags/<tag> (a lightweight tag names the commit; an annotated one names a tag
  // object, which `api …/git/tags/<sha>` resolves from gh/tagobjs/<sha>); `release upload` copies the files
  // into gh/uploaded/<tag>/; every call lands in gh/log. Every call must carry --repo, or the fake refuses.
  const gh = join(scratch, 'gh'); mkdirSync(join(gh, 'releases'), { recursive: true }); mkdirSync(join(gh, 'tags')); mkdirSync(join(gh, 'tagobjs')); mkdirSync(join(gh, 'uploaded'));
  const bin = join(scratch, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env bash
GH=${JSON.stringify(gh)}
printf '%s\\n' "$*" >> "$GH/log"
case "$1 $2" in
  "release view") t="$3"; case " $* " in *" --repo TrinityOneAdmin/TrinityOne "*) ;; *) echo "fake gh: release view without --repo" >&2; exit 1;; esac
       [ -f "$GH/releases/$t" ] || { echo "release not found" >&2; exit 1; }; echo "$t";;
  "api "*) p="$2"; case "$p" in
       repos/TrinityOneAdmin/TrinityOne/git/ref/tags/*) t="\${p##*/}"; [ -f "$GH/tags/$t" ] || { echo "HTTP 404: Not Found" >&2; exit 1; }; cat "$GH/tags/$t";;
       repos/TrinityOneAdmin/TrinityOne/git/tags/*) o="\${p##*/}"; [ -f "$GH/tagobjs/$o" ] || { echo "HTTP 404: Not Found" >&2; exit 1; }; cat "$GH/tagobjs/$o";;
       *) echo "fake gh: unexpected api path $p" >&2; exit 1;; esac;;
  "release upload") t="$3"; shift 3; case " $* " in *" --repo TrinityOneAdmin/TrinityOne "*) ;; *) echo "fake gh: release upload without --repo" >&2; exit 1;; esac
       mkdir -p "$GH/uploaded/$t"; skip=0; for f in "$@"; do if [ "$skip" = 1 ]; then skip=0; continue; fi; case "$f" in --repo) skip=1;; --*) ;; *) cp "$f" "$GH/uploaded/$t/";; esac; done;;
  *) echo "fake gh: $*" >&2; exit 1;;
esac
`); chmodSync(join(bin, 'gh'), 0o755);
  const host = {
    scratch, dir, sha, gh, bin,
    releaseExists(t = TAG) { writeFileSync(join(gh, 'releases', t), ''); },
    remoteTag(t, s) { writeFileSync(join(gh, 'tags', t), 'commit ' + s + '\n'); },
    annotatedTag(t, s) { const o = 'ab'.repeat(20); writeFileSync(join(gh, 'tags', t), 'tag ' + o + '\n'); writeFileSync(join(gh, 'tagobjs', o), s + '\n'); },
    run(args, env = {}) {
      const r = spawnSync('bash', [join(dir, 'scripts', 'publish-relay-bundle.sh'), ...args],
        { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: bin + ':' + process.env.PATH, RELEASE_KEY: join(scratch, 'release.key'), ...env }, timeout: 180000 });
      let log = ''; try { log = readFileSync(join(gh, 'log'), 'utf8'); } catch {}
      const uploads = log.split('\n').filter((l) => l.startsWith('release upload '));
      return { status: r.status, out: r.stdout + r.stderr, log, uploads, uploaded: (t = TAG) => { try { return readdirSync(join(gh, 'uploaded', t)).sort(); } catch { return []; } } };
    },
    stop() { rmSync(scratch, { recursive: true, force: true }); },
  };
  return host;
}

const ASSETS = spawnSync('bash', [join(ROOT, 'scripts', 'publish-relay-bundle.sh'), '--list-assets'], { encoding: 'utf8' }).stdout.trim().split('\n');

// ── §1 · the guards ──────────────────────────────────────────────────────────────────────────────────────

test('publish-relay-bundle.sh refuses a tag this checkout does not have, before calling gh at all', { skip: HAS_OPENSSL ? false : 'no openssl' }, () => {
  const h = releaseHost();
  try {
    const r = h.run(['relay-v9.9.9-nowhere']);
    assert.notEqual(r.status, 0, 'a tag that does not exist was accepted');
    assert.match(r.out, /no tag 'relay-v9\.9\.9-nowhere' in this checkout/, 'the refusal does not name the missing tag: ' + r.out);
    assert.equal(r.log, '', 'gh was called for a tag that does not exist locally');
  } finally { h.stop(); }
});

test('it refuses a tag that has no GitHub Release yet — it attaches to a Release, never creates one', { skip: HAS_OPENSSL ? false : 'no openssl' }, () => {
  const h = releaseHost();
  try {
    const r = h.run([TAG]);
    assert.notEqual(r.status, 0, 'a tag with no Release was accepted');
    assert.match(r.out, /no GitHub Release for/, 'the refusal does not say the Release is missing: ' + r.out);
    assert.doesNotMatch(r.out, /building the bundle/, 'it built a bundle for a release that does not exist');
    assert.equal(r.uploads.length, 0, 'gh release upload was called');
  } finally { h.stop(); }
});

test('it refuses when the tag on GitHub names a different commit from the local tag', { skip: HAS_OPENSSL ? false : 'no openssl' }, () => {
  const h = releaseHost();
  try {
    h.releaseExists(); h.remoteTag(TAG, 'b'.repeat(40));
    const r = h.run([TAG]);
    assert.notEqual(r.status, 0, 'a tag naming another commit on GitHub was accepted');
    assert.match(r.out, /would disagree/, 'the refusal does not say the two builds would disagree: ' + r.out);
    assert.equal(r.uploads.length, 0, 'gh release upload was called');
  } finally { h.stop(); }
});

test('a key that is not the fleet\'s release key signs a bundle nobody would accept — refused, nothing uploaded', { skip: HAS_OPENSSL ? false : 'no openssl' }, () => {
  const h = releaseHost();
  try {
    h.releaseExists(); h.remoteTag(TAG, h.sha);
    const r = h.run([TAG], { RELEASE_KEY: join(h.scratch, 'other.key') });
    assert.notEqual(r.status, 0, 'a bundle signed by the wrong key was published');
    assert.match(r.out, /not the release key the fleet trusts/, 'the refusal does not say the key is wrong: ' + r.out.slice(-600));
    assert.equal(r.uploads.length, 0, 'gh release upload was called with a signature the fleet would refuse');
    assert.deepEqual(r.uploaded(), [], 'files reached the release');
  } finally { h.stop(); }
});

// ── §2 · the upload ──────────────────────────────────────────────────────────────────────────────────────

test('with the right key it uploads exactly the named assets, the signature verifies over the uploaded bytes, and bundle.json is honest', { skip: HAS_OPENSSL ? false : 'no openssl' }, () => {
  const h = releaseHost();
  try {
    h.releaseExists(); h.remoteTag(TAG, h.sha);
    const r = h.run([TAG]);
    assert.equal(r.status, 0, 'the publish failed:\n' + r.out.slice(-1200));
    assert.equal(r.uploads.length, 1, 'expected exactly one gh release upload call: ' + r.log);
    assert.match(r.uploads[0], /--clobber/, 'the upload does not --clobber, so a re-run after a failed upload would fail on the existing asset');
    assert.match(r.uploads[0], new RegExp('^release upload ' + TAG + ' '), 'the upload is not to the tag\'s release');
    assert.deepEqual(r.uploaded(), [...ASSETS].sort(), 'what reached the release is not the asset list --list-assets prints');
    assert.deepEqual([...ASSETS].sort(), ['bundle.json', 'bundle.sig', 'bundle.tgz', 'install.sh'], 'the asset list changed — every printed download URL and both fetch scripts are built on these four names');
    const up = (n) => join(h.gh, 'uploaded', TAG, n);
    // the signature is over the very bytes uploaded, by the key the fleet's copy of release-pubkey.pem verifies
    const v = spawnSync('openssl', ['pkeyutl', '-verify', '-pubin', '-inkey', join(h.scratch, 'release.pub'), '-rawin', '-in', up('bundle.tgz'), '-sigfile', up('bundle.sig')]);
    assert.equal(v.status, 0, 'the uploaded bundle.sig does not verify over the uploaded bundle.tgz');
    const j = JSON.parse(readFileSync(up('bundle.json'), 'utf8'));
    assert.equal(j.tag, TAG); assert.equal(j.sha, h.sha, 'bundle.json names a commit other than the tag\'s');
    assert.equal(j.sha256, sha256(up('bundle.tgz')), 'bundle.json\'s sha256 is not the uploaded bundle\'s');
    assert.equal(j.builtAt, git(h.dir, ['show', '-s', '--format=%cI', h.sha]), 'bundle.json\'s builtAt is not the tagged commit\'s date, which is what version.txt carries and the panel compares');
    const atTag = git(h.dir, ['show', TAG + ':relay-app/install.sh']) + '\n';
    assert.equal(readFileSync(up('install.sh'), 'utf8'), atTag, 'the uploaded install.sh is not the tag\'s relay-app/install.sh');
    assert.doesNotMatch(readFileSync(up('install.sh'), 'utf8'), /WORKING-TREE-SENTINEL/, 'the uploaded install.sh is the working tree\'s, not the tag\'s — a release host on a WIP branch would ship the wrong installer');
    // and the bundle is the tag's tree, stamped as such
    const vt = execFileSync('tar', ['xzfO', up('bundle.tgz'), './version.txt'], { encoding: 'utf8' });
    assert.equal(vt.split('\n')[0].trim(), h.sha, 'the bundle\'s version.txt does not name the tagged commit');
    for (const a of ASSETS) assert.match(r.out, new RegExp('https://github\\.com/TrinityOneAdmin/TrinityOne/releases/download/' + TAG + '/' + a.replace('.', '\\.')), 'the script does not print the address of ' + a);
  } finally { h.stop(); }
});

test('an ANNOTATED tag on GitHub is followed to its commit before the two are compared', { skip: HAS_OPENSSL ? false : 'no openssl' }, () => {
  const h = releaseHost();
  try {
    h.releaseExists(); h.annotatedTag(TAG, h.sha);
    const r = h.run([TAG, '--dry']);
    assert.equal(r.status, 0, 'an annotated tag naming the same commit was refused:\n' + r.out.slice(-800));
    assert.match(r.log, /git\/tags\/abab/, 'the tag object was never dereferenced: ' + r.log);
    h.annotatedTag(TAG, 'c'.repeat(40));
    const bad = h.run([TAG, '--dry']);
    assert.notEqual(bad.status, 0, 'an annotated tag naming ANOTHER commit was accepted');
    assert.match(bad.out, /would disagree/, 'the refusal is not the disagreement sentence: ' + bad.out);
  } finally { h.stop(); }
});

test('gh\'s own complaint reaches the operator — "not logged in" is not reported as "no Release yet"', { skip: HAS_OPENSSL ? false : 'no openssl' }, () => {
  const h = releaseHost();
  try {
    const r = h.run([TAG]);   // no Release in the fake → gh says "release not found"
    assert.match(r.out, /gh said: release not found/, 'the die sentence does not carry what gh said: ' + r.out);
  } finally { h.stop(); }
});

test('--dry builds and checks everything and uploads nothing', { skip: HAS_OPENSSL ? false : 'no openssl' }, () => {
  const h = releaseHost();
  try {
    h.releaseExists(); h.remoteTag(TAG, h.sha);
    const r = h.run([TAG, '--dry']);
    assert.equal(r.status, 0, '--dry failed:\n' + r.out.slice(-800));
    assert.match(r.out, /signature verifies/, '--dry did not get as far as the signature check');
    assert.equal(r.uploads.length, 0, '--dry uploaded');
    assert.deepEqual(r.uploaded(), []);
  } finally { h.stop(); }
});
