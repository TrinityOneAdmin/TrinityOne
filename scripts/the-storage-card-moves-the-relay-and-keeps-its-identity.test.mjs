// THE STORAGE CARD MOVES THE RELAY, AND THE RELAY KEEPS ITS IDENTITY — driven through the real control panel.
// Run: node --test scripts/the-storage-card-moves-the-relay-and-keeps-its-identity.test.mjs
//
// Relay storage plan step 4 ("test 2" in plan §6), owner decisions §8a/§8b. Headless Chromium opens the REAL
// relay-app/control.html from a REAL gateway in suite mode and clicks the card like a steward. When the gateway
// stops itself for the move, THIS TEST PLAYS THE LAUNCHER (step 5 is not built): it runs the real
// scripts/relay-move.mjs, then starts the gateway again on the folder the pointer now names.
//
// What is faked, and why:
//   * The drive. A test cannot mount an exFAT stick, so a preload adds ONE line to what the gateway reads from
//     /proc/self/mountinfo, declaring the temp HOME folder an exFAT mount. Everything the gateway does with that
//     table is real (classifyTarget, the warning, the tick-box gate).
//   * A removable drive. Linux reports a USB drive by where it is mounted (/media/...), which a test cannot use, so
//     the fake mount line carries the 'removable' option — the same signal a Windows removable drive gives.
//   * The cross-drive copy. HOME is really on the same disk, so a rename would succeed; the launcher passes the
//     mover a rename that fails with EXDEV, which is exactly what a real cross-device rename does, so the mover
//     takes its real copy-and-verify path and keeps an old copy.
//   * Time. The 7-day reminder is reached by moving the journal's oldCopy.since back 8 days.
//   * "Is the relay still running?" The launcher would check the process; the test hands the mover
//     relayRunning: async () => false after it has SEEN the gateway exit (audit B N-4).
// PROVEN, not faked (audit B M-2): the fixture holds real signed events; after the move the restarted relay
// answers /status with the same event count the request recorded (> 0); it PROVES its identity through
// /relay-identity with the same verifier the app uses (src/relay-identity.src.js); it is restarted PINNED
// (TRINITY_DATA_DIR_PINNED=1), as the launcher will; the old folder holds MOVED-TO after a copy and ONLY a tombstone
// after a same-drive rename.
// No assertion reads control.html / control.js source text (rule 3): everything is read off the rendered page.
// Skips without chromium.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { freePort } from './relay-network-harness.mjs';
import { moveRelayData, beginCheck, checkPassed, jsonPointer, jsonFieldStore, parseMountinfo, keyPubOf, MOVED_TO } from './relay-move.mjs';
import { openStore } from './event-store.mjs';
import { finalizeEvent } from 'nostr-tools/pure';
import { verifyRelayIdentity } from '../src/relay-identity.src.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const skip = !CHROME ? 'no chromium' : false;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.TRIN_STORAGE_SHOTS || '';   // optional: a folder to save screenshots of the built card into

const PRELOAD = `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const add = process.env.TEST_MOUNTINFO_ADD || '';
const orig = fs.promises.readFile;
fs.promises.readFile = async function (p, ...a) {
  const t = await orig.call(this, p, ...a);
  return String(p) === '/proc/self/mountinfo' && add ? String(t) + add : t;
};
syncBuiltinESMExports();
const real = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const u = String(input && input.url ? input.url : input);
  if (/trinityone\\.church|\\.ts\\.net|trycloudflare|github\\.com/i.test(u)) return Promise.reject(new Error('blackholed by test: ' + u));
  return real.call(this, input, init);
};\n`;

const cleanups = [];
after(() => { for (const f of cleanups.reverse()) { try { f(); } catch {} } });

