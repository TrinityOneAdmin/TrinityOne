// A BLOCKED MEMBER SENDS AND RECEIVES NO DIRECT MESSAGES, AND READS NO ROOM (confirmed on a device, 2026-10-14).
//   Run: node --test scripts/a-blocked-member-gets-no-direct-messages.test.mjs
//
// OWNER, 2026-10-02: "Block means NO private access of any kind." Commit 32bcd2b (2026-09-15) removed the AUTH-time
// ban the kind-4 read path relied on and never replaced it for that path, so a blocked member went on being served
// (and could still send) direct messages. canRead()'s kind-4 branch now refuses when EITHER party is blocked by a
// church the OTHER belongs to (dmBlockedBetween, scripts/gateway.mjs), and accept()'s kind-4 gate mirrors it.
//
// THE POINT OF USE is a real relay: scripts/gateway.mjs is spawned in a fresh data dir and spoken to over NIP-01/42
// as a phone does. The DMs are published BEFORE the block, so they are already on disk when it lands — which only
// the READ check can make inert (the write mirror cannot reach a stored event).
// SABOTAGE is by DATA, not code: the blocklist is emptied and the very same stored DMs must then be served — so the
// "not served" assertions are not vacuous (a relay that serves no DMs at all would fail the control).
//
// Users of the shared code (rule 2): canRead has three callers — the live broadcast, the REQ scan and the NIP-42
// AUTH replay — all through the one function. dmBlockedBetween has two: canRead's kind-4 branch and accept()'s.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { D } from './trinity-doc-types.mjs';

const PORT = 8790;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const now = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const key = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = key(), churchB = key();
const A = key(), B = key();            // two adults of church C; B will be blocked
const X = key();                        // a member of an UNRELATED church B
const GID = 'elders-' + Date.now();
let relay = null, dataDir = null, w = null;

const doc = (who, d, content, tags = []) => finalizeEvent({
  kind: 30078, created_at: now(), content: typeof content === 'string' ? content : JSON.stringify(content),
  tags: [['d', d], ['t', 'trinityone'], ...tags],
}, who.sk);
const dm = (from, to, text) => finalizeEvent({ kind: 4, created_at: now(), content: text, tags: [['p', to.pub]] }, from.sk);
const post = (who, text) => finalizeEvent({ kind: 1, created_at: now(), content: text, tags: [['t', 'trinityone'], ['t', GID]] }, who.sk);
const conn = () => new Promise((res, rej) => { const s = new WebSocket(WS_URL, { headers: { Host: `127.0.0.1:${PORT}` } }); s.on('open', () => res(s)); s.on('error', rej); });
const publish = (s, e) => new Promise((res) => {
  const on = (m) => { const a = JSON.parse(m); if (a[0] === 'OK' && a[1] === e.id) { s.off('message', on); res({ ok: a[2], why: a[3] || '' }); } };
  s.on('message', on); s.send(JSON.stringify(['EVENT', e]));
  setTimeout(() => { s.off('message', on); res({ ok: null, why: 'no answer in 8s' }); }, 8000);
});
function req(s, sub, filter, who, ms = 1000) {
  return new Promise((res) => {
    const out = [];
    const on = (d) => {
      const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === sub) out.push(m[2]);
      else if (m[0] === 'AUTH' && who) s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)]));
    };
    s.on('message', on); s.send(JSON.stringify(['REQ', sub, filter]));
    setTimeout(() => { s.off('message', on); res(out); }, ms);
  });
}
const readAs = async (who, filter, ms) => { const s = await conn(); try { return await req(s, 'r' + Math.random().toString(36).slice(2, 6), filter, who, ms); } finally { s.close(); } };
const texts = (evs) => evs.map(e => e.content).sort();
const blocklist = async (pubs) => {
  await sleep(1100);
  const r = await publish(w, doc(church, D.BLOCKED + church.pub, { pubkeys: pubs.map(p => p.pub) }));
  assert.equal(r.ok, true, 'fixture: the blocklist write was refused (' + r.why + ')');
  await sleep(500);
};

