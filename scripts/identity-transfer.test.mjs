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

test('the shipped bundle exposes the transfer API', async () => {
  const id = await ready(phone());
  for (const fn of ['beginTransfer', 'sealTransfer', 'acceptTransfer', 'endTransfer']) {
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
  assert.equal(sealed.code, invite.code, 'both phones must show the SAME check code, or the member cannot verify');

  // the thing that travels must not contain the words
  assert.ok(!sealed.qr.includes(before), 'the mnemonic must never appear in the payload');
  for (const w of before.split(/\s+/)) assert.ok(!sealed.qr.includes(' ' + w + ' '), 'no plaintext words in the payload');

  await newPhone.acceptTransfer(sealed.qr);
  assert.equal(await newPhone.exportMnemonic(), before, 'the new phone must end up with the SAME 12 words');
  assert.equal((newPhone.current || {}).npub, oldNpub, 'and therefore the same account');
});

test('the new phone can still show its 12 words afterwards (it is not a dead-end account)', async () => {
  const oldPhone = await ready(phone()), newPhone = await ready(phone());
  const words = await oldPhone.exportMnemonic();
  await newPhone.acceptTransfer((await oldPhone.sealTransfer(newPhone.beginTransfer().qr)).qr);
  const back = await newPhone.exportMnemonic();
  assert.equal(back, words);
  assert.equal(back.split(/\s+/).length, 12, 'a transferred account must still be backup-able — this is why we carry the words, not the raw key');
});

test('a payload sealed to ANOTHER phone cannot be opened', async () => {
  const oldPhone = await ready(phone()), intended = await ready(phone()), eavesdropper = await ready(phone());
  const sealed = await oldPhone.sealTransfer(intended.beginTransfer().qr);
  eavesdropper.beginTransfer();   // has its own throwaway key
  await assert.rejects(() => eavesdropper.acceptTransfer(sealed.qr), /different phone/i,
    'a captured QR must be useless to any phone but the one it was sealed to');
});

test('a sealed payload cannot be replayed into a second phone', async () => {
  const oldPhone = await ready(phone()), newPhone = await ready(phone());
  const sealed = await oldPhone.sealTransfer(newPhone.beginTransfer().qr);
  await newPhone.acceptTransfer(sealed.qr);
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
  assert.notEqual(a.code, b.code, 'and therefore a fresh check code');
});
