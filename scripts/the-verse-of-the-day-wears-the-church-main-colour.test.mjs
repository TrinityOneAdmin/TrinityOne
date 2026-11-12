// THE VERSE OF THE DAY AND THE FEATURED SERMON WEAR THE CHURCH'S MAIN COLOUR (owner 2026-11-12, item 3).
//   Run: node --test scripts/the-verse-of-the-day-wears-the-church-main-colour.test.mjs
//
// With `mainColor` set on the church profile, the verse-of-the-day card (expanded AND its minimised bar) and
// the featured-sermon card are filled with a MAIN gradient and readable ink. With it unset, each keeps its
// exact clay gradient — the strings below are the ones the screen drew before this change.
//
// POINT OF USE (CLAUDE.md rule 1): the REAL TodayScreen from app/screens-today.jsx is compiled and drawn
// (harness as scripts/verse-of-the-day-starts-minimised.test.mjs), with churchMainColor / churchOnColor /
// churchMainGradient loaded from the REAL app/ui.jsx. Rule 3: the drawn tree is read, never the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find } from './render-jsx-screen.mjs';

const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const VERSE = 'For God so loved the world, that he gave his one and only Son.';

function today(church, stored) {
  const { React, draw } = miniReact();
  const h = loadScreen('app/ui.jsx', ['churchMainColor', 'churchOnColor', 'churchMainGradient'], {
    React, window: {}, document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null, createElement: () => ({}) },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' }, localStorage: { getItem: () => null, setItem() {} },
    setTimeout, clearTimeout, console, Icon: () => null,
  });
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const { ChurchBadge } = loadScreen('app/screens-church.jsx', ['ChurchBadge'],
    { React, window: {}, safeCssColor: (c, d) => d, safeImgUrl: () => '', churchMainColor: h.churchMainColor, churchOnColor: h.churchOnColor });
  const date = new Date('2026-09-30T09:00:00Z');
  const store = new Map([['trinityone.votd-min', stored]]);
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem(k, v) { store.set(k, String(v)); }, removeItem(k) { store.delete(k); } };
  const win = {
    addEventListener() {}, removeEventListener() {}, innerWidth: 360, localStorage,
    Fellowship: { subscribeCareRequests: () => () => {}, cancelCareRequest() {}, childCareAudience: async () => [] },
    ChurchBadge,
    TrinityData: { NOTIFICATIONS: [], PLANS: [{ id: 'p1', name: 'Plan', days: [{ d: 1, ref: 'John 1' }] }],
      VOTD_POOL: [{ ref: 'John 3:16', text: VERSE }] },
    Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1,
      activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }) },
  };
  const { TodayScreen } = loadScreen('app/screens-today.jsx', ['TodayScreen'], {
    React, window: win, localStorage,
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    Icon, ChurchBadge,
    churchMainColor: h.churchMainColor, churchOnColor: h.churchOnColor, churchMainGradient: h.churchMainGradient,
    lsGet: (k, d) => d, lsSet: () => {},
    cx: (...a) => a.filter(Boolean).join(' '),
    SectionLabel: Stub('SectionLabel'), Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'),
    useTrinityAudio: () => ({ track: null, playing: false }),
    todayISO: () => date.toISOString().slice(0, 10),
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [date])); } static now() { return date.getTime(); } },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  });
  const ctx = {
    church: { name: 'Grace', initials: 'GC', npub: 'np1', ...church },
    openChurchSwitcher() {}, openSearch() {}, openNotifications() {}, toggleDark() {}, dark: false,
    toast() {}, netUnread: 0, openServing() {}, openListen() {}, openShareSheet() {},
    planProgress: {}, plans: [], bookmarks: [], notes: {}, highlights: {},
    pinnedSermon: { id: 's1', sha256: 'ab', title: 'Sunday sermon', mime: 'audio/mpeg', ts: date.getTime() / 1000 },
    playSermon() {},
  };
  draw(TodayScreen, { ctx });
  const tree = draw(TodayScreen, { ctx });
  const card = find(tree, n => n.props && n.props['data-votd-card'] === '1')[0];
  const bar = find(tree, n => /^show the verse of the day\b/i.test(String((n.props || {})['aria-label'] || '')))[0];
  const sermon = find(tree, n => n.type === 'div' && n.props && typeof n.props.onClick === 'function'
    && find(n, k => k.kids && k.kids.includes('Sunday sermon')).length > 0 && n.props.style && n.props.style.borderRadius === 20)[0];
  return { card, bar, sermon };
}

const MAIN = '#1F4E79';
const MAIN_GRAD = (deg) => `linear-gradient(${deg}deg, ${MAIN} 0%, color-mix(in oklab, ${MAIN} 62%, #16120c) 100%)`;

test('expanded verse of the day: MAIN gradient with readable ink when set', () => {
  const r = today({ mainColor: MAIN }, '0');
  assert.ok(r.card, 're-anchor: the expanded verse-of-the-day card was not drawn');
  assert.equal(r.card.props.style.background, MAIN_GRAD(155), 'the verse-of-the-day card does not wear the church MAIN colour');
  assert.equal(r.card.props.style.color, '#fff');
  const pale = today({ mainColor: '#F5F0E8' }, '0');
  assert.equal(pale.card.props.style.color, '#2A1B12', 'a pale MAIN card kept white text');
});

test('expanded verse of the day: exactly today’s clay gradient when MAIN is unset (accent only)', () => {
  const r = today({ accent: '#3B6FB0' }, '0');
  assert.equal(r.card.props.style.background, 'linear-gradient(155deg, var(--clay) 0%, var(--clay-deep) 100%)');
  assert.equal(r.card.props.style.color, '#fff');
});

test('the minimised verse bar: MAIN when set, today’s clay when not', () => {
  const m = today({ mainColor: MAIN }, '1');
  assert.ok(m.bar, 're-anchor: the minimised verse bar was not drawn');
  assert.equal(m.bar.props.style.background, MAIN_GRAD(150));
  const t = today({}, '1');
  assert.equal(t.bar.props.style.background, 'linear-gradient(150deg, var(--clay), var(--clay-deep))');
  assert.equal(t.bar.props.style.color, 'var(--on-clay)');
});

test('the featured sermon card: MAIN when set, today’s clay when not', () => {
  const m = today({ mainColor: MAIN }, '1');
  assert.ok(m.sermon, 're-anchor: the featured-sermon card was not drawn');
  assert.equal(m.sermon.props.style.background, MAIN_GRAD(150), 'the featured-sermon card does not wear MAIN');
  const t = today({ accent: '#3B6FB0' }, '1');
  assert.equal(t.sermon.props.style.background, 'linear-gradient(150deg, var(--clay), var(--clay-deep))');
  assert.equal(t.sermon.props.style.color, 'var(--on-clay)');
});

test('a mainColor that is not a strict #RRGGBB never reaches the cards', () => {
  const r = today({ mainColor: 'url(https://x.example/b)' }, '0');
  assert.equal(r.card.props.style.background, 'linear-gradient(155deg, var(--clay) 0%, var(--clay-deep) 100%)');
});
