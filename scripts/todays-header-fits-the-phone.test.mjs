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
import { loadScreen, miniReact, find } from './render-jsx-screen.mjs';
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
//   · `querySelector` hands back a recorder for the header's own focus targets and a sized stand-in for the
//     container wrapper (`S.wrapWidth`), because there is no layout in this layer — LAYER B (Chromium) is where
//     widths are real.
//   · `calls` counts the two shared handlers the header drives (openListen has ONE reader, this header; toggleDark
//     has two: this header and the reading screen).
function mountToday({ audioFeed, churchName = 'St Bartholomew-the-Great', date = new Date('2026-09-30T09:00:00Z'), width = 390 }) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const { ChurchBadge } = loadScreen('app/screens-church.jsx', ['ChurchBadge'],
    { React, window: {}, safeCssColor: (c, d) => d, safeImgUrl: () => '' });
  const docL = [], winL = [], focused = [];
  const S = { wrapWidth: width - 36 };
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
      if (sel === '.trn-hdr-wrap') return { getBoundingClientRect: () => ({ width: S.wrapWidth }) };
      if (String(sel).startsWith('[data-hdr')) return { focus() { focused.push(sel); } };
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
  const { TodayScreen } = loadScreen('app/screens-today.jsx', ['TodayScreen'], globals);
  const calls = { openListen: 0, toggleDark: 0 };
  const ctx = {
    // `audioFeed` is what puts the LISTEN button in the header — the fourth control, and the state any future
    // addition to this row collides with first.
    church: { name: churchName, initials: 'SB', npub: 'np1', audioFeed: audioFeed ? 'https://example.invalid/feed.xml' : null },
    openChurchSwitcher() {}, openSearch() {}, openNotifications() {}, dark: false,
    toggleDark() { calls.toggleDark++; }, openListen() { calls.openListen++; },
    toast() {}, netUnread: 0, openServing() {},
    planProgress: {}, plans: [], bookmarks: [], notes: {}, highlights: {},
  };
  const M = { ctx, calls, docL, winL, focused, S, tree: null,
    redraw() { M.tree = draw(TodayScreen, { ctx }); return M.tree; },
    mark() { docL.length = 0; winL.length = 0; focused.length = 0; },
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
const press = (M, node) => ({ target: { closest: closestIn(M.tree, node) } });   // a pointerdown event on `node`

// THE CSS A PAGE IS DRESSED IN. With `fallback`, the container-query path is switched OFF the only way a test
// can: the wrapper loses `container-type`, the @container block goes, and the `@supports not (container-type…)`
// guard is rewritten so the media-query fallback applies in a browser that DOES support containers. Every
// anchor must occur exactly once or this throws at load (a rename in index.html must not silently turn the
// "fallback" pages into container pages).
function pageCss(fallback) {
  let c = [...readFileSync(join(ROOT, 'index.html'), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  if (!fallback) return c;
  const once = (needle) => { assert.equal(c.split(needle).length - 1, 1, 'index.html no longer has exactly one: ' + needle); };
  once('.trn-hdr-wrap { container-type: inline-size; }');
  once('@supports not (container-type: inline-size) {');
  const qs = [...c.matchAll(/@container[^{]*\{/g)];
  assert.equal(qs.length, 1, 'index.html no longer has exactly one @container fold block');
  const at = qs[0].index;
  // cut the @container block by brace matching
  let depth = 0, end = -1;
  for (let k = c.indexOf('{', at); k < c.length; k++) { if (c[k] === '{') depth++; else if (c[k] === '}' && --depth === 0) { end = k + 1; break; } }
  assert.ok(end > at);
  c = c.slice(0, at) + c.slice(end);
  c = c.replace('.trn-hdr-wrap { container-type: inline-size; }', '.trn-hdr-wrap { }');
  c = c.replace('@supports not (container-type: inline-size) {', '@supports (display: block) {');
  return c;
}

// LAYER B's page: the screen (optionally OPENED through its own chevron, in layer A's live harness), serialised
// and dressed in index.html's own CSS.
function todayPage({ width, audioFeed, churchName, open = false, fallback = false, zoom = 0 }) {
  const M = mountToday({ audioFeed, churchName, width });
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
  const wrapTid = parentOf(rowTid);                   // the container wrapper around the row (and the open panel)
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
<style>${pageCss(fallback)}
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
// CLOSED header, every width that matters. 365 and 366 are the EDGE: the row needs 330px and a viewport has
// 18px of padding a side, so 365 gives a 329px row (folds) and 366 gives exactly 330 (fits, does not fold).
for (const width of [320, 360, 365, 366, 390, 800]) for (const audioFeed of [false, true]) CASES.push({ width, audioFeed, churchName: CHURCH });
// OPEN panel, serialised AFTER the chevron's own onClick ran in the live harness (layer A) — 390 is the "opened,
// then the phone widened" case: the CSS must hide the panel and the chevron again.
for (const width of [320, 360, 365, 390]) CASES.push({ width, audioFeed: true, churchName: CHURCH, open: true });
// MEDIA-QUERY FALLBACK, with the container-query path switched off (see pageCss). Chromium here supports
// container queries, so without these cases the fallback would never run. The Oppo is on the container path
// too: THE DEVICE CHECK CANNOT PROVE THE FALLBACK.
for (const width of [320, 365, 366]) CASES.push({ width, audioFeed: true, churchName: CHURCH, fallback: true });
for (const width of [365, 366]) CASES.push({ width, audioFeed: true, churchName: CHURCH, fallback: true, open: true });
// TEXT ZOOM 130%: the wordmark scaled the way Android's "Font size" setting scales it. Measured, not wished.
for (const width of [320, 360]) CASES.push({ width, audioFeed: true, churchName: CHURCH, zoom: 1.3 });
const PAGES = CASES.map(c => todayPage(c));
const caseLabel = c => `${c.width}px viewport (listen button: ${c.audioFeed ? 'yes' : 'no'}${c.open ? ', panel OPEN' : ''}${c.fallback ? ', MEDIA-QUERY FALLBACK' : ''}${c.zoom ? ', text zoom ' + Math.round(c.zoom * 100) + '%' : ''})`;
// What the layout must show: folded when the row would be < 330px, i.e. a viewport under 366.
const foldsAt = c => c.audioFeed && c.width < 366;
const wantVisible = c => (c.audioFeed ? (foldsAt(c) ? 3 : 4) : 3);   // search + bell + (chevron | listen + moon)
const GENERIC = [...CASES.entries()].filter(([, c]) => !c.zoom);

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
            return { text: x.textContent.trim(), x: Math.round(b.x), y: Math.round(b.y), right: Math.round(b.right), bottom: Math.round(b.bottom),
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
    // VISIBLE controls only (a folded control is display:none, width 0, and must not read as "squeezed").
    // search + bell always; a church with a feed adds Listen + moon, or, below 366px, the chevron instead.
    const vis = m.buttons.filter(b => b.vis);
    const wantBtns = wantVisible(c);
    assert.equal(vis.length, wantBtns,
      `the header should show ${wantBtns} controls at ${m.vw}px (listen: ${c.audioFeed ? 'yes' : 'no'}) but ` +
      `${vis.length} are visible: ${JSON.stringify(vis.map(b => b.label))}`);
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
// ROUND 4, 2026-11-14: THE CHEVRON (PLAN-today-header-narrow option F, AUDIT-PLAN-today-header-chevron).
// A church with an audio feed has FOUR header controls and the row needs 330px; the owner's Oppo is 360 CSS px
// (324px of row), so the moon ran 4px off the edge and at 320 Listen did too. This used to be a `todo` here
// (KNOWN_LISTEN_OVERFLOW) — two todo rows, now two PASSING tests: at < 366px Listen and the moon fold behind a
// 44px chevron that opens a full-width row of two buttons under the header; search and the bell never fold.
//
// TWO LAYERS, because the audit (HIGH 1) showed one cannot do both jobs. serialize() drops every function prop and
// writes static HTML, so a browser page built from it has no handlers, no state, no effects and no Escape key.
//   A. BEHAVIOUR, in the miniature React (no browser): the chevron's REAL onClick, the REAL document listeners the
//      screen registers (captured, not stubbed away), the REAL panel buttons. Deleting the chevron wiring from the
//      screen fails these; the engine alone cannot satisfy them (CLAUDE.md rule 1).
//   B. LAYOUT, in Chromium (the cases above): the serialised CLOSED and OPEN trees laid out with index.html's own
//      CSS at 320/360/365/366/390/800, on the container path AND on the media-query fallback.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

// ── LAYER B: layout ──────────────────────────────────────────────────────────────────────────────────────
for (const [i, c] of GENERIC) {
  const label = caseLabel(c);
  test(`the header folds Listen and the moon behind ONE chevron exactly when it must — ${label}`,
    { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
    const m = await measure(i);
    assert.equal(m.vw, c.width, 'the page did not lay out at the width under test');
    // WHICH CSS PATH RAN. A "fallback" page that still had container-type would prove nothing about the fallback.
    assert.equal(m.wrapCT, c.fallback ? 'normal' : 'inline-size',
      `the container wrapper has container-type "${m.wrapCT}" in a ${c.fallback ? 'FALLBACK' : 'container-query'} page`);
    assert.ok(m.wrap && m.wrap.w === m.vw - 36, `the container wrapper is ${m.wrap && m.wrap.w}px, want a full-width block of ${m.vw - 36}`);

    const by = l => m.buttons.filter(b => b.label === l);
    // THE HIDDEN CONTROLS MUST STILL EXIST (audit: counting only the visible ones is satisfied by deleting Listen).
    assert.equal(m.buttons.length, c.audioFeed ? 5 : 3,
      `the control group should hold ${c.audioFeed ? '5 buttons (search, listen, bell, moon, chevron)' : '3 buttons'} in the tree ` +
      `at ${m.vw}px, found ${JSON.stringify(m.buttons.map(b => b.label))}`);
    assert.equal(by('Search').length, 1); assert.equal(by('Notifications').length, 1);
    assert.ok(by('Search')[0].vis && by('Notifications')[0].vis, `search and the bell must NEVER fold (${m.vw}px)`);
    assert.equal(by('Listen').length, c.audioFeed ? 1 : 0, 'Listen must be in the tree exactly when the church has a feed');
    assert.equal(m.buttons.filter(b => /Switch to (dark|light) mode/.test(b.label)).length, 1, 'the moon must always be in the tree');
    const moon = m.buttons.find(b => /Switch to (dark|light) mode/.test(b.label));

    if (!c.audioFeed) {
      // A CHURCH WITHOUT A FEED KEEPS ITS MOON AND GETS NO CHEVRON, AT EVERY WIDTH.
      assert.ok(moon.vis, `the moon must stay visible for a church with no audio feed at ${m.vw}px`);
      assert.equal(m.chev, null, 'a church with no audio feed must not get a chevron');
      assert.equal(m.panel, null, 'a church with no audio feed must not get a panel');
      return;
    }
    const folded = foldsAt(c);
    assert.ok(m.chev, 'a church with an audio feed has a chevron in the tree');
    assert.ok(m.chev.parentIsControls, 'the chevron must be a DIRECT child of the control group (the count anchors on it)');
    assert.equal(m.chev.vis, folded, `the chevron must be ${folded ? 'visible' : 'hidden'} at ${m.vw}px (fold below 366)`);
    assert.equal(by('Listen')[0].vis, !folded, `Listen must be ${folded ? 'folded away' : 'inline'} at ${m.vw}px`);
    assert.equal(moon.vis, !folded, `the moon must be ${folded ? 'folded away' : 'inline'} at ${m.vw}px`);
    if (folded) {
      assert.equal(m.chev.w, 44, `the chevron is ${m.chev.w}px wide, want 44`);
      assert.equal(m.chev.h, 44, `the chevron is ${m.chev.h}px tall, want 44`);
    }
    assert.equal(m.chev.expanded, c.open ? 'true' : 'false', 'aria-expanded must say what the panel is doing');
  });

  if (c.audioFeed && c.open) {
    test(`the OPEN panel is two big buttons, outside the row, on the screen — ${label}`,
      { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
      const m = await measure(i);
      assert.ok(m.panel, 'the chevron was opened but no panel is in the tree');
      assert.ok(m.panel.outsideRow, 'the panel must sit OUTSIDE the header row (the row text and height are asserted)');
      assert.equal(m.panel.btns.length, 2);
      if (!foldsAt(c)) {
        // opened, then the phone widened (rotation): CSS hides the panel; the state is closed by the resize handler (layer A)
        assert.equal(m.panel.display, 'none', `a panel left open must be hidden at ${m.vw}px`);
        assert.ok(m.panel.btns.every(b => !b.vis), 'no panel button may be visible when the row is wide');
        return;
      }
      assert.equal(m.panel.display, 'flex');
      for (const b of m.panel.btns) {
        assert.ok(b.vis, `panel button "${b.text}" is not visible at ${m.vw}px`);
        assert.ok(b.h >= 44, `panel button "${b.text}" is ${b.h}px tall, want >= 44`);
        assert.ok(b.w >= 44, `panel button "${b.text}" is ${b.w}px wide, want >= 44`);
        assert.ok(b.x >= 0 && b.right <= m.vw && b.y >= 0 && b.bottom <= m.vh,
          `panel button "${b.text}" is outside the ${m.vw}x${m.vh} viewport (x=${b.x}..${b.right}, y=${b.y}..${b.bottom})`);
        assert.ok(b.y >= m.row.bottom, `panel button "${b.text}" is not under the header row`);
      }
      assert.deepEqual(m.panel.btns.map(b => b.text), ['Listen', 'Dark']);
      assert.ok(m.panel.btns[0].right <= m.panel.btns[1].x, 'the two panel buttons overlap');
      assert.ok(m.panel.box.w >= m.vw - 36 - 1, `the panel is ${m.panel.box.w}px wide, want the full ${m.vw - 36}`);
    });
  }
}

// ── TEXT ZOOM 130%, RECORDED HONESTLY (audit MEDIUM; the decision taken: say plainly it can still overflow) ──
// The wordmark is px text, so Android's "Font size" setting grows the brand beyond its 146px and the fold width
// (330px of row) is only right at normal size. Measured here with the wordmark at 130%.
for (const [i, c] of CASES.entries()) {
  if (!c.zoom) continue;
  test(`KNOWN LIMIT, recorded: at 130% text size the header ${c.width === 360 ? 'still fits' : 'overflows'} at ${c.width}px`,
    { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
    const m = await measure(i);
    assert.equal(m.vw, c.width);
    // the structure is still right at zoom: folded, chevron visible, the hidden controls still in the tree
    assert.equal(m.buttons.length, 5);
    assert.ok(m.chev.vis, 'the chevron is shown at this width whatever the text size');
    const past = m.controls.right - m.vw;
    console.log(`# text zoom 130% at ${c.width}px: brand ${span(m.brand)} controls ${span(m.controls)} -> ${past}px past the edge`);
    if (c.width === 360) assert.ok(past <= 0, `at 360px and 130% text the control group ends ${past}px past the edge`);
    else assert.ok(past > 0, `ZOOM LIMIT HAS MOVED: at 320px and 130% text the controls now fit (${past}); update the note and the comment in index.html`);
  });
}

// ── LAYER A: behaviour, through the screen's own onClick / effects / document listeners ──────────────────────
const open = M => { M.mark(); M.chevron().props.onClick(); M.redraw(); };

test('A. the chevron opens the panel, says so in aria-expanded, and the panel is what the chevron controls', () => {
  const M = mountToday({ audioFeed: true });
  assert.ok(M.chevron(), 'a church with a feed has a chevron');
  assert.equal(M.chevron().props['aria-expanded'], false, 'starts CLOSED');
  assert.equal(M.chevron().props['aria-label'], 'More');
  assert.equal(M.panel(), null, 'no panel while closed');
  assert.equal(M.chevron().props['aria-controls'], undefined, 'no aria-controls to a panel that is not in the tree');
  open(M);
  assert.equal(M.chevron().props['aria-expanded'], true);
  assert.ok(M.panel(), 'the panel is in the tree once opened');
  assert.equal(M.chevron().props['aria-controls'], M.panel().props.id);
  assert.ok(M.item('listen') && M.item('mode'), 'the panel carries Listen and the dark-mode button');
  assert.equal(M.item('listen').type, 'button');
  // pressing the chevron again closes it (it is a toggle, not a one-way door)
  M.chevron().props.onClick(); M.redraw();
  assert.equal(M.chevron().props['aria-expanded'], false);
  assert.equal(M.panel(), null);
});

test('A. opening registers a capture pointerdown, an Escape key listener and a resize listener, and focuses the first button', () => {
  const M = mountToday({ audioFeed: true });
  assert.equal(M.docL.length, 0, 'a CLOSED header registers no document listener');
  open(M);
  const pd = M.last(M.docL, 'pointerdown'), kd = M.last(M.docL, 'keydown'), rs = M.last(M.winL, 'resize');
  assert.ok(pd && pd.cap, 'pointerdown must be registered in the CAPTURE phase, as every other pop-over in the app does');
  assert.ok(kd, 'an Escape (keydown) listener is registered');
  assert.ok(rs, 'a window resize listener is registered');
  assert.ok(M.focused.includes('[data-hdr-item="listen"]'), 'focus moves to the first panel button when the row opens');
});

test('A. the panel Listen button calls openListen EXACTLY ONCE and closes the row', () => {
  const M = mountToday({ audioFeed: true });
  assert.equal(M.calls.openListen, 0);
  open(M);
  M.item('listen').props.onClick(); M.redraw();
  assert.equal(M.calls.openListen, 1, 'openListen must be called exactly once by the panel Listen button');
  assert.equal(M.panel(), null, 'picking Listen closes the row');
  assert.equal(M.chevron().props['aria-expanded'], false);
  assert.equal(M.calls.toggleDark, 0, 'Listen must not touch the theme');
});

test('A. the panel moon calls toggleDark exactly once, closes the row, and hands focus back to the chevron', () => {
  const M = mountToday({ audioFeed: true });
  open(M);
  M.item('mode').props.onClick(); M.redraw();
  assert.equal(M.calls.toggleDark, 1);
  assert.equal(M.calls.openListen, 0, 'the moon must not open Listen');
  assert.equal(M.panel(), null);
  assert.ok(M.focused.includes('[data-hdr-more="chevron"]'), 'the picked button is gone, so focus must return to the chevron');
});

test('A. Escape closes the row and returns focus to the chevron; other keys do not', () => {
  const M = mountToday({ audioFeed: true });
  open(M);
  const kd = M.last(M.docL, 'keydown').fn;
  kd({ key: 'a' }); M.redraw();
  assert.ok(M.panel(), 'a letter key must not close the row');
  M.focused.length = 0;
  kd({ key: 'Escape' }); M.redraw();
  assert.equal(M.panel(), null, 'Escape closes the row');
  assert.equal(M.chevron().props['aria-expanded'], false);
  assert.ok(M.focused.includes('[data-hdr-more="chevron"]'), 'Escape returns focus to the chevron');
  assert.equal(M.calls.openListen, 0, 'Escape must not pick anything');
});

test('A. a press OUTSIDE the header closes the row; a press on a card below is outside', () => {
  const M = mountToday({ audioFeed: true });
  open(M);
  const off = M.last(M.docL, 'pointerdown').fn;
  const bell = find(M.tree, n => n.type === 'button' && n.props['aria-label'] === 'Notifications')[0];
  assert.ok(bell, 'anchor: the bell is in the tree');
  off(press(M, bell)); M.redraw();
  assert.equal(M.panel(), null, 'a pointerdown outside the chevron and the panel closes the row');
  assert.equal(M.calls.openListen + M.calls.toggleDark, 0, 'closing by a tap off must not pick anything');
});

test('A. a press ON the chevron or ON the panel is NOT "outside" (so the chevron can close the row it opened)', () => {
  // THE TRAP (audit HIGH 3): tapOffHandler ignores presses inside its selector. If the chevron does not carry the
  // selector, pointerdown closes the row and the click that follows reopens it — the chevron could never close it.
  // The press is resolved through the REAL props the screen put on the chevron and the panel, by .closest().
  const M = mountToday({ audioFeed: true });
  open(M);
  const off = M.last(M.docL, 'pointerdown').fn;
  off(press(M, M.chevron())); M.redraw();
  assert.ok(M.panel(), 'a pointerdown ON THE CHEVRON must not close the row (the click then toggles it shut)');
  off(press(M, M.item('listen'))); M.redraw();
  assert.ok(M.panel(), 'a pointerdown on a panel button must not close the row (its own click runs the action)');
  off(press(M, M.panel())); M.redraw();
  assert.ok(M.panel(), 'a pointerdown on the panel itself must not close the row');
  // and the whole press-then-click cycle on the chevron ends CLOSED, not re-opened
  off(press(M, M.chevron())); M.chevron().props.onClick(); M.redraw();
  assert.equal(M.panel(), null, 'press + click on the chevron must leave the row closed');
  // one shared attribute, on both
  assert.ok('data-hdr-more' in M.chevron().props);
  open(M);
  assert.ok('data-hdr-more' in M.panel().props, 'the panel carries the same attribute as the chevron');
});

test('A. when the row WIDENS past the fold width the open row closes (rotation), and not before', () => {
  const M = mountToday({ audioFeed: true, width: 360 });
  open(M);
  const rs = M.last(M.winL, 'resize').fn;
  M.S.wrapWidth = 329; rs(); M.redraw();
  assert.ok(M.panel(), 'a row still under 330px keeps the panel open');
  M.S.wrapWidth = 330; rs(); M.redraw();
  assert.equal(M.panel(), null, 'at 330px the controls all fit inline, so the panel is closed rather than left to reappear later');
});

test('A. NO audio feed: no chevron, no panel, no fold class on the moon, nothing registered', () => {
  const M = mountToday({ audioFeed: false });
  assert.equal(M.chevron(), null, 'a church with no feed must not get a chevron');
  assert.equal(M.panel(), null);
  const moon = find(M.tree, n => n.type === 'button' && /Switch to (dark|light) mode/.test(String(n.props['aria-label'])))[0];
  assert.ok(moon, 'the moon is there');
  assert.equal(moon.props.className, undefined, 'the moon of a feedless church must carry NO fold class (it would vanish at narrow widths)');
  assert.equal(find(M.tree, n => n.props && n.props.className === 'trn-hdr-inline').length, 0, 'nothing folds without a feed');
  assert.equal(M.docL.length, 0);
});

test('A. WITH a feed, Listen and the moon carry the fold class and the chevron + panel carry their own', () => {
  const M = mountToday({ audioFeed: true });
  const inline = find(M.tree, n => n.type === 'button' && n.props.className === 'trn-hdr-inline');
  assert.deepEqual(inline.map(n => n.props['aria-label']).sort(), ['Listen', 'Switch to dark mode'].sort());
  assert.equal(M.chevron().props.className, 'trn-hdr-chev');
  open(M);
  assert.equal(M.panel().props.className, 'trn-hdr-panel');
});
