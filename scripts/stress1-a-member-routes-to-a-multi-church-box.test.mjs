// STRESS BATCH 1 / AREA A, MEMBER SIDE: the SHIPPED bundle (vendor/fellowship.js) asked where it sends traffic when one
// own box H is signed by two churches (A and C), shared server S serves A, B, C, and church B has its own box TB.
// Run: flock /tmp/claude-1000/selfhost-tests.lock node --test scripts/stress1-a-member-routes-to-a-multi-church-box.test.mjs
// Real gateways (S, H, TB); the church relay lists are real signed docs on S; the gate does real /relay-identity proofs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SimplePool } from 'nostr-tools/pool';
import { verifyEvent, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode, decode as nip19decode } from 'nostr-tools/nip19';
import { normalizeURL } from 'nostr-tools/utils';
import { fnBody, stmt } from './test-slice.mjs';
import * as H from './relay-network-harness.mjs';

const FELLOW = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const RELAY_NET_D = 'trinityone/relay-net';
const secure = (u) => String(u || '').replace(/^ws:\/\//i, 'wss://').replace(/^http:\/\//i, 'https://');
const wire = (u) => String(u || '').replace(/^wss:\/\/(127\.0\.0\.1[:/])/i, 'ws://$1').replace(/^https:\/\/(127\.0\.0\.1[:/])/i, 'http://$1');
const netFetch = (u, o) => globalThis.fetch(wire(typeof u === 'string' ? u : String(u)), o);
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





function phone({ relays, activeChurch, followed, netdoc, who, roster, store: given, churchboxes }) {
  const src = FELLOW;
  const me = who || H.key();
  const pool = wirePool(me);
  const store = given || memStore();
  if (netdoc) store.setItem('trinityone.relays.netdoc', JSON.stringify(netdoc));
  if (followed) store.setItem('trinityone.followedChurches', JSON.stringify(followed.map(c => ({ id: c.npub }))));
  if (churchboxes) store.setItem('trinityone.churchboxes', JSON.stringify(churchboxes));
  for (const [cp, people] of Object.entries(roster || {})) store.setItem('trinityone.memhub.' + cp, JSON.stringify({ since: 0, fullAt: 0, members: people.map(p => ({ pubkey: p, joined: 1700000000, msgs: 0 })) }));
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
    fnBody(src, 'function groupReadRelays', 'groupReadRelays'),
    fnBody(src, 'function profilePublishRelays', 'profilePublishRelays'),
    stmt(src, 'var MEMHUB_KEY = ', 'MEMHUB_KEY'),
    stmt(src, 'var MEMBERS_KEY = ', 'MEMBERS_KEY'),
    stmt(src, 'var _reseatOld = ', '_reseatOld'),
    fnBody(src, 'function _superseded', '_superseded'),
    fnBody(src, 'function loadMembersCache', 'loadMembersCache'),
    stmt(src, 'var _memHubs = ', '_memHubs'),
    fnBody(src, 'function _memHub(', '_memHub'),
    fnBody(src, 'function memberChurchPubs', 'memberChurchPubs'),
    fnBody(src, 'function _peerInChurch', '_peerInChurch'),
    fnBody(src, 'function dmSendRelays', 'dmSendRelays'),
    // G3 3.1: the REAL leave path's cleanup and the revoke helper it shares (lifted, not re-implemented)
    fnBody(src, 'function _dropChurchBoxes', '_dropChurchBoxes'),
    fnBody(src, 'function _dropRevokedNetDocRows', '_dropRevokedNetDocRows'),
    fnBody(src, 'function _forgetChurch', '_forgetChurch'),
  ].join('\n');
  const win = fakeWindow();
  win.Fellowship = { relays: [...relays], churchPub: activeChurch, ready: Promise.resolve() };
  win.Fellowship.setRelays = (l) => { win.Fellowship.relays = [...l]; };
  const scope = scopeOf({
    localStorage: store, window: win, pool, console, fetch: netFetch,
    CANONICAL_RELAYS: [secure(S.wsUrl)], CANONICAL_RELAY_PUBS: { [secure(S.wsUrl)]: [S.relayPub] }, DEFAULT_RELAYS: [secure(S.wsUrl)],
    _native: false, _staticHost: false, _loc: null,
    normalizeURL, verifyEvent, finalizeEvent, CustomEvent: Ev, decode: nip19decode, nip19decode, performance, NET: 'trinityone',
    sk: me.sk, pub: me.pub,
    // _forgetChurch's per-church in-memory maps (this test only cares about the relay part of it)
    _docsHubs: new Map(), _memHubs: new Map(), _nameKeys: new Map(), _nameKeyTs: new Map(), _churchRoster: new Map(),
    _churchList: new Map(), _applying: new Set(), _reseatAt: new Map(), _ckMemberKeys: new Map(), _churchVoices: new Map(),
    _carekeys: {}, _carekeyRev: {}, _carekeyTs: {}, _sealedNames: new Map(), _sealedMine: new Map(), _gkeys: {}, _gkeyTs: {},
    npubEncode, clearTimeout,
  });
  const api = new Function('scope', `with (scope) { ${body}
    return { relaysForChurch, publishSetFor, groupReadRelays, profilePublishRelays, dmSendRelays, memberChurchPubs,
             gate: _gate, churchRelaysRaw, churchRelayNet, _netRelays, forgetChurch: _forgetChurch }; }`)(scope);
  api.relays = () => [...win.Fellowship.relays];
  api.win = win; api.store = store; api.close = () => { try { pool.shutdown(); } catch (e) {} };
  return api;
}

