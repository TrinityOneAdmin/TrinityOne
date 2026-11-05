// Seed-cache privacy + storage + backup safety — Findings 6/7/8 (2026-11-05).
// Run: node --test scripts/seed-storage-and-backup-privacy.test.mjs
//
// The Nov-2026 preload work writes a stack of on-disk seed caches so the console paints instantly. Three
// defects fell out of that, each pinned here by LIFTING and RUNNING the real shipped code (never a paraphrase):
//
//   #6  "Remove from this device" cleared the SEALED caches (children list / clearance / finance book) but
//       left the UNENCRYPTED ones — a plaintext list of who messages the church, who is admitted, who is
//       bringing meals — sitting on a handed-off / seized device.  (src/steward.src.js: removeKey, _seedSweep)
//   #7  Every seed write swallowed a QuotaExceededError silently, with no budget across the families, so a
//       full disk silently dropped OTHER writes — including the encrypted church-key marker, whose loss let
//       setPin() delete the plaintext seed believing the ciphertext had landed.  (lsSet, encBlobWrite)
//   #8  The steward backup swept in EVERY `trinityone.steward.*` key, so the multi-MB sealed finance book went
//       into the file and blew encryptObj's base64 step (String.fromCharCode spread) — the owner could not
//       save the file that carries their recovery key.  (app/backup.jsx: snapshot exclusion + chunked b64)
//
// The steward tests lift from the SHIPPED bundle (vendor/steward.js), so a source-only change that was never
// built fails here too — rebuild with: bash scripts/build-steward.sh
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { argon2idAsync } from '../node_modules/@noble/hashes/argon2.js';
import { fnBody, deps } from './test-slice.mjs';

const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

// The eleven UNENCRYPTED preload-seed prefixes, enumerated INDEPENDENTLY of the source so a regression that
// drops one from the sweep leaves the matching key behind and turns the assertion below red.
const SEED_PFX = [
  'trinityone.steward.dmconvos.', 'trinityone.steward.admitted.', 'trinityone.steward.joinpolicy.',
  'trinityone.steward.stewardreqs.', 'trinityone.steward.stats.', 'trinityone.steward.activity.',
  'trinityone.steward.versebanner.', 'trinityone.steward.care.needs.', 'trinityone.steward.care.slots.',
  'trinityone.steward.care.skips.', 'trinityone.steward.care.avail.',
];

function fakeLS(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    store: m,
    get length() { return m.size; },
    key: (i) => [...m.keys()][i],
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: (k) => m.delete(String(k)),
  };
}

// ─────────────────────────── #6 — the plaintext seeds leave with the key ───────────────────────────

function liftRemoveKey(ls) {
  const body = fnBody(BUNDLE, 'removeKey() {');
  const ctx = {
    localStorage: ls,
    KEY_LS: 'trinityone.steward.church-key',
    // the SEALED clears already worked; stub them so deps lifts ONLY the real _seedSweep (+ its prefix list)
    _minorsLastClear: () => {}, _sgClearClear: () => {}, _finBookClear: () => {},
    encBlobRemove: () => Promise.resolve(true),
    _stay: { clear: () => {} },
    window: { Steward: {}, dispatchEvent: () => {} },
    CustomEvent: function () {},
    sk: 'x', pub: 'x', currentMnemonic: 'x',
  };
  // deps() would otherwise re-lift the target from its own signature (and, for an async target, drop the
  // `async` keyword), so the function's own name is declared already-provided.
  const depsCode = deps(BUNDLE, body, Object.keys(ctx).concat(['removeKey']));
  const make = new Function(...Object.keys(ctx), depsCode + '\nfunction ' + body + '\n;return removeKey;');
  return make(...Object.values(ctx));
}

function liftSeedSweep(ls) {
  const body = fnBody(BUNDLE, '_seedSweep(keep)');
  const ctx = { localStorage: ls };
  const depsCode = deps(BUNDLE, body, Object.keys(ctx).concat(['_seedSweep']));
  const make = new Function(...Object.keys(ctx), depsCode + '\nfunction ' + body + '\n;return _seedSweep;');
  return make(...Object.values(ctx));
}

test('#6 removeKey wipes every UNENCRYPTED preload seed from the device', () => {
  const A = 'CHURCHAAAAAAAAAA';
  const ls = fakeLS();
  for (const p of SEED_PFX) ls.setItem(p + A, '["someone"]');
  ls.setItem('trinityone.steward.network-keys', '[{"pub":"x"}]');   // NOT a seed — must survive removeKey
  const removeKey = liftRemoveKey(ls);
  removeKey();
  for (const p of SEED_PFX) assert.equal(ls.getItem(p + A), null,
    p + A + ' survived "remove from this device" — a plaintext seed left on a handed-off console (Finding 6)');
  assert.equal(ls.getItem('trinityone.steward.network-keys'), '[{"pub":"x"}]',
    'removeKey evicted a non-seed key — the sweep is too broad');
});

