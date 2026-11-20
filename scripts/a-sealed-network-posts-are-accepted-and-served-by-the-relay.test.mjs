// THE DOCUMENTS THE SHIPPED CONSOLE WRITES ARE ACCEPTED BY THE REAL RELAY, AND ARE SERVED ONLY WHERE THE GATES SAY (Networks MVP, N5b).
//   Run: node --test scripts/a-sealed-network-posts-are-accepted-and-served-by-the-relay.test.mjs   (SOLO -- fixed port 19872)
//
// WHY THIS EXISTS BESIDE THE ENGINE TEST. a-network-announcement-is-sealed-two-hops.test.mjs runs the shipped console and member code against a
// relay STAND-IN that enforces no read rule. This one puts the REAL gateway (scripts/gateway.mjs, throwaway data dir, spawned AFTER this file
// is read) in the middle: the documents the SHIPPED CONSOLE publishes (hop-1, hop-2, an announcement, an event) must pass the relay's write gates
// (sealed {v,e} shape, d/t tags only, church-key hop-2), and what each kind of reader is then SERVED decides what the SHIPPED MEMBER CODE can open.
// Whatever the real relay does not serve, the member never sees -- so every refusal below sits beside a control that IS served.
//
// PORTED 2026-11-18 onto the network wall (feat/networks-port-2026-11-18).
//
// N5a's own gates are not under test here (scripts/a-network-announcement-reaches-only-the-churches-that-joined-it.test.mjs is); this proves the
// N5b client writes satisfy them and the end-to-end read works. NOT a device test.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { K, rnd32, tag, NET, fakeRelay, bootConsole, bootMember, tick, hexBytes } from './net-bundle-rig.mjs';

const PORT = 19872, WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const P = 'trinityone/';
const A = K(), B = K(), C = K(), D = K(), N = K();           // churches A (announcements+events), B (never joined), C (events only), D (joined, NO scopes); network N
const mA = K(), mB = K(), mC = K(), mD = K(), kidA = K(), stranger = K();
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
const join_ = (church, scopes) => doc(church, P + 'network:' + N.pub, scopes === undefined ? { joined: true, v: 1 } : { joined: true, v: 1, scopes }, [['p', N.pub]]);

// the console's view of the real relay: reads authed AS THE CHURCH it runs for, writes by connecting as the event's author
function realRelayFor(church) {
  return {
    lastReason: '',
    put: async (evt) => { const author = [A, B, C, D, N].find(k => k.pub === evt.pubkey); const w = await connect(author); await sleep(150); const [ok, why] = await publish(w, evt); w.close(); if (ok !== true) { this.lastReason = why; } return ok === true; },
    querySync: async (_u, filters) => asReader(church, filters),
    subscribeMany: () => ({ close() {} }),
  };
}
// what the REAL relay serves a given reader, loaded into a stand-in the SHIPPED member code then reads
async function whatServes(reader, cp) {
  const served = fakeRelay();
  for (const e of await asReader(reader, [{ kinds: [30078], authors: [N.pub], '#t': [NET] }, { kinds: [30078], authors: [cp], '#t': [NET] }])) served.put(e);
  return served;
}
async function memberSees(reader, cp, nameKey) {
  const served = await whatServes(reader, cp);
  const m = bootMember({ relay: served, cp, nameKeys: [hexBytes(nameKey)] });
  const seen = []; const stop = m.subscribe(N.pub, (r) => seen.push(r)); await tick(); stop();
  return { seen: seen[seen.length - 1], docs: served.all().map(e => tag(e, 'd')) };
}

