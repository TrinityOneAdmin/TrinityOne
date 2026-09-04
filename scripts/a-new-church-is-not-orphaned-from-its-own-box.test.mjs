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
    localAdminToken: async () => 'tok',
    _authHdr: () => ({}),
    npubEncode: (p) => 'npub_' + p,
    fetch: async (u) => { fetches.push(u); return { ok: true, json: async () => ({ churches: hostedChurches }) }; },
  };
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
