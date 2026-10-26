// A MEMBER'S PROFILE GOES TO THE SHARED SERVERS AND THE BOXES OF THE CHURCHES THEY BELONG TO - NEVER A BOX OF A
// CHURCH THEY DON'T. Owner rule 2026-10-26 (TrinityOne-internal/reference/DOMAIN.md, "personal traffic"), step 2b.
// Run: node --test scripts/a-members-profile-stays-on-its-churchs-boxes.test.mjs
//
// THE MEASURED DEFECT. setProfile published the kind-0 to `window.Fellowship.relays` (the one candidate list for
// every church the phone knows, plus every box ANY church's signed document added), and the profile reads
// (subscribeChurchProfile, requestProfiles/_flushProfiles) read over that same list.
//
// HOW IT IS DRIVEN. Real `node scripts/gateway.mjs` relays: SHARED, TA (church A's box), TC (church C's box - the
// member is NOT in C), TAB (a box BOTH A and B sign). The shipped gate, relaysForChurch, publishSetFor,
// groupReadRelays, memberChurchPubs, profilePublishRelays, _publishAny, subscribeChurchProfile, requestProfiles /
// _flushProfiles and adoptChurchNetDocAddresses are lifted out of vendor/fellowship.js and RUN. The WIRE is
// observed: globalThis.WebSocket is wrapped so every REQ and EVENT frame is recorded against the box it went to.
// TLS is the one thing faked (wss://127.0.0.1 -> ws://), as in the sibling tests.
//
// The shipped setProfile IS lifted and run (the 'END TO END' test): only key/storage/photo-policy plumbing is stubbed;
// the relay choice (profilePublishRelays, memberChurchPubs, publishSetFor, the gate, _publishAny) is the real code.
// The vendor-text test below is kept as a cheap second guard.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool';
import { verifyEvent, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode, decode as nip19decode } from 'nostr-tools/nip19';
import { normalizeURL } from 'nostr-tools/utils';
import { fnBody, stmt } from './test-slice.mjs';
import * as H from './relay-network-harness.mjs';

