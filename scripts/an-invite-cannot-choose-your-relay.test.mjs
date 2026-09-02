// AN INVITE IS A HINT ABOUT WHERE TO ASK. IT IS NEVER AN INSTRUCTION ABOUT WHO COUNTS.
// Run: node --test scripts/an-invite-cannot-choose-your-relay.test.mjs
//
// C4 closed the gate on the LIST. This is the item that closes the paths by which an address is PUSHED at a
// client — a scanned code, a directory record that re-points itself, a background name-swap that runs every
// ninety seconds for ever, a discovery offer, a restored file, a clone. What a person experiences without
// it: they scan a code at the church door and their phone starts publishing their DMs and their child's care
// request to somebody else's machine, and nothing on screen changes.
//
// EVERY RELAY HERE IS A REAL `node scripts/gateway.mjs`, UP, HOLDING THE SAME CHURCH, AND GENUINELY ASKED.
// A test that finds nothing on a box it never contacted proves nothing at all, so the refused relays below
// are in the same health as the admitted ones and every count is taken from the RELAY'S OWN STORE over
// /sync as the church key — never from the return value of the call that wrote it.
//
// THE ONE THING THIS HARNESS FAKES IS TLS, and it is worth being exact about it. `?relay=` has required a
// wss:// address since the 2026-07-06 audit (L5) — a cleartext relay in an invite would put a whole
// congregation's traffic in front of any network in the path — and a gateway on a bound loopback port has
// no certificate. So the scope below carries a `fetch` and a pool that rewrite `wss://127.0.0.1:…` to
// `ws://…` AT THE TRANSPORT, and nothing else: every byte, every signature check, every nonce and every
// admission decision is the shipped code's. What is stubbed is the wire, not the answer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SimplePool } from 'nostr-tools/pool';
import { verifyEvent, finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { normalizeURL } from 'nostr-tools/utils';
import { WebSocket as NodeWebSocket } from 'ws';
import { fnBody, stmt } from './test-slice.mjs';
import * as H from './relay-network-harness.mjs';

const RELAY_NET_D = 'trinityone/relay-net';
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const STEWARD = read('vendor/steward.js');
const FELLOW = read('vendor/fellowship.js');
const APPJSX = read('app/app.jsx');

// ── the TLS shim, and nothing but ───────────────────────────────────────────────────────────────────────
const secure = (u) => String(u || '').replace(/^ws:\/\//i, 'wss://').replace(/^http:\/\//i, 'https://');
const wire = (u) => String(u || '').replace(/^wss:\/\/(127\.0\.0\.1[:/])/i, 'ws://$1').replace(/^https:\/\/(127\.0\.0\.1[:/])/i, 'http://$1');
const netFetch = (u, o) => globalThis.fetch(wire(typeof u === 'string' ? u : String(u)), o);
// A real SimplePool with the same rewrite on the way to the socket. Every list the shipped code assembles
// still arrives here exactly as the shipped code assembled it, which is what makes "this box received
// nothing" mean something.
function wirePool(signer) {
  const p = new SimplePool();
  p.automaticallyAuth = () => async (authEvent) => finalizeEvent(authEvent, signer.sk);
  const list = (a) => (Array.isArray(a) ? a.map(wire) : a);
  return {
    _real: p,
    querySync: (urls, f, o) => p.querySync(list(urls), f, o),
    subscribeMany: (urls, f, h) => p.subscribeMany(list(urls), f, h),
    publish: (urls, e) => p.publish(list(urls), e),
    close: () => { try { p.close(p.relays ? [...p.relays.keys()] : []); } catch (e) {} },
  };
}

// ── a browser's worth of world ──────────────────────────────────────────────────────────────────────────
function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
function fakeWindow() {
  const events = [];
  return {
    events, Fellowship: {}, Steward: {},
    dispatchEvent: (e) => { events.push({ type: e.type, detail: e.detail }); return true; },
    addEventListener: () => {}, removeEventListener: () => {},
  };
}
class Ev { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } }

// Anything the lifted code asks for that is not stubbed raises a ReferenceError NAMING it, rather than
// arriving as undefined and being swallowed by one of the many try/catch blocks in this code — which is how
// a lift silently stops testing anything.
function scopeOf(stubs) {
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

// The shared predicate + C4 gate out of whichever bundle. CANONICAL_RELAY_PUBS is injected rather than
// lifted: the shipped table pins app.trinityone.church, and a test that used it could only stage the
// canonical root against a machine it cannot run.
function gateSource(src) {
  return [
    stmt(src, 'var RELAY_PROOF_WINDOW_SEC = ', 'RELAY_PROOF_WINDOW_SEC'),
    fnBody(src, 'function relayIdentityNonce', 'relayIdentityNonce'),
    fnBody(src, 'function relayHttpBase', 'relayHttpBase'),
    fnBody(src, 'function relayAddrKey', 'relayAddrKey'),
    fnBody(src, 'async function verifyRelayIdentity', 'verifyRelayIdentity'),
    stmt(src, 'var RELAY_NET_D = ', 'RELAY_NET_D'),
    fnBody(src, 'function _relayKey', '_relayKey'),
    stmt(src, 'var _isHex64 = ', '_isHex64'),
    fnBody(src, 'function canonicalPinsFor', 'canonicalPinsFor'),
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
    fnBody(src, 'function rememberVerified', 'rememberVerified'),
    fnBody(src, 'function createRelayGate', 'createRelayGate'),
  ].join('\n');
}

// ── the member app, as a phone has it ───────────────────────────────────────────────────────────────────
// The whole invite-adoption path out of vendor/fellowship.js: the shipped parser, the shipped resolver, the
// shipped predicate, the shipped writer. Nothing about which address is adopted is decided here.
function memberOn({ church, relays = [], canonical = [], pins = {}, store = memStore(), who = null }) {
  const src = FELLOW;
  const me = who || H.key();
  const pool = wirePool(me);
  const body = [
    gateSource(src),
    fnBody(src, 'function churchRelaysRaw', 'churchRelaysRaw'),
    fnBody(src, 'function _adoptionOrigin', '_adoptionOrigin'),
    stmt(src, 'var _relayNetCache = ', '_relayNetCache'),
    stmt(src, 'var RELAY_NET_TTL_MS = ', 'RELAY_NET_TTL_MS'),
    fnBody(src, 'async function churchRelayNet', 'churchRelayNet'),
    fnBody(src, 'function isNetworkRelay2', 'isNetworkRelay2'),
    stmt(src, 'var _gate = createRelayGate(', '_gate'),
    fnBody(src, 'function _netRelays', '_netRelays'),
    fnBody(src, 'function churchRelays()', 'churchRelays'),
  ].join('\n');
  const win = fakeWindow();
  win.Fellowship = { relays: [...relays], churchPub: church.pub, ready: Promise.resolve() };
  const adopt = fnBody(src, 'async adoptInviteRelays(npubOrHex, raw) {', 'adoptInviteRelays');
  const resolve = fnBody(src, 'async resolveRelayName(name) {', 'resolveRelayName');
  const setRelays = fnBody(src, 'setRelays(urls) {', 'setRelays');
  // Guards on the lift. A slice that stopped containing the load-bearing line would leave every assertion
  // below passing over nothing at all.
  assert.match(adopt, /await isNetworkRelay2\(cp, url\)/,
    'vendor/fellowship.js: adoptInviteRelays no longer verifies before adopting — an invite is an instruction again');
  assert.match(adopt, /if \(got\) return out;/,
    'vendor/fellowship.js: the name is resolved even when the invite\'s own address worked, which is AUDIT-2026-07-29 S3 ' +
    'reopened — a self-hosted church\'s joiner tells the shared directory they are joining, right now, at the ' +
    'most sensitive moment there is');
  assert.doesNotMatch(adopt, /hosts\.push/,
    'vendor/fellowship.js: adoptInviteRelays still builds a resolver host list from the invite — an invite that ' +
    'chooses both the question and the answer is a redirect, not a hint');
  const scope = scopeOf({
    localStorage: store, window: win, pool, console, fetch: netFetch,
    CANONICAL_RELAYS: canonical, CANONICAL_RELAY_PUBS: pins, DEFAULT_RELAYS: canonical,
    _native: false, _staticHost: false, _loc: null,
    normalizeURL, verifyEvent, finalizeEvent, CustomEvent: Ev,
    toPub: (x) => (/^[0-9a-f]{64}$/i.test(String(x)) ? String(x).toLowerCase() : ''),
  });
  const api = new Function('scope', `with (scope) { ${body}
    const _api = { ${adopt}, ${resolve}, ${setRelays} };
    window.Fellowship.setRelays = (u) => _api.setRelays(u);
    window.Fellowship.resolveRelayName = (n) => _api.resolveRelayName(n);
    return { adoptInviteRelays: (c, r) => _api.adoptInviteRelays(c, r),
             resolveRelayName: (n) => _api.resolveRelayName(n),
             churchRelays, churchRelaysRaw, gate: _gate }; }`)(scope);
  api.me = me;
  api.win = win;
  api.relays = () => win.Fellowship.relays;
  // The lifted code closes over `fetch` in this scope, so a test that wants to watch which HOSTS are asked
  // swaps it here rather than wrapping globalThis — which would also catch this file's own fixtures.
  api.setFetch = (f) => { scope.fetch = f; };
  api.close = () => pool.close();
  return api;
}

// ── the steward console, as a steward has it ────────────────────────────────────────────────────────────
function consoleOn({ church, origin, canonical = [], pins = {}, extra = [], named = [], seed = [], store = memStore(), realSockets = false }) {
  const src = STEWARD;
  const win = fakeWindow();
  const pool = wirePool(church);
  const body = [
    gateSource(src),
    fnBody(src, 'function lsGet', 'lsGet'),
    fnBody(src, 'function lsSet', 'lsSet'),
    stmt(src, 'var RELAYS_LS = ', 'RELAYS_LS'),
    stmt(src, 'var NAMES_LS = ', 'NAMES_LS'),
    fnBody(src, 'function normRelay', 'normRelay'),
    fnBody(src, 'function ownRelay', 'ownRelay'),
    fnBody(src, 'function extraRelays', 'extraRelays'),
    fnBody(src, 'function relaysRaw', 'relaysRaw'),
    fnBody(src, 'function _ownOrigin', '_ownOrigin'),
    fnBody(src, 'function relayNetCandidates', 'relayNetCandidates'),
    fnBody(src, 'function _oneComplete', '_oneComplete'),
    fnBody(src, 'function relayNetDoc', 'relayNetDoc'),
    fnBody(src, 'async function relayNetEntries', 'relayNetEntries'),
    fnBody(src, 'function isNetworkRelay2', 'isNetworkRelay2'),
    stmt(src, 'var _gate = createRelayGate(', '_gate'),
    fnBody(src, 'function relays()', 'relays'),
    stmt(src, 'var NO_NETWORK_RELAY = ', 'NO_NETWORK_RELAY'),
    fnBody(src, 'async function publish(evt)', 'publish'),
    fnBody(src, 'function _dirBases', '_dirBases'),
    fnBody(src, 'async function resolveRelayName', 'resolveRelayName'),
    fnBody(src, 'async function admitRemoteRelay', 'admitRemoteRelay'),
    fnBody(src, 'function getNamedRelays', 'getNamedRelays'),
    fnBody(src, 'function setNamedRelays', 'setNamedRelays'),
    fnBody(src, 'function _writeExtraRelays', '_writeExtraRelays'),
    stmt(src, 'var _refreshingNames = ', '_refreshingNames'),
    fnBody(src, 'async function refreshNamedRelays', 'refreshNamedRelays'),
    fnBody(src, 'function _blobBase', '_blobBase'),
    stmt(src, 'var _relayInfoCache = ', '_relayInfoCache'),
    fnBody(src, 'function _relayInfo', '_relayInfo'),
    stmt(src, 'var _discoverySeed = ', '_discoverySeed'),
    fnBody(src, 'function _probeRelayEnforces', '_probeRelayEnforces'),
    fnBody(src, 'async function discoverRelayOffers', 'discoverRelayOffers'),
    fnBody(src, 'function pickRelays', 'pickRelays'),
    fnBody(src, 'function _nip98', '_nip98'),
  ].join('\n');
  assert.match(body, /if \(!await admitRemoteRelay\(newUrl\)\) continue;/,
    'vendor/steward.js: refreshNamedRelays swaps a church\'s relay address without re-verifying it — and it runs ' +
    'every 90 seconds and on every window focus, for ever, with no user action after the first connect');
  assert.match(body, /if \(!j \|\| typeof j\.url !== "string" \|\| !\/\^wss:/,
    'vendor/steward.js: resolveRelayName takes whatever scheme the directory returns — the L5 check its member-side twin has had since 2026-07-06');
  assert.match(body, /if \(!await admitRemoteRelay\(url\)\) return null;/,
    'vendor/steward.js: discoverRelayOffers no longer filters offers to relays this church vouched for');

  const clone = fnBody(src, 'async cloneFromRelay(sourceUrl, { targetUrl, onProgress } = {}) {', 'cloneFromRelay');
  assert.match(clone, /await verifyRelayIdentity\(srcRelay\)/, 'vendor/steward.js: the clone SOURCE is no longer asked to prove who it is');
  assert.match(clone, /await admitRemoteRelay\(dstRelay\)/, 'vendor/steward.js: the clone DESTINATION — which receives the whole corpus — is no longer gated');
  const addRelay = fnBody(src, '  addRelay(input) {', 'addRelay');
  const autoPick = fnBody(src, 'async autoPickRelays(n) {', 'autoPickRelays');
  const setSeed = fnBody(src, '  setDiscoverySeed(urls) {', 'setDiscoverySeed');

  const scope = scopeOf({
    localStorage: store, window: win, location: origin, pool, console, fetch: netFetch,
    CANONICAL_RELAY: canonical[0] || 'wss://canonical.invalid/relay',
    CANONICAL_RELAYS: canonical, CANONICAL_RELAY_PUBS: pins,
    _boxHostsUs: null,
    pub: church.pub, sk: church.sk,
    now: () => Math.floor(Date.now() / 1000),
    finalizeEvent, verifyEvent, normalizeURL, generateSecretKey, getPublicKey, npubEncode,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    CustomEvent: Ev, NET: 'trinityone',
    AbortSignal, AbortController, setTimeout, clearTimeout, Promise,
    // _probeRelayEnforces opens a throwaway socket and asks the box to break the rules. Where a test's
    // subject is the MEMBERSHIP filter rather than the probe, the probe has to genuinely run and genuinely
    // pass, or the refusal being measured is the stub's and not the code's (memory: stub-answers-the-question).
    // `realSockets` gives it the real `ws` client, through the same loopback rewrite as every other transport
    // here. The default refuses immediately, which is all the tests that never reach the probe need.
    WebSocket: realSockets
      ? function (u) { return new NodeWebSocket(wire(u)); }
      : function () { setTimeout(() => { try { this.onerror && this.onerror(); } catch (e) {} }, 0); this.close = () => {}; },
    _waitForRegistration: async () => {},
    _lastOk: new Map(),
  });
  store.setItem('trinityone.steward.extra-relays', JSON.stringify(extra));
  store.setItem('trinityone.steward.relay-names', JSON.stringify(named));
  const api = new Function('scope', `with (scope) { ${body}
    const _api = { ${addRelay}, ${autoPick}, ${setSeed}, ${clone} };
    window.Steward = { addRelay: (u) => _api.addRelay(u), publishRelayList: async () => true };
    _api.setDiscoverySeed(${JSON.stringify(seed)});
    return { relays, relaysRaw, publish, extraRelays, gate: _gate, ownRelay,
             resolveRelayName: (n, o) => resolveRelayName(n, o),
             refreshNamedRelays: () => refreshNamedRelays(),
             getNamedRelays, discoverRelayOffers: (r) => discoverRelayOffers(null, r),
             autoPickRelays: (n) => _api.autoPickRelays(n),
             cloneFromRelay: (s, o) => _api.cloneFromRelay(s, o),
             addRelay: (u) => _api.addRelay(u) }; }`)(scope);
  api.win = win;
  api.store = store;
  api.close = () => pool.close();
  return api;
}

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────
const churchDocFor = (church, d, content) => finalizeEvent(
  { kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', d], ['t', 'trinityone']], content: JSON.stringify(content) }, church.sk);
// Sign a box into a church's membership document by hand, so "the church has already vouched for this key"
// is set up without going through the code under test.
const signIn = (church, boxes) => churchDocFor(church, RELAY_NET_D, boxes.map(r => ({ pubkey: r.relayPub, alwaysOn: true, url: secure(r.wsUrl) })));
async function held(relay, church, d) {
  const evs = await H.corpus(relay, church);
  return evs.filter(e => (e.tags.find(t => t[0] === 'd') || [])[1] === d).length;
}
// Register a relay's name in a directory relay's own store, the way a relay claims its handle.
//
// RE-POINTING one is the whole subject of the refresh test, and the directory's own rules make that specific:
// a handle stays owned by the key that first claimed it, and every claim from that key must be strictly newer
// than the last it accepted. So the holder's key comes back out and goes back in, with a later timestamp —
// which is exactly what "whoever holds the name moves it" looks like on the wire.
const _nameKeys = new Map();
async function claimName(dir, handle, url, offer) {
  const sk = _nameKeys.get(handle) || generateSecretKey();
  const at = Math.max(Math.floor(Date.now() / 1000), (_nameKeys.get(handle + ':at') || 0) + 1);
  _nameKeys.set(handle, sk); _nameKeys.set(handle + ':at', at);
  const tags = [['handle', handle], ['relay', url]];
  if (offer) tags.push(['offer', JSON.stringify(offer)]);
  const ev = finalizeEvent({ kind: 27235, created_at: at, tags, content: '' }, sk);
  const r = await globalThis.fetch(`${dir.base}/relay-names/sync`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records: [ev] }),
  });
  const j = await r.json();
  assert.equal(j.merged, 1, 'the fixture could not register a relay name on the directory relay');
}

// ── the participants ────────────────────────────────────────────────────────────────────────────────────
// SIGNED, STRANGER and DIR run the same software, hold the same church, and are equally healthy. The only
// difference between them is whether this church's signature vouches for their key.
let church, SIGNED, STRANGER, DIR;
before(async () => {
  church = H.key();
  [SIGNED, STRANGER, DIR] = await Promise.all([
    H.startRelay({ name: 'SIGNED', churches: [church.pub] }),
    H.startRelay({ name: 'STRANGER', churches: [church.pub] }),
    H.startRelay({ name: 'DIR', churches: [church.pub] }),
  ]);
  assert.equal(new Set([SIGNED, STRANGER, DIR].map(r => r.relayPub)).size, 3,
    'the three relays must be three separate boxes or nothing below means anything');
  // The church vouches for SIGNED, and only SIGNED. Published to every box, so "STRANGER did not receive the
  // church's data" can never be explained by STRANGER not knowing who the church is.
  const doc = signIn(church, [SIGNED]);
  for (const box of [SIGNED, STRANGER, DIR]) await H.publishAll(box, [doc]);
});
after(() => H.stopAll());

// ── 1. THE POINT OF USE: the screen that follows a church ───────────────────────────────────────────────
test('the screen that follows a church routes the invite through the verified adoption, and adopts nothing itself', async () => {
  // app/*.jsx ships UNBUNDLED, so `false && ` in front of a condition leaves every word of it in place and a
  // text-matching assertion still passes (CLAUDE.md rule 3). So this RUNS the block: the same lines the phone
  // runs, with a Fellowship that records what it was asked to do.
  const at = APPJSX.indexOf('    if (F && F.addRelay) {');
  assert.notEqual(at, -1, 'the relay section of followChurch is gone from app/app.jsx — re-anchor this test');
  const block = fnBody(APPJSX, at, 'followChurch\'s relay section');
  const added = [], invites = [];
  const F = {
    CANONICAL_RELAYS: ['wss://pool.example/relay'],
    addRelay: (u) => added.push(u),
    adoptInviteRelays: (npub, raw) => { invites.push([npub, raw]); return Promise.resolve({ added: [], refused: [] }); },
  };
  const raw = '?follow=npub1x&relay=wss%3A%2F%2Fattacker.example%2Frelay&relayname=stmarys';
  const npub = 'npub1thechurch';
  new Function('F', 'raw', 'npub', 'String', 'decodeURIComponent', 'fetch', 'Promise', block)(
    F, raw, npub, String, decodeURIComponent, () => { assert.fail('the screen fetched a host of the invite\'s choosing'); }, Promise);

  assert.deepEqual(added, ['wss://pool.example/relay'],
    'the screen adopted an address itself: ' + JSON.stringify(added) + '. The only thing it may add on its own is ' +
    'the shared pool it was built with — anything carried IN the invite has to go through the verified path.');
  assert.equal(invites.length, 1, 'the screen never handed the invite to adoptInviteRelays, so nothing verifies ' +
    'the address a scanned code names — deleting that one line is precisely the failure CLAUDE.md rule 1 exists for');
  assert.deepEqual(invites[0], [npub, raw],
    'adoptInviteRelays was called with ' + JSON.stringify(invites[0]) + ' — it needs the church whose signature ' +
    'decides admission AND the whole invite, or it is verifying against the wrong church or parsing nothing');
});

// ── 2. ?relay= — a real, running, un-signed box, genuinely asked ────────────────────────────────────────
test('a crafted join link naming a running relay this church never signed for adopts nothing, and that box stays empty', async () => {
  const app = memberOn({ church, relays: [], canonical: [secure(SIGNED.wsUrl)], pins: { [secure(SIGNED.wsUrl)]: [SIGNED.relayPub] } });
  try {
    const before = await held(STRANGER, church, 'trinityone/notices');
    const res = await app.adoptInviteRelays(church.pub, '?follow=x&relay=' + encodeURIComponent(secure(STRANGER.wsUrl)));
    assert.deepEqual(res.added, [], 'a relay nobody vouched for was adopted straight off a scanned code');
    assert.deepEqual(res.refused, [secure(STRANGER.wsUrl)], 'the refusal was not reported, so nothing can tell the person why');
    assert.equal(app.relays().includes(secure(STRANGER.wsUrl)), false, 'the address reached the phone\'s relay list anyway');

    // IT WAS UP AND IT WAS ASKED. A box that was never contacted holding nothing proves nothing at all.
    const probe = await globalThis.fetch(`${STRANGER.base}/relay-identity?nonce=` + 'a'.repeat(32));
    assert.equal(probe.ok, true, 'STRANGER cannot answer the possession proof at all, so this test would pass against a dead box');

    // …and the refusal is legible where the person is.
    const ev = app.win.events.filter(e => e.type === 'trinity-relay-refused');
    assert.equal(ev.length, 1, 'nothing was dispatched when an invite\'s relay was turned away — a silent drop is how ' +
      'a printed slip that names an unenrolled box becomes an unexplained "nothing happens"');
    assert.deepEqual(ev[0].detail.urls, [secure(STRANGER.wsUrl)]);

    assert.equal(await held(STRANGER, church, 'trinityone/notices'), before,
      'a box this church never signed for received a church document from a scanned code');
  } finally { app.close(); }
});

test('…and the church\'s own signed box, offered exactly the same way, IS adopted', async () => {
  const app = memberOn({ church, relays: [], canonical: [] });
  try {
    // The church's signature lives ON the boxes, so the phone must be able to read it. The candidate list is
    // what that read goes over (the C4 read-side deadlock rule), so the invite arrives at a phone that
    // already knows one address — the shape a member of an existing church is really in.
    app.relays().push(secure(DIR.wsUrl));
    const res = await app.adoptInviteRelays(church.pub, '?follow=x&relay=' + encodeURIComponent(secure(SIGNED.wsUrl)));
    assert.deepEqual(res.refused, [], 'the church\'s OWN relay was refused — this gate would orphan a self-hosted church');
    assert.deepEqual(res.added, [secure(SIGNED.wsUrl)], 'the church\'s own relay was not adopted from its own invite');
    assert.ok(app.relays().includes(secure(SIGNED.wsUrl)), 'the adopted address never reached the relay list');
  } finally { app.close(); }
});

// ── 3. ?relayname= — the invite does not get to choose the resolver ─────────────────────────────────────
test('the host named in the invite is never asked to resolve the invite\'s own relay name', async () => {
  // The whole shape in one line: a code that carries both the question ("which relay is `stmarys`?") and the
  // machine that answers it is a redirect, not a hint. It used to be asked FIRST, on the argument that
  // ?relay= was added unverified anyway so preferring it granted nothing new — an argument C4 inverted.
  const seen = [];
  const host = await H.startImpostor({
    name: 'invite-host',
    handler: (req, res, url) => {
      seen.push(url.pathname);
      H.sendJson(res, { handle: 'stmarys', url: secure(STRANGER.wsUrl) });
    },
  });
  await claimName(DIR, 'stmarys', secure(SIGNED.wsUrl));
  const app = memberOn({ church, relays: [secure(DIR.wsUrl)], canonical: [secure(DIR.wsUrl)] });
  try {
    const raw = '?follow=x&relay=' + encodeURIComponent(secure(host.base).replace(/^https/, 'wss') + '/relay') + '&relayname=stmarys';
    const res = await app.adoptInviteRelays(church.pub, raw);
    assert.ok(seen.length > 0, 'the invite\'s own host was never contacted at all, so "it was not asked to resolve" is vacuous');
    assert.deepEqual(seen.filter(p => p.startsWith('/relay-names/')), [],
      'the invite\'s own host was asked to resolve the invite\'s own relay name: ' + JSON.stringify(seen));
    assert.deepEqual(res.added, [secure(SIGNED.wsUrl)],
      'the name resolved through the shared directory should still bring in the box the church signed for; got ' + JSON.stringify(res));
  } finally { app.close(); host.stop(); }
});

test('a name that resolves to a relay this church never signed for is refused, and that box stays empty', async () => {
  await claimName(DIR, 'wolf', secure(STRANGER.wsUrl));
  const app = memberOn({ church, relays: [secure(DIR.wsUrl)], canonical: [secure(DIR.wsUrl)] });
  try {
    const before = await held(STRANGER, church, 'trinityone/notices');
    const res = await app.adoptInviteRelays(church.pub, '?follow=x&relayname=wolf');
    assert.deepEqual(res.added, [], 'a directory record pointed the phone at a box nobody vouched for and it took it');
    assert.deepEqual(res.refused, [secure(STRANGER.wsUrl)], 'the resolved address was not even examined: ' + JSON.stringify(res));
    assert.equal(await held(STRANGER, church, 'trinityone/notices'), before, 'the un-signed box received a church document');
  } finally { app.close(); }
});

// ── 4. refreshNamedRelays — the REPEAT pass, which is the whole point ───────────────────────────────────
test('a name re-pointed AFTER it was already followed is re-verified on the next pass, not trusted because it passed once', async () => {
  // THE MOST UNDER-APPRECIATED PATH IN THE CODEBASE. This runs 2.5 seconds after load, then every 90 seconds,
  // then on every window focus, for ever, with no user action after the first connect. Verifying only the
  // first swap would leave a church's address swappable by whoever holds the name, weeks later, silently.
  const dirUrl = secure(DIR.wsUrl);
  await claimName(DIR, 'stcuthbert', secure(SIGNED.wsUrl));
  const con = consoleOn({
    church, origin: { protocol: 'https:', host: 'console.example' },
    canonical: [dirUrl], pins: { [dirUrl]: [DIR.relayPub] },
    extra: ['wss://old.example/relay'],
    named: [{ name: 'stcuthbert', url: 'wss://old.example/relay' }],
  });
  try {
    // PASS ONE: the name points at the box this church signed for, so the swap happens.
    await con.refreshNamedRelays();
    assert.ok(con.extraRelays().includes(secure(SIGNED.wsUrl)),
      'the first swap did not happen at all, so the repeat test below would be vacuous: ' + JSON.stringify(con.extraRelays()));

    // …and now whoever holds the name re-points it at a box this church never signed for.
    await claimName(DIR, 'stcuthbert', secure(STRANGER.wsUrl));
    const resolved = await con.resolveRelayName('stcuthbert', { member: false });
    assert.equal(resolved && resolved.url, secure(STRANGER.wsUrl),
      'the directory record was not actually re-pointed, so pass two below is testing nothing');

    const before = await held(STRANGER, church, 'trinityone/notices');
    // PASS TWO — the same call, the same console, no user action anywhere.
    await con.refreshNamedRelays();
    assert.equal(con.extraRelays().includes(secure(STRANGER.wsUrl)), false,
      'the repeat pass adopted the re-pointed address: ' + JSON.stringify(con.extraRelays()) + '. A name is held by ' +
      'whoever claimed it, and this loop runs for ever with nobody watching.');
    assert.deepEqual(con.getNamedRelays().map(e => e.url), [secure(SIGNED.wsUrl)],
      'the remembered name was re-pointed at the un-verified address, so the next pass would start from it');

    await con.gate.refresh(con.relaysRaw(), church.pub);
    await con.publish(churchDocFor(church, 'trinityone/notices', { text: 'Harvest supper, Sunday 6pm' }));
    assert.equal(await held(STRANGER, church, 'trinityone/notices'), before,
      'the church\'s notices reached a box it never signed for, by way of a name swapped under it in the background');
    assert.ok(await held(SIGNED, church, 'trinityone/notices') > 0,
      'nothing reached the church\'s own relay either, so the publish above proves nothing');
  } finally { con.close(); }
});

// ── 5. the console resolver's own two checks ────────────────────────────────────────────────────────────
test('the console resolver refuses a cleartext answer, and an answer no church vouched for', async () => {
  const dirUrl = secure(DIR.wsUrl);
  await claimName(DIR, 'cleartext', 'ws://plain.example/relay');
  await claimName(DIR, 'stranger', secure(STRANGER.wsUrl));
  await claimName(DIR, 'ourown', secure(SIGNED.wsUrl));
  const con = consoleOn({ church, origin: { protocol: 'https:', host: 'console.example' }, canonical: [dirUrl], pins: { [dirUrl]: [DIR.relayPub] } });
  try {
    // L5, which the member-side twin has enforced since the 2026-07-06 audit and this one never did. A
    // directory record is a stranger's string; a ws:// answer puts a congregation's whole traffic in the open.
    assert.equal(await con.resolveRelayName('cleartext'), null, 'the console adopted a cleartext relay address out of the directory');
    assert.equal(await con.resolveRelayName('stranger'), null, 'a name resolving to a box this church never signed for came back as usable');
    const ok = await con.resolveRelayName('ourown');
    assert.equal(ok && ok.url, secure(SIGNED.wsUrl), 'the church\'s OWN relay could not be reached by name — this would break connect-by-name outright');
    // …and the possession-proof-only form, which exists for exactly one caller: the clone source.
    const src = await con.resolveRelayName('stranger', { member: false });
    assert.equal(src && src.url, secure(STRANGER.wsUrl),
      'the clone source could not resolve a box this church has not vouched for — which is every box a church is MIGRATING OFF');
  } finally { con.close(); }
});

// ── 6. Auto-find ───────────────────────────────────────────────────────────────────────────────────────
test('Auto-find does not adopt a relay that merely offers to host, however well it behaves', async () => {
  // Its own church, because the control below has to change a membership document and that must not reach
  // into any other test in this file.
  const flock = H.key();
  const [OPEN, HOME] = await Promise.all([
    H.startRelay({ name: 'OPEN', churches: [flock.pub], env: { RELAY_OPEN: '1', RELAY_OPERATOR: 'somebody-else' } }),
    H.startRelay({ name: 'HOME', churches: [flock.pub] }),
  ]);
  try {
    for (const box of [OPEN, HOME]) await H.publishAll(box, [signIn(flock, [HOME])]);
    // The offer is REAL: a running gateway advertising that it is enforcing and open to new churches.
    const info = await (await globalThis.fetch(OPEN.base + '/relay', { headers: { Accept: 'application/nostr+json' } })).json();
    assert.equal(info.trinityone.enforces, true, 'the fixture relay does not advertise itself as enforcing, so there is no offer to refuse');
    assert.equal(info.trinityone.open, true, 'the fixture relay is not advertising an offer, so this test would pass with the gate deleted');

    const homeUrl = secure(HOME.wsUrl), openUrl = secure(OPEN.wsUrl);
    const opts = { church: flock, origin: { protocol: 'https:', host: 'console.example' },
                   canonical: [homeUrl], pins: { [homeUrl]: [HOME.relayPub] }, seed: [openUrl], realSockets: true };
    const con = consoleOn(opts);
    try {
      const before = await held(OPEN, flock, 'trinityone/notices');
      const picks = await con.autoPickRelays(2);
      assert.deepEqual(picks.map(p => p.url), [],
        'Auto-find picked ' + JSON.stringify(picks.map(p => p.url)) + ' — a relay this church has never vouched for');
      assert.equal(con.extraRelays().includes(openUrl), false, 'Auto-find added the offered relay to the church\'s list');
      await con.gate.refresh(con.relaysRaw(), flock.pub);
      await con.publish(churchDocFor(flock, 'trinityone/notices', { text: 'not for a stranger' }));
      assert.equal(await held(OPEN, flock, 'trinityone/notices'), before, 'a relay that offered to host received the church\'s documents');
    } finally { con.close(); }

    // THE CONTROL, and without it the refusal above could be the behavioural probe's or the advertisement's
    // rather than membership's. Nothing changes except the church's signature: the same box, the same offer,
    // the same probe — and now it is picked.
    const signed = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000) + 5,
      tags: [['d', RELAY_NET_D], ['t', 'trinityone']],
      content: JSON.stringify([HOME, OPEN].map(r => ({ pubkey: r.relayPub, alwaysOn: true, url: secure(r.wsUrl) }))) }, flock.sk);
    for (const box of [OPEN, HOME]) await H.publishAll(box, [signed]);
    const con2 = consoleOn(opts);
    try {
      const picks = await con2.autoPickRelays(2);
      assert.deepEqual(picks.map(p => p.url), [openUrl],
        'the same box, the same offer and the same behavioural probe — now WITH this church\'s signature — was still ' +
        'not picked: ' + JSON.stringify(picks.map(p => p.url)) + '. So the refusal above was not membership\'s doing, ' +
        'and this test proves nothing about the gate it names.');
    } finally { con2.close(); }
  } finally { OPEN.stop(); HOME.stop(); }
});

