// THE HELPER'S CHURCH DISCOVERY READS EVERY CHURCH ONCE A SESSION, AND ONLY THE CHURCHES IT CAN NAME ON A RECONNECT.
//   Run: node --test scripts/the-helper-church-discovery-reads-every-church-once-a-session.test.mjs
//
// subscribeStewardedChurches (src/steward.src.js) is mounted by app/steward-root.jsx useStewardStewardedChurches and
// re-run on every connection bump. Its discovery read was `{ kinds: [30078], '#t': [NET] }` over every dialled relay
// — every church's corpus, each bump (measured live 2026-11-11: the console's sockets bump every ~16 s). It cannot be
// narrowed to "churches I asked to join" alone: a church can add a helper DIRECTLY, with no request (the owner's
// Helpers panel). So: the broad read once per unlocked session per relay set; on a bump, '#d' = the rosters of
// every church the console can name (stewarded ∪ requested ∪ pending), plus the revocation filter as before.
//
// Rule 1: subscribeStewardedChurches, setActiveIdentity, requestSteward's grant-side effects and lock() are lifted out
// of the SHIPPED bundle (vendor/steward.js) and run over a fake pool; the REQ filters asserted are the ones the
// lifted code handed the pool. Nothing here matches text in app/*.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const CANON = 'wss://app.trinityone.church/relay';
const ORIGIN = 'http://127.0.0.1:8000';
const BOX = 'ws://127.0.0.1:8000/relay';
const ME = 'ee'.repeat(32);        // the helper's own key
const STEWARDED = 'aa'.repeat(32); // a church already in the stewarded cache
const ASKED = 'bb'.repeat(32);     // a church we asked to join (requested set)
const PENDING = 'cc'.repeat(32);   // the church we are waiting on (PENDING_CHURCH_KEY)
const DIRECT = 'dd'.repeat(32);    // a church that added us directly, never asked
const STEWARDS_D = 'trinityone/stewards:';
const STEWARDREQ_D = 'trinityone/stewardreq:';
const REVOKE_D = 'trinityone/stewardrevoke:';
const SK = new Uint8Array(32).fill(7);
const REQ_KEY = 'trinityone.steward.requested.' + ME;
const CACHE_KEY = 'trinityone.steward.stewarded.' + ME;

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

