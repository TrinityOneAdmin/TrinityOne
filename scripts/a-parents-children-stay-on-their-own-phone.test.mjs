// A PARENT'S CHILDREN'S NAMES NEVER LEAVE THEIR OWN PHONE — AND A FORGED QR CANNOT BLANK THE APP.
// Run: node --test scripts/a-parents-children-stay-on-their-own-phone.test.mjs
//
// §3b of reference/PLAN-CHECKIN-NO-TYPING-2026-09-11.md, the ACCEPTED design. The whole safety argument of
// that design rests on two facts about the ENGINE, and this file is where both are measured:
//
//   1. the names are local — no document, no prefix, no seal, no relay gate. Asserted ON THE TRANSPORT:
//      the shipped setters are run in a scope where every publishing path is a proxy that THROWS.
//   2. the QR payload is UNAUTHENTICATED and read hostilely — default-deny, never throwing, carrying no
//      parent name, and structurally unable to hand React an object (which blanks the whole app).
//
// The SCREENS are scripts/a-parent-shows-a-code-instead-of-typing.test.mjs (the parent's) and
// scripts/a-worker-scans-instead-of-typing.test.mjs (the worker's). An engine nobody is required to consult
// is not a feature — CLAUDE.md rule 1 — so all three exist.
//
// ⚠ THE BUNDLE, NOT THE SOURCE (CLAUDE.md rule 3). Everything below is lifted out of vendor/fellowship.js,
// which esbuild builds from src/fellowship.src.js with dead code removed. `npm run build:fellowship`.
//
// NO RELAY AND NO PORT.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { fnBody } from './test-slice.mjs';
import { lifetimeWindow, DEFAULT_HELPER_LIFETIME } from './checkin-role-source.mjs';
import { D } from './trinity-doc-types.mjs';

const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const NET = 'trinityone';

const keypair = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const CHURCH = 'c'.repeat(64);
const OTHER_CHURCH = 'd'.repeat(64);
const SARAH = 'a'.repeat(64);
const TOM = 'b'.repeat(64);

// ── THE SHIPPED ENGINE, LIFTED WHOLE ──────────────────────────────────────────────────────────────────────
// One slice, from the first constant to the end of parseArrivalQR, so the five functions see each other's
// real definitions. _kidNames is shared by the WRITER and the READER on purpose (one normaliser, not two
// that can drift), and slicing them apart would hide exactly that.
const ENGINE_SRC = (() => {
  const start = FELLOWSHIP.indexOf('var BRINGKIDS_KEY =');
  assert.notEqual(start, -1, 'the parent-side engine is not in the bundle — did build:fellowship run? re-anchor, do not delete');
  const end = FELLOWSHIP.indexOf('function parseArrivalQR(text) {', start);
  assert.notEqual(end, -1, 'parseArrivalQR is not in the bundle — re-anchor this test');
  return FELLOWSHIP.slice(start, end) + fnBody(FELLOWSHIP, 'function parseArrivalQR(text) {', 'parseArrivalQR');
})();

// ── AND THE FIVE METHODS THAT SIT ON window.Fellowship ────────────────────────────────────────────────────
const METHODS = ['bringsChildren(churchNpub) {', 'setBringsChildren(churchNpub, on) {',
  'myChildNames(churchNpub) {', 'setMyChildNames(churchNpub, names) {', 'arrivalQR(churchNpub) {'];

// ONE DEVICE. A single localStorage shared across sessions below, because "one phone is not one person" is
// the thing being measured.
function device(seed = {}) {
  const store = { ...seed };
  return {
    store,
    keys: () => Object.keys(store),
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
  };
}

