// THE SUITE'S FIRST RUN IS ONE GUIDED PATH THROUGH THE TWO WIZARDS, AND IT ENDS ON THE LAUNCHER.
// Run: node --test scripts/the-suite-first-run-is-one-guided-path.test.mjs
//
// Owner, 2026-09-22, after his own first run of the real AppImage: a first-time person still could not tell
// which door to take. Measured at 6b6e66d (headless Chromium, empty-data gateway, fresh profile): the launcher
// showed "What should this computer do for your church?" and the two doors — nothing that told a first-time
// person which to take. The decision (PLAN-suite-fixes §B4, verbatim): NOT a third wizard. While nothing has
// been set up the launcher shows ONE card — "Set up everything" (recommended) / "Just a relay" / "Just the
// console" — and the two wizards that exist are joined by a thread: the relay wizard's done step points at the
// console on the "everything" path, the console wizard's done step has "Back to the Suite" on the Suite, and
// every path ends on the LAUNCHER, which by then shows its two doors and never the card again.
//
// "SET UP" is read from what exists, not only from a marker: /status.writePolicy (a church on this box) and
// /relay-names/mine.handle (a relay name) beat a missing marker — a fresh webview profile against a box that
// already has a church gets the doors. The markers are the two the wizards already write on finish or skip
// (`to_relay_setup_seen`, `trinityone.steward.wizard.done`); this branch adds no new one.
//
// POINT OF USE (CLAUDE.md rule 1) and rule 3: every browser row reads the DOM of the shipped pages — the
// launcher, the panel and the console, served by a real gateway with an EMPTY data dir — and clicks what a
// person clicks. The one harness row RUNS the real StewSetupWizard under the miniature React and reads its
// tree; nothing matches text in app/*.jsx or relay-app/*.js. NOTHING REACHES PRODUCTION: the shipped hosts
// resolve to a dead port in the browser and are refused inside every gateway; this dev box's real Tailscale
// is kept out with TRINITY_TAILSCALE_BIN. Skips itself without chromium.
//
// NOT DRIVEN HERE, deliberately: claiming a relay NAME in the wizard — the gateway refuses a claim until the
// relay is public ("your relay isn't reachable from the internet yet"), so on a fresh loopback box the name
// step can only be skipped; the "named relay" signal is seeded on disk (relay-myname.json) instead, which is
// the file the gateway reads at boot.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { chmodSync, existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { freePort } from './relay-network-harness.mjs';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';
import { npubEncode } from 'nostr-tools/nip19';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const HOME = '/relay-app/home.html';

const BLACKHOLE = `const real = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const u = String(input && input.url ? input.url : input);
  if (/trinityone\\.church|\\.ts\\.net|trycloudflare/i.test(u)) return Promise.reject(new Error('blackholed by test: ' + u));
  return real.call(this, input, init);
};\n`;

// ── THE LAUNCHER'S CEILING, AND THE BUDGETS IT IS DERIVED FROM, READ OUT OF THE TWO FILES ────────────
// Structural, and it has to be: the ceiling is armed in relay-app/home.js BEFORE any fetch, so it cannot be
// served to the page, and the budgets it must clear are spawn timeouts in scripts/gateway.mjs. Nothing at
// runtime can hold the two together. AUDIT-round-c C1 is what happens without this: raising tsState()'s
// first budget 8000 → 22000 put the launcher back on the two doors at 25 168 ms for a box that answered at
// 34 045 ms — AUDIT-suite-B4 N1 verbatim — and this very file stayed 9 pass / 0 fail.
// Rule 3 does not bite: nothing here asserts BEHAVIOUR by matching text. What these numbers DO is measured
// in Chromium by rows 1b(d) and 1c, which also check the ceiling fires where these numbers say it will.
function firstRunNumbers() {
  const gw = readFileSync(join(ROOT, 'scripts/gateway.mjs'), 'utf8');
  const home = readFileSync(join(ROOT, 'relay-app/home.js'), 'utf8');
  const decl = gw.match(/\nconst TS_STATE_BUDGETS_MS = \{([^}]*)\};/);
  assert.ok(decl, 'scripts/gateway.mjs no longer declares TS_STATE_BUDGETS_MS — the launcher\'s first-run ceiling is derived from it (AUDIT-round-c C1)');
  // The value must be a BARE INTEGER, ending where the entry ends. `(\d+)` alone took the first number
  // after the key, so `status: 8000 * 2` read as 8000 and this row stayed green over a route that really
  // cost 28 038 ms against a 25 000 ceiling. A budget this test cannot sum is a budget it must not count:
  // the entry then drops out and the tsRun-count assertion below says so.
  const budgets = [...decl[1].matchAll(/([A-Za-z0-9_]+)\s*:\s*([0-9]+)\s*(?=[,}]|$)/g)].map(m => ({ name: m[1], ms: Number(m[2]) }));
  const sum = budgets.reduce((a, b) => a + b.ms, 0);
  const start = gw.indexOf('async function tsState() {');
  assert.ok(start > 0, 'scripts/gateway.mjs has no tsState() — the launcher waits on it through /relay-names/mine');
  const body = gw.slice(start, gw.indexOf('\n}\n', start));
  const spawns = (body.match(/tsRun\(/g) || []).length;
  const named = (body.match(/timeoutMs: TS_STATE_BUDGETS_MS\.[A-Za-z0-9_]+/g) || []).length;
  const num = (name) => {
    const m = home.match(new RegExp('\\n  var ' + name + ' = (\\d+);'));
    assert.ok(m, 'relay-app/home.js no longer declares ' + name + ' — the ceiling is derived from tsState()\'s budgets and must say so in numbers a test can read (AUDIT-round-c C1)');
    return Number(m[1]);
  };
  const budget = num('FIRST_RUN_TS_BUDGET_MS'), margin = num('FIRST_RUN_CEILING_MARGIN_MS');
  return { budgets, sum, spawns, named, budget, margin, ceiling: budget + margin };
}

const live = new Set();
after(() => { for (const s of live) s.stop(); });

// A fresh Suite install: an EMPTY data dir (or one seeded with exactly the file named), loopback, no origin.
async function startGateway({ seed = {}, env: extraEnv = {} } = {}) {
  const port = await freePort('the guided-path test\'s gateway');
  const dataDir = mkdtempSync(join(tmpdir(), 'trin-guided-'));
  const preload = join(dataDir, 'blackhole.mjs');
  writeFileSync(preload, BLACKHOLE);
  for (const [name, body] of Object.entries(seed)) writeFileSync(join(dataDir, name), body);
  const log = [];
  const proc = spawn(process.execPath, [join(ROOT, 'scripts/gateway.mjs'), String(port)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_SYNC: '0', RELAY_HOST: '127.0.0.1', RELAY_NO_OPEN: '1',
      RELAY_DIRECTORY: 'http://127.0.0.1:9', TRINITY_TAILSCALE_BIN: '/nonexistent/tailscale', NODE_OPTIONS: '--import ' + preload, ...extraEnv },
  });
  proc.stdout.on('data', d => log.push(String(d))); proc.stderr.on('data', d => log.push(String(d)));
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 200 && !up; i++) { try { up = (await fetch(base + '/status')).ok; } catch {} if (!up) await sleep(150); }
  assert.ok(up, 'the gateway never served /status\n' + log.join(''));
  const g = { port, base, dataDir, proc, log, stop() { live.delete(g); try { proc.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} } };
  live.add(g);
  return g;
}

