// Two steward console instances, left running for free-acting agents.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
const SCRATCH = process.env.TRINITY_SCRATCH || '/mnt/storage/tmp/trinity-scratch';
for (const [name, port] of [['pastor', 9601], ['warden', 9602]]) {
  const profile = mkdtempSync(join(SCRATCH, 'console-' + name + '-'));
  spawn('chromium', ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
    '--no-first-run', '--disable-gpu', '--no-sandbox', 'about:blank'], { stdio: 'ignore', detached: true }).unref();
  console.log('  ' + name + ' console on port ' + port);
}
await new Promise(r => setTimeout(r, 6000));
// point each at the console and give it a phone-ish viewport (stewards use tablets/laptops, so wider)
import { WebSocket } from 'ws';
for (const port of [9601, 9602]) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const t = list.find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  let id = 0;
  const send = (m, p) => new Promise((res, rej) => { const n = ++id;
    const on = d => { const x = JSON.parse(d); if (x.id === n) { ws.off('message', on); x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result); } };
    ws.on('message', on); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
  await new Promise(r => ws.on('open', r));
  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url: 'http://127.0.0.1:8000/steward.html' });
  await new Promise(r => setTimeout(r, 12000));
  ws.close();
}
console.log('\n  both consoles are live at steward.html');
process.exit(0);
