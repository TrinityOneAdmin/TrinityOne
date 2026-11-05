// A REQUESTED CHURCH OPENS THE MOMENT IT IS GRANTED.
// Run: node --test scripts/a-requested-church-opens-the-moment-it-is-granted.test.mjs
//
// Device-found 2026-11-05 (owner): when a would-be helper SCANS/ENTERS a church's invite and is then
// approved, their steward console must AUTO-SELECT (open) that church. Before this fix the church only
// appeared in the identity switcher and the helper had to tap it; the sole auto-select was the generic
// blank-helper auto-land on the NEXT app load, which does not open the church they just asked to join and
// is deliberately NON-persisted (a device-local "blank own church" guess must never park an owner in a
// church they merely steward — see subscribeStewardedChurches).
//
// THE FIX, in three functions of the SHIPPED bundle (vendor/steward.js), lifted and driven below:
//   • requestSteward(payload) records the requested church pubkey in localStorage under
//     'trinityone.steward.pending-church' — ONLY on a request that actually published, never on a guess.
//   • subscribeStewardedChurches consumes it: at BOOT, if that church is already on the roster, it opens it;
//     and LIVE, when the grant arrives on the discovery read, it opens it. Either way it PERSISTS the choice
//     (it is the church the user deliberately joined) and CLEARS the pending record.
//   • The pending auto-select takes PRIORITY over a stale remembered `want` and over the blank-helper
//     auto-land, because the scan/paste is the most recent DELIBERATE action.
//
// WHAT IS NOT WIDENED (MED-SAFETY): the auto-select fires ONLY when a pending record is present — i.e. only
// for a church the helper explicitly requested. A church arriving on the roster with no pending record is a
// no-op (the CONTROL at the end, and the point-of-use control in
// a-delegated-steward-reaches-the-church-that-granted-them.test.mjs). The generic auto-land's non-persist
// behaviour is untouched.
//
// HOW IT ASSERTS. The functions are lifted out of the shipped bundle into one scope (the same technique and
// stubs as a-delegated-steward-reaches-the-church-that-granted-them.test.mjs). The assertion is on the
// engine's active identity (`pub`/`actingChurch`), the persisted ACTIVE_ID_KEY, and the pending record —
// the observable effects of "the console opened the church" — never on text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const CANON = 'wss://app.trinityone.church/relay';
const ORIGIN = 'http://127.0.0.1:8000';
const BOX = 'ws://127.0.0.1:8000/relay';
const ME = 'ee'.repeat(32);        // the helper's own key — a church nowhere
const CHURCH = 'cc'.repeat(32);    // the church whose invite they scanned, and whose roster later names ME
const OTHER = 'dd'.repeat(32);     // a DIFFERENT church they also steward — must never be opened by a scan of CHURCH
const STEWARDS_D = 'trinityone/stewards:';
const STEWARDREQ_D = 'trinityone/stewardreq:';
const ACTIVE_ID_KEY = 'trinityone.steward.active-id';
const PENDING = 'trinityone.steward.pending-church';

function proxyOf(stubs) {
  return new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, '');
      if (base in t) return t[base];
      throw new ReferenceError('the lifted function needs `' + String(k) + '` — add a stub');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
}

function fakeWindow() {
  const ls = new Map();
  return {
    addEventListener(t, f) { if (!ls.has(t)) ls.set(t, new Set()); ls.get(t).add(f); },
    removeEventListener(t, f) { const s = ls.get(t); if (s) s.delete(f); },
    dispatchEvent(e) { const s = ls.get(e.type); if (s) [...s].forEach(f => f(e)); return true; },
  };
}

