// THE OVERVIEW MEMBERS TILE DRAWS "Checking…" AS A SMALL STATUS, NOT AS A 28px NUMBER (2026-11-13, item D).
//   Run: node --test scripts/the-checking-tile-is-a-status-not-a-number.test.mjs
//
// StatCard drew every value at 28px Sora 800 with no clipping in its phone/desktop branch. A count fits that
// slot; the one-word status "Checking…" (182px at 28px, measured 2026-11-13 in headless Chromium) does not, and
// at phone width it painted past its card into the next one. StatCard now takes a `pending` prop: the value is
// drawn as a status — 15px (14px narrow), weight 700, muted ink, one line, cut with "…" only if it must be.
// DashOverview passes pending ONLY on the Members tile and only while realCount is null ("Checking…").
//
// A REAL NUMBER IS NEVER CUT WITH "…": a count that says "12…" reads as a smaller number, not a cut-off one.
// So the number branch carries no text-overflow/overflow:hidden; it may wrap (overflow-wrap:anywhere) instead,
// so it still cannot paint out of its card. The browser side of this (geometry at 360px, a 4-digit count at
// 1.5× text) is scripts/the-checking-tile-fits-a-phone.test.mjs.
//
// Point of use (rule 1), no text match against app/*.jsx (rule 3): the REAL DashOverview and the REAL StatCard
// are compiled from app/stew-dashboard.jsx (with app/stew-data.jsx for SK_TINT), DashOverview's own body is
// called, the Members StatCard ELEMENT it emitted is taken from its tree, and that element's props are handed to
// the real StatCard. So the test fails if DashOverview stops passing `pending`, and fails if StatCard ignores it.
// The non-expanding React and the window are the ones the-join-queue-and-waiting-banner-hide-while-logged-out
// uses for the same component.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const compile = (rel) => execFileSync(join(ROOT, 'node_modules/.bin/esbuild'),
  [join(ROOT, rel), '--jsx=transform', '--log-level=error'], { encoding: 'utf8', maxBuffer: 1 << 26 });
const JS = compile('app/stew-data.jsx') + '\n' + compile('app/stew-dashboard.jsx');

const React = {
  useState: (i) => [typeof i === 'function' ? i() : i, () => {}],
  useEffect: () => {}, useRef: (i) => ({ current: i === undefined ? null : i }),
  useMemo: (f) => f(), useCallback: (f) => f,
  createElement: (type, props, ...kids) => ({ type, props: props || {}, kids: kids.flat(Infinity) }),
  Fragment: 'Fragment',
};
const CustomEvent = function (t, d) { this.type = t; this.detail = (d || {}).detail; };
const H = (v) => () => v;
const M = (n) => Array.from({ length: n }, (_, i) => ({ pubkey: 'pk' + i, name: 'Member ' + i }));

function windowFor({ width, ready, members }) {
  return {
    innerWidth: width, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    localStorage: { getItem() { return ''; }, setItem() {} },
    rosterReadyFrom: () => ready,
    useStewardMembers: H(members), useStewardAdmitted: H([]), useStewardBlocked: H([]),
    useStewardJoinPolicy: H(false),
    useStewardGroups: H([]), useStewardRosters: H([]), useStewardRotas: H([]), useStewardServices: H([]),
    useStewardStewards: H([]), useStewardChurch: H({ name: '' }), useStewardGuardians: H([]),
    useStewardGuardianRequests: H([]), useStewardSafeguard: H({ approved: [], expiry: {} }),
    useStewardCheckinPermissions: H({}), useMealsSettings: H({ enabled: false }), useStewardConn: H(0),
    useStewardIdv: H(0), useStewardDirectory: H({}), usePendingStewards: H([]),
    useStewardStats: H({}), useStewardActivity: H([]), useStewardRelays: H([]),
    Steward: { actingChurch: '', churchPub: '', activePub: '', myStewardCaps: () => null },
  };
}

function load(opts) {
  const g = { React, CustomEvent, window: windowFor(opts), Icon: () => null, DismissibleNote: () => null, StewHelpLink: () => null };
  const names = Object.keys(g);
  return new Function(...names, JS + `\nreturn { DashOverview, StatCard };`)(...names.map(k => g[k]));
}

