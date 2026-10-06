// A CHILD MUST NEVER BE OFFERED "I'LL HELP" ON SOMEONE ELSE'S CARE NEED.
//   Run: node --test scripts/a-child-is-not-offered-care-sign-up.test.mjs
//
// Sim finding (block A2, item 8; owner, 2026-10-02: "Children do NOT volunteer for care … a child can ask for
// help but must never be offered 'I'll help' / care sign-up for someone else's need"). A young person on the
// Care tab could open an adult's meal need and sign up to bring dinner to an adult's home. CareCard already
// worked out that the reader was a child, but used it only to reword headings; the sign-up list was never
// gated. The one OTHER volunteer path ("I'm here to help", CareAvailability) already hid itself from a child —
// this was the sibling that was missed. Nothing below the screen stopped it either.
//
// THE RULE USES `ctx.minorState` (app/app.jsx): 'minor' | 'maybe' | 'adult'. A confirmed minor AND the "maybe"
// window — a child on a cold start, before their own clearance has landed — both lose the sign-up list; only
// 'adult' (and a shell too old to say) keeps it. A slot a child ALREADY holds stays cancellable.
//
// POINT OF USE (rule 1): the REAL CareCard (app/screens-today.jsx, rendered through the miniature React) in
// BOTH of its variants (the Serving "Care" tab and the Today card). THE ENGINE BACKSTOP: the SHIPPED
// fillCareSlot, lifted from vendor/fellowship.js with the shipped _sgMine, refuses a confirmed minor — so a
// modified build that shows the button anyway still cannot publish the slot. (The relay half is a separate
// owner decision and is not in this change.)
//
// RULE 3: nothing here matches text in app/*.jsx. Every claim is about a rendered tree or a lifted function.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, texts, find, button } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';

const Stub = (n) => function S(p) { return { type: n, props: p, kids: [] }; };
const ME = 'm'.repeat(64), RECIP = 'r'.repeat(64);
const TODAY = '2026-10-02';
const NEED = { id: 'n1', type: 'meals', status: 'open', recipient: RECIP, startDate: '2026-10-05', endDate: '2026-10-06', meals: ['dinner'], title: 'Meals for the Okafor family' };

function card({ minorState, isMinor = false, embedded = true, slots = [], focus = true, freshLocalStorage = false }) {
  const { React, draw } = miniReact();
  const globals = {
    React, console, setTimeout, clearTimeout, setInterval, clearInterval,
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    ChurchBadge: Stub('ChurchBadge'),
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    localStorage: { getItem: freshLocalStorage ? () => null : (k) => (k === 'trinityone.care.sec.need' || k === 'trinityone.care.sec.give') ? '1' : null, setItem() {}, removeItem() {} },
    lsGet: (k, d) => d, lsSet: () => {},
    cx: (...a) => a.filter(Boolean).join(' '),
    SectionLabel: Stub('SectionLabel'), Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'),
    useTrinityAudio: () => ({ track: null, playing: false }),
    todayISO: () => TODAY,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    window: {
      addEventListener() {}, removeEventListener() {}, innerWidth: 360,
      Fellowship: { myPubkey: ME, subscribeCareRequests: (cb) => { cb([]); return () => {}; }, childCareAudience: async () => ['x'.repeat(64)] },
      TrinityData: { NOTIFICATIONS: [], PLANS: [], VOTD_POOL: [] },
      Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1, activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }) },
    },
  };
  const { CareCard } = loadScreen('app/screens-today.jsx', ['CareCard'], globals);
  const filled = [];
  const ctx = {
    church: { npub: 'npub1church' }, toast() {}, connTick: 0, churchRosters: [],
    safeguard: { minors: [], approved: [], guardians: {}, isMinor, minorsKnown: true },
    care: { myPub: ME, settings: { enabled: true, visibility: 'church' }, needs: [NEED], slots, skips: [], avail: [],
      fill: (...a) => { filled.push(a); }, clearFill() {}, skip() {}, clearSkip() {} },
  };
  if (minorState !== undefined) ctx.minorState = minorState;
  if (focus) ctx.careFocus = 'n1';   // deep-link: opens the need in the embedded Care tab
  const props = { ctx, embedded };
  draw(CareCard, props);
  let tree = draw(CareCard, props);
  return { tree, words: texts(tree).join(' | '), filled, draw: () => draw(CareCard, props), props, CareCard };
}

test('CONTROL: an ADULT on the Care tab is offered the sign-up list and "I’ll help"', () => {
  const c = card({ minorState: 'adult' });
  assert.match(c.words, /If you can help/);
  assert.match(c.words, /Sign up for a day/);
  assert.ok(button(c.tree, 'I’ll help').length >= 1, 're-anchor: the adult sees no "I’ll help" at all, so the absences below are vacuous. Screen read: ' + c.words);
});

test('CONTROL: a ctx from a shell too old to say (no minorState) behaves as an adult', () => {
  const c = card({ minorState: undefined });
  assert.ok(button(c.tree, 'I’ll help').length >= 1);
});

