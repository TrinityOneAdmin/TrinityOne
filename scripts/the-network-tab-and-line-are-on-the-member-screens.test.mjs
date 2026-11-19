// THE NETWORK TAB, THE TODAY LINE, THE DOT AND THE EVENT TAG ARE ON THE MEMBER SCREENS (Networks member step 1; owner 2026-11-19).
//   Run: node --test scripts/the-network-tab-and-line-are-on-the-member-screens.test.mjs
//
// POINT OF USE: the REAL ServingScreen + EventDetail (app/screens-serving.jsx), TodayScreen (app/screens-today.jsx) and the Community card
// ServingEntry (app/screens-chat.jsx, sliced, with the REAL NetUpdateLine / NetUnreadDot from screens-today.jsx), compiled with the build's
// esbuild and drawn through render-jsx-screen.mjs's miniature React. What App puts in ctx (netTabs / netLine, and who gets them) is proved in
// a-network-reaches-members-only-through-whats-happening.test.mjs; this file proves the screens draw it, and draw NOTHING without it.
// Rule 3: nothing here matches text in app/*.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const vis = (n, out = []) => {
  if (n == null || n === false) return out;
  if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return out; }
  if (Array.isArray(n)) { n.forEach(c => vis(c, out)); return out; }
  (n.kids || []).forEach(c => vis(c, out));
  return out;
};
const said = (t) => vis(t).join('').replace(/\s+/g, ' ');
const byTestId = (t, id) => find(t, n => n.props && n.props['data-testid'] === id);

