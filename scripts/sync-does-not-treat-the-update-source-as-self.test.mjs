// A Suite box back-fills a church from its HOME relay, even when that relay is the box's update source.
// Run: node --test scripts/sync-does-not-treat-the-update-source-as-self.test.mjs
//
// THE BUG THIS PINS (found 2026-10-16, testing the Suite relay on macOS):
// syncAllChurches() decided which peer was "itself" from ORIGIN — the box's UPDATE SOURCE. On a dev/server
// relay ORIGIN happens to be the box's own address, so that worked. On a *Suite* box ORIGIN is the community
// download source, https://app.trinityone.church — which is also the relay most churches are homed on. So the
// box treated its own home relay as "self" and SKIPPED it, while syncing from its own address instead. A
// church that moved onto a self-hosted Suite box therefore back-filled NOTHING: imported stayed 0 forever,
// with full authorisation and the whole corpus sitting one authorised pull away.
//
// The existing network harness never caught it because it writes each relay's `origin` to the relay's OWN
// base (so ORIGIN == self, the one case the old check got right). Here B's origin is A's address — a Suite
// box whose update source is its home relay — which is the case that was broken.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as H from './relay-network-harness.mjs';

const church = H.key();
let A, B, relayList, aIds = [];

before(async () => {
  // A — the church's HOME relay (stands in for app.trinityone.church): holds the corpus.
  A = await H.startRelay({ name: 'A', churches: [church.pub] });
  // B — a SUITE box the church just added. Its update source (origin) is the HOME relay A, NOT its own
  // address — exactly what every packaged Suite relay has (origin = the community download source).
  B = await H.startRelay({ name: 'B', churches: [church.pub], origin: A.base });

  // The church authorises BOTH A and B as trusted infrastructure (pubkey + url each).
  relayList = H.relaysDoc(church, [A, B]);
  for (const r of [A, B]) await H.publishAll(r, [relayList]);

  // The church's actual content lives on A (its home relay). B starts with only the relay list.
  aIds = await H.publishAll(A, [1, 2, 3].map(n => H.churchDoc(church, `trinityone/notice:a${n}`, { text: `from A ${n}` })));
});

after(() => { H.stopAll(); setTimeout(() => process.exit(process.exitCode || 0), 2000).unref(); });

test('B and A are distinct boxes, and B\'s update source is A (the condition under test)', async () => {
  assert.notEqual(A.relayPub, B.relayPub, 'A and B share an identity key, so "sync from self" is untestable');
  assert.notEqual(A.base, B.base, 'A and B share an address');
  const st = await B.status();
  assert.equal(st.origin, A.base, 'B is not configured with A as its update source — the bug condition is not set up');
});

test('B holds only the relay list before syncing; A holds the full corpus', async () => {
  assert.deepEqual([...(await H.corpusIds(B, church))], [relayList.id], 'B started with more than the relay list');
  assert.equal((await H.corpusIds(A, church)).size, 4, 'A did not store the relay list + 3 notices');
});

test('B back-fills the church from its home relay A (not from itself)', async () => {
  const ran = await H.syncNow(B);
  assert.equal(ran.ok, true, 'B could not run a sync pass');
  // Point of use: the church documents that live on A must now be on B. This is the assertion that fails if
  // the box skips its home relay as "self" — deleting the fix leaves B empty here, not merely slow.
  const onB = await H.corpusIds(B, church);
  for (const id of aIds) {
    assert.ok(onB.has(id), `B never back-filled a church document from its home relay A (${id.slice(0, 8)}) — it treated A as itself`);
  }
  assert.ok(ran.imported >= aIds.length, `B imported ${ran.imported} documents from its home relay; expected at least ${aIds.length}`);
});
