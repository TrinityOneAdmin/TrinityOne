// smoke-ui.mjs — a UI smoke that DRIVES the app rather than just booting it: it reloads, checks the app didn't
// blank, and clicks every reachable control, watching for uncaught exceptions / React errors after each. It
// exists because the plain boot-check (scripts/smoke.sh) never navigates or clicks anything, so a crash that
// only appears on a specific screen or control (e.g. a hook placed behind a conditional return — the ChatRoom
// blank-screen) slips straight through.
//
//   node scripts/smoke-ui.mjs [url]         default: http://localhost:8000/
//   exit 0 = clean · 1 = an exception fired on a control · 2 = harness/attach failure
//
// SCOPE + HONEST LIMITATION: run headless (Chromium against the dev gateway) this reliably exercises the
// semantic controls on the screens it can reach and flags any render crash. It does NOT reliably drive the
// full app: this app builds its nav + cards as onClick <div>s (not <button>/[role]) and, headless, the DOM /
// computed-style probes that would let a generic crawler find + click those don't behave like the real
// Capacitor webview does. The RELIABLE "click every control incl. open a group" path is the ON-DEVICE harness
// (adb + the webview's CDP), which has been shown to navigate tabs, open chat groups and work the composer.
// TODO(next, needs a phone): port this crawl onto the on-device webview for true full-app button coverage.
import { spawn, spawnSync } from 'child_process';
import WebSocket from 'ws';

const URL = process.argv[2] || 'http://localhost:8000/';
const PORT = 9480 + (process.pid % 400);
const CHROME = ['/snap/bin/chromium', 'chromium-browser', 'chromium', 'google-chrome']
  .find(c => { try { return !spawnSync(c, ['--version'], { timeout: 4000 }).error; } catch { return false; } }) || '/snap/bin/chromium';
const UDD = `/tmp/smoke-ui-${process.pid}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', 
  // Never let this reach production — see the note in sim-launch.mjs. Port 9 discards; the page's own
  // origin relay is unaffected.
  '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9',
  '--no-sandbox', `--user-data-dir=${UDD}`,
  '--window-size=1100,860', `--remote-debugging-port=${PORT}`, URL], { stdio: 'ignore', detached: true });
const cleanup = () => { try { process.kill(-chrome.pid); } catch {} try { spawnSync('rm', ['-rf', UDD]); } catch {} };

async function main() {
  await sleep(4500);
  let wsUrl = '';
  for (let i = 0; i < 12 && !wsUrl; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/json`).then(x => x.json()); wsUrl = (r.find(t => t.type === 'page' && !/devtools/.test(t.url)) || {}).webSocketDebuggerUrl; } catch {}
    if (!wsUrl) await sleep(600);
  }
  if (!wsUrl) { console.log('SMOKE-UI: could not attach (is the app served at ' + URL + '?)'); cleanup(); process.exit(2); }

  const ws = new WebSocket(wsUrl); let id = 0; const exc = [];
  const send = (method, params = {}) => new Promise(res => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); const h = d => { const m = JSON.parse(d); if (m.id === i) { ws.off('message', h); res(m.result); } }; ws.on('message', h); });
  const ev = expr => send('Runtime.evaluate', { expression: expr, returnByValue: true }).then(r => (r && r.result && r.result.value));
  await new Promise(r => ws.on('open', r));
  await send('Runtime.enable'); await send('Page.enable');
  ws.on('message', d => { const m = JSON.parse(d);
    if (m.method === 'Runtime.exceptionThrown') { const x = m.params.exceptionDetails || {}; exc.push('EXC: ' + ((x.exception && x.exception.description) || x.text || '').split('\n')[0].slice(0, 160)); }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') { const t = (m.params.args || []).map(a => a.value || a.description || '').join(' '); if (/rendered more hooks|hook|Minified React|is not a function|Cannot read/i.test(t)) exc.push('ERR: ' + t.slice(0, 160)); } });

  const findings = [];
  const nodeCount = () => ev('(document.body?document.body.querySelectorAll("*").length:0)');
  await send('Page.reload'); await sleep(3800);
  await ev(`[...document.querySelectorAll("button")].filter(b=>/skip|later|not now|continue|get started|done/i.test(b.textContent||"")).slice(0,1).forEach(b=>b.click())`); await sleep(500);
  if ((await nodeCount()) < 15) findings.push('initial boot BLANKED (fewer than 15 DOM nodes)');

  // click every visible <button>, checking for a NEW exception after each; Escape to close anything it opened
  await ev(`window.__b=[...document.querySelectorAll("button")].filter(b=>b.offsetHeight>0)`);
  const n = await ev(`window.__b.length`);
  let clicked = 0;
  for (let i = 0; i < Math.min(n, 60); i++) {
    const before = exc.length;
    const label = await ev(`(function(){var b=window.__b[${i}];if(!b)return null;try{b.dispatchEvent(new MouseEvent("click",{bubbles:true}))}catch(e){}return (b.getAttribute("aria-label")||b.title||(b.textContent||"").trim()||"(button)").slice(0,30)})()`);
    if (label != null) clicked++;
    await sleep(160);
    if (exc.length > before) findings.push(`button "${label}" -> ${exc[before]}`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
    await sleep(90);
    if ((await nodeCount()) < 15) { findings.push(`screen BLANKED after clicking "${label}"`); await send('Page.reload'); await sleep(2500); await ev(`window.__b=[...document.querySelectorAll("button")].filter(b=>b.offsetHeight>0)`); }
  }

  console.log(`SMOKE-UI: reloaded + clicked ${clicked} <button> controls. Total exceptions/errors: ${exc.length}.`);
  if (!findings.length) console.log('  ✓ app did not blank and no control threw a render/hook error.');
  else { console.log('  ✗ issues:'); findings.forEach(f => console.log('    • ' + f)); }
  console.log('  note: full nav + open-a-group coverage is the on-device harness (see header); headless can\'t reliably click this app\'s div-based nav.');
  ws.close(); cleanup(); process.exit(findings.length ? 1 : 0);
}
main().catch(e => { console.log('SMOKE-UI error:', e.message); cleanup(); process.exit(2); });