// The four StatCard elements DashOverview emitted, by label.
function tiles(mod) {
  const tree = mod.DashOverview({ onTab: () => {}, onNewPost: () => {}, onSettings: () => {} });
  const cards = find(tree, n => n && n.type === mod.StatCard);
  assert.equal(cards.length, 4, 're-anchor: DashOverview emitted ' + cards.length + ' StatCards, not the four this test reads');
  return Object.fromEntries(cards.map(c => [c.props.label, c]));
}

// The node that directly holds the value text inside a rendered StatCard.
function valueNode(card, value) {
  const hits = find(card, n => n && n.kids && n.kids.some(k => k === value));
  assert.equal(hits.length, 1, 're-anchor: expected one node holding "' + value + '" in the rendered StatCard, found ' + hits.length);
  return hits[0];
}

for (const width of [360, 1200]) {
  test(`${width}px, roster not settled: the Members tile is PENDING and StatCard draws "Checking…" small and muted`, () => {
    const mod = load({ width, ready: false, members: M(5) });
    const t = tiles(mod);
    assert.equal(t.Members.props.value, 'Checking…', 're-anchor: the Members tile is not reading "Checking…", so this case proves nothing');
    assert.equal(t.Members.props.pending, true, 'THE DEFECT: DashOverview did not mark the "Checking…" Members tile as pending');
    for (const other of ['Groups', 'Announcements', 'Your relay']) assert.ok(!t[other].props.pending, other + ' tile was marked pending — only Members passes it');
    const v = valueNode(mod.StatCard(t.Members.props), 'Checking…');
    const s = v.props.style || {};
    assert.ok(typeof s.fontSize === 'number' && s.fontSize <= 16, 'THE DEFECT: "Checking…" is drawn at ' + s.fontSize + 'px — a number-sized slot holding a word');
    assert.equal(s.fontWeight, 700);
    assert.equal(s.color, 'var(--ink-3)', 'the pending status must be muted ink');
    assert.equal(s.whiteSpace, 'nowrap');
    assert.equal(s.overflow, 'hidden');
    assert.equal(s.textOverflow, 'ellipsis', 'the pending status is the ONE value that may be cut with "…"');
  });
}

test('360px, a settled 4-digit count: the number keeps its 28px and is never cut with "…" (it may wrap instead)', () => {
  const mod = load({ width: 360, ready: true, members: M(1234) });
  const t = tiles(mod);
  assert.equal(t.Members.props.value, '1234', 're-anchor: the Members tile did not read the settled count');
  assert.ok(!t.Members.props.pending, 'a real count was marked pending');
  const v = valueNode(mod.StatCard(t.Members.props), '1234');
  const s = v.props.style || {};
  assert.equal(s.fontSize, 28, 'the count lost its number size');
  assert.notEqual(s.textOverflow, 'ellipsis', 'THE DEFECT: a real count can be cut with "…" — "12…" reads as a smaller number');
  assert.notEqual(s.overflow, 'hidden', 'a real count is clipped');
  assert.equal(s.overflowWrap, 'anywhere', 'the count has no wrap backstop, so a long one paints out of its card');
});

test('snug (the Suite window, 760–999px): pending is small there too, and a count is not ellipsed', () => {
  const mod = load({ width: 900, ready: true, members: M(3) });
  const pend = valueNode(mod.StatCard({ label: 'Members', value: 'Checking…', sub: '', ic: 'pray', tint: 'sage', snug: true, pending: true }), 'Checking…');
  assert.ok(pend.props.style.fontSize <= 16, 'snug "Checking…" is drawn at ' + pend.props.style.fontSize + 'px');
  const num = valueNode(mod.StatCard({ label: 'Groups', value: '1234', sub: '', ic: 'chat', tint: 'clay', snug: true }), '1234');
  assert.equal(num.props.style.fontSize, 26);
  assert.notEqual(num.props.style.textOverflow, 'ellipsis', 'THE DEFECT: the snug count can be cut with "…"');
  assert.match(texts(mod.StatCard({ label: 'Groups', value: '7', sub: 's', ic: 'chat', tint: 'clay', snug: true })).join(' '), /Groups/);
});
