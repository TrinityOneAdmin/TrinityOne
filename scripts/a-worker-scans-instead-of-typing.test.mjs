// THE POINT OF USE: A CHILDREN'S WORKER SCANS A PARENT'S CODE, ON THE REAL RENDERED SCREEN.
// Run: node --test scripts/a-worker-scans-instead-of-typing.test.mjs
//
// §3b of reference/PLAN-CHECKIN-NO-TYPING-2026-09-11.md. The engine is
// scripts/a-parents-children-stay-on-their-own-phone.test.mjs; an engine nobody is required to consult is not
// a feature (CLAUDE.md rule 1), so this compiles app/screens-serving.jsx with the same esbuild the build
// uses, renders KidsRegister through the miniature React in render-jsx-screen.mjs, drives the scanner, and
// reads the tree that comes back.
//
// ⚠ THE PARSER IS THE SHIPPED ONE, LIFTED OUT OF vendor/fellowship.js. Stubbing it would hand this harness
// the exact decision the tests are named after — the failure recorded as "a stub answers the question", which
// this repo has shipped four times.
//
// ⚠ RULE 3: NOTHING HERE MATCHES TEXT IN app/*.jsx. Those files ship unbundled, so `false && ` in front of a
// condition leaves every word of it in place and a source match still passes. Every claim is about a
// RENDERED tree.
//
// ── THE FOUR NEGATIVES THIS FILE OWNS ─────────────────────────────────────────────────────────────────────
//   1. a QR naming ANOTHER family's children produces NO record — the confirmation names the parent from the
//      SIGNED ARRIVAL, never from the payload, the mismatch is on screen, and nothing is written.
//   2. a QR whose `g` matches no live arrival in this session fills nothing and falls back to typing.
//   3. a QR whose `g` matches an arrival in a DIFFERENT session is refused.
//   4. scanning is NEVER required: no scanner, a cancelled scan, no QR at all — the typed path is untouched
//      and a child still gets into the room.
//
// NO RELAY AND NO PORT.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, texts } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';
import { roomCode } from './checkin-role-source.mjs';

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

// ── THE TREE READERS. The house versions. ─────────────────────────────────────────────────────────────────
const said = (tree) => texts(tree).join(' ').replace(/\s+/g, ' ');
const INLINE = new Set(['b', 'i', 'em', 'strong', 'span', 'code', 'a', 'small', 'Fragment']);
const isInline = (n) => n == null || typeof n !== 'object' || Array.isArray(n)
  || (typeof n.type === 'string' && INLINE.has(n.type)) || n.type === 'Fragment';
function flow(n) {
  if (n == null || n === false) return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(flow).join('');
  const inner = (n.kids || []).map(flow).join('');
  return isInline(n) ? inner : '\n' + inner + '\n';
}
const reads = (tree) => flow(tree).replace(/\s+/g, ' ').trim();
function glued(n, out = []) {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(c => glued(c, out)); return out; }
  const kids = (n.kids || []).filter(k => k != null && k !== false && k !== '');
  for (let i = 0; i < kids.length - 1; i++) {
    const a = flow(kids[i]), b = flow(kids[i + 1]);
    if (a && b && /\w$/.test(a) && /^\w/.test(b)) out.push('…' + a.slice(-28) + '][' + b.slice(0, 28) + '…');
  }
  kids.forEach(k => glued(k, out));
  return out;
}
function shown(n, pred, out = []) {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(c => shown(c, pred, out)); return out; }
  if (pred(n)) out.push(n);
  (n.kids || []).forEach(c => shown(c, pred, out));
  return out;
}
const shownButton = (tree, label) => shown(tree, n => n.type === 'button' && texts(n).join(' ').includes(label));

// ── THE SHIPPED PARSER, OUT OF THE BUNDLE ─────────────────────────────────────────────────────────────────
const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const parseArrivalQR = (() => {
  const start = FELLOWSHIP.indexOf('var MYKIDS_MAX =');
  assert.notEqual(start, -1, 'the parent-side engine is not in the bundle — did build:fellowship run?');
  const src = FELLOWSHIP.slice(start, FELLOWSHIP.indexOf('function arrivalSessionNow(', start))
    + fnBody(FELLOWSHIP, 'function parseArrivalQR(text) {', 'parseArrivalQR');
  return new Function(src + '\nreturn parseArrivalQR;')();
})();
assert.deepEqual(parseArrivalQR(JSON.stringify({ v: 1, g: 'a'.repeat(64), c: ['x'] })), { g: 'a'.repeat(64), c: ['x'] },
  're-anchor: the lifted parser does not parse a valid payload, so every refusal below is vacuous');

const SARAH = 'a'.repeat(64);      // at the door, with an arrival the relay admitted
const TOM = 'b'.repeat(64);        // also at the door — a DIFFERENT family
const UNKNOWN = 'e'.repeat(64);    // a member who has not said they are here
const AM_FROM = 1788595200;

