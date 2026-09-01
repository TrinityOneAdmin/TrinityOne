// THE SERVING & EVENTS CARD SAYS WHEN THERE IS SOMETHING NEW — AND NEVER SAYS IT ABOUT SOMETHING THE MEMBER
// CANNOT THEN OPEN.
// Run: node --test scripts/serving-card-says-whats-new.test.mjs
//
// Owner, 2026-09-01: the Today card that reads "Serving & events · See what's on · RSVP · your rota" gains a
// small clay dot with a count when the church has posted something, or changed something, since this member
// last opened the card. Quiet — no sound, no push, no red. It caps at "9+". It clears when they open the card,
// not on launch and not on a timer. It is per church. And a member who joined this morning must not be told
// they are fifty things behind.
//
// THE RULE THAT DECIDES WHETHER THIS IS RIGHT OR WRONG: never badge something the member cannot then open.
// Rota and run-sheet visibility is deliberately gated and the relay enforces it, so a count built from what
// the CHURCH published would put a dot on a document this member is not shown — a dot that opens onto nothing,
// and a leak that something exists at all. The count is therefore built from `ctx.churchEvents`, the exact
// list the Serving overlay's Events tab renders (app/screens-serving.jsx: `const events = ctx.churchEvents ||
// []`), which is what the relay served THIS member. Two tests below hold that line: one feeds the screen a
// church corpus of rotas, rosters, run sheets and services all published seconds ago, and one feeds it an
// event sealed under a key this phone has not got.
//
// HOW IT ASSERTS, and why not more cheaply. CLAUDE.md rule 3: app/screens-today.jsx ships UNBUNDLED, so
// `false && ` in front of a condition leaves every word of it in place and a text-matching assertion still
// passes. Nothing here matches text in app/*.jsx. The REAL TodayScreen is compiled with the same esbuild the
// build uses and rendered through the miniature React in scripts/render-jsx-screen.mjs; every assertion reads
// the tree that came back. The two rules the card runs on — servingNewCount (what counts) and servingSeenStamp
// (what opening stamps) — are lifted out of the same compiled file and run for real, so the "opening clears
// it" round trip goes through the shipped rule rather than through a fixture that agrees with it.
//
// WHAT THIS FILE DOES NOT COVER. The localStorage plumbing around the mark — the key
// `trinityone.servingSeen.<npub>`, its first-run baseline and the write from ctx.openServing() — lives inside
// App() in app/app.jsx, which is not renderable in this harness. What IS covered is that the card calls
// ctx.openServing() when tapped and calls nothing on a draw, and that the stamp the app writes (computed here
// by the shipped servingSeenStamp) really does clear the count.
//
// MEASURED RED/GREEN, 2026-09-01, this file against app/screens-today.jsx. Each anchor was sliced out of its
// enclosing function and verified to occur EXACTLY ONCE inside it before the edit, per CLAUDE.md "sabotage
// must be scoped" — the three card titles are near-identical siblings, so a plain string-replace would hit the
// wrong one. Note what the first two rows mean: the badge is DELETED from the screen while every rule behind it
// still passes its own arithmetic. That is the shape CLAUDE.md rule 1 exists for.
//
//   · the finished screen                                            16 pass /  0 fail
//   · <ServingNewDot> deleted from the "Serving & events" card         5 pass / 11 fail
//   · <ServingNewDot> deleted from the "You're serving" card          15 pass /  1 fail
//   · servingNewCount also counts ctx.churchServices + ctx.churchRotas 15 pass /  1 fail  (THE LEAK: the dot
//                                                                                         lights over a rota
//                                                                                         set to stewards-only)
//   · servingNewCount drops its `e._locked` guard                     15 pass /  1 fail
//   · servingNewCount drops its `if (!seen) return 0` first-run guard 15 pass /  1 fail  (a new member of an
//                                                                                         established church is
//                                                                                         told "9+")
//   · servingNewCount counts occurrences instead of documents         15 pass /  1 fail
//   · the 9+ cap raised to 99                                         15 pass /  1 fail
//   · servingSeenStamp returns nowSec only (drops the ts maximum)     15 pass /  1 fail
//   · servingSeenStamp returns the ts maximum only (drops nowSec)     14 pass /  2 fail
//   · servingSeenStamp stops skipping `_locked`                       15 pass /  1 fail
//   · the badge restored to the first draft's wide filled pill        15 pass /  1 fail  (it wraps at 320px)
//   · the card's onClick no longer calls ctx.openServing              15 pass /  1 fail
//
// The runner that produced those numbers slices the enclosing function, asserts the anchor occurs exactly once
// inside the slice, replaces it there, runs this file, and restores the source byte-for-byte.
//
// The three browser cases skip themselves (rather than failing) when chromium is unavailable, so CI without a
// browser stays green — same contract as scripts/app-boots.test.mjs and todays-header-fits-the-phone.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { WebSocket } from 'ws';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';
import { requireFreePort } from './test-ports.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const CDP = 9356;   // 9350-9352 = app-boots / restore-storm / restore-routes, 9354 = todays-header-fits-the-phone,
                    // 9355 = verse-of-the-day-starts-minimised. Unique across scripts/*.test.mjs.
