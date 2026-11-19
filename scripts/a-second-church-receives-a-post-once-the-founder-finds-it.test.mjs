// A SECOND CHURCH'S MEMBER RECEIVES A NETWORK POST, WITH NO MANUAL "ADD A CHURCH" STEP (Networks MVP, N5c / Option A) -- END TO END.
//   Run: node --test scripts/a-second-church-receives-a-post-once-the-founder-finds-it.test.mjs   (SOLO -- fixed port 19874)
//
// PORTED 2026-11-18 onto the network wall (feat/networks-port-2026-11-18).
// The REAL gateway (throwaway data dir, spawned after this file is read), the SHIPPED console engine lifted from vendor/steward.js -- including the
// shipped _queryAsKey, run with the real nostr-tools pool against the real relay -- and the SHIPPED member code from vendor/fellowship.js.
// Church A founds network N. Church C JOINS N by publishing its own join declaration; nobody tells A's console about C. A's roster-tick
// (syncNetworkKeys) must discover C from the relay, wrap the ring for it, and C's member must then open A's announcement.
//
// NON-VACUITY: (i) the same flow with discovery switched off (the call to _netReadJoiners cut out of _netSyncAll) leaves C's member with nothing;
//              (ii) a read that FAILS or comes back EMPTY never drops a recipient (the C4 guard), while a positive read that no longer lists a
//                   church (it left) does drop it and rotates the ring.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { K, rnd32, tag, NET, bootConsole, bootMember, tick, hexBytes, fakeRelay, STEWARD, scoped, shippedQueryAsKey } from './net-bundle-rig.mjs';

const PORT = 19874, WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const P = 'trinityone/';
const A = K(), C = K(), N = K(), M = K();           // churches A (founder) and C (joiner); networks N (real) and M (control, discovery off)
const mA = K(), mC = K();
const nkA = rnd32(), nkC = rnd32();
let relay, dataDir, spawnedAt, seq = 0;

const connect = (who) => new Promise((res, rej) => {
  const w = new WebSocket(WS_URL);
  w.on('open', () => { w.on('message', (d) => { const m = JSON.parse(d);
    if (m[0] === 'AUTH' && who) w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)])); }); res(w); });
  w.on('error', rej);
});
const publish = (w, evt) => new Promise((res) => { const on = (d) => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { w.off('message', on); res([m[2], m[3] || '']); } }; w.on('message', on); w.send(JSON.stringify(['EVENT', evt])); setTimeout(() => res([null, 'timeout']), 5000); });
const reqOn = (w, filters) => new Promise((res) => {
  const out = []; const id = 'r' + Math.random().toString(36).slice(2, 7);
  const on = (d) => { const m = JSON.parse(d); if (m[0] === 'EVENT' && m[1] === id) out.push(m[2]); if (m[0] === 'EOSE' && m[1] === id) setTimeout(() => { w.off('message', on); res(out); }, 150); };
  w.on('message', on); w.send(JSON.stringify(['REQ', id, ...filters])); setTimeout(() => { w.off('message', on); res(out); }, 4000);
});
async function asReader(who, filters) { const w = await connect(who); await sleep(200); const got = await reqOn(w, filters); w.close(); return got; }
const doc = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now() + (seq++), tags: [['d', d], ['t', NET], ...extra], content: typeof content === 'string' ? content : JSON.stringify(content) }, who.sk);
const joinDoc = (church, np) => doc(church, P + 'network:' + np, { joined: true, v: 1, scopes: ['announcements', 'events'] }, [['p', np]]);
const leaveDoc = (church, np) => finalizeEvent({ kind: 30078, created_at: now() + (seq++), tags: [['d', P + 'network:' + np], ['t', NET], ['deleted', '1']], content: '' }, church.sk);
const as = async (who, e) => { const w = await connect(who); await sleep(150); const [ok, why] = await publish(w, e); w.close(); assert.equal(ok, true, 'refused: ' + why); };

