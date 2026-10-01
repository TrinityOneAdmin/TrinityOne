// A REMOVED PARENT NEVER SEES THE CHILD AGAIN; A STEWARD LINK NEVER PUBLISHES WHO IS A CHILD; AND LINKS MADE
// BEFORE THIS BUILD REACH THE PARENT'S PHONE. Real relays throughout.
// Run: node --test scripts/a-removed-parent-never-sees-the-child-again.test.mjs
//
// The re-audit of b7624a8 (2026-10-01) measured, by running, what the phone's re-publishing of its own guardian
// request did, and the owner chose a redesign (reference/DOMAIN.md): every guardian notice carries the parent's
// whole list; the phone never re-publishes its request. This file holds the redesign to the three findings that
// needed a real relay to see:
//   · HIGH — two relays; at a cold boot a STALE link notice arrives first and the newer removal second. The old
//     code re-published the request "now" and the removal's retraction was signed the same second; the relay
//     broke the tie by id, and 5 runs in 12 the child came back on the REMOVED parent's phone. Looped 20 times.
//   · HIGH privacy — the re-published request was plain {child, parent}, readable by every member: it told the
//     congregation which accounts are children. Asserted with a bystander's own authenticated read.
//   · MEDIUM — the console keys pending requests by child, so a father's re-published request replaced the
//     mother's genuinely pending one. Asserted through the console's own shipped subscribeGuardianRequests.
// …and the one-time pass that gives parents linked before this build their list.
//
// The member app's functions come out of vendor/fellowship.js and the console's out of vendor/steward.js, by
// scripts/family-harness.mjs; nothing here re-types a function under test.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent } from 'nostr-tools/pure';
import { requireFreePort } from './test-ports.mjs';
import {
  K, now, sleep, until, dOf, isRetracted, startRelay, publishTo, ask, memStorage, memberBoot, consoleBoot,
  noticeEvt, reqEvt, memberEvt,
} from './family-harness.mjs';

const PORT_A = 8982, PORT_B = 8984;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const church = K();
let A, B;

before(async () => {
  await requireFreePort(PORT_A, 'a-removed-parent-never-sees-the-child-again.test.mjs');
  await requireFreePort(PORT_B, 'a-removed-parent-never-sees-the-child-again.test.mjs');
  A = await startRelay(PORT_A, church.pub);
  B = await startRelay(PORT_B, church.pub);
});
after(() => { A && A.stop(); B && B.stop(); });

const join = async (who, relays) => { for (const r of relays) assert.equal((await publishTo(r.url, memberEvt(church, who)))[0], true, 'fixture: join refused'); };
const newestReq = async (url, parent, kid) => {
  const all = (await ask(url, parent, { kinds: [30078], authors: [parent.pub] })).filter(e => dOf(e) === 'trinityone/guardreq:' + kid.pub);
  return all.sort((a, b) => b.created_at - a.created_at)[0] || null;
};

// ── THE RACE, TWENTY TIMES ──────────────────────────────────────────────────────────────────────────────────
// Each run is a fresh parent and child, staged exactly as the re-audit measured: the parent's own request for
// the child LIVE on both relays as createChildAccount left it (stamped in the past); relay B only ever got the
// link notice; relay A has the newer removal. Then a cold boot after a lock — empty family list, notices and the
// rebuild racing across both relays.
test('removal on relay A, a STALE link notice on relay B, a cold boot: the child stays gone — every run of 20', async () => {
  const base = now() - 1000;
  for (let i = 0; i < 20; i++) {
    const parent = K(), C = K(), other = K();
    await join(parent, [A, B]);
    const live = reqEvt(church, parent, C, now() - 50, true);
    for (const r of [A, B]) assert.equal((await publishTo(r.url, live))[0], true, 'fixture: the live request was refused on run ' + i);
    const T = base + 2 * i;
    assert.equal((await publishTo(B.url, noticeEvt(church, parent, { child: C.pub, name: 'Cal', church: church.pub, children: [C.pub, other.pub] }, T)))[0], true);
    assert.equal((await publishTo(A.url, noticeEvt(church, parent, { removed: C.pub, church: church.pub, children: [other.pub] }, T + 1)))[0], true);
    const b = memberBoot(parent, memStorage(), { relays: [A.url, B.url] });
    const unsub = b.api.subscribeGuardianNotices();
    await b.api._rebuildFamily(church.pub);
    await until(() => b.shown(church.pub).includes(other.pub), 6000);
    await sleep(400);   // let every retraction and late copy land
    const shown = b.shown(church.pub);
    unsub(); b.close();
    assert.ok(shown.includes(other.pub), 'CONTROL run ' + i + ': the newest notice’s listed child is missing — the rig is wrong');
    assert.ok(!shown.includes(C.pub),
      'RUN ' + i + ' OF 20: THE CHILD CAME BACK ON A REMOVED PARENT’S PHONE. Family: ' + JSON.stringify(shown));
    // …and the next cold boot finds nothing to bring back: both relays hold the request retracted
    for (const r of [A, B]) {
      const n = await newestReq(r.url, parent, C);
      assert.ok(n && isRetracted(n), 'run ' + i + ': relay ' + r.url + ' still holds the parent’s request for C live');
    }
  }
});

