// Relay "mark as safe" gate — the safety-check + response access rules, black-box against a REAL,
// CHURCH-REGISTERED relay on an ISOLATED high port with a throwaway data dir (never a8, never :8000).
//   Run: node --test scripts/relay-safety.test.mjs
//
// Proves the emergency roll-call is safe under the app's threat model:
//   • only the church / a steward / a care-team admin can START a check; a plain member or an outsider cannot.
//   • the check is readable ONLY by authenticated members (like the roster) — never by an anon observer.
//   • any member can post their OWN response, but a response is readable ONLY by its author, the check's
//     creator, and the church/stewards — NOT by another member (who's safe / in danger doesn't leak sideways).
//   (The response CONTENT is additionally NIP-44-encrypted to the creator by the client; the relay never sees it.)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';

const PORT = 8839;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const MEMBER_D = 'trinityone/member:', SAFETY_D = 'trinityone/safetycheck:', SAFE_D = 'trinityone/safe:';
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
const check = (by, msg) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', SAFETY_D + cp]], content: JSON.stringify({ id: 'chk1', message: msg, by: by.pub, at: now(), open: true }) }, by.sk);
const response = (who, toPub, ct) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', SAFE_D + cp], ['p', toPub]], content: ct }, who.sk);

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
const ofKind = (r, d) => r.events.filter(e => (e.tags.find(t => t[0] === 'd') || [])[1] === d);

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'trin-safe-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' }, stdio: 'ignore' });
  await waitReady();
  pub = await connect();
  for (const who of [M, N]) assert.equal((await publish(pub, memberDoc(who)))[0], true, 'member joined');
  await sleep(120);
  // the CHURCH starts a safety check; member M responds (content stands in for the NIP-44 ciphertext to the creator)
  assert.equal((await publish(pub, check(church, 'Are you safe after the raid?')))[0], true, 'church started a check');
  assert.equal((await publish(pub, response(M, church.pub, 'CIPHERTEXT-M-status')))[0], true, 'member M responded');
});
after(() => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('only church/steward/care-admin can START a check — a plain member or an outsider cannot', async () => {
  assert.equal((await publish(pub, check(M, 'fake')))[0], false, 'a plain member cannot start a check');
  assert.equal((await publish(pub, check(rando, 'fake')))[0], false, 'a non-member outsider cannot start a check');
});

test('the check is readable by an authenticated member, but NOT by anon', async () => {
  const ws1 = await connect(); const asMember = await reqCollect(ws1, 'c1', { kinds: [30078], '#d': [SAFETY_D + cp] }, M.sk); ws1.close();
  assert.equal(ofKind(asMember, SAFETY_D + cp).length, 1, 'a member reads the active check');
  const ws2 = await connect(); const asAnon = await reqCollect(ws2, 'c2', { kinds: [30078], '#d': [SAFETY_D + cp] }); ws2.close();
  assert.equal(ofKind(asAnon, SAFETY_D + cp).length, 0, 'anon cannot read that the church declared an emergency');
  assert.equal(asAnon.gotAuth, true, 'relay challenged (check present, withheld)');
});

test('any member can write their OWN response; an outsider cannot', async () => {
  assert.equal((await publish(pub, response(N, church.pub, 'CIPHERTEXT-N')))[0], true, 'member N can respond');
  assert.equal((await publish(pub, response(rando, church.pub, 'x')))[0], false, 'a non-member cannot post a response');
});

test('the CHURCH (check creator) reads members’ responses', async () => {
  const ws = await connect(); const r = await reqCollect(ws, 's1', { kinds: [30078], '#d': [SAFE_D + cp] }, church.sk); ws.close();
  assert.ok(ofKind(r, SAFE_D + cp).some(e => e.pubkey === M.pub), 'the church sees member M’s response for the roll call');
});

test('a member CANNOT read another member’s response (status doesn’t leak sideways)', async () => {
  const ws = await connect(); const r = await reqCollect(ws, 'n1', { kinds: [30078], '#d': [SAFE_D + cp] }, N.sk); ws.close();
  assert.ok(!ofKind(r, SAFE_D + cp).some(e => e.pubkey === M.pub), 'N cannot read M’s safety response');
});

test('a member CAN read their own response back; anon reads nothing', async () => {
  const ws = await connect(); const mine = await reqCollect(ws, 'm1', { kinds: [30078], '#d': [SAFE_D + cp] }, M.sk); ws.close();
  assert.ok(ofKind(mine, SAFE_D + cp).some(e => e.pubkey === M.pub), 'the author reads their own response');
  const ws2 = await connect(); const anon = await reqCollect(ws2, 'a1', { kinds: [30078], '#d': [SAFE_D + cp] }); ws2.close();
  assert.equal(ofKind(anon, SAFE_D + cp).length, 0, 'anon reads no responses at all');
});