const sleep = ms => new Promise(r => setTimeout(r, ms));

const NOW = Math.floor(Date.parse('2026-09-30T09:00:00Z') / 1000);
const DAY = 86400;

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
const dots = tree => find(tree, n => /since you last looked/i.test(String((n.props || {})['aria-label'] || '')));
// The VISIBLE text only: texts() also collects string props, and the aria-label contains the number, so
// reading that would keep passing over a badge that renders no number at all.
const visible = (n, out = []) => {
  if (n == null || n === false) return out;
  if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return out; }
  if (Array.isArray(n)) { n.forEach(c => visible(c, out)); return out; }
  (n.kids || []).forEach(c => visible(c, out));
  return out;
};
const badge = tree => { const d = dots(tree); return d.length ? visible(d[0]).join('').trim() : null; };
// The card itself: the tappable thing whose title is "Serving & events".
const servingCard = tree => find(tree, n => typeof (n.props || {}).onClick === 'function'
  && texts(n).some(t => t.includes('Serving & events')));

const ev = (id, ts, extra) => ({ id, ts, date: '2026-10-04', time: '10:00', title: 'Event ' + id, ...extra });
const many = (n, ts) => Array.from({ length: n }, (_, i) => ev('e' + i, ts));

// ── nothing new ────────────────────────────────────────────────────────────────────────────────────────────
test('a member with nothing new gets no dot at all — not an empty one', () => {
  const s = todayScreen({ servingSeenTs: NOW - DAY, churchEvents: [ev('a', NOW - 10 * DAY), ev('b', NOW - 2 * DAY)] });
  const tree = s.draw();
  assert.equal(servingCard(tree).length >= 1, true, 'the Serving & events card is not on the screen at all — nothing below can be true');
  assert.equal(dots(tree).length, 0,
    `the card is badged with ${JSON.stringify(badge(tree))} when everything the church posted is older than ` +
    `this member's mark. A dot that is always there is not a signal.`);
});

// ── two new ────────────────────────────────────────────────────────────────────────────────────────────────
test('two things posted since the member last looked show "2"', () => {
  const s = todayScreen({ servingSeenTs: NOW - DAY,
    churchEvents: [ev('old', NOW - 30 * DAY), ev('new1', NOW - 600), ev('new2', NOW - 60)] });
  const tree = s.draw();
  assert.equal(dots(tree).length, 1, 'no badge on the card with two events published since the mark');
  assert.equal(badge(tree), '2', `the card shows ${JSON.stringify(badge(tree))}, not "2"`);
});

