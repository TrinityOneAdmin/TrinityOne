// "Checking…" ON THE OVERVIEW MEMBERS TILE STAYS INSIDE ITS CARD ON A PHONE, AND A REAL COUNT IS NEVER CUT
// SHORT (2026-11-13, item D — the geometry half; the component half is the-checking-tile-is-a-status-not-a-number).
//   Run: node --test scripts/the-checking-tile-fits-a-phone.test.mjs
//
// A real console in a real Chromium against a real gateway on a scratch dir, at 360x730 as a PHONE
// (Emulation mobile:true). Nothing here matches text in app/*.jsx (rule 3): it is geometry and computed style.
//
// HOW THE TILE IS FORCED. "Checking…" lasts only until the roster settles, so measuring it by timing would
// flake (audit 2026-11-13). Once the console is up, a script wraps three window hooks the console installs:
//   · window.rosterReadyFrom      — returns false while __t1Force === 'checking' (the roster has not settled),
//                                   true while __t1Force === 'count';
//   · window.useStewardMembers    — still CALLS the real hook (so hook order is unchanged), but in 'count'
//                                   mode returns 1234 synthetic members;
//   · window.useStewardJoinPolicy — same pattern; false in 'count' mode so all 1234 are counted.
// The flag is flipped, the hold-last store is reset, and the Overview is re-opened through the ☰ menu so
// DashOverview mounts afresh under the forced state. Each case re-anchors on the tile's text first.
//
// 1.5× TEXT. Android WebView may scale every font by the system font size; that is NOT measured on the APK here
// and nothing below claims it is. What is emulated: every element's computed font-size × 1.5 written back
// as an inline !important size, once, after the tile shows the count — box sizes and paddings unchanged, which
// is what a text zoom does. Then the count must be shown whole: text-overflow is not ellipsis, nothing hides
// its overflow, and its text stays inside its card.
import { test, before, after } from 'node:test';
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
const VW = 360, VH = 730;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const BLACKHOLE = `const real = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const u = String(input && input.url ? input.url : input);
  if (/trinityone\\.church|\\.ts\\.net|trycloudflare/i.test(u)) return Promise.reject(new Error('blackholed by test: ' + u));
  return real.call(this, input, init);
};\n`;

// Run once the console is up (its hooks are assigned by then; app/steward-root.jsx declares useStewardMembers
// as a global FUNCTION, which would replace any accessor installed before load). Each wrapper still calls the
// real hook, so hook order is unchanged.
const FORCE = `(() => {
  if (window.__t1Wrapped) return 'already';
  const fake = Array.from({ length: 1234 }, (_, i) => ({ pubkey: 'f'.repeat(56) + String(i).padStart(8, '0'), name: 'Member ' + i }));
  const realReady = window.rosterReadyFrom, realMembers = window.useStewardMembers, realPolicy = window.useStewardJoinPolicy;
  if (typeof realReady !== 'function' || typeof realMembers !== 'function' || typeof realPolicy !== 'function') return 'missing';
  window.rosterReadyFrom = function () { if (window.__t1Force === 'checking') return false; if (window.__t1Force === 'count') return true; return realReady.apply(this, arguments); };
  window.useStewardMembers = function () { const r = realMembers.apply(this, arguments); return window.__t1Force === 'count' ? fake : r; };
  window.useStewardJoinPolicy = function () { const r = realPolicy.apply(this, arguments); return window.__t1Force === 'count' ? false : r; };
  window.__t1Wrapped = true; return 'ok';
})()`;

let gw = null, c = null, errors = [];

async function startGateway() {
  const port = await freePort('the checking-tile test\'s gateway');
  const dataDir = mkdtempSync(join(tmpdir(), 'trin-checking-tile-'));
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
  return { base, stop() { try { proc.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} } };
}