const qr = (g, c, extra = {}) => JSON.stringify({ v: 1, g, c, ...extra });

// ── THE REGISTER THE TRANSPORT WOULD HAND THE SCREEN ──────────────────────────────────────────────────────
// The exact shape Fellowship.subscribeCheckinRegister emits — asserted against the shipped reader in
// scripts/a-cleared-worker-reads-one-sessions-register.test.mjs, so these are its real answers.
const arrival = (pub, name, checkedIn = 0, at = AM_FROM) => ({ pub, name, at, checkedIn });
const session = (id, arrivals, rows = []) => ({
  session: id, roomCode: roomCode(id), roomClash: false,
  from: AM_FROM, until: AM_FROM + 10800, helpers: 2, arrivals, rows,
});
const register = (sessions) => ({
  cleared: true, lapsed: false, notYet: false, withdrawn: false,
  from: AM_FROM, until: AM_FROM + 10800, lifetime: 'session',
  sessions, keysHeld: sessions.length, unreadable: 0, foreign: 0, settled: true,
});

function desk(reg) {
  const { React, draw } = miniReact();
  const checkinCalls = [];
  const checkinResult = { v: { ok: true, id: 'ci-new' } };
  // A CAPTURING SCANNER. QRScanner itself lives in app/screens-church.jsx and carries its own no-camera /
  // camera-refused fallback; what is under test here is the CALLER's contract with it — what it does with a
  // decoded string, and whether the typed path survives while it is open.
  const scanners = [];
  const QRScanner = function QRScanner(p) { scanners.push(p); return React.createElement('div', {}, 'Point at the parent’s code'); };
  const win = {
    Fellowship: { myPubkey: 'me', parseArrivalQR },
    Capacitor: { isNativePlatform: () => false },
    TrinityBackup: { saveFile: async () => ({ saved: true }) },
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: true }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    innerWidth: 390,
  };
  const globals = {
    React,
    window: win,
    document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
    navigator: { userAgent: '' },
    localStorage: win.localStorage,
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    Overlay: function Overlay(p) { return React.createElement('div', {}, p.open ? p.children : null); },
    SectionLabel: function SectionLabel(p) { return React.createElement('h2', {}, p.children); },
    Icon: Stub('Icon'),
    IconBtn: Stub('IconBtn'),
    BottomSheet: ({ open, children }) => (open ? children : null),
    CareCard: Stub('CareCard'),
    SafetyBanner: Stub('SafetyBanner'),
    QRScanner,
    safeCssColor: (c) => c,
    Math, Date, JSON, Set, Number, String, Array, Promise, Object, isNaN, Boolean,
  };
  const mod = loadScreen('app/screens-serving.jsx', ['ServingScreen', 'KidsRegister'], globals);
  const ctx = {
    church: { name: 'St Chad’s, Falgate' },
    myPubkey: 'me',
    checkinRegister: reg,
    rotaVis: 'church',
    churchRosters: [], churchEvents: [], churchServices: [], churchRotas: [], churchTeams: [],
    servPending: [], servConfirmed: [], servDeclined: [], myRsvps: {},
    care: { settings: { enabled: false }, needs: [], slots: [], myPub: 'me' },
    joinState: { isAdmitted: true },
    openHelp() {}, toast() {},
    checkinAdd: async (rec) => { checkinCalls.push(rec); return checkinResult.v; },
    checkinRelease: async () => ({ ok: true }),
  };
  let tree = draw(mod.KidsRegister, { ctx });
  const api = {
    ctx, checkinCalls, scanners,
    setResult(v) { checkinResult.v = v; },
    redraw() { scanners.length = 0; tree = draw(mod.KidsRegister, { ctx }); return tree; },
    tree: () => tree,
    // ONE SESSION CARD'S CHECK-IN FORM, by position — the screen renders one per session this phone holds a
    // key for, and the cross-session negative needs to drive them separately.
    form(i = 0) {
      const forms = shown(tree, n => typeof n.type === 'function' && n.type.name === 'KidsAddChild');
      assert.ok(forms[i], 'there is no check-in form #' + i + ' on this screen (found ' + forms.length + ') — re-anchor this test');
      return forms[i];
    },
    reads(i = 0) { return reads(api.form(i)); },
    input(i, label) {
      const got = shown(api.form(i), n => n.type === 'input' && n.props && n.props['aria-label'] === label);
      assert.equal(got.length, 1, 'expected one input labelled ' + JSON.stringify(label) + ' in form #' + i + ', found ' + got.length);
      return got[0];
    },
    type(i, label, value) { api.input(i, label).props.onChange({ target: { value } }); return api.redraw(); },
    press(i, label) {
      const b = shownButton(api.form(i), label);
      assert.equal(b.length, 1, 'expected exactly one control reading ' + JSON.stringify(label) + ' in form #' + i + ', found ' + b.length);
      b[0].props.onClick();
      return api.redraw();
    },
    async click(i, label) {
      const b = shownButton(api.form(i), label);
      assert.equal(b.length, 1, 'expected exactly one control reading ' + JSON.stringify(label) + ' in form #' + i + ', found ' + b.length);
      b[0].props.onClick();
      for (let k = 0; k < 5; k++) await Promise.resolve();
      return api.redraw();
    },
    has(i, label) { return shownButton(api.form(i), label).length; },
    // Open the scanner on form #i and hand it a decoded string, exactly as the camera loop would.
    scan(i, text) {
      api.press(i, 'Scan the parent’s code');
      const p = api.scanners[api.scanners.length - 1];
      assert.ok(p && typeof p.onResult === 'function', 'the scanner was opened with no onResult — nothing could ever be decoded');
      p.onResult(text);
      return api.redraw();
    },
  };
  return api;
}

