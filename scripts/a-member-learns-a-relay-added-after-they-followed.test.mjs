// A MEMBER WHO FOLLOWED THE CHURCH BEFORE A RELAY EXISTED ENDS UP WITH THAT RELAY, WITHOUT RE-FOLLOWING.
// Relay address gossip, step 2 (TrinityOne-internal/PLAN-relay-address-gossip-2026-10-22 §4).
// Run: node --test scripts/a-member-learns-a-relay-added-after-they-followed.test.mjs
//
// THE MEASURED DEFECT. `src/fellowship.src.js:subscribeChurchRelays` reads the church's signed kind-10002
// relay list and adopts the relays it declares. It had exactly ONE caller: app/app.jsx's followChurch, the
// moment somebody follows a church. So on an ordinary launch the read never ran at all — `_churchRelays`
// stayed empty, `_reResolveRelayName` was never driven, and every existing member of an established church
// never learned about a box the church added after they joined.
//
// ── WHAT THE CODE SAYS THAT THE PLAN DOES NOT, AND THE CODE WINS ────────────────────────────────────────
// The plan's measurement was a steward TYPING a relay into one console and a second console never seeing
// it. Step 2 does not fix that measurement and nothing in this file claims it does. Grepped at this commit,
// `src/steward.src.js:publishRelayList` — the only producer of kind-10002 anywhere in the product — has
// three callers: `refreshNamedRelays`, and only when a NAMED relay's address actually CHANGED; and
// `connectFoundRelays` / `autoPickRelays`, which are Auto-find. A steward who types an address by hand
// publishes NO kind-10002, so there is nothing for any member-side read of it to find. What step 2 does fix
// is the case the console's own comment at that call site already depends on: "republish the kind-10002
// relay list so member phones learn the new tunnel address… without this, members keep trying the dead
// address and fall back to the shared relays until someone hands out a new slip." That republish reaches no
// member on an ordinary launch today, because its reader has one caller. Auto-find is the same.
// The member-side mirror of step 1 — adopting addresses out of `trinityone/relay-net` — is NOT built and is
// not in this branch's scope.
//
// ── HOW THIS FILE IS DRIVEN, which is the part that matters ─────────────────────────────────────────────
// Every relay here is a real `node scripts/gateway.mjs` (scripts/relay-network-harness.mjs). Nothing injects
// an answer for `one`, `netEntries`, `verify` or `relayNetEntries`: injected answers hid two HIGH bugs in
// self-hosting Phase 1 and produced a vacuous safety test in a cancelled phase, so every document below is
// PUBLISHED to a real box and read back off the wire, every NIP-11 probe is a real HTTP round trip to a real
// gateway, and every admission is a real /relay-identity nonce exchange with a real relay key.
//
// THE ONE THING FAKED IS TLS, and exactly as `an-invite-cannot-choose-your-relay.test.mjs` fakes it.
// `subscribeChurchRelays` accepts only `wss://` addresses out of the church's list — correctly; a cleartext
// relay would put a congregation's traffic in front of any network in the path — and a gateway on a bound
// loopback port has no certificate. So the scope carries a `fetch` and a pool that rewrite
// `wss://127.0.0.1:…` to `ws://…` AT THE TRANSPORT and nothing else. What is stubbed is the wire, not any
// answer.
//
// THE POINT OF USE (CLAUDE.md rule 1) is tests 1a and 1b, and both are RUN rather than read:
//   1a — the app.jsx effect that scopes outgoing traffic to the active church is sliced out of app/app.jsx
//        and EXECUTED with a recording Fellowship, so the path INTO the engine is driven, not assumed;
//   1b — the shipped `setChurch` is lifted out of vendor/fellowship.js and called, and the box the church
//        added afterwards has to end up in the member's relay list and in its publish set.
// Delete `_watchChurchRelays(…)` from setChurch and 1b goes red; delete the setChurch call from app.jsx and
// 1a goes red. Nothing here asserts behaviour by matching text in app/*.jsx (CLAUDE.md rule 3) — the one
// app.jsx claim is made by executing the slice.
//
// ── SABOTAGE RECORD, 2026-10-23 ─────────────────────────────────────────────────────────────────────────
// Eight changes, each scoped to the construct under test: the enclosing function (or, in app/app.jsx, the
// enclosing statement) was sliced, the target asserted to appear exactly ONCE inside that slice, and only
// that occurrence replaced. That discipline earned its keep here: S8's target text appears SEVEN times in
// app/app.jsx, so a plain file-wide replace would have rewritten six other effects' dependency lists.
// Every case keeps the symbol REFERENCED — deleting a call outright makes esbuild tree-shake the name, so
// the lift throws "is missing" and the file dies rather than a test failing. Caught, with the tests that
// went red out of 8:
//   · setChurch passes null instead of the active church (the trigger neutered)       → 2,3,4,5,6,7,8
//   · the teardown is dropped before the next read is opened (the subscription leak)  → 5
//   · the `_crOpening` re-entrancy guard blinded                                      → 5
//   · the settle floor blinded (`age < CHURCHLIST_SETTLE_MS * 0`)                     → 6
//   · `over > 0` relaxed to `over >= 0` (a read over nothing is never retried)        → 2,7,8
//   · the re-read floor blinded (`age < CHURCHLIST_REREAD_MS * 0`)                    → 6
//   · app/app.jsx: the setChurch call blinded with `false &&`                         → 1
//   · app/app.jsx: connTick dropped from the effect's dependency list                 → 1
// THE LAST TWO ARE THE RULE-3 DEMONSTRATION: app/*.jsx ships unbundled, so `false && ` leaves every word of
// that call in place and any text-matching assertion over it still passes. Test 1 catches it because it RUNS
// the statement.
// AND SABOTAGE WROTE TWO OF THESE TESTS. The settle and re-read floors were originally covered by nothing:
// blinding either left all seven of the then-tests green, because test 5's eight ticks all land in the first
// milliseconds where whichever floor survives swallows them. Test 6 exists because of that, and each half of
// it is staged so the other floor cannot be what returns.
// NOT CAUGHT, and stated rather than hidden: nothing here falsifies the exact VALUES 20000 and 3000. Test 6
// reads both out of the bundle and asserts only their ordering, so a church whose relay list is re-read every
// 21 seconds instead of every 20 would pass. The values are a rate limit, not a correctness property.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SimplePool } from 'nostr-tools/pool';
import { verifyEvent, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode, decode as nip19decode } from 'nostr-tools/nip19';
import { normalizeURL } from 'nostr-tools/utils';
import { fnBody, stmt } from './test-slice.mjs';
import * as H from './relay-network-harness.mjs';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const FELLOW = read('vendor/fellowship.js');
const APPJSX = read('app/app.jsx');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// THE TWO FLOORS, READ OUT OF THE BUNDLE rather than typed here. A hand-copied tolerance constant is the
// drift this project has already paid for once; and a test that waited a hard-coded 3.4s would silently stop
// testing anything the day the floor moved.
const FLOORS = new Function(
  stmt(FELLOW, 'var CHURCHLIST_REREAD_MS = ', 'CHURCHLIST_REREAD_MS') + '\n'
  + stmt(FELLOW, 'var CHURCHLIST_SETTLE_MS = ', 'CHURCHLIST_SETTLE_MS')
  + '\nreturn { CHURCHLIST_REREAD_MS, CHURCHLIST_SETTLE_MS };')();
