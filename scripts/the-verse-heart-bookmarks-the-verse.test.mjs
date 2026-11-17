// THE HEART ON THE VERSE OF THE DAY FILES THE VERSE UNDER "FAVOURITES".
// Run: node --test scripts/the-verse-heart-bookmarks-the-verse.test.mjs
//
// The heart on the expanded card was a plain div; a tap bubbled to the card and opened the share sheet. It must
// tag the verse "Favourites" under the CANONICAL key ("43.3.16", what the reader and Library match on), without
// opening the share sheet. Drives the real TodayScreen (scripts/render-jsx-screen.mjs) against the REAL
// MyData store (vendor/mydata.js), so the assertions read actual bookmark state, not recorded calls.
// ctx.toggleBookmark / setBookmarkTags / bookmarkItems below are line-for-line copies of app/app.jsx ~2347-2353
// (app.jsx is not liftable); they are thin wrappers over MD.put/remove/list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadScreen, miniReact, find } from './render-jsx-screen.mjs';

function realMyData() {
  const m = new Map();
  const localStorage = { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
  const window = { localStorage, addEventListener() {}, removeEventListener() {} };
  window.window = window;
  const c = vm.createContext({ window, localStorage, console, setTimeout, clearTimeout, setInterval, clearInterval,
    TextEncoder, TextDecoder, crypto: globalThis.crypto, navigator: {}, document: { addEventListener() {} }, location: {} });
  vm.runInContext(readFileSync(new URL('../vendor/mydata.js', import.meta.url), 'utf8'), c);
  return window.MyData;
}

const VERSE = 'For God so loved the world, that he gave his one and only Son.';
const REF = 'John 3:16';
const KEY = 'trinityone.votd-min';

const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

function todayScreen(MD, calls) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const { ChurchBadge } = loadScreen('app/screens-church.jsx', ['ChurchBadge'],
    { React, window: {}, safeCssColor: (c, d) => d, safeImgUrl: () => '' });
  const date = new Date('2026-09-30T09:00:00Z');
  // A REAL little store, not a returns-null stub: the whole point of the middle row above is that a member
  // who taps the bar open is RECORDED as having chosen expanded, and a stub that swallowed writes could not
  // tell a screen that persists the choice from one that does not.
  const store = new Map();
  store.set(KEY, '0');   // expanded card
  const writes = [];
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem(k, v) { store.set(k, String(v)); writes.push([k, String(v)]); },
    removeItem(k) { store.delete(k); writes.push([k, null]); },
  };
  const win = {
    addEventListener() {}, removeEventListener() {}, innerWidth: 360, localStorage,
    Fellowship: { subscribeCareRequests: () => () => {}, cancelCareRequest() {}, childCareAudience: async () => [] },
    ChurchBadge,
    TrinityData: { NOTIFICATIONS: [], PLANS: [{ id: 'p1', name: 'Plan', days: [{ d: 1, ref: 'John 1' }] }],
      VOTD_POOL: [{ ref: REF, text: VERSE }] },
    Bible: { parseRef: r => (r === 'John 3:16' ? { book: 43, chap: 3, verse: 16 } : null), refKey: (l, v) => l.book + '.' + l.chap + '.' + v, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1,
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
    gotoRef: (...a) => calls.nav.push(['gotoRef', ...a]), openReader: () => calls.nav.push(['openReader']),
    toast: m => calls.toasts.push(m), toggleBookmark: k => { calls.toggled.push(k); if (MD.has('bookmarks', k)) { MD.remove('bookmarks', k); return false; } else { MD.put('bookmarks', { id: k, ref: k }); return true; } },
    setBookmarkTags: (ref, tags) => { const existing = MD.list('bookmarks').find(b => b.ref === ref || b.id === ref); if (existing) MD.put('bookmarks', { ...existing, tags: tags.filter(Boolean) }); },
    get bookmarkItems() { return MD.list('bookmarks'); },
    get allBookmarkTags() { return [...new Set(MD.list('bookmarks').flatMap(b => b.tags || []))].sort(); }, netUnread: 0, openServing() {}, openListen() {}, openShareSheet: v => calls.shared.push(v),
    planProgress: {}, plans: [], bookmarks: [], notes: {}, highlights: {},
  };

  return { draw: () => draw(TodayScreen, { ctx }) };
}

const heart = tree => find(tree, n => n.type === 'button' && /favourites/i.test(String((n.props || {})['aria-label'] || '')));
const K = '43.3.16';
function member(seed) {
  const MD = realMyData();
  if (seed) MD.put('bookmarks', { id: K, ref: K, ...seed });
  const calls = { toggled: [], shared: [], toasts: [], nav: [] };
  const screen = todayScreen(MD, calls);
  const view = () => screen.draw();
  const tapHeart = () => {
    const h = heart(view());
    assert.equal(h.length, 1, 'no Favourites heart on the expanded verse card');
    let stopped = false;
    const ev = { stopPropagation() { stopped = true; } };
    h[0].props.onClick(ev);
    // A browser would carry an unstopped tap on to the card, which opens the Bible: do the same here.
    if (!stopped) { const c = find(view(), n => n.props && n.props['data-votd-card'] === '1')[0]; if (c) c.props.onClick(ev); }
    assert.equal(stopped, true, 'propagation not stopped, so the tap would reach the card and open the Bible');
    assert.deepEqual(calls.nav, [], 'the heart navigated');
  };
  const state = () => MD.get('bookmarks', K);
  const label = () => heart(view())[0].props['aria-label'];
  return { MD, calls, tapHeart, state, label };
}

