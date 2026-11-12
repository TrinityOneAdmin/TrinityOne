// SIX SMALL RELAY-PANEL BUGS, 2026-11-12 (fix/relay-panel-small-bugs). Evidence: TrinityOne-internal
// reference/MOCKUPS-relay-panel-ui-2026-11-12.html, "Things that look broken" items 1-5 and 7.
// Run: node --test scripts/the-relay-panel-small-bugs-2026-11-12.test.mjs
//
// Every on-screen assertion is read off the DOM of relay-app/control.html in headless Chromium, against a real
// gateway with an empty data dir and one registered throwaway church (the long church key is what made Settings
// overflow). Nothing is matched against control.js source text (CLAUDE.md rule 3): the two pure functions are
// LIFTED and RUN. Skips the browser cases without chromium.
//
//   1. Settings at 390px laid out 689px wide (.deck3's bare 1fr = minmax(auto,1fr) let the nowrap npub row set
//      the column minimum) and was shrunk to ~57%.
//   2. Phone header: "Your relay is running" wrapped one word per line and ran under the Back button.
//   3. Dashboard "Relay sync" row always read "—" (nothing wrote #syncMsg).
//   4. "Check sync now" sat in the software-update card titled "Check for a newer version now"; it pulls data
//      from other relays. Now "Sync now" in the Relay health card, hidden while the panel is locked.
//   5. "Traffic (session)" claimed "since you opened this page"; the gateway counts since the relay started.
//   6. The email-subscriber download was titled as a list of phones that receive notifications.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { freePort } from './relay-network-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONTROL = readFileSync(join(ROOT, 'relay-app/control.js'), 'utf8');
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── lifted functions ─────────────────────────────────────────────────────────────────────────────────────────
function liftFn(anchor) {
  const i = CONTROL.indexOf(anchor);
  assert.ok(i >= 0, anchor + ' is gone from control.js — re-anchor');
  assert.equal(CONTROL.indexOf(anchor, i + 1), -1, anchor + ' appears twice — re-anchor');
  let d = 0;
  for (let k = CONTROL.indexOf('{', i); k < CONTROL.length; k++) {
    if (CONTROL[k] === '{') d++;
    else if (CONTROL[k] === '}') { d--; if (!d) return CONTROL.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces after ' + anchor);
}

test('3: syncStateText names the box\'s sync state, and a failed pass reads as not working', () => {
  const f = new Function('return (' + liftFn('function syncStateText(sync) {') + ')')();
  assert.deepEqual(f({ at: 1700000000, ok: true, peers: 2, running: false }), { text: 'Working', bad: false });
  assert.deepEqual(f({ at: 1700000000, ok: false, peers: 2, running: false }), { text: 'Not working', bad: true });
  assert.equal(f({ running: true, peers: 1 }).text, 'Syncing now');
  assert.equal(f({ at: 0, ok: null, peers: 0 }).text, 'No other relays yet');
  assert.equal(f({ at: 0, ok: null, peers: 3 }).text, 'Waiting for the first check');
  assert.equal(f(undefined).text, '—', 'no sync block at all (an old relay) must stay the honest dash');
});

test('4: a locked panel hides "Sync now" (it needs the token) and an unlocked one shows it', () => {
  const body = liftFn('function syncSettingsLock(locked) {');
  const els = {};
  const document = { getElementById: (id) => (els[id] ||= { textContent: '', style: {} }) };
  const syncSettingsLock = new Function('document', 'STAT_CARDS', 'let statsLocked; return (' + body + ')')(document, []);
  els.syncNowBox = { style: { display: '' } };
  syncSettingsLock(true);
  assert.equal(els.syncNowBox.style.display, 'none', 'a locked panel still offers "Sync now", which can only answer 401');
  syncSettingsLock(false);
  assert.equal(els.syncNowBox.style.display, '', 'unlocking did not bring "Sync now" back');
});

// ── the real page ────────────────────────────────────────────────────────────────────────────────────────────
const BLACKHOLE = `const real = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const u = String(input && input.url ? input.url : input);
  if (/trinityone\\.church|\\.ts\\.net|trycloudflare/i.test(u)) return Promise.reject(new Error('blackholed by test: ' + u));
  return real.call(this, input, init);
};\n`;
let gw = null;
async function startGateway() {
  const port = await freePort('the relay-panel small-bugs gateway');
  const dataDir = mkdtempSync(join(tmpdir(), 'trin-panel-small-'));
  const preload = join(dataDir, 'blackhole.mjs');
  writeFileSync(preload, BLACKHOLE);
  const proc = spawn(process.execPath, [join(ROOT, 'scripts/gateway.mjs'), String(port)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_SYNC: '0', RELAY_HOST: '127.0.0.1', RELAY_NO_OPEN: '1',
      RELAY_DIRECTORY: 'http://127.0.0.1:9', TRINITY_TAILSCALE_BIN: '/nonexistent/tailscale', NODE_OPTIONS: '--import ' + preload },
  });
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 200 && !up; i++) { try { up = (await fetch(base + '/status')).ok; } catch {} if (!up) await sleep(150); }
  assert.ok(up, 'the gateway never served /status');
  const token = JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token;
  // one church, so the Churches card carries a long unbreakable npub row — the thing that widened Settings
  const npub = npubEncode(getPublicKey(generateSecretKey()));
  const r = await fetch(base + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ addChurch: { npub, name: '' } }) });
  assert.equal(r.status, 200, 'registering the church failed');
  return { base, stop() { try { proc.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} } };
}