// ── ONE SESSION ON IT, WITH THE TRANSPORT BOOBY-TRAPPED ───────────────────────────────────────────────────
// EVERY NAME A PUBLISH COULD GO THROUGH THROWS. That is the assertion, not a convenience: negative 7 of the
// plan is "the toggle and the children's names are published NOWHERE — assert on the TRANSPORT, not by
// reading a screen". A `with (scope)` Proxy whose `get` throws for anything unlisted means the only way these
// functions could reach a relay is a name that is not here, and then they throw instead of publishing.
//
// The listed publishing names are spelled out rather than omitted so the failure names the crime: reaching
// for _publishAny reports "tried to publish", not "needs a stub for _publishAny".
function engine(dev, { me = SARAH, keyed = true } = {}) {
  const forbidden = (what) => () => { throw new Error('THE PARENT-SIDE ENGINE TRIED TO PUBLISH (' + what + '). ' +
    'These names are local to one phone; anything that reaches a relay is a new document type, a new read ' +
    'gate and a new forgery surface, all of which §3b exists to avoid.'); };
  const scope = {
    localStorage: dev.localStorage,
    _mePub: () => me,
    _mayCache: () => keyed,                 // `!!sk` in the bundle: false on a PIN-locked boot
    toPub: (x) => String(x || ''),          // the app hands npubs; the key uses hex. Identity here, by design.
    lifetimeWindow, DEFAULT_HELPER_LIFETIME,
    window: { dispatchEvent() {}, Fellowship: null },
    Event: function Event(n) { this.type = n; },
    // …and the doors out. Every one of these throws.
    _publishAny: forbidden('_publishAny'), _publish: forbidden('_publish'),
    pool: { publish: forbidden('pool.publish') }, fetch: forbidden('fetch'),
    _outboxAdd: forbidden('_outboxAdd'), _outboxSave: forbidden('_outboxSave'),
    finalizeEvent2: forbidden('finalizeEvent2'), relaysForChurch: forbidden('relaysForChurch'),
    String, Date, Math, JSON, Number, Array, Object, Boolean, RegExp, console,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the shipped parent-side engine needs a stub for ' + String(k)); },
  });
  const api = new Function('scope', 'with (scope) {' + ENGINE_SRC + '\nreturn ({ ' +
    METHODS.map(m => fnBody(FELLOWSHIP, m, m)).join(',\n') +
    ', arrivalSessionNow, parseArrivalQR, buildArrivalQR, _kidNames }); }')(proxy);
  scope.window.Fellowship = api;   // arrivalQR() calls window.Fellowship.myChildNames — the real chain
  return api;
}

// ══════════════════════ 1. NOTHING HERE PUBLISHES ══════════════════════════════════════════════════════════
test('the toggle, the names and the QR reach no relay — measured on the transport, not on a screen', () => {
  const dev = device();
  const F = engine(dev);
  // If any of these reached for a relay, the proxy above throws and this test fails naming the call.
  assert.equal(F.setBringsChildren(CHURCH, true), true);
  assert.deepEqual(F.setMyChildNames(CHURCH, ['Milo', 'Ivy']), ['Milo', 'Ivy']);
  const qr = F.arrivalQR(CHURCH);
  assert.ok(qr, 'the QR was not built');
  // …and it really did the work, so the absence of a publish is not the absence of everything.
  assert.equal(F.bringsChildren(CHURCH), true);
  assert.deepEqual(F.myChildNames(CHURCH), ['Milo', 'Ivy']);
});

test('the ONLY place the names exist is this phone’s own storage, under a key naming church AND member', () => {
  const dev = device();
  engine(dev).setMyChildNames(CHURCH, ['Milo']);
  engine(dev).setBringsChildren(CHURCH, true);
  const keys = dev.keys();
  assert.deepEqual(keys.sort(), ['trinityone.bringkids.' + CHURCH + '|' + SARAH,
                                 'trinityone.mykidnames.' + CHURCH + '|' + SARAH].sort(),
    'the parent-side settings wrote somewhere other than the two local slots: ' + JSON.stringify(keys));
  // AND THE CHURCH HALF IS REAL. A member of two congregations answers this separately in each.
  const other = engine(dev);
  assert.equal(other.bringsChildren(OTHER_CHURCH), false, 'an answer given for one church was returned for another');
  assert.deepEqual(other.myChildNames(OTHER_CHURCH), [], 'one church’s children were returned for another church');
});

