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
// …and (2026-10-01, the owner's plan after the audit of 4d7ca23) a notice reaching every relay, the newest notice
// surviving a restart, a removal the phone never saw, and an unreachable relay not counting as an answer.
//
// The member app's functions come out of vendor/fellowship.js and the console's out of vendor/steward.js, by
// scripts/family-harness.mjs; nothing here re-types a function under test.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent } from 'nostr-tools/pure';
import { createServer } from 'node:net';
import { requireFreePort } from './test-ports.mjs';
import {
  K, now, sleep, until, dOf, isRetracted, startRelay, publishTo, ask, memStorage, memberBoot, consoleBoot,
  noticeEvt, reqEvt, memberEvt,
} from './family-harness.mjs';

const PORT_A = 8982, PORT_B = 8984;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
// A relay that cannot be reached: a port the OS just handed out and we closed again, so nothing is listening on
// it — chosen at run time rather than fixed, so no other process can be sitting on it (scripts/test-ports.test.mjs).
let DEAD = '';
const freeEphemeralPort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
const church = K();
let A, B;

before(async () => {
  await requireFreePort(PORT_A, 'a-removed-parent-never-sees-the-child-again.test.mjs');
  await requireFreePort(PORT_B, 'a-removed-parent-never-sees-the-child-again.test.mjs');
  A = await startRelay(PORT_A, church.pub);
  B = await startRelay(PORT_B, church.pub);
  DEAD = `ws://127.0.0.1:${await freeEphemeralPort()}/relay`;
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

// ── A NOTICE REACHES EVERY RELAY — INCLUDING ONE THAT WAS DOWN WHEN IT WAS SENT (owner's plan, item 3) ────────
// The console published guardian notices first-accept-wins, so a relay that missed one kept the older notice,
// and a phone that reads that relay kept a link the church had removed.
test('a guardian notice goes to every relay, and to a relay that was down when it was sent once it comes up', async () => {
  const P = K(), C = K();
  await join(P, [A]);
  const LATE = 8943, lateUrl = `ws://127.0.0.1:${LATE}/relay`;
  await requireFreePort(LATE, 'a-removed-parent-never-sees-the-child-again.test.mjs');
  // nostr-tools' OWN pool, as the console uses it: an unreachable relay answers "connection failure" by RESOLVING
  // (audit of b4ac50d, C2x — a harness pool that rejected instead hid a broken check)
  const { SimplePool, useWebSocketImplementation } = await import('nostr-tools/pool');
  const { WebSocket } = await import('ws');
  useWebSocketImplementation(WebSocket);
  const sp = new SimplePool();
  const con = consoleBoot(church, { relays: [A.url, B.url, lateUrl], retryMs: [1500, 3000, 6000], pool: sp });
  const evt = await con.api.notifyGuardian(P.pub, C.pub, 'Cleo', { [C.pub]: [P.pub] }, {});
  assert.ok(evt, 'the notice was reported refused though two relays were up');
  for (const r of [A, B]) {
    const got = (await ask(r.url, church, { kinds: [30078], authors: [church.pub] })).filter(e => e.id === evt.id);
    assert.equal(got.length, 1, 'relay ' + r.url + ' did not get the notice at once — it went to the first relay to answer only');
  }
  let late = null;
  try {
    late = await startRelay(LATE, church.pub);
    const ok = await until(async () => (await ask(late.url, church, { kinds: [30078], authors: [church.pub] }, 1500)).some(e => e.id === evt.id), 14000);
    assert.ok(ok, 'A RELAY THAT WAS DOWN WHEN THE NOTICE WENT OUT NEVER GOT IT — a phone that reads it keeps the older notice');
  } finally { late && late.stop(); try { sp.destroy(); } catch {} }
});

// ── THE NEWEST NOTICE SURVIVES A RESTART (owner's plan, item 2), on real relays ──────────────────────────────
test('after a restart with the up-to-date relay unreachable, an older notice does not bring a child back — with or without a lock', async () => {
  for (const lock of [false, true]) {
    const P = K(), C = K();
    await join(P, [A, B]);
    // relay A still has the OLDER notice (the link); relay B has the newer one (C unlinked)
    assert.equal((await publishTo(A.url, noticeEvt(church, P, { child: C.pub, name: 'Cal', church: church.pub, children: [C.pub] }, now() - 200)))[0], true);
    assert.equal((await publishTo(B.url, noticeEvt(church, P, { removed: C.pub, church: church.pub, children: [] }, now() - 100)))[0], true);
    const storage = memStorage();
    const b1 = memberBoot(P, storage, { relays: [A.url, B.url] });
    let u = b1.api.subscribeGuardianNotices();
    await sleep(2000);
    u(); b1.close();
    assert.ok(!b1.shown(church.pub).includes(C.pub), 'CONTROL: with both relays reachable the newest notice did not win');
    if (lock) b1.api.clearCommunityCache();
    // restart; relay B unreachable
    const b2 = memberBoot(P, storage, { relays: [A.url, DEAD] });
    u = b2.api.subscribeGuardianNotices();
    await sleep(2000);
    const shown = b2.shown(church.pub);
    u(); b2.close();
    assert.ok(!shown.includes(C.pub),
      'AFTER A RESTART' + (lock ? ' AND A LOCK' : '') + ', THE OLDER NOTICE ON THE REACHABLE RELAY PUT BACK A CHILD THE CHURCH HAD UNLINKED');
  }
});

// ── THE AUDITOR'S E8, the sequence the plan names (item 4) ─────────────────────────────────────────────────────
// The phone is locked. The steward unlinks C, then links D — the single notice slot now names D, and the
// removal of C was never seen. On unlock C must not come back as "Waiting for steward to confirm", and the
// parent's own request for C must be withdrawn on the relay.
test('a removal the phone never saw (locked; unlink C, then link D): on unlock C is not shown and its request is withdrawn', async () => {
  const P = K(), C = K(), D = K();
  await join(P, [A]);
  assert.equal((await publishTo(A.url, reqEvt(church, P, C, now() - 300, true)))[0], true, 'fixture: P set C up');
  const storage = memStorage();   // the phone was locked: its family list is empty
  const con = consoleBoot(church, { relays: [A.url] });
  // the console's own notices, with the map and closed pairs after each change (as stew-dashboard passes them)
  assert.ok(await con.api.notifyGuardianRemoved(P.pub, C.pub, {}, undefined, { [C.pub + '|' + P.pub]: now() }), 'fixture: the unlink notice');
  assert.ok(await con.api.notifyGuardian(P.pub, D.pub, 'Dee', { [D.pub]: [P.pub] }, { [C.pub + '|' + P.pub]: now() }), 'fixture: the link notice');
  con.close();
  const b = memberBoot(P, storage, { relays: [A.url] });
  const u = b.api.subscribeGuardianNotices();
  await b.api._rebuildFamily(church.pub);
  await until(() => b.shown(church.pub).includes(D.pub), 6000);
  await sleep(600);
  const shown = b.shown(church.pub);
  u(); b.close();
  assert.ok(shown.includes(D.pub), 'CONTROL: the newest notice’s child is missing');
  assert.ok(!shown.includes(C.pub),
    'A REMOVAL THE PHONE NEVER SAW CAME BACK AS "WAITING FOR STEWARD TO CONFIRM": ' + JSON.stringify(b.entries(church.pub)));
  assert.ok(await until(async () => { const n = await newestReq(A.url, P, C); return n && isRetracted(n); }),
    'the parent’s own request for C is still live on the relay');
});

// ── OFFLINE IS NOT AN ANSWER (owner's plan, item 5) ───────────────────────────────────────────────────────────
// nostr-tools' own pool, as the app uses it, against a relay that refuses the connection: its subscription
// "finishes" in milliseconds. That must not mark the family known.
test('a rebuild over a relay that cannot be reached does not mark the family known', async () => {
  const { SimplePool, useWebSocketImplementation } = await import('nostr-tools/pool');
  const { WebSocket } = await import('ws');
  useWebSocketImplementation(WebSocket);
  const pool = new SimplePool();
  const P = K();
  const b = memberBoot(P, memStorage(), { relays: [DEAD], pool });
  await b.api._rebuildFamily(church.pub);
  try { pool.destroy(); } catch {}
  assert.equal(b.api.familyAnswered(church.pub), false,
    'AN UNREACHABLE RELAY COUNTED AS THE CHURCH ANSWERING — an offline parent is told "no children linked … make one below"');
  // CONTROL: the same rebuild against the real relay, authenticated as the parent, does answer
  await join(P, [A]);
  const b2 = memberBoot(P, memStorage(), { relays: [A.url] });
  await b2.api._rebuildFamily(church.pub);
  b2.close();
  assert.equal(b2.api.familyAnswered(church.pub), true, 'CONTROL: a relay that genuinely answered did not mark the family known');
});

// ── THE STAMP AND THE REBUILD AFTER A LOCK (audit of b4ac50d, NEW-1 and NEW-2), on real relays ──────────────────
// NEW-1: a parent linked to C and D; the notice adding D reached relay B only. Lock; relay B unreachable. The
// stamp rightly refuses relay A's older notice — but the rebuild of the parent's own requests then marked the
// family answered, and the sheet told a linked parent "No children linked … make one below".
test('a linked parent after a lock, with the newest notice’s relay unreachable: not answered — then the children return', async () => {
  const P = K(), C = K(), D = K();
  await join(P, [A, B]);
  const n1 = noticeEvt(church, P, { child: C.pub, name: 'Cal', church: church.pub, children: [C.pub], closed: [] }, now() - 200);
  for (const r of [A, B]) assert.equal((await publishTo(r.url, n1))[0], true);
  assert.equal((await publishTo(B.url, noticeEvt(church, P, { child: D.pub, name: 'Dee', church: church.pub, children: [C.pub, D.pub], closed: [] }, now() - 100)))[0], true);
  const storage = memStorage();
  const b1 = memberBoot(P, storage, { relays: [A.url, B.url] });
  let u = b1.api.subscribeGuardianNotices();
  assert.ok(await until(() => b1.shown(church.pub).length === 2, 6000), 'fixture: both children did not show');
  u(); b1.close();
  b1.api.clearCommunityCache();   // the PIN lock
  const dead = DEAD;
  const b2 = memberBoot(P, storage, { relays: [A.url, dead] });
  u = b2.api.subscribeGuardianNotices();
  await sleep(1500);
  await b2.api._rebuildFamily(church.pub);   // the docs hub's EOSE runs this — relay A answers it genuinely
  const shown = b2.shown(church.pub), answered = b2.api.familyAnswered(church.pub);
  u(); b2.close();
  assert.equal(shown.length, 0, 'CONTROL: the stamp let relay A’s older notice through');
  assert.equal(answered, false,
    'A LINKED PARENT’S FAMILY READ AS ANSWERED WITH NOTHING IN IT — the sheet says "No children linked … make one below"');
  // relay B reachable again: the newest notice applies, and both children are back
  const b3 = memberBoot(P, storage, { relays: [A.url, B.url] });
  u = b3.api.subscribeGuardianNotices();
  const back = await until(() => b3.shown(church.pub).length === 2, 6000);
  u(); b3.close();
  assert.ok(back && b3.api.familyAnswered(church.pub), 'once the newest notice was reachable the children did not come back');
});

// NEW-2: a request the church declined; the phone saw the closing notice on relay B and its withdrawal reached
// relay B only. Lock; only relay A reachable — holding the live request and no notice. It came back as
// "Waiting for steward to confirm".
test('a declined request whose withdrawal reached one relay does not come back as "Waiting" from the other', async () => {
  const P = K(), C = K();
  await join(P, [A, B]);
  for (const r of [A, B]) assert.equal((await publishTo(r.url, reqEvt(church, P, C, now() - 300, true)))[0], true, 'fixture: the request');
  assert.equal((await publishTo(B.url, noticeEvt(church, P, { church: church.pub, children: [], closed: [C.pub] }, now() - 100)))[0], true);
  const storage = memStorage();
  storage.setItem('trinityone.family', JSON.stringify([{ child: C.pub, name: 'Cal', churchPub: church.pub, ts: now() - 300 }]));
  const dead = DEAD;
  const b1 = memberBoot(P, storage, { relays: [dead, B.url] });   // relay A down
  let u = b1.api.subscribeGuardianNotices();
  assert.ok(await until(() => !b1.shown(church.pub).includes(C.pub), 6000), 'fixture: the closing notice did not apply');
  await sleep(800);
  u(); b1.close();
  b1.api.clearCommunityCache();   // the PIN lock
  const b2 = memberBoot(P, storage, { relays: [A.url, dead] });   // relay B down, relay A up
  u = b2.api.subscribeGuardianNotices();
  await sleep(1200);
  await b2.api._rebuildFamily(church.pub);
  await sleep(300);
  const shown = b2.shown(church.pub), answered = b2.api.familyAnswered(church.pub);
  u(); b2.close();
  assert.ok(!shown.includes(C.pub), 'A DECLINED REQUEST CAME BACK AS "WAITING FOR STEWARD TO CONFIRM" from the relay that missed its withdrawal');
  assert.equal(answered, false, 'the family read as answered while the church’s newest notice was unreachable');
  // both relays reachable: the notice applies, and the request still live on relay A is withdrawn there too
  const b3 = memberBoot(P, storage, { relays: [A.url, B.url] });
  u = b3.api.subscribeGuardianNotices();
  await b3.api._rebuildFamily(church.pub);
  const gone = await until(async () => { const n = await newestReq(A.url, P, C); return n && isRetracted(n); }, 8000);
  u(); b3.close();
  assert.ok(!b3.shown(church.pub).includes(C.pub), 'the declined request showed once both relays were reachable');
  assert.ok(gone, 'the request still live on relay A was not withdrawn once the closing notice was applied');
});
