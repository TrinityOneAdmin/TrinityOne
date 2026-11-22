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
const settle = () => new Promise(r => setImmediate(r));

const LIFT = [
  ['st', 'var RELAY_NET_D = '],
  ['st', 'var RELAYS_REMOVED_D = '],
  ['st', 'var TOMB_PENDING_LS = '],
  ['fn', 'function _syncRelayBase'],
  ['st', 'var _syncRelayKey = '],
  ['fn', 'function _isPrivateRelayBase(u) {'],
  ['fn', 'function parseRelayNet(content) {'],
  ['fn', 'function _readCovers'],
  ['fn', 'function lsGet(k) {'],
  ['fn', 'function lsSet(k, v) {'],
  ['fn', 'function _pendingTomb'],
  ['fn', 'function _setPendingTomb'],
  ['fn', 'function sharedRelayKeys'],
  ['fn', 'function _tombable(keys, never) {'],
  ['fn', 'async function _flushPendingTomb() {'],
  // A2 (2026-11-22): signRelay goes through the real _adoptRelay; its backfill is a scope stub answering "landed".
  ['st', 'var BACKFILL_OWED_LS = '], ['fn', 'function _owedBackfills() {'], ['fn', 'function _setOwedBackfill(cp, url, on) {'], ['st', 'var _removePressed = '], ['fn', 'async function _adoptRelay(u, opts) {'], ['fn', 'function _signedIn(r, u) {'],
  // FF1 in-flight (2026-11-22): the automatic adopt and the owed retry that calls it, real, so a Remove can race them.
  ['fn', 'function _adoptRelayAuto(u) {'], ['st', 'var BACKFILL_RETRY_MS = '], ['st', 'var _owedRetrying = '], ['st', 'var _owedRetryLastAt = '], ['fn', 'async function retryOwedBackfills(opts) {'],
  ['fn', 'async function _removedKeysRead(droppable) {'],
  ['fn', 'function _unprovedDroppable(provedUrls) {'],
  // BF3/BF1: the relay-prefs reader/writer and the chosen drop, real, so unsignRelay's two follow-ups run for real.
  ['st', 'var RELAYPREFS_D = '], ['st', 'var PUBLIC_TARGET_DEFAULT = '],
  ['fn', 'function _clampPublicTarget(n) {'], ['fn', 'function _communityCap(publicTarget) {'], ['fn', 'function _mergeChosen(a, b) {'],
  ['fn', 'async function _readRelayPrefs() {'], ['fn', 'async function _writeRelayPrefs(mutate) {'], ['fn', 'async function _dropChosen(url, keys) {'],
  ['fn', 'function relayNetDoc() {'],
  ['st', 'var _enrolQueue = '],
  ['fn', 'function enrolSerial'],
  ['fn', 'async function _writeTombstone(opts) {'],
  ['fn', 'async function _closeSyncTrust(opts) {'],
  ['fn', 'async function unenrolRelayNet(url) {'],
  ['fn', 'async function syncHeal() {'],
].map(([k, a]) => (k === 'fn' ? fnBody(BUNDLE, a, a) : stmt(BUNDLE, a, a))).join('\n');
// B0: the REAL trigger valve (autoSyncHeal), lifted only for the worlds that ask for it (cfg.realHeal) — every
// other world keeps the stub, because signRelay chains a heal those tests deliberately do not run.
const LIFT_HEAL = [stmt(BUNDLE, 'var _syncHealLastAt = ', '_syncHealLastAt'), fnBody(BUNDLE, 'async function autoSyncHeal(opts) {', 'autoSyncHeal')].join('\n');
const KEY_SHARED = 'f'.repeat(64);

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
  if (cfg.prefs) put({ kind: 30078, pubkey: PUB, created_at: NOW - 800, tags: [['d', 'trinityone/relayprefs']], content: JSON.stringify(cfg.prefs) });
  if (cfg.tombs) put({ kind: 30078, pubkey: cfg.tombAuthor || PUB, created_at: NOW - 900, tags: [['d', 'trinityone/relays-removed']], content: JSON.stringify(cfg.tombs) });
  const writes = [];
  let ids = 0, reads = 0, dropped = false;
  const byUrl = (u) => relays.find(r => r.url === u);
  const lsMap = new Map();
  const scope = {
    sk: new Uint8Array(32).fill(7), pub: PUB, actingChurch: '', _viewingNetwork: () => false,
    normalizeURL, normalizeURL2: normalizeURL,
    JSON, Math, Set, Map, Array, Object, String, Number, Promise, Error, Date,
    // The per-church pending-tombstone store (plan A2, FIX 2) is persisted via lsGet/lsSet; a Map-backed
    // localStorage stub lets the REAL lsGet/lsSet run, and it SURVIVES across two unenrolRelayNet calls on the
    // same world — exactly the reload-durable retry the fix depends on.
    localStorage: { getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null), setItem: (k, v) => { lsMap.set(k, String(v)); }, removeItem: (k) => { lsMap.delete(k); } },
    enrolRelayNet: cfg.enrol || (async () => ({ published: false, proven: [] })),
    _backfillSafeguardTo: async () => ({ landed: true, results: {} }),   // A2: run for real in an-adopted-relay-gets-the-safeguarding-documents.test.mjs
    _gate: { provedKey: () => '' },   // no cached proof: the automatic adopt resolves the box's key by a fresh verifyRelayIdentity (below)
    autoSyncHeal: async () => ({}),   // signRelay chains a forced heal; the heal itself is point-of-use tested in sync-list-heals-itself
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
      if (cfg.dropAfterReads && !dropped && reads > cfg.dropAfterReads && cfg.dropUrl) { dropped = true; const r = byUrl(cfg.dropUrl); if (r) { r.up = false; r.key = ''; } }
      const d = (filters[0]['#d'] || [])[0];
      const evs = (store.get(d) || []).slice().sort((x, y) => (y.created_at - x.created_at) || ((store.get(d) || []).indexOf(y) - (store.get(d) || []).indexOf(x)));
      const askedUrls = relays.map(r => r.url);
      // cfg.incompleteD: reads of THAT document never finish (a relay mid-login withholding a private doc), while every other read is whole.
      const withheld = !!cfg.incompleteD && cfg.incompleteD === d;
      const answeredUrls = withheld ? [] : relays.filter(r => r.up).map(r => r.url);
      return { ev: withheld ? null : (evs[0] || null), complete: answeredUrls.length > 0, asked: askedUrls.length, askedUrls, answeredUrls };
    },
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; throw new ReferenceError('the lifted A2 engine needs `' + String(k) + '` — add a stub'); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const api = new Function('scope', 'with (scope) {' + LIFT + (cfg.realHeal ? '\n' + LIFT_HEAL : '') +
    '\nreturn { unenrolRelayNet, syncHeal, _writeTombstone, _closeSyncTrust, enrolSerial, _pendingTomb, _setPendingTomb, _flushPendingTomb, _removedKeysRead, _owedBackfills, _setOwedBackfill, autoSyncHeal, retryOwedBackfills, ' +
    fnBody(BUNDLE, '  signRelay(url) {', 'signRelay in the shipped bundle') + ', ' +
    fnBody(BUNDLE, 'async syncEnable() {', 'syncEnable in the shipped bundle') + ', ' +
    fnBody(BUNDLE, '  unsignRelay(url) {', 'unsignRelay in the shipped bundle') + ', ' +
    fnBody(BUNDLE, 'async publishRelayList() {', 'publishRelayList in the shipped bundle') + ' }; }')(proxy);
  // B1: the console's own probe pass, as relayIdentities reports it — every relay this console LISTS, with the key it
  // proves right now ('' when it proves none). syncEnable signs from this snapshot.
  scope.window = { Steward: { signRelay: (...a) => api.signRelay(...a), publishRelayList: () => api.publishRelayList(), relayIdentities: async () => relays.map(r => ({ url: r.url, base: String(r.url).replace(/^wss:/, 'https:').replace(/\/relay$/, ''), pubkey: (r.up && r.key) || '', name: '', online: !!r.up })) } };
  // Read the NEWEST copy exactly as _oneComplete / the engine does: created_at desc, and on a tie the
  // LAST-written wins (insertion index) — a constant now() + identity _monotonic make every write in a test tie,
  // and breaking the tie any other way would let a later re-sign hide behind an earlier one (it masked a real
  // re-add during sabotage).
  const docOf = (d) => { const arr = store.get(d) || []; const a = arr.slice().sort((x, y) => (y.created_at - x.created_at) || (arr.indexOf(y) - arr.indexOf(x))); return a[0] ? JSON.parse(a[0].content) : null; };
  return { api, writes, scope, store, relays,
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

// ── 6. B0: a SYNC-OFF church (no sync doc — the DEFAULT church) still gets the tombstone ─────────────────
// REPLACES the old test 6, which pinned the opposite ("writes neither a sync doc nor a tombstone"). Sync-off is the
// default, so a Remove that recorded nothing there left every later syncEnable / heal / auto-join free to bring
// the box back (audit 2026-11-22, F1-F4). Still true, and still asserted: no SYNC doc is ever written for it.
test('B0: removing a relay in a church with NO sync doc (the default) DOES tombstone the removed key — and still writes no sync doc', async () => {
  const w = makeWorld({
    relays: [{ url: 'wss://a.example/relay', key: KEY_A, up: true }, { url: 'wss://b.example/relay', key: KEY_B, up: true }],
    net: [{ pubkey: KEY_A, url: 'https://a.example' }, { pubkey: KEY_B, url: 'https://b.example' }],
    sync: null,
  });
  const r = await w.api.unenrolRelayNet('wss://b.example/relay');
  assert.equal(r.removed, true, 'the box was not removed from admission: ' + JSON.stringify(r));
  assert.equal(r.syncClosed, false, 'a church with no sync trust reported closing some');
  assert.equal(w.writesTo('trinityone/relays').length, 0, 'an ordinary Remove started writing a sync doc for a sync-off church');
  assert.deepEqual(tombKeys(w.tombs()), [KEY_B],
    'A SYNC-OFF CHURCH GOT NO TOMBSTONE — the default church records no removal, so nothing can refuse the box later (B0): ' + JSON.stringify(w.tombs()));
  assert.equal(r.tombstoned, true, 'the result did not say the tombstone was written: ' + JSON.stringify(r));
  assert.deepEqual(r.removedKeys, [KEY_B], 'the result did not name the key it tombstoned (unsignRelay hands it to the chosen drop): ' + JSON.stringify(r));
  assert.deepEqual(w.api._pendingTomb(), [], 'the pending key was not cleared once its tombstone landed');
});

// ── 7. FIX 1: the un-tombstone (re-Add) is NOT frozen by one unreachable EXTRA relay ─────────────────────
test('FIX 1: a deliberate re-Add un-tombstones the box even while ONE church-added EXTRA relay is unreachable, and the chained heal re-signs it', async () => {
  const dead = 'wss://dead-extra.example/relay';
  const w = makeWorld({
    relays: [{ url: 'wss://x.example/relay', key: KEY_B, up: true }, { url: dead, key: '', up: false }],
    sync: [{ pubkey: KEY_A, url: 'https://a.example' }],
    tombs: [{ pubkey: KEY_B, at: NOW }],
    extra: [dead],   // the unreachable relay is a church-added extra → droppable, exactly as unenrol/_closeSyncTrust use it
    enrol: async () => ({ published: true, proven: [{ url: 'wss://x.example/relay', pubkey: KEY_B }] }),
  });
  await w.api.signRelay('wss://x.example/relay');
  await settle(); await settle(); await settle(); await settle();
  assert.deepEqual(tombKeys(w.tombs()), [],
    'ONE UNREACHABLE EXTRA FROZE THE UN-TOMBSTONE — the box the steward just re-Added is still tombstoned, so every later heal refuses it (FIX 1): ' + JSON.stringify(w.tombs()));
  // the tombstone is gone → a heal now RE-ADDS B (it was refused while tombstoned)
  const h = await w.api.syncHeal();
  assert.deepEqual(keysOf(w.sync()), [KEY_A, KEY_B].sort(),
    'the un-tombstoned box was not re-signed into trinityone/relays by the heal: ' + JSON.stringify({ h, sync: w.sync() }));
});

// ── 8. FIX 1 control: a NON-droppable unreachable relay still ABORTS the un-tombstone (no clobber) ───────
test('FIX 1 control: a NON-droppable unreachable relay keeps the un-tombstone PARTIAL and clobbers no other console\'s tombstone (the completeness protection is intact)', async () => {
  const deadCanon = 'wss://shared-pool.example/relay';
  const w = makeWorld({
    relays: [{ url: 'wss://x.example/relay', key: KEY_B, up: true }, { url: deadCanon, key: '', up: false }],
    sync: [{ pubkey: KEY_A, url: 'https://a.example' }],
    tombs: [{ pubkey: KEY_B, at: NOW }, { pubkey: KEY_C, at: NOW }],   // KEY_C stands for another console's tombstone that must NOT be lost
    canonical: [deadCanon],   // a shared/canonical address is NOT droppable — it must answer before any re-sign
    enrol: async () => ({ published: true, proven: [{ url: 'wss://x.example/relay', pubkey: KEY_B }] }),
  });
  await w.api.signRelay('wss://x.example/relay');
  await settle(); await settle(); await settle(); await settle();
  assert.deepEqual(tombKeys(w.tombs()), [KEY_B, KEY_C].sort(),
    'THE TOMBSTONE DOC WAS CLOBBERED over a read a non-droppable relay never answered — droppable was widened past the church-added extras and the a8/completeness protection lost: ' + JSON.stringify(w.tombs()));
  assert.equal(w.writesTo('trinityone/relays-removed').length, 0,
    'the un-tombstone re-signed the tombstone doc over an incomplete read');
});

// ── 9. FIX 2: a key pruned from the sync doc ALWAYS ends up tombstoned, even across a partial op + retry ──
test('FIX 2: a DEAD box removed mid-op (prune lands, tombstone read fails → partial) STILL ends up tombstoned on the retry — no un-tombstoned pruned key', async () => {
  const A = 'wss://a.example/relay', B = 'wss://b.example/relay', C = 'wss://bystander.example/relay';
  const w = makeWorld({
    relays: [{ url: A, key: KEY_A, up: true }, { url: B, key: '', up: false }, { url: C, key: '', up: true }],
    net: [{ pubkey: KEY_A, url: 'https://a.example' }, { pubkey: KEY_B, url: B }],   // B DEAD, listed by url; its key is known only from the row
    sync: [{ pubkey: KEY_A, url: 'https://a.example' }, { pubkey: KEY_B, url: 'https://b.example' }],
    extra: [B],   // B is a church-added, now-dead address → droppable, so the removal is not frozen by B itself
    dropAfterReads: 4, dropUrl: C,   // C (a non-droppable bystander) drops right after the sync read-back → the TOMBSTONE read cannot complete
  });
  // ── op 1: the prune lands, but the tombstone write cannot complete → the removal is reported PARTIAL
  const r1 = await w.api.unenrolRelayNet(B);
  assert.equal(r1.syncPartial, true, 'op1 did not report the removal as partial: ' + JSON.stringify(r1));
  assert.deepEqual(keysOf(w.sync()), [KEY_A], 'op1 did not actually prune B from the sync doc: ' + JSON.stringify(w.sync()));
  assert.equal(w.tombs(), null, 'op1 unexpectedly wrote a tombstone (the partial was staged wrong): ' + JSON.stringify(w.tombs()));
  assert.deepEqual(w.api._pendingTomb(), [KEY_B],
    'the pruned key was not persisted as pending — a retry would then have NOTHING to tombstone: ' + JSON.stringify(w.api._pendingTomb()));
  // ── op 2: the bystander answers again; the steward retries Remove on the now-DEAD, already-pruned box
  w.relays.find(r => r.url === C).up = true;
  const r2 = await w.api.unenrolRelayNet(B);
  assert.deepEqual(tombKeys(w.tombs()), [KEY_B],
    'THE PRUNED KEY WAS NEVER TOMBSTONED: on the retry B is gone from both relay-net and the sync doc, so removedKeys is empty and only the persisted pending key saves it — a peer console would re-add the removed box (FIX 2): ' + JSON.stringify({ r2, tombs: w.tombs() }));
  assert.deepEqual(w.api._pendingTomb(), [], 'the pending key was not cleared once its tombstone landed: ' + JSON.stringify(w.api._pendingTomb()));
});

// ── 10. B0: the EARLIER loss point — the prune read-back is incomplete, so _closeSyncTrust never runs ────
// (audit 2026-11-22, F2.) B is DEAD and listed by url. The prune is published, the read-back cannot complete, and
// unenrolRelayNet returns before the sync-close step. On the retry B is out of relay-net and proves no key.
const stageLostPrune = (extraCfg) => {
  const A = 'wss://a.example/relay', B = 'wss://b.example/relay', C = 'wss://bystander.example/relay';
  const w = makeWorld({
    relays: [{ url: A, key: KEY_A, up: true }, { url: B, key: '', up: false }, { url: C, key: '', up: true }],
    net: [{ pubkey: KEY_A, url: 'https://a.example' }, { pubkey: KEY_B, url: B }],
    sync: null,          // the DEFAULT church
    extra: [B],
    dropAfterReads: 1, dropUrl: C,   // C (non-droppable) drops after the first relay-net read → the prune READ-BACK is incomplete
    ...(extraCfg || {}),
  });
  return { w, A, B, C };
};
test('B0: a dead box whose PRUNE read-back was incomplete is persisted as pending and tombstoned on the retry Remove', async () => {
  const { w, B, C } = stageLostPrune();
  const r1 = await w.api.unenrolRelayNet(B);
  assert.equal(r1.unverified, true, 'op1 was not staged as an incomplete prune read-back: ' + JSON.stringify(r1));
  assert.equal(r1.syncPartial, undefined, 'op1 reached the sync-close step — the earlier loss point was not staged: ' + JSON.stringify(r1));
  assert.equal(w.tombs(), null, 'op1 unexpectedly wrote a tombstone');
  assert.deepEqual(w.api._pendingTomb(), [KEY_B],
    'THE KEY WAS NOT PERSISTED BEFORE THE PRUNE — on the retry the dead box is out of relay-net and proves nothing, so there is nothing left to tombstone (B0): ' + JSON.stringify(w.api._pendingTomb()));
  w.relays.find(r => r.url === C).up = true;
  const r2 = await w.api.unenrolRelayNet(B);
  assert.equal(r2.notListed, true, 'precondition: on the retry the box should already be out of relay-net: ' + JSON.stringify(r2));
  assert.deepEqual(tombKeys(w.tombs()), [KEY_B], 'the retry did not tombstone the dead box: ' + JSON.stringify({ r2, tombs: w.tombs() }));
  assert.deepEqual(w.api._pendingTomb(), [], 'the pending key was not cleared once its tombstone landed');
});

// ── 11. B0: the flush on the HEAL PASS — no second Remove needed ─────────────────────────────────────────
test('B0: a pending tombstone is flushed by the heal pass (the REAL autoSyncHeal), without the steward pressing Remove again', async () => {
  const { w, B, C } = stageLostPrune({ realHeal: true });
  await w.api.unenrolRelayNet(B);
  assert.deepEqual(w.api._pendingTomb(), [KEY_B], 'precondition: the key is pending');
  assert.equal(w.tombs(), null, 'precondition: no tombstone yet');
  w.relays.find(r => r.url === C).up = true;
  await w.api.autoSyncHeal({ force: true });
  assert.deepEqual(tombKeys(w.tombs()), [KEY_B],
    'THE HEAL PASS DID NOT FLUSH THE PENDING TOMBSTONE — it would wait for a Remove nobody has a reason to press (B0): ' + JSON.stringify(w.tombs()));
  assert.deepEqual(w.api._pendingTomb(), [], 'the pending key was not cleared once its tombstone landed');
});

// ── 12. B0: a SHARED relay key is never tombstoned ───────────────────────────────────────────────────────
test('B0: removing a church-added ALIAS of a shared relay takes the row out but does NOT tombstone the shared key', async () => {
  const SHARED = 'wss://shared-pool.example/relay', ALIAS = 'wss://alias.example/relay';
  const w = makeWorld({
    relays: [{ url: SHARED, key: KEY_SHARED, up: true }, { url: ALIAS, key: KEY_SHARED, up: true }, { url: 'wss://a.example/relay', key: KEY_A, up: true }],
    net: [{ pubkey: KEY_A, url: 'https://a.example' }, { pubkey: KEY_SHARED, url: ALIAS }],
    sync: null, canonical: [SHARED], extra: [ALIAS],
  });
  const r = await w.api.unenrolRelayNet(ALIAS);
  assert.equal(r.removed, true, 'the alias row was not removed: ' + JSON.stringify(r));
  assert.deepEqual(r.removedKeys, [], 'the result named a shared key as tombstoned: ' + JSON.stringify(r));
  assert.equal(w.writesTo('trinityone/relays-removed').length, 0,
    'A SHARED RELAY KEY WAS TOMBSTONED — every console would then refuse the shared relay at all its addresses: ' + JSON.stringify(w.tombs()));
  assert.deepEqual(w.api._pendingTomb(), [], 'a shared key was left in the pending-tombstone set');
});

// ── 13. B0: the console's OWN box is never tombstoned (the not-listed path, where the admission step's own-box check never ran)
test('B0: removing an address that proves the OWN box\'s key, which the list does not name, tombstones nothing', async () => {
  const OWN = 'wss://own.example/relay', ALIAS = 'wss://own-alias.example/relay';
  const w = makeWorld({
    relays: [{ url: OWN, key: KEY_A, up: true }, { url: ALIAS, key: KEY_A, up: true }, { url: 'wss://b.example/relay', key: KEY_B, up: true }],
    net: [{ pubkey: KEY_B, url: 'https://b.example' }],
    sync: null, own: OWN, extra: [ALIAS],
  });
  const r = await w.api.unenrolRelayNet(ALIAS);
  assert.equal(r.notListed, true, 'precondition: the address is not in the list: ' + JSON.stringify(r));
  assert.equal(w.writesTo('trinityone/relays-removed').length, 0,
    'THE OWN BOX\'S KEY WAS TOMBSTONED through an alias the list did not name: ' + JSON.stringify(w.tombs()));
  assert.deepEqual(w.api._pendingTomb(), [], 'the own key was left in the pending-tombstone set');
});

// ── 14. B0: own box cannot say which key is its own → the tombstone is HELD, then lands once it can ──────
test('B0: while the OWN box cannot prove its key the tombstone is held (partial, key pending); the flush writes it once the own box proves', async () => {
  const OWN = 'wss://own.example/relay', B = 'wss://b.example/relay';
  const w = makeWorld({
    relays: [{ url: OWN, key: '', up: true }, { url: B, key: '', up: false }],   // OWN answers reads but proves no key
    net: [{ pubkey: KEY_B, url: B }],
    sync: null, own: OWN, extra: [B],
  });
  const r = await w.api.unenrolRelayNet(B);
  assert.equal(r.syncPartial, true, 'a removal whose tombstone was held did not read partial: ' + JSON.stringify(r));
  assert.equal(w.writesTo('trinityone/relays-removed').length, 0, 'a tombstone was written while the own box\'s key was unknown');
  assert.deepEqual(w.api._pendingTomb(), [KEY_B], 'the held key was not persisted');
  w.relays.find(x => x.url === OWN).key = KEY_A;   // the own box proves its key again
  const f = await w.api._flushPendingTomb();
  assert.equal(f.flushed, true, 'the flush did not run: ' + JSON.stringify(f));
  assert.deepEqual(tombKeys(w.tombs()), [KEY_B], 'the held tombstone never landed: ' + JSON.stringify(w.tombs()));
  assert.deepEqual(w.api._pendingTomb(), [], 'the pending key was not cleared');
});

// ── 15. B0: an own-box refusal inside the repair loop withdraws what this press persisted ────────────────
test('B0: a Remove refused as the OWN box in the repair loop leaves nothing pending and writes no tombstone', async () => {
  const OWN = 'wss://own.example/relay', B = 'wss://b.example/relay';
  const w = makeWorld({
    relays: [{ url: OWN, key: KEY_A, up: true }, { url: B, key: KEY_B, up: true }],
    net: [{ pubkey: KEY_B, url: B }],
    sync: null, own: OWN,
  });
  // Another console signs, at the same moment, a newer list that names the OWN box's key under the address being removed.
  const realPublish = w.scope.publish;
  let pendingAtPublish = null;
  w.scope.publish = async (ev) => {
    const out = await realPublish(ev);
    if (((ev.tags || []).find(t => t[0] === 'd') || [])[1] === 'trinityone/relay-net') {
      pendingAtPublish = w.api._pendingTomb();
      const a = w.store.get('trinityone/relay-net');
      a.push({ kind: 30078, pubkey: PUB, created_at: ev.created_at, tags: [['d', 'trinityone/relay-net']], content: JSON.stringify([{ pubkey: KEY_A, url: B }]) });
    }
    return out;
  };
  const r = await w.api.unenrolRelayNet(B);
  assert.equal(r.ownBox, true, 'precondition: the repair loop did not refuse as the own box: ' + JSON.stringify(r));
  assert.deepEqual(pendingAtPublish, [KEY_B], 'precondition: the key was not persisted before the prune publish');
  assert.deepEqual(w.api._pendingTomb(), [], 'a REFUSED Remove left its key pending — the next heal pass would tombstone a box the steward was told stays');
  assert.equal(w.writesTo('trinityone/relays-removed').length, 0, 'a refused Remove wrote a tombstone');
});

// ── B1 (audit 2026-11-22, F1): syncEnable does not sign a Removed box back in ────────────────────────────
// The REAL syncEnable, the REAL _removedKeysRead and _unprovedDroppable. The console still LISTS the removed box
// (a second owner console, or a browser that never saw the Remove) and the box still proves its key.
const THREE = () => [{ url: 'wss://a.example/relay', key: KEY_A, up: true }, { url: 'wss://b.example/relay', key: KEY_B, up: true }, { url: 'wss://c.example/relay', key: KEY_C, up: true }];
test('B1: syncEnable on a console still listing a TOMBSTONED box signs the list WITHOUT it (and with it when nothing is tombstoned)', async () => {
  const control = makeWorld({ relays: THREE(), sync: null });
  const rc = await control.api.syncEnable();
  assert.deepEqual(keysOf(control.sync()), [KEY_A, KEY_B, KEY_C].sort(), 'CONTROL: with no tombstone all three proved boxes should be signed');
  assert.equal(rc.relays, 3);
  const w = makeWorld({ relays: THREE(), sync: null, tombs: [{ pubkey: KEY_B, at: NOW - 500 }] });
  const r = await w.api.syncEnable();
  assert.deepEqual(keysOf(w.sync()), [KEY_A, KEY_C].sort(),
    'A REMOVED BOX WAS SIGNED BACK INTO trinityone/relays by turning sync on — it holds full-corpus pull rights again, and the new doc out-stamps its tombstone so no heal prunes it (F1): ' + JSON.stringify(w.sync()));
  assert.equal(r.relays, 2, 'the result counted the removed box');
});

test('B1: the whole door, default church — Remove a box (sync off), then turn sync on from a console that still lists it', async () => {
  const w = makeWorld({ relays: THREE(), net: [{ pubkey: KEY_A, url: 'https://a.example' }, { pubkey: KEY_B, url: 'https://b.example' }, { pubkey: KEY_C, url: 'https://c.example' }], sync: null });
  const rm = await w.api.unenrolRelayNet('wss://b.example/relay');
  assert.equal(rm.removed, true, 'precondition: the Remove did not land: ' + JSON.stringify(rm));
  await w.api.syncEnable();
  assert.deepEqual(keysOf(w.sync()), [KEY_A, KEY_C].sort(), 'the box Removed while sync was off came back when sync was switched on: ' + JSON.stringify(w.sync()));
});

test('B1: a key still PENDING (its tombstone has not landed) is excluded too', async () => {
  const w = makeWorld({ relays: THREE(), sync: null });
  w.api._setPendingTomb([KEY_B]);
  await w.api.syncEnable();
  assert.deepEqual(keysOf(w.sync()), [KEY_A, KEY_C].sort(), 'a box whose Remove is still pending on this console was signed into the sync list: ' + JSON.stringify(w.sync()));
});

test('B1: when the removed box was one of only two, syncEnable refuses rather than sign it', async () => {
  const w = makeWorld({ relays: THREE().slice(0, 2), sync: null, tombs: [{ pubkey: KEY_B, at: NOW - 500 }] });
  await assert.rejects(() => w.api.syncEnable(), /removed does not count/, 'a two-box church whose second box was Removed still switched sync on');
  assert.equal(w.writesTo('trinityone/relays').length, 0, 'a sync doc was signed although fewer than two boxes remain');
});

test('B1: an INCOMPLETE tombstone read refuses to enable (fail closed) and signs nothing', async () => {
  const deadCanon = 'wss://shared-pool.example/relay';
  const w = makeWorld({ relays: [...THREE(), { url: deadCanon, key: '', up: false }], sync: null, canonical: [deadCanon] });
  await assert.rejects(() => w.api.syncEnable(), /could not be checked/,
    'SYNC WAS SWITCHED ON WITHOUT KNOWING WHICH RELAYS WERE REMOVED — a relay that may hold the tombstones never answered');
  assert.equal(w.writesTo('trinityone/relays').length, 0, 'a sync doc was signed over an incomplete tombstone read');
});

test('B1: one DEAD church-added row does not block the switch (the droppable rule) — and the tombstone is still honoured', async () => {
  const dead = 'wss://old-tunnel.example/relay';
  const w = makeWorld({ relays: [...THREE(), { url: dead, key: '', up: false }], sync: null, extra: [dead], tombs: [{ pubkey: KEY_B, at: NOW - 500 }] });
  const r = await w.api.syncEnable();
  assert.equal(r.relays, 2, 'a dead old-tunnel row blocked turning sync on: ' + JSON.stringify(r));
  assert.deepEqual(keysOf(w.sync()), [KEY_A, KEY_C].sort());
});

// ── B2 (audit 2026-11-22, F3): a deliberate Add un-tombstones ONLY the address being added ───────────────
// The REAL signRelay over the REAL _writeTombstone. The enrol it runs proves every box this console can — the
// box SERVING the console as well as the relay being added — and it used to clear the tombstone of all of them.
test('B2: signRelay(another relay) clears THAT relay\'s tombstone and leaves the own box\'s tombstone intact', async () => {
  const OWN = 'wss://own.example/relay', X = 'wss://x.example/relay';
  const w = makeWorld({
    relays: [{ url: OWN, key: KEY_A, up: true }, { url: X, key: KEY_B, up: true }],
    sync: null, own: OWN,
    tombs: [{ pubkey: KEY_A, at: NOW }, { pubkey: KEY_B, at: NOW }],   // another console Removed this console's box (KEY_A); X was Removed too
    enrol: async () => ({ published: true, proven: [{ url: OWN, pubkey: KEY_A }, { url: X, pubkey: KEY_B }] }),
  });
  await w.api.signRelay(X);
  await settle(); await settle(); await settle(); await settle();
  assert.deepEqual(tombKeys(w.tombs()), [KEY_A],
    'ADDING ONE RELAY CLEARED ANOTHER BOX\'S TOMBSTONE — the box another console Removed is free to be re-trusted by the next heal (F3): ' + JSON.stringify(w.tombs()));
});

test('B2: signRelay never clears a SHARED relay key\'s tombstone, even when the added address proves it', async () => {
  const SHARED = 'wss://shared-pool.example/relay', ALIAS = 'wss://alias.example/relay';
  const w = makeWorld({
    relays: [{ url: SHARED, key: KEY_SHARED, up: true }, { url: ALIAS, key: KEY_SHARED, up: true }],
    sync: null, canonical: [SHARED],
    tombs: [{ pubkey: KEY_SHARED, at: NOW }, { pubkey: KEY_C, at: NOW }],
    enrol: async () => ({ published: true, proven: [{ url: ALIAS, pubkey: KEY_SHARED, shared: true }] }),
  });
  await w.api.signRelay(ALIAS);
  await settle(); await settle(); await settle(); await settle();
  assert.equal(w.writesTo('trinityone/relays-removed').length, 0, 'the tombstone doc was re-signed for a shared relay key: ' + JSON.stringify(w.tombs()));
  assert.deepEqual(tombKeys(w.tombs()), [KEY_C, KEY_SHARED].sort());
});

// ── BF2 (Part B audit): this console's OWN heal must not re-add a box whose Remove is still pending ──────
// Reached like this: the own box cannot prove its key, so the Remove's tombstone is HELD (B0) — pruned from the
// sync doc, key pending, no tombstone. Then the removed box comes back and proves its key. The REAL syncHeal, called
// directly (not through autoSyncHeal, whose flush would hide the gap).
test('BF2: a key held PENDING is not re-added by a direct syncHeal when its box proves again (control: with nothing pending it is added)', async () => {
  const OWN = 'wss://own.example/relay', A = 'wss://a.example/relay', B = 'wss://b.example/relay';
  const mk = () => makeWorld({
    relays: [{ url: OWN, key: '', up: true }, { url: A, key: KEY_A, up: true }, { url: B, key: '', up: false }],
    net: [{ pubkey: KEY_A, url: 'https://a.example' }, { pubkey: KEY_B, url: B }],
    sync: [{ pubkey: KEY_A, url: 'https://a.example' }, { pubkey: KEY_C, url: 'https://c.example' }, { pubkey: KEY_B, url: 'https://b.example' }],
    own: OWN, extra: [B],
  });
  const w = mk();
  const r = await w.api.unenrolRelayNet(B);
  assert.equal(r.syncPartial, true, 'precondition: the tombstone was not held: ' + JSON.stringify(r));
  assert.deepEqual(keysOf(w.sync()), [KEY_A, KEY_C].sort(), 'precondition: the prune did not land');
  assert.deepEqual(w.api._pendingTomb(), [KEY_B], 'precondition: the key is not pending');
  assert.equal(w.tombs(), null, 'precondition: a tombstone exists, so this would not be testing the pending set');
  const b = w.relays.find(x => x.url === B); b.up = true; b.key = KEY_B;   // the removed box is back and proves its key
  await w.api.syncHeal();
  assert.deepEqual(keysOf(w.sync()), [KEY_A, KEY_C].sort(),
    'THIS CONSOLE\'S OWN HEAL RE-ADDED THE BOX IT HAD JUST REMOVED — the pending set is not consulted on syncHeal\'s add path (BF2): ' + JSON.stringify(w.sync()));
  // CONTROL: the same world with the pending set emptied — the heal DOES add the proving box, so the refusal above is the pending set's doing.
  const c = mk();
  await c.api.unenrolRelayNet(B);
  c.api._setPendingTomb([]);
  const cb = c.relays.find(x => x.url === B); cb.up = true; cb.key = KEY_B;
  await c.api.syncHeal();
  assert.deepEqual(keysOf(c.sync()), [KEY_A, KEY_B, KEY_C].sort(), 'CONTROL: with nothing pending and no tombstone the heal should add the proving box');
});

// ── BF3 (Part B audit): the member-facing kind-10002 is republished when the relay-net prune LANDED ──────
// …even though the sync-tombstone step was partial and the steward is told "remove it again". The REAL unsignRelay,
// unenrolRelayNet and publishRelayList. Default church (no sync doc); the tombstone doc cannot be read (a relay
// mid-login withholds it), every other read is whole.
test('BF3: a Remove whose tombstone step is PARTIAL still republishes a kind-10002 that omits the box', async () => {
  const A = 'wss://a.example/relay', B = 'wss://b.example/relay';
  const w = makeWorld({
    relays: [{ url: A, key: KEY_A, up: true }, { url: B, key: KEY_B, up: true }],
    net: [{ pubkey: KEY_A, url: A }, { pubkey: KEY_B, url: B }],
    sync: null, incompleteD: 'trinityone/relays-removed',
  });
  const r = await w.api.unsignRelay(B);
  await settle(); await settle(); await settle(); await settle();
  assert.equal(r.syncPartial, true, 'precondition: the tombstone step was not partial: ' + JSON.stringify(r));
  assert.notEqual(r.removed, true, 'precondition: a partial removal must not claim it finished');
  assert.equal(r.pruned, true, 'the result does not say the relay-net prune landed: ' + JSON.stringify(r));
  const lists = w.writes.filter(e => e.kind === 10002);
  assert.equal(lists.length, 1,
    'NO kind-10002 WAS REPUBLISHED — member phones keep routing to the Removed relay until some other change (BF3): ' + JSON.stringify(w.writes.map(e => e.kind)));
  assert.deepEqual(lists[0].tags.filter(t => t[0] === 'r').map(t => t[1]), [A], 'the republished list still names the Removed relay, or dropped the one that stays');
});

test('BF3: a Remove that did NOT prune (the list could not be read) republishes nothing', async () => {
  const A = 'wss://a.example/relay', B = 'wss://b.example/relay';
  const w = makeWorld({
    relays: [{ url: A, key: KEY_A, up: false }, { url: B, key: KEY_B, up: true }],   // A (non-droppable) is silent → relay-net read incomplete
    net: [{ pubkey: KEY_A, url: A }, { pubkey: KEY_B, url: B }], sync: null,
  });
  const r = await w.api.unsignRelay(B);
  await settle(); await settle(); await settle(); await settle();
  assert.equal(r.unknown, true);
  assert.notEqual(r.pruned, true);
  assert.equal(w.writes.filter(e => e.kind === 10002).length, 0, 'a kind-10002 was published although nothing was pruned');
});

// ── BF1 (Part B audit): a dead box known ONLY through `chosen` keeps a church-wide guard ─────────────────
// The community auto-join recorded X in relayprefs `chosen` as { pubkey, url }. X is now DEAD and no longer in
// relay-net, so a Remove proves no key and drops no row. The REAL unsignRelay -> unenrolRelayNet -> _closeSyncTrust
// -> _writeTombstone, then the REAL _dropChosen over the real prefs reader/writer.
const prefsOf = (w) => { const a = w.store.get('trinityone/relayprefs') || []; const e = a.slice().sort((x, y) => (y.created_at - x.created_at) || (a.indexOf(y) - a.indexOf(x)))[0]; return e ? JSON.parse(e.content) : null; };
const settleLong = async () => { for (let i = 0; i < 40; i++) await settle(); };
const chosenOnly = (extraCfg) => {
  const A = 'wss://a.example/relay', X = 'wss://x-community.example/relay';
  const w = makeWorld({
    relays: [{ url: A, key: KEY_A, up: true }, { url: X, key: '', up: false }],
    net: [{ pubkey: KEY_A, url: A }],     // X is NOT in relay-net
    sync: null, extra: [X],
    prefs: { publicAuto: true, publicTarget: 5, chosen: [{ pubkey: KEY_B, url: X, name: 'x' }, { pubkey: KEY_C, url: 'wss://c.example/relay', name: 'c' }] },
    ...(extraCfg || {}),
  });
  return { w, A, X };
};
test('BF1: Removing a box that is only in `chosen` and proves no key TOMBSTONES the key chosen recorded, and only then drops the entry', async () => {
  // X ANSWERS reads but proves no key (the box at that address is no longer ours to prove), so the only place its key is known is `chosen`.
  const { w, X } = chosenOnly({ relays: [{ url: 'wss://a.example/relay', key: KEY_A, up: true }, { url: 'wss://x-community.example/relay', key: '', up: true }] });
  const realPublish = w.scope.publish;
  let tombsWhenPrefsWritten = 'never-written';
  w.scope.publish = async (ev, o) => { if (((ev.tags || []).find(t => t[0] === 'd') || [])[1] === 'trinityone/relayprefs') tombsWhenPrefsWritten = tombKeys(w.tombs()); return realPublish(ev, o); };
  const r = await w.api.unsignRelay(X);
  await settleLong();
  assert.equal(r.notListed, true, 'precondition: X should not be in the church\'s relay-net: ' + JSON.stringify(r));
  assert.deepEqual(tombKeys(w.tombs()), [KEY_B],
    'A BOX KNOWN ONLY THROUGH `chosen` GOT NO TOMBSTONE — once its chosen entry goes, nothing church-wide stops it being auto-adopted again (BF1): ' + JSON.stringify(w.tombs()));
  assert.deepEqual(r.removedKeys, [KEY_B]);
  assert.deepEqual((prefsOf(w).chosen || []).map(c => c.pubkey), [KEY_C], 'the Removed box is still in `chosen` (its cap slot was not freed), or the other entry was lost: ' + JSON.stringify(prefsOf(w)));
  assert.deepEqual(tombsWhenPrefsWritten, [KEY_B], 'the chosen entry was dropped BEFORE its tombstone existed: ' + JSON.stringify(tombsWhenPrefsWritten));
  // What every console's syncEnable and community auto-join read before putting a box back: the church's doc, not
  // this console's memory (the pending set is empty, so the key below can only have come from the document).
  assert.deepEqual(w.api._pendingTomb(), []);
  const gone = await w.api._removedKeysRead(new Set());
  assert.equal(gone.complete, true);
  assert.ok(gone.keys.has(KEY_B), 'the removed-keys read another console makes does not name the box');
});

test('BF1: the same for a DEAD box (it answers nothing) — its key is tombstoned from `chosen`; the entry is never gone without the tombstone', async () => {
  const { w, X } = chosenOnly();
  const r = await w.api.unsignRelay(X);
  await settleLong();
  assert.equal(r.notListed, true, JSON.stringify(r));
  assert.deepEqual(tombKeys(w.tombs()), [KEY_B], 'a DEAD box known only through `chosen` got no tombstone (BF1): ' + JSON.stringify(w.tombs()));
  const gone = await w.api._removedKeysRead(new Set([X]));
  assert.equal(gone.complete, true);
  assert.ok(gone.keys.has(KEY_B));
  // NOT asserted: that the entry has left `chosen`. While the dead address is still in this console's list the prefs
  // writer's own read cannot complete, so the entry may stay (a cap slot, not a safety gap). Either way the tombstone is there.
});

test('BF1: when the prefs cannot be read, nothing is tombstoned for the dead chosen-only box AND its chosen entry is kept (the guard stays)', async () => {
  const { w, X } = chosenOnly({ incompleteD: 'trinityone/relayprefs' });
  const r = await w.api.unsignRelay(X);
  await settleLong();
  assert.equal(r.notListed, true, JSON.stringify(r));
  assert.deepEqual(r.removedKeys, []);
  assert.equal(w.writesTo('trinityone/relayprefs').length, 0, 'THE chosen ENTRY WAS DROPPED WITH NO TOMBSTONE IN ITS PLACE: ' + JSON.stringify(prefsOf(w)));
  assert.deepEqual(prefsOf(w).chosen.map(c => c.pubkey), [KEY_B, KEY_C]);
});

test('BF1: a chosen entry at the removed address that carries a SHARED relay key is neither tombstoned nor dropped', async () => {
  const SHARED = 'wss://shared-pool.example/relay';
  const { w, X } = chosenOnly({ canonical: [SHARED],
    relays: [{ url: 'wss://a.example/relay', key: KEY_A, up: true }, { url: 'wss://x-community.example/relay', key: '', up: false }, { url: SHARED, key: KEY_SHARED, up: true }],
    prefs: { publicAuto: true, publicTarget: 5, chosen: [{ pubkey: KEY_SHARED, url: 'wss://x-community.example/relay', name: 'x' }] } });
  const r = await w.api.unsignRelay(X);
  await settleLong();
  assert.equal(r.notListed, true, JSON.stringify(r));
  assert.equal(w.writesTo('trinityone/relays-removed').length, 0, 'a shared relay key was tombstoned through `chosen`');
  assert.equal(w.writesTo('trinityone/relayprefs').length, 0, 'the entry was dropped although nothing was tombstoned');
});

// ── BF4 (Part B audit, rule 4): two comment claims that no test proved ───────────────────────────────────
// 1. "the address IS the own box → no tombstone at all" (skipTomb). The own KEY is excluded separately (`never`), so
//    this only shows where a DIFFERENT key sits at the own box's address — here a stale sync entry recorded under it.
test('BF4: removing the OWN box\'s address tombstones NOTHING — not even another key the sync doc records at that address', async () => {
  const OWN = 'wss://own.example/relay', B = 'wss://b.example/relay';
  const w = makeWorld({
    relays: [{ url: OWN, key: KEY_A, up: true }, { url: B, key: KEY_B, up: true }],
    net: [{ pubkey: KEY_B, url: B }],                                                  // the list does not name the own box
    sync: [{ pubkey: KEY_C, url: 'https://own.example' }, { pubkey: KEY_B, url: 'https://b.example' }],   // KEY_C: an older key recorded at the own address
    own: OWN,
  });
  const r = await w.api.unenrolRelayNet(OWN);
  assert.equal(r.notListed, true, 'precondition: the own address is not in relay-net, so the admission step\'s own-box refusal did not run: ' + JSON.stringify(r));
  assert.equal(w.writesTo('trinityone/relays-removed').length, 0,
    'A KEY RECORDED AT THE OWN BOX\'S ADDRESS WAS TOMBSTONED by removing that address: ' + JSON.stringify(w.tombs()));
  assert.deepEqual(w.api._pendingTomb(), [], 'a key at the own box\'s address was left pending');
});

// 2. _unprovedDroppable: "never the own box". The own box is listed, proves nothing and answers nothing; it must still
//    be REQUIRED to answer before sync is switched on (it may hold the tombstones).
test('BF4: syncEnable does not excuse the OWN box from the tombstone read when it is the one not answering', async () => {
  const OWN = 'wss://own.example/relay';
  const w = makeWorld({ relays: [...THREE(), { url: OWN, key: '', up: false }], sync: null, own: OWN });
  await assert.rejects(() => w.api.syncEnable(), /could not be checked/,
    'THE OWN BOX WAS TREATED AS DROPPABLE — sync was switched on without hearing from the box most likely to hold the church\'s tombstones');
  assert.equal(w.writesTo('trinityone/relays').length, 0);
});

// ── FF1 (final combined audit): pressing Remove ends any OWED state for that address ──────────────────────
// The REAL unsignRelay and owed-marker store. An owed marker is "the steward consented to connect this box and its
// documents have not landed"; the owed retry acts on it with no further click.
test('FF1: Remove clears the owed marker for that address — also when the Remove itself could not finish — and leaves another address\'s marker alone', async () => {
  const A = 'wss://a.example/relay', B = 'wss://b.example/relay', C = 'wss://c.example/relay';
  const mk = (extra) => { const w = makeWorld({ relays: [{ url: A, key: KEY_A, up: true }, { url: B, key: KEY_B, up: true }],
    net: [{ pubkey: KEY_A, url: A }, { pubkey: KEY_B, url: B }], sync: null, ...(extra || {}) });
    w.api._setOwedBackfill(PUB, B, true); w.api._setOwedBackfill(PUB, C, true); return w; };
  const done = mk();
  const r = await done.api.unsignRelay(B);
  assert.equal(r.removed, true, 'precondition: the Remove did not land: ' + JSON.stringify(r));
  assert.deepEqual(done.api._owedBackfills().map(e => e.url), [C],
    'A REMOVED RELAY IS STILL MARKED OWED — the retry would prove it, sign it back in and clear its tombstone with nobody pressing anything (FF1)');
  const stuck = mk({ relays: [{ url: A, key: KEY_A, up: false }, { url: B, key: KEY_B, up: true }] });   // A silent → the Remove cannot read the list
  const r2 = await stuck.api.unsignRelay(B);
  assert.equal(r2.unknown, true, 'precondition: this Remove should not have been able to finish: ' + JSON.stringify(r2));
  assert.deepEqual(stuck.api._owedBackfills().map(e => e.url), [C], 'a Remove that could not finish left the box owed');
});

// ── FF1 IN-FLIGHT (PLAN-FIX-FF1-2026-11-22): the steward presses Remove on THIS console while the owed retry is
// adopting that same box ───────────────────────────────────────────────────────────────────────────────────────
// The REAL retryOwedBackfills -> _adoptRelayAuto -> _adoptRelay, racing the REAL Steward.unsignRelay ->
// unenrolRelayNet -> _closeSyncTrust -> _writeTombstone, through the one real signing queue. X is an owed box: on
// this console's list, proving KEY_B, not yet in the church's relay-net. The signing step (enrolRelayNet) is the spy.
function owedRaceWorld(hooks = {}, cfg = {}) {
  const OWN = 'wss://own.example/relay', X = 'wss://x.example/relay';
  const enrols = [];
  const w = makeWorld({
    relays: [{ url: OWN, key: KEY_A, up: true }, { url: X, key: KEY_B, up: true }],
    net: [{ pubkey: KEY_A, url: OWN }], sync: null, own: OWN, extra: [X],
    enrol: async (o) => { enrols.push(o); if (hooks.onEnrol) hooks.onEnrol(w, X); return { published: true, full: true, proven: [{ url: X, pubkey: KEY_B }], entries: [{ pubkey: KEY_A, url: OWN }, { pubkey: KEY_B, url: X }] }; },
    ...cfg,
  });
  w.scope._backfillSafeguardTo = async () => { if (hooks.onBackfill) hooks.onBackfill(w, X); return { landed: hooks.landed !== false, results: {} }; };
  w.api._setOwedBackfill(PUB, X, true);
  return Object.assign(w, { enrols, X });
}
const drain = async () => { for (let i = 0; i < 40; i++) await settle(); };
test('FF1 in-flight POINT OF USE: Remove pressed on this console WHILE the owed retry is sending the box its documents — the retry does not sign it, and the Remove\'s tombstone stands (control: no Remove, it is signed)', async () => {
  const control = owedRaceWorld();
  await control.api.retryOwedBackfills();
  await drain();
  assert.equal(control.enrols.length, 1, 'CONTROL: with no Remove the owed box should be signed');
  assert.deepEqual(control.api._owedBackfills(), []);

  let removing = null;
  const w = owedRaceWorld({ onBackfill: (x, X) => { removing = x.api.unsignRelay(X); } });
  await w.api.retryOwedBackfills();
  const rm = await removing;
  await drain();
  assert.equal(rm && rm.notListed, true, 're-anchor: the Remove did not run as a not-yet-signed removal: ' + JSON.stringify(rm));
  assert.equal(rm.tombstoned, true, 're-anchor: the Remove wrote no tombstone, so there is nothing for the retry to honour: ' + JSON.stringify(rm));
  assert.equal(w.enrols.length, 0,
    'THE OWED RETRY SIGNED A BOX THE STEWARD HAD JUST REMOVED ON THIS VERY CONSOLE — the Remove was queued ahead of the signing and the signing did not look (FF1 in-flight)');
  assert.deepEqual(tombKeys(w.tombs()), [KEY_B], 'THE REMOVE\'S TOMBSTONE WAS ERASED BY THE RETRY: ' + JSON.stringify(w.tombs()));
  assert.equal(w.writesTo('trinityone/relays-removed').length, 1, 'the removed-keys document was re-signed after the Remove wrote it: ' + JSON.stringify(w.writesTo('trinityone/relays-removed').map(e => e.content)));
  assert.deepEqual(w.api._owedBackfills(), [], 'the removed box was left owed — the next pass tries it again');
});

test('FF1 in-flight: Remove pressed WHILE the retry\'s signing step is running — the Remove runs after it in the queue, and nothing un-tombstones the box afterwards', async () => {
  let removing = null;
  const w = owedRaceWorld({ onEnrol: (x, X) => { removing = x.api.unsignRelay(X); } });
  await w.api.retryOwedBackfills();
  const rm = await removing;
  await drain();
  assert.equal(w.enrols.length, 1, 're-anchor: the signing step was not reached, so the Remove was never pressed');
  assert.equal(rm && rm.tombstoned, true, 're-anchor: the Remove wrote no tombstone: ' + JSON.stringify(rm));
  assert.deepEqual(tombKeys(w.tombs()), [KEY_B],
    'A REMOVE PRESSED DURING AN AUTOMATIC SIGNING HAD ITS TOMBSTONE CLEARED BY THAT PASS\'S FOLLOW-UP — the steward removed the box and the console quietly re-trusted it: ' + JSON.stringify(w.tombs()));
  assert.equal(w.writesTo('trinityone/relays-removed').length, 1, 'the removed-keys document was re-signed after the Remove wrote it');
});

// ── FF1 audit (2026-11-22): a Remove that writes NO tombstone still stops an automatic adopt in flight ────
// The church's relay-net list cannot be read whole (a relay mid-login is withholding it), so the REAL
// unenrolRelayNet answers `unknown` before it has marked any key: no tombstone, nothing pending. The dashboard keeps
// the row on the list for that answer ("remove it again once your relays are answering"), so the row is still in
// extraRelays() — and the removed-keys read, a different document, IS whole. Every question the signing slot asked
// before this fix answers "go".
const BLIND_NET = { incompleteD: 'trinityone/relay-net' };
test('FF1 audit POINT OF USE: Remove pressed during the owed retry\'s backfill answers "unknown" and writes NO tombstone — the retry still does not sign the box, and does not leave it owed (controls: no Remove, it is signed; a Remove pressed BEFORE the pass does not stop a later one)', async () => {
  const control = owedRaceWorld({}, BLIND_NET);
  await control.api.retryOwedBackfills();
  await drain();
  assert.equal(control.enrols.length, 1, 'CONTROL: in this same world, with no Remove pressed, the owed box should be signed');

  let removing = null;
  const w = owedRaceWorld({ onBackfill: (x, X) => { removing = x.api.unsignRelay(X); } }, BLIND_NET);
  await w.api.retryOwedBackfills();
  const rm = await removing;
  await drain();
  assert.equal(rm && rm.unknown, true, 're-anchor: the Remove did not answer `unknown`: ' + JSON.stringify(rm));
  assert.equal(w.tombs(), null, 're-anchor: the Remove wrote a tombstone, so the removed-keys check would have stopped the retry anyway: ' + JSON.stringify(w.tombs()));
  assert.deepEqual(w.api._pendingTomb(), [], 're-anchor: the Remove marked a key pending, so the pending check would have stopped the retry anyway');
  assert.ok(w.scope.extraRelays().includes(w.X), 're-anchor: the row left this console\'s list, so the still-listed check would have stopped the retry anyway');
  assert.equal(w.enrols.length, 0,
    'THE OWED RETRY FINISHED AN ADOPTION THE STEWARD HAD JUST PRESSED REMOVE ON — that Remove could not reach the church\'s list, wrote no tombstone, and nothing else told the pass it had been pressed (FF1 audit)');
  assert.deepEqual(w.api._owedBackfills(), [], 'the box was left owed after its Remove — the next pass signs it');

  // A Remove pressed and finished BEFORE a pass begins is not held against that pass: the steward connected again.
  const later = owedRaceWorld({}, BLIND_NET);
  const first = await later.api.unsignRelay(later.X);
  assert.equal(first && first.unknown, true, 're-anchor: ' + JSON.stringify(first));
  later.api._setOwedBackfill(PUB, later.X, true);   // what a later Connect that came back pending writes
  await later.api.retryOwedBackfills();
  await drain();
  assert.equal(later.enrols.length, 1, 'AN EARLIER REMOVE BLOCKED EVERY LATER RETRY OF THAT ADDRESS — the count must be compared with where it stood when the adopt began');
});

test('FF1 audit: Remove pressed while the retry is sending documents to a box that then does NOT take them — the retry does not write the owed marker back (control: no Remove, it stays owed)', async () => {
  const control = owedRaceWorld({ landed: false }, BLIND_NET);
  await control.api.retryOwedBackfills();
  await drain();
  assert.deepEqual(control.api._owedBackfills(), [{ churchPub: PUB, url: control.X }], 'CONTROL: with no Remove pressed, a box that has not taken the documents stays owed');

  let removing = null;
  const w = owedRaceWorld({ landed: false, onBackfill: (x, X) => { removing = x.api.unsignRelay(X); } }, BLIND_NET);
  await w.api.retryOwedBackfills();
  await removing;
  await drain();
  assert.equal(w.enrols.length, 0);
  assert.deepEqual(w.api._owedBackfills(), [],
    'THE RETRY WROTE THE OWED MARKER BACK AFTER THE STEWARD PRESSED REMOVE — the box is tried again on every pass and signed the moment it accepts the documents');
});
