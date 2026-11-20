// A RELAY RECONNECT DOES NOT SWITCH A STEWARD OUT OF THE NETWORK VIEW (Networks port, B2a, 2026-11-19; plan audit M4).
//   Run: node --test scripts/a-reconnect-keeps-the-network-view.test.mjs
//
// THE BUG. subscribeStewardedChurches' restore block re-runs on EVERY connection change (app/steward-root.jsx re-subscribes on `conn`). A steward
// viewing a network has actingChurch === '', so the "go back to the remembered church" branch -- and the blank-helper auto-land -- fired on any relay
// blip and snapped them out of the network. The live-grant branch (a church they deliberately asked to join has just let them in) must still open.
//
// POINT OF USE: the restore block itself, cut out of the SHIPPED vendor/steward.js exactly as scripts/console-remembers-its-church.test.mjs does,
// with the real own-key predicates lifted from the bundle. window.Steward.isViewingNetwork is the API the block asks (as the console has it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const V = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const OWN = 'a'.repeat(64), ST_AIDANS = 'b'.repeat(64), ASKED = 'e'.repeat(64);
const PEND = (/var PENDING_CHURCH_KEY = ("[^"]+")/.exec(V) || [])[1];

function restore({ stewarded, stored = null, pend = null, viewingNetwork, ownNamed = true, mutate = null }) {
  const body = stripComments(fnBody(V, 'subscribeStewardedChurches(cb)', 'subscribeStewardedChurches'));
  const at = body.indexOf('const want =');
  assert.notEqual(at, -1, 're-anchor: the restore block is gone from subscribeStewardedChurches');
  let block = body.slice(at, body.indexOf('} catch', at));
  if (mutate) block = mutate(block);
  const calls = [];
  const OWN_NAME_LS = 'trinityone.steward.ownname.', SELFREG_KEY = 'trinityone.steward.selfreg';
  const store = new Map();
  if (stored !== null) store.set('k', stored);
  if (pend !== null) store.set(JSON.parse(PEND), pend);
  if (ownNamed) store.set(OWN_NAME_LS + OWN, 'Our Parish');
  const lsGet = (key) => (store.has(key) ? store.get(key) : null);
  const scope = {
    localStorage: { getItem: lsGet, removeItem: (k) => store.delete(k) }, lsGet,
    ACTIVE_ID_KEY: 'k', PENDING_CHURCH_KEY: JSON.parse(PEND), churchPub: OWN, actingChurch: '',
    OWN_NAME_LS, SELFREG_KEY, _ownedPubs: new Set([OWN]),
    stewardedChurches: new Map(stewarded.map(c => [c, {}])),
    window: { Steward: { setActiveIdentity: (t) => calls.push(t), isViewingNetwork: () => viewingNetwork } }, console,
  };
  const proxy = new Proxy(scope, { has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => (k === Symbol.unscopables ? undefined : t[k]), set: (t, k, v) => { t[k] = v; return true; } });
  const lift = (anchor, name) => new Function('scope', `with (scope) { return (${fnBody(V, anchor, name)}); }`)(proxy);
  scope._ownChurchName = lift('function _ownChurchName() {', '_ownChurchName');
  scope._ownKeyRegistered = lift('function _ownKeyRegistered() {', '_ownKeyRegistered');
  scope._ownKeyBlank = lift('function _ownKeyBlank() {', '_ownKeyBlank');
  new Function('scope', `with (scope) { ${block} }`)(proxy);
  return calls;
}
const NO_GUARD = (b) => { const g = '&& !(window.Steward && window.Steward.isViewingNetwork && window.Steward.isViewingNetwork())'; assert.equal(b.split(g).length - 1, 2, 'sabotage: expected the guard on exactly two branches'); return b.split(g).join(''); };

test('setup: the shipped bundle names the pending-request key the block reads', () => { assert.ok(PEND, 're-anchor: PENDING_CHURCH_KEY not found in vendor/steward.js'); });

test('CONTROL: NOT in a network view, a reconnect re-enters the remembered church (unchanged behaviour)', () => {
  assert.deepEqual(restore({ stewarded: [ST_AIDANS], stored: ST_AIDANS, viewingNetwork: false }), [ST_AIDANS]);
});

test('IN A NETWORK VIEW: a reconnect leaves the steward in the network -- no remembered-church switch, no blank-helper auto-land', () => {
  assert.deepEqual(restore({ stewarded: [ST_AIDANS], stored: ST_AIDANS, viewingNetwork: true }), [], 'a relay reconnect snapped the steward out of the network view');
  assert.deepEqual(restore({ stewarded: [ST_AIDANS], ownNamed: false, viewingNetwork: true }), [], 'the blank-helper auto-land snapped a network view back to a stewarded church');
  assert.deepEqual(restore({ stewarded: [ST_AIDANS], ownNamed: false, viewingNetwork: false }), [ST_AIDANS], 'CONTROL: the auto-land itself still works outside a network view');
});

test('IN A NETWORK VIEW: the church they deliberately asked to join, now granted, still opens (the live-grant behaviour is kept)', () => {
  assert.deepEqual(restore({ stewarded: [ASKED], pend: ASKED, viewingNetwork: true }), [ASKED]);
});

test('SABOTAGE: with the network-view guard taken off both branches, the reconnect snaps the steward out again', () => {
  assert.deepEqual(restore({ stewarded: [ST_AIDANS], stored: ST_AIDANS, viewingNetwork: true, mutate: NO_GUARD }), [ST_AIDANS], 'THE SABOTAGE WAS NOT CAUGHT');
});
