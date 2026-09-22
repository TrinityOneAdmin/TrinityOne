// A RELAY IS TOLD WHERE TO GET THINGS FROM — AND SAYS SO WHEN IT HAS NOT BEEN.
// Run: node --test scripts/a-suite-relay-is-told-where-to-get-things-from.test.mjs
//
// THE FINDING (owner's Ubuntu box, 2026-09-19; reference/BACKLOG.md "A Suite-installed relay has NO update
// source at all"). gateway.mjs read its update source from DATA_DIR/origin, and the only writer of that file
// was relay-app/install.sh. A relay installed from the desktop Suite therefore had none, and its control panel
// read — reproduced headless against 3a8c980 before anything here was written:
//
//     installer card:  "This box holds no installer yet, so there is nothing for members to install.
//                       Press “Update the installer now”."        ← the button was LIVE
//     after pressing:  "✗ this relay has no origin to fetch from"
//     software card:   "This is the release source — nothing to pull here."   ← false: it is a Suite
//
// The action offered, the precondition never mentioned, and a sentence that is true of one machine on earth
// shown on every other. Three things fix it, and each has a test here that fails if it is deleted from the
// SCREEN, not only from the engine (CLAUDE.md rule 1):
//
//   §1  the update source is a live setting: shown, settable from the panel (POST /settings {origin}), in use
//       at once with no restart, refused when it is not an http(s) origin;
//   §2  a packaged Suite arrives with one — scripts/build-relay-payload.sh stamps ROOT/release-origin, the
//       gateway seeds DATA_DIR/origin from it on first boot only, and the same file marks the tree as a
//       payload whose code updates with the Suite rather than through relay-update.sh;
//   §3  the panel, in a real browser: with no source both buttons are DISABLED with the reason on screen and
//       the field empty; set a source → both come alive and the installer fetches from it; a packaged relay
//       says its software moves with the Suite and offers no "Update now".
//
// Rule 3: relay-app/control.js ships unbundled, so nothing here matches its text — §3 drives the shipped page
// in Chromium and reads the DOM. No test here reaches the network: every origin is a server this file spawns.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, cpSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import * as H from './relay-network-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find((p) => existsSync(p));
const NO_CHROME = CHROME ? false : 'no chromium on this box';

// The release host: two installers and a status, the three things a box asks its update source for.
const APK = Buffer.alloc(1_100_000, 0x61);
let origin = null;
before(async () => {
  origin = await H.startImpostor({
    name: 'release-host',
    handler: (req, res, url) => {
      if (url.pathname === '/apk-latest.json') return H.sendJson(res, { versionCode: 300, versionName: '1.2.3', date: '2026-09-21' });
      if (url.pathname === '/status') return H.sendJson(res, { ok: true, version: 'f'.repeat(40), versionShort: 'fffffff', builtAt: '2026-09-21T00:00:00Z' });
      if (url.pathname === '/trinityone.apk' || url.pathname === '/trinityone-steward.apk') {
        res.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': APK.length });
        if (req.method === 'HEAD') { res.end(); return; }
        res.end(APK); return;
      }
      res.writeHead(404); res.end('nothing here');
    },
  });
});
after(() => H.stopAll());

// A box started by hand: H.startRelay writes `origin` itself, and "no origin" is the whole subject here.
// `root` lets §2 boot the gateway from a scratch tree that carries a release-origin seed.
async function startBox({ dataDir = null, root = ROOT } = {}) {
  const port = await H.freePort('origin-box');
  const dir = dataDir || mkdtempSync(join(tmpdir(), 'trin-origin-'));
  const proc = spawn(process.execPath, [join(root, 'scripts', 'gateway.mjs'), String(port)], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TRINITY_DATA_DIR: dir, RELAY_SYNC: '0' },
  });
  let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
  const base = 'http://127.0.0.1:' + port;
  let up = false;
  for (let i = 0; i < 100 && !up; i++) { await sleep(200); try { up = (await fetch(base + '/status')).ok; } catch {} }
  assert.ok(up, 'the gateway never answered /status\n' + log);
  const token = JSON.parse(readFileSync(join(dir, 'admin.json'), 'utf8')).token || '';
  const auth = { Authorization: 'Bearer ' + token };
  const box = {
    proc, dir, base, port, auth, log: () => log,
    get: async (p) => { const r = await fetch(base + p, { headers: auth, cache: 'no-store' }); return { status: r.status, body: await r.json() }; },
    post: async (p, body) => { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json() }; },
    stop() { try { proc.kill('SIGKILL'); } catch {} },
  };
  return box;
}
const originFile = (box) => join(box.dir, 'origin');

// ── §1 · the update source is a live, settable, validated setting ────────────────────────────────────────

