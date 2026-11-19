// A NETWORK REACHES A CHURCH'S MEMBERS ONLY THROUGH "WHAT'S HAPPENING" (Networks member step 1; owner decisions 2026-11-19, reference/DOMAIN.md
// "Network content in the member app").
//   Run: node --test scripts/a-network-reaches-members-only-through-whats-happening.test.mjs
//
// POINT OF USE: the REAL App (app/app.jsx, mounted through scripts/app-screens.mjs with every script index.html lists) with a fake Fellowship
// whose subscription callbacks the test fires. What is asserted is what App hands the screens in `ctx`: the Network tab(s) (ctx.netTabs), the
// one Today line (ctx.netLine), the merged event list (ctx.churchEvents) and the church list (ctx.churches). The screens that draw those are
// mounted in the-network-tab-and-line-are-on-the-member-screens.test.mjs. Rule 3: nothing here matches text in app/*.jsx.
//
//   1. Switch OFF (the shipped default): no network is looked up, nothing reaches ctx.
//   2. Switch ON, church joined, member cleared as an adult: one tab per network, titled by the network's short_name; fallback to its name, then
//      to "Network"; the newest unread update becomes the Today line; marking the tab read removes the line (and is remembered on the device).
//   3. A kind-0 signed by ANY OTHER key never titles the tab.
//   4. A church-marked CHILD: no tab, no line, no network event -- and before the clearance answer has loaded, nothing either.
//   5. The church's own calendar switch: off = network events leave Events/Calendar (ctx.churchEvents) but stay in the Network tab.
//   6. A network is never a church: not added to the switcher when the church joins one, and an old stored entry is not listed even with the
//      switch on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeReact, appBrowser, loadApp, nodes } from './app-screens.mjs';

const CHURCH = 'npub1' + '0'.repeat(58);
const NETHEX = 'ab'.repeat(32), NETNPUB = 'npub1' + 'q'.repeat(10) + 'x'.repeat(40) + 'wxyz';
const OTHERHEX = 'cd'.repeat(32);
const iso = (days) => { const d = new Date(Date.now() + days * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const NOW = Math.floor(Date.now() / 1000);
const POSTS = [{ id: 'a1', text: 'Older news', ts: NOW - 3 * 86400 }, { id: 'a2', text: 'Regional youth weekend: booking opens Monday\nLeaders, see the pack.', ts: NOW - 3600 }];
const EVENTS = [{ id: 'ev1', title: 'Advent prayer evening', date: iso(10), time: '19:00', where: 'Bath Abbey' }];

function boot({ flag = 'on', features, assume = 'adult', seedNetwork = false } = {}) {
  const r = fakeReact(); const env = appBrowser(); const window = env.window;
  if (flag === 'on') window.NETWORKS_ENABLED = true;   // 'default' leaves app/data.jsx to give the switch its shipped value
  window.Bible = { loaded: true, activeVersion: 'KJV', subscribe: () => () => {}, books: () => ['John'], maxChapter: () => 21, defaultLoc: () => ({ book: 'John', chap: 1 }) };
  window.MyData = { seedIfEmpty() {}, on: () => () => {}, list: () => [], settings: { get: () => ({}) }, count: () => 0, set: () => {} };
  window.TrinityData = {};
  const App = loadApp({ React: r.React, window, expr: 'App' });
  window.TrinityData.CHURCHES = [{ id: CHURCH, npub: CHURCH, name: 'St Bede', ...(features ? { features } : {}) }];
  window.localStorage.setItem('trinityone.activeChurch', JSON.stringify(CHURCH));
  if (seedNetwork) window.localStorage.setItem('trinityone.followedChurches', JSON.stringify([{ id: NETNPUB, npub: NETNPUB, name: 'Regions Beyond', kind: 'network', sub: 'Network' }]));
  const calls = [];
  // assume: 'adult' answers the clearance question at once; 'never' leaves it unanswered (a promise that never settles)
  const assumeMinor = assume === 'never' ? () => new Promise(() => {}) : () => Promise.resolve(false);
  window.Fellowship = new Proxy({ myPubkey: 'ee'.repeat(32), CANONICAL_RELAYS: [], hasRelays: true, assumeMinor },
    { get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'then' || typeof k === 'symbol') return undefined;
      return (...args) => { const f = args.find(a => typeof a === 'function'); if (f) calls.push([k, args, f]); return () => {}; };
    } });
  const draw = () => { r.reset(); const tree = App(); r.flush(); return tree; };
  const last = (k) => [...calls].reverse().find(c => c[0] === k);
  const ctx = () => { const n = nodes(draw()).find(x => x.props && x.props.ctx && Array.isArray(x.props.ctx.churches)); assert.ok(n, 'no screen received the App ctx -- re-anchor'); return n.props.ctx; };
  const tick = (ms = 50) => new Promise(res => setTimeout(res, ms));
  const settle = async () => { draw(); await tick(1500); draw(); await tick(); draw(); };
  // the church has joined the network
  const join = async () => {
    const nets = last('subscribeChurchNetworks'); assert.ok(nets, 'setup: the App never asked which networks the church joined');
    nets[2]([{ networkPub: NETHEX, npub: NETNPUB }]); draw(); await tick(); draw(); await tick(); draw();
  };
  const deliver = async (state = 'ready') => {
    const c = last('subscribeNetworkContent'); assert.ok(c, 'the App never opened the sealed network-content subscription');
    c[2]({ state, announcements: state === 'ready' ? POSTS : [], events: state === 'ready' ? EVENTS : [], unreadable: 0 }); draw(); await tick(); draw();
  };
  const profile = async (pubkey, content, at = NOW) => {
    const p = last('subscribeNetworkProfile'); assert.ok(p, 'the App never read the network\'s profile');
    p[2]({ kind: 0, pubkey, created_at: at, content: JSON.stringify(content) }); draw(); await tick(); draw();
  };
  return { window, calls, last, draw, ctx, settle, join, deliver, profile, tick };
}

