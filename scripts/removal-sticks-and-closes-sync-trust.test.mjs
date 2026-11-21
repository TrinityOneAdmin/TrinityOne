// REMOVING A RELAY CLOSES ITS SYNC TRUST AND STICKS — plan A2 (a SECURITY fix).
// Run: node --test scripts/removal-sticks-and-closes-sync-trust.test.mjs
//
// PLAN-relay-autoconnect-selfhealing-sync-2026-11-20, work item A2. The confirmed gap (both prior audits): when a
// steward presses Remove, the relay's key STAYS in TRUSTED_RELAYS (the trinityone/relays sync doc) on every peer
// and keeps full-corpus pull rights for ever — nothing prunes it. A2 makes the Remove flow, inside the SAME
// unenrolRelayNet queue slot, ALSO (a) re-sign trinityone/relays WITHOUT the removed key — the actual prune — and
// (b) write a trinityone/relays-removed tombstone so no other console's additive heal can put the box back. A
// deliberate Add/Connect clears that tombstone (the one un-tombstone path).
//
// Everything decision-making is lifted from the SHIPPED vendor/steward.js and RUN (rules 1/3): the real
// unenrolRelayNet, the real _closeSyncTrust, the real _writeTombstone, the real syncHeal (to prove the writer's
// output is honoured by the A1 reader), the real _readCovers / enrolSerial / normalisers. Only the I/O boundary
// (identity probe, relay read, publish) is injected. The Remove and un-tombstone WIRES (dropRelay -> unsignRelay,
// signRelay -> un-tombstone + heal) are point-of-use tested in sync-list-heals-itself.test.mjs and the existing
// dropOutcome tests; this file drives the bundled engine those wires call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeURL } from 'nostr-tools/utils';
import { fnBody, stmt } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const BUNDLE = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
const PUB = 'a'.repeat(64);
const NOW = 1763650000;
const KEY_A = '1a'.repeat(32), KEY_B = '2b'.repeat(32), KEY_C = '3c'.repeat(32);

const LIFT = [
  ['st', 'var RELAY_NET_D = '],
  ['st', 'var RELAYS_REMOVED_D = '],
  ['fn', 'function _syncRelayBase'],
  ['st', 'var _syncRelayKey = '],
  ['fn', 'function _isPrivateRelayBase(u) {'],
  ['fn', 'function parseRelayNet(content) {'],
  ['fn', 'function _readCovers'],
  ['fn', 'function relayNetDoc() {'],
  ['st', 'var _enrolQueue = '],
  ['fn', 'function enrolSerial'],
  ['fn', 'async function _writeTombstone(opts) {'],
  ['fn', 'async function _closeSyncTrust(opts) {'],
  ['fn', 'async function unenrolRelayNet(url) {'],
  ['fn', 'async function syncHeal() {'],
].map(([k, a]) => (k === 'fn' ? fnBody(BUNDLE, a, a) : stmt(BUNDLE, a, a))).join('\n');

