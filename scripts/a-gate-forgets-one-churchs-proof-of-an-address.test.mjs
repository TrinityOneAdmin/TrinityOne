// G3 3.2: createRelayGate().forgetScope(url, cp) removes ONE church's proof of an address and nothing else.
//   Run: node --test scripts/a-gate-forgets-one-churchs-proof-of-an-address.test.mjs
// Users of createRelayGate (listed because the method is on the shared gate): src/fellowship.src.js (_gate, member app),
// src/steward.src.js (console gate). Only _dropRevokedNetDocRows in fellowship.src.js calls forgetScope.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRelayGate, rememberVerified } from '../src/relay-net.src.js';

const A = 'aa'.repeat(32), B = 'bb'.repeat(32), KEY = 'cc'.repeat(32), URL_ = 'wss://box.example/relay';
const T = 1_800_000_000;
const gate = () => createRelayGate({ store: null, now: () => T + 10, verify: async () => null });

test('forgetScope removes church A\'s proof; church B\'s proof of the same machine stays', () => {
  const g = gate();
  rememberVerified(g._map, URL_, KEY, A, T); rememberVerified(g._map, URL_, KEY, B, T);
  assert.ok(g.admits(URL_, A) && g.admits(URL_, B), 'control: both admitted');
  assert.equal(g.forgetScope(URL_, A), true);
  assert.equal(g.admits(URL_, A), false, 'A still admitted');
  assert.equal(g.admits(URL_, B), true, 'B lost its proof');
});
test('forgetScope on the only scope removes the entry', () => {
  const g = gate();
  rememberVerified(g._map, URL_, KEY, A, T);
  assert.equal(g.forgetScope(URL_, A), true);
  assert.equal(g._map.size, 0);
});
test('forgetScope never removes the church-independent scope (canonical / same-origin), and says it did nothing', () => {
  const g = gate();
  rememberVerified(g._map, URL_, KEY, '', T);
  assert.equal(g.forgetScope(URL_, A), false);
  assert.equal(g.admits(URL_, A), true, 'a church-independent proof was removed by one church\'s revoke');
});
test('forgetScope with no church, or an unknown address, does nothing', () => {
  const g = gate();
  rememberVerified(g._map, URL_, KEY, A, T);
  assert.equal(g.forgetScope(URL_, ''), false);
  assert.equal(g.forgetScope('wss://other/relay', A), false);
  assert.equal(g.admits(URL_, A), true);
});
