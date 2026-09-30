// A SERMON FILE TWO CHURCHES BOTH OWN SURVIVES ONE OF THEM LEAVING IT — by every route, not just the button.
//   Run: node --test scripts/relay-co-owned-media-survives.test.mjs
//
// Audit 2026-09-30, findings 2, 3, 8 and 9. R-4 made DELETE /blob reference-counted: when two churches upload
// the same file, one church's delete removes only that church from the owner set. Three other paths were not
// changed and each lost or mis-counted the co-owner's media:
//   2. the partner-sync delete pass (syncMediaFromPeer) unlinked the file if the PRIMARY owner had deleted it
//      on a partner relay — the co-owner's members went 200 -> 404, and a tombstone blocked any re-pull;
//   3. the church purge unlinked the file AND its owner record for every blob in the purged church's list;
//   8. a dedup-then-delete subtracted bytes that were never added, zeroing the church's usage under its cap;
//   9. a dedup upload was never indexed, so the co-owner's file was missing from /export-media (the steward's
//      "complete archive") and /sync-media (so it was never replicated to a partner relay).
//
// All four now go through one helper, _releaseBlob, and every owner is billed + indexed (_billBlob). These
// tests drive real gateways over HTTP and check with a member's own playback request — the thing that broke.
//
// Users of the changed shared code (rule 2), all in scripts/gateway.mjs:
//   _releaseBlob:  DELETE /blob, syncMediaFromPeer's deleted pass, the removeChurch purge.
//   _billBlob:     PUT /blob (new + dedup), syncMediaFromPeer's pull.
//   _unbillBlob:   _releaseBlob only.
//   _blobsByChurch / _churchBlobList readers: /export-media, /sync-media, /config?stats=1, removeChurch dry run.
//   _mediaBytesByChurch readers: the per-church cap checks in PUT /blob and syncMediaFromPeer.
//   The boot scan now indexes every owner in .owners, not only the .church primary.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const PA = 8731, PB = 8732, PC = 8733;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const CAP = 300;                          // per-church media cap on relay C
const MEMBER_D = 'trinityone/member:', RELAYS_D = 'trinityone/relays', NET = 'trinityone';
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const c1 = K(), c2 = K(), m2 = K();       // two churches; m2 is a member of church 2
const relays = [];                         // { proc, dir, port }

function spawnRelay(port, churches, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'trin-coowned-'));
  const proc = spawn(process.execPath, ['scripts/gateway.mjs', String(port)], {
    cwd: ROOT,
    env: { ...process.env, TRINITY_DATA_DIR: dir, CHURCH_NPUB: churches.map(c => npubEncode(c.pub)).join(','), RELAY_SYNC: '0', RELAY_MAX_EVENTS: '5000', ...extra },
    stdio: 'ignore',
  });
  const r = { proc, dir, port }; relays.push(r); return r;
}
async function ready(port) {
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) { try { const r = await fetch(`http://127.0.0.1:${port}/status`); if (r.ok) return; } catch {} await sleep(150); }
  throw new Error('relay on ' + port + ' did not start');
}
async function restart(r, churches, extra) {
  r.proc.kill('SIGKILL'); await new Promise(res => r.proc.once('exit', res));
  r.proc = spawn(process.execPath, ['scripts/gateway.mjs', String(r.port)], {
    cwd: ROOT, env: { ...process.env, TRINITY_DATA_DIR: r.dir, CHURCH_NPUB: churches.map(c => npubEncode(c.pub)).join(','), RELAY_SYNC: '0', RELAY_MAX_EVENTS: '5000', ...extra }, stdio: 'ignore',
  });
  await ready(r.port); await sleep(300);   // the boot scan runs on a 0ms timer after listen
}

const connect = port => new Promise((res, rej) => { const s = new WebSocket(`ws://127.0.0.1:${port}/relay`); s.on('open', () => res(s)); s.on('error', rej); });
const send = (ws, evt) => new Promise(res => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res(m[2]); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const blobAuth = (who, action, sha) => 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({
  kind: 24242, created_at: now(), content: action, tags: [['t', action], ['x', sha], ['expiration', String(now() + 600)]],
}, who.sk))).toString('base64');
const nip98 = (who, method, url) => 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({
  kind: 27235, created_at: now(), content: '', tags: [['u', url], ['method', method]],
}, who.sk))).toString('base64');
const shaOf = b => createHash('sha256').update(b).digest('hex');
const file = n => Buffer.concat([Buffer.from('sermon '), randomBytes(n - 7)]);

