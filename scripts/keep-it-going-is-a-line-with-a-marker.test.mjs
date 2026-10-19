// THE "KEEP IT GOING" PLAN CARD IS ONE LINE WITH A MARKER THAT SITS FURTHER ALONG IT AS THE PLAN IS READ.
// Run: node --test scripts/keep-it-going-is-a-line-with-a-marker.test.mjs
//
// Owner, 2026-10-14: the reading-plan progress card on Today (under "Keep it going") was a ring. It is now a
// single horizontal line with a marker whose position is days-done / days-in-plan.
//
// POINT OF USE (CLAUDE.md rule 1): the REAL TodayScreen is compiled and rendered through the miniature React,
// once per completion count. The marker's `left` and the fill's `width` are read off the rendered tree.
// Delete the line from the screen, or detach the marker from the completion count, and this goes red.
// RULE 3: nothing here matches text in app/*.jsx.
// NOT TESTABLE HERE: how it looks (no geometry in the miniature React) — the owner's device check covers that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const DAYS = Array.from({ length: 10 }, (_, i) => ({ d: i + 1, ref: 'John ' + (i + 1) }));

function today(doneCount, planLen = 10, extra = {}) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const date = new Date('2026-09-30T09:00:00Z');
  const localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const days = DAYS.slice(0, planLen);
  const win = {
    addEventListener() {}, removeEventListener() {}, innerWidth: 360, localStorage,
    Fellowship: { subscribeCareRequests: () => () => {}, cancelCareRequest() {}, childCareAudience: async () => [] },
    ChurchBadge: Stub('ChurchBadge'),
    TrinityData: { NOTIFICATIONS: [], PLANS: [{ id: 'p1', title: 'John in ten days', len: days.length, days }].concat(extra.plans || []),
      VOTD_POOL: [{ ref: 'John 3:16', text: 'For God so loved the world.' }] },
    Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1,
      activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }) },
  };
  const globals = {
    React, window: win, localStorage,
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    Icon, ChurchBadge: Stub('ChurchBadge'),
    lsGet: (k, d) => d, lsSet: () => {},
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
    toast() {}, netUnread: 0, openServing() {}, openListen() {}, openShareSheet() {}, openPlan() {},
    planProgress: doneCount ? { p1: days.slice(0, doneCount).map(d => d.d) } : {},
    plans: [], bookmarks: [], notes: {}, highlights: {},
    ...(extra.ctx || {}),
  };
  const tree = draw(TodayScreen, { ctx });
  const line = find(tree, n => n.props && 'data-plan-line' in n.props);
  const marker = find(tree, n => n.props && 'data-plan-marker' in n.props);
  const fill = find(tree, n => n.props && 'data-plan-fill' in n.props);
  const title = find(tree, n => n.props && n.props.onClick && texts(n).includes('Reading plan'))[0];
  const pct = s => (s ? parseFloat(String(s)) : NaN);
  return { tree, title: title ? texts(title).join(' | ') : '', line, marker, fill,
    markerLeft: marker[0] && pct(marker[0].props.style.left), fillWidth: fill[0] && pct(fill[0].props.style.width) };
}

test('the plan card shows ONE line with ONE marker, and no ring', () => {
  const s = today(3);
  assert.equal(s.line.length, 1, 'the plan progress line is not on Today');
  assert.equal(s.marker.length, 1, 'the plan progress marker is not on Today');
  assert.equal(find(s.tree, n => n.props && 'strokeDashoffset' in n.props).length, 0, 'the old progress ring is still on the card');
});

test('the marker sits at days-done / days-in-plan, and further along when more is done', () => {
  const some = today(3), most = today(8), all = today(10), one = today(1);
  assert.equal(one.markerLeft, 10);   // (0 days done = no started plan = no card at all since 2026-10-19; see builtin-plans-are-steward-pushed-only)
  assert.equal(some.markerLeft, 30);
  assert.equal(most.markerLeft, 80);
  assert.equal(all.markerLeft, 100);
  assert.ok(one.markerLeft < some.markerLeft && some.markerLeft < most.markerLeft, 'the marker does not advance with progress');
});

test('the filled part of the line ends where the marker is', () => {
  for (const n of [1, 3, 8, 10]) {
    const s = today(n);
    assert.equal(s.fillWidth, s.markerLeft, `fill and marker disagree at ${n} days done`);
  }
});

test('the position is a fraction of THIS plan, not of ten', () => {
  const s = today(2, 4);
  assert.equal(s.markerLeft, 50, '2 of a 4-day plan should be halfway');
});

test('the card still says which day is next', () => {
  const words = texts(today(3).tree).join(' | ');
  assert.match(words, /Day\s*\|?\s*4\s*\|?\s*of\s*\|?\s*10/);
});

const P2 = { id: 'p2', title: 'Psalms for rest', len: 3, days: [{ d: 1, ref: 'Psalm 1' }, { d: 2, ref: 'Psalm 2' }, { d: 3, ref: 'Psalm 3' }] };
const CH = { id: 'c1', title: 'Church advent plan', len: 3, days: P2.days };

test('Keep it going shows the plan read MOST RECENTLY, not the one with most days done', () => {
  const s = today(0, 10, { plans: [P2], ctx: { planProgress: { p1: [1, 2, 3, 4, 5], p2: [1] }, planLast: { p1: 1000, p2: 2000 } } });
  assert.match(s.title, /Psalms for rest/);
  const t = today(0, 10, { plans: [P2], ctx: { planProgress: { p1: [1, 2, 3, 4, 5], p2: [1] }, planLast: { p1: 3000, p2: 2000 } } });
  assert.match(t.title, /John in ten days/);
});

test('a church-uploaded plan read most recently is the one shown', () => {
  const s = today(0, 10, { ctx: { churchPlans: [CH], planProgress: { p1: [1, 2], c1: [1] }, planLast: { p1: 1000, c1: 5000 } } });
  assert.match(s.title, /Church advent plan/);
});

test('with no stamps (older data) it still falls back to most days done; with nothing read the card is hidden (no John fallback)', () => {
  const a = today(0, 10, { plans: [P2], ctx: { planProgress: { p1: [1], p2: [1, 2] } } });
  assert.match(a.title, /Psalms for rest/);
  const b = today(0, 10, { plans: [P2], ctx: { planProgress: {} } });
  assert.equal(b.line.length, 0, 'a member who started nothing still sees a plan card');
  assert.equal(b.title, '');
});