before(async () => {
  await requireFreePort(PORT, 'a-sealed-network-posts-are-accepted-and-served-by-the-relay.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-n5b-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: [A, B, C, D].map((c) => npubEncode(c.pub)).join(','), RELAY_MAX_EVENTS: '20000' } });
  spawnedAt = Date.now();
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  const ok = async (who, e, why) => { const w = await connect(who); await sleep(150); const [k, m] = await publish(w, e); w.close(); assert.equal(k, true, why + ' (' + m + ')'); };
  await ok(A, join_(A, ['announcements', 'events']), 'A join'); await ok(C, join_(C, ['events']), 'C join'); await ok(D, join_(D), 'D join');
  for (const [m, c] of [[mA, A], [mB, B], [mC, C], [mD, D], [kidA, A]]) await ok(null, doc(m, P + 'member:' + c.pub, { joined: now() }, [['p', c.pub]]), 'member join');
  await ok(A, doc(A, P + 'minors:' + A.pub, { pubkeys: [kidA.pub] }), 'minors list');
  await sleep(500);
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('FRESHNESS (rule 10): the relay under test was spawned AFTER scripts/gateway.mjs was last written', () => {
  assert.ok(spawnedAt > statSync(new URL('./gateway.mjs', import.meta.url).pathname).mtimeMs, 'a relay older than gateway.mjs would enforce old gates against the new bundle');
});

let consoleA, consoleC;
test('THE SHIPPED CONSOLE\'S DOCUMENTS PASS THE REAL RELAY: hop-1 (network key), hop-2 (church key), an announcement and an event are all accepted', async () => {
  const rA = realRelayFor(A);
  consoleA = bootConsole({ relay: rA, church: A, networks: [N], nameKey: nkA, founded: [N.pub] });
  const k1 = await consoleA.api.syncNetworkKey(N.pub, { add: [C.pub] });
  assert.equal(k1.ok, true, 'hop-1 refused by the real relay: ' + JSON.stringify(k1) + ' ' + rA.lastReason);
  assert.equal((await consoleA.api.syncNetworkHop2(N.pub)).ok, true, 'hop-2 refused by the real relay');
  const post = await consoleA.api.publishNetworkPost(N.pub, 'announcement', { text: 'Youth night is moved to Friday' });
  assert.equal(post.ok, true, 'the announcement was refused by the real relay: ' + JSON.stringify(post) + ' ' + rA.lastReason);
  const ev = await consoleA.api.publishNetworkPost(N.pub, 'event', { title: 'Regional prayer night', date: '2026-11-14', time: '19:30', where: 'Hall' });
  assert.equal(ev.ok, true, 'the event was refused by the real relay: ' + JSON.stringify(ev) + ' ' + rA.lastReason);
  consoleC = bootConsole({ relay: realRelayFor(C), church: C, networks: [], nameKey: nkC });
  assert.equal((await consoleC.api.syncNetworkHop2(N.pub)).ok, true, 'a second joined church could not re-seal through the real relay');
});

test('END TO END: a member of the joined church is served the sealed documents and the SHIPPED member code reads them', async () => {
  const got = await memberSees(mA, A.pub, nkA);
  assert.ok(got.docs.some(d => d.startsWith(P + 'netann:')) && got.docs.some(d => d.startsWith(P + 'netevent:')) && got.docs.includes(P + 'netkeyc:' + N.pub), 'the relay did not serve the member the network documents: ' + got.docs);
  assert.equal(got.seen.state, 'ready'); assert.equal(got.seen.announcements[0].text, 'Youth night is moved to Friday'); assert.equal(got.seen.events[0].title, 'Regional prayer night');
});

test('NOT SERVED -> NOT READ: a member of a church that never joined, a church that joined with NO scopes, a marked child, and a stranger read nothing', async () => {
  for (const [who, cp, nk, name] of [[mB, B.pub, rnd32(), 'a member of a church that never joined'], [mD, D.pub, rnd32(), 'a member of a church that joined with no scopes'], [kidA, A.pub, nkA, 'a child the church has marked'], [stranger, A.pub, nkA, 'a stranger']]) {
    const got = await memberSees(who, cp, nk);
    assert.ok(!got.docs.some(d => d.startsWith(P + 'netann:') || d.startsWith(P + 'netevent:')), `${name} was SERVED network content: ${got.docs}`);
    assert.equal((got.seen.announcements || []).length + (got.seen.events || []).length, 0, `${name} read network content`);
    // (a marked child DOES hold the church name key, so it is served the church's hop-2 and holds the ring -- the same boundary as the church
    //  feed: what keeps it out is that the relay serves it NO ciphertext, which is asserted above. Everyone else is not even given the ring.)
    if (who !== kidA) assert.notEqual(got.seen.state, 'ready', `${name} is shown a ready network`);
  }
  assert.ok((await memberSees(mA, A.pub, nkA)).docs.some(d => d.startsWith(P + 'netann:')), 'CONTROL: the joined member must be served -- the refusals above prove nothing');
});

test('SCOPES: a church that joined for events only is served the EVENT and not the announcement, and its member reads exactly that', async () => {
  const got = await memberSees(mC, C.pub, nkC);
  assert.ok(got.docs.some(d => d.startsWith(P + 'netevent:')), 'CONTROL: the events-only church was not served the event');
  assert.ok(!got.docs.some(d => d.startsWith(P + 'netann:')), 'an events-only church was served an announcement');
  assert.equal(got.seen.state, 'ready'); assert.equal(got.seen.announcements.length, 0); assert.equal(got.seen.events.length, 1);
});

test('BASE64-WRAPPED PLAINTEXT IS REFUSED for a network announcement and event (the sealed field must be a real NIP-44 v2 envelope); the genuine ones above were accepted', async () => {
  const wraps = [Buffer.from('meet at 3pm').toString('base64'), Buffer.from('meet at 3pm, '.repeat(20)).toString('base64')];
  for (const [i, e] of wraps.entries()) for (const pfx of ['netann:', 'netevent:']) {
    const w = await connect(N); await sleep(150);
    const [ok] = await publish(w, doc(N, P + pfx + 'wrap' + i, { v: 1, e })); w.close();
    assert.notEqual(ok, true, pfx + ' with base64-wrapped plaintext #' + i + ' was ACCEPTED');
  }
  const w = await connect(N); await sleep(150);
  const [tomb] = await publish(w, doc(N, P + 'netann:wrap0', '', [['deleted', '1']])); w.close();
  assert.equal(tomb, true, 'a tombstone is still allowed');
});

// PORTED 2026-11-18: the console's cleartext publishNetworkAnnouncement is still on the API in this phase (the composer that calls it is rewired in
// Phase B2), so the "no longer a method" half of the October assertion is dropped rather than left passing against a slice that never contained it.
test('LEGACY CLEARTEXT IS REFUSED: the relay refuses the retired net-announce kind-1 from the network key', async () => {
  const w = await connect(N); await sleep(150);
  const [ok] = await publish(w, finalizeEvent({ kind: 1, created_at: now() + (seq++), tags: [['t', NET], ['t', 'net-announce'], ['p', N.pub]], content: 'plain' }, N.sk)); w.close();
  assert.notEqual(ok, true, 'the relay accepted a cleartext network announcement');
});

test('N5c / OPTION A (was the pinned KNOWN GAP): the real relay serves each JOINED church\'s join document to the network key, so the founder console can LEARN who joined', async () => {
  // The relay used to serve a church-authored network: document to the church and nobody else (the pin that stood here). N5c changed that on
  // purpose, for the network key ONLY; the console reads it with _netReadJoiners (src/steward.src.js) and hands it to _netSyncKey's opts.joiners.
  // The full matrix (other network, stranger, member, N1 anchor, tombstone) is scripts/a-network-learns-which-churches-joined-it.test.mjs.
  const control = await asReader(A, [{ kinds: [30078], authors: [A.pub], '#d': [P + 'network:' + N.pub] }]);
  assert.equal(control.length, 1, 'CONTROL: the church itself must be able to read its own join document');
  for (const f of [{ kinds: [30078], '#d': [P + 'network:' + N.pub] }, { kinds: [30078], '#p': [N.pub], '#t': [NET] }]) {
    const got = await asReader(N, [f]);
    assert.deepEqual(got.map(e => e.pubkey).sort(), [A.pub, C.pub, D.pub].sort(), 'the network key must be served exactly the join documents of the churches that joined (A, C, D) -- never B, which did not');
  }
});