async function up(port, church, body) { const sha = shaOf(body); const r = await fetch(`http://127.0.0.1:${port}/blob`, { method: 'PUT', headers: { Authorization: blobAuth(church, 'upload', sha), 'Content-Type': 'audio/mpeg' }, body }); await r.text(); return r.status; }
async function del(port, church, sha) { const r = await fetch(`http://127.0.0.1:${port}/blob/${sha}`, { method: 'DELETE', headers: { Authorization: blobAuth(church, 'delete', sha) } }); await r.text(); return r.status; }
async function play(port, member, sha) { const url = `http://127.0.0.1:${port}/blob/${sha}`; const r = await fetch(url, { headers: { Authorization: nip98(member, 'GET', url) } }); await r.arrayBuffer().catch(() => {}); return r.status; }
async function exportMedia(port, church) { const url = `http://127.0.0.1:${port}/export-media`; const r = await fetch(url, { headers: { Authorization: nip98(church, 'GET', url) } }); assert.equal(r.status, 200, 'export-media'); return r.json(); }
const admin = r => JSON.parse(readFileSync(join(r.dir, 'admin.json'), 'utf8')).token;
const relayPub = r => JSON.parse(readFileSync(join(r.dir, 'relay-key.json'), 'utf8')).pub;
async function config(r, body) { const res = await fetch(`http://127.0.0.1:${r.port}/config`, { method: 'POST', headers: { Authorization: 'Bearer ' + admin(r), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return [res.status, await res.json()]; }

let A, B, C;
before(async () => {
  for (const p of [PA, PB, PC]) await requireFreePort(p, 'relay-co-owned-media-survives.test.mjs');
  A = spawnRelay(PA, [c1, c2]);                                  // hosts both churches
  B = spawnRelay(PB, [c1]);                                      // a partner relay of church 1 only
  C = spawnRelay(PC, [c1, c2], { RELAY_CHURCH_MEDIA_CAP: String(CAP) });
  await Promise.all([ready(PA), ready(PB), ready(PC)]);
  for (const port of [PA, PC]) {                                 // m2 is a member of church 2
    const ws = await connect(port);
    assert.equal(await send(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', MEMBER_D + c2.pub]], content: JSON.stringify({ joined: now() }) }, m2.sk)), true, 'm2 joins c2');
    ws.close();
  }
  // church 1 names A and B as its trusted relays, on both, so A will sync church 1 from B
  const list = [{ pubkey: relayPub(A), url: `ws://127.0.0.1:${PA}` }, { pubkey: relayPub(B), url: `ws://127.0.0.1:${PB}` }];
  for (const port of [PA, PB]) {
    const ws = await connect(port);
    assert.equal(await send(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', RELAYS_D], ['t', NET]], content: JSON.stringify(list) }, c1.sk)), true, 'trusted-relays doc');
    ws.close();
  }
  await sleep(400);
});
after(async () => { for (const r of relays) { try { r.proc.kill('SIGKILL'); } catch {} } await sleep(200); for (const r of relays) { try { rmSync(r.dir, { recursive: true, force: true }); } catch {} } });

test('a co-owner lists the shared file in its archive, and still does after a restart (finding 9)', async () => {
  const X = file(120), sx = shaOf(X);
  assert.equal(await up(PA, c1, X), 201);
  assert.equal(await up(PA, c2, X), 201, 'dedup upload');
  const e = await exportMedia(PA, c2);
  assert.deepEqual(e.blobs.map(b => b.sha), [sx], "church 2's archive is missing the file it owns");
  assert.equal(e.totalBytes, X.length);
  await restart(A, [c1, c2]);
  const e2 = await exportMedia(PA, c2);
  assert.deepEqual(e2.blobs.map(b => b.sha), [sx], "after a restart church 2's archive is missing the file it owns");
  assert.equal(await del(PA, c1, sx), 200); assert.equal(await del(PA, c2, sx), 200);   // leave A clean
});

test("a partner relay's delete for church 1 leaves church 2's copy playable (finding 2)", async () => {
  const X = file(150), sx = shaOf(X);
  assert.equal(await up(PB, c1, X), 201); assert.equal(await del(PB, c1, sx), 200);   // church 1 deleted it on B
  assert.ok(existsSync(join(B.dir, 'blobs', sx + '.deleted')), 'CONTROL: B tombstoned church 1\'s delete');
  assert.equal(await up(PA, c1, X), 201); assert.equal(await up(PA, c2, X), 201);     // both own it on A
  assert.equal(await play(PA, m2, sx), 200, 'CONTROL: church 2 member plays it before the sync');
  const r = await fetch(`http://127.0.0.1:${PA}/sync-now`, { method: 'POST', headers: { Authorization: 'Bearer ' + admin(A) } });
  assert.equal(r.status, 200, 'sync-now'); await r.text();
  // the sync pass is paced — wait until A has acted on B's deleted list (church 1 released) or give up
  const owners = () => { try { return JSON.parse(readFileSync(join(A.dir, 'blobs', sx + '.owners'), 'utf8')); } catch { return null; } };
  const acted = () => !existsSync(join(A.dir, 'blobs', sx)) || (owners() || []).length < 2;
  for (let i = 0; i < 60 && !acted(); i++) await sleep(100);
  assert.ok(acted(), 'A never acted on B\'s deleted list — this test is not reaching the delete pass');
  assert.equal(await play(PA, m2, sx), 200, "church 2's member lost the sermon because church 1 deleted it on another relay");
  assert.deepEqual(owners(), [c2.pub], 'church 2 should be the only owner left');
  assert.equal(existsSync(join(A.dir, 'blobs', sx + '.deleted')), false, 'a tombstone was written while church 2 still owns the file');
  assert.ok((await exportMedia(PA, c2)).blobs.some(b => b.sha === sx), "church 2's archive lost the file it still owns");
  assert.ok(!(await exportMedia(PA, c1)).blobs.some(b => b.sha === sx), 'church 1 is still listed as holding what it deleted');
});

test("purging another church leaves church 2's copy and owner record intact, and says what it erased (finding 3)", async () => {
  const P = K();                                                  // a third church, so a purge never empties the relay
  const X = file(160), sx = shaOf(X), Y = file(170), sy = shaOf(Y);
  const [s0] = await config(A, { addChurch: { npub: npubEncode(P.pub) } }); assert.equal(s0, 200, 'addChurch');
  await sleep(300);
  assert.equal(await up(PA, P, X), 201); assert.equal(await up(PA, c2, X), 201);   // X shared with church 2
  assert.equal(await up(PA, P, Y), 201);                                               // Y is P's alone
  const [, dry] = await config(A, { removeChurch: { npub: npubEncode(P.pub) } });
  assert.equal(dry.wouldDelete.blobs, 2, 'dry run: P holds two files');
  const [st, done] = await config(A, { removeChurch: { npub: npubEncode(P.pub), confirm: true, purge: true } });
  assert.equal(st, 200, 'purge');
  assert.deepEqual(done.purged && { blobs: done.purged.blobs, bytes: done.purged.bytes }, { blobs: 1, bytes: Y.length }, 'the purge report must count only what it actually erased');
  assert.equal(existsSync(join(A.dir, 'blobs', sy)), false, "CONTROL: P's own file is erased");
  assert.equal(await play(PA, m2, sx), 200, "church 2's member lost the sermon because another church was purged");
  assert.deepEqual(JSON.parse(readFileSync(join(A.dir, 'blobs', sx + '.owners'), 'utf8')), [c2.pub], "church 2's ownership record was erased");
  assert.deepEqual((await exportMedia(PA, c2)).blobs.map(b => b.sha).filter(s => s === sx), [sx]);
});

test("a church's usage never exceeds its cap by sharing then deleting a file (finding 8)", async () => {
  const X = file(200), sx = shaOf(X), Y = file(200), Z = file(200);
  assert.equal(await up(PC, c1, X), 201);
  assert.equal(await up(PC, c2, X), 201, 'dedup under the cap');                  // church 2 now holds 200
  assert.equal(await up(PC, c2, Y), 507, 'church 2 holds 200 of 300 — another 200 must be refused');
  assert.equal(await del(PC, c2, sx), 200);                                        // church 2 lets go of X
  assert.equal(await up(PC, c2, Z), 201, 'church 2 holds nothing now — 200 fits');
  const e = await exportMedia(PC, c2);
  assert.ok(e.totalBytes <= CAP, `church 2 holds ${e.totalBytes} bytes against a ${CAP}-byte cap`);
  assert.equal(e.totalBytes, Z.length);
  assert.equal(await play(PC, m2, sx), 401, 'CONTROL: church 2 no longer owns X');
});