const CRSETTLE = FLOORS.CHURCHLIST_SETTLE_MS;
assert.ok(CRSETTLE > 0 && CRSETTLE < FLOORS.CHURCHLIST_REREAD_MS,
  'the settle floor must be a positive window shorter than the re-read floor — got ' + JSON.stringify(FLOORS));

// ── the TLS shim, and nothing but ───────────────────────────────────────────────────────────────────────
const secure = (u) => String(u || '').replace(/^ws:\/\//i, 'wss://').replace(/^http:\/\//i, 'https://');
const wire = (u) => String(u || '').replace(/^wss:\/\/(127\.0\.0\.1[:/])/i, 'ws://$1').replace(/^https:\/\/(127\.0\.0\.1[:/])/i, 'http://$1');
const netFetch = (u, o) => globalThis.fetch(wire(typeof u === 'string' ? u : String(u)), o);

// A real SimplePool with that rewrite on the way to the socket, plus the counters this file's leak and
// loop questions need. Every list the shipped code assembles still arrives exactly as it assembled it.
function wirePool(signer) {
  const p = new SimplePool();
  p.automaticallyAuth = () => async (authEvent) => finalizeEvent(authEvent, signer.sk);
  const list = (a) => (Array.isArray(a) ? a.map(wire) : a);
  const counts = { opened: 0, closed: 0, poolClose: 0 };
  let onOpen = null;
  const api = {
    _real: p, counts,
    onSubscribe: (fn) => { onOpen = fn; },
    querySync: (urls, f, o) => p.querySync(list(urls), f, o),
    subscribeMany: (urls, f, h) => {
      counts.opened++;
      const sub = p.subscribeMany(list(urls), f, h);
      // A SUBSCRIPTION THAT IS NEVER CLOSED IS THE LEAK THIS BRANCH COULD HAVE SHIPPED, so closes are
      // counted on the object the shipped code is handed, not inside the pool.
      const wrapped = { close: () => { counts.closed++; try { sub.close(); } catch (e) {} } };
      if (onOpen) { const f2 = onOpen; onOpen = null; try { f2(); } catch (e) {} }
      return wrapped;
    },
    publish: (urls, e) => p.publish(list(urls), e),
    ensureRelay: (u, o) => p.ensureRelay(wire(u), o),
    // relaysHealthy() reads this map and compares it with the publish set, which is spelled wss://. The real
    // pool keys it by the wire url, so the keys are secured back or every address would read as down.
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
function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
class Ev { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } }
// REAL listener bookkeeping. "Did the previous read's `trinity-relays` listener come off?" is one of the two
// leak questions, and a no-op addEventListener cannot answer it.
function fakeWindow() {
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
    listenerCount: (t) => ((ls.get(t) || new Set()).size),
  };
}

// The names a `with (scope)` lift needs but must not be allowed to invent. Anything the bundle asks for that
// is not stubbed raises a ReferenceError naming it, rather than arriving as undefined and being swallowed by
// one of the many try/catch blocks in this code — which is how a lift silently stops testing anything.
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

// ── the shared predicate + gate, out of the member bundle ───────────────────────────────────────────────
// CANONICAL_RELAY_PUBS is deliberately NOT lifted: it is the shipped pin table pointing at
// app.trinityone.church, and a test that used it could only stage the canonical root against a machine it
// cannot run. It is injected, so "the shared pool" below is a real relay on a bound port with a real key.
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

// ── the member app, as a phone has it ───────────────────────────────────────────────────────────────────
// The whole launch path out of vendor/fellowship.js: the shipped setChurch, the shipped kind-10002 reader,
// the shipped adoption and revocation, the shipped gate, the shipped relay-list writer. Nothing about which
// address is adopted — or when the read runs — is decided in this file.
function memberOn({ church, relays = [], canonical = [], pins = {}, store = memStore(), who = null }) {
  const src = FELLOW;
  const me = who || H.key();
  const pool = wirePool(me);
  const apiCounts = { add: 0, remove: 0 };
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
    fnBody(src, 'function churchRelays()', 'churchRelays'),
    fnBody(src, 'function _otherChurchesNetDocRows', '_otherChurchesNetDocRows'),
    // the adoption bookkeeping — unaltered by this branch, and lifted so nothing about it is mocked
    stmt(src, 'var _churchRelays = ', '_churchRelays'),
    stmt(src, 'var _churchList = ', '_churchList'),
    stmt(src, 'var _applying = ', '_applying'),
    stmt(src, 'var LISTHW_KEY = ', 'LISTHW_KEY'),
    fnBody(src, 'function _loadHW', '_loadHW'),
    fnBody(src, 'function _saveHW', '_saveHW'),
    stmt(src, 'var CHURCH_BOXES_KEY = ', 'CHURCH_BOXES_KEY'),
    fnBody(src, 'function _loadChurchBoxes', '_loadChurchBoxes'),
    fnBody(src, 'function _saveChurchBoxes', '_saveChurchBoxes'),
    fnBody(src, 'function _maybeDropRelay', '_maybeDropRelay'),
    fnBody(src, 'async function _applyChurchList', '_applyChurchList'),
    stmt(src, 'var _resolving = ', '_resolving'),
    fnBody(src, 'async function _reResolveRelayName', '_reResolveRelayName'),
    fnBody(src, 'function relaysForChurch', 'relaysForChurch'),
    fnBody(src, 'function publishSetFor', 'publishSetFor'),
    stmt(src, 'var _relayInfoCache = ', '_relayInfoCache'),
    fnBody(src, 'function _relayInfo', '_relayInfo'),
    // ── THE THING UNDER TEST ──────────────────────────────────────────────────────────────────────────
    stmt(src, 'var CHURCHLIST_REREAD_MS = ', 'CHURCHLIST_REREAD_MS'),
    stmt(src, 'var CHURCHLIST_SETTLE_MS = ', 'CHURCHLIST_SETTLE_MS'),
    stmt(src, 'var _crWatch = ', '_crWatch'),
    stmt(src, 'var _crLast = ', '_crLast'),
    stmt(src, 'var _crOpening = ', '_crOpening'),
    fnBody(src, 'function _crMono', '_crMono'),
    fnBody(src, 'function _stopChurchRelaysWatch', '_stopChurchRelaysWatch'),
    fnBody(src, 'function _watchChurchRelays', '_watchChurchRelays'),
    fnBody(src, 'function _crHealthy', '_crHealthy'),
  ].join('\n');

  // GUARDS ON THE LIFT. A slice that stopped containing the load-bearing line would leave every assertion
  // below passing over nothing at all.
  assert.match(body, /pool\.querySync\(churchRelaysRaw\(\)/,
    'vendor/fellowship.js: the membership read has moved onto the FILTERED list — the read-side deadlock ' +
    '(RELAY-ADMISSION trap 3: the bootstrap relay-net read must stay UNGATED or no phone can bootstrap)');

  const win = fakeWindow();
  win.Fellowship = { relays: [...relays], churchPub: null, ready: Promise.resolve() };
  const setChurch = fnBody(src, 'setChurch(npubOrHex) {', 'setChurch');
  const subChurchRelays = fnBody(src, 'subscribeChurchRelays(churchNpub) {', 'subscribeChurchRelays');
  const setRelays = fnBody(src, 'setRelays(urls) {', 'setRelays');
  const healthy = fnBody(src, 'relaysHealthy() {', 'relaysHealthy');
  const verified = fnBody(src, 'relayVerified(url) {', 'relayVerified');
  // THE ONE LINE THIS BRANCH ADDS, asserted present in the slice that is about to be run — otherwise every
  // test below would be asking an unchanged setChurch to do something it never did.
  assert.match(setChurch, /_watchChurchRelays\(/,
    'vendor/fellowship.js: setChurch no longer drives _watchChurchRelays, so the church\'s signed relay ' +
    'list is read only when somebody follows a church — the defect this branch exists to fix');
  assert.match(subChurchRelays, /_applyChurchList\(cp\)/,
    'vendor/fellowship.js: subscribeChurchRelays no longer applies the list it read');

  const scope = scopeOf({
    localStorage: store, window: win, pool, console, fetch: netFetch,
    CANONICAL_RELAYS: canonical, CANONICAL_RELAY_PUBS: pins, DEFAULT_RELAYS: canonical,
    _native: false, _staticHost: false, _loc: null,
    normalizeURL, verifyEvent, finalizeEvent, CustomEvent: Ev,
    // THE BUNDLER RENAMES THE IMPORT, AND `toPub` SWALLOWS THE DIFFERENCE. src/fellowship.src.js calls
    // `nip19decode`, but esbuild resolves that to the nip19 module's exported name — the bundle's toPub calls
    // `decode`. toPub wraps it in `try { … } catch { return null; }`, so a missing stub does not raise: it
    // makes every npub decode to null, setChurch set churchPub to null, and the watch quietly stop. That cost
    // a debugging round here; both names are provided so neither spelling can reintroduce it silently.
    decode: nip19decode, nip19decode, performance,
    api_counts: apiCounts,
  });
  const api = new Function('scope', `with (scope) { ${body}
    const _api = { ${setChurch}, ${subChurchRelays}, ${setRelays}, ${healthy}, ${verified} };
    window.Fellowship.setRelays = (u) => _api.setRelays(u);
    window.Fellowship.addRelay = (u) => { api_counts.add++; return _api.setRelays([...window.Fellowship.relays, u]); };
    window.Fellowship.removeRelay = (u) => { api_counts.remove++; return _api.setRelays(window.Fellowship.relays.filter(r => r !== u)); };
    window.Fellowship.subscribeChurchRelays = (n) => { try { return _api.subscribeChurchRelays(n); } catch (e) { api_counts.err = String((e && e.stack) || e); throw e; } };
    window.Fellowship.relaysHealthy = () => _api.relaysHealthy();
    window.Fellowship.resolveRelayName = async () => null;
    return { setChurch: (n) => _api.setChurch(n), churchRelays, churchRelaysRaw,
             relaysForChurch, publishSetFor, relaysHealthy: () => _api.relaysHealthy(),
             relayVerified: (u) => _api.relayVerified(u),
             gate: _gate, churchBoxes: _churchRelays, churchList: _churchList,
             watch: () => _crWatch }; }`)(scope);
  api.counts = apiCounts;
  api.pool = pool;
  api.me = me;
  api.win = win;
  api.store = store;
  api.relays = () => win.Fellowship.relays;
  api.close = () => { try { pool.shutdown(); } catch (e) {} };
  return api;
}

// THE APP'S OWN RESPONSE TO A CHURN SIGNAL, STAGED — not injected. app.jsx routes `trinity-relay-returned`
// (which the relay gate's onChange fires the moment it admits a relay) through its one reconnect scheduler,
// which bumps connTick, which re-runs the effect that calls setChurch. Test 1a RUNS that chain out of
// app/app.jsx itself; this hands the engine the same tick a phone would send, so the cold-boot sequence a
// real launch goes through — read over nothing, the gate admits a relay, read again — actually happens here.
// Bounded, so a gate that changed on every refresh could not turn this file into an infinite loop.
const tickOn = (app, npub, max = 16) => {
  let n = 0;
  app.win.addEventListener('trinity-relay-returned', () => {
    if (n++ >= max) return;
    try { app.setChurch(npub); } catch (e) {}
  });
};

// ── fixtures: the church's own signed documents, published to real boxes ────────────────────────────────
const now = () => Math.floor(Date.now() / 1000);
// The NIP-65 list `src/steward.src.js:publishRelayList` writes, in the shape that matters: kind 10002,
// signed by the CHURCH key, one `r` tag per relay, no read/write marker.
const relayList = (church, urls, at) => finalizeEvent(
  { kind: 10002, created_at: at || now(), tags: urls.map(u => ['r', secure(u)]), content: '' }, church.sk);
// the member's own "I belong to this church" doc, so no relay below can be explained as refusing a stranger
const joinDoc = (who, cp) => finalizeEvent(
  { kind: 30078, created_at: now(), tags: [['d', 'trinityone/member:' + cp], ['t', 'trinityone'], ['church', cp]], content: '{}' }, who.sk);

let church, SHARED, BOX, BOX2;
before(async () => {
  church = H.key();
  church.npub = npubEncode(church.pub);
  SHARED = await H.startRelay({ name: 'SHARED', churches: [church.pub] });
  BOX = await H.startRelay({ name: 'BOX', churches: [church.pub] });
  BOX2 = await H.startRelay({ name: 'BOX2', churches: [church.pub] });
  assert.equal(new Set([SHARED, BOX, BOX2].map(r => r.relayPub)).size, 3,
    'the three relays must be separate boxes or nothing below means anything');
});
// …and a force-exit that cannot change the verdict. A wedged socket (test 3's box accepts a connection and
// never answers) is in no hurry to be collected, and a file that never exits reads from a runner as NO
// ANSWER rather than a bad one. Unref'd, so it only fires if something is still holding the loop open, and
// it exits with whatever code the run had already earned.
after(() => {
  H.stopAll();
  try { setTimeout(() => process.exit(process.exitCode || 0), 10000).unref(); } catch (e) {}
});

// Wait for the shipped adoption to settle. It is genuinely asynchronous — a REQ, then one NIP-11 probe per
// declared relay — so this polls a PREDICATE rather than sleeping a guessed interval.
const until = async (pred, label, ms = 25000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(100); }
  assert.fail('timed out waiting for: ' + label);
};

// ── 1a. THE POINT OF USE, app side: the screen really does drive setChurch, on every reconnect tick ─────
test('the screen that makes a church active calls setChurch with it, and re-runs on the reconnect tick', () => {
  // DECIDES FIRST: `if (window.Fellowship && window.Fellowship.setChurch)`, inside the effect. The effect
  // body has exactly two statements and the first cannot return, so there is no earlier line that could
  // decide regardless of the call under test. app/*.jsx ships UNBUNDLED, so `false && ` in front of a
  // condition leaves every word in place and a text match would still pass (CLAUDE.md rule 3) — this RUNS
  // the statement instead, with a useAE that invokes the callback and records the dependency list.
  // ANCHORED ON THE ONE COMMENT THAT IS UNIQUE TO THIS EFFECT. `useAE(() => {\n    const np = (churches…`
  // matches NINE effects in this file — the first of them is the membership heartbeat — so the obvious
  // anchor silently slices the wrong effect and every assertion below would be about the wrong code.
  // Uniqueness is asserted rather than assumed, so a drift fails loudly instead of quietly re-aiming.
  const anchor = '// scope outgoing chat to the active church';
  assert.equal(APPJSX.split(anchor).length - 1, 1,
    'the anchor for the set-church effect is no longer unique in app/app.jsx — re-anchor this test');
  const call = stmt(APPJSX, anchor, 'the set-church effect');
  const asked = [];
  let deps = null;
  const useAE = (fn, d) => { deps = d; fn(); };
  const windowStub = { Fellowship: { setChurch: (n) => asked.push(n) } };
  const list = [{ id: 'other', npub: 'npubother' }, { id: 'active', npub: 'npubactive' }];
  new Function('useAE', 'window', 'churches', 'activeChurch', 'connTick', call)(
    useAE, windowStub, list, 'active', 7);

  assert.deepEqual(asked, ['npubactive'],
    'the screen did not hand the active church to Fellowship.setChurch: ' + JSON.stringify(asked) +
    '. setChurch is the path into the kind-10002 read, so deleting that call deletes the feature from the ' +
    'PRODUCT while the engine would still pass its own tests.');
  // AND IT RE-RUNS ON THE RECONNECT TICK. This is the whole reason the engine adds no second listener and no
  // second 90-second timer: foregrounding, `online`, the native resume, a PIN unlock's `trinity-reconnect`
  // and the advisory `trinity-relay-returned` all bump connTick through the app's ONE reconnect scheduler,
  // so they reach setChurch already debounced and jittered. Drop connTick from these deps and every churn
  // signal stops reaching the church's relay list.
  assert.ok(Array.isArray(deps), 'the effect was registered without a dependency list');
  assert.ok(deps.includes(7),
    'the set-church effect no longer depends on connTick (deps were ' + JSON.stringify(deps) + '), so a ' +
    'foregrounding, a PIN unlock or a returning relay no longer re-reads the church\'s signed relay list');
});

// ── 1b. THE POINT OF USE, engine side: the relay added afterwards arrives, with no re-follow ────────────
test('a member who followed before the box existed gets it on the next launch, without re-following', async () => {
  // DECIDES FIRST: `const cp = toPub(churchNpub); if (!cp) return () => {}` in subscribeChurchRelays —
  // reached only because setChurch called _watchChurchRelays. The only thing that can decide before it is
  // _watchChurchRelays' own `if (!cp)`, and cp is this church. No earlier line could make this pass with the
  // trigger removed: every assertion is on `_churchRelays` or on the member's relay list, both of which
  // start empty here and are written by nothing else in this test.
  const store = memStore();
  // THE PHONE AS IT WAS WHEN THEY FOLLOWED: the shared pool, and nothing else. No invite is replayed,
  // adoptInviteRelays is not lifted at all, and nothing in this test follows a church.
  const app = memberOn({
    church, relays: [secure(SHARED.wsUrl)], canonical: [secure(SHARED.wsUrl)],
    pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] }, store,
  });
  try {
    await H.publishAll(SHARED, [joinDoc(app.me, church.pub)]);
    await H.publishAll(BOX, [joinDoc(app.me, church.pub)]);
    assert.equal(app.relays().includes(secure(BOX.wsUrl)), false,
      'precondition: this phone must not already know the box');
    assert.equal(app.churchBoxes.has(church.pub), false,
      'precondition: _churchRelays must be empty, which is what it is on a real launch today');

    // THE CHURCH ADDS A BOX, AFTER the member followed: the document the console publishes
    // (steward.src.js:publishRelayList), signed by the church key, on the relay the member already has.
    await H.publishAll(SHARED, [relayList(church, [SHARED.wsUrl, BOX.wsUrl])]);

    // …and the member simply opens the app. ONE call, the one the screen makes.
    tickOn(app, church.npub);
    app.setChurch(church.npub);

    // THE READ MUST NOT HAVE THROWN. `_watchChurchRelays` calls it inside a try/catch — correctly, so a
    // broken read can never take the app's church-switch down with it — which means a ReferenceError in the
    // read is INVISIBLE and looks exactly like a church that published nothing. Captured and asserted here
    // rather than diagnosed from a timeout.
    await until(() => app.relays().includes(secure(BOX.wsUrl)) || app.counts.err,
      'the church\'s box to reach the member\'s relay list');
    assert.equal(app.counts.err, undefined, 'the church-relay read threw: ' + app.counts.err);
    assert.ok(app.churchBoxes.get(church.pub) && app.churchBoxes.get(church.pub).has(secure(BOX.wsUrl)),
      '_churchRelays did not record the box, so relaysForChurch cannot read over it');
    assert.equal(app.churchBoxes.get(church.pub).get(secure(BOX.wsUrl)), BOX.relayPub,
      'the box was recorded without its identity key, so it can never count towards self-sufficiency');

    // AND IT IS REALLY USED, not merely remembered. The gate has to admit it before the member publishes
    // anything over it, and that is the shipped gate proving a real nonce against a real box.
    await app.gate.refresh(app.churchRelaysRaw(), church.pub);
    await until(() => app.relaysForChurch(church.pub).includes(secure(BOX.wsUrl)),
      'the box to join the read set for this church');
    assert.ok(app.publishSetFor(church.pub).includes(secure(BOX.wsUrl)),
      'the box is in the list but not in the publish set, so nothing the member writes reaches it');
    assert.equal(app.relayVerified(secure(BOX.wsUrl)), true,
      'the Relays sheet would still show the church\'s own box as not carrying its traffic');
    // ONE BOX IS NOT SELF-SUFFICIENCY: the shared pool stays, which is what keeps this member readable.
    assert.ok(app.relaysForChurch(church.pub).includes(secure(SHARED.wsUrl)),
      'adopting ONE box dropped the shared pool — relaysForChurch requires >=2 distinct boxes before it may');
  } finally { app.close(); }
});

