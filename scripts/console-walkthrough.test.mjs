// THE STEWARD CONSOLE HAS A FIRST-RUN TOUR, SECTION TIPS, AND A LOCKED-SECTION TIP FOR HELPERS.
//   Run: node --test scripts/console-walkthrough.test.mjs
//
// app/stew-tour.jsx, mounted by StewDashboard. CLAUDE.md rule 1: the tests below fail if the feature is
// deleted FROM THE SCREEN — the real StewDashboard is compiled with the packaged build's esbuild, drawn
// through the miniature React in scripts/render-jsx-screen.mjs, the wizard / helper welcome is finished by
// calling the handler the dashboard actually gave it, and what is asserted is the bubble that mounted.
// Rule 3: nothing here matches text in a .jsx file; the pure functions are RUN.
//
// ANCHORS ARE READ FROM THE DRAWN TREE. The page's document is a stub whose querySelector('[data-tour="x"]')
// answers from the tree the dashboard last drew, so a step is only shown if the dashboard really rendered its
// anchor — deleting a data-tour attribute from stew-dashboard.jsx makes its step vanish here too.
//
// WHAT IS REAL: help-illustrations, help-data, screens-help, stew-modal (useStewDialog + its document Escape
// handler), stew-help, tour-kit (the shared bubble, 2026-11-18), stew-tour, stew-dashboard — compiled into one function scope, as the browser puts
// classic scripts into one global scope. What is NOT: the modal COUNT. The miniature React never runs effect
// cleanups, so stew-modal's count could only ever go up; the tests drive window.stewModalOpen themselves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { compileScreen, loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const FILES = ['app/help-illustrations.jsx', 'app/help-data.jsx', 'app/screens-help.jsx', 'app/stew-modal.jsx', 'app/stew-help.jsx', 'app/tour-kit.jsx', 'app/stew-tour.jsx', 'app/stew-dashboard.jsx'];
const JS = FILES.map(compileScreen).join('\n;\n');
const WANT = ['StewDashboard', 'StewSetupWizard', 'DelegateBrief', 'StewTourHost', 'stewNav', 'NAV',
  'stewTourPlan', 'tourKitWalk', 'stewTourSectionTip', 'tourKitPlace', 'stewTourStart', 'STEW_TOUR_TIPS', 'STEW_TOUR_STEPS', 'stewTourStore', 'StewTourTip',
  'STEW_TOUR_NAV', 'stewTourMarkTipsSeen'];

// opts: { church, delegate, innerWidth, caps (bool: capabilities allowed), store (a Map to share across boots),
//         helperCaps (a helper's capabilities, e.g. ['members']), failWrites (localStorage.setItem throws, as a full
//         or blocked store does), win (extra window.* hooks), steward (extra window.Steward members) }
function boot(opts = {}) {
  const { React, draw } = miniReact();
  const store = opts.store || new Map();
  const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), removeItem: (k) => { store.delete(k); },
    setItem: (k, v) => { if (opts.failWrites) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } store.set(k, String(v)); } };
  const timers = [];
  const frames = [];   // requestAnimationFrame callbacks, run by show() between its two draws (the next frame)
  // <main data-tour="main">, the console's scroller: its scrollTop is the test's to set (state.mainTop), and
  // a scroll is dispatched to its listeners by h.scrollMain(y).
  const mainListeners = [];
  const state = { tree: null, modal: false, mainTop: 0 };
  const fakeMain = { get scrollTop() { return state.mainTop; }, set scrollTop(v) { state.mainTop = Number(v) || 0; },
    addEventListener(t, f) { if (t === 'scroll') mainListeners.push(f); },
    removeEventListener(t, f) { const i = mainListeners.indexOf(f); if (i >= 0) mainListeners.splice(i, 1); } };
  const winListeners = {}, docListeners = {};
  const fakeEl = { getClientRects: () => [1], getBoundingClientRect: () => ({ left: 20, top: 30, right: 140, bottom: 74, width: 120, height: 44 }), scrollIntoView() {} };
  const doc = {
    addEventListener(t, f) { (docListeners[t] = docListeners[t] || []).push(f); },
    removeEventListener(t, f) { docListeners[t] = (docListeners[t] || []).filter(x => x !== f); },
    activeElement: null,
    // only the tour's anchor lookups are answered, and only from what the dashboard really drew
    querySelector(sel) {
      if (sel === 'main[data-tour="main"]') return state.tree && find(state.tree, n => n.type === 'main' && n.props['data-tour'] === 'main').length ? fakeMain : null;
      const m = /^\[data-tour="([^"]+)"\]$/.exec(sel);
      if (!m || !state.tree) return null;
      return find(state.tree, n => n.props && n.props['data-tour'] === m[1]).length ? fakeEl : null;
    },
  };
  const church = { name: 'Grace Church', npub: 'npub1grace', features: {}, rules: {}, ...(opts.church || {}) };
  const win = {
    useStewardChurch: () => church,
    useStewardIdv: () => 0,
    useStewardRelays: () => [], useStewardNetworks: () => [], useStewardRosters: () => [],
    useStewardMembers: () => [{ pubkey: 'm1' }], useStewardGroups: () => [],
    useStewardAdmitted: () => [], useStewardJoinPolicy: () => false,
    Steward: {
      pubkey: opts.delegate ? 'helperpub' : 'churchpub', actingChurch: opts.delegate ? 'churchpub' : undefined,
      isDelegated: () => !!opts.delegate, myStewardCaps: () => (opts.delegate ? (opts.helperCaps || []) : null),
      hasKey: true, hasPinLock: () => false, whereChurchLives: () => 'community',
      relays: () => [], relayStatus: () => ({}), networks: () => [], publishProfile: () => {},
      npub: 'npub1grace', becomeStewardPayload: () => 'steward-invite-payload', qrSVG: () => '',
      joinUrl: () => 'https://app.example/join#x', inviteCode: () => 'ABC123', joinCode: () => 'ABC123',
      ...(opts.steward || {}),
    },
    useStewardStats: () => ({}), useStewardActivity: () => [], useStewardRequests: () => [],
    addEventListener(t, f) { (winListeners[t] = winListeners[t] || []).push(f); },
    removeEventListener(t, f) { winListeners[t] = (winListeners[t] || []).filter(x => x !== f); },
    dispatchEvent(e) { (winListeners[e.type] || []).slice().forEach(f => f(e)); return true; },
    innerWidth: opts.innerWidth || 1200, innerHeight: 800,
    localStorage: ls,
    ...(opts.win || {}),
  };
  const globals = {
    React, window: win, location: { hostname: 'app.example' }, navigator: { userAgent: '' }, document: doc,
    localStorage: ls, console, Event: class { constructor(type) { this.type = type; } },
    // timers are recorded, never fired on their own: a test fires the one it means
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    setInterval: () => 0, clearInterval() {},
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    Icon: function Icon() { return null; }, Halo: function Halo() { return null; },
    SkBadge: function SkBadge() { return null; }, SkKey: function SkKey() { return null; }, SkQR: function SkQR() { return null; },
    SK_TINT: { clay: { bg: 'a', fg: 'b' }, sage: { bg: 'a', fg: 'b' }, gold: { bg: 'a', fg: 'b' }, ink: { bg: 'a', fg: 'b' } },
    DashMealsPanel: function DashMealsPanel() { return null; }, DashMannaPanel: function DashMannaPanel() { return null; },
    StewVersion: function StewVersion() { return null; }, NetworkAnnounceComposer: function NetworkAnnounceComposer() { return null; },
    ConsoleChrome: function ConsoleChrome(p) { return p.children; },
    churchHandle: () => 'grace',
    _wizMeetingId: () => 'evt1',                               // app/stew-console.jsx (the wizard's starter meetings)
    DashRota: function DashRota() { return null; },            // app/stew-schedule.jsx
    stewCapState: (cap) => ({ allowed: opts.delegate ? (opts.helperCaps || []).includes(cap) : opts.caps !== false }),
    ...(opts.globals || {}),
  };
  const names = Object.keys(globals);
  const mod = new Function(...names, JS + '\nreturn { ' + WANT.join(', ') + ' };')(...names.map(k => globals[k]));
  for (const n of WANT) assert.ok(mod[n] !== undefined, `${n} is missing — re-anchor this test`);
  const realCount = win.stewModalCount;    // stew-modal.jsx's own count, kept for the one test that needs it
  win.stewModalOpen = () => state.modal;   // see the header: the count is driven here
  // …and the count: the dialog the test opened, plus the tour bubble itself while it says it is mounted — what
  // useStewDialog's real count holds in a browser (the bubble registers through it).
  win.stewModalCount = () => (state.modal ? 1 : 0) + (mod.stewTourStore.up ? 1 : 0);
  // Two draws: effects that set state show on the next one, as in React. The tree is kept for querySelector.
  // …with the next frame (requestAnimationFrame) in between, as a browser runs it.
  const flushFrames = () => { for (const f of frames.splice(0)) f(); };
  const show = (props = {}) => { state.tree = draw(mod.StewDashboard, props); flushFrames(); state.tree = draw(mod.StewDashboard, props); return state.tree; };
  const scrollMain = (y) => { state.mainTop = y; mainListeners.slice().forEach(f => f({ type: 'scroll' })); };
  return { mod, win, store, timers, frames, state, docListeners, show, draw, realCount, scrollMain, mainListeners };
}
const bubble = (tree) => find(tree, n => n.props && n.props['data-stew-tour'] === 'bubble')[0] || null;
const tipOf = (tree) => find(tree, n => n.props && n.props['data-stew-tour'] === 'tip')[0] || null;
const titleOf = (b) => { const h = find(b, n => n.type === 'h2')[0]; return h ? texts(h.kids || []).join('') : null; };
// A button's VISIBLE label: its children's text only (texts() also reads string props such as className).
const label = (n) => texts(n.kids || []).join(' ').trim();
const press = (node, want) => {
  const b = find(node, n => n.type === 'button' && label(n) === want)[0];
  assert.ok(b, `no "${want}" button`); b.props.onClick();
};
// Walk the whole tour with Next, collecting each step's title, until it ends.
function walk(h) {
  const seen = [];
  let tree = h.show();
  for (let guard = 0; guard < 40; guard++) {
    const b = bubble(tree);
    if (!b) return seen;
    seen.push(titleOf(b));
    const fwd = find(b, n => n.type === 'button' && /^(Next|Done)$/.test(label(n)));
    assert.equal(fwd.length, 1, 'the bubble has no single Next/Done button');
    press(b, label(fwd[0]));
    tree = h.show();
  }
  throw new Error('the tour never ended');
}
// Part 1 (the Overview's cards), then Part 2 (one step per section in the nav, in the nav's order). This church has
// nobody waiting to join and no verse prompt, so "What needs you" and "Verse prompt" have nothing to point at.
const OWNER_TITLES = ['Welcome', 'Your church’s name', 'Joining code', 'Recent activity',
  'Overview', 'Groups', 'Rota', 'Calendar', 'Rooms', 'Resources', 'Members', 'Settings & Help'];

