// THE POINT OF USE: THE KIDS TAB, ON THE REAL RENDERED SCREEN.
// Run: node --test scripts/the-kids-tab-is-only-for-a-cleared-worker.test.mjs
//
// scripts/a-cleared-worker-reads-one-sessions-register.test.mjs proves the READER: the shipped
// subscribeCheckinRegister opens one session's records and provably nothing else. That is worth nothing on its
// own — CLAUDE.md rule 1: "the child-safety fix that hides adults-only rooms from a young person had eight
// passing tests over its engine. Deleting the one line in the app that actually calls it left all 1,982 tests
// green." So this drives the SCREEN: it compiles app/screens-serving.jsx with the same esbuild the build uses,
// renders ServingScreen through the miniature React in render-jsx-screen.mjs, presses the tab, and reads the
// tree that comes back.
//
// ⚠ RULE 3: NOTHING HERE MATCHES TEXT IN app/*.jsx. Those files ship unbundled, so `false && ` in front of a
// condition leaves every word of it in place and a source match still passes. Every claim below is about a
// RENDERED tree.
//
// ⚠ reads(), NOT said(). said() joins text nodes with a space and therefore CANNOT SEE the JSX whitespace
// bug — the console shipped "whenever you openthis page" on a phone with the assertion pinning that sentence
// passing, because said() put the missing space back. reads() concatenates the way a browser does, and
// glued() is the class-wide guard: it names every junction where two pieces of copy run together.
//
// NO RELAY AND NO PORT: this file renders a component and binds nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';
import { roomCode } from './checkin-role-source.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

// ── THE TREE READERS. Copied verbatim from checkin-session-keys-are-not-issued-early.test.mjs:545-594, ─────
// which is where the house versions live and where the reason each exists is written up.
//
// said() joins with a space, which is right for "does this screen mention X anywhere" and WRONG for any claim
// about exact wording.
const said = (tree) => texts(tree).join(' ').replace(/\s+/g, ' ');
// flow()/reads() read the tree as a browser lays it out: children only (no string PROPS, so a tooltip cannot
// be glued onto the copy beside it and invent an adjacency no reader ever sees), inline elements joined with
// nothing, block elements newline-fenced.
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
// Every place two pieces of copy run together with no visible separator — the whole bug class in one guard.
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
// ONE NODE, ONCE, off the RENDERED tree only. find()/button() in render-jsx-screen.mjs also walk any prop that
// looks like a tree, so an element handed to a component as a prop and then rendered as its child is reached
// twice and is not even the same object the second time — identity dedupe cannot help. This walks kids.
function shown(n, pred, out = []) {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(c => shown(c, pred, out)); return out; }
  if (pred(n)) out.push(n);
  (n.kids || []).forEach(c => shown(c, pred, out));
  return out;
}
const shownButton = (tree, label) => shown(tree, n => n.type === 'button' && texts(n).join(' ').includes(label));

// ── THE REGISTER THE TRANSPORT WOULD HAND THE SCREEN ──────────────────────────────────────────────────────
// The exact shape Fellowship.subscribeCheckinRegister emits. Every field is asserted against the shipped
// reader in a-cleared-worker-reads-one-sessions-register.test.mjs, so these are that function's real answers
// rather than a guess at them.
const NONE = { cleared: false, lapsed: false, notYet: false, withdrawn: false, from: null, until: null, lifetime: '', sessions: [], keysHeld: 0, unreadable: 0, foreign: 0, settled: true };
const AM_FROM = 1788595200;   // 2026-09-06, a Sunday
const twoKids = [
  { id: 'ci-1', childName: 'Esther Ncube', code: '4417', session: 'svc-am' },
  { id: 'ci-2', childName: 'Amos Bello', code: '9081', session: 'svc-am' },
];
const oneSession = (rows) => [{ session: 'svc-am', roomCode: roomCode('svc-am'), roomClash: false, from: AM_FROM, until: AM_FROM + 10800, helpers: 2, rows }];

