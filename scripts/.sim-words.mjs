import { WebSocket } from 'ws';
const words = process.argv.slice(2);   // in DOM order
const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = list.find(t => t.type === 'page' && /steward\.html/.test(t.url || ''));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
await new Promise((r) => ws.on('open', r));
const evalIn = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;
for (let i = 0; i < words.length; i++) {
  const box = await evalIn(`(() => { const ins=[...document.querySelectorAll('input')].filter(x=>x.type!=='checkbox');
    const el=ins[${i}]; if(!el) return null; el.scrollIntoView({block:'center'});
    const r=el.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()`);
  if (!box) { console.log('input ' + i + ' missing'); continue; }
  const { x, y } = JSON.parse(box);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await new Promise(r => setTimeout(r, 120));
  await send('Input.insertText', { text: words[i] });
  await new Promise(r => setTimeout(r, 200));
}
const st = await evalIn(`(() => { const ins=[...document.querySelectorAll('input')].filter(x=>x.type!=='checkbox').map(i=>i.value);
  const b=[...document.querySelectorAll('button')].find(x=>/^Continue$/i.test((x.textContent||'').trim()));
  return JSON.stringify({ values: ins, continueEnabled: b ? !b.disabled : null }); })()`);
console.log(st);
ws.close();
