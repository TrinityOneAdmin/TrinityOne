// THE NETWORK KEY MAY READ A CHURCH'S JOIN DECLARATION -- AND NOTHING ELSE OF THE CHURCH'S (Networks MVP, N5c / Option A).
//   Run: node --test scripts/a-network-learns-which-churches-joined-it.test.mjs   (SOLO -- fixed port 19873)
//
// A church JOINS a network by publishing `trinityone/network:<networkpub>` ({joined,v,scopes}) from its own key. Until N5c the relay served that
// document to the church alone, so the founder console could never learn who joined. N5c adds ONE read branch to canRead(): the key `np` the
// document names may read it, while `np` is a declared network AND the author is a church key that currently has that join live. Nothing else.
//
// What this file proves, each refusal next to a control that IS served (a refusal beside no control proves nothing):
//   (1) the network key IS served the join documents of the churches that joined it
//   (2) a DIFFERENT network key is not (its own churches' documents are served to it -- the control)
//   (3) an anonymous reader, a stranger and a member of ANOTHER church are not ((3b): a member of the joining church IS, as it always was)
//   (4) the church still reads its own join document
//   (5) N1 ANCHOR: the same network key is still refused the church's group / plan / roster / stewards / member list / finance -- the grant is the join doc only
//   (7) WALL (ported 2026-11-18): against a STRANGER baseline, over every kind -- the network key is served exactly ONE thing a stranger is
//       not: the join doc naming IT. Not the same church's join doc for another network, not the hop-2 envelope, not children, finance,
//       roster, chat or member docs; another network key gains exactly its own join doc; after a leave the network gains nothing.
//   (6) a church that LEAVES (tombstone) stops being served as a join
// SABOTAGE record (run by hand, see the commit): widening the branch to serve any church document turns (5) red.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const PORT = 19873, WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const P = 'trinityone/';
const A = K(), B = K(), N = K(), N2 = K(), stranger = K(), memberA = K(), memberB = K(), stewardA = K();
// (7)'s own church and networks, kept apart so the counts in (1)-(6) are untouched: C joins NX AND NY.
const C = K(), NX = K(), NY = K(), memberC = K(), kidC = K(), stewardC = K(), stranger2 = K();
let relay, dataDir, spawnedAt, seq = 0;
const stored = {};

const connect = (who) => new Promise((res, rej) => {
  const w = new WebSocket(WS_URL);
  w.on('open', () => { w.on('message', (d) => { const m = JSON.parse(d);
    if (m[0] === 'AUTH' && who) w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)])); }); res(w); });
  w.on('error', rej);
});
const publish = (w, evt) => new Promise((res) => { const on = (d) => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { w.off('message', on); res([m[2], m[3] || '']); } }; w.on('message', on); w.send(JSON.stringify(['EVENT', evt])); setTimeout(() => res([null, 'timeout']), 5000); });
const reqOn = (w, filters) => new Promise((res) => {
  const out = []; const id = 'r' + Math.random().toString(36).slice(2, 7);
  const on = (d) => { const m = JSON.parse(d); if (m[0] === 'EVENT' && m[1] === id) out.push(m[2]); if (m[0] === 'EOSE' && m[1] === id) setTimeout(() => { w.off('message', on); res(out); }, 200); };
  w.on('message', on); w.send(JSON.stringify(['REQ', id, ...filters])); setTimeout(() => { w.off('message', on); res(out); }, 4000);
});
async function asReader(who, filters) { const w = await connect(who); await sleep(200); const got = await reqOn(w, filters); w.close(); return got; }
const doc = (k, d, body, extra = []) => finalizeEvent({ kind: 30078, created_at: now() + (seq++), tags: [['d', d], ['t', 'trinityone'], ...extra], content: typeof body === 'string' ? body : JSON.stringify(body) }, k.sk);
const tomb = (k, d) => finalizeEvent({ kind: 30078, created_at: now() + (seq++), tags: [['d', d], ['t', 'trinityone'], ['deleted', '1']], content: '' }, k.sk);
const joinDoc = (church, np) => doc(church, P + 'network:' + np, { joined: true, v: 1, scopes: ['announcements', 'events'] }, [['p', np]]);
const joinsSeenBy = async (who, np) => (await asReader(who, [{ kinds: [30078], '#d': [P + 'network:' + np] }])).map(e => e.pubkey).sort();
const idsServed = async (who, ids) => (await asReader(who, [{ ids, kinds: [30078] }])).map(e => e.id);

