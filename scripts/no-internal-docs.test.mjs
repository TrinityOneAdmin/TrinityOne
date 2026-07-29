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
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { request as httpRequest } from 'node:http';
import { requireFreePort } from './test-ports.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
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

// ── what IS served, rather than "are the documents served" ───────────────────────────────────────────────
// AUDIT-2026-07-28 F3. The tests above ask about markdown, so by construction they cannot catch anything
// that is not markdown — and the audit that wrote them said, in its own header, that the 2026-07-06 fix
// failed because it "named one directory rather than asking what else the bundle contains". Then it made
// the same mistake one layer down.
//
// So: ask the relay for EVERY tracked file and look at what comes back 200. Measured on a live gateway
// before the fix, 220 of 447 were served, and among them deploy/systemd/*.service (the install path, the
// service account name and the exact Node version — on every church's own box), ci/*.yml, and the Tauri
// build sources. None of them is referenced by anything served.
//
// The assertion is a CLASS rule, not the list of files I happened to find, so a config or build descriptor
// added tomorrow fails here without anyone remembering to edit this file.
const WEB_EXT = /\.(html|css|js|jsx|mjs|map|json|png|jpe?g|webp|avif|svg|gif|ico|woff2?|ttf|otf|wasm|mp3|m4a|ogg|mp4|webm|pdf|txt|webmanifest)$/i;
// Served on purpose, each for a stated reason. Anything not covered here has to be justified before it
// gets added — which is the point.
const SERVE_OK = (f) =>
  WEB_EXT.test(f)                                   // the web surface itself
  || f === 'LICENSE'                                // the licence, deliberately readable
  || /^modules\//.test(f)                           // Bible/lexicon packs the app downloads on demand
  || /^vendor\/library\/.*\.gz$/.test(f)            // the public-domain book library, fetched by the reader
  || f === 'relay-app/install.sh'                   // the documented one-line self-host installer curls this
  || /^relay-app\/(start\.(sh|bat|command|mjs)|release-pubkey\.pem)$/.test(f);   // launchers + the public trust anchor

test('nothing outside the web surface is served', async () => {
  const served = [];
  for (let i = 0; i < tracked.length; i += 24) {
    const batch = tracked.slice(i, i + 24);
    const codes = await Promise.all(batch.map(f => get('/' + f.split('/').map(encodeURIComponent).join('/'))));
    codes.forEach((c, j) => { if (c === 200) served.push(batch[j]); });
  }
  assert.ok(served.length > 100, 'almost nothing is served (' + served.length + ') — the app is broken, or this check is not running');
  const unexpected = served.filter(f => !SERVE_OK(f)).sort();
  assert.deepEqual(unexpected, [],
    'the relay serves these, and nothing served references them. Each one describes the box rather than\n' +
    '    running it. Either add it to SERVE_OK with a reason, or stop serving it');
});

// Both halves of the F3 fix independently. Every file that sweep found is caught by the directory rule AND
// by the extension rule, so breaking either one on its own leaves the other standing and the tests above
// stay green — I only noticed by sabotaging my own fix and watching nothing happen. Untestable redundancy
// is how a rule gets deleted later as "dead", so each layer is pinned here with a file only it can catch.
// The probe file has a web extension (so the extension rule ignores it) and lives for a few milliseconds.
test('the directory rule holds on its own', async () => {
  const probes = [join(ROOT, 'deploy', `probe-${process.pid}.txt`), join(ROOT, 'ci', `probe-${process.pid}.txt`)];
  try {
    for (const f of probes) writeFileSync(f, 'if you can read this over HTTP, the directory rule is gone');
    assert.equal(await get(`/deploy/probe-${process.pid}.txt`), 404,
      'a non-config file under deploy/ is served — only the directory rule stops that, and it is gone');
    assert.equal(await get(`/ci/probe-${process.pid}.txt`), 404, 'a non-config file under ci/ is served');
  } finally { for (const f of probes) { try { rmSync(f, { force: true }); } catch {} } }
});

test('the extension rule holds on its own', async () => {
  // Every config file this sweep FOUND also sits in a denied directory, so the extension rule is invisible
  // in today's tree — I removed it and all nine tests stayed green. Its whole value is the file that has
  // not been added yet: a compose file at the repo root, a .toml beside the app, a build descriptor
  // somewhere nobody thought to deny. Pin it where only it can be responsible: the repo root IS served.
  const probes = ['.service', '.yml', '.toml'].map(ext => join(ROOT, `probe-${process.pid}${ext}`));
  try {
    for (const f of probes) writeFileSync(f, 'if you can read this over HTTP, the extension rule is gone');
    for (const ext of ['.service', '.yml', '.toml']) {
      assert.equal(await get(`/probe-${process.pid}${ext}`), 404,
        `a ${ext} file at the repo root is served — the directory rules cannot cover the root, so only the extension rule can`);
    }
  } finally { for (const f of probes) { try { rmSync(f, { force: true }); } catch {} } }
});