// ══════════════════════ THE HAPPY PATH, AND IT WRITES NOTHING BY ITSELF ════════════════════════════════════
test('scanning fills the child’s name and picks the family — and writes NOTHING until she answers', async () => {
  const d = desk(register([session('svc-am', [arrival(SARAH, 'Sarah Henderson')])]));
  d.scan(0, qr(SARAH, ['Milo']));
  assert.equal(d.input(0, 'Child’s name').props.value, 'Milo',
    'THE SCAN DID NOT FILL THE NAME. That is the whole feature: "will there be any friction in terms of a ' +
    'worker typing in a name… that really needs to be automatic via a qr".');
  assert.deepEqual(d.checkinCalls, [],
    'SCANNING WROTE A RECORD. A scan fills a box; the named confirmation is what writes, and it has not been ' +
    'answered yet.');
  // THE CONFIRMATION STILL RUNS, unchanged, and it names BOTH sides.
  await d.click(0, 'Check a child in');
  assert.match(d.reads(0), /Milo → Sarah Henderson\?/,
    'the named pairing is not on screen after a scan — the mitigation this screen exists to carry is gone');
  assert.deepEqual(d.checkinCalls, [], 'it wrote before she answered the confirmation');
  await d.click(0, 'Yes, check in');
  assert.equal(d.checkinCalls.length, 1, 'answering the confirmation wrote nothing');
  assert.equal(d.checkinCalls[0].childName, 'Milo');
  assert.equal(d.checkinCalls[0].guardian, SARAH,
    'the record’s guardian tag did not come from the signed arrival');
  assert.equal(d.checkinCalls[0].session, 'svc-am');
  assert.deepEqual(glued(d.form(0)), [], 'two pieces of copy run together with no space between them');
});

// ══════════════ NEGATIVE 1: A QR NAMING ANOTHER FAMILY'S CHILDREN PRODUCES NO RECORD ═══════════════════════
test('THE PARENT IN THE CONFIRMATION IS NAMED FROM THE SIGNED ARRIVAL, NEVER FROM THE QR', async () => {
  // THE LOAD-BEARING RULE OF THE WHOLE DESIGN. The child's names are unauthenticated — exactly as the
  // worker's typing is today. What makes that safe is that the PARENT is rendered from a document the relay
  // admitted only from that pubkey's own address. A payload asserting a parent's name must reach nothing.
  // ONLY TOM IS AT THE DOOR. So "Sarah Henderson" can reach this screen from ONE place and one only — the
  // payload — and a fixture where she has also arrived could never tell the two sources apart.
  const d = desk(register([session('svc-am', [arrival(TOM, 'Tom Achebe')])]));
  // A code that carries Sarah's children and claims her name, but points at TOM: the shape a forger builds,
  // and the shape a photographed code acquires the moment somebody edits it.
  d.scan(0, qr(TOM, ['Milo'], { n: 'Sarah Henderson', name: 'Sarah Henderson', guardian: SARAH }));
  await d.click(0, 'Check a child in');
  const t = d.reads(0);
  assert.match(t, /Milo → Tom Achebe\?/,
    'THE CONFIRMATION NAMED THE PARENT THE PAYLOAD CLAIMED. It must name the author of the SIGNED ARRIVAL ' +
    'the pubkey resolves to, which is the only reason a forged code is safe. Screen read: ' + t);
  assert.ok(!t.includes('Sarah Henderson'),
    'a name asserted by the QR is on the worker’s screen: ' + t);
  // …and the mismatch is what she acts on. Nothing is written unless she says yes.
  d.press(0, 'No, go back');
  assert.deepEqual(d.checkinCalls, [],
    'A RECORD WAS WRITTEN FOR A PAIRING THE WORKER REFUSED. Negative 1 of the plan, verbatim.');
  assert.equal(d.input(0, 'Child’s name').props.value, 'Milo', 'the form was cleared by a refusal, so she has to start again');
});

