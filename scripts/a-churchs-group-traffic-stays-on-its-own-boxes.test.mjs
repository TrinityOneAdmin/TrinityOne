// A CHURCH'S GROUP TRAFFIC GOES TO THAT CHURCH'S BOXES AND THE SHARED SERVERS - NEVER TO ANOTHER CHURCH'S BOX.
// Owner rule 2026-10-26 (TrinityOne-internal/reference/DOMAIN.md, "which boxes get a church's data"), step 2a.
// Run: node --test scripts/a-churchs-group-traffic-stays-on-its-own-boxes.test.mjs
//
// THE MEASURED DEFECT. The member app's group subscriptions (subscribeGroups, subscribeGroup,
// subscribeReactions, subscribeGroupPin, subscribeHidden, subscribeGroupEvents) read over
// `_netRelays(window.Fellowship.relays)` - the ONE candidate list for every church the phone follows - so
// when church A's signed relay-net document put A's box TA on the phone, church B's group REQs (group ids and
// the member's pubkey) were sent to TA as well.
//
// HOW IT IS DRIVEN (CLAUDE.md rules 1 and 3, and the memory "tests must drive shipped code"). Every relay is a
// real `node scripts/gateway.mjs` (scripts/relay-network-harness.mjs): SHARED (the shared pool), TA (church
// A's box). The shipped gate, relaysForChurch, groupReadRelays and the six shipped subscribe methods are
// lifted OUT OF vendor/fellowship.js and RUN against a real SimplePool. A's relay-net document is published
// to a real box and read back off the wire, and TA is proved by a real /relay-identity exchange. What is
// observed is the WIRE: globalThis.WebSocket is wrapped so every `["REQ", ...]` frame the pool sends is
// recorded against the box it went to. Nothing about which box gets a REQ is injected. THE ONE THING FAKED IS
// TLS, as in the sibling tests: wss://127.0.0.1 is rewritten to ws:// at the transport.
//
// The one hand-set fact is the record `trinityone.relays.netdoc` ({A: {rows: {TA: key}}}) which the shipped
// adoptChurchNetDocAddresses writes when it adopts TA; that adoption is proved in
// scripts/a-member-adopts-its-churchs-signed-relay.test.mjs and is not re-proved here.
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
const REQS = [];   // { url, filters }
const RealWS = globalThis.WebSocket;
class RecordingWS extends RealWS {
  send(data) {
    try { const m = JSON.parse(data); if (Array.isArray(m) && m[0] === 'REQ') REQS.push({ url: this.url, filters: m.slice(2) }); } catch (e) {}
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
function phone({ relays, canonical, pins, activeChurch, netdoc, who }) {
  const src = FELLOW;
  const me = who || H.key();
  const pool = wirePool(me);
  const store = memStore();
  if (netdoc) store.setItem('trinityone.relays.netdoc', JSON.stringify(netdoc));
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
    // ── THE THING UNDER TEST: the shipped group read-set chooser and the shipped subscribers ───────────
    fnBody(src, 'function groupReadRelays', 'groupReadRelays'),
    stmt(src, 'var NET = ', 'NET'),
    fnBody(src, 'function _coalesce', '_coalesce'),
    fnBody(src, 'function _decEvt', '_decEvt'),
  ].join('\n');
  const win = fakeWindow();
  win.Fellowship = { relays: [...relays], churchPub: activeChurch, ready: Promise.resolve() };
  const methods = {};
  for (const [name, sig] of [
    ['subscribeGroups', 'subscribeGroups(groupIds, onEvent) {'],
    ['subscribeGroup', 'subscribeGroup(groupId, onEvent) {'],
    ['subscribeReactions', 'subscribeReactions(groupId, onReaction) {'],
    ['subscribeGroupPin', 'subscribeGroupPin(groupId, cb) {'],
    ['subscribeHidden', 'subscribeHidden(groupId, cb) {'],
    ['subscribeGroupEvents', 'subscribeGroupEvents(churchNpub, groupIds, onEvents) {'],
  ]) methods[name] = fnBody(src, sig, name);
  const scope = scopeOf({
    localStorage: store, window: win, pool, console, fetch: netFetch,
    CANONICAL_RELAYS: canonical, CANONICAL_RELAY_PUBS: pins, DEFAULT_RELAYS: canonical,
    _native: false, _staticHost: false, _loc: null,
    normalizeURL, verifyEvent, finalizeEvent, CustomEvent: Ev,
    decode: nip19decode, nip19decode, performance, normalizeURL2: normalizeURL,
    // the room-key ring (empty: every message here is clear text, so _decEvt returns it untouched) and the
    // authority check on pins / hides / group events, which this test is not about.
    _gkeys: {}, _gkKey: (c, g) => c + '|' + g, nip44d: () => { throw new Error('no key'); },
    _groupEventTrusted: () => true, _reduceAll: () => {}, _absorbById: () => {}, _forgetById: () => {},
    _tombstoneTargets: () => [], sk: me.sk, pub: me.pub,
  });
  const api = new Function('scope', `with (scope) { ${body}
    const _api = { ${Object.values(methods).join(',\n')} };
    return { ..._api, relaysForChurch, groupReadRelays, gate: _gate, churchRelaysRaw }; }`)(scope);
  api.win = win; api.pool = pool; api.me = me;
  api.close = () => { try { pool.shutdown(); } catch (e) {} };
  return api;
}

const now = () => Math.floor(Date.now() / 1000);
const joinDoc = (who, cp) => finalizeEvent(
  { kind: 30078, created_at: now(), tags: [['d', 'trinityone/member:' + cp], ['t', 'trinityone'], ['church', cp]], content: '{}' }, who.sk);
const groupPost = (who, cp, gid, text) => finalizeEvent(
  { kind: 1, created_at: now(), tags: [['t', 'trinityone'], ['t', gid], ['p', cp]], content: text }, who.sk);
let _docAt = now();
const relayNetDocFor = (church, rows) => finalizeEvent(
  { kind: 30078, created_at: ++_docAt, tags: [['d', RELAY_NET_D], ['t', 'trinityone']], content: JSON.stringify(rows) }, church.sk);

let A, B, SHARED, TA, GID_A, GID_B, poster, reader;
before(async () => {
  useWebSocketImplementation(RecordingWS);   // the pool captured the global at import time, so the global itself is not enough
  A = H.key(); A.npub = npubEncode(A.pub);
  B = H.key(); B.npub = npubEncode(B.pub);
  poster = H.key();
  reader = H.key();   // the phone's own key: a member of both churches, so the relays will answer its reads
  GID_A = 'room-of-A-' + A.pub.slice(0, 6);
  GID_B = 'room-of-B-' + B.pub.slice(0, 6);
  SHARED = await H.startRelay({ name: 'SHARED', churches: [A.pub, B.pub] });
  TA = await H.startRelay({ name: 'TA', churches: [A.pub] });
  assert.notEqual(SHARED.relayPub, TA.relayPub);
  // A's group post lives on BOTH (a church's data is on its own box and on the shared servers); B's only on SHARED.
  await H.publishAll(SHARED, [joinDoc(poster, A.pub), joinDoc(poster, B.pub), joinDoc(reader, A.pub), joinDoc(reader, B.pub), groupPost(poster, A.pub, GID_A, 'hello A'), groupPost(poster, B.pub, GID_B, 'hello B')]);
  await H.publishAll(TA, [joinDoc(poster, A.pub), joinDoc(reader, A.pub), groupPost(poster, A.pub, GID_A, 'hello A on TA')]);
  // A's signed relay-net document names TA, and sits on the shared relay where members read it.
  await H.publishAll(SHARED, [relayNetDocFor(A, [{ pubkey: TA.relayPub, alwaysOn: true, url: TA.wsUrl }])]);
});
after(() => {
  useWebSocketImplementation(RealWS);
  H.stopAll();
  try { setTimeout(() => process.exit(process.exitCode || 0), 10000).unref(); } catch (e) {}
});

// A member of churches A and B whose phone holds the candidate list [shared, TA] - TA came from A's signed
// document, and is recorded as A's (netdoc) exactly as adoptChurchNetDocAddresses records it.
async function member(activeChurch) {
  const app = phone({
    who: reader,
    relays: [secure(SHARED.wsUrl), secure(TA.wsUrl)],
    canonical: [secure(SHARED.wsUrl)], pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] },
    activeChurch: activeChurch === 'A' ? A.pub : activeChurch === 'B' ? B.pub : null,
    netdoc: { [A.pub]: { hw: 1, rows: { [secure(TA.wsUrl)]: TA.relayPub } } },
  });
  // TA is PROVED for church A (the shipped gate, a real /relay-identity exchange against the real box).
  await app.gate.refresh(app.churchRelaysRaw(), A.pub);
  // ...and the same box is ALSO admitted when asked about church B: it proves it runs our relay software, and
  // that rule is church-independent (RELAY-ADMISSION). This is the measured leak - admission alone did not keep
  // A's box out of B's traffic, so the test must stage it admitted for B or the old code looks innocent.
  await app.gate.refresh(app.churchRelaysRaw(), B.pub);
  assert.ok(app.gate.admits(secure(TA.wsUrl), B.pub), 'staging fault: TA is not admitted for church B, so a leak could not be seen');
  return app;
}
const SUBS = {
  subscribeGroups: (app, gid) => app.subscribeGroups([gid], () => {}),
  subscribeGroup: (app, gid) => app.subscribeGroup(gid, () => {}),
  subscribeReactions: (app, gid) => app.subscribeReactions(gid, () => {}),
  subscribeGroupPin: (app, gid) => app.subscribeGroupPin(gid, () => {}),
  subscribeHidden: (app, gid) => app.subscribeHidden(gid, () => {}),
  subscribeGroupEvents: (app, gid, cp) => app.subscribeGroupEvents(npubEncode(cp), [gid], () => {}),
};

