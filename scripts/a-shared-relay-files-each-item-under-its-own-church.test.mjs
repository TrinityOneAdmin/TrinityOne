// A shared relay files every event under ONE church (the `church` column). That column decides what the relay
// hands a church's own box on sync, what is in that church's /export backup, and what its retention culls.
// Before this fix a person in two churches had EVERYTHING filed under their first church: the second church's
// join note, and every direct message (tags are only ['p', peer]), so church A's own box received church B's
// traffic and B's backup lacked it. Owner rule: a church's box receives only that church's traffic; a private
// message may use the box of a church BOTH people belong to, never another.
//
// These tests go through the real routes (/export, relay-to-relay /sync) on real gateways, never resolveChurch's
// return value. Each assertion has a CONTROL that proves sync/export really ran.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import * as H from './relay-network-harness.mjs';
import { finalizeEvent } from 'nostr-tools/pure';

const A = H.key(), B = H.key(), sarah = H.key(), tom = H.key(), bob = H.key(), carol = H.key(), dave = H.key();
let S, T, stamp = H.now() - 300;
const at = () => ++stamp;
const member = (who, cp) => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', 'trinityone/member:' + cp.pub], ['t', 'trinityone'], ['p', cp.pub]], content: JSON.stringify({ joined: stamp, seen: stamp, hb: 1 }) }, who.sk);
const dm = (from, to) => finalizeEvent({ kind: 4, created_at: at(), tags: [['p', to.pub]], content: 'sealed?iv=AAAA' }, from.sk);
const exportIds = async (relay, church) => {
  const url = `${relay.base}/export`;
  const r = await fetch(url, { headers: { Authorization: H.nip98(church.sk, url, 'GET', church.pub) } });
  assert.equal(r.status, 200, 'export of ' + relay.name);
  return new Set((await r.text()).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l).id; } catch { return null; } }));
};
const holds = (relay, id) => { const db = new DatabaseSync(join(relay.dataDir, 'relay.sqlite'), { readOnly: true }); try { return !!db.prepare('SELECT 1 FROM events WHERE id = ?').get(id); } finally { db.close(); } };
const setup = async (name) => {
  const s = await H.startRelay({ name: name + 'S', churches: [A.pub, B.pub] });
  const t = await H.startRelay({ name: name + 'T', churches: [A.pub] });
  const aDocs = [H.relaysDoc(A, [s, t], at()), H.churchDoc(A, 'trinityone/joinpolicy:' + A.pub, { approval: false }, at())];
  for (const r of [s, t]) await H.publishAll(r, aDocs);
  await H.publishAll(s, [H.churchDoc(B, 'trinityone/joinpolicy:' + B.pub, { approval: false }, at())]);
  return [s, t];
};
const ev = {};
const RELABEL_META = 'relabel:church-label-v1';   // scripts/gateway.mjs
const RELABELLED = {};

before(async () => {
  [S, T] = await setup('p');
  // the client's real DM-reaction shape (src/fellowship.src.js ~5920): e, p, t=trinityone, k=4. Sarah (A and B) reacts to Bob (B only).
  ev.reactBob = finalizeEvent({ kind: 7, created_at: at(), tags: [['e', 'f'.repeat(64)], ['p', bob.pub], ['t', 'trinityone'], ['k', '4']], content: '+' }, sarah.sk);
  ev.reactTom = finalizeEvent({ kind: 7, created_at: at(), tags: [['e', 'e'.repeat(64)], ['p', tom.pub], ['t', 'trinityone'], ['k', '4']], content: '+' }, sarah.sk);
  ev.tomA = member(tom, A); ev.sarahA = member(sarah, A); ev.sarahB = member(sarah, B); ev.bobB = member(bob, B);
  ev.dmTom = dm(sarah, tom); ev.dmB = dm(sarah, B); ev.dmBob = dm(sarah, bob); ev.dmTomBob = dm(tom, bob);
  const res = await H.publishAll(S, [ev.tomA, ev.sarahA, ev.sarahB, ev.bobB, ev.dmTom, ev.dmB, ev.dmBob, ev.dmTomBob, ev.reactBob, ev.reactTom]);
  assert.ok(res, 'publish ran');
  // a member's very FIRST join copy: carol joins B once and nothing re-sends it
  ev.carolB = member(carol, B);
  await H.publishAll(S, [ev.carolB]);
});
after(() => { H.stopAll(); setTimeout(() => process.exit(process.exitCode || 0), 2000).unref(); });

