// A MEMBER KEEPS THE ADDRESSES ITS CHURCH SIGNED, INSTEAD OF READING THEM FOR THE KEYS AND THROWING THEM AWAY.
// Relay address gossip, step 1 — the MEMBER half (TrinityOne-internal/PLAN-relay-address-gossip-2026-10-22 §4).
// The mirror of scripts/a-second-console-learns-its-church-box.test.mjs (console, commit b759bfa4).
// Run: node --test scripts/a-member-adopts-its-churchs-signed-relay.test.mjs
//
// THE MEASURED DEFECT. 2026-10-22, two phones against live relays: a church's own relay was learned by one
// device and never by an EXISTING member of the same church. `src/fellowship.src.js:churchRelayNet` already
// reads the church's signed relay-net document (d = trinityone/relay-net), which carries each box's pubkey
// AND url — but it was read for the admission gate's `netEntries` dep alone: the KEY admitted and the ADDRESS
// was thrown away, so a member could admit a box it had no way to dial. `adoptChurchNetDocAddresses` keeps
// the address, driven fire-and-forget from the shipped `setChurch` on every launch/foreground/unlock tick.
//
// HOW THIS FILE IS DRIVEN, and it is the part that matters. Every relay here is a real `node
// scripts/gateway.mjs` process (scripts/relay-network-harness.mjs). Nothing injects an answer for
// `churchRelayNet`, `netEntries`, `verify` or `one`: the signed document is PUBLISHED to a real box and read
// back off the wire, every proof is a real /relay-identity nonce exchange against a real relay key, and every
// admission is the shipped gate. THE ONE THING FAKED IS TLS, exactly as the two sibling tests fake it: a
// gateway on a bound loopback port has no certificate, and the member refuses a cleartext relay out of a
// church list, so a `fetch` and a pool rewrite `wss://127.0.0.1:…` → `ws://…` AT THE TRANSPORT and nothing
// else. What is stubbed is the wire, not any answer.
//
// THE POINT OF USE (CLAUDE.md rule 1) is test 1: the shipped `setChurch` is lifted out of vendor/fellowship.js
// and RUN on a member who followed BEFORE the box existed and does NOT re-follow. Delete the
// `adoptChurchNetDocAddresses(…)` call from setChurch and test 1 goes red (proved in SABOTAGE below). Nothing
// here asserts behaviour by matching text in app/*.jsx (CLAUDE.md rule 3) — the one thing the file turns on is
// asserted present in the SLICE that is about to be executed, and then executed.
//
// SABOTAGE RECORD, 2026-10-23. Each scoped to the construct under test (the enclosing function sliced out of
// `git show HEAD:src/fellowship.src.js` once committed, the anchor asserted to appear exactly once inside it,
// then replaced), vendor rebuilt, the sabotage confirmed present in vendor/fellowship.js, the one affected
// test run. Caught, with the case that went red:
//   · the adopt call neutered in setChurch (passes null)                 → 1
//   · the `proof.relayPub === e.pubkey` key match blinded (always true)  → 4
//   · the `_isNetworkRelay` admit blinded (ok forced true)               → 7
//   · `_alreadyAMemberCandidate` blinded (always false)                  → 5
//   · the cap (`>= MEMBER_NETDOC_ADOPT_MAX`) blinded                     → 6
// The admit is caught by test 7, NOT by the hang case (test 3): on this base proveRelay returns the `software`
// root for ANY box proving a valid key, so every row that passes the key match is also admitted, and the one
// refusal the admit adds beyond the key match is proveRelay's front door — which test 7 is built to isolate.
// Test 3's hang is refused by `if (!proof) continue` before the admit is ever reached.
import { test, before, after } from 'node:test';
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
const FELLOW = read('vendor/fellowship.js');
const RELAY_NET_D = 'trinityone/relay-net';
const GROUP_D = 'trinityone/group:';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// THE CAP, READ OUT OF THE BUNDLE rather than typed here. A hand-copied tolerance constant is the drift this
// project has paid for once; a test that hard-coded 8 would silently stop testing the day the bound moved.
const CAP = new Function(stmt(FELLOW, 'var MEMBER_NETDOC_ADOPT_MAX = ', 'MEMBER_NETDOC_ADOPT_MAX')
  + '\nreturn MEMBER_NETDOC_ADOPT_MAX;')();
assert.ok(CAP > 0 && CAP < 1000, 'MEMBER_NETDOC_ADOPT_MAX read as a nonsense value: ' + JSON.stringify(CAP));

