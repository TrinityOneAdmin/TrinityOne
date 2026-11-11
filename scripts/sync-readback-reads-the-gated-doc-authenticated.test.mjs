// THE CONSOLE MUST READ BACK ITS OWN SYNC SETTING THE AUTHENTICATED WAY IT WROTE IT.
// Run: node --test scripts/sync-readback-reads-the-gated-doc-authenticated.test.mjs
//
// PLAN-console-relay-reconciliation-2026-11-08, work item A. `trinityone/relays` is NIP-42 auth-gated at the
// relay (scripts/gateway.mjs: church-key-only). syncEnable()/the seed read it AUTHENTICATED
// (_oneComplete([...], …, true)); backupState() — which drives the "Keep your relays in sync" toggle AND the
// default-on boot path autoSyncIfRedundant() — used to read it with a plain UNAUTHENTICATED _one(), which
// finishes on the first relay's EOSE (an empty/ungated box) before the gated box has signed our lazy NIP-42
// challenge. So it resolved EMPTY → syncOn:false even with sync ON → the toggle showed OFF and "reverted on
// refresh", and default-on never stuck. This proves backupState now reads it the authenticated/complete way.
//
// Engine half (lifted from the shipped vendor/steward.js — rule 3). The SCREEN half (the toggle reflects this,
// the per-relay chip) is scripts/sync-toggle-and-indicator-on-screen.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

