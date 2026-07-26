// Moving an account from an old phone to a new one. Drives the SHIPPED vendor/identity.js.
// Run: node --test scripts/identity-transfer.test.mjs
//
// This is the highest-consequence path in the app: it carries the 12 words, which ARE the account. If it
// leaks, someone becomes that member; if it silently half-works, a member loses their identity on the way to
// a new phone. So the round trip is executed for real against the shipped bundle — two independent
// "devices", each with its own storage — and the ways it must FAIL are asserted as hard as the happy path.
//
// Design under test: the direction is reversed on purpose. The NEW phone shows a throwaway PUBLIC key; the
// OLD phone encrypts the words to it (NIP-44). Neither screen ever shows the secret, so photographing a QR
// gets you a public key or a ciphertext. See src/identity.src.js beginTransfer/sealTransfer/acceptTransfer.
//
// The check code (AUDIT-2026-07-26 S5) is the other half of the story and gets its own tests below. It used to
// be four characters derived from the receiving PUBLIC KEY alone — 2^20, precomputable offline — so an attacker
// could hold up a pre-ground QR that displayed the member's own code back at them. It is now a short
// authentication string over the whole transcript, which is what the MITM tests here actually exercise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const BUNDLE = readFileSync(new URL('../vendor/identity.js', import.meta.url), 'utf8');

// One isolated "phone": its own localStorage, its own window, its own copy of the shipped bundle.
function phone() {
  const store = new Map();
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
    clear: () => store.clear(),
    key: i => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  const listeners = new Map();
  const win = {
    localStorage, crypto: webcrypto, TextEncoder, TextDecoder, console,
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    setTimeout, clearTimeout, setInterval, clearInterval,
    navigator: { userAgent: 'node' },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    addEventListener: (t, fn) => { listeners.set(t, [...(listeners.get(t) || []), fn]); },
    dispatchEvent: (e) => { for (const fn of listeners.get(e.type) || []) fn(e); return true; },
    document: { createElement: () => ({ setAttribute() {}, appendChild() {} }), head: { appendChild() {} } },
  };
  win.window = win; win.globalThis = win; win.self = win;
  const ctx = vm.createContext(win);
  vm.runInContext(BUNDLE, ctx, { filename: 'vendor/identity.js' });
  assert.ok(win.TrinityIdentity, 'the shipped bundle did not install window.TrinityIdentity');
  return win.TrinityIdentity;
}

const ready = async (id) => { try { await id.ready; } catch (e) {} return id; };
// the whole hand-off, as the two screens drive it
const handOver = async (oldPhone, newPhone) => {
  const sealed = await oldPhone.sealTransfer(newPhone.beginTransfer().qr);
  const seen = await newPhone.acceptTransfer(sealed.qr);
  assert.equal(seen.sas, sealed.code, 'the two phones disagreed on the check code in the honest case');
  await newPhone.confirmTransfer();
  return sealed;
};

test('the shipped bundle exposes the transfer API', async () => {
  const id = await ready(phone());
  for (const fn of ['beginTransfer', 'sealTransfer', 'acceptTransfer', 'confirmTransfer', 'endTransfer']) {
    assert.equal(typeof id[fn], 'function', `${fn} missing from the shipped identity bundle`);
  }
});

test('an account moves from the old phone to a new one, words intact', async () => {
  const oldPhone = await ready(phone());
  const newPhone = await ready(phone());

  const before = await oldPhone.exportMnemonic();
  assert.ok(before && before.split(/\s+/).length >= 12, 'the old phone should have a 12-word account');
  const oldNpub = (oldPhone.current || {}).npub;
  assert.ok(oldNpub, 'old phone has an identity');

  // the two phones must start as DIFFERENT people, or this test proves nothing
  assert.notEqual((newPhone.current || {}).npub, oldNpub, 'fresh phones must be different accounts');

  const invite = newPhone.beginTransfer();               // new phone shows this
  assert.match(invite.qr, /^trinityone:xfer:[0-9a-f]{64}$/, 'the new phone publishes only a PUBLIC key');
  const sealed = await oldPhone.sealTransfer(invite.qr); // old phone scans it, seals the words

  // the thing that travels must not contain the words
  assert.ok(!sealed.qr.includes(before), 'the mnemonic must never appear in the payload');
  for (const w of before.split(/\s+/)) assert.ok(!sealed.qr.includes(' ' + w + ' '), 'no plaintext words in the payload');

  const seen = await newPhone.acceptTransfer(sealed.qr);
  assert.equal(seen.sas, sealed.code, 'both phones must show the SAME check code, or the member cannot verify');
  assert.equal(seen.npub, oldNpub, 'the new phone must be told WHICH account it is about to become');
  await newPhone.confirmTransfer();
  assert.equal(await newPhone.exportMnemonic(), before, 'the new phone must end up with the SAME 12 words');
  assert.equal((newPhone.current || {}).npub, oldNpub, 'and therefore the same account');
});