const FELLOW = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const RELAY_NET_D = 'trinityone/relay-net';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const secure = (u) => String(u || '').replace(/^ws:\/\//i, 'wss://').replace(/^http:\/\//i, 'https://');
const wire = (u) => String(u || '').replace(/^wss:\/\/(127\.0\.0\.1[:/])/i, 'ws://$1').replace(/^https:\/\/(127\.0\.0\.1[:/])/i, 'http://$1');
const netFetch = (u, o) => globalThis.fetch(wire(typeof u === 'string' ? u : String(u)), o);

// ── the wire recorder: every REQ frame, against the address it was sent to ──────────────────────────────
const REQS = []; const EVTS = [];   // { url, filters } / { url, ev }
const RealWS = globalThis.WebSocket;
class RecordingWS extends RealWS {
  send(data) {
    try { const m = JSON.parse(data); if (Array.isArray(m) && m[0] === 'REQ') REQS.push({ url: this.url, filters: m.slice(2) }); if (Array.isArray(m) && m[0] === 'EVENT') EVTS.push({ url: this.url, ev: m[1] }); } catch (e) {}
    return super.send(data);
  }
}
const reqsAt = (relay) => REQS.filter(r => r.url === relay.wsUrl);
const mentions = (r, id) => JSON.stringify(r.filters).includes(id);

function wirePool(signer) {
  const p = new SimplePool();
  p.automaticallyAuth = () => async (authEvent) => finalizeEvent(authEvent, signer.sk);
  const list = (a) => (Array.isArray(a) ? a.map(wire) : a);
  const api = {
    querySync: (urls, f, o) => p.querySync(list(urls), f, o),
    subscribeMany: (urls, f, h) => p.subscribeMany(list(urls), f, h),
    publish: (urls, e) => p.publish(list(urls), e),
    ensureRelay: (u, o) => p.ensureRelay(wire(u), o),
    listConnectionStatus: () => {
      const out = new Map();
      try { for (const [k, v] of p.listConnectionStatus()) { out.set(k, v); out.set(secure(k), v); } } catch (e) {}
      return out;
    },
    close: (urls) => { try { p.close(list(urls)); } catch (e) {} },
    shutdown: () => { try { p.close(p.relays ? [...p.relays.keys()] : []); } catch (e) {} },
  };
  Object.defineProperty(api, 'relays', { get: () => p.relays });
  return api;
}
function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
class Ev { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } }
function fakeWindow() {
  const ls = new Map();
  return {
    Fellowship: {},
    dispatchEvent: (e) => { for (const fn of [...(ls.get(e.type) || [])]) { try { fn(e); } catch (err) {} } return true; },
    addEventListener: (t, fn) => { if (!ls.has(t)) ls.set(t, new Set()); ls.get(t).add(fn); },
    removeEventListener: (t, fn) => { if (ls.has(t)) ls.get(t).delete(fn); },
  };
}
function scopeOf(stubs) {
  return new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      // esbuild suffixes colliding names (verifyEvent2): fall back to the bare name
      const base = String(k).replace(/\d+$/, '');
      if (base in t) return t[base];
      throw new ReferenceError('the lifted code needs `' + String(k) + '` - add a stub for it');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
}
function gateSource(src) {
  return [
    fnBody(src, 'function relayIdentityNonce', 'relayIdentityNonce'),
    fnBody(src, 'function relayHttpBase', 'relayHttpBase'),
    fnBody(src, 'function relayAddrKey', 'relayAddrKey'),
    fnBody(src, 'async function verifyRelayIdentityDetailed', 'verifyRelayIdentityDetailed'),
    fnBody(src, 'async function verifyRelayIdentity(', 'verifyRelayIdentity'),
    stmt(src, 'var RELAY_NET_D = ', 'RELAY_NET_D'),
    fnBody(src, 'function _relayKey', '_relayKey'),
    stmt(src, 'var _isHex64 = ', '_isHex64'),
    fnBody(src, 'function canonicalPinsFor', 'canonicalPinsFor'),
    fnBody(src, 'function isSharedAddress', 'isSharedAddress'),
    fnBody(src, 'function sharedRelayKeys', 'sharedRelayKeys'),
    fnBody(src, 'function parseRelayNet', 'parseRelayNet'),
    fnBody(src, 'function _originKey', '_originKey'),
    fnBody(src, 'function sameOriginRelay', 'sameOriginRelay'),
    fnBody(src, 'async function proveRelay', 'proveRelay'),
    fnBody(src, 'async function isNetworkRelay', 'isNetworkRelay'),
    stmt(src, 'var VERIFIED_KEY = ', 'VERIFIED_KEY'),
    stmt(src, 'var VERIFIED_TTL_SEC = ', 'VERIFIED_TTL_SEC'),
    stmt(src, 'var VERIFIED_REFRESH_SEC = ', 'VERIFIED_REFRESH_SEC'),
    stmt(src, 'var VERIFY_RETRY_SEC = ', 'VERIFY_RETRY_SEC'),
    fnBody(src, 'function readVerified', 'readVerified'),
    fnBody(src, 'function writeVerified', 'writeVerified'),
    fnBody(src, 'function admitCached', 'admitCached'),
    fnBody(src, 'function _scopesOf', '_scopesOf'),
    fnBody(src, 'function _admittingScope', '_admittingScope'),
    fnBody(src, 'function rememberVerified', 'rememberVerified'),
    fnBody(src, 'function createRelayGate', 'createRelayGate'),
  ].join('\n');
}


