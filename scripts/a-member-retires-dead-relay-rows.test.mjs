// C2 (PLAN-relay-autoconnect-selfhealing-sync-2026-11-20 §C2, audit finding 14/16 + re-audit finding 1/4).
// The member app's relay revocation survives a RESTART, and rows no church vouches for retire — without ever
// dropping a box that is only briefly down, and without disabling the tunnel-move name re-resolution.
//
// Run: node --test scripts/a-member-retires-dead-relay-rows.test.mjs
//
// POINT OF USE (CLAUDE.md rule 1): the SHIPPED vendor/fellowship.js is sliced and RUN — _applyChurchList (the
// restart-burn baseline), _retireDeadRows (the two-strike retire), _reResolveRelayName (the healer the baseline
// must not disable), and _signedAssociation. The leaf deps (_relayInfo, verifyRelayIdentityDetailed, the pool,
// the gate) are stubbed so the test drives a scripted network; everything under test is the real bundle. Delete
// the baseline and test 1/2 go red; seed _churchRelays from the baseline and test 2 goes red; count an
// unreachable box as a strike and test 4 goes red. Nothing matches text in app/*.jsx (rule 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stmt } from './test-slice.mjs';

const FELLOW = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const BACKUP = readFileSync(new URL('../app/backup.jsx', import.meta.url), 'utf8');

const CANON = ['wss://shared.trinityone.church/relay'];   // the shipped pool — never burned, never retired

