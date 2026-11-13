// A RELAY WHOSE NODE CANNOT RUN THE MOVER SAYS SO, INSTEAD OF OFFERING A MOVE THAT ALWAYS REFUSES.
// Run: node --test scripts/a-relay-on-an-old-node-says-it-cannot-move-its-data.test.mjs
// The mover (and the event store) read the database with node:sqlite, new in Node 22.5. install.sh used to accept Node 18+
// and install 20. Drives the REAL gateway in server mode: GET /storage must carry the `node-too-old` reason (which is what
// makes the panel show "Can't move right now" with that reason and no Move button), and POST /storage/move must refuse
// and write no request. The Node version is faked with TRINITY_STORAGE_NODE_VERSION, because the gateway cannot itself
// run on a Node that old. Also pins install.sh's own Node gate.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeCanMove } from './relay-move.mjs';
import { requireFreePort } from './test-ports.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 9062;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const procs = [], dirs = [];
after(() => { for (const p of procs) try { p.kill('SIGKILL'); } catch {} for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test('nodeCanMove: 22.13 is the line (node:sqlite lost its flag there)', () => {
  for (const [v, want] of [['18.20.0', false], ['20.11.1', false], ['22.4.9', false], ['22.5.0', false], ['22.12.0', false], ['22.13.0', true], ['22.22.2', true], ['24.0.0', true], ['', false], ['x', false]]) assert.equal(nodeCanMove(v), want, v);
});

async function gateway(version) {
  await requireFreePort(PORT, 'the old-node storage test');
  const dir = mkdtempSync(join(tmpdir(), 'trin-oldnode-')); dirs.push(dir);
  const env = { ...process.env, TRINITY_DATA_DIR: dir, TRINITY_STORAGE_MODE: 'server', TRINITY_STORAGE_STATE: join(dir, '..', 'trin-oldnode-state.json'),
    RELAY_SYNC: '0', RELAY_HOST: '127.0.0.1', RELAY_NO_OPEN: '1', RELAY_DIRECTORY: 'http://127.0.0.1:9', TRINITY_TAILSCALE_BIN: '/nonexistent/tailscale' };
  if (version) env.TRINITY_STORAGE_NODE_VERSION = version;
  const p = spawn(process.execPath, [join(ROOT, 'scripts/gateway.mjs'), String(PORT)], { cwd: ROOT, env, stdio: 'ignore' }); procs.push(p);
  for (let i = 0; i < 200; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  const tok = JSON.parse(readFileSync(join(dir, 'admin.json'), 'utf8')).token;
  const call = async (path, method = 'GET', body) => { const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }); return { status: r.status, j: await r.json() }; };
  const stop = async () => { p.kill('SIGKILL'); await sleep(300); };
  return { dir, call, stop };
}

test('on a Node that cannot run the mover, GET /storage says node-too-old and a move is refused with no request written', async () => {
  const g = await gateway('20.11.1');
  try {
    const r = await g.call('/storage');
    assert.equal(r.status, 200); assert.ok(r.j.refuse.includes('node-too-old'), 'the card was not told: ' + JSON.stringify(r.j.refuse));
    const mp = (r.j.drives.find(d => d.eligible) || {}).mountpoint || '/mnt/none';
    const m = await g.call('/storage/move', 'POST', { drive: mp, acknowledge: ['no-permissions', 'removable'] });
    assert.ok(m.status === 409 || m.status === 400, 'a move was accepted on a Node that cannot run it: ' + m.status);
    assert.equal(existsSync(join(g.dir, '.move-request')), false);
  } finally { await g.stop(); }
});
test('on a Node that can, the reason is absent', async () => {
  const g = await gateway(null);
  try { const r = await g.call('/storage'); assert.equal(r.j.refuse.includes('node-too-old'), false); } finally { await g.stop(); }
});
test('install.sh requires Node 22.13 (the gate expression, run), installs 22, and hands the move helper the relay\'s own Node', async () => {
  const sh = readFileSync(join(ROOT, 'relay-app/install.sh'), 'utf8');
  assert.doesNotMatch(sh, /setup_(18|20)\.x/); assert.match(sh, /setup_22\.x/);
  const m = /node -p '([^']+)'/.exec(sh.slice(sh.indexOf('NODE_OK=0'))); assert.ok(m, 'the Node gate moved');
  const { runInNewContext } = await import('node:vm');
  for (const [v, want] of [['18.20.0', 'old'], ['20.11.1', 'old'], ['22.4.0', 'old'], ['22.5.0', 'old'], ['22.12.9', 'old'], ['22.13.0', 'ok'], ['22.22.2', 'ok'], ['24.1.0', 'ok']])
    assert.equal(runInNewContext(m[1], { process: { versions: { node: v } } }), want, v);
  assert.match(sh, /TRINITYONE_NODE=\$NODE_BIN/, 'the move helper would use whatever node root finds first, not the relay\'s');
});