// ── the premise ────────────────────────────────────────────────────────────────────────────────────────────
test('CONTROL: the console compiles with stew-tour.jsx in its scope and mounts the tour host', () => {
  const h = boot();
  const tree = h.show();
  assert.equal(find(tree, n => n.type === 'nav').length, 1, 'the console did not draw its nav — re-anchor this test');
  assert.equal(find(tree, n => n.type === h.mod.StewTourHost).length, 1, 'StewDashboard does not mount StewTourHost');
  assert.equal(bubble(tree), null, 'the tour showed with nothing asking for it');
});

// ── the two automatic starts, at the point of use ──────────────────────────────────────────────────────────
test('POINT OF USE: finishing the setup wizard starts the tour, and it walks the Overview cards then every section for an owner', () => {
  const h = boot({ church: { name: '' } });
  h.store.set('trinityone.steward.newchurch', '1');
  let tree = h.show();
  const t = h.timers.find(x => x.ms === 1800);
  assert.ok(t, 'the dashboard no longer schedules the wizard — re-anchor this test');
  t.fn();
  tree = h.show();
  const wiz = find(tree, n => n.type === h.mod.StewSetupWizard);
  assert.equal(wiz.length, 1, 'the wizard did not open');
  assert.equal(bubble(tree), null, 'the tour showed before the wizard finished');
  // the harness does not count the wizard as an open dialog, so this is the dashboard's own holdTips at work
  assert.equal(tipOf(tree), null, 'a section tip showed while the setup wizard was open');
  wiz[0].props.onDone();                      // the handler StewDashboard really gave the wizard
  tree = h.show();
  const b = bubble(tree);
  assert.ok(b, 'finishing the wizard did not start the tour');
  assert.equal(titleOf(b), 'Welcome');
  // the counter's kids are [1, ' of ', 12] — joined with '' they are exactly what the browser lays out
  assert.ok(find(b, n => n.type === 'div' && (n.kids || []).join('') === '1 of 12').length === 1, 'the step counter does not read 1 of 12');
  assert.equal(h.store.get('trinityone.steward.tour.churchpub.tour'), '1', 'the tour was not recorded as seen for this church');
  assert.deepEqual(walk(h), OWNER_TITLES);
});

test('POINT OF USE: a helper closing their welcome screen starts the tour, without the steps they cannot use', () => {
  const h = boot({ delegate: true });
  let tree = h.show();
  const brief = find(tree, n => n.type === h.mod.DelegateBrief);
  assert.equal(brief.length, 1, 'the helper welcome screen did not open — re-anchor this test');
  assert.equal(bubble(tree), null);
  brief[0].props.onClose();                   // the handler StewDashboard really gave it
  tree = h.show();
  assert.ok(bubble(tree), 'closing the helper welcome did not start the tour');
  const titles = walk(h);
  // Every capability-gated section is locked for this helper (no capabilities), and a helper cannot rename the church.
  assert.deepEqual(titles, ['Welcome', 'Joining code', 'Recent activity', 'Overview', 'Settings & Help']);
});

// ── L2 (audit 2026-11-19): the wizard's exits do not fight the tour ────────────────────────────────────────
// Open the wizard on a brand-new church through the dashboard's own 1.8 s decision, and return its element.
function openWizard(h) {
  h.store.set('trinityone.steward.newchurch', '1');
  h.show();
  h.timers.find(x => x.ms === 1800).fn();
  const wiz = find(h.show(), n => n.type === h.mod.StewSetupWizard);
  assert.equal(wiz.length, 1, 'premise: the wizard did not open');
  return wiz[0];
}
const tabOf = (tree, h) => find(tree, n => n.type === h.mod.StewTourHost)[0].props.tab;

test('POINT OF USE (L2-a): leaving the wizard by "Relays & settings" starts the tour and stays on Settings (owner, 2026-11-19)', () => {
  const h = boot({ church: { name: '' } });
  const wiz = openWizard(h);
  // what the wizard's "Relays & settings" does (L2-b proves it calls exactly these, in this order)
  wiz.props.onSettings('relays');
  wiz.props.onDone({ keepTab: true });
  const tree = h.show();
  const b = bubble(tree);
  assert.ok(b, 'leaving the wizard by Relays & settings did not start the tour');
  assert.equal(titleOf(b), 'Welcome');
  assert.equal(tabOf(tree, h), 'settings', 'the tour took the steward off the Settings page they chose');
  // CONTROL: "Go to dashboard" (no keepTab) still brings them to Overview, as the tour expects
  const g = boot({ church: { name: '' } });
  const w2 = openWizard(g);
  w2.props.onSettings('relays');
  w2.props.onDone();
  assert.equal(tabOf(g.show(), g), 'overview', 'a plain finish no longer opens Overview for the tour');
});

