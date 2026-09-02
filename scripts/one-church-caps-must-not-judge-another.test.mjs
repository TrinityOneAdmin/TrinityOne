// A CHURCH'S CAPABILITY MAP MUST NOT FOLLOW YOU INTO ANOTHER CHURCH.
// Run: node --test scripts/one-church-caps-must-not-judge-another.test.mjs
//
// AUDIT 2026-08-30, confirmed against the shipped bundle. `_stewardCaps` is the other half of the steward
// roster — { "<steward pubkey>": ["finance", …] } — and it was assigned in exactly three places, all inside
// subscribeStewards.onevent, and reset in NONE. `_resetChurchScopedState()` (the restore path) and
// setActiveIdentity() (the switch a steward uses to move between the churches they help run) both clear
// `_careRoster`, `_careRosterKnown`, `_careRosterSeen`, `_nameKeyRing` and `_localBlocked` — and left this
// behind.
//
// The consequence, measured: an owner who scopes a delegate to nothing in church A, then works in church B,
// loses from their own console every group, rota, service, run sheet, room, booking, event and team roster
// that delegate authored IN B. Each of those readers writes its filtered list back to localStorage
// (subscribeGroups / Plans / Devos / Items all `localStorage.setItem(CACHE_KEY, …)` from the filtered map),
// so it survives into the next cold start — while the relay goes on serving every one of those documents to
// every phone in the congregation. A console that shows LESS than the members' apps, permanently, with no
// error anywhere.
//
// Two more defects in the same predicate, both fixed here:
//
//   · `if (!_careRosterSeen && !_careRoster.size) return true;` — the escape hatch for "we never actually
//     read a roster document". It assumes a non-empty roster implies a document was read. It does not:
//     setCareRoster() (the React round-trip from app/stew-dashboard.jsx:439) writes `_careRoster` and touches
//     neither flag, and the console's subscription hooks paint from a per-church localStorage cache before
//     any relay answers. So `size > 0` with `seen === false` is reachable, and the hatch did not fire.
//
//   · `caps.length > 0` is NOT the relay's `'any'`. gateway.mjs:1611 builds its capability set as
//     `new Set(v.filter(x => typeof x === 'string' && x).map(x => x.toLowerCase()))` — junk dropped, case
//     folded — and then asks `caps.size > 0`. The console counted the RAW length, so [''], [null] and [{}]
//     read as "one capability" in the console and as NOTHING at the relay. This console's own setStewards()
//     could publish [''].
//
// Everything below EXECUTES shipped code: the console predicates are lifted out of vendor/steward.js, the
// relay's rule out of scripts/gateway.mjs, and the two reset statements out of the bundle's own reset paths —
// so removing a reset stops it resetting here too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stmt, stripComments } from './test-slice.mjs';

const V = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const GATEWAY = readFileSync(new URL('../scripts/gateway.mjs', import.meta.url), 'utf8');

const DISPLAY = fnBody(V, 'function _consoleDisplay(rec)');
const VOICE = fnBody(V, 'function _consoleChurchVoice(rec)');
const CAPSOF = fnBody(V, 'function _capsOf(by)');
// What THIS console may do when it is a delegated steward. It gates which tabs the console renders
// (app/stew-dashboard.jsx:7 and :58) and it reads `_stewardCaps` with no roster-freshness guard at all, so it
// is where a carried-over capability map bites hardest.
const MYCAPS = fnBody(V, 'myStewardCaps() {');

// ── the two reset paths, lifted so they cannot drift from the thing under test ────────────────────────────
// Pull the per-church clears for the roster document's three halves OUT of each reset path and make them
// runnable. A clear that is deleted from the bundle is simply absent from the string we run, and the
// behavioural assertions below then fail — which is the point of lifting rather than restating.
function clears(body, what) {
  const out = [];
  for (const n of ['_stewardCaps', '_stewardNames', '_stewardSince']) {
    const m = stripComments(body).match(new RegExp('\\b' + n + '\\s*=\\s*\\{\\s*\\}\\s*;'));
    if (m) out.push(m[0]);
  }
  assert.ok(/_careRoster\s*=\s*new Set\(\)/.test(stripComments(body)),
    what + ' no longer clears the steward roster at all — re-anchor this test, do not delete it');
  return out.join(' ');
}
const RESET_RESTORE = clears(fnBody(V, 'function _resetChurchScopedState()'), '_resetChurchScopedState');
const RESET_SWITCH = clears(fnBody(V, 'setActiveIdentity(targetPub) {'), 'setActiveIdentity');