test('a change to an event counts again — the document is republished with a newer time', () => {
  const before = todayScreen({ servingSeenTs: NOW - DAY, churchEvents: [ev('a', NOW - 30 * DAY)] }).draw();
  assert.equal(dots(before).length, 0, 'an untouched event older than the mark is already being counted');
  // a steward edits it: same d-tag, same id, newer created_at
  const after = todayScreen({ servingSeenTs: NOW - DAY, churchEvents: [ev('a', NOW - 300, { title: 'Event a (moved)' })] }).draw();
  assert.equal(badge(after), '1',
    `editing an event the member had already seen left the card showing ${JSON.stringify(badge(after))}. ` +
    `The owner asked for "an event or notice the church has posted, OR A CHANGE TO ONE".`);
});

test('one recurring event painted across the calendar is one thing, not twelve', () => {
  // app/app.jsx runs expandEvents() over the church's events before handing them to the screen, so a weekly
  // meeting arrives as one occurrence per week — all copies of ONE document, sharing its id and its ts.
  const occ = Array.from({ length: 12 }, (_, i) => ev('weekly', NOW - 300, { recurring: true, seriesDate: '2026-10-04', date: '2026-10-' + String(4 + i * 7).padStart(2, '0') }));
  const s = todayScreen({ servingSeenTs: NOW - DAY, churchEvents: [...occ, ev('other', NOW - 200)] });
  assert.equal(badge(s.draw()), '2',
    'a recurring meeting is counted once per occurrence — one weekly home group would read "9+" for ever');
});

// ── the cap ────────────────────────────────────────────────────────────────────────────────────────────────
test('ten new things read "9+", not "10"', () => {
  const s = todayScreen({ servingSeenTs: NOW - DAY, churchEvents: many(10, NOW - 300) });
  assert.equal(badge(s.draw()), '9+', `ten new things read ${JSON.stringify(badge(s.draw()))}`);
  const nine = todayScreen({ servingSeenTs: NOW - DAY, churchEvents: many(9, NOW - 300) });
  assert.equal(badge(nine.draw()), '9', `nine new things read ${JSON.stringify(badge(nine.draw()))} — the cap is off by one`);
});

// ── first run ──────────────────────────────────────────────────────────────────────────────────────────────
test('someone who joined this morning is not told they are fifty behind', () => {
  // no mark on this phone for this church yet, and the church has a year of events on its calendar
  const corpus = Array.from({ length: 50 }, (_, i) => ev('e' + i, NOW - (i + 1) * 3 * DAY));
  for (const noMark of [null, undefined, 0, '']) {
    const s = todayScreen({ servingSeenTs: noMark, churchEvents: corpus });
    const tree = s.draw();
    assert.equal(dots(tree).length, 0,
      `a member whose mark is ${JSON.stringify(noMark)} — i.e. one who has never opened the card on this ` +
      `phone — is shown ${JSON.stringify(badge(tree))} for a church that posted all fifty of those before ` +
      `they arrived. Everything from before they joined counts as already seen.`);
  }
});

// ── never badge what cannot be opened ──────────────────────────────────────────────────────────────────────
test('THE LEAK: the church\'s rota, rosters, run sheets and services never light the dot', () => {
  // Every one of these is published by the church seconds ago and is in ctx. None of them is on the card's
  // Events tab, and the rota in particular may be deliberately withheld from this member (rotaVis 'team' /
  // 'stewards', enforced by the relay). A dot over any of them opens onto nothing AND tells this member that
  // something exists that the church chose not to show them.
  const fresh = NOW - 60;
  const s = todayScreen({
    servingSeenTs: NOW - DAY,
    churchEvents: [],
    churchRotas: [{ service: 's1', published: true, assign: { 'welcome::greeter': { pub: 'someone-else' } }, ts: fresh }],
    churchRosters: [{ team: 'welcome', roles: [{ id: 'greeter', name: 'Greeter' }], people: [{ pub: 'someone-else' }], ts: fresh }],
    churchRunsheets: [{ service: 's1', items: [{ title: 'Opening song' }], ts: fresh }],
    churchServices: [{ id: 's1', date: '2026-10-04', time: '10:30', name: 'Sunday Gathering', ts: fresh }],
    churchTeams: [{ id: 'welcome', name: 'Welcome', ts: fresh }],
    rotaVis: 'stewards',
  });
  const tree = s.draw();
  assert.equal(dots(tree).length, 0,
    `the card is badged ${JSON.stringify(badge(tree))} for a member whose church has published only a rota, a ` +
    `roster, a run sheet and a service — with the rota set to stewards-only. The count must be built from what ` +
    `this member is SERVED (ctx.churchEvents, the Events tab's own list), never from the church's corpus.`);
});