test('L2: "Skip setup" (which hands finishWizard its click event) starts the tour now, on Overview — an event is not an option', () => {
  const h = boot({ church: { name: '' } });
  const wiz = openWizard(h);
  wiz.props.onDone({ type: 'click', target: {}, currentTarget: {}, preventDefault() {}, stopPropagation() {} });   // a click event's shape
  const tree = h.show();
  assert.ok(bubble(tree), 'a click event passed to finishWizard put the tour off');
  assert.equal(tabOf(tree, h), 'overview');
  assert.equal(h.store.get('trinityone.steward.tour.churchpub.tour'), '1');
});

// The real StewSetupWizard alone, seeded to its last step (scoped as the-suite-first-run-is-one-guided-path.test.mjs
// seeds it: React.useState(0) occurs exactly once inside the component and it is `step`).
function wizardLastStep({ hostname }) {
  const src = read('app/stew-dashboard.jsx');
  const at = src.indexOf('function StewSetupWizard(');
  assert.notEqual(at, -1, 'StewSetupWizard is gone — re-anchor this test');
  const body = src.slice(at, src.indexOf('\nfunction ', at + 1));
  assert.equal((body.match(/React\.useState\(0\)/g) || []).length, 1, 'React.useState(0) is no longer unique inside StewSetupWizard — the seed could be aiming at other state');
  const { React: R, draw } = miniReact();
  const React = { ...R, useState: (init) => (init === 0 ? [6, () => {}] : R.useState(init)) };
  const store = new Map();
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const location = { hostname, host: hostname, href: 'http://' + hostname + '/steward.html' };
  const win = { Steward: { exportMnemonic: () => '', npub: 'npub1x', hasPinLock: () => true, needsPin: false }, addEventListener() {}, removeEventListener() {}, innerWidth: 900, localStorage };
  // stewOnSuite() asks window.Steward.packagedOrigin() and FAILS CLOSED when it is missing, which hid "Back to the Suite".
  // Supply the REAL one (vendor/steward.js _packagedOrigin, lifted over this rig's window + location) - never a bare true/false.
  win.Steward.packagedOrigin = new Function('window', 'location', `return (${fnBody(read('vendor/steward.js'), 'function _packagedOrigin() {', '_packagedOrigin')});`)(win, location);
  const mod = loadScreen('app/stew-dashboard.jsx', ['StewSetupWizard'], {
    React, window: win, location, localStorage, document: { addEventListener() {}, removeEventListener() {} },
    navigator: { userAgent: '' }, setTimeout, clearTimeout, console, fetch: async () => ({ ok: false, json: async () => ({}) }),
    Icon: function Icon() { return null; }, WizMeetings: function WizMeetings() { return null; }, _wizMeetingId: () => 'evt1',
    useStewDialog: () => ({ current: null }), useStewModalOpen: () => {}, stewCapState: () => ({ allowed: false }),
    SkQR: function SkQR() { return null; }, SkPill: function SkPill() { return null; }, SK_TINT: {},
  });
  const calls = [];
  const tree = draw(mod.StewSetupWizard, { church: { name: 'Grace Church' },
    onDone: (o) => calls.push(['done', o === undefined ? undefined : JSON.parse(JSON.stringify(o)), location.href]),
    onTab: (t) => calls.push(['tab', t]), onSettings: (s) => calls.push(['settings', s]), onInvite() {}, onNewPost() {} });
  assert.match(texts(tree).join(' '), /You’re all set/, 'seeding the step did not reach the last step');
  const btn = (label) => find(tree, n => n.type === 'button' && texts(n.kids || []).join(' ').includes(label))[0];
  return { calls, btn, location };
}

test('L2-b: the wizard\'s last step — "Relays & settings" asks to keep the page; "Back to the Suite" defers the tour, then leaves', () => {
  const w = wizardLastStep({ hostname: 'app.example' });
  w.btn('Relays & settings').props.onClick();
  assert.deepEqual(w.calls, [['settings', 'relays'], ['done', { keepTab: true }, 'http://app.example/steward.html']]);
  const s = wizardLastStep({ hostname: '127.0.0.1' });   // the Suite: loopback, no Capacitor
  const back = s.btn('Back to the Suite');
  assert.ok(back, 'premise: no "Back to the Suite" on the Suite');
  back.props.onClick();
  assert.deepEqual(s.calls, [['done', { defer: true }, 'http://127.0.0.1/steward.html']], 'the Suite exit did not ask for the tour to wait, BEFORE leaving');
  assert.equal(s.location.href, '/relay-app/home.html', 'the Suite exit no longer goes to the launcher');
});

test('POINT OF USE (L2-c): leaving by "Back to the Suite" — no tour now; it starts on the next console open, once', () => {
  const h = boot({ church: { name: '' } });
  const wiz = openWizard(h);
  wiz.props.onDone({ defer: true });           // what "Back to the Suite" does before it navigates (L2-b)
  assert.equal(bubble(h.show()), null, 'the tour started on a page that is about to be left');
  assert.equal(h.store.get('trinityone.steward.tour.churchpub.pending'), '1', 'the deferred tour was not recorded');
  assert.equal(h.store.get('trinityone.steward.tour.churchpub.tour') || null, null, 'the deferred tour was spent');
  assert.equal(h.store.get('trinityone.steward.wizard.done'), '1', 'premise: finishing did not mark the wizard done');
  // the next time the console opens
  const again = boot({ store: h.store });
  const b = bubble(again.show());
  assert.ok(b, 'the deferred tour did not start when the console next opened');
  assert.equal(titleOf(b), 'Welcome');
  assert.deepEqual(walk(again), OWNER_TITLES);
  const third = boot({ store: h.store });
  assert.equal(bubble(third.show()), null, 'the deferred tour ran a second time');
});

test('an established church (wizard passed on an earlier version) gets no tour on boot', () => {
  const h = boot();
  h.store.set('trinityone.steward.wizard.done', '1');
  const tree = h.show();
  for (const t of h.timers.filter(x => x.ms === 1800)) t.fn();
  assert.equal(bubble(h.show()), null, 'the tour started for a church that never went through the wizard on this version');
  assert.equal(bubble(tree), null);
});

test('the automatic start happens once per church; Help can replay it', () => {
  const h = boot();
  h.store.set('trinityone.steward.tour.churchpub.tour', '1');
  assert.equal(h.mod.stewTourStart('wizard'), false, 'an automatic start ran a second time');
  assert.equal(bubble(h.show()), null);
  assert.equal(h.mod.stewTourStart('replay'), true);
  assert.ok(bubble(h.show()), 'a replay did not show the tour');
});

// ── never over another dialog; ways out ────────────────────────────────────────────────────────────────────
test('the tour waits while another console dialog is open, then shows', () => {
  const h = boot();
  h.state.modal = true;
  h.mod.stewTourStart('replay');
  assert.equal(bubble(h.show()), null, 'the tour showed over an open dialog');
  h.state.modal = false;
  assert.ok(bubble(h.show()), 'the tour did not show once the dialog closed');
});

