// PROBE (not a test): on a small phone-sized screen, can a member actually reach the control that lets them
// past the 12-word backup step?
//
//   node scripts/backup-gate.probe.mjs [baseUrl]     default http://127.0.0.1:8000
//
// WHY. The backup step gates "Continue" on a tick box reading "I've written down my 12 words and stored them
// somewhere safe." The tick box used to live in the SCROLLING body while the buttons sit in a PINNED footer,
// so at 360x730 it laid out past the bottom of the scroll area. What a member saw was a Continue button that
// did nothing — disabled, but drawn at full opacity with no tooltip, no message, nothing greyed — and
// directly beneath it, fully visible, "I'll back these up later".
//
// document.elementFromPoint at the tick box's own centre returned the SKIP button, and tapping there skipped
// the backup. So the safe path was invisible and the tap that reached for it took the unsafe one. Present
// since 2026-06-19; missed by a browser audit that tested tall viewports, found on a phone.
//
// Losing the 12 words means losing the account permanently — nobody can reset it. This probe exists so the
// control that prevents that can never drift out of reach again.
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

const BASE = process.argv[2] || 'http://127.0.0.1:8000';
const PROFILE = join(tmpdir(), 'backupgate-' + process.pid + '-' + Date.now());
const PORT = 9395;
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
const tapAt = async (x, y) => {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(50);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(700);
};
const tapText = async (t) => {
  // Not every tappable thing in this app is a <button> — the welcome choices are styled divs. Take the
  // SMALLEST element whose text starts with the label, which is the one a finger would land on.
  const box = await ev(`(function(){
    var all=[].slice.call(document.querySelectorAll('*')).filter(function(x){
      return x.textContent && x.textContent.trim().indexOf(${JSON.stringify(t)})===0 && x.getBoundingClientRect().width>40;});
    if(!all.length) return null;
    all.sort(function(a,b){return (a.textContent.length-b.textContent.length);});
    var e=all[0]; e.scrollIntoView({block:'center'}); var r=e.getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`);
  if (!box) {
    const seen = await ev('document.body.innerText.replace(/\\n+/g," | ").slice(0,220)');
    throw new Error('control not found: ' + t + '\n  what is on screen: ' + seen);
  }
  const { x, y } = JSON.parse(box);
  await tapAt(x, y);
};

try {
  let t;
  for (let i = 0; i < 40 && !t; i++) { await sleep(300); try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); t = (await r.json()).find(x => x.type === 'page'); } catch {} }
  ws = new WebSocket(t.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise(r => ws.on('open', r));
  await send('Page.enable', {}); await send('Runtime.enable', {});
  // A phone, not a laptop window. The whole defect is that the tick box falls past the bottom on a short screen.
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 730, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url: BASE + '/index.html' });
  // The dev shell transpiles ~30 .jsx files with in-browser Babel on every launch and takes ~9.5s to paint.
  // What ships is pre-transpiled and boots in well under a second — this wait is a property of the harness.
  await sleep(17000);

  await tapText('I’m new here');
  await ev(`(function(){var i=document.querySelector('input[placeholder*="Maria"]');
    if(i){var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    s.call(i,'Ruth');i.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
  await sleep(600);
  await tapText('Continue as');
  await sleep(2500);

  const report = await ev(`(function(){
    var cb=document.querySelector('input[type=checkbox]');
    if(!cb) return JSON.stringify({error:'no tick box on the backup step'});
    var r=cb.getBoundingClientRect();
    var cx=Math.round(r.left+r.width/2), cy=Math.round(r.top+r.height/2);
    var hit=document.elementFromPoint(cx,cy);
    var cont=[].slice.call(document.querySelectorAll('button')).filter(function(b){return b.textContent.trim()==='Continue';})[0];
    return JSON.stringify({
      onScreen: r.top>=0 && r.bottom<=window.innerHeight,
      top: Math.round(r.top), viewportH: window.innerHeight,
      tapAtItHits: hit ? (hit===cb ? 'the tick box' : hit.tagName+' "'+(hit.textContent||'').trim().slice(0,34)+'"') : 'nothing',
      continueDisabled: cont ? cont.disabled : null, point:[cx,cy]});
  })()`);
  const r = JSON.parse(report);
  console.log('  BEFORE TICKING: ' + JSON.stringify(r));

  if (r.point) {
    await tapAt(r.point[0], r.point[1]);
    const after = await ev(`(function(){
      var cb=document.querySelector('input[type=checkbox]');
      var cont=[].slice.call(document.querySelectorAll('button')).filter(function(b){return b.textContent.trim()==='Continue';})[0];
      return JSON.stringify({ stillOnBackupStep: !!cb, ticked: cb?cb.checked:null, continueDisabled: cont?cont.disabled:null,
        heading:(document.querySelector('h1')||{}).textContent||'' });})()`);
    console.log('  AFTER TAPPING IT: ' + after);
  }
} finally { try { ws && ws.close(); } catch {} chrome.kill(); }