// ── 2. A CHURCH THAT DOES NOT SELF-HOST IS COMPLETELY UNAFFECTED ────────────────────────────────────────
test('a church with no box of its own is left exactly as it was — publishing no list, and publishing one that names only the shared pool', async () => {
  // DECIDES FIRST, case A: nothing — no kind-10002 exists, the read's EOSE arrives and `onevent` never runs.
  // Case B: the `want` filter's `!CANONICAL_RELAYS.includes(t[1])`, which is the line that makes a
  // shared-pool-only list a no-op. Neither case can pass vacuously: the trigger demonstrably runs in both,
  // because the subscription count asserted at the end is 1 and it is 0 without the trigger.
  for (const [label, list] of [['no relay list at all', null], ['a list naming only the shared pool', true]]) {
    const plain = H.key(); plain.npub = npubEncode(plain.pub);
    const PLAIN = await H.startRelay({ name: 'PLAIN', churches: [plain.pub] });
    const app = memberOn({
      church: plain, relays: [secure(PLAIN.wsUrl)], canonical: [secure(PLAIN.wsUrl)],
      pins: { [secure(PLAIN.wsUrl)]: [PLAIN.relayPub] },
    });
    try {
      await H.publishAll(PLAIN, [joinDoc(app.me, plain.pub)]);
      if (list) await H.publishAll(PLAIN, [relayList(plain, [PLAIN.wsUrl])]);
      // The gate first, so the read goes over a relay that can answer — the quiet result below is then a
      // real quiet result and not an unasked question.
      await app.gate.refresh(app.churchRelaysRaw(), plain.pub);
      assert.ok(app.churchRelays().length > 0, label + ': precondition — the member must have a usable relay');
      const before = [...app.relays()];

      tickOn(app, plain.npub);
      app.setChurch(plain.npub);
      // Long enough for the REQ, its EOSE and a NIP-11 probe per declared relay. Test 1b adopts in well
      // under this against the same harness.
      await sleep(4000);

      assert.deepEqual(app.relays(), before,
        label + ': the member\'s relay list changed for a church that has no box of its own');
      assert.equal(app.churchBoxes.has(plain.pub), false,
        label + ': _churchRelays gained an entry for a church with no box. That map drives the ' +
        'self-sufficiency count, so a stray entry is how the shared pool gets dropped from under a church ' +
        'that depends on it.');
      assert.equal(app.counts.add, 0, label + ': a relay was ADDED for a non-self-hosting member');
      assert.equal(app.counts.remove, 0, label + ': a relay was REMOVED from a non-self-hosting member\'s list');
      assert.equal(app.pool.counts.poolClose, 0, label + ': a socket was closed under a non-self-hosting member');
      assert.equal(app.store.getItem('trinityone.churchboxes'), null,
        label + ': a box list was persisted for a church with no box');
      assert.ok(app.relaysForChurch(plain.pub).includes(secure(PLAIN.wsUrl)),
        label + ': the shared pool is no longer in this member\'s read set');
      assert.equal(app.relaysHealthy(), true, label + ': a church with no box of its own now reads as unhealthy');
      assert.ok(app.pool.counts.opened >= 1,
        label + ': the read never ran at all, so this case proves nothing about a church being unaffected');
    } finally { app.close(); PLAIN.stop(); }
  }
});

