// WHEN THE BOX THAT SERVED THE CONSOLE ACCEPTS THE CHURCH, THE CONSOLE MUST KNOW THE BOX HOLDS IT.
// Run: node --test scripts/an-accepted-registration-tells-the-console-its-box-holds-it.test.mjs
//
// Measured 2026-09-04 on 42f8080, driving the real console (the end-to-end proof lives in
// a-church-created-on-a-suite-box-publishes-to-it.test.mjs): after "Continue" on the wizard's name step the
// box registered the church — church.json gained the row, `by: "self"` — and the relay held ZERO events.
// boxhosts was "0", ownRelay() was the community pool, whereChurchLives() said 'community'. A reload and an
// unlock recovered it.
//
// THE MECHANISM. setKey fires _refreshBoxHostsUs(), which asks the box "do you hold this church?" about a
// church seconds old and registered nowhere, and honestly caches "0". Registration lands later, from the
// wizard's name step, and nothing that landed told the cache. relaysRaw() builds the publish set from
// ownRelay(), which follows the cache — so the founding documents went to the pool and the box that had
// just said "yes" got none of them.
//
// THE FIX. An ACCEPTANCE from the base that IS the serving origin is an authenticated answer to the same
// question the probe asks — stronger, because the box just wrote the church into its own list on the
// strength of the church key's signature. selfRegister records it in the same cell the probe writes, and
// re-proves the relay list. Only the serving origin counts: a canonical or pool acceptance says nothing
// about THIS box, and the probe's genuine "no" from a box that serves the console without holding the
// church stays recordable (a-new-church-is-not-orphaned-from-its-own-box.test.mjs, test 2).
//
// This drives the SHIPPED console bundle (vendor/steward.js): selfRegister, ownRelay AND relaysRaw are the
// real functions, sharing one scope, so "ownRelay() names the box afterwards" is a consequence measured
// on the real code and not a stub answering the question the test is named after.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const CANON = 'wss://app.trinityone.church/relay';
const ORIGIN = 'http://127.0.0.1:8000';
const BOX = 'ws://127.0.0.1:8000/relay';

