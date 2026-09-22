// THE INSTALLER CHECKS WHAT IT DOWNLOADS BEFORE IT UNPACKS IT AS ROOT.
// Run: node --test scripts/the-installer-checks-what-it-downloads.test.mjs
//
// THE FINDING (reference/BACKLOG.md, "THE ONE-LINE INSTALLER HAS NEVER VERIFIED WHAT IT DOWNLOADS", 2026-09-18).
// relay-app/install.sh did `curl bundle.tgz` then `tar -xzf` as root, and then installed a root-run systemd
// unit from what it had unpacked. It never fetched bundle.sig, never ran openssl, and the only key it could
// have checked against arrived INSIDE the tarball it was trusting. Reproduced by RUNNING the script at 3a8c980
// under PATH stubs (id → 0, apt-get/useradd/npm/systemctl/chown → no-ops, curl → a local directory) against a
// tarball nobody had signed and a server holding no signature at all:
//
//     curl was asked for:  /relay-app/bundle.tgz            (and nothing else)
//     printed:             ✓ code unpacked
//     $DIR/scripts/gateway.mjs afterwards:  console.log("EVIL")
//
// scripts/relay-update.sh already verified updates. The fix lifts that check into ONE shell function,
// verify_release_bundle, duplicated verbatim in both scripts (the installer is fetched on its own by curl and
// cannot source a file that arrives inside the tarball it is checking), and pins the release PUBLIC key inside
// install.sh — so the script a person reads before running it IS the trust root.
//
//   §1  the two copies are byte-equal, and the pinned key is the committed relay-app/release-pubkey.pem;
//   §2  the function, run in bash without root: a good signature passes; a tampered tarball, a missing
//       signature, a signature by another key, a missing key and a missing openssl each fail with a plain
//       sentence and touch nothing;
//   §3  the REAL install.sh, run under the same stubs as the reproduction: it asks for the signature, refuses a
//       tampered or unsigned or wrongly-signed download BEFORE unpacking anything, and unpacks a good one;
//   §4  relay-update.sh calls the function between the download and the unpack.
//
// The test's own Ed25519 key stands in for the release key in §2 and §3 (the release secret is not in the
// repo and must never be); §1 is what ties the shipped script to the real key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const INSTALL = readFileSync(join(ROOT, 'relay-app', 'install.sh'), 'utf8');
const UPDATE = readFileSync(join(ROOT, 'scripts', 'relay-update.sh'), 'utf8');
const PEM = readFileSync(join(ROOT, 'relay-app', 'release-pubkey.pem'), 'utf8').trim();
const HAS_OPENSSL = spawnSync('openssl', ['version'], { encoding: 'utf8' }).status === 0;

function fnBlock(src, what) {
  const from = src.indexOf('# ── verify_release_bundle ──');
  assert.notEqual(from, -1, 'the verify_release_bundle block is gone from ' + what);
  const to = src.indexOf('# ── end verify_release_bundle ──', from);
  assert.notEqual(to, -1, 'the verify_release_bundle end-marker is gone from ' + what + ' — re-anchor this test');
  return src.slice(from, to);
}
const sh = (script, env = {}) => spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, ...env } });

// ── §1 · one function, two copies; one key, pinned ───────────────────────────────────────────────────────

test('install.sh and relay-update.sh carry the SAME verify function, byte for byte', () => {
  const a = fnBlock(INSTALL, 'relay-app/install.sh'), b = fnBlock(UPDATE, 'scripts/relay-update.sh');
  assert.equal(a, b, 'the two copies of verify_release_bundle have drifted apart — the installer and the updater would accept different things');
  assert.match(a, /openssl pkeyutl -verify -pubin -inkey "\$pub" -rawin -in "\$tarball" -sigfile "\$sig"/, 'the function no longer runs the Ed25519 verify');
});

test('the key pinned in install.sh is the committed release public key', () => {
  const m = INSTALL.match(/^RELEASE_PUBKEY_PEM='([\s\S]*?)'$/m);
  assert.ok(m, 'install.sh no longer pins a release public key — the first download has nothing to be checked against that did not arrive in the download');
  assert.equal(m[1].trim(), PEM, 'the key pinned in install.sh is not relay-app/release-pubkey.pem');
  assert.match(PEM, /^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=]+\n-----END PUBLIC KEY-----$/, 'relay-app/release-pubkey.pem is not a single PEM public key');
});

