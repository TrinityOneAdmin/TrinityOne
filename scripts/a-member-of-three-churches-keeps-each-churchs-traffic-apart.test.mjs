// ADVERSARIAL tests for the relay's church-labelling fix (resolveChurch rules (a)/(b) and the startup relabel).
// Everything here goes through real gateways: /export and relay-to-relay syncNow, plus a read-only look at which
// rows a box holds. Never resolveChurch's return value (CLAUDE.md rule 3 / 1).
//
// Owner rule under attack: a church's own box receives only that church's traffic (plus churches that chose to be
// hosted on it); a private message may use the box of a church BOTH people belong to, never another.
//
// Church keys are ordered on purpose: B < C < A < D, so the "smallest shared church" tie-break is known:
//   Sarah (A,B,C) <-> Eve (A,C)   share A,C  -> filed under C   (A's backup lacks a message A was entitled to)
//   Sarah (A,B,C) <-> Dan (B,C)   share B,C  -> filed under B   (C's backup lacks a message C was entitled to)
//
// A test marked { todo: 'FINDING: ...' } asserts the CORRECT behaviour and is RED on purpose.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import * as H from './relay-network-harness.mjs';
import { finalizeEvent } from 'nostr-tools/pure';

const ks = [H.key(), H.key(), H.key(), H.key()].sort((x, y) => (x.pub < y.pub ? -1 : 1));
const [B, C, A, D] = ks;   // B < C < A < D
const CH = { A, B, C };
const order = ['B', 'C', 'A'];   // smallest first
const P = {
  sarah: { k: H.key(), in: ['C', 'B', 'A'] },        // joins C, B, A
  sarah2: { k: H.key(), in: ['A', 'B', 'C'] },       // twin: same churches, opposite join order
  tom: { k: H.key(), in: ['A'] }, bob: { k: H.key(), in: ['B'] }, cara: { k: H.key(), in: ['C'] },
  dan: { k: H.key(), in: ['B', 'C'] }, eve: { k: H.key(), in: ['A', 'C'] },
};
const names = Object.keys(P);
let stamp = H.now() - 2000;
const at = () => ++stamp;
const member = (who, cp, extra = {}) => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', 'trinityone/member:' + cp.pub], ['t', 'trinityone'], ['p', cp.pub]], content: JSON.stringify({ joined: stamp, seen: stamp, hb: 1 }), ...extra }, who.sk);
const leave = (who, cp) => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', 'trinityone/member:' + cp.pub], ['t', 'trinityone'], ['p', cp.pub], ['deleted', '1']], content: '' }, who.sk);
const dm = (from, to, extraTags = []) => finalizeEvent({ kind: 4, created_at: at(), tags: [['p', to.pub], ...extraTags], content: 'sealed?iv=AAAA' }, from.sk);
// the client's real DM-reaction shape (src/fellowship.src.js ~5920)
const react = (from, to) => finalizeEvent({ kind: 7, created_at: at(), tags: [['e', 'f'.repeat(64)], ['p', to.pub], ['t', 'trinityone'], ['k', '4']], content: '+' }, from.sk);
const joinPolicy = (c, approval) => H.churchDoc(c, 'trinityone/joinpolicy:' + c.pub, { approval }, at());
const exportIds = async (relay, church) => {
  const url = `${relay.base}/export`;
  const r = await fetch(url, { headers: { Authorization: H.nip98(church.sk, url, 'GET', church.pub) } });
  assert.equal(r.status, 200, 'export of ' + relay.name);
  return new Set((await r.text()).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l).id; } catch { return null; } }));
};
const dbOf = (relay, ro = true) => new DatabaseSync(join(relay.dataDir, 'relay.sqlite'), ro ? { readOnly: true } : {});
const holds = (relay, id) => { const db = dbOf(relay); try { return !!db.prepare('SELECT 1 FROM events WHERE id = ?').get(id); } finally { db.close(); } };
const colOf = (relay, id) => { const db = dbOf(relay); try { const r = db.prepare('SELECT church FROM events WHERE id = ?').get(id); return r ? r.church : undefined; } finally { db.close(); } };
const countCol = (relay, church) => { const db = dbOf(relay); try { return db.prepare('SELECT COUNT(*) n FROM events WHERE church = ? AND structured = 0').get(church).n; } finally { db.close(); } };
const tt = (name, fn, msg) => test(name, { todo: msg }, fn);
const kill = async (r) => { r.proc.kill('SIGKILL'); await new Promise(res => r.proc.once('exit', res)); };
const shared = (a, b) => order.filter(c => P[a].in.includes(c) && P[b].in.includes(c));
const label = (a, b) => shared(a, b)[0] || null;
const hostsOf = (box) => box.churches.map(h => Object.keys(CH).find(n => CH[n].pub === h));
const pairs = []; for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) pairs.push([names[i], names[j]]);

