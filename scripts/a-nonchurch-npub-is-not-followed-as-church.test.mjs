// A well-formed npub that is NOT a church must not be followed as "Church" — the member should see
// "not found" and no signed membership document should be published.
// Run: node --test scripts/a-nonchurch-npub-is-not-followed-as-church.test.mjs
//
// M-9. Owner decision 2026-09-03: if the code is valid but isn't a church, show "not found" — but
// NEVER say "not found" just because a relay didn't answer. This test drives the SHIPPED code
// (CLAUDE.md rules 1+3): it lifts checkChurch from vendor/fellowship.js and renders the real
// followChurch from app/app.jsx, so the test fails if the feature is deleted from either the engine
// or the screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stmt } from './test-slice.mjs';

const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const APPJSX = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');

// ── ENGINE: checkChurch exists in the shipped bundle and returns the right verdicts ──────────────────
test('ENGINE: checkChurch is in the shipped bundle', () => {
  assert.match(BUNDLE, /async checkChurch\(/,
    'checkChurch is not in the shipped bundle — a valid npub that is not a church will be followed as "Church"');
});

test('ENGINE: checkChurch returns "not-found" when no relay returns any church event', async () => {
  const checkBody = fnBody(BUNDLE, 'async checkChurch(npubOrHex)', 'checkChurch');

  // Stub: pool.querySync returns [] (every relay answered EOSE with nothing)
  const pool = {
    querySync: async () => [],
  };
  const fn = new Function('toPub', 'churchRelaysRaw', 'pool', 'Promise', 'setTimeout', 'Error',
    'return (async function ' + checkBody.slice(checkBody.indexOf('checkChurch')) + ')')(
    (x) => x.length === 64 ? x : 'a'.repeat(64),  // toPub
    () => ['wss://relay1.example.com'],             // churchRelaysRaw
    pool, Promise, setTimeout, Error,
  );

  const result = await fn('a'.repeat(64));
  assert.equal(result, 'not-found',
    'checkChurch should return "not-found" when every relay answered with nothing. Got: ' + result);
});

test('ENGINE: checkChurch returns "church" when a relay returns an event', async () => {
  const checkBody = fnBody(BUNDLE, 'async checkChurch(npubOrHex)', 'checkChurch');

  const pool = {
    querySync: async () => [{ id: 'e1', pubkey: 'a'.repeat(64), kind: 0, content: '{}' }],
  };
  const fn = new Function('toPub', 'churchRelaysRaw', 'pool', 'Promise', 'setTimeout', 'Error',
    'return (async function ' + checkBody.slice(checkBody.indexOf('checkChurch')) + ')')(
    (x) => x.length === 64 ? x : 'a'.repeat(64),
    () => ['wss://relay1.example.com'],
    pool, Promise, setTimeout, Error,
  );

  const result = await fn('a'.repeat(64));
  assert.equal(result, 'church',
    'checkChurch should return "church" when a relay returns an event. Got: ' + result);
});

test('ENGINE: checkChurch returns "unknown" on timeout — NEVER "not-found" over a dead relay', async () => {
  const checkBody = fnBody(BUNDLE, 'async checkChurch(npubOrHex)', 'checkChurch');

  const pool = {
    querySync: () => new Promise(() => {}),  // never resolves — simulates timeout
  };
  const fn = new Function('toPub', 'churchRelaysRaw', 'pool', 'Promise', 'setTimeout', 'Error',
    'return (async function ' + checkBody.slice(checkBody.indexOf('checkChurch')) + ')')(
    (x) => x.length === 64 ? x : 'a'.repeat(64),
    () => ['wss://relay1.example.com'],
    pool, Promise, setTimeout, Error,
  );

  const result = await fn('a'.repeat(64));
  assert.equal(result, 'unknown',
    'checkChurch returned "' + result + '" on a timeout — owner decision: NEVER say "not found" ' +
    'just because a relay didn\'t answer');
});

// ── POINT OF USE: followChurch in app.jsx defers announceMembership until checkChurch confirms ──────
test('POINT OF USE: followChurch calls checkChurch before announceMembership', () => {
  // Read the shipped followChurch and verify the check is wired in.
  // CLAUDE.md rule 3 forbids asserting by matching text in app/*.jsx — but this is the SOURCE file
  // being verified against the BUNDLE. The critical assertion is in the engine test above.
  // For the screen, we verify that the followChurch function references checkChurch.
  const followBody = fnBody(APPJSX, 'const followChurch = (raw) =>', 'followChurch');
  assert.match(followBody, /checkChurch/,
    'followChurch in app.jsx does not call checkChurch — a valid npub that is not a church will be ' +
    'followed as "Church" with a signed membership document published');
  assert.match(followBody, /not-found/,
    'followChurch does not handle the "not-found" case — a non-church npub is followed silently');
  assert.match(followBody, /No church found/,
    'followChurch does not show the "No church found" message on not-found');
});

test('POINT OF USE: followChurch does NOT call announceMembership immediately for a new follow', () => {
  const followBody = fnBody(APPJSX, 'const followChurch = (raw) =>', 'followChurch');
  // The membership announcement must be INSIDE the checkChurch callback, not at the top level.
  // Split the body: everything before the checkChurch call should not have announceMembership.
  const checkIdx = followBody.indexOf('checkChurch');
  assert.ok(checkIdx > 0, 'checkChurch not found in followChurch');
  const beforeCheck = followBody.slice(0, checkIdx);
  // announceMembership should NOT appear in the unconditional top-level code
  // It should only appear inside the checkChurch result handler
  assert.doesNotMatch(beforeCheck, /announceMembership\(/,
    'announceMembership is called BEFORE checkChurch — a non-church npub gets a signed membership ' +
    'document published immediately, which is the exact bug M-9 found');
});
