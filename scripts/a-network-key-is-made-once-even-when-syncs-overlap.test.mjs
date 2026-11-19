// A NETWORK'S FIRST KEY IS MADE ONCE, EVEN WHEN TWO SYNCS OVERLAP -- AND A REPEATED FIRST-MINT MAKES THE SAME KEY (B1 audit, 2026-11-19).
//   Run: node --test scripts/a-network-key-is-made-once-even-when-syncs-overlap.test.mjs
//
// THE BUG (audit, reproduced with a 300ms publish delay): on a brand-new network two key syncs that overlap -- a post sent while the roster tick is
// syncing -- both read "no key yet" and both mint. The second envelope replaces the first, and anything sealed under the first never opens again.
// TWO FIXES, each proved here and each sabotaged in the lifted source:
//   (a) _netSyncKey queues behind any run already in flight for the same network (every way in: syncNetworkKey, publishNetworkPost, the sync-all);
//   (b) the FIRST ring key is derived from the network secret (firstNetKey, HKDF-SHA256), so a first-mint that slips past (a) -- another console,
//       a relay that wrongly said "none" -- makes the identical key.
// WHAT RUNS: the shipped engine cut out of vendor/steward.js (scripts/net-bundle-rig.mjs) over a relay stand-in whose writes take 300ms. Real NIP-44.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { K, rnd32, tag, fakeRelay, bootConsole, sharedFns, scoped, STEWARD } from './net-bundle-rig.mjs';

const P = 'trinityone/';
const slowRelay = () => { const b = fakeRelay(); return { ...b, put: async (e) => { await new Promise(r => setTimeout(r, 300)); return b.put(e); } }; };
const keyOf = (relay, N) => { const ev = relay.all().find(e => tag(e, 'd') === P + 'netkey:' + N.pub); const r = ev && sharedFns(STEWARD, ['openHop1AsNetwork']).openHop1AsNetwork(ev.content, N.sk); return r && r[0]; };
const netkeysPublished = (c, N) => c.published.filter(e => tag(e, 'd') === P + 'netkey:' + N.pub).length;
const LOCK = ['async function _netSyncKey(', 'async function _netSyncKeyOnce('];
const MINT = ['async function _netSyncKeyOnce(', 'async function _netSyncHop2('];
const noLock = (s) => scoped(s, LOCK[0], LOCK[1], 'if (prev) {\n        try {\n          await prev;\n        } catch (e) {\n        }\n      }', '');
const randomFirst = (s) => scoped(s, MINT[0], MINT[1], 'const k0 = await firstNetKey(nsk);', 'const k0 = rotateRing([])[0];');
const world = async (mutate) => { const relay = slowRelay(), N = K(), A = K(); const c = bootConsole({ relay, church: A, networks: [N], nameKey: rnd32(), founded: [N.pub], mutate }); await c.join(N.pub); return { relay, N, A, c }; };

test('(a) TWO SYNCS AT ONCE on a new network: exactly one mint, one envelope published, and both callers see success', async () => {
  const w = await world();
  const [r1, r2] = await Promise.all([w.c.api.syncNetworkKey(w.N.pub), w.c.api.syncNetworkKey(w.N.pub)]);
  assert.equal(r1.ok, true, JSON.stringify(r1)); assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal([r1, r2].filter(r => r.minted).length, 1, 'two overlapping syncs both minted a ring');
  assert.equal(netkeysPublished(w.c, w.N), 1, 'two overlapping syncs published two envelopes');
});

test('(a) A POST SENT WHILE THE SYNC RUNS: one envelope, and the post opens under the ring that stayed', async () => {
  const w = await world();
  const [s, p] = await Promise.all([w.c.api.syncNetworkKey(w.N.pub), w.c.api.publishNetworkPost(w.N.pub, 'announcement', { text: 'first post' })]);
  assert.equal(s.ok, true, JSON.stringify(s)); assert.equal(p.ok, true, JSON.stringify(p));
  assert.equal(netkeysPublished(w.c, w.N), 1, 'the post and the sync each minted an envelope');
  const post = w.relay.all().find(e => tag(e, 'd') === P + 'netann:' + p.id);
  assert.ok(sharedFns(STEWARD, ['openPost']).openPost(post.content, [keyOf(w.relay, w.N)]), 'the post does not open under the ring that is on the relay');
});

