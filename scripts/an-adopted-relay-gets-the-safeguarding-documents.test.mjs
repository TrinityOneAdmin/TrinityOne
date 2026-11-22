// A NEWLY-ADOPTED RELAY IS SENT THE CHURCH'S SAFEGUARDING DOCUMENTS — AND WE KNOW WHETHER THEY LANDED.
// Run: node --test scripts/an-adopted-relay-gets-the-safeguarding-documents.test.mjs
//
// REWRITTEN 2026-11-22 (PLAN-FIX-BACKFILL-AND-REMOVE-DOORS, Part A). The first version of this file pinned the old
// trigger (addRelay fires the backfill and forgets it) over a harness whose `pool.publish` spy ALWAYS RESOLVED and
// whose relay gate did not exist. That is exactly how two real faults stayed green (INTEGRATION-AUDIT-2026-11-22):
//   H1 — the documents were published to an address nobody had proved;
//   H2 — the new box REFUSED them (the church was not registered there yet) and the refusal was thrown away.
// So nothing here stubs the gate, and nothing here stubs "the relay said yes":
//   · the relay gate is the SHIPPED createRelayGate, built by the SHIPPED `var _gate = createRelayGate(…)` statement,
//     over a `verify` that really fails for an address that proves nothing;
//   · `pool.publish` answers per TARGET what a relay answers — OK, a refusal, "a newer version", a dead socket;
//   · the reads say WHO was asked and WHO answered, and the shipped _readCovers / _unprovedDroppable decide.
// Everything decision-making is lifted from vendor/steward.js and run (CLAUDE.md rule 3's vendor half).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fnBody, stmt } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEWARD = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');

const CP = 'c'.repeat(64);                                   // the church key (author of every safeguarding doc)
const CHILD = 'a'.repeat(64), ADULT = 'b'.repeat(64), PARENT = 'd'.repeat(64), BANNED = 'e'.repeat(64), STEWARD_KEY = '9'.repeat(64);
const OWN = 'wss://own.example/relay', POOL = 'wss://pool.example/relay', NEW = 'wss://newbox.example/relay';
const KEY_OWN = '1'.repeat(64), KEY_POOL = '2'.repeat(64), KEY_NEW = '3'.repeat(64);
const DOCS = ['minors', 'blocked', 'approved', 'guardians', 'nophoto'];
const dOf = (ev) => ((ev.tags || []).find((t) => t[0] === 'd') || [])[1] || '';
const kindOf = (ev) => (dOf(ev).match(/^trinityone\/([a-z-]+)/) || [])[1] || ('kind' + ev.kind);

// A current owner-signed document (pubkey === the church key unless `by` says otherwise).
const doc = (name, content, by = CP) => ({ id: name + '-' + by.slice(0, 4), pubkey: by, kind: 30078, created_at: 1000, tags: [['d', 'trinityone/' + name + ':' + CP], ['t', 'trinityone']], content: JSON.stringify(content) });
function fullDocs() {
  return {
    minors: doc('minors', { pubkeys: [CHILD] }),
    blocked: doc('blocked', { pubkeys: [BANNED] }),
    approved: doc('approved', { pubkeys: [ADULT], cleared: { [ADULT]: { by: CP, at: 9 } }, expiry: {} }),
    guardians: doc('guardians', { links: { [CHILD]: [PARENT] } }),
    nophoto: doc('nophoto', { pubkeys: [ADULT] }),
  };
}

