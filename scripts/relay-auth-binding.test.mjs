// NIP-42 auth must be bound to THIS relay, and an EOSE must not lie about withheld data.
// Run: node --test scripts/relay-auth-binding.test.mjs
//
// TWO AUDIT-2026-07-24 FINDINGS.
//
// 1. AUTH REPLAY (HIGH). NIP-42's ['relay', …] tag exists to bind an auth event to one relay; the gateway
//    never read it, and the client signs an auth for any relay in its pool. Invites carry ?relay= / ?relayname=
//    straight from a QR code, so a hostile relay could take the church relay's challenge, present it as its
//    own, and replay the member's signed answer to authenticate AS that member — their DMs, the roster, the
//    care records. The auth must now name the host the connection was actually dialled on.
//
// 2. THE LYING EOSE (root cause of a class of client-side data loss). Private docs are withheld from an
//    unauthenticated connection by simply omitting them, then sending a normal EOSE — so "you may not read
//    this" and "this does not exist" are byte-identical. Clients acted on that emptiness by WRITING: minting a
//    second care key (which permanently destroyed a real care need on 2026-07-24), republishing a one-entry
//    minors list over the real one, re-seeding the finance book. The relay now holds the EOSE until the AUTH
//    round-trip resolves, so an unauthenticated client is never told "that is everything".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';

const PORT = 8858;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const MEMBER_D = 'trinityone/member:', MINORS_D = 'trinityone/minors:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K(), member = K(), child = K();
let relay, dataDir, pub;

async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', 'trinityone']], content: JSON.stringify(content) }, who.sk);
const authEvt = (who, challenge, relayUrl) => finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', relayUrl], ['challenge', challenge]], content: '' }, who.sk);

// REQ for a private d-tag; resolves with { eoseMs, gotAuth, events } — eoseMs is null if no EOSE arrived.
function probe(ws, subId, filter, { authAs = null, relayUrl = WS_URL, window = 1200 } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now(); const events = []; let eoseMs = null; let gotAuth = false; let authOk = null;
    const on = (d) => {
      const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === subId) events.push(m[2]);
      else if (m[0] === 'EOSE' && m[1] === subId && eoseMs === null) eoseMs = Date.now() - t0;
      else if (m[0] === 'AUTH') { gotAuth = true; if (authAs) ws.send(JSON.stringify(['AUTH', authEvt(authAs, m[1], relayUrl)])); }
      else if (m[0] === 'OK' && authOk === null && typeof m[3] === 'string' && m[3].startsWith('auth-')) authOk = false;
      else if (m[0] === 'OK' && authOk === null && m[2] === true) authOk = true;
    };
    ws.on('message', on); ws.send(JSON.stringify(['REQ', subId, filter]));
    setTimeout(() => { ws.off('message', on); try { ws.send(JSON.stringify(['CLOSE', subId])); } catch {} resolve({ eoseMs, gotAuth, events, authOk }); }, window);
  });
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'trin-authbind-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000', CHURCH_NPUB: npubEncode(church.pub) },
    stdio: 'ignore',
  });
  await waitReady();
  pub = await connect();
  assert.equal((await publish(pub, doc(member, MEMBER_D + church.pub, { joined: now() })))[0], true, 'member joined');
  assert.equal((await publish(pub, doc(church, MINORS_D + church.pub, { pubkeys: [child.pub] })))[0], true, 'minors list stored');
  await sleep(150);
});
after(() => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('an auth addressed to ANOTHER relay is refused (the replay attack)', async () => {
  const ws = await connect();
  const r = await probe(ws, 'a1', { kinds: [30078], '#d': [MINORS_D + church.pub] }, { authAs: member, relayUrl: 'wss://evil.example.com/relay' });
  ws.close();
  assert.equal(r.gotAuth, true, 'the relay should still challenge');
  assert.equal(r.authOk, false, 'an auth naming a different relay must be rejected');
  assert.equal(r.events.length, 0, 'and it must not unlock the private minors list');
});

test('an auth with no relay tag at all is refused', async () => {
  const ws = await connect();
  let challenge = null;
  await new Promise(res => { const on = d => { const m = JSON.parse(d); if (m[0] === 'AUTH') { challenge = m[1]; ws.off('message', on); res(); } }; ws.on('message', on); ws.send(JSON.stringify(['REQ', 'a2', { kinds: [30078], '#d': [MINORS_D + church.pub] }])); setTimeout(res, 1500); });
  assert.ok(challenge, 'relay challenged');
  const evt = finalizeEvent({ kind: 22242, created_at: now(), tags: [['challenge', challenge]], content: '' }, member.sk);
  const ok = await new Promise(res => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res(m[2]); } }; ws.on('message', on); ws.send(JSON.stringify(['AUTH', evt])); setTimeout(() => res(null), 1500); });
  ws.close();
  assert.equal(ok, false, 'an auth with no ["relay", …] tag must be rejected');
});

test('a correctly-addressed auth still works (the binding is not a lockout)', async () => {
  const ws = await connect();
  const r = await probe(ws, 'a3', { kinds: [30078], '#d': [MINORS_D + church.pub] }, { authAs: member, relayUrl: WS_URL, window: 1800 });
  ws.close();
  assert.equal(r.authOk, true, 'an auth naming this relay must be accepted');
  assert.equal(r.events.length, 1, 'and the member then receives the private minors list');
});

test('an unauthenticated read of withheld data does NOT get a prompt "that is everything"', async () => {
  // No auth: the relay withholds the minors list. The old code sent an immediate EOSE, which clients read as
  // "this church has no minors list" — and then republished over it.
  const ws = await connect();
  const r = await probe(ws, 'a4', { kinds: [30078], '#d': [MINORS_D + church.pub] }, { authAs: null, window: 1200 });
  ws.close();
  assert.equal(r.events.length, 0, 'the private list is still withheld from an anonymous connection');
  assert.equal(r.gotAuth, true, 'and the relay challenges so a real member can unlock it');
  assert.equal(r.eoseMs, null, 'no EOSE within the grace window — an empty EOSE here is indistinguishable from "none exists"');
});

test('…but a client that never authenticates is not left hanging forever', async () => {
  const ws = await connect();
  const r = await probe(ws, 'a5', { kinds: [30078], '#d': [MINORS_D + church.pub] }, { authAs: null, window: 4000 });
  ws.close();
  assert.notEqual(r.eoseMs, null, 'the EOSE must still arrive once the auth grace expires');
  assert.ok(r.eoseMs >= 2000, `EOSE should be deferred, not immediate (arrived at ${r.eoseMs}ms)`);
});

test('a public read is unaffected — no challenge, no delay', async () => {
  const ws = await connect();
  const r = await probe(ws, 'a6', { kinds: [30078], '#d': ['trinityone/joinpolicy:' + church.pub] }, { authAs: null, window: 900 });
  ws.close();
  assert.notEqual(r.eoseMs, null, 'a read that withholds nothing private must EOSE immediately');
  assert.ok(r.eoseMs < 1500, `public reads must not pay the auth grace (arrived at ${r.eoseMs}ms)`);
});