for (const [label, args] of [['a confirmed MINOR', { minorState: 'minor', isMinor: true }], ['a MAYBE-child (clearance not yet heard)', { minorState: 'maybe' }]]) {
  test(`${label} on the Care tab is offered NO sign-up: no list, no "I’ll help", no "If you can help" heading`, () => {
    const c = card(args);
    assert.equal(button(c.tree, 'I’ll help').length, 0,
      'A CHILD WAS OFFERED "I’LL HELP" ON SOMEONE ELSE’S NEED. Screen read: ' + c.words);
    assert.doesNotMatch(c.words, /Sign up for a day/, 'the sign-up invitation reached a child');
    assert.doesNotMatch(c.words, /Meals for the Okafor family/, 'an adult’s care need was listed to a child');
    assert.doesNotMatch(c.words, /If you can help/, 'a "If you can help" heading is left over an empty section');
    assert.match(c.words, /If you need help/, 'the half they ARE offered — asking for help — went with it');
  });

  test(`${label} on the TODAY card sees no care card at all (reaches care via the What’s Happening link)`, () => {
    const c = card({ ...args, embedded: false, focus: false });
    assert.doesNotMatch(c.words, /Someone in the church could use a hand/);
    assert.doesNotMatch(c.words, /Meals for the Okafor family/);
    assert.equal(button(c.tree, 'I’ll help').length, 0);
    assert.doesNotMatch(c.words, /Practical care/, 'the care card should be gated off Today for a child with no actionable items');
  });
}

test('a confirmed minor is refused even from a shell that does not send minorState (the older field still counts)', () => {
  const c = card({ minorState: undefined, isMinor: true });
  assert.equal(button(c.tree, 'I’ll help').length, 0, 'a confirmed minor was offered "I’ll help" because ctx.minorState was absent. Screen read: ' + c.words);
});

test('a slot a child ALREADY holds stays visible and cancellable — but no OTHER day offers "I’ll help"', () => {
  // Signed up before being marked, or by another route: withdrawing must still be possible.
  const slots = [{ needId: 'n1', isoDate: '2026-10-05', pubkey: ME }];
  const c = card({ minorState: 'minor', isMinor: true, slots });
  assert.match(c.words, /You’re helping/, 'a child lost the control that lets them withdraw an existing sign-up. Screen read: ' + c.words);
  assert.equal(button(c.tree, 'I’ll help').length, 0, 'the day they hold is cancellable, but the OTHER day offered "I’ll help"');
});

// ── the engine backstop ───────────────────────────────────────────────────────────────────────────────────
const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
function fill({ self }) {
  const published = [];
  const sgSelf = self ? { cp: CP, me: ME, isMinor: !!self.isMinor, known: !!self.known } : { cp: '', me: '', isMinor: false, known: false };
  const scope = {
    window: { Fellowship: { churchPub: CP, ready: Promise.resolve() } },
    sk: new Uint8Array(32), NET: 'trinityone', CARESLOT_D: 'trinityone/careslot:',
    finalizeEvent: (t) => ({ ...t, id: 'ev' }),
    publishSetFor: () => ['wss://x.invalid'],
    _publishAny: async (_r, e) => { published.push(e); },
    _pubReason: () => 'not-sent', console: { warn() {} },
    _sgSelf: sgSelf, _mePub: () => ME,
    _sgMine: new Function('_sgSelf', '_mePub', fnBody(BUNDLE, 'function _sgMine(cp)', '_sgMine') + '\nreturn _sgMine;')(sgSelf, () => ME),
  };
  const body = fnBody(BUNDLE, 'async fillCareSlot(careId, iso, note) {', 'fillCareSlot');
  scope[(body.match(/\b(finalizeEvent\d*)\(/) || [])[1]] = scope.finalizeEvent;
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(k in globalThis),
    get: (t, k) => { if (k in t) return t[k]; if (k === Symbol.unscopables) return undefined; throw new ReferenceError('needs a stub for ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const f = new Function('scope', `with (scope) { return ({ ${body} }).fillCareSlot; }`)(proxy);
  return { run: () => f('n1', '2026-10-05', 'lasagne'), published };
}
const CP = 'c'.repeat(64);

test('ENGINE: a confirmed minor cannot publish a care sign-up, whatever the screen shows', async () => {
  const f = fill({ self: { isMinor: true, known: true } });
  const r = await f.run();
  assert.deepEqual(r && { ok: r.ok, reason: r.reason }, { ok: false, reason: 'minor' }, 'a marked child published a care slot');
  assert.equal(f.published.length, 0, 'the slot reached the relay layer');
});

test('ENGINE CONTROL: a confirmed adult, and a member whose answer has not arrived, still sign up (fails open)', async () => {
  for (const self of [{ isMinor: false, known: true }, null]) {
    const f = fill({ self });
    const r = await f.run();
    assert.equal(r && r.ok, true, 'the guard refused a member the church has not marked as a child: ' + JSON.stringify(self));
    assert.equal(f.published.length, 1);
  }
});

// ── care sections default to collapsed ───────────────────────────────────────────────────────────────────
// A fresh install (localStorage returns null for the section keys) must show both "If you need help" and
// "If you can help" as headings, but NOT their contents — CareSection defaults to collapsed, so the member
// sees a tidy summary, not two long open lists.
test('both care sections start COLLAPSED for a fresh user — the headings appear but the sign-up content does not', () => {
  const c = card({ minorState: 'adult', freshLocalStorage: true });
  assert.match(c.words, /If you need help/, 'the section heading must still render when collapsed');
  assert.match(c.words, /If you can help/, 'the section heading must still render when collapsed');
  assert.doesNotMatch(c.words, /Sign up for a day/,
    'a collapsed section rendered its children — CareSection.defaultOpen is not false');
  assert.doesNotMatch(c.words, /Meals for the Okafor family/,
    'a collapsed section rendered its children — CareSection.defaultOpen is not false');
});
