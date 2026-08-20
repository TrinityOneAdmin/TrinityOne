import { WebSocket } from 'ws';
const list = await (await fetch(`http://127.0.0.1:${process.argv[2]}/json/list`)).json();
const page = list.find(p => p.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
let id = 0; await new Promise(r => ws.on('open', r));
ws.send(JSON.stringify({ id: ++id, method: 'Network.enable' }));
ws.send(JSON.stringify({ id: ++id, method: 'Network.setCacheDisabled', params: { cacheDisabled: true } }));
setTimeout(() => ws.send(JSON.stringify({ id: ++id, method: 'Page.reload', params: { ignoreCache: true } })), 300);
setTimeout(() => { ws.close(); process.exit(0); }, 3000);
