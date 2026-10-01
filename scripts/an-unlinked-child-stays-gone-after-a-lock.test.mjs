// A PARENT'S PHONE SHOWS EXACTLY THE CHILDREN THE CHURCH HAS LINKED — THROUGH A LOCK, A RE-LINK, TWO CHURCHES.
// Run: node --test scripts/an-unlinked-child-stays-gone-after-a-lock.test.mjs
//
// FIX-PLAN-2026-10-01 item 1(b), and the owner's redesign after the re-audit of b7624a8 (reference/DOMAIN.md,
// 2026-10-01): every guardian notice carries the parent's COMPLETE list of linked children in that church, the
// newest notice per (church, parent) is the whole truth, the phone keeps nothing about a removal, and the phone
// NEVER re-publishes its own guardian request to restore a link. A request it made itself and the church has
// taken away is retracted on the relay.
//
// THIS DRIVES THE SHIPPED CODE: subscribeGuardianNotices, _applyGuardianList, _rebuildFamily, clearCommunityCache
// and myChildren are lifted out of vendor/fellowship.js by scripts/family-harness.mjs and run in a vm. A "boot"
// is a FRESH module scope sharing only localStorage — a cold start after a lock, with nothing carried in
// memory. Where the relay matters the notice is church-signed, sealed to the parent, stored by
// scripts/gateway.mjs and delivered over an authenticated socket; elsewhere a scripted pool delivers exactly the
// copies a case needs (two relays disagreeing, a publish that fails once).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { requireFreePort } from './test-ports.mjs';
import {
  K, now, sleep, until, dOf, isRetracted, startRelay, publishTo, ask, scriptedPool, memStorage, memberBoot,
  noticeEvt, reqEvt, memberEvt,
} from './family-harness.mjs';

const PORT = 8981;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const church = K(), parent = K();
const removedKid = K(), keptKid = K(), legacyKid = K();
let relay;

const isLive = (e) => !!e && !isRetracted(e);
const requestsOn = async (url, who = parent, filter = { kinds: [30078], authors: [parent.pub] }) => {
  const out = {};
  for (const e of await ask(url, who, filter)) { const d = dOf(e); if (d.startsWith('trinityone/guardreq:')) out[d.slice(20)] = e; }
  return out;
};
const retractionsOf = (evts, kid) => evts.filter(e => dOf(e) === 'trinityone/guardreq:' + kid.pub && isRetracted(e));
const liveReqsOf = (evts, kid) => evts.filter(e => dOf(e) === 'trinityone/guardreq:' + kid.pub && !isRetracted(e));
const N = (obj, ts) => noticeEvt(church, parent, obj, ts);

before(async () => {
  await requireFreePort(PORT, 'an-unlinked-child-stays-gone-after-a-lock.test.mjs');
  relay = await startRelay(PORT, church.pub);
  let [ok, why] = await publishTo(relay.url, memberEvt(church, parent));
  assert.equal(ok, true, 'fixture: the parent could not join: ' + why);
  for (const kid of [removedKid, keptKid, legacyKid]) {
    [ok, why] = await publishTo(relay.url, reqEvt(church, parent, kid, now() - 60));
    assert.equal(ok, true, 'fixture: the guardian request could not be stored: ' + why);
  }
});
after(() => { relay && relay.stop(); });

