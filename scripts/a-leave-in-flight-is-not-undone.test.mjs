// A LEAVE IN FLIGHT IS NOT UNDONE. G2 (fix/stress-g2, 2026-10-27): the parked note "leave can be undone by a racing
// join" — every announce path on the phone, a Leave tapped while one is in flight, and a Leave queued with no signal.
// Drives the SHIPPED vendor/fellowship.js (announceMembership, leaveMembership, clearLeaving, _outboxFlush and the
// bundle's own re-send paths) against real gateway relays, and lifts the app.jsx callers (the heartbeat, leaveChurch,
// the `trinity-left` listener, followChurch) out of the shipped file and RUNS them (CLAUDE.md rules 1 and 3).
// Harness copied from a-phone-offline-while-the-church-changes-its-boxes.test.mjs (stress batch 3).
//
// Announce paths and where each is covered here: followChurch (RE-FOLLOW x2), heartbeat beat() (HEARTBEAT),
// retryConnection (NOT driven here — it calls the same announceMembership, so it meets the same guard; its own
// screen is not lifted), _resendMembershipToNewBoxes (PATH 6), _resendJoinToBoxesGainedInFlight (PATH 7), the
// admitted-doc recovery (NOT driven here: it lives inside the docs hub's event handler; it calls the same guarded
// announceMembership), _consumeJoinIntents (PATH 9), and _outboxFlush re-sending a queued join (PATH 10).
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
const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');
const RELAY_NET_D = 'trinityone/relay-net';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const secure = (u) => String(u || '').replace(/^ws:\/\//i, 'wss://').replace(/^http:\/\//i, 'https://');
const wire = (u) => String(u || '').replace(/^wss:\/\/(127\.0\.0\.1[:/])/i, 'ws://$1').replace(/^https:\/\/(127\.0\.0\.1[:/])/i, 'http://$1');
const netFetch = (u, o) => globalThis.fetch(wire(typeof u === 'string' ? u : String(u)), o);

// ── the wire recorder: every REQ frame, against the address it was sent to ──────────────────────────────
const PUBLOG = []; const REQS = []; const EVTS = []; let ACK_HOLD = null;   // { url, filters } / { url, ev }
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
    // ACK_HOLD: while set, the ACKS of a publish made now are held until it resolves (the event itself goes on the
    // wire at once). The RACE test uses it to land a Leave between a join reaching the relay and its ack arriving.
    publish: (urls, e) => { PUBLOG.push({ at: Date.now(), urls: list(urls), id: e.id }); const ps = p.publish(list(urls), e); const hold = ACK_HOLD; return hold ? ps.map(pr => pr.then(async (v) => { await hold; return v; }, async (x) => { await hold; throw x; })) : ps; },
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
    // ── the membership state the leave race is about: all SHIPPED, none stubbed ──
    'const _lastStampF = new Map();',
    fnBody(src, 'function _monotonicF(', '_monotonicF'),
    stmt(src, 'var _memberResent = ', '_memberResent'),
    stmt(src, 'var _leaveGen = ', '_leaveGen'),
    stmt(src, 'var JOINSENT_KEY = ', 'JOINSENT_KEY'),
    'let _joinSent = {};',
    fnBody(src, 'function _joinSentSave', '_joinSentSave'),
    fnBody(src, 'function _markJoinSent', '_markJoinSent'),
    fnBody(src, 'function _clearJoinSent', '_clearJoinSent'),
    fnBody(src, 'function _joinSentFor', '_joinSentFor'),
    stmt(src, 'var JOININTENT_KEY = ', 'JOININTENT_KEY'),
    'let _joinIntents = [];',
    fnBody(src, 'function _joinIntentSave', '_joinIntentSave'),
    fnBody(src, 'function _lockedPubHex', '_lockedPubHex'),
    fnBody(src, 'function _queueJoinIntent', '_queueJoinIntent'),
    fnBody(src, 'function _dropJoinIntent', '_dropJoinIntent'),
    fnBody(src, 'function _consumeJoinIntents', '_consumeJoinIntents'),
    fnBody(src, 'async function _resendMembershipToNewBoxes', '_resendMembershipToNewBoxes'),
    fnBody(src, 'function _resendJoinToBoxesGainedInFlight', '_resendJoinToBoxesGainedInFlight'),
    // ── the profile writer, for the queued-profile test (G2 2.5) ──
    fnBody(src, 'function profilePublishRelays', 'profilePublishRelays'),
    'let _profilePubFor = null, _profilePubBody = null;',
    'const profiles = {}; const pendingProfiles = new Set(); const _profQueue = new Set(); let _profTimer = null; const _k0Seen = new Set();',
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
    fnBody(src, 'async announceMembership(npubOrHex) {', 'announceMembership'),
    fnBody(src, 'clearLeaving(npubOrHex) {', 'clearLeaving'),
    fnBody(src, 'leaveQueued(npubOrHex) {', 'leaveQueued'),
    fnBody(src, 'async setProfile(meta) {', 'setProfile'),
    fnBody(src, 'subscribeThread(peerPub, onMsg) {', 'subscribeThread'),
    fnBody(src, 'subscribeDMs(onConvos) {', 'subscribeDMs'),
  ].join(',\n');
  const scope = scopeOf({
    localStorage: store, window: win, pool, console, fetch: netFetch,
    CANONICAL_RELAYS: canonical, CANONICAL_RELAY_PUBS: pins, DEFAULT_RELAYS: canonical,
    _native: false, _staticHost: false, _loc: null,
    normalizeURL, verifyEvent, finalizeEvent, CustomEvent: Ev,
    decode: nip19decode, nip19decode, performance, normalizeURL2: normalizeURL,
    _noteSendResult: () => {}, _forgetChurch: (cp) => { forgotten.push(cp); }, _checkIfBlocked: () => {}, _mayCache: () => true, NET: 'trinityone', _docsHubs: new Map(), _docsHubOpen: () => {},
    _notePhotoPolicy: () => {}, _recoverOwnProfile: () => {}, _churchPhotosOff: () => false, _myPhotoReset: () => false, _stripPhoto: (p, av) => av, PROFILE_KEY: 'trinityone.profile', saveProfiles: () => {}, setTimeout,
    _dmEncrypt: (sk, peer, body) => body, _dmDecrypt: async (sk, peer, c) => c,
    sk: me.sk, pub: me.pub,
  });
  void 0;
  const api = new Function('scope', `with (scope) { ${body}
    const _api = { ${methods} };
    return { publishMessage: (g, c) => _api.publishMessage(g, c), leaveMembership: (c) => _api.leaveMembership(c), saveBoxes: _saveChurchBoxes, sendDM: (p, c) => _api.sendDM(p, c), reactDM: (p, i, e) => _api.reactDM(p, i, e),
             subscribeThread: (p, f) => _api.subscribeThread(p, f), subscribeDMs: (f) => _api.subscribeDMs(f),
             relaysForChurch, publishSetFor, memberChurchPubs, dmSendRelays, dmReadRelays, _outboxRelays, _outboxFlush,
             outbox: () => _outbox, failed: () => _outboxFailed, leaving: (c) => _leavingFor(c), gate: _gate, churchRelaysRaw,
             announceMembership: (c) => _api.announceMembership(c), clearLeaving: (c) => _api.clearLeaving(c), leaveQueued: (c) => _api.leaveQueued(c),
             joinSentFor: _joinSentFor, markJoinSent: _markJoinSent, leaveGen: () => _leaveGen, setIntents: (a) => { _joinIntents = a; },
             setProfile: (m) => { _k0Seen.add(pub); return _api.setProfile(m); },
             consumeJoinIntents: _consumeJoinIntents, resendNew: _resendMembershipToNewBoxes, resendGained: _resendJoinToBoxesGainedInFlight, toPub }; }`)(scope);
  win.Fellowship.announceMembership = api.announceMembership;
  win.Fellowship.leaveMembership = api.leaveMembership;
  win.Fellowship.clearLeaving = api.clearLeaving;
  win.Fellowship.leaveQueued = api.leaveQueued;
  win.Fellowship.toPub = api.toPub;
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

