// PROBE (not a test): walk a real user journey in a real browser and screenshot every step.
//
// Usage:
//   nohup chromium-browser --headless --disable-gpu --no-sandbox \
//        --host-resolver-rules='MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9' \
//        --user-data-dir=$(mktemp -d) --remote-debugging-port=9333 about:blank &
//
// KEEP THE RESOLVER RULE. This script attaches to a browser YOU launched, so it cannot add the guard itself.
// The app dials the canonical relays whatever origin served the page, and without that flag a probe writes to
// production. Round 8 put three test-church documents on the live relay exactly this way. Port 9 discards;
// the relay on the page's own origin still works.
//   node scripts/journey.probe.mjs <url> <outPrefix> ["Click me"] ["Then me"] ...
//
// A FRESH --user-data-dir EVERY RUN. The app registers a service worker, and a reused profile serves run 1's
// bundle for ever — you end up auditing a build that no longer exists (see the browser-probe SW-cache trap).
//
// Written for the 2026-08-05 journey audit, which is what it is good at: it found that the invite landing's
// "Open TrinityOne now" button pointed at `/?follow=…`, and that on the marketing domain `/` is the brochure —
// so the button rendered the sales page and dropped the church, after showing "Join <church>" and "Hi, <name>"
// as if it had worked. Reading the code would not have shown that; only walking it on the live hosts did.
//
// Click matching is by visible innerText prefix and searches in reverse (innermost first), so pass the label a
// person would tap. Mind the CURLY apostrophe in the app's copy — "I’m new here", not "I'm new here"; the
// straight one silently matches nothing.
import { WebSocket } from 'ws';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, prefix, ...clicks] = process.argv.slice(2);
// Output dir: JOURNEY_OUT if set, else a temp dir. This used to be one session's scratchpad path, which
// meant the probe wrote nowhere for anyone else and died on the first screenshot.
const OUT = process.env.JOURNEY_OUT || join(tmpdir(), 'trinity-journey-shots');
mkdirSync(OUT, { recursive: true });

const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = list.find(p => p.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
let id = 0; const pending = new Map();
const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
ws.on('message', d => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise(r => ws.on('open', r));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT + name + '.png', Buffer.from(data, 'base64'));
  console.log('  shot →', name + '.png');
};

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url });
await sleep(7000);
await shot(prefix + '-0');
console.log('  title:', await evalJs('document.title'));

let i = 1;
for (const text of clicks) {
  const clicked = await evalJs(`(() => {
    const t = ${JSON.stringify(text)};
    const els = [...document.querySelectorAll('button,a,[role=button],div,label')];
    const hit = els.reverse().find(e => (e.innerText||'').trim().startsWith(t) && e.offsetParent !== null);
    if (!hit) return 'NOT FOUND: ' + t;
    hit.click(); return 'clicked: ' + t;
  })()`);
  console.log(' ', clicked);
  await sleep(2500);
  await shot(prefix + '-' + i);
  i++;
}
// what can the member DO here?
console.log('  visible actions:', await evalJs(`JSON.stringify([...document.querySelectorAll('button,a')].filter(e=>e.offsetParent!==null).map(e=>(e.innerText||'').trim()).filter(Boolean).slice(0,14))`));
ws.close();
