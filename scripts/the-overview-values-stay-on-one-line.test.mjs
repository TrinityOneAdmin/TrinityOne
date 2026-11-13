// EVERY OVERVIEW STAT VALUE STAYS ON ONE LINE, WHOLE, AND INSIDE ITS CARD — AT A PHONE AND IN THE SUITE'S
// FOUR-ACROSS BAND (2026-11-13, audit of item D).
//   Run: node --test scripts/the-overview-values-stay-on-one-line.test.mjs
//
// The first cut of item D let a StatCard value wrap (overflow-wrap:anywhere). The audit measured what that did
// in the snug band: at 860px "Down" broke mid-word onto two lines and the stat row grew 119 -> 152px, and at
// 860/900px 99999 split across two lines (reading as two numbers). The rule now: every value is ONE line,
// never cut with "…" (the pending "Checking…" status is the only exception), never painting outside its card —
// StatCard shrinks the value's font to fit instead.
//
// Real console, real Chromium, real gateway on a scratch dir. Geometry and computed style only (rule 3).
// Boots as a 360x730 phone (mobile:true), then goes desktop at 860 and 900 (mobile:false) — phone first,
// because switching desktop -> phone emulation mid-session leaves the layout viewport stuck (audit note).
//
// FORCED STATE, after boot: window.useStewardRelays, useStewardMembers, useStewardJoinPolicy and
// rosterReadyFrom are wrapped (each wrapper still calls the real hook, so hook order is unchanged):
//   · __t1Relay 'on' | 'off' — every relay reports that status, so "Your relay" reads Live or Down;
//   · the roster reads as settled with 99999 members and approval off, so Members reads 99999.
// Outputs are cached per input, so a wrapper never hands back a fresh array for the same input.
// Every case re-anchors on the tile text before measuring, and re-opens Overview so it mounts under the state.
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

let gw = null, c = null, errors = [];

