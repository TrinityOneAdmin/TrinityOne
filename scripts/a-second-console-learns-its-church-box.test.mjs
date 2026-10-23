// A SECOND CONSOLE OF THE SAME CHURCH LEARNS THE CHURCH'S OWN RELAY, WITHOUT ANYONE TYPING IT AGAIN.
// Relay address gossip, step 1 (TrinityOne-internal/PLAN-relay-address-gossip-2026-10-22 §4).
// Run: node --test scripts/a-second-console-learns-its-church-box.test.mjs
//
// THE MEASURED DEFECT. 2026-10-22, on two phones against live relays: a steward typed the church's own relay
// into the Pixel console; the Oppo console for the SAME church never learned it — five reads over 3.5
// minutes, including a reload and a PIN unlock. Church DATA propagated fine over the shared relay in the same
// window. A console's candidate list is only ever ownRelay() + CANONICAL_RELAYS + what THAT DEVICE typed, and
// nothing ever wrote an address into it from anywhere else. The church's own signed relay-net document
// carries each box's url and was read for the gate's `netEntries` dep alone: the key was used and the address
// was thrown away.
//
// HOW THIS FILE IS DRIVEN, and it is the part that matters. Every relay here is a real `node
// scripts/gateway.mjs` process (scripts/relay-network-harness.mjs). Nothing injects an answer for `one`,
// `netEntries`, `verify` or `relayNetEntries`: injected answers hid two HIGH bugs in self-hosting Phase 1 and
// produced a vacuous safety test in the cancelled Phase 4, so the document is PUBLISHED to a real box and
// read back off the wire, and the proof is a real /relay-identity round trip against a real relay.
//
// THE POINT OF USE (CLAUDE.md rule 1) is the first test: the shipped `setKey` — the function the console runs
// on boot with a key and on every unlock — is lifted out of vendor/steward.js and RUN. Delete the merge from
// the product and that test goes red. Nothing here matches text in app/*.jsx (rule 3).
// SABOTAGE RECORD, 2026-10-22. Ten changes, each scoped to the function under test (the enclosing function
// was sliced, the anchor asserted to appear exactly once inside it, then replaced). Caught, with the number
// of cases that went red out of 13:
//   · the url conversion returns the origin without '/relay'        → 10
//   · the document read is replaced by an empty list                 →  4
//   · the cap (NETDOC_ADOPT_MAX) raised to 10000                     →  1
//   · the key match relaxed to "any key answered"                    →  1
//   · the own-church guard relaxed to `if (!pub)`                    →  1
//   · `_alreadyACandidate` blinded (reads an empty candidate list)    →  1
//   · the origin-only shape check removed from the conversion         →  1
//   · the gate call DELETED outright                                  →  2 (tests 4 and 5)
// SECOND SABOTAGE ROUND, 2026-10-23, over the two fixes from the audit of b759bfa4 — eleven changes, same
// scoping discipline. Caught, out of 18 cases:
//   · the retire pass drops nothing (its proof test blinded)         → 1  (the jam test)
//   · the retire pass drops everything                                → 1  (its sibling)
//   · the retire CALL removed from the merge                          → 1
//   · the `!entries.length` precondition removed                      → 1
//   · a row added without being tagged                                → 14
//   · a row SWAPPED without being tagged                              → 1
//   · the box key stops stripping the path                            → 2
//   · the row-side `!_hasRelayPath(r)` removed (the downgrade guard)  → 2
//   · `_staleBoxSpelling` blinded                                     → 1
//   · the box-key branch of `_alreadyACandidate` blinded              → 1
// NOT caught, and stated rather than hidden:
//   · the `!_hasRelayPath(u)` half of _staleBoxSpelling's first line. It is a contract check on the
//     argument: the one caller always passes an address _netDocDialUrl produced, which always ends in
//     `/relay`. The row-side half is what decides, and that IS caught.
// AND SABOTAGE EARNED ITS KEEP THIS ROUND: blinding the box-key branch left the suite green, which is how
// the first version of the path-less-candidate test was found to be vacuous — it had staged a console that
// could not read the church's document at all. See that test's own note.
//
// FIRST ROUND — not caught, and both are stated rather than hidden:
//   · keeping the gate call but ignoring its answer. On this base `proveRelay` admits on the possession
//     proof alone, so there is no address that proves the key the church signed and that the gate would
//     still refuse — the answer is unfalsifiable here. Deleting the call IS caught (above), because the
//     gate also caches the proof and without it the address is not in the publish set yet.
//   · blinding the merge's own `isOwnRelaySpelling || isSharedRelaySpelling`. The merge writes through
//     `window.Steward.addRelay`, which makes both refusals itself, so the merge's copy is an optimisation
//     that saves one identity probe. The refusal is enforced; which line enforces it is not asserted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import { normalizeURL } from 'nostr-tools/utils';
import { fnBody, stmt } from './test-slice.mjs';
import * as H from './relay-network-harness.mjs';

const RELAY_NET_D = 'trinityone/relay-net';
const GROUP_D = 'trinityone/group:';
const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const settle = () => new Promise(r => setImmediate(r));
// The stamp caps READ OUT OF THE BUNDLE rather than typed here: STAMP_CAP_SEC is defined in terms of
// _CLOCK_SKEW, so all three are lifted together. A sixth hand-copied tolerance constant is the drift the
// relay-corrected-time work exists to stop.
const CAPS = new Function(
  stmt(STEWARD, 'var _CLOCK_SKEW = ', '_CLOCK_SKEW') + '\n'
  + stmt(STEWARD, 'var STAMP_CAP_SEC = ', 'STAMP_CAP_SEC') + '\n'
  + stmt(STEWARD, 'var SKEW_CAP_SEC = ', 'SKEW_CAP_SEC')
  + '\nreturn { _CLOCK_SKEW, STAMP_CAP_SEC, SKEW_CAP_SEC };')();

// ── THE PROHIBITION, asserted rather than promised ──────────────────────────────────────────────────────
// The single most important "do not" in the plan: `_churchRelays` (src/fellowship.src.js) drives
// relaysForChurch's self-sufficiency count, and `_applyChurchList` revokes anything in it that is not in the
// newest kind-10002 list — which a doc-discovered address never is. An independent audit established that
// writing it produces a remove/re-add loop with a `pool.close` on every churn. The console bundle must not
// contain that symbol at all, so this cannot be reintroduced here by accident.
test('the console bundle never writes _churchRelays — the remove/re-add loop cannot be reached from here', () => {
  // DECIDES FIRST: nothing. This is a whole-bundle text assertion against vendor/steward.js (allowed — it is
  // bundled and tree-shaken, so a dead `false &&` branch would have been removed), with no earlier gate.
  assert.equal(STEWARD.includes('_churchRelays'), false,
    'vendor/steward.js now mentions _churchRelays. That map belongs to the member app; writing a ' +
    'doc-discovered address into it produces a remove/re-add loop with a pool.close on every tunnel churn.');
  const adopt = fnBody(STEWARD, 'async function adoptNetDocAddresses', 'adoptNetDocAddresses');
  assert.doesNotMatch(adopt, /_churchList|_applyChurchList|_saveChurchBoxes/,
    'the merge reaches into the member side\'s church-relay bookkeeping');
});

