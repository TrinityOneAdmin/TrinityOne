// The relay must not serve TrinityOne's internal documentation to the public.
// Run: node --test scripts/no-internal-docs.test.mjs
//
// AUDIT-2026-07-28. The deploy bundle is a `git archive` of the whole ref, so every tracked file lands on the
// box — and the static handler serves anything under ROOT the denylist misses. Confirmed against a real
// gateway: /AUDIT-2026-07-26-RECOVERY.md, /HANDOFF.md and /docs/design/TREASURY.md all returned 200 on a
// deployed relay. The audit files name vulnerabilities and when they were found, the handoff describes the
// internals, the design notes describe what is not built yet. A map of where to push, served from the
// church's own box to anyone who guesses a filename.
//
// This is the same shape as the 2026-07-06 incident that put `relay` in that denylist: the fix named one
// directory rather than asking what else the bundle contains. So this test asserts the PROPERTY — no tracked
// documentation is reachable — by asking git what ships, rather than listing the paths I happened to find.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8907;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = async (p) => { try { return (await fetch(`http://127.0.0.1:${PORT}${p}`)).status; } catch { return 0; } };
let relay, dataDir;

before(async () => {
  await requireFreePort(PORT, 'no-internal-docs.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-docs-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
});
after(() => { try { relay.kill(); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// Ask git what actually ships, rather than trusting a list written by hand.
const tracked = execSync('git ls-files', { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' }).split('\n').filter(Boolean);

test('no tracked markdown is reachable over HTTP', async () => {
  const md = tracked.filter(f => f.toLowerCase().endsWith('.md'));
  assert.ok(md.length > 20, 'expected plenty of tracked markdown; found ' + md.length);
  const leaked = [];
  for (const f of md) { if (await get('/' + f) === 200) leaked.push(f); }
  assert.deepEqual(leaked, [], 'these internal documents are downloadable from the relay');
});

test('the documentation directories are not browsable', async () => {
  for (const d of ['docs', 'reference', 'scripts', 'src']) {
    assert.notEqual(await get(`/${d}/`), 200, `/${d}/ is served`);
  }
  // and a known file inside each, in case directory listing is off but files are served
  assert.equal(await get('/scripts/gateway.mjs'), 404, 'the relay is serving its own source');
  assert.equal(await get('/src/fellowship.src.js'), 404, 'the relay is serving unbundled app source');
});

test('but the app, the marketing pages and the control UI still work', async () => {
  // The denylist is easy to over-tighten; breaking the app to hide a document is not a fix.
  for (const p of ['/index.html', '/steward.html', '/vendor/fellowship.js', '/app/app.jsx', '/features.html', '/relay-app/control.html']) {
    assert.equal(await get(p), 200, p + ' stopped being served');
  }
});

// fetch() normalises '/../x' to '/x' before it ever leaves the process, so testing traversal through fetch
// tests the client, not the server. Send the raw path down a socket instead.
const rawGet = (path) => new Promise((resolve) => {
  const req = httpRequest({ host: '127.0.0.1', port: PORT, path, method: 'GET' }, (res) => { res.resume(); resolve(res.statusCode); });
  req.on('error', () => resolve(0));
  req.end();
});

test('the path-traversal guard still holds', async () => {
  for (const p of ['/../package.json', '/../../etc/passwd', '/docs/../HANDOFF.md', '/./docs/README.md']) {
    assert.notEqual(await rawGet(p), 200, p + ' escaped the guard');
  }
});

test('build files that describe the box are not served', async () => {
  // package-lock fingerprints every dependency version; capacitor.config.json states whether the shipped app
  // has remote debugging on. Neither is referenced by any shell.
  for (const p of ['/package.json', '/package-lock.json', '/capacitor.config.json']) {
    assert.equal(await get(p), 404, p + ' is downloadable from the relay');
  }
  // …but the ones the app genuinely needs still are.
  for (const p of ['/manifest.json', '/ebible-catalog.json']) {
    assert.equal(await get(p), 200, p + ' stopped being served');
  }
});