// ══════════════════════ 2. ONE PHONE IS NOT ONE PERSON ═════════════════════════════════════════════════════
test('a second account on the same phone does NOT inherit the first member’s children', () => {
  // The SG_ASSUME_KEY lesson (scripts/one-phone-two-members-safeguarding.test.mjs), one document over and
  // with worse consequences: a 12-word restore, a reseat or a passed-on phone must not paint the previous
  // member's children's first names at a children's door.
  const dev = device();
  const sarah = engine(dev, { me: SARAH });
  sarah.setBringsChildren(CHURCH, true);
  sarah.setMyChildNames(CHURCH, ['Milo', 'Ivy']);

  const tom = engine(dev, { me: TOM });                      // same device, different signing key
  assert.equal(tom.bringsChildren(CHURCH), false,
    'THE SECOND MEMBER ON THIS PHONE INHERITED "I BRING CHILDREN". The key must carry the member, not just ' +
    'the church — one phone is not one person.');
  assert.deepEqual(tom.myChildNames(CHURCH), [],
    'THE SECOND MEMBER ON THIS PHONE WAS HANDED THE FIRST MEMBER’S CHILDREN’S NAMES.');
  assert.equal(tom.arrivalQR(CHURCH), '', 'a QR was built for the second member carrying nothing of theirs');
  // …and the first member still has theirs: this is attribution, not a wipe.
  assert.deepEqual(engine(dev, { me: SARAH }).myChildNames(CHURCH), ['Milo', 'Ivy']);
});

test('a phone with no signing key does not WRITE a children’s answer to disk', () => {
  // `_mayCache()` is `!!sk`. A PIN-locked boot keeps PUB_KEY on purpose, so the member is still identifiable
  // while the app is locked — and writing then would put a children's list back on disk moments after the
  // locked-boot wipe removed it. "Wiping while still writing is theatre" (the note at _mayCache).
  const dev = device();
  const locked = engine(dev, { keyed: false });
  locked.setBringsChildren(CHURCH, true);
  locked.setMyChildNames(CHURCH, ['Milo']);
  assert.deepEqual(dev.keys(), [], 'a locked phone wrote a children’s list to disk: ' + JSON.stringify(dev.keys()));
});

// ══════════════════════ 3. THE QR IS A CHANNEL, NOT AN IDENTIFIER ══════════════════════════════════════════
test('the QR carries v, g and c — and NOTHING else, and no key material', () => {
  const dev = device();
  const F = engine(dev);
  F.setMyChildNames(CHURCH, ['Milo', 'Ivy']);
  const o = JSON.parse(F.arrivalQR(CHURCH));
  assert.deepEqual(Object.keys(o).sort(), ['c', 'g', 'v'],
    'the QR payload carries a field beyond { v, g, c }: ' + JSON.stringify(o) + '. Every extra field is ' +
    'something a forger can assert, and the payload is UNAUTHENTICATED.');
  assert.equal(o.v, 1);
  assert.equal(o.g, SARAH, 'the QR does not name its own author’s public key');
  assert.deepEqual(o.c, ['Milo', 'Ivy']);
  // NO SECRET. There is nothing here a photograph could steal that standing at the desk does not already give.
  assert.doesNotMatch(JSON.stringify(o.c), /[0-9a-f]{64}/i, 'something key-shaped is in the children list');
});

test('a QR is refused before it is built when this phone has no key of its own', () => {
  const dev = device();
  const F = engine(dev, { me: '' });
  assert.equal(F.arrivalQR(CHURCH), '', 'a QR was built with no author — the worker could match it to nobody');
  assert.equal(engine(dev, { me: 'npub1notahexkey' }).arrivalQR(CHURCH), '', 'a non-hex author reached the payload');
});

