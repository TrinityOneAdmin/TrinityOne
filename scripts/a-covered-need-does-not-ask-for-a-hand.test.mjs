// A NEED EVERY DAY OF WHICH IS TAKEN MUST NOT KEEP SAYING "SOMEONE COULD USE A HAND" (sim item 43).
//   Run: node --test scripts/a-covered-need-does-not-ask-for-a-hand.test.mjs
//
// THE DEFECT (SIM-VERIFY-2026-10-02, item 43): CareCard drew its header — "Someone in the church could use a
// hand. Sign up for a day" — for ANY non-empty list of needs. A church whose every need was fully covered
// still read that line above rows that each said "all covered", and the "If you can help" heading counted the
// covered needs as work to do.
//
// THE FIX: careNeedDays() answers which days of a need are still open (the same answer the row gives); the
// header asks for help only when some need still has an open day, and otherwise says everything is covered.
//
// POINT OF USE (CLAUDE.md rules 1 and 3): CareCard is compiled from app/screens-today.jsx and DRAWN through
// the miniature React (scripts/render-jsx-screen.mjs); every assertion reads the drawn tree. Users of the
// changed code: CareCard (mounted on Today in app/screens-today.jsx, and embedded on the Serving page's Care
// tab in app/screens-serving.jsx) and CareNeedRow, which now takes its day list from the same helper.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts } from './render-jsx-screen.mjs';

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const HELPER = 'c'.repeat(64);
const ASK = /could use a hand/i;
const COVERED = /all covered/i;

function card({ needs, slots = [], skips = [], embedded = false }) {
  const { React, draw } = miniReact();
  const Icon = ({ name }) => React.createElement('i', { 'data-icon': name });
  const Stub = (n) => function S(p) { return React.createElement('div', { 'data-stub': n }, p && p.children); };
  const win = { addEventListener() {}, removeEventListener() {}, innerWidth: 360,
    Fellowship: { subscribeSafetyCheck: () => () => {}, subscribeCareRequests: () => () => {}, childCareAudience: async () => [],
      displayFor: () => null },
    TrinityData: { NOTIFICATIONS: [], PLANS: [], VOTD_POOL: [] },
    Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1,
             activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }) } };
  const globals = {
    React, window: win,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    Icon, ChurchBadge: Stub('ChurchBadge'), SectionLabel: (p) => React.createElement('h2', {}, p.children),
    Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'),
    lsGet: (k, d) => d, lsSet: () => {}, cx: (...a) => a.filter(Boolean).join(' '),
    useTrinityAudio: () => ({ track: null, playing: false }), todayISO: () => '2026-09-15',
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  };
  const mod = loadScreen('app/screens-today.jsx', ['CareCard'], globals);
  const ctx = { care: { settings: { enabled: true, visibility: 'church' }, needs, slots, skips, myPub: ME, avail: [] },
    churchRosters: [], safeguard: { isMinor: false, minors: [] } };
  const props = { ctx, embedded };
  draw(mod.CareCard, props);
  return texts(draw(mod.CareCard, props)).join(' | ');
}

const need = (id, dates) => ({ id, recipient: OTHER, displayLabel: 'Family ' + id, type: 'meals', dates });
const slot = (needId, isoDate) => ({ needId, isoDate, pubkey: HELPER });

test('A FULLY COVERED NEED does not ask for a hand — it says all covered', () => {
  const shown = card({ needs: [need('n1', ['2026-09-20', '2026-09-21'])], slots: [slot('n1', '2026-09-20'), slot('n1', '2026-09-21')] });
  assert.match(shown, /Family n1/, 're-anchor: the need did not draw, so nothing below is about the card');
  assert.match(shown, /all covered/i, 're-anchor: the row no longer says "all covered"');
  assert.doesNotMatch(shown, ASK,
    'EVERY DAY OF EVERY NEED IS TAKEN AND THE CARD STILL SAYS SOMEONE COULD USE A HAND. Shown: ' + shown);
  assert.match(shown, /All covered — every day/, 'nothing replaced the prompt with "all covered". Shown: ' + shown);
});

test('A NEED WITH A DAY STILL OPEN still asks', () => {
  const shown = card({ needs: [need('n1', ['2026-09-20', '2026-09-21'])], slots: [slot('n1', '2026-09-20')] });
  assert.match(shown, ASK, 'a need with an open day lost its prompt — the fix swallowed the ordinary case. Shown: ' + shown);
  assert.doesNotMatch(shown, /All covered — every day/);
});

test('ONE COVERED AND ONE OPEN: the prompt stays, because one still needs a hand', () => {
  const shown = card({ needs: [need('n1', ['2026-09-20']), need('n2', ['2026-09-20'])], slots: [slot('n1', '2026-09-20')] });
  assert.match(shown, ASK, 'a covered need switched the prompt off for an open one beside it. Shown: ' + shown);
});

test('A DAY THE CARE TEAM SKIPPED COUNTS AS NOT NEEDED — a need whose other days are taken is covered', () => {
  const shown = card({ needs: [need('n1', ['2026-09-20', '2026-09-21'])], slots: [slot('n1', '2026-09-20')],
    skips: [{ needId: 'n1', isoDate: '2026-09-21' }] });
  assert.doesNotMatch(shown, ASK, 'a need with one day taken and the other skipped still asks for a hand. Shown: ' + shown);
});

test('A NEED WITH NO DAYS IS NOT "COVERED" — it keeps the old prompt (nothing was handled)', () => {
  const shown = card({ needs: [need('n1', [])] });
  assert.doesNotMatch(shown, /All covered — every day/,
    'a need with no days was reported as covered — the lie care-coverage-honesty.test.mjs exists to prevent. Shown: ' + shown);
});

test('THE CARE TAB: "If you can help · N" counts only the needs that still need a hand', () => {
  const needs = [need('n1', ['2026-09-20']), need('n2', ['2026-09-20']), need('n3', ['2026-09-20'])];
  const some = card({ needs, slots: [slot('n1', '2026-09-20')], embedded: true });
  assert.match(some, /If you can help \| +· +\| 2 \|/, 'the count includes a covered need. Shown: ' + some);
  const none = card({ needs: [needs[0]], slots: [slot('n1', '2026-09-20')], embedded: true });
  assert.doesNotMatch(none, /If you can help \| +· +\| \d/, 'a church with nothing left to do still shows a count. Shown: ' + none);
  assert.match(none, COVERED, 're-anchor: the embedded card did not draw the covered need');
});
