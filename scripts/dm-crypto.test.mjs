// DM encryption invariants (deanon Finding 5, commit 9428b07).
//
// DMs send with NIP-44 and decrypt NIP-44-first-then-NIP-04, so a peer still on a pre-upgrade build stays
// readable through the transition. These are privacy invariants: a regression here either locks members out
// of their own messages or, worse, quietly weakens the encryption. Verified on-device 2026-07-19 (real
// relay round-trip on a Pixel 10 Pro); this file is the standing guard.
//
// Mirrors _dmEncrypt / _dmDecrypt in src/fellowship.src.js. If those change, change these together.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { encrypt as nip44e, decrypt as nip44d, getConversationKey as nip44ck } from 'nostr-tools/nip44';
import { encrypt as nip04e, decrypt as nip04d } from 'nostr-tools/nip04';

const _dmEncrypt = (sk, peerPub, text) => nip44e(text, nip44ck(sk, peerPub));
const _dmDecrypt = async (sk, peerPub, ct) => {
  try { return nip44d(ct, nip44ck(sk, peerPub)); } catch { return await nip04d(sk, peerPub, ct); }
};

const pair = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

test('NIP-44: a DM between two current builds round-trips', async () => {
  const a = pair(), b = pair();
  const ct = _dmEncrypt(a.sk, b.pub, 'grace and peace');
  assert.equal(await _dmDecrypt(b.sk, a.pub, ct), 'grace and peace');
});

test('DMs are sent with NIP-44 v2, not deprecated NIP-04', () => {
  const a = pair(), b = pair();
  const ct = _dmEncrypt(a.sk, b.pub, 'x');
  // NIP-44 payloads are base64 with a leading version byte of 0x02; NIP-04 carries a '?iv=' suffix.
  assert.equal(Buffer.from(ct, 'base64')[0], 2, 'expected a NIP-44 v2 version byte');
  assert.ok(!ct.includes('?iv='), 'looks like a NIP-04 payload');
});

test('backward compat: a NIP-04 DM from a pre-upgrade peer still opens', async () => {
  const a = pair(), b = pair();
  const ct = await nip04e(a.sk, b.pub, 'sent from an old build');
  assert.equal(await _dmDecrypt(b.sk, a.pub, ct), 'sent from an old build');
});

test('the sender can read back their own sent message', async () => {
  const a = pair(), b = pair();
  const ct = _dmEncrypt(a.sk, b.pub, 'my own words');
  assert.equal(await _dmDecrypt(a.sk, b.pub, ct), 'my own words');
});

test('garbage ciphertext throws — it never yields silent plaintext', async () => {
  const a = pair(), b = pair();
  await assert.rejects(() => _dmDecrypt(b.sk, a.pub, 'not-a-ciphertext'));
});

test('a third party holding the wrong key cannot decrypt', async () => {
  const a = pair(), b = pair(), c = pair();
  const ct = _dmEncrypt(a.sk, b.pub, 'for b only');
  await assert.rejects(() => _dmDecrypt(c.sk, a.pub, ct));
});