// ── 3. A READ THAT TIMES OUT LEAVES THE MEMBER ON THE SHARED RELAYS, AND NEVER BLANK ────────────────────
test('a declared box that never answers adopts nothing, and the member keeps the shared relays', async () => {
  // DECIDES FIRST: `if (!info || info.enforces !== true) return` in _applyChurchList — the capability gate,
  // reached only after `_relayInfo` has genuinely timed out against a box that accepts the connection and
  // never replies. Deliberately NOT a refused connection, which returns in microseconds: the box below holds
  // the socket open, so the 6.5s hard timeout inside _relayInfo is what ends the probe. The `at < seen` and
  // future-dated guards cannot decide here — the list is fresh and is the only one.
  const HANG = await H.startImpostor({ name: 'HANG', handler: () => { /* accept, and never answer */ } });
  const hangWss = secure(HANG.base.replace(/^http:\/\//i, 'ws://')) + '/relay';
  const app = memberOn({
    church, relays: [secure(SHARED.wsUrl)], canonical: [secure(SHARED.wsUrl)],
    pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] },
  });
  try {
    await H.publishAll(SHARED, [joinDoc(app.me, church.pub)]);
    await H.publishAll(SHARED, [relayList(church, [SHARED.wsUrl, hangWss])]);
    await app.gate.refresh(app.churchRelaysRaw(), church.pub);
    assert.ok(app.relaysForChurch(church.pub).includes(secure(SHARED.wsUrl)),
      'precondition: the member can read over the shared pool');

    tickOn(app, church.npub);
    app.setChurch(church.npub);
    await sleep(11000);   // > the 6.5s hard timeout in _relayInfo plus its 6s abort, with room for a retry

    assert.equal(app.relays().includes(hangWss), false,
      'an address that never answered was adopted anyway — every later pass now dials a dead box for ever');
    assert.equal(!!(app.churchBoxes.get(church.pub) && app.churchBoxes.get(church.pub).has(hangWss)), false,
      'a box that never answered was counted in _churchRelays, which is what decides whether the shared ' +
      'pool may be dropped');
    // THE THING THAT MUST NOT HAPPEN: an empty read set behind a screen that looks completely normal.
    const readAfter = app.relaysForChurch(church.pub);
    assert.ok(readAfter.length > 0,
      'the member\'s read set is EMPTY after a timed-out read — this is the blank-screen class; group chat, ' +
      'DMs, reactions and profiles are all read over this set');
    assert.ok(readAfter.includes(secure(SHARED.wsUrl)),
      'the member lost the shared pool because a box their church declared did not answer');
    assert.ok(app.churchRelays().length > 0, 'the publish set is empty after a timed-out read');
    assert.equal(app.relaysHealthy(), true, 'a timed-out probe made a healthy connection read as unhealthy');
  } finally { app.close(); HANG.stop(); }
});

