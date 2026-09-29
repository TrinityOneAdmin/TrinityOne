// The relay must send Cache-Control: no-store on blob responses so the browser's HTTP cache
// does not keep sermon media for a year (the old value was 'private, max-age=31536000, immutable').
// On a seized device, any cached media is readable without auth; the SW cache gate (a34a5bd) closed
// one half, this header closes the other.
//   Run: node --test scripts/relay-blob-cache-control.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8701;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const MEMBER_D = 'trinityone/member:';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let _t = Math.floor(Date.now() / 1000) - 200; const now = () => ++_t;
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K(), member = K();
const cp = church.pub;
let relay, dataDir, ws;

const connect = () => new Promise((res, rej) => { const s = new WebSocket(WS_URL); s.on('open', () => res(s)); s.on('error', rej); });
const send = (sock, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { sock.off('message', on); res([m[2], m[3] || '']); } }; sock.on('message', on); sock.send(JSON.stringify(['EVENT', evt])); });

const blobAuth = (who, action, sha, tags = []) => 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({
  kind: 24242, created_at: now(), content: action,
  tags: [['t', action], ['x', sha], ['expiration', String(now() + 600)], ...tags],
}, who.sk))).toString('base64');

const memberAuth = (who, method, url) => 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({
  kind: 27235, created_at: Math.floor(Date.now() / 1000), content: '',
  tags: [['u', url], ['method', method]],
}, who.sk))).toString('base64');

const BODY = Buffer.from('a pretend sermon file for the cache-control test');
const BODY_SHA = createHash('sha256').update(BODY).digest('hex');

before(async () => {
  await requireFreePort(PORT, 'relay-blob-cache-control.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-blobcc-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) break; } catch {} await sleep(150); }
  ws = await connect();
  // register member
  assert.equal((await send(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', MEMBER_D + cp]], content: JSON.stringify({ joined: now() }) }, member.sk)))[0], true, 'member joined');
  await sleep(200);
  // upload a blob as the church
  const r = await fetch(`http://127.0.0.1:${PORT}/blob`, {
    method: 'PUT',
    headers: { Authorization: blobAuth(church, 'upload', BODY_SHA), 'Content-Type': 'audio/mpeg' },
    body: BODY,
  });
  assert.equal(r.status, 201, 'blob upload: ' + (await r.text()));
});
after(() => { try { ws && ws.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('GET /blob/<sha> returns Cache-Control: no-store (not the old year-long immutable)', async () => {
  const url = `http://127.0.0.1:${PORT}/blob/${BODY_SHA}`;
  const r = await fetch(url, {
    headers: { Authorization: memberAuth(member, 'GET', url) },
  });
  assert.equal(r.status, 200, 'blob fetch failed: ' + r.status);
  const cc = r.headers.get('cache-control');
  assert.ok(cc && cc.includes('no-store'), 'Cache-Control must include no-store, got: ' + cc);
  assert.ok(!cc.includes('max-age'), 'Cache-Control must NOT include max-age, got: ' + cc);
  assert.ok(!cc.includes('immutable'), 'Cache-Control must NOT include immutable, got: ' + cc);
  await r.arrayBuffer();   // consume body
});

test('GET /blob/<sha>?b64 also returns Cache-Control: no-store (the native/CapacitorHttp path)', async () => {
  const url = `http://127.0.0.1:${PORT}/blob/${BODY_SHA}?b64`;
  const r = await fetch(url, {
    headers: { Authorization: memberAuth(member, 'GET', url) },
  });
  assert.equal(r.status, 200, 'b64 blob fetch failed: ' + r.status);
  const cc = r.headers.get('cache-control');
  assert.ok(cc && cc.includes('no-store'), 'b64 path Cache-Control must include no-store, got: ' + cc);
  await r.arrayBuffer();
});

test('a Range request also returns Cache-Control: no-store', async () => {
  const url = `http://127.0.0.1:${PORT}/blob/${BODY_SHA}`;
  const r = await fetch(url, {
    headers: {
      Authorization: memberAuth(member, 'GET', url),
      Range: 'bytes=0-9',
    },
  });
  assert.equal(r.status, 206, 'range request failed: ' + r.status);
  const cc = r.headers.get('cache-control');
  assert.ok(cc && cc.includes('no-store'), 'Range response Cache-Control must include no-store, got: ' + cc);
  await r.arrayBuffer();
});

test('HEAD /blob/<sha> also returns Cache-Control: no-store', async () => {
  const url = `http://127.0.0.1:${PORT}/blob/${BODY_SHA}`;
  const r = await fetch(url, {
    method: 'HEAD',
    headers: { Authorization: memberAuth(member, 'GET', url) },
  });
  assert.equal(r.status, 200, 'HEAD failed: ' + r.status);
  const cc = r.headers.get('cache-control');
  assert.ok(cc && cc.includes('no-store'), 'HEAD Cache-Control must include no-store, got: ' + cc);
});