function serving(register) {
  const { React, draw } = miniReact();
  const opened = [];
  const win = {
    Fellowship: { myPubkey: 'me' },
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
    // PASSTHROUGHS, NOT STUBS. Overlay is what the whole screen is inside and SectionLabel is what a heading
    // becomes — a stub returning null would swallow the entire subtree under test and every assertion below
    // would be about an empty tree. miniReact cannot render the children of a stubbed component.
    Overlay: function Overlay(p) { return React.createElement('div', { 'data-overlay': !!p.open }, p.open ? p.children : null); },
    SectionLabel: function SectionLabel(p) { return React.createElement('h2', {}, p.children); },
    Icon: Stub('Icon'),
    IconBtn: Stub('IconBtn'),
    BottomSheet: ({ open, children }) => (open ? children : null),
    // Furniture on other tabs.
    CareCard: Stub('CareCard'),
    SafetyBanner: Stub('SafetyBanner'),
    safeCssColor: (c) => c,
    Math, Date, JSON, Set, Number, String, Array, Promise, Object, isNaN, Boolean,
  };
  const mod = loadScreen('app/screens-serving.jsx', ['ServingScreen', 'KidsRegister'], globals);
  const ctx = {
    church: { name: 'St Chad’s, Falgate' },
    myPubkey: 'me',
    checkinRegister: register,
    rotaVis: 'church',
    churchRosters: [], churchEvents: [], churchServices: [], churchRotas: [], churchTeams: [],
    servPending: [], servConfirmed: [], servDeclined: [], myRsvps: {},
    care: { settings: { enabled: false }, needs: [], slots: [], myPub: 'me' },
    joinState: { isAdmitted: true },
    // ⚠ THE HELP DEEP LINK, CAPTURED RATHER THAN STUBBED AWAY. The member app's help button is
    // ctx.openHelp('<articleId>'), and HelpArticleView does `if (!a) return null` on an id it cannot find —
    // which is live today for ctx.openHelp('wallet') in screens-giving.jsx, a header and a back button over a
    // blank page. The test at the foot of this file resolves whatever id the screen asks for against the real
    // article list.
    openHelp: (id) => opened.push(id),
    toast() {},
    // slice B: capture what the check-in form hands the transport, and let a test choose the verdict.
    checkinAdd: async (rec) => { checkinCalls.push(rec); return checkinResult.v; },
    // slice C: capture what the checkout hands the transport.
    checkinRelease: async (rec) => { releaseCalls.push(rec); return releaseResult.v; },
  };
  const checkinCalls = [];
  const checkinResult = { v: { ok: true, id: 'ci-new' } };
  const releaseCalls = [];
  const releaseResult = { v: { ok: true, id: 'cr-new' } };
  const render = () => draw(mod.ServingScreen, { open: true, onClose() {}, ctx });
  render();                                  // the first draw queues the tab-strip effects…
  let tree = render();                       // …the second sees what they settled on
  return {
    mod, ctx, opened,
    checkinCalls,
    releaseCalls,
    setCheckinResult(v) { checkinResult.v = v; },
    setReleaseResult(v) { releaseResult.v = v; },
    // Type into an input on the rendered tree, found by its aria-label, and redraw.
    type(label, value) {
      const inputs = shown(tree, n => n.type === 'input' && n.props && n.props['aria-label'] === label);
      assert.equal(inputs.length, 1, 'expected one input labelled ' + JSON.stringify(label) + ', found ' + inputs.length);
      inputs[0].props.onChange({ target: { value } });
      return this.redraw();
    },
    // Click a button by label, then flush microtasks (the submit is async) and redraw.
    async click(label) {
      const b = shownButton(tree, label);
      assert.equal(b.length, 1, 'expected one control reading ' + JSON.stringify(label) + ', found ' + b.length);
      b[0].props.onClick();
      for (let i = 0; i < 5; i++) await Promise.resolve();
      return this.redraw();
    },
    tree: () => tree,
    redraw() { tree = render(); return tree; },
    press(label) {
      const b = shownButton(tree, label);
      assert.equal(b.length, 1, 'expected exactly one control reading ' + JSON.stringify(label) + ' on this screen, found ' + b.length + ' — re-anchor this test');
      b[0].props.onClick();
      return this.redraw();
    },
    has(label) { return shownButton(tree, label).length; },
    // The Kids pane, as a component actually mounted in the tree.
    pane() { return shown(tree, n => typeof n.type === 'function' && n.type.name === 'KidsRegister'); },
    reads: () => reads(tree),
    said: () => said(tree),
    glued: () => glued(tree),
  };
}
// The tab strip's labels, off the rendered tree. Every tab button carries an <Icon> and a text label; the
// strip is the only place a button sits directly inside the scrolling row, so this reads the row's children.
function tabLabels(tree) {
  const strip = shown(tree, n => n.props && n.props.className === 'no-scrollbar' && n.props.style && n.props.style.overflowX === 'auto');
  assert.equal(strip.length, 1, 're-anchor: the tab strip is no longer the one horizontally-scrolling row on this screen');
  return shown(strip[0], n => n.type === 'button').map(b => reads(b).trim()).filter(Boolean);
}

// ══════════════ THE POINT OF USE ══════════════

test('POINT OF USE: a cleared worker gets a Kids tab, and it renders the register', () => {
  const s = serving({ ...NONE, cleared: true, keysHeld: 1, from: AM_FROM, until: AM_FROM + 10800, sessions: oneSession(twoKids) });
  assert.ok(tabLabels(s.tree()).includes('Kids'),
    'THE KIDS TAB IS NOT ON THE SCREEN. A cleared worker holding this session\'s key has no route to the ' +
    'register at all — which is the whole feature deleted, with the reader underneath it still fully tested. ' +
    'Tabs rendered: ' + JSON.stringify(tabLabels(s.tree())));
  s.press('Kids');
  assert.equal(s.pane().length, 1,
    'pressing Kids did not mount the register — the tab exists and leads nowhere, which is the dead end a ' +
    'parent persona was measured NOT finding anywhere in this app on 2026-09-10');
  const out = s.reads();
  assert.match(out, /Esther Ncube/, 'the register does not name the children who are checked in. As rendered: ' + out);
  assert.match(out, /Amos Bello/, 'only one of the two children reached the screen');
  assert.match(out, /2 checked in/, 'the session card does not say how many children are in the room. As rendered: ' + out);
  assert.deepEqual(s.glued(), [],
    'two pieces of copy run together with no space between them — the JSX newline trap that shipped ' +
    '"whenever you openthis page" to a phone: ' + JSON.stringify(s.glued()));
});

test('POINT OF USE: the room code is shown OPENLY on the session card — it names the session and admits nobody', () => {
  // Slice A. Unlike a pickup code (covered until asked for, because it releases a child), the room code
  // carries no authority: it is a digest of the session id and a worker reads it aloud or matches it to the
  // printed sheet. It must be ON THE SCREEN, or the numeric presentation of the identifier is the feature
  // deleted with the derivation underneath it still tested.
  const s = serving({ ...NONE, cleared: true, keysHeld: 1, from: AM_FROM, until: AM_FROM + 10800, sessions: oneSession(twoKids) });
  s.press('Kids');
  const out = s.reads();
  assert.ok(out.includes(roomCode('svc-am')),
    'THE ROOM CODE IS NOT ON THE SESSION CARD. A worker has no number to read to a parent or match to the ' +
    'printed sheet. Expected ' + JSON.stringify(roomCode('svc-am')) + ' — as rendered: ' + out);
  assert.match(out, /Room code/i, 'the code is on the screen but nothing labels it as the room code');
  // AND IT IS NOT TREATED AS A SECRET. There is no "Show code" control for it — that pattern is the pickup
  // code's alone. The two "Show code" buttons are the two children's pickup codes, not the room code.
  assert.equal(s.has('Show code'), 2, 'the room code grew a reveal control, or a pickup code lost one');
  assert.deepEqual(s.glued(), [], 'copy runs together on the card: ' + JSON.stringify(s.glued()));
});

