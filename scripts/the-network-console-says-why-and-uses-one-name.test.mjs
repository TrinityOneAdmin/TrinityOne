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
    useStewardStewardedChurches: () => opts0.stewarded || [],
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

// ── B2a audit (2026-11-19) ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// HIGH: the settings page titled "Network key" in the network view revealed the CHURCH recovery phrase (exportMnemonic is the church seed).
const KEYPAGE = (tree) => find(tree, n => n.type === 'button' && /Reveal recovery phrase/.test(said(n)));
const PAGES_ONLY_IDENTITY = (js) => { const a = 'const NETWORK_SETTINGS_PAGES = /* @__PURE__ */ new Set(["identity", "networds"]);'; assert.equal(js.split(a).length, 2, 'sabotage anchor not unique'); return js.replace(a, 'const NETWORK_SETTINGS_PAGES = /* @__PURE__ */ new Set(["identity", "networds", "key"]);'); };
function keyPage({ network, mutate }) {
  const exported = [];
  const r = run({ network, mutate, steward: { exportMnemonic: () => { exported.push(1); return 'church words one two three'; } } });
  const t = drawTwice(r.draw, r.mod.DashSettings, { initialSection: 'key', onSectionConsumed() {} });
  return { r, t, exported };
}
test('HIGH: in the network view the key page -- and its Reveal / Copy / Back up of the CHURCH phrase -- cannot be reached, even by a deep link', () => {
  const ch = keyPage({ network: false });
  const rv = KEYPAGE(ch.t); assert.equal(rv.length, 1, 'CONTROL: the church console lost its key page');
  rv[0].props.onClick(); ch.r.draw(ch.r.mod.DashSettings, { initialSection: 'key', onSectionConsumed() {} });
  assert.equal(ch.exported.length, 1, 'CONTROL: Reveal no longer reads the church phrase in the church view');
  const nv = keyPage({ network: true });
  assert.equal(KEYPAGE(nv.t).length, 0, 'the network view still offers to reveal a recovery phrase -- it is the CHURCH\'s');
  assert.doesNotMatch(said(nv.t), /Recovery phrase and backup|Network key/, 'the key page is still listed in the network view');
  assert.equal(nv.exported.length, 0);
});
test('HIGH SABOTAGE: with "key" put back on the network view\'s allow-list, the church phrase is offered in the network view', () => {
  assert.equal(KEYPAGE(keyPage({ network: true, mutate: PAGES_ONLY_IDENTITY }).t).length, 1, 'THE SABOTAGE WAS NOT CAUGHT');
});

// a failed switch to a CHURCH says church
test('SWITCH FAILS to a CHURCH (e.g. a helper just removed): it says "church", not "network"', () => {
  const ST = 'ee'.repeat(32);
  const r = run({ stewarded: [ST], steward: { identities: () => [{ kind: 'church', pub: CHURCHPUB, name: 'Grace Church' }, { kind: 'steward', pub: ST, name: 'St Aidan’s' }],
    activePub: CHURCHPUB, churchPub: CHURCHPUB, isViewingNetwork: () => false, isDelegated: () => false, setActiveIdentity: () => false, networkOpenProblem: () => 'x' } });
  const props = { church: CHURCH, churchName: 'Grace Church', initials: 'GC', onEditName() {} };
  row(openSwitcher(r.draw, r.mod, props), /You steward this church/).props.onClick();
  const alert = find(r.draw(r.mod.IdentitySwitcher, props), n => n.props && n.props.role === 'alert')[0];
  assert.ok(alert, 'a failed switch to a church said nothing'); assert.match(said(alert), /Can’t open this church here\./); assert.doesNotMatch(said(alert), /network/i);
});

// a removal that throws or answers nothing is not a removal
test('REMOVE: a call that throws, or answers nothing, says the post did not come down (control: { ok:true } says nothing); SABOTAGE hides it', () => {
  const tryRemove = async (answer, mutate) => {
    const r = run({ network: true, mutate, steward: { subscribeNetworkPosts: (p, cb) => { cb([{ id: 'a1', kind: 'announcement', text: 'Harvest', ts: 1 }]); return () => {}; }, removeNetworkPost: async () => answer() } });
    const press = () => find(drawTwice(r.draw, r.mod.DashNetworkOverview, {}), n => n.type === 'button' && /Remove|Really remove/.test(said(n)))[0].props.onClick();
    await press(); await press(); await new Promise(res => setTimeout(res, 10));
    return find(r.draw(r.mod.DashNetworkOverview, {}), n => n.props && n.props.role === 'alert').map(said).join(' ');
  };
  return (async () => {
    assert.match(await tryRemove(() => { throw new Error('socket'); }), /didn’t come down/, 'a removal that THREW said nothing');
    assert.match(await tryRemove(() => null), /didn’t come down/, 'a removal that answered nothing said nothing');
    assert.equal(await tryRemove(() => ({ ok: true })), '', 'CONTROL: a removal that worked raised an error');
    const old = (js) => { const a = 'if (!r || r.ok !== true) setRmErr('; assert.equal(js.split(a).length, 2); return js.replace(a, 'if (r && r.ok === false) setRmErr('); };
    assert.equal(await tryRemove(() => null, old), '', 'THE SABOTAGE WAS NOT CAUGHT');
  })();
});