// ════════ what these tests read off the wire ══════════════════════════════════════════════════════════════
const isMemberDoc = (x) => x.ev && x.ev.kind === 30078 && x.ev.pubkey === sarah.pub && JSON.stringify(x.ev.tags).includes('trinityone/member:' + A.pub);
const joinsFrom = (from) => EVTS.slice(from).filter(x => isMemberDoc(x) && !JSON.stringify(x.ev.tags).includes('"deleted"'));
const tombsFrom = (from) => EVTS.slice(from).filter(x => isMemberDoc(x) && JSON.stringify(x.ev.tags).includes('"deleted"'));
const q = (relay, filter) => new Promise((resolve) => {
  const p = new SimplePool(); p.automaticallyAuth = () => async (a) => finalizeEvent(a, sarah.sk);
  p.querySync([relay.wsUrl], filter, { maxWait: 2500 }).then(r => { try { p.close([relay.wsUrl]); } catch (e) {} resolve(r); }, () => resolve([]));
});
// What the church's relay HOLDS for this member's membership document, after everything settled.
async function heldAt(relay) {
  const r = await q(relay, { kinds: [30078], authors: [sarah.pub], '#d': ['trinityone/member:' + A.pub] });
  const top = r.sort((a, b) => b.created_at - a.created_at)[0];
  return top ? (top.tags.some(t => t[0] === 'deleted') ? 'left' : 'member') : 'none';
}

