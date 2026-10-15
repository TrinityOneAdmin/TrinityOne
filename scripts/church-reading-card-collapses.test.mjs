// THE "YOUR CHURCH IS READING" CARD FOLDS BEHIND A CHEVRON AND REMEMBERS IT (owner 2026-10-15).
// Run: node --test scripts/church-reading-card-collapses.test.mjs
//
// Point-of-use (CLAUDE.md rule 1/3): the real TodayScreen is loaded from app/screens-today.jsx through the mini
// React (same rig as serving-card-says-whats-new.test.mjs), the church's verse prompt is delivered through the
// real subscribeChurchVersePrompt hook-up, and the tests tap the chevron a member would tap and read what is
// drawn. lsGet/lsSet are an in-memory store so "remembered" is observed as the SECOND mount reading it back.
//
// Users of what changed (rule 2): TodayScreen only (one new useState + one toggle; the card's JSX). The key
// 'trinityone.churchReadingFolded' is new and read nowhere else. The "What's happening" card and its dismiss
// key are untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const NOW = Math.floor(Date.parse('2026-09-30T09:00:00Z') / 1000);
const KEY = 'trinityone.churchReadingFolded';

function screen(store) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const { ChurchBadge } = loadScreen('app/screens-church.jsx', ['ChurchBadge'], { React, window: {}, safeCssColor: (c, d) => d, safeImgUrl: () => '' });
  const date = new Date(NOW * 1000);
  const localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const writes = [];
  const win = {
    addEventListener() {}, removeEventListener() {}, innerWidth: 360, localStorage,
    Fellowship: {
      subscribeCareRequests: () => () => {}, cancelCareRequest() {}, childCareAudience: async () => [],
      subscribeChurchVersePrompt: (npub, cb) => { cb({ ref: 'John 3:16', note: 'Read with us' }); return () => {}; },
    },
    ChurchBadge,
    TrinityData: { NOTIFICATIONS: [], PLANS: [{ id: 'p1', name: 'Plan', days: [{ d: 1, ref: 'John 1' }] }], VOTD_POOL: [{ ref: 'John 3:16', text: 'For God so loved the world.' }] },
    Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1, activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }) },
  };
  const globals = {
    React, window: win, localStorage,
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    setTimeout, clearTimeout, setInterval, clearInterval, console, Icon, ChurchBadge,
    lsGet: (k, d) => (k === 'trinityone.streak' ? { count: 7, last: date.toISOString().slice(0, 10) } : (store.has(k) ? store.get(k) : d)),
    lsSet: (k, v) => { writes.push([k, v]); store.set(k, v); },
    cx: (...a) => a.filter(Boolean).join(' '),
    SectionLabel: Stub('SectionLabel'), Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'),
    useTrinityAudio: () => ({ track: null, playing: false }),
    todayISO: () => date.toISOString().slice(0, 10),
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [date])); } static now() { return date.getTime(); } },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  };
  const { TodayScreen } = loadScreen('app/screens-today.jsx', ['TodayScreen'], globals);
  const ctx = {
    church: { name: 'Grace', initials: 'SB', npub: 'np1' }, churchNpub: 'np1',
    openChurchSwitcher() {}, openSearch() {}, openNotifications() {}, toggleDark() {}, dark: false, toast() {}, netUnread: 0, openListen() {}, openShareSheet() {},
    openServing() {}, gotoRef() {}, planProgress: {}, plans: [], bookmarks: [], notes: {}, highlights: {},
    churchEvents: [], myRsvps: {}, servPending: [], servNext: null, servingSeenTs: null,
  };
  return { writes, draw: () => { draw(TodayScreen, { ctx }); return draw(TodayScreen, { ctx }); } };   // 1st draw flushes the prompt subscription, 2nd shows it
}
const chev = (t, verb) => find(t, n => n.type === 'button' && n.props['aria-label'] === verb + ' Your church is reading');
const full = (t) => texts(t).join(' ').includes('Read with us');   // the note shows only on the open card

test('the open card has a Collapse chevron; tapping it folds the card to one line and saves the choice', () => {
  const s = screen(new Map());
  let t = s.draw();
  assert.ok(full(t), 'control: the church verse card should be open by default');
  assert.equal(chev(t, 'Collapse').length, 1, 'no collapse chevron on the Your church is reading card');
  assert.equal(chev(t, 'Expand').length, 0);
  chev(t, 'Collapse')[0].props.onClick({ stopPropagation() {} });
  t = s.draw();
  assert.equal(full(t), false, 'the card body is still drawn after collapsing');
  assert.ok(texts(t).join(' ').includes('Your church is reading'), 'the folded line must still name the card');
  assert.ok(texts(t).join(' ').includes('John 3:16'));
  assert.equal(chev(t, 'Collapse').length, 0);
  assert.equal(chev(t, 'Expand')[0].props['aria-expanded'], false);
  assert.deepEqual(s.writes.filter(w => w[0] === KEY), [[KEY, true]], 'collapsing did not save through lsSet');
});

test('the folded line expands the card again, and saves that too', () => {
  const s = screen(new Map([[KEY, true]]));
  let t = s.draw();
  assert.equal(full(t), false, 'control: starts folded when the saved choice says so');
  chev(t, 'Expand')[0].props.onClick({ stopPropagation() {} });
  t = s.draw();
  assert.ok(full(t), 'the card did not open again');
  assert.equal(chev(t, 'Collapse').length, 1);
  assert.deepEqual(s.writes.filter(w => w[0] === KEY), [[KEY, false]]);
});

test('the choice survives a restart: a second mount reads the folded state back', () => {
  const store = new Map();
  const a = screen(store);
  chev(a.draw(), 'Collapse')[0].props.onClick({ stopPropagation() {} });
  const t = screen(store).draw();   // a fresh TodayScreen over the same saved store
  assert.equal(full(t), false, 'folded card came back open after a restart');
  assert.equal(chev(t, 'Expand').length, 1);
});
