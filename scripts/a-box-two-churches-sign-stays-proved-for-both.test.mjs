// A BOX TWO CHURCHES SIGN STAYS PROVED FOR BOTH.
// Run: node --test scripts/a-box-two-churches-sign-stays-proved-for-both.test.mjs
//
// Churches host each other, so one box can be named in the signed relay-net document of two churches the same
// phone follows. The admission gate (createRelayGate, src/relay-net.src.js) remembered ONE church per address:
// proving the box for church B overwrote church A's proof, so A's reads and writes skipped that box until A
// proved it again. Found by a-member-adopts-its-churchs-signed-relay test 11 (2026-10-24), which drives the
// member app's real lists over real relays; this file pins down the gate rules themselves.
//
// The gate is lifted from the SHIPPED vendor/fellowship.js (CLAUDE.md rule 3), with the possession proof and the
// church documents replaced by stand-ins so each rule can be checked on its own, with no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stmt } from './test-slice.mjs';

const SRC = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const hex = (c) => c.repeat(64);
const A = hex('a'), B = hex('b'), C = hex('c'), BOX = hex('1'), OTHER = hex('2');
const URL_ = 'wss://box.example.church/relay';

function lift() {
  const body = [
    fnBody(SRC, 'function relayHttpBase', 'relayHttpBase'),
    fnBody(SRC, 'function relayAddrKey', 'relayAddrKey'),
    fnBody(SRC, 'function _relayKey', '_relayKey'),
    stmt(SRC, 'var _isHex64 = ', '_isHex64'),
    fnBody(SRC, 'function canonicalPinsFor', 'canonicalPinsFor'),
    fnBody(SRC, 'function isSharedAddress', 'isSharedAddress'),
    fnBody(SRC, 'function sharedRelayKeys', 'sharedRelayKeys'),
    fnBody(SRC, 'function _originKey', '_originKey'),
    fnBody(SRC, 'function sameOriginRelay', 'sameOriginRelay'),
    fnBody(SRC, 'async function proveRelay', 'proveRelay'),
    stmt(SRC, 'var VERIFIED_KEY = ', 'VERIFIED_KEY'),
    stmt(SRC, 'var VERIFIED_TTL_SEC = ', 'VERIFIED_TTL_SEC'),
    stmt(SRC, 'var VERIFIED_REFRESH_SEC = ', 'VERIFIED_REFRESH_SEC'),
    stmt(SRC, 'var VERIFY_RETRY_SEC = ', 'VERIFY_RETRY_SEC'),
    fnBody(SRC, 'function readVerified', 'readVerified'),
    fnBody(SRC, 'function writeVerified', 'writeVerified'),
    fnBody(SRC, 'function admitCached', 'admitCached'),
    fnBody(SRC, 'function _scopesOf', '_scopesOf'),
    fnBody(SRC, 'function _admittingScope', '_admittingScope'),
    fnBody(SRC, 'function rememberVerified', 'rememberVerified'),
    fnBody(SRC, 'function createRelayGate', 'createRelayGate'),
  ].join('\n');
  // GUARDS ON THE LIFT: the lines this file is about must be in what it runs.
  assert.match(body, /rememberVerified\(map, url, res\.pub, scope, nowSec\(\)\)/, 'vendor/fellowship.js: prove() no longer records through rememberVerified');
  assert.match(body, /return !!_admittingScope\(e, cp, nowSec\)/, 'vendor/fellowship.js: admitCached no longer asks which scope admits');
  return new Function('scope', `with (scope) { ${body}; return { createRelayGate, readVerified, VERIFIED_KEY, VERIFIED_TTL_SEC, VERIFIED_REFRESH_SEC }; }`)({
    URL, console, CANONICAL_RELAY_PUBS: {},
  });
}
const L = lift();

function memStore() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; }

// A gate whose box proves `state.key`, and whose churches sign whatever `state.signs[cp]` lists.
function gateFor(store, state) {
  return L.createRelayGate({
    store,
    verify: async () => ({ relayPub: state.key }),
    netEntries: async (cp) => (state.signs[cp] || []).map(pubkey => ({ pubkey, url: URL_ })),
    origin: '',
    pins: {},
    now: () => state.now,
  });
}

