// THE READER'S STUDY PANEL LISTS THE MEMBER'S BOOKMARKS, AND EACH ONE JUMPS TO ITS VERSE (owner 2026-10-15).
// Run: node --test scripts/study-panel-lists-bookmarks.test.mjs
//
// Point-of-use (CLAUDE.md rule 1/3): the real CommentaryPanel is loaded from app/screens-read.jsx through the
// mini React and DRAWN; the tests tap the Bookmarks segment a member would tap and read what is drawn. Nothing
// here matches text in app/*.jsx.
//
// Users of what changed (rule 2): CommentaryPanel only (its `view` state gained 'bookmarks'; the segment
// buttons were made a little narrower to fit a 4th). Its one caller is ReadScreen. ctx.bookmarks /
// ctx.toggleBookmark (app.jsx) are READ and CALLED, not changed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, texts, reads } from './render-jsx-screen.mjs';

const BOOKS = { 1: 'Genesis', 19: 'Psalms', 43: 'John' };
function panel(bookmarks, items = [], noItems = false) {
  const { React, draw } = miniReact();
  const calls = { goto: [], toggled: [], closed: 0 };
  const Bible = {
    parseRef: (s) => { const m = /^John (\d+):(\d+)$/.exec(String(s)); return m ? { book: 43, chap: +m[1], verse: +m[2] } : null; }, refKey: (l, v) => l.book + '.' + l.chap + '.' + v,
    refLabel: (l, v) => BOOKS[l.book] + ' ' + l.chap + ':' + v,
    getCommentary: () => [], getCrossRefs: () => ({}), subscribe: () => () => {},
  };
  const mod = loadScreen('app/screens-read.jsx', ['CommentaryPanel'], {
    React, Bible, window: { Bible, sanitizeHtml: (x) => x },
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    IconBtn: () => null, BottomSheet: () => null, Btn: () => null, Empty: () => null, Pill: () => null, Chip: () => null,
    setTimeout: () => 0, clearTimeout() {},
  });
  const ctx = { notes: {}, version: 'kjv', bookmarks, ...(noItems ? {} : { bookmarkItems: items }), setNote() {}, toggleBookmark: (k) => calls.toggled.push(k), gotoRef: (b, c, v) => calls.goto.push([b, c, v]) };
  const props = { loc: { book: 1, chap: 1 }, label: 'Genesis 1', open: true, onClose: () => { calls.closed++; }, ctx, docked: true };
  return { calls, redraw: () => draw(mod.CommentaryPanel, props) };
}
const seg = (t, re) => find(t, n => n.type === 'button' && re.test(reads(n)))[0];
const rows = (t) => find(t, n => n.props && n.props['data-bookmark']);

test('Study panel: a Bookmarks tab lists every bookmarked verse (all books, reading order, readable names)', () => {
  const p = panel(['43.3.16', '1.1.3', '19.23.1']);
  let t = p.redraw();
  assert.equal(rows(t).length, 0, 'control: bookmarks must not show on the Commentary tab');
  const tab = seg(t, /^Bookmarks\s?3$/);
  assert.ok(tab, 'no "Bookmarks" tab carrying a count of 3 in the Study panel');
  assert.equal(find(tab, n => n.props && n.props['data-tab-count'] === 3).length, 1, 'the count is not a badge on the tab');
  tab.props.onClick();
  t = p.redraw();
  assert.deepEqual(rows(t).map(r => reads(r)), ['Genesis 1:3', 'Psalms 23:1', 'John 3:16']);
});