// ── 1. AN OLDER CONSOLE'S REMOVAL (no list), A LOCK, A COLD BOOT ─────────────────────────────────────────────
test('an unlinked child stays gone after a PIN lock — old-console removal, lock wipe, cold-boot rebuild', async () => {
  const storage = memStorage();
  storage.setItem('trinityone.family', JSON.stringify([
    { child: removedKid.pub, name: 'Ada', churchPub: church.pub, ts: now() - 60 },
    { child: keptKid.pub, name: 'Ben', churchPub: church.pub, ts: now() - 60 },
  ]));
  const [ok, why] = await publishTo(relay.url, N({ removed: removedKid.pub, church: church.pub }, now()));
  assert.equal(ok, true, 'fixture: the relay refused the removal notice: ' + why);

  const b1 = memberBoot(parent, storage, { relays: [relay.url] });
  const unsub = b1.api.subscribeGuardianNotices();
  assert.ok(await until(() => !b1.shown(church.pub).includes(removedKid.pub)), 'the removal notice never reached the shipped handler');
  assert.deepEqual(b1.shown(church.pub), [keptKid.pub], 'the notice dropped the wrong child');
  assert.ok(await until(async () => !isLive((await requestsOn(relay.url))[removedKid.pub])), 'the removal did not retract the parent’s own request');
  unsub(); b1.close();

  b1.api.clearCommunityCache();
  assert.deepEqual([...storage._map.keys()].filter(k => k.startsWith('trinityone.family')), [], 'something about the family survived the lock wipe');

  const b2 = memberBoot(parent, storage, { relays: [relay.url] });
  await b2.api._rebuildFamily(church.pub);
  b2.close();
  const after = b2.shown(church.pub);
  assert.ok(after.includes(keptKid.pub), 'CONTROL: the rebuild did not find the child who is still requested — the rig cannot see the relay');
  assert.ok(!after.includes(removedKid.pub),
    'THE UNLINKED CHILD CAME BACK AFTER A PIN LOCK — the rebuild re-added it from the parent’s own request. Shows: ' + JSON.stringify(after));
  // the console SEES the retraction: it subscribes `#p: [church]` (steward.src.js subscribeGuardianRequests)
  const consoleView = await requestsOn(relay.url, church, { kinds: [30078], '#p': [church.pub] });
  assert.ok(consoleView[removedKid.pub] && !isLive(consoleView[removedKid.pub]),
    'THE STEWARD CONSOLE CANNOT SEE THE RETRACTION — it is not p-tagged to the church');
  assert.ok(isLive(consoleView[keptKid.pub]), 'the retraction reached a child it was not about');
});

// ── 2. THE LEGACY LIST ──────────────────────────────────────────────────────────────────────────────────────
test('a removal an OLDER build recorded: the rebuild skips and retracts it; a whole list then retires the list', async () => {
  const storage = memStorage();
  storage.setItem('trinityone.family', JSON.stringify([]));
  storage.setItem('trinityone.family.removed', JSON.stringify([legacyKid.pub]));
  const b = memberBoot(parent, storage, { relays: [relay.url] });
  await b.api._rebuildFamily(church.pub);
  assert.ok(!b.shown(church.pub).includes(legacyKid.pub), 'the rebuild resurrected a child this phone had recorded as removed');
  assert.ok(await until(async () => !isLive((await requestsOn(relay.url))[legacyKid.pub])),
    'the legacy removal was never retracted on the relay — the next lock brings the child back');
  await sleep(200);
  assert.notEqual(storage.getItem('trinityone.family.removed'), null,
    'the REBUILD deleted the legacy list — it must not take a relay’s answer as proof (re-audit: nostr-tools reports a dead relay as answered)');
  // a whole-list notice from the church is the proof: the list is redundant once applied
  const P = scriptedPool();
  const b2 = memberBoot(parent, storage, { pool: P, relays: [relay.url] });
  b2.api.subscribeGuardianNotices();
  P.notices().handlers.onevent(N({ church: church.pub, children: [keptKid.pub] }, now()));
  assert.ok(await until(() => storage.getItem('trinityone.family.removed') === null),
    'the legacy list outlived a whole-list notice — the owner ruled nothing about a removal stays on the phone');
  b.close();
});