let S, TA, TC, TAC, TB;
const ev = { dm: {}, rx: {} };
const publishChurchDocs = async (relays, c, hosting) => { for (const r of hosting) await H.publishAll(r, [H.relaysDoc(c, relays, at()), joinPolicy(c, false)]); };

before(async () => {
  S = await H.startRelay({ name: 'S', churches: [A.pub, B.pub, C.pub] });
  TA = await H.startRelay({ name: 'TA', churches: [A.pub] });
  TC = await H.startRelay({ name: 'TC', churches: [C.pub] });
  TAC = await H.startRelay({ name: 'TAC', churches: [A.pub, C.pub] });
  TB = await H.startRelay({ name: 'TB', churches: [B.pub] });
  await publishChurchDocs([S, TA, TAC], A, [S, TA, TAC]);
  await publishChurchDocs([S, TB], B, [S, TB]);
  await publishChurchDocs([S, TC, TAC], C, [S, TC, TAC]);
  // joins, in each person's own order
  const joins = [];
  for (const n of names) for (const c of P[n].in) joins.push(member(P[n].k, CH[c]));
  await H.publishAll(S, joins);
  // every DM pair, plus reactions
  const dms = pairs.map(([a, b]) => { ev.dm[a + '>' + b] = dm(P[a].k, P[b].k); return ev.dm[a + '>' + b]; });
  await H.publishAll(S, dms);
  for (const [a, b] of [['sarah', 'bob'], ['sarah', 'eve'], ['sarah', 'dan'], ['eve', 'tom'], ['sarah2', 'eve'], ['sarah2', 'dan'], ['tom', 'bob']])
    ev.rx[a + '>' + b] = react(P[a].k, P[b].k);
  await H.publishAll(S, Object.values(ev.rx));
});
after(() => { H.stopAll(); setTimeout(() => process.exit(process.exitCode || 0), 2000).unref(); });

const syncBoxes = async () => {
  for (const b of [TA, TC, TAC, TB]) await H.syncNow(b);
  await H.waitFor(async () => holds(TA, ev.dm['tom>eve'].id) && holds(TC, ev.dm['cara>dan'].id) && holds(TB, ev.dm['bob>dan'].id) && holds(TAC, ev.dm['tom>eve'].id), { label: 'boxes syncing', timeout: 40000 });
  for (const b of [TA, TC, TAC, TB]) await H.syncNow(b);   // second pass settles anything the first one ordered badly
};

test('1. ATTACKS join order + tie-break: every DM pair is filed under the smallest shared church, twins agree', async () => {
  const ex = {}; for (const n of ['A', 'B', 'C']) ex[n] = await exportIds(S, CH[n]);
  assert.ok(ex.A.size > 0 && ex.B.size > 0 && ex.C.size > 0, 'CONTROL: all three backups are non-empty');
  const bad = [];
  for (const [a, b] of pairs) {
    const id = ev.dm[a + '>' + b].id, want = label(a, b);
    const got = ['A', 'B', 'C'].filter(n => ex[n].has(id));
    if (JSON.stringify(got) !== JSON.stringify(want ? [want] : [])) bad.push(`${a}>${b}: want ${want || 'none'}, in ${got.join('+') || 'none'}`);
  }
  assert.deepEqual(bad, []);
  for (const o of ['tom', 'bob', 'cara', 'dan', 'eve']) {
    const x = ev.dm['sarah>' + o] || ev.dm[o + '>sarah'], y = ev.dm['sarah2>' + o] || ev.dm[o + '>sarah2'];
    assert.deepEqual(['A', 'B', 'C'].map(n => ex[n].has(x.id)), ['A', 'B', 'C'].map(n => ex[n].has(y.id)), 'sarah and her twin differ for ' + o);
  }
});