async function startChrome() {
  const cdp = await freePort('the checking-tile test\'s Chrome debug port');
  const prof = mkdtempSync(join(tmpdir(), 'trin-checking-tile-chrome-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD,
    `--user-data-dir=${prof}`, `--window-size=${VW},${VH}`, 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.method === 'Runtime.exceptionThrown') { const e = m.params.exceptionDetails; errors.push(String((e.exception && e.exception.description) || e.text || '').split('\n')[0]); }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });
  const evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr && rr.result && rr.result.exceptionDetails) {
      const e = rr.result.exceptionDetails;
      throw new Error('the page threw: ' + String((e.exception && e.exception.description) || e.text || 'threw').split('\n')[0]);
    }
    return rr && rr.result && rr.result.result ? rr.result.result.value : undefined;
  };
  const waitFor = async (expr, what, ms = 90000) => { const t0 = Date.now(); let ok = false; while (!ok && Date.now() - t0 < ms) { await sleep(500); try { ok = !!(await evalIn(expr)); } catch {} } assert.ok(ok, 'timed out waiting for ' + what); };
  return { evalIn, send, waitFor, goto: (u) => send('Page.navigate', { url: u }),
    stop() { try { ws.close(); } catch {} try { chr.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} } };
}

// Boot a church the way a person does, first-run wizard kept off (the-console-fits-a-360px-phone explains why).
async function bootConsole() {
  await c.goto(gw.base + '/steward.html');
  await c.waitFor(`[...document.querySelectorAll('button')].some(x => /Start a new church/i.test((x.textContent||'').trim()))`, 'the setup screen');
  await c.evalIn(`(() => { const orig = Storage.prototype.removeItem; Storage.prototype.removeItem = function (k) { if (k === 'trinityone.steward.wizard.done') return; return orig.call(this, k); };
    localStorage.setItem('trinityone.steward.wizard.done', '1'); return 'ok'; })()`);
  await c.evalIn(`[...document.querySelectorAll('button')].find(x => /Start a new church/i.test((x.textContent||'').trim())).click()`);
  await c.waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('At least 8'))`, 'the PIN gate', 60000);
  const type = (ph, v) => `(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(ph)})); if(!i) return 'miss'; const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
  assert.equal(await c.evalIn(type('At least 8', 'cedar-harbour-lamp-42')), 'ok');
  assert.equal(await c.evalIn(type('Type it again', 'cedar-harbour-lamp-42')), 'ok');
  await c.evalIn(`[...document.querySelectorAll('button')].find(x => /Set PIN/i.test((x.textContent||'').trim())).click()`);
  await c.waitFor(`!!document.querySelector('button[aria-label="Sections"]') && !document.querySelector('[role="dialog"]')`, 'the phone dashboard, with no modal over it');
  await sleep(1500);
}

// Open a section through ☰ the way a steward does on a phone.
async function openTab(label) {
  assert.equal(await c.evalIn(`(() => { const b = document.querySelector('button[aria-label="Sections"]'); if (!b) return 'miss'; b.click(); return 'ok'; })()`), 'ok', 'no ☰ control — re-anchor');
  await c.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Sections"] nav[aria-label="Console sections"]')`, 'the sections menu', 10000);
  const r = await c.evalIn(`(() => { const b=[...document.querySelectorAll('[role="dialog"][aria-label="Sections"] nav[aria-label="Console sections"] button')].find(x=>(x.textContent||'').trim().startsWith(${JSON.stringify(label)})); if(!b) return 'miss'; b.click(); return 'ok'; })()`);
  assert.equal(r, 'ok', `no "${label}" row in the sections menu — re-anchor`);
  await c.waitFor(`!document.querySelector('[role="dialog"][aria-label="Sections"]')`, 'the menu to close', 10000);
  await sleep(1200);
}

// Put the console in a forced state and remount the Overview under it.
async function force(mode) {
  const w = await c.evalIn(FORCE);
  assert.ok(w === 'ok' || w === 'already', 're-anchor: could not wrap the console hooks (' + w + ')');
  await c.evalIn(`(() => { window.__t1Force = ${JSON.stringify(mode)}; window.__realMemberCountHeld = { key: '__t1-reset', n: null }; return 1; })()`);
  await openTab('Groups');
  await c.evalIn(`(() => { window.__realMemberCountHeld = { key: '__t1-reset', n: null }; return 1; })()`);
  await openTab('Overview');
}

