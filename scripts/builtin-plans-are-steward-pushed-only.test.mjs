// THE 11 BUILT-IN READING PLANS REACH A MEMBER ONLY WHEN A STEWARD PUSHES THEM.   Run: node --test scripts/builtin-plans-are-steward-pushed-only.test.mjs
// Owner 2026-10-19: Discover no longer lists app/data.jsx PLANS; a church with no shared plan gets a friendly note; the Today
// "Keep it going" plan card is hidden until the member starts a plan (no John fallback); the console library holds all 11 built-ins.
// POINT OF USE (rules 1, 3): the REAL PlansScreen, TodayScreen and DashPlans are compiled and drawn; nothing text-matches app/*.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadScreen, compileScreen, miniReact, find, texts, button } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const days = (n) => Array.from({ length: n }, (_, i) => ({ d: i + 1, ref: 'John ' + (i + 1), label: 'Day ' + (i + 1) }));
const JOHN = { id: 'john21', title: 'The Gospel of John', sub: '21 days', len: 21, days: days(21), accent: 'var(--clay)', tag: 'Gospels' };
const CHURCH = { id: 'church-1', title: 'Advent at Grace', sub: '3 days', len: 3, days: days(3), accent: 'var(--sage)', tag: 'Advent' };

// ── member: PlansScreen ──
function plans({ churchPlans = [], followed = [], progress = {}, tab } = {}) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const win = { TrinityData: { PLANS: [JOHN] }, localStorage: { getItem: () => null, setItem() {} } };
  const globals = { React, window: win, Icon, ScreenScroll: ({ children }) => children, ReadPlansTabs: Stub('ReadPlansTabs'), SectionLabel: ({ children }) => children,
    groupDevosBySeries: () => ({ groups: [], singles: [] }), DevoSeriesHero: Stub('x'), DevoSeriesCard: Stub('y'), DevoCard: Stub('z'), console, setTimeout, clearTimeout };
  const { PlansScreen } = loadScreen('app/screens-plans.jsx', ['PlansScreen'], globals);
  const ctx = { churchPlans, church: { name: 'Grace' }, plansFollowed: followed, plansHidden: [], planProgress: progress, setPlanInMine() {}, openPlan() {}, openPlanDay() {}, churchDevos: [] };
  let tree = draw(PlansScreen, { ctx });
  if (tab) { button(tree, tab)[0].props.onClick(); tree = draw(PlansScreen, { ctx }); }
  return { all: () => texts(tree).join(' | '), tree };
}

test('Browse with NO church plan lists no built-in and shows the friendly note', () => {
  const s = plans({ tab: 'Browse' });
  assert.ok(!/Gospel of John/.test(s.all()), 'a built-in plan is still offered to the member: ' + s.all());
  assert.ok(!/Discover plans/.test(s.all()), 'the Discover section is still there');
  assert.match(s.all(), /hasn.t shared a reading plan yet/, 'no friendly empty note');
});

test('Browse with a church plan lists it, still no built-in, no empty note', () => {
  const s = plans({ churchPlans: [CHURCH], tab: 'Browse' });
  assert.match(s.all(), /Advent at Grace/);
  assert.ok(!/Gospel of John/.test(s.all()));
  assert.ok(!/hasn.t shared a reading plan/.test(s.all()));
});

test('My Plans: nothing offered fresh, but a built-in the member already follows is kept', () => {
  assert.ok(!/Gospel of John/.test(plans({}).all()), 'a built-in shows in My Plans for a member who never chose it');
  assert.match(plans({ followed: ['john21'] }).all(), /Gospel of John/, 'a followed built-in was taken away');
});