test('an event sealed to a key this phone has not got is not counted — and badges on the day it arrives', () => {
  const locked = { id: 'sealed', ts: NOW - 300, _locked: true };
  const s = todayScreen({ servingSeenTs: NOW - DAY, churchEvents: [locked] });
  assert.equal(dots(s.draw()).length, 0,
    'a _locked event is counted. The Events tab can only say "1 event you can\'t open yet" about it, so the ' +
    'dot leads to nothing readable.');
  // …and it must not drag the mark forward either. A sealed document carries the publishing device's
  // created_at, which can sit AHEAD of this phone's clock; letting it set the mark would stamp past events
  // that have not been published yet and swallow them when they are.
  const ahead = { id: 'sealed', ts: NOW + 3600, _locked: true };
  const stamp = s.servingSeenStamp([ahead], NOW);
  assert.equal(stamp, NOW,
    `an unreadable event dragged the mark to ${stamp}, an hour past this phone's clock. Nothing published in ` +
    `that hour would ever be counted.`);
  const later = todayScreen({ servingSeenTs: stamp, churchEvents: [ev('real', NOW + 600, { title: 'Harvest supper' })] });
  assert.equal(badge(later.draw()), '1', 'an event published after the member last looked was swallowed by the sealed one');
});

// ── the member's own actions ───────────────────────────────────────────────────────────────────────────────
test('the member\'s own RSVP does not make anything new to them', () => {
  const events = [ev('a', NOW - 30 * DAY), ev('b', NOW - 30 * DAY)];
  const quiet = todayScreen({ servingSeenTs: NOW - DAY, churchEvents: events, myRsvps: {} });
  assert.equal(dots(quiet.draw()).length, 0, 'the card is badged before anyone has done anything');
  for (const verdict of ['going', 'maybe', 'no']) {
    const s = todayScreen({ servingSeenTs: NOW - DAY, churchEvents: events, myRsvps: { a: verdict, b: 'going' } });
    const tree = s.draw();
    assert.equal(dots(tree).length, 0,
      `answering "${verdict}" to an event badged the member's own card with ${JSON.stringify(badge(tree))}. ` +
      `Their own action is not news to them.`);
  }
  // and it does not inflate a genuine count either
  const mixed = todayScreen({ servingSeenTs: NOW - DAY, churchEvents: [...events, ev('c', NOW - 100)], myRsvps: { a: 'going', b: 'no', c: 'maybe' } });
  assert.equal(badge(mixed.draw()), '1', 'three RSVPs turned one new event into a different number');
});

// ── opening clears it ──────────────────────────────────────────────────────────────────────────────────────
test('opening the card clears it — and a draw on its own never does', () => {
  const events = [ev('a', NOW - 200), ev('b', NOW - 150), ev('c', NOW - 100)];
  const s = todayScreen({ servingSeenTs: NOW - DAY, churchEvents: events });
  let tree = s.draw();
  assert.equal(badge(tree), '3', `the card shows ${JSON.stringify(badge(tree))} before it is opened`);

  // A DRAW IS NOT AN OPENING. Painting Today on launch, or re-painting it, must not stamp anything.
  s.draw(); s.draw();
  assert.equal(s.opened.length, 0,
    `drawing Today ${s.opened.length} time(s) opened the Serving overlay by itself — the mark would clear on ` +
    `launch and on every re-render, which is exactly what the owner ruled out.`);

  // Tapping the card is what opens it. app/app.jsx's ctx.openServing() is what writes the mark.
  const card = servingCard(tree);
  assert.equal(card.length >= 1, true, 'the badged card has no tap handler, so it cannot be opened at all');
  card[0].props.onClick({ stopPropagation() {} });
  assert.equal(s.opened.length, 1,
    `tapping the Serving & events card called ctx.openServing() ${s.opened.length} times, not once. ` +
    `That call is the only thing that stamps the mark, so the dot would never clear.`);

  // …and the value app/app.jsx stamps, computed by the SHIPPED rule, really does clear the count.
  const stamp = s.servingSeenStamp(events, NOW);
  const after = todayScreen({ servingSeenTs: stamp, churchEvents: events });
  assert.equal(dots(after.draw()).length, 0,
    `after opening the card the mark was stamped at ${stamp} and the dot still reads ` +
    `${JSON.stringify(badge(after.draw()))}. Opening it must clear it.`);
});

