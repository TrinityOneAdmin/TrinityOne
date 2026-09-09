// A RELAY REFUSING OUR POSTS IS A FAULT, NOT A PAGE: THE BANNER STAYS ON RELAYS, AND IT STILL ARMS THE RETRY.
// Run: node --test scripts/relay-refusal-banner-and-retry-stay-together.test.mjs
//
// 2026-09-09 broke the Relays card into five pages (Relays, Add a relay, Move or copy history, Run your own
// box, Network — reference/SCOPE-SETTINGS-SLICE-1-RELAYS-2026-09-09.md). Seven of the card's eight jobs became
// pages. The eighth did NOT, deliberately: "A relay is refusing our posts — fix it" is a fault, so it stays a
// banner on the page where the fault is visible, and it has to be reachable without hunting — the whole reason
// it exists is that a steward is already confused by the time they need it.
//
// TWO THINGS COULD HAVE BEEN ORPHANED BY THAT MOVE, and both are silent if they are:
//
//   1. THE BANNER. It is gated on a persisted flag, so it renders on no page in the ordinary case. Move it to
//      the wrong page — or to none — and every test that draws Settings stays green: the pages all render,
//      the flag is just never set. The steward's posts stop saving and the one control that fixes it is on a
//      page they will not think to open, or nowhere at all. The relay's own error text sends them to
//      "Settings → Relays and use 'A relay is refusing our posts'" (publishErrorMessage), so Relays is not a
//      preference — it is where the product already promises the control is.
//
//   2. THE FORCED RE-REGISTRATION. noteRelayRejection() does TWO jobs: it raises the banner AND it arms
//      useRegistrationRetry() to call selfRegister with { force: true } on the next mount. Without the force,
//      selfRegister reads a "registered here — done" marker that is written on success and never cleared, so a
//      relay that later LOST the church — reset, restored without its church.json, moved to new hardware — is
//      skipped for ever and the church can never write to it again. The two halves are one mechanism; a change
//      that kept the banner and dropped the arming would look completely fine on screen.
//
// CLAUDE.md rule 3: app/stew-dashboard.jsx ships UNBUNDLED, so `false && ` in front of a condition leaves
// every word of it in place and a text assertion still passes. Nothing here matches text in app/*.jsx. Part 1
// renders the REAL DashSettings through the miniature React in scripts/render-jsx-screen.mjs; Part 2 lifts the
// REAL noteRelayRejection, relayRejectionActive and useRegistrationRetry and RUNS them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileScreen, miniReact, find, texts, button } from './render-jsx-screen.mjs';

