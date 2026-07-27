// PROBE (not a test): screenshot the first-run onboarding screens so I can SEE them.
// Usage: node scripts/onboarding-shot.probe.mjs <outDir>
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';

const OUT = process.argv[2] || '/tmp';
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
if (!CHROME) { console.error('no chromium'); process.exit(1); }
const PORT = 8894, CDP = 9351;
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const dataDir = mkdtempSync(join(tmpdir(), 'trin-shot-'));
const cp = getPublicKey(generateSecretKey());
const relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
  cwd: ROOT, stdio: 'ignore',
  env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
});
const t0 = Date.now();
while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(200); }

const prof = join(tmpdir(), 'trin-shot-chr-' + process.pid);
const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
// Headless throttles timers on a page it considers hidden — the splash's own 4.5s dismissal never fired and
// looked like "onboarding is broken". Keep the renderer foregrounded.
const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu',
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
  BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=420,900', `http://127.0.0.1:${PORT}/`], { stdio: 'ignore' });

let ws;
try {
  let page = null;
  for (let i = 0; i < 60 && !page; i++) {
    await sleep(400);
    try { page = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find(p => p.type === 'page' && p.webSocketDebuggerUrl); } catch {}
  }
  if (!page) throw new Error('no page');
  ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  let id = 0; const pending = new Map();
  const send = (m, p) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', d => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  await send('Page.enable', {});
  await sleep(3000);
  // a genuinely first-run device
  await send('Runtime.evaluate', { expression: 'localStorage.clear(); sessionStorage.clear();', returnByValue: true, allowUnsafeEvalBlockedByCSP: true });
  await send('Page.reload', {});
  await sleep(7000);

  const shot = async (label) => {
    const st = await send('Runtime.evaluate', {
      expression: `JSON.stringify({url:location.href, onboarded:localStorage.getItem('trinityone.onboarded'), hasWelcome:(document.body.innerText||'').includes('Welcome to TrinityOne'), comp:typeof IdentityOnboarding, splash:!!document.querySelector('.to-splash'), roots:document.getElementById('root')?document.getElementById('root').children.length:-1})`,
      returnByValue: true, allowUnsafeEvalBlockedByCSP: true,
    });
    console.log('state:', st.result.value);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const f = join(OUT, `onboarding-${label}.png`);
    writeFileSync(f, Buffer.from(r.data, 'base64'));
    const txt = await send('Runtime.evaluate', { expression: `(document.body.innerText||'').replace(/\\n{2,}/g,'\\n').slice(0,400)`, returnByValue: true, allowUnsafeEvalBlockedByCSP: true });
    console.log(`\n=== ${label} -> ${f}\n${txt.result.value}`);
  };
  // the splash swallows the first screens; it dismisses on click
  const dismissSplash = async () => {
    for (let i = 0; i < 25; i++) {
      const r = await send('Runtime.evaluate', {
        expression: `(() => { const s=document.querySelector('.to-splash'); if(!s) return 'gone'; s.click(); return 'clicked'; })()`,
        returnByValue: true, allowUnsafeEvalBlockedByCSP: true,
      });
      if (r.result.value === 'gone') return;
      await sleep(700);
    }
  };
  const clickText = async (needle) => {
    const r = await send('Runtime.evaluate', {
      expression: `(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').includes(${JSON.stringify(needle)})); if(!b) return 'NOT FOUND'; b.click(); return 'clicked: '+b.innerText.trim(); })()`,
      returnByValue: true, allowUnsafeEvalBlockedByCSP: true,
    });
    console.log('->', r.result.value);
    await sleep(1200);
  };

  const dump = await send('Runtime.evaluate', {
    expression: `JSON.stringify({ keys: Object.keys(localStorage), onboarded: localStorage.getItem('trinityone.onboarded'), url: location.href })`,
    returnByValue: true, allowUnsafeEvalBlockedByCSP: true,
  });
  console.log('after clear+reload:', dump.result.value);
  await dismissSplash(); await sleep(1500);
  await shot('1-firstrun');

  // force the wizard explicitly, so the screens can be reviewed regardless of the gate
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?onboard=1` });
  await sleep(9000); await dismissSplash(); await sleep(1500);
  await shot('2-welcome');
  await clickText('used it before');
  await shot('3-choose');
  await clickText('have my 12 words');
  await sleep(800);
  await shot('4-words');
} finally {
  try { ws && ws.close(); } catch {}
  try { chr.kill('SIGKILL'); } catch {}
  try { relay.kill('SIGKILL'); } catch {}
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  try { rmSync(prof, { recursive: true, force: true }); } catch {}
}
