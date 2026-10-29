// A RELAY NAME CAN BE RESERVED FROM THE WIZARD AND THE DASHBOARD BEFORE THE BOX IS PUBLIC.
// Run: node --test scripts/relay-name-reserved-in-the-wizard.test.mjs   (headless chromium; skips without it)
//
// fix/reserve-relay-name-before-public, POINT OF USE (CLAUDE.md rule 1). relay-app/control.js ships UNBUNDLED,
// so rule 3 forbids asserting behaviour by matching its source text (a `false && ` in front of a branch leaves
// every word in place). These rows DRIVE THE SHIPPED PAGE in headless Chromium against a REAL empty-data
// gateway and read the laid-out DOM — the same pattern as the-suite-first-run-is-one-guided-path.test.mjs and
// the-relay-panel-does-not-cry-wolf.test.mjs.
//
// What they pin:
//   1. the wizard's name step RESERVES on a not-public box: it reflects "reserved — goes live when you turn on
//      public access" and ADVANCES past the name step (it no longer dead-ends on the old 400 reject).
//   2. the dashboard's name card no longer HIDES its input before the box is public — a name can be reserved
//      there too, and a name already reserved shows as "Reserved: <name>" with the input prefilled.
//
// NOTHING REACHES app.trinityone.church: the gateway's directory is a dead loopback port and a blackhole preload
// rejects any fetch it makes to the hard-coded peers (so the server's fail-open reserve succeeds without the
// network); the browser maps the shipped hosts to a dead port too. Tailscale is forced to a nonexistent binary,
// so the box is never public. Go-public itself (a real tunnel) is the owner's device step — see the handoff.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { freePort } from './relay-network-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PAGE = '/relay-app/control.html';

const BLACKHOLE = `const real = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const u = String(input && input.url ? input.url : input);
  if (/trinityone\\.church|\\.ts\\.net|trycloudflare/i.test(u)) return Promise.reject(new Error('blackholed by test: ' + u));
  return real.call(this, input, init);
};\n`;

const live = new Set();
after(() => { for (const s of live) s.stop(); });

async function startGateway({ seed = {} } = {}) {
  const port = await freePort('the reserve-name test\'s gateway');
  const dataDir = mkdtempSync(join(tmpdir(), 'trin-reserve-ui-'));
  const preload = join(dataDir, 'blackhole.mjs');
  writeFileSync(preload, BLACKHOLE);
  for (const [name, body] of Object.entries(seed)) writeFileSync(join(dataDir, name), body);
  const proc = spawn(process.execPath, [join(ROOT, 'scripts/gateway.mjs'), String(port)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_SYNC: '0', RELAY_HOST: '127.0.0.1', RELAY_NO_OPEN: '1',
      RELAY_DIRECTORY: 'http://127.0.0.1:1', RELAY_DIRECTORY_PEERS: '', TRINITY_TAILSCALE_BIN: '/nonexistent/tailscale',
      NODE_OPTIONS: '--import ' + preload },
  });
  const log = []; proc.stdout.on('data', d => log.push(String(d))); proc.stderr.on('data', d => log.push(String(d)));
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 200 && !up; i++) { try { up = (await fetch(base + '/status')).ok; } catch {} if (!up) await sleep(150); }
  assert.ok(up, 'the gateway never served /status\n' + log.join(''));
  const g = { port, base, dataDir, stop() { live.delete(g); try { proc.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} } };
  live.add(g);
  return g;
}

async function startChrome(url) {
  const cdp = await freePort('the reserve-name test\'s Chrome debug port');
  const prof = mkdtempSync(join(tmpdir(), 'trin-reserve-chrome-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD,
    `--user-data-dir=${prof}`, '--window-size=900,780', url], { stdio: 'ignore' });
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
  const c = { evalIn, stop() { live.delete(c); try { ws.close(); } catch {} try { chr.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} } };
  live.add(c);
  return c;
}

