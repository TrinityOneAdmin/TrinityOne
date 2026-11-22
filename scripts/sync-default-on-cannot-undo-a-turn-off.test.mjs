// DEFAULT-ON SYNC CANNOT UNDO A DELIBERATE TURN-OFF, AND THE SYNC TOGGLE SIGNS INSIDE THE ONE QUEUE.
// Run: node --test scripts/sync-default-on-cannot-undo-a-turn-off.test.mjs
//
// PLAN-relay-autoconnect-selfhealing-sync-2026-11-20, work item A4 — two pre-existing defects:
//
//  1. `autoSyncIfRedundant` (the 5-second boot timer, app/steward-root.jsx) fired on `!st.syncOn`, which is
//     also true over a deliberate `[]` Turn-off — so a steward who pressed "Turn off" while decommissioning
//     a box had it silently re-enabled on the next console launch — and over an UNKNOWN read, so an outage
//     could flip it too. backupState now reports `docExists` off its existing three-state read (true: a
//     signed copy was read, `[]` included; false: fully-answered, no doc anywhere; null: inconclusive), and
//     the boot timer fires ONLY over docExists === false — "no doc has ever existed", the one state where
//     default-on is a default and not an override.
//  2. syncEnable / syncDisable signed OUTSIDE the enrolSerial signing queue, so a heal pass (A1) could
//     interleave with a Turn-off and re-sign over it. Their sign+publish halves now hold the queue slot;
//     syncEnable's per-relay probe (relayIdentities) stays OUTSIDE the queue (the no-nesting rule).
//
// Everything here is lifted from the SHIPPED vendor/steward.js and RUN (rules 1/3): the real backupState
// feeds the real autoSyncIfRedundant, with only the I/O boundary (_oneComplete / publish / the probe)
// injected. A test that stubbed backupState's answer would decide the question under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const PUB = 'a'.repeat(64);
const ASKED = ['wss://x/relay', 'wss://y/relay'];
const TWO_BOX_DOC = JSON.stringify([{ pubkey: 'b'.repeat(64), url: 'https://x' }, { pubkey: 'c'.repeat(64), url: 'https://y' }]);