// ── 3. RE-LINK, THEN A SIBLING, ON THE REAL RELAY (re-audit finding 1, the exact sequence) ──────────────────
test('a child the church RE-LINKS survives a later notice about a sibling, and a lock — and nothing is re-published', async () => {
  const C = K(), D = K();
  const storage = memStorage();
  assert.equal((await publishTo(relay.url, reqEvt(church, parent, C, now() - 30)))[0], true, 'fixture: C’s request');
  storage.setItem('trinityone.family', JSON.stringify([{ child: C.pub, name: 'Cara', churchPub: church.pub, ts: now() - 30 }]));
  const b1 = memberBoot(parent, storage, { relays: [relay.url] });
  const unsub = b1.api.subscribeGuardianNotices();
  await sleep(1500);   // the notice stored by the tests above arrives first
  const base = now() + 5;
  const say = async (obj, ts) => { const [k, y] = await publishTo(relay.url, N(obj, ts)); assert.equal(k, true, 'fixture: notice refused: ' + y); };
  // the lists below are what the console's _sendGuardNotice computes from the guardians map after each change
  await say({ removed: C.pub, church: church.pub, children: [keptKid.pub] }, base);
  assert.ok(await until(() => !b1.shown(church.pub).includes(C.pub)), 'the removal of C never reached the phone');
  assert.ok(await until(async () => !isLive((await requestsOn(relay.url))[C.pub])), 'the removal did not retract C’s request');
  await say({ child: C.pub, name: 'Cara', church: church.pub, children: [C.pub, keptKid.pub] }, base + 1);
  assert.ok(await until(() => b1.shown(church.pub).includes(C.pub)), 'the re-link of C never reached the phone');
  await say({ child: D.pub, name: 'Dan', church: church.pub, children: [C.pub, D.pub, keptKid.pub] }, base + 2);
  assert.ok(await until(() => b1.shown(church.pub).includes(D.pub)), 'the link of D never reached the phone');
  unsub(); b1.close();
  b1.api.clearCommunityCache();
  const b2 = memberBoot(parent, storage, { relays: [relay.url] });
  const unsub2 = b2.api.subscribeGuardianNotices();
  await b2.api._rebuildFamily(church.pub);
  await until(() => b2.shown(church.pub).includes(D.pub));
  unsub2(); b2.close();
  const after = b2.shown(church.pub);
  assert.ok(after.includes(D.pub) && after.includes(C.pub),
    'A CHILD THE CHURCH RE-LINKED IS GONE AFTER A LOCK, though the newest notice lists it. Family: ' + JSON.stringify(after));
  assert.ok(!isLive((await requestsOn(relay.url))[C.pub]),
    'THE PHONE RE-PUBLISHED ITS REQUEST FOR C — a plain {child, parent} every member can read (re-audit, HIGH privacy)');
});

// ── 4. AN OLDER NOTICE FROM A SECOND RELAY ──────────────────────────────────────────────────────────────────
test('an OLDER removal notice arriving after a newer re-link is ignored', async () => {
  const E = K();
  const storage = memStorage();
  storage.setItem('trinityone.family', JSON.stringify([]));
  const P = scriptedPool(), sent = [];
  const b = memberBoot(parent, storage, { pool: P, publish: async (evt) => { sent.push(evt); return true; } });
  b.api.subscribeGuardianNotices();
  P.notices().handlers.onevent(N({ child: E.pub, church: church.pub, children: [E.pub] }, 2000));   // relay A: the re-link
  P.notices().handlers.onevent(N({ removed: E.pub, church: church.pub, children: [] }, 1000));       // relay B, late: the old removal
  await sleep(50);
  assert.ok(b.shown(church.pub).includes(E.pub), 'AN OLDER REMOVAL NOTICE UNDID A NEWER RE-LINK');
  assert.equal(retractionsOf(sent, E).length, 0, 'an older removal notice retracted the parent’s request after a newer re-link');
  P.notices().handlers.onevent(N({ removed: E.pub, church: church.pub, children: [] }, 3000));
  await sleep(50);
  assert.ok(!b.shown(church.pub).includes(E.pub), 'CONTROL: a genuinely NEWER removal was ignored');
});

// ── 5. THE LEGACY LIST STAYS WHILE A RETRACTION IT ASKED FOR WAS REFUSED ────────────────────────────────────
test('the legacy list is kept while a retraction it asked for has not been accepted', async () => {
  const L = K();
  const storage = memStorage();
  storage.setItem('trinityone.family.removed', JSON.stringify([L.pub]));
  const P = scriptedPool();
  let accept = false;
  const b = memberBoot(parent, storage, { pool: P, publish: async () => { if (!accept) throw new Error('offline'); return true; } });
  const done = b.api._rebuildFamily(church.pub);
  P.rebuild().handlers.onevent(reqEvt(church, parent, L, 900)); P.rebuild().handlers.oneose();
  await done;
  b.api.subscribeGuardianNotices();
  const notice = N({ church: church.pub, children: [] }, 4000);
  P.notices().handlers.onevent(notice);
  await sleep(50);
  assert.notEqual(storage.getItem('trinityone.family.removed'), null,
    'THE LEGACY LIST WAS DELETED THOUGH ITS RETRACTION WAS REFUSED — the request is still live and the next lock brings the child back');
  accept = true;
  P.notices().handlers.onevent(notice);   // the SAME notice, re-delivered (a re-subscribe does this)
  assert.ok(await until(() => storage.getItem('trinityone.family.removed') === null), 'CONTROL: once accepted, the legacy list did not go');
});

