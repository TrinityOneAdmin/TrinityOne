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
function panel(bookmarks) {
  const { React, draw } = miniReact();
  const calls = { goto: [], toggled: [], closed: 0 };
  const Bible = {
    parseRef: () => null, refKey: (l, v) => l.book + '.' + l.chap + '.' + v,
    refLabel: (l, v) => BOOKS[l.book] + ' ' + l.chap + ':' + v,
    getCommentary: () => [], getCrossRefs: () => ({}), subscribe: () => () => {},
  };
  const mod = loadScreen('app/screens-read.jsx', ['CommentaryPanel'], {
    React, Bible, window: { Bible, sanitizeHtml: (x) => x },
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    IconBtn: () => null, BottomSheet: () => null, Btn: () => null, Empty: () => null, Pill: () => null, Chip: () => null,
    setTimeout: () => 0, clearTimeout() {},
  });
  const ctx = { notes: {}, version: 'kjv', bookmarks, setNote() {}, toggleBookmark: (k) => calls.toggled.push(k), gotoRef: (b, c, v) => calls.goto.push([b, c, v]) };
  const props = { loc: { book: 1, chap: 1 }, label: 'Genesis 1', open: true, onClose: () => { calls.closed++; }, ctx, docked: true };
  return { calls, redraw: () => draw(mod.CommentaryPanel, props) };
}
const seg = (t, re) => find(t, n => n.type === 'button' && re.test(reads(n)))[0];
const rows = (t) => find(t, n => n.props && n.props['data-bookmark']);

test('Study panel: a Bookmarks tab lists every bookmarked verse (all books, reading order, readable names)', () => {
  const p = panel(['43.3.16', '1.1.3', '19.23.1']);
  let t = p.redraw();
  assert.equal(rows(t).length, 0, 'control: bookmarks must not show on the Commentary tab');
  const tab = seg(t, /^Bookmarks · 3$/);
  assert.ok(tab, 'no "Bookmarks · 3" segment in the Study panel');
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