// ── the TLS shim, and nothing but ───────────────────────────────────────────────────────────────────────
const secure = (u) => String(u || '').replace(/^ws:\/\//i, 'wss://').replace(/^http:\/\//i, 'https://');
const wire = (u) => String(u || '').replace(/^wss:\/\/(127\.0\.0\.1[:/])/i, 'ws://$1').replace(/^https:\/\/(127\.0\.0\.1[:/])/i, 'http://$1');
// Every address the shipped code fetches, as it asked for it — so a test can say a box was never even dialled.
const FETCHED = [];
const netFetch = (u, o) => { FETCHED.push(String(u)); return globalThis.fetch(wire(typeof u === 'string' ? u : String(u)), o); };

// A real SimplePool with that rewrite on the way to the socket, plus the counters the no-churn questions need.
// Every list the shipped code assembles still arrives exactly as it assembled it.
function wirePool(signer) {
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
function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
class Ev { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } }
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
  };
}
// Anything the lift asks for that is not stubbed raises a ReferenceError naming it, rather than arriving as
// undefined and being swallowed by one of the many try/catch blocks in this code — which is how a lift
// silently stops testing anything.
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
// CANONICAL_RELAY_PUBS is NOT lifted (it is the shipped pin table pointing at app.trinityone.church, which no
// test can stand up); it is injected, so "the shared pool" below is a real relay on a bound port with a real key.
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
// The launch path out of vendor/fellowship.js: the shipped setChurch, the shipped relay-net reader, the
// shipped adopt, the shipped gate, the shipped relay-list writer, and relaysForChurch/publishSetFor so the
// result is read off the real publish set. Nothing about which address is adopted — or when — is decided here.
function memberOn({ church, relays = [], canonical = [], pins = {}, store = memStore(), who = null }) {
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
  assert.doesNotMatch(adopt, /_churchRelays|_saveChurchBoxes|churchboxes/,
    'vendor/fellowship.js: adopt now writes _churchRelays / churchboxes — the remove/re-add churn the plan forbids');

  const win = fakeWindow();
  win.Fellowship = { relays: [...relays], churchPub: null, ready: Promise.resolve() };
  const setChurch = fnBody(src, 'setChurch(npubOrHex) {', 'setChurch');
  const setRelays = fnBody(src, 'setRelays(urls) {', 'setRelays');
  // THE ONE LINE THIS CHANGE ADDS, asserted present in the slice that is about to run — otherwise every
  // point-of-use assertion would be asking an unchanged setChurch to do something it never did.
  assert.equal(setChurch.split('adoptChurchNetDocAddresses(').length - 1, 1,
    'vendor/fellowship.js: setChurch no longer drives adoptChurchNetDocAddresses exactly once — the defect ' +
    'this change exists to fix, or a duplicate call');

  const scope = scopeOf({
    localStorage: store, window: win, pool, console, fetch: netFetch,
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
  });
  const api = new Function('scope', `with (scope) { ${body}
    const _api = { ${setChurch}, ${setRelays} };
    window.Fellowship.setRelays = (u) => _api.setRelays(u);
    window.Fellowship.addRelay = (u) => _api.setRelays([...window.Fellowship.relays, u]);
    return { setChurch: (n) => _api.setChurch(n),
             adopt: (cp) => { window.Fellowship.churchPub = cp; return adoptChurchNetDocAddresses(cp); },
             dial: _netDocDialUrl,
             churchRelays, churchRelaysRaw, relaysForChurch, publishSetFor,
             gate: _gate }; }`)(scope);
  api.pool = pool;
  api.me = me;
  api.win = win;
  api.store = store;
  api.relays = () => win.Fellowship.relays;
  api.close = () => { try { pool.shutdown(); } catch (e) {} };
  return api;
}

// ── fixtures: the church's own signed documents, published to real boxes ────────────────────────────────
const now = () => Math.floor(Date.now() / 1000);
const joinDoc = (who, cp) => finalizeEvent(
  { kind: 30078, created_at: now(), tags: [['d', 'trinityone/member:' + cp], ['t', 'trinityone'], ['church', cp]], content: '{}' }, who.sk);
// A relayable (replaceable) event: a relay refuses an older-or-equal copy, so several tests here publish a new
// relay-net document to the same box within the same second and the stamp is stepped by hand.
let _docAt = Math.floor(Date.now() / 1000);
const relayNetDocFor = (church, rows) => finalizeEvent(
  { kind: 30078, created_at: ++_docAt, tags: [['d', RELAY_NET_D], ['t', 'trinityone']], content: JSON.stringify(rows) }, church.sk);

let church, SHARED, BOX;
before(async () => {
  church = H.key();
  church.npub = npubEncode(church.pub);
  SHARED = await H.startRelay({ name: 'SHARED', churches: [church.pub] });
  BOX = await H.startRelay({ name: 'BOX', churches: [church.pub] });
  assert.notEqual(SHARED.relayPub, BOX.relayPub, 'the two relays must be two separate boxes or nothing below means anything');
});
// A force-exit that cannot change the verdict: a wedged socket (test 3's hanging box) is in no hurry to be
// collected, and a file that never exits reads from a runner as NO ANSWER rather than a bad one.
after(() => {
  H.stopAll();
  try { setTimeout(() => process.exit(process.exitCode || 0), 10000).unref(); } catch (e) {}
});

const until = async (pred, label, ms = 25000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(100); }
  assert.fail('timed out waiting for: ' + label);
};

// ── 1. THE POINT OF USE (rule 1) ────────────────────────────────────────────────────────────────────────
test('a member who followed before the box existed gets it in the relay list, read set AND publish set, without re-following', async () => {
  // DECIDES FIRST: the `try { const _p = adoptChurchNetDocAddresses(...) }` statement inside the shipped
  // setChurch. It is the LAST statement in the body and nothing before it can add a relay — _watchChurchRelays
  // is stubbed to a no-op and reads a different document anyway, and the member followed with only the shared
  // pool. So the box can only reach the list through the line under test. Inside adopt the lines before the
  // key match only `continue`/`break` here (the cap: the store has one entry; the conversion: BOX.wsUrl is
  // already dialable; the canonical/dedup checks: BOX is neither shared nor listed), so the OUTCOME is decided
  // by the key match and then `await isNetworkRelay(...)` — two real round trips, both driven as refusals by
  // tests 3 and 4 below.
  const store = memStore();
  // THE PHONE AS IT WAS WHEN THEY FOLLOWED: the shared pool, and nothing else. No invite is replayed and
  // nothing in this test follows a church.
  const app = memberOn({
    church, relays: [secure(SHARED.wsUrl)], canonical: [secure(SHARED.wsUrl)],
    pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] }, store,
  });
  try {
    await H.publishAll(SHARED, [joinDoc(app.me, church.pub)]);
    assert.equal(app.relays().includes(BOX.wsUrl), false, 'precondition: this phone must not already know the box');

    // THE CHURCH ADDS A BOX, AFTER the member followed: its own signed relay-net document, on the relay the
    // member already has. (Not a kind-10002 list — that is the sibling feature's document.)
    await H.publishAll(SHARED, [relayNetDocFor(church, [{ pubkey: BOX.relayPub, alwaysOn: true, url: BOX.wsUrl }])]);

    // …and the member simply opens the app. ONE call, the one the screen makes. Fire-and-forget, so poll.
    app.setChurch(church.npub);
    await until(() => app.relays().includes(BOX.wsUrl),
      'the church\'s box to reach the member\'s relay list');

    // IT IS REALLY USED, not merely listed: the gate must admit it before anything is published over it.
    await app.gate.refresh(app.churchRelaysRaw(), church.pub);
    await until(() => app.relaysForChurch(church.pub).includes(BOX.wsUrl), 'the box to join the read set');
    assert.ok(app.publishSetFor(church.pub).includes(BOX.wsUrl),
      'the box is in the list but not in the PUBLISH set, so nothing the member writes reaches it: ' +
      JSON.stringify(app.publishSetFor(church.pub)));
    // THE SHARED POOL IS NEVER DROPPED (owner decision 2026-10-23: a church is never isolated from it).
    assert.ok(app.relaysForChurch(church.pub).includes(secure(SHARED.wsUrl)),
      'adopting the box dropped the shared pool from the read set');
    assert.ok(app.publishSetFor(church.pub).includes(secure(SHARED.wsUrl)),
      'adopting the box dropped the shared pool from the publish set');
    // AND IT PERSISTED to the one store this change writes — trinityone.relays (RELAYS_KEY) — and ONLY there.
    const persisted = JSON.parse(app.store.getItem('trinityone.relays') || '[]');
    assert.ok(persisted.includes(BOX.wsUrl), 'the adopted box was not persisted to trinityone.relays');
    assert.equal(app.store.getItem('trinityone.churchboxes'), null,
      'this change wrote trinityone.churchboxes — it must be a candidate-only mirror of the console');
  } finally { app.close(); }
});