// ── 6. TWO RELAYS, ONE MISSED THE RETRACTION ────────────────────────────────────────────────────────────────
test('a stale live request on a relay that missed the retraction does not bring the child back', async () => {
  const G = K();
  for (const order of ['retraction first', 'stale copy first']) {
    const storage = memStorage();
    const P = scriptedPool(), sent = [];
    const b = memberBoot(parent, storage, { pool: P, publish: async (evt) => { sent.push(evt); return true; } });
    const done = b.api._rebuildFamily(church.pub);
    const retraction = reqEvt(church, parent, G, 2000, false), stale = reqEvt(church, parent, G, 1000, true);
    const r = P.rebuild().handlers;
    for (const e of (order === 'retraction first' ? [retraction, stale] : [stale, retraction])) r.onevent(e);
    r.oneose();
    await done;
    assert.ok(!b.shown(church.pub).includes(G.pub), 'A STALE LIVE REQUEST FROM A SECOND RELAY BROUGHT A CHILD BACK (' + order + ')');
    assert.ok(sent.some(e => e.id === retraction.id), 'the relay that missed the retraction was never sent it again (' + order + ')');
  }
});

// ── 7. A RETRACTION THAT FAILED ─────────────────────────────────────────────────────────────────────────────
test('a retraction that failed is retried by the rebuild, and the child is not re-added meanwhile', async () => {
  const H = K();
  const storage = memStorage();
  storage.setItem('trinityone.family', JSON.stringify([{ child: H.pub, name: 'Hal', churchPub: church.pub, ts: 900 }]));
  const P = scriptedPool(), sent = [];
  let failures = 1;
  const b = memberBoot(parent, storage, { pool: P, publish: async (evt) => { sent.push(evt); if (failures-- > 0) throw new Error('offline'); return true; } });
  b.api.subscribeGuardianNotices();
  P.notices().handlers.onevent(N({ removed: H.pub, church: church.pub }, 5000));
  await sleep(30);
  assert.equal(retractionsOf(sent, H).length, 1, 'fixture: the notice did not attempt a retraction');
  const done = b.api._rebuildFamily(church.pub);
  P.rebuild().handlers.onevent(reqEvt(church, parent, H, 900, true)); P.rebuild().handlers.oneose();
  await done; await sleep(30);
  assert.ok(!b.shown(church.pub).includes(H.pub), 'THE REBUILD RE-ADDED A CHILD UNLINKED THIS SESSION whose retraction had not landed');
  assert.equal(retractionsOf(sent, H).length, 2, 'the rebuild found the request still live and did not retry the retraction');
  assert.ok(retractionsOf(sent, H).every(e => e.created_at > 900), 'a retraction was not stamped after the request it retracts');
});

