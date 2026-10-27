// STRESS BATCH 3: A PHONE THAT IS OFFLINE WHILE THE CHURCH CHANGES ITS BOXES. Drives the SHIPPED vendor/fellowship.js
// (publishMessage, sendDM, leaveMembership, _outboxFlush, publishSetFor, _outboxRelays) against real gateway relays.
// Offline = the transport refuses (WebSocket redirected to a dead port -> real ECONNREFUSED); no app code edited.
//
// Written on stress/batch3 (26dbb7d5) with seven FINDINGs as `todo`. fix/stress-g2 (2026-10-27) turned each into a
// real assertion: 1a/2a/3 (a queued post goes to the church's boxes AS THEY ARE when it is sent), 5a (an offline
// Leave is queued and delivered on reconnect — rewritten for the queued shape), 5b (a queued join is removed by the
// Leave), 5c (rewritten for the owner's decision: what was queued before the Leave is sent FIRST, then the
// tombstone), 6b (a full queue refuses the new message instead of dropping the oldest). Added: 7 (a box the phone
// has not proved yet holds the queued post rather than letting it go to the shared server alone), 5d (nothing new
// is posted to a church while its Leave is waiting).
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
// FETCH_DOWN: hosts whose HTTP (the relay-identity proof) is unreachable — for test 7, where the church's box must
// stay UNPROVED while the queue flushes. Everything else goes through.
const FETCH_DOWN = new Set();
const hostOf = (u) => { try { return new URL(wire(String(u))).host; } catch (e) { return ''; } };
const netFetch = (u, o) => (FETCH_DOWN.has(hostOf(typeof u === 'string' ? u : String(u)))
  ? Promise.reject(new TypeError('fetch failed'))
  : globalThis.fetch(wire(typeof u === 'string' ? u : String(u)), o));

