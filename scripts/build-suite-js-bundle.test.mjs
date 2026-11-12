// THE SUITE JS AUTO-UPDATE BUNDLE IS A SELF-CONTAINED, BOOTABLE, PACKAGED JS LAYER — PROVEN BY RUNNING IT.
// Run: node --test scripts/build-suite-js-bundle.test.mjs
//
// P1 of PLAN/BUILD-suite-js-autoupdate-2026-11-09. scripts/build-suite-js-bundle.sh produces the tarball a
// packaged Suite downloads, verifies against the read-only release key, and runs in place of its shipped
// payload. This test BUILDS the real bundle and asserts the contract by EXECUTING it (house rule 1 — it goes
// red if the builder is deleted or broken, not merely if some engine behind it is), not by matching text:
//
//   • release-origin present      — the LOAD-BEARING requirement (AUDIT FIX #3). gateway.mjs sets
//                                   PACKAGED = existsSync(ROOT/release-origin); it is NOT a tracked file, so
//                                   `git archive` cannot carry it and it must be injected by the builder.
//                                   Without it the override boots PACKAGED=false and the auto-update path
//                                   silently self-disables after the first update. Proven at RUNTIME: the
//                                   booted gateway announces it is a packaged relay.
//   • version.txt has sha + date  — /suite-update compares the sha and the anti-rollback gate reads the date.
//   • node_modules, NO *.node     — the three deps (ws, nostr-tools, web-push) are pure JS; a compiled addon
//                                   would be this host's architecture and crash on another OS (AUDIT FIX #6).
//   • no sidecars / native binary — the bundled node, cloudflared and the Tauri app ship only in the installer.
//   • node scripts/gateway.mjs <port> boots and serves — the whole point: the override actually runs.
//
// NO NETWORK: the build's `npm install` is pinned offline (npm_config_offline) and resolves the three deps
// from the local npm cache. Like every build test here it needs node_modules/.bin/esbuild (to transpile the
// app) and a warm npm cache — a fresh worktree has neither, which is a documented environment caveat, not a
// code failure (reference/CLAUDE.md "Audit briefs").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const BUILDER = join(ROOT, 'scripts', 'build-suite-js-bundle.sh');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// An ephemeral free port — never a fixed one, so this test cannot collide with a concurrent suite.
const freePort = () => new Promise((resolve, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

// A commit ref that resolves in THIS checkout (build-strict-tgz archives a ref, and a worktree may have no
// local `main`). HEAD is always resolvable.
const HEAD = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

test('build-suite-js-bundle.sh produces a bundle that unpacks, satisfies the contract, and BOOTS', async (t) => {
  const work = mkdtempSync(join(tmpdir(), 'trin-suitejs-'));
  t.after(() => { try { rmSync(work, { recursive: true, force: true }); } catch {} });
  const tgz = join(work, 'suite-js-bundle.tgz');

  // ── build (offline) ──────────────────────────────────────────────────────────────────────────────────
  const b = spawnSync('bash', [BUILDER, tgz, HEAD], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, npm_config_offline: 'true' }, timeout: 300000,
  });
  // Red if the builder is DELETED (spawn of a missing script → non-zero) or BROKEN.
  assert.equal(b.status, 0, 'the bundle build failed — if build-suite-js-bundle.sh is gone this is the feature being deleted\n' + (b.stderr || '').slice(-1500));
  assert.ok(existsSync(tgz), 'the builder reported success but wrote no tarball');

  // ── unpack ───────────────────────────────────────────────────────────────────────────────────────────
  const un = join(work, 'un');
  rmSync(un, { recursive: true, force: true });
  spawnSync('mkdir', ['-p', un]);
  const x = spawnSync('tar', ['-xzf', tgz, '-C', un], { encoding: 'utf8' });
  assert.equal(x.status, 0, 'the bundle does not unpack: ' + x.stderr);

  // ── the contract ───────────────────────────────────────────────────────────────────────────────────────
  // release-origin — the load-bearing PACKAGED seed (asserted again at runtime below).
  assert.ok(existsSync(join(un, 'release-origin')), 'NO release-origin — an unpacked override boots PACKAGED=false and the auto-update path self-disables (AUDIT FIX #3)');

  // version.txt — sha (40 hex) + ISO date.
  assert.ok(existsSync(join(un, 'version.txt')), 'no version.txt in the bundle');
  const [sha, date] = readFileSync(join(un, 'version.txt'), 'utf8').split('\n');
  assert.match((sha || '').trim(), /^[0-9a-f]{40}$/, 'version.txt line 1 is not a 40-char commit sha: ' + sha);
  assert.match((date || '').trim(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'version.txt line 2 is not an ISO commit date: ' + date);
  assert.equal(sha.trim(), HEAD, 'the bundle was stamped with a commit other than the ref it was built from');

  // node_modules present for the three deps, with NO compiled native addon anywhere.
  for (const dep of ['ws', 'nostr-tools', 'web-push']) {
    assert.ok(existsSync(join(un, 'node_modules', dep)), `node_modules/${dep} missing — the gateway imports it and the override would not boot`);
  }
  const dotNode = spawnSync('find', [un, '-name', '*.node'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(dotNode, '', 'the cross-OS bundle carries a compiled *.node addon — it would crash on another architecture (AUDIT FIX #6):\n' + dotNode);

  // no sidecars / native app binary — those ship only inside the OS-signed installer.
  const banned = spawnSync('bash', ['-c',
    `find ${JSON.stringify(un)} \\( -iname 'cloudflared*' -o -iname '*.AppImage' -o -iname '*.exe' -o -iname '*.dmg' -o -iname '*.deb' \\) -print`],
    { encoding: 'utf8' }).stdout.trim();
  assert.equal(banned, '', 'the bundle carries a sidecar or native binary that must live only in the installer:\n' + banned);

  // gateway must be there to run.
  assert.ok(existsSync(join(un, 'scripts', 'gateway.mjs')), 'no scripts/gateway.mjs in the bundle — nothing to run');

  // ── BOOT it: unpack → node scripts/gateway.mjs <port> boots + serves, and reports itself PACKAGED ───────
  const port = await freePort();
  const dataDir = join(work, 'data');
  spawnSync('mkdir', ['-p', dataDir]);
  let log = '';
  const gw = spawn(process.execPath, ['scripts/gateway.mjs', String(port)], {
    cwd: un, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_SYNC: '0' },
  });
  gw.stdout.on('data', (d) => { log += d; });
  gw.stderr.on('data', (d) => { log += d; });
  t.after(() => { try { gw.kill('SIGKILL'); } catch {} });

  let status = null;
  for (let i = 0; i < 100; i++) {
    await sleep(200);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/status`);
      if (r.ok) { status = await r.json(); break; }
    } catch {}
  }
  assert.ok(status && status.ok, 'the unpacked bundle did not boot and serve /status within 20s\n--- gateway log ---\n' + log.slice(-1500));
  assert.equal(status.version, HEAD, '/status reports a different build than version.txt — the bundle is inconsistent');

  // PACKAGED is true at runtime: a packaged relay seeds its update source from release-origin on first boot
  // and says so. (gateway.mjs: "first run of a packaged relay — update source set to …".)
  assert.match(log, /packaged relay/i, 'the booted gateway did not announce itself PACKAGED — release-origin did not take effect\n--- gateway log ---\n' + log.slice(-1500));
});