// ── 4. OVERLAPPING AND RE-ENTRANT RUNS: ONE LIVE READ, AND THE PREVIOUS ONE IS CLOSED ───────────────────
test('repeated ticks open one read, a re-entrant tick opens none, and a church switch closes the one before', async () => {
  // DECIDES FIRST, in this order: `if (_crOpening) return _crWatch` (re-entrancy), then `if (!cp)`, then the
  // settle/cooldown floors. The counters below are on the pool object the shipped code is handed and on the
  // real listener bookkeeping in `window`, so none of them can be satisfied by anything but the code running.
  const other = H.key(); other.npub = npubEncode(other.pub);
  const OTHER = await H.startRelay({ name: 'OTHER', churches: [other.pub] });
  const app = memberOn({
    church, relays: [secure(SHARED.wsUrl), secure(OTHER.wsUrl)],
    canonical: [secure(SHARED.wsUrl)], pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] },
  });
  try {
    await H.publishAll(SHARED, [joinDoc(app.me, church.pub)]);
    await app.gate.refresh(app.churchRelaysRaw(), church.pub);
    assert.ok(app.churchRelays().length > 0,
      'precondition: the read must go over at least one relay, or the settle floor is not the line being tested');

    // (i) THE RE-ENTRANT TICK. `addRelay` -> `setRelays` dispatches `trinity-relays` SYNCHRONOUSLY, and the
    // gate's own onChange dispatches `trinity-relay-returned`, which the app turns into another tick — so a
    // tick really can arrive while a read is being opened. Staged with the real event, fired from inside the
    // open, with the app's real response to it (another setChurch).
    app.pool.onSubscribe(() => { app.win.dispatchEvent(new Ev('trinity-relays', { detail: [] })); });
    app.win.addEventListener('trinity-relays', () => { app.setChurch(church.npub); });
    app.setChurch(church.npub);
    assert.equal(app.pool.counts.opened, 1,
      'a re-entrant tick opened ' + app.pool.counts.opened + ' reads. Each one is a pool subscription plus a ' +
      '`trinity-relays` listener, and the gate feeds that event itself — this is the storm.');

    // (ii) REPEATED TICKS FOR THE SAME CHURCH. The effect's `churches` dep is memoised on the STORED list,
    // which is rewritten whenever a church's kind-0 profile merges in, so this happens on every real launch.
    for (let i = 0; i < 8; i++) app.setChurch(church.npub);
    assert.equal(app.pool.counts.opened, 1,
      'eight ticks for the same church opened ' + app.pool.counts.opened + ' reads — the settle floor is gone');
    assert.equal(app.win.listenerCount('trinity-relays'), 2,
      'the churn listeners have piled up: ' + app.win.listenerCount('trinity-relays') + ' on `trinity-relays` ' +
      '(this test installs one of its own, so 2 is the correct total). Each leaked one re-drives ' +
      '_applyChurchList for ever.');

    // (iii) A CHURCH SWITCH IS NOT RATE-LIMITED, AND IT CLOSES THE READ BEFORE IT. The member is looking at
    // a different congregation, whose list this device may never have read.
    app.setChurch(other.npub);
    assert.equal(app.pool.counts.opened, 2, 'switching church did not open a read for the new church');
    assert.equal(app.pool.counts.closed, 1,
      'switching church left the previous church\'s subscription OPEN. That is one leaked subscription and ' +
      'one leaked listener per switch, which is worse than the bug this branch fixes.');
    assert.equal(app.win.listenerCount('trinity-relays'), 2,
      'the previous read\'s churn listener was not removed on the switch');
    assert.equal(app.watch() && app.watch().cp, other.pub, 'the live read is not the active church\'s');

    // (iv) AND CLEARING THE CHURCH CLOSES IT. app.jsx passes null when no church is active.
    app.setChurch(null);
    assert.equal(app.pool.counts.closed, 2, 'clearing the active church left its read open');
    assert.equal(app.watch(), null, 'the watch survived the church being cleared');
    assert.equal(app.win.listenerCount('trinity-relays'), 1,
      'clearing the active church left its churn listener installed (only this test\'s own should remain)');
  } finally { app.close(); OTHER.stop(); }
});

