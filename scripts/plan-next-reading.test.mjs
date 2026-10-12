// A MEMBER WHO OPENS A PLAN DAY IN THE READER CAN MARK IT DONE AND GO ON TO THE NEXT DAY FROM THERE.
// Run: node --test scripts/plan-next-reading.test.mjs
//
// Owner: "we need a good UX for having users go to the next verse in a plan after the first one; currently
// they have to go back to the plan manually." CLAUDE.md rules 1 and 3: this renders the REAL PlanDetail and the
// REAL ReadScreen (app/screens-plans.jsx, app/screens-read.jsx, compiled with esbuild, drawn through
// scripts/render-jsx-screen.mjs). The two app.jsx methods the path runs through - openPlanDay and
// togglePlanDay - are SLICED OUT OF app/app.jsx and run, not re-implemented, so the plan context and the done
// list are the shipped logic. Nothing asserts by matching text in app/*.jsx.
//
// Callers of the shared code (rule 2): ctx.openPlanDay - the Today "featured plan" button (screens-plans.jsx)
// and, since this change, PlanDetail's day rows (which used ctx.gotoRef) and the new bar's Next button.
// ctx.togglePlanDay - the tick in PlanDetail's day rows and the new bar's Mark day done. ctx.gotoRef now also
// clears the plan context (every non-plan jump into the reader).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');
const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const Passthrough = function Overlay({ children }) { return children === undefined ? null : children; };

// a member of app.jsx's ctx literal, cut out between its own key and the next one
function lift(startKey, endKey, scope) {
  const a = APP.indexOf('\n    ' + startKey + ':'), b = APP.indexOf('\n    ' + endKey + ':', a);
  assert.ok(a > 0 && b > a && APP.indexOf('\n    ' + startKey + ':', a + 1) < 0, 're-anchor: ' + startKey);
  const names = Object.keys(scope);
  return new Function(...names, 'return ({' + APP.slice(a, b) + '\n});')(...names.map(k => scope[k]))[startKey];
}

const PLAN = { id: 'p1', title: 'John', sub: '3 days', len: 3, days: [1, 2, 3].map(n => ({ d: n, ref: 'John ' + n, label: 'Day ' + n + ' label' })) };

