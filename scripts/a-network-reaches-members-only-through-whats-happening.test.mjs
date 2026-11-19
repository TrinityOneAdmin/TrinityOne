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

const CHURCH = 'npub1' + '0'.repeat(58), CHURCH2 = 'npub1' + '3'.repeat(58);
const NETHEX = 'ab'.repeat(32), NETNPUB = 'npub1' + 'q'.repeat(10) + 'x'.repeat(40) + 'wxyz';
const OTHERHEX = 'cd'.repeat(32);
const iso = (days) => { const d = new Date(Date.now() + days * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const NOW = Math.floor(Date.now() / 1000);
const POSTS = [{ id: 'a1', text: 'Older news', ts: NOW - 3 * 86400 }, { id: 'a2', text: 'Regional youth weekend: booking opens Monday\nLeaders, see the pack.', ts: NOW - 3600 }];
const EVENTS = [{ id: 'ev1', title: 'Advent prayer evening', date: iso(10), time: '19:00', where: 'Bath Abbey' }];

function boot({ flag = 'on', features, standing = 'unmarked', assumeChild = false, seedNetwork = false, second = false } = {}) {
  const r = fakeReact(); const env = appBrowser(); const window = env.window;
  if (flag === 'on') window.NETWORKS_ENABLED = true;   // 'default' leaves app/data.jsx to give the switch its shipped value
  window.Bible = { loaded: true, activeVersion: 'KJV', subscribe: () => () => {}, books: () => ['John'], maxChapter: () => 21, defaultLoc: () => ({ book: 'John', chap: 1 }) };
  window.MyData = { seedIfEmpty() {}, on: () => () => {}, list: () => [], settings: { get: () => ({}) }, count: () => 0, set: () => {} };
  window.TrinityData = {};
  const App = loadApp({ React: r.React, window, expr: 'App' });
  window.TrinityData.CHURCHES = [{ id: CHURCH, npub: CHURCH, name: 'St Bede', ...(features ? { features } : {}) }, ...(second ? [{ id: CHURCH2, npub: CHURCH2, name: 'St Aidan' }] : [])];
  window.localStorage.setItem('trinityone.activeChurch', JSON.stringify(CHURCH));
  if (seedNetwork) window.localStorage.setItem('trinityone.followedChurches', JSON.stringify([{ id: NETNPUB, npub: NETNPUB, name: 'Regions Beyond', kind: 'network', sub: 'Network' }]));
  const calls = [];
  // standing: what Fellowship.minorStanding answers -- 'unmarked' | 'marked' | 'unknown', or 'never' (never settles) / 'throw' (rejects).
  // assumeChild: what assumeMinor answers (true = the feed's assume-a-child policy); the network gate must NOT follow it.
  // standing may also be a function (churchNpub, myPubkey, callNo) -> one of the above, for per-church / per-identity / retry cases
  let standingCalls = 0;
  const one = (v) => v === 'never' ? new Promise(() => {}) : v === 'throw' ? Promise.reject(new Error('relay down')) : Promise.resolve(v);
  const minorStanding = (np) => one(typeof standing === 'function' ? standing(np, fake.myPubkey, ++standingCalls) : standing);
  const assumeMinor = () => Promise.resolve(!!assumeChild);
  const fake = { myPubkey: 'ee'.repeat(32), CANONICAL_RELAYS: [], hasRelays: true, assumeMinor, minorStanding };
  window.Fellowship = new Proxy(fake,
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
  return { window, calls, last, draw, ctx, settle, join, deliver, profile, tick, fake };
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
  const m = boot({ standing: 'never' });
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

// ── audit of 590fa968 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const nothing = (m, why) => {
  assert.ok(!m.last('subscribeNetworkContent'), why + ': network content was subscribed');
  assert.ok(!m.last('subscribeNetworkProfile'), why + ': the network profile was read');
  const c = m.ctx();
  assert.equal(c.netTabs.length, 0, why + ': a tab'); assert.equal(c.netLine, null, why + ': a line'); assert.equal(c.churchNetworks.length, 0, why + ': a chip');
};
test('CHILD GATE: a clearance lookup that THROWS clears nobody -- nothing subscribed, nothing shown', async () => {
  const m = boot({ standing: 'throw' }); await m.settle(); await m.join(); await m.tick(); m.draw();
  nothing(m, 'lookup threw');
});
test('CHILD GATE: a lookup that answers "unknown" (could not ask the church) clears nobody', async () => {
  const m = boot({ standing: 'unknown' }); await m.settle(); await m.join();
  nothing(m, 'unknown');
});
test('CHILD GATE: settled and MARKED a child by this church -> nothing (even before the safeguarding subscription says so)', async () => {
  const m = boot({ standing: 'marked' }); await m.settle(); await m.join();
  nothing(m, 'marked');
});
test('CHILD GATE: an UNMARKED member of a church whose assume-a-child policy is on (assumeMinor true) IS served -- markings are trusted', async () => {
  const m = boot({ standing: 'unmarked', assumeChild: true }); await m.settle(); await m.join(); await m.deliver();
  const c = m.ctx();
  assert.equal(c.netTabs.length, 1, 'an unmarked adult was hidden from network content by the assume-a-child policy');
  assert.ok(c.netLine, 'no line for an unmarked adult');
});

test('CHURCH SWITCH: moving from a church in a network to one in none leaves no tab, chip or line, and opens no content subscription for it', async () => {
  const m = boot({ second: true }); await m.settle(); await m.join(); await m.deliver();
  assert.equal(m.ctx().netTabs.length, 1, 'CONTROL: the first church\'s network did reach the screens');
  m.ctx().setActiveChurch(CHURCH2); m.draw(); await m.tick(); m.draw(); await m.tick(); m.draw();
  assert.equal(m.ctx().activeChurch, CHURCH2, 're-anchor: the switch did not happen');
  // the engine never answers for a church with no network document (it does not emit on an empty EOSE): send nothing
  const c = m.ctx();
  assert.equal(c.netTabs.length, 0, 'the previous church\'s network tab is still on screen');
  assert.equal(c.churchNetworks.length, 0, 'the previous church\'s "Part of" chip is still on screen');
  assert.equal(c.netLine, null, 'the previous church\'s network line is still on screen');
  assert.ok(!m.calls.some(x => x[0] === 'subscribeNetworkContent' && x[1][1] === CHURCH2), 'network content was subscribed for the church that joined nothing');
});

test('BELL: reading a network\'s tab also clears the bell\'s count for that network\'s updates; a newer update counts again', async () => {
  const m = boot(); await m.settle(); await m.join(); await m.deliver();
  let c = m.ctx();
  assert.equal(c.netUnread, 2, 'CONTROL: the bell does not count the two network updates');
  c.markNetTabSeen(NETHEX); m.draw(); await m.tick();
  assert.equal(m.ctx().netUnread, 0, 'reading the network tab left the bell counting its updates');
  m.last('subscribeNetworkContent')[2]({ state: 'ready', announcements: [...POSTS, { id: 'a3', text: 'New', ts: NOW - 30 }], events: EVENTS, unreadable: 0 }); m.draw(); await m.tick();
  assert.equal(m.ctx().netUnread, 1);
});

test('SHORT NAME: zero-width and bidi characters are dropped and the cap counts graphemes (a family emoji is one)', async () => {
  const m = boot(); await m.settle(); await m.join(); await m.deliver();
  await m.profile(NETHEX, { name: 'N‮evil', short_name: '‮BB​&⁦RB﻿' }, NOW);
  assert.equal(m.ctx().netTabs[0].title, 'BB&RB', 'invisible / direction characters reached the tab title');
  assert.equal(m.ctx().netTabs[0].name, 'Nevil');
  const fam = '\u{1F468}‍\u{1F469}‍\u{1F467}';
  await m.profile(NETHEX, { name: 'N', short_name: fam.repeat(20) }, NOW + 1);
  // CHANGED ON PURPOSE (audit of 131b7e4f): the 64-code-unit ceiling now applies too. A family emoji is 8 units, so 8 whole families fit;
  // the point of the test -- a cluster is never split -- is unchanged.
  assert.equal(m.ctx().netTabs[0].title, fam.repeat(8), 'the cap split a grapheme cluster or ignored the code-unit ceiling');
});

// ── audit of 131b7e4f ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('F3: church A answers "unmarked"; switching to B, whose lookup never settles, shows NOTHING for B even though B is in a network', async () => {
  const m = boot({ second: true, standing: (np) => (np === CHURCH ? 'unmarked' : 'never') });
  await m.settle(); await m.join(); await m.deliver();
  assert.equal(m.ctx().netTabs.length, 1, 'CONTROL: church A was cleared and its network shows');
  m.ctx().setActiveChurch(CHURCH2); m.draw(); await m.tick(); m.draw(); await m.tick(); m.draw();
  assert.equal(m.ctx().activeChurch, CHURCH2, 're-anchor: the switch did not happen');
  const nets = m.last('subscribeChurchNetworks'); assert.equal(nets[1][0], CHURCH2, 're-anchor: B\'s networks were not asked for');
  nets[2]([{ networkPub: NETHEX, npub: NETNPUB }]); m.draw(); await m.tick(); m.draw(); await m.tick(); m.draw();
  assert.ok(!m.calls.some(x => x[0] === 'subscribeNetworkContent' && x[1][1] === CHURCH2), 'network content was subscribed for B before B answered');
  const c = m.ctx();
  assert.equal(c.netTabs.length, 0, 'A\'s "unmarked" cleared B'); assert.equal(c.churchNetworks.length, 0); assert.equal(c.netLine, null);
});

test('F2: the answer belongs to WHO is holding the phone -- a new identity without a reload starts uncleared', async () => {
  const OTHER = 'ff'.repeat(32);
  const m = boot({ standing: (np, me) => (me === OTHER ? 'never' : 'unmarked') });
  await m.settle(); await m.join(); await m.deliver();
  assert.equal(m.ctx().netTabs.length, 1, 'CONTROL: the first identity was cleared');
  m.fake.myPubkey = OTHER; m.draw(); await m.tick(); m.draw(); await m.tick(); m.draw();
  const c = m.ctx();
  assert.equal(c.netTabs.length, 0, 'the previous person\'s "unmarked" was carried over to a new identity');
  assert.equal(c.netLine, null);
});

test('F2: an "unknown" answer is asked again on a short backoff -- nothing shown meanwhile, the tab once the church answers', async () => {
  const m = boot({ standing: (np, me, n) => (n === 1 ? 'unknown' : 'unmarked') });
  await m.settle(); await m.join();
  assert.equal(m.ctx().netTabs.length, 0, 'something was shown on an "unknown" answer');
  assert.ok(!m.last('subscribeNetworkContent'), 'content was subscribed on an "unknown" answer');
  await m.tick(3300); m.draw(); await m.tick(); m.draw(); await m.deliver();
  assert.equal(m.ctx().netTabs.length, 1, 'the "unknown" answer was never asked again, so an adult stays blank until the next reconnect');
});

test('RULE 4: opening the bell (markNetSeen) does NOT mark the network tab read -- the Today line stays until the tab is opened', async () => {
  const m = boot(); await m.settle(); await m.join(); await m.deliver();
  m.ctx().markNetSeen(); m.draw(); await m.tick(); m.draw();
  assert.equal(m.ctx().netUnread, 0, 're-anchor: opening the bell did not clear its own count');
  assert.ok(m.ctx().netLine, 'opening the bell removed the network line');
});

test('NAMES: controls, soft hyphen, combining grapheme joiner, Arabic letter mark, Mongolian separator, Hangul fillers, variation selectors and tag characters are dropped (U+FE0F emoji form kept); a zalgo name is clipped at 64 code units', async () => {
  const m = boot(); await m.settle(); await m.join(); await m.deliver();
  await m.profile(NETHEX, { name: 'N', short_name: 'B\u00ADB\u034F\u061C&\u180ER\u115F\u1160\u3164\uFFA0B\u{E0041}\u{E007F}\u0001\u0085\uFE00\uFE0E' }, NOW);
  assert.equal(m.ctx().netTabs[0].title, 'BB&RB');
  const g = 'Z' + '\u0301'.repeat(30);   // one grapheme, 31 code units
  await m.profile(NETHEX, { name: 'N', short_name: g.repeat(5) }, NOW + 1);
  assert.equal(m.ctx().netTabs[0].title, g.repeat(2), 'a zalgo short name was not clipped at 64 code units (whole graphemes only)');
  await m.profile(NETHEX, { name: 'N', short_name: '\u2764\uFE0F' }, NOW + 2);
  assert.equal(m.ctx().netTabs[0].title, '\u2764\uFE0F', 'the emoji presentation selector was stripped, breaking the emoji');
});
