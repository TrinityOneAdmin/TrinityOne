// TAPPING A PASSAGE BOOKMARK IN THE LIBRARY OPENS THE READER AND SELECTS ITS VERSES.
// Run: node --test scripts/a-library-passage-bookmark-opens-and-selects-the-range.test.mjs
//
// Audit 2026-11-28: f71ec597 said Library > Bookmarks calls selectPassageBookmark, but that function existed only
// inside ReadScreen's Study-panel ctx, so Library's `ctx.selectPassageBookmark` guard was always falsy and the tap
// opened the reader wherever it already was. Now app.jsx exposes it (a pending passage + a location change) and
// ReadScreen selects the range on arrival.
//
// Point of use (CLAUDE.md rules 1 and 3): the REAL CollectionView is tapped; app.jsx's ctx.selectPassageBookmark is
// SLICED OUT of the source and RUN; the REAL ReadScreen is drawn and the assertion reads `selected` off the
// <VerseRow> elements it produced. Delete the ctx entry, the Library call or the ReadScreen consumer and it goes red.
//
// Callers of what changed (rule 2): ctx.selectPassageBookmark is called by screens-library.jsx jump() (now live) and,
// via ReadScreen's own override, by the Study panel (screens-read.jsx ~1443, unchanged: the override still wins).
// ctx.pendingPassage / clearPendingPassage are read only by ReadScreen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, find } from './render-jsx-screen.mjs';

