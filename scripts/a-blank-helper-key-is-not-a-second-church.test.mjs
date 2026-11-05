// A PURE HELPER'S BLANK OWN KEY IS NOT RENDERED AS A SECOND CHURCH.
// Run: node --test scripts/a-blank-helper-key-is-not-a-second-church.test.mjs
//
// BUG. When a brand-new person becomes a delegated steward ("helper"), the console mints them their OWN
// church key (churchPub, via createKeyQuiet) so they can sign. A pure helper never names or registers that
// key, so identities() used to emit it UNCONDITIONALLY as { kind:'church', name:'' } — an unnamed "Your
// church" row beside the real church they steward, which reads as "a second blank church was created".
//
// THE FIX (2026-11-05, src/steward.src.js):
//   1. identities() drops the own-key church row WHILE it is blank (unnamed AND never-registered) AND the
//      console stewards >= 1 church. A NAMED/registered own church, or a brand-new owner with no stewarded
//      church, is listed exactly as before.
//   2. subscribeStewardedChurches, when nothing is remembered and the own key is blank and >= 1 church is
//      stewarded, lands the console in a stewarded church instead of the blank own key.
// churchPub stays a valid signer and switch-target throughout; this only changes the RENDERED list and the
// default active identity.
//
// HOW IT ASSERTS (CLAUDE.md rules 1 & 3). The engine BEHIND the switcher is lifted out of the SHIPPED bundle
// (vendor/steward.js) and RUN — identities(), subscribeStewardedChurches, and the real _ownKeyBlank /
// _ownKeyRegistered / _ownChurchName predicates they consult. No text is matched in app/*.jsx. Delete the
// showOwn gate in identities() and test A/E go red; delete the auto-land else-if and test E goes red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const ME = 'ee'.repeat(32);        // the helper's OWN key — a church nowhere
const CHURCH = 'cc'.repeat(32);    // the real church whose roster names ME
const OWN_NAME_LS = 'trinityone.steward.ownname.';
const SELFREG_KEY = 'trinityone.steward.selfreg';
const ACTIVE_ID_KEY = 'trinityone.steward.active';

function proxyOf(stubs) {
  return new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      if (String(k) in globalThis) return globalThis[String(k)];
      throw new ReferenceError('the lifted function needs `' + String(k) + '` — add a stub');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
}

// One console's worth of world. `ownName` is the kind-0 name last read for the own key (''=never),
// `registered` whether the own key has ever self-registered, `stewarded` the churches we steward.
function build({ ownName = '', registered = false, stewarded = [], active = '' } = {}) {
  const store = new Map();
  if (ownName) store.set(OWN_NAME_LS + ME, ownName);
  if (registered) store.set(SELFREG_KEY, JSON.stringify({ [ME + '@https://box.example']: 1 }));
  if (active) store.set(ACTIVE_ID_KEY, active);
  const stewardedChurches = new Map(stewarded.map(cp => [cp, { name: 'St Aidan' }]));
  const picked = [];
  const stubs = {
    churchPub: ME, actingChurch: '', stewardedChurches,
    netKeys: () => [],
    npubEncode: (p) => 'npub_' + p,
    toPubHex: (x) => (/^[0-9a-f]{64}$/i.test(x) ? x.toLowerCase() : null),
    OWN_NAME_LS, SELFREG_KEY, ACTIVE_ID_KEY, NET: 'trinityone', STEWARDS_D: 'trinityone/stewards:',
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) },
    lsGet: (k) => (store.has(k) ? store.get(k) : null),
    lsSet: (k, v) => store.set(k, v),
    // relay machinery stubbed flat: the restore block (what this file tests) runs synchronously BEFORE any of
    // it, so these only need to not throw when the trailing discovery setup runs.
    _ownOrigin: () => '',
    relaysRaw: () => [],
    _gate: { refresh: () => Promise.resolve([]), admit: () => [] },
    pool: { subscribeMany: () => ({ close() {} }) },
    window: {
      Steward: { setActiveIdentity: (p) => { picked.push(p); return true; } },
      addEventListener() {}, removeEventListener() {},
    },
  };
  const scope = proxyOf(stubs);
  const lift = (anchor, name) => new Function('scope', `with (scope) { return (${fnBody(VENDOR, anchor, name)}); }`)(scope);
  stubs._ownChurchName = lift('function _ownChurchName() {', '_ownChurchName');
  stubs._ownKeyRegistered = lift('function _ownKeyRegistered() {', '_ownKeyRegistered');
  stubs._ownKeyBlank = lift('function _ownKeyBlank() {', '_ownKeyBlank');
  const identities = new Function('scope', `with (scope) { return ({ ${fnBody(VENDOR, 'identities() {', 'identities')} }).identities; }`)(scope);
  const subscribe = new Function('scope', `with (scope) { return ({ ${fnBody(VENDOR, 'subscribeStewardedChurches(cb) {', 'subscribeStewardedChurches')} }).subscribeStewardedChurches; }`)(scope);
  return { stubs, store, picked, identities, subscribe: (cb) => subscribe.call(stubs.window.Steward, cb || (() => {})) };
}

