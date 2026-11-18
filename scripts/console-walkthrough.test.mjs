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
// handler), stew-help, stew-tour, stew-dashboard — compiled into one function scope, as the browser puts
// classic scripts into one global scope. What is NOT: the modal COUNT. The miniature React never runs effect
// cleanups, so stew-modal's count could only ever go up; the tests drive window.stewModalOpen themselves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const FILES = ['app/help-illustrations.jsx', 'app/help-data.jsx', 'app/screens-help.jsx', 'app/stew-modal.jsx', 'app/stew-help.jsx', 'app/stew-tour.jsx', 'app/stew-dashboard.jsx'];
const JS = FILES.map(compileScreen).join('\n;\n');
const WANT = ['StewDashboard', 'StewSetupWizard', 'DelegateBrief', 'StewTourHost', 'stewNav', 'NAV',
  'stewTourPlan', 'stewTourWalk', 'stewTourSectionTip', 'stewTourPlace', 'stewTourStart', 'STEW_TOUR_TIPS', 'STEW_TOUR_STEPS'];

// opts: { church, delegate, innerWidth, caps (bool: capabilities allowed), store (a Map to share across boots) }
function boot(opts = {}) {
  const { React, draw } = miniReact();
  const store = opts.store || new Map();
  const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
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
      isDelegated: () => !!opts.delegate, myStewardCaps: () => (opts.delegate ? [] : null),
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
    stewCapState: () => ({ allowed: opts.caps !== false && !opts.delegate }),
  };
  const names = Object.keys(globals);
  const mod = new Function(...names, JS + '\nreturn { ' + WANT.join(', ') + ' };')(...names.map(k => globals[k]));
  for (const n of WANT) assert.ok(mod[n] !== undefined, `${n} is missing — re-anchor this test`);
  win.stewModalOpen = () => state.modal;   // see the header: the count is driven here
  // Two draws: effects that set state show on the next one, as in React. The tree is kept for querySelector.
  const show = (props = {}) => { state.tree = draw(mod.StewDashboard, props); state.tree = draw(mod.StewDashboard, props); return state.tree; };
  return { mod, win, store, timers, state, docListeners, show, draw };
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
  assert.equal(h.mod.stewTourWalk(plan, inv, 1, present), inv + 1);
  assert.equal(h.mod.stewTourWalk(plan, inv, -1, present), inv - 1);
  assert.equal(h.mod.stewTourWalk(plan, plan.length, 1, present), -1);
});

// ── section tips ───────────────────────────────────────────────────────────────────────────────────────────
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
    const p = h.mod.stewTourPlace(rect, size, vp);
    assert.ok(p.left >= 16 && p.left + size.w <= vp.w - 16, `left ${p.left} out of the gutter for ${JSON.stringify(rect)}`);
    assert.ok(p.top >= 16 && p.top + size.h <= vp.h - 16, `top ${p.top} out of the gutter for ${JSON.stringify(rect)}`);
  }
});

// ── the shell ──────────────────────────────────────────────────────────────────────────────────────────────
test('steward.html loads stew-tour.jsx after stew-modal.jsx and before stew-dashboard.jsx', () => {
  const tags = [...read('steward.html').matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]);
  const at = (f) => tags.indexOf(f);
  assert.ok(at('app/stew-tour.jsx') >= 0, 'steward.html does not load app/stew-tour.jsx');
  assert.ok(at('app/stew-modal.jsx') < at('app/stew-tour.jsx') && at('app/stew-tour.jsx') < at('app/stew-dashboard.jsx'));
});
