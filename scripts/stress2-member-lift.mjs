import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join as join_ } from 'node:path';
import { networkInterfaces } from 'node:os';
import { SimplePool } from 'nostr-tools/pool';
import { verifyEvent, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode, decode as nip19decode } from 'nostr-tools/nip19';
import { normalizeURL } from 'nostr-tools/utils';
import { fnBody, stmt } from './test-slice.mjs';
import * as H from './relay-network-harness.mjs';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
export const FELLOW = read('vendor/fellowship.js');
export const RELAY_NET_D = 'trinityone/relay-net';
const GROUP_D = 'trinityone/group:';
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// THE CAP, READ OUT OF THE BUNDLE rather than typed here. A hand-copied tolerance constant is the drift this
// project has paid for once; a test that hard-coded 8 would silently stop testing the day the bound moved.
const CAP = new Function(stmt(FELLOW, 'var MEMBER_NETDOC_ADOPT_MAX = ', 'MEMBER_NETDOC_ADOPT_MAX')
  + '\nreturn MEMBER_NETDOC_ADOPT_MAX;')();
assert.ok(CAP > 0 && CAP < 1000, 'MEMBER_NETDOC_ADOPT_MAX read as a nonsense value: ' + JSON.stringify(CAP));

// ── the TLS shim, and nothing but ───────────────────────────────────────────────────────────────────────
export const secure = (u) => String(u || '').replace(/^ws:\/\//i, 'wss://').replace(/^http:\/\//i, 'https://');
export const wire = (u) => String(u || '').replace(/^wss:\/\/(127\.0\.0\.1[:/])/i, 'ws://$1').replace(/^https:\/\/(127\.0\.0\.1[:/])/i, 'http://$1');
// Every address the shipped code fetches, as it asked for it — so a test can say a box was never even dialled.
export const FETCHED = [];
export const DOWN = new Set();   // ports a test has taken off the air at the TRANSPORT (a relay unreachable, not refusing)
export const netFetch = (u, o) => { FETCHED.push(String(u)); if ([...DOWN].some(d => String(u).includes(':' + d + '/'))) return Promise.reject(new TypeError('fetch failed')); return globalThis.fetch(wire(typeof u === 'string' ? u : String(u)), o); };

// A real SimplePool with that rewrite on the way to the socket, plus the counters the no-churn questions need.
// Every list the shipped code assembles still arrives exactly as it assembled it.
export function wirePool(signer) {
  const p = new SimplePool();
  p.automaticallyAuth = () => async (authEvent) => finalizeEvent(authEvent, signer.sk);
  const list = (a) => (Array.isArray(a) ? a.map(wire) : a);
  const counts = { opened: 0, closed: 0, poolClose: 0, queried: 0 };
  const api = {
    _real: p, counts,
    querySync: (urls, f, o) => { counts.queried++; return p.querySync(list(urls), f, o); },
    subscribeMany: (urls, f, h) => {
      counts.opened++;
      const sub = p.subscribeMany(list(urls), f, h);
      return { close: () => { counts.closed++; try { sub.close(); } catch (e) {} } };
    },
    publish: (urls, e) => p.publish(list(urls), e),
    ensureRelay: (u, o) => p.ensureRelay(wire(u), o),
    listConnectionStatus: () => {
      const out = new Map();
      try { for (const [k, v] of p.listConnectionStatus()) { out.set(k, v); out.set(secure(k), v); } } catch (e) {}
      return out;
    },
    close: (urls) => { counts.poolClose++; try { p.close(list(urls)); } catch (e) {} },
    shutdown: () => { try { p.close(p.relays ? [...p.relays.keys()] : []); } catch (e) {} },
  };
  Object.defineProperty(api, 'relays', { get: () => p.relays });
  return api;
}

// ── a browser's worth of world ──────────────────────────────────────────────────────────────────────────
export function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
export class Ev { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } }
export function fakeWindow() {
  const events = [], ls = new Map();
  return {
    events, ls, Fellowship: {},
    dispatchEvent: (e) => {
      events.push({ type: e.type, detail: e.detail });
      for (const fn of [...(ls.get(e.type) || [])]) { try { fn(e); } catch (err) {} }
      return true;
    },
    addEventListener: (t, fn) => { if (!ls.has(t)) ls.set(t, new Set()); ls.get(t).add(fn); },
    removeEventListener: (t, fn) => { if (ls.has(t)) ls.get(t).delete(fn); },
  };
}
// Anything the lift asks for that is not stubbed raises a ReferenceError naming it, rather than arriving as
// undefined and being swallowed by one of the many try/catch blocks in this code — which is how a lift
// silently stops testing anything.
export function scopeOf(stubs) {
  return new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, '');
      if (base in t) return t[base];
      throw new ReferenceError('the lifted code needs `' + String(k) + '` — add a stub for it');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
}

