// THE READING-STREAK PILL IS ON THE SCREEN, NOT PAST THE EDGE OF IT.
// Run: node --test scripts/todays-header-fits-the-phone.test.mjs
//
// Found on an Oppo handset, 360px CSS viewport, 2026-09-01: the flame was visible and the digit beside it was
// cut in half. Reproduced here at 320 / 360 / 390 and measured. Every number below came out of this file.
//
//     row box               x=18  w=324  right=342     (the row itself obeys its container)
//     greeting column       x=18  w=191                (min-content — it would not shrink)
//     control group         x=209 w=200  right=408     (min-content — it would not shrink either)
//     streak pill           x=353 w=56   right=408     -> 48px past a 360px viewport
//
// 191 + 200 = 391 in a 324px row. WHY the greeting column stuck at 191 is the whole of the bug, and it is not
// the pill: the column's min-content was EXACTLY the church-name button's min-content, also 191. A
// `white-space: nowrap` run contributes its FULL text width to min-content, so the `text-overflow: ellipsis`
// already on that name never got the chance to act; `max-width: 220px` capped nothing because 191 is under
// 220; and a flex item's default `min-width: auto` forbade shrinking below it. The date needed only 90.
// `overflow-x: hidden` on the scroll container then clipped the overflow rather than scrolling to it, which is
// why `document.documentElement.scrollWidth` reads a truthful-looking 360 on the phone.
//
// So the pill was the VICTIM — it is simply last in source order. Shaving its padding until it fitted at 360
// would have come straight back at 320, or the first time somebody reached a 365-day streak (the pill is 56px
// at "7" and 74px at "365" — both measured here). Hence this file sweeps four widths and both streak widths.
//
// THE SECOND ROUND, 2026-09-01. The first fix let the column shrink without a floor and used
// `overflow-wrap: anywhere` to stop the date spilling out of it. `anywhere` inherits, so at 320px with a long
// church name and a three-digit streak the column was squeezed to 56px and the header read
//
//     Wedne / sday 30 / Septem / ber          Good / mornin / g          [ … ]   <- the church name, 14px
//     header row 169px tall (87px before)
//
// and this file stayed 10/10 GREEN over all of it, because every assertion it had was an x-coordinate on the
// streak pill and the four control buttons. Three of the six style changes were unmeasured, and one of those
// three (`max-width` on the church button) was load-bearing. So this round measures, as well:
//   · the CHURCH BUTTON's box, and that it never overlaps the control group;
//   · that no WORD in the date or the greeting is drawn across two lines, and none spills out of its column;
//   · that the church NAME is wider than a lone "…" in its own font;
//   · the header ROW's height, and that it only wraps to a second line where it genuinely cannot fit.
//
// HOW IT ASSERTS, and why not more cheaply. CLAUDE.md rule 3: app/screens-today.jsx ships UNBUNDLED, so
// `false && ` in front of a condition leaves every word of it in place and a text-matching assertion still
// passes. Nothing here matches text in app/*.jsx. The REAL TodayScreen is compiled with the same esbuild the
// build uses and rendered through the miniature React in scripts/render-jsx-screen.mjs; the tree that comes
// back is serialised to HTML, dressed in index.html's OWN <style> block and the app's OWN Sora files, and
// laid out by a real browser at a real device width. Every assertion reads getBoundingClientRect(), or a
// Range's client rects — a word broken across two lines reports two of them, an unbroken one reports one.
//
// Sora matters: the pill measured 56px wide here and 56px on the handset. A fallback face would be measuring
// a different screen from the one that ships, so the fonts are served, and the probe waits on document.fonts.
//
// MEASURED RED/GREEN, 2026-09-01, this file against app/screens-today.jsx:
//   · fixed screen                          21 pass /  0 fail
//   · header row reverted to 60974e5        18 pass /  3 fail — all three 320px cases, on the broken words,
//                                                              the 14px church name and the 169px row
//   · church pill deleted from the screen    0 pass / 21 fail
//   · streak pill deleted from the screen    0 pass / 21 fail
// and, one style change at a time (each anchor verified to occur exactly once in the file first):
//   · row     flexWrap wrap    removed    18/3      · col      flex 1 1 96px removed  17/4
//   · row     gap 10           removed    14/7      · col      basis 96px -> 40px     18/3
//   · col     minWidth 0       removed    18/3      · col      basis 96px -> 200px    17/4
//   · church  maxWidth         removed    19/2      · controls marginLeft auto rm     17/4
//   · controls flexShrink 0    removed    21/0  <- INERT, and said so in the screen's own comment
//
// The 800px cases and the "Grace" case passed against the ORIGINAL unfixed screen too, and are kept rather
// than tuned away: 800px genuinely fitted, and so did a short church name at 360px. That is the honest shape
// of the first bug — it is the church NAME that sets the greeting column's min-content, so a short-named
// church never saw it, which is very likely why it shipped.
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
// (the streak button, the control group) instead of hunting for it by text in the DOM.
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