// A box with tailscale INSTALLED but wedged: the CLI takes `seconds` to say tailscaled is down. The gateway's
// /relay-names/mine calls tsState() before it answers (ownUrl), so that route takes at least this long on such
// a box — which is what a genuine first run on a machine where "Go public" was ever tried looks like.
function slowTailscale(dataDir, seconds) {
  const bin = join(dataDir, 'tailscale');
  writeFileSync(bin, '#!/bin/sh\nsleep ' + seconds + '\necho "failed to connect to local tailscaled; is it running?" >&2\nexit 1\n');
  chmodSync(bin, 0o755);
  return bin;
}
// A box whose tailscale ANSWERS THE FIRST QUESTION AND THEN HANGS. This is the only shape that reaches all
// THREE of tsState()'s spawns: anything that fails to parse takes its early return after the first one, so
// the 4-second fake above exercises ~4 s of a 20 s worst case and can never notice the ceiling moving under
// it (AUDIT-round-c C1/C2). `status --json` prints parseable JSON and then sleeps; `serve status` and
// `funnel status` print nothing and sleep. tsRun's budget resolves with whatever was printed by then, so
// tsState pays every budget in full and still answers honestly (no funnel → no public URL → handle "").
function hangingTailscale(dataDir) {
  const bin = join(dataDir, 'tailscale-hang');
  writeFileSync(bin, [
    '#!/bin/sh',
    'if [ "$1" = "status" ] && [ "$2" = "--json" ]; then',
    '  echo \'{"BackendState":"Running","Self":{"DNSName":"box.example.ts.net."}}\'',
    'fi',
    'exec sleep 30',
    '',
  ].join('\n'));
  chmodSync(bin, 0o755);
  return bin;
}
// A front in front of a REAL gateway that answers one route with a 500 and hands everything else through — the
// pages, the scripts and the other routes are the shipped ones. `stop()` closes it.
async function startBrokenFront(gw, brokenRoute) {
  const port = await freePort('the guided-path test\'s broken front');
  const srv = createServer((req, res) => {
    if ((req.url || '').split('?')[0] === brokenRoute) { res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end('{"error":"broken by test"}'); return; }
    const up = httpRequest({ host: '127.0.0.1', port: gw.port, method: req.method, path: req.url, headers: { ...req.headers, host: '127.0.0.1:' + gw.port } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { try { res.writeHead(502); res.end(); } catch {} });
    req.pipe(up);
  });
  await new Promise(r => srv.listen(port, '127.0.0.1', r));
  const f = { port, base: `http://127.0.0.1:${port}`, stop() { live.delete(f); try { srv.closeAllConnections(); srv.close(); } catch {} } };
  live.add(f);
  return f;
}

// A front in front of a REAL gateway that ACCEPTS one route and never answers it — the socket stays open, no
// status line is ever written — and hands everything else through. This is a route-level stall, not a box that
// cannot serve HTML: the launcher, its scripts and every other route load perfectly from the same front. It is
// the case `fetch` has no timeout for, so nothing but a ceiling in home.js can end it. `stop()` closes it and
// destroys the held sockets.
async function startStallingFront(gw, stalledRoute) {
  const port = await freePort('the guided-path test\'s stalling front');
  const held = new Set();
  const srv = createServer((req, res) => {
    if ((req.url || '').split('?')[0] === stalledRoute) { held.add(res); req.socket.setKeepAlive(true); return; }   // accepted, never answered
    const up = httpRequest({ host: '127.0.0.1', port: gw.port, method: req.method, path: req.url, headers: { ...req.headers, host: '127.0.0.1:' + gw.port } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { try { res.writeHead(502); res.end(); } catch {} });
    req.pipe(up);
  });
  await new Promise(r => srv.listen(port, '127.0.0.1', r));
  const f = { port, base: `http://127.0.0.1:${port}`, held, stop() { live.delete(f); for (const r of held) { try { r.destroy(); } catch {} } try { srv.closeAllConnections(); srv.close(); } catch {} } };
  live.add(f);
  return f;
}

async function startChrome(url) {
  const cdp = await freePort('the guided-path test\'s Chrome debug port');
  const prof = mkdtempSync(join(tmpdir(), 'trin-guided-chrome-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD,
    `--user-data-dir=${prof}`, '--window-size=900,780', url], { stdio: 'ignore' });   // the Suite's own window size (tauri.conf.json)
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
  const c = { evalIn, goto, send, stop() { live.delete(c); try { ws.close(); } catch {} try { chr.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} } };
  live.add(c);
  return c;
}

// ── reading the pages ────────────────────────────────────────────────────────────────────────────────────
// ON SCREEN, not merely in the DOM: rendered with a size, no ancestor display:none, not visibility:hidden.
const ON = `(e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; }`;
const clickId = (c, id) => c.evalIn(`(() => { const b = document.getElementById('${id}'); if (!b) return 'missing'; b.click(); return 'ok'; })()`);
const clickButton = (c, re) => c.evalIn(`(() => { const b = [...document.querySelectorAll('button')].find(x => ${re}.test((x.textContent || '').replace(/\\s+/g, ' ').trim())); if (!b) return 'missing'; b.click(); return 'ok'; })()`);
const typeInto = (c, pick, val) => c.evalIn(`(() => { const i = ${pick}; if (!i) return 'missing';
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
const byPlaceholder = (ph) => `[...document.querySelectorAll('input')].find(x => (x.placeholder || '').includes(${JSON.stringify(ph)}))`;
const waitFor = async (c, expr, what, ms = 60000) => {
  const t0 = Date.now(); let v;
  while (Date.now() - t0 < ms) { try { v = await c.evalIn(expr); } catch { v = undefined; } if (v) return v; await sleep(300); }
  assert.fail('timed out waiting for ' + what + ' (last read: ' + JSON.stringify(v) + ')');
};
const bodyText = (c) => c.evalIn('document.body.innerText').then(String);

// What the launcher shows: which of the card and the doors is on screen, and the card's three choices.
const readLauncher = (c) => c.evalIn(`(() => { const on = ${ON};
  const a = (id) => { const e = document.getElementById(id); return e ? { href: e.getAttribute('href'), text: (e.textContent || '').replace(/\\s+/g, ' ').trim(), on: on(e) } : null; };
  return JSON.stringify({ decided: document.body.getAttribute('data-first-run'), card: on(document.getElementById('firstRun')),
    doors: [...document.querySelectorAll('a.mode')].map(on), all: a('setupAll'), relay: a('setupRelay'), console: a('setupConsole') }); })()`).then(JSON.parse);
const launcherSettled = (c) => waitFor(c, `document.body.getAttribute('data-first-run')`, 'the launcher to decide card-or-doors', 10000);

// The relay wizard's done step, as a person reads it: the sentence, and every footer control in order.
const readRswDone = (c) => c.evalIn(`(() => { const on = ${ON}; const card = document.getElementById('rswCard'); if (!card) return 'null';
  const foot = card.querySelector('.rsw-foot');
  const ctl = (e) => ({ id: e.id, tag: e.tagName.toLowerCase(), text: (e.textContent || '').replace(/\\s+/g, ' ').trim(), href: e.getAttribute('href'), primary: e.classList.contains('btn-clay'), on: on(e) });
  return JSON.stringify({ heading: (card.querySelector('.rsw-h') || {}).textContent || '', sub: (card.querySelector('.rsw-sub') || {}).textContent || '',
    foot: foot ? [...foot.querySelectorAll('a,button')].map(ctl) : [], steps: [...card.querySelectorAll('.rsw-step')].map(e => e.id) }); })()`).then(JSON.parse);

// Walk the relay wizard the way a person on a fresh, not-yet-public box can: Get started → (a name cannot be
// claimed before going public, so) Skip for now → Continue past the church card → Yes, it stays on → done.
async function walkRelayWizard(c) {
  await waitFor(c, `document.getElementById('relaySetup') && document.getElementById('relaySetup').classList.contains('show')`, 'the relay wizard to open', 20000);
  assert.equal(await clickId(c, 'rswGo'), 'ok', 'no "Get started"');
  assert.equal(await clickId(c, 'rswSkip'), 'ok', 'no "Skip for now" on the name step');
  assert.match(String(await c.evalIn(`document.getElementById('rswCard').innerText`)), /console/i, 'staging: the church step is not up');
  assert.equal(await clickId(c, 'rswSkip'), 'ok', 'no "Continue" on the church step');
  assert.equal(await clickId(c, 'rswOnYes'), 'ok', 'no "Yes, it stays on"');
  const done = await readRswDone(c);
  assert.equal(done.heading.trim(), 'Your relay is ready', 'staging: the done step is not up — ' + JSON.stringify(done));
  return done;
}

// Walk the console's own wizard from its setup screen to "You're all set": Start a new church → PIN → name →
// the twelve words (written down, three of them typed back from the words the page itself holds) → the PIN
// step skips itself (already locked) → groups → meetings → team → done. Everything after the words is taken
// with its own primary button, whatever it offers; a step that cannot save is left by the escape it shows.
async function walkConsoleWizard(c, churchName) {
  await waitFor(c, `[...document.querySelectorAll('button')].some(x => /Start a new church/i.test((x.textContent || '').trim()))`, 'the console\'s setup screen', 90000);
  assert.equal(await clickButton(c, '/Start a new church/i'), 'ok');
  await waitFor(c, `[...document.querySelectorAll('input')].some(x => (x.placeholder || '').includes('At least 8'))`, 'the PIN gate');
  assert.equal(await typeInto(c, byPlaceholder('At least 8'), 'cedar-harbour-lamp-42'), 'ok');
  assert.equal(await typeInto(c, byPlaceholder('Type it again'), 'cedar-harbour-lamp-42'), 'ok');
  assert.equal(await clickButton(c, '/Set PIN/i'), 'ok');
  await waitFor(c, `!!document.querySelector('input[aria-label="Church name"]')`, 'the wizard\'s name step', 90000);
  await sleep(1200);
  assert.equal(await typeInto(c, `document.querySelector('input[aria-label="Church name"]')`, churchName), 'ok');
  await sleep(200);
  assert.equal(await clickButton(c, '/^Continue$/'), 'ok', 'no Continue on the name step');
  await waitFor(c, `!![...document.querySelectorAll('div')].find(d => d.children.length === 0 && /recovery key/.test(d.textContent || ''))`, 'the recovery-key step', 90000);
  // the words, from the page's own key — the quiz then wants three of them back
  const phrase = String(await c.evalIn(`window.Steward.exportMnemonic() || ''`));
  const words = phrase.trim().split(/\s+/);
  assert.equal(words.length, 12, 'the church has no 12-word phrase to write down');
  assert.equal(await c.evalIn(`(() => { const cb = [...document.querySelectorAll('input[type="checkbox"]')].find(x => /written these 12 words/.test((x.closest('label') || {}).textContent || '')); if (!cb) return 'missing'; cb.click(); return 'ok'; })()`), 'ok', 'no "I’ve written these 12 words" box');
  await waitFor(c, `document.querySelectorAll('input[aria-label^="Word "]').length === 3`, 'the three quiz boxes');
  const asked = JSON.parse(await c.evalIn(`JSON.stringify([...document.querySelectorAll('input[aria-label^="Word "]')].map(i => i.getAttribute('aria-label')))`));
  for (const label of asked) {
    const n = Number((label.match(/Word (\d+)/) || [])[1]);
    assert.ok(n >= 1 && n <= 12, 'a quiz box asks for ' + label);
    assert.equal(await typeInto(c, `document.querySelector('input[aria-label=${JSON.stringify(label)}]')`, words[n - 1]), 'ok');
  }
  await waitFor(c, `!![...document.querySelectorAll('button')].find(x => /^Continue$/.test((x.textContent || '').trim()) && !x.disabled)`, 'Continue to unlock after the quiz');
  assert.equal(await clickButton(c, '/^Continue$/'), 'ok');
  // groups → meetings → team → done, each by its own primary; an escape if a save fails
  const TITLE = `(() => { const t = [...document.querySelectorAll('div')].find(d => d.children.length === 0 && /^(Create a few spaces|Your regular meetings|Serving rota|You’re all set 🎉)$/.test((d.textContent || '').trim())); return t ? t.textContent.trim() : ''; })()`;
  let last = '';
  for (let i = 0; i < 40; i++) {
    const now = String(await waitFor(c, TITLE, 'a wizard step after the words (last seen: ' + last + ')', 60000));
    if (/all set/.test(now)) return;
    // the meetings step's escape after a failed save (measured: the pre-filled rows cannot be saved on a fresh
    // loopback box and the step says so after ~8 s) — take it whenever it is offered
    if (await clickButton(c, '/Skip for now and finish setup/') === 'ok') { last = ''; await sleep(1500); continue; }
    if (now === last) { await sleep(1500); continue; }   // still saving — the button is disabled while busy
    last = now;
    if (/Create a few spaces/.test(now)) assert.equal(await clickButton(c, '/& continue|^Skip for now/'), 'ok', 'no primary on the groups step');
    else if (/regular meetings/.test(now)) assert.equal(await clickButton(c, '/& continue|^Skip for now/'), 'ok', 'no primary on the meetings step');
    else if (/Serving rota/.test(now)) assert.equal(await clickButton(c, '/do this later|Create team/'), 'ok', 'no primary on the team step');
    await sleep(1500);
  }
  assert.fail('the console wizard never reached "You’re all set" (last step seen: ' + last + ')');
}

// ── 1. the first launch ───────────────────────────────────────────────────────────────────────────────────
test('a first launch shows ONE card with three choices — not the two doors — and the words name all three',
  { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
  const gw = await startGateway();
  const c = await startChrome(gw.base + HOME);
  try {
    assert.equal(await launcherSettled(c), 'card', 'A FIRST-TIME PERSON GETS THE TWO DOORS AND NOTHING SAYS WHICH TO TAKE (measured at 6b6e66d). The launcher decided "' + (await c.evalIn(`document.body.getAttribute('data-first-run')`)) + '".');
    const L = await readLauncher(c);
    assert.equal(L.card, true, 'the first-run card is not on screen: ' + JSON.stringify(L));
    assert.deepEqual(L.doors, [false, false], 'a door is on screen beside the card: ' + JSON.stringify(L));
    assert.deepEqual([L.all.on, L.relay.on, L.console.on], [true, true, true], 'a choice is not on screen: ' + JSON.stringify(L));
    assert.equal(L.all.href, '/relay-app/control.html?setup=everything', '"Set up everything" does not open the relay wizard on the everything path');
    assert.equal(L.relay.href, '/relay-app/control.html?setup=relay', '"Just a relay" does not open the relay wizard on the relay path');
    assert.equal(L.console.href, '/steward.html', '"Just the console" does not open the console');
    assert.match(L.all.text, /^Set up everything Recommended /, 'the recommended choice is not marked so: ' + L.all.text);
    assert.match(L.relay.text, /^Just a relay /); assert.match(L.console.text, /^Just the console /);
    const text = await bodyText(c);
    for (const s of ['First time here? Set this computer up.', 'Set up everything', 'Just a relay', 'Just the console']) assert.ok(text.includes(s), 'the page does not say "' + s + '":\n' + text);
    assert.doesNotMatch(text, /What should this computer do/, 'the doors\' question is on screen under the card');
    // the honest signals, as the box reports them right now: no church, no name
    assert.equal((await (await fetch(gw.base + '/status')).json()).writePolicy, false, 're-anchor: the fresh box claims a church');
  } finally { c.stop(); gw.stop(); }
});

// ── 1b. a slow answer is not "no" — and a box that cannot answer gets the doors ───────────────────────────
// AUDIT-suite-B4 N1: home.js waited on /status and /relay-names/mine with a 2.5 s fallback to the doors, and
// /relay-names/mine calls tsState() first — up to three tailscale spawns (8 s + 6 s + 6 s budgets) before it will
// say what its `handle` is. Measured by the auditor with a fake tailscale that takes 4 s to say tailscaled is down:
// /relay-names/mine 4026 ms, the launcher decided DOORS, the card never shown. Tailscale is one of the Suite's
// own "Go public" routes, so a box with it installed and wedged is not exotic. The rule now: a slow answer is
// waited for (the page says it is checking); only a box that cannot answer at all — a network error or a non-2xx
// on either question — gets the doors, because "first time here" is a claim this page will not make blind.
test('a slow /relay-names/mine still gets the card — the launcher waits for the answer; a box that cannot answer at all gets the doors',
  { skip: !CHROME ? 'no chromium' : false, timeout: 300000 }, async () => {
  // (a) tailscale installed and wedged: the name question takes ~4 s
  const dir = mkdtempSync(join(tmpdir(), 'trin-guided-ts-'));
  const gw = await startGateway({ env: { TRINITY_TAILSCALE_BIN: slowTailscale(dir, 4) } });
  let c = null, front = null, front2 = null, gw2 = null, dir2 = null;
  try {
    // re-anchor: the box really is slow on that one question
    const tok = (await (await fetch(gw.base + '/local-token')).json()).token;
    const t0 = Date.now();
    const nm = await (await fetch(gw.base + '/relay-names/mine', { headers: { Authorization: 'Bearer ' + tok } })).json();
    const took = Date.now() - t0;
    assert.ok(took >= 3500, 're-anchor: /relay-names/mine answered in ' + took + ' ms — the fake tailscale did not slow it, so this row measures nothing');
    assert.equal(nm.handle, '', 're-anchor: the fresh box claims a name');
    c = await startChrome(gw.base + HOME);
    // while it waits: neither the card nor the doors, and the page says why
    const early = await c.evalIn(`(() => { const on = ${ON}; return JSON.stringify({ decided: document.body.getAttribute('data-first-run'), card: on(document.getElementById('firstRun')), doors: [...document.querySelectorAll('a.mode')].map(on), checking: on(document.getElementById('checking')), text: document.body.innerText }); })()`).then(JSON.parse);
    const decided = await launcherSettled(c);
    assert.equal(decided, 'card', 'A GENUINE FIRST RUN ON A BOX WITH A SLOW TAILSCALE GETS THE TWO DOORS (AUDIT-suite-B4 N1): the launcher timed out and decided "' + decided + '" instead of waiting for the answer');
    const L = await readLauncher(c);
    assert.deepEqual([L.card, L.doors], [true, [false, false]], JSON.stringify(L));
    // and what it showed while it waited
    assert.equal(early.decided, null, 'the launcher decided "' + early.decided + '" before the box answered: ' + JSON.stringify(early));
    assert.deepEqual([early.card, early.doors], [false, [false, false]], 'a card or a door is on screen before the box answered: ' + JSON.stringify(early));
    assert.equal(early.checking, true, 'nothing on screen says the box is being checked while the launcher waits: ' + early.text);
    assert.match(early.text, /Checking this computer/, early.text);
    assert.equal(await c.evalIn(`(${ON})(document.getElementById('checking'))`), false, 'the "checking" line is still on screen after the launcher decided');
    c.stop(); c = null;
    // (b) a box that cannot answer the name question at all (a 500 on /relay-names/mine): the doors, not a claim
    front = await startBrokenFront(gw, '/relay-names/mine');
    c = await startChrome(front.base + HOME);
    assert.equal(await launcherSettled(c), 'doors', 'A BOX THAT CANNOT SAY WHETHER IT HAS A NAME WAS TOLD "FIRST TIME HERE" — a failed answer must be the doors, not the card');
    assert.deepEqual((await readLauncher(c)).doors, [true, true]);
    c.stop(); c = null;
    // (c) and one that cannot answer /status either
    front2 = await startBrokenFront(gw, '/status');
    c = await startChrome(front2.base + HOME);
    assert.equal(await launcherSettled(c), 'doors', 'a box that cannot answer /status was told "first time here"');
    assert.deepEqual((await readLauncher(c)).doors, [true, true]);
    c.stop(); c = null;
    // (d) THE TRUE WORST CASE, not a quarter of it. The 4-second fake in (a) EXITS, which takes tsState()'s
    // early return after the FIRST of its three spawns — so (a) proves a slow box is waited for, but it
    // cannot notice the ceiling drifting towards the real worst case (AUDIT-round-c C1/C2). This one answers
    // the first question and hangs, so all three budgets are paid in full and the box still answers honestly.
    const N = firstRunNumbers();
    dir2 = mkdtempSync(join(tmpdir(), 'trin-guided-tshang-'));
    gw2 = await startGateway({ env: { TRINITY_TAILSCALE_BIN: hangingTailscale(dir2) } });
    const tok2 = (await (await fetch(gw2.base + '/local-token')).json()).token;
    const t1 = Date.now();
    const nm2 = await (await fetch(gw2.base + '/relay-names/mine', { headers: { Authorization: 'Bearer ' + tok2 } })).json();
    const took2 = Date.now() - t1;
    assert.ok(took2 >= N.sum - 1500, 're-anchor: /relay-names/mine answered in ' + took2 + ' ms, not the ' + N.sum + ' ms all three tsState() spawns cost — this fake did not reach them, so this part measures nothing');
    assert.equal(nm2.handle, '', 're-anchor: the box at its worst case claims a name');
    c = await startChrome('about:blank');
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: RECORD_DECIDE });
    await c.goto(gw2.base + HOME);
    const d3 = await waitFor(c, `document.body.getAttribute('data-first-run')`, 'the launcher to decide on a box at tsState()\'s true worst case', N.ceiling + 20000);
    const at3 = Number(await c.evalIn(`window.__decidedAt || 0`));
    assert.equal(d3, 'card', 'A BOX AT tsState()\'s TRUE WORST CASE — all three tailscale spawns, ' + N.sum + ' ms, and an honest "no name, no church" at the end — WAS SENT TO THE TWO DOORS after ' + at3 + ' ms (AUDIT-suite-B4 N1)');
    assert.equal((await readLauncher(c)).card, true, 'the first-run card is not on screen on a box at its true worst case');
    assert.ok(at3 >= N.sum - 2000, 'the launcher decided at ' + at3 + ' ms — before the box could have answered, so this part did not measure the worst case');
    assert.ok(at3 < N.ceiling, 'the launcher decided at ' + at3 + ' ms, at or past its own ' + N.ceiling + ' ms ceiling: the honest answer no longer beats the backstop (AUDIT-round-c C2 measured the whole margin at 4 818 ms)');
    // AND THE SLACK IT ACTUALLY HAD, not the slack it was promised. The row above only checks the cliff,
    // and row 1d only checks the number someone WROTE DOWN — which is the C1 mistake one level up. The
    // launcher's route is longer than tsState(): /local-token answers first, in series, and is in no sum.
    // An audit deferred /local-token by 4 s and the whole route came in at 24 053 ms of a 25 000 ceiling —
    // 947 ms of real margin — with every row here green. So the measured slack is held against the
    // declared margin, at 60% of it, which leaves room for a loaded box without leaving room for a
    // second slow step nobody counted.
    assert.ok(N.ceiling - at3 >= N.margin * 0.6,
      'the launcher answered at ' + at3 + ' ms and its ceiling is ' + N.ceiling + ' ms, so the REAL margin on this box is ' + Math.round(N.ceiling - at3) + ' ms — relay-app/home.js declares ' + N.margin + ' ms. Something on the launcher\'s route got slower without the ceiling following it. The route is /status in parallel with /local-token -> /relay-names/mine in series; only the tsState() half of it is in FIRST_RUN_TS_BUDGET_MS (AUDIT-round-c C1, and the finding against its first fix).');
  } finally { if (c) c.stop(); if (front) front.stop(); if (front2) front2.stop(); if (gw2) gw2.stop(); gw.stop();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    if (dir2) { try { rmSync(dir2, { recursive: true, force: true }); } catch {} } }
});

// ── 1c. the ceiling: waiting is not the same as never deciding ─────────────────────────────
// AUDIT-round-a F1. Row 1b removed the 2.5 s fallback so a slow box is waited for. `fetch` has no timeout, so
// that left NO ceiling: the auditor measured a box that ACCEPTS /relay-names/mine and never answers it sitting
// on "Checking this computer…" — no card, no doors — still undecided after 45 000 ms, where the parent commit
// showed the doors after 2527 ms. A synchronous throw from the first `fetch` did the same (undecided at
// 20 000 ms), because the old timer was armed BEFORE the fetches and nothing was left running once the throw
// escaped. Both rows here are route-level failures, not a box that cannot serve HTML: the page, its scripts
// and every other route load perfectly from the same front. The rule: the launcher waits, but it always
// decides — "this page must not be a dead end".
// Stamps HOW LONG the page took to decide, on the page's own clock, from the first instant of the document.
// (A poll and not a MutationObserver: this runs at document-start, where document.documentElement can still
// be null and observe(null) would throw — taking the row's other injected script with it.)
const RECORD_DECIDE = `window.__t0 = performance.now();
(function tick() {
  if (document.body && document.body.getAttribute('data-first-run')) { if (!window.__decidedAt) window.__decidedAt = performance.now() - window.__t0; return; }
  setTimeout(tick, 20);
})();`;

test('a box that accepts a question and never answers it still ends on the DOORS, and so does a synchronous throw — the launcher waits, but it always decides',
  { skip: !CHROME ? 'no chromium' : false, timeout: 180000 }, async () => {
  const gw = await startGateway();
  let c = null, stall = null;
  try {
    // (a) the front accepts /relay-names/mine and never answers it. Nothing else is touched.
    stall = await startStallingFront(gw, '/relay-names/mine');
    c = await startChrome('about:blank');
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: RECORD_DECIDE });
    await c.goto(stall.base + HOME);
    // while it waits it is honest about it — the "checking" line, neither the card nor the doors
    await waitFor(c, `(${ON})(document.getElementById('checking'))`, 'the "Checking this computer…" line while the box is silent', 20000);
    const early = await c.evalIn(`(() => { const on = ${ON}; return JSON.stringify({ decided: document.body.getAttribute('data-first-run'), card: on(document.getElementById('firstRun')), doors: [...document.querySelectorAll('a.mode')].map(on), checking: on(document.getElementById('checking')), text: document.body.innerText }); })()`).then(JSON.parse);
    assert.equal(early.decided, null, 'the launcher decided before the ceiling: ' + JSON.stringify(early));
    assert.deepEqual([early.card, early.doors], [false, [false, false]], JSON.stringify(early));
    assert.match(early.text, /Checking this computer/, early.text);
    // re-anchor: the stall is real — the front is holding that request open and has answered nothing.
    // (Polled: /relay-names/mine is only asked once /local-token has answered, so it is not there the instant
    // the "checking" line goes up.)
    for (let i = 0; i < 100 && stall.held.size === 0; i++) await sleep(100);
    assert.ok(stall.held.size >= 1, 're-anchor: the front never received /relay-names/mine, so this row measures nothing');
    const decided = await waitFor(c, `document.body.getAttribute('data-first-run')`, 'THE LAUNCHER TO DECIDE AT ALL — a box that accepts a question and never answers it leaves it on "Checking this computer…" for ever (AUDIT-round-a F1): this page must not be a dead end', 45000);
    const at = Number(await c.evalIn(`window.__decidedAt || 0`));
    assert.equal(decided, 'doors', 'a box that never answered was told "first time here" — it decided "' + decided + '" after ' + at + ' ms');
    assert.deepEqual((await readLauncher(c)).doors, [true, true], 'the doors are not on screen after the ceiling fired');
    assert.equal(await c.evalIn(`(${ON})(document.getElementById('checking'))`), false, 'the "checking" line is still on screen after the ceiling fired');
    // the ceiling is a BACKSTOP, not a short timer: it must not fire before the gateway's own worst legitimate
    // answer (tsState = 8 s + 6 s + 6 s), or row 1b's slow box is back on the doors.
    const N = firstRunNumbers();
    assert.ok(at > N.sum, 'the ceiling fired after ' + at + ' ms — that is inside the ' + N.sum + ' ms worst case of tsState() itself, so a slow-but-honest box would be sent to the doors again (AUDIT-suite-B4 N1)');
    // and it fired where the two files SAY it will, so the numbers cannot drift from the timer they set
    assert.ok(at >= N.ceiling - 1500 && at <= N.ceiling + 9000, 'the ceiling fired at ' + at + ' ms, not at the ' + N.ceiling + ' ms home.js derives from tsState()\'s budgets (FIRST_RUN_TS_BUDGET_MS + FIRST_RUN_CEILING_MARGIN_MS) — the named numbers and the timer they are there to set have drifted apart (AUDIT-round-c C1)');
    c.stop(); c = null; stall.stop(); stall = null;
    // (b) the first fetch throws synchronously. Under the old timer this still ended on the doors; with the
    // timer gone the throw escaped the IIFE and nothing was left running.
    c = await startChrome('about:blank');
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.fetch = function () { throw new TypeError('Failed to fetch (thrown synchronously by the test)'); };\n` + RECORD_DECIDE });
    await c.goto(gw.base + HOME);
    const d2 = await waitFor(c, `document.body.getAttribute('data-first-run')`, 'THE LAUNCHER TO DECIDE when `fetch` throws synchronously — the throw escapes the deciding block and leaves the whole page on "Checking this computer…" (AUDIT-round-a F1)', 45000);
    const at2 = Number(await c.evalIn(`window.__decidedAt || 0`));
    assert.equal(d2, 'doors', 'a box whose questions could not even be asked was told "first time here" — it decided "' + d2 + '"');
    assert.deepEqual((await readLauncher(c)).doors, [true, true], 'the doors are not on screen after a synchronous throw');
    assert.ok(at2 < 5000, 'a synchronous throw took ' + at2 + ' ms to reach the doors — nothing is in flight, so it must not wait for the ceiling');
  } finally { if (c) c.stop(); if (stall) stall.stop(); gw.stop(); }
});