// the console's view of the real relay: reads authed AS THE CHURCH it runs for, writes by connecting as the event's author
function realRelayFor(church) {
  return {
    lastReason: '',
    put: async (evt) => { const author = [A, C, N, M].find(k => k.pub === evt.pubkey); const w = await connect(author); await sleep(150); const [ok, why] = await publish(w, evt); w.close(); return ok === true ? true : { ok: false, reason: why }; },
    querySync: async (_u, filters) => asReader(church, filters),
    subscribeMany: () => ({ close() {} }),
  };
}
// the SHIPPED _queryAsKey is lifted from the console bundle by the rig (shippedQueryAsKey), and runs on the real nostr-tools pool against the real relay
const consoleFor = (church, o = {}) => bootConsole({ relay: realRelayFor(church), church, relayUrl: WS_URL, queryAsKey: shippedQueryAsKey(), ...o });
async function memberOpens(reader, cp, nameKey, np) {
  const served = fakeRelay();
  for (const e of await asReader(reader, [{ kinds: [30078], authors: [np] }, { kinds: [30078], authors: [cp], '#t': [NET] }])) served.put(e);
  const m = bootMember({ relay: served, cp, nameKeys: [hexBytes(nameKey)] });
  const seen = []; const stop = m.subscribe(np, (r) => seen.push(r)); await tick(); stop();
  return seen[seen.length - 1];
}
async function recipientsOfHop1(np) { const e = (await asReader(N, [{ kinds: [30078], authors: [np], '#d': [P + 'netkey:' + np] }]))[0]; return e; }