test('POINT OF USE: a live worker can CHECK A CHILD IN, and it hands the record to the transport', async () => {
  // Slice B, the write half. The button, the name, and the call are all on the SCREEN — a well-tested
  // writer nobody is required to consult is not a feature (rule 1).
  const s = serving({ ...NONE, cleared: true, keysHeld: 1, from: AM_FROM, until: AM_FROM + 10800, sessions: oneSession([]) });
  s.press('Kids');
  assert.equal(s.has('Check a child in'), 1,
    'THERE IS NO WAY TO CHECK A CHILD IN. A live worker holding this session\'s key has the register and no ' +
    'door — the whole write half deleted from the screen.');
  s.type('Child’s name', 'Ada Okonkwo');
  await s.click('Check a child in');
  assert.equal(s.checkinCalls.length, 1, 'pressing the button wrote nothing to the transport');
  assert.equal(s.checkinCalls[0].session, 'svc-am', 'the check-in was not tied to THIS session — a record with the wrong session opens for the wrong room');
  assert.equal(s.checkinCalls[0].childName, 'Ada Okonkwo', 'the child\'s name did not reach the writer');
  assert.match(String(s.checkinCalls[0].code || ''), /^\d{4}$/, 'no pickup code was carried — the door has nothing to match at collection');
});

test('…and a check-in that the relay REFUSES fails LOUD — the child is not shown as checked in', async () => {
  // Design §8: fail LOUDLY at the moment of check-in rather than accept it optimistically. A parent who
  // believes their child is registered when the room does not is worse than an honest refusal.
  const s = serving({ ...NONE, cleared: true, keysHeld: 1, from: AM_FROM, until: AM_FROM + 10800, sessions: oneSession([]) });
  s.press('Kids');
  s.setCheckinResult({ ok: false, reason: 'publish-failed' });
  s.type('Child’s name', 'Ada Okonkwo');
  await s.click('Check a child in');
  const out = s.reads();
  assert.match(out, /did not save|see the desk/i,
    'A CHECK-IN THAT DID NOT SAVE SAID NOTHING. The worker walks away believing the child is registered ' +
    'when the room does not hold them. As rendered: ' + out);
  // The name is NOT cleared on failure, so she can retry without retyping.
  const nameInput = shown(s.tree(), n => n.type === 'input' && n.props && n.props['aria-label'] === 'Child’s name');
  assert.equal(nameInput[0].props.value, 'Ada Okonkwo', 'the form cleared on a FAILED save, so she must retype to retry');
});

test('…and the check-in form is NOT offered on a clearance that has ended — the register still shows', () => {
  // DOMAIN.md: say a key has expired, do not lock someone out mid-session. The register stays visible on a
  // lapsed key, but a new write would be refused by the relay, so the door is not offered.
  const s = serving({ ...NONE, cleared: false, lapsed: true, keysHeld: 1, until: AM_FROM + 10800, sessions: oneSession(twoKids) });
  s.press('Kids');
  assert.equal(s.pane().length, 1, 'the register vanished on a lapsed clearance');
  assert.equal(s.has('Check a child in'), 0,
    'a check-in form was offered on a clearance that has ended — every write would be refused LOUD, which is a worse experience than not offering it');
});

// One child, so there is exactly one "Check out" control to drive.
const oneKid = [{ id: 'ci-1', childName: 'Esther Ncube', code: '4417', session: 'svc-am' }];

test('POINT OF USE: a matching pickup code RELEASES the child — a separate release document, not a rewrite', async () => {
  const s = serving({ ...NONE, cleared: true, keysHeld: 1, from: AM_FROM, until: AM_FROM + 10800, sessions: oneSession(oneKid) });
  s.press('Kids');
  assert.equal(s.has('Check out'), 1, 'THERE IS NO WAY TO COLLECT A CHILD — the checkout half is gone from the screen');
  await s.click('Check out');
  s.type('Enter the pickup code for Esther Ncube', '4417');
  await s.click('Confirm');
  assert.equal(s.releaseCalls.length, 1, 'a matching code did not release the child');
  assert.equal(s.releaseCalls[0].rel, 'ci-1', 'the release does not name the check-in it collects — the reader cannot fold it');
  assert.equal(s.releaseCalls[0].session, 'svc-am', 'the release is not tied to the child\'s session');
  assert.equal(s.releaseCalls[0].manual, false, 'a code-matched release was recorded as by-hand');
});

// ── POINT OF USE FOR THE ONE LINE OF APP CODE STEP 2 ADDED TO THIS SCREEN ────────────────────────────────
// An audit found it untested on 2026-09-11: removing `guardians: rec.guardians` from KidsRow's call to
// ctx.checkinRelease reddened NOTHING across eight test files, and the only mention of KidsRow anywhere in
// scripts/ was a comment. That argument is worth more than the line: without those guardians the release
// carries no ['p'] tag and no ['gk'] copy, the relay serves it to nobody in the family, and A PARENT'S
// SCREEN SHOWS THEIR CHILD PRESENT FOR EVER — a guardian is never served a tombstone, and a worker's
// checkout is a separate document rather than an edit of the check-in (F-B), so a release they can read is
// the ONLY thing that can ever change that row.
//
// ⚠ RULE 3: this asserts on the OBJECT THE SCREEN HANDED ctx.checkinRelease, off a rendered tree and a real
// click — never on the text of app/screens-serving.jsx, which ships unbundled.
const ONE_GUARDIAN = 'a1'.repeat(32), TWO_GUARDIAN = 'b2'.repeat(32);
const guardedKid = [{ id: 'ci-1', childName: 'Esther Ncube', code: '4417', session: 'svc-am',
                      guardians: [ONE_GUARDIAN, TWO_GUARDIAN] }];

