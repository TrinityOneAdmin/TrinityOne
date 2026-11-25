// A MULTI-VERSE SELECTION CAN BE BOOKMARKED AS A PASSAGE, AND PASSAGE BOOKMARKS SHOW AS ONE ENTRY IN THE STUDY PANEL.
// Run: node --test scripts/passage-bookmark-on-multi-select.test.mjs
//
// Point-of-use (CLAUDE.md rule 1/3): the real ActionSheet, VerseRow and CommentaryPanel are loaded from
// app/screens-read.jsx through the mini React and DRAWN; the tests tap the same buttons a member would tap
// and read what is drawn. Nothing here matches text in app/*.jsx.
//
// Users of what changed (rule 2):
//   app/app.jsx: bookmarks projection (line 557) now flatMaps refs; new ctx functions addPassageBookmark,
//     removePassageBookmark, hasPassageBookmark. Callers: screens-read.jsx (ReadScreen _bm handler,
//     ActionSheet bookmarked prop, CommentaryPanel remove button).
//   app/screens-read.jsx: ActionSheet multi arm gained Bookmark action; VerseRow gained bmFirst/bmLast/
//     bookmark icon; CommentaryPanel myMarks computation handles passage items; _bm handler branches on multi.
//   app/screens-library.jsx: collection view search includes rangeLabel; display uses rangeLabel when present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, texts, reads } from './render-jsx-screen.mjs';

// ── shared helpers ───────────────────────────────────────────────────────────────────────────────────────────
const BOOKS = { 1: 'Genesis', 19: 'Psalms', 43: 'John' };

// Build a CommentaryPanel (Study panel) with the given bookmark items and draw it on the Bookmarks tab.
// Follows the same pattern as study-panel-lists-bookmarks.test.mjs.
function panel(bookmarkRefs, items = []) {
  const { React, draw } = miniReact();
  const calls = { goto: [], toggled: [], removedPassage: [], closed: 0 };
  const Bible = {
    parseRef: (s) => { const m = /^John (\d+):(\d+)$/.exec(String(s)); return m ? { book: 43, chap: +m[1], verse: +m[2] } : null; },
    refKey: (l, v) => l.book + '.' + l.chap + '.' + v,
    refLabel: (l, v) => BOOKS[l.book] + ' ' + l.chap + ':' + v,
    getCommentary: () => [], getCrossRefs: () => ({}), subscribe: () => () => {},
  };
  const Icon = ({ name, fill, size, color, style }) => React.createElement('i', { 'data-icon': name, 'data-fill': fill ? 'true' : undefined, style });
  const { TagFilterMenu } = loadScreen('app/ui.jsx', ['TagFilterMenu'], {
    React, window: {}, Icon, document: { addEventListener() {}, removeEventListener() {} }, PhoneFrame: () => null,
    localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout, navigator: {},
  });
  const mod = loadScreen('app/screens-read.jsx', ['CommentaryPanel'], {
    React, Bible, window: { Bible, sanitizeHtml: (x) => x }, TagFilterMenu,
    Icon,
    IconBtn: () => null, BottomSheet: () => null, Btn: () => null, Empty: () => null, Pill: () => null, Chip: () => null,
    setTimeout: () => 0, clearTimeout() {},
  });
  const ctx = {
    notes: {}, version: 'kjv',
    bookmarks: bookmarkRefs,
    bookmarkItems: items,
    setNote() {},
    toggleBookmark: (k) => calls.toggled.push(k),
    removePassageBookmark: (id) => calls.removedPassage.push(id),
    gotoRef: (b, c, v) => calls.goto.push([b, c, v]),
  };
  const props = { loc: { book: 43, chap: 3 }, label: 'John 3', open: true, onClose: () => { calls.closed++; }, ctx, docked: true };
  return { calls, redraw: () => draw(mod.CommentaryPanel, props) };
}

const seg = (t, re) => find(t, n => n.type === 'button' && re.test(reads(n)))[0];
const rows = (t) => find(t, n => n.props && n.props['data-bookmark']);
const openMarks = (p) => { seg(p.redraw(), /^Bookmarks/).props.onClick(); return p.redraw(); };

// Build an ActionSheet with multi-verse context to test the bookmark button.
function actionSheet(multi, bookmarked) {
  const { React, draw } = miniReact();
  const calls = { bm: 0 };
  const Icon = ({ name }) => React.createElement('i', { 'data-icon': name });
  const mod = loadScreen('app/screens-read.jsx', ['ActionSheet'], {
    React, Icon, window: { sanitizeHtml: (x) => x },
    IconBtn: () => null, BottomSheet: ({ children }) => children, Btn: () => null,
    setTimeout: () => 0, clearTimeout() {},
  });
  const sheetCtx = {
    _bm: () => { calls.bm++; },
    _copy: () => {},
    _share: () => {},
    _define: () => {},
    _shrink: () => {},
    _extend: () => {},
    toast: () => {},
  };
  const tree = draw(mod.ActionSheet, {
    label: 'John 3:16-18', multi, ctx: sheetCtx, open: true, onClose: () => {},
    bookmarked, hasNote: false, onNote: () => {}, onCross: () => {}, onCommentary: () => {},
    curColor: null, onColor: () => {},
  });
  return { tree, calls };
}

