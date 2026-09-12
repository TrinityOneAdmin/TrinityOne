// THE POINT OF USE: A PARENT'S OWN SCREEN, RENDERED.
// Run: node --test scripts/a-parent-sees-their-own-childs-pickup-code.test.mjs
//
// scripts/a-parent-opens-their-own-childs-copy.test.mjs proves the SEALING and
// scripts/a-parent-reads-their-own-children.test.mjs proves the READER. Both are worth nothing on their own —
// CLAUDE.md rule 1: "the child-safety fix that hides adults-only rooms from a young person had eight passing
// tests over its engine. Deleting the one line in the app that actually calls it left all 1,982 tests green."
// So this drives the SCREEN: it compiles app/screens-today.jsx with the same esbuild the build uses, renders
// it through the miniature React in render-jsx-screen.mjs, and reads the tree that comes back.
//
// ⚠ RULE 3: NOTHING HERE MATCHES TEXT IN app/*.jsx. Those files ship unbundled, so `false && ` in front of a
// condition leaves every word of it in place and a source match still passes. Every claim below is about a
// RENDERED tree.
//
// ⚠ reads(), NOT said(). said() joins text nodes with a space and therefore CANNOT SEE the JSX whitespace
// bug — the console shipped "whenever you openthis page" with the assertion pinning that sentence passing.
//
// NO RELAY AND NO PORT.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts } from './render-jsx-screen.mjs';

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

// ── THE TREE READERS. The house versions, copied from the-kids-tab-is-only-for-a-cleared-worker.test.mjs. ──
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
// ONE NODE, ONCE, off the RENDERED tree only — find()/button() in render-jsx-screen.mjs also walk props that
// look like a tree, so an element handed to a component as a prop is reached twice.
function shown(n, pred, out = []) {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(c => shown(c, pred, out)); return out; }
  if (pred(n)) out.push(n);
  (n.kids || []).forEach(c => shown(c, pred, out));
  return out;
}
const buttons = (tree) => shown(tree, n => n.type === 'button');
const controls = (tree) => shown(tree, n => n.type === 'button' || n.type === 'input' || n.type === 'a' || n.type === 'select');
// EVERY control except the one that only folds the card away. The card became collapsible on 2026-09-11
// (owner request), which put a real button on a screen whose whole point is that it carries NO controls — so
// this narrows the absence rather than abandoning it. A disclosure toggle is identified by `aria-expanded`,
// which belongs to a control that opens and closes something; anything else on this card — a second button,
// a link, an input — still fails the tests below, and the release-vocabulary check still runs over the
// toggle's own text, so a "Collect" button could not sneak past by wearing an aria-expanded.
const isDisclosure = (n) => n.type === 'button' && n.props && n.props['aria-expanded'] !== undefined;
const controlsBesidesTheFold = (tree) => controls(tree).filter(n => !isDisclosure(n));

// ── WHAT THE TRANSPORT HANDS THE SCREEN ───────────────────────────────────────────────────────────────────
// The exact shape Fellowship.subscribeMyChildrenCheckins emits. Every field is asserted against the SHIPPED
// reader in a-parent-reads-their-own-children.test.mjs, so these are that function's real answers rather
// than a guess at them.
const NONE = { children: [], askAtDesk: 0, settled: true };
const IVY  = { id: 'ci-ivy', childName: 'Ivy Henderson', code: '4417', session: 'svc-am', in: 1788599400, ts: 1788599400 };
const MILO = { id: 'ci-milo', childName: 'Milo Henderson', code: '9081', session: 'svc-am', in: 1788599410, ts: 1788599410 };