test('1. sync: church A\'s own box gets A\'s traffic and none of church B\'s', async () => {
  for (const k of Object.keys(ev)) assert.equal(holds(T, ev[k].id), false, 'CONTROL: T held ' + k + ' before sync');
  await H.syncNow(T);
  await H.waitFor(async () => holds(T, ev.sarahA.id), { label: 'T syncing Sarah\'s A join' });
  assert.equal(holds(T, ev.tomA.id), true, 'CONTROL: Tom\'s A join synced');
  assert.equal(holds(T, ev.dmTom.id), true, 'CONTROL: Sarah->Tom DM (both in A only) uses A\'s box');
  assert.equal(holds(T, ev.sarahB.id), false, 'Sarah\'s B join note must not reach A\'s box');
  assert.equal(holds(T, ev.dmB.id), false, 'her DM to church B must not reach A\'s box');
  assert.equal(holds(T, ev.dmBob.id), false, 'her DM to Bob (B) must not reach A\'s box');
  assert.equal(holds(T, ev.bobB.id), false, 'Bob\'s own B join must not reach A\'s box');
});

test('2. export: B\'s backup holds Sarah\'s B join and her DM to B; A\'s does not', async () => {
  const b = await exportIds(S, B), a = await exportIds(S, A);
  assert.equal(b.has(ev.bobB.id), true, 'CONTROL: Bob\'s B join is in B\'s backup');
  assert.equal(a.has(ev.sarahA.id), true, 'CONTROL: Sarah\'s A join is in A\'s backup');
  assert.equal(b.has(ev.sarahB.id), true, 'Sarah\'s B join in B\'s backup');
  assert.equal(b.has(ev.dmB.id), true, 'her DM to church B in B\'s backup');
  assert.equal(b.has(ev.dmBob.id), true, 'Sarah->Bob share only B, so B\'s box carries it');
  assert.equal(a.has(ev.sarahB.id), false);
  assert.equal(a.has(ev.dmB.id), false);
  assert.equal(a.has(ev.dmBob.id), false);
  assert.equal(a.has(ev.dmTom.id), true, 'CONTROL: Sarah->Tom (A only) is in A\'s backup');
  assert.equal(b.has(ev.dmTom.id), false);
});

test('3. a member\'s first join copy is exported under its church', async () => {
  const b = await exportIds(S, B), a = await exportIds(S, A);
  assert.equal(b.has(ev.carolB.id), true, 'carol\'s only B join copy is in B\'s backup');
  assert.equal(a.has(ev.carolB.id), false);
});

test('4. a DM between two people who share no church is in neither backup', async () => {
  const b = await exportIds(S, B), a = await exportIds(S, A);
  assert.equal(a.has(ev.dmTomBob.id), false);
  assert.equal(b.has(ev.dmTomBob.id), false);
  assert.equal(holds(S, ev.dmTomBob.id), true, 'CONTROL: the relay did store it');
});

