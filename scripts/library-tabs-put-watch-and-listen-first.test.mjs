// THE LIBRARY'S TWO-TAB SWITCH READS [Watch & Listen | Library] (owner 2026-10-26), and Library still opens first.
// Run: node --test scripts/library-tabs-put-watch-and-listen-first.test.mjs
//
// Renders the REAL LibraryScreen (app/screens-library.jsx) through the mini-React and reads the buttons it
// draws (CLAUDE.md rules 1 and 3). Not a device test (rule 6): how it looks is for the owner's phone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const { React, draw } = miniReact();
const Icon = function Icon() { return null; };
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
// Sentinels: the screen renders these two as <WatchView/> / <LibraryHome/> children; the mini-React does not
// expand stubbed children, so the element TYPE tells which view is showing.
const WatchView = Stub('WatchView');
const D = { COLLECTIONS: [], MODULES: [], JOURNAL: [] };
const lib = loadScreen('app/screens-library.jsx', ['LibraryScreen', 'LibraryHome'], {
  React, Icon, WatchView, SectionLabel: Stub('SectionLabel'), safeCssColor: (c) => c,
  window: { TrinityData: D, MyData: { count: () => 0 }, Bible: { installedMap: () => ({}), versions: () => [] }, addEventListener() {}, removeEventListener() {} },
  localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout,
  Overlay: Stub('Overlay'), Spinner: Stub('Spinner'), IconBtn: Stub('IconBtn'),
  ScreenScroll: function ScreenScroll(p) { return p.children; },
});
const ctx = { journalEntries: [] };
const view = () => draw(lib.LibraryScreen, { ctx });
const tabs = (t) => find(t, n => n.type === 'button' && find(n, m => m.type === Icon && (m.props.name === 'play' || m.props.name === 'library')).length > 0);
const label = (b) => texts(b).slice(-1)[0];   // texts() also yields the Icon's name prop; the label is the last string
const showing = (t) => ({
  watch: find(t, n => n.type === WatchView).length > 0,
  home: find(t, n => n.type === lib.LibraryHome).length > 0,
});

test('the tabs read Watch & Listen, then Library, left to right', () => {
  assert.deepEqual(tabs(view()).map(label), ['Watch & Listen', 'Library']);
});

test('Library is still the view that opens first, not Watch & Listen', () => {
  assert.deepEqual(showing(view()), { watch: false, home: true });
});

test('tapping the first tab opens Watch & Listen; tapping Library brings the home back', () => {
  tabs(view())[0].props.onClick();
  assert.deepEqual(showing(view()), { watch: true, home: false });
  tabs(view())[1].props.onClick();
  assert.deepEqual(showing(view()), { watch: false, home: true });
});