// ── IS THE FEATURE STILL WIRED INTO THE PRODUCT? ───────────────────────────────────────────────────────
// This runs FIRST of the subject tests and exists to make the failure legible. Remove the call from setKey
// and esbuild tree-shakes the whole family out of the bundle, so every lift below dies with
// "adoptNetDocAddresses is missing — re-anchor this test" — a true red, but one that reads like a broken
// test rather than a missing feature. (CLAUDE.md warns about exactly this artefact, which is why the merge
// is a named function called from setKey and not a one-caller helper hidden behind another.) Measured: with
// the call deleted, 10 of the 13 tests measured at the time went red (the file has grown since).
//
// A text assertion against vendor/*.js is allowed where one against app/*.jsx is not (CLAUDE.md rule 3): the
// bundle is tree-shaken, so a `false &&` branch is REMOVED and the text would disappear with it.
test('setKey still merges the church\'s signed addresses — the feature is wired into the product', () => {
  // DECIDES FIRST: `fnBody`'s own "is missing" assertion, if setKey itself were renamed or removed. Nothing
  // else stands in front of this.
  const setKeyBody = fnBody(STEWARD, 'function setKey(mnemonic) {', 'setKey');
  assert.match(setKeyBody, /adoptNetDocAddresses\(\)/,
    'THE FEATURE IS GONE FROM THE PRODUCT. setKey — which the console runs on boot with a key and on every ' +
    'unlock — no longer reads the addresses out of the church\'s own signed relay-net document, so a second ' +
    'console of the same church can never learn its own box. That is the defect measured on two phones on ' +
    '2026-10-22, and everything else in this file is about how well the merge behaves once it is called.');
  assert.match(setKeyBody, /_gate\.refresh\(relaysRaw\(\), pub\)/,
    're-anchor: the merge is meant to sit on the same unlock tick as the gate refresh, and that refresh has moved');
});

// ── a browser's worth of world ──────────────────────────────────────────────────────────────────────────
function memStore(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
           get length() { return m.size; }, key: (i) => [...m.keys()][i] };
}
function fakeWindow(steward) {
  const events = [];
  return { events, Steward: steward || {}, dispatchEvent: (e) => { events.push({ type: e.type, detail: e.detail }); return true; },
           addEventListener: () => {}, removeEventListener: () => {} };
}
class Ev { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } }
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

// ── THE CONSOLE, out of the shipped bundle ───────────────────────────────────────────────────────────────
// setKey and everything it reaches, plus relays()/relaysRaw() to read the result off, plus publishGroup so a
// write can be watched landing on the box the merge discovered.
function makeConsole({ church, origin, canonical = [], pins = {}, extra = [], boxHostsUs = null, seed = {} }) {
  const src = STEWARD;
  const store = memStore(seed);
  const pool = new SimplePool();
  pool.automaticallyAuth = () => async (authEvent) => finalizeEvent(authEvent, church.sk);
  const body = [
    // the identity proof and the C4 gate — REAL, against a real /relay-identity
    fnBody(src, 'function relayIdentityNonce', 'relayIdentityNonce'),
    fnBody(src, 'function relayHttpBase', 'relayHttpBase'),
    fnBody(src, 'function relayAddrKey', 'relayAddrKey'),
    fnBody(src, 'async function verifyRelayIdentityDetailed', 'verifyRelayIdentityDetailed'),
    fnBody(src, 'async function verifyRelayIdentity(wssUrl) {', 'verifyRelayIdentity'),
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
    fnBody(src, 'function rememberVerified', 'rememberVerified'),
    fnBody(src, 'function createRelayGate', 'createRelayGate'),
    // the console's own list assembly
    fnBody(src, 'function lsGet', 'lsGet'),
    fnBody(src, 'function lsSet', 'lsSet'),
    stmt(src, 'var RELAYS_LS = ', 'RELAYS_LS'),
    fnBody(src, 'function normRelay', 'normRelay'),
    fnBody(src, 'function ownRelay', 'ownRelay'),
    fnBody(src, 'function extraRelays', 'extraRelays'),
    fnBody(src, 'function relaysRaw', 'relaysRaw'),
    fnBody(src, 'function _ownOrigin', '_ownOrigin'),
    fnBody(src, 'function isSharedRelaySpelling', 'isSharedRelaySpelling'),
    fnBody(src, 'function isOwnRelaySpelling', 'isOwnRelaySpelling'),
    fnBody(src, 'function relayNetCandidates', 'relayNetCandidates'),
    fnBody(src, 'function _oneComplete', '_oneComplete'),
    fnBody(src, 'function relayNetDoc', 'relayNetDoc'),
    fnBody(src, 'async function relayNetEntries', 'relayNetEntries'),
    stmt(src, 'var _gate = createRelayGate(', '_gate'),
    fnBody(src, 'function relays()', 'relays'),
    stmt(src, 'var NO_NETWORK_RELAY = ', 'NO_NETWORK_RELAY'),
    fnBody(src, 'async function admitRemoteRelay', 'admitRemoteRelay'),
    fnBody(src, 'function _connectedRelays', '_connectedRelays'),
    // THE SUBJECT
    stmt(src, 'var _isLoopbackRelay = ', '_isLoopbackRelay'),
    fnBody(src, 'function _netDocDialUrl', '_netDocDialUrl'),
    fnBody(src, 'function _alreadyACandidate', '_alreadyACandidate'),
    stmt(src, 'var NETDOC_ADOPT_MAX = ', 'NETDOC_ADOPT_MAX'),
    fnBody(src, 'function _netDocBoxKey', '_netDocBoxKey'),
    stmt(src, 'var _hasRelayPath = ', '_hasRelayPath'),
    fnBody(src, 'function _staleBoxSpelling', '_staleBoxSpelling'),
    fnBody(src, 'function _writeExtraRelays', '_writeExtraRelays'),
    stmt(src, 'var ADOPTED_LS = ', 'ADOPTED_LS'),
    fnBody(src, 'function adoptedRelays', 'adoptedRelays'),
    fnBody(src, 'function setAdoptedRelays', 'setAdoptedRelays'),
    fnBody(src, 'function _tagAdopted', '_tagAdopted'),
    fnBody(src, 'async function retireDeadAdoptedRows', 'retireDeadAdoptedRows'),
    fnBody(src, 'async function adoptNetDocAddresses', 'adoptNetDocAddresses'),
    // THE POINT OF USE
    fnBody(src, 'function setKey(mnemonic) {', 'setKey'),
    // what a write needs
    fnBody(src, 'function _requireTrustedView', '_requireTrustedView'),
    fnBody(src, 'function _isRelayAuthed', '_isRelayAuthed'),
    fnBody(src, 'async function publish(', 'publish'),
    fnBody(src, 'function _readCovers', '_readCovers'),
    stmt(src, 'var _viewingNetwork = ', '_viewingNetwork'),
    fnBody(src, 'async function unenrolRelayNet', 'unenrolRelayNet'),
    stmt(src, 'var NET = ', 'NET'),
    stmt(src, 'var GROUP_D = ', 'GROUP_D'),
    fnBody(src, 'function _monotonic', '_monotonic'),
  ].join('\n');
  // GUARDS ON THE LIFT. A slice that stopped containing the load-bearing line would leave every assertion in
  // this file passing over nothing. These are the three lines the whole file turns on.
  assert.match(body, /const _p = adoptNetDocAddresses\(\)/,
    'vendor/steward.js: setKey no longer merges the church\'s signed addresses into the candidate list. ' +
    'THE FEATURE IS GONE FROM THE PRODUCT — a second console can never learn its church\'s own box.');
  assert.match(body, /return _gate\.admit\(relaysRaw\(\), pub\)/, 'vendor/steward.js: relays() is no longer the gated publish set');
  const adopt = fnBody(src, 'async function adoptNetDocAddresses', 'adoptNetDocAddresses');
  assert.match(adopt, /await admitRemoteRelay\(u\)/, 'the merge no longer proves an address before adopting it');
  assert.match(adopt, /window\.Steward\.addRelay\(u\)/, 'the merge no longer writes through the console\'s own Add route');
  assert.match(adopt, /await retireDeadAdoptedRows\(\)/,
    'THE RETIRE PASS IS GONE. A row this path added that stops answering then stays for ever, and two of ' +
    'them wedge every change to the church\'s relay list — the HIGH finding of the 2026-10-22 audit.');
  assert.match(adopt, /_staleBoxSpelling\(u\)/,
    'the merge no longer recognises a box it already lists at an address that cannot be dialled');

  const win = fakeWindow();
  const scope = scopeOf({
    localStorage: store, window: win, location: origin, pool, console,
    CANONICAL_RELAY: canonical[0] || 'wss://canonical.invalid/relay',
    CANONICAL_RELAYS: canonical,
    CANONICAL_RELAY_PUBS: pins,
    _boxHostsUs: boxHostsUs,
    // AN UNLOCKED CONSOLE OF THIS CHURCH, which is what setKey leaves behind. Started EMPTY first and
    // every refusal test in this file then passed on adoptNetDocAddresses' first line (`pub !== churchPub`)
    // without reaching the thing it named — four vacuous passes. Set here instead, and each refusal test
    // pairs with an adoption over the same document so a guard that refused everything would be caught.
    pub: church.pub, sk: church.sk, churchPub: church.pub, churchSk: church.sk, actingChurch: '',
    currentMnemonic: null,
    now: () => Math.floor(Date.now() / 1000),
    finalizeEvent, verifyEvent, normalizeURL, fetch: globalThis.fetch,
    CustomEvent: Ev,
    // setKey's neighbours. Each is a real function in the bundle whose business is not this one's: the
    // sealed-net-key migration, the last-blocklist cache, and the two box-hosts reads (which need an admin
    // token on loopback and return early without one). Stubbed so the lift is setKey and its merge, not the
    // whole console — and NOT one of the four the brief forbids stubbing (`one`, `netEntries`, `verify`,
    // `relayNetEntries`), every one of which is real here.
    privateKeyFromSeedWords: () => church.sk,
    getPublicKey: () => church.pub,
    npubEncode: () => 'npub1' + church.pub.slice(0, 8),
    _migrateNetKeysToSealed: () => {},
    _blockedLastSet: () => new Set(),
    _localBlocked: new Set(), _localBlockedAt: 0,
    _loadBoxHosts: () => {}, _refreshBoxHostsUs: () => {},
    _waitForRegistration: async () => {},
    _lastStamp: new Map(),
    _skewShift: () => 0,
    ...CAPS,
  });
  store.setItem('trinityone.steward.extra-relays', JSON.stringify(extra));
  const api = new Function('scope', `with (scope) { ${body}
    window.Steward = {
      addRelay(input) {
        const url = normRelay(input);
        if (!url || url === ownRelay() || isOwnRelaySpelling(input) || isOwnRelaySpelling(url)) return false;
        if (isSharedRelaySpelling(input) || isSharedRelaySpelling(url)) return false;
        const cur = extraRelays(); if (cur.includes(url)) return false;
        lsSet(RELAYS_LS, JSON.stringify([...cur, url]));
        return url;
      },
    };
    return { setKey, relays, relaysRaw, extraRelays, gate: _gate,
             adopt: () => adoptNetDocAddresses(),
             dial: _netDocDialUrl,
             publish: (ev) => publish(ev),
             unsignRelay: (u) => unenrolRelayNet(u),
             readCovers: async () => _readCovers(await relayNetDoc()),
             adopted: () => adoptedRelays(),
             retire: () => retireDeadAdoptedRows(),
             boxKey: _netDocBoxKey,
             staleSpelling: _staleBoxSpelling,
             sharedSpelling: isSharedRelaySpelling,
             ownSpelling: isOwnRelaySpelling,
             setChurch: (p) => { pub = p; churchPub = p; },
             setDelegated: (p) => { pub = p; actingChurch = p; },
             setNetworkView: (p) => { pub = p; actingChurch = ''; },
             cap: NETDOC_ADOPT_MAX }; }`)(scope);
  api.win = win;
  api.store = store;
  api.close = () => { try { pool.close(pool.relays ? [...pool.relays.keys()] : []); } catch {} };
  return api;
}
// `window.Steward.addRelay` above is NOT a mirror written here: it is the bundle's own method body, taken out
// of vendor/steward.js and checked against it, so a change to the real Add route's refusals changes this too.
test('the Add route this file installs is the shipped one, character for character', () => {
  // DECIDES FIRST: nothing — a text comparison with no gate in front of it.
  const real = fnBody(STEWARD, '    addRelay(input) {', 'window.Steward.addRelay');
  for (const line of ['const url = normRelay(input);',
                      'if (!url || url === ownRelay() || isOwnRelaySpelling(input) || isOwnRelaySpelling(url)) return false;',
                      'if (isSharedRelaySpelling(input) || isSharedRelaySpelling(url)) return false;',
                      'const cur = extraRelays();']) {
    assert.ok(real.includes(line), 'vendor/steward.js: the Add route changed (' + line + ') — update the copy in this file');
  }
});

