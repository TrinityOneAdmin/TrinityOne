// PER-FEATURE VISIBILITY TOGGLES — THE MEMBER HALF (rota / calendar / resources).
//   Run: node --test scripts/per-feature-toggles-member.test.mjs
//
// A steward who hides a section in Settings → Congregation features must see it DISAPPEAR from the member
// app, not just from the console. These three features each span several member surfaces, and CLAUDE.md
// rule 1 wants a point-of-use test PER surface — one that fails if the gate is deleted FROM THE SCREEN.
// Rule 3: nothing here matches text in app/*.jsx (they ship unbundled); every claim is read off a RENDERED
// tree built from the real component compiled with the build's own esbuild.
//
// Surfaces covered:
//   · rota      → the Serving overlay's "Serving" and "Rota" tabs (app/screens-serving.jsx)
//                 and the "You're serving" strip on Today (app/screens-today.jsx)
//   · calendar  → the Serving overlay's "Events" and "Calendar" tabs
//   · resources → the Today "Keep it going" reading-plan / devotional cards, and the Read screen's "Plans" tab
//   · #3        → rota AND calendar both off with no Kids/Care tab leaves _tabs EMPTY; the screen must show a
//                 quiet empty state, NOT crash on `_tabs[0][0]`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// rota + calendar — the Serving overlay tabs, and the all-off empty state (#3)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// The tab strip buttons carry one of these exact labels; a body button ("Yes, I can serve", …) never does,
// so matching the whole button text to this set reads the STRIP, not the content below it.
const TAB_LABELS = ['Serving', 'Rota', 'Kids', 'Events', 'Calendar', 'Care'];
// VISIBLE text only — the string/number children, NOT the string PROPS that texts() also collects (an Icon's
// `name="serving"`, a colour). A tab button's visible text is its label; a body link that happens to say
// "Events" is not a <button>, so matching button labels reads the STRIP, not the content below it.
const vis = (n, out = []) => {
  if (n == null || n === false) return out;
  if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return out; }
  if (Array.isArray(n)) { n.forEach(c => vis(c, out)); return out; }
  (n.kids || []).forEach(c => vis(c, out));
  return out;
};
function servingTabs(tree) {
  return find(tree, n => n.type === 'button')
    .map(b => vis(b).join('').trim())
    .filter(t => TAB_LABELS.includes(t));
}

function serving(features = {}, extraCtx = {}) {
  const { React, draw } = miniReact();
  const win = {
    Fellowship: { myPubkey: 'me' },
    Capacitor: { isNativePlatform: () => false },
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: true }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    innerWidth: 390,
  };
  const globals = {
    React, window: win,
    document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
    navigator: { userAgent: '' },
    localStorage: win.localStorage,
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    Overlay: function Overlay(p) { return React.createElement('div', { 'data-overlay': !!p.open }, p.open ? p.children : null); },
    SectionLabel: function SectionLabel(p) { return React.createElement('h2', {}, p.children); },
    Icon: Stub('Icon'), IconBtn: Stub('IconBtn'),
    BottomSheet: ({ open, children }) => (open ? children : null),
    CareCard: Stub('CareCard'), SafetyBanner: Stub('SafetyBanner'),
    safeCssColor: (c) => c,
    Math, Date, JSON, Set, Number, String, Array, Promise, Object, isNaN, Boolean,
  };
  const mod = loadScreen('app/screens-serving.jsx', ['ServingScreen'], globals);
  const ctx = {
    church: { name: 'St Aidan', features },
    myPubkey: 'me',
    checkinRegister: {},   // no Kids tab
    rotaVis: 'church',
    churchRosters: [], churchEvents: [], churchServices: [], churchRotas: [], churchTeams: [],
    servPending: [], servConfirmed: [], servDeclined: [], myRsvps: {},
    care: { settings: { enabled: false }, needs: [], slots: [], myPub: 'me' },
    myChildren: { children: [], askAtDesk: 0, settled: true },
    servingTab: 'serving',
    openHelp() {}, toast() {}, respondServing: async () => true,
    ...extraCtx,
  };
  const render = () => draw(mod.ServingScreen, { open: true, onClose() {}, ctx });
  render();                 // first draw queues the tab-strip effect…
  const tree = render();    // …the second sees what it settled on
  return { tree };
}

