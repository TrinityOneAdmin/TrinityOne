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
//       tampered or unsigned or wrongly-signed download BEFORE unpacking anything, and unpacks a good one —
//       from a GitHub release's flat assets (the default since 2026-09-21) and from a relay's /relay-app/;
//   §4  the REAL relay-update.sh, run the same way: it pulls from the code source in whichever shape it has,
//       fetches the installers from the app origin, and on a tampered bundle records "failed" and EXITS 1 with
//       nothing unpacked (AUDIT-suite-ABD-2026-09-21 finding 4: that exit was pinned by text only).
//
// The test's own Ed25519 key stands in for the release key in §2–§4 (the release secret is not in the
// repo and must never be); §1 is what ties the shipped script to the real key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const INSTALL = readFileSync(join(ROOT, 'relay-app', 'install.sh'), 'utf8');
const UPDATE = readFileSync(join(ROOT, 'scripts', 'relay-update.sh'), 'utf8');
const PEM = readFileSync(join(ROOT, 'relay-app', 'release-pubkey.pem'), 'utf8').trim();
const HAS_OPENSSL = spawnSync('openssl', ['version'], { encoding: 'utf8' }).status === 0;

function block(src, what, name) {
  const from = src.indexOf('# ── ' + name + ' ──');
  assert.notEqual(from, -1, 'the ' + name + ' block is gone from ' + what);
  const to = src.indexOf('# ── end ' + name + ' ──', from);
  assert.notEqual(to, -1, 'the ' + name + ' end-marker is gone from ' + what + ' — re-anchor this test');
  return src.slice(from, to);
}
const fnBlock = (src, what) => block(src, what, 'verify_release_bundle');
const baseBlock = (src, what) => block(src, what, 'release_bundle_base');
const sh = (script, env = {}) => spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, ...env } });

// ── §1 · one function, two copies; one key, pinned ───────────────────────────────────────────────────────

test('install.sh and relay-update.sh carry the SAME verify function, byte for byte', () => {
  const a = fnBlock(INSTALL, 'relay-app/install.sh'), b = fnBlock(UPDATE, 'scripts/relay-update.sh');
  assert.equal(a, b, 'the two copies of verify_release_bundle have drifted apart — the installer and the updater would accept different things');
  assert.match(a, /openssl pkeyutl -verify -pubin -inkey "\$pub" -rawin -in "\$tarball" -sigfile "\$sig"/, 'the function no longer runs the Ed25519 verify');
});

