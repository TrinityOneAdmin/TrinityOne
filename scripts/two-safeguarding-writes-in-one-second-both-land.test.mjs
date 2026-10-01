// TWO WRITES OF ONE SAFEGUARDING DOCUMENT IN THE SAME SECOND MUST BOTH LAND, IN ORDER.
// Run: node --test scripts/two-safeguarding-writes-in-one-second-both-land.test.mjs
//
// Stage 3 of reference/SCOPE-RELAY-CORRECTED-TIME-2026-09-26.md. NO CORRECTION — the stamp is still the
// console's own clock. All that changed is that every raw finalizeEvent() publisher in src/steward.src.js
// now goes through _monotonic(), which 55 of the file's 83 publishers already did via feChurch().
//
// THE INCIDENT THIS CLOSES, in the owner's terms. A steward marks a child as a child. It appears to save.
// On the child's phone the app still says they are not a child, for ever, with nothing on any screen saying
// so. The measured version is written on publishClearance in src/steward.src.js: a fast clock wrote
// {minor:false} and beat the correct {minor:true} that followed; the relay answered "a newer version of
// this is already stored", the run reported failed:0, no banner, and nothing ever retried.
//
// That incident has two halves. One is the CLOCK (stage 4). The other needs no clock at all: two writes in
// the same second TIE, and a tie is broken by the lowest event id — so half the time the relay keeps the
// FIRST of two writes a steward made in order, and tells the console it already has something newer. Row 0
// below measures that on the relay's own store so the rows after it are measuring something real.
//
// THE POINT OF USE IS NOT A SCREEN. This stage has no pixels; its user is the relay at the other end of the
// wire. So every row here takes the event the SHIPPED console actually mints — the writer's body lifted out
// of vendor/steward.js and run, with the real _monotonic and the real _lastStamp — and puts it into the
// relay's REAL store, scripts/event-store.mjs, through put(). A test that re-implemented newest-wins would
// pass over any drift between the two halves, which is the shape CLAUDE.md warns about.
//
// A NOTE ON WHAT IS STUBBED, so nobody mistakes the scope. The preconditions on each writer
// (_requireTrustedView, _mayClearForCheckin, churchSkHeld) are stubbed permissive: they decide WHETHER a
// steward may write, which is somebody else's test. Nothing that decides the STAMP is stubbed — now(),
// _monotonic and _lastStamp are the shipped ones and the event is really signed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { encrypt as nip44e, getConversationKey as nip44ck } from 'nostr-tools/nip44';
import { openStore } from './event-store.mjs';
import * as ROLE from './checkin-role-source.mjs';
import { fnBody, stmt, stripComments } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const SHIP = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
// THE SHIPPED LANDING REPORT (_landed, 2026-10-02): every guarded list write now returns through it, so a lifted
// setter needs it in scope. Lifted, not re-typed.
const _landedSrc = fnBody(SHIP, 'function _landed(what, p) {', '_landed in the shipped bundle');
const _landedShipped = new Function('return ' + _landedSrc)();

const CHURCH_SK = generateSecretKey();
const CHURCH_PUB = getPublicKey(CHURCH_SK);
const SOMEBODY = getPublicKey(generateSecretKey());
const SOMEBODY2 = getPublicKey(generateSecretKey());

// ── THE SHIPPED WRITERS, lifted and run ──────────────────────────────────────────────────────────────────
// The eight the scope document names: the church's four authority lists and the four check-in writers. Each
// one is the body out of the bundle, so deleting the _monotonic call from any of them fails its row here.
const WRITERS = [
  ['setMinors(pubkeys) {', 'setMinors', 'the church’s list of children'],
  ['setApproved(pubkeys, opts) {', 'setApproved', 'the cleared-to-work-with-children list'],
  ['setGuardians(links, closed) {', 'setGuardians', 'the parent↔child map'],
  ['setStewards(pubkeys, caps, names) {', 'setStewards', 'the steward roster'],
  ['async grantCheckinPermission(opts) {', 'grantCheckinPermission', 'a children’s-desk clearance'],
  ['revokeCheckinPermission(person) {', 'revokeCheckinPermission', 'withdrawing a children’s-desk clearance'],
  ['async publishCheckinHelpers(opts) {', 'publishCheckinHelpers', 'who may hold a session key at the desk'],
  ['revokeCheckinHelpers(session) {', 'revokeCheckinHelpers', 'withdrawing a session envelope'],
];