test('#6 leaving a church keeps the ACTIVE church seeds and clears the rest (scoped sweep)', () => {
  const A = 'CHURCHAAAAAAAAAA', B = 'CHURCHBBBBBBBBBB';
  const ls = fakeLS();
  for (const p of SEED_PFX) { ls.setItem(p + A, '["a"]'); ls.setItem(p + B, '["b"]'); }
  const seedSweep = liftSeedSweep(ls);
  seedSweep(A);   // stay on A, drop everyone else
  for (const p of SEED_PFX) {
    assert.equal(ls.getItem(p + A), '["a"]', p + A + ' was wrongly cleared — the active church must keep its seeds');
    assert.equal(ls.getItem(p + B), null, p + B + ' survived — a departed church left a plaintext seed behind');
  }
});

// ─────────────────────────── #7 — a full disk no longer loses the write that matters ───────────────────────────

function liftLsSet(ls) {
  const body = fnBody(BUNDLE, 'lsSet(k, v)');
  const ctx = { localStorage: ls };
  const depsCode = deps(BUNDLE, body, Object.keys(ctx).concat(['lsSet']));
  const make = new Function(...Object.keys(ctx), depsCode + '\nfunction ' + body + '\n;return lsSet;');
  return make(...Object.values(ctx));
}

// a localStorage that refuses a write once a byte budget is exceeded — a real QuotaExceededError shape
function quotaLS(budget, seed = {}) {
  const m = new Map(Object.entries(seed));
  const size = () => { let n = 0; for (const [k, v] of m) n += k.length + String(v).length; return n; };
  return {
    store: m,
    get length() { return m.size; },
    key: (i) => [...m.keys()][i],
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      const prev = m.has(k) ? String(m.get(k)).length : 0;
      if (size() - prev + String(v).length > budget) { const e = new Error('full'); e.name = 'QuotaExceededError'; e.code = 22; throw e; }
      m.set(String(k), String(v));
    },
    removeItem: (k) => m.delete(String(k)),
  };
}

test('#7 a full disk evicts the DISPOSABLE seed caches and lets the real write through', () => {
  const big = 'x'.repeat(400);
  const ls = quotaLS(800, {   // the two seeds already overfill this, so ANY further write throws until one is evicted
    'trinityone.steward.financebook.CP': big,   // disposable, rebuilt from the relay
    'trinityone.steward.members.CP': big,        // disposable
  });
  const lsSet = liftLsSet(ls);
  lsSet('trinityone.steward.active-id', 'CP');   // the kind of write that was SILENTLY lost before the fix
  assert.equal(ls.getItem('trinityone.steward.active-id'), 'CP',
    'the active-church id was lost on a full disk — eviction did not run (Finding 7)');
  assert.equal(ls.getItem('trinityone.steward.financebook.CP'), null,
    'a disposable seed cache should have been evicted to make room');
});

test('#7 a NON-quota write error is still swallowed, and evicts nothing', () => {
  const m = new Map([['trinityone.steward.financebook.CP', 'KEEP']]);
  const ls = {
    get length() { return m.size; }, key: (i) => [...m.keys()][i],
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: () => { const e = new Error('blocked'); e.name = 'SecurityError'; throw e; },   // e.g. private mode
    removeItem: (k) => m.delete(k),
  };
  const lsSet = liftLsSet(ls);
  lsSet('trinityone.steward.active-id', 'CP');   // throws internally; swallowed, no retry, no eviction
  assert.equal(ls.getItem('trinityone.steward.financebook.CP'), 'KEEP',
    'a non-quota error must not trigger cache eviction — only a genuine full disk does');
});

function liftEncBlobWrite(ctxOverrides) {
  const body = fnBody(BUNDLE, 'encBlobWrite(str)');
  const ctx = {
    _isNative: () => false,
    _devWrap: { wrap: async () => null, unwrap: async () => null },   // no device-wrap → straight to the fallback
    ENC_LS: 'trinityone.steward.church-key.enc',
    console: { warn: () => {} },
    // native-branch plumbing, never reached when _isNative() is false, stubbed so deps does not lift the real stack
    _encIntent: { have: null }, ENC_PENDING_LS: 'pending', PENDING_WRITE: 'w',
    _secureStore: async () => ({ S: {} }), _encConverge: async () => {}, _encIsMarker: () => false,
    lsSet: () => {}, lsGet: () => null,
    ...ctxOverrides,
  };
  const depsCode = deps(BUNDLE, body, Object.keys(ctx).concat(['encBlobWrite']));
  const make = new Function(...Object.keys(ctx), depsCode + '\nasync function ' + body + '\n;return encBlobWrite;');
  return make(...Object.values(ctx));
}

