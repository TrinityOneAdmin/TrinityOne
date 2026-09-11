// THE PAGE BEHIND "WHAT'S HAPPENING" IS NOT THE SERVING PAGE ANY MORE.
//   Run: node --test scripts/the-serving-page-is-not-only-serving.test.mjs
//
// Owner, 2026-09-11: *"when you hit 'What's happening' it goes to a page (correctly), but the heading on the
// page is just 'Serving' and it's more than just serving now, it's serving and kids and events"* — and then:
// *"maybe on the 'serving' page we just remove the title and church name, to save space"*.
//
// Both were done. The header used to carry a 19px "Serving" and the church's name under it; the strip below
// it carries Serving, Rota, Kids, Events, Calendar and Care. So the heading named one tab out of six, and it
// had been wrong since the Kids tab shipped. The church name was redundant beside it — a member is inside one
// church and its name is on the Today screen they came from. Together they cost about 44px above a strip that
// already has to scroll sideways on a 360px phone.
//
// ⚠ WHAT THIS FILE IS REALLY GUARDING is not the tidy-up. It is the ACCESSIBLE NAME that the tidy-up nearly
// took with it. `Overlay` (app/ui.jsx) falls back to useAutoDialogLabel, which names the dialog after THE
// PANEL'S FIRST LINE OF TEXT. With the heading deleted that first line is the first tab — so a screen-reader
// user would have been told this dialog is called "Serving", which is the exact wrong name the owner asked to
// remove, restored invisibly and only for the people least able to work around it. The fix is the explicit
// `label` on Overlay, and it looks so much like decoration that it is exactly what a later tidy-up deletes.
//
// ⚠ RULE 3: NOTHING HERE MATCHES TEXT IN app/*.jsx. Those ship unbundled, so `false && ` in front of a
// condition leaves every word in place and a source match still passes. Every claim below is about a RENDERED
// tree, or about a prop a rendered component actually received.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts } from './render-jsx-screen.mjs';

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const CHURCH = 'St Chad’s, Falgate';

function serving({ kidsOn = true } = {}) {
  const { React, draw } = miniReact();
  const overlayProps = [];
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
    // Overlay is CAPTURED, not stubbed: the accessible name is a PROP it receives, and a stub that dropped
    // its children would leave every assertion below reading an empty tree.
    Overlay: function Overlay(p) { overlayProps.push(p); return React.createElement('div', { 'data-overlay': !!p.open }, p.open ? p.children : null); },
    SectionLabel: function SectionLabel(p) { return React.createElement('h2', {}, p.children); },
    Icon: Stub('Icon'), IconBtn: Stub('IconBtn'),
    BottomSheet: ({ open, children }) => (open ? children : null),
    CareCard: Stub('CareCard'), SafetyBanner: Stub('SafetyBanner'),
    safeCssColor: (c) => c,
    Math, Date, JSON, Set, Number, String, Array, Promise, Object, isNaN, Boolean,
  };
  const mod = loadScreen('app/screens-serving.jsx', ['ServingScreen'], globals);
  const ctx = {
    church: { name: CHURCH },
    myPubkey: 'me',
    // A cleared worker in an open window, so the Kids tab is really on the strip — the tab whose arrival is
    // what made the old heading wrong.
    checkinRegister: kidsOn
      ? { cleared: true, lapsed: false, notYet: false, withdrawn: false, from: 1, until: 4102444800, lifetime: 'day', sessions: [], keysHeld: 0, unreadable: 0, foreign: 0, settled: true }
      : { cleared: false, lapsed: false, notYet: false, withdrawn: false, from: null, until: null, lifetime: '', sessions: [], keysHeld: 0, unreadable: 0, foreign: 0, settled: true },
    rotaVis: 'church',
    churchRosters: [], churchEvents: [], churchServices: [], churchRotas: [], churchTeams: [],
    servPending: [], servConfirmed: [], servDeclined: [], myRsvps: {},
    care: { settings: { enabled: false }, needs: [], slots: [], myPub: 'me' },
    myChildren: { children: [], askAtDesk: 0, settled: true },
    servingTab: 'serving',
    openHelp() {}, toast() {}, respondServing: async () => true,
    checkinAdd: async () => ({ ok: true }), checkinRelease: async () => ({ ok: true }),
  };
  const render = () => draw(mod.ServingScreen, { open: true, onClose() {}, ctx });
  render();                 // the first draw queues the tab-strip effects…
  const tree = render();    // …the second sees what they settled on
  return { tree, overlayProps, ctx };
}

test('the church name is gone from this page — it is on the screen the member came from', () => {
  const { tree } = serving();
  const all = texts(tree).join(' ');
  assert.ok(!all.includes('St Chad'),
    'the church name is back on the serving page header. A member is inside one church, its name is already ' +
    'on Today, and this line cost a row of vertical space above a tab strip that has to scroll on a 360px ' +
    'phone. Rendered text was: ' + all.slice(0, 400));
});

test('"Serving" appears ONCE, as a tab — not as the name of a page that holds six of them', () => {
  const { tree } = serving();
  const exact = texts(tree).filter(t => String(t).trim() === 'Serving');
  assert.equal(exact.length, 1,
    'there are ' + exact.length + ' bare "Serving" labels on this page. One is the tab. A second is the ' +
    'heading the owner asked to remove: it named one tab out of six and had been wrong since Kids shipped.');
});

test('…and the page still IS serving AND kids AND events — the re-anchor', () => {
  const { tree } = serving();
  const all = texts(tree).join(' ');
  for (const tab of ['Serving', 'Kids', 'Events', 'Calendar']) {
    assert.ok(all.includes(tab),
      're-anchor: the "' + tab + '" tab is not on the rendered strip, so the assertions above are about a ' +
      'page that did not render rather than about a heading that was removed.');
  }
});

test('THE ACCESSIBLE NAME IS SET EXPLICITLY, or a screen reader calls this page "Serving" again', () => {
  const { overlayProps } = serving();
  assert.ok(overlayProps.length, 're-anchor: the screen no longer renders inside an Overlay at all');
  const label = overlayProps[overlayProps.length - 1].label;
  assert.ok(label && String(label).trim(),
    'Overlay got no `label`, so app/ui.jsx\'s useAutoDialogLabel names this dialog after the panel\'s FIRST ' +
    'LINE OF TEXT — which, now the heading is gone, is the first tab. A screen-reader user would be told the ' +
    'page is called "Serving": the wrong name the owner asked to remove, restored invisibly, and only for the ' +
    'people least able to work around it.');
  assert.notEqual(String(label).trim(), 'Serving',
    'the dialog is named "Serving" again — the same wrong name, just moved somewhere sighted users cannot see it');
});

test('a member who is not cleared sees no Kids tab, and the page is still not called Serving', () => {
  // The tidy-up must not depend on which tabs happen to be present: with Kids off, the first line of text is
  // still a tab, and the explicit label is still what stops it becoming the dialog's name.
  const { tree, overlayProps } = serving({ kidsOn: false });
  const all = texts(tree).join(' ');
  assert.ok(!all.includes('Kids'), 're-anchor: an uncleared member was offered the Kids tab');
  assert.ok(!all.includes('St Chad'), 'the church name came back when the Kids tab was absent');
  assert.ok(overlayProps[overlayProps.length - 1].label, 'the accessible name is missing when Kids is off');
});
