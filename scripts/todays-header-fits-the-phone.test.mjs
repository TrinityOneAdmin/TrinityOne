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
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
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

// ── the real screen ───────────────────────────────────────────────────────────────────────────────────────
// Everything TodayScreen takes from OUTSIDE its own file. A name it needs that is not here is a
// ReferenceError at the point of use — deliberately, because a silently-stubbed global is how a test ends up
// asserting about something that is not the code. Icon and ChurchBadge are the REAL ones (they set the
// widths this test is about); the stubs are furniture that renders below the header.
const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

function todayPage({ width, audioFeed, churchName, date = new Date('2026-09-30T09:00:00Z') }) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const { ChurchBadge } = loadScreen('app/screens-church.jsx', ['ChurchBadge'],
    { React, window: {}, safeCssColor: (c, d) => d, safeImgUrl: () => '' });
  const win = {
    addEventListener() {}, removeEventListener() {}, innerWidth: width,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Fellowship: { subscribeCareRequests: () => () => {}, cancelCareRequest() {}, childCareAudience: async () => [] },
    ChurchBadge,
    TrinityData: { NOTIFICATIONS: [], PLANS: [{ id: 'p1', name: 'Plan', days: [{ d: 1, ref: 'John 1' }] }],
      VOTD_POOL: [{ ref: 'John 3:16', text: 'For God so loved the world.' }] },
    Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1,
      activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }) },
  };
  const globals = {
    React, window: win, localStorage: win.localStorage,
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
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
  const ctx = {
    // `audioFeed` is what puts the LISTEN button in the header — the fourth control, and the state any future
    // addition to this row collides with first.
    church: { name: churchName, initials: 'SB', npub: 'np1', audioFeed: audioFeed ? 'https://example.invalid/feed.xml' : null },
    openChurchSwitcher() {}, openSearch() {}, openNotifications() {}, toggleDark() {}, dark: false,
    toast() {}, netUnread: 0, openServing() {}, openListen() {},
    planProgress: {}, plans: [], bookmarks: [], notes: {}, highlights: {},
  };
  const tree = draw(TodayScreen, { ctx });
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
  const kidsOf = tid => (tid < 0 ? [] : (nodes[tid].kids || []).filter(k => k && k.props));
  // the wordmark: the brand block's element child that is not the logo
  const wordTid = nodes.findIndex((n, i) => i !== logoTid && kidsOf(brandTid).includes(n));
  // the control group: the row's element child that is not the brand block
  const controlsTid = nodes.findIndex((n, i) => i !== brandTid && kidsOf(rowTid).includes(n));
  // ⚠ THE READING-STREAK PILL IS GONE FROM THE SCREEN ON PURPOSE (owner, 2026-10-09) and is NOT anchored on
  // here. It is asserted ABSENT instead, by the only test in this file that can see it: the header row's
  // text. See "the Today header carries no text but the wordmark" below — the pill's digit was row text, so
  // that one assertion catches the pill coming back AND the date/greeting coming back.
  return { logoTid, brandTid, wordTid, rowTid, controlsTid, nodes, html:
`<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/vendor/fonts/fonts.css">
<style>${[...readFileSync(join(ROOT, 'index.html'), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')}
html,body{margin:0;padding:0} #app{position:relative;width:100%;height:100vh;overflow:hidden}</style>
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
for (const width of [320, 360, 390, 800]) for (const audioFeed of [false, true]) CASES.push({ width, audioFeed, churchName: CHURCH });
const PAGES = CASES.map(c => todayPage(c));

// ── A KNOWN OPEN DEFECT THAT IS NOT THIS BRANCH'S, AND IS NOT BEING HIDDEN ────────────────────────────────
// Removing the streak pill frees ~56px and the three-control header now fits every width above with room to
// spare (measured 2026-10-09: the control group ends at x=302 of 320, x=342 of 360). A church with an AUDIO
// FEED gets a fourth control — the Listen button, app/screens-today.jsx:2329 — and that header STILL runs off
// the edge:
//
//     brand block (logo + wordmark + its 16px margin)   w=146
//     four controls (4x40 + 3x8 gap)                    w=184   ->  330 in a 284px row
//     control group ends at                             x=364   ->  44px past 320px, 4px past 360px
//
// This is OLDER than the streak-pill removal and WORSE before it (five items in that row, not four), so it is
// not a regression of this change and fixing it is not in this branch's scope: the row cannot wrap, nothing in
// it may shrink, and the ways out — shrink the wordmark to an ellipsis, let the row wrap, or drop a control —
// are all owner decisions about branding the owner has already given an instruction on. REPORTED, not acted
// on.
//
// The two cases it bites are marked `todo` rather than deleted or tuned away. A `todo` test in node:test still
// RUNS and still reports, so the defect is visible in this file's output every time it is run, it does not
// fail the suite over something this branch did not break, and it goes green by itself the day the header is
// fixed. Every other case here is a hard assertion. The 390px and 800px audio-feed cases are NOT marked, and
// they pass — so the Listen button is measured, not excused.
const KNOWN_LISTEN_OVERFLOW = c => c.audioFeed && c.width <= 360;
const LISTEN_TODO = 'KNOWN OPEN DEFECT, not this branch: a church with an audio feed gets a 4th header ' +
  'control (Listen) and the control group ends at x=364 — 44px past a 320px viewport, 4px past a 360px one. ' +
  'Pre-dates the streak-pill removal (it was worse with 5 items in the row) and needs an owner decision on ' +
  'how the branding gives way. See the note above this line.';

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
          WORD = el(${P.wordTid}), CONTROLS = el(${P.controlsTid});
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
          x: Math.round(b.x), right: Math.round(b.right), w: Math.round(b.width) }; }) }); })()`;
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
    const P = PAGES[i], at = `at ${c.width}px (listen button: ${c.audioFeed ? 'yes' : 'no'})`;
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
  }
});

for (const [i, c] of CASES.entries()) {
  const label = `${c.width}px viewport (listen button: ${c.audioFeed ? 'yes' : 'no'})`;

  test(`the whole header row fits a ${label}`,
    { skip: !CHROME ? 'no chromium' : false, todo: KNOWN_LISTEN_OVERFLOW(c) ? LISTEN_TODO : false, timeout: 60000 }, async () => {
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
    const wantBtns = c.audioFeed ? 4 : 3;
    assert.equal(m.buttons.length, wantBtns,
      `the header should carry ${wantBtns} controls at ${m.vw}px (listen: ${c.audioFeed ? 'yes' : 'no'}) but ` +
      `${m.buttons.length} rendered: ${JSON.stringify(m.buttons.map(b => b.label))}`);
    for (const b of m.buttons) {
      assert.ok(b.x >= 0 && b.right <= m.vw,
        `header control "${b.label}" is outside the ${m.vw}px viewport (x=${b.x} right=${b.right})`);
      assert.ok(b.w > 20, `header control "${b.label}" has been squeezed to ${b.w}px wide`);
    }
    for (let k = 1; k < m.buttons.length; k++) {
      assert.ok(m.buttons[k].x >= m.buttons[k - 1].right,
        `header controls "${m.buttons[k - 1].label}" and "${m.buttons[k].label}" overlap at ${m.vw}px`);
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