// ══════════════════════ 4. READING ONE BACK IS THE HOSTILE DIRECTION ══════════════════════════════════════
// NEGATIVE 8 of the brief, and the reason it is a negative rather than tidiness: React throws when handed an
// object as a child, and the app root is the ONLY error boundary above the worker's screen. `c: [{}]` in a
// photographed QR would blank the whole app at a children's door.
test('a malformed QR is REFUSED, and refusing never throws', () => {
  const F = engine(device());
  const good = JSON.stringify({ v: 1, g: SARAH, c: ['Milo'] });
  const bad = [
    ['not JSON at all', 'hello there'],
    ['empty string', ''],
    ['a bare number', '42'],
    ['null', 'null'],
    ['an ARRAY, not an object', JSON.stringify([{ v: 1, g: SARAH, c: ['Milo'] }])],
    ['no version', JSON.stringify({ g: SARAH, c: ['Milo'] })],
    ['a FUTURE version we do not understand', JSON.stringify({ v: 2, g: SARAH, c: ['Milo'] })],
    ['version as a string', JSON.stringify({ v: '1', g: SARAH, c: ['Milo'] })],
    ['no g', JSON.stringify({ v: 1, c: ['Milo'] })],
    ['g is an npub, not hex', JSON.stringify({ v: 1, g: 'npub1sarah', c: ['Milo'] })],
    ['g is an object', JSON.stringify({ v: 1, g: { pub: SARAH }, c: ['Milo'] })],
    ['g is short', JSON.stringify({ v: 1, g: 'abc', c: ['Milo'] })],
    ['c missing', JSON.stringify({ v: 1, g: SARAH })],
    ['c is an OBJECT, not an array', JSON.stringify({ v: 1, g: SARAH, c: { 0: 'Milo' } })],
    ['c is a string', JSON.stringify({ v: 1, g: SARAH, c: 'Milo' })],
    ['c is empty', JSON.stringify({ v: 1, g: SARAH, c: [] })],
    ['c holds ONLY objects', JSON.stringify({ v: 1, g: SARAH, c: [{ name: 'Milo' }, { name: 'Ivy' }] })],
    ['c holds only blanks', JSON.stringify({ v: 1, g: SARAH, c: ['   ', '\t', ''] })],
    ['a payload longer than any camera should hand back', JSON.stringify({ v: 1, g: SARAH, c: ['x'.repeat(9000)] })],
  ];
  for (const [what, text] of bad) {
    let out;
    assert.doesNotThrow(() => { out = F.parseArrivalQR(text); },
      'parseArrivalQR THREW on ' + what + '. A throw on the worker’s screen blanks the whole app at a door.');
    assert.equal(out, null, 'a ' + what + ' payload was ACCEPTED: ' + text.slice(0, 120));
  }
  // …and the non-string inputs a caller could hand it.
  for (const v of [null, undefined, 42, {}, [], true]) {
    assert.equal(F.parseArrivalQR(v), null, 'a non-string ' + typeof v + ' was accepted');
  }
  // RE-ANCHOR: a parser that refused EVERYTHING would pass every line above and the feature would be dead.
  assert.deepEqual(F.parseArrivalQR(good), { g: SARAH, c: ['Milo'] });
});

// ── AND THE OTHER HALF OF THE SAME LINE: CHARACTERS THAT ARE NOT THERE ───────────────────────────────────
// Dropping non-strings stops React throwing. This stops the confirmation sentence LYING, which is worse
// because nothing looks wrong: the whole design rests on the worker reading "Milo → Sarah Henderson?" and
// acting on it, and a right-to-left override inside a scanned name reorders that sentence on screen while
// leaving the string a test reads unchanged.
test('a bidi override in a scanned name is stripped, not carried into the confirmation', () => {
  const F = engine(device());
  for (const [what, raw, want] of [
    ['a right-to-left override', '\u202EMilo', 'Milo'],
    ['a left-to-right override', '\u202DMilo', 'Milo'],
    ['an isolate pair', '\u2066Milo\u2069', 'Milo'],
    ['a right-to-left mark', 'Milo\u200F', 'Milo'],
    ['a left-to-right mark', '\u200EMilo', 'Milo'],
  ]) {
    const out = F.parseArrivalQR(JSON.stringify({ v: 1, g: SARAH, c: [raw] }));
    assert.ok(out, what + ' made the whole payload unreadable');
    assert.deepEqual(out.c, [want],
      'A BIDI CONTROL REACHED THE NAME A WORKER CONFIRMS AGAINST (' + what + '): ' + JSON.stringify(out.c) +
      '. It reorders "Milo → Sarah Henderson?" on screen while the string stays the same, which defeats the ' +
      'one mitigation this design rests on and leaves nothing for a test to see.');
  }
});