// How many copies of one document a box holds, read off THAT BOX'S OWN STORE as the church key.
async function held(relay, church, prefix) {
  const evs = await H.corpus(relay, church);
  return evs.filter(e => String((e.tags.find(t => t[0] === 'd') || [])[1] || '').startsWith(prefix)).length;
}
// A RELAYABLE EVENT IS REPLACEABLE, AND A RELAY REFUSES AN OLDER OR EQUAL COPY. Several tests here publish a
// new relay-net document to the same box within the same second, so the stamp is stepped by hand — without
// this the second publish comes back "a newer version of this is already stored" and the test that follows is
// reading the PREVIOUS test's document.
let _docAt = Math.floor(Date.now() / 1000);
const relayNetDocFor = (church, rows) => finalizeEvent(
  { kind: 30078, created_at: ++_docAt, tags: [['d', RELAY_NET_D], ['t', 'trinityone']], content: JSON.stringify(rows) }, church.sk);

// A console that has typed NOTHING, served from a host that runs no relay, with only the shared pool compiled
// in — the second phone, exactly as measured.
const SECOND_CONSOLE_ORIGIN = { protocol: 'https:', host: 'console.example.church' };

// `other` is a SECOND REAL CHURCH, registered on the shared relay like the first. It exists for the last
// test: a document that genuinely names a provable box, under a key that is not this console's own, so the
// own-church guard is the only thing that can refuse it.
let church, other, BOX, SHARED;
before(async () => {
  church = H.key();
  other = H.key();
  [BOX, SHARED] = await Promise.all([
    H.startRelay({ name: 'church-box', churches: [church.pub, other.pub] }),
    H.startRelay({ name: 'shared', churches: [church.pub, other.pub] }),
  ]);
  assert.notEqual(BOX.relayPub, SHARED.relayPub, 'the two relays must be two separate boxes or nothing below means anything');
});
after(() => H.stopAll());