// The gate and everything it stands on, out of the shipped bundle. `var _gate = createRelayGate(` is the SHIPPED
// construction (verify: verifyRelayIdentity, netEntries, origin, pins) — only its collaborators are this world's.
const GATE_LIFT = [
  ['fn', 'function relayHttpBase'], ['fn', 'function relayAddrKey'], ['fn', 'function _relayKey'], ['st', 'var _isHex64 = '],
  ['fn', 'function canonicalPinsFor'], ['fn', 'function isSharedAddress'], ['fn', 'function sharedRelayKeys'],
  ['fn', 'function _originKey'], ['fn', 'function sameOriginRelay'], ['fn', 'async function proveRelay'],
  ['st', 'var VERIFIED_KEY = '], ['st', 'var VERIFIED_TTL_SEC = '], ['st', 'var VERIFIED_REFRESH_SEC = '], ['st', 'var VERIFY_RETRY_SEC = '],
  ['fn', 'function readVerified'], ['fn', 'function writeVerified'], ['fn', 'function admitCached'], ['fn', 'function _scopesOf'],
  ['fn', 'function _admittingScope'], ['fn', 'function rememberVerified'], ['fn', 'function createRelayGate'],
  ['st', 'var _gate = createRelayGate('], ['fn', 'async function admitRemoteRelay'],
];
const ENGINE_LIFT = [
  ['st', 'var MINORS_D = '], ['st', 'var APPROVED_D = '], ['st', 'var GUARDIANS_D = '], ['st', 'var BLOCKED_D = '], ['st', 'var NOPHOTO_D = '],
  ['fn', 'function _readCovers'], ['fn', 'function _unprovedDroppable(provedUrls) {'],
  ['fn', 'async function _backfillSafeguardTo(target) {'],
];
const lift = (pieces) => pieces.map(([k, a]) => (k === 'fn' ? fnBody(STEWARD, a, a) : stmt(STEWARD, a, a))).join('\n');

// A console over a scripted fleet.
//   keys:      { url: hex } — what each address PROVES ('' = the proof fails, as a real one does)
//   relays:    relaysRaw() — every address the console lists (and therefore every address a read asks)
//   silent:    addresses that do not answer a read
//   docs:      { minors, blocked, approved, guardians, nophoto } the answering relays hold (absent key = never created)
//   answers:   { '<doc name>': 'ok' | 'duplicate' | 'newer' | 'refuse' | 'dead' | 'timeout' } what the TARGET says, default 'ok'.
//              A function (name, ev, urls) => one of those is also accepted, so a test can change the answer mid-run.
//   lifts / expose / scope: more shipped pieces, more names returned, more collaborators — for the adopt-path tests.
function world(opts = {}) {
  const { pub = CP, sk = 'sk', actingChurch = '', network = false } = opts;
  const keys = { [OWN]: KEY_OWN, [POOL]: KEY_POOL, [NEW]: KEY_NEW, ...(opts.keys || {}) };
  const relays = opts.relays || [OWN, POOL, NEW];
  const silent = new Set(opts.silent || []);
  const docs = opts.docs || fullDocs();
  const answers = opts.answers || {};
  const published = [];      // every (urls, ev) handed to pool.publish, in order
  const proofs = [];         // every address asked to prove itself
  const mem = new Map();
  const state = { sk, pub, actingChurch, keys, relays, answers, silent };
  const scope = {
    get sk() { return state.sk; }, get pub() { return state.pub; }, get actingChurch() { return state.actingChurch; },
    _viewingNetwork: () => network,
    normalizeURL: (u) => String(u), normalizeURL2: (u) => String(u),
    localStorage: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: (k) => { mem.delete(k); } },
    window: { dispatchEvent: () => true }, CustomEvent: function (n) { this.type = n; },
    CANONICAL_RELAY_PUBS: Object.freeze({ [POOL]: [KEY_POOL] }), CANONICAL_RELAYS: [POOL],
    relayNetEntries: async () => (opts.netEntries || []), _ownOrigin: () => 'https://own.example',
    relayNetCandidates: () => [OWN], relaysRaw: () => state.relays.slice(),
    // THE PROOF. It fails — throws, exactly as the shipped verifyRelayIdentity does — for an address that proves nothing.
    verifyRelayIdentity: async (u) => { proofs.push(u); const k = state.keys[u]; if (!k) throw new Error('no identity proof at ' + u); return { relayPub: k, url: u }; },
    _oneComplete: async (filters, _ms, priv) => {
      const d = (filters[0]['#d'] || [])[0] || '';
      const name = (d.match(/^trinityone\/([a-z-]+)/) || [])[1];
      if (opts.read) { const r = opts.read(name, filters, priv); if (r) return r; }
      assert.equal(priv, true, 'a safeguarding document was read without privateDoc — a relay still logging in would count as "answered: no document"');
      assert.deepEqual(filters[0].authors, [state.pub], 'the read is not restricted to the church key');
      return { ev: docs[name] || null, complete: true, askedUrls: state.relays.slice(), answeredUrls: state.relays.filter((u) => !state.silent.has(u) && u !== NEW) };
    },
    pool: { publish: (urls, ev) => {
      published.push({ urls: [...urls], ev });
      const a = (typeof state.answers === 'function' ? state.answers(kindOf(ev), ev, urls) : state.answers[kindOf(ev)]) || 'ok';
      if (a === 'ok') return [Promise.resolve('')];
      if (a === 'duplicate') return [Promise.resolve('duplicate')];
      if (a === 'dead') return [Promise.resolve('connection failure: could not connect')];
      if (a === 'timeout') return [Promise.reject(new Error('publish timed out'))];
      if (a === 'newer') return [Promise.reject(new Error('invalid: a newer version of this is already stored — reload and edit again'))];
      return [Promise.reject(new Error('blocked: not a member or not permitted'))];
    } },
    ...(opts.scope || {}),
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; if (process.env.DBG) console.error('MISSING', String(k)); throw new ReferenceError('the lifted backfill needs `' + String(k) + '` — add a stub'); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const api = new Function('scope', 'with (scope) {' + lift(GATE_LIFT) + '\n' + lift(ENGINE_LIFT) + '\n' + lift(opts.lifts || []) + (opts.more || '') +
    '\nreturn { _backfillSafeguardTo, admitRemoteRelay, _gate' + (opts.expose || '') + ' }; }')(proxy);
  return { api, published, proofs, state, scope, mem, docs, sentTo: (u) => published.filter((p) => p.urls.includes(u)).map((p) => kindOf(p.ev)) };
}