test('…and if she says yes anyway, the guardian tag is the ARRIVAL’s pubkey, not the one the QR asserted', async () => {
  const d = desk(register([session('svc-am', [arrival(SARAH, 'Sarah Henderson'), arrival(TOM, 'Tom Achebe')])]));
  d.scan(0, qr(TOM, ['Milo'], { guardian: SARAH, g2: SARAH }));
  await d.click(0, 'Check a child in');
  await d.click(0, 'Yes, check in');
  assert.equal(d.checkinCalls[0].guardian, TOM,
    'a pubkey asserted by the payload reached the record’s guardian tag. The tag is served by the relay to ' +
    'the person it names, so this would deliver a stranger a child’s record.');
});

// ══════════════ NEGATIVE 2: NO LIVE ARRIVAL MEANS NOTHING IS FILLED IN ════════════════════════════════════
test('a code whose family has not said they are here fills nothing, and says so', async () => {
  const d = desk(register([session('svc-am', [arrival(SARAH, 'Sarah Henderson')])]));
  d.scan(0, qr(UNKNOWN, ['Milo']));
  assert.equal(d.input(0, 'Child’s name').props.value, '',
    'A NAME OFF AN UNMATCHED CODE WAS FILLED IN. The names are unauthenticated; they are only ever safe ' +
    'beside a signed arrival that anchors the family.');
  assert.match(d.reads(0), /Type the child’s name instead/i,
    'the screen did not tell her what to do — a code that does nothing and says nothing is the silent-blank shape');
  // AND THE TYPED PATH STILL WORKS, which is the half that matters at a door.
  d.type(0, 'Child’s name', 'Milo');
  await d.click(0, 'Check a child in');
  assert.equal(d.checkinCalls.length, 1, 'a failed scan blocked the typed check-in — nothing here may block a child');
  assert.equal(d.checkinCalls[0].guardian, '', 'an unmatched code still attached a guardian to the record');
});

test('a failed scan disarms an earlier pick rather than leaving a stale pairing armed', async () => {
  // She taps Sarah's row, then scans a code that matches nobody. Leaving `picked` would arm "→ Sarah
  // Henderson?" under whatever name she types next — the mitigation answering about the wrong family.
  const d = desk(register([session('svc-am', [arrival(SARAH, 'Sarah Henderson')])]));
  d.press(0, 'Sarah Henderson has arrived');
  d.scan(0, qr(UNKNOWN, ['Milo']));
  d.type(0, 'Child’s name', 'Yara');
  await d.click(0, 'Check a child in');
  assert.equal(d.checkinCalls.length, 1, 'nothing was written at all');
  assert.equal(d.checkinCalls[0].guardian, '',
    'A FAILED SCAN LEFT A FAMILY ARMED. The next child typed in was linked to a parent nobody confirmed.');
});

// ══════════════ NEGATIVE 3: A CODE FROM A DIFFERENT SESSION IS REFUSED ════════════════════════════════════
test('a code matching an arrival in ANOTHER room is refused by the room it is shown to', () => {
  // The cross-session shape, one level up: two sessions on one phone, and Sarah has only ever announced
  // herself at the evening one. The morning room must not find her.
  const d = desk(register([
    session('svc-am', [arrival(TOM, 'Tom Achebe')]),
    session('svc-pm', [arrival(SARAH, 'Sarah Henderson')]),
  ]));
  d.scan(0, qr(SARAH, ['Milo']));
  assert.equal(d.input(0, 'Child’s name').props.value, '',
    'THE MORNING ROOM ACCEPTED AN EVENING ARRIVAL. A red-team pass on 2026-09-10 found the same shape one ' +
    'document over: trying each held key in turn hands a MORNING register to an EVENING helper.');
  assert.match(d.reads(0), /Type the child’s name instead/i);
  // …and the room she DID announce herself at finds her, so the refusal above is a refusal and not a dead parser.
  d.scan(1, qr(SARAH, ['Milo']));
  assert.equal(d.input(1, 'Child’s name').props.value, 'Milo',
    're-anchor: the evening room did not match its own arrival either, so the refusal above proves nothing');
});

// ══════════════ NEGATIVE 4: SCANNING IS NEVER REQUIRED ════════════════════════════════════════════════════
test('a child gets into the room with no scan, no code and no app at the other end', async () => {
  const d = desk(register([session('svc-am', [])]));   // nobody has announced themselves at all
  assert.equal(d.has(0, 'Scan the parent’s code'), 1, 're-anchor: there is no scan control at all on this screen');
  d.type(0, 'Child’s name', 'Milo');
  await d.click(0, 'Check a child in');
  assert.equal(d.checkinCalls.length, 1,
    'A CHILD COULD NOT BE CHECKED IN BY TYPING. DOMAIN.md: nothing in this feature may stop a child reaching ' +
    'the room — a family with no app is the ordinary Sunday.');
  assert.equal(d.checkinCalls[0].guardian, '', 'a guardian was invented for a family that announced nothing');
  assert.match(d.reads(0), /Milo checked in/i, 'the worker was not told it worked');
});

