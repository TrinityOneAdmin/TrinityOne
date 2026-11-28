// COMPARE VIEW: PER-COLUMN SELECTION, COPY TEXT, AND SECOND VERSION SHEET.
// Run: node --test scripts/compare-view-selection.test.mjs
//
// Point-of-use (CLAUDE.md rule 1): the REAL ReadScreen is loaded from app/screens-read.jsx through
// loadScreen + miniReact and DRAWN with compare mode on. Tests tap the compare columns, verify
// highlights, and check that the second VersionSheet renders. Nothing here matches text in app/*.jsx
// (rule 3).
//
// Users of what changed (rule 2): ReadScreen's compare block gains per-column onClick handlers that
// set cmpSide state. passageText/sheetCtx._copy/_share read cmpSide to pick the version. A second
// VersionSheet instance is rendered for sheet === 'cmpVersion'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const StubIconBtn = (props) => ({ type: 'button', props: { ...props, 'data-iconbtn': props.name, onClick: props.onClick }, kids: [] });
const ENGINE = readFileSync(new URL('../engine.js', import.meta.url), 'utf8');

function liftEngineRefs() {
  const a = ENGINE.indexOf('  const BOOK_NAMES = [');
  const b = ENGINE.indexOf('  const USFM_BOOK = {');
  const c = ENGINE.indexOf('  function refLabel(loc, v)');
  const d = ENGINE.indexOf('\n', ENGINE.indexOf('  function refKey(loc, v)'));
  assert.ok(a > 0 && b > a && c > b && d > c, 're-anchor: engine.js reference helpers moved');
  return new Function(ENGINE.slice(a, b) + ENGINE.slice(c, d) + '\nreturn { bookName, parseRef, refLabel, refKey, bookNum };')();
}
const ENG = liftEngineRefs();

const kjvVerses = [
  { v: 1, text: 'In the beginning God created the heaven and the earth.', html: 'In the beginning God created the heaven and the earth.' },
  { v: 2, text: 'And the earth was without form, and void.', html: 'And the earth was without form, and void.' },
  { v: 3, text: 'And God said, Let there be light: and there was light.', html: 'And God said, Let there be light: and there was light.' },
];
const bsbVerses = [
  { v: 1, text: 'In the beginning God created the heavens and the earth.', html: 'In the beginning God created the heavens and the earth.' },
  { v: 2, text: 'Now the earth was formless and void.', html: 'Now the earth was formless and void.' },
  { v: 3, text: 'And God said, Let there be light, and there was light.', html: 'And God said, Let there be light, and there was light.' },
];

