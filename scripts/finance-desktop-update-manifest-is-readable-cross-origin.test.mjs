// THE DESKTOP FINANCE PROGRAM CAN READ ITS UPDATE MANIFEST: finance-desktop-latest.json IS SERVED WITH CORS.
// Run: node --test scripts/finance-desktop-update-manifest-is-readable-cross-origin.test.mjs
//
// T1Finance desktop plan §4 / §5 test 8 (manifest CORS). The program's page is https://tauri.localhost (Windows) or
// tauri://localhost (Mac/Linux); it fetches https://app.trinityone.church/finance-desktop-latest.json
// (app/update-check.jsx, variant 'finance-desktop'). That is a cross-origin read: without
// Access-Control-Allow-Origin the browser hides the body, the fetch throws, and the banner silently never shows.
// (scripts/finance-desktop-offers-its-own-update.test.mjs proves that in chromium: same manifest, no header, no banner.)
//
// Two servers can answer for that address, so both are checked, by RUNNING them:
//   · the REAL gateway (scripts/gateway.mjs, the box behind app.trinityone.church): its static route sends the header
//     on every file. The manifest is not published yet (the release is the plan's last step), so the test writes a
//     placeholder at the repo root for the run — a PRERELEASE version, which the banner refuses, so even a copy left
//     behind by a killed run offers nobody anything — and removes it after. An existing real file is left alone.
//   · Cloudflare Pages (scripts/build-pages.sh): the generated _headers gives that path the header.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as H from './relay-network-harness.mjs';

const ROOT = H.ROOT;
const sleep = H.sleep;
const FILE = join(ROOT, 'finance-desktop-latest.json');
const PLACEHOLDER = '{ "version": "0.0.0-test-placeholder" }\n';
let wrote = false, box, dataDir, base;
const cleanup = () => { try { if (wrote && readFileSync(FILE, 'utf8') === PLACEHOLDER) rmSync(FILE); } catch {} wrote = false; };
process.on('exit', cleanup);

before(async () => {
  if (!existsSync(FILE)) { writeFileSync(FILE, PLACEHOLDER); wrote = true; }
  const port = await H.freePort('the finance-desktop manifest CORS box');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-fdcors-'));
  box = spawn(process.execPath, ['scripts/gateway.mjs', String(port)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_SYNC: '0' },
  });
  box.stdout.resume(); box.stderr.resume();
  base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) { await sleep(200); try { if ((await fetch(base + '/status')).ok) break; } catch {} }
});
after(() => {
  try { box && box.kill('SIGKILL'); } catch {}
  try { dataDir && rmSync(dataDir, { recursive: true, force: true }); } catch {}
  cleanup();
});

test('the real gateway serves /finance-desktop-latest.json with Access-Control-Allow-Origin: * to the program\'s origins', async () => {
  for (const origin of ['https://tauri.localhost', 'tauri://localhost']) {
    const r = await fetch(base + '/finance-desktop-latest.json?t=' + Date.now(), { headers: { Origin: origin } });
    assert.equal(r.status, 200, 'the gateway does not serve the manifest');
    assert.equal(r.headers.get('access-control-allow-origin'), '*', `no CORS header for ${origin} — the program could not read the manifest`);
    assert.ok(typeof (await r.json()).version === 'string', 'the body is not the manifest');
  }
  // CONTROL: a path that does not exist is a 404 — the 200 above is the file, not a catch-all
  assert.equal((await fetch(base + '/finance-desktop-latest-nope.json')).status, 404);
});

test('Cloudflare Pages: build-pages.sh writes a _headers route giving finance-desktop-latest.json Access-Control-Allow-Origin: *', () => {
  const out = mkdtempSync(join(tmpdir(), 'trin-fdpages-'));
  try {
    execFileSync('bash', ['scripts/build-pages.sh'], { cwd: ROOT, env: { ...process.env, PAGES_OUT: out }, stdio: 'pipe', timeout: 300000 });
    const lines = readFileSync(join(out, '_headers'), 'utf8').split('\n');
    const at = lines.indexOf('/finance-desktop-latest.json');
    assert.ok(at >= 0, '_headers has no /finance-desktop-latest.json route');
    const block = [];
    for (let i = at + 1; i < lines.length && /^\s+\S/.test(lines[i]); i++) block.push(lines[i].trim());
    assert.ok(block.includes('Access-Control-Allow-Origin: *'), 'the route does not send Access-Control-Allow-Origin: * — ' + JSON.stringify(block));
  } finally { rmSync(out, { recursive: true, force: true }); }
});
