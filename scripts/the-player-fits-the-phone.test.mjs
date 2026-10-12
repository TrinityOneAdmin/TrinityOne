// THE FLOATING PLAYER FITS THE PHONE AND SITS ABOVE THE TAB BAR, NOT ON IT.
// Run: node --test scripts/the-player-fits-the-phone.test.mjs
//
// Owner decision 2026-10-11: the floating player is THE player — title, timeline, prev / −10 / play / +10 /
// next / speed, and an "Up next" list that opens just above it — and it must stay "a little bigger", not take
// over the screen. The owner's phone is an Oppo at 360 CSS px. This lays out the REAL MiniPlayer next to the
// REAL TabBar (as app.jsx docks them) in a real browser at 320 / 360 / 390 px, in the widest state it has
// (a long title, a queue, the queue OPEN, the "0.75×" pill, and the failure line), and reads rectangles.
//
// HOW IT ASSERTS (rule 3): nothing here matches text in app/*.jsx. app/screens-audio.jsx, app/ui.jsx and
// app/icons.jsx are compiled with the build's esbuild, rendered through the miniature React in
// render-jsx-screen.mjs, serialised to HTML with index.html's own <style> and the app's own fonts (the same
// harness as todays-header-fits-the-phone.test.mjs), and measured with getBoundingClientRect().
//
// Skips itself when chromium is unavailable, as the other browser tests do.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { WebSocket } from 'ws';
import { loadScreen, miniReact, find, compileScreen } from './render-jsx-screen.mjs';
import { requireFreePort } from './test-ports.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const CDP = 9365;   // unique across scripts/*.test.mjs (9354 = todays-header-fits-the-phone)
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── the tree -> HTML (same serialiser as todays-header-fits-the-phone.test.mjs) ──
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
    for (const [k, v] of Object.entries(n.props || {})) {
      if (k === 'children' || k === 'key' || k === 'ref' || v == null || v === false || typeof v === 'function') continue;
      if (k === 'style') { const s = css(v); if (s) attrs.push(`style="${esc(s)}"`); continue; }
      attrs.push(`${SVG_ATTR[k] || (/^[a-z-]+$/.test(k) ? k : kebab(k))}="${esc(v === true ? '' : v)}"`);
    }
    out.push(`<${tag} ${attrs.join(' ')}>`);
    (n.kids || []).forEach(walk);
    if (!VOID.has(tag)) out.push(`</${tag}>`);
  })(node);
  return { html: out.join(''), nodes };
}

// ── the real player and the real tab bar, in the widest state the player has ──
function playerPage() {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const h = {};
  const el = { paused: true, currentTime: 0, duration: 0, defaultPlaybackRate: 1, playbackRate: 1, preload: '',
    addEventListener(t, f) { (h[t] = h[t] || []).push(f); }, setAttribute() {}, src: '', removeAttribute() {}, load() {},
    play() { return Promise.resolve(); }, pause() {} };
  const win = { Bible: { bookName: () => 'John', maxChapter: () => 21 } };
  const store = {};
  const base = { React, window: win, navigator: {}, MediaMetadata: class {}, Icon,
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } },
    document: { createElement: () => el, body: { appendChild() {} } },
    Overlay: () => null, IconBtn: () => null, SectionLabel: () => null, lsGet: (k, d) => d, URL, Blob, console, Promise };
  const audio = loadScreen('app/screens-audio.jsx', ['MiniPlayer'], base);
  const uiWin = { addEventListener() {}, removeEventListener() {} };
  const { TabBar } = loadScreen('app/ui.jsx', ['TabBar'], { React, window: uiWin, Icon, document: { addEventListener() {}, removeEventListener() {} } });
  const A = win.TrinityAudio;
  const long = 'The Good Shepherd lays down his life for the sheep — John 10, an evening sermon';
  const q = [1, 2, 3, 4, 5].map(i => ({ id: 'q' + i, title: (i === 2 ? long : 'Sermon number ' + i + ' with a long enough title to clip'), subtitle: 'St Bartholomew-the-Great', src: 'blob:' + i }));
  A.setRate(0.75);                                  // "0.75×" is the widest pill
  A.play(q[1], q);
  el.currentTime = 3725; el.duration = 7384; (h.durationchange || []).forEach(f => f()); (h.timeupdate || []).forEach(f => f());
  const Dock = () => React.createElement('div', { id: 'dock', style: { position: 'absolute', inset: 0 } },
    React.createElement(audio.MiniPlayer, { ctx: {} }),
    React.createElement(TabBar, { active: 'today', onChange() {} }));
  draw(Dock, {});
  let tree = draw(Dock, {});
  find(tree, n => n.type === 'button' && n.props['aria-label'] === 'Up next')[0].props.onClick();   // open the queue
  tree = draw(Dock, {});
  const { html, nodes } = serialize(tree);
  const tid = pred => nodes.findIndex(pred);
  return {
    region: tid(n => n.props && n.props.role === 'region' && n.props['aria-label'] === 'Audio player'),
    list: tid(n => n.props && n.props.role === 'list' && n.props['aria-label'] === 'Up next'),
    slider: tid(n => n.props && n.props.role === 'slider'),
    tabbar: tid(n => n.props && n.props.style && n.props.style.height === 66 && n.props.style.zIndex === 25),
    html: `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/vendor/fonts/fonts.css">
<style>${[...readFileSync(join(ROOT, 'index.html'), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')}
html,body{margin:0;padding:0} #app{position:relative;width:100%;height:100vh;overflow:hidden}
*{animation:none!important}</style>
<div id="app">${html}</div>` };
}