// ── the shared predicate + gate, out of the member bundle ───────────────────────────────────────────────
// CANONICAL_RELAY_PUBS is NOT lifted (it is the shipped pin table pointing at app.trinityone.church, which no
// test can stand up); it is injected, so "the shared pool" below is a real relay on a bound port with a real key.
export function gateSource(src) {
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

// ── the member app, as a phone has it ───────────────────────────────────────────────────────────────────
// The launch path out of vendor/fellowship.js: the shipped setChurch, the shipped relay-net reader, the
// shipped adopt, the shipped gate, the shipped relay-list writer, and relaysForChurch/publishSetFor so the
// result is read off the real publish set. Nothing about which address is adopted — or when — is decided here.
export function memberOn({ church, relays = [], canonical = [], pins = {}, store = memStore(), who = null }) {
  const src = FELLOW;
  const me = who || H.key();
  const pool = wirePool(me);
  const body = [
    gateSource(src),
    fnBody(src, 'function toPub', 'toPub'),
    fnBody(src, 'function churchRelaysRaw', 'churchRelaysRaw'),
    fnBody(src, 'function _adoptionOrigin', '_adoptionOrigin'),
    stmt(src, 'var _relayNetCache = ', '_relayNetCache'),
    stmt(src, 'var RELAY_NET_TTL_MS = ', 'RELAY_NET_TTL_MS'),
    fnBody(src, 'async function churchRelayNet', 'churchRelayNet'),
    // ── THE THING UNDER TEST ──────────────────────────────────────────────────────────────────────────
    fnBody(src, 'function _netDocDialUrl', '_netDocDialUrl'),
    fnBody(src, 'function _alreadyAMemberCandidate', '_alreadyAMemberCandidate'),
    stmt(src, 'var MEMBER_NETDOC_ADOPT_MAX = ', 'MEMBER_NETDOC_ADOPT_MAX'),
    stmt(src, 'var _adoptingNetDoc = ', '_adoptingNetDoc'),
    stmt(src, 'var _netDocAgain = ', '_netDocAgain'),
    stmt(src, 'var _INVITE_PENDING_EXPIRY = ', '_INVITE_PENDING_EXPIRY'),
    stmt(src, 'var _INVITE_PENDING_MIN_GAP = ', '_INVITE_PENDING_MIN_GAP'),
    stmt(src, 'var _retryPendingRunning = ', '_retryPendingRunning'),
    fnBody(src, 'function isNetworkRelay2', 'isNetworkRelay2'),
    fnBody(src, 'async function _retryInvitePending', '_retryInvitePending'),
    // the shipped invite path: adoptInviteRelays proves the slip's relay and admits it (test 15)
    fnBody(src, 'function _saveChurchBoxes', '_saveChurchBoxes'),
    stmt(src, 'var _INVITE_PENDING_KEY = ', '_INVITE_PENDING_KEY'),
    fnBody(src, 'function _getInvitePending', '_getInvitePending'),
    fnBody(src, 'function _storeInvitePending', '_storeInvitePending'),
    fnBody(src, 'function _clearInvitePending', '_clearInvitePending'),
    fnBody(src, 'function _dropRevokedNetDocRows', '_dropRevokedNetDocRows'),
    fnBody(src, 'async function adoptChurchNetDocAddresses', 'adoptChurchNetDocAddresses'),
    // the gate and the read/publish sets it feeds
    stmt(src, 'var _gate = createRelayGate(', '_gate'),
    fnBody(src, 'function _netRelays', '_netRelays'),
    fnBody(src, 'function churchRelays()', 'churchRelays'),
    fnBody(src, 'function _otherChurchesNetDocRows', '_otherChurchesNetDocRows'),
    stmt(src, 'var _churchRelays = ', '_churchRelays'),
    stmt(src, 'var CHURCH_BOXES_KEY = ', 'CHURCH_BOXES_KEY'),
    fnBody(src, 'function _loadChurchBoxes', '_loadChurchBoxes'),
    fnBody(src, 'function relaysForChurch', 'relaysForChurch'),
    fnBody(src, 'function publishSetFor', 'publishSetFor'),
    stmt(src, 'var RELAYS_KEY = ', 'RELAYS_KEY'),
    // ── THE RE-SEND (PR #8-14 audit H-1 timing) ───────────────────────────────────────────────────────
    // The SHIPPED announceMembership, and under it the shipped _publishAny / _monotonicF / join-sent stamp.
    // Only the wedge detector, the blocked-check and the outbox's disk write are stubbed below.
    stmt(src, 'var NET = ', 'NET'),
    stmt(src, 'var _memberResent = ', '_memberResent'),
    fnBody(src, 'async function _resendMembershipToNewBoxes', '_resendMembershipToNewBoxes'),
    stmt(src, 'var _leaveGen = ', '_leaveGen'),
    fnBody(src, 'function _resendJoinToBoxesGainedInFlight', '_resendJoinToBoxesGainedInFlight'),
    // fix/stress-g2 (merged 2026-10-27): the one leaving guard every announce passes, and the queue helpers the Leave
    // uses — SHIPPED, lifted the same way a-member-adopts-its-churchs-signed-relay.test.mjs lifts them.
    stmt(src, 'var _left = ', '_left'),
    fnBody(src, 'function _leavingFor', '_leavingFor'),
    fnBody(src, 'function _announceBlocked', '_announceBlocked'),
    fnBody(src, 'function _outboxDropJoins', '_outboxDropJoins'),
    fnBody(src, 'function _mine', '_mine'),
    fnBody(src, 'function _itemChurch', '_itemChurch'),
    fnBody(src, 'function memberChurchPubs', 'memberChurchPubs'),
    fnBody(src, 'function _leaveDelivered', '_leaveDelivered'),
    stmt(src, 'var _PERMANENT = ', '_PERMANENT'),
    stmt(src, 'var isPermanentRefusal = ', 'isPermanentRefusal'),
    stmt(src, 'var _joinSent = ', '_joinSent'),
    fnBody(src, 'function _joinSentSave', '_joinSentSave'),
    fnBody(src, 'function _markJoinSent', '_markJoinSent'),
    fnBody(src, 'function _joinSentFor', '_joinSentFor'),
    // the SHIPPED leaveMembership and what it calls to forget a join (finding A: a Leave during the re-send's wait)
    fnBody(src, 'function _clearJoinSent', '_clearJoinSent'),
    stmt(src, 'var JOININTENT_KEY = ', 'JOININTENT_KEY'),
    stmt(src, 'var _joinIntents = ', '_joinIntents'),
    fnBody(src, 'function _joinIntentSave', '_joinIntentSave'),
    fnBody(src, 'function _dropJoinIntent', '_dropJoinIntent'),
    fnBody(src, 'function _pubReason', '_pubReason'),
    stmt(src, 'var _lastStampF = ', '_lastStampF'),
    fnBody(src, 'function _monotonicF', '_monotonicF'),
    stmt(src, 'var NO_NETWORK_RELAY = ', 'NO_NETWORK_RELAY'),
    stmt(src, 'var WEDGE_ACK_MS = ', 'WEDGE_ACK_MS'),
    stmt(src, 'var _PUB_REFUSED = ', '_PUB_REFUSED'),
    stmt(src, 'var _PUB_FAILED = ', '_PUB_FAILED'),
    stmt(src, 'var _PUB_SILENT = ', '_PUB_SILENT'),
    fnBody(src, 'function _wedgeKey', '_wedgeKey'),
    fnBody(src, 'function _classify', '_classify'),
    fnBody(src, 'function _dedupeRelays', '_dedupeRelays'),
    fnBody(src, 'function _publishAny', '_publishAny'),
  ].join('\n');

  // GUARDS ON THE LIFT. A slice that stopped containing a load-bearing line would leave every assertion below
  // passing over nothing at all. These are the lines the whole file turns on.
  assert.match(body, /pool\.querySync\(churchRelaysRaw\(\)/,
    'vendor/fellowship.js: the relay-net read has moved onto the FILTERED list — the bootstrap read-side ' +
    'deadlock (RELAY-ADMISSION trap 3: that read must stay UNGATED or no phone can bootstrap)');
  const adopt = fnBody(src, 'async function adoptChurchNetDocAddresses', 'adoptChurchNetDocAddresses');
  assert.match(adopt, /String\(proof\.relayPub \|\| ""\)\.toLowerCase\(\) !== String\(e && e\.pubkey/,
    'vendor/fellowship.js: adopt no longer requires the box to prove the KEY the entry names (trap 2)');
  assert.match(adopt, /await isNetworkRelay\(cp, u,/,
    'vendor/fellowship.js: adopt no longer puts the address through the member admission predicate');
  assert.match(adopt, /window\.Fellowship\.addRelay\(u\)/,
    'vendor/fellowship.js: adopt no longer writes through the member\'s own Add route');
  assert.match(adopt, /_resendMembershipToNewBoxes\(cp, before\)/,
    'vendor/fellowship.js: adopt no longer re-sends the membership when the publish set gains a box');
  assert.doesNotMatch(adopt, /_churchRelays|_saveChurchBoxes|churchboxes/,
    'vendor/fellowship.js: adopt now writes _churchRelays / churchboxes — the remove/re-add churn the plan forbids');

  const win = fakeWindow();
  win.Fellowship = { relays: [...relays], churchPub: null, ready: Promise.resolve() };
  const announceMembership = fnBody(src, 'async announceMembership(npubOrHex) {', 'announceMembership');
  const leaveMembership = fnBody(src, 'async leaveMembership(npubOrHex) {', 'leaveMembership');
  const setChurch = fnBody(src, 'setChurch(npubOrHex) {', 'setChurch');
  const setRelays = fnBody(src, 'setRelays(urls) {', 'setRelays');
  const adoptInviteRelays = fnBody(src, 'async adoptInviteRelays(npubOrHex, raw) {', 'adoptInviteRelays');
  // THE ONE LINE THIS CHANGE ADDS, asserted present in the slice that is about to run — otherwise every
  // point-of-use assertion would be asking an unchanged setChurch to do something it never did.
  assert.equal(setChurch.split('adoptChurchNetDocAddresses(').length - 1, 1,
    'vendor/fellowship.js: setChurch no longer drives adoptChurchNetDocAddresses exactly once — the defect ' +
    'this change exists to fix, or a duplicate call');

  const ANNOUNCED = [];
  const scope = scopeOf({
    ANNOUNCED, localStorage: store, window: win, pool, console, fetch: netFetch,
    CANONICAL_RELAYS: canonical, CANONICAL_RELAY_PUBS: pins, DEFAULT_RELAYS: canonical,
    _native: false, _staticHost: false, _loc: null,
    normalizeURL, verifyEvent, finalizeEvent, CustomEvent: Ev,
    decode: nip19decode, nip19decode, performance,
    // _watchChurchRelays is the SIBLING feature (step 2, commit bbf6409c): setChurch calls it too, inside its
    // own try/catch. It reads the kind-10002 list, a DIFFERENT document from the relay-net doc this change
    // reads, and is proved by scripts/a-member-learns-a-relay-added-after-they-followed.test.mjs. Stubbed to a
    // no-op so nothing but adoptChurchNetDocAddresses can put a box in the list here — a box arriving by the
    // other path would be a false pass for THIS feature.
    _watchChurchRelays: () => {},
    // the member's key, as the module holds it, and the plumbing under the shipped announceMembership that has
    // nothing to do with WHERE it publishes: the wedge detector, the blocked check, the outbox's disk write.
    sk: me.sk, pub: me.pub, _outbox: [], _outboxSave: () => {}, _docsHubs: new Map(),
    _outboxFailed: [], _flushing: false, _outboxFlush: async () => {},   // fix/stress-g2: the Leave sends this church's queued posts first; none here
    normalizeURL2: normalizeURL, _noteSendResult: () => {}, _checkIfBlocked: () => {},
    _forgetChurch: () => {},   // local-state cleanup after a leave; nothing here reads it
  });
  const api = new Function('scope', `with (scope) { ${body}
    const _api = { ${setChurch}, ${setRelays}, ${adoptInviteRelays}, ${announceMembership}, ${leaveMembership} };
    window.Fellowship.setRelays = (u) => _api.setRelays(u);
    window.Fellowship.announceMembership = (n) => { ANNOUNCED.push(n); return _api.announceMembership(n); };
    window.Fellowship.leaveMembership = (n) => _api.leaveMembership(n);
    window.Fellowship.addRelay = (u) => _api.setRelays([...window.Fellowship.relays, u]);
    return { setChurch: (n) => _api.setChurch(n),
             adopt: (cp) => { window.Fellowship.churchPub = cp; return adoptChurchNetDocAddresses(cp); },
             retryPending: () => _retryInvitePending(),
             adoptInvite: (n, raw) => _api.adoptInviteRelays(n, raw),
             dial: _netDocDialUrl,
             churchRelays, churchRelaysRaw, relaysForChurch, publishSetFor,
             gate: _gate, resend: _resendMembershipToNewBoxes,
             pub: (cp, evt) => _publishAny(publishSetFor(cp), evt),
             netCache: _relayNetCache, churchRelaysMap: _churchRelays }; }`)(scope);
  api.pool = pool;
  api.announced = ANNOUNCED;
  api.announce = (cp) => win.Fellowship.announceMembership(cp);
  api.leave = (cp) => win.Fellowship.leaveMembership(cp);
  api.me = me;
  api.win = win;
  api.store = store;
  api.relays = () => win.Fellowship.relays;
  api.close = () => { try { pool.shutdown(); } catch (e) {} };
  return api;
}

// ── fixtures: the church's own signed documents, published to real boxes ────────────────────────────────
