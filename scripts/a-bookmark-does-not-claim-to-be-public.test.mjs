// A BOOKMARK NEVER CALLS ITSELF PUBLIC. Owner decision 2026-10-13, after the chip was found inert.
//
// The Library drew a green "Public" chip on every bookmark and highlight. Nothing reads an item's
// `visibility`: the only three mentions in the tree are defVis(), the write in put(), and setVisibility()
// itself. And personal documents have been DEVICE-ONLY since the owner's 2026-09-27 decision (D1, see the
// comment in src/mydata.src.js) -- they are never published to a relay at all, so a bookmark CANNOT be
// public and the chip was asserting the opposite on the one screen a member checks for it.
//
// Rendered, not grepped: app/*.jsx ships UNBUNDLED, so `false && ` in front of the chip would leave every
// word of it in the file and any text-matching assertion would still pass (CLAUDE.md rule 3). These drive
// the real CollectionView through the repo's mini-React and read the tree back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, reads } from './render-jsx-screen.mjs';

const Stub = (name) => (props) => ({ type: name, props, children: props && props.children });

// The real CollectionView, rendered over one item of the given collection.
function drawCollection(id, item) {
  const { React, draw } = miniReact();
  const win = {
    MyData: { list: () => [item], on: () => () => {}, remove() {}, setVisibility() {}, put() {} },
    TrinityData: { COLLECTION_ITEMS: {} },
    verseRefLabel: (r) => r,
    addEventListener() {}, removeEventListener() {},
  };
  const g = {
    React, window: win, document: { addEventListener() {}, removeEventListener() {} },
    Icon: Stub('Icon'), IconBtn: Stub('IconBtn'), Spinner: Stub('Spinner'), ScreenScroll: (p) => p.children,
    Overlay: ({ children }) => React.createElement('div', {}, children),
    safeCssColor: (c) => c || 'var(--clay)',
  };
  const { CollectionView } = loadScreen('app/screens-library.jsx', ['CollectionView'], g);
  const tree = draw(CollectionView, { coll: { id, name: id, icon: 'bookmark' }, open: true, onClose() {}, ctx: { toast() {} } });
  return tree;
}

// The chip is the ONLY control in this screen whose title is the visibility wording, so a title match
// identifies it without depending on which of the two words it happened to render.
const chips = (tree) => find(tree, n => n && n.props && typeof n.props.title === 'string'
  && /^(Public|Private — only you)$/.test(n.props.title));
const deletes = (tree) => find(tree, n => n && n.props && n.props['aria-label'] === 'Delete');

const BOOKMARK  = { id: 'b1', ref: 'Titus 2:13', text: 'the blessed hope', visibility: 'public', date: 'Today' };
const HIGHLIGHT = { id: 'h1', ref: 'John 1:1',   text: 'In the beginning', visibility: 'public', date: 'Today' };
const NOTE      = { id: 'n1', ref: 'John 1:51',  text: 'Heaven open',      visibility: 'private', date: 'Today' };

test('a bookmark carries NO public/private chip, and does not say "Public" anywhere', () => {
  const tree = drawCollection('bookmarks', BOOKMARK);
  assert.equal(chips(tree).length, 0, 'the visibility chip is still drawn on a bookmark');
  const t = reads(tree);
  assert.match(t, /Titus 2:13/, 'the bookmark did not render at all — re-anchor this test');
  assert.doesNotMatch(t, /\bPublic\b/, 'a bookmark still reads "Public": ' + t);
});

test('a highlight carries NO public/private chip', () => {
  const tree = drawCollection('highlights', HIGHLIGHT);
  assert.equal(chips(tree).length, 0, 'the visibility chip is still drawn on a highlight');
  assert.doesNotMatch(reads(tree), /\bPublic\b/);
});

// Scoped, not blanket: the chip must still exist for the collections the owner did NOT ask about, or a
// later reader would think the whole control had been deleted and restore it everywhere.
test('a note KEEPS its chip — the removal is scoped to bookmarks and highlights', () => {
  const tree = drawCollection('notes', NOTE);
  assert.equal(chips(tree).length, 1, 'the chip was removed from notes too — the owner asked only for bookmarks and highlights');
});

// The chip shared a footer row with Delete. Removing it must not take the row with it.
test('the Delete control survives on a bookmark', () => {
  assert.equal(deletes(drawCollection('bookmarks', BOOKMARK)).length, 1, 'Delete went with the chip');
  assert.equal(deletes(drawCollection('notes', NOTE)).length, 1);
});
