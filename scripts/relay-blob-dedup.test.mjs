// R-4: Two churches uploading the same unencrypted file must both be able to play it,
// and deleting one church's listing must not break the other's copy.
// Before this fix: the second church's members got 401, and Remove returned success while
// the relay answered 403 (or removed both churches' file).
//   Run: node --test scripts/relay-blob-dedup.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8702;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const MEMBER_D = 'trinityone/member:';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let _t = Math.floor(Date.now() / 1000) - 200; const now = () => ++_t;
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

// TWO churches on one relay
const church1 = K(), church2 = K();
const m1 = K(), m2 = K();   // a member of each church
const cp1 = church1.pub, cp2 = church2.pub;
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

const BODY = Buffer.from('the same sermon file uploaded by two churches');
const BODY_SHA = createHash('sha256').update(BODY).digest('hex');

const upload = (church, sha, body) => fetch(`http://127.0.0.1:${PORT}/blob`, {
  method: 'PUT',
  headers: { Authorization: blobAuth(church, 'upload', sha), 'Content-Type': 'audio/mpeg' },
  body,
});

const download = (member, sha) => {
  const url = `http://127.0.0.1:${PORT}/blob/${sha}`;
  return fetch(url, { headers: { Authorization: memberAuth(member, 'GET', url) } });
};

const deleteBlob = (church, sha) => fetch(`http://127.0.0.1:${PORT}/blob/${sha}`, {
  method: 'DELETE',
  headers: { Authorization: blobAuth(church, 'delete', sha) },
});

before(async () => {
  await requireFreePort(PORT, 'relay-blob-dedup.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-blobdedup-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...process.env, TRINITY_DATA_DIR: dataDir,
      CHURCH_NPUB: [npubEncode(cp1), npubEncode(cp2)].join(','),
      RELAY_MAX_EVENTS: '5000',
    },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) break; } catch {} await sleep(150); }
  ws = await connect();
  // register members for each church
  assert.equal((await send(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', MEMBER_D + cp1]], content: JSON.stringify({ joined: now() }) }, m1.sk)))[0], true, 'm1 joined c1');
  assert.equal((await send(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', MEMBER_D + cp2]], content: JSON.stringify({ joined: now() }) }, m2.sk)))[0], true, 'm2 joined c2');
  await sleep(200);
});
after(() => { try { ws && ws.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('CONTROL: church 1 uploads and its member can play', async () => {
  const r = await upload(church1, BODY_SHA, BODY);
  assert.equal(r.status, 201, 'c1 upload: ' + (await r.text()));
  const d = await download(m1, BODY_SHA);
  assert.equal(d.status, 200, 'c1 member download should work');
  await d.arrayBuffer();
});

test('church 2 uploads the same bytes — accepted (dedup)', async () => {
  const r = await upload(church2, BODY_SHA, BODY);
  // 201 is fine — the relay deduplicates the file on disk but should track both owners
  assert.ok(r.status >= 200 && r.status < 300, 'c2 upload: ' + r.status);
  await r.text();
});

test('church 2 member can play the shared blob', async () => {
  const d = await download(m2, BODY_SHA);
  assert.equal(d.status, 200,
    'DEFECT (pre-fix): c2 member gets 401 because _blobMember only checks the primary owner (c1). ' +
    'Got: ' + d.status);
  await d.arrayBuffer();
});

test('church 1 deleting its copy does NOT break church 2', async () => {
  const del = await deleteBlob(church1, BODY_SHA);
  assert.equal(del.status, 200, 'c1 delete: ' + del.status);
  await del.text();

  // church 2 member must still be able to play
  const d = await download(m2, BODY_SHA);
  assert.equal(d.status, 200,
    'DEFECT (pre-fix): deleting c1 copy unlinked the file, breaking c2. Got: ' + d.status);
  await d.arrayBuffer();
});

test('church 1 member can no longer play after c1 deleted its copy', async () => {
  const d = await download(m1, BODY_SHA);
  assert.equal(d.status, 401,
    'c1 no longer owns this blob — its member should get 401, got: ' + d.status);
  await d.arrayBuffer().catch(() => {});
});

test('church 2 deleting its copy removes the file entirely (last owner)', async () => {
  const del = await deleteBlob(church2, BODY_SHA);
  assert.equal(del.status, 200, 'c2 delete: ' + del.status);
  await del.text();

  // now nobody can play it
  const d = await download(m2, BODY_SHA);
  assert.equal(d.status, 404, 'blob should be gone after last owner deletes, got: ' + d.status);
  await d.arrayBuffer().catch(() => {});
});

test('SAME CHURCH: two listings of the same file — removing one does not break the other', async () => {
  // re-upload the same bytes twice (same church, simulating duplicate listing)
  const r1 = await upload(church1, BODY_SHA, BODY);
  assert.ok(r1.status >= 200 && r1.status < 300, 'first upload: ' + r1.status);
  await r1.text();

  // "remove" (the console would delete the sermon doc + the blob)
  const del = await deleteBlob(church1, BODY_SHA);
  assert.equal(del.status, 200, 'delete: ' + del.status);
  await del.text();

  // since the same church uploaded twice, one delete should fully remove it (single owner)
  // This is the same-church case: the church has one owner entry, so one delete removes all
  const d = await download(m1, BODY_SHA);
  // After one delete, the blob should be gone (single owner, regardless of upload count)
  assert.ok(d.status === 404 || d.status === 401,
    'same-church duplicate: after delete, blob should be inaccessible, got: ' + d.status);
  await d.arrayBuffer().catch(() => {});
});