test('the typed path is still on screen WHILE the camera is open, and cancelling returns to it', () => {
  const d = desk(register([session('svc-am', [arrival(SARAH, 'Sarah Henderson')])]));
  d.press(0, 'Scan the parent’s code');
  assert.equal(shown(d.form(0), n => n.type === 'input' && n.props && n.props['aria-label'] === 'Child’s name').length, 1,
    'the name box disappeared while the camera was open — a worker whose camera will not focus has nowhere to go');
  assert.equal(d.has(0, 'Type the name instead'), 1, 'there is no way out of the scanner back to typing');
  d.press(0, 'Type the name instead');
  assert.equal(d.has(0, 'Scan the parent’s code'), 1, 'cancelling the scanner did not restore the scan control');
});

test('a phone with no camera reaches the same handler by pasting — onManual IS onResult', () => {
  // QRScanner's own fallback (app/screens-church.jsx) offers a paste box when there is no camera or the
  // camera is refused, and calls `onManual` with what was pasted. Every payload we scan is a plain string, so
  // pasting one must be exactly equivalent to scanning it; wiring onManual to anything else — or to nothing —
  // is how a phone with a broken camera dead-ends, which AUDIT-2026-07-26 #8 found on both sides of a transfer.
  const d = desk(register([session('svc-am', [arrival(SARAH, 'Sarah Henderson')])]));
  d.press(0, 'Scan the parent’s code');
  const p = d.scanners[d.scanners.length - 1];
  assert.equal(typeof p.onManual, 'function', 'the scanner was opened with NO paste fallback — a phone with no camera dead-ends here');
  assert.equal(typeof p.onCancel, 'function', 'the scanner was opened with no way to cancel');
  assert.equal(p.onManual, p.onResult,
    'the pasted code goes somewhere other than the scanned code does. They are the same string and must be ' +
    'the same path, or one of the two silently stops working.');
  p.onManual(qr(SARAH, ['Milo']));
  d.redraw();
  assert.equal(d.input(0, 'Child’s name').props.value, 'Milo', 'a pasted code did not fill the name');
});

// ══════════════ NEGATIVE 8: A MALFORMED CODE IS REFUSED WITHOUT THROWING ══════════════════════════════════
test('a hostile or malformed code is refused on the SCREEN, and the screen survives it', () => {
  // React throws when handed an object as a child and the app root is the only boundary above this screen,
  // so `c: [{}]` in a photographed code would blank the WHOLE APP at a children's door. Measured here on the
  // rendered tree rather than only on the parser, because the parser having a rule and the screen honouring
  // it are two different claims.
  const d = desk(register([session('svc-am', [arrival(SARAH, 'Sarah Henderson')])]));
  const junk = [
    'https://example.com/not-a-check-in',
    '',
    'null',
    JSON.stringify({ v: 2, g: SARAH, c: ['Milo'] }),
    JSON.stringify({ v: 1, g: SARAH, c: { 0: 'Milo' } }),
    JSON.stringify({ v: 1, g: SARAH, c: [{ name: 'Milo' }] }),
    JSON.stringify({ v: 1, g: 'npub1sarah', c: ['Milo'] }),
    JSON.stringify({ v: 1, g: SARAH, c: Array.from({ length: 500 }, (_, i) => 'Child ' + i) }),
  ];
  for (const text of junk) {
    assert.doesNotThrow(() => d.scan(0, text), 'the worker’s screen THREW on ' + JSON.stringify(text.slice(0, 60)));
    assert.equal(d.input(0, 'Child’s name').props.value, '', 'junk reached the name box: ' + text.slice(0, 60));
    assert.match(d.reads(0), /isn’t a check-in code|Type the child’s name instead/i,
      'the screen said nothing about a code it refused: ' + text.slice(0, 60));
  }
  // AND THE SCREEN IS STILL USABLE AFTERWARDS — eight refusals in a row have not left it in a stuck state.
  d.scan(0, qr(SARAH, ['Milo']));
  assert.equal(d.input(0, 'Child’s name').props.value, 'Milo',
    're-anchor: the screen never matches anything, so every refusal above is vacuous');
});

test('a code carrying two hundred children paints at most a dozen chips', () => {
  const d = desk(register([session('svc-am', [arrival(SARAH, 'Sarah Henderson')])]));
  d.scan(0, qr(SARAH, Array.from({ length: 200 }, (_, i) => 'Child ' + i)));
  const chips = shownButton(d.form(0), 'Child ');
  assert.ok(chips.length <= 12 && chips.length > 0,
    'the worker’s screen painted ' + chips.length + ' children off one code. No family has that many, and a ' +
    'screen a stranger can make unusable is a screen that can stop a check-in.');
});