// The Members tile: its card (the role=button whose first span says "Members") and the value line under it —
// the card's second child block (the first is the icon+label row; the third the sub line).
const MEMBERS = `(() => {
  const card = [...document.querySelectorAll('main [role="button"]')].find(el => { const sp = el.querySelector('span'); return sp && sp.textContent.trim() === 'Members'; });
  if (!card) return JSON.stringify({ found: false });
  const valueBox = card.children[1];
  const leaf = valueBox.querySelector('span') || valueBox;   // the pending status is a span inside the value box
  const cr = card.getBoundingClientRect(), cs = getComputedStyle(card);
  const inner = { left: cr.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft), right: cr.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight) };
  const rng = document.createRange(); rng.selectNodeContents(leaf); const tr = rng.getBoundingClientRect();
  const ls = getComputedStyle(leaf), vs = getComputedStyle(valueBox);
  return JSON.stringify({ found: true, text: valueBox.textContent.trim(),
    leafFont: parseFloat(ls.fontSize), boxFont: parseFloat(vs.fontSize),
    leafOverflow: ls.overflowX, leafTextOverflow: ls.textOverflow, boxOverflow: vs.overflowX, boxTextOverflow: vs.textOverflow,
    leafScroll: leaf.scrollWidth, leafClient: leaf.clientWidth,
    textLeft: Math.round(tr.left), textRight: Math.round(tr.right), cardInnerLeft: Math.round(inner.left), cardInnerRight: Math.round(inner.right),
    cardRight: Math.round(cr.right), vw: innerWidth });
})()`;

before(async () => {
  if (!CHROME) return;
  gw = await startGateway();
  c = await startChrome();
  await bootConsole();
});
after(() => { if (c) c.stop(); if (gw) gw.stop(); });

test('360px phone, Members tile forced to "Checking…": the status is small and stays inside its card',
  { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  const v = JSON.parse(await c.evalIn('JSON.stringify({ w: innerWidth, h: innerHeight })'));
  assert.deepEqual(v, { w: VW, h: VH }, 'the viewport is not the phone we claim to be measuring');
  await force('checking');
  const m = JSON.parse(await c.evalIn(MEMBERS));
  assert.equal(m.found, true, 'no Members tile on the Overview — re-anchor');
  console.log('measured (Checking…): ' + JSON.stringify(m));
  assert.equal(m.text, 'Checking…', 're-anchor: the forced tile does not read "Checking…" (it reads ' + JSON.stringify(m.text) + ')');
  assert.ok(m.leafFont <= 16, 'THE DEFECT: "Checking…" is drawn at ' + m.leafFont + 'px on a phone');
  assert.ok(m.leafScroll <= m.leafClient + 1, '"Checking…" is cut short in its box: needs ' + m.leafScroll + ' of ' + m.leafClient);
  assert.ok(m.textRight <= m.cardInnerRight + 0.5, 'THE DEFECT: "Checking…" paints past its card: text right ' + m.textRight + ' > card content right ' + m.cardInnerRight);
  assert.ok(m.cardRight <= m.vw + 0.5, 'the Members card itself is off the right of the phone');
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

test('360px phone at 1.5× text, a 4-digit count: the whole number is shown, never cut with "…"',
  { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  await force('count');
  const base = JSON.parse(await c.evalIn(MEMBERS));
  assert.equal(base.text, '1234', 're-anchor: the forced tile does not read the 4-digit count (it reads ' + JSON.stringify(base.text) + ')');
  // 1.5× every computed font-size, written back once (see header).
  await c.evalIn(`(() => { const els = [...document.querySelectorAll('body *')]; const sizes = els.map(e => parseFloat(getComputedStyle(e).fontSize));
    els.forEach((e, i) => e.style.setProperty('font-size', (sizes[i] * 1.5) + 'px', 'important')); return els.length; })()`);
  await sleep(300);
  const m = JSON.parse(await c.evalIn(MEMBERS));
  assert.equal(m.text, '1234', 'the count changed under the text scale — re-anchor');
  console.log('measured (1234 at 1.5x): ' + JSON.stringify(m));
  assert.ok(m.boxFont >= 41, 're-anchor: the 1.5× scale did not apply to the count (' + m.boxFont + 'px)');
  assert.notEqual(m.boxTextOverflow, 'ellipsis', 'THE DEFECT: the count can be cut with "…"');
  assert.notEqual(m.boxOverflow, 'hidden', 'THE DEFECT: the count is clipped');
  assert.ok(m.leafScroll <= m.leafClient + 1, 'the count needs ' + m.leafScroll + 'px of a ' + m.leafClient + 'px box');
  assert.ok(m.textRight <= m.cardInnerRight + 0.5, 'the count paints past its card: text right ' + m.textRight + ' > card content right ' + m.cardInnerRight);
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});