// ════════ the ENGINE half: announceMembership, its callers inside the bundle, and the outbox ═══════════════
test('RACE: a join whose ACK arrives after Leave was tapped neither re-joins the member nor marks the join "sent"', async () => {
  const app = await phoneA();
  try {
    // Warm the sockets so the join goes on the wire at once and only its ACK is what waits.
    await app.publishMessage('g1', 'warm-up'); await sleep(300);
    const from = EVTS.length;
    let release; ACK_HOLD = new Promise(r => { release = r; });
    const a = app.announceMembership(A.pub);   // the join is published now; its acks are held
    ACK_HOLD = null;
    await sleep(800);                           // the join reaches the relays and is stored
    assert.ok(joinsFrom(from).length >= 1, 'staging: the join never went on the wire, so there is no race to see');
    const rl = await app.leaveMembership(A.npub);   // Leave tapped while the join's ack is still in flight
    release();                                      // …and only now does the join's ack arrive
    const ra = await a;
    await sleep(500);
    assert.equal(rl.ok, true, 'CONTROL: the online Leave did not land: ' + JSON.stringify(rl));
    assert.equal(app.joinSentFor(A.pub), false, 'the late ack of the racing join marked it "sent" AFTER the Leave (the stale-flag variant)');
    assert.equal(ra, null, 'the racing announce reported a landed join after the member left');
    const j = joinsFrom(from), t = tombsFrom(from);
    assert.ok(t.length >= 1, 'CONTROL: no tombstone on the wire');
    for (const x of j) assert.ok(x.ev.created_at < t[0].ev.created_at, 'a join was signed NEWER than the tombstone');
    assert.equal(await heldAt(SHARED), 'left', 'the shared server still holds the member as joined');
    assert.equal(await heldAt(TA), 'left', 'the church\'s box still holds the member as joined');
  } finally { ACK_HOLD = null; app.close(); }
});