// ── 1. THE POINT OF USE ─────────────────────────────────────────────────────────────────────────────────
test('a second console that typed nothing ends up with the church\'s own box in its publish set, and writes to it', async () => {
  // The church has signed its box — published to the SHARED relay, which is the only relay this console has.
  await H.publishAll(SHARED, [relayNetDocFor(church, [{ pubkey: BOX.relayPub, alwaysOn: true, url: BOX.wsUrl }])]);
  const con = makeConsole({ church, origin: SECOND_CONSOLE_ORIGIN, canonical: [SHARED.wsUrl] });
  try {
    // WHICH LINE DECIDES FIRST. setKey's merge is guarded by `pub !== churchPub`, and setKey assigns BOTH
    // from the mnemonic one line earlier, so on this path that guard can never short-circuit — which is why
    // the delegated/network test below has to set them apart by hand to exercise it. Inside
    // adoptNetDocAddresses every line before the key check only ever `continue`s or `break`s: the cap (the
    // store is empty), the conversion (BOX.wsUrl is already in dialling form), the two spelling refusals
    // (the origin runs no relay and this is not the shared address) and the dedup (nothing is listed). So
    // the lines that decide the OUTCOME are the key match and then `await admitRemoteRelay(u)` — two real
    // round trips to a real box. Both are driven as REFUSALS by their own tests below (a key the church
    // never signed; an address nothing answers at; and, measured separately, deleting the gate call outright
    // turns this test red), so none of this is asserted from reading the code.
    con.setKey('x '.repeat(12).trim());
    assert.deepEqual(con.extraRelays(), [], 'the console started with a typed address — this is not the measured case');

    // setKey is synchronous and the merge is fire-and-forget, as the gate refresh beside it already is.
    for (let i = 0; i < 240 && !con.extraRelays().length; i++) await sleep(250);

    assert.ok(con.relaysRaw().includes(BOX.wsUrl),
      'THE SECOND CONSOLE NEVER LEARNED ITS CHURCH\'S OWN BOX. Its candidate list is ' +
      JSON.stringify(con.relaysRaw()) + '. The church has signed that box into its own relay-net document ' +
      'and this console read that document (it had to, to admit anything at all) — it simply threw the ' +
      'address away, which is the defect measured on two phones on 2026-10-22.');
    assert.ok(con.relays().includes(BOX.wsUrl),
      'the address was adopted but is not in the PUBLISH set: ' + JSON.stringify(con.relays()) +
      '. A candidate nothing may publish to is not a relay the church gained.');

    // AND IT IS A DIALABLE ADDRESS, not merely a string in a list. The only proof of that is a document
    // landing in the box's own store, so the console's own `publish()` — the writer that targets relays(),
    // the publish set — is driven and the box is then read over /sync as the church key.
    //
    // `publish()` AND NOT `publishGroup()`, and the reason is measured rather than chosen: publishGroup goes
    // through `_publishToRelays`, which targets `_connectedRelays()` — the relays with an OPEN socket — and
    // a box adopted a moment ago has none yet, so its first write legitimately goes only to the relays
    // already connected. That is pre-existing behaviour of that writer and is not what this change claims to
    // fix; the box picks those documents up on any later write, once a read has opened the socket. What this
    // change claims is that the address reaches the publish set and can be dialled, and publish() is the
    // writer that uses the publish set.
    const before = await held(BOX, church, GROUP_D);
    const doc = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000),
      tags: [['d', GROUP_D + 'gossip-test'], ['t', 'trinityone']], content: '{}' }, church.sk);
    const r = await con.publish(doc);
    assert.ok(r && r.id, 'the console could not write at all — staging fault, not the subject');
    // POLLED, NOT SLEPT: publish() resolves on the FIRST relay's OK (Promise.any), and the socket to a
    // freshly adopted box has to be opened and NIP-42 logged in first, so that box's OK legitimately lands
    // after the call returns. The assertion is the same either way; this only stops a true result being read
    // too early.
    const landed = await H.waitFor(async () => (await held(BOX, church, GROUP_D)) > before,
      { timeout: 20000, label: 'the document reaching the adopted box' }).then(() => true, () => false);
    assert.equal(landed && await held(BOX, church, GROUP_D), before + 1,
      'the church\'s own box received nothing. The address reached the publish set but cannot be dialled — ' +
      'which is the url-conversion trap: the document stores an ORIGIN or a path-less address, and the ' +
      'relay destroys any upgrade whose path is not exactly /relay.');
  } finally { con.close(); }
});

// ── 2. THE CONVERSION, against a real relay ─────────────────────────────────────────────────────────────
test('the ORIGIN form that `trinityone/relays` seeds in is converted to something a real relay accepts', async () => {
  // `syncEnable` writes `url: r.base` into trinityone/relays — the HTTP origin, '/relay' already stripped —
  // and enrolRelayNet's one-time seed copies that verbatim into the relay-net document. So this shape is in
  // real churches' documents, and as written it connects to nothing.
  const origin = BOX.base;                                  // http://127.0.0.1:<port>
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/, 're-anchor: the harness no longer hands out an http origin');

  // FIRST: the raw form really is undialable, so the conversion is load-bearing rather than cosmetic.
  const raw = origin.replace(/^http:/, 'ws:');
  const rawOk = await new Promise((res) => {
    const w = new WebSocket(raw);
    const done = (v) => { try { w.close(); } catch {} res(v); };
    w.on('open', () => done(true)); w.on('error', () => done(false)); w.on('close', () => done(false));
    setTimeout(() => done(false), 5000);
  });
  assert.equal(rawOk, false, 'the bare origin DOES accept a websocket — then this conversion is not needed ' +
    'and the gateway\'s upgrade rule has changed; re-derive before trusting anything in this file');

  await H.publishAll(SHARED, [relayNetDocFor(church, [{ pubkey: BOX.relayPub, alwaysOn: true, url: origin }])]);
  const con = makeConsole({ church, origin: SECOND_CONSOLE_ORIGIN, canonical: [SHARED.wsUrl] });
  try {
    // DECIDES FIRST: `_netDocDialUrl` returns '' for anything it cannot reduce to origin + '/relay', and a ''
    // makes the loop `continue` before the proof. So if the conversion were wrong this would adopt nothing —
    // which is the assertion, not a side effect of it.
    assert.equal(con.dial(origin), BOX.wsUrl, 'the origin was not converted to the address the relay answers at');
    const added = await con.adopt();
    assert.deepEqual(added, [BOX.wsUrl], 'the seeded ORIGIN form was not adopted as a dialable address');
    const before = await held(BOX, church, GROUP_D);
    const doc = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000),
      tags: [['d', GROUP_D + 'converted'], ['t', 'trinityone']], content: '{}' }, church.sk);
    assert.ok(await con.publish(doc), 'the write failed outright');
    const landed = await H.waitFor(async () => (await held(BOX, church, GROUP_D)) > before,
      { timeout: 20000, label: 'the document reaching the box at the converted address' }).then(() => true, () => false);
    assert.equal(landed && await held(BOX, church, GROUP_D), before + 1,
      'the converted address did not reach the box — the conversion produced a string, not a dialling address');
  } finally { con.close(); }
});

test('every shape the document can hold reduces to the one path the relay upgrades on, or to nothing', () => {
  // DECIDES FIRST: `if (!s) return ''` for an empty value; for every row below the deciding line is named.
  const con = makeConsole({ church: { sk: new Uint8Array(32).fill(1), pub: 'a'.repeat(64) }, origin: SECOND_CONSOLE_ORIGIN });
  try {
    const d = con.dial;
    // the four shapes measured in this tree (see the comment above _netDocDialUrl)
    assert.equal(d('wss://box.example/relay'), 'wss://box.example/relay', 'the already-dialable form was altered');
    assert.equal(d('wss://box.example'), 'wss://box.example/relay', 'a path-less typed address was not given the relay path');
    assert.equal(d('https://box.example'), 'wss://box.example/relay', 'the seeded https origin was not converted');
    assert.equal(d('ws://192.168.1.50:7777/relay'), 'ws://192.168.1.50:7777/relay', 'a LAN box was refused for its scheme');
    // normalisation edges — each one would otherwise become a second row for the same box on every unlock
    assert.equal(d('wss://box.example/relay/'), 'wss://box.example/relay', 'a trailing slash was not collapsed');
    assert.equal(d('wss://box.example/'), 'wss://box.example/relay', 'a bare trailing slash was not collapsed');
    assert.equal(d('http://192.168.1.50:7777'), 'ws://192.168.1.50:7777/relay', 'an http LAN origin was not converted');
    // and the things that can never be dialled: dropped, never guessed at
    for (const bad of ['', null, undefined, 'box.example', 'nostr://box.example', 'wss://box.example/foo',
                       'wss://box.example/relay?x=1', 'wss://user@box.example', 'wss://', 'wss://box example']) {
      assert.equal(d(bad), '', 'an undialable entry was turned into an address: ' + JSON.stringify(bad));
    }
  } finally { con.close(); }
});

