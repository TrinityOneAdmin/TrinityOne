// A CHURCH MUST NEVER BE PERMANENTLY POINTED AWAY FROM THE BOX THAT SERVES IT.
// Run: node --test scripts/a-new-church-is-not-orphaned-from-its-own-box.test.mjs
//
// Measured 2026-09-04, staging a church on a self-hosted console (SESSION-2026-09-04-END-TO-END.md, F3).
// The whole setup wizard published NOTHING — no name, no groups, no meetings — while reporting success.
//
// THE MECHANISM, and every step of it was deliberate on its own:
//   1. "Start a new church" calls createKey() -> setKey(), and setKey fires _refreshBoxHostsUs() at once.
//   2. Registration is deliberately deferred until the church has a NAME (a nameless self-registration is
//      refused on purpose — gateway H4, after one box collected 37 anonymous rows).
//   3. So the probe asked "does this box host us?" about a church registered nowhere, got an honest "no",
//      and cached it.
//   4. `_boxHostsUs === false` makes ownRelay() return CANONICAL_RELAY — and the guard at the top of
//      _refreshBoxHostsUs consulted ownRelay(), so it then refused to run. The answer could never be
//      revisited. I registered the church on the box for real and the console STILL refused it; only
//      clearing localStorage recovered it.
//
// THE FIX is step 4, not step 3: the guard reads `_ownOrigin()` — straight off location — so the question
// stays askable on every unlock. This is what the file's own deadlock rule already prescribes for the
// enrolment census: "READ STRAIGHT OFF location. NOT ownRelay(), which consults _boxHostsUs."
//
// A FIRST ATTEMPT AT THIS SUPPRESSED THE CACHING INSTEAD, guarded on "has this church ever registered
// anywhere". An audit refuted it: that record is per-browser-profile, so a church restored from its phrase,
// or one the operator added by hand, could never record a legitimate "no" again — which disabled the only
// check that spots a box serving the console without holding the church. The test below therefore asserts
// that a real "no" IS still recorded, which is what killed that version.
//
// This drives the SHIPPED console bundle (vendor/steward.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

function lift(anchor, name, stubs) {
  const body = fnBody(VENDOR, anchor, name);
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, '');
      if (base in t) return t[base];
      throw new ReferenceError('the lifted function needs `' + String(k) + '` — add a stub');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return new Function('scope', `with (scope) { return (${body}); }`)(scope);
}

const CANON = 'wss://app.trinityone.church/relay';

function harness({ cached = null, hostedChurches = [], origin = 'http://127.0.0.1:8000' } = {}) {
  const store = new Map();
  const fetches = [];
  const originHost = origin ? new URL(origin).hostname : 'example.invalid';
  const stubs = {
    pub: 'PUB',
    _boxHostsUs: cached,
    lsGet: (k) => (store.has(k) ? store.get(k) : null),
    lsSet: (k, v) => store.set(k, v),
    _boxHostsKey: () => 'bh',
    CANONICAL_RELAY: CANON,
    // Faithful to the real ownRelay(): a cached `false` sends it to the community pool. If the guard under
    // test consults this, a poisoned console can never re-ask — which is the whole bug.
    ownRelay: () => (stubs._boxHostsUs === false ? CANON : 'ws://127.0.0.1:8000/relay'),
    _ownOrigin: () => origin,
    // THE REAL localAdminToken, NOT A STUB. Stubbing it is what hid the whole defect: the guard was moved
    // off ownRelay(), but localAdminToken's own guard still went through it, so the cached "no" killed the
    // function one line later — and a test that hands it a token can never see that. "A stub answers the
    // question", on the exact function this test is named after. Found by the audit of f0ceb92.
    // Its dependencies are real too, so a regression anywhere in the chain surfaces here.
    _localToken: '',
    location: { hostname: originHost, protocol: 'http:', host: originHost + ':8000' },
    ownIsLoopback: () => /^wss?:\/\/(localhost|127\.0\.0\.1|\[?::1\]?|0\.0\.0\.0)(:|\/)/i.test(stubs.ownRelay()),
    _authHdr: () => ({}),
    npubEncode: (p) => 'npub_' + p,
    fetch: async (u) => {
      if (String(u).indexOf('/local-token') >= 0) return { ok: true, json: async () => ({ token: 'tok' }) };
      fetches.push(u);   // only /config counts as "it asked"
      return { ok: true, json: async () => ({ churches: hostedChurches }) };
    },
  };
  // Degrade when the bundle predates the fix: the OLD localAdminToken does not reference this at all, so
  // omitting it lets the real (old) token chain run and the BEHAVIOUR assertion fire. Lifting a function
  // that is not there turns every test red on a missing anchor, which proves a rename, not a regression.
  if (VENDOR.includes('function _originIsLoopback()')) {
    stubs._originIsLoopback = lift('function _originIsLoopback() {', '_originIsLoopback', stubs);
  }
  stubs.localAdminToken = lift('async function localAdminToken() {', 'localAdminToken', stubs);
  const refresh = lift('async function _refreshBoxHostsUs() {', '_refreshBoxHostsUs', stubs);
  return { store, stubs, fetches, refresh };
}

test('THE REGRESSION: a cached "no" does not stop the console asking again', async () => {
  // The exact poisoned state: the box was asked too early, said no, and that was written down.
  const h = harness({ cached: false, hostedChurches: [{ npub: 'npub_PUB' }] });
  await h.refresh();
  assert.equal(h.fetches.length, 1,
    'the console did not even ask. A cached "no" makes ownRelay() return the community pool, and the guard ' +
    'consulted ownRelay(), so it refused to run — the answer was unrevisitable and a self-hosting church ' +
    'was pointed at the shared pool for ever. Registering the church on the box does not cure this; only ' +
    'clearing localStorage does, and nothing in the product does that.');
  assert.equal(h.store.get('bh'), '1', 'it asked, was told yes, and did not write the answer down');
  assert.equal(h.stubs._boxHostsUs, true);
});

