// THREE POP-UP SHEETS IN THE MEMBER APP DO NOT GO THROUGH <BottomSheet>, AND THEY CANNOT SCROLL.
//   Run: node --test scripts/the-hand-rolled-sheets-can-be-answered.test.mjs
//
// Most sheets in the member app are drawn by <BottomSheet> (app/ui.jsx), which caps its own height and
// scrolls its contents. Three are hand-rolled, and until this branch none of the three had either a cap or a
// scroller — so on a phone HELD SIDEWAYS (730 x 360 CSS px, which is one rotation away at any moment) the
// top of the sheet was simply off the screen, with nothing a member could do about it. Measured by this
// file, before the fix:
//
//     sheet                 panel height   in a 360px space   starts at   overflows by
//     BackupNudge               485px            360              -124        142px
//     ApproveNeedSheet          373px            360               -12         26px
//     RestrictedExplainer       ~317px           360                 0          0     <- "fits", at 360
//
// ⚠ AND 360 IS NOT WHAT THE PHONE GIVES. Measured on the Oppo (CPH2477) on 2026-09-16: held sideways the
// WebView reports 730 x 328 — the navigation bar takes the other 32px. Re-measured at 328, the third row
// stops fitting: remove RestrictedExplainer's cap and its panel starts at y = -5, so its heading is clipped
// off the TOP of a bottom-anchored sheet, where there is nothing to scroll back up with. All three caps
// bite. The original version of this file measured 360, called that row inert, and said so in a permanent
// comment in app/screens-chat.jsx as well — both are corrected. A test kinder than the handset reports a
// screen no member has.
//
// BackupNudge is the screen that asks a brand-new member to write down their 12 words, which is the one
// thing that keeps their account theirs; its heading, its illustration and its first line are what get cut.
//
// ⚠ AND NOBODY CAN SEE BACKUPNUDGE TODAY — SAY THAT PLAINLY RATHER THAN LET THIS FILE IMPLY OTHERWISE.
// `window.BackupNudge = BackupNudge` is the ONLY reference to it in the whole repo: nothing renders it.
// Measured, not assumed: `grep -rn BackupNudge . --exclude-dir=node_modules --exclude-dir=.git` returns its
// own declaration, that one window assignment, and this file. It arrived on 2026-06-05 in 2319088 (the Help
// Center design handoff) and was never wired up. So its two rows below are a fix to a screen that is
// currently unreachable — correct if it is ever wired up, and worth nothing until then.
// The two already-correct sheets in those same files — AskForHelpForm (app/screens-today.jsx) and
// GroupEventComposer (app/screens-chat.jsx) — cap themselves with `maxHeight` and `overflowY: 'auto'`, and
// that is exactly what these three now do.
//
// ⚠ RESTRICTEDEXPLAINER'S ROW WAS LABELLED "INERT" AND THAT WAS WRONG — it was inert only because this
// file measured a kinder screen than the handset. Landscape was 730x360 here; the Oppo (CPH2477) reports
// 730x328, the navigation bar taking the rest. Re-measured at 328 on 2026-09-16: remove that sheet's
// maxHeight and it lands at y = -5, heading clipped off the top of a bottom-anchored sheet with nothing to
// scroll back up with. The row BITES. Kept, unlabelled, as an ordinary sabotage row.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { WebSocket } from 'ws';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';
import { requireFreePort } from './test-ports.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const CDP = 9364;   // taken in the 93xx band: 9350-9352, 9354-9358, 9360-9363, 9381, 9390, 9395, 9397, 9412-9413
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── the tree -> HTML (the same serialiser todays-header-fits-the-phone.test.mjs uses; local for the same
// reason it is local there — it is a test instrument, and a shared one would be a third thing to keep in
// step with several files' different needs) ────────────────────────────────────────────────────────────────
const UNITLESS = new Set(['opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flex', 'flexGrow', 'flexShrink',
  'order', 'zoom', 'aspectRatio', 'strokeWidth', 'strokeDashoffset', 'strokeDasharray', 'fillOpacity', 'strokeOpacity']);
const SVG_ATTR = { strokeWidth: 'stroke-width', strokeLinecap: 'stroke-linecap', strokeLinejoin: 'stroke-linejoin',
  strokeDasharray: 'stroke-dasharray', strokeDashoffset: 'stroke-dashoffset', strokeOpacity: 'stroke-opacity',
  fillOpacity: 'fill-opacity', clipPath: 'clip-path', viewBox: 'viewBox', className: 'class', htmlFor: 'for' };
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'track', 'wbr']);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kebab = k => (k.startsWith('Webkit') ? '-webkit-' + k.slice(6) : k).replace(/[A-Z]/g, c => '-' + c.toLowerCase()).replace(/^-webkit--/, '-webkit-');
const css = style => Object.entries(style || {})
  .filter(([, v]) => v != null && v !== false && v !== '')
  .map(([k, v]) => `${kebab(k)}:${typeof v === 'number' && !UNITLESS.has(k) ? v + 'px' : v}`).join(';');