// ── the wire recorder: every REQ frame, against the address it was sent to ──────────────────────────────
const PUBLOG = []; const REQS = []; const EVTS = [];   // { url, filters } / { url, ev }
const RealWS = globalThis.WebSocket;
const OFFLINE = new Set(); const LIVE_SOCKS = new Set();
class RecordingWS extends RealWS {
  constructor(url, ...rest) {
    const off = [...OFFLINE].some(o => String(url).startsWith(o));
    super(off ? 'ws://127.0.0.1:1/relay' : url, ...rest);
    this._asked = url; this._off = off; LIVE_SOCKS.add(this);
  }
  get url() { return this._asked; }
  send(data) {
    try { const m = JSON.parse(data); if (Array.isArray(m) && m[0] === 'REQ') REQS.push({ url: this.url, filters: m.slice(2) }); if (Array.isArray(m) && m[0] === 'EVENT' && !this._off) EVTS.push({ url: this.url, ev: m[1], at: Date.now() }); } catch (e) {}
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
    publish: (urls, e) => { PUBLOG.push({ at: Date.now(), urls: list(urls), id: e.id }); return p.publish(list(urls), e); },
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
const forgotten = [];
function phone({ relays, canonical, pins, activeChurch, followed, netdoc, who, roster, outbox }) {
  const src = FELLOW;
  const me = who || H.key();
  const pool = wirePool(me);
  const store = memStore();
  if (netdoc) store.setItem('trinityone.relays.netdoc', JSON.stringify(netdoc));
  if (followed) store.setItem('trinityone.followedChurches', JSON.stringify(followed.map(c => ({ id: c.npub }))));
  // the on-device member roster the app already keeps per church (what _memHub seeds from)
  for (const [cp, people] of Object.entries(roster || {})) store.setItem('trinityone.memhub.' + cp, JSON.stringify({ since: 0, fullAt: 0, members: people.map(p => ({ pubkey: p, joined: 1700000000, msgs: 0 })) }));
  if (outbox) store.setItem('trinityone.outbox', JSON.stringify(outbox));
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
    // ── the member roster the app already holds, and the things under test ──
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
    fnBody(src, 'function dmReadRelays', 'dmReadRelays'),
    fnBody(src, 'function _outboxRelays', '_outboxRelays'),
    fnBody(src, 'function _saveChurchBoxes', '_saveChurchBoxes'),
    fnBody(src, 'function _pubReason', '_pubReason'),
    fnBody(src, 'function _wantsEncrypted', '_wantsEncrypted'),
    fnBody(src, 'function _groupDoc', '_groupDoc'),
    fnBody(src, 'function loadDocCache', 'loadDocCache'),
    stmt(src, 'var _gkKey = ', '_gkKey'),
    'const _gkeys = {};',
    // ── the shipped publisher, outbox and what they need ──
    stmt(src, 'var NO_NETWORK_RELAY = ', 'NO_NETWORK_RELAY'),
    stmt(src, 'var WEDGE_ACK_MS = ', 'WEDGE_ACK_MS'),
    stmt(src, 'var _PUB_REFUSED = ', '_PUB_REFUSED'),
    stmt(src, 'var _PUB_FAILED = ', '_PUB_FAILED'),
    stmt(src, 'var _PUB_SILENT = ', '_PUB_SILENT'),
    fnBody(src, 'function _wedgeKey', '_wedgeKey'),
    fnBody(src, 'function _classify', '_classify'),
    fnBody(src, 'function _dedupeRelays', '_dedupeRelays'),
    fnBody(src, 'function _publishAny', '_publishAny'),
    stmt(src, 'var PUBLISH_TIMEOUT_MS = ', 'PUBLISH_TIMEOUT_MS'),
    fnBody(src, 'function _publishBounded', '_publishBounded'),
    stmt(src, 'var OUTBOX_KEY = ', 'OUTBOX_KEY'),
    stmt(src, 'var OUTBOX_FAILED_KEY = ', 'OUTBOX_FAILED_KEY'),
    stmt(src, 'var OUTBOX_MAX = ', 'OUTBOX_MAX'),
    'const _dmPlain = new Map(); let _outbox = []; let _outboxFailed = []; const _outboxSubs = new Set();',
    fnBody(src, 'function _outboxLoad', '_outboxLoad'),
    fnBody(src, 'function _outboxSave', '_outboxSave'),
    '_outboxLoad();',
    'let _flushing = false;',
    stmt(src, 'var _CONNECTION = ', '_CONNECTION'),
    'const isConnectionFailure = (e) => _CONNECTION.test(String((e && e.message) || e || ""));',
    stmt(src, 'var MAX_TRIES = ', 'MAX_TRIES'),
    stmt(src, 'var _PERMANENT = ', '_PERMANENT'),
    stmt(src, 'var isPermanentRefusal = ', 'isPermanentRefusal'),
    stmt(src, 'var isRateLimited = ', 'isRateLimited'),
    stmt(src, 'var isNoNetworkRelay = ', 'isNoNetworkRelay'),
    fnBody(src, 'function _outboxFull', '_outboxFull'),
    fnBody(src, 'function _itemChurch', '_itemChurch'),
    stmt(src, 'var _left = ', '_left'),
    fnBody(src, 'function _leavingFor', '_leavingFor'),
    fnBody(src, 'function _announceBlocked', '_announceBlocked'),
    fnBody(src, 'function _outboxDropJoins', '_outboxDropJoins'),
    stmt(src, 'var HOLD_UNPROVED_S = ', 'HOLD_UNPROVED_S'),
    fnBody(src, 'async function _heldForUnprovedBoxes', '_heldForUnprovedBoxes'),
    fnBody(src, 'function _leaveDelivered', '_leaveDelivered'),
    fnBody(src, 'async function _outboxFlush', '_outboxFlush'),
    fnBody(src, 'function _coalesce', '_coalesce'),
  ].join('\n');
  const win = fakeWindow();
  win.Fellowship = { relays: [...relays], churchPub: activeChurch, ready: Promise.resolve() };
  win.Fellowship.addRelay = (u) => { win.Fellowship.relays = [...win.Fellowship.relays, u]; };
  win.Fellowship._dmWrap = (c) => c;
  win.Fellowship._dmUnwrap = (c) => ({ text: c, replyTo: null });
  const methods = [
    fnBody(src, 'async sendDM(peerPub, content, replyTo) {', 'sendDM'),
    fnBody(src, 'async reactDM(peerPub, msgId, emoji) {', 'reactDM'),
    fnBody(src, 'async publishMessage(groupId, content, extraTags = [], opts = {}) {', 'publishMessage'),
    fnBody(src, 'async leaveMembership(npubOrHex) {', 'leaveMembership'),
    fnBody(src, 'subscribeThread(peerPub, onMsg) {', 'subscribeThread'),
    fnBody(src, 'subscribeDMs(onConvos) {', 'subscribeDMs'),
  ].join(',\n');
  const scope = scopeOf({
    localStorage: store, window: win, pool, console, fetch: netFetch,
    CANONICAL_RELAYS: canonical, CANONICAL_RELAY_PUBS: pins, DEFAULT_RELAYS: canonical,
    _native: false, _staticHost: false, _loc: null,
    normalizeURL, verifyEvent, finalizeEvent, CustomEvent: Ev,
    decode: nip19decode, nip19decode, performance, normalizeURL2: normalizeURL,
    _noteSendResult: () => {}, _monotonicF: (t) => t, _leaveGen: {}, _joinSent: {}, _joinIntents: [], _clearJoinSent: () => {}, _dropJoinIntent: () => {}, _forgetChurch: (cp) => { forgotten.push(cp); }, _checkIfBlocked: () => {}, _mayCache: () => true, NET: 'trinityone', _docsHubs: new Map(), _docsHubOpen: () => {},
    _dmEncrypt: (sk, peer, body) => body, _dmDecrypt: async (sk, peer, c) => c,
    sk: me.sk, pub: me.pub,
  });
  void 0;
  const api = new Function('scope', `with (scope) { ${body}
    const _api = { ${methods} };
    return { publishMessage: (g, c) => _api.publishMessage(g, c), leaveMembership: (c) => _api.leaveMembership(c), saveBoxes: _saveChurchBoxes, sendDM: (p, c) => _api.sendDM(p, c), reactDM: (p, i, e) => _api.reactDM(p, i, e),
             subscribeThread: (p, f) => _api.subscribeThread(p, f), subscribeDMs: (f) => _api.subscribeDMs(f),
             relaysForChurch, publishSetFor, memberChurchPubs, dmSendRelays, dmReadRelays, _outboxRelays, _outboxFlush,
             outbox: () => _outbox, failed: () => _outboxFailed, leaving: (c) => _leavingFor(c), gate: _gate, churchRelaysRaw }; }`)(scope);
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

let A, B, SHARED, TA, TB, T, sarah, tom, stranger;
before(async () => {
  useWebSocketImplementation(RecordingWS);
  A = H.key(); A.npub = npubEncode(A.pub);
  B = H.key(); B.npub = npubEncode(B.pub);
  sarah = H.key(); tom = H.key(); stranger = H.key();
  SHARED = await H.startRelay({ name: 'SHARED', churches: [A.pub, B.pub] });
  TA = await H.startRelay({ name: 'TA', churches: [A.pub] });
  TB = await H.startRelay({ name: 'TB', churches: [B.pub] });
  T = await H.startRelay({ name: 'T', churches: [A.pub] });
  await H.publishAll(SHARED, [joinDoc(sarah, A.pub), joinDoc(sarah, B.pub), joinDoc(tom, A.pub)]);
  await H.publishAll(TA, [joinDoc(sarah, A.pub), joinDoc(tom, A.pub)]);
  await H.publishAll(TB, [joinDoc(sarah, B.pub)]);
  await H.publishAll(T, [joinDoc(sarah, A.pub), joinDoc(tom, A.pub)]);
});
after(() => {
  useWebSocketImplementation(RealWS);
  H.stopAll();
  try { setTimeout(() => process.exit(process.exitCode || 0), 10000).unref(); } catch (e) {}
});

// Sarah is in A and B. Her candidate list holds every box any church's document put there: TA (A's), TB (B's).
// Tom (a member of A only, as her phone's own roster shows) is in A's roster and nobody else's.
async function sarahsPhone({ outbox } = {}) {
  const app = phone({
    who: sarah,
    relays: [secure(SHARED.wsUrl), secure(TA.wsUrl), secure(TB.wsUrl)],
    canonical: [secure(SHARED.wsUrl)], pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] },
    activeChurch: A.pub, followed: [A, B],
    netdoc: { [A.pub]: { hw: 1, rows: { [secure(TA.wsUrl)]: TA.relayPub } }, [B.pub]: { hw: 1, rows: { [secure(TB.wsUrl)]: TB.relayPub } } },
    roster: { [A.pub]: [tom.pub, sarah.pub], [B.pub]: [sarah.pub] },
    outbox,
  });
  // every box is PROVED and admitted for every church, so admission alone does not keep TB out of A's traffic
  for (const ch of [A, B]) await app.gate.refresh(app.churchRelaysRaw(), ch.pub);
  assert.ok(app.gate.admits(secure(TB.wsUrl), A.pub), 'staging fault: TB is not admitted for A, so a leak could not be seen');
  assert.ok(app.gate.admits(secure(TA.wsUrl), B.pub), 'staging fault: TA is not admitted for B');
  return app;
}
const dmTo = (peerPub) => EVTS.filter(x => x.ev && x.ev.kind === 4 && x.ev.pubkey === sarah.pub && JSON.stringify(x.ev.tags).includes(peerPub));
const landedAt = (relay, peerPub, from) => EVTS.slice(from).filter(x => x.url === relay.wsUrl && x.ev && x.ev.kind === 4 && JSON.stringify(x.ev.tags).includes(peerPub)).length;