test('CONTROL: a real "no" is still recorded — the box that serves you may not hold your church', async () => {
  const h = harness({ cached: null, hostedChurches: [] });
  await h.refresh();
  assert.equal(h.store.get('bh'), '0',
    'the probe stopped recording a negative answer. That is the only check that spots a box which serves ' +
    'this console but does not hold this church — the case whereChurchLives() exists for. An earlier ' +
    'version of this fix broke exactly this, for every church restored from a phrase or added by an operator.');
  assert.equal(h.stubs._boxHostsUs, false);
});

test('CONTROL: a box that DOES host the church records yes', async () => {
  const h = harness({ cached: null, hostedChurches: [{ npub: 'npub_PUB' }] });
  await h.refresh();
  assert.equal(h.store.get('bh'), '1');
  assert.equal(h.stubs._boxHostsUs, true);
});

test('CONTROL: a console served by nothing relay-shaped does not ask at all', async () => {
  // _ownOrigin() returns '' inside a Capacitor APK and on a static CDN host — there is no box to ask.
  const h = harness({ cached: null, hostedChurches: [], origin: '' });
  await h.refresh();
  assert.equal(h.fetches.length, 0, 'the console probed /config on an origin that cannot be a relay');
  assert.equal(h.store.get('bh'), undefined, 'and wrote down an answer it never received');
});

test('CONTROL: it never asks without knowing which church is asking', async () => {
  const h = harness({ cached: null });
  h.stubs.pub = '';
  await h.refresh();
  assert.equal(h.fetches.length, 0, 'asked "do you host us?" without a church to name');
});

// ── THE OTHER HALF: registering must AIM at the box that served the console ────────────────────────────
// A cached "no" also poisons where selfRegister sends its registration: `bases` was built from
// configBase(), which derives from ownRelay(), which returns the community pool once `_boxHostsUs` is
// false. So the box was not among the relays the console tried to register with — and registering with it
// was the one thing that could have changed the answer. The deadlock rule, reached by a third route.
//
// Measured 2026-09-04: with `bases.add(rawOrigin)` removed, a fresh church on a clean Suite box does not
// register at all (no church.json) and nothing it publishes is accepted. An audit of f0ceb92 deleted that
// line and the ENTIRE SUITE stayed green — this test is the gap it found.
//
// SINCE THEN THE SEED BECAME AN OPT-IN. Owner's decision, 2026-09-04: the serving box is a registration
// target only when a steward is deliberately creating a church on it — the wizard passes `createHere`,
// the boot-time calls do not (see only-the-wizard-puts-a-church-on-the-serving-box.test.mjs for the other
// half). This test is the wizard's call, so it passes the flag.
test('registration is aimed at the box that served the console, not only at where ownRelay points', async () => {
  const posts = [];
  const scope = {
    churchSk: new Uint8Array(32).fill(7), churchPub: 'PUB', actingChurch: null,
    _regNeedsName: false, _armRegGate: () => {}, _openRegGate: () => {}, _markRegOk: () => {},
    npubEncode: (p) => 'npub_' + p,
    CANONICAL_RELAYS: ['wss://app.trinityone.church/relay'],
    SELFREG_KEY: 'sr',
    finalizeEvent: (e) => ({ ...e, id: 'evt', sig: 'sig', pubkey: 'PUB' }),
    now: () => 1788500000,
    // The poisoned state: the box said "not ours", so ownRelay()/configBase() name the community pool.
    _ownOrigin: () => 'http://127.0.0.1:8000',
    window: { Steward: { configBase: () => 'https://app.trinityone.church' }, dispatchEvent: () => true },
    localStorage: { getItem: () => '{}', setItem: () => {} },
    // What an acceptance from the box now writes down (the other half of this fix, tested in
    // an-accepted-registration-tells-the-console-its-box-holds-it.test.mjs). Present so the lifted function
    // runs clean: a missing stub throws inside the fetch's own try/catch and is counted as "unreachable".
    _boxHostsUs: false, pub: 'PUB', lsSet: () => {}, _boxHostsKey: () => 'bh',
    _gate: { refresh: () => Promise.resolve([]) }, relaysRaw: () => [],
    AbortSignal: { timeout: () => undefined },
    fetch: async (u) => { posts.push(String(u)); return { ok: true, json: async () => ({}) }; },
  };
  const body = fnBody(VENDOR, 'async selfRegister(name, opts) {', 'selfRegister');
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, '');
      if (base in t) return t[base];
      throw new ReferenceError('the lifted selfRegister needs `' + String(k) + '` — add a stub');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  // fnBody hands back object-method shorthand (`async selfRegister(name, opts) {…}`), which is not a valid
  // expression on its own — put it back in an object literal and take the method off it.
  const fn = new Function('scope', `with (scope) { return ({ ${body} }).selfRegister; }`)(proxy);
  await fn.call({}, 'St Hilda of the Test', { createHere: true });

  assert.ok(posts.some(u => u.indexOf('http://127.0.0.1:8000/config') === 0),
    'the console never tried to register with the box that served it. `bases` came from configBase(), ' +
    'which follows ownRelay() and therefore the cached "this box is not ours" — so the one action that ' +
    'could correct that answer was aimed everywhere except the box. Posted to: ' + JSON.stringify(posts));
});
