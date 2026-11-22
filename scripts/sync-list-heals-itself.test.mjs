// THE CHURCH'S SYNC LIST HEALS ITSELF — MERGE, NEVER REBUILD, AND NEVER OVER A TURN-OFF.
// Run: node --test scripts/sync-list-heals-itself.test.mjs
//
// PLAN-relay-autoconnect-selfhealing-sync-2026-11-20, work item A1. The a8 shape (verified in
// reference/INVESTIGATION-a8-refuses-box-sync-2026-11-18.md): a console whose relays() lacked a box
// re-signed `trinityone/relays` WITHOUT that box, every peer holding the newest doc 401'd the box's pulls,
// and nothing anywhere could put it back. syncHeal() reads the newest doc, merges what this console can
// PROVE onto it by pubkey, and re-signs only on a change — probes outside the enrolSerial queue, read →
// merge → sign inside it, `_readCovers` with a droppable set so one dead row cannot freeze healing.
//
// Everything decision-making is lifted from the SHIPPED vendor/steward.js and RUN (rules 1/3): the real
// syncHeal, the real _readCovers, the real enrolSerial, the real normalisers, the real syncDisable for the
// race, the real signRelay for its trigger, and the REAL KeyDistributor effect source for the wiring test.
// Only the I/O boundary (identity probe, relay read, publish) is injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeURL } from 'nostr-tools/utils';
import { compileScreen, miniReact, find, button } from './render-jsx-screen.mjs';
import { fnBody, stmt } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const BUNDLE = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const PUB = 'a'.repeat(64);
const NOW = 1763650000;
const KEY_A = '1a'.repeat(32), KEY_B = '2b'.repeat(32), KEY_C = '3c'.repeat(32);
const settle = () => new Promise(r => setImmediate(r));

const LIFT = [
  ['st', 'var RELAYS_REMOVED_D = '],
  ['fn', 'function _syncRelayBase'],
  ['st', 'var _syncRelayKey = '],
  ['fn', 'function _isPrivateRelayBase(u) {'],
  ['fn', 'function _readCovers'],
  ['st', 'var _enrolQueue = '],
  ['fn', 'function enrolSerial'],
  ['fn', 'function _tombable(keys, never) {'],
  ['fn', 'async function syncHeal() {'],
  ['st', 'var _syncHealLastAt = '],
  ['fn', 'async function autoSyncHeal'],
].map(([k, a]) => (k === 'fn' ? fnBody(BUNDLE, a, a) : stmt(BUNDLE, a, a))).join('\n');