test('the stamp survives a church whose publishing device has a fast clock', () => {
  const s = todayScreen({});
  const skewed = [{ id: 'fast', ts: NOW + 3600 }];
  assert.ok(s.servingSeenStamp(skewed, NOW) >= NOW + 3600,
    'opening the card stamps only "now", so an event published by a device an hour ahead stays counted for ' +
    'an hour after the member has looked straight at it — a dot that will not go away.');
  assert.ok(s.servingSeenStamp([], NOW) >= NOW,
    'a member with nothing in hand stamps 0, so the mark never leaves the floor and the very first event to ' +
    'arrive badges them — the first-run rule, defeated at the other end.');
});

// ── the card in its other states ───────────────────────────────────────────────────────────────────────────
test('a member who is already on the rota gets the dot too — it is the same card', () => {
  const s = todayScreen({
    servingSeenTs: NOW - DAY,
    churchEvents: [ev('a', NOW - 100), ev('b', NOW - 90)],
    servNext: { id: 'rota:1', teamName: 'Welcome', role: 'Greeter', date: '2026-10-04', service: 'Sunday' },
  });
  const tree = s.draw();
  assert.equal(texts(tree).some(t => t.includes('serving')), true, 'the rostered card is not on the screen');
  assert.equal(badge(tree), '2',
    `a member with a serving slot sees ${JSON.stringify(badge(tree))} on the card. The card is the same card ` +
    `and opens the same overlay, so a rostered member must not be the one person who never hears about a new event.`);
});

// ── a mark, not a demand ───────────────────────────────────────────────────────────────────────────────────
test('it is quiet — clay, not red, and it does not move', () => {
  const s = todayScreen({ servingSeenTs: NOW - DAY, churchEvents: many(3, NOW - 100) });
  const d = dots(s.draw());
  assert.equal(d.length, 1, 'no badge to inspect');
  const style = JSON.stringify(d[0].props.style || {}) + JSON.stringify((d[0].kids || []).map(k => (k && k.props) ? k.props.style : null));
  assert.ok(/--clay/.test(style), `the badge is not drawn in the clay tokens: ${style}`);
  assert.ok(!/red|--danger|--alert|#f00|crimson/i.test(style), `the badge shouts in an alarm colour: ${style}`);
  assert.ok(!/animation/i.test(style), `the badge animates — the owner asked for a mark, not a demand: ${style}`);
});

// ── the card still fits the phone, measured in a real browser ──────────────────────────────────────────────
// 320px is where this screen has broken before (01b9814, "the header fix broke words in half at 320px"), and
// a badge appended to a title is exactly the shape that breaks it: the first draft was a filled pill 48px
// wide including its margin, which at 320px pushed "Serving & events" onto a second line and grew the card by
// 25px. The badge is now a bare dot and a number, 31px including its margin, and the numbers below are the
// contract: the badged card is NO TALLER than the same card without a badge, at every width, and the title is
// not truncated to make room. Measured, not reasoned about — the tree says nothing about wrapping.
const WIDTHS = [320, 360, 390];
const UNITLESS = new Set(['opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flex', 'flexGrow', 'flexShrink',
  'order', 'zoom', 'aspectRatio', 'strokeWidth', 'strokeDashoffset', 'strokeDasharray', 'fillOpacity', 'strokeOpacity']);
const SVG_ATTR = { strokeWidth: 'stroke-width', strokeLinecap: 'stroke-linecap', strokeLinejoin: 'stroke-linejoin',
  strokeDasharray: 'stroke-dasharray', strokeDashoffset: 'stroke-dashoffset', strokeOpacity: 'stroke-opacity',
  fillOpacity: 'fill-opacity', clipPath: 'clip-path', viewBox: 'viewBox', className: 'class', htmlFor: 'for' };
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'track', 'wbr']);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kebab = k => (k.startsWith('Webkit') ? '-webkit-' + k.slice(6) : k).replace(/[A-Z]/g, c => '-' + c.toLowerCase()).replace(/^-webkit--/, '-webkit-');
const css = style => Object.entries(style || {})
  .filter(([, v]) => v != null && v !== false && v !== '')
  .map(([k, v]) => `${kebab(k)}:${typeof v === 'number' && !UNITLESS.has(k) ? v + 'px' : v}`).join(';');

