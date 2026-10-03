// THE INVITE CARD DOES NOT SEND A STEWARD TO A SETTINGS PAGE THAT IS NOT THERE. Sim round 2026-10-02, finding #56.
// Run: node --test scripts/the-invite-card-points-at-a-page-that-exists.test.mjs
//
// When a church's relay is only reachable on this computer, the invite card (JoinCard) says "turn on 'go public' for
// your relay in Settings -> Network & relays". There is no Settings page by that name: the pages are Relays, Add a
// relay, Run your own box and Network, and none of them holds the go-public switch. That switch lives in the relay's
// own control panel under "Reach members from anywhere" (relay-app/control.html, button "Make it public"). It was a dead
// pointer in copy, not a broken link or a routing fault - no route is involved. Both sentences (the banner over the
// link, and the note where the install code should be) now name the control panel and its heading.
//
// Users (rule 2): the two sentences are drawn only by JoinCard (the invite card, reached from Overview, the invite
// dialog and the poster); nothing reads them.
//
// HOW IT ASSERTS (rule 3): the real JoinCard is drawn with a church whose relay is on loopback, and the words on the
// card are read; the page names are read from the real SETTINGS_GROUPS the console navigates by, so "this page does
// not exist" is checked against the thing that decides what exists, not against a list typed here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileScreen, miniReact, texts } from './render-jsx-screen.mjs';

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

function card({ linkPrivate }) {
  const { React, draw } = miniReact();
  const win = {
    useStewardChurch: () => ({ name: 'St Bride’s', npub: 'npub1church', features: {} }),
    Steward: {
      joinUrl: () => 'https://app.example/?follow=npub1church&relay=' + encodeURIComponent('ws://127.0.0.1:8787/relay'),
      joinLinkIsPrivate: () => linkPrivate, qrSVG: () => '', isSelfHosted: () => false, hasKey: true,
    },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, localStorage: { getItem: () => null, setItem() {} },
  };
  const win2 = new Proxy(win, { get(t, k) { if (k in t) return t[k]; if (typeof k === 'string' && k.startsWith('useSteward')) return () => []; return undefined; }, has: () => true });
  const globals = {
    React, window: win2, localStorage: win.localStorage, Icon: Stub('Icon'), SkBadge: Stub('SkBadge'), SkToggle: Stub('SkToggle'), SkPill: Stub('SkPill'), SkConfirm: Stub('SkConfirm'),
    SK_TINT: { clay: {}, gold: {}, sage: {}, ink: {} }, Halo: Stub('Halo'), SkKey: Stub('SkKey'), SkQR: Stub('SkQR'), StewVersion: Stub('StewVersion'),
    DismissibleNote: Stub('DismissibleNote'), StewHelpLink: Stub('StewHelpLink'), DashMealsPanel: Stub('DashMealsPanel'), DashMannaPanel: Stub('DashMannaPanel'),
    NetworkAnnounceComposer: Stub('NetworkAnnounceComposer'), ConsoleChrome: Stub('ConsoleChrome'), StewHelpButton: Stub('StewHelpButton'), WizMeetings: Stub('WizMeetings'),
    _wizMeetingId: () => 'evt1', churchHandle: () => 'grace', stewCapState: () => ({ allowed: false }), useStewDialog: () => ({ current: null }), useStewNarrow: () => false,
    location: { host: 'x', hostname: 'x' }, navigator: { userAgent: '' }, document: { addEventListener() {}, removeEventListener() {} },
    setTimeout, clearTimeout, setInterval, clearInterval, console, fetch: async () => ({ ok: false, json: async () => ({}) }), CustomEvent, copyText() {}, todayISO: () => '2026-10-03',
  };
  const names = Object.keys(globals);
  const mod = new Function(...names, compileScreen('app/stew-dashboard.jsx') + '\nreturn { JoinCard, SETTINGS_GROUPS };')(...names.map(k => globals[k]));
  const tree = draw(mod.JoinCard, {});
  return { text: texts(tree).join(' '), pages: mod.SETTINGS_GROUPS.flatMap(([, items]) => items.map(i => i.n)) };
}

test('the page the card used to name is not a page - the premise of the fix', () => {
  const { pages } = card({ linkPrivate: true });
  assert.ok(!pages.some(n => /Network\s*&\s*relays/i.test(n)), 'a "Network & relays" page now exists: the card may name it again, re-anchor this test');
});

test('the banner over a private link names the relay control panel, not a missing settings page', () => {
  const { text } = card({ linkPrivate: true });
  assert.match(text, /only works on this computer/, 're-anchor: the private-link banner did not render');
  assert.doesNotMatch(text, /Network\s*&\s*relays/i, 'THE DEFECT: the card sends a steward to a Settings page that does not exist');
  assert.match(text, /control panel/i);
  assert.match(text, /Reach members from anywhere/);
});

test('the note where the install code should be says the same', () => {
  const { text } = card({ linkPrivate: false });
  assert.match(text, /can’t install from this machine yet/, 're-anchor: the install note did not render');
  assert.doesNotMatch(text, /Network\s*&\s*relays/i, 'the install note still names the missing page');
  assert.match(text, /control panel/i);
  assert.match(text, /Reach members from anywhere/);
});