// ── 2. A CHURCH THAT DOES NOT SELF-HOST IS COMPLETELY UNAFFECTED ─────────────────────────────────────────
test('a church with no relay-net doc, and one naming only the shared pool, is left exactly as it was', async () => {
  // DECIDES FIRST, case A (no doc): the read's EOSE arrives and `entries` is empty, so the for-loop body never
  // runs. Case B (shared-pool-only): `if (CANONICAL_RELAYS.includes(u) || DEFAULT_RELAYS.includes(u)) continue`
  // — the line that makes a shared-pool entry a no-op. Neither is vacuous: the querySync counter asserted at
  // the end proves the read ran in both.
  for (const [label, rows] of [['no relay-net doc at all', null], ['a doc naming only the shared pool', 'shared']]) {
    const plain = H.key(); plain.npub = npubEncode(plain.pub);
    const PLAIN = await H.startRelay({ name: 'PLAIN', churches: [plain.pub] });
    const app = memberOn({
      church: plain, relays: [secure(PLAIN.wsUrl)], canonical: [secure(PLAIN.wsUrl)],
      pins: { [secure(PLAIN.wsUrl)]: [PLAIN.relayPub] },
    });
    try {
      await H.publishAll(PLAIN, [joinDoc(app.me, plain.pub)]);
      // The shared pool is named in its CANONICAL spelling — the compiled pool is always wss:// — so the
      // `CANONICAL_RELAYS.includes(u)` skip is what makes this a no-op (the deciding line for case B).
      if (rows === 'shared') await H.publishAll(PLAIN, [relayNetDocFor(plain, [{ pubkey: PLAIN.relayPub, alwaysOn: true, url: secure(PLAIN.wsUrl) }])]);
      const before = [...app.relays()];
      const queriedBefore = app.pool.counts.queried;

      const added = await app.adopt(plain.pub);

      assert.deepEqual(added, [], label + ': something was adopted for a church with no box of its own');
      assert.deepEqual(app.relays(), before, label + ': the member\'s relay list changed');
      assert.equal(app.pool.counts.poolClose, 0, label + ': a socket was closed under a non-self-hosting member');
      assert.equal(app.store.getItem('trinityone.churchboxes'), null, label + ': a box list was persisted');
      assert.ok(app.pool.counts.queried > queriedBefore,
        label + ': the relay-net document was never read at all, so this case proves nothing about being unaffected');
    } finally { app.close(); PLAIN.stop(); }
  }
});

// ── 3. A DECLARED BOX THAT HANGS IS NOT ADOPTED ─────────────────────────────────────────────────────────
test('a declared box that accepts the connection but never answers /relay-identity is not adopted', async () => {
  // DECIDES FIRST: `if (!proof) continue` — reached only after verifyRelayIdentityDetailed's own 6.5s timeout
  // fires against a box that accepts the HTTP request and never responds. The conversion succeeds, the two
  // shared/dedup checks are false, so the proof is the only thing that can refuse this row.
  const HANG = await H.startImpostor({ name: 'HANG', handler: () => { /* accept the request, never answer */ } });
  const hangWss = secure(HANG.base.replace(/^http:\/\//i, 'ws://')) + '/relay';
  const app = memberOn({
    church, relays: [secure(SHARED.wsUrl)], canonical: [secure(SHARED.wsUrl)],
    pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] },
  });
  try {
    await H.publishAll(SHARED, [joinDoc(app.me, church.pub)]);
    await H.publishAll(SHARED, [relayNetDocFor(church, [{ pubkey: BOX.relayPub, alwaysOn: true, url: hangWss }])]);
    assert.notEqual(app.dial(hangWss), '', 'the conversion dropped the address, so this test would prove nothing');

    const added = await app.adopt(church.pub);

    assert.deepEqual(added, [], 'a box that never answered was adopted — every later read then dials a dead box for ever');
    assert.equal(app.relays().includes(hangWss), false, 'the hung address joined the candidate list');
    // THE MEMBER STAYS ON THE SHARED RELAYS, with a non-empty read set.
    await app.gate.refresh(app.churchRelaysRaw(), church.pub);
    const readAfter = app.relaysForChurch(church.pub);
    assert.ok(readAfter.length > 0, 'the member\'s read set is empty after a hung probe — the blank-screen class');
    assert.ok(readAfter.includes(secure(SHARED.wsUrl)), 'the member lost the shared pool because a declared box hung');
  } finally { app.close(); HANG.stop(); }
});

