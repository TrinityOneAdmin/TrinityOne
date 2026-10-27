// STRESS (batch 2, area B): RESTORE A SELF-HOSTED CHURCH ONTO A NEW BOX.
// Box T (church A, which also hosts church B) dies. A's steward has A's /export. A fresh box T2 (new key, new
// address, knows no church) takes /import, A re-signs its relay-net list naming T2, and a long-lived shipped
// member bundle must follow with no manual step.
// Run: flock /tmp/claude-1000/selfhost-tests.lock node --test scripts/a-self-hosted-church-restores-onto-a-new-box-stress.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import * as H from './relay-network-harness.mjs';
import { memberOn, secure, sleep, RELAY_NET_D } from './stress2-member-lift.mjs';

const now = () => Math.floor(Date.now() / 1000);
let _at = now();
const relayNetDoc = (church, rows) => finalizeEvent({ kind: 30078, created_at: ++_at, tags: [['d', RELAY_NET_D], ['t', 'trinityone']], content: JSON.stringify(rows) }, church.sk);
const row = (r) => ({ pubkey: r.relayPub, alwaysOn: true, url: r.wsUrl });
const joinDoc = (who, cp, at) => finalizeEvent({ kind: 30078, created_at: at || now(), tags: [['d', 'trinityone/member:' + cp], ['t', 'trinityone'], ['church', cp]], content: '{}' }, who.sk);
const until = async (pred, label, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await pred()) return true; await sleep(150); } assert.fail('timed out: ' + label); };

async function exportOf(relay, church) {
  const url = relay.base + '/export';
  const r = await fetch(url, { headers: { Authorization: H.nip98(church.sk, url, 'GET', church.pub) } });
  assert.equal(r.status, 200, relay.name + ' /export answered ' + r.status);
  return (await r.text());
}
async function importTo(relay, church, ndjson) {
  const url = relay.base + '/import';
  const r = await fetch(url, { method: 'POST', body: ndjson, headers: { Authorization: H.nip98(church.sk, url, 'POST', church.pub) } });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
}
const parse = (nd) => nd.split('\n').filter(l => l.trim()).map(l => JSON.parse(l)).filter(e => !e._manifest);

let A, B, S, T, m1, m2, mb, ev;
before(async () => {
  A = H.key(); A.npub = npubEncode(A.pub); B = H.key(); B.npub = npubEncode(B.pub);
  m1 = H.key(); m2 = H.key(); mb = H.key();
  S = await H.startRelay({ name: 'S', churches: [A.pub, B.pub] });
  T = await H.startRelay({ name: 'T', churches: [A.pub, B.pub] });
  const t = now() - 20;
  const gid = 'g-' + A.pub.slice(0, 6);
  ev = {
    j1: joinDoc(m1, A.pub, t), j2: joinDoc(m2, A.pub, t), jb: joinDoc(mb, B.pub, t),
    grp: finalizeEvent({ kind: 1, created_at: t + 1, tags: [['t', 'trinityone'], ['t', gid], ['p', A.pub]], content: 'group post A' }, m1.sk),
    care: finalizeEvent({ kind: 30078, created_at: t + 1, tags: [['d', 'trinityone/carereq:' + m1.pub.slice(0, 16) + '-r1'], ['t', 'trinityone'], ['t', 'carereq'], ['church', A.pub]], content: '{"x":1}' }, m1.sk),
    dm: finalizeEvent({ kind: 4, created_at: t + 1, tags: [['p', m2.pub]], content: 'dm m1->m2' }, m1.sk),
    bgrp: finalizeEvent({ kind: 1, created_at: t + 1, tags: [['t', 'trinityone'], ['t', 'g-b'], ['p', B.pub]], content: 'group post B' }, mb.sk),
    old: relayNetDoc(A, [row(T)]),
  };
  // ordering: members first so the rest is admitted on both boxes
  for (const R of [S, T]) {
    await H.publishAll(R, [ev.j1, ev.j2, ev.jb]);
    await H.publishAll(R, [ev.grp, ev.care, ev.dm, ev.bgrp, ev.old]);
  }
});
after(() => { H.stopAll(); try { setTimeout(() => process.exit(process.exitCode || 0), 8000).unref(); } catch {} });

