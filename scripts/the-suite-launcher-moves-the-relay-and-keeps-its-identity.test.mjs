// THE SUITE LAUNCHER MOVES THE RELAY, AND THE RELAY KEEPS ITS IDENTITY — the real launcher, driven end to end.
// Run: node --test scripts/the-suite-launcher-moves-the-relay-and-keeps-its-identity.test.mjs
//
// Relay storage plan step 5 (obligations §8c). What runs for real here:
//   * the LAUNCHER: relay-app/desktop/launcher/src/lib.rs, built and run as target/debug/launcher-sim — the same
//     run() the Tauri app calls, hosted by a plain child process instead of the window (src/bin/launcher-sim.rs).
//   * the RELAY: scripts/gateway.mjs, spawned by the launcher with the env the launcher chose (suite mode, pinned,
//     storage state), through a thin wrapper that records how it was started.
//   * the MOVER: scripts/relay-move.mjs, run by the launcher through its CLI (the Suite runs it with the bundled Node).
//   * the CARD: the real relay-app/control.html in headless Chromium; the test presses Move and Remove old copy.
// What is NOT real: the Tauri window (progress is read from the lines the sim prints, and the splash page is opened in
// Chromium with the fragment the launcher built); the bundled Node sidecar (the host's node is used); a Mac/Windows
// drive. Those are the step-7 device checks.
// A cross-DRIVE move needs a second filesystem: the test finds one (TRIN_TEST_OTHER_FS=/dir overrides) and skips that
// one test with a message if the machine has only one. No assertion reads control.js / main.rs source text (rule 3).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync, accessSync, renameSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { freePort } from './relay-network-harness.mjs';
import { openStore } from './event-store.mjs';
import { moveRelayData, jsonPointer, jsonFieldStore } from './relay-move.mjs';
import { verifyRelayIdentity } from '../src/relay-identity.src.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LAUNCHER_DIR = join(ROOT, 'relay-app/desktop/launcher');
const SIM = join(LAUNCHER_DIR, 'target/debug/launcher-sim');
const SPLASH = join(ROOT, 'relay-app/desktop/src-tauri/dist/index.html');
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let simSkip = false;
try { execFileSync('cargo', ['build', '--offline', '--quiet', '--bin', 'launcher-sim'], { cwd: LAUNCHER_DIR, stdio: 'pipe', timeout: 240000 }); }
catch (e) { simSkip = 'cargo could not build the launcher: ' + String(e.stderr || e.message).slice(0, 200); }
const skip = simSkip;
const skipBrowser = simSkip || (!CHROME ? 'no chromium' : false);

const cleanups = [];
after(() => { for (const f of cleanups.reverse()) { try { f(); } catch {} } });

// ── a place on ANOTHER filesystem, so a move is a real copy ────────────────────────────────────────────────
function otherFsDir() {
  const here = statSync(tmpdir()).dev;
  for (const c of [process.env.TRIN_TEST_OTHER_FS, '/mnt/storage', '/var/tmp', '/dev/shm'].filter(Boolean)) {
    try {
      if (statSync(c).dev === here) continue;
      accessSync(c, constants.W_OK);
      if (c.startsWith('/dev')) continue;   // the mover refuses system folders, /dev among them
      const d = mkdtempSync(join(c, 'trin-launcher-drive-')); cleanups.push(() => rmSync(d, { recursive: true, force: true })); return d;
    } catch {}
  }
  return null;
}

const WRAPPER = `import { appendFileSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
const env = process.env;
let st = {}; try { st = JSON.parse(readFileSync(env.TRINITY_STORAGE_STATE, 'utf8')); } catch {}
const mv = st.move || {};
appendFileSync(env.TEST_STARTS_LOG, JSON.stringify({ dir: env.TRINITY_DATA_DIR, pinned: env.TRINITY_DATA_DIR_PINNED || '', mode: env.TRINITY_STORAGE_MODE, hasState: !!env.TRINITY_STORAGE_STATE,
  state: mv.state || null, preStart: !!mv.preStartCounts, at: Date.now() }) + '\\n');
if (env.TEST_EXIT_CODE) process.exit(Number(env.TEST_EXIT_CODE));
if (env.TEST_HANG_DIR && env.TEST_HANG_DIR === env.TRINITY_DATA_DIR) { setInterval(() => {}, 1000); await new Promise(() => {}); }   // a relay that stays alive and never opens its port
if (env.TEST_SLOW_START_MS) await new Promise(r => setTimeout(r, Number(env.TEST_SLOW_START_MS)));
if (env.TEST_NO_PROOF) {   // a relay that serves its panel but cannot answer /relay-identity
  const http = await import('node:http'); const { syncBuiltinESMExports } = await import('node:module');
  const orig = http.default.createServer;
  http.default.createServer = (...a) => { const sv = orig(...a); const emit = sv.emit; sv.emit = function (ev, req, res, ...r) { if (ev === 'request' && req.url.startsWith('/relay-identity')) { res.writeHead(404); res.end(); return true; } return emit.call(this, ev, req, res, ...r); }; return sv; };
  syncBuiltinESMExports();
}
if (env.TEST_EXIT0_FIRST && !existsSync(env.TEST_EXIT0_FIRST)) { writeFileSync(env.TEST_EXIT0_FIRST, '1'); process.exit(0); }
if (env.TEST_LOOKALIKE_DIR && env.TEST_LOOKALIKE_DIR === env.TRINITY_DATA_DIR) {
  // a program on the relay's port that says the right key in /status and cannot prove it
  const pub = JSON.parse(readFileSync(env.TRINITY_DATA_DIR + '/relay-key.json', 'utf8')).pub;
  createServer((req, res) => { if (req.url.startsWith('/status')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, relayPub: pub, counts: { events: Number(env.TEST_LOOKALIKE_EVENTS || 0) } })); } else { res.writeHead(404); res.end(); } }).listen(Number(process.argv[2]), '127.0.0.1');
} else {
  await import(pathToFileURL(env.TEST_GATEWAY).href);
}
`;
const PRELOAD = `const real = globalThis.fetch;
globalThis.fetch = function (input, init) { const u = String(input && input.url ? input.url : input); if (/trinityone\\.church|\\.ts\\.net|trycloudflare|github\\.com/i.test(u)) return Promise.reject(new Error('blackholed by test: ' + u)); return real.call(this, input, init); };
`;

