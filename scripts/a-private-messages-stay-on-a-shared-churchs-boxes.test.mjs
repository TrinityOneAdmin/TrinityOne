// A PRIVATE MESSAGE GOES TO THE SHARED SERVERS AND THE OWN BOX OF A CHURCH BOTH PEOPLE BELONG TO - NEVER A BOX OF A
// CHURCH ONLY ONE OF THEM IS IN. Owner rule 2026-10-26 (TrinityOne-internal/reference/DOMAIN.md, "personal
// traffic"), step 2c. Run: node --test scripts/a-private-messages-stay-on-a-shared-churchs-boxes.test.mjs
//
// THE MEASURED DEFECT. A DM to church B's account was stored on church A's box (kind 4, sender and recipient
// visible): sendDM, its outbox entry, the outbox flush fallback and reactDM all used the whole candidate list.
//
// HOW IT IS DRIVEN. Real `node scripts/gateway.mjs` relays: SHARED, TA (church A's box), TB (church B's box). Sarah is in
// A and B; Tom only in A. The shipped gate, relaysForChurch, publishSetFor, memberChurchPubs, _memHub (Tom's
// membership comes from the on-device member roster the app already holds), dmSendRelays, dmReadRelays,
// _outboxRelays, _outboxFlush, sendDM, reactDM, subscribeThread and subscribeDMs are lifted from vendor/fellowship.js
// and RUN. The wire is observed (WebSocket wrapped): every EVENT and REQ frame is recorded against its box. TB is
// staged ADMITTED for church A, so an unscoped send would really leak. Only encryption is stubbed (not the subject).
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
    // fix/stress-g2: sendDM refuses a NEW message when the queue is full; the flush and _outboxRelays ask which
    // church an item belongs to (a DM: none). Both SHIPPED.
    fnBody(src, 'function _outboxFull', '_outboxFull'),
    fnBody(src, 'function _itemChurch', '_itemChurch'),
    '_outboxLoad();',
    'let _flushing = false;',
    stmt(src, 'var _CONNECTION = ', '_CONNECTION'),
    'const isConnectionFailure = (e) => _CONNECTION.test(String((e && e.message) || e || ""));',
    stmt(src, 'var MAX_TRIES = ', 'MAX_TRIES'),
    stmt(src, 'var _PERMANENT = ', '_PERMANENT'),
    stmt(src, 'var isPermanentRefusal = ', 'isPermanentRefusal'),
    stmt(src, 'var isRateLimited = ', 'isRateLimited'),
    stmt(src, 'var isNoNetworkRelay = ', 'isNoNetworkRelay'),
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
    fnBody(src, 'subscribeThread(peerPub, onMsg) {', 'subscribeThread'),
    fnBody(src, 'subscribeDMs(onConvos) {', 'subscribeDMs'),
  ].join(',\n');
  const scope = scopeOf({
    localStorage: store, window: win, pool, console, fetch: netFetch,
    CANONICAL_RELAYS: canonical, CANONICAL_RELAY_PUBS: pins, DEFAULT_RELAYS: canonical,
    _native: false, _staticHost: false, _loc: null,
    normalizeURL, verifyEvent, finalizeEvent, CustomEvent: Ev,
    decode: nip19decode, nip19decode, performance, normalizeURL2: normalizeURL,
    _noteSendResult: () => {}, _checkIfBlocked: () => {}, _mayCache: () => true, NET: 'trinityone',
    _dmEncrypt: (sk, peer, body) => body, _dmDecrypt: async (sk, peer, c) => c,
    sk: me.sk, pub: me.pub,
  });
  const api = new Function('scope', `with (scope) { ${body}
    const _api = { ${methods} };
    return { sendDM: (p, c) => _api.sendDM(p, c), reactDM: (p, i, e) => _api.reactDM(p, i, e),
             subscribeThread: (p, f) => _api.subscribeThread(p, f), subscribeDMs: (f) => _api.subscribeDMs(f),
             relaysForChurch, publishSetFor, memberChurchPubs, dmSendRelays, dmReadRelays, _outboxRelays, _outboxFlush,
             outbox: () => _outbox, gate: _gate, churchRelaysRaw }; }`)(scope);
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