// ── the phone ──────────────────────────────────────────────────────────────────────────────────────────
function phone({ relays, canonical, pins, activeChurch, followed, netdoc, who }) {
  const src = FELLOW;
  const me = who || H.key();
  const pool = wirePool(me);
  const store = memStore();
  if (netdoc) store.setItem('trinityone.relays.netdoc', JSON.stringify(netdoc));
  if (followed) store.setItem('trinityone.followedChurches', JSON.stringify(followed.map(c => ({ id: c.npub }))));
  const body = [
    gateSource(src),
    fnBody(src, 'function toPub', 'toPub'),
    fnBody(src, 'function churchRelaysRaw', 'churchRelaysRaw'),
    fnBody(src, 'function _adoptionOrigin', '_adoptionOrigin'),
    stmt(src, 'var _relayNetCache = ', '_relayNetCache'),
    stmt(src, 'var RELAY_NET_TTL_MS = ', 'RELAY_NET_TTL_MS'),
    fnBody(src, 'async function churchRelayNet', 'churchRelayNet'),
    stmt(src, 'var _gate = createRelayGate(', '_gate'),
    fnBody(src, 'function _netRelays', '_netRelays'),
    fnBody(src, 'function _otherChurchesNetDocRows', '_otherChurchesNetDocRows'),
    stmt(src, 'var _churchRelays = ', '_churchRelays'),
    stmt(src, 'var CHURCH_BOXES_KEY = ', 'CHURCH_BOXES_KEY'),
    fnBody(src, 'function _loadChurchBoxes', '_loadChurchBoxes'),
    fnBody(src, 'function relaysForChurch', 'relaysForChurch'),
    fnBody(src, 'function publishSetFor', 'publishSetFor'),
    // ── adoption (for the CLAIM path) ──
    fnBody(src, 'function _netDocDialUrl', '_netDocDialUrl'),
    fnBody(src, 'function _alreadyAMemberCandidate', '_alreadyAMemberCandidate'),
    stmt(src, 'var MEMBER_NETDOC_ADOPT_MAX = ', 'MEMBER_NETDOC_ADOPT_MAX'),
    stmt(src, 'var _adoptingNetDoc = ', '_adoptingNetDoc'),
    fnBody(src, 'function _dropRevokedNetDocRows', '_dropRevokedNetDocRows'),
    fnBody(src, 'async function adoptChurchNetDocAddresses', 'adoptChurchNetDocAddresses'),
    // ── THE THINGS UNDER TEST ──
    fnBody(src, 'function groupReadRelays', 'groupReadRelays'),
    fnBody(src, 'function memberChurchPubs', 'memberChurchPubs'),
    fnBody(src, 'function profilePublishRelays', 'profilePublishRelays'),
    // ── the shipped publisher and what it needs ──
    stmt(src, 'var NO_NETWORK_RELAY = ', 'NO_NETWORK_RELAY'),
    stmt(src, 'var WEDGE_ACK_MS = ', 'WEDGE_ACK_MS'),
    stmt(src, 'var _PUB_REFUSED = ', '_PUB_REFUSED'),
    stmt(src, 'var _PUB_FAILED = ', '_PUB_FAILED'),
    stmt(src, 'var _PUB_SILENT = ', '_PUB_SILENT'),
    fnBody(src, 'function _wedgeKey', '_wedgeKey'),
    fnBody(src, 'function _classify', '_classify'),
    fnBody(src, 'function _dedupeRelays', '_dedupeRelays'),
    fnBody(src, 'function _publishAny', '_publishAny'),
    // ── the shipped profile readers ──
    'let _profilePubFor = null, _profilePubBody = null;',
    'const profiles = {}; const pendingProfiles = new Set(); const _profQueue = new Set(); let _profTimer = null; const _k0Seen = new Set();',
    fnBody(src, 'function _flushProfiles', '_flushProfiles'),
  ].join('\n');
  const win = fakeWindow();
  win.Fellowship = { relays: [...relays], churchPub: activeChurch, ready: Promise.resolve() };
  win.Fellowship.addRelay = (u) => { win.Fellowship.relays = [...win.Fellowship.relays, u]; };
  const reqProfiles = fnBody(src, 'requestProfiles(pubkeys) {', 'requestProfiles');
  const setProf = fnBody(src, 'async setProfile(meta) {', 'setProfile');
  const subChurchProfile = fnBody(src, 'subscribeChurchProfile(churchNpub, onProfile) {', 'subscribeChurchProfile');
  const scope = scopeOf({
    localStorage: store, window: win, pool, console, fetch: netFetch,
    CANONICAL_RELAYS: canonical, CANONICAL_RELAY_PUBS: pins, DEFAULT_RELAYS: canonical,
    _native: false, _staticHost: false, _loc: null,
    normalizeURL, verifyEvent, finalizeEvent, CustomEvent: Ev,
    decode: nip19decode, nip19decode, performance, normalizeURL2: normalizeURL,
    _noteSendResult: () => {}, _checkIfBlocked: () => {}, _notePhotoPolicy: () => {},
    _recoverOwnProfile: () => {}, _churchPhotosOff: () => false, _myPhotoReset: () => false, _stripPhoto: (p, av) => av, _pubReason: () => '', PROFILE_KEY: 'trinityone.profile', setTimeout, saveProfiles: () => {}, _resendMembershipToNewBoxes: async () => {},
    sk: me.sk, pub: me.pub,
  });
  const api = new Function('scope', `with (scope) { ${body}
    const _api = { ${reqProfiles}, ${subChurchProfile}, ${setProf} };
    window.Fellowship.requestProfiles = (p) => _api.requestProfiles(p);
    _k0Seen.add(pub);
    return { setProfile: (m) => _api.setProfile(m), requestProfiles: (p) => _api.requestProfiles(p), subscribeChurchProfile: (n, f) => _api.subscribeChurchProfile(n, f),
             relaysForChurch, publishSetFor, groupReadRelays, memberChurchPubs, profilePublishRelays, _publishAny,
             adopt: (cp) => { window.Fellowship.churchPub = cp; return adoptChurchNetDocAddresses(cp); },
             gate: _gate, churchRelaysRaw }; }`)(scope);
  api.win = win; api.pool = pool; api.me = me; api.store = store;
  api.close = () => { try { pool.shutdown(); } catch (e) {} };
  return api;
}

