// THE INSTALLED ROW'S SHARE BUTTON FITS A PHONE, BESIDE REMOVE, WITH A LONG MODULE NAME.
// Run: node --test scripts/installed-row-share-fits-a-phone.test.mjs
//
// Library → Installed gained a "Share" button, stacked above "Remove", on each shareable row (2026-11-13; what it does is
// scripts/sharing-the-app-and-a-bible-are-separate.test.mjs). Two buttons on one row leave the module name less
// room, so this lays the REAL row out in a real browser at 320 / 360 / 390px with a long name ("Brenton
// Septuagint Translation") and measures it with getBoundingClientRect().
//
// The real InstalledBrowser (app/screens-library.jsx), the real Icon (app/icons.jsx) and the real
// isShareableModule (app/share-app.jsx) are compiled and drawn through scripts/render-jsx-screen.mjs; the tree is
// serialised (serialiser copied from community-top-bar-is-one-row.test.mjs), dressed in index.html's own <style>
// and the app's fonts, inside the 18px side padding ModuleStore gives the list. Nothing here matches text in
// app/*.jsx (CLAUDE.md rule 3).
//
// NOT MEASURED BY THIS FILE: a real handset (rule 6). The owner looks at it on the Oppo before merge.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { WebSocket } from 'ws';
import { loadScreen, miniReact, find, texts, reads } from './render-jsx-screen.mjs';
import { requireFreePort } from './test-ports.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const CDP = 9631;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const UNITLESS = new Set(['opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flex', 'flexGrow', 'flexShrink', 'order', 'zoom', 'aspectRatio', 'strokeWidth']);
const SVG_ATTR = { strokeWidth: 'stroke-width', strokeLinecap: 'stroke-linecap', strokeLinejoin: 'stroke-linejoin', viewBox: 'viewBox', className: 'class' };
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link']);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kebab = k => (k.startsWith('Webkit') ? '-webkit-' + k.slice(6) : k).replace(/[A-Z]/g, c => '-' + c.toLowerCase()).replace(/^-webkit--/, '-webkit-');
const css = style => Object.entries(style || {}).filter(([, v]) => v != null && v !== false && v !== '')
  .map(([k, v]) => `${kebab(k)}:${typeof v === 'number' && !UNITLESS.has(k) ? v + 'px' : v}`).join(';');
function serialize(node) {
  const out = [];
  (function walk(n) {
    if (n == null || n === false || n === true) return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n === 'string' || typeof n === 'number') { out.push(esc(n)); return; }
    if (typeof n !== 'object') return;
    if (typeof n.type === 'function' || n.type === 'Fragment') { (n.kids || []).forEach(walk); return; }
    const tag = String(n.type), attrs = [];
    let inner = null;
    for (const [k, v] of Object.entries(n.props || {})) {
      if (k === 'children' || k === 'key' || k === 'ref' || v == null || v === false || typeof v === 'function') continue;
      if (k === 'style') { const s = css(v); if (s) attrs.push(`style="${esc(s)}"`); continue; }
      if (k === 'dangerouslySetInnerHTML') { inner = v.__html; continue; }
      attrs.push(`${SVG_ATTR[k] || (/^[a-zA-Z-]+$/.test(k) ? k : kebab(k))}="${esc(v === true ? '' : v)}"`);
    }
    out.push(`<${tag} ${attrs.join(' ')}>`);
    if (inner != null) out.push(inner); else (n.kids || []).forEach(walk);
    if (!VOID.has(tag)) out.push(`</${tag}>`);
  })(node);
  return out.join('');
}

const LONG = 'Brenton Septuagint Translation';
const RECORDS = [
  { url: 'modules/brenton.zip', abbr: 'LXXE', name: LONG, kind: 'bible', category: 'bibles' },
  { url: 'modules/eng-kjv.zip', abbr: 'KJV', name: 'King James Version', kind: 'bible', category: 'bibles' },
  { url: 'modules/matthew-henry.cmt.mybible.zip', abbr: 'MHC', name: "Matthew Henry's Commentary", kind: 'comment', category: 'commentaries' },
  { url: 'modules/lex-bdb.json', abbr: 'BDB', name: 'Brown-Driver-Briggs', kind: 'dict', category: 'dictionaries' },
];