// ════════ helpers for this batch ════════════════════════════════════════════════════════════════════════
async function goOffline(...relays) {
  for (const r of relays) OFFLINE.add(r.wsUrl);
  for (const s of [...LIVE_SOCKS]) if ([...OFFLINE].some(o => String(s._asked).startsWith(o))) { try { s.terminate ? s.terminate() : s.close(); } catch (e) {} }
  await sleep(500);   // let the pool see the close before the next send
}
function goOnline(...relays) { for (const r of relays) OFFLINE.delete(r.wsUrl); }
const grpLanded = (relay, text, from) => EVTS.slice(from).filter(x => x.url === relay.wsUrl && x.ev && x.ev.kind === 1 && x.ev.pubkey === sarah.pub && JSON.stringify(x.ev.tags).includes(A.pub) && x.ev.content === text).length;
const grpLandedAny = (relay, text, from) => EVTS.slice(from).filter(x => x.url === relay.wsUrl && x.ev && x.ev.kind === 1 && x.ev.pubkey === sarah.pub && x.ev.content === text).length;
// What the app's own adoption (_applyChurchList) does when a church's list changes: persist the church's boxes,
// and the box set the gate admits. The adoption itself is proved in a-member-adopts-*/a-member-learns-*; here the
// subject is the QUEUE, so the church's change is applied by the same _saveChurchBoxes + the church's signed doc.
async function churchChangesBoxes(app, church, boxes, extraCandidates = []) {
  const rows = {}; for (const b of boxes) rows[secure(b.wsUrl)] = b.relayPub;
  app.saveBoxes(church.pub, boxes.map(b => secure(b.wsUrl)));
  const nd = JSON.parse(app.store.getItem('trinityone.relays.netdoc') || '{}');
  nd[church.pub] = { hw: ((nd[church.pub] || {}).hw || 1) + 1, rows };
  app.store.setItem('trinityone.relays.netdoc', JSON.stringify(nd));
  app.win.Fellowship.relays = [...new Set([secure(SHARED.wsUrl), ...boxes.map(b => secure(b.wsUrl)), ...extraCandidates.map(b => secure(b.wsUrl))])];
  // publish the church's new signed list to a box (what the console does) and let the shipped gate re-read it
  await H.publishAll(SHARED, [relayNetDocFor(church, boxes.map(b => ({ url: secure(b.wsUrl), pubkey: b.relayPub })))]);
  await app.gate.refresh(app.churchRelaysRaw(), church.pub);
}
async function phoneA({ relays = [TA], extra = [] , who, outbox, store } = {}) {
  const app = phone({
    who: who || sarah,
    relays: [secure(SHARED.wsUrl), ...relays.map(r => secure(r.wsUrl))],
    canonical: [secure(SHARED.wsUrl)], pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] },
    activeChurch: A.pub, followed: [A],
    netdoc: { [A.pub]: { hw: 1, rows: Object.fromEntries(relays.map(r => [secure(r.wsUrl), r.relayPub])) } },
    roster: { [A.pub]: [tom.pub, sarah.pub] }, outbox,
  });
  app.saveBoxes(A.pub, relays.map(r => secure(r.wsUrl)));
  for (const r of extra) app.win.Fellowship.relays.push(secure(r.wsUrl));
  await app.gate.refresh(app.churchRelaysRaw(), A.pub);
  return app;
}

