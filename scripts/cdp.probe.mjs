// PROBE (not a test): evaluate an expression inside the running app's WebView via CDP.
// Usage: node scripts/cdp.probe.mjs '<js expression>'   (awaits promises)
import { WebSocket } from 'ws';

const expr = process.argv[2];
if (!expr) { console.error('usage: node scripts/cdp.probe.mjs "<expression>"'); process.exit(1); }

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find(p => p.type === 'page' && p.webSocketDebuggerUrl);
if (!page) { console.error('no page found'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
let id = 0;
const pending = new Map();
const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });

ws.on('message', (d) => {
  const m = JSON.parse(d);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
});

await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
try {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, allowUnsafeEvalBlockedByCSP: true });
  if (r.exceptionDetails) console.log('EXCEPTION:', JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails, null, 2));
  else console.log(typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value, null, 2));
} finally { ws.close(); }