test('5. startup relabel repairs rows filed under the old wrong church', async () => {
  const [S2, T2] = await setup('r');
  const e = { sarahA: member(sarah, A), sarahB: member(sarah, B), bobB: member(bob, B), dmB: dm(sarah, B), dmTom: dm(sarah, tom),
    reactBob: finalizeEvent({ kind: 7, created_at: at(), tags: [['e', 'd'.repeat(64)], ['p', bob.pub], ['t', 'trinityone'], ['k', '4']], content: '+' }, sarah.sk) };
  e.tomA = member(tom, A);
  await H.publishAll(S2, [e.tomA, e.sarahA, e.sarahB, e.bobB, e.dmTom, e.dmB, e.reactBob]);
  // stop S2 and put the OLD wrong label back, as a relay that ran the previous build would have written it. A store
  // from before the one-time relabel has no RELABEL_META key either, so remove the one S2's first start wrote.
  S2.proc.kill('SIGKILL'); await new Promise(r => S2.proc.once('exit', r));
  const db = new DatabaseSync(join(S2.dataDir, 'relay.sqlite'));
  try {
    assert.equal(db.prepare('DELETE FROM meta WHERE k = ?').run(RELABEL_META).changes, 1, 'CONTROL: a store started on this build has the one-time key');
    for (const id of [e.sarahB.id, e.dmB.id, e.reactBob.id]) db.prepare('UPDATE events SET church = ? WHERE id = ?').run(A.pub, id);
    assert.equal(db.prepare('SELECT church FROM events WHERE id = ?').get(e.dmB.id).church, A.pub, 'CONTROL: the wrong label is in place');
  } finally { db.close(); }
  const S3 = await H.moveRelay(S2);
  const b = await exportIds(S3, B), a = await exportIds(S3, A);
  assert.equal(b.has(e.sarahB.id), true, 'relabelled: Sarah\'s B join now in B\'s backup');
  assert.equal(b.has(e.dmB.id), true, 'relabelled: her DM to B now in B\'s backup');
  assert.equal(b.has(e.reactBob.id), true, 'relabelled: her reaction to Bob now in B\'s backup');
  assert.equal(a.has(e.reactBob.id), false);
  assert.equal(a.has(e.sarahB.id), false);
  assert.equal(a.has(e.dmB.id), false);
  assert.equal(a.has(e.dmTom.id), true, 'CONTROL: the correctly-labelled A row stayed in A');
  // and sync follows the new label
  const moved = [H.relaysDoc(A, [S3, T2], at())];   // the box came back at a new address; tell A's other box
  for (const r of [S3, T2]) await H.publishAll(r, moved);
  await H.syncNow(T2);
  await H.waitFor(async () => holds(T2, e.sarahA.id), { label: 'T2 syncing' });
  assert.equal(holds(T2, e.dmTom.id), true, 'CONTROL: A traffic synced');
  assert.equal(holds(T2, e.sarahB.id), false);
  assert.equal(holds(T2, e.dmB.id), false);
  RELABELLED.S = S3; RELABELLED.e = e;
});

