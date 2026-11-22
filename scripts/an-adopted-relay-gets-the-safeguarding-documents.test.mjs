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
  ['fn', 'async function _adoptRelay(u) {'], ['st', 'var _owedRetrying = '], ['fn', 'async function retryOwedBackfills() {'],
];
function adoptWorld(opts = {}) {
  const log = [];            // 'send:<doc>' and 'enrol', in the order they happened
  const enrols = [];
  const listed = opts.listed || [NEW];
  const w = world({ ...opts,
    lifts: ADOPT_LIFT,
    scope: {
      normRelay: (u) => String(u || '').trim(), extraRelays: () => listed.slice(),
      enrolRelayNet: async (o) => { log.push('enrol'); enrols.push(o);
        return opts.enrolResult || { published: true, full: true, proven: [{ url: NEW, pubkey: KEY_NEW }], entries: [{ pubkey: KEY_NEW, url: NEW }] }; },
      _writeTombstone: async () => ({ wrote: false }), autoSyncHeal: async () => ({}),
      ...(opts.scope || {}) },
    more: '\nconst _st = { ' + fnBody(STEWARD, '  signRelay(url) {', 'signRelay') + ' };\nwindow.Steward = { signRelay: (u) => _st.signRelay(u), publishRelayList: () => Promise.resolve(null) };',
    expose: ', signRelay: (u) => _st.signRelay(u), retryOwedBackfills, _owedBackfills' });
  const realPublish = w.scope.pool.publish;
  w.scope.pool.publish = (urls, ev) => { log.push('send:' + kindOf(ev)); return realPublish(urls, ev); };
  return { ...w, log, enrols, listed, owed: () => JSON.parse(w.mem.get(OWED_KEY) || '[]') };
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
  // the church is registered on the box: it accepts now
  w.state.answers = {};
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
    more: '\nwindow.Steward = { publishRelayList: () => { __order.push("relay-list"); return Promise.resolve(null); }, addRelay: (u) => { __add(u); return u; } };',
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
    ' }; window.Steward = { addRelay: (u) => { __picked.push(u); return u; }, signRelay: __sign, publishRelayList: () => Promise.resolve(null) }; return (n) => _o.autoPickRelays(n); }')(
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
  const w = world({ ...opts, relays: [OWN, POOL],
    read: (name) => ({ ev: fullDocs()[name] || null, complete: true, askedUrls: [OWN, POOL], answeredUrls: [POOL] }),   // the documents live on the shared relay; the own box is the empty one
    lifts: [['st', 'var _enrolQueue = '], ['fn', 'function enrolSerial'], ['fn', 'function parseRelayNet'], ['fn', 'async function _ownBoxBackfill(own) {'], ['st', 'var _autoEnrolled = '], ['fn', 'async function autoEnrolRelayNet() {']],
    scope: { _boxHostsUs: true, selfPublicRelay: () => '', selfRelayName: () => '',
      relayNetDoc: async () => ({ ev: { pubkey: CP, content: JSON.stringify(net) }, askedUrls: [OWN, POOL], answeredUrls: opts.netWhole === false ? [OWN] : [OWN, POOL] }),
      enrolRelayNet: async (o) => { log.push('enrol'); enrols.push(o); return { published: true, proven: [{ url: OWN, pubkey: KEY_OWN }], entries: [{ pubkey: KEY_OWN }], delivered: [OWN] }; } },
    expose: ', autoEnrolRelayNet' });
  const realPublish = w.scope.pool.publish;
  w.scope.pool.publish = (urls, ev) => { log.push('send:' + kindOf(ev)); return realPublish(urls, ev); };
  return { ...w, log, enrols };
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
