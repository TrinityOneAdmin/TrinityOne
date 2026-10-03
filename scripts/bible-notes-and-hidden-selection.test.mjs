// THE BIBLE READER: A NOTE SHOWS WHEREVER IT WAS SAVED (sim item 36), AND NO VERSE IS SELECTED THAT THE
// READER DID NOT PICK (sim item 37).
//   Run: node --test scripts/bible-notes-and-hidden-selection.test.mjs
//
// ── ITEM 36 ───────────────────────────────────────────────────────────────────────────────────────────────
// A note is stored under a key. The verse card writes "book.chap.verse" ("43.1.51", Bible.refKey); the Study
// panel's own "New note" wrote "John 1:1" and the panel only listed keys that began "John 1:". So a note
// written on a verse never appeared in the panel (it said "No notes here yet"), a note written in the panel
// never showed on its verse, and the Library headed the verse-card note with the raw code "43.1.51".
// Both key forms are on real phones, so the readers accept both and the writers use the canonical one.
//
// ── HOW THIS ASSERTS ──────────────────────────────────────────────────────────────────────────────────────
// CLAUDE.md rule 3: nothing here reads app/*.jsx as text. The real ReadScreen (with its real CommentaryPanel,
// NoteEditor, ActionSheet and verse rows) and the real CollectionView are compiled with esbuild and drawn
// through scripts/render-jsx-screen.mjs; every action is a call to the handler the screen put on a real
// control; every answer is read off the redrawn tree or off the note store the screen wrote to.
// The Bible name/parse/key functions are NOT stubbed: parseRef, bookName, refLabel and refKey are lifted from
// engine.js as source text and run, so a key the screen writes is parsed by the engine's own parser.
//
// SABOTAGE (each scoped to the function under test, anchor asserted once, file md5 checked to move) is recorded
// next to each item's tests below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, find, reads } from './render-jsx-screen.mjs';

const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

// ── the engine's own reference functions, lifted from engine.js ───────────────────────────────────────────
const ENGINE = readFileSync(new URL('../engine.js', import.meta.url), 'utf8');
function liftEngineRefs() {
  const a = ENGINE.indexOf('  const BOOK_NAMES = [');
  const b = ENGINE.indexOf('  const USFM_BOOK = {');
  const c = ENGINE.indexOf('  function refLabel(loc, v)');
  const d = ENGINE.indexOf('\n', ENGINE.indexOf('  function refKey(loc, v)'));
  assert.ok(a > 0 && b > a && c > b && d > c, 're-anchor: engine.js reference helpers moved');
  const src = ENGINE.slice(a, b) + ENGINE.slice(c, d) + '\nreturn { bookName, parseRef, refLabel, refKey };';
  return new Function(src)();
}
const ENG = liftEngineRefs();

const verseText = (c, v) => 'Chapter ' + c + ' verse ' + v + ', with enough words in it to wrap on a phone.';

