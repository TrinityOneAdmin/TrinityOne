// A NETWORK'S 12 RECOVERY WORDS SURVIVE A RENAME ARRIVING WHILE THE CONSOLE IS LOCKED.
// Run: node --test scripts/a-networks-recovery-words-survive-a-rename.test.mjs
//
// Audit 2026-09-30, finding 1. Sealing the words to the church key (S-1) rebuilt saveNetKey to write
// {pub, name} plus a freshly sealed copy of `rec.mnemonic` — and nothing else. netKeys() hands back the
// RAW record (sealedMnemonic set, no mnemonic) whenever it cannot open it: the console is locked, or a
// restore changed the church key. The rename self-heal inside subscribeNetworkProfile's onevent passes
// exactly that record to saveNetKey, so a kind-0 rename arriving from a relay erased the words for ever.
// No user action, nothing on screen, and they are the only way to publish as that network.
//
// HOW IT ASSERTS. _netKeysRaw, netKeys, saveNetKey and the Steward object's subscribeNetworkProfile are
// lifted out of the SHIPPED bundle (vendor/steward.js) into one scope, with real NIP-44 for the seal. The
// rename is delivered through the handler the bundle registers with pool.subscribeMany — the real path
// into the save, not a hand-made call to saveNetKey — and the words are then opened with the church key.
//
// Users of the network-keys store (rule 2): saveNetKey's callers are createNetwork, importNetworkKey and the
// subscribeNetworkProfile rename self-heal. netKeys' readers are skFor, ownedNetworks, identities (x2),
// setActiveIdentity, subscribeStewardedChurches and the self-heal. The raw store is also read or written by
// _migrateNetKeysToSealed and, in app/backup.jsx, by collectSteward (backup export), the restore merge and
// _undoStewardRestore; none of those goes through saveNetKey. (The S-1 commit named a
// "subscribeDelegatedChurches" caller; there is none. An earlier version of this header counted two
// setActiveIdentity readers; one of them is subscribeStewardedChurches — corrected after audit.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { fnBody } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const NETKEYS_LS = 'trinityone.steward.network-keys';
const NET = 'ab'.repeat(32);
const WORDS = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
const CHURCH_SK = new Uint8Array(32).fill(7);
const OTHER_SK = new Uint8Array(32).fill(9);

function once(src, anchor) {
  const at = src.indexOf(anchor);
  assert.notEqual(at, -1, `${anchor} is missing from vendor/steward.js — re-anchor this test`);
  assert.equal(src.indexOf(anchor, at + 1), -1, `${anchor} appears twice in vendor/steward.js — anchor is ambiguous`);
  return fnBody(src, at, anchor);
}

const LIFTED = [
  once(VENDOR, 'function _netKeysRaw()'),
  once(VENDOR, 'function netKeys()'),
  once(VENDOR, 'function saveNetKey(rec)'),
].join('\n');
const SUBSCRIBE = once(VENDOR, 'subscribeNetworkProfile(networkPub, onProfile)');

// One console: a localStorage, a church key cell, a pool that records the handlers it is given.
function harness(initial) {
  const store = new Map([[NETKEYS_LS, JSON.stringify(initial)]]);
  const subs = [];
  const events = [];
  const world = {
    churchSk: CHURCH_SK, NETKEYS_LS,
    lsGet: (k) => (store.has(k) ? store.get(k) : null),
    lsSet: (k, v) => { store.set(k, v); },
    encrypt2: (m, k) => nip44.encrypt(m, k),
    decrypt3: (c, k) => nip44.decrypt(c, k),
    toPubHex: (x) => (/^[0-9a-f]{64}$/i.test(x) ? x.toLowerCase() : null),
    relays: () => ['wss://relay.example'],
    pool: { subscribeMany(urls, filters, h) { subs.push({ urls, filters, h }); return { close() {} }; } },
    window: { dispatchEvent(e) { events.push(e.type); return true; } },
    CustomEvent: class { constructor(type) { this.type = type; } },
  };
  const names = Object.keys(world);
  // `churchSk` must be assignable from outside (lock() nulls it), so it lives on a shared cell.
  const body = `${LIFTED}
    const Steward = { ${SUBSCRIBE} };
    return { netKeys, saveNetKey, Steward, setChurchSk: (k) => { churchSk = k; } };`;
  const api = new Function(...names, body)(...names.map(n => world[n]));
  return { store, subs, events, api, raw: () => JSON.parse(store.get(NETKEYS_LS)) };
}