// ── 1d. THE CEILING AND THE BUDGETS IT IS DERIVED FROM CANNOT DRIFT APART ────────────────────────
// AUDIT-round-c C1. 25 s was the right number and nothing in the repository said why, or would notice if it
// stopped being right: the auditor raised tsState()'s first budget 8000 → 22000 — an honest worst case of
// 34 s — and the launcher went back to the two doors at 25 168 ms while this file stayed 9 pass / 0 fail.
// The budgets are now named in one place (TS_STATE_BUDGETS_MS, scripts/gateway.mjs) and home.js states the
// sum it believes and the margin it adds. This row holds those together; row 1c measures the ceiling
// actually firing at the number they produce, and row 1b(d) measures the honest box beating it.
test('the launcher\'s first-run ceiling is derived from tsState()\'s own budgets — raising one without the other fails here', () => {
  const n = firstRunNumbers();
  assert.equal(n.spawns, n.named,
    'tsState() makes ' + n.spawns + ' tailscale spawns but only ' + n.named + ' of them take a budget from TS_STATE_BUDGETS_MS. A budget written inline is one the launcher\'s ceiling cannot see (AUDIT-round-c C1).');
  assert.equal(n.spawns, n.budgets.length,
    'tsState() makes ' + n.spawns + ' tailscale spawns and TS_STATE_BUDGETS_MS names ' + n.budgets.length + ' (' + n.budgets.map(b => b.name + '=' + b.ms).join(', ') + ') — the sum the launcher clears is no longer the worst case it will actually wait through.');
  assert.equal(n.budget, n.sum,
    'THE LAUNCHER\'S CEILING IS NO LONGER TIED TO THE ANSWER IT IS WAITING FOR. tsState()\'s budgets now sum to ' + n.sum + ' ms (' + n.budgets.map(b => b.name + '=' + b.ms).join(' + ') + '), and relay-app/home.js still says FIRST_RUN_TS_BUDGET_MS = ' + n.budget + '. A box that WILL answer, in ' + n.sum + ' ms, is sent to the two doors at ' + n.ceiling + ' ms with the first-run card never shown — AUDIT-suite-B4 N1, re-opened. Raise FIRST_RUN_TS_BUDGET_MS in relay-app/home.js to ' + n.sum + ' (and check the margin is still enough).');
  assert.ok(n.ceiling > n.sum, 'the ceiling (' + n.ceiling + ' ms) is not above the slowest honest answer (' + n.sum + ' ms)');
  assert.ok(n.margin >= 4000,
    'the margin above tsState()\'s worst case is ' + n.margin + ' ms. That margin is the whole safety budget for everything else on the route (AUDIT-round-c C2 measured it at 4 818 ms end to end); below 4 s a box that answers honestly starts losing its card to the backstop.');
});