test('control characters and a zero-width SPACE are stripped, so two identical-looking names are one name', () => {
  const F = engine(device());
  // A zero-width space lets two names that are pixel-identical on screen be different strings in a
  // safeguarding record — which is how a register stops being a register.
  assert.deepEqual(F.parseArrivalQR(JSON.stringify({ v: 1, g: SARAH, c: ['Mi\u200Blo', 'Milo'] })).c, ['Milo'],
    'a zero-width space produced two entries that look identical on a worker’s screen');
  for (const [what, raw] of [['a null', 'a\u0000b'], ['a bell', 'a\u0007b'], ['a DEL', 'a\u007Fb'],
                             ['a C1 control', 'a\u0085b'], ['a soft hyphen', 'a\u00ADb']]) {
    assert.deepEqual(F.parseArrivalQR(JSON.stringify({ v: 1, g: SARAH, c: [raw] })).c, ['ab'],
      what + ' survived into a name a screen will render and a record will store');
  }
  // A name that is ONLY invisible characters is not a name.
  assert.equal(F.parseArrivalQR(JSON.stringify({ v: 1, g: SARAH, c: ['\u202E\u200B\u0000'] })), null,
    'a name made entirely of invisible characters was accepted');
});

test('⚠ THE ZERO-WIDTH JOINERS ARE KEPT, and that is a decision rather than an oversight', () => {
  // U+200C and U+200D are ORDINARY LETTERS' WORK in Persian, Arabic and the Indic scripts — Persian
  // "می‌روم" needs one. This product puts the persecuted church and the developing world first
  // (reference/DOMAIN.md, positioning-not-cushy-american), so corrupting a real child's name to close a
  // homograph trick the worker's own eyes already guard is the wrong trade against the exact audience the
  // rest of this feature exists for.
  const F = engine(device());
  assert.deepEqual(F.parseArrivalQR(JSON.stringify({ v: 1, g: SARAH, c: ['می\u200Cروم'] })).c, ['می\u200Cروم'],
    'a Persian name lost its zero-width non-joiner — the name is now spelled wrongly on a worker’s screen');
  assert.deepEqual(F.parseArrivalQR(JSON.stringify({ v: 1, g: SARAH, c: ['क्\u200Dष'] })).c, ['क्\u200Dष'],
    'an Indic name lost its zero-width joiner');
});

test('the parent’s OWN typing is cleaned by the same rule — one normaliser, not two', () => {
  const dev = device();
  const F = engine(dev);
  assert.deepEqual(F.setMyChildNames(CHURCH, ['\u202EMilo', 'Mi\u200Blo']), ['Milo'],
    'a name typed on the parent’s own screen kept its invisible characters, so the two sides disagree');
});

test('an object smuggled INTO a list of names is dropped, and the real names survive beside it', () => {
  const F = engine(device());
  const out = F.parseArrivalQR(JSON.stringify({ v: 1, g: SARAH, c: [{ toString: 'x' }, 'Milo', 42, null, 'Ivy'] }));
  assert.deepEqual(out.c, ['Milo', 'Ivy'],
    'a non-string entry reached the names a screen will render. React throws on an object child, and the ' +
    'app root is the only boundary above the worker’s screen.');
  for (const n of out.c) assert.equal(typeof n, 'string');
});

test('a QR naming two hundred children becomes twelve — and five hundred is refused outright', () => {
  const F = engine(device());
  const many = (n) => Array.from({ length: n }, (_, i) => 'Child ' + i);
  // TWO CAPS, AND THEY CATCH DIFFERENT THINGS. A 200-name payload fits inside the 4096-character limit, so
  // this row measures the NAME cap; a 500-name payload does not, so the SIZE cap refuses it before a single
  // name is looked at. Both matter — one bounds what a screen paints, the other bounds what is parsed at all.
  assert.equal(F.parseArrivalQR(JSON.stringify({ v: 1, g: SARAH, c: many(200) })).c.length, 12,
    'a hostile QR handed the worker’s screen a list to paint that no family could have');
  assert.equal(F.parseArrivalQR(JSON.stringify({ v: 1, g: SARAH, c: many(500) })), null,
    'a payload far larger than any code a phone draws was parsed instead of refused');
  // The same name cap on the way IN, so a parent cannot store one either.
  assert.equal(engine(device()).setMyChildNames(CHURCH, many(500)).length, 12);
});

