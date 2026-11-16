// GET /sync-status?church=<hex> — the per-church sync result a relay reports, REAL gateways, REAL signed requests.
// Run: node --test scripts/sync-status-endpoint.test.mjs
//
//  1 NO BLEED, SAME PARTNER: ONE partner box P serves two churches. P's copy of church B's signed list lacks S, so P
//    refuses S for B and only B. A reads "reached", B reads "refused" (reason trust), while the box-wide /status
//    sync.ok is false (unchanged). The refusal counts in PASSES, and the first good pass clears it.
//  2 IDENTICAL REFUSAL: unsigned, wrong signer, unknown church, a church this box does not host, a proof bound to the
//    wrong path, a proof 10 min old, a query naming another church — all the SAME status and body and headers.
//  3 WHO MAY ASK: the church key and a steward of the church get the church block; a block with peers:0 is still returned.
//  4 /status is byte-identical in shape with and without ?church=, and no reply carries a peer address or key.
//  5 UNREACHED is not reached; CLOCK vs TRUST recorded from the 401 body.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import * as H from './relay-network-harness.mjs';
import { liftSteward } from './sync-status-lift.mjs';

const SHIM = join(import.meta.dirname, 'stress4-clock-shim.cjs');
const nowS = () => Math.floor(Date.now() / 1000);
const A = H.key(), B = H.key(), U = H.key(), N = H.key(), NOHOST = H.key(), STEW = H.key(), STRANGER = H.key();
let S, P;
after(() => { H.stopAll(); setTimeout(() => process.exit(process.exitCode || 0), 2000).unref(); });

const ask = async (relay, church, { sk, tagChurch, path = '/sync-status', age = 0, bareQuery = church, method = 'GET', noAuth = false } = {}) => {
  const url = relay.base + '/sync-status?church=' + encodeURIComponent(bareQuery);
  const bound = relay.base + path + '?church=' + encodeURIComponent(bareQuery);
  const headers = {};
  if (!noAuth) {
    const { finalizeEvent } = await import('nostr-tools/pure');
    headers.Authorization = 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({ kind: 27235, created_at: nowS() - age, tags: [['u', bound], ['method', 'GET'], ['church', tagChurch || church]], content: '' }, sk))).toString('base64');
  }
  const r = await fetch(url, { method, headers });
  const body = await r.text();
  const hd = {}; for (const k of ['content-type', 'cache-control', 'access-control-allow-origin', 'access-control-allow-headers']) hd[k] = r.headers.get(k);
  let json = null; try { json = JSON.parse(body); } catch {}
  return { status: r.status, body, hd, json };
};

before(async () => {
  S = await H.startRelay({ name: 'sS', churches: [A.pub, B.pub, U.pub, N.pub] });
  P = await H.startRelay({ name: 'sP', churches: [A.pub, B.pub] });
  const t0 = nowS() - 600;
  const dead = { relayPub: 'ab'.repeat(32), base: 'http://127.0.0.1:1' };
  await H.publishAll(S, [H.relaysDoc(A, [S, P], t0), H.relaysDoc(B, [S, P], t0), H.relaysDoc(U, [S, dead], t0), H.relaysDoc(N, [S], t0)]);
  await H.publishAll(P, [H.relaysDoc(A, [S, P], t0), H.relaysDoc(B, [P], t0)]);   // P's copy of B's list LACKS S
  await H.publishAll(S, [H.churchDoc(A, 'trinityone/stewards:' + A.pub, { pubkeys: [STEW.pub] }, t0)]);
  await H.publishAll(P, [H.churchDoc(A, 'trinityone/notice:p', { a: 1 }, t0), H.churchDoc(B, 'trinityone/notice:p', { a: 1 }, t0)]);
});