const now = H.now;
const J = (o) => JSON.stringify(o);
let A, B, C, S, HB, TB, mAC, mB, mAB, peerA, peerB, peerC;
let _at = now();
const netDoc = (church, boxes) => finalizeEvent({ kind: 30078, created_at: ++_at, tags: [['d', RELAY_NET_D], ['t', 'trinityone']], content: J(boxes.map(b => ({ pubkey: b.relayPub, alwaysOn: true, url: b.wsUrl }))) }, church.sk);
const u = (r) => secure(r.wsUrl);
// what each church's signed doc says; the netdoc cache a phone keeps is the shape adoptChurchNetDocAddresses writes
const rowsOf = (...boxes) => Object.fromEntries(boxes.map(b => [u(b), b.relayPub]));

before(async () => {
  for (const k of ['A', 'B', 'C']) { }
  A = H.key(); B = H.key(); C = H.key(); for (const x of [A, B, C]) x.npub = npubEncode(x.pub);
  mAC = H.key(); mB = H.key(); mAB = H.key(); peerA = H.key(); peerB = H.key(); peerC = H.key();
  S = await H.startRelay({ name: 'S', churches: [A.pub, B.pub, C.pub] });
  HB = await H.startRelay({ name: 'H', churches: [A.pub, C.pub] });
  TB = await H.startRelay({ name: 'TB', churches: [B.pub] });
  // the signed lists sit on S, where members read them
  await H.publishAll(S, [netDoc(A, [HB]), netDoc(B, [TB]), netDoc(C, [HB])]);
});
after(() => { H.stopAll(); setTimeout(() => process.exit(process.exitCode || 0), 2000).unref(); });

const NETDOC_ALL = () => ({ [A.pub]: { hw: 1, rows: rowsOf(HB) }, [B.pub]: { hw: 1, rows: rowsOf(TB) }, [C.pub]: { hw: 1, rows: rowsOf(HB) } });
const sets = (app, cps, peer) => {
  const out = {};
  for (const [n, cp] of cps) {
    out['publishSetFor(' + n + ')'] = app.publishSetFor(cp);
    out['relaysForChurch(' + n + ')'] = app.relaysForChurch(cp);
    out['groupReadRelays(' + n + ')'] = app.groupReadRelays(cp);
  }
  out.profile = app.profilePublishRelays();
  if (peer) out['dm->' + peer.n] = app.dmSendRelays(peer.pub);
  return out;
};
const has = (set, r) => set.includes(u(r));

// A phone whose church-box state is what the app writes after adopting the church's signed list
async function member({ followed, active, cand, rows, roster }) {
  const app = phone({ who: H.key(), relays: cand.map(u), activeChurch: active.pub, followed, netdoc: rows, roster,
    churchboxes: Object.fromEntries(Object.entries(rows).map(([cp, v]) => [cp, Object.keys(v.rows)])) });
  for (const ch of followed) await app.gate.refresh(app.churchRelaysRaw(), ch.pub);
  return app;
}

test('C-only member: C\'s publish, read, group and profile sets all hold H and S, and nothing of B\'s', async () => {
  const app = await member({ followed: [C], active: C, cand: [S, HB], rows: { [C.pub]: { hw: 1, rows: rowsOf(HB) } } });
  try {
    const s = sets(app, [['C', C.pub]]);
    for (const k of Object.keys(s)) { assert.ok(has(s[k], HB), k + ' lacks H: ' + J(s[k])); assert.ok(has(s[k], S), k + ' lacks S'); assert.ok(!has(s[k], TB), k + ' has B\'s box'); }
  } finally { app.close(); }
});