test('2. ATTACKS box leakage: no box holds a DM between two people who share no church that box hosts', async () => {
  await syncBoxes();
  const bad = []; let held = 0;
  for (const box of [TA, TC, TAC, TB]) for (const [a, b] of pairs) {
    const id = ev.dm[a + '>' + b].id;
    if (!holds(box, id)) continue;
    held++;
    if (!shared(a, b).some(c => hostsOf(box).includes(c))) bad.push(`${box.name} holds ${a}>${b}`);
  }
  assert.ok(held > 0, 'CONTROL: boxes received some DMs by sync');
  assert.equal(holds(TA, ev.dm['tom>eve'].id), true, 'CONTROL: Tom<->Eve (A only) is on TA');
  assert.deepEqual(bad, []);
});

test('2b. ATTACKS completeness: a box should hold every DM between two members of its church', { todo: 'FINDING: only the smallest-pubkey shared church\'s box gets a DM; the other shared churches\' backups lack it (owner decides)' }, async () => {
  await syncBoxes();
  const missing = [];
  for (const box of [TA, TC, TAC, TB]) for (const [a, b] of pairs)
    if (shared(a, b).some(c => hostsOf(box).includes(c)) && !holds(box, ev.dm[a + '>' + b].id)) missing.push(`${box.name} lacks ${a}>${b} (shared ${shared(a, b).join('+')}, filed ${label(a, b)})`);
  console.log('# 2b entitled-but-missing:', JSON.stringify(missing));
  assert.deepEqual(missing, []);
});

test('3. ATTACKS DM reactions: they follow the same rules on the shared relay and the boxes', async () => {
  await syncBoxes();
  const ex = {}; for (const n of ['A', 'B', 'C']) ex[n] = await exportIds(S, CH[n]);
  assert.ok(ex.A.has(ev.rx['eve>tom'].id), 'CONTROL: Eve->Tom reaction in A');
  const bad = [];
  for (const k of Object.keys(ev.rx)) {
    const [a, b] = k.split('>'), want = label(a, b), id = ev.rx[k].id;
    const got = ['A', 'B', 'C'].filter(n => ex[n].has(id));
    if (JSON.stringify(got) !== JSON.stringify(want ? [want] : [])) bad.push(`${k}: want ${want || 'none'}, in ${got.join('+') || 'none'}`);
    for (const box of [TA, TC, TAC, TB]) if (holds(box, id) && !shared(a, b).some(c => hostsOf(box).includes(c))) bad.push(`${box.name} holds reaction ${k}`);
  }
  assert.deepEqual(bad, []);
});

test('8a. ATTACKS the honoured [church] tag: a DM carrying ["church", A] to a B-only member must not enter A\'s backup/box', async () => {
  const e = dm(P.tom.k, P.bob.k, [['church', A.pub]]);          // Tom (A) -> Bob (B only): share nothing
  const e2 = dm(P.sarah.k, P.bob.k, [['church', C.pub]]);       // Sarah (A,B,C) -> Bob: share only B
  await H.publishAll(S, [e, e2]);
  const a = await exportIds(S, A), c = await exportIds(S, C), b = await exportIds(S, B);
  console.log('# 8a tom>bob church=A in A:', a.has(e.id), '| sarah>bob church=C in C:', c.has(e2.id), 'in B:', b.has(e2.id));
  assert.equal(a.has(e.id), false, 'Tom->Bob must not be in A\'s backup');
  assert.equal(c.has(e2.id), false, 'Sarah->Bob (share only B) must not be in C\'s backup');
  assert.equal(b.has(e2.id), true, 'CONTROL: Sarah->Bob carrying a C tag is still filed under B, the church they share');
});

test('8b. ATTACKS a stranger with no member doc at all is refused outright', async () => {
  const z = H.key(), e = dm(z, P.tom.k);
  await assert.rejects(H.publishAll(S, [e]), /not a member/);   // measured: the relay refuses a non-member's DM outright
  assert.equal(holds(S, e.id), false);
  const ok = dm(P.tom.k, P.eve.k); await H.publishAll(S, [ok]);
  assert.equal(holds(S, ok.id), true, 'CONTROL: a member\'s DM is stored');
});