// ── 3. IT IS NOT UNCONDITIONAL ──────────────────────────────────────────────────────────────────────────
test('an address that proves a key the church never signed is NOT adopted — admission is still the key', async () => {
  // RELAY-ADMISSION trap 2: admission matches the relay's KEY, never its URL. Here the church's document
  // names a key that no box holds, at an address where a REAL, HEALTHY, UP relay answers with a different
  // one. Nothing may be adopted — and if it were, the url would have decided.
  await H.publishAll(SHARED, [relayNetDocFor(church, [{ pubkey: 'f'.repeat(64), alwaysOn: true, url: BOX.wsUrl }])]);
  const con = makeConsole({ church, origin: SECOND_CONSOLE_ORIGIN, canonical: [SHARED.wsUrl] });
  try {
    // DECIDES FIRST — CORRECTED after the 2026-10-22 audit, which pointed out that this note credited the
    // wrong line. `_netDocDialUrl` returns BOX.wsUrl unchanged (asserted below, so a '' cannot be the reason
    // this passes); isOwnRelaySpelling/isSharedRelaySpelling are both false for a loopback harness address
    // that is neither the origin nor in CANONICAL_RELAYS; `_staleBoxSpelling` and `_alreadyACandidate` are
    // false for an empty extraRelays(). So THE KEY CHECK is what refuses — the entry names ffff… and the box
    // proves its own key. `admitRemoteRelay` never runs, and on this base it could not refuse this address
    // anyway: by the time anything reaches it, root 3 holds by construction.
    assert.equal(con.dial(BOX.wsUrl), BOX.wsUrl, 'the conversion dropped the address, so this test proves nothing');
    const added = await con.adopt();
    assert.deepEqual(added, [],
      'a box whose key the church never signed was adopted. The document named ' + 'f'.repeat(8) + '… and ' +
      'that address proves ' + BOX.relayPub.slice(0, 8) + '… — so the URL decided, which is exactly the ' +
      '"fix" RELAY-ADMISSION trap 2 forbids.');
    assert.equal(con.extraRelays().length, 0, 'the candidate store grew anyway');
  } finally { con.close(); }
});

test('an address nothing answers at is NOT adopted — a dead entry never joins the list', async () => {
  const dead = await H.startRelay({ name: 'dead', churches: [church.pub] });
  const deadUrl = dead.wsUrl, deadPub = dead.relayPub;
  dead.stop();
  await H.publishAll(SHARED, [relayNetDocFor(church, [{ pubkey: deadPub, alwaysOn: true, url: deadUrl }])]);
  const con = makeConsole({ church, origin: SECOND_CONSOLE_ORIGIN, canonical: [SHARED.wsUrl] });
  try {
    // DECIDES FIRST — CORRECTED after the 2026-10-22 audit, which pointed out that this note credited the
    // wrong line. The conversion (asserted), then the two spelling refusals (false), then
    // `_staleBoxSpelling`/`_alreadyACandidate` (false). THE KEY CHECK is the refusal: its /relay-identity
    // fetch to a port nothing listens on returns nothing, so `proved` is '' and the row is skipped before
    // `admitRemoteRelay` is ever reached.
    assert.equal(con.dial(deadUrl), deadUrl, 'the conversion dropped the address, so this test proves nothing');
    assert.deepEqual(await con.adopt(), [],
      'an address that answers nothing was added to the candidate list. Every console then dials it on ' +
      'every read, for ever — the "gossiping junk" risk the plan names.');
  } finally { con.close(); }
});

// ── 4. THE REFUSALS AND THE BOUND ───────────────────────────────────────────────────────────────────────
test('the console\'s own relay and the shared pool are refused, under either normalisation', async () => {
  // Both are already in relaysRaw() unconditionally (ownRelay() first, CANONICAL_RELAYS appended), so
  // adopting a second spelling of either buys nothing and costs a dial per read.
  const spellings = [
    SHARED.wsUrl.replace('/relay', '//relay'),                       // normalizeURL collapses this onto the shared relay
    SHARED.wsUrl.replace(/^ws:/, 'wss:'),                            // relayAddrKey ignores the scheme
    SHARED.wsUrl + '/',
  ];
  await H.publishAll(SHARED, [relayNetDocFor(church, spellings.map((u, i) => ({ pubkey: String(i).repeat(64).slice(0, 64), url: u })))]);
  const con = makeConsole({ church, origin: SECOND_CONSOLE_ORIGIN, canonical: [SHARED.wsUrl] });
  try {
    // DECIDES FIRST: for each row the conversion succeeds (each is a wss?/host[:port] with at most a /relay
    // path), so `isSharedRelaySpelling(u)` is the deciding line. Asserted directly as well as through the
    // merge, because a conversion that returned '' would make the merge's silence meaningless.
    for (const u of spellings) assert.notEqual(con.dial(u), '', 'the conversion dropped ' + u + ' — the refusal below would prove nothing');
    assert.deepEqual(await con.adopt(), [], 'a second spelling of the shared relay was adopted: ' + JSON.stringify(con.extraRelays()));
  } finally { con.close(); }

  // …and the console's own serving origin, which `ownRelay()` already provides.
  const onBox = { protocol: 'http:', host: '127.0.0.1:' + BOX.port };
  await H.publishAll(SHARED, [relayNetDocFor(church, [{ pubkey: BOX.relayPub, url: BOX.wsUrl }])]);
  const own = makeConsole({ church, origin: onBox, canonical: [SHARED.wsUrl], boxHostsUs: true });
  try {
    assert.ok(own.relaysRaw().includes(BOX.wsUrl), 'staging fault: the own box is not already the first candidate');
    // DECIDES FIRST: `isOwnRelaySpelling(u)` — and `_alreadyACandidate(u)` would also refuse it one line
    // later, which is belt and braces rather than a vacuous pass: the assertion is that the store stays
    // empty, and either line keeps it so for the same reason.
    assert.deepEqual(await own.adopt(), [], 'the console adopted a second copy of the box it is served by');
    assert.deepEqual(own.extraRelays(), [], 'the candidate store grew');
  } finally { own.close(); }
});

test('the cap stops a churning tunnel address growing the candidate list for ever', async () => {
  const full = Array.from({ length: 8 }, (_, i) => 'wss://old-tunnel-' + i + '.example/relay');
  await H.publishAll(SHARED, [relayNetDocFor(church, [{ pubkey: BOX.relayPub, alwaysOn: true, url: BOX.wsUrl }])]);
  const con = makeConsole({ church, origin: SECOND_CONSOLE_ORIGIN, canonical: [SHARED.wsUrl], extra: full });
  try {
    assert.equal(con.cap, 8, 'the bound moved — this test states the number it was written against');
    // DECIDES FIRST: `if (have >= NETDOC_ADOPT_MAX) break;` is the first statement of the loop body, before
    // the conversion and before the proof. The address offered here is a REAL, provable box — test 1 adopts
    // this exact row — so the only thing that can refuse it is the cap.
    assert.deepEqual(await con.adopt(), [], 'the cap did not hold: ' + JSON.stringify(con.extraRelays()));
    assert.equal(con.extraRelays().length, 8, 'the store grew past the bound');
  } finally { con.close(); }

  // And one below the bound it still adopts, so the test above is the cap and not a dead loop.
  const con2 = makeConsole({ church, origin: SECOND_CONSOLE_ORIGIN, canonical: [SHARED.wsUrl], extra: full.slice(0, 7) });
  try {
    assert.deepEqual(await con2.adopt(), [BOX.wsUrl], 'nothing is adopted even below the cap — the loop is dead, not bounded');
  } finally { con2.close(); }
});