function today(myChildren, over = {}, stored = null) {
  const { React, draw } = miniReact();
  // A REAL, PER-CALL STORE. The card remembers whether the member folded it away, so a shared always-null
  // stub could only ever test the default. `stored` seeds it; writes are kept so a toggle can be read back.
  const LS = {
    _v: { ...(stored || {}) },
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._v, k) ? this._v[k] : null; },
    setItem(k, v) { this._v[k] = String(v); },
    removeItem(k) { delete this._v[k]; },
  };
  const win = {
    Fellowship: { myPubkey: 'me' },
    Capacitor: { isNativePlatform: () => false },
    TrinityData: DATA,
    Bible: BIBLE,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    localStorage: LS,
    innerWidth: 390,
  };
  const globals = {
    React,
    window: win,
    document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
    navigator: { userAgent: '' },
    localStorage: LS,
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    // PASSTHROUGHS, NOT STUBS, for anything the card under test renders INSIDE — miniReact cannot render the
    // children of a stubbed component, so a stub there would swallow the whole subtree and every assertion
    // below would be about an empty tree.
    Icon: Stub('Icon'),
    IconBtn: Stub('IconBtn'),
    ChurchBadge: Stub('ChurchBadge'),
    // Furniture belonging to other cards on this screen.
    SafetyBanner: Stub('SafetyBanner'),
    CareCard: Stub('CareCard'),
    AskForHelp: Stub('AskForHelp'),
    SectionLabel: function SectionLabel(p) { return React.createElement('h2', {}, p.children); },
    BottomSheet: ({ open, children }) => (open ? children : null),
    Overlay: function Overlay(p) { return React.createElement('div', {}, p.open ? p.children : null); },
    safeCssColor: (c) => c,
    todayISO: () => '2026-09-06',
    lsGet: (k, d) => d,
    lsSet: () => {},
    Math, Date, JSON, Set, Map, Number, String, Array, Promise, Object, isNaN, Boolean, parseInt, parseFloat,
  };
  const mod = loadScreen('app/screens-today.jsx', ['TodayScreen', 'MyChildrenCard'], globals);
  const ctx = {
    myChildren,
    church: { id: 'c1', name: "St Chad's" },
    care: { settings: { enabled: false }, needs: [], myPub: 'me' },
    planProgress: {}, loc: null, churchDevos: [], servNext: null, servPending: [], servingSeenTs: 0,
    netUnread: 0, dark: false,
    openServing() {}, openChurchSwitcher() {}, openSearch() {}, openNotifications() {}, openListen() {},
    toggleDark() {}, toast() {}, openShareSheet() {}, openEvent() {}, openHelp() {},
    ...over,
  };
  return { card: draw(mod.MyChildrenCard, { ctx }), screen: draw(mod.TodayScreen, { ctx }), mod, ctx, React, draw, LS };
}

// The Today screen leans on TrinityData and Bible for the verse of the day, the reading plan and the streak.
// None of it is under test; it is here so the WHOLE screen really renders and the card is proved to be ON it.
const DATA = {
  VOTD_POOL: [{ ref: 'John 3:16', text: 'For God so loved the world…' }],
  PLANS: [{ id: 'p1', name: 'A plan', days: [{ d: 1, ref: 'Gen 1' }] }],
  NOTIFICATIONS: [],
};
const BIBLE = {
  parseRef: () => null, loaded: false, books: () => [], getVerses: () => [],
  bookName: () => 'Genesis', bookAbbr: () => 'Gen', maxChapter: () => 50, activeVersion: 'WEB',
};
const MEM_LS = { getItem: () => null, setItem() {}, removeItem() {} };

// ── THE POINT OF USE, AND THE ONE THIS FEATURE EXISTS FOR ─────────────────────────────────────────────────
test('THE CODE IS ON THE PARENT\'S SCREEN — the same code the worker\'s register shows for that child', () => {
  const { card, screen } = today({ children: [IVY], askAtDesk: 0, settled: true });
  assert.match(reads(card), /4417/,
    'THE PICKUP CODE IS NOT ON THE SCREEN. §4 of the design is "the parent shows the code from their phone" ' +
    'and the worker matches it; a screen without it is a screen with no purpose.');
  assert.match(reads(card), /Ivy Henderson/, 'the child\'s name is not on the screen, so a parent cannot tell which row is which');
  // AND IT IS LABELLED IN VISIBLE TEXT. Device finding 2026-09-11: a code labelled by `title` alone read as
  // "I couldn't tell which one is 'the' pickup code — I'd have read 9079 to a parent, but I was guessing."
  assert.match(reads(card).toLowerCase(), /pickup code/,
    'the number is on screen with nothing naming it — a `title` is invisible on a touch screen and to a ' +
    'screen reader, which this product has already paid for once');

  // ── AND THE CARD IS ACTUALLY ON THE TODAY SCREEN. A card nobody renders is the rule-1 failure exactly.
  assert.match(reads(screen), /4417/,
    'THE CARD IS NOT WIRED INTO TodayScreen. Every assertion about the card in isolation is then about a ' +
    'component no member ever sees — which is the defect CLAUDE.md rule 1 exists for, verbatim.');
  assert.match(reads(screen), /Ivy Henderson/);

  assert.deepEqual(glued(card), [], 'two pieces of copy run together with no space between them');
});

