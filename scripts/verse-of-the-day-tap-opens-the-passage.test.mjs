// TAPPING THE VERSE OF THE DAY OPENS THE PASSAGE IN THE BIBLE (owner 2026-11-17).
//   Run: node --test scripts/verse-of-the-day-tap-opens-the-passage.test.mjs
//
// "Tapping on votd opens share. Really that should open the passage in context in the bible." The expanded card's
// tap now calls ctx.gotoRef(book, chap, verse) for the verse SHOWN; sharing moved onto the card's Share icon, which
// is now a real button. The reference line is a real "Read <ref> in the Bible" button (keyboard / screen reader).
// When the church has turned the Bible tab off (features.read === false) the card tap does nothing, Share still
// shares and the reference is plain text (owner decision 2026-11-17). If the verse cannot be opened in the active
// Bible (unparseable, no verse, no Bible loaded, book missing) the tap opens the reader instead.
// Plan: TrinityOne-internal/reference/PLAN-votd-tap-opens-passage-2026-11-17.html (revision box at its top).
//
// POINT OF USE (CLAUDE.md rule 1): the REAL TodayScreen from app/screens-today.jsx is compiled and drawn; controls
// are found by aria-label and tapped with a BUBBLING tap (target's onClick, then every DOM ancestor's until one
// stops propagation), as a browser does. Rule 3: the drawn tree is read and run, never the source text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

const POOL = [{ ref: 'John 3:16', text: 'POOL-JOHN' }];
const BOOK = { John: 43, Psalm: 19, Romans: 45 };

function mount({ pool = POOL, features, loaded = true, books = [43, 19, 45] } = {}) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const store = new Map([['trinityone.votd-min', '0']]);
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem(k, v) { store.set(k, String(v)); }, removeItem(k) { store.delete(k); } };
  const date = new Date('2026-10-01T09:00:00Z');
  const win = {
    addEventListener() {}, removeEventListener() {}, innerWidth: 360, localStorage,
    Fellowship: { subscribeCareRequests: () => () => {}, cancelCareRequest() {}, childCareAudience: async () => [] },
    ChurchBadge: Stub('ChurchBadge'),
    TrinityData: { NOTIFICATIONS: [], PLANS: [{ id: 'p1', name: 'Plan', days: [{ d: 1, ref: 'John 1' }] }], VOTD_POOL: pool },
    Bible: {
      // "John 3:16" → verse; "John 3" → a chapter with NO verse; anything else → null.
      parseRef: (r) => { const m = /^(\w+) (\d+)(?::(\d+))?$/.exec(String(r)); return m && BOOK[m[1]] ? { book: BOOK[m[1]], chap: +m[2], verse: m[3] == null ? undefined : +m[3] } : null; },
      refKey: (loc, v) => loc.book + '.' + loc.chap + '.' + v,
      loaded, books: () => books,
      getVerses: (b, c) => [{ v: 16, text: 'LIVE-' + b + '.' + c }],
      maxChapter: () => 1, activeVersion: 'KJV', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }),
    },
  };
  const { TodayScreen } = loadScreen('app/screens-today.jsx', ['TodayScreen'], {
    React, window: win, localStorage,
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    Icon, ChurchBadge: Stub('ChurchBadge'),
    churchMainColor: () => null, churchOnColor: () => '#fff', churchMainGradient: () => 'G',
    lsGet: (k, d) => d, lsSet: () => {},
    cx: (...a) => a.filter(Boolean).join(' '),
    SectionLabel: Stub('SectionLabel'), Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'),
    useTrinityAudio: () => ({ track: null, playing: false }),
    todayISO: () => date.toISOString().slice(0, 10),
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [date])); } static now() { return date.getTime(); } },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  });
  const calls = { shared: [], gotoRef: [], openReader: 0, toasts: [], bookmarked: [] };
  const ctx = {
    church: { name: 'Grace', initials: 'GC', npub: 'np1', ...(features ? { features } : {}) },
    openChurchSwitcher() {}, openSearch() {}, openNotifications() {}, toggleDark() {}, dark: false,
    toast(m) { calls.toasts.push(m); }, netUnread: 0, openServing() {}, openListen() {},
    openShareSheet(v) { calls.shared.push(v); },
    gotoRef(b, c, v) { calls.gotoRef.push([b, c, v]); },
    openReader() { calls.openReader++; },
    toggleBookmark(k) { calls.bookmarked.push(k); return true; }, setBookmarkTags() {}, bookmarkItems: [],
    planProgress: {}, plans: [], bookmarks: [], notes: {}, highlights: {}, playSermon() {},
  };
  draw(TodayScreen, { ctx });
  let tree = draw(TodayScreen, { ctx });
  const card = () => { const c = find(tree, n => n.props && n.props['data-votd-card'] === '1')[0]; assert.ok(c, 're-anchor: the expanded verse-of-the-day card was not drawn'); return c; };
  const byLabel = (label) => find(tree, n => n.type === 'button' && (n.props || {})['aria-label'] === label)[0];
  const tap = (target) => {
    const path = [];
    const walk = (n, trail) => {
      if (!n || typeof n !== 'object') return false;
      if (n === target) { path.push(...trail, n); return true; }
      return (n.kids || []).some(k => walk(k, typeof n.type === 'string' ? [...trail, n] : trail));
    };
    assert.ok(walk(tree, []), 'the tapped node is not in the drawn tree');
    let stopped = false;
    const ev = { stopPropagation() { stopped = true; }, preventDefault() {} };
    for (let i = path.length - 1; i >= 0 && !stopped; i--) if (typeof path[i].props.onClick === 'function') path[i].props.onClick(ev);
    tree = draw(TodayScreen, { ctx });
  };
  return { card, byLabel, tap, calls, get tree() { return tree; } };
}