test('an address already listed is not adopted a second time under another spelling', async () => {
  // SAME BOX, DIFFERENT SCHEME. The store already holds the `wss://` spelling; the document offers `ws://`.
  // `addRelay` compares strings exactly, so it would add a second row; `relayAddrKey` — which excludes the
  // scheme on purpose, because one box is legitimately dialled wss:// through a tunnel and ws:// on the
  // loopback behind it — calls them ONE address, and `_alreadyACandidate` is the only thing that asks.
  //
  // THIS STAGING IS THE WAY ROUND IT IS FOR A MEASURED REASON. With the spellings swapped (ws:// stored,
  // wss:// offered) the test passed and proved nothing: the identity proof of a `wss://` address against a
  // plain-http harness box fails, so the KEY CHECK refused it and the dedup was never reached. Sabotage
  // confirmed that — blinding `_alreadyACandidate` left the suite green. This way the offered address is the
  // probeable one, so the dedup is the only line that can refuse it.
  await H.publishAll(SHARED, [relayNetDocFor(church, [{ pubkey: BOX.relayPub, alwaysOn: true, url: BOX.wsUrl }])]);
  const already = BOX.wsUrl.replace(/^ws:/, 'wss:');
  const con = makeConsole({ church, origin: SECOND_CONSOLE_ORIGIN, canonical: [SHARED.wsUrl], extra: [already] });
  try {
    // DECIDES FIRST: the conversion keeps `ws://…/relay` unchanged (asserted), both spelling refusals are
    // false (neither the origin nor the shared relay), so `_alreadyACandidate(u)` decides — and it decides
    // BEFORE the proof, which is the point: a duplicate must not even cost a probe.
    assert.equal(con.dial(BOX.wsUrl), BOX.wsUrl, 'the conversion rewrote the address, so this test proves nothing');
    assert.deepEqual(await con.adopt(), [],
      'the same box was adopted a second time under another spelling. The pool would then hold two sockets ' +
      'to one relay and the Relays card would show the church two boxes where it has one.');
    assert.deepEqual(con.extraRelays(), [already], 'the store changed: ' + JSON.stringify(con.extraRelays()));
  } finally { con.close(); }
});

test('a PINNED shared relay that is not in the compiled list is still refused', async () => {
  // THIS TEST EXISTS BECAUSE THE PLAIN CASE WAS VACUOUS. `isSharedRelaySpelling` and `_alreadyACandidate`
  // refuse the same addresses whenever the shared relay is in CANONICAL_RELAYS — it is in relaysRaw() by
  // definition — so sabotaging the spelling refusal left the suite green. They come apart where the shipped
  // PINS name an address the compiled dial list does not, which is the real shape (the pins carry the
  // tailnet address as well as the public one). Here BOX is pinned as a shared relay and is NOT a candidate,
  // so the spelling refusal is the only line that can refuse it: without it the address proves the key the
  // church signed, the gate admits it, and it is adopted.
  await H.publishAll(SHARED, [relayNetDocFor(church, [{ pubkey: BOX.relayPub, alwaysOn: true, url: BOX.wsUrl }])]);
  const con = makeConsole({ church, origin: SECOND_CONSOLE_ORIGIN, canonical: [SHARED.wsUrl],
                            pins: { [BOX.wsUrl]: [BOX.relayPub] } });
  try {
    // DECIDES FIRST: the conversion (asserted), then `isOwnRelaySpelling` (false — the origin runs no
    // relay). `isSharedRelaySpelling(u)` is next and is the deciding line; `_alreadyACandidate` cannot be,
    // because the address is asserted absent from the candidate list below.
    assert.equal(con.dial(BOX.wsUrl), BOX.wsUrl, 'the conversion dropped the address, so this test proves nothing');
    assert.equal(con.relaysRaw().includes(BOX.wsUrl), false,
      'the pinned address is already a candidate, so _alreadyACandidate would refuse it and this test is vacuous again');
    assert.deepEqual(await con.adopt(), [],
      'a shared relay was added to the candidate store as a second row. The shared pool is appended ' +
      'unconditionally and admitted on its own pin, so this only ever buys a second dial per read.');
    // MEASURED, AND SAID PLAINLY: blinding the merge's OWN `isOwnRelaySpelling || isSharedRelaySpelling`
    // line leaves this test green, because the merge writes through `window.Steward.addRelay`, which makes
    // both refusals itself. So the refusal IS enforced — twice — and the merge's copy of it is an
    // optimisation that saves an identity probe, not the thing standing between a shared relay and the
    // list. This test asserts the product behaviour (the row is refused), which is what matters; it cannot
    // distinguish which of the two lines refused it, and nothing here claims otherwise.
  } finally { con.close(); }
});

