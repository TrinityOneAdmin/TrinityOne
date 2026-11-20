// A RELAY KEEPS THE NEWEST COPY AT AN ADDRESS, WHOEVER WROTE IT (owner answer p, 2026-11-19).
//   Run: node --test scripts/a-relay-keeps-the-newest-copy-at-an-address.test.mjs
//
// reference/PLAN-removed-steward-fixes-F1-F4-2026-11-19.html §0b R-H1, §0c N1/N3, §0d. A group definition, a team roster
// and meals-settings are stored PER AUTHOR (the church's copy and a helper's copy sit side by side), and the relay's live
// maps — who may post in a room, whether children may, who is on a serving team, whether members may open care needs —
// used to follow the LAST ARRIVAL. A late OLDER copy (peer sync, a box waking up, an /import) then overrode a newer one
// until the relay restarted, when replay (oldest first) gave the other answer: live and restart disagreed.
//
// Every assertion here is a relay DECISION, read by trying the write a member would make, live and again after the relay
// restarts over the same data (moveRelay: a new process, same directory, started after the last gateway.mjs edit):
//   group     a child's post into the group is accepted only while the governing copy says childsafe
//   roster    a team member's post into the team's room is accepted only while the governing roster names them
//   meals     a member's care need is accepted only while the governing meals-settings says openedBy 'member'
//   void      a REMOVED helper's newer copy blocks nothing: the church's older correction governs (0c N1)
//   tie       same second: the lower event id governs (the store's own tie rule)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent } from 'nostr-tools/pure';
import * as H from './relay-network-harness.mjs';

const NET = 'trinityone';
const MEMBER_D = 'trinityone/member:', GROUP_D = 'trinityone/group:', STEWARDS_D = 'trinityone/stewards:', MINORS_D = 'trinityone/minors:';
const ROSTER_D = 'trinityone/roster:', MEALS_D = 'trinityone/meals-settings', NEED_D = 'trinityone/care:';
const sleep = ms => new Promise(r => setTimeout(r, ms));
after(() => { H.stopAll(); setTimeout(() => process.exit(process.exitCode || 0), 1500).unref(); });

let clock = Math.floor(Date.now() / 1000) - 2000;
const doc = (who, d, content, { at, tags = [] } = {}) => finalizeEvent({ kind: 30078, created_at: at || ++clock, tags: [['d', d], ['t', NET], ...tags], content: typeof content === 'string' ? content : JSON.stringify(content) }, who.sk);
const put = async (relay, e) => { const s = await H.connect(relay); try { return await H.publish(s, e); } finally { try { s.close(); } catch {} } };
const must = async (relay, e) => { const [ok, why] = await put(relay, e); assert.equal(ok, true, 'fixture refused: ' + why); await sleep(60); return e; };
const chat = (who, gid) => finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [['t', NET], ['t', gid]], content: 'hello ' + Math.random() }, who.sk);
const need = (who, cp) => finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', NEED_D + Math.random().toString(36).slice(2, 10)], ['t', NET], ['church', cp]], content: JSON.stringify({ title: 'meals please' }) }, who.sk);

// one church, one relay; a helper on the roster with content + care; a child; two adult members
async function church(name) {
  const C = H.key(), helper = H.key(), child = H.key(), ann = H.key(), ben = H.key();
  let relay = await H.startRelay({ name, churches: [C.pub] });
  const roster = (pubs) => doc(C, STEWARDS_D + C.pub, { pubkeys: pubs, caps: Object.fromEntries(pubs.map(p => [p, ['content', 'care']])) });
  await must(relay, roster([helper.pub]));
  for (const m of [helper, child, ann, ben]) await must(relay, doc(m, MEMBER_D + C.pub, { joined: ++clock }));
  await must(relay, doc(C, MINORS_D + C.pub, { pubkeys: [child.pub] }));
  return { C, cp: C.pub, helper, child, ann, ben, roster, get relay() { return relay; }, async restart() { relay = await H.moveRelay(relay); await sleep(300); } };
}
const tag = (cp) => [['church', cp]];
const posts = async (relay, who, gid) => (await put(relay, chat(who, gid)))[0] === true;

