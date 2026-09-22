// The console's sidebar SCROLLS when the window is short. Its last row, "Relay & Suite home", is the only way
// from the console back to the launcher inside the Suite; in a window shorter than ~780px it sat below the
// bottom edge of a column that could not scroll (measured 2026-09-22 at 900x600: the link at y 683..723 in a
// 600px viewport). The owner said yes to making it scroll; this proves it, at the point of use, in Chromium.
// Helpers are the relay-panel test's, verbatim (a real gateway on a scratch dir, production hosts black-holed).
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
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const BLACKHOLE = `const real = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const u = String(input && input.url ? input.url : input);
  if (/trinityone\\.church|\\.ts\\.net|trycloudflare/i.test(u)) return Promise.reject(new Error('blackholed by test: ' + u));
  return real.call(this, input, init);
};\n`;
let gw = null;
async function startGateway() {
  const port = await freePort('the relay-panel test\'s gateway');
  const dataDir = mkdtempSync(join(tmpdir(), 'trin-panel-console-'));
  const preload = join(dataDir, 'blackhole.mjs');
  writeFileSync(preload, BLACKHOLE);
  const log = [];
  const proc = spawn(process.execPath, [join(ROOT, 'scripts/gateway.mjs'), String(port)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_SYNC: '0', RELAY_HOST: '127.0.0.1', RELAY_NO_OPEN: '1',
      RELAY_DIRECTORY: 'http://127.0.0.1:9', TRINITY_TAILSCALE_BIN: '/nonexistent/tailscale', NODE_OPTIONS: '--import ' + preload },
  });
  proc.stdout.on('data', d => log.push(String(d))); proc.stderr.on('data', d => log.push(String(d)));
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 200 && !up; i++) { try { up = (await fetch(base + '/status')).ok; } catch {} if (!up) await sleep(150); }
  assert.ok(up, 'the gateway never served /status');
  const token = () => JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token;
  return { port, base, dataDir, proc, log, token, stop() { try { proc.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} } };
}

async function startChrome(url) {
  const cdp = await freePort('the relay-panel test\'s Chrome debug port');
  const prof = mkdtempSync(join(tmpdir(), 'trin-panel-console-chrome-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD,
    `--user-data-dir=${prof}`, '--window-size=1100,900', url], { stdio: 'ignore' });
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
  const evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr && rr.result && rr.result.exceptionDetails) {
      const e = rr.result.exceptionDetails;
      throw new Error('the page threw: ' + String((e.exception && e.exception.description) || e.text || 'threw').split('\n')[0]);
    }
    return rr && rr.result && rr.result.result ? rr.result.result.value : undefined;
  };
  const goto = async (u) => { await send('Page.navigate', { url: u }); };
  return { evalIn, goto, send, stop() { try { ws.close(); } catch {} try { chr.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} } };
}

before(async () => { gw = await startGateway(); });
after(() => { if (gw) gw.stop(); });

test('at 900x600 the console sidebar can scroll to "Relay & Suite home", and the link is then on screen and hittable',
  { skip: !CHROME ? 'no chromium' : false, timeout: 180000 }, async () => {
  const c = await startChrome('about:blank');
  try {
    await c.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false });
    await c.goto(gw.base + '/steward.html');
    // boot the console the way a person does: Start a new church → PIN → (the wizard is left up; the sidebar is behind it and measurable)
    const waitFor = async (expr, what, ms = 90000) => { const t0 = Date.now(); let ok = false; while (!ok && Date.now() - t0 < ms) { await sleep(500); try { ok = !!(await c.evalIn(expr)); } catch {} } assert.ok(ok, 'timed out waiting for ' + what); };
    await waitFor(`[...document.querySelectorAll('button')].some(x => /Start a new church/i.test((x.textContent||'').trim()))`, 'the setup screen');
    await c.evalIn(`[...document.querySelectorAll('button')].find(x => /Start a new church/i.test((x.textContent||'').trim())).click()`);
    await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('At least 8'))`, 'the PIN gate', 60000);
    const type = (ph, v) => `(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(ph)})); if(!i) return 'miss'; const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
    assert.equal(await c.evalIn(type('At least 8', 'cedar-harbour-lamp-42')), 'ok');
    assert.equal(await c.evalIn(type('Type it again', 'cedar-harbour-lamp-42')), 'ok');
    await c.evalIn(`[...document.querySelectorAll('button')].find(x => /Set PIN/i.test((x.textContent||'').trim())).click()`);
    await waitFor(`!![...document.querySelectorAll('a')].find(a => /Relay & Suite home/.test(a.textContent||''))`, 'the dashboard with its sidebar link');
    await sleep(1500);
    const m = JSON.parse(await c.evalIn(`(() => {
      const a = [...document.querySelectorAll('a')].find(a => /Relay & Suite home/.test(a.textContent||''));
      const side = a.closest('div[style*="232"]') || a.parentElement.parentElement;
      const before = a.getBoundingClientRect();
      const col = (() => { let e = a; while (e && e !== document.body) { const cs = getComputedStyle(e); if (/auto|scroll/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1) return e; e = e.parentElement; } return null; })();
      if (col) col.scrollTop = col.scrollHeight;
      const after = a.getBoundingClientRect();
      const hit = document.elementFromPoint(after.left + after.width / 2, after.top + after.height / 2);
      return JSON.stringify({ vh: innerHeight, before: Math.round(before.bottom), after: Math.round(after.bottom), scrolled: !!col, hit: hit ? (hit === a || a.contains(hit)) : false });
    })()`));
    console.log('    ' + JSON.stringify(m));
    assert.ok(m.scrolled, 'THE DEFECT: no scrolling ancestor — the sidebar cannot scroll, so in a short window the link is off the bottom for ever (link bottom ' + m.before + ' in a ' + m.vh + 'px viewport)');
    assert.ok(m.after <= m.vh, 'after scrolling the sidebar the link is still below the viewport (' + m.after + ' > ' + m.vh + ')');
    assert.equal(m.hit, true, 'the link is on screen but something else answers at its centre');
  } finally { c.stop(); }
});