// a partial joiner count is "at least"
test('JOINED COUNT: a partial read says "at least N" (never a confident low number); a complete read says N', async () => {
  const count = async (answer) => { const r = run({ network: true, steward: { networkJoinerCount: async () => answer, networkStatus: () => null } }); drawTwice(r.draw, r.mod.DashNetworkOverview, {}); await new Promise(res => setTimeout(res, 10)); return said(r.draw(r.mod.DashNetworkOverview, {})); };
  assert.match(await count({ atLeast: 2 }), /At least 2 churches have joined this network \(not every relay answered\)/);
  const full = await count(3); assert.match(full, /3 churches have joined this network\./); assert.doesNotMatch(full, /At least/);
});

// the registration retry does not run with the network's name
test('REGISTRATION RETRY: the network view does not re-register the church key under the network\'s name (control: the church view does); SABOTAGE re-registers', () => {
  const regs = (network, mutate) => { const got = []; const r = run({ network, mutate, steward: { selfRegister: async (n) => { got.push(n); return {}; } } }); drawTwice(r.draw, r.mod.StewDashboard, {}); return got; };
  assert.deepEqual(regs(false), ['Grace Church'], 'CONTROL: the church view no longer registers with its own name');
  assert.deepEqual(regs(true), [], 'the network view registered the CHURCH key under the NETWORK\'s name');
  const old = (js) => { const a = 'useRegistrationRetry(netView ? "" : church.name);'; assert.equal(js.split(a).length, 2); return js.replace(a, 'useRegistrationRetry(church.name);'); };
  assert.deepEqual(regs(true, old), ['Sussex Gospel Partnership'], 'THE SABOTAGE WAS NOT CAUGHT');
});

// the auditor's cap-key test: the church view mints after its timer, the network view never does
test('CAPABILITY KEYS: the church view mints after its timer; the network view does not; SABOTAGE (guard dropped) mints in the network view', async () => {
  const mints = async (network, mutate) => {
    const got = [];
    const r = run({ network, mutate, steward: { ensureCapKeyFor: async (kind) => { got.push(kind); }, stewardCaps: () => ({}), actingChurch: '' } });
    drawTwice(r.draw, r.mod.StewDashboard, {});
    await new Promise(res => setTimeout(res, 1500));
    return got;
  };
  assert.ok((await mints(false)).length > 0, 'CONTROL: the church view minted no capability key after the timer');
  assert.deepEqual(await mints(true), [], 'the network view minted church capability keys');
  const old = (js) => { const a = 'if (!S || S.actingChurch || netView || !S.ensureCapKeyFor) return;'; assert.equal(js.split(a).length, 2); return js.replace(a, 'if (!S || S.actingChurch || !S.ensureCapKeyFor) return;'); };
  assert.ok((await mints(true, old)).length > 0, 'THE SABOTAGE WAS NOT CAUGHT');
});

// ── B2a re-audit (2026-11-19) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// (d) backed by a test: the capability-key effect RE-RUNS when the view changes (netView is a dependency) -- church -> network -> church on ONE mount.
test('CAPABILITY KEYS RE-RUN ON A VIEW SWITCH: church (mints) -> network (does not) -> church again (mints again); SABOTAGE (netView out of the deps) never re-mints', async () => {
  const cycle = async (mutate) => {
    const got = [];
    const { React, draw } = miniReact();
    const opts = { network: false, mutate, steward: { ensureCapKeyFor: async (kind) => { got.push(kind); }, stewardCaps: () => ({}), actingChurch: '' } };
    const c = consoleWith(React, opts);
    const wait = () => new Promise(res => setTimeout(res, 1400));
    drawTwice(draw, c.mod.StewDashboard, {}); await wait();
    const first = got.length;
    opts.network = true; drawTwice(draw, c.mod.StewDashboard, {}); await wait();
    const inNetwork = got.length - first;
    opts.network = false; drawTwice(draw, c.mod.StewDashboard, {}); await wait();
    return { first, inNetwork, back: got.length - first - inNetwork };
  };
  const ok = await cycle(null);
  assert.ok(ok.first > 0, 'CONTROL: the church view minted nothing');
  assert.equal(ok.inNetwork, 0, 'the network view minted church capability keys');
  assert.ok(ok.back > 0, 'coming back to the church did not re-run the capability-key effect');
  const noDep = (js) => { const a = '|| {}), netView]);'; assert.equal(js.split(a).length, 2, 'sabotage anchor not unique'); return js.replace(a, '|| {})]);'); };
  assert.equal((await cycle(noDep)).back, 0, 'THE SABOTAGE WAS NOT CAUGHT: without netView in the deps the effect still re-ran');
});