test('precondition: for church A the read set holds TA and the shared pool; for church B it holds the shared pool only', async () => {
  const app = await member('A');
  try {
    const a = app.relaysForChurch(A.pub), b = app.relaysForChurch(B.pub);
    assert.ok(a.includes(secure(TA.wsUrl)) && a.includes(secure(SHARED.wsUrl)), 'A: ' + JSON.stringify(a));
    assert.ok(b.includes(secure(SHARED.wsUrl)) && !b.includes(secure(TA.wsUrl)), 'B: ' + JSON.stringify(b));
  } finally { app.close(); }
});

for (const name of Object.keys(SUBS)) {
  test(`${name}: church B's group REQ never reaches church A's box, and the shared pool still gets it`, async () => {
    const app = await member('B');
    const from = REQS.length;
    const off = SUBS[name](app, GID_B, B.pub);
    try {
      await sleep(1500);
      const mine = REQS.slice(from);
            const atTA = mine.filter(r => r.url === TA.wsUrl && mentions(r, GID_B));
      assert.equal(atTA.length, 0, `${name}: church A's box TA was sent a REQ naming church B's group: ` + JSON.stringify(atTA));
      const atShared = mine.filter(r => r.url === SHARED.wsUrl && mentions(r, GID_B));
      assert.ok(atShared.length >= 1, `${name}: the shared servers got no REQ for B's group - B's group screens would go blank`);
    } finally { off(); app.close(); }
  });

  test(`${name}: CONTROL - church A's group REQ IS sent to A's own box (and to the shared pool)`, async () => {
    const app = await member('A');
    const from = REQS.length;
    const off = SUBS[name](app, GID_A, A.pub);
    try {
      await sleep(1500);
      const mine = REQS.slice(from);
      assert.ok(mine.some(r => r.url === TA.wsUrl && mentions(r, GID_A)), `${name}: A's own box got no REQ for A's group`);
      assert.ok(mine.some(r => r.url === SHARED.wsUrl && mentions(r, GID_A)), `${name}: the shared pool got no REQ for A's group`);
    } finally { off(); app.close(); }
  });
}