function todayPage({ width, streak, churchName, date = new Date('2026-09-30T09:00:00Z') }) {
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
    // the streak comes out of local storage; hand back the count under test
    lsGet: (k, d) => (k === 'trinityone.streak' ? { count: streak, last: date.toISOString().slice(0, 10) } : d),
    lsSet: () => {},
    cx: (...a) => a.filter(Boolean).join(' '),
    SectionLabel: Stub('SectionLabel'), Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'),
    useTrinityAudio: () => ({ track: null, playing: false }),
    todayISO: () => date.toISOString().slice(0, 10),
    // pin "today" so the date line is a known string ("Wednesday 30 September" — a long one, on purpose)
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [date])); } static now() { return date.getTime(); } },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  };
  const { TodayScreen } = loadScreen('app/screens-today.jsx', ['TodayScreen'], globals);
  const ctx = {
    church: { name: churchName, initials: 'SB', npub: 'np1' },
    openChurchSwitcher() {}, openSearch() {}, openNotifications() {}, toggleDark() {}, dark: false,
    toast() {}, netUnread: 0, openServing() {}, openListen() {},
    planProgress: {}, plans: [], bookmarks: [], notes: {}, highlights: {},
  };
  const tree = draw(TodayScreen, { ctx });
  const { html, nodes } = serialize(tree);
  // Found in the RENDERED TREE, by the props the screen put on it. If the pill is deleted from the screen
  // this is -1 and every test below says so.
  const streakTid = nodes.findIndex(n => n.type === 'button' && /reading streak/.test(String((n.props || {}).title || '')));
  const controlsTid = streakTid < 0 ? -1 : nodes.findIndex(n => (n.kids || []).some(k => k && k.props && nodes[streakTid] === k));
  // The church pill, the row and the greeting column, found the same way — by what the screen put on them,
  // never by text. The church button is measured because a header that fits can still draw the pill straight
  // across the controls (it did, at 320px, with `max-width` removed) and an x-coordinate on the pill is the
  // only thing that sees it.
  const churchTid = nodes.findIndex(n => n.type === 'button' && String((n.props || {}).title || '') === 'Your church');
  const rowTid = controlsTid < 0 ? -1 : nodes.findIndex(n => (n.kids || []).some(k => k && k.props && nodes[controlsTid] === k));
  const colTid = churchTid < 0 ? -1 : nodes.findIndex((n, i) => i !== rowTid && (n.kids || []).some(k => k && k.props && nodes[churchTid] === k));
  return { streakTid, controlsTid, churchTid, rowTid, colTid, nodes, html:
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

// The cases. A three-digit streak is a 365-day one and is exactly the case a padding tweak would not survive;
// the long church name is what pins the greeting column's min-content, which is where the bug lived.
const LONG_CHURCH = 'St Bartholomew-the-Great';
// Longer than the 220px the pill is capped at, which `St Bartholomew-the-Great` (191px) is not — without a
// name this long the cap is never reached and `max-width` on that button is unmeasurable either way.
const HUGE_CHURCH = 'The Cathedral Church of Saint Peter and Saint Paul';
const CASES = [];
for (const width of [320, 360, 390, 800]) for (const streak of [7, 365]) CASES.push({ width, streak, churchName: LONG_CHURCH });
CASES.push({ width: 360, streak: 7, churchName: 'Grace' });   // a short name must not regress either
CASES.push({ width: 320, streak: 365, churchName: HUGE_CHURCH });   // the width at which the pill's cap bites
const PAGES = CASES.map(c => todayPage(c));

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
    const ROW = el(${P.rowTid}), COL = el(${P.colTid}), CHURCH = el(${P.churchTid}), CONTROLS = el(${P.controlsTid});
    const DATE = COL && COL.children[0], GREET = COL && COL.children[1];
    const NAME = CHURCH && CHURCH.querySelector('span:last-child');
    // A WORD BROKEN ACROSS TWO LINES REPORTS TWO CLIENT RECTS for its range; an unbroken one reports exactly
    // one. That is how "Wedne / sday" is caught, and it cannot be satisfied by source text.
    const words = e => { if (!e) return []; const n = e.firstChild; if (!n || n.nodeType !== 3) return [];
      const txt = n.textContent, r = document.createRange(); let pos = 0;
      return txt.split(/\\s+/).filter(Boolean).map(w => { const st = txt.indexOf(w, pos); pos = st + w.length;
        r.setStart(n, st); r.setEnd(n, pos); const rc = [...r.getClientRects()];
        return { word: w, lines: rc.length, right: Math.round(Math.max(0, ...rc.map(b => b.right))) }; }); };
    // the width of a lone "…" in the church name's OWN font, so "is anything left of the name?" is asked in
    // the units the browser actually drew it in rather than against a number typed into this file
    let ellipsisW = 0;
    if (NAME) { const cs = getComputedStyle(NAME), p = document.createElement('span');
      p.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:pre';
      p.style.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      p.style.letterSpacing = cs.letterSpacing;
      p.textContent = '\\u2026'; document.body.appendChild(p);
      ellipsisW = Math.ceil(p.getBoundingClientRect().width); p.remove(); }
    return JSON.stringify({ vw: document.documentElement.clientWidth,
      row: box(ROW), col: box(COL), church: box(CHURCH), controls: box(CONTROLS), streak: box(el(${P.streakTid})),
      name: NAME ? { w: Math.round(NAME.getBoundingClientRect().width), full: Math.ceil(NAME.scrollWidth), ellipsisW } : null,
      date: { ...box(DATE), words: words(DATE) }, greet: { ...box(GREET), words: words(GREET) },
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

test('the streak pill is still on the Today screen', () => {
  for (const [i, c] of CASES.entries()) {
    assert.ok(PAGES[i].streakTid >= 0,
      `the reading-streak pill is gone from Today at ${c.width}px — nothing below can measure a control that is not rendered`);
    assert.ok(PAGES[i].controlsTid >= 0, 'the streak pill is no longer inside the header control group — re-anchor this test');
    assert.ok(PAGES[i].churchTid >= 0,
      `the church pill is gone from the Today header at ${c.width}px — it is what sets the greeting column's width, ` +
      'and the overlap assertions below cannot see a button that is not rendered');
    assert.ok(PAGES[i].rowTid >= 0 && PAGES[i].colTid >= 0,
      'the header row / greeting column are no longer shaped as this test anchors them — re-anchor it');
  }
});

for (const [i, c] of CASES.entries()) {
  test(`the whole header row fits a ${c.width}px viewport (streak ${c.streak}, church "${c.churchName}")`,
    { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
    const m = await measure(i);
    assert.equal(m.vw, c.width, 'the page did not lay out at the width under test');

    // THE DEFECT. Measured before the fix at 360/streak 7: x=353 right=408 against vw=360.
    assert.ok(m.streak.right <= m.vw,
      `the reading-streak pill runs off the right edge: it ends at x=${m.streak.right} in a ${m.vw}px viewport ` +
      `(${m.streak.right - m.vw}px past it), so its digit is cut in half. Header row: controls x=${m.controls.x} w=${m.controls.w}.`);
    assert.ok(m.streak.x >= 0, `the reading-streak pill starts off the left edge at x=${m.streak.x}`);

    // Not just the pill: no header control may leave the viewport, and none may sit on top of another.
    assert.equal(m.buttons.length >= 3, true, `the header lost its controls — only ${m.buttons.length} rendered`);
    for (const b of m.buttons) {
      assert.ok(b.x >= 0 && b.right <= m.vw,
        `header control "${b.label}" is outside the ${m.vw}px viewport (x=${b.x} right=${b.right})`);
      assert.ok(b.w > 20, `header control "${b.label}" has been squeezed to ${b.w}px wide`);
    }
    for (let k = 1; k < m.buttons.length; k++) {
      assert.ok(m.buttons[k].x >= m.buttons[k - 1].right,
        `header controls "${m.buttons[k - 1].label}" and "${m.buttons[k].label}" overlap at ${m.vw}px`);
    }

    // The control group must sit inside the row it belongs to, not spill out of it — that spill IS the bug,
    // and at a wide enough viewport the pill can be inside the screen while the row is still broken.
    assert.ok(m.controls.right <= m.vw, `the header control group ends at ${m.controls.right} in a ${m.vw}px viewport`);

    // THE CHURCH PILL IS MEASURED TOO. Everything above reads the streak pill and the four control buttons,
    // and all of it stayed green while the church button laid out at its 191px max-content inside a 61px
    // column and drew straight across the search, bell and streak buttons — that is what an audit found by
    // hand on the previous fix, and nothing in this file could see it. Removing `max-width` from that button
    // today puts the pill 32px off the right edge instead (the HUGE_CHURCH case), which the viewport
    // assertion below catches; the overlap assertion is what stands between the two.
    assert.ok(m.church.x >= 0 && m.church.right <= m.vw,
      `the church pill is outside the ${m.vw}px viewport (${span(m.church)})`);
    assert.ok(!overlaps(m.church, m.controls),
      `the church pill is drawn across the header controls at ${m.vw}px: pill ${span(m.church)}, ` +
      `controls ${span(m.controls)}`);
  });

  test(`nothing in the header is broken or unreadable at ${c.width}px (streak ${c.streak}, church "${c.churchName}")`,
    { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
    const m = await measure(i);
    assert.equal(m.vw, c.width, 'the page did not lay out at the width under test');

    // 1. NO WORD IS BROKEN MID-WORD. `overflow-wrap: anywhere` on the greeting column inherited into both of
    //    these and, at 320px with a long church name and a three-digit streak, produced "Wedne / sday 30 /
    //    Septem / ber" and "Good / mornin / g". A range over one word reports one client rect per line it is
    //    drawn on, so a count above 1 IS the break — no source text is involved.
    for (const [what, line] of [['the date', m.date], ['the greeting', m.greet]]) {
      assert.ok(line.words.length > 0, `${what} rendered no words at ${m.vw}px — re-anchor this test`);
      for (const w of line.words) {
        assert.equal(w.lines, 1,
          `${what} is broken mid-word at ${m.vw}px: "${w.word}" is drawn across ${w.lines} lines ` +
          `(greeting column is ${m.col.w}px wide). Full line: ${line.words.map(x => x.word + '/' + x.lines).join(' ')}`);
        // and it must not solve that by spilling out of its column into the controls instead
        assert.ok(w.right <= m.col.right + 1,
          `${what} spills out of the greeting column at ${m.vw}px: "${w.word}" reaches x=${w.right}, ` +
          `column ends at x=${m.col.right}`);
      }
    }

    // 2. THE CHURCH NAME IS STILL LEGIBLE — not squeezed down to the ellipsis and nothing else. Measured at
    //    320px with the column at 56px: the name span was 14px, which is one "…". The bar is the width of a
    //    lone "…" in that span's own font, so this does not depend on a number typed into this file; a short
    //    name that fits whole is compared against itself instead.
    assert.ok(m.name && m.name.ellipsisW > 0, 'could not measure the church name — re-anchor this test');
    const floor = Math.min(m.name.full, m.name.ellipsisW * 3);
    assert.ok(m.name.w >= floor,
      `the church name is down to ${m.name.w}px at ${m.vw}px — an ellipsis is ${m.name.ellipsisW}px, so that is ` +
      `${(m.name.w / m.name.ellipsisW).toFixed(1)} of one. It needs ${floor}px (full name: ${m.name.full}px).`);

    // 3. THE ROW STAYS A SANE HEIGHT. 87px when it all fits on one line; 120px at 320px, where the controls
    //    drop to a line of their own. It was 169px with the words broken.
    assert.ok(m.row.h <= 132, `the header row is ${m.row.h}px tall at ${m.vw}px (87px on one line, 120px wrapped)`);

    // 3b. AND THE PILL IS NEVER THE THING THAT SETS THE HEADER'S WIDTH. A church whose name is longer than the
    //    cap (the HUGE_CHURCH case) would otherwise lay the button out at its full text width — 284px in the
    //    320px case — because a `white-space: nowrap` run's width is what an inline-flex box shrinks to fit.
    assert.ok(m.church.w <= 221,
      `the church pill is ${m.church.w}px wide at ${m.vw}px — it is capped at 220px so that the name, not the ` +
      'header, is what gets shortened');

    // 4. AND IT ONLY WRAPS WHEN IT HAS TO. The column's floor is a 96px flex-basis; where that plus the 10px
    //    gap plus the controls clearly fits the row, the header must still be ONE line — a floor set too high
    //    would "fix" 320px by wrapping the 390px phone that was never broken. Cases inside 8px of the
    //    boundary are not asserted either way, because which side of it they land on is sub-pixel.
    const sameLine = m.col.y < m.controls.bottom && m.controls.y < m.col.bottom;
    const needed = 96 + 10 + m.controls.w;
    if (needed + 8 <= m.row.w) {
      assert.ok(sameLine,
        `the header wrapped at ${m.vw}px although it fits on one line (needs ${needed}px of ${m.row.w}px): ` +
        `column ${span(m.col)}, controls ${span(m.controls)}`);
      assert.ok(m.row.h <= 95, `the header row is ${m.row.h}px tall at ${m.vw}px although it fits on one line`);
    }

    // 4b. Sharing a line means keeping clear air: the greeting column grows into every pixel the controls do
    //    not use, so the row's `gap` is the ONLY thing between the church name's ellipsis and the search
    //    button. Without it they touch.
    if (sameLine) {
      assert.ok(m.controls.x - m.col.right >= 8,
        `the greeting column runs right up to the header controls at ${m.vw}px: column ends at ${m.col.right}, ` +
        `controls start at ${m.controls.x} — the church name's ellipsis touches the search button`);
    }

    // 5. Wrapped or not, the controls stay against the right-hand edge of the row. `justify-content:
    //    space-between` puts a lone item on the LEFT, so this is `margin-left: auto` doing the work.
    assert.ok(m.controls.right >= m.row.right - 1,
      `the header controls are not against the right edge at ${m.vw}px: controls end at ${m.controls.right}, ` +
      `row ends at ${m.row.right}`);
  });
}
