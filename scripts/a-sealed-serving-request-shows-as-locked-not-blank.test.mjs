// A SERVING REQUEST THIS PHONE CANNOT OPEN SHOWS AS LOCKED, NEVER AS NOTHING (C-4, point of use).
//   Run: node --test scripts/a-sealed-serving-request-shows-as-locked-not-blank.test.mjs
//
// C-4 seals serving requests under the church name key. A phone that has not yet received that key gets a
// request it cannot read. subscribeMyServingRequests marks it `_locked` rather than dropping it — but a
// marker nothing on screen consults is not a feature (CLAUDE.md rule 1). Two things must be true of the
// REAL ServingScreen, not of the engine that feeds it:
//
//   1. A locked request must NOT render its card. The card's fields would all be empty and its "Yes, I can
//      serve" button would answer a question the member cannot see.
//   2. The member must be TOLD. A sealed request that renders as nothing is how somebody never learns their
//      church asked them to serve — the same silent-blank class this project keeps meeting.
//
// This mounts the shipped ServingScreen from app/screens-serving.jsx (esbuild-compiled, as the APK build
// compiles it) and reads the rendered tree. CLAUDE.md rule 3: no assertion here matches text in app/*.jsx.
//
// Fed by: Fellowship.subscribeMyServingRequests -> app/app.jsx ctx.servPending -> ServingScreen.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fakeReact, appBrowser, loadApp, texts } from './app-screens.mjs';

let ServingScreen, React, reset, flush;

const OPEN_REQ = {
  id: 'req-open', church: 'a'.repeat(64), serviceId: 'svc1', teamId: 'kids', roleId: 'r1',
  role: 'Children’s worker', teamName: 'Kids Church', icon: 'hand', accent: 'var(--clay)',
  date: '2099-10-04', time: '10:30', service: 'Kids Church — St Aidan hall', ts: 1,
};
const LOCKED_REQ = { id: 'req-locked', church: 'a'.repeat(64), _locked: true, ts: 2 };

function ctxWith(pending) {
  return {
    church: { id: 'npub1church', npub: 'npub1church', name: 'St Aidan' },
    servPending: pending, servConfirmed: [], servDeclined: [], servNext: null,
    churchEvents: [], myRsvps: {}, churchRotas: [], churchRosters: [], churchServices: [],
    churchGroups: [], rotaVis: {}, myRosterTeams: [], checkinRegister: {},
    care: { settings: { enabled: false }, needs: [], slots: [], myPub: '' },
    safeguard: { isMinor: false, minorsKnown: true },
  };
}

// texts() returns each string child on its own, and JSX splits `{n} request{s} you can't open yet` into
// four of them. Joining with '' is what puts them back as the member reads them on one line.
function render(pending) {
  reset();
  const tree = ServingScreen({ open: true, onClose: () => {}, ctx: ctxWith(pending), docked: false });
  flush();
  return texts(tree).join('');
}

before(() => {
  const r = fakeReact();
  React = r.React; reset = r.reset; flush = r.flush;
  const env = appBrowser();
  const window = env.window;
  window.Bible = { loaded: true, activeVersion: 'KJV', subscribe: () => () => {}, books: () => ['John'], maxChapter: () => 21, defaultLoc: () => ({ book: 'John', chap: 1 }) };
  window.MyData = { seedIfEmpty() {}, on: () => () => {}, list: () => [], settings: { get: () => ({}) }, count: () => 0, set: () => {} };
  window.TrinityData = {};
  // engine.js is a CLASSIC script in index.html, not one of the text/babel .jsx files appScripts() collects,
  // and it is where window.safeCssColor lives — which every screen that renders an accent colour calls.
  ServingScreen = loadApp({ React, window, expr: 'ServingScreen', vendor: ['engine.js'] });
  assert.equal(typeof ServingScreen, 'function',
    'ServingScreen did not load out of app/screens-serving.jsx — re-anchor this test');
});

test('CONTROL: a request this phone CAN open renders its role, team and the button to accept', () => {
  const out = render([OPEN_REQ]);
  assert.match(out, /Kids Church/, 'the open request did not render its team name — the fixture is wrong, ' +
    'so the locked assertions below would prove nothing');
  assert.match(out, /Children’s worker/, 'the open request did not render its role');
  assert.match(out, /I can serve/, 'the open request did not render its accept button');
});

test('a locked request does NOT render an accept button for a question the member cannot see', () => {
  const out = render([LOCKED_REQ]);
  assert.doesNotMatch(out, /I can serve/,
    'ServingScreen rendered "Yes, I can serve" for a request it could not open — the member would be ' +
    'accepting a role, team and date that are not on the screen at all');
});

test('a locked request is COUNTED on screen, not silently dropped', () => {
  const out = render([LOCKED_REQ]);
  assert.match(out, /can’t open yet/,
    'ServingScreen rendered nothing at all for a sealed request. A member whose phone has not yet received ' +
    'the church name key would never learn their church asked them to serve (C-4 risk note)');
});

test('one locked and one open request: the open one renders AND the locked one is counted', () => {
  const out = render([OPEN_REQ, LOCKED_REQ]);
  assert.match(out, /Children’s worker/, 'the open request stopped rendering once a locked one was present');
  assert.match(out, /I can serve/, 'the open request lost its accept button once a locked one was present');
  assert.match(out, /1 request you can’t open yet/,
    'the locked count is wrong or missing when an open request is alongside it');
});

test('two locked requests are counted in the plural, and no card is rendered for either', () => {
  const out = render([LOCKED_REQ, { ...LOCKED_REQ, id: 'req-locked-2' }]);
  assert.match(out, /2 requests you can’t open yet/, 'two locked requests were not counted as two');
  assert.doesNotMatch(out, /I can serve/, 'an accept button was rendered for a locked request');
});