// ── identities() : the rendered list ─────────────────────────────────────────────────────────────────────

test('A: a blank own key is NOT listed as a church when the console stewards one', () => {
  const { identities } = build({ ownName: '', registered: false, stewarded: [CHURCH] });
  const ids = identities();
  assert.equal(ids.filter(i => i.kind === 'church').length, 0,
    'the blank helper key is still rendered as a church — the "second blank church" the owner reported');
  const st = ids.filter(i => i.kind === 'steward');
  assert.equal(st.length, 1, 'the church they actually steward is missing from the switcher');
  assert.equal(st[0].pub, CHURCH);
});

test('B (inverse): a NAMED own church is still listed, even while stewarding another', () => {
  const { identities } = build({ ownName: 'St Mary', stewarded: [CHURCH] });
  const own = identities().filter(i => i.kind === 'church');
  assert.equal(own.length, 1, 'a legitimate named own church was hidden');
  assert.equal(own[0].name, 'St Mary', 'the own church lost its name');
});

test('B2 (inverse): a REGISTERED but unnamed own church is still listed', () => {
  const { identities } = build({ ownName: '', registered: true, stewarded: [CHURCH] });
  assert.equal(identities().filter(i => i.kind === 'church').length, 1,
    'an own key that has registered at a relay is a real church and must stay listed');
});

test('C (revocation edge / brand-new owner): with NO stewarded church, the blank own key IS listed', () => {
  const { identities } = build({ ownName: '', registered: false, stewarded: [] });
  assert.equal(identities().filter(i => i.kind === 'church').length, 1,
    'a brand-new owner setting up — or a helper who just lost their last church — was left with no church row (blank screen)');
});

// ── subscribeStewardedChurches : the default active identity ──────────────────────────────────────────────

test('E: a pure helper with nothing remembered lands in the stewarded church, not the blank own key', () => {
  const h = build({ ownName: '', registered: false, stewarded: [CHURCH] });   // warm cache, no ACTIVE_ID_KEY
  h.subscribe();
  assert.deepEqual(h.picked, [CHURCH],
    'the console defaulted to the blank own key instead of the church the helper actually stewards');
});

test('F (control): a named owner who stewards another church is NOT auto-switched away from their own', () => {
  const h = build({ ownName: 'St Mary', stewarded: [CHURCH] });
  h.subscribe();
  assert.deepEqual(h.picked, [], 'the owner was yanked out of their own church on launch');
});

test('G (control): a pure helper with NO stewarded church is not switched anywhere', () => {
  const h = build({ ownName: '', registered: false, stewarded: [] });
  h.subscribe();
  assert.deepEqual(h.picked, [], 'there was no church to land in, yet a switch was attempted');
});
