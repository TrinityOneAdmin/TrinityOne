// scripts/verify-suite-bundle.mjs accepts a correctly-signed bundle and rejects a flipped byte.
// Run: node --test scripts/verify-suite-bundle.test.mjs
//
// The verifier is the ONE implementation both the relay (pre-verify at stage time, suiteAutoUpdate) and the
// Rust app shell (authoritative verify before activating, P2) use. It must exit 0 only when the detached
// Ed25519 signature verifies over the EXACT tarball bytes against the pinned key, and non-zero otherwise.
// Executed as a subprocess (exactly as both callers invoke it) — not imported — so the real exit-code contract
// is what's under test. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFIER = join(HERE, 'verify-suite-bundle.mjs');

// A REAL Suite-shaped bundle: a gzipped tar with version.txt (sha + commit date), release-origin and
// scripts/gateway.mjs at its root, built with the system tar exactly as build-suite-js-bundle.sh does ("./" prefix).
const SHA = 'a'.repeat(40), DATE = '2026-10-01T12:00:00+01:00';
function makeTgz(dir, files) {
  const st = join(dir, 'st-' + Math.random().toString(36).slice(2));
  for (const [rel, body] of Object.entries(files)) { mkdirSync(dirname(join(st, rel)), { recursive: true }); writeFileSync(join(st, rel), body); }
  const out = join(dir, 'b-' + Math.random().toString(36).slice(2) + '.tgz');
  const r = spawnSync('tar', ['-czf', out, '-C', st, '.']);
  assert.equal(r.status, 0, 'tar failed');
  rmSync(st, { recursive: true, force: true });
  return readFileSync(out);
}
// A gateway stand-in carrying the step-1 data-folder guard statements the verifier requires (audit L-6).
const STEP1_GATEWAY = [
  "const DATA_DIR = process.env.TRINITY_DATA_DIR;",
  "const DATA_DIR_PINNED = /^(1|true)$/i.test(process.env.TRINITY_DATA_DIR_PINNED || '');",
  "const DATA_DIR_MOVED = join(DATA_DIR, 'MOVED-TO');",
  "function refuseDataDir() { process.exit(DATA_DIR_REFUSED); }",
  "if (!existsSync(DATA_DIR)) { if (DATA_DIR_PINNED) refuseDataDir('missing'); }",
  "if (existsSync(DATA_DIR_MOVED)) refuseDataDir('moved');",
  "",
].join('\n');
const SUITE_FILES = { 'version.txt': SHA + '\n' + DATE + '\n', 'release-origin': 'https://example.invalid\n', 'scripts/gateway.mjs': STEP1_GATEWAY };
function run(dir, files = SUITE_FILES) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const tgz = makeTgz(dir, files);
  const sig = cryptoSign(null, tgz, privateKey);
  const tgzPath = join(dir, 'bundle.tgz'), sigPath = join(dir, 'bundle.sig'), pemPath = join(dir, 'key.pem');
  writeFileSync(tgzPath, tgz);
  writeFileSync(sigPath, sig);
  writeFileSync(pemPath, publicKey.export({ type: 'spki', format: 'pem' }));
  return { tgzPath, sigPath, pemPath, tgz };
}
const verify = (...args) => spawnSync(process.execPath, [VERIFIER, ...args], { encoding: 'utf8' });

