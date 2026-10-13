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
    NETWORKS_ENABLED: true,   // the NETWORKS SWITCH (app/stew-data.jsx): on, because this file counts/opens the Network page; OFF is asserted in settings-cards-sit-in-authored-stacks and settings-pages-are-a-list-and-a-detail
    useStewardChurch: () => ({ name: 'Grace Church', npub: 'npub1grace', features: {}, rules: {} }),
    useStewardIdv: () => 0,
    // `relays` may be a FUNCTION, so a test can change the relay list between draws — the real hook
    // re-probes every 30s and returns a fresh array, and section 5 needs the list to arrive AFTER the
    // first paint. An array still works exactly as before.
    useStewardRelays: () => (typeof relays === 'function' ? relays() : relays), useStewardNetworks: () => [], useStewardRosters: () => [],
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
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
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
    SkPill: function SkPill(p) { return p.children; },   // renders its label, so a test can read a pill off the page
    SK_TINT: { clay: {}, sage: {}, gold: {}, ink: {} },
    DashMealsPanel: function DashMealsPanel() { return null; },
    DashMannaPanel: function DashMannaPanel() { return null; },
    StewVersion: function StewVersion() { return null; },
    NetworkAnnounceComposer: function NetworkAnnounceComposer() { return null; },
    DismissibleNote: function DismissibleNote(p) { return p.children; },
    ConsoleChrome: function ConsoleChrome(p) { return p.children; },
    StewHelpButton: function StewHelpButton() { return null; },
    StewHelpLink: function StewHelpLink() { return null; },   // app/stew-help.jsx; the relay card links its guide (2026-09-21)
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
  // THE SIGNAL IS NOW PER RELAY: the engine says WHICH relay acknowledged (steward-relay-accepted), because a
  // bare steward-publish-ok fires when ANY relay took a write and so cannot say the refusing one is fixed.
  s.win.dispatchEvent(new s.win.CustomEvent('steward-relay-accepted', { detail: { url: REFUSED[0].url } }));
  assert.equal(fixIt(s.render()).length, 0,
    'the fix-it control is still on screen after a write landed. The steward may have fixed it another way — ' +
    'restored the key, or the operator added the church — and the alarm must not linger for ever');
  assert.equal(s.mod.relayRejectionActive(), false, 'the persisted flag survived a successful write');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 4. A REFUSAL ENDS WHEN THAT RELAY TAKES A WRITE. The owner saw "Refused our last change" on a relay for a
//    week while every save to it worked: the flag cleared only on a 7-day timer, or on a publish-ok heard by
//    this page WHILE IT WAS OPEN. Each test renders the real Relays page and reads the pill off it.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const A = 'wss://relay.grace.example/relay';
const B = 'wss://other.example/relay';
const TWO = [{ url: A, status: 'on', ms: 18 }, { url: B, status: 'on', ms: 20 }];
const pillCount = (tree) => texts(tree).filter(t => /Refused our last change/.test(t)).length;
const accepted = (s, url) => s.win.dispatchEvent(new s.win.CustomEvent('steward-relay-accepted', { detail: { url } }));
const twoRelays = (refused) => {
  const { React, draw } = miniReact();
  const c = console_({ React, relays: TWO, rejected: refused });
  const render = () => draw(c.mod.DashSettings, { initialSection: 'relays', onSectionConsumed() {} });
  render();
  return { ...c, render };
};

test('CONTROL: a refusal with no successful write since still shows the pill, on the refusing relay only', () => {
  const s = twoRelays([{ url: A, error: 'blocked: not a member' }]);
  const t = s.render();
  assert.equal(pillCount(t), 1, 'the pill is not on screen for a relay that refused - the alarm itself is gone');
  assert.equal(find(t, n => n.type === 'div' && /refused our last change and said/.test(n.props.title || '')).length, 1);
});

test('a later write that this relay ACCEPTED removes its pill, and the whole alarm with it', () => {
  const s = twoRelays([{ url: A, error: 'blocked: not a member' }]);
  assert.equal(pillCount(s.render()), 1, 're-anchor: no pill to clear');
  accepted(s, A);
  assert.equal(pillCount(s.render()), 0, 'the pill survived a write that relay took - it would stay a week');
  assert.equal(s.mod.relayRejectionActive(), false, 'the global flag outlived the last refusal');
  assert.deepEqual(s.mod.relaysThatRefused(), []);
});