async function startGateway() {
  const port = await freePort('the one-line-values test\'s gateway');
  const dataDir = mkdtempSync(join(tmpdir(), 'trin-one-line-values-'));
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
  const cdp = await freePort('the one-line-values test\'s Chrome debug port');
  const prof = mkdtempSync(join(tmpdir(), 'trin-one-line-values-chrome-'));
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


const FORCE = `(() => {
  if (window.__t1Wrapped) return 'already';
  const realReady = window.rosterReadyFrom, realMembers = window.useStewardMembers, realPolicy = window.useStewardJoinPolicy, realRelays = window.useStewardRelays;
  if ([realReady, realMembers, realPolicy, realRelays].some(f => typeof f !== 'function')) return 'missing';
  const fake = Array.from({ length: 99999 }, (_, i) => ({ pubkey: 'e'.repeat(56) + String(i).padStart(8, '0'), name: 'M' + i }));
  let lastIn = null, lastMode = null, lastOut = null;
  window.rosterReadyFrom = function () { return true; };
  window.useStewardMembers = function () { realMembers.apply(this, arguments); return fake; };
  window.useStewardJoinPolicy = function () { realPolicy.apply(this, arguments); return false; };
  window.useStewardRelays = function () {
    const r = realRelays.apply(this, arguments), mode = window.__t1Relay;
    if (!mode) return r;
    if (r !== lastIn || mode !== lastMode) { lastIn = r; lastMode = mode;
      const base = r && r.length ? r : [{ url: 'ws://127.0.0.1:9' }];
      lastOut = base.map(x => Object.assign({}, x, { status: mode })); }
    return lastOut;
  };
  window.__t1Wrapped = true; return 'ok';
})()`;

// Open a section: through ☰ on a phone, through the sidebar on the desktop.
async function openTab(label) {
  const phone = await c.evalIn(`!!document.querySelector('button[aria-label="Sections"]')`);
  if (phone) {
    await c.evalIn(`document.querySelector('button[aria-label="Sections"]').click()`);
    await c.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Sections"] nav[aria-label="Console sections"]')`, 'the sections menu', 10000);
  }
  const sel = phone ? '[role="dialog"][aria-label="Sections"] nav[aria-label="Console sections"] button' : 'nav[aria-label="Console sections"] button';
  const r = await c.evalIn(`(() => { const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>(x.textContent||'').trim().startsWith(${JSON.stringify(label)})); if(!b) return 'miss'; b.click(); return 'ok'; })()`);
  assert.equal(r, 'ok', `no "${label}" section — re-anchor`);
  if (phone) await c.waitFor(`!document.querySelector('[role="dialog"][aria-label="Sections"]')`, 'the menu to close', 10000);
  await sleep(1500);
}

async function setRelay(mode) {
  const w = await c.evalIn(FORCE);
  assert.ok(w === 'ok' || w === 'already', 're-anchor: could not wrap the console hooks (' + w + ')');
  await c.evalIn(`(() => { window.__t1Relay = ${JSON.stringify(mode)}; return 1; })()`);
  await openTab('Groups');
  await openTab('Overview');
}

// The stat row (the grid of four role=button cards) and, per card, the value line: how many lines its text
// takes, whether it stays inside the card's content box, and whether it is cut.
const STATS = `(() => {
  const grid = [...document.querySelectorAll('main div')].find(d => getComputedStyle(d).display === 'grid' && d.children.length === 4 && [...d.children].every(k => k.getAttribute('role') === 'button'));
  if (!grid) return JSON.stringify({ found: false });
  const cards = [...grid.children].map(card => {
    const label = (card.querySelector('span') || {}).textContent || '';
    // the value box: the element whose font-family is the display face and that is not the label row
    const box = [...card.querySelectorAll('div')].find(d => /800/.test(getComputedStyle(d).fontWeight) && (d.textContent || '').trim());
    if (!box) return { label, found: false };
    const rng = document.createRange(); rng.selectNodeContents(box);
    const rects = [...rng.getClientRects()].filter(r => r.width > 0.5);
    const tops = new Set(rects.map(r => Math.round(r.top)));
    const tr = rng.getBoundingClientRect();
    const cr = card.getBoundingClientRect(), cs = getComputedStyle(card);
    const innerRight = cr.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
    const cut = [box, ...box.querySelectorAll('*')].some(e => getComputedStyle(e).textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 0.5);
    const leaf = box.querySelector('span') || box;
    return { label, found: true, text: box.textContent.trim(), lines: tops.size, textRight: Math.round(tr.right), innerRight: Math.round(innerRight),
      cut, valueFont: parseFloat(getComputedStyle(leaf).fontSize) };
  });
  return JSON.stringify({ found: true, rowH: Math.round(grid.getBoundingClientRect().height), vw: innerWidth, cards });
})()`;

async function measure(mode, wantRelay) {
  await setRelay(mode);
  const m = JSON.parse(await c.evalIn(STATS));
  assert.equal(m.found, true, 're-anchor: no four-card stat row on the Overview');
  const by = Object.fromEntries(m.cards.map(k => [k.label, k]));
  assert.equal(by['Your relay'] && by['Your relay'].text, wantRelay, 're-anchor: "Your relay" does not read ' + wantRelay + ': ' + JSON.stringify(by['Your relay']));
  assert.equal(by.Members && by.Members.text, '99999', 're-anchor: Members does not read the forced 99999: ' + JSON.stringify(by.Members));
  return m;
}

function assertOneLineInside(m, where) {
  for (const k of m.cards) {
    assert.equal(k.found, true, where + ': no value box on the ' + k.label + ' card — re-anchor');
    assert.equal(k.lines, 1, `THE DEFECT (${where}): "${k.text}" on ${k.label} takes ${k.lines} lines`);
    assert.equal(k.cut, false, `THE DEFECT (${where}): "${k.text}" on ${k.label} is cut with "…"`);
    assert.ok(k.textRight <= k.innerRight + 0.5, `THE DEFECT (${where}): "${k.text}" on ${k.label} paints past its card (text right ${k.textRight} > ${k.innerRight})`);
  }
}

before(async () => {
  if (!CHROME) return;
  gw = await startGateway();
  c = await startChrome();
  await bootConsole();
});
after(() => { if (c) c.stop(); if (gw) gw.stop(); });

const cases = [
  { w: 360, h: 730, mobile: true },
  { w: 860, h: 780, mobile: false },
  { w: 900, h: 780, mobile: false },
];
for (const vp of cases) {
  test(`${vp.w}px${vp.mobile ? ' phone' : ''}: Live and Down, and a 5-digit count, each on ONE line inside its card; the row does not move`,
    { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
    if (vp.w !== 360) {
      await c.send('Emulation.clearDeviceMetricsOverride');
      await c.send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile });
      await sleep(1500);
    }
    const v = JSON.parse(await c.evalIn('JSON.stringify({ w: innerWidth })'));
    assert.equal(v.w, vp.w, 'the viewport is not the width we claim to be measuring');
    const live = await measure('on', 'Live');
    const down = await measure('off', 'Down');
    console.log('measured ' + vp.w + ' live: ' + JSON.stringify(live));
    console.log('measured ' + vp.w + ' down: ' + JSON.stringify(down));
    // The relay tile and the row height first, then every card: so a failure names the relay defect (the
    // audit's MEDIUM) even when a 5-digit count is also broken, instead of stopping at the count.
    const relayOf = (m) => ({ ...m, cards: m.cards.filter(k => k.label === 'Your relay') });
    assertOneLineInside(relayOf(live), vp.w + 'px Live');
    assertOneLineInside(relayOf(down), vp.w + 'px Down');
    assert.equal(down.rowH, live.rowH, `THE DEFECT (${vp.w}px): the stat row is ${live.rowH}px with the relay Live and ${down.rowH}px with it Down`);
    assertOneLineInside(live, vp.w + 'px Live');
    assertOneLineInside(down, vp.w + 'px Down');
    assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
  });
}