before(async () => {
  await requireFreePort(PORT, 'a-network-learns-which-churches-joined-it.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-n5c-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: [A, B, C].map((c) => npubEncode(c.pub)).join(','), RELAY_MAX_EVENTS: '5000' } });
  spawnedAt = Date.now();
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  const ok = async (who, e, why) => { const w = await connect(who); await sleep(150); const [k, m] = await publish(w, e); w.close(); assert.equal(k, true, why + ' (' + m + ')'); return e; };
  await ok(A, joinDoc(A, N.pub), 'A joins N'); await ok(B, joinDoc(B, N2.pub), 'B joins N2');
  await ok(memberA, doc(memberA, P + 'member:' + A.pub, { joined: now() }, [['p', A.pub]]), 'member joins A');
  await ok(A, doc(A, P + 'stewards:' + A.pub, { pubkeys: [stewardA.pub], caps: { [stewardA.pub]: ['content'] } }), 'A steward roster');
  await ok(memberB, doc(memberB, P + 'member:' + B.pub, { joined: now() }, [['p', B.pub]]), 'member joins B');
  await sleep(400);
  const CH = [['church', A.pub]];
  for (const [label, d, body] of [['group', P + 'group:g1', { name: 'Hosts', vis: 'public' }], ['plan', P + 'plan:p1', { title: 'Harvest', draft: false }], ['roster', P + 'roster:t1', { pubs: [] }], ['service', P + 'service:s1', { title: 'Sunday' }], ['finance', 'finance/account:bank', { x: 1 }]]) {
    stored[label] = (await ok(A, doc(A, d, body, CH), 'A writes ' + label)).id;
  }
  stored.rosterOfStewards = (await asReader(A, [{ kinds: [30078], authors: [A.pub], '#d': [P + 'stewards:' + A.pub] }]))[0].id;
  stored.memberList = (await asReader(A, [{ kinds: [30078], authors: [memberA.pub], '#d': [P + 'member:' + A.pub] }]))[0].id;
  stored.joinA = (await asReader(A, [{ kinds: [30078], authors: [A.pub], '#d': [P + 'network:' + N.pub] }]))[0].id;
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('FRESHNESS (rule 10): the relay under test was spawned AFTER scripts/gateway.mjs was last written', () => {
  assert.ok(spawnedAt > statSync(new URL('./gateway.mjs', import.meta.url).pathname).mtimeMs, 'a relay older than gateway.mjs would enforce old gates against the new bundle');
});

test('(1) the network key IS served the join document of the church that joined it, by #d and by #p', async () => {
  assert.deepEqual(await joinsSeenBy(N, N.pub), [A.pub]);
  assert.deepEqual((await asReader(N, [{ kinds: [30078], '#p': [N.pub], '#t': ['trinityone'] }])).map(e => e.pubkey), [A.pub]);
  assert.deepEqual(await idsServed(N, [stored.joinA]), [stored.joinA]);
});

test('(2) a DIFFERENT network key is not served it; its own church\'s join document IS served to it (control)', async () => {
  assert.deepEqual(await joinsSeenBy(N2, N.pub), [], 'another network read the join documents of N');
  assert.deepEqual(await idsServed(N2, [stored.joinA]), [], 'another network was served A\'s join document by id');
  assert.deepEqual(await joinsSeenBy(N2, N2.pub), [B.pub], 'CONTROL: N2 must be served the church that joined N2 -- the refusal above proves nothing otherwise');
  assert.deepEqual(await joinsSeenBy(N, N2.pub), [], 'N read the join documents of a network it is not');
});

test('(3) an anonymous reader, a stranger and a member of ANOTHER church are not served it', async () => {
  for (const [who, name] of [[null, 'an anonymous reader'], [stranger, 'a stranger'], [memberB, 'a member of another church']]) assert.deepEqual(await idsServed(who, [stored.joinA]), [], name + ' was served a church\'s join document');
});

test('(3b) UNCHANGED BY N5c: a member of the joined church is served its own church\'s join document through the existing churchReader fall-through', async () => {
  // measured on the commit BEFORE this change (8390db27) too -- the brief expected this refused; it never was. The join document carries no member data.
  assert.deepEqual(await idsServed(memberA, [stored.joinA]), [stored.joinA]);
});

test('(4) the church still reads its own join document, exactly as before', async () => {
  assert.deepEqual(await idsServed(A, [stored.joinA]), [stored.joinA]);
});

test('(5) N1 ANCHOR: the same network key is still REFUSED the church\'s group / plan / roster / service / finance / stewards / member list', async () => {
  const ids = Object.entries(stored).filter(([k]) => k !== 'joinA').map(([, v]) => v);
  assert.equal(ids.length, 7);
  assert.deepEqual(await idsServed(N, ids), [], 'the network key was served church content beyond the join document');
  const wide = await asReader(N, [{ kinds: [30078] }, { kinds: [30078], '#church': [A.pub] }, { kinds: [30078], authors: [A.pub] }]);
  assert.deepEqual([...new Set(wide.map(e => e.id))].filter(i => i !== stored.joinA), [], 'a wide REQ as the network key returned church documents');
  assert.deepEqual((await idsServed(A, ids)).sort(), [...ids].sort(), 'CONTROL: the church itself must read all of them');
});

test('(7) WALL: the N5c read is the join doc naming THAT key and nothing else -- measured against a stranger, over every kind', async () => {
  const ok = async (who, e, why) => { const w = await connect(who); await sleep(150); const [k, m] = await publish(w, e); w.close(); assert.equal(k, true, why + ' (' + m + ')'); return e; };
  const CH = [['church', C.pub]];
  const joinX = await ok(C, joinDoc(C, NX.pub), 'C joins NX');
  const joinY = await ok(C, joinDoc(C, NY.pub), 'C joins NY');
  await ok(memberC, doc(memberC, P + 'member:' + C.pub, { joined: now() }, [['p', C.pub]]), 'member joins C');
  await ok(kidC, doc(kidC, P + 'member:' + C.pub, { joined: now() }, [['p', C.pub]]), 'child joins C');
  await ok(C, doc(C, P + 'minors:' + C.pub, { pubkeys: [kidC.pub] }), 'C marks a child');
  await ok(C, doc(C, P + 'stewards:' + C.pub, { pubkeys: [stewardC.pub], caps: { [stewardC.pub]: ['content'] } }), 'C steward roster');
  await ok(C, doc(C, P + 'group:gc1', { name: 'Elders', vis: 'public' }, CH), 'C group');
  await ok(C, doc(C, P + 'plan:pc1', { title: 'Harvest', draft: false }, CH), 'C plan');
  await ok(C, doc(C, 'finance/account:bank', { x: 1 }, CH), 'C finance');
  await ok(C, doc(C, P + 'netkeyc:' + NX.pub, { e: 'QUJDREVGR0hJSg' }), 'C hop-2 envelope for NX');
  await ok(memberC, finalizeEvent({ kind: 1, created_at: now() + (seq++), tags: [['t', 'trinityone'], ['t', 'gc1'], ['church', C.pub]], content: 'hello elders' }, memberC.sk), 'member chat in C');
  await sleep(400);
  // Every filter shape a hostile network client might try: by author, by church tag, by p-tag (the join doc p-tags the network), by kind, and bare.
  const F = [{ authors: [C.pub, memberC.pub, kidC.pub, stewardC.pub] }, { '#church': [C.pub] }, { '#p': [C.pub] }, { '#p': [NX.pub] }, { '#p': [NY.pub] },
             { kinds: [30078] }, { kinds: [0, 1, 4, 7] }, { '#d': [P + 'network:' + NX.pub, P + 'network:' + NY.pub, P + 'minors:' + C.pub, P + 'netkeyc:' + NX.pub] }, {}];
  const BY_ID = {};
  const seenBy = async (who) => new Set((await asReader(who, F)).filter((e) => e.pubkey !== who.pub).map((e) => (BY_ID[e.id] = e, e.id)));   // a key's OWN events are always its own
  // "of church C": authored by C or one of C's people, or naming C in a church / p tag or in its d-tag. The bare filters above reach the whole
  // relay, so a reader's gain over a stranger also contains ITS OWN church's documents -- those are not C's and say nothing about C.
  const C_PEOPLE = new Set([C.pub, memberC.pub, kidC.pub, stewardC.pub]);
  const ofC = (id) => { const e = BY_ID[id]; return C_PEOPLE.has(e.pubkey) || (e.tags || []).some((t) => (t[0] === 'church' || t[0] === 'p' || t[0] === 'd') && String(t[1] || '').includes(C.pub)); };
  const gained = async (who) => { const base = await seenBy(stranger2), got = await seenBy(who); return [...got].filter((id) => !base.has(id)).sort(); };
  // CONTROL: C's private documents exist and are readable to C's own member -- so a refusal to NX is not a refusal of nothing.
  const memberSees = await seenBy(memberC);
  assert.ok(memberSees.has(joinX.id) && memberSees.has(joinY.id), 'CONTROL: C\'s member was not served C\'s join docs');
  assert.ok((await gained(memberC)).filter(ofC).length >= 5, 'CONTROL: a member of C gains almost nothing over a stranger -- the fixture is not exercising private reads');
  // THE CLAIM, over the WHOLE relay (not only C): NX gains exactly joinX over a stranger; NY gains exactly joinY.
  assert.deepEqual(await gained(NX), [joinX.id], 'the network key NX was served something beyond the ONE join doc naming NX');
  assert.deepEqual(await gained(NY), [joinY.id], 'the network key NY was served something beyond the ONE join doc naming NY');
  // ...and only to that key: a church key that did not join, a member of another church, and the OTHER joined network get none of it.
  for (const [who, name] of [[B, 'another church key'], [memberB, 'a member of another church'], [stewardA, 'a steward of another church'], [N, 'a network C never joined']])
    assert.deepEqual((await gained(who)).filter(ofC), [], name + ' gained something of church C over a stranger');
  // LIVE: after C leaves NX, NX gains nothing at all; NY (still joined) keeps exactly its own.
  await ok(C, tomb(C, P + 'network:' + NX.pub), 'C leaves NX'); await sleep(300);
  assert.deepEqual(await gained(NX), [], 'after C left, the network key NX still gains something over a stranger');
  assert.deepEqual(await gained(NY), [joinY.id], 'leaving NX changed what NY is served');
});

test('(6) a church that LEAVES (tombstones its join) is no longer served to the network as a join', async () => {
  assert.deepEqual(await joinsSeenBy(N, N.pub), [A.pub], 'CONTROL: still joined before it leaves');
  const w = await connect(A); await sleep(150); const [ok, why] = await publish(w, tomb(A, P + 'network:' + N.pub)); w.close();
  assert.equal(ok, true, 'the tombstone was refused: ' + why);
  await sleep(300);
  assert.deepEqual(await joinsSeenBy(N, N.pub), [], 'the network was still served a church that has left');
  assert.deepEqual(await idsServed(N, [stored.joinA]), [], 'the old join document is still served after a leave');
});