const nav = s => s.calls.gotoRef.length + s.calls.openReader;

test('tapping the card opens the verse shown in the Bible, at that verse, and does not open the share sheet', () => {
  const s = mount();
  assert.ok(texts(s.card()).join(' ').includes('John 3:16'), 'fixture: the card does not show John 3:16');
  s.tap(s.card());
  assert.deepEqual(s.calls.gotoRef, [[43, 3, 16]], 'the card tap did not open John 3:16 at the verse');
  assert.equal(s.calls.openReader, 0);
  assert.equal(s.calls.shared.length, 0, 'the card tap opened the share sheet');
  assert.equal(s.card().props.role, undefined, 'the card must not be role=button: it holds other buttons');
});

test('a tap on the verse TEXT bubbles to the card and opens the passage', () => {
  const s = mount();
  const p = find(s.card(), n => n.type === 'p')[0];
  assert.ok(p, 're-anchor: no verse paragraph on the card');
  s.tap(p);
  assert.deepEqual(s.calls.gotoRef, [[43, 3, 16]]);
  assert.equal(s.calls.shared.length, 0);
});

test('the Share button shares exactly the verse shown and does not navigate', () => {
  const s = mount();
  const b = s.byLabel('Share this verse');
  assert.ok(b, 'no "Share this verse" button on the card');
  assert.ok(find(b, n => typeof n.type === 'function' && n.type.name === 'Icon' && n.props.name === 'share').length === 1, 'the Share button lost its share icon');
  s.tap(b);
  assert.equal(s.calls.shared.length, 1, 'the Share button did not open the share sheet');
  assert.equal(s.calls.shared[0].ref, 'John 3:16');
  assert.equal(s.calls.shared[0].text, 'LIVE-43.3', 'the Share button did not share the active translation’s text shown on the card');
  assert.equal(s.calls.shared[0].version, 'KJV');
  assert.equal(nav(s), 0, 'tapping Share also opened the Bible (the tap bubbled to the card)');
});

test('heart, Minimise and the reference button each do only their own job', () => {
  const s = mount({ pool: [...POOL, { ref: 'Psalm 23:1', text: 'POOL-PSALM' }] });
  const heart = s.byLabel('Add to Favourites');
  assert.ok(heart, 're-anchor: no Favourites heart');
  s.tap(heart);
  assert.equal(nav(s), 0, 'the heart opened the Bible');
  assert.equal(s.calls.shared.length, 0, 'the heart opened the share sheet');
  assert.equal(s.calls.bookmarked.length, 1, 'fixture: the heart did not run');

  const ref = s.byLabel('Read ' + texts(s.card()).join(' ').match(/(John 3:16|Psalm 23:1)/)[1] + ' in the Bible');
  assert.ok(ref, 'the reference line is not a "Read … in the Bible" button');
  s.tap(ref);
  assert.equal(s.calls.gotoRef.length, 1, 'the reference button did not open the passage exactly once (did the tap also bubble to the card?)');
  assert.equal(s.calls.shared.length, 0);

  s.tap(s.byLabel('Minimise'));
  assert.equal(s.calls.gotoRef.length, 1, 'Minimise opened the Bible');
  assert.equal(s.calls.openReader, 0);
  assert.equal(s.calls.shared.length, 0, 'Minimise opened the share sheet');
  assert.equal(find(s.tree, n => n.props && n.props['data-votd-card'] === '1').length, 0, 'fixture: Minimise did not minimise');
});

test('Bible tab turned off: the card tap does nothing, Share still shares, the reference is plain text', () => {
  const s = mount({ features: { read: false } });
  s.tap(s.card());
  assert.equal(nav(s), 0, 'with the Bible tab off the card tap navigated (app.jsx would bounce it straight back to Today)');
  assert.equal(s.calls.shared.length, 0, 'with the Bible tab off the card tap opened the share sheet');
  assert.equal(find(s.tree, n => n.type === 'button' && /in the Bible$/.test((n.props || {})['aria-label'] || '')).length, 0, 'a "Read … in the Bible" button is shown with the Bible tab off');
  assert.ok(texts(s.card()).join(' ').includes('John 3:16'), 'the reference is no longer shown');
  s.tap(s.byLabel('Share this verse'));
  assert.equal(s.calls.shared.length, 1, 'with the Bible tab off the Share button did not share');
  assert.equal(s.calls.shared[0].ref, 'John 3:16');
  assert.equal(nav(s), 0);
});

test('the Bible tab explicitly ON (features.read true) behaves as unset', () => {
  const s = mount({ features: { read: true } });
  s.tap(s.card());
  assert.deepEqual(s.calls.gotoRef, [[43, 3, 16]]);
});

test('a verse the active Bible cannot open falls back to the reader, never the share sheet and never a dead tap', () => {
  const cases = [
    ['unparseable reference', { pool: [{ ref: 'Nowhere 9:9', text: 'X' }] }],
    ['a reference with no verse', { pool: [{ ref: 'John 3', text: 'X' }] }],
    ['no Bible loaded', { loaded: false }],
    ['the active Bible lacks the book', { books: [19] }],
  ];
  for (const [why, opts] of cases) {
    const s = mount(opts);
    s.tap(s.card());
    assert.equal(s.calls.openReader, 1, why + ': the card tap did not open the reader');
    assert.equal(s.calls.gotoRef.length, 0, why + ': gotoRef was called with a verse the Bible cannot show');
    assert.equal(s.calls.shared.length, 0, why + ': the share sheet opened');
  }
});