// ── 4. TRAP 2: ADMISSION IS THE KEY, NEVER THE URL ──────────────────────────────────────────────────────
test('a box answering at the declared address with a DIFFERENT key than the doc names is not adopted', async () => {
  // RELAY-ADMISSION trap 2. The document names a key no box holds, at an address where a REAL, healthy relay
  // answers with a DIFFERENT one (BOX's own). Nothing may be adopted — and if it were, the url would have
  // decided. DECIDES FIRST: the conversion keeps BOX.wsUrl (asserted), shared/dedup are false, so the key
  // match (`proof.relayPub !== e.pubkey`) is what refuses; `isNetworkRelay` is never reached.
  await H.publishAll(SHARED, [relayNetDocFor(church, [{ pubkey: 'f'.repeat(64), alwaysOn: true, url: BOX.wsUrl }])]);
  const app = memberOn({
    church, relays: [secure(SHARED.wsUrl)], canonical: [secure(SHARED.wsUrl)],
    pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] },
  });
  try {
    await H.publishAll(SHARED, [joinDoc(app.me, church.pub)]);
    assert.equal(app.dial(BOX.wsUrl), BOX.wsUrl, 'the conversion dropped the address, so this test proves nothing');
    const added = await app.adopt(church.pub);
    assert.deepEqual(added, [],
      'a box whose key the church never signed was adopted. The document named ' + 'f'.repeat(8) + '… and the ' +
      'address proves ' + BOX.relayPub.slice(0, 8) + '… — so the URL decided, which is what trap 2 forbids.');
    assert.equal(app.relays().includes(BOX.wsUrl), false, 'the candidate list grew anyway');
  } finally { app.close(); }
});

// ── 5. IDEMPOTENCE / NO CHURN ───────────────────────────────────────────────────────────────────────────
test('running the adopt twice over the same doc adds nothing the second time and closes no socket', async () => {
  // DECIDES FIRST on the second pass: `if (_alreadyAMemberCandidate(u)) continue` — the box is now in
  // churchRelaysRaw() from the first pass, so this is the line that must refuse a second row. It decides
  // BEFORE the proof, which is the point: a duplicate must not even cost a probe, and adding a second row
  // would make setRelays churn the pool.
  await H.publishAll(SHARED, [relayNetDocFor(church, [{ pubkey: BOX.relayPub, alwaysOn: true, url: BOX.wsUrl }])]);
  const app = memberOn({
    church, relays: [secure(SHARED.wsUrl)], canonical: [secure(SHARED.wsUrl)],
    pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] },
  });
  try {
    await H.publishAll(SHARED, [joinDoc(app.me, church.pub)]);
    const first = await app.adopt(church.pub);
    assert.deepEqual(first, [BOX.wsUrl], 'staging fault: the first adopt did not add the box');
    const listAfterFirst = [...app.relays()];
    const closeBefore = app.pool.counts.poolClose;

    const second = await app.adopt(church.pub);
    assert.deepEqual(second, [], 'the same box was adopted a SECOND time: ' + JSON.stringify(app.relays()));
    assert.deepEqual(app.relays(), listAfterFirst, 'the candidate list changed on the idempotent second pass');
    assert.equal(app.pool.counts.poolClose, closeBefore, 'the idempotent second pass closed a socket — the remove/re-add churn the plan forbids');
  } finally { app.close(); }
});

// ── 6. THE CAP, AND DEDUP UNDER SPELLINGS ───────────────────────────────────────────────────────────────
test('the cap holds, and the same box under a trailing-slash or path-less spelling is not added twice', async () => {
  await H.publishAll(SHARED, [relayNetDocFor(church, [{ pubkey: BOX.relayPub, alwaysOn: true, url: BOX.wsUrl }])]);
  const full = Array.from({ length: CAP }, (_, i) => 'wss://old-tunnel-' + i + '.example/relay');

  // CAP. The store already holds CAP addresses; the document offers a REAL, provable box (test 5 adopts this
  // exact row). DECIDES FIRST: `if ((window.Fellowship.relays||[]).length >= MEMBER_NETDOC_ADOPT_MAX) break;`
  // is the first statement of the loop body, so the cap is the only thing that can refuse it.
  const atCap = memberOn({ church, relays: full, canonical: [secure(SHARED.wsUrl)], pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] } });
  try {
    await H.publishAll(SHARED, [joinDoc(atCap.me, church.pub)]);
    assert.deepEqual(await atCap.adopt(church.pub), [], 'the cap did not hold: ' + JSON.stringify(atCap.relays()));
    assert.equal(atCap.relays().length, CAP, 'the store grew past the bound');
  } finally { atCap.close(); }

  // …and one below the bound it still adopts, so the test above is the cap and not a dead loop.
  const belowCap = memberOn({ church, relays: full.slice(0, CAP - 1), canonical: [secure(SHARED.wsUrl)], pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] } });
  try {
    await H.publishAll(SHARED, [joinDoc(belowCap.me, church.pub)]);
    assert.deepEqual(await belowCap.adopt(church.pub), [BOX.wsUrl], 'nothing is adopted even below the cap — the loop is dead, not bounded');
  } finally { belowCap.close(); }

  // DEDUP. The store already holds the canonical spelling of the box; the document offers it with a trailing
  // slash and, separately, with no path. _netDocDialUrl collapses both onto the stored spelling and
  // _alreadyAMemberCandidate's canonical compare refuses them. DECIDES FIRST: the conversion succeeds for
  // each (asserted), shared/own are false, so _alreadyAMemberCandidate is the deciding line.
  const already = BOX.wsUrl;                            // wss://127.0.0.1:<port>/relay
  const spellings = [already + '/', already.replace(/\/relay$/, '')];
  await H.publishAll(SHARED, [relayNetDocFor(church, spellings.map((u, i) => ({ pubkey: 'a'.repeat(63) + i, alwaysOn: true, url: u })))]);
  const dedup = memberOn({ church, relays: [already], canonical: [secure(SHARED.wsUrl)], pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] } });
  try {
    await H.publishAll(SHARED, [joinDoc(dedup.me, church.pub)]);
    for (const u of spellings) assert.equal(dedup.dial(u), already, 'the conversion did not collapse ' + u + ' onto the stored spelling — the refusal below would prove nothing');
    assert.deepEqual(await dedup.adopt(church.pub), [], 'the same box was adopted again under another spelling: ' + JSON.stringify(dedup.relays()));
    assert.deepEqual(dedup.relays(), [already], 'the candidate list changed');
  } finally { dedup.close(); }
});