test('SWITCH OFF (shipped default): no network is looked up and nothing reaches the screens', async () => {
  const m = boot({ flag: 'default' });
  assert.equal(m.window.NETWORKS_ENABLED, false, 'app/data.jsx no longer defaults the switch to false');
  await m.settle();
  for (const k of ['subscribeChurchNetworks', 'subscribeNetworkContent', 'subscribeNetworkProfile']) assert.ok(!m.last(k), k + ' was called with the switch off');
  const c = m.ctx();
  assert.equal(c.netTabs.length, 0, 'c.netTabs is not empty'); assert.equal(c.netLine, null); assert.equal(c.churchNetworks.length, 0, 'c.churchNetworks is not empty');
  assert.ok(!c.churchEvents.some(e => e._network), 'a network event reached the calendar with the switch off');
});

test('SWITCH ON, joined, cleared adult: one tab titled by the short name; the newest unread update is the Today line; reading the tab clears it', async () => {
  const m = boot();
  await m.settle(); await m.join();
  // the content subscription is for THIS network, opened with THIS church (the church's re-seal is what opens it)
  const sub = m.last('subscribeNetworkContent');
  assert.ok(sub, 'no sealed network-content subscription was opened for a cleared adult');
  assert.deepEqual(sub[1].slice(0, 2), [NETNPUB, CHURCH]);
  await m.deliver();
  let c = m.ctx();
  assert.equal(c.netTabs.length, 1, 'the joined network has no tab');
  assert.equal(c.netTabs[0].title, 'Network', 'before any profile arrives the tab must say "Network"');
  assert.equal(c.netTabs[0].state, 'ready');
  assert.deepEqual(c.netTabs[0].announcements.map(a => a.id), ['a2', 'a1'], 'updates are not newest first');
  // name only -> the name; then a short_name -> the short name
  await m.profile(NETHEX, { name: 'Bed, Bath & Regions Beyond' }, NOW - 10);
  assert.equal(m.ctx().netTabs[0].title, 'Bed, Bath & Regions Beyond', 'with no short_name the tab is not titled by the network\'s name');
  await m.profile(NETHEX, { name: 'Bed, Bath & Regions Beyond', short_name: 'BB&RB' }, NOW);
  c = m.ctx();
  assert.equal(c.netTabs[0].title, 'BB&RB', 'the tab is not titled by the network\'s short_name');
  assert.equal(c.netTabs[0].name, 'Bed, Bath & Regions Beyond');
  // the Today line: the newest unread update, pointing at this network's tab
  assert.ok(c.netLine, 'an unread network update produced no Today line');
  assert.equal(c.netLine.id, 'a2'); assert.equal(c.netLine.title, 'BB&RB'); assert.equal(c.netLine.tabKey, c.netTabs[0].key);
  // the Community chip offers exactly that tab
  assert.deepEqual(c.churchNetworks.map(n => [n.networkPub, n.name, n.tabKey]), [[NETHEX, 'BB&RB', c.netTabs[0].key]]);
  // network events reach Events/Calendar tagged with the short name
  const ev = c.churchEvents.find(e => e.id === 'ev1');
  assert.ok(ev, 'the network event did not reach Events/Calendar');
  assert.equal(ev._network, 'BB&RB');
  // reading the tab clears the line, and the mark is kept on the device
  c.markNetTabSeen(NETHEX); m.draw(); await m.tick();
  c = m.ctx();
  assert.equal(c.netLine, null, 'the Today line is still there after the network tab was read');
  assert.match(m.window.localStorage.getItem('trinityone.netSeen') || '', new RegExp(CHURCH + '\\|' + NETHEX + '"\\s*:\\s*' + POSTS[1].ts), 'the read mark was not stored per church+network');
  // a NEWER update brings the line back
  m.last('subscribeNetworkContent')[2]({ state: 'ready', announcements: [...POSTS, { id: 'a3', text: 'Food bank needs drivers', ts: NOW - 60 }], events: EVENTS, unreadable: 0 }); m.draw(); await m.tick();
  assert.equal((m.ctx().netLine || {}).id, 'a3', 'a newer update did not bring the line back');
});