test('a correctly signed bundle verifies (exit 0)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-vsb-ok-'));
  try {
    const { tgzPath, sigPath, pemPath } = run(dir);
    const r = verify(tgzPath, sigPath, pemPath);
    assert.equal(r.status, 0, 'a good signature must exit 0; stderr: ' + r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { sha: SHA, date: DATE }, 'stdout must be the identity from the SIGNED version.txt');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a single flipped byte in the bundle is REJECTED (exit 1)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-vsb-bad-'));
  try {
    const { tgzPath, sigPath, pemPath, tgz } = run(dir);
    const tampered = Buffer.from(tgz); tampered[tampered.length >> 1] ^= 0x01;   // flip one bit of the first byte
    writeFileSync(tgzPath, tampered);
    const r = verify(tgzPath, sigPath, pemPath);
    assert.notEqual(r.status, 0, 'a tampered bundle MUST NOT verify');
    assert.equal(r.status, 1, 'a signature that does not verify should exit 1');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a signature from the WRONG key is rejected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-vsb-wrongkey-'));
  try {
    const { tgzPath, pemPath, tgz } = run(dir);
    const { privateKey: otherPriv } = generateKeyPairSync('ed25519');
    const sigPath = join(dir, 'other.sig');
    writeFileSync(sigPath, cryptoSign(null, tgz, otherPriv));   // same bytes, DIFFERENT key
    const r = verify(tgzPath, sigPath, pemPath);
    assert.notEqual(r.status, 0, 'a signature by an unknown key must be rejected');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('missing arguments is a non-zero (usage) exit', () => {
  const r = verify();
  assert.notEqual(r.status, 0, 'no args → usage error, non-zero');
});

// ── audit AUDIT-suite-autoupdate-be258b42 HIGH 2: the identity is read from INSIDE the signed bytes ──────────────

test('the reported sha/date are the ones in the signed version.txt — two bundles, two identities', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-vsb-id-'));
  try {
    const other = { ...SUITE_FILES, 'version.txt': 'b'.repeat(40) + '\n2026-11-02T00:00:00Z\n' };
    const { tgzPath, sigPath, pemPath } = run(dir, other);
    const r = verify(tgzPath, sigPath, pemPath);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { sha: 'b'.repeat(40), date: '2026-11-02T00:00:00Z' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a validly SIGNED bundle without release-origin (the server relay bundle shape) is refused (exit 7)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-vsb-kind-'));
  try {
    const server = { 'version.txt': SUITE_FILES['version.txt'], 'scripts/gateway.mjs': STEP1_GATEWAY };
    const { tgzPath, sigPath, pemPath } = run(dir, server);
    const r = verify(tgzPath, sigPath, pemPath);
    assert.equal(r.status, 7, 'a signed non-Suite bundle must be refused; stderr: ' + r.stderr);
    assert.equal(r.stdout, '', 'no identity is printed for a refused bundle');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a validly SIGNED bundle with no version.txt, or a malformed one, is refused (exit 7)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-vsb-ver-'));
  try {
    const noVer = { 'release-origin': 'x\n', 'scripts/gateway.mjs': '//\n' };
    let p = run(dir, noVer);
    assert.equal(verify(p.tgzPath, p.sigPath, p.pemPath).status, 7, 'no version.txt');
    const badSha = { ...SUITE_FILES, 'version.txt': '$Format:%H$\n$Format:%cI$\n' };
    p = run(dir, badSha);
    assert.equal(verify(p.tgzPath, p.sigPath, p.pemPath).status, 7, 'an unstamped version.txt');
    const badDate = { ...SUITE_FILES, 'version.txt': SHA + '\nnot a date\n' };
    p = run(dir, badDate);
    assert.equal(verify(p.tgzPath, p.sigPath, p.pemPath).status, 7, 'a version.txt with no date');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('[tar names] version.txt spelled twice under different-looking paths is refused, not guessed (exit 7)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-vsb-dup-'));
  try {
    // GNU tar keeps "./version.txt" and "./x/../version.txt"-free spellings; build the second spelling with
    // --transform so the archive holds BOTH "./version.txt" and ".//version.txt" (tar -x writes one file).
    const st = join(dir, 'st'); mkdirSync(join(st, 'scripts'), { recursive: true });
    writeFileSync(join(st, 'version.txt'), SHA + '\n' + DATE + '\n');
    writeFileSync(join(st, 'release-origin'), 'x\n'); writeFileSync(join(st, 'scripts', 'gateway.mjs'), '//\n');
    writeFileSync(join(st, 'other.txt'), 'b'.repeat(40) + '\n2026-11-02T00:00:00Z\n');
    const tarOut = join(dir, 'b.tgz');
    const r = spawnSync('tar', ['-czf', tarOut, '-C', st, './version.txt', './release-origin', './scripts/gateway.mjs',
      '--transform', 's|^\\./other\\.txt$|.//version.txt|', './other.txt']);
    assert.equal(r.status, 0, String(r.stderr));
    const listing = spawnSync('tar', ['-tzf', tarOut], { encoding: 'utf8' }).stdout;
    assert.match(listing, /^\.\/\/version\.txt$/m, 'fixture: the second spelling is in the archive');
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    writeFileSync(join(dir, 'k.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
    writeFileSync(join(dir, 'b.sig'), cryptoSign(null, readFileSync(tarOut), privateKey));
    const v = verify(tarOut, join(dir, 'b.sig'), join(dir, 'k.pem'));
    assert.equal(v.status, 7, 'an ambiguous version.txt must be refused; stdout=' + v.stdout + ' stderr=' + v.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('[kind] a signed bundle with no scripts/gateway.mjs is refused (exit 7)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-vsb-nogw-'));
  try {
    const p = run(dir, { 'version.txt': SUITE_FILES['version.txt'], 'release-origin': 'x\n' });
    assert.equal(verify(p.tgzPath, p.sigPath, p.pemPath).status, 7);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── audit L-6: the bundle's gateway.mjs must carry relay-storage step 1 ───────────────────────────────────
const REAL_GATEWAY = readFileSync(join(HERE, 'gateway.mjs'), 'utf8');
const runWithGateway = (gw) => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-vsb-step1-'));
  try { const p = run(dir, { ...SUITE_FILES, 'scripts/gateway.mjs': gw }); return verify(p.tgzPath, p.sigPath, p.pemPath); }
  finally { rmSync(dir, { recursive: true, force: true }); }
};

test('[step 1] the CURRENT tree\'s real scripts/gateway.mjs passes (exit 0)', () => {
  const r = runWithGateway(REAL_GATEWAY);
  assert.equal(r.status, 0, 'the shipped gateway must satisfy its own gate; stderr: ' + r.stderr);
});

test('[step 1] a gateway.mjs with the step-1 guard REMOVED is refused (exit 7) even though signed', () => {
  // The real file with every guard statement deleted, as an older build would simply not have them.
  const old = REAL_GATEWAY.split('\n')
    .filter((l) => !/TRINITY_DATA_DIR_PINNED|MOVED-TO|DATA_DIR_MOVED|DATA_DIR_REFUSED|refuseDataDir\(/.test(l.replace(/\/\/.*$/, ''))).join('\n');
  assert.ok(old.length < REAL_GATEWAY.length, 'fixture: lines were removed');
  const r = runWithGateway(old);
  assert.equal(r.status, 7, 'stderr: ' + r.stderr);
  assert.match(r.stderr, /data-folder protection/);
  assert.equal(r.stdout, '');
});

test('[step 1] a gateway.mjs that only MENTIONS the markers in comments is refused (exit 7)', () => {
  const comments = "// TRINITY_DATA_DIR_PINNED process.env.TRINITY_DATA_DIR_PINNED\n/* join(DATA_DIR, 'MOVED-TO')\n   existsSync(DATA_DIR_MOVED) if (DATA_DIR_PINNED) refuseDataDir( process.exit(DATA_DIR_REFUSED) */\n";
  assert.equal(runWithGateway(comments).status, 7, 'comment-only mention');
  assert.equal(runWithGateway(STEP1_GATEWAY.replace(/^(.*)$/gm, '// $1')).status, 7, 'a fully commented-out copy');
  assert.equal(runWithGateway(STEP1_GATEWAY).status, 0, 'control: the same statements uncommented pass');
});
