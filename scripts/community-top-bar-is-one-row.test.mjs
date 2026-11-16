// THE COMMUNITY TAB'S TOP BAR: church name (ONE line, ellipsis), Messages with its unread dot, and ONE chevron.
// Run: node --test scripts/community-top-bar-is-one-row.test.mjs
//
// REWRITTEN ON PURPOSE, 2026-11-16 (a deliberate STRENGTHENING, not a loosening; owner decisions in
// PLAN-today-header-narrow-2026-11-14.html, audit AUDIT-PLAN-headers-today-community-2026-11-16). The bar used to
// hold three icons (Search 40, Messages 40, avatar 38) and this file asserted exactly those. By decision it now
// holds TWO controls: Messages (it carries the alert dot, so it plays the bell's part) and a 44px chevron; Search
// and Profile fold behind the chevron. What it asserts now that it did not before: exactly two visible controls,
// each >= 44px, hit-tested at its own centre; the name room as a MEASURED number against the old 156px reserve; the
// 150px banner cap at a 760px viewport; the menu's POSITION (banner mode: directly under the chevron, over the
// banner, on a solid surface); hit-tests and sizes for the menu items; and, in layer A, every handler, Escape, the
// outside-tap rule, the Search-keeps-the-query rule, and the accessible names. What it still asserts: banner full
// width, name at the top of the banner, controls floating over it in line with the name, name ends before the
// controls, one row with an ellipsised name, nothing outside the viewport at 320/360/390.
//
// TWO LAYERS (the audit's HIGH 2): serialize() drops every function prop, so a Chromium page built from it fires
// nothing. Layer A (miniReact, no browser) proves handlers/Escape/outside-tap with captured document listeners;
// layer B (Chromium) proves geometry and HIT-TESTING only (elementFromPoint at each centre).
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
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { WebSocket } from 'ws';
import { loadScreen, miniReact, find, reads } from './render-jsx-screen.mjs';
import { requireFreePort } from './test-ports.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const CHROME = [process.env.TRIN_CHROME, '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean).find(p => existsSync(p));
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
      if (k.startsWith('aria-') && typeof v === 'boolean') { attrs.push(`${k}="${v}"`); continue; }
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
// The width of the right-hand group that ChurchPill must leave free in banner mode: 14 edge + Messages 44 + 9 gap +
// chevron 44 + 10 air. The OLD three-icon bar needed 156 (ChurchPill's own default, which stays).
const RESERVE_NOW = 121, RESERVE_OLD = 156;