// ── 8. UNLINK AND RE-LINK IN ONE SESSION, THEN A MID-SESSION LOCK ───────────────────────────────────────────
test('a re-link in the same session holds through a mid-session lock, and nothing live is published', async () => {
  const J = K();
  const storage = memStorage();
  storage.setItem('trinityone.family', JSON.stringify([{ child: J.pub, name: 'Jo', churchPub: church.pub, ts: 900 }]));
  const P = scriptedPool(), sent = [];
  const b = memberBoot(parent, storage, { pool: P, publish: async (evt) => { sent.push(evt); return true; } });
  b.api.subscribeGuardianNotices();
  P.notices().handlers.onevent(N({ removed: J.pub, church: church.pub, children: [] }, 6000));
  const relink = N({ child: J.pub, name: 'Jo', church: church.pub, children: [J.pub] }, 6001);
  P.notices().handlers.onevent(relink);
  await sleep(30);
  assert.ok(b.shown(church.pub).includes(J.pub), 'the re-link did not reach the family list');
  b.api.clearCommunityCache();   // a mid-session lock: same process
  // unlocking reconnects, and the subscription re-delivers the newest notice; the rebuild runs alongside it
  P.notices().handlers.onevent(relink);
  const done = b.api._rebuildFamily(church.pub);
  P.rebuild().handlers.onevent(retractionsOf(sent, J)[0]); P.rebuild().handlers.oneose();
  await done;
  assert.ok(b.shown(church.pub).includes(J.pub), 'A CHILD RE-LINKED THIS SESSION IS MISSING AFTER A MID-SESSION LOCK');
  assert.equal(liveReqsOf(sent, J).length, 0, 'THE PHONE PUBLISHED A LIVE REQUEST TO RESTORE A LINK — readable by every member');
});

// ── 9. TWO CHURCHES (re-audit finding 4) ─────────────────────────────────────────────────────────────────────
test('two churches’ notices are both applied — one church’s newer notice does not suppress the other’s', async () => {
  const other = K(), A1 = K(), B1 = K();
  const storage = memStorage();
  const P = scriptedPool();
  const b = memberBoot(parent, storage, { pool: P, publish: async () => true });
  b.api.subscribeGuardianNotices();
  P.notices().handlers.onevent(noticeEvt(other, parent, { child: B1.pub, church: other.pub, children: [B1.pub] }, 9000));
  P.notices().handlers.onevent(N({ child: A1.pub, church: church.pub, children: [A1.pub] }, 1000));   // older, but a different church
  await sleep(30);
  assert.deepEqual(b.shown(church.pub), [A1.pub], 'church A’s notice was suppressed by church B’s newer one');
  assert.deepEqual(b.shown(other.pub), [B1.pub], 'church B’s child is missing');
  P.notices().handlers.onevent(N({ church: church.pub, children: [] }, 1001));
  await sleep(30);
  assert.deepEqual(b.shown(church.pub), [], 'church A’s removal did not apply');
  assert.deepEqual(b.shown(other.pub), [B1.pub], 'CHURCH A’S LIST REMOVED CHURCH B’S CHILD');
});

// ── 10. AN OLDER CONSOLE'S LINK NOTICE ──────────────────────────────────────────────────────────────────────
test('an older console’s link notice (no list) still links the child, and publishes nothing', async () => {
  const X = K();
  const storage = memStorage();
  const P = scriptedPool(), sent = [];
  const b = memberBoot(parent, storage, { pool: P, publish: async (evt) => { sent.push(evt); return true; } });
  b.api.subscribeGuardianNotices();
  P.notices().handlers.onevent(N({ child: X.pub, name: 'Xan', church: church.pub }, 7000));
  await sleep(30);
  const e = b.entries(church.pub).find(c => c.child === X.pub);
  assert.ok(e && e.viaSteward, 'an older console’s link notice no longer links the child');
  assert.equal(e.name, 'Xan', 'the name the notice carried was dropped');
  assert.equal(sent.length, 0, 'a link notice made the phone publish something: ' + JSON.stringify(sent.map(dOf)));
});

// ── 11. WHAT A WHOLE LIST DOES ──────────────────────────────────────────────────────────────────────────────
test('a whole list: a linked child it omits goes; a still-pending request of our own stays; listed children are linked', async () => {
  const linkedGone = K(), pending = K(), listed = K();
  const storage = memStorage();
  storage.setItem('trinityone.family', JSON.stringify([
    { child: linkedGone.pub, name: 'Lin', churchPub: church.pub, ts: 1, viaSteward: true },
    { child: pending.pub, name: 'Pen', churchPub: church.pub, ts: 1 },
  ]));
  const P = scriptedPool(), sent = [];
  const b = memberBoot(parent, storage, { pool: P, publish: async (evt) => { sent.push(evt); return true; } });
  b.api.subscribeGuardianNotices();
  P.notices().handlers.onevent(N({ church: church.pub, children: [listed.pub] }, 8000));
  await sleep(30);
  const shown = b.shown(church.pub);
  assert.ok(!shown.includes(linkedGone.pub), 'A LINK THE CHURCH NO LONGER LISTS IS STILL ON THE PHONE');
  assert.ok(shown.includes(pending.pub), 'a request of the parent’s own that no steward has acted on was dropped');
  assert.ok(shown.includes(listed.pub), 'a listed child was not added');
  assert.ok(b.entries(church.pub).find(c => c.child === listed.pub).linked, 'a listed child is not marked linked');
  assert.ok(!b.entries(church.pub).find(c => c.child === pending.pub).linked, 'a pending request was marked linked');
  assert.equal(retractionsOf(sent, linkedGone).length, 0, 'a retraction was written for a steward link the parent never requested');
});