const NETHEX = 'ab'.repeat(32), KEY = 'net:' + NETHEX;
const iso = (days) => { const d = new Date(Date.now() + days * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const NOW = Math.floor(Date.now() / 1000);
const NET_EVENT = { id: 'ev1', title: 'Advent prayer evening', date: iso(10), time: '19:00', where: 'Bath Abbey', _network: 'BB&RB', _networkPub: NETHEX };
const CHURCH_EVENT = { id: 'ce1', title: 'Carols by candlelight', date: iso(12), time: '18:00', where: 'St Bede' };
const TAB = (over = {}) => ({ networkPub: NETHEX, npub: 'npub1net', key: KEY, title: 'BB&RB', name: 'Bed, Bath & Regions Beyond', state: 'ready',
  announcements: [{ id: 'a2', text: 'Regional youth weekend: booking opens Monday', ts: NOW - 7200, _network: 'BB&RB' }, { id: 'a1', text: 'Food bank needs drivers', ts: NOW - 5 * 86400, _network: 'BB&RB' }],
  events: [NET_EVENT], unread: [], ...over });

// ─── the What's happening overlay ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const TAB_LABELS_BASE = ['Serving', 'Rota', 'Kids', 'Events', 'Calendar', 'Care'];
function serving({ flag = true, features = {}, extraCtx = {} } = {}) {
  const { React, draw } = miniReact();
  const win = {
    NETWORKS_ENABLED: flag,
    Fellowship: { myPubkey: 'me' }, Capacitor: { isNativePlatform: () => false },
    addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: true }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, innerWidth: 390,
  };
  const globals = {
    React, window: win,
    document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
    navigator: { userAgent: '' }, localStorage: win.localStorage,
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    Overlay: function Overlay(p) { return React.createElement('div', { 'data-overlay': !!p.open }, p.open ? p.children : null); },
    SectionLabel: function SectionLabel(p) { return React.createElement('h2', {}, p.children); },
    Icon: Stub('Icon'), IconBtn: Stub('IconBtn'),
    BottomSheet: ({ open, children }) => (open ? children : null),
    CareCard: Stub('CareCard'), SafetyBanner: Stub('SafetyBanner'),
    safeCssColor: (c) => c,
    Math, Date, JSON, Set, Number, String, Array, Promise, Object, isNaN, Boolean,
  };
  const mod = loadScreen('app/screens-serving.jsx', ['ServingScreen', 'EventDetail'], globals);
  const seen = [], opened = [];
  const ctx = {
    church: { name: 'St Bede', features }, myPubkey: 'me', checkinRegister: {}, rotaVis: 'church',
    churchRosters: [], churchEvents: [], churchServices: [], churchRotas: [], churchTeams: [],
    servPending: [], servConfirmed: [], servDeclined: [], myRsvps: {},
    care: { settings: { enabled: false }, needs: [], slots: [], myPub: 'me' },
    myChildren: { children: [], askAtDesk: 0, settled: true },
    servingTab: 'serving', openHelp() {}, toast() {}, respondServing: async () => true, setRsvp: async () => true,
    markNetTabSeen: (pub) => seen.push(pub), openEvent: (e) => opened.push(e),
    ...extraCtx,
  };
  const render = () => draw(mod.ServingScreen, { open: true, onClose() {}, ctx });
  render(); render();   // the tab chosen on open, then the strip's fall-back to a tab that exists
  return { tree: render(), seen, opened, mod, draw, ctx };
}
const tabLabels = (tree, extra = []) => find(tree, n => n.type === 'button').map(b => said(b).trim()).filter(t => TAB_LABELS_BASE.includes(t) || extra.includes(t));

test('TAB: with the switch on and a joined network the overlay gets ONE more tab, LAST, titled by the short name', () => {
  const on = serving({ extraCtx: { netTabs: [TAB()] } });
  const labels = tabLabels(on.tree, ['BB&RB']);
  assert.equal(labels[labels.length - 1], 'BB&RB', 'the network tab is missing or not last: ' + JSON.stringify(labels));
  const off = serving({ extraCtx: { netTabs: [] } });
  assert.deepEqual(tabLabels(off.tree, ['BB&RB']), labels.slice(0, -1), 'with no joined network the strip changed in some other way');
});

test('FLAG OFF: the same ctx draws exactly the strip and pane a member had before networks (no tab, no network content)', () => {
  const off = serving({ flag: false, extraCtx: { netTabs: [TAB()], servingTab: KEY } });
  const plain = serving({ flag: false, extraCtx: {} });
  assert.deepEqual(tabLabels(off.tree, ['BB&RB']), tabLabels(plain.tree, ['BB&RB']), 'with the switch off a network tab still appeared');
  assert.equal(byTestId(off.tree, 'network-tab').length, 0, 'with the switch off the network pane was drawn');
  assert.equal(said(off.tree), said(plain.tree), 'with the switch off the overlay is not what it was before networks');
});

test('NOT JOINED / CHILD (ctx.netTabs empty): no network tab', () => {
  const t = serving({ extraCtx: { netTabs: [] } });
  assert.ok(!tabLabels(t.tree, ['BB&RB', 'Network']).some(l => l === 'BB&RB' || l === 'Network'));
  assert.equal(byTestId(t.tree, 'network-tab').length, 0);
});

test('PANE: opened on the network tab it shows the network name, Updates newest first with time ago, Coming up, and marks the network read', () => {
  const t = serving({ extraCtx: { netTabs: [TAB()], servingTab: KEY } });
  const pane = byTestId(t.tree, 'network-tab');
  assert.equal(pane.length, 1, 'the network pane is not drawn on its tab');
  const s = said(pane[0]);
  assert.match(s, /Bed, Bath & Regions Beyond/);
  assert.match(s, /St Bede is a member/);
  const ups = byTestId(pane[0], 'net-update').map(said);
  assert.equal(ups.length, 2);
  assert.match(ups[0], /2 hours ago.*Regional youth weekend/, 'the newest update is not first, or has no time ago: ' + ups[0]);
  assert.match(ups[1], /5 days ago.*Food bank/);
  assert.match(s, /Coming up/); assert.match(said(byTestId(pane[0], 'net-event')[0] || {}), /Advent prayer evening.*Bath Abbey/);
  assert.doesNotMatch(s, /Pray this week|Churches in the network|\d+ churches/, 'a step-2 section (labels / directory / count) is drawn with no data behind it');
  assert.deepEqual(t.seen, [NETHEX], 'looking at the network tab did not mark it read');
  // the pane draws no RSVP control
  assert.equal(find(pane[0], n => n.type === 'button' && /^(Going|Maybe|Can’t)$/.test(said(n).trim())).length, 0);
});

test('LOCKED: the waiting state says it is waiting for the church, not an error and not empty', () => {
  const t = serving({ extraCtx: { netTabs: [TAB({ state: 'locked', announcements: [], events: [] })], servingTab: KEY } });
  assert.equal(byTestId(t.tree, 'net-locked').length, 1, 'the locked network shows no waiting state');
  assert.match(said(t.tree), /Waiting for your church to share it with you/);
  assert.doesNotMatch(said(t.tree), /No updates yet/);
});

test('CALENDAR OFF: Events and Calendar go, the network tab stays', () => {
  const t = serving({ features: { calendar: false }, extraCtx: { netTabs: [TAB()] } });
  const labels = tabLabels(t.tree, ['BB&RB']);
  assert.ok(!labels.includes('Events') && !labels.includes('Calendar'), 're-anchor: the calendar switch did not remove Events/Calendar');
  assert.ok(labels.includes('BB&RB'), 'the church hid its calendar and the network tab went with it');
});

test('EVENTS TAB: a network event is tagged "🌐 from <short name>" and has NO RSVP; the church\'s own event keeps its RSVP (control)', () => {
  const t = serving({ extraCtx: { netTabs: [TAB()], servingTab: 'events', churchEvents: [NET_EVENT, CHURCH_EVENT] } });
  const cards = find(t.tree, n => n.type === 'div' && n.props && n.props.style && n.props.style.overflow === 'hidden' && /Advent prayer evening|Carols by candlelight/.test(said(n)));
  const net = cards.find(c => /Advent prayer evening/.test(said(c))), own = cards.find(c => /Carols by candlelight/.test(said(c)));
  assert.ok(net && own, 're-anchor: the two event cards were not found');
  assert.deepEqual(byTestId(net, 'net-from').map(n => said(n)), ['🌐 from BB&RB'], 'the network event is not tagged with the short name');
  const rsvp = (c) => find(c, n => n.type === 'button' && /^(Going|Maybe|Can’t)$/.test(said(n).trim())).length;
  assert.equal(rsvp(net), 0, 'a network event offers RSVP');
  assert.equal(rsvp(own), 3, 'CONTROL: the church event lost its RSVP, so the check above proves nothing');
  assert.equal(byTestId(own, 'net-from').length, 0);
});

test('EVENT SHEET: a network event opened from anywhere has no "Will you be there?" and says where it came from; a church event does (control)', () => {
  const t = serving();
  const { draw, mod, ctx } = t;
  const net = draw(mod.EventDetail, { event: NET_EVENT, open: true, onClose() {}, ctx });
  const own = draw(mod.EventDetail, { event: CHURCH_EVENT, open: true, onClose() {}, ctx });
  const rsvp = (c) => find(c, n => n.type === 'button' && /^(Going|Maybe|Can’t)$/.test(said(n).trim())).length;
  assert.equal(rsvp(net), 0, 'the event sheet offers RSVP to a network event');
  assert.doesNotMatch(said(net), /Will you be there/);
  assert.match(said(net), /🌐 from BB&RB/);
  assert.equal(rsvp(own), 3, 'CONTROL: the church event sheet has no RSVP');
});

// ─── Today ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function today(over = {}, flag = true) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const date = new Date(Date.parse('2026-11-19T09:00:00Z'));
  const store = new Map();
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem(k, v) { store.set(k, String(v)); }, removeItem(k) { store.delete(k); } };
  const win = {
    NETWORKS_ENABLED: flag, addEventListener() {}, removeEventListener() {}, innerWidth: 360, localStorage,
    Fellowship: { subscribeCareRequests: () => () => {}, cancelCareRequest() {}, childCareAudience: async () => [] },
    TrinityData: { NOTIFICATIONS: [], PLANS: [], VOTD_POOL: [{ ref: 'John 3:16', text: 'For God so loved the world.' }] },
    Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1, activeVersion: 'WEB', bookName: () => 'Genesis', bookAbbr: () => 'Gen' },
  };
  const globals = {
    React, window: win, localStorage,
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    setTimeout, clearTimeout, setInterval, clearInterval, console, Icon,
    lsGet: (k, d) => d, lsSet: () => {}, cx: (...a) => a.filter(Boolean).join(' '),
    SectionLabel: function SectionLabel(p) { return React.createElement('h2', {}, p.children); },
    Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'), ChurchBadge: Stub('ChurchBadge'),
    useTrinityAudio: () => ({ track: null, playing: false }),
    todayISO: () => date.toISOString().slice(0, 10),
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [date])); } static now() { return date.getTime(); } },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  };
  const { TodayScreen } = loadScreen('app/screens-today.jsx', ['TodayScreen'], globals);
  const opened = [];
  const ctx = {
    church: { name: 'St Bede', initials: 'SB', npub: 'np1', features: {} },
    openSearch() {}, openNotifications() {}, toggleDark() {}, dark: false, toast() {}, netUnread: 0,
    openListen() {}, openShareSheet() {}, openServing: (tab) => opened.push(tab), openReader() {}, openPlan() {}, openChurchDevo() {}, go() {}, gotoRef() {},
    planProgress: {}, planLast: {}, plans: [], churchPlans: [], churchDevos: [],
    churchEvents: [], myRsvps: {}, servPending: [], servNext: null, servingSeenTs: null, care: {}, loc: null,
    ...over,
  };
  return { draw: () => draw(TodayScreen, { ctx }), opened };
}
const LINE = { id: 'a2', text: 'Regional youth weekend: booking opens Monday\nLeaders, see the pack.', ts: NOW - 3600, tabKey: KEY, title: 'BB&RB' };
const SERV_NEXT = { id: 's1', date: '2026-11-23', teamName: 'Ushers', role: 'Door' };

