// A DELEGATED STEWARD'S CONSOLE MUST COME BACK TO THE CHURCH IT WAS RUNNING.
// Run: node --test scripts/console-remembers-its-church.test.mjs
//
// "Help run a church" gives you a console of your own — your own empty church, with an invite poster, a join
// link and a warning that anyone with the link can walk in. Being approved as a steward of a REAL church does
// not move you across; a switcher does, and nothing persisted the choice.
//
// SIMULATION ROUND 9. The churchwarden was approved, reloaded, and landed back in his own empty church with
// no sign anything had happened. His rota page said "Build your first team" while St Aidan's already had
// four. So he built his own, in good faith, and published a rota for a Sunday that already had one — which is
// what put two competing rotas on one service and wiped ten real people off every phone in the parish. In his
// words: "every page refresh throws me back into my own empty church, and I have to find the switcher again."
//
// THE FIRST VERSION OF THIS FILE WAS SIX SOURCE-TEXT REGEXES, AND AN AUDITOR DEFEATED THEM ALL WITH THE BUG
// FULLY IN PLACE — appending a never-true clause to the restore left 6/6 green, as did storing an empty
// string instead of the church. One of them was worse than useless: it asserted the write happened BEFORE the
// first branch, enshrining a write-before-validate defect as a requirement, so fixing it properly would have
// turned that test red. These tests RUN the shipped functions instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const V = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

const OWN = 'a'.repeat(64);        // the church this console actually HOLDS
const ST_AIDANS = 'b'.repeat(64);  // a church it stewards for somebody else
const OTHER = 'c'.repeat(64);      // a church it has nothing to do with
const NETWORK = 'd'.repeat(64);

// Build a live console-ish world and run the two shipped functions inside it.
function world({ stewarded = [ST_AIDANS], stored = null, networks = [] } = {}) {
  const store = new Map(); if (stored !== null) store.set('trinityone.steward.active-id', stored);
  const state = { pub: OWN, sk: 'sk-own', actingChurch: '', switched: [] };
  const scope = {
    churchPub: OWN, churchSk: 'sk-own',
    get pub() { return state.pub; }, set pub(v) { state.pub = v; },
    get sk() { return state.sk; }, set sk(v) { state.sk = v; },
    get actingChurch() { return state.actingChurch; }, set actingChurch(v) { state.actingChurch = v; },
    stewardedChurches: new Map(stewarded.map(c => [c, { name: 'Church' }])),
    toPubHex: (x) => (/^[0-9a-f]{64}$/i.test(String(x || '')) ? String(x).toLowerCase() : null),
    netKeys: () => networks.map(p => ({ pub: p, mnemonic: 'x '.repeat(11) + 'y' })),
    privateKeyFromSeedWords: () => 'sk-net', getPublicKey: () => NETWORK,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    ACTIVE_ID_KEY: 'trinityone.steward.active-id',
    lastProfile: {}, _profileLoaded: false, _clearanceSent: new Set(), _careRoster: new Set(), _careRosterKnown: false,
    window: { Steward: {}, dispatchEvent: () => {} }, console,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    // THE BUNDLER RENAMES WHAT IT INLINES (privateKeyFromSeedWords -> …2). Returning undefined for an unknown
    // name made the network branch throw into its own catch and bail BEFORE the line under test, so the test
    // failed for a reason that had nothing to do with the code. Fall back to the base name, and shout about
    // anything genuinely missing rather than quietly handing back undefined.
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, ''); if (base in t) return t[base];
      throw new ReferenceError('the lifted function needs a stub for `' + String(k) + '`'); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  // setActiveIdentity, lifted and stripped of the bookkeeping tail we do not model
  let src = fnBody(V, 'setActiveIdentity(targetPub)', 'setActiveIdentity');
  src = src.slice(0, src.indexOf('lastProfile = {}')) + 'return true; }';
  const setActive = new Function('scope', `with (scope) { return ({ ${src} }).setActiveIdentity; }`)(proxy);
  scope.window.Steward.setActiveIdentity = (t) => { state.switched.push(t); return setActive.call(scope.window.Steward, t); };
  return { state, store, setActive: scope.window.Steward.setActiveIdentity,
    stored: () => store.get('trinityone.steward.active-id') };
}

test('switching into a stewarded church is remembered', () => {
  const w = world();
  w.setActive(ST_AIDANS);
  assert.equal(w.state.actingChurch, ST_AIDANS, 'the switch itself did not happen');
  assert.equal(w.stored(), ST_AIDANS,
    'the console forgets which church it is running the moment the page reloads');
});

