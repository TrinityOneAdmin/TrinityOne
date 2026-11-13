// "ANOTHER VERSE" ON THE VERSE OF THE DAY (owner 2026-11-13, item B).
//   Run: node --test scripts/verse-of-the-day-another-verse.test.mjs
//
// The expanded verse-of-the-day card has a button beside Minimise that swaps in a random verse from VOTD_POOL,
// different from the one showing. The pick is kept on this phone for the rest of the day under
// `trinityone.votd-pick` = { day, ref }; the next day the normal verse returns. The tap must not open the
// share sheet; tapping the card shares whatever verse is showing, in the active translation where it has one.
//
// POINT OF USE (CLAUDE.md rule 1): the REAL TodayScreen from app/screens-today.jsx is compiled and drawn, and
// the button is found by its aria-label and tapped — a tap that BUBBLES to every ancestor's onClick unless
// stopPropagation is called, as a browser does. Rule 3: the drawn tree is read, never the source.
//
// STORAGE IS REAL (plan audit 2026-11-13, HIGH): lsGet / lsSet / lsCanWrite are lifted from app/app.jsx with
// fnBody and run over a fake localStorage, and "the pick persists" is proved by a FRESH mount (new miniReact,
// new compile) reading it back — never by React state, and never through a stub that ignores writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const APP = readFileSync(ROOT + 'app/app.jsx', 'utf8');
const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

// The real storage helpers from app/app.jsx, over a given localStorage.
function realLs(localStorage) {
  const identLine = APP.split('\n').find(l => l.startsWith('const _IDENT_KEY ='));
  assert.ok(identLine, 're-anchor: const _IDENT_KEY = … not found in app/app.jsx');
  const src = [identLine, fnBody(APP, 'function lsGet('), fnBody(APP, 'function lsCanWrite('), fnBody(APP, 'function lsSet(')].join('\n');
  return new Function('localStorage', 'window', src + '\nreturn { lsGet, lsSet };')(localStorage, {});
}

const POOL = [
  { ref: 'John 3:16', text: 'POOL-JOHN' },
  { ref: 'Psalm 23:1', text: 'POOL-PSALM' },
  { ref: 'Romans 8:28', text: 'POOL-ROMANS' },
];
const BOOK = { John: 43, Psalm: 19, Romans: 45 };
const LIVE = { 43: 'LIVE-JOHN', 19: 'LIVE-PSALM', 45: 'LIVE-ROMANS' };

const localISO = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
// The screen's own day-of-year rule, recomputed here only to name which verse is "the day's".
const dayVerse = d => POOL[Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5) % POOL.length];

// Mount the real TodayScreen. `env` carries the storage map, the clock and the random sequence, so a second
// mount can share the first one's storage (a restart) and move the clock (the next day).
function mount(env) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const store = env.store;
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem(k, v) { store.set(k, String(v)); }, removeItem(k) { store.delete(k); } };
  const { lsGet, lsSet } = realLs(localStorage);
  const date = env.date;
  const win = {
    addEventListener() {}, removeEventListener() {}, innerWidth: 360, localStorage,
    Fellowship: { subscribeCareRequests: () => () => {}, cancelCareRequest() {}, childCareAudience: async () => [] },
    ChurchBadge: Stub('ChurchBadge'),
    TrinityData: { NOTIFICATIONS: [], PLANS: [{ id: 'p1', name: 'Plan', days: [{ d: 1, ref: 'John 1' }] }], VOTD_POOL: env.pool || POOL },
    Bible: {
      parseRef: (r) => { const m = /^(\w+) (\d+):(\d+)$/.exec(String(r)); return m && BOOK[m[1]] ? { book: BOOK[m[1]], chap: +m[2], verse: +m[3] } : null; },
      loaded: true, books: () => env.books || [43, 19, 45],
      getVerses: (b, c) => { const m = Object.entries(BOOK).find(([, n]) => n === b); const p = POOL.find(x => x.ref.startsWith(m[0] + ' ')); const v = +p.ref.split(':')[1]; return [{ v, text: LIVE[b] }]; },
      maxChapter: () => 1, activeVersion: 'KJV', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }),
    },
  };
  const FakeDate = class extends Date { constructor(...a) { super(...(a.length ? a : [date])); } static now() { return date.getTime(); } };
  const FakeMath = Object.create(Math);
  FakeMath.random = () => { assert.ok(env.rand.length, 'Math.random was called more times than the test scripted'); env.draws = (env.draws || 0) + 1; return env.rand.shift(); };
  const { TodayScreen } = loadScreen('app/screens-today.jsx', ['TodayScreen'], {
    React, window: win, localStorage, Math: FakeMath,
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    Icon, ChurchBadge: Stub('ChurchBadge'),
    churchMainColor: () => env.main || null, churchOnColor: () => env.ink || '#fff', churchMainGradient: () => 'G',
    lsGet, lsSet,
    cx: (...a) => a.filter(Boolean).join(' '),
    SectionLabel: Stub('SectionLabel'), Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'),
    useTrinityAudio: () => ({ track: null, playing: false }),
    todayISO: () => localISO(date),
    Date: FakeDate,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  });
  const shared = [];
  const ctx = {
    church: { name: 'Grace', initials: 'GC', npub: 'np1' },
    openChurchSwitcher() {}, openSearch() {}, openNotifications() {}, toggleDark() {}, dark: false,
    toast() {}, netUnread: 0, openServing() {}, openListen() {}, openShareSheet(v) { shared.push(v); },
    planProgress: {}, plans: [], bookmarks: [], notes: {}, highlights: {}, playSermon() {},
  };
  draw(TodayScreen, { ctx });
  let tree = draw(TodayScreen, { ctx });
  const card = () => find(tree, n => n.props && n.props['data-votd-card'] === '1')[0];
  const refShown = () => { const c = card(); assert.ok(c, 're-anchor: the expanded verse-of-the-day card was not drawn'); const t = texts(c).join(' '); const p = POOL.find(x => t.includes(x.ref)); return p && p.ref; };
  const btn = () => find(tree, n => n.type === 'button' && n.props['aria-label'] === 'Another verse')[0];
  // A browser tap: the target's onClick, then every DOM ancestor's, until something stops propagation.
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
    return { stopped };
  };
  return { refShown, btn, tap, card, shared, store, get tree() { return tree; } };
}