function installedPage() {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const win = {
    Bible: {
      installedMap: () => Object.fromEntries(RECORDS.map(r => [r.url, r])),
      activeVersion: 'KJV', activeUrl: 'modules/eng-kjv.zip',
      removeModule: async () => true, isInstalled: () => true, subscribe: () => () => {}, versions: () => [],
      exportModule: async () => null,
    },
    TrinityData: {}, addEventListener() {}, removeEventListener() {},
  };
  win.isShareableModule = loadScreen('app/share-app.jsx', ['isShareableModule'], { React, window: {}, btoa }).isShareableModule;
  const { InstalledBrowser } = loadScreen('app/screens-library.jsx', ['InstalledBrowser'], {
    React, window: win, Icon, document: { addEventListener() {}, removeEventListener() {} },
    Spinner: () => null, ScreenScroll: (p) => p.children, safeCssColor: (c) => c || 'var(--clay)',
  });
  const tree = draw(InstalledBrowser, { ctx: { toast() {} }, category: null, force: () => {} });
  const html = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/vendor/fonts/fonts.css">
<style>${[...readFileSync(join(ROOT, 'index.html'), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')}
html,body{margin:0;padding:0} #app{position:relative;width:100%;box-sizing:border-box;padding:14px 18px 30px;overflow:hidden}</style>
<div id="app">${serialize(tree)}</div>`;
  return { html, tree };
}
const PAGE = installedPage();
const WIDTHS = [320, 360, 390];

let chr = null, srv = null, ws = null, send = null, dir = null;
before(async () => {
  if (!CHROME) return;
  await requireFreePort(CDP, 'installed-row-share-fits-a-phone.test.mjs (Chrome debug port)');
  dir = mkdtempSync(join(tmpdir(), 'trin-ishare-'));
  srv = createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/page.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE.html); }
    const f = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': { '.css': 'text/css', '.woff2': 'font/woff2' }[extname(f)] || 'application/octet-stream' });
    res.end(readFileSync(f));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu',
    '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9',
    `--user-data-dir=${join(dir, 'prof')}`, 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 50 && !(targets && targets.length); i++) { await sleep(300); try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', d => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
});
after(() => { try { ws && ws.close(); } catch {} try { chr && chr.kill('SIGKILL'); } catch {} try { srv && srv.close(); } catch {}
  try { dir && rmSync(dir, { recursive: true, force: true }); } catch {} });

async function measure(width) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: `http://127.0.0.1:${srv.address().port}/page.html` });
  await sleep(450);
  const expr = `(async () => { try { await document.fonts.ready; } catch (e) {}
    const box = e => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right), bottom: Math.round(b.bottom) }; };
    const nameEl = [...document.querySelectorAll('#app div')].find(e => e.children.length === 0 && e.textContent.trim() === ${JSON.stringify(LONG)});
    let row = nameEl; while (row && !(row.querySelector('button') && row.style.display === 'flex')) row = row.parentElement;
    const btn = t => row ? [...row.querySelectorAll('button')].find(b => b.textContent.trim() === t) : null;
    const lines = nameEl ? (() => { const r = document.createRange(); r.selectNodeContents(nameEl); return [...r.getClientRects()].map(b => Math.round(b.right)); })() : [];
    return JSON.stringify({ vw: document.documentElement.clientWidth, docW: document.documentElement.scrollWidth,
      name: box(nameEl), nameOverflow: nameEl ? nameEl.scrollWidth > nameEl.clientWidth + 1 : null, lineRights: lines,
      share: box(btn('Share')), remove: box(btn('Remove')), row: box(row) }); })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  assert.ok(!(r.result && r.result.exceptionDetails), 'probe threw: ' + JSON.stringify(r.result && r.result.exceptionDetails || {}).slice(0, 300));
  return JSON.parse(r.result.result.value);
}

test('the long-named row carries both Share and Remove (re-anchor guard)', () => {
  const rows = find(PAGE.tree, n => n.type === 'div' && texts(n).join(' ').includes(LONG)
    && find(n, x => x.type === 'button' && texts(x).join(' ').includes('Remove')).length === 1);
  assert.ok(rows.length, 'no row for the long-named Bible');
  const labels = find(rows[rows.length - 1], x => x.type === 'button').map(b => reads(b));
  assert.deepEqual(labels, ['Share', 'Remove'], `the row's buttons are ${JSON.stringify(labels)}`);
});

for (const width of WIDTHS) {
  test(`Installed row with Share + Remove fits at ${width}px`, { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
    const m = await measure(width);
    console.log(`# ${width}px: ` + JSON.stringify(m));
    assert.equal(m.vw, width);
    assert.ok(m.docW <= width, `the page scrolls sideways (${m.docW}px wide at ${width}px)`);
    assert.ok(m.name && m.share && m.remove, 'name, Share or Remove not found in the row');
    for (const k of ['share', 'remove']) assert.ok(m[k].x >= 0 && m[k].right <= width - 18 + 1, `${k} runs past the list's padding (${m[k].x}..${m[k].right})`);
    assert.ok(m.share.bottom <= m.remove.y || m.share.right <= m.remove.x, `Share (${JSON.stringify(m.share)}) overlaps Remove (${JSON.stringify(m.remove)})`);
    const buttonsStart = Math.min(m.share.x, m.remove.x);
    assert.ok(m.name.right <= buttonsStart, `the name (ends ${m.name.right}) runs under the buttons (start ${buttonsStart})`);
    assert.equal(m.nameOverflow, false, 'a word of the name is wider than the room left for it and spills out');
    assert.ok(m.lineRights.every(r => r <= buttonsStart), `a line of the name runs under the buttons: ${m.lineRights} vs ${buttonsStart}`);
    assert.ok(m.share.w >= 44 && m.remove.w >= 44, `a button was squeezed below a tappable width: ${m.share.w}/${m.remove.w}`);
    assert.ok(m.share.h >= 28 && m.remove.h >= 28, `a button is too short to tap: ${m.share.h}/${m.remove.h}`);
    assert.ok(m.name.h <= 3 * 22, `the name wraps onto more than three lines (${m.name.h}px)`);
  });
}
