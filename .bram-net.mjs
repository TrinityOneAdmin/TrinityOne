import { WebSocket } from 'ws';
const port = process.argv[2], mode = process.argv[3];
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const t = list.find(x => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
let id = 0; const waits = new Map();
const send = (method, params) => new Promise(r => { const i = ++id; waits.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
ws.on('message', m => { const d = JSON.parse(m); if (d.id && waits.has(d.id)) { waits.get(d.id)(d.result); waits.delete(d.id); } });
await new Promise(r => ws.on('open', r));
await send('Network.enable', {});
const off = mode === 'offline';
console.log(JSON.stringify(await send('Network.emulateNetworkConditions', {
  offline: off, latency: off ? 0 : 0, downloadThroughput: off ? 0 : -1, uploadThroughput: off ? 0 : -1
})));
console.log('network now', mode);
process.exit(0);
