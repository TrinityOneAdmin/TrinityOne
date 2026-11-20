// THE NETWORK CONSOLE HAS ITS OWN HOME PAGE, AND SAYS "NETWORK" WHERE THE CHURCH CONSOLE SAYS "CHURCH".
// Run: node --test scripts/the-network-console-has-its-own-overview-and-says-network.test.mjs
//
// The REAL StewDashboard / DashNetworkOverview / DashSettings from app/stew-dashboard.jsx, compiled with esbuild and drawn through the miniature
// React of render-jsx-screen.mjs. Nothing matches source text (rule 3). Every assertion reads the tree that comes back.
// Point of use (rule 1): take DashNetworkOverview out of StewDashboard's content, or the composer/list/count/code out of DashNetworkOverview, or
// netWord out of DashSettings, and the matching test below fails. The engine calls (subscribeNetworkPosts, networkStatus) are faked here and proved
// against the real relay elsewhere (a-network-learns-which-churches-joined-it, a-network-announcement-is-sealed-two-hops).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const JS = compileScreen('app/stew-dashboard.jsx');
const NETPUB = 'cd'.repeat(32), NPUB = 'npub1' + 'q'.repeat(58);
const POSTS = [
  { id: 'e1', kind: 'event', title: 'Regional Prayer Night', date: '2026-11-07', time: '7:30pm', where: 'Hove', ts: 200 },
  { id: 'a1', kind: 'announcement', text: 'Harvest weekend is confirmed', ts: 100 },
];

function consoleWith(React, opts0 = {}) {
  const { steward = {} } = opts0;   // `network` is read through opts0 at CALL time so a test can flip the view on a mounted component
  const net = () => !!opts0.network;
  const copied = [], removed = [], syncs = [];
  const win = {
    NETWORKS_ENABLED: true,
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
    stewCapState: () => ({ allowed: false }),
  };
  const names = Object.keys(globals);
  const want = ['StewDashboard', 'DashNetworkOverview', 'DashOverview', 'DashSettings', 'Panel'];
  const mod = new Function(...names, JS + '\nreturn { ' + want.join(', ') + ' };')(...names.map(k => globals[k]));
  for (const n of want) assert.equal(typeof mod[n], 'function', `${n} is not a component — re-anchor this test`);
  return { mod, copied, removed, syncs, opts: opts0 };
}
const run = (opts) => { const { React, draw } = miniReact(); const c = consoleWith(React, opts); return { ...c, draw }; };
const titles = (tree) => find(tree, n => typeof n.type === 'function' && n.type.name === 'Panel').map(n => String(n.props.title));
const said = (tree) => texts(tree).join(' ').replace(/\s+/g, ' ');
const drawTwice = (draw, C, p) => { draw(C, p); return draw(C, p); };
const navLabels = (tree) => find(tree, n => n.type === 'button' && /nav|sk-side|side/i.test(String(n.props.className || '')) ).map(n => said(n));

test('CONTROL: the harness draws the church console as a church console', () => {
  const { mod, draw } = run({ network: false });
  const t = drawTwice(draw, mod.StewDashboard, {});
  assert.ok(find(t, n => n.type === mod.DashOverview).length === 1, 'church view does not draw the church Overview — harness broken');
});

test('POINT OF USE: network view draws DashNetworkOverview (not the church Overview) at its landing page, and church view draws the opposite', () => {
  const net = run({ network: true });
  const t = drawTwice(net.draw, net.mod.StewDashboard, {});
  assert.equal(find(t, n => n.type === net.mod.DashNetworkOverview).length, 1, 'the network console does not draw its Overview');
  assert.equal(find(t, n => n.type === net.mod.DashOverview).length, 0, 'the church Overview is drawn in network view');
  const ch = run({ network: false });
  const c = drawTwice(ch.draw, ch.mod.StewDashboard, {});
  assert.equal(find(c, n => n.type === ch.mod.DashNetworkOverview).length, 0, 'the network Overview leaked into church view');
});

test('NAV: network view offers exactly Overview and Network; a stale church tab falls back to the Overview', () => {
  const net = run({ network: true });
  const t = drawTwice(net.draw, net.mod.StewDashboard, { initial: 'members' });
  const body = said(t);
  assert.equal(find(t, n => n.type === net.mod.DashNetworkOverview).length, 1, 'a church tab carried into network view did not fall back to the Overview');
  for (const word of ['Members', 'Groups', 'Rota', 'Calendar', 'Rooms', 'Resources']) {
    assert.ok(!new RegExp('\\b' + word + '\\b').test(body), `network view shows the church section "${word}"`);
  }
  assert.match(body, /Overview/); assert.match(body, /\bNetwork\b/);
});