test('the short name is capped at 16 characters on read', async () => {
  const m = boot();
  await m.settle(); await m.join(); await m.deliver();
  await m.profile(NETHEX, { name: 'N', short_name: 'A very long network short name' });
  assert.equal(m.ctx().netTabs[0].title, 'A very long netw');
});

test('SPOOF: a kind-0 signed by another key never titles the tab (CONTROL: the network\'s own one does)', async () => {
  const m = boot();
  await m.settle(); await m.join(); await m.deliver();
  await m.profile(OTHERHEX, { name: 'Impostor Network', short_name: 'FAKE' }, NOW + 100);
  assert.equal(m.ctx().netTabs[0].title, 'Network', 'a profile from another key renamed the network\'s tab');
  await m.profile(NETHEX, { name: 'Real', short_name: 'REAL' }, NOW);
  assert.equal(m.ctx().netTabs[0].title, 'REAL', 'CONTROL: the network\'s own profile was not used, so the spoof check above proves nothing');
});

test('LOCKED: a joined network whose key has not reached the phone yet is a tab in the waiting state, never an error and never a line', async () => {
  const m = boot();
  await m.settle(); await m.join(); await m.deliver('locked');
  const c = m.ctx();
  assert.equal(c.netTabs.length, 1); assert.equal(c.netTabs[0].state, 'locked');
  assert.equal(c.netLine, null);
});

test('CHILD: a member this church marked a child gets no tab, no line, no network event, no chip (CONTROL above: an adult gets all four)', async () => {
  const m = boot();
  await m.settle();
  const sg = m.last('subscribeChurchSafeguard'); assert.ok(sg, 'setup: the App never read the church\'s safeguarding answer');
  sg[2]({ minors: [], approved: [], guardians: {}, isMinor: true, minorsKnown: true }); m.draw(); await m.tick(); m.draw();
  await m.join();
  const before = m.calls.filter(c => c[0] === 'subscribeNetworkContent').length;
  assert.equal(before, 0, 'the sealed network content was subscribed for a marked child');
  const c = m.ctx();
  assert.equal(c.netTabs.length, 0, 'c.netTabs is not empty'); assert.equal(c.netLine, null); assert.equal(c.churchNetworks.length, 0, 'c.churchNetworks is not empty');
  assert.ok(!c.churchEvents.some(e => e._network), 'a network event reached a child\'s calendar');
});

test('BEFORE CLEARANCE: until this church has answered "is this member a child?", nothing from a network is subscribed or shown', async () => {
  const m = boot({ assume: 'never' });
  await m.settle(); await m.join();
  assert.ok(!m.last('subscribeNetworkContent'), 'network content was subscribed before the clearance answer loaded');
  const c = m.ctx();
  assert.equal(c.netTabs.length, 0, 'c.netTabs is not empty'); assert.equal(c.netLine, null);
});

test('CALENDAR OFF: network events leave Events/Calendar but stay in the Network tab', async () => {
  const m = boot({ features: { calendar: false } });
  await m.settle(); await m.join(); await m.deliver();
  const c = m.ctx();
  assert.ok(!c.churchEvents.some(e => e._network), 'the church hid its calendar but a network event is still in Events/Calendar');
  assert.deepEqual(c.netTabs[0].events.map(e => e.id), ['ev1'], 'the network event is missing from the Network tab');
});

test('A NETWORK IS NEVER A CHURCH: joining one adds nothing to the switcher, and an old stored network entry is not listed even with the switch on', async () => {
  const m = boot({ seedNetwork: true });
  await m.settle();
  let ids = m.ctx().churches.map(c => c.id);
  assert.ok(ids.includes(CHURCH), 're-anchor: the real church is not listed');
  assert.ok(!ids.includes(NETNPUB), 'a stored network entry is listed as a church with the switch on');
  assert.equal(m.ctx().activeChurch, CHURCH);
  // a phone with nothing stored: the church joins a network
  const f = boot();
  await f.settle(); await f.join(); await f.deliver(); await f.profile(NETHEX, { name: 'Regions Beyond', short_name: 'RB' }); await f.tick(); f.draw();
  assert.equal(f.ctx().netTabs.length, 1, 'CONTROL: the network did reach this phone, so the check below is not vacuous');
  ids = f.ctx().churches.map(c => c.id);
  assert.ok(!ids.includes(NETNPUB), 'joining a network put it in the church switcher');
  const stored = JSON.parse(f.window.localStorage.getItem('trinityone.followedChurches') || '[]');
  assert.ok(!stored.some(c => c.id === NETNPUB || c.kind === 'network'), 'a network was auto-added to the stored church list');
});