function fixture({ fs = 'exfat', opts = 'rw', events = 0 } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'trin-storage-card-'));
  cleanups.push(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, 'home'); mkdirSync(home);
  const data = join(base, 'appdata', 'TrinityOne Suite', 'data'); mkdirSync(data, { recursive: true });
  const sk = generateSecretKey(), pub = getPublicKey(sk);
  writeFileSync(join(data, 'relay-key.json'), JSON.stringify({ sk: Buffer.from(sk).toString('hex'), pub }));
  writeFileSync(join(data, 'blob.bin'), Buffer.alloc(200000, 3));
  if (events) {   // real signed events in the real store, so a move that lost records cannot pass (audit B M-2)
    const st = openStore(join(data, 'relay.sqlite'), { maxEvents: 500 });
    const author = generateSecretKey(), t0 = Math.floor(Date.now() / 1000) - 3600;
    for (let i = 0; i < events; i++) st.put(finalizeEvent({ kind: 1, created_at: t0 + i, tags: [], content: 'record ' + i }, author), '');
    st.close();
  }
  const preload = join(base, 'preload.mjs'); writeFileSync(preload, PRELOAD);
  const exfatLine = fs ? `9999 1 0:999 / ${home} rw,relatime shared:999 - ${fs} /dev/sdz1 ${opts}\n` : '';
  return { base, home, data, pub, preload, exfatLine, state: join(base, 'storage.json') };
}

async function startGateway(fx, dataDir, { mode = 'suite', pinned = false } = {}) {
  const port = await freePort('the storage card gateway');
  const proc = spawn(process.execPath, [join(ROOT, 'scripts/gateway.mjs'), String(port)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_SYNC: '0', RELAY_HOST: '127.0.0.1', RELAY_NO_OPEN: '1',
      RELAY_DIRECTORY: 'http://127.0.0.1:9', TRINITY_TAILSCALE_BIN: '/nonexistent/tailscale', NODE_OPTIONS: '--import ' + fx.preload,
      TRINITY_STORAGE_MODE: mode, TRINITY_STORAGE_STATE: mode ? fx.state : '', HOME: fx.home, USER: 'nobody-storage-test', TEST_MOUNTINFO_ADD: fx.exfatLine, TRINITY_DATA_DIR_PINNED: pinned ? '1' : '' },
  });
  const g = { port, base: `http://127.0.0.1:${port}`, proc, log: '', code: undefined };
  proc.stdout.on('data', d => { g.log += d; }); proc.stderr.on('data', d => { g.log += d; });
  g.exited = new Promise(res => proc.on('exit', (code) => { g.code = code; res(code); }));
  g.stop = async () => { if (g.code === undefined) { proc.kill('SIGKILL'); await g.exited; } };
  cleanups.push(() => { try { proc.kill('SIGKILL'); } catch {} });
  let up = false;
  for (let i = 0; i < 200 && !up && g.code === undefined; i++) { try { up = (await fetch(g.base + '/status')).ok; } catch {} if (!up) await sleep(150); }
  assert.ok(up, 'the gateway never served /status. Log:\n' + g.log);
  return g;
}

