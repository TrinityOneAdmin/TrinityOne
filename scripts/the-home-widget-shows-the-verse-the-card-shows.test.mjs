// THE HOME-SCREEN WIDGET SHOWS THE VERSE THE TODAY CARD SHOWS — TODAY, AND AFTER "ANOTHER VERSE".
//   Run: node --test scripts/the-home-widget-shows-the-verse-the-card-shows.test.mjs
//
// reference/PLAN-phone-widget-2026-11-16.html, slice 1. The widget cannot run the app's JavaScript, so the
// Today screen writes it a 60-day table of verses (TrinityWidget.publishVotd) and the native widget looks up
// today's local date in it. This file is the POINT OF USE (CLAUDE.md rule 1): it renders the REAL TodayScreen
// (compiled from app/screens-today.jsx by scripts/render-jsx-screen.mjs, the same esbuild the APK build uses)
// with a recording stand-in for the native plugin, and reads the card's verse OFF THE RENDERED TREE — so
// deleting the write from the screen, or breaking the "Another verse" rewrite, turns this red even though
// the pure table builder below stays correct. Nothing here matches text in app/*.jsx (rule 3).
//
// Runs in Europe/London so the summer-time rows mean the same thing on every machine.
process.env.TZ = 'Europe/London';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileScreen, loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const POOL = [
  { ref: 'John 3:16', text: 'POOL-A For God so loved the world.' },
  { ref: 'Psalms 23:1', text: 'POOL-B The Lord is my shepherd.' },
  { ref: 'Romans 8:28', text: 'POOL-C All things work together for good.' },
];
// A loaded translation that has John 3:16 only — proves the widget gets the member's TRANSLATION, not the pool.
const TRANSLATED = 'BSB-TEXT For God so loved the world that He gave His one and only Son.';
const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const localISO = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

function todayScreen({ widget = '1', plugin = true } = {}) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const { ChurchBadge } = loadScreen('app/screens-church.jsx', ['ChurchBadge'],
    { React, window: {}, safeCssColor: (c, d) => d, safeImgUrl: () => '' });
  const date = new Date('2026-09-30T09:00:00Z');   // 10:00 BST
  const store = new Map([['trinityone.votd-min', '0']]);   // the card EXPANDED, so "Another verse" is on screen
  if (widget != null) store.set('trinityone.widget', widget);
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
  };
  const published = [];
  const win = {
    addEventListener() {}, removeEventListener() {}, innerWidth: 360, localStorage,
    Fellowship: { subscribeCareRequests: () => () => {}, cancelCareRequest() {}, childCareAudience: async () => [] },
    ChurchBadge,
    TrinityData: { NOTIFICATIONS: [], PLANS: [{ id: 'p1', name: 'Plan', days: [{ d: 1, ref: 'John 1' }] }], VOTD_POOL: POOL },
    Bible: {
      parseRef: r => (r === 'John 3:16' ? { book: 43, chap: 3, verse: 16 } : r === 'Psalms 23:1' ? { book: 19, chap: 23, verse: 1 } : null),
      loaded: true, books: () => [43], getVerses: (b, c) => (b === 43 && c === 3 ? [{ v: 16, text: TRANSLATED }] : []),
      maxChapter: () => 1, activeVersion: 'BSB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }),
    },
    Capacitor: plugin ? { Plugins: { TrinityWidget: { publishVotd: (a) => { published.push(a); return Promise.resolve(); } } } } : undefined,
  };
  let pickStore = null;
  const globals = {
    React, window: win, localStorage,
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    Icon, ChurchBadge,
    lsGet: (k, d) => (k === 'trinityone.streak' ? { count: 7, last: localISO(date) } : k === 'trinityone.votd-pick' ? pickStore : d),
    lsSet: (k, v) => { if (k === 'trinityone.votd-pick') pickStore = v; },
    cx: (...a) => a.filter(Boolean).join(' '),
    SectionLabel: Stub('SectionLabel'), Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'),
    useTrinityAudio: () => ({ track: null, playing: false }),
    todayISO: () => localISO(date),
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [date])); } static now() { return date.getTime(); } },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  };
  const { TodayScreen } = loadScreen('app/screens-today.jsx', ['TodayScreen'], globals);
  const ctx = {
    church: { name: 'Grace', initials: 'SB', npub: 'np1' },
    openChurchSwitcher() {}, openSearch() {}, openNotifications() {}, toggleDark() {}, dark: false,
    toast() {}, netUnread: 0, openServing() {}, openListen() {}, openShareSheet() {},
    planProgress: {}, plans: [], bookmarks: [], notes: {}, highlights: {},
  };
  return { draw: () => draw(TodayScreen, { ctx }), published, today: localISO(date) };
}

