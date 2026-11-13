// A MOVE IS REFUSED WHILE "UPDATE NOW" RUNS. Run: node --test scripts/a-move-is-refused-while-an-update-runs.test.mjs
// Audit C M2: the update runs as root for minutes while the relay keeps serving; its restart could start the relay on the
// old folder in the middle of a copy. relay-update.sh and relay-move.sh share a lock; this is the card's half: the REAL
// gateway's GET /storage carries `update-in-progress` while update-status.json says running (and recently), and POST
// /storage/move refuses. A stale "running" (a killed updater) must not block moves for ever.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireFreePort } from './test-ports.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 9063;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const procs = [], dirs = [];
after(() => { for (const p of procs) try { p.kill('SIGKILL'); } catch {} for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

async function gateway() {
  await requireFreePort(PORT, 'the update-in-progress storage test');
  const dir = mkdtempSync(join(tmpdir(), 'trin-updrun-')); dirs.push(dir);
  const env = { ...process.env, TRINITY_DATA_DIR: dir, TRINITY_STORAGE_MODE: 'server', TRINITY_STORAGE_STATE: join(dir, '..', 'trin-updrun-state.json'),
    RELAY_SYNC: '0', RELAY_HOST: '127.0.0.1', RELAY_NO_OPEN: '1', RELAY_DIRECTORY: 'http://127.0.0.1:9', TRINITY_TAILSCALE_BIN: '/nonexistent/tailscale' };
  const p = spawn(process.execPath, [join(ROOT, 'scripts/gateway.mjs'), String(PORT)], { cwd: ROOT, env, stdio: 'ignore' }); procs.push(p);
  for (let i = 0; i < 200; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  const tok = JSON.parse(readFileSync(join(dir, 'admin.json'), 'utf8')).token;
  const call = async (path, method = 'GET', body) => { const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }); return { status: r.status, j: await r.json() }; };
  return { dir, call, stop: async () => { p.kill('SIGKILL'); await sleep(300); } };
}
const status = (dir, o) => writeFileSync(join(dir, 'update-status.json'), JSON.stringify(o));

test('while an update is running, GET /storage says update-in-progress and a move is refused with no request written', async () => {
  const g = await gateway();
  try {
    assert.equal((await g.call('/storage')).j.refuse.includes('update-in-progress'), false, 'fixture: refused before any update');
    status(g.dir, { state: 'running', reason: 'downloading', at: Math.floor(Date.now() / 1000), from: 'a', to: 'b' });
    const r = await g.call('/storage'); assert.ok(r.j.refuse.includes('update-in-progress'), JSON.stringify(r.j.refuse));
    const mp = (r.j.drives.find(d => d.eligible) || {}).mountpoint || '/mnt/none';
    const m = await g.call('/storage/move', 'POST', { drive: mp, acknowledge: ['no-permissions', 'removable'] });
    assert.ok(m.status === 409 || m.status === 400, 'a move was accepted while an update ran: ' + m.status);
    assert.equal(existsSync(join(g.dir, '.move-request')), false);
    status(g.dir, { state: 'ok', reason: '', at: Math.floor(Date.now() / 1000) });
    assert.equal((await g.call('/storage')).j.refuse.includes('update-in-progress'), false, 'a finished update still blocks moves');
    status(g.dir, { state: 'running', reason: 'downloading', at: Math.floor(Date.now() / 1000) - 3 * 3600 });
    assert.equal((await g.call('/storage')).j.refuse.includes('update-in-progress'), false, 'an updater that died hours ago blocks moves for ever');
  } finally { await g.stop(); }
});