const now = () => Math.floor(Date.now() / 1000);
const joinDoc = (who, cp) => finalizeEvent(
  { kind: 30078, created_at: now(), tags: [['d', 'trinityone/member:' + cp], ['t', 'trinityone'], ['church', cp]], content: '{}' }, who.sk);
let _docAt = now();
const relayNetDocFor = (church, rows) => finalizeEvent(
  { kind: 30078, created_at: ++_docAt, tags: [['d', RELAY_NET_D], ['t', 'trinityone']], content: JSON.stringify(rows) }, church.sk);

let A, B, C, SHARED, TA, TC, TAB, reader;
before(async () => {
  useWebSocketImplementation(RecordingWS);
  A = H.key(); A.npub = npubEncode(A.pub);
  B = H.key(); B.npub = npubEncode(B.pub);
  C = H.key(); C.npub = npubEncode(C.pub);
  reader = H.key();
  SHARED = await H.startRelay({ name: 'SHARED', churches: [A.pub, B.pub, C.pub] });
  TA = await H.startRelay({ name: 'TA', churches: [A.pub] });
  TC = await H.startRelay({ name: 'TC', churches: [C.pub] });
  TAB = await H.startRelay({ name: 'TAB', churches: [A.pub, B.pub] });
  await H.publishAll(SHARED, [joinDoc(reader, A.pub), joinDoc(reader, B.pub), joinDoc(reader, C.pub)]);
  for (const t of [TA, TC, TAB]) await H.publishAll(t, [joinDoc(reader, A.pub), joinDoc(reader, B.pub), joinDoc(reader, C.pub)].filter((e, i) => t.churches.includes([A, B, C][i].pub)));
  // each church's own kind-0 (the church profile) lives on the shared relay and its own box
  const churchProfile = (ch, name) => finalizeEvent({ kind: 0, created_at: now(), tags: [], content: JSON.stringify({ name }) }, ch.sk);
  await H.publishAll(SHARED, [churchProfile(A, 'Church A'), churchProfile(B, 'Church B')]);
  await H.publishAll(TA, [churchProfile(A, 'Church A')]);
  // A's and B's signed relay-net documents name TAB; A's also names TA. They sit on the shared relay.
  await H.publishAll(SHARED, [relayNetDocFor(A, [{ pubkey: TA.relayPub, alwaysOn: true, url: secure(TA.wsUrl) }, { pubkey: TAB.relayPub, alwaysOn: true, url: secure(TAB.wsUrl) }])]);
});
after(() => {
  useWebSocketImplementation(RealWS);
  H.stopAll();
  try { setTimeout(() => process.exit(process.exitCode || 0), 10000).unref(); } catch (e) {}
});