// ── 4b. BOTH FLOORS, EACH IN THE ONLY STATE THAT CAN FALSIFY IT ────────────────────────────────────────
// ADDED AFTER SABOTAGE, which is the point of sabotage. Blinding the SETTLE floor and deleting the REREAD
// floor both left the file above completely green: test 4's eight ticks all land in the first milliseconds,
// where whichever floor survives still swallows them. So each floor is asked here in the one state where it
// is the ONLY thing that can decide.
test('a tick is swallowed while the read is too young to judge, and while it is working — and only then', async () => {
  // DECIDES FIRST: `if (_crOpening) return _crWatch` (not in play — no tick here arrives during an open),
  // then `if (!cp)` (cp is this church), then `if (same && _crWatch.over > 0)`. Inside that block the two
  // floors decide in order, and each half below is staged so the OTHER floor cannot be what returns:
  //   · part 1 the read is YOUNG and UNHEALTHY, so the reread floor's `_crHealthy()` is false and only the
  //     settle floor can swallow the tick;
  //   · part 2 the read is OLDER than the settle floor and HEALTHY, so only the reread floor can.
  const DOWN = await H.startRelay({ name: 'DOWN', churches: [church.pub] });
  const appA = memberOn({
    church, relays: [secure(DOWN.wsUrl)], canonical: [secure(DOWN.wsUrl)],
    pins: { [secure(DOWN.wsUrl)]: [DOWN.relayPub] },
  });
  try {
    // Proved while it was up, so the gate's cache still admits it — which is exactly the real case: the
    // 30-day verified set means a box that has died is still a candidate (RELAY-ADMISSION, trap 5).
    await H.publishAll(DOWN, [joinDoc(appA.me, church.pub)]);
    await appA.gate.refresh(appA.churchRelaysRaw(), church.pub);
    assert.ok(appA.churchRelays().length > 0, 'precondition: the box must be admitted before it is killed');
    DOWN.stop();
    await sleep(500);
    assert.equal(appA.relaysHealthy(), false,
      'precondition: with its only box dead the read must look UNHEALTHY, or the settle floor is not the ' +
      'line being tested here');
    appA.setChurch(church.npub);
    assert.equal(appA.pool.counts.opened, 1, 'the first tick did not open a read at all');
    appA.setChurch(church.npub);
    appA.setChurch(church.npub);
    assert.equal(appA.pool.counts.opened, 1,
      'a tick inside the settle window re-opened the read (' + appA.pool.counts.opened + ' opens). A read ' +
      'whose socket has not finished opening reads as unhealthy, and the launch tick arrives while that is ' +
      'true — without this floor the first second of every launch opens and closes a read per tick.');
    // …AND THE FLOOR IS A FLOOR, NOT A BLOCK: once past it, a read that cannot be hearing anything IS
    // re-opened. This is the PIN-unlock case — reconnectAll() closed every socket the read owned.
    await sleep(CRSETTLE + 400);
    appA.setChurch(church.npub);
    assert.equal(appA.pool.counts.opened, 2,
      'a dead read was never re-opened. After a PIN unlock the sockets this read owns are gone, and ' +
      'nothing else re-establishes it until the 90-second beat.');
  } finally { appA.close(); }

  // PART 2: healthy, past the settle floor, inside the re-read window.
  const appB = memberOn({
    church, relays: [secure(SHARED.wsUrl)], canonical: [secure(SHARED.wsUrl)],
    pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] },
  });
  try {
    await H.publishAll(SHARED, [joinDoc(appB.me, church.pub)]);
    await appB.gate.refresh(appB.churchRelaysRaw(), church.pub);
    appB.setChurch(church.npub);
    assert.equal(appB.pool.counts.opened, 1, 'the first tick did not open a read at all');
    await until(() => appB.relaysHealthy() === true, 'the read\'s socket to come up', 15000);
    await sleep(CRSETTLE + 400);
    assert.equal(appB.relaysHealthy(), true,
      'precondition: the read must be WORKING here, or the settle floor is what returns and the re-read ' +
      'floor is untested');
    appB.setChurch(church.npub);
    assert.equal(appB.pool.counts.opened, 1,
      'a healthy read was re-opened ' + appB.pool.counts.opened + ' times inside the re-read window. Every ' +
      'foregrounding, `online` and returning relay reaches setChurch, so without this floor each of them ' +
      'tears down and re-opens a subscription that is already receiving.');
  } finally { appB.close(); }
});