// 4: the CHURCH key's sidebar box ("Key on this device · lock with a PIN" -> the church key page) is not shown in the network view
const KEYBOX = (tree) => /Key on this device/.test(said(tree));
test('SIDEBAR: the church-key box is in the church view and not in the network view; SABOTAGE puts it back', () => {
  const ch = run({ network: false }); assert.ok(KEYBOX(drawTwice(ch.draw, ch.mod.StewDashboard, {})), 'CONTROL: the church console lost its key box');
  const nv = run({ network: true }); assert.ok(!KEYBOX(drawTwice(nv.draw, nv.mod.StewDashboard, {})), 'the network view shows the CHURCH key box (it opens the church key page)');
  const back = (js) => { const i = js.indexOf('"Key on this device"'), j = js.lastIndexOf('netView ? null : ', i); assert.ok(i > 0 && j > 0 && i - j < 1000, 'sabotage anchor not found near the key box'); return js.slice(0, j) + js.slice(j + 'netView ? null : '.length); };
  const sb = run({ network: true, mutate: back }); assert.ok(KEYBOX(drawTwice(sb.draw, sb.mod.StewDashboard, {})), 'THE SABOTAGE WAS NOT CAUGHT');
});

// 5: the NETWORK's recovery words page (network view only; Reveal + Copy; never the church's words)
const NETWORDS = 'net one two three four five six seven eight nine ten eleven', CHURCHWORDS = 'church alpha beta gamma delta epsilon zeta eta theta iota kappa lambda';
function wordsPage({ network, mutate }) {
  const asked = [];
  const r = run({ network, mutate, steward: { activePub: NETPUB, networkWords: (p) => { asked.push(p); return p === NETPUB ? NETWORDS : ''; }, exportMnemonic: () => CHURCHWORDS } });
  const props = { initialSection: 'networds', onSectionConsumed() {} };
  const t = drawTwice(r.draw, r.mod.DashSettings, props);
  return { r, t, props, asked };
}
test('NETWORK WORDS: the network view lists the page; Reveal shows the NETWORK\'s words (not the church\'s), with Copy and no file backup', () => {
  const w = wordsPage({ network: true });
  assert.match(said(w.t), /Network recovery words/, 'the network view does not list the network\'s words page');
  assert.match(said(w.t), /not your church’s/, 'the page does not say these words are not the church\'s');
  const rv = find(w.t, n => n.type === 'button' && /Reveal the network’s words/.test(said(n)))[0]; assert.ok(rv, 'no Reveal button');
  rv.props.onClick();
  const after = w.r.draw(w.r.mod.DashSettings, w.props);
  const shown = find(after, n => n.props && n.props['data-network-words'] === '1').map(n => (n.kids || []).filter(k => typeof k === 'string').join('')).join(' ');
  assert.equal(shown, NETWORDS, 'the words shown are not the network\'s');
  assert.notEqual(shown, CHURCHWORDS);
  assert.deepEqual(w.asked, [NETPUB], 'the words were not asked for the network being viewed');
  assert.ok(find(after, n => n.type === 'button' && /Copy the network’s words/.test(said(n))).length === 1, 'no Copy button');
  assert.equal(find(after, n => n.type === 'button' && /Back up|file|download/i.test(said(n))).length, 0, 'a file backup is offered -- that file is the CHURCH backup');
});
test('NETWORK WORDS: the church view never lists or opens the page (even by a deep link)', () => {
  const w = wordsPage({ network: false });
  assert.doesNotMatch(said(w.t), /Network recovery words|Reveal the network’s words/);
});
test('NETWORK WORDS SABOTAGE: with the page reading exportMnemonic instead, the CHURCH words appear -- the test goes red', () => {
  const swap = (js) => { const a = 'S.networkWords && S.networkWords(S.activePub)'; assert.equal(js.split(a).length, 2, 'sabotage anchor not unique'); return js.replace(a, 'S.exportMnemonic()'); };
  const w = wordsPage({ network: true, mutate: swap });
  find(w.t, n => n.type === 'button' && /Reveal the network’s words/.test(said(n)))[0].props.onClick();
  const shown = find(w.r.draw(w.r.mod.DashSettings, w.props), n => n.props && n.props['data-network-words'] === '1').map(n => (n.kids || []).filter(k => typeof k === 'string').join('')).join(' ');
  assert.equal(shown, CHURCHWORDS, 'sabotage did not take');
  assert.notEqual(shown, NETWORDS, 'THE SABOTAGE WAS NOT CAUGHT');
});
