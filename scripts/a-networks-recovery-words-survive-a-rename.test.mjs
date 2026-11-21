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

// B2a audit (2026-11-19): the name reader never checked WHO signed the kind-0. A relay serving another key's profile under this network's filter
// would have renamed it on screen -- and, through the self-heal, rewritten the saved name.
test('A KIND-0 SIGNED BY ANOTHER KEY never names the network, on screen or in the saved record (control: the network\'s own does); SABOTAGE lets it through', () => {
  const run = () => {
    const h = harness([sealedRecord('Old Name')]);
    const seen = [];
    h.api.Steward.subscribeNetworkProfile(NET, (p) => seen.push(p && p.name));
    const sub = h.subs.at(-1);
    sub.h.onevent({ kind: 0, pubkey: 'ef'.repeat(32), created_at: 2000, content: JSON.stringify({ name: 'Forged Name' }), tags: [] });
    return { seen, rec: h.raw()[0], h, sub };
  };
  const r = run();
  assert.deepEqual(r.seen, [], 'a profile signed by another key reached the screen');
  assert.equal(r.rec.name, 'Old Name', 'a profile signed by another key rewrote the saved network name');
  r.sub.h.onevent({ kind: 0, pubkey: NET, created_at: 2001, content: JSON.stringify({ name: 'Real Name' }), tags: [] });
  assert.deepEqual(r.seen, ['Real Name'], 'CONTROL: the network\'s own profile no longer names it');
  // SABOTAGE: the author check removed from the lifted method
  const guard = 'if (e.pubkey !== np) return;';
  assert.equal(SUBSCRIBE.split(guard).length, 2, 'sabotage anchor not unique in subscribeNetworkProfile');
  const store = new Map([[NETKEYS_LS, JSON.stringify([sealedRecord('Old Name')])]]), subs = [], seen = [];
  const world = { churchSk: CHURCH_SK, NETKEYS_LS, lsGet: (k) => (store.has(k) ? store.get(k) : null), lsSet: (k, v) => { store.set(k, v); },
    encrypt2: (m, k) => nip44.encrypt(m, k), decrypt3: (c, k) => nip44.decrypt(c, k), toPubHex: (x) => (/^[0-9a-f]{64}$/i.test(x) ? x.toLowerCase() : null),
    relays: () => ['wss://relay.example'], pool: { subscribeMany(urls, filters, h) { subs.push({ h }); return { close() {} }; } },
    window: { dispatchEvent() { return true; } }, CustomEvent: class { constructor(t) { this.type = t; } } };
  const names = Object.keys(world);
  const api = new Function(...names, `${LIFTED}\nconst Steward = { ${SUBSCRIBE.replace(guard, '')} };\nreturn { Steward };`)(...names.map(n => world[n]));
  api.Steward.subscribeNetworkProfile(NET, (p) => seen.push(p && p.name));
  subs.at(-1).h.onevent({ kind: 0, pubkey: 'ef'.repeat(32), created_at: 2000, content: JSON.stringify({ name: 'Forged Name' }), tags: [] });
  assert.deepEqual(seen, ['Forged Name'], 'THE SABOTAGE WAS NOT CAUGHT');
});

// B2a re-audit (2026-11-19): Steward.networkWords(pub) -- the NETWORK's recovery words for the network-view settings page. From the sealed network-key
// record only, only while the church key is unlocked, and NEVER the church's phrase (exportMnemonic).
const NETWORDS = once(VENDOR, 'networkWords(networkPub)');
function wordsHarness(records, { locked = false, body = NETWORDS } = {}) {
  const store = new Map([[NETKEYS_LS, JSON.stringify(records)]]);
  const world = { churchSk: locked ? null : CHURCH_SK, NETKEYS_LS, lsGet: (k) => (store.has(k) ? store.get(k) : null), lsSet: (k, v) => { store.set(k, v); },
    encrypt2: (m, k) => nip44.encrypt(m, k), decrypt3: (c, k) => nip44.decrypt(c, k), toPubHex: (x) => (/^[0-9a-f]{64}$/i.test(x) ? x.toLowerCase() : null) };
  const names = Object.keys(world);
  return new Function(...names, `${LIFTED}\nconst Steward = { exportMnemonic() { return 'church words are never these'; }, ${body} };\nreturn Steward;`)(...names.map(n => world[n]));
}
test('networkWords: the NETWORK\'s words from its sealed record -- not the church phrase; nothing while locked or for a network not held; SABOTAGE (exportMnemonic) goes red', () => {
  const S = wordsHarness([sealedRecord()]);
  assert.equal(S.networkWords(NET), WORDS, 'the network\'s own words were not returned');
  assert.notEqual(S.networkWords(NET), S.exportMnemonic(), 'networkWords returned the CHURCH phrase');
  assert.equal(wordsHarness([sealedRecord()], { locked: true }).networkWords(NET), '', 'words were handed out while the church key is locked');
  assert.equal(S.networkWords('cd'.repeat(32)), '', 'words were returned for a network this console does not hold');
  const sab = NETWORDS.replace(/networkWords\(networkPub\) \{[\s\S]*\}$/, 'networkWords(networkPub) { return this.exportMnemonic(); }');
  assert.notEqual(sab, NETWORDS, 'sabotage did not apply');
  assert.notEqual(wordsHarness([sealedRecord()], { body: sab }).networkWords(NET), WORDS, 'THE SABOTAGE WAS NOT CAUGHT');
});