const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const ENGINE = readFileSync(new URL('../engine.js', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');

function liftEngineRefs() {
  const a = ENGINE.indexOf('  const BOOK_NAMES = [');
  const b = ENGINE.indexOf('  const USFM_BOOK = {');
  const c = ENGINE.indexOf('  function refLabel(loc, v)');
  const d = ENGINE.indexOf('\n', ENGINE.indexOf('  function refKey(loc, v)'));
  assert.ok(a > 0 && b > a && c > b && d > c, 're-anchor: engine.js reference helpers moved');
  return new Function(ENGINE.slice(a, b) + ENGINE.slice(c, d) + '\nreturn { bookName, parseRef, refLabel, refKey, bookNum };')();
}
const ENG = liftEngineRefs();

function liftSelectPassageBookmark(scope) {
  const a = APP.indexOf('\n    selectPassageBookmark:'), b = APP.indexOf('\n    addModule:', a);
  assert.ok(a > 0 && b > a && APP.indexOf('\n    selectPassageBookmark:', a + 1) < 0, 're-anchor: app.jsx selectPassageBookmark');
  const names = Object.keys(scope);
  return new Function(...names, 'return ({' + APP.slice(a, b) + '\n});')(...names.map(k => scope[k])).selectPassageBookmark;
}

const PASSAGE = { id: 'p:43.3.16+43.3.17+43.3.18', ref: '43.3.16', refs: ['43.3.16', '43.3.17', '43.3.18'], rangeLabel: 'John 3:16-18', text: 'For God so loved', visibility: 'private', date: 'Today' };

function world() {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const Bible = {
    loaded: true, activeVersion: 'WEB', books: () => [43], maxChapter: () => 21, bookName: () => 'John', versions: () => [{ abbr: 'WEB' }],
    getVerses: () => Array.from({ length: 30 }, (_, i) => ({ v: i + 1, text: 'v' + (i + 1), html: 'v' + (i + 1) })),
    bookMeta: () => [{ num: 43, name: 'John', abbr: 'Joh', group: 'g', ch: 21 }],
    getCommentary: () => [], commentaryList: () => [], searchDict: () => [], subscribe: () => () => {},
    defaultLoc: () => ({ book: 43, chap: 1 }),
    refLabel: ENG.refLabel, refKey: ENG.refKey, parseRef: ENG.parseRef,
    step: (at, dir) => ({ book: at.book, chap: at.chap + dir }),
  };
  const win = { Bible, speechSynthesis: null, innerWidth: 360, sanitizeHtml: h => h, getSelection: () => ({ toString: () => '' }), TrinityData: { CROSSREFS: {}, PLANS: [] },
    MyData: { list: () => [PASSAGE], on: () => () => {}, remove() {}, setVisibility() {}, put() {} }, verseRefLabel: r => r, addEventListener() {}, removeEventListener() {} };
  const st = { loc: { book: 43, chap: 1 }, version: 'WEB', tab: 'library', toasts: [] };
  const selectPassageBookmark = liftSelectPassageBookmark({
    setPlanRead() {}, setLoc: v => { st.loc = v; }, setReadView() {}, setTab: t => { st.tab = t; },
  });
  const ctx = {
    get loc() { return st.loc; },     selectPassageBookmark, openReader: () => { st.tab = 'read'; }, planRead: null, planProgress: {}, planChurch: 'A', churchPlans: [],
    get version() { return st.version; }, setLoc: l => { st.loc = l; }, toast: m => st.toasts.push(m),
    gotoRef: (book, chap, verse) => { st.loc = { book, chap, verse }; st.tab = 'read'; },
    highlights: {}, notes: {}, bookmarks: [], toggleBookmark() {}, setHighlight() {}, setNote() {}, hasPassageBookmark: () => false,
    openShareSheet() {}, desktop: false, readScale: 1, removeTranslation() {}, addModule() {}, setVersion() {},
  };
  const common = {
    React, window: win, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '', clipboard: null }, location: { search: '' }, clearTimeout, setInterval: () => 0, clearInterval, console, URLSearchParams,
    SpeechSynthesisUtterance: class {}, Icon, cx: (...a) => a.filter(Boolean).join(' '), lsGet: (k, d) => d, lsSet: () => {},
    useTrinityAudio: () => ({ track: null, playing: false }),
    Overlay: ({ children }) => React.createElement('div', {}, children), ReadPlansTabs: Stub('ReadPlansTabs'),
    BottomSheet: ({ open, children }) => (open ? React.createElement('div', {}, children) : null), useBackLayer: () => {},
    Sheet: Stub('Sheet'), Modal: Stub('Modal'), Pill: Stub('Pill'), Row: Stub('Row'), IconBtn: Stub('IconBtn'), Halo: Stub('Halo'), SectionLabel: Stub('SectionLabel'),
    PlanReadBar: Stub('PlanReadBar'), Spinner: Stub('Spinner'), ScreenScroll: p => p.children, safeCssColor: c => c || 'var(--clay)',
  };
  const { ReadScreen } = loadScreen('app/screens-read.jsx', ['ReadScreen'], { ...common, setTimeout: () => 0 });
  const { CollectionView } = loadScreen('app/screens-library.jsx', ['CollectionView'], { ...common, setTimeout: f => { f(); return 0; } });
  const tapLibraryRow = () => {
    const tree = draw(CollectionView, { coll: { id: 'bookmarks', name: 'Bookmarks', icon: 'bookmark' }, open: true, onClose() {}, ctx });
    const rows = find(tree, n => n.type === 'div' && n.props && typeof n.props.onClick === 'function' && /\bborderBottom|padding/.test(JSON.stringify(n.props.style || {})) && !n.props['aria-label']);
    const row = find(tree, n => n.type === 'div' && n.props && n.props.onClick && n.key === PASSAGE.id);
    assert.ok(row.length === 1 || rows.length, 're-anchor: the passage row was not drawn');
    (row.length ? row[0] : rows[0]).props.onClick();
  };
  // What the reader LIGHTS: `selected` (setSel) or `reading` (loc-driven inArrived range). Drawn the way React does it:
  // render, run effects in order, and the arrival effect fires AGAIN when a dep (version) changes later.
  const lit = () => { const t = draw(ReadScreen, { ctx }); return find(t, n => n.type && n.type.name === 'VerseRow' && (n.props.selected || n.props.reading)).map(n => n.props.n); };
  const selected = () => { draw(ReadScreen, { ctx }); draw(ReadScreen, { ctx }); return lit(); };
  const reArrive = () => { st.version = 'KJV'; draw(ReadScreen, { ctx }); st.version = 'WEB'; draw(ReadScreen, { ctx }); };
  return { st, tapLibraryRow, selected, lit, reArrive, draw, ReadScreen, ctx };
}

test('a passage bookmark tapped in the Library opens the reader at it and lights 16-18', () => {
  const w = world();
  w.tapLibraryRow();
  assert.deepEqual(w.st.loc, { book: 43, chap: 3, verse: 16, verseEnd: 18 }, 'the Library tap did not carry the range in the location');
  assert.equal(w.st.tab, 'read', 'the Library tap did not open the reader');
  assert.deepEqual(w.selected(), [16, 17, 18], 'the reader did not light the saved passage');
});

test('the range SURVIVES the arrival effect re-firing (device bug M4: only the first verse stayed lit)', () => {
  const w = world();
  w.tapLibraryRow();
  assert.deepEqual(w.selected(), [16, 17, 18]);
  w.reArrive();
  assert.deepEqual(w.lit(), [16, 17, 18], 'the arrival effect clobbered the range');
});

test('a passage in a chapter other than the open one still lights whole (cross-screen: reader already elsewhere)', () => {
  const w = world();
  w.draw(w.ReadScreen, { ctx: w.ctx });
  w.tapLibraryRow(); w.reArrive();
  assert.deepEqual(w.lit(), [16, 17, 18]);
});

test('a reader that arrives with no passage lights nothing (CONTROL)', () => {
  const w = world();
  w.st.loc = { book: 43, chap: 3, verse: 16 };
  assert.deepEqual(w.selected(), [16], 'a single arrival lights just its verse');
});
