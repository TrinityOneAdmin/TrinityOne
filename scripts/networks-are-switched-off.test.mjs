// NETWORKS ARE SWITCHED OFF (owner decision, reference/DOMAIN.md 2026-10-11) — THE MEMBER APP'S SIDE.
// Run: node --test scripts/networks-are-switched-off.test.mjs
//
// The console's entry points (settings Network page with its create / join controls, the identity switcher,
// the event dialog's "Publish as") are asserted in the three files that already render those screens:
//   settings-cards-sit-in-authored-stacks, the-switcher-names-the-consoles-own-church,
//   the-not-on-the-website-tick-is-the-owners.
// This file is the member app. A member has no create / join control, but App() follows every network their
// church belongs to (since 2026-11-19: a tab in What's happening, one line on Today, its events in Events/Calendar --
// never a church-switcher entry). That is the only route into a network from the member app, so it is what the switch cuts.
//
// The REAL App from app/app.jsx, loaded with every script index.html lists (app/data.jsx included, which is
// where the member app's switch is given its value). The ON row sets window.NETWORKS_ENABLED = true BEFORE the
// scripts load — the same thing an operator would do — so the switch is the only difference between the rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeReact, appBrowser, loadApp, nodes } from './app-screens.mjs';

const NPUB = 'npub1' + '0'.repeat(58);
const NETNPUB = 'npub1' + '2'.repeat(58);
const NET = { npub: 'npub1' + '1'.repeat(58), networkPub: 'f'.repeat(64) };

function boot(flag, { seedNetwork = false, seedAsChurch = false } = {}) {
  const r = fakeReact();
  const env = appBrowser(); const window = env.window;
  if (flag !== undefined) window.NETWORKS_ENABLED = flag;
  window.Bible = { loaded: true, activeVersion: 'KJV', subscribe: () => () => {}, books: () => ['John'], maxChapter: () => 21, defaultLoc: () => ({ book: 'John', chap: 1 }) };
  window.MyData = { seedIfEmpty() {}, on: () => () => {}, list: () => [], settings: { get: () => ({}) }, count: () => 0, set: () => {} };
  window.TrinityData = {};
  const App = loadApp({ React: r.React, window, expr: 'App' });
  window.TrinityData.CHURCHES = [{ id: NPUB, npub: NPUB, name: 'Test Church' }];
  window.localStorage.setItem('trinityone.activeChurch', JSON.stringify(seedNetwork ? NETNPUB : NPUB));
  if (seedNetwork) window.localStorage.setItem('trinityone.followedChurches', JSON.stringify([{ id: NETNPUB, npub: NETNPUB, name: 'Regions Beyond', ...(seedAsChurch ? {} : { kind: 'network', sub: 'Network' }) }]));
  const calls = {}, callbacks = {};
  // REAL answers for the two clearance questions (audit of 590fa968): the catch-all below would hand back a function, which a Promise
  // resolves to a truthy non-answer -- test 2 then passed by accident rather than because the member was cleared.
  window.Fellowship = new Proxy({ myPubkey: 'dd'.repeat(32), CANONICAL_RELAYS: [], hasRelays: true, toPub: (x) => x,
    assumeMinor: () => Promise.resolve(false), minorStanding: () => Promise.resolve('unmarked') }, {
    get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'then' || typeof k === 'symbol') return undefined;
      return (...args) => { (calls[k] = calls[k] || []).push(args); const cb = args.find(a => typeof a === 'function'); if (cb) callbacks[k] = cb; return () => {}; };
    },
  });
  const draw = () => { r.reset(); const tree = App(); r.flush(); return tree; };
  return { window, calls, callbacks, draw };
}
const ctxOf = (tree) => { const n = nodes(tree).find(x => x.props && x.props.ctx && 'churchNetworks' in x.props.ctx); assert.ok(n, 'no screen received a ctx with churchNetworks — re-anchor this test'); return n.props.ctx; };