function scopeOf(stubs) {
  return new Proxy(stubs, {
    // trap a name only when it is stubbed OR is not a real global — so built-ins (Boolean, String, Math…)
    // resolve to the genuine global instead of raising, while an un-stubbed non-global still fails loudly.
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      throw new ReferenceError('the lifted code needs `' + String(k) + '` — add a stub for it');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
}

// A memory localStorage, seeded from a plain object of {key: value|jsonable}.
function memStore(seed = {}) {
  const m = new Map();
  for (const k of Object.keys(seed)) m.set(k, typeof seed[k] === 'string' ? seed[k] : JSON.stringify(seed[k]));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    _dump: () => Object.fromEntries(m),
    _raw: m,
  };
}

// Build the member engine out of the bundle. `relayInfo` and `verifyDetailed` are the scripted network.
function memberOn({ store, relays, churchPub, relayInfo = () => null, verifyDetailed = () => ({ proof: null, reached: false }), resolveName = async () => null }) {
  const src = FELLOW;
  const pool = { close: (urls) => { pool.closed.push(...(urls || [])); }, closed: [] };
  const gate = { forget: (u) => { gate.forgotten.push(u); }, forgotten: [], admits: () => false, refresh: async () => [] };
  const win = {
    Fellowship: {
      relays: [...relays], churchPub,
      addRelay: (u) => { if (!win.Fellowship.relays.includes(u)) win.Fellowship.relays.push(u); },
      removeRelay: (u) => { win.Fellowship.relays = win.Fellowship.relays.filter(x => x !== u); },
      setRelays: (u) => { win.Fellowship.relays = [...u]; },
      resolveRelayName: resolveName,
    },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
  };
  const body = [
    stmt(src, 'var _churchRelays = ', '_churchRelays'),
    stmt(src, 'var _churchList = ', '_churchList'),
    stmt(src, 'var _applying = ', '_applying'),
    stmt(src, 'var LISTHW_KEY = ', 'LISTHW_KEY'),
    fnBody(src, 'function _loadHW', '_loadHW'),
    fnBody(src, 'function _saveHW', '_saveHW'),
    stmt(src, 'var CHURCH_BOXES_KEY = ', 'CHURCH_BOXES_KEY'),
    fnBody(src, 'function _loadChurchBoxes', '_loadChurchBoxes'),
    fnBody(src, 'function _saveChurchBoxes', '_saveChurchBoxes'),
    fnBody(src, 'function _dropChurchBoxes', '_dropChurchBoxes'),
    fnBody(src, 'function _maybeDropRelay', '_maybeDropRelay'),
    fnBody(src, 'function _netdocNamesUrl', '_netdocNamesUrl'),
    fnBody(src, 'function _otherChurchPersistsBox', '_otherChurchPersistsBox'),
    stmt(src, 'var _burnBaselineDone = ', '_burnBaselineDone'),
    fnBody(src, 'async function _applyChurchList', '_applyChurchList'),
    stmt(src, 'var _resolving = ', '_resolving'),
    fnBody(src, 'async function _reResolveRelayName', '_reResolveRelayName'),
    stmt(src, 'var DEAD_STRIKES_KEY = ', 'DEAD_STRIKES_KEY'),
    stmt(src, 'var RETIRE_STRIKES = ', 'RETIRE_STRIKES'),
    stmt(src, 'var RETIRE_PROBE_CAP = ', 'RETIRE_PROBE_CAP'),
    stmt(src, 'var _retiring = ', '_retiring'),
    fnBody(src, 'function _loadStrikes', '_loadStrikes'),
    fnBody(src, 'function _saveStrikes', '_saveStrikes'),
    fnBody(src, 'function _signedAssociation', '_signedAssociation'),
    fnBody(src, 'async function _retireDeadRows', '_retireDeadRows'),
  ].join('\n');

  // GUARDS ON THE LIFT: the load-bearing lines must be inside the slices that are about to run, or the
  // assertions below would pass over nothing.
  assert.match(body, /_burnBaselineDone\.add\(cp\)/, 'vendor/fellowship.js: the restart-burn baseline is gone from _applyChurchList (finding 14)');
  assert.doesNotMatch(fnBody(src, 'async function _applyChurchList', '_applyChurchList'),
    /_churchRelays\.get\(cp\)\.set\([^)]*baseline/i, 'sanity');
  assert.match(body, /if \(!detail \|\| !detail\.reached\)/, 'vendor/fellowship.js: _retireDeadRows no longer distinguishes unreachable (briefly-down protection gone — finding 16)');

  const scope = scopeOf({
    localStorage: store, window: win, pool, console,
    CANONICAL_RELAYS: CANON, DEFAULT_RELAYS: [], CANONICAL_RELAY_PUBS: { 'wss://shared.trinityone.church/relay': ['canonkey'] },
    _relayInfo: async (u) => relayInfo(u),
    verifyRelayIdentityDetailed: async (u) => verifyDetailed(u),
    isNetworkRelay: async () => true,
    _gate: gate,
    JSON, Set, Map, Promise, Number, Object, Array, String,
  });
  const api = new Function('scope', `with (scope) {
    ${body}
    return {
      applyChurchList: _applyChurchList, retireDeadRows: _retireDeadRows, reResolveRelayName: _reResolveRelayName,
      signedAssociation: _signedAssociation, loadStrikes: _loadStrikes,
      churchRelays: _churchRelays, churchList: _churchList,
    };
  }`)(scope);
  return { api, win, pool, gate, store, relays: () => win.Fellowship.relays };
}

const CP = 'cp-church-aaaa';

// ── 1. REVOCATION SURVIVES A RESTART: a persisted row the church dropped is burned on the first list apply ──
test('1. a stale persisted row is burned after a restart; a still-wanted row is kept', async () => {
  const store = memStore({
    'trinityone.churchboxes': { [CP]: ['wss://removed.example/relay', 'wss://kept.example/relay'] },
  });
  const m = memberOn({
    store,
    relays: ['wss://removed.example/relay', 'wss://kept.example/relay', ...CANON],
    churchPub: CP,
    relayInfo: (u) => (u === 'wss://kept.example/relay' ? { enforces: true, relayPub: 'keptkey' } : null),
  });
  // the church's newest 10002 wants only the kept box (removed is gone from its list)
  m.api.churchList.set(CP, { at: 100, want: new Set(['wss://kept.example/relay']) });
  await m.api.applyChurchList(CP);

  assert.ok(!m.relays().includes('wss://removed.example/relay'), 'the removed row survived the restart — the in-memory-only burn bug (finding 14)');
  assert.ok(m.pool.closed.includes('wss://removed.example/relay'), 'the removed row was not closed on the pool');
  assert.ok(m.relays().includes('wss://kept.example/relay'), 'the wanted box was dropped');
  const persisted = JSON.parse(store.getItem('trinityone.churchboxes'))[CP];
  assert.ok(!persisted.includes('wss://removed.example/relay'), 'the removed row is still persisted — it will come back next restart');
});

// ── 2. THE BASELINE DOES NOT SEED _churchRelays, so _reResolveRelayName (the tunnel-move healer) still runs ──
// re-audit finding 1 (HIGH). A guard-kept baseline row must not enter the live map, and a church whose boxes
// are all down at boot must still re-resolve its name after the baseline runs.
test('2. the burn baseline is NOT written into _churchRelays, and _reResolveRelayName is not short-circuited', async () => {
  const store = memStore({
    'trinityone.churchboxes': { [CP]: ['wss://stale.example/relay'] },
    'trinityone.relaynames': { [CP]: 'ourbox' },
  });
  let resolved = 0;
  const m = memberOn({
    store,
    relays: [...CANON],                 // the church's own boxes are all offline at boot
    churchPub: CP,
    relayInfo: () => null,              // nothing enforces/reachable this boot
    resolveName: async () => { resolved++; return { url: 'wss://ourbox-moved.example/relay' }; },
  });
  // the church wants a box that is unreachable this boot (briefly down), so adoption adopts nothing
  m.api.churchList.set(CP, { at: 100, want: new Set(['wss://ourbox.example/relay']) });
  await m.api.applyChurchList(CP);

  const live = m.api.churchRelays.get(CP);
  assert.ok(!live || live.size === 0, 're-audit finding 1: the baseline seeded _churchRelays with dead rows — this permanently disables _reResolveRelayName');
  assert.ok(!m.relays().includes('wss://stale.example/relay'), 'the stale baseline row was not burned');

  resolved = 0;
  await m.api.reResolveRelayName(CP);
  assert.equal(resolved, 1, 're-audit finding 1: _reResolveRelayName short-circuited — the baseline poisoned the "boxes already working" test');
});

// ── 2b. a baseline row NAMED by the persisted relay-net record is protected (re-audit finding 4) ───────────
test('2b. a baseline row the newest persisted relay-net record names is never burned', async () => {
  const store = memStore({
    'trinityone.churchboxes': { [CP]: ['wss://netdoc-box.example/relay'] },
    'trinityone.relays.netdoc': { [CP]: { hw: 5, rows: { 'wss://netdoc-box.example/relay': 'ndkey' } } },
  });
  const m = memberOn({ store, relays: ['wss://netdoc-box.example/relay', ...CANON], churchPub: CP, relayInfo: () => null });
  m.api.churchList.set(CP, { at: 100, want: new Set() });   // the 10002 names nothing — but the netdoc does
  await m.api.applyChurchList(CP);
  assert.ok(m.relays().includes('wss://netdoc-box.example/relay'), 're-audit finding 4: a row the relay-net record names was burned');
  // …and it was NOT seeded into the live map either
  const live = m.api.churchRelays.get(CP);
  assert.ok(!live || !live.has('wss://netdoc-box.example/relay'));
});

// ── 3. TWO-STRIKE RETIRE: a row reached twice with no signed association is dropped ────────────────────────
test('3. a row reached twice that proves a key with no signed association is retired on the second strike', async () => {
  const store = memStore({});
  const m = memberOn({
    store,
    relays: ['wss://ghost.example/relay', ...CANON],
    churchPub: CP,
    verifyDetailed: () => ({ proof: { relayPub: 'ghostkey' }, reached: true }),   // answers, proves a key nobody signed
  });
  await m.api.retireDeadRows(CP);
  assert.equal(m.api.loadStrikes()['wss://ghost.example/relay'], 1, 'first reach did not record a strike');
  assert.ok(m.relays().includes('wss://ghost.example/relay'), 'retired on the FIRST strike — one answer is not two');

  await m.api.retireDeadRows(CP);
  assert.ok(!m.relays().includes('wss://ghost.example/relay'), 'a row reached twice with no association was not retired');
  assert.ok(m.pool.closed.includes('wss://ghost.example/relay'), 'the retired row was not closed on the pool');
  assert.ok(m.gate.forgotten.includes('wss://ghost.example/relay'), 'the gate still holds the retired row as proved');
  assert.equal(m.api.loadStrikes()['wss://ghost.example/relay'], undefined, 'the strike count was not cleared on retirement');
});

// ── 4. UNREACHABLE NEVER COUNTS (briefly-down protection) ─────────────────────────────────────────────────
test('4. a row that is unreachable on every pass is never retired, and never accrues a strike', async () => {
  const store = memStore({});
  const m = memberOn({
    store,
    relays: ['wss://sleeping.example/relay', ...CANON],
    churchPub: CP,
    verifyDetailed: () => ({ proof: null, reached: false }),   // the HTTP probe gets no answer
  });
  await m.api.retireDeadRows(CP);
  await m.api.retireDeadRows(CP);
  await m.api.retireDeadRows(CP);
  assert.ok(m.relays().includes('wss://sleeping.example/relay'), 'a briefly-down box was retired — the core requirement this feature must never break');
  assert.equal(m.api.loadStrikes()['wss://sleeping.example/relay'], undefined, 'an unreachable pass counted as a strike');
});

// ── 4b. a strike RESETS on an intervening unreachable pass (strikes must be CONSECUTIVE) ───────────────────
test('4b. reached-bad, then unreachable, then reached-bad does not retire (not two consecutive)', async () => {
  const store = memStore({});
  let reachable = true;
  const m = memberOn({
    store, relays: ['wss://flaky.example/relay', ...CANON], churchPub: CP,
    verifyDetailed: () => (reachable ? { proof: { relayPub: 'flakykey' }, reached: true } : { proof: null, reached: false }),
  });
  await m.api.retireDeadRows(CP);                               // strike 1
  assert.equal(m.api.loadStrikes()['wss://flaky.example/relay'], 1);
  reachable = false; await m.api.retireDeadRows(CP);           // unreachable → reset
  assert.equal(m.api.loadStrikes()['wss://flaky.example/relay'], undefined, 'an unreachable pass did not reset the consecutive count');
  reachable = true; await m.api.retireDeadRows(CP);            // strike 1 again
  assert.ok(m.relays().includes('wss://flaky.example/relay'), 'retired on non-consecutive strikes');
});

// ── 5. ASSOCIATION is signed sources only; a row with one is protected; NIP-11 relayPub is never one ───────
test('5. a row whose proved key is in the netdoc/10002/canonical is kept; _signedAssociation ignores NIP-11 relayPub', async () => {
  const store = memStore({
    'trinityone.relays.netdoc': { [CP]: { hw: 9, rows: { 'wss://assoc.example/relay': 'assockey' } } },
  });
  const m = memberOn({
    store, relays: ['wss://assoc.example/relay', ...CANON], churchPub: CP,
    verifyDetailed: () => ({ proof: { relayPub: 'assockey' }, reached: true }),
  });
  await m.api.retireDeadRows(CP);
  await m.api.retireDeadRows(CP);
  assert.ok(m.relays().includes('wss://assoc.example/relay'), 'a row whose proved key the netdoc signed was retired');
  assert.equal(m.api.loadStrikes()['wss://assoc.example/relay'], undefined, 'an associated row accrued a strike');

  // _signedAssociation consults ONLY signed sources (netdoc proved key / 10002 want / canonical pin):
  assert.equal(m.api.signedAssociation(CP, 'wss://assoc.example/relay', 'assockey'), true, 'netdoc-proved key not recognised');
  assert.equal(m.api.signedAssociation(CP, 'wss://shared.trinityone.church/relay', 'canonkey'), true, 'canonical pin key not recognised');
  // a key a box merely ECHOES (NIP-11 relayPub) that nothing signed is NOT an association:
  assert.equal(m.api.signedAssociation(CP, 'wss://assoc.example/relay', 'a-relaypub-nobody-signed'), false, 'rule 10: an unauthenticated relayPub was treated as a signed association');
  // the 10002 want-set DOES associate (by url):
  m.api.churchList.set(CP, { at: 1, want: new Set(['wss://wanted.example/relay']) });
  assert.equal(m.api.signedAssociation(CP, 'wss://wanted.example/relay', 'anykey'), true, 'the newest 10002 want-set does not associate a row');
});

// ── 6. THE STRIKE KEY IS EXCLUDED FROM A MEMBER BACKUP (ROUTING_KEYS precedent) ───────────────────────────
// Lift and RUN the real snapshot() out of app/backup.jsx (plain JS, no JSX) against a store holding the strike
// key plus an allowed member key, and prove the strike key does not make it into the exported snapshot.
test('6. the dead-strike key is not swept into a member backup, and an allowed key is', () => {
  const body = [
    stmt(BACKUP, 'const ROUTING_KEYS = ', 'ROUTING_KEYS'),
    stmt(BACKUP, 'const SEED_CACHE_RX = ', 'SEED_CACHE_RX'),
    stmt(BACKUP, 'const MEMBER_PREFIXES = ', 'MEMBER_PREFIXES'),
    stmt(BACKUP, 'const MEMBER_EXACT = ', 'MEMBER_EXACT'),
    fnBody(BACKUP, 'function snapshot(prefixes, exact)', 'snapshot'),
  ].join('\n');
  const store = memStore({
    'trinityone.relays.deadstrikes': { 'wss://x/relay': 2 },
    'trinityone.mydata.journal': 'a kept member entry',
    'trinityone.profile': 'me',
  });
  const scope = scopeOf({ localStorage: store, JSON, Set, Object });
  const out = new Function('scope', `with (scope) { ${body} return snapshot(MEMBER_PREFIXES, MEMBER_EXACT); }`)(scope);
  assert.equal(out['trinityone.relays.deadstrikes'], undefined, 'the member dead-strike key leaked into a backup — a forged file could retire a live box early');
  assert.ok('trinityone.mydata.journal' in out, 'the backup dropped an allowed member key — the test is not exercising snapshot');
  assert.ok('trinityone.profile' in out, 'the exact member key was dropped');
  // and the real routing key it mirrors is excluded the same way:
  assert.equal(out['trinityone.relays.netdoc'], undefined);
});
