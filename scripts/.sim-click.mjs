// Real mouse/keyboard input via CDP. Synthetic .click() and dispatchEvent do NOT drive controlled React
// inputs — the DOM changes and React resets it on the next render, so a checkbox reads `checked:true` while
// the state behind it never moved. Every interaction here is a trusted event at real coordinates.
import { WebSocket } from 'ws';
const PORT = 9333;
const [,, kind, needle, text] = process.argv;   // kind: click | type
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === 'page' && /steward\.html|localhost|127\.0\.0\.1/.test(t.url || ''));
if (!page) { console.log('no page'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
await new Promise((r) => ws.on('open', r));
const evalIn = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;
const box = await evalIn(`(() => {
  const n = ${JSON.stringify(needle)};
  let el = null;
  if (n.startsWith('css:')) el = document.querySelector(n.slice(4));
  else el = [...document.querySelectorAll('button,a,[role=button],input,label')]
    .find(x => ((x.textContent||'') + ' ' + (x.placeholder||'') + ' ' + (x.getAttribute('aria-label')||'')).toLowerCase().includes(n.toLowerCase()));
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return JSON.stringify({ x: r.x + r.width/2, y: r.y + r.height/2, tag: el.tagName, txt: (el.textContent||'').trim().slice(0,40) });
})()`);
if (!box) { console.log('NOT FOUND: ' + needle); ws.close(); process.exit(2); }
const { x, y, tag, txt } = JSON.parse(box);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
if (kind === 'type' && text) { await new Promise(r => setTimeout(r, 150)); await send('Input.insertText', { text }); }
await new Promise((r) => setTimeout(r, 500));
console.log(`ok ${kind} <${tag}> "${txt}"`);
ws.close();
