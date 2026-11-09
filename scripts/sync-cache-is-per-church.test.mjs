// THE PER-DEVICE SYNC CACHE MUST BE KEYED PER ACTIVE SIGNING IDENTITY.
// Run: node --test scripts/sync-cache-is-per-church.test.mjs
//
// e03fa8f3 remembers the last definite syncOn in localStorage so a flaky multi-relay read can't lose a known
// state. The first re-audit (Finding 1) caught that a GLOBAL key contaminates churches; e03fa8f3 keyed it per
// church. The FINAL audit (AUDIT-032b4fa2 Finding 1) caught that `actingChurch || churchPub` still diverges in
// NETWORK view: setActiveIdentity sets the active signer `pub` = the network key but leaves actingChurch='' and
// churchPub = the device's OWN church, so a network's remembered sync state would read back under the own church
// on an inconclusive read — the same confident-wrong cross-identity state this fix exists to kill, across the
// church/network boundary. The cache must key on `window.Steward.activePub`, the SAME `pub` backupState reads the
// gated doc under (`authors:[pub]`). This lifts the REAL cache helpers from app/stew-dashboard.jsx and proves
// they isolate per identity — own church, delegated church, AND owned network. Sabotage: drop activePub from the
// key (revert to actingChurch||churchPub) and the NETWORK case reads back the own church's value → test 3 fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

// Lift the cache-helper block: from `const SYNC_CACHE_KEY` up to (not including) `function useRelayBackupState`.
function liftCacheHelpers() {
  const start = DASH.indexOf('const SYNC_CACHE_KEY');
  assert.ok(start > 0, 're-anchor: `const SYNC_CACHE_KEY` not found in app/stew-dashboard.jsx');
  const end = DASH.indexOf('function useRelayBackupState', start);
  assert.ok(end > start, 're-anchor: `function useRelayBackupState` not found after the cache helpers');
  return DASH.slice(start, end);
}

// Compile the helpers with an injected window.Steward identity and a fake localStorage backed by `store`.
async function loadHelpers(steward, store) {
  const tmp = join(tmpdir(), 'synccache-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.js');
  let js;
  try {
    writeFileSync(tmp, liftCacheHelpers() + '\nexport { readSyncCache, writeSyncCache, syncCacheKey };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__sc_' + Math.random().toString(36).slice(2);
  globalThis[key] = {
    window: { Steward: steward },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
  };
  const pre = `const window = globalThis.${key}.window;\nconst localStorage = globalThis.${key}.localStorage;\n`;
  return await import('data:text/javascript;base64,' + Buffer.from(pre + js).toString('base64'));
}

const A = 'a'.repeat(64);   // the device's own church
const B = 'b'.repeat(64);   // a church this console is a delegate for
const N = 'e'.repeat(64);   // an owned NETWORK this console views (activePub = network key, churchPub stays A)

// The three identity shapes setActiveIdentity produces (steward.src.js:9285-9288, 14332-14336, :14439):
const ownA = { activePub: A, actingChurch: '', churchPub: A };     // own church:   pub = own,     actingChurch=''
const delegB = { activePub: B, actingChurch: B, churchPub: A };    // delegate:     pub = church,  actingChurch=church
const netN = { activePub: N, actingChurch: '', churchPub: A };     // network view: pub = network, actingChurch='' , churchPub=own

test('one church never reads back another church\'s remembered sync state (per-identity key)', async () => {
  const store = {};
  // Own church A remembers sync ON.
  let h = await loadHelpers(ownA, store);
  h.writeSyncCache(true);
  assert.equal(h.readSyncCache(), true, 'A must read back its own ON');

  // Switch to delegated church B. Its live read is inconclusive, so the fallback reads the cache — which must
  // be EMPTY for B, not inherit A's ON.
  h = await loadHelpers(delegB, store);
  assert.equal(h.readSyncCache(), null,
    'church B read back church A\'s cached sync state — the cache key is not per-identity: a delegate console ' +
    'would show a confident wrong on/off for the church it is viewing');

  // B remembers OFF; that must not touch A.
  h.writeSyncCache(false);
  assert.equal(h.readSyncCache(), false, 'B must read back its own OFF');
  h = await loadHelpers(ownA, store);
  assert.equal(h.readSyncCache(), true, 'back on A, its ON must be intact — B did not overwrite it');
});

test('a NETWORK view never reads back the OWN church\'s remembered sync state (AUDIT-032b4fa2 finding 1)', async () => {
  const store = {};
  // Own church A remembers sync ON.
  let h = await loadHelpers(ownA, store);
  h.writeSyncCache(true);
  assert.equal(h.readSyncCache(), true, 'A must read back its own ON');

  // View an owned NETWORK: setActiveIdentity sets the signer pub = the network key, actingChurch='', but leaves
  // churchPub = the own church A. backupState now reads the NETWORK's trinityone/relays doc. The OLD key
  // (actingChurch || churchPub) collapses to churchPub = A and would read back A's ON for the network — the leak.
  h = await loadHelpers(netN, store);
  assert.equal(h.readSyncCache(), null,
    'the network view read back the OWN church\'s cached sync state — the key collapses a network onto churchPub ' +
    '(finding 1): backupState reads the network\'s doc but the cache is stamped under the own church');

  // The network's own OFF must not touch A.
  h.writeSyncCache(false);
  assert.equal(h.readSyncCache(), false, 'the network must read back its own OFF');
  h = await loadHelpers(ownA, store);
  assert.equal(h.readSyncCache(), true, 'back on the own church, its ON must be intact — the network did not overwrite it');
});

test('the key varies by active identity, including a network (fails if the signer pub is dropped)', async () => {
  const store = {};
  const a = (await loadHelpers(ownA, store)).syncCacheKey();
  const b = (await loadHelpers(delegB, store)).syncCacheKey();
  const n = (await loadHelpers(netN, store)).syncCacheKey();
  assert.notEqual(a, b, 'the cache key must differ between the own church and a delegated church');
  assert.notEqual(a, n, 'the cache key must differ between the own church and an owned network it is viewing');
  assert.ok(a.includes(A) && b.includes(B) && n.includes(N), 'the key must carry the ACTIVE signer id, not the own-church fallback');
});