test('rota ON by default: the Serving and Rota tabs are on the strip', () => {
  const tabs = servingTabs(serving({}).tree);
  assert.ok(tabs.includes('Serving'), 're-anchor: the Serving tab is missing with no features set');
  assert.ok(tabs.includes('Rota'), 're-anchor: the Rota tab is missing with no features set');
});
test('rota OFF: both the Serving and Rota tabs vanish from the member app', () => {
  const tabs = servingTabs(serving({ rota: false }).tree);
  assert.ok(!tabs.includes('Serving'), 'features.rota === false but the Serving tab is still on the strip — the gate was deleted');
  assert.ok(!tabs.includes('Rota'), 'features.rota === false but the Rota tab is still on the strip');
  assert.ok(tabs.includes('Events'), 're-anchor: calendar is still on, so Events must still show');
});
test('calendar ON by default: the Events and Calendar tabs are on the strip', () => {
  const tabs = servingTabs(serving({}).tree);
  assert.ok(tabs.includes('Events') && tabs.includes('Calendar'), 're-anchor: Events/Calendar missing with no features set');
});
test('calendar OFF: both the Events and Calendar tabs vanish', () => {
  const tabs = servingTabs(serving({ calendar: false }).tree);
  assert.ok(!tabs.includes('Events'), 'features.calendar === false but the Events tab is still on the strip');
  assert.ok(!tabs.includes('Calendar'), 'features.calendar === false but the Calendar tab is still on the strip');
  assert.ok(tabs.includes('Serving'), 're-anchor: rota is still on, so Serving must still show');
});
test('#3 rota AND calendar OFF with no Kids/Care tab: a quiet empty state, NOT a crash on _tabs[0][0]', () => {
  let r;
  assert.doesNotThrow(() => { r = serving({ rota: false, calendar: false }); },
    'the serving screen threw with every tab hidden — the empty-_tabs guard is missing and _tabs[0][0] is undefined[0]');
  const tabs = servingTabs(r.tree);
  assert.equal(tabs.length, 0, 'tabs are still on the strip although rota and calendar are both off: ' + JSON.stringify(tabs));
  assert.ok(texts(r.tree).join(' ').includes('Nothing to show here yet'),
    'with every section off the screen renders no empty state — a member sees a blank pane, which this project ' +
    'keeps re-learning reads as "the app is broken"');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// rota + resources — the Today surfaces
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function today(features = {}, over = {}) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const date = new Date(Date.parse('2026-09-30T09:00:00Z'));
  const store = new Map();
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem(k, v) { store.set(k, String(v)); }, removeItem(k) { store.delete(k); } };
  const win = {
    addEventListener() {}, removeEventListener() {}, innerWidth: 360, localStorage,
    Fellowship: { subscribeCareRequests: () => () => {}, cancelCareRequest() {}, childCareAudience: async () => [] },
    TrinityData: { NOTIFICATIONS: [], PLANS: [{ id: 'p1', title: 'Through John', days: [{ d: 1, ref: 'John 1' }], len: 21 }],
      VOTD_POOL: [{ ref: 'John 3:16', text: 'For God so loved the world.' }] },
    Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1, activeVersion: 'WEB', bookName: () => 'Genesis', bookAbbr: () => 'Gen' },
  };
  const globals = {
    React, window: win, localStorage,
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    Icon,
    lsGet: (k, d) => d, lsSet: () => {},
    cx: (...a) => a.filter(Boolean).join(' '),
    SectionLabel: function SectionLabel(p) { return React.createElement('h2', {}, p.children); },
    Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'), ChurchBadge: Stub('ChurchBadge'),
    useTrinityAudio: () => ({ track: null, playing: false }),
    todayISO: () => date.toISOString().slice(0, 10),
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [date])); } static now() { return date.getTime(); } },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  };
  const { TodayScreen } = loadScreen('app/screens-today.jsx', ['TodayScreen'], globals);
  const ctx = {
    church: { name: 'Grace', initials: 'GR', npub: 'np1', features },
    openSearch() {}, openNotifications() {}, toggleDark() {}, dark: false, toast() {}, netUnread: 0,
    openListen() {}, openShareSheet() {}, openServing() {}, openReader() {}, openPlan() {}, openChurchDevo() {}, go() {}, gotoRef() {},
    planProgress: {}, planLast: {}, plans: [], churchPlans: [], churchDevos: [],
    churchEvents: [], myRsvps: {}, servPending: [], servNext: null, servingSeenTs: null,
    care: {}, loc: null,
    ...over,
  };
  return { draw: () => draw(TodayScreen, { ctx }) };
}