// TIME-ZONE INDEPENDENT DAY KEYS (audit 2026-11-13): every instant below is chosen so that its LOCAL calendar
// day differs from its UTC day in whatever zone the process runs — 00:30 local east of Greenwich, 23:30 local
// west of it. A screen that keyed the pick by the UTC day (toISOString) instead of the local day then stores
// and reads the wrong day, and the storage-shape and stored-pick tests fail. Run under several zones, e.g.
//   TZ=Europe/London node --test …   and   TZ=Pacific/Auckland node --test …
// (September is BST in London, +1, and NZDT in Auckland, +13.) In a zone at +00:00 on that date no instant
// separates the two days, and the time-zone half of these tests cannot bite — the guard below says so.
const at = (y, m, d) => {
  const probe = new Date(y, m, d, 12, 0, 0);
  const off = probe.getTimezoneOffset();          // minutes, NEGATIVE east of Greenwich
  return off < 0 ? new Date(y, m, d, 0, 30, 0) : new Date(y, m, d, 23, 30, 0);
};
const utcISO = d => d.toISOString().slice(0, 10);
const DAY1 = at(2026, 8, 30), DAY2 = at(2026, 9, 1);
test('fixture: in this time zone the instants separate the local day from the UTC day', (t) => {
  if (DAY1.getTimezoneOffset() === 0) { t.skip('this zone is +00:00 on 2026-09-30; run under TZ=Europe/London or TZ=Pacific/Auckland'); return; }
  assert.notEqual(localISO(DAY1), utcISO(DAY1));
  assert.notEqual(localISO(DAY2), utcISO(DAY2));
  assert.equal(localISO(DAY1), '2026-09-30');
  assert.equal(localISO(DAY2), '2026-10-01');
});

const freshEnv = (over = {}) => ({ store: new Map([['trinityone.votd-min', '0']]), date: DAY1, rand: [], ...over });

test('tapping "Another verse" changes the verse, does not open the share sheet, and the card then shares the NEW verse in the active translation', () => {
  const env = freshEnv();
  const day = dayVerse(env.date);
  const other = POOL.find(p => p.ref !== day.ref);
  const iDay = POOL.indexOf(day), iOther = POOL.indexOf(other);
  // First draw lands ON the verse showing — it must be skipped — then on `other`.
  env.rand = [(iDay + 0.5) / POOL.length, (iOther + 0.5) / POOL.length];
  const s = mount(env);
  assert.equal(s.refShown(), day.ref, 'before any tap the day’s verse is shown');
  const b = s.btn();
  assert.ok(b, 're-anchor: no "Another verse" button on the expanded card');
  const r = s.tap(b);
  assert.equal(env.draws, 2, 'the draw that hit the verse showing was not followed by a second draw');
  assert.equal(s.refShown(), other.ref, 'the verse did not change to the drawn verse (the hit on the current verse was not skipped)');
  assert.equal(r.stopped, true, 'the tap was not stopped at the button');
  assert.equal(s.shared.length, 0, 'tapping "Another verse" opened the share sheet');
  // The new verse's text sits inside a polite live region, so a screen reader announces it.
  const p = find(s.card(), n => n.type === 'p' && texts(n).join('').includes(LIVE[BOOK[other.ref.split(' ')[0]]]))[0];
  assert.ok(p, 're-anchor: the verse text paragraph was not found on the card');
  const live = find(s.card(), n => n.props && n.props['aria-live'] === 'polite' && find(n, m => m === p).length > 0);
  assert.equal(live.length, 1, 'a new verse is not announced to a screen reader (no polite live region around the verse text)');
  s.tap(s.card());
  assert.equal(s.shared.length, 1, 'tapping the card did not open the share sheet');
  assert.equal(s.shared[0].ref, other.ref, 'the card shared a verse other than the one showing');
  assert.equal(s.shared[0].text, LIVE[BOOK[other.ref.split(' ')[0]]], 'the shared verse is not the active translation’s text');
  assert.equal(s.shared[0].version, 'KJV');
});