test('0 before any pass a church with partners is "pending", one with none is "none" with peers:0', async () => {
  const a = await ask(S, A.pub, { sk: A.sk });
  assert.equal(a.status, 200);
  assert.equal(a.json.church.peers, 1); assert.equal(a.json.church.state, 'pending'); assert.equal(a.json.church.at, 0);
  const n = await ask(S, N.pub, { sk: N.sk });
  assert.equal(n.status, 200); assert.equal(n.json.church.peers, 0); assert.equal(n.json.church.state, 'none');
});

test('1 NO BLEED: same partner, church A reached, church B refused (trust); box-wide ok is false; counted in passes; first good pass clears', async () => {
  await H.syncNow(S).catch(() => {});
  const a = (await ask(S, A.pub, { sk: A.sk })).json.church, b = (await ask(S, B.pub, { sk: B.sk })).json.church;
  assert.equal(a.state, 'reached', 'church A must not borrow B\'s refusal: ' + JSON.stringify(a));
  assert.equal(a.refusedPasses, 0); assert.ok(a.lastReachedAt > 0);
  assert.equal(b.state, 'refused', JSON.stringify(b)); assert.equal(b.reason, 'trust'); assert.equal(b.refusedPasses, 1);
  assert.equal(b.running, false);
  const st = await S.status();
  assert.equal(st.sync.ok, false, 'the box-wide flag is unchanged: false because ONE church was refused');
  await H.syncNow(S).catch(() => {});
  assert.equal((await ask(S, B.pub, { sk: B.sk })).json.church.refusedPasses, 2, 'a second consecutive refused pass counts 2');
  assert.equal((await ask(S, A.pub, { sk: A.sk })).json.church.state, 'reached');
  // THROUGH THE SHIPPED BUNDLE, against the REAL gateway: the console's own relaySyncStates signs with the bundle's _nip98 and
  // classifies the answer with the bundle's relaySyncState. Same partner box P for both churches.
  const through = async (c) => (await liftSteward({ sk: c.sk, pub: c.pub, relays: () => [S.wsUrl, P.wsUrl], fetch }).Steward.relaySyncStates());
  const viaA = await through(A), viaB = await through(B);
  const sOf = (rows, relay) => rows.find(r => r.url === relay.wsUrl);
  assert.equal(sOf(viaA, S).state, 'synced', 'church A, same partner: must read Synced, not B\'s refusal');
  assert.equal(sOf(viaA, S).label, 'Synced');
  assert.equal(sOf(viaB, S).state, 'attention', 'church B was refused twice in a row: ' + JSON.stringify(sOf(viaB, S)));
  assert.equal(sOf(viaB, S).label, 'Needs attention');
  // the church re-saves its list so P trusts S for B: the FIRST good pass clears it
  await H.publishAll(P, [H.relaysDoc(B, [S, P], nowS() - 5)]);
  await H.syncNow(S).catch(() => {});
  const b3 = (await ask(S, B.pub, { sk: B.sk })).json.church;
  assert.equal(b3.state, 'reached', JSON.stringify(b3)); assert.equal(b3.refusedPasses, 0);
});

test('2 every refusal is the SAME answer: unsigned, wrong signer, unknown, not hosted, wrong path, old proof, other-church query', async () => {
  const cases = {
    unsigned: await ask(S, A.pub, { noAuth: true }),
    stranger: await ask(S, A.pub, { sk: STRANGER.sk }),
    unknownChurch: await ask(S, 'ff'.repeat(32), { sk: STRANGER.sk }),
    notHosted: await ask(S, NOHOST.pub, { sk: NOHOST.sk }),
    wrongPath: await ask(S, A.pub, { sk: A.sk, path: '/sync-digest' }),
    oldProof: await ask(S, A.pub, { sk: A.sk, age: 600 }),
    otherChurchQuery: await ask(S, A.pub, { sk: A.sk, bareQuery: B.pub }),
    postMethod: await ask(S, A.pub, { sk: A.sk, method: 'POST' }),
  };
  const ref = cases.unsigned;
  assert.equal(ref.status, 401);
  for (const [k, v] of Object.entries(cases)) {
    assert.equal(v.status, ref.status, k + ' status'); assert.equal(v.body, ref.body, k + ' body'); assert.deepEqual(v.hd, ref.hd, k + ' headers');
  }
  assert.doesNotMatch(ref.body, /window|clock|timestamp/i);
  const st = await S.status();
  assert.ok(!st.clockSuspect, 'an old-dated proof to /sync-status must not raise the box\'s clockSuspect');
  const pre = await fetch(S.base + '/sync-status', { method: 'OPTIONS' });
  assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/);
});