test('NETWORK OVERVIEW: composer, posted list (newest first), joined count and the network code are on the page; church cards are absent', () => {
  const { mod, draw } = run({ network: true });
  const t = drawTwice(draw, mod.DashNetworkOverview, {});
  assert.equal(find(t, n => typeof n.type === 'function' && n.type.name === 'NetworkAnnouncementCard').length, 1, 'the announcement card is not on the network Overview');
  assert.equal(find(t, n => typeof n.type === 'function' && n.type.name === 'NetworkEventCard').length, 1, 'the event card is not on the network Overview');
  const s = said(t);
  assert.match(s, /Regional Prayer Night/); assert.match(s, /2026-11-07 7:30pm · Hove/); assert.match(s, /Harvest weekend is confirmed/);
  assert.ok(s.indexOf('Regional Prayer Night') < s.indexOf('Harvest weekend'), 'posts are not newest first');
  assert.match(s, /3 churches have joined this network\./);
  assert.ok(s.includes(NPUB), 'the network code is not shown');
  assert.deepEqual(titles(t), ['Announcements', 'Events', 'What you’ve posted']);
  assert.doesNotMatch(s, /Members|Joining code|signed up|Groups & rooms|verse/i);
});

test('NETWORK OVERVIEW: one joined church reads "1 church has joined"; nothing known yet claims nothing', () => {
  const one = run({ network: true, steward: { networkStatus: () => ({ owner: true, joiners: 1, key: 'active', reason: '' }) } });
  assert.match(said(drawTwice(one.draw, one.mod.DashNetworkOverview, {})), /1 church has joined this network\./);
  const none = run({ network: true, steward: { networkStatus: () => null } });
  const s = said(drawTwice(none.draw, none.mod.DashNetworkOverview, {}));
  assert.match(s, /Checking which churches have joined/); assert.doesNotMatch(s, /\d+ churche?s? ha(s|ve) joined/);
});

test('NETWORK VIEW COUNT: syncNetworkKeys is church-only there, so the count must arrive through networkJoinerCount (read as the network key)', async () => {
  const asked = [];
  // networkStatus knows nothing and syncNetworkKeys does nothing -- exactly what network view gets. Only the new read can fill the count.
  const ok = run({ network: true, steward: { networkStatus: () => null, networkJoinerCount: async (pub) => { asked.push(pub); return 4; } } });
  assert.match(said(drawTwice(ok.draw, ok.mod.DashNetworkOverview, {})), /Checking which churches have joined/, 'count shown before the read answered');
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(asked, [NETPUB], 'the Overview did not ask the engine for the network\'s own joiners');
  assert.match(said(ok.draw(ok.mod.DashNetworkOverview, {})), /4 churches have joined this network\./);
  // an unknown answer (null: failed / empty read) claims nothing -- never "0 churches"
  const unk = run({ network: true, steward: { networkStatus: () => null, networkJoinerCount: async () => null } });
  drawTwice(unk.draw, unk.mod.DashNetworkOverview, {});
  await new Promise(r => setTimeout(r, 0));
  const s = said(unk.draw(unk.mod.DashNetworkOverview, {}));
  assert.match(s, /Checking which churches have joined/); assert.doesNotMatch(s, /\d+ churche?s? ha(s|ve) joined/);
  // a read that throws must not break the page
  const bad = run({ network: true, steward: { networkStatus: () => null, networkJoinerCount: async () => { throw new Error('boom'); } } });
  drawTwice(bad.draw, bad.mod.DashNetworkOverview, {});
  await new Promise(r => setTimeout(r, 0));
  assert.match(said(bad.draw(bad.mod.DashNetworkOverview, {})), /Checking which churches have joined/);
});

test('NETWORK OVERVIEW: Copy puts the NETWORK npub on the clipboard; Remove needs a second press and then removes that post', async () => {
  const { mod, draw, copied, removed } = run({ network: true });
  let t = drawTwice(draw, mod.DashNetworkOverview, {});
  const copy = find(t, n => n.type === 'button' && /Copy/.test(said(n)));
  assert.equal(copy.length, 1, 'no Copy button');
  copy[0].props.onClick();
  assert.deepEqual(copied, [NPUB]);
  const rm = () => find(draw(mod.DashNetworkOverview, {}), n => n.type === 'button' && /Remove|Really remove/.test(said(n)));
  rm()[0].props.onClick();                       // first press: asks
  assert.deepEqual(removed, [], 'one press removed a post without asking');
  assert.ok(rm().some(b => /Really remove\?/.test(said(b))));
  rm().find(b => /Really remove\?/.test(said(b))).props.onClick();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(removed.length, 1); assert.deepEqual(removed[0], [NETPUB, 'event', 'e1']);
});