// ── 12, 13. WHAT THE REBUILD COUNTS ─────────────────────────────────────────────────────────────────────────
test('the rebuild reads a request with EMPTY content as retracted, as the console does', async () => {
  const Q = K();
  const storage = memStorage();
  const P = scriptedPool();
  const b = memberBoot(parent, storage, { pool: P, publish: async () => true });
  const done = b.api._rebuildFamily(church.pub);
  const { finalizeEvent } = await import('nostr-tools/pure');
  const emptied = finalizeEvent({ kind: 30078, created_at: 2000, tags: [['d', 'trinityone/guardreq:' + Q.pub], ['t', 'trinityone'], ['p', church.pub]], content: '' }, parent.sk);
  P.rebuild().handlers.onevent(reqEvt(church, parent, Q, 1000, true));
  P.rebuild().handlers.onevent(emptied);
  P.rebuild().handlers.oneose();
  await done;
  assert.ok(!b.shown(church.pub).includes(Q.pub), 'a request whose newest copy is EMPTY (no `deleted` tag) was rebuilt as a child');
});

test('the rebuild counts only this parent’s own requests', async () => {
  const stranger = K(), Z = K();
  const storage = memStorage();
  const P = scriptedPool();
  const b = memberBoot(parent, storage, { pool: P, publish: async () => true });
  const done = b.api._rebuildFamily(church.pub);
  P.rebuild().handlers.onevent(reqEvt(church, stranger, Z, 1000, true));   // someone else's request, served anyway
  P.rebuild().handlers.oneose();
  await done;
  assert.ok(!b.shown(church.pub).includes(Z.pub), 'ANOTHER MEMBER’S GUARDIAN REQUEST BECAME A CHILD ON THIS PARENT’S PHONE');
});

// ── 14. WHEN THE FAMILY IS KNOWN ────────────────────────────────────────────────────────────────────────────
test('familyAnswered is false until a whole list or a GENUINE rebuild answer, and each fires trinity-family-changed', async () => {
  // Audit of 4d7ca23, E7: a subscription that merely FINISHES is not an answer — nostr-tools finishes one for a
  // relay that refused the connection, and for one that never answered. It counts only at EOSE and only if the
  // relay served one of this parent's own documents (served only over a socket authenticated as them).
  const fast = (fn, ms) => setTimeout(fn, Math.min(ms, 30));
  for (const [label, drive] of [
    ['an EOSE that served none of this parent’s documents (a dead or empty relay)', (r) => r.handlers.oneose()],
    ['a subscription that only timed out', () => {}],
    ['own documents but no EOSE (timed out)', (r) => r.handlers.onevent(memberEvt(church, parent, 1000))],
  ]) {
    const P = scriptedPool();
    const b = memberBoot(parent, memStorage(), { pool: P, publish: async () => true, setTimeout: fast });
    const done = b.api._rebuildFamily(church.pub);
    drive(P.rebuild());
    await done;
    assert.equal(b.api.familyAnswered(church.pub), false, 'THE FAMILY READ AS KNOWN AFTER ' + label.toUpperCase() + ' — an offline phone is told "make one below"');
  }
  const P = scriptedPool();
  const b = memberBoot(parent, memStorage(), { pool: P, publish: async () => true });
  assert.equal(b.api.familyAnswered(church.pub), false, 'the family reads as known before anything has answered');
  const done = b.api._rebuildFamily(church.pub);
  P.rebuild().handlers.onevent(memberEvt(church, parent, 1000));
  P.rebuild().handlers.oneose();
  await done;
  assert.equal(b.api.familyAnswered(church.pub), true, 'a rebuild a relay genuinely answered did not mark the family known');
  assert.ok(b.events.some(e => e.type === 'trinity-family-changed'), 'a finished rebuild fired nothing, so an open Family sheet never refreshes');
  // a mid-session PIN lock forgets it: the list it showed is gone
  b.api.clearCommunityCache();
  assert.equal(b.api.familyAnswered(church.pub), false, 'THE LOCK LEFT THE FAMILY "KNOWN" OVER AN EMPTY LIST — the sheet says "make one below"');
  const other = K();
  const P3 = scriptedPool();
  const b3 = memberBoot(parent, memStorage(), { pool: P3, publish: async () => true });
  b3.api.subscribeGuardianNotices();
  P3.notices().handlers.onevent(noticeEvt(other, parent, { church: other.pub, children: [] }, 10));
  await sleep(20);
  assert.equal(b3.api.familyAnswered(other.pub), true, 'an applied whole list did not mark the family known');
  assert.ok(b3.events.some(e => e.type === 'trinity-family-changed'), 'an applied whole list fired nothing');
});

