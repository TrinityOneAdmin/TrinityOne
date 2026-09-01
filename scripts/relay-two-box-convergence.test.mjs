// Four real relays, one church. Run: node --test scripts/relay-two-box-convergence.test.mjs
//
// This is the first test in the repo that can say ANYTHING about a network of relays, and the first that can
// make the assertion the closed-network work turns on: **the church's documents did not reach a box the
// church never authorised.** Everything before this ran one gateway and asked what it served.
//
// The four participants each answer a different question, and none of them is a mock:
//
//   A, B  — the church's own relays, both named in its church-signed trusted-relays list. Two relays holding
//           one church is what `autoSyncIfRedundant` switches on by itself the moment a church adds a second
//           one, and nothing has ever asserted the two agree. When a write gate was replayed over an import
//           it deleted a finance journal, and no test could see it.
//   OLD   — the same gateway from the commit BEFORE this work (see the harness's extractOldBuild). It
//           rehearses "new client, old relay", which is the live deployment risk for every gate that merges
//           before the fleet has upgraded.
//   OUT   — a relay that is up, healthy, configured for this church, and holds the church's own relay list —
//           but whose identity key is NOT in that list. It is the important one. An absence claim against a
//           box that is switched off proves nothing, so this one is running, it is asked, and the refusal is
//           watched: A answers a MEMBER relay's proof with 200 and OUT's with 401, on the same URL, seconds
//           apart. The 200 is not decoration — without it, a 401 could just as well mean the route is dead.
//
// EMPTY OR BROKEN. OUT's corpus is asserted to be EXACTLY the one document it was handed directly, never
// merely "small": a relay that stored nothing because it is broken would report the same zero as a relay
// that correctly refused, and that confusion has produced false findings here before.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as H from './relay-network-harness.mjs';

const church = H.key();
let A, B, OLD, OUT, relayList, aIds = [], bIds = [], oldIds = [];

before(async () => {
  A   = await H.startRelay({ name: 'A', churches: [church.pub] });
  B   = await H.startRelay({ name: 'B', churches: [church.pub] });
  OLD = await H.startOldRelay({ name: 'OLD', churches: [church.pub] });
  OUT = await H.startRelay({ name: 'OUT', churches: [church.pub] });

  // The church authorises A, B and OLD — and not OUT. This ONE document is the whole membership decision.
  relayList = H.relaysDoc(church, [A, B, OLD]);
  // Every relay gets it, OUT included: the list is church-signed and public, so a non-member box may well
  // hold it. What OUT must not get is the church's CONTENT. Giving it to OUT is also what makes OUT ask —
  // it is the only route into PEER_URLS, so OUT now knows where the church's relays are and pulls them.
  for (const r of [A, B, OLD, OUT]) await H.publishAll(r, [relayList]);

  aIds   = await H.publishAll(A,   [1, 2, 3].map(n => H.churchDoc(church, `trinityone/notice:a${n}`, { text: `from A ${n}` })));
  bIds   = await H.publishAll(B,   [1, 2, 3].map(n => H.churchDoc(church, `trinityone/notice:b${n}`, { text: `from B ${n}` })));
  oldIds = await H.publishAll(OLD, [1, 2].map(n    => H.churchDoc(church, `trinityone/notice:o${n}`, { text: `from OLD ${n}` })));
});

after(() => { H.stopAll(); setTimeout(() => process.exit(process.exitCode || 0), 2000).unref(); });

test('before anything else: the four relays are real, distinct boxes', async () => {
  const pubs = new Set([A, B, OLD, OUT].map(r => r.relayPub));
  assert.equal(pubs.size, 4, 'two participants share an identity key, so nothing below distinguishes them');
  const ports = new Set([A, B, OLD, OUT].map(r => r.port));
  assert.equal(ports.size, 4, 'two participants share a port');
  for (const r of [A, B, OLD, OUT]) assert.ok(r.alive(), `${r.name} is not running`);
  // An "old" build that happens to be byte-identical to the working tree makes the compat test below vacuous.
  assert.ok(H.gatewayDiffersFrom(H.DEFAULT_OLD_REV),
    `scripts/gateway.mjs at ${H.DEFAULT_OLD_REV} is identical to the working tree, so OLD is not an old build`);
});

