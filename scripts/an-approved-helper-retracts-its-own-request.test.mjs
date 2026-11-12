// AN APPROVED HELPER RETRACTS ITS OWN STEWARDREQ, so it can never resurface on the owner's console.
// Run: node --test scripts/an-approved-helper-retracts-its-own-request.test.mjs
//
// THE BUG (device-found 2026-11-05, helper-delegation). A would-be helper's STEWARDREQ is a replaceable
// kind-30078 the requester signs. On approval it was never consumed — it sat on the relay for ever, hidden
// only by the owner-side filter `!stewardSet.has(r.pubkey)`. When the owner later REMOVED that helper,
// `!stewardSet.has` turned true again and the stale request reappeared under "Requests to help".
//
// THE FIX (client-only, Part 1). When the grant lands — the `listed && !had` branch of
// subscribeStewardedChurches, the same branch that records the church and auto-opens it — the helper publishes
// a TOMBSTONE of its OWN request: a kind-30078 at the SAME d-tag (STEWARDREQ_D + churchPub), empty content and
// a ['deleted'] tag, signed with churchSk (our own key — the author the owner approved). gateway.mjs:4847
// lets a requester replace its own STEWARDREQ. subscribeStewardRequests reads the deleted/empty copy as a
// retract. It fires only when we actually asked this church (a durable requested-set written by
// requestSteward), and drops cp from that set so it fires at most once.
//
// HOW IT ASSERTS (CLAUDE.md rules 1 & 3). subscribeStewardedChurches is lifted out of the SHIPPED bundle
// (vendor/steward.js) and driven with a real grant; the assertion is on the EVENT handed to the lifted
// publish() — kind, d-tag, deleted/empty, signer — never on text in a source file. The two controls prove the
// retract does not fire for a church we never requested, and that a non-grant event publishes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const CANON = 'wss://app.trinityone.church/relay';
const ORIGIN = 'http://127.0.0.1:8000';
const BOX = 'ws://127.0.0.1:8000/relay';
const ME = 'ee'.repeat(32);        // the helper's own key — a church nowhere, the signer the owner approves
const CHURCH = 'cc'.repeat(32);    // the church whose roster names ME
const OTHER = 'dd'.repeat(32);     // a church we were granted but never asked to join
const STEWARDS_D = 'trinityone/stewards:';
const STEWARDREQ_D = 'trinityone/stewardreq:';
const SK = new Uint8Array(32).fill(7);   // churchSk, our own signing key

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
    listeners(t) { const s = ls.get(t); return s ? s.size : 0; },
  };
}