test('3 the church key and a steward of the church get the block; a steward of ANOTHER church does not; unreached is not reached', async () => {
  const viaChurch = await ask(S, A.pub, { sk: A.sk });
  const viaSteward = await ask(S, A.pub, { sk: STEW.sk });
  assert.equal(viaChurch.status, 200); assert.equal(viaSteward.status, 200);
  assert.deepEqual(viaSteward.json, viaChurch.json);
  assert.equal((await ask(S, B.pub, { sk: STEW.sk })).status, 401, 'a steward of A has no standing in B');
  const u = (await ask(S, U.pub, { sk: U.sk })).json.church;
  assert.equal(u.state, 'unreached', 'the only partner is a dead address: this must never read as reached: ' + JSON.stringify(u));
  assert.equal(u.lastReachedAt, 0);
  const n = (await ask(S, N.pub, { sk: N.sk })).json.church;
  assert.equal(n.peers, 0); assert.equal(n.state, 'none');
});

test('4 /status is unchanged with or without ?church=, and no reply carries a peer address or key', async () => {
  const get = async (q) => { const j = await (await fetch(S.base + '/status' + q)).json(); return j; };
  const norm = (j) => JSON.parse(JSON.stringify(j, (k, v) => (['at', 'uptime', 'uptimeMs', 'up', 'ts', 'time', 'now'].includes(k) ? undefined : v)));
  const plain = norm(await get('')), withq = norm(await get('?church=' + A.pub));
  assert.deepEqual(withq, plain);
  assert.equal(JSON.stringify(plain).includes('"church"'), false, 'no per-church block may ride on /status');
  assert.ok(!('refusedPasses' in plain.sync));
  const all = [await ask(S, A.pub, { sk: A.sk }), await ask(S, B.pub, { sk: B.sk }), await ask(S, U.pub, { sk: U.sk })].map(x => x.body).join('');
  for (const secret of [P.base, new URL(P.base).host, P.relayPub, S.relayPub, '127.0.0.1:1']) assert.ok(!all.includes(secret), 'the reply leaked ' + secret);
});

test('5 CLOCK vs TRUST: a refusal whose 401 body names the time window records "time"; a plain 401 records "trust"', async () => {
  const cs = H.key();
  const s = await H.startRelay({ name: 'cS', churches: [cs.pub] });
  const t = await H.startRelay({ name: 'cT', churches: [cs.pub], env: { NODE_OPTIONS: '--require ' + SHIM, STRESS_CLOCK_SKEW_SEC: '360' } });
  const list = H.relaysDoc(cs, [s, t], nowS()); await H.publishAll(s, [list]); await H.publishAll(t, [list]);
  await H.syncNow(s).catch(() => {}); await H.syncNow(t).catch(() => {});
  for (const [who, r, age] of [['healthy asks skewed', s, 0], ['skewed asks healthy', t, -360]]) {
    const c = (await ask(r, cs.pub, { sk: cs.sk, age })).json;   // the skewed box's own clock is 6 min ahead, so the console's proof is dated to match it
    assert.ok(c, who + ': skewed box could not even be asked (its own clock is the proof clock)');
    assert.equal(c.church.state, 'refused', who + ' ' + JSON.stringify(c)); assert.equal(c.church.reason, 'time', who);
  }
});

