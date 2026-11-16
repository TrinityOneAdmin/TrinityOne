// THE TODAY HEADER IS ON THE SCREEN, NOT PAST THE EDGE OF IT.
// Run: node --test scripts/todays-header-fits-the-phone.test.mjs
//
// WHAT THIS FILE IS FOR, in one line: the Today header row is `display:flex` with NO `flex-wrap` and nothing
// in it that may shrink, so anything added to it either fits every width this app ships on or is drawn off the
// right-hand edge of the phone. Three times now something has been added to that row and the third item off
// the edge was the one that got reported. This file lays the real header out in a real browser at 320 / 360 /
// 390 / 800 px and measures where every piece of it lands.
//
// ── ROUND 1, 2026-09-01: THE READING-STREAK PILL ──────────────────────────────────────────────────────────
// Found on an Oppo handset at a 360px CSS viewport: the flame was visible and the digit beside it was cut in
// half. Measured here:
//
//     row box               x=18  w=324  right=342     (the row itself obeys its container)
//     greeting column       x=18  w=191                (min-content — it would not shrink)
//     control group         x=209 w=200  right=408     (min-content — it would not shrink either)
//     streak pill           x=353 w=56   right=408     -> 48px past a 360px viewport
//
// 191 + 200 = 391 in a 324px row. WHY the greeting column stuck at 191 was the whole of that bug, and it was
// not the pill: the column's min-content was EXACTLY the church-name button's min-content, also 191. A
// `white-space: nowrap` run contributes its FULL text width to min-content, so the `text-overflow: ellipsis`
// already on that name never got the chance to act. The pill was the VICTIM — it was simply last in source
// order. `overflow-x: hidden` on the scroll container then CLIPPED the overflow rather than scrolling to it,
// which is why `document.documentElement.scrollWidth` reads a truthful-looking 360 on the phone. That is the
// single most useful thing in this comment: on this screen the overflow is invisible to scrollWidth, so it
// has to be caught by reading rectangles, which is what this file does.
//
// ── ROUND 2, 2026-09-01 ───────────────────────────────────────────────────────────────────────────────────
// The first fix let the column shrink without a floor and used `overflow-wrap: anywhere` to stop the date
// spilling out of it. `anywhere` inherits, so at 320px the column was squeezed to 56px and the header read
// "Wedne / sday 30 / Septem / ber" over a 169px-tall row — and this file stayed 10/10 GREEN over all of it,
// because every assertion it had was an x-coordinate. The lesson, which still governs every assertion below:
// a geometry bound that is slack enough to pass a broken screen is not a test. Hence this round also measured
// mid-word breaks (a Range over one word reports one client rect per line it is drawn on) and the row height.
//
// ── ROUND 3, 2026-10-09: THE HEADER THIS FILE NOW MEASURES ────────────────────────────────────────────────
// Two things happened to that row and this file measured neither, because it was anchored on nodes that no
// longer exist. Both are repaired here, and they are separate faults — do not conflate them:
//
//  1. `ec443e4` DELIBERATELY removed the church pill (`title="Your church"`) from the header, and `a71c6aa`
//     put the TrinityOne logo and wordmark on the left in its place with `justify-content: space-between`.
//     Everything this file knew about the left-hand side was anchored on that deleted button, so `churchTid`
//     and `colTid` were -1 and the probe died on `Cannot read properties of null (reading 'x')` — a NULL
//     LOCATOR, not an overflow. The 800px cases failed that way too, and 800px genuinely fits. Re-anchored
//     below on the logo and the wordmark, which is what is actually there, and found by the props the screen
//     put on them (`aria-label="TrinityOne"`) rather than by text — see "HOW IT ASSERTS".
//
//  2. The streak pill really did overflow, for the reason round 1 describes, and the owner's answer on
//     2026-10-09 was to REMOVE IT: they never asked for it. Measured before removal: it ended at x=379 in a
//     360px viewport and x=398 with a 365-day streak, and the live header carried FOUR controls (search,
//     bell, dark-mode moon, streak) where the base case here has three. Confirmed on the owner's Oppo
//     (CPH2477, 720x1612 at density 320 = exactly 360 CSS px): the flame showed, the number was cut off.
//     The logo and the wordmark STAY — the owner asked for those — so this file asserts they are present and
//     drawn in full at every width, which is the point of the whole exercise.
//
// WHAT REPLACED THE STREAK DIMENSION. This file used to sweep each width twice, at a 7-day and a 365-day
// streak, because the pill was 56px at "7" and 74px at "365" and a padding tweak would have survived one and
// not the other. With no pill the streak count changes nothing on the screen, so sweeping it would be eight
// byte-identical pages. The second dimension is now the one variable the header genuinely still has: the
// LISTEN button, which renders only for a church with an audio feed (`ctx.church.audioFeed`). That is a real
// fourth control, it is the state the removed pill used to collide with, and it is the case a future addition
// to this row will break first.
//
// HOW IT ASSERTS, and why not more cheaply. CLAUDE.md rule 3: app/screens-today.jsx ships UNBUNDLED, so
// `false && ` in front of a condition leaves every word of it in place and a text-matching assertion still
// passes. Nothing here matches text in app/*.jsx. The REAL TodayScreen is compiled with the same esbuild the
// build uses and rendered through the miniature React in scripts/render-jsx-screen.mjs; the tree that comes
// back is serialised to HTML, dressed in index.html's OWN <style> block and the app's OWN Sora files, and
// laid out by a real browser at a real device width. Every assertion reads getBoundingClientRect(), or a
// Range's client rects — a word broken across two lines reports two of them, an unbroken one reports one.
//
// Sora matters: the removed pill measured 56px wide here and 56px on the handset. A fallback face would be
// measuring a different screen from the one that ships, so the fonts are served and the probe waits on
// document.fonts.
//
// MEASURED RED/GREEN, 2026-10-09, this file against app/screens-today.jsx with the pill removed:
//   · fixed screen                                       15 pass / 0 fail / 2 todo (see the Listen note below)
//   · header row widened (brand `margin-right` 16 -> 220) 11 pass / 4 fail / 2 todo   <- scoped sabotage
// The sabotage widened the brand block's OWN margin (one anchor, verified to occur exactly once inside
// TodayScreen before it was replaced) — the cheapest way to make the row's content wider than the row without
// touching a single node this file is anchored on. The control group went to x=520 (3 controls) and x=568
// (4 controls), i.e. 130-248px past the viewport, and the four narrow "fits" cases went RED. 800px stayed
// green and that is correct, not slack: a 768px row genuinely swallows a 220px margin. That is the acceptance
// check for the re-anchoring in ROUND 3 — if widening the row's content does NOT turn this file red, the
// re-pointed assertions are not measuring the header any more.
//
// Skips itself (rather than failing) when chromium is unavailable, so CI without a browser stays green —
// same contract as scripts/app-boots.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { WebSocket } from 'ws';
import { loadScreen, miniReact, find, reads } from './render-jsx-screen.mjs';
import { requireFreePort } from './test-ports.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
// TRIN_CHROME lets a box without a launchable snap chromium point at another binary (e.g. a headless shell).
const CHROME = [process.env.TRIN_CHROME, '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean).find(p => existsSync(p));
const CDP = 9354;   // 9350-9352 belong to app-boots / restore-routes / restore-storm
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── the tree -> HTML, so a browser can lay out what the screen actually built ──────────────────────────────
// Every element carries data-tid = its index in `nodes`, so a test can point at ONE node it found in the tree
// (the logo, the wordmark, the control group) instead of hunting for it by text in the DOM.
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
      if (k.startsWith('aria-') && typeof v === 'boolean') { attrs.push(`${k}="${v}"`); continue; }
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

// ── the real screen ──────────────────────────────────────────────────────────────────────────────
// Everything TodayScreen takes from OUTSIDE its own file. A name it needs that is not here is a
// ReferenceError at the point of use — deliberately, because a silently-stubbed global is how a test ends up
// asserting about something that is not the code. Icon and ChurchBadge are the REAL ones (they set the
// widths this test is about); the stubs are furniture that renders below the header.
const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

// THE LIVE SCREEN, with its state and its effects, in the miniature React (LAYER A, behaviour).
// What it adds over the old one-shot render, and why:
//   · `docL` / `winL` CAPTURE every document / window listener the screen registers, instead of the old no-op
//     stub, so a test can call the pointerdown / keydown / resize handler the screen really installed.
//     miniReact never runs an effect's cleanup, so a listener from a closed session stays in the list; a test
//     calls `mark()` before it opens and reads only what was registered after.
//   · `querySelector` hands back a recorder for the header's own focus targets, because there is no layout in
//     this layer — LAYER B (Chromium) is where widths and hit-testing are real.
//   · `calls` counts the two shared handlers the header drives (openListen has ONE reader, this header; toggleDark
//     has two: this header and the reading screen).
function mountToday({ audioFeed, churchName = 'St Bartholomew-the-Great', date = new Date('2026-09-30T09:00:00Z'), width = 390, dark = false }) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const { ChurchBadge } = loadScreen('app/screens-church.jsx', ['ChurchBadge'],
    { React, window: {}, safeCssColor: (c, d) => d, safeImgUrl: () => '' });
  const docL = [], winL = [], focused = [], focusCalls = [], scroll = { y: 0 };
  const win = {
    addEventListener(type, fn, cap) { winL.push({ type, fn, cap: !!cap }); }, removeEventListener() {}, innerWidth: width,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Fellowship: { subscribeCareRequests: () => () => {}, cancelCareRequest() {}, childCareAudience: async () => [] },
    ChurchBadge,
    TrinityData: { NOTIFICATIONS: [], PLANS: [{ id: 'p1', name: 'Plan', days: [{ d: 1, ref: 'John 1' }] }],
      VOTD_POOL: [{ ref: 'John 3:16', text: 'For God so loved the world.' }] },
    Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1,
      activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }) },
  };
  const doc = {
    addEventListener(type, fn, cap) { docL.push({ type, fn, cap: !!cap }); }, removeEventListener() {},
    querySelector(sel) {
      // MODEL OF THE BROWSER: a focus() without preventScroll scrolls the focused element into view; the chevron is at
      // the top of the page, so the page jumps to scrollY 0. (The premise is proved against real chromium further down.)
      if (String(sel).startsWith('[data-hdr')) return { focus(opts) { focused.push(sel); focusCalls.push({ sel, opts }); if (!(opts && opts.preventScroll)) scroll.y = 0; } };
      return null;
    },
  };
  const globals = {
    React, window: win, localStorage: win.localStorage,
    document: doc,
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    Icon, ChurchBadge,
    // ⚠ THE STREAK IS STILL COMPUTED BY THE SCREEN, it is just not drawn any more (2026-10-09). The effect
    // that rolls the count forward still reads this key, so the stub has to stay or TodayScreen throws on a
    // null; it is a fixed count now because nothing on the screen is a function of it. If this stub ever
    // becomes unnecessary, the count has stopped accruing and app/help-data.jsx is making a false promise.
    lsGet: (k, d) => (k === 'trinityone.streak' ? { count: 7, last: date.toISOString().slice(0, 10) } : d),
    lsSet: () => {},
    cx: (...a) => a.filter(Boolean).join(' '),
    SectionLabel: Stub('SectionLabel'), Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'),
    useTrinityAudio: () => ({ track: null, playing: false }),
    todayISO: () => date.toISOString().slice(0, 10),
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [date])); } static now() { return date.getTime(); } },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  };
  // THE APP'S REAL BACK STACK: ui.jsx's own useBackLayer + window.trinityGoBack, on a window the test can reach. The
  // header menu registers on it so Android's hardware Back closes the menu (see app/header-more.jsx).
  const uiWin = {}, uiDocL = [];
  const { useBackLayer } = loadScreen('app/ui.jsx', ['useBackLayer'], { React, window: uiWin, Icon, document: { addEventListener(type, fn) { uiDocL.push({ type, fn }); }, removeEventListener() {} } });
  globals.useBackLayer = useBackLayer;
  const { TodayScreen } = loadScreen('app/screens-today.jsx', ['TodayScreen'], globals);
  const calls = { openListen: 0, toggleDark: 0, openSearch: 0 };
  const ctx = {
    // `audioFeed` is what puts the LISTEN button in the header — the fourth control, and the state any future
    // addition to this row collides with first.
    church: { name: churchName, initials: 'SB', npub: 'np1', audioFeed: audioFeed ? 'https://example.invalid/feed.xml' : null },
    openChurchSwitcher() {}, openSearch() { calls.openSearch++; }, openNotifications() {}, dark,
    toggleDark() { calls.toggleDark++; }, openListen() { calls.openListen++; },
    toast() {}, netUnread: 0, openServing() {},
    planProgress: {}, plans: [], bookmarks: [], notes: {}, highlights: {},
  };
  const M = { ctx, calls, docL, winL, focused, focusCalls, scroll, tree: null,
    redraw() { M.tree = draw(TodayScreen, { ctx }); return M.tree; },
    back: () => uiWin.trinityGoBack(), backLayers: () => uiWin.__trinityBackStack.length,
    // a key press as ui.jsx's ONE global keydown handler sees it (it sends Escape to trinityGoBack); anything else is ignored
    key(k) { const l = uiDocL.find(x => x.type === 'keydown'); assert.ok(l, 'ui.jsx registered no global keydown handler'); l.fn({ key: k, preventDefault() {} }); },
    mark() { docL.length = 0; winL.length = 0; focused.length = 0; focusCalls.length = 0; },
    last(list, type) { const l = list.filter(x => x.type === type); return l[l.length - 1] || null; },
    chevron() { return find(M.tree, n => n.type === 'button' && n.props && n.props['data-hdr-more'] === 'chevron')[0] || null; },
    panel() { return find(M.tree, n => n.props && n.props['data-hdr-more'] === 'panel')[0] || null; },
    item(which) { return find(M.tree, n => n.type === 'button' && n.props && n.props['data-hdr-item'] === which)[0] || null; },
  };
  M.redraw();
  return M;
}

