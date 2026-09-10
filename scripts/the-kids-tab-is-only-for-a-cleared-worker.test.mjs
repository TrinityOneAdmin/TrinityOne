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
const NONE = { cleared: false, lapsed: false, notYet: false, from: null, until: null, lifetime: '', sessions: [], keysHeld: 0, unreadable: 0, foreign: 0, settled: true };
const AM_FROM = 1788595200;   // 2026-09-06, a Sunday
const twoKids = [
  { id: 'ci-1', childName: 'Esther Ncube', code: '4417', session: 'svc-am' },
  { id: 'ci-2', childName: 'Amos Bello', code: '9081', session: 'svc-am' },
];
const oneSession = (rows) => [{ session: 'svc-am', from: AM_FROM, until: AM_FROM + 10800, helpers: 2, rows }];

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
  };
  const render = () => draw(mod.ServingScreen, { open: true, onClose() {}, ctx });
  render();                                  // the first draw queues the tab-strip effects…
  let tree = render();                       // …the second sees what they settled on
  return {
    mod, ctx, opened,
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
  assert.match(out, /No session keys have reached this phone\./,
    'the commonest state in this whole feature — cleared, and a console has never issued a key — has no ' +
    'honest wording. As rendered: ' + out);
  assert.match(out, /Nothing is wrong/,
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
  assert.match(out, /3 records this phone cannot open\./,
    '"refused" and "served but unreadable" are different failures and look nothing like each other from a ' +
    'phone — and this one has no wording at all. As rendered: ' + out);
  assert.match(out, /The register is not empty\./,
    'the one thing a worker must be told here is missing: there ARE children checked in and this phone ' +
    'cannot show them. As rendered: ' + out);
  assert.deepEqual(s.glued(), [], JSON.stringify(s.glued()));
});

test('NEGATIVE: records from a session this phone holds no key for are counted, never listed', () => {
  const s = serving({ ...NONE, cleared: true, keysHeld: 1, foreign: 2, sessions: oneSession([]) });
  s.press('Kids');
  const out = s.reads();
  assert.match(out, /2 records belong to another session\./,
    'a worker is shown nothing and told nothing about records that arrived for a session she holds no key ' +
    'for. As rendered: ' + out);
  assert.match(out, /This phone holds no key for it\./, 'the reason is not on the screen. As rendered: ' + out);
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