// ── 6-bis. AUDIT-2026-07-29 S3, which this item had to avoid reopening ──────────────────────────────────
test('joining a self-hosted church from a slip whose address still works asks no directory at all', async () => {
  // S3: a member of a SELF-HOSTED congregation, joining from a printed slip, used to tell the shared host
  // that this device exists, that it is joining NOW, and which relay it is looking for — at the single most
  // sensitive moment there is, and a congregation runs its own box precisely so no central party sees its
  // people. That was fixed by asking the invite's OWN host first; C5 removes that step, because an invite
  // that chooses both the question and the answer is a redirect rather than a hint.
  //
  // So the leak is closed a different way, and this is the test that says it stayed closed: the name is
  // resolved ONLY when the printed address did not work out. When the church's box is up at the address on
  // the slip — which is the case S3 is about — no directory is asked anything by anybody.
  const asked = [];
  const app = memberOn({ church, relays: [secure(DIR.wsUrl)], canonical: [secure(DIR.wsUrl)] });
  const spy = (u, o) => { asked.push(String(u)); return netFetch(u, o); };
  try {
    app.setFetch(spy);
    const raw = '?follow=x&relay=' + encodeURIComponent(secure(SIGNED.wsUrl)) + '&relayname=stmarys';
    const res = await app.adoptInviteRelays(church.pub, raw);
    assert.deepEqual(res.added, [secure(SIGNED.wsUrl)], 'the church\'s own box was not adopted from a working slip: ' + JSON.stringify(res));
    assert.ok(asked.some(u => u.includes('/relay-identity')), 'nothing was fetched at all, so "no directory was asked" is vacuous');
    assert.deepEqual(asked.filter(u => u.includes('/relay-names/')), [],
      'a directory was asked to resolve the invite\'s relay name even though the printed address worked: ' +
      JSON.stringify(asked.filter(u => u.includes('/relay-names/'))));
  } finally { app.close(); }
});

