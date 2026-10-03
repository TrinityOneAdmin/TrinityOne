// A CHILD MUST NOT BE SHOWN THE ADULT CARE CARD WHILE THE APP IS STILL FINDING OUT THEY ARE ONE.
//   Run: node --test scripts/a-child-never-sees-the-adult-care-card.test.mjs
//
// Sim finding (block A2, item 9). AskForHelp read only `ctx.safeguard.isMinor`, which is false at boot and
// becomes true only when the member's OWN sealed clearance document arrives. For that window a child was shown
// the ADULT wording — "Tell your care team what would help — privately." — on the Today and Care cards. The
// engine already has a three-answer question for exactly this (`assumeMinor`: a child / not a child / cannot
// tell), the chat screen and the event filter already ask it, and the care screens never did.
//
// TWO HALVES, BOTH AT THE POINT OF USE (CLAUDE.md rule 1):
//   1. the REAL App (app/app.jsx, mounted through scripts/app-screens.mjs) hands every screen a
//      `ctx.minorState` of 'minor' | 'maybe' | 'adult' — 'maybe' until the engine has answered FOR THIS CHURCH,
//      'maybe' when it assumes a child, 'adult' only on an answer of "not a child";
//   2. the REAL AskForHelp (app/screens-today.jsx), rendered through the miniature React, words itself neutrally
//      on 'maybe' — no "care team", the button NOT blanked — and keeps the adult wording on 'adult'.
// Delete the ctx field in app.jsx and half 1 goes red; delete the check in AskForHelp and half 2 does.
//
// RULE 3: nothing here matches text in app/*.jsx. Every claim is about a rendered tree or a mounted App.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeReact, appBrowser, loadApp, nodes } from './app-screens.mjs';
import { loadScreen, miniReact, texts } from './render-jsx-screen.mjs';

// ══════════════ 1. THE APP ════════════════════════════════════════════════════════════════════════════════════
// A FRESH App PER TEST: the assumeMinor effect only re-asks when the church or isMinor changes, so a shared App
// would carry one test's answer into the next.
const NPUB = 'npub1' + '0'.repeat(58);
const settle = () => new Promise(r => setTimeout(r, 1600));
async function mount(assumeMinor) {
  const r = fakeReact();
  const env = appBrowser();
  const window = env.window;
  const callbacks = {};
  window.Bible = { loaded: true, activeVersion: 'KJV', subscribe: () => () => {}, books: () => ['John'], maxChapter: () => 21, defaultLoc: () => ({ book: 'John', chap: 1 }) };
  window.MyData = { seedIfEmpty() {}, on: () => () => {}, list: () => [], settings: { get: () => ({}) }, count: () => 0, set: () => {} };
  window.TrinityData = {};
  const App = loadApp({ React: r.React, window, expr: 'App' });
  window.TrinityData.CHURCHES = [{ id: NPUB, npub: NPUB, name: 'Test Church' }];
  window.localStorage.setItem('trinityone.activeChurch', JSON.stringify(NPUB));
  window.Fellowship = new Proxy({ myPubkey: 'deadbeef', CANONICAL_RELAYS: [], hasRelays: true, assumeMinor },
    { get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'then' || typeof k === 'symbol') return undefined;
      return (...args) => { const cb = args.find(a => typeof a === 'function'); if (cb) callbacks[k] = cb; return () => {}; };
    } });
  const draw = () => { r.reset(); const tree = App(); r.flush(); return tree; };
  draw(); await settle(); draw();   // the shell wires its subscriptions once it is ready (the first draw is not enough)
  const stateNow = () => {
    const screen = nodes(draw()).find(n => n.props && n.props.ctx && 'minorState' in n.props.ctx);
    assert.ok(screen, 'no screen received a ctx with minorState — the app no longer hands the three-answer question to its screens');
    return screen.props.ctx.minorState;
  };
  const safeguard = (isMinor) => callbacks.subscribeChurchSafeguard({ minors: [], approved: [], guardians: {}, isMinor, minorsKnown: true });
  return { stateNow, safeguard, draw };
}

test('APP: until the engine has answered, the member is "maybe" a child — never "adult"', async () => {
  let release; const m = await mount(() => new Promise(r => { release = r; }));
  m.safeguard(false);
  assert.equal(m.stateNow(), 'maybe',
    'WHILE THE ENGINE HAS NOT ANSWERED THE APP CALLS THE MEMBER AN ADULT — a child on a cold start is shown the adult care card');
  release(false); await settle();
  assert.equal(m.stateNow(), 'adult', 'once the engine says "not a child" the member is still held at "maybe"');
});

