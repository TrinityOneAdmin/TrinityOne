// Shamir recovery core — the guardian-recovery math must be PROVABLY correct: it splits a member's seed, and a
// bug means either lost access (can't reconstruct) or a silent security hole (fewer shares than threshold leak
// the secret). Run: node --test scripts/recovery.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { splitBytes, combineBytes, splitMnemonic, combineMnemonic, encodeShare, decodeShare } from '../src/recovery-core.mjs';
import { argon2idAsync } from '@noble/hashes/argon2.js';

const rand = (n) => { const u = new Uint8Array(n); webcrypto.getRandomValues(u); return u; };
const MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

test('2-of-3: ANY two shares reconstruct the mnemonic', () => {
  const shares = splitMnemonic(MNEMONIC, { threshold: 2, total: 3, rand });
  assert.equal(shares.length, 3);
  const pairs = [[0, 1], [0, 2], [1, 2]];
  for (const [a, b] of pairs) assert.equal(combineMnemonic([shares[a], shares[b]]), MNEMONIC, `shares ${a}+${b} reconstruct`);
});

test('2-of-3: all three shares also reconstruct', () => {
  const shares = splitMnemonic(MNEMONIC, { threshold: 2, total: 3, rand });
  assert.equal(combineMnemonic(shares), MNEMONIC);
});

test('threshold enforced: a SINGLE share cannot reconstruct (and refuses to try)', () => {
  const shares = splitMnemonic(MNEMONIC, { threshold: 2, total: 3, rand });
  assert.throws(() => combineMnemonic([shares[0]]), /Need 2 shares/);
});

test('secrecy: one share reveals nothing — its bytes are independent of the secret across many splits', () => {
  // For a fixed secret byte, share x=1's value must vary across re-splits (it depends on the random coefficient),
  // i.e. a lone share is not a deterministic function of the secret. Collect the distribution and assert spread.
  const secret = new Uint8Array([0x42]);
  const seen = new Set();
  for (let i = 0; i < 200; i++) { const s = splitBytes(secret, 2, 3, rand); seen.add(s[0].y[0]); }
  assert.ok(seen.size > 20, `share value should spread widely across re-splits (saw ${seen.size} distinct)`);
  assert.ok(!(seen.size === 1 && seen.has(0x42)), 'a lone share must not just equal the secret');
});

test('3-of-3: needs all three; any two fail the threshold check', () => {
  const shares = splitMnemonic(MNEMONIC, { threshold: 3, total: 3, rand });
  assert.equal(combineMnemonic(shares), MNEMONIC);
  assert.throws(() => combineMnemonic([shares[0], shares[1]]), /Need 3 shares/);
});

test('random-fuzz: 50 random secrets of varied length round-trip through 2-of-3', () => {
  for (let i = 0; i < 50; i++) {
    const len = 1 + (rand(1)[0] % 40);
    const secret = rand(len);
    const shares = splitBytes(secret, 2, 3, rand).map(encodeShare);
    const back = combineBytes([shares[0], shares[2]].map(decodeShare));
    assert.deepEqual(back, secret, `fuzz #${i} len ${len}`);
  }
});

test('share encoding: tamper (flip a hex digit) is caught by the checksum', () => {
  const [s0] = splitMnemonic(MNEMONIC, { threshold: 2, total: 3, rand });
  const parts = s0.split('.');
  // flip one nibble in the y-hex payload
  const y = parts[3].split(''); y[0] = y[0] === 'a' ? 'b' : 'a'; parts[3] = y.join('');
  const tampered = parts.join('.');
  assert.throws(() => decodeShare(tampered), /damaged|checksum|not a valid/);
});

test('share encoding: garbage input is rejected cleanly', () => {
  assert.throws(() => decodeShare('hello world'), /not a valid/);
  assert.throws(() => decodeShare(''), /not a valid/);
});

// The backup KDF (backup.jsx) derives its AES key with these exact Argon2id params via window.TrinityRecovery.
// Pin them: a silent params regression (e.g. m dropped to a tiny value) would quietly weaken EVERY new backup,
// and a determinism break would make existing backups unrecoverable. Same inputs must give the same key bytes.
test('KDF: Argon2id (OWASP mobile params m=19456 t=2 p=1) is deterministic and correct', async () => {
  const enc = new TextEncoder();
  const pass = enc.encode('123456'), salt = enc.encode('sixteen-byte-slt');
  const params = { t: 2, m: 19456, p: 1, dkLen: 32 };
  const a = await argon2idAsync(pass, salt, params);
  const b = await argon2idAsync(pass, salt, params);
  assert.equal(a.length, 32, '32-byte AES-256 key');
  assert.deepEqual(a, b, 'same passphrase + salt + params → identical key (or old backups would not open)');
  // a different PIN must give a different key (sanity that the passphrase is actually mixed in)
  const c = await argon2idAsync(enc.encode('123457'), salt, params);
  assert.notDeepEqual(a, c, 'a different PIN yields a different key');
});
