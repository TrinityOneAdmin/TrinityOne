// BOOKMARKS CAN BE FILTERED BY TAG FROM A "Tags" DROPDOWN OF TICK BOXES — IN BOTH PLACES (owner, 2026-11-12).
// Run: node --test scripts/bookmark-tag-filter-dropdown.test.mjs
//
// Owner decisions: multi-select, OR (a bookmark shows if it has ANY ticked tag); nothing ticked = all; the SAME
// control in the Study panel's Bookmarks tab (app/screens-read.jsx CommentaryPanel) and Library > Bookmarks
// (app/screens-library.jsx CollectionView, where it replaced a single-select row of tag pills).
//
// Point-of-use (CLAUDE.md rules 1/3): both real screens are compiled from app/*.jsx and DRAWN through the mini
// React in render-jsx-screen.mjs, with the REAL shared TagFilterMenu compiled from app/ui.jsx. The tests open the
// dropdown, tick boxes as a member would, and read which bookmark rows are drawn. Nothing matches text in app/*.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, texts, reads } from './render-jsx-screen.mjs';

function realTagMenu(React, Icon, wrapEl) {
  // wrapEl: give the menu's wrapper ref a real EventTarget so its NATIVE keydown listener (the one a browser uses)
  // is attached by the real effect; the mini React does not attach refs itself.
  if (wrapEl) { let n = 0; const base = React; React = { ...base, useRef: (i) => { const r = base.useRef(i); if (n++ % 2 === 0) r.current = wrapEl; return r; } }; }
  return loadScreen('app/ui.jsx', ['TagFilterMenu'], {
    React, window: {}, Icon, document: { addEventListener() {}, removeEventListener() {} }, PhoneFrame: () => null,
    localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout, navigator: {},
  }).TagFilterMenu;
}

// ── the Study panel (CommentaryPanel), opened on its Bookmarks tab ──
const BOOKS = { 1: 'Genesis', 19: 'Psalms', 43: 'John' };
function study(bookmarks, items) {
  const { React, draw } = miniReact();
  const Icon = ({ name }) => React.createElement('i', { 'data-icon': name });
  const Bible = {
    parseRef: () => null, refKey: (l, v) => l.book + '.' + l.chap + '.' + v,
    refLabel: (l, v) => BOOKS[l.book] + ' ' + l.chap + ':' + v,
    getCommentary: () => [], getCrossRefs: () => ({}), subscribe: () => () => {},
  };
  const mod = loadScreen('app/screens-read.jsx', ['CommentaryPanel'], {
    React, Bible, window: { Bible, sanitizeHtml: (x) => x }, Icon, TagFilterMenu: realTagMenu(React, Icon),
    IconBtn: () => null, BottomSheet: () => null, Btn: () => null, Empty: () => null, Pill: () => null, Chip: () => null,
    setTimeout: () => 0, clearTimeout() {},
  });
  const ctx = { notes: {}, version: 'kjv', bookmarks, bookmarkItems: items, setNote() {}, toggleBookmark() {}, gotoRef() {} };
  const props = { loc: { book: 1, chap: 1 }, label: 'Genesis 1', open: true, onClose() {}, ctx, docked: true };
  const redraw = () => draw(mod.CommentaryPanel, props);
  find(redraw(), n => n.type === 'button' && n.props['data-tab'] === 'bookmarks')[0].props.onClick();
  return { redraw, rows: () => find(redraw(), n => n.props && n.props['data-bookmark']).map(r => r.props['data-bookmark']) };
}