test('Study panel: tapping a bookmark closes the panel and jumps to that verse; X removes it without jumping', () => {
  const p = panel(['43.3.16', '1.1.3']);
  seg(p.redraw(), /^Bookmarks/).props.onClick();
  const t = p.redraw();
  const john = rows(t).find(r => reads(r) === 'John 3:16');
  const go = find(john, n => n.type === 'button')[0];
  go.props.onClick();
  assert.deepEqual(p.calls.goto, [[43, 3, 16]]);
  assert.equal(p.calls.closed, 1);
  const rm = find(john, n => n.type === 'button' && /^Remove bookmark/.test(String(n.props['aria-label'])))[0];
  rm.props.onClick();
  assert.deepEqual(p.calls.toggled, ['43.3.16'], 'remove must hand toggleBookmark the stored key');
  assert.deepEqual(p.calls.goto, [[43, 3, 16]], 'removing must not navigate');
});

test('Study panel: with no bookmarks the tab says so', () => {
  const p = panel([]);
  let t = p.redraw();
  seg(t, /^Bookmarks$/).props.onClick();
  t = p.redraw();
  assert.equal(rows(t).length, 0);
  assert.ok(texts(t).some(s => /No bookmarks yet/.test(s)));
});

test('Study panel: tabs never squish — two rows of two, every tab reachable by tap, counts are badges, labels are short', () => {
  const p = panel(['43.3.16', '1.1.3']);
  const t = p.redraw();
  const tabs = find(t, n => n.type === 'button' && n.props && n.props['data-tab']);
  assert.deepEqual(tabs.map(b => b.props['data-tab']), ['commentary', 'crossrefs', 'notes', 'bookmarks']);
  assert.deepEqual(tabs.map(b => reads(b).replace(/\d+$/, '')), ['Commentary', 'Cross refs', 'Notes', 'Bookmarks']);
  // two rows of two: the four tabs sit in ONE grid container with exactly two equal columns, and nothing scrolls sideways
  const grid = find(t, n => n.type === 'div' && n.props && n.props['data-tab-grid'])[0];
  assert.ok(grid, 'the tabs are not in a grid');
  assert.equal(grid.props.style.display, 'grid');
  assert.equal(grid.props.style.gridTemplateColumns, '1fr 1fr', 'the grid is not two columns (so four tabs = two rows of two)');
  assert.equal(find(grid, n => n.type === 'button' && n.props['data-tab']).length, 4, 'a tab is outside the grid');
  assert.notEqual(grid.props.style.overflowX, 'auto', 'the tab row still scrolls sideways');
  tabs.forEach(b => assert.equal(b.props.style.flex, undefined, b.props['data-tab'] + ' tab is still a flex-row item'));
  assert.equal(find(grid, n => n.props && n.props['data-tab-count']).length, 1, 'only Bookmarks has a count here (no notes) — and it must be a badge');
  assert.equal(texts(t).some(s => /·\s*\d/.test(s)), false, 'a "· N" text suffix is back on a tab');
  // every tab is reachable: tapping the second-row tabs changes what the panel shows
  seg(t, /^Bookmarks/).props.onClick();
  assert.ok(rows(p.redraw()).length > 0, 'the second-row Bookmarks tab does not open the bookmarks');
  seg(p.redraw(), /^Notes/).props.onClick();
  assert.equal(rows(p.redraw()).length, 0, 'the Notes tab did not leave the bookmarks view');
});

const tagNodes = (r) => find(r, n => n.props && n.props['data-bookmark-tag']);
const openMarks = (p) => { seg(p.redraw(), /^Bookmarks/).props.onClick(); return p.redraw(); };

test('Study panel: a tagged bookmark shows its tags under the verse; an untagged one is unchanged; Commentary tab shows none', () => {
  const p = panel(['43.3.16', '1.1.3'], [{ id: '43.3.16', ref: '43.3.16', tags: ['hope', 'sermon'] }, { ref: '1.1.3' }]);
  assert.equal(tagNodes(p.redraw()).length, 0, 'tags leaked onto the Commentary tab');
  const t = openMarks(p);
  const john = rows(t).find(r => /John 3:16/.test(reads(r))), gen = rows(t).find(r => /Genesis 1:3/.test(reads(r)));
  assert.deepEqual(tagNodes(john).map(n => n.props['data-bookmark-tag']), ['hope', 'sermon']);
  assert.deepEqual(tagNodes(john).map(n => reads(n)), ['hope', 'sermon']);
  assert.equal(tagNodes(gen).length, 0);
  assert.equal(reads(gen), 'Genesis 1:3', 'an untagged row must read exactly as before');
  const wrap = find(john, n => n.props && n.props['data-bookmark-tags'])[0];
  assert.equal(wrap.props.style.flexWrap, 'wrap');
  assert.equal(tagNodes(john)[0].props.style.textOverflow, 'ellipsis');
});