// The verse the CARD shows, read off the rendered tree: which pool ref's label is on screen, and the text.
function cardVerse(tree) {
  const all = texts(tree).join('\n');
  const refs = POOL.map(p => p.ref).filter(r => all.includes(r));
  const text = [TRANSLATED, ...POOL.map(p => p.text)].find(t => all.includes(t)) || null;
  return { refs, text };
}

test('with the widget ON, Today writes the widget a 60-day table whose TODAY is the verse on the card', () => {
  const s = todayScreen();
  const tree = s.draw();
  const card = cardVerse(tree);
  assert.equal(card.refs.length, 1, `expected exactly one verse reference on the card, saw ${JSON.stringify(card.refs)}`);
  assert.equal(s.published.length, 1,
    `Today did not write the home-screen widget's table (publishVotd called ${s.published.length} times) — ` +
    `the widget would show nothing, or a stale verse, for ever`);
  const days = s.published[0].days;
  assert.equal(Object.keys(days).length, 60, 'the table does not run 60 days ahead');
  assert.ok(days[s.today], `the table has no entry for today (${s.today})`);
  assert.equal(days[s.today].ref, card.refs[0], 'the widget would show a DIFFERENT verse from the Today card');
  assert.equal(days[s.today].text, card.text, 'the widget text is not the text the card shows (translation lost?)');
});

test('"Another verse" rewrites TODAY on the widget to the new card verse, and leaves the other 59 days alone', () => {
  const s = todayScreen();
  let tree = s.draw();
  const before = cardVerse(tree).refs[0];
  const btn = find(tree, n => n.type === 'button' && (n.props || {})['aria-label'] === 'Another verse');
  assert.equal(btn.length, 1, 'no "Another verse" control on the expanded card — nothing to press');
  btn[0].props.onClick({ stopPropagation() {} });
  tree = s.draw();
  const after = cardVerse(tree);
  assert.equal(after.refs.length, 1);
  assert.notEqual(after.refs[0], before, 'pressing "Another verse" did not change the card — the test cannot see the pick path');
  assert.equal(s.published.length, 2,
    `after "Another verse" the widget's table was not rewritten (publishVotd called ${s.published.length} times): ` +
    `the home screen would keep showing ${before} while the app shows ${after.refs[0]}`);
  const [first, second] = s.published.map(p => p.days);
  assert.equal(second[s.today].ref, after.refs[0], 'the rewritten table does not show the picked verse for today');
  for (const day of Object.keys(first)) {
    if (day === s.today) continue;
    assert.deepEqual(second[day], first[day], `the pick changed ${day} too — it must only change today`);
  }
});

test('with the widget OFF (the default), Today writes nothing for it', () => {
  for (const widget of [null, '0']) {
    const s = todayScreen({ widget });
    s.draw();
    assert.equal(s.published.length, 0, `widget setting ${JSON.stringify(widget)}: Today wrote the widget table anyway`);
  }
});

test('on the web / iOS (no native plugin) Today renders and writes nothing', () => {
  const s = todayScreen({ plugin: false });
  const tree = s.draw();
  assert.equal(cardVerse(tree).refs.length, 1, 'the card is missing when the plugin is absent');
});

// ── the pure pieces: the card's own rule, at NOON ─────────────────────────────────────────────────────────────
function pure() {
  const { React } = miniReact();
  return loadScreen('app/screens-today.jsx', ['votdDayPick', 'votdWidgetDays', 'TodayScreen'],
    { React, window: {}, localStorage: { getItem: () => null } });
}
const pool365 = () => { const js = compileScreen('app/data.jsx'); const w = {}; new Function('window', js)(w); return w.TrinityData.VOTD_POOL; };

test('each table day is the card rule evaluated at local NOON — across both summer-time changes', () => {
  const { votdDayPick, votdWidgetDays } = pure();
  const pool = pool365();
  const from = new Date(2026, 2, 1, 0, 30);   // 1 Mar 2026, spans the 29 Mar change
  const days = votdWidgetDays(pool, null, from, 245, null);   // to late October, spanning the 25 Oct change
  for (const [iso, e] of Object.entries(days)) {
    const [y, m, d] = iso.split('-').map(Number);
    assert.equal(e.ref, votdDayPick(pool, new Date(y, m - 1, d, 12)).ref, `${iso}: the table differs from the card at noon`);
  }
  assert.ok(days['2026-03-29'] && days['2026-10-25'], 'the table skipped a summer-time change day');
});

