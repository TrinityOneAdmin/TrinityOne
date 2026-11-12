// POST /settings maintains the `suite-autoupdate` marker file the Rust app shell reads.
// Run: node --test scripts/suite-autoupdate-marker.test.mjs
//
// The marker is the ONLY channel the shell (P2) learns the setting from — PRESENCE ⇒ enabled, contents =
// "HH:MM\n" (the apply time). This drives the REAL gateway over HTTP and stats the file on disk, so it defeats
// the unbundled-dead-code trap (rule 3): revert the marker write and the file never appears, and this fails.
// No network: PACKAGED is false for a checkout-spawned gateway, so the fire-on-enable is inert, and we still
// point SUITE_UPDATE_BASE at an unreachable address as belt-and-braces.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireFreePort } from './test-ports.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = 8794;
let relay, dataDir, stdout = '';
const marker = () => join(dataDir, 'suite-autoupdate');

function waitFor(fn, deadlineMs) {
  return new Promise(resolve => {
    const deadline = Date.now() + deadlineMs;
    (function tick() {
      Promise.resolve(fn()).then(v => {
        if (v) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(tick, 120);
      });
    })();
  });
}
const adminToken = () => { try { return JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token || ''; } catch { return ''; } };
const post = (body, auth = true) => fetch(`http://127.0.0.1:${PORT}/settings`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + adminToken() } : {}) },
  body: JSON.stringify(body),
});

before(async () => {
  await requireFreePort(PORT, 'suite-autoupdate-marker.test.mjs (gateway route)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-suiteau-'));
  const env = { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_SYNC: '0', SUITE_UPDATE_BASE: 'http://127.0.0.1:1' };
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env });
  relay.stdout.on('data', d => { stdout += String(d); });
  relay.stderr.on('data', d => { stdout += String(d); });
  const up = await waitFor(async () => {
    const t = adminToken(); if (!t) return false;
    try { const r = await fetch(`http://127.0.0.1:${PORT}/settings`, { headers: { Authorization: 'Bearer ' + t } }); return r.ok; } catch { return false; }
  }, 20000);
  assert.ok(up, 'gateway did not come up on ' + PORT + ' within 20s\n' + stdout.slice(-800));
});
after(() => {
  try { relay && relay.kill('SIGKILL'); } catch {}
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

test('enabling writes the marker with the chosen HH:MM', async () => {
  const r = await post({ autoUpdate: true, autoUpdateAt: '02:15' });
  assert.equal(r.status, 200, 'settings POST should succeed');
  const j = await r.json();
  assert.equal(j.settings.autoUpdate, true);
  assert.equal(j.settings.autoUpdateAt, '02:15');
  assert.ok(existsSync(marker()), 'the suite-autoupdate marker must exist when enabled');
  assert.equal(readFileSync(marker(), 'utf8'), '02:15\n', 'the marker contents must be the HH:MM time + newline');
});

test('changing only the time updates the marker contents', async () => {
  await post({ autoUpdate: true, autoUpdateAt: '02:15' });
  const r = await post({ autoUpdateAt: '04:45' });
  assert.equal(r.status, 200);
  assert.equal(readFileSync(marker(), 'utf8'), '04:45\n', 'the marker must reflect the new time');
});

test('an invalid time is rejected without corrupting the marker', async () => {
  await post({ autoUpdate: true, autoUpdateAt: '04:45' });
  const r = await post({ autoUpdateAt: '99:99' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.settings.autoUpdateAt, '04:45', 'a bad time must leave the good one in place');
  assert.equal(readFileSync(marker(), 'utf8'), '04:45\n', 'the marker must not be corrupted by a bad time');
});

test('disabling removes the marker', async () => {
  await post({ autoUpdate: true, autoUpdateAt: '02:15' });
  assert.ok(existsSync(marker()), 'precondition: marker present');
  const r = await post({ autoUpdate: false });
  assert.equal(r.status, 200);
  assert.ok(!existsSync(marker()), 'the marker must be removed when auto-update is turned off');
});

test('the marker route is admin-gated (no token ⇒ 401, no marker written)', async () => {
  // make sure it is currently absent
  await post({ autoUpdate: false });
  const r = await post({ autoUpdate: true, autoUpdateAt: '01:00' }, false);
  assert.equal(r.status, 401, 'an unauthenticated settings POST must be rejected');
  assert.ok(!existsSync(marker()), 'no marker may be written without admin auth');
});