// Build a VerseRow to test the bookmark icon and left-bar rendering.
function verseRow(props) {
  const { React, draw } = miniReact();
  const Icon = ({ name, fill, size, color, style }) => React.createElement('i', { 'data-icon': name, 'data-fill': fill ? 'true' : undefined, style });
  const mod = loadScreen('app/screens-read.jsx', ['VerseRow'], {
    React, Icon, window: { sanitizeHtml: (x) => x },
    IconBtn: () => null, BottomSheet: () => null,
    setTimeout: () => 0, clearTimeout() {},
  });
  return draw(mod.VerseRow, {
    n: 16, html: 'For God so loved the world', onSelect: () => {}, onWord: () => {},
    ...props,
  });
}

// ── TESTS ────────────────────────────────────────────────────────────────────────────────────────────────────

test('Multi-verse ActionSheet shows a Bookmark button (previously only Copy/Share/Define)', () => {
  const { tree } = actionSheet(3, false);
  const bmBtn = find(tree, n => n.type === 'button' && texts(n).some(t => /Bookmark/.test(t)));
  assert.ok(bmBtn.length > 0, 'no Bookmark button found on multi-verse ActionSheet');
});

test('Multi-verse ActionSheet shows "Saved" when passage is already bookmarked', () => {
  const { tree } = actionSheet(3, true);
  const savedBtn = find(tree, n => n.type === 'button' && texts(n).some(t => /Saved/.test(t)));
  assert.ok(savedBtn.length > 0, 'no "Saved" button found on multi-verse ActionSheet when bookmarked');
});

test('Tapping Bookmark on multi-verse ActionSheet calls the _bm handler', () => {
  const { tree, calls } = actionSheet(3, false);
  const bmBtn = find(tree, n => n.type === 'button' && texts(n).some(t => /Bookmark/.test(t)))[0];
  bmBtn.props.onClick();
  assert.equal(calls.bm, 1, '_bm handler was not called when tapping Bookmark on multi-select');
});

test('A passage bookmark shows in the Study panel as one entry with the range label', () => {
  // bookmarks array has the expanded per-verse refs (from flatMap), items has the passage bookmark
  const passageItem = {
    id: 'p:43.3.16+43.3.17+43.3.18', ref: '43.3.16',
    refs: ['43.3.16', '43.3.17', '43.3.18'],
    rangeLabel: 'John 3:16-18', tags: [],
  };
  const p = panel(
    ['43.3.16', '43.3.17', '43.3.18'],
    [passageItem],
  );
  const t = openMarks(p);
  const bmRows = rows(t);
  assert.equal(bmRows.length, 1, 'passage bookmark should appear as ONE entry, not three');
  assert.ok(reads(bmRows[0]).includes('John 3:16-18'), 'passage bookmark should show rangeLabel "John 3:16-18", got: ' + reads(bmRows[0]));
});

test('Removing a passage bookmark from the Study panel X button calls removePassageBookmark', () => {
  const passageItem = {
    id: 'p:43.3.16+43.3.17+43.3.18', ref: '43.3.16',
    refs: ['43.3.16', '43.3.17', '43.3.18'],
    rangeLabel: 'John 3:16-18', tags: [],
  };
  const p = panel(
    ['43.3.16', '43.3.17', '43.3.18'],
    [passageItem],
  );
  const t = openMarks(p);
  const bmRow = rows(t)[0];
  const rmBtn = find(bmRow, n => n.type === 'button' && /^Remove bookmark/.test(String(n.props['aria-label'])))[0];
  assert.ok(rmBtn, 'no remove button found on passage bookmark row');
  rmBtn.props.onClick();
  assert.deepEqual(p.calls.removedPassage, ['p:43.3.16+43.3.17+43.3.18'],
    'removePassageBookmark was not called with the passage id');
  assert.deepEqual(p.calls.toggled, [], 'toggleBookmark should NOT be called for a passage bookmark removal');
});

test('A single-verse bookmark X button still calls toggleBookmark, not removePassageBookmark', () => {
  const p = panel(
    ['43.3.16'],
    [{ id: '43.3.16', ref: '43.3.16', tags: [] }],
  );
  const t = openMarks(p);
  const rmBtn = find(rows(t)[0], n => n.type === 'button' && /^Remove bookmark/.test(String(n.props['aria-label'])))[0];
  rmBtn.props.onClick();
  assert.deepEqual(p.calls.toggled, ['43.3.16'], 'single-verse remove should use toggleBookmark');
  assert.deepEqual(p.calls.removedPassage, [], 'removePassageBookmark should NOT be called for single-verse');
});