test('APP: an engine that assumes a child keeps the member at "maybe"', async () => {
  const m = await mount(() => Promise.resolve(true));
  m.safeguard(false);
  assert.equal(m.stateNow(), 'maybe', 'an assumed child was treated as an adult');
});

test('APP: the church telling this phone they are a child makes them "minor"', async () => {
  const m = await mount(() => Promise.resolve(false));
  m.safeguard(true);
  assert.equal(m.stateNow(), 'minor');
});

test('APP CONTROL: an engine that cannot be reached counts as "maybe" (assumes a child), never silently "adult"', async () => {
  const m = await mount(() => Promise.reject(new Error('offline')));
  m.safeguard(false);
  assert.equal(m.stateNow(), 'maybe', 'a failed engine answer was read as "adult"');
});

// ══════════════ 2. THE SCREEN ═════════════════════════════════════════════════════════════════════════════════
const Stub = (n) => function S(p) { return { type: n, props: p, kids: [] }; };
function askCard({ minorState, isMinor = false, openedBy = 'steward' }) {
  const { React, draw } = miniReact();
  const globals = {
    React, console, setTimeout, clearTimeout, setInterval, clearInterval,
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    ChurchBadge: Stub('ChurchBadge'),
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    lsGet: (k, d) => d, lsSet: () => {},
    cx: (...a) => a.filter(Boolean).join(' '),
    SectionLabel: Stub('SectionLabel'), Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'),
    useTrinityAudio: () => ({ track: null, playing: false }),
    todayISO: () => '2026-10-02',
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    window: {
      addEventListener() {}, removeEventListener() {}, innerWidth: 360,
      Fellowship: { myPubkey: 'm'.repeat(64), subscribeCareRequests: (cb) => { cb([]); return () => {}; }, childCareAudience: async () => ['x'.repeat(64)] },
      TrinityData: { NOTIFICATIONS: [], PLANS: [], VOTD_POOL: [] },
      Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1, activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }) },
    },
  };
  const { AskForHelp } = loadScreen('app/screens-today.jsx', ['AskForHelp'], globals);
  const ctx = {
    church: { npub: 'npub1church' }, toast() {},
    safeguard: { minors: [], approved: [], guardians: {}, isMinor, minorsKnown: true },
    care: { myPub: 'm'.repeat(64), settings: { enabled: true, openedBy } },
    connTick: 0,
  };
  if (minorState !== undefined) ctx.minorState = minorState;
  draw(AskForHelp, { ctx });
  const tree = draw(AskForHelp, { ctx });
  return { tree, words: texts(tree).join(' | ') };
}

test('SCREEN: while the app only MAYBE knows it is a child, the card says nothing about a care team — and is not blanked', () => {
  const c = askCard({ minorState: 'maybe' });
  assert.match(c.words, /Ask for help/, 'the ask card was blanked while the app was still finding out — a hidden control is worse than neutral words');
  assert.match(c.words, /Tell someone at your church what would help — privately\./);
  assert.doesNotMatch(c.words, /care team/i,
    'A POSSIBLE CHILD IS TOLD "TELL YOUR CARE TEAM". Screen read: ' + c.words);
  assert.doesNotMatch(c.words, /Tell your church/, 'the adult "Tell your church" wording reached a possible child');
});

test('SCREEN: the neutral words also hold when the church opened care to members (the other adult wording)', () => {
  const c = askCard({ minorState: 'maybe', openedBy: 'member' });
  assert.doesNotMatch(c.words, /Tell your church what would help/, 'the member-opened adult wording reached a possible child');
  assert.match(c.words, /Tell someone at your church/);
});

test('SCREEN CONTROL: a known adult still gets the adult wording (the fix is not "neutral for everyone")', () => {
  assert.match(askCard({ minorState: 'adult' }).words, /Tell your care team what would help — privately\./);
  assert.match(askCard({ minorState: 'adult', openedBy: 'member' }).words, /Tell your church what would help\./);
});

test('SCREEN CONTROL: a ctx without minorState (an older shell) keeps the adult wording rather than crashing', () => {
  assert.match(askCard({ minorState: undefined }).words, /care team/i);
});

test('SCREEN CONTROL: a confirmed minor still gets the young person’s sentence and the card', () => {
  const c = askCard({ minorState: 'minor', isMinor: true });
  assert.match(c.words, /Tell someone at your church what would help — privately\./);
  assert.doesNotMatch(c.words, /care team/i);
});