test('POINT OF USE: a checkout carries the child\'s GUARDIANS, or no parent ever learns they were collected', async () => {
  const s = serving({ ...NONE, cleared: true, keysHeld: 1, from: AM_FROM, until: AM_FROM + 10800, sessions: oneSession(guardedKid) });
  s.press('Kids');
  await s.click('Check out');
  s.type('Enter the pickup code for Esther Ncube', '4417');
  await s.click('Confirm');
  assert.equal(s.releaseCalls.length, 1, 're-anchor: the matching code released nobody, so the assertion below is vacuous');
  assert.deepEqual(s.releaseCalls[0].guardians, [ONE_GUARDIAN, TWO_GUARDIAN],
    'THE CHECKOUT CARRIES NO GUARDIANS. releaseCheckin derives both the [\'p\'] tag the relay serves this ' +
    'release on and the [\'gk\'] copy the parent opens from exactly this field; dropped here, a collected ' +
    'child reads as present on their own parent\'s phone for the rest of the day and for ever after.');
});

test('…and a BY-HAND release carries them too — §7: visible to the guardian afterwards', async () => {
  // The one release a parent most needs to see, because it is the one that happened WITHOUT their code.
  const s = serving({ ...NONE, cleared: true, keysHeld: 1, from: AM_FROM, until: AM_FROM + 10800, sessions: oneSession(guardedKid) });
  s.press('Kids');
  await s.click('Check out');
  await s.click('By hand');
  assert.equal(s.releaseCalls.length, 1, 're-anchor: the by-hand control recorded nothing');
  assert.deepEqual(s.releaseCalls[0].guardians, [ONE_GUARDIAN, TWO_GUARDIAN],
    'A BY-HAND RELEASE REACHED NO GUARDIAN. Design §7 requires a manual release to be "visible to the ' +
    'guardian afterwards, so a parent can see their child was collected without their code" — which needs ' +
    'this field and nothing else.');
});

test('…and a child whose copy names no guardian is still checked out, never blocked', async () => {
  // reference/DOMAIN.md and design §10: the family with no app is the ordinary Sunday, and nothing in this
  // feature may stand between a child and going home.
  const s = serving({ ...NONE, cleared: true, keysHeld: 1, from: AM_FROM, until: AM_FROM + 10800, sessions: oneSession(oneKid) });
  s.press('Kids');
  await s.click('Check out');
  await s.click('By hand');
  assert.equal(s.releaseCalls.length, 1,
    'A CHILD WITH NO GUARDIAN ON THEIR RECORD COULD NOT BE CHECKED OUT. Most families have no app; this is ' +
    'the ordinary case, not an edge one.');
  assert.equal(s.releaseCalls[0].rel, 'ci-1');
});

test('…and a WRONG code is LOUD and releases NOBODY (§6 rule 5)', async () => {
  const s = serving({ ...NONE, cleared: true, keysHeld: 1, from: AM_FROM, until: AM_FROM + 10800, sessions: oneSession(oneKid) });
  s.press('Kids');
  await s.click('Check out');
  s.type('Enter the pickup code for Esther Ncube', '0000');
  await s.click('Confirm');
  assert.equal(s.releaseCalls.length, 0,
    'A CHILD WAS RELEASED ON A CODE THAT DID NOT MATCH. This is the wrong-adult case the pickup code exists to prevent.');
  assert.match(s.reads(), /does not match|not released/i, 'a failed match said nothing — §6 rule 5: a failed match must be LOUD. As rendered: ' + s.reads());
});

test('…and RELEASE BY HAND records a manual collection distinctly, with no code', async () => {
  const s = serving({ ...NONE, cleared: true, keysHeld: 1, from: AM_FROM, until: AM_FROM + 10800, sessions: oneSession(oneKid) });
  s.press('Kids');
  await s.click('Check out');
  await s.click('By hand');
  assert.equal(s.releaseCalls.length, 1, 'a dead-phone / grandparent collection could not be recorded — the fallback §7 requires is missing');
  assert.equal(s.releaseCalls[0].manual, true,
    'the manual release was not marked manual — §7: it must be recorded DISTINCTLY, or the register cannot tell it from a code collection');
  assert.equal(s.releaseCalls[0].rel, 'ci-1', 'the manual release does not name the child');
});

test('…and an already-collected child offers no Collect control', () => {
  const s = serving({ ...NONE, cleared: true, keysHeld: 1, sessions: oneSession([{ id: 'ci-1', childName: 'Esther Ncube', code: '4417', session: 'svc-am', out: AM_FROM + 5400 }]) });
  s.press('Kids');
  assert.equal(s.has('Check out'), 0, 'a child already collected still offered a Collect button — a double release');
  assert.match(s.reads(), /Collected/, 'the collected child is not shown as collected');
});

test('…and a pickup code is COVERED until it is asked for, one at a time', () => {
  const s = serving({ ...NONE, cleared: true, keysHeld: 1, sessions: oneSession(twoKids) });
  s.press('Kids');
  assert.equal(s.reads().includes('4417'), false,
    'A PICKUP CODE IS PAINTED ON THE SCREEN UNCOVERED. It is the value that releases a child, and this is a ' +
    'phone in a room full of people. As rendered: ' + s.reads());
  assert.equal(s.reads().includes('9081'), false, 'the second child\'s code is uncovered too');
  assert.equal(s.has('Show code'), 2, 'there is no way to see a pickup code at all — the door cannot work');

  // Reveal the first. ONE TAP, no confirmation, nothing to fail: DOMAIN.md's "do not block".
  const buttons = shown(s.tree(), n => n.type === 'button' && texts(n).join(' ').includes('Show code'));
  buttons[0].props.onClick();
  s.redraw();
  const one = s.reads();
  assert.ok(one.includes('4417') !== one.includes('9081'),
    'revealing one code showed both, or neither. Exactly one code may be uncovered at a time. As rendered: ' + one);
  assert.equal(s.has('Show code'), 1, 'the revealed row still offers to show a code it is already showing');

  // …and revealing the other COVERS the first.
  const rest = shown(s.tree(), n => n.type === 'button' && texts(n).join(' ').includes('Show code'));
  rest[0].props.onClick();
  s.redraw();
  const two = s.reads();
  assert.ok(two.includes('4417') !== two.includes('9081'),
    'BOTH PICKUP CODES ARE NOW ON SCREEN AT ONCE. Revealing one must cover the last. As rendered: ' + two);
});