// ── Library > Bookmarks (CollectionView) ──
function library(list) {
  const { React, draw } = miniReact();
  const Stub = (name) => (props) => ({ type: name, props, children: props && props.children });
  const Icon = Stub('Icon');
  const { CollectionView } = loadScreen('app/screens-library.jsx', ['CollectionView'], {
    React, window: { MyData: { list: () => list, on: () => () => {}, remove() {}, setVisibility() {}, put() {} }, TrinityData: { COLLECTION_ITEMS: {} }, verseRefLabel: (r) => r },
    document: { addEventListener() {}, removeEventListener() {} },
    Icon, IconBtn: Stub('IconBtn'), Spinner: Stub('Spinner'), ScreenScroll: (p) => p.children,
    Overlay: ({ children }) => React.createElement('div', {}, children),
    BottomSheet: ({ open, children }) => open ? React.createElement('div', {}, children) : null,
    safeCssColor: (c) => c || 'var(--clay)', TagFilterMenu: realTagMenu(React, Icon),
  });
  const props = { coll: { id: 'bookmarks', name: 'Bookmarks', icon: 'bookmark' }, open: true, onClose() {}, ctx: { toast() {}, openReader() {} } };
  const redraw = () => draw(CollectionView, props);
  const setOpen = (o) => { props.open = o; };
  const cards = (t) => find(t, n => n.type === 'div' && typeof n.props.onClick === 'function' && n.props.style && n.props.style.borderRadius === 16);
  return { redraw, setOpen, rows: () => cards(redraw()).map(c => find(c, n => n.type === 'span' && n.props.style && n.props.style.textOverflow === 'ellipsis').map(reads)[0]) };
}

const menuBtn = (t) => find(t, n => n.type === 'button' && n.props['data-tag-filter-button'])[0];
const option = (t, tag) => find(t, n => n.type === 'button' && n.props['data-tag-option'] === tag)[0];
const options = (t) => find(t, n => n.type === 'button' && n.props['data-tag-option'] !== undefined);
const openMenu = (s) => { menuBtn(s.redraw()).props.onClick(); return s.redraw(); };
const tick = (s, tag) => { option(s.redraw(), tag).props.onClick(); return s.redraw(); };

// Same fixture in both screens: three tagged bookmarks and one untagged.
const STUDY = () => study(['43.3.16', '1.1.3', '19.23.1', '43.1.1'], [
  { ref: '43.3.16', tags: ['hope', 'sermon'] }, { ref: '1.1.3', tags: ['creation'] }, { ref: '19.23.1', tags: ['hope'] }, { ref: '43.1.1' }]);
const LIB = () => library([
  { id: 'a', ref: 'John 3:16', text: 'x', tags: ['hope', 'sermon'] }, { id: 'b', ref: 'Genesis 1:3', text: 'x', tags: ['creation'] },
  { id: 'c', ref: 'Psalms 23:1', text: 'x', tags: ['hope'] }, { id: 'd', ref: 'John 1:1', text: 'x' }]);
const SCREENS = [
  ['Study panel', STUDY, { all: ['1.1.3', '19.23.1', '43.1.1', '43.3.16'], hope: ['19.23.1', '43.3.16'], hopeOrCreation: ['1.1.3', '19.23.1', '43.3.16'] }],
  ['Library', LIB, { all: ['John 3:16', 'Genesis 1:3', 'Psalms 23:1', 'John 1:1'], hope: ['John 3:16', 'Psalms 23:1'], hopeOrCreation: ['John 3:16', 'Genesis 1:3', 'Psalms 23:1'] }],
];

for (const [where, make, want] of SCREENS) {
  test(`${where}: the Tags dropdown lists every tag, sorted, as tick boxes; ticking one filters the rows; the button counts`, () => {
    const s = make();
    assert.deepEqual(s.rows(), want.all, 'all bookmarks must show before anything is ticked');
    let t = s.redraw();
    assert.equal(menuBtn(t).props['aria-expanded'], false);
    assert.equal(reads(menuBtn(t)), 'Tags');
    assert.equal(options(t).length, 0, 'the menu is open before the button is tapped');
    t = openMenu(s);
    assert.equal(menuBtn(t).props['aria-expanded'], true);
    assert.deepEqual(options(t).map(o => o.props['data-tag-option']), ['creation', 'hope', 'sermon']);
    options(t).forEach(o => { assert.equal(o.props.role, 'checkbox'); assert.equal(o.props['aria-checked'], false); });
    t = tick(s, 'hope');
    assert.equal(option(t, 'hope').props['aria-checked'], true);
    assert.equal(reads(menuBtn(t)), 'Tags · 1');
    assert.deepEqual(s.rows(), want.hope);
  });

  test(`${where}: ticking two tags shows the UNION; unticking and Clear restore every bookmark`, () => {
    const s = make();
    openMenu(s); tick(s, 'hope');
    const t = tick(s, 'creation');
    assert.equal(reads(menuBtn(t)), 'Tags · 2');
    assert.deepEqual(s.rows(), want.hopeOrCreation, 'two ticks must OR, not AND');
    tick(s, 'creation');
    assert.deepEqual(s.rows(), want.hope, 'unticking did not widen the list again');
    find(s.redraw(), n => n.type === 'button' && n.props['data-tag-filter-clear'])[0].props.onClick();
    assert.deepEqual(s.rows(), want.all, 'Clear did not restore every bookmark');
    assert.equal(reads(menuBtn(s.redraw())), 'Tags');
  });

  test(`${where}: a tap outside the menu closes it and keeps the filter`, () => {
    const s = make();
    openMenu(s); tick(s, 'hope');
    find(s.redraw(), n => n.props && n.props['data-tag-filter-backdrop'])[0].props.onClick();
    const t = s.redraw();
    assert.equal(options(t).length, 0, 'the menu stayed open');
    assert.equal(menuBtn(t).props['aria-expanded'], false);
    assert.deepEqual(s.rows(), want.hope);
  });

  test(`${where}: Escape closes the menu`, () => {
    const s = make();
    const t = openMenu(s);
    const wrap = find(t, n => n.props && n.props['data-tag-filter'])[0];
    wrap.props.onKeyDown({ key: 'Escape', stopPropagation() {} });
    assert.equal(options(s.redraw()).length, 0);
  });
}