before(async () => {
  await requireFreePort(PORT, 'a-blocked-member-gets-no-direct-messages.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-blkdm-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: `${npubEncode(church.pub)},${npubEncode(churchB.pub)}` },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  w = await conn();
  const must = async (p, what) => { const r = await p; assert.equal(r.ok, true, `fixture: ${what} was refused (${r.why}) — nothing below would mean anything`); };
  for (const who of [A, B]) await must(publish(w, doc(who, D.MEMBER + church.pub, { joined: now() })), 'a member joining church C');
  await must(publish(w, doc(X, D.MEMBER + churchB.pub, { joined: now() })), 'a member joining church B');
  await must(publish(w, doc(church, D.JOINPOLICY + church.pub, { approval: false })), 'the join policy');
  await must(publish(w, doc(church, D.GROUP + GID, { id: GID, name: GID, visibility: 'invite', members: [A.pub, B.pub] }, [['church', church.pub]])), 'the invite-only room');
  await sleep(500);
  // everything below is on disk BEFORE any block
  await must(publish(w, dm(A, B, 'A to B')), 'a DM A to B');
  await must(publish(w, dm(B, A, 'B to A')), 'a DM B to A');
  await must(publish(w, dm(B, X, 'B to X')), 'a DM B to a member of an unrelated church');
  await must(publish(w, post(A, 'room post')), 'a post in the room');
  await sleep(500);
});
after(async () => {
  try { w && w.close(); } catch {}
  try { relay && relay.kill('SIGKILL'); } catch {}
  await sleep(200);
  try { dataDir && rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

const dmsFor = (who) => readAs(who, { kinds: [4] });
const roomFor = (who) => readAs(who, { kinds: [1], '#t': [GID] });

test('CONTROL: before any block both parties read their DMs and B reads the room', async () => {
  assert.deepEqual(texts(await dmsFor(B)), ['A to B', 'B to A', 'B to X'], 'B did not read the DMs it is party to — the fixture serves nothing, so the refusals below prove nothing');
  assert.deepEqual(texts(await dmsFor(A)), ['A to B', 'B to A'], 'A did not read its DMs');
  assert.deepEqual(texts(await roomFor(B)), ['room post'], 'B did not read the room before the block');
});

test('a BLOCKED member is served no DM in EITHER direction (stored before the block), and no room post', async () => {
  await blocklist([B]);
  assert.deepEqual(texts(await dmsFor(B)).filter(t => t !== 'B to X'), [], 'A BLOCKED MEMBER IS STILL SERVED THEIR DIRECT MESSAGES WITH CHURCH MEMBERS (A->B and B->A)');
  assert.ok(!texts(await dmsFor(A)).includes('B to A'), 'A MEMBER IS STILL SERVED A DM FROM THE BLOCKED PERSON — a one-direction check leaves them an inbound channel');
  assert.ok(!texts(await dmsFor(A)).includes('A to B'), 'a DM the member sent to the blocked person is still served to the member');
  assert.deepEqual(texts(await roomFor(B)), [], 'A BLOCKED MEMBER IS STILL SERVED A ROOM POST');
});

test('the block is the church’s: a blocked member’s DM with a member of an UNRELATED church is untouched', async () => {
  assert.deepEqual(texts(await dmsFor(X)), ['B to X'], 'blocking B at church C stopped B from messaging a member of an unrelated church');
});

test('write mirror: a blocked member cannot SEND a new DM to a member (and a member cannot DM them)', async () => {
  const s = await conn();
  try {
    const out = await publish(s, dm(B, A, 'new from blocked'));
    assert.notEqual(out.ok, true, 'a blocked member’s DM to a member was accepted at ingest');
    const inn = await publish(s, dm(A, B, 'new to blocked'));
    assert.notEqual(inn.ok, true, 'a member’s DM to a blocked member was accepted at ingest');
  } finally { s.close(); }
});

test('a blocked member may read the church-signed blocklist that names them (so the app can CONFIRM), and nothing else private', async () => {
  const got = await readAs(B, { kinds: [30078], '#d': [D.BLOCKED + church.pub, D.JOINPOLICY + church.pub, D.GROUP + GID] });
  const ds = got.map(e => e.tags.find(t => t[0] === 'd')[1]).sort();
  assert.ok(ds.includes(D.BLOCKED + church.pub), 'the blocked member cannot read the blocklist, so the app can never confirm it is blocked');
  assert.ok(!ds.includes(D.GROUP + GID), 'the blocked member was served the church’s invite-only room document');
});

test('SABOTAGE (by data): emptying the blocklist makes the same stored DMs and room post served again', async () => {
  await blocklist([]);
  assert.deepEqual(texts(await dmsFor(B)), ['A to B', 'B to A', 'B to X'], 'with no block B should read its DMs again — if not, the refusals above were not caused by the block');
  assert.ok(texts(await dmsFor(A)).includes('B to A'), 'A should read B’s DM again once B is unblocked');
  assert.deepEqual(texts(await roomFor(B)), ['room post'], 'B should read the room again once unblocked');
});