test('with no active church the group read is the SHARED POOL ONLY - never the whole candidate list, never empty', async () => {
  const app = await member(null);
  try {
    const set = app.groupReadRelays(null);
    assert.deepEqual(set, [secure(SHARED.wsUrl)]);
    const from = REQS.length;
    const off = app.subscribeGroup(GID_B, () => {});
    await sleep(1200);
    const mine = REQS.slice(from);
    assert.equal(mine.filter(r => r.url === TA.wsUrl).length, 0, 'an unscoped group read reached a church box');
    assert.ok(mine.some(r => r.url === SHARED.wsUrl && mentions(r, GID_B)), 'an unscoped group read reached no one');
    off();
  } finally { app.close(); }
});

test('point of use: church B\'s group posts are still DELIVERED from the shared relay, and A\'s from A\'s own box', async () => {
  const appB = await member('B');
  const gotB = [];
  const offB = appB.subscribeGroup(GID_B, (e) => gotB.push(e.content));
  const appA = await member('A');
  const gotA = [];
  const offA = appA.subscribeGroup(GID_A, (e) => gotA.push(e.content));
  try {
    for (let i = 0; i < 50 && !(gotB.length && gotA.includes('hello A on TA')); i++) await sleep(200);
    assert.ok(gotB.includes('hello B'), 'B\'s group post did not arrive: ' + JSON.stringify(gotB));
    assert.ok(gotA.includes('hello A on TA'), 'A\'s post held ONLY on A\'s box did not arrive: ' + JSON.stringify(gotA));
  } finally { offA(); offB(); appA.close(); appB.close(); }
});