// The selector test a real browser does for `target.closest(sel)`, run against the miniReact tree: walk from
// the target up through its ancestors and match `[attr]` / `[attr="v"]` against the props the screen set.
// Only that selector shape is supported, and anything else throws, so the helper cannot quietly say "no match".
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
const press = (M, node) => { const e = { target: { closest: closestIn(M.tree, node) }, swallowed: [], preventDefault() { e.swallowed.push('preventDefault'); }, stopPropagation() { e.swallowed.push('stopPropagation'); } }; return e; };   // a pointerdown event on `node`

// THE CSS A PAGE IS DRESSED IN: index.html's own <style> blocks, untouched. The 2026-11-14 build added 23 lines of
// fold CSS there (.trn-hdr-*, a container query and a media fallback); the 2026-11-16 design deletes all of it
// (nothing is hidden by CSS any more — the menu is rendered only while open), and a test below pins that.
function pageCss() {
  return [...readFileSync(join(ROOT, 'index.html'), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
}

// LAYER B's page: the screen (optionally OPENED through its own chevron, in layer A's live harness), serialised
// and dressed in index.html's own CSS.
function todayPage({ width, audioFeed, churchName, open = false, zoom = 0, dark = false }) {
  const M = mountToday({ audioFeed, churchName, width, dark });
  // A missing chevron / onClick must NOT throw at module load (that turns the whole file red with no name): the
  // page is serialised still closed and the named tests below say what is missing.
  if (open) { const ch = M.chevron(); if (ch && typeof ch.props.onClick === 'function') { ch.props.onClick(); M.redraw(); } }
  const tree = M.tree;
  const { html, nodes } = serialize(tree);
  // ── ANCHORED ON WHAT IS ACTUALLY IN THE HEADER, found by the props the screen put on it, never by text.
  // The LOGO carries `aria-label="TrinityOne"` and is the only node in the file that does; from it the row
  // and the control group are reached structurally, as parent and sibling. Every tid below is checked for
  // >= 0 by the first test, so a future edit that moves these nodes fails LOUDLY instead of handing the
  // probe a null — which is exactly how this file broke in September (see ROUND 3 note 1 above).
  const parentOf = tid => (tid < 0 ? -1 : nodes.findIndex(n => (n.kids || []).some(k => k && k.props && nodes[tid] === k)));
  const logoTid = nodes.findIndex(n => n.type === 'svg' && String((n.props || {})['aria-label'] || '') === 'TrinityOne');
  const brandTid = parentOf(logoTid);                 // the logo + wordmark block, the row's left-hand child
  const rowTid = parentOf(brandTid);                  // the header row itself
  const wrapTid = parentOf(rowTid);                   // the plain block around the row and the open panel
  const kidsOf = tid => (tid < 0 ? [] : (nodes[tid].kids || []).filter(k => k && k.props));
  // the wordmark: the brand block's element child that is not the logo
  const wordTid = nodes.findIndex((n, i) => i !== logoTid && kidsOf(brandTid).includes(n));
  // the control group: the row's element child that is not the brand block
  const controlsTid = nodes.findIndex((n, i) => i !== brandTid && kidsOf(rowTid).includes(n));
  // ⚠ THE READING-STREAK PILL IS GONE FROM THE SCREEN ON PURPOSE (owner, 2026-10-09) and is NOT anchored on
  // here. It is asserted ABSENT instead, by the only test in this file that can see it: the header row's
  // text. See "the Today header carries no text but the wordmark" below — the pill's digit was row text, so
  // that one assertion catches the pill coming back AND the date/greeting coming back.
  // TEXT ZOOM (Android "Font size"): the wordmark is px text and the WebView text zoom scales it; chromium here
  // has no such setting, so it is emulated as a scaled font-size on the wordmark only (the one text in the row).
  const zoomCss = zoom ? `[data-tid="${wordTid}"]{font-size:${(16 * zoom).toFixed(1)}px !important}` : '';
  return { logoTid, brandTid, wordTid, rowTid, wrapTid, controlsTid, nodes, M, html:
`<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/vendor/fonts/fonts.css">
<style>${pageCss()}
html,body{margin:0;padding:0} #app{position:relative;width:100%;height:100vh;overflow:hidden}${zoomCss}</style>
<div id="app">${html}</div>` };
}

// ── lay it out in a real browser and read the rectangles ───────────────────────────────────────────────────
let chr = null, srv = null, ws = null, send = null, dir = null;

before(async () => {
  if (!CHROME) return;
  await requireFreePort(CDP, 'todays-header-fits-the-phone.test.mjs (Chrome debug port)');
  dir = mkdtempSync(join(tmpdir(), 'trin-header-'));
  // The app's own font files are served alongside the page: Sora is what sets these widths.
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
    // never let a test reach production, exactly as app-boots.test.mjs does
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

after(() => { try { ws && ws.close(); } catch {} try { chr && chr.kill('SIGKILL'); } catch {} try { srv && srv.close(); } catch {}
  try { dir && rmSync(dir, { recursive: true, force: true }); } catch {} });

// The cases. 320 is the narrowest phone this app supports, 360 is the owner's Oppo (CPH2477, where the streak
// pill's digit was cut in half), 390 is the common modern handset and 800 is a tablet — which fitted even
// when the phones did not, and is kept rather than tuned away because a fix that "works" by wrapping the
// 390px phone that was never broken is not a fix. The second dimension is the LISTEN button; see the header
// note on what it replaced.
const CHURCH = 'St Bartholomew-the-Great';   // the church NAME no longer appears in the header (ec443e4) but
                                             // TodayScreen still needs a church, and the cards below use it
const CASES = [];
// CLOSED header: every church, every width. The row is the wordmark, the bell and the chevron at ALL of them.
for (const width of [320, 360, 390, 800]) for (const audioFeed of [false, true]) CASES.push({ width, audioFeed, churchName: CHURCH });
// OPEN panel, serialised AFTER the chevron's own onClick ran in the live harness (layer A). With a feed it holds
// Search, Listen, Dark; without one, Search and Dark. Dark-mode church once, for the "Light" label.
for (const width of [320, 360, 390]) CASES.push({ width, audioFeed: true, churchName: CHURCH, open: true });
for (const width of [320, 360]) CASES.push({ width, audioFeed: false, churchName: CHURCH, open: true });
CASES.push({ width: 320, audioFeed: true, churchName: CHURCH, open: true, dark: true });
// TEXT ZOOM 130% (Android "Font size"), ONE case kept as a regression guard: with only the bell and the chevron
// left the row has room (it overflowed by 29px at 320px when it still carried four controls — 32b5b317).
CASES.push({ width: 320, audioFeed: true, churchName: CHURCH, zoom: 1.3 });
const PAGES = CASES.map(c => todayPage(c));
const caseLabel = c => `${c.width}px viewport (listen button: ${c.audioFeed ? 'yes' : 'no'}${c.open ? ', menu OPEN' : ''}${c.dark ? ', dark mode' : ''}${c.zoom ? ', text zoom ' + Math.round(c.zoom * 100) + '%' : ''})`;
const GENERIC = [...CASES.entries()];   // every case, the zoom one included: nothing here is allowed to overflow now

const MEASURED = new Map();
const overlaps = (a, b) => !!(a && b && a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom);
const span = r => `x=${r.x}..${r.right}, y=${r.y}..${r.bottom}`;

async function rects(i) {
  const P = PAGES[i];
  await send('Emulation.setDeviceMetricsOverride', { width: CASES[i].width, height: 800, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: `http://127.0.0.1:${srv.address().port}/page${i}.html` });
  await sleep(450);
  const expr = `(async () => { try { await document.fonts.ready; } catch (e) {}
    const el = t => document.querySelector('[data-tid="' + t + '"]');
    const box = e => { if (!e) return null; const b = e.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
               right: Math.round(b.right), bottom: Math.round(b.bottom) }; };
    const ROW = el(${P.rowTid}), BRAND = el(${P.brandTid}), LOGO = el(${P.logoTid}),
          WORD = el(${P.wordTid}), CONTROLS = el(${P.controlsTid}), WRAP = el(${P.wrapTid});
    // EVERY WORD DRAWN IN THE HEADER ROW, and how many lines each one is drawn on. A range over one word
    // reports one client rect per line, so a count above 1 IS a mid-word break; no source text is involved.
    // This walks the row's own text nodes, so it sees the wordmark ("Trinity" + "One" are two text nodes in
    // one div) and it would also see a date, a greeting or a streak digit if any of them came back.
    const rowWords = [];
    if (ROW) { const w = document.createTreeWalker(ROW, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const txt = n.textContent, r = document.createRange(); let pos = 0;
        for (const word of txt.split(/\\s+/).filter(Boolean)) {
          const st = txt.indexOf(word, pos); pos = st + word.length;
          r.setStart(n, st); r.setEnd(n, pos); const rc = [...r.getClientRects()];
          rowWords.push({ word, lines: rc.length, right: Math.round(Math.max(0, ...rc.map(b => b.right))) });
        } } }
    const oneLineH = e => { if (!e) return 0; const cs = getComputedStyle(e);
      return Math.ceil(parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2 || e.getBoundingClientRect().height); };
    return JSON.stringify({ vw: document.documentElement.clientWidth,
      row: box(ROW), brand: box(BRAND), logo: box(LOGO), word: box(WORD), controls: box(CONTROLS),
      rowText: ROW ? ROW.textContent.replace(/\\s+/g, ' ').trim() : null,
      rowWords,
      // is the wordmark drawn in FULL, or is its own box clipping it? scrollWidth is the width it wants.
      wordClip: WORD ? { full: Math.ceil(WORD.scrollWidth), inner: Math.ceil(WORD.clientWidth), oneLineH: oneLineH(WORD) } : null,
      buttons: [...document.querySelectorAll('[data-tid="${P.controlsTid}"] > button')]
        .map(e => { const b = e.getBoundingClientRect(); return { label: e.getAttribute('aria-label') || e.getAttribute('title') || '',
          x: Math.round(b.x), right: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height),
          vis: b.width > 0 && b.height > 0, display: getComputedStyle(e).display }; }),
      wrap: box(WRAP), wrapCT: WRAP ? getComputedStyle(WRAP).containerType : null,
      chev: (() => { const e = document.querySelector('[data-hdr-more="chevron"]'); if (!e) return null; const b = e.getBoundingClientRect();
        return { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), right: Math.round(b.right), vis: b.width > 0,
          expanded: e.getAttribute('aria-expanded'), parentIsControls: e.parentElement === CONTROLS }; })(),
      panel: (() => { const e = document.querySelector('[data-hdr-more="panel"]'); if (!e) return null;
        return { box: box(e), outsideRow: !ROW.contains(e), display: getComputedStyle(e).display,
          btns: [...e.querySelectorAll(':scope > button')].map(x => { const b = x.getBoundingClientRect();
            const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return { id: x.getAttribute('data-hdr-item'), aria: x.getAttribute('aria-label'), hit: !!hit && (hit === x || x.contains(hit)), text: x.textContent.trim(), x: Math.round(b.x), y: Math.round(b.y), right: Math.round(b.right), bottom: Math.round(b.bottom),
              w: Math.round(b.width), h: Math.round(b.height), vis: b.width > 0 && b.height > 0 }; }) }; })(),
      vh: document.documentElement.clientHeight }); })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  const thrown = r.result && r.result.exceptionDetails;
  assert.ok(!thrown, 'the measuring probe threw: ' + JSON.stringify(thrown || {}).slice(0, 300));
  return JSON.parse(r.result.result.value);
}

// Each page is laid out once and both tests for it read the same rectangles.
async function measure(i) {
  if (!MEASURED.has(i)) MEASURED.set(i, await rects(i));
  return MEASURED.get(i);
}

// THE LOCATORS THEMSELVES, asserted before anything tries to measure through them. This is not ceremony: in
// September every single case in this file failed with `Cannot read properties of null (reading 'x')` because
// `ec443e4` removed the node they were anchored on, and a null locator reads exactly like an overflow in the
// output. One named test, so the failure says which anchor went.
test('the Today header is still shaped the way this test anchors it', () => {
  for (const [i, c] of CASES.entries()) {
    const P = PAGES[i], at = `at ${caseLabel(c)}`;
    assert.ok(P.logoTid >= 0,
      `THE TRINITYONE LOGO IS GONE from the Today header ${at} — the owner asked for the logo and the ` +
      'wordmark, and every rectangle this file reads is reached from that svg. If it moved rather than went, ' +
      're-anchor; if it was deleted, that is the regression.');
    assert.ok(P.brandTid >= 0 && P.rowTid >= 0,
      `the logo is no longer inside a brand block inside the header row ${at} — re-anchor this test`);
    assert.ok(P.wordTid >= 0,
      `THE TRINITYONE WORDMARK IS GONE from the Today header ${at} — the brand block holds only the logo now`);
    assert.ok(P.controlsTid >= 0,
      `the header row has no control group beside the brand block ${at} — re-anchor this test`);
    assert.ok(P.wrapTid >= 0, `the header row is not inside the container wrapper ${at} — re-anchor this test`);
  }
});

for (const [i, c] of GENERIC) {
  const label = caseLabel(c);

  test(`the whole header row fits a ${label}`,
    { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
    const m = await measure(i);
    assert.equal(m.vw, c.width, 'the page did not lay out at the width under test');

    // THE DEFECT THIS FILE EXISTS FOR. The row is `display:flex` with no `flex-wrap` and no shrinkable item,
    // so an item added to it is either inside the viewport or drawn off the right-hand edge of the phone —
    // and `overflow-x: hidden` on the scroll container above means scrollWidth will not tell you which.
    // Measured with the streak pill still there: right=379 at 360px, right=398 at 320px with a 365-day count.
    assert.ok(m.row.x >= 0 && m.row.right <= m.vw,
      `the header ROW itself is outside the ${m.vw}px viewport (${span(m.row)})`);
    assert.ok(m.controls.right <= m.vw,
      `the header control group runs off the right edge: it ends at x=${m.controls.right} in a ${m.vw}px ` +
      `viewport (${m.controls.right - m.vw}px past it), so the last control is cut off. ` +
      `Row: ${span(m.row)}. Brand block: ${span(m.brand)} (w=${m.brand.w}).`);
    assert.ok(m.controls.x >= 0, `the header control group starts off the left edge at x=${m.controls.x}`);

    // THE BRANDING IS ON THE SCREEN AND IN ONE PIECE. The owner asked for the logo and the wordmark, so
    // "the header fits" must not be satisfiable by losing them: both are required present, non-zero and
    // wholly inside the viewport. A removal fails the anchor test above; a push off the edge fails here.
    assert.ok(m.logo.w > 0 && m.logo.h > 0, `the TrinityOne logo measured ${m.logo.w}x${m.logo.h} at ${m.vw}px`);
    assert.ok(m.word.w > 0 && m.word.h > 0, `the TrinityOne wordmark measured ${m.word.w}x${m.word.h} at ${m.vw}px`);
    assert.ok(m.logo.x >= 0 && m.logo.right <= m.vw,
      `the TrinityOne logo is outside the ${m.vw}px viewport (${span(m.logo)})`);
    assert.ok(m.word.x >= 0 && m.word.right <= m.vw,
      `the TrinityOne wordmark is outside the ${m.vw}px viewport (${span(m.word)})`);
    assert.ok(m.brand.x >= 0 && m.brand.right <= m.vw,
      `the brand block is outside the ${m.vw}px viewport (${span(m.brand)})`);

    // Not just the group: no header control may leave the viewport, be squeezed to nothing, or sit on top of
    // another. Three controls is the base case and four is a church with an audio feed.
    // EXACTLY TWO CONTROLS in the row, at every width, for every church: the bell and the chevron. Search, Listen
    // and Dark live in the menu (owner decisions 2026-11-16), so putting one back in the row makes this fail.
    const vis = m.buttons.filter(b => b.vis);
    assert.equal(vis.length, 2,
      `the header row should hold exactly 2 controls (bell, chevron) at ${m.vw}px but ${vis.length} are visible: ` +
      JSON.stringify(vis.map(b => b.label)));
    assert.deepEqual(vis.map(b => b.label), ['Notifications', 'More'], 'the two row controls are the bell then the chevron');
    for (const b of vis) {
      assert.ok(b.x >= 0 && b.right <= m.vw,
        `header control "${b.label}" is outside the ${m.vw}px viewport (x=${b.x} right=${b.right})`);
      assert.ok(b.w > 20, `header control "${b.label}" has been squeezed to ${b.w}px wide`);
    }
    for (let k = 1; k < vis.length; k++) {
      assert.ok(vis[k].x >= vis[k - 1].right,
        `header controls "${vis[k - 1].label}" and "${vis[k].label}" overlap at ${m.vw}px`);
    }

    // THE BRAND AND THE CONTROLS ARE NOT DRAWN ON TOP OF EACH OTHER. This is the assertion the September
    // round added for the church pill and it matters just as much here: the row can fit inside the viewport
    // while its two children overlap, because neither of them may shrink and the overflow is clipped, not
    // scrolled. An x-coordinate on the right-hand group alone cannot see it.
    assert.ok(!overlaps(m.brand, m.controls),
      `the TrinityOne brand block is drawn across the header controls at ${m.vw}px: brand ${span(m.brand)}, ` +
      `controls ${span(m.controls)}`);
  });

  test(`nothing in the header is broken or unreadable at ${label}`,
    { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
    const m = await measure(i);
    assert.equal(m.vw, c.width, 'the page did not lay out at the width under test');

    // 1. THE ONLY TEXT IN THE TODAY HEADER IS THE WORDMARK — and this one assertion is doing three jobs.
    //    · THE READING-STREAK PILL IS GONE AND MUST STAY GONE (owner, 2026-10-09). Its digit was text in
    //      this row, so a pill drawn here again puts "7" or "365" in this string.
    //    · THE DATE AND THE GREETING ARE GONE AND MUST STAY GONE (owner, 2026-09-12: a phone already shows
    //      the date on its own status bar an inch above this line, and "Good morning" is two lines of the
    //      most valuable space on the screen saying nothing a member did not know). They are what produced
    //      "Wedne / sday 30 / Septem / ber" at 320px.
    //    · THE CHURCH NAME IS GONE (ec443e4) and is not expected back.
    //    It is read from the laid-out DOM's textContent, not from app/*.jsx source, so rule 3 does not bite:
    //    `false && ` in front of the pill would remove it from this string.
    assert.equal(m.rowText, 'TrinityOne',
      `THE TODAY HEADER HAS TEXT IN IT THAT IS NOT THE WORDMARK at ${m.vw}px. Read: ${JSON.stringify(m.rowText)}. ` +
      'The streak pill (a digit), the date and the greeting were all removed from this row on the owner\'s ' +
      'instruction; each of them would show up here.');

    // 2. NO WORD IS DRAWN ACROSS TWO LINES. The row has no `flex-wrap`, but the wordmark div itself can wrap
    //    its own text if the row ever squeezes it, and "Trinit / yOne" is the shape that would take. A Range
    //    over one word reports one client rect per line it is drawn on, so this cannot be satisfied by
    //    source text — and it is pointed at the row's real text nodes, so it also covers anything new.
    assert.ok(m.rowWords.length > 0, 'no text was found in the header row at all — re-anchor this test');
    for (const w of m.rowWords) {
      assert.ok(w.lines === 1,
        `"${w.word}" is drawn across ${w.lines} lines in the Today header at ${m.vw}px — the header row is ` +
        'squeezing its own content. All words in the row: ' + JSON.stringify(m.rowWords));
    }

    // 3. THE WORDMARK IS DRAWN IN FULL, not clipped to a fraction of itself. The September round caught the
    //    church name squeezed down to a single "…" while every x-coordinate in this file stayed green; the
    //    wordmark is fixed text so the equivalent check is exact — the box it is drawn in must be at least as
    //    wide as the text wants to be.
    assert.ok(m.wordClip.inner + 1 >= m.wordClip.full,
      `the TrinityOne wordmark is clipped at ${m.vw}px: it wants ${m.wordClip.full}px and its box is ` +
      `${m.wordClip.inner}px, so the end of the word is cut off`);
    //    and it is ONE line of its own font tall, which is the consequence of 2 above stated as a height.
    assert.ok(m.word.h > 0 && m.word.h <= m.wordClip.oneLineH + 2,
      `the TrinityOne wordmark is ${m.word.h}px tall at ${m.vw}px, more than one line of its own font ` +
      `(${m.wordClip.oneLineH}px) — it has wrapped`);

    // 4. THE ROW STAYS ONE LINE AND A SANE HEIGHT. With the streak pill gone every supported width fits on
    //    one line, so unlike the September version this is not conditional: the tallest thing in the row is a
    //    40px control button, and 169px is what it measured with the words broken. A row taller than one
    //    button has wrapped, which on a row with no `flex-wrap` means something inside it did.
    assert.ok(m.row.h > 0 && m.row.h <= 56,
      `the header row is ${m.row.h}px tall at ${m.vw}px — one line of 40px controls is ~40px, so it has ` +
      `wrapped. Brand ${span(m.brand)}, controls ${span(m.controls)}.`);
    assert.ok(m.brand.y < m.controls.bottom && m.controls.y < m.brand.bottom,
      `the brand block and the header controls are on different lines at ${m.vw}px: brand ${span(m.brand)}, ` +
      `controls ${span(m.controls)}`);

    // 5. AND THEY KEEP CLEAR AIR BETWEEN THEM. `justify-content: space-between` pushes them apart at a wide
    //    viewport, so the ONLY thing holding this up at the narrow end is the brand block's own
    //    `margin-right`. Without it the wordmark touches the search button.
    assert.ok(m.controls.x - m.brand.right >= 8,
      `the TrinityOne wordmark runs right up to the header controls at ${m.vw}px: brand ends at ` +
      `${m.brand.right}, controls start at ${m.controls.x} — they touch`);

    // 6. The controls stay against the right-hand edge of the row and the brand against the left. This is
    //    `space-between` doing its job, and it is what makes the gap in 5 the row's slack rather than a
    //    fixed distance.
    assert.ok(m.controls.right >= m.row.right - 1,
      `the header controls are not against the right edge at ${m.vw}px: controls end at ${m.controls.right}, ` +
      `row ends at ${m.row.right}`);
    assert.ok(m.brand.x <= m.row.x + 1,
      `the TrinityOne brand block is not against the left edge at ${m.vw}px: brand starts at ${m.brand.x}, ` +
      `row starts at ${m.row.x}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// ROUND 5, 2026-11-16: ONE CHEVRON AT EVERY WIDTH (PLAN-today-header-narrow, "OWNER DECISIONS 2026-11-16";
// AUDIT-PLAN-headers-today-community-2026-11-16). Round 4 (32b5b317, 2026-11-14) folded Listen and the moon only
// below 366px and only for a church with an audio feed. The owner then decided: Today keeps the wordmark and the
// bell; Search, Listen (audio-feed churches) and Dark ALWAYS live behind the chevron, every church, every width.
// So the row is exactly TWO controls everywhere, the container query / media fallback / resize-close are GONE
// (and the 23 lines of CSS with them), and the shared code is app/header-more.jsx.
//
// TWO LAYERS, because serialize() drops every function prop: a browser page built from it has no handlers, no
// state, no effects and no Escape key.
//   A. BEHAVIOUR, in the miniature React (no browser): the chevron's REAL onClick, the REAL document listeners the
//      header registers (captured), the REAL items' onClick. Handlers, Escape and outside-tap are proven HERE and
//      only here. Deleting the chevron wiring from the screen fails these (CLAUDE.md rule 1).
//   B. LAYOUT, in Chromium: the serialised CLOSED and OPEN trees laid out with index.html's own CSS. Chromium here
//      does HIT-TESTING and geometry only — `elementFromPoint` at each item's centre returns that item, it is
//      >= 44px tall and inside the viewport. It does NOT click anything; a serialised page has no handlers.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

// ── LAYER B: layout ──────────────────────────────────────────────────────────────────────────────────────
for (const [i, c] of GENERIC) {
  const label = caseLabel(c);
  test(`the row holds the bell and ONE chevron, nothing else — ${label}`,
    { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
    const m = await measure(i);
    assert.equal(m.vw, c.width, 'the page did not lay out at the width under test');
    assert.equal(m.buttons.length, 2, `the control group holds ${JSON.stringify(m.buttons.map(b => b.label))}, want the bell and the chevron only`);
    assert.ok(m.buttons.every(b => b.vis), 'both row controls are visible at every width');
    assert.ok(m.buttons.every(b => b.w === 44 && b.h === 44), `the row controls must be 44x44 (bell and chevron), got ${JSON.stringify(m.buttons.map(b => [b.label, b.w, b.h]))}`);
    assert.ok(m.chev, 'every church has the chevron');
    assert.ok(m.chev.parentIsControls, 'the chevron must be a DIRECT child of the control group');
    assert.equal(m.chev.w, 44, `the chevron is ${m.chev.w}px wide, want 44`);
    assert.equal(m.chev.h, 44, `the chevron is ${m.chev.h}px tall, want 44`);
    assert.equal(m.chev.expanded, c.open ? 'true' : 'false', 'aria-expanded must say what the menu is doing');
    assert.ok(m.chev.right <= m.vw && m.chev.x >= 0, 'the chevron is inside the viewport');
    if (!c.open) assert.equal(m.panel, null, 'a closed header renders no panel');
  });

  if (c.open) {
    test(`the OPEN menu: items on the screen, 44px+, and the thing hit at each centre is that item — ${label}`,
      { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
      const m = await measure(i);
      assert.ok(m.panel, 'the chevron was opened but no panel is in the tree');
      assert.ok(m.panel.outsideRow, 'the panel must sit OUTSIDE the header row (the row text and height are asserted)');
      const want = c.audioFeed ? ['search', 'listen', 'mode'] : ['search', 'mode'];
      // THE ITEMS MUST BE THERE: this is what stops "Search, Listen and Dark are behind the chevron" being satisfied
      // by deleting them (the row-count test above would still pass).
      assert.deepEqual(m.panel.btns.map(b => b.id), want, 'the menu items, in DOM order');
      assert.deepEqual(m.panel.btns.map(b => b.text), ['Search', ...(c.audioFeed ? ['Listen'] : []), c.dark ? 'Light' : 'Dark']);
      assert.equal(m.panel.btns[want.length - 1].aria, c.dark ? 'Switch to light mode' : 'Switch to dark mode', 'the mode item keeps the old control\'s name');
      for (const b of m.panel.btns) {
        assert.ok(b.vis, `menu item "${b.text}" is not visible at ${m.vw}px`);
        assert.ok(b.h >= 44, `menu item "${b.text}" is ${b.h}px tall, want >= 44`);
        assert.ok(b.w >= 44, `menu item "${b.text}" is ${b.w}px wide, want >= 44`);
        assert.ok(b.x >= 0 && b.right <= m.vw && b.y >= 0 && b.bottom <= m.vh,
          `menu item "${b.text}" is outside the ${m.vw}x${m.vh} viewport (x=${b.x}..${b.right}, y=${b.y}..${b.bottom})`);
        assert.ok(b.y >= m.row.bottom, `menu item "${b.text}" is not under the header row`);
        assert.ok(b.hit, `HIT TEST: the element at the centre of "${b.text}" is not that item — something covers it`);
      }
      for (let k = 1; k < m.panel.btns.length; k++) assert.ok(m.panel.btns[k - 1].right <= m.panel.btns[k].x, 'two menu items overlap');
      assert.ok(m.panel.box.w >= m.vw - 36 - 1, `the menu is ${m.panel.box.w}px wide, want the full ${m.vw - 36}`);
    });
  }
}

// ── the CSS is gone (audit: "verify after the build that index.html has no trn-hdr text left") ─────────────────
// index.html is not app/*.jsx, so reading it as text is allowed (CLAUDE.md rule 3 covers app/*.jsx only).
test('index.html carries none of the 2026-11-14 fold CSS, and the shared header file loads between ui.jsx and the screens', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.ok(!/trn-hdr/.test(html), 'a .trn-hdr-* rule is still in index.html: left in, `.trn-hdr-chev,.trn-hdr-panel{display:none !important}` would hide the menu for ever');
  assert.ok(!/container-type\s*:\s*inline-size/.test(html), 'a container-type rule is still in index.html');
  assert.ok(!/@container\b/.test(html), 'an @container rule is still in index.html');
  const tags = [...html.matchAll(/<script type="text\/babel" src="(app\/[^"]+)"/g)].map(m => m[1]);
  const at = n => tags.indexOf(n);
  assert.ok(at('app/header-more.jsx') > at('app/ui.jsx') && at('app/header-more.jsx') > at('app/icons.jsx'), 'header-more.jsx must load after icons.jsx and ui.jsx');
  assert.ok(at('app/header-more.jsx') < at('app/screens-today.jsx') && at('app/header-more.jsx') < at('app/screens-chat.jsx'), 'header-more.jsx must load before BOTH screens');
});

// ── LAYER A: behaviour, through the screen's own onClick / effects / document listeners ──────────────────────
const open = M => { M.mark(); M.chevron().props.onClick(); M.redraw(); };
const BUTTON_LABELS = M => find(M.tree, n => n.type === 'button').map(n => String(n.props['aria-label'] || ''));

test('A. the chevron opens the menu, says so in aria-expanded, and the menu is what the chevron controls', () => {
  const M = mountToday({ audioFeed: true });
  assert.ok(M.chevron(), 'every church has a chevron');
  assert.equal(M.chevron().props['aria-expanded'], false, 'starts CLOSED');
  assert.equal(M.chevron().props['aria-label'], 'More', 'the chevron is named "More" (an explicit name, not the icon\'s default "Expand")');
  assert.equal(M.panel(), null, 'no panel while closed');
  assert.equal(M.chevron().props['aria-controls'], undefined, 'no aria-controls to a panel that is not in the tree');
  open(M);
  assert.equal(M.chevron().props['aria-expanded'], true);
  assert.ok(M.panel(), 'the panel is in the tree once opened');
  assert.equal(M.chevron().props['aria-controls'], M.panel().props.id);
  M.chevron().props.onClick(); M.redraw();      // a toggle, not a one-way door
  assert.equal(M.chevron().props['aria-expanded'], false);
  assert.equal(M.panel(), null);
});

test('A. closed, the Today screen draws NO Search, Listen or dark-mode button; open, they are inside the panel and nowhere else', () => {
  for (const audioFeed of [false, true]) {
    const M = mountToday({ audioFeed });
    const names = BUTTON_LABELS(M);
    for (const gone of ['Search', 'Listen', 'Switch to dark mode', 'Switch to light mode']) assert.ok(!names.includes(gone), `"${gone}" is drawn in the closed header (audioFeed=${audioFeed})`);
    assert.ok(names.includes('Notifications') && names.includes('More'), 'the bell and the chevron are what remains');
    open(M);
    const inPanel = find(M.panel(), n => n.type === 'button').length;
    assert.equal(inPanel, audioFeed ? 3 : 2, 'the panel holds the items');
    const panelBtns = find(M.panel(), n => n.type === 'button');
    const outside = find(M.tree, n => n.type === 'button' && ['Search', 'Listen', 'Switch to dark mode'].includes(n.props['aria-label']) && !panelBtns.includes(n));
    assert.equal(outside.length, 0, 'no header control may sit outside the panel');
  }
});

test('A. the menu items are Search, Listen (only with an audio feed) and Dark, in that order', () => {
  const feed = mountToday({ audioFeed: true }); open(feed);
  assert.deepEqual(find(feed.panel(), n => n.type === 'button').map(n => n.props['data-hdr-item']), ['search', 'listen', 'mode']);
  const none = mountToday({ audioFeed: false }); open(none);
  assert.deepEqual(find(none.panel(), n => n.type === 'button').map(n => n.props['data-hdr-item']), ['search', 'mode'], 'no feed = no Listen item');
});

test('A. opening registers a capture pointerdown and focuses the first item; it adds NO key listener of its own (Escape rides the back stack)', () => {
  const M = mountToday({ audioFeed: true });
  assert.equal(M.docL.length, 0, 'a CLOSED header registers no document listener');
  open(M);
  const pd = M.last(M.docL, 'pointerdown');
  assert.ok(pd && pd.cap, 'pointerdown must be registered in the CAPTURE phase, as every other pop-over in the app does');
  assert.equal(M.docL.filter(l => l.type === 'keydown').length, 0, 'a keydown listener of its own would close the menu a SECOND time on Escape (ui.jsx\'s global handler already does)');
  assert.equal(M.winL.filter(l => l.type === 'resize').length, 0, 'the old 330px resize-close is gone: nothing here depends on a width');
  assert.ok(M.focused.includes('[data-hdr-item]'), 'focus moves to the first menu item when it opens');
});

test('A. the Search item calls openSearch EXACTLY ONCE and closes the menu', () => {
  const M = mountToday({ audioFeed: true });
  open(M);
  M.item('search').props.onClick(); M.redraw();
  assert.equal(M.calls.openSearch, 1);
  assert.equal(M.panel(), null, 'picking Search closes the menu');
  assert.equal(M.calls.openListen + M.calls.toggleDark, 0);
});

test('A. the Listen item calls openListen EXACTLY ONCE and closes the menu; Escape afterwards does not touch focus', () => {
  const M = mountToday({ audioFeed: true });
  open(M);
  M.item('listen').props.onClick(); M.redraw();
  assert.equal(M.calls.openListen, 1, 'openListen must be called exactly once by the Listen item');
  assert.equal(M.panel(), null, 'picking Listen closes the menu');
  assert.equal(M.calls.openSearch + M.calls.toggleDark, 0);
  // THE LISTEN OVERLAY NOW OWNS ESCAPE. The listener a real browser would already have removed (miniReact never runs
  // cleanups, so it is still here) must do nothing: not re-close, not pull focus back to the chevron.
  M.focused.length = 0;
  M.key('Escape'); M.redraw();
  assert.equal(M.focused.length, 0, 'Escape with the Listen overlay open must not move focus to the chevron behind it');
  assert.equal(M.calls.openListen, 1);
});

test('A. the Dark item calls toggleDark exactly once, closes the menu and hands focus back to the chevron', () => {
  const M = mountToday({ audioFeed: true });
  open(M);
  M.item('mode').props.onClick(); M.redraw();
  assert.equal(M.calls.toggleDark, 1);
  assert.equal(M.calls.openListen + M.calls.openSearch, 0);
  assert.equal(M.panel(), null);
  assert.ok(M.focused.includes('[data-hdr-more="chevron"]'), 'the picked button is gone, so focus must return to the chevron');
});

test('A. the Dark item reads "Dark" and is named "Switch to dark mode"; in dark mode "Light" and "Switch to light mode", with the sun', () => {
  const light = mountToday({ audioFeed: false }); open(light);
  assert.equal(light.item('mode').props['aria-label'], 'Switch to dark mode');
  assert.ok(reads(light.item('mode')).includes('Dark'));
  const dark = mountToday({ audioFeed: false, dark: true }); open(dark);
  assert.equal(dark.item('mode').props['aria-label'], 'Switch to light mode');
  assert.ok(reads(dark.item('mode')).includes('Light'));
  const iconOf = M => find(M.item('mode'), n => n.type === 'Icon' || (typeof n.type === 'function' && n.type.name === 'Icon'))[0];
  assert.equal(iconOf(light).props.name, 'moon', 'the header keeps its own sense: a moon while light');
  assert.equal(iconOf(dark).props.name, 'sun', 'and a sun while dark');
});

test('A. Escape (through ui.jsx\'s global handler and the back stack) closes the menu ONCE and returns focus to the chevron; other keys do not', () => {
  const M = mountToday({ audioFeed: true });
  open(M);
  M.key('a'); M.redraw();
  assert.ok(M.panel(), 'a letter key must not close the menu');
  M.focused.length = 0;
  M.key('Escape'); M.redraw();
  assert.equal(M.panel(), null, 'Escape closes the menu');
  assert.equal(M.chevron().props['aria-expanded'], false);
  assert.deepEqual(M.focused, ['[data-hdr-more="chevron"]'], 'Escape returns focus to the chevron EXACTLY ONCE (it used to be closed twice: a listener of its own plus the back stack)');
  assert.equal(M.calls.openListen + M.calls.openSearch + M.calls.toggleDark, 0, 'Escape must not pick anything');
});

test('A. hardware Back returns focus to the chevron, like Escape, WITHOUT scrolling the page (and a closed menu moves nothing)', () => {
  const back = mountToday({ audioFeed: true });
  open(back); back.focusCalls.length = 0; back.scroll.y = 1000;
  assert.equal(back.back(), true); back.redraw();
  assert.equal(back.panel(), null);
  assert.deepEqual(back.focusCalls.map(c => c.sel), ['[data-hdr-more="chevron"]'], 'Back left focus on a button that no longer exists');
  assert.equal(back.focusCalls[0].opts && back.focusCalls[0].opts.preventScroll, true, 'focus() must pass preventScroll, or a scrolled page jumps to the top');
  assert.equal(back.scroll.y, 1000, 'Back scrolled the page');
  back.focusCalls.length = 0;
  back.back(); back.redraw();
  assert.equal(back.focusCalls.length, 0, 'a second Back, with the menu already shut, must not pull focus anywhere');
});

test('A. Escape returns focus with preventScroll too: a scrolled page stays where it is', () => {
  const M = mountToday({ audioFeed: true });
  open(M); M.scroll.y = 1000; M.focusCalls.length = 0;
  M.key('Escape'); M.redraw();
  assert.equal(M.focusCalls.length, 1);
  assert.equal(M.focusCalls[0].opts && M.focusCalls[0].opts.preventScroll, true);
  assert.equal(M.scroll.y, 1000, 'Escape scrolled the page to the chevron');
});

test('A. a TAP OFF a card, on a page scrolled down, closes the menu, moves NO focus, leaves the scroll alone and does not swallow the press', () => {
  // THE BUG (re-audit of 8748f400): the tap-off handler refocused the chevron DURING the pointerdown; focus() scrolled the
  // page back to the top, so the click that followed missed the card under the finger. A tap off now moves nothing.
  const M = mountToday({ audioFeed: true });
  open(M); M.scroll.y = 1000; M.focusCalls.length = 0;
  const card = find(M.tree, n => n.type === 'button' && n.props['aria-label'] === 'Notifications')[0];
  const e = press(M, card);
  M.last(M.docL, 'pointerdown').fn(e); M.redraw();
  assert.equal(M.panel(), null, 'a tap off closes the menu');
  assert.equal(M.focusCalls.length, 0, 'a tap off must not call focus() at all');
  assert.equal(M.scroll.y, 1000, 'the page scrolled while the press was in flight, so the click would miss the card');
  assert.deepEqual(e.swallowed, [], 'the handler must not preventDefault / stopPropagation: the card has to receive the click');
});

test('A. a press OUTSIDE the header closes the menu', () => {
  const M = mountToday({ audioFeed: true });
  open(M);
  const off = M.last(M.docL, 'pointerdown').fn;
  const bell = find(M.tree, n => n.type === 'button' && n.props['aria-label'] === 'Notifications')[0];
  assert.ok(bell, 'anchor: the bell is in the tree');
  off(press(M, bell)); M.redraw();
  assert.equal(M.panel(), null, 'a pointerdown outside the chevron and the panel closes the menu');
  assert.equal(M.calls.openListen + M.calls.openSearch + M.calls.toggleDark, 0, 'closing by a tap off must not pick anything');
});

test('A. a press ON the chevron or ON the panel is NOT "outside" (so the chevron can close the menu it opened)', () => {
  // THE TRAP (audit HIGH 3, 2026-11-14): tapOffHandler ignores presses inside its selector. If the chevron does not
  // carry the selector, pointerdown closes the menu and the click that follows reopens it — the chevron could never
  // close it. The press is resolved through the REAL props the screen put on the chevron and the panel.
  const M = mountToday({ audioFeed: true });
  open(M);
  const off = M.last(M.docL, 'pointerdown').fn;
  off(press(M, M.chevron())); M.redraw();
  assert.ok(M.panel(), 'a pointerdown ON THE CHEVRON must not close the menu (the click then toggles it shut)');
  off(press(M, M.item('listen'))); M.redraw();
  assert.ok(M.panel(), 'a pointerdown on a menu item must not close the menu (its own click runs the action)');
  off(press(M, M.panel())); M.redraw();
  assert.ok(M.panel(), 'a pointerdown on the panel itself must not close the menu');
  off(press(M, M.chevron())); M.chevron().props.onClick(); M.redraw();
  assert.equal(M.panel(), null, 'press + click on the chevron must leave the menu closed, not re-opened');
  assert.ok('data-hdr-more' in M.chevron().props);
  open(M);
  assert.ok('data-hdr-more' in M.panel().props, 'the panel carries the same attribute as the chevron');
});

test('A. every church has the chevron; the row still has no church name, and no Today-only fold class is left on anything', () => {
  for (const audioFeed of [false, true]) {
    const M = mountToday({ audioFeed });
    assert.ok(M.chevron(), `no chevron for audioFeed=${audioFeed}`);
    assert.equal(find(M.tree, n => n.props && typeof n.props.className === 'string' && /trn-hdr/.test(n.props.className)).length, 0);
  }
});

test('A. Android hardware Back closes the open menu through the app\'s back stack (useBackLayer), instead of leaving the tab', () => {
  const M = mountToday({ audioFeed: true });
  assert.equal(M.backLayers(), 0, 'a closed header registers no back layer');
  assert.equal(M.back(), false, 'with nothing open, Back is not handled here: app.jsx then goes to Today / exits');
  open(M);
  assert.equal(M.backLayers(), 1, 'opening the menu registers ONE layer on the same stack the sheets use');
  assert.equal(M.back(), true, 'Back must be handled (true) while the menu is open, so the tab is not left');
  M.redraw();
  assert.equal(M.panel(), null, 'Back closes the menu');
  assert.equal(M.chevron().props['aria-expanded'], false);
  assert.equal(M.calls.openListen + M.calls.openSearch + M.calls.toggleDark, 0, 'Back must not pick anything');
});

test('PREMISE, in real chromium: focus() scrolls a page back to the focused element, focus({ preventScroll: true }) does not', { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
  // The model in layer A rests on this one browser fact. A tall page, a button at the top, scrolled down 1000px.
  const html = '<!doctype html><meta name="viewport" content="width=device-width"><button id="b" style="position:absolute;top:0">top</button><div style="height:3000px"></div>';
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 700, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: 'data:text/html;base64,' + Buffer.from(html).toString('base64') });
  await sleep(300);
  const r = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => { const b = document.getElementById('b'); window.scrollTo(0, 1000); const a = scrollY; b.focus({ preventScroll: true }); const keep = scrollY; b.blur(); window.scrollTo(0, 1000); b.focus(); return JSON.stringify({ a, keep, jumped: scrollY }); })()` });
  const m = JSON.parse(r.result.result.value);
  assert.equal(m.a, 1000, 'the page scrolled to 1000');
  assert.equal(m.keep, 1000, 'focus({ preventScroll: true }) must leave the page where it is');
  assert.equal(m.jumped, 0, 'a bare focus() scrolls the page to the focused element: the bug this guards against');
});