// ── 1. H1: nothing is sent to an address that has not proved it is one of ours ─────────────────────────────
test('an UNPROVEN target is sent ZERO documents (the real gate, over a proof that fails)', async () => {
  const w = world({ keys: { [NEW]: '' } });
  const r = await w.api._backfillSafeguardTo(NEW);
  assert.ok(w.proofs.includes(NEW), 're-anchor: the gate never asked the address to prove itself, so this is not testing the gate');
  assert.deepEqual(w.published, [],
    'THE CHURCH\'S CHILD LIST WAS PUBLISHED TO AN ADDRESS NOBODY HAD PROVED — a typo or a pasted hostile address receives minors:/guardians: in clear (audit H1): ' + JSON.stringify(w.published.map((p) => [p.urls, kindOf(p.ev)])));
  assert.equal(r.landed, false);
  assert.equal(r.why, 'unproven');
});

test('…and neither is a box answering at a SHIPPED address with a key we do not ship (the gate\'s one refusal)', async () => {
  const w = world({ relays: [OWN, POOL], keys: { [POOL]: 'f'.repeat(64) } });
  const r = await w.api._backfillSafeguardTo(POOL);
  assert.deepEqual(w.published, [], 'documents were sent to a replacement box at a shipped address');
  assert.equal(r.why, 'unproven');
});

// ── 2. a proved box that accepts: all five, verbatim, to that box only, minors before approved ─────────────
test('a PROVED box that accepts is sent the five current documents — verbatim, to that box only, minors: before approved: — and reads as landed', async () => {
  const w = world();
  const r = await w.api._backfillSafeguardTo(NEW);
  assert.equal(r.landed, true, JSON.stringify(r));
  assert.deepEqual(w.sentTo(NEW).slice().sort(), DOCS.slice().sort(), 'not every document reached the new box: ' + JSON.stringify(w.sentTo(NEW)));
  for (const p of w.published) {
    assert.deepEqual(p.urls, [NEW], kindOf(p.ev) + ' was not TARGETED to the new box only: ' + JSON.stringify(p.urls));
    assert.equal(p.ev, w.docs[kindOf(p.ev)], kindOf(p.ev) + ' was not the verbatim owner-signed event (it must be re-sent, never re-signed)');
  }
  assert.ok(w.sentTo(NEW).indexOf('minors') < w.sentTo(NEW).indexOf('approved'),
    'approved: was sent before minors: — a relay that does not yet know the minors cannot refuse a clearance that names one');
  for (const k of DOCS) assert.equal(r.results[k], 'landed', k + ': ' + r.results[k]);
});