// ── 7. THE ADMIT IS A REAL REFUSAL, NOT A PASS-THROUGH ──────────────────────────────────────────────────
test('a box at a shipped/pinned address that proves the wrong key for that address is refused by the admit', async () => {
  // WHY THIS TEST EXISTS. On this base `proveRelay` returns the `software` root for ANY box that proves a
  // valid TrinityOne relay key, so every box that passes the KEY MATCH (proof.relayPub === e.pubkey) is also
  // admitted by `_isNetworkRelay` — which is why blinding the admit left tests 1–6 green (stated plainly in
  // the commit). The one refusal the admit adds beyond the key match is proveRelay's FRONT DOOR: a box
  // answering at an address WE SHIP (a pin) must prove one of the keys we pin at it. That is the only line
  // that can refuse a row the key match let through, so it is the only thing that isolates the admit.
  //
  // THE STAGING. BOX is pinned as a shipped address, but pinned to a DIFFERENT key ('b'…), so the front door
  // refuses BOX's own key. The church's document names BOX's REAL key, so the key match PASSES (entry pubkey
  // === proven pubkey) and cannot be what refuses. BOX is NOT in CANONICAL_RELAYS, so the member's own
  // shared-pool skip does not short-circuit it either.
  const bogusPin = 'b'.repeat(64);
  assert.notEqual(bogusPin, BOX.relayPub, 'staging fault: the bogus pin collides with the real box key');
  await H.publishAll(SHARED, [relayNetDocFor(church, [{ pubkey: BOX.relayPub, alwaysOn: true, url: BOX.wsUrl }])]);
  const app = memberOn({
    church, relays: [secure(SHARED.wsUrl)], canonical: [secure(SHARED.wsUrl)],
    pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub], [BOX.wsUrl]: [bogusPin] },
  });
  try {
    await H.publishAll(SHARED, [joinDoc(app.me, church.pub)]);
    // DECIDES FIRST: the conversion keeps BOX.wsUrl (asserted); CANONICAL_RELAYS.includes is false (BOX is
    // not compiled in); _alreadyAMemberCandidate is false (empty list); the KEY MATCH passes (same key). So
    // the only line that can refuse this row is `await isNetworkRelay(...)` — the front door inside it.
    assert.equal(app.dial(BOX.wsUrl), BOX.wsUrl, 'the conversion dropped the address, so this test proves nothing');
    const added = await app.adopt(church.pub);
    assert.deepEqual(added, [],
      'a box answering at a SHIPPED address with a key we do not pin there was adopted — the front door ' +
      '(RELAY-ADMISSION "our own front door") was not enforced, so a seized shipped address could be adopted.');
    assert.equal(app.relays().includes(BOX.wsUrl), false, 'the candidate list grew anyway');
  } finally { app.close(); }
});