// A console over an in-memory relay fleet. cfg:
//   relays:     [{ url, key: hex|'', up }] — up:false answers neither probe nor read
//   net:        relay-net doc entries [{pubkey, url}] | null
//   sync:       trinityone/relays entries | '[]' | null
//   tombs:      [{pubkey, at}] | null
//   own:        the console's serving box url ('' = none)
//   extra:      extraRelays() — the droppable, church-added addresses
//   dropAfterReads / dropUrl: flip dropUrl's relay DOWN after this many relay reads (stage a mid-op partial)
function makeWorld(cfg) {
  const relays = (cfg.relays || []).map(r => ({ ...r }));
  const store = new Map();   // d -> [events]
  const dOf = (ev) => ((ev.tags || []).find(t => t[0] === 'd') || [])[1] || '';
  const put = (ev) => { const a = store.get(dOf(ev)) || []; a.push(ev); store.set(dOf(ev), a); };
  if (cfg.net != null) put({ kind: 30078, pubkey: PUB, created_at: NOW - 1000, tags: [['d', 'trinityone/relay-net']], content: JSON.stringify(cfg.net) });
  if (cfg.sync != null) put({ kind: 30078, pubkey: PUB, created_at: NOW - 1000, tags: [['d', 'trinityone/relays']], content: typeof cfg.sync === 'string' ? cfg.sync : JSON.stringify(cfg.sync) });
  if (cfg.tombs) put({ kind: 30078, pubkey: cfg.tombAuthor || PUB, created_at: NOW - 900, tags: [['d', 'trinityone/relays-removed']], content: JSON.stringify(cfg.tombs) });
  const writes = [];
  let ids = 0, reads = 0;
  const byUrl = (u) => relays.find(r => r.url === u);
  const scope = {
    sk: new Uint8Array(32).fill(7), pub: PUB, actingChurch: '', _viewingNetwork: () => false,
    normalizeURL, normalizeURL2: normalizeURL,
    JSON, Math, Set, Map, Array, Object, String, Number, Promise, Error, Date,
    now: () => NOW, _monotonic: (t) => t,
    _isHex64: (p) => /^[0-9a-f]{64}$/.test(String(p || '')),
    finalizeEvent: (t) => ({ ...t, pubkey: PUB, id: 'w' + (++ids) }),
    finalizeEvent2: (t) => ({ ...t, pubkey: PUB, id: 'w' + (++ids) }),
    normRelay: (x) => String(x || '').trim(),
    relaysRaw: () => relays.map(r => r.url),
    extraRelays: () => (cfg.extra || []).slice(),
    relayNetCandidates: () => (cfg.own ? [cfg.own] : []),
    selfPublicRelay: () => cfg.selfPub || '',
    verifyRelayIdentity: async (u) => {
      const r = byUrl(u);
      if (!r || !r.up || !r.key) throw new Error('no proof at ' + u);
      return { relayPub: r.key, url: u, at: NOW };
    },
    CANONICAL_RELAY_PUBS: Object.freeze((cfg.canonical || []).reduce((m, u) => ({ ...m, [u]: ['f'.repeat(64)] }), {})),
    CANONICAL_RELAYS: (cfg.canonical || []).slice(),
    publish: async (ev) => { writes.push(ev); put(ev); return ev; },
    _oneComplete: async (filters) => {
      reads++;
      if (cfg.dropAfterReads && reads > cfg.dropAfterReads && cfg.dropUrl) { const r = byUrl(cfg.dropUrl); if (r) { r.up = false; r.key = ''; } }
      const d = (filters[0]['#d'] || [])[0];
      const evs = (store.get(d) || []).slice().sort((x, y) => (y.created_at - x.created_at) || ((store.get(d) || []).indexOf(y) - (store.get(d) || []).indexOf(x)));
      const askedUrls = relays.map(r => r.url);
      const answeredUrls = relays.filter(r => r.up).map(r => r.url);
      return { ev: evs[0] || null, complete: answeredUrls.length > 0, asked: askedUrls.length, askedUrls, answeredUrls };
    },
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; throw new ReferenceError('the lifted A2 engine needs `' + String(k) + '` — add a stub'); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const api = new Function('scope', 'with (scope) {' + LIFT +
    '\nreturn { unenrolRelayNet, syncHeal, _writeTombstone, _closeSyncTrust, enrolSerial }; }')(proxy);
  // Read the NEWEST copy exactly as _oneComplete / the engine does: created_at desc, and on a tie the
  // LAST-written wins (insertion index) — a constant now() + identity _monotonic make every write in a test tie,
  // and breaking the tie any other way would let a later re-sign hide behind an earlier one (it masked a real
  // re-add during sabotage).
  const docOf = (d) => { const arr = store.get(d) || []; const a = arr.slice().sort((x, y) => (y.created_at - x.created_at) || (arr.indexOf(y) - arr.indexOf(x))); return a[0] ? JSON.parse(a[0].content) : null; };
  return { api, writes, scope, store,
    sync: () => docOf('trinityone/relays'),
    tombs: () => docOf('trinityone/relays-removed'),
    writesTo: (d) => writes.filter(w => ((w.tags || []).find(t => t[0] === 'd') || [])[1] === d) };
}
const keysOf = (entries) => (entries || []).map(e => e.pubkey).sort();
const tombKeys = (ts) => (ts || []).map(t => t.pubkey).sort();

// ── 1. Remove prunes the sync doc AND writes a tombstone ────────────────────────────────────────────────
test('pressing Remove re-signs trinityone/relays WITHOUT the removed key AND tombstones that pubkey', async () => {
  const w = makeWorld({
    relays: [{ url: 'wss://a.example/relay', key: KEY_A, up: true }, { url: 'wss://b.example/relay', key: KEY_B, up: true }],
    net: [{ pubkey: KEY_A, url: 'https://a.example' }, { pubkey: KEY_B, url: 'https://b.example' }],
    sync: [{ pubkey: KEY_A, url: 'https://a.example' }, { pubkey: KEY_B, url: 'https://b.example' }],
  });
  const r = await w.api.unenrolRelayNet('wss://b.example/relay');
  assert.equal(r.removed, true, 'the box was not removed from admission: ' + JSON.stringify(r));
  assert.equal(r.syncClosed, true, 'the full-corpus SYNC TRUST was not closed — the removed key keeps pull rights on every peer (the A2 security gap): ' + JSON.stringify(r));
  assert.equal(r.tombstoned, true, 'no tombstone was written — another console\'s heal will re-add the box for ever: ' + JSON.stringify(r));
  assert.deepEqual(keysOf(w.sync()), [KEY_A],
    'THE REMOVED KEY IS STILL IN trinityone/relays — it still holds full-corpus pull rights: ' + JSON.stringify(w.sync()));
  assert.deepEqual(tombKeys(w.tombs()), [KEY_B], 'the removed box was not tombstoned: ' + JSON.stringify(w.tombs()));
  assert.ok((w.tombs().find(t => t.pubkey === KEY_B) || {}).at >= NOW, 'the tombstone `at` is not a real timestamp the reader can compare');
});

// ── 2. the Remove STICKS: a later heal does not re-add the removed box ───────────────────────────────────
test('after a Remove, a subsequent syncHeal does NOT re-add the removed key (the tombstone the writer left is honoured by the reader)', async () => {
  const w = makeWorld({
    relays: [{ url: 'wss://a.example/relay', key: KEY_A, up: true }, { url: 'wss://b.example/relay', key: KEY_B, up: true }],
    net: [{ pubkey: KEY_A, url: 'https://a.example' }, { pubkey: KEY_B, url: 'https://b.example' }],
    sync: [{ pubkey: KEY_A, url: 'https://a.example' }, { pubkey: KEY_B, url: 'https://b.example' }],
  });
  await w.api.unenrolRelayNet('wss://b.example/relay');
  assert.deepEqual(keysOf(w.sync()), [KEY_A], 'precondition: the Remove did not prune B');
  // B is still dialled and proves its key — but the tombstone this Remove wrote is newer than the pruned doc.
  const h = await w.api.syncHeal();
  assert.deepEqual(keysOf(w.sync()), [KEY_A],
    'THE REMOVED BOX CAME STRAIGHT BACK on the next heal — the Remove did not stick (audit finding 2): ' + JSON.stringify({ h, sync: w.sync() }));
});

// ── 3. a DEAD / seized box can still be removed and have its trust closed ────────────────────────────────
test('a dead box (cannot answer its identity probe) is still removed, pruned from sync and tombstoned, via the droppable/leaving rule', async () => {
  const dead = 'wss://b.example/relay';
  const w = makeWorld({
    relays: [{ url: 'wss://a.example/relay', key: KEY_A, up: true }, { url: dead, key: '', up: false }],
    net: [{ pubkey: KEY_A, url: 'https://a.example' }, { pubkey: KEY_B, url: dead }],   // a dead box: matched by the url the doc recorded, since no probe can prove its key
    sync: [{ pubkey: KEY_A, url: 'https://a.example' }, { pubkey: KEY_B, url: 'https://b.example' }],
    extra: [dead],   // the removed row is a church-added, now-unreachable address → droppable
  });
  const r = await w.api.unenrolRelayNet(dead);
  assert.equal(r.removed, true, 'a dead box could not be removed — the leaving/droppable rule is not applied: ' + JSON.stringify(r));
  assert.deepEqual(keysOf(w.sync()), [KEY_A],
    'a DEAD box kept its full-corpus sync trust because it could not answer — exactly the box most likely to be seized: ' + JSON.stringify(w.sync()));
  assert.deepEqual(tombKeys(w.tombs()), [KEY_B], 'the dead box was not tombstoned (its key is known from the row it dropped, not a probe): ' + JSON.stringify(w.tombs()));
});

// ── 4. a partial read reports the removal as partial and never signs a box-less view ─────────────────────
test('when the sync read cannot complete, the removal is PARTIAL and NO box-less trinityone/relays is signed', async () => {
  // A (non-droppable, in the docs) answers the two relay-net reads, then goes down before the sync read, so the
  // sync read can never be covered. Nothing may be re-signed over that incomplete view (the a8 regression).
  const w = makeWorld({
    relays: [{ url: 'wss://a.example/relay', key: KEY_A, up: true }, { url: 'wss://b.example/relay', key: KEY_B, up: true }],
    net: [{ pubkey: KEY_A, url: 'https://a.example' }, { pubkey: KEY_B, url: 'https://b.example' }],
    sync: [{ pubkey: KEY_A, url: 'https://a.example' }, { pubkey: KEY_B, url: 'https://b.example' }],
    dropAfterReads: 2, dropUrl: 'wss://a.example/relay',
  });
  const r = await w.api.unenrolRelayNet('wss://b.example/relay');
  assert.equal(r.syncPartial, true, 'a removal whose sync trust could not be closed did not report partial: ' + JSON.stringify(r));
  assert.equal(r.unknown, true, 'the partial removal did not use unenrol\'s existing honesty shape (dropOutcome reads `unknown`): ' + JSON.stringify(r));
  assert.notEqual(r.removed, true, 'a partial removal must not also claim it finished: ' + JSON.stringify(r));
  assert.equal(w.writesTo('trinityone/relays').length, 0,
    'A BOX-LESS / INCOMPLETE VIEW WAS SIGNED INTO trinityone/relays — the a8 shape, rebuilt: ' + JSON.stringify(w.sync()));
  assert.deepEqual(keysOf(w.sync()), [KEY_A, KEY_B].sort(), 'the sync doc was changed over an incomplete read');
});

// ── 5. the one un-tombstone path: a deliberate Add/Connect clears the tombstone so the box can be re-added ─
test('un-tombstone: clearing a pubkey from the tombstone lets a subsequent heal re-add the box', async () => {
  const w = makeWorld({
    relays: [{ url: 'wss://a.example/relay', key: KEY_A, up: true }, { url: 'wss://b.example/relay', key: KEY_B, up: true }],
    sync: [{ pubkey: KEY_A, url: 'https://a.example' }],
    tombs: [{ pubkey: KEY_B, at: NOW }],
  });
  // While B is tombstoned, a heal refuses to re-add it (the A1 reader).
  await w.api.syncHeal();
  assert.deepEqual(keysOf(w.sync()), [KEY_A],
    'precondition: a tombstoned box was added by heal — the A1 refusal is not in force: ' + JSON.stringify(w.sync()));
  // The deliberate Add/Connect clears B's tombstone (the engine signRelay's success path calls).
  const u = await w.api._writeTombstone({ remove: [KEY_B] });
  assert.equal(u.wrote, true, 'the un-tombstone did not clear the key: ' + JSON.stringify(u));
  assert.deepEqual(tombKeys(w.tombs()), [], 'the tombstone still names the box the steward just re-added');
  // Now a heal re-adds B, because it is no longer tombstoned.
  const h = await w.api.syncHeal();
  assert.equal(h.published, true, 'heal did not re-sign after the un-tombstone: ' + JSON.stringify(h));
  assert.deepEqual(keysOf(w.sync()), [KEY_A, KEY_B].sort(),
    'THE UN-TOMBSTONED BOX WAS NOT RE-ADDED — a steward can never re-add a box they once removed: ' + JSON.stringify(w.sync()));
});

// ── 6. a church that does NOT self-host (no sync doc) is left exactly as it was ──────────────────────────
test('removing a relay in a church with no sync doc writes neither a sync doc nor a tombstone — no new writes', async () => {
  const w = makeWorld({
    relays: [{ url: 'wss://a.example/relay', key: KEY_A, up: true }, { url: 'wss://b.example/relay', key: KEY_B, up: true }],
    net: [{ pubkey: KEY_A, url: 'https://a.example' }, { pubkey: KEY_B, url: 'https://b.example' }],
    sync: null,
  });
  const r = await w.api.unenrolRelayNet('wss://b.example/relay');
  assert.equal(r.removed, true, 'the box was not removed from admission: ' + JSON.stringify(r));
  assert.equal(r.syncClosed, false, 'a church with no sync trust reported closing some');
  assert.equal(w.writesTo('trinityone/relays').length, 0, 'an ordinary Remove started writing a sync doc for a non-self-hosting church');
  assert.equal(w.writesTo('trinityone/relays-removed').length, 0, 'an ordinary Remove started writing tombstones for a non-self-hosting church');
});