// ══════════════ ONE CODE, TWO CHILDREN ════════════════════════════════════════════════════════════════════
test('two children on one code: the second is one tap, and keeps the same signed guardian', async () => {
  const d = desk(register([session('svc-am', [arrival(SARAH, 'Sarah Henderson')])]));
  d.scan(0, qr(SARAH, ['Milo', 'Ivy']));
  assert.match(d.reads(0), /Ivy/, 'the second child on the code is nowhere on screen');
  await d.click(0, 'Check a child in');
  await d.click(0, 'Yes, check in');
  assert.equal(d.checkinCalls.length, 1);
  // The box is now primed with the sibling, and the FAMILY IS STILL PICKED — otherwise Ivy would be written
  // with no guardian link at all, silently, with the worker having done nothing wrong.
  assert.equal(d.input(0, 'Child’s name').props.value, 'Ivy', 'the sibling was not carried into the box');
  await d.click(0, 'Check a child in');
  assert.match(d.reads(0), /Ivy → Sarah Henderson\?/, 'the sibling’s confirmation does not name the family');
  await d.click(0, 'Yes, check in');
  assert.equal(d.checkinCalls.length, 2);
  assert.equal(d.checkinCalls[1].childName, 'Ivy');
  assert.equal(d.checkinCalls[1].guardian, SARAH,
    'THE SECOND CHILD ON ONE CODE LOST THE GUARDIAN LINK. The relay serves a p-tagged pubkey the record, so ' +
    'this is the difference between the parent getting their child’s copy and not.');
  // …and each child got their own pickup code.
  assert.notEqual(d.checkinCalls[0].code, d.checkinCalls[1].code, 'two children were given the same pickup code');
});

test('tapping a queue row by hand drops the names scanned off somebody else’s code', () => {
  const d = desk(register([session('svc-am', [arrival(SARAH, 'Sarah Henderson'), arrival(TOM, 'Tom Achebe')])]));
  d.scan(0, qr(SARAH, ['Milo', 'Ivy']));
  d.press(0, 'Tom Achebe has arrived');
  assert.ok(!/Ivy/.test(d.reads(0)),
    'one family’s children are still offered on screen under another family’s name');
});

// ══════════════ AND THE CONTROL IS REALLY ON THE SCREEN A WORKER OPENS ════════════════════════════════════
test('the scan control is on the Kids pane of the real Serving screen, not only on a component in isolation', () => {
  // A control nobody renders is the rule-1 failure exactly.
  const { React, draw } = miniReact();
  const scanners = [];
  const win = {
    Fellowship: { myPubkey: 'me', parseArrivalQR },
    Capacitor: { isNativePlatform: () => false },
    TrinityBackup: { saveFile: async () => ({ saved: true }) },
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: true }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    innerWidth: 390,
  };
  const globals = {
    React, window: win,
    document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
    navigator: { userAgent: '' }, localStorage: win.localStorage,
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    Overlay: function Overlay(p) { return React.createElement('div', { 'data-overlay': !!p.open }, p.open ? p.children : null); },
    SectionLabel: function SectionLabel(p) { return React.createElement('h2', {}, p.children); },
    Icon: Stub('Icon'), IconBtn: Stub('IconBtn'),
    BottomSheet: ({ open, children }) => (open ? children : null),
    CareCard: Stub('CareCard'), SafetyBanner: Stub('SafetyBanner'),
    QRScanner: function QRScanner(p) { scanners.push(p); return null; },
    safeCssColor: (c) => c,
    Math, Date, JSON, Set, Number, String, Array, Promise, Object, isNaN, Boolean,
  };
  const mod = loadScreen('app/screens-serving.jsx', ['ServingScreen', 'KidsRegister'], globals);
  const ctx = {
    church: { name: 'St Chad’s, Falgate' }, myPubkey: 'me',
    checkinRegister: register([session('svc-am', [arrival(SARAH, 'Sarah Henderson')])]),
    rotaVis: 'church', churchRosters: [], churchEvents: [], churchServices: [], churchRotas: [], churchTeams: [],
    servPending: [], servConfirmed: [], servDeclined: [], myRsvps: {},
    care: { settings: { enabled: false }, needs: [], slots: [], myPub: 'me' },
    joinState: { isAdmitted: true }, openHelp() {}, toast() {},
    checkinAdd: async () => ({ ok: true }), checkinRelease: async () => ({ ok: true }),
  };
  const render = () => draw(mod.ServingScreen, { open: true, onClose() {}, ctx });
  render();                                   // the first draw queues the tab-strip effects…
  let tree = render();                        // …the second sees what they settled on
  assert.ok(said(tree).includes('Kids'), 're-anchor: the Kids tab is not on the Serving screen at all');
  const tab = shownButton(tree, 'Kids');
  assert.ok(tab.length, 're-anchor: no Kids tab to press');
  tab[0].props.onClick();
  tree = render();
  const btn = shownButton(tree, 'Scan the parent’s code');
  assert.equal(btn.length, 1,
    'THE SCAN CONTROL IS NOT ON THE SCREEN A WORKER ACTUALLY OPENS. Every assertion about KidsAddChild in ' +
    'isolation is then about a component nobody renders — CLAUDE.md rule 1, verbatim.');
});

