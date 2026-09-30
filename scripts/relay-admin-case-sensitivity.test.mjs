// THE DENY LIST MUST WORK ON A CASE-INSENSITIVE FILESYSTEM.
// Run: node --test scripts/relay-admin-case-sensitivity.test.mjs
//
// Cloud audit finding 2 (H1). `DENY_DIR.has(s)` was case-sensitive, so `/Relay/admin.json` served the
// admin token on Mac (HFS+) and Windows (NTFS) while `/relay/admin.json` was correctly denied.
// On Windows, `%5C` (backslash) can substitute for `/`, and a trailing `.` or space on a path segment
// is silently stripped by NTFS, so `admin.json.` reaches the same file as `admin.json`.
//
// This box is ext4, so the denied paths literally don't exist on disk — the test verifies that the
// deny-list check itself blocks the request (404) before the filesystem is consulted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8742;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let relay, dataDir;

async function waitReady(ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {}
    await sleep(150);
  }
  throw new Error('relay not ready');
}

before(async () => {
  await requireFreePort(PORT, 'relay-admin-case-sensitivity.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-case-'));
  const sk = generateSecretKey();
  const cp = getPublicKey(sk);
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '100' },
    stdio: 'ignore',
  });
  await waitReady();
});

after(async () => {
  try { relay && relay.kill('SIGKILL'); } catch {}
  await sleep(200);
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

// The paths that must be blocked regardless of letter case. On this ext4 box the files don't exist at
// alternate cases, so we're testing the deny check, not the filesystem.
const BLOCKED = [
  // The exact finding: mixed-case bypasses
  '/Relay/admin.json',
  '/RELAY/admin.json',
  '/rElAy/admin.json',
  '/relay/ADMIN.JSON',
  '/Relay/relay-key.json',
  '/RELAY/relay.sqlite',
  // Backslash substitution (Windows %5C trick)
  '/relay%5Cadmin.json',
  // Trailing dot/space (NTFS strip trick)
  '/relay./admin.json',
  // Other denied dirs with case variations
  '/Scripts/gateway.mjs',
  '/SCRIPTS/gateway.mjs',
  '/Src/fellowship.src.js',
  '/Reference/DOMAIN.md',
  '/Docs/design/TREASURY.md',
  // Dotfile with uppercase
  '/.Git/config',
  '/.CLAUDE/settings.json',
  // relay-app/desktop with case
  '/Relay-App/Desktop/src-tauri/Cargo.toml',
  '/relay-app/DESKTOP/build.rs',
  // Named build files with case
  '/Package.json',
  '/PACKAGE-LOCK.JSON',
  '/Capacitor.Config.Json',
];

// Programmatic endpoints that don't need files on disk.
const ALLOWED = [
  '/status',
];

for (const path of BLOCKED) {
  test(`DENIED: ${path}`, async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}${path}`);
    assert.ok(r.status === 404 || r.status === 403,
      `expected 404 or 403 for ${path} but got ${r.status} — the deny list was bypassed`);
    await r.text(); // consume body
  });
}

for (const path of ALLOWED) {
  test(`ALLOWED: ${path}`, async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}${path}`);
    assert.ok(r.status === 200 || r.status === 304,
      `expected 200 for ${path} but got ${r.status} — the fix over-blocked a legitimate path`);
    await r.text(); // consume body
  });
}
