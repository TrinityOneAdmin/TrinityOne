// A PIN-locked app must not announce which church you belong to.
// Run: node --test scripts/locked-app.test.mjs
//
// AUDIT-2026-07-27, found by testing a claim the marketing notes listed as safe to make: "locked with a PIN,
// the app is a plain Bible reader — the church side isn't reachable". It wasn't. On a cold boot with the gate
// up, and again after "read the Bible without unlocking", the Today screen drew the church's NAME. Hiding just
// the name was not enough either: the card underneath still read "Serving & events · RSVP · your rota", which
// tells a checkpoint the same thing. Verified in a browser before and after.
//
// SCOPE, so nobody reads more into this than it earns: this defeats a GLANCE — someone picking the phone up.
// The device still STORES the church list and its cached documents in the clear, so anyone who examines it
// finds the church anyway. The claim that a locked app reveals no church needs the encrypt-at-rest work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, texts } from './render-jsx-screen.mjs';

const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');
const TODAY = readFileSync(new URL('../app/screens-today.jsx', import.meta.url), 'utf8');

test('a locked app has no church in context at all', () => {
  const at = APP.indexOf('church: commLocked ?');
  assert.notEqual(at, -1,
    'ctx.church is no longer nulled while locked — every church-derived screen reads it, so the church name comes back');
  // The property is a single context line, so read exactly that line. The old fnBody slice here was
  // call-shaped and silently ran on into openChurchSwitcher's body (AUDIT-2026-08-10 item E) — the
  // assertion only ever matched on the anchor's own line, so the line IS the honest window.
  const line = APP.slice(at, APP.indexOf('\n', at));
  assert.match(line, /commLocked \? null/, 'locked must yield null, not a fallback church');
});

test('the serving card cannot render without a church', () => {
  // Re-anchored 2026-10-14: the serving card is now ONE "What's happening" card (You're serving folded onto it as a
  // single line); the gate is `{!ctx.church ? null : (` and the card follows. Anchor on the gate, then confirm the
  // card (its "your rota" subtitle) sits directly behind it.
  const at = TODAY.indexOf('{!ctx.church ? null : ');
  assert.notEqual(at, -1,
    'the serving card renders unconditionally again — "What’s happening · RSVP · your rota" on a locked phone says church as loudly as the name did');
  // Read the gate's first rendered element to its opening-tag '>' rather than a fixed-width window, so this
  // stays honest as the card body grows (test-windows.test.mjs). [re-anchored 2026-10-16]
  assert.match(TODAY.slice(at, TODAY.indexOf('>', at) + 1), /position: "relative", marginBottom: 22/,
    'the What\'s happening card is no longer the ctx.church gate\'s only branch');
});

// RULE 3: the text match above can be satisfied by a gate that is disabled. This one RENDERS the Today screen.
function renderToday(church, opts = {}) {
  const { React, draw } = miniReact();
  const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
  // opts.hidden simulates a phone that tapped the now-removed "What’s happening" dismiss X, which used to
  // persist trinityone.serving.cardHidden='1'. The card must still render — the gate is gone, not just the button.
  const LS = { getItem: (k) => (opts.hidden && k === 'trinityone.serving.cardHidden' ? '1' : null), setItem() {}, removeItem() {} };
  const win = { Fellowship: { myPubkey: 'me' }, Capacitor: { isNativePlatform: () => false },
    TrinityData: { VOTD_POOL: [{ ref: 'John 3:16', text: 'x' }], PLANS: [{ id: 'p1', name: 'A plan', days: [{ d: 1, ref: 'Gen 1' }] }], NOTIFICATIONS: [] },
    Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], bookName: () => 'G', bookAbbr: () => 'G', maxChapter: () => 50, activeVersion: 'WEB' },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    localStorage: LS, innerWidth: 390 };
  const globals = { React, window: win,
    document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
    navigator: { userAgent: '' }, localStorage: LS, setTimeout, clearTimeout, setInterval, clearInterval, console,
    Icon: Stub('Icon'), IconBtn: Stub('IconBtn'), ChurchBadge: Stub('ChurchBadge'), SafetyBanner: Stub('SafetyBanner'),
    CareCard: Stub('CareCard'), AskForHelp: Stub('AskForHelp'),
    SectionLabel: function SectionLabel(p) { return React.createElement('h2', {}, p.children); },
    BottomSheet: ({ open, children }) => (open ? children : null),
    Overlay: function Overlay(p) { return React.createElement('div', {}, p.open ? p.children : null); },
    safeCssColor: (c) => c, todayISO: () => '2026-09-06', lsGet: (k, d) => d, lsSet: () => {},
    Math, Date, JSON, Set, Map, Number, String, Array, Promise, Object, isNaN, Boolean, parseInt, parseFloat };
  const mod = loadScreen('app/screens-today.jsx', ['TodayScreen'], globals);
  const ctx = { myChildren: { children: [], askAtDesk: 0, settled: true }, church,
    care: { settings: { enabled: false }, needs: [], myPub: 'me' },
    planProgress: {}, loc: null, churchDevos: [], servNext: opts.servNext || null, servPending: opts.servPending || [], servingSeenTs: 0, netUnread: 0, dark: false,
    openServing() {}, openChurchSwitcher() {}, openSearch() {}, openNotifications() {}, openListen() {},
    toggleDark() {}, toast() {}, openShareSheet() {}, openEvent() {}, openHelp() {} };
  return texts(draw(mod.TodayScreen, { ctx })).join(' ').replace(/\s+/g, ' ');
}