test('GUARD: while a Leave waits for signal, and after it lands, no announce goes out; an explicit re-follow (clearLeaving) lets one through', async () => {
  const app = await phoneA();
  try {
    await goOffline(SHARED, TA);
    const r = await app.leaveMembership(A.npub);
    assert.equal(r.queued, true, 'CONTROL: the offline Leave is not queued');
    const from = EVTS.length;
    assert.equal(await app.announceMembership(A.pub), null, 'an announce was accepted while the Leave was queued');
    assert.equal(app.outbox().filter(o => o.join).length, 0, 'an announce queued a join while the Leave was queued');
    goOnline(SHARED, TA);
    await app._outboxFlush(); await sleep(800);
    assert.ok(tombsFrom(from).length >= 1, 'CONTROL: the queued tombstone was never delivered');
    assert.equal(await app.announceMembership(A.pub), null, 'an announce after the delivered Leave re-joined the member');
    await sleep(500);
    assert.equal(joinsFrom(from).length, 0, 'a join reached the wire while leaving / after leaving');
    // CONTROL: the member chooses to come back
    assert.equal(app.clearLeaving(A.npub), true, 'clearLeaving did not see the leave');
    const back = await app.announceMembership(A.pub);
    assert.ok(back && back.kind === 30078, 'an explicit re-follow could not re-join: ' + JSON.stringify(back));
    await sleep(500);
    assert.equal(await heldAt(SHARED), 'member', 'the re-follow did not land');
  } finally { goOnline(SHARED, TA); app.close(); }
});

test('PATH 10: the outbox never re-sends a queued join for a church the member is leaving', async () => {
  const app = await phoneA();
  try {
    await goOffline(SHARED, TA);
    const r = await app.leaveMembership(A.npub);
    assert.equal(r.queued, true, 'CONTROL: the offline Leave is not queued');
    // A join that reaches the queue AFTER the Leave without passing announceMembership — what requeue() of a
    // failed join, or a queue written by an older build, puts there.
    const stale = finalizeEvent({ kind: 30078, created_at: now() - 30, tags: [['d', 'trinityone/member:' + A.pub], ['t', 'trinityone'], ['p', A.pub]], content: '{}' }, sarah.sk);
    app.outbox().push({ evt: stale, groupId: null, join: A.pub, at: now(), tries: 0, relays: [] });
    goOnline(SHARED, TA);
    const from = EVTS.length;
    await app._outboxFlush(); await sleep(800);
    assert.equal(EVTS.slice(from).filter(x => x.ev && x.ev.id === stale.id).length, 0, 'the flush re-sent a join for a church being left');
    assert.equal(app.outbox().filter(o => o.join).length, 0, 'the stale join is still queued');
    assert.ok(tombsFrom(from).length >= 1, 'CONTROL: the tombstone was not delivered');
  } finally { goOnline(SHARED, TA); app.close(); }
});

test('PATH 6: _resendMembershipToNewBoxes, holding a stale "sent" flag, does not re-join a member who is leaving', async () => {
  const app = await phoneA({ relays: [TA] });
  try {
    await goOffline(SHARED, TA);
    const r = await app.leaveMembership(A.npub);
    assert.equal(r.queued, true, 'CONTROL: the offline Leave is not queued');
    goOnline(SHARED, TA);
    // A "sent" flag that outlived the Leave (the variant the note names) — so the resend's own check passes and
    // the only thing between it and a re-join is the leaving guard.
    app.markJoinSent(A.pub, { id: 'x', created_at: now(), pubkey: sarah.pub });
    assert.equal(app.joinSentFor(A.pub), true, 'staging: the stale flag did not take');
    const from = EVTS.length;
    await app.resendNew(A.pub, []);   // "before" = nothing, so every box counts as gained
    await sleep(800);
    assert.equal(joinsFrom(from).length, 0, 'the box-adoption resend re-joined a member who is leaving');
  } finally { goOnline(SHARED, TA); app.close(); }
});