test('7. the relabel runs ONCE per store: a second restart changes nothing, and keeps a label both people still share', async () => {
  const S3 = RELABELLED.S, e = RELABELLED.e;
  assert.ok(S3 && e, 'CONTROL: test 5 ran first');
  const dmTomBob = dm(tom, bob);   // Tom (A only) and Bob (B only) share no church: filed under ''
  await H.publishAll(S3, [dmTomBob]);
  S3.proc.kill('SIGKILL'); await new Promise(r => S3.proc.once('exit', r));
  const db = new DatabaseSync(join(S3.dataDir, 'relay.sqlite'));
  try {
    assert.ok(db.prepare('SELECT v FROM meta WHERE k = ?').get(RELABEL_META), 'CONTROL: the one-time relabel recorded itself');
    // a wrong label put back AFTER the one-time pass: the restart must leave it (the pass does not run again)
    db.prepare('UPDATE events SET church = ? WHERE id = ?').run(A.pub, e.dmB.id);
    assert.equal(db.prepare('SELECT church FROM events WHERE id = ?').get(dmTomBob.id).church, '', 'CONTROL: a pair sharing no church is filed under ""');
  } finally { db.close(); }
  const S4 = await H.moveRelay(S3);
  const a = await exportIds(S4, A), b = await exportIds(S4, B);
  assert.equal(a.has(e.dmB.id), true, 'the second restart re-ran the relabel (moved the row back to B)');
  assert.equal(b.has(e.sarahB.id), true, 'CONTROL: the first pass\'s result is still in place');
  // ...and on a pre-fix store the one-time pass KEEPS a label that names a church both people still share,
  // while still moving one that names a church the peer is not in.
  const dmSD = dm(sarah, dave), dmST = dm(sarah, tom);   // Sarah (A,B) <-> Dave (A,B): A and B both shared
  const notPick = [A.pub, B.pub].sort()[1];   // live rule files dmSD under the OTHER one
  await H.publishAll(S4, [member(dave, A), member(dave, B), dmSD, dmST]);
  S4.proc.kill('SIGKILL'); await new Promise(r => S4.proc.once('exit', r));
  const db2 = new DatabaseSync(join(S4.dataDir, 'relay.sqlite'));
  try {
    db2.prepare('DELETE FROM meta WHERE k = ?').run(RELABEL_META);
    db2.prepare('UPDATE events SET church = ? WHERE id = ?').run(notPick, dmSD.id);   // shared, but not the smallest-pubkey rule's pick
    db2.prepare('UPDATE events SET church = ? WHERE id = ?').run(B.pub, dmST.id);   // Tom is not in B
  } finally { db2.close(); }
  const S5 = await H.moveRelay(S4);
  const a5 = await exportIds(S5, A), b5 = await exportIds(S5, B);
  assert.equal((notPick === A.pub ? a5 : b5).has(dmSD.id), true, 'a label naming a church both people still belong to is kept');
  assert.equal((notPick === A.pub ? b5 : a5).has(dmSD.id), false, 'and not moved to the smallest-pubkey pick');
  assert.equal(b5.has(dmST.id), false, 'a label naming a church the peer is not in is moved');
  assert.equal(a5.has(dmST.id), true, 'CONTROL: ...to the church they share');
});

// A MEMBER WHO LEFT KEEPS HER HISTORY IN THE CHURCH. The one-time relabel runs on a store from before it (upgrade) and
// on the first start after a restore onto a fresh box (the key stays unset until a church exists). Both used to move a
// DM with someone who has since LEFT the church to '' - out of its /export and its box. A label naming a church one of
// the pair NEVER joined (the old first-church misfile) must still move.
const leaveOf = (who, cp) => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', 'trinityone/member:' + cp.pub], ['t', 'trinityone'], ['p', cp.pub], ['deleted', '1']], content: '' }, who.sk);
const metaOf = (relay) => { const db = new DatabaseSync(join(relay.dataDir, 'relay.sqlite'), { readOnly: true }); try { const r = db.prepare('SELECT v FROM meta WHERE k = ?').get(RELABEL_META); return r ? r.v : null; } finally { db.close(); } };
const ARCHIVE = {};
test('8a. upgrade: a DM with a member who has since LEFT stays in the church\'s backup; a never-member misfile still moves', async () => {
  const [U] = await setup('lv');
  const ann = H.key(), ben = H.key(), tim = H.key();     // Ann (A,B), Ben (B, then leaves), Tim (A only)
  const e = { annA: member(ann, A), annB: member(ann, B), benB: member(ben, B), timA: member(tim, A) };
  await H.publishAll(U, [e.annA, e.annB, e.benB, e.timA]);
  e.annBen = dm(ann, ben); e.benAnn = dm(ben, ann); e.benTim = dm(ben, tim);
  await H.publishAll(U, [e.annBen, e.benAnn, e.benTim]);
  const b0 = await exportIds(U, B);
  assert.ok(b0.has(e.annBen.id) && b0.has(e.benAnn.id), 'CONTROL: Ann<->Ben is B\'s while Ben is a member');
  await H.publishAll(U, [leaveOf(ben, B)]);
  U.proc.kill('SIGKILL'); await new Promise(r => U.proc.once('exit', r));
  const db = new DatabaseSync(join(U.dataDir, 'relay.sqlite'));
  try {
    assert.equal(db.prepare('DELETE FROM meta WHERE k = ?').run(RELABEL_META).changes, 1, 'CONTROL: make it a pre-fix store');
    // what a previous build wrote: Ben's DM to Tim under Ben's first church B - Tim never joined B
    db.prepare('UPDATE events SET church = ? WHERE id = ?').run(B.pub, e.benTim.id);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM events WHERE pubkey = ? AND dtag = ? AND raw LIKE '%\"deleted\"%'").get(ben.pub, 'trinityone/member:' + B.pub).n, 1, 'CONTROL: Ben\'s leave (tombstone) is what the store holds');
  } finally { db.close(); }
  const U2 = await H.moveRelay(U);
  assert.ok(metaOf(U2), 'CONTROL: the one-time relabel ran on this start');
  const b1 = await exportIds(U2, B);
  assert.equal(b1.has(e.annBen.id), true, 'Ann->Ben left B\'s backup when Ben left B');
  assert.equal(b1.has(e.benAnn.id), true, 'Ben->Ann left B\'s backup when Ben left B');
  assert.equal(b1.has(e.benTim.id), false, 'CONTROL: a DM filed under a church Tim never joined still moves out of it');
  ARCHIVE.text = await (async () => { const url = `${U2.base}/export`; const r = await fetch(url, { headers: { Authorization: H.nip98(B.sk, url, 'GET', B.pub) } }); return r.text(); })();
  ARCHIVE.benTim = e.benTim; ARCHIVE.annBen = e.annBen; ARCHIVE.benAnn = e.benAnn;
});

