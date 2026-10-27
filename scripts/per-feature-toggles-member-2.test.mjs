// PER-FEATURE VISIBILITY — THE LEAKS THE AUDIT FOUND + the owner's resources scope call (follow-up to
// scripts/per-feature-toggles-member.test.mjs).  Run: node --test scripts/per-feature-toggles-member-2.test.mjs
//
// A feature hidden in the console must be gone from EVERY member surface. The audit found four it still
// showed on, and the owner widened `resources` to cover sermons and the verse-prompt card. Each surface gets
// a point-of-use ON/OFF pair that RUNS the real component / lifted function (CLAUDE.md rules 1 & 3 — no
// text-match of app/*.jsx):
//   · calendar  → the in-group "UPCOMING IN THIS GROUP" card + "EVENT" compose button (ChatRoom)
//   · calendar  → the "New event" notifications-bell row (notifFeatureRows)
//   · calendar  → servingNewCount, so the "something new" dot stops counting events
//   · resources → the devotional / reading-plan / sermon notifications rows (notifFeatureRows)
//   · rota      → the "You're serving" folded line on the Community hub card (ServingEntry)
//   · resources → the Today pinned-sermon card AND the "Your church is reading" verse-prompt card
//                 (and Verse of the Day STAYS — it is a built-in reader feature)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const allText = (t) => texts(t).join(' | ');
// VISIBLE children only (not the string props texts() also collects) — see per-feature-toggles-member.test.mjs
const vis = (n, out = []) => {
  if (n == null || n === false) return out;
  if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return out; }
  if (Array.isArray(n)) { n.forEach(c => vis(c, out)); return out; }
  (n.kids || []).forEach(c => vis(c, out));
  return out;
};

// ═══ calendar — the in-group events card + EVENT button (app/screens-chat.jsx ChatRoom) ═════════════════════
const EVS = [{ id: 'e1', title: 'Pizza night', date: '2026-10-04', time: '18:00', groupId: 'g1', accent: '#888' }];
function room({ features = {}, events = EVS, canAdd = false } = {}) {
  const { React, draw } = miniReact();
  const group = { id: 'g1', name: 'Youth', kind: 'Group', accent: '#888' };
  const Fellowship = {
    myPubkey: 'me', relays: ['wss://r'], relayReady: () => true, groupEncState: () => 'clear',
    subscribeGroup: () => () => {}, subscribeReactions: () => () => {}, subscribeGroupPin: (_g, cb) => { cb(null); return () => {}; },
    subscribeHidden: (_g, cb) => { cb(new Set()); return () => {}; }, subscribeMessageTags: () => () => {},
    displayFor: () => ({ handle: 'sam', color: '#888' }), requestProfiles: () => {}, outboxFor: () => [], onOutbox: () => () => {},
    canAddGroupEvent: () => canAdd, react: () => {},
  };
  const mod = loadScreen('app/screens-chat.jsx', ['ChatRoom'], {
    React,
    window: { Fellowship, TrinityData: { CHAT_IDENTITY: { handle: 'me', color: '#123456' }, GROUPS: [], RELAYS: [] },
      TrinityIdentity: { current: { handle: 'me', color: '#123456' } }, addEventListener() {}, removeEventListener() {},
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, confirm: () => true },
    document: { createElement: () => ({ style: {} }), body: {}, addEventListener() {}, removeEventListener() {} },
    location: { search: '', href: 'https://app.trinityone.church/' },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    lsGet: (k, d) => d, lsSet: () => {}, todayISO: () => '2026-09-01',
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }), IconBtn: () => null,
    Overlay: ({ open, children }) => (open ? children : null), UserAvatar: () => null, SectionLabel: ({ children }) => children,
    BottomSheet: ({ children }) => children, safeCssColor: (c) => c, D: { GROUPS: [], RELAYS: [] },
  });
  const ctx = { toast() {}, church: { npub: 'npub1church', name: 'St Aidan', id: 'c1', features }, myLeaderGroups: [], churchEvents: events,
    safeguard: {}, myPubkey: 'me', openDM() {}, canDMPeer: () => true, connTick: 0,
    joinState: { loaded: true, isPending: false, removed: false, offline: false } };
  return draw(mod.ChatRoom, { group, open: true, onClose() {}, ctx, docked: true });
}
const eventBtn = (t) => find(t, n => n.type === 'button' && vis(n).join('').trim() === 'EVENT');