test('PATH 7: _resendJoinToBoxesGainedInFlight, holding a stale "sent" flag, does not re-join a member who is leaving', async () => {
  const app = await phoneA({ relays: [TA] });
  try {
    await goOffline(SHARED, TA);
    const r = await app.leaveMembership(A.npub);
    assert.equal(r.queued, true, 'CONTROL: the offline Leave is not queued');
    goOnline(SHARED, TA);
    app.markJoinSent(A.pub, { id: 'x', created_at: now(), pubkey: sarah.pub });
    const from = EVTS.length;
    app.resendGained(A.pub, [], app.leaveGen()[A.pub] || 0);   // the CURRENT generation, so its own gen check passes
    await sleep(1500);
    assert.equal(joinsFrom(from).length, 0, 'the in-flight resend re-joined a member who is leaving');
  } finally { goOnline(SHARED, TA); app.close(); }
});

test('PATH 9: a join intent consumed while the member is leaving does not re-join them', async () => {
  const app = await phoneA();
  try {
    await goOffline(SHARED, TA);
    const r = await app.leaveMembership(A.npub);
    assert.equal(r.queued, true, 'CONTROL: the offline Leave is not queued');
    goOnline(SHARED, TA);
    app.setIntents([{ cp: A.pub, forPub: sarah.pub, at: now() }]);
    const from = EVTS.length;
    app.consumeJoinIntents();
    await sleep(1500);
    assert.equal(joinsFrom(from).length, 0, 'a consumed join intent re-joined a member who is leaving');
  } finally { goOnline(SHARED, TA); app.close(); }
});

// ════════ the SCREEN half: the app.jsx functions, lifted out of the shipped file and RUN (rules 1 + 3) ═══════
function appScope(app, extra) {
  const state = { churches: [{ id: A.npub, npub: A.npub, name: 'A' }], active: A.npub, toasts: [] };
  const t = {
    get churches() { return state.churches; }, churchesStored: state.churches,
    get activeChurch() { return state.active; },
    setChurches: (v) => { state.churches = typeof v === 'function' ? v(state.churches) : v; },
    setActiveChurch: (v) => { state.active = typeof v === 'function' ? v(state.active) : v; },
    lsSet: () => {}, lsGet: () => null, lsCanWrite: () => true, localStorage: app.store,
    toast: (m) => state.toasts.push(String(m)),
    unconfirmedChurches: { current: new Set() }, leavingNow: { current: new Set() }, bumpLeave: () => {},
    _mergeChurchProfile: (cs) => cs,
    window: app.win, React: { useRef: (v) => ({ current: v }) },
    String, JSON, Date, Math, Number, Array, Object, Boolean, console, Promise, setTimeout, clearTimeout, Set, Map, URLSearchParams,
    ...(extra || {}),
  };
  const proxy = new Proxy(t, {
    has: (o, k) => (k in o) || !(String(k) in globalThis),
    get: (o, k) => { if (k === Symbol.unscopables) return undefined; if (k in o) return o[k];
      throw new ReferenceError('the shipped app code needs a stub for ' + String(k)); },
    set: (o, k, v) => { o[k] = v; return true; },
  });
  return { proxy, state };
}
// A lifted `const name = (…) => {…}` is a declaration; take the expression after its `=`.
const liftApp = (proxy, code) => new Function('scope', 'with (scope) { return (' + code.replace(/^const\s+\w+\s*=\s*/, '') + '); }')(proxy);
const arrowAfter = (marker, what) => { const i = APP.indexOf(marker); assert.notEqual(i, -1, what + ': marker gone, re-anchor'); return fnBody(APP, APP.indexOf('() => {', i), what); };

