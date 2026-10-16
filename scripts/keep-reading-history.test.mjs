// "KEEP READING": the Today card offers up to 5 recent reading places, collapsed to the latest by default.
// Run: node --test scripts/keep-reading-history.test.mjs
// Renders the REAL TodayScreen (rule 1) and runs the REAL pushReadHistory lifted from app/app.jsx (rule 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';

const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');
const pushReadHistory = new Function('READ_HISTORY_MAX', 'return (' + fnBody(APP, 'function pushReadHistory(list, loc) {', 'pushReadHistory') + ')')(5);

const NAMES = { 1: 'Genesis', 2: 'Exodus', 3: 'Leviticus', 4: 'Numbers', 5: 'Deuteronomy', 6: 'Joshua', 43: 'John' };

function renderToday(history, loc) {
  const { React, draw } = miniReact();
  const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
  const LS = { getItem: () => null, setItem() {}, removeItem() {} };
  const Bible = { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], bookName: (b) => NAMES[b], bookAbbr: () => 'X', maxChapter: () => 50, activeVersion: 'WEB' };
  const win = { Fellowship: { myPubkey: 'me' }, Capacitor: { isNativePlatform: () => false },
    TrinityData: { VOTD_POOL: [{ ref: 'John 3:16', text: 'x' }], PLANS: [{ id: 'p1', name: 'A plan', days: [{ d: 1, ref: 'Gen 1' }] }], NOTIFICATIONS: [] },
    Bible,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    localStorage: LS, innerWidth: 390 };
  const globals = { React, window: win,
    document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
    navigator: { userAgent: '' }, localStorage: LS, setTimeout, clearTimeout, setInterval, clearInterval, console,
    Icon: function Icon(p) { return React.createElement('i', { 'data-icon': p.name }); }, IconBtn: Stub('IconBtn'), ChurchBadge: Stub('ChurchBadge'), SafetyBanner: Stub('SafetyBanner'),
    CareCard: Stub('CareCard'), AskForHelp: Stub('AskForHelp'),
    SectionLabel: function SectionLabel(p) { return React.createElement('h2', {}, p.children); },
    BottomSheet: ({ open, children }) => (open ? children : null),
    Overlay: function Overlay(p) { return React.createElement('div', {}, p.open ? p.children : null); },
    safeCssColor: (c) => c, todayISO: () => '2026-09-06',
    lsGet: (k, d) => (k === 'trinityone.readHistory.WEB' && history ? history : d), lsSet: () => {},
    Bible,
    Math, Date, JSON, Set, Map, Number, String, Array, Promise, Object, isNaN, Boolean, parseInt, parseFloat };
  const mod = loadScreen('app/screens-today.jsx', ['TodayScreen'], globals);
  const jumps = [];
  const ctx = { myChildren: { children: [], askAtDesk: 0, settled: true }, church: null,
    care: { settings: { enabled: false }, needs: [], myPub: 'me' }, planProgress: {}, loc, churchDevos: [],
    servNext: null, servPending: [], servingSeenTs: 0, netUnread: 0, dark: false,
    gotoRef: (...a) => jumps.push(a), openReader() { jumps.push(['openReader']); },
    openServing() {}, openChurchSwitcher() {}, openSearch() {}, openNotifications() {}, openListen() {},
    toggleDark() {}, toast() {}, openShareSheet() {}, openEvent() {}, openHelp() {} };
  const view = () => draw(mod.TodayScreen, { ctx });
  view();
  return { view, jumps };
}
const toggle = (tree) => find(tree, n => n.type === 'button' && /earlier places/.test(n.props['aria-label'] || ''))[0];
const H5 = [{ book: 43, chap: 3 }, { book: 1, chap: 1 }, { book: 2, chap: 20 }, { book: 3, chap: 4 }, { book: 4, chap: 9 }];

test('pushReadHistory: most recent first, de-duplicated by book+chapter, capped at 5', () => {
  let h = [];
  for (const [b, c] of [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1]]) h = pushReadHistory(h, { book: b, chap: c });
  assert.deepEqual(h.map(e => e.book), [6, 5, 4, 3, 2], 'cap of 5, newest first, oldest dropped');
  h = pushReadHistory(h, { book: 3, chap: 1, verse: 7 });
  assert.deepEqual(h.map(e => e.book), [3, 6, 5, 4, 2], 're-reading a chapter moves it to the front once');
  assert.equal(h[0].verse, 7);
  assert.deepEqual(pushReadHistory(h, null), h, 'a bad place leaves the list alone');
});

test('RENDERED: the latest place shows; the earlier four are collapsed until the chevron is tapped', () => {
  const { view, jumps } = renderToday(H5, { book: 43, chap: 3 });
  const all = () => texts(view()).join('');
  assert.match(all(), /John 3(?!:)/, 'the latest place must show');
  assert.doesNotMatch(all(), /Genesis 1/, 'earlier places must be collapsed by default');
  assert.ok(toggle(view()), 'no chevron to expand the earlier places');
  toggle(view()).props.onClick({ stopPropagation() {} });
  assert.equal(jumps.length, 0, 'the chevron must not open the reader');
  const out = all();
  for (const p of ['Genesis 1', 'Exodus 20', 'Leviticus 4', 'Numbers 9']) assert.match(out, new RegExp(p), p + ' missing once expanded');
  assert.equal((out.match(/John 3(?!:)/g) || []).length, 1, 'the live place must not be listed twice');
  toggle(view()).props.onClick({ stopPropagation() {} });
  assert.doesNotMatch(all(), /Numbers 9/, 'second tap collapses again');
});

test('RENDERED: tapping an earlier place goes to THAT place', () => {
  const { view, jumps } = renderToday(H5, { book: 43, chap: 3 });
  toggle(view()).props.onClick({ stopPropagation() {} });
  const row = find(view(), n => n.type === 'button' && /Leviticus 4/.test(texts(n).join('')))[0];
  assert.ok(row, 'no row for Leviticus 4');
  row.props.onClick();
  assert.deepEqual(jumps, [[3, 4, undefined]]);
});

test('CONTROL: with only one place there is no chevron and the card behaves as before', () => {
  const { view } = renderToday([{ book: 43, chap: 3 }], { book: 43, chap: 3 });
  const t = view();
  assert.equal(toggle(t), undefined);
  assert.match(texts(t).join(''), /John 3(?!:)/);
  assert.equal(toggle(renderToday(null, { book: 43, chap: 3 }).view()), undefined, 'no history stored yet: no chevron');
});