test('NETWORK OVERVIEW: a failed removal says so', async () => {
  const { mod, draw } = run({ network: true, steward: { removeNetworkPost: async () => ({ ok: false, reason: 'no relay' }) } });
  drawTwice(draw, mod.DashNetworkOverview, {});
  const btn = () => find(draw(mod.DashNetworkOverview, {}), n => n.type === 'button' && /emove/.test(said(n)))[0];
  btn().props.onClick(); btn().props.onClick();
  await new Promise(r => setTimeout(r, 0));
  assert.match(said(draw(mod.DashNetworkOverview, {})), /didn’t come down/);
});

test('NETWORK OVERVIEW: a console holding no network key says so rather than drawing an empty composer', () => {
  const { mod, draw } = run({ network: true, steward: { ownedNetworks: () => [] } });
  const t = drawTwice(draw, mod.DashNetworkOverview, {});
  assert.match(said(t), /does not hold a network’s key/);
  assert.equal(find(t, n => typeof n.type === 'function' && n.type.name === 'NetworkAnnouncementCard').length + find(t, n => typeof n.type === 'function' && n.type.name === 'NetworkEventCard').length, 0);
});

const kidText = (n) => texts(n.kids).join(' ').replace(/\s+/g, ' ').trim();
const settingsRows = (tree) => find(tree, n => n.type === 'button' && /(^| )set-item( |$)/.test(String((n.props || {}).className || ''))).map(kidText);
const groupHeads = (tree) => find(tree, n => n.type === 'span' && n.props.className === 'set-grp-n').map(kidText);

test('RELABEL: network view says Network for the settings group, identity and key; church view still says Church', () => {
  const net = run({ network: true });
  const nt = drawTwice(net.draw, net.mod.DashSettings, { initialSection: 'identity', onSectionConsumed() {} });
  assert.ok(groupHeads(nt).includes('Network'), 'group header is ' + JSON.stringify(groupHeads(nt)));
  assert.ok(!groupHeads(nt).includes('Church'));
  assert.ok(settingsRows(nt).some(r => /set-item-n Network identity/.test(r)), JSON.stringify(settingsRows(nt)));
  assert.ok(!settingsRows(nt).some(r => /set-item-n Church /.test(r)), 'a "Church …" row survives in network view: ' + JSON.stringify(settingsRows(nt)));
  assert.ok(titles(nt).includes('Network identity'));
  const net2 = run({ network: true });
  const nk = drawTwice(net2.draw, net2.mod.DashSettings, { initialSection: 'key', onSectionConsumed() {} });
  // B2a AUDIT (2026-11-19) CHANGED THIS ON PURPOSE: October pinned a "Network key" page here -- but that page reveals the CHURCH recovery phrase.
  // In the network view the key page is now hidden, and a deep link to it lands on Network identity.
  assert.ok(!settingsRows(nk).some(r => /set-item-n (Network|Church) key/.test(r)), 'the key page is listed in the network view: ' + JSON.stringify(settingsRows(nk)));
  assert.ok(!titles(nk).some(t => /key/i.test(t)), JSON.stringify(titles(nk)));
  assert.ok(titles(nk).includes('Network identity'), JSON.stringify(titles(nk)));

  const ch = run({ network: false });
  const ct = drawTwice(ch.draw, ch.mod.DashSettings, { initialSection: 'identity', onSectionConsumed() {} });
  assert.ok(groupHeads(ct).includes('Church') && !groupHeads(ct).includes('Network'), 'church view group header changed: ' + JSON.stringify(groupHeads(ct)));
  assert.ok(settingsRows(ct).some(r => /set-item-n Church identity/.test(r)));
  assert.ok(titles(ct).includes('Church identity'));
  const ch2 = run({ network: false });
  const ck = drawTwice(ch2.draw, ch2.mod.DashSettings, { initialSection: 'key', onSectionConsumed() {} });
  assert.ok(settingsRows(ck).some(r => /set-item-n Church key/.test(r)));
  assert.ok(titles(ck).includes('Church key'));
});

test('NETWORK OVERVIEW DASHBOARD: Announcements and Events are two separate cards; each post is listed once; the nav says "Network settings"', () => {
  const { mod, draw } = run({ network: true });
  const t = drawTwice(draw, mod.DashNetworkOverview, {});
  const panels = find(t, n => typeof n.type === 'function' && n.type.name === 'Panel');
  const ann = panels.filter(n => n.props.title === 'Announcements'), evp = panels.filter(n => n.props.title === 'Events');
  assert.equal(ann.length, 1); assert.equal(evp.length, 1);
  assert.ok(find(ann[0], n => n.type === 'textarea').length === 1 && find(evp[0], n => n.type === 'textarea').length === 0, 'the announcement box is not (only) in the Announcements card');
  assert.ok(find(evp[0], n => n.type === 'input' && n.props['aria-label'] === 'Event title').length === 1 && find(ann[0], n => n.type === 'input').length === 0, 'the event form is not (only) in the Events card');
  const s = said(t);
  assert.equal(s.split('Regional Prayer Night').length - 1, 1, 'a post is listed twice on the Overview (the old Recent list is back)');
  assert.equal(s.split('Harvest weekend is confirmed').length - 1, 1, 'a post is listed twice on the Overview');
  assert.ok(s.includes(NPUB) && /3 churches have joined/.test(s), 'summary tiles lost the code or the joined count');
  const st = drawTwice(draw, mod.StewDashboard, {});
  assert.match(said(st), /Network settings/, 'the network nav does not say "Network settings"');
  const ch = run({ network: false });
  assert.doesNotMatch(said(drawTwice(ch.draw, ch.mod.StewDashboard, {})), /Network settings/, 'church nav changed');
});

