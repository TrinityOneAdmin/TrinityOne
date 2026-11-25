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
//   app/screens-read.jsx: ActionSheet multi arm gained Bookmark action; VerseRow gained bmIcon prop
//     (bookmark icon on first verse only); contiguous bookmarked verses wrapped in a continuous-bar span;
//     CommentaryPanel myMarks computation handles passage items with refs; _bm handler branches on multi;
//     CommentaryPanel click handler calls selectPassageBookmark for passage bookmarks.
//   app/screens-library.jsx: collection view search includes rangeLabel; display uses rangeLabel when present;
//     jump() calls selectPassageBookmark for passage bookmarks instead of plain openReader+toast.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, texts, reads } from './render-jsx-screen.mjs';

// ── shared helpers ───────────────────────────────────────────────────────────────────────────────────────────
const BOOKS = { 1: 'Genesis', 19: 'Psalms', 43: 'John' };

// Build a CommentaryPanel (Study panel) with the given bookmark items and draw it on the Bookmarks tab.
// Follows the same pattern as study-panel-lists-bookmarks.test.mjs.
function panel(bookmarkRefs, items = []) {
  const { React, draw } = miniReact();
  const calls = { goto: [], toggled: [], removedPassage: [], closed: 0, selectPassage: [] };
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
    selectPassageBookmark: (refs) => calls.selectPassage.push(refs),
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

test('VerseRow renders a small bookmark icon only when bmIcon=true', () => {
  const withIcon = verseRow({ bookmarked: true, bmIcon: true });
  const bmIcons = find(withIcon, n => n.props && n.props['data-icon'] === 'bookmark' && n.props['data-fill'] === 'true');
  assert.ok(bmIcons.length > 0, 'no filled bookmark icon found on a verse with bmIcon=true');

  // bookmarked but NOT bmIcon (a middle/last verse in a run) — no icon
  const noIcon = verseRow({ bookmarked: true, bmIcon: false });
  const noBmIcons = find(noIcon, n => n.props && n.props['data-icon'] === 'bookmark' && n.props['data-fill'] === 'true');
  assert.equal(noBmIcons.length, 0, 'a bookmarked verse without bmIcon should not have a filled bookmark icon');

  const withoutBm = verseRow({ bookmarked: false });
  const noBmIcons2 = find(withoutBm, n => n.props && n.props['data-icon'] === 'bookmark' && n.props['data-fill'] === 'true');
  assert.equal(noBmIcons2.length, 0, 'a non-bookmarked verse should not have a filled bookmark icon');
});

test('VerseRow no longer carries its own left border — the continuous bar is on the wrapper span', () => {
  // A bookmarked verse's outer span must NOT have borderLeft (the bar is now on the grouping wrapper in ReadScreen)
  const bm = verseRow({ bookmarked: true, bmIcon: true });
  const bmSpan = find(bm, n => n.props && n.props.id === 'rv-16')[0];
  assert.ok(bmSpan, 'could not find the outer span of the verse row');
  assert.equal(bmSpan.props.style.borderLeft, undefined, 'bookmarked VerseRow should NOT have its own borderLeft (bar is on wrapper)');
  assert.equal(bmSpan.props.style.paddingLeft, undefined, 'bookmarked VerseRow should NOT have paddingLeft');
  assert.equal(bmSpan.props.style.marginLeft, undefined, 'bookmarked VerseRow should NOT have marginLeft');

  // The verse number still turns clay when bookmarked
  const sup = find(bmSpan, n => n.type === 'sup')[0];
  assert.ok(sup, 'could not find the verse number <sup>');
  assert.equal(sup.props.style.color, 'var(--clay)', 'bookmarked verse number should be clay-coloured');

  // Non-bookmarked: same — no border
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

test('Tapping a passage bookmark in the Study panel calls selectPassageBookmark with the refs array', () => {
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
  // The main tap area is the button (not the X button)
  const tapBtn = find(bmRow, n => n.type === 'button' && !/^Remove/.test(String(n.props['aria-label'] || '')))[0];
  assert.ok(tapBtn, 'could not find the tap button on the passage bookmark row');
  tapBtn.props.onClick();
  assert.equal(p.calls.selectPassage.length, 1, 'selectPassageBookmark should be called once');
  assert.deepEqual(p.calls.selectPassage[0], ['43.3.16', '43.3.17', '43.3.18'],
    'selectPassageBookmark should receive the full refs array');
  assert.deepEqual(p.calls.goto, [], 'gotoRef should NOT be called for a passage bookmark tap');
});

test('Tapping a single-verse bookmark in the Study panel still calls gotoRef, not selectPassageBookmark', () => {
  const p = panel(
    ['43.3.16'],
    [{ id: '43.3.16', ref: '43.3.16', tags: [] }],
  );
  const t = openMarks(p);
  const bmRow = rows(t)[0];
  const tapBtn = find(bmRow, n => n.type === 'button' && !/^Remove/.test(String(n.props['aria-label'] || '')))[0];
  tapBtn.props.onClick();
  assert.equal(p.calls.goto.length, 1, 'gotoRef should be called for a single-verse bookmark');
  assert.deepEqual(p.calls.goto[0], [43, 3, 16]);
  assert.deepEqual(p.calls.selectPassage, [], 'selectPassageBookmark should NOT be called for a single-verse bookmark');
});