function consoleWriters(fixedSec) {
  const sent = [];
  const scope = {
    // ── THE THING UNDER TEST, both shipped ──
    _lastStamp: new Map(),
    // ── the console's clock, frozen, so every write in a row is genuinely in the same second ──
    now: () => fixedSec,
    // ── identity and the wire ──
    sk: CHURCH_SK, pub: CHURCH_PUB, actingChurch: '',
    finalizeEvent: finalizeEvent, finalizeEvent2: finalizeEvent,
    _publishToRelays: (evt) => { sent.push(evt); return Promise.resolve(evt); },
    publish: (evt) => { sent.push(evt); return Promise.resolve(evt); },
    // ── preconditions: WHO MAY WRITE is a different question and a different test ──
    _requireTrustedView: () => {}, _landed: _landedShipped,
    _mayClearForCheckin: () => true,
    churchSkHeld: () => true,
    _capAllows: () => () => true,
    CAP_KEYS: { checkin: { cap: 'checkin' } },
    _warnUnsealed: () => {},
    // ── the console's own remembered state, at its documented empty value ──
    _clearedTrail: { cp: '', map: {}, list: [], loaded: false },
    _stewardCaps: {}, _stewardNames: {}, _stewardNamesCt: '', _stewardSince: {},
    _sealChurchDoc: () => null,
    // ── the REAL check-in role module, the same one the bundle inlines ──
    permissionPolicy: ROLE.permissionPolicy, permissionWindow: ROLE.permissionWindow,
    buildCheckinPermission: ROLE.buildCheckinPermission, helperPolicy: ROLE.helperPolicy,
    lifetimeWindow: ROLE.lifetimeWindow, permittedHelpers: ROLE.permittedHelpers,
    buildHelperGrant: ROLE.buildHelperGrant, GRANT_SOURCE: ROLE.GRANT_SOURCE,
    // ── stage 4's bounded wait. The REAL ensureSkew/_skewGate/_skewShift are lifted below; only the dial
    //    itself is stubbed, because there is no relay in this harness. Nothing measures, so _skewShift
    //    returns 0 and every stamp below is the local clock — which is what the first assertion in each
    //    row then proves, rather than assuming.
    measureRelaySkew: async () => 0,
    setTimeout,
    // ── real crypto; the envelope is really sealed ──
    crypto: globalThis.crypto, encrypt3: nip44e, getConversationKey: nip44ck,
    _hex: (u) => Array.from(u).map(b => b.toString(16).padStart(2, '0')).join(''),
    JSON, Math, Number, String, Object, Array, Set, Date, RegExp, Promise, Error,
  };
  const prelude = [
    // the measurement state, at its "nothing has ever answered" value, plus the real selection rules
    stmt(SHIP, 'var _CLOCK_SKEW = ', '_CLOCK_SKEW'),
    stmt(SHIP, 'var SKEW_CAP_SEC = ', 'SKEW_CAP_SEC'),
    stmt(SHIP, 'var STAMP_CAP_SEC = ', 'STAMP_CAP_SEC'),
    stmt(SHIP, 'var SKEW_WAIT_MS = ', 'SKEW_WAIT_MS'),
    stmt(SHIP, 'var _relaySkewSec = 0', '_relaySkewSec'),
    stmt(SHIP, 'var _skewMeasuredAt = 0', '_skewMeasuredAt'),
    stmt(SHIP, 'var _skewProven = false', '_skewProven'),
    stmt(SHIP, 'var _skewSpreadSec = 0', '_skewSpreadSec'),
    stmt(SHIP, 'var _skewWaited = false', '_skewWaited'),
    fnBody(SHIP, 'function _skewShift', '_skewShift'),
    fnBody(SHIP, 'function ensureSkew', 'ensureSkew'),
    fnBody(SHIP, 'function _skewGate', '_skewGate'),
    fnBody(SHIP, 'function _monotonic(tmpl)', '_monotonic'),
    stmt(SHIP, 'var NET = ', 'NET'),
    stmt(SHIP, 'var MINORS_D = ', 'MINORS_D'),
    stmt(SHIP, 'var APPROVED_D = ', 'APPROVED_D'),
    stmt(SHIP, 'var GUARDIANS_D = ', 'GUARDIANS_D'),
    stmt(SHIP, 'var STEWARDS_D = ', 'STEWARDS_D'),
    stmt(SHIP, 'var CHECKINPERM_D = ', 'CHECKINPERM_D'),
    stmt(SHIP, 'var CHECKINHELPER_D = ', 'CHECKINHELPER_D'),
  ].join('\n');
  const methods = WRITERS.map(([anchor, name]) => fnBody(SHIP, anchor, name)).join(',\n');
  const api = new Function('scope', 'with (scope) {\n' + prelude + '\nconst _api = {\n' + methods + '\n};\nreturn _api; }')(scope);
  return { api, sent, scope };
}

// ── A REAL RELAY STORE. put() is the relay's own choke point for newest-wins ──────────────────────────────
function store() {
  const s = openStore(':memory:');
  return s;
}
const heldFor = (s, d) => s.query({ kinds: [30078], '#d': [d] });
const dOf = (e) => (e.tags.find(t => t[0] === 'd') || [])[1];