test('CONTROL: online, a group post and a DM both land on the shared server and A\'s box (and not on B\'s)', async () => {
  const app = await phoneA();
  try {
    assert.ok(app.publishSetFor(A.pub).includes(secure(TA.wsUrl)), JSON.stringify(app.publishSetFor(A.pub)));
    const from = EVTS.length;
    const evt = await app.publishMessage('g1', 'control post');
    assert.equal(evt._delivered, true);
    await sleep(400);
    assert.ok(grpLanded(SHARED, 'control post', from) >= 1 && grpLanded(TA, 'control post', from) >= 1, 'control post missed a box');
    assert.equal(grpLandedAny(TB, 'control post', from), 0);
  } finally { app.close(); }
});

// ── 1. church ADDS box T while the phone is offline ────────────────────────────────────────────────────
test('1a. offline GROUP POST, church adds T, reconnect: the queued post reaches T (T is now one of A\'s boxes)', async () => {
  const app = await phoneA();
  try {
    await goOffline(SHARED, TA, T);
    const from = EVTS.length;
    const evt = await app.publishMessage('g1', 'queued while T unknown');
    assert.equal(evt._delivered, false, 'offline send claimed delivery');
    assert.equal(app.outbox().length >= 1, true, 'nothing queued');
    await churchChangesBoxes(app, A, [TA, T]);                // church adds T (phone learns it, still offline in the sense the queue is not yet flushed)
    assert.ok(app.publishSetFor(A.pub).includes(secure(T.wsUrl)), 'staging: T is not in A\'s live publish set after the church added it: ' + JSON.stringify(app.publishSetFor(A.pub)));
    goOnline(SHARED, TA, T);
    await app._outboxFlush(); await sleep(600);
    assert.ok(grpLanded(SHARED, 'queued while T unknown', from) >= 1, 'CONTROL: the post did not even reach the shared server after reconnect');
    assert.ok(grpLanded(TA, 'queued while T unknown', from) >= 1, 'CONTROL: the post did not reach TA after reconnect');
    assert.ok(grpLanded(T, 'queued while T unknown', from) >= 1, 'T (added by the church while the phone was offline) never got the queued post. queued relays=' + JSON.stringify((app.outbox()[0] || {}).relays));
  } finally { goOnline(SHARED, TA, T); app.close(); }
});