test('Escape skips the tour (the real useStewDialog stack)', () => {
  const h = boot();
  h.mod.stewTourStart('replay');
  assert.ok(bubble(h.show()));
  (h.docListeners.keydown || []).forEach(f => f({ key: 'Escape', isComposing: false, preventDefault() {} }));
  assert.equal(bubble(h.show()), null, 'Escape did not close the tour');
});

test('POINT OF USE: Help → "Take the tour again" closes Help and replays the tour', () => {
  const h = boot();
  h.store.set('trinityone.steward.tour.churchpub.tour', '1');
  let tree = h.show();
  find(tree, n => n.type === 'button' && n.props['aria-label'] === 'Help')[0].props.onClick();
  tree = h.show();
  const replay = find(tree, n => n.type === 'button' && n.props['data-help-tour'] === 'replay');
  assert.equal(replay.length, 1, 'the Help dialog has no "Take the tour again" control');
  assert.ok(texts(replay[0]).join(' ').includes('Take the tour again'));
  replay[0].props.onClick();
  tree = h.show();
  assert.equal(find(tree, n => n.props && n.props.role === 'dialog' && n.props['aria-label'] === 'Help').length, 0, 'Help stayed open');
  assert.ok(bubble(tree), 'the tour did not replay');
});

// ── the phone layout ───────────────────────────────────────────────────────────────────────────────────────
test('POINT OF USE: narrow layout — the section steps point at the menu button and say "· in the menu"', () => {
  const h = boot({ innerWidth: 500 });
  h.mod.stewTourStart('replay');
  const titles = walk(h);
  assert.deepEqual(titles, ['Welcome', 'Your church’s name', 'Joining code', 'Recent activity',
    ...['Overview', 'Groups', 'Rota', 'Calendar', 'Rooms', 'Resources', 'Members', 'Settings & Help'].map(t => t + ' · in the menu')]);
  const plan = h.mod.stewTourPlan(h.mod.stewNav(h.mod.NAV, {}, { capState: () => ({ allowed: true }) }), { narrow: true });
  assert.deepEqual(plan.find(s => s.id === 'nav.overview').targets, ['menu']);
  assert.deepEqual(plan.find(s => s.id === 'nav.settings').targets, ['menu'], 'Settings and Help should both collapse onto the one menu button');
  const wide = h.mod.stewTourPlan(h.mod.stewNav(h.mod.NAV, {}, { capState: () => ({ allowed: true }) }), { narrow: false });
  assert.deepEqual(wide.find(s => s.id === 'nav.settings').targets, ['nav-settings', 'help']);
});

test('a step whose anchor is not on screen is skipped, never pointed at', () => {
  const h = boot();
  const plan = h.mod.stewTourPlan(h.mod.stewNav(h.mod.NAV, {}, { capState: () => ({ allowed: true }) }), {});
  const present = (t) => t !== 'joincode';
  const inv = plan.findIndex(s => s.id === 'invite');
  assert.equal(h.mod.tourKitWalk(plan, inv, 1, present), inv + 1);
  assert.equal(h.mod.tourKitWalk(plan, inv, -1, present), inv - 1);
  assert.equal(h.mod.tourKitWalk(plan, plan.length, 1, present), -1);
});

// ── section tips ───────────────────────────────────────────────────────────────────────────────────────────
test('POINT OF USE (L1): a wizard abandoned after its name step does not hold the section tips back for ever', () => {
  // The owner named the church (the wizard publishes the name at its first step), then reloaded before Done: on
  // this boot `newchurch` is still '1' and `wizard.done` is unset, and the wizard will not open over a named church.
  const h = boot({ church: { name: 'Grace Church' } });
  h.store.set('trinityone.steward.newchurch', '1');
  assert.equal(tipOf(h.show()), null, 'a section tip showed in the moment before the wizard could open');
  const t = h.timers.find(x => x.ms === 1800);
  assert.ok(t, 'the dashboard no longer schedules the wizard decision — re-anchor this test');
  t.fn();                                              // the decision: the church has a name, so no wizard
  const tree = h.show();
  assert.equal(find(tree, n => n.type === h.mod.StewSetupWizard).length, 0, 'premise: the wizard opened over a named church');
  const tip = tipOf(tree);
  assert.ok(tip, 'with no wizard coming, the Overview tip is still held back');
  assert.ok(texts(tip).join(' ').includes(h.mod.STEW_TOUR_TIPS.overview.text));
  assert.equal(bubble(tree), null, 'the tour auto-started for an abandoned wizard (owner, 2026-11-19: Help is enough)');
});

test('POINT OF USE: the first visit to a section shows its tip once; Got it dismisses it; a second boot shows nothing', () => {
  const h = boot();
  let tree = h.show();
  const tip = tipOf(tree);
  assert.ok(tip, 'Overview opened for the first time with no tip');
  assert.ok(texts(tip).join(' ').includes(h.mod.STEW_TOUR_TIPS.overview.text));
  press(tip, 'Got it');
  assert.equal(tipOf(h.show()), null, 'Got it did not dismiss the tip');
  const again = boot({ store: h.store });
  assert.equal(tipOf(again.show()), null, 'the Overview tip came back on a second boot of the same device');
});

test('POINT OF USE: a section tip that was drawn but never dismissed comes back next time (seen = Got it, not shown)', () => {
  // The tip is in-flow at the top of <main>, and <main> keeps its scroll across sections, so a steward scrolled
  // down can open a section with its tip above the fold. Marking it seen when DRAWN would lose it unread.
  const h = boot();
  assert.ok(tipOf(h.show()), 'premise: Overview opened for the first time with no tip');
  const again = boot({ store: h.store });
  assert.ok(tipOf(again.show()), 'a tip drawn but never dismissed was spent: it did not come back');
});

test('no section tip while the tour is up, nor while a dialog is open', () => {
  const h = boot();
  h.mod.stewTourStart('replay');
  let tree = h.show();
  assert.ok(bubble(tree));
  assert.equal(tipOf(tree), null, 'a section tip showed under the tour');
  const h2 = boot();
  h2.state.modal = true;
  assert.equal(tipOf(h2.show()), null, 'a section tip showed over an open dialog');
});

test('POINT OF USE: a section the church switched off gets no tip (the console snaps back to Overview)', () => {
  const h = boot({ church: { features: { rota: false } } });
  h.store.set('trinityone.steward.tour.churchpub.tip.overview', '1');
  const tree = h.show({ initial: 'rota' });
  assert.equal(tipOf(tree), null, 'a tip showed for a switched-off section');
  assert.ok(!h.store.has('trinityone.steward.tour.churchpub.tip.rota'), 'a switched-off section had its tip spent');
  // and the tour plan never names it
  const nav = h.mod.stewNav(h.mod.NAV, { features: { rota: false } }, { capState: () => ({ allowed: true }) });
  assert.ok(!nav.some(n => n.key === 'rota'), 'premise: stewNav no longer hides a switched-off section');
  assert.ok(!h.mod.stewTourPlan(nav, {}).some(s => s.id === 'nav.rota'), 'a switched-off section kept its tour step');
  assert.ok(h.mod.stewTourPlan(nav, {}).some(s => s.id === 'nav.groups'), 'premise: Groups has no tour step, so the next line proves nothing');
  const noGroups = nav.filter(n => n.key !== 'groups');
  assert.ok(!h.mod.stewTourPlan(noGroups, {}).some(s => s.id === 'nav.groups'), 'a section missing from the nav kept its tour step');
});

