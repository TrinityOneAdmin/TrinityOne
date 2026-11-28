// END-TO-END: the REAL relay forward reaches the REAL push service's REAL verification — PHASE 2 of the push-service
// redesign. Run: node --test scripts/push-forward-reaches-the-service.test.mjs
//
// WHY THIS EXISTS (CLAUDE.md #1, point of USE). the-push-hook-forwards-to-the-service.test.mjs drives the relay but
// captures the forward at a DUMB mirror that 202s anything; push-service.test.mjs drives the service but feeds it
// envelopes a MIRROR of the relay signed. Neither proves the two HALVES actually fit: a drift in the envelope shape,
// the /wake path, the payload-hash binding or the { token, env } body would pass BOTH and still fail in the field.
//
// This test closes that gap. It spawns the SHIPPED gateway with TRINITY_PUSH_SERVICE_URL pointed at a REAL in-process
// createPushService() (a MOCK APNs HTTP/2 transport, so no Apple is ever dialled), drives a live A->B DM through the
// gateway, and asserts the service ACCEPTS the relay's own signed forward (envelope verified) and the mock APNs
// transport fires EXACTLY ONCE for B's token on the production host. It then drives the REAL service's rejection path
// directly: a tampered body and a wrong-key signature must both be refused (401) with nothing sent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { D } from './trinity-doc-types.mjs';
import { createPushService, contentlessPayload, WAKE_PATH, NIP98_KIND } from './push-service.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const now = () => Math.floor(Date.now() / 1000);
const nowSec = now;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const sha256hex = buf => createHash('sha256').update(buf).digest('hex');
const NET = 'trinityone';

// ── relay drivers (same shape as the other push tests) ───────────────────────────────────────────────────────────
const conn = (port) => new Promise((r, j) => { const s = new WebSocket(`ws://127.0.0.1:${port}/relay`); s.on('open', () => r(s)); s.on('error', j); });
const send = (s, e) => new Promise(res => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { s.off('message', on); res(m); } };
  s.on('message', on); s.send(JSON.stringify(['EVENT', e]));
  setTimeout(() => res(['(no reply)', e.id, null, '']), 5000);
});
async function publishAs(port, who, e) {
  const wsUrl = `ws://127.0.0.1:${port}/relay`;
  const s = await conn(port);
  await new Promise(res => { const on = d => { const m = JSON.parse(d); if (m[0] === 'AUTH') { s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', wsUrl], ['challenge', m[1]]], content: '' }, who.sk)])); res(true); } }; s.on('message', on); setTimeout(() => res(false), 600); });
  s.send(JSON.stringify(['REQ', 'warm', { kinds: [1], limit: 1 }]));
  await sleep(120);
  const out = await send(s, e); s.close(); return out;
}
async function waitReady(port) { const t0 = Date.now(); while (Date.now() - t0 < 25000) { try { if ((await fetch(`http://127.0.0.1:${port}/status`)).ok) return true; } catch {} await sleep(150); } return false; }

const B_TOKEN = 'bb'.repeat(32);   // a realistic 64-hex APNs device token (the service REQUIRES hex 8..200 — 'apns-xx' would 400)
const member = (church, who) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', D.MEMBER + church.pub], ['t', NET]], content: JSON.stringify({ joined: now() }) }, who.sk);
const tokenDoc = (who, tok) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', D.PUSHTOKEN + who.pub], ['t', NET]], content: JSON.stringify({ token: tok, platform: 'ios', env: 'prod', ts: now() }) }, who.sk);
const dm = (from, toPub, ts = now()) => finalizeEvent({ kind: 4, created_at: ts, tags: [['p', toPub], ['t', NET]], content: 'ciphertext' }, from.sk);

// A valid .p8 stand-in so the service's buildJwt actually signs; the transport is mocked so no Apple call happens.
const CFG = (() => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }), keyId: 'ABC1234DEF', teamId: 'TEAM789XYZ', topic: 'com.trinityone.app' };
})();

// MOCK APNs HTTP/2 transport for the REAL service: records each send's authority/path/topic/body; answers 200.
function apnsMock(record) {
  record.connects = 0; record.requests = 0; record.sends = [];
  return (authority) => {
    record.connects++;
    const session = new EventEmitter();
    session.close = () => {}; session.destroy = () => {};
    session.request = (headers) => {
      record.requests++;
      const req = new EventEmitter();
      req.destroy = () => {};
      req.end = (body) => {
        record.sends.push({ authority, path: headers[':path'], topic: headers['apns-topic'], body });
        setImmediate(() => { req.emit('response', { ':status': 200 }); req.emit('data', Buffer.from('')); req.emit('end'); });
      };
      return req;
    };
    return session;
  };
}