// re-audit: the `if (!churchSk) return ''` guard, pinned. An UNMIGRATED record keeps its words in plain text, so without the guard a LOCKED console
// would still hand them out.
test('networkWords on a PLAINTEXT (unmigrated) record: nothing while the console is locked, the words while unlocked; SABOTAGE (guard deleted) leaks them while locked', () => {
  const plain = { pub: NET, name: 'Old Name', mnemonic: WORDS };
  assert.equal(wordsHarness([plain], { locked: true }).networkWords(NET), '', 'a LOCKED console handed out the network\'s words from a plaintext record');
  assert.equal(wordsHarness([plain]).networkWords(NET), WORDS, 'CONTROL: an unlocked console could not read a plaintext record');
  const guard = "if (!churchSk) return '';", sab = NETWORDS.replace(/if \(!churchSk\) return "";|if \(!churchSk\) return '';/, '');
  assert.notEqual(sab, NETWORDS, 'sabotage anchor (the locked guard) not found');
  assert.equal(wordsHarness([plain], { locked: true, body: sab }).networkWords(NET), WORDS, 'THE SABOTAGE WAS NOT CAUGHT');
});

// ── LOW#1 (integration audit 2026-11-21): A NETWORK'S WORDS ARE NEVER WRITTEN IN PLAIN TEXT ─────────────
// saveNetKey fell back to storing `mnemonic` as given when it could not seal (console locked, or the seal
// threw). Words that cannot be sealed are now not written at all, and the save answers false. Everything
// below runs saveNetKey — and the three API methods that hand it words — lifted from the SHIPPED bundle.
import { generateSeedWords, privateKeyFromSeedWords } from 'nostr-tools/nip06';
import { getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';

const CREATE = once(VENDOR, 'async createNetwork(name) {');
const RESTORE = once(VENDOR, 'async restoreNetwork(mnemonic) {');
const IMPORT = once(VENDOR, 'importNetworkKey(mnemonic, name) {');
const noPlainWords = (store, words, what) => {
  const all = [...store.values()].join('\n');
  assert.ok(!all.includes(words), what + ': the recovery words are in the store in plain text');
  for (const r of JSON.parse(store.get(NETKEYS_LS) || '[]')) assert.equal(r.mnemonic, undefined, what + ': a record carries a plain `mnemonic` field');
};
// One console with the real store functions and the three callers. `o.onJoin` runs inside joinNetwork (the
// awaited step in createNetwork); `o.probe` is the relay's answer to restoreNetwork; `o.encrypt` replaces the seal.
function console2(initial, o = {}) {
  const store = new Map([[NETKEYS_LS, JSON.stringify(initial)]]);
  const calls = { join: 0, probe: 0, events: [] };
  const win = { dispatchEvent(e) { calls.events.push(e.type); return true; } };
  const world = {
    churchSk: 'churchSk' in o ? o.churchSk : CHURCH_SK, churchPub: 'c'.repeat(64), NETKEYS_LS,
    lsGet: (k) => (store.has(k) ? store.get(k) : null),
    lsSet: (k, v) => { store.set(k, v); },
    encrypt2: o.encrypt || ((m, k) => nip44.encrypt(m, k)),
    decrypt3: (c, k) => nip44.decrypt(c, k),
    generateSeedWords, privateKeyFromSeedWords, getPublicKey, getPublicKey2: getPublicKey, getPublicKey3: getPublicKey,
    npubEncode, npubEncode2: npubEncode,
    NETWORK_SCOPES: ['announcements', 'events'], NETRING_MINT_LS: 'trinityone.netring.mint.',
    window: win, CustomEvent: class { constructor(type) { this.type = type; } },
  };
  const names = Object.keys(world);
  const body = `${LIFTED}
    const Steward = { ${CREATE}, ${RESTORE}, ${IMPORT} };
    return { netKeys, saveNetKey, Steward, setChurchSk: (k) => { churchSk = k; } };`;
  const api = new Function(...names, body)(...names.map(n => world[n]));
  win.Steward = {
    joinNetwork: async () => { calls.join++; if (o.onJoin) o.onJoin(api); return { ok: true }; },
    retryNetworkProfile: async () => ({ ok: true }),
    _networkKeyProbe: async () => { calls.probe++; if (o.onProbe) o.onProbe(api); return o.probe; },
  };
  return { store, calls, api, raw: () => JSON.parse(store.get(NETKEYS_LS)) };
}

test('LOW#1: a LOCKED console (churchSk null) handed new words writes NOTHING — and says so', () => {
  const c = console2([], { churchSk: null });
  assert.equal(c.api.saveNetKey({ pub: NET, name: 'N', mnemonic: WORDS }), false, 'a skipped save must answer false');
  assert.deepEqual(c.raw(), [], 'something was written for words that could not be sealed');
  noPlainWords(c.store, WORDS, 'locked');
});

test('LOW#1: a seal that THROWS writes nothing either — the old catch stored the words as given', () => {
  const c = console2([sealedRecord('Kept')], { encrypt: () => { throw new Error('seal failed'); } });
  const before = c.store.get(NETKEYS_LS);
  assert.equal(c.api.saveNetKey({ pub: 'cd'.repeat(32), name: 'N', mnemonic: WORDS }), false);
  assert.equal(c.store.get(NETKEYS_LS), before, 'a failed seal changed the store');
  noPlainWords(c.store, WORDS, 'seal threw');
});

test('LOW#1 CONTROL: the unlocked save is what it was — one record, sealed to the church key, answering true', () => {
  const c = console2([]);
  assert.equal(c.api.saveNetKey({ pub: NET, name: 'N', mnemonic: WORDS }), true);
  const recs = c.raw();
  assert.deepEqual(Object.keys(recs[0]).sort(), ['name', 'pub', 'sealedMnemonic'], 'the stored record changed shape');
  assert.equal(recs.length, 1);
  assert.equal(wordsOpen(recs[0], CHURCH_SK), WORDS);
  noPlainWords(c.store, WORDS, 'unlocked');
});

test('LOW#1: a record an OLDER build stored in plain text is not erased by a locked rename (it is left exactly as it was)', () => {
  const legacy = { pub: NET, name: 'Old Name', mnemonic: WORDS };
  const h = harness([legacy]);
  h.api.setChurchSk(null);
  rename(h, 'Renamed While Locked');
  assert.deepEqual(h.raw(), [legacy], 'a locked save rewrote or dropped a legacy record — its words are the only copy');
});

test('LOW#1: createNetwork on a console that LOCKS during the join still keeps the key — sealed, never plain', async () => {
  const c = console2([], { onJoin: (api) => api.setChurchSk(null) });   // lock() lands inside the awaited join
  const r = await c.api.Steward.createNetwork('Thames Churches');
  assert.equal(r.ok, true);
  assert.equal(c.calls.join, 1, 'control: the join ran, and the lock happened inside it');
  const recs = c.raw();
  assert.equal(recs.length, 1, 'the joined network’s key was not kept — the network is orphaned');
  assert.equal(recs[0].pub, r.networkPub);
  assert.equal(wordsOpen(recs[0], CHURCH_SK), r.mnemonic, 'the kept key does not open to the words the founder was shown');
  noPlainWords(c.store, r.mnemonic, 'locked mid-create');
});

test('LOW#1: createNetwork that cannot seal refuses BEFORE the join — nothing published, nothing stored', async () => {
  const c = console2([], { encrypt: () => { throw new Error('seal failed'); } });
  const r = await c.api.Steward.createNetwork('Thames Churches');
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'start');
  assert.equal(c.calls.join, 0, 'a network was joined whose key could never be kept');
  assert.deepEqual(c.raw(), []);
});

