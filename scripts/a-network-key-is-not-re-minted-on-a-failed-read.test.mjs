// THE NETWORK KEY IS NEVER RE-MINTED ON A READ THAT FAILED OR CAME BACK EMPTY (Networks MVP, N5b, C4 audit fix).
//   Run: node --test scripts/a-network-key-is-not-re-minted-on-a-failed-read.test.mjs   (SOLO)
//
// THE BUG (N5b audit, 2026-10-21): the FOUNDER console mints a fresh network ring whenever it reads no ring. But "I read
// nothing" is not "there is nothing": a dropped connection (throw) or a slow / just-restarted relay (empty answer) both read
// as nothing. Minting then publishes a ring NOBODY ELSE HAS over the real one -- every post already sealed stops opening for
// everyone, and every church added by hand is dropped. The guard `_netMintBlockers` protected every console EXCEPT the founder,
// the one that can actually overwrite.
//
// THE FIX: positive evidence only. `_readNetDoc` reports a throw as {failed:true}; `_netRingFor` surfaces it as readFailed; and
// once this console has SEEN or PUBLISHED a ring for np it records NETRING_SEEN_LS, after which an empty read is a false-empty
// and never a reason to mint. A FIRST, genuine create still mints (no ring, never seen, founder, proved, authed).
//
// WHAT RUNS: the shipped engine cut out of vendor/steward.js by the rig. Real NIP-44. The relay stand-in is wrapped so one read
// -- the netkey: read only -- can be made to throw or to come back empty on demand, which is exactly the transient failure.
// NON-VACUITY: the last test removes the fix's seen-guard from the lifted source and shows the same empty read then CLOBBERS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NET, K, rnd32, tag, fakeRelay, bootConsole, sharedFns, STEWARD } from './net-bundle-rig.mjs';

// a relay whose netkey: read can be forced to throw or return empty, while every other read (join docs) works
function flakyRelay() {
  const base = fakeRelay();
  let mode = null;   // null | 'throw' | 'empty' -- affects the netkey: read only
  const isNetkeyRead = (filters) => filters.some(f => (f['#d'] || []).some(d => String(d).startsWith('trinityone/netkey:')));
  return {
    setMode: (m) => { mode = m; },
    store: base.store, put: base.put, all: base.all, subscribeMany: base.subscribeMany,
    querySync: async (urls, filters) => {
      if (isNetkeyRead(filters)) { if (mode === 'throw') throw new Error('relay unreachable'); if (mode === 'empty') return []; }
      return base.querySync(urls, filters);
    },
  };
}

const ringOf = (relay, N) => {
  const ev = relay.all().find(e => tag(e, 'd') === 'trinityone/netkey:' + N.pub);
  if (!ev) return null;
  const ring = sharedFns(STEWARD, ['openHop1AsNetwork']).openHop1AsNetwork(ev.content, N.sk);
  return { id: ev.id, key: ring && ring[0], recipients: Object.keys(JSON.parse(ev.content).keys || {}).sort() };
};

// a founder world with a ring already published to two churches (A = the founder's own church via its join, plus B added by hand)
async function founded() {
  const relay = flakyRelay();
  const N = { ...K(), name: 'Regions Beyond' }, A = K(), B = K(), C = K();
  const cA = bootConsole({ relay, church: A, networks: [N], nameKey: rnd32(), founded: [N.pub] });
  cA.join(N.pub);
  const mint = await cA.api.syncNetworkKey(N.pub, { add: [B.pub] });
  assert.equal(mint.ok, true, 'setup: the first mint failed: ' + JSON.stringify(mint));
  assert.equal(mint.minted, true, 'setup: the first sync should MINT (no ring existed yet)');
  return { relay, N, A, B, C, cA, before: ringOf(relay, N) };
}

test('a FIRST sync genuinely mints (control: the fix does not block a real first create)', async () => {
  const w = await founded();
  assert.ok(w.before && w.before.key, 'no ring was minted on first create');
  assert.deepEqual(w.before.recipients, [w.A.pub, w.B.pub].sort(), 'the first ring should reach the founder church and the hand-added one');
});

test('a THROW on the netkey read does NOT re-mint -- it waits, and the ring is untouched', async () => {
  const w = await founded();
  w.relay.setMode('throw');
  const r = await w.cA.api.syncNetworkKey(w.N.pub, { add: [w.C.pub] });
  assert.equal(r.ok, false, 'a failed read must not report success');
  assert.equal(r.waiting, true, 'a failed read must say it is waiting, not act');
  assert.notEqual(r.minted, true, 'a failed read must NEVER mint');
  w.relay.setMode(null);
  const after = ringOf(w.relay, w.N);
  assert.equal(after.id, w.before.id, 'the stored ring was replaced after a failed read');
  assert.equal(after.key, w.before.key, 'the ring KEY changed after a failed read -- old posts would stop opening');
});

