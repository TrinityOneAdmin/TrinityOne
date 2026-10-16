// Library -> Notes: tapping a note opens an editor on its text; Save writes back through MyData.
// Highlights / Bookmarks / Prayer keep their old tap behaviour. Rendered through the mini-React (rule 1/3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find } from './render-jsx-screen.mjs';

const Stub = (name) => (props) => ({ type: name, props, children: props && props.children });

function setup(id, item) {
  const { React, draw } = miniReact();
  const puts = [], removes = [], toasts = []; let reader = 0;
  const win = {
    MyData: { list: () => [item], on: () => () => {}, remove: (...a) => removes.push(a), setVisibility() {}, put: (...a) => puts.push(a) },
    TrinityData: { COLLECTION_ITEMS: {} }, verseRefLabel: (r) => r,
    addEventListener() {}, removeEventListener() {},
  };
  const g = {
    React, window: win, document: { addEventListener() {}, removeEventListener() {} },
    Icon: Stub('Icon'), IconBtn: Stub('IconBtn'), Spinner: Stub('Spinner'), ScreenScroll: (p) => p.children,
    Overlay: ({ children }) => React.createElement('div', {}, children),
    BottomSheet: ({ open, children }) => open ? React.createElement('div', { 'data-sheet': 1 }, children) : null,
    safeCssColor: (c) => c || 'var(--clay)',
  };
  const { CollectionView } = loadScreen('app/screens-library.jsx', ['CollectionView'], g);
  const ctx = { toast: (m) => toasts.push(m), openReader: () => { reader++; } };
  const props = { coll: { id, name: id, icon: 'bookmark' }, open: true, onClose() {}, ctx };
  const d = () => draw(CollectionView, props);
  return { d, puts, removes, toasts, reader: () => reader };
}
const cards = (tree) => find(tree, n => n.type === 'div' && typeof n.props.onClick === 'function' && n.props.style && n.props.style.borderRadius === 16);
const sheet = (tree) => find(tree, n => n.props && n.props['data-sheet'])[0];
const area = (tree) => find(tree, n => n.type === 'textarea' && n.props['aria-label'] === 'Note text')[0];
const NOTE = { id: 'n1', ref: 'John 1:51', text: 'Heaven open', visibility: 'private', date: 'Today' };

test('tapping a note opens the editor on that note\'s text; Save writes the edit back through MyData.put', () => {
  const s = setup('notes', NOTE);
  let t = s.d();
  assert.ok(!sheet(t), 'sheet open before any tap');
  cards(t)[0].props.onClick();
  t = s.d();
  assert.ok(sheet(t), 'tapping a note did not open an editor');
  assert.equal(area(t).props.value, 'Heaven open');
  assert.equal(s.reader(), 0, 'a note tap still jumps to the reader');
  area(t).props.onChange({ target: { value: 'Heaven open, angels ascending' } });
  t = s.d();
  find(t, n => n.type === 'button' && n.props['aria-label'] === 'Save note')[0].props.onClick();
  assert.equal(s.puts.length, 1);
  assert.equal(s.puts[0][0], 'notes');
  assert.equal(s.puts[0][1].id, 'n1');
  assert.equal(s.puts[0][1].text, 'Heaven open, angels ascending');
  assert.ok(!sheet(s.d()), 'sheet stays open after save');
});

for (const [id, item] of [['highlights', { id: 'h1', ref: 'John 1:1', text: 'In the beginning' }],
  ['bookmarks', { id: 'b1', ref: 'Titus 2:13', text: 'the blessed hope' }],
  ['prayer', { id: 'p1', who: 'Ann', text: 'healing', ref: 'Ps 1:1' }]]) {
  test(`scope guard: tapping in ${id} does not open the note editor`, () => {
    const s = setup(id, item);
    cards(s.d())[0].props.onClick();
    const t = s.d();
    assert.ok(!sheet(t) && !area(t), 'note editor opened');
    if (id !== 'prayer') assert.ok(s.toasts.some(m => /Jumping/.test(m)), 'lost the jump-to-reader behaviour');
  });
}