// One console's world. Mirrors the sibling delegated-steward test's harness; adds requestSteward +
// parseStewardInvite and exposes the store so a test can seed/read the pending record and ACTIVE_ID_KEY.
function harness({ pending = '', proven = [BOX, CANON], seedStewarded = [] } = {}) {
  const store = new Map();
  if (pending) store.set(PENDING, pending);
  const subs = [];
  const refreshes = [];
  const admitted = new Set();
  const win = fakeWindow();
  const stewardedChurches = new Map();
  seedStewarded.forEach(([cp, name]) => stewardedChurches.set(cp, { name }));
  const stubs = {
    churchSk: new Uint8Array(32).fill(7), churchPub: ME, pub: ME, sk: new Uint8Array(32).fill(7), actingChurch: '',
    stewardedChurches,
    _ownKeyBlank: () => false,   // a NON-blank owner: the pending auto-select must still fire (it is a deliberate request)
    netKeys: () => [],
    npubEncode: (p) => 'npub_' + p,
    toPubHex: (x) => (/^[0-9a-f]{64}$/i.test(x) ? x.toLowerCase() : null),
    privateKeyFromSeedWords: () => { throw new Error('not a network key'); }, getPublicKey: () => '',
    NET: 'trinityone', STEWARDS_D, STEWARDREQ_D, STEWARDREVOKE_D: 'trinityone/stewardrevoke:', ACTIVE_ID_KEY, PENDING_CHURCH_KEY: PENDING,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    lsSet: (k, v) => store.set(k, v),
    lsGet: (k) => (store.has(k) ? store.get(k) : null),
    CANONICAL_RELAYS: [CANON], CANONICAL_RELAY: CANON,
    extraRelays: () => [],
    location: { protocol: 'http:', host: '127.0.0.1:8000', hostname: '127.0.0.1' },
    _ownOrigin: () => ORIGIN,
    _boxHostsUs: false,
    _refreshBoxHostsUs: () => Promise.resolve(),
    _gate: {
      admit: (list) => list.filter(u => admitted.has(u)),
      refresh: (list) => new Promise(res => { list.forEach(u => { if (proven.includes(u)) admitted.add(u); }); res(list.filter(u => admitted.has(u))); }),
    },
    pool: { subscribeMany(urls, filters, handlers) { const rec = { urls: [...urls], filters, handlers, closed: false, close() { rec.closed = true; } }; subs.push(rec); return rec; } },
    // per-church state setActiveIdentity resets — cells, nothing more
    lastProfile: { name: 'Helper' }, _profileLoaded: false, _clearanceSent: new Map(),
    _careRoster: new Set(), _careRosterKnown: false, _careRosterSeen: false,
    _stewardCaps: {}, _stewardNames: {}, _stewardNamesCt: '', _stewardSince: {},
    _nameKeyRing: [], _nameKeyDocKeys: null, _nameKeyChecked: false, _localBlocked: new Set(), _localBlockedAt: 0, _blockedLastSet: () => new Set(),
    _applyNoPhotoList: () => {}, CAP_KEYS: {}, _capState: {}, _checkinMigrated: '',
    _ckKeysSettled: '', _ckSessionKeys: new Map(),
    _keyReadEpoch: 0, _careKeyVer: 0, _mediaKeyVer: 0,
    _latestGuardNotice: new Map(), _senvPending: new Map(), _minorsLastClear: () => {},
    // requestSteward's publishing path — stubbed to a request that goes out (truthy publish)
    publish: () => Promise.resolve(true),
    finalizeEvent: (e) => e, _monotonic: (e) => e, now: () => 0,
    nip44e: () => '', nip44ck: () => '',
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    window: Object.assign(win, { Steward: {} }),
  };
  const scope = proxyOf(stubs);
  const lift = (anchor, name) => new Function('scope', `with (scope) { return (${fnBody(VENDOR, anchor, name)}); }`)(scope);
  stubs.ownRelay = lift('function ownRelay() {', 'ownRelay');
  stubs.relaysRaw = lift('function relaysRaw() {', 'relaysRaw');
  stubs._boxHostsKey = lift('function _boxHostsKey() {', '_boxHostsKey');
  stubs._loadBoxHosts = lift('function _loadBoxHosts() {', '_loadBoxHosts');
  const method = (anchor, name) => new Function('scope', `with (scope) { return ({ ${fnBody(VENDOR, anchor, name)} }).${name}; }`)(scope);
  const subscribe = method('subscribeStewardedChurches(cb) {', 'subscribeStewardedChurches');
  const switchTo = method('setActiveIdentity(targetPub, { persist = true } = {}) {', 'setActiveIdentity');
  const request = method('requestSteward(payload) {', 'requestSteward');
  const parse = method('parseStewardInvite(payload) {', 'parseStewardInvite');
  stubs.window.Steward.setActiveIdentity = (p, opts) => switchTo.call(stubs.window.Steward, p, opts);
  stubs.window.Steward.subscribeStewardedChurches = (cb) => subscribe.call(stubs.window.Steward, cb);
  stubs.window.Steward.parseStewardInvite = (p) => parse.call(stubs.window.Steward, p);
  stubs.window.Steward.requestSteward = (p) => request.call(stubs.window.Steward, p);
  return {
    stubs, store, subs,
    subscribe: (cb) => subscribe.call(stubs.window.Steward, cb),
    requestSteward: (p) => request.call(stubs.window.Steward, p),
    discovery: () => subs.filter(s => s.filters.some(f => f.kinds && f.kinds.includes(30078))),
    // the owner's roster for a church, naming ME, arriving on the discovery read
    grant: (sub, church) => sub.handlers.onevent({
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', STEWARDS_D + church], ['t', 'trinityone']],
      content: JSON.stringify({ pubkeys: [ME] }),
    }),
  };
}
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

// ── The request records the pending church (the path INTO the feature) ──────────────────────────────────

test('requestSteward records the scanned church as pending — and only when the request actually goes out', async () => {
  const h = harness();
  const res = await h.requestSteward('trinityone-stewardinvite:' + CHURCH);
  assert.equal(res && res.ok, true, 'staging: the request did not report sent');
  assert.equal(res.church, CHURCH, 'staging: the request named the wrong church');
  assert.equal(h.store.get(PENDING), CHURCH, 'the scanned church was not recorded as pending — nothing will auto-open on grant');
});

