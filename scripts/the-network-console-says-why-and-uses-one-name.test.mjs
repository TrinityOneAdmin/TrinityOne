// THE NETWORK CONSOLE SAYS WHY A SWITCH FAILED, NAMES A NETWORK ONE WAY, AND LEAVES THE CHURCH CONSOLE AS IT WAS (Networks port, B2a, 2026-11-19).
// Run: node --test scripts/the-network-console-says-why-and-uses-one-name.test.mjs
//
// The REAL IdentitySwitcher / NetworkAnnounceComposer / NetworkAnnouncementCard / StewDashboard / DashSettings from app/stew-dashboard.jsx, compiled
// with esbuild and drawn through render-jsx-screen.mjs's miniature React (the harness of the-network-console-has-its-own-overview-and-says-network).
// Nothing matches source text (rule 3); the sabotages below rewrite the COMPILED code of one component and show the matching test then fails.
//   1. A network whose key cannot be opened here: picking it says "Can't open this network here" with the engine's reason, and the list stays open.
//   2. One name: the switcher row and both composers show the network's PUBLISHED name, falling back to this device's saved name until it arrives.
//   3. Church view is unchanged by the Networks switch: same nav, same settings pages (bar the switch's own Network page) with it on and off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const JS = compileScreen('app/stew-dashboard.jsx');
const NETPUB = 'cd'.repeat(32), NPUB = 'npub1' + 'q'.repeat(58), CHURCHPUB = 'ab'.repeat(32);
const POSTS = [];
function consoleWith(React, opts0 = {}) {
  const { steward = {} } = opts0;   // `network` is read through opts0 at CALL time so a test can flip the view on a mounted component
  const net = () => !!opts0.network;
  const copied = [], removed = [], syncs = [];
  const win = {
    NETWORKS_ENABLED: opts0.flag === undefined ? true : opts0.flag,
    useStewardChurch: () => ({ name: net() ? 'Sussex Gospel Partnership' : 'Grace Church', npub: net() ? NPUB : 'npub1grace', isNetwork: net(), features: {}, rules: {} }),
    useStewardIdv: () => 0,
    useStewardRelays: () => [], useStewardNetworks: () => [], useStewardRosters: () => [],
    useStewardMembers: () => [{ pubkey: 'm1' }], useStewardGroups: () => [],
    useStewardAdmitted: () => [], useStewardJoinPolicy: () => false,
    useStewardStats: () => ({}), useStewardActivity: () => [], useStewardRequests: () => [],
    usePendingStewards: () => [],
    Steward: {
      isDelegated: () => false, hasKey: true, hasPinLock: () => false, whereChurchLives: () => 'community',
      relays: () => [], relayStatus: () => ({}), networks: () => [], publishProfile: () => {},
      npub: 'npub1grace', becomeStewardPayload: () => 'x', qrSVG: () => '', joinUrl: () => 'https://app.example/join#x', inviteCode: () => 'ABC123', joinCode: () => 'ABC123',
      ownRelay: () => 'wss://relay.grace.example/relay', backupState: async () => ({ boxes: 1, online: 1, syncOn: false }),
      addRelay: () => '', removeRelay: () => {}, rememberRelayName: () => {}, selfRegister: async () => ({}),
      ownedNetworks: () => [{ pub: NETPUB, npub: NPUB, name: 'Sussex Gospel Partnership' }],
      subscribeNetworkPosts: (pub, cb) => { cb(POSTS); return () => {}; },
      networkStatus: () => ({ owner: true, joiners: 3, key: 'active', reason: '' }),
      syncNetworkKeys: (...a) => { syncs.push(a); },
      removeNetworkPost: async (...a) => { removed.push(a); return { ok: true }; },
      ...steward,
    },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    innerWidth: 1200, isSecureContext: true,
  };
  const store = new Map();
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : (/\.setgroups\./.test(k) ? '[]' : null)), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  win.localStorage = localStorage;
  const globals = {
    React, window: win, location: { host: 'relay.grace.example', hostname: 'relay.grace.example' },
    navigator: { userAgent: '', clipboard: { writeText: (t) => { copied.push(t); return Promise.resolve(); } } },
    document: { addEventListener() {}, removeEventListener() {} }, localStorage, setTimeout, clearTimeout, setInterval, clearInterval, console,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Icon: function Icon() { return null; }, Halo: function Halo() { return null; }, SkBadge: function SkBadge() { return null; },
    SkKey: function SkKey() { return null; }, SkQR: function SkQR() { return null; }, SkPill: function SkPill() { return null; },
    SK_TINT: { clay: { bg: 'a', fg: 'b' }, sage: { bg: 'a', fg: 'b' }, gold: { bg: 'a', fg: 'b' }, ink: { bg: 'a', fg: 'b' } },
    DashMealsPanel: function DashMealsPanel() { return null; }, DashMannaPanel: function DashMannaPanel() { return null; },
    StewVersion: function StewVersion() { return null; },
    DismissibleNote: function DismissibleNote(p) { return p.children; }, ConsoleChrome: function ConsoleChrome(p) { return p.children; },
    StewHelpButton: function StewHelpButton() { return null; }, StewHelpLink: function StewHelpLink() { return null; },
    WizMeetings: function WizMeetings() { return null; }, _wizMeetingId: () => 'evt1', useStewDialog: () => ({ current: null }), churchHandle: () => 'grace',
    stewCapState: () => ({ allowed: false }), useStewNarrow: () => false,
  };
  const names = Object.keys(globals);
  const want = ['StewDashboard', 'DashNetworkOverview', 'DashOverview', 'DashSettings', 'Panel', 'IdentitySwitcher', 'NetworkAnnounceComposer', 'NetworkAnnouncementCard'];
  const mod = new Function(...names, (opts0.mutate ? opts0.mutate(JS) : JS) + '\nreturn { ' + want.join(', ') + ' };')(...names.map(k => globals[k]));
  for (const n of want) assert.equal(typeof mod[n], 'function', `${n} is not a component — re-anchor this test`);
  return { mod, copied, removed, syncs, opts: opts0 };
}
const run = (opts) => { const { React, draw } = miniReact(); const c = consoleWith(React, opts); return { ...c, draw }; };
const said = (tree) => texts(tree).join(' ').replace(/\s+/g, ' ');
const drawTwice = (draw, C, p) => { draw(C, p); return draw(C, p); };
const ids = (local) => () => [{ kind: 'church', pub: CHURCHPUB, name: 'Grace Church' }, { kind: 'network', pub: NETPUB, npub: NPUB, name: local }];
const CHURCH = { name: 'Grace Church', npub: 'npub1grace', features: {} };
const openSwitcher = (draw, mod, props) => {
  const t = drawTwice(draw, mod.IdentitySwitcher, props);
  const toggle = find(t, n => n.type === 'button' && /Switch between your church/.test(String(n.props.title || '')))[0];
  assert.ok(toggle, 'setup: no switcher toggle'); toggle.props.onClick(); return draw(mod.IdentitySwitcher, props);
};
const row = (tree, re) => find(tree, n => n.type === 'button' && re.test(said(n)))[0];