test('calendar ON: the in-group events card shows', () => {
  assert.match(allText(room({ features: {} })), /UPCOMING IN THIS GROUP/, 're-anchor: the events card is gone even with calendar on');
});
test('calendar OFF: no in-group events card and no event cards', () => {
  const t = room({ features: { calendar: false } });
  assert.doesNotMatch(allText(t), /UPCOMING IN THIS GROUP/, 'features.calendar === false but the in-group events card still shows — the gate was deleted');
  assert.doesNotMatch(allText(t), /Pizza night/, 'the event cards are still rendered with calendar off');
});
test('calendar ON + leader: the "EVENT" compose button is offered', () => {
  assert.equal(eventBtn(room({ features: {}, events: [], canAdd: true })).length, 1, 're-anchor: a leader is not offered the EVENT button with calendar on');
});
test('calendar OFF: a leader is NOT offered the "EVENT" compose button', () => {
  assert.equal(eventBtn(room({ features: { calendar: false }, events: [], canAdd: true })).length, 0,
    'features.calendar === false but the create-event button is still offered in group chat');
});

// ═══ rota — the "You're serving" folded line on the Community hub card (ServingEntry) ═══════════════════════
function servingEntry(features = {}, servNext = { id: 's1', date: '2026-10-04', teamName: 'Ushers', role: 'Door' }) {
  const { React, draw } = miniReact();
  const src = fnBody(read('app/screens-chat.jsx'), 'function ServingEntry(', 'ServingEntry');
  const tmp = join(tmpdir(), 'pfse-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { ServingEntry };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__pfse_' + Math.random().toString(36).slice(2);
  globalThis[key] = { React, Icon: Stub('Icon'), localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  const pre = `const React = globalThis.${key}.React;\nconst Icon = globalThis.${key}.Icon;\nconst localStorage = globalThis.${key}.localStorage;`;
  return import('data:text/javascript;base64,' + Buffer.from(pre + '\n' + js).toString('base64')).then(m => {
    const ctx = { servNext, servPending: [], openServing() {}, care: { settings: { enabled: false } }, church: { features } };
    return draw(m.ServingEntry, { ctx });
  });
}
test('rota ON: the "You’re serving" line shows on the Community hub card', async () => {
  assert.match(allText(await servingEntry({})), /Ushers/, 're-anchor: the serving line is gone even with rota on');
});
test('rota OFF: the serving line is gone, but the hub card ("What’s happening") stays', async () => {
  const t = await servingEntry({ rota: false });
  assert.doesNotMatch(allText(t), /Ushers/, 'features.rota === false but the "You’re serving" line still shows on the Community card');
  assert.match(allText(t), /What's happening/, 'the hub card itself must stay — it is the entry to the Serving overlay where Care lives');
});

// ═══ calendar + resources — the notifications-bell rows (app/screens-extras.jsx notifFeatureRows) ═══════════
const notifFeatureRows = new Function(fnBody(read('app/screens-extras.jsx'), 'function notifFeatureRows(', 'notifFeatureRows') + '\nreturn notifFeatureRows;')();
const DEVO = { id: 'd1', title: 'Grace', ts: 1 };
const PLAN = { id: 'p1', title: 'Through John', ts: 1 };
const SERMON = { id: 's1', sha256: 'x', title: 'Sunday', mime: 'audio/mp3', ts: 1 };
const EVENT = { id: 'e1', title: 'Quiz', ts: 1 };
const kindsOf = (feat) => notifFeatureRows({ churchDevos: [DEVO], pinnedSermon: SERMON, churchPlans: [PLAN], churchEvents: [EVENT], churchName: 'St Aidan', ...feat }).map(r => r.kind);

test('both ON by default: devotional, sermon, plan and event rows are all pushed to the bell', () => {
  const k = kindsOf({ calOn: true, resOn: true });
  assert.deepEqual(new Set(k), new Set(['devotional', 'sermon', 'plan', 'event']), 're-anchor: a default row is missing from the feed');
});
test('calendar OFF: the "New event" bell row (and its openEvent deep link) is gone; resources rows stay', () => {
  const k = kindsOf({ calOn: false, resOn: true });
  assert.ok(!k.includes('event'), 'features.calendar === false but the event notification row still appears');
  assert.ok(k.includes('devotional') && k.includes('plan') && k.includes('sermon'), 'calendar off wrongly dropped a resources row');
});
test('resources OFF: devotional, reading-plan and sermon bell rows are gone; the event row stays', () => {
  const k = kindsOf({ calOn: true, resOn: false });
  assert.ok(!k.includes('devotional') && !k.includes('plan') && !k.includes('sermon'),
    'features.resources === false but a devotional/plan/sermon notification row still appears');
  assert.ok(k.includes('event'), 'resources off wrongly dropped the event row');
});

// ═══ calendar — servingNewCount stops counting events (app/screens-today.jsx) ═══════════════════════════════
const servingNewCount = new Function(fnBody(read('app/screens-today.jsx'), 'function servingNewCount(', 'servingNewCount') + '\nreturn servingNewCount;')();
test('calendar ON: servingNewCount counts events posted since the mark', () => {
  const ctx = { church: { features: {} }, churchEvents: [{ id: 'e1', ts: 100 }, { id: 'e2', ts: 200 }] };
  assert.equal(servingNewCount(ctx, 50), 2, 're-anchor: the badge count is not 2 with two new events and calendar on');
});
test('calendar OFF: servingNewCount returns 0 — no events to open, nothing to badge', () => {
  const ctx = { church: { features: { calendar: false } }, churchEvents: [{ id: 'e1', ts: 100 }, { id: 'e2', ts: 200 }] };
  assert.equal(servingNewCount(ctx, 50), 0, 'features.calendar === false but the "something new" dot still counts events');
});

// ═══ resources — the Today sermon card + verse-prompt card; Verse of the Day STAYS ══════════════════════════
function today(features = {}, over = {}) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const date = new Date(Date.parse('2026-09-30T09:00:00Z'));
  const store = new Map();
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem(k, v) { store.set(k, String(v)); }, removeItem(k) { store.delete(k); } };
  const win = {
    addEventListener() {}, removeEventListener() {}, innerWidth: 360, localStorage,
    Fellowship: { subscribeCareRequests: () => () => {}, cancelCareRequest() {}, childCareAudience: async () => [],
      subscribeChurchVersePrompt: (_np, cb) => { cb({ ref: 'Psalm 23', note: 'Read with us', schedule: [] }); return () => {}; } },
    TrinityData: { NOTIFICATIONS: [], PLANS: [], VOTD_POOL: [{ ref: 'John 3:16', text: 'For God so loved the world.' }] },
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
    church: { name: 'Grace', initials: 'GR', npub: 'np1', features }, churchNpub: 'np1',
    openSearch() {}, openNotifications() {}, toggleDark() {}, dark: false, toast() {}, netUnread: 0,
    openListen() {}, openShareSheet() {}, openServing() {}, openReader() {}, playSermon() {}, openChurchDevo() {}, go() {}, gotoRef() {},
    planProgress: {}, planLast: {}, plans: [], churchPlans: [], churchDevos: [],
    churchEvents: [], myRsvps: {}, servPending: [], servNext: null, servingSeenTs: null,
    pinnedSermon: { id: 'sm1', sha256: 'abc', title: 'Sunday word', mime: 'audio/mp3', ts: Math.floor(date.getTime() / 1000) },
    care: {}, loc: null,
    ...over,
  };
  // draw twice: the first queues the verse-prompt subscribe effect, the second sees what it set (same as
  // the-serving-page-is-not-only-serving.test.mjs)
  return () => { draw(TodayScreen, { ctx }); return draw(TodayScreen, { ctx }); };
}
test('resources ON: the pinned-sermon card and the "Your church is reading" card both show; VOTD shows too', () => {
  const all = allText(today({})());
  assert.match(all, /Sunday word/, 're-anchor: the pinned-sermon card is missing with resources on');
  assert.match(all, /Your church is reading/, 're-anchor: the verse-prompt card is missing with resources on');
  assert.match(all, /Verse of the day/, 're-anchor: the built-in Verse of the Day is missing');
});
test('resources OFF: the sermon card and the verse-prompt card vanish — but Verse of the Day STAYS', () => {
  const all = allText(today({ resources: false })());
  assert.doesNotMatch(all, /Sunday word/, 'features.resources === false but the pinned-sermon card still shows');
  assert.doesNotMatch(all, /Your church is reading/, 'features.resources === false but the verse-prompt card still shows');
  assert.match(all, /Verse of the day/,
    'the built-in Verse of the Day was hidden with resources off — it is a reader feature that works with no church and must NOT be gated');
});