// ── the console, made runnable ────────────────────────────────────────────────────────────────────────────
function console_() {
  return new Function(`
    let pub = 'CHURCHKEY';                 // in delegated mode this is the CHURCH's key…
    let churchPub = 'MYOWNKEY';            // …and this is the console's own. The naming is historical.
    let actingChurch = '';
    let _careRoster = new Set(), _careRosterKnown = false, _careRosterSeen = false;
    let _stewardCaps = {}, _stewardNames = {}, _stewardSince = {};
    ${CAPSOF}
    ${DISPLAY}
    ${VOICE}
    const api = { ${MYCAPS} };
    return {
      load(o) {
        if (o.pub !== undefined) pub = o.pub;
        if (o.me !== undefined) churchPub = o.me;
        if (o.delegated !== undefined) actingChurch = o.delegated ? pub : '';
        if (o.roster !== undefined) { _careRoster = new Set(o.roster); }
        if (o.known !== undefined) _careRosterKnown = o.known;
        if (o.seen !== undefined) _careRosterSeen = o.seen;
        if (o.caps !== undefined) _stewardCaps = o.caps;
        if (o.names !== undefined) _stewardNames = o.names;
        if (o.since !== undefined) _stewardSince = o.since;
      },
      // exactly what subscribeStewards.onevent does when a roster DOCUMENT arrives
      rosterDocument(pubkeys, caps, names, since) {
        _stewardCaps = caps || {}; _stewardNames = names || {}; _stewardSince = since || {};
        _careRoster = new Set(pubkeys); _careRosterKnown = true; _careRosterSeen = true;
      },
      // the React round-trip: writes the roster, touches NEITHER flag (setCareRoster, steward.src.js)
      fromCache(pubkeys) { _careRoster = new Set(pubkeys); },
      // an authenticated EOSE with no roster document on it (subscribeStewards.oneose)
      emptyEose() { _careRosterKnown = true; },
      restoreKey() { ${RESET_RESTORE} },
      switchChurch() { ${RESET_SWITCH} },
      shows: (by) => _consoleDisplay({ _by: by, id: 'doc1' }),
      myCaps: () => api.myStewardCaps(),
      mayWithdraw: (by) => _consoleChurchVoice({ _by: by, id: 'doc1' }),
      caps: () => _stewardCaps, names: () => _stewardNames, since: () => _stewardSince,
    };
  `)();
}

// ── the relay's own reading of the same field, lifted from scripts/gateway.mjs ─────────────────────────────
// Not a transcription. The ingest lines that BUILD the capability set and the `stewardCan` that reads it are
// both cut out of the relay source and run, so "the console agrees with the relay" is measured, not asserted.
const INGEST = (() => {
  const at = GATEWAY.indexOf('const c = doc.caps && typeof doc.caps === ');
  assert.notEqual(at, -1, 'the relay no longer builds its capability map here — re-anchor this test');
  const forAt = GATEWAY.indexOf('if (c) for', at);
  assert.notEqual(forAt, -1, 'the relay capability loop moved — re-anchor this test');
  let d = 0, end = -1;
  for (let i = GATEWAY.indexOf('{', forAt); i < GATEWAY.length; i++) {
    if (GATEWAY[i] === '{') d++;
    else if (GATEWAY[i] === '}' && --d === 0) { end = i; break; }
  }
  assert.notEqual(end, -1, 'could not read the end of the relay capability loop');
  return GATEWAY.slice(at, end + 1);
})();
const STEWARD_CAN = stmt(GATEWAY, 'const stewardCan = (pub, cp, cap) => {', 'gateway stewardCan');

function relay() {
  return new Function(`
    const STEWARDS_BY = new Map(), STEWARD_CAPS = new Map();
    const toHexPub = (x) => x;              // the fixture uses bare hex, so this is identity
    ${STEWARD_CAN}
    return {
      roster(cp, pubkeys, capsDoc) {
        STEWARDS_BY.set(cp, new Set(pubkeys));
        const caps = new Map();
        const doc = { caps: capsDoc };
        ${INGEST}
        STEWARD_CAPS.set(cp, caps);
      },
      // gateway.mjs:2341 — the RETRACTION gate, which decides what is still SERVED to every phone
      serves: (by, cp) => (by === cp || stewardCan(by, cp, 'any')),
      mayWrite: (by, cp) => stewardCan(by, cp, 'content'),
    };
  `)();
}

const CHURCH_A = 'a'.repeat(64), CHURCH_B = 'b'.repeat(64);
const DELEGATE = 'd'.repeat(64), OTHER = 'e'.repeat(64);

