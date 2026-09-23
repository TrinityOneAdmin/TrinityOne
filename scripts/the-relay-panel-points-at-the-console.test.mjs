// THE RELAY PANEL POINTS AT THE CONSOLE, AND SAYS SO WHILE THE RELAY HAS NO CHURCH.
// Run: node --test scripts/the-relay-panel-points-at-the-console.test.mjs
//
// Owner, 2026-09-22, first run of the real AppImage: after the relay panel's wizard "no church existed on the
// relay" and nothing said why. Correct — a church is CREATED IN THE CONSOLE, and naming it there registers it
// on this relay (the 2026-09-04 decision) — but the panel had no link to the console at all (measured at
// 2a4e184: zero links or buttons naming the console on control.html), its wizard promised "give it a name,
// and add your church", its Churches card said "Add your church above" and, worse, that an unconfigured relay
// "accepts messages from anyone on the internet" (gateway.mjs accept() has refused every such write for
// months), and the gateway's own boot line sent the operator to "the control dashboard" to set one up.
//
// Every assertion here is read off the DOM in Chromium against a real gateway with an EMPTY data dir — a fresh
// Suite install — never off the source (control.js ships unbundled; CLAUDE.md rule 3's hazard). The shipped
// hosts resolve to a dead port in the browser and are refused inside the gateway; the church registered in
// the last test is a throwaway key. Skips itself without chromium.
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
  return { evalIn, goto, stop() { try { ws.close(); } catch {} try { chr.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} } };
}

before(async () => { if (CHROME) gw = await startGateway(); });
after(() => { if (gw) gw.stop(); });

// ON SCREEN, not merely in the DOM: rendered with a size, and no ancestor display:none.
const SHOWN = `(id) => { const e = document.getElementById(id); if (!e) return 'missing'; const r = e.getBoundingClientRect(); return (r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden') ? 'shown' : 'hidden'; }`;
const link = (c, id) => c.evalIn(`(() => { const e = document.getElementById('${id}'); return e ? JSON.stringify({ href: e.href, text: (e.textContent || '').replace(/\\s+/g, ' ').trim(), shown: (${SHOWN})('${id}') }) : 'null'; })()`).then(s => JSON.parse(s));
const waitFor = async (c, expr, want, ms = 10000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await c.evalIn(expr); if (v === want) return v; await sleep(300); } return v; };

test('with no church, the panel shows ONE next-step card: heading, sentence, and a button that opens the console',
  { skip: !CHROME ? 'no chromium' : false, timeout: 90000 }, async () => {
  const c = await startChrome(gw.base + '/relay-app/control.html');
  try {
    assert.equal(await waitFor(c, `(${SHOWN})('nextStep')`, 'shown'), 'shown',
      'THE PANEL SAYS NOTHING ABOUT THE CHURCH. The relay has no church, and the church is created in the console, ' +
      'not here — this is the card that says so, and it is not on screen.');
    const card = JSON.parse(await c.evalIn(`(() => { const e = document.getElementById('nextStep'); return JSON.stringify({ h: (e.querySelector('h2') || {}).textContent || '', p: (e.querySelector('.muted') || {}).textContent || '' }); })()`));
    assert.equal(card.h.trim(), 'Your relay is running', 'the card’s heading is not the agreed one');
    assert.equal(card.p.trim(), 'Now set up your church — it is created in the console, not here.', 'the card’s sentence is not the agreed one');
    const b = await link(c, 'nextStepConsole');
    assert.equal(b.shown, 'shown', 'the card has no visible button');
    assert.equal(b.text, 'Open the console', 'the button does not say "Open the console"');
    assert.equal(b.href, gw.base + '/steward.html', 'the button does not open the console served by this relay');
    // …and that address IS the console: the gateway serves it.
    const r = await fetch(b.href, { redirect: 'manual' });
    assert.equal(r.status, 200, 'the console link answers ' + r.status);
    assert.match(String(r.headers.get('content-type')), /text\/html/, 'the console link is not a page');
    // Exactly one such card.
    assert.equal(await c.evalIn(`document.querySelectorAll('#nextStep').length`), 1);
  } finally { c.stop(); }
});

test('"Open the console" sits beside "← Back" in the panel’s header, and resolves',
  { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
  const c = await startChrome(gw.base + '/relay-app/control.html');
  try {
    await sleep(1500);
    const a = await link(c, 'goConsole');
    assert.equal(a.shown, 'shown', 'THE PANEL HAS NO VISIBLE WAY TO THE CONSOLE. Measured at 2a4e184: zero links or buttons naming it.');
    assert.equal(a.text, 'Open the console');
    assert.equal(a.href, gw.base + '/steward.html', 'the header link does not open the console served by this relay');
    // Beside Back: the same header row, Back first.
    const order = await c.evalIn(`(() => { const back = document.getElementById('openConsole'), go = document.getElementById('goConsole'); if (!back || !go) return 'missing'; if (back.parentElement !== go.parentElement) return 'apart'; return back.compareDocumentPosition(go) & Node.DOCUMENT_POSITION_FOLLOWING ? 'back-then-console' : 'console-then-back'; })()`);
    assert.equal(order, 'back-then-console', 'the console link is not beside the Back button (' + order + ')');
    // The same door the launcher's "Run your church" offers — one console, one address.
    const home = await (await fetch(gw.base + '/relay-app/home.html')).text();
    assert.ok(home.includes('href="/steward.html"'), 're-anchor: the launcher’s console door no longer uses /steward.html');
  } finally { c.stop(); }
});