test('6. ATTACKS restart relabel with partial knowledge: a synced DM must survive its box\'s restart', async () => {
  await syncBoxes();
  const id = ev.dm['tom>eve'].id;
  assert.equal((await exportIds(TA, A)).has(id), true, 'CONTROL: Tom<->Eve is in TA\'s A export before the restart');
  // TA lacks Tom's A join note (e.g. not yet synced / lost): delete it from the stopped box
  const tomJoin = ev.tomJoin || null;
  await kill(TA);
  const db = dbOf(TA, false);
  let removed = 0;
  try { removed = db.prepare("DELETE FROM events WHERE pubkey = ? AND kind = 30078 AND dtag = ?").run(P.tom.k.pub, 'trinityone/member:' + A.pub).changes; } finally { db.close(); }
  assert.equal(removed, 1, 'CONTROL: Tom\'s join note removed from TA');
  const TA2 = await H.moveRelay(TA); TA = TA2;
  const col = colOf(TA, id);
  const inA = (await exportIds(TA, A)).has(id);
  console.log('# 6 after restart on TA: church column =', JSON.stringify(col), '; in A export =', inA);
  assert.equal(inA, true, 'a DM synced under A must stay in A\'s export after TA restarts with incomplete member knowledge');
  void tomJoin;
});

test('6b. ATTACKS relabel flip between two hosted churches on TAC: Eve<->Sarah (filed C) when Eve\'s C join is missing', async () => {
  await syncBoxes();
  const id = ev.dm['sarah>eve'].id;
  assert.equal((await exportIds(TAC, C)).has(id), true, 'CONTROL: filed under C on TAC before restart');
  await kill(TAC);
  const db = dbOf(TAC, false);
  try { db.prepare("DELETE FROM events WHERE pubkey = ? AND kind = 30078 AND dtag = ?").run(P.eve.k.pub, 'trinityone/member:' + C.pub); } finally { db.close(); }
  TAC = await H.moveRelay(TAC);
  const inC = (await exportIds(TAC, C)).has(id), inA = (await exportIds(TAC, A)).has(id);
  console.log('# 6b after restart: in C =', inC, ', in A =', inA, ', column =', JSON.stringify(colOf(TAC, id)));
  assert.equal(inC, true, 'Eve<->Sarah must stay in C\'s export (both are C members on S)');
  assert.equal(inA, false, 'Eve<->Sarah must not ALSO move to A');
});