test('HEARTBEAT (app.jsx beat): the launch heartbeat does not re-join a member whose Leave is waiting', async () => {
  const app = await phoneA();
  try {
    const beatEffect = arrowAfter('// membership heartbeat: refresh the member event on launch', 'heartbeat effect');
    // CONTROL FIRST: with no Leave, the shipped heartbeat does announce (or this test proves nothing).
    { const s = appScope(app); const from = EVTS.length; liftApp(s.proxy, beatEffect)(); await sleep(1500);
      assert.ok(joinsFrom(from).length >= 1, 'CONTROL: the lifted heartbeat sent nothing even with no Leave — re-anchor'); }
    app.store.removeItem('trinityone.hb:' + A.npub);
    await goOffline(SHARED, TA);
    const r = await app.leaveMembership(A.npub);
    assert.equal(r.queued, true, 'CONTROL: the offline Leave is not queued');
    goOnline(SHARED, TA);
    const s = appScope(app); const from = EVTS.length;
    liftApp(s.proxy, beatEffect)(); await sleep(1500);
    assert.equal(joinsFrom(from).length, 0, 'the launch heartbeat re-joined a member whose Leave was waiting for signal');
    assert.equal(app.store.getItem('trinityone.hb:' + A.npub), null, 'the heartbeat stamped "done" over an announce that was refused');
  } finally { goOnline(SHARED, TA); app.close(); }
});

test('LEAVE SCREEN (app.jsx leaveChurch): an offline Leave says "Leaving…", keeps the church, and is not "still a member"', async () => {
  const app = await phoneA();
  try {
    await goOffline(SHARED, TA);
    const s = appScope(app);
    const leaveChurch = liftApp(s.proxy, fnBody(APP, 'const leaveChurch = async (npub) =>', 'leaveChurch'));
    const out = await leaveChurch(A.npub);
    assert.equal(out, 'queued', 'leaveChurch did not report the queued result: ' + JSON.stringify(out) + ' toasts=' + JSON.stringify(s.state.toasts));
    assert.equal(s.state.toasts.length, 1, JSON.stringify(s.state.toasts));
    assert.match(s.state.toasts[0], /Leaving/, 'the member was not told the Leave is waiting: ' + s.state.toasts[0]);
    assert.doesNotMatch(s.state.toasts[0], /still a member|left the church/i, 'a queued Leave was reported as failed or as done: ' + s.state.toasts[0]);
    assert.equal(s.state.churches.length, 1, 'the church left the phone before its Leave was delivered');
    assert.equal(app.leaveQueued(A.npub), true, 'the "Leaving…" row has nothing to read');
  } finally { goOnline(SHARED, TA); app.close(); }
});

test('DELIVERED LATER (app.jsx trinity-left listener): when the queued Leave lands, the church goes from the phone and they are told', async () => {
  const app = await phoneA();
  let off = () => {};
  try {
    await goOffline(SHARED, TA);
    const r = await app.leaveMembership(A.npub);
    assert.equal(r.queued, true, 'CONTROL: the offline Leave is not queued');
    const s = appScope(app);
    app.win.Fellowship.onOutbox = () => () => {};
    off = liftApp(s.proxy, arrowAfter('// A QUEUED LEAVE, DELIVERED LATER', 'left listener'))() || off;
    goOnline(SHARED, TA);
    await app._outboxFlush(); await sleep(800);
    assert.deepEqual(s.state.churches.map(c => c.id), [], 'the church stayed on the phone after its Leave was delivered');
    assert.ok(s.state.toasts.some(t => /left the church/i.test(t)), 'nothing told them the Leave finished: ' + JSON.stringify(s.state.toasts));
    assert.notEqual(s.state.active, A.npub, 'the left church is still the active one');
  } finally { try { off(); } catch (e) {} goOnline(SHARED, TA); app.close(); }
});