test('a member who has ticked the box but typed no names gets no square, rather than an empty one', () => {
  const dev = device();
  const F = engine(dev);
  F.setBringsChildren(CHURCH, true);
  assert.equal(F.arrivalQR(CHURCH), '',
    'a code carrying no children was built. parseArrivalQR refuses an empty `c`, so this is a picture whose ' +
    'only possible outcome at a door is the worker’s phone saying "that isn’t a check-in code".');
});

test('the QR carries NO parent name, and cannot be made to', () => {
  // THE LOAD-BEARING RULE OF THE WHOLE DESIGN. The child's names are unauthenticated — exactly as the
  // worker's typing is today. What makes that safe is that the PARENT is named from the SIGNED ARRIVAL and
  // never from the payload, so a field claiming a parent's name must not survive parsing at all.
  const F = engine(device());
  const hostile = JSON.stringify({ v: 1, g: SARAH, c: ['Milo'],
    n: 'Sarah Henderson', name: 'Sarah Henderson', guardian: TOM, session: 'svc-am', k: 'f'.repeat(64) });
  const out = F.parseArrivalQR(hostile);
  assert.deepEqual(Object.keys(out).sort(), ['c', 'g'],
    'a field beyond g and c survived parsing: ' + JSON.stringify(out) + '. A payload that can assert a ' +
    'PARENT’S NAME can put a stranger on a pairing, which is the one thing this design must not allow.');
  assert.equal(out.g, SARAH, 'the pubkey the worker matches on was taken from somewhere other than `g`');
});

test('what a parent stores is exactly what a worker parses — one normaliser, not two', () => {
  const dev = device();
  const F = engine(dev);
  F.setMyChildNames(CHURCH, ['  Milo   Henderson ', 'Ivy', 'ivy', '', '   ']);
  assert.deepEqual(F.myChildNames(CHURCH), ['Milo Henderson', 'Ivy'],
    'stored names were not normalised: whitespace, blanks and a duplicate reached the list');
  assert.deepEqual(F.parseArrivalQR(F.arrivalQR(CHURCH)).c, F.myChildNames(CHURCH),
    'the round trip changed the names — the worker would paint something the parent could not have typed');
});

// ══════════════════════ 5. WHICH SESSION IS A PARENT ARRIVING AT ═══════════════════════════════════════════
// Computed on the parent's own phone from services they are already served. The plan's whole point: nothing
// new is published to make this work.
const AM = { id: 'svc-am', date: '2026-09-13', time: '09:00', name: 'Morning' };
const LATE = { id: 'svc-late', date: '2026-09-13', time: '11:00', name: 'Late morning' };
const at = (h, m = 0) => Math.floor(new Date(2026, 8, 13, h, m, 0, 0).getTime() / 1000);

test('the button exists only inside the window the RELAY would admit the arrival in', () => {
  const F = engine(device());
  const w = lifetimeWindow(DEFAULT_HELPER_LIFETIME, AM);
  assert.ok(w, 're-anchor: the shared window function returned nothing for an ordinary service');
  assert.equal(F.arrivalSessionNow([AM], w.from - 1), null, 'the button appeared BEFORE the window opens');
  assert.equal((F.arrivalSessionNow([AM], w.from) || {}).session, 'svc-am', 'the button was absent at the first admissible second');
  assert.equal((F.arrivalSessionNow([AM], w.until) || {}).session, 'svc-am', 'the button was absent at the last admissible second');
  assert.equal(F.arrivalSessionNow([AM], w.until + 1), null, 'the button was still there after the window closed');
});