// ── 2. "Set up everything" ────────────────────────────────────────────────────────────────────────────────
test('"Set up everything": the relay wizard → "Next: open the console" → the console wizard → "Back to the Suite" → the launcher with two doors; a second launch, and a fresh profile, get the doors',
  { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  const gw = await startGateway();
  const c = await startChrome(gw.base + HOME);
  let c2 = null;
  try {
    assert.equal(await launcherSettled(c), 'card');
    assert.equal(await clickId(c, 'setupAll'), 'ok');
    await waitFor(c, `/control\\.html\\?setup=everything$/.test(location.href)`, 'the relay panel on the everything path', 15000);
    const done = await walkRelayWizard(c);
    // the done step names the church as the NEXT step and makes the console the primary
    assert.match(done.sub, /^Next: your church\. It is created in the console, not here — naming it there registers it on this relay\.$/, 'the done step does not say the church is next: ' + JSON.stringify(done));
    const ids = done.foot.map(f => f.id);
    assert.deepEqual(ids, ['rswSuite', 'rswConsole'], 'the footer holds ' + JSON.stringify(done.foot) + ' — expected "Back to the Suite" then the console as the primary');
    const next = done.foot.find(f => f.id === 'rswConsole'), back = done.foot.find(f => f.id === 'rswSuite');
    assert.deepEqual([next.tag, next.text, next.href, next.primary, next.on], ['a', 'Next: open the console', '/steward.html', true, true], 'the console step is not the primary link: ' + JSON.stringify(next));
    assert.deepEqual([back.tag, back.text, back.href, back.primary, back.on], ['a', 'Back to the Suite', HOME, false, true], 'skipping the church has no way back to the Suite: ' + JSON.stringify(back));
    assert.deepEqual(done.steps, ['rswTunnel'], 'the step list repeats the console the footer already carries: ' + JSON.stringify(done.steps));
    // follow the thread
    assert.equal(await clickId(c, 'rswConsole'), 'ok');
    await waitFor(c, `/\\/steward\\.html$/.test(location.href)`, 'the console', 15000);
    await walkConsoleWizard(c, 'St Columba on the Suite');
    // the console's done step carries the way back — and it is the Suite, so it is offered
    const back2 = await c.evalIn(`(() => { const on = ${ON}; const b = [...document.querySelectorAll('button')].find(x => /Back to the Suite/.test(x.textContent || '')); return b ? JSON.stringify({ on: on(b), text: (b.textContent || '').replace(/\\s+/g, ' ').trim() }) : 'null'; })()`);
    assert.notEqual(back2, 'null', 'THE CONSOLE\'S "You’re all set" STEP HAS NO "Back to the Suite" — the guided path ends in the console, not on the launcher');
    assert.deepEqual(JSON.parse(back2), { on: true, text: 'Back to the Suite' });
    assert.equal(await clickButton(c, '/Back to the Suite/'), 'ok');
    await waitFor(c, `/\\/relay-app\\/home\\.html$/.test(location.href)`, 'the launcher', 15000);
    assert.equal(await launcherSettled(c), 'doors', 'THE PATH ENDED ON THE LAUNCHER BUT IT SHOWS THE FIRST-RUN CARD AGAIN — the relay and the church are set up');
    let L = await readLauncher(c);
    assert.deepEqual([L.card, L.doors], [false, [true, true]], 'expected two doors and no card: ' + JSON.stringify(L));
    assert.equal(await c.evalIn(`localStorage.getItem('trinityone.steward.wizard.done')`), '1', 'the console wizard was not marked done on the way out');
    // AND THE RELAY WIZARD DID NOT MARK THIS BOX SET UP. At the moment "Next: open the console" was pressed
    // this box held nothing — the church is created in the console, after that click — so the marker would
    // have been a claim about the future (AUDIT-round-c C3). The doors below are read from the box.
    assert.equal(await c.evalIn(`localStorage.getItem('to_relay_setup_seen')`), null, 'the relay wizard marked the box "set up" on its way to the console, where it still held nothing');
    // a second launch, same profile: the doors, no card
    await c.goto(gw.base + HOME);
    assert.equal(await launcherSettled(c), 'doors', 'a second launch shows the card again');
    // and a FRESH profile against this box, which now holds a church: the doors — the signal beats the marker
    assert.equal((await (await fetch(gw.base + '/status')).json()).writePolicy, true, 're-anchor: the box does not report the church it registered');
    c2 = await startChrome(gw.base + HOME);
    assert.equal(await launcherSettled(c2), 'doors', 'A FRESH PROFILE AGAINST A BOX THAT HOLDS A CHURCH GETS THE FIRST-RUN CARD — the launcher trusts its marker over the box');
    L = await readLauncher(c2);
    assert.deepEqual([L.card, L.doors], [false, [true, true]], JSON.stringify(L));
  } finally { if (c2) c2.stop(); c.stop(); gw.stop(); }
});