let A, B, SHARED, TA, TB, sarah, tom, stranger;
before(async () => {
  useWebSocketImplementation(RecordingWS);
  A = H.key(); A.npub = npubEncode(A.pub);
  B = H.key(); B.npub = npubEncode(B.pub);
  sarah = H.key(); tom = H.key(); stranger = H.key();
  SHARED = await H.startRelay({ name: 'SHARED', churches: [A.pub, B.pub] });
  TA = await H.startRelay({ name: 'TA', churches: [A.pub] });
  TB = await H.startRelay({ name: 'TB', churches: [B.pub] });
  await H.publishAll(SHARED, [joinDoc(sarah, A.pub), joinDoc(sarah, B.pub), joinDoc(tom, A.pub)]);
  await H.publishAll(TA, [joinDoc(sarah, A.pub), joinDoc(tom, A.pub)]);
  await H.publishAll(TB, [joinDoc(sarah, B.pub)]);
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

test('point of use: sendDM / reactDM / the outbox use the DM relay sets, never the whole list (vendor text; dead code is removed from vendor)', () => {
  const sd = fnBody(FELLOW, 'async sendDM(peerPub, content, replyTo) {', 'sendDM');
  assert.equal(sd.split('_publishBounded(dmSendRelays(peerPub), evt)').length - 1, 1);
  assert.equal(sd.split('relays: dmSendRelays(peerPub)').length - 1, 1);
  assert.equal(sd.split('window.Fellowship.relays').length - 1, 0, 'sendDM still names the whole candidate list');
  const rd = fnBody(FELLOW, 'async reactDM(peerPub, msgId, emoji) {', 'reactDM');
  assert.equal(rd.split('_publishAny(dmSendRelays(peerPub), evt)').length - 1, 1);
  const fl = fnBody(FELLOW, 'async function _outboxFlush', '_outboxFlush');
  assert.equal(fl.split('_publishBounded(_outboxRelays(item), item.evt)').length - 1, 1);
  assert.equal(fl.split('window.Fellowship.relays').length - 1, 0, 'the flush still falls back to the whole list');
  for (const [n, a] of [['subscribeThread', 'subscribeThread(peerPub, onMsg) {'], ['subscribeDMs', 'subscribeDMs(onConvos) {']]) {
    const f = fnBody(FELLOW, a, n);
    assert.equal(f.split('pool.subscribeMany(dmReadRelays(),').length - 1, 1, n + ' does not read over dmReadRelays()');
    assert.equal(f.split('window.Fellowship.relays').length - 1, 0, n + ' still names the whole candidate list');
  }
});

test('Sarah (A+B) -> Tom (A only): lands on A\'s box and the shared servers, NEVER on B\'s box', async () => {
  const app = await sarahsPhone();
  try {
    const set = app.dmSendRelays(tom.pub);
    assert.ok(set.includes(secure(TA.wsUrl)) && set.includes(secure(SHARED.wsUrl)), JSON.stringify(set));
    assert.ok(!set.includes(secure(TB.wsUrl)), 'B\'s box is in the DM send set: ' + JSON.stringify(set));
    const from = EVTS.length;
    const evt = await app.sendDM(tom.pub, 'hello tom');
    await sleep(500);
    assert.equal(evt._delivered, true, 'not delivered: ' + JSON.stringify(evt._refused));
    assert.ok(landedAt(TA, tom.pub, from) >= 1, 'A\'s own box did not get the DM');
    assert.ok(landedAt(SHARED, tom.pub, from) >= 1, 'the shared servers did not get the DM');
    assert.equal(landedAt(TB, tom.pub, from), 0, 'B\'s box was sent a DM to a person who is not in B');
    // the outbox entry carries the narrowed set too
  } finally { app.close(); }
});

test('Sarah -> church B\'s account: lands on B\'s box + shared, NOT on A\'s box (a message to a church counts as "both belong")', async () => {
  const app = await sarahsPhone();
  try {
    const from = EVTS.length;
    await app.sendDM(B.pub, 'hello church b');
    await sleep(500);
    assert.ok(landedAt(TB, B.pub, from) >= 1, 'B\'s box did not get the DM to B');
    assert.ok(landedAt(SHARED, B.pub, from) >= 1, 'the shared servers did not get it');
    assert.equal(landedAt(TA, B.pub, from), 0, 'A\'s box was sent a DM addressed to church B (the measured defect)');
  } finally { app.close(); }
});

test('Sarah -> a stranger (no shared church): the SHARED POOL ONLY - never empty, never a church box', async () => {
  const app = await sarahsPhone();
  try {
    assert.deepEqual(app.dmSendRelays(stranger.pub), [secure(SHARED.wsUrl)]);
    const from = EVTS.length;
    const evt = await app.sendDM(stranger.pub, 'hello stranger');
    await sleep(500);
    assert.ok(landedAt(SHARED, stranger.pub, from) >= 1, 'nobody got it - ' + JSON.stringify(evt._refused));
    assert.equal(landedAt(TA, stranger.pub, from) + landedAt(TB, stranger.pub, from), 0, 'a church box got a stranger DM');
  } finally { app.close(); }
});

test('reactDM to Tom goes where his DMs go: A\'s box + shared, not B\'s', async () => {
  const app = await sarahsPhone();
  try {
    const from = EVTS.length;
    await app.reactDM(tom.pub, 'a'.repeat(64), '+');
    await sleep(500);
    const at = (r) => EVTS.slice(from).filter(x => x.url === r.wsUrl && x.ev && x.ev.kind === 7).length;
    assert.ok(at(TA) >= 1 && at(SHARED) >= 1, 'reaction did not reach A + shared');
    assert.equal(at(TB), 0, 'a reaction to Tom reached B\'s box');
  } finally { app.close(); }
});

test('outbox flush: an entry LACKING a relay list goes to the shared pool only, never the whole list', async () => {
  const evt = finalizeEvent({ kind: 4, created_at: now(), tags: [['p', stranger.pub]], content: 'queued' }, sarah.sk);
  const app = await sarahsPhone({ outbox: [{ evt, groupId: null, at: now(), tries: 0, relays: [] }] });
  try {
    const from = EVTS.length;
    assert.deepEqual(app._outboxRelays(app.outbox()[0]), [secure(SHARED.wsUrl)]);
    await app._outboxFlush();
    await sleep(500);
    assert.ok(landedAt(SHARED, stranger.pub, from) >= 1, 'shared did not get the queued item');
    assert.equal(landedAt(TA, stranger.pub, from) + landedAt(TB, stranger.pub, from), 0, 'the flush fell back to church boxes');
  } finally { app.close(); }
});

test('outbox flush: an OLD queued DM that holds the whole list is narrowed at retry (peer Tom: A + shared, not B)', async () => {
  const evt = finalizeEvent({ kind: 4, created_at: now(), tags: [['p', tom.pub]], content: 'old queued' }, sarah.sk);
  const app = await sarahsPhone({ outbox: [{ evt, groupId: null, peer: tom.pub, at: now(), tries: 0, relays: [secure(SHARED.wsUrl), secure(TA.wsUrl), secure(TB.wsUrl)] }] });
  try {
    const from = EVTS.length;
    await app._outboxFlush();
    await sleep(500);
    assert.ok(landedAt(TA, tom.pub, from) >= 1 && landedAt(SHARED, tom.pub, from) >= 1);
    assert.equal(landedAt(TB, tom.pub, from), 0, 'the retry of an old whole-list DM reached B');
  } finally { app.close(); }
});

test('outbox flush: a JOIN (queued with no list on purpose) retries over that church\'s publish set, not the whole list', async () => {
  const evt = finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/member:' + A.pub], ['t', 'trinityone'], ['church', A.pub]], content: '{}' }, sarah.sk);
  const app = await sarahsPhone({ outbox: [{ evt, groupId: null, join: A.pub, at: now(), tries: 0, relays: [] }] });
  try {
    const set = app._outboxRelays(app.outbox()[0]);
    assert.deepEqual(set.slice().sort(), app.publishSetFor(A.pub).slice().sort());
    assert.ok(!set.includes(secure(TB.wsUrl)), 'a join to A would go to B\'s box');
  } finally { app.close(); }
});

test('READ: incoming DMs are read from the union of my churches\' sets (shared always in it); a message Tom sent via A\'s box reaches Sarah', async () => {
  const app = await sarahsPhone();
  try {
    const set = app.dmReadRelays();
    assert.ok(set.includes(secure(SHARED.wsUrl)) && set.includes(secure(TA.wsUrl)) && set.includes(secure(TB.wsUrl)), 'union of A and B sets: ' + JSON.stringify(set));
    // Tom's reply lands on A's box only (he is in A only); a pre-change message went to the shared server
    const reply = finalizeEvent({ kind: 4, created_at: now(), tags: [['p', sarah.pub]], content: 'reply via A' }, tom.sk);
    const old = finalizeEvent({ kind: 4, created_at: now() - 5, tags: [['p', sarah.pub]], content: 'sent before this change' }, tom.sk);
    await H.publishAll(TA, [reply]);
    await H.publishAll(SHARED, [old]);
    const got = []; const convos = [];
    const off = app.subscribeThread(tom.pub, (m) => got.push(m.content));
    const off2 = app.subscribeDMs((c) => convos.push(c));
    await sleep(1800);
    off(); off2();
    assert.ok(got.includes('reply via A'), 'a reply sent through the shared church\'s box did not arrive: ' + JSON.stringify(got));
    assert.ok(got.includes('sent before this change'), 'a message sent before the change (shared pool) is no longer readable: ' + JSON.stringify(got));
    assert.ok(convos.flat().some(c => c.peer === tom.pub), 'the inbox does not list the conversation');
  } finally { app.close(); }
});

test('READ with no church: the shared pool only, never empty (an existing conversation still loads from shared)', async () => {
  const app = phone({ who: sarah, relays: [secure(SHARED.wsUrl), secure(TA.wsUrl)], canonical: [secure(SHARED.wsUrl)], pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] }, activeChurch: null, followed: [] });
  try {
    await app.gate.refresh(app.churchRelaysRaw(), '');
    assert.deepEqual(app.dmReadRelays(), [secure(SHARED.wsUrl)]);
    assert.deepEqual(app.dmSendRelays(tom.pub), [secure(SHARED.wsUrl)]);
  } finally { app.close(); }
});