test('the wizard never promises "add your church", and its last step opens the console on a box with no church',
  { skip: !CHROME ? 'no chromium' : false, timeout: 90000 }, async () => {
  const c = await startChrome(gw.base + '/relay-app/control.html');
  try {
    // On this relay's own machine the panel gets the admin token from /local-token and the wizard opens itself.
    assert.equal(await waitFor(c, `document.getElementById('relaySetup').classList.contains('show')`, true), true, 'the first-run wizard did not open on a fresh box');
    const welcome = String(await c.evalIn(`document.getElementById('rswCard').innerText`));
    assert.doesNotMatch(welcome, /add your church/i, 'the welcome step still promises a church-adding step this wizard does not have');
    assert.match(welcome, /created in the console/i, 'the welcome step does not say where the church is created');
    const click = (id) => c.evalIn(`(() => { const b = document.getElementById('${id}'); if (!b) return 'missing'; b.click(); return 'ok'; })()`);
    assert.equal(await click('rswGo'), 'ok');                                   // → name
    assert.equal(await click('rswSkip'), 'ok');                                 // → church (the automatic card)
    assert.match(String(await c.evalIn(`document.getElementById('rswCard').innerText`)), /console/i, 'the church step does not name the console');
    assert.equal(await click('rswSkip'), 'ok');                                 // → stays on?
    assert.equal(await click('rswOnYes'), 'ok');                                // → done
    const done = String(await c.evalIn(`document.getElementById('rswCard').innerText`));
    assert.match(done, /created in the console, not here/i, 'the done step does not say the church is created in the console');
    const a = await link(c, 'rswConsole');
    assert.equal(a.shown, 'shown', 'the done step offers no "Open the console" step on a box with no church');
    assert.equal(a.href, gw.base + '/steward.html');
    // Follow it: lands on the console, and the wizard counts as seen so it never re-opens over the panel.
    assert.equal(await click('rswConsole'), 'ok');
    await sleep(2000);
    assert.equal(await c.evalIn('location.href'), gw.base + '/steward.html', 'the console step did not open the console');
    await c.goto(gw.base + '/relay-app/control.html');
    await sleep(2500);
    assert.equal(await c.evalIn(`document.getElementById('relaySetup').classList.contains('show')`), false, 'the wizard re-opened after the console step was taken');
    // WHAT KEEPS IT SHUT IS THE PER-VISIT DISMISSAL, NOT A CLAIM THAT THE BOX IS SET UP. At the moment this
    // link is taken the box still holds nothing — the church is created in the console, after the click — so
    // writing the launcher's "set up" marker here was a claim about the future (AUDIT-round-c C3).
    assert.equal(await c.evalIn(`localStorage.getItem('to_relay_setup_seen')`), null, 'the console step marked the box "set up" while it still held nothing');
    assert.equal(await c.evalIn(`sessionStorage.getItem('to_relay_setup_skipped')`), '1', 'the console step did not dismiss the wizard for this visit');
    // The Churches card (Settings) says it too, without the old false claim about accepting the whole internet.
    const cfg = String(await c.evalIn(`document.getElementById('cfgList').innerText`));
    assert.match(cfg, /created in the console/i, 'the empty Churches card does not say where a church is created');
    assert.doesNotMatch(cfg, /anyone on the internet/i, 'the Churches card still claims an unconfigured relay accepts writes from anyone — accept() refuses them');
    assert.equal((await link(c, 'cfgNoneConsole')).href, gw.base + '/steward.html');
  } finally { c.stop(); }
});

test('once a church is registered, the next-step card goes away', { skip: !CHROME ? 'no chromium' : false, timeout: 90000 }, async () => {
  const c = await startChrome(gw.base + '/relay-app/control.html');
  try {
    assert.equal(await waitFor(c, `(${SHOWN})('nextStep')`, 'shown'), 'shown', 're-anchor: the card is not shown before a church exists');
    // Register a throwaway church the way the panel's own "Add" does: POST /config with the admin token.
    const npub = npubEncode(getPublicKey(generateSecretKey()));
    const r = await fetch(gw.base + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + gw.token() }, body: JSON.stringify({ addChurch: { npub, name: '' } }) });
    assert.equal(r.status, 200, 'registering the church failed: ' + await r.text());
    assert.equal((await (await fetch(gw.base + '/status')).json()).writePolicy, true, 're-anchor: /status does not report the church');
    // The panel polls /status every 5 s.
    assert.equal(await waitFor(c, `(${SHOWN})('nextStep')`, 'hidden', 12000), 'hidden',
      'THE CARD STAYS UP AFTER THE CHURCH IS REGISTERED — it now tells a steward with a church to go and create one.');
    // And a fresh load agrees.
    await c.goto(gw.base + '/relay-app/control.html');
    await sleep(2500);
    assert.equal(await c.evalIn(`(${SHOWN})('nextStep')`), 'hidden', 'a reloaded panel shows the card over a relay that has a church');
    // …while the way to the console stays.
    assert.equal((await link(c, 'goConsole')).shown, 'shown', 'the header link to the console disappeared with the card');
  } finally { c.stop(); }
});

test('the gateway’s boot line sends a church-less operator to the console, not "the control dashboard"', { skip: !CHROME ? 'no chromium' : false }, () => {
  // Read from the process's own stdout: the line the owner reads in a terminal or the Suite's log.
  const line = gw.log.join('').split('\n').find(l => /NO CHURCH CONFIGURED/.test(l)) || '';
  assert.ok(line, 'the gateway no longer prints NO CHURCH CONFIGURED for an empty data dir — re-anchor this test');
  assert.doesNotMatch(line, /control dashboard/i, 'the boot line still sends the operator to the control dashboard to set up a church: ' + line);
  assert.match(line, /Steward console/, 'the boot line does not name the Steward console: ' + line);
  assert.ok(line.includes(`http://localhost:${gw.port}/steward.html`), 'the boot line does not give the console’s address: ' + line);
});