// ── 3. H2: the relay's answer decides, not the fact that we sent ───────────────────────────────────────────
test('a box that REFUSES minors: (the church is not registered there yet) is NOT landed', async () => {
  const w = world({ answers: { minors: 'refuse', blocked: 'refuse', approved: 'refuse', guardians: 'refuse', nophoto: 'refuse' } });
  const r = await w.api._backfillSafeguardTo(NEW);
  assert.equal(r.landed, false,
    'A REFUSED BACKFILL WAS COUNTED AS DONE — the box holds no child list and a child reads as an adult there (audit H2): ' + JSON.stringify(r));
  assert.match(r.results.minors, /^refused: /);
});
test('…nor is one whose socket is dead, or that never answers', async () => {
  for (const a of ['dead', 'timeout']) {
    const r = await world({ answers: { minors: a } }).api._backfillSafeguardTo(NEW);
    assert.equal(r.landed, false, a + ': counted as landed: ' + JSON.stringify(r));
  }
  const b = await world({ answers: { blocked: 'timeout' } }).api._backfillSafeguardTo(NEW);
  assert.equal(b.landed, false, 'a blocklist that did not land was counted as landed: ' + JSON.stringify(b));
});
test('"a newer version is already stored" and "duplicate" both mean the box HAS the document: landed', async () => {
  const newer = await world({ answers: { minors: 'newer', blocked: 'newer' } }).api._backfillSafeguardTo(NEW);
  assert.equal(newer.landed, true, 'have-newer was treated as a refusal — the retry would then never end: ' + JSON.stringify(newer));
  const dup = await world({ answers: { minors: 'duplicate', blocked: 'duplicate' } }).api._backfillSafeguardTo(NEW);
  assert.equal(dup.landed, true, JSON.stringify(dup));
});

// ── 4. F6: an unfinished read is not "the church never made one" ───────────────────────────────────────────
test('a read the shared relay never answered is UNREAD, not "no such document": NOT landed (control: a whole read that finds none IS)', async () => {
  const none = { approved: fullDocs().approved };   // no minors:, no blocked: anywhere we could see
  const control = await world({ docs: none }).api._backfillSafeguardTo(NEW);
  assert.equal(control.landed, true, 'CONTROL: every relay answered and none holds a minors:/blocked: document — there is nothing to land: ' + JSON.stringify(control));
  assert.equal(control.results.minors, 'absent');
  const w = world({ docs: none, silent: [POOL] });
  const r = await w.api._backfillSafeguardTo(NEW);
  assert.equal(r.landed, false,
    'AN UNFINISHED READ WAS TAKEN AS "THE CHURCH HAS NO CHILD LIST" — the relay that did not answer may hold it (audit F6): ' + JSON.stringify(r));
  assert.equal(r.results.minors, 'unread');
});
test('…and a copy read from a partial view is sent for what it is worth but still does not count', async () => {
  const w = world({ silent: [POOL] });
  const r = await w.api._backfillSafeguardTo(NEW);
  assert.ok(w.sentTo(NEW).includes('minors'), 'the copy we did have was withheld');
  assert.equal(r.landed, false, 'a possibly stale child list was counted as the current one: ' + JSON.stringify(r));
});
test('one DEAD church-added row does not block adoption: it proves nothing, so it is excused from the read', async () => {
  const DEADROW = 'wss://old-tunnel.example/relay';
  const w = world({ relays: [OWN, POOL, DEADROW, NEW], silent: [DEADROW], keys: { [DEADROW]: '' } });
  const r = await w.api._backfillSafeguardTo(NEW);
  assert.equal(r.landed, true, 'a dead old-tunnel row the church added itself deadlocked every adoption: ' + JSON.stringify(r));
});
test('…but a silent row that still PROVES its key is not excused (it may hold the newest list)', async () => {
  const LIVE = 'wss://second-box.example/relay';
  const w = world({ relays: [OWN, POOL, LIVE, NEW], silent: [LIVE], keys: { [LIVE]: '4'.repeat(64) } });
  const r = await w.api._backfillSafeguardTo(NEW);
  assert.equal(r.landed, false, JSON.stringify(r));
});