// A request this phone signed AHEAD of the relay's clock (a phone running fast when it set the child up): the
// retraction must still post-date it, or the relay keeps the live copy ("a newer version is already stored").
test('a retraction post-dates the request it retracts, even one stamped ahead of now', async () => {
  const parent = K(), C = K();
  await join(parent, [A]);
  assert.equal((await publishTo(A.url, reqEvt(church, parent, C, now() + 120, true)))[0], true, 'fixture: the fast-stamped request');
  const b = memberBoot(parent, memStorage(), { relays: [A.url] });
  await b.api._rebuildFamily(church.pub);
  assert.ok(b.shown(church.pub).includes(C.pub), 'fixture: the rebuild did not see the request');
  // stored before the phone subscribes: this rig authenticates only when the relay challenges, and the relay
  // challenges a REQ only when it is withholding something already stored
  assert.equal((await publishTo(A.url, noticeEvt(church, parent, { removed: C.pub, church: church.pub, children: [] }, now())))[0], true);
  const unsub = b.api.subscribeGuardianNotices();
  assert.ok(await until(() => !b.shown(church.pub).includes(C.pub)), 'the removal never reached the phone');
  assert.ok(await until(async () => { const n = await newestReq(A.url, parent, C); return n && isRetracted(n); }),
    'THE RELAY KEPT THE LIVE REQUEST — the retraction was stamped before it, so the next cold boot brings the child back');
  unsub(); b.close();
});

// ── A STEWARD LINK PUBLISHES NOTHING A BYSTANDER CAN READ; A MOTHER'S PENDING REQUEST SURVIVES ─────────────────
test('after a steward links a father, no member can read that the child is a child — and the mother’s pending request stands', async () => {
  const mum = K(), dad = K(), bystander = K(), C = K();
  await join(mum, [A]); await join(dad, [A]); await join(bystander, [A]);
  // the mother set C up herself: her request is pending at the church
  assert.equal((await publishTo(A.url, reqEvt(church, mum, C, now() - 50, true)))[0], true, 'fixture: mum’s request');
  // the steward links the father: the shipped console notice, with the map after the change
  const con = consoleBoot(church, { relays: [A.url] });
  const r = await con.api.notifyGuardian(dad.pub, C.pub, 'Cleo', { [C.pub]: [dad.pub] });
  assert.ok(r, 'fixture: the console’s link notice was refused');
  // the father's phone takes it
  const storage = memStorage();
  const b = memberBoot(dad, storage, { relays: [A.url] });
  const unsub = b.api.subscribeGuardianNotices();
  await b.api._rebuildFamily(church.pub);
  assert.ok(await until(() => b.shown(church.pub).includes(C.pub)), 'the father’s phone never showed the linked child');
  await sleep(500);
  unsub(); b.close();
  // a bystander member reads everything the father has published, authenticated as themselves
  const seen = await ask(A.url, bystander, { kinds: [30078], authors: [dad.pub] });
  const leaks = seen.filter(e => dOf(e).includes(C.pub) || String(e.content).includes(C.pub) || e.tags.some(t => t.includes(C.pub)));
  assert.deepEqual(leaks.map(dOf), [],
    'A BYSTANDER CAN READ THAT ' + C.pub.slice(0, 8) + '… IS A CHILD AND WHO THEIR FATHER IS — the father’s phone published it after a steward link');
  // the console's own view of pending requests (its shipped subscribeGuardianRequests, authenticated as the church)
  let reqs = [];
  const stop = con.api.subscribeGuardianRequests((list) => { reqs = list; });
  await until(() => reqs.some(q => q.child === C.pub), 6000);
  await sleep(300);
  try { stop(); } catch {}
  con.close();
  const forC = reqs.filter(q => q.child === C.pub);
  assert.equal(forC.length, 1, 'the console lost the mother’s pending request for C: ' + JSON.stringify(reqs));
  assert.equal(forC[0].parent, mum.pub, 'THE FATHER’S REQUEST REPLACED THE MOTHER’S PENDING ONE in the console');
});

// ── LINKS MADE BEFORE THIS BUILD ────────────────────────────────────────────────────────────────────────────
test('a link made before this build reaches the parent after the console’s one-time pass, which runs once', async () => {
  const P = K(), C = K(), P2 = K(), C2 = K();
  await join(P, [A]); await join(P2, [A]);
  // the church's guardians document, as an older console wrote it — no list notice was ever sent
  const g = finalizeEvent({ kind: 30078, created_at: now() - 20, tags: [['d', 'trinityone/guardians:' + church.pub], ['t', 'trinityone']],
    content: JSON.stringify({ links: { [C.pub]: [P.pub], [C2.pub]: [P2.pub, P.pub] } }) }, church.sk);
  assert.equal((await publishTo(A.url, g))[0], true, 'fixture: the guardians document was refused');
  const consoleStorage = memStorage();
  const con = consoleBoot(church, { relays: [A.url], storage: consoleStorage });
  let links = null;
  const stop = con.api.subscribeGuardians((d) => { links = d.links; });
  assert.ok(await until(() => con.published.length >= 2, 8000), 'THE ONE-TIME PASS SENT NOTHING — parents linked before this build never get their list');
  try { stop(); } catch {} con.close();
  assert.ok(links && links[C.pub], 'CONTROL: the console read the guardians document');
  assert.equal(con.published.length, 2, 'the pass did not send exactly one notice per linked parent: ' + con.published.length);
  // the parent's phone, from a cold start, now shows both children
  const b = memberBoot(P, memStorage(), { relays: [A.url] });
  const unsub = b.api.subscribeGuardianNotices();
  assert.ok(await until(() => { const s = b.shown(church.pub); return s.includes(C.pub) && s.includes(C2.pub); }),
    'the parent’s phone did not show the links made before this build: ' + JSON.stringify(b.shown(church.pub)));
  unsub(); b.close();
  // a second load of the same console sends nothing more
  const con2 = consoleBoot(church, { relays: [A.url], storage: consoleStorage });
  const stop2 = con2.api.subscribeGuardians(() => {});
  await sleep(3000);
  try { stop2(); } catch {} con2.close();
  assert.equal(con2.published.length, 0, 'THE ONE-TIME PASS RAN AGAIN on the next load: ' + con2.published.length + ' more notices');
});