let chr = null, srv = null, ws = null, send = null, dir = null;
const PAGE = playerPage();

before(async () => {
  if (!CHROME) return;
  await requireFreePort(CDP, 'the-player-fits-the-phone.test.mjs (Chrome debug port)');
  dir = mkdtempSync(join(tmpdir(), 'trin-player-'));
  srv = createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/page.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE.html); }
    if (p === '/live.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(LIVE_HTML); }
    const c = /^\/c\/(app\/[a-z-]+\.jsx)\.js$/.exec(p);
    if (c && LIVE_FILES.includes(c[1])) { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(compileScreen(c[1])); }
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

after(() => { try { ws && ws.close(); } catch {} try { chr && chr.kill('SIGKILL'); } catch {} try { srv && srv.close(); } catch {}
  try { dir && rmSync(dir, { recursive: true, force: true }); } catch {} });

async function measure(width) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 760, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: `http://127.0.0.1:${srv.address().port}/page.html` });
  await sleep(450);
  const expr = `(async () => { try { await document.fonts.ready; } catch (e) {}
    const el = t => document.querySelector('[data-tid="' + t + '"]');
    const box = e => { if (!e) return null; const b = e.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right), bottom: Math.round(b.bottom) }; };
    const R = el(${PAGE.region});
    return JSON.stringify({ vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth,
      region: box(R), list: box(el(${PAGE.list})), slider: box(el(${PAGE.slider})), tabbar: box(el(${PAGE.tabbar})),
      buttons: R ? [...R.querySelectorAll('button')].filter(b => b.getAttribute('role') !== 'listitem').map(b => ({ label: b.getAttribute('aria-label'), ...box(b) })) : [] }); })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  assert.ok(!(r.result && r.result.exceptionDetails), 'the measuring probe threw');
  return JSON.parse(r.result.result.value);
}

test('the player and the tab bar are where this test looks for them', () => {
  assert.ok(PAGE.region >= 0, 'no player region in the tree — re-anchor this test');
  assert.ok(PAGE.list >= 0, 'Up next did not open — re-anchor this test');
  assert.ok(PAGE.slider >= 0, 'no timeline on the player');
  assert.ok(PAGE.tabbar >= 0, 'no tab bar in the tree — re-anchor this test');
});

for (const width of [320, 360, 390]) {
  test(`the player fits a ${width}px phone, keeps its controls on one row, and does not cover the tab bar`,
    { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
    const m = await measure(width);
    assert.equal(m.vw, width, 'the page did not lay out at the width under test');
    assert.ok(m.sw <= width, `the page scrolls sideways: scrollWidth ${m.sw} at ${width}px`);
    assert.ok(m.region.x >= 0 && m.region.right <= width, `the player is outside the ${width}px viewport: x=${m.region.x}..${m.region.right}`);
    assert.ok(m.region.bottom <= m.tabbar.y, `THE PLAYER COVERS THE TAB BAR at ${width}px: player ends at y=${m.region.bottom}, tab bar starts at y=${m.tabbar.y}`);
    assert.ok(m.list.y >= 0 && m.list.bottom <= m.region.bottom, 'the Up next list is not inside the player block above the tab bar');
    const labels = ['Previous track', 'Back 10 seconds', 'Pause', 'Play', 'Forward 10 seconds', 'Next track'];
    const row = m.buttons.filter(b => labels.includes(b.label) || /^Playback speed /.test(b.label || ''));
    assert.equal(row.length, 6, `expected the six controls on the player, found ${JSON.stringify(row.map(b => b.label))}`);
    for (const b of m.buttons) {
      assert.ok(b.x >= 0 && b.right <= width, `"${b.label}" is outside the ${width}px viewport (x=${b.x}..${b.right})`);
      assert.ok(b.right <= m.region.right && b.x >= m.region.x, `"${b.label}" spills out of the player box`);
      assert.ok(b.w >= 28 && b.h >= 28, `"${b.label}" is squeezed to ${b.w}x${b.h}`);
    }
    const mid = b => b.y + b.h / 2;
    for (const b of row) assert.ok(Math.abs(mid(b) - mid(row[0])) <= 2, `the controls row has wrapped at ${width}px: "${b.label}" is on another line`);
    for (let k = 1; k < row.length; k++) assert.ok(row[k].x >= row[k - 1].right, `"${row[k - 1].label}" and "${row[k].label}" overlap at ${width}px`);
    assert.ok(m.slider.w >= 120, `the timeline is only ${m.slider.w}px wide at ${width}px`);
    // "a little bigger": the player block without its open queue stays modest
    const card = m.region.h - (m.list.bottom - m.list.y);
    assert.ok(card <= 150, `the player (queue closed) is ${card}px tall at ${width}px — the owner asked for "a little bigger"`);
  });
}

// ══════════════════ LIVE: THE PAGE UNDER THE PLAYER SCROLLS CLEAR OF IT (audit of e4a17a0, D2) ══════════════════
// The player is ~130px tall (more with Up next open) and floats over the bottom of the page under it, so every
// scrolling page must pad by the player's height or its last rows sit behind it. This half runs the REAL
// app files with the REAL React (vendor/react*.js) in the browser — the player's own effect measures it and
// publishes the height; nothing here sets it — mounts a tab's page with the real MiniPlayer and TabBar over it
// (as app.jsx docks them), starts a track, scrolls the page to the bottom and measures the lowest thing drawn
// on it against the player's top edge. Today and Library (home, and Watch & Listen) all use ScreenScroll.
//
// DEVICE RESULT on 1e0cdbc (Pixel 10 Pro + Oppo): the last Library card was STILL behind the player, while
// this file passed. On a phone the player sits above the tab bar AND the gesture-bar safe-area inset, and this
// page had no inset, so "player height + a fixed tab-bar allowance" happened to fit here and not there. A
// browser cannot be given a real env(safe-area-inset-bottom), so `?safe=N` applies what that inset does to the
// app's own two bottom offsets — `max(12px, env(safe-area-inset-bottom))` becomes N for the tab bar and the
// player's dock — and the cases run with N = 48 at 360x760 and at 412x915 (Pixel-like), as well as N = 0.
const LIVE_FILES = ['app/icons.jsx', 'app/ui.jsx', 'app/screens-today.jsx', 'app/screens-church.jsx', 'app/screens-library.jsx', 'app/screens-watch.jsx', 'app/screens-audio.jsx'];
const LIVE_HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/vendor/fonts/fonts.css">
<style>${[...readFileSync(join(ROOT, 'index.html'), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')}
html,body{margin:0;padding:0} #app{position:relative;width:100%;height:100vh;overflow:hidden} *{animation:none!important}</style>
<div id="app" class="trinity"></div>
<script>
  // emulate a bottom safe-area inset of N px: the tab bar and the player dock both read max(12px, env(...))
  const SAFE = +(new URLSearchParams(location.search).get('safe') || 0);
  if (SAFE) { const st = document.createElement('style');
    st.textContent = '#app > [role="region"][aria-label="Audio player"]{bottom:' + (SAFE + 74) + 'px !important} #app > div:last-child{bottom:' + SAFE + 'px !important}';
    document.head.appendChild(st); }
</script>
<script src="/vendor/react.production.min.js"></script><script src="/vendor/react-dom.production.min.js"></script>
<script src="/engine.js"></script>
<script>
  window.__errors = []; window.addEventListener('error', e => window.__errors.push(String(e.message)));
  const SERMONS = Array.from({ length: 14 }, (_, i) => ({ id: 's' + i, title: 'Sermon number ' + (i + 1), mime: 'audio/mp4', sha256: 'x' + i, hosts: ['h'], contentTs: 1790000000 - i * 604800 }));
  window.Fellowship = { subscribeSermons: (_n, cb) => { cb(SERMONS); return () => {}; }, gatewayBase: () => '', fetchSermon: async () => null,
    subscribeCareRequests: () => () => {}, cancelCareRequest() {}, childCareAudience: async () => [] };
  window.Bible = { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1, activeVersion: 'WEB',
    refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }), getVideos: async () => ({ channel: null, videos: [] }), bookName: () => 'John' };
  window.TrinityData = { NOTIFICATIONS: [], PLANS: [{ id: 'p1', name: 'Plan', days: [{ d: 1, ref: 'John 1' }] }], VOTD_POOL: [{ ref: 'John 3:16', text: 'For God so loved the world.' }], MODULES: ['bibles', 'commentaries', 'dictionaries', 'devotionals', 'books', 'journals'].map(id => ({ id, name: id[0].toUpperCase() + id.slice(1), icon: 'book', accent: 'var(--clay)' })),
    COLLECTIONS: [{ id: 'highlights', name: 'Highlights', icon: 'marker' }, { id: 'notes', name: 'Notes', icon: 'note' }, { id: 'bookmarks', name: 'Bookmarks', icon: 'bookmark' }], JOURNAL: [] };
  window.MyData = { count: () => 0, list: () => [], on: () => () => {}, settings: { get: () => ({}) } };
</script>
${LIVE_FILES.map(f => `<script src="/c/${f}.js"></script>`).join('\n')}
<script>
  const stub = () => null;
  for (const n of ['Sheet', 'Halo', 'ChurchBadge', 'UserAvatar']) if (typeof window[n] === 'undefined') window[n] = stub;
  if (typeof window.lsGet === 'undefined') { window.lsGet = (k, d) => d; window.lsSet = () => {}; }
  if (typeof window.todayISO === 'undefined') window.todayISO = () => new Date().toISOString().slice(0, 10);
  const ctx = { church: { name: 'St Bartholomew-the-Great', initials: 'SB', npub: 'np1', audioFeed: null, channel: '' },
    openChurchSwitcher() {}, openSearch() {}, openNotifications() {}, toggleDark() {}, dark: false, toast() {}, netUnread: 0,
    openServing() {}, openListen() {}, openVideo() {}, planProgress: {}, plans: [], bookmarks: [], notes: {}, highlights: {}, openShareSheet() {} };
  window.__mount = (tab) => {
    const e = React.createElement;
    const Page = tab === 'today' ? TodayScreen : LibraryScreen;   // 'library' = Library home, 'watch' = Library > Watch & Listen
    const Dock = () => e(React.Fragment, null,
      e('div', { id: 'page', style: { position: 'absolute', inset: 0 } }, e(Page, { ctx })),
      e(MiniPlayer, { ctx }), e(TabBar, { active: tab, onChange() {} }));
    ReactDOM.createRoot(document.getElementById('app')).render(e(Dock));
  };
  window.__play = () => {
    const q = Array.from({ length: 6 }, (_, i) => ({ id: 'q' + i, title: 'Track ' + (i + 1), subtitle: 'St Bartholomew-the-Great', src: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=' }));
    window.TrinityAudio.play(q[1], q);
  };
</script>`;