test('1b. offline DM, church adds T, reconnect: the DM is re-derived at flush and reaches T (PASS expected: DMs use the live set)', async () => {
  const app = await phoneA();
  try {
    await goOffline(SHARED, TA, T);
    const from = EVTS.length;
    const evt = await app.sendDM(tom.pub, 'dm queued while T unknown');
    assert.equal(evt._delivered, false);
    await churchChangesBoxes(app, A, [TA, T]);
    goOnline(SHARED, TA, T);
    await app._outboxFlush(); await sleep(600);
    assert.ok(landedAt(SHARED, tom.pub, from) >= 1 && landedAt(TA, tom.pub, from) >= 1, 'CONTROL: DM missed shared/TA');
    assert.ok(landedAt(T, tom.pub, from) >= 1, 'the DM never reached the newly added box T');
  } finally { goOnline(SHARED, TA, T); app.close(); }
});

// ── 2. church REMOVES box T while the phone is offline ─────────────────────────────────────────────────
test('2a. offline GROUP POST (queued while T is A\'s box), church removes T, reconnect: nothing goes to T', async () => {
  const app = await phoneA({ relays: [TA, T] });
  try {
    assert.ok(app.publishSetFor(A.pub).includes(secure(T.wsUrl)), 'staging: T not in the set before removal');
    await goOffline(SHARED, TA, T);
    const from = EVTS.length;
    await app.publishMessage('g1', 'queued while T was mine');
    await churchChangesBoxes(app, A, [TA]);                    // church removes T
    assert.ok(!app.publishSetFor(A.pub).includes(secure(T.wsUrl)), 'staging: T still in the live set after removal: ' + JSON.stringify(app.publishSetFor(A.pub)));
    goOnline(SHARED, TA, T);
    await app._outboxFlush(); await sleep(600);
    assert.ok(grpLanded(TA, 'queued while T was mine', from) >= 1 && grpLanded(SHARED, 'queued while T was mine', from) >= 1, 'CONTROL: did not reach shared/TA');
    assert.equal(grpLandedAny(T, 'queued while T was mine', from), 0, 'the queued post was delivered to T after the church removed it');
  } finally { goOnline(SHARED, TA, T); app.close(); }
});

test('2b. offline DM, church removes T, reconnect: nothing goes to T (PASS expected)', async () => {
  const app = await phoneA({ relays: [TA, T] });
  try {
    await goOffline(SHARED, TA, T);
    const from = EVTS.length;
    await app.sendDM(tom.pub, 'dm queued while T was mine');
    await churchChangesBoxes(app, A, [TA]);
    goOnline(SHARED, TA, T);
    await app._outboxFlush(); await sleep(600);
    assert.ok(landedAt(TA, tom.pub, from) >= 1 && landedAt(SHARED, tom.pub, from) >= 1, 'CONTROL');
    assert.equal(landedAt(T, tom.pub, from), 0, 'DM went to the removed box');
  } finally { goOnline(SHARED, TA, T); app.close(); }
});

// ── 3. T MOVES address while the phone is offline ──────────────────────────────────────────────────────
test('3. offline GROUP POST queued for T at its OLD address; T moves; reconnect: the post reaches the NEW address', async () => {
  const T1 = await H.startRelay({ name: 'T1', churches: [A.pub] });
  await H.publishAll(T1, [joinDoc(sarah, A.pub), joinDoc(tom, A.pub)]);
  const app = await phoneA({ relays: [TA, T1] });
  let T2;
  try {
    await goOffline(SHARED, TA, T1);
    const from = EVTS.length;
    await app.publishMessage('g1', 'queued for T old address');
    T2 = await H.moveRelay(T1);                                // same box, same key, NEW address; old one is dead
    await churchChangesBoxes(app, A, [TA, T2]);
    assert.ok(app.publishSetFor(A.pub).includes(secure(T2.wsUrl)), 'staging: new address not in set');
    goOnline(SHARED, TA);
    await app._outboxFlush(); await sleep(800);
    assert.ok(grpLanded(TA, 'queued for T old address', from) >= 1, 'CONTROL: did not reach TA');
    assert.ok(grpLanded(T2, 'queued for T old address', from) >= 1, 'the moved box (new address) never got the queued post. queued relays=' + JSON.stringify((app.outbox()[0] || {}).relays));
  } finally { goOnline(SHARED, TA, T1); app.close(); }
});