test('B1: restore A from T\'s export onto fresh T2: nothing lost, nothing of B filed under A, labels match T', async () => {
  const boxOnly = finalizeEvent({ kind: 1, created_at: now(), tags: [['t', 'trinityone'], ['t', 'g-boxonly'], ['p', A.pub]], content: 'only ever sent to the box' }, m1.sk);
  await H.publishAll(T, [boxOnly]);                       // CONTROL: something only T has
  const tIds = await H.corpusIds(T, A), sIds = await H.corpusIds(S, A);
  assert.ok(tIds.has(boxOnly.id) && !sIds.has(boxOnly.id), 'control: the box-only item must be on T and not on S');

  const nd = await exportOf(T, A);
  const exported = parse(nd);
  const exIds = new Set(exported.map(e => e.id));
  // nothing of church B in A's backup
  const foreign = exported.filter(e => e.id === ev.jb.id || e.id === ev.bgrp.id);
  console.log('B1 export: ' + exported.length + ' events; B items inside A backup: ' + foreign.length);
  assert.equal(foreign.length, 0, 'A\'s backup contains church B\'s items');
  // what did T hold under A that the export left out?
  const missingFromExport = [...tIds].filter(id => !exIds.has(id));
  assert.deepEqual(missingFromExport, [], 'T holds A items its /export did not contain');

  const T2 = await H.startRelay({ name: 'T2' });          // new key, new address, knows no church
  assert.notEqual(T2.relayPub, T.relayPub);
  const r1 = await importTo(T2, A, nd);
  console.log('B1 import result: ' + JSON.stringify(r1));
  assert.equal(r1.status, 200, 'import refused: ' + JSON.stringify(r1));
  await sleep(1500);                                       // hydrateMaps runs after the response
  const d = await H.corpusDiff(T, T2, A);
  assert.deepEqual(d, { onlyOnA: [], onlyOnB: [] }, 'T2 and T disagree about church A: ' + JSON.stringify(d));
  // B must not exist on T2 in any form
  const bOnT2 = (await H.corpus(T2, B).catch(() => [])).length;
  assert.equal(bOnT2, 0, 'church B items appeared on T2');
  // member can read their own data from T2 (hydrated membership works after /import)
  const own = await H.readAs(T2, m1, { authors: [m1.pub] }, 900);
  const kinds = own.map(e => e.kind).sort();
  console.log('B1 m1 reads from T2: kinds=' + JSON.stringify(kinds));
  assert.ok(own.some(e => e.id === ev.grp.id) && own.some(e => e.id === ev.care.id) && own.some(e => e.id === ev.j1.id),
    'a member cannot read their own group post / care request / join from the restored box');
  const dmRead = (await H.readAs(T2, m2, { kinds: [4] }, 900)).some(e => e.id === ev.dm.id);
  assert.ok(dmRead, 'the DM recipient cannot read the DM from the restored box');
  globalThis.__B = { T2, nd, boxOnly };
});

test('B2: restore from S\'s copy instead of T\'s: only the box-only control is missing', async () => {
  const { boxOnly } = globalThis.__B;
  const nd = await exportOf(S, A);
  const T3 = await H.startRelay({ name: 'T3' });
  const r = await importTo(T3, A, nd);
  assert.equal(r.status, 200);
  await sleep(1200);
  const d = await H.corpusDiff(T, T3, A);
  console.log('B2 diff T vs T3(from S): onlyOnT=' + d.onlyOnA.length + ' onlyOnT3=' + d.onlyOnB.length);
  assert.deepEqual(d.onlyOnA, [boxOnly.id], 'restoring from S lost something other than the control: ' + JSON.stringify(d));
  assert.deepEqual(d.onlyOnB, []);
});

test('B3: import twice, and an OLD backup over NEWER data: newer docs and deletions survive', async () => {
  const { T2, nd } = globalThis.__B;
  // second import of the same file
  const again = await importTo(T2, A, nd);
  console.log('B3 re-import: ' + JSON.stringify(again));
  assert.equal(again.imported, 0, 'a second import of the same backup stored ' + again.imported + ' events');
  // newer replaceable doc (the member doc, higher created_at) + a deletion of the group post, made AFTER the backup
  const newer = joinDoc(m1, A.pub, now());
  const del = finalizeEvent({ kind: 5, created_at: now(), tags: [['e', ev.grp.id]], content: '' }, m1.sk);
  await H.publishAll(T2, [newer]);
  await H.publishAll(T2, [del]);
  await sleep(500);
  const ids0 = await H.corpusIds(T2, A);
  assert.ok(ids0.has(newer.id) && !ids0.has(ev.j1.id), 'staging: newer member doc did not replace the old one on T2');
  assert.ok(!ids0.has(ev.grp.id), 'staging: deletion did not remove the group post on T2');
  const back = await importTo(T2, A, nd);                  // the OLD backup, now over newer data
  await sleep(800);
  const ids1 = await H.corpusIds(T2, A);
  console.log('B3 old-over-newer: ' + JSON.stringify(back));
  assert.ok(ids1.has(newer.id), 'an OLD backup overwrote a newer replaceable doc');
  assert.ok(!ids1.has(ev.j1.id), 'the old member doc came back beside the newer one');
  assert.ok(!ids1.has(ev.grp.id), 'an OLD backup resurrected a message its author deleted after the backup');
});