test('CONTROL: the console hides a document by a steward the church has scoped to nothing', () => {
  // If this fails, every assertion below is meaningless: the filter is not running at all.
  const c = console_();
  c.load({ pub: CHURCH_A });
  c.rosterDocument([DELEGATE, OTHER], { [DELEGATE]: [], [OTHER]: ['finance'] });
  assert.equal(c.shows(DELEGATE), false, 'the capability filter is not running at all');
  assert.equal(c.shows(OTHER), true, 'a scoped steward’s documents are hidden for the wrong reason');
  assert.equal(c.shows(CHURCH_A), true, 'the church’s own documents are hidden from the church');
});

test('THE LEAK: church A’s capabilities must not decide what this console may do in church B', () => {
  // THE WINDOW THAT MATTERS is between arriving in church B and B's roster document landing. Every one of
  // these reads answers from `_stewardCaps` with no freshness guard of its own, and until this commit the
  // answer was church A's.
  for (const [what, move] of [['restoring a key', 'restoreKey'], ['switching church', 'switchChurch']]) {
    const c = console_();
    // Church A, where this console is a delegated steward the owner has scoped to Finance alone, and where
    // a colleague has been scoped to nothing.
    c.load({ pub: CHURCH_A, me: DELEGATE, delegated: true });
    c.rosterDocument([DELEGATE, OTHER], { [DELEGATE]: ['finance'], [OTHER]: [] });
    assert.deepEqual(c.myCaps(), ['finance'], 'fixture is wrong: A’s scoping is not in force');
    assert.equal(c.shows(OTHER), false, 'fixture is wrong: A’s scoping of the colleague is not in force');

    c[move]();

    // Church B. The roster subscription has re-opened and has not delivered yet — the ordinary first second
    // in any church, and the whole of it for a church whose roster this relay does not hold.
    c.load({ pub: CHURCH_B, me: DELEGATE, delegated: true });
    assert.equal(c.myCaps(), null,
      `after ${what}, this console was still restricted by church A's capability map: a steward whom church ` +
      'B has granted everything is shown only the tabs church A left them, with nothing on screen saying why');

    // …and the same map decided who may withdraw church B's own copy of a document.
    c.fromCache([OTHER]);        // the roster hooks paint from their per-church localStorage cache
    c.emptyEose();
    assert.equal(c.mayWithdraw(OTHER), true,
      `after ${what}, church A's capability map decided whether a church B steward may withdraw church B's ` +
      'copy of a document');
    assert.equal(c.shows(OTHER), true,
      `after ${what}, a church B document was hidden from the owner's own console on church A's scoping`);
  }
});

test('…and the owner’s labels and join dates go with it, or B’s roster is republished with A’s', () => {
  // setStewards() carries _stewardNames / _stewardSince forward on every edit, so adding ONE steward in
  // church B would have published church A's labels and join dates into church B's signed roster.
  for (const move of ['restoreKey', 'switchChurch']) {
    const c = console_();
    c.rosterDocument([DELEGATE], { [DELEGATE]: [] }, { [DELEGATE]: 'Tom (A)' }, { [DELEGATE]: 111 });
    c[move]();
    assert.deepEqual(c.names(), {}, `${move}: church A’s label for a steward survived into church B`);
    assert.deepEqual(c.since(), {}, `${move}: church A’s join dates survived into church B`);
    assert.deepEqual(c.caps(), {}, `${move}: church A’s capability map survived into church B`);
  }
});

test('a roster nobody read this session enforces NOTHING, however it got there', () => {
  // The reachable pair the old predicate could not see: `_careRoster` non-empty (painted from the console's
  // own localStorage cache, via the hook's initial value → setCareRoster) while `_careRosterSeen` is false,
  // because the only thing the relay delivered was an authenticated EOSE with no roster document on it.
  const c = console_();
  c.load({ pub: CHURCH_A });
  c.fromCache([OTHER]);       // app/stew-dashboard.jsx:439, from _subCache — NOT a document
  c.emptyEose();              // subscribeStewards.oneose on an authenticated relay that served nothing
  assert.equal(c.shows(DELEGATE), true,
    'a document was hidden on the strength of a roster this session never read — the "not seen" escape ' +
    'hatch is written as "not seen AND empty", and a cached roster is not empty');
  assert.equal(c.shows(OTHER), true);
});