test('two children, two codes, both on screen', () => {
  const { card } = today({ children: [IVY, MILO], askAtDesk: 0, settled: true });
  const t = reads(card);
  assert.match(t, /4417/); assert.match(t, /9081/);
  assert.match(t, /Ivy Henderson/); assert.match(t, /Milo Henderson/);
});

// ── THE ABSENCE THAT MUST STAY AN ABSENCE ────────────────────────────────────────────────────────────────
test('THERE IS NO WAY TO CHECK A CHILD OUT FROM A PARENT\'S SCREEN', () => {
  // Not an omission — the point. The pickup code exists so the person handing a child over is the person who
  // brought them; a control on the parent's own phone that released a child routes straight round it. This
  // is asserted as an ABSENCE because an absence is exactly what a later "helpful" addition undoes quietly.
  const { card } = today({ children: [IVY, MILO], askAtDesk: 1, settled: true });
  assert.deepEqual(controlsBesidesTheFold(card), [],
    'A CONTROL APPEARED ON THE PARENT\'S CARD. A parent must never be able to check their own child out, ' +
    'sign them out, collect them, confirm a pickup or release them — every one of those routes round the ' +
    'code. The fold-away toggle is the ONLY control allowed here. Found ' +
    controlsBesidesTheFold(card).length + ' other interactive element(s).');
  // …and there is exactly ONE fold, not a row of them: a per-child disclosure would be a per-child control,
  // which is how an absence like this gets eroded a step at a time.
  assert.equal(controls(card).filter(isDisclosure).length, 1,
    'the parent\'s card carries ' + controls(card).filter(isDisclosure).length + ' disclosure toggles. One, ' +
    'for the whole card, is the shape that was agreed.');
  const t = reads(card).toLowerCase();
  for (const word of ['check out', 'sign out', 'collect', 'release', 'confirm']) {
    assert.ok(!t.includes(word),
      'the parent\'s card offers "' + word + '" — even as a label with no handler, that is an instruction to ' +
      'a parent to do the one thing only the worker may do');
  }
});

// ── THE STATE WITH NO COPY AT ALL: NEVER A BLANK, NEVER A SPINNER ────────────────────────────────────────
test('a record this phone cannot open says "ask the worker", unconditionally and at once', () => {
  // The walk-up at the desk, the dead phone, the record written before the guardian copy shipped. Reported
  // from the first event onward rather than at EOSE, so `settled:false` must say the same thing — a parent
  // standing at a door is the person least able to wait on a spinner that never resolves, and a blank screen
  // is the worst of the three things this card can be (the silent-blank-app class).
  for (const settled of [false, true]) {
    const { card, screen } = today({ children: [], askAtDesk: 1, settled });
    const t = reads(card);
    assert.match(t, /Ask the worker for the pickup code/i,
      'A PARENT WHOSE CHILD WAS CHECKED IN AT THE DESK GOT A BLANK CARD (settled=' + settled + '). The ' +
      'record names them and they hold no copy of it; saying so is the only honest answer and the screen ' +
      'must not wait to say it.');
    assert.match(t, /Checked in at the desk\?/i, 'the line no longer names the situation it is about');
    assert.match(reads(screen), /Ask the worker for the pickup code/i, 'the line is not reachable from the Today screen');
    assert.deepEqual(controlsBesidesTheFold(card), [], 'the ask-at-the-desk state offered a control besides the fold-away toggle');
  }
});

test('…and it appears BESIDE the children this phone can open, not instead of them', () => {
  const { card } = today({ children: [IVY], askAtDesk: 1, settled: true });
  const t = reads(card);
  assert.match(t, /4417/, 'the openable child vanished when an unopenable one arrived');
  assert.match(t, /Ask the worker for the pickup code/i, 'the unopenable record was swallowed by the openable one');
});

