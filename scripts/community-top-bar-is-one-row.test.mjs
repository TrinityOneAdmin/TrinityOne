// THE COMMUNITY TAB'S TOP BAR IS ONE ROW: church selector on the left (ellipsising), three icons on the right.
// Run: node --test scripts/community-top-bar-is-one-row.test.mjs
//
// Owner decision (task #6): on the Community tab the church pill used to sit full-width on its own line with
// Search / Direct messages / the profile avatar on a second, right-aligned line. They now share ONE row; the
// pill takes the width the icons leave and ellipsises the church name. A church with a brand BANNER keeps the
// full-bleed 3:1 image (it cannot sit inline) with the icons in their own row beneath it, as before.
//
// CLAUDE.md rule 3: nothing here matches text in app/*.jsx. The REAL ChatScreen, ChurchPill, ChurchBadge,
// IconBtn, UserAvatar and Icon are compiled and rendered through scripts/render-jsx-screen.mjs; the tree is
// serialised, dressed in index.html's own <style> and the app's own Sora fonts, and laid out by a real browser
// at 320 / 360 / 390px. Every assertion reads getBoundingClientRect().
//
// NOT MEASURED BY THIS FILE: a real handset. The parent/owner must look at it on a device before merge.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { WebSocket } from 'ws';
import { loadScreen, miniReact, find } from './render-jsx-screen.mjs';
import { requireFreePort } from './test-ports.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const CDP = 9500;
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

const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const LONG = 'St Bartholomew-the-Great Anglican Church of Greater Lower Wessex';
const ICONS = ['Search', 'Direct messages', 'Your anonymous identity'];