// ── 4. member of A and B, offline, writes to both ──────────────────────────────────────────────────────
test('4. member in A and B, offline, writes group posts and DMs to both churches; on reconnect B\'s traffic never reaches A\'s box and vice versa', async () => {
  const app = phone({
    who: sarah, relays: [secure(SHARED.wsUrl), secure(TA.wsUrl), secure(TB.wsUrl)],
    canonical: [secure(SHARED.wsUrl)], pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] },
    activeChurch: A.pub, followed: [A, B],
    netdoc: { [A.pub]: { hw: 1, rows: { [secure(TA.wsUrl)]: TA.relayPub } }, [B.pub]: { hw: 1, rows: { [secure(TB.wsUrl)]: TB.relayPub } } },
    roster: { [A.pub]: [tom.pub, sarah.pub], [B.pub]: [sarah.pub] },
  });
  try {
    app.saveBoxes(A.pub, [secure(TA.wsUrl)]); app.saveBoxes(B.pub, [secure(TB.wsUrl)]);
    for (const ch of [A, B]) await app.gate.refresh(app.churchRelaysRaw(), ch.pub);
    await goOffline(SHARED, TA, TB);
    const from = EVTS.length;
    app.win.Fellowship.churchPub = A.pub; await app.publishMessage('g1', 'post to A');
    app.win.Fellowship.churchPub = B.pub; await app.publishMessage('gB', 'post to B');
    await app.sendDM(tom.pub, 'dm to tom (A)');
    await app.sendDM(B.pub, 'dm to church B');
    goOnline(SHARED, TA, TB);
    await app._outboxFlush(); await sleep(800);
    const any = (relay, text) => EVTS.slice(from).filter(x => x.url === relay.wsUrl && x.ev && x.ev.content === text).length;
    assert.ok(any(TA, 'post to A') >= 1 && any(TB, 'post to B') >= 1 && any(SHARED, 'post to A') >= 1 && any(SHARED, 'post to B') >= 1, 'CONTROL: posts did not reach their own box + shared');
    assert.equal(any(TA, 'post to B'), 0, 'B\'s queued post went to A\'s box');
    assert.equal(any(TB, 'post to A'), 0, 'A\'s queued post went to B\'s box');
    assert.ok(landedAt(TA, tom.pub, from) >= 1, 'CONTROL: DM to tom missed TA');
    assert.equal(landedAt(TB, tom.pub, from), 0, 'DM to tom (A only) went to B\'s box');
    assert.ok(landedAt(TB, B.pub, from) >= 1, 'CONTROL: DM to B missed TB');
    assert.equal(landedAt(TA, B.pub, from), 0, 'DM to church B went to A\'s box');
  } finally { goOnline(SHARED, TA, TB); app.close(); }
});

// ── 5. LEAVE while offline ─────────────────────────────────────────────────────────────────────────────
test('5a. Leave tapped with no network is QUEUED: the church stays (marked leaving) and the tombstone is delivered on reconnect', async () => {
  forgotten.length = 0;
  const app = await phoneA();
  try {
    await goOffline(SHARED, TA);
    const r = await app.leaveMembership(A.npub);
    assert.equal(r.ok, false, 'offline leave claimed success: ' + JSON.stringify(r));
    assert.equal(r.queued, true, 'an offline Leave was not reported as queued: ' + JSON.stringify(r));
    assert.equal(r.evt, undefined, 'a queued Leave hands back its event, so a caller can read it as sent');
    assert.equal(app.outbox().filter(o => o.leave === A.pub).length, 1, 'the Leave is not in the queue');
    assert.equal(app.leaving(A.pub), true, 'the phone does not know it is leaving A');
    assert.equal(forgotten.includes(A.pub), false, 'the church was forgotten before the Leave was delivered (its boxes go with it)');
    goOnline(SHARED, TA);
    const from = EVTS.length;
    await app._outboxFlush(); await sleep(1500);
    const tombAt = (relay) => EVTS.slice(from).filter(x => x.url === relay.wsUrl && x.ev && x.ev.pubkey === sarah.pub && JSON.stringify(x.ev.tags).includes('"deleted"')).length;
    assert.ok(tombAt(SHARED) >= 1, 'after reconnect the leave never reached the shared server');
    assert.ok(tombAt(TA) >= 1, 'after reconnect the leave never reached the church\'s own box');
    assert.equal(app.outbox().filter(o => o.leave).length, 0, 'the delivered Leave is still queued');
    assert.ok(forgotten.includes(A.pub), 'the church was not dropped from the phone once its Leave was delivered');
    assert.equal(app.leaving(A.pub), true, 'the leaving mark went with the queue entry; an in-flight announce could still re-join');
  } finally { goOnline(SHARED, TA); app.close(); }
});