test('a box both churches sign is admitted for BOTH after it is proved for each, not only the last', async () => {
  const state = { key: BOX, signs: { [A]: [BOX], [B]: [BOX] }, now: 1_000_000 };
  const g = gateFor(memStore(), state);
  await g.refresh([URL_], A);
  assert.equal(g.admits(URL_, A), true, 'staging: not admitted for A after proving for A');
  await g.refresh([URL_], B);
  assert.equal(g.admits(URL_, B), true, 'not admitted for B after proving for B');
  assert.equal(g.admits(URL_, A), true, 'proving the box for church B un-admitted it for church A');
  assert.deepEqual(g.admit([URL_], A), [URL_], 'church A\'s publish filter drops the shared box');
  assert.equal(g.provedKey(URL_, A), BOX, 'church A no longer sees the key the box proved');
  // CONTROL: the scope is still per church. A third church that never proved it is not admitted for it.
  // (C does not sign it; with no proof run for C the cache has nothing to say, which must read as "no".)
  assert.equal(g.admits(URL_, C), false, 'one church\'s proof admitted the box for a church that never proved it');
});

test('both churches survive a relaunch, and an entry written by an older build still reads', async () => {
  const state = { key: BOX, signs: { [A]: [BOX], [B]: [BOX] }, now: 1_000_000 };
  const store = memStore();
  const g = gateFor(store, state);
  await g.refresh([URL_], A);
  await g.refresh([URL_], B);
  const g2 = gateFor(store, state);
  assert.equal(g2.admits(URL_, A) && g2.admits(URL_, B), true, 'after a relaunch the box is admitted for only one church');
  // An older build wrote { pub, cp, at, until } with no `cps`. It must keep meaning exactly what it meant.
  const old = memStore();
  old.setItem(L.VERIFIED_KEY, JSON.stringify({ [URL_]: { pub: BOX, cp: A, at: state.now, until: state.now + 86400 } }));
  const g3 = gateFor(old, state);
  assert.equal(g3.admits(URL_, A), true, 'an entry from an older build lost its church');
  assert.equal(g3.admits(URL_, B), false, 'an entry from an older build was widened to another church');
  const oldAny = memStore();
  oldAny.setItem(L.VERIFIED_KEY, JSON.stringify({ [URL_]: { pub: BOX, cp: '', at: state.now, until: state.now + 86400 } }));
  assert.equal(gateFor(oldAny, state).admits(URL_, B), true, 'a church-independent entry from an older build stopped being one');
});

test('a different key at the address wipes EVERY church\'s proof, not just the one asking', async () => {
  const state = { key: BOX, signs: { [A]: [BOX], [B]: [BOX] }, now: 1_000_000 };
  const g = gateFor(memStore(), state);
  await g.refresh([URL_], A);
  await g.refresh([URL_], B);
  // Another machine answers at the address now, and church B signs that one too. Proving for B must not carry
  // A's proof — which was about the OLD machine — over to it.
  state.key = OTHER; state.signs[B] = [OTHER];
  await g.refresh([URL_], B);
  assert.equal(g.provedKey(URL_, B), OTHER, 'staging: the new key was not recorded');
  assert.equal(g.admits(URL_, A), false, 'church A\'s proof of the OLD machine was carried over to the new one');
});

test('each church\'s proof runs out on its own clock', async () => {
  const state = { key: BOX, signs: { [A]: [BOX], [B]: [BOX] }, now: 1_000_000 };
  const g = gateFor(memStore(), state);
  await g.refresh([URL_], A);
  state.now += 1000;
  await g.refresh([URL_], B);
  // Just past A's expiry and before B's: A's proof is gone, B's stands. B's newer proof does not extend A's.
  state.now = 1_000_000 + L.VERIFIED_TTL_SEC + 1;
  assert.equal(g.admits(URL_, B), true, 'B\'s proof expired with A\'s');
  assert.equal(g.admits(URL_, A), false, 'church B\'s newer proof kept church A\'s expired one alive');
});