// ── 1. a switch that fails says so ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const SEALED = 'Its recovery words are sealed to a church key this console doesn’t have open — unlock the console, or restore the network’s words here.';
function switcher({ ok, mutate }) {
  const picks = [];
  const r = run({ mutate, steward: { identities: ids('Regions Beyond'), activePub: CHURCHPUB, churchPub: CHURCHPUB, isViewingNetwork: () => false,
    setActiveIdentity: (p) => { picks.push(p); return ok; }, networkOpenProblem: () => SEALED, subscribeNetworkProfile: () => () => {} } });
  const props = { church: CHURCH, churchName: 'Grace Church', initials: 'GC', onEditName() {} };
  const t = openSwitcher(r.draw, r.mod, props);
  const net = row(t, /Network console/); assert.ok(net, 'setup: no network row in the open switcher');
  net.props.onClick();
  return { r, props, picks, after: r.draw(r.mod.IdentitySwitcher, props) };
}
test('SWITCH FAILS: picking a network whose key cannot be opened says so, with the reason, and keeps the list open', () => {
  const w = switcher({ ok: false });
  assert.deepEqual(w.picks, [NETPUB]);
  const alert = find(w.after, n => n.props && n.props.role === 'alert')[0];
  assert.ok(alert, 'a failed switch said nothing -- the steward is left where they were with no idea why');
  assert.match(said(alert), /Can’t open this network here\./); assert.ok(said(alert).includes(SEALED), 'the reason is missing: ' + said(alert));
  assert.ok(row(w.after, /Network console/), 'the list closed as if the switch had worked');
});
test('SWITCH WORKS (control): no alert, and the list closes', () => {
  const w = switcher({ ok: true });
  assert.equal(find(w.after, n => n.props && n.props.role === 'alert').length, 0);
  assert.ok(!row(w.after, /Network console/), 'the list stayed open after a switch that worked');
});
test('SABOTAGE: with the result of setActiveIdentity ignored again, the failed switch is silent', () => {
  const mutate = (js) => { const a = 'ok = window.Steward.setActiveIdentity(pub) !== false;'; assert.equal(js.split(a).length, 2, 'sabotage anchor not unique'); return js.replace(a, 'window.Steward.setActiveIdentity(pub); ok = true;'); };
  const w = switcher({ ok: false, mutate });
  assert.equal(find(w.after, n => n.props && n.props.role === 'alert').length, 0, 'THE SABOTAGE WAS NOT CAUGHT');
});