function proxyOf(stubs) {
  return new Proxy(stubs, {
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
}

// One console's worth of world: the cache cell, the storage behind it, and which base says what.
function harness({ cached = false, origin = ORIGIN, answers = {} } = {}) {
  const store = new Map();
  const posts = [];
  const events = [];
  const refreshes = [];
  const stubs = {
    // the church, owner console (not delegated)
    churchSk: new Uint8Array(32).fill(7), churchPub: 'PUB', pub: 'PUB', actingChurch: null,
    _regNeedsName: false, _armRegGate: () => {}, _openRegGate: () => {}, _markRegOk: () => {},
    npubEncode: (p) => 'npub_' + p,
    finalizeEvent: (e) => ({ ...e, id: 'evt', sig: 'sig', pubkey: 'PUB' }),
    now: () => 1788500000,
    SELFREG_KEY: 'sr',
    localStorage: { getItem: () => '{}', setItem: () => {} },
    AbortSignal: { timeout: () => undefined },
    // the relay list, real: ownRelay/relaysRaw are lifted below and read these
    CANONICAL_RELAYS: [CANON], CANONICAL_RELAY: CANON,
    extraRelays: () => [],
    location: { protocol: 'http:', host: '127.0.0.1:8000', hostname: '127.0.0.1' },
    // THE CACHE CELL the /config probe writes and ownRelay() reads. `false` is the poisoned state the
    // wizard lands in: the box was asked too early and said no.
    _boxHostsUs: cached,
    _boxHostsKey: () => 'bh',
    lsSet: (k, v) => store.set(k, v),
    lsGet: (k) => (store.has(k) ? store.get(k) : null),
    _ownOrigin: () => origin,
    _gate: { refresh: (list, cp) => { refreshes.push({ list: [...list], cp }); return Promise.resolve(list); } },
    window: {
      Steward: { configBase: () => (stubs.ownRelay ? stubs.ownRelay() : CANON).replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:').replace(/\/relay\/?$/i, '') },
      dispatchEvent: (e) => { events.push(e && e.type); return true; },
    },
    fetch: async (u) => {
      const base = String(u).replace(/\/config$/, '');
      posts.push(base);
      const a = answers[base];
      if (a === 'unreachable') throw new Error('ECONNREFUSED');
      if (typeof a === 'number') return { ok: false, status: a, json: async () => ({ error: 'refused ' + a }) };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  };
  const scope = proxyOf(stubs);
  stubs.ownRelay = new Function('scope', `with (scope) { return (${fnBody(VENDOR, 'function ownRelay() {', 'ownRelay')}); }`)(scope);
  stubs.relaysRaw = new Function('scope', `with (scope) { return (${fnBody(VENDOR, 'function relaysRaw() {', 'relaysRaw')}); }`)(scope);
  const body = fnBody(VENDOR, 'async selfRegister(name, opts) {', 'selfRegister');
  const selfRegister = new Function('scope', `with (scope) { return ({ ${body} }).selfRegister; }`)(scope);
  return { stubs, store, posts, events, refreshes, selfRegister: (name, opts) => selfRegister.call({}, name, opts) };
}

test('THE FIX: the box that served the console accepts the church, and the console records that it holds it', async () => {
  const h = harness({ cached: false });
  assert.equal(h.stubs.ownRelay(), CANON, 'staging: with the early "no" cached, ownRelay() names the pool — the state the wizard is in');
  const r = await h.selfRegister('St Columba of the Test', { createHere: true });
  assert.equal(r.ok, true, 'staging: the box accepted');
  assert.ok(h.posts.includes(ORIGIN), 'staging: the box was asked at all — posted to ' + JSON.stringify(h.posts));

  assert.equal(h.stubs._boxHostsUs, true,
    'the box accepted the church and the console still believes the box does not hold it. That belief is ' +
    'what relaysRaw() builds the publish set from, so every founding document goes to the pool and the box ' +
    'that just said "yes" gets nothing — measured 2026-09-04: zero events on the relay until a reload.');
  assert.equal(h.store.get('bh'), '1', 'recorded in memory but not in the cell the next unlock reads');
  assert.equal(h.stubs.ownRelay(), BOX,
    'the cache says yes and ownRelay() still names ' + h.stubs.ownRelay() + ' — the publish set does not follow');
  assert.equal(h.refreshes.length, 1, 'the relay list was not re-proved after it changed');
  assert.deepEqual(h.refreshes[0], { list: [BOX, CANON], cp: 'PUB' },
    'the re-proof was over the wrong list — it must be the assembled list with the box back in front, for this church');
  assert.ok(h.events.includes('steward-relays') && h.events.includes('steward-relay-returned'),
    'the surfaces that read the relay list were not told it changed: ' + JSON.stringify(h.events));
});

test('CONTROL: an acceptance from the pool alone says nothing about the box', async () => {
  // The box refuses (invite-only, say) and a canonical relay accepts. `ok` is true — somebody took it —
  // but nothing about THIS box has been learned, and recording a yes here would be exactly the overreach
  // the serves-but-does-not-hold check exists to catch.
  const h = harness({ cached: false, answers: { [ORIGIN]: 403 } });
  const r = await h.selfRegister('St Columba of the Test', { createHere: true });
  assert.equal(r.ok, true, 'staging: the pool accepted');
  assert.ok(h.posts.includes(ORIGIN), 'staging: the box was asked');
  assert.equal(h.stubs._boxHostsUs, false, 'a refusal from the box was recorded as the box holding the church');
  assert.equal(h.store.get('bh'), undefined, 'and written down');
  assert.equal(h.stubs.ownRelay(), CANON, 'ownRelay() moved onto a box that refused the church');
  assert.equal(h.refreshes.length, 0, 'the relay list was re-proved though nothing changed');
  // The refusal itself rightly raises the write-blocked banner (second-church-on-a-relay.test.mjs); what
  // must NOT fire is the pair that says "the relay list changed".
  assert.deepEqual(h.events.filter(e => e !== 'steward-write-blocked'), [],
    'relay-change events fired though nothing changed: ' + JSON.stringify(h.events));
});

test('CONTROL: a box that does not answer records nothing', async () => {
  const h = harness({ cached: false, answers: { [ORIGIN]: 'unreachable' } });
  await h.selfRegister('St Columba of the Test', { createHere: true });
  assert.equal(h.stubs._boxHostsUs, false, 'silence from the box was taken as a yes');
  assert.equal(h.store.get('bh'), undefined);
  assert.equal(h.refreshes.length, 0);
});

test('CONTROL: a console served by nothing relay-shaped records nothing, however many relays accept', async () => {
  // _ownOrigin() is '' inside a Capacitor APK and on a static CDN host. There is no box to have accepted.
  const h = harness({ cached: null, origin: '' });
  await h.selfRegister('St Columba of the Test', { createHere: true });
  assert.equal(h.stubs._boxHostsUs, null, 'a pool acceptance was recorded as "this box holds us" on a console with no box');
  assert.equal(h.store.get('bh'), undefined);
  assert.equal(h.refreshes.length, 0);
});

test('CONTROL: a box already known to hold the church is not re-announced to every surface', async () => {
  // The re-announce path: cache already "1", the box accepts again. Correct, and nothing changed — so no
  // re-proof and no change events, or every boot would churn the relay card and flush the outbox.
  const h = harness({ cached: true, answers: {} });
  await h.selfRegister('St Columba of the Test', {});
  assert.ok(h.posts.includes(ORIGIN), 'staging: with the cache at yes, configBase() is the box, so it is asked even without the opt-in');
  assert.equal(h.stubs._boxHostsUs, true);
  assert.equal(h.refreshes.length, 0, 'the relay list was re-proved though the answer was already yes');
  assert.deepEqual(h.events, [], 'change events fired though nothing changed');
});
