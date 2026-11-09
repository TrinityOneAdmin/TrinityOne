// Point-of-use test for the relay's Linux "Open sleep settings" support.
// Run: node --test scripts/open-sleep-settings-linux.test.mjs
//
// Before this fix the gateway stubbed Linux with link='' and returned {ok:false,unsupported:true} — the button
// never launched anything. Two halves, BOTH of which go red if the Linux support is removed (CLAUDE.md rule 1):
//   (a) LOGIC — lifts the REAL whichExec / linuxPowerSettingsCandidates / openLinuxPowerSettings out of
//       scripts/gateway.mjs (the OPEN-SLEEP-LINUX-BEGIN/END slice) and RUNS it against a dummy settings binary
//       on a temp PATH. Deleting the slice, or breaking candidate selection, turns these red.
//   (b) ROUTE CONTRACT — spawns the REAL gateway and POSTs /open-sleep-settings with a dummy
//       `gnome-control-center` first on PATH; asserts the response is {ok:true} and that the binary was
//       actually launched (it drops a marker file). Proven by executing the gateway, not matching text, so it
//       defeats the unbundled-dead-code trap (rule 3): reverting the route's linux branch makes it return
//       unsupported and the marker never appears, and the test fails.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants as fsConstants, readFileSync, writeFileSync, chmodSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { requireFreePort } from './test-ports.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const isLinux = process.platform === 'linux';

// ── (a) LOGIC: lift the real Linux power-settings helpers and run them. ──────────────────────────────
const SRC = readFileSync(join(ROOT, 'scripts', 'gateway.mjs'), 'utf8');
const m = SRC.match(/\/\/ OPEN-SLEEP-LINUX-BEGIN[^\n]*\n([\s\S]*?)\/\/ OPEN-SLEEP-LINUX-END/);
assert.ok(m, 'OPEN-SLEEP-LINUX markers are gone from gateway.mjs — the Linux sleep-settings support was removed; re-anchor this test');
const api = new Function('spawn', 'accessSync', 'fsConstants', 'join',
  m[1] + '\nreturn { whichExec, linuxPowerSettingsCandidates, openLinuxPowerSettings };')(spawn, accessSync, fsConstants, join);

test('linuxPowerSettingsCandidates prefers the running desktop, then falls back across DEs', () => {
  const gnomeFirst = api.linuxPowerSettingsCandidates('GNOME');
  assert.equal(gnomeFirst[0][0], 'gnome-control-center', 'GNOME session → gnome-control-center first');
  const kdeFirst = api.linuxPowerSettingsCandidates('KDE');
  assert.ok(kdeFirst[0][0].startsWith('systemsettings'), 'KDE session → a KDE systemsettings panel first');
  // Even an unknown desktop still gets the full generic fallback list, so a bare box can launch *something*.
  const unknown = api.linuxPowerSettingsCandidates('');
  const names = unknown.map(c => c[0]);
  for (const need of ['gnome-control-center', 'xfce4-power-manager-settings', 'mate-power-preferences']) {
    assert.ok(names.includes(need), 'generic fallback must include ' + need);
  }
});

test('whichExec resolves a real binary on PATH and returns null for a missing one', () => {
  assert.ok(api.whichExec('sh'), 'sh is on PATH and executable');
  assert.equal(api.whichExec('definitely-not-a-real-binary-zzqq'), null, 'a missing command resolves to null');
});

test('openLinuxPowerSettings launches the first resolvable settings binary (dummy proves it ran)', { skip: !isLinux }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-sleeplnx-'));
  try {
    const marker = join(dir, 'launched');
    const bin = join(dir, 'gnome-control-center');
    writeFileSync(bin, '#!/bin/sh\n: > "' + marker + '"\n');
    chmodSync(bin, 0o755);
    const savedPath = process.env.PATH, savedDesk = process.env.XDG_CURRENT_DESKTOP;
    process.env.PATH = dir;                 // only our dummy is reachable
    process.env.XDG_CURRENT_DESKTOP = 'GNOME';
    try {
      const ok = api.openLinuxPowerSettings();
      assert.equal(ok, true, 'a resolvable candidate → launched (true)');
      const seen = await waitFor(() => existsSync(marker), 4000);
      assert.ok(seen, 'the dummy settings binary was actually spawned (marker written)');
    } finally {
      process.env.PATH = savedPath;
      if (savedDesk === undefined) delete process.env.XDG_CURRENT_DESKTOP; else process.env.XDG_CURRENT_DESKTOP = savedDesk;
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('openLinuxPowerSettings returns false when no settings binary is installed', { skip: !isLinux }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-sleepnone-'));
  try {
    const savedPath = process.env.PATH;
    process.env.PATH = dir;                 // empty dir — nothing resolves
    try { assert.equal(api.openLinuxPowerSettings(), false, 'no candidate on PATH → false (UI shows the hint)'); }
    finally { process.env.PATH = savedPath; }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── (b) ROUTE CONTRACT: the real gateway POST /open-sleep-settings launches a candidate on Linux. ─────
const PORT = 8796;
let relay, dataDir, binDir, stdout = '';
const MARKER = () => join(binDir, 'launched');

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
function adminToken() { try { return JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token || ''; } catch { return ''; } }

before(async () => {
  if (!isLinux) return;                     // the route tests below are Linux-only (skip guards match)
  await requireFreePort(PORT, 'open-sleep-settings-linux.test.mjs (gateway route)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-sleepgw-'));
  binDir = mkdtempSync(join(tmpdir(), 'trin-sleepbin-'));
  const bin = join(binDir, 'gnome-control-center');
  writeFileSync(bin, '#!/bin/sh\n: > "' + MARKER() + '"\n');
  chmodSync(bin, 0o755);
  // Dummy settings binary FIRST on the gateway's PATH, plus the real PATH so the gateway's own spawns still work.
  const env = { ...process.env, TRINITY_DATA_DIR: dataDir, XDG_CURRENT_DESKTOP: 'GNOME', PATH: binDir + ':' + (process.env.PATH || '') };
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env });
  relay.stdout.on('data', d => { stdout += String(d); });
  relay.stderr.on('data', d => { stdout += String(d); });
  const up = await waitFor(async () => {
    const t = adminToken(); if (!t) return false;
    try { const r = await fetch(`http://127.0.0.1:${PORT}/settings`, { headers: { 'Authorization': 'Bearer ' + t } }); return r.ok; } catch { return false; }
  }, 20000);
  assert.ok(up, 'gateway did not come up on ' + PORT + ' within 20s\n' + stdout.slice(-800));
});
after(() => {
  try { relay && relay.kill('SIGKILL'); } catch {}
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  try { rmSync(binDir, { recursive: true, force: true }); } catch {}
});

test('POST /open-sleep-settings returns {ok:true} on Linux and actually launches the panel', { skip: !isLinux }, async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/open-sleep-settings`, { method: 'POST', headers: { 'Authorization': 'Bearer ' + adminToken() } });
  assert.equal(r.status, 200, 'route should answer 200');
  const j = await r.json();
  assert.equal(j.ok, true, 'Linux with a resolvable settings binary must report ok:true (was unsupported before the fix)');
  const launched = await waitFor(() => existsSync(MARKER()), 4000);
  assert.ok(launched, 'the gateway actually spawned the settings binary');
});

test('POST /open-sleep-settings is still admin-gated (no token ⇒ 403)', { skip: !isLinux }, async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/open-sleep-settings`, { method: 'POST' });
  assert.equal(r.status, 403, 'unauthenticated POST must be rejected');
});
