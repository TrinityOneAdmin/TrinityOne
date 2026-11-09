// THE PER-DEVICE SYNC CACHE MUST BE KEYED PER ACTIVE CHURCH.
// Run: node --test scripts/sync-cache-is-per-church.test.mjs
//
// e03fa8f3 remembers the last definite syncOn in localStorage so a flaky multi-relay read can't lose a known
// state. The audit (Finding 1) caught that a GLOBAL key contaminates churches: one browser represents its own
// church AND any it is a delegate for (window.Steward.actingChurch), so a global key would show church A's
// remembered "sync on" while viewing church B the moment B's live read is inconclusive — a confident WRONG
// state, the exact thing this fix exists to kill. This lifts the REAL cache helpers from app/stew-dashboard.jsx
// (module-scope, shipped) and proves they isolate per church. Sabotage: drop the per-church key and church B
// reads back church A's value → the isolation assertion fails.
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

test('one church never reads back another church\'s remembered sync state (per-church key)', async () => {
  const store = {};
  // Own church A remembers sync ON.
  let h = await loadHelpers({ actingChurch: '', churchPub: A }, store);
  h.writeSyncCache(true);
  assert.equal(h.readSyncCache(), true, 'A must read back its own ON');

  // Switch to delegated church B. Its live read is inconclusive, so the fallback reads the cache — which must
  // be EMPTY for B, not inherit A's ON.
  h = await loadHelpers({ actingChurch: B, churchPub: A }, store);
  assert.equal(h.readSyncCache(), null,
    'church B read back church A\'s cached sync state — the cache key is not per-church (audit Finding 1): a ' +
    'delegate console would show a confident wrong on/off for the church it is viewing');

  // B remembers OFF; that must not touch A.
  h.writeSyncCache(false);
  assert.equal(h.readSyncCache(), false, 'B must read back its own OFF');
  h = await loadHelpers({ actingChurch: '', churchPub: A }, store);
  assert.equal(h.readSyncCache(), true, 'back on A, its ON must be intact — B did not overwrite it');
});

test('the key actually varies by active church (fails if the church id is dropped)', async () => {
  const store = {};
  const a = (await loadHelpers({ actingChurch: '', churchPub: A }, store)).syncCacheKey();
  const b = (await loadHelpers({ actingChurch: B, churchPub: A }, store)).syncCacheKey();
  assert.notEqual(a, b, 'the cache key must differ between the own church and a delegated church');
  assert.ok(a.includes(A) && b.includes(B), 'the key must carry the active church id');
});