test('not bookmarked: tap bookmarks it under the canonical key, tagged Favourites, share sheet not opened', () => {
  const m = member(null);
  assert.equal(m.label(), 'Add to Favourites');
  m.tapHeart();
  assert.deepEqual(JSON.parse(JSON.stringify(m.state().tags)), ['Favourites']);
  assert.equal(m.state().id, K, 'saved under a key the reader would not match');
  assert.deepEqual(m.calls.toasts, ['Added to Favourites']);
  assert.equal(m.calls.shared.length, 0, 'the share sheet opened');
  assert.equal(m.label(), 'Remove from Favourites');
  assert.ok(m.MD.list('bookmarks').flatMap(b => b.tags || []).includes('Favourites'), 'Favourites would not appear in the tag filter');
});

test('bookmarked without Favourites: tap adds the tag, keeps the other tags, keeps the bookmark', () => {
  const m = member({ tags: ['Prayer'] });
  assert.equal(m.label(), 'Add to Favourites');
  m.tapHeart();
  assert.deepEqual(JSON.parse(JSON.stringify(m.state().tags)), ['Prayer', 'Favourites']);
  assert.equal(m.calls.toggled.length, 0, 'the bookmark was toggled (removed) instead of tagged');
  assert.deepEqual(m.calls.toasts, ['Added to Favourites']);
});

test('filled with other tags: tap removes only Favourites and keeps the bookmark', () => {
  const m = member({ tags: ['Prayer', 'Favourites'] });
  assert.equal(m.label(), 'Remove from Favourites');
  m.tapHeart();
  assert.deepEqual(JSON.parse(JSON.stringify(m.state().tags)), ['Prayer']);
  assert.deepEqual(m.calls.toasts, ['Removed from Favourites']);
  assert.equal(m.calls.shared.length, 0);
});

test('filled with no other tags: tap removes the bookmark altogether', () => {
  const m = member({ tags: ['Favourites'] });
  m.tapHeart();
  assert.equal(m.state(), null);
  assert.deepEqual(m.calls.toasts, ['Removed from Favourites']);
  assert.equal(m.label(), 'Add to Favourites');
});

const fillOf = tree => { const b = heart(tree)[0]; const ic = find(b, n => typeof n.type === 'function' && n.type.name === 'Icon')[0]; assert.ok(ic, 'no Icon inside the heart'); return ic.props.fill; };

test('the heart icon is FILLED exactly when the verse is in Favourites', () => {
  const none = member(null), plain = member({ tags: ['Prayer'] }), fav = member({ tags: ['Favourites'] });
  assert.equal(!!fillOf(todayScreen(none.MD, { toggled: [], shared: [], toasts: [] }).draw()), false);
  assert.equal(!!fillOf(todayScreen(plain.MD, { toggled: [], shared: [], toasts: [] }).draw()), false);
  assert.equal(fillOf(todayScreen(fav.MD, { toggled: [], shared: [], toasts: [] }).draw()), true);
});

test('a legacy "John 3:16" bookmark in Favourites is recognised and un-favouriting edits THAT item, no duplicate', () => {
  const MD = realMyData();
  MD.put('bookmarks', { id: 'John 3:16', ref: 'John 3:16', tags: ['Favourites', 'Prayer'] });
  const calls = { toggled: [], shared: [], toasts: [] };
  const s = todayScreen(MD, calls);
  const h = heart(s.draw());
  assert.equal(h[0].props['aria-label'], 'Remove from Favourites');
  assert.equal(fillOf(s.draw()), true);
  h[0].props.onClick({ stopPropagation() {} });
  assert.equal(MD.list('bookmarks').length, 1, 'a second bookmark was created');
  assert.deepEqual(JSON.parse(JSON.stringify(MD.get('bookmarks', 'John 3:16').tags)), ['Prayer']);
});

test('a legacy bookmark WITHOUT Favourites gets the tag added in place, not a duplicate', () => {
  const MD = realMyData();
  MD.put('bookmarks', { id: 'John 3:16', ref: 'John 3:16' });
  const s = todayScreen(MD, { toggled: [], shared: [], toasts: [] });
  heart(s.draw())[0].props.onClick({ stopPropagation() {} });
  assert.equal(MD.list('bookmarks').length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(MD.get('bookmarks', 'John 3:16').tags)), ['Favourites']);
});
