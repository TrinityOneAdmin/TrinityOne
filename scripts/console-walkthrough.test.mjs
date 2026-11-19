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
import { compileScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const FILES = ['app/help-illustrations.jsx', 'app/help-data.jsx', 'app/screens-help.jsx', 'app/stew-modal.jsx', 'app/stew-help.jsx', 'app/tour-kit.jsx', 'app/stew-tour.jsx', 'app/stew-dashboard.jsx'];
const JS = FILES.map(compileScreen).join('\n;\n');
const WANT = ['StewDashboard', 'StewSetupWizard', 'DelegateBrief', 'StewTourHost', 'stewNav', 'NAV',
  'stewTourPlan', 'tourKitWalk', 'stewTourSectionTip', 'tourKitPlace', 'stewTourStart', 'STEW_TOUR_TIPS', 'STEW_TOUR_STEPS', 'stewTourStore', 'StewTourTip'];

// opts: { church, delegate, innerWidth, caps (bool: capabilities allowed), store (a Map to share across boots),
//         helperCaps (a helper's capabilities, e.g. ['members']), failWrites (localStorage.setItem throws, as a full
//         or blocked store does) }
function boot(opts = {}) {
  const { React, draw } = miniReact();
  const store = opts.store || new Map();
  const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), removeItem: (k) => { store.delete(k); },
    setItem: (k, v) => { if (opts.failWrites) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } store.set(k, String(v)); } };
  const timers = [];
  const state = { tree: null, modal: false };
  const winListeners = {}, docListeners = {};
  const fakeEl = { getClientRects: () => [1], getBoundingClientRect: () => ({ left: 20, top: 30, right: 140, bottom: 74, width: 120, height: 44 }), scrollIntoView() {} };
  const doc = {
    addEventListener(t, f) { (docListeners[t] = docListeners[t] || []).push(f); },
    removeEventListener(t, f) { docListeners[t] = (docListeners[t] || []).filter(x => x !== f); },
    activeElement: null,
    // only the tour's anchor lookups are answered, and only from what the dashboard really drew
    querySelector(sel) {
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
    },
    useStewardStats: () => ({}), useStewardActivity: () => [], useStewardRequests: () => [],
    addEventListener(t, f) { (winListeners[t] = winListeners[t] || []).push(f); },
    removeEventListener(t, f) { winListeners[t] = (winListeners[t] || []).filter(x => x !== f); },
    dispatchEvent(e) { (winListeners[e.type] || []).slice().forEach(f => f(e)); return true; },
    innerWidth: opts.innerWidth || 1200, innerHeight: 800,
    localStorage: ls,
  };
  const globals = {
    React, window: win, location: { hostname: 'app.example' }, navigator: { userAgent: '' }, document: doc,
    localStorage: ls, console, Event: class { constructor(type) { this.type = type; } },
    // timers are recorded, never fired on their own: a test fires the one it means
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
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
  const show = (props = {}) => { state.tree = draw(mod.StewDashboard, props); state.tree = draw(mod.StewDashboard, props); return state.tree; };
  return { mod, win, store, timers, state, docListeners, show, draw, realCount };
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
  for (let guard = 0; guard < 20; guard++) {
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
const OWNER_TITLES = ['Welcome', 'Your church’s name', 'Overview', 'Inviting people', 'Members', 'Groups', 'Settings and Help'];

// ── the premise ────────────────────────────────────────────────────────────────────────────────────────────
test('CONTROL: the console compiles with stew-tour.jsx in its scope and mounts the tour host', () => {
  const h = boot();
  const tree = h.show();
  assert.equal(find(tree, n => n.type === 'nav').length, 1, 'the console did not draw its nav — re-anchor this test');
  assert.equal(find(tree, n => n.type === h.mod.StewTourHost).length, 1, 'StewDashboard does not mount StewTourHost');
  assert.equal(bubble(tree), null, 'the tour showed with nothing asking for it');
});

// ── the two automatic starts, at the point of use ──────────────────────────────────────────────────────────
test('POINT OF USE: finishing the setup wizard starts the tour, and it walks all seven steps for an owner', () => {
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
  // the counter's kids are [1, ' of ', 7] — joined with '' they are exactly what the browser lays out
  assert.ok(find(b, n => n.type === 'div' && (n.kids || []).join('') === '1 of 7').length === 1, 'the step counter does not read 1 of 7');
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
  // Members and Groups are locked for this helper (no capabilities), and a helper cannot rename the church.
  assert.deepEqual(titles, ['Welcome', 'Overview', 'Inviting people', 'Settings and Help']);
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
test('narrow layout: nav steps point at the menu button and say "(in the menu)"', () => {
  const h = boot({ innerWidth: 500 });
  h.mod.stewTourStart('replay');
  const titles = walk(h);
  assert.deepEqual(titles, ['Welcome', 'Your church’s name', 'Overview (in the menu)', 'Inviting people', 'Members (in the menu)', 'Groups (in the menu)', 'Settings and Help (in the menu)']);
  const plan = h.mod.stewTourPlan(h.mod.stewNav(h.mod.NAV, {}, { capState: () => ({ allowed: true }) }), { narrow: true });
  assert.deepEqual(plan.find(s => s.id === 'overview').targets, ['menu']);
  assert.deepEqual(plan.find(s => s.id === 'settings').targets, ['menu'], 'Settings and Help should both collapse onto the one menu button');
  const wide = h.mod.stewTourPlan(h.mod.stewNav(h.mod.NAV, {}, { capState: () => ({ allowed: true }) }), { narrow: false });
  assert.deepEqual(wide.find(s => s.id === 'settings').targets, ['nav-settings', 'help']);
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
  const noGroups = nav.filter(n => n.key !== 'groups');
  assert.ok(!h.mod.stewTourPlan(noGroups, {}).some(s => s.id === 'groups'), 'a section missing from the nav kept its tour step');
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
    for (let g = 0; g < 20; g++) {
      const b = bubble(tree);
      assert.ok(b, 'the tour ended before Settings and Help');
      if (titleOf(b) === 'Settings and Help') return texts(find(b, n => n.type === 'p')[0].kids || []).join('');
      press(b, 'Next');
      tree = h.show();
    }
    throw new Error('the tour never reached Settings and Help');
  };
  const S = boot().mod.STEW_TOUR_STEPS.find(s => s.id === 'settings');
  assert.equal(stepText(helperBoot([])), 'Stuck? Help is here, and so is this tour.');
  assert.equal(stepText(boot()), S.text);
});

test('POINT OF USE: the tour\'s Members step tells a helper holding Members only what they can do; an owner the owner words', () => {
  const stepText = (h) => {
    h.mod.stewTourStart('replay');
    let tree = h.show();
    for (let g = 0; g < 20; g++) {
      const b = bubble(tree);
      assert.ok(b, 'the tour ended before Members');
      if (titleOf(b) === 'Members') return texts(find(b, n => n.type === 'p')[0].kids || []).join('');
      press(b, 'Next');
      tree = h.show();
    }
    throw new Error('the tour never reached Members');
  };
  const S = boot().mod.STEW_TOUR_STEPS.find(s => s.id === 'members');
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

test('the section tip is drawn in the flow of <main>, ahead of the section — it cannot sit over sign-ups or Approve', () => {
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

// ── the shell ──────────────────────────────────────────────────────────────────────────────────────────────
test('steward.html loads stew-tour.jsx after stew-modal.jsx and before stew-dashboard.jsx', () => {
  const tags = [...read('steward.html').matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]);
  const at = (f) => tags.indexOf(f);
  assert.ok(at('app/stew-tour.jsx') >= 0, 'steward.html does not load app/stew-tour.jsx');
  assert.ok(at('app/stew-modal.jsx') < at('app/stew-tour.jsx') && at('app/stew-tour.jsx') < at('app/stew-dashboard.jsx'));
});