test('group: a late OLDER church copy does not override the helper’s NEWER copy — live, and after a restart', async () => {
  const W = await church('newest-group');
  const gid = W.cp.slice(0, 16) + '-youth';
  const newer = doc(W.helper, GROUP_D + gid, { name: 'Youth (adults only now)' }, { tags: tag(W.cp) });          // not child-safe
  const older = doc(W.C, GROUP_D + gid, { name: 'Youth', childsafe: true }, { at: newer.created_at - 5 });          // child-safe, OLDER
  await must(W.relay, newer);
  assert.equal(await posts(W.relay, W.child, gid), false, 'CONTROL: the newer copy is adults-only');
  await must(W.relay, older);   // arrives LAST (peer sync, a box waking up)
  assert.equal(await posts(W.relay, W.child, gid), false, 'THE LATE OLDER COPY GOVERNS THE ROOM LIVE: a child may post into a room the newest copy made adults-only');
  await W.restart();
  assert.equal(await posts(W.relay, W.child, gid), false, 'after a restart the relay disagrees with itself');
  assert.equal(await posts(W.relay, W.ann, gid), true, 'CONTROL: an adult member still posts');
});

test('group: a NEWER church copy arriving after an older helper copy governs (newest wins in both arrival orders)', async () => {
  const W = await church('newest-group-2');
  const gid = W.cp.slice(0, 16) + '-youth';
  const older = doc(W.helper, GROUP_D + gid, { name: 'Youth' }, { tags: tag(W.cp) });
  const newer = doc(W.C, GROUP_D + gid, { name: 'Youth', childsafe: true }, { at: older.created_at + 5 });
  await must(W.relay, older); await must(W.relay, newer);
  assert.equal(await posts(W.relay, W.child, gid), true, 'the newer child-safe copy does not govern');
  await W.restart();
  assert.equal(await posts(W.relay, W.child, gid), true, 'after a restart');
});

// CHANGED (plan 0e rev 8, owner answer y): a removed helper's NEWER copy no longer simply loses to the church's older one —
// its tighter settings stay as a FLOOR until a newer valid copy, or the church's 'kept' copy, arrives. Here the void copy
// is adults-only and the church's older correction child-safe: the room stays adults-only (child-safe only if BOTH say so).
test('group VOID → FLOOR (y): a REMOVED helper’s newer adults-only copy keeps the room adults-only over the church’s older child-safe one, live and after restart', async () => {
  const W = await church('newest-void');
  const gid = W.cp.slice(0, 16) + '-room';
  const theirs = doc(W.helper, GROUP_D + gid, { name: 'Room' }, { tags: tag(W.cp) });                                // adults only, newest
  await must(W.relay, theirs);
  await must(W.relay, W.roster([]));                                                                                  // the helper is removed
  const correction = doc(W.C, GROUP_D + gid, { name: 'Room', childsafe: true }, { at: theirs.created_at - 3 });       // church copy, OLDER than theirs
  await must(W.relay, correction);
  assert.equal(await posts(W.relay, W.child, gid), false, 'THE ROOM FELL OPEN TO A CHILD in the gap (floor, answer y)');
  await W.restart();
  assert.equal(await posts(W.relay, W.child, gid), false, 'after a restart');
});

test('group: a same-second tie goes to the LOWER event id, in both arrival orders', async () => {
  for (const order of ['low-first', 'high-first']) {
    const W = await church('newest-tie-' + order);
    const gid = W.cp.slice(0, 16) + '-tie';
    const at = ++clock;
    let a = doc(W.C, GROUP_D + gid, { name: 'Tie', childsafe: true }, { at });
    let b = doc(W.helper, GROUP_D + gid, { name: 'Tie' }, { at, tags: tag(W.cp) });
    const [low, high] = a.id < b.id ? [a, b] : [b, a];
    const lowSafe = low === a;
    for (const e of (order === 'low-first' ? [low, high] : [high, low])) await must(W.relay, e);
    assert.equal(await posts(W.relay, W.child, gid), lowSafe, order + ': the higher id governed a same-second tie');
    await W.restart();
    assert.equal(await posts(W.relay, W.child, gid), lowSafe, order + ': after a restart');
  }
});