// A member of A and B (NOT C). The candidate list holds every box any church's document put there: TA (A's),
// TC (C's - a church the member is not in). Both are recorded as their church's, as adoptChurchNetDocAddresses does.
async function member({ active, followed }) {
  const app = phone({
    who: reader,
    relays: [secure(SHARED.wsUrl), secure(TA.wsUrl), secure(TC.wsUrl)],
    canonical: [secure(SHARED.wsUrl)], pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] },
    activeChurch: active ? active.pub : null,
    followed,
    netdoc: { [A.pub]: { hw: 1, rows: { [secure(TA.wsUrl)]: TA.relayPub } }, [C.pub]: { hw: 1, rows: { [secure(TC.wsUrl)]: TC.relayPub } } },
  });
  // every box is PROVED and admitted for every church: admission alone does not keep a box out of traffic, so the
  // test stages TC admitted for A and B too, or an unscoped publish would look innocent.
  for (const ch of [A, B, C]) await app.gate.refresh(app.churchRelaysRaw(), ch.pub);
  assert.ok(app.gate.admits(secure(TC.wsUrl), A.pub), 'staging fault: TC is not admitted, so a leak could not be seen');
  assert.ok(app.gate.admits(secure(TA.wsUrl), B.pub), 'staging fault: TA is not admitted for B');
  return app;
}
const kind0 = (who, n) => finalizeEvent({ kind: 0, created_at: now() + n, tags: [], content: JSON.stringify({ name: '', about: 'hello ' + n }) }, who.sk);
const evAt = (relay, id) => EVTS.filter(x => x.url === relay.wsUrl && x.ev && x.ev.id === id);

test('setProfile publishes through profilePublishRelays() - the point of use (vendor text; dead code is removed from vendor)', () => {
  const sp = fnBody(FELLOW, 'async setProfile(meta) {', 'setProfile');
  assert.equal(sp.split('_publishAny(profilePublishRelays(), evt)').length - 1, 1, 'setProfile no longer publishes the kind-0 to profilePublishRelays()');
  assert.equal(sp.split('window.Fellowship.relays, evt').length - 1, 0, 'setProfile still publishes the kind-0 to the whole candidate list');
});

test('setProfile END TO END (the shipped function, real relay choice): the kind-0 lands on A\'s box and the shared relay, NEVER on stranger C\'s admitted box', async () => {
  const app = await member({ active: A, followed: [A, B] });
  try {
    const mark = 'e2e-' + Date.now();
    const out = await app.setProfile({ about: mark });
    assert.ok(out && out.id, 'setProfile did not publish: ' + JSON.stringify(out));
    await sleep(500);
    assert.ok(evAt(TA, out.id).length >= 1, 'A\'s own box did not get the kind-0 from setProfile');
    assert.ok(evAt(SHARED, out.id).length >= 1, 'the shared relay did not get the kind-0 from setProfile');
    assert.equal(evAt(TC, out.id).length, 0, 'setProfile sent the member\'s kind-0 to C\'s box (a church they are not in)');
  } finally { app.close(); }
});

