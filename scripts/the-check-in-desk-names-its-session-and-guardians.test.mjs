// THE SCREEN AT THE DOOR SUPPLIES WHAT THE RELAY'S READ GATES KEY ON — asserted off the rendered tree.
//   Run: node --test scripts/the-check-in-desk-names-its-session-and-guardians.test.mjs
//
// CLAUDE.md rule 1, and it is the whole reason slice 2 exists: *"a well-tested engine nobody is required to
// consult is not a feature."* scripts/a-check-in-record-the-relay-will-share.test.mjs proves the shipped
// WRITER emits `['session']` and `['p']` when a record names them. This file proves THE SCREEN NAMES THEM.
// Delete `session, guardians:` from one line of DashCheckin and that other file stays green — which is
// exactly the failure §6 of reference/DESIGN-CHECKIN-IN-THE-MEMBER-APP-2026-09-09.md is a list of:
//
//     "The fix that hides adults-only rooms from a young person had eight passing tests over its engine.
//      Deleting the one line in the app that actually called it left all 1,982 tests green."
//
// HOW IT ASSERTS, AND WHY NOT BY GREP. CLAUDE.md rule 3: app/stew-dashboard.jsx ships UNBUNDLED, so putting
// `false && ` in front of a condition — or commenting a line out — leaves every word of it in the file and
// any text-matching assertion still passes. So the REAL DashCheckin is sliced out by brace-match, compiled
// with the same esbuild the packaged build uses, rendered through the miniature React in
// scripts/render-jsx-screen.mjs, driven through the button a leader actually presses, and the RECORD IT
// HANDS TO publishCheckin is read off the call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

const KID = 'a'.repeat(64);
const KID2 = 'b'.repeat(64);
const MUM = 'c'.repeat(64);
const DAD = 'd'.repeat(64);
const TODAY = new Date().toISOString().slice(0, 10);

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
// ONE NODE, ONCE — AND WHY THE SHARED HELPERS CANNOT DO IT. find()/button() in render-jsx-screen.mjs walk
// both `kids` AND any prop that looks like a tree, so an element handed to a component as a PROP (Panel's
// `action`) and then rendered as a child of that component is reached twice — and it is not even the same
// object the second time, because expand() rebuilds every plain node it descends. Deduping by identity
// therefore cannot help, and loosening every count to `>= 1` would throw away the claim worth making ("this
// control is on the screen exactly once"). So this walks the RENDERED tree only: what a leader can see.
function shown(n, pred, out = []) {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(c => shown(c, pred, out)); return out; }
  if (pred(n)) out.push(n);
  (n.kids || []).forEach(c => shown(c, pred, out));
  return out;
}
const shownButton = (tree, label) => shown(tree, n => n.type === 'button' && texts(n).join(' ').includes(label));

// THE SHIPPED DashCheckin, compiled and rendered, with every write captured.
//
// `CheckinPicker` and `CheckoutModal` are stubbed and their PROPS are kept: which child a leader taps is the
// picker's job and is not what is under test, so the test reaches in and calls `onPick` the way the picker
// does. Everything that decides what goes INTO the record — the guardian filter, the session choice, the
// call to publishCheckin — is the real code.
async function desk({ services = [], guardians = {}, minors = [KID, KID2], recs = [], publishOk = true } = {}) {
  const src = fnBody(SRC, 'function DashCheckin() {', 'DashCheckin');
  const tmp = join(tmpdir(), 'ckdesk-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { DashCheckin };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const { React, draw } = miniReact();
  const written = [];
  const blocked = [];
  const globals = {
    React,
    // A PASSTHROUGH, NOT A STUB. Panel is where the header action button lives, and the action button is how
    // a leader opens the picker — a stub that dropped `action` would make the whole screen untestable.
    Panel: function Panel(p) { return React.createElement('div', { 'data-panel': p.title }, p.action, p.children); },
    DismissibleNote: function DismissibleNote(p) { return React.createElement('div', { 'data-note': p.id }, p.children); },
    Icon: Stub('Icon'),
    CheckinPicker: Stub('CheckinPicker'),
    CheckoutModal: Stub('CheckoutModal'),
    // The clearances panel is the SIBLING under test in the other file; here it is furniture.
    CheckinClearances: Stub('CheckinClearances'),
    // CheckinSessionKeys arrived 2026-09-10 with piece 3 of check-in sealing: DashCheckin now renders the
    // session-key panel beside the clearances, so every test that SLICES DashCheckin has to supply it.
    CheckinSessionKeys: Stub('CheckinSessionKeys'),
    useStewNarrow: () => false,
    todayISO: () => TODAY,
    window: {
      useStewardCheckins: () => recs,
      useStewardSafeguard: () => ({ minors, minorsKnown: true }),
      useStewardGuardians: () => guardians,
      useStewardMembers: () => ([{ pubkey: KID, name: 'Alice' }, { pubkey: KID2, name: 'Bobby' },
                                { pubkey: MUM, name: 'Mum' }, { pubkey: DAD, name: 'Dad' }]),
      useStewardServices: () => services,
      useStewardIdv: () => 1,
      useStewardConn: () => 1,
      Steward: {
        capKeyRing: () => ['ring'],
        subscribeCapKey: () => () => {},
        publishCheckin: (rec) => { written.push(rec); return Promise.resolve(publishOk ? { id: 'x' } : null); },
      },
      dispatchEvent: (e) => { blocked.push((e && e.detail) || {}); return true; },
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } },
    setTimeout, clearTimeout, console, Math, Date, JSON, Set, Number, String, Array, Promise, Object, isNaN,
  };
  const key = '__ckdesk_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const { DashCheckin } = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  let tree = draw(DashCheckin, {});
  const redraw = () => { tree = draw(DashCheckin, {}); return tree; };
  return {
    written, blocked, redraw,
    tree: () => tree,
    // Open the picker the way a leader does — by pressing the header button — then check a child in the way
    // the picker does, through the `onPick` prop the screen handed it.
    async checkIn(childPub) {
      const b = shownButton(tree, 'Check a child in');
      assert.equal(b.length, 1, 'the "Check a child in" button is not on this screen — re-anchor');
      b[0].props.onClick();
      redraw();
      const picker = shown(tree, n => n.type && n.type.name === 'CheckinPicker');
      assert.equal(picker.length, 1, 'pressing the button did not open the picker');
      assert.equal(typeof picker[0].props.onPick, 'function', 'the picker was given no onPick handler');
      await picker[0].props.onPick(childPub);
      redraw();
    },
  };
}