// ── 8. THE INVITE-PATH MEMBER: the church's writes reach the box it signed ─────────────────────────────
// PR #7 audit, finding H-1 (2026-10-24). A member who followed with `?relay=S` has trinityone.churchboxes[cp]
// = [S] (adoptInviteRelays writes it). The shipped publishSetFor then took its PERSISTED branch — church boxes
// plus the shared pool — and never looked at window.Fellowship.relays, which is the only place the relay-net
// adoption above writes. So the box was proved, connected and in the read set, and received none of the
// member's writes: on the device test the church's own box held 0 of the member's events. Test 1 above cannot
// see this, because its member never went through the invite path, so it takes the other branch.
//
// THE STAGING. The phone's store is seeded the way adoptInviteRelays leaves it (churchboxes[cp] = [SHARED]).
// The box reaches the candidate list through the shipped adopt, out of the church's signed document, exactly as
// in test 1. The write is published over the SHIPPED publishSetFor's answer and read back out of the BOX
// relay's own store, so the assertion is about where the data landed, not about a list.
test('an invite-path member\'s church writes reach the box the church signed — matched on its key, never on the URL', async () => {
  const seededStore = () => {
    const s = memStore();
    s.setItem('trinityone.churchboxes', JSON.stringify({ [church.pub]: [secure(SHARED.wsUrl)] }));
    return s;
  };
  const opts = (store) => ({
    church, relays: [secure(SHARED.wsUrl)], canonical: [secure(SHARED.wsUrl)],
    pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] }, store,
  });
  const joinOn = async (relay, who) => (await H.readAs(relay, who,
    { kinds: [30078], authors: [who.pub], '#d': ['trinityone/member:' + church.pub] })).length > 0;

  // CONTROL — a box that is admitted but whose key the church's document does NOT name is not pulled into the
  // church's writes. This is the key-scoping half: without it the fix would route a church's traffic to any
  // admitted box in the global candidate list (the two-church leak, PR #7 audit H-3).
  await H.publishAll(SHARED, [relayNetDocFor(church, [{ pubkey: 'c'.repeat(64), alwaysOn: true, url: 'wss://elsewhere.invalid/relay' }])]);
  const ctl = memberOn(opts(seededStore()));
  try {
    ctl.win.Fellowship.relays.push(BOX.wsUrl);              // admitted below, but never signed by this church
    ctl.win.Fellowship.churchPub = church.pub;
    await ctl.adopt(church.pub);                            // fills the relay-net cache with the unrelated doc
    await ctl.gate.refresh(ctl.churchRelaysRaw(), church.pub);
    assert.ok(ctl.gate.admits(BOX.wsUrl, church.pub), 'staging fault: the box must be admitted for the control to mean anything');
    assert.ok(ctl.publishSetFor(church.pub).includes(secure(SHARED.wsUrl)), 'staging fault: the invite branch lost its own box');
    assert.equal(ctl.publishSetFor(church.pub).includes(BOX.wsUrl), false,
      'an admitted box the church never signed was added to the church\'s publish set — the fix matched on ' +
      'admission alone, not on a key the church signed: ' + JSON.stringify(ctl.publishSetFor(church.pub)));
  } finally { ctl.close(); }

  // THE CASE — the church signs the box; the invite-path member opens the app.
  await H.publishAll(SHARED, [relayNetDocFor(church, [{ pubkey: BOX.relayPub, alwaysOn: true, url: BOX.wsUrl }])]);
  const app = memberOn(opts(seededStore()));
  try {
    assert.deepEqual(JSON.parse(app.store.getItem('trinityone.churchboxes'))[church.pub], [secure(SHARED.wsUrl)],
      'precondition: this phone must be on the invite branch (church boxes = the invite relay)');
    app.setChurch(church.npub);
    await until(() => app.relays().includes(BOX.wsUrl), 'the church\'s box to reach the member\'s relay list');
    await app.gate.refresh(app.churchRelaysRaw(), church.pub);
    await until(() => app.relaysForChurch(church.pub).includes(BOX.wsUrl), 'the box to join the read set');

    const set = app.publishSetFor(church.pub);
    assert.ok(set.includes(BOX.wsUrl),
      'the church signed this box and the member admitted it, but the PUBLISH set still leaves it out, so ' +
      'nothing the member writes reaches the church\'s own box: ' + JSON.stringify(set));
    assert.ok(set.includes(secure(SHARED.wsUrl)), 'the invite relay fell out of the publish set');
    // THE SHARED POOL IS NEVER DROPPED (owner decision 2026-10-23).
    assert.ok(set.includes(secure(SHARED.wsUrl)), 'the shared pool was dropped from the publish set');
    // NOTHING WRITTEN: the fix routes, it does not persist. churchboxes is exactly as the invite left it.
    assert.deepEqual(JSON.parse(app.store.getItem('trinityone.churchboxes'))[church.pub], [secure(SHARED.wsUrl)],
      'publishSetFor wrote to trinityone.churchboxes');

    // WHERE THE DATA LANDS. The member's join, published over the shipped publish set, is in the BOX's store.
    const join = joinDoc(app.me, church.pub);
    await Promise.allSettled(app.pool.publish(set, join));
    assert.ok(await joinOn(BOX, app.me),
      'the member\'s join was published over the publish set but is not in the church\'s own box');
    assert.ok(await joinOn(SHARED, app.me), 'the member\'s join did not reach the shared relay either');
  } finally { app.close(); }
});

// ── 9. A BOX THE CHURCH TAKES OUT IS TAKEN OFF THE MEMBER'S PHONE (PR #7 audit, finding H-2) ───────────
// THE DEFECT. adoptChurchNetDocAddresses only ever ADDED to window.Fellowship.relays. When the church
// re-signed its relay-net document without the box, the member kept the address for ever: it was re-admitted
// under the `software` root and went on receiving the member's writes, AUTH and IP long after the steward
// pressed Remove. Measured 2026-10-24: doc re-signed [] on the relay, relaunch, the box still in the candidate
// list and its sqlite still receiving the member's next join.
//
// THE STAGING. A "relaunch" is a fresh memberOn over the SAME store and the relay list the last session left —
// the shipped adopt, the shipped churchRelayNet, the shipped gate; the documents are real church-signed events.
test('a box the church took out of its signed list leaves the member\'s phone; an older copy cannot put it back', async () => {
  const store = memStore();
  const opts = (relays) => ({
    church, relays, canonical: [secure(SHARED.wsUrl)],
    pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] }, store,
  });
  const signedOld = relayNetDocFor(church, [{ pubkey: BOX.relayPub, alwaysOn: true, url: BOX.wsUrl }]);
  await H.publishAll(SHARED, [signedOld]);
  let app = memberOn(opts([secure(SHARED.wsUrl)]));
  let left;
  try {
    app.setChurch(church.npub);
    await until(() => app.relays().includes(BOX.wsUrl), 'the church\'s box to be adopted in the first place');
    left = [...app.relays()];
  } finally { app.close(); }

  // THE CHURCH REMOVES IT — a newer signed list without the box. The member simply opens the app again.
  await H.publishAll(SHARED, [relayNetDocFor(church, [])]);
  app = memberOn(opts(left));
  try {
    assert.ok(app.relays().includes(BOX.wsUrl), 'precondition: the relaunched phone starts with the adopted box');
    await app.adopt(church.pub);
    assert.equal(app.relays().includes(BOX.wsUrl), false,
      'THE CHURCH TOOK THIS BOX OUT OF ITS SIGNED LIST and the member\'s phone still dials it: ' +
      JSON.stringify(app.relays()));
    await app.gate.refresh(app.churchRelaysRaw(), church.pub);
    assert.equal(app.publishSetFor(church.pub).includes(BOX.wsUrl), false, 'the removed box is still in the publish set');
    assert.equal(app.relaysForChurch(church.pub).includes(BOX.wsUrl), false, 'the removed box is still in the read set');
    // THE SHARED POOL IS NEVER DROPPED (owner decision 2026-10-23).
    assert.ok(app.relays().includes(secure(SHARED.wsUrl)), 'revocation took the shared relay with it');
    left = [...app.relays()];
  } finally { app.close(); }

  // ROLLBACK — a relay serving the OLDER copy (which still names the box) must not put it back. Staged on a
  // fresh relay that holds only the old document, with the shared relay out of the picture.
  const STALE = await H.startRelay({ name: 'STALE', churches: [church.pub] });
  await H.publishAll(STALE, [signedOld]);
  app = memberOn({ ...opts([secure(STALE.wsUrl)]), canonical: [secure(STALE.wsUrl)], pins: { [secure(STALE.wsUrl)]: [STALE.relayPub] } });
  try {
    await app.adopt(church.pub);
    assert.equal(app.relays().includes(BOX.wsUrl), false,
      'an OLDER copy of the church\'s list put a removed box back on the phone — one stale relay undoes a Remove');
  } finally { app.close(); }
});

