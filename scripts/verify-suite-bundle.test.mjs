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
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFIER = join(HERE, 'verify-suite-bundle.mjs');

function run(dir) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const tgz = Buffer.from('this stands in for a real gzipped tarball of the JS layer; signature is over these exact bytes');
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
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a single flipped byte in the bundle is REJECTED (exit 1)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-vsb-bad-'));
  try {
    const { tgzPath, sigPath, pemPath, tgz } = run(dir);
    const tampered = Buffer.from(tgz); tampered[0] ^= 0x01;   // flip one bit of the first byte
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
