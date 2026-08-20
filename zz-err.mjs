import { WebSocket } from 'ws';
const port = process.argv[2];
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find(p => p.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
let id = 0; const send = (m, p = {}) => ws.send(JSON.stringify({ id: ++id, method: m, params: p }));
await new Promise(r => ws.on('open', r));
ws.on('message', d => {
  const m = JSON.parse(d);
  if (m.method === 'Runtime.exceptionThrown') {
    const e = m.params.exceptionDetails;
    console.log('EXCEPTION:', e.text, '|', (e.exception && (e.exception.description || e.exception.value) || '').split('\n').slice(0, 4).join(' / '));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    console.log('CONSOLE ERROR:', m.params.args.map(a => String(a.value || a.description || '').slice(0, 200)).join(' '));
  }
  if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
});
send('Runtime.enable'); send('Page.enable');
setTimeout(() => { send('Runtime.evaluate', { expression: `(function(){
  var b=[].slice.call(document.querySelectorAll('button')).filter(function(x){return /everything|of 5|nothing/.test((x.innerText||'').trim());})[0];
  if(!b) return 'no scope control found';
  b.click(); return 'clicked: '+b.innerText.trim();
})()`, returnByValue: true }); }, 1200);
setTimeout(() => { ws.close(); process.exit(0); }, 7000);