test('POINT OF USE: a helper opening a locked section gets the locked tip, once', () => {
  const h = boot({ delegate: true });
  h.store.set('trinityone.steward.delegatebrief.helperpub', '1');   // welcome already seen
  let tree = h.show({ initial: 'groups' });
  const tip = tipOf(tree);
  assert.ok(tip, 'a helper opened a locked section with no tip');
  assert.ok(texts(tip).join(' ').includes('This part hasn’t been given to you.'), 'the locked tip is not the approved wording');
  press(tip, 'Got it');
  // a second locked section: the locked tip is spent
  const rota = find(h.show({ initial: 'groups' }), n => n.type === 'button' && n.props['data-tour'] === 'nav-rota');
  assert.equal(rota.length, 1, 'the wide nav has no data-tour anchor for Rota');
  rota[0].props.onClick();
  tree = h.show({ initial: 'groups' });
  assert.equal(tipOf(tree), null, 'the locked tip showed a second time');
});

test('an owner never gets the locked tip; Manna never gets a tip; every named section has one', () => {
  const h = boot();
  const tip = h.mod.stewTourSectionTip;
  assert.equal(tip('groups', { locked: true, delegate: false }), null);
  assert.equal(tip('groups', { locked: true, delegate: true }).kind, 'locked');
  assert.equal(tip('groups', { locked: true, delegate: true, seen: (k) => k === 'locked' }), null);
  assert.equal(tip('manna', {}), null, 'Manna has a tip');
  assert.equal(tip('manna', { locked: true, delegate: true }), null, 'Manna has a locked tip');
  assert.deepEqual(Object.keys(h.mod.STEW_TOUR_TIPS).sort(),
    ['calendar', 'checkin', 'finance', 'groups', 'meals', 'members', 'overview', 'resources', 'rooms', 'rota', 'settings']);
  assert.equal(h.mod.STEW_TOUR_TIPS.meals.title, 'Care');
  assert.equal(tip('rota', { seen: (k) => k === 'tip.rota' }), null, 'a seen tip showed again');
  assert.equal(tip('rota', {}).kind, 'section');
});

test('the bubble stays inside a 16px gutter at phone width', () => {
  const h = boot();
  const vp = { w: 390, h: 800 }, size = { w: 320, h: 190 };
  for (const rect of [null, { left: 4, top: 4, right: 48, bottom: 48, width: 44, height: 44 }, { left: 300, top: 700, right: 390, bottom: 760, width: 90, height: 60 }]) {
    const p = h.mod.tourKitPlace(rect, size, vp);
    assert.ok(p.left >= 16 && p.left + size.w <= vp.w - 16, `left ${p.left} out of the gutter for ${JSON.stringify(rect)}`);
    assert.ok(p.top >= 16 && p.top + size.h <= vp.h - 16, `top ${p.top} out of the gutter for ${JSON.stringify(rect)}`);
  }
});

// ── 2026-11-19 audit fixes ─────────────────────────────────────────────────────────────────────────────────
test('POINT OF USE: with a store that refuses writes, "Got it" still dismisses a section tip for good', () => {
  const h = boot({ failWrites: true });
  let tip = tipOf(h.show());
  assert.ok(tip, 'premise: Overview opened for the first time with no tip');
  assert.equal(h.store.size, 0, 'premise: the store took a write it was meant to refuse');
  press(tip, 'Got it');
  for (let i = 0; i < 3; i++) assert.equal(tipOf(h.show()), null, 'the tip came back after Got it because its seen-flag could not be stored');
});

// The Members panel itself is not under test here (only the tip drawn above it): its own components are stubbed.
const MEMBERS_STUBS = Object.fromEntries(['SkPill'].map(n => [n, Object.defineProperty(function () { return null; }, 'name', { value: n })]));
const helperBoot = (caps) => { const h = boot({ delegate: true, helperCaps: caps, globals: MEMBERS_STUBS }); h.store.set('trinityone.steward.delegatebrief.helperpub', '1'); return h; };
const tipText = (tree) => { const t = tipOf(tree); return t ? texts(t.kids || []).join(' ') : null; };
test('POINT OF USE: a helper is told the helper words on the Settings tip; an owner the owner words', () => {
  const T = boot().mod.STEW_TOUR_TIPS.settings;
  assert.ok(T.helperText && T.helperText !== T.text, 'premise: Settings has no separate helper words');
  const helper = tipText(helperBoot([]).show({ initial: 'settings' }));
  assert.ok(helper, 'a helper opening Settings got no tip');
  assert.ok(helper.includes('Some settings here belong to whoever holds the church key.'), 'the helper was not given the helper words: ' + helper);
  assert.ok(!helper.includes(T.text), 'the helper was told the owner-only words');
  const owner = tipText(boot().show({ initial: 'settings' }));
  assert.ok(owner && owner.includes(T.text), 'the owner was not told the owner words');
  assert.ok(!owner.includes(T.helperText), 'the owner was given the helper words');
});

test('POINT OF USE: a helper holding Members is told only what they can do on the Members tip', () => {
  const T = boot().mod.STEW_TOUR_TIPS.members;
  const helper = tipText(helperBoot(['members']).show({ initial: 'members' }));
  assert.ok(helper, 'a helper with the members capability opened Members with no tip');
  assert.ok(helper.includes('Approve new people.'), 'the helper was not given the helper words: ' + helper);
  assert.ok(!/children|helpers/.test(helper), 'a helper was told they can mark children or add helpers (the relay refuses both)');
  const owner = tipText(boot({ globals: MEMBERS_STUBS }).show({ initial: 'members' }));
  assert.ok(owner && owner.includes(T.text), 'the owner was not told the owner words');
});

test('POINT OF USE: the tour\'s Settings and Help step tells a helper the helper words, an owner the owner words', () => {
  const stepText = (h) => {
    h.mod.stewTourStart('replay');
    let tree = h.show();
    for (let g = 0; g < 40; g++) {
      const b = bubble(tree);
      assert.ok(b, 'the tour ended before Settings and Help');
      if (titleOf(b) === 'Settings & Help') return texts(find(b, n => n.type === 'p')[0].kids || []).join('');
      press(b, 'Next');
      tree = h.show();
    }
    throw new Error('the tour never reached Settings and Help');
  };
  const S = boot().mod.STEW_TOUR_NAV.settings;
  assert.equal(stepText(helperBoot([])), 'Stuck? Help is here, and so is this tour.');
  assert.equal(stepText(boot()), S.text);
  assert.notEqual(S.text, 'Stuck? Help is here, and so is this tour.', 'premise: the owner and helper words are the same');
});

test('POINT OF USE: the tour\'s Members step tells a helper holding Members only what they can do; an owner the owner words', () => {
  const stepText = (h) => {
    h.mod.stewTourStart('replay');
    let tree = h.show();
    for (let g = 0; g < 40; g++) {
      const b = bubble(tree);
      assert.ok(b, 'the tour ended before Members');
      if (titleOf(b) === 'Members') return texts(find(b, n => n.type === 'p')[0].kids || []).join('');
      press(b, 'Next');
      tree = h.show();
    }
    throw new Error('the tour never reached Members');
  };
  const S = boot().mod.STEW_TOUR_NAV.members;
  assert.equal(stepText(helperBoot(['members'])), 'Everyone who has joined.');
  assert.equal(stepText(boot()), S.text);
});

test('the tour hides while a dialog opens over it, and comes back at the same step — not ended, not restarted', () => {
  const h = boot();
  h.mod.stewTourStart('replay');
  let tree = h.show();
  press(bubble(tree), 'Next');
  tree = h.show();
  const at = titleOf(bubble(tree));
  assert.equal(at, 'Your church’s name', 'premise: Next did not move to step 2');
  h.state.modal = true;                                   // a console dialog opens mid-tour
  assert.equal(bubble(h.show()), null, 'the tour stayed up over a dialog that opened while it ran');
  assert.equal(bubble(h.show()), null);
  h.state.modal = false;
  assert.equal(titleOf(bubble(h.show())), at, 'the tour did not come back at the step it was on');
});

