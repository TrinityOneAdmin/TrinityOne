// THE BIBLE BOOK PICKER'S HEADER SITS AT THE TOP, NOT 52px DOWN.
// Run: node --test scripts/bible-book-picker-header-has-no-gap.test.mjs
//
// Owner report: "In the Bible book selection there is a header gap still, all other gaps of this kind have been
// fixed." d38bc67 / fb93a55 replaced hard-coded 50-56px status-bar clearances with
// calc(env(safe-area-inset-top, 0px) + 8px), because on Android the WebView already sits below the status bar
// (inset 0) and a fixed value leaves a visible gap. BookPicker (app/screens-read.jsx) was missed: paddingTop: 52.
//
// CLAUDE.md rule 3: no text-matching of app/*.jsx. The REAL BookPicker + IconBtn + Icon are compiled and drawn
// through scripts/render-jsx-screen.mjs, serialised, and laid out by a real browser (headless Chromium over CDP, where
// env(safe-area-inset-top) is 0 - exactly the Android WebView case). The assertion reads getBoundingClientRect().
// Sabotage check: put `paddingTop: 52` back and the header's top edge reads 60px, failing the <= 24px bound.
// NOT MEASURED HERE: a real handset with a notch (inset > 0).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { loadScreen, miniReact } from './render-jsx-screen.mjs';
import { requireFreePort } from './test-ports.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const CDP = 9620;   // unique across scripts/*.test.mjs
const sleep = ms => new Promise(r => setTimeout(r, ms));
let chr = null, ws = null, dir = null;
after(() => { try { ws && ws.close(); } catch {} try { chr && chr.kill('SIGKILL'); } catch {} try { dir && rmSync(dir, { recursive: true, force: true }); } catch {} });

const UNITLESS = new Set(['opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flex', 'flexGrow', 'flexShrink', 'order', 'zoom', 'aspectRatio', 'strokeWidth']);
const SVG_ATTR = { strokeWidth: 'stroke-width', strokeLinecap: 'stroke-linecap', strokeLinejoin: 'stroke-linejoin', viewBox: 'viewBox', className: 'class' };
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link']);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kebab = k => (k.startsWith('Webkit') ? '-webkit-' + k.slice(6) : k).replace(/[A-Z]/g, c => '-' + c.toLowerCase()).replace(/^-webkit--/, '-webkit-');
const css = st => Object.entries(st || {}).filter(([, v]) => v != null && v !== false && v !== '')
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

function bookPickerPage() {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const { IconBtn } = loadScreen('app/ui.jsx', ['IconBtn'], { React, window: {}, Icon });
  const meta = [['Genesis', 'ot', 50], ['Exodus', 'ot', 40], ['Psalms', 'ot', 150], ['Matthew', 'nt', 28], ['John', 'nt', 21], ['Jude', 'nt', 1]]
    .map(([name, group, ch], i) => ({ num: i + 1, name, group, ch }));
  const win = { Bible: { bookMeta: () => meta, getVerses: () => [] } };
  const noop = () => {};
  const { BookPicker } = loadScreen('app/screens-read.jsx', ['BookPicker'], new Proxy({
    React, window: win, Icon, IconBtn,
    // Overlay's own frame (app/ui.jsx): a full-size flex column. Kept faithful so the header's y is the real one.
    Overlay: ({ open, children }) => (open ? { type: 'div', props: { style: { position: 'absolute', inset: 0, background: 'var(--paper)', display: 'flex', flexDirection: 'column' } }, kids: [].concat(children) } : null),
  }, { has: () => true, get: (t, k) => (k in t ? t[k] : (k === Symbol.unscopables ? undefined : noop)) }));
  const tree = draw(BookPicker, { open: true, onClose: noop, onPick: noop, version: 'KJV' });
  const style = [...readFileSync(join(ROOT, 'index.html'), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${style}
html,body{margin:0;padding:0;height:100%} #app{position:relative;width:100%;height:100%;overflow:hidden}</style><div id="app">${serialize(tree)}</div>`;
}

test('the book picker renders (books are on screen, so the measurement below is of the real screen)', () => {
  const html = bookPickerPage();
  for (const w of ['OLD TESTAMENT', 'NEW TESTAMENT', 'Genesis', 'Jude', 'Books']) assert.ok(html.includes(w), `${w} missing from the rendered picker`);
});

test('Bible book picker: header sits at the top of the screen, no status-bar gap (inset 0, 390x844)',
  { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
    await requireFreePort(CDP, 'bible-book-picker-header-has-no-gap.test.mjs (Chrome debug port)');
    dir = mkdtempSync(join(tmpdir(), 'trin-bkpick-'));
    chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu', '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9',
      `--user-data-dir=${join(dir, 'prof')}`, 'about:blank'], { stdio: 'ignore' });
    let targets = null;
    for (let i = 0; i < 50 && !(targets && targets.length); i++) { await sleep(300); try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch {} }
    assert.ok(targets && targets.length, 'chromium never exposed a debug target');
    const page = targets.find(t => t.type === 'page') || targets[0];
    ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    let id = 0; const pend = new Map();
    ws.on('message', d => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const { result: { frameTree } } = await send('Page.getFrameTree');
    await send('Page.setDocumentContent', { frameId: frameTree.frame.id, html: bookPickerPage() });
    await sleep(300);
    const expr = `(async () => { try { await document.fonts.ready; } catch (e) {}
      const h = document.querySelector('h1'), btn = document.querySelector('button');
      return JSON.stringify({ vw: document.documentElement.clientWidth, h1Text: h.textContent, h1Top: h.getBoundingClientRect().top, btnTop: btn.getBoundingClientRect().top }); })()`;
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    assert.ok(!(r.result && r.result.exceptionDetails), 'probe threw: ' + JSON.stringify(r.result && r.result.exceptionDetails || {}).slice(0, 300));
    const m = JSON.parse(r.result.result.value);
    assert.equal(m.vw, 390);
    assert.equal(m.h1Text, 'Books');
    assert.ok(m.btnTop <= 24, `the picker's back/close button starts ${m.btnTop}px from the top; with inset 0 it should be ~16px (before the fix: 60px)`);
    assert.ok(m.h1Top <= 28, `the "Books" heading starts ${m.h1Top}px from the top (before the fix: ~62px)`);
  });