test('5b. a queued JOIN for A does not survive a Leave: it is removed, and the next flush does not re-join', async () => {
  const joinEvt = finalizeEvent({ kind: 30078, created_at: now() - 60, tags: [['d', 'trinityone/member:' + A.pub], ['t', 'trinityone'], ['church', A.pub]], content: '{}' }, sarah.sk);
  const app = await phoneA({ outbox: [{ evt: joinEvt, groupId: null, join: A.pub, at: now() - 60, tries: 0, relays: [] }] });
  try {
    assert.equal(app.outbox().filter(o => o.join === A.pub).length, 1, 'CONTROL: the join is queued before the Leave');
    const r = await app.leaveMembership(A.npub);                     // online: leave succeeds
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(app.outbox().filter(o => o.join === A.pub).length, 0, 'the queued join survived the Leave');
    assert.ok(forgotten.includes(A.pub), 'CONTROL: church forgotten locally');
    const from = EVTS.length;
    await app._outboxFlush(); await sleep(800);
    const rejoin = EVTS.slice(from).filter(x => x.ev && x.ev.id === joinEvt.id).length;
    assert.equal(rejoin, 0, 'the stale queued join was re-sent AFTER the member left (copies on the wire: ' + rejoin + ')');
  } finally { app.close(); }
});

test('5c. group posts queued for A before Leave are sent FIRST, then the tombstone (owner 2026-10-27)', async () => {
  const app = await phoneA();
  try {
    await goOffline(SHARED, TA);
    const from = EVTS.length;
    const evt = await app.publishMessage('g1', 'said before leaving');
    assert.equal(evt._delivered, false, 'CONTROL: the post was not queued');
    goOnline(SHARED, TA);
    const r = await app.leaveMembership(A.npub);
    assert.equal(r.ok, true, JSON.stringify(r));
    await sleep(800);
    for (const relay of [SHARED, TA]) {
      const at = EVTS.slice(from).map(x => (x.url === relay.wsUrl ? x : null));
      const post = at.findIndex(x => x && x.ev && x.ev.kind === 1 && x.ev.content === 'said before leaving');
      const tomb = at.findIndex(x => x && x.ev && x.ev.pubkey === sarah.pub && JSON.stringify(x.ev.tags).includes('"deleted"'));
      assert.ok(post >= 0, relay.name + ': what the member said before leaving was never delivered');
      assert.ok(tomb >= 0, relay.name + ': the tombstone was never delivered');
      assert.ok(post < tomb, relay.name + ': the tombstone went BEFORE what the member said before leaving');
    }
    assert.equal(app.outbox().length, 0, 'something is still queued: ' + JSON.stringify(app.outbox().map(o => o.leave ? 'leave' : o.groupId)));
  } finally { goOnline(SHARED, TA); app.close(); }
});

test('5d. while a Leave waits for signal, nothing new is posted to that church (refused, words handed back)', async () => {
  const app = await phoneA();
  try {
    await goOffline(SHARED, TA);
    const r = await app.leaveMembership(A.npub);
    assert.equal(r.queued, true, 'CONTROL: the offline Leave is not queued: ' + JSON.stringify(r));
    const n = app.outbox().length;
    const evt = await app.publishMessage('g1', 'written while leaving');
    assert.equal(evt && evt._refused, 'leaving', 'a post to a church being left was not refused: ' + JSON.stringify(evt && Object.keys(evt)));
    assert.equal(app.outbox().length, n, 'the refused post was queued anyway');
  } finally { goOnline(SHARED, TA); app.close(); }
});

// ── 6. persistence and growth ──────────────────────────────────────────────────────────────────────────
test('6a. the queue survives an app restart (same storage, fresh bundle instance) and flushes', async () => {
  const app = await phoneA();
  let app2;
  try {
    await goOffline(SHARED, TA);
    const from = EVTS.length;
    await app.publishMessage('g1', 'survives restart');
    const before = app.outbox().length;
    assert.ok(before >= 1);
    const saved = app.store.getItem('trinityone.outbox');
    app.close();
    app2 = phone({
      who: sarah, relays: [secure(SHARED.wsUrl), secure(TA.wsUrl)], canonical: [secure(SHARED.wsUrl)], pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] },
      activeChurch: A.pub, followed: [A], netdoc: { [A.pub]: { hw: 1, rows: { [secure(TA.wsUrl)]: TA.relayPub } } }, roster: { [A.pub]: [tom.pub, sarah.pub] }, outbox: JSON.parse(saved),
    });
    app2.saveBoxes(A.pub, [secure(TA.wsUrl)]);
    await app2.gate.refresh(app2.churchRelaysRaw(), A.pub);
    assert.equal(app2.outbox().length, before, 'restart lost queue entries');
    goOnline(SHARED, TA);
    await app2._outboxFlush(); await sleep(600);
    assert.ok(grpLanded(TA, 'survives restart', from) >= 1 && grpLanded(SHARED, 'survives restart', from) >= 1, 'restored item did not deliver');
    assert.equal(app2.outbox().length, 0);
  } finally { goOnline(SHARED, TA); app.close(); if (app2) app2.close(); }
});