test('the running tour does not hide behind ITSELF (stew-modal.jsx\'s real count holds the bubble)', () => {
  const h = boot();
  h.win.stewModalCount = h.realCount;                     // the real count: the bubble registers through useStewDialog
  h.mod.stewTourStart('replay');
  assert.ok(bubble(h.show()), 'premise: the tour did not show');
  assert.ok(h.realCount() >= 1, 'premise: the bubble is not in stew-modal.jsx\'s count');
  for (let i = 0; i < 3; i++) assert.ok(bubble(h.show()), 'the tour hid because it counted its own bubble as another dialog');
});

// In the flow when <main> is at its top (the usual case): it pushes the section down and covers nothing in it. The
// one exception — a section opened already scrolled, where it floats until <main> is back at its top — is the next test.
test('the section tip is drawn in the flow of <main>, ahead of the section, when <main> is at its top — it does not sit over sign-ups or Approve', () => {
  const h = boot();
  const tree = h.show();
  const main = find(tree, n => n.type === 'main' && n.props['data-tour'] === 'main')[0];
  assert.ok(main, 'premise: no <main data-tour="main">');
  const tip = tipOf(main);
  assert.ok(tip, 'the Overview tip is not inside <main>');
  const pos = (tip.props.style || {}).position;
  assert.ok(pos !== 'fixed' && pos !== 'absolute', 'the tip is positioned over the page (' + pos + '), so it can cover what the section puts at its top');
  // and it comes before the section in <main>: the Overview is drawn after it, so it is pushed down, not covered
  const order = find(main, n => n === tip || (n.props && n.type && n.type.name === 'DashOverview'));
  assert.equal(order[0], tip, 'the tip is not ahead of the Overview in <main>');
  assert.equal(order.length, 2, 'premise: the Overview is not drawn in <main>');
});

test('POINT OF USE (P2): a section opened with <main> already scrolled gets a FLOATING tip; back at the top, it drops into the flow', () => {
  const h = boot();
  h.store.set('trinityone.steward.tour.churchpub.tip.overview', '1');   // Overview's tip already read
  h.show();
  h.state.mainTop = 300;                                // the steward has scrolled down Overview
  const navBtn = (tree, label) => find(tree, n => n.type === 'button' && n.props['data-tour'] === 'nav-' + label)[0];
  navBtn(h.state.tree, 'groups').props.onClick();       // and opens Groups: <main> keeps its scroll
  let tree = h.show();
  const floatHolder = find(tree, n => n.props && n.props['data-stew-tour-float'] === '1')[0];
  assert.ok(floatHolder, 'a section opened scrolled drew its tip in the flow, above what is in view (out of sight; Chromium also moves the view by its height)');
  assert.equal(floatHolder.props.style.position, 'sticky');
  assert.equal(floatHolder.props.style.height, 0, 'the floating holder takes up height, so the page under it moves');
  assert.ok(tipOf(floatHolder), 'the tip card is not inside the floating holder');
  assert.equal(h.mainListeners.length, 1, 'a floating tip does not watch <main> for the return to the top');
  // the steward scrolls back to the top: the tip goes into the flow, so it no longer covers the section's top
  h.scrollMain(0);
  tree = h.show();
  assert.equal(find(tree, n => n.props && n.props['data-stew-tour-float'] === '1').length, 0, 'back at the top of <main>, the tip still floats over the section');
  assert.ok(tipOf(tree), 'the tip went away instead of dropping into the flow');
  // (the listener's removal is an effect cleanup, which the miniature React never runs — not provable here)
  // CONTROL: at the top of <main> a section's tip is in the flow from the start
  const g = boot();
  const t0 = g.show();
  assert.ok(tipOf(t0), 'premise: no Overview tip');
  assert.equal(find(t0, n => n.props && n.props['data-stew-tour-float'] === '1').length, 0, 'a tip floated with <main> at its top');
});

test('POINT OF USE (P2, stage-4 audit): a tip never floats over the section\'s own top — a small offset docks it and puts <main> at its top', () => {
  // The card cannot be measured here (no layout), so the room is STEW_TOUR_TIP_ROOM (160px); in a browser it is the
  // card's measured height + 22px. The miniature React runs layout effects as ordinary effects, so ONE draw shows
  // the float before it docks; a browser docks before it paints (a-settings-page-opens-at-its-top proves that).
  const h = boot();
  h.store.set('trinityone.steward.tour.churchpub.tip.overview', '1');
  h.show();
  h.state.mainTop = 20;                                   // a section opened just below its top
  find(h.state.tree, n => n.type === 'button' && n.props['data-tour'] === 'nav-groups')[0].props.onClick();
  h.show();
  let tree = h.show();
  assert.ok(tipOf(tree), 'premise: no Groups tip');
  assert.equal(find(tree, n => n.props && n.props['data-stew-tour-float'] === '1').length, 0, 'at a 20px offset the tip floats over the top of the section');
  assert.equal(h.state.mainTop, 0, 'docking at a small offset did not put <main> at its top');
  // floating at 300, then a scroll back up that stops short of 0 (touch momentum) — still within the card's room
  const g = boot();
  g.store.set('trinityone.steward.tour.churchpub.tip.overview', '1');
  g.show();
  g.state.mainTop = 300;
  find(g.state.tree, n => n.type === 'button' && n.props['data-tour'] === 'nav-groups')[0].props.onClick();
  tree = g.show();
  assert.ok(find(tree, n => n.props && n.props['data-stew-tour-float'] === '1').length, 'premise: at 300px the tip does not float');
  g.scrollMain(200);                                      // still well down: stays floating
  assert.ok(find(g.show(), n => n.props && n.props['data-stew-tour-float'] === '1').length, 'a scroll that stayed well down docked the tip');
  g.scrollMain(50);                                       // stopped 50px short of the top
  tree = g.show();
  assert.equal(find(tree, n => n.props && n.props['data-stew-tour-float'] === '1').length, 0, 'stopping 50px from the top left the tip floating over the section\'s first cards');
  assert.equal(g.state.mainTop, 0, 'docking did not put <main> at its top');
});

// ── 2026-11-22: the detailed tour — Overview card by card, then every section ───────────────────────────────
// A nav with every optional section on (Check-in, Finance, Manna, Care), built by the console's own stewNav.
const fullNav = (h, capState) => h.mod.stewNav(h.mod.NAV, { features: { checkin: true } },
  { finOn: true, mannaOn: true, mealsOn: true, checkinOn: true, capState: capState || (() => ({ allowed: true })) });
const NAV_WORDS = {
  overview: 'The page you just saw. Start here each time you open the console.',
  members: 'Everyone who has joined. Mark who is a child, and which adults are cleared to work with them. The safety rules then apply on their own.',
  groups: 'Chat rooms and announcement channels. Choose which are open, invite-only, or safe for children.',
  rota: 'Build serving teams, then fill the dates. People get a “Can you serve?” request and answer from their phone.',
  calendar: 'Services, events and socials. Members see them in their app and can say they’re coming.',
  rooms: 'The rooms in your building. Add them, then book one when you add an event.',
  resources: 'Reading plans, devotionals, sermons, and the verse prompt your members see.',
  meals: 'Meal trains, lifts and errands. Set up a need, and members sign up to help.',
  checkin: 'The children’s register. Sign children in and out at the door, and see who’s in the room.',
  finance: 'Record giving and spending, import a bank statement, and share a summary with the church.',
  settings: 'Switch sections on or off, back up the church, and choose where its data lives. Stuck? Help is here, and so is this tour.',
};
const PART1 = [
  ['welcome', 'Welcome', [], 'Your church is ready. Here’s a proper look around — a couple of minutes, and you can stop any time.'],
  ['identity', 'Your church’s name', ['identity'], 'This is your church. Tap the name to change it. If you also help run a network or another church, switch to it from here.'],
  ['needs', 'What needs you', ['needs'], 'Anything waiting on you shows here first — new people asking to join, and clearances coming up for renewal. Clear this and you’re up to date.'],
  ['verse', 'Verse prompt', ['verse'], 'A verse goes out to everyone’s phone each day. This shows what’s scheduled — change it under Resources.'],
  ['invite', 'Joining code', ['joincode'], 'This is how people join. Share the code or QR: they scan it or type it into the TrinityOne app.'],
  ['activity', 'Recent activity', ['activity'], 'A running list of what’s happened lately — who joined, what was posted, what changed across the church.'],
];