test('a box with no origin refuses both fetches with the same sentence, and the panel can read that it has none', async () => {
  const box = await startBox();
  try {
    assert.ok(!existsSync(originFile(box)), 'precondition: a fresh data dir has no origin file');
    const u = await box.get('/update');
    assert.equal(u.body.origin, '', 'GET /update did not report an empty origin');
    assert.equal(u.body.packaged, false, 'a git checkout reported itself as a packaged Suite');
    assert.equal(u.body.releaseHost, false, 'a box with no release key claimed to be the release host');
    const s = await box.get('/settings');
    assert.equal(s.body.origin, '', 'GET /settings does not carry the origin, so the panel has nothing to show in the field');
    const a = await box.get('/relay-app/apk-status');
    assert.equal(a.body.origin, '', 'apk-status did not say the box has no origin');
    for (const [p, body] of [['/update', undefined], ['/relay-app/fetch-apk', undefined]]) {
      const r = await box.post(p, body);
      assert.equal(r.status, 400, p + ' did not refuse with no origin');
      assert.match(r.body.error, /never told where to get things from/,
        p + ' refused with the old sentence — the operator must be told the precondition, not the mechanism');
    }
  } finally { box.stop(); rmSync(box.dir, { recursive: true, force: true }); }
});

test('setting the origin from the panel takes effect at once — no restart — and the installer then fetches from it', async () => {
  const box = await startBox();
  try {
    // trailing slash is normalised away: every reader appends fixed paths to this
    const set = await box.post('/settings', { origin: origin.base + '/' });
    assert.equal(set.status, 200, 'the save was refused: ' + JSON.stringify(set.body));
    assert.equal(set.body.origin, origin.base, 'the reply does not carry the normalised origin the box now holds');
    assert.equal(readFileSync(originFile(box), 'utf8').trim(), origin.base,
      'the origin was not written to DATA_DIR/origin — the one file install.sh and relay-update.sh read');
    // LIVE. The same process, no restart, every reader sees the new value.
    assert.equal((await box.get('/update')).body.origin, origin.base, '/update still reads the boot-time value');
    assert.equal((await box.get('/settings')).body.origin, origin.base, '/settings still reads the boot-time value');
    const st = await box.get('/relay-app/apk-status');
    assert.equal(st.body.origin, origin.base, 'apk-status still reads the boot-time value');
    assert.equal(st.body.originReachable, true, 'the box did not go and ask the new origin what it offers');
    const f = await box.post('/relay-app/fetch-apk');
    assert.equal(f.status, 200, 'the installer fetch failed against the freshly set origin: ' + JSON.stringify(f.body));
    assert.equal((await box.get('/relay-app/apk-status')).body.holding, 2, 'the box is not holding both installers after the fetch');
    // and the software-update check reads the origin's /status, again without a restart
    const u = await box.get('/update');
    assert.equal(u.body.latest && u.body.latest.versionShort, 'fffffff', '/update did not ask the new origin which build it offers');
  } finally { box.stop(); rmSync(box.dir, { recursive: true, force: true }); }
});

test('an origin that is not an http(s) origin is refused whole, and nothing else in the request is applied', async () => {
  const box = await startBox();
  try {
    for (const bad of ['javascript:alert(1)', 'ftp://files.example', 'https://user:pw@host.example', 'https://host.example/some/path', 'https://host.example/?q=1', 'not a url', 'x'.repeat(201)]) {
      const r = await box.post('/settings', { origin: bad, keepApkCurrent: true });
      assert.equal(r.status, 400, JSON.stringify(bad) + ' was accepted as an update source');
      assert.match(r.body.error, /web address/, 'the refusal for ' + JSON.stringify(bad) + ' does not say what shape is needed');
    }
    assert.ok(!existsSync(originFile(box)), 'a refused origin still wrote the file');
    const s = await box.get('/settings');
    assert.notEqual(s.body.settings.keepApkCurrent, true, 'a setting sent in the same request as a refused origin was applied anyway');
  } finally { box.stop(); rmSync(box.dir, { recursive: true, force: true }); }
});

test('clearing the origin leaves an EMPTY file, so the box reads as "told: nothing" rather than "never told"', async () => {
  const box = await startBox();
  try {
    assert.equal((await box.post('/settings', { origin: origin.base })).status, 200);
    const c = await box.post('/settings', { origin: '' });
    assert.equal(c.status, 200, 'clearing was refused');
    assert.equal(c.body.origin, '', 'the reply still carries an origin after clearing');
    assert.ok(existsSync(originFile(box)), 'clearing deleted the file — a packaged relay would then re-seed it on the next boot');
    assert.equal(readFileSync(originFile(box), 'utf8').trim(), '', 'the file is not empty after clearing');
    assert.equal((await box.get('/update')).body.origin, '', '/update still reads the cleared value');
  } finally { box.stop(); rmSync(box.dir, { recursive: true, force: true }); }
});