// The real backupState + autoSyncIfRedundant chain over an injected read. `doc` is the newest signed copy
// the authenticated read returns (null = none); `answered` false leaves one asked relay unanswered.
function makeWorld({ doc, answered = true }) {
  const enabled = [];
  const scope = {
    sk: new Uint8Array(32).fill(7), pub: PUB, actingChurch: '',
    JSON, Set, Map, Array, Object, String, Number, Promise, Error,
    _oneComplete: async (_f, _ms, priv) => {
      assert.equal(priv, true, 'the sync-doc read lost privateDoc=true — the NIP-42 fix would be undone');
      return { ev: doc, complete: answered, asked: ASKED.length, askedUrls: ASKED.slice(), answeredUrls: answered ? ASKED.slice() : ASKED.slice(0, 1) };
    },
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      throw new ReferenceError('the lifted chain needs `' + String(k) + '` — add a stub');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const bodies = [
    fnBody(BUNDLE, 'async backupState() {', 'backupState in the shipped bundle'),
    fnBody(BUNDLE, 'async autoSyncIfRedundant() {', 'autoSyncIfRedundant in the shipped bundle'),
  ].join(',\n');
  const api = new Function('scope', 'with (scope) { return { ' + bodies + ' }; }')(proxy);
  scope.window = { Steward: { ...api,
    relayIdentities: async () => ([
      { url: ASKED[0], base: 'https://x', pubkey: 'b'.repeat(64), online: true },
      { url: ASKED[1], base: 'https://y', pubkey: 'c'.repeat(64), online: true },
    ]),
    syncEnable: async () => { enabled.push(1); return { relays: 2 }; },
  } };
  return { api, enabled };
}

// ── 1. backupState's docExists: the three states, measured off the real read ────────────────────────────
test('docExists is TRUE for a signed copy — including the `[]` Turn-off, whose syncOn stays false', async () => {
  const on = await makeWorld({ doc: { pubkey: PUB, content: TWO_BOX_DOC } }).api.backupState();
  assert.equal(on.docExists, true);
  assert.equal(on.syncOn, true, 'the two-box doc no longer reads as sync ON — an existing field changed meaning');
  const off = await makeWorld({ doc: { pubkey: PUB, content: '[]' } }).api.backupState();
  assert.equal(off.docExists, true,
    'a `[]` Turn-off read back as "no doc has ever existed" — the boot timer would then undo it, the exact bug');
  assert.equal(off.syncOn, false, 'a `[]` doc must still read as sync OFF');
});

test('docExists is FALSE only on a fully-answered read with no doc, and NULL on an inconclusive one', async () => {
  const none = await makeWorld({ doc: null, answered: true }).api.backupState();
  assert.equal(none.docExists, false, 'every relay answered and none held the doc — that is the one honest "never existed"');
  const unknown = await makeWorld({ doc: null, answered: false }).api.backupState();
  assert.equal(unknown.docExists, null,
    'a read with a relay still unanswered claimed "no doc has ever existed" — an outage would then look like a fresh church');
  const stranger = await makeWorld({ doc: { pubkey: 'f'.repeat(64), content: TWO_BOX_DOC }, answered: true }).api.backupState();
  assert.equal(stranger.docExists, false, 'a doc signed by a non-church key counted as the church\'s own');
});

// ── 2. autoSyncIfRedundant branches on it (the boot-timer decision, run for real) ───────────────────────
test('the boot timer does NOT re-enable sync over a `[]` Turn-off', async () => {
  const w = makeWorld({ doc: { pubkey: PUB, content: '[]' } });
  const out = await w.api.autoSyncIfRedundant();
  assert.deepEqual(w.enabled, [],
    'A DELIBERATE TURN-OFF WAS UNDONE: autoSyncIfRedundant called syncEnable over a `[]` doc — the steward\'s ' +
    'decommission/seizure response is silently reverted ~5 s after the next console boot');
  assert.equal(out.enabled, false);
  assert.equal(out.already, false, 're-anchor: the `[]` doc should report already:false (sync is off), so the ' +
    'assertion above is about the doc, not about a short-circuit');
});

test('…and does nothing over an UNKNOWN read', async () => {
  const w = makeWorld({ doc: null, answered: false });
  const out = await w.api.autoSyncIfRedundant();
  assert.deepEqual(w.enabled, [], 'an inconclusive read (a relay mid-login, an outage) switched sync on');
  assert.equal(out.enabled, false);
});

test('CONTROL: with no doc anywhere (fully answered) and 2 proved boxes, default-on still fires', async () => {
  const w = makeWorld({ doc: null, answered: true });
  const out = await w.api.autoSyncIfRedundant();
  assert.deepEqual(w.enabled, [1],
    'THE OWNER CONSOLE LOST AUTOMATIC SYNC: a church that added a real second box no longer gets mirroring ' +
    'without hunting for a toggle — the docExists gate is refusing the one state it must allow');
  assert.equal(out.enabled, true);
  assert.equal(out.boxes, 2);
});

// ── 3. the toggle signs inside the one queue; the probe stays outside it ────────────────────────────────
function liftToggle(order) {
  const scope = {
    sk: new Uint8Array(32).fill(7), pub: PUB, JSON,
    now: () => 1763000000, _monotonic: (t) => t, finalizeEvent2: (t) => ({ ...t, pubkey: PUB }),
    enrolSerial: (fn) => { order.push('queued'); return fn(); },
    publish: async () => { order.push('publish'); return { id: 'e' }; },
    // B1 (2026-11-22): syncEnable reads the church's removed-relay keys inside its queue slot. "Nothing removed,
    // read complete" here — this file's subject is the queue ORDER; the read itself (tombstoned and pending keys
    // dropped, an incomplete read refusing) is run for real in removal-sticks-and-closes-sync-trust.test.mjs.
    _unprovedDroppable: () => new Set(),
    _removedKeysRead: async () => { order.push('removed-read'); return { complete: true, keys: new Set() }; },
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; throw new ReferenceError('lift needs ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const bodies = [
    fnBody(BUNDLE, 'async syncEnable() {', 'syncEnable in the shipped bundle'),
    fnBody(BUNDLE, 'async syncDisable() {', 'syncDisable in the shipped bundle'),
  ].join(',\n');
  const api = new Function('scope', 'with (scope) { return { ' + bodies + ' }; }')(proxy);
  scope.window = { Steward: { relayIdentities: async () => { order.push('probe'); return [
    { url: 'wss://x/relay', base: 'https://x', pubkey: 'b'.repeat(64), online: true },
    { url: 'wss://y/relay', base: 'https://y', pubkey: 'c'.repeat(64), online: true },
  ]; } } };
  return api;
}

test('syncEnable: the per-relay probe runs BEFORE the queue; sign+publish hold the slot', async () => {
  const order = [];
  const r = await liftToggle(order).syncEnable();
  assert.equal(r.relays, 2, 'CONTROL: the happy path no longer reports how many relays sync');
  assert.deepEqual(order, ['probe', 'queued', 'removed-read', 'publish'],
    'order was ' + JSON.stringify(order) + ' — the probe inside the queue slot starves every other signing ' +
    '(enrol, Connect, Remove, heal) for its duration, and a publish outside the slot is the A4 race reopened');
});

test('syncDisable: the `[]` write holds the queue slot', async () => {
  const order = [];
  const r = await liftToggle(order).syncDisable();
  assert.deepEqual(r, { relays: 0 });
  assert.deepEqual(order, ['queued', 'publish'],
    'order was ' + JSON.stringify(order) + ' — a Turn-off signed outside the queue can be interleaved and ' +
    '"repaired" away by a concurrent heal, which is the race A4 exists to close');
});

test('…and their refusals still throw through the queue (the 2026-09-02 honesty fixes keep their words)', async () => {
  const mk = (which) => {
    const scope = {
      sk: new Uint8Array(32).fill(7), pub: PUB, JSON,
      now: () => 1763000000, _monotonic: (t) => t, finalizeEvent2: (t) => t,
      enrolSerial: (fn) => fn(), publish: async () => null,
      _unprovedDroppable: () => new Set(), _removedKeysRead: async () => ({ complete: true, keys: new Set() }),   // B1: nothing removed, read complete
    };
    const proxy = new Proxy(scope, { has: (t, k) => (k in t) || !(String(k) in globalThis),
      get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; throw new ReferenceError('lift needs ' + String(k)); },
      set: (t, k, v) => { t[k] = v; return true; } });
    const api = new Function('scope', 'with (scope) { return { ' + fnBody(BUNDLE, which, which) + ' }; }')(proxy);
    scope.window = { Steward: { relayIdentities: async () => [
      { url: 'wss://x/relay', base: 'https://x', pubkey: 'b'.repeat(64), online: true },
      { url: 'wss://y/relay', base: 'https://y', pubkey: 'c'.repeat(64), online: true },
    ] } };
    return api;
  };
  await assert.rejects(() => mk('async syncEnable() {').syncEnable(), /no relay accepted/i,
    'a refused Turn-on stopped throwing — "✓ Sync on" would paint over a document no relay took');
  await assert.rejects(() => mk('async syncDisable() {').syncDisable(), /STILL mirroring/,
    'a refused Turn-off stopped throwing — the boxes go on mirroring while the console says they stopped');
});