// ── 3. "Just a relay" ─────────────────────────────────────────────────────────────────────────────────────
test('"Just a relay": the relay wizard → "Back to the Suite" (the primary) → the launcher with two doors; a skip lands there too; a named relay gets the doors from a fresh profile',
  { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
  const gw = await startGateway();
  let c = await startChrome(gw.base + HOME);
  let named = null, c3 = null;
  try {
    // (a) skipping the wizard closes it onto the panel behind it, and the launcher's card is still there,
    // because a skip set nothing up (owner, 2026-09-22: "It should come back until its setup"). Rows 3c and
    // 3e pin the whole shape; this is where the path lands.
    assert.equal(await launcherSettled(c), 'card');
    assert.equal(await clickId(c, 'setupRelay'), 'ok');
    await waitFor(c, `/control\\.html\\?setup=relay$/.test(location.href)`, 'the relay panel on the relay path', 15000);
    await waitFor(c, `document.getElementById('relaySetup') && document.getElementById('relaySetup').classList.contains('show')`, 'the relay wizard to open', 20000);
    assert.equal(await clickId(c, 'rswSkip'), 'ok', 'no "Skip setup"');
    await waitFor(c, `!document.getElementById('relaySetup').classList.contains('show')`, 'the wizard to close on a skip', 10000);
    assert.match(String(await c.evalIn(`location.pathname`)), /\/relay-app\/control\.html$/, 'a skip left the relay panel: ' + (await c.evalIn(`location.href`)));
    await c.goto(gw.base + HOME);
    assert.equal(await launcherSettled(c), 'card', 'ONE "Skip setup" RETIRED THE FIRST-RUN CARD WITH NOTHING SET UP (AUDIT-suite-B4 N2)');
    c.stop();
    // (b) the whole wizard, from a profile that has not seen it
    c = await startChrome(gw.base + HOME);
    assert.equal(await launcherSettled(c), 'card', 'staging: a fresh profile on a box with nothing set up did not get the card');
    assert.equal(await clickId(c, 'setupRelay'), 'ok');
    await waitFor(c, `/control\\.html\\?setup=relay$/.test(location.href)`, 'the relay panel on the relay path', 15000);
    const done = await walkRelayWizard(c);
    assert.deepEqual(done.foot.map(f => f.id), ['rswDone', 'rswSuite'], 'the footer holds ' + JSON.stringify(done.foot) + ' — expected the dashboard, then "Back to the Suite" as the primary');
    const back = done.foot.find(f => f.id === 'rswSuite');
    assert.deepEqual([back.tag, back.text, back.href, back.primary, back.on], ['a', 'Back to the Suite', HOME, true, true], JSON.stringify(back));
    assert.equal(done.foot.find(f => f.id === 'rswDone').primary, false, '"Go to dashboard" is still the primary on the relay-only path');
    assert.doesNotMatch(done.sub, /^Next: your church|^Now set up your church/, 'the relay-only path is told the church is next — nobody who only hosts a relay is marched into the church ceremony: ' + done.sub);
    assert.equal(done.sub.trim(), 'A church run from another device is added by its ID under Settings → Churches; one created in the console here registers itself.', 'the relay-only done step does not say how a church run elsewhere gets on: ' + done.sub);
    assert.equal(await clickId(c, 'rswSuite'), 'ok');
    await waitFor(c, `/\\/relay-app\\/home\\.html$/.test(location.href)`, 'the launcher', 15000);
    // The path ends on the LAUNCHER. With nothing set up on this box that is still the CARD: walking the
    // wizard past every step is not setting anything up, whichever button ends it (AUDIT-round-c C3, which
    // row 3d walks in full). What this part pins is the done step's own shape, above.
    assert.equal(await launcherSettled(c), 'card', 'the relay-only path did not end on the launcher');
    assert.deepEqual((await readLauncher(c)).doors, [false, false], 'a door is on screen beside the card on a box that holds nothing');
    // (c) a box whose relay HAS a name (the file the gateway reads at boot), fresh profile: the doors
    named = await startGateway({ seed: { 'relay-myname.json': JSON.stringify({ handle: 'grace-city' }) + '\n' } });
    c3 = await startChrome(named.base + HOME);
    assert.equal(await launcherSettled(c3), 'doors', 'A FRESH PROFILE AGAINST A NAMED RELAY GETS THE FIRST-RUN CARD — a relay name is something that was set up here');
  } finally { if (c3) c3.stop(); if (named) named.stop(); c.stop(); gw.stop(); }
});