test('…but a roster that WAS read still enforces, empty or not', () => {
  // The known gap this predicate deliberately keeps: a church that revokes its last steward publishes a
  // real, EMPTY roster, and the console must stop showing that ex-steward's documents — the members already
  // have. A fix that simply returned true whenever the roster is empty would reintroduce that.
  const c = console_();
  c.load({ pub: CHURCH_A });
  c.rosterDocument([], {});
  assert.equal(c.shows(DELEGATE), false,
    'the church revoked its last steward and the console goes on showing their documents, which every ' +
    'member’s phone has already lost');
});

test('the console and the relay agree on what a capability list MEANS', () => {
  // ['']: publishable by this console's own setStewards. [null] / [{}] / ['  ']: anything a hand-edited or
  // future roster can carry. Each one used to be "a capability" here and NOTHING at the relay.
  const cases = [
    ['an empty string', ['']],
    ['a null', [null]],
    ['an object', [{}]],
    ['a number', [0]],
    ['an empty list', []],
    ['a real capability', ['finance']],
    ['a capability with junk beside it', ['', 'finance']],
    ['every entry junk', ['', null, 3]],
  ];
  for (const [what, caps] of cases) {
    const c = console_();
    c.load({ pub: CHURCH_A });
    c.rosterDocument([DELEGATE], { [DELEGATE]: caps });
    const r = relay();
    r.roster(CHURCH_A, [DELEGATE], { [DELEGATE]: caps });
    assert.equal(c.shows(DELEGATE), r.serves(DELEGATE, CHURCH_A),
      `caps = ${what}: the console shows ${c.shows(DELEGATE)}, the relay serves ${r.serves(DELEGATE, CHURCH_A)}. ` +
      'The console is painting documents the relay has stopped serving to every phone, or hiding ones it serves.');
  }
});

test('…and on who may withdraw the church’s own copy, case included', () => {
  // The relay lower-cases at ingest; _consoleChurchVoice used a case-sensitive includes('content'). A roster
  // carrying 'Content' therefore let the steward withdraw the church's copy at the relay while the console
  // refused to let them try.
  for (const caps of [['content'], ['Content'], ['CONTENT'], ['finance'], [''], []]) {
    const c = console_();
    c.load({ pub: CHURCH_A });
    c.rosterDocument([DELEGATE], { [DELEGATE]: caps });
    const r = relay();
    r.roster(CHURCH_A, [DELEGATE], { [DELEGATE]: caps });
    assert.equal(c.mayWithdraw(DELEGATE), r.mayWrite(DELEGATE, CHURCH_A),
      `caps = ${JSON.stringify(caps)}: the console and the relay disagree about who may withdraw the ` +
      'church’s copy of a document');
  }
});

test('an unscoped steward is unrestricted in both, which is every pre-capability roster', () => {
  const c = console_();
  c.load({ pub: CHURCH_A });
  c.rosterDocument([DELEGATE], {});
  const r = relay();
  r.roster(CHURCH_A, [DELEGATE], undefined);
  assert.equal(c.shows(DELEGATE), true);
  assert.equal(r.serves(DELEGATE, CHURCH_A), true);
  assert.equal(c.mayWithdraw(DELEGATE), true);
  assert.equal(r.mayWrite(DELEGATE, CHURCH_A), true);
});

// ── and the document this console PUBLISHES says the same thing ───────────────────────────────────────────
test('setStewards never writes a capability the relay will silently drop', () => {
  // `filter(c => typeof c === 'string')` kept '', so this console could publish caps: { <pk>: [''] } — one
  // capability by its own reading, nothing at all by the relay's. Run the shipped carry-forward.
  const body = fnBody(V, 'setStewards(pubkeys, caps, names) {');
  const m = stripComments(body).match(/for \(const p of list\) if \(src\[p\][^\n]*next\[p\] = [^\n]*;/);
  assert.ok(m, 're-anchor: setStewards no longer carries capabilities forward');
  const carry = new Function('list', 'src', 'const next = {};\n' + m[0] + '\nreturn next;');
  const out = carry([DELEGATE], { [DELEGATE]: ['', 'Finance', null, 'content'] });
  const r = relay();
  r.roster(CHURCH_A, [DELEGATE], out);
  assert.deepEqual(out[DELEGATE], ['finance', 'content'],
    'the console publishes capability entries the relay drops on the floor, so the signed roster means one ' +
    'thing to the console and another to every phone');
  assert.equal(r.mayWrite(DELEGATE, CHURCH_A), true, 'a real capability was lost in the normalisation');
  assert.deepEqual(carry([DELEGATE], { [DELEGATE]: [] })[DELEGATE], [],
    'an owner who means "nothing" must still be able to say it');
});
