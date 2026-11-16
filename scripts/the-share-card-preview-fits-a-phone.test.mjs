// THE "SHARE AS IMAGE" PREVIEW IS THE PICTURE, WHOLE, ON A 320 / 360 / 390px PHONE — AND THE SHARE BUTTON STAYS ON SCREEN.
// Run: node --test scripts/the-share-card-preview-fits-a-phone.test.mjs
//
// Before 2026-11-16 the preview was a CSS card sized to the phone (4:5, overflow hidden), and on a 320 or 360px
// phone it cut the verse at both ends. The preview is now the PNG that will be shared (shareCardRender), shown
// with object-fit: contain in whatever room is left, so the whole card — 4:5, or a long passage's 9:16 — shows.
//
// The REAL ShareCard (app/share-app.jsx) with the real Icon / IconBtn is drawn through
// scripts/render-jsx-screen.mjs, after its own effect has drawn the picture, and laid out in headless Chromium.
// FAKED, and named: the canvas inside the harness (it records nothing here) and URL.createObjectURL, which hands
// the <img> a REAL PNG of the card's size (1080 x 1350, or 1080 x 1920) made below — so the browser lays out a
// real image of the real proportions. Overlay is the faithful frame used by the header-gap test.
// NOT MEASURED HERE: a real handset (notch, browser chrome); the picture's own pixels (the-verse-card-is-a-real-png).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import zlib from 'node:zlib';
import { WebSocket } from 'ws';
import { loadScreen, miniReact } from './render-jsx-screen.mjs';
import { requireFreePort } from './test-ports.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const CDP = 9641;   // unique across scripts/*.test.mjs
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

