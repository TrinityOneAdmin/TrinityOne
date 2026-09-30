// A transient NIP-11 probe timeout must not strand a self-hosted member for the rest of the session.
// Run: node --test scripts/relay-info-cache-clears-on-null.test.mjs
//
// M-7c. `_relayInfo` caches its promise, including when it resolves null. The #3 recovery re-drive in
// `subscribeChurchRelays` re-reads the cache on every churn, so a cached null means "never probe again
// this session". The fix clears null entries after the promise resolves, so the next churn retries.
//
// This drives the SHIPPED bundle (CLAUDE.md rule 1): the function is lifted out of vendor/fellowship.js
// and executed, so the test fails if the fix is deleted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stmt } from './test-slice.mjs';

const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

// Lift _relayInfoCache and _relayInfo from the shipped bundle.
function liftRelayInfo() {
  const cache = new Map();
  let fetchResult = null;     // what the next fetch returns: {trinityone:{enforces:true}} or null
  let fetchReached = false;   // did the lifted code actually call fetch?
  let fetchCount = 0;

  const stubFetch = async (url, opts) => {
    fetchReached = true;
    fetchCount++;
    if (fetchResult === 'timeout') throw new Error('relay-info timeout');
    if (fetchResult === null) return { ok: false };
    return { ok: true, json: async () => fetchResult };
  };

  // Build the lifted code. We inject our stub fetch and cache, and wrap _relayInfo to use them.
  const infoBody = fnBody(BUNDLE, 'function _relayInfo(wssUrl)', '_relayInfo');

  const fn = new Function('_relayInfoCache', 'fetch', 'setTimeout', 'clearTimeout', 'Promise',
    'AbortController', 'Error', 'String', 'console',
    infoBody + '\nreturn _relayInfo;'
  )(cache, stubFetch, setTimeout, clearTimeout, Promise,
    typeof AbortController !== 'undefined' ? AbortController : class { constructor() { this.signal = {}; } abort() {} },
    Error, String, console);

  return {
    probe: (url) => fn(url),
    cache,
    setResult: (r) => { fetchResult = r; },
    get reached() { return fetchReached; },
    get count() { return fetchCount; },
    resetReached: () => { fetchReached = false; },
  };
}

test('a null probe result is cleared from the cache so the next churn retries', async () => {
  const ri = liftRelayInfo();
  ri.setResult(null);   // the relay is unreachable

  // First probe: should cache the promise, then clear it when it resolves null.
  const p1 = ri.probe('wss://mybox.example.com');
  const v1 = await p1;
  assert.equal(v1, null, 'expected null for an unreachable relay');
  assert.ok(ri.reached, 'fetch was never called — the lifted code is not running');

  // Wait a tick for the .then(v => { if (!v) delete }) to run.
  await new Promise(r => setTimeout(r, 10));

  assert.ok(!ri.cache.has('wss://mybox.example.com'),
    'THE CACHE STILL HOLDS THE NULL ENTRY — a self-hosted member is stranded for the rest of the ' +
    'session because the #3 recovery re-read the cached null and never probes again. Cache keys: ' +
    JSON.stringify([...ri.cache.keys()]));
});

test('CONTROL: a successful probe IS cached (we must not probe every churn)', async () => {
  const ri = liftRelayInfo();
  ri.setResult({ trinityone: { enforces: true }, name: 'mybox' });

  const p1 = ri.probe('wss://mybox.example.com');
  const v1 = await p1;
  assert.ok(v1 && v1.enforces === true, 'the successful probe should return the trinityone block');

  await new Promise(r => setTimeout(r, 10));

  assert.ok(ri.cache.has('wss://mybox.example.com'),
    'a SUCCESSFUL probe was deleted from the cache — every churn would re-probe it, which is ' +
    'the single-HTTP-round-trip-per-named-relay-per-pass the comment warns about');
});

test('after clearing a null entry, a second probe actually fetches again', async () => {
  const ri = liftRelayInfo();
  ri.setResult(null);

  await ri.probe('wss://retry.example.com');
  await new Promise(r => setTimeout(r, 10));
  assert.ok(!ri.cache.has('wss://retry.example.com'), 'null entry not cleared');

  // Now the relay comes up
  ri.setResult({ trinityone: { enforces: true }, name: 'retry' });
  ri.resetReached();

  const v2 = await ri.probe('wss://retry.example.com');
  assert.ok(ri.reached, 'the second probe did not fetch — the cache was not actually cleared');
  assert.ok(v2 && v2.enforces === true,
    'the second probe should succeed now that the relay is up. Got: ' + JSON.stringify(v2));
});