function harness({ proven = [BOX, CANON] } = {}) {
  const store = new Map();
  const subs = [];
  const published = [];                 // every event handed to the lifted publish()
  const admitted = new Set(proven);     // warm cache: the discovery read opens at once
  const win = fakeWindow();
  const stewardedChurches = new Map();
  const stubs = {
    churchSk: SK, churchPub: ME, pub: ME, sk: SK, actingChurch: '',
    stewardedChurches,
    _ownKeyBlank: () => false,
    netKeys: () => [],
    npubEncode: (p) => 'npub_' + p,
    toPubHex: (x) => (/^[0-9a-f]{64}$/i.test(x) ? x.toLowerCase() : null),
    privateKeyFromSeedWords: () => { throw new Error('not a network key'); }, getPublicKey: () => '',
    NET: 'trinityone', STEWARDS_D, STEWARDREQ_D, STEWARDREVOKE_D: 'trinityone/stewardrevoke:', ACTIVE_ID_KEY: 'active', PENDING_CHURCH_KEY: 'pending', _stewardedBroad: null,   // not yet run this session: the broad read (2026-11-11)
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    lsSet: (k, v) => store.set(k, v),
    lsGet: (k) => (store.has(k) ? store.get(k) : null),
    CANONICAL_RELAYS: [CANON], CANONICAL_RELAY: CANON,
    extraRelays: () => [],
    location: { protocol: 'http:', host: '127.0.0.1:8000', hostname: '127.0.0.1' },
    _ownOrigin: () => ORIGIN,
    _boxHostsUs: false,
    _refreshBoxHostsUs: () => Promise.resolve(),
    // the engine's real signing path: _monotonic -> finalizeEvent -> publish. We record what publish() sees.
    now: () => 1762300000,
    _monotonic: (tmpl) => tmpl,
    finalizeEvent: (tmpl, key) => ({ ...tmpl, _signedWith: key, pubkey: ME, sig: 'sig' }),
    publish: (evt) => { published.push(evt); return Promise.resolve(true); },
    _gate: {
      admit: (list) => list.filter(u => admitted.has(u)),
      refresh: (list) => Promise.resolve(list.filter(u => admitted.has(u))),
      _admit: (u) => admitted.add(u),
    },
    pool: {
      subscribeMany(urls, filters, handlers) {
        const rec = { urls: [...urls], filters, handlers, closed: false, close() { rec.closed = true; } };
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
    _minorsLastClear: () => {},
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
  stubs.window.Steward.setActiveIdentity = (p, o) => switchTo.call(stubs.window.Steward, p, o);
  return {
    stubs, store, subs, published, win, stewardedChurches,
    subscribe: (cb) => subscribe.call(stubs.window.Steward, cb || (() => {})),
    discovery: () => subs.filter(s => s.filters.some(f => f.kinds && f.kinds.includes(30078))),
    // the owner's roster for `churchPub`, naming ME, arriving on the discovery subscription
    grant: (sub, cp = CHURCH) => sub.handlers.onevent({
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', STEWARDS_D + cp], ['t', 'trinityone']],
      content: JSON.stringify({ pubkeys: [ME] }),
    }),
  };
}
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

// requestSteward wrote this when the request went out; the grant path reads it to decide whether to retract.
const REQ_KEY = (ownpub) => 'trinityone.steward.requested.' + ownpub;

test('the grant for a church WE ASKED to join publishes a tombstone of our own STEWARDREQ', async () => {
  const h = harness();
  h.store.set(REQ_KEY(ME), JSON.stringify([CHURCH]));   // requestSteward recorded that we asked CHURCH
  h.subscribe();
  await tick();
  const d = h.discovery();
  assert.equal(d.length, 2, 'no discovery read opened (one subscription per relay since 2026-11-11, so each relay\'s answer is judged on its own)');
  h.grant(d[0], CHURCH);

  assert.ok(h.stewardedChurches.has(CHURCH), 'staging: the grant was not recorded');
  assert.equal(h.published.length, 1, 'the approved helper did not retract its own request — nothing was published');
  const ev = h.published[0];
  assert.equal(ev.kind, 30078, 'the tombstone is not a 30078 replaceable event');
  const d_tag = (ev.tags.find(t => t[0] === 'd') || [])[1];
  assert.equal(d_tag, STEWARDREQ_D + CHURCH, 'the tombstone is at the wrong d-tag — it will not replace the request. got ' + d_tag);
  assert.ok(ev.tags.some(t => t[0] === 'deleted'), 'the tombstone carries no ["deleted"] tag — subscribeStewardRequests will not read it as a retract');
  assert.equal(ev.content, '', 'the tombstone content is not empty — a retract is empty content and/or a deleted tag');
  assert.ok(ev.tags.some(t => t[0] === 't' && t[1] === 'trinityone'), 'the tombstone has no #t tag — the owner\'s request feed filters on #t, so it would never arrive');
  assert.equal(ev._signedWith, SK, 'the tombstone was not signed with churchSk — a tombstone signed by any other key is not the request\'s author and the relay rejects it');
});

test('the request is dropped from the requested-set, so a second grant event does not re-publish', async () => {
  const h = harness();
  h.store.set(REQ_KEY(ME), JSON.stringify([CHURCH]));
  h.subscribe();
  await tick();
  const d = h.discovery();
  h.grant(d[0], CHURCH);
  assert.equal(h.published.length, 1, 'staging: first grant did not retract');
  assert.deepEqual(JSON.parse(h.store.get(REQ_KEY(ME))), [], 'CHURCH was not removed from the requested-set after retracting');
  // a later roster copy for the same church must not mint a second tombstone
  d[0].handlers.onevent({
    created_at: Math.floor(Date.now() / 1000) + 1,
    tags: [['d', STEWARDS_D + CHURCH], ['t', 'trinityone']],
    content: JSON.stringify({ pubkeys: [ME] }),
  });
  assert.equal(h.published.length, 1, 'a second roster copy re-published the tombstone — the retract is not once-only');
});

test('CONTROL: a church we were granted but NEVER asked to join publishes NO tombstone', async () => {
  const h = harness();
  h.store.set(REQ_KEY(ME), JSON.stringify([CHURCH]));   // we asked CHURCH, not OTHER
  h.subscribe();
  await tick();
  const d = h.discovery();
  h.grant(d[0], OTHER);                                   // a grant for a church we never requested
  assert.ok(h.stewardedChurches.has(OTHER), 'staging: the OTHER grant was not recorded');
  assert.equal(h.published.length, 0,
    'a spurious tombstone was published for a church we never requested — the retract must be gated on the requested-set');
});

test('CONTROL: with nothing in the requested-set, a grant publishes nothing', async () => {
  const h = harness();                                    // no requested-set written
  h.subscribe();
  await tick();
  h.grant(h.discovery()[0], CHURCH);
  assert.ok(h.stewardedChurches.has(CHURCH), 'staging: the grant was not recorded');
  assert.equal(h.published.length, 0, 'a tombstone was published though no request was ever recorded');
});