test('RE-FOLLOW (app.jsx followChurch): following again after leaving clears the leave and re-joins (control for the guard)', async () => {
  const app = await phoneA();
  try {
    const r = await app.leaveMembership(A.npub);   // online: delivered, so the delivered-this-launch mark is set
    assert.equal(r.ok, true, 'CONTROL: the Leave did not land');
    assert.equal(await app.announceMembership(A.pub), null, 'CONTROL: the guard does not hold after a delivered Leave');
    Object.assign(app.win.Fellowship, {
      CANONICAL_RELAYS: [], addRelay: () => {}, adoptInviteRelays: () => null,
      checkChurch: async () => 'church', subscribeChurchProfile: () => () => {}, subscribeChurchRelays: () => () => {},
    });
    const s = appScope(app);
    s.state.churches = [];   // it left the phone with the delivered Leave
    const followChurch = liftApp(s.proxy, fnBody(APP, 'const followChurch = (raw, opts) =>', 'followChurch'));
    const from = EVTS.length;
    followChurch(A.npub);
    await sleep(2000);
    assert.ok(joinsFrom(from).length >= 1, 'following the church again did not re-join: the leave mark was never cleared by the follow');
    assert.equal(await heldAt(SHARED), 'member', 'the re-join did not land');
  } finally { app.close(); }
});

test('RE-FOLLOW while the Leave is still waiting: the queued tombstone is withdrawn and they stay a member', async () => {
  const app = await phoneA();
  try {
    await goOffline(SHARED, TA);
    const r = await app.leaveMembership(A.npub);
    assert.equal(r.queued, true, 'CONTROL: the offline Leave is not queued');
    Object.assign(app.win.Fellowship, {
      CANONICAL_RELAYS: [], addRelay: () => {}, adoptInviteRelays: () => null,
      checkChurch: async () => 'church', subscribeChurchProfile: () => () => {}, subscribeChurchRelays: () => () => {},
    });
    const s = appScope(app);   // the church is still listed — the Leave never went
    const followChurch = liftApp(s.proxy, fnBody(APP, 'const followChurch = (raw, opts) =>', 'followChurch'));
    followChurch(A.npub);
    assert.equal(app.leaveQueued(A.npub), false, 'the queued tombstone survived the re-follow');
    goOnline(SHARED, TA);
    const from = EVTS.length;
    await sleep(300);
    await app._outboxFlush(); await sleep(1200);
    assert.equal(tombsFrom(from).length, 0, 'the withdrawn Leave was still delivered');
    assert.ok(joinsFrom(from).length >= 1, 'the re-follow did not announce');
  } finally { goOnline(SHARED, TA); app.close(); }
});

// ════════ G2 2.5: a profile edit with no signal is QUEUED, and the newest one is what arrives ═══════════════
test('PROFILE: an edit made with no signal is queued (not "saved"), a newer edit replaces it, and the flush delivers the newest to the church\'s boxes', async () => {
  const app = await phoneA();
  try {
    await goOffline(SHARED, TA);
    const first = await app.setProfile({ about: 'first offline edit' });
    assert.ok(first && first.queued === true, 'an offline profile edit was not reported as queued: ' + JSON.stringify(first && Object.keys(first)));
    const second = await app.setProfile({ about: 'second offline edit' });
    assert.ok(second && second.queued === true, 'CONTROL: the second edit was not queued');
    const q0 = app.outbox().filter(o => o.profile);
    assert.equal(q0.length, 1, 'a newer queued profile edit did not replace the older one (' + q0.length + ' queued)');
    assert.equal(q0[0].evt.id, second.evt.id, 'the queue kept the OLDER edit');
    goOnline(SHARED, TA);
    const from = EVTS.length;
    await app._outboxFlush(); await sleep(800);
    const k0 = (relay, id) => EVTS.slice(from).filter(x => x.url === relay.wsUrl && x.ev && x.ev.id === id).length;
    assert.ok(k0(SHARED, second.evt.id) >= 1, 'the queued profile never reached the shared server');
    assert.ok(k0(TA, second.evt.id) >= 1, 'the queued profile never reached the church\'s own box');
    assert.equal(k0(SHARED, first.evt.id) + k0(TA, first.evt.id), 0, 'the superseded edit was sent');
    assert.equal(app.outbox().filter(o => o.profile).length, 0, 'the delivered profile is still queued');
  } finally { goOnline(SHARED, TA); app.close(); }
});