test('the pill clears even when the Relays page was CLOSED at the moment the write landed', () => {
  // the owner's case: the write succeeds on another screen; the page is opened later
  const { React, draw } = miniReact();
  const c = console_({ React, relays: TWO, rejected: [{ url: A, error: 'blocked' }] });
  accepted(c, A);                        // nothing is mounted
  const t = draw(c.mod.DashSettings, { initialSection: 'relays', onSectionConsumed() {} });
  assert.equal(pillCount(t), 0, 'a write made while the page was closed did not clear the refusal');
});

test('a write accepted by the OTHER relay, or an unreachable one, does not clear a relay that refused', () => {
  const s = twoRelays([{ url: A, error: 'blocked: not a member' }]);
  accepted(s, B);
  assert.equal(pillCount(s.render()), 1, 'relay B taking a write cleared relay A, which is still refusing');
  assert.equal(s.mod.relayRejectionActive(), true);
  // a publish-ok with no relay named (fires if ANY relay took it) must not clear it either
  s.win.dispatchEvent(new s.win.CustomEvent('steward-publish-ok', { detail: {} }));
  assert.equal(pillCount(s.render()), 1, 'a bare publish-ok cleared a refusal it cannot attribute');
});

test('with two refusing relays, one accepting leaves the other refusing and the flag standing', () => {
  const s = twoRelays([{ url: A, error: 'blocked' }, { url: B, error: 'blocked' }]);
  assert.equal(pillCount(s.render()), 2, 're-anchor');
  accepted(s, A);
  assert.equal(pillCount(s.render()), 1, 'accepting on A should leave exactly B marked');
  assert.equal(s.mod.relayRejectionActive(), true, 'the flag dropped while a relay still refuses');
  assert.deepEqual(s.mod.relaysThatRefused().map(r => r.url), [B]);
  assert.equal(fixIt(s.render()).length, 1, 'the repair control vanished while a relay still refuses');
  accepted(s, B);
  assert.equal(pillCount(s.render()), 0);
  assert.equal(s.mod.relayRejectionActive(), false);
  assert.equal(s.localStorage.getItem(s.win.REG_REFUSED_LS), null, 'an empty list is left behind');
});

test('the URL is matched normalised: case and a trailing slash do not keep the pill alive', () => {
  const s = twoRelays([{ url: 'WSS://Relay.Grace.Example/relay/', error: 'blocked' }]);
  assert.equal(pillCount(s.render()), 1, 're-anchor: the stored form did not match the row');
  accepted(s, 'wss://relay.grace.example/relay');
  assert.equal(pillCount(s.render()), 0, 'a differently-written address never cleared its refusal');
});