// ── §2 · the function, run ───────────────────────────────────────────────────────────────────────────────

// A release host of our own: a key, a bundle, a signature over its exact bytes — and a second key.
function fixture() {
  const d = mkdtempSync(join(tmpdir(), 'trin-verify-'));
  const gen = (name) => {
    assert.equal(spawnSync('openssl', ['genpkey', '-algorithm', 'ed25519', '-out', join(d, name + '.key')]).status, 0, 'could not make an Ed25519 key');
    assert.equal(spawnSync('openssl', ['pkey', '-in', join(d, name + '.key'), '-pubout', '-out', join(d, name + '.pub')]).status, 0, 'could not derive the public key');
  };
  gen('release'); gen('other');
  mkdirSync(join(d, 'tree', 'scripts'), { recursive: true });
  mkdirSync(join(d, 'tree', 'relay-app'), { recursive: true });
  writeFileSync(join(d, 'tree', 'scripts', 'gateway.mjs'), 'console.log("the genuine build")\n');
  writeFileSync(join(d, 'tree', 'version.txt'), 'a'.repeat(40) + '\n2026-09-21T00:00:00+00:00\n');
  writeFileSync(join(d, 'tree', 'relay-app', 'release-pubkey.pem'), readFileSync(join(d, 'release.pub')));
  assert.equal(spawnSync('tar', ['-czf', join(d, 'bundle.tgz'), '-C', join(d, 'tree'), '.']).status, 0);
  const sign = (key, out) => assert.equal(spawnSync('openssl', ['pkeyutl', '-sign', '-inkey', join(d, key + '.key'), '-rawin', '-in', join(d, 'bundle.tgz'), '-out', join(d, out)]).status, 0, 'could not sign');
  sign('release', 'bundle.sig'); sign('other', 'other.sig');
  // a tarball whose bytes differ from the signed ones by one file
  mkdirSync(join(d, 'tree2', 'scripts'), { recursive: true });
  writeFileSync(join(d, 'tree2', 'scripts', 'gateway.mjs'), 'console.log("EVIL")\n');
  assert.equal(spawnSync('tar', ['-czf', join(d, 'tampered.tgz'), '-C', join(d, 'tree2'), '.']).status, 0);
  writeFileSync(join(d, 'empty.sig'), '');
  writeFileSync(join(d, 'empty.pub'), '');
  return d;
}

