// THE LIBRARY'S SECTIONS FOLD SHUT WITH A CHEVRON (owner 2026-10-14, cosmetic #3).
// Run: node --test scripts/library-sections-fold-with-a-chevron.test.mjs
//
// Renders the REAL LibraryHome (app/screens-library.jsx) and the REAL SectionLabel (app/ui.jsx) through the
// mini-React, so deleting the chevron or the fold from the screen turns it red (CLAUDE.md rules 1 and 3).
// Not a device test (rule 6): the animation and the 18px tap size are for the owner's phone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const { React, draw } = miniReact();
// Icon is a stub that keeps its props, so the chevron direction (its `name`) can be read.
const Icon = function Icon() { return null; };
const ui = loadScreen('app/ui.jsx', ['SectionLabel'], {
  React, window: {}, Icon, document: { addEventListener() {}, removeEventListener() {} },
  localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout, navigator: {},
});
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const D = {
  COLLECTIONS: [],
  MODULES: [{ id: 'bibles', name: 'Bibles' }, { id: 'dictionaries', name: 'Dictionaries' }],
  JOURNAL: [],
};
const lib = loadScreen('app/screens-library.jsx', ['LibraryHome'], {
  React, Icon, SectionLabel: ui.SectionLabel, safeCssColor: (c) => c,
  window: { TrinityData: D, MyData: { count: () => 0 }, Bible: { installedMap: () => ({}), versions: () => [] }, addEventListener() {}, removeEventListener() {} },
  localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout,
  Overlay: Stub('Overlay'), Spinner: Stub('Spinner'), IconBtn: Stub('IconBtn'), ScreenScroll: Stub('ScreenScroll'),
});
const ctx = { journalEntries: [{ id: 'j1', title: 'My reflection', body: 'b', date: 'today', color: 'red' }], openJournal() {}, newJournal() {} };
const view = () => draw(lib.LibraryHome, { ctx });
const toggle = (tree, name) => find(tree, n => n.type === 'button' && n.props['aria-label'] === name)[0];
const chevronOf = (btn) => find(btn, n => n.type === Icon).map(n => n.props.name)[0];

test('every Library section has a chevron, open (down) by default, with everything showing', () => {
  const t = view();
  for (const s of ['Modules', 'Listen', 'Recent journal']) {
    const b = toggle(t, 'Collapse ' + s);
    assert.ok(b, `no collapse control on the ${s} section`);
    assert.equal(chevronOf(b), 'chevD');
    assert.equal(b.props['aria-expanded'], true);
  }
  const all = texts(t).join(' | ');
  assert.ok(all.includes('Dictionaries') && all.includes('Audio Bibles') && all.includes('My reflection'), all);
});

test('tapping a chevron hides only that section and flips it up; tapping again restores it', () => {
  toggle(view(), 'Collapse Modules').props.onClick();
  let t = view();
  const all = texts(t).join(' | ');
  assert.ok(!all.includes('Dictionaries'), 'THE DEFECT: the Modules items stay on screen after folding');
  assert.ok(all.includes('Audio Bibles') && all.includes('My reflection'), 'folding Modules must not fold the other sections');
  const open = toggle(t, 'Expand Modules');
  assert.ok(open, 'folded section did not offer Expand');
  assert.equal(chevronOf(open), 'chevU');
  assert.equal(open.props['aria-expanded'], false);
  assert.ok(texts(t).includes('Modules'), 'the header must stay so the section can be reopened');

  open.props.onClick();
  t = view();
  assert.ok(texts(t).join(' | ').includes('Dictionaries'), 'expanding did not bring the items back');
  assert.equal(chevronOf(toggle(t, 'Collapse Modules')), 'chevD');
});

test('Listen and Recent journal fold too, and + New stays reachable while the journal is folded', () => {
  toggle(view(), 'Collapse Listen').props.onClick();
  assert.ok(!texts(view()).join(' | ').includes('Audio Bibles'));
  toggle(view(), 'Collapse Recent journal').props.onClick();
  const t = view();
  assert.ok(!texts(t).join(' | ').includes('My reflection'));
  assert.equal(find(t, n => n.type === 'button' && texts(n).join('') === '+ New').length, 1, '+ New vanished with the fold');
});

test('the Library sections are on screen in order: Listen, Recent journal, Modules (owner 2026-10-26)', () => {
  // The mini-React keeps state between draws, so reopen whatever an earlier test left folded.
  for (const s of ['Listen', 'Recent journal', 'Modules']) { const b = toggle(view(), 'Expand ' + s); if (b) b.props.onClick(); }
  const t = view();
  const labels = ['Listen', 'Recent journal', 'Modules'];
  // SectionLabel renders a text node per heading; read them in document order from the rendered tree.
  const seen = texts(t).filter(x => labels.includes(x));
  assert.deepEqual(seen, labels, 'THE DEFECT: Modules is not below Listen and Recent journal');
  // And the content follows its own heading: Audio Bibles, then the journal entry, then the module tiles.
  const flat = texts(t);
  const at = (s) => flat.findIndex(x => x.includes(s));
  assert.ok(at('Audio Bibles') < at('My reflection') && at('My reflection') < at('Dictionaries'), flat.join(' | '));
});