async function startChrome(width) {
  const cdp = await freePort('the storage card Chrome debug port');
  const prof = mkdtempSync(join(tmpdir(), 'trin-storage-card-chrome-'));
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9',
    `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
  const stop = () => { try { ws && ws.close(); } catch {} try { chr.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} };
  cleanups.push(stop);
  let targets = null, ws = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height: width < 600 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 600 });
  const evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr && rr.result && rr.result.exceptionDetails) throw new Error('the page threw: ' + JSON.stringify(rr.result.exceptionDetails).slice(0, 300));
    return rr && rr.result && rr.result.result ? rr.result.result.value : undefined;
  };
  const open = async (base, tab) => {
    await send('Page.navigate', { url: base + '/relay-app/control.html' }); await sleep(600);
    await evalIn(`localStorage.setItem('to_relay_setup_seen','1'); sessionStorage.setItem('to_relay_setup_skipped','1'); localStorage.setItem('trinityone.relay.tab','${tab}')`);
    await send('Page.navigate', { url: base + '/relay-app/control.html' }); await sleep(400);
  };
  const shot = async (sel, file) => {
    if (!SHOTS) return;
    const r = JSON.parse(await evalIn(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'start' }); const b = e.getBoundingClientRect(); return JSON.stringify({ x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height }); })()`));
    const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.w + 16, height: r.h + 16, scale: 1 } });
    writeFileSync(join(SHOTS, file), Buffer.from(res.result.data, 'base64'));
  };
  return { evalIn, open, shot, stop };
}
// what the restarted relay says about itself: its PROVEN key (/relay-identity, the app's own verifier) and its count
async function provenIdentity(g) { return verifyRelayIdentity(`ws://127.0.0.1:${g.port}/relay`); }
async function eventCount(g, token) { const s = await (await fetch(g.base + '/status', { headers: { Authorization: 'Bearer ' + token } })).json(); return s.counts && s.counts.events; }
const tokenOf = dir => JSON.parse(readFileSync(join(dir, 'admin.json'), 'utf8')).token;
const waitFor = async (c, expr, want, ms = 15000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await c.evalIn(expr); if (want(v)) return v; await sleep(250); } return v; };
const shown = (id) => `(() => { const e = document.getElementById('${id}'); return !!e && e.checkVisibility(); })()`;
const text = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; })()`;

test('storage mode unset (every box today): no storage card on Settings, no reminder on the Dashboard', { skip, timeout: 90000 }, async () => {
  const fx = fixture();
  // even with a journal that WOULD remind, a box that has not opted in shows nothing
  writeFileSync(fx.state, JSON.stringify({ move: { state: 'awaiting-confirm', mode: 'copy', from: fx.home, to: fx.data, oldCopy: { path: fx.home, since: new Date(Date.now() - 9 * 86400000).toISOString() } } }));
  const g = await startGateway(fx, fx.data, { mode: '' });
  const c = await startChrome(1280);
  try {
    await c.open(g.base, 'set');
    assert.equal(await waitFor(c, shown('backupCard'), v => v === true), true, 'precondition: Settings never unlocked');
    await sleep(1500);
    assert.equal(await c.evalIn(shown('storageCard')), false, 'a storage card appeared on a box with TRINITY_STORAGE_MODE unset');
    await c.evalIn(`document.getElementById('tab-dash').click()`);
    await sleep(500);
    assert.equal(await c.evalIn(shown('storageRemindDash')), false, 'a storage reminder appeared on the Dashboard of a box that has not opted in');
  } finally { c.stop(); await g.stop(); }
});

test('the card: refuses with its reason, needs the tick for an exFAT drive, two clicks move the relay, and after a cross-drive move offers Remove old copy and the 7-day reminder (card AND Dashboard)', { skip, timeout: 240000 }, async () => {
  const fx = fixture({ events: 25 });
  let g = await startGateway(fx, fx.data);
  const c = await startChrome(1280);
  try {
    // ── a refused move shows its reason, and Move stays disabled
    mkdirSync(join(fx.data, '.restore-pending'));
    await c.open(g.base, 'set');
    assert.equal(await waitFor(c, shown('storageCard'), v => v === true), true, 'the storage card never appeared on a suite-mode box');
    assert.match(await waitFor(c, text('#stResult'), v => !!v) || '', /Can't move right now\. A restore is waiting/, 'a refused move does not say why');
    await c.evalIn(`document.getElementById('stPick').click()`);
    await waitFor(c, `!!document.querySelector('#stList input[name="stDrive"]:not([disabled])')`, v => v === true);
    await c.evalIn(`(() => { const i = [...document.querySelectorAll('#stList input[name="stDrive"]')].find(x => x.value === ${JSON.stringify(fx.home)}); i.click(); })()`);
    await c.evalIn(`(() => { const a = document.getElementById('stAck'); if (a && !a.checked) a.click(); })()`);
    assert.equal(await c.evalIn(`document.getElementById('stMove').disabled`), true, 'Move is enabled while the folder has a reason it cannot move');
    rmSync(join(fx.data, '.restore-pending'), { recursive: true });

    // ── the card shows the current folder and the drives
    await c.open(g.base, 'set');
    await waitFor(c, shown('storageCard'), v => v === true);
    const nowLine = await waitFor(c, text('#stNow'), v => !!v && /data/.test(v));
    assert.match(nowLine, /Now.*TrinityOne Suite.*data/, 'the current folder is not shown: ' + nowLine);
    assert.match(nowLine, /KB|MB|GB/, 'the size is not shown: ' + nowLine);
    assert.equal(await c.evalIn(`document.getElementById('stMove').disabled`), true, 'Move is enabled before a drive is picked');
    await c.evalIn(`document.getElementById('stPick').click()`);
    const rows = JSON.parse(await waitFor(c, `JSON.stringify([...document.querySelectorAll('#stList .st-drive')].map(r => ({ name: r.querySelector('.st-dname').textContent, value: (r.querySelector('input') || {}).value, text: r.textContent.replace(/\\s+/g, ' ') })))`, v => v && v !== '[]'));
    const homeRow = rows.find(r => r.value === fx.home);
    assert.ok(homeRow, 'the home folder is not in the drive list: ' + JSON.stringify(rows.map(r => r.name)));
    assert.equal(homeRow.name, 'Home folder');
    assert.match(homeRow.text, /no file permissions\. Anyone who plugs it in can read your church's records/, 'the exFAT drive does not carry the strong warning');

    // ── exFAT: Move stays disabled until the tick box is ticked
    await c.evalIn(`(() => { const i = [...document.querySelectorAll('#stList input[name="stDrive"]')].find(x => x.value === ${JSON.stringify(fx.home)}); i.click(); })()`);
    assert.equal(await waitFor(c, shown('stAck'), v => v === true), true, 'no tick box for a drive with no file permissions');
    assert.equal(await c.evalIn(`document.getElementById('stMove').disabled`), true, 'Move is enabled for an exFAT drive before the tick box is ticked');
    await c.evalIn(`document.getElementById('stMove').click()`);
    await sleep(300);
    assert.equal(existsSync(join(fx.data, '.move-request')), false, 'a move was requested for an exFAT drive without the tick');
    await c.evalIn(`document.getElementById('stAck').click()`);
    assert.equal(await waitFor(c, `document.getElementById('stMove').disabled`, v => v === false), false, 'ticking the box did not enable Move');
    await c.shot('#storageCard', 'storage-card-1280-choosing.png');

    // ── two clicks: the first only arms; the second sends the move and the relay stops
    await c.evalIn(`document.getElementById('stMove').click()`);
    assert.match(await waitFor(c, text('#stMove'), v => /Confirm/.test(v || '')), /Confirm — stop the relay and move/, 'the first click did not ask for confirmation');
    assert.match(await c.evalIn(text('#stMsg')), /Click again to stop the relay and move its data to Home folder/);
    await sleep(500);
    assert.equal(existsSync(join(fx.data, '.move-request')), false, 'ONE click sent the move');
    assert.equal(g.code, undefined, 'one click stopped the relay');
    await c.evalIn(`document.getElementById('stMove').click()`);
    const code = await Promise.race([g.exited, sleep(15000).then(() => 'timeout')]);
    assert.equal(code, 0, 'the relay did not stop cleanly for the move. Log:\n' + g.log);
    const req = JSON.parse(readFileSync(join(fx.data, '.move-request'), 'utf8'));
    assert.equal(req.drive, fx.home);
    assert.equal(req.relayPub, fx.pub);
    assert.equal(req.events, 25, 'the request did not record the relay\'s real event count');
    assert.equal(await waitFor(c, shown('stStopped'), v => v === true), true, 'the card did not say the relay is stopped for the move');

    // ── THE TEST IS THE LAUNCHER: the real mover, a cross-device copy, then the relay restarted on the pointer
    const pointer = jsonPointer(fx.state), journal = jsonFieldStore(fx.state, 'move');
    const exdev = () => { throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' }); };
    const mv = await moveRelayData({ from: fx.data, to: req.target, pointer, journal, relayRunning: async () => false, mode: 'suite',
      mounts: parseMountinfo(readFileSync('/proc/self/mountinfo', 'utf8') + fx.exfatLine), rename: exdev, codeDir: ROOT });
    assert.equal(mv.ok, true, 'the mover refused: ' + JSON.stringify(mv));
    assert.equal(mv.mode, 'copy');
    const chk = await beginCheck({ journal });
    assert.equal(chk.ok, true, 'the pre-start check failed: ' + JSON.stringify(chk.bad));
    const newDir = pointer.read();
    assert.equal(newDir, req.target, 'the pointer does not name the new folder');
    assert.equal(keyPubOf(newDir), fx.pub, 'the new folder does not hold this relay\'s key');
    assert.ok(existsSync(join(fx.data, MOVED_TO)), 'the old copy is not marked MOVED-TO after a cross-drive move');
    assert.equal(existsSync(join(newDir, '.move-request')), false, 'the request travelled into the new folder');
    g = await startGateway(fx, newDir, { pinned: true });
    const proof = await provenIdentity(g);
    assert.ok(proof, 'the restarted relay could not prove an identity through /relay-identity');
    assert.equal(proof.relayPub, fx.pub, 'the restarted relay PROVES a different identity — a stranger, not the moved relay');
    assert.equal(await eventCount(g, tokenOf(newDir)), req.events, 'the restarted relay holds a different number of events than before the move');
    assert.ok(checkPassed({ journal }), 'checkPassed did not record the move');

    // ── after the move: the outcome, the old copy and its Remove button; no reminder yet
    await c.open(g.base, 'set');
    await waitFor(c, shown('storageCard'), v => v === true);
    const res = await waitFor(c, text('#stResult'), v => !!v && /now keeps/.test(v));
    assert.match(res, /Your relay now keeps its data in your Home folder\. Same relay, same records — 25 events checked\./, 'the moved-OK line is wrong: ' + res);
    assert.equal(await c.evalIn(shown('stRemoveOld')), true, 'no Remove old copy after a cross-drive move');
    assert.match(await c.evalIn(text('.st-old .txt')), /The old copy is still on/);
    assert.equal(await c.evalIn(shown('stRemind')), false, 'the 7-day reminder shows on day 0');
    await c.shot('#storageCard', 'storage-card-1280-moved.png');

    // ── 8 days later: the reminder on the card AND on the Dashboard
    const j = journal.read(); j.oldCopy.since = new Date(Date.now() - 8 * 86400000).toISOString(); journal.write(j);
    await c.open(g.base, 'set');
    assert.equal(await waitFor(c, shown('stRemind'), v => v === true), true, 'no reminder on the card after 8 days');
    assert.match(await c.evalIn(text('#stRemind')), /Your old copy has been on .+ for 8 days\./);
    await c.shot('#storageCard', 'storage-card-1280-reminder.png');
    await c.evalIn(`document.getElementById('tab-dash').click()`);
    assert.equal(await waitFor(c, shown('storageRemindDash'), v => v === true), true, 'no reminder on the Dashboard after 8 days');
    assert.match(await c.evalIn(text('#storageRemindDash')), /Your old copy has been on .+ for 8 days\./);
    // Dashboard A: the reminder is a row of its own, so the fixed grid's rows keep equal heights
    const geo = JSON.parse(await waitFor(c, `(() => { const R = e => { const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom) }; };
      const d = document.querySelector('#panel-dash .deck'), m = document.getElementById('storageRemindDash');
      const others = [...d.children].filter(x => x !== m && x.checkVisibility()).map(R);
      return JSON.stringify({ deck: R(d), m: R(m), others }); })()`, v => !!v));
    assert.ok(geo.m.l <= geo.deck.l + 1 && geo.m.r >= geo.deck.r - 1, 'the Dashboard reminder does not run the full width of the grid');
    for (const o of geo.others) assert.ok(o.b <= geo.m.t || o.t >= geo.m.b, 'a Dashboard card shares a row with the reminder: ' + JSON.stringify(o));
    await c.shot('#storageRemindDash', 'storage-dashboard-reminder-1280.png');

    // ── a FAILED Remove says so, in its own words (audit B L-1): the journal stops recording the old copy behind
    //    the page's back, so the gateway answers 400 not-recorded
    await c.evalIn(`document.getElementById('stDashGo').click()`);
    await waitFor(c, shown('stRemoveOld'), v => v === true);
    const kept = journal.read();
    journal.write({ ...kept, state: 'done', oldCopy: null });
    await c.evalIn(`document.getElementById('stRemoveOld').click()`);
    await waitFor(c, text('#stRemoveOld'), v => /Remove the old copy\?/.test(v || ''));
    await c.evalIn(`document.getElementById('stRemoveOld').click()`);
    const failLine = await waitFor(c, `(() => { const e = [...document.querySelectorAll('#stBody .st-result.bad')].pop(); return e ? e.textContent.replace(/\\s+/g, ' ') : null; })()`, v => !!v);
    assert.match(failLine || '', /Couldn't remove the old copy\. It is no longer on record/, 'a failed Remove did not say what failed: ' + failLine);
    assert.doesNotMatch(failLine, /Can't move right now/);
    journal.write(kept);
    await c.open(g.base, 'set');

    // ── Remove old copy: two clicks, and it asks for exactly the recorded old copy
    await waitFor(c, shown('stRemoveOld'), v => v === true);
    await c.evalIn(`document.getElementById('stRemoveOld').click()`);
    assert.match(await waitFor(c, text('#stRemoveOld'), v => /Remove the old copy\?/.test(v || '')), /Remove the old copy\?/, 'the first click on Remove did not ask');
    await sleep(300);
    assert.equal(existsSync(join(newDir, '.remove-old-request')), false, 'ONE click asked for the old copy to be removed');
    await c.evalIn(`document.getElementById('stRemoveOld').click()`);
    assert.equal(await waitFor(c, shown('stRemovePending'), v => v === true), true, 'the card did not show the removal as requested');
    assert.equal(JSON.parse(readFileSync(join(newDir, '.remove-old-request'), 'utf8')).path, fx.data, 'the removal request names the wrong folder');
    assert.ok(existsSync(fx.data), 'the gateway removed the old copy itself');
    assert.match(await c.evalIn(text('#stRemovePending')), /^Removal requested\./);
    // audit B N-1: once removal is requested the Dashboard stops counting days
    await c.evalIn(`document.getElementById('tab-dash').click()`);
    await sleep(400);
    assert.equal(await c.evalIn(shown('storageRemindDash')), false, 'the Dashboard still reminds after removal was requested');
  } finally { c.stop(); await g.stop(); }
});

test('the card at phone width (390px): no sideways scroll, every control on screen', { skip, timeout: 90000 }, async () => {
  const fx = fixture();
  const g = await startGateway(fx, fx.data);
  const c = await startChrome(390);
  try {
    await c.open(g.base, 'set');
    await waitFor(c, shown('storageCard'), v => v === true);
    await c.evalIn(`document.getElementById('stPick').click()`);
    await waitFor(c, `!!document.querySelector('#stList input')`, v => v === true);
    await c.evalIn(`(() => { const i = [...document.querySelectorAll('#stList input[name="stDrive"]')].find(x => x.value === ${JSON.stringify(fx.home)}); i.click(); })()`);
    await waitFor(c, shown('stAck'), v => v === true);
    const w = JSON.parse(await c.evalIn(`JSON.stringify({ doc: document.documentElement.scrollWidth, vw: innerWidth, card: Math.round(document.getElementById('storageCard').getBoundingClientRect().right), move: Math.round(document.getElementById('stMove').getBoundingClientRect().right) })`));
    assert.ok(w.doc <= w.vw, `the page scrolls sideways at 390px (${w.doc} > ${w.vw})`);
    assert.ok(w.card <= w.vw && w.move <= w.vw, 'the card or its Move button runs off the right edge: ' + JSON.stringify(w));
    await c.shot('#storageCard', 'storage-card-390-choosing.png');
  } finally { c.stop(); await g.stop(); }
});

const WEAR = /Running your church's relay from a USB stick wears it out faster than normal use, because it writes all day, every day\. A USB stick can fail without warning\. Keep regular backups\./;
const PERMS = /no file permissions/;
async function pickHome(c, fx) {
  await c.evalIn(`document.getElementById('stPick').click()`);
  await waitFor(c, `!!document.querySelector('#stList input[name="stDrive"]')`, v => v === true);
  await c.evalIn(`(() => { const i = [...document.querySelectorAll('#stList input[name="stDrive"]')].find(x => x.value === ${JSON.stringify(fx.home)}); i.click(); })()`);
  await sleep(300);
  return c.evalIn(`(() => { const r = [...document.querySelectorAll('#stList .st-drive')].find(x => (x.querySelector('input') || {}).value === ${JSON.stringify(fx.home)}); return r ? r.textContent.replace(/\\s+/g, ' ') : null; })()`);
}

test('owner §8b: a REMOVABLE ext4 drive (proper permissions) shows the USB wear line and still needs the tick before Move', { skip, timeout: 120000 }, async () => {
  const fx = fixture({ fs: 'ext4', opts: 'rw,removable' });
  const g = await startGateway(fx, fx.data);
  const c = await startChrome(1280);
  try {
    await c.open(g.base, 'set');
    await waitFor(c, shown('storageCard'), v => v === true);
    const row = await pickHome(c, fx);
    assert.match(row || '', WEAR, 'a removable drive does not carry the USB wear warning: ' + row);
    assert.doesNotMatch(row, PERMS, 'an ext4 drive was given the no-permissions warning');
    assert.equal(await c.evalIn(shown('stAck')), true, 'no tick box for a removable drive');
    assert.equal(await c.evalIn(`document.getElementById('stMove').disabled`), true, 'Move is enabled for a removable drive before the tick');
    await c.evalIn(`document.getElementById('stAck').click()`);
    assert.equal(await waitFor(c, `document.getElementById('stMove').disabled`, v => v === false), false, 'ticking did not enable Move');
    await c.shot('#storageCard', 'storage-card-1280-usb-ext4.png');
    await c.evalIn(`document.getElementById('stMove').click()`);
    await waitFor(c, text('#stMove'), v => /Confirm/.test(v || ''));
    await c.evalIn(`document.getElementById('stMove').click()`);
    assert.equal(await Promise.race([g.exited, sleep(15000).then(() => 'timeout')]), 0, 'the acknowledged move to a removable drive did not go through. Log:\n' + g.log);
    assert.equal(JSON.parse(readFileSync(join(fx.data, '.move-request'), 'utf8')).drive, fx.home);
  } finally { c.stop(); await g.stop(); }
});

test('an exFAT USB drive shows BOTH warnings in one box with ONE tick', { skip, timeout: 120000 }, async () => {
  const fx = fixture({ fs: 'exfat', opts: 'rw,removable' });
  const g = await startGateway(fx, fx.data);
  const c = await startChrome(1280);
  try {
    await c.open(g.base, 'set');
    await waitFor(c, shown('storageCard'), v => v === true);
    await pickHome(c, fx);
    const box = await c.evalIn(`(() => { const b = document.getElementById('stAck').closest('.st-ackbox'); return JSON.stringify({ text: b.textContent.replace(/\\s+/g, ' '), ticks: b.querySelectorAll('input[type=checkbox]').length, all: document.querySelectorAll('#stList input[type=checkbox]').length }); })()`);
    const b = JSON.parse(box);
    assert.match(b.text, PERMS, 'the no-permissions warning is not in the tick box');
    assert.match(b.text, WEAR, 'the USB wear warning is not in the tick box');
    assert.equal(b.ticks, 1); assert.equal(b.all, 1, 'more than one tick box');
    await c.evalIn(`document.getElementById('stAck').click()`);
    assert.equal(await waitFor(c, `document.getElementById('stMove').disabled`, v => v === false), false, 'one tick did not cover both warnings');
    await c.shot('#storageCard', 'storage-card-1280-usb-exfat.png');
  } finally { c.stop(); await g.stop(); }
});

test('a fixed internal drive shows neither warning and needs no tick', { skip, timeout: 120000 }, async () => {
  const fx = fixture({ fs: 'ext4', opts: 'rw' });
  const g = await startGateway(fx, fx.data);
  const c = await startChrome(1280);
  try {
    await c.open(g.base, 'set');
    await waitFor(c, shown('storageCard'), v => v === true);
    const row = await pickHome(c, fx);
    assert.ok(row, 'the home drive is not listed');
    assert.doesNotMatch(row, WEAR, 'a fixed drive was given the USB wear warning');
    assert.doesNotMatch(row, PERMS, 'a fixed ext4 drive was given the no-permissions warning');
    assert.equal(await c.evalIn(`!!document.getElementById('stAck')`), false, 'a fixed drive asks for a tick');
    assert.equal(await waitFor(c, `document.getElementById('stMove').disabled`, v => v === false), false, 'Move is not enabled for a plain fixed drive');
  } finally { c.stop(); await g.stop(); }
});

test('a SAME-DRIVE move through the card: instant (no old copy promised), only a tombstone left, same proven relay, same records', { skip, timeout: 180000 }, async () => {
  const fx = fixture({ fs: null, events: 12 });   // HOME and the data folder on the same real disk: a rename
  let g = await startGateway(fx, fx.data);
  const c = await startChrome(1280);
  try {
    await c.open(g.base, 'set');
    await waitFor(c, shown('storageCard'), v => v === true);
    const row = await pickHome(c, fx);
    assert.match(row || '', /Moves instantly — same drive/, 'the same drive is not marked instant: ' + row);
    assert.equal(await c.evalIn(`!!document.getElementById('stAck')`), false, 'a same-disk home folder asks for a tick');
    // audit B N-2: no "copies… old copy is kept" for a rename
    const explain = await c.evalIn(text('#stExplain'));
    assert.match(explain, /Same drive, so the move is instant and there is no old copy/, 'the explain line is wrong for a same-drive move: ' + explain);
    assert.doesNotMatch(explain, /old copy is kept/);
    await c.evalIn(`document.getElementById('stMove').click()`);
    await waitFor(c, text('#stMove'), v => /Confirm/.test(v || ''));
    await c.evalIn(`document.getElementById('stMove').click()`);
    assert.equal(await Promise.race([g.exited, sleep(15000).then(() => 'timeout')]), 0, 'the relay did not stop for the move. Log:\n' + g.log);
    const req = JSON.parse(readFileSync(join(fx.data, '.move-request'), 'utf8'));
    assert.equal(req.sameDrive, true);
    assert.equal(req.events, 12);
    // THE TEST IS THE LAUNCHER — a real rename this time (no injected EXDEV)
    const pointer = jsonPointer(fx.state), journal = jsonFieldStore(fx.state, 'move');
    const mv = await moveRelayData({ from: fx.data, to: req.target, pointer, journal, relayRunning: async () => false, mode: 'suite', codeDir: ROOT });
    assert.equal(mv.ok, true, JSON.stringify(mv)); assert.equal(mv.mode, 'rename');
    assert.deepEqual(readdirSync(fx.data), [MOVED_TO], 'a same-drive move left more than a tombstone at the old path');
    assert.equal(existsSync(join(req.target, '.move-request')), false, 'the rename carried the request into the new folder (audit B M-1)');
    assert.equal((await beginCheck({ journal })).ok, true);
    g = await startGateway(fx, pointer.read(), { pinned: true });
    const proof = await provenIdentity(g);
    assert.equal(proof && proof.relayPub, fx.pub, 'the renamed relay does not prove the same identity');
    assert.equal(await eventCount(g, tokenOf(req.target)), 12, 'the renamed relay lost records');
    assert.ok(checkPassed({ journal }));
    await c.open(g.base, 'set');
    const res = await waitFor(c, text('#stResult'), v => !!v && /now keeps/.test(v));
    assert.match(res, /Same relay, same records — 12 events checked\. ?Same drive, so it moved instantly\. There is no old copy to remove\./, res);
    assert.equal(await c.evalIn(`!!document.getElementById('stRemoveOld')`), false, 'Remove old copy offered after a same-drive move');
    assert.equal(await c.evalIn(`!!document.querySelector('#stMove')`), true, 'no way to move again after a same-drive move');
    assert.equal(await c.evalIn(`(document.querySelector('#stResult') && !/under way/.test(document.getElementById('stBody').textContent))`), true, 'the card says a move is under way after it finished');
  } finally { c.stop(); await g.stop(); }
});

test('audit B L-5: with the card shown, Settings still ends level — Updates beside Backup + storage — at 1280 and 1000', { skip, timeout: 120000 }, async () => {
  const fx = fixture();
  const g = await startGateway(fx, fx.data);
  try {
    for (const width of [1280, 1000]) {
      const c = await startChrome(width);
      try {
        await c.open(g.base, 'set');
        await waitFor(c, `${shown('storageCard')} && ${shown('updatesCard')} && ${shown('backupCard')}`, v => v === true);
        await sleep(800);
        const R = JSON.parse(await c.evalIn(`(() => { const R = id => { const b = document.getElementById(id).getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top + scrollY), b: Math.round(b.bottom + scrollY) }; };
          return JSON.stringify({ upd: R('updatesCard'), bak: R('backupCard'), st: R('storageCard') }); })()`));
        assert.equal(R.upd.t, R.bak.t, `@${width}: Updates and Backup do not start on the same row`);
        assert.ok(R.bak.l > R.upd.r, `@${width}: Backup is not beside Updates`);
        assert.ok(R.st.t >= R.bak.b && R.st.l === R.bak.l, `@${width}: the storage card is not stacked under Backup`);
        assert.equal(R.upd.b, R.st.b, `@${width}: the Settings row does not end level (Updates ends ${R.upd.b}, the storage card ${R.st.b})`);
      } finally { c.stop(); }
    }
  } finally { await g.stop(); }
});