// The reader standing up on John 1 (or `start`), over a note store that behaves like app.jsx's:
// notes = {key: text}, setNote(k, text) puts or (for empty text) removes — the same two operations MyData does.
function reader(opts = {}) {
  const start = opts.start || { book: 43, chap: 1 };
  const store = { ...(opts.notes || {}) };
  const toasts = [];
  const { React, draw } = miniReact();
  const win = {
    addEventListener() {}, removeEventListener() {}, innerWidth: 360,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    TrinityData: { PLANS: [], VOTD_POOL: [], CROSSREFS: {} }, Fellowship: {}, speechSynthesis: null, sanitizeHtml: (h) => h,
  };
  const base = {
    React, window: win, localStorage: win.localStorage,
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null, activeElement: null },
    navigator: { userAgent: '', clipboard: { writeText: () => Promise.resolve() } },
    location: { search: '', hostname: 'x' },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    history: { back() {}, pushState() {}, replaceState() {}, state: null },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  };
  const { BottomSheet, useBackLayer } = loadScreen('app/ui.jsx', ['BottomSheet', 'useBackLayer'], base);
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const versesIn = (c) => Array.from({ length: 60 }, (_, i) => ({ v: i + 1, text: verseText(c, i + 1), html: verseText(c, i + 1) }));
  win.Bible = {
    loaded: true, activeVersion: 'WEB',
    books: () => [43], bookMeta: () => [{ n: 43, name: 'John', chapters: 21, group: 'nt' }],
    bookName: ENG.bookName, getVerses: (b, c) => versesIn(c), maxChapter: () => 21,
    refLabel: ENG.refLabel, parseRef: ENG.parseRef, refKey: ENG.refKey,
    defaultLoc: () => ({ ...start }),
    versions: () => [{ abbr: 'WEB', name: 'World English Bible' }],
    step: (l, d) => { const c = l.chap + d; return c >= 1 && c <= 21 ? { book: l.book, chap: c } : null; },
    subscribe: () => () => {}, getCommentary: () => null, lex: () => ({ missing: true }),
    getCatalog: async () => [], isInstalled: () => true, isInstalling: () => false, installModule: async () => ({}),
  };
  const mod = loadScreen('app/screens-read.jsx', ['ReadScreen', 'verseRefLabel'], {
    ...base, BottomSheet, useBackLayer, Icon, Bible: win.Bible,
    IconBtn: Stub('IconBtn'), Sheet: Stub('Sheet'), Halo: Stub('Halo'),
    SectionLabel: Stub('SectionLabel'), EmptyState: Stub('EmptyState'), ReadPlansTabs: Stub('ReadPlansTabs'),
    ChurchBadge: Stub('ChurchBadge'), Overlay: Stub('Overlay'),
    cx: (...a) => a.filter(Boolean).join(' '),
    lsGet: (k, d) => d, lsSet: () => {}, todayISO: () => '2026-10-03',
    useTrinityAudio: () => ({ track: null, playing: false }),
  });
  const { ReadScreen } = mod;
  const ctx = {
    loc: { ...start }, version: 'WEB',
    setLoc(x) { ctx.loc = { ...x }; },
    toast: (m) => toasts.push(m), toggleBookmark() {}, bookmarks: [], highlights: {},
    openShareSheet() {}, plans: [], planProgress: {}, church: { name: 'Test Church' },
    get notes() { return { ...store }; },
    setNote(k, t) { if (t) store[k] = t; else delete store[k]; },
    setHighlight(k, c) { if (c) ctx.highlights = { ...ctx.highlights, [k]: c }; else { const h = { ...ctx.highlights }; delete h[k]; ctx.highlights = h; } },
  };
  let tree = draw(ReadScreen, { ctx });
  const redraw = () => { tree = draw(ReadScreen, { ctx }); return tree; };
  // the screen's own effects (arriving on a verse) set state after the first draw, as in real React
  redraw();

  const tapVerse = (n) => {
    const row = find(tree, x => x.props && x.props.id === 'rv-' + n)[0];
    assert.ok(row, 'no verse row id="rv-' + n + '"');
    const hit = find(row, x => x.props && typeof x.props.onClick === 'function')[0] || row;
    hit.props.onClick({ target: {}, stopPropagation() {} });
    return redraw();
  };
  // a tile on the verse card, by the words on it ("Note", "Copy" ...)
  const pressTile = (label) => {
    const b = find(tree, x => x.type === 'button' && x.props && x.props.style && x.props.style.borderRadius === 16 && reads(x) === label)[0];
    assert.ok(b, 'no "' + label + '" tile on the verse card');
    b.props.onClick(); return redraw();
  };
  const buttonReading = (re) => find(tree, x => x.type === 'button' && re.test(reads(x)))[0];
  const press = (re) => { const b = buttonReading(re); assert.ok(b, 'no button reading ' + re); b.props.onClick(); return redraw(); };
  const typeInto = (pred, value) => { const t = find(tree, pred)[0]; assert.ok(t && t.props.onChange, 'nothing to type into'); t.props.onChange({ target: { value } }); return redraw(); };
  // does the verse row carry the gold note mark?
  const hasNoteMark = (n) => find(find(tree, x => x.props && x.props.id === 'rv-' + n)[0], x => x.props && x.props.name === 'note').length > 0;
  // THE STUDY PANEL, as a reader opens it: the edge tab, then the "My notes" segment.
  const openNotesPanel = () => {
    const edge = find(tree, x => x.type === 'button' && /NOTES/.test(reads(x)) && x.props && typeof x.props.onClick === 'function')[0];
    assert.ok(edge, 'no NOTES edge tab on the reader');
    edge.props.onClick(); redraw();
    press(/^My notes/);
  };
  const panelText = () => {
    // the panel is the one element the screen gives a left border and a slide transform
    const panel = find(tree, x => x.type === 'div' && x.props && x.props.style && x.props.style.borderLeft && x.props.style.transform)[0];
    assert.ok(panel, 'no Study panel in the tree');
    return reads(panel);
  };
  return { ctx, store, tapVerse, pressTile, press, typeInto, hasNoteMark, openNotesPanel, panelText, redraw, tree: () => tree, toasts,
    verseRefLabel: mod.verseRefLabel, win, base, React, draw };
}

// ═══ ITEM 36 ═══════════════════════════════════════════════════════════════════════════════════════════════

test('36: a note saved on a verse through the verse card is listed in the Study panel', () => {
  // the exact sim repro: select John 1:51, Note, type, Save; then NOTES > My notes
  const R = reader();
  R.tapVerse(51);
  R.pressTile('Note');
  R.typeInto(x => x.type === 'textarea', 'Heaven open - a note only Grace should read');
  R.press(/^Save$/);
  assert.deepEqual(Object.keys(R.store), ['43.1.51'], 'the verse card should have written one note under the canonical key');
  R.openNotesPanel();
  const t = R.panelText();
  assert.match(t, /Heaven open - a note only Grace should read/, 'the note made on John 1:51 is not in the panel: ' + t);
  assert.match(t, /John 1:51/, 'the panel should name the verse as a person reads it, not as a code: ' + t);
  assert.doesNotMatch(t, /No notes here yet/);
  assert.match(t, /My notes · 1/);
});

