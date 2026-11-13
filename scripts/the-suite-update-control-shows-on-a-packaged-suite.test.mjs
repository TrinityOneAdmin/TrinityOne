// The "Keep the Suite up to date automatically" control must actually APPEAR on a packaged Suite's relay panel,
// and must be live once it does. Run: node --test scripts/the-suite-update-control-shows-on-a-packaged-suite.test.mjs
//
// Audit AUDIT-integration-all-1aa19150 LOW 3. The packaged-Suite branch of loadUpdate in relay-app/control.js
// is where the suite-autoupdate and relay-panel branches clashed. It reveals #suiteAutoBlock and calls
// wireSuiteAutoUpdate. scripts/suite-autoupdate-ui.test.mjs lifts only wireSuiteAutoUpdate, so deleting the two
// lines in loadUpdate left every test green (CLAUDE.md rule 1).
//
// This runs the REAL control.html + control.js in headless Chromium against a REAL gateway booted from a scratch
// tree that carries `release-origin` — the one file that makes a gateway a packaged Suite (gateway.mjs PACKAGED;
// the same tree a-suite-relay-is-told-where-to-get-things-from.test.mjs builds). Nothing is matched against
// control.js text (rule 3). Every outbound address is blackholed and SUITE_UPDATE_BASE points at a dead port, so
// turning the toggle on cannot reach GitHub.
//
//   1. On a packaged Suite, Settings shows the control, and switching it on saves and writes the marker the Rust
//      shell reads (DATA_DIR/suite-autoupdate) — i.e. loadUpdate both revealed it and wired it.
//   2. Control case: on a plain checkout (not packaged) the same page keeps it hidden — so test 1 can tell.
// Skips without chromium.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, cpSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { freePort } from './relay-network-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const DEAD = 'http://127.0.0.1:9';

const BLACKHOLE = `const real = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const u = String(input && input.url ? input.url : input);
  if (/trinityone\\.church|\\.ts\\.net|trycloudflare|github/i.test(u)) return Promise.reject(new Error('blackholed by test: ' + u));
  return real.call(this, input, init);
};\n`;

// A scratch tree shaped like a Suite payload: the gateway and what it imports, the control panel, the runtime
// deps, and release-origin (stamped by build-relay-payload.sh; gitignored, so a checkout never has it).
function packagedTree() {
  const root = mkdtempSync(join(tmpdir(), 'trin-suite-panel-payload-'));
  mkdirSync(join(root, 'scripts'));
  for (const f of readdirSync(join(ROOT, 'scripts'))) if (f.endsWith('.mjs') && !f.includes('.test.')) cpSync(join(ROOT, 'scripts', f), join(root, 'scripts', f));
  cpSync(join(ROOT, 'relay-app'), join(root, 'relay-app'), { recursive: true, filter: (p) => !p.includes('/desktop') });
  if (existsSync(join(ROOT, 'vendor', 'fonts'))) cpSync(join(ROOT, 'vendor', 'fonts'), join(root, 'vendor', 'fonts'), { recursive: true });
  symlinkSync(join(ROOT, 'node_modules'), join(root, 'node_modules'));
  writeFileSync(join(root, 'version.txt'), 'a'.repeat(40) + '\n2026-09-21T00:00:00+00:00\n');
  writeFileSync(join(root, 'release-origin'), DEAD + '\n');
  return root;
}

const cleanups = [];
after(() => { for (const f of cleanups.reverse()) { try { f(); } catch {} } });

async function startGateway(root) {
  const port = await freePort('the suite-update-control gateway');
  const dataDir = mkdtempSync(join(tmpdir(), 'trin-suite-panel-data-'));
  const preload = join(dataDir, 'blackhole.mjs');
  writeFileSync(preload, BLACKHOLE);
  const proc = spawn(process.execPath, [join(root, 'scripts/gateway.mjs'), String(port)], {
    cwd: root, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_SYNC: '0', RELAY_HOST: '127.0.0.1', RELAY_NO_OPEN: '1',
      RELAY_DIRECTORY: DEAD, SUITE_UPDATE_BASE: DEAD, TRINITY_TAILSCALE_BIN: '/nonexistent/tailscale', NODE_OPTIONS: '--import ' + preload },
  });
  const stop = () => { try { proc.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} };
  cleanups.push(stop);
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 200 && !up; i++) { try { up = (await fetch(base + '/status')).ok; } catch {} if (!up) await sleep(150); }
  assert.ok(up, 'the gateway never served /status');
  const token = JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token;
  const get = async (p) => (await fetch(base + p, { headers: { Authorization: 'Bearer ' + token } })).json();
  return { base, dataDir, get, stop };
}