test('TODAY: an unread update is ONE line on the What\'s happening card, below the serving line, "🌐 <short name> · <headline> ›", and a dot on the title', () => {
  const t = today({ netLine: LINE, servNext: SERV_NEXT });
  const tree = t.draw();
  const lines = byTestId(tree, 'net-line');
  assert.equal(lines.length, 1, 'no network line on the What\'s happening card');
  assert.equal(said(lines[0]), '🌐BB&RB · Regional youth weekend: booking opens Monday›');
  assert.equal(byTestId(tree, 'net-dot').length, 1, 'no unread dot on the What\'s happening title');
  const all = said(tree);
  assert.ok(all.indexOf('Ushers') !== -1 && all.indexOf('Ushers') < all.indexOf('BB&RB · Regional'), 'the serving line is gone or the network line is above it');
  // the dismissible serving strip still works beside it
  assert.equal(find(tree, n => n.type === 'button' && n.props['aria-label'] === 'Dismiss').length, 1, 'the serving strip lost its dismiss');
  // tapping opens What's happening on the network tab
  lines[0].props.onClick({ stopPropagation() {} });
  assert.deepEqual(t.opened, [KEY], 'tapping the line did not open the network tab');
});

test('TODAY: nothing unread = no line and no dot; the old "From your network" section is gone', () => {
  const t = today({ netLine: null, netAnnouncements: [{ id: 'a1', text: 'Food bank needs drivers', ts: NOW - 60, _network: 'BB&RB' }], netUnread: 1 });
  const tree = t.draw();
  assert.equal(byTestId(tree, 'net-line').length, 0);
  assert.equal(byTestId(tree, 'net-dot').length, 0);
  assert.doesNotMatch(said(tree), /From your network|Food bank/, 'network posts are still drawn as a section on Today');
});