const NOW = 1762300000;
function harness({ proven = [BOX, CANON], up = [] } = {}) {
  const store = new Map();
  let wall = 5_000_000;
  // nostr-tools' AbstractRelay objects, by url: `connected` decides whether the read is asked with no library timer
  const relaysMap = new Map(up.map(u => [u, { connected: true }]));
  const subs = [];
  const admitted = new Set(proven);
  const win = fakeWindow();
  const stewardedChurches = new Map();
  const stubs = {
    churchSk: SK, churchPub: ME, pub: ME, sk: SK, actingChurch: '', needsPin: false, currentMnemonic: 'x',
    stewardedChurches,
    _ownKeyBlank: () => false, netKeys: () => [], npubEncode: (p) => 'npub_' + p,
    toPubHex: (x) => (/^[0-9a-f]{64}$/i.test(x) ? x.toLowerCase() : null),
    privateKeyFromSeedWords: () => { throw new Error('not a network key'); }, getPublicKey: () => '',
    NET: 'trinityone', STEWARDS_D, STEWARDREQ_D, STEWARDREVOKE_D: REVOKE_D, ACTIVE_ID_KEY: 'active', PENDING_CHURCH_KEY: 'pending',
    ENC_LS: 'enc', _stay: { rearm() {} },
    _stewardedBroad: null,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    lsSet: (k, v) => store.set(k, v), lsGet: (k) => (store.has(k) ? store.get(k) : null),
    CANONICAL_RELAYS: [CANON], CANONICAL_RELAY: CANON, extraRelays: () => [],
    location: { protocol: 'http:', host: '127.0.0.1:8000', hostname: '127.0.0.1' },
    _ownOrigin: () => ORIGIN, _boxHostsUs: false, _refreshBoxHostsUs: () => Promise.resolve(),
    now: () => 1762300000, _monotonic: (t) => t, finalizeEvent: (t, key) => ({ ...t, pubkey: ME, sig: 'sig' }),
    publish: () => Promise.resolve(true),
    _gate: { admit: (list) => list.filter(u => admitted.has(u)), refresh: (list) => Promise.resolve(list.filter(u => admitted.has(u))) },
    Date: class extends Date { static now() { return wall; } },
    pool: {
      relays: relaysMap,
      subscribeMany(urls, filters, handlers) {
        const rec = { urls: [...urls], url: urls[0], filters, handlers, closed: false, close() { rec.closed = true; } };
        subs.push(rec);
        return rec;
      },
    },
    lastProfile: {}, _profileLoaded: false, _clearanceSent: new Map(),
    _careRoster: new Set(), _careRosterKnown: false, _careRosterSeen: false,
    _stewardCaps: {}, _stewardNames: {}, _stewardNamesCt: '', _stewardSince: {},
    _nameKeyRing: [], _nameKeyDocKeys: null, _nameKeyChecked: false, _localBlocked: new Set(), _localBlockedAt: 0, _blockedLastSet: () => new Set(),
    _applyNoPhotoList: () => {}, CAP_KEYS: {}, _capState: {}, _checkinMigrated: '',
    _ckKeysSettled: '', _ckSessionKeys: new Map(),
    _keyReadEpoch: 0, _careKeyVer: 0, _mediaKeyVer: 0,
    _latestGuardNotice: new Map(), _senvPending: new Map(),
    _minorsLastClear: () => {}, _sgClearClear: () => {}, _finBookClear: () => {}, _seedSweep: () => {},
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
  const lock = method('lock(reason) {', 'lock');
  const refresh = method('refreshStewardedChurches() {', 'refreshStewardedChurches');
  stubs.window.Steward.setActiveIdentity = (p, o) => switchTo.call(stubs.window.Steward, p, o);
  let lists = [];
  const h = {
    stubs, store, subs, stewardedChurches, relaysMap,
    late: (ms) => { wall += ms; },
    subscribe: () => subscribe.call(stubs.window.Steward, (l) => lists.push(l)),
    lists: () => lists,
    lock: () => lock.call(stubs.window.Steward),
    unlock: () => { stubs.sk = SK; stubs.pub = ME; stubs.churchSk = SK; stubs.churchPub = ME; },
    refresh: () => refresh.call(stubs.window.Steward),
    discovery: () => subs.filter(s => !s.closed && s.filters.some(f => f.kinds && f.kinds.includes(30078))),
    allDiscovery: () => subs.filter(s => s.filters.some(f => f.kinds && f.kinds.includes(30078))),
    // broad: the whole '#t' read (from the start, or resumed `since` where a cut-off one got to) — not the narrow
    // opening's "changed since the broad read finished" window, which is `since: NOW - 900`
    isBroad: (s) => s.filters.some(f => f.kinds.includes(30078) && f['#t'] && !f['#d'] && f.since !== NOW - 900),
    window: (s) => (s.filters.find(f => f['#t'] && !f['#d'] && f.since === NOW - 900) || null),
    on: (url) => h.discovery().find(s => s.url === url),
    rosterDs: (s) => { const f = s.filters.find(f => f['#d'] && f['#d'].every(d => d.startsWith(STEWARDS_D))); return f ? f['#d'] : null; },
    hasRevoke: (s) => s.filters.some(f => f['#d'] && f['#d'].length === 1 && f['#d'][0] === REVOKE_D + ME),
    roster: (s, cp, pubkeys, at = 1762300000) => s.handlers.onevent({ pubkey: cp, created_at: at, tags: [['d', STEWARDS_D + cp], ['t', 'trinityone']], content: JSON.stringify({ pubkeys }) }),
    revoke: (s, cp, at = 1762300100) => s.handlers.onevent({ pubkey: cp, created_at: at, tags: [['d', REVOKE_D + ME], ['t', 'trinityone']], content: JSON.stringify({ revoked: true }) }),
    eose: (s) => s.handlers.oneose(),
    eoseAll: () => { for (const s of h.discovery()) s.handlers.oneose(); },
    // one connection bump: the hook's effect cleanup closes the old handler, the new one mounts
    async bump(prev) { if (prev) prev(); const off = h.subscribe(); await tick(); return off; },
  };
  return h;
}
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

test('the first mount runs the broad read on EACH relay, with the revocation filter; it is marked done per relay only when that relay finishes', async () => {
  const h = harness();
  await h.bump();
  const d = h.discovery();
  assert.equal(d.length, 2, 'one discovery subscription per relay');
  assert.deepEqual(d.map(s => s.urls.length), [1, 1], 'a discovery subscription spans more than one relay — its EOSE could not say which relay answered');
  for (const s of d) {
    assert.ok(h.isBroad(s), 'the first opening of a session must be the broad discovery read');
    assert.ok(h.hasRevoke(s), 'the revocation filter is missing from the broad read');
  }
  assert.equal(h.stubs._stewardedBroad, null, 'marked done before it finished');
  h.eose(h.on(BOX)); await tick();
  assert.ok(h.stubs._stewardedBroad && h.stubs._stewardedBroad.me === ME, 'a finished broad read was not recorded');
  assert.deepEqual([...h.stubs._stewardedBroad.done.keys()], [BOX], 'done must name only the relay that answered');
});

test('across N reconnect bumps the broad read is issued ONCE per relay; every later REQ carries exactly the rosters it can name', async () => {
  const h = harness();
  h.store.set(CACHE_KEY, JSON.stringify([{ cp: STEWARDED, name: 'St A' }]));
  h.store.set(REQ_KEY, JSON.stringify([ASKED]));
  h.store.set('pending', PENDING);
  let off = await h.bump();
  h.eoseAll(); await tick();
  for (let i = 0; i < 5; i++) off = await h.bump(off);
  const all = h.allDiscovery();
  assert.equal(all.length, 12, '6 openings x 2 relays');
  assert.equal(all.filter(h.isBroad).length, 2, 'the broad read was issued more than once per relay in a session: ' + all.filter(h.isBroad).length);
  for (const s of all.slice(2)) {
    assert.deepEqual(h.rosterDs(s), [STEWARDS_D + STEWARDED, STEWARDS_D + ASKED, STEWARDS_D + PENDING].sort(), 'the reconnect REQ does not name exactly the stewarded ∪ requested ∪ pending rosters');
    assert.ok(h.hasRevoke(s), 'the revocation filter was dropped from the reconnect REQ');
    assert.ok(h.window(s), 'the reconnect REQ has no "changed since the broad read" window — a direct add mid-session is never seen');
  }
});

test('a broad read cut off before it finished is asked again at the next bump', async () => {
  const h = harness();
  let off = await h.bump();
  for (const s of h.discovery()) { h.eose(s); s.handlers.onclose && s.handlers.onclose(['1009 too slow']); }   // nostr-tools: oneose then onclose, same turn
  await tick();
  assert.ok(!h.stubs._stewardedBroad || h.stubs._stewardedBroad.done.size === 0, 'a read the relay cut off was recorded as finished');
  off = await h.bump(off);
  assert.ok(h.discovery().every(h.isBroad), 'the next opening did not run the broad read again');
});

test('ONE relay dropping (or CLOSING the REQ) while the other answers: done for the one that answered only; the other is broad again', async () => {
  for (const how of ['drop', 'CLOSED']) {
    const h = harness({ up: [BOX, CANON] });
    let off = await h.bump();
    h.eose(h.on(BOX));
    const c = h.on(CANON);
    h.eose(c); c.handlers.onclose([how === 'drop' ? 'relay connection closed' : 'rate-limited: too many subscriptions']);
    await tick();
    assert.deepEqual([...h.stubs._stewardedBroad.done.keys()], [BOX], how + ': the relay that did not answer was marked done');
    off = await h.bump(off);
    assert.ok(!h.isBroad(h.on(BOX)), how + ': the relay that answered should go narrow');
    assert.ok(h.isBroad(h.on(CANON)), how + ': THE RELAY THAT NEVER ANSWERED WAS NOT ASKED AGAIN — every church only it holds is lost for the session');
  }
});

test('nostr-tools\' own timer is not an answer: a relay still connecting is not marked done, and once it is up it is asked again from where it got to, with no timer', async () => {
  const h = harness({ proven: [BOX] });          // a fresh device: nothing connected yet
  await h.bump();
  const first = h.on(BOX);
  assert.equal(first.handlers.maxWait, undefined, 'staging: a relay still connecting keeps the library default timer');
  h.roster(first, STEWARDED, [], NOW - 50);      // oldest-first: an older roster, not one that lists us…
  h.relaysMap.set(BOX, { connected: true });     // …the socket is up and still sending…
  h.late(4400); h.eose(first); await tick();    // …when nostr-tools' 4.4 s timer fires
  assert.ok(!h.stubs._stewardedBroad || !h.stubs._stewardedBroad.done.has(BOX), 'THE LIBRARY TIMER WAS TAKEN FOR AN ANSWER');
  const again = h.on(BOX);
  assert.ok(again && again !== first, 'a timed-out broad read was not asked again once the relay was up');
  assert.ok(h.isBroad(again), 'the re-ask must be the broad read');
  assert.equal(again.filters.find(f => f['#t'] && !f['#d']).since, NOW - 50, 'the re-ask must RESUME from the newest event received, not download it all again');
  assert.equal(again.handlers.maxWait > 600000, true, 'a connected relay must not be given a wall-clock cutoff');
  // a slow pipe: the roster that lists us arrives long after any timer would have fired, and the church is found
  h.late(60000);
  h.roster(again, DIRECT, [ME]);
  assert.ok(h.stewardedChurches.has(DIRECT), 'A FRESH DEVICE ON A SLOW PIPE NEVER FOUND ITS CHURCH');
  h.eose(again); await tick();
  assert.ok(h.stubs._stewardedBroad.done.has(BOX), 'the genuine answer to the resumed read was not recorded');
});

test('a church that adds us DIRECTLY (no request) is discovered by the once-a-session broad read', async () => {
  const h = harness();
  const off = await h.bump();
  const s = h.discovery()[0];
  h.roster(s, DIRECT, [ME]);
  assert.ok(h.stewardedChurches.has(DIRECT), 'a church that added us without a request was not discovered');
  assert.ok(h.lists().some(l => l.includes(DIRECT)));
  // …and from then on it is one of the churches a reconnect names
  h.eoseAll(); await tick();
  await h.bump(off);
  assert.ok(h.rosterDs(h.discovery()[0]).includes(STEWARDS_D + DIRECT), 'a church found by the broad read is not named on the next reconnect');
});

test('a church that adds us DIRECTLY mid-session, after the broad read finished, is seen on the next reconnect with no lock/unlock', async () => {
  const h = harness();
  h.store.set(CACHE_KEY, JSON.stringify([{ cp: STEWARDED, name: 'St A' }]));
  let off = await h.bump();
  h.eoseAll(); await tick();
  off = await h.bump(off);
  const s = h.on(BOX);
  assert.ok(!h.isBroad(s), 'staging: expected the narrow read on a reconnect');
  assert.ok(!h.rosterDs(s).includes(STEWARDS_D + DIRECT), 'staging: the direct-add church is in no named set');
  const w = h.window(s);
  assert.ok(w, 'THE NARROW READ HAS NO "CHANGED SINCE" WINDOW — a church adding us directly is invisible until lock/unlock');
  assert.ok(w.since <= NOW - 900 && w.since > 0, 'the window must start at the broad read\'s finish, less the relays\' clock margin');
  h.roster(s, DIRECT, [ME], NOW + 30);           // the owner adds us on their Helpers panel; the roster is newer than the window
  assert.ok(h.stewardedChurches.has(DIRECT), 'a direct add mid-session was not discovered');
});

test('a revocation still lands on a reconnect (narrow read), and a roster dropping us still removes the church', async () => {
  const h = harness();
  h.store.set(CACHE_KEY, JSON.stringify([{ cp: STEWARDED, name: 'St A' }, { cp: DIRECT, name: 'St D' }]));
  let off = await h.bump();
  h.eoseAll(); await tick();
  off = await h.bump(off);
  const s = h.discovery()[0];
  assert.ok(!h.isBroad(s), 'staging: expected the narrow read on a reconnect');
  h.revoke(s, STEWARDED);
  assert.ok(!h.stewardedChurches.has(STEWARDED), 'a revocation notice on the reconnect read did not remove the church');
  h.roster(s, DIRECT, []);   // the church's roster no longer lists us
  assert.ok(!h.stewardedChurches.has(DIRECT), 'a roster without us on the reconnect read did not remove the church');
});

test('a request made while the read is open re-asks with that church named, so its grant is seen without a bump', async () => {
  const h = harness();
  await h.bump();
  h.eoseAll(); await tick();
  // what requestSteward does on a truthy publish: record the church, then tell the open read
  h.store.set(REQ_KEY, JSON.stringify([ASKED]));
  h.stubs.window.dispatchEvent(new h.stubs.CustomEvent('steward-stewarded-watch'));
  const s = h.discovery()[0];
  assert.deepEqual(h.rosterDs(s), [STEWARDS_D + ASKED], 'the open read was not re-asked with the requested church');
  h.roster(s, ASKED, [ME]);
  assert.ok(h.stewardedChurches.has(ASKED));
});

test('a lock ends the session: the next unlock runs the broad read again; so does refreshStewardedChurches', async () => {
  const h = harness();
  let off = await h.bump();
  h.eoseAll(); await tick();
  off = await h.bump(off);
  assert.ok(!h.isBroad(h.discovery()[0]), 'staging: expected the narrow read');
  h.lock(); h.unlock();
  off = await h.bump(off);
  assert.ok(h.discovery().every(h.isBroad), 'after a lock and unlock the broad read did not run again');
  h.eoseAll(); await tick();
  h.refresh();
  assert.ok(h.discovery().every(h.isBroad), 'refreshStewardedChurches did not re-run the broad read on the open subscription');
});
