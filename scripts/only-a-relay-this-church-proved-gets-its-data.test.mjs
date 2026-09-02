// ONLY A RELAY THIS CHURCH CAN PROVE GETS ITS DATA.
// Run: node --test scripts/only-a-relay-this-church-proved-gets-its-data.test.mjs
//
// C3 asked the question and acted on nothing. This is the item where a relay that cannot prove itself stops
// receiving a church's data, so every test here is about a MACHINE THAT IS UP AND WAS GENUINELY ASKED. A
// test that finds nothing on a relay it never contacted proves nothing at all, so every relay below is a
// real `node scripts/gateway.mjs`, holding the same church, in the same health, over a real `SimplePool`
// socket — and every count is taken from the RELAY'S OWN STORE over /sync as the church key, never from the
// return value of the call that wrote it.
//
// THE FOUR THINGS THAT GO WRONG HERE, one test each:
//
//   1. THE ORDER AGAINST THE NEVER-EMPTY GUARDS. There are two sets and they have opposite invariants: the
//      CANDIDATE list is never empty, the PUBLISH set is verified-only and may be empty. Filter before the
//      guards and an emptied list is refilled with relays nobody proved; treat the publish set as
//      never-empty and there is no gate. Guards first, filter last, on the assembled list.
//   2. THE HOT PATH. A relay must never be dropped because a probe was slow at the moment somebody pressed
//      send. The filter is synchronous and reads a persisted cache; an unknown address is proved in the
//      background and joins the live set on success.
//   3. THE DEADLOCK, on the READ side this time. Nothing that ADMITS a relay may enumerate from the filtered
//      list — not the census, and not the membership read that feeds the gate. A gate whose own evidence is
//      gated is a church permanently orphaned from its own machine.
//   4. THE LABEL. A care request that could not be published reads as NOT SENT. This project has shipped six
//      controls that toasted success over a send that never happened.
//
// AND ONE THING THAT IS NOT CLOSED, asserted rather than left as prose: a host that FORWARDS the possession
// proof to a genuine relay cannot inherit the canonical pool's identity or the console's own box's, because
// both of those roots are bound to the address dialled. Under the CHURCH-SIGNATURE root it can, and the
// reason is the relay's rather than the client's — see THE FORWARDING PROXY in src/relay-net.src.js. The
// last test in this file pins that boundary in both directions so it cannot drift silently.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { SimplePool } from 'nostr-tools/pool';
import { verifyEvent, finalizeEvent } from 'nostr-tools/pure';
import { normalizeURL } from 'nostr-tools/utils';
import * as nip44 from 'nostr-tools/nip44';
import { fnBody, stmt } from './test-slice.mjs';
import * as H from './relay-network-harness.mjs';

const RELAY_NET_D = 'trinityone/relay-net';
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const STEWARD = read('vendor/steward.js');
const FELLOW = read('vendor/fellowship.js');

// ── a browser's worth of world, per surface ─────────────────────────────────────────────────────────────
// One store per harness so the persisted verified set is really persisted and really separate — the cache
// test below restarts a surface over the SAME store, which is the only way to ask whether a boot with no
// network still knows what it knew yesterday.
function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
function fakeWindow() {
  const events = [];
  return {
    events,
    Fellowship: {},
    dispatchEvent: (e) => { events.push({ type: e.type, detail: e.detail }); return true; },
    addEventListener: () => {}, removeEventListener: () => {},
  };
}
class Ev { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } }

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

// ── the shared predicate + gate, out of whichever bundle ────────────────────────────────────────────────
// CANONICAL_RELAY_PUBS is deliberately NOT lifted: it is the shipped pin table pointing at app.trinityone.church,
// and a test that used it could only ever stage the canonical root against a machine it cannot run. It is
// injected instead, so "the canonical pool" in these tests is a real relay on a bound port with a real key.
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
// Guards on the lift. A slice that stopped containing the load-bearing line would leave every assertion
// below passing over nothing at all.
function assertGateLift(body, file) {
  assert.match(body, /const map = readVerified\(d\.store\)/, `${file}: the gate no longer reads a persisted cache`);
  assert.match(body, /admit\(list, cp\)/, `${file}: the synchronous filter is gone from the gate`);
  assert.match(body, /schedule\(u, cp\)/, `${file}: nothing schedules a background proof — the gate would be verify-or-drop`);
}