test('a request that never published records NOTHING pending (a request nobody received leaves no guess)', async () => {
  const h = harness();
  h.stubs.publish = () => Promise.resolve(false);   // the relay refused / nobody received it
  const res = await h.requestSteward('trinityone-stewardinvite:' + CHURCH);
  assert.equal(res, null, 'staging: a failed publish must not report sent');
  assert.equal(h.store.has(PENDING), false, 'a request that was never received still left a pending record');
});

// ── LIVE: the grant arrives while this console watches ──────────────────────────────────────────────────

test('LIVE: the grant for the requested church arrives and the console opens it automatically, pending cleared', async () => {
  const h = harness({ pending: CHURCH });
  const lists = [];
  h.subscribe(l => lists.push(l));
  await tick(5);
  const d = h.discovery();
  assert.equal(d.length, 1, 'no discovery read opened');
  assert.equal(h.stubs.actingChurch, '', 'staging: the console is not acting as any church before the grant');
  h.grant(d[0], CHURCH);
  assert.equal(h.stubs.pub, CHURCH, 'the grant landed and the console did NOT open the requested church (pub not rebound)');
  assert.equal(h.stubs.actingChurch, CHURCH, 'the console is not acting as the requested church after the grant');
  assert.equal(h.store.get(ACTIVE_ID_KEY), CHURCH, 'the deliberate choice was not persisted — a reopen would not return here');
  assert.equal(h.store.has(PENDING), false, 'the pending record was not cleared after the church opened');
  assert.deepEqual(lists[lists.length - 1], [CHURCH], 'the switcher was not told the church is now stewarded');
});

test('LIVE: a grant for a DIFFERENT church than the one requested does NOT auto-open (pending stays)', async () => {
  const h = harness({ pending: CHURCH });
  h.subscribe(() => {});
  await tick(5);
  const d = h.discovery();
  h.grant(d[0], OTHER);   // some other church we steward is granted first
  assert.equal(h.stubs.actingChurch, '', 'a church we did NOT request auto-opened the console');
  assert.equal(h.store.get(PENDING), CHURCH, 'the pending request for the real church was wrongly consumed');
  // …and when the real one finally arrives, THAT opens
  h.grant(d[0], CHURCH);
  assert.equal(h.stubs.actingChurch, CHURCH, 'the requested church arrived and still did not open');
  assert.equal(h.store.has(PENDING), false, 'pending not cleared once the requested church opened');
});

// ── BOOT: the grant landed while the app was closed; the church is already cached at startup ─────────────

test('BOOT: pending persisted + the church already on the roster at startup → it opens, pending cleared', async () => {
  const h = harness({ pending: CHURCH, seedStewarded: [[CHURCH, 'St Aidan']] });
  assert.equal(h.stubs.actingChurch, '', 'staging: nothing acting before subscribe');
  h.subscribe(() => {});
  assert.equal(h.stubs.pub, CHURCH, 'at boot the requested-and-granted church did not open');
  assert.equal(h.stubs.actingChurch, CHURCH, 'at boot the console is not acting as the requested church');
  assert.equal(h.store.get(ACTIVE_ID_KEY), CHURCH, 'the choice was not persisted at boot');
  assert.equal(h.store.has(PENDING), false, 'the pending record survived the boot open');
});

test('BOOT PRIORITY: pending beats a stale remembered `want` for a different church', async () => {
  const h = harness({ pending: CHURCH, seedStewarded: [[CHURCH, 'St Aidan'], [OTHER, 'Old Choice']] });
  h.store.set(ACTIVE_ID_KEY, OTHER);   // last session was running OTHER
  h.subscribe(() => {});
  assert.equal(h.stubs.actingChurch, CHURCH, 'the freshly-requested church did not win over the stale remembered one');
  assert.equal(h.store.get(ACTIVE_ID_KEY), CHURCH, 'the pending church was not persisted as the new remembered choice');
  assert.equal(h.store.has(PENDING), false, 'pending not cleared');
});

test('BOOT: pending set but the church NOT yet on the roster → nothing opens, pending kept for the live path', async () => {
  const h = harness({ pending: CHURCH });   // not granted yet
  h.subscribe(() => {});
  assert.equal(h.stubs.actingChurch, '', 'a church that is not yet on the roster was opened at boot');
  assert.equal(h.store.get(PENDING), CHURCH, 'the pending record was dropped before the grant could ever arrive');
});

// ── CONTROL: no pending record → the grant is a no-op (the generic auto-land is untouched) ───────────────

test('CONTROL: with NO pending record, a grant does NOT auto-open the church (the generic case is unchanged)', async () => {
  const h = harness();   // no pending
  h.subscribe(() => {});
  await tick(5);
  const d = h.discovery();
  h.grant(d[0], CHURCH);
  assert.equal(h.stubs.actingChurch, '', 'a church with no pending request auto-opened — the auto-select was widened');
  assert.equal(h.store.has(ACTIVE_ID_KEY), false, 'a non-requested grant wrote the persisted active id');
  assert.ok(h.stubs.stewardedChurches.has(CHURCH), 'staging: the church should still be recorded as stewarded');
});