test('two relays holding one church converge on its documents', async () => {
  // Before: each holds only what it was given. This is the state a church is in the day it adds a relay.
  assert.equal((await H.corpusIds(A, church)).size, 4, 'A did not store what was published to it');
  assert.equal((await H.corpusIds(B, church)).size, 4, 'B did not store what was published to it');
  const before = await H.corpusDiff(A, B, church);
  assert.ok(before.onlyOnA.length && before.onlyOnB.length, 'A and B started in sync, so convergence is untested');

  const { ids } = await H.waitForConvergence([A, B, OLD], church, { timeout: 45000, expect: 9 });
  assert.equal(ids.size, 9, 'the church has 8 documents plus its relay list');

  const after = await H.corpusDiff(A, B, church);
  assert.deepEqual(after, { onlyOnA: [], onlyOnB: [] }, 'two relays for one church still disagree');
  const onA = await H.corpusIds(A, church);
  for (const id of bIds) assert.ok(onA.has(id), 'a document written on B never reached A');
  const onB = await H.corpusIds(B, church);
  for (const id of aIds) assert.ok(onB.has(id), 'a document written on A never reached B');
});

test('a relay running the PREVIOUS build converges with this one, both ways', async () => {
  const onOld = await H.corpusIds(OLD, church);
  for (const id of [...aIds, ...bIds]) assert.ok(onOld.has(id), 'a relay on the previous build fell behind the new one');
  const onA = await H.corpusIds(A, church);
  for (const id of oldIds) assert.ok(onA.has(id), 'a document written on the previous build never reached the new one');
});

test('the unauthorised relay is up, holds the church list, and genuinely asks', async () => {
  // Up and serving. If this ever fails, the absence assertion below means nothing.
  const st = await OUT.status();
  assert.equal(st.relayPub, OUT.relayPub, 'the unauthorised relay is not answering /status as itself');
  assert.equal(st.writePolicy, true, 'the unauthorised relay is not even configured for this church');
  // It read the church's relay list, so it knows where A, B and OLD are and pulls them every pass.
  assert.equal(st.sync.peers, 1, 'the unauthorised relay has no peer list, so it never asks anyone anything');
  const ran = await H.syncNow(OUT);
  assert.equal(ran.ok, true, 'the unauthorised relay could not run a sync pass');
  assert.equal(ran.imported, 0, 'the unauthorised relay imported a church corpus it was never authorised to hold');

  // And the refusal, watched directly on one URL. The 200 is the control: it proves /sync is alive and
  // answering, so the 401 is a decision about WHO asked and not a dead route.
  const url = `${A.base}/sync?church=${encodeURIComponent(church.pub)}&since=0`;
  const member = await fetch(url, { headers: { Authorization: H.proofAs(B, url, 'GET', church.pub) } });
  assert.equal(member.status, 200, 'a relay the church DID authorise was refused its own corpus');
  const outsider = await fetch(url, { headers: { Authorization: H.proofAs(OUT, url, 'GET', church.pub) } });
  assert.equal(outsider.status, 401, 'a relay the church never authorised was served the whole corpus');
});

test('the corpus did NOT reach the relay the church never authorised', async () => {
  const held = await H.corpusIds(OUT, church);
  // Exactly the one document it was handed, and nothing else. Asserting the id — not just the count —
  // separates "correctly refused" from "broken and storing nothing", which look identical from a count.
  assert.deepEqual([...held], [relayList.id],
    'the unauthorised relay holds church documents it was never given and never authorised to pull');
  for (const id of [...aIds, ...bIds, ...oldIds]) {
    assert.ok(!held.has(id), `a church document reached a relay outside the church's network (${id.slice(0, 8)})`);
  }
});

// LAST, deliberately: it kills the network. An orphaned relay from a test run is a documented cause of false
// audit findings in this repo, so teardown is asserted rather than assumed.
test('teardown leaves no process and no directory behind', async () => {
  const dirs = [A, B, OLD, OUT].map(r => r.dataDir).concat(OLD.oldBuild.dir);
  for (const d of dirs) assert.ok(existsSync(d), `${d} was already gone before teardown`);
  H.stopAll();
  const left = H.leftovers();
  // `impostors` joined this shape when the harness grew an in-process impostor host for the C2 identity
  // tests. This file starts none, so the empty array is the assertion that starting one elsewhere cannot
  // quietly leak a listening socket past a teardown check that never looked for it.
  assert.deepEqual(left, { processes: [], dirs: [], impostors: [] }, 'the harness left processes, directories or impostor hosts behind');
  for (const d of dirs) assert.ok(!existsSync(d), `${d} survived teardown`);
  // Deliberately NOT `readdir` for stray .oldbuild-* dirs: another run of this same file (the suite runs 24
  // files at once) legitimately has one open, and a repo-wide scan fails on somebody else's healthy work.
  // The dirs above are this process's own. The belt-and-braces guard for a run that CRASHES before teardown
  // is the ignore rule, so assert that instead — it is deterministic and true of every concurrent run.
  const probe = join(H.ROOT, '.oldbuild-probe', 'scripts', 'gateway.mjs');
  assert.equal(spawnSync('git', ['-C', H.ROOT, 'check-ignore', '-q', probe]).status, 0,
    '.oldbuild-*/ is not gitignored, so a crashed run could stage a copy of an old gateway for commit');
});