// ── AND IT DOES NOT EXIST FOR ANYBODY ELSE ───────────────────────────────────────────────────────────────
test('a member with no children checked in is shown NOTHING about check-in', () => {
  // A parent persona hunted this whole app on 2026-09-10 and found no check-in anywhere; the finding was
  // that the absence is CORRECT and that there were no dead ends — no menu item leading nowhere, no empty
  // "No check-ins today" state. A card greeting the congregation with an empty register would be one.
  const { card, screen } = today(NONE);
  // ⚠ `reads(card)`, NOT `card === null`. draw() wraps a component that returned null in a node whose only
  // child is null, so an identity check against null is a test that can never fail. What matters, and what
  // this asserts, is that NOTHING IS ON THE SCREEN.
  assert.equal(reads(card), '', 'the card put words on the screen for a member with no children checked in');
  const t = reads(screen).toLowerCase();
  for (const word of ['pickup code', 'checked in at the desk', 'your children at church']) {
    assert.ok(!t.includes(word),
      'THE TODAY SCREEN RAISES CHECK-IN WITH A MEMBER WHO HAS NOTHING TO DO WITH IT ("' + word + '"). ' +
      'Most of a congregation, most Sundays, is in exactly this state.');
  }
  // …and the rest of the Today screen still renders, so the line above is not "the whole screen is empty".
  assert.match(said(screen), /St Chad/, 're-anchor: the Today screen rendered nothing at all, so the absences above are vacuous');
});

test('an app that has not finished loading shows nothing either — not an empty register', () => {
  const { card } = today({ children: [], askAtDesk: 0, settled: false });
  assert.equal(reads(card), '', 'the card put words on the screen before anything had arrived');
});

// ── COLLECTED, WHICH ARRIVES AS A DOCUMENT AND NEVER AS AN ABSENCE ───────────────────────────────────────
test('a collected child says so — with the time, and distinctly when it was by hand', () => {
  const out = { ...IVY, out: 1788604500, manual: false };
  const { card } = today({ children: [out], askAtDesk: 0, settled: true });
  assert.match(reads(card), /Checked out/i,
    'A CHILD WHO HAS GONE HOME STILL READS AS PRESENT. A guardian is never served a tombstone, so a release ' +
    'they can read is the ONLY thing that can ever change this row — and if the screen ignores it the row ' +
    'says a child is in a room for ever.');
  // THE TIME IS FORMATTED, NOT PRINTED. The Oppo showed "Collected · 1789084514" on 2026-09-11 because a row
  // printed the epoch integer straight out of the record.
  assert.doesNotMatch(reads(card), /1788604500/,
    'the collection time was printed as an epoch integer — measured on a real phone once already');

  // AND THE CODE IS GONE ONCE THE CHILD IS, because it releases nobody now and a stale number on a screen is
  // read as a live one.
  assert.doesNotMatch(reads(card), /4417/, 'a collected child still displays a live pickup code');

  const byHand = { ...IVY, out: 1788604500, manual: true };
  assert.match(reads(today({ children: [byHand], askAtDesk: 0, settled: true }).card), /by hand/i,
    'A BY-HAND RELEASE LOOKS EXACTLY LIKE A CODE-MATCHED ONE. Design §7 requires a parent to be able to see ' +
    'their child was collected WITHOUT their code — recorded because a register that omits it is incomplete, ' +
    'not because anybody is suspected.');
});

// ── A COPY WITH NO CODE IN IT IS NOT A CHILD WITH NO CODE ────────────────────────────────────────────────
test('a row whose copy carries no code says which of the two that is', () => {
  const { card } = today({ children: [{ ...IVY, code: '' }], askAtDesk: 0, settled: true });
  const t = reads(card);
  assert.match(t, /Ivy Henderson/, 'the child vanished because their copy had no code in it');
  assert.match(t, /No pickup code for this child/i, 'the row showed a name and nothing else, which reads as a broken screen');
});

// ── A HOSTILE BODY MUST NOT BLANK THE APP ────────────────────────────────────────────────────────────────
test('a row with a missing name renders a word, not an empty line', () => {
  const { card } = today({ children: [{ id: 'x', childName: '', code: '4417', session: 's' }], askAtDesk: 0, settled: true });
  assert.match(reads(card), /Name not in this copy/i,
    'a row with no name rendered as blank space beside a pickup code, which reads as a fault rather than as ' +
    'a partial copy');
});

