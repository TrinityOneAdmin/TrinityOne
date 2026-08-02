// THE ONE FILE THAT LEAVES THE SECURITY MODEL. Run: node --test scripts/backup-file-safety.test.mjs
//
// Everything else a member has lives on a relay their church controls — it can rotate keys, revoke a steward,
// wipe and restart. A backup file cannot be recalled. It goes into a personal cloud drive, a Downloads
// folder, a mail attachment, a shared family PC, and it stays there.
//
// And it is not a copy of someone's notes. It carries their TWELVE WORDS. Whoever opens it IS them: the seed
// unwraps the church's group keys from the relay, so one cracked file opens the congregation's private
// conversations, not just one member's journal. A member cannot consent to that on the church's behalf.
//
// Two defects this pins, both measured before the fix:
//   * the passphrase floor was stated three ways across three screens (6, 6 and 4 characters) and enforced by
//     NONE of them — encryptObj accepted "" and "a"
//   * restore wrote ANY localStorage key the file named, and the "this will replace your account" warning was
//     keyed on one field, so a crafted file omitted that field, wrote the seed through `local` instead, and
//     the member saw no warning at all
//
// This drives the SHIPPED app/backup.jsx in a browser-shaped scope, not a paraphrase of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { argon2idAsync } from '../node_modules/@noble/hashes/argon2.js';

const SRC = readFileSync(new URL('../app/backup.jsx', import.meta.url), 'utf8');

// app/backup.jsx is an IIFE that assigns window.TrinityBackup. Give it a window and a secure-context crypto
// and let it install itself — the same code the phone runs.
function loadBackup() {
  const store = new Map();
  const localStorage = {
    get length() { return store.size; },
    key: (i) => [...store.keys()][i],
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: (k) => { store.delete(String(k)); },
  };
  const win = {
    TrinityRecovery: {
      // the real memory-hard KDF the app uses, so the cost parameters under test are the real ones
      argon2Raw: async (pass, salt, params) => {
        const p = { t: (params && params.t) || 2, m: (params && params.m) || 19456, p: (params && params.p) || 1 };
        const raw = await argon2idAsync(new TextEncoder().encode(String(pass)), salt, { t: p.t, m: p.m, p: p.p, dkLen: 32 });
        return { raw, params: p };
      },
    },
  };
  const fn = new Function('window', 'localStorage', 'crypto', 'btoa', 'atob', 'TextEncoder', 'TextDecoder',
    'document', 'navigator', 'Blob', 'File', 'URL', 'FileReader', 'setTimeout', SRC + '\nreturn window.TrinityBackup;');
  const api = fn(win, localStorage, webcrypto,
    (b) => Buffer.from(b, 'binary').toString('base64'),
    (b) => Buffer.from(b, 'base64').toString('binary'),
    TextEncoder, TextDecoder, undefined, undefined, undefined, undefined, undefined, undefined, setTimeout);
  assert.ok(api && api.encryptObj, 'app/backup.jsx no longer installs window.TrinityBackup — re-anchor this test');
  return { api, store, localStorage };
}

const GOOD = 'correct horse battery staple';

test('a file holding the 12 words will not accept a short passphrase', async () => {
  const { api } = loadBackup();
  for (const bad of ['', 'a', '1234', '123456', 'hunter2']) {
    await assert.rejects(() => api.encryptObj({ hello: 'world' }, bad),
      (e) => /longer passphrase|all-numbers/i.test(e.message),
      `encryptObj sealed a file holding a member's twelve words behind ${JSON.stringify(bad)}. The floor has to `
      + 'live here — three screens stated it three different ways (6, 6 and 4) and none of them enforced it.');
  }
});

test('…and not a long string of digits either', async () => {
  // A PIN is the shape people reach for, and it is the shape an attacker's hardware likes most.
  const { api } = loadBackup();
  await assert.rejects(() => api.encryptObj({ hello: 'world' }, '1234567890123456'.slice(0, 14)),
    (e) => /all-numbers/i.test(e.message), 'a 14-digit PIN was accepted');
  await api.encryptObj({ hello: 'world' }, GOOD);   // four words: fine
});