test('the pick survives a restart (real lsGet/lsSet over storage) and the next day the day’s verse returns', () => {
  const env = freshEnv();
  const day = dayVerse(env.date);
  const nextDate = DAY2;
  const nextDay = dayVerse(nextDate);
  // The pick must differ from BOTH days' verses, or "the next day's verse returns" could not be told apart
  // from "the pick was kept".
  const other = POOL.find(p => p.ref !== day.ref && p.ref !== nextDay.ref);
  assert.ok(other && nextDay.ref !== day.ref, 'fixture: the pool cannot separate the pick from both days’ verses');
  env.rand = [(POOL.indexOf(other) + 0.5) / POOL.length];
  const s = mount(env);
  s.tap(s.btn());
  assert.equal(s.refShown(), other.ref);
  // A RESTART: a fresh React, a fresh compile, the same storage. Asserted BEFORE the storage shape, so a lost
  // write fails HERE — on what the member sees — and not only on the raw key.
  const again = mount(env);
  assert.equal(again.refShown(), other.ref, 'after a restart the picked verse was lost');
  assert.deepEqual(JSON.parse(env.store.get('trinityone.votd-pick')), { day: localISO(env.date), ref: other.ref }, 'storage does not hold { day, ref }');
  // THE NEXT DAY: the stored pick is ignored and that day's own verse is shown.
  env.date = nextDate;
  const tomorrow = mount(env);
  assert.equal(tomorrow.refShown(), nextDay.ref, 'yesterday’s pick was still shown the next day');
});

test('a corrupt or wrongly shaped stored pick falls back to the day’s verse and never throws', () => {
  const d = DAY1;
  const iso = localISO(d);
  const bad = ['not json{', '"John 3:16"', '42', 'null', 'true', '[]', '{}',
    JSON.stringify({ day: iso, ref: 'Nowhere 9:9' }), JSON.stringify({ day: iso }), JSON.stringify({ ref: 'Psalm 23:1' }),
    JSON.stringify({ day: '2026-09-29', ref: POOL.find(p => p.ref !== dayVerse(d).ref).ref })];
  for (const raw of bad) {
    const env = freshEnv({ date: d });
    env.store.set('trinityone.votd-pick', raw);
    const s = mount(env);
    assert.equal(s.refShown(), dayVerse(d).ref, 'stored ' + raw + ' did not fall back to the day’s verse');
  }
});

test('a picked verse missing from the active translation falls back to the pool text, labelled WEB', () => {
  const env = freshEnv();
  const day = dayVerse(env.date);
  const other = POOL.find(p => p.ref !== day.ref);
  env.books = [BOOK[day.ref.split(' ')[0]]];   // the translation has only the day's book
  env.rand = [(POOL.indexOf(other) + 0.5) / POOL.length];
  const s = mount(env);
  s.tap(s.btn());
  s.tap(s.card());
  assert.equal(s.shared[0].ref, other.ref);
  assert.equal(s.shared[0].text, other.text, 'a verse missing from the translation did not fall back to the pool text');
  assert.equal(s.shared[0].version, 'WEB');
});

test('with a church main colour the button wears the same ink as Minimise, so it stays readable', () => {
  const env = freshEnv({ main: '#F5F0E8', ink: '#2A1B12' });
  const s = mount(env);
  const b = s.btn();
  assert.ok(b, 're-anchor: no "Another verse" button on the expanded card');
  const min = find(s.tree, n => n.type === 'button' && n.props['aria-label'] === 'Minimise')[0];
  assert.ok(min, 're-anchor: no Minimise button');
  assert.equal(b.props.style.color, '#2A1B12', 'the button ink is not the church’s on-main colour');
  assert.equal(b.props.style.color, min.props.style.color);
  const disc = find(b, n => n.type === 'span' && n.props.style && n.props.style.background === 'rgba(255,255,255,.18)')[0];
  assert.ok(disc, 'the button lost Minimise’s translucent disc');
});

test('a pick stored for TODAY (local day) is shown, even when the UTC day is a different date', () => {
  const env = freshEnv();
  const day = dayVerse(env.date);
  const other = POOL.find(p => p.ref !== day.ref);
  env.store.set('trinityone.votd-pick', JSON.stringify({ day: localISO(env.date), ref: other.ref }));
  const s = mount(env);
  assert.equal(s.refShown(), other.ref, 'a pick stored for today\u2019s local day was not shown');
});

test('with a pool of one verse there is no "Another verse" button (there is no different verse)', () => {
  const env = freshEnv({ pool: [POOL[0]] });
  const s = mount(env);
  assert.ok(s.card(), 're-anchor: the expanded verse-of-the-day card was not drawn');
  assert.ok(find(s.tree, n => n.type === 'button' && n.props['aria-label'] === 'Minimise')[0], 're-anchor: no Minimise button');
  assert.equal(s.refShown(), POOL[0].ref);
  assert.equal(s.btn(), undefined, 'the "Another verse" button is drawn with a pool of one');
});
