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

before(async () => {
  [S, T] = await setup('p');
  ev.tomA = member(tom, A); ev.sarahA = member(sarah, A); ev.sarahB = member(sarah, B); ev.bobB = member(bob, B);
  ev.dmTom = dm(sarah, tom); ev.dmB = dm(sarah, B); ev.dmBob = dm(sarah, bob); ev.dmTomBob = dm(tom, bob);
  const res = await H.publishAll(S, [ev.tomA, ev.sarahA, ev.sarahB, ev.bobB, ev.dmTom, ev.dmB, ev.dmBob, ev.dmTomBob]);
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
  const e = { sarahA: member(sarah, A), sarahB: member(sarah, B), bobB: member(bob, B), dmB: dm(sarah, B), dmTom: dm(sarah, tom) };
  e.tomA = member(tom, A);
  await H.publishAll(S2, [e.tomA, e.sarahA, e.sarahB, e.bobB, e.dmTom, e.dmB]);
  // stop S2 and put the OLD wrong label back, as a relay that ran the previous build would have written it
  S2.proc.kill('SIGKILL'); await new Promise(r => S2.proc.once('exit', r));
  const db = new DatabaseSync(join(S2.dataDir, 'relay.sqlite'));
  try {
    for (const id of [e.sarahB.id, e.dmB.id]) db.prepare('UPDATE events SET church = ? WHERE id = ?').run(A.pub, id);
    assert.equal(db.prepare('SELECT church FROM events WHERE id = ?').get(e.dmB.id).church, A.pub, 'CONTROL: the wrong label is in place');
  } finally { db.close(); }
  const S3 = await H.moveRelay(S2);
  const b = await exportIds(S3, B), a = await exportIds(S3, A);
  assert.equal(b.has(e.sarahB.id), true, 'relabelled: Sarah\'s B join now in B\'s backup');
  assert.equal(b.has(e.dmB.id), true, 'relabelled: her DM to B now in B\'s backup');
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
});