// ── 7. the clone, which is the rule that must not ship the wrong way round ──────────────────────────────
test('a clone SOURCE proves it holds its key — and is NOT required to be a member, because that is what migration is', async () => {
  // The source is the box the church is LEAVING. Requiring the full membership gate here inverts time: a
  // church vouches for the machine it is ARRIVING at, never the one it is escaping — and a third-party host
  // a church is migrating off has, by construction, no signature from that church.
  const [OLDBOX, NEWBOX] = await Promise.all([
    H.startRelay({ name: 'OLDBOX', churches: [church.pub] }),
    H.startRelay({ name: 'NEWBOX', churches: [church.pub] }),
  ]);
  try {
    await H.publishAll(OLDBOX, [churchDocFor(church, 'trinityone/notices', { text: 'ten years of this church' })]);
    // NEWBOX is admitted by the same-origin root — the console is served BY it, which is the Suite's shape —
    // and OLDBOX is in nobody's document at all.
    const con = consoleOn({ church, origin: { protocol: 'https:', host: '127.0.0.1:' + NEWBOX.port }, extra: [secure(NEWBOX.wsUrl)] });
    try {
      const res = await con.cloneFromRelay(secure(OLDBOX.wsUrl), { targetUrl: secure(NEWBOX.wsUrl) });
      assert.ok(res && (res.imported | 0) > 0, 'the clone imported nothing: ' + JSON.stringify(res));
      assert.ok(await held(NEWBOX, church, 'trinityone/notices') > 0,
        'the church\'s history did not arrive on the box it is moving TO — this is the migration the owner needs, and it is blocked');
    } finally { con.close(); }
  } finally { OLDBOX.stop(); NEWBOX.stop(); }
});