function setup() {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const Bible = {
    defaultLoc: () => ({ book: 1, chap: 1 }),
    bookName: ENG.bookName, refLabel: ENG.refLabel, refKey: ENG.refKey,
    getVerses: (book, chap, ver) => ver === 'BSB' ? bsbVerses : kjvVerses,
    versions: () => [{ abbr: 'KJV', name: 'King James' }, { abbr: 'BSB', name: 'Berean Standard' }],
    chapterCount: () => 50, maxChapter: () => 50,
    step: (loc, dir) => dir > 0 ? { book: loc.book, chap: loc.chap + 1 } : (loc.chap > 1 ? { book: loc.book, chap: loc.chap - 1 } : null),
    books: () => [1], bookMeta: () => [{ num: 1, name: 'Genesis', abbr: 'Gen', group: 'g', ch: 50 }],
    getCommentary: () => [], commentaryList: () => [], crossrefList: () => [], originalList: () => [],
    subscribe: () => () => {}, hasOriginal: () => false, getOriginal: () => [],
    getCrossRefs: () => [], parseRef: ENG.parseRef, getCatalog: () => Promise.resolve([]),
  };
  const win = { Bible, speechSynthesis: null, innerWidth: 360, sanitizeHtml: h => h, getSelection: () => ({ toString: () => '' }), TrinityData: { CROSSREFS: {} } };
  const globals = {
    React, window: win, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '', clipboard: null }, location: { search: '' },
    setTimeout: () => 0, clearTimeout, setInterval: () => 0, clearInterval, console, URLSearchParams, SpeechSynthesisUtterance: class {},
    Icon, cx: (...a) => a.filter(Boolean).join(' '), lsGet: (k, d) => d, lsSet: () => {},
    useTrinityAudio: () => ({ track: null, playing: false }),
    Overlay: Stub('Overlay'), ReadPlansTabs: Stub('ReadPlansTabs'), useBackLayer: () => {},
    Sheet: ({ open, children }) => open ? React.createElement('div', { 'data-stub': 'sheet' }, children) : null,
    Modal: Stub('Modal'), Pill: Stub('Pill'), Row: Stub('Row'), IconBtn: StubIconBtn, Halo: Stub('Halo'), SectionLabel: Stub('SectionLabel'),
    BottomSheet: ({ open, children }) => open ? React.createElement('div', { 'data-stub': 'bottomsheet' }, children) : null,
  };
  const { ReadScreen } = loadScreen('app/screens-read.jsx', ['ReadScreen'], globals);
  const shared = [];
  const ctx = {
    loc: { book: 1, chap: 1 }, version: 'KJV',
    setLoc() {}, toast() {}, highlights: {}, notes: {}, bookmarks: [], bookmarkItems: [],
    toggleBookmark() {}, hasPassageBookmark: () => false, addPassageBookmark: () => 'bm1',
    setHighlight() {}, setNote() {},
    openShareSheet(s) { shared.push(s); },
    desktop: false, readScale: 1, removeTranslation() {}, addModule() {}, setVersion() {},
  };
  return { React, draw, ReadScreen, ctx, shared };
}

const compareRows = (tree) => find(tree, n => n.type === 'div' && n.props && typeof n.props.id === 'string' && n.props.id.startsWith('rv-') && n.props.style && n.props.style.cursor === 'pointer');
const clickableCols = (row) => (row.kids || []).flat(Infinity).filter(n => n && n.props && typeof n.props.onClick === 'function');
const versionSheets = (tree) => find(tree, n => n.type && n.type.name === 'VersionSheet' && n.props);

function enterCompare(tree) {
  const btn = find(tree, n => n.props && n.props['data-iconbtn'] === 'compare')[0];
  assert.ok(btn, 'no compare toggle found');
  btn.props.onClick();
}

test('compare mode renders per-column clickable areas with verse numbers on both sides', () => {
  const { draw, ReadScreen, ctx } = setup();
  let tree = draw(ReadScreen, { ctx });
  assert.equal(compareRows(tree).length, 0, 'compare rows should not exist when compare is off');

  enterCompare(tree);
  tree = draw(ReadScreen, { ctx });
  const rows = compareRows(tree);
  assert.ok(rows.length >= 3, 'expected at least 3 compare rows; got ' + rows.length);

  const cols = clickableCols(rows[0]);
  assert.equal(cols.length, 2, 'each compare row should have 2 clickable columns; got ' + cols.length);

  for (const col of cols) {
    const sups = find(col, n => n.type === 'sup');
    assert.ok(sups.length > 0, 'column is missing a verse number superscript');
  }
});

test('tapping the left column highlights left only; tapping right highlights right only', () => {
  const { draw, ReadScreen, ctx } = setup();
  let tree = draw(ReadScreen, { ctx });
  enterCompare(tree);
  tree = draw(ReadScreen, { ctx });

  clickableCols(compareRows(tree)[0])[0].props.onClick();
  tree = draw(ReadScreen, { ctx });

  let cols = clickableCols(compareRows(tree)[0]);
  assert.ok(cols[0].props.style.background !== 'transparent', 'left column should be highlighted; got: ' + cols[0].props.style.background);
  assert.equal(cols[1].props.style.background, 'transparent', 'right column should NOT be highlighted after tapping left');
  assert.ok(cols[0].props.style.background.includes('clay'), 'left highlight should use clay; got: ' + cols[0].props.style.background);

  clickableCols(compareRows(tree)[0])[1].props.onClick();
  tree = draw(ReadScreen, { ctx });

  cols = clickableCols(compareRows(tree)[0]);
  assert.equal(cols[0].props.style.background, 'transparent', 'left should clear after switching to right');
  assert.ok(cols[1].props.style.background !== 'transparent', 'right should be highlighted; got: ' + cols[1].props.style.background);
  assert.ok(cols[1].props.style.background.includes('sage'), 'right highlight should use sage; got: ' + cols[1].props.style.background);
});