// ── 4b. THE JAM, AND THAT IT IS ESCAPABLE (audit 2026-10-22 finding 1, HIGH) ────────────────────
//
// `unenrolRelayNet` — the engine behind Remove on the Relays card — refuses to change the church's signed
// list unless every relay it asked answered, EXCEPT the one being removed. Two dead rows therefore wedge it
// for ever: removing A waits on B and removing B waits on A, and the on-screen advice
// ("Remove it again once your relays are answering. If a relay you added is gone for good, remove it first.")
// is circular. Before this feature a steward had to type two addresses that then died; this feature makes
// it arrive unaided, because a Suite box behind a quick tunnel publishes a hostname that changes on every
// restart and its own console adopts each one.
//
// THIS IS THE POINT-OF-USE TEST FOR THE FIX (rule 1): the jam is driven on the PRODUCT's own removal path
// against real relays, then the PRODUCT's own unlock tick (setKey) is run, then the same removal is driven
// again. Nothing is injected; the two boxes are real gateways that are really killed.
test('two adopted rows whose boxes are gone no longer wedge the church\'s relay list', async () => {
  // THE CONSOLE IS SERVED BY THE SHARED RELAY — the hosted-console case, and it is required here for a
  // reason worth writing down: `unenrolRelayNet` fails closed when it cannot learn its OWN box's key
  // (`if (own && !ownKey && pk && drop.some(...)) return { unknown: true }`). On an origin that runs no
  // relay at all that guard refuses every removal, so the jam could never be shown to clear. Served by a
  // real relay, the guard is satisfied honestly and the only thing left that can refuse is _readCovers.
  const ORIGIN = { protocol: 'http:', host: '127.0.0.1:' + SHARED.port };
  const [g1, g2] = await Promise.all([
    H.startRelay({ name: 'tunnel-1', churches: [church.pub] }),
    H.startRelay({ name: 'tunnel-2', churches: [church.pub] }),
  ]);
  const con = makeConsole({ church, origin: ORIGIN, canonical: [SHARED.wsUrl], boxHostsUs: true });
  try {
    // The church signs its box at three addresses over the life of the tunnel. All three are real boxes.
    await H.publishAll(SHARED, [relayNetDocFor(church, [BOX, g1, g2].map(r =>
      ({ pubkey: r.relayPub, alwaysOn: true, url: r.wsUrl })))]);
    con.setKey('x '.repeat(12).trim());
    for (let i = 0; i < 240 && con.extraRelays().length < 3; i++) await sleep(250);
    assert.equal(con.extraRelays().length, 3, 'staging fault: the three boxes were not all adopted — ' + JSON.stringify(con.extraRelays()));
    assert.equal(con.adopted().length, 3, 'the rows this path added are not recorded as its own, so none can retire');

    // Two tunnels restart and never answer at those addresses again.
    g1.stop(); g2.stop();
    assert.equal(await con.readCovers(), false, 'staging fault: two dead rows did not make the read incomplete');

    // THE JAM, on the product's own path. The steward is trying to remove the box that IS answering.
    const jam = await con.unsignRelay(BOX.wsUrl);
    assert.equal(jam.removed, false, 'staging fault: the removal was not blocked, so there is no jam to clear');
    assert.equal(jam.unknown, true, 'the removal failed for some other reason than the incomplete read: ' + JSON.stringify(jam));

    // THE UNLOCK TICK CLEARS IT. Same call the console makes on boot with a key and on every unlock.
    // DECIDES FIRST: adoptNetDocAddresses' own `pub !== churchPub` guard (satisfied — setKey assigns both),
    // then `if (!entries.length) return []`, which is the retire pass's precondition. The line that decides
    // each ROW's fate is `if (!/^[0-9a-f]{64}$/.test(proved))` inside retireDeadAdoptedRows — a real
    // /relay-identity round trip to a port nothing listens on. Nothing earlier can drop a row.
    con.setKey('x '.repeat(12).trim());
    for (let i = 0; i < 240 && con.extraRelays().length > 1; i++) await sleep(250);
    assert.deepEqual(con.extraRelays(), [BOX.wsUrl],
      'THE DEAD ROWS DID NOT RETIRE: ' + JSON.stringify(con.extraRelays()) + '. Every change to this ' +
      'church\'s relay list is now impossible, for ever, and the advice the card gives is circular.');
    assert.deepEqual(con.adopted(), [BOX.wsUrl], 'the provenance store still names rows that are gone');
    assert.equal(await con.readCovers(), true, 'the read is still incomplete, so the removal path is still wedged');

    const freed = await con.unsignRelay(BOX.wsUrl);
    assert.equal(freed.removed, true,
      'the church\'s relay list STILL cannot be changed: ' + JSON.stringify(freed) + '. Retiring the dead ' +
      'rows was the whole point — a row nobody typed must be able to leave again by itself.');
  } finally { con.close(); g1.stop(); g2.stop(); }
});

test('a row that is still answering is never retired, and nothing is retired without a read', async () => {
  // The other half: a retire pass that dropped everything would pass the test above and be useless.
  await H.publishAll(SHARED, [relayNetDocFor(church, [{ pubkey: BOX.relayPub, alwaysOn: true, url: BOX.wsUrl }])]);
  const con = makeConsole({ church, origin: SECOND_CONSOLE_ORIGIN, canonical: [SHARED.wsUrl] });
  try {
    assert.deepEqual(await con.adopt(), [BOX.wsUrl], 'staging fault: nothing was adopted');
    // DECIDES FIRST: `if (!tagged.length) return []`, which is satisfied — one row is tagged. The deciding
    // line is the proof test, and BOX is a real relay that really answers.
    assert.deepEqual(await con.retire(), [], 'a live box was retired. Its row would then be re-adopted and ' +
      're-dropped on every unlock, and the Relays card would flicker for ever.');
    assert.deepEqual(con.extraRelays(), [BOX.wsUrl], 'the live row was dropped anyway');
  } finally { con.close(); }

  // AND NOTHING IS RETIRED WHEN THE CHURCH'S DOCUMENT COULD NOT BE READ. A phone with no signal must not
  // throw away every address it has. Staged by publishing an EMPTY list for the church, which is the shape
  // of "the read told us nothing": one dead row is listed and tagged, and it stays.
  await H.publishAll(SHARED, [relayNetDocFor(church, [])]);
  const dead = 'ws://127.0.0.1:1/relay';
  const con2 = makeConsole({ church, origin: SECOND_CONSOLE_ORIGIN, canonical: [SHARED.wsUrl],
                             extra: [dead], seed: { 'trinityone.steward.adopted-relays': JSON.stringify([dead]) } });
  try {
    // DECIDES FIRST: `if (!entries.length) return []` in adoptNetDocAddresses, which is BEFORE the retire
    // call. Asserted as a refusal here and driven as a retirement in the test above, over the same code.
    assert.deepEqual(await con2.adopt(), [], 'something was adopted from an empty list');
    assert.deepEqual(con2.extraRelays(), [dead],
      'a read that returned nothing still retired a row. On a phone with no signal that throws away every ' +
      'address the console has, on every unlock.');
  } finally { con2.close(); }
});

// ── 4c. THE PATH DIFFERENCE (audit 2026-10-22 finding 2) ──────────────────────────────────
test('a box already listed at an address that cannot be dialled is upgraded in place, not duplicated', async () => {
  // `signRelay` stores a steward-typed address through normRelay, which adds no path — so a steward who
  // typed the bare host has `ws://host:port` in this console's list. Measured with the real normalizeURL:
  // that spelling and `ws://host:port/relay` DIFFER under every normalisation the console uses, because all
  // of them keep the path. Without the box key the merge added a second row for the same relay, and the
  // path-less one can never upgrade — which is the first dead row of the jam above.
  const typed = BOX.wsUrl.replace(/\/relay$/, '');
  assert.match(typed, /^ws:\/\/127\.0\.0\.1:\d+$/, 're-anchor: the harness address no longer has the shape this test strips');

  // FIRST: that spelling really is undialable, so the upgrade is load-bearing rather than cosmetic.
  const typedOk = await new Promise((res) => {
    const w = new WebSocket(typed);
    const done = (v) => { try { w.close(); } catch {} res(v); };
    w.on('open', () => done(true)); w.on('error', () => done(false)); w.on('close', () => done(false));
    setTimeout(() => done(false), 5000);
  });
  assert.equal(typedOk, false, 'the path-less address accepts a websocket after all — re-derive this whole file');

  await H.publishAll(SHARED, [relayNetDocFor(church, [{ pubkey: BOX.relayPub, alwaysOn: true, url: BOX.wsUrl }])]);
  const con = makeConsole({ church, origin: SECOND_CONSOLE_ORIGIN, canonical: [SHARED.wsUrl], extra: [typed] });
  try {
    assert.equal(con.boxKey(typed), con.boxKey(BOX.wsUrl), 'the two spellings are not recognised as one box');
    assert.equal(con.staleSpelling(BOX.wsUrl), typed, 'the path-less row was not identified as the one to replace');
    // DECIDES FIRST: `_staleBoxSpelling(u)` is the first line of the loop body after the conversion, and it
    // is what sends this row down the replace branch instead of the add branch — so the cap is skipped and
    // `_alreadyACandidate` (which WOULD refuse, now that it knows the box) is not consulted. The row is
    // still only written after the key proof, which test 7 drives as a refusal.
    assert.deepEqual(await con.adopt(), [BOX.wsUrl], 'the dialling address was not taken on');
    assert.deepEqual(con.extraRelays(), [BOX.wsUrl],
      'the console now lists ' + JSON.stringify(con.extraRelays()) + '. Two rows for one box, one of which ' +
      'can never connect — and two of those wedge every change to the church\'s relay list.');
    assert.deepEqual(con.adopted(), [BOX.wsUrl], 'the replacement was not recorded as this path\'s own row, so it can never retire');
    // and it is a real address, not a tidier string
    const before = await held(BOX, church, GROUP_D);
    const doc = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000),
      tags: [['d', GROUP_D + 'upgraded'], ['t', 'trinityone']], content: '{}' }, church.sk);
    assert.ok(await con.publish(doc), 'the write failed outright');
    const landed = await H.waitFor(async () => (await held(BOX, church, GROUP_D)) > before,
      { timeout: 20000, label: 'the document reaching the upgraded address' }).then(() => true, () => false);
    assert.ok(landed, 'the upgraded row does not reach the box either');
  } finally { con.close(); }
});