test('a clone source that cannot prove who it is gets no request — and above all no church-signed header', async () => {
  const seen = [];
  const listener = await H.startImpostor({
    name: 'plain-listener',
    handler: (req, res, url) => { seen.push({ path: url.pathname, auth: req.headers['authorization'] || '' }); H.sendJson(res, {}); },
  });
  const con = consoleOn({ church, origin: { protocol: 'https:', host: 'console.example' }, extra: [secure(SIGNED.wsUrl)] });
  try {
    await assert.rejects(() => con.cloneFromRelay(secure(listener.base).replace(/^https/, 'wss') + '/relay'),
      /could not prove who it is/i, 'a plain HTTP listener was accepted as a source for a church\'s whole history');
    assert.ok(seen.length > 0, 'the listener was never contacted at all, so "no export request reached it" is vacuous — ' +
      'the address may simply have been malformed');
    assert.deepEqual(seen.filter(r => r.auth), [],
      'a request carrying an Authorization header reached a host that never proved it is a relay: ' + JSON.stringify(seen));
    assert.deepEqual(seen.filter(r => r.path === '/export'), [],
      'the export was requested from an unproven host: ' + JSON.stringify(seen));
  } finally { con.close(); listener.stop(); }
});

test('a clone DESTINATION takes the full gate, and a non-member target ends up holding nothing', async () => {
  await H.publishAll(SIGNED, [churchDocFor(church, 'trinityone/notices', { text: 'the corpus' })]);
  const con = consoleOn({ church, origin: { protocol: 'https:', host: 'console.example' }, extra: [secure(SIGNED.wsUrl)] });
  try {
    const before = await held(STRANGER, church, 'trinityone/notices');
    await assert.rejects(() => con.cloneFromRelay(secure(SIGNED.wsUrl), { targetUrl: secure(STRANGER.wsUrl) }),
      /isn.t in your church.s network/i, 'the whole corpus was copied onto a box this church never signed for');
    assert.equal(await held(STRANGER, church, 'trinityone/notices'), before,
      'the destination gate let a church\'s entire history — every document, every name, every sealed care request — ' +
      'land on a relay nobody vouched for');
  } finally { con.close(); }
});