test('#7 encBlobWrite returns FALSE when the fallback write does not land (so setPin keeps the plaintext key)', async () => {
  // simulate a full disk: lsSet is a no-op, so ENC_LS never actually holds the blob
  const enc = liftEncBlobWrite({ lsSet: () => {}, lsGet: () => null });
  const landed = await enc('THE-CHURCH-KEY-CIPHERTEXT');
  assert.equal(landed, false,
    'encBlobWrite reported success for a write that did not land — setPin would delete the plaintext key and lose the church (Finding 7)');
});

test('#7 encBlobWrite returns TRUE on the happy path (the blob really is in localStorage)', async () => {
  const store = new Map();
  const enc = liftEncBlobWrite({ lsSet: (k, v) => store.set(k, v), lsGet: (k) => (store.has(k) ? store.get(k) : null) });
  const landed = await enc('THE-CHURCH-KEY-CIPHERTEXT');
  assert.equal(landed, true, 'a blob that IS in localStorage must still report success — the happy path regressed');
  assert.equal(store.get('trinityone.steward.church-key.enc'), 'THE-CHURCH-KEY-CIPHERTEXT');
});

// ─────────────────────────── #8 — the backup excludes the seeds and no longer crashes ───────────────────────────

// drive the SHIPPED app/backup.jsx exactly as the phone runs it (the same loader the backup-file-safety test uses)
function loadBackup(seed = {}) {
  const SRC = readFileSync(new URL('../app/backup.jsx', import.meta.url), 'utf8');
  const store = new Map(Object.entries(seed));
  const localStorage = {
    get length() { return store.size; },
    key: (i) => [...store.keys()][i],
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: (k) => store.delete(String(k)),
  };
  const win = {
    TrinityRecovery: {
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
  assert.ok(api && api.collectSteward, 'app/backup.jsx no longer installs window.TrinityBackup — re-anchor this test');
  return { api, store };
}

test('#8 the steward backup EXCLUDES the disposable seed caches but keeps the real steward keys', () => {
  const CP = 'CHURCHCP';
  const { api } = loadBackup({
    // real steward state that MUST be in a backup
    'trinityone.steward.network-keys': '[{"pub":"x"}]',
    'trinityone.steward.active-id': CP,
    ['trinityone.steward.ownname.' + CP]: 'St Mary',
    // disposable seed caches that must NOT be in a backup (size + privacy)
    ['trinityone.steward.financebook.' + CP]: 'SEALED-3MB-BOOK',
    ['trinityone.steward.sgclear.' + CP]: 'SEALED-CLEARANCE',
    ['trinityone.steward.minorslast.' + CP]: 'SEALED-CHILDREN',
    ['trinityone.steward.dmconvos.' + CP]: '[{"peer":"a"}]',
    ['trinityone.steward.admitted.' + CP]: '["a","b"]',
    ['trinityone.steward.care.needs.' + CP]: '[{"id":"n"}]',
    ['trinityone.steward.care.slots.' + CP]: '[{"pubkey":"a"}]',
    ['trinityone.steward.members.' + CP]: '[{"pubkey":"a"}]',
    ['trinityone.steward.groups.v2.' + CP]: '[{"id":"g"}]',
    ['trinityone.steward.stats.' + CP]: '{"events":3}',
    ['trinityone.steward.activity.' + CP]: '[{"id":"e"}]',
  });
  const local = api.collectSteward().local;
  for (const keep of ['trinityone.steward.network-keys', 'trinityone.steward.active-id', 'trinityone.steward.ownname.' + CP])
    assert.ok(keep in local, keep + ' is missing from the steward backup — a restore would lose real console state');
  for (const gone of ['financebook', 'sgclear', 'minorslast', 'dmconvos', 'admitted', 'care.needs', 'care.slots', 'members', 'groups.v2', 'stats', 'activity'])
    assert.ok(!('trinityone.steward.' + gone + '.' + CP in local),
      'trinityone.steward.' + gone + '.' + CP + ' was swept into the backup — a sealed book or plaintext PII in a cloud-stored file (Finding 8)');
});

test('#8 encryptObj base64-encodes a MULTI-MB payload without a RangeError, and it round-trips', async () => {
  const { api } = loadBackup();
  // ~1 MB of content — the size the finance book used to add. The old `btoa(String.fromCharCode(...bytes))`
  // spread every byte as a call argument and threw "Maximum call stack size exceeded" before any file existed.
  const big = { kind: 'steward', churchKey: 'twelve words here', local: { book: 'B'.repeat(1_000_000) } };
  const GOOD = 'correct horse battery staple';
  let text;
  await assert.doesNotReject(async () => { text = await api.encryptObj(big, GOOD); },
    'encryptObj threw on a ~1 MB payload — the base64 step is not chunked (Finding 8)');
  const back = await api.decryptStr(text, GOOD);
  assert.equal(back.local.book.length, 1_000_000, 'the large payload did not round-trip through the chunked base64');
});
