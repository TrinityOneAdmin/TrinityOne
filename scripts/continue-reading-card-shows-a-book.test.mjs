// THE "CONTINUE READING" CARD ON TODAY SHOWS A BOOK, NOT A PLAY BUTTON.
// Run: node --test scripts/continue-reading-card-shows-a-book.test.mjs
//
// Owner 2026-10-14: a play triangle implies audio; this card opens the reader. The REAL TodayScreen is rendered
// through the miniature React (CLAUDE.md rules 1 and 3) with the REAL Icon component, and the icon name is read
// off the rendered card, so deleting or reverting the icon on the screen turns this red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';


const NOW = Math.floor(Date.parse('2026-09-30T09:00:00Z') / 1000);

// ── the real screen, driven by one ctx ─────────────────────────────────────────────────────────────────────
// Everything TodayScreen takes from OUTSIDE its own file. A name it needs that is not here is a
// ReferenceError at the point of use — deliberately, because a silently-stubbed global is how a test ends up
// asserting about something that is not the code. `Icon` is the REAL one; the stubs are furniture elsewhere
// on Today, none of which is the card under test.
const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

function todayScreen(over) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const { ChurchBadge } = loadScreen('app/screens-church.jsx', ['ChurchBadge'],
    { React, window: {}, safeCssColor: (c, d) => d, safeImgUrl: () => '' });
  const date = new Date(NOW * 1000);
  const store = new Map();
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
  };
  const win = {
    addEventListener() {}, removeEventListener() {}, innerWidth: 360, localStorage,
    Fellowship: { subscribeCareRequests: () => () => {}, cancelCareRequest() {}, childCareAudience: async () => [] },
    ChurchBadge,
    TrinityData: { NOTIFICATIONS: [], PLANS: [{ id: 'p1', name: 'Plan', days: [{ d: 1, ref: 'John 1' }] }],
      VOTD_POOL: [{ ref: 'John 3:16', text: 'For God so loved the world.' }] },
    Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1,
      activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }) },
  };
  const globals = {
    React, window: win, localStorage,
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    Icon, ChurchBadge,
    lsGet: (k, d) => (k === 'trinityone.streak' ? { count: 7, last: date.toISOString().slice(0, 10) } : d),
    lsSet: () => {},
    cx: (...a) => a.filter(Boolean).join(' '),
    SectionLabel: Stub('SectionLabel'), Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'),
    useTrinityAudio: () => ({ track: null, playing: false }),
    todayISO: () => date.toISOString().slice(0, 10),
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [date])); } static now() { return date.getTime(); } },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  };
  // loadScreen asserts each of these is a function in the compiled file, so a rename or a deletion of either
  // rule is a hard failure here rather than a quietly-passing test.
  const { TodayScreen, servingNewCount, servingSeenStamp } =
    loadScreen('app/screens-today.jsx', ['TodayScreen', 'servingNewCount', 'servingSeenStamp'], globals);
  const opened = [];
  const ctx = {
    church: { name: 'Grace', initials: 'SB', npub: 'np1' },
    openChurchSwitcher() {}, openSearch() {}, openNotifications() {}, toggleDark() {}, dark: false,
    toast() {}, netUnread: 0, openListen() {}, openShareSheet() {},
    openServing(...a) { opened.push(a); },
    planProgress: {}, plans: [], bookmarks: [], notes: {}, highlights: {},
    churchEvents: [], myRsvps: {}, servPending: [], servNext: null, servingSeenTs: null,
    ...over,
  };
  return { ctx, opened, servingNewCount, servingSeenStamp, draw: () => draw(TodayScreen, { ctx }) };
}

// ── reading the badge off the RENDERED tree ────────────────────────────────────────────────────────────────
// Found by the accessible name the screen puts on it — the same string a screen reader announces. Delete the
// badge from the card and this goes to zero.

const card = tree => find(tree, n => typeof (n.props || {}).onClick === 'function'
  && texts(n).some(t => t.includes('Where you left off')))[0];
const iconNames = n => find(n, x => typeof x.type === 'function' && x.type.name === 'Icon').map(x => x.props.name);

test('Continue reading card is on Today and shows the book icon, not play', () => {
  const tree = todayScreen().draw();
  const c = card(tree);
  assert.ok(c, 'the Continue reading card is no longer rendered on Today');
  const icons = iconNames(c);
  assert.ok(icons.includes('book'), 'the Continue reading card has no book icon; it has: ' + icons.join(','));
  assert.ok(!icons.includes('play'), 'the Continue reading card still shows a play icon, which implies audio');
});
