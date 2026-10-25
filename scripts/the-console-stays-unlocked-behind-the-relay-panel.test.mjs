// THE CONSOLE STAYS UNLOCKED WHILE A STEWARD VISITS THE RELAY PAGES.
// Run: node --test scripts/the-console-stays-unlocked-behind-the-relay-panel.test.mjs
//
// Owner, 2026-10: the console's church key is locked with a PIN and, once unlocked, lives only in the console
// page's memory. Following "Relay & Suite home" / "Open relay control panel" was a full-page navigation, so the
// console unloaded and coming back asked for the PIN every time. On the Suite those two links now open the relay
// page in a full-window PANEL (a same-origin iframe) over the console, and "Back to console" closes it — the
// console page is never unloaded, so nothing about the key changes and nothing new is stored anywhere.
//
// POINT OF USE (CLAUDE.md rules 1 and 3): everything below is read off the SHIPPED pages in headless Chromium
// served by a real gateway with an empty data dir. The church is made through the console's own wizard, with a
// PIN, so it is a genuinely PIN-locked key that is genuinely unlocked. "The console did not reload" is measured
// with a marker on the console's window object; "still unlocked" is Steward.hasKey && !Steward.locked AND the
// dashboard on screen and no PIN field. Nothing matches text in app/*.jsx or relay-app/*.js.
// NOTHING REACHES PRODUCTION: shipped hosts resolve to a dead port and are refused inside the gateway.
// Skips itself without chromium.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
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

const live = new Set();
after(() => { for (const s of live) s.stop(); });