test('LOW#1 / slice3-F4: restoreNetwork on a locked console refuses before the relay is asked; locking DURING the check stores nothing', async () => {
  const words = generateSeedWords();
  const np = getPublicKey(privateKeyFromSeedWords(words));
  const yes = { network: true, checked: true, np, name: 'Thames Churches' };
  const locked = console2([], { churchSk: null, probe: yes });
  const r1 = await locked.api.Steward.restoreNetwork(words);
  assert.equal(r1.ok, false);
  assert.equal(r1.stage, 'locked');
  assert.equal(locked.calls.probe, 0, 'a locked console went to the relay with words it could not keep');
  assert.deepEqual(locked.raw(), []);
  const mid = console2([], { probe: yes, onProbe: (api) => api.setChurchSk(null) });
  const r2 = await mid.api.Steward.restoreNetwork(words);
  assert.equal(mid.calls.probe, 1);
  assert.equal(r2.ok, false, 'a restore whose words were not stored reported success');
  assert.equal(r2.stage, 'locked');
  assert.deepEqual(mid.raw(), []);
  assert.deepEqual(mid.calls.events, [], 'the switcher was told about a network that was not stored');
  noPlainWords(mid.store, words, 'locked mid-restore');
  // control: the same answer on an unlocked console is stored, sealed
  const open = console2([], { probe: yes });
  const r3 = await open.api.Steward.restoreNetwork(words);
  assert.equal(r3.ok, true);
  assert.equal(wordsOpen(open.raw()[0], CHURCH_SK), words);
});

test('LOW#1: importNetworkKey on a locked console throws and stores nothing (control: unlocked stores sealed)', () => {
  const words = generateSeedWords();
  const locked = console2([], { churchSk: null });
  assert.throws(() => locked.api.Steward.importNetworkKey(words, 'N'), /locked/);
  assert.deepEqual(locked.raw(), []);
  assert.deepEqual(locked.calls.events, []);
  const open = console2([]);
  open.api.Steward.importNetworkKey(words, 'N');
  assert.equal(wordsOpen(open.raw()[0], CHURCH_SK), words);
  noPlainWords(open.store, words, 'import');
});