test('TODAY, FLAG OFF: even a stray ctx.netLine draws nothing', () => {
  const tree = today({ netLine: LINE }, false).draw();
  assert.equal(byTestId(tree, 'net-line').length + byTestId(tree, 'net-dot').length, 0);
});

// ─── the Community card (ServingEntry) ────────────────────────────────────────────────────────────────────────────────────────────────────
async function servingEntry(ctxOver = {}, flag = true) {
  const { React, draw } = miniReact();
  const src = fnBody(readFileSync(join(ROOT, 'app/screens-chat.jsx'), 'utf8'), 'function ServingEntry(', 'ServingEntry');
  const tmp = join(tmpdir(), 'ntse-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { ServingEntry };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  // the REAL line + dot, from screens-today.jsx (where they are defined and shared from)
  const win = { NETWORKS_ENABLED: flag };
  const real = loadScreen('app/screens-today.jsx', ['NetUpdateLine', 'NetUnreadDot'], {
    React, window: win, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, document: {}, navigator: {}, location: {}, console,
    setTimeout, clearTimeout, setInterval, clearInterval, Icon: Stub('Icon'),
  });
  const key = '__ntse_' + Math.random().toString(36).slice(2);
  globalThis[key] = { React, Icon: Stub('Icon'), localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, ...real };
  const pre = `const React = globalThis.${key}.React;\nconst Icon = globalThis.${key}.Icon;\nconst localStorage = globalThis.${key}.localStorage;\nconst NetUpdateLine = globalThis.${key}.NetUpdateLine;\nconst NetUnreadDot = globalThis.${key}.NetUnreadDot;`;
  const m = await import('data:text/javascript;base64,' + Buffer.from(pre + '\n' + js).toString('base64'));
  const opened = [];
  const ctx = { servNext: SERV_NEXT, servPending: [], openServing: (t) => opened.push(t), care: { settings: { enabled: false } }, church: { features: {} }, ...ctxOver };
  return { tree: draw(m.ServingEntry, { ctx }), opened };
}

test('COMMUNITY CARD: the same line and dot, below the serving line, opening the network tab; none without an unread update', async () => {
  const on = await servingEntry({ netLine: LINE });
  assert.equal(byTestId(on.tree, 'net-line').length, 1, 'no network line on the Community What\'s happening card');
  assert.equal(byTestId(on.tree, 'net-dot').length, 1, 'no unread dot on the Community card title');
  const s = said(on.tree);
  assert.ok(s.indexOf('Ushers') < s.indexOf('BB&RB · Regional'), 'the network line is above the serving line');
  byTestId(on.tree, 'net-line')[0].props.onClick({ stopPropagation() {} });
  assert.deepEqual(on.opened, [KEY]);
  const off = await servingEntry({ netLine: null });
  assert.equal(byTestId(off.tree, 'net-line').length + byTestId(off.tree, 'net-dot').length, 0);
});