// A console over an in-memory relay fleet. cfg:
//   relays:   [{ url, key: hex|'', up: true|false }] — up:false answers neither the probe nor the read
//   doc:      entries array | '[]' (a Turn-off) | null (no doc) ; docAt, docAuthor
//   tombs:    [{pubkey, at}] | null ; tombAuthor
//   own:      the console's serving box url ('' = none) ; selfPub: selfPublicRelay()
//   canonical:[urls] shipped as canonical spellings
//   onWrite(n, inject): called after the n-th publish landed — a test stages a concurrent writer here
function makeWorld(cfg) {
  const relays = cfg.relays || [];
  const store = new Map();   // d -> [events]
  const dOf = (ev) => ((ev.tags || []).find(t => t[0] === 'd') || [])[1] || '';
  const put = (ev) => { const a = store.get(dOf(ev)) || []; a.push(ev); store.set(dOf(ev), a); };
  if (cfg.doc != null) put({ kind: 30078, pubkey: cfg.docAuthor || PUB, created_at: cfg.docAt != null ? cfg.docAt : NOW - 1000,
    tags: [['d', 'trinityone/relays']], content: typeof cfg.doc === 'string' ? cfg.doc : JSON.stringify(cfg.doc) });
  if (cfg.tombs) put({ kind: 30078, pubkey: cfg.tombAuthor || PUB, created_at: cfg.tombsAt != null ? cfg.tombsAt : NOW - 900,
    tags: [['d', 'trinityone/relays-removed']], content: JSON.stringify(cfg.tombs) });
  const writes = [];
  let ids = 0;
  const byUrl = (u) => relays.find(r => r.url === u);
  const scope = {
    sk: new Uint8Array(32).fill(7), pub: PUB, actingChurch: '', _viewingNetwork: () => false,
    normalizeURL, normalizeURL2: normalizeURL,
    JSON, Math, Set, Map, Array, Object, String, Number, Promise, Error, Date,
    now: () => NOW, _monotonic: (t) => t,
    finalizeEvent: (t) => ({ ...t, pubkey: PUB, id: 'w' + (++ids) }),
    finalizeEvent2: (t) => ({ ...t, pubkey: PUB, id: 'w' + (++ids) }),
    relaysRaw: () => relays.map(r => r.url),
    // BF2 (2026-11-22): syncHeal refuses to ADD a key this console still holds pending. None here; the refusal is
    // run for real (real _pendingTomb over localStorage) in removal-sticks-and-closes-sync-trust.test.mjs.
    _pendingTomb: () => [], sharedRelayKeys: () => [],
    relayNetCandidates: () => (cfg.own ? [cfg.own] : []),
    selfPublicRelay: () => cfg.selfPub || '',
    verifyRelayIdentity: async (u) => {
      const r = byUrl(u);
      if (!r || !r.up || !r.key) throw new Error('no proof at ' + u);
      return { relayPub: r.key, url: u, at: NOW };
    },
    CANONICAL_RELAY_PUBS: Object.freeze((cfg.canonical || []).reduce((m, u) => ({ ...m, [u]: ['f'.repeat(64)] }), {})),
    CANONICAL_RELAYS: (cfg.canonical || []).slice(),
    publish: async (ev) => {
      writes.push(ev); put(ev);
      if (cfg.onWrite) await cfg.onWrite(writes.length, put, ev);
      return ev;
    },
    _oneComplete: async (filters) => {
      // A deliberately imperfect relay: it returns the newest copy REGARDLESS of the author filter, so the
      // engine's own `ev.pubkey === pub` re-check is what the stranger-signed cases measure.
      const d = (filters[0]['#d'] || [])[0];
      const evs = (store.get(d) || []).slice().sort((x, y) => (y.created_at - x.created_at) || ((store.get(d) || []).indexOf(y) - (store.get(d) || []).indexOf(x)));
      const askedUrls = relays.map(r => r.url);
      const answeredUrls = relays.filter(r => r.up).map(r => r.url);
      return { ev: evs[0] || null, complete: answeredUrls.length > 0, asked: askedUrls.length, askedUrls, answeredUrls };
    },
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; throw new ReferenceError('the lifted heal needs `' + String(k) + '` — add a stub'); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const api = new Function('scope', 'with (scope) {' + LIFT +
    '\nreturn { syncHeal, autoSyncHeal, enrolSerial, ' +
    fnBody(BUNDLE, 'async syncDisable() {', 'syncDisable in the shipped bundle') + ' }; }')(proxy);
  return { api, writes, scope, store,
    stored: () => { const a = (store.get('trinityone/relays') || []).slice().sort((x, y) => y.created_at - x.created_at); return a[0] ? JSON.parse(a[0].content) : null; } };
}
const keysOf = (entries) => (entries || []).map(e => e.pubkey).sort();

// ── the merge rules ─────────────────────────────────────────────────────────────────────────────────────
test('a briefly-down trusted box SURVIVES a heal unchanged, while a moved box gets its url updated in place', async () => {
  // B is in the doc and not answering; A's key now proves at a NEW public address.
  const w = makeWorld({
    relays: [{ url: 'wss://new-a.example/relay', key: KEY_A, up: true }, { url: 'wss://b.example/relay', key: KEY_B, up: false }],
    doc: [{ pubkey: KEY_A, url: 'https://old-a.example' }, { pubkey: KEY_B, url: 'https://b.example' }],
  });
  const r = await w.api.syncHeal();
  assert.equal(r.published, true, 'a moved box was not re-signed: ' + JSON.stringify(r));
  const got = w.stored();
  assert.deepEqual(keysOf(got), [KEY_A, KEY_B].sort(),
    'THE BRIEFLY-DOWN BOX WAS DROPPED — "my relay was off for an hour" became "my church un-trusted its own relay": ' + JSON.stringify(got));
  assert.equal(got.find(e => e.pubkey === KEY_B).url, 'https://b.example', 'the down box\'s url was touched');
  assert.equal(got.find(e => e.pubkey === KEY_A).url, 'https://new-a.example', 'the moved box\'s url was not updated in place');
});

test('a box proved at the SAME base it is listed under changes nothing — no write at all', async () => {
  const w = makeWorld({
    relays: [{ url: 'wss://a.example/relay', key: KEY_A, up: true }],
    doc: [{ pubkey: KEY_A, url: 'https://a.example' }, { pubkey: KEY_B, url: 'https://b.example' }],
  });
  const r = await w.api.syncHeal();
  assert.deepEqual({ published: r.published, changed: r.changed }, { published: false, changed: false });
  assert.equal(w.writes.length, 0, 'an unchanged list was re-signed — every trigger would then churn a write');
});

test('a console that sees the box at LOOPBACK (or a LAN address) never overwrites its public url, and a private-only box is not added', async () => {
  // The two-console shape (v1 audit finding 5): console 2 dials the same box at 127.0.0.1 while the doc
  // carries the public tunnel url. And a LAN-only box (192.168.…) proving a NEW key contributes nothing.
  const w = makeWorld({
    relays: [{ url: 'ws://127.0.0.1:8000/relay', key: KEY_A, up: true }, { url: 'ws://192.168.1.50:8000/relay', key: KEY_C, up: true }],
    doc: [{ pubkey: KEY_A, url: 'https://tunnel-a.example' }],
  });
  const r = await w.api.syncHeal();
  assert.equal(w.writes.length, 0, 'a loopback/LAN sighting produced a write: ' + JSON.stringify(w.stored()));
  assert.equal(r.changed, false,
    'A LOOPBACK SIGHTING REWROTE THE DOC — every phone would be told to pull from an address only this machine can dial');
  // …but the console's OWN box at loopback contributes its PUBLIC address (selfPublicRelay), so a fresh
  // Suite box does get added under the address members can reach.
  const w2 = makeWorld({
    relays: [{ url: 'ws://127.0.0.1:8000/relay', key: KEY_C, up: true }],
    own: 'ws://127.0.0.1:8000/relay', selfPub: 'wss://quick-tunnel.example/relay',
    doc: [{ pubkey: KEY_A, url: 'https://a.example' }],
  });
  const r2 = await w2.api.syncHeal();
  assert.equal(r2.published, true, 'the own box behind a tunnel was not healed in: ' + JSON.stringify(r2));
  assert.equal(w2.stored().find(e => e.pubkey === KEY_C).url, 'https://quick-tunnel.example',
    'the own box was written under something other than its public tunnel base');
});

test('a proved box sighted only at a CGNAT/Tailscale, link-local, 127/8 or IPv6-ULA address is NOT written in; a PUBLIC *.ts.net funnel still is', async () => {
  // Every box below PROVES identity — the key is real — but all but one are sighted at an address only this
  // machine or this tailnet can dial. None of those may be told to other phones as a pull url. This screen is
  // WRITE-ONLY (rule 10): it decides what syncHeal writes INTO trinityone/relays, never which relay is
  // admitted/read. A *.ts.net funnel is a PUBLIC self-host address and MUST still be written.
  const K_CG = 'aa'.repeat(32);   // 100.64.0.1  — CGNAT / Tailscale (100.64/10)
  const K_UL = 'bb'.repeat(32);   // [fd00::1]   — IPv6 ULA (fc00::/7)
  const K_LO = 'cc'.repeat(32);   // 127.5.5.5   — all of loopback (127/8), not just 127.0.0.1
  const K_LL = 'dd'.repeat(32);   // 169.254.1.1 — link-local (169.254/16)
  const K_PUB = 'ee'.repeat(32);  // box.ts.net  — a PUBLIC tunnel funnel
  const SEED = '11'.repeat(32);   // an existing public entry so the doc is a real list, not a Turn-off
  const w = makeWorld({
    relays: [
      { url: 'wss://100.64.0.1:8000/relay', key: K_CG, up: true },
      { url: 'wss://[fd00::1]:8000/relay', key: K_UL, up: true },
      { url: 'ws://127.5.5.5:8000/relay', key: K_LO, up: true },
      { url: 'wss://169.254.1.1:8000/relay', key: K_LL, up: true },
      { url: 'wss://box.ts.net/relay', key: K_PUB, up: true },
    ],
    doc: [{ pubkey: SEED, url: 'https://seed.example' }],
  });
  const r = await w.api.syncHeal();
  assert.equal(r.published, true, 'the public ts.net funnel was never added, so nothing proved the write path still writes public boxes: ' + JSON.stringify(r));
  const got = w.stored();
  assert.deepEqual(keysOf(got), [SEED, K_PUB].sort(),
    'A PRIVATE-RANGE SIGHTING (100.64 CGNAT / fd00::1 ULA / 127.5.5.5 loopback / 169.254 link-local) WAS WRITTEN INTO THE SHARED DOC — every phone would be told to pull from an address only one machine can reach — or the public funnel was dropped: ' + JSON.stringify(got));
  assert.equal(got.find(e => e.pubkey === K_PUB).url, 'https://box.ts.net', 'the public funnel was written under the wrong base');
  // …and the CGNAT boundary is exact: 100.63 and 100.128 are PUBLIC and must still be written.
  const K_63 = '22'.repeat(32), K_128 = '33'.repeat(32);
  const w2 = makeWorld({
    relays: [
      { url: 'wss://100.63.0.1:8000/relay', key: K_63, up: true },
      { url: 'wss://100.128.0.1:8000/relay', key: K_128, up: true },
    ],
    doc: [{ pubkey: SEED, url: 'https://seed.example' }],
  });
  const r2 = await w2.api.syncHeal();
  assert.equal(r2.published, true, JSON.stringify(r2));
  assert.deepEqual(keysOf(w2.stored()), [SEED, K_63, K_128].sort(),
    '100.63 or 100.128 — both OUTSIDE 100.64/10 and PUBLIC — were wrongly screened as CGNAT and dropped: ' + JSON.stringify(w2.stored()));
});

test('a proved box missing from the doc is ADDED; a NEWER tombstone removes; an OLDER tombstone leaves the entry alone', async () => {
  const w = makeWorld({
    relays: [{ url: 'wss://a.example/relay', key: KEY_A, up: true }, { url: 'wss://c.example/relay', key: KEY_C, up: true }],
    doc: [{ pubkey: KEY_A, url: 'https://a.example' }, { pubkey: KEY_B, url: 'https://b.example' }],
    docAt: NOW - 1000,
    // B's tombstone is NEWER than the doc -> removed. A's is OLDER -> stays (a later Add re-signed it in).
    tombs: [{ pubkey: KEY_B, at: NOW - 500 }, { pubkey: KEY_A, at: NOW - 5000 }],
  });
  const r = await w.api.syncHeal();
  assert.equal(r.published, true, JSON.stringify(r));
  const got = w.stored();
  assert.deepEqual(keysOf(got), [KEY_A, KEY_C].sort(),
    'expected A kept (older tombstone), B removed (newer tombstone), C added (proved, not tombstoned) — got ' + JSON.stringify(got));
  assert.equal(got.find(e => e.pubkey === KEY_C).url, 'https://c.example');
});

test('a TOMBSTONED key is never added back, and a tombstone signed by a stranger removes nothing', async () => {
  const w = makeWorld({
    relays: [{ url: 'wss://c.example/relay', key: KEY_C, up: true }],
    doc: [{ pubkey: KEY_A, url: 'https://a.example' }],
    tombs: [{ pubkey: KEY_C, at: NOW - 100 }],
  });
  const r = await w.api.syncHeal();
  assert.equal(w.writes.length, 0,
    'A REMOVED BOX WAS RE-ADDED BY THE NEXT HEAL — the Remove flap the tombstone exists to stop: ' + JSON.stringify(r));
  const w2 = makeWorld({
    relays: [{ url: 'wss://a.example/relay', key: KEY_A, up: true }],
    doc: [{ pubkey: KEY_A, url: 'https://a.example' }, { pubkey: KEY_B, url: 'https://b.example' }],
    tombs: [{ pubkey: KEY_B, at: NOW - 100 }], tombAuthor: 'f'.repeat(64),
  });
  await w2.api.syncHeal();
  assert.equal(w2.writes.length, 0,
    'A NON-CHURCH-SIGNED TOMBSTONE REMOVED A BOX — anyone could un-trust the church\'s own relay');
});

// ── completeness: the jam, and what may never be excused ────────────────────────────────────────────────
test('the jam: a dead, unanswering extra row cannot freeze healing (droppable), but a dead CANONICAL address blocks the re-sign', async () => {
  const dead = 'wss://old-tunnel.example/relay';
  const w = makeWorld({
    relays: [{ url: 'wss://a.example/relay', key: KEY_A, up: true }, { url: 'wss://c.example/relay', key: KEY_C, up: true }, { url: dead, key: '', up: false }],
    doc: [{ pubkey: KEY_A, url: 'https://a.example' }],
  });
  const r = await w.api.syncHeal();
  assert.equal(r.published, true,
    'ONE DEAD OLD-TUNNEL ROW FROZE HEALING FOR EVER (audit finding 4) — the droppable rule is not applied: ' + JSON.stringify(r));
  assert.deepEqual(keysOf(w.stored()), [KEY_A, KEY_C].sort());
  // …and the same dead row as a CANONICAL spelling is NOT droppable: the shared pool must answer before
  // the church's trust list may change.
  const w2 = makeWorld({
    relays: [{ url: 'wss://a.example/relay', key: KEY_A, up: true }, { url: 'wss://c.example/relay', key: KEY_C, up: true }, { url: dead, key: '', up: false }],
    canonical: [dead],
    doc: [{ pubkey: KEY_A, url: 'https://a.example' }],
  });
  const r2 = await w2.api.syncHeal();
  assert.equal(r2.unknown, true, 'an unanswering canonical relay did not block the re-sign: ' + JSON.stringify(r2));
  assert.equal(w2.writes.length, 0, 'the list was re-signed over a read the canonical pool never answered');
});

// ── healing never turns sync on, never resurrects a Turn-off ────────────────────────────────────────────
test('no doc -> no write; a `[]` Turn-off -> no write', async () => {
  const w = makeWorld({ relays: [{ url: 'wss://a.example/relay', key: KEY_A, up: true }, { url: 'wss://c.example/relay', key: KEY_C, up: true }], doc: null });
  const r = await w.api.syncHeal();
  assert.equal(w.writes.length, 0, 'HEALING TURNED SYNC ON over a church that never enabled it: ' + JSON.stringify(r));
  assert.equal(r.noDoc, true);
  const w2 = makeWorld({ relays: [{ url: 'wss://a.example/relay', key: KEY_A, up: true }, { url: 'wss://c.example/relay', key: KEY_C, up: true }], doc: '[]' });
  const r2 = await w2.api.syncHeal();
  assert.equal(w2.writes.length, 0, 'HEALING RESURRECTED A TURN-OFF — the A4 bug rebuilt one layer up: ' + JSON.stringify(r2));
  assert.equal(r2.off, true);
});

// ── the M-5 read-back loop ──────────────────────────────────────────────────────────────────────────────
test('a concurrent newer doc that lost our change is repaired once — merged onto the NEWER list, tombstones still honoured', async () => {
  const w = makeWorld({
    relays: [{ url: 'wss://c.example/relay', key: KEY_C, up: true }, { url: 'wss://a.example/relay', key: KEY_A, up: true }],
    doc: [{ pubkey: KEY_A, url: 'https://a.example' }],
    onWrite: async (n, put) => {
      // Between our first write and its read-back, another console signs a NEWER doc without our add.
      if (n === 1) put({ kind: 30078, pubkey: PUB, created_at: NOW + 5, tags: [['d', 'trinityone/relays']],
        content: JSON.stringify([{ pubkey: KEY_A, url: 'https://a.example' }, { pubkey: KEY_B, url: 'https://b.example' }]) });
    },
  });
  const r = await w.api.syncHeal();
  assert.equal(r.published, true, JSON.stringify(r));
  assert.equal(r.repaired, 1, 'the lost change was not repaired exactly once: ' + JSON.stringify(r));
  assert.equal(w.writes.length, 2, 'expected the write and one repair, got ' + w.writes.length);
  assert.ok(w.writes[1].created_at > NOW + 5, 'the repair is not newer than the document it merged onto');
  assert.deepEqual(keysOf(w.stored()), [KEY_A, KEY_B, KEY_C].sort(),
    'the repair dropped the concurrent console\'s change or our own: ' + JSON.stringify(w.stored()));
});

test('a repair pass that finds the newest doc is `[]` ABORTS without signing — a racing Turn-off stands', async () => {
  const w = makeWorld({
    relays: [{ url: 'wss://c.example/relay', key: KEY_C, up: true }, { url: 'wss://a.example/relay', key: KEY_A, up: true }],
    doc: [{ pubkey: KEY_A, url: 'https://a.example' }],
    onWrite: async (n, put) => {
      if (n === 1) put({ kind: 30078, pubkey: PUB, created_at: NOW + 5, tags: [['d', 'trinityone/relays']], content: '[]' });
    },
  });
  const r = await w.api.syncHeal();
  assert.equal(w.writes.length, 1,
    'THE HEAL RE-SIGNED OVER A TURN-OFF: a steward pressed "Turn off" and a background pass turned it back on: ' + JSON.stringify(w.stored()));
  assert.equal(r.published, false);
  assert.equal(r.aborted, true, JSON.stringify(r));
  assert.deepEqual(w.stored(), [], 'the `[]` did not stand');
});

test('an INCOMPLETE read-back is unknown, never "missing" — nothing is re-signed over a list it could not see', async () => {
  let dropAfterWrite = false;
  const relays = [{ url: 'wss://c.example/relay', key: KEY_C, up: true }, { url: 'wss://a.example/relay', key: KEY_A, up: true }];
  const w = makeWorld({
    relays, doc: [{ pubkey: KEY_A, url: 'https://a.example' }],
    onWrite: async () => { if (!dropAfterWrite) { dropAfterWrite = true; relays[1].up = false; relays[1].key = ''; } },
  });
  // relay A stops answering right after our write: it was PROVED in phase 1, so it is NOT droppable, and
  // the read-back cannot cover — unknown, one write, no repair guessing.
  const r = await w.api.syncHeal();
  assert.equal(r.unknown, true, JSON.stringify(r));
  assert.equal(w.writes.length, 1, 'an incomplete read-back led to another signature');
});

// ── the race through the one queue ──────────────────────────────────────────────────────────────────────
test('a heal racing a syncDisable through the shared queue cannot re-sign over the `[]`', async () => {
  const w = makeWorld({
    relays: [{ url: 'wss://c.example/relay', key: KEY_C, up: true }, { url: 'wss://a.example/relay', key: KEY_A, up: true }],
    doc: [{ pubkey: KEY_A, url: 'https://a.example' }],
  });
  // Disable enqueues its slot synchronously; the heal probes first (awaits) and enqueues BEHIND it — the
  // real enrolSerial, lifted, orders both. The heal must then read the `[]` back and walk away.
  const pDisable = w.api.syncDisable();
  const pHeal = w.api.syncHeal();
  const [dis, heal] = await Promise.all([pDisable, pHeal]);
  assert.deepEqual(dis, { relays: 0 });
  assert.equal(heal.off, true, 'the heal did not read the Turn-off that was queued ahead of it: ' + JSON.stringify(heal));
  assert.equal(w.writes.length, 1, 'expected exactly the `[]` write; the heal wrote too: ' + w.writes.length);
  assert.deepEqual(w.stored(), [],
    'THE HEAL UNDID THE TURN-OFF IT RACED — the exact interleaving the shared queue (A4) + the `[]` guard exist to close');
});

// ── identity discipline ─────────────────────────────────────────────────────────────────────────────────
test('a church/network switch after ANY await aborts as unknown and writes nothing', async () => {
  const w = makeWorld({
    relays: [{ url: 'wss://c.example/relay', key: KEY_C, up: true }],
    doc: [{ pubkey: KEY_A, url: 'https://a.example' }],
  });
  const realVerify = w.scope.verifyRelayIdentity;
  w.scope.verifyRelayIdentity = async (u) => { const out = await realVerify(u); w.scope.actingChurch = 'b'.repeat(64); return out; };
  const r = await w.api.syncHeal();
  assert.equal(r.unknown, true, JSON.stringify(r));
  assert.equal(w.writes.length, 0,
    'THE IDENTITY MOVED MID-PASS AND IT SIGNED ANYWAY — church A\'s list signed under whatever key is current');
  // and a delegated / network console never starts
  const w2 = makeWorld({ relays: [], doc: null });
  w2.scope.actingChurch = 'b'.repeat(64);
  assert.equal((await w2.api.syncHeal()).ran, false, 'a delegated console ran the heal');
  const w3 = makeWorld({ relays: [], doc: null });
  w3.scope._viewingNetwork = () => true;
  assert.equal((await w3.api.syncHeal()).ran, false, 'a network view ran the heal');
});

// ── the 10-minute damper ────────────────────────────────────────────────────────────────────────────────
test('autoSyncHeal runs at most once per 10 minutes; force bypasses once and resets the stamp', async () => {
  const w = makeWorld({ relays: [], doc: null });
  let t = 1000000000000;
  w.scope.Date = { now: () => t };
  let runs = 0;
  const baseRaw = w.scope.relaysRaw;
  w.scope.relaysRaw = () => { runs++; return baseRaw(); };
  await w.api.autoSyncHeal();
  assert.equal(runs, 1, 'the first trigger did not run the pass');
  t += 60 * 1000;
  assert.equal((await w.api.autoSyncHeal()).debounced, true, 'a second trigger a minute later ran the pass again — every focus would re-probe every relay');
  assert.equal(runs, 1);
  await w.api.autoSyncHeal({ force: true });
  assert.equal(runs, 2, 'a trust refusal (force) did not bypass the damper');
  t += 60 * 1000;
  assert.equal((await w.api.autoSyncHeal()).debounced, true, 'force did not reset the stamp');
  t += 11 * 60 * 1000;
  await w.api.autoSyncHeal();
  assert.equal(runs, 3, 'the damper never reopens');
});

// ── POINT OF USE 1: the KeyDistributor effect really asks for the heal ──────────────────────────────────
// The real effect source is sliced out of app/stew-dashboard.jsx and RUN (the same anchors
// a-console-signs-its-own-relay.test.mjs runs the enrolment half through). Delete the autoSyncHeal call
// from the effect and these go red; rule 3 forbids matching its text instead.
function runKeyDistributorEffect(steward) {
  const START = "  // ── SIGN THIS CONSOLE'S OWN RELAY INTO THE CHURCH'S LIST";
  const END = '  // ── end of the own-relay enrolment effect';
  const a = DASH.indexOf(START), b = DASH.indexOf(END, a);
  assert.ok(a > 0 && b > a, 're-anchor: the own-relay enrolment effect moved or was removed from KeyDistributor');
  const src = DASH.slice(a, b);
  const timers = [], listeners = new Map();
  const React = { useEffect(fn, deps) { assert.deepEqual(deps, [7], 'the effect does not re-run on unlockTick'); fn(); } };
  const win = {
    Steward: steward,
    addEventListener(t, f) { (listeners.get(t) || listeners.set(t, []).get(t)).push(f); },
    removeEventListener() {},
  };
  new Function('React', 'window', 'setTimeout', 'clearTimeout', 'unlockTick', src)(
    React, win, (fn) => { timers.push(fn); return timers.length; }, () => {}, 7);
  return { timers, fire: (t) => (listeners.get(t) || []).slice().forEach(f => f()) };
}

test('POINT OF USE: the console asks for a sync heal AND the community auto-join on boot and on every churn signal — cut either wire and this goes red', async () => {
  let heals = 0, enrols = 0, joins = 0;
  const e = runKeyDistributorEffect({
    autoEnrolRelayNet: async () => { enrols++; return null; },
    autoSyncHeal: async (opts) => { heals++; assert.equal(opts, undefined, 'the background trigger must NOT force past the damper'); return {}; },
    // FIX 2 (rule 1): the B2 community auto-join is wired to the SAME effect. Without this assertion, deleting the
    // autoJoinPublicRelaysAuto call from the effect left the whole suite green — a well-tested engine nobody calls.
    autoJoinPublicRelaysAuto: async (opts) => { joins++; assert.equal(opts, undefined, 'the background auto-join must NOT force past its own damper'); return {}; },
  });
  assert.equal(heals, 0, 'the heal ran before the deferred timer — it competes with first paint');
  assert.equal(joins, 0, 'the auto-join ran before the deferred timer — it competes with first paint');
  for (const fn of e.timers) fn();
  await settle();
  assert.equal(heals, 1,
    'THE CONSOLE NEVER ASKS FOR A HEAL — syncHeal is an engine nobody calls, so no church\'s sync list ever heals (rule 1)');
  assert.equal(joins, 1,
    'THE CONSOLE NEVER ASKS FOR THE COMMUNITY AUTO-JOIN — autoJoinPublicRelaysAuto is wired to nothing, so community relays are never adopted (rule 1)');
  e.fire('steward-relay-returned'); e.fire('focus'); e.fire('steward-relays');
  await settle();
  assert.equal(heals, 4, 'the churn signals (relay returned / focus / steward-relays) do not re-ask for the heal');
  assert.equal(joins, 4, 'the churn signals (relay returned / focus / steward-relays) do not re-ask for the auto-join');
  assert.ok(enrols >= 1, 'CONTROL: the enrolment half of the same effect stopped running — the slice is broken, not the wire');
});

test('…and an older bundle without autoSyncHeal does not break the effect', async () => {
  const e = runKeyDistributorEffect({ autoEnrolRelayNet: async () => null });
  assert.doesNotThrow(() => { for (const fn of e.timers) fn(); });
  await settle();
});

// ── POINT OF USE 2: a 'trust' refusal on the Relays card requests a forced heal ─────────────────────────
const JS = compileScreen('app/stew-dashboard.jsx');
function relaysCard(stewardExtra, rows) {
  const { React, draw } = miniReact();
  const relays = rows || [{ url: 'wss://relay.grace.example/relay', status: 'on' }];
  const win = {
    useStewardRelays: () => relays.slice(), useStewardChurch: () => ({ name: 'St Aidan’s' }),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Steward: { ownRelay: () => 'wss://relay.grace.example/relay', backupState: async () => ({ boxes: 2, online: 2, syncOn: true }),
      canRemoveRelay: () => true, relayName: () => '', ...stewardExtra },
  };
  const globals = {
    React, window: win, localStorage: win.localStorage,
    location: { host: 'relay.grace.example', hostname: 'relay.grace.example' }, navigator: { userAgent: '' },
    document: { addEventListener() {}, removeEventListener() {} }, setTimeout, clearTimeout, setInterval, clearInterval, console,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Icon: function Icon() { return null; }, SkPill: function SkPill() { return null; }, SkBadge: function SkBadge() { return null; },
    useStewDialog: () => ({ current: null }),
  };
  const names = Object.keys(globals);
  const mod = new Function(...names, JS + '\nreturn { DashRelaysCard };')(...names.map(k => globals[k]));
  return { draw: () => draw(mod.DashRelaysCard, {}) };
}
// Mirrors the entry relaySyncStates hands onEach: the RAW church block plus the spread of relaySyncState.
// `passes` is the refused-pass counter; relaySyncState only reaches 'attention'/'clock' at passes >= 2, so a
// 1-pass refusal spreads to state 'unknown' — exactly the "one refused pass shows nothing red" rule.
const chip = (state, reason, at, passes = 2) => ({ url: 'wss://relay.grace.example/relay', sync: null,
  church: { state, reason, at, lastReachedAt: 0, refusedPasses: passes, running: false, peers: 1 },
  state: state === 'refused' ? (passes >= 2 ? (reason === 'time' ? 'clock' : 'attention') : 'unknown') : 'synced',
  label: '', at, lastReachedAt: 0, refusedPasses: passes, reason: reason || '' });

test('POINT OF USE: a church pass REFUSED for trust asks for a forced heal, once per observation — and a clock refusal never does', async () => {
  const calls = [];
  const mk = (entry) => relaysCard({
    autoSyncHeal: async (opts) => { calls.push(opts); return {}; },
    relaySyncStates: async (onEach) => { onEach(entry); onEach(entry); return [entry]; },   // the same observation lands twice
  });
  const card = mk(chip('refused', 'trust', 1700000100));
  card.draw(); await settle(); card.draw(); await settle();
  assert.equal(calls.length, 1,
    calls.length === 0
      ? 'A TRUST REFUSAL ON THE RELAYS CARD REQUESTS NO HEAL — the a8 shape stays broken until a steward finds a toggle (rule 1)'
      : 'one refusal observation asked ' + calls.length + ' times — a standing refusal would hammer the queue');
  assert.deepEqual(calls[0], { force: true }, 'the refusal request must bypass the 10-minute damper once');
  for (const [why, entry] of [
    ["a clock refusal (reason 'time') is NOT a trust-list problem and must never trigger a re-sign", chip('refused', 'time', 1700000100)],
    ['a healthy reached pass must not trigger anything', chip('reached', '', 1700000100)],
  ]) {
    const c2 = [];
    const k = relaysCard({ autoSyncHeal: async (o) => { c2.push(o); return {}; }, relaySyncStates: async (onEach) => { const e = entry; onEach(e); return [e]; } });
    k.draw(); await settle(); k.draw(); await settle();
    assert.equal(c2.length, 0, why + ' — but autoSyncHeal was called: ' + JSON.stringify(c2));
  }
  // a FRESH observation (a newer pass stamp, still refused) may ask again
  const calls3 = [];
  let at = 1700000100;
  const card3 = relaysCard({
    autoSyncHeal: async (o) => { calls3.push(o); return {}; },
    relaySyncStates: async (onEach) => { onEach(chip('refused', 'trust', at)); return []; },
  });
  card3.draw(); await settle(); card3.draw(); await settle();
  assert.equal(calls3.length, 1);
});

test('POINT OF USE: a trust refusal asks for NO heal until the SAME 2-pass threshold the card uses for "Needs attention" — one refused pass does nothing, two passes fire once', async () => {
  // relaySyncState reddens the card to "Needs attention" only at refusedPasses >= 2 (steward.src.js); a single
  // refused pass shows nothing. The forced heal must wait for that exact gate, or one transient refusal churns a
  // church-wide re-sign before the card even reddens. Cut the wire in DashRelaysCard's effect and this goes red.
  const one = [];
  const k1 = relaysCard({
    autoSyncHeal: async (o) => { one.push(o); return {}; },
    relaySyncStates: async (onEach) => { const e = chip('refused', 'trust', 1700000200, 1); onEach(e); return [e]; },
  });
  k1.draw(); await settle(); k1.draw(); await settle();
  assert.equal(one.length, 0,
    'A SINGLE REFUSED-FOR-TRUST PASS FORCED A HEAL — a transient refusal now churns a church-wide re-sign before the card even says "Needs attention": ' + JSON.stringify(one));
  const two = [];
  const k2 = relaysCard({
    autoSyncHeal: async (o) => { two.push(o); return {}; },
    relaySyncStates: async (onEach) => { const e = chip('refused', 'trust', 1700000200, 2); onEach(e); return [e]; },
  });
  k2.draw(); await settle(); k2.draw(); await settle();
  assert.deepEqual(two, [{ force: true }],
    'THE HEAL NO LONGER FIRES AT THE 2-PASS THRESHOLD — the a8 shape stays broken: ' + JSON.stringify(two));
});

// ── POINT OF USE 3: a Connect that landed un-tombstones the box, THEN queues a forced heal, each in its own
// queue slot (never nested) ──────────────────────────────────────────────────────────────────────────────
test("POINT OF USE: signRelay's success path un-tombstones the proved box then queues a forced heal; a failed or unknown signing does neither", async () => {
  const mk = (enrolResult) => {
    const order = [];
    const scope = {
      enrolSerial: (fn) => { order.push('slot'); return Promise.resolve().then(fn).then((v) => { order.push('slot-end'); return v; }); },
      enrolRelayNet: async () => (enrolResult instanceof Error ? Promise.reject(enrolResult) : enrolResult),
      // A2: the one un-tombstone path. signRelay must clear the proved key from the removal tombstones so the
      // forced heal that follows does not refuse the box the steward just chose to re-add.
      _writeTombstone: async (o) => { order.push('untomb:' + JSON.stringify((o && o.remove) || null)); return { wrote: true }; },
      autoSyncHeal: async (opts) => { order.push('heal:' + JSON.stringify(opts)); return {}; },
      sharedRelayKeys: () => [],   // B2 (2026-11-22): signRelay never clears a shared relay key's tombstone; none shipped in this fixture
      // A2 (2026-11-22): signRelay goes through the REAL _adoptRelay (lifted below). Its backfill is answered "landed"
      // (run for real in an-adopted-relay-gets-the-safeguarding-documents.test.mjs) and takes no queue slot, so the
      // slot order asserted below is unchanged.
      sk: new Uint8Array(32).fill(7), pub: PUB, actingChurch: '', _viewingNetwork: () => false,
      _backfillSafeguardTo: async () => ({ landed: true, results: {} }), _setOwedBackfill: () => {},
      Promise, JSON, String,
    };
    const proxy = new Proxy(scope, {
      has: (t, k) => (k in t) || !(String(k) in globalThis),
      get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; throw new ReferenceError('lifted signRelay needs ' + String(k)); },
      set: (t, k, v) => { t[k] = v; return true; },
    });
    const api = new Function('scope', 'with (scope) { ' +
      fnBody(BUNDLE, 'function normRelay(input) {', 'normRelay') + '\n' + fnBody(BUNDLE, 'async function _adoptRelay(u) {', '_adoptRelay') + '\n' + fnBody(BUNDLE, 'function _signedIn(r, u) {', '_signedIn') + '\nreturn { ' +
      fnBody(BUNDLE, '  signRelay(url) {', 'signRelay in the shipped bundle') + ' }; }')(proxy);
    return { api, order };
  };
  // B2 (2026-11-22, audit F3): the enrol proves the box SERVING this console too (KEY_B here), and signRelay used to
  // clear every proved key. Only the key proved at the address being added may be un-tombstoned.
  const ok = mk({ published: true, proven: [{ url: 'wss://own.example/relay', pubkey: KEY_B }, { url: 'wss://x.example/relay', pubkey: KEY_A }], entries: [{ pubkey: KEY_A }] });
  await ok.api.signRelay('wss://x.example/relay');
  await settle(); await settle(); await settle();
  assert.deepEqual(ok.order, ['slot', 'slot-end', 'slot', 'untomb:["' + KEY_A + '"]', 'slot-end', 'heal:{"force":true}'],
    'A CONNECT THAT LANDED did not un-tombstone the box then heal, each in its OWN slot (nesting deadlocks, or the heal would refuse the box it just re-added): ' + JSON.stringify(ok.order));
  for (const [why, res] of [
    ['an unknown signing (a relay not answering)', { unknown: true, proven: [], entries: [] }],
    ['a signing that proved nothing and published nothing', { published: false, proven: [], unproven: ['x'], entries: [] }],
    ['a signing that threw', new Error('relay down')],
  ]) {
    const bad = mk(res);
    await bad.api.signRelay('wss://x.example/relay').catch(() => {});
    await settle(); await settle(); await settle();
    assert.ok(!bad.order.some(x => x.startsWith('heal')), why + ' still queued a heal: ' + JSON.stringify(bad.order));
    assert.ok(!bad.order.some(x => x.startsWith('untomb')), why + ' still un-tombstoned: ' + JSON.stringify(bad.order));
  }
});
