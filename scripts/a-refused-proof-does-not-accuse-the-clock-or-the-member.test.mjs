// A REFUSED PROOF MUST NOT BECOME AN ACCUSATION — OF THE CLOCK, OR OF THE MEMBER.
// Run: node --test scripts/a-refused-proof-does-not-accuse-the-clock-or-the-member.test.mjs
//
// dd22062 taught the app to notice a refused NIP-42 proof and stop saying "Waiting to be let in". An audit
// then proved, AGAINST THE REAL GATEWAY, that the fix accused the wrong party in two ways:
//
//   scripts/gateway.mjs:5382 — `fresh && boundToUs && verifyEvent(evt) && !BLOCKED.has(evt.pubkey)` is ONE
//   condition with ONE else-branch, so a wrong clock and a church that has BLOCKED you produce byte-identical
//   refusals with the socket left open. Measured: [admitted, clock +900s] and [BLOCKED, clock ok] both come
//   back "auth-failed: bad challenge or signature".
//
//   1. The app re-challenged on any refusal, so a member a church had removed got a permanent 90-second
//      full-teardown loop against the relay that removed them — and a card saying their clock was wrong and
//      "anything you post will send once it reconnects". It never will: the relay refuses their every write.
//   2. `removed` is `wasAdmitted && approval && !isAdmitted`, and a refused proof empties the gated
//      `admitted` read — so every term went true for exactly the member the fix was for, and Chat announced
//      "You're no longer in this church — your access has been removed." Worse than the message it replaced,
//      and it was being cached to localStorage as the offline answer.
//
// The measured skew is the only honest discriminator the client has, so it now gates both the reconnect and
// the copy. Renders the REAL TodayScreen (rule 1) — the previous commit claimed that was not possible; it
// was, with the harness already in the repo, which is what the audit demonstrated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts } from './render-jsx-screen.mjs';

const Stub = (n) => function S(p) { return { type: n, props: p, kids: [] }; };

function screen({ joinState, clockIsWrong = false, clockSkewMins, clockSkewAhead = true }) {
  const { React, draw } = miniReact();
  const date = new Date('2026-09-05T09:00:00Z');
  const Icon = ({ name }) => React.createElement('i', { 'data-icon': name });
  const win = {
    addEventListener() {}, removeEventListener() {}, innerWidth: 360,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Fellowship: { subscribeCareRequests: () => () => {}, cancelCareRequest() {}, childCareAudience: async () => [] },
    ChurchBadge: Stub('ChurchBadge'),
    // A NON-EMPTY VOTD_POOL. With an empty one the screen reads `.ref` off undefined and dies before it
    // reaches the cards — which is the "TodayScreen cannot be rendered" I wrongly recorded in dd22062.
    TrinityData: { NOTIFICATIONS: [], PLANS: [{ id: 'p1', name: 'Plan', days: [{ d: 1, ref: 'John 1' }] }], VOTD_POOL: [{ ref: 'John 14:27', text: 'Peace I leave with you.' }] },
    Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1,
      activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }) },
  };
  const globals = {
    React, window: win, localStorage: win.localStorage,
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    Icon, ChurchBadge: Stub('ChurchBadge'),
    lsGet: (k, d) => d, lsSet: () => {}, cx: (...a) => a.filter(Boolean).join(' '),
    SectionLabel: Stub('SectionLabel'), Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'),
    useTrinityAudio: () => ({ track: null, playing: false }),
    todayISO: () => '2026-09-05',
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [date])); } static now() { return date.getTime(); } },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  };
  const { TodayScreen } = loadScreen('app/screens-today.jsx', ['TodayScreen'], globals);
  const ctx = {
    church: { name: 'Grace', initials: 'GR', npub: 'np1' }, joinState, clockIsWrong, clockSkewMins, clockSkewAhead,
    openChurchSwitcher() {}, openSearch() {}, openNotifications() {}, toggleDark() {}, dark: false,
    toast() {}, netUnread: 0, openServing() {}, openListen() {}, openShareSheet() {}, go() {},
    planProgress: {}, plans: [], bookmarks: [], notes: {}, highlights: {},
  };
  draw(TodayScreen, { ctx });
  return texts(draw(TodayScreen, { ctx })).join(' | ');
}

const ADMITTED_BUT_REFUSED = { approval: true, isAdmitted: false, isPending: true, authFailed: true, loaded: true };

test('CONTROL: a member genuinely waiting still sees the waiting card', () => {
  const s = screen({ joinState: { approval: true, isAdmitted: false, isPending: true, loaded: true } });
  assert.match(s, /Waiting to be let in/, 'the newcomer card is gone, so a real applicant is told nothing');
  assert.doesNotMatch(s, /Can’t check with your church/);
});

test('CONTROL: an admitted member on a working connection sees neither card', () => {
  const s = screen({ joinState: { approval: true, isAdmitted: true, isPending: false, loaded: true } });
  assert.doesNotMatch(s, /Waiting to be let in/);
  assert.doesNotMatch(s, /Can’t check with your church/);
});

test('a refused proof does NOT say the member is waiting to be let in', () => {
  const s = screen({ joinState: ADMITTED_BUT_REFUSED });
  assert.doesNotMatch(s, /Waiting to be let in/,
    'an admitted member was told her request had been sent and a steward would let her in within a day, ' +
    'because a refused proof empties the gated admitted list and that reads exactly like "not admitted"');
  assert.match(s, /Can’t check with your church/);
});

test('THE FIX: with the clock NOT measured wrong, it does not blame the clock or promise delivery', () => {
  // This is the blocked member. The relay's refusal is identical to the skew case, so the copy must not
  // assert a cause — and must not promise that anything they post will send, because it will not.
  const s = screen({ joinState: ADMITTED_BUT_REFUSED, clockIsWrong: false });
  assert.doesNotMatch(s, /clock is about/,
    'a member the church has BLOCKED is told their clock is wrong and given a number for it');
  assert.doesNotMatch(s, /will send once it reconnects/,
    'a blocked member is promised their posts will send. The relay refuses their every write, so that is ' +
    'a false reassurance handed to the one person it can never come true for.');
  assert.match(s, /speak to whoever runs your church/,
    'with no measured cause, the only honest next step is a person — and it is not offered');
});

test('when the clock IS measured wrong, it says so, with the number', () => {
  const s = screen({ joinState: ADMITTED_BUT_REFUSED, clockIsWrong: true, clockSkewMins: 15, clockSkewAhead: true });
  assert.match(s, /clock is about/, 'the measured cause is not stated, so the member cannot act on it');
  assert.match(s, /15/, 'the measured skew is not shown');
  assert.match(s, /ahead of/, 'the direction is not shown');
  assert.match(s, /will send once it reconnects/,
    'for a genuine clock fault the reassurance IS true and is worth giving');
});