function serialize(node) {
  const nodes = [], out = [];
  (function walk(n) {
    if (n == null || n === false || n === true) return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n === 'string' || typeof n === 'number') { out.push(esc(n)); return; }
    if (typeof n !== 'object') return;
    if (typeof n.type === 'function' || n.type === 'Fragment') { (n.kids || []).forEach(walk); return; }
    const tag = String(n.type), tid = nodes.length;
    nodes.push(n);
    const attrs = [`data-tid="${tid}"`];
    let inner = null;
    for (const [k, v] of Object.entries(n.props || {})) {
      if (k === 'children' || k === 'key' || k === 'ref' || v == null || v === false || typeof v === 'function') continue;
      if (k === 'style') { const s = css(v); if (s) attrs.push(`style="${esc(s)}"`); continue; }
      if (k === 'dangerouslySetInnerHTML') { inner = v.__html; continue; }
      attrs.push(`${SVG_ATTR[k] || (/^[a-z-]+$/.test(k) ? k : kebab(k))}="${esc(v === true ? '' : v)}"`);
    }
    out.push(`<${tag} ${attrs.join(' ')}>`);
    if (inner != null) out.push(inner); else (n.kids || []).forEach(walk);
    if (!VOID.has(tag)) out.push(`</${tag}>`);
  })(node);
  return { html: out.join(''), nodes };
}

// ── the three real sheets ─────────────────────────────────────────────────────────────────────────────────
// A name a sheet needs that is not supplied here is a ReferenceError at the point of use — deliberately,
// because a silently-stubbed global is how a test ends up asserting about something that is not the code.
// HelpIllo, Halo and Icon are the REAL ones: they set real heights, and the whole question here is height.
const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

function globals(React) {
  const win = {
    addEventListener() {}, removeEventListener() {}, innerWidth: 360,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Fellowship: {}, TrinityData: {},
  };
  return {
    React, window: win, localStorage: win.localStorage,
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null, activeElement: null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    history: { back() {}, pushState() {}, replaceState() {}, state: null },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    cx: (...a) => a.filter(Boolean).join(' '),
    IconBtn: Stub('IconBtn'), Sheet: Stub('Sheet'),
  };
}

const SHEETS = [
  { rel: 'app/screens-help-main.jsx', name: 'BackupNudge',
    what: 'the "back up your 12 words" nudge, the one screen that keeps a new member\'s account theirs',
    props: { open: true, onClose() {}, onBackup() {} } },
  { rel: 'app/screens-today.jsx', name: 'ApproveNeedSheet',
    what: 'the "Set up help" form a steward fills in to turn a care request into a need',
    props: { req: { id: 'r1', type: 'Meals', types: ['Meals', 'Rides'], note: 'Hospital appointment Thursday', from: 'npub1aaa', name: 'Margaret' }, ctx: {}, onClose() {}, onDone() {} } },
  { rel: 'app/screens-chat.jsx', name: 'RestrictedExplainer',
    what: 'the "why is this restricted?" note a young person sees in a room they cannot post in',
    // ⚠ THE LONGEST OF ITS FOUR ARMS. This component says one of four different things — young person or
    // adult, and with or without any cleared adults to message — and a sheet that fits only in its shortest
    // wording is not fixed. `approved` non-empty is the one that adds the most copy.
    props: { ctx: { safeguard: { isMinor: true, approved: ['npub1a', 'npub1b', 'npub1c'] } }, onClose() {} } },
];

