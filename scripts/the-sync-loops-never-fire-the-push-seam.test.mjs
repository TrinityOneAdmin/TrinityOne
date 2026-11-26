// THE RELAY-TO-RELAY SYNC LOOPS NEVER FIRE THE CONTENTLESS-PUSH SEAM — F1 of the Phase-3 iOS APNs audit follow-ups.
//   node --test scripts/the-sync-loops-never-fire-the-push-seam.test.mjs
//
// The push hook (maybePushNotify) must fire from exactly ONE site: the live websocket EVENT handler, where a
// message is genuinely NEW. note() also runs on EVERY replay path — the cursor pull (syncChurchFromPeer), the
// negentropy reconcile (reconcileChurchWithPeer), /import and the boot rehydrate — and each REPLAYS old events.
// A hook copied, sibling-style, into one of those `{ imported++; note(e); }` loops would fire one push per
// message on a corpus resync: a push storm, and worse, a wake for messages the recipient read long ago.
//
// Phase-2's own test covers /import and boot. This closes the remaining gap — the two RELAY-TO-RELAY loops — by
// driving a real kind-4 DM through a genuine two-relay PEER PULL and asserting the seam fired ZERO times, while
// proving the pull is NOT vacuous: the DM and the recipient's push token both actually land on the puller, so a
// hook on the sync path WOULD have had a token-holder who canRead the message to wake. Sabotage-verified
// 2026-11-26 (scoped to syncChurchFromPeer): adding maybePushNotify(e) into its `{ imported++; note(e); }` loop
// turns this RED.
//
// The puller (DST) boots with TRINITY_PUSH_SPY_FILE, so any seam call — from any path — is recorded to a file we
// read after the pass. (That env is test-only and inert in the field; it installs a spy that SENDS nothing.)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent } from 'nostr-tools/pure';
import * as H from './relay-network-harness.mjs';
import { D } from './trinity-doc-types.mjs';

const NET = 'trinityone';
const church = H.key();
const A = H.key();   // DM sender (member)
const B = H.key();   // DM recipient (member, holds an iOS token)

let SRC, DST, spyDir, spyFile;

const member = (who, at) => finalizeEvent({ kind: 30078, created_at: at, tags: [['d', D.MEMBER + church.pub], ['t', NET]], content: JSON.stringify({ joined: at }) }, who.sk);
const token = (who, at) => finalizeEvent({ kind: 30078, created_at: at, tags: [['d', D.PUSHTOKEN + who.pub], ['t', NET]], content: JSON.stringify({ token: 'apns-' + who.pub.slice(0, 6), platform: 'ios', env: 'prod', ts: at }) }, who.sk);
const dm = (from, toPub, at) => finalizeEvent({ kind: 4, created_at: at, tags: [['p', toPub], ['t', NET]], content: 'ciphertext' }, from.sk);

const spyCount = () => { try { return readFileSync(spyFile, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };

let dmId, tokenId;

before(async () => {
  spyDir = mkdtempSync(join(tmpdir(), 'trin-syncpush-'));
  spyFile = join(spyDir, 'push-spy.ndjson');
  writeFileSync(spyFile, '');
  SRC = await H.startRelay({ name: 'SRC', churches: [church.pub] });
  DST = await H.startRelay({ name: 'DST', churches: [church.pub], env: { TRINITY_PUSH_SPY_FILE: spyFile } });

  // The church authorises BOTH boxes: DST learns SRC as a peer to pull, SRC authorises DST's relay proof.
  const relayList = H.relaysDoc(church, [SRC, DST]);
  await H.publishAll(SRC, [relayList]);
  await H.publishAll(DST, [relayList]);

  // On SRC only: A and B join; B registers an iOS token EARLIER than the DM (so the oldest-first pull processes
  // the token before the DM — a hook on the loop would then already have B in the registry when the DM stores).
  const t0 = H.now() - 300;
  await H.publishAll(SRC, [member(A, t0), member(B, t0)]);
  tokenId = (await H.publishAll(SRC, [token(B, t0 + 10)]))[0];
  dmId = (await H.publishAll(SRC, [dm(A, B.pub, t0 + 100)]))[0];
});

after(() => { H.stopAll(); try { rmSync(spyDir, { recursive: true, force: true }); } catch {} setTimeout(() => process.exit(process.exitCode || 0), 1500).unref(); });

test('the puller actually pulls the DM and the recipient token (so a zero-push result is not vacuous)', async () => {
  // Before the pull, DST holds only the church relay list.
  const before = await H.corpusIds(DST, church);
  assert.ok(!before.has(dmId), 'DST already held the DM before syncing — the pull is untested');

  const ran = await H.syncNow(DST);
  assert.equal(ran.ok, true, 'DST could not run a sync pass against SRC');
  assert.ok(ran.imported >= 3, 'DST imported fewer events than expected from SRC — the peer pull is not working: ' + JSON.stringify(ran));

  const held = await H.corpusIds(DST, church);
  assert.ok(held.has(dmId), 'the kind-4 DM did not reach DST over sync — a zero-push result would be vacuous');
  assert.ok(held.has(tokenId), "B's push token did not reach DST — DST would have no token-holder to wake, so zero-push is vacuous");
});

test('F1: driving a DM + token through the real sync loops fires the push seam ZERO times', async () => {
  // One more pass for good measure (negentropy reconcile also runs here; both loops are exercised).
  await H.syncNow(DST);
  await new Promise(r => setTimeout(r, 400));   // let any note()/async settle
  assert.equal(spyCount(), 0,
    'the push seam fired during a relay-to-relay sync — maybePushNotify has leaked onto a replay loop and every resync will storm: ' +
    (() => { try { return readFileSync(spyFile, 'utf8'); } catch { return '(spy unreadable)'; } })());
});