test('B4: a long-lived member follows the church from T to T2 with no manual step, and stops dialling T', async () => {
  const pins = { [secure(S.wsUrl)]: [S.relayPub] };
  const app = memberOn({ church: A, relays: [secure(S.wsUrl)], canonical: [secure(S.wsUrl)], pins });
  const { T2 } = globalThis.__B;
  try {
    await H.publishAll(S, [joinDoc(app.me, A.pub)]);
    await app.adopt(A.pub); await app.gate.refresh(app.churchRelaysRaw(), A.pub);
    assert.ok(app.relays().includes(T.wsUrl), 'staging: member did not adopt T');
    await app.announce(A.pub);
    // T dies; A re-signs naming T2 (new key) — published to S, and to T2
    T.proc.kill('SIGKILL');
    const doc = relayNetDoc(A, [row(T2)]);
    await H.publishAll(S, [doc]); await H.publishAll(T2, [doc]);
    for (const c of app.netCache.values()) c.at -= 61000;
    await app.adopt(A.pub);
    await until(() => app.relays().includes(T2.wsUrl), 'member adopts T2; relays=' + JSON.stringify(app.relays()));
    await app.gate.refresh(app.churchRelaysRaw(), A.pub);
    const pub = app.publishSetFor(A.pub), read = app.relaysForChurch(A.pub);
    const rec = JSON.parse(app.store.getItem('trinityone.relays.netdoc') || '{}')[A.pub] || { rows: {} };
    const ver = Object.keys(JSON.parse(app.store.getItem('trinityone.relays.verified') || '{}'));
    globalThis.__B.stale = { deadStillAdmitted: app.gate.admits(T.wsUrl, A.pub), verifiedHasDead: ver.some(k => T.wsUrl.includes(k)) };
    console.log('B4 measured: relays=' + JSON.stringify(app.relays()) + ' pub=' + JSON.stringify(pub) + ' rows=' + JSON.stringify(rec.rows) + ' verified=' + JSON.stringify(ver));
    assert.equal(app.relays().includes(T.wsUrl) || pub.includes(T.wsUrl) || read.includes(T.wsUrl) || !!rec.rows[T.wsUrl], false, 'the member still names the dead box T');
    // the next write lands on T2
    const w = finalizeEvent({ kind: 1, created_at: now(), tags: [['t', 'trinityone'], ['t', 'g-after'], ['p', A.pub]], content: 'after restore' }, app.me.sk);
    await app.pub(A.pub, w);
    await sleep(500);
    const onT2 = (await H.readAs(T2, app.me, { authors: [app.me.pub] }, 800)).some(e => e.id === w.id);
    assert.ok(onT2, 'the member\'s next write did not reach T2');
    // the member's join was re-sent to the new box
    assert.ok((await H.readAs(T2, app.me, { authors: [app.me.pub], kinds: [30078] }, 800)).length > 0, 'the member\'s join never reached T2');
  } finally { app.close(); }
});

test('B5: the dead box T is forgotten by the admission cache once the church stops signing its key', { todo: 'FINDING: revocation (key no longer signed) drops the address from the list but never calls gate.forget; only the same-key MOVE path does' }, () => {
  const st = globalThis.__B.stale;
  console.log('B5 measured: ' + JSON.stringify(st));
  assert.equal(st.deadStillAdmitted, false, 'the gate still admits the revoked box\'s address (cached proof, up to 30 days)');
});

test('B6: /import answers truthfully: a first import of 7 new events is not also reported as 7 duplicates', async () => {
  const nd = await exportOf(S, A);
  const n = parse(nd).length;
  const T4 = await H.startRelay({ name: 'T4' });
  const r = await importTo(T4, A, nd);
  console.log('B6 measured: ' + JSON.stringify({ n, imported: r.imported, duplicates: r.duplicates }));
  assert.equal(r.imported, n);
  assert.equal(r.duplicates, 0, 'a fresh box reports ' + r.duplicates + ' duplicates for a first import');
  assert.equal(r.skipped, 0, 'nothing was skipped on a first import');
  // the same archive again: every line is now already there
  const r2 = await importTo(T4, A, nd);
  console.log('B6 measured (second import): ' + JSON.stringify({ imported: r2.imported, duplicates: r2.duplicates, skipped: r2.skipped }));
  assert.deepEqual([r2.imported, r2.duplicates, r2.skipped], [0, n, 0], 'a repeat import reports every event as already there');
});