let consoleA, consoleC;
before(async () => {
  await requireFreePort(PORT, 'a-second-church-receives-a-post-once-the-founder-finds-it.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-n5c-e2e-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: [A, C].map((c) => npubEncode(c.pub)).join(','), RELAY_MAX_EVENTS: '20000' } });
  spawnedAt = Date.now();
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  for (const [m, c] of [[mA, A], [mC, C]]) await as(null, doc(m, P + 'member:' + c.pub, { joined: now() }, [['p', c.pub]]));
  await sleep(400);
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('FRESHNESS (rule 10): the relay under test was spawned AFTER scripts/gateway.mjs was last written', () => {
  assert.ok(spawnedAt > statSync(new URL('./gateway.mjs', import.meta.url).pathname).mtimeMs, 'a relay older than gateway.mjs would enforce old gates against the new bundle');
});

test('THE SHIPPED _queryAsKey logs in as the NETWORK on its own socket and is served the join declarations (and a church-keyed read of the same filter is not)', async () => {
  await as(A, joinDoc(A, N.pub)); await as(C, joinDoc(C, N.pub));
  const f = [{ kinds: [30078], '#d': [P + 'network:' + N.pub] }];
  const got = await shippedQueryAsKey()([WS_URL], N.sk, f);
  assert.equal(got.complete, true, 'the shipped helper did not report a complete answer from the one relay it asked: ' + JSON.stringify(got));
  assert.deepEqual(got.events.map(e => e.pubkey).sort(), [A.pub, C.pub].sort(), 'the shipped helper did not authenticate as the network (or the relay did not serve it)');
  assert.deepEqual((await asReader(A, f)).map(e => e.pubkey), [A.pub], 'CONTROL: read as church A the same filter returns only A\'s own -- the console\'s ordinary pool could never have learned about C');
});

test('END TO END: the founder auto-discovers church C from the relay, and C\'s member opens the founder\'s announcement', async () => {
  consoleA = consoleFor(A, { networks: [N], nameKey: nkA, founded: [N.pub] });
  const r = await consoleA.api.syncNetworkKeys({ force: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.networks[N.pub].joiners, 2, 'the founder did not count both joined churches: ' + JSON.stringify(r));
  assert.equal(r.networks[N.pub].hop1.ok, true, JSON.stringify(r.networks[N.pub].hop1));
  const post = await consoleA.api.publishNetworkPost(N.pub, 'announcement', { text: 'Regional prayer night on Friday' });
  assert.equal(post.ok, true, JSON.stringify(post));
  consoleC = consoleFor(C, { networks: [], nameKey: nkC });
  const h2 = await consoleC.api.syncNetworkHop2(N.pub);
  assert.equal(h2.ok, true, 'church C could not open the ring -- the founder never wrapped it for C: ' + JSON.stringify(h2));
  const seen = await memberOpens(mC, C.pub, nkC, N.pub);
  assert.equal(seen.state, 'ready', 'the second church\'s member is still waiting: ' + JSON.stringify(seen));
  assert.equal(seen.announcements[0].text, 'Regional prayer night on Friday');
  assert.deepEqual({ ...consoleA.api.networkStatus(N.pub), reason: '' }, { owner: true, joiners: 2, key: 'active', reason: '' }, 'the status the Network panel reads is wrong');
});

test('NON-VACUITY: with discovery cut out of the founder\'s sync, church C is never wrapped and its member is left waiting', async () => {
  await as(A, joinDoc(A, M.pub)); await as(C, joinDoc(C, M.pub));
  const cut = (src) => scoped(src, 'async function _netSyncAll(', 'async function _netPublishPost(', 'const jr = await _netReadJoiners(r.pub);', 'const jr = { ok: false, joiners: [], authoritative: false };');
  const a2 = consoleFor(A, { networks: [M], nameKey: nkA, founded: [M.pub], mutate: cut });
  assert.equal((await a2.api.syncNetworkKeys({ force: true })).ok, true);
  assert.equal((await a2.api.publishNetworkPost(M.pub, 'announcement', { text: 'never reaches C' })).ok, true);
  const h2 = await consoleC.api.syncNetworkHop2(M.pub);
  assert.notEqual(h2.ok, true, 'church C opened a ring it was never wrapped into');
  assert.notEqual((await memberOpens(mC, C.pub, nkC, M.pub)).state, 'ready');
  // and the same flow WITH discovery (unmutated) is what the previous test proved ready -- the difference is only the cut call
});

test('C4 GUARD: a read that FAILS or comes back EMPTY never drops a recipient; a positive read that no longer lists a church does, and rotates the ring', async () => {
  const before_ = await recipientsOfHop1(N.pub);
  // Ported 2026-11-18: the founder now reads its own netkey AS THE NETWORK through the same helper, so the injected failure is aimed at the JOIN
  // read only (the '#d' network: filter) and every other read goes to the shipped helper -- which is the transient this guard is about.
  const real = shippedQueryAsKey();
  const isJoinRead = (f) => f.some(x => (x['#d'] || []).some(d => String(d).startsWith(P + 'network:')));
  for (const [name, qa] of [['an empty answer', async (u, sk, f) => isJoinRead(f) ? { events: [], complete: true } : real(u, sk, f)],
                            ['an incomplete answer', async (u, sk, f) => isJoinRead(f) ? { events: [], complete: false } : real(u, sk, f)],
                            ['a read that throws', async (u, sk, f) => { if (isJoinRead(f)) throw new Error('socket'); return real(u, sk, f); }]]) {
    const a3 = consoleFor(A, { networks: [N], nameKey: nkA, founded: [N.pub], queryAsKey: qa });
    const r = await a3.api.syncNetworkKeys({ force: true });
    assert.equal(r.ok, true, name + ': ' + JSON.stringify(r));
    assert.notEqual(r.networks[N.pub].hop1.rotated, true);
    assert.equal(a3.published.filter(e => tag(e, 'd') === P + 'netkey:' + N.pub).length, 0, name + ' REPUBLISHED the hop-1 envelope -- it changed the recipients on no evidence');
    assert.equal((await consoleC.api.syncNetworkHop2(N.pub, { force: true })).ok, true, name + ': church C lost the ring');
  }
  assert.equal((await recipientsOfHop1(N.pub)).id, before_.id, 'the hop-1 envelope changed under a failed/empty read');
  // C leaves: the relay stops serving its join -> a positive read lists only A -> C is dropped and the ring rotates
  await as(C, leaveDoc(C, N.pub)); await sleep(300);
  const a4 = consoleFor(A, { networks: [N], nameKey: nkA, founded: [N.pub] });
  const r = await a4.api.syncNetworkKeys({ force: true });
  assert.equal(r.networks[N.pub].hop1.rotated, true, 'a church that left was not dropped: ' + JSON.stringify(r.networks[N.pub].hop1));
  const h2 = await consoleC.api.syncNetworkHop2(N.pub, { force: true });
  assert.notEqual(h2.ok, true, 'a church that left can still open the rotated ring');
});
