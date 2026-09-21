// A SERVER BOX TAKES ITS CODE FROM A GITHUB RELEASE, AND ITS INSTALLERS FROM THE APP ORIGIN — AND THE PANEL
// SAYS SO.
// Run: node --test scripts/a-server-box-takes-its-code-from-a-release.test.mjs
//
// THE FINDING (AUDIT-suite-ABD-2026-09-21 §6): the guide sent a church's server to app.trinityone.church for
// bundle.tgz, and that host does not serve one. Owner's decision: server boxes fetch the relay code from GitHub
// Releases. GitHub carries no APKs, so a box now has TWO addresses — relay/code-source (where "Update now"
// pulls from; GET /update asks it what is newest) and relay/origin (where the installers it hands out come
// from). scripts/the-installer-checks-what-it-downloads.test.mjs proves the two shell scripts; this file proves
// the gateway and the panel:
//
//   §1  gateway.mjs's releaseBundleBase agrees with the shell release_bundle_base over the same inputs — one
//       rule in two languages, run side by side;
//   §2  GET /update with a GitHub-shaped code source reads bundle.json from it (not /status), reports the
//       code source, and POST /update is allowed with no origin at all; a relay-shaped code source is asked
//       /status; a box with no code-source file asks its origin, as before;
//   §3  the panel, in Chromium (rule 1): a box whose code comes from a release and that has no origin says a
//       new build is out, names the release, offers a LIVE "Update now", says where the software comes from —
//       and still disables the installer button, because the installers have nowhere to come from.
//
// No row reaches the network: every "GitHub" here is a server this file spawns, and Chromium's resolver maps
// the shipped hosts to a black hole.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import * as H from './relay-network-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find((p) => existsSync(p));
const NO_CHROME = CHROME ? false : 'no chromium on this box';
const LATEST_SHA = 'f'.repeat(40);

// One impostor plays every part: a GitHub release (flat bundle.json under /releases/latest/download) and a
// TrinityOne relay (/status). It logs what it was asked.
let host = null; const asked = []; let hostile = false;
before(async () => {
  host = await H.startImpostor({
    name: 'code-source',
    handler: (req, res, url) => {
      asked.push(url.pathname);
      // `hostile`: the same sha with every other field the wrong type — what a mis-edited code source can serve
      if (url.pathname === '/releases/latest/download/bundle.json') return H.sendJson(res, hostile ? { tag: { x: 1 }, sha: LATEST_SHA, builtAt: 12345 } : { tag: 'relay-v9.9.9', sha: LATEST_SHA, sha256: 'a'.repeat(64), size: 1, builtAt: '2026-09-21T00:00:00+00:00', publishedAt: '2026-09-21T01:00:00Z' });
      if (url.pathname === '/status') return H.sendJson(res, { ok: true, version: 'e'.repeat(40), versionShort: 'eeeeeee', builtAt: '2026-09-20T00:00:00Z' });
      res.writeHead(404); res.end('nothing here');
    },
  });
});
after(() => H.stopAll());

async function startBox({ codeSource = null, origin = null } = {}) {
  const port = await H.freePort('code-source-box');
  const dir = mkdtempSync(join(tmpdir(), 'trin-codesrc-'));
  if (codeSource !== null) writeFileSync(join(dir, 'code-source'), codeSource + '\n');
  if (origin !== null) writeFileSync(join(dir, 'origin'), origin + '\n');
  const proc = spawn(process.execPath, [join(ROOT, 'scripts', 'gateway.mjs'), String(port)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TRINITY_DATA_DIR: dir, RELAY_SYNC: '0' },
  });
  let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
  const base = 'http://127.0.0.1:' + port;
  let up = false;
  for (let i = 0; i < 100 && !up; i++) { await sleep(200); try { up = (await fetch(base + '/status')).ok; } catch {} }
  assert.ok(up, 'the gateway never answered /status\n' + log);
  const token = JSON.parse(readFileSync(join(dir, 'admin.json'), 'utf8')).token || '';
  const auth = { Authorization: 'Bearer ' + token };
  return {
    proc, dir, base, port, auth,
    get: async (p) => { const r = await fetch(base + p, { headers: auth, cache: 'no-store' }); return { status: r.status, body: await r.json() }; },
    post: async (p) => { const r = await fetch(base + p, { method: 'POST', headers: auth }); return { status: r.status, body: await r.json() }; },
    stop() { try { proc.kill('SIGKILL'); } catch {} rmSync(dir, { recursive: true, force: true }); },
  };
}