const clickId = (c, id) => c.evalIn(`(() => { const b = document.getElementById('${id}'); if (!b) return 'missing'; b.click(); return 'ok'; })()`);
const typeId = (c, id, val) => c.evalIn(`(() => { const i = document.getElementById('${id}'); if (!i) return 'missing';
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
const waitFor = async (c, expr, what, ms = 30000) => {
  const t0 = Date.now(); let v;
  while (Date.now() - t0 < ms) { try { v = await c.evalIn(expr); } catch { v = undefined; } if (v) return v; await sleep(200); }
  assert.fail('timed out waiting for ' + what + ' (last read: ' + JSON.stringify(v) + ')');
};
// wait until the page has acquired its admin token (loadRelayName's adminFetch self-heals via /local-token),
// so the wizard POST carries the bearer and is not a 401.
const waitForToken = (c) => waitFor(c, `(() => { try { return !!sessionStorage.getItem('to_relay_admin_token'); } catch (e) { return false; } })()`, 'the admin token to be acquired');

test('the wizard name step RESERVES before public: it reflects "reserved" and advances past the name step',
  { skip: !CHROME ? 'no chromium' : false, timeout: 90000 }, async () => {
  const gw = await startGateway();
  const c = await startChrome(gw.base + PAGE + '?setup=relay');
  try {
    await waitFor(c, `document.getElementById('relaySetup') && document.getElementById('relaySetup').classList.contains('show')`, 'the relay wizard to open', 20000);
    await waitForToken(c);
    assert.equal(await clickId(c, 'rswGo'), 'ok', 'no "Get started" on the intro step');
    await waitFor(c, `!!document.getElementById('rswName')`, 'the name step (its input)');
    assert.equal(await typeId(c, 'rswName', 'grace-city'), 'ok');
    assert.equal(await clickId(c, 'rswClaim'), 'ok', 'no "Claim & continue" button');
    // it RESERVES — the reflected message says so (the old build 400-rejected here and dead-ended)
    const msg = await waitFor(c, `(() => { const m = document.getElementById('rswNameMsg'); const t = m ? (m.textContent || '') : ''; return /reserved/i.test(t) ? t : ''; })()`, 'the "reserved" confirmation');
    assert.match(String(msg), /reserved/i);
    assert.match(String(msg), /public access/i, 'the confirmation does not say the name goes live at go-public: ' + msg);
    // and it ADVANCES past the name step (the name input is gone), proving the 200 carried the wizard forward
    assert.equal(await waitFor(c, `document.getElementById('rswName') ? '' : 'advanced'`, 'the wizard to advance past the name step', 6000), 'advanced');
    // the reservation is on the box
    const tok = (await (await fetch(gw.base + '/local-token')).json()).token;
    const m = await (await fetch(gw.base + '/relay-names/mine', { headers: { Authorization: 'Bearer ' + tok } })).json();
    assert.equal(m.handle, 'grace-city', 're-anchor: the gateway did not actually reserve the name the wizard sent');
    assert.equal(m.relayWss, '', 're-anchor: the box must be NOT public for this to be a reservation');
  } finally { c.stop(); gw.stop(); }
});

test('the dashboard name card shows the input BEFORE public (so a name can be reserved there) — not the old hidden state',
  { skip: !CHROME ? 'no chromium' : false, timeout: 90000 }, async () => {
  const gw = await startGateway();
  const c = await startChrome(gw.base + PAGE);
  try {
    await waitForToken(c);
    // the name card renders an input and a "Reserve" button even though the box is not public yet
    const btn = await waitFor(c, `(() => { const go = document.getElementById('relayNameGo'); const inp = document.getElementById('relayNameIn'); return (go && inp) ? (go.textContent || '').trim() : ''; })()`, 'the name input + button in the dashboard card');
    assert.equal(String(btn), 'Reserve', 'the pre-public dashboard button is not "Reserve": ' + btn);
    const body = String(await c.evalIn(`document.getElementById('relayNameBody').innerText`));
    assert.match(body, /turn on public access/i, 'the card does not say the name goes live at go-public: ' + body);
    assert.doesNotMatch(body, /then a name others can type appears here/i, 'the old "no input until public" copy is still shown: ' + body);
  } finally { c.stop(); gw.stop(); }
});

test('the dashboard shows a name already RESERVED as "Reserved: <name>" with the input prefilled and "Update reservation"',
  { skip: !CHROME ? 'no chromium' : false, timeout: 90000 }, async () => {
  const gw = await startGateway({ seed: { 'relay-myname.json': JSON.stringify({ handle: 'grace-city' }) + '\n' } });
  const c = await startChrome(gw.base + PAGE);
  try {
    await waitForToken(c);
    const card = JSON.parse(await waitFor(c, `(() => { const go = document.getElementById('relayNameGo'); const inp = document.getElementById('relayNameIn'); const body = document.getElementById('relayNameBody');
      if (!go || !inp || !body) return ''; return JSON.stringify({ btn: (go.textContent || '').trim(), ph: inp.placeholder, text: body.innerText }); })()`, 'the reserved-name dashboard card'));
    assert.match(card.text, /Reserved:/, 'a reserved name is not shown as "Reserved:" before the box is public: ' + card.text);
    assert.match(card.text, /grace-city/, 'the reserved handle is not shown: ' + card.text);
    assert.equal(card.btn, 'Update reservation', 'the button for an existing reservation is not "Update reservation": ' + card.btn);
    assert.match(String(card.ph), /change reserved name/i, 'the input does not invite changing the reserved name: ' + card.ph);
  } finally { c.stop(); gw.stop(); }
});
