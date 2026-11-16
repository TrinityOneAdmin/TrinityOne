// "SHARE AS IMAGE" AND THE DEVOTIONAL: THE HEADER SITS AT THE TOP, NOT 50px DOWN.
// Run: node --test scripts/share-card-and-devotional-headers-have-no-gap.test.mjs
//
// Owner report (2026-11-16): a gap at the top of the "Share as image" page. ShareCard (now app/share-app.jsx)
// and DevotionalView (app/app.jsx) both had paddingTop calc(env(safe-area-inset-top, 0px) + 50px). On Android
// the WebView already sits below the status bar (inset 0), so that left a 50px empty band — the defect
// d38bc67 / fb93a55 / 977f8ba fixed on the other overlays by using + 8px. Owner: fix both screens.
//
// CLAUDE.md rule 3: no text-matching of app/*.jsx. The REAL ShareCard (compiled from app/share-app.jsx) and the
// REAL DevotionalView (compiled from app/app.jsx, whole), with the real Icon and IconBtn, are drawn through
// scripts/render-jsx-screen.mjs, serialised, and laid out by headless Chromium (env(safe-area-inset-top) is 0
// there — the Android WebView case). The assertion reads getBoundingClientRect() of each screen's back button.
// FAKED, and named: Overlay (a faithful copy of app/ui.jsx's frame — its hooks need a DOM), window.TrinityData.
// Sabotage check: put `+ 50px` back on either screen and its back button reads ~58-60px, failing <= 24px.
// NOT MEASURED HERE: a real handset with a notch (inset > 0).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { loadScreen, miniReact, texts } from './render-jsx-screen.mjs';
import { requireFreePort } from './test-ports.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const CDP = 9622;   // unique across scripts/*.test.mjs
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

const DEVO = { title: 'Rest for the weary', ref: 'Matthew 11:28', series: 'Morning light', day: 'Day 3', body: ['Come to me.'] };
const VERSE = { ref: 'John 3:16', version: 'WEB', text: 'For God so loved the world, that he gave his one and only Son.' };

function screens() {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const { IconBtn } = loadScreen('app/ui.jsx', ['IconBtn'], { React, window: {}, Icon });
  const noop = () => {};
  // Overlay's own frame (app/ui.jsx): a full-size flex column holding a flex:1 column. Kept faithful so the
  // header's y is the real one.
  const Overlay = ({ open, children }) => (open ? { type: 'div', props: { style: { position: 'absolute', inset: 0, background: 'var(--paper)', display: 'flex', flexDirection: 'column', alignItems: 'center' } },
    kids: [{ type: 'div', props: { style: { width: '100%', maxWidth: 860, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } }, kids: [].concat(children) }] } : null);
  const win = { TrinityData: { DEVOTIONAL: DEVO } };
  const { ShareCard } = loadScreen('app/share-app.jsx', ['ShareCard'], { React, window: win, Icon, IconBtn, Overlay, BottomSheet: noop, btoa, File, Blob, fetch: noop, console, navigator: {}, document: {}, URL, setTimeout });
  // app.jsx compiled WHOLE; its last statement mounts <App/> into #root, so ReactDOM/document are given inert.
  const { DevotionalView } = loadScreen('app/app.jsx', ['DevotionalView'], {
    React, window: win, Icon, IconBtn, Overlay, TrinityErrorBoundary: noop,
    ReactDOM: { createRoot: () => ({ render() {} }) }, document: { getElementById: () => null },
  });
  const ctx = { shareText: noop, openShareSheet: noop, toast: noop };
  return {
    share: draw(ShareCard, { verse: VERSE, open: true, onClose: noop, ctx }),
    devo: draw(DevotionalView, { open: true, onClose: noop, ctx }),
  };
}
function page(tree) {
  const style = [...readFileSync(join(ROOT, 'index.html'), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${style}
html,body{margin:0;padding:0;height:100%} #app{position:relative;width:100%;height:100%;overflow:hidden}</style><div id="app">${serialize(tree)}</div>`;
}

test('both screens render (so the measurement below is of the real screens)', () => {
  const s = screens();
  const shareText = texts(s.share).join(' ');
  assert.ok(shareText.includes('Share verse') && shareText.includes('John 3:16'), 'ShareCard did not draw its header and verse');
  const devoText = texts(s.devo).join(' ');
  assert.ok(devoText.includes('Rest for the weary') && devoText.includes('Close this devotional'), 'DevotionalView did not draw its title and close button');
});

test('"Share as image" and the devotional: back button sits at the top, no status-bar gap (inset 0, 390x844)',
  { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
    const s = screens();
    await requireFreePort(CDP, 'share-card-and-devotional-headers-have-no-gap.test.mjs (Chrome debug port)');
    dir = mkdtempSync(join(tmpdir(), 'trin-sharegap-'));
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
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const { result: { frameTree } } = await send('Page.getFrameTree');
    const measure = async (tree) => {
      await send('Page.setDocumentContent', { frameId: frameTree.frame.id, html: page(tree) });
      await sleep(300);
      const expr = `(async () => { try { await document.fonts.ready; } catch (e) {}
        const btn = document.querySelector('button');
        return JSON.stringify({ vw: document.documentElement.clientWidth, btnTop: btn.getBoundingClientRect().top, btnLabel: btn.getAttribute('aria-label') || btn.getAttribute('title') || '' }); })()`;
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      assert.ok(!(r.result && r.result.exceptionDetails), 'probe threw: ' + JSON.stringify(r.result && r.result.exceptionDetails || {}).slice(0, 300));
      return JSON.parse(r.result.result.value);
    };
    const sh = await measure(s.share);
    assert.equal(sh.vw, 390);
    assert.ok(sh.btnTop <= 24, `"Share as image": the back button starts ${sh.btnTop}px from the top; with inset 0 it should be ~16px (before the fix: ~58px)`);
    const dv = await measure(s.devo);
    assert.equal(dv.btnLabel, 'Close this devotional', 'the first button on the devotional is not its close button — re-anchor this test');
    assert.ok(dv.btnTop <= 24, `devotional: the close button starts ${dv.btnTop}px from the top; with inset 0 it should be ~18px (before the fix: ~60px)`);
  });
