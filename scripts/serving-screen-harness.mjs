// MOUNT THE MEMBER APP'S SERVING SCREEN AND ITS SHEETS IN NODE, AND DRIVE THEM.
//
// Not a test (no `.test.mjs` suffix). Shared by the Block B3 tests of 2026-10-03: the "no teams yet" contradiction,
// the "Can't make it" row, swap reachable without declining, Away vs serving, and the swap ask reaching the
// teammate. Each has to be proved AT THE SCREEN (CLAUDE.md rule 1) by running the shipped component, never by
// matching text in app/screens-serving.jsx (rule 3).
//
// It loads every app/*.jsx in index.html order the way the phone does (scripts/app-screens.mjs), so the
// components under test have their real neighbours — BottomSheet, Icon, ServDateBlock. fakeReact does not
// expand function components, but an element's children ride along on `kids`, so a sheet's content is visible in
// the tree it returns.
import { fakeReact, appBrowser, loadApp, nodes } from './app-screens.mjs';

export function loadServing() {
  const r = fakeReact();
  const env = appBrowser();
  const window = env.window;
  window.Bible = { loaded: true, activeVersion: 'KJV', subscribe: () => () => {}, books: () => ['John'], maxChapter: () => 21, defaultLoc: () => ({ book: 'John', chap: 1 }) };
  window.MyData = { seedIfEmpty() {}, on: () => () => {}, list: () => [], settings: { get: () => ({}) }, count: () => 0, set: () => {} };
  window.TrinityData = {};
  const mod = loadApp({
    React: r.React, window,
    expr: '({ ServingScreen, RespondSheet, SwapSheet, ManageSheet, UnavailSheet, svRespond, svMyTeams, svNextSundays, svClearAway })',
    vendor: ['engine.js'],
  });
  return { mod, r, window };
}

// The ctx a member's phone hands the screen, with only what these screens read.
export function baseCtx(over = {}) {
  return {
    church: { id: 'npub1church', npub: 'npub1church', name: 'St Aidan' },
    myPubkey: 'aa'.repeat(32),
    servPending: [], servConfirmed: [], servDeclined: [], servNext: null,
    churchEvents: [], myRsvps: {}, churchRotas: [], churchRosters: [], churchServices: [],
    churchGroups: [], rotaVis: {}, myRosterTeams: [], checkinRegister: {},
    care: { settings: { enabled: false }, needs: [], slots: [], myPub: '' },
    safeguard: { isMinor: false, minorsKnown: true },
    toast() {},
    ...over,
  };
}

export const slot = (over = {}) => ({
  id: 'req1', church: 'a'.repeat(64), serviceId: 'svc1', teamId: 't1', roleId: 'r1', role: 'Greeter',
  teamName: 'Welcome', icon: 'hand', accent: 'var(--clay)', date: '2099-10-04', time: '10:30',
  service: 'Sunday Gathering', ts: 1, ...over,
});

// what a reader reads inside one node: its own text and every descendant's, adjacent inline pieces joined
export const nodeText = (n) => nodes(n).flatMap(x => (x.kids || []).filter(k => typeof k === 'string' || typeof k === 'number').map(String)).join('');

export function makeDriver(h, Comp) {
  const draw = (props) => { h.r.reset(); const t = Comp(props); h.r.flush(); return t; };
  const textOf = (props) => nodeText(draw(props));
  const buttons = (props) => nodes(draw(props)).filter(n => n.type === 'button');
  const button = (props, label) => buttons(props).find(b => nodeText(b).includes(label));
  return { draw, textOf, buttons, button };
}
