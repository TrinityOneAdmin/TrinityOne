import { WebSocket } from 'ws';
const PORT = 9333;
const [,, selectorText, text] = process.argv;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === 'page' && /steward\.html/.test(t.url || ''));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
await new Promise((r) => ws.on('open', r));
// focus the input by clicking its centre, then type for real
const { result } = await send('Runtime.evaluate', { expression: `(() => {
  const i = [...document.querySelectorAll('input')].find(x => (x.placeholder||'').includes(${JSON.stringify(selectorText)}));
  if (!i) return null; const r = i.getBoundingClientRect();
  return JSON.stringify({ x: r.x + r.width/2, y: r.y + r.height/2 });
})()`, returnByValue: true });
if (!result.value) { console.log('input not found'); process.exit(1); }
const { x, y } = JSON.parse(result.value);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
for (const ch of text) await send('Input.insertText', { text: ch });
await new Promise((r) => setTimeout(r, 400));
const { result: after } = await send('Runtime.evaluate', { expression: `(() => {
  const i = [...document.querySelectorAll('input')].find(x => (x.placeholder||'').includes(${JSON.stringify(selectorText)}));
  const b = [...document.querySelectorAll('button')].find(x => /^Continue$/i.test((x.textContent||'').trim()));
  return JSON.stringify({ value: i ? i.value : null, continueEnabled: b ? !b.disabled : null });
})()`, returnByValue: true });
console.log(after.value);
ws.close();