test('revocation never takes away what it did not add, and nothing answered is not "the church removed it"', async () => {
  // CONTROL 1 — A RELAY THE MEMBER ALREADY HAD (typed, or from an invite) is never touched by the church's
  // list: only addresses this path added are recorded, and only recorded ones are revoked.
  await H.publishAll(SHARED, [relayNetDocFor(church, [])]);
  const typed = memberOn({ church, relays: [secure(SHARED.wsUrl), BOX.wsUrl], canonical: [secure(SHARED.wsUrl)],
                           pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] } });
  try {
    await typed.adopt(church.pub);
    assert.ok(typed.relays().includes(BOX.wsUrl), 'a relay the member had BEFORE adoption was revoked by the church\'s list');
  } finally { typed.close(); }

  // CONTROL 2 — NO DOCUMENT CAME BACK. The adopted box is recorded, then the phone can reach only relays that
  // hold no copy of the list: that is "nobody answered", never "the church removed it", and the box stays.
  const store = memStore();
  await H.publishAll(SHARED, [relayNetDocFor(church, [{ pubkey: BOX.relayPub, alwaysOn: true, url: BOX.wsUrl }])]);
  let app = memberOn({ church, relays: [secure(SHARED.wsUrl)], canonical: [secure(SHARED.wsUrl)],
                       pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] }, store });
  try {
    app.setChurch(church.npub);
    await until(() => app.relays().includes(BOX.wsUrl), 'the box to be adopted');
  } finally { app.close(); }
  const EMPTY = await H.startRelay({ name: 'EMPTY', churches: [church.pub] });
  app = memberOn({ church, relays: [secure(EMPTY.wsUrl), BOX.wsUrl], canonical: [secure(EMPTY.wsUrl)],
                   pins: { [secure(EMPTY.wsUrl)]: [EMPTY.relayPub] }, store });
  try {
    await app.adopt(church.pub);
    assert.ok(app.relays().includes(BOX.wsUrl),
      'a read that returned NO document revoked the church\'s box — on a phone with no signal that would ' +
      'throw away every box the church has signed');
  } finally { app.close(); }
});