async function live({ w, h, safe }, tab, { queueOpen = false } = {}) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: `http://127.0.0.1:${srv.address().port}/live.html?safe=${safe}` });
  await sleep(600);
  const expr = `(async () => { const wait = ms => new Promise(r => setTimeout(r, ms));
    try { await document.fonts.ready; } catch (e) {}
    __mount(${JSON.stringify(tab)}); await wait(300);
    if (${JSON.stringify(tab)} === 'watch') { const b = [...document.querySelectorAll('#page button')].find(x => /Watch/.test(x.textContent)); if (b) b.click(); await wait(400); }
    __play(); await wait(400);
    if (${queueOpen}) { const u = document.querySelector('[aria-label="Up next"]'); if (u) u.click(); await wait(400); }
    const R = document.querySelector('[role="region"][aria-label="Audio player"]');
    const TB = document.querySelector('#app > div:last-child');
    const sc = [...document.querySelectorAll('#page *')].find(n => getComputedStyle(n).overflowY === 'auto');
    if (sc) { sc.scrollTop = sc.scrollHeight; await wait(250); }
    let low = null, lowBottom = -1;
    if (sc) for (const n of sc.querySelectorAll('*')) { const b = n.getBoundingClientRect(); if (b.height > 0 && b.width > 0 && b.bottom > lowBottom) { lowBottom = b.bottom; low = (n.textContent || n.tagName).trim().slice(0, 50); } }
    return JSON.stringify({ errors: window.__errors, hasPlayer: !!R, playerTop: R ? Math.round(R.getBoundingClientRect().top) : null,
      playerH: R ? Math.round(R.getBoundingClientRect().height) : null, scrolls: !!(sc && sc.scrollHeight > sc.clientHeight), measured: !!sc, lowBottom: Math.round(lowBottom), low,
      watchRows: [...document.querySelectorAll('#page button')].filter(b => /Sermon number/.test(b.textContent)).length,
      tabTop: TB ? Math.round(TB.getBoundingClientRect().top) : null,
      cssVar: getComputedStyle(document.documentElement).getPropertyValue('--trinity-player-h').trim() }); })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  assert.ok(!(r.result && r.result.exceptionDetails), 'the live probe threw: ' + JSON.stringify(r.result && r.result.exceptionDetails || {}).slice(0, 400));
  return JSON.parse(r.result.result.value);
}

const GEOMS = [{ w: 360, h: 760, safe: 0 }, { w: 360, h: 760, safe: 48 }, { w: 412, h: 915, safe: 48 }];
for (const g of GEOMS) for (const [tab, label] of [['today', 'Today'], ['library', 'Library'], ['watch', 'Library > Watch & Listen']]) {
  for (const queueOpen of [false, true]) {
    test(`LIVE ${g.w}x${g.h}, bottom inset ${g.safe}px: with a track playing${queueOpen ? ' and Up next open' : ''}, the bottom of ${label} scrolls clear of the player`,
      { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
      const m = await live(g, tab, { queueOpen });
      assert.deepEqual(m.errors, [], 'the live page threw: ' + m.errors.join(' | '));
      assert.ok(m.hasPlayer, 'the player did not appear after a track was started');
      assert.ok(m.measured && m.lowBottom > 0, `found no page content to measure on ${label}`);
      if (tab === 'watch' || g.h <= 760) assert.ok(m.scrolls, `the ${label} page does not scroll — the fixture is too short to test anything`);
      if (tab === 'watch') assert.ok(m.watchRows >= 10, `Watch & Listen did not open with its sermon list (rows: ${m.watchRows})`);
      // the emulated inset really moved the dock: tab bar bottom edge at h - max(12, safe)
      assert.ok(m.tabTop != null && Math.abs(m.tabTop - (g.h - Math.max(12, g.safe) - 66)) <= 1, `the tab bar is not where a ${g.safe}px inset puts it (top y=${m.tabTop})`);
      assert.ok(m.lowBottom <= m.playerTop,
        `THE BOTTOM OF ${label.toUpperCase()} IS BEHIND THE PLAYER: scrolled to the end, the last thing on the page ("${m.low}") ends at ` +
        `y=${m.lowBottom} and the player (h=${m.playerH}) starts at y=${m.playerTop}. Published --trinity-player-h: ${m.cssVar}`);
    });
  }
}