test('Study panel: with no tagged bookmarks there is no Tags control', () => {
  const s = study(['43.3.16', '1.1.3'], [{ ref: '43.3.16' }, { ref: '1.1.3', tags: [] }]);
  const t = s.redraw();
  assert.equal(s.rows().length, 2);
  assert.equal(find(t, n => n.props && n.props['data-tag-filter']).length, 0);
});

test('Library: with no tagged bookmarks there is no Tags control', () => {
  const s = library([{ id: 'a', ref: 'John 3:16', text: 'x' }, { id: 'b', ref: 'John 1:1', text: 'x', tags: [] }]);
  const t = s.redraw();
  assert.equal(s.rows().length, 2);
  assert.equal(find(t, n => n.props && n.props['data-tag-filter']).length, 0);
});

// "Matches nothing": the only way to reach it through the control is a ticked tag whose bookmarks are
// hidden by something else — in the Library, the search box. (The Study panel has no search, and every offered
// tag belongs to a drawn bookmark, so there the empty state is reached by the bookmark carrying it going away.)
test('Library: a tag filter that matches nothing shows "No bookmarks with these tags" and a Clear that restores the list', () => {
  const s = LIB();
  openMenu(s); tick(s, 'creation');
  const input = find(s.redraw(), n => n.type === 'input')[0];
  input.props.onChange({ target: { value: 'x' } });   // every row's text is 'x', so search alone hides nothing
  assert.deepEqual(s.rows(), ['Genesis 1:3']);
  // now search for a verse that does not carry the ticked tag
  find(s.redraw(), n => n.type === 'input')[0].props.onChange({ target: { value: 'John' } });
  let t = s.redraw();
  assert.deepEqual(s.rows(), []);
  assert.ok(texts(t).some(x => /No bookmarks with these tags/.test(x)), 'no empty-state message for a filter that matches nothing');
  find(t, n => n.type === 'button' && n.props['data-tag-filter-empty-clear'])[0].props.onClick();
  assert.deepEqual(s.rows(), ['John 3:16', 'John 1:1']);
});

// The Study panel has no search box and offers only tags that are on a drawn bookmark, so a filter there cannot
// match nothing. What CAN happen is the ticked tag's last bookmark losing it (edited on the verse card) — the
// stale tick must drop, not leave the list filtered to nothing.
test('Study panel: a ticked tag that no bookmark carries any more is dropped, so the list is never filtered to nothing', () => {
  const items = [{ ref: '43.3.16', tags: ['hope'] }, { ref: '1.1.3', tags: ['creation'] }];
  const s = study(['43.3.16', '1.1.3'], items);
  openMenu(s); tick(s, 'hope');
  assert.deepEqual(s.rows(), ['43.3.16']);
  items[0].tags = ['grace'];
  const t = s.redraw();
  assert.deepEqual(s.rows(), ['1.1.3', '43.3.16'], 'a stale tick hid every bookmark');
  assert.equal(reads(menuBtn(t)), 'Tags');
  assert.equal(find(t, n => n.props && n.props['data-tag-option'] === 'hope').length, 0);
});