// ══ ROW 0 · THE BASELINE. Without a bump, a same-second pair is decided by event id, not by order ═════════
test('0 · BASELINE: two same-second writes of one document — the relay keeps ONE, chosen by id', () => {
  const s = store();
  const at = Math.floor(Date.now() / 1000);
  const d = 'trinityone/minors:' + CHURCH_PUB;
  // Mint pairs until the SECOND event's id sorts ABOVE the first's. put()'s NIP-01 tie-break keeps the
  // LOWEST id on a tie, so this is the half of the coin where the steward's later, correct write loses.
  let first = null, second = null;
  for (let i = 0; i < 400 && !second; i++) {
    const a = finalizeEvent({ kind: 30078, created_at: at, tags: [['d', d], ['t', 'trinityone']], content: JSON.stringify({ pubkeys: [] }) }, CHURCH_SK);
    const b = finalizeEvent({ kind: 30078, created_at: at, tags: [['d', d], ['t', 'trinityone']], content: JSON.stringify({ pubkeys: [SOMEBODY], n: i }) }, CHURCH_SK);
    if (String(a.id) < String(b.id)) { first = a; second = b; }
  }
  assert.ok(second, 'could not mint a losing pair in 400 tries — the id tie-break has changed shape');
  assert.equal(s.put(first, CHURCH_PUB), 'stored');
  assert.equal(s.put(second, CHURCH_PUB), 'have-newer',
    'THE BASELINE IS GONE. put() in scripts/event-store.mjs no longer refuses the loser of a same-second ' +
    'tie, so every row below this one is measuring nothing. Re-write this file rather than deleting the row.');
  const held = heldFor(s, d);
  assert.equal(held.length, 1);
  assert.deepEqual(JSON.parse(held[0].content).pubkeys, [],
    'the relay kept the SECOND write after all — the tie-break no longer favours the lowest id');
  s.close();
});

// ══ ROWS 1–8 · ONE PER SAFEGUARDING WRITER ════════════════════════════════════════════════════════════════
// Each row calls the shipped writer TWICE inside one frozen second and puts both events into the real store.
// Deleting _monotonic from that one writer fails that one row and no other.
const CALLS = {
  setMinors: [[[SOMEBODY]], [[SOMEBODY, SOMEBODY2]]],
  setApproved: [[[SOMEBODY]], [[SOMEBODY, SOMEBODY2]]],
  setGuardians: [[{ [SOMEBODY]: [SOMEBODY2] }], [{ [SOMEBODY]: [SOMEBODY2, CHURCH_PUB] }]],
  setStewards: [[[SOMEBODY]], [[SOMEBODY, SOMEBODY2]]],
  grantCheckinPermission: [
    [{ person: SOMEBODY, lifetime: 'day', date: '2026-10-04' }],
    [{ person: SOMEBODY, lifetime: 'day', date: '2026-10-11' }],
  ],
  revokeCheckinPermission: [[SOMEBODY], [SOMEBODY]],
  publishCheckinHelpers: [
    [{ session: 'svc-1', lifetime: 'session', service: { date: '2026-10-04', time: '10:30' }, permissions: [], stewards: [] }],
    [{ session: 'svc-1', lifetime: 'session', service: { date: '2026-10-04', time: '10:30' }, permissions: [], stewards: [SOMEBODY2] }],
  ],
  revokeCheckinHelpers: [['svc-1'], ['svc-1']],
};

for (const [, name, what] of WRITERS) {
  test(name + ' · two writes in one second both land, in order (' + what + ')', async () => {
    const at = Math.floor(Date.now() / 1000);
    const { api, sent } = consoleWriters(at);
    const [argsA, argsB] = CALLS[name];

    await api[name](...argsA);
    await api[name](...argsB);
    assert.equal(sent.length, 2,
      name + ' did not publish twice — the writer refused before it reached a stamp, so this row measures ' +
      'nothing. Check the preconditions stubbed in consoleWriters().');

    const [e1, e2] = sent;
    assert.equal(dOf(e1), dOf(e2), 're-anchor: the two calls wrote DIFFERENT documents, so they never raced');
    assert.equal(e1.created_at, at,
      'the first write was not stamped from the console\'s own clock. Nothing in this harness has measured ' +
      'anything, and an unmeasured console must correct by NOTHING — the shipped _skewShift is lifted here, ' +
      'not stubbed, so this row is the offline case and it must stay byte-identical to the local clock.');
    assert.ok(e2.created_at > e1.created_at,
      'THE SECOND WRITE TIED WITH THE FIRST. ' + name + ' no longer goes through _monotonic, so a steward ' +
      'who acts twice in one second has one of the two silently discarded by the relay — which half is ' +
      'decided by the event id. This is the same-second half of the incident on publishClearance: the ' +
      'relay answers "a newer version of this is already stored", the run reports failed:0, no banner is ' +
      'raised and nothing retries.');

    // …and now the relay's own store, which is the point of use.
    const s = store();
    assert.equal(s.put(e1, CHURCH_PUB), 'stored', 're-anchor: the relay refused the FIRST write');
    assert.equal(s.put(e2, CHURCH_PUB), 'stored',
      'the relay answered have-newer to the steward\'s SECOND action on ' + what + '. ' + name + ' is not ' +
      'ordering its writes.');
    const held = heldFor(s, dOf(e2));
    assert.equal(held.length, 1, 'the relay kept two copies of one addressable document');
    assert.equal(held[0].id, e2.id,
      'the relay kept the FIRST write. The steward\'s later action on ' + what + ' is on no relay and the ' +
      'console was told nothing.');
    s.close();
  });
}

