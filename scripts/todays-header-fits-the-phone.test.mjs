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
// at "7" and 74px at "365" — both measured here). Hence this test sweeps four widths and both streak widths.
//
// HOW IT ASSERTS, and why not more cheaply. CLAUDE.md rule 3: app/screens-today.jsx ships UNBUNDLED, so
// `false && ` in front of a condition leaves every word of it in place and a text-matching assertion still
// passes. Nothing here matches text in app/*.jsx. The REAL TodayScreen is compiled with the same esbuild the
// build uses and rendered through the miniature React in scripts/render-jsx-screen.mjs; the tree that comes
// back is serialised to HTML, dressed in index.html's OWN <style> block and the app's OWN Sora files, and
// laid out by a real browser at a real device width. Every assertion reads getBoundingClientRect(). Delete
// the streak pill from the screen and `streakTid` is -1 and this file goes red; put the overflow back and the
// geometry assertions go red. Neither can be satisfied by source text.
//
// Sora matters: the pill measured 56px wide here and 56px on the handset. A fallback face would be measuring
// a different screen from the one that ships, so the fonts are served, and the probe waits on document.fonts.
//
// MEASURED RED/GREEN, 2026-09-01, this file against app/screens-today.jsx:
//   · fixed screen                       10 pass / 0 fail
//   · header row reverted to HEAD~        4 pass / 6 fail — every case at 320, 360 and 390 goes red
//   · streak pill deleted from the screen 0 pass / 10 fail  (scoped slice of TodayScreen; the anchor
//     `<button title={`${streak}-day reading streak`}` occurs exactly once in the file)
//
// Two of the ten passed against the UNFIXED screen, and both are worth keeping rather than tuning away:
// 800px genuinely fitted, and so did a church called "Grace" at 360px. That is the honest shape of the bug —
// it is the church NAME that sets the greeting column's min-content, so a short-named church never saw it.
// Which is very likely why it shipped.
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
  return { streakTid, controlsTid, nodes, html:
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
const CASES = [];
for (const width of [320, 360, 390, 800]) for (const streak of [7, 365]) CASES.push({ width, streak, churchName: LONG_CHURCH });
CASES.push({ width: 360, streak: 7, churchName: 'Grace' });   // a short name must not regress either
const PAGES = CASES.map(c => todayPage(c));

async function rects(i) {
  await send('Emulation.setDeviceMetricsOverride', { width: CASES[i].width, height: 800, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: `http://127.0.0.1:${srv.address().port}/page${i}.html` });
  await sleep(450);
  const expr = `(async () => { try { await document.fonts.ready; } catch (e) {}
    const box = t => { const e = document.querySelector('[data-tid="' + t + '"]'); if (!e) return null;
      const b = e.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width), right: Math.round(b.right) }; };
    return JSON.stringify({ vw: document.documentElement.clientWidth,
      streak: box(${PAGES[i].streakTid}), controls: box(${PAGES[i].controlsTid}),
      buttons: [...document.querySelectorAll('[data-tid="${PAGES[i].controlsTid}"] > button')]
        .map(e => { const b = e.getBoundingClientRect(); return { label: e.getAttribute('aria-label') || e.getAttribute('title') || '',
          x: Math.round(b.x), right: Math.round(b.right), w: Math.round(b.width) }; }) }); })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  const thrown = r.result && r.result.exceptionDetails;
  assert.ok(!thrown, 'the measuring probe threw: ' + JSON.stringify(thrown || {}).slice(0, 300));
  return JSON.parse(r.result.result.value);
}

test('the streak pill is still on the Today screen', () => {
  for (const [i, c] of CASES.entries()) {
    assert.ok(PAGES[i].streakTid >= 0,
      `the reading-streak pill is gone from Today at ${c.width}px — nothing below can measure a control that is not rendered`);
    assert.ok(PAGES[i].controlsTid >= 0, 'the streak pill is no longer inside the header control group — re-anchor this test');
  }
});

for (const [i, c] of CASES.entries()) {
  test(`the whole header row fits a ${c.width}px viewport (streak ${c.streak}, church "${c.churchName}")`,
    { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
    const m = await rects(i);
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
  });
}
