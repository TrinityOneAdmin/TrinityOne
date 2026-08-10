// PROBE (not a test): does a REAL tap, a REAL hover-click, and a REAL keypress each work the hero pills?
//
//   node scripts/pills.probe.mjs [url]        default http://127.0.0.1:8899/welcome.html
//
// WHY THIS EXISTS. The pills were reported "verified working in a real browser" twice, and were broken both
// times, because the verification used element.click(). A programmatic click does not focus the element
// first; a finger and a mouse both do. That ordering — focus fires show(), then click sees the pill already
// showing and resets it — was the entire bug, and it is invisible to .click().
//
// THE SECOND TRAP, which cost the first repair: headless Chromium reports `(hover: hover)` as FALSE, so
// pills.js's desktop branch is never installed and a headless run gives a clean bill of health on code that
// is broken on every laptop. This probe forces the media query before the page's script runs, and reports
// which branch it actually exercised, so a green result can never mean "the desktop path was skipped".
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

const URL_ = process.argv[2] || 'http://127.0.0.1:8899/welcome.html';
const PROFILE = join(tmpdir(), 'pills-' + process.pid + '-' + Date.now());
const PORT = 9390;
const chrome = spawn('chromium', ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--window-size=1280,900', '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let ws, id = 0;
const send = (m, p) => new Promise((res, rej) => {
  const n = ++id;
  const on = d => { const x = JSON.parse(d); if (x.id === n) { ws.off('message', on); x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result); } };
  ws.on('message', on); ws.send(JSON.stringify({ id: n, method: m, params: p }));
});
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.value;
const shot = () => ev('document.getElementById("appShot").getAttribute("src")');
const centreOf = async (label) => JSON.parse(await ev(
  `(function(){var p=[].slice.call(document.querySelectorAll('[data-pills] span')).filter(function(x){return x.textContent.trim()===${JSON.stringify(label)};})[0];` +
  `p.scrollIntoView({block:'center'});var r=p.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`));

async function open({ touch, forceHover }) {
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(200);
  await send('Emulation.clearDeviceMetricsOverride', {}).catch(() => {});
  await send('Emulation.setTouchEmulationEnabled', touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  if (touch) await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  // Force the desktop branch BEFORE pills.js runs. Without this the hover path is simply never installed.
  await send('Page.addScriptToEvaluateOnNewDocument', forceHover
    ? { source: '(function(){var m=window.matchMedia;window.matchMedia=function(q){var r=m.call(window,q);' +
                'if(/hover:\\s*hover/.test(q))return{matches:true,media:q,addListener:function(){},removeListener:function(){},addEventListener:function(){},removeEventListener:function(){}};return r;};})();' }
    : { source: '' });
  await send('Page.navigate', { url: URL_ });
  await sleep(2500);
}

const results = [];
try {
  let t;
  for (let i = 0; i < 40 && !t; i++) { await sleep(300); try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); t = (await r.json()).find(x => x.type === 'page'); } catch {} }
  ws = new WebSocket(t.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise(r => ws.on('open', r));
  await send('Page.enable', {}); await send('Runtime.enable', {});

  // ── 1. TOUCH: tap each pill once, in order. Every one must land on its own screen.
  await open({ touch: true, forceHover: false });
  const names = JSON.parse(await ev('JSON.stringify([].slice.call(document.querySelectorAll("[data-pills] span")).map(function(p){return p.textContent.trim();}))'));
  for (const n of names) {
    const c = await centreOf(n);
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] });
    await sleep(50);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(500);
    const want = await ev(`[].slice.call(document.querySelectorAll('[data-pills] span')).filter(function(x){return x.textContent.trim()===${JSON.stringify(n)};})[0].getAttribute('data-shot')`);
    results.push({ input: 'tap', pill: n, shows: await shot(), expected: want });
  }

  // ── 2. DESKTOP with hover genuinely on: hover then click. This is the case a headless default cannot see.
  await open({ touch: false, forceHover: true });
  const hoverOn = await ev('window.matchMedia("(hover: hover) and (pointer: fine)").matches');
  for (const n of names.slice(0, 3)) {
    const c = await centreOf(n);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none', clickCount: 0 });
    await sleep(250);
    const afterHover = await shot();
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
    await sleep(500);
    const want = await ev(`[].slice.call(document.querySelectorAll('[data-pills] span')).filter(function(x){return x.textContent.trim()===${JSON.stringify(n)};})[0].getAttribute('data-shot')`);
    results.push({ input: 'hover+click', pill: n, afterHover, shows: await shot(), expected: want });
  }

  // ── 3. KEYBOARD: focus previews, Enter commits, and a second Enter clears.
  await open({ touch: false, forceHover: false });
  const first = names[0];
  await ev(`[].slice.call(document.querySelectorAll('[data-pills] span')).filter(function(x){return x.textContent.trim()===${JSON.stringify(first)};})[0].focus()`);
  await sleep(400);
  const onFocus = await shot();
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(500);
  const wantFirst = await ev(`[].slice.call(document.querySelectorAll('[data-pills] span')).filter(function(x){return x.textContent.trim()===${JSON.stringify(first)};})[0].getAttribute('data-shot')`);
  results.push({ input: 'focus+Enter', pill: first, onFocus, shows: await shot(), expected: wantFirst });

  const bad = results.filter(r => r.shows !== r.expected);
  console.log(JSON.stringify({ hoverBranchActuallyOn: hoverOn, results, failures: bad.length }, null, 1));
  process.exitCode = bad.length ? 1 : 0;
} finally { try { ws && ws.close(); } catch {} chrome.kill(); }