function communityPage({ width, banner }) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const safeImgUrl = u => (typeof u === 'string' && u.startsWith('data:image/') ? u : '');
  const { IconBtn } = loadScreen('app/ui.jsx', ['IconBtn'], { React, window: {}, Icon });
  const { UserAvatar } = loadScreen('app/identity-avatar.jsx', ['UserAvatar'], { React, window: {}, safeImgUrl });
  const { ChurchBadge, ChurchPill } = loadScreen('app/screens-church.jsx', ['ChurchBadge', 'ChurchPill'],
    { React, window: {}, Icon, safeCssColor: (c, d) => d, safeImgUrl });
  const win = {
    Fellowship: { myPubkey: 'mehex', relays: [], subscribeChurchGroups: (_n, cb) => { cb([]); return () => {}; },
      subscribeChurchCategories: (_n, cb) => { cb([]); return () => {}; }, subscribeGroups: () => () => {},
      displayFor: () => ({ handle: 'sam', color: '#888' }), assumeMinor: async () => false },
    TrinityData: { CHAT_IDENTITY: { handle: 'me', color: '#123456' }, GROUPS: [], RELAYS: [] },
    TrinityIdentity: { current: { handle: 'me', color: '#123456' } },
    addEventListener() {}, removeEventListener() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  const { ChatScreen } = loadScreen('app/screens-chat.jsx', ['ChatScreen'], {
    React, window: win,
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
    location: { search: '', href: 'https://app.trinityone.church/' },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    lsGet: (_k, d) => d, lsSet() {}, todayISO: () => '2026-10-15',
    Icon, IconBtn, ChurchPill, UserAvatar, safeImgUrl,
    Overlay: ({ open, children }) => (open ? children : null),
    BottomSheet: ({ open, children }) => (open ? children : null),
    ScreenScroll: ({ children }) => children,
    SectionLabel: ({ children }) => children,
    safeCssColor: c => c, relTime: () => 'now', D: { GROUPS: [], RELAYS: [] },
  });
  const ctx = {
    toast() {}, church: { npub: 'npub1c', name: LONG, id: 'c1', initials: 'SB', banner: banner ? GIF : undefined },
    joinState: { loaded: true, isPending: false, removed: false, offline: false, unknown: false },
    myLeaderGroups: [], churchEvents: [], myPubkey: 'mehex', safeguard: { isMinor: false, clearanceKnown: true },
    openPeople() {}, openDM() {}, openDMInbox() {}, openGroup() {}, openProfile() {}, openChurchSwitcher() {},
    dmUnread: true,
  };
  draw(ChatScreen, { ctx });
  const tree = draw(ChatScreen, { ctx });
  const html = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/vendor/fonts/fonts.css">
<style>${[...readFileSync(join(ROOT, 'index.html'), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')}
html,body{margin:0;padding:0} #app{position:relative;width:100%;box-sizing:border-box;padding:0 18px;overflow:hidden}</style>
<div id="app">${serialize(tree)}</div>`;
  return { html, tree };
}

let chr = null, srv = null, ws = null, send = null, dir = null;
const CASES = [];
for (const width of [320, 360, 390]) for (const banner of [false, true]) CASES.push({ width, banner });
const PAGES = CASES.map(c => communityPage(c));

before(async () => {
  if (!CHROME) return;
  await requireFreePort(CDP, 'community-top-bar-is-one-row.test.mjs (Chrome debug port)');
  dir = mkdtempSync(join(tmpdir(), 'trin-cbar-'));
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
  await send('Page.enable'); await send('Runtime.enable');
});
after(() => { try { ws && ws.close(); } catch {} try { chr && chr.kill('SIGKILL'); } catch {} try { srv && srv.close(); } catch {}
  try { dir && rmSync(dir, { recursive: true, force: true }); } catch {} });

async function rects(i) {
  await send('Emulation.setDeviceMetricsOverride', { width: CASES[i].width, height: 800, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: `http://127.0.0.1:${srv.address().port}/page${i}.html` });
  await sleep(450);
  const expr = `(async () => { try { await document.fonts.ready; } catch (e) {}
    const box = e => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right), bottom: Math.round(b.bottom) }; };
    const q = s => document.querySelector(s);
    const bar = q('[data-top-bar]');
    const btn = t => q('[title="' + t + '"]');
    const icons = ${JSON.stringify(ICONS)};
    const sel = bar ? [...bar.querySelectorAll('button')].find(b => !icons.includes(b.getAttribute('title'))) : null;
    const nameEl = [...document.querySelectorAll('button div, button span')].find(e => e.children.length === 0 && e.textContent.trim() === ${JSON.stringify(LONG)});
    const banner = q('button[style*="aspect-ratio"]');
    return JSON.stringify({ vw: document.documentElement.clientWidth, mode: bar && bar.getAttribute('data-top-bar'),
      bar: box(bar), sel: box(sel), banner: box(banner), search: box(btn('Search')), dm: box(btn('Direct messages')), me: box(btn('Your anonymous identity')),
      name: nameEl ? { clipped: nameEl.scrollWidth > nameEl.clientWidth, h: Math.round(nameEl.getBoundingClientRect().height) } : null }); })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  assert.ok(!(r.result && r.result.exceptionDetails), 'probe threw: ' + JSON.stringify(r.result && r.result.exceptionDetails || {}).slice(0, 300));
  return JSON.parse(r.result.result.value);
}

test('the three icons are on the Community screen exactly once, in both layouts', () => {
  for (const [i, c] of CASES.entries()) {
    for (const t of ICONS) {
      assert.equal(find(PAGES[i].tree, n => n.type === 'button' && n.props.title === t).length, 1,
        `"${t}" button missing/duplicated at ${c.width}px banner=${c.banner}`);
    }
  }
});

for (const [i, c] of CASES.entries()) {
  const label = `${c.width}px, ${c.banner ? 'banner church' : 'compact-pill church'}`;
  test(`Community top bar, ${label}`, { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
    const m = await rects(i);
    assert.equal(m.vw, c.width);
    for (const k of ['search', 'dm', 'me']) {
      assert.ok(m[k], `${k} not found`);
      assert.ok(m[k].x >= 0 && m[k].right <= m.vw, `${k} is outside the ${m.vw}px viewport (${m[k].x}..${m[k].right})`);
    }
    assert.ok(m.search.w >= 40 && m.dm.w >= 40 && m.me.w >= 36, `an icon was squeezed: ${m.search.w}/${m.dm.w}/${m.me.w}`);
    assert.ok(m.search.right <= m.dm.x && m.dm.right <= m.me.x, 'icons overlap');
    if (!c.banner) {
      assert.equal(m.mode, 'one-row');
      assert.ok(m.sel, 'church selector not found in the bar');
      const rows = [m.sel, m.search, m.dm, m.me];
      const span = Math.max(...rows.map(r => r.bottom)) - Math.min(...rows.map(r => r.y));
      assert.ok(span <= 60, `selector and icons are not on one row (span ${span}px high)`);
      assert.ok(m.sel.right <= m.search.x, `the church selector (ends ${m.sel.right}) runs under the icons (start ${m.search.x})`);
      assert.ok(m.sel.x >= 0 && m.sel.w >= 100, `the church selector is squeezed to ${m.sel.w}px`);
      assert.ok(m.name && m.name.clipped, 'a long church name should be ellipsised, not drawn in full');
      assert.ok(m.name.h < 30, `the church name wrapped (height ${m.name.h}px)`);
    } else {
      assert.equal(m.mode, 'banner');
      assert.ok(m.banner && m.banner.w >= m.vw - 2, `banner is not full width (${m.banner && m.banner.w}px of ${m.vw}px)`);
      assert.ok(m.search.y >= m.banner.bottom - 1, 'icons should sit beneath the banner');
    }
  });
}