test('the file still round-trips, and is unreadable without the passphrase', async () => {
  const { api } = loadBackup();
  const text = await api.encryptObj({ secret: 'the Nazari house', v: 1 }, GOOD);
  assert.equal(text.includes('Nazari'), false, 'the payload is in the clear inside the envelope');
  const back = await api.decryptStr(text, GOOD);
  assert.equal(back.secret, 'the Nazari house');
  await assert.rejects(() => api.decryptStr(text, GOOD + '!'), /Wrong passphrase/);
});

test('guessing costs meaningfully more than an interactive login', async () => {
  // The envelope records the parameters it was made with, so this reads what the shipped code actually chose.
  const { api } = loadBackup();
  const env = JSON.parse(await api.encryptObj({ a: 1 }, GOOD));
  assert.equal(env.kdf, 'argon2id', 'the memory-hard KDF is not being used: ' + env.kdf);
  assert.ok(env.m >= 65536,
    `the backup is sealed with only ${env.m} KiB of memory hardness. That is the interactive-login profile, `
    + 'tuned for a thin device answering a prompt — not for a file an attacker holds and can attack for ever.');
  assert.ok(env.t >= 3, 'too few passes: ' + env.t);
});

test('a crafted file cannot write the member’s identity, or anything else it likes', async () => {
  // THE ACCOUNT-TAKEOVER PATH. No `identity` field, so the UI's "this will replace your account" confirm
  // never fires — the seed goes in through `local` instead. Restoring through the export's own allowlist is
  // what closes it: after this, the identity can only change via the field the confirm actually guards.
  const { api, localStorage } = loadBackup();
  localStorage.setItem('trinityone.nostr.mnemonic', 'the members own real phrase');
  await api.applyMember({
    v: 1, app: 'trinityone', kind: 'member', local: {
      'trinityone.nostr.mnemonic': 'legal winner thank year wave sausage worth useful legal winner thank yellow',
      'trinityone.steward.church-key': 'an attacker church key',
      'trinityone.relays': '["wss://relay.the-ministry.example"]',
      'not even a trinityone key': 'x',
      'trinityone.mydata:data/notes': '[]',            // legitimate, and must still land
    },
  });
  assert.equal(localStorage.getItem('trinityone.nostr.mnemonic'), 'the members own real phrase',
    'a restore file replaced the member’s identity with one the file’s author holds the words to — and with no '
    + '`identity` field present, the UI never showed the "this replaces your account" warning');
  assert.equal(localStorage.getItem('trinityone.steward.church-key'), null, 'a member backup wrote a CHURCH key');
  assert.equal(localStorage.getItem('not even a trinityone key'), null, 'a member backup wrote an arbitrary key');
  assert.equal(localStorage.getItem('trinityone.mydata:data/notes'), '[]', 'the legitimate data did not restore');
});

test('a file that does not say what it is, is refused', async () => {
  const { api } = loadBackup();
  await assert.rejects(() => api.applyMember({ v: 1, local: { 'trinityone.relays': '[]' } }),
    /doesn’t say what it is/, 'a file with no `kind` was treated as a member backup — a missing field is not consent');
});

test('absurd KDF parameters in an untrusted file are clamped, not obeyed', async () => {
  // Unbounded, a crafted envelope asking for gigabytes kills the tab; a carefully-chosen figure just hangs a
  // cheap phone. Either way the member cannot open their own backup.
  const { api } = loadBackup();
  const env = JSON.parse(await api.encryptObj({ a: 1 }, GOOD));
  const hostile = JSON.stringify({ ...env, m: 4 * 1024 * 1024, t: 200 });
  await assert.rejects(() => api.decryptStr(hostile, GOOD), (e) => /Wrong passphrase|damaged/i.test(e.message),
    'a hostile envelope was allowed to choose its own memory cost — it should fail as a bad file, not exhaust '
    + 'the device');
});