test('two services in one day: the one that has STARTED wins', () => {
  const F = engine(device());
  // At 09:30 only the morning service is in window.
  assert.equal((F.arrivalSessionNow([AM, LATE], at(9, 30)) || {}).session, 'svc-am');
  // At 11:30 BOTH windows contain now (the morning's runs to 12:00). A first-match would send an
  // eleven-o'clock family to the nine-o'clock room.
  assert.equal((F.arrivalSessionNow([AM, LATE], at(11, 30)) || {}).session, 'svc-late',
    'with two services in window the EARLIER one was chosen — an 11 o’clock family would be announced at the 9 o’clock room');
  // …and the order the church happens to publish them in changes nothing.
  assert.equal((F.arrivalSessionNow([LATE, AM], at(11, 30)) || {}).session, 'svc-late');
});

test('a service with nothing to place it produces no button, never a default one', () => {
  const F = engine(device());
  for (const s of [{ id: 'x' }, { id: 'x', date: 'soon', time: '10:30' }, { id: 'x', date: '2026-09-13', time: 'morning' },
                   { date: '2026-09-13', time: '09:00' }, null, 'svc-am']) {
    assert.equal(F.arrivalSessionNow([s], at(9, 30)), null, 'a window was invented for ' + JSON.stringify(s));
  }
  assert.equal(F.arrivalSessionNow([], at(9, 30)), null);
  assert.equal(F.arrivalSessionNow(null, at(9, 30)), null);
  assert.equal(F.arrivalSessionNow('svc-am', at(9, 30)), null);
});

// ══════════════════════ 6. AND THE ARRIVAL ITSELF IS UNCHANGED ═════════════════════════════════════════════
// NEGATIVE 6 of the plan. scripts/a-worker-checks-a-child-in.test.mjs proves the shipped arrival carries no
// child and no key against a LIVE RELAY; this proves the new thing — that a phone which now HOLDS a list of
// children's names still does not put one in the document.
function liftWriteArrival(actor, dev) {
  const captured = [];
  const scope = {
    toPub: (x) => x, sk: actor.sk, pub: actor.pub,
    encrypt: (pt, k) => nip44.encrypt(pt, k),
    getConversationKey: (a, b) => nip44.utils.getConversationKey(a, b),
    finalizeEvent2: (t, sec) => finalizeEvent(t, sec),
    CHECKINARRIVAL_D: D.CHECKINARRIVAL, NET, relaysForChurch: () => [],
    localStorage: dev.localStorage,
    _publishAny: async (_relays, evt) => { captured.push(evt); return true; },
    String, Date, Math, JSON, Number, Array, Object, Boolean, RegExp, console,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the shipped writeArrival needs a stub for ' + String(k)); },
  });
  const api = new Function('scope', 'with (scope) { return ({ ' +
    fnBody(FELLOWSHIP, 'async writeArrival(churchNpub, rec) {', 'writeArrival') + ' }); }')(proxy);
  return { writeArrival: api.writeArrival, captured };
}

test('a phone holding "Milo" and "Ivy" still signs an arrival naming neither', async () => {
  const sarah = keypair();
  const dev = device();
  const F = engine(dev, { me: sarah.pub });
  F.setBringsChildren(CHURCH, true);
  F.setMyChildNames(CHURCH, ['Milo', 'Ivy']);
  const { writeArrival, captured } = liftWriteArrival(sarah, dev);
  const res = await writeArrival(CHURCH, { session: 'svc-am' });
  assert.equal(res.ok, true, 'the shipped writer refused: ' + JSON.stringify(res));
  const evt = captured[0];
  const whole = JSON.stringify(evt);
  for (const n of ['Milo', 'Ivy']) {
    assert.ok(!whole.includes(n),
      'A CHILD’S NAME IS IN THE SIGNED ARRIVAL ("' + n + '"). The names travel optically and only optically; ' +
      'a name in this document is a new disclosure to the relay and to every reader of it.');
  }
  // …and the body still holds nothing but a timestamp, opened by its only possible reader.
  const body = JSON.parse(nip44.decrypt(evt.content, nip44.utils.getConversationKey(sarah.sk, sarah.pub)));
  assert.deepEqual(Object.keys(body), ['at'], 'the arrival body grew a field: ' + JSON.stringify(body));
  assert.equal((evt.tags.find(t => t[0] === 'd') || [])[1], D.CHECKINARRIVAL + 'svc-am:' + sarah.pub);
});