function serialize(node) {
  const nodes = [], out = [];
  (function walk(n) {
    if (n == null || n === false || n === true) return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n === 'string' || typeof n === 'number') { out.push(esc(n)); return; }
    if (typeof n !== 'object') return;
    if (typeof n.type === 'function' || n.type === 'Fragment') { (n.kids || []).forEach(walk); return; }
    const tag = String(n.type), tid = nodes.length;
    nodes.push(n);
    const attrs = [`data-tid="${tid}"`];
    let inner = null;
    for (const [k, v] of Object.entries(n.props || {})) {
      if (k === 'children' || k === 'key' || k === 'ref' || v == null || v === false || typeof v === 'function') continue;
      if (k === 'style') { const s = css(v); if (s) attrs.push(`style="${esc(s)}"`); continue; }
      if (k === 'dangerouslySetInnerHTML') { inner = v.__html; continue; }
      attrs.push(`${SVG_ATTR[k] || (/^[a-z-]+$/.test(k) ? k : kebab(k))}="${esc(v === true ? '' : v)}"`);
    }
    out.push(`<${tag} ${attrs.join(' ')}>`);
    if (inner != null) out.push(inner); else (n.kids || []).forEach(walk);
    if (!VOID.has(tag)) out.push(`</${tag}>`);
  })(node);
  return { html: out.join(''), nodes };
}

const shell = html =>
`<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/vendor/fonts/fonts.css">
<style>${[...readFileSync(join(ROOT, 'index.html'), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')}
html,body{margin:0;padding:0} #app{position:relative;width:100%;height:100vh;overflow:hidden}</style>
<div id="app">${html}</div>`;

// The card, and the title line inside it, located in the SERIALISED tree so the browser can be asked about
// exactly those two boxes. `_tid` is only a handle; every number below comes from the browser.
function page(over) {
  const { html, nodes } = serialize(todayScreen(over).draw());
  const card = nodes.findIndex(n => n.type === 'div' && typeof (n.props || {}).onClick === 'function'
    && texts(n).some(t => t.includes('Serving & events')));
  const title = nodes.findIndex(n => n.type === 'div' && texts(n).join('').startsWith('Serving & events'));
  const dot = nodes.findIndex(n => /since you last looked/i.test(String((n.props || {})['aria-label'] || '')));
  assert.ok(card >= 0 && title >= 0, 'the Serving & events card is not in the serialised tree');
  return { html: shell(html), card, title, dot };
}

let chr = null, srv = null, ws = null, send = null, dir = null, BADGED = null, PLAIN = null;