const SVC = { id: 'svc-abc', date: TODAY, time: '10:30', name: 'Sunday Gathering' };
const SVC2 = { id: 'svc-def', date: TODAY, time: '18:00', name: 'Evening' };

// ── THE TWO THINGS THE RELAY CANNOT WORK WITHOUT ──────────────────────────────────────────────────────────

test('THE DESK NAMES TODAY\'S SESSION ON THE RECORD IT WRITES', async () => {
  const d = await desk({ services: [SVC], guardians: { [KID]: [MUM] } });
  await d.checkIn(KID);
  assert.equal(d.written.length, 1, 'nothing was handed to publishCheckin at all');
  assert.equal(d.written[0].session, SVC.id,
    'THE SCREEN WROTE A CHECK-IN WITH NO SESSION (' + JSON.stringify(d.written[0].session) + '). ' +
    'checkinHelperOf() has nothing else to go on, so every cleared helper is refused this record and the ' +
    'whole helper capability is unreachable — item 1 of reference/SCOPE-CHECKIN-SURFACES-2026-09-09.md, ' +
    'reintroduced at the point of use while the writer\'s own tests stay green.');
  // ⚠ AND SINCE PIECE 1 THIS ARGUMENT DECIDES ONE MORE THING, recorded here because it is the coupling that
  // is easiest to break from the screen. `_encSealedCopies` derives the helper's copy from `obj.session` — no
  // session, no key lookup, no ['ck'] tag, and a cleared helper is served a record with nothing in it they
  // can open. So this single field is now the whole of what connects the desk to the second lock, and
  // deleting it from the call above breaks the sealing as well as the relay's read gate.
  //
  // reference/SCOPE-CHECKIN-SEALING-2026-09-10.md, piece 1. The sealing itself is proved in
  // scripts/checkin-key-separation.test.mjs against real NIP-44; this is the point of use.
  assert.ok(d.written[0].session,
    'the screen supplied no session, so no helper copy can be sealed for this record at all — the register ' +
    'stays readable by the church and a cleared helper gets a ciphertext they hold no key for');
});

test('THE DESK NAMES THE CHILD\'S ADULT GUARDIANS ON THE RECORD IT WRITES', async () => {
  const d = await desk({ services: [SVC], guardians: { [KID]: [MUM, DAD] } });
  await d.checkIn(KID);
  assert.deepEqual(d.written[0].guardians, [MUM, DAD],
    'the screen wrote a check-in naming no guardian, so a parent is served nothing of their own child — ' +
    'design §7 hangs the record off the GUARDIAN\'s key precisely because the child has no phone');
});

test('A CHILD WRONGLY LISTED AS ANOTHER CHILD\'S GUARDIAN IS NOT NAMED — the adult-only filter reaches the tags', async () => {
  // D2: a church that has marked both children and left one in the other's guardian list. The printed
  // pickup name already filters minors out; the ['p'] tags have to use the SAME list, or the relay would
  // serve a child their sibling's record while the screen showed a different set of adults.
  const d = await desk({ services: [SVC], guardians: { [KID]: [MUM, KID2] }, minors: [KID, KID2] });
  await d.checkIn(KID);
  assert.deepEqual(d.written[0].guardians, [MUM],
    'a person the church has MARKED AS A CHILD was named as someone who may read this record: ' +
    JSON.stringify(d.written[0].guardians));
});