// THE LIVE COMMUNITY SCREEN in the miniature React (layer A) — and the tree layer B serialises. `docL` captures every
// document listener the header registers; `focused` records what the screen asked to focus.
function mountChat({ width, banner, hideName = false, dmUnread = true, name = LONG }) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const safeImgUrl = u => (typeof u === 'string' && u.startsWith('data:image/') ? u : '');
  const { IconBtn } = loadScreen('app/ui.jsx', ['IconBtn'], { React, window: {}, Icon });
  const { UserAvatar } = loadScreen('app/identity-avatar.jsx', ['UserAvatar'], { React, window: {}, safeImgUrl });
  const { ChurchBadge, ChurchPill } = loadScreen('app/screens-church.jsx', ['ChurchBadge', 'ChurchPill'],
    { React, window: {}, Icon, safeCssColor: (c, d) => d, safeImgUrl });
  const docL = [], focused = [];
  const win = {
    Fellowship: { myPubkey: 'mehex', relays: [], subscribeChurchGroups: (_n, cb) => { cb([]); return () => {}; },
      subscribeChurchCategories: (_n, cb) => { cb([]); return () => {}; }, subscribeGroups: () => () => {},
      displayFor: () => ({ handle: 'sam', color: '#888' }), assumeMinor: async () => false },
    TrinityData: { CHAT_IDENTITY: { handle: 'me', color: '#123456' }, GROUPS: [], RELAYS: [] },
    TrinityIdentity: { current: { handle: 'me', color: '#123456' } },
    addEventListener() {}, removeEventListener() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  const doc = {
    createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} },
    addEventListener(type, fn, cap) { docL.push({ type, fn, cap: !!cap }); }, removeEventListener() {},
    querySelector(sel) { return String(sel).startsWith('[data-') ? { focus() { focused.push(sel); } } : null; },
  };
  const { ChatScreen } = loadScreen('app/screens-chat.jsx', ['ChatScreen'], {
    React, window: win, document: doc,
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
  const calls = { openDMInbox: 0, openProfile: 0 };
  const ctx = {
    toast() {}, church: { npub: 'npub1c', name, id: 'c1', initials: 'SB', banner: banner ? GIF : undefined, features: hideName ? { hideChurchName: true } : undefined },
    joinState: { loaded: true, isPending: false, removed: false, offline: false, unknown: false },
    myLeaderGroups: [], churchEvents: [], myPubkey: 'mehex', safeguard: { isMinor: false, clearanceKnown: true },
    openPeople() {}, openDM() {}, openDMInbox() { calls.openDMInbox++; }, openGroup() {}, openProfile() { calls.openProfile++; }, openChurchSwitcher() {},
    dmUnread,
  };
  const M = { ctx, calls, docL, focused, tree: null, ChurchPill,
    redraw() { M.tree = draw(ChatScreen, { ctx }); return M.tree; },
    mark() { docL.length = 0; focused.length = 0; },
    last(type) { const l = docL.filter(x => x.type === type); return l[l.length - 1] || null; },
    chevron() { return find(M.tree, n => n.type === 'button' && n.props && n.props['data-hdr-more'] === 'chevron')[0] || null; },
    panel() { return find(M.tree, n => n.props && n.props['data-hdr-more'] === 'panel')[0] || null; },
    item(which) { return find(M.tree, n => n.type === 'button' && n.props && n.props['data-hdr-item'] === which)[0] || null; },
    dm() { return find(M.tree, n => n.type === 'button' && /^Direct messages/.test(String(n.props['aria-label'] || '')))[0] || null; },
    input() { return find(M.tree, n => n.type === 'input' && n.props && n.props['data-chat-search-input'])[0] || null; },
  };
  M.redraw(); M.redraw();   // two draws: the first runs the effects that set state, the second paints it
  return M;
}

// the selector test a real browser does for `target.closest(sel)`, run against the miniReact tree
function closestIn(tree, target) {
  const path = [];
  (function dfs(n, trail) {
    if (!n || typeof n !== 'object' || path.length) return;
    if (Array.isArray(n)) { n.forEach(c => dfs(c, trail)); return; }
    const t = trail.concat([n]);
    if (n === target) { path.push(...t); return; }
    (n.kids || []).forEach(c => dfs(c, t));
  })(tree, []);
  return sel => {
    const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
    if (!m) throw new Error('closestIn only understands [attr] and [attr="v"], got ' + sel);
    for (let i = path.length - 1; i >= 0; i--) {
      const p = path[i].props || {};
      if (m[1] in p && p[m[1]] != null && p[m[1]] !== false && (m[2] === undefined || String(p[m[1]]) === m[2])) return path[i];
    }
    return null;
  };
}
const press = (M, node) => ({ target: { closest: closestIn(M.tree, node) } });
const openMenu = M => { M.mark(); M.chevron().props.onClick(); M.redraw(); };

function communityPage(c) {
  const M = mountChat(c);
  if (c.open) { const ch = M.chevron(); if (ch && typeof ch.props.onClick === 'function') { ch.props.onClick(); M.redraw(); } }
  const html = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/vendor/fonts/fonts.css">
<style>${[...readFileSync(join(ROOT, 'index.html'), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')}
html,body{margin:0;padding:0} #app{position:relative;width:100%;box-sizing:border-box;padding:0 18px;overflow:hidden}</style>
<div id="app" class="trinity">${serialize(M.tree)}</div>`;
  return { html, tree: M.tree, M };
}

let chr = null, srv = null, ws = null, send = null, dir = null;
const CASES = [];
// CLOSED: both layouts at 320/360/390 and a 760-wide case (where the banner's 3:1 would be 253px tall and is capped at 150)
for (const width of [320, 360, 390, 760]) for (const banner of [false, true]) CASES.push({ width, banner });
// OPEN, serialised after the chevron's own onClick ran in layer A
for (const width of [320, 360, 390, 760]) for (const banner of [false, true]) CASES.push({ width, banner, open: true });
// a church that has hidden its name: the banner draws the badge and NO name (features.hideChurchName, banner only)
for (const width of [320, 360]) CASES.push({ width, banner: true, hideName: true });
CASES.push({ width: 320, banner: true, open: true, hideName: true });
const PAGES = CASES.map(c => communityPage(c));
if (process.env.DUMP_PAGES) PAGES.forEach((p, k) => writeFileSync(process.env.DUMP_PAGES + '/c' + k + '.html', p.html));
const caseLabel = c => `${c.width}px, ${c.banner ? 'banner church' : 'compact-pill church'}${c.open ? ', menu OPEN' : ''}${c.hideName ? ', name hidden' : ''}`;

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
    const hit = e => { if (!e) return false; const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!t && (t === e || e.contains(t)); };
    const bar = q('[data-top-bar]');
    const dm = q('[title^="Direct messages"]'), chev = q('[data-hdr-more="chevron"]');
    const sel = bar ? bar.querySelector('[data-church-pill]') : null;
    const nameEl = [...document.querySelectorAll('[data-church-pill] div, [data-church-pill] span')].find(e => e.children.length === 0 && e.textContent.trim() === ${JSON.stringify(LONG)});
    const banner = q('[data-church-pill][style*="aspect-ratio"]');
    const nameWrap = q('[data-banner-name]');
    const icons = [...document.querySelectorAll('[data-top-icons] button')];
    const panelEl = q('[data-hdr-more="panel"]');
    return JSON.stringify({ vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight, mode: bar && bar.getAttribute('data-top-bar'),
      bar: box(bar), sel: box(sel), banner: box(banner), dm: box(dm), chev: box(chev), nameBox: box(nameEl), nameWrap: box(nameWrap),
      nameWrapKids: nameWrap ? nameWrap.children.length : null,
      iconButtons: icons.filter(b => b.getBoundingClientRect().width > 0).map(b => b.getAttribute('aria-label') || b.getAttribute('title')),
      reach: { dm: hit(dm), chev: hit(chev) }, expanded: chev && chev.getAttribute('aria-expanded'),
      name: nameEl ? { clipped: nameEl.scrollWidth > nameEl.clientWidth, h: Math.round(nameEl.getBoundingClientRect().height) } : null,
      panel: panelEl ? { box: box(panelEl), bg: getComputedStyle(panelEl).backgroundColor,
        btns: [...panelEl.querySelectorAll(':scope > button')].map(b => ({ id: b.getAttribute('data-hdr-item'), aria: b.getAttribute('aria-label'), text: (b.lastElementChild ? b.lastElementChild.textContent : b.textContent).trim(), ...box(b), hit: hit(b) })) } : null }); })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  assert.ok(!(r.result && r.result.exceptionDetails), 'probe threw: ' + JSON.stringify(r.result && r.result.exceptionDetails || {}).slice(0, 300));
  return JSON.parse(r.result.result.value);
}
const MEASURED = new Map();
async function measure(i) { if (!MEASURED.has(i)) MEASURED.set(i, await rects(i)); return MEASURED.get(i); }

// ── LAYER B: layout ──────────────────────────────────────────────────────────────────────────────────────────
for (const [i, c] of CASES.entries()) {
  const label = caseLabel(c);
  test(`Community top bar: Messages + ONE chevron, name roomy and on one line — ${label}`, { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
    const m = await measure(i);
    assert.equal(m.vw, c.width);
    // EXACTLY TWO visible controls (Messages and the chevron), both on the screen, both big enough, not overlapping.
    assert.deepEqual(m.iconButtons, [c.dmUnreadLabel || 'Direct messages, unread', 'More'], 'the bar holds Messages and the chevron and nothing else');
    for (const k of ['dm', 'chev']) {
      assert.ok(m[k], `${k} not found`);
      assert.ok(m[k].x >= 0 && m[k].right <= m.vw, `${k} is outside the ${m.vw}px viewport (${m[k].x}..${m[k].right})`);
    }
    assert.ok(m.chev.w >= 44 && m.chev.h >= 44, `the chevron is ${m.chev.w}x${m.chev.h}, want >= 44`);
    assert.ok(m.dm.w >= 44 && m.dm.h >= 44, `Messages is ${m.dm.w}x${m.dm.h}, want >= 44`);
    assert.ok(m.dm.right <= m.chev.x, 'Messages and the chevron overlap');
    assert.deepEqual(m.reach, { dm: true, chev: true }, 'each control must be the element hit at its own centre (not covered by the banner)');
    assert.equal(m.expanded, c.open ? 'true' : 'false');
    if (!c.banner) {
      assert.equal(m.mode, 'one-row');
      assert.ok(m.sel, 'church selector not found in the bar');
      const rows = [m.sel, m.dm, m.chev];
      const span = Math.max(...rows.map(r => r.bottom)) - Math.min(...rows.map(r => r.y));
      assert.ok(span <= 60, `selector and controls are not on one row (span ${span}px high)`);
      assert.ok(m.sel.right <= m.dm.x, `the church selector (ends ${m.sel.right}) runs under Messages (starts ${m.dm.x})`);
      // the pill GAINED room: three icons (40+40+38 + 2 gaps = 136) became Messages + chevron (44+9+44 = 97)
      assert.ok(m.sel.x >= 0 && m.sel.w >= 160, `the church selector is ${m.sel.w}px wide, want >= 160 (it was ~139 at 320 before)`);
      assert.ok(m.name && m.name.clipped, 'a long church name should be ellipsised, not drawn in full');
      assert.ok(m.name.h < 30, `the church name wrapped onto two lines (height ${m.name.h}px): it is ONE line with an ellipsis`);
    } else {
      assert.equal(m.mode, 'banner');
      assert.ok(m.banner && m.banner.w >= m.vw - 2, `banner is not full width (${m.banner && m.banner.w}px of ${m.vw}px)`);
      // THE 150px CAP: 3:1 is vw/3 until that passes 150 (at 450px), then it stays at 150.
      const want = Math.min(150, Math.round(m.vw / 3));
      assert.ok(Math.abs(m.banner.h - want) <= 1, `the banner is ${m.banner.h}px tall at ${m.vw}px, want ${want} (3:1, capped at 150)`);
      // name at the TOP of the banner, controls floating over it in line with the name, still tappable
      for (const k of ['dm', 'chev']) {
        assert.ok(m[k].y >= m.banner.y && m[k].bottom <= m.banner.bottom, `${k} should float OVER the banner (${m[k].y}..${m[k].bottom} vs ${m.banner.y}..${m.banner.bottom})`);
      }
      assert.ok(m.nameWrap, 'the banner name row is missing');
      // THE NAME ROOM, a measured number: the name row ends RESERVE px from the right. It must be wider than the old 156
      // reserve allowed by (156 - 121) = 35px; one pixel of tolerance for sub-pixel rounding.
      const oldRoom = m.vw - 14 - RESERVE_OLD;
      assert.ok(m.nameWrap.w >= oldRoom + (RESERVE_OLD - RESERVE_NOW) - 1,
        `the name row is ${m.nameWrap.w}px wide, want >= ${oldRoom + (RESERVE_OLD - RESERVE_NOW) - 1} (old room ${oldRoom} + 35)`);
      assert.ok(m.nameWrap.right <= m.dm.x, `the name row (ends ${m.nameWrap.right}) runs under Messages (starts ${m.dm.x})`);
      if (c.hideName) {
        assert.equal(m.nameBox, null, 'a church that hid its name must draw no name over the banner');
        assert.equal(m.nameWrapKids, 1, 'the badge alone is drawn');
      } else {
        assert.ok(m.nameBox, 'church name not found');
        assert.ok(m.nameBox.y < m.banner.y + m.banner.h / 2, `the church name should sit in the top half of the banner (name y ${m.nameBox.y}, banner ${m.banner.y}..${m.banner.bottom})`);
        const nameMid = m.nameBox.y + m.nameBox.h / 2, iconMid = m.dm.y + m.dm.h / 2;
        assert.ok(Math.abs(nameMid - iconMid) <= 20, `controls should be in line with the name (name mid ${nameMid}, control mid ${iconMid})`);
        assert.ok(m.nameBox.right <= m.dm.x, `the church name (ends ${m.nameBox.right}) runs under Messages (starts ${m.dm.x})`);
        assert.ok(m.name.h < 30, `the church name wrapped onto two lines (height ${m.name.h}px): it is ONE line with an ellipsis`);
        assert.ok(m.name.clipped || m.nameBox.w < 300, 'a long name is cut with an ellipsis, not drawn in full');
      }
    }
  });

  if (c.open) {
    test(`Community menu OPEN: Search + Profile, where the thumb is, 44px+, hit at each centre — ${label}`, { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
      const m = await measure(i);
      assert.ok(m.panel, 'the chevron was opened but no panel is in the tree');
      assert.deepEqual(m.panel.btns.map(b => b.id), ['search', 'profile']);
      assert.deepEqual(m.panel.btns.map(b => b.text), ['Search', 'Profile']);
      assert.equal(m.panel.btns[1].aria, 'Profile', 'the Profile item has an accessible name');
      for (const b of m.panel.btns) {
        assert.ok(b.h >= 44 && b.w >= 44, `menu item "${b.text}" is ${b.w}x${b.h}, want >= 44`);
        assert.ok(b.x >= 0 && b.right <= m.vw && b.y >= 0 && b.bottom <= m.vh, `menu item "${b.text}" is outside the ${m.vw}x${m.vh} viewport (${b.x}..${b.right}, ${b.y}..${b.bottom})`);
        assert.ok(b.hit, `HIT TEST: the element at the centre of "${b.text}" is not that item — something covers it`);
      }
      assert.ok(m.panel.btns[0].right <= m.panel.btns[1].x, 'the two menu items overlap');
      if (c.banner) {
        // BANNER MODE: DIRECTLY under the chevron, over the banner, on a SOLID surface — not 150px away under the image.
        const gap = m.panel.box.y - m.chev.bottom;
        assert.ok(gap >= 0 && gap <= 12, `the menu starts ${gap}px below the chevron, want 0..12 (directly under it)`);
        assert.ok(m.panel.box.x <= m.chev.x + 1 && m.panel.box.right >= m.chev.right - 1, `the menu (${m.panel.box.x}..${m.panel.box.right}) does not sit under the chevron (${m.chev.x}..${m.chev.right})`);
        assert.ok(!/rgba\(0, 0, 0, 0\)|transparent/.test(m.panel.bg), `the menu over the banner has no solid surface (background ${m.panel.bg})`);
        assert.ok(m.panel.box.y < m.banner.bottom, 'the menu overlays the banner, it does not start below it');
      } else {
        assert.ok(m.panel.box.y >= m.bar.bottom, 'in the compact bar the menu sits under the row');
        assert.ok(m.panel.box.w >= m.vw - 36 - 1, `the menu is ${m.panel.box.w}px wide, want the full ${m.vw - 36}`);
      }
    });
  }
}

// ── LAYER A: behaviour ───────────────────────────────────────────────────────────────────────────────────────
test('A. Search and Profile are ABSENT while the menu is closed and present once it is open', () => {
  for (const banner of [false, true]) {
    const M = mountChat({ width: 360, banner });
    for (const gone of ['search', 'profile']) assert.equal(M.item(gone), null, `"${gone}" is drawn in the closed bar (banner=${banner})`);
    assert.equal(find(M.tree, n => n.type === 'button' && n.props.title === 'Search').length, 0, 'no Search icon in the bar');
    assert.equal(find(M.tree, n => n.type === 'button' && n.props.title === 'Your anonymous identity').length, 0, 'no avatar button in the bar');
    assert.ok(M.dm() && M.chevron(), 'Messages and the chevron are what remain');
    openMenu(M);
    assert.ok(M.item('search') && M.item('profile'), `the menu is missing an item (banner=${banner})`);
    assert.equal(find(M.panel(), n => n.type === 'button').length, 2);
  }
});

test('A. the chevron toggles, is named "More", and aria-expanded follows it', () => {
  const M = mountChat({ width: 360, banner: false });
  assert.equal(M.chevron().props['aria-label'], 'More');
  assert.equal(M.chevron().props['aria-expanded'], false);
  assert.equal(M.chevron().props['aria-controls'], undefined);
  openMenu(M);
  assert.equal(M.chevron().props['aria-expanded'], true);
  assert.equal(M.chevron().props['aria-controls'], M.panel().props.id);
  M.chevron().props.onClick(); M.redraw();
  assert.equal(M.panel(), null);
  assert.equal(M.chevron().props['aria-expanded'], false);
});

test('A. Messages still opens the inbox, keeps its dot while the menu is closed, and says "unread" in its NAME', () => {
  const M = mountChat({ width: 360, banner: false, dmUnread: true });
  assert.equal(M.dm().props['aria-label'], 'Direct messages, unread');
  assert.equal(M.dm().props.title, 'Direct messages, unread');
  const dot = () => find(M.tree, n => n.type === 'span' && n.props.style && n.props.style.background === 'var(--clay)' && n.props.style.width === 10);
  assert.equal(dot().length, 1, 'the unread dot is drawn while the menu is closed');
  M.dm().props.onClick();
  assert.equal(M.calls.openDMInbox, 1);
  openMenu(M);
  assert.ok(M.dm(), 'Messages stays in the bar while the menu is open');
  const read = mountChat({ width: 360, banner: false, dmUnread: false });
  assert.equal(read.dm().props['aria-label'], 'Direct messages', 'no unread = the plain name');
  assert.equal(find(read.tree, n => n.type === 'span' && n.props.style && n.props.style.background === 'var(--clay)' && n.props.style.width === 10).length, 0, 'no dot without unread');
});

test('A. the Search item OPENS the bar (it was a toggle), focuses the input and closes the menu', () => {
  const M = mountChat({ width: 360, banner: false });
  assert.equal(M.input(), null, 'the search bar starts shut');
  openMenu(M);
  M.item('search').props.onClick(); M.redraw();
  assert.ok(M.input(), 'picking Search opens the search bar');
  assert.ok(M.focused.includes('[data-chat-search-input]'), 'the input is focused explicitly');
  assert.equal(M.panel(), null, 'picking Search closes the menu');
});

test('A. pressing Search while the bar is ALREADY open keeps the query and refocuses the input (it used to clear it)', () => {
  const M = mountChat({ width: 360, banner: true });
  openMenu(M); M.item('search').props.onClick(); M.redraw();
  M.input().props.onChange({ target: { value: 'harvest' } }); M.redraw();
  assert.equal(M.input().props.value, 'harvest', 'anchor: the query was typed');
  M.focused.length = 0;
  openMenu(M); M.item('search').props.onClick(); M.redraw();
  assert.ok(M.input(), 'the bar must stay open');
  assert.equal(M.input().props.value, 'harvest', 'the query must survive pressing Search again');
  assert.ok(M.focused.includes('[data-chat-search-input]'), 'autoFocus fires on mount only: the input must be focused explicitly');
});

test('A. the Profile item calls openProfile EXACTLY ONCE, closes the menu, shows the word "Profile" and has an accessible name', () => {
  const M = mountChat({ width: 360, banner: false });
  openMenu(M);
  assert.equal(M.item('profile').props['aria-label'], 'Profile');
  assert.ok(reads(M.item('profile')).includes('Profile'), 'visible text, not just an avatar');
  assert.equal(M.item('profile').props.title, 'Your anonymous identity');
  M.item('profile').props.onClick(); M.redraw();
  assert.equal(M.calls.openProfile, 1);
  assert.equal(M.panel(), null);
  assert.equal(M.calls.openDMInbox, 0);
});

test('A. Escape closes the menu and returns focus to the chevron; other keys do not', () => {
  const M = mountChat({ width: 360, banner: false });
  openMenu(M);
  assert.ok(M.last('pointerdown') && M.last('pointerdown').cap, 'a CAPTURE pointerdown listener is registered');
  const kd = M.last('keydown').fn;
  kd({ key: 'x' }); M.redraw();
  assert.ok(M.panel());
  M.focused.length = 0;
  kd({ key: 'Escape' }); M.redraw();
  assert.equal(M.panel(), null);
  assert.ok(M.focused.includes('[data-hdr-more="chevron"]'));
});

test('A. a press outside closes the menu; a press ON the chevron or the panel does not (and chevron press + click leaves it closed)', () => {
  const M = mountChat({ width: 360, banner: true });
  openMenu(M);
  const off = M.last('pointerdown').fn;
  off(press(M, M.chevron())); M.redraw();
  assert.ok(M.panel(), 'a press ON the chevron is not outside');
  off(press(M, M.item('search'))); M.redraw();
  assert.ok(M.panel(), 'a press on an item is not outside');
  off(press(M, M.panel())); M.redraw();
  assert.ok(M.panel(), 'a press on the panel is not outside');
  off(press(M, M.chevron())); M.chevron().props.onClick(); M.redraw();
  assert.equal(M.panel(), null, 'press + click on the chevron must end CLOSED');
  openMenu(M);
  off(press(M, M.dm())); M.redraw();
  assert.equal(M.panel(), null, 'a press anywhere else (here: Messages) closes it');
  assert.equal(M.calls.openProfile, 0);
});

test('A. ChatScreen gives the banner pill the right reserve (121) and the default stays 156', () => {
  const M = mountChat({ width: 360, banner: true });
  const pill = find(M.tree, n => typeof n.type === 'function' && n.type.name === 'ChurchPill')[0];
  assert.ok(pill, 'anchor: the ChurchPill is in the tree');
  assert.equal(pill.props.reserveRight, RESERVE_NOW);
  // and the component's own default is untouched: a caller that passes nothing reserves the old 156
  const bare = M.ChurchPill({ ctx: M.ctx });
  const wrap = find(bare, n => n.props && n.props['data-banner-name'])[0];
  assert.equal(wrap.props.style.right, RESERVE_OLD, 'ChurchPill\'s default reserveRight is still 156');
});