// A real, solid-colour PNG of w x h.
function solidPng(w, h) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3); for (let i = 1; i < row.length; i += 3) { row[i] = 0xC2; row[i + 1] = 0x5A; row[i + 2] = 0x38; }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const VERSE = { ref: 'John 3:16', version: 'WEB', text: 'For God so loved the world, that he gave his one and only Son.' };
async function cardWithPicture(w, h) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const { IconBtn } = loadScreen('app/ui.jsx', ['IconBtn'], { React, window: {}, Icon });
  const noop = () => {};
  const Overlay = ({ open, children }) => (open ? { type: 'div', props: { style: { position: 'absolute', inset: 0, background: 'var(--paper)', display: 'flex', flexDirection: 'column', alignItems: 'center' } },
    kids: [{ type: 'div', props: { style: { width: '100%', maxWidth: 860, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } }, kids: [].concat(children) }] } : null);
  const ctx2d = { font: '', fillStyle: '#000000', measureText: (t) => ({ width: String(t).length * 10 }), fillText: noop, fillRect: noop, strokeRect: noop,
    save: noop, restore: noop, translate: noop, scale: noop, stroke: noop, createLinearGradient: () => ({ addColorStop: noop }) };
  const document = { fonts: { load: async () => [] }, body: null,
    createElement: () => ({ getContext: () => ctx2d, toBlob: (cb) => cb(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })) }) };
  const dataUrl = 'data:image/png;base64,' + solidPng(w, h).toString('base64');
  const URLx = { createObjectURL: () => dataUrl, revokeObjectURL: noop };
  const { ShareCard } = loadScreen('app/share-app.jsx', ['ShareCard'], { React, window: {}, Icon, IconBtn, Overlay, BottomSheet: noop, btoa, File, Blob, fetch: noop,
    console, navigator: {}, document, URL: URLx, setTimeout: () => 0, verseShareText: () => '' });
  const props = { verse: VERSE, open: true, onClose: noop, ctx: { shareText: noop, toast: noop } };
  draw(ShareCard, props);
  await sleep(30);
  return draw(ShareCard, props);
}
function page(tree) {
  const style = [...readFileSync(join(ROOT, 'index.html'), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${style}
html,body{margin:0;padding:0;height:100%} #app{position:relative;width:100%;height:100%;overflow:hidden}</style><div id="app">${serialize(tree)}</div>`;
}

test('the preview is the drawn picture (an <img>), not a CSS card', async () => {
  const html = serialize(await cardWithPicture(1080, 1350));
  assert.match(html, /<img [^>]*src="data:image\/png;base64,/, 'the card on screen is not the picture that will be shared');
});

test('at 320, 360 and 390px wide, the whole card shows (4:5 and 9:16) and the Share button stays on screen',
  { skip: !CHROME ? 'no chromium' : false, timeout: 90000 }, async () => {
    const trees = { '4:5': await cardWithPicture(1080, 1350), '9:16': await cardWithPicture(1080, 1920) };
    await requireFreePort(CDP, 'the-share-card-preview-fits-a-phone.test.mjs (Chrome debug port)');
    dir = mkdtempSync(join(tmpdir(), 'trin-sharefit-'));
    chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu', '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9',
      `--user-data-dir=${join(dir, 'prof')}`, 'about:blank'], { stdio: 'ignore' });
    let targets = null;
    for (let i = 0; i < 50 && !(targets && targets.length); i++) { await sleep(300); try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch {} }
    assert.ok(targets && targets.length, 'chromium never exposed a debug target');
    const pg = targets.find(t => t.type === 'page') || targets[0];
    ws = new WebSocket(pg.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    let id = 0; const pend = new Map();
    ws.on('message', d => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Page.enable'); await send('Runtime.enable');
    const { result: { frameTree } } = await send('Page.getFrameTree');
    for (const [vw, vh] of [[320, 568], [360, 640], [390, 844]]) {
      await send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: true });
      for (const [shape, tree] of Object.entries(trees)) {
        await send('Page.setDocumentContent', { frameId: frameTree.frame.id, html: page(tree) });
        const expr = `(async () => {
          const img = document.querySelector('img'); if (!img) return JSON.stringify({ noImg: true });
          if (!img.complete) await new Promise(r => { img.onload = r; img.onerror = r; });
          const r = img.getBoundingClientRect();
          const btns = [...document.querySelectorAll('button')];
          const share = btns.find(b => b.textContent.includes('Share this verse')).getBoundingClientRect();
          const swatch = btns.find(b => (b.getAttribute('aria-label') || '').startsWith('Card style')).getBoundingClientRect();
          const head = btns[0].getBoundingClientRect();
          // object-fit: contain — the picture's drawn size inside its box
          const ar = img.naturalWidth / img.naturalHeight, w = Math.min(r.width, r.height * ar), h = w / ar;
          return JSON.stringify({ nw: img.naturalWidth, nh: img.naturalHeight, top: r.top, bottom: r.bottom, left: r.left, right: r.right, w, h,
            headBottom: head.bottom, swatchTop: swatch.top, shareBottom: share.bottom, scrollW: document.documentElement.scrollWidth }); })()`;
        const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        assert.ok(!res.result.exceptionDetails, 'probe threw: ' + JSON.stringify(res.result.exceptionDetails || {}).slice(0, 300));
        const m = JSON.parse(res.result.result.value);
        const at = `${vw}x${vh} ${shape}`;
        assert.ok(!m.noImg, `${at}: no picture on screen`);
        assert.equal(m.nw, 1080, `${at}: the picture did not load`);
        assert.ok(m.top >= m.headBottom - 0.5, `${at}: the picture runs under the header (${m.top} < ${m.headBottom})`);
        assert.ok(m.bottom <= m.swatchTop + 0.5, `${at}: the picture runs into the style buttons (${m.bottom} > ${m.swatchTop})`);
        assert.ok(m.left >= 0 && m.right <= vw, `${at}: the picture runs off the side (${m.left}..${m.right})`);
        assert.ok(m.shareBottom <= vh, `${at}: the Share button is off screen (bottom ${m.shareBottom} > ${vh})`);
        assert.ok(m.scrollW <= vw, `${at}: the page scrolls sideways (${m.scrollW} > ${vw})`);
        assert.ok(m.h >= 200 && m.w >= 110, `${at}: the picture is shown too small to read (${Math.round(m.w)}x${Math.round(m.h)})`);
      }
    }
  });