async function startChrome(width) {
  const cdp = await freePort('the relay-panel small-bugs Chrome debug port');
  const prof = mkdtempSync(join(tmpdir(), 'trin-panel-small-chrome-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD,
    `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  // mobile:true is what lets a too-wide page widen the layout viewport and get shrunk — the defect in bug 1
  await send('Emulation.setDeviceMetricsOverride', { width, height: width < 600 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 600 });
  const evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr && rr.result && rr.result.exceptionDetails) throw new Error('the page threw: ' + JSON.stringify(rr.result.exceptionDetails).slice(0, 300));
    return rr && rr.result && rr.result.result ? rr.result.result.value : undefined;
  };
  // open the panel with the first-run wizard dismissed and the chosen tab remembered
  const open = async (tab) => {
    await send('Page.navigate', { url: gw.base + '/relay-app/control.html' }); await sleep(600);
    await evalIn(`localStorage.setItem('to_relay_setup_seen','1'); sessionStorage.setItem('to_relay_setup_skipped','1'); localStorage.setItem('trinityone.relay.tab','${tab}')`);
    await send('Page.navigate', { url: gw.base + '/relay-app/control.html' });
  };
  return { evalIn, open, stop() { try { ws.close(); } catch {} try { chr.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} } };
}
const waitFor = async (c, expr, want, ms = 12000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await c.evalIn(expr); if (want(v)) return v; await sleep(300); } return v; };

before(async () => { if (CHROME) gw = await startGateway(); });
after(() => { if (gw) gw.stop(); });
const skip = !CHROME ? 'no chromium' : false;

test('1: Settings on a 390px phone, with a church listed, is laid out 390px wide (not widened and shrunk)', { skip, timeout: 90000 }, async () => {
  const c = await startChrome(390);
  try {
    await c.open('set');
    // wait until the church row (the long npub) has rendered — the overflow only appears once it is there
    const rows = await waitFor(c, `document.querySelectorAll('#cfgList .cr-key').length`, v => v >= 1);
    assert.ok(rows >= 1, 're-anchor: the church row never rendered in the Churches card');
    assert.equal(await c.evalIn(`document.getElementById('panel-set').hidden`), false, 're-anchor: Settings is not the open tab');
    const m = JSON.parse(await c.evalIn(`JSON.stringify({ sw: document.documentElement.scrollWidth, iw: innerWidth })`));
    assert.equal(m.iw, 390, `THE PAGE IS SHRUNK TO FIT: the layout viewport is ${m.iw}px on a 390px phone (was 689 before the fix)`);
    assert.ok(m.sw <= 390, `Settings is ${m.sw}px wide on a 390px phone — something overflows`);
  } finally { c.stop(); }
});

test('2: the phone header keeps "Your relay is running" on one line, clear of the Back button', { skip, timeout: 60000 }, async () => {
  const c = await startChrome(390);
  try {
    await c.open('dash');
    await waitFor(c, `document.getElementById('title').textContent`, v => v === 'Your relay is running');
    const g = JSON.parse(await c.evalIn(`(() => { const t = document.getElementById('title').getBoundingClientRect(), b = document.getElementById('openConsole').getBoundingClientRect(), lh = parseFloat(getComputedStyle(document.getElementById('title')).lineHeight) || 25; return JSON.stringify({ th: t.height, lh, tl: t.left, tr: t.right, tt: t.top, tb: t.bottom, bl: b.left, br: b.right, bt: b.top, bb: b.bottom }); })()`));
    assert.ok(g.th < 1.6 * g.lh, `the title wraps onto ${Math.round(g.th / g.lh)} lines on a phone (one word per line was the bug)`);
    const overlap = g.tl < g.br && g.bl < g.tr && g.tt < g.bb && g.bt < g.tb;
    assert.equal(overlap, false, 'the title runs under the Back button');
  } finally { c.stop(); }
});

test('3: the Dashboard "Relay sync" row shows the relay\'s sync state, not a permanent dash', { skip, timeout: 60000 }, async () => {
  const c = await startChrome(1280);
  try {
    await c.open('dash');
    const v = await waitFor(c, `document.getElementById('syncMsg').textContent`, v => v && v !== '—');
    // this box runs with no peers, so the honest state is "no other relays" — and /status agrees
    const s = await (await fetch(gw.base + '/status')).json();
    assert.equal(s.sync.peers, 0, 're-anchor: the fixture box has peers');
    assert.equal(v, 'No other relays yet', 'the Relay sync row still reads "—" (or says something /status does not)');
  } finally { c.stop(); }
});

test('4: "Sync now" sits in the Relay health card, says what it does, and works', { skip, timeout: 60000 }, async () => {
  const c = await startChrome(1280);
  try {
    await c.open('dash');
    // the panel takes the admin token from /local-token on its own machine; wait for the unlock
    await waitFor(c, `getComputedStyle(document.getElementById('syncNowBox')).display`, v => v !== 'none');
    const b = JSON.parse(await c.evalIn(`(() => { const e = document.getElementById('syncNow'); const r = e.getBoundingClientRect(); return JSON.stringify({ inHealth: !!e.closest('#healthCard'), inUpdate: !!e.closest('#updateCard'), text: e.textContent.trim(), title: e.title, shown: r.width > 0 && r.height > 0 }); })()`));
    assert.equal(b.inHealth, true, 'the sync button is not in the Relay health card beside the sync rows');
    assert.equal(b.inUpdate, false, 'the sync button is still in the software-update card');
    assert.equal(b.shown, true, 'the sync button is not on screen on the Dashboard');
    assert.equal(b.text, 'Sync now');
    assert.doesNotMatch(b.title, /version|update/i, 'the tooltip still describes a software update check');
    assert.match(b.title, /other relays/i, 'the tooltip does not say it fetches from other relays');
    await c.evalIn(`document.getElementById('syncNow').click()`);
    const msg = await waitFor(c, `document.getElementById('syncNowMsg').textContent`, v => /✓|✗/.test(v || ''));
    assert.match(msg, /✓/, 'pressing Sync now did not report a result under the button: ' + msg);
  } finally { c.stop(); }
});

test('5: the traffic tile says it counts since the relay started — and that is what the number does', { skip, timeout: 60000 }, async () => {
  const c = await startChrome(1280);
  try {
    await c.open('dash');
    const first = await waitFor(c, `document.getElementById('s-traffic').textContent`, v => v && v !== '—' && v !== '0 B');
    const t = JSON.parse(await c.evalIn(`(() => { const st = document.getElementById('s-traffic').closest('.stat'); return JSON.stringify({ label: st.querySelector('.l').textContent, title: st.title }); })()`));
    assert.doesNotMatch(t.label + ' ' + t.title, /session|opened this page/i, 'the tile still claims to count since this page was opened');
    assert.match(t.label, /since start/i);
    assert.match(t.title, /relay last started/i);
    // and it is true: a freshly opened page does not start again from zero
    const bytes = (s) => { const m = String(s).match(/([\d.]+)\s*(B|KB|MB|GB)/); return m ? Number(m[1]) * { B: 1, KB: 1e3, MB: 1e6, GB: 1e9 }[m[2]] : NaN; };
    await c.open('dash');
    const second = await waitFor(c, `document.getElementById('s-traffic').textContent`, v => v && v !== '—');
    assert.ok(bytes(second) >= bytes(first), `a reload reset the traffic figure (${first} -> ${second})`);
  } finally { c.stop(); }
});

test('6: the subscriber download is described as the email list, not phones getting notifications', { skip, timeout: 60000 }, async () => {
  const c = await startChrome(1280);
  try {
    await c.open('set');
    const title = await waitFor(c, `(document.getElementById('dlSubs') || {}).title`, v => typeof v === 'string');
    assert.doesNotMatch(title, /phone|notification/i, 'the download still claims to be a list of phones');
    assert.match(title, /email/i, 'the download tooltip does not say it is the email list');
  } finally { c.stop(); }
});
