// Relay "ask for help" gate — a member's private care REQUEST + the care-team recipient roster, black-box
// against a REAL church-registered relay on an isolated high port with a throwaway data dir.
//   Run: node --test scripts/relay-carereq.test.mjs
//
// Proves the intake half of the request→approve pathway is safe under the app's threat model:
//   • any member (minors included) can open a carereq: for themselves — but it MUST name a configured church;
//     a non-member outsider cannot, and a church-less request is refused.
//   • a carereq: is readable ONLY by its author + the church (+ stewards/care-admins, same helper as SAFE_D) —
//     NOT by another member, and NOT by an anon observer. A raw "I'm struggling" ask never leaks to the church.
//   • the careteam: recipient roster is church/steward-writable, member-READABLE (so a member can seal to it),
//     and a plain member cannot forge it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';

const PORT = 8856;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const MEMBER_D = 'trinityone/member:', CAREREQ_D = 'trinityone/carereq:', CARETEAM_D = 'trinityone/careteam:', CARESTATUS_D = 'trinityone/carereqstatus:', CARECHAT_D = 'trinityone/carechat:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K(), M = K(), N = K(), rando = K();
const cp = church.pub;
let relay, dataDir, pub;

async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const memberDoc = who => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', MEMBER_D + cp]], content: JSON.stringify({ joined: now() }) }, who.sk);
// a care request names its church in ['church',cp]; content stands in for the ciphertext sealed to the care team
const carereq = (who, id, ct, tagChurch = true) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', CAREREQ_D + id], ['t', 'trinityone'], ...(tagChurch ? [['church', cp]] : [])], content: ct }, who.sk);
const careteam = (by) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', CARETEAM_D + cp]], content: JSON.stringify({ pubs: [church.pub] }) }, by.sk);
// the care team's resolution of req1, p-tagged to requester M so the asker can read it
const status = (by, id, st) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', CARESTATUS_D + id], ['t', 'trinityone'], ['t', 'carereqstatus'], ['church', cp], ['p', M.pub]], content: JSON.stringify({ status: st, needId: '', by: by.pub, at: now() }) }, by.sk);
// a message in req1's shared thread, p-tagged to asker M (content stands in for the sealed payload)
const chat = (by, reqId, mid) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', CARECHAT_D + reqId + ':' + mid], ['t', 'trinityone'], ['t', 'carechat'], ['church', cp], ['p', M.pub]], content: JSON.stringify({ keys: {}, enc: 'x' }) }, by.sk);

