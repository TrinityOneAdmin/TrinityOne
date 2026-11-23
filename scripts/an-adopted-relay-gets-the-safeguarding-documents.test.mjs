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
const DOCS = ['minors', 'blocked', 'approved', 'guardians', 'nophoto', 'joinpolicy'];
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
    joinpolicy: doc('joinpolicy', { approval: true }),
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
  ['st', 'var BACKFILL_SEND_MS = '], ['st', 'var MINORS_D = '], ['st', 'var APPROVED_D = '], ['st', 'var GUARDIANS_D = '], ['st', 'var BLOCKED_D = '], ['st', 'var NOPHOTO_D = '], ['st', 'var JOINPOLICY_D = '], ['fn', 'function _knownJoinApproval'],
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
  // `t`: this world's clock (ms). The dampers read Date.now(); a test moves time by moving `w.state.t`.
  const state = { sk, pub, actingChurch, keys, relays, answers, silent, t: 1800000000000 };
  const scope = {
    get sk() { return state.sk; }, get pub() { return state.pub; }, get actingChurch() { return state.actingChurch; },
    _viewingNetwork: () => network,
    Date: { now: () => state.t },
    normalizeURL: (u) => String(u), normalizeURL2: (u) => String(u),
    localStorage: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: (k) => { mem.delete(k); } },
    // this console's OWN settled read of the church's join policy: true | false | null (default: OPEN join, KNOWN — so a world with no joinpolicy document still lands; the approval-required cases pass opts.join). The real _knownJoinApproval is lifted.
    __join: () => (opts.join === undefined ? false : opts.join),
    window: { dispatchEvent: () => true, Steward: { joinPolicyFresh: () => (opts.join === undefined ? false : opts.join) } }, CustomEvent: function (n) { this.type = n; },
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
      if (a === 'hang') return [new Promise(() => {})];   // the library call never settles
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
test('a PROVED box that accepts is sent the six current documents — verbatim, to that box only, minors: before approved: — and reads as landed', async () => {
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

// ── 8. A2: Steward.signRelay is the choke point — prove, backfill, see it LAND, and only then sign ─────────
// The REAL signRelay, _adoptRelay, owed-marker store and retry, over the real gate and the real engine. The one
// collaborator that is a spy is enrolRelayNet — the step that signs the box into the church's relay-net document
// and so makes it a place members are routed to. What these tests ask is WHETHER and WHEN it is reached.
const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const BACKUP = readFileSync(join(ROOT, 'app/backup.jsx'), 'utf8');
const OWED_KEY = 'trinityone.steward.backfill-owed';
const ADOPT_LIFT = [
  ['fn', 'function lsGet(k) {'], ['fn', 'function lsSet(k, v) {'],
  ['st', 'var _enrolQueue = '], ['fn', 'function enrolSerial'],
  ['st', 'var BACKFILL_OWED_LS = '], ['fn', 'function _owedBackfills() {'], ['fn', 'function _setOwedBackfill(cp, url, on) {'],
  ['st', 'var RELAYS_REMOVED_D = '], ['st', 'var TOMB_PENDING_LS = '], ['fn', 'function _pendingTomb() {'], ['fn', 'function _tombable(keys, never) {'], ['fn', 'async function _removedKeysRead(droppable) {'],
  ['st', 'var _removePressed = '], ['fn', 'async function _adoptRelay(u, opts) {'], ['fn', 'function _adoptRelayAuto(u) {'], ['fn', 'function _signedIn(r, u) {'], ['st', 'var BACKFILL_RETRY_MS = '], ['st', 'var _owedRetrying = '], ['st', 'var _owedRetryLastAt = '], ['fn', 'async function retryOwedBackfills(opts) {'],
];
// THE REAL TOMBSTONE WRITER (FF1 in-flight, 2026-11-22), for the worlds that ask for it (`realTomb`). It is lifted
// under another name so the `_writeTombstone` every shipped caller reaches is a RECORDING SPY THAT FORWARDS EVERY
// ARGUMENT to it: the spy says WHO asked for a tombstone to be cleared, the real writer says what that did to the
// church's removed-keys document (`docs['relays-removed']`, which the world's reads serve and its `publish` replaces).
const REAL_TOMB = (() => {
  const a = 'async function _writeTombstone(opts) {';
  const body = fnBody(STEWARD, a, a);
  assert.equal(body.split(a).length - 1, 1, 're-anchor: the shipped _writeTombstone no longer starts the way this rename expects');
  return fnBody(STEWARD, 'function _setPendingTomb(keys) {', '_setPendingTomb') + '\n' + body.replace(a, 'async function _realWriteTombstone(opts) {');
})();
// A console that can adopt. `listed` is extraRelays() — the SAME array is returned as `w.listed`, so a test takes a
// row off this console's list by emptying it. Hooks, all optional:
//   onSend(doc, n)   called as the n-th backfill document is handed to the box (n === 5 is the last)
//   onEnrol()        called inside the signing step, before it answers
//   onRemovedRead(n) called AFTER the n-th read of the church's removed-keys document has been answered (the read
//                    itself is served untouched; what the hook changes is what the console finds when it returns)
// `w.spy` records what the adopt path asked its collaborators for: every _writeTombstone argument (`tomb`), every
// autoSyncHeal argument (`heals`), publishRelayList calls (`lists`) and every call made THROUGH window.Steward.signRelay
// (`stewardSign`). `w.log` also carries 'read:removed' each time the church's removed-keys document is read.
function adoptWorld(opts = {}) {
  const log = [];            // 'send:<doc>', 'read:removed' and 'enrol', in the order they happened
  const enrols = [];
  const listed = opts.listed || [NEW];
  const spy = { tomb: [], tombWrites: [], heals: [], lists: 0, stewardSign: [] };
  let wt = 0;
  const w = world({ ...opts,
    lifts: [...ADOPT_LIFT, ...(opts.lifts || [])],
    scope: {
      normRelay: (u) => String(u || '').trim(), extraRelays: () => listed.slice(),
      enrolRelayNet: async (o) => { log.push('enrol'); enrols.push(o);
        if (opts.onEnrol) await opts.onEnrol();
        return opts.enrolResult || { published: true, full: true, proven: [{ url: NEW, pubkey: KEY_NEW }], entries: [{ pubkey: KEY_NEW, url: NEW }] }; },
      _writeTombstone: async (...a) => { spy.tomb.push(a[0]); return opts.realTomb ? w.api._realWriteTombstone(...a) : { wrote: false }; },
      autoSyncHeal: async (...a) => { spy.heals.push(a[0]); return {}; },
      __spy: spy,
      // what the real tombstone writer stands on: a clock, a signer, and a relay that keeps the newest copy
      now: () => 3000, _monotonic: (t) => t,
      finalizeEvent: (t) => ({ ...t, pubkey: CP, id: 'tomb-w' + (++wt) }), finalizeEvent2: (t) => ({ ...t, pubkey: CP, id: 'tomb-w' + (++wt) }),
      publish: async (ev) => { spy.tombWrites.push(ev); w.docs['relays-removed'] = ev; return ev; },
      ...(opts.scope || {}) },
    more: (opts.realTomb ? '\n' + REAL_TOMB : '') + '\nconst _st = { ' + fnBody(STEWARD, '  signRelay(url) {', 'signRelay') + ' };' +
      '\nwindow.Steward = { joinPolicyFresh: () => __join(), signRelay: (...a) => { __spy.stewardSign.push(a); return _st.signRelay(...a); }, publishRelayList: (...a) => { __spy.lists++; return Promise.resolve(null); } };' + (opts.more || ''),
    expose: ', signRelay: (...a) => _st.signRelay(...a), retryOwedBackfills, _owedBackfills' + (opts.realTomb ? ', _realWriteTombstone' : '') + (opts.expose || '') });
  const realPublish = w.scope.pool.publish;
  w.scope.pool.publish = (urls, ev) => {
    log.push('send:' + kindOf(ev));
    if (opts.onSend) opts.onSend(kindOf(ev), log.filter((x) => x.startsWith('send:')).length);
    return realPublish(urls, ev);
  };
  const realRead = w.scope._oneComplete;
  w.scope._oneComplete = async (filters, ms, priv) => {
    if (!/relays-removed/.test(String((filters[0]['#d'] || [])[0] || ''))) return realRead(filters, ms, priv);
    log.push('read:removed');
    const r = await realRead(filters, ms, priv);
    if (opts.onRemovedRead) opts.onRemovedRead(log.filter((x) => x === 'read:removed').length);
    return r;
  };
  // The keys the church's removed-keys document names RIGHT NOW (what every console's heal and auto-join will read).
  const tombKeys = () => { const ev = w.docs['relays-removed']; if (!ev) return []; return JSON.parse(ev.content || '[]').map((t) => t.pubkey).sort(); };
  return { ...w, log, enrols, listed, spy, tombKeys, owed: () => JSON.parse(w.mem.get(OWED_KEY) || '[]') };
}
// signOutcome is a top-level function in app/stew-dashboard.jsx (shipped unbundled), sliced out and RUN (rule 3).
// test-slice's brace matcher cannot walk the regex literals inside it, so the slice is "from its first line to the
// first line that is a lone closing brace", re-anchored on both ends.
const signOutcome = (() => {
  const a = DASH.indexOf('function signOutcome(r, url) {'), b = DASH.indexOf('\n}\n', a);
  assert.ok(a > 0 && b > a, 're-anchor: signOutcome moved or was renamed in app/stew-dashboard.jsx');
  const body = DASH.slice(a, b + 2);
  assert.ok(/return '';\n}$/.test(body), 're-anchor: the slice does not end at signOutcome\'s own "added" return');
  return new Function(body + '\nreturn signOutcome;')();
})();

test('A2 POINT OF USE: signRelay sends the documents, sees minors: and blocked: LAND, and only then signs the box', async () => {
  const w = adoptWorld();
  const r = await w.api.signRelay(NEW);
  assert.ok(w.log.includes('send:minors') && w.log.includes('send:blocked'),
    'signRelay SIGNED A BOX WITHOUT SENDING IT THE SAFEGUARDING DOCUMENTS — every adopt path goes through here, so no adopted box gets them: ' + JSON.stringify(w.log));
  assert.equal(w.enrols.length, 1, 'the box was not signed after its documents landed');
  assert.deepEqual(w.enrols[0], { extra: [NEW] });
  assert.ok(w.log.indexOf('enrol') > w.log.indexOf('send:minors') && w.log.indexOf('enrol') > w.log.indexOf('send:blocked'),
    'THE BOX WAS SIGNED INTO THE CHURCH\'S LIST BEFORE ITS CHILD LIST LANDED — members are routed to a box that reads a child as an adult: ' + JSON.stringify(w.log));
  assert.equal(signOutcome(r, NEW), '', 'a box that landed and was signed did not read as added: ' + signOutcome(r, NEW));
  assert.deepEqual(w.owed(), [], 'a box that landed was left marked as owed');
});

test('A2: an UNPROVEN address is sent nothing, signed nowhere and owed nothing — and the steward is told it could not prove itself', async () => {
  const w = adoptWorld({ keys: { [NEW]: '' } });
  const r = await w.api.signRelay(NEW);
  assert.deepEqual(w.published, [], 'documents were sent to an address that proved nothing (audit H1)');
  assert.equal(w.enrols.length, 0, 'an address the gate refused was handed to the signing step');
  assert.deepEqual(w.owed(), [], 'an unproved address was written down as owed — it would be retried and signed with no further consent');
  assert.match(signOutcome(r, NEW), /could not prove it runs TrinityOne/);
});

test('A2: REFUSED, THEN REGISTERED — not signed and marked owed while the box refuses; the retry lands it, signs it and clears the marker', async () => {
  const w = adoptWorld({ answers: { minors: 'refuse', blocked: 'refuse', approved: 'refuse', guardians: 'refuse', nophoto: 'refuse' } });
  const r = await w.api.signRelay(NEW);
  assert.equal(r.pending, true, 'a box that refused the church\'s documents did not come back pending: ' + JSON.stringify(r));
  assert.equal(w.enrols.length, 0,
    'A BOX THAT REFUSED THE CHILD LIST WAS SIGNED INTO THE CHURCH\'S RELAY LIST — members are routed to it and a child there reads as an adult (audit H2)');
  assert.deepEqual(w.owed(), [{ churchPub: CP, url: NEW }], 'the box was not marked as owed, so nothing will ever try again');
  const said = signOutcome(r, NEW);
  assert.match(said, /waiting for the relay to accept your church/, 'the steward was not told the truth: ' + said);
  assert.notEqual(said, '', 'a pending box read as "✓ Added"');
  // a retry while it still refuses changes nothing
  await w.api.retryOwedBackfills();
  assert.equal(w.enrols.length, 0, 'the retry signed a box that still refuses');
  assert.deepEqual(w.owed(), [{ churchPub: CP, url: NEW }]);
  // the church is registered on the box: it accepts now (and the retry's ten-minute damper has passed — F2)
  w.state.answers = {};
  w.state.t += 11 * 60 * 1000;
  const out = await w.api.retryOwedBackfills();
  assert.equal(w.enrols.length, 1, 'the retry did not sign the box once its documents landed: ' + JSON.stringify(out));
  assert.deepEqual(w.owed(), [], 'the owed marker was not cleared once the box was signed');
});

test('A2: the retry does nothing for a row the steward has since REMOVED (consent withdrawn), for another church\'s rows, or on a delegated console', async () => {
  const gone = adoptWorld({ listed: [] });
  gone.mem.set(OWED_KEY, JSON.stringify([{ churchPub: CP, url: NEW }]));
  await gone.api.retryOwedBackfills();
  assert.deepEqual(gone.published, [], 'documents were sent to a relay the steward had removed');
  assert.equal(gone.enrols.length, 0, 'a relay the steward had removed was signed by the retry');
  assert.deepEqual(gone.owed(), [], 'the marker for a removed row was kept');
  const other = adoptWorld();
  other.mem.set(OWED_KEY, JSON.stringify([{ churchPub: '7'.repeat(64), url: NEW }]));
  await other.api.retryOwedBackfills();
  assert.equal(other.enrols.length, 0, 'ANOTHER CHURCH\'S owed relay was signed into this church\'s list');
  assert.deepEqual(other.published, []);
  assert.deepEqual(other.owed(), [{ churchPub: '7'.repeat(64), url: NEW }], 'another church\'s marker was touched');
  const deleg = adoptWorld({ actingChurch: 'f'.repeat(64) });
  deleg.mem.set(OWED_KEY, JSON.stringify([{ churchPub: CP, url: NEW }]));
  await deleg.api.retryOwedBackfills();
  assert.equal(deleg.enrols.length, 0); assert.deepEqual(deleg.published, []);
});

test('A2: a delegated console sends nothing and owes nothing (it goes to the signing step, which refuses it); a locked console throws and owes nothing', async () => {
  const deleg = adoptWorld({ actingChurch: 'f'.repeat(64), enrolResult: { removed: false, skipped: 'not this church’s own console' } });
  const r = await deleg.api.signRelay(NEW);
  assert.deepEqual(deleg.published, [], 'a delegated console sent the device church\'s documents');
  assert.deepEqual(deleg.owed(), []);
  assert.match(signOutcome(r, NEW), /Only your church’s own console/);
  const locked = adoptWorld({ sk: null });
  await assert.rejects(() => locked.api.signRelay(NEW), /No church key/);
  assert.deepEqual(locked.published, []); assert.deepEqual(locked.owed(), []); assert.equal(locked.enrols.length, 0);
});

test('A2: signOutcome never reads a pending result as added, whatever else the result carries', () => {
  for (const r of [{ pending: true }, { pending: true, published: true, full: true, proven: [{ url: NEW, pubkey: KEY_NEW }], entries: [{ pubkey: KEY_NEW }] }]) {
    assert.match(signOutcome(r, NEW), /waiting for the relay to accept your church/, JSON.stringify(r));
  }
});

// The real KeyDistributor effect, sliced out of app/stew-dashboard.jsx and RUN (the same anchors
// sync-list-heals-itself.test.mjs and a-console-signs-its-own-relay.test.mjs use).
test('A2 POINT OF USE: the console retries owed relays on boot and on every churn signal — cut the wire and this goes red', async () => {
  const START = "  // ── SIGN THIS CONSOLE'S OWN RELAY INTO THE CHURCH'S LIST", END = '  // ── end of the own-relay enrolment effect';
  const a = DASH.indexOf(START), b = DASH.indexOf(END, a);
  assert.ok(a > 0 && b > a, 're-anchor: the own-relay enrolment effect moved or was removed from KeyDistributor');
  const timers = [], listeners = new Map();
  let retries = 0;
  const win = { Steward: { retryOwedRelays: async () => { retries++; return {}; } },
    addEventListener(t, f) { (listeners.get(t) || listeners.set(t, []).get(t)).push(f); }, removeEventListener() {} };
  new Function('React', 'window', 'setTimeout', 'clearTimeout', 'unlockTick', DASH.slice(a, b))(
    { useEffect(fn) { fn(); } }, win, (fn) => { timers.push(fn); return timers.length; }, () => {}, 7);
  assert.equal(retries, 0, 'the retry ran before the deferred timer');
  for (const fn of timers) fn();
  assert.equal(retries, 1, 'THE CONSOLE NEVER RETRIES AN OWED RELAY — a box that refused once is never backfilled and never signed (rule 1)');
  for (const t of ['steward-relay-returned', 'focus', 'steward-relays']) (listeners.get(t) || []).slice().forEach((f) => f());
  assert.equal(retries, 4, 'a churn signal does not retry owed relays');
});

// app/backup.jsx ships unbundled, so the two functions are sliced out and RUN (rule 3).
test('A2: the owed marker does not leave in a backup and cannot be written by an imported file', () => {
  const body = [stmt(BACKUP, '  const ROUTING_KEYS = new Set(', 'ROUTING_KEYS'), stmt(BACKUP, '  const SEED_CACHE_RX = ', 'SEED_CACHE_RX'),
    fnBody(BACKUP, '  function snapshot(prefixes, exact) {', 'snapshot'), fnBody(BACKUP, '  function restoreLocal(map, allow, exact) {', 'restoreLocal'),
    stmt(BACKUP, '  const STEWARD_PREFIXES = ', 'STEWARD_PREFIXES')].join('\n');
  const store = (seed) => { const m = new Map(Object.entries(seed)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, key: (i) => [...m.keys()][i] || null, get length() { return m.size; } }; };
  const forged = JSON.stringify([{ churchPub: CP, url: 'wss://attacker.example/relay' }]);
  const src = store({ 'trinityone.steward.church-name': 'St Aidan', [OWED_KEY]: forged });
  const m = new Function('localStorage', body + '\nreturn { snapshot, restoreLocal, STEWARD_PREFIXES };')(src);
  const out = m.snapshot(m.STEWARD_PREFIXES);
  assert.ok('trinityone.steward.church-name' in out, 'staging fault: the export carries no steward state at all');
  assert.equal(OWED_KEY in out, false, 'the owed marker travels in a backup — an instruction to send a church\'s child list to an address and then sign it');
  const victim = store({});
  new Function('localStorage', body + '\nreturn { restoreLocal };')(victim).restoreLocal({ 'trinityone.steward.church-name': 'X', [OWED_KEY]: forged }, m.STEWARD_PREFIXES);
  assert.equal(victim.getItem('trinityone.steward.church-name'), 'X', 'staging fault: the import wrote nothing');
  assert.equal(victim.getItem(OWED_KEY), null, 'AN IMPORTED FILE WROTE AN OWED MARKER — the next focus would prove, send to and sign an address the steward never chose');
});

// ── 9. A6: the swap paths — the SAME box at a new address — send best-effort, awaited, and never block ──────
// The REAL refreshNamedRelays / adoptNetDocAddresses with the real _writeExtraRelays, over the real gate and engine.
const MOVED = 'wss://moved.example/relay', STALE = 'wss://stale.example/relay';
function swapWorld(opts = {}) {
  let store = opts.startStore || [STALE];
  const order = [];
  const w = world({ ...opts,
    relays: [OWN, POOL, MOVED], keys: { [MOVED]: KEY_NEW, ...(opts.keys || {}) },
    read: (name) => (opts.read ? opts.read(name) : null),
    lifts: [['fn', 'function _writeExtraRelays(list) {'], ['st', 'var _refreshingNames = '], ['fn', 'async function refreshNamedRelays() {'], ['fn', 'async function adoptNetDocAddresses() {']],
    scope: {
      RELAYS_LS: 'trinityone.steward.extra-relays', lsSet: (k, v) => { if (k === 'trinityone.steward.extra-relays') store = JSON.parse(v); },
      extraRelays: () => store.slice(), normRelay: (u) => String(u || '').trim(), isSharedRelaySpelling: () => false, isOwnRelaySpelling: () => false,
      getNamedRelays: () => (opts.named || []).map((e) => ({ ...e })), setNamedRelays: () => {}, resolveRelayName: async () => ({ url: opts.resolvesTo || MOVED }),
      // adoptNetDocAddresses' collaborators: one signed entry for the box, at its new address
      churchPub: CP, relayNetDoc: async () => ({ ev: { pubkey: CP, content: '{}' } }), parseRelayNet: () => [{ url: MOVED, pubkey: KEY_NEW }],
      retireDeadAdoptedRows: async () => {}, _netDocDialUrl: (u) => String(u || ''), _isDeclined: () => false,
      _staleBoxSpelling: (u) => ((opts.staleSwap && u === MOVED) ? STALE : ''), _alreadyACandidate: () => false,
      setAdoptedRelays: () => {}, adoptedRelays: () => [], _rememberAdoptedName: () => {}, _tagAdopted: () => {}, NETDOC_ADOPT_MAX: 8,
    },
    more: '\nwindow.Steward = { joinPolicyFresh: () => __join(), publishRelayList: () => { __order.push("relay-list"); return Promise.resolve(null); }, addRelay: (u) => { __add(u); return u; } };',
    expose: ', refreshNamedRelays, adoptNetDocAddresses' });
  w.scope.__order = order; w.scope.__add = (u) => { store = [...store, u]; };
  const realPublish = w.scope.pool.publish;
  w.scope.pool.publish = (urls, ev) => { order.push('send:' + kindOf(ev)); return realPublish(urls, ev); };
  return { ...w, order, store: () => store };
}
// in a swap world the box being read FROM is everything but the moved address
const swapRead = (silent) => (name) => ({ ev: fullDocs()[name] || null, complete: true, askedUrls: [OWN, POOL, MOVED], answeredUrls: [OWN, POOL].filter((u) => !(silent || []).includes(u)) });

test('A6 refreshNamedRelays: a swap to a NEW address sends the documents to it and WAITS for them before the member relay list is republished', async () => {
  const w = swapWorld({ named: [{ name: 'box', url: STALE }], read: swapRead() });
  await w.api.refreshNamedRelays();
  assert.ok(w.store().includes(MOVED) && !w.store().includes(STALE), 'the swap did not land in the relay list');
  assert.deepEqual(w.sentTo(MOVED).slice().sort(), DOCS.slice().sort(), 'the swapped-in address was not sent the church\'s documents: ' + JSON.stringify(w.sentTo(MOVED)));
  assert.ok(w.order.includes('relay-list'), 're-anchor: the swap no longer republishes the member relay list');
  assert.ok(w.order.indexOf('relay-list') > w.order.lastIndexOf('send:blocked') && w.order.indexOf('relay-list') > w.order.lastIndexOf('send:minors'),
    'THE NEW ADDRESS WAS ADVERTISED TO MEMBERS BEFORE ITS CHILD LIST WAS SENT — the backfill is not awaited: ' + JSON.stringify(w.order));
});
test('A6 refreshNamedRelays: a same-address refresh sends nothing; a box that REFUSES is still swapped in (best-effort, no owed marker)', async () => {
  const same = swapWorld({ startStore: [MOVED], named: [{ name: 'box', url: MOVED }], read: swapRead() });
  await same.api.refreshNamedRelays();
  assert.deepEqual(same.published, [], 'a same-address refresh re-sent the safeguarding documents');
  const refused = swapWorld({ named: [{ name: 'box', url: STALE }], read: swapRead(), answers: { minors: 'refuse', blocked: 'refuse' } });
  await refused.api.refreshNamedRelays();
  assert.ok(refused.store().includes(MOVED), 'a refused backfill blocked the address swap — the console would keep a dead address');
  assert.equal(refused.mem.get(OWED_KEY) || null, null, 'a swap wrote an owed marker');
});
test('A6 adoptNetDocAddresses: both branches — the stale-spelling swap and a newly learned address — send the documents to the address', async () => {
  const swap = swapWorld({ staleSwap: true, read: swapRead() });
  assert.deepEqual(await swap.api.adoptNetDocAddresses(), [MOVED], 'the stale-spelling swap did not adopt the moved address');
  assert.ok(swap.sentTo(MOVED).includes('minors') && swap.sentTo(MOVED).includes('blocked'), 'the stale-swapped address was not sent the child list: ' + JSON.stringify(swap.sentTo(MOVED)));
  const fresh = swapWorld({ startStore: [], read: swapRead() });
  assert.deepEqual(await fresh.api.adoptNetDocAddresses(), [MOVED], 'the newly learned address was not adopted');
  assert.ok(fresh.sentTo(MOVED).includes('minors') && fresh.sentTo(MOVED).includes('blocked'),
    'AN ADDRESS LEARNED FROM THE CHURCH\'S SIGNED LIST GOT NOTHING — addRelay no longer sends (A1), and nothing else did: ' + JSON.stringify(fresh.sentTo(MOVED)));
});

// ── 10. A5: autoPickRelays (no screen calls it; scripts and devtools can) goes through the same choke point ─
function autoPickWorld(opts = {}) {
  const added = [];
  const w = adoptWorld({ ...opts, scope: { discoverRelayOffers: async () => [{ url: NEW, name: 'newbox' }], relays: () => [OWN, POOL], pickRelays: (o, n) => o.slice(0, n), ...(opts.scope || {}) } });
  // The REAL autoPickRelays, with window.Steward wired to the REAL signRelay the world already built.
  // (Everything the lifted code names must live ON the scope: inside `with (scope)` the proxy claims every
  // non-global identifier, so a Function parameter would be shadowed by `undefined`.)
  w.scope.__picked = added; w.scope.__sign = w.api.signRelay;
  const pick = new Function('scope', 'with (scope) { const _o = { ' + fnBody(STEWARD, 'async autoPickRelays(n) {', 'autoPickRelays') +
    ' }; window.Steward = { joinPolicyFresh: () => __join(), addRelay: (u) => { __picked.push(u); return u; }, signRelay: __sign, publishRelayList: () => Promise.resolve(null) }; return (n) => _o.autoPickRelays(n); }')(
    new Proxy(w.scope, { has: (t, k) => (k in t) || !(String(k) in globalThis), get: (t, k) => (k === Symbol.unscopables ? undefined : t[k]) }));
  return { ...w, added, autoPickRelays: pick };
}
test('A5: autoPickRelays hands each pick to signRelay — documents first, then signed; a box that refuses is left owed and NOT signed', async () => {
  const ok = autoPickWorld();
  await ok.autoPickRelays(1);
  assert.deepEqual(ok.added, [NEW], 're-anchor: autoPickRelays picked nothing');
  assert.ok(ok.sentTo(NEW).includes('minors') && ok.sentTo(NEW).includes('blocked'),
    'autoPickRelays ADOPTED A BOX WITHOUT THE BACKFILL — an adopt path that never reaches the choke point: ' + JSON.stringify(ok.log));
  assert.equal(ok.enrols.length, 1, 'the auto-picked box was not signed after its documents landed');
  assert.ok(ok.log.indexOf('enrol') > ok.log.indexOf('send:minors'), 'signed before the child list was sent: ' + JSON.stringify(ok.log));
  const refused = autoPickWorld({ answers: { minors: 'refuse', blocked: 'refuse' } });
  await refused.autoPickRelays(1);
  assert.equal(refused.enrols.length, 0, 'an auto-picked box that refused the child list was signed');
  assert.deepEqual(refused.owed(), [{ churchPub: CP, url: NEW }]);
});

// ── 11. F8: the church's OWN box, entering the list through the automatic enrolment, is backfilled first ───
// The REAL autoEnrolRelayNet and _ownBoxBackfill over the real gate and engine. `net` is what the church's relay-net
// document holds; `netWhole` whether that read was whole. The target of the backfill is OWN.
function ownBoxWorld(opts = {}) {
  const log = [], enrols = [];
  const net = opts.net || [];
  const flags = { sharedDown: !!opts.sharedDown, netWhole: opts.netWhole !== false };   // the shared relay — the only holder of the documents — is not answering
  const w = world({ ...opts, relays: [OWN, POOL],
    read: (name) => (flags.sharedDown ? { ev: null, complete: false, askedUrls: [OWN, POOL], answeredUrls: [] }
      : { ev: fullDocs()[name] || null, complete: true, askedUrls: [OWN, POOL], answeredUrls: [POOL] }),   // the documents live on the shared relay; the own box is the empty one
    lifts: [['st', 'var _enrolQueue = '], ['fn', 'function enrolSerial'], ['fn', 'function parseRelayNet'], ['fn', 'async function _ownBoxBackfill(own) {'], ['st', 'var BACKFILL_RETRY_MS = '], ['st', 'var _autoEnrolled = '], ['st', 'var _ownGateLast = '], ['st', 'var _ownOwed = '], ['fn', 'async function autoEnrolRelayNet() {']],
    scope: { _boxHostsUs: true, selfPublicRelay: () => '', selfRelayName: () => '',
      relayNetDoc: async () => ({ ev: { pubkey: CP, content: JSON.stringify(net) }, askedUrls: [OWN, POOL], answeredUrls: flags.netWhole ? [OWN, POOL] : [OWN] }),
      enrolRelayNet: async (o) => { log.push('enrol'); enrols.push(o); return { published: true, proven: [{ url: OWN, pubkey: KEY_OWN }], entries: [{ pubkey: KEY_OWN }], delivered: [OWN] }; },
      ...(opts.scope || {}) },
    expose: ', autoEnrolRelayNet' });
  const realPublish = w.scope.pool.publish;
  w.scope.pool.publish = (urls, ev) => { log.push('send:' + kindOf(ev)); return realPublish(urls, ev); };
  return { ...w, log, enrols, flags };
}
test('F8: an own box ENTERING the list (a restored church on a new box) is sent the child list, and signed only after it landed', async () => {
  const w = ownBoxWorld({ net: [{ pubkey: '8'.repeat(64), url: 'wss://the-old-box.example/relay' }] });
  await w.api.autoEnrolRelayNet();
  assert.deepEqual(w.sentTo(OWN).slice().sort(), DOCS.slice().sort(),
    'A RESTORED CHURCH\'S NEW BOX WAS SIGNED AS ITS PRIMARY RELAY WITHOUT THE SAFEGUARDING DOCUMENTS (audit F8): ' + JSON.stringify(w.log));
  assert.deepEqual(w.enrols, [{ auto: true }], 'the own box was not enrolled after its documents landed');
  assert.ok(w.log.indexOf('enrol') > w.log.indexOf('send:minors') && w.log.indexOf('enrol') > w.log.indexOf('send:blocked'), 'signed before the child list landed: ' + JSON.stringify(w.log));
});
test('F8: an entering own box that does NOT take the child list is not signed — and the next pass tries again and signs it once it does', async () => {
  const w = ownBoxWorld({ net: [], answers: { minors: 'refuse', blocked: 'refuse' } });
  const r = await w.api.autoEnrolRelayNet();
  assert.equal(w.enrols.length, 0, 'THE OWN BOX WAS SIGNED INTO THE CHURCH\'S LIST WHILE IT HELD NO CHILD LIST');
  assert.equal(r && r.pending, true, JSON.stringify(r));
  w.state.answers = {};
  w.state.t += 11 * 60 * 1000;   // past the own-box gate's damper (F2)
  await w.api.autoEnrolRelayNet();
  assert.equal(w.enrols.length, 1, 'a held pass was remembered as done, so the own box is never signed this session');
});
test('F8: an own box ALREADY in the list is not held back (best-effort send), and neither is one whose list could not be read whole', async () => {
  const known = ownBoxWorld({ net: [{ pubkey: KEY_OWN, url: OWN }], answers: { minors: 'refuse', blocked: 'refuse' } });
  await known.api.autoEnrolRelayNet();
  assert.ok(known.sentTo(OWN).includes('minors'), 'the documents were not even offered to an own box already in the list');
  assert.equal(known.enrols.length, 1, 'A BOX ALREADY IN THE CHURCH\'S LIST WAS HELD BACK — a tunnel address change would stop being re-signed whenever a send failed');
  const unread = ownBoxWorld({ net: [], netWhole: false, answers: { minors: 'refuse', blocked: 'refuse' } });
  await unread.api.autoEnrolRelayNet();
  assert.equal(unread.enrols.length, 1, 'the enrolment was held on a relay-net read that was not whole — the own-box first-list exception (third audit) is gone');
});

// ── 12. F4 (Part A audit): a wrong-author answer is UNREAD, never "the church has no such document" ────────
test('F4: when the newest minors: a relay serves is signed by SOMEBODY ELSE, the box is NOT landed and nothing is sent in its place (control: no answer at all on a whole read IS absent)', async () => {
  const stranger = doc('minors', { pubkeys: [] }, STEWARD_KEY);
  const whole = (ev) => ({ ev, complete: true, askedUrls: [OWN, POOL, NEW], answeredUrls: [OWN, POOL] });
  const w = world({ read: (name) => (name === 'minors' ? whole(stranger) : whole(fullDocs()[name] || null)) });
  const r = await w.api._backfillSafeguardTo(NEW);
  assert.equal(r.results.minors, 'unread', 'a wrong-author hit was read as: ' + r.results.minors);
  assert.equal(r.landed, false,
    'A STRANGER\'S DOCUMENT HID THE CHURCH\'S CHILD LIST AND THE BOX WAS COUNTED AS LANDED WITH NO minors: SENT (F4): ' + JSON.stringify(r));
  assert.ok(!w.sentTo(NEW).includes('minors'), 'somebody else\'s document was forwarded as the church\'s');
  const c = world({ read: (name) => (name === 'minors' ? whole(null) : whole(fullDocs()[name] || null)) });
  assert.equal((await c.api._backfillSafeguardTo(NEW)).results.minors, 'absent', 'CONTROL: a whole read with no answer should still be "absent"');
});

// ── 13. F3 (Part A audit, rule 4): what "proved" means, as the engine's comment now states it ──────────────
test('F3: a box that proved EARLIER and does not answer the proof now is still admitted (the gate\'s cache) — a never-proved one is not', async () => {
  const w = world();
  assert.equal(await w.api.admitRemoteRelay(NEW), true, 'precondition: the box proves');
  w.state.keys[NEW] = '';                       // it stops answering the identity proof
  const r = await w.api._backfillSafeguardTo(NEW);
  assert.ok(w.proofs.filter((u) => u === NEW).length >= 2, 're-anchor: no new proof was attempted on the second pass');
  assert.notEqual(r.why, 'unproven', 'the engine now demands a FRESH proof — the comment and the owed-retry both assume it does not: ' + JSON.stringify(r));
  assert.ok(w.sentTo(NEW).includes('minors'), 'a box with a valid cached proof was sent nothing');
});

// ── 14. Part A audit, nit: a send that never answers cannot stall the pass ─────────────────────────────────
// The engine's own bound (BACKFILL_SEND_MS, lifted) decides; only the CLOCK is this world's, so the test does not
// sit for eight real seconds: any timer of a second or more fires in a few milliseconds.
test('a publish that NEVER settles is given up on (not landed, the pass returns) instead of hanging the adoption for ever', async () => {
  const waits = [];
  const w = world({ answers: { minors: 'hang' }, scope: { setTimeout: (fn, ms) => { waits.push(ms); return setTimeout(fn, ms >= 1000 ? 5 : ms); }, clearTimeout } });
  const r = await Promise.race([w.api._backfillSafeguardTo(NEW), new Promise((res) => setTimeout(() => res('STALLED'), 3000))]);
  assert.notEqual(r, 'STALLED', 'A HUNG PUBLISH STALLED THE WHOLE BACKFILL — and with it the signing step it gates');
  assert.equal(r.landed, false, JSON.stringify(r));
  assert.match(r.results.minors, /^refused: timeout/);
  assert.ok(waits.includes(8000), 're-anchor: the bound is no longer 8 s: ' + JSON.stringify(waits));
});

// ── 15. F6 (Part A audit): the owed marker goes only when the box is actually signed in ───────────────────
// The documents LAND in every case below; what varies is what the signing step answers.
const PROVEN = [{ url: NEW, pubkey: KEY_NEW }], NAMED = [{ pubkey: KEY_NEW, url: NEW }];
test('F6: a box whose documents landed stays OWED when the signing step did not put it in the list — and is cleared when it did', async () => {
  for (const [why, enrolResult] of [
    ['the list could not be read (unknown)', { published: false, unknown: true, proven: PROVEN, entries: [] }],
    ['the publish reached no relay', { published: false, proven: PROVEN, entries: NAMED, delivered: [] }],
    ['the box failed its proof at signing', { published: false, proven: [], unproven: [NEW], entries: [] }],
    ['an unchanged list that was not read in full', { published: false, full: false, proven: PROVEN, entries: NAMED }],
  ]) {
    const w = adoptWorld({ enrolResult });
    await w.api.signRelay(NEW);
    assert.equal(w.enrols.length, 1, why + ': re-anchor — the documents did not land, so the signing step was never reached');
    assert.deepEqual(w.owed(), [{ churchPub: CP, url: NEW }],
      why + ': THE OWED MARKER WAS CLEARED ALTHOUGH THE BOX IS NOT IN THE CHURCH\'S LIST — the retry stops and the box is never signed (F6)');
  }
  for (const [why, enrolResult] of [
    ['a publish that landed', { published: true, proven: PROVEN, entries: NAMED }],
    ['already in the list, read in full', { published: false, full: true, proven: PROVEN, entries: NAMED }],
    ['a shared relay (nothing to sign)', { published: false, proven: [{ url: NEW, pubkey: KEY_NEW, shared: true }], entries: [] }],
  ]) {
    const w = adoptWorld({ enrolResult });
    w.mem.set(OWED_KEY, JSON.stringify([{ churchPub: CP, url: NEW }]));
    await w.api.retryOwedBackfills();
    assert.deepEqual(w.owed(), [], why + ': the marker was kept for a box that IS signed in — it would be retried for ever');
  }
});

// ── 16. F2 (Part A audit): the damper — signals are cheap, a steward's click is immediate ─────────────────
test('F2: two retry signals inside ten minutes run ONE pass; a forced retry and a steward\'s own Connect are not damped; a damped pass runs again after the window', async () => {
  const refuse = { minors: 'refuse', blocked: 'refuse' };
  const w = adoptWorld({ answers: refuse });
  w.mem.set(OWED_KEY, JSON.stringify([{ churchPub: CP, url: NEW }]));
  const sendsOf = () => w.log.filter((x) => x === 'send:minors').length;
  const first = await w.api.retryOwedBackfills();
  assert.equal(first.ran, true); assert.equal(sendsOf(), 1);
  const second = await w.api.retryOwedBackfills();   // another focus, a moment later
  assert.equal(second.debounced, true, 'a second signal inside the window was not damped: ' + JSON.stringify(second));
  assert.equal(sendsOf(), 1,
    'EVERY SIGNAL RE-RAN THE WHOLE PASS — a proof per relay, five reads and five sends on each window focus, for as long as a box is owed (F2)');
  await w.api.retryOwedBackfills({ force: true });
  assert.equal(sendsOf(), 2, 'a forced retry was damped');
  await w.api.signRelay(NEW);                           // the steward presses Connect again
  assert.equal(sendsOf(), 3, 'A STEWARD\'S OWN CONNECT WAS DAMPED — a click must act at once');
  w.state.t += 9 * 60 * 1000;
  assert.equal((await w.api.retryOwedBackfills()).debounced, true, 'nine minutes on, the pass ran again');
  w.state.t += 2 * 60 * 1000;
  assert.equal((await w.api.retryOwedBackfills()).ran, true, 'past the window the retry never runs again');
  assert.equal(sendsOf(), 4);
  // a console with nothing owed does not start the clock
  const idle = adoptWorld({ answers: refuse });
  assert.equal((await idle.api.retryOwedBackfills()).none, true);
  idle.mem.set(OWED_KEY, JSON.stringify([{ churchPub: CP, url: NEW }]));
  assert.equal((await idle.api.retryOwedBackfills()).ran, true, 'a pass with nothing to do used up the damper window');
});
test('F2: an own-box enrolment that is tried again inside ten minutes does not prove, read or send again — it reuses the gate\'s last answer', async () => {
  // HELD: an entering box that refuses. Signals keep arriving; nothing more is sent until the window has passed.
  const held = ownBoxWorld({ net: [], answers: { minors: 'refuse', blocked: 'refuse' } });
  await held.api.autoEnrolRelayNet();
  const n = held.published.length, p = held.proofs.length;
  assert.ok(n > 0, 're-anchor: the first pass sent nothing');
  const again = await held.api.autoEnrolRelayNet();
  assert.equal(held.published.length, n, 'a held own box was sent everything again on the next signal (F2)');
  assert.equal(held.proofs.length, p, 'a held own box was re-proved on the next signal (F2)');
  assert.equal(held.enrols.length, 0, 'the damped pass let a HELD box through');
  assert.equal(again && again.pending, true);
  // GO-AHEAD, but the enrolment itself did not work (unknown): it is retried on the next signal WITHOUT a second backfill.
  let n2 = 0;
  const flaky = ownBoxWorld({ net: [], scope: { enrolRelayNet: async () => { n2++; return n2 === 1 ? { unknown: true, proven: [] } : { published: true, proven: [{ url: OWN, pubkey: KEY_OWN }], entries: [{ pubkey: KEY_OWN }], delivered: [OWN] }; } } });
  await flaky.api.autoEnrolRelayNet();
  const sent = flaky.published.length;
  await flaky.api.autoEnrolRelayNet();
  assert.equal(n2, 2, 're-anchor: the enrolment was not retried');
  assert.equal(flaky.published.length, sent, 'the retried enrolment ran the whole backfill again inside the window');
});

// ── 17. F1 (Part A audit, the restore case): an own box signed WITHOUT its documents is owed them ─────────
// The own box is already in the church's list (so the gate does not hold it) and the shared relay that holds the
// documents is not answering. The enrolment goes through; the documents have not landed; the pass is "done".
test('F1: an own box signed without its documents landing is remembered as owed — a later signal re-runs the backfill, it lands, and then it stops', async () => {
  const w = ownBoxWorld({ net: [{ pubkey: KEY_OWN, url: OWN }], sharedDown: true });
  await w.api.autoEnrolRelayNet();
  assert.equal(w.enrols.length, 1, 'precondition: the own box was not enrolled');
  assert.deepEqual(w.sentTo(OWN), [], 'precondition: documents were sent although none could be read');
  // The shared relay is back. A signal inside the damper window does nothing…
  w.flags.sharedDown = false;
  await w.api.autoEnrolRelayNet();
  assert.deepEqual(w.sentTo(OWN), [], 'the own-box backfill ran again inside the damper window');
  // …and one after it re-runs the backfill, which lands. The enrolment itself is NOT run again.
  w.state.t += 11 * 60 * 1000;
  await w.api.autoEnrolRelayNet();
  assert.ok(w.sentTo(OWN).includes('minors') && w.sentTo(OWN).includes('blocked'),
    'THE OWN BOX WAS SIGNED WITHOUT THE CHILD LIST AND NOTHING EVER SENT IT — until the next page load, a restored church\'s primary box reads a child as an adult (F1): ' + JSON.stringify(w.log));
  assert.equal(w.enrols.length, 1, 'the enrolment was run a second time');
  const sent = w.published.length;
  w.state.t += 11 * 60 * 1000;
  await w.api.autoEnrolRelayNet();
  assert.equal(w.published.length, sent, 'the own box was backfilled again after its documents had landed — it is not cleared from owed');
});
test('F1: an own box whose documents landed on the first pass is NOT owed: later signals send nothing', async () => {
  const w = ownBoxWorld({ net: [{ pubkey: KEY_OWN, url: OWN }] });
  await w.api.autoEnrolRelayNet();
  const sent = w.published.length;
  assert.ok(sent > 0, 're-anchor: the first pass sent nothing');
  w.state.t += 11 * 60 * 1000;
  await w.api.autoEnrolRelayNet();
  assert.equal(w.published.length, sent, 'a landed own box is re-sent its documents on every signal');
});

// ── 18. FF3 (final combined audit): the damper never reuses a "cannot tell" go-ahead ──────────────────────
// Boot: the church's relay-net document cannot be read whole, so the gate cannot tell whether the own box is
// entering and lets the enrolment through best-effort (the third-audit exception). That enrolment answers unknown.
// A moment later the read IS whole and shows the box entering — and it has not taken the child list.
test('FF3: a go-ahead given on an UNREADABLE list is not reused — the next signal inside the window does not sign an entering box that has no child list', async () => {
  let n = 0;
  const w = ownBoxWorld({ net: [], netWhole: false, answers: { minors: 'refuse', blocked: 'refuse' },
    scope: { enrolRelayNet: async () => { n++; return n === 1 ? { unknown: true, proven: [] } : { published: true, proven: [{ url: OWN, pubkey: KEY_OWN }], entries: [{ pubkey: KEY_OWN }], delivered: [OWN] }; } } });
  await w.api.autoEnrolRelayNet();
  assert.equal(n, 1, 're-anchor: the cannot-tell pass did not reach the enrolment (the third-audit exception is gone)');
  w.flags.netWhole = true;                        // the shared relay answers now: the list does not name the own box
  const r2 = await w.api.autoEnrolRelayNet();     // a focus, seconds later
  assert.equal(n, 1,
    'AN ENTERING OWN BOX WITH NO CHILD LIST WAS SIGNED ON A REUSED "CANNOT TELL" GO-AHEAD — the damper skipped the gate (FF3)');
  assert.equal(r2 && r2.pending, true, JSON.stringify(r2));
  w.state.t += 11 * 60 * 1000;                    // past the window: the gate runs for real, sees it entering, and holds it
  await w.api.autoEnrolRelayNet();
  assert.equal(n, 1, 'past the window an entering box that still refuses was signed');
  w.state.answers = {}; w.state.t += 11 * 60 * 1000;
  await w.api.autoEnrolRelayNet();
  assert.equal(n, 2, 'once the documents land the own box is never enrolled');
});

// ── 19. FF1 (final combined audit): the owed retry honours a Remove ───────────────────────────────────────
// An owed box would land and be signed on this pass (it proves, it accepts). The only thing that differs between the
// worlds below is what the church's removed-keys document — or this console's pending set — says about its key.
const tombDoc = (keys) => ({ id: 'tomb', pubkey: CP, kind: 30078, created_at: 2000, tags: [['d', 'trinityone/relays-removed']], content: JSON.stringify(keys.map((pubkey) => ({ pubkey, at: 1900 }))) });
const owedWorld = (opts = {}) => { const w = adoptWorld(opts); w.mem.set(OWED_KEY, JSON.stringify([{ churchPub: CP, url: NEW }])); return w; };
test('FF1: an owed box that has since been REMOVED is not re-signed by the retry — its marker is dropped and nothing is sent (control: with no tombstone it is signed)', async () => {
  const control = owedWorld();
  await control.api.retryOwedBackfills();
  assert.equal(control.enrols.length, 1, 'CONTROL: with nothing removed, the owed box should land and be signed');
  const w = owedWorld({ docs: { ...fullDocs(), 'relays-removed': tombDoc([KEY_NEW]) } });
  const out = await w.api.retryOwedBackfills();
  assert.equal(w.enrols.length, 0,
    'A REMOVED RELAY WAS SIGNED BACK INTO THE CHURCH\'S LIST BY THE OWED RETRY — nobody pressed anything, and signRelay then clears its tombstone (FF1): ' + JSON.stringify(out));
  assert.deepEqual(w.published, [], 'the church\'s documents were sent to a relay it had removed');
  assert.deepEqual(w.owed(), [], 'the owed marker of a removed relay was kept — it would be retried for ever');
  // …and the same for a Remove on THIS console whose tombstone has not landed yet (the pending set).
  const pend = owedWorld();
  pend.mem.set('trinityone.steward.tomb-pending.' + CP, JSON.stringify([KEY_NEW]));
  await pend.api.retryOwedBackfills();
  assert.equal(pend.enrols.length, 0, 'a relay whose Remove is still pending on this console was re-signed by the owed retry');
  assert.deepEqual(pend.owed(), []);
  // …and for a removed box that is NOT answering its proof right now but still holds a valid cached one (the gate
  // would admit it, so the retry would go on to sign it): its key is taken from that cached proof.
  const cached = owedWorld({ docs: { ...fullDocs(), 'relays-removed': tombDoc([KEY_NEW]) } });
  assert.equal(await cached.api.admitRemoteRelay(NEW), true, 'precondition: the box proved once');
  cached.state.keys[NEW] = '';
  await cached.api.retryOwedBackfills();
  assert.equal(cached.enrols.length, 0); assert.deepEqual(cached.published, []);
  assert.deepEqual(cached.owed(), [], 'a removed box with only a CACHED proof kept its owed marker — it is signed back in the moment it answers again');
});
test('FF1: when the removed-keys read is NOT whole the retry does nothing at all this pass (fail closed) and keeps the marker; the same when the box proves no key', async () => {
  const w = owedWorld({ silent: [POOL] });   // the shared relay — which may hold the tombstone — is not answering
  const out = await w.api.retryOwedBackfills();
  assert.equal(out.removedUnknown, true, JSON.stringify(out));
  assert.equal(w.enrols.length, 0, 'A BOX WAS SIGNED WITHOUT KNOWING WHETHER IT HAD BEEN REMOVED');
  assert.deepEqual(w.published, []);
  assert.deepEqual(w.owed(), [{ churchPub: CP, url: NEW }], 'an unreadable removed-keys document dropped the owed marker');
  const mute = owedWorld({ keys: { [NEW]: '' } });   // no proof now, and none cached: there is no key to look up
  await mute.api.retryOwedBackfills();
  assert.equal(mute.enrols.length, 0); assert.deepEqual(mute.published, []);
  assert.deepEqual(mute.owed(), [{ churchPub: CP, url: NEW }], 'a box that proved nothing lost its owed marker');
});

// ── 9. joinpolicy (SIGNUP-SAFEGUARDING-GAPS gap 3, owner D5) ───────────────────────────────────────────────────
// A box without the church's joinpolicy serves an approval church as OPEN-JOIN (absent == approval off). `landed` for it is
// decided from THIS CONSOLE'S OWN settled knowledge of the church's policy (Steward.joinPolicyFresh, via the lifted
// _knownJoinApproval) — never from the target read, which is empty by definition: true -> must land; null -> not landed
// (`policy-unknown`); false -> best effort. The document is the OWNER-signed copy only, sent verbatim, never re-signed.
const { joinpolicy: _jp, ...docsNoJoin } = fullDocs();
test('D5 approval REQUIRED (console knows): joinpolicy is sent verbatim to the new box, and a landed box reads as landed', async () => {
  const w = world({ join: true });
  const r = await w.api._backfillSafeguardTo(NEW);
  assert.ok(w.sentTo(NEW).includes('joinpolicy'), 'the church\'s join policy was not carried to the new box');
  assert.equal(w.published.find((p) => kindOf(p.ev) === 'joinpolicy').ev, w.docs.joinpolicy, 'joinpolicy was not the verbatim owner-signed event');
  assert.equal(r.results.joinpolicy, 'landed'); assert.equal(r.landed, true, JSON.stringify(r));
});
test('D5 approval REQUIRED: a box that REFUSES joinpolicy is NOT landed even though minors: and blocked: landed (it would serve an approval church as open-join)', async () => {
  const w = world({ join: true, answers: { joinpolicy: 'refuse' } });
  const r = await w.api._backfillSafeguardTo(NEW);
  assert.equal(r.results.minors, 'landed'); assert.equal(r.results.blocked, 'landed');
  assert.match(r.results.joinpolicy, /^refused: /);
  assert.equal(r.landed, false, 'A BOX THAT REFUSED THE JOIN POLICY OF AN APPROVAL CHURCH COUNTED AS LANDED: ' + JSON.stringify(r));
  assert.equal(r.why, 'not-landed');
});
test('D5 approval REQUIRED: a timed-out or dead send is not landed; a "newer version already stored" answer IS (the box already holds one)', async () => {
  for (const a of ['timeout', 'dead']) assert.equal((await world({ join: true, answers: { joinpolicy: a } }).api._backfillSafeguardTo(NEW)).landed, false, a);
  assert.equal((await world({ join: true, answers: { joinpolicy: 'newer' } }).api._backfillSafeguardTo(NEW)).landed, true);
});
test('D5 approval REQUIRED but the owner has NO joinpolicy copy to send (e.g. only a steward ever wrote one): NOT landed — absent is only ok when the church is open', async () => {
  const w = world({ join: true, docs: docsNoJoin });
  const r = await w.api._backfillSafeguardTo(NEW);
  assert.equal(r.results.joinpolicy, 'absent');
  assert.equal(r.landed, false, 'a box with no join policy was counted as landed for a church the console knows requires approval');
});
test('D5 policy NOT KNOWN (null): fails CLOSED — not landed with why "policy-unknown", even when every document landed', async () => {
  const w = world({ join: null });
  const r = await w.api._backfillSafeguardTo(NEW);
  assert.equal(r.results.minors, 'landed'); assert.equal(r.results.joinpolicy, 'landed');
  assert.equal(r.landed, false, 'A BOX WAS COUNTED AS LANDED WHILE THE CONSOLE DID NOT KNOW WHETHER THE CHURCH REQUIRES APPROVAL');
  assert.equal(r.why, 'policy-unknown');
});
test('D5 OPEN-join church (console knows false): joinpolicy is best-effort — a refusal, or no copy at all, does not strand the box', async () => {
  assert.equal((await world({ join: false, answers: { joinpolicy: 'refuse' } }).api._backfillSafeguardTo(NEW)).landed, true);
  assert.equal((await world({ join: false, docs: docsNoJoin }).api._backfillSafeguardTo(NEW)).landed, true);
});
test('D5 a steward-signed joinpolicy is NOT forwarded as the church\'s (owner-authored only; deferred like nophoto)', async () => {
  const w = world({ join: false, docs: { ...fullDocs(), joinpolicy: doc('joinpolicy', { approval: true }, STEWARD_KEY) } });
  await w.api._backfillSafeguardTo(NEW);
  assert.ok(!w.sentTo(NEW).includes('joinpolicy'), 'a document not signed by the church key was forwarded as the church\'s');
});
test('D5 POINT OF USE: signRelay does NOT sign a box into the church\'s list when the church requires approval and the box refused joinpolicy', async () => {
  const w = adoptWorld({ join: true, answers: { joinpolicy: 'refuse' } });
  const r = await w.api.signRelay(NEW);
  assert.equal(r.pending, true, 'a box that refused the join policy of an approval church did not come back pending: ' + JSON.stringify(r));
  assert.equal(w.enrols.length, 0, 'AN APPROVAL CHURCH\'S NEW BOX WAS SIGNED INTO THE RELAY LIST WITHOUT ITS JOIN POLICY — members are routed to a box that admits anyone');
  assert.deepEqual(w.owed(), [{ churchPub: CP, url: NEW }], 'the box was not marked as owed');
});
// ── 20. FF1 IN-FLIGHT (PLAN-FIX-FF1-2026-11-22): a Remove that lands WHILE an automatic adopt is running ──
// Section 19 is the Remove that landed BEFORE the pass: the up-front read sees it. These are the Removes that land
// AFTER that read — while the church's documents are being sent to the box, which takes seconds — and before the
// box is signed. Everything is entered at the point of use (retryOwedBackfills; autoJoinPublicRelays), the real
// _adoptRelayAuto / _adoptRelay / gate / backfill run, and the tombstone writer is the SHIPPED one behind a
// forwarding spy (`realTomb`). The ONE spy that answers for itself is enrolRelayNet, the signing step: "was the box
// signed" is "was that step reached".
//
// The Remove is staged from inside `pool.publish`, on the LAST of the five backfill sends — after the pass's
// up-front removed-keys read, before the signing slot. Each test re-anchors that ordering from the log.
const TOMB_LS = 'trinityone.steward.tomb-pending.' + CP;
const midFlight = (stage, extra = {}) => {
  const fired = { n: 0 };
  const w = owedWorld({ realTomb: true, ...extra, onSend: (_doc, n) => { if (n === DOCS.length) { fired.n++; stage(w); } } });
  return Object.assign(w, { fired });
};
// The Remove was staged exactly once, after a removed-keys read (the pass's own) — and where the last send sits.
const lastSendAt = (w) => w.log.reduce((at, x, i) => (x.startsWith('send:') ? i : at), -1);
const assertStagedMidFlight = (w, why) => {
  assert.equal(w.fired.n, 1, why + ': re-anchor — the mid-flight Remove was never staged (the backfill no longer makes five sends)');
  assert.ok(w.log.slice(0, lastSendAt(w)).includes('read:removed'),
    why + ': re-anchor — the pass did not read the removed keys BEFORE the backfill, so this Remove is not "after the up-front read": ' + JSON.stringify(w.log));
};
test('FF1 in-flight POINT OF USE (owed retry): another console\'s Remove lands while the documents are being sent — the box is NOT signed and its tombstone is NOT cleared (control: no Remove, it is signed)', async () => {
  const control = midFlight(() => {});
  const c = await control.api.retryOwedBackfills();
  await settle();
  assert.equal(control.enrols.length, 1, 'CONTROL: with no Remove the owed box should land and be signed: ' + JSON.stringify(c));
  assert.deepEqual(control.owed(), [], 'CONTROL: a signed box was left owed');
  // The Remove: the church's removed-keys document now names the box's key. The row is still on THIS console's list.
  const w = midFlight((x) => { x.docs['relays-removed'] = tombDoc([KEY_NEW]); });
  const out = await w.api.retryOwedBackfills();
  await settle();
  assertStagedMidFlight(w, 'tombstone');
  assert.equal(w.enrols.length, 0,
    'A RELAY REMOVED WHILE THE OWED RETRY WAS SENDING IT THE CHURCH\'S DOCUMENTS WAS SIGNED BACK INTO THE LIST — nobody pressed anything (FF1 in-flight): ' + JSON.stringify(w.log));
  assert.deepEqual(w.tombKeys(), [KEY_NEW], 'THE FRESH TOMBSTONE WAS ERASED BY AN AUTOMATIC PASS — the Remove is undone for good: ' + JSON.stringify(w.docs['relays-removed']));
  assert.deepEqual(w.spy.tombWrites, [], 'the removed-keys document was re-signed by an automatic pass');
  assert.deepEqual(w.owed(), [], 'a removed box kept its owed marker — it is retried on every pass');
  assert.deepEqual(out.rows, [{ url: NEW, pending: false, signed: false }], JSON.stringify(out));
  assert.ok(w.log.lastIndexOf('read:removed') > lastSendAt(w), 'the removed keys were not read again after the backfill: ' + JSON.stringify(w.log));
  assert.deepEqual(w.spy.heals, [], 'a pass that signed nothing forced a sync heal');
  assert.equal(w.spy.lists, 0, 'a pass that signed nothing republished the member relay list');
});

test('FF1 in-flight (owed retry): the row is taken off THIS console\'s list mid-flight — not signed, marker dropped; and with a tombstone as well, that tombstone stays', async () => {
  // What removeRelay does on this console: the address leaves the church-added list AND the list every read asks.
  // (Leaving it in the asked list would make the in-slot removed-keys read incomplete — the box would then go
  // unsigned for THAT reason, and this would not be testing the still-listed question at all.)
  const unlist = (x) => { x.listed.length = 0; x.state.relays = x.state.relays.filter((u) => u !== NEW); };
  const w = midFlight(unlist);
  await w.api.retryOwedBackfills();
  await settle();
  assertStagedMidFlight(w, 'withdrawn');
  assert.equal(w.enrols.length, 0, 'A ROW THE STEWARD TOOK OFF THE LIST WHILE THE RETRY WAS RUNNING WAS SIGNED ANYWAY: ' + JSON.stringify(w.log));
  assert.deepEqual(w.owed(), [], 'a withdrawn row kept its owed marker');
  // Both at once — what a Remove on another console looks like once this console has also dropped the row.
  const both = midFlight((x) => { x.docs['relays-removed'] = tombDoc([KEY_NEW]); unlist(x); });
  await both.api.retryOwedBackfills();
  await settle();
  assertStagedMidFlight(both, 'tombstone + withdrawn');
  assert.equal(both.enrols.length, 0);
  assert.deepEqual(both.tombKeys(), [KEY_NEW], 'the tombstone was cleared');
  assert.deepEqual(both.owed(), []);
});

test('FF1 in-flight (owed retry): a Remove still PENDING on this console (its tombstone has not landed) stops the signing too', async () => {
  const w = midFlight((x) => { x.mem.set(TOMB_LS, JSON.stringify([KEY_NEW])); });
  await w.api.retryOwedBackfills();
  await settle();
  assertStagedMidFlight(w, 'pending');
  assert.equal(w.enrols.length, 0, 'A RELAY WHOSE REMOVE IS PENDING ON THIS CONSOLE WAS SIGNED BY THE RETRY: ' + JSON.stringify(w.log));
  assert.deepEqual(JSON.parse(w.mem.get(TOMB_LS)), [KEY_NEW], 'the pending Remove was withdrawn by an automatic pass — its tombstone will now never be written');
  assert.deepEqual(w.owed(), []);
});

test('FF1 in-flight FAIL CLOSED (owed retry): when the removed keys cannot be read whole inside the slot, or the box\'s key cannot be resolved there, nothing is signed and the row stays OWED', async () => {
  // The shared relay — which may hold a tombstone written a second ago — stops answering after the up-front read.
  const blind = midFlight((x) => { x.state.silent.add(POOL); });
  await blind.api.retryOwedBackfills();
  await settle();
  assertStagedMidFlight(blind, 'unreadable');
  assert.equal(blind.enrols.length, 0, 'A BOX WAS SIGNED BY AN AUTOMATIC PASS THAT COULD NOT TELL WHETHER IT HAD JUST BEEN REMOVED: ' + JSON.stringify(blind.log));
  assert.deepEqual(blind.owed(), [{ churchPub: CP, url: NEW }], 'an unreadable removed-keys document dropped the owed marker — the box is never tried again');
  // No key: the gate's proof has lapsed and the box does not answer a fresh one — which box is this? Cannot say.
  const mute = midFlight((x) => { x.state.keys[NEW] = ''; x.state.t += 31 * 24 * 3600 * 1000; });
  await mute.api.retryOwedBackfills();
  await settle();
  assertStagedMidFlight(mute, 'unproven');
  assert.equal(mute.api._gate.provedKey(NEW, CP), '', 're-anchor: the gate still holds a valid proof, so the key WAS resolvable and this is not the unproven case');
  assert.equal(mute.enrols.length, 0, 'A BOX WHOSE KEY COULD NOT BE RESOLVED WAS SIGNED — its key cannot have been looked up among the removed ones: ' + JSON.stringify(mute.log));
  assert.deepEqual(mute.owed(), [{ churchPub: CP, url: NEW }], 'a box that could not prove its key in the slot lost its owed marker');
});

test('FF1 in-flight: an automatic adopt that DOES sign runs the forced heal and republishes the relay list — and never asks for a tombstone to be cleared, never goes through Steward.signRelay', async () => {
  const OTHER = '8'.repeat(64);
  const w = owedWorld({ realTomb: true, docs: { ...fullDocs(), 'relays-removed': tombDoc([OTHER]) } });
  await w.api.retryOwedBackfills();
  await settle();
  assert.equal(w.enrols.length, 1, 're-anchor: the owed box was not signed');
  assert.deepEqual(w.spy.heals, [{ force: true }], 'a box signed by the retry did not get the forced sync heal a Connect gets: ' + JSON.stringify(w.spy.heals));
  assert.equal(w.spy.lists, 1, 'a box signed by the retry was not followed by a republished member relay list');
  assert.deepEqual(w.spy.tomb.filter((o) => o && o.remove), [],
    'AN AUTOMATIC PASS ASKED FOR A REMOVAL TOMBSTONE TO BE CLEARED — only a steward\'s own Add may undo a Remove: ' + JSON.stringify(w.spy.tomb));
  assert.deepEqual(w.spy.stewardSign, [], 'the owed retry went through Steward.signRelay, whose success path clears the tombstone of the key it signs');
  assert.deepEqual(w.tombKeys(), [OTHER]);
});

test('FF1 in-flight, WHAT IS NOT CLOSED: a Remove from another console that lands while the signing step itself is running is signed over for that beat — but its tombstone SURVIVES', async () => {
  const w = owedWorld({ realTomb: true, onEnrol: () => { w.docs['relays-removed'] = tombDoc([KEY_NEW]); } });
  await w.api.retryOwedBackfills();
  await settle();
  assert.equal(w.enrols.length, 1, 're-anchor: the signing step was not reached, so the Remove was not staged');
  assert.deepEqual(w.tombKeys(), [KEY_NEW],
    'A REMOVE THAT LANDED DURING AN AUTOMATIC SIGNING HAD ITS TOMBSTONE ERASED — the box is re-trusted for good, not for a beat: ' + JSON.stringify(w.docs['relays-removed']));
  assert.deepEqual(w.spy.tomb.filter((o) => o && o.remove), []);
});

test('FF1 in-flight REGRESSION: a steward\'s OWN Connect is unchanged — it signs a tombstoned box and CLEARS that tombstone, even one that landed mid-flight, and does not need the row on the list', async () => {
  // Re-Add of a removed box: last write wins, by owner decision.
  const KEPT = '8'.repeat(64);
  const w = adoptWorld({ realTomb: true, docs: { ...fullDocs(), 'relays-removed': tombDoc([KEY_NEW, KEPT]) } });
  const r = await w.api.signRelay(NEW);
  await settle();
  assert.equal(w.enrols.length, 1, 'A STEWARD\'S DELIBERATE CONNECT OF A REMOVED BOX WAS REFUSED — the automatic re-check has leaked into the deliberate path: ' + JSON.stringify(r));
  assert.deepEqual(w.spy.tomb.map((o) => o.remove), [[KEY_NEW]], 'the deliberate Connect did not ask for exactly its own key to be un-tombstoned: ' + JSON.stringify(w.spy.tomb));
  assert.deepEqual(w.tombKeys(), [KEPT], 'a deliberate Connect did not clear the tombstone of the box it connected (or cleared another): ' + JSON.stringify(w.docs['relays-removed']));
  assert.deepEqual(w.spy.heals, [{ force: true }]); assert.equal(w.spy.lists, 1);
  assert.deepEqual(w.owed(), []);
  assert.ok(!w.log.slice(0, w.log.indexOf('enrol')).includes('read:removed'),
    'the deliberate path now reads the removed keys before signing — it must be unchanged: ' + JSON.stringify(w.log));
  // …the Remove lands mid-flight: still signed, still cleared (VP12 — the steward's Add is the later act).
  const fired = { n: 0 };
  const mid = adoptWorld({ realTomb: true, onSend: (_d, n) => { if (n === DOCS.length) { fired.n++; mid.docs['relays-removed'] = tombDoc([KEY_NEW]); mid.mem.set(TOMB_LS, JSON.stringify([KEY_NEW])); } } });
  await mid.api.signRelay(NEW);
  await settle();
  assert.equal(fired.n, 1, 're-anchor: the mid-flight Remove was never staged');
  assert.equal(mid.enrols.length, 1, 'a deliberate Connect was stopped by a Remove that landed while it ran');
  assert.deepEqual(mid.tombKeys(), [], 'a deliberate Connect left the tombstone of the box it connected');
  // …and a row that is not on this console's list still signs: the deliberate path never asked that question.
  const unlisted = adoptWorld({ realTomb: true, listed: [] });
  await unlisted.api.signRelay(NEW);
  assert.equal(unlisted.enrols.length, 1, 'a deliberate Connect now requires the row to be on the list');
});

// The community auto-join, entered at ITS point of use: the REAL autoJoinPublicRelays over the same real
// _adoptRelayAuto / _adoptRelay / gate / backfill / tombstone writer. Its directory, its preferences document and
// its registration call are this world's; the box is offered, proves KEY_NEW, registers, and is added to the list.
const JOIN_LIFT = [
  ['st', 'var PUBLIC_TARGET_DEFAULT = '], ['fn', 'function _clampPublicTarget(n) {'], ['fn', 'function _communityCap(publicTarget) {'], ['fn', 'function _mergeChosen(a, b) {'],
  ['fn', 'function rankOffersByLatency(offers) {'], ['fn', 'async function autoJoinPublicRelays() {'],
];
function joinWorld(opts = {}) {
  const chosenWrites = [];
  const fired = { n: 0 };
  const w = adoptWorld({ realTomb: true, listed: [], relays: [OWN, POOL], lifts: JOIN_LIFT, ...opts,
    onSend: (_doc, n) => { if (n === DOCS.length && opts.stage) { fired.n++; opts.stage(w); } },
    scope: {
      _readRelayPrefs: async () => ({ prefs: null, complete: true }),
      _writeRelayPrefs: async (mutate) => { chosenWrites.push(mutate({}).chosen); return { written: true }; },
      discoverRelayOffers: async () => [{ url: NEW, name: 'newbox', ms: 10 }],
      relays: () => [OWN, POOL], selfPublicRelay: () => '', ownRelay: () => OWN,
      _ownChurchName: () => 'St Aidan', _isDeclined: () => false, isSharedRelaySpelling: () => false, isOwnRelaySpelling: () => false,
      __addRow: (u) => { if (!w.listed.includes(u)) { w.listed.push(u); w.state.relays.push(u); } return u; },
    },
    more: '\nwindow.Steward.registerAtRelay = async () => ({ ok: true, status: 200 }); window.Steward.addRelay = (u) => __addRow(u); window.Steward.rememberRelayName = () => {};',
    expose: ', autoJoinPublicRelays' });
  return Object.assign(w, { chosenWrites, fired });
}
test('FF1 in-flight POINT OF USE (community auto-join): a Remove lands while the pass is sending the box the church\'s documents — not signed, not recorded as chosen, tombstone NOT cleared (control: no Remove, it is adopted)', async () => {
  const control = joinWorld();
  const c = await control.api.autoJoinPublicRelays();
  await settle();
  assert.equal(control.enrols.length, 1, 'CONTROL: with no Remove the offered box should be signed: ' + JSON.stringify(c));
  assert.deepEqual(c.added, [{ url: NEW, pubkey: KEY_NEW }], JSON.stringify(c));
  assert.deepEqual(control.spy.stewardSign, [], 'the auto-join went through Steward.signRelay, whose success path clears the tombstone of the key it signs');
  assert.deepEqual(control.spy.tomb.filter((o) => o && o.remove), [], 'the auto-join asked for a removal tombstone to be cleared: ' + JSON.stringify(control.spy.tomb));
  assert.deepEqual(control.spy.heals, [{ force: true }], 'a box the auto-join signed did not get the forced sync heal');

  const w = joinWorld({ stage: (x) => { x.docs['relays-removed'] = tombDoc([KEY_NEW]); } });
  const out = await w.api.autoJoinPublicRelays();
  await settle();
  assert.equal(w.fired.n, 1, 're-anchor: the mid-flight Remove was never staged');
  assert.ok(w.log.slice(0, w.log.indexOf('send:minors')).includes('read:removed'), 're-anchor: the pass did not read the removed keys before the backfill: ' + JSON.stringify(w.log));
  assert.equal(w.enrols.length, 0,
    'THE DEFAULT-ON AUTO-JOIN SIGNED A BOX THAT WAS REMOVED WHILE IT WAS BEING ADOPTED — nobody pressed anything (FF1 in-flight): ' + JSON.stringify(w.log));
  assert.deepEqual(w.tombKeys(), [KEY_NEW], 'THE FRESH TOMBSTONE WAS ERASED BY THE AUTO-JOIN: ' + JSON.stringify(w.docs['relays-removed']));
  assert.deepEqual(w.spy.tombWrites, [], 'the removed-keys document was re-signed by the auto-join');
  assert.deepEqual(out.added, [], 'a removed box was reported as adopted: ' + JSON.stringify(out));
  assert.deepEqual(w.chosenWrites, [], 'a removed box was recorded in the church-wide chosen set (it would hold a cap slot on every console)');
  assert.deepEqual(out.skipped, [[NEW, 'unsigned']], JSON.stringify(out));
  assert.deepEqual(w.owed(), [], 'a removed box was left owed by the auto-join — the retry would try it on every pass');
});

// ── 21. FF1 in-flight, post-build audit: the church SWITCHES while the signing slot is reading ────────────
// The automatic slot awaits two things before it signs (a proof, when the gate holds none, and the removed-keys
// read). enrolRelayNet signs for whichever church is active WHEN IT RUNS, so a console that changed church during
// those awaits would sign church A's owed box into church B's list. The switch is made as the in-slot read (the
// second removed-keys read of the pass) comes back — a whole read, no tombstone: every other check says go.
test('FF1 in-flight POINT OF USE (owed retry): the console switches church while the signing slot is reading the removed keys — the box is NOT signed, and the first church still owes it', async () => {
  const OTHER_CHURCH = '7'.repeat(64);
  for (const [why, switchTo] of [
    ['another church is unlocked', (x) => { x.state.pub = OTHER_CHURCH; x.state.sk = 'sk-of-the-other-church'; }],
    ['the console starts acting for a helped church', (x) => { x.state.actingChurch = OTHER_CHURCH; }],
  ]) {
    let switched = 0;
    const w = owedWorld({ realTomb: true, onRemovedRead: (n) => { if (n === 2) { switched++; switchTo(w); } } });
    const out = await w.api.retryOwedBackfills();
    await settle();
    assert.equal(switched, 1, why + ': re-anchor — the pass made no second removed-keys read, so the church never switched: ' + JSON.stringify(w.log));
    assert.ok(w.log.indexOf('send:minors') < w.log.lastIndexOf('read:removed'), why + ': re-anchor — the switch was not made after the backfill (inside the slot): ' + JSON.stringify(w.log));
    assert.equal(w.enrols.length, 0,
      why + ': AN AUTOMATIC PASS SIGNED A RELAY FOR THE WRONG CHURCH — the console changed church while the slot was reading, and the signing step signs for whoever is active when it runs: ' + JSON.stringify(w.log));
    assert.deepEqual(w.owed(), [{ churchPub: CP, url: NEW }], why + ': the first church\'s owed marker was dropped — its box is never tried again: ' + JSON.stringify(out));
    assert.deepEqual(w.spy.heals, [], why + ': a sync heal was forced for a pass that signed nothing');
    assert.equal(w.spy.lists, 0, why + ': the member relay list was republished for a pass that signed nothing');
  }
});
