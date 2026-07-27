// PROBE (not a test): record every WebSocket frame the app sends/receives from a COLD boot.
// Answers: does the relay challenge (AUTH), and does the app ever answer it?
// Usage: node scripts/cdp-frames.probe.mjs [secondsToWatch]
import { WebSocket } from 'ws';

const WATCH = (Number(process.argv[2]) || 20) * 1000;

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find(p => p.type === 'page' && p.webSocketDebuggerUrl);
if (!page) { console.error('no page'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
let id = 0; const pending = new Map();
const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

// Patch WebSocket BEFORE any app code runs, so we see the very first frames.
const patch = `
(() => {
  window.__frames = [];
  const t0 = Date.now();
  const Native = window.WebSocket;
  function Rec(url, protos) {
    const s = protos === undefined ? new Native(url) : new Native(url, protos);
    const tag = String(url);
    const push = (dir, data) => { try { window.__frames.push({ at: Date.now() - t0, dir, url: tag, data: String(data).slice(0, 20000) }); } catch (e) {} };
    const origSend = s.send.bind(s);
    s.send = (d) => { push('>', d); return origSend(d); };
    s.addEventListener('message', (e) => push('<', e.data));
    s.addEventListener('close', () => push('!', 'CLOSED'));
    return s;
  }
  Rec.prototype = Native.prototype;
  for (const k of ['CONNECTING','OPEN','CLOSING','CLOSED']) Rec[k] = Native[k];
  window.WebSocket = Rec;
})();
`;
await send('Page.enable', {});
await send('Page.addScriptToEvaluateOnNewDocument', { source: patch });
await send('Page.reload', { ignoreCache: false });
console.error(`reloaded — watching ${WATCH / 1000}s…`);
await new Promise(r => setTimeout(r, WATCH));

const r = await send('Runtime.evaluate', {
  expression: `JSON.stringify({ pub: (window.Fellowship||{}).myPubkey, frames: window.__frames || [] })`,
  returnByValue: true, allowUnsafeEvalBlockedByCSP: true,
});
ws.close();
const { pub, frames } = JSON.parse(r.result.value);
console.log('my pubkey:', pub);
console.log('total frames:', frames.length);

const auths = frames.filter(f => f.data.includes('"AUTH"') || f.data.includes('22242'));
console.log('\n--- AUTH traffic ---');
if (!auths.length) console.log('(none — the relay never challenged, or the app never answered)');
for (const f of auths) console.log(`${String(f.at).padStart(6)}ms ${f.dir} ${f.data.slice(0, 240)}`);

console.log('\n--- kind-30078 docs the relay SENT US that we authored (d-tags) ---');
const mine = new Map();
for (const f of frames.filter(f => f.dir === '<' && f.data.startsWith('["EVENT"'))) {
  try {
    const e = JSON.parse(f.data)[2];
    if (e.kind === 30078 && e.pubkey === pub) {
      const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '(none)';
      if (!mine.has(d)) mine.set(d, f.at);
    }
  } catch {}
}
if (!mine.size) console.log('(none)');
for (const [d, at] of mine) console.log(`${String(at).padStart(6)}ms  ${d}`);
console.log('\nmember: docs among them ->', [...mine.keys()].filter(d => d.startsWith('trinityone/member:')));