test('the plan (desktop): the Overview cards, then one step per section in the nav\'s order — Manna and locked sections dropped', () => {
  const h = boot();
  const nav = fullNav(h);
  const keys = nav.map(n => n.key);
  assert.deepEqual(keys, ['overview', 'groups', 'rota', 'calendar', 'rooms', 'resources', 'members', 'checkin', 'finance', 'manna', 'meals', 'settings'],
    'premise: stewNav no longer builds this nav — re-anchor this test');
  const plan = h.mod.stewTourPlan(nav, {});
  const walked = keys.filter(k => k !== 'manna');
  assert.deepEqual(plan.map(s => s.id), [...PART1.map(p => p[0]), ...walked.map(k => 'nav.' + k)]);
  // Part 1: the approved words, each at its own anchor
  PART1.forEach(([id, title, targets, text], i) => {
    assert.equal(plan[i].title, title);
    assert.deepEqual(plan[i].targets, targets, id + ' points at the wrong anchor');
    assert.equal(plan[i].text, text, id + ' does not carry the approved words');
  });
  // Part 2: each section at its own sidebar row, named as the sidebar names it, with the approved words
  const labelOf = Object.fromEntries(nav.map(n => [n.key, n.label]));
  for (const k of walked) {
    const s = plan.find(x => x.id === 'nav.' + k);
    assert.equal(s.targets[0], 'nav-' + k, k + ' does not point at its sidebar row');
    assert.equal(s.title, k === 'settings' ? 'Settings & Help' : labelOf[k]);
    assert.equal(s.text, NAV_WORDS[k], k + ' does not carry the approved words');
  }
  assert.equal(plan.find(x => x.id === 'nav.meals').title, 'Care');
  // a helper holding only Members: no church-name step, the helper words, and nothing for a section locked to them
  const helperNav = fullNav(h, (cap) => ({ allowed: cap === 'members' }));
  const lockedKeys = helperNav.filter(n => n.locked).map(n => n.key);
  assert.deepEqual(lockedKeys, ['groups', 'rota', 'calendar', 'rooms', 'resources', 'checkin', 'meals'], 'premise: stewNav no longer locks these for a members-only helper');
  const hp = h.mod.stewTourPlan(helperNav, { delegate: true });
  assert.deepEqual(hp.map(s => s.id), ['welcome', 'needs', 'verse', 'invite', 'activity', 'nav.overview', 'nav.members', 'nav.finance', 'nav.settings']);
  assert.equal(hp.find(s => s.id === 'nav.members').text, 'Everyone who has joined.');
  assert.equal(hp.find(s => s.id === 'nav.settings').text, 'Stuck? Help is here, and so is this tour.');
  assert.equal(hp.find(s => s.id === 'nav.overview').text, NAV_WORDS.overview);
});

test('the plan (narrow): every section step points at the menu button and says "· in the menu"; the card steps keep their Overview anchors', () => {
  const h = boot();
  const nav = fullNav(h);
  const plan = h.mod.stewTourPlan(nav, { narrow: true });
  const walked = nav.filter(n => n.key !== 'manna');
  assert.deepEqual(plan.map(s => s.id), [...PART1.map(p => p[0]), ...walked.map(n => 'nav.' + n.key)]);
  PART1.forEach(([id, title, targets], i) => {
    assert.equal(plan[i].title, title, id + ' gained a menu suffix it should not have');
    assert.deepEqual(plan[i].targets, targets, id + ' does not point at its Overview anchor on a phone');
  });
  for (const n of walked) {
    const s = plan.find(x => x.id === 'nav.' + n.key);
    assert.deepEqual(s.targets, ['menu'], n.key + ' does not point at the menu button on a phone');
    assert.equal(s.title, (n.key === 'settings' ? 'Settings & Help' : n.label) + ' · in the menu');
    assert.equal(s.text, NAV_WORDS[n.key]);
  }
});

// A church with one person waiting to join (approval on, nobody admitted) and a verse prompt out.
const busyBoot = (opts = {}) => boot({ globals: MEMBERS_STUBS, ...opts,
  win: { useStewardJoinPolicy: () => true },
  steward: { subscribeVersePrompt: (cb) => { cb({ ref: 'John 3:16' }); return () => {}; } } });
const anchored = (tree, name) => find(tree, n => n.props && n.props['data-tour'] === name);

test('POINT OF USE: the Overview draws the anchors the card steps point at — needs, verse, joincode, activity — each on its own card', () => {
  const h = busyBoot();
  const tree = h.show();
  const said = (n) => texts(n.kids || []).join(' ');
  const needs = anchored(tree, 'needs');
  assert.equal(needs.length, 1, 'the "waiting to join" card has no data-tour="needs" anchor');
  assert.ok(/1\s+person is\s+waiting to join/.test(said(needs[0])), 'data-tour="needs" is not on the waiting-to-join card: ' + said(needs[0]));
  const verse = anchored(tree, 'verse');
  assert.equal(verse.length, 1, 'the verse prompt card has no data-tour="verse" anchor');
  assert.ok(said(verse[0]).includes('John 3:16'), 'data-tour="verse" is not on the verse prompt card');
  const activity = anchored(tree, 'activity');
  assert.equal(activity.length, 1, 'the Recent activity card has no data-tour="activity" anchor');
  assert.deepEqual(find(activity[0], n => n.type === 'h2').map(said), ['Recent activity'], 'data-tour="activity" is not on the Recent activity card alone');
  assert.equal(anchored(tree, 'joincode').length, 1, 'the Joining code card has no data-tour="joincode" anchor');
  // decision B: the Groups & rooms card is not a tour stop, and a card that passes no anchor draws none
  const groupsCard = find(tree, n => n.type === 'div' && n.props.className === 'sk-panel' && find(n, x => x.type === 'h2' && said(x) === 'Groups & rooms').length === 1);
  assert.equal(groupsCard.length, 1, 'premise: the Groups & rooms card is not drawn — re-anchor this test');
  assert.equal(groupsCard[0].props['data-tour'], undefined, 'the Groups & rooms card gained a tour anchor');
  // the same four on a phone, where the Overview is laid out by a different branch
  const phone = busyBoot({ innerWidth: 500 }).show();
  for (const a of ['needs', 'verse', 'joincode', 'activity']) assert.equal(anchored(phone, a).length, 1, 'the phone Overview has no data-tour="' + a + '" anchor');
});