test('a child with no adult guardian linked is STILL checked in, naming nobody', async () => {
  // reference/DOMAIN.md: nothing may block a child being checked in. A family whose guardian link has not
  // been confirmed yet is an ordinary Sunday.
  const d = await desk({ services: [SVC], guardians: {} });
  await d.checkIn(KID);
  assert.equal(d.written.length, 1, 'a child with no guardian linked could not be checked in at all');
  assert.deepEqual(d.written[0].guardians, [], 'a guardian was invented for a child who has none');
  assert.equal(d.written[0].session, SVC.id, 'and the session was dropped along with the guardian');
});

// ── WHICH SESSION, AND WHAT THE SCREEN SAYS WHEN THERE ISN'T ONE ──────────────────────────────────────────

test('with no service in today\'s calendar the desk still writes, and SAYS what that costs', async () => {
  const d = await desk({ services: [], guardians: { [KID]: [MUM] } });
  const said = texts(d.tree()).join(' ');
  assert.match(said, /No session in today/,
    'the screen said nothing about there being no session, so a leader has no way to know the records they ' +
    'are writing cannot be opened by a cleared helper');
  await d.checkIn(KID);
  assert.equal(d.written.length, 1, 'NO SERVICE IN THE CALENDAR BLOCKED A CHECK-IN. reference/DOMAIN.md forbids exactly this.');
  assert.equal(d.written[0].session, '', 'a session id was invented for a church that has no service today');
});

test('a service on ANOTHER day is not used as today\'s session', async () => {
  const d = await desk({ services: [{ id: 'svc-old', date: '2020-01-01', time: '10:30' }], guardians: { [KID]: [MUM] } });
  await d.checkIn(KID);
  assert.equal(d.written[0].session, '',
    'last year\'s service was stamped on today\'s record. A helper cleared for THAT session id would then ' +
    'be admitted to today\'s register.');
});

test('two services today: the leader chooses, and nothing is chosen for them', async () => {
  const d = await desk({ services: [SVC, SVC2], guardians: { [KID]: [MUM] } });
  const sel = shown(d.tree(), n => n.type === 'select' && n.props && n.props.id === 'ck-session');
  assert.equal(sel.length, 1, 'a church running two sessions today was given no way to say which one');
  await d.checkIn(KID);
  assert.equal(d.written[0].session, '',
    'one of two possible sessions was picked for the leader. Guessing here puts a child in the record of a ' +
    'room they are not in, and admits that room\'s helpers to this one.');
  sel[0].props.onChange({ target: { value: SVC2.id } });
  d.redraw();
  await d.checkIn(KID2);
  assert.equal(d.written[1].session, SVC2.id, 'the session the leader chose was not used');
});

// ── AND THE COPY THAT WOULD OTHERWISE BE FALSE ────────────────────────────────────────────────────────────

test('the intro note no longer claims only stewards can open the register', async () => {
  // Item 2 of the audit hand-off: "the only people who can open them are you and anyone you have given
  // Safeguarding to" — true until a cleared helper holds a session key, and false from the day granting
  // ships. Asserted off the RENDERED note, not off the file, for rule 3's reason.
  const d = await desk({ services: [SVC] });
  const note = shown(d.tree(), n => n.props && n.props['data-note'] === 'kids-checkin-intro');
  assert.equal(note.length, 1, 'the intro note is gone from the screen — re-anchor this test');
  const said = texts(note[0]).join(' ').replace(/\s+/g, ' ');
  assert.doesNotMatch(said, /the only people who can open them are you and anyone/,
    'the console still tells a steward that nobody but they and their safeguarding stewards can open the ' +
    'register, which stopped being true the moment a helper could be cleared');
  assert.match(said, /cleared/,
    'the note does not mention a cleared helper at all, so the audience for these records is understated');
});

// ── A WRITE THAT DID NOT HAPPEN IS STILL NOT CLAIMED ──────────────────────────────────────────────────────

test('a refused write is reported, and the extra fields did not change that', async () => {
  const d = await desk({ services: [SVC], guardians: { [KID]: [MUM] }, publishOk: false });
  await d.checkIn(KID);
  assert.equal(d.blocked.length, 1,
    'publishCheckin returned null and the screen said nothing — a child shown as present with no record ' +
    'anywhere. This guard predates this slice; it is asserted here because this change edits the same call.');
  assert.match(d.blocked[0].message, /NOT recorded/, 're-anchor: the refusal message changed shape');
});