// RESIDUAL (G1, 2026-10-27): the relabel now runs ONCE per store, so 6/6b above (a restart AFTER that pass) are safe.
// A box that already lacks a member doc AT ITS ONE-TIME UPGRADE RELABEL still re-derives that row once. Deleting the
// meta key makes the next start that upgrade start. These assert the correct behaviour and are RED on purpose.
const UPGRADE_KEY = 'relabel:church-label-v1';
tt('6c. RESIDUAL one-time upgrade relabel on a single-church box missing Tom\'s A join: Tom<->Eve stays in A', async () => {
  const id = ev.dm['tom>eve'].id;
  assert.equal((await exportIds(TA, A)).has(id), true, 'CONTROL: Tom<->Eve in TA\'s A export before the upgrade start');
  await kill(TA);
  const db = dbOf(TA, false);
  let gone = 0, missing = 0;
  try {
    gone = db.prepare('DELETE FROM meta WHERE k = ?').run(UPGRADE_KEY).changes;
    db.prepare("DELETE FROM events WHERE pubkey = ? AND kind = 30078 AND dtag = ?").run(P.tom.k.pub, 'trinityone/member:' + A.pub);   // TA may have re-synced it since 6
    missing = db.prepare("SELECT COUNT(*) n FROM events WHERE pubkey = ? AND kind = 30078 AND dtag = ?").get(P.tom.k.pub, 'trinityone/member:' + A.pub).n;
  } finally { db.close(); }
  assert.deepEqual([gone, missing], [1, 0], 'CONTROL: the store had its one-time key, and lacks Tom\'s join');
  TA = await H.moveRelay(TA);
  const col = colOf(TA, id), inA = (await exportIds(TA, A)).has(id);
  console.log('# 6c after the one-time upgrade relabel on TA: church column =', JSON.stringify(col), '; in A export =', inA);
  assert.equal(inA, true, 'a synced DM must stay in A\'s export through the one-time upgrade relabel');
}, 'RESIDUAL: the one-time upgrade relabel re-derives a row from the box\'s member docs; a box lacking a join doc at that moment moves a synced DM once');
tt('6d. RESIDUAL one-time upgrade relabel on TAC missing Eve\'s C join: Eve<->Sarah stays in C', async () => {
  const id = ev.dm['sarah>eve'].id;
  assert.equal((await exportIds(TAC, C)).has(id), true, 'CONTROL: filed under C on TAC before the upgrade start');
  await kill(TAC);
  const db = dbOf(TAC, false);
  let gone = 0;
  try { gone = db.prepare('DELETE FROM meta WHERE k = ?').run(UPGRADE_KEY).changes; } finally { db.close(); }
  assert.equal(gone, 1, 'CONTROL: the store had its one-time key');
  TAC = await H.moveRelay(TAC);
  const inC = (await exportIds(TAC, C)).has(id), inA = (await exportIds(TAC, A)).has(id);
  console.log('# 6d after the one-time upgrade relabel on TAC: in C =', inC, ', in A =', inA, ', column =', JSON.stringify(colOf(TAC, id)));
  assert.equal(inC, true, 'Eve<->Sarah must stay in C\'s export through the one-time upgrade relabel');
}, 'RESIDUAL: same, between two hosted churches - a row can move C->A once at the upgrade start');

// ---- isolated topologies -------------------------------------------------------------------------------------
const mini = async (name, hosted, env = {}) => {
  const s = await H.startRelay({ name: name + 'S', churches: hosted.map(c => c.pub), env });
  return s;
};

test('4. ATTACKS leave: Sarah leaves B, then the box restarts - where does her history with Bob go?', async () => {
  const X = await mini('lv', [A, B]);
  for (const c of [A, B]) await H.publishAll(X, [joinPolicy(c, false)]);
  const sarah = H.key(), bob = H.key(), dan = H.key();
  await H.publishAll(X, [member(sarah, A), member(sarah, B), member(bob, B), member(dan, A), member(dan, B)]);
  const toBob = dm(sarah, bob), fromBob = dm(bob, sarah), toDan = dm(sarah, dan);
  await H.publishAll(X, [toBob, fromBob, toDan]);
  const b0 = await exportIds(X, B);
  assert.equal(b0.has(toBob.id), true, 'CONTROL: Sarah->Bob in B\'s backup while she is a member');
  await H.publishAll(X, [leave(sarah, B)]);
  assert.equal(holds(X, toBob.id), true);
  const X2 = await H.moveRelay(X);
  const b1 = await exportIds(X2, B), a1 = await exportIds(X2, A);
  console.log('# 4 after leave+restart: Sarah->Bob column', JSON.stringify(colOf(X2, toBob.id)), '| in B export', b1.has(toBob.id), '| Sarah->Dan in A', a1.has(toDan.id), 'in B', b1.has(toDan.id));
  assert.equal(a1.has(toDan.id) || b1.has(toDan.id), true, 'CONTROL: the still-shared DM keeps a church');
  assert.equal(a1.has(toBob.id), false, 'her old DM to Bob must not move to A');
  assert.equal(b1.has(toBob.id), true, 'Bob\'s own history with a member who left stays in B\'s backup');
  assert.equal(b1.has(fromBob.id), true, 'and his messages to her');
});