// ── §1 · one rule, two languages ─────────────────────────────────────────────────────────────────────────

test('gateway.mjs releaseBundleBase gives the same answer as the shell release_bundle_base, input for input', () => {
  const gw = readFileSync(join(ROOT, 'scripts', 'gateway.mjs'), 'utf8');
  const from = gw.indexOf('function releaseBundleBase(src) {');
  assert.notEqual(from, -1, 'releaseBundleBase is gone from gateway.mjs — /update no longer knows the two shapes');
  const to = gw.indexOf('\n}\n', from);
  const js = new Function('src', gw.slice(gw.indexOf('{', from) + 1, to));
  const inst = readFileSync(join(ROOT, 'relay-app', 'install.sh'), 'utf8');
  const a = inst.indexOf('# ── release_bundle_base ──'), b = inst.indexOf('# ── end release_bundle_base ──', a);
  assert.ok(a > -1 && b > -1, 'release_bundle_base is gone from install.sh');
  const shell = (src) => spawnSync('bash', ['-c', inst.slice(a, b) + '\nrelease_bundle_base ' + JSON.stringify(src)], { encoding: 'utf8' }).stdout.trim();
  const inputs = [
    'https://github.com/TrinityOneAdmin/TrinityOne/releases/latest/download',
    'https://github.com/TrinityOneAdmin/TrinityOne/releases/latest/download/',
    'https://github.com/TrinityOneAdmin/TrinityOne/releases/download/relay-v0.9.0',
    'https://github.com/TrinityOneAdmin/TrinityOne/releases/download/relay-v0.9.0-rc1/',
    'https://app.trinityone.church', 'https://app.trinityone.church/', 'http://192.168.1.20:8000', 'http://127.0.0.1:' + host.port,
    'https://example.org/releases/download', 'https://example.org/releases/latest',
  ];
  for (const i of inputs) assert.equal(js(i), shell(i), 'the two rules disagree on ' + i);
});

// ── §2 · the gateway asks the code source, and lets an update be queued without an origin ────────────────

test('GET /update reads bundle.json from a GitHub-shaped code source, reports it, and POST /update needs no origin', async () => {
  const box = await startBox({ codeSource: host.base + '/releases/latest/download' });
  try {
    asked.length = 0;
    const u = await box.get('/update');
    assert.equal(u.status, 200);
    assert.equal(u.body.codeSource, host.base + '/releases/latest/download', 'GET /update does not report the code source');
    assert.equal(u.body.origin, '', 'a box with no origin file reported one');
    assert.ok(u.body.latest, 'no latest — the code source was not asked, or bundle.json was not understood: ' + JSON.stringify(u.body));
    assert.equal(u.body.latest.version, LATEST_SHA, 'latest.version is not the sha bundle.json names');
    assert.equal(u.body.latest.tag, 'relay-v9.9.9', 'latest.tag is not the release bundle.json names');
    assert.ok(asked.includes('/releases/latest/download/bundle.json'), 'bundle.json was not fetched flat from the release: ' + asked.join(', '));
    assert.ok(!asked.includes('/status'), 'a GitHub-shaped source was asked /status, which a release does not have');
    const p = await box.post('/update');
    assert.equal(p.status, 200, 'POST /update was refused on a box whose code source is set and origin is not: ' + JSON.stringify(p.body));
    assert.ok(existsSync(join(box.dir, '.update-request')), 'the update flag was not written');
    // and the installer fetch is still refused — the installers have nowhere to come from
    const f = await box.post('/relay-app/fetch-apk');
    assert.equal(f.status, 400, 'fetch-apk did not refuse with no origin');
    // bundle.json is an unsigned description: every field but sha is typed on the way in, because the panel
    // calls .slice on builtAt and a number there threw inside loadUpdate and left the software card blank
    hostile = true;
    try {
      const h = await box.get('/update');
      assert.equal(h.body.latest && h.body.latest.version, LATEST_SHA, 'a well-formed sha beside ill-typed fields was dropped');
      assert.equal(typeof h.body.latest.builtAt, 'string', 'latest.builtAt passed through as a ' + typeof h.body.latest.builtAt);
      assert.equal(typeof h.body.latest.tag, 'string', 'latest.tag passed through as a ' + typeof h.body.latest.tag);
    } finally { hostile = false; }
  } finally { box.stop(); }
});