test('the relay-app/desktop rule holds on its own', async () => {
  // relay-app is deliberately public (the control UI and the installer live there), so ONLY the explicit
  // desktop prefix keeps the desktop app's build tree out.
  const dir = join(ROOT, 'relay-app', 'desktop');
  const probe = join(dir, `probe-${process.pid}.txt`);
  try {
    writeFileSync(probe, 'if you can read this over HTTP, the desktop rule is gone');
    assert.equal(await get(`/relay-app/desktop/probe-${process.pid}.txt`), 404,
      'the desktop build tree is served — the rest of relay-app/ is public, so nothing else covers this');
  } finally { try { rmSync(probe, { force: true }); } catch {} }
});

test('the specific things found by that sweep stay gone', async () => {
  // Belt and braces, and it reads as what it is: these were 200 on a live gateway on 2026-07-28.
  for (const p of ['/deploy/systemd/trinity-gateway.service', '/deploy/systemd/trinity-relay.service',
    '/ci/ios-simulator-smoke.job.yml', '/relay-app/desktop/src-tauri/Cargo.toml',
    '/relay-app/desktop/src-tauri/build.rs']) {
    assert.equal(await get(p), 404, p + ' still tells anyone who asks how this box is built');
  }
  // …and the two that must NOT be caught by the widened rule.
  assert.equal(await get('/relay-app/install.sh'), 200, 'the self-host installer stopped being served — the documented one-liner is broken');
  assert.equal(await get('/relay-app/control.html'), 200, 'the relay control UI stopped being served');
});

// ── ARCHITECTURE-AUDIT-2026-07-30 A1: the universe this file enumerates ──────────────────────────────────
// Every sweep above starts from `git ls-files`, which lists what is tracked NOW. A relay's disk is not that.
// relay-update.sh unpacks OVER the install, so a box holds the union of every bundle it has ever installed —
// and a file DELETED from the repo is, by construction, absent from `git ls-files`, so nothing above can even
// ask about it. Measured on a8 on 2026-07-30: eight files deleted from the repo, still served, and unchanged
// across a full update cycle.
//
// Testing that by requesting the paths would prove nothing HERE, because this checkout does not have them —
// they would 404 for the wrong reason, which is the exact failure mode F14 was about. So the probes are
// RECREATED on disk first, which is what a relay carrying an old bundle actually looks like.
//
// The withdrawn APP SOURCE half (.jsx/.html/.png) is deliberately NOT asserted 404 here: the static handler
// does serve those, and the thing that removes them is the updater's leftover sweep, covered by
// scripts/relay-update-reconcile.test.mjs. Splitting it that way keeps each test honest about which
// mechanism it is actually proving.
const DELETED = execSync('git log --diff-filter=D --name-only --pretty=format:', { cwd: ROOT, encoding: 'utf8' })
  .split('\n').map(s => s.trim()).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

test('a file DELETED from the repo is still refused if its class must never be served', async () => {
  assert.ok(DELETED.length > 5, 'git history reports almost no deletions (' + DELETED.length + ') — this check is not running');
  // The classes the static handler must hold regardless of how the file got onto the box.
  const mustRefuse = DELETED.filter(f => /\.md$/i.test(f) || /^(docs|reference|scripts|src|deploy|ci|relay)\//.test(f));
  assert.ok(mustRefuse.length > 3, 'expected several deleted files in the never-serve classes; found ' + mustRefuse.length);
  const made = [];
  try {
    for (const f of mustRefuse) {
      const p = join(ROOT, f);
      if (existsSync(p)) continue;                       // still present for some other reason — do not touch it
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, 'leftover from an older bundle — if you can read this over HTTP, the rule is gone');
      made.push(p);
    }
    assert.ok(made.length > 0, 'could not stage any deleted-file probes, so this test proved nothing');
    const served = [];
    for (const f of mustRefuse) { if (await get('/' + f.split('/').map(encodeURIComponent).join('/')) === 200) served.push(f); }
    assert.deepEqual(served, [],
      'these files are DELETED from the repo, so no sweep that enumerates `git ls-files` can see them — and a\n' +
      '    relay that installed an older bundle still has them on disk. The static rules are the only thing\n' +
      '    standing between them and the world, and for these paths they did not hold');
  } finally { for (const p of made) { try { rmSync(p, { force: true }); } catch {} } }
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