// ══════════════ AN INVISIBLE CHARACTER MUST NOT REACH THE ONE SENTENCE THAT MATTERS ═══════════════════════
test('a bidi override in a scanned name never reaches the confirmation', async () => {
  // The whole design rests on the worker reading "Milo → Sarah Henderson?" and acting on it. A right-to-left
  // override inside the name REORDERS that sentence on screen while leaving the string unchanged, so an
  // assertion on the string alone would never see it. Measured on the rendered tree, and on what is written.
  const d = desk(register([session('svc-am', [arrival(SARAH, 'Sarah Henderson')])]));
  d.scan(0, qr(SARAH, ['\u202EMilo\u200B']));
  assert.equal(d.input(0, 'Child\u2019s name').props.value, 'Milo',
    'AN INVISIBLE CHARACTER REACHED THE WORKER\u2019S NAME BOX: ' + JSON.stringify(d.input(0, 'Child\u2019s name').props.value));
  await d.click(0, 'Check a child in');
  const t = d.reads(0);
  assert.match(t, /Milo \u2192 Sarah Henderson\?/, 'the confirmation did not render: ' + JSON.stringify(t));
  assert.ok(!/[\u0000-\u001F\u007F-\u009F\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069]/.test(t),
    'a bidi or zero-width character is in the sentence the worker confirms against, where it reorders what ' +
    'she reads while the string a test reads stays the same');
  await d.click(0, 'Yes, check in');
  assert.equal(d.checkinCalls[0].childName, 'Milo',
    'an invisible character was written into the safeguarding record: ' + JSON.stringify(d.checkinCalls[0].childName));
});


// ── ITEM 12 (audit 2026-09-14): TWO FAMILIES AT ONCE, NEITHER NAME RESOLVED ─────────────────────────────
// The whole no-typing design rests on ONE mitigation: a confirmation that NAMES BOTH SIDES, "Milo → Sarah
// Henderson?", because the measured risk is the worker tapping the wrong queue row and handing a child's
// name and pickup code to the wrong family. When the sealed name has not reached this phone, both the row
// and the confirmation used to collapse to a CONSTANT — "Someone's arrived…", "the person who just
// arrived" — so two families at the door produced two identical rows and two identical questions, and the
// mitigation was wallpaper at exactly the moment it was load-bearing.
const SECOND = 'e'.repeat(64);
// The same clock string the screen builds, derived rather than retyped — a hard-coded "9:42" would pass or
// fail on the machine's timezone rather than on the code.
const clockOf = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

test('two arrivals with no names are TELLABLE APART on the queue', async () => {
  const d = desk(register([session('svc-am', [
    arrival(TOM, '', 0, AM_FROM),           // name not resolved on this phone
    arrival(SECOND, '', 0, AM_FROM + 420),  // seven minutes later
  ])]));
  await d.click(0, 'Check a child in');
  const t = d.reads(0);
  const generic = (t.match(/Someone’s arrived — their name hasn’t reached your phone yet/g) || []).length;
  assert.equal(generic, 0,
    'BOTH QUEUE ROWS READ THE SAME WORDS, so the worker cannot tell which family is which before she taps. ' +
    'Screen read: ' + t);
  const times = (t.match(/Someone arrived at /g) || []).length;
  assert.equal(times, 2, 'expected both rows to carry their arrival time; saw ' + times + ' in: ' + t);
});