test('KNOWN FINDING (not fixed here): in summer time the CARD rule returns yesterday between 00:00 and 01:00', () => {
  // Documents the card's behaviour as it is today (plan §4). When the owner has it fixed, flip this row on purpose.
  const { votdDayPick } = pure();
  const pool = pool365();
  assert.equal(votdDayPick(pool, new Date(2026, 6, 1, 0, 30)).ref, votdDayPick(pool, new Date(2026, 5, 30, 12)).ref,
    '00:30 BST on 1 July no longer returns 30 June\'s verse — the card bug was fixed; update this row and the plan');
  assert.notEqual(votdDayPick(pool, new Date(2026, 6, 1, 12)).ref, votdDayPick(pool, new Date(2026, 5, 30, 12)).ref);
});

// ── the Settings switch: the only way the widget is ever switched on ─────────────────────────────────────────
function settingsSwitch({ plugin = true } = {}) {
  const { React, draw } = miniReact();
  const store = new Map(), calls = [], events = [];
  const W = { setEnabled: (a) => { calls.push(['setEnabled', a.on]); return Promise.resolve(); }, requestPin: () => { calls.push(['requestPin']); return Promise.resolve({ requested: true }); } };
  const win = { Capacitor: plugin ? { Plugins: { TrinityWidget: W } } : { Plugins: {} },
    TrinityIdentity: { qrSVG: () => '' }, addEventListener() {}, removeEventListener() {}, dispatchEvent: (e) => { events.push(e.type); },
    innerWidth: 390, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  const globals = {
    React, window: win,
    document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
    navigator: { userAgent: '' },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, console, fetch: async () => ({ ok: false }),
    Icon: Stub('Icon'), IconBtn: Stub('IconBtn'), UserAvatar: Stub('UserAvatar'), AvatarPicker: Stub('AvatarPicker'),
    QRScanner: Stub('QRScanner'), BackupCard: Stub('BackupCard'), ChurchBadge: Stub('ChurchBadge'),
    Overlay: Stub('Overlay'), BottomSheet: Stub('BottomSheet'), NotifToggleRow: Stub('NotifToggleRow'),
    safeCssColor: (c) => c, lsGet: (k, d) => d, lsSet: () => {},
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
  };
  const { HomeWidgetToggle } = loadScreen('app/identity.jsx', ['HomeWidgetToggle'], globals);
  return { draw: () => draw(HomeWidgetToggle, {}), store, calls, events };
}
const tick = () => new Promise(r => setTimeout(r, 0));

test('the Settings switch is OFF by default, and turning it on enables the widget and tells Today', async () => {
  const s = settingsSwitch();
  let tree = s.draw();
  let sw = find(tree, n => n.type === 'button' && (n.props || {}).role === 'switch');
  assert.equal(sw.length, 1, 'no home-screen widget switch in Settings on the APK');
  assert.equal(sw[0].props['aria-checked'], false, 'the widget switch is ON for a member who never touched it — it must be opt-in');
  sw[0].props.onClick({ stopPropagation() {} });
  await tick(); await tick();
  assert.equal(s.store.get('trinityone.widget'), '1', 'turning the switch on did not record it, so Today never writes the widget');
  assert.deepEqual(s.calls[0], ['setEnabled', true], 'turning the switch on did not enable the native widget');
  assert.ok(s.events.includes('trinity-widget-changed'), 'Today is not told the widget was switched on');
  tree = s.draw();
  sw = find(tree, n => n.type === 'button' && (n.props || {}).role === 'switch');
  sw[0].props.onClick({ stopPropagation() {} });
  await tick(); await tick();
  assert.equal(s.store.get('trinityone.widget'), '0');
  assert.ok(s.calls.some(c => c[0] === 'setEnabled' && c[1] === false), 'turning the switch off did not disable (and clear) the widget');
});

test('without the native plugin (web, iOS) there is no widget switch at all', () => {
  const s = settingsSwitch({ plugin: false });
  const tree = s.draw();
  assert.equal(find(tree, n => n.type === 'button' && (n.props || {}).role === 'switch').length, 0);
});