// ── THE CARD FOLDS AWAY — owner request, 2026-09-11 ───────────────────────────────────────────────────────
//
// The card sits at the top of the Today page and is several rows tall in a family with three children, above
// everything else a member opened the app for. So it folds. What follows pins the three things that make a
// fold safe on THIS card rather than on any card.
const OPEN_KEY = 'trinityone.kids.open';

test('it opens by DEFAULT — a pickup code at a door is never behind a tap', () => {
  // The load-bearing half. This card exists so a parent can hold a code up to a volunteer; shipping it shut
  // would mean every parent taps before they can do the one thing it is for.
  const { card } = today({ children: [IVY, MILO], askAtDesk: 0, settled: true });
  const t = reads(card);
  assert.match(t, /4417/, 'the card shipped FOLDED SHUT by default, so a parent at a door has to tap before ' +
    'they can show the pickup code. Nothing is stored on a first launch, and that state must read as open.');
  assert.match(t, /9081/);
});

test('folded away, it shows no codes and no names — that is what folding means', () => {
  const { card } = today({ children: [IVY, MILO], askAtDesk: 0, settled: true }, {}, { [OPEN_KEY]: '0' });
  const t = reads(card);
  assert.ok(!t.includes('4417') && !t.includes('9081'),
    'a folded card still had a pickup code on screen: ' + t);
  assert.ok(!t.includes('Ivy Henderson'), 'a folded card still listed a child by name: ' + t);
  assert.match(t, /Your children at church/, 're-anchor: the whole card vanished rather than folding');
});

test('folded, the COUNT still moves — or a child arriving changes nothing a parent can see', () => {
  // The silent-blank shape this codebase keeps paying for: shut, the card would otherwise be a title with
  // nothing behind it, and a child checked in while it is shut would be invisible.
  const one = reads(today({ children: [IVY], askAtDesk: 0, settled: true }, {}, { [OPEN_KEY]: '0' }).card);
  const two = reads(today({ children: [IVY, MILO], askAtDesk: 0, settled: true }, {}, { [OPEN_KEY]: '0' }).card);
  assert.match(one, /·\s*1/, 'a folded card does not say how many children are checked in: ' + one);
  assert.match(two, /·\s*2/, 'the folded count did not change when a second child was checked in — a parent ' +
    'would see nothing at all happen: ' + two);
});

test('folded, "ask the worker" still reaches the parent', () => {
  // A record this phone holds no copy of is the one case where the parent must DO something. Hiding that
  // behind the fold would leave them at a door with no code and no idea there is one to ask for.
  const { card } = today({ children: [], askAtDesk: 1, settled: true }, {}, { [OPEN_KEY]: '0' });
  assert.match(reads(card).toLowerCase(), /ask the worker/,
    'a folded card said nothing about the child the desk holds no copy of: ' + reads(card));
});

test('the fold is remembered, and the toggle is a real one', () => {
  const { card, LS } = today({ children: [IVY], askAtDesk: 0, settled: true });
  const fold = controls(card).filter(isDisclosure)[0];
  assert.ok(fold, 'there is no disclosure control on the card at all');
  assert.equal(fold.props['aria-expanded'], true, 'the toggle does not report its state to a screen reader');
  fold.props.onClick();
  assert.equal(LS.getItem(OPEN_KEY), '0',
    'folding the card away was not remembered, so it springs open again on the next render — ' +
    'stored: ' + JSON.stringify(LS.getItem(OPEN_KEY)));
});

test('folding it away does NOT put a release control on the screen', () => {
  // The absence in the test above, re-checked in the folded state — a fold is new render branches, and a
  // branch nobody looks at is where a control appears.
  const { card } = today({ children: [IVY, MILO], askAtDesk: 1, settled: true }, {}, { [OPEN_KEY]: '0' });
  assert.deepEqual(controlsBesidesTheFold(card), [], 'the folded card carries a control besides the fold');
  const t = reads(card).toLowerCase();
  for (const word of ['check out', 'sign out', 'collect', 'release', 'confirm']) {
    assert.ok(!t.includes(word), 'the folded card offers "' + word + '": ' + t);
  }
});