const SERV_NEXT = { id: 's1', date: '2026-10-04', teamName: 'Ushers', role: 'Door' };   // 'Ushers' appears ONLY in the serving strip

test('rota ON by default: the "You’re serving" strip shows the member’s next slot', () => {
  const t = today({}, { servNext: SERV_NEXT });
  assert.ok(texts(t.draw()).join(' ').includes('Ushers'),
    're-anchor: the serving strip does not show the next slot even with rota on and a slot present');
});
test('rota OFF: the "You’re serving" strip is gone from Today', () => {
  const t = today({ rota: false }, { servNext: SERV_NEXT });
  assert.ok(!texts(t.draw()).join(' ').includes('Ushers'),
    'features.rota === false but the "You’re serving" strip is still on Today — the gate was deleted');
});

test('resources ON by default: the reading-plan card shows on Today', () => {
  const t = today({}, { planProgress: { p1: [1] }, planLast: { p1: 2 } });   // a plan with progress -> the "Keep it going" card
  assert.ok(texts(t.draw()).join(' ').includes('Reading plan'),
    're-anchor: the reading-plan card is missing even with resources on and a plan started');
});
test('resources OFF: the reading-plan / devotional cards vanish from Today', () => {
  const t = today({ resources: false }, { planProgress: { p1: [1] }, planLast: { p1: 2 } });
  assert.ok(!texts(t.draw()).join(' ').includes('Reading plan'),
    'features.resources === false but the reading-plan card is still on Today — the gate was deleted');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// resources — the Read screen's "Plans" tab (app/ui.jsx, ReadPlansTabs)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function readPlansTabs(features = {}) {
  const { React, draw } = miniReact();
  const src = fnBody(read('app/ui.jsx'), 'function ReadPlansTabs(', 'ReadPlansTabs');
  const tmp = join(tmpdir(), 'pftm-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { ReadPlansTabs };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__pftm_' + Math.random().toString(36).slice(2);
  globalThis[key] = { React, Icon: Stub('Icon') };
  const preamble = `const React = globalThis.${key}.React;\nconst Icon = globalThis.${key}.Icon;`;
  const ReadPlansTabs = (await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'))).ReadPlansTabs;
  const ctx = { readView: 'bible', setReadView() {}, church: { features } };
  return texts(draw(ReadPlansTabs, { ctx })).map(t => String(t).trim());
}

test('resources ON by default: the Read screen offers the Plans tab', async () => {
  const labels = await readPlansTabs({});
  assert.ok(labels.includes('Bible') && labels.includes('Plans'), 're-anchor: ReadPlansTabs did not render both tabs with no features set');
});
test('resources OFF: the Plans tab is gone, leaving only Bible', async () => {
  const labels = await readPlansTabs({ resources: false });
  assert.ok(labels.includes('Bible'), 're-anchor: the Bible tab vanished too');
  assert.ok(!labels.includes('Plans'),
    'features.resources === false but the Read screen still offers the Plans tab — the gate was deleted');
});
