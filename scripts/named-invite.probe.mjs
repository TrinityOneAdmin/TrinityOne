// PROBE (not a test): a church sends a named invite. Does the member arrive named?
//
//   node scripts/named-invite.probe.mjs [baseUrl]      default http://127.0.0.1:8000
//
// WHY. Bulk invite slips carry the person's name (`?name=Deborah`), and migrate.html tells the pastor their
// directory "fills itself in, because everyone arrives already named". If that does not happen, a church that
// prints 200 named slips gets 200 members called Anonymous and someone repairs it by hand.
//
// This drives the real first-run wizard with a named link and reports what name is actually stored.
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

const BASE = process.argv[2] || 'http://127.0.0.1:8000';
const CHURCH = 'npub1' + 'q'.repeat(58);
const WANT = 'Deborah';
const PROFILE = join(tmpdir(), 'namedinvite-' + process.pid + '-' + Date.now());
const PORT = 9397;
const chrome = spawn('chromium', ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--window-size=400,800', '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let ws, id = 0;
const send = (m, p) => new Promise((res, rej) => {
  const n = ++id;
  const on = d => { const x = JSON.parse(d); if (x.id === n) { ws.off('message', on); x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result); } };
  ws.on('message', on); ws.send(JSON.stringify({ id: n, method: m, params: p }));
});
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.value;
const tapText = async (t) => {
  const box = await ev(`(function(){
    var all=[].slice.call(document.querySelectorAll('*')).filter(function(x){
      return x.textContent && x.textContent.trim().indexOf(${JSON.stringify(t)})===0 && x.getBoundingClientRect().width>40;});
    if(!all.length) return null;
    all.sort(function(a,b){return a.textContent.length-b.textContent.length;});
    var e=all[0]; e.scrollIntoView({block:'center'}); var r=e.getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`);
  if (!box) throw new Error('control not found: ' + t);
  const { x, y } = JSON.parse(box);
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(50);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(900);
};

try {
  let t;
  for (let i = 0; i < 40 && !t; i++) { await sleep(300); try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); t = (await r.json()).find(x => x.type === 'page'); } catch {} }
  ws = new WebSocket(t.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise(r => ws.on('open', r));
  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  // exactly what join.html hands the app for a named slip
  await send('Page.navigate', { url: `${BASE}/index.html?follow=${CHURCH}&name=${encodeURIComponent(WANT)}` });
  await sleep(17000);

  await tapText('I’m new here');
  await sleep(1200);
  const box = await ev(`(function(){var i=document.querySelector('input[placeholder*="Maria"]');
    return JSON.stringify({ present: !!i, value: i ? i.value : null });})()`);
  console.log('  the name box when they arrive: ' + box);

  const cta = await ev(`(function(){var b=[].slice.call(document.querySelectorAll('button'))
    .filter(function(x){return /^Continue/.test(x.textContent.trim());})[0];
    return b ? b.textContent.trim() : '(no continue button)';})()`);
  console.log('  what the button offers:        ' + JSON.stringify(cta));

  console.log('  ');
  console.log('  A named slip said "' + WANT + '". If the box is empty and the button says "Continue without a');
  console.log('  name", the member has to type a name nobody asked them for — and the steward gets Anonymous.');
} finally { try { ws && ws.close(); } catch {} chrome.kill(); }