// ── 5. NO REMOVE/RE-ADD LOOP ────────────────────────────────────────────────────────────────────────────
test('re-reading the same newest list revokes nothing and closes no socket, however often it runs', async () => {
  // DECIDES FIRST: `if (at < seen) return` — an equal timestamp is deliberately NOT older, because
  // re-applying the CURRENT list is what makes adoption survive a restart. So each re-read really does reach
  // _applyChurchList's revocation pass, which is the only reason this test can fail. The counters are on the
  // shipped `removeRelay` and on `pool.close` — the two things _maybeDropRelay calls.
  const other = H.key(); other.npub = npubEncode(other.pub);
  const app = memberOn({
    church, relays: [secure(SHARED.wsUrl)], canonical: [secure(SHARED.wsUrl)],
    pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] },
  });
  try {
    await H.publishAll(SHARED, [joinDoc(app.me, church.pub)]);
    await H.publishAll(SHARED, [relayList(church, [SHARED.wsUrl, BOX.wsUrl])]);
    tickOn(app, church.npub);
    app.setChurch(church.npub);
    await until(() => app.relays().includes(secure(BOX.wsUrl)), 'the box to be adopted once');
    const addsAfterFirst = app.counts.add;

    // Drive the read again and again. Switching away and back is what a member with two churches does, and
    // it is also the one thing that legitimately bypasses the floors — so this is the harshest honest way to
    // ask the question.
    for (let i = 0; i < 6; i++) {
      app.setChurch(other.npub);
      app.setChurch(church.npub);
      await sleep(300);
    }
    await sleep(2000);

    assert.equal(app.counts.remove, 0,
      'the re-read REMOVED a relay ' + app.counts.remove + ' time(s). _applyChurchList revokes anything in ' +
      '_churchRelays that is not in the newest list, so a re-read that disagrees with itself produces a ' +
      'remove/re-add loop with a pool.close on every churn — the shape an audit found on the console side.');
    assert.equal(app.pool.counts.poolClose, 0, 'the re-read closed a socket');
    assert.equal(app.counts.add, addsAfterFirst,
      'the re-read ADDED the box again (' + app.counts.add + ' adds, ' + addsAfterFirst + ' after the first ' +
      'adoption). Every add dispatches `trinity-relays` and re-drives the gate, so a re-add loop is also a ' +
      're-proof loop.');
    assert.ok(app.relays().includes(secure(BOX.wsUrl)), 'the box fell out of the list across the re-reads');
    assert.equal(app.churchBoxes.get(church.pub).size, 1, '_churchRelays grew or shrank across the re-reads');
  } finally { app.close(); }
});

