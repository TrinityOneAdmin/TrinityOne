// THE NETWORK PANEL TELLS THE FOUNDER WHO HAS JOINED, AND TELLS A JOINING CHURCH WHERE ITS KEY IS (Networks MVP, N5c).
// Run: node --test scripts/the-network-panel-says-who-joined-and-whether-the-key-arrived.test.mjs
//
// The REAL DashNetworksPanel from app/stew-dashboard.jsx, drawn with the fake React hook store of console-screens.mjs (the harness
// network-join-screen.test.mjs uses). Nothing matches source text (rule 3): the console reports a status, the panel is drawn, and what it SAYS is read back.
// Point of use (rule 1): delete the status line from NetworkRow and every claim below fails; the engine behind it is proved against the real
// relay in a-second-church-receives-a-post-once-the-founder-finds-it.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, texts, nodes } from './console-screens.mjs';

const NETPUB = 'cd'.repeat(32), NPUB = 'npub1' + 'q'.repeat(58);
function boot(status) {
  let current = status; const syncs = [];
  const Steward = fakeSteward({ actingChurch: '', subscribeNetworkProfile: (p, cb) => { cb({ name: 'Sussex Gospel Partnership' }); return () => {}; },
    networkStatus: () => current, syncNetworkKeys: (...a) => { syncs.push(a); } });
  const r = fakeReact();
  const { window } = fakeBrowser({ Steward });
  const Row = loadConsole({ React: r.React, window, expr: 'NetworkRow' });
  const net = { networkPub: NETPUB, npub: NPUB };
  const draw = () => { r.reset(); Row({ net, onLeave() {} }); r.flush(); r.reset(); const t = Row({ net, onLeave() {} }); r.flush(); return t; };
  const say = () => texts(draw()).join(' ').replace(/\s+/g, ' ');
  return { say, set: (s) => { current = s; window.dispatch('steward-network-status'); }, syncs };
}

test('FOUNDER: the panel says how many churches have joined, and updates when a sync finishes (no manual add step)', () => {
  const p = boot({ owner: true, joiners: 1, key: 'active', reason: '' });
  assert.match(p.say(), /1 church has joined this network \(yours\)\./);
  p.set({ owner: true, joiners: 3, key: 'active', reason: '' });
  assert.match(p.say(), /3 churches have joined this network\./);
  assert.doesNotMatch(p.say(), /yours/);
  assert.ok(p.syncs.length >= 1, 'the panel never asks the console to sync, so nothing would refresh it');
});

test('JOINER: "waiting for the network to share its key" is distinct from "active", and puts the wait where it is (on the network)', () => {
  const p = boot({ owner: false, joiners: null, key: 'waiting', reason: '' });
  assert.match(p.say(), /You have joined\. Waiting for the network to share its key — nothing more is needed from you\./);
  assert.doesNotMatch(p.say(), /Waiting for your church/);
  p.set({ owner: false, joiners: null, key: 'active', reason: '' });
  assert.match(p.say(), /Active — your members can see what this network shares\./);
  assert.doesNotMatch(p.say(), /Waiting for the network/);
});

test('JOINER: a real fault is not dressed up as waiting or as active', () => {
  const p = boot({ owner: false, joiners: null, key: 'trouble', reason: '' });
  assert.match(p.say(), /could not be shared with your members just now/);
  assert.doesNotMatch(p.say(), /Active —/);
  // PORTED 2026-11-19 (B2a): when the engine knows WHY (e.g. a relay without the network safety update), the steward is told that, not the generic line
  const q = boot({ owner: false, joiners: null, key: 'trouble', reason: 'Network keys are paused: wss://old.example/relay has not confirmed it' });
  assert.match(q.say(), /Network keys are paused: wss:\/\/old\.example\/relay/);
  assert.doesNotMatch(q.say(), /Active —/);
});

test('NOTHING KNOWN YET: the panel claims nothing (no status line at all)', () => {
  const p = boot(null);
  assert.doesNotMatch(p.say(), /joined|Active|Waiting|Checking/);
});

test('POINT OF USE: the Network panel actually draws that row for the network the church is in (the row is not orphaned)', () => {
  const Steward = fakeSteward({ actingChurch: '' });
  const r = fakeReact(); const { window } = fakeBrowser({ Steward });
  const Panel = loadConsole({ React: r.React, window, expr: 'DashNetworksPanel' });
  window.useStewardNetworks = () => [{ networkPub: NETPUB, npub: NPUB }];
  r.reset(); const tree = Panel(); r.flush();
  const row = nodes(tree).find(n => typeof n.type === 'function' && n.type.name === 'NetworkRow');
  assert.ok(row, 'the Network panel does not draw a NetworkRow');
  assert.equal(row.props.net.networkPub, NETPUB);
});