test('verify_release_bundle: a good signature passes; tampered, unsigned, wrong-key, keyless and no-openssl each refuse with a sentence', { skip: HAS_OPENSSL ? false : 'no openssl' }, () => {
  const d = fixture();
  try {
    const fn = fnBlock(INSTALL, 'relay-app/install.sh');
    const run = (args, env) => sh(fn + '\nverify_release_bundle ' + args.map((a) => JSON.stringify(a)).join(' '), env);
    const good = run([join(d, 'bundle.tgz'), join(d, 'bundle.sig'), join(d, 'release.pub')]);
    assert.equal(good.status, 0, 'a bundle signed by the release key was refused: ' + good.stderr);
    assert.equal(good.stderr.trim(), '', 'a good bundle produced a complaint');

    const cases = [
      ['tampered', [join(d, 'tampered.tgz'), join(d, 'bundle.sig'), join(d, 'release.pub')], /not signed by the TrinityOne release key/],
      ['missing signature', [join(d, 'bundle.tgz'), join(d, 'empty.sig'), join(d, 'release.pub')], /no signature/],
      ['signature by another key', [join(d, 'bundle.tgz'), join(d, 'other.sig'), join(d, 'release.pub')], /not signed by the TrinityOne release key/],
      ['no release key', [join(d, 'bundle.tgz'), join(d, 'bundle.sig'), join(d, 'empty.pub')], /no release key/],
      ['empty download', [join(d, 'empty.sig'), join(d, 'bundle.sig'), join(d, 'release.pub')], /package is empty/],
    ];
    for (const [name, args, re] of cases) {
      const r = run(args);
      assert.equal(r.status, 1, name + ': the function did not return 1');
      assert.match(r.stderr, re, name + ': the sentence does not say why: ' + JSON.stringify(r.stderr));
      assert.equal(r.stderr.trim().split('\n').length, 1, name + ': more than one line was printed — an operator gets one plain sentence');
    }
    // and with no openssl on PATH at all (bash by absolute path, an empty directory as PATH)
    const bin = join(d, 'nobin'); mkdirSync(bin);
    const r = spawnSync('/bin/bash', ['-c', fn + '\nverify_release_bundle ' + [join(d, 'bundle.tgz'), join(d, 'bundle.sig'), join(d, 'release.pub')].map((a) => JSON.stringify(a)).join(' ')],
      { encoding: 'utf8', env: { PATH: bin } });
    assert.equal(r.status, 1, 'with no openssl the function passed a bundle it could not check');
    assert.match(r.stderr, /openssl is missing/, 'the no-openssl refusal does not name the missing tool');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ── §3 · THE REAL SCRIPT, at the point of use ─────────────────────────────────────────────────────────────
// The same stubs the reproduction used. `curl` maps http://local.test/<path> to a directory; `id -u` says 0;
// the root-only tools are no-ops. The script still dies at the first write under /etc — as it must, for a
// non-root run — and by then the two facts this test reads are on disk: whether the signature was asked for,
// and whether anything was unpacked into $DIR.
function stubs(d, served) {
  const bin = join(d, 'bin'); mkdirSync(bin, { recursive: true });
  for (const t of ['apt-get', 'useradd', 'npm', 'systemctl', 'chown']) { writeFileSync(join(bin, t), '#!/bin/sh\nexit 0\n'); chmodSync(join(bin, t), 0o755); }
  writeFileSync(join(bin, 'id'), '#!/bin/sh\nif [ "$1" = "-u" ]; then echo 0; else exec /usr/bin/id "$@"; fi\n'); chmodSync(join(bin, 'id'), 0o755);
  writeFileSync(join(bin, 'curl'), [
    '#!/bin/sh', 'url=""; out=""',
    'while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; -*) shift;; *) url="$1"; shift;; esac; done',
    'echo "$url" >> ' + JSON.stringify(join(d, 'curl.log')),
    'rel="${url#http://local.test}"',
    'if [ -f ' + JSON.stringify(served) + '"$rel" ]; then cp ' + JSON.stringify(served) + '"$rel" "$out"; exit 0; fi',
    'echo "curl: (22) The requested URL returned error: 404" >&2; exit 22', '',
  ].join('\n')); chmodSync(join(bin, 'curl'), 0o755);
  return bin;
}

// install.sh with the test key pinned in place of the real one — the ONLY substitution, at the one anchor,
// asserted unique. §1 above is what ties the shipped file to the real key.
function installWithTestKey(d) {
  const pem = readFileSync(join(d, 'release.pub'), 'utf8').trim();
  const re = /^RELEASE_PUBKEY_PEM='[\s\S]*?'$/m;
  assert.equal((INSTALL.match(new RegExp(re.source, 'gm')) || []).length, 1, 'RELEASE_PUBKEY_PEM= is not exactly once in install.sh');
  const p = join(d, 'install.sh');
  writeFileSync(p, INSTALL.replace(re, "RELEASE_PUBKEY_PEM='" + pem + "'"));
  return p;
}

function runInstaller(d, files) {
  const served = join(d, 'srv', 'relay-app'); mkdirSync(served, { recursive: true });
  for (const [name, from] of Object.entries(files)) writeFileSync(join(served, name), readFileSync(from));
  const bin = stubs(d, join(d, 'srv'));
  const dir = join(d, 'opt'); mkdirSync(dir);
  try { rmSync(join(d, 'curl.log')); } catch {}
  const r = spawnSync('bash', [installWithTestKey(d), '--dir', dir, '--src', 'http://local.test', '--tunnel', 'none', '-y'],
    { encoding: 'utf8', env: { ...process.env, PATH: bin + ':' + process.env.PATH }, timeout: 60000 });
  let asked = []; try { asked = readFileSync(join(d, 'curl.log'), 'utf8').trim().split('\n'); } catch {}
  return { status: r.status, out: r.stdout + r.stderr, asked, unpacked: existsSync(join(dir, 'scripts', 'gateway.mjs')), dir };
}

test('install.sh asks for the signature and refuses a TAMPERED download before unpacking a byte', { skip: HAS_OPENSSL ? false : 'no openssl' }, () => {
  const d = fixture();
  try {
    const r = runInstaller(d, { 'bundle.tgz': join(d, 'tampered.tgz'), 'bundle.sig': join(d, 'bundle.sig') });
    assert.ok(r.asked.includes('http://local.test/relay-app/bundle.sig'), 'the installer never asked for bundle.sig — this is the finding, unchanged: ' + r.asked.join(', '));
    assert.equal(r.status, 1, 'the installer did not stop on a tampered download');
    assert.match(r.out, /not signed by the TrinityOne release key/, 'the refusal does not say why: ' + r.out.slice(-400));
    assert.equal(r.unpacked, false, 'the tampered download was UNPACKED into the install dir — as root, on a real box');
    assert.doesNotMatch(r.out, /code unpacked/, 'the installer claimed it unpacked code it refused');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('install.sh refuses a download that comes with NO signature', { skip: HAS_OPENSSL ? false : 'no openssl' }, () => {
  const d = fixture();
  try {
    const r = runInstaller(d, { 'bundle.tgz': join(d, 'bundle.tgz') });   // the server holds no bundle.sig
    assert.equal(r.status, 1, 'the installer went ahead without a signature');
    assert.match(r.out, /signature/, 'the refusal does not mention the missing signature');
    assert.match(r.out, /nothing was installed/, 'the refusal does not tell the operator nothing was installed');
    assert.equal(r.unpacked, false, 'an unsigned download was unpacked');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('install.sh refuses a download signed by a key that is not the pinned one', { skip: HAS_OPENSSL ? false : 'no openssl' }, () => {
  const d = fixture();
  try {
    const r = runInstaller(d, { 'bundle.tgz': join(d, 'bundle.tgz'), 'bundle.sig': join(d, 'other.sig') });
    assert.equal(r.status, 1, 'the installer accepted a signature from another key');
    assert.match(r.out, /not signed by the TrinityOne release key/, 'the refusal does not say the key was wrong');
    assert.equal(r.unpacked, false, 'a download signed by the wrong key was unpacked');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('install.sh unpacks a GOOD download, says it was signed, and records the source as the origin', { skip: HAS_OPENSSL ? false : 'no openssl' }, () => {
  const d = fixture();
  try {
    const r = runInstaller(d, { 'bundle.tgz': join(d, 'bundle.tgz'), 'bundle.sig': join(d, 'bundle.sig') });
    assert.match(r.out, /signed by the TrinityOne release key/, 'a good download was not reported as signed: ' + r.out.slice(-600));
    assert.equal(r.unpacked, true, 'a correctly signed download was NOT unpacked — the check refuses everything');
    assert.equal(readFileSync(join(r.dir, 'scripts', 'gateway.mjs'), 'utf8'), 'console.log("the genuine build")\n', 'what was unpacked is not the signed tree');
    assert.equal(readFileSync(join(r.dir, 'relay', 'origin'), 'utf8').trim(), 'http://local.test', 'the installer did not record --src as the update source');
    // it got as far as the first root-only write, which a non-root run cannot do — i.e. PAST the unpack
    assert.match(r.out, /Installing the boot service/, 'the script did not reach the systemd step after a good unpack');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ── §4 · the updater calls it between the download and the unpack ────────────────────────────────────────

test('relay-update.sh verifies the bundle with the shared function before it unpacks', () => {
  // comments stripped first, so a sentence in a comment cannot satisfy this
  const code = UPDATE.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const dl = code.indexOf('curl -fsSL "$ORIGIN/relay-app/bundle.tgz"');
  const call = code.indexOf('verify_release_bundle "$TARBALL" "$SIGFILE" "$PUBKEY"');
  const unpack = code.indexOf('tar -xzf "$TARBALL" -C "$DIR"');
  assert.ok(dl > -1 && call > -1 && unpack > -1, 'download, verify call or unpack is missing from relay-update.sh');
  assert.ok(dl < call && call < unpack, 'relay-update.sh does not verify between downloading and unpacking');
  assert.match(code.slice(call, unpack), /status failed "\$VERIFY_MSG"/, 'a refused update no longer records the reason in update-status.json, so the panel would show nothing');
});