test('share from right column uses the compare version text', () => {
  const { draw, ReadScreen, ctx, shared } = setup();
  let tree = draw(ReadScreen, { ctx });
  enterCompare(tree);
  tree = draw(ReadScreen, { ctx });

  clickableCols(compareRows(tree)[0])[1].props.onClick();
  tree = draw(ReadScreen, { ctx });

  const shareBtns = find(tree, n => n.type === 'button' && texts(n).join('').includes('Share'));
  assert.ok(shareBtns.length > 0, 'no Share button found in the action sheet');
  shareBtns[0].props.onClick();
  tree = draw(ReadScreen, { ctx });

  assert.ok(shared.length > 0, 'openShareSheet was not called');
  assert.equal(shared[0].version, 'BSB', 'share should use compare version BSB; got: ' + shared[0].version);
  assert.ok(shared[0].text.includes('heavens'), 'share text should be from BSB (heavens not heaven); got: ' + shared[0].text);
});

test('second VersionSheet renders when compare version pill is tapped', () => {
  const { draw, ReadScreen, ctx } = setup();
  let tree = draw(ReadScreen, { ctx });
  enterCompare(tree);
  tree = draw(ReadScreen, { ctx });

  const pill = find(tree, n => n.props && n.props['data-tour'] === 'compare-version')[0];
  assert.ok(pill, 'no compare version pill found');
  pill.props.onClick();
  tree = draw(ReadScreen, { ctx });

  const sheets = versionSheets(tree);
  assert.ok(sheets.length >= 2, 'expected 2 VersionSheet instances; got ' + sheets.length);
  const cmpSheet = sheets.find(s => s.props.open);
  assert.ok(cmpSheet, 'no open VersionSheet found');
  assert.equal(cmpSheet.props.version, 'BSB', 'compare VersionSheet should show BSB; got: ' + cmpSheet.props.version);
});

test('cmpSide resets when leaving compare mode (C1 fix)', () => {
  const { draw, ReadScreen, ctx } = setup();
  let tree = draw(ReadScreen, { ctx });
  enterCompare(tree);
  tree = draw(ReadScreen, { ctx });

  clickableCols(compareRows(tree)[0])[1].props.onClick();
  tree = draw(ReadScreen, { ctx });
  assert.ok(clickableCols(compareRows(tree)[0])[1].props.style.background !== 'transparent', 'right column should be highlighted');

  enterCompare(tree);
  tree = draw(ReadScreen, { ctx });
  assert.equal(compareRows(tree).length, 0, 'compare rows should be gone after toggling off');

  enterCompare(tree);
  tree = draw(ReadScreen, { ctx });
  const cols = clickableCols(compareRows(tree)[0]);
  assert.equal(cols[1].props.style.background, 'transparent', 'right column must not be highlighted on re-entry — cmpSide should have been reset');
});

test('vertical divider renders between compare columns', () => {
  const { draw, ReadScreen, ctx } = setup();
  let tree = draw(ReadScreen, { ctx });
  enterCompare(tree);
  tree = draw(ReadScreen, { ctx });

  const rows = compareRows(tree);
  const dividers = (rows[0].kids || []).flat(Infinity).filter(n =>
    n && n.props && n.props.style && n.props.style.width === 1 && n.props.style.background === 'var(--line-2)');
  assert.ok(dividers.length > 0, 'no vertical divider between compare columns');
});