test('4b. ATTACKS the shared "" bucket: rows of a member who left are not moved into it and culled, while A\'s survive', async () => {
  const X = await mini('cull', [A, B], { RELAY_MAX_EVENTS: '4' });
  for (const c of [A, B]) await H.publishAll(X, [joinPolicy(c, false)]);
  const sarah = H.key(), bob = H.key(), tom = H.key();
  await H.publishAll(X, [member(sarah, A), member(sarah, B), member(bob, B), member(tom, A)]);
  const toBob = []; for (let i = 0; i < 4; i++) toBob.push(dm(i % 2 ? bob : sarah, i % 2 ? sarah : bob));
  const toTom = [dm(sarah, tom), dm(tom, sarah)];
  await H.publishAll(X, [...toBob, ...toTom]);
  assert.equal(countCol(X, B.pub), 4, 'CONTROL: four Sarah<->Bob rows under B');
  await H.publishAll(X, [leave(sarah, B)]);
  let cur = await H.moveRelay(X);                        // before G1 this restart's relabel moved Sarah<->Bob to ''
  const afterRelabel = countCol(cur, ''), stillB = countCol(cur, B.pub);
  // the '' bucket is shared with every other pair that shares no church; add enough to overflow it
  const strangers = []; for (let i = 0; i < 3; i++) strangers.push(dm(tom, bob));   // members of different churches: share nothing
  await H.publishAll(cur, strangers);
  cur = await H.moveRelay(cur);                          // startup cull runs
  const left = toBob.filter(e => holds(cur, e.id)).length;
  console.log('# 4b \'\' bucket after restart:', afterRelabel, '| under B:', stillB, '| old Sarah<->Bob rows surviving after cull:', left, '| A rows:', countCol(cur, A.pub));
  assert.deepEqual([afterRelabel, stillB], [0, 4], 'the restart left Sarah<->Bob under B (nothing moved into the \'\' bucket)');
  assert.equal(countCol(cur, A.pub), 2, 'CONTROL: A\'s own rows untouched');
  assert.equal(left, 4, 'Bob\'s history with Sarah must not be evicted because unrelated strangers share the \'\' budget');
  assert.equal(countCol(cur, ''), 3, 'CONTROL: the three stranger DMs are in the \'\' bucket (so its budget was in play)');
});

test('5. ATTACKS pending/blocked members: a DM from someone who only ASKED to join B (or whom B blocked) is not B-traffic', async () => {
  const SB = await H.startRelay({ name: 'gB', churches: [B.pub] });
  const TBx = await H.startRelay({ name: 'gTB', churches: [B.pub] });
  const bobK = H.key(), pend = H.key(), mal = H.key();
  await H.publishAll(SB, [H.relaysDoc(B, [SB, TBx], at()), joinPolicy(B, true)]);
  await H.publishAll(TBx, [H.relaysDoc(B, [SB, TBx], at()), joinPolicy(B, true)]);
  const admit = H.churchDoc(B, 'trinityone/admitted:' + B.pub, { pubkeys: [bobK.pub, mal.pub] }, at());
  await H.publishAll(SB, [admit, member(bobK, B), member(pend, B), member(mal, B)]);
  const fromPending = dm(pend, bobK), preBlock = dm(mal, bobK);
  const res = [];
  for (const e of [fromPending, preBlock]) { try { await H.publishAll(SB, [e]); res.push('accepted'); } catch (err) { res.push('refused: ' + err.message); } }
  await H.publishAll(SB, [H.churchDoc(B, 'trinityone/blocked:' + B.pub, { pubkeys: [mal.pub] }, at())]);
  const afterBlock = dm(mal, bobK); let blockedRes = 'accepted'; try { await H.publishAll(SB, [afterBlock]); } catch (err) { blockedRes = 'refused: ' + err.message; }
  await H.syncNow(TBx);
  await H.waitFor(async () => holds(TBx, member(bobK, B).id) || true, { timeout: 1000 });
  const bExp = await exportIds(SB, B);
  console.log('# 5 pending publish:', res[0], '| in B export:', bExp.has(fromPending.id), '| on B box:', holds(TBx, fromPending.id));
  console.log('# 5 pre-block publish:', res[1], '| in B export:', bExp.has(preBlock.id), '| on B box:', holds(TBx, preBlock.id));
  console.log('# 5 post-block publish:', blockedRes, '| in B export:', bExp.has(afterBlock.id), '| on B box:', holds(TBx, afterBlock.id));
  assert.equal(bExp.size > 0, true, 'CONTROL: B backup exists');
  assert.equal(bExp.has(fromPending.id), false, 'a pending applicant\'s DM must not be B traffic');
  assert.equal(holds(TBx, afterBlock.id), false, 'a blocked member\'s DM must not be on B\'s box');
});