test('switching back to your OWN church clears the memory', () => {
  // Otherwise a stale value drags you back into a church you deliberately left.
  const w = world({ stored: ST_AIDANS });
  w.setActive(OWN);
  assert.equal(w.state.actingChurch, '');
  assert.equal(w.stored(), '', 'leaving a church still leaves the console remembering it');
});

test('A FAILED SWITCH DOES NOT OVERWRITE A GOOD MEMORY', () => {
  // The defect the first version of this file enshrined as a requirement. The write used to be the very first
  // statement, so a switch that then failed still destroyed the last good answer.
  const w = world({ stored: ST_AIDANS });
  const ok = w.setActive(OTHER);                       // a church we neither hold nor steward
  assert.equal(ok, false, 'the console switched into a church it has nothing to do with');
  assert.equal(w.stored(), ST_AIDANS,
    'a switch that failed still overwrote the remembered church — the console now remembers somewhere it ' +
    'never managed to go, and the next boot tries to enter it');
});

test('glancing at a network does NOT erase the church you were running', () => {
  // The restore only ever re-enters a stewarded church, so a network is never stored. But CLEARING the memory
  // was worse: a delegated steward who stepped sideways to a network view had their remembered church wiped,
  // and the next reload dropped them into their own empty church — round 9's trap, one click away.
  const w = world({ stored: ST_AIDANS, networks: [NETWORK] });
  w.setActive(NETWORK);
  assert.equal(w.stored(), ST_AIDANS,
    'stepping sideways to a network threw away the church this console was running');
});

test('THE ORDERING IS LOAD-BEARING: the restore must run after the stewarded list is known', () => {
  // An auditor defeated the previous version of this file by moving the restore block ABOVE the cache load.
  // The feature is then completely dead — the stewarded list is always empty when the guard runs, so a
  // delegated steward lands in their own empty church on every boot — and all ten tests stayed green,
  // because the harness pre-populates that list and runs only the sliced-out block. Assert the ordering.
  const body = stripComments(fnBody(V, 'subscribeStewardedChurches(cb)', 'subscribeStewardedChurches'));
  const load = body.indexOf('stewardedChurches.set(c.cp');
  const restore = body.indexOf('const want =');
  assert.ok(load !== -1 && restore !== -1, 're-anchor: one of the two landmarks has moved');
  assert.ok(load < restore,
    'the restore runs before the console knows which churches it stewards, so the guard always fails and a ' +
    'delegated steward boots into their own empty church every time');
});

// ── the restore half ─────────────────────────────────────────────────────────────────────────────────────
// Lifted from subscribeStewardedChurches, which is the earliest moment the console knows what it stewards.
function restore({ stewarded, stored, ownPubs = [OWN], acting = '' }) {
  const body = stripComments(fnBody(V, 'subscribeStewardedChurches(cb)', 'subscribeStewardedChurches'));
  const at = body.indexOf('const want =');
  assert.notEqual(at, -1, 're-anchor: the restore block is gone from subscribeStewardedChurches');
  // …to the end of its own if-statement. The bundler puts the catch on its own line, so slice to the
  // `} catch` that closes this try and run the middle directly.
  const block = body.slice(at, body.indexOf('} catch', at));
  const calls = [];
  const scope = {
    localStorage: { getItem: () => stored },
    ACTIVE_ID_KEY: 'k', churchPub: OWN, actingChurch: acting,
    _ownedPubs: new Set(ownPubs),
    stewardedChurches: new Map(stewarded.map(c => [c, {}])),
    window: { Steward: { setActiveIdentity: (t) => calls.push(t) } }, console,
  };
  const proxy = new Proxy(scope, { has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => (k === Symbol.unscopables ? undefined : t[k]), set: (t, k, v) => { t[k] = v; return true; } });
  new Function('scope', `with (scope) { ${block} }`)(proxy);
  return calls;
}

test('on boot the console goes back to the church it was running', () => {
  assert.deepEqual(restore({ stewarded: [ST_AIDANS], stored: ST_AIDANS }), [ST_AIDANS],
    'the remembered church is never re-entered, so remembering it achieves nothing');
});

test('it refuses a church we no longer steward', () => {
  assert.deepEqual(restore({ stewarded: [], stored: ST_AIDANS }), [],
    'a stale entry drops the console into a church every read of which will be refused');
});

test('it never redirects a console that HOLDS its own church', () => {
  assert.deepEqual(restore({ stewarded: [OWN], stored: OWN, ownPubs: [OWN] }), [],
    'an ordinary vicar’s console can be redirected by a remembered value');
});