test('8b. restore onto a fresh box: a departed member\'s DM is still in the church\'s backup after the next start', async () => {
  assert.ok(ARCHIVE.text, 'CONTROL: 8a produced B\'s archive');
  // the archive an OLD shared server would have written also carried the Ben->Tim misfile under B: add it back
  const nd = ARCHIVE.text.replace(/\n*$/, '\n') + JSON.stringify(ARCHIVE.benTim) + '\n';
  const F = await H.startRelay({ name: 'freshF' });
  const url = `${F.base}/import`;
  const r = await fetch(url, { method: 'POST', body: nd, headers: { Authorization: H.nip98(B.sk, url, 'POST', B.pub) } });
  const j = await r.json();
  assert.equal(j.registered, true, 'CONTROL: the import registered B on the fresh box: ' + JSON.stringify(j));
  const f0 = await exportIds(F, B);
  assert.ok(f0.has(ARCHIVE.annBen.id) && f0.has(ARCHIVE.benTim.id), 'CONTROL: everything imported under B');
  assert.equal(metaOf(F), null, 'CONTROL: a box with no church at its first start has not run the one-time relabel');
  F.proc.kill('SIGKILL'); await new Promise(res => F.proc.once('exit', res));
  const F2 = await H.moveRelay(F);
  assert.ok(metaOf(F2), 'CONTROL: the one-time relabel ran on the start after the restore');
  const f1 = await exportIds(F2, B);
  assert.equal(f1.has(ARCHIVE.annBen.id), true, 'Ann->Ben (Ben left before the backup) dropped out of B\'s restored backup');
  assert.equal(f1.has(ARCHIVE.benAnn.id), true, 'Ben->Ann dropped out of B\'s restored backup');
  assert.equal(f1.has(ARCHIVE.benTim.id), false, 'CONTROL: the never-member misfile still moves out of B');
});

test('6. a DM reaction follows its peer: Sarah\'s reaction to Bob (B) is B\'s, her reaction to Tom (A) is A\'s', async () => {
  const b = await exportIds(S, B), a = await exportIds(S, A);
  assert.equal(a.has(ev.reactTom.id), true, 'CONTROL: reaction to an A-only member is in A\'s backup');
  assert.equal(b.has(ev.reactBob.id), true, 'reaction to Bob is in B\'s backup');
  assert.equal(a.has(ev.reactBob.id), false, 'and not in A\'s');
  await H.syncNow(T);
  await H.waitFor(async () => holds(T, ev.reactTom.id), { label: 'T syncing the A reaction' });
  assert.equal(holds(T, ev.reactBob.id), false, 'the reaction to Bob must not reach A\'s box');
});