// ── 5. must-land is minors: + blocked:; the rest is best-effort ────────────────────────────────────────────
test('approved: / guardians: / nophoto: refused does NOT stop the box landing (a stale clearance naming a minor is refused for ever)', async () => {
  const w = world({ answers: { approved: 'refuse', guardians: 'timeout', nophoto: 'dead' } });
  const r = await w.api._backfillSafeguardTo(NEW);
  assert.equal(r.landed, true, 'a best-effort document decided the outcome — one stale approved: would strand the box: ' + JSON.stringify(r));
  assert.match(r.results.approved, /^refused: /, 'the refusal was not reported');
});
test('nophoto: is carried only when the OWNER signed it; a steward-signed one is not sent (deferred, and said so in the engine)', async () => {
  const owner = world();
  await owner.api._backfillSafeguardTo(NEW);
  assert.ok(owner.sentTo(NEW).includes('nophoto'), 'the owner\'s photo-suppression list was not carried to the new box');
  const stew = world({ docs: { ...fullDocs(), nophoto: doc('nophoto', { pubkeys: [ADULT] }, STEWARD_KEY) } });
  const r = await stew.api._backfillSafeguardTo(NEW);
  assert.ok(!stew.sentTo(NEW).includes('nophoto'), 'a document not signed by the church key was forwarded as the church\'s');
  assert.equal(r.landed, true);
});

// ── 6. own console only ────────────────────────────────────────────────────────────────────────────────────
test('a delegated view, a network view and a locked console send nothing and never read as landed', async () => {
  for (const [why, o] of [['delegated', { actingChurch: 'f'.repeat(64) }], ['network', { network: true }], ['locked', { sk: null }]]) {
    const w = world(o);
    const r = await w.api._backfillSafeguardTo(NEW);
    assert.deepEqual(w.published, [], why + ': documents were sent');
    assert.equal(r.landed, false, why + ': read as landed');
  }
});

// ── 7. A1: writing an address down sends nothing ───────────────────────────────────────────────────────────
// The REAL Steward.addRelay over the same world: the real gate, the real engine in scope, a box that would prove
// and would accept. If addRelay still reached the engine, documents would be published here.
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
function addRelayWorld(opts = {}) {
  let store = [];
  const w = world({ ...opts,
    scope: { RELAYS_LS: 'trinityone.steward.extra-relays', normRelay: (u) => String(u || '').trim(), ownRelay: () => OWN,
      isOwnRelaySpelling: () => false, isSharedRelaySpelling: () => false, extraRelays: () => store.slice(),
      lsSet: (k, v) => { if (k === 'trinityone.steward.extra-relays') store = JSON.parse(v); }, undeclineRelay: () => {}, ...(opts.scope || {}) },
    more: '\nconst _add = { ' + fnBody(STEWARD, 'addRelay(input) {', 'addRelay') + ' };' + (opts.more || ''),
    expose: ', addRelay: (u) => _add.addRelay(u)' + (opts.expose || '') });
  return { ...w, store: () => store };
}
test('A1: addRelay records the address and publishes NOTHING — no document, no proof, to a box that would have accepted', async () => {
  const w = addRelayWorld();
  assert.equal(w.api.addRelay(NEW), NEW, 'addRelay should still record a new address');
  await settle();
  assert.deepEqual(w.store(), [NEW], 'the address was not written to the relay list');
  assert.deepEqual(w.published, [],
    'addRelay STILL SENDS THE SAFEGUARDING DOCUMENTS — on the typed-address paths it runs before the identity proof (audit H1): ' + JSON.stringify(w.sentTo(NEW)));
});