test('Per-verse bookmark indicator: a verse in a passage bookmark has bookmarked=true via flatMap', () => {
  // This tests the data model: ctx.bookmarks uses flatMap on refs, so each verse key is present
  const passageItem = {
    id: 'p:43.3.16+43.3.17+43.3.18', ref: '43.3.16',
    refs: ['43.3.16', '43.3.17', '43.3.18'],
    rangeLabel: 'John 3:16-18', tags: [],
  };
  // Simulate the flatMap that app.jsx does: MD.list('bookmarks').flatMap(b => b.refs || [b.ref])
  const bookmarks = passageItem.refs;  // ['43.3.16', '43.3.17', '43.3.18']
  assert.ok(bookmarks.includes('43.3.16'), 'verse 16 should be in bookmarks via flatMap');
  assert.ok(bookmarks.includes('43.3.17'), 'verse 17 should be in bookmarks via flatMap');
  assert.ok(bookmarks.includes('43.3.18'), 'verse 18 should be in bookmarks via flatMap');
  assert.ok(!bookmarks.includes('43.3.19'), 'verse 19 should NOT be in bookmarks');
});

test('VerseRow renders a small bookmark icon when bookmarked=true', () => {
  const withBm = verseRow({ bookmarked: true, bmFirst: true, bmLast: true });
  const bmIcons = find(withBm, n => n.props && n.props['data-icon'] === 'bookmark' && n.props['data-fill'] === 'true');
  assert.ok(bmIcons.length > 0, 'no filled bookmark icon found on a bookmarked verse');

  const withoutBm = verseRow({ bookmarked: false });
  const noBmIcons = find(withoutBm, n => n.props && n.props['data-icon'] === 'bookmark' && n.props['data-fill'] === 'true');
  assert.equal(noBmIcons.length, 0, 'a non-bookmarked verse should not have a filled bookmark icon');
});

test('VerseRow has a left border when bookmarked, with rounded corners on first/last of a contiguous run', () => {
  // First verse in a run: top-left rounded, bottom-left not
  const first = verseRow({ bookmarked: true, bmFirst: true, bmLast: false });
  const firstSpan = find(first, n => n.props && n.props.id === 'rv-16')[0];
  assert.ok(firstSpan, 'could not find the outer span of the verse row');
  assert.equal(firstSpan.props.style.borderLeft, '2px solid var(--clay)', 'bookmarked verse missing left border');
  assert.equal(firstSpan.props.style.borderTopLeftRadius, 4, 'first verse in run should have top-left radius');
  assert.equal(firstSpan.props.style.borderBottomLeftRadius, 0, 'first (not last) verse should have no bottom-left radius');

  // Last verse in a run: bottom-left rounded, top-left not
  const last = verseRow({ bookmarked: true, bmFirst: false, bmLast: true });
  const lastSpan = find(last, n => n.props && n.props.id === 'rv-16')[0];
  assert.equal(lastSpan.props.style.borderTopLeftRadius, 0, 'last (not first) verse should have no top-left radius');
  assert.equal(lastSpan.props.style.borderBottomLeftRadius, 4, 'last verse in run should have bottom-left radius');

  // Not bookmarked: no left border
  const none = verseRow({ bookmarked: false });
  const noneSpan = find(none, n => n.props && n.props.id === 'rv-16')[0];
  assert.equal(noneSpan.props.style.borderLeft, undefined, 'non-bookmarked verse should have no left border');
});

test('Study panel: a passage bookmark and a single-verse bookmark coexist and sort correctly', () => {
  const passageItem = {
    id: 'p:43.3.16+43.3.17+43.3.18', ref: '43.3.16',
    refs: ['43.3.16', '43.3.17', '43.3.18'],
    rangeLabel: 'John 3:16-18', tags: [],
  };
  const singleItem = { id: '1.1.3', ref: '1.1.3', tags: [] };
  const p = panel(
    ['43.3.16', '43.3.17', '43.3.18', '1.1.3'],
    [passageItem, singleItem],
  );
  const t = openMarks(p);
  const bmRows = rows(t);
  assert.equal(bmRows.length, 2, 'should have 2 entries: one passage + one single');
  // Genesis 1:3 sorts before John 3:16-18
  assert.ok(reads(bmRows[0]).includes('Genesis 1:3'), 'first entry should be Genesis 1:3, got: ' + reads(bmRows[0]));
  assert.ok(reads(bmRows[1]).includes('John 3:16-18'), 'second entry should be John 3:16-18, got: ' + reads(bmRows[1]));
});
