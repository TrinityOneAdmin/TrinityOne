// Self-hosted tutorial/help + sermon media must serve with the right video MIME and HTTP Range support —
// without a video/* content-type a browser won't play a .mp4 inline, and without 206/Range seeking breaks
// (Safari refuses to play a video at all). Run:  node --test scripts/relay-static-media.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8848;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const url = p => `http://127.0.0.1:${PORT}${p}`;
const SIZE = 100000;
const NAME = '_test-media-' + PORT + '.mp4';   // served from ROOT (the repo dir the gateway runs in)
let relay, dataDir;

before(async () => {
  await requireFreePort(PORT, 'relay-static-media.test.mjs');
  writeFileSync(NAME, Buffer.alloc(SIZE, 7));
  dataDir = mkdtempSync(join(tmpdir(), 'trin-media-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '2000' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) { try { const r = await fetch(url('/status')); if (r.ok) break; } catch {} await sleep(150); }
});
after(() => { try { relay.kill(); } catch {} try { unlinkSync(NAME); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('a .mp4 serves with a video content-type + Accept-Ranges', async () => {
  const r = await fetch(url('/' + NAME));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'video/mp4');
  assert.equal(r.headers.get('accept-ranges'), 'bytes');
  await r.arrayBuffer();
});

test('a Range request returns 206 with the exact byte window', async () => {
  const r = await fetch(url('/' + NAME), { headers: { Range: 'bytes=0-9' } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), `bytes 0-9/${SIZE}`);
  assert.equal(r.headers.get('content-length'), '10');
  assert.equal((await r.arrayBuffer()).byteLength, 10);
});

test('a suffix range (bytes=-N) returns the LAST N bytes (mp4 moov-atom probe)', async () => {
  const r = await fetch(url('/' + NAME), { headers: { Range: 'bytes=-16' } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), `bytes ${SIZE - 16}-${SIZE - 1}/${SIZE}`);
  assert.equal((await r.arrayBuffer()).byteLength, 16);
});

test('an unsatisfiable range returns 416', async () => {
  const r = await fetch(url('/' + NAME), { headers: { Range: `bytes=${SIZE + 10}-${SIZE + 20}` } });
  assert.equal(r.status, 416);
  await r.arrayBuffer();
});
