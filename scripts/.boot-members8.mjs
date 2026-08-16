// Start three long-lived app instances and onboard each as a member of the church, then LEAVE THEM RUNNING
// so independent actors can take the controls.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const BASE = 'http://127.0.0.1:8000';
const CHURCH = 'npub1n3fpyvu8f6q9slyw07ccr85n6p09muevnncz7qtpwcudcsyunarqtlen0q';
const CAST = [['Grace', 9511], ['Miriam', 9512], ['Esther', 9513], ['Lydia', 9514], ['Joel', 9515], ['Tobias', 9516], ['Martha', 9517], ['Simeon', 9518]];
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const [name, port] of CAST) {
  const profile = mkdtempSync(join(process.env.TRINITY_SCRATCH || '/mnt/storage/tmp/trinity-scratch', 'actor-' + name + '-'));
  spawn('chromium', ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
    '--no-first-run', '--disable-gpu', '--no-sandbox', 'about:blank'], { stdio: 'ignore', detached: true }).unref();
}
await sleep(6000);
for (const [name, port] of CAST) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const t = list.find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  let id = 0;
  const send = (m, p) => new Promise((res, rej) => { const n = ++id;
    const on = d => { const x = JSON.parse(d); if (x.id === n) { ws.off('message', on); x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result); } };
    ws.on('message', on); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
  const ev = async e => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.value;
  await new Promise(r => ws.on('open', r));
  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const tap = async (label) => {
    const box = await ev(`(function(){var all=[].slice.call(document.querySelectorAll('button,a,[role="button"],div,span,label')).filter(function(x){
      var tx=(x.innerText||'').trim();var r=x.getBoundingClientRect();return tx.indexOf(${JSON.stringify(label)})===0&&r.width>25&&r.height>10;});
      if(!all.length)return null;all.sort(function(a,b){return (a.innerText||'').length-(b.innerText||'').length;});
      var e=all[0];e.scrollIntoView({block:'center'});var r=e.getBoundingClientRect();
      return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`);
    if (!box) return false;
    const { x, y } = JSON.parse(box);
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await sleep(60); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(1200); return true;
  };
  await send('Page.navigate', { url: BASE + '/index.html' }); await sleep(6000);
  await ev('(function(){try{localStorage.clear();}catch(e){} return 1;})()');
  await send('Page.navigate', { url: `${BASE}/index.html?follow=${CHURCH}` }); await sleep(15000);
  await tap('I’m new here');
  await ev(`(function(){var i=[].slice.call(document.querySelectorAll('input')).filter(function(x){return (x.placeholder||'').indexOf('Maria')>=0;})[0];
    var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(i,${JSON.stringify(name)});
    i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
  await sleep(500);
  await tap('Continue as ' + name); await sleep(1500);
  await tap('I’ll back these up later'); await sleep(700);
  await tap('Skip anyway'); await tap('Skip'); await sleep(1200);
  await tap('Skip for now'); await sleep(9000);
  const pk = await ev('(window.Fellowship && window.Fellowship.myPubkey) || ""');
  console.log(`  ${name} on port ${port}: ${pk ? pk.slice(0, 12) + '…' : 'NO IDENTITY'}`);
  ws.close();
}
console.log('\n  three instances are live and left running.');
process.exit(0);