async function startChrome(base) {
  const cdp = await freePort('the suite-update-control Chrome debug port');
  const prof = mkdtempSync(join(tmpdir(), 'trin-suite-panel-chrome-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9, MAP github.com 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD,
    `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
  const stop = () => { try { chr.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} };
  cleanups.push(stop);
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  cleanups.push(() => ws.close());
  let id = 0; const pend = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr && rr.result && rr.result.exceptionDetails) throw new Error('the page threw: ' + JSON.stringify(rr.result.exceptionDetails).slice(0, 300));
    return rr && rr.result && rr.result.result ? rr.result.result.value : undefined;
  };
  // open the panel on Settings (where the Updates card lives), first-run wizard dismissed
  await send('Page.navigate', { url: base + '/relay-app/control.html' }); await sleep(600);
  await evalIn(`localStorage.setItem('to_relay_setup_seen','1'); sessionStorage.setItem('to_relay_setup_skipped','1'); localStorage.setItem('trinityone.relay.tab','set')`);
  await send('Page.navigate', { url: base + '/relay-app/control.html' });
  return { evalIn, stop };
}
const waitFor = async (c, expr, want, ms = 15000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await c.evalIn(expr); if (want(v)) return v; await sleep(300); } return v; };

// What a person sees: is #suiteAutoBlock laid out on screen, and is the Settings tab the open one?
const BLOCK_STATE = `JSON.stringify((() => {
  const b = document.getElementById('suiteAutoBlock'), r = b ? b.getBoundingClientRect() : null;
  return { exists: !!b, display: b ? getComputedStyle(b).display : null, h: r ? r.height : 0,
    setOpen: document.getElementById('panel-set').hidden === false,
    body: (document.getElementById('u-body') || {}).textContent || '',
    card: getComputedStyle(document.getElementById('updateCard')).display };
})())`;

const skip = !CHROME ? 'no chromium' : false;

test('1: on a packaged Suite, Settings shows the auto-update control, and switching it on saves it and writes the shell\'s marker',
  { skip, timeout: 120000 }, async () => {
  const root = packagedTree(); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const gw = await startGateway(root);
  assert.equal((await gw.get('/update')).packaged, true, 're-anchor: the scratch tree did not boot as a packaged Suite');
  const c = await startChrome(gw.base);
  // re-anchor: the packaged branch of loadUpdate has run (its sentence is in the Updates card)
  const body = await waitFor(c, `(document.getElementById('u-body') || {}).textContent || ''`, v => /TrinityOne Suite/.test(v));
  assert.match(body, /TrinityOne Suite/, 're-anchor: loadUpdate never took the packaged-Suite branch');
  const s = JSON.parse(await c.evalIn(BLOCK_STATE));
  assert.equal(s.setOpen, true, 're-anchor: the Settings tab is not the open one');
  assert.notEqual(s.display, 'none', 'THE CONTROL IS HIDDEN on a packaged Suite: loadUpdate no longer reveals #suiteAutoBlock');
  assert.ok(s.h > 0, `the auto-update control takes no space on screen (height ${s.h})`);

  // ...and it is live: a real click on the switch saves through /settings and writes DATA_DIR/suite-autoupdate,
  // the file the Rust shell polls. Before the click: off, no marker.
  assert.equal(await c.evalIn(`document.getElementById('suiteAutoToggle').checked`), false, 're-anchor: the switch starts on');
  assert.ok(!existsSync(join(gw.dataDir, 'suite-autoupdate')), 're-anchor: the marker exists before anyone switched it on');
  await c.evalIn(`document.getElementById('suiteAutoToggle').click()`);
  let saved = false;
  for (let i = 0; i < 40 && !saved; i++) { saved = (await gw.get('/settings')).settings.autoUpdate === true; if (!saved) await sleep(250); }
  assert.equal(saved, true, 'switching it on did not save — loadUpdate showed the control but never wired it (wireSuiteAutoUpdate)');
  assert.equal(readFileSync(join(gw.dataDir, 'suite-autoupdate'), 'utf8').trim(), '03:00', 'the shell\'s marker was not written with the apply time');
  assert.equal(await waitFor(c, `document.getElementById('suiteAutoToggle').disabled`, v => v === false), false, 'the switch was left disabled after saving');
});

test('2: control case — on a plain checkout (not a Suite) the same page keeps the control hidden', { skip, timeout: 90000 }, async () => {
  const gw = await startGateway(ROOT);
  assert.equal((await gw.get('/update')).packaged, false, 're-anchor: the checkout booted as a packaged Suite');
  const c = await startChrome(gw.base);
  // wait until loadUpdate has filled the Updates card (non-packaged sentence), so "hidden" is a result, not a race
  const card = await waitFor(c, `getComputedStyle(document.getElementById('updateCard')).display`, v => v && v !== 'none');
  assert.notEqual(card, 'none', 're-anchor: the Updates card never rendered');
  await waitFor(c, `(document.getElementById('u-body') || {}).textContent || ''`, v => v.length > 0);
  const s = JSON.parse(await c.evalIn(BLOCK_STATE));
  assert.equal(s.exists, true, 're-anchor: #suiteAutoBlock is not in the page');
  assert.equal(s.display, 'none', 'the Suite auto-update control shows on a box that is not a Suite');
});