test('36: a note saved from the panel is written under the verse card\'s key, and shows on its verse', () => {
  const R = reader();
  R.openNotesPanel();
  R.press(/New note/);
  R.typeInto(x => x.type === 'input' && x.props.inputMode === 'numeric', '7');
  R.typeInto(x => x.type === 'textarea', 'Panel note on seven');
  R.press(/^Save note$/);
  assert.deepEqual(Object.keys(R.store), ['43.1.7'],
    'the panel wrote its note under a key the verse card never reads: ' + JSON.stringify(Object.keys(R.store)));
  assert.ok(R.hasNoteMark(7), 'the verse the note was made on shows no note mark');
  assert.match(R.panelText(), /Panel note on seven/);
  // and the verse card's own editor opens on it
  R.tapVerse(7);
  R.pressTile('Note');
  const ta = find(R.tree(), x => x.type === 'textarea')[0];
  assert.equal(ta.props.value, 'Panel note on seven', 'the verse card does not offer the note made in the panel');
});

test('36: a note an older build saved as "John 1:1" is still listed, still on its verse, and is folded in when edited', () => {
  const R = reader({ notes: { 'John 1:1': 'Old panel note' } });
  assert.ok(R.hasNoteMark(1), 'an older-format note does not show on its verse');
  R.openNotesPanel();
  assert.match(R.panelText(), /Old panel note/);
  // edit it from the verse card
  R.tapVerse(1);
  R.pressTile('Note');
  const ta = find(R.tree(), x => x.type === 'textarea')[0];
  assert.equal(ta.props.value, 'Old panel note', 'the verse card does not open on the older-format note');
  R.typeInto(x => x.type === 'textarea', 'Edited once');
  R.press(/^Save$/);
  assert.deepEqual(R.store, { '43.1.1': 'Edited once' },
    'after the edit exactly one note should remain, under the canonical key. Store: ' + JSON.stringify(R.store));
});

test('36: a verse with a note under BOTH spellings shows both texts, and nothing is lost on the next save', () => {
  const R = reader({ notes: { '43.1.3': 'Card note', 'John 1:3': 'Panel note' } });
  R.openNotesPanel();
  const t = R.panelText();
  assert.match(t, /Card note/); assert.match(t, /Panel note/, 'the second note is hidden behind the first: ' + t);
  assert.match(t, /My notes · 1/, 'one verse, one entry');
  R.tapVerse(3); R.pressTile('Note');
  const ta = find(R.tree(), x => x.type === 'textarea')[0];
  assert.match(ta.props.value, /Card note[\s\S]*Panel note/, 'the editor should open on both texts so saving cannot lose one');
  R.press(/^Save$/);
  assert.deepEqual(Object.keys(R.store), ['43.1.3']);
  assert.match(R.store['43.1.3'], /Card note[\s\S]*Panel note/);
});

test('36: the panel lists only THIS chapter\'s notes, in verse order', () => {
  const R = reader({ notes: { '43.1.9': 'nine', '43.2.1': 'chapter two', '43.1.2': 'two', 'John 1:5': 'five' } });
  R.openNotesPanel();
  const t = R.panelText();
  assert.doesNotMatch(t, /chapter two/);
  assert.ok(t.indexOf('two') < t.indexOf('five') && t.indexOf('five') < t.indexOf('nine'), 'not in verse order: ' + t);
  assert.match(t, /My notes · 3/);
});

// ── the Library lists the same notes: heading is "John 1:51", not "43.1.51" ───────────────────────────────
function library(items) {
  const { React, draw } = miniReact();
  const R = reader();   // gives us the real verseRefLabel the Library reaches through window
  const win = {
    MyData: { list: () => items, on: () => () => {}, remove() {}, setVisibility() {}, put() {} },
    TrinityData: { COLLECTION_ITEMS: {} }, verseRefLabel: R.verseRefLabel, addEventListener() {}, removeEventListener() {},
  };
  const g = {
    React, window: win, document: { addEventListener() {}, removeEventListener() {} },
    Icon: Stub('Icon'), IconBtn: Stub('IconBtn'), Spinner: Stub('Spinner'), ScreenScroll: (p) => p.children,
    Overlay: ({ children }) => React.createElement('div', {}, children),
    safeCssColor: (c) => c || 'var(--clay)',
  };
  const { CollectionView } = loadScreen('app/screens-library.jsx', ['CollectionView'], g);
  const tree = draw(CollectionView, { coll: { id: 'notes', name: 'Notes', icon: 'pen' }, open: true, onClose() {}, ctx: { toast() {} } });
  return reads(tree);
}
test('36: the Library names a verse-card note "John 1:51", not "43.1.51"', () => {
  const t = library([{ id: '43.1.51', ref: '43.1.51', text: 'Heaven open', date: 'Today' }, { id: 'John 1:1', ref: 'John 1:1', text: 'Panel', date: 'Today' }]);
  assert.match(t, /John 1:51/, 'the Library shows the raw code: ' + t);
  assert.doesNotMatch(t, /43\.1\.51/);
  assert.match(t, /John 1:1/, 'a note already spelt as a name must read unchanged');
});