test('a relay-shaped code source is asked /status; a box with no code-source file asks its origin, as before', async () => {
  const relaySrc = await startBox({ codeSource: host.base, origin: 'http://127.0.0.1:9' });
  try {
    asked.length = 0;
    const u = await relaySrc.get('/update');
    assert.equal(u.body.latest && u.body.latest.version, 'e'.repeat(40), 'a relay-shaped code source did not yield its /status version: ' + JSON.stringify(u.body.latest));
    assert.ok(asked.includes('/status') && !asked.some((p) => /bundle\.json$/.test(p)), 'a relay-shaped source was not asked /status (or was asked for bundle.json): ' + asked.join(', '));
  } finally { relaySrc.stop(); }
  const legacy = await startBox({ origin: host.base });
  try {
    asked.length = 0;
    const u = await legacy.get('/update');
    assert.equal(u.body.codeSource, '', 'a box with no code-source file reported one');
    assert.equal(u.body.latest && u.body.latest.version, 'e'.repeat(40), 'with no code source the origin was not asked /status');
    assert.ok(asked.includes('/status'), 'the origin was not asked: ' + asked.join(', '));
  } finally { legacy.stop(); }
});

// ── §3 · THE SCREEN ──────────────────────────────────────────────────────────────────────────────────────

test('the panel: code from a release, no origin → a new build is named, "Update now" is live, the installer button is not', { skip: NO_CHROME, timeout: 120000 }, async () => {
  const box = await startBox({ codeSource: host.base + '/releases/latest/download' });
  const cdp = await H.freePort('chromium debug port');
  const prof = join(tmpdir(), 'trin-codesrc-chr-' + process.pid);
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9, MAP github.com 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD,
    `--user-data-dir=${prof}`, '--window-size=1280,1200', box.base + '/relay-app/control.html'], { stdio: 'ignore' });
  try {
    let targets = null;
    for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
    assert.ok(targets && targets.length, 'chromium never exposed a debug target');
    const page = targets.find((t) => t.type === 'page') || targets[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    let id = 0; const pend = new Map();
    ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Runtime.enable');
    await sleep(6000);
    const rr = await send('Runtime.evaluate', { returnByValue: true, expression: `JSON.stringify({
      software: (document.getElementById('u-body') || {}).innerText,
      updateBtn: (() => { const b = document.getElementById('doUpdate'); return b ? { disabled: b.disabled, text: b.innerText } : null; })(),
      installerBtn: (() => { const b = document.getElementById('fetchApk'); return b ? { disabled: b.disabled } : null; })(),
      originField: (document.getElementById('originIn') || {}).value,
    })` });
    ws.close();
    const v = JSON.parse(rr.result.result.value);
    assert.match(v.software, /new build is available/, 'the software card does not say a new build is out: ' + v.software);
    assert.match(v.software, /relay-v9\.9\.9/, 'the card does not name the release bundle.json describes: ' + v.software);
    assert.ok(v.software.includes(host.base + '/releases/latest/download'), 'the card does not say where the software comes from: ' + v.software);
    assert.doesNotMatch(v.software, /never told/, 'the card says the box was never told where to get things from — it was, for its code');
    assert.ok(v.updateBtn && v.updateBtn.disabled === false, '"Update now" is missing or disabled on a box whose code source is set');
    assert.equal(v.originField, '', 'the update-source field is not empty on a box with no origin');
    assert.ok(v.installerBtn && v.installerBtn.disabled === true, 'the installer button is live although the installers have nowhere to come from');
  } finally {
    try { chr.kill('SIGKILL'); } catch {}
    box.stop();
    try { rmSync(prof, { recursive: true, force: true }); } catch {}
  }
});