test('a box listed path-lessly OUTSIDE extraRelays() is not duplicated either', async () => {
  // WHY THIS EXISTS: sabotage proved the box-key branch of `_alreadyACandidate` was not reached by any other
  // test. `_staleBoxSpelling` handles the path-less row when it is in extraRelays() (it replaces it), so the
  // only way to reach that branch is a path-less spelling of the same box elsewhere in relaysRaw() — the
  // compiled pool or ownRelay(). Both are /relay-pathed in every build that ships, so this is a defensive
  // case staged on purpose, and it is labelled as one rather than dressed up as a field report. It pins the
  // branch's job: a path difference anywhere in the candidate list must not produce a duplicate row.
  //
  // THE FIRST VERSION OF THIS TEST WAS VACUOUS, and sabotage is what said so. It listed the path-less
  // spelling as the ONLY compiled relay, so the console could not read the church's document at all — the
  // dialling spelling was nowhere in relaysRaw() — and the merge returned early at `if (!entries.length)`.
  // "Nothing was adopted" was true for a reason that had nothing to do with the line under test. So the
  // shared relay is kept readable here and the path-less spelling is of a different box.
  const bare = BOX.wsUrl.replace(/\/relay$/, '');
  await H.publishAll(SHARED, [relayNetDocFor(church, [{ pubkey: BOX.relayPub, alwaysOn: true, url: BOX.wsUrl }])]);
  const con = makeConsole({ church, origin: SECOND_CONSOLE_ORIGIN, canonical: [SHARED.wsUrl, bare] });
  try {
    // DECIDES FIRST, and every earlier line is MEASURED here rather than reasoned about — the vacuous first
    // draft is why. The conversion returns BOX.wsUrl; both spelling refusals answer false (asserted, not
    // assumed: isSharedRelaySpelling is the obvious candidate and it does NOT refuse, because every
    // normalisation it uses keeps the path); `_staleBoxSpelling` returns '' because the path-less row is in
    // CANONICAL_RELAYS, not extraRelays(). So the box-key branch of `_alreadyACandidate` is the only line
    // left that can refuse it — and the read reaches the document through the shared relay, so the merge
    // genuinely gets as far as this row.
    assert.equal(con.dial(BOX.wsUrl), BOX.wsUrl, 'the conversion altered the address, so this test proves nothing');
    assert.ok(con.relaysRaw().includes(bare), 'staging fault: the path-less spelling is not in the candidate list');
    assert.equal(con.relaysRaw().includes(BOX.wsUrl), false, 'staging fault: the dialling spelling is already a candidate');
    assert.ok(con.relaysRaw().includes(SHARED.wsUrl), 'staging fault: no readable relay, so the merge returns early and proves nothing');
    assert.equal(con.ownSpelling(BOX.wsUrl), false, 'the own-relay refusal would decide this, not the box key');
    assert.equal(con.sharedSpelling(BOX.wsUrl), false, 'the shared-relay refusal would decide this, not the box key');
    assert.equal(con.staleSpelling(BOX.wsUrl), '', 'the replace branch claimed a row that is not in extraRelays()');
    assert.deepEqual(await con.adopt(), [],
      'a second row was added for a box the candidate list already covers, differing only by path. Two rows ' +
      'for one relay is two sockets, and the path-less one can never connect — the first dead row of the jam.');
    assert.deepEqual(con.extraRelays(), [], 'the candidate store grew');
  } finally { con.close(); }
});

test('the box key does not collapse two different relays, and a dialling row is never swapped for another spelling', () => {
  const con = makeConsole({ church, origin: SECOND_CONSOLE_ORIGIN, canonical: [SHARED.wsUrl],
                            extra: ['wss://box.example/relay'] });
  try {
    // DECIDES FIRST for each row below: `_netDocBoxKey`'s own `if (!bare) return ''`, and nothing else —
    // these are direct calls, with no gate in front of them.
    assert.notEqual(con.boxKey('wss://box.example/foo'), con.boxKey('wss://box.example/relay'),
      'a relay mounted at another path was collapsed onto this one — the merge would then refuse to adopt it, ' +
      'or worse, overwrite it');
    assert.equal(con.boxKey('wss://box.example'), con.boxKey('ws://box.example/relay/'),
      'the box key is not scheme-blind and path-blind, which is the whole reason it exists');
    assert.equal(con.boxKey(''), '', 'an empty address produced a key, so every empty entry would match every box');
    // A ROW THAT IS ALREADY A DIALLING ADDRESS IS NEVER REPLACED. The first version of this fix swapped a
    // listed `wss://.../relay` for a document's `ws://.../relay` — a cleartext downgrade of a working row,
    // on every unlock, because relayAddrKey treats the two as one address. A test caught it.
    assert.equal(con.staleSpelling('ws://box.example/relay'), '',
      'a working wss:// row was offered up for replacement by a ws:// spelling of the same box');
    assert.equal(con.staleSpelling('wss://box.example/relay'), '', 'the row already listed was offered up for replacement by itself');
  } finally { con.close(); }
});

// ── 5. ONLY THIS CONSOLE'S OWN CHURCH ───────────────────────────────────────────────────────────────────
test('a delegated steward and a network view adopt nothing — extraRelays() is one store for the device', async () => {
  // STAGED SO THE GUARD IS THE ONLY THING THAT CAN REFUSE. A second church genuinely signs the SAME real box
  // and its document is on the same relay, so with the guard deleted both views below would adopt that
  // address — `relayNetEntries(other)` answers, the box proves its key, and `other`'s signature admits it.
  // The first version of this test left `pub` empty and would have passed with the whole merge removed.
  await H.publishAll(SHARED, [
    relayNetDocFor(church, [{ pubkey: BOX.relayPub, alwaysOn: true, url: BOX.wsUrl }]),
    relayNetDocFor(other, [{ pubkey: BOX.relayPub, alwaysOn: true, url: BOX.wsUrl }]),
  ]);
  const con = makeConsole({ church, origin: SECOND_CONSOLE_ORIGIN, canonical: [SHARED.wsUrl] });
  try {
    // DECIDES FIRST, and it is the first line of the function: `if (!pub || pub !== churchPub) return []`.
    // extraRelays() is ONE store for the whole device, not per church, so an address adopted while acting for
    // somebody else would sit on this church's dial list too.
    con.setDelegated(other.pub);   // helping another church: pub = them, churchPub = this console's own
    assert.deepEqual(await con.adopt(), [], 'a delegated view adopted an address into this device\'s own list');
    con.setNetworkView(other.pub); // a network key: pub !== churchPub with no actingChurch
    assert.deepEqual(await con.adopt(), [], 'a network view adopted an address into this device\'s own list');
    assert.deepEqual(con.extraRelays(), [], 'the candidate store grew while acting for somebody else');
    // THE CONTROL, over the same document, the same box and the same console: the own church DOES adopt it.
    // Without this the two assertions above would pass over a merge that refuses everything.
    con.setChurch(church.pub);
    assert.deepEqual(await con.adopt(), [BOX.wsUrl],
      'the own church adopts nothing either, so the two refusals above prove nothing about the guard');
  } finally { con.close(); }
});
