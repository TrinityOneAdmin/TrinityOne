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

// (re-anchored 2026-11-19: the check is now one gate, _netWallGate, used by the sync and by every step under it)
test('SABOTAGE: with the wall gate removed, the same relay without the wall gets key work done through it', async () => {
  const w = rig({ wallOn: { 'one.example': true, 'two.example': false }, mutate: (s) => scoped(s, 'async function _netWallGate(', 'async function _netWallCheckCached(', 'if (!lacking.length && !unreachable.length) return null;', 'return null;') });   // (re-anchored B2a audit: the gate now tells unreachable from lacking)
  await w.c.api.syncNetworkKeys({ force: true });
  assert.ok(w.c.published.length > 0, 'THE SABOTAGE WAS NOT CAUGHT: without the check the sync still published nothing');
});

// ── re-audit 2026-11-19: every API way in is covered, and "no relay yet" is waiting, not trouble ─────────────────────────────────────────────
test('A RELAY ADDED LATER WITHOUT THE WALL: publishNetworkPost, syncNetworkKey and syncNetworkHop2 each refuse and name it; nothing is published', async () => {
  const urls = [R1];
  const relay = fakeRelay(), N = K(), A = K(), wallOn = { 'one.example': true, 'two.example': false };
  const fetchImpl = async (url) => { const caps = wallOn[new URL(url).host] ? ['network-wall-1'] : []; return { ok: true, json: async () => ({ trinityone: { capabilities: caps }, capabilities: caps }) }; };
  const mk = (mutate) => { const c = bootConsole({ relay, church: A, networks: [N], nameKey: rnd32(), founded: [N.pub], relayUrls: urls, fetchImpl, mutate }); return c; };
  const c = mk(); c.join(N.pub);
  assert.equal((await c.api.syncNetworkKeys({ force: true })).ok, true, 'setup: the first sync (one relay, with the wall) failed');
  assert.equal((await c.api.publishNetworkPost(N.pub, 'announcement', { text: 'before' })).ok, true, 'CONTROL: posting works while every relay carries the wall');
  urls.push(R2);   // the church adds a relay running old software
  const n = c.published.length;
  const post = await c.api.publishNetworkPost(N.pub, 'announcement', { text: 'after' });
  assert.equal(post.ok, false, 'a post went out while one of the church\'s relays lacks the wall'); assert.deepEqual(post.wallMissing, [R2]); assert.match(post.reason, /two\.example/);
  const k = await c.api.syncNetworkKey(N.pub, { add: [K().pub] });
  assert.equal(k.ok, false); assert.deepEqual(k.wallMissing, [R2]);
  const h = await c.api.syncNetworkHop2(N.pub, { force: true });
  assert.equal(h.ok, false); assert.deepEqual(h.wallMissing, [R2]);
  assert.equal(c.published.length, n, 'something was published through the API while a relay lacks the wall');
  // SABOTAGE: the gate removed from the post path only -> the same post goes out
  const s = mk((src) => scoped(src, 'async function _netPublishPost(', 'async function _netRemovePost(', 'const wall = await _netWallGate();\n    if (wall) return', 'const wall = null;\n    if (wall) return'));
  assert.equal((await s.api.publishNetworkPost(N.pub, 'announcement', { text: 'sabotaged' })).ok, true, 'THE SABOTAGE WAS NOT CAUGHT: without the gate in the post path the post was still refused');
});

test('NO RELAY READY YET (boot): the status says waiting, not trouble -- and the next sync is not throttled; SABOTAGE (stamping the sync) throttles it', async () => {
  const mk = (mutate) => { const relay = fakeRelay(), N = K(), A = K(); const c = bootConsole({ relay, church: A, networks: [N], nameKey: rnd32(), founded: [N.pub], relayUrls: [], mutate }); c.join(N.pub); return { c, N }; };
  const { c, N } = mk();
  const r = await c.api.syncNetworkKeys({ force: true });
  assert.equal(r.ok, false); assert.equal(r.waiting, true);
  assert.equal(c.api.networkStatus(N.pub).key, 'waiting', 'a console with no relay ready yet shows TROUBLE to the steward');
  assert.match(c.api.networkStatus(N.pub).reason, /connecting/i);
  const again = await c.api.syncNetworkKeys();   // NOT forced: a roster tick a moment later
  assert.notEqual(again.skipped, true, 'the next sync was throttled for 30s although the first one never ran');
  const s = mk((src) => scoped(src, 'async function _netSyncAll(', 'async function _netPublishPost(', 'if (wall.waiting && !(wall.unreachable && wall.unreachable.length)) _netSyncAt = 0;', ''));   // (re-anchored B2a audit)
  await s.c.api.syncNetworkKeys({ force: true });
  assert.equal((await s.c.api.syncNetworkKeys()).skipped, true, 'THE SABOTAGE WAS NOT CAUGHT: with the sync stamped, the next call still ran');
});