// ══ ROW 9 · THE RULE 2 GUARD: no publisher may be added back onto a bare stamp ════════════════════════════
test('every event this console signs is stamped by _monotonic — except the eight named credentials', () => {
  // Measured on the shipped bundle with comments stripped: a comment naming finalizeEvent must not count,
  // and this file's own subject guarantees future comments will name it.
  const bare = stripComments(SHIP);
  // …and not the DECLARATIONS nostr-tools contributes to the bundle — it ships two copies of a class whose
  // method is spelled `finalizeEvent(t, secretKey) {`, and counting either reports the signer itself as an
  // unstamped publisher. A declaration is the first thing on its line; every call site in this console is
  // preceded by a `return`, an `await`, an `=` or an opening bracket.
  const all = [...bare.matchAll(/finalizeEvent\d*\(/g)]
    .filter(m => !/(^|\n)[ \t]*$/.test(bare.slice(Math.max(0, m.index - 200), m.index)));
  assert.ok(all.length >= 30, 're-anchor: only ' + all.length + ' signing sites found; the bundler has ' +
    'renamed or inlined finalizeEvent and this row is no longer reading the console');
  const bare2 = bare;
  const unstamped = [];
  for (const m of all) {
    const tail = bare2.slice(m.index + m[0].length, m.index + m[0].length + 60).replace(/\s+/g, ' ');
    if (tail.startsWith('_monotonic(')) continue;
    unstamped.push(tail.slice(0, 44));
  }
  // The eight that are deliberately NOT ordered: the NIP-42 AUTH event (it is not stored and is stage 5),
  // and the seven short-lived kind-27235 / kind-24242 credentials stage 2 put on _credNow(). Every one of
  // them is thrown away by the relay after a freshness check; none is a document and none is ordered.
  for (const t of unstamped) {
    assert.ok(/^authEvent\b/.test(t) || /^\{ kind: 2(7235|4242),/.test(t),
      'A NEW PUBLISHER SIGNS A DOCUMENT WITHOUT _monotonic: ' + t + '\nEvery document this console writes ' +
      'is ordered by created_at and the relay refuses the loser of a tie without saying so. If this is a ' +
      'short-lived credential, it belongs on _credNow() and in the list this row keeps; if it is a ' +
      'document, wrap the template in _monotonic().');
  }
  assert.equal(unstamped.length, 8,
    'the console now signs ' + unstamped.length + ' things outside _monotonic, not eight. The eight are ' +
    'the NIP-42 AUTH event and the seven stage-2 credentials (_nip98, _putBlob, uploadBlob, removeSermon’s ' +
    'blob-delete arm, registerPush, registerAtRelay, and the /config dialler in the registration fan-out).');
});

// ══ ROW 10 · _senvTs must hold the stamp WE WROTE, not a second reading of the clock ══════════════════════
test('publishGroupKey records the envelope stamp it actually signed', () => {
  // _monotonic can hand back `last + 1` rather than the reading the call site took, so setting _senvTs from
  // a separate now() left the two disagreeing. stewIngestKey DROPS an envelope whose created_at is below
  // _senvTs, so the console could discard its own envelope coming back off the relay as stale.
  const body = stripComments(fnBody(SHIP, 'async publishGroupKey(', 'publishGroupKey'));
  const m = /_senvTs\[groupId\] = ([^;]+);/.exec(body);
  assert.ok(m, 're-anchor: publishGroupKey no longer records an envelope high-water mark at all');
  assert.ok(!/\bnow\(\)/.test(m[1]),
    '_senvTs is set from a second reading of the clock (' + m[1].trim() + '), not from the envelope that ' +
    'was signed. Take it off the event feChurch returned.');
  assert.match(m[1], /created_at/,
    '_senvTs is no longer set from an event\'s created_at: ' + m[1].trim());
});
