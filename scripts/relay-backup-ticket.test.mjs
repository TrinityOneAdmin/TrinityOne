// The relay backup download must NOT carry the admin secret in the URL. A plain <a download> navigation
// can't set an Authorization header, so the console mints a ONE-TIME ticket (auth via header) and downloads
// with ?ticket=<one-time>. This proves: minting needs auth; a ticket works once then is dead; a bogus ticket
// is rejected; and the admin token still works as an API fallback. Run:
//   node --test scripts/relay-backup-ticket.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8843;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const url = p => `http://127.0.0.1:${PORT}${p}`;
let relay, dataDir, token;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'trin-bkt-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '2000' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) { try { const r = await fetch(url('/status')); if (r.ok) break; } catch {} await sleep(150); }
  token = JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token;
});
after(() => { try { relay.kill(); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

const mint = (hdrs) => fetch(url('/relay-backup-ticket'), { method: 'POST', headers: hdrs });
const dl = (qs) => fetch(url('/relay-backup' + qs));

test('minting a ticket requires admin auth', async () => {
  assert.equal((await mint({})).status, 401);
  assert.equal((await mint({ Authorization: 'Bearer wrong' })).status, 401);
  const ok = await mint({ Authorization: 'Bearer ' + token });
  assert.equal(ok.status, 200);
  const j = await ok.json();
  assert.ok(j.ticket && j.ticket.length >= 20, 'returns a ticket');
});

test('a ticket downloads the backup exactly once, then is dead', async () => {
  const { ticket } = await (await mint({ Authorization: 'Bearer ' + token })).json();
  const first = await dl('?ticket=' + encodeURIComponent(ticket));
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('content-type'), 'application/gzip');
  assert.match(first.headers.get('content-disposition') || '', /attachment; filename=/);
  await first.arrayBuffer();   // drain
  // second use of the SAME ticket is rejected (one-time)
  assert.equal((await dl('?ticket=' + encodeURIComponent(ticket))).status, 401);
});

test('a bogus or empty ticket is rejected', async () => {
  assert.equal((await dl('?ticket=not-a-real-ticket')).status, 401);
  assert.equal((await dl('')).status, 401);   // no auth at all
});

test('the admin token still works directly (API fallback / backward compat)', async () => {
  const r = await dl('?token=' + encodeURIComponent(token));
  assert.equal(r.status, 200);
  await r.arrayBuffer();
});

test('the admin secret is not required in the URL for the console path', async () => {
  // the whole point: a valid ticket downloads with NO admin token anywhere in the request
  const { ticket } = await (await mint({ Authorization: 'Bearer ' + token })).json();
  const r = await fetch(url('/relay-backup?ticket=' + encodeURIComponent(ticket)));   // no Authorization header
  assert.equal(r.status, 200);
  await r.arrayBuffer();
});