test('the confirmation names the TIME when it cannot name the person', async () => {
  const d = desk(register([session('svc-am', [arrival(TOM, '', 0, AM_FROM)])]));
  d.press(0, 'Someone arrived at ' + clockOf(AM_FROM) + ' —');   // pick the family off the signed arrival
  d.type(0, 'Child’s name', 'Milo');
  await d.click(0, 'Check a child in');                          // submit → the pairing panel
  const t = d.reads(0);
  assert.match(t, new RegExp('Milo → the person who arrived at ' + clockOf(AM_FROM).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\?'),
    'THE CONFIRMATION STILL USES A CONSTANT for an unresolved family, so two of them are asked about in ' +
    'identical words. Screen read: ' + t);
  assert.ok(!/the person who just arrived/.test(t), 'the old constant is still on screen: ' + t);
});

test('two families whose rows read IDENTICALLY — the panel says it cannot tell them apart', async () => {
  // Same minute, so the clock time added by this fix does not separate them either.
  const d = desk(register([session('svc-am', [
    arrival(TOM, '', 0, AM_FROM), arrival(SECOND, '', 0, AM_FROM),
  ])]));
  // Both rows read the same, so they cannot be pressed by text — which is the defect. Tap the row itself.
  const rows = shown(d.tree(0), n => n.type === 'button' && n.props && n.props['aria-pressed'] !== undefined);
  assert.equal(rows.length, 2, 're-anchor: expected two queue rows, saw ' + rows.length);
  rows[0].props.onClick();
  d.type(0, 'Child’s name', 'Milo');
  await d.click(0, 'Check a child in');
  const t = d.reads(0);
  assert.match(t, /Milo → /, 're-anchor: the pairing panel never opened, so this test proves nothing');
  assert.match(t, /can’t tell them apart/,
    'TWO FAMILIES READ IDENTICALLY AND THE CONFIRMATION READS AS CERTAIN. It may name either of them, and a ' +
    'question that looks checked launders a guess into a verified pairing. Screen read: ' + t);
  assert.match(t, /Ask before you tap/, 'it must hand the check to the person who can actually make it');
});

test('TWO FAMILIES WITH THE SAME RESOLVED NAME are caught too — an ordinary Sunday', async () => {
  // Found by the audit of this fix, 2026-09-14, and it is the substantive half: the first version of the
  // warning counted UNNAMED arrivals, so two members both displaying as "Sarah" — which is what a church
  // whose sealed display names are first-name-only has every week — produced two identical rows, a
  // confirmation reading "Milo → Sarah?", and NO warning at all. Resolving the names does not make the
  // question answerable; it just makes the ambiguity look authoritative.
  const d = desk(register([session('svc-am', [
    arrival(TOM, 'Sarah', 0, AM_FROM), arrival(SECOND, 'Sarah', 0, AM_FROM + 600),
  ])]));
  // Same problem as the test above, and the same point: two identical rows cannot be told apart by text.
  const rows = shown(d.tree(0), n => n.type === 'button' && n.props && n.props['aria-pressed'] !== undefined);
  assert.equal(rows.length, 2, 're-anchor: expected two queue rows, saw ' + rows.length);
  rows[0].props.onClick();
  d.type(0, 'Child’s name', 'Milo');
  await d.click(0, 'Check a child in');
  const t = d.reads(0);
  assert.match(t, /Milo → Sarah\?/, 're-anchor: the pairing panel never opened');
  assert.match(t, /can’t tell them apart/,
    'TWO FAMILIES BOTH READ "Sarah" AND NOTHING SAID SO. The worker taps one, and a child’s name and pickup ' +
    'code go to whichever of them she guessed. Screen read: ' + t);
});

test('the SCAN path never warns — the family is picked by signature, not by a tap', async () => {
  // The mirror failure, also from that audit. Scanning picks the family by the pubkey off a SIGNED arrival,
  // so there is nothing to confuse however many unnamed families are in the queue. A warning on the one path
  // carrying a cryptographic guarantee is a warning the worker learns to tap through — which is item 12's
  // own argument ("degraded to wallpaper") turned on its fix.
  const d = desk(register([session('svc-am', [
    arrival(TOM, '', 0, AM_FROM), arrival(SECOND, '', 0, AM_FROM),
  ])]));
  d.scan(0, qr(TOM, ['Milo']));
  await d.click(0, 'Check a child in');
  const t = d.reads(0);
  assert.match(t, /Milo → /, 're-anchor: the scan did not reach a pairing');
  assert.ok(!/can’t tell them apart/.test(t),
    'the scan path warned about an ambiguity it does not have — the family came off a signed arrival: ' + t);
});

test('two unnamed families the CLOCK separates do not trigger the warning', async () => {
  // The discriminator this fix added must actually count. 45 minutes apart is not ambiguous.
  const d = desk(register([session('svc-am', [
    arrival(TOM, '', 0, AM_FROM), arrival(SECOND, '', 0, AM_FROM + 2700),
  ])]));
  d.press(0, 'Someone arrived at ' + clockOf(AM_FROM) + ' —');
  d.type(0, 'Child’s name', 'Milo');
  await d.click(0, 'Check a child in');
  const t = d.reads(0);
  assert.match(t, /Milo → /, 're-anchor');
  assert.ok(!/can’t tell them apart/.test(t),
    'the warning fired over two rows the clock plainly separates, which teaches the worker to ignore it: ' + t);
});

test('…and with only ONE unnamed family it does NOT cry wolf', async () => {
  const d = desk(register([session('svc-am', [
    arrival(TOM, '', 0, AM_FROM), arrival(SECOND, 'Ada Nwosu', 0, AM_FROM + 60),
  ])]));
  d.press(0, 'Someone arrived at ' + clockOf(AM_FROM) + ' —');
  d.type(0, 'Child’s name', 'Milo');
  await d.click(0, 'Check a child in');
  const t = d.reads(0);
  assert.match(t, /Milo → /, 're-anchor: the pairing panel never opened');
  assert.ok(!/can’t tell them apart/.test(t),
    'the ambiguity warning fires when there is no ambiguity — a warning shown every Sunday is one nobody reads');
});

test('a RESOLVED name is still used, and is not replaced by a clock time', async () => {
  // Re-anchor: the time is a fallback, never an upgrade. Naming the person is always better.
  const d = desk(register([session('svc-am', [arrival(TOM, 'Tom Achebe', 0, AM_FROM)])]));
  await d.click(0, 'Check a child in');
  const t = d.reads(0);
  assert.match(t, /Tom Achebe has arrived/, 'a known family is no longer named on the queue: ' + t);
  assert.ok(!/Someone arrived at/.test(t), 'a named arrival was described by its clock time instead: ' + t);
});
