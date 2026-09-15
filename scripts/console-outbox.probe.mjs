// PROBE (not a test): does the console's outbox give up, and does a steward SEE a waiting message?
// Usage: node scripts/console-outbox.probe.mjs
//
// Audit items 4 and 9, 2026-09-14. Run against the REAL console bundle in a REAL browser, on an origin with
// no usable relay — so every publish fails and the outbox is exercised for real. Nothing is stubbed.
//   item 9: a message that has been GIVEN UP ON must not go back on the wire. Signature: `tries` climbing
//           past 8 on an item already marked failed.
//   item 4: a steward must be able to SEE a message that is waiting. Signature: the words on screen.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';

const ROOT = normalize(join(new URL('..', import.meta.url).pathname));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.jsx':'text/babel', '.css':'text/css',
                '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
const CHROME = ['/usr/bin/chromium-browser','/usr/bin/chromium','/usr/bin/google-chrome'].find(p => existsSync(p));
if (!CHROME) { console.log('no chromium'); process.exit(1); }
const freePort = async () => { const s = createServer(); await new Promise(r => s.listen(0,'127.0.0.1',r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; };

const port = await freePort(), cdp = await freePort();
const srv = createServer((req,res) => {
  const p = normalize(join(ROOT, decodeURIComponent(String(req.url).split('?')[0])));
  if (!p.startsWith(ROOT) || !existsSync(p) || !extname(p)) { res.writeHead(404); res.end('not here'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p));
});
await new Promise(r => srv.listen(port,'127.0.0.1',r));
const prof = mkdtempSync(join(tmpdir(),'trin-outbox-'));
const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
const chr = spawn(CHROME, ['--headless=new',`--remote-debugging-port=${cdp}`,'--no-sandbox','--disable-gpu',
  BLOCK_PROD,`--user-data-dir=${prof}`,'--window-size=1280,1200',`http://127.0.0.1:${port}/steward.html`], { stdio:'ignore' });

let ws = null;
try {
  let targets = null;
  for (let i=0;i<40 && !targets;i++){ await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
  const page = targets.find(t=>t.type==='page') || targets[0];
  ws = new WebSocket(page.webSocketDebuggerUrl,{ perMessageDeflate:false, maxPayload:5e8 });
  await new Promise((res,rej)=>{ ws.on('open',res); ws.on('error',rej); });
  let id=0; const pend=new Map();
  ws.on('message', d => { const m=JSON.parse(d); if(m.id&&pend.has(m.id)){pend.get(m.id)(m); pend.delete(m.id);} });
  const send=(method,params={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method,params}))});
  await send('Runtime.enable');
  const ev = async (expression) => { const rr = await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    return rr && rr.result && rr.result.result ? rr.result.result.value : undefined; };
  await sleep(9000);

  const click = re => `(()=>{const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim()));if(b){b.click();return 'ok'}return 'miss'})()`;
  const type = (ph,val) => `(()=>{const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(ph)}));if(!i)return 'miss';
    const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(i,${JSON.stringify(val)});i.dispatchEvent(new Event('input',{bubbles:true}));return 'ok'})()`;
  console.log('new church  :', await ev(click('/Start a new church/i')));
  await sleep(2500);
  await ev(type('At least 8','cedar-harbour-lamp-42'));
  await ev(type('Type it again','cedar-harbour-lamp-42'));
  console.log('set PIN     :', await ev(click('/Set PIN/i')));
  await sleep(13000);
  console.log('console pub :', await ev(`(window.Steward&&window.Steward.pubkey||'').slice(0,12)`));

  // ── a DM that cannot be delivered (no relay can be proved on this origin) ──────────────────────────────
  const PEER = 'ab'.repeat(32);
  console.log('sendDM      :', await ev(`(async()=>{try{const e=await window.Steward.sendDM(${JSON.stringify(PEER)},'Can you call me back about Sunday?');return e?'returned an event':'returned null'}catch(x){return 'threw: '+x}})()`));
  await sleep(2500);
  console.log('outbox      :', await ev(`JSON.stringify((window.Steward.outboxForPeer(${JSON.stringify(PEER)})||[]).map(o=>({pending:o._pending,failed:o._failed,tries:o._tries,plain:(o.plain||'').slice(0,20)})))`));

  // ── ITEM 4: OPEN THE THREAD FIRST. The dock renders StewDmWindow only for peers in `peers`, which is fed
  // by the `steward-open-dm` event — so a check run without this measures a closed window and would report
  // the words missing whatever the code did.
  await ev(`window.dispatchEvent(new CustomEvent('steward-open-dm',{detail:{pubkey:${JSON.stringify(PEER)},name:'Test Peer',npub:'npub1test'}}))`);
  await sleep(2500);
  console.log('window open :', await ev(`/Test Peer/.test(document.body.innerText||'')`));
  console.log('words shown :', await ev(`(document.body.innerText||'').indexOf('Can you call me back about Sunday?')>=0`));
  console.log('waiting shown:', await ev(`/waiting to send|couldn.t send|not sent/i.test(document.body.innerText||'')`));

  // ── ITEM 9: force the give-up state, then ask for flushes and watch `tries` ────────────────────────────
  // ⚠ LET ANY IN-FLIGHT FLUSH FINISH BEFORE SEEDING. A flush that started before the seed holds the outbox
  // in memory and calls _sOutSave() when it ends, writing tries:0 straight over the seeded values — which is
  // exactly what the first run of this probe measured and nearly misread as "the item was reset".
  await sleep(60000);
  const key = await ev(`'trinityone.steward.outbox:'+(window.Steward.pubkey||'')`);
  console.log('seed failed :', await ev(`(()=>{const k=${JSON.stringify('x')};const K='trinityone.steward.outbox:'+(window.Steward.pubkey||'');
    const a=JSON.parse(localStorage.getItem(K)||'[]'); if(!a.length) return 'outbox empty';
    a.forEach(o=>{o.tries=8;o.failed=true;o.lastTry=Math.floor(Date.now()/1000)-99999;});
    localStorage.setItem(K,JSON.stringify(a)); return 'seeded tries=8 failed=true on '+a.length})()`));
  const triesNow = () => ev(`(()=>{const K='trinityone.steward.outbox:'+(window.Steward.pubkey||'');
    return JSON.stringify((JSON.parse(localStorage.getItem(K)||'[]')).map(o=>({tries:o.tries,failed:!!o.failed})))})()`);
  // ⚠ WAIT LONGER THAN THE REGISTRATION GATE OR THIS MEASURES NOTHING. publish() opens with
  // _waitForRegistration(), which is PROOF_GATE_MS (8s) + REG_GATE_MS (45s) on a console whose church the
  // relay has never acknowledged — so a flush sits there for the best part of a minute before it attempts
  // anything. A first run of this probe polled for 18s, saw `tries` unchanged, and would have reported the
  // defect absent. The gate latches (_regGate = null) after the first wait, so later flushes are prompt.
  console.log('before      :', await triesNow());
  for (let i=0;i<2;i++) {
    await ev(`window.dispatchEvent(new CustomEvent('steward-relay-returned'))`);
    await sleep(12000);
    console.log('  +' + ((i+1)*12) + 's  :', await triesNow());
  }
  console.log('storage key :', key);
} finally {
  try { ws && ws.close(); } catch {}
  try { chr.kill('SIGKILL'); } catch {}
  try { srv.close(); } catch {}
  process.exit(0);
}
