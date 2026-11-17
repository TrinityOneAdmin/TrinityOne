// THE QUIET "Have a Bible file? Install it" LINE, IN REAL CHROMIUM, AT 320 AND 360 PX WIDE.
// Run: node --test scripts/install-from-file-quiet-link-in-browser.test.mjs
//
// Owner option A (2026-11-17): the big card above the tabs became one line under them. This opens the real member app, the real
// Library -> Bibles page, and MEASURES the link at phone widths: it must sit inside the screen (no horizontal overflow of the page
// row), be at least 44 px tall, sit below the tabs, and be gone as a card (no 'Install a Bible from a file' text). Tapping it reaches
// the real file input. Layout is the one thing the node screen tests cannot see.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { requireFreePort } from './test-ports.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const PORT = 8813, CDP = 9386;
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let relay, dataDir, chr, ws, prof, send;

before(async () => {
  await requireFreePort(PORT, 'install-from-file-quiet-link-in-browser.test.mjs');
  await requireFreePort(CDP, 'install-from-file-quiet-link-in-browser.test.mjs (Chrome debug port)');
  if (!CHROME) return;
  dataDir = mkdtempSync(join(tmpdir(), 'trin-quiet-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, TRINITY_DATA_DIR: dataDir } });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(200); }
  prof = mkdtempSync(join(tmpdir(), 'trin-quiet-chr-'));
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu',
    '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9',
    `--user-data-dir=${prof}`, '--window-size=1000,900', `http://127.0.0.1:${PORT}/`], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  ws = new WebSocket((targets.find(t => t.type === 'page') || targets[0]).webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', d => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
});
after(() => { try { ws && ws.close(); } catch {} try { chr && chr.kill('SIGKILL'); } catch {} try { relay && relay.kill('SIGKILL'); } catch {}
  try { rmSync(prof, { recursive: true, force: true }); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) throw new Error('page threw: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result.result.value;
}
async function waitEngine() { for (let i = 0; i < 150; i++) { try { if (await ev('!!(window.Bible && window.Bible.installFromBytes && window.Bible.loaded)')) return; } catch {} await sleep(300); } assert.fail('the engine never came up'); }


async function measure(width) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: true });
  await sleep(600);
  return JSON.parse(await ev(`(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const clickText = async (re) => { for (let i = 0; i < 60; i++) { const el = [...document.querySelectorAll('button, [role=button], div')].reverse().find(x => re.test((x.textContent || '').trim()) && (x.textContent || '').length < 60); if (el) { el.click(); return true; } await wait(250); } return false; };
    const lib = await clickText(/^Library$/); await wait(600);
    const bibles = await clickText(/^Bibles/); await wait(900);
    const out = { lib, bibles, tabs: {} };
    for (const tab of ['Featured', 'All bibles', 'Installed']) {
      await clickText(new RegExp('^' + tab + '$')); await wait(500);
      const b = document.querySelector('button[data-install-from-file]');
      const seg = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === tab);
      if (!b) { out.tabs[tab] = null; continue; }
      const r = b.getBoundingClientRect(), s = seg.getBoundingClientRect();
      out.tabs[tab] = { left: r.left, right: r.right, height: r.height, top: r.top, tabsBottom: s.bottom, text: b.textContent.trim(), name: b.innerText.trim(), scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth };
    }
    out.oldCard = /Install a Bible from a file|Got one over Signal/.test(document.body.innerText);
    return JSON.stringify(out);
  })()`));
}

for (const width of [320, 360]) {
  test(`the quiet install link fits, is 44 px tall and sits under the tabs at ${width} px`, { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
    await waitEngine(); await sleep(3000);
    const m = await measure(width);
    assert.equal(m.bibles, true, 'could not open Library -> Bibles: ' + JSON.stringify(m));
    for (const tab of ['Featured', 'All bibles', 'Installed']) {
      const t = m.tabs[tab];
      assert.ok(t, `${tab}: the link is not on the page`);
      assert.equal(t.text, 'Have a Bible file? Install it');
      assert.ok(t.left >= 0 && t.right <= t.innerW, `${tab}: the link leaves the screen (${t.left}..${t.right} of ${t.innerW})`);
      assert.ok(t.scrollW <= t.innerW, `${tab}: the page scrolls sideways (${t.scrollW} > ${t.innerW})`);
      assert.ok(t.height >= 44, `${tab}: ${t.height}px tall`);
      assert.ok(t.top >= t.tabsBottom - 1, `${tab}: the link is not below the tabs`);
    }
    assert.equal(m.oldCard, false, 'the old big card is still on the page');
  });
}

test('tapping the link opens the real file input', { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
  const clicked = await ev(`(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    let n = 0; const orig = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () { if (this.type === 'file') n++; return orig.apply(this, arguments); };
    document.querySelector('button[data-install-from-file]').click(); await wait(500);
    HTMLInputElement.prototype.click = orig; return n;
  })()`);
  assert.ok(clicked >= 1, 'pressing the link did not open the file input');
});

// ── round 2: Dictionaries and Commentaries wording, and the text's contrast in light and dark ──
const PAGE_HELPERS = `
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const clickText = async (re) => { for (let i = 0; i < 60; i++) { const el = [...document.querySelectorAll('button, [role=button], div')].reverse().find(x => re.test((x.textContent || '').trim()) && (x.textContent || '').length < 60); if (el) { el.click(); return true; } await wait(250); } return false; };
  const lum = (rgb) => { const c = rgb.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
  const parse = (s) => { const m = s.match(/[\\d.]+/g).map(Number); return { rgb: m.slice(0, 3), a: m.length > 3 ? m[3] : 1 }; };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const p = parse(getComputedStyle(e).backgroundColor); if (p.a > .95) return p.rgb; } return [255, 255, 255]; };
  const contrast = (el) => { const f = parse(getComputedStyle(el).color).rgb, b = bgOf(el); const a = lum(f), c = lum(b); return (Math.max(a, c) + .05) / (Math.min(a, c) + .05); };
  const goBack = () => { const h = [...document.querySelectorAll('h1')].find(x => /Bibles|Dictionaries|Commentaries/.test(x.textContent)); const b = h && h.parentElement.parentElement.querySelector('button'); if (b) b.click(); return !!b; };
`;
test('Dictionaries and Commentaries say "Have a file? Install it"; Bibles say "Have a Bible file? Install it"', { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  await waitEngine();
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true }); await sleep(600);
  const got = JSON.parse(await ev(`(async () => { ${PAGE_HELPERS}
    const out = {}; await clickText(/^Library$/); await wait(600);
    for (const [key, re] of [['dictionaries', /^Dictionaries/], ['commentaries', /^Commentaries/], ['bibles', /^Bibles/]]) {
      const opened = await clickText(re); await wait(900);
      const b = document.querySelector('button[data-install-from-file]');
      out[key] = { opened, text: b ? b.textContent.trim() : null }; goBack(); await wait(700);
    }
    return JSON.stringify(out); })()`));
  assert.deepEqual([got.dictionaries.text, got.commentaries.text, got.bibles.text],
    ['Have a file? Install it', 'Have a file? Install it', 'Have a Bible file? Install it'], JSON.stringify(got));
});

for (const theme of ['light', 'dark']) {
  test(`the line's text is at least 4.5:1 against its background in ${theme} mode`, { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
    await waitEngine();
    await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true }); await sleep(600);
    const r = JSON.parse(await ev(`(async () => { ${PAGE_HELPERS}
      await clickText(/^Library$/); await wait(600); await clickText(/^Bibles/); await wait(900);
      const root = document.querySelector('.trinity'); root.classList.toggle('dark', ${theme === 'dark'}); await wait(400);
      const b = document.querySelector('button[data-install-from-file]');
      return JSON.stringify({ dark: root.classList.contains('dark'), ratio: contrast(b), color: getComputedStyle(b).color }); })()`));
    assert.equal(r.dark, theme === 'dark');
    assert.ok(r.ratio >= 4.5, `${theme}: contrast ${r.ratio.toFixed(2)}:1 (${r.color}) is under AA 4.5:1`);
  });
}
