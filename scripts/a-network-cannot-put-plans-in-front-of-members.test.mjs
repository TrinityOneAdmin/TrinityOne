// A NETWORK CANNOT PUT READING PLANS IN FRONT OF A CHURCH'S MEMBERS (Networks port, 2026-11-18; plan audit M1).
//   Run: node --test scripts/a-network-cannot-put-plans-in-front-of-members.test.mjs
//
// The member app used to read every joined network AS IF IT WERE A CHURCH for reading plans (subscribeChurchPlans(networkNpub)) and merge them
// into the church's own plan list. Since N5a a network key may write only its own net* documents, so no such plan can exist on a walled relay --
// and the path was never child-gated, so on an old relay a network could have put a "plan" in front of a marked child. It is removed.
//
// POINT OF USE: the REAL App (app/app.jsx, mounted through scripts/app-screens.mjs) with Networks switched ON and a joined network delivered. It
// must never subscribe to plans from the network, while the church's own plan subscription is opened and its plans DO reach the screens (the
// control: the harness sees a plan subscription when one exists). Rule 3: nothing here matches text in app/*.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeReact, appBrowser, loadApp, nodes } from './app-screens.mjs';

const CHURCH = 'npub1' + '0'.repeat(58);
const NETHEX = 'ab'.repeat(32), NETNPUB = 'npub1' + 'q'.repeat(10) + 'x'.repeat(40) + 'wxyz';
const settle = () => new Promise(r => setTimeout(r, 1600));

test('the member app opens NO plan subscription for a joined network, and network plans never reach churchPlans (CONTROL: the church\'s own plans do)', async () => {
  const r = fakeReact(); const env = appBrowser(); const window = env.window;
  const calls = [];   // every Fellowship call that took a callback: [method, firstArg, callback]
  window.NETWORKS_ENABLED = true;
  window.Bible = { loaded: true, activeVersion: 'KJV', subscribe: () => () => {}, books: () => ['John'], maxChapter: () => 21, defaultLoc: () => ({ book: 'John', chap: 1 }) };
  window.MyData = { seedIfEmpty() {}, on: () => () => {}, list: () => [], settings: { get: () => ({}) }, count: () => 0, set: () => {} };
  window.TrinityData = {};
  const App = loadApp({ React: r.React, window, expr: 'App' });
  window.TrinityData.CHURCHES = [{ id: CHURCH, npub: CHURCH, name: 'Test Church' }];
  window.localStorage.setItem('trinityone.activeChurch', JSON.stringify(CHURCH));
  window.Fellowship = new Proxy({ myPubkey: 'deadbeef', CANONICAL_RELAYS: [], hasRelays: true, assumeMinor: () => Promise.resolve(false) },
    { get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'then' || typeof k === 'symbol') return undefined;
      return (...args) => { const f = args.find(a => typeof a === 'function'); if (f) calls.push([k, args[0], f]); return () => {}; };
    } });
  const draw = () => { r.reset(); const tree = App(); r.flush(); return tree; };
  const last = (k, arg) => [...calls].reverse().find(c => c[0] === k && (arg === undefined || c[1] === arg));
  draw(); await settle(); draw();
  // the church has joined one network
  const nets = last('subscribeChurchNetworks'); assert.ok(nets, 'setup: the App never asked which networks the church joined (is the switch on?)');
  nets[2]([{ networkPub: NETHEX, npub: NETNPUB }]); draw(); await new Promise(r => setTimeout(r, 50)); draw(); await settle(); draw();
  // CONTROL: the church's own plans are subscribed and reach the screens
  const own = last('subscribeChurchPlans', CHURCH);
  assert.ok(own, 'CONTROL: the App opened no plan subscription for the church itself -- the harness cannot see one, so the check below proves nothing');
  own[2]([{ id: 'p1', title: 'Church plan', days: [1, 2, 3] }]); draw(); await new Promise(r => setTimeout(r, 50));
  const ctx = (nodes(draw()).find(n => n.props && n.props.ctx && Array.isArray(n.props.ctx.churchPlans)) || {}).props.ctx;
  assert.ok(ctx && ctx.churchPlans.some(p => p.title === 'Church plan'), 'CONTROL: the church\'s own plan did not reach the screens');
  // THE CLAIM: no plan subscription was ever opened for the network
  assert.deepEqual(calls.filter(c => c[0] === 'subscribeChurchPlans' && c[1] === NETNPUB).map(c => c[1]), [], 'the member app read a NETWORK as a church for reading plans');
  assert.ok(!ctx.churchPlans.some(p => p._network), 'a network plan reached the church\'s plan list');
});
