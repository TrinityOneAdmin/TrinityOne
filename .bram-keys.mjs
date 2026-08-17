import { WebSocket } from 'ws';
const port = process.argv[2], text = process.argv[3];
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const t = list.find(x => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
let id = 0; const waits = new Map();
const send = (method, params) => new Promise(r => { const i = ++id; waits.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
ws.on('message', m => { const d = JSON.parse(m); if (d.id && waits.has(d.id)) { waits.get(d.id)(d.result); waits.delete(d.id); } });
await new Promise(r => ws.on('open', r));
for (const ch of text) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch });
  await send('Input.dispatchKeyEvent', { type: 'char', text: ch, unmodifiedText: ch, key: ch });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', text: ch, unmodifiedText: ch, key: ch });
  await new Promise(r => setTimeout(r, 20));
}
console.log('typed real keys:', text);
process.exit(0);
