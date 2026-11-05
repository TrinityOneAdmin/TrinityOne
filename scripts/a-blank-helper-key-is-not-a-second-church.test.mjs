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
// STAGE 2 (2026-11-05, src/steward.src.js) closes a MED defect an audit found in the auto-land above:
//   DEFECT 1: setActiveIdentity now takes { persist = true }, and the auto-land calls it { persist: false },
//     so a DEVICE-LOCAL "own key looks blank" guess (a self-hosted own church whose kind-0 has not reached
//     THIS device) can no longer PERSIST an owner into a church they only steward. Every other caller keeps
//     the default persist:true and is unchanged.
//   DEFECT 2: when a stewarded church revokes us WHILE the own key is blank AND other stewarded churches
//     remain, the fallback now lands on a REMAINING stewarded church, not on the hidden blank own row. With
//     NO church remaining it still lands on churchPub (Stage-1 behaviour, which re-shows the own identity).
//
// HOW IT ASSERTS (CLAUDE.md rules 1 & 3). The engine BEHIND the switcher is lifted out of the SHIPPED bundle
// (vendor/steward.js) and RUN — identities(), subscribeStewardedChurches, the REAL setActiveIdentity (tests
// H/I/J, so its ACTIVE_ID_KEY write is exercised, not mocked), and the real _ownKeyBlank /
// _ownKeyRegistered / _ownChurchName predicates they consult. No text is matched in app/*.jsx. Delete the
// showOwn gate in identities() and test A/E go red; delete the auto-land else-if and test E goes red; drop
// the `&& persist` guard and test H goes red; drop the revocation reroute and test J's first case goes red.
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
//
// `realSwitch` (tests H/I) wires window.Steward.setActiveIdentity to the REAL setActiveIdentity lifted from
// the shipped bundle, so the ACTIVE_ID_KEY persistence it writes (or skips) actually happens against `store`
// — that write IS the code under test. The surrounding per-church reset helpers it calls (_loadBoxHosts,
// _blockedLastSet, _applyNoPhotoList, …) are not the thing under test and are stubbed flat; the persist
// guard `if (!_isNetwork && persist)` runs for real. `relays` (test J) is the admitted list _gate.refresh
// resolves to, so subscribeStewardedChurches' discovery subscription actually opens and can deliver a
// roster-deletion event through the recorded `subs`.
function build({ ownName = '', registered = false, stewarded = [], active = '', actingChurch = '', realSwitch = false, relays = [] } = {}) {
  const store = new Map();
  if (ownName) store.set(OWN_NAME_LS + ME, ownName);
  if (registered) store.set(SELFREG_KEY, JSON.stringify({ [ME + '@https://box.example']: 1 }));
  if (active) store.set(ACTIVE_ID_KEY, active);
  const stewardedChurches = new Map(stewarded.map(cp => [cp, { name: 'St Aidan' }]));
  const picked = [];           // every (pub, opts?) the console chose, in order — the switcher's record
  const subs = [];             // every pool.subscribeMany({filters, handlers}) opened, for the test to drive
  const stubs = {
    churchPub: ME, actingChurch, stewardedChurches,
    churchSk: 'ab'.repeat(32),
    netKeys: () => [],
    npubEncode: (p) => 'npub_' + p,
    toPubHex: (x) => (/^[0-9a-f]{64}$/i.test(x) ? x.toLowerCase() : null),
    OWN_NAME_LS, SELFREG_KEY, ACTIVE_ID_KEY, NET: 'trinityone', STEWARDS_D: 'trinityone/stewards:',
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    lsGet: (k) => (store.has(k) ? store.get(k) : null),
    lsSet: (k, v) => store.set(k, v),
    // relay machinery stubbed flat: the restore block (what tests A–G test) runs synchronously BEFORE any of
    // it, so these only need to not throw when the trailing discovery setup runs. `relays` makes the gate
    // admit a list so the discovery subscription opens (test J drives it).
    _ownOrigin: () => '',
    relaysRaw: () => relays.slice(),
    _gate: { refresh: () => Promise.resolve(relays.slice()), admit: () => relays.slice() },
    pool: { subscribeMany: (urls, filters, handlers) => { subs.push({ urls, filters, handlers }); return { close() {} }; } },
    window: {
      Steward: { setActiveIdentity: (p, opts) => { picked.push({ pub: p, opts }); return true; } },
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    },
    // Stubs the REAL setActiveIdentity reads on its per-church reset path (realSwitch only). None is the code
    // under test; the persist guard it gates is. Counters it increments start numeric; .clear()-ables are flat.
    _loadBoxHosts: () => {}, _refreshBoxHostsUs: () => {},
    _blockedLastSet: () => [], _applyNoPhotoList: () => {}, _minorsLastClear: () => {},
    _clearanceSent: { clear() {} }, _ckSessionKeys: { clear() {} },
    _latestGuardNotice: { clear() {} }, _senvPending: { clear() {} },
    CAP_KEYS: {}, _capState: {},
    _keyReadEpoch: 0, _careKeyVer: 0, _mediaKeyVer: 0,
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
  };
  const scope = proxyOf(stubs);
  const lift = (anchor, name) => new Function('scope', `with (scope) { return (${fnBody(VENDOR, anchor, name)}); }`)(scope);
  stubs._ownChurchName = lift('function _ownChurchName() {', '_ownChurchName');
  stubs._ownKeyRegistered = lift('function _ownKeyRegistered() {', '_ownKeyRegistered');
  stubs._ownKeyBlank = lift('function _ownKeyBlank() {', '_ownKeyBlank');
  const method = (anchor, name) => new Function('scope', `with (scope) { return ({ ${fnBody(VENDOR, anchor, name)} }).${name}; }`)(scope);
  const identities = method('identities() {', 'identities');
  const subscribe = method('subscribeStewardedChurches(cb) {', 'subscribeStewardedChurches');
  const saiReal = method('setActiveIdentity(targetPub, { persist = true } = {}) {', 'setActiveIdentity');
  // In realSwitch mode the console drives the REAL switch (so its ACTIVE_ID_KEY write is exercised), and we
  // still record the (pub, opts) it was called with so the test can read both the choice and the persistence.
  if (realSwitch) stubs.window.Steward.setActiveIdentity = (p, opts) => { picked.push({ pub: p, opts }); return saiReal(p, opts); };
  return { stubs, store, picked, subs, saiReal, identities, subscribe: (cb) => subscribe.call(stubs.window.Steward, cb || (() => {})) };
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
  assert.deepEqual(h.picked.map(p => p.pub), [CHURCH],
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

// ── setActiveIdentity persistence : DEFECT 1 ──────────────────────────────────────────────────────────────

test('H (defect 1): the pure-helper auto-land does NOT persist — ACTIVE_ID_KEY stays empty', () => {
  // Second-device case: own church X looks blank here (its kind-0 lives only on X's momentarily-unreachable
  // box), while we reach church Y that we steward. The console may DISPLAY Y, but must not WRITE it, or every
  // later reload honours want=Y and parks the owner in Y even after X's profile arrives and the switcher
  // self-heals. The REAL setActiveIdentity runs, so its ACTIVE_ID_KEY write (here, its ABSENCE) is the subject.
  const h = build({ ownName: '', registered: false, stewarded: [CHURCH], realSwitch: true });
  h.subscribe();                              // auto-land fires synchronously, before any async discovery
  assert.equal(h.picked.length, 1, 'the auto-land did not run');
  assert.equal(h.picked[0].pub, CHURCH, 'the auto-land chose the wrong church');
  assert.deepEqual(h.picked[0].opts, { persist: false }, 'the auto-land must pass { persist: false }');
  assert.equal(h.store.has(ACTIVE_ID_KEY), false,
    'the auto-land PERSISTED a church the owner only stewards — a later reload would honour want= and keep ' +
    'them parked there even after their own church\'s profile arrives');
});

test('I (control for H): an explicit setActiveIdentity DOES persist (every existing caller relies on this)', () => {
  const h = build({ ownName: '', registered: false, stewarded: [CHURCH], realSwitch: true });
  assert.equal(h.saiReal(CHURCH), true, 'the explicit switch was refused');
  assert.equal(h.store.get(ACTIVE_ID_KEY), CHURCH,
    'a deliberate switch must still be remembered — the default persist:true keeps every current caller unchanged');
});

// ── revocation fallback : DEFECT 2 ────────────────────────────────────────────────────────────────────────

// Drive the discovery subscription's onevent with an owner-signed roster that NO LONGER lists us for `cp`
// (a revocation): a `deleted` roster for cp, delivered on the admitted relay the gate let open.
async function revoke(h, cp) {
  h.subscribe();
  await new Promise(r => setTimeout(r, 0));   // let _gate.refresh(...).then(open) open the subscription
  const sub = h.subs.find(s => s.filters && s.filters[0] && (s.filters[0].kinds || []).includes(30078));
  assert.ok(sub, 'the kind-30078 discovery subscription never opened — the gate admitted no relay');
  sub.handlers.onevent({ tags: [['d', 'trinityone/stewards:' + cp], ['deleted']], content: '', created_at: 1 });
}

test('J (defect 2): revoked while blank-and-stewarding-another lands on a REMAINING church, not the blank own row', async () => {
  const OTHER = 'aa'.repeat(32);
  const h = build({ ownName: '', registered: false, stewarded: [CHURCH, OTHER], actingChurch: CHURCH, relays: ['wss://r'] });
  await revoke(h, CHURCH);
  assert.equal(h.picked.length, 1, 'the revocation did not re-land the console anywhere');
  assert.equal(h.picked[0].pub, OTHER,
    'the console dropped onto the hidden blank own key (churchPub) instead of the other church it still stewards');
  assert.deepEqual(h.picked[0].opts, { persist: false }, 'a blank-guess landing must not persist either');
});

test('J2 (defect 2 edge): revoked from the LAST stewarded church still lands on churchPub (own identity re-shows)', async () => {
  const h = build({ ownName: '', registered: false, stewarded: [CHURCH], actingChurch: CHURCH, relays: ['wss://r'] });
  await revoke(h, CHURCH);
  assert.equal(h.picked.length, 1, 'the revocation did not re-land the console anywhere');
  assert.equal(h.picked[0].pub, ME,
    'with no stewarded church left, the console must fall back to its own key (Stage-1 behaviour)');
});

test('J3 (control): a NAMED own church revoked from another still lands on its own key, not a reroute', async () => {
  const OTHER = 'aa'.repeat(32);
  const h = build({ ownName: 'St Mary', stewarded: [CHURCH, OTHER], actingChurch: CHURCH, relays: ['wss://r'] });
  await revoke(h, CHURCH);
  assert.equal(h.picked.length, 1, 'the revocation did not re-land the console anywhere');
  assert.equal(h.picked[0].pub, ME,
    'a real own church must still be returned to on revocation — the reroute is only for a BLANK own key');
});