test('(a) SABOTAGE: with the per-network queue removed, the same two overlapping syncs both mint', async () => {
  const w = await world(noLock);
  const rs = await Promise.all([w.c.api.syncNetworkKey(w.N.pub), w.c.api.syncNetworkKey(w.N.pub)]);
  assert.equal(rs.filter(r => r.minted).length, 2, 'THE SABOTAGE WAS NOT CAUGHT: without the queue the overlapping syncs still minted only once');
});

test('(b) A SECOND FIRST-MINT (another console, which could not see the first envelope) makes the IDENTICAL key -- the HKDF of the network secret', async () => {
  const w = await world();
  assert.equal((await w.c.api.syncNetworkKey(w.N.pub)).minted, true);
  const k1 = keyOf(w.relay, w.N);
  await new Promise(r => setTimeout(r, 1100));   // the second console's clock second must be later, or the stand-in keeps the first copy
  const hidden = { ...w.relay, querySync: async (u, f) => (await w.relay.querySync(u, f)).filter(e => !tag(e, 'd').startsWith(P + 'netkey:')) };
  const c2 = bootConsole({ relay: hidden, church: w.A, networks: [w.N], nameKey: rnd32(), founded: [w.N.pub] });   // fresh device storage, founder flag
  const r = await c2.api.syncNetworkKey(w.N.pub);
  assert.equal(r.minted, true, 'setup: the second console should have minted (it saw no envelope): ' + JSON.stringify(r));
  assert.equal(keyOf(w.relay, w.N), k1, 'a second first-mint made a DIFFERENT key -- every post sealed under the first would stop opening');
  const expect = await sharedFns(STEWARD, ['firstNetKey']).firstNetKey(w.N.sk);
  assert.equal(k1, expect, 'the first key is not the HKDF of the network secret the shared module defines');
  assert.notEqual(await sharedFns(STEWARD, ['firstNetKey']).firstNetKey(K().sk), expect, 'two networks derived the same first key');
});

test('(b) SABOTAGE: with a random first key, the second first-mint makes a different key', async () => {
  const w = await world(randomFirst);
  assert.equal((await w.c.api.syncNetworkKey(w.N.pub)).minted, true);
  const k1 = keyOf(w.relay, w.N);
  await new Promise(r => setTimeout(r, 1100));   // the second console's clock second must be later, or the stand-in keeps the first copy
  const hidden = { ...w.relay, querySync: async (u, f) => (await w.relay.querySync(u, f)).filter(e => !tag(e, 'd').startsWith(P + 'netkey:')) };
  const c2 = bootConsole({ relay: hidden, church: w.A, networks: [w.N], nameKey: rnd32(), founded: [w.N.pub], mutate: randomFirst });
  assert.equal((await c2.api.syncNetworkKey(w.N.pub)).minted, true);
  assert.notEqual(keyOf(w.relay, w.N), k1, 'THE SABOTAGE WAS NOT CAUGHT: random first keys still matched');
});

test('(b) A ROTATION (a church left) is still a RANDOM new key in front of the old one -- the departed church never held it', async () => {
  const w = await world(); const B = K();
  assert.equal((await w.c.api.syncNetworkKey(w.N.pub, { add: [B.pub] })).minted, true);
  const k1 = keyOf(w.relay, w.N);
  const r = await w.c.api.syncNetworkKey(w.N.pub, { drop: [B.pub] });
  assert.equal(r.rotated, true, JSON.stringify(r));
  const ev = w.relay.all().find(e => tag(e, 'd') === P + 'netkey:' + w.N.pub);
  const ring = sharedFns(STEWARD, ['openHop1AsNetwork']).openHop1AsNetwork(ev.content, w.N.sk);
  assert.equal(ring[1], k1, 'the first key must stay behind the new one'); assert.notEqual(ring[0], k1);
  assert.notEqual(ring[0], await sharedFns(STEWARD, ['firstNetKey']).firstNetKey(w.N.sk), 'a rotation re-used the derived first key');
});