test('profile PUBLISH: a member of A and B reaches A\'s box and the shared servers, and NEVER C\'s box (a church they are not in)', async () => {
  const app = await member({ active: A, followed: [A, B] });
  try {
    assert.equal(app.memberChurchPubs().length, 2, 'memberChurchPubs: ' + JSON.stringify(app.memberChurchPubs()));
    const set = app.profilePublishRelays();
    assert.ok(set.includes(secure(TA.wsUrl)) && set.includes(secure(SHARED.wsUrl)), JSON.stringify(set));
    assert.ok(!set.includes(secure(TC.wsUrl)), 'C\'s box is in the profile publish set: ' + JSON.stringify(set));
    const evt = kind0(reader, 1);
    await app._publishAny(app.profilePublishRelays(), evt);
    await sleep(500);
    assert.ok(evAt(TA, evt.id).length >= 1, 'A\'s own box did not get the profile');
    assert.ok(evAt(SHARED, evt.id).length >= 1, 'the shared servers did not get the profile');
    assert.equal(evAt(TC, evt.id).length, 0, 'C\'s box was sent the member\'s profile');
  } finally { app.close(); }
});

test('profile PUBLISH CONTROL: once the member also follows C, C\'s box IS in the set and gets the profile', async () => {
  const app = await member({ active: A, followed: [A, B, C] });
  try {
    const evt = kind0(reader, 2);
    await app._publishAny(app.profilePublishRelays(), evt);
    await sleep(500);
    assert.ok(evAt(TC, evt.id).length >= 1, 'C is a church the member belongs to - its box should get the profile');
    assert.ok(evAt(TA, evt.id).length >= 1);
  } finally { app.close(); }
});

test('profile PUBLISH with no church at all: the SHARED POOL ONLY - never the whole list, never empty', async () => {
  const app = await member({ active: null, followed: [] });
  try {
    assert.deepEqual(app.profilePublishRelays(), [secure(SHARED.wsUrl)]);
    const evt = kind0(reader, 3);
    await app._publishAny(app.profilePublishRelays(), evt);
    await sleep(500);
    assert.ok(evAt(SHARED, evt.id).length >= 1, 'nobody got it');
    assert.equal(evAt(TA, evt.id).length + evAt(TC, evt.id).length, 0, 'a church box got a church-less profile');
  } finally { app.close(); }
});

test('church PROFILE READ: church B\'s kind-0 read never reaches A\'s box; the shared pool gets it', async () => {
  const app = await member({ active: B, followed: [A, B] });
  const from = REQS.length;
  const got = [];
  const off = app.subscribeChurchProfile(B.npub, (p) => got.push(p));
  try {
    await sleep(1500);
    const mine = REQS.slice(from);
    assert.equal(mine.filter(r => r.url === TA.wsUrl && mentions(r, B.pub)).length, 0, 'B\'s church-profile read reached A\'s box');
    assert.equal(mine.filter(r => r.url === TC.wsUrl && mentions(r, B.pub)).length, 0, 'B\'s church-profile read reached C\'s box');
    assert.ok(mine.some(r => r.url === SHARED.wsUrl && mentions(r, B.pub)), 'the shared pool got no church-profile REQ');
    assert.ok(got.some(p => p && p.name === 'Church B'), 'B\'s profile was not delivered: ' + JSON.stringify(got));
  } finally { off(); app.close(); }
});

test('church PROFILE READ CONTROL: church A\'s kind-0 read IS sent to A\'s own box', async () => {
  const app = await member({ active: A, followed: [A, B] });
  const from = REQS.length;
  const off = app.subscribeChurchProfile(A.npub, () => {});
  try {
    await sleep(1500);
    assert.ok(REQS.slice(from).some(r => r.url === TA.wsUrl && mentions(r, A.pub)), 'A\'s own box got no REQ for A\'s profile');
  } finally { off(); app.close(); }
});

test('MEMBER-profile read (requestProfiles): with B active the kinds-0 REQ never reaches A\'s box; with A active it does; shared always', async () => {
  const who = H.key().pub;
  const appB = await member({ active: B, followed: [A, B] });
  let from = REQS.length;
  appB.requestProfiles([who]);
  await sleep(1500);
  let mine = REQS.slice(from).filter(r => mentions(r, who));
  assert.equal(mine.filter(r => r.url === TA.wsUrl || r.url === TC.wsUrl).length, 0, 'a member-profile read reached another church\'s box');
  assert.ok(mine.some(r => r.url === SHARED.wsUrl), 'the shared pool got no member-profile REQ - names would go blank');
  appB.close();
  const who2 = H.key().pub;
  const appA = await member({ active: A, followed: [A, B] });
  from = REQS.length;
  appA.requestProfiles([who2]);
  await sleep(1500);
  mine = REQS.slice(from).filter(r => mentions(r, who2));
  assert.ok(mine.some(r => r.url === TA.wsUrl), 'CONTROL: A\'s box got no member-profile REQ for A\'s member');
  appA.close();
});

