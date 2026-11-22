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
      const answeredUrls = relays.filter(r => r.up).map(r => r.url);
      return { ev: evs[0] || null, complete: answeredUrls.length > 0, asked: askedUrls.length, askedUrls, answeredUrls };
    },
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; throw new ReferenceError('the lifted A2 engine needs `' + String(k) + '` — add a stub'); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const api = new Function('scope', 'with (scope) {' + LIFT + (cfg.realHeal ? '\n' + LIFT_HEAL : '') +
    '\nreturn { unenrolRelayNet, syncHeal, _writeTombstone, _closeSyncTrust, enrolSerial, _pendingTomb, _setPendingTomb, _flushPendingTomb, autoSyncHeal, ' +
    fnBody(BUNDLE, '  signRelay(url) {', 'signRelay in the shipped bundle') + ' }; }')(proxy);
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