// ── 3c. "Skip setup" is not "set up" ──────────────────────────────────────────────
// AUDIT-suite-B4 N2, and the OWNER'S DECISION on it (2026-09-22): "It should come back until its setup."
// One "Skip setup" on the wizard's first screen used to write `to_relay_setup_seen` — the marker that means
// "a wizard finished" — so the launcher's first-run card never returned AND the relay wizard never reopened
// (`openRelaySetup` has one caller, `maybeFirstRun`, which the marker short-circuits). A box with no name, no
// church and nothing else set up was permanently declared established by one click of the escape hatch.
// What retires the card permanently is the two LIVE facts the launcher reads from the box: a church
// (/status.writePolicy) or a relay name (/relay-names/mine.handle). This row walks both halves on the real
// pages: a skip, and then actually setting something up.
const TEST_NPUB = npubEncode('1'.repeat(63) + '0');

test('"Skip setup" dismisses the wizard for this visit; it does not declare the box set up — the card comes back until something really is',
  { skip: !CHROME ? 'no chromium' : false, timeout: 150000 }, async () => {
  const gw = await startGateway();
  const c = await startChrome(gw.base + HOME);
  try {
    // (a) the card, the door, the wizard, "Skip setup" — and the launcher still shows the card
    assert.equal(await launcherSettled(c), 'card', 'staging: a fresh profile on a box with nothing set up did not get the card');
    assert.equal(await clickId(c, 'setupRelay'), 'ok');
    await waitFor(c, `/control\\.html\\?setup=relay$/.test(location.href)`, 'the relay panel on the relay path', 15000);
    await waitFor(c, `document.getElementById('relaySetup') && document.getElementById('relaySetup').classList.contains('show')`, 'the relay wizard to open', 20000);
    assert.equal(await clickId(c, 'rswSkip'), 'ok', 'THE "Skip setup" CONTROL IS GONE from the wizard\'s first screen');
    await waitFor(c, `!document.getElementById('relaySetup').classList.contains('show')`, 'the wizard to close on a skip', 10000);
    await c.goto(gw.base + HOME);
    assert.equal(await launcherSettled(c), 'card', 'ONE "Skip setup" RETIRED THE FIRST-RUN CARD WITH NOTHING SET UP (AUDIT-suite-B4 N2; owner 2026-09-22: "It should come back until its setup")');
    assert.deepEqual((await readLauncher(c)).doors, [false, false], 'a door is on screen beside the card after a skip');
    assert.equal(await c.evalIn(`localStorage.getItem('to_relay_setup_seen')`), null, 'a skip wrote the "a wizard finished" marker — nothing was set up, so nothing may claim it was');
    // (b) and it is still there on the next launch of the launcher
    await c.goto(gw.base + HOME);
    assert.equal(await launcherSettled(c), 'card', 'the first-run card did not come back on the next launch after a skip');
    // (c) the card is still ACTIONABLE: the same door reopens the wizard it skipped
    assert.equal(await clickId(c, 'setupRelay'), 'ok');
    await waitFor(c, `/control\\.html\\?setup=relay$/.test(location.href)`, 'the relay panel on the relay path', 15000);
    await waitFor(c, `document.getElementById('relaySetup') && document.getElementById('relaySetup').classList.contains('show')`, 'THE RELAY WIZARD TO REOPEN after a skip — a card whose choices do nothing is worse than no card', 20000);
    // (d) now actually set something up, through the wizard's own "I already have a church" field
    assert.equal(await clickId(c, 'rswGo'), 'ok', 'no "Get started"');
    assert.equal(await clickId(c, 'rswSkip'), 'ok', 'no "Skip for now" on the name step');   // a name cannot be claimed on a loopback box
    assert.equal(await clickId(c, 'rswById'), 'ok', 'no "I already have a church" on the church step');
    await waitFor(c, `!!document.getElementById('rswNpub')`, 'the church-by-ID field', 10000);
    assert.equal(await typeInto(c, `document.getElementById('rswNpub')`, TEST_NPUB), 'ok');
    assert.equal(await clickId(c, 'rswAdd'), 'ok', 'no "Add & continue"');
    await waitFor(c, `!!document.getElementById('rswOnYes')`, 'the "does this computer stay on" step after the church was added (if the add was refused the wizard stays on the church step and says why)', 20000);
    // re-anchor: the box itself now reports the church, which is the fact the launcher reads
    assert.equal((await (await fetch(gw.base + '/status')).json()).writePolicy, true, 're-anchor: the box does not report the church that was just added, so the rest of this row measures nothing');
    // (e) with EVERY marker cleared — so only the live facts can speak — the launcher shows the doors, and
    //     keeps showing them. That is what permanently retires the card.
    assert.equal(await c.evalIn(`(() => { localStorage.clear(); sessionStorage.clear(); return 'ok'; })()`), 'ok');
    await c.goto(gw.base + HOME);
    assert.equal(await launcherSettled(c), 'doors', 'A BOX THAT HOLDS A CHURCH IS STILL SHOWN THE FIRST-RUN CARD — the live facts must retire it');
    assert.deepEqual((await readLauncher(c)).doors, [true, true]);
    await c.goto(gw.base + HOME);
    assert.equal(await launcherSettled(c), 'doors', 'the first-run card came back on a box that holds a church');
  } finally { c.stop(); gw.stop(); }
});