function fixture({ events = 25, key = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'trin-launcher-'));
  cleanups.push(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, 'home'); mkdirSync(home);
  const data = join(base, 'appdata', 'data'); mkdirSync(data, { recursive: true });
  const sk = generateSecretKey(), pub = getPublicKey(sk);
  if (key) writeFileSync(join(data, 'relay-key.json'), JSON.stringify({ sk: Buffer.from(sk).toString('hex'), pub }));
  writeFileSync(join(data, 'blob.bin'), Buffer.alloc(200000, 3));
  if (events) {
    const st = openStore(join(data, 'relay.sqlite'), { maxEvents: 500 });
    const author = generateSecretKey(), t0 = Math.floor(Date.now() / 1000) - 3600;
    for (let i = 0; i < events; i++) st.put(finalizeEvent({ kind: 1, created_at: t0 + i, tags: [], content: 'record ' + i }, author), '');
    st.close();
  }
  writeFileSync(join(base, 'wrapper.mjs'), WRAPPER); writeFileSync(join(base, 'preload.mjs'), PRELOAD);
  return { base, home, data, pub, events, state: join(base, 'cfg', 'storage.json'), starts: join(base, 'starts.log') };
}
const startsOf = fx => existsSync(fx.starts) ? readFileSync(fx.starts, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const stateOf = fx => { try { return JSON.parse(readFileSync(fx.state, 'utf8')); } catch { return {}; } };

// ── the launcher, running ──────────────────────────────────────────────────────────────────────────────────
async function startLauncher(fx, { env = {}, port, upSteps = 160, extra = [] } = {}) {
  port = port || await freePort('the launcher test relay');
  const args = ['--config-file', fx.state, '--default-data', fx.data, '--payload', ROOT, '--node', process.execPath, '--port', String(port),
    '--gateway', join(fx.base, 'wrapper.mjs'), '--up-steps', String(upSteps), '--log-file', join(fx.base, 'relay-launch.log'), ...extra];
  const E = { RELAY_SYNC: '0', RELAY_DIRECTORY: 'http://127.0.0.1:9', TRINITY_TAILSCALE_BIN: '/nonexistent/tailscale', NODE_OPTIONS: '--import ' + join(fx.base, 'preload.mjs'),
    HOME: fx.home, USER: 'nobody-launcher-test', TEST_STARTS_LOG: fx.starts, TEST_GATEWAY: join(ROOT, 'scripts/gateway.mjs'), ...env };
  for (const [k, v] of Object.entries(E)) args.push('--env', `${k}=${v}`);
  const proc = spawn(SIM, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const l = { port, base: `http://127.0.0.1:${port}`, proc, lines: [], log: '', ended: null, pids: [] };
  let buf = '';
  proc.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); l.lines.push(line); const m = /^SIM relay-pid (\d+)/.exec(line); if (m) l.pids.push(Number(m[1])); } });
  proc.stderr.on('data', d => { l.log += d; });
  l.exited = new Promise(res => proc.on('exit', c => { l.ended = c; res(c); }));
  l.count = re => l.lines.filter(x => re.test(x)).length;
  l.waitFor = async (re, n = 1, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (l.count(re) >= n) return true; await sleep(150); } return false; };
  l.stop = async () => { try { proc.stdin.end(); } catch {} await Promise.race([l.exited, sleep(6000)]); try { proc.kill('SIGKILL'); } catch {} for (const p of l.pids) { try { process.kill(p, 'SIGKILL'); } catch {} } };
  cleanups.push(() => { try { proc.kill('SIGKILL'); } catch {} for (const p of l.pids) { try { process.kill(p, 'SIGKILL'); } catch {} } });
  return l;
}
const tokenOf = dir => JSON.parse(readFileSync(join(dir, 'admin.json'), 'utf8')).token;
async function events(l, dir) { const s = await (await fetch(l.base + '/status', { headers: { Authorization: 'Bearer ' + tokenOf(dir) } })).json(); return s.counts && s.counts.events; }
const proven = l => verifyRelayIdentity(`ws://127.0.0.1:${l.port}/relay`);
const post = (l, dir, path, body) => fetch(l.base + path, { method: 'POST', headers: { Authorization: 'Bearer ' + tokenOf(dir), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, j: await r.json().catch(() => ({})) }));
const getStorage = (l, dir) => fetch(l.base + '/storage', { headers: { Authorization: 'Bearer ' + tokenOf(dir) } }).then(r => r.json());
const frag = lines => { const l = [...lines].reverse().find(x => x.startsWith('SIM progress ')); return l ? l.slice('SIM progress '.length) : null; };
const decodeFrag = f => Object.fromEntries(f.replace(/^#/, '').split('&').map(kv => { const i = kv.indexOf('='); return [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))]; }));
const treeSize = d => { let n = 0; for (const e of readdirSync(d, { withFileTypes: true })) n += e.isDirectory() ? treeSize(join(d, e.name)) : 1; return n; };

// ── a headless browser ─────────────────────────────────────────────────────────────────────────────────────
async function startChrome(width = 1280) {
  const cdp = await freePort('the launcher test Chrome debug port');
  const prof = mkdtempSync(join(tmpdir(), 'trin-launcher-chrome-'));
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9', `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
  let ws = null;
  const stop = () => { try { ws && ws.close(); } catch {} try { chr.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} };
  cleanups.push(stop);
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  ws = new WebSocket((targets.find(t => t.type === 'page') || targets[0]).webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', d => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  const evalIn = async expression => { const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (rr && rr.result && rr.result.exceptionDetails) throw new Error('the page threw: ' + JSON.stringify(rr.result.exceptionDetails).slice(0, 300)); return rr && rr.result && rr.result.result ? rr.result.result.value : undefined; };
  const open = async (base, tab) => {
    await send('Page.navigate', { url: base + '/relay-app/control.html' }); await sleep(600);
    await evalIn(`localStorage.setItem('to_relay_setup_seen','1'); sessionStorage.setItem('to_relay_setup_skipped','1'); localStorage.setItem('trinityone.relay.tab','${tab}')`);
    await send('Page.navigate', { url: base + '/relay-app/control.html' }); await sleep(400);
  };
  const goto = async url => { await send('Page.navigate', { url }); await sleep(500); };
  return { evalIn, open, goto, stop };
}
const waitFor = async (c, expr, want, ms = 20000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await c.evalIn(expr); if (want(v)) return v; await sleep(250); } return v; };
const shown = id => `(() => { const e = document.getElementById('${id}'); return !!e && e.checkVisibility(); })()`;
const text = sel => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; })()`;

// ═══ 1. THE CARD, THE LAUNCHER, THE MOVER, THE RELAY ═══════════════════════════════════════════════════════
test('press Move on the card: the launcher moves the data, checks the copy, restarts the relay on the new folder with the same PROVEN identity and the same events; Remove old copy removes it', { skip: skipBrowser, timeout: 300000 }, async (t) => {
  const drive = otherFsDir();
  if (!drive) { t.skip('this machine has one filesystem: a cross-drive copy cannot be driven (set TRIN_TEST_OTHER_FS)'); return; }
  const fx = fixture({ events: 25 }); fx.home = join(drive, 'home'); mkdirSync(fx.home);
  const target = join(fx.home, 'trinityone-relay');
  const l = await startLauncher(fx);
  const c = await startChrome(1280);
  try {
    assert.equal(await l.waitFor(/^SIM opened /), true, 'the launcher never opened the relay. Log:\n' + l.log);
    assert.equal(startsOf(fx).length, 1);
    assert.equal(startsOf(fx)[0].mode, 'suite'); assert.equal(startsOf(fx)[0].hasState, true);
    assert.deepEqual((await proven(l)).relayPub, fx.pub);

    // the steward's side: pick the drive, press Move twice
    await c.open(l.base, 'set');
    assert.equal(await waitFor(c, shown('storageCard'), v => v === true), true, 'the storage card never appeared');
    await c.evalIn(`document.getElementById('stPick').click()`);
    await waitFor(c, `!!document.querySelector('#stList input[name="stDrive"]:not([disabled])')`, v => v === true);
    await c.evalIn(`(() => { const i = [...document.querySelectorAll('#stList input[name="stDrive"]')].find(x => x.value === ${JSON.stringify(fx.home)}); i.click(); })()`);
    await sleep(300);
    await c.evalIn(`(() => { const a = document.getElementById('stAck'); if (a && !a.checked) a.click(); })()`);
    await waitFor(c, `document.getElementById('stMove').disabled`, v => v === false);
    await c.evalIn(`document.getElementById('stMove').click()`);
    await waitFor(c, text('#stMove'), v => /Confirm/.test(v || ''));
    await c.evalIn(`document.getElementById('stMove').click()`);

    // THE LAUNCHER'S WORK: the relay stops itself; the launcher moves, checks, restarts
    assert.equal(await l.waitFor(/^SIM opened /, 2, 120000), true, 'the relay never came back after the move. Log:\n' + l.log + '\n' + JSON.stringify(stateOf(fx)));
    const starts = startsOf(fx);
    assert.equal(starts.length, 2, 'the relay was started ' + starts.length + ' times');
    assert.equal(starts[1].dir, target, 'the relay was restarted on ' + starts[1].dir + ', not on the new folder');
    assert.equal(starts[1].pinned, '1', 'the relay on the new folder was not started pinned');
    // beginCheck BEFORE the spawn: when the relay on the new folder started, the journal already said "checking"
    // with the pre-start counts
    assert.equal(starts[1].state, 'checking', 'the relay was spawned before beginCheck ran (journal said ' + starts[1].state + ')');
    assert.equal(starts[1].preStart, true);
    const moving = l.lines.findIndex(x => /^SIM progress #t=Moving/.test(x)), checking = l.lines.findIndex(x => /^SIM progress #t=Checking/.test(x));
    assert.ok(moving >= 0 && checking > moving, 'the splash was not told "Moving…" then "Checking…": ' + l.lines.join(' | '));

    // SAME IDENTITY (proven, not the /status string), SAME RECORDS, data physically in the new folder
    const p = await proven(l);
    assert.ok(p, 'the restarted relay could not prove an identity'); assert.equal(p.relayPub, fx.pub, 'the relay on the new folder PROVES a different key');
    assert.equal(await events(l, target), 25, 'the relay on the new folder holds a different number of events');
    assert.ok(existsSync(join(target, 'relay.sqlite')) && existsSync(join(target, 'blob.bin')));
    assert.ok(existsSync(join(fx.data, 'MOVED-TO')), 'the old copy is not marked MOVED-TO');
    assert.equal(existsSync(join(fx.data, '.move-request')), false); assert.equal(existsSync(join(target, '.move-request')), false);
    const st = stateOf(fx);
    assert.equal(st.dataDir, target); assert.equal(st.relayPub, fx.pub);
    assert.equal(st.move.state, 'awaiting-confirm'); assert.ok(st.move.oldCopy && st.move.oldCopy.since, 'oldCopy.since was not kept for the 7-day reminder');
    const since = st.move.oldCopy.since;

    // every start: the launcher is closed and opened again; the relay is on the new folder, the same proven identity,
    // and the reminder's clock has not moved
    await l.stop();
    const l2 = await startLauncher(fx, { port: l.port });
    assert.equal(await l2.waitFor(/^SIM opened /), true, 'the second launch never opened the relay. Log:\n' + l2.log);
    assert.equal(startsOf(fx).at(-1).dir, target, 'after a restart the relay did not start on the pointer\'s folder');
    assert.equal((await proven(l2)).relayPub, fx.pub);
    assert.equal(stateOf(fx).move.oldCopy.since, since, 'oldCopy.since moved when the launcher restarted');
    assert.equal(stateOf(fx).launcher && stateOf(fx).launcher.identityChanged, undefined, 'a matching identity raised a warning');

    // the card: outcome + Remove old copy; press it twice; the launcher removes ONLY the recorded old copy
    await c.open(l2.base, 'set');
    await waitFor(c, shown('storageCard'), v => v === true);
    const res = await waitFor(c, text('#stResult'), v => !!v && /now keeps/.test(v));
    assert.match(res, /Same relay, same records — 25 events checked\./, res);
    await waitFor(c, shown('stRemoveOld'), v => v === true);
    await c.evalIn(`document.getElementById('stRemoveOld').click()`);
    await waitFor(c, text('#stRemoveOld'), v => /Remove the old copy\?/.test(v || ''));
    await c.evalIn(`document.getElementById('stRemoveOld').click()`);
    const t0 = Date.now();
    while (Date.now() - t0 < 30000 && readdirSync(fx.data).some(n => n !== 'MOVED-TO')) await sleep(300);
    assert.deepEqual(readdirSync(fx.data), ['MOVED-TO'], 'Remove old copy did not remove the old copy (the launcher never acted on the request)');
    assert.equal(existsSync(join(target, '.remove-old-request')), false, 'the removal request was left behind');
    const after = stateOf(fx);
    assert.equal(after.move.state, 'done'); assert.ok(after.move.oldCopyRemovedAt);
    // the live folder is whole and still serving
    assert.equal(await events(l2, target), 25); assert.equal((await proven(l2)).relayPub, fx.pub);
    await c.open(l2.base, 'set');
    await waitFor(c, shown('storageCard'), v => v === true);
    assert.equal(await waitFor(c, shown('stRemoveOld'), v => v === false, 8000), false, 'the card still offers Remove old copy after it was removed');
  } finally { c.stop(); await l.stop(); }
});

test('a SAME-DRIVE move: instant rename, the launcher restarts the relay on the new folder, same proven identity and events, no old copy', { skip, timeout: 200000 }, async () => {
  const fx = fixture({ events: 12 });
  const target = join(fx.home, 'trinityone-relay');
  const l = await startLauncher(fx);
  try {
    assert.equal(await l.waitFor(/^SIM opened /), true, l.log);
    const r = await post(l, fx.data, '/storage/move', { drive: fx.home });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.j.sameDrive, true);
    assert.equal(await l.waitFor(/^SIM opened /, 2, 90000), true, 'the relay never came back. Log:\n' + l.log + JSON.stringify(stateOf(fx)));
    assert.equal(startsOf(fx)[1].dir, target); assert.equal(startsOf(fx)[1].state, 'checking');
    assert.equal((await proven(l)).relayPub, fx.pub);
    assert.equal(await events(l, target), 12);
    assert.deepEqual(readdirSync(fx.data), ['MOVED-TO'], 'a same-drive move left more than a tombstone');
    const st = stateOf(fx); assert.equal(st.move.state, 'done'); assert.equal(st.move.mode, 'rename');
    const g = await getStorage(l, target); assert.equal(g.oldCopy, null, 'a same-drive move offers an old copy');
  } finally { await l.stop(); }
});

// ═══ 2. A REFUSED MOVE: recorded where the card can read it, and NEVER asked for again ════════════════════════
test('a refused move is recorded in storage.json and GET /storage, the relay restarts on the old folder, and .move-request is never re-created', { skip, timeout: 150000 }, async () => {
  const fx = fixture({ events: 7 });
  // the relay stops with exit 0 and a request that names a drive that is not there (the first start only)
  writeFileSync(join(fx.data, '.move-request'), JSON.stringify({ drive: join(fx.base, 'no-such-drive'), target: '/etc/evil', from: '/root', relayPub: fx.pub, requestedAt: new Date().toISOString() }));
  const l = await startLauncher(fx, { env: { TEST_EXIT0_FIRST: join(fx.base, 'first-done') } });
  try {
    assert.equal(await l.waitFor(/^SIM opened /, 1, 90000), true, 'the relay never opened after the refused move. Log:\n' + l.log + JSON.stringify(stateOf(fx)));
    const starts = startsOf(fx);
    assert.equal(starts.length, 2, 'expected exactly two starts (the one that stopped, and the restart), got ' + starts.length);
    assert.equal(starts[1].dir, fx.data, 'after a refusal the relay must run on the old folder');
    // never re-created, not even later
    await sleep(3000);
    assert.equal(existsSync(join(fx.data, '.move-request')), false, 'a .move-request exists after the move was refused');
    assert.equal(startsOf(fx).length, 2, 'the launcher kept starting the relay');
    const ref = stateOf(fx).launcher.lastRefusal;
    assert.equal(ref.kind, 'move'); assert.ok(/drive-missing|target-/.test(ref.code), JSON.stringify(ref));
    // where the card reads it: GET /storage
    const g = await getStorage(l, fx.data);
    assert.equal(g.launcher.lastRefusal.code, ref.code, 'GET /storage does not carry the refusal: ' + JSON.stringify(g.launcher));
    assert.equal(g.current.path, fx.data); assert.deepEqual((await proven(l)).relayPub, fx.pub); assert.equal(await events(l, fx.data), 7);
    assert.equal(stateOf(fx).dataDir, undefined, 'a refused move moved the pointer');
  } finally { await l.stop(); }
});

test('the card shows a refused move and a changed identity (read off the rendered page)', { skip: skipBrowser, timeout: 150000 }, async () => {
  const fx = fixture({ events: 3 });
  writeFileSync(join(fx.data, '.move-request'), JSON.stringify({ drive: join(fx.base, 'no-such-drive') }));
  // a recorded key that is not this relay's -> identityChanged too
  mkdirSync(join(fx.base, 'cfg'), { recursive: true }); writeFileSync(fx.state, JSON.stringify({ relayPub: 'ab'.repeat(32) }));
  const l = await startLauncher(fx, { env: { TEST_EXIT0_FIRST: join(fx.base, 'first-done') } });
  const c = await startChrome(1280);
  try {
    assert.equal(await l.waitFor(/^SIM opened /, 1, 90000), true, l.log);
    await c.open(l.base, 'set');
    await waitFor(c, shown('storageCard'), v => v === true);
    assert.match(await waitFor(c, text('#stLauncherRefusal'), v => !!v), /The move was refused, so nothing was changed\./);
    assert.match(await waitFor(c, text('#stIdentityChanged'), v => !!v), /This relay is not the one it was before\./);
  } finally { c.stop(); await l.stop(); }
});

// ═══ 3. THE GATEWAY REFUSES TO START: the splash says why ════════════════════════════════════════════════════
test('exit 78 (the relay\'s drive is not connected): no restart loop, nothing created, and the splash page SHOWS the gateway\'s reason', { skip: skipBrowser, timeout: 120000 }, async () => {
  const fx = fixture({ events: 2 });
  const gone = join(fx.base, 'unplugged-drive', 'trinityone-relay');   // the pointer names a folder whose drive is not there
  mkdirSync(join(fx.base, 'cfg'), { recursive: true }); writeFileSync(fx.state, JSON.stringify({ dataDir: gone, relayPub: fx.pub }));
  const l = await startLauncher(fx);
  const c = await startChrome(900);
  try {
    assert.equal(await l.waitFor(/^SIM end /, 1, 60000), true, 'the launcher never ended. Log:\n' + l.log + l.lines.join('\n'));
    assert.match(l.lines.find(x => x.startsWith('SIM end ')), /Refused/);
    assert.equal(l.count(/^SIM opened /), 0, 'a page was opened for a relay that refused to run');
    assert.equal(startsOf(fx).length, 1, 'the launcher restarted a relay that refused to start');
    assert.equal(existsSync(gone), false, 'the missing drive\'s folder was created');
    const f = frag(l.lines); assert.ok(f, 'the launcher told the splash nothing');
    const m = decodeFrag(f);
    assert.equal(m.k, 'bad'); assert.match(m.s, /data folder is missing/); assert.match(m.s, /Reconnect the drive/);
    // THE SPLASH PAGE: open the shell's own dist/index.html with that fragment and read what a person would read
    await c.goto(pathToFileURL(SPLASH).href + f);
    assert.equal(await c.evalIn(text('#title')), "Your relay didn't start");
    assert.match(await c.evalIn(text('#sub')), /data folder is missing[\s\S]*Reconnect the drive/);
    assert.equal(await c.evalIn(`document.getElementById('card').classList.contains('bad')`), true);
    await sleep(2500);   // the page's own "relay is running" probe must not overwrite it
    assert.equal(await c.evalIn(text('#title')), "Your relay didn't start", 'the splash probe replaced the refusal with "running"');
    assert.equal(stateOf(fx).launcher.lastRefusal.kind, 'start');
  } finally { c.stop(); await l.stop(); }
});

// ═══ 4. EVERY START: the proven key against the recorded one ═════════════════════════════════════════════════
test('every start: a relay that proves a different key than the one recorded is flagged (GET /storage), a matching one is not, and an unprovable one is never trusted', { skip, timeout: 200000 }, async () => {
  const fx = fixture({ events: 4 });
  // (a) recorded key is someone else's
  mkdirSync(join(fx.base, 'cfg'), { recursive: true }); writeFileSync(fx.state, JSON.stringify({ relayPub: 'cd'.repeat(32) }));
  let l = await startLauncher(fx);
  try {
    assert.equal(await l.waitFor(/^SIM opened /), true, l.log);
    const g = await getStorage(l, fx.data);
    assert.equal(g.launcher.identityChanged.expectedPub, 'cd'.repeat(32)); assert.equal(g.launcher.identityChanged.provenPub, fx.pub);
  } finally { await l.stop(); }
  // (b) now the record is right -> the warning clears
  writeFileSync(fx.state, JSON.stringify({ ...stateOf(fx), relayPub: fx.pub }));
  l = await startLauncher(fx);
  try {
    assert.equal(await l.waitFor(/^SIM opened /), true, l.log);
    assert.equal(stateOf(fx).launcher.identityChanged, undefined, 'a matching proof did not clear the warning');
  } finally { await l.stop(); }
  // (c) something answers on the port with the RIGHT key in /status and no proof: flagged, not trusted
  l = await startLauncher(fx, { env: { TEST_LOOKALIKE_DIR: fx.data, TEST_LOOKALIKE_EVENTS: '4' } });
  try {
    assert.equal(await l.waitFor(/^SIM opened /), true, l.log);
    const ic = stateOf(fx).launcher.identityChanged;
    assert.ok(ic && ic.provenPub === null, 'a program that only copies /status was accepted as the relay: ' + JSON.stringify(ic));
  } finally { await l.stop(); }
});

// ═══ 5. THE CHECK AFTER A MOVE ROLLS BACK ═════════════════════════════════════════════════════════════════════
async function realCopyMove(fx, drive) {   // the mover, by hand, as the launcher would have run it just before being killed
  const pointer = jsonPointer(fx.state), journal = jsonFieldStore(fx.state, 'move');
  const to = join(drive, 'trinityone-relay');
  const exdev = () => { throw Object.assign(new Error('x'), { code: 'EXDEV' }); };
  const mv = await moveRelayData({ from: fx.data, to, pointer, journal, relayRunning: async () => false, mode: 'suite', rename: exdev, codeDir: ROOT });
  assert.equal(mv.ok, true, JSON.stringify(mv));
  return to;
}
test('beginCheck runs BEFORE the spawn and exactly: a new folder that holds more events than the move recorded is rolled back — the relay is never started on it', { skip, timeout: 150000 }, async () => {
  const fx = fixture({ events: 6 });
  const newdir = await realCopyMove(fx, fx.home);
  // someone put an extra record into the new folder after the move (and before the relay ever ran there)
  const st = openStore(join(newdir, 'relay.sqlite'), { maxEvents: 500 });
  st.put(finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'extra' }, generateSecretKey()), ''); st.close();
  const l = await startLauncher(fx);
  try {
    assert.equal(await l.waitFor(/^SIM opened /, 1, 90000), true, 'the relay never opened. Log:\n' + l.log + JSON.stringify(stateOf(fx)));
    const starts = startsOf(fx);
    assert.equal(starts[0].dir, fx.data, 'the relay was started on a folder whose pre-start check failed (' + starts[0].dir + ')');
    assert.equal(starts.filter(s => s.dir === newdir).length, 0);
    assert.equal(stateOf(fx).move.state, 'rolled-back'); assert.equal(stateOf(fx).dataDir, fx.data);
    assert.equal((await proven(l)).relayPub, fx.pub); assert.equal(await events(l, fx.data), 6);
    assert.equal(existsSync(join(fx.data, 'MOVED-TO')), false, 'the old folder is still marked moved after a rollback');
  } finally { await l.stop(); }
});

test('the identity proof: a relay on the new folder that says the right key in /status but cannot PROVE it is rolled back, not accepted', { skip, timeout: 150000 }, async () => {
  const fx = fixture({ events: 6 });
  const newdir = await realCopyMove(fx, fx.home);
  const l = await startLauncher(fx, { env: { TEST_LOOKALIKE_DIR: newdir, TEST_LOOKALIKE_EVENTS: '6' } });
  try {
    assert.equal(await l.waitFor(/^SIM opened /, 1, 90000), true, 'the relay never opened. Log:\n' + l.log + JSON.stringify(stateOf(fx)));
    const starts = startsOf(fx);
    assert.equal(starts[0].dir, newdir, 'the look-alike was started on the new folder (that is the scenario)');
    assert.equal(starts.at(-1).dir, fx.data, 'after the failed check the relay must run on the OLD folder');
    assert.equal(stateOf(fx).move.state, 'rolled-back', 'a relay that could not prove its identity was confirmed: ' + stateOf(fx).move.state);
    assert.equal((await proven(l)).relayPub, fx.pub);
  } finally { await l.stop(); }
});

// ═══ 6. REMOVING THE OLD COPY ═════════════════════════════════════════════════════════════════════════════════
test('remove-old: a path the journal did not record is refused and left alone', { skip, timeout: 120000 }, async () => {
  const fx = fixture({ events: 2 });
  const notes = join(fx.base, 'my-documents'); mkdirSync(notes); writeFileSync(join(notes, 'MOVED-TO'), 'x'); writeFileSync(join(notes, 'thesis.doc'), 'precious');
  writeFileSync(join(fx.data, '.remove-old-request'), JSON.stringify({ path: notes, kind: 'old-copy', relayPub: fx.pub }));
  const l = await startLauncher(fx);
  try {
    assert.equal(await l.waitFor(/^SIM opened /), true, l.log);
    await sleep(1500);
    assert.ok(existsSync(join(notes, 'thesis.doc')), 'a folder nobody recorded was deleted');
    assert.equal(existsSync(join(fx.data, '.remove-old-request')), false, 'the request was left behind');
    assert.equal(stateOf(fx).launcher.lastRefusal.code, 'not-recorded');
  } finally { await l.stop(); }
});

test('remove-old re-checks at the moment of deletion: a recorded old copy that has become the LIVE folder, or a link to it, is refused and the live data survives', { skip, timeout: 120000 }, async () => {
  for (const variant of ['live', 'link-to-live']) {
    const fx = fixture({ events: 3 });
    let recorded = fx.data;
    if (variant === 'link-to-live') { recorded = join(fx.base, 'old-copy'); (await import('node:fs')).symlinkSync(fx.data, recorded); }
    // the journal says "the old copy is <recorded>" (as it did when the button was pressed); by now that path IS the live folder
    mkdirSync(join(fx.base, 'cfg'), { recursive: true });
    writeFileSync(fx.state, JSON.stringify({ move: { state: 'awaiting-confirm', mode: 'copy', from: recorded, to: fx.data, relayPub: fx.pub, oldCopy: { path: recorded, since: new Date().toISOString() } } }));
    writeFileSync(join(fx.data, '.remove-old-request'), JSON.stringify({ path: recorded, kind: 'old-copy', relayPub: fx.pub }));
    const l = await startLauncher(fx);
    try {
      assert.equal(await l.waitFor(/^SIM opened /, 1, 60000), true, variant + ': ' + l.log);
      await sleep(1500);
      assert.ok(existsSync(join(fx.data, 'relay.sqlite')) && existsSync(join(fx.data, 'relay-key.json')) && existsSync(join(fx.data, 'blob.bin')), variant + ': the LIVE folder was deleted');
      assert.equal(await events(l, fx.data), 3, variant);
      const ref = stateOf(fx).launcher && stateOf(fx).launcher.lastRefusal;
      assert.ok(ref && ref.kind === 'remove-old', variant + ': ' + JSON.stringify(stateOf(fx).launcher));
      // refused for the RIGHT reason: the live-folder / link check, not merely for lacking a marker
      assert.equal(ref.code, variant === 'live' ? 'current-folder' : 'target-is-a-link', variant);
    } finally { await l.stop(); }
  }
});

// ═══ 7. CRASH RECOVERY at launch ══════════════════════════════════════════════════════════════════════════════
test('crash recovery: a move killed mid-copy leaves a partial copy; the next launch removes it and starts the relay on the OLD folder', { skip, timeout: 120000 }, async () => {
  const fx = fixture({ events: 5 });
  const partial = join(fx.home, 'trinityone-relay'); mkdirSync(partial, { recursive: true });
  writeFileSync(join(partial, '.trinity-move-incomplete'), 'x'); writeFileSync(join(partial, 'blob.bin'), 'half');
  mkdirSync(join(fx.base, 'cfg'), { recursive: true });
  writeFileSync(fx.state, JSON.stringify({ dataDir: fx.data, relayPub: fx.pub, move: { state: 'copying', mode: 'copy', from: fx.data, to: partial, relayPub: fx.pub, counts: { events: 5, deletions: 0, meta: 0 }, startedAt: new Date().toISOString() } }));
  const l = await startLauncher(fx);
  try {
    assert.equal(await l.waitFor(/^SIM opened /, 1, 60000), true, l.log + JSON.stringify(stateOf(fx)));
    assert.equal(existsSync(partial), false, 'the partial copy was left on the drive');
    assert.equal(startsOf(fx)[0].dir, fx.data);
    assert.equal(stateOf(fx).move.state, 'failed');
    assert.equal(await events(l, fx.data), 5);
  } finally { await l.stop(); }
});

// ═══ 8. AUDIT C: M4 (mover lock), M5 (slow start, non-78 exit), L1 (unproven wording) ═══════════════════════
const MOVER_CLI = join(ROOT, 'scripts/relay-move.mjs');
// a live process whose command line names relay-move.mjs, standing in for a mover that outlived its launcher
function fakeMover() { const p = spawn(process.execPath, ['-e', 'setTimeout(()=>{},120000)', 'relay-move.mjs'], { stdio: 'ignore' }); cleanups.push(() => { try { p.kill('SIGKILL'); } catch {} }); return p; }
const lockFile = fx => fx.state + '.mover-lock';
function holdLock(fx, p) { mkdirSync(join(fx.base, 'cfg'), { recursive: true }); writeFileSync(lockFile(fx), JSON.stringify({ pid: p.pid, startedAt: new Date().toISOString() })); }
const fragsOf = lines => lines.filter(x => x.startsWith('SIM progress ')).map(x => decodeFrag(x.slice('SIM progress '.length)));

test('M4: a second mover is refused while one holds the lock, and moves nothing', { skip, timeout: 60000 }, async () => {
  const fx = fixture({ events: 3 });
  const h = fakeMover(); holdLock(fx, h); await sleep(300);
  const r = spawnSync(process.execPath, [MOVER_CLI, 'move', '--from', fx.data, '--drive', fx.home, '--pointer', fx.state, '--port', String(await freePort('m4')), '--mode', 'suite'], { encoding: 'utf8' });
  const a = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(a.ok, false); assert.equal(a.code, 'mover-running', JSON.stringify(a));
  assert.ok(existsSync(join(fx.data, 'relay.sqlite')) && !existsSync(join(fx.home, 'trinityone-relay')), 'a second mover moved the data');
  // a dead holder is stale: the lock is taken over
  h.kill('SIGKILL'); await sleep(500);
  const r2 = spawnSync(process.execPath, [MOVER_CLI, 'lock-status', '--pointer', fx.state], { encoding: 'utf8' });
  assert.equal(JSON.parse(r2.stdout.trim().split('\n').pop()).held, false, 'a dead mover still holds the lock');
});

test('M4: a launcher that finds a mover still running WAITS (says so, starts nothing, recovers nothing) and carries on when it is gone', { skip, timeout: 120000 }, async () => {
  const fx = fixture({ events: 3 });
  const h = fakeMover(); holdLock(fx, h); await sleep(300);
  const l = await startLauncher(fx);
  try {
    await sleep(4000);
    assert.equal(startsOf(fx).length, 0, 'the relay was started while a mover held the folder');
    assert.ok(fragsOf(l.lines).some(f => /^Moving/.test(f.t)), 'the splash was told nothing while the launcher waited: ' + l.lines.join('|'));
    h.kill('SIGKILL');
    assert.equal(await l.waitFor(/^SIM opened /, 1, 60000), true, 'the launcher never carried on after the mover went. Log:\n' + l.log);
    assert.equal(startsOf(fx).length, 1);
  } finally { await l.stop(); }
});

test('M4: the window is closed mid-move (the launcher dies, the mover lives on); the next launch waits for it, then checks the move and starts on the new folder with the same identity', { skip, timeout: 280000 }, async (t) => {
  const drive = otherFsDir();
  if (!drive) { t.skip('needs a second filesystem'); return; }
  const fx = fixture({ events: 9 }); fx.home = join(drive, 'home'); mkdirSync(fx.home);
  writeFileSync(join(fx.data, 'big.bin'), Buffer.alloc(500 * 1024 * 1024, 7));   // long enough to kill the launcher in the middle
  const target = join(fx.home, 'trinityone-relay');
  const l = await startLauncher(fx);
  assert.equal(await l.waitFor(/^SIM opened /), true, l.log);
  assert.equal((await post(l, fx.data, '/storage/move', { drive: fx.home })).status, 200);
  assert.equal(await l.waitFor(/^SIM progress #t=Moving/, 1, 60000), true, 'the move never started');
  l.proc.kill('SIGKILL'); await l.exited;   // the app closes: the launcher is gone, its child mover is not
  for (const p of l.pids) { try { process.kill(p, 'SIGKILL'); } catch {} }
  const l2 = await startLauncher(fx, { port: l.port });
  try {
    assert.equal(await l2.waitFor(/^SIM opened /, 1, 200000), true, 'the second launch never opened the relay. Log:\n' + l2.log + JSON.stringify(stateOf(fx).move));
    const last = startsOf(fx).at(-1);
    assert.equal(last.dir, target, 'after the interrupted launcher the relay did not end up on the new folder: ' + JSON.stringify(startsOf(fx)));
    assert.equal(last.state, 'checking');
    assert.equal((await proven(l2)).relayPub, fx.pub); assert.equal(await events(l2, target), 9);
    assert.ok(existsSync(join(target, 'big.bin')), 'the big file did not arrive');
    assert.equal(existsSync(lockFile(fx)), false, 'the mover lock was left behind');
  } finally { await l2.stop(); }
});

test('M5: a slow start is never killed (the relay is given as long as it needs), and the splash says it is still starting', { skip, timeout: 120000 }, async () => {
  const fx = fixture({ events: 3 });
  const l = await startLauncher(fx, { env: { TEST_SLOW_START_MS: '4000' }, upSteps: 4 });   // gives up waiting after ~1 s, relay needs ~4 s
  try {
    assert.equal(await l.waitFor(/^SIM opened /, 1, 60000), true, 'a slow-starting relay was abandoned or killed. Log:\n' + l.log + l.lines.join('|'));
    assert.equal(startsOf(fx).length, 1, 'the relay was restarted');
    assert.ok(fragsOf(l.lines).some(f => /still starting/i.test(f.s)), 'the splash never said the start was slow: ' + l.lines.join('|'));
    assert.equal((await proven(l)).relayPub, fx.pub);
  } finally { await l.stop(); }
});

test('M5: a relay that exits at start-up with anything but 78 leaves a clear message with the log path (not a splash stuck on "Starting…")', { skip: skipBrowser, timeout: 90000 }, async () => {
  const fx = fixture({ events: 2 });
  const l = await startLauncher(fx, { env: { TEST_EXIT_CODE: '3' } });
  const c = await startChrome(900);
  try {
    assert.equal(await l.waitFor(/^SIM end /, 1, 60000), true, l.log);
    const f = fragsOf(l.lines).at(-1);
    assert.equal(f.k, 'bad'); assert.match(f.s, /exit 3|code 3/i); assert.ok(f.s.includes(join(fx.base, 'relay-launch.log')), 'the message does not name the log file: ' + f.s);
    await c.goto(pathToFileURL(SPLASH).href + frag(l.lines));
    assert.match(await c.evalIn(text('#sub')), /relay-launch\.log/); assert.notEqual(await c.evalIn(text('#title')), 'Starting your relay…');
  } finally { c.stop(); await l.stop(); }
});

test('L1: a relay whose proof only FAILED is shown as "couldn\'t prove", never as "a different identity key"; a really different key keeps the old wording', { skip: skipBrowser, timeout: 150000 }, async () => {
  const fx = fixture({ events: 2 });
  mkdirSync(join(fx.base, 'cfg'), { recursive: true }); writeFileSync(fx.state, JSON.stringify({ relayPub: fx.pub }));
  let l = await startLauncher(fx, { env: { TEST_NO_PROOF: '1' } });
  const c = await startChrome(1280);
  try {
    assert.equal(await l.waitFor(/^SIM opened /, 1, 60000), true, l.log);
    await c.open(l.base, 'set'); await waitFor(c, shown('storageCard'), v => v === true);
    const t1 = await waitFor(c, text('#stIdentityChanged'), v => !!v);
    assert.match(t1, /couldn't prove/i, t1); assert.doesNotMatch(t1, /different identity key/, 'a failed proof was described as a different key: ' + t1);
    await l.stop();
    writeFileSync(fx.state, JSON.stringify({ relayPub: 'ab'.repeat(32) }));
    l = await startLauncher(fx);
    assert.equal(await l.waitFor(/^SIM opened /, 1, 60000), true, l.log);
    await c.open(l.base, 'set'); await waitFor(c, shown('storageCard'), v => v === true);
    assert.match(await waitFor(c, text('#stIdentityChanged'), v => !!v), /different identity key/);
  } finally { c.stop(); await l.stop(); }
});

test('N1: a mover that never finishes ends the wait with a clear splash message naming the log and the lock file (no freeze on "Moving")', { skip, timeout: 90000 }, async () => {
  const fx = fixture({ events: 2 });
  const h = fakeMover(); holdLock(fx, h); await sleep(300);
  const l = await startLauncher(fx, { extra: ['--mover-wait-ms', '2000'] });
  try {
    assert.equal(await l.waitFor(/^SIM end /, 1, 30000), true, 'the launcher waited for ever. ' + l.lines.join('|'));
    assert.match(l.lines.find(x => x.startsWith('SIM end ')), /Refused/);
    const f = fragsOf(l.lines).at(-1);
    assert.equal(f.k, "bad"); assert.ok(f.s.includes("relay-launch.log") && !/delete the file/i.test(f.s), "a live mover must never be told to be deleted around: " + f.s);
    assert.equal(startsOf(fx).length, 0);
  } finally { await l.stop(); }
});

test('N6: after a move, a relay that hangs without opening its port is rolled back after a bounded wait (a normal slow start is not)', { skip, timeout: 120000 }, async () => {
  const fx = fixture({ events: 6 });
  const newdir = await realCopyMove(fx, fx.home);
  const l = await startLauncher(fx, { env: { TEST_HANG_DIR: newdir }, extra: ['--check-steps', '8'] });
  try {
    assert.equal(await l.waitFor(/^SIM opened /, 1, 90000), true, 'the launcher never recovered from a hung relay. Log:\n' + l.log + JSON.stringify(stateOf(fx).move));
    const starts = startsOf(fx);
    assert.equal(starts[0].dir, newdir); assert.equal(starts.at(-1).dir, fx.data, 'after the hang the relay must run on the OLD folder');
    assert.equal(stateOf(fx).move.state, 'rolled-back');
    assert.equal((await proven(l)).relayPub, fx.pub); assert.equal(await events(l, fx.data), 6);
  } finally { await l.stop(); }
});

test('M-1: a mover that keeps making progress is never called stuck, however long it takes; the launcher carries on when it ends', { skip, timeout: 120000 }, async () => {
  const fx = fixture({ events: 2 });
  const h = fakeMover(); holdLock(fx, h); await sleep(300);
  const l = await startLauncher(fx, { extra: ['--mover-wait-ms', '2000'] });
  const journal = n => { const tmp = fx.state + '.t'; writeFileSync(tmp, JSON.stringify({ move: { state: 'copying', copiedBytes: n, totalBytes: 100 } })); renameSync(tmp, fx.state); };
  try {
    for (let i = 1; i <= 14; i++) { journal(i); await sleep(500); }   // 7 s with a 2 s no-progress limit
    assert.equal(l.count(/^SIM end /), 0, 'a move that was still copying was called stuck: ' + l.lines.join('|'));
    assert.equal(startsOf(fx).length, 0);
    writeFileSync(fx.state, '{}');   // the (pretend) mover ends and leaves no move behind
    h.kill('SIGKILL');
    assert.equal(await l.waitFor(/^SIM opened /, 1, 60000), true, 'the launcher never carried on. Log:\n' + l.log);
  } finally { await l.stop(); }
});

test('L-2: a normal start (no move behind it) is never killed or rolled back for being slow, even with a tiny check bound', { skip, timeout: 120000 }, async () => {
  const fx = fixture({ events: 3 });
  const l = await startLauncher(fx, { env: { TEST_SLOW_START_MS: '4000' }, upSteps: 4, extra: ['--check-steps', '4'] });   // the post-move bound would be 1 s; this is no post-move start
  try {
    assert.equal(await l.waitFor(/^SIM opened /, 1, 60000), true, 'a slow normal start was cut off by the post-move bound. Log:\n' + l.log);
    assert.equal(startsOf(fx).length, 1, 'the relay was restarted');
    assert.equal(stateOf(fx).move, undefined, 'a rollback ran on a start that followed no move');
  } finally { await l.stop(); }
});

test('L-1 / L-3: a removal that stopped part-way is worded as part-way on the card (no "(delete-failed: …)"), and an old failed move\'s "nothing was changed" is not shown beside it', { skip: skipBrowser, timeout: 120000 }, async () => {
  const fx = fixture({ events: 2 });
  mkdirSync(join(fx.base, 'cfg'), { recursive: true });
  writeFileSync(fx.state, JSON.stringify({ move: { state: 'failed', code: 'copy-failed', mode: 'copy', from: fx.data, to: join(fx.base, 'x'), endedAt: new Date().toISOString() },
    launcher: { lastRefusal: { kind: 'remove-old', code: 'delete-failed: EBUSY something', detail: '/old', at: new Date().toISOString() } } }));
  const l = await startLauncher(fx);
  const c = await startChrome(1280);
  try {
    assert.equal(await l.waitFor(/^SIM opened /, 1, 60000), true, l.log);
    await c.open(l.base, 'set'); await waitFor(c, shown('storageCard'), v => v === true);
    const t = await waitFor(c, text('#stLauncherRefusal'), v => !!v);
    assert.match(t, /only partly removed/); assert.match(t, /stopped part-way — see the log/); assert.doesNotMatch(t, /delete-failed|EBUSY/);
    const body = await c.evalIn(text('#stBody'));
    assert.doesNotMatch(body, /The move didn't work, so nothing was changed/, 'the card contradicts itself: ' + body);
  } finally { c.stop(); await l.stop(); }
});