// ── 11. ONE PHONE, TWO CHURCHES: church A's box is never used for church B (PR #7 audit, finding H-3) ──
// THE DEFECT. The candidate list is ONE list for every church the member follows. Church A's signed relay-net
// document put A's own box on it, and from then on church B's reads and writes went there too: A's box refused
// B's writes and wrote every refusal into its permanent rejected.log as "this member's key wrote
// trinityone/member:<B>". Seize A's box and that log lists which other churches A's members belong to.
// Measured 2026-10-24: B's publish set [shared, A-box]; the rejected.log line captured from a real gateway.
//
// THE STAGING. Two real churches, one shared relay both are registered on, A's own box (registered for A
// only), and a MUTUAL box both churches sign — the DOMAIN case "churches host each other", which this fix must
// not break. Adoption is the shipped adoptChurchNetDocAddresses; the sets are the shipped relaysForChurch,
// publishSetFor and churchRelays; B's join is published over the shipped publish set and A's box's own
// rejected.log is read afterwards.
test('one phone in two churches: church A\'s own box carries none of church B\'s traffic; a box both sign serves both', async () => {
  const A = church;
  const B = H.key(); B.npub = npubEncode(B.pub);
  const S2 = await H.startRelay({ name: 'S2', churches: [A.pub, B.pub] });
  const BOXA = await H.startRelay({ name: 'BOXA', churches: [A.pub] });
  const MUTUAL = await H.startRelay({ name: 'MUTUAL', churches: [A.pub, B.pub] });
  const shared = secure(S2.wsUrl);
  await H.publishAll(S2, [
    relayNetDocFor(A, [{ pubkey: BOXA.relayPub, alwaysOn: true, url: BOXA.wsUrl },
                       { pubkey: MUTUAL.relayPub, alwaysOn: true, url: MUTUAL.wsUrl }]),
    relayNetDocFor(B, [{ pubkey: MUTUAL.relayPub, alwaysOn: true, url: MUTUAL.wsUrl }]),
  ]);
  const app = memberOn({ church: A, relays: [shared], canonical: [shared], pins: { [shared]: [S2.relayPub] } });
  try {
    // The member opens church A: both of A's boxes are adopted and recorded under A.
    assert.deepEqual((await app.adopt(A.pub)).sort(), [BOXA.wsUrl, MUTUAL.wsUrl].sort(), 'staging fault: A\'s boxes were not adopted');
    await app.gate.refresh(app.churchRelaysRaw(), A.pub);
    await app.gate.refresh(app.churchRelaysRaw(), B.pub);
    // CONTROL — church A still uses its own boxes. A fix that dropped them everywhere would pass the rest.
    assert.ok(app.relaysForChurch(A.pub).includes(BOXA.wsUrl), 'church A lost its own box from its read set');
    assert.ok(app.publishSetFor(A.pub).includes(BOXA.wsUrl), 'church A lost its own box from its publish set');

    // CHURCH B, BEFORE IT HAS CLAIMED ANYTHING: neither of A's boxes is in B's sets.
    assert.equal(app.relaysForChurch(B.pub).includes(BOXA.wsUrl), false,
      'church B\'s READ set includes church A\'s own box: ' + JSON.stringify(app.relaysForChurch(B.pub)));
    assert.equal(app.publishSetFor(B.pub).includes(BOXA.wsUrl), false,
      'church B\'s PUBLISH set includes church A\'s own box: ' + JSON.stringify(app.publishSetFor(B.pub)));
    app.win.Fellowship.churchPub = B.pub;
    assert.equal(app.churchRelays().includes(BOXA.wsUrl), false,
      'with church B active, churchRelays() — the set B\'s care, safety and member reads use — includes A\'s box');
    // THE SHARED POOL IS NEVER DROPPED, for either church.
    assert.ok(app.relaysForChurch(B.pub).includes(shared) && app.publishSetFor(B.pub).includes(shared),
      'church B lost the shared relay');

    // WHERE THE DATA LANDS: B's join, over B's shipped publish set, leaves no trace on A's box. (The gateway's
    // rejectLog keeps the first 60 characters of the d-tag, so the trace is the start of B's key.)
    const bTrace = 'trinityone/member:' + B.pub.slice(0, 40);
    const join = joinDoc(app.me, B.pub);
    await Promise.allSettled(app.pool.publish(app.publishSetFor(B.pub), join));
    await sleep(600);
    let log = ''; try { log = readFileSync(join_(BOXA.dataDir, 'rejected.log'), 'utf8'); } catch (e) { log = ''; }
    assert.equal(log.includes(bTrace), false,
      'church A\'s box logged this member\'s join to church B — a seizure of A\'s box reveals the second church');
    // CONTROL FOR THE CHECK ABOVE: the same join sent STRAIGHT to A's box IS refused and logged — so an empty log
    // above means nothing was sent there, not that the log could not be read.
    const w = await H.connect(BOXA);
    try { const [ok] = await H.publish(w, join); assert.equal(ok, false, 'staging fault: A\'s box accepted a join to church B'); }
    finally { try { w.close(); } catch (e) {} }
    await sleep(300);
    const after = readFileSync(join_(BOXA.dataDir, 'rejected.log'), 'utf8');
    assert.ok(after.includes(bTrace), 'staging fault: A\'s box does not log the refusal this test looks for');

    // MUTUAL HOSTING: church B signs the MUTUAL box too. Once B's document is read, B claims it and uses it;
    // A's private box stays out.
    await app.adopt(B.pub);
    assert.ok(app.relaysForChurch(B.pub).includes(MUTUAL.wsUrl),
      'a box BOTH churches sign is not used for church B — the fix broke churches hosting each other');
    assert.equal(app.relaysForChurch(B.pub).includes(BOXA.wsUrl), false, 'claiming the mutual box let A\'s own box in too');
    // …and church A KEEPS it, with no re-proof. The gate used to remember one church per address, so proving
    // the mutual box for B un-admitted it for A (this test found that; scripts/a-box-two-churches-sign-stays-
    // proved-for-both.test.mjs pins the gate rule).
    assert.ok(app.gate.admits(MUTUAL.wsUrl, A.pub), 'proving the mutual box for church B un-admitted it for church A');
    assert.ok(app.relaysForChurch(A.pub).includes(MUTUAL.wsUrl), 'church B\'s claim took the mutual box away from church A');
  } finally { app.close(); }
});

// ── 12. A ws:// ADDRESS OFF THIS DEVICE IS NEVER ADOPTED, NOR DIALLED ───────────────────────────────────
test('a box the church signed at a cleartext ws:// or http:// address on the network is not adopted and never dialled', async () => {
  // PR #7 audit, M-4. A console served over plain http signs a ws:// origin. The SAME box is named three
  // ways: by this machine's network address over ws:// and over http:// (both cleartext across the wifi, so
  // refused), and over loopback ws:// (never leaves the device — the control, and the spelling every other
  // test in this file adopts by). DECIDES: the NO CLEARTEXT `continue` in adoptChurchNetDocAddresses.
  const lan = Object.values(networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal);
  const host = lan ? lan.address : '192.0.2.1';
  const port = new URL(BOX.wsUrl).port;
  const lanWs = 'ws://' + host + ':' + port + '/relay';
  const lanHttp = 'http://' + host + ':' + port;
  const app = memberOn({
    church, relays: [secure(SHARED.wsUrl)], canonical: [secure(SHARED.wsUrl)],
    pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] },
  });
  try {
    await H.publishAll(SHARED, [joinDoc(app.me, church.pub)]);
    await H.publishAll(SHARED, [relayNetDocFor(church, [
      { pubkey: BOX.relayPub, url: lanWs }, { pubkey: BOX.relayPub, url: lanHttp },
    ])]);
    FETCHED.length = 0;
    const added = await app.adopt(church.pub);
    assert.deepEqual(added, [], 'a cleartext address on the network was adopted');
    assert.equal(app.relays().some(u => u.includes(host + ':' + port)), false, 'the cleartext address reached the relay list');
    assert.equal(FETCHED.some(u => u.includes('//' + host + ':' + port)), false,
      'the cleartext address was DIALLED — the proof itself crosses the wifi unencrypted: ' + JSON.stringify(FETCHED));

  } finally { app.close(); }
  // CONTROL, on a fresh phone (the first one has the document cached): the same box, same key, at loopback
  // IS adopted — so the refusal above is about the address, not the box or its proof.
  await H.publishAll(SHARED, [relayNetDocFor(church, [{ pubkey: BOX.relayPub, url: BOX.wsUrl }])]);
  const ctl = memberOn({
    church, relays: [secure(SHARED.wsUrl)], canonical: [secure(SHARED.wsUrl)],
    pins: { [secure(SHARED.wsUrl)]: [SHARED.relayPub] },
  });
  try {
    await H.publishAll(SHARED, [joinDoc(ctl.me, church.pub)]);
    assert.deepEqual(await ctl.adopt(church.pub), [BOX.wsUrl], 'staging: the loopback spelling of the same box was not adopted');
  } finally { ctl.close(); }
});