// A fresh Suite install: an EMPTY data dir (or one seeded with exactly the file named), loopback, no origin.
async function startGateway({ seed = {}, env: extraEnv = {} } = {}) {
  const port = await freePort('the relay-panel test\'s gateway');
  const dataDir = mkdtempSync(join(tmpdir(), 'trin-panel-'));
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

async function startChrome(url) {
  const cdp = await freePort('the relay-panel test\'s Chrome debug port');
  const prof = mkdtempSync(join(tmpdir(), 'trin-panel-chrome-'));
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
  const c = { evalIn, goto, send, stop() { live.delete(c); try { ws.close(); } catch {} try { chr.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch {} } };
  live.add(c);
  return c;
}

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

// ── reading the console and the panel ─────────────────────────────────────────────────────────────────────
const readConsole = (c) => c.evalIn(`(() => { const on = ${ON};
  const S = window.Steward || {};
  return JSON.stringify({ path: location.pathname, marker: window.__marker === 1, hasKey: !!S.hasKey, locked: !!S.locked,
    pinField: [...document.querySelectorAll('input')].some(i => i.type === 'password' && on(i)),
    sidebarLink: on(document.querySelector('a[href="/relay-app/home.html"]')),
    panel: !!document.getElementById('relayPanelFrame'), hook: !!window.__trinityRelayPanel }); })()`).then(JSON.parse);
const readFrame = (c) => c.evalIn(`(() => { const on = ${ON}; const f = document.getElementById('relayPanelFrame'); if (!f) return 'null';
  let path = '', ready = '', title = '';
  try { path = f.contentWindow.location.pathname; ready = f.contentDocument.readyState; title = f.contentDocument.title; } catch (e) {}
  const b = document.getElementById('relayPanelBack'); const r = f.getBoundingClientRect();
  return JSON.stringify({ path, ready, title, on: on(f), w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, bottom: Math.round(r.bottom), vh: innerHeight, back: b ? (b.textContent || '').trim() : null, backOn: on(b) }); })()`).then(JSON.parse);
const inFrame = (c, js) => c.evalIn(`(() => { const d = document.getElementById('relayPanelFrame').contentDocument; return (function (document) { ${js} })(d); })()`);
const frameAt = (c, path) => waitFor(c, `(() => { const f = document.getElementById('relayPanelFrame'); try { return f && f.contentDocument.readyState === 'complete' && f.contentWindow.location.pathname === ${JSON.stringify(path)}; } catch (e) { return false; } })()`, 'the panel to show ' + path, 20000);
const panelClosed = (c) => waitFor(c, `!document.getElementById('relayPanelFrame')`, 'the panel to close', 10000);
const clickSidebarLink = (c) => c.evalIn(`(() => { const a = document.querySelector('a[href="/relay-app/home.html"]'); if (!a) return 'missing'; a.click(); return 'ok'; })()`);

// The console must be exactly as the steward left it: same page (marker), same URL, key in memory, no PIN screen.
async function assertConsoleUntouched(c, what) {
  const k = await readConsole(c);
  assert.equal(k.path, '/steward.html', what + ': THE TOP WINDOW LEFT THE CONSOLE — ' + JSON.stringify(k));
  assert.equal(k.marker, true, what + ': THE CONSOLE PAGE RELOADED (its window marker is gone) — the key in its memory went with it: ' + JSON.stringify(k));
  assert.deepEqual([k.hasKey, k.locked, k.pinField], [true, false, false], what + ': the console asks for the PIN again: ' + JSON.stringify(k));
  assert.equal(k.panel, false, what + ': the panel is still open: ' + JSON.stringify(k));
  assert.equal(k.hook, false, what + ': the frame hook outlived the panel: ' + JSON.stringify(k));
  assert.equal(k.sidebarLink, true, what + ': the dashboard is not on screen: ' + JSON.stringify(k));
}

test('the relay pages open in a panel over the console; every way out of it leaves the console unlocked and un-reloaded',
  { skip: !CHROME ? 'no chromium' : false, timeout: 420000 }, async () => {
  const gw = await startGateway();
  const c = await startChrome(gw.base + '/steward.html');
  try {
    // ── the box allows same-origin framing of the pages we frame (the design depends on it) ──
    for (const p of ['/relay-app/home.html', '/relay-app/control.html']) {
      const r = await fetch(gw.base + p);
      assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN', p + ' cannot be framed by the console');
      assert.match(r.headers.get('content-security-policy') || '', /frame-ancestors 'self'/, p + ' has no frame-ancestors \'self\'');
    }
    assert.match((await fetch(gw.base + '/steward.html').then(r => r.headers.get('content-security-policy'))) || '', /frame-src 'self'/, 'the console cannot frame its own origin');

    // ── a real, PIN-locked church, unlocked ──
    await walkConsoleWizard(c, 'St Brigid on the Suite');
    assert.equal(await clickButton(c, '/Go to dashboard/'), 'ok', 'no "Go to dashboard"');
    await waitFor(c, `!!document.querySelector('a[href="/relay-app/home.html"]')`, 'the dashboard (sidebar) — is the sidebar hidden at 900px?', 30000);
    // Then do what the owner does: close the console, open it again, and unlock it with the PIN. (A key made in
    // the wizard has no idle lock armed until the next unlock, so the idle row below needs the real thing.)
    await c.goto(gw.base + '/steward.html');
    await waitFor(c, `!!document.querySelector('input[aria-label="Your console PIN or passphrase"]')`, 'the PIN screen after reopening the console', 60000);
    assert.equal(await typeInto(c, `document.querySelector('input[aria-label="Your console PIN or passphrase"]')`, 'cedar-harbour-lamp-42'), 'ok');
    await sleep(200);
    assert.equal(await clickButton(c, '/^Unlock$/'), 'ok', 'no Unlock button');
    await waitFor(c, `!!document.querySelector('a[href="/relay-app/home.html"]')`, 'the dashboard after unlocking with the PIN', 60000);
    assert.equal(await c.evalIn(`window.Steward.hasPinLock()`), true, 'staging: this church has no PIN lock, so "unlocked" proves nothing');
    await c.evalIn(`window.__marker = 1`);
    await assertConsoleUntouched(c, 'baseline');

    // ── 1. the sidebar link opens the panel, not a page load ──
    assert.equal(await clickSidebarLink(c), 'ok');
    await frameAt(c, '/relay-app/home.html');
    let F = await readFrame(c);
    assert.deepEqual([F.on, F.backOn, F.back], [true, true, '← Back to console'], 'the panel is not on screen with its "Back to console" bar: ' + JSON.stringify(F));
    assert.ok(F.w === F.vw && F.bottom === F.vh && F.h >= 300, 'the panel is not full-window: ' + JSON.stringify(F));
    let k = await readConsole(c);
    assert.deepEqual([k.path, k.marker, k.panel, k.hook], ['/steward.html', true, true, true], 'opening the panel navigated the console: ' + JSON.stringify(k));
    assert.match(await inFrame(c, `return document.body.innerText`), /relay|console|Suite/i, 'the frame shows no launcher');

    // ── 2. a console-bound link INSIDE the panel closes it (the launcher's door) ──
    await waitFor(c, `(() => { const d = document.getElementById('relayPanelFrame').contentDocument; return !!d.querySelector('a.mode[href="/steward.html"]') && !d.querySelector('a.mode').closest('[hidden]'); })()`, 'the launcher\'s console door', 20000);
    assert.equal(await inFrame(c, `const a = document.querySelector('a.mode[href="/steward.html"]'); a.click(); return 'ok'`), 'ok');
    await panelClosed(c);
    await sleep(1500);   // a second console booting in the frame, or the top window leaving, would show by now
    await assertConsoleUntouched(c, 'a console link inside the panel');

    // ── 3. "Back to console" ──
    assert.equal(await clickSidebarLink(c), 'ok');
    await frameAt(c, '/relay-app/home.html');
    assert.equal(await clickId(c, 'relayPanelBack'), 'ok');
    await panelClosed(c);
    await assertConsoleUntouched(c, 'Back to console');

    // ── 4. Escape, pressed inside the frame (where the steward's focus is) ──
    assert.equal(await clickSidebarLink(c), 'ok');
    await frameAt(c, '/relay-app/home.html');
    await inFrame(c, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await panelClosed(c);
    await assertConsoleUntouched(c, 'Escape inside the panel');

    // ── 5. the relay control panel: its three ways to the console, via the card in Settings ──
    assert.equal(await clickButton(c, '/^Settings$/'), 'ok', 'no Settings in the console');
    await waitFor(c, `[...document.querySelectorAll('button,div,span')].some(x => x.children.length === 0 && /^infrastructure$/i.test((x.textContent || '').trim()))`, 'the Infrastructure group', 20000);
    await c.evalIn(`(() => { const x = [...document.querySelectorAll('button,div,span')].find(x => x.children.length === 0 && /^infrastructure$/i.test((x.textContent || '').trim())); (x.closest('button') || x).click(); })()`);
    await waitFor(c, `[...document.querySelectorAll('button,div,span')].some(x => x.children.length === 0 && /^Run your own box$/.test((x.textContent || '').trim()))`, 'the "Run your own box" row', 20000);
    await c.evalIn(`(() => { const x = [...document.querySelectorAll('button,div,span')].find(x => x.children.length === 0 && /^Run your own box$/.test((x.textContent || '').trim())); (x.closest('button') || x).click(); })()`);
    await waitFor(c, `!!document.querySelector('a[href="/relay-app/control.html"]')`, 'the "Open relay control panel" link', 20000);
    for (const how of ['goConsole', 'openConsole', 'nextStepConsole-or-cfgNoneConsole']) {
      await c.evalIn(`document.querySelector('a[href="/relay-app/control.html"]').click()`);
      await frameAt(c, '/relay-app/control.html');
      F = await readFrame(c);
      assert.equal(F.backOn, true, 'no "Back to console" over the control panel: ' + JSON.stringify(F));
      await waitFor(c, `!!document.getElementById('relayPanelFrame').contentDocument.getElementById('openConsole')`, 'control.js to run', 20000);
      if (how === 'nextStepConsole-or-cfgNoneConsole') {
        // the church-list warning's link is rendered by control.js once /status says no church is on this relay; this box has one, so
        // drive the delegated handler with a link of the shape control.js writes (id cfgNoneConsole), created in the live page
        assert.equal(await inFrame(c, `const a = document.createElement('a'); a.id = 'cfgNoneConsole'; a.href = '/steward.html'; a.textContent = 'open the console'; document.body.appendChild(a); a.click(); return 'ok'`), 'ok');
      } else {
        assert.equal(await inFrame(c, `document.getElementById(${JSON.stringify(how)}).click(); return 'ok'`), 'ok', 'no #' + how);
      }
      await panelClosed(c);
      await sleep(1200);
      await assertConsoleUntouched(c, 'control panel #' + how);
    }

    // ── 6. idle auto-lock hears the steward working inside the frame ──
    await c.evalIn(`(() => { window.__idleArms = 0; const real = window.setTimeout; window.setTimeout = function (fn, ms) { if (ms === 600000) window.__idleArms++; return real.apply(this, arguments); }; })()`);
    await c.evalIn(`document.querySelector('a[href="/relay-app/control.html"]').click()`);
    await frameAt(c, '/relay-app/control.html');
    await sleep(500);
    const before = Number(await c.evalIn(`window.__idleArms`));
    const fr = JSON.parse(await c.evalIn(`(() => { const r = document.getElementById('relayPanelFrame').getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`));
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fr.x, y: fr.y });
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fr.x + 20, y: fr.y + 10 });
    await waitFor(c, `window.__idleArms > ${before}`, 'the console\'s idle timer to be re-armed by mouse movement INSIDE THE PANEL (before=' + before + ')', 5000);
    const mid = Number(await c.evalIn(`window.__idleArms`));
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', text: 'a' }); await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a' });
    await waitFor(c, `window.__idleArms > ${mid}`, 'the idle timer to be re-armed by a key pressed inside the panel', 5000);

    // ── 7. SAFETY NET: if the frame ever lands on the console it is blanked and the panel closed ──
    await c.evalIn(`window.__frameEl = document.getElementById('relayPanelFrame'); window.__frameEl.src = '/steward.html'`);
    await panelClosed(c);
    await sleep(1500);
    assert.equal(await c.evalIn(`window.__frameEl.getAttribute('src')`), 'about:blank', 'the frame that reached /steward.html was not blanked — a second console may be running in it');
    await assertConsoleUntouched(c, 'the safety net');

    // ── 8. at the Suite window's minimum size (720x560) the bar and the frame still fit ──
    await c.send('Emulation.setDeviceMetricsOverride', { width: 720, height: 560, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    // (this width is the console's narrow layout, which has no sidebar link; the panel is opened by the event
    // the links send, so what is measured here is the narrow layout's own panel host and the bar's fit)
    await c.evalIn(`window.dispatchEvent(new CustomEvent('stew-open-relay-panel', { detail: { url: '/relay-app/control.html' } }))`);
    await frameAt(c, '/relay-app/control.html');
    F = await readFrame(c);
    assert.deepEqual([F.backOn, F.on], [true, true], 'at 720x560 the panel is broken: ' + JSON.stringify(F));
    assert.ok(F.w === F.vw && F.bottom === F.vh && F.h >= 300, 'at 720x560 the frame is squeezed: ' + JSON.stringify(F));
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await panelClosed(c);
    await c.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
    await waitFor(c, `!!document.querySelector('a[href="/relay-app/home.html"]')`, 'the sidebar link back at 900px', 10000);
    await assertConsoleUntouched(c, 'Escape in the console after the panel');

    // ── 9. OFF THE SUITE the same link is a plain link. The APK is "loopback and Capacitor", so stage that. ──
    await c.evalIn(`window.Capacitor = {}`);
    assert.equal(await clickSidebarLink(c), 'ok');
    await waitFor(c, `location.pathname === '/relay-app/home.html'`, 'a plain navigation to the launcher off the Suite', 15000);
    assert.equal(await c.evalIn(`!document.getElementById('relayPanelFrame')`), true);
  } finally { c.stop(); gw.stop(); }
});