// ── 6. TWO BOXES: THE SHARED POOL STAYS — CHANGED IN MEANING 2026-10-26, NOT REMOVED (rule 8) ───────────
// This test used to PIN the opposite: that a church with >=2 distinct own boxes lost the shared pool from its
// read set. Owner decision 2026-10-26 (audit D-2, consistent with 2026-10-23 "never isolate a church"): the
// shared servers are ALWAYS in a church's read and publish sets. If both boxes stop answering, the member still
// has somewhere to read - the blank-screen class the old note warned about.
test('adopting two boxes keeps the shared pool in the church\'s read set AND publish set', async () => {
  // DECIDES FIRST: the final return of relaysForChurch (CANONICAL_RELAYS appended unconditionally) and
  // `const canonical = CANONICAL_RELAYS` in publishSetFor. `own` is populated by the adoption this test
  // performs and is empty without it, so the two-box state is real.
  const app = memberOn({
    church, relays: [secure(SHARED.wsUrl)], canonical: [secure(SHARED.wsUrl)],
    pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] },
  });
  try {
    await H.publishAll(SHARED, [joinDoc(app.me, church.pub)]);
    await H.publishAll(SHARED, [relayList(church, [SHARED.wsUrl, BOX.wsUrl, BOX2.wsUrl])]);
    tickOn(app, church.npub);
    app.setChurch(church.npub);
    await until(() => {
      const m = app.churchBoxes.get(church.pub);
      return m && new Set([...m.values()].filter(Boolean)).size >= 2;
    }, 'both of the church\'s boxes to be adopted with distinct identity keys');
    await app.gate.refresh(app.churchRelaysRaw(), church.pub);
    await until(() => app.relaysForChurch(church.pub).includes(secure(BOX2.wsUrl)), 'the second box to be admitted');

    const distinct = new Set([...app.churchBoxes.get(church.pub).values()].filter(Boolean)).size;
    assert.ok(distinct >= 2, 'staging: the church must have two distinct boxes of its own or this proves nothing');
    const set = app.relaysForChurch(church.pub);
    assert.ok(set.includes(secure(SHARED.wsUrl)),
      'the shared pool was dropped from the READ set once the church had two boxes of its own: ' + JSON.stringify(set));
    assert.ok(set.includes(secure(BOX.wsUrl)) && set.includes(secure(BOX2.wsUrl)),
      'the church\'s own boxes are missing from the read set: ' + JSON.stringify(set));
    const pubSet = app.publishSetFor(church.pub);
    assert.ok(pubSet.includes(secure(SHARED.wsUrl)),
      'the shared pool was dropped from the PUBLISH set once the church had two boxes of its own: ' + JSON.stringify(pubSet));
  } finally { app.close(); }
});

// ── 7. THE SHARED SERVERS ARE ALWAYS IN, AND A WRITE LANDS ON THEM (owner 2026-10-26, audit D-2) ────────
// Two shared relays, two proved own boxes. EVERY canonical relay must be in the read set and the publish set, and
// a member write published over the publish set must be in a shared relay's own store. Test 6 above covers one
// shared relay; this is the "every" and the "lands" half. DECIDES: the canonical append in relaysForChurch and
// `const canonical = CANONICAL_RELAYS` in publishSetFor.
test('a church with two proved boxes of its own still has every shared relay in its read and publish sets, and a member write lands on a shared relay', async () => {
  const SHARED2 = await H.startRelay({ name: 'SHARED2', churches: [church.pub] });
  try {
    const canonical = [secure(SHARED.wsUrl), secure(SHARED2.wsUrl)];
    const app = memberOn({
      church, relays: [secure(SHARED.wsUrl)], canonical,
      pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub], [secure(SHARED2.wsUrl)]: [SHARED2.relayPub] },
    });
    try {
      await H.publishAll(SHARED, [joinDoc(app.me, church.pub)]);
      await H.publishAll(SHARED, [relayList(church, [SHARED.wsUrl, BOX.wsUrl, BOX2.wsUrl], now() + 30)]);
      tickOn(app, church.npub);
      app.setChurch(church.npub);
      await until(() => {
        const m = app.churchBoxes.get(church.pub);
        return m && new Set([...m.values()].filter(Boolean)).size >= 2;
      }, 'both of the church\'s boxes to be adopted with distinct identity keys');
      await app.gate.refresh(app.churchRelaysRaw(), church.pub);
      await until(() => app.relaysForChurch(church.pub).includes(secure(BOX2.wsUrl)), 'the second box to be admitted');

      const read = app.relaysForChurch(church.pub), pubSet = app.publishSetFor(church.pub);
      for (const u of canonical) {
        assert.ok(read.includes(u), 'shared relay ' + u + ' is not in the READ set of a two-box church: ' + JSON.stringify(read));
        assert.ok(pubSet.includes(u), 'shared relay ' + u + ' is not in the PUBLISH set of a two-box church: ' + JSON.stringify(pubSet));
      }
      assert.ok(pubSet.includes(secure(BOX.wsUrl)) && pubSet.includes(secure(BOX2.wsUrl)), 'the church\'s own boxes left the publish set: ' + JSON.stringify(pubSet));

      const w = finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/member:' + church.pub], ['t', 'trinityone'], ['church', church.pub]], content: '{"hb":1}' }, app.me.sk);
      await Promise.allSettled(app.pool.publish(pubSet, w));
      const on = async (r) => (await H.readAs(r, app.me, { kinds: [30078], authors: [app.me.pub], '#d': ['trinityone/member:' + church.pub] })).some(e => e.id === w.id);
      assert.ok(await on(SHARED2), 'the member\'s write is not in the second shared relay\'s store');
      assert.ok(await on(SHARED), 'the member\'s write is not in the first shared relay\'s store');
    } finally { app.close(); }
  } finally { try { SHARED2.stop(); } catch (e) {} }
});