test('an EMPTY netkey read (slow / restarted relay) does NOT re-mint -- false-empty is not "no ring"', async () => {
  const w = await founded();
  w.relay.setMode('empty');
  const r = await w.cA.api.syncNetworkKey(w.N.pub, { add: [w.C.pub] });
  assert.equal(r.ok, false, 'an empty read must not report success');
  assert.equal(r.waiting, true, 'an empty read must say it is waiting');
  assert.notEqual(r.minted, true, 'an empty read must NEVER mint over a ring this console has already seen');
  w.relay.setMode(null);
  const after = ringOf(w.relay, w.N);
  assert.equal(after.key, w.before.key, 'the ring KEY changed after an empty read -- the key-wipe bug');
  assert.deepEqual(after.recipients, w.before.recipients, 'recipients were dropped after an empty read');
});

test('once the relay is readable again, a normal add re-seals the SAME ring (old posts still open) and does not mint', async () => {
  const w = await founded();
  w.relay.setMode('empty');
  await w.cA.api.syncNetworkKey(w.N.pub, { add: [w.C.pub] });   // refused above; now recover
  w.relay.setMode(null);
  const r = await w.cA.api.syncNetworkKey(w.N.pub, { add: [w.C.pub] });
  assert.equal(r.ok, true, 'a readable add should succeed: ' + JSON.stringify(r));
  assert.notEqual(r.minted, true, 'adding a church must re-seal, not mint a new ring');
  const after = ringOf(w.relay, w.N);
  assert.equal(after.key, w.before.key, 'the ring key must be unchanged by an add (old posts keep opening)');
  assert.deepEqual(after.recipients, [w.A.pub, w.B.pub, w.C.pub].sort(), 'C should now be a recipient');
});

test('NON-VACUITY: with the seen-guard removed, the SAME empty read CLOBBERS the ring (the fix is what prevents it)', async () => {
  const relay = flakyRelay();
  const N = { ...K() }, A = K(), B = K(), C = K();
  const sabotage = (src) => {
    // the seen-guard exactly as esbuild emits it into vendor/steward.js (double-quoted). Remove just this one statement.
    const GUARD = 'if (lsGet(NETRING_SEEN_LS + np) === "1") return { ok: false, waiting: true, reason: "The network key could not be read just now; a new one will not be minted over the existing one." };';
    assert.ok(src.includes(GUARD), 'sabotage anchor (the C4 seen-guard) did not match the bundle -- re-anchor this test, do not delete it');
    const out = src.replace(GUARD, '/* sabotaged: C4 seen-guard removed */');
    assert.equal(src.split(GUARD).length, 2, 'the seen-guard anchor is not unique in the lifted engine');
    return out;
  };
  const cA = bootConsole({ relay, church: A, networks: [N], nameKey: rnd32(), founded: [N.pub], mutate: sabotage });
  cA.join(N.pub);
  const mint = await cA.api.syncNetworkKey(N.pub, { add: [B.pub] });
  assert.equal(mint.minted, true, 'setup mint');
  const before = ringOf(relay, N);
  relay.setMode('empty');
  const r = await cA.api.syncNetworkKey(N.pub, { add: [C.pub] });
  relay.setMode(null);
  const after = ringOf(relay, N);
  // the point: without the guard the empty read is taken as "no ring" and a fresh one is minted over the real one.
  // PORT NOTE (B1 audit fix, 2026-11-19): the FIRST ring key is now derived from the network secret (firstNetKey), so a re-mint makes the SAME key
  // and old posts keep opening -- that is the second line of defence working. What the re-mint still destroys is the RECIPIENT LIST: the empty
  // read saw no envelope, so the church added by hand (B) is gone from the new one. The guard is what prevents that.
  assert.equal(r.minted, true, 'with the guard gone, an empty read should mint (this is the bug the fix prevents)');
  assert.equal(after.key, before.key, 'a re-mint of the first ring must make the SAME derived key (firstNetKey)');
  assert.ok(!after.recipients.includes(B.pub), 'with the guard gone, the re-mint should have dropped the hand-added church from the envelope');
});

test('a failed netkey read during HOP-2 re-seal waits, it does not crash on a null ring (_netSyncHop2 caller)', async () => {
  const w = await founded();
  const ok2 = await w.cA.api.syncNetworkHop2(w.N.pub);
  assert.equal(ok2.ok, true, 'hop-2 should succeed when the ring is readable: ' + JSON.stringify(ok2));
  w.relay.setMode('throw');
  const r = await w.cA.api.syncNetworkHop2(w.N.pub);   // before the fix this threw: cur.ring was null and the code did cur.ring.join(',')
  assert.equal(r.ok, false, 'a failed read during hop-2 must not report success');
  assert.equal(r.waiting, true, 'a failed read during hop-2 must say it is waiting');
});