// ── 15. A CLOSED REQUEST IS WITHDRAWN (owner's plan, 2026-10-01, item 4) ─────────────────────────────────────
test('a whole list that names a closed request: the pending row goes and the parent’s own request is withdrawn', async () => {
  const declined = K(), stillPending = K();
  const storage = memStorage();
  storage.setItem('trinityone.family', JSON.stringify([
    { child: declined.pub, name: 'Dee', churchPub: church.pub, ts: 900 },
    { child: stillPending.pub, name: 'Pat', churchPub: church.pub, ts: 900 },
  ]));
  const P = scriptedPool(), sent = [];
  const b = memberBoot(parent, storage, { pool: P, publish: async (evt) => { sent.push(evt); return true; } });
  b.api.subscribeGuardianNotices();
  P.notices().handlers.onevent(N({ church: church.pub, children: [], closed: [declined.pub] }, 9500));
  await sleep(30);
  const shown = b.shown(church.pub);
  assert.ok(!shown.includes(declined.pub), 'A DECLINED REQUEST STILL READS "WAITING FOR STEWARD TO CONFIRM"');
  assert.ok(shown.includes(stillPending.pub), 'a request nobody has decided was dropped');
  const r = retractionsOf(sent, declined);
  assert.equal(r.length, 1, 'the parent’s own request for the closed child was not withdrawn on the relay');
  assert.ok(r[0].created_at > 900, 'the withdrawal was not stamped after the request it withdraws');
  assert.equal(retractionsOf(sent, stillPending).length, 0, 'a still-pending request was withdrawn');
});

// ── 16. THE NEWEST NOTICE SURVIVES A RESTART, AND A LOCK (item 2) ───────────────────────────────────────────
test('after a restart — and after a lock — an OLDER notice is still older than the newest one applied', async () => {
  const C = K();
  for (const lock of [false, true]) {
    const storage = memStorage();
    const P1 = scriptedPool();
    const b1 = memberBoot(parent, storage, { pool: P1, publish: async () => true });
    b1.api.subscribeGuardianNotices();
    P1.notices().handlers.onevent(N({ removed: C.pub, church: church.pub, children: [] }, 2000));   // the newest: C unlinked
    await sleep(20);
    if (lock) b1.api.clearCommunityCache();
    // a cold boot that reaches only a relay holding the OLDER notice (the link)
    const P2 = scriptedPool();
    const b2 = memberBoot(parent, storage, { pool: P2, publish: async () => true });
    b2.api.subscribeGuardianNotices();
    P2.notices().handlers.onevent(N({ child: C.pub, name: 'Cal', church: church.pub, children: [C.pub] }, 1000));
    await sleep(20);
    assert.ok(!b2.shown(church.pub).includes(C.pub),
      'AN OLDER NOTICE PUT BACK A CHILD THE CHURCH HAD UNLINKED after a restart' + (lock ? ' and a lock' : ''));
  }
});