test('release_bundle_base: one rule, two copies byte-equal; a GitHub release is flat, a relay is /relay-app/', () => {
  const a = baseBlock(INSTALL, 'relay-app/install.sh'), b = baseBlock(UPDATE, 'scripts/relay-update.sh');
  assert.equal(a, b, 'the two copies of release_bundle_base have drifted apart — the installer and the updater would fetch from different places');
  const run = (src) => sh(a + '\nrelease_bundle_base ' + JSON.stringify(src)).stdout.trim();
  assert.equal(run('https://github.com/TrinityOneAdmin/TrinityOne/releases/latest/download'), 'https://github.com/TrinityOneAdmin/TrinityOne/releases/latest/download', 'a GitHub "latest" address is not flat');
  assert.equal(run('https://github.com/TrinityOneAdmin/TrinityOne/releases/latest/download/'), 'https://github.com/TrinityOneAdmin/TrinityOne/releases/latest/download', 'a trailing slash is not dropped');
  assert.equal(run('https://github.com/TrinityOneAdmin/TrinityOne/releases/download/relay-v0.9.0-rc1'), 'https://github.com/TrinityOneAdmin/TrinityOne/releases/download/relay-v0.9.0-rc1', 'a pinned-tag address is not flat');
  assert.equal(run('https://app.trinityone.church'), 'https://app.trinityone.church/relay-app', 'a relay address does not get /relay-app');
  assert.equal(run('http://192.168.1.20:8000/'), 'http://192.168.1.20:8000/relay-app', 'a LAN relay address does not get /relay-app');
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

// `layout`: 'relay' serves the files the way a TrinityOne relay does (http://local.test/relay-app/…);
// 'github' the way a GitHub release does (http://local.test/releases/latest/download/…, flat).
function runInstaller(d, files, { layout = 'relay', extra = [] } = {}) {
  const src = layout === 'github' ? 'http://local.test/releases/latest/download' : 'http://local.test';
  const served = join(d, 'srv', layout === 'github' ? 'releases/latest/download' : 'relay-app'); mkdirSync(served, { recursive: true });
  for (const [name, from] of Object.entries(files)) writeFileSync(join(served, name), readFileSync(from));
  const bin = stubs(d, join(d, 'srv'));
  const dir = join(d, 'opt'); mkdirSync(dir);
  try { rmSync(join(d, 'curl.log')); } catch {}
  const r = spawnSync('bash', [installWithTestKey(d), '--dir', dir, '--src', src, '--tunnel', 'none', '-y', ...extra],
    { encoding: 'utf8', env: { ...process.env, PATH: bin + ':' + process.env.PATH }, timeout: 60000 });
  let asked = []; try { asked = readFileSync(join(d, 'curl.log'), 'utf8').trim().split('\n'); } catch {}
  const file = (n) => { try { return readFileSync(join(dir, 'relay', n), 'utf8').trim(); } catch { return null; } };
  return { status: r.status, out: r.stdout + r.stderr, asked, unpacked: existsSync(join(dir, 'scripts', 'gateway.mjs')), dir, src, origin: file('origin'), codeSource: file('code-source') };
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

test('install.sh unpacks a GOOD download from a RELAY source, says it was signed, and that relay is both code source and origin', { skip: HAS_OPENSSL ? false : 'no openssl' }, () => {
  const d = fixture();
  try {
    const r = runInstaller(d, { 'bundle.tgz': join(d, 'bundle.tgz'), 'bundle.sig': join(d, 'bundle.sig') });
    assert.match(r.out, /signed by the TrinityOne release key/, 'a good download was not reported as signed: ' + r.out.slice(-600));
    assert.ok(r.asked.includes('http://local.test/relay-app/bundle.tgz') && r.asked.includes('http://local.test/relay-app/bundle.sig'), 'a relay source was not fetched under /relay-app/: ' + r.asked.join(', '));
    assert.equal(r.unpacked, true, 'a correctly signed download was NOT unpacked — the check refuses everything');
    assert.equal(readFileSync(join(r.dir, 'scripts', 'gateway.mjs'), 'utf8'), 'console.log("the genuine build")\n', 'what was unpacked is not the signed tree');
    assert.equal(r.codeSource, 'http://local.test', 'the installer did not record --src as the code source (relay/code-source)');
    assert.equal(r.origin, 'http://local.test', 'a relay named by --src is not also the app origin — before 2026-09-21 --src was both, and an explicit relay source must still behave that way');
    // it got as far as the first root-only write, which a non-root run cannot do — i.e. PAST the unpack
    assert.match(r.out, /Installing the boot service/, 'the script did not reach the systemd step after a good unpack');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('install.sh with a GITHUB RELEASE source fetches the assets flat, and keeps the app origin separate', { skip: HAS_OPENSSL ? false : 'no openssl' }, () => {
  const d = fixture();
  try {
    const r = runInstaller(d, { 'bundle.tgz': join(d, 'bundle.tgz'), 'bundle.sig': join(d, 'bundle.sig') }, { layout: 'github' });
    assert.ok(r.asked.includes('http://local.test/releases/latest/download/bundle.tgz'), 'the bundle was not fetched flat from the release: ' + r.asked.join(', '));
    assert.ok(r.asked.includes('http://local.test/releases/latest/download/bundle.sig'), 'the signature was not fetched flat from the release: ' + r.asked.join(', '));
    assert.ok(!r.asked.some((u) => /\/relay-app\/bundle/.test(u)), 'a GitHub source was fetched under /relay-app/, which a release does not have: ' + r.asked.join(', '));
    assert.match(r.out, /signed by the TrinityOne release key/, 'the flat download was not verified: ' + r.out.slice(-600));
    assert.equal(r.unpacked, true, 'a correctly signed release asset was not unpacked');
    assert.equal(r.codeSource, r.src, 'relay/code-source is not the release address');
    assert.equal(r.origin, 'https://app.trinityone.church', 'with a GitHub code source the app origin must default to the host the phones already check — a release carries no APKs');
    assert.match(r.out, /Installing the boot service/, 'the script did not reach the systemd step');
    // the run prints the fingerprint of the key it pinned (the test key here), so the operator sees the number
    // the guide and the header name — or does not, and stops
    const fp = createHash('sha256').update(readFileSync(join(d, 'release.pub'))).digest('hex');
    assert.match(r.out, new RegExp('release key sha256 ' + fp), 'the run does not print the pinned key\'s fingerprint');
  } finally { rmSync(d, { recursive: true, force: true }); }
  const d2 = fixture();
  try {
    const r = runInstaller(d2, { 'bundle.tgz': join(d2, 'bundle.tgz'), 'bundle.sig': join(d2, 'bundle.sig') }, { layout: 'github', extra: ['--origin', 'http://apps.test/'] });
    assert.equal(r.origin, 'http://apps.test', '--origin was not recorded as the app origin');
    assert.equal(r.codeSource, r.src, '--origin changed the code source');
  } finally { rmSync(d2, { recursive: true, force: true }); }
});

// ── §4 · THE REAL UPDATER, run ───────────────────────────────────────────────────────────────────────────
// scripts/relay-update.sh against an "installed" box in a scratch dir: the fixture's key is its
// release-pubkey.pem, its version.txt is dated before the bundle's, and curl maps <scheme>://<host>/<path>
// to a directory — so the code source, the app origin and the relay's own localhost answers are all files.
// systemctl / chown / npm are no-ops; HEALTH_TRIES=1 keeps the post-restart wait to one tick.
function runUpdater(d, { codeSource = null, origin = null, layout = 'github', bundle = 'bundle.tgz' } = {}) {
  const served = join(d, 'usrv'); mkdirSync(served, { recursive: true });
  const put = (rel, from) => { mkdirSync(join(served, rel, '..'), { recursive: true }); writeFileSync(join(served, rel), Buffer.isBuffer(from) || from.includes('\n') ? from : readFileSync(from)); };
  const at = layout === 'github' ? 'code.test/releases/latest/download' : 'code.test/relay-app';
  put(at + '/bundle.tgz', join(d, bundle)); put(at + '/bundle.sig', join(d, 'bundle.sig'));
  put('apps.test/trinityone.apk', Buffer.alloc(1_100_000, 0x61));
  put('localhost:8000/status', '{"ok":true,"version":"x"}\n'); put('localhost:8000/local-token', '{"token":"t"}\n'); put('localhost:8000/relay-addresses', 'loopbackOnly 1\n');
  const bin = join(d, 'ubin'); mkdirSync(bin, { recursive: true });
  for (const t of ['systemctl', 'chown', 'npm']) { writeFileSync(join(bin, t), '#!/bin/sh\necho "' + t + ' $*" >> ' + JSON.stringify(join(d, 'tools.log')) + '\nexit 0\n'); chmodSync(join(bin, t), 0o755); }
  writeFileSync(join(bin, 'curl'), [
    '#!/bin/sh', 'url=""; out=""',
    'while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; -H|-w|--max-time|-X|-d) shift 2;; -*) shift;; *) url="$1"; shift;; esac; done',
    'echo "$url" >> ' + JSON.stringify(join(d, 'ucurl.log')),
    'rel="${url#http://}"; rel="${rel#https://}"; f=' + JSON.stringify(served) + '"/$rel"',
    'if [ -f "$f" ]; then if [ -n "$out" ]; then cp "$f" "$out"; else cat "$f"; fi; exit 0; fi',
    'echo "curl: (22) 404" >&2; exit 22', '',
  ].join('\n')); chmodSync(join(bin, 'curl'), 0o755);
  const dir = join(d, 'installed'); mkdirSync(join(dir, 'scripts'), { recursive: true }); mkdirSync(join(dir, 'relay-app')); mkdirSync(join(dir, 'relay'));
  writeFileSync(join(dir, 'scripts', 'gateway.mjs'), 'console.log("the OLD build")\n');
  writeFileSync(join(dir, 'version.txt'), 'b'.repeat(40) + '\n2026-01-01T00:00:00+00:00\n');
  writeFileSync(join(dir, 'relay-app', 'release-pubkey.pem'), readFileSync(join(d, 'release.pub')));
  writeFileSync(join(dir, 'scripts', 'relay-update.sh'), UPDATE);
  if (origin !== null) writeFileSync(join(dir, 'relay', 'origin'), origin + '\n');
  if (codeSource !== null) writeFileSync(join(dir, 'relay', 'code-source'), codeSource + '\n');
  const r = spawnSync('bash', [join(dir, 'scripts', 'relay-update.sh')], { encoding: 'utf8', timeout: 90000,
    env: { ...process.env, PATH: bin + ':' + process.env.PATH, TRINITYONE_DIR: dir, TRINITYONE_PORT: '8000', HEALTH_TRIES: '1' } });
  const lines = (f) => { try { return readFileSync(join(d, f), 'utf8').trim().split('\n'); } catch { return []; } };
  let status = null; try { status = JSON.parse(readFileSync(join(dir, 'relay', 'update-status.json'), 'utf8')); } catch {}
  return { status: r.status, out: r.stdout + r.stderr, asked: lines('ucurl.log'), tools: lines('tools.log'), code: readFileSync(join(dir, 'scripts', 'gateway.mjs'), 'utf8'), state: status, dir };
}

test('relay-update.sh pulls the bundle FLAT from a GitHub-release code source, and the installers from the app origin', { skip: HAS_OPENSSL ? false : 'no openssl' }, () => {
  const d = fixture();
  try {
    const r = runUpdater(d, { codeSource: 'http://code.test/releases/latest/download', origin: 'http://apps.test' });
    assert.ok(r.asked.includes('http://code.test/releases/latest/download/bundle.tgz'), 'the bundle was not fetched flat from the release: ' + r.asked.join(', '));
    assert.ok(r.asked.includes('http://code.test/releases/latest/download/bundle.sig'), 'the signature was not fetched flat from the release');
    assert.ok(r.asked.includes('http://apps.test/trinityone.apk'), 'the installer was not fetched from the app origin: ' + r.asked.join(', '));
    assert.ok(!r.asked.some((u) => u.startsWith('http://code.test/') && !/\/releases\/latest\/download\/bundle\.(tgz|sig)$/.test(u)), 'something other than the two bundle files was asked of the code source: ' + r.asked.join(', '));
    assert.equal(r.code, 'console.log("the genuine build")\n', 'the new build was not unpacked over the old one:\n' + r.out.slice(-800));
    assert.ok(r.tools.some((l) => /^systemctl restart/.test(l)), 'the relay was not restarted after the unpack');
    assert.equal(r.status, 0, 'the update did not end healthy:\n' + r.out.slice(-800));
    assert.equal(r.state && r.state.state, 'ok', 'update-status.json does not record success: ' + JSON.stringify(r.state));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('with no code-source file the updater pulls from the origin\'s /relay-app/, as every box installed before it existed does', { skip: HAS_OPENSSL ? false : 'no openssl' }, () => {
  const d = fixture();
  try {
    const r = runUpdater(d, { origin: 'http://code.test', layout: 'relay' });
    assert.ok(r.asked.includes('http://code.test/relay-app/bundle.tgz') && r.asked.includes('http://code.test/relay-app/bundle.sig'), 'the origin was not asked under /relay-app/: ' + r.asked.join(', '));
    assert.equal(r.code, 'console.log("the genuine build")\n', 'the new build was not unpacked');
    assert.equal(r.status, 0, 'the update did not end healthy:\n' + r.out.slice(-800));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('a GitHub-release code source and NO origin: the code updates, no installer is asked for, the update is healthy', { skip: HAS_OPENSSL ? false : 'no openssl' }, () => {
  const d = fixture();
  try {
    const r = runUpdater(d, { codeSource: 'http://code.test/releases/latest/download' });
    assert.equal(r.code, 'console.log("the genuine build")\n', 'the new build was not unpacked:\n' + r.out.slice(-800));
    assert.ok(!r.asked.some((u) => /\.apk$/.test(u)), 'an installer was asked for although the box has no app origin: ' + r.asked.join(', '));
    assert.equal(r.status, 0, 'the update did not end healthy:\n' + r.out.slice(-800));
    assert.equal(r.state && r.state.state, 'ok', 'update-status.json does not record success: ' + JSON.stringify(r.state));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('relay-update.sh on a TAMPERED bundle: records "failed" with the sentence, exits 1, unpacks nothing, restarts nothing', { skip: HAS_OPENSSL ? false : 'no openssl' }, () => {
  const d = fixture();
  try {
    const r = runUpdater(d, { codeSource: 'http://code.test/releases/latest/download', origin: 'http://apps.test', bundle: 'tampered.tgz' });
    assert.equal(r.status, 1, 'a tampered bundle did not make the updater exit 1 — the audit found this exit pinned by text only, and a `true` in its place passed every test');
    assert.equal(r.code, 'console.log("the OLD build")\n', 'the tampered bundle was UNPACKED over the installed code');
    assert.ok(r.state && r.state.state === 'failed', 'update-status.json does not say failed: ' + JSON.stringify(r.state));
    assert.match(String(r.state.reason), /not signed by the TrinityOne release key/, 'the recorded reason is not the verify sentence the panel shows');
    assert.ok(!r.tools.some((l) => /^systemctl restart/.test(l)), 'the relay was restarted after a refused update');
    assert.ok(!r.asked.includes('http://apps.test/trinityone.apk'), 'the installers were fetched after the code was refused');
  } finally { rmSync(d, { recursive: true, force: true }); }
});