test('A-only member: A\'s sets hold H and S (H is A\'s box too)', async () => {
  const app = await member({ followed: [A], active: A, cand: [S, HB], rows: { [A.pub]: { hw: 1, rows: rowsOf(HB) } } });
  try {
    const s = sets(app, [['A', A.pub]]);
    for (const k of Object.keys(s)) assert.ok(has(s[k], HB) && has(s[k], S), k + ': ' + J(s[k]));
  } finally { app.close(); }
});

test('B-only member whose phone knows only B\'s doc: no set holds H (control: B\'s own box IS in them)', async () => {
  const app = await member({ followed: [B], active: B, cand: [S, TB], rows: { [B.pub]: { hw: 1, rows: rowsOf(TB) } } });
  try {
    const s = sets(app, [['B', B.pub]]);
    for (const k of Object.keys(s)) { assert.ok(!has(s[k], HB), k + ' holds H: ' + J(s[k])); assert.ok(has(s[k], TB) && has(s[k], S), k + ' control lost TB/S: ' + J(s[k])); }
  } finally { app.close(); }
});

test('A+B member: B\'s sets never hold H; A\'s do; profile and a DM to a B-only peer follow the same rule', async () => {
  const rows = { [A.pub]: { hw: 1, rows: rowsOf(HB) }, [B.pub]: { hw: 1, rows: rowsOf(TB) } };
  const app = await member({ followed: [A, B], active: B, cand: [S, HB, TB], rows, roster: { [A.pub]: [peerA.pub], [B.pub]: [peerB.pub] } });
  try {
    const s = sets(app, [['A', A.pub], ['B', B.pub]], { n: 'B-peer', pub: peerB.pub });
    for (const k of ['publishSetFor(B)', 'relaysForChurch(B)', 'groupReadRelays(B)', 'dm->B-peer']) assert.ok(!has(s[k], HB), k + ' sends B\'s traffic to H: ' + J(s[k]));
    for (const k of ['publishSetFor(A)', 'relaysForChurch(A)', 'groupReadRelays(A)']) assert.ok(has(s[k], HB), k + ' lacks H (control)');
    assert.ok(has(s.profile, HB) && has(s.profile, TB) && has(s.profile, S), 'profile must reach H (A), TB (B) and S: ' + J(s.profile) + ' H=' + u(HB) + ' TB=' + u(TB) + ' S=' + u(S));
    const dmA = app.dmSendRelays(peerA.pub);
    assert.ok(has(dmA, HB) && !has(dmA, TB), 'DM to an A-only peer: ' + J(dmA));
  } finally { app.close(); }
});

test('A+C member (H signed by both): admitted once, scoped for both; both churches\' sets hold H', async () => {
  const rows = { [A.pub]: { hw: 1, rows: rowsOf(HB) }, [C.pub]: { hw: 1, rows: rowsOf(HB) } };
  const app = await member({ followed: [A, C], active: C, cand: [S, HB], rows });
  try {
    assert.ok(app.gate.admits(u(HB), A.pub) && app.gate.admits(u(HB), C.pub), 'H not admitted for both churches');
    const v = JSON.parse(app.store.getItem('trinityone.relays.verified'));
    const e = v[Object.keys(v).find(k => k.includes(String(HB.port)))];
    assert.ok(e, 'no verified entry for H: ' + J(v));
    const scopes = Object.keys(e.cps || {});
    assert.ok(scopes.includes(A.pub) && scopes.includes(C.pub), 'verified scopes: ' + J(scopes));
    for (const cp of [A.pub, C.pub]) assert.ok(has(app.publishSetFor(cp), HB));
  } finally { app.close(); }
});

test('C removes H from its list: H leaves C\'s sets but stays in A\'s (staged post-removal phone state: C\'s doc has no H, A\'s still has)', async () => {
  const rows = { [A.pub]: { hw: 2, rows: rowsOf(HB) }, [C.pub]: { hw: 2, rows: {} } };
  const app = phone({ who: H.key(), relays: [S, HB].map(u), activeChurch: C.pub, followed: [A, C], netdoc: rows, churchboxes: { [A.pub]: [u(HB)], [C.pub]: [] } });
  try {
    for (const ch of [A, C]) await app.gate.refresh(app.churchRelaysRaw(), ch.pub);
    assert.ok(has(app.publishSetFor(A.pub), HB), 'A lost H');
    for (const [k, f] of [['publishSetFor', app.publishSetFor], ['relaysForChurch', app.relaysForChurch], ['groupReadRelays', app.groupReadRelays]]) {
      assert.ok(!has(f(C.pub), HB), k + '(C) still holds H after C removed it: ' + J(f(C.pub)));
    }
  } finally { app.close(); }
});