test('Study panel: an old-spelling bookmark key still finds its tags', () => {
  const p = panel(['John 3:16'], [{ ref: 'John 3:16', tags: ['grace'] }]);
  const john = rows(openMarks(p))[0];
  assert.deepEqual(tagNodes(john).map(n => n.props['data-bookmark-tag']), ['grace']);
});

test('Study panel: junk tags and a missing bookmarkItems never crash and draw no chips', () => {
  const p = panel(['43.3.16', '1.1.3'], [{ ref: '43.3.16', tags: undefined }, { ref: '1.1.3', tags: [null, ''] }]);
  assert.equal(tagNodes(openMarks(p)).length, 0);
  const q = panel(['43.3.16'], [], true);
  assert.equal(rows(openMarks(q)).length, 1);
  assert.equal(tagNodes(q.redraw()).length, 0);
});

test('Study panel: tapping a tag chip does not remove the bookmark; X still removes with the stored key', () => {
  const p = panel(['43.3.16'], [{ ref: '43.3.16', tags: ['hope'] }]);
  const john = rows(openMarks(p))[0];
  const chip = tagNodes(john)[0];
  if (chip.props.onClick) chip.props.onClick({ stopPropagation() {} });
  assert.deepEqual(p.calls.toggled, [], 'a chip tap removed the bookmark');
  find(john, n => n.type === 'button' && /^Remove bookmark/.test(String(n.props['aria-label'])))[0].props.onClick();
  assert.deepEqual(p.calls.toggled, ['43.3.16']);
});

test('Study panel: tapping a tag chip still jumps to the verse and closes the panel (the tap reaches the row button)', () => {
  const p = panel(['43.3.16'], [{ ref: '43.3.16', tags: ['hope'] }]);
  const john = rows(openMarks(p))[0];
  const chip = tagNodes(john)[0];
  const holder = find(john, n => n.type === 'button' && find(n, m => m === chip).length)[0];
  assert.ok(holder, 'the chip is not inside a tappable row button');
  let stopped = false;
  if (chip.props.onClick) chip.props.onClick({ stopPropagation() { stopped = true; } });
  assert.equal(stopped, false, 'a chip handler swallowed the tap before it reached the row');
  holder.props.onClick();   // the bubble: the tap lands on the row button
  assert.deepEqual(p.calls.goto, [[43, 3, 16]]);
  assert.equal(p.calls.closed, 1);
  assert.deepEqual(p.calls.toggled, []);
});

test('Study panel: one verse bookmarked under two spellings shows the UNION of both records tags, once each', () => {
  const p = panel(['John 3:16', '43.3.16'], [{ ref: 'John 3:16', tags: ['grace', 'hope'] }, { ref: '43.3.16', tags: ['hope', 'sermon'] }]);
  const t = openMarks(p);
  assert.equal(rows(t).length, 1, 'the two spellings must stay one row');
  assert.deepEqual(tagNodes(rows(t)[0]).map(n => n.props['data-bookmark-tag']).sort(), ['grace', 'hope', 'sermon']);
});

test('Study panel: a tag repeated inside one record is drawn once, so no two chips share a React key', () => {
  const p = panel(['43.3.16'], [{ ref: '43.3.16', tags: ['hope', 'hope', 'sermon', 'hope'] }]);
  const chips = tagNodes(rows(openMarks(p))[0]);
  assert.deepEqual(chips.map(n => n.props.key), ['hope', 'sermon']);
});