// ── B2a audit (2026-11-19): an UNREACHABLE relay is not a relay "without the wall", and a SHIPPED relay is never something to remove ──────────
const SHIPPED = 'wss://app.trinityone.church/relay';
function rig2(hosts) {   // hosts: host -> 'ok' | 'none' (answers without the marker) | 'down' (no answer)
  const relay = fakeRelay(), N = K(), A = K();
  const fetchImpl = async (url) => { const m = hosts[new URL(url).host] || 'ok'; if (m === 'down') throw new Error('unreachable'); const caps = m === 'ok' ? ['network-wall-1'] : [];
    return { ok: true, json: async () => ({ trinityone: { capabilities: caps }, capabilities: caps }) }; };
  const urls = Object.keys(hosts).map(h => h === 'app.trinityone.church' ? SHIPPED : 'wss://' + h + '/relay');
  const c = bootConsole({ relay, church: A, networks: [N], nameKey: rnd32(), founded: [N.pub], relayUrls: urls, fetchImpl }); c.join(N.pub);
  return { c, N };
}
test('UNREACHABLE: a relay that does not answer is "couldn\'t reach … try again later" (waiting, still nothing published) -- never "update or remove it"', async () => {
  const { c, N } = rig2({ 'one.example': 'ok', 'two.example': 'down' });
  const r = await c.api.syncNetworkKeys({ force: true });
  assert.equal(r.ok, false); assert.equal(r.waiting, true, 'an unreachable relay is a transient: the status must say waiting');
  assert.deepEqual(r.unreachable, ['wss://two.example/relay']); assert.deepEqual(r.lacking, []);
  assert.match(r.reason, /Couldn’t reach wss:\/\/two\.example\/relay/); assert.match(r.reason, /try again later/);
  assert.doesNotMatch(r.reason, /remove|Update/, 'an unreachable relay was called out of date / something to remove');
  assert.equal(c.api.networkStatus(N.pub).key, 'waiting');
  assert.equal(c.published.length, 0, 'fail-closed: nothing may be published while a relay could not be checked');
  const p = await c.api.publishNetworkPost(N.pub, 'announcement', { text: 'x' });
  assert.equal(p.ok, false); assert.match(p.reason, /Couldn’t reach/);
});
test('SHIPPED RELAY without the marker: named, but the steward is never told to remove it; a CHURCH relay without it still is (control)', async () => {
  const a = rig2({ 'app.trinityone.church': 'none' });
  const r = await a.c.api.syncNetworkKeys({ force: true });
  assert.equal(r.ok, false); assert.match(r.reason, /app\.trinityone\.church/);
  assert.doesNotMatch(r.reason, /remove/i, 'the steward was told to remove a SHIPPED relay -- they cannot');
  assert.match(r.reason, /nothing to change on your side/);
  const b = rig2({ 'old.example': 'none' });
  const rb = await b.c.api.syncNetworkKeys({ force: true });
  assert.match(rb.reason, /old\.example/); assert.match(rb.reason, /remove it from this church’s relays/, 'CONTROL: a church\'s own old relay is no longer offered for removal');
  // mixed: both named, each with its own advice
  const m = rig2({ 'app.trinityone.church': 'none', 'old.example': 'none', 'gone.example': 'down' });
  const rm = await m.c.api.syncNetworkKeys({ force: true });
  assert.match(rm.reason, /old\.example\/relay has not confirmed it runs/); assert.match(rm.reason, /The shared relay wss:\/\/app\.trinityone\.church\/relay has not confirmed/); assert.match(rm.reason, /Couldn’t reach wss:\/\/gone\.example/);
});