test('an UNREACHABLE relay is not recorded as having refused', () => {
  const s = twoRelays([{ url: A, error: 'blocked: not a member' }, { url: B, error: 'connection failure: connection timed out' }]);
  assert.deepEqual(s.mod.relaysThatRefused().map(r => r.url), [A], 'an offline relay was recorded as refusing');
  assert.equal(pillCount(s.render()), 1);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// 5. AND A REFUSAL GOES WITH THE RELAY IT NAMES. Section 4 made the only exit "THAT relay took a write", which
//    left a refusal whose relay is no longer written to with no exit at all but the 7-day timer. Two ordinary
//    routes in, both measured on the rendered page against the previous commit:
//      · the steward REMOVES the refusing relay with the trash control on this very page — the obvious
//        reaction to the warning — and every later write names only the relays that remain;
//      · a self-hosting church behind a tunnel refuses at one address and its address then churns
//        (reference/RELAY-ADMISSION.md root 3), so the recorded address is never written to again.
//    Either way the red "A relay is refusing our posts" alarm and its admin-token control sat on screen for a
//    week with NO pill on any row to say which relay they were about.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
const GONE = 'wss://removed.example/relay';
// the same page, with the relay list given explicitly (`relays` may be a function — see console_)
const withRelays = (relays, refused) => {
  const { React, draw } = miniReact();
  const c = console_({ React, relays, rejected: refused });
  const render = () => draw(c.mod.DashSettings, { initialSection: 'relays', onSectionConsumed() {} });
  render();
  return { ...c, render };
};

test('T1 a refusing relay the steward REMOVES takes its alarm with it', () => {
  // re-anchor on the same fixture with the relay STILL listed, so this cannot pass on a blank page
  const anchor = withRelays([{ url: GONE, status: 'on', ms: 20 }, { url: B, status: 'on', ms: 20 }],
    [{ url: GONE, error: 'blocked: not a member' }]);
  assert.equal(fixIt(anchor.render()).length, 1, 're-anchor: the control did not render even with the relay listed');
  assert.equal(pillCount(anchor.render()), 1, 're-anchor: no pill rendered even with the relay listed');

  const s = withRelays([{ url: B, status: 'on', ms: 20 }], [{ url: GONE, error: 'blocked: not a member' }]);
  const t = s.render();
  assert.equal(fixIt(t).length, 0,
    'the red alarm and the relay ADMIN-TOKEN control are still on screen for a relay this church no longer ' +
    'publishes to, and no row can explain which relay — for up to seven days, because nothing is ever ' +
    'written to that address again and the TTL is the only exit left');
  assert.equal(pillCount(t), 0, 'a pill is on a row for a relay that is not in the list');
  assert.equal(s.mod.relayRejectionActive(), false, 'the persisted flag outlived the relay it names');
  assert.deepEqual(s.mod.relaysThatRefused(), []);
});

test('T2 a tunnel address that CHURNS leaves no alarm behind at the old address', () => {
  // RELAY-ADMISSION.md root 3: tunnel addresses churn, which is designed-for, not an edge case. A fix wired
  // only to the remove-relay button would pass T1 and fail here.
  const U1 = 'wss://old.ts.net/relay', U2 = 'wss://new.ts.net/relay';
  const s = withRelays([{ url: U2, status: 'on', ms: 20 }, { url: B, status: 'on', ms: 20 }],
    [{ url: U1, error: 'blocked: not a member' }]);
  assert.equal(fixIt(s.render()).length, 0,
    'the alarm stands against an address this church has moved off — and the new address cannot clear it, ' +
    'because the refusal is keyed by the OLD url');
  assert.equal(s.mod.relayRejectionActive(), false);
  accepted(s, U2);
  accepted(s, B);
  assert.equal(fixIt(s.render()).length, 0);
});

test('T3 DO NOT RE-BREAK: a relay still in the list and still refusing KEEPS its pill', () => {
  const s = withRelays(TWO, [{ url: A, error: 'blocked: not a member' }]);
  assert.equal(pillCount(s.render()), 1, 'a live refusal was dropped — the prune is reading the wrong list');
  assert.equal(fixIt(s.render()).length, 1, 'the repair control went while a listed relay still refuses');
  // the 30-second health re-probe hands the card a FRESH array of the same addresses: nothing may change
  const again = withRelays(() => TWO.map(r => ({ ...r })), [{ url: A, error: 'blocked: not a member' }]);
  assert.equal(pillCount(again.render()), 1, 'a re-probe of the same relays dropped a live refusal');
  assert.equal(again.mod.relayRejectionActive(), true);
});

test('T4 DO NOT RE-BREAK: a write accepted by relay B never clears a refusal against relay A', () => {
  // this guards section 4's own fix, which is the thing most likely to be undone by a later edit
  const s = withRelays(TWO, [{ url: A, error: 'blocked: not a member' }]);
  accepted(s, B);
  assert.equal(pillCount(s.render()), 1, 'relay B taking a write cleared relay A, which is still refusing');
  assert.equal(s.mod.relayRejectionActive(), true);
  s.win.dispatchEvent(new s.win.CustomEvent('steward-publish-ok', { detail: {} }));
  assert.equal(pillCount(s.render()), 1, 'a bare publish-ok cleared a refusal it cannot attribute');
  accepted(s, A);
  assert.equal(pillCount(s.render()), 0, 'the relay that refused took a write and kept its pill');
  assert.equal(s.mod.relayRejectionActive(), false);
});

test('T5 one refusal gone with its relay, one still listed: exactly the listed one is kept', () => {
  const s = withRelays([{ url: B, status: 'on', ms: 20 }],
    [{ url: GONE, error: 'blocked: gone' }, { url: B, error: 'blocked: not a member' }]);
  assert.deepEqual(s.mod.relaysThatRefused().map(r => r.url), [B],
    'the whole refusal list was dropped, not just the entries whose relay has left it');
  assert.equal(pillCount(s.render()), 1, 'B is listed and still refusing and has no pill');
  assert.equal(fixIt(s.render()).length, 1, 'the repair control went while B still refuses');
  accepted(s, B);
  assert.equal(pillCount(s.render()), 0);
  assert.equal(s.mod.relayRejectionActive(), false);
  assert.equal(s.localStorage.getItem(s.win.REG_REFUSED_LS), null, 'an empty list is left behind');
});

test('T6 a relay list that has NOT loaded yet is never read as "that relay is gone"', () => {
  // THE COLD-BOOT CASE, and the one that would silently discard a real refusal on every boot. relayStatus()
  // answers over sockets, so the card paints before the list arrives — `status` is [] and the card says
  // "Checking relays…". An empty list means "we do not know yet", never "every relay is gone".
  let live = [];
  const s = withRelays(() => live, [{ url: A, error: 'blocked: not a member' }]);
  assert.equal(fixIt(s.render()).length, 1,
    'a real refusal was discarded while the relay health check had not answered — this happens on every ' +
    'cold open of the Relays page, so the alarm could never be seen at all');
  assert.deepEqual(s.mod.relaysThatRefused().map(r => r.url), [A]);
  live = [{ url: A, status: 'on', ms: 20 }, { url: B, status: 'on', ms: 20 }];
  assert.equal(pillCount(s.render()), 1, 'the list arrived WITH the refusing relay on it and no pill appeared');
  live = [{ url: B, status: 'on', ms: 20 }];
  // TWO DRAWS, and that is the real behaviour rather than a harness quirk: the prune runs in an EFFECT, which
  // React (and this harness) runs after the draw that queued it, so the alarm paints once and is corrected on
  // the next paint. The steward sees it for one frame of the page they just opened, not for seven days.
  s.render();
  assert.equal(fixIt(s.render()).length, 0, 'the relay then left the list and the alarm stayed');
});

test('T7 the stale refusal is DELETED, not merely hidden from the page', () => {
  // A render-time filter over relaysThatRefused() would satisfy T1 while leaving the entry in storage for a
  // week — and relayRejectionActive() is what arms useRegistrationRetry to force selfRegister on every mount.
  const s = withRelays([{ url: B, status: 'on', ms: 20 }], [{ url: GONE, error: 'blocked: not a member' }]);
  s.render();
  assert.equal(s.localStorage.getItem(s.win.REG_REFUSED_LS), null,
    'the refusal is still in storage, so it is only hidden — the forced re-registration keeps firing over a ' +
    'relay this church no longer publishes to');
  assert.equal(s.localStorage.getItem(s.win.REG_NEEDED_LS), null, 'the alarm timestamp is still in storage');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// 6. A SECOND REFUSAL REPAINTS THE PILLS AT ONCE. The alarm flag is already up by then, so setRegNeeded(true)
//    is a no-op and nothing the refusedSet memo watches had moved — the pill stayed on the relay that refused
//    FIRST until the 30-second health probe happened to hand the card a fresh array.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────

test('L2 a second relay refusing while the page is open is marked without waiting for the next probe', () => {
  const s = withRelays(TWO, [{ url: A, error: 'blocked: not a member' }]);
  assert.equal(pillCount(s.render()), 1, 're-anchor: the first refusal is not on screen');
  // the REAL recorder, through the event it raises — the same path the publish-error banner takes. The relay
  // list is deliberately NOT re-probed: `status` keeps its identity, so only the refusal signal can repaint.
  s.mod.noteRelayRejection([{ url: A, error: 'blocked: not a member' }, { url: B, error: 'blocked: not a member' }]);
  assert.equal(pillCount(s.render()), 2,
    'a second relay started refusing and only the FIRST one is marked \u2014 the steward is told the wrong relay is ' +
    'the problem until the 30-second health probe happens to repaint the card');
  assert.deepEqual(s.mod.relaysThatRefused().map(r => r.url), [A, B]);
});