test('POINT OF USE: with someone waiting and a verse out, the tour stops at "What needs you" and "Verse prompt" too, in order', () => {
  const h = busyBoot();
  h.mod.stewTourStart('replay');
  h.show();
  // The host counts the steps whose anchor is in the tree drawn BEFORE this one (the stub document answers from the
  // last finished draw), and the verse card only appears once its subscription has answered — so draw once more.
  let tree = h.show();
  assert.ok(find(bubble(tree), n => n.type === 'div' && (n.kids || []).join('') === '1 of 14').length === 1, 'the step counter does not read 1 of 14');
  assert.deepEqual(walk(h), ['Welcome', 'Your church’s name', 'What needs you', 'Verse prompt', 'Joining code', 'Recent activity',
    'Overview', 'Groups', 'Rota', 'Calendar', 'Rooms', 'Resources', 'Members', 'Settings & Help']);
  // CONTROL: nobody waiting, no verse — those two cards are not drawn, so the tour neither counts nor shows them
  const g = boot();
  g.mod.stewTourStart('replay');
  tree = g.show();
  assert.equal(anchored(tree, 'needs').length + anchored(tree, 'verse').length, 0, 'premise: a quiet church drew a needs or verse card');
  const titles = walk(g);
  assert.ok(!titles.includes('What needs you') && !titles.includes('Verse prompt'), 'the tour pointed at a card that is not on screen');
  assert.equal(titles.length, 12);
});

// ── decision A (owner, 2026-11-22): once the tour is FINISHED, the first-open section tips do not fire ───────
const flagOf = (h, k) => h.store.get('trinityone.steward.tour.churchpub.' + k) === '1';
const openSection = (h, key) => { find(h.state.tree, n => n.type === 'button' && n.props['data-tour'] === 'nav-' + key)[0].props.onClick(); return h.show(); };

test('POINT OF USE: finishing the tour (Next to the end, then Done) spends every section tip; no "Got it" tip follows', () => {
  const h = boot();
  h.mod.stewTourStart('replay');
  h.show();
  assert.equal(flagOf(h, 'tip.overview'), false, 'premise: a tip was spent before the tour finished');
  assert.equal(walk(h).length, 12, 'premise: the tour did not run to its end');
  for (const k of ['overview', 'groups', 'rota', 'calendar', 'rooms', 'resources', 'members', 'settings']) assert.ok(flagOf(h, 'tip.' + k), 'finishing the tour left the ' + k + ' tip unspent');
  assert.ok(flagOf(h, 'locked'), 'finishing the tour left the locked-section tip unspent');
  assert.equal(tipOf(h.show()), null, 'the Overview tip showed after the tour was finished');
  assert.equal(tipOf(openSection(h, 'groups')), null, 'the Groups tip showed after the tour was finished');
  assert.equal(tipOf(openSection(h, 'rota')), null, 'the Rota tip showed after the tour was finished');
  // CONTROL, same route with no tour: opening Groups for the first time does show its tip
  const c = boot();
  c.store.set('trinityone.steward.tour.churchpub.tip.overview', '1');
  c.show();
  assert.ok(tipOf(openSection(c, 'groups')), 'premise: with no tour taken, Groups opened with no tip');
});

test('POINT OF USE: SKIPPING the tour spends no section tip — they still show, whether skipped at the first step or the last', () => {
  const h = boot();
  h.mod.stewTourStart('replay');
  press(bubble(h.show()), 'Skip tour');
  let tree = h.show();
  assert.equal(bubble(tree), null, 'premise: Skip tour did not close the tour');
  assert.deepEqual([...h.store.keys()].filter(k => /\.tip\.|\.locked$/.test(k)), [], 'skipping the tour spent a section tip');
  assert.ok(tipOf(tree), 'after skipping the tour, the Overview tip did not show');
  // skipped on the very last step: still a skip
  const g = boot();
  g.mod.stewTourStart('replay');
  tree = g.show();
  for (let i = 0; i < 40; i++) { if (find(bubble(tree), n => n.type === 'button' && label(n) === 'Done').length) break; press(bubble(tree), 'Next'); tree = g.show(); }
  assert.equal(titleOf(bubble(tree)), 'Settings & Help', 'premise: did not reach the last step');
  press(bubble(tree), 'Skip tour');
  assert.equal(bubble(g.show()), null);
  assert.deepEqual([...g.store.keys()].filter(k => /\.tip\.|\.locked$/.test(k)), [], 'skipping at the last step spent the section tips');
});

// Audit L4 (2026-11-22): a section LOCKED to a helper gets no tour step, so the tour has not covered it.
test('POINT OF USE (L4): a helper finishing the tour spends the tips of the sections they were walked through, and keeps the tip of a locked one', () => {
  const h = helperBoot(['members']);
  h.mod.stewTourStart('replay');
  h.show();
  const titles = walk(h);
  assert.ok(titles.includes('Members'), 'premise: the helper was not walked through Members: ' + titles.join(', '));
  assert.ok(!titles.includes('Groups'), 'premise: the helper was walked through Groups, which is locked to them');
  assert.equal(titles[titles.length - 1], 'Settings & Help', 'premise: the tour did not run to its end');
  assert.ok(flagOf(h, 'tip.members'), 'finishing the tour left the Members tip unspent');
  assert.ok(flagOf(h, 'tip.overview'), 'finishing the tour left the Overview tip unspent');
  for (const k of ['groups', 'rota', 'calendar', 'rooms', 'resources']) assert.equal(flagOf(h, 'tip.' + k), false, 'finishing the tour spent the tip of ' + k + ', a locked section the tour never showed');
  assert.ok(flagOf(h, 'locked'), 'finishing the tour left the locked-section tip unspent');
  // so a helper later given that section still gets its tip, once: the same store, now holding Content
  const later = boot({ delegate: true, helperCaps: ['members', 'content'], globals: MEMBERS_STUBS, store: h.store });
  const tip = tipOf(later.show({ initial: 'groups' }));
  assert.ok(tip, 'a helper given Groups after finishing the tour opened it with no tip');
  assert.ok(texts(tip).join(' ').includes(later.mod.STEW_TOUR_TIPS.groups.text), 'the tip shown is not the Groups tip');
});

test('stewTourMarkTipsSeen spends the tip of every section in the nav, and the locked tip — and of no section outside it', () => {
  const h = boot({ delegate: true });
  const seen = (k) => h.store.get('trinityone.steward.tour.churchpub.' + k) === '1';   // the flags as the store really holds them
  const tip = h.mod.stewTourSectionTip;
  const nav = fullNav(h).filter(n => n.key !== 'rota');   // a church with Rota switched off
  const keys = nav.map(n => n.key).filter(k => k !== 'manna');
  for (const k of keys) assert.ok(tip(k, { seen }), 'premise: ' + k + ' has no tip before the tour');
  assert.ok(tip('groups', { locked: true, delegate: true, seen }), 'premise: no locked tip before the tour');
  h.mod.stewTourMarkTipsSeen('churchpub', nav);
  for (const k of keys) assert.equal(tip(k, { seen }), null, 'the ' + k + ' tip still shows after the tour');
  assert.equal(tip('groups', { locked: true, delegate: true, seen }), null, 'the locked tip still shows after the tour');
  // a section switched on AFTER the tour has no flag: its tip shows once (it is new to them)
  assert.ok(tip('rota', { seen }), 'a section that was not in the nav had its tip spent');
  // per church: another church's flags are untouched
  assert.ok(![...h.store.keys()].some(k => !k.startsWith('trinityone.steward.tour.churchpub.')), 'marking wrote outside this church\'s flags');
});

// ── the shell ──────────────────────────────────────────────────────────────────────────────────────────────
test('steward.html loads stew-tour.jsx after stew-modal.jsx and before stew-dashboard.jsx', () => {
  const tags = [...read('steward.html').matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]);
  const at = (f) => tags.indexOf(f);
  assert.ok(at('app/stew-tour.jsx') >= 0, 'steward.html does not load app/stew-tour.jsx');
  assert.ok(at('app/stew-modal.jsx') < at('app/stew-tour.jsx') && at('app/stew-tour.jsx') < at('app/stew-dashboard.jsx'));
});
