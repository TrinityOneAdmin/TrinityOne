// TAPPING A CROSS-REFERENCE OPENS THAT VERSE — not the last page you read.
//
// Owner-reported 2026-10-14 with a screenshot: on the Library "Cross References" page, tapping a reference
// "just takes us to the last read bible page". The card's whole-row handler called ctx.openReader() with NO
// target, so the reader simply re-opened wherever it was (typically the active plan reading). The individual
// references (Genesis 1:1 · 1 John 1:1 · …) were not tappable at all — they were plain text in a <p>.
//
// The fix (owner's chosen design, matching Olive Tree / Logos / SwordSearcher): every reference on a card is
// a control; tapping one previews that verse in place, and an "Open in reader" button navigates to it via
// ctx.gotoRef(book, chap, verse).
//
// Rendered, not grepped (CLAUDE.md rule 3): app/*.jsx ships UNBUNDLED, so `false && ` in front of the new
// path would leave every word in the file and a text match would still pass. This drives the REAL
// CollectionView through the repo's mini-React and reads the tree back, so a revert to openReader() — or
// deleting the tappable refs from the screen — fails here (rule 1: the feature must be tested at the point of
// use, on the screen, not only in an engine).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, button, reads } from './render-jsx-screen.mjs';

const Stub = (name) => (props) => ({ type: name, props, children: props && props.children });

// parseRef the way the shipped engine does, for the references this fixture uses: "Book C:V" -> {book,chap,verse}.
// The book NAME is carried through verbatim so the test can assert gotoRef received the reference that was tapped.
const parseRef = (s) => {
  const m = /^(.*?)\s+(\d+):(\d+)\s*$/.exec(String(s || ''));
  return m ? { book: m[1], chap: Number(m[2]), verse: Number(m[3]) } : null;
};

// Mount the real CollectionView over one cross-reference item and keep `draw` so a tap can be re-rendered.
function mount(item) {
  const gotoCalls = [];
  const openReaderCalls = [];
  const { React, draw } = miniReact();
  const win = {
    MyData: { list: () => [], on: () => () => {}, remove() {}, setVisibility() {}, put() {} },
    TrinityData: { COLLECTION_ITEMS: { crossrefs: [item] } },
    verseRefLabel: (r) => r,
    addEventListener() {}, removeEventListener() {},
  };
  const Bible = {
    parseRef,
    // Enough verses that any single-digit verse in the fixture resolves to real text (the preview path).
    getVerses: () => Array.from({ length: 40 }, (_, i) => ({ v: i + 1, text: 'verse ' + (i + 1) + ' text' })),
  };
  const g = {
    React, window: win, Bible,
    document: { addEventListener() {}, removeEventListener() {} },
    Icon: Stub('Icon'), IconBtn: Stub('IconBtn'), Spinner: Stub('Spinner'), ScreenScroll: (p) => p.children,
    Overlay: ({ children }) => React.createElement('div', {}, children),
    BottomSheet: ({ open, children }) => (open ? React.createElement('div', {}, children) : null),
    safeCssColor: (c) => c || 'var(--clay)',
  };
  const { CollectionView } = loadScreen('app/screens-library.jsx', ['CollectionView'], g);
  const ctx = {
    version: 'BSB', toast() {},
    gotoRef: (book, chap, verse) => gotoCalls.push({ book, chap, verse }),
    openReader: () => openReaderCalls.push(true),
  };
  const props = { coll: { id: 'crossrefs', name: 'Cross References', icon: 'link' }, open: true, onClose() {}, ctx };
  return { draw: () => draw(CollectionView, props), gotoCalls, openReaderCalls };
}

const XREF = { ref: 'John 1:1', text: 'Genesis 1:1 · 1 John 1:1 · Revelation 19:13' };

// A button whose visible text is exactly a reference (the control a reader taps).
const refButton = (tree, label) => button(tree, label).filter(n => reads(n).trim() === label);

test('each reference on a cross-ref card is its own control (not plain text)', () => {
  const { draw } = mount(XREF);
  const tree = draw();
  for (const r of ['Genesis 1:1', '1 John 1:1', 'Revelation 19:13']) {
    assert.ok(refButton(tree, r).length >= 1, `"${r}" is not a tappable control on the cross-ref card`);
  }
  // the source verse heading is tappable too
  assert.ok(refButton(tree, 'John 1:1').length >= 1, 'the source reference John 1:1 is not tappable');
});

test('tapping a reference then "Open in reader" navigates to THAT verse (gotoRef), never the last page (openReader)', () => {
  const { draw, gotoCalls, openReaderCalls } = mount(XREF);
  let tree = draw();
  // tap the first cross-reference
  refButton(tree, 'Genesis 1:1')[0].props.onClick();
  tree = draw();
  // the preview is now open with the verse and the single navigation control
  assert.match(reads(tree), /verse 1 text/, 'the preview did not show the verse text');
  const open = button(tree, 'Open in reader');
  assert.equal(open.length, 1, 'the "Open in reader" control is missing from the preview');
  open[0].props.onClick();
  assert.deepEqual(gotoCalls, [{ book: 'Genesis', chap: 1, verse: 1 }],
    'tapping a cross-reference did not navigate to that exact verse via gotoRef');
  assert.equal(openReaderCalls.length, 0,
    'the old openReader() path is still wired — it re-opens the last page instead of the referenced verse');
});

test('a different reference opens its OWN verse, not a fixed one', () => {
  const { draw, gotoCalls } = mount(XREF);
  let tree = draw();
  refButton(tree, 'Revelation 19:13')[0].props.onClick();
  tree = draw();
  button(tree, 'Open in reader')[0].props.onClick();
  assert.deepEqual(gotoCalls, [{ book: 'Revelation', chap: 19, verse: 13 }]);
});