// ── member: Today ──
function today({ churchPlans = [], progress = {}, planLast = {} } = {}) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const date = new Date('2026-09-30T09:00:00Z');
  const localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const win = { addEventListener() {}, removeEventListener() {}, innerWidth: 360, localStorage,
    Fellowship: { subscribeCareRequests: () => () => {}, cancelCareRequest() {}, childCareAudience: async () => [] }, ChurchBadge: Stub('ChurchBadge'),
    TrinityData: { NOTIFICATIONS: [], PLANS: [JOHN], VOTD_POOL: [{ ref: 'John 3:16', text: 'x' }] },
    Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1, activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }) } };
  const globals = { React, window: win, localStorage, document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null }, navigator: { userAgent: '' },
    location: { search: '', hostname: 'x' }, setTimeout, clearTimeout, setInterval, clearInterval, console, Icon, ChurchBadge: Stub('ChurchBadge'),
    lsGet: (k, d) => d, lsSet: () => {}, cx: (...a) => a.filter(Boolean).join(' '), SectionLabel: ({ children }) => ({ type: 'SectionLabel', props: {}, kids: [children] }),
    Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'), useTrinityAudio: () => ({ track: null, playing: false }), todayISO: () => '2026-09-30',
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [date])); } static now() { return date.getTime(); } }, fetch: async () => ({ ok: false, json: async () => ({}) }) };
  const { TodayScreen } = loadScreen('app/screens-today.jsx', ['TodayScreen'], globals);
  const ctx = { church: { name: 'Grace', initials: 'G', npub: 'np1' }, openChurchSwitcher() {}, openSearch() {}, openNotifications() {}, toggleDark() {}, dark: false, toast() {}, netUnread: 0,
    openServing() {}, openListen() {}, openShareSheet() {}, openPlan() {}, planProgress: progress, planLast, churchPlans, plans: [], bookmarks: [], notes: {}, highlights: {} };
  const tree = draw(TodayScreen, { ctx });
  return { all: texts(tree).join(' | '), card: find(tree, n => n.props && 'data-plan-line' in n.props).length };
}

test('Today: a member who has started no plan sees NO Keep-it-going plan card and no John', () => {
  const s = today({});
  assert.equal(s.card, 0, 'the plan card is still on Today');
  assert.ok(!/Gospel of John/.test(s.all) && !/Keep it going/.test(s.all), s.all);
});

test('Today: a started plan (built-in or church) still shows; most recently read wins', () => {
  assert.equal(today({ progress: { john21: [1, 2] } }).card, 1, 'a member with progress on a built-in lost the card');
  const both = today({ churchPlans: [CHURCH], progress: { john21: [1, 2], 'church-1': [1] }, planLast: { john21: 100, 'church-1': 200 } });
  assert.match(both.all, /Advent at Grace/); assert.ok(!/Gospel of John/.test(both.all));
});

// ── console: the library and Share ──
async function dash() {
  const ids = [];
  const sk = new Function('window', 'React', compileScreen('app/stew-data.jsx') + '\nreturn SK;')({}, {});
  const SRC = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
  const m0 = SRC.indexOf('\nfunction DashPlans(');
  assert.ok(m0 > 0 && SRC.indexOf('\nfunction DashPlans(', m0 + 1) < 0, 're-anchor: DashPlans');
  const tmp = join(tmpdir(), 'bp-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try { writeFileSync(tmp, SRC.slice(m0, SRC.indexOf('\nwindow.DashPlans =', m0)) + '\nexport { DashPlans };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' }); } finally { rmSync(tmp, { force: true }); }
  const { React, draw } = miniReact();
  const published = [];
  const globals = { React, Icon: () => null, Panel: (p) => p.children, NewPlanModal: () => null, confirm: () => true,
    window: { useStewardPlans: () => [], SK: sk, Steward: { async publishPlan(p) { published.push(p); return { ts: 1 }; }, async removePlan() {} } } };
  const key = '__bp_' + Math.random().toString(36).slice(2); globalThis[key] = globals;
  const pre = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const { DashPlans } = await import('data:text/javascript;base64,' + Buffer.from(pre + '\n' + js).toString('base64'));
  const tree = draw(DashPlans, {});
  return { sk, published, tree, shares: button(tree, 'Share'), all: texts(tree).join(' | ') };
}

test('console: the library holds ALL 11 built-ins, identical to the member app, and Share publishes the chosen one verbatim', async () => {
  const memberPlans = new Function(readFileSync(join(ROOT, 'app/data.jsx'), 'utf8').match(/const _johnLabels[\s\S]*?(?=\nPLANS\.forEach)/)[0] + '\nreturn PLANS;')();
  const d = await dash();
  assert.equal(d.sk.planLibrary.length, 11);
  assert.deepEqual(d.sk.planLibrary, memberPlans, 'the console library is not the member app\'s built-in plans, verbatim');
  assert.equal(d.shares.length, 11, 'the steward is not offered every built-in to Share');
  assert.match(d.all, /Romans/);
  const at = d.sk.planLibrary.findIndex(p => p.id === 'romans');
  d.shares[at].props.onClick();
  assert.equal(d.published.length, 1);
  assert.equal(d.published[0].id, 'romans'); assert.deepEqual(d.published[0].days, memberPlans[at].days);
});
