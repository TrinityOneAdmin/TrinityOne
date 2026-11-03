// TURNING THE VERSE OF THE DAY OFF HIDES IT FROM THE SCREEN.
// Run: node --test scripts/votd-off-toggle-hides-the-verse.test.mjs
//
// The Settings toggle (identity.jsx VotdToggle) writes 'trinityone.votd-off' = '1' and dispatches
// a 'votd-off-changed' CustomEvent. TodayScreen reads it at init AND listens for that event, and
// gates the ENTIRE VOTD section (both the compact bar and the expanded card) behind `!votdOff`.
//
// The existing votd-min tests (verse-of-the-day-starts-minimised.test.mjs) cover the minimise/expand
// three-way distinction. This file covers the DIFFERENT gate: votdOff hides everything, and flipping
// it via the event un-hides it, regardless of votd-min state.
//
// HOW IT ASSERTS. Same pattern as the minimise test: the real TodayScreen compiled with esbuild and
// rendered through miniReact, assertions on the rendered tree via `find` and `texts`. Nothing matches
// text in app/*.jsx (CLAUDE.md rule 3).
//
// WHAT BREAKS IF THE GUARD IS DELETED. Removing the `!votdOff &&` at line 2782 of screens-today.jsx
// (the only line that uses votdOff in the render) leaves tests 2 and 4 red: stored '1' still shows
// the verse, and the event does not hide it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const VERSE = 'For God so loved the world, that he gave his one and only Son.';
const REF = 'John 3:16';

const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

function todayScreen({ votdOff, votdMin } = {}) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const { ChurchBadge } = loadScreen('app/screens-church.jsx', ['ChurchBadge'],
    { React, window: {}, safeCssColor: (c, d) => d, safeImgUrl: () => '' });
  const date = new Date('2026-09-30T09:00:00Z');
  const store = new Map();
  if (votdOff != null) store.set('trinityone.votd-off', votdOff);
  if (votdMin != null) store.set('trinityone.votd-min', votdMin);
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
  };
  const listeners = new Map();
  const win = {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { const s = listeners.get(type); if (s) s.delete(fn); },
    dispatchEvent(ev) { const s = listeners.get(ev.type); if (s) s.forEach(fn => fn(ev)); },
    innerWidth: 360, localStorage,
    Fellowship: { subscribeCareRequests: () => () => {}, cancelCareRequest() {}, childCareAudience: async () => [] },
    ChurchBadge,
    TrinityData: { NOTIFICATIONS: [], PLANS: [{ id: 'p1', name: 'Plan', days: [{ d: 1, ref: 'John 1' }] }],
      VOTD_POOL: [{ ref: REF, text: VERSE }] },
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
  const { TodayScreen } = loadScreen('app/screens-today.jsx', ['TodayScreen'], globals);
  const ctx = {
    church: { name: 'Grace', initials: 'SB', npub: 'np1' },
    openChurchSwitcher() {}, openSearch() {}, openNotifications() {}, toggleDark() {}, dark: false,
    toast() {}, netUnread: 0, openServing() {}, openListen() {}, openShareSheet() {},
    planProgress: {}, plans: [], bookmarks: [], notes: {}, highlights: {},
  };
  return { draw: () => draw(TodayScreen, { ctx }), store, win };
}

const votdBar = tree => find(tree, n => /^show the verse of the day\b/i.test(String((n.props || {})['aria-label'] || '')));
const verseOnScreen = tree => texts(tree).filter(t => t.includes(VERSE)).length;

test('default (no stored value): the verse section is visible', () => {
  const s = todayScreen();
  const tree = s.draw();
  const bars = votdBar(tree);
  const verse = verseOnScreen(tree);
  assert.ok(bars.length > 0 || verse > 0,
    'with no trinityone.votd-off stored, the VOTD section is completely absent from Today ' +
    '(neither the compact bar nor the expanded card rendered)');
});

test('stored votd-off = 1: the verse is completely hidden', () => {
  const s = todayScreen({ votdOff: '1' });
  const tree = s.draw();
  assert.equal(verseOnScreen(tree), 0,
    'the verse text is on the screen even though trinityone.votd-off is "1"');
  assert.equal(votdBar(tree).length, 0,
    'the compact bar is on the screen even though trinityone.votd-off is "1"');
});

test('stored votd-off = 1 hides the verse regardless of votd-min state', () => {
  for (const min of [null, '0', '1']) {
    const s = todayScreen({ votdOff: '1', votdMin: min });
    const tree = s.draw();
    assert.equal(verseOnScreen(tree), 0,
      `votd-off=1 with votd-min=${JSON.stringify(min)}: the verse text is still on the screen`);
    assert.equal(votdBar(tree).length, 0,
      `votd-off=1 with votd-min=${JSON.stringify(min)}: the compact bar is still on the screen`);
  }
});

test('stored votd-off = 0: the verse section is visible (explicitly not off)', () => {
  const s = todayScreen({ votdOff: '0' });
  const tree = s.draw();
  const bars = votdBar(tree);
  const verse = verseOnScreen(tree);
  assert.ok(bars.length > 0 || verse > 0,
    'trinityone.votd-off is "0" (explicitly not off) but the VOTD section is absent');
});

test('the votd-off-changed event hides the verse dynamically', () => {
  const s = todayScreen();
  let tree = s.draw();
  assert.ok(votdBar(tree).length > 0 || verseOnScreen(tree) > 0,
    'precondition: the VOTD section should be visible before the event');

  s.win.dispatchEvent({ type: 'votd-off-changed', detail: true });
  tree = s.draw();
  assert.equal(verseOnScreen(tree), 0,
    'after votd-off-changed with detail=true, the verse text is still on the screen');
  assert.equal(votdBar(tree).length, 0,
    'after votd-off-changed with detail=true, the compact bar is still on the screen');
});

test('the votd-off-changed event can also restore the verse', () => {
  const s = todayScreen({ votdOff: '1' });
  let tree = s.draw();
  assert.equal(verseOnScreen(tree), 0, 'precondition: off=1 should hide the verse');

  s.win.dispatchEvent({ type: 'votd-off-changed', detail: false });
  tree = s.draw();
  assert.ok(votdBar(tree).length > 0 || verseOnScreen(tree) > 0,
    'after votd-off-changed with detail=false, the VOTD section did not come back');
});