const JS = compileScreen('app/stew-dashboard.jsx');

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// A shared console, so the flag Part 2 writes is the same storage Part 1 reads. Everything the screen takes
// from outside its own file; a name it needs that is not here is a ReferenceError at the point of use.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
function console_({ rejected = null, relays = [], steward = {}, React } = {}) {
  const store = new Map();
  const events = [];
  const listeners = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const selfRegisterCalls = [];
  const win = {
    useStewardChurch: () => ({ name: 'Grace Church', npub: 'npub1grace', features: {}, rules: {} }),
    useStewardIdv: () => 0,
    useStewardRelays: () => relays, useStewardNetworks: () => [], useStewardRosters: () => [],
    useStewardMembers: () => [{ pubkey: 'm1' }], useStewardGroups: () => [],
    useStewardAdmitted: () => [], useStewardJoinPolicy: () => false,
    useStewardStats: () => ({}), useStewardActivity: () => [], useStewardRequests: () => [],
    usePendingStewards: () => [],
    Steward: {
      isDelegated: () => false, hasKey: true, hasPinLock: () => false, whereChurchLives: () => 'community',
      relays: () => [], relayStatus: () => ({}), networks: () => [], publishProfile: () => {},
      npub: 'npub1grace', becomeStewardPayload: () => 'x', qrSVG: () => '',
      joinUrl: () => 'https://app.example/join#x', inviteCode: () => 'ABC', joinCode: () => 'ABC',
      ownRelay: () => 'wss://relay.grace.example/relay',
      backupState: async () => ({ boxes: 2, online: 2, syncOn: true }),
      addRelay: () => '', removeRelay: () => {}, rememberRelayName: () => {},
      selfRegister: async (name, opts) => { selfRegisterCalls.push({ name, opts }); return {}; },
      registerWithRelay: async () => {},
      ...steward,
    },
    addEventListener(t, f) { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t).push(f); },
    removeEventListener(t, f) { const a = listeners.get(t) || []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); },
    dispatchEvent(e) { events.push(e && e.type); (listeners.get(e && e.type) || []).slice().forEach(f => f(e)); return true; },
    innerWidth: 1200,
    localStorage,
  };
  const globals = {
    React, window: win,
    location: { host: 'relay.grace.example', hostname: 'relay.grace.example' },
    navigator: { userAgent: '' },
    document: { addEventListener() {}, removeEventListener() {} },
    localStorage, setTimeout, clearTimeout, setInterval, clearInterval, console,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Icon: function Icon() { return null; },
    Halo: function Halo() { return null; },
    SkBadge: function SkBadge() { return null; },
    SkKey: function SkKey() { return null; },
    SkQR: function SkQR() { return null; },
    SkPill: function SkPill() { return null; },
    SK_TINT: { clay: {}, sage: {}, gold: {}, ink: {} },
    DashMealsPanel: function DashMealsPanel() { return null; },
    DashMannaPanel: function DashMannaPanel() { return null; },
    StewVersion: function StewVersion() { return null; },
    NetworkAnnounceComposer: function NetworkAnnounceComposer() { return null; },
    DismissibleNote: function DismissibleNote(p) { return p.children; },
    ConsoleChrome: function ConsoleChrome(p) { return p.children; },
    StewHelpButton: function StewHelpButton() { return null; },
    WizMeetings: function WizMeetings() { return null; },
    _wizMeetingId: () => 'evt1',
    useStewDialog: () => ({ current: null }),
    churchHandle: () => 'grace',
    stewCapState: () => ({ allowed: false }),
  };
  const names = Object.keys(globals);
  const want = ['DashSettings', 'SETTINGS_GROUPS', 'noteRelayRejection', 'relayRejectionActive',
    'clearRelayRejection', 'relaysThatRefused', 'useRegistrationRetry'];
  const mod = new Function(...names, JS + '\nreturn { ' + want.join(', ') + ' };')(...names.map(k => globals[k]));
  for (const n of ['DashSettings', 'noteRelayRejection', 'relayRejectionActive', 'useRegistrationRetry']) {
    assert.equal(typeof mod[n], 'function', `${n} is gone from app/stew-dashboard.jsx — re-anchor this test`);
  }
  if (rejected) mod.noteRelayRejection(rejected);      // the REAL function writes the flag this test reads
  return { mod, win, localStorage, events, selfRegisterCalls };
}

const pages = (mod, delegated = false) => mod.SETTINGS_GROUPS
  .map(([, items]) => items.filter(p => (delegated ? !p.owner : !p.delegate)))
  .reduce((a, b) => a.concat(b), []);

const REFUSED = [{ url: 'wss://relay.grace.example/relay', error: 'not a member of this relay' }];
const RELAYS = [{ url: 'wss://relay.grace.example/relay', status: 'on', ms: 18 }];

function settingsPage(pageKey, over = {}) {
  const { React, draw } = miniReact();
  const c = console_({ React, relays: RELAYS, ...over });
  const render = () => draw(c.mod.DashSettings, { initialSection: pageKey, onSectionConsumed() {} });
  render();
  return { ...c, render, tree: render() };
}

const fixIt = (tree) => button(tree, 'A relay is refusing our posts').filter(b => b.props.onClick);

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// CONTROL — if these fail, every assertion below is meaningless.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('CONTROL: with no rejection recorded, the fix-it control is on no page at all', () => {
  const s = settingsPage('relays');
  assert.equal(s.localStorage.getItem(s.win.REG_NEEDED_LS), null, 'a rejection is recorded when none was made');
  assert.equal(fixIt(s.tree).length, 0,
    'the "a relay is refusing our posts" control renders with no rejection recorded. Pasting a relay admin ' +
    'token hands over the whole relay; it is not something to leave on screen inviting a steward to find one');
  assert.match(texts(s.tree).join(' '), /Where your church publishes/, 'the Relays page did not render');
});

test('CONTROL: the real noteRelayRejection records a rejection the screen can see', () => {
  const c = console_({ React: miniReact().React, rejected: REFUSED });
  assert.equal(c.mod.relayRejectionActive(), true,
    'noteRelayRejection() no longer records anything relayRejectionActive() can read — the banner can never ' +
    'appear again and nothing else in the suite would notice');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 1. THE BANNER IS ON THE RELAYS PAGE, AND ON NO OTHER.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the fix-it control appears on the Relays page once a relay has refused a write', () => {
  const s = settingsPage('relays', { rejected: REFUSED });
  const b = fixIt(s.tree);
  assert.equal(b.length, 1,
    'a relay has refused this church\'s writes and the Relays page does not offer the control that fixes it. ' +
    'The relay error the steward has just seen tells them in so many words to "Open Settings → Relays and use ' +
    '\'A relay is refusing our posts\'", so this is where the product has already promised it is.');
  // …and it opens the admin-token field, which is the whole point of it
  b[0].props.onClick();
  const opened = s.render();
  const token = find(opened, n => n.type === 'input' && n.props['aria-label'] === 'Relay admin token');
  assert.equal(token.length, 1, 'pressing the fix-it control opened no admin-token field, so it does nothing');
});