// ── 2. one name ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function named(published, mutate) {
  const r = run({ mutate, steward: { identities: ids('Old Local Name'), activePub: CHURCHPUB, churchPub: CHURCHPUB, isViewingNetwork: () => false, setActiveIdentity: () => true,
    ownedNetworks: () => [{ pub: NETPUB, npub: NPUB, name: 'Old Local Name' }],
    subscribeNetworkProfile: (p, cb) => { if (published) cb({ name: published }); return () => {}; }, subscribeNetworkPosts: (p, cb) => { cb([]); return () => {}; } } });
  const props = { church: CHURCH, churchName: 'Grace Church', initials: 'GC', onEditName() {} };
  openSwitcher(r.draw, r.mod, props);
  const sw = said(row(r.draw(r.mod.IdentitySwitcher, props), /Network console/));   // a second draw: the row's name hook has subscribed by now
  const comp = said(drawTwice(r.draw, r.mod.NetworkAnnounceComposer, {}));
  const card = said(drawTwice(r.draw, r.mod.NetworkAnnouncementCard, { net: { pub: NETPUB, npub: NPUB, name: 'Old Local Name' } }));
  return { sw, comp, card };
}
test('ONE NAME: the switcher row and both composers show the PUBLISHED name once it is known', () => {
  const n = named('Sussex Gospel Partnership');
  assert.match(n.sw, /Sussex Gospel Partnership/, 'the switcher shows the device-saved name while the composer shows the published one: ' + n.sw);
  // (texts() also collects prop strings, so the fallback handed to the name component is in this string too; what is DRAWN is the published name)
  assert.match(n.comp, /Announce to Sussex Gospel Partnership/); assert.match(n.card, /Announce to Sussex Gospel Partnership/);
});
test('ONE NAME: until the published name arrives, all three show this device\'s saved name (never blank, never two names)', () => {
  const n = named(null);
  assert.match(n.sw, /Old Local Name/); assert.match(n.comp, /Announce to Old Local Name/); assert.match(n.card, /Announce to Old Local Name/);
});
test('SABOTAGE: with the switcher back on the saved name, the two disagree again', () => {
  const mutate = (js) => { const a = 'idn.kind === "network" ? /* @__PURE__ */ React.createElement(NetName, { pub: idn.pub, fallback: label }) : label'; assert.equal(js.split(a).length, 2, 'sabotage anchor not unique: the compiled switcher row changed shape'); return js.replace(a, 'label'); };
  const n = named('Sussex Gospel Partnership', mutate);
  assert.doesNotMatch(n.sw, /Sussex Gospel Partnership/, 'THE SABOTAGE WAS NOT CAUGHT'); assert.match(n.comp, /Sussex Gospel Partnership/);
});

// ── 3. church view is unchanged by the Networks switch ────────────────────────────────────────────────────────────────────────────────────────
const churchView = (flag) => {
  const r = run({ flag, network: false });
  const nav = said(drawTwice(r.draw, r.mod.StewDashboard, {}));
  const settings = said(drawTwice(r.draw, r.mod.DashSettings, { initialSection: 'identity', onSectionConsumed() {} }));
  return { nav, settings };
};
test('CHURCH VIEW: the dashboard and the settings list are the same with the Networks switch on as off (bar the switch\'s own Network page)', () => {
  const on = churchView(true), off = churchView(false);
  assert.equal(on.nav, off.nav, 'the church console changed when Networks was switched on');
  const ROW = 'network set-item set-item-n Network set-item-d Belong to a group of churches ';
  const dropNetworkPage = (s) => s.replace(ROW, '');
  assert.ok(on.settings.includes(ROW), 'CONTROL: the switch\'s own Network page is missing with Networks on');
  assert.equal(dropNetworkPage(on.settings), off.settings, 'church settings changed when Networks was switched on (beyond its own page)');
  for (const s of [on.nav, on.settings]) { assert.doesNotMatch(s, /Network settings|Back to |Network view|Network key|Announce to/, 'a network-view element leaked into the church view'); }
});

// ── 4. the network view runs no church machinery (9d3373db) ─────────────────────────────────────────────────────────────────────────────────────
const MACHINERY = (tree) => find(tree, n => typeof n.type === 'function' && (n.type.name === 'JoinNotifier' || n.type.name === 'KeyDistributor')).map(n => n.type.name).sort();
const GATE = 'netView ? null : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(JoinNotifier, null), /* @__PURE__ */ React.createElement(KeyDistributor, null))';
test('NETWORK VIEW mounts no church machinery (join notices, key distribution); the church view still does; SABOTAGE puts it back in the network view', () => {
  const ch = run({ network: false });
  assert.deepEqual(MACHINERY(drawTwice(ch.draw, ch.mod.StewDashboard, {})), ['JoinNotifier', 'KeyDistributor'], 'CONTROL: the church console lost its join notices / key distribution');
  const nv = run({ network: true });
  assert.deepEqual(MACHINERY(drawTwice(nv.draw, nv.mod.StewDashboard, {})), [], 'the network view runs the church\'s join notices / key distribution');
  const sab = run({ network: true, mutate: (js) => { assert.equal(js.split(GATE).length - 1, 2, 'sabotage anchor: the gate should appear in both layouts'); return js.split(GATE).join('React.createElement(React.Fragment, null, React.createElement(JoinNotifier, null), React.createElement(KeyDistributor, null))'); } });
  assert.notDeepEqual(MACHINERY(drawTwice(sab.draw, sab.mod.StewDashboard, {})), [], 'THE SABOTAGE WAS NOT CAUGHT');
});