// REAL-BROWSER Escape: React 18 never runs the onKeyDown Escape branch, because the menu's NATIVE keydown listener
// on its wrapper stops the event first. So drive THAT path: a real keydown event dispatched on the wrapper element.
test('Escape as a browser delivers it (native keydown on the menu) closes the menu and does not leak outward', () => {
  const wrap = new EventTarget(); wrap.querySelector = () => null;
  const { React, draw } = miniReact();
  const Icon = () => null;
  const Menu = realTagMenu(React, Icon, wrap);
  let tagged = [];
  const redraw = () => draw(Menu, { tags: ['hope'], selected: tagged, onChange: (v) => { tagged = v; } });
  menuBtn(redraw()).props.onClick();
  redraw();   // effects run after this draw, attaching the native listener
  assert.equal(options(redraw()).length, 1, 'menu not open');
  const ev = new Event('keydown', { cancelable: true }); ev.key = 'Escape';
  wrap.dispatchEvent(ev);
  assert.equal(options(redraw()).length, 0, 'native Escape did not close the menu');
  assert.equal(ev.cancelBubble, true, 'native Escape was not stopped from reaching the panel behind');
  const ev2 = new Event('keydown'); ev2.key = 'a'; wrap.dispatchEvent(ev2);
  assert.equal(ev2.cancelBubble, false);
});

// ── Library: things the first cut claimed but nothing pinned ──
test('Library: the filter is reset when the overlay is reopened', () => {
  const s = LIB();
  openMenu(s); tick(s, 'hope');
  assert.deepEqual(s.rows(), ['John 3:16', 'Psalms 23:1']);
  s.setOpen(false); s.redraw();
  s.setOpen(true); s.redraw();   // the on-open effect runs after this draw; React then re-renders
  assert.deepEqual(s.rows(), ['John 3:16', 'Genesis 1:3', 'Psalms 23:1', 'John 1:1'], 'a tick survived closing and reopening');
  assert.equal(reads(menuBtn(s.redraw())), 'Tags');
});

test('Library: a tick whose tag has gone is forgotten, and does not come back when the tag returns', () => {
  const list = [{ id: 'a', ref: 'John 3:16', text: 'x', tags: ['hope'] }, { id: 'b', ref: 'Genesis 1:3', text: 'x', tags: ['creation'] }];
  const s = library(list);
  openMenu(s); tick(s, 'hope');
  assert.deepEqual(s.rows(), ['John 3:16']);
  list[0].tags = ['grace'];
  assert.deepEqual(s.rows(), ['John 3:16', 'Genesis 1:3'], 'a stale tick hid the list');
  list[0].tags = ['hope'];
  assert.deepEqual(s.rows(), ['John 3:16', 'Genesis 1:3'], 'a forgotten tick came back');
  assert.equal(reads(menuBtn(s.redraw())), 'Tags');
});

test('Study panel: a tick whose tag has gone does not come back when the tag returns', () => {
  const items = [{ ref: '43.3.16', tags: ['hope'] }, { ref: '1.1.3', tags: ['creation'] }];
  const s = study(['43.3.16', '1.1.3'], items);
  openMenu(s); tick(s, 'hope');
  items[0].tags = ['grace']; s.redraw();
  items[0].tags = ['hope'];
  assert.deepEqual(s.rows(), ['1.1.3', '43.3.16'], 'a forgotten tick came back');
  assert.equal(reads(menuBtn(s.redraw())), 'Tags');
});

test('Library: tags are compared as text (number 1 and "1" are one row) and a string `tags` does not crash a card', () => {
  const s = library([{ id: 'a', ref: 'John 3:16', text: 'x', tags: [1] }, { id: 'b', ref: 'Genesis 1:3', text: 'x', tags: ['1'] },
    { id: 'c', ref: 'Psalms 23:1', text: 'x', tags: 'hope' }, { id: 'd', ref: 'John 1:1', text: 'x', tags: ['2', '2'] }]);
  const t = openMenu(s);
  assert.deepEqual(options(t).map(o => o.props['data-tag-option']), ['1', '2'], 'one tag drawn as two rows, or a string tags offered');
  assert.equal(s.rows().length, 4, 'a bookmark with string tags broke the list');
  tick(s, '1');
  assert.deepEqual(s.rows(), ['John 3:16', 'Genesis 1:3'], 'ticking 1 must match both the number and the text');
});