// Build a "Nostr <base64(event)>" header for a DIRECT POST to the service (the relay signs its own in-process; these
// drive the service's rejection path). Overridable bits let a case tamper with exactly one thing.
function authHeader({ sk, pub, method = 'POST', path = WAKE_PATH, serviceUrl, rawBody, createdAt = nowSec(), payloadHash } = {}) {
  const ev = finalizeEvent({
    kind: NIP98_KIND, created_at: createdAt,
    tags: [['u', serviceUrl + path], ['method', method], ['payload', payloadHash !== undefined ? payloadHash : sha256hex(rawBody)]],
    content: '',
  }, sk);
  if (pub) ev.pubkey = pub;   // WRONG-KEY: keep the signature from `sk` but claim a different pubkey -> verifyEvent fails
  return 'Nostr ' + Buffer.from(JSON.stringify(ev)).toString('base64');
}

const PORT = 8946;   // gateway (unique across scripts/*.test.mjs AND scripts/*.probe.mjs)
const church = K(), A = K(), B = K();
let relay, dataDir, svc, serviceBase, apnsRec = {};

before(async () => {
  await requireFreePort(PORT, 'push-forward-reaches-the-service.test.mjs (spawns its own gateway)');
  // REAL push service, in-process, on an ephemeral port, with a mock APNs transport.
  svc = createPushService({ cfg: CFG, apnsTransport: apnsMock(apnsRec), log: () => {} });
  const sport = await new Promise(r => svc.server.listen(0, '127.0.0.1', () => r(svc.server.address().port)));
  serviceBase = 'http://127.0.0.1:' + sport;

  dataDir = mkdtempSync(join(tmpdir(), 'trin-pushfwd-e2e-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub), TRINITY_TAILSCALE_BIN: '/nonexistent', TRINITY_PUSH_SERVICE_URL: serviceBase },
  });
  assert.ok(await waitReady(PORT), 'relay did not come up');

  for (const who of [A, B]) assert.equal((await publishAs(PORT, who, member(church, who)))[2], true, 'fixture: a member could not join');
  assert.equal((await publishAs(PORT, B, tokenDoc(B, B_TOKEN)))[2], true, 'fixture: B could not register a token');
  await sleep(300);
});
after(async () => { try { relay && relay.kill('SIGKILL'); } catch {} try { svc && await svc.close(); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('a live DM is forwarded by the relay and ACCEPTED by the real service — one contentless APNs send for the recipient', async () => {
  const before = apnsRec.requests;
  assert.equal((await publishAs(PORT, A, dm(A, B.pub)))[2], true, 'the DM was refused at the frame');
  // the relay forward -> real service verify -> mock APNs send is a chain of fire-and-forget hops; poll for it.
  for (let i = 0; i < 100 && apnsRec.requests <= before; i++) await sleep(20);
  assert.equal(apnsRec.requests, before + 1, 'the real service did not accept the forward and fire exactly one APNs send');
  const s = apnsRec.sends[apnsRec.sends.length - 1];
  assert.equal(s.authority, 'https://api.push.apple.com', 'a prod token must route to the production Apple host');
  assert.equal(s.path, '/3/device/' + B_TOKEN, 'the APNs path must be /3/device/<B token> — the forwarded token survived verification');
  assert.equal(s.topic, 'com.trinityone.app', 'the apns-topic header must be the service-configured topic');
  assert.deepEqual(JSON.parse(s.body), contentlessPayload(), 'the body sent to Apple must be the contentless §15.2 payload');
});

test('the real service REJECTS a tampered body (payload hash no longer binds the bytes) and sends nothing', async () => {
  const before = apnsRec.requests;
  const signedBody = JSON.stringify({ token: B_TOKEN, env: 'production' });
  const sentBody = JSON.stringify({ token: 'cd'.repeat(32), env: 'production' });   // DIFFERENT bytes than were signed
  const res = await fetch(serviceBase + WAKE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authHeader({ sk: B.sk, serviceUrl: serviceBase, rawBody: Buffer.from(signedBody) }) },
    body: sentBody,
  });
  assert.equal(res.status, 401, 'a body whose bytes do not match the signed payload hash must be unauthorized');
  await sleep(50);
  assert.equal(apnsRec.requests, before, 'a tampered-body request reached Apple');
});

test('the real service REJECTS a wrong-key signature (sig does not match the claimed pubkey) and sends nothing', async () => {
  const before = apnsRec.requests;
  const body = JSON.stringify({ token: B_TOKEN, env: 'production' });
  const stray = K();   // sign with A.sk but claim stray.pub as the author -> the signature cannot verify
  const res = await fetch(serviceBase + WAKE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authHeader({ sk: A.sk, pub: stray.pub, serviceUrl: serviceBase, rawBody: Buffer.from(body) }) },
    body,
  });
  assert.equal(res.status, 401, 'an envelope whose signature does not verify against its pubkey must be unauthorized');
  await sleep(50);
  assert.equal(apnsRec.requests, before, 'a forged-signature request reached Apple');
});