test('requestProfiles / subscribeChurchProfile read through groupReadRelays (vendor text guard for the two read sites)', () => {
  assert.equal(fnBody(FELLOW, 'function _flushProfiles', '_flushProfiles').split('groupReadRelays(window.Fellowship.churchPub), [{ kinds: [0], authors }]').length - 1, 1);
  assert.equal(fnBody(FELLOW, 'subscribeChurchProfile(churchNpub, onProfile) {', 'x').split('groupReadRelays(pubk), [{ kinds: [0], authors: [pubk] }]').length - 1, 1);
});

// ── THE CLAIM PATH (audit of 89c804f6, MEDIUM) ──────────────────────────────────────────────────────────
// TAB is signed by BOTH A and B. It reaches the phone first under B's record. A box one church adopted is
// "foreign" to the other, so before A claims it, A's reads and publishes exclude it; when
// adoptChurchNetDocAddresses(A) runs it claims the box for A (proves the key A signed), and A's group reads and
// A's profile reads/publishes include it.
test('CLAIM PATH: a box both churches sign, adopted first under B, is EXCLUDED for A before A claims it and INCLUDED after', async () => {
  const app = phone({
    who: reader,
    relays: [secure(SHARED.wsUrl), secure(TAB.wsUrl)],
    canonical: [secure(SHARED.wsUrl)], pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] },
    activeChurch: A.pub, followed: [A],
    netdoc: { [B.pub]: { hw: 1, rows: { [secure(TAB.wsUrl)]: TAB.relayPub } } },
  });
  try {
    for (const ch of [A, B]) await app.gate.refresh(app.churchRelaysRaw(), ch.pub);
    assert.ok(app.gate.admits(secure(TAB.wsUrl), A.pub), 'staging fault: TAB is not admitted for A, so exclusion would be by admission and not by scope');
    const tab = secure(TAB.wsUrl);
    // CONTROL: before the claim TAB is out of every A read/publish set
    assert.ok(!app.relaysForChurch(A.pub).includes(tab), 'before the claim: relaysForChurch(A) holds TAB');
    assert.ok(!app.groupReadRelays(A.pub).includes(tab), 'before the claim: groupReadRelays(A) holds TAB');
    assert.ok(!app.profilePublishRelays().includes(tab), 'before the claim: the profile publish set holds TAB');
    // the shipped adoption runs against the real gateways and A's real signed document
    const added = await app.adopt(A.pub);
    assert.deepEqual(added.filter(u => u === tab), [], 'a claim adds nothing to the list (it is already there)');
    const rec = JSON.parse(app.store.getItem('trinityone.relays.netdoc'));
    assert.ok(rec[A.pub] && rec[A.pub].rows[tab], 'A did not record TAB: ' + JSON.stringify(rec));
    await app.gate.refresh(app.churchRelaysRaw(), A.pub);
    assert.ok(app.relaysForChurch(A.pub).includes(tab), 'after the claim: relaysForChurch(A) lacks TAB');
    assert.ok(app.groupReadRelays(A.pub).includes(tab), 'after the claim: A\'s group reads lack TAB');
    assert.ok(app.profilePublishRelays().includes(tab), 'after the claim: A\'s profile publish set lacks TAB');
    // and on the wire: A's church-profile read now reaches TAB
    const from = REQS.length;
    const off = app.subscribeChurchProfile(A.npub, () => {});
    await sleep(1500);
    off();
    assert.ok(REQS.slice(from).some(r => r.url === TAB.wsUrl && mentions(r, A.pub)), 'after the claim A\'s profile read did not reach TAB');
  } finally { app.close(); }
});