test('the new phone can still show its 12 words afterwards (it is not a dead-end account)', async () => {
  const oldPhone = await ready(phone()), newPhone = await ready(phone());
  const words = await oldPhone.exportMnemonic();
  await handOver(oldPhone, newPhone);
  const back = await newPhone.exportMnemonic();
  assert.equal(back, words);
  assert.equal(back.split(/\s+/).length, 12, 'a transferred account must still be backup-able — this is why we carry the words, not the raw key');
});

// ── the check code ─────────────────────────────────────────────────────────────────────────────────────────
// Everything the member is asked to do rests on this string, so test what it must NOT be as hard as what it is.

test('the check code is not a function of the receiving key — it cannot be precomputed', async () => {
  const a = await ready(phone()), b = await ready(phone()), newPhone = await ready(phone());
  const invite = newPhone.beginTransfer();
  const s1 = await a.sealTransfer(invite.qr);
  const s2 = await b.sealTransfer(invite.qr);           // different old phone, SAME receiving key
  const s3 = await a.sealTransfer(invite.qr);           // same old phone, same receiving key, second go
  assert.notEqual(s1.code, s2.code, 'two different senders produced the same code — the code ignores the sender');
  assert.notEqual(s1.code, s3.code, 'the same sender produced the same code twice — the code ignores the ciphertext');
  // Under the old design all three were identical, because the code was sha256(receiving pubkey) — which is
  // exactly why it could be ground out offline and replayed back at the member.
});

test('the check code is long enough to be worth comparing', async () => {
  const oldPhone = await ready(phone()), newPhone = await ready(phone());
  const sealed = await oldPhone.sealTransfer(newPhone.beginTransfer().qr);
  const chars = sealed.code.replace(/\s+/g, '');
  assert.ok(chars.length >= 8, `check code is ${chars.length} characters — 4 characters over a 32-letter alphabet is 2^20 and grindable`);
  assert.match(chars, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]+$/, 'the code must avoid 0/O and 1/I — it gets read aloud');
});

test('a man in the middle makes the two phones show DIFFERENT codes', async () => {
  // The attack the check code exists to catch: a hostile member holds up their OWN transfer QR so the old
  // phone seals to them instead of to the member's new phone, then forwards the account on to keep it quiet.
  //
  // HONEST SCOPE, because this test passed against the BROKEN code too and I nearly left it looking like
  // coverage: it walks the attack end to end and proves the two screens disagree when the attacker uses a
  // key of their own choosing. It does NOT prove the code is unforgeable — the old 20-bit code also failed
  // this attack "loudly" unless the attacker had ground out a colliding key first, which is precisely what it
  // let them do. The strength claim rests on the two tests above it: the code depends on the sender and the
  // ciphertext (so there is nothing to grind before the exchange), and it is 40 bits rather than 20.
  const oldPhone = await ready(phone()), newPhone = await ready(phone()), attacker = await ready(phone());
  const mine = newPhone.beginTransfer();                     // what the member's new phone is really showing
  const evil = attacker.beginTransfer();                     // what the attacker holds up instead
  const tricked = await oldPhone.sealTransfer(evil.qr);      // the old phone scans the wrong screen
  const stolen = await attacker.acceptTransfer(tricked.qr);
  assert.equal(stolen.sas, tricked.code, 'sanity: the attacker and the old phone agree with each other');
  await attacker.confirmTransfer();                          // the attacker now holds the account
  // …and passes it along so the member's phone still works and nobody suspects anything.
  const forwarded = await attacker.sealTransfer(mine.qr);
  const seen = await newPhone.acceptTransfer(forwarded.qr);
  assert.notEqual(seen.sas, tricked.code,
    'the member compared the two screens and they MATCHED while a third phone held their account — the check code is forgeable');
});

test('accepting shows the code but does NOT adopt the account — only confirming does', async () => {
  const oldPhone = await ready(phone()), newPhone = await ready(phone());
  const mineBefore = (newPhone.current || {}).npub;
  const sealed = await oldPhone.sealTransfer(newPhone.beginTransfer().qr);
  const seen = await newPhone.acceptTransfer(sealed.qr);
  assert.ok(seen.sas, 'accept must hand back a code to compare');
  assert.equal((newPhone.current || {}).npub, mineBefore,
    'the account was adopted before the member had a chance to check the code — the check is then decoration');
  await newPhone.confirmTransfer();
  assert.equal((newPhone.current || {}).npub, (oldPhone.current || {}).npub);
});