// ── 3d. WALKING THE WIZARD IS NOT SETTING ANYTHING UP ────────────────────────────────────────────
// AUDIT-round-c C3, measured by the auditor on these same pages: "Just a relay" → Get started → "Skip for
// now" (the name) → "Skip for now" (the church) → "Yes, it stays on" → the done step, whose PRIMARY is
// "Back to the Suite". Pressing it wrote `to_relay_setup_seen`; the launcher showed the doors, the next
// launch showed the doors, and the box still reported writePolicy=false and handle="". Five clicks, two of
// them labelled "Skip for now" by this wizard, ending on the button a first-time person presses. Owner,
// 2026-09-22: "I agree with your recommendation, it definitely shouldn't count as complete."
// Both halves are here, on the same five clicks: nothing set up (the card stays, and stays on the next
// launch), and a church really added (the card goes, and stays gone). The state of the box decides.
test('walking the wizard with every step skipped does not retire the first-run card — the same walk with a church added does',
  { skip: !CHROME ? 'no chromium' : false, timeout: 180000 }, async () => {
  const gw = await startGateway();
  const c = await startChrome(gw.base + HOME);
  try {
    // (a) the auditor's five clicks, ending on the done step's primary
    assert.equal(await launcherSettled(c), 'card', 'staging: a fresh profile on a box with nothing set up did not get the card');
    assert.equal(await clickId(c, 'setupRelay'), 'ok');
    await waitFor(c, `/control\\.html\\?setup=relay$/.test(location.href)`, 'the relay panel on the relay path', 15000);
    const done = await walkRelayWizard(c);                                  // Get started, Skip for now, Continue, Yes it stays on
    const foot = done.foot.map(f => ({ id: f.id, primary: f.primary }));
    assert.deepEqual(foot, [{ id: 'rswDone', primary: false }, { id: 'rswSuite', primary: true }], 're-anchor: the done step\'s footer is not the one the finding is about: ' + JSON.stringify(done.foot));
    // re-anchor, from the box itself: this walk set NOTHING up
    assert.equal((await (await fetch(gw.base + '/status')).json()).writePolicy, false, 're-anchor: the box claims a church after a walk that added none');
    const tok = (await (await fetch(gw.base + '/local-token')).json()).token;
    assert.equal((await (await fetch(gw.base + '/relay-names/mine', { headers: { Authorization: 'Bearer ' + tok } })).json()).handle, '', 're-anchor: the box claims a name after a walk that claimed none');
    assert.equal(await clickId(c, 'rswSuite'), 'ok', 'no "Back to the Suite" on the done step');
    await waitFor(c, `/\\/relay-app\\/home\\.html$/.test(location.href)`, 'the launcher', 15000);
    assert.equal(await launcherSettled(c), 'card',
      'FIVE CLICKS THROUGH A WIZARD THAT SET NOTHING UP RETIRED THE FIRST-RUN CARD (AUDIT-round-c C3) — two of them labelled "Skip for now" by the wizard itself, the last one its PRIMARY button, on a box reporting writePolicy=false and handle=""');
    assert.deepEqual((await readLauncher(c)).doors, [false, false], 'a door is on screen beside the card');
    assert.equal(await c.evalIn(`localStorage.getItem('to_relay_setup_seen')`), null, 'the done step wrote the "a wizard finished" marker on a box holding nothing');
    // (b) and it is still there on the next launch — the marker is what used to make this permanent
    await c.goto(gw.base + HOME);
    assert.equal(await launcherSettled(c), 'card', 'the first-run card did not come back on the next launch after a walk that set nothing up');
    // (c) the GHOST exit ("Go to dashboard") says no more than the primary did
    assert.equal(await clickId(c, 'setupRelay'), 'ok');
    await waitFor(c, `/control\\.html\\?setup=relay$/.test(location.href)`, 'the relay panel again', 15000);
    await walkRelayWizard(c);
    assert.equal(await clickId(c, 'rswDone'), 'ok', 'no "Go to dashboard" on the done step');
    await waitFor(c, `!document.getElementById('relaySetup').classList.contains('show')`, 'the wizard to close on "Go to dashboard"', 10000);
    assert.equal(await c.evalIn(`localStorage.getItem('to_relay_setup_seen')`), null, '"Go to dashboard" wrote the "a wizard finished" marker on a box holding nothing');
    await c.goto(gw.base + HOME);
    assert.equal(await launcherSettled(c), 'card', 'the card was retired by "Go to dashboard" on a box holding nothing');
    // (d) now the same five-click shape with a church REALLY added, through the wizard's own by-ID field
    assert.equal(await clickId(c, 'setupRelay'), 'ok');
    await waitFor(c, `/control\\.html\\?setup=relay$/.test(location.href)`, 'the relay panel again', 15000);
    await waitFor(c, `document.getElementById('relaySetup') && document.getElementById('relaySetup').classList.contains('show')`, 'the relay wizard to reopen', 20000);
    assert.equal(await clickId(c, 'rswGo'), 'ok', 'no "Get started"');
    assert.equal(await clickId(c, 'rswSkip'), 'ok', 'no "Skip for now" on the name step');
    assert.equal(await clickId(c, 'rswById'), 'ok', 'no "I already have a church" on the church step');
    await waitFor(c, `!!document.getElementById('rswNpub')`, 'the church-by-ID field', 10000);
    assert.equal(await typeInto(c, `document.getElementById('rswNpub')`, TEST_NPUB), 'ok');
    assert.equal(await clickId(c, 'rswAdd'), 'ok', 'no "Add & continue"');
    await waitFor(c, `!!document.getElementById('rswOnYes')`, 'the "does this computer stay on" step after the church was added', 20000);
    assert.equal(await clickId(c, 'rswOnYes'), 'ok');
    assert.equal((await (await fetch(gw.base + '/status')).json()).writePolicy, true, 're-anchor: the box does not report the church just added, so the rest of this row measures nothing');
    assert.equal(await clickId(c, 'rswSuite'), 'ok', 'no "Back to the Suite" on the done step');
    await waitFor(c, `/\\/relay-app\\/home\\.html$/.test(location.href)`, 'the launcher', 15000);
    assert.equal(await launcherSettled(c), 'doors', 'A BOX THAT NOW HOLDS A CHURCH IS STILL SHOWN THE FIRST-RUN CARD');
    assert.deepEqual((await readLauncher(c)).doors, [true, true]);
    // and it stays gone with every marker cleared, because the box itself is the answer
    assert.equal(await c.evalIn(`(() => { localStorage.clear(); sessionStorage.clear(); return 'ok'; })()`), 'ok');
    await c.goto(gw.base + HOME);
    assert.equal(await launcherSettled(c), 'doors', 'the first-run card came back on a box that holds a church');
  } finally { c.stop(); gw.stop(); }
});

// ── 3e. THERE IS A WAY OUT OF THE WIZARD, AND IT DOES NOT LOOP ───────────────────────────────────
// AUDIT-round-c C4, and the reason C3 mattered: a guided arrival (`?setup=`) reopens this wizard on every
// load, and the skip used to send the person back to the launcher — which showed the card again, because
// nothing had been set up. The auditor measured card → wizard → skip → card three rounds running; the only
// non-looping exit was the dishonest one C3 is about. "Skip setup" now closes the wizard onto the panel
// behind it and strips `?setup=` from the address, so a reload does not put it straight back — while the
// card's own door still reopens it, because that is a fresh navigation carrying `?setup=` again.
test('"Skip setup" leaves the wizard onto the panel, a reload does not put it back, and the card\'s door still reopens it',
  { skip: !CHROME ? 'no chromium' : false, timeout: 150000 }, async () => {
  const gw = await startGateway();
  const c = await startChrome(gw.base + HOME);
  const OPEN = `document.getElementById('relaySetup') && document.getElementById('relaySetup').classList.contains('show')`;
  try {
    assert.equal(await launcherSettled(c), 'card', 'staging: a fresh profile on a box with nothing set up did not get the card');
    assert.equal(await clickId(c, 'setupRelay'), 'ok');
    await waitFor(c, `/control\\.html\\?setup=relay$/.test(location.href)`, 'the relay panel on the relay path', 15000);
    await waitFor(c, OPEN, 'the relay wizard to open', 20000);
    assert.equal(await clickId(c, 'rswSkip'), 'ok', 'THE "Skip setup" CONTROL IS GONE — there is no way out of this wizard that sets nothing up');
    await waitFor(c, `!(${OPEN})`, 'the wizard to close on a skip', 10000);
    // out of the wizard, onto the thing it was covering — not back where the person came from
    const href = String(await c.evalIn(`location.href`));
    assert.match(href, /\/relay-app\/control\.html$/, 'a skip did not leave the person on the relay panel with `?setup=` stripped: ' + href);
    assert.equal(await c.evalIn(`(${ON})(document.getElementById('goConsole'))`), true, 'the panel behind the wizard is not on screen after a skip');
    assert.equal(await c.evalIn(`localStorage.getItem('to_relay_setup_seen')`), null, 'a skip claimed the box was set up');
    assert.equal(await c.evalIn(`sessionStorage.getItem('to_relay_setup_skipped')`), '1', 'a skip did not record itself for this visit');
    // THE LOOP: reload the page the person is now on. It must not reopen.
    await c.goto(href);
    await waitFor(c, `document.readyState === 'complete'`, 'the panel to reload', 15000);
    await sleep(3000);
    assert.equal(await c.evalIn(OPEN), false,
      'THE WIZARD REOPENED ON A RELOAD OF THE PAGE THE SKIP LANDED ON — there is no way to be on this panel without it (AUDIT-round-c C4)');
    // and the card's own door still means what it says
    await c.goto(gw.base + HOME);
    assert.equal(await launcherSettled(c), 'card', 'the card did not come back after a skip that set nothing up');
    assert.equal(await clickId(c, 'setupRelay'), 'ok');
    await waitFor(c, `/control\\.html\\?setup=relay$/.test(location.href)`, 'the relay panel on the relay path', 15000);
    await waitFor(c, OPEN, 'THE WIZARD TO REOPEN when the card asks for it again — a card whose choices do nothing is worse than no card', 20000);
  } finally { c.stop(); gw.stop(); }
});