test('the relay that refused is named on the row, in its own words, on the same page', () => {
  // The banner alone said "a relay refused us"; with two relays listed there was no way to tell which. The
  // row's pill and its tooltip carry the relay's OWN reason, and they must have travelled with the banner.
  const s = settingsPage('relays', { rejected: REFUSED });
  const row = find(s.tree, n => n.type === 'div' && typeof n.props.title === 'string'
    && n.props.title.includes('refused our last change and said'));
  assert.equal(row.length, 1,
    'no relay row carries the refusal in its tooltip. "Answering" is not "accepting": a relay that answers ' +
    'instantly and refuses every write looked identical to a healthy one, and that is what this said');
  assert.match(row[0].props.title, /not a member of this relay/,
    'the row no longer quotes the relay\'s own reason, so the steward is told a refusal happened and not why');
});

test('the fix-it control is on the Relays page and NOWHERE else', () => {
  // A fault is not a page. If this control has been given one of its own, a steward has to know it exists
  // before they can find it — and by the time they need it they are already confused.
  const { React } = miniReact();
  const probe = console_({ React, relays: RELAYS, rejected: REFUSED });
  const elsewhere = [];
  for (const p of pages(probe.mod)) {
    const s = settingsPage(p.k, { rejected: REFUSED });
    if (fixIt(s.tree).length && p.k !== 'relays') elsewhere.push(p.k);
  }
  assert.deepEqual(elsewhere, [],
    'the fix-it control also renders on: ' + elsewhere.join(', ') + '. One fault, one place to fix it');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 2. THE SAME CALL ARMS THE FORCED RE-REGISTRATION. Both halves, run.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('noteRelayRejection arms useRegistrationRetry to force, and a healthy church is not forced', () => {
  for (const [rejected, wantForce, why] of [
    [null, undefined, 'a church nothing has refused takes the ordinary path'],
    [REFUSED, true, 'a church whose relays have refused a write must be re-registered by force'],
  ]) {
    const { React, draw } = miniReact();
    const c = console_({ React, rejected });
    // the REAL hook, mounted in a component of its own so its effect really runs
    draw(function Host() { c.mod.useRegistrationRetry('Grace Church'); return null; }, {});
    assert.equal(c.selfRegisterCalls.length, 1, `selfRegister was called ${c.selfRegisterCalls.length} times — ${why}`);
    const opts = c.selfRegisterCalls[0].opts;
    assert.equal(opts && opts.force, wantForce,
      `${why}: selfRegister was called with ${JSON.stringify(opts)}. selfRegister keeps a "registered here — ` +
      'done" marker that is written on success and NEVER cleared, so without { force: true } a relay that ' +
      'later lost this church is skipped for ever and the church can never write to it again.');
    assert.equal(c.selfRegisterCalls[0].name, 'Grace Church',
      'the retry registers without the church name, which a relay refuses (gateway.mjs H4)');
  }
});

test('the rejection event and the persisted flag are BOTH written by the one call', () => {
  // The banner is raised two ways and needs both: the event for a console that is already open, the flag for
  // the one that opens Settings later — the banner clears itself after 9s and the fix lives on another screen.
  const c = console_({ React: miniReact().React });
  c.events.length = 0;
  c.mod.noteRelayRejection(REFUSED);
  assert.ok(c.events.includes('steward-relay-rejected'),
    'noteRelayRejection no longer fires steward-relay-rejected, so a console already sitting on the Relays ' +
    'page never learns the refusal happened');
  assert.equal(c.mod.relayRejectionActive(), true, 'the flag was not persisted, so reopening Settings shows nothing');
  assert.deepEqual(c.mod.relaysThatRefused().map(r => r.url), REFUSED.map(r => r.url),
    'which relay refused was not recorded, so the page can only show every relay as answering');
});

test('a write landing again clears the fault, and the control goes away with it', () => {
  const s = settingsPage('relays', { rejected: REFUSED });
  assert.equal(fixIt(s.tree).length, 1, 're-anchor: the control did not render in the first place');
  s.win.dispatchEvent(new (class { constructor() { this.type = 'steward-publish-ok'; } })());
  assert.equal(fixIt(s.render()).length, 0,
    'the fix-it control is still on screen after a write landed. The steward may have fixed it another way — ' +
    'restored the key, or the operator added the church — and the alarm must not linger for ever');
  assert.equal(s.mod.relayRejectionActive(), false, 'the persisted flag survived a successful write');
});