test('nothing remembered, nothing happens', () => {
  assert.deepEqual(restore({ stewarded: [ST_AIDANS], stored: null }), []);
  assert.deepEqual(restore({ stewarded: [ST_AIDANS], stored: '' }), []);
});

test('it does not re-enter the church it is already in', () => {
  assert.deepEqual(restore({ stewarded: [ST_AIDANS], stored: ST_AIDANS, acting: ST_AIDANS }), [],
    're-entering resets profile state and re-subscribes for nothing, on every boot');
});

test('the shipped console carries all of this', () => {
  assert.match(stripComments(V), /ACTIVE_ID_KEY/, 'vendor/steward.js was not rebuilt from source');
});


// ── THE WRITE HALF AND THE READ HALF, AGAINST ONE STORAGE ────────────────────────────────────────────────
// An auditor killed the whole feature and left 11/11 green: make the restore read `ACTIVE_ID_KEY + "." + me`
// while the switch still writes the bare key. Every test passed because the two halves were driven by two
// separate harnesses that never shared a storage — so a key mismatch was invisible by construction. And this
// is not a contrived refactor: per-identity namespacing of console storage keys is a real, known want in this
// codebase (two console identities in one browser profile collide). Drive both halves against ONE store.
test('END TO END: what the switch writes is what the next boot reads', () => {
  const shared = new Map();

  // half one — the real setActiveIdentity, writing into `shared`
  const state = { pub: OWN, sk: 'sk-own', actingChurch: '' };
  const wScope = {
    churchPub: OWN, churchSk: 'sk-own',
    get pub() { return state.pub; }, set pub(v) { state.pub = v; },
    get sk() { return state.sk; }, set sk(v) { state.sk = v; },
    get actingChurch() { return state.actingChurch; }, set actingChurch(v) { state.actingChurch = v; },
    stewardedChurches: new Map([[ST_AIDANS, { name: 'St Aidan’s' }]]),
    toPubHex: (x) => (/^[0-9a-f]{64}$/i.test(String(x || '')) ? String(x).toLowerCase() : null),
    netKeys: () => [], privateKeyFromSeedWords: () => 'sk', getPublicKey: () => NETWORK,
    localStorage: { getItem: (k) => (shared.has(k) ? shared.get(k) : null), setItem: (k, v) => shared.set(k, String(v)) },
    ACTIVE_ID_KEY: 'trinityone.steward.active-id',
    lastProfile: {}, _profileLoaded: false, _clearanceSent: new Set(), _careRoster: new Set(), _careRosterKnown: false,
    window: { Steward: {}, dispatchEvent: () => {} }, console,
  };
  const wrap = (t) => new Proxy(t, { has: (o, k) => (k in o) || !(String(k) in globalThis),
    get: (o, k) => { if (k === Symbol.unscopables) return undefined; if (k in o) return o[k];
      const b = String(k).replace(/\d+$/, ''); if (b in o) return o[b];
      throw new ReferenceError('needs a stub for ' + String(k)); },
    set: (o, k, v) => { o[k] = v; return true; } });
  let wsrc = fnBody(V, 'setActiveIdentity(targetPub)', 'setActiveIdentity');
  wsrc = wsrc.slice(0, wsrc.indexOf('lastProfile = {}')) + 'return true; }';
  const setActive = new Function('scope', `with (scope) { return ({ ${wsrc} }).setActiveIdentity; }`)(wrap(wScope));
  setActive.call({}, ST_AIDANS);

  // half two — the real restore block, reading from THE SAME `shared`
  const body = stripComments(fnBody(V, 'subscribeStewardedChurches(cb)', 'subscribeStewardedChurches'));
  const at = body.indexOf('const want =');
  const block = body.slice(at, body.indexOf('} catch', at));
  const calls = [];
  const rScope = {
    localStorage: { getItem: (k) => (shared.has(k) ? shared.get(k) : null) },
    ACTIVE_ID_KEY: 'trinityone.steward.active-id', churchPub: OWN, actingChurch: '',
    _ownedPubs: new Set([OWN]), stewardedChurches: new Map([[ST_AIDANS, {}]]),
    window: { Steward: { setActiveIdentity: (t) => calls.push(t) } }, console,
  };
  new Function('scope', `with (scope) { ${block} }`)(wrap(rScope));

  assert.deepEqual(calls, [ST_AIDANS],
    'the console wrote its remembered church under one name and looked for it under another, so a delegated ' +
    'steward is dropped back into their own empty church on every boot — with every test still green');
});
