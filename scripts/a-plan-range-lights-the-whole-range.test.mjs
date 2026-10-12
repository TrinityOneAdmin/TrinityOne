// A PLAN DAY "John 3:16-21" LIGHTS VERSES 16 TO 21 IN THE READER, NOT JUST 16.
// Run: node --test scripts/a-plan-range-lights-the-whole-range.test.mjs
//
// Device finding 2026-10-12. engine.js parseRef dropped the end of a range, openPlanDay copied only
// {book, chap, verse}, and the reader lit exactly one verse.
//
// Point of use (CLAUDE.md rule 1, rule 3): the REAL ReadScreen is compiled and drawn; openPlanDay is SLICED OUT of
// app/app.jsx and run; parseRef is lifted from engine.js and run. The assertion reads `reading` OFF THE
// <VerseRow> ELEMENTS the screen produced, so removing the highlight from the screen turns this red.
//
// Callers of the shared code (rule 2). parseRef (engine.js) is used by: app.jsx openPlanDay, screens-plans.jsx
// (PlanDetail openDay, PlanReadBar), screens-read.jsx noteKeyOf, screens-today.jsx (verse card, verse-of-the-day
// pages), stew-dashboard.jsx DashVersePrompt.resolveText. The change is additive (a new `verseEnd` key, present
// only on a forward same-chapter range); only openPlanDay and the reader read it.
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

function liftOpenPlanDay(scope) {
  const a = APP.indexOf('\n    openPlanDay:'), b = APP.indexOf('\n    openJournal:', a);
  assert.ok(a > 0 && b > a && APP.indexOf('\n    openPlanDay:', a + 1) < 0, 're-anchor: openPlanDay');
  const names = Object.keys(scope);
  return new Function(...names, 'return ({' + APP.slice(a, b) + '\n});')(...names.map(k => scope[k])).openPlanDay;
}

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
  const win = { Bible, speechSynthesis: null, innerWidth: 360, sanitizeHtml: h => h, getSelection: () => ({ toString: () => '' }), TrinityData: { CROSSREFS: {}, PLANS: [] } };
  const st = { loc: { book: 43, chap: 1 }, planRead: null };
  const openPlanDay = liftOpenPlanDay({ Bible, toast() {}, activeChurch: 'A', setPlanRead: v => { st.planRead = v; }, setLoc: v => { st.loc = v; }, setReadView() {}, setTab() {} });
  const ctx = {
    get loc() { return st.loc; }, get planRead() { return st.planRead; }, planProgress: {}, planChurch: 'A', churchPlans: [],
    version: 'WEB', setLoc: l => { st.loc = l; }, toast() {}, openPlanDay, togglePlanDay() {},
    gotoRef: (book, chap, verse) => { st.planRead = null; st.loc = { book, chap, verse }; },
    highlights: {}, notes: {}, bookmarks: [], toggleBookmark() {}, setHighlight() {}, setNote() {},
    openShareSheet() {}, desktop: false, readScale: 1, removeTranslation() {}, addModule() {}, setVersion() {},
  };
  const plans = loadScreen('app/screens-plans.jsx', ['PlanReadBar'], { React, window: win, Icon, Overlay: Stub('Overlay') });
  const globals = {
    React, window: win, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '', clipboard: null }, location: { search: '' },
    setTimeout: () => 0, clearTimeout, setInterval: () => 0, clearInterval, console, URLSearchParams, SpeechSynthesisUtterance: class {},
    Icon, cx: (...a) => a.filter(Boolean).join(' '), lsGet: (k, d) => d, lsSet: () => {},
    useTrinityAudio: () => ({ track: null, playing: false }),
    Overlay: Stub('Overlay'), ReadPlansTabs: Stub('ReadPlansTabs'), BottomSheet: Stub('BottomSheet'), useBackLayer: () => {},
    Sheet: Stub('Sheet'), Modal: Stub('Modal'), Pill: Stub('Pill'), Row: Stub('Row'), IconBtn: Stub('IconBtn'), Halo: Stub('Halo'), SectionLabel: Stub('SectionLabel'),
    PlanReadBar: plans.PlanReadBar,
  };
  const { ReadScreen } = loadScreen('app/screens-read.jsx', ['ReadScreen'], globals);
  // open a day, then draw twice: the arrival effect sets `arrived` on the first draw and shows it on the second
  const lit = (ref) => {
    ctx.openPlanDay({ id: 'p', days: [] }, { d: 1, ref });
    draw(ReadScreen, { ctx });
    const t = draw(ReadScreen, { ctx });
    return find(t, n => n.type && n.type.name === 'VerseRow' && n.props.reading).map(n => n.props.n);
  };
  return { lit, st };
}

test('engine parseRef: a forward same-chapter range carries verseEnd; nothing else does', () => {
  assert.deepEqual(ENG.parseRef('John 3:16-21'), { book: 43, chap: 3, verse: 16, verseEnd: 21 });
  assert.deepEqual(ENG.parseRef('John 3:16–21'), { book: 43, chap: 3, verse: 16, verseEnd: 21 });
  assert.deepEqual(ENG.parseRef('John 3:16'), { book: 43, chap: 3, verse: 16 });
  assert.deepEqual(ENG.parseRef('John 3'), { book: 43, chap: 3, verse: undefined });
  assert.deepEqual(ENG.parseRef('John 3:16-4:2'), { book: 43, chap: 3, verse: 16 }, 'a range into the next chapter has no same-chapter end');
  assert.deepEqual(ENG.parseRef('John 3:16-16'), { book: 43, chap: 3, verse: 16 });
});

test('a plan day "John 3:16-21" opened in the reader lights verses 16 to 21', () => {
  assert.deepEqual(world().lit('John 3:16-21'), [16, 17, 18, 19, 20, 21]);
});

test('a single-verse day still lights only that verse; a whole-chapter day lights none', () => {
  assert.deepEqual(world().lit('John 3:16'), [16]);
  assert.deepEqual(world().lit('John 3'), []);
});
