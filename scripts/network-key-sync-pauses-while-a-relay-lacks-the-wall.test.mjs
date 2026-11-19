// NETWORK KEY WORK PAUSES WHILE ANY RELAY THE CHURCH WRITES TO LACKS THE WALL (B1 audit, 2026-11-19).
//   Run: node --test scripts/network-key-sync-pauses-while-a-relay-lacks-the-wall.test.mjs
//
// joinNetwork checks 'network-wall-1' once. A relay added to the church LATER, running software from before the wall, would hand a joined network
// key the church's private records. So _netSyncAll -- what the roster tick and the panel call (syncNetworkKeys) -- checks the same marker on every
// relay in relays() before any hop-1 / hop-2 work, says why it stopped, and caches only relays that DID confirm it (for the session).
// Rule 10: only the relays the church already writes to are asked; the tests below record every URL fetched.
// WHAT RUNS: the shipped engine cut out of vendor/steward.js (scripts/net-bundle-rig.mjs); fetch is a stub that records each request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { K, rnd32, tag, fakeRelay, bootConsole, scoped } from './net-bundle-rig.mjs';

const R1 = 'wss://one.example/relay', R2 = 'wss://two.example/relay';
const P = 'trinityone/';
function rig({ wallOn = { 'one.example': true, 'two.example': true }, mutate = null } = {}) {
  const relay = fakeRelay(), N = K(), A = K(), fetched = [];
  const fetchImpl = async (url) => { fetched.push(url); const host = new URL(url).host; const caps = wallOn[host] ? ['network-wall-1'] : [];
    return { ok: true, json: async () => (/\/status$/.test(new URL(url).pathname) ? { capabilities: caps } : { trinityone: { capabilities: caps } }) }; };
  const c = bootConsole({ relay, church: A, networks: [N], nameKey: rnd32(), founded: [N.pub], relayUrls: [R1, R2], fetchImpl, mutate });
  c.join(N.pub);
  return { relay, N, A, c, fetched, wallOn };
}
const keyDocs = (w) => w.c.published.filter(e => /netkeyc?:/.test(tag(e, 'd') || '')).map(e => tag(e, 'd').split(':')[0]).sort();
const onlyOwnRelays = (w) => assert.ok(w.fetched.every(u => ['one.example', 'two.example'].includes(new URL(u).host)), 'a relay the church does not write to was contacted: ' + w.fetched.join(', '));

test('CONTROL: every relay carries the wall -- the sync publishes hop-1 and hop-2', async () => {
  const w = rig();
  const r = await w.c.api.syncNetworkKeys({ force: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(keyDocs(w), ['trinityone/netkey', 'trinityone/netkeyc'], 'CONTROL: the sync did not publish both hops -- the refusal below proves nothing');
  onlyOwnRelays(w);
});

test('ONE RELAY WITHOUT THE WALL: no key work at all, the relay is named, and the status the panel reads says why', async () => {
  const w = rig({ wallOn: { 'one.example': true, 'two.example': false } });
  const r = await w.c.api.syncNetworkKeys({ force: true });
  assert.equal(r.ok, false, 'a sync ran key work while a relay lacks the wall');
  assert.deepEqual(r.wallMissing, [R2]);
  assert.match(r.reason, /paused/i); assert.match(r.reason, /two\.example/);
  assert.equal(w.c.published.length, 0, 'something was published while a relay lacks the wall');
  const st = w.c.api.networkStatus(w.N.pub);
  assert.equal(st.key, 'trouble'); assert.equal(st.reason, r.reason, 'the steward would not see why');
  onlyOwnRelays(w);
});

test('CACHE: a relay that confirmed the wall is not asked again this session; one that did not is asked again and, once updated, unblocks', async () => {
  const w = rig({ wallOn: { 'one.example': true, 'two.example': false } });
  await w.c.api.syncNetworkKeys({ force: true });
  const n1 = w.fetched.length;
  w.wallOn['two.example'] = true;   // the church updates its second relay
  const r = await w.c.api.syncNetworkKeys({ force: true });
  assert.equal(r.ok, true, 'an updated relay still blocks: a missing answer must never be cached: ' + JSON.stringify(r));
  const second = w.fetched.slice(n1);
  assert.ok(second.length > 0 && second.every(u => new URL(u).host === 'two.example'), 'the second sync re-asked a relay that had already confirmed the wall: ' + second.join(', '));
  const n2 = w.fetched.length;
  await w.c.api.syncNetworkKeys({ force: true });
  assert.equal(w.fetched.length, n2, 'a third sync asked again although every relay had confirmed the wall');
});

test('SABOTAGE: with the check in the sync removed, the same relay without the wall gets key work done through it', async () => {
  const w = rig({ wallOn: { 'one.example': true, 'two.example': false }, mutate: (s) => scoped(s, 'async function _netSyncAll(', 'async function _netPublishPost(', 'if (missing.length) {', 'if (false) {') });
  await w.c.api.syncNetworkKeys({ force: true });
  assert.ok(w.c.published.length > 0, 'THE SABOTAGE WAS NOT CAUGHT: without the check the sync still published nothing');
});
