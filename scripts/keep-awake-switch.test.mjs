// Point-of-use test for the relay panel's "Keep this computer awake while public" switch.
// Run: node --test scripts/keep-awake-switch.test.mjs
//
// Two halves, BOTH of which go red if the feature is removed (CLAUDE.md rule 1):
//   (a) LOGIC — lifts the REAL keepAwakeChecked / keepAwakeBody source out of relay-app/control.js (the
//       KEEP-AWAKE-BEGIN/END slice the toggle's wiring actually calls) and runs it. Deleting the markers, or
//       changing the default-ON / inverted-body behaviour, turns these red. Port-free, DOM-free.
//   (b) MARKER CONTRACT — spawns the REAL scripts/gateway.mjs and drives POST /settings, asserting the on-disk
//       marker the Tauri Rust keep-awake controller reads: keepAwake=false writes <DATA_DIR>/keep-awake-off,
//       keepAwake=true removes it. The sense is INVERTED (true => marker ABSENT) and is asserted explicitly.
//       This is proven by executing the gateway, not by matching text, so it defeats the unbundled-dead-code
//       trap (CLAUDE.md rule 3): commenting the handler out makes the marker never appear and the test fails.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { requireFreePort } from './test-ports.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// ── (a) LOGIC: lift the pure helpers the toggle wiring calls. ───────────────────────────────────────
const SRC = readFileSync(join(ROOT, 'relay-app', 'control.js'), 'utf8');
const m = SRC.match(/\/\/ KEEP-AWAKE-BEGIN[^\n]*\n([\s\S]*?)\/\/ KEEP-AWAKE-END/);
assert.ok(m, 'KEEP-AWAKE markers are gone from control.js — the keep-awake toggle logic was removed; re-anchor this test');
const api = new Function(m[1] + '\nreturn { keepAwakeChecked, keepAwakeBody };')();

test('keepAwakeChecked defaults ON when the setting is absent or the relay is unreachable', () => {
  assert.equal(api.keepAwakeChecked({}), true, 'no keepAwake field → ON (owner default)');
  assert.equal(api.keepAwakeChecked(null), true, 'relay unreachable (null) → show ON, the default');
  assert.equal(api.keepAwakeChecked(undefined), true);
});

test('keepAwakeChecked reflects an explicit setting (only an explicit false is OFF)', () => {
  assert.equal(api.keepAwakeChecked({ keepAwake: true }), true);
  assert.equal(api.keepAwakeChecked({ keepAwake: false }), false);
  // a church that has other settings but has never touched keep-awake is still ON
  assert.equal(api.keepAwakeChecked({ lanAccess: true }), true);
});

test('keepAwakeBody is the /settings POST shape, coerced to a real boolean', () => {
  assert.deepEqual(api.keepAwakeBody(true), { keepAwake: true });
  assert.deepEqual(api.keepAwakeBody(false), { keepAwake: false });
  assert.deepEqual(api.keepAwakeBody(undefined), { keepAwake: false }, 'a checkbox that never resolved is OFF, not undefined');
  assert.deepEqual(api.keepAwakeBody('on'), { keepAwake: true });
});

// ── (b) MARKER CONTRACT: the real gateway writes/removes keep-awake-off with INVERTED sense. ──────────
const PORT = 8795;
let relay, dataDir, stdout = '';
const MARKER = () => join(dataDir, 'keep-awake-off');

async function waitFor(fn, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) { if (await fn()) return true; await new Promise(r => setTimeout(r, 150)); }
  return false;
}
function adminToken() { try { return JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token || ''; } catch { return ''; } }
async function postSettings(token, obj) {
  return fetch(`http://127.0.0.1:${PORT}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify(obj),
  });
}

before(async () => {
  await requireFreePort(PORT, 'keep-awake-switch.test.mjs (gateway marker contract)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-keepawake-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TRINITY_DATA_DIR: dataDir } });
  relay.stdout.on('data', d => { stdout += String(d); });
  relay.stderr.on('data', d => { stdout += String(d); });
  // Ready when the gateway answers an authenticated GET /settings on the loopback port.
  const up = await waitFor(async () => {
    const t = adminToken(); if (!t) return false;
    try { const r = await fetch(`http://127.0.0.1:${PORT}/settings`, { headers: { 'Authorization': 'Bearer ' + t } }); return r.ok; } catch { return false; }
  }, 20000);
  assert.ok(up, 'gateway did not come up on ' + PORT + ' within 20s\n' + stdout.slice(-800));
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('default (fresh box): keepAwake ON and no keep-awake-off marker on disk', async () => {
  const t = adminToken();
  const r = await fetch(`http://127.0.0.1:${PORT}/settings`, { headers: { 'Authorization': 'Bearer ' + t } });
  const j = await r.json();
  assert.equal(j.settings.keepAwake, true, 'keepAwake defaults ON');
  assert.equal(existsSync(MARKER()), false, 'ON means the OFF-marker is ABSENT (inverted)');
});

test('keepAwake=false WRITES the keep-awake-off marker (OFF = marker present)', async () => {
  const r = await postSettings(adminToken(), { keepAwake: false });
  assert.ok(r.ok, 'POST /settings should succeed');
  const j = await r.json();
  assert.equal(j.settings.keepAwake, false);
  assert.equal(existsSync(MARKER()), true, 'turning keep-awake OFF must create <DATA_DIR>/keep-awake-off');
});

test('keepAwake=true REMOVES the keep-awake-off marker (INVERTED: true ⇒ marker ABSENT)', async () => {
  // first ensure the marker exists (OFF), so the removal is a real transition
  await postSettings(adminToken(), { keepAwake: false });
  assert.equal(existsSync(MARKER()), true, 'precondition: marker present after OFF');
  const r = await postSettings(adminToken(), { keepAwake: true });
  assert.ok(r.ok);
  const j = await r.json();
  assert.equal(j.settings.keepAwake, true);
  assert.equal(existsSync(MARKER()), false, 'turning keep-awake ON must DELETE the marker — inverted semantics');
});

test('the marker write is gated: no admin token ⇒ 401 and no marker change', async () => {
  // leave it ON (marker absent), then an unauthenticated OFF must be refused and must not write the marker
  await postSettings(adminToken(), { keepAwake: true });
  assert.equal(existsSync(MARKER()), false);
  const r = await fetch(`http://127.0.0.1:${PORT}/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keepAwake: false }) });
  assert.equal(r.status, 401, 'unauthenticated /settings POST must be rejected');
  assert.equal(existsSync(MARKER()), false, 'a rejected request must not have written the marker');
});