function reqCollect(ws, subId, filter, authSk, window = 700) {
  return new Promise((resolve) => {
    const events = []; let gotAuth = false;
    const on = (d) => { const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === subId) events.push(m[2]);
      else if (m[0] === 'AUTH') { gotAuth = true; if (authSk) ws.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, authSk)])); } };
    ws.on('message', on); ws.send(JSON.stringify(['REQ', subId, filter]));
    setTimeout(() => { ws.off('message', on); try { ws.send(JSON.stringify(['CLOSE', subId])); } catch {} resolve({ events, gotAuth }); }, window);
  });
}
const ofD = (r, d) => r.events.filter(e => (e.tags.find(t => t[0] === 'd') || [])[1] === d);

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'trin-carereq-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' }, stdio: 'ignore' });
  await waitReady();
  pub = await connect();
  for (const who of [M, N]) assert.equal((await publish(pub, memberDoc(who)))[0], true, 'member joined');
  await sleep(120);
  // church publishes the care-team roster; member M opens a private request
  assert.equal((await publish(pub, careteam(church)))[0], true, 'church published the care-team roster');
  assert.equal((await publish(pub, carereq(M, 'req1', 'CIPHERTEXT-M-help')))[0], true, 'member M opened a request');
});
after(() => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('any member can open a request; an outsider cannot; a church-less request is refused', async () => {
  assert.equal((await publish(pub, carereq(N, 'req2', 'CIPHERTEXT-N')))[0], true, 'member N can open a request');
  assert.equal((await publish(pub, carereq(rando, 'req3', 'x')))[0], false, 'a non-member outsider cannot');
  assert.equal((await publish(pub, carereq(M, 'req4', 'x', /*tagChurch*/ false)))[0], false, 'a request naming no church is refused');
});

test('only church/steward can write the care-team roster — a plain member cannot forge it', async () => {
  assert.equal((await publish(pub, careteam(M)))[0], false, 'a plain member cannot publish the care-team roster');
});

test('a member CAN read the roster (so it can seal a request to the care team)', async () => {
  const ws = await connect(); const r = await reqCollect(ws, 't1', { kinds: [30078], '#d': [CARETEAM_D + cp] }, M.sk); ws.close();
  assert.equal(ofD(r, CARETEAM_D + cp).length, 1, 'a member reads the care-team roster');
});

test('the author reads their own request back; the church (care team) reads it', async () => {
  const ws1 = await connect(); const mine = await reqCollect(ws1, 'a1', { kinds: [30078], '#d': [CAREREQ_D + 'req1'] }, M.sk); ws1.close();
  assert.ok(ofD(mine, CAREREQ_D + 'req1').some(e => e.pubkey === M.pub), 'the author reads their own request');
  const ws2 = await connect(); const asChurch = await reqCollect(ws2, 'c1', { kinds: [30078], '#d': [CAREREQ_D + 'req1'] }, church.sk); ws2.close();
  assert.ok(ofD(asChurch, CAREREQ_D + 'req1').some(e => e.pubkey === M.pub), 'the church (care team) reads the request');
});

test('another member CANNOT read the request, and anon reads nothing (care-team only)', async () => {
  const ws = await connect(); const asN = await reqCollect(ws, 'n1', { kinds: [30078], '#d': [CAREREQ_D + 'req1'] }, N.sk); ws.close();
  assert.equal(ofD(asN, CAREREQ_D + 'req1').length, 0, 'a different member cannot read the ask-for-help request');
  const ws2 = await connect(); const anon = await reqCollect(ws2, 'x1', { kinds: [30078], '#d': [CAREREQ_D + 'req1'] }); ws2.close();
  assert.equal(ofD(anon, CAREREQ_D + 'req1').length, 0, 'anon reads no requests');
  assert.equal(anon.gotAuth, true, 'relay challenged (request present, withheld)');
});

test('only the care team may resolve a request (carereqstatus) — a plain member cannot', async () => {
  assert.equal((await publish(pub, status(church, 'req1', 'approved')))[0], true, 'the church can resolve a request');
  assert.equal((await publish(pub, status(N, 'req1', 'declined')))[0], false, 'a plain member cannot write a resolution');
});

test('the requester reads their resolution (p-tagged); another member cannot', async () => {
  const ws = await connect(); const asM = await reqCollect(ws, 's1', { kinds: [30078], '#d': [CARESTATUS_D + 'req1'] }, M.sk); ws.close();
  assert.equal(ofD(asM, CARESTATUS_D + 'req1').length, 1, 'the asker sees their request was resolved');
  const ws2 = await connect(); const asN = await reqCollect(ws2, 's2', { kinds: [30078], '#d': [CARESTATUS_D + 'req1'] }, N.sk); ws2.close();
  assert.equal(ofD(asN, CARESTATUS_D + 'req1').length, 0, 'an unrelated member cannot read the resolution');
});

test('shared thread: the asker can post + read; the care team reads; an unrelated member cannot', async () => {
  const dM = CARECHAT_D + 'req1:m1';
  assert.equal((await publish(pub, chat(M, 'req1', 'm1')))[0], true, 'the asker (a member) can post to the thread');
  assert.equal((await publish(pub, chat(rando, 'req1', 'm2')))[0], false, 'a non-member outsider cannot post');
  const ws1 = await connect(); const asChurch = await reqCollect(ws1, 'h1', { kinds: [30078], '#d': [dM] }, church.sk); ws1.close();
  assert.equal(ofD(asChurch, dM).length, 1, 'the care team reads the thread');
  const ws2 = await connect(); const asM = await reqCollect(ws2, 'h2', { kinds: [30078], '#d': [dM] }, M.sk); ws2.close();
  assert.equal(ofD(asM, dM).length, 1, 'the asker reads the thread');
  const ws3 = await connect(); const asN = await reqCollect(ws3, 'h3', { kinds: [30078], '#d': [dM] }, N.sk); ws3.close();
  assert.equal(ofD(asN, dM).length, 0, 'an unrelated member cannot read the thread');
});

test('SAFEGUARDING: a non-cleared adult cannot join a MINOR asker’s thread; the child + their church can', async () => {
  // mark the asker M as a minor of this church (owner-signed minors list)
  const minors = finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/minors:' + cp]], content: JSON.stringify({ pubkeys: [M.pub] }) }, church.sk);
  assert.equal((await publish(pub, minors))[0], true, 'minors list stored');
  await sleep(150);
  // an uncleared adult member may NOT post into the child's thread (routing-around the kind-4 gate is blocked)
  assert.equal((await publish(pub, chat(N, 'req1', 'sgN')))[0], false, 'a non-cleared adult cannot message a child');
  // the child themselves may post, and the child's OWN church may reach them
  assert.equal((await publish(pub, chat(M, 'req1', 'sgSelf')))[0], true, 'the child may post to their own thread');
  assert.equal((await publish(pub, chat(church, 'req1', 'sgCh')))[0], true, 'the child’s own church may reach them');
  // and an uncleared adult cannot READ the child's thread
  const ws = await connect(); const asN = await reqCollect(ws, 'sg1', { kinds: [30078], '#d': [CARECHAT_D + 'req1:sgCh'] }, N.sk); ws.close();
  assert.equal(ofD(asN, CARECHAT_D + 'req1:sgCh').length, 0, 'a non-cleared adult cannot read a child’s thread');
});