// ---- the two bookkeeping claims the commit made: the reset rule, and pruning to CHURCH_PUBS ----------------------
test('6 COUNT RULE: unreached neither adds nor resets; refused, unreached, refused is two in a row; a reached pass resets', async () => {
  const R = H.key();
  const s2 = await H.startRelay({ name: 'rS', churches: [R.pub] });
  const p2 = await H.startRelay({ name: 'rP', churches: [R.pub] });
  const dead = { relayPub: 'cd'.repeat(32), base: 'http://127.0.0.1:1' };
  let t = nowS() - 100;
  await H.publishAll(s2, [H.relaysDoc(R, [s2, p2], t++)]); await H.publishAll(p2, [H.relaysDoc(R, [p2], t++)]);   // p2 refuses s2
  const get = async () => (await ask(s2, R.pub, { sk: R.sk })).json.church;
  await H.syncNow(s2).catch(() => {});
  let c = await get(); assert.equal(c.state, 'refused'); assert.equal(c.refusedPasses, 1);
  await H.publishAll(s2, [H.relaysDoc(R, [s2, dead], t++)]);   // the only partner is now unreachable
  await H.syncNow(s2).catch(() => {});
  c = await get(); assert.equal(c.state, 'unreached'); assert.equal(c.refusedPasses, 1, 'an unreached pass learned nothing: it must not reset the count');
  await H.publishAll(s2, [H.relaysDoc(R, [s2, p2], t++)]);     // back to a partner that refuses
  await H.syncNow(s2).catch(() => {});
  c = await get(); assert.equal(c.state, 'refused'); assert.equal(c.refusedPasses, 2, 'refused, unreached, refused is two refusals');
  const row = (await liftSteward({ sk: R.sk, pub: R.pub, relays: () => [s2.wsUrl], fetch }).Steward.relaySyncStates())[0];
  assert.equal(row.state, 'attention', 'two refusals with an unreached pass between still turn the row red');
  await H.publishAll(p2, [H.relaysDoc(R, [s2, p2], t++)]);     // the church re-saves its list: p2 now trusts s2
  await H.syncNow(s2).catch(() => {});
  c = await get(); assert.equal(c.state, 'reached'); assert.equal(c.refusedPasses, 0, 'a reached pass resets the count');
});

test('7 PRUNING: a church removed from CHURCH_PUBS loses its per-church record at the next pass; re-added it starts clean', async () => {
  const Q = H.key(), K = H.key();
  const s3 = await H.startRelay({ name: 'qS', churches: [Q.pub, K.pub] });
  const p3 = await H.startRelay({ name: 'qP', churches: [Q.pub, K.pub] });
  const t = nowS() - 100;
  await H.publishAll(s3, [H.relaysDoc(Q, [s3, p3], t), H.relaysDoc(K, [s3, p3], t)]); await H.publishAll(p3, [H.relaysDoc(Q, [s3, p3], t), H.relaysDoc(K, [s3, p3], t)]);
  await H.syncNow(s3).catch(() => {});
  assert.equal((await ask(s3, Q.pub, { sk: Q.sk })).json.church.state, 'reached', 'premise: Q has a recorded pass');
  const cfg = (body) => fetch(s3.base + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s3.adminToken }, body: JSON.stringify(body) });
  const { npubEncode } = await import('nostr-tools/nip19');
  assert.equal((await cfg({ removeChurch: { npub: npubEncode(Q.pub), confirm: true } })).status, 200);
  assert.equal((await ask(s3, Q.pub, { sk: Q.sk })).status, 401, 'a de-provisioned church gets the identical not-answered reply');
  await H.syncNow(s3).catch(() => {});   // the pass that prunes
  assert.equal((await cfg({ addChurch: { npub: npubEncode(Q.pub) } })).status, 200);
  await H.sleep(800);                    // the re-hydrate that rebuilds its partner list is coalesced
  const q = await ask(s3, Q.pub, { sk: Q.sk });
  assert.equal(q.status, 200);
  assert.equal(q.json.church.state, 'pending', 'the old record survived the removal: ' + JSON.stringify(q.json.church));
  assert.equal(q.json.church.at, 0);
  assert.equal((await ask(s3, K.pub, { sk: K.sk })).json.church.state, 'reached', 'the church that stayed keeps its record');
});
