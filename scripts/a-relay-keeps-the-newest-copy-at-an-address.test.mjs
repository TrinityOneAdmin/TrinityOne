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

test('group VOID (0c N1): a REMOVED helper’s newer copy blocks nothing — the church’s older correction governs, live and after restart', async () => {
  const W = await church('newest-void');
  const gid = W.cp.slice(0, 16) + '-room';
  const theirs = doc(W.helper, GROUP_D + gid, { name: 'Room' }, { tags: tag(W.cp) });                                // adults only, newest
  await must(W.relay, theirs);
  await must(W.relay, W.roster([]));                                                                                  // the helper is removed
  const correction = doc(W.C, GROUP_D + gid, { name: 'Room', childsafe: true }, { at: theirs.created_at - 3 });       // church copy, OLDER than theirs
  await must(W.relay, correction);
  assert.equal(await posts(W.relay, W.child, gid), true, 'A REMOVED HELPER’S NEWER COPY STILL PINS THE ROOM against the church');
  await W.restart();
  assert.equal(await posts(W.relay, W.child, gid), true, 'after a restart');
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
