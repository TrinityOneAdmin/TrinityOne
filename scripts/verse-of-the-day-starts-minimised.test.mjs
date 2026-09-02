// THE VERSE OF THE DAY STARTS MINIMISED — AND NOBODY'S EXISTING CHOICE IS DISCARDED.
// Run: node --test scripts/verse-of-the-day-starts-minimised.test.mjs
//
// Owner, 2026-09-01: a member should meet the compact bar and tap to open the verse, not be greeted by the
// full card. The minimise machinery already existed (app/screens-today.jsx has had the compact bar and the
// persisted preference for some time); only the INITIAL state changed.
//
// WHAT MAKES THIS MORE THAN A ONE-CHARACTER FLIP. The stored key has THREE states, and they are only worth
// having if the screen tells them apart:
//
//     localStorage['trinityone.votd-min']
//       absent   -> never touched it        -> the NEW default: minimised
//       '0'      -> tapped it open          -> expanded, on every later launch, default or no default
//       '1'      -> tapped it shut          -> minimised
//
// The old read was `=== '1'` (default expanded). Reading it as `!== '1'` would have been the lazy flip and
// would have TRAMPLED the middle row — every member who had ever deliberately opened the card would have
// found it shut again and stayed shut. `!== '0'` moves only the absent case, which is the one the owner
// asked to move. The absent case is genuinely distinguishable because `toggleVotd` has always written '0'
// on the way open, not removed the key. All three rows are asserted below, and so is the write that keeps
// the middle row distinguishable in the first place — without it the distinction decays to nothing on the
// next launch.
//
// HOW IT ASSERTS, and why not more cheaply. CLAUDE.md rule 3: app/screens-today.jsx ships UNBUNDLED, so
// `false && ` in front of a condition leaves every word of it in place and a text-matching assertion still
// passes. Nothing here matches text in app/*.jsx. The REAL TodayScreen is compiled with the same esbuild the
// build uses and rendered through the miniature React in scripts/render-jsx-screen.mjs, once per stored
// value; every assertion reads the tree that came back, or — for the touch target — a rectangle measured by
// a real browser at a real device width with the app's own fonts and stylesheet.
//
// MEASURED RED/GREEN, 2026-09-01, this file against app/screens-today.jsx. Each anchor was sliced out of
// TodayScreen and verified to occur EXACTLY ONCE inside that function before the edit, per CLAUDE.md
// "sabotage must be scoped" — a plain string-replace in this file hits a near-identical sibling. The bar and
// card deletions are `null && <the whole original JSX>`, which leaves every word of the screen in place: a
// test that matched source text would stay green over all three of them (CLAUDE.md rule 3).
//
//   · the fixed screen                                              8 pass / 0 fail
//   · the initial state reverted to `=== '1'` (the old default)     2 pass / 6 fail
//   · the lazy flip `!== '1'` instead of `!== '0'`                  5 pass / 3 fail  (the previously-EXPANDED
//                                                                                    member is trampled)
//   · toggleVotd's setItem call deleted                             7 pass / 1 fail  ('chose expanded' can
//                                                                                    never be recorded)
//   · the compact bar deleted from the screen                       1 pass / 7 fail
//   · the expanded card deleted from the screen                     6 pass / 2 fail
//   · minHeight removed from the bar                                5 pass / 3 fail  (it measures 40px)
//   · aria-label removed from the bar                               1 pass / 7 fail
//
// The browser case skips itself (rather than failing) when chromium is unavailable, so CI without a browser
// stays green — same contract as scripts/app-boots.test.mjs and scripts/todays-header-fits-the-phone.test.mjs.
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
const CDP = 9355;   // 9350-9352 = app-boots / restore-storm / restore-routes, 9354 = todays-header-fits-the-phone
const sleep = ms => new Promise(r => setTimeout(r, ms));

const VERSE = 'For God so loved the world, that he gave his one and only Son.';
const REF = 'John 3:16';
const KEY = 'trinityone.votd-min';

// ── the tree -> HTML, so a browser can lay out what the screen actually built ──────────────────────────────
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

// ── the real screen, with ONE stored value ────────────────────────────────────────────────────────────────
// Everything TodayScreen takes from OUTSIDE its own file. A name it needs that is not here is a
// ReferenceError at the point of use — deliberately, because a silently-stubbed global is how a test ends up
// asserting about something that is not the code. `Icon` is the REAL one (it draws the chevron and the
// sparkle inside the bar, and sets the bar's content height); the stubs are furniture elsewhere on Today.
const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