// Slice a function/method body out of the bundle by its exact signature anchor, brace-matched.
function lift(anchor) {
  const i = BUNDLE.indexOf(anchor);
  assert.ok(i > 0, `${anchor} is not in the shipped bundle — rebuild (bash scripts/build-steward.sh) or re-anchor`);
  let d = 0;
  for (let k = BUNDLE.indexOf('{', i); k < BUNDLE.length; k++) {
    if (BUNDLE[k] === '{') d++;
    else if (BUNDLE[k] === '}') { d--; if (!d) return BUNDLE.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces slicing ' + anchor);
}

const PUB = 'a'.repeat(64);
const SYNC_DOC = { pubkey: PUB, content: JSON.stringify([{ pubkey: 'b'.repeat(64), url: 'wss://x' }, { pubkey: 'c'.repeat(64), url: 'wss://y' }]) };

// Build backupState with injected module-scope deps. `_one` is injected too and returns EMPTY on purpose: the
// fixed read must NOT consult it. `_oneComplete` is the authenticated/complete read; it asserts the private-doc
// flag is set and returns whatever `authedDoc` the case supplies.
function makeBackupState({ authedDoc, onPrivArg, answered = true }) {
  const body = lift('async backupState()');
  // _oneComplete is the authenticated/complete read. It now also reports WHICH relays were asked and which
  // actually answered, so backupState's tri-state can tell "every relay answered, no doc = genuinely OFF" apart
  // from "a relay is still login-pending = UNKNOWN". With answered:false we leave one asked relay out of
  // answeredUrls — its NIP-42 login had not finished, so the read is inconclusive.
  const ASKED = ['wss://x/relay', 'wss://y/relay'];
  const obj = new Function('window', '_one', '_oneComplete', 'pub', 'JSON',
    'return ({ ' + body + ' })')(
    { Steward: { relayIdentities: async () => ([
        { url: 'wss://x/relay', pubkey: 'b'.repeat(64), online: true },
        { url: 'wss://y/relay', pubkey: 'c'.repeat(64), online: true },
      ]) } },
    async () => null,                                  // _one: the UNAUTH path — always empty for a gated doc
    async (_filters, _ms, priv) => { if (onPrivArg) onPrivArg(priv); return { ev: authedDoc, complete: answered, asked: ASKED.length, askedUrls: ASKED.slice(), answeredUrls: answered ? ASKED.slice() : ASKED.slice(0, 1) }; },
    PUB, JSON,
  );
  return obj.backupState;
}

test('syncOn reads back TRUE from the authenticated read, and the read forces NIP-42 (privateDoc=true)', async () => {
  let sawPriv = null;
  const st = await makeBackupState({ authedDoc: SYNC_DOC, onPrivArg: (p) => { sawPriv = p; } })();
  assert.equal(st.syncOn, true,
    'sync is ON (the gated doc lists 2 relays) but syncOn read back false — the "reverts on refresh" bug: the ' +
    'read did not use the authenticated/complete path, so a gated doc resolves empty');
  assert.equal(sawPriv, true,
    'the read-back must pass privateDoc=true, so a relay still holding the doc behind an unanswered NIP-42 ' +
    'login is not counted as "said nothing" — exactly what _one() got wrong');
});

test('syncOn PERSISTS across a refresh — two reads of the same persisted doc both return true', async () => {
  const bs = makeBackupState({ authedDoc: SYNC_DOC });
  assert.equal((await bs()).syncOn, true);
  assert.equal((await bs()).syncOn, true, 'a second mount (a refresh) read back false — the state did not persist');
});

test('every relay answered and NO doc came back → sync is genuinely OFF (false)', async () => {
  const st = await makeBackupState({ authedDoc: null, answered: true })();
  assert.equal(st.syncOn, false,
    'all asked relays answered (nobody still login-pending) and none held the doc → sync is off, a definite false');
});

test('an AUTH-PENDING read is UNKNOWN (null), not OFF — the flaky-switch fix', async () => {
  const st = await makeBackupState({ authedDoc: null, answered: false })();
  assert.equal(st.syncOn, null,
    'a relay that was asked never answered (its NIP-42 login was still in flight), so the read is inconclusive: ' +
    'syncOn must be null ("Checking…"), NOT a confident false that renders the "Keep your relays in sync" toggle ' +
    'OFF though sync is on — the exact non-determinism a live drive caught on the Living Word console');
});

test('a doc signed by SOMEONE ELSE is not trusted (author re-check)', async () => {
  const st = await makeBackupState({ authedDoc: { pubkey: 'f'.repeat(64), content: SYNC_DOC.content } })();
  assert.equal(st.syncOn, false,
    'a relay need not honour the author filter; a 2-entry doc signed by a non-church key must not read as ' +
    'this church\'s sync being on');
});

// ── PER-RELAY SYNC INDICATOR classifier (plan §3). Pure; drives the Relays-list chip. ───────────────────────
function relaySyncState() {
  const body = lift('relaySyncState(sync) {');
  return new Function('Number', 'return (function ' + body + ')')(Number);
}

test('a box with a clean pass and peers reads "Synced"', () => {
  const f = relaySyncState();
  assert.deepEqual(f({ at: 1700000000, imported: 3, ok: true, error: '', running: false, peers: 1 }),
    { state: 'synced', label: 'Synced' });
});

test('an island reads "Not syncing"; a box-wide ok:false does NOT redden this church (Option A, 2026-11-11)', () => {
  const f = relaySyncState();
  // OPTION A (fix/relay-panel-truth-2026-11-11): the `sync.ok === false → Catching up…` branch was REMOVED.
  // `/status.sync.ok` is the relay's BOX-WIDE aggregate (false if ANY church on the box failed its last pass),
  // so it bled one church's trouble onto every church's chip. A box-wide red now falls through to unknown/blank
  // rather than reddening a church that is itself fine. (Pinned also in the-relay-panel-tells-the-truth-2026-11-11.)
  const red = f({ ok: false, error: 'a peer refused this box', peers: 2, at: 1700000000 });
  assert.notEqual(red.label, 'Catching up…', 'a box-wide ok:false must not borrow this church\'s chip a red');
  assert.deepEqual(red, { state: 'unknown', label: '' }, 'a box-wide red falls through to blank');
  assert.equal(f({ ok: true, at: 1700000000, peers: 0 }).state, 'island',
    'peers:0 is an island with nothing to pull from — a stale view can win there; it must not read "Synced"');
  assert.equal(f({ running: true, peers: 1 }).label, 'Catching up…', 'a box mid-import is catching up');
  assert.equal(f(null).label, '', 'no /status.sync → say nothing, do not imply a state');
});