// M-7a: adoptInviteRelays persists the relay name so the member engine can re-resolve on dead boxes.
test('adoptInviteRelays persists the relay name for this church', async () => {
  const store = new Map();
  const stubs = {
    localStorage: {
      getItem: (k) => store.get(k) || null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };

  // Check that the adoption code writes to trinityone.relaynames
  const adoptBody = fnBody(BUNDLE, 'async adoptInviteRelays(npubOrHex, raw)', 'adoptInviteRelays');
  assert.match(adoptBody, /trinityone\.relaynames/,
    'adoptInviteRelays does not persist the relay name — member phones cannot re-resolve on dead boxes');
});

// ── M-7b: the churn handler in subscribeChurchRelays calls _reResolveRelayName ──────────────────────
// Verified against the SHIPPED bundle (rule 3: text-match on vendor/*.js IS valid because the bundler
// strips dead code, so deleting the call removes the reference from the bundle).
test('subscribeChurchRelays churn handler calls _reResolveRelayName', () => {
  const scrBody = fnBody(BUNDLE, 'subscribeChurchRelays(churchNpub)', 'subscribeChurchRelays');
  assert.match(scrBody, /_reResolveRelayName/,
    'subscribeChurchRelays does not call _reResolveRelayName — phones cannot follow a church\'s ' +
    'relay to a new tunnel address on churn');
});

// ── M-7b: _reResolveRelayName lifted and EXECUTED ──────────────────────────────────────────────────
// Drives the shipped bundle: the function is lifted, wrapped with stubs, and run. The test fails if
// the function is deleted, or if its logic changes to skip the resolveRelayName or isNetworkRelay calls.

test('_reResolveRelayName calls resolveRelayName with the stored name', async () => {
  const CP = 'a'.repeat(64);
  const body = fnBody(BUNDLE, 'async function _reResolveRelayName(cp)', '_reResolveRelayName');

  let resolvedName = null;
  const fn = new Function(
    '_resolving', '_churchRelays', 'localStorage', 'window', 'isNetworkRelay2',
    body + '\nreturn _reResolveRelayName;'
  )(
    new Set(),                                             // _resolving
    new Map(),                                             // _churchRelays (empty = no working boxes)
    {                                                      // localStorage
      getItem: (k) => {
        if (k === 'trinityone.relaynames') return JSON.stringify({ [CP]: 'mychurch.relay' });
        return null;
      },
      setItem: () => {},
    },
    {                                                      // window.Fellowship
      Fellowship: {
        resolveRelayName: async (name) => { resolvedName = name; return { url: 'wss://new-tunnel.example.com' }; },
        relays: ['wss://old.example.com'],
        setRelays: () => {},
      },
    },
    async () => true,                                      // isNetworkRelay2 (always passes)
  );

  await fn(CP);
  assert.equal(resolvedName, 'mychurch.relay',
    '_reResolveRelayName did not call resolveRelayName with the stored name — phones cannot ' +
    'follow a church\'s relay to a new tunnel address');
});

test('_reResolveRelayName calls isNetworkRelay before adopting a new URL', async () => {
  const CP = 'a'.repeat(64);
  const body = fnBody(BUNDLE, 'async function _reResolveRelayName(cp)', '_reResolveRelayName');

  let isNetworkRelayCalledWith = null;
  let relaysSet = null;
  const fn = new Function(
    '_resolving', '_churchRelays', 'localStorage', 'window', 'isNetworkRelay2',
    body + '\nreturn _reResolveRelayName;'
  )(
    new Set(),
    new Map(),
    {
      getItem: (k) => {
        if (k === 'trinityone.relaynames') return JSON.stringify({ [CP]: 'mychurch.relay' });
        return null;
      },
      setItem: () => {},
    },
    {
      Fellowship: {
        resolveRelayName: async () => ({ url: 'wss://new-tunnel.example.com' }),
        relays: ['wss://old.example.com'],
        setRelays: (rs) => { relaysSet = rs; },
      },
    },
    async (cp, url) => { isNetworkRelayCalledWith = { cp, url }; return true; },
  );

  await fn(CP);
  assert.ok(isNetworkRelayCalledWith,
    '_reResolveRelayName did not call isNetworkRelay — a new tunnel address is adopted without proof');
  assert.equal(isNetworkRelayCalledWith.url, 'wss://new-tunnel.example.com',
    'isNetworkRelay was called with the wrong URL');
  assert.ok(relaysSet && relaysSet.includes('wss://new-tunnel.example.com'),
    '_reResolveRelayName did not adopt the new URL after isNetworkRelay passed');
});

test('_reResolveRelayName does NOT adopt a URL that fails isNetworkRelay', async () => {
  const CP = 'a'.repeat(64);
  const body = fnBody(BUNDLE, 'async function _reResolveRelayName(cp)', '_reResolveRelayName');

  let relaysSet = null;
  const fn = new Function(
    '_resolving', '_churchRelays', 'localStorage', 'window', 'isNetworkRelay2',
    body + '\nreturn _reResolveRelayName;'
  )(
    new Set(),
    new Map(),
    {
      getItem: (k) => {
        if (k === 'trinityone.relaynames') return JSON.stringify({ [CP]: 'mychurch.relay' });
        return null;
      },
      setItem: () => {},
    },
    {
      Fellowship: {
        resolveRelayName: async () => ({ url: 'wss://impostor.example.com' }),
        relays: ['wss://old.example.com'],
        setRelays: (rs) => { relaysSet = rs; },
      },
    },
    async () => false,   // isNetworkRelay rejects
  );

  await fn(CP);
  assert.equal(relaysSet, null,
    '_reResolveRelayName adopted a URL that FAILED isNetworkRelay — an unproven relay gets the data');
});

test('_reResolveRelayName skips when the church already has working boxes', async () => {
  const CP = 'a'.repeat(64);
  const body = fnBody(BUNDLE, 'async function _reResolveRelayName(cp)', '_reResolveRelayName');

  let resolvedName = null;
  const ownRelays = new Map([['wss://healthy.example.com', 'abc']]);
  const fn = new Function(
    '_resolving', '_churchRelays', 'localStorage', 'window', 'isNetworkRelay2',
    body + '\nreturn _reResolveRelayName;'
  )(
    new Set(),
    new Map([[CP, ownRelays]]),                             // church has a working box
    {
      getItem: () => JSON.stringify({ [CP]: 'mychurch.relay' }),
      setItem: () => {},
    },
    {
      Fellowship: {
        resolveRelayName: async (name) => { resolvedName = name; return { url: 'wss://new.example.com' }; },
        relays: [],
        setRelays: () => {},
      },
    },
    async () => true,
  );

  await fn(CP);
  assert.equal(resolvedName, null,
    '_reResolveRelayName tried to re-resolve when the church already has working boxes — ' +
    'unnecessary directory lookups leak which churches a member follows (S3 privacy)');
});