test('roster: a late OLDER copy does not override the newer team list — live, and after a restart', async () => {
  const W = await church('newest-roster');
  const tid = W.cp.slice(0, 16) + '-welcome';
  await must(W.relay, doc(W.C, GROUP_D + tid, { name: 'Welcome', kind: 'team' }));
  const newer = doc(W.helper, ROSTER_D + tid, { pubs: [W.ben.pub] }, { tags: tag(W.cp) });
  const older = doc(W.C, ROSTER_D + tid, { pubs: [W.ann.pub] }, { at: newer.created_at - 5 });
  await must(W.relay, newer); await must(W.relay, older);
  assert.equal(await posts(W.relay, W.ann, tid), false, 'THE LATE OLDER ROSTER GOVERNS THE TEAM ROOM');
  assert.equal(await posts(W.relay, W.ben, tid), true, 'the newest roster’s person cannot post');
  await W.restart();
  assert.equal(await posts(W.relay, W.ann, tid), false, 'after a restart');
  assert.equal(await posts(W.relay, W.ben, tid), true, 'after a restart');
});

test('meals-settings: a late OLDER copy does not override the newer care setting — live, and after a restart', async () => {
  const W = await church('newest-meals');
  const newer = doc(W.helper, MEALS_D, { enabled: true, openedBy: 'member', adminGroupId: '' }, { tags: tag(W.cp) });
  const older = doc(W.C, MEALS_D, { enabled: true, openedBy: 'steward', adminGroupId: '' }, { at: newer.created_at - 5 });
  await must(W.relay, newer); await must(W.relay, older);
  assert.equal((await put(W.relay, need(W.ann, W.cp)))[0], true, 'THE LATE OLDER CARE SETTING GOVERNS: a member may no longer open a need');
  await W.restart();
  assert.equal((await put(W.relay, need(W.ann, W.cp)))[0], true, 'after a restart');
});

// ══ FABLE AUDIT OF c9f355eb ══════════════════════════════════════════════════════════════════════════════════════════
test('HIGH-1 — the church’s older copy arrives FIRST (refused), THEN the helper is removed: the church’s copy governs at once, and after restart', async () => {
  const W = await church('void-reverse');
  const gid = W.cp.slice(0, 16) + '-room';
  const theirs = doc(W.helper, GROUP_D + gid, { name: 'Room', childsafe: true }, { tags: tag(W.cp) });             // child-safe, newest
  await must(W.relay, theirs);
  await must(W.relay, doc(W.C, GROUP_D + gid, { name: 'Room (adults)' }, { at: theirs.created_at - 3 }));          // older: refused while they are a helper
  assert.equal(await posts(W.relay, W.child, gid), true, 'CONTROL: the helper’s newer copy governs while they are a helper');
  await must(W.relay, W.roster([]));                                                                                 // the helper is removed
  await sleep(150);
  assert.equal(await posts(W.relay, W.child, gid), false, 'THE RELAY STILL FOLLOWS THE REMOVED HELPER’S COPY (until a restart)');
  await W.restart();
  assert.equal(await posts(W.relay, W.child, gid), false, 'after a restart');
});