// ── §2 · a packaged Suite arrives with one ───────────────────────────────────────────────────────────────
// A scratch tree that looks like a Suite payload: the gateway and what it imports, the control panel, the
// runtime deps, and the one file build-relay-payload.sh stamps — release-origin. A git checkout never has
// that file (.gitignore), which is what keeps every other test's gateway off the network.

function packagedTree(seed) {
  const root = mkdtempSync(join(tmpdir(), 'trin-payload-'));
  mkdirSync(join(root, 'scripts'));
  for (const f of readdirSync(join(ROOT, 'scripts'))) if (f.endsWith('.mjs') && !f.includes('.test.')) cpSync(join(ROOT, 'scripts', f), join(root, 'scripts', f));
  cpSync(join(ROOT, 'relay-app'), join(root, 'relay-app'), { recursive: true, filter: (p) => !p.includes('/desktop') });
  symlinkSync(join(ROOT, 'node_modules'), join(root, 'node_modules'));
  writeFileSync(join(root, 'version.txt'), 'a'.repeat(40) + '\n2026-09-21T00:00:00+00:00\n');
  writeFileSync(join(root, 'release-origin'), seed + '\n');
  return root;
}

test('a packaged relay seeds DATA_DIR/origin from release-origin on its FIRST boot, and only then', async () => {
  const root = packagedTree(origin.base);
  let box = await startBox({ root });
  const dir = box.dir;
  try {
    assert.equal(readFileSync(join(dir, 'origin'), 'utf8').trim(), origin.base,
      'a packaged relay booted with an empty data dir and wrote no origin — this is the owner\'s Ubuntu box exactly');
    const u = await box.get('/update');
    assert.equal(u.body.origin, origin.base, '/update does not read the seeded origin');
    assert.equal(u.body.packaged, true, 'a tree carrying release-origin did not report itself as packaged');
    const p = await box.post('/update');
    assert.equal(p.status, 400, 'a packaged relay queued an update flag that nothing on a Suite consumes');
    assert.match(p.body.error, /TrinityOne Suite/, 'the refusal does not say the software moves with the Suite');
    assert.equal((await box.post('/relay-app/fetch-apk')).status, 200, 'the seeded origin is not usable for the installer fetch');
    // SECOND BOOT, ORIGIN CLEARED BY THE OPERATOR: the seed must not come back.
    box.stop();
    writeFileSync(join(dir, 'origin'), '');
    box = await startBox({ root, dataDir: dir });
    assert.equal((await box.get('/update')).body.origin, '', 'a cleared origin was re-seeded on the next boot — the operator\'s decision did not stick');
  } finally { box.stop(); rmSync(dir, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

test('the seed the payload build stamps is the app origin install.sh defaults to — one host hands out the apps, two routes', () => {
  const build = readFileSync(join(ROOT, 'scripts', 'build-relay-payload.sh'), 'utf8');
  const m = build.match(/\$\{RELEASE_ORIGIN:-([^}]+)\}"?\s*>\s*"\$OUT\/release-origin"/);
  assert.ok(m, 'build-relay-payload.sh no longer stamps release-origin into the payload — a Suite would boot with no update source again');
  const install = readFileSync(join(ROOT, 'relay-app', 'install.sh'), 'utf8');
  // Since 2026-09-21 install.sh's SRC= is where the CODE comes from (a GitHub release); the host the
  // installers come from is APP_ORIGIN_DEFAULT, and that is what a Suite's seed must match.
  const s = install.match(/^APP_ORIGIN_DEFAULT="([^"]+)"/m);
  assert.ok(s, 'install.sh has no APP_ORIGIN_DEFAULT= to compare against');
  assert.equal(m[1], s[1], 'the Suite\'s seed and the installer\'s default app origin name different hosts');
  assert.match(m[1], /^https:\/\/[a-z0-9.-]+$/, 'the seed is not a bare https origin');
  assert.match(readFileSync(join(ROOT, '.gitignore'), 'utf8'), /^\/release-origin$/m,
    'release-origin is not gitignored — committed, it would make every checkout read as a packaged Suite');
});

// ── §3 · THE SCREEN ──────────────────────────────────────────────────────────────────────────────────────

async function openPanel(box, cdp, fn) {
  const prof = join(tmpdir(), 'trin-origin-chr-' + process.pid + '-' + box.port);
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
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
    const evalIn = async (expression) => {
      const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      return rr && rr.result && rr.result.result ? rr.result.result.value : undefined;
    };
    // what the operator sees, read from the live DOM
    const read = async () => JSON.parse(await evalIn(`JSON.stringify({
      originField: (document.getElementById('originIn') || {}).value,
      originMsg: (document.getElementById('originMsg') || {}).innerText,
      software: (document.getElementById('u-body') || {}).innerText,
      updateBtn: (() => { const b = document.getElementById('doUpdate'); return b ? { disabled: b.disabled, text: b.innerText } : null; })(),
      installer: (document.getElementById('apkHeld') || {}).innerText,
      installerBtn: (() => { const b = document.getElementById('fetchApk'); return b ? { disabled: b.disabled, text: b.innerText } : null; })(),
      installerMsg: (document.getElementById('apkMsg') || {}).innerText,
    })`));
    try { await fn({ evalIn, read }); } finally { ws.close(); }
  } finally { try { chr.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} }
}

test('with no source the panel DISABLES both buttons and says why; set one and both come alive', { skip: NO_CHROME, timeout: 120000 }, async () => {
  const box = await startBox();
  const cdp = await H.freePort('chromium debug port');
  try {
    await openPanel(box, cdp, async ({ evalIn, read }) => {
      await sleep(6000);
      let v = await read();
      assert.equal(v.originField, '', 'the update-source field is not empty on a box that has none');
      assert.ok(v.installerBtn, 'the "Update the installer now" button is not on the page');
      assert.equal(v.installerBtn.disabled, true,
        'the installer button is LIVE on a box with no update source — the owner pressed exactly this and got "✗ this relay has no origin to fetch from"');
      assert.match(v.installer, /never told where to get things from/,
        'the installer card does not say the precondition; it used to say "Press Update the installer now" instead');
      assert.doesNotMatch(v.installer, /Press “Update the installer now”/, 'the card still instructs the operator to press a button that cannot work');
      assert.ok(v.updateBtn, 'the software card offers no "Update now" control at all — it should be there, disabled, with the reason');
      assert.equal(v.updateBtn.disabled, true, '"Update now" is live on a box with nowhere to pull from');
      assert.match(v.software, /never told where to get things from/, 'the software card does not say the precondition');
      assert.doesNotMatch(v.software, /release source/, 'the software card still claims this box is the release source');

      // the operator types the address and saves
      await evalIn(`(() => { const i = document.getElementById('originIn'); i.value = ${JSON.stringify(origin.base)}; document.getElementById('originSave').click(); })()`);
      await sleep(4000);
      v = await read();
      assert.match(v.originMsg, /✓ saved/, 'saving the source did not confirm on screen: ' + v.originMsg);
      assert.match(v.originMsg, /no restart/, 'the confirmation does not tell the operator that no restart is needed');
      assert.equal(v.originField, origin.base, 'the field does not show the address the box now holds');
      assert.equal(v.installerBtn.disabled, false, 'the installer button is still disabled after a source was set');
      assert.doesNotMatch(v.installer, /never told/, 'the installer card still says the box was never told, after it was');
      assert.ok(!v.updateBtn || v.updateBtn.disabled === false, '"Update now" is still disabled after a source was set');
      assert.doesNotMatch(v.software, /never told/, 'the software card still says the box was never told, after it was');

      // and the button that was dead now does its job, against the source just set
      await evalIn(`document.getElementById('fetchApk').click()`);
      await sleep(5000);
      v = await read();
      assert.match(v.installerMsg, /^✓/, 'pressing "Update the installer now" did not succeed: ' + v.installerMsg);
      assert.match(v.installer, /Members can install from this box/, 'the card does not say members can now install');
    });
  } finally { box.stop(); rmSync(box.dir, { recursive: true, force: true }); }
});

test('a packaged relay shows its seeded source, says its software moves with the Suite, and offers no "Update now"', { skip: NO_CHROME, timeout: 120000 }, async () => {
  const root = packagedTree(origin.base);
  const box = await startBox({ root });
  const cdp = await H.freePort('chromium debug port');
  try {
    await openPanel(box, cdp, async ({ read }) => {
      await sleep(6000);
      const v = await read();
      assert.equal(v.originField, origin.base, 'the panel does not show the source the Suite arrived with');
      assert.match(v.software, /TrinityOne Suite/, 'the software card does not say this relay updates with the Suite');
      assert.equal(v.updateBtn, null, 'a packaged relay offers "Update now", which queues a flag nothing on a Suite consumes');
      assert.doesNotMatch(v.software, /release source/, 'a Suite is told it is the release source');
      assert.ok(v.installerBtn && v.installerBtn.disabled === false, 'the installer button is disabled although the Suite arrived with a source');
    });
  } finally { box.stop(); rmSync(box.dir, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});