// ── 3b. the relay wizard opens on a SECOND visit too ─────────────────────────────────────────────────────
// Found while screenshotting this branch: at 6b6e66d the wizard opened on the first visit to the panel in a
// webview and never again while still unseen. On a load with the admin token already stored, control.js
// called maybeFirstRun() synchronously — before `let rswOpen` further down the file existed — and the async
// block it sat in swallowed the ReferenceError (the first visit's /local-token await had deferred it past
// that). On the Suite that is every visit after the first: a person who pressed "← Back" beneath the wizard
// and later chose "Just a relay" from the card got the dashboard, not the wizard the card promised.
test('the relay wizard opens on a second visit to the panel in the same profile, while it is still unseen',
  { skip: !CHROME ? 'no chromium' : false, timeout: 90000 }, async () => {
  const gw = await startGateway();
  const c = await startChrome(gw.base + '/relay-app/control.html?setup=relay');
  try {
    const OPEN = `document.getElementById('relaySetup') && document.getElementById('relaySetup').classList.contains('show')`;
    await waitFor(c, OPEN, 'the relay wizard on the first visit', 20000);
    assert.equal(await c.evalIn(`!!localStorage.getItem('to_relay_admin_token')`), true, 'staging: the panel did not store the admin token the second visit relies on');
    assert.equal(await c.evalIn(`localStorage.getItem('to_relay_setup_seen')`), null, 'staging: the wizard is already marked seen');
    // leave without answering (the Back beneath the overlay, or the shell's own Back), then come back
    await c.goto(gw.base + HOME);
    await launcherSettled(c);
    assert.equal(await clickId(c, 'setupRelay'), 'ok', 'the launcher did not offer "Just a relay" again — nothing was set up');
    await waitFor(c, `/control\\.html\\?setup=relay$/.test(location.href)`, 'the relay panel again', 15000);
    await waitFor(c, `document.readyState === 'complete'`, 'the panel to load', 15000);
    await sleep(2500);
    assert.equal(await c.evalIn(OPEN), true,
      'THE WIZARD DID NOT OPEN ON A SECOND VISIT. The card promised it; the person got the dashboard. At 6b6e66d maybeFirstRun() threw in the temporal dead zone on every load with the token already stored.');
  } finally { c.stop(); gw.stop(); }
});

// ── 4. "Just the console" ─────────────────────────────────────────────────────────────────────────────────
test('"Just the console": the console → a church → "Back to the Suite" → the launcher with two doors',
  { skip: !CHROME ? 'no chromium' : false, timeout: 180000 }, async () => {
  const gw = await startGateway();
  const c = await startChrome(gw.base + HOME);
  try {
    assert.equal(await launcherSettled(c), 'card');
    assert.equal(await clickId(c, 'setupConsole'), 'ok');
    await waitFor(c, `/\\/steward\\.html$/.test(location.href)`, 'the console', 15000);
    await walkConsoleWizard(c, 'St Aidan on the Suite');
    assert.equal(await clickButton(c, '/Back to the Suite/'), 'ok', 'the console\'s done step has no "Back to the Suite"');
    await waitFor(c, `/\\/relay-app\\/home\\.html$/.test(location.href)`, 'the launcher', 15000);
    assert.equal(await launcherSettled(c), 'doors', 'the console-only path ended on the launcher with the first-run card');
    const L = await readLauncher(c);
    assert.deepEqual([L.card, L.doors], [false, [true, true]], JSON.stringify(L));
    assert.equal(await c.evalIn(`localStorage.getItem('trinityone.steward.wizard.done')`), '1');
  } finally { c.stop(); gw.stop(); }
});

// ── 4b. the console wizard's marker does not retire the card — the box state does ────────────────────────
// The owner, 2026-09-23: "the state of the box decides whether the card is retired, never which button was
// pressed." The console wizard finishes by writing `trinityone.steward.wizard.done = "1"`, but that marker
// must not be read as "a church exists" — it means only "a wizard was offered". If the box still holds no
// church (and no relay name), the first-run card comes back and stays until the box actually has something.
test('the console wizard\'s "done" marker does not retire the first-run card; the box state does',
  { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
  const gw = await startGateway();
  const c = await startChrome(gw.base + HOME);
  try {
    assert.equal(await launcherSettled(c), 'card');
    // Set the markers the console wizard and relay setup write, WITHOUT creating a church.
    // The box still holds no church and no relay name.
    await c.evalIn(`localStorage.setItem('trinityone.steward.wizard.done', '1')`);
    await c.evalIn(`localStorage.setItem('to_relay_setup_seen', '1')`);
    const marked = await c.evalIn(`localStorage.getItem('trinityone.steward.wizard.done')`);
    assert.equal(marked, '1', 'the marker was not written');
    // Reload the launcher. The markers are set but the box has no church and no relay name.
    // The launcher must read the box state, not the markers, so it shows the card.
    await c.goto(gw.base + HOME);
    assert.equal(await launcherSettled(c), 'card', 'THE CONSOLE WIZARD\'S "done" MARKER RETIRED THE FIRST-RUN CARD WITH NO CHURCH ON THE BOX (the owner\'s rule: state of the box, not which button was pressed)');
    let L = await readLauncher(c);
    assert.deepEqual([L.card, L.doors], [true, [false, false]], JSON.stringify(L));
    // On a second launch, the card is still there — the markers alone do not keep it gone.
    await c.goto(gw.base + HOME);
    assert.equal(await launcherSettled(c), 'card', 'a second launch still shows the card — the markers do not stay it retired');
    L = await readLauncher(c);
    assert.deepEqual([L.card, L.doors], [true, [false, false]], JSON.stringify(L));
  } finally { c.stop(); gw.stop(); }
});

// ── 5. "Back to the Suite" is the Suite's, not the phone's or the hosted console's ────────────────────────
// The real StewSetupWizard, run under the miniature React with its step seeded to the last one (the seed is
// scoped the way scripts/settings-pages-are-a-list-and-a-detail.test.mjs scopes it: `React.useState(0)` occurs
// exactly once inside the component and it is `step`), under three origins. The gate is the code's own
// (stewOnSuite); the tree is what a person would be shown.
function lastStep({ hostname, capacitor }) {
  const src = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
  const at = src.indexOf('function StewSetupWizard(');
  assert.notEqual(at, -1, 'StewSetupWizard is gone — re-anchor this test');
  const body = src.slice(at, src.indexOf('\nfunction ', at + 1));
  assert.equal((body.match(/React\.useState\(0\)/g) || []).length, 1, 'React.useState(0) is no longer unique inside StewSetupWizard — the seed could be aiming at other state');
  const { React: R, draw } = miniReact();
  const React = { ...R, useState: (init) => (init === 0 ? [6, () => {}] : R.useState(init)) };
  const store = new Map();
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const win = { Steward: { exportMnemonic: () => '', npub: 'npub1x', hasPinLock: () => true, needsPin: false }, addEventListener() {}, removeEventListener() {}, innerWidth: 900, localStorage, ...(capacitor ? { Capacitor: capacitor } : {}) };
  const mod = loadScreen('app/stew-dashboard.jsx', ['StewSetupWizard'], {
    React, window: win, location: { hostname, host: hostname }, localStorage, document: { addEventListener() {}, removeEventListener() {} },
    navigator: { userAgent: '' }, setTimeout, clearTimeout, console, fetch: async () => ({ ok: false, json: async () => ({}) }),
    Icon: function Icon() { return null; }, WizMeetings: function WizMeetings() { return null; }, _wizMeetingId: () => 'evt1',
    useStewDialog: () => ({ current: null }), useStewModalOpen: () => {}, stewCapState: () => ({ allowed: false }),
    SkQR: function SkQR() { return null; }, SkPill: function SkPill() { return null; }, SK_TINT: {},
  });
  const tree = draw(mod.StewSetupWizard, { church: { name: 'Grace Church' }, onDone() {}, onTab() {}, onSettings() {}, onInvite() {}, onNewPost() {} });
  assert.match(texts(tree).join(' '), /You’re all set/, 'seeding the step did not reach the last step');
  // The footer is handed to WizShell as a prop AND rendered as its child, so `find` meets every footer button
  // twice (measured: "Go to dashboard" counts 2 as well). So the count is read AGAINST the button that is always
  // there: "Back to the Suite" is on screen iff it counts the same as "Go to dashboard", absent iff it counts 0.
  const count = (label) => find(tree, n => n.type === 'button' && texts(n).join(' ').includes(label)).length;
  const dash = count('Go to dashboard');
  assert.ok(dash >= 1, '"Go to dashboard" is gone from the last step — re-anchor this test');
  const back = count('Back to the Suite');
  return back === 0 ? 'absent' : back === dash ? 'shown' : 'odd:' + back + '/' + dash;
}

test('the console offers "Back to the Suite" on the Suite only: loopback with no Capacitor bridge — never on the APK, never on the hosted console', () => {
  assert.equal(lastStep({ hostname: '127.0.0.1', capacitor: null }), 'shown', 'on the Suite (loopback, no Capacitor) the last step has no "Back to the Suite"');
  assert.equal(lastStep({ hostname: 'localhost', capacitor: null }), 'shown', 'on the Suite at localhost the last step has no "Back to the Suite"');
  assert.equal(lastStep({ hostname: 'localhost', capacitor: { isNativePlatform: () => true, Plugins: {} } }), 'absent',
    'THE STEWARD APK IS OFFERED "Back to the Suite". Capacitor serves the APK from https://localhost, so a loopback check alone is true there — and there is no launcher on a phone.');
  assert.equal(lastStep({ hostname: 'app.trinityone.church', capacitor: null }), 'absent', 'the hosted console is offered "Back to the Suite" — it has no launcher');
});