test('NETWORKS OFF (the shipped default): the member app does not follow the church\'s network', async () => {
  const m = boot(undefined);
  assert.equal(m.window.NETWORKS_ENABLED, false, 'app/data.jsx no longer gives the switch its default value');
  m.draw(); await new Promise(r => setTimeout(r, 1500)); m.draw(); m.draw();   // lazyReady flips after 1.2s; without the wait the OFF row is vacuous
  assert.equal(m.calls.subscribeChurchNetworks, undefined, 'the member app subscribed to the church\'s networks with the switch off');
  assert.equal(ctxOf(m.draw()).churchNetworks.length, 0);
});

test('NETWORKS ON (control): the same app subscribes, and a network the church belongs to reaches the screens', async () => {
  const m = boot(true);
  m.draw(); await new Promise(r => setTimeout(r, 1500)); m.draw(); m.draw();   // lazyReady flips after 1.2s; without the wait the OFF row is vacuous
  assert.ok(m.calls.subscribeChurchNetworks, 'with the switch on the member app never subscribed — the OFF test proves nothing');
  m.callbacks.subscribeChurchNetworks([NET]);
  assert.equal(ctxOf(m.draw()).churchNetworks.map(n => n.networkPub).join(), NET.networkPub, 'a followed network did not reach ctx.churchNetworks');
});

// ── A PHONE THAT ALREADY FOLLOWS A NETWORK (audit of 97587a4) ───────────────────────────────────────────
// The network was auto-followed into the stored church list, and may be the active church. Off: it is not listed,
// is not the active church, and is NOT deleted from storage; on: it is back.
const settle = async (m) => { m.draw(); await new Promise(r => setTimeout(r, 1500)); m.draw(); m.draw(); return m.draw(); };
const ctxChurches = (m) => ctxOf(m.draw()).churches.map(c => c.id);

test('NETWORKS OFF: a followed network is not listed, is not the active church, and stays in storage', async () => {
  const m = boot(undefined, { seedNetwork: true });
  await settle(m);
  assert.ok(!ctxChurches(m).includes(NETNPUB), 'a followed network is still listed (and can be switched to) with the switch off');
  assert.ok(ctxChurches(m).includes(NPUB), 're-anchor: the real church went missing too');
  assert.equal(ctxOf(m.draw()).activeChurch, NPUB, 'the active church is still the network');
  assert.match(m.window.localStorage.getItem('trinityone.followedChurches'), new RegExp(NETNPUB), 'the network was deleted from storage, so turning networks back on would not bring it back');
});
// CHANGED ON PURPOSE 2026-11-19 (Networks member step 1, owner decision "a network is never a church to a member"). This row used to be the
// control that the switch brings a followed network BACK into the switcher. It no longer does, with the switch on OR off: network content now
// reaches a member through a tab in What's happening (a-network-reaches-members-only-through-whats-happening.test.mjs). The entry still stays
// in storage (asserted above), so nothing is deleted from a phone.
test('NETWORKS ON: a stored network is STILL not listed and not the active church (a network is never a church to a member)', async () => {
  // CONTROL (audit of 590fa968): the SAME stored entry without kind 'network' IS listed -- so the entry is well-formed and reaches the list,
  // and the only thing keeping it out below is that it is a network.
  const ctl = boot(true, { seedNetwork: true, seedAsChurch: true });
  await settle(ctl);
  assert.ok(ctxChurches(ctl).includes(NETNPUB), 'CONTROL: the seeded entry is not listed even as a church, so the check below proves nothing');
  const m = boot(true, { seedNetwork: true });
  await settle(m);
  assert.ok(!ctxChurches(m).includes(NETNPUB), 'with the switch on a stored network is listed as a church');
  assert.ok(ctxChurches(m).includes(NPUB), 're-anchor: the real church went missing too');
  assert.equal(ctxOf(m.draw()).activeChurch, NPUB, 'the active church is still the network');
});
test('NETWORKS OFF: pasting a known network\'s code as a church is refused, with a message', async () => {
  const m = boot(undefined, { seedNetwork: true });
  await settle(m);
  const before = ctxChurches(m).length;
  const r = ctxOf(m.draw()).followChurch(NETNPUB);
  assert.equal(r, false, 'a network\'s code was followed as a church with the switch off');
  assert.equal(ctxChurches(m).length, before);
});