function sheetPage({ rel, name, props }) {
  const { React, draw } = miniReact();
  const g = globals(React);
  const { Icon, Halo } = loadScreen('app/icons.jsx', ['Icon', 'Halo'], { React, window: {} });
  const { HelpIllo } = loadScreen('app/help-illustrations.jsx', ['HelpIllo'], { React, window: {} });
  const mod = loadScreen(rel, [name], { ...g, Icon, Halo, HelpIllo });
  const tree = draw(mod[name], props);
  const { html, nodes } = serialize(tree);

  // nodes[0] is the sheet's outermost element — its full-screen backdrop layer.
  // The PANEL is the child of that layer which actually holds the controls; the other child (where there is
  // one) is the dimming rectangle. Found structurally, never by text.
  const kidsOf = (n) => (n.kids || []).filter(k => k && typeof k === 'object' && typeof k.type === 'string');
  const containsButton = (n) => find(n, x => x.type === 'button').length > 0;
  const panel = kidsOf(nodes[0]).find(containsButton);
  const panelTid = panel ? nodes.indexOf(panel) : -1;
  const btnTids = find(nodes[0], n => n.type === 'button').map(b => nodes.indexOf(b)).filter(i => i >= 0);
  const btnLabels = btnTids.map(i => texts(nodes[i]).join(' ').replace(/\s+/g, ' ').trim().slice(0, 40));

  return { name, panelTid, btnTids, btnLabels, html:
`<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/vendor/fonts/fonts.css">
<style>${[...readFileSync(join(ROOT, 'index.html'), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')}
html,body{margin:0;padding:0;height:100%;overflow:hidden}</style>
<!-- the member app's own phone shell: .trinity {position:fixed;inset:0} around PhoneFrame bare
     {position:absolute;inset:0;overflow:hidden}, exactly as app/app.jsx builds it on a handset. -->
<div class="trinity" style="position:fixed;inset:0">
  <div style="position:absolute;inset:0;overflow:hidden;background:var(--paper);color:var(--ink);font-family:var(--font-ui)">${html}</div>
</div>` };
}

const PAGES = SHEETS.map(sheetPage);

// ── lay it out in a real browser and read the rectangles ───────────────────────────────────────────────────
let chr = null, srv = null, ws = null, send = null, dir = null;

before(async () => {
  if (!CHROME) return;
  await requireFreePort(CDP, 'the-hand-rolled-sheets-can-be-answered.test.mjs (Chrome debug port)');
  dir = mkdtempSync(join(tmpdir(), 'trin-sheets-'));
  srv = createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const m = /^\/page(\d+)\.html$/.exec(p);
    if (m) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGES[+m[1]].html); }
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
  await send('Page.enable');
  await send('Runtime.enable');
});

after(() => { try { ws && ws.close(); } catch {} try { chr && chr.kill('SIGKILL'); } catch {}
  try { srv && srv.close(); } catch {} try { dir && rmSync(dir, { recursive: true, force: true }); } catch {} });

// 730x360 is the case that bites: a phone held sideways. 320x730 is a small phone upright, kept so a fix
// that works only sideways cannot pass.
const SIZES = [
  { w: 320, h: 730, name: '320x730, a small phone upright' },
  // 328, NOT 360. MEASURED ON THE OPPO (CPH2477) ON 2026-09-16: held sideways the WebView reports
  // 730 x 328 — the navigation bar takes the rest. The 32px difference is not academic: at 360 the
  // RestrictedExplainer cap below measures as doing nothing, and at 328 removing it puts that sheet's
  // heading at y = -5 with nothing to scroll back up with. A test that is kinder than the handset
  // reports a screen no member has.
  { w: 730, h: 328, name: '730x328, the Oppo held sideways (measured, not assumed)' },
];

const MEASURED = new Map();