// ── LEAVING A CHURCH TAKES ITS BOXES OFF THE PHONE (G3 3.1, option a) ──
// The member was in A and B, A's adoption put H on the phone and recorded it under A; they LEAVE A (the real
// _forgetChurch, lifted from the shipped bundle). B's traffic must not go to H any more.
test('B-only member who LEFT A: B\'s traffic does not go to H (publish, read, group, profile, dm)', async () => {
  const rows = { [A.pub]: { hw: 1, rows: rowsOf(HB) }, [B.pub]: { hw: 1, rows: rowsOf(TB) } };
  const app = phone({ who: H.key(), relays: [S, TB, HB].map(u), activeChurch: B.pub, followed: [A, B], netdoc: rows, churchboxes: { [B.pub]: [u(TB)] } });
  try {
    await app.gate.refresh(app.churchRelaysRaw(), B.pub);
    app.forgetChurch(A.pub);
    assert.ok(!app.relays().includes(u(HB)), 'H is still on the phone after leaving A: ' + J(app.relays()));
    const s = sets(app, [['B', B.pub]]);
    for (const k of Object.keys(s)) assert.ok(!has(s[k], HB), k + ' sends B-only traffic to H: ' + J(s[k]));
    assert.ok(has(s['relaysForChurch(B)'], TB), 'control: B\'s own box is gone from its reads');
    assert.ok(has(s['relaysForChurch(B)'], S), 'control: the shared server is gone from B\'s reads');
  } finally { app.close(); }
});

test('the same, with NO churchboxes for B (publishSetFor falls through to relaysForChurch)', async () => {
  const rows = { [A.pub]: { hw: 1, rows: rowsOf(HB) }, [B.pub]: { hw: 1, rows: rowsOf(TB) } };
  const app = phone({ who: H.key(), relays: [S, TB, HB].map(u), activeChurch: B.pub, followed: [A, B], netdoc: rows });
  try {
    await app.gate.refresh(app.churchRelaysRaw(), B.pub);
    app.forgetChurch(A.pub);
    const s = sets(app, [['B', B.pub]]);
    for (const k of Object.keys(s)) assert.ok(!has(s[k], HB), k + ' sends B-only traffic to H: ' + J(s[k]));
    assert.ok(has(s['publishSetFor(B)'], S), 'control: the shared server left B\'s publish set');
  } finally { app.close(); }
});

test('CONTROL: a relay the member added by hand (no netdoc record) is still in B\'s reads after leaving A', async () => {
  const hand = await H.startRelay({ name: 'HAND', churches: [B.pub] });
  const rows = { [A.pub]: { hw: 1, rows: rowsOf(HB) }, [B.pub]: { hw: 1, rows: rowsOf(TB) } };
  const app = phone({ who: H.key(), relays: [S, TB, HB, hand].map(u), activeChurch: B.pub, followed: [A, B], netdoc: rows });
  try {
    await app.gate.refresh(app.churchRelaysRaw(), B.pub);
    assert.ok(has(app.relaysForChurch(B.pub), hand), 'control broken: the hand-added relay was not in the reads before leaving');
    app.forgetChurch(A.pub);
    assert.ok(app.relays().includes(u(hand)), 'leaving A removed a hand-added relay from the phone');
    assert.ok(has(app.relaysForChurch(B.pub), hand), 'leaving A removed a hand-added relay from B\'s reads');
    assert.ok(!has(app.relaysForChurch(B.pub), HB), 'H is still read after leaving A');
  } finally { app.close(); }
});

test('CONTROL: an A+C member who leaves A keeps H, because C still signs it', async () => {
  const rows = { [A.pub]: { hw: 1, rows: rowsOf(HB) }, [C.pub]: { hw: 1, rows: rowsOf(HB) } };
  const app = phone({ who: H.key(), relays: [S, HB].map(u), activeChurch: C.pub, followed: [A, C], netdoc: rows, churchboxes: { [C.pub]: [u(HB)] } });
  try {
    await app.gate.refresh(app.churchRelaysRaw(), C.pub);
    app.forgetChurch(A.pub);
    assert.ok(app.relays().includes(u(HB)), 'leaving A dropped H although C signs it');
    const s = sets(app, [['C', C.pub]]);
    for (const k of ['publishSetFor(C)', 'relaysForChurch(C)', 'groupReadRelays(C)']) assert.ok(has(s[k], HB), k + ' lost H: ' + J(s[k]));
    assert.ok(app.gate.admits(u(HB), C.pub), 'C\'s proof of H was forgotten when A left');
  } finally { app.close(); }
});