test('a collected child reads as a TIME, not an epoch, and is not counted as in the room', () => {
  // Measured on the Oppo, 2026-09-11: the console said "out 12:55 AM"; the phone said "Collected · 1789084514"
  // under a header that still read "1 checked in" with nobody in the room.
  const OUT = 1789084514;
  const gone = { id: 'ci-3', childName: 'Tomi Adeyemi', code: '2210', session: 'svc-am', in: OUT - 3600, out: OUT };
  const s = serving({ ...NONE, cleared: true, keysHeld: 1, sessions: oneSession([...twoKids, gone]) });
  s.press('Kids');
  const out = s.reads();
  assert.doesNotMatch(out, /1789084514/, 'the collection time is painted as a raw epoch. As rendered: ' + out);
  const clock = new Date(OUT * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  assert.match(out, new RegExp('Collected · ' + clock.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'a collected child must say when, in the same clock the console shows ("' + clock + '"). As rendered: ' + out);
  assert.match(out, /2 checked in · 1 collected/,
    'the header counts a collected child as in the room, or does not say a child has gone. As rendered: ' + out);
  assert.doesNotMatch(out, /3 checked in/, 'three children are counted as present when one has been collected');
});

// ══════════════ THE NEGATIVES ══════════════

test('NEGATIVE: somebody the church has not cleared has no Kids tab and no register', () => {
  // EVERYTHING ELSE ON THIS SCREEN WORKS. The overlay is open, the church is named, the other tabs render —
  // so this is testing the gate rather than an incidental error that would blank the screen anyway.
  const s = serving({ ...NONE });
  const tabs = tabLabels(s.tree());
  assert.ok(tabs.includes('Serving'), 're-anchor: this screen renders no tabs at all, so the absence below is not about clearance');
  assert.equal(tabs.includes('Kids'), false,
    'THE KIDS TAB IS OFFERED TO THE WHOLE CONGREGATION. Tabs rendered: ' + JSON.stringify(tabs));
  assert.equal(s.pane().length, 0, 'the register mounted for somebody with no clearance');
  const out = s.said();   // said() here on purpose: the widest possible net for "is this mentioned ANYWHERE"
  assert.doesNotMatch(out, /check-in/i, 'check-in is named on the screen of somebody the church has not cleared');
  assert.doesNotMatch(out, /pickup|Show code|checked in/i, 'the register\'s own wording reached an uncleared member');
});

test('NEGATIVE: cleared with no key says nothing is wrong — it does not say the register is empty', () => {
  const s = serving({ ...NONE, cleared: true, keysHeld: 0, from: AM_FROM, until: AM_FROM + 10800 });
  assert.ok(tabLabels(s.tree()).includes('Kids'), 'a cleared worker has no way to find out that no key has reached her phone');
  s.press('Kids');
  const out = s.reads();
  assert.match(out, /room isn’t ready yet\./,
    'the commonest state in this whole feature — cleared, and a console has never issued a key — has no ' +
    'honest wording. As rendered: ' + out);
  assert.match(out, /nothing for you to do/i,
    '"no keys" is stated as a fault. It is not one: a church whose console stays shut has cleared helpers ' +
    'holding no keys, for any Sunday, ever. As rendered: ' + out);
  assert.doesNotMatch(out, /Nobody has been checked in/,
    '"NO KEY HAS REACHED THIS PHONE" IS BEING SHOWN AS "NOBODY IS HERE". Those are different facts and the ' +
    'second one is a leader standing in a room full of children reading an empty list.');
  assert.deepEqual(s.glued(), [], JSON.stringify(s.glued()));
});

test('NEGATIVE: served ciphertext this phone cannot open says the register is NOT empty', () => {
  const s = serving({ ...NONE, cleared: true, keysHeld: 1, unreadable: 3, sessions: oneSession([]) });
  s.press('Kids');
  const out = s.reads();
  assert.match(out, /3 children are checked in that you can’t see\./,
    '"refused" and "served but unreadable" are different failures and look nothing like each other from a ' +
    'phone — and this one has no wording at all. As rendered: ' + out);
  assert.match(out, /The list isn’t empty\./,
    'the one thing a worker must be told here is missing: there ARE children checked in and this phone ' +
    'cannot show them. As rendered: ' + out);
  assert.deepEqual(s.glued(), [], JSON.stringify(s.glued()));
});

test('NEGATIVE: records from a session this phone holds no key for are counted, never listed', () => {
  const s = serving({ ...NONE, cleared: true, keysHeld: 1, foreign: 2, sessions: oneSession([]) });
  s.press('Kids');
  const out = s.reads();
  assert.match(out, /2 children are in another room\./,
    'a worker is shown nothing and told nothing about records that arrived for a session she holds no key ' +
    'for. As rendered: ' + out);
  assert.match(out, /You don’t have access to that one\./, 'the reason is not on the screen. As rendered: ' + out);
  // AND NOT ONE NAME OR CODE OUT OF THEM. The transport never opens them; this is the screen's half of the
  // same promise, so a later change that started passing foreign rows through has somewhere to fail.
  assert.doesNotMatch(out, /Esther|Amos|4417|9081/, 'a name or a pickup code from another session reached the screen');
  assert.equal(s.has('Show code'), 0, 'another session\'s records were given pickup-code controls');
});

test('NEGATIVE: a clearance that starts NEXT Sunday has not "ended"', () => {
  // The console shipped exactly this as a binary on 2026-09-10 and a churchwarden sim was told four separate
  // times that a clearance she had just granted for a future date had already ended.
  const s = serving({ ...NONE, notYet: true, from: AM_FROM + 604800, until: AM_FROM + 615600 });
  assert.ok(tabLabels(s.tree()).includes('Kids'), 'a worker cleared for next Sunday cannot see that she has been cleared');
  s.press('Kids');
  const out = s.reads();
  assert.match(out, /Your clearance starts/, 'a future clearance is not named as future. As rendered: ' + out);
  assert.doesNotMatch(out, /ended|Ended/,
    'A CLEARANCE GRANTED FOR NEXT SUNDAY IS BEING REPORTED AS ENDED. As rendered: ' + out);
  assert.deepEqual(s.glued(), [], JSON.stringify(s.glued()));
});

test('NEGATIVE: a lapsed clearance says so and does NOT take the register off the screen', () => {
  // reference/DOMAIN.md: "say a key has expired, do not lock someone out of a room mid-session."
  const s = serving({ ...NONE, lapsed: true, keysHeld: 1, from: AM_FROM - 604800, until: AM_FROM - 3600, sessions: oneSession(twoKids) });
  assert.ok(tabLabels(s.tree()).includes('Kids'),
    'THE TAB VANISHED MID-SESSION. A worker whose clearance ran out while she was standing at the door lost ' +
    'the register off her screen, which is precisely the block DOMAIN.md forbids');
  s.press('Kids');
  const out = s.reads();
  assert.match(out, /Your clearance ended/, 'an expired clearance is silent. As rendered: ' + out);
  assert.match(out, /Esther Ncube/,
    'the register was taken off the screen because a clearance lapsed. The app says a key has expired; it ' +
    'does not lock somebody out of a room mid-session');
  assert.equal(s.has('Show code'), 2, 'the pickup codes became unreachable, so the door stopped working');
});

test('NEGATIVE: a WITHDRAWN clearance says so — and, the phone now emptied, says the register is gone', () => {
  // Device finding D3, 2026-09-11: the Oppo showed the register, unremarked, through a resume and a cold
  // start after the church had withdrawn the clearance. Owner's decision the same day: the reader EMPTIES the
  // phone, so the ordinary shape of this state is withdrawn:true with nothing held — and the tab must not
  // simply vanish, or the worker reads it as the app breaking.
  const gone = serving({ ...NONE, withdrawn: true, keysHeld: 0, sessions: [] });
  assert.ok(tabLabels(gone.tree()).includes('Kids'), 'THE TAB VANISHED on withdrawal — nothing tells the worker what happened');
  gone.press('Kids');
  const g = gone.reads();
  assert.match(g, /ended your access/i, 'the withdrawal is not said. As rendered: ' + g);
  assert.match(g, /cleared from this phone/i, 'the line does not say the register was removed. As rendered: ' + g);
  assert.doesNotMatch(g, /Show code|checked in/i, 'register wording remains on an emptied phone');
  // and the raced-in shape — something still held — is listed, and the copy says so
  const s = serving({ ...NONE, withdrawn: true, keysHeld: 1, sessions: oneSession(twoKids) });
  s.press('Kids');
  const out = s.reads();
  assert.match(out, /ended your access/i, 'As rendered: ' + out);
  assert.match(out, /still held/i, 'the line does not say that what is shown is what the phone still had');
  assert.match(out, /Esther Ncube/, 'a record still held was hidden rather than listed');
  // and somebody never cleared, holding a key by the cold-start race, is told nothing of the kind
  const n = serving({ ...NONE, keysHeld: 1, sessions: oneSession(twoKids) });
  n.press('Kids');
  assert.doesNotMatch(n.reads(), /withdrawn/i, '"withdrawn" is said to a phone that has never seen a clearance');
});

test('NEGATIVE: a lapsed clearance with NO keys shows nothing at all', () => {
  // There is neither anything to read nor anything to do, and a tab reading "ended in June" for the rest of
  // the year is the clutter the copy cull of 2026-09-10 was about.
  const s = serving({ ...NONE, lapsed: true, keysHeld: 0, from: AM_FROM - 604800, until: AM_FROM - 3600 });
  assert.equal(tabLabels(s.tree()).includes('Kids'), false,
    'a spent clearance with no key left a permanent dead-end tab on the screen: ' + JSON.stringify(tabLabels(s.tree())));
});

// ══════════════ THE COPY DISCIPLINE ══════════════

test('every state offers the help article, and the id resolves to a real one', () => {
  // ⚠ THE FAILURE THIS GUARDS. HelpArticleView does `if (!a) return null` on an id it cannot find, so a typo
  // gives a worker a header, a back button and a blank page. That is LIVE today: screens-giving.jsx calls
  // ctx.openHelp('wallet') and there is no article with that id. Read out of app/help-data.jsx as DATA — the
  // article list is a plain object literal, not a claim about behaviour, so rule 3 does not apply.
  const HELP = readFileSync(ROOT + 'app/help-data.jsx', 'utf8');
  const ids = [...HELP.matchAll(/^\s{6}id: '([^']+)',$/gm)].map(m => m[1]);
  assert.ok(ids.length > 15, 're-anchor: the help article list is no longer shaped this way (found ' + ids.length + ' ids)');

  for (const [name, register] of [
    ['no keys', { ...NONE, cleared: true, keysHeld: 0 }],
    ['unreadable', { ...NONE, cleared: true, keysHeld: 1, unreadable: 1, sessions: oneSession([]) }],
    ['another session', { ...NONE, cleared: true, keysHeld: 1, foreign: 1, sessions: oneSession([]) }],
    ['not yet', { ...NONE, notYet: true, from: AM_FROM + 604800 }],
    ['lapsed', { ...NONE, lapsed: true, keysHeld: 1, until: AM_FROM - 3600, sessions: oneSession([]) }],
  ]) {
    const s = serving(register);
    s.press('Kids');
    assert.ok(s.has('How check-in works'),
      'the "' + name + '" state carries no help link, so the detail cut out of the copy has nowhere to live');
    s.press('How check-in works');
    assert.equal(s.opened.length, 1, 'the help link on the "' + name + '" state opened nothing');
    assert.ok(ids.includes(s.opened[0]),
      'the help link asks for article ' + JSON.stringify(s.opened[0]) + ', which app/help-data.jsx does not ' +
      'have — a worker taps it and gets a blank page with a back button. Known ids: ' + JSON.stringify(ids));
  }
});

test('the register never claims a child cannot be checked in', () => {
  // reference/DOMAIN.md, the framing this whole slice sits under: "a ratio outside policy, a helper whose
  // clearance has lapsed, a rota with a gap — none of these may stop a child being checked in." This view is
  // read-only, so what it owes is that no state it can reach implies otherwise.
  for (const register of [
    { ...NONE, cleared: true, keysHeld: 0 },
    { ...NONE, cleared: true, keysHeld: 1, unreadable: 2, sessions: oneSession([]) },
    { ...NONE, cleared: true, keysHeld: 1, foreign: 2, sessions: oneSession([]) },
    { ...NONE, notYet: true, from: AM_FROM + 604800 },
    { ...NONE, lapsed: true, keysHeld: 1, until: AM_FROM - 3600, sessions: oneSession(twoKids) },
  ]) {
    const s = serving(register);
    s.press('Kids');
    const out = s.said();
    assert.doesNotMatch(out, /cannot be checked in|can’t be checked in|can't be checked in|not allowed|refused|blocked|denied/i,
      'a state on this read-only screen reads as though the app had stopped somebody working the door. As ' +
      'rendered: ' + out);
  }
});

// ══════════════ THE PARENT'S ARRIVAL, ON THE WORKER'S SCREEN ══════════════
// STEP 1 of the parent surface, 2026-09-11. A parent NEVER authors a register row (the relay half is
// scripts/a-parent-writes-an-arrival-never-a-register-row.test.mjs); she writes an ARRIVAL, and the worker's
// phone turns it into the row. Everything below is about the SECOND half of that sentence, on the rendered
// screen, because a gate nobody's screen consults is not a feature (rule 1).

const SARAH = 'aa'.repeat(32);   // a parent's pubkey, in the one spelling the relay stores
const OMAR = 'bb'.repeat(32);    // a second parent, at the door at the same moment — the measured risk
// The exact shape Fellowship.subscribeCheckinRegister emits for a session, now carrying its arrivals queue.
const withArrivals = (rows, arrivals) => [{ session: 'svc-am', roomCode: roomCode('svc-am'), roomClash: false, from: AM_FROM, until: AM_FROM + 10800, helpers: 2, rows, arrivals }];
const live = (sessions) => ({ ...NONE, cleared: true, keysHeld: 1, from: AM_FROM, until: AM_FROM + 10800, sessions });

test('POINT OF USE: an arrival appears on the worker\'s screen as a queue', async () => {
  const s = serving(live(withArrivals([], [{ pub: SARAH, name: 'Sarah Henderson', at: AM_FROM + 60, checkedIn: 0 }])));
  s.press('Kids');
  const out = s.reads();
  assert.match(out, /Sarah Henderson has arrived/,
    'THE ARRIVAL IS NOT ON THE SCREEN. A parent announced herself at the room door and the worker\'s phone ' +
    'shows nothing — the whole queue deleted from the screen with the reader underneath it still tested. ' +
    'As rendered: ' + out);
  assert.deepEqual(s.glued(), [], 'copy runs together in the queue: ' + JSON.stringify(s.glued()));
});

test('POINT OF USE: checking in FROM an arrival must CONFIRM A NAMED PAIRING — never a bare tap', async () => {
  // ⚠ THE MITIGATION. The measured risk from the review that settled this design: two parents arrive at once,
  // the worker taps the wrong queue row, and a child\'s name and PICKUP CODE — the value that releases them —
  // go to the wrong family. Deleting the confirmation FROM THIS SCREEN is what this test exists to redden.
  const s = serving(live(withArrivals([], [
    { pub: SARAH, name: 'Sarah Henderson', at: AM_FROM + 60, checkedIn: 0 },
    { pub: OMAR, name: 'Omar Haddad', at: AM_FROM + 70, checkedIn: 0 },
  ])));
  s.press('Kids');
  await s.click('Sarah Henderson');
  s.type('Child’s name', 'Milo');
  await s.click('Check a child in');
  // NOTHING IS WRITTEN YET. This is the assertion that fails if the confirmation is removed and `submit`
  // writes straight through.
  assert.equal(s.checkinCalls.length, 0,
    'A CHILD WAS CHECKED IN AGAINST A PARENT ON ONE TAP, with no confirmation. Two parents are at the door in ' +
    'this very test; a mis-tap hands the second family the first family\'s pickup code.');
  const out = s.reads();
  assert.match(out, /Milo → Sarah Henderson\?/,
    'THE CONFIRMATION DOES NOT NAME THE PAIRING. A prompt that does not say BOTH names is not a check on a ' +
    'mis-tap — the worker is confirming the thing she just got wrong. As rendered: ' + out);
  // …and the OTHER parent is not the one named.
  assert.doesNotMatch(out, /Milo → Omar Haddad/, 'the confirmation named the wrong parent');
  // THE AFFIRMATIVE ACT, and only then the write.
  await s.click('Yes, check in');
  assert.equal(s.checkinCalls.length, 1, 'confirming the pairing wrote nothing — the door is now a dead end');
  assert.equal(s.checkinCalls[0].childName, 'Milo', 'the child\'s name did not reach the writer');
  assert.equal(s.checkinCalls[0].session, 'svc-am', 'the record was not tied to this session');
  assert.equal(s.checkinCalls[0].guardian, SARAH,
    'THE RECORD NAMES THE WRONG GUARDIAN, OR NONE. It must carry exactly the pubkey the SIGNED arrival ' +
    'delivered — a worker\'s phone holds no guardian map and may never guess. Got: ' + JSON.stringify(s.checkinCalls[0].guardian));
  assert.deepEqual(s.glued(), [], 'copy runs together on the confirmation: ' + JSON.stringify(s.glued()));
});

test('…and the SECOND parent in the queue is the one named when she is the one picked', async () => {
  // The mis-tap this guards is a mis-tap between TWO rows, so one row proves nothing about which row was read.
  const s = serving(live(withArrivals([], [
    { pub: SARAH, name: 'Sarah Henderson', at: AM_FROM + 60, checkedIn: 0 },
    { pub: OMAR, name: 'Omar Haddad', at: AM_FROM + 70, checkedIn: 0 },
  ])));
  s.press('Kids');
  await s.click('Omar Haddad');
  s.type('Child’s name', 'Yara');
  await s.click('Check a child in');
  assert.match(s.reads(), /Yara → Omar Haddad\?/, 'picking the second arrival confirmed the first. As rendered: ' + s.reads());
  await s.click('Yes, check in');
  assert.equal(s.checkinCalls[0].guardian, OMAR, 'the record p-tags the parent who was NOT picked');
});

test('…and answering NO writes nothing at all', async () => {
  const s = serving(live(withArrivals([], [{ pub: SARAH, name: 'Sarah Henderson', at: AM_FROM + 60, checkedIn: 0 }])));
  s.press('Kids');
  await s.click('Sarah Henderson');
  s.type('Child’s name', 'Milo');
  await s.click('Check a child in');
  await s.click('No, go back');
  assert.equal(s.checkinCalls.length, 0, 'declining the confirmation checked the child in anyway — the answer is not read');
  assert.doesNotMatch(s.reads(), /Milo → Sarah Henderson\?/, 'the confirmation stayed on screen after it was declined');
});

test('…and a check-in with NO arrival is UNCHANGED — one tap, no confirmation, and no guardian guessed', async () => {
  // design §10 and reference/DOMAIN.md: nothing in this feature blocks a child reaching the room. A family
  // with no app, a flat battery, a grandparent at the desk — all still one tap, exactly as before today.
  const s = serving(live(withArrivals([], [{ pub: SARAH, name: 'Sarah Henderson', at: AM_FROM + 60, checkedIn: 0 }])));
  s.press('Kids');
  s.type('Child’s name', 'Ada Okonkwo');
  await s.click('Check a child in');
  assert.equal(s.checkinCalls.length, 1,
    'A CHECK-IN WITH NO ARRIVAL NOW NEEDS A CONFIRMATION. There is no pairing to confirm, and a child at the ' +
    'door of a church with no app has been given an extra tap for nothing.');
  assert.ok(!s.checkinCalls[0].guardian,
    'A GUARDIAN WAS ATTACHED TO A CHILD NOBODY CLAIMED. The worker\'s phone holds no guardian map; the only ' +
    'lawful source of that pubkey is a signed arrival she confirmed. Got: ' + JSON.stringify(s.checkinCalls[0].guardian));
});

test('…and an arrival whose NAME this phone has not opened says so, rather than inventing one', async () => {
  // The name is what the pairing is confirmed against. A screen that substituted a key fragment for a name
  // would make an unresolved stranger read as a known family, which is the mis-tap this whole panel guards.
  const s = serving(live(withArrivals([], [{ pub: SARAH, name: '', at: AM_FROM + 60, checkedIn: 0 }])));
  s.press('Kids');
  const out = s.reads();
  assert.doesNotMatch(out, /aaaaaaaa/, 'a raw pubkey is being shown to a worker as though it were a name');
  assert.match(out, /name hasn’t reached your phone/i,
    'an arrival with no resolved name says nothing about that, so the worker cannot tell "a family I know" ' +
    'from "somebody this phone has never seen". As rendered: ' + out);
  assert.deepEqual(s.glued(), [], 'copy runs together: ' + JSON.stringify(s.glued()));
});

test('…and a family already part-way through is kept in the queue, counted, not dropped', async () => {
  // A parent with two children checks both in from ONE arrival. A queue that emptied itself after the first
  // would make the second child look like a mistake and send the parent back to the desk.
  const s = serving(live(withArrivals(
    [{ id: 'ci-1', childName: 'Milo', code: '4417', session: 'svc-am' }],
    [{ pub: SARAH, name: 'Sarah Henderson', at: AM_FROM + 60, checkedIn: 1 }])));
  s.press('Kids');
  const out = s.reads();
  assert.match(out, /Sarah Henderson has arrived/, 'the family vanished from the queue after one child went in');
  assert.match(out, /1 child checked in so far/, 'the queue does not say how many of this family are already in the room. As rendered: ' + out);
  assert.deepEqual(s.glued(), [], 'copy runs together: ' + JSON.stringify(s.glued()));
});

test('…and NO arrival ever renders as a child in the register', async () => {
  // An arrival is a family at a door, not a child in a room. If one ever reached the rows it would be a
  // phantom child on a safeguarding register, with no pickup code and nobody able to collect them.
  const s = serving(live(withArrivals([], [{ pub: SARAH, name: 'Sarah Henderson', at: AM_FROM + 60, checkedIn: 0 }])));
  s.press('Kids');
  const out = s.reads();
  assert.match(out, /0 checked in/,
    'the session header counts somebody in the room when only a parent has said they are at the door. ' +
    'As rendered: ' + out);
  assert.match(out, /Nobody has been checked in yet/, 'the empty-register line was replaced by an arrival masquerading as a row');
  assert.equal(s.has('Show code'), 0, 'an arrival grew a pickup code — it is not a child\'s record');
});

test('…and RETYPING the child\'s name cancels a confirmation already on screen', async () => {
  // FOUND IN MY OWN AUDIT OF THIS COMMIT, 2026-09-11. `pending` FREEZES the pairing the worker was asked
  // about, which is right — she must confirm what she was shown. But the name box stayed editable
  // underneath it, so the panel could read "Milo → Sarah Henderson?" over a box now reading "Yara", and
  // whichever of the two she believed, one was wrong. The confirmation is withdrawn and she is asked again.
  const s = serving(live(withArrivals([], [{ pub: SARAH, name: 'Sarah Henderson', at: AM_FROM + 60, checkedIn: 0 }])));
  s.press('Kids');
  await s.click('Sarah Henderson');
  s.type('Child’s name', 'Milo');
  await s.click('Check a child in');
  assert.match(s.reads(), /Milo → Sarah Henderson\?/, 'fixture: no confirmation was on screen to cancel');
  s.type('Child’s name', 'Yara');
  assert.doesNotMatch(s.reads(), /Milo → Sarah Henderson\?/,
    'A STALE CONFIRMATION SURVIVED A RETYPE. The panel names one child and the box names another, and one tap ' +
    'writes whichever the worker is not looking at. As rendered: ' + s.reads());
  assert.equal(s.checkinCalls.length, 0, 'retyping the name wrote a record on its own');
});