before(async () => {
  BADGED = page({ servingSeenTs: NOW - DAY, churchEvents: many(12, NOW - 100) });   // renders "9+", the widest it gets
  PLAIN = page({});                                                                 // the same card, no badge
  if (!CHROME) return;
  await requireFreePort(CDP, 'serving-card-says-whats-new.test.mjs (Chrome debug port)');
  dir = mkdtempSync(join(tmpdir(), 'trin-servnew-'));
  srv = createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/badged.html' || p === '/plain.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(p === '/badged.html' ? BADGED.html : PLAIN.html);
    }
    const f = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': { '.css': 'text/css', '.woff2': 'font/woff2' }[extname(f)] || 'application/octet-stream' });
    res.end(readFileSync(f));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu',
    // never let a test reach production, exactly as app-boots.test.mjs does
    '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9',
    `--user-data-dir=${join(dir, 'prof')}`, 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 50 && !(targets && targets.length); i++) { await sleep(300); try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const t = targets.find(x => x.type === 'page') || targets[0];
  ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', d => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Runtime.enable');
});

after(() => { try { ws && ws.close(); } catch {} try { chr && chr.kill('SIGKILL'); } catch {} try { srv && srv.close(); } catch {}
  try { dir && rmSync(dir, { recursive: true, force: true }); } catch {} });

async function measure(which, width) {
  const P = which === 'badged' ? BADGED : PLAIN;
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: `http://127.0.0.1:${srv.address().port}/${which}.html` });
  await sleep(450);
  const expr = `(async () => { try { await document.fonts.ready; } catch (e) {}
    const box = t => { if (t < 0) return null; const e = document.querySelector('[data-tid="' + t + '"]');
      if (!e) return null; const b = e.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
               right: Math.round(b.right), bottom: Math.round(b.bottom), scrollW: e.scrollWidth, clientW: e.clientWidth }; };
    return JSON.stringify({ vw: document.documentElement.clientWidth, docScrollW: document.documentElement.scrollWidth,
      card: box(${P.card}), title: box(${P.title}), dot: box(${P.dot}) }); })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  assert.ok(!(r.result && r.result.exceptionDetails), 'the measuring probe threw: ' + JSON.stringify(r.result || {}).slice(0, 300));
  const m = JSON.parse(r.result.result.value);
  assert.equal(m.vw, width, 'the page did not lay out at the width under test');
  assert.ok(m.card, 'the Serving & events card never reached the page');
  return m;
}

for (const width of WIDTHS) {
  test(`the badge costs the card nothing at ${width}px`, { skip: !CHROME ? 'no chromium' : false, timeout: 90000 }, async () => {
    assert.ok(BADGED.dot >= 0, 'the badged fixture has no badge in it — nothing below would mean anything');
    assert.equal(PLAIN.dot, -1, 'the unbadged fixture has a badge on it, so it is not a baseline');
    const plain = await measure('plain', width);
    const badged = await measure('badged', width);
    assert.ok(badged.card.h <= plain.card.h,
      `at ${width}px the badged card is ${badged.card.h}px tall against ${plain.card.h}px without the badge — ` +
      `"9+" has pushed the title onto a second line and grown the card. It has to sit AFTER the title, on it.`);
    assert.ok(badged.title.scrollW <= badged.title.clientW + 1,
      `at ${width}px the card's title is truncated to make room for the badge ` +
      `(${badged.title.scrollW}px of text in a ${badged.title.clientW}px box) — the card loses its own name.`);
    assert.ok(badged.dot, 'the badge did not reach the page');
    assert.ok(badged.dot.y >= badged.title.y && badged.dot.bottom <= badged.title.y + 26,
      `at ${width}px the badge sits at y=${badged.dot.y} while the title starts at y=${badged.title.y} — ` +
      `it has dropped onto its own line instead of following the title.`);
    assert.ok(badged.dot.right <= badged.card.right && badged.dot.x >= badged.card.x,
      `at ${width}px the badge (x=${badged.dot.x}..${badged.dot.right}) hangs outside the card ` +
      `(x=${badged.card.x}..${badged.card.right})`);
    assert.equal(badged.docScrollW, width,
      `at ${width}px the badged page scrolls sideways (${badged.docScrollW}px of content in ${width}px)`);
  });
}