function todayScreen(stored) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const { ChurchBadge } = loadScreen('app/screens-church.jsx', ['ChurchBadge'],
    { React, window: {}, safeCssColor: (c, d) => d, safeImgUrl: () => '' });
  const date = new Date('2026-09-30T09:00:00Z');
  // A REAL little store, not a returns-null stub: the whole point of the middle row above is that a member
  // who taps the bar open is RECORDED as having chosen expanded, and a stub that swallowed writes could not
  // tell a screen that persists the choice from one that does not.
  const store = new Map();
  if (stored != null) store.set(KEY, stored);
  const writes = [];
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem(k, v) { store.set(k, String(v)); writes.push([k, String(v)]); },
    removeItem(k) { store.delete(k); writes.push([k, null]); },
  };
  const win = {
    addEventListener() {}, removeEventListener() {}, innerWidth: 360, localStorage,
    Fellowship: { subscribeCareRequests: () => () => {}, cancelCareRequest() {}, childCareAudience: async () => [] },
    ChurchBadge,
    TrinityData: { NOTIFICATIONS: [], PLANS: [{ id: 'p1', name: 'Plan', days: [{ d: 1, ref: 'John 1' }] }],
      VOTD_POOL: [{ ref: REF, text: VERSE }] },
    Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1,
      activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }) },
  };
  const globals = {
    React, window: win, localStorage,
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    Icon, ChurchBadge,
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
    church: { name: 'Grace', initials: 'SB', npub: 'np1' },
    openChurchSwitcher() {}, openSearch() {}, openNotifications() {}, toggleDark() {}, dark: false,
    toast() {}, netUnread: 0, openServing() {}, openListen() {}, openShareSheet() {},
    planProgress: {}, plans: [], bookmarks: [], notes: {}, highlights: {},
  };
  return { draw: () => draw(TodayScreen, { ctx }), writes, store };
}

// ── what the member can see, read off the RENDERED tree ───────────────────────────────────────────────────
// The compact bar is found by the accessible name the screen puts on it — the same string a screen reader
// announces — and the expanded card by the VERSE ITSELF being on the screen. Delete either from the screen
// and the corresponding number below goes to zero.
const openControls = tree => find(tree, n => /^show the verse of the day\b/i.test(String((n.props || {})['aria-label'] || '')));
const verseOnScreen = tree => texts(tree).filter(t => t.includes(VERSE)).length;
const minimiseControls = tree => find(tree, n => n.type === 'button' && String((n.props || {})['aria-label'] || '').toLowerCase() === 'minimise');

function state(stored) {
  const s = todayScreen(stored);
  const tree = s.draw();
  return { ...s, tree, open: openControls(tree), verse: verseOnScreen(tree), min: minimiseControls(tree) };
}

test('a member who has never touched it meets the COMPACT BAR, not the verse', () => {
  const s = state(null);
  assert.equal(s.verse, 0,
    `Today greets a brand-new member with the full verse card: the verse text is on the screen ${s.verse} time(s) ` +
    `with no stored preference. The owner asked for the compact bar by default (2026-09-01).`);
  assert.equal(s.open.length, 1,
    `no control to open the verse of the day is on Today for a member with no stored preference — ` +
    `found ${s.open.length}. The compact bar IS the only way to read the verse now, so this is not cosmetic.`);
});

test('a member who previously chose EXPANDED still gets the verse — the new default does not outrank them', () => {
  const s = state('0');
  assert.equal(s.verse, 1,
    `a member who had deliberately opened the verse card (stored '0') is shut again by the new default — ` +
    `the verse is on their screen ${s.verse} times. Their choice must outrank the default on every later launch.`);
  assert.equal(s.open.length, 0, 'the compact bar is rendered alongside the expanded card — both states at once');
  assert.equal(s.min.length, 1, 'the expanded card has no minimise control, so that member could never shut it again');
});

test('a member who previously chose MINIMISED stays minimised', () => {
  const s = state('1');
  assert.equal(s.verse, 0, `a member who had shut the verse card (stored '1') has it opened again for them`);
  assert.equal(s.open.length, 1, 'the compact bar is missing for a member who chose it');
});

test('tapping the bar opens the verse AND records the choice, so it survives the next launch', () => {
  const s = todayScreen(null);
  let tree = s.draw();
  const bar = openControls(tree);
  assert.equal(bar.length, 1, 'no bar to tap — nothing below can drive a control that is not on the screen');
  assert.equal(typeof bar[0].props.onClick, 'function', 'the compact bar has no tap handler, so it cannot be opened at all');
  bar[0].props.onClick({ stopPropagation() {} });

  tree = s.draw();
  assert.equal(verseOnScreen(tree), 1, 'tapping the compact bar did not put the verse on the screen');
  assert.equal(openControls(tree).length, 0, 'the compact bar is still on the screen after being tapped open');
  // THE WRITE IS THE WHOLE BASIS OF THE THREE-WAY DISTINCTION. Without a recorded '0' this member is
  // indistinguishable from one who never touched it, and the new default shuts them again next launch.
  assert.equal(s.store.get(KEY), '0',
    `opening the verse stored ${JSON.stringify(s.store.get(KEY))} under ${KEY}, not '0'. Absent and '0' are how ` +
    `"never touched it" and "chose expanded" are told apart, so a member's choice is lost on the next launch.`);
  // and prove it: a fresh screen reading exactly what was stored keeps the verse open
  assert.equal(state(s.store.get(KEY)).verse, 1, 'what the tap stored does not reopen the verse on the next launch');

  // and the round trip back — the minimise control shuts it and records '1'
  const mn = minimiseControls(tree);
  assert.equal(mn.length, 1, 'the expanded card has no minimise control');
  mn[0].props.onClick({ stopPropagation() {} });
  tree = s.draw();
  assert.equal(verseOnScreen(tree), 0, 'minimising did not take the verse off the screen');
  assert.equal(openControls(tree).length, 1, 'minimising left no bar to reopen the verse with');
  assert.equal(s.store.get(KEY), '1', `minimising stored ${JSON.stringify(s.store.get(KEY))} under ${KEY}, not '1'`);
});