test('RENDERED: a locked phone (no ctx.church) draws no serving card; CONTROL: with a church it does', () => {
  const locked = renderToday(null);
  assert.match(locked, /Verse of the day/, 're-anchor: the Today screen rendered nothing, so the absence below is vacuous');
  assert.doesNotMatch(locked, /What\s*.\s*s\s*happening/,
    'A LOCKED PHONE DRAWS "What’s happening · RSVP · your rota" — it says church as loudly as the name did');
  const open = renderToday({ id: 'c1', name: "St Chad's", npub: 'n'.repeat(8) });
  assert.match(open, /What\s*.\s*s\s*happening/, 'CONTROL: with a church the card should draw, or the absence above proves nothing');
});

test('RENDERED: the removed dismiss X cannot hide the serving card for ever', () => {
  // One X on either the Today or Community card used to set trinityone.serving.cardHidden='1', shared by both,
  // hiding "What’s happening" (and the six things behind it, incl. Care) permanently. The X, its state and its
  // render gate were removed. A phone that already tapped it (flag still '1') must see the card again.
  const dismissed = renderToday({ id: 'c1', name: "St Chad's", npub: 'n'.repeat(8) }, { hidden: true });
  assert.match(dismissed, /What\s*.\s*s\s*happening/,
    'the serving card is hidden when the legacy dismiss flag is set — the hide-gate is still live; removing the button alone is not enough');
});

test('RENDERED: a serving slot shows as a line on the What s happening card (owner 2026-10-14)', () => {
  // One card now: "You're serving" / "Can you serve?" is a single line folded onto the What's happening card,
  // not a separate alternate card. Fails if the serving line is deleted.
  const serving = renderToday({ id: 'c1', name: "St Chad's", npub: 'n'.repeat(8) }, { servNext: { teamName: 'Welcome', role: 'Greeter', date: '2026-10-04' } });
  assert.match(serving, /What\s*.\s*s\s*happening/, 're-anchor: the What s happening card did not render, so the checks below are vacuous');
  assert.match(serving, /You\s*.\s*re serving/, 'the "You re serving" line must draw INSIDE the one card when there is a slot');
  assert.match(serving, /Welcome/, 'the team name must show on the serving line');
});

test('the honest limit is written down next to the fix', () => {
  // If the next person reads this as full deniability they will repeat the marketing claim that started it.
  const at = APP.indexOf('church: commLocked ?');
  const around = APP.slice(Math.max(0, at - 1400), at);
  assert.match(around, /still STORES|encrypt-at-rest|examining the device/i,
    'the at-rest limitation must stay documented beside the change, or this reads as more than it is');
});

test('no surface promises more than the lock delivers', () => {
  // The claim that started this — "locked, the app is a plain Bible reader" — was in ARCHITECTURE.md and in two
  // places a member reads while deciding whether to rely on it. The screen part is now true. The part that
  // isn't, and cannot be until the church cache is encrypted at rest, is that examining the phone reveals
  // nothing. Copy that implies otherwise is the most dangerous thing in this repo, because the people it
  // misleads are the ones the product exists for.
  const ARCH = readFileSync(new URL('../ARCHITECTURE.md', import.meta.url), 'utf8');
  const EXTRAS = readFileSync(new URL('../app/identity-extras.jsx', import.meta.url), 'utf8');
  const IDENT = readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8');
  assert.match(ARCH, /not plausible deniability/i, 'the architecture doc states the limit');
  assert.match(ARCH, /still stores the church list/i, 'and says concretely what leaks');
  assert.match(EXTRAS, /which church you belong to/i,
    'the in-app explainer must tell a member what the PIN does NOT hide — they may be deciding on it under real risk');
  for (const [name, src] of [['identity-extras.jsx', EXTRAS], ['identity.jsx', IDENT]]) {
    assert.doesNotMatch(src, /the app looks like a plain Bible reader|the app is a plain Bible reader/,
      name + ' still tells a member the app merely "looks like" a Bible reader, which claims deniability it does not have');
  }
});