async function rects(pi, si) {
  const P = PAGES[pi], S = SIZES[si];
  await send('Emulation.setDeviceMetricsOverride', { width: S.w, height: S.h, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: `http://127.0.0.1:${srv.address().port}/page${pi}.html` });
  await sleep(450);
  const expr = `(async () => { try { await document.fonts.ready; } catch (e) {}
    const el = t => document.querySelector('[data-tid="' + t + '"]');
    const box = e => { if (!e) return null; const b = e.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
               right: Math.round(b.right), bottom: Math.round(b.bottom) }; };
    const PANEL = el(${P.panelTid});
    const tids = ${JSON.stringify(P.btnTids)};
    const atRest = { panel: box(PANEL) };
    // Scroll the panel BOTH ways, since these sheets sit on the bottom edge and overflow UPWARD: the
    // controls are at the bottom and the heading is what goes off the top.
    const overflow = PANEL ? Math.max(0, PANEL.scrollHeight - PANEL.clientHeight) : 0;
    if (PANEL) PANEL.scrollTop = 0;
    const topAfterScrollUp = PANEL ? box(PANEL.firstElementChild) : null;
    const movedUp = PANEL ? Math.round(PANEL.scrollTop) : 0;
    if (PANEL) PANEL.scrollTop = PANEL.scrollHeight;
    const movedDown = PANEL ? Math.round(PANEL.scrollTop) : 0;
    const buttons = tids.map(t => { const e = el(t);
      return { label: e ? (e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40) : null, ...box(e) }; });
    const cs = PANEL ? getComputedStyle(PANEL) : null;
    return JSON.stringify({ vw: innerWidth, vh: innerHeight, atRest, buttons, overflow, movedUp, movedDown,
      topAfterScrollUp, panel: cs ? { maxHeight: cs.maxHeight, overflowY: cs.overflowY } : null }); })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  const thrown = r.result && r.result.exceptionDetails;
  assert.ok(!thrown, 'the measuring probe threw: ' + JSON.stringify(thrown || {}).slice(0, 300));
  return JSON.parse(r.result.result.value);
}

async function measure(pi, si) {
  const k = pi + ':' + si;
  if (!MEASURED.has(k)) MEASURED.set(k, await rects(pi, si));
  return MEASURED.get(k);
}

// ⚠ THE HARNESS CHECK COMES FIRST: a fixture that renders nothing passes every pixel assertion below.
test('all three hand-rolled sheets stood up, each with its own controls on it',
  { timeout: 120000 }, () => {
    const bad = PAGES.filter(p => p.panelTid < 0 || p.btnTids.length === 0)
      .map(p => p.name + ' (panel ' + p.panelTid + ', ' + p.btnTids.length + ' buttons)');
    assert.deepEqual(bad, [],
      'these sheets did not render a panel with controls, so nothing below is measuring them: ' + bad.join(', '));
    assert.equal(PAGES.length, 3, 'this file is about the three sheets that bypass <BottomSheet>');
  });

for (let pi = 0; pi < SHEETS.length; pi++) {
  for (let si = 0; si < SIZES.length; si++) {
    const S = SIZES[si], H = SHEETS[pi];
    test(`${H.name} fits on the phone at ${S.name}`,
      { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
        const m = await measure(pi, si);
        assert.deepEqual({ vw: m.vw, vh: m.vh }, { vw: S.w, vh: S.h },
          'the viewport is not the phone this case claims to be measuring');

        // THE PANEL MUST NOT START ABOVE THE TOP OF THE SCREEN. These sheets are anchored to the bottom
        // edge, so a panel taller than the phone overflows UPWARD — and there is no scrollbar on a
        // `flex-end` backdrop to get back up there. `maxHeight` is what stops it; `overflowY: auto` is what
        // lets the member reach the part that no longer fits.
        assert.ok(m.atRest.panel.y >= 0,
          `${H.name} — ${H.what} — starts at y=${m.atRest.panel.y}: ${-m.atRest.panel.y}px of it is above the ` +
          `top of a ${S.w}x${S.h} screen, and it is ${m.atRest.panel.h}px tall in a ${S.h}px space. Its ` +
          `computed cap and scroller: ${JSON.stringify(m.panel)}.`);

        // AND EVERY CONTROL MUST BE REACHABLE once the panel has been scrolled as far as it goes.
        const off = m.buttons.filter(b => b.y < 0 || b.bottom > m.vh);
        assert.deepEqual(off.map(b => `${b.label} (${b.y}..${b.bottom} of ${m.vh})`), [],
          `${H.name} puts these controls off the screen at ${S.w}x${S.h}, and the panel overflows by ` +
          `${m.overflow}px (scrolling it moved ${m.movedDown}px). ${H.what}.`);
      });
  }
}