test('the bar says what it does — it has an accessible name that names the verse', () => {
  const s = state(null);
  assert.equal(s.open.length, 1, 'no open control on the screen');
  const label = String(s.open[0].props['aria-label']);
  assert.ok(/verse of the day/i.test(label), `the bar's accessible name does not mention the verse: ${JSON.stringify(label)}`);
  assert.ok(label.includes(REF),
    `the bar's accessible name does not name the reference, so a screen-reader user cannot tell WHICH verse ` +
    `is behind it: ${JSON.stringify(label)}`);
  assert.equal(s.open[0].type, 'button',
    `the only way to reach the verse is a <${s.open[0].type}>, not a button — it is not focusable and does ` +
    `not answer the keyboard or an accessibility service`);
});

// ── the touch target, measured in a real browser ───────────────────────────────────────────────────────────
// A 40px-tall bar is what a bare `padding: 11px` gives, and it was fine while the bar was an optional
// shortcut back to a card that opened by itself. It is now the ONLY route to the verse, so it is measured:
// 44px is the floor both Apple's and Google's guidance put on a target a thumb has to find.
const WIDTHS = [320, 360, 390];
let chr = null, srv = null, ws = null, send = null, dir = null, PAGE = null;

before(async () => {
  const { tree } = state(null);
  const { html, nodes } = serialize(tree);
  const barTid = nodes.findIndex(n => /^show the verse of the day\b/i.test(String((n.props || {})['aria-label'] || '')));
  PAGE = { barTid, html:
`<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/vendor/fonts/fonts.css">
<style>${[...readFileSync(join(ROOT, 'index.html'), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')}
html,body{margin:0;padding:0} #app{position:relative;width:100%;height:100vh;overflow:hidden}</style>
<div id="app">${html}</div>` };
  if (!CHROME) return;
  await requireFreePort(CDP, 'verse-of-the-day-starts-minimised.test.mjs (Chrome debug port)');
  dir = mkdtempSync(join(tmpdir(), 'trin-votd-'));
  srv = createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/page.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE.html); }
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

for (const width of WIDTHS) {
  test(`the bar is a real touch target at ${width}px`, { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
    assert.ok(PAGE.barTid >= 0, 'the compact bar is not in the rendered tree — nothing can be measured');
    await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: true });
    await send('Page.navigate', { url: `http://127.0.0.1:${srv.address().port}/page.html` });
    await sleep(450);
    const expr = `(async () => { try { await document.fonts.ready; } catch (e) {}
      const e = document.querySelector('[data-tid="${PAGE.barTid}"]');
      if (!e) return JSON.stringify({ missing: true });
      const b = e.getBoundingClientRect();
      return JSON.stringify({ vw: document.documentElement.clientWidth, tag: e.tagName.toLowerCase(),
        label: e.getAttribute('aria-label') || '', disabled: e.disabled === true,
        x: Math.round(b.x), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right) }); })()`;
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    assert.ok(!(r.result && r.result.exceptionDetails), 'the measuring probe threw: ' + JSON.stringify(r.result || {}).slice(0, 300));
    const m = JSON.parse(r.result.result.value);
    assert.ok(!m.missing, 'the compact bar did not reach the page');
    assert.equal(m.vw, width, 'the page did not lay out at the width under test');
    assert.ok(m.h >= 44,
      `the only control that opens the verse is ${m.h}px tall at ${width}px — under the 44px a thumb needs`);
    assert.ok(m.x >= 0 && m.right <= m.vw,
      `the bar is outside the ${m.vw}px viewport (x=${m.x} right=${m.right})`);
    assert.ok(m.w >= m.vw * 0.5,
      `the bar is only ${m.w}px wide in a ${m.vw}px viewport — it should span the card column like the card it replaces`);
    assert.equal(m.disabled, false, 'the bar is rendered disabled, so the verse cannot be opened at all');
    assert.ok(/verse of the day/i.test(m.label), `the bar reached the page without its accessible name: ${JSON.stringify(m.label)}`);
  });
}