test('NETWORK SETTINGS: network view hides the six church-only pages and keeps the rest; church view lists all of them', () => {
  // PORTED 2026-11-19: today's page wording. B2a AUDIT: the network view is now an ALLOW-LIST -- only Network identity is shown; every other page
  // acts on the church's key or data (the key page revealed the CHURCH phrase). Per-page reasons: NETWORK_SETTINGS_PAGES in app/stew-dashboard.jsx.
  const HIDDEN = [/Video & audio/, /What members see/, /Rules & privacy/, /Chat message tags/, /Belong to a group of churches/, /Help run a church/,
                  /Your calendar on your own site/, /Export, import and recovery/, /Under every notice from here/, /Where your church publishes/, /By address, auto-find or name/,
                  /Copy across, keep in sync/, /Self-host with the Suite/, /Recovery phrase and backup/, /Give someone full control/, /Let someone help run the church/];
  const net = run({ network: true });
  const nr = settingsRows(drawTwice(net.draw, net.mod.DashSettings, { initialSection: 'identity', onSectionConsumed() {} })).join(' | ');
  for (const re of HIDDEN) assert.doesNotMatch(nr, re, 'network view still lists ' + re + ': ' + nr);
  assert.match(nr, /Network identity/, 'network view lost its identity page: ' + nr);
  assert.match(nr, /Network recovery words/, 'network view lost its recovery-words page: ' + nr);   // B2a re-audit: the network's OWN words
  assert.equal(settingsRows(drawTwice(net.draw, net.mod.DashSettings, { initialSection: 'identity', onSectionConsumed() {} })).filter(r => /set-item-n /.test(r)).length, 2, 'the network view lists more than identity + its own recovery words: ' + nr);
  const ch = run({ network: false });
  const cr = settingsRows(drawTwice(ch.draw, ch.mod.DashSettings, { initialSection: 'identity', onSectionConsumed() {} })).join(' | ');
  for (const re of HIDDEN) assert.match(cr, re, 'church view lost ' + re + ': ' + cr);
  // a deep link to a hidden page must not crash or open it: it lands on a valid page
  const dl = run({ network: true });
  for (const k of ['rules', 'key', 'stewards', 'delegated', 'voice', 'website', 'backup', 'relays', 'add-relay', 'history', 'ownbox']) {   // B2a audit: every hidden page, by deep link
    const d1 = run({ network: true });
    const dt = drawTwice(d1.draw, d1.mod.DashSettings, { initialSection: k, onSectionConsumed() {} });
    assert.deepEqual(titles(dt).filter(t => !/Network identity|Network branding/.test(t)), [], 'a deep link to "' + k + '" opened a church page in the network view: ' + JSON.stringify(titles(dt)));
  }
});

test('NETWORK SETTINGS: the filter recomputes when the same mounted component switches church -> network (memo dependency)', () => {
  const opts = { network: false };
  const { React, draw } = miniReact();
  const c = consoleWith(React, opts);
  const props = { initialSection: 'identity', onSectionConsumed() {} };
  const before = settingsRows(drawTwice(draw, c.mod.DashSettings, props)).join(' | ');
  assert.match(before, /What members see/);
  opts.network = true;
  const after = settingsRows(draw(c.mod.DashSettings, props)).join(' | ');
  assert.doesNotMatch(after, /What members see/, 'the page list did not recompute when the view switched: ' + after);
  assert.match(after, /Network identity/);
});

test('NETWORK SETTINGS: tapping "Network settings" from the network console opens Network identity, not Relays', () => {
  const { mod, draw } = run({ network: true });
  const t0 = drawTwice(draw, mod.StewDashboard, {});
  const nav = find(t0, n => n.type === 'button' && /Network settings/.test(said(n)));
  assert.ok(nav.length >= 1, 'no "Network settings" nav button');
  nav[0].props.onClick();
  const t1 = drawTwice(draw, mod.StewDashboard, {});
  assert.ok(titles(t1).includes('Network identity'), 'settings did not open on Network identity: ' + JSON.stringify(titles(t1)));
  assert.ok(!titles(t1).includes('Relays'), 'settings opened on Relays: ' + JSON.stringify(titles(t1)));
});