function sealedRecord(name = 'Old Name', key = CHURCH_SK) {
  return { pub: NET, name, sealedMnemonic: nip44.encrypt(WORDS, key) };
}

function rename(h, name, at = 1000) {
  h.api.Steward.subscribeNetworkProfile(NET, () => {});
  const sub = h.subs.at(-1);
  assert.deepEqual(sub.filters, [{ kinds: [0], authors: [NET] }], 'the lifted subscription is not the network-profile one');
  sub.h.onevent({ kind: 0, pubkey: NET, created_at: at, content: JSON.stringify({ name }), tags: [] });
}

function wordsOpen(rec, key) {
  assert.ok(rec.sealedMnemonic, 'the stored record has no sealed words at all — they were erased');
  return nip44.decrypt(rec.sealedMnemonic, key);
}

test('CONTROL: unlocked console — a rename keeps the words and updates the name', () => {
  const h = harness([sealedRecord()]);
  rename(h, 'New Name');
  const [rec] = h.raw();
  assert.equal(rec.name, 'New Name', 'the rename self-heal did not run — this test is not reaching the save');
  assert.equal(wordsOpen(rec, CHURCH_SK), WORDS);
  assert.equal(rec.mnemonic, undefined, 'the words were written in the clear');
  assert.ok(h.events.includes('steward-networks'));
});

test('LOCKED console (churchSk null) — a rename from the relay does not erase the words', () => {
  const h = harness([sealedRecord()]);
  h.api.setChurchSk(null);                       // what lock() does, while this subscription stays open
  rename(h, 'Renamed While Locked');
  const [rec] = h.raw();
  assert.equal(rec.name, 'Renamed While Locked', 'the rename self-heal did not run — this test is not reaching the save');
  assert.equal(rec.mnemonic, undefined, 'the words were written in the clear');
  // Unlock again: the words must still open with the church key.
  h.api.setChurchSk(CHURCH_SK);
  assert.equal(wordsOpen(rec, CHURCH_SK), WORDS, 'the words no longer open with the church key');
  const opened = h.api.netKeys().find(x => x.pub === NET);
  assert.equal(opened.mnemonic, WORDS, 'netKeys() cannot give the words back after unlock');
});

test('church key changed (a restore) — a rename keeps the sealed words as they were', () => {
  const h = harness([sealedRecord('Old Name', OTHER_SK)]);   // sealed under a key this console no longer holds
  const before = h.raw()[0].sealedMnemonic;
  rename(h, 'Renamed After Restore');
  const [rec] = h.raw();
  assert.equal(rec.name, 'Renamed After Restore', 'the rename self-heal did not run — this test is not reaching the save');
  assert.equal(rec.sealedMnemonic, before, 'the sealed words were changed or dropped');
  assert.equal(wordsOpen(rec, OTHER_SK), WORDS, 'the words no longer open with the key that sealed them');
});

test('a save handed only {pub, name} keeps the words already stored', () => {
  const h = harness([sealedRecord()]);
  h.api.saveNetKey({ pub: NET, name: 'Bare' });
  const [rec] = h.raw();
  assert.equal(rec.name, 'Bare');
  assert.equal(wordsOpen(rec, CHURCH_SK), WORDS);
});

test('new words handed to a save replace the old ones, sealed', () => {
  const h = harness([sealedRecord()]);
  const fresh = 'zoo zone zero youth young yellow year yard wrong write wrist wrestle';
  h.api.saveNetKey({ pub: NET, name: 'Fresh', mnemonic: fresh });
  const [rec] = h.raw();
  assert.equal(wordsOpen(rec, CHURCH_SK), fresh);
  assert.equal(rec.mnemonic, undefined);
});