// ── the console, as a steward has it ────────────────────────────────────────────────────────────────────
// The whole publish path out of vendor/steward.js, over a REAL SimplePool. `relays()` is the shipped
// assembler with the shipped gate on it; `publish()` is the shipped writer. Nothing about which relay
// receives what is decided by this harness.
function consoleOn({ church, origin, canonical = [], pins = {}, extra = [], store = memStore(), boxHostsUs = null }) {
  const src = STEWARD;
  const win = fakeWindow();
  // THE REAL POOL, ANSWERING THE REAL AUTH CHALLENGE. The membership document is an auth-gated read
  // (trinity-doc-types: read 'members'), so a pool that cannot NIP-42 would come back empty from a healthy
  // relay and every church-signature admission below would fail for a reason that has nothing to do with the
  // gate. Same shape as the console's own `pool.automaticallyAuth`.
  const pool = new SimplePool();
  pool.automaticallyAuth = () => async (authEvent) => finalizeEvent(authEvent, church.sk);
  const body = [
    gateSource(src),
    fnBody(src, 'function lsGet', 'lsGet'),
    fnBody(src, 'function lsSet', 'lsSet'),
    stmt(src, 'var RELAYS_LS = ', 'RELAYS_LS'),
    fnBody(src, 'function normRelay', 'normRelay'),
    fnBody(src, 'function ownRelay', 'ownRelay'),
    fnBody(src, 'function extraRelays', 'extraRelays'),
    fnBody(src, 'function relaysRaw', 'relaysRaw'),
    fnBody(src, 'function _ownOrigin', '_ownOrigin'),
    fnBody(src, 'function relayNetCandidates', 'relayNetCandidates'),
    fnBody(src, 'function _oneComplete', '_oneComplete'),
    fnBody(src, 'function relayNetDoc', 'relayNetDoc'),
    fnBody(src, 'async function relayNetEntries', 'relayNetEntries'),
    fnBody(src, 'async function enrolRelayNet', 'enrolRelayNet'),
    stmt(src, 'var _gate = createRelayGate(', '_gate'),
    fnBody(src, 'function relays()', 'relays'),
    stmt(src, 'var NO_NETWORK_RELAY = ', 'NO_NETWORK_RELAY'),
    fnBody(src, 'async function publish(evt)', 'publish'),
  ].join('\n');
  assertGateLift(body, 'vendor/steward.js');
  assert.match(body, /const _targets = relays\(\);/, 'vendor/steward.js: publish() no longer assembles through the gated list');
  assert.match(body, /pool\.subscribeMany\(relaysRaw\(\)/, 'vendor/steward.js: the one-shot reader has been moved onto the FILTERED list — the read-side deadlock');
  // The tests below warm the gate with `gate.refresh(relaysRaw(), pub)` because that is what the console does
  // the moment it learns which church it is running (setKey). If that call ever leaves setKey, these tests
  // would still pass while a real console published nothing until its first background pass — so the claim is
  // pinned here rather than assumed.
  assert.match(src, /_gate\.refresh\(relaysRaw\(\), pub\)/,
    'vendor/steward.js: setKey() no longer proves this church\'s relays on unlock, so the console\'s first ' +
    'save would go to an empty publish set');

  const scope = scopeOf({
    localStorage: store, window: win, location: origin, pool, console,
    CANONICAL_RELAY: canonical[0] || 'wss://canonical.invalid/relay',
    CANONICAL_RELAYS: canonical,
    CANONICAL_RELAY_PUBS: pins,
    _boxHostsUs: boxHostsUs,
    pub: church.pub, sk: church.sk,
    now: () => Math.floor(Date.now() / 1000),
    finalizeEvent, verifyEvent, normalizeURL, fetch: globalThis.fetch,
    CustomEvent: Ev,
    // relayStatus() opens a throwaway socket per candidate purely to time it. The stub refuses immediately,
    // so every row reads 'off' — which is fine, because the question here is WHICH ROWS THERE ARE and what
    // each one is told about its membership, not how fast a relay answers.
    WebSocket: function () { setTimeout(() => { try { this.onerror && this.onerror(); } catch (e) {} }, 0); this.close = () => {}; },
    _waitForRegistration: async () => {},
    _lastOk: new Map(),
    setNamedRelays: () => {}, getNamedRelays: () => [],
  });
  store.setItem('trinityone.steward.extra-relays', JSON.stringify(extra));
  // The Add-relay control the steward actually presses, taken as the METHOD it is on window.Steward — the
  // point of use (CLAUDE.md rule 1). The tests below add an un-signed relay through this and then count what
  // reached that relay's own store.
  const addRelay = fnBody(src, '  addRelay(input) {', 'addRelay');
  // …and the panel's own data source, because a relay this church's data no longer goes to must not simply
  // VANISH from the screen. What the CARD renders cannot be asserted here (CLAUDE.md rule 3 — app/*.jsx
  // ships unbundled, so text-matching it proves nothing); what it is given can be, and is.
  const relayStatus = fnBody(src, '  relayStatus() {', 'relayStatus');
  const api = new Function('scope', `with (scope) { ${body}
    const _api = { ${addRelay}, ${relayStatus} };
    return { relays, relaysRaw, publish, enrolRelayNet, relayNetCandidates, relayNetEntries, extraRelays,
             addRelay: (u) => _api.addRelay(u), relayStatus: () => _api.relayStatus(), gate: _gate, ownRelay,
             proveRelay: (cp, url) => proveRelay(cp, url, { verify: verifyRelayIdentity, netEntries: relayNetEntries, origin: _ownOrigin(), pins: CANONICAL_RELAY_PUBS }),
             verifyRelayIdentity }; }`)(scope);
  api.pool = pool;
  api.win = win;
  api.store = store;
  api.close = () => { try { pool.close(pool.relays ? [...pool.relays.keys()] : []); } catch {} };
  return api;
}

// The church's own relay-net document as a BOX holds it, read over /sync as the church key.
async function storedRelayNet(relay, church) {
  const evs = await H.corpus(relay, church);
  return evs.filter(e => e.kind === 30078 && e.pubkey === church.pub
    && (e.tags.find(t => t[0] === 'd') || [])[1] === RELAY_NET_D);
}
// How many copies of one document a box is holding — the assertion every test here really makes.
async function held(relay, church, d) {
  const evs = await H.corpus(relay, church);
  return evs.filter(e => (e.tags.find(t => t[0] === 'd') || [])[1] === d).length;
}
const churchDocFor = (church, d, content) => finalizeEvent(
  { kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', d], ['t', 'trinityone']], content: JSON.stringify(content) }, church.sk);
// Sign a box into a church's membership document, by hand and straight onto the box, so a test can set up
// "the church has already vouched for this key" without going through the code under test.
const signIn = (church, relays) => churchDocFor(church, RELAY_NET_D, relays.map(r => ({ pubkey: r.relayPub, alwaysOn: true, url: r.wsUrl })));
// A person's own join document — what makes the relay treat them as this church's member, so a care request
// from them is accepted for the reason it is accepted in real life rather than by a special case here.
const joinDoc = (who, cp) => finalizeEvent(
  { kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', 'trinityone/member:' + cp], ['t', 'trinityone'], ['p', cp]], content: JSON.stringify({ joined: Math.floor(Date.now() / 1000) }) }, who.sk);

// ── the participants ────────────────────────────────────────────────────────────────────────────────────
// IN, OUT and SELF run the same software, hold the same church, and are equally healthy. The ONLY thing that
// differs is whether anything vouches for their key.
let church, IN, OUT, SELF, POOLBOX;
before(async () => {
  church = H.key();
  [IN, OUT, SELF, POOLBOX] = await Promise.all([
    H.startRelay({ name: 'IN', churches: [church.pub] }),
    H.startRelay({ name: 'OUT', churches: [church.pub] }),
    H.startRelay({ name: 'SELF', churches: [church.pub] }),
    H.startRelay({ name: 'POOL', churches: [church.pub] }),
  ]);
  assert.equal(new Set([IN, OUT, SELF, POOLBOX].map(r => r.relayPub)).size, 4,
    'the four relays must be four separate boxes or nothing below means anything');
});
after(() => H.stopAll());

// ── 1. THE POINT OF USE: the Add-relay control, then a real church document ─────────────────────────────
test('a document a steward saves does not reach the relay they added but their church never signed for', async () => {
  await H.publishAll(IN, [signIn(church, [IN])]);         // the church vouches for IN, and only IN
  const con = consoleOn({ church, origin: { protocol: 'http:', host: 'console.example' }, extra: [IN.wsUrl] });
  try {
    // The steward types OUT's address into the console's Add-relay box and presses the button.
    assert.equal(con.addRelay(OUT.wsUrl), OUT.wsUrl, 'the Add-relay control refused a perfectly valid address');
    assert.ok(con.relaysRaw().includes(OUT.wsUrl), 'the candidate list did not take the address the steward added');

    await con.gate.refresh(con.relaysRaw(), church.pub);
    const set = con.relays();
    assert.deepEqual(set, [IN.wsUrl],
      'the publish set is ' + JSON.stringify(set) + ' — it must be exactly the box this church signed for');

    const saved = await con.publish(churchDocFor(church, 'trinityone/notices', { text: 'Harvest supper, Sunday 6pm' }));
    assert.ok(saved, 'the console reported the save failed, so this test cannot say where it went');

    // COUNTED ON THE BOXES, not in the client.
    assert.equal(await held(IN, church, 'trinityone/notices'), 1, 'the church\'s own relay did not receive the document');
    assert.equal(await held(OUT, church, 'trinityone/notices'), 0,
      'a relay this church never signed for is holding a church document. It is up, it was in the console\'s ' +
      'own relay list, and the steward added it through the shipped control — so this is the gate being ' +
      'absent, not the box being unreachable.');
  } finally { con.close(); }
});

// ── 2. the two invariants, in the one place they collide ────────────────────────────────────────────────
test('the candidate list keeps its never-empty guard and the publish set is allowed to be empty', async () => {
  // A church whose only configured relay is one nothing vouches for, and a canonical pool that (like the
  // real fleet today) cannot answer the proof: OUT is canonical by URL but pinned to somebody else's key.
  const con = consoleOn({
    church, origin: { protocol: 'https:', host: 'app.example.church' },
    canonical: [POOLBOX.wsUrl], pins: { [POOLBOX.wsUrl]: [OUT.relayPub] }, extra: [OUT.wsUrl],
  });
  try {
    await con.gate.refresh(con.relaysRaw(), church.pub);
    assert.ok(con.relaysRaw().length >= 2,
      'the CANDIDATE list must keep its guard and must never be empty — it is what the client retries and ' +
      're-proves from. Filtering it is how an emptied list gets refilled with relays nobody proved.');
    assert.deepEqual(con.relays(), [],
      'the PUBLISH set must be allowed to be empty. If it is not, the gate does not exist: something is ' +
      're-inserting a relay after the filter ran.');

    const before2 = con.win.events.length;
    const res = await con.publish(churchDocFor(church, 'trinityone/notices', { text: 'this must not land' }));
    assert.equal(res, false, 'publish() reported success over a set it could not write to');
    const errs = con.win.events.slice(before2).filter(e => e.type === 'steward-publish-error');
    assert.equal(errs.length, 1, 'the console raised ' + errs.length + ' publish errors, expected exactly 1 — ' +
      'an empty publish set must take the failure surface the console ALREADY has, not a new queue');
    assert.match(String(errs[0].detail.reason), /^no-network-relay/,
      'the steward was given "' + errs[0].detail.reason + '". A relay that could not be proved is not a ' +
      'connection problem, and telling them it is sends them to look at their broadband.');
    for (const box of [OUT, POOLBOX]) {
      assert.equal(await held(box, church, 'trinityone/notices'), 0, box.name + ' received a document from an empty publish set');
    }
    // …AND THE PANEL IS STILL TOLD ABOUT THEM. Silently changing where a church's data goes is how the
    // divergence in ROADMAP-NOTES §6 became invisible, so the relay list a steward looks at enumerates every
    // CANDIDATE and says which of them the church's data actually reaches.
    const rows = await con.relayStatus();
    assert.deepEqual(new Set(rows.map(r => r.url)), new Set(con.relaysRaw()),
      'the relay panel is fed the publish set, so an address this church no longer writes to would simply ' +
      'disappear from the steward\'s screen instead of being shown as out of the network');
    assert.ok(rows.length && rows.every(r => r.member === false),
      'every row is reported as in-network while the publish set is empty: ' + JSON.stringify(rows.map(r => [r.url, r.member])));
  } finally { con.close(); }
});

// ── 3. the hot path is never a verify-or-drop ───────────────────────────────────────────────────────────
test('the filter is synchronous and consults the cache only; an unknown address is proved in the background', async () => {
  await H.publishAll(IN, [signIn(church, [IN])]);
  const store = memStore();
  const con = consoleOn({ church, origin: { protocol: 'https:', host: 'app.example.church' }, extra: [IN.wsUrl], store });
  try {
    // The very first call, with nothing cached: it must ANSWER — not await a probe — and its answer is "not
    // yet". A gate that verified here would put a network round trip under every publish and every
    // subscription, and would drop a church's own relay whenever that trip was slow.
    const t0 = Date.now();
    const first = con.relays();
    const took = Date.now() - t0;
    assert.deepEqual(first, [], 'an address with no cached proof was admitted');
    assert.ok(took < 250, 'the synchronous filter took ' + took + 'ms — it is doing network work on the hot path');

    // …and the background pass it started brings the relay in with nobody asking again.
    await H.waitFor(() => con.relays().includes(IN.wsUrl), { timeout: 15000, label: 'the background proof to admit IN' });

    // What it wrote down is the PUBKEY proved there, under the church that vouched.
    const cache = JSON.parse(store.getItem('trinityone.relays.verified'));
    const entry = cache[normalizeURL(IN.wsUrl)];
    assert.ok(entry, 'the verified set is keyed by something other than the normalised URL: ' + JSON.stringify(Object.keys(cache)));
    assert.equal(entry.pub, IN.relayPub, 'the cache recorded the wrong key for this box');
    assert.equal(entry.cp, church.pub, 'a church-signature admission was cached without the church that made it');
  } finally { con.close(); }
});

// ── 4. what a boot with no network still knows, and what it must not ────────────────────────────────────
test('the verified set survives a restart, is keyed the way the pool keys relays, and is per church', async () => {
  await H.publishAll(IN, [signIn(church, [IN])]);
  const store = memStore();
  const first = consoleOn({ church, origin: { protocol: 'https:', host: 'app.example.church' }, extra: [IN.wsUrl], store });
  await first.gate.refresh(first.relaysRaw(), church.pub);
  assert.deepEqual(first.relays(), [IN.wsUrl], 'precondition: the first run admitted the church\'s box');
  first.close();

  // A SECOND RUN OVER THE SAME STORE, with the box switched off. Nothing can be proved now, and the point of
  // persisting is that nothing has to be: a boot on a dead link still knows what it knew yesterday.
  const back = consoleOn({ church, origin: { protocol: 'https:', host: 'app.example.church' }, extra: [IN.wsUrl], store });
  try {
    assert.deepEqual(back.relays(), [IN.wsUrl],
      'a restart lost the proof it had already taken. A church on a thin link would start every session with ' +
      'an empty publish set and everything queued, for no reason at all.');
    // The trailing-slash trap, which has cost this codebase three silent misses in one file.
    const slashed = consoleOn({ church, origin: { protocol: 'https:', host: 'app.example.church' }, extra: [IN.wsUrl + '/'], store });
    assert.deepEqual(slashed.relays(), [IN.wsUrl + '/'],
      'the same relay spelled with a trailing slash missed the cache. The pool keys its connections by ' +
      'normalizeURL() and so must this, or the gate misses exactly the relay it is about.');
    slashed.close();
    // …and ANOTHER church's console, on this same computer, does not inherit the admission. The signature
    // that admitted IN was this church's, and it says nothing about anybody else's data.
    const other = H.key();
    const stranger = consoleOn({ church: other, origin: { protocol: 'https:', host: 'app.example.church' }, extra: [IN.wsUrl], store });
    assert.deepEqual(stranger.relays(), [],
      'one church\'s signature admitted a relay for a DIFFERENT church\'s data. Membership is per church ' +
      'because the church\'s own signature is the whole authority.');
    stranger.close();
  } finally { back.close(); }
});

// ── 5. THE DEADLOCK, on the read side ───────────────────────────────────────────────────────────────────
test('a box the gate has never admitted is still asked for the signature that admits it', async () => {
  // The state that traps a self-hosting church for ever if the evidence is gated too: a fresh console, on a
  // HOSTED origin, whose church has already signed its own box in — and a verified set that knows nothing.
  // The only copy of that signature is ON THE BOX. If the read that fetches it goes through the filter it
  // feeds, the box is excluded, therefore never asked, therefore never admitted, therefore excluded for ever.
  const flock = H.key();
  const BOX = await H.startRelay({ name: 'BOX', churches: [flock.pub] });
  await H.publishAll(BOX, [signIn(flock, [BOX])]);
  const con = consoleOn({ church: flock, origin: { protocol: 'https:', host: 'app.example.church' }, extra: [BOX.wsUrl] });
  try {
    assert.deepEqual(con.relays(), [], 'precondition: nothing is admitted yet, so the filtered list is empty');
    assert.ok(con.relaysRaw().includes(BOX.wsUrl), 'precondition: the candidate list names the box');

    await con.gate.refresh(con.relaysRaw(), flock.pub);   // what setKey() does on unlock
    assert.deepEqual(con.relays(), [BOX.wsUrl],
      'the console never admitted the box its own church had signed for. The signature exists and is stored ' +
      'ON THAT BOX — so this is the membership read being routed through the gate it is evidence for, which ' +
      'is the bootstrap deadlock one level down from the enrolment census.');

    const saved = await con.publish(churchDocFor(flock, 'trinityone/notices', { text: 'after the deadlock' }));
    assert.ok(saved, 'the console could not save after admitting its own relay');
    assert.equal(await held(BOX, flock, 'trinityone/notices'), 1, 'the church\'s own box did not receive the document');
  } finally { con.close(); BOX.stop(); }
});

// ── 6. the Suite's first run: a box nobody has ever vouched for, on the console's own origin ────────────
test('a never-yet-admitted box on the console\'s own origin is adopted, and the church signs it in', async () => {
  const flock = H.key();
  const BOX = await H.startRelay({ name: 'SUITE', churches: [flock.pub] });
  // Served BY that box: location IS the relay's origin, which is the whole of the Suite's first run.
  const con = consoleOn({
    church: flock, extra: [],
    origin: { protocol: 'http:', host: BOX.base.replace(/^https?:\/\//, '') },
  });
  try {
    assert.deepEqual(await storedRelayNet(BOX, flock), [], 'precondition: this church has signed nothing anywhere');
    // The census reads the RAW world — location — and not the filtered list, which names nothing yet.
    assert.ok(con.relayNetCandidates().includes(BOX.wsUrl),
      'the enrolment census did not include the box that served this console: ' + JSON.stringify(con.relayNetCandidates()));

    await con.gate.refresh(con.relaysRaw(), flock.pub);   // what setKey() does on unlock
    assert.ok(con.relays().includes(BOX.wsUrl),
      'the relay serving this very page was refused with no church document anywhere. That is the Suite ' +
      'bricked on its first run, which is the most likely way this work breaks something real.');

    const res = await con.enrolRelayNet();
    assert.equal(res.published, true, 'the church did not sign in the box that is serving its console');
    const docs = await storedRelayNet(BOX, flock);
    assert.equal(docs.length, 1, BOX.name + ' holds ' + docs.length + ' membership documents, expected 1');
    assert.match(docs[0].content, new RegExp(BOX.relayPub), 'the published document does not name this box');
  } finally { con.close(); BOX.stop(); }
});

// ── 7. a box that MOVED, and an address that changed hands ─────────────────────────────────────────────
test('a relay that moved re-proves at its new address; an address answering with a new key loses its entry', async () => {
  const flock = H.key();
  let BOX = await H.startRelay({ name: 'MOVER', churches: [flock.pub] });
  await H.publishAll(BOX, [signIn(flock, [BOX])]);
  const store = memStore();
  let con = consoleOn({ church: flock, origin: { protocol: 'https:', host: 'app.example.church' }, extra: [BOX.wsUrl], store });
  await con.gate.refresh(con.relaysRaw(), flock.pub);
  assert.deepEqual(con.relays(), [BOX.wsUrl], 'precondition: the box was admitted at its first address');
  const oldUrl = BOX.wsUrl;
  con.close();

  // A TUNNEL RESTART: same machine, same key, new address, and the church's document still records the old
  // one. Membership is the key, so the box simply proves itself again where it now is.
  BOX = await H.moveRelay(BOX);
  con = consoleOn({ church: flock, origin: { protocol: 'https:', host: 'app.example.church' }, extra: [BOX.wsUrl], store });
  try {
    await con.gate.refresh(con.relaysRaw(), flock.pub);
    assert.deepEqual(con.relays(), [BOX.wsUrl],
      'a church\'s own relay lost its place by rebooting behind a tunnel. Nothing about membership may be ' +
      'URL-shaped: the document still records ' + oldUrl + ' and that must not matter.');

    // AND THE OTHER DIRECTION. The address this church proved is now answering with somebody else's key —
    // the box was replaced, or the name now points elsewhere. A cache that kept the old verdict would be
    // vouching for a machine it never checked.
    // UPDATED 2026-09-02 for the address binding. This used to FORWARD to OUT, which under the binding is
    // refused for being a forwarder — and that would have made this case pass for the wrong reason, testing
    // hole 1 instead of the thing it is named after. A replaced box is not a proxy: it is a real machine at
    // the same address holding a DIFFERENT key. So the usurper now signs its OWN address with its own key,
    // which is what "the name now points elsewhere" actually looks like on the wire.
    const usurperKey = H.key();
    let usurperAddr = '';
    const usurper = await H.startImpostor({
      name: 'usurper',
      handler: async (req, res, u) => {
        if (!u.pathname.startsWith('/relay-identity')) return H.sendJson(res, { error: 'no' }, 404);
        const nonce = u.searchParams.get('nonce') || '';
        H.sendJson(res, { proof: finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000),
          tags: [['u', 'relay-identity'], ['method', 'GET'], ['nonce', nonce], ['relay', usurperAddr]],
          content: '' }, usurperKey.sk) });
      },
    });
    usurperAddr = usurper.base.replace(/^http:/, 'ws:') + '/relay';
    const takenOver = usurper.base + '/relay';
    const s2 = memStore();
    const c2 = consoleOn({ church: flock, origin: { protocol: 'https:', host: 'app.example.church' }, extra: [takenOver], store: s2 });
    // Seed the cache with a proof this address really did pass once, under this church's signature.
    s2.setItem('trinityone.relays.verified', JSON.stringify({
      [normalizeURL(takenOver)]: { pub: BOX.relayPub, cp: flock.pub, at: Math.floor(Date.now() / 1000), until: Math.floor(Date.now() / 1000) + 86400 },
    }));
    const c2b = consoleOn({ church: flock, origin: { protocol: 'https:', host: 'app.example.church' }, extra: [takenOver], store: s2 });
    assert.deepEqual(c2b.relays(), [takenOver], 'precondition: the seeded cache admits this address');
    assert.equal((await c2b.proveRelay(flock.pub, takenOver)).pub, usurperKey.pub,
      'precondition: the address really is answering now with a key nothing vouches for');
    await c2b.gate.refresh([takenOver], flock.pub);
    assert.deepEqual(c2b.relays(), [],
      'an address that started answering with a DIFFERENT key kept its old admission. The cache remembers a ' +
      'proof about a machine, not a grant to an address.');
    c2.close(); c2b.close(); usurper.stop();
  } finally { con.close(); BOX.stop(); }
});

// ── 8. THE FORWARDING PROXY, and the boundary of what this closes ──────────────────────────────────────
test('a host that forwards the proof cannot inherit the canonical pool\'s identity, nor the console\'s own box\'s', async () => {
  // A real forwarder: its own address, no key of its own, and it answers the possession proof by asking a
  // GENUINE relay the same question and passing the real answer back. Nothing is forged.
  const forward = (target) => H.startImpostor({
    name: 'forwarder',
    handler: async (req, res, u) => {
      if (!u.pathname.startsWith('/relay-identity')) return H.sendJson(res, { error: 'not a relay' }, 404);
      const r = await fetch(target.base + '/relay-identity?nonce=' + encodeURIComponent(u.searchParams.get('nonce') || ''));
      H.sendJson(res, await r.json(), r.status);
    },
  });

  // (a) IN FRONT OF A CANONICAL RELAY. The pin is looked up by the address DIALLED, so the forwarder's own
  //     address has no pin at all and the proof it passes on cannot buy it anything.
  const fCanon = await forward(POOLBOX);
  const con = consoleOn({
    church, origin: { protocol: 'https:', host: 'app.example.church' },
    canonical: [POOLBOX.wsUrl], pins: { [POOLBOX.wsUrl]: [POOLBOX.relayPub] }, extra: [fCanon.base + '/relay'],
  });
  try {
    const real = await con.proveRelay(church.pub, POOLBOX.wsUrl);
    assert.equal(real.root, 'canonical', 'precondition: the genuine canonical relay is admitted by its pin');
    const via = await con.proveRelay(church.pub, fCanon.base + '/relay');
    // UPDATED 2026-09-02, when the address binding landed. This used to require that the forwarder DID pass
    // on a valid proof (`via.pub === POOLBOX.relayPub`), so that the refusal below could be shown to be
    // about membership rather than about a broken proxy. That precondition is now unreachable and that is
    // the whole point: the relay refuses to sign an address it does not declare, so a forwarder gets no
    // proof to pass on at all. The refusal has moved one step EARLIER — from "your proof buys you nothing
    // at this address" to "there is no proof". Both are asserted, so neither can regress silently.
    assert.equal(via.pub, '',
      'a forwarder still obtained a proof. The relay is signing an address it does not declare, which is ' +
      'the forwarding hole itself: see relayIdentityUrl in gateway.mjs.');
    assert.equal(via.root, '',
      'a host that merely FORWARDS the possession proof inherited the canonical pool\'s membership at its ' +
      'own address. The pin is looked up by the address dialled precisely so that it cannot.');

    await con.gate.refresh(con.relaysRaw(), church.pub);
    assert.ok(!con.relays().includes(fCanon.base + '/relay'), 'the forwarder reached the publish set anyway');
  } finally { con.close(); fCanon.stop(); }

  // (b) IN FRONT OF THE CONSOLE'S OWN BOX. Same-origin means the address IS the origin; a forwarder is at a
  //     different address and so is not it.
  const fSelf = await forward(SELF);
  const con2 = consoleOn({
    church, extra: [fSelf.base + '/relay'],
    origin: { protocol: 'http:', host: SELF.base.replace(/^https?:\/\//, '') },
  });
  try {
    assert.equal((await con2.proveRelay(church.pub, SELF.wsUrl)).root, 'origin', 'precondition: the origin box is admitted');
    assert.equal((await con2.proveRelay(church.pub, fSelf.base + '/relay')).root, '',
      'a forwarder in front of the box that serves this console inherited its membership at its own address');
  } finally { con2.close(); fSelf.stop(); }

  // (c) THE HALF THAT IS NOT CLOSED, asserted rather than left as prose. Under the CHURCH-SIGNATURE root the
  //     client checks a pubkey and deliberately not an address — a church's own box behind a free tunnel gets
  //     a new one on every restart — so a forwarder in front of a signed box IS admitted. The fix is the
  //     relay's (it must declare and sign its own address; see THE FORWARDING PROXY in src/relay-net.src.js
  //     for why the proof gateway.mjs mints today cannot support the check), and it is plan C6's. This
  //     assertion exists so that when C6 lands and this stops being true, somebody has to come here and say so.
  await H.publishAll(IN, [signIn(church, [IN])]);
  const fChurch = await forward(IN);
  const con3 = consoleOn({ church, origin: { protocol: 'https:', host: 'app.example.church' }, extra: [IN.wsUrl] });
  try {
    // INVERTED 2026-09-02 — this is the change the old assertion was waiting for.
    //
    // It used to require `root === 'church'`: a forwarder in front of a church-SIGNED box inherited that
    // box's membership, because membership is keyed on the pubkey and a forwarder passes on a real proof of
    // it. The note said whoever made the relay sign an address it owns should come here and say so. Done:
    // gateway.mjs now declares its addresses and refuses to sign one it does not, and the client compares
    // the signed address against the one it dialled — so the forwarder gets no proof, and there is nothing
    // left for the church signature to be applied to.
    assert.equal((await con3.proveRelay(church.pub, fChurch.base + '/relay')).root, '',
      'a forwarder in front of a church-signed box inherited that box\'s membership at its own address. ' +
      'The address binding has regressed: see relayIdentityUrl in gateway.mjs and relayAddrKey in ' +
      'src/relay-identity.src.js.');
  } finally { con3.close(); fChurch.stop(); }
});

// ── the member app, as a person has it ──────────────────────────────────────────────────────────────────
// The SHIPPED publishCareRequest over the SHIPPED _publishAny over the SHIPPED gate, with a real pool and
// the real NIP-44 primitives. Nothing between the person pressing Send and the relay's store is a stub, so
// the count taken off each box below is the count of what that person's phone actually sent it.
const hex = (b) => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
function memberOn({ church, relays = [], canonical = [], pins = {}, store = memStore(), team = [] }) {
  const src = FELLOW;
  const me = H.key();
  const pool = new SimplePool();
  pool.automaticallyAuth = () => async (authEvent) => finalizeEvent(authEvent, me.sk);
  const body = [
    gateSource(src),
    fnBody(src, 'function churchRelaysRaw', 'churchRelaysRaw'),
    fnBody(src, 'function _adoptionOrigin', '_adoptionOrigin'),
    stmt(src, 'var _relayNetCache = ', '_relayNetCache'),
    stmt(src, 'var RELAY_NET_TTL_MS = ', 'RELAY_NET_TTL_MS'),
    fnBody(src, 'async function churchRelayNet', 'churchRelayNet'),
    stmt(src, 'var _gate = createRelayGate(', '_gate'),
    fnBody(src, 'function _netRelays', '_netRelays'),
    stmt(src, 'var NO_NETWORK_RELAY = ', 'NO_NETWORK_RELAY'),
    stmt(src, 'var isNoNetworkRelay = ', 'isNoNetworkRelay'),
    fnBody(src, 'function churchRelays()', 'churchRelays'),
    stmt(src, 'var _PUB_FAILED = ', '_PUB_FAILED'),
    stmt(src, 'var _PUB_SILENT = ', '_PUB_SILENT'),
    stmt(src, 'var WEDGE_ACK_MS = ', 'WEDGE_ACK_MS'),
    fnBody(src, 'function _wedgeKey', '_wedgeKey'),
    fnBody(src, 'function _classify', '_classify'),
    fnBody(src, 'function _dedupeRelays', '_dedupeRelays'),
    fnBody(src, 'function _publishAny', '_publishAny'),
  ].join('\n');
  assertGateLift(body, 'vendor/fellowship.js');
  assert.match(body, /const targets = _netRelays\(candidates\)/,
    'vendor/fellowship.js: _publishAny no longer filters the list it was handed — the last line of the gate is gone, ' +
    'and any of its thirty callers could then assemble its own list and walk round it');
  assert.match(body, /pool\.querySync\(churchRelaysRaw\(\)/,
    'vendor/fellowship.js: the membership read has been moved onto the FILTERED list — the read-side deadlock');

  const win = fakeWindow();
  win.Fellowship = { relays: [...relays], churchPub: church.pub, ready: Promise.resolve() };
  const care = fnBody(src, 'async publishCareRequest(fields) {', 'publishCareRequest');
  // …and the health answer, because an empty publish set must not read as health: a `true` here is what
  // DISABLES the app's 90-second safety net (memory: chat-subs-die-on-reconnect).
  const healthy = fnBody(src, 'relaysHealthy() {', 'relaysHealthy');
  // …and the Relays sheet's own question. Same caveat as the console's card: what the SHEET renders cannot
  // be asserted from here (rule 3), but what it is allowed to ask can be.
  const verified = fnBody(src, 'relayVerified(url) {', 'relayVerified');
  const scope = scopeOf({
    localStorage: store, window: win, pool, console, fetch: globalThis.fetch,
    CANONICAL_RELAYS: canonical, CANONICAL_RELAY_PUBS: pins,
    _native: false, _staticHost: false, _loc: null,
    normalizeURL, verifyEvent, finalizeEvent,
    CustomEvent: Ev,
    _noteSendResult: () => {},
    sk: me.sk, pub: me.pub,
    crypto: webcrypto, _hex: hex,
    encrypt: (plain, key) => nip44.encrypt(plain, key),
    decrypt: (ct, key) => nip44.decrypt(ct, key),
    getConversationKey: (a, b) => nip44.utils.getConversationKey(a, b),
    nip44e: (plain, key) => nip44.encrypt(plain, key),
    nip44d: (ct, key) => nip44.decrypt(ct, key),
    nip44ck: (a, b) => nip44.utils.getConversationKey(a, b),
    _fetchCareTeam: async () => team,
    _fetchChildCareAudience: async () => [],
    _sgSelf: { cp: church.pub, me: me.pub, isMinor: false, known: true },
    _sgMine: () => ({ cp: church.pub, me: me.pub, isMinor: false, known: true }),
    NET: 'trinityone', CAREREQ_D: 'trinityone/carereq:', CARETEAM_D: 'trinityone/careteam:',
  });
  const api = new Function('scope', `with (scope) { ${body}
    const _api = { ${care}, ${healthy}, ${verified} };
    return { churchRelays, churchRelaysRaw, _publishAny, gate: _gate, isNoNetworkRelay,
             relaysHealthy: () => _api.relaysHealthy(), relayVerified: (u) => _api.relayVerified(u),
             publishCareRequest: (f) => _api.publishCareRequest(f) }; }`)(scope);
  api.me = me;
  api.pool = pool;
  api.close = () => { try { pool.close(pool.relays ? [...pool.relays.keys()] : []); } catch {} };
  return api;
}

// ── 9. the member's own point of use: a care request, and where it did NOT go ──────────────────────────
test('a care request reaches the relay the church signed for and no other, and a failed one reads as NOT sent', async () => {
  const flock = H.key();
  const [SIGNED, UNSIGNED] = await Promise.all([
    H.startRelay({ name: 'SIGNED', churches: [flock.pub] }),
    H.startRelay({ name: 'UNSIGNED', churches: [flock.pub] }),
  ]);
  await H.publishAll(SIGNED, [signIn(flock, [SIGNED])]);
  // The phone has BOTH addresses in its list — the second is exactly the shape a restored backup or an old
  // invite leaves behind — and both boxes are up and holding this church.
  const app = memberOn({ church: flock, relays: [SIGNED.wsUrl, UNSIGNED.wsUrl] });
  // …and this person really is a member of this church on BOTH boxes, so nothing below turns on the relay
  // refusing a stranger. The only difference between the two boxes is the church's signature.
  for (const box of [SIGNED, UNSIGNED]) await H.publishAll(box, [joinDoc(app.me, flock.pub)]);
  try {
    await app.gate.refresh(app.churchRelaysRaw(), flock.pub);
    assert.deepEqual(app.churchRelays(), [SIGNED.wsUrl], 'the publish set is not exactly the box this church signed for');
    // The Relays sheet asks per address, and must be told the truth about each: the unsigned one stays in the
    // list, keeps being re-checked, and is not carrying this church's traffic. "Connected" over it would be
    // the label lying about the control again (memory: fix-the-control-not-the-label).
    assert.equal(app.relayVerified(SIGNED.wsUrl), true, 'the sheet would show the church\'s own relay as not in use');
    assert.equal(app.relayVerified(UNSIGNED.wsUrl), false,
      'the sheet would still say "Connected" over an address this phone publishes nothing to');

    const res = await app.publishCareRequest({ types: ['meals'], forSelf: true, note: 'Chemo Tuesdays — a lift would help' });
    assert.ok(res && !res.error, 'the shipped care request refused to send at all: ' + JSON.stringify(res));

    const onSigned = (await H.corpus(SIGNED, flock)).filter(e => (e.tags.find(t => t[0] === 'd') || [])[1].startsWith('trinityone/carereq:'));
    const onUnsigned = (await H.corpus(UNSIGNED, flock)).filter(e => (e.tags.find(t => t[0] === 'd') || [])[1].startsWith('trinityone/carereq:'));
    assert.equal(onSigned.length, 1, 'the church\'s own relay did not receive the request');
    assert.equal(onUnsigned.length, 0,
      'a sealed care request reached a relay this church never signed for. The box is up, it holds this ' +
      'church, and it was in the member\'s own relay list — which is precisely the leak this item exists to ' +
      'close, and the reason it is a safeguarding matter and not a networking one.');
  } finally { app.close(); }

  // …AND WHEN THERE IS NOWHERE TO SEND IT, THE PERSON IS TOLD IT DID NOT GO. Same phone, same church, but
  // nothing in the list has ever proved itself. `null` would already read as not-sent — but it reads as
  // "check your connection", which on a perfectly good connection sends somebody asking for help to the
  // wrong place entirely. Its own reason, and one the screen renders as NOT SENT.
  const app2 = memberOn({ church: flock, relays: [UNSIGNED.wsUrl] });
  await H.publishAll(UNSIGNED, [joinDoc(app2.me, flock.pub)]);
  try {
    await app2.gate.refresh(app2.churchRelaysRaw(), flock.pub);
    assert.deepEqual(app2.churchRelays(), [], 'precondition: nothing in this phone\'s list can be proved');
    assert.equal(app2.relaysHealthy(), false,
      'an empty publish set was reported as HEALTH. The app\'s 90-second reconnect beat skips on a healthy ' +
      'answer, so a church whose relays have not proved themselves would sit quietly for ever with nothing ' +
      'recovering it — the exact shape of memory:chat-subs-die-on-reconnect, arriving through a safety gate.');
    const res2 = await app2.publishCareRequest({ types: ['meals'], forSelf: true, note: 'this must not be reported sent' });
    assert.ok(res2 && res2.error, 'a care request that was published NOWHERE came back as a successful send: ' + JSON.stringify(res2));
    assert.equal(res2.error, 'no-network-relay',
      'the member was given "' + res2.error + '". A request that could not be published is not a connection ' +
      'problem and must not be reported as one (memory: fix-the-control-not-the-label).');
    const after = (await H.corpus(UNSIGNED, flock)).filter(e => (e.tags.find(t => t[0] === 'd') || [])[1].startsWith('trinityone/carereq:'));
    assert.equal(after.length, 0, 'the request the member was told was NOT sent is sitting on a relay');
  } finally { app2.close(); SIGNED.stop(); UNSIGNED.stop(); }
});

// ── 10. a message with nowhere to go WAITS; it is not binned and it is not called sent ──────────────────
test('a chat message the gate could not publish stays in the outbox and burns none of its retries', async () => {
  // The other half of the honesty rule, and it is the opposite of the care request's. A message queues —
  // that is the surface the member app already has, and this item builds no other — but a queue only helps
  // if the item survives long enough to be sent. The outbox gives up after MAX_TRIES genuine REFUSALS and
  // deliberately does not count an outage, because nothing reached a relay. A publish set that is empty
  // because nothing could be proved is exactly that: nothing reached a relay. Counting it would drop a
  // member's words after about 37 minutes of retrying against a set that was empty the whole time.
  const src = FELLOW;
  const body = [
    stmt(src, 'var NO_NETWORK_RELAY = ', 'NO_NETWORK_RELAY'),
    stmt(src, 'var isNoNetworkRelay = ', 'isNoNetworkRelay'),
    stmt(src, 'var _PERMANENT = ', '_PERMANENT'),
    stmt(src, 'var isPermanentRefusal = ', 'isPermanentRefusal'),
    stmt(src, 'var _CONNECTION = ', '_CONNECTION'),
    stmt(src, 'var isConnectionFailure = ', 'isConnectionFailure'),
    stmt(src, 'var isRateLimited = ', 'isRateLimited'),
    stmt(src, 'var MAX_TRIES = ', 'MAX_TRIES'),
    fnBody(src, 'async function _outboxFlush', '_outboxFlush'),
  ].join('\n');
  assert.match(body, /isConnectionFailure\(e2\) \|\| isNoNetworkRelay\(e2\)/,
    'vendor/fellowship.js: the outbox no longer treats a gate refusal as an outage — a queued message would ' +
    'burn a retry for a send that never reached a relay, and be given up on');

  const gateErr = new Error('no-network-relay: none of this church\'s relays could be proved to be ours');
  const item = { evt: { id: 'e1' }, tries: 0, at: 1, relays: ['wss://x.invalid'] };
  const state = {
    _outbox: [item], _outboxFailed: [], _flushing: false, sk: 'k',
    _dmPlain: new Map(), _outboxSave: () => {}, window: undefined,
    _publishBounded: async () => { throw gateErr; },
  };
  const scope = scopeOf(state);
  const flush = new Function('scope', `with (scope) { ${body} return _outboxFlush; }`)(scope);
  await flush();
  assert.equal(item.tries, 0,
    'a message that could not be published because nothing was verified burned a retry. Nothing reached a ' +
    'relay, so this is an outage, and after MAX_TRIES of them the member\'s words are given up on.');
  assert.equal(item.failed, undefined, 'the message was marked failed on the first gate refusal');
  assert.equal(state._outboxFailed.length, 0, 'the message was moved to the failed list — it is still waiting');
  assert.match(String(item.lastError), /^no-network-relay/,
    'the outbox recorded "' + item.lastError + '" — the reason a member is shown must say what actually happened');

  // …and the sibling classifications are unchanged, so this is not a blanket "never give up".
  const api = new Function('scope', `with (scope) { ${body} return { isPermanentRefusal, isConnectionFailure, isNoNetworkRelay }; }`)(scope);
  assert.equal(api.isNoNetworkRelay(gateErr), true);
  assert.equal(api.isPermanentRefusal(gateErr), false, 'a gate refusal must not read as a permanent relay refusal — the message would be binned');
  assert.equal(api.isNoNetworkRelay(new Error('blocked: you are not a member')), false);
});

// ── 11. an empty publish set must ANSWER, not hang ─────────────────────────────────────────────────────
test('a read over an empty publish set settles instead of spinning for ever', async () => {
  // Until this item, no list reaching the pool could be empty — loadRelays() refuses to return one and the
  // console appends the canonical pool unconditionally. The publish set IS allowed to be empty, so this state
  // is new, and nostr-tools does not survive it: measured on the shipped library, querySync([]) never settles
  // and subscribeMany([], …) never delivers oneose. A screen waiting on either would spin with no error
  // anywhere — the failure class this codebase calls its worst, arriving as a side effect of a safety gate.
  const bare = new SimplePool();
  const raced = await Promise.race([
    bare.querySync([], [{ kinds: [1] }]).then(() => 'settled'),
    new Promise(r => setTimeout(() => r('hung'), 1200)),
  ]);
  assert.equal(raced, 'hung',
    'nostr-tools now settles querySync([]) on its own — if so the guard in src/*.src.js is no longer needed ' +
    'and should be removed with a note, rather than left as unexplained code');

  for (const [file, src] of [['vendor/fellowship.js', FELLOW], ['vendor/steward.js', STEWARD]]) {
    const body = [
      fnBody(src, 'pool.subscribeMany = (urls, filters, handlers)', 'subscribeMany guard'),
      fnBody(src, 'pool.querySync = (urls, filter, opts)', 'querySync guard'),
    ].join('\n');
    const calls = [];
    const scope = scopeOf({
      pool: {}, _poolSubMany: (...a) => { calls.push(a); return { close() {} }; },
      _poolQuerySync: async () => { calls.push('query'); return ['real']; },
    });
    new Function('scope', `with (scope) { ${body} }`)(scope);
    let eosed = false;
    const sub = scope.pool.subscribeMany([], [{}], { onevent() {}, oneose() { eosed = true; } });
    assert.equal(typeof sub.close, 'function', `${file}: an empty subscription must still be closeable`);
    await new Promise(r => setTimeout(r, 20));
    assert.equal(eosed, true,
      `${file}: a subscription over an empty publish set never reports that the relays finished answering, ` +
      'so every screen waiting on it spins for ever with nothing on screen and nothing in the log');
    assert.deepEqual(await scope.pool.querySync([], [{}]), [],
      `${file}: querySync over an empty publish set does not settle`);
    assert.equal(calls.length, 0, `${file}: the guard passed an empty list through to the library anyway`);
    // …and a non-empty list still reaches the real pool untouched.
    assert.deepEqual(await scope.pool.querySync(['wss://a.example'], [{}]), ['real'], `${file}: the guard swallowed a real read`);
    scope.pool.subscribeMany(['wss://a.example'], [{}], {});
    assert.equal(calls.length, 2, `${file}: the guard swallowed a real subscription`);
  }
});

// ── 12. teardown, asserted rather than trusted ─────────────────────────────────────────────────────────
test('every relay, impostor and temp directory this file created is gone', () => {
  H.stopAll();
  assert.deepEqual(H.leftovers(), { processes: [], dirs: [], impostors: [] },
    'this file left something running: ' + JSON.stringify(H.leftovers()));
});