test('6b. a box that never comes back: the queue is bounded by refusing the NEW message, and nothing queued is dropped', async () => {
  const app = await phoneA();
  try {
    await goOffline(SHARED, TA);
    const refused = [];
    for (let i = 0; i < 205; i++) { const e = await app.publishMessage('g1', 'bulk ' + i); if (e && e._refused) refused.push([i, e._refused]); }
    assert.deepEqual(refused.map(r => r[1]), ['queue-full', 'queue-full', 'queue-full', 'queue-full', 'queue-full'],
      'past 200 the NEW message must be refused (so the composer keeps the words): ' + JSON.stringify(refused));
    assert.deepEqual(refused.map(r => r[0]), [200, 201, 202, 203, 204], 'the wrong messages were refused');
    const persisted = JSON.parse(app.store.getItem('trinityone.outbox') || '[]');
    const failed = JSON.parse(app.store.getItem('trinityone.outbox.failed') || app.store.getItem('trinityone.outboxFailed') || '[]');
    assert.ok(persisted.length <= 200, 'queue not bounded: ' + persisted.length);                  // bounded (control)
    const lostOldest = !persisted.some(o => o.evt.content === 'bulk 0');
    assert.ok(!lostOldest || failed.some(o => o.evt && o.evt.content === 'bulk 0'), 'oldest queued message "bulk 0" vanished from the persisted queue and is not in the failed bin (persisted=' + persisted.length + ', failed=' + failed.length + ')');
    assert.equal(persisted.length, 200, 'every accepted message must be on disk');
    assert.equal(app.outbox().length, 200, 'the in-memory queue grew past its bound');
  } finally { goOnline(SHARED, TA); app.close(); }
}, { timeout: 180000 });

// ── 7. the church's box is not proved yet when the queue flushes ───────────────────────────────────────
test('7. a queued post is HELD while the church\'s own box is unproved, then reaches it once proved (not the shared server alone)', async () => {
  const app = phone({
    who: sarah, relays: [secure(SHARED.wsUrl)], canonical: [secure(SHARED.wsUrl)], pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] },
    activeChurch: A.pub, followed: [A], netdoc: { [A.pub]: { hw: 1, rows: { [secure(TA.wsUrl)]: TA.relayPub } } }, roster: { [A.pub]: [tom.pub, sarah.pub] },
  });
  try {
    FETCH_DOWN.add(hostOf(TA.wsUrl));            // its proof cannot be fetched yet (cold start: not reachable over HTTP)
    app.saveBoxes(A.pub, [secure(TA.wsUrl)]);   // the church's box is known (persisted) but is not a candidate yet: unproved
    await app.gate.refresh(app.churchRelaysRaw(), A.pub);
    assert.ok(!app.publishSetFor(A.pub).includes(secure(TA.wsUrl)), 'staging: TA is already proved, so the hold cannot be seen');
    await goOffline(SHARED, TA);
    const from = EVTS.length;
    const evt = await app.publishMessage('g1', 'queued before the box was proved');
    assert.equal(evt._delivered, false, 'CONTROL: not queued');
    goOnline(SHARED, TA);
    await app._outboxFlush(); await sleep(600);
    assert.equal(grpLanded(SHARED, 'queued before the box was proved', from), 0, 'the post went to the shared server alone while the church\'s box was unproved');
    assert.equal(app.outbox().length, 1, 'the held post left the queue');
    assert.equal(app.outbox()[0].tries || 0, 0, 'a hold burned a try');
    FETCH_DOWN.delete(hostOf(TA.wsUrl));
    app.win.Fellowship.relays = [secure(SHARED.wsUrl), secure(TA.wsUrl)];   // the church's box arrives as a candidate
    await app._outboxFlush(); await sleep(600);
    assert.ok(grpLanded(TA, 'queued before the box was proved', from) >= 1, 'the church\'s box never got the held post once it was proved');
    assert.ok(grpLanded(SHARED, 'queued before the box was proved', from) >= 1, 'CONTROL: the shared server never got it');
    assert.equal(app.outbox().length, 0);
  } finally { FETCH_DOWN.clear(); goOnline(SHARED, TA); app.close(); }
});
