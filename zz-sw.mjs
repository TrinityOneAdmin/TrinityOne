import { WebSocket } from 'ws';
const port = process.argv[2];
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find(p => p.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
let id = 0; const send = (m, p = {}) => ws.send(JSON.stringify({ id: ++id, method: m, params: p }));
await new Promise(r => ws.on('open', r));
send('Runtime.evaluate', { expression: `(async () => {
  if (navigator.serviceWorker) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r => r.unregister()));
  }
  if (window.caches) { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); }
  return 'cleared';
})()`, awaitPromise: true, returnByValue: true });
setTimeout(() => { send('Page.reload', { ignoreCache: true }); }, 1500);
setTimeout(() => { ws.close(); process.exit(0); }, 4000);