test('a member who says the codes do NOT match keeps their own account', async () => {
  const oldPhone = await ready(phone()), newPhone = await ready(phone());
  const mineBefore = (newPhone.current || {}).npub;
  const sealed = await oldPhone.sealTransfer(newPhone.beginTransfer().qr);
  await newPhone.acceptTransfer(sealed.qr);
  newPhone.endTransfer();                                    // "no, they're different" → stop
  await assert.rejects(() => newPhone.confirmTransfer(), /Nothing to confirm/i,
    'declining must drop the held words, not merely hide the screen');
  assert.equal((newPhone.current || {}).npub, mineBefore, 'declining must leave the member as themselves');
});

// ── failure modes ──────────────────────────────────────────────────────────────────────────────────────────

test('a payload sealed to ANOTHER phone cannot be opened', async () => {
  const oldPhone = await ready(phone()), intended = await ready(phone()), eavesdropper = await ready(phone());
  const sealed = await oldPhone.sealTransfer(intended.beginTransfer().qr);
  eavesdropper.beginTransfer();   // has its own throwaway key
  await assert.rejects(() => eavesdropper.acceptTransfer(sealed.qr), /different phone/i,
    'a captured QR must be useless to any phone but the one it was sealed to');
});

test('a sealed payload cannot be replayed once it has been used', async () => {
  const oldPhone = await ready(phone()), newPhone = await ready(phone());
  const sealed = await handOver(oldPhone, newPhone);
  await assert.rejects(() => newPhone.acceptTransfer(sealed.qr), /Start the transfer/i,
    'the receiving key must be one-shot');
});

test('accepting without starting a transfer is refused', async () => {
  const oldPhone = await ready(phone()), newPhone = await ready(phone()), other = await ready(phone());
  const sealed = await oldPhone.sealTransfer(other.beginTransfer().qr);
  await assert.rejects(() => newPhone.acceptTransfer(sealed.qr), /Start the transfer/i);
});

test('rubbish input is refused with a readable message, not a crash', async () => {
  const oldPhone = await ready(phone()), newPhone = await ready(phone());
  newPhone.beginTransfer();
  for (const junk of ['', 'hello', '{}', '{"t":"trinityone/xfer"}', 'trinityone:xfer:nothex']) {
    await assert.rejects(() => newPhone.acceptTransfer(junk), /transfer/i, `accepted junk: ${junk}`);
  }
  for (const junk of ['', 'hello', 'trinityone:xfer:zzzz']) {
    await assert.rejects(() => oldPhone.sealTransfer(junk), /transfer code/i, `sealed to junk: ${junk}`);
  }
});

test('a payload that decrypts but carries no account is refused BEFORE anything is adopted', async () => {
  // A hostile sender who knows the receiving key can encrypt anything at all to it. The member must be told
  // it failed, not shown a check code for a payload we cannot actually use.
  const newPhone = await ready(phone()), attacker = await ready(phone());
  const mineBefore = (newPhone.current || {}).npub;
  const invite = newPhone.beginTransfer();
  const recv = invite.qr.replace('trinityone:xfer:', '');
  // build the payload by hand with the same primitives the app ships
  const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
  const { v2 } = await import('nostr-tools/nip44');
  const sk = generateSecretKey();
  const c = v2.encrypt('not a recovery phrase at all', v2.utils.getConversationKey(sk, recv));
  const payload = JSON.stringify({ v: 1, t: 'trinityone/xfer', s: getPublicKey(sk), c });
  await assert.rejects(() => newPhone.acceptTransfer(payload), /didn’t carry an account/i);
  assert.equal((newPhone.current || {}).npub, mineBefore, 'a junk payload must not disturb the member’s own account');
});

test('endTransfer discards the receiving key', async () => {
  const oldPhone = await ready(phone()), newPhone = await ready(phone());
  const sealed = await oldPhone.sealTransfer(newPhone.beginTransfer().qr);
  newPhone.endTransfer();
  await assert.rejects(() => newPhone.acceptTransfer(sealed.qr), /Start the transfer/i,
    'cancelling must actually drop the key, not just close the screen');
});

test('two transfers never reuse the same throwaway key', async () => {
  const newPhone = await ready(phone());
  const a = newPhone.beginTransfer(), b = newPhone.beginTransfer();
  assert.notEqual(a.qr, b.qr, 'each transfer must mint a fresh key');
});