test('third author — after a void entry, the NEWEST VALID copy governs, not the church’s older one', async () => {
  const W = await church('void-third');
  const tara = H.key();
  await must(W.relay, doc(tara, MEMBER_D + W.cp, { joined: ++clock }));
  await must(W.relay, doc(W.C, STEWARDS_D + W.cp, { pubkeys: [W.helper.pub, tara.pub], caps: { [W.helper.pub]: ['content'], [tara.pub]: ['content'] } }));
  const gid = W.cp.slice(0, 16) + '-third';
  const theirs = doc(W.helper, GROUP_D + gid, { name: 'R', childsafe: true }, { tags: tag(W.cp), at: clock + 50 });
  await must(W.relay, theirs);
  await must(W.relay, doc(W.C, GROUP_D + gid, { name: 'R', childsafe: true }, { at: theirs.created_at - 10 }));      // church, oldest, child-safe
  await must(W.relay, doc(tara, GROUP_D + gid, { name: 'R (adults)' }, { tags: tag(W.cp), at: theirs.created_at - 2 }));   // Tara, newer than the church
  await must(W.relay, doc(W.C, STEWARDS_D + W.cp, { pubkeys: [tara.pub], caps: { [tara.pub]: ['content'] } }));      // the first helper removed
  await sleep(150);
  assert.equal(await posts(W.relay, W.child, gid), false, 'THE CHURCH’S OLDER COPY BEAT TARA’S NEWER ONE after the void entry');
  await W.restart();
  assert.equal(await posts(W.relay, W.child, gid), false, 'after a restart');
});

test('MED-4a — an OLDER church withdrawal arriving after a newer live copy does not take the room away — live, and after restart', async () => {
  const W = await church('older-tomb');
  const gid = W.cp.slice(0, 16) + '-alive';
  const live = doc(W.helper, GROUP_D + gid, { name: 'Alive' }, { tags: tag(W.cp) });
  await must(W.relay, live);
  await must(W.relay, doc(W.C, GROUP_D + gid, '', { at: live.created_at - 4, tags: [['deleted', '1'], ['for', '*']] }));
  assert.equal(await posts(W.relay, W.ann, gid), true, 'AN OLDER WITHDRAWAL TOOK A NEWER ROOM AWAY');
  await W.restart();
  assert.equal(await posts(W.relay, W.ann, gid), true, 'after a restart');
});

test('co-tenant — another church’s FAR-FUTURE withdrawal of an id this relay has not seen does not pin it against the owner', async () => {
  const A = H.key(), Bc = H.key(), kid = H.key();
  const relay = await H.startRelay({ name: 'cotenant', churches: [A.pub, Bc.pub] });
  await must(relay, doc(kid, MEMBER_D + A.pub, { joined: ++clock }));
  await must(relay, doc(A, MINORS_D + A.pub, { pubkeys: [kid.pub] }));
  const gid = 'shared-youth-id';
  await must(relay, doc(Bc, GROUP_D + gid, '', { at: Math.floor(Date.now() / 1000) + 300, tags: [['deleted', '1']] }));
  await must(relay, doc(A, GROUP_D + gid, { name: 'Youth', childsafe: true }));
  assert.equal(await posts(relay, kid, gid), true, 'THE CO-TENANT’S FUTURE TOMBSTONE KEPT THE OWNER’S ROOM AWAY');
});

test('co-tenant — another church’s BACK-DATED withdrawal of an unseen id does not claim it either (a tombstone never owns an id)', async () => {
  const A = H.key(), Bc = H.key(), kid = H.key();
  const relay = await H.startRelay({ name: 'cotenant-back', churches: [A.pub, Bc.pub] });
  await must(relay, doc(kid, MEMBER_D + A.pub, { joined: ++clock }));
  await must(relay, doc(A, MINORS_D + A.pub, { pubkeys: [kid.pub] }));
  const gid = 'shared-youth-id-2';
  await must(relay, doc(Bc, GROUP_D + gid, '', { at: Math.floor(Date.now() / 1000) - 86400, tags: [['deleted', '1']] }));   // OLDER than A's copy
  await must(relay, doc(A, GROUP_D + gid, { name: 'Youth', childsafe: true }));
  assert.equal(await posts(relay, kid, gid), true, 'THE CO-TENANT’S BACK-DATED TOMBSTONE CLAIMED THE OWNER’S ROOM');
});