function world() {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const Bible = {
    loaded: true, activeVersion: 'WEB', books: () => [43], maxChapter: () => 21, bookName: () => 'John', versions: () => [{ abbr: 'WEB' }],
    getVerses: () => [{ v: 1, text: 'In the beginning', html: 'In the beginning' }],
    bookMeta: () => [{ num: 43, name: 'John', abbr: 'Joh', group: 'g', ch: 21 }],
    getCommentary: () => [], commentaryList: () => [], searchDict: () => [], subscribe: () => () => {},
    defaultLoc: () => ({ book: 43, chap: 1 }),
    refLabel: (l, v) => 'John ' + l.chap + (v != null ? ':' + v : ''), refKey: (l, v) => l.book + '.' + l.chap + '.' + v,
    step: (at, dir) => ({ book: at.book, chap: at.chap + dir }),
    parseRef: (r) => { const m = /^John (\d+)(?::(\d+))?/.exec(r); return m ? { book: 43, chap: +m[1], verse: m[2] ? +m[2] : undefined } : null; },
  };
  const win = { Bible, speechSynthesis: null, innerWidth: 360, sanitizeHtml: h => h, getSelection: () => ({ toString: () => '' }), TrinityData: { CROSSREFS: {} } };
  const st = { loc: { book: 43, chap: 9 }, planRead: null, plans: {}, said: [] };
  const settings = { get: (k, d) => (k === 'plans' ? st.plans : d), set: (k, v) => { if (k === 'plans') st.plans = v; } };
  const toast = m => st.said.push(m);
  const openPlanDay = lift('openPlanDay', 'openJournal', { Bible, toast, setPlanRead: v => { st.planRead = v; }, setLoc: v => { st.loc = v; }, setReadView() {}, setTab() {} });
  const togglePlanDay = lift('togglePlanDay', 'toggleDevoDay', { MD: { settings } });
  const ctx = {
    get loc() { return st.loc; }, get planRead() { return st.planRead; }, get planProgress() { return st.plans; },
    version: 'WEB', setLoc: l => { st.loc = l; }, toast, openPlanDay, togglePlanDay,
    gotoRef: (book, chap, verse) => { st.planRead = null; st.loc = { book, chap, verse }; },
    highlights: {}, notes: {}, bookmarks: [], toggleBookmark() {}, setHighlight() {}, setNote() {},
    openShareSheet() {}, desktop: false, readScale: 1, removeTranslation() {}, addModule() {}, setVersion() {},
  };
  const plans = loadScreen('app/screens-plans.jsx', ['PlanDetail', 'PlanReadBar'], { React, window: win, Icon, Overlay: Passthrough });
  const globals = {
    React, window: win, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '', clipboard: null }, location: { search: '' },
    setTimeout, clearTimeout, setInterval, clearInterval, console, URLSearchParams, SpeechSynthesisUtterance: class {},
    Icon, cx: (...a) => a.filter(Boolean).join(' '), lsGet: (k, d) => d, lsSet: () => {},
    useTrinityAudio: () => ({ track: null, playing: false }),
    Overlay: Stub('Overlay'), ReadPlansTabs: Stub('ReadPlansTabs'), BottomSheet: Stub('BottomSheet'), useBackLayer: () => {},
    Sheet: Stub('Sheet'), Modal: Stub('Modal'), Pill: Stub('Pill'), Row: Stub('Row'), IconBtn: Stub('IconBtn'), Halo: Stub('Halo'), SectionLabel: Stub('SectionLabel'),
    PlanReadBar: plans.PlanReadBar,
  };
  const { ReadScreen } = loadScreen('app/screens-read.jsx', ['ReadScreen'], globals);
  const reader = () => draw(ReadScreen, { ctx });
  const detail = () => draw(plans.PlanDetail, { plan: PLAN, open: true, onClose() {}, ctx });
  const bar = () => find(reader(), n => n.props && n.props['data-testid'] === 'plan-read-bar')[0];
  const press = (label) => { const b = find(bar(), n => n.type === 'button' && texts(n).join(' ').includes(label)); assert.equal(b.length, 1, 'no single button "' + label + '"'); b[0].props.onClick(); };
  const openDay = (n) => { const rows = find(detail(), x => x.type === 'div' && x.props.onClick && texts(x).join(' ').includes('Day ' + n + ' label')); rows[rows.length - 1].props.onClick(); };
  return { st, ctx, bar, press, openDay, label: () => texts(bar()).join(' | ') };
}

test('opening Day 1 from the plan shows Mark day done and "Next: Day 2" in the reader; Next opens Day 2 in the reader', () => {
  const w = world();
  w.openDay(1);
  assert.deepEqual(w.st.loc, { book: 43, chap: 1, verse: undefined });
  assert.ok(w.bar(), 'no plan bar under the passage');
  assert.match(w.label(), /Mark day done/);
  assert.match(w.label(), /Next: Day 2 · John 2/);
  w.press('Next: Day 2');
  assert.equal(w.st.loc.chap, 2, 'Next did not open Day 2 reference');
  assert.match(w.label(), /Next: Day 3 · John 3/, 'the plan context was lost after Next');
});

test('Mark day done marks Day 1 done through the existing togglePlanDay', () => {
  const w = world();
  w.openDay(1);
  w.press('Mark day done');
  assert.deepEqual(w.st.plans, { p1: [1] });
  assert.match(w.label(), /Day done/);
  assert.doesNotMatch(w.label(), /Mark day done/);
});

test('the last day has Mark day done and no Next', () => {
  const w = world();
  w.openDay(3);
  assert.ok(w.bar());
  assert.match(w.label(), /Mark day done/);
  assert.doesNotMatch(w.label(), /Next:/);
});

test('a reader opened outside a plan, or paged away from the day, shows no bar', () => {
  const w = world();
  w.ctx.gotoRef(43, 1);
  assert.equal(w.bar(), undefined, 'bar shown with no plan');
  w.openDay(1);
  assert.ok(w.bar());
  w.ctx.setLoc({ book: 43, chap: 5 });
  assert.equal(w.bar(), undefined, 'bar still shown after paging to another chapter');
  w.openDay(1);
  w.ctx.gotoRef(43, 1);
  assert.equal(w.bar(), undefined, 'a non-plan jump kept the plan context');
});
