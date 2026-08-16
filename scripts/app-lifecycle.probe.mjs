// PROBE (not a test): do to a running app instance what a phone does to it — background it, or take its
// signal away — and see whether it comes back.
//
//   node scripts/app-lifecycle.probe.mjs <cdp-port> background <seconds>
//   node scripts/app-lifecycle.probe.mjs <cdp-port> offline <seconds>
//   node scripts/app-lifecycle.probe.mjs <cdp-port> visible          # make the page report itself visible
//
// WHY THIS EXISTS. The 2026-08-16 finding "a room shows old messages while its list shows new ones" was not
// reproducible by opening rooms, scrolling, or waiting — every one of those looked perfect. It reproduced on
// the FIRST try with `background 40`: publish while the app is away, come back, and the group list is still
// reporting the state it had before it left, permanently. A dropped socket is re-opened by nostr-tools but the
// REQs on it are not re-issued, and relaysHealthy() then answers true for ever. Ten agents missed it because
// agents never stop moving; a real person found it by sitting still. This is how you sit still on purpose.
//
// ── THE TRAP THAT MAKES A SIMULATION LIE ──────────────────────────────────────────────────────────────────
// A headless page is `visibilityState: "hidden"` for its entire life. The member app's 90-second reconnect
// heartbeat begins `if (document.visibilityState !== 'visible') return;`, `visibilitychange`/`focus` never
// fire, and there is no Capacitor App plugin in a browser — so NONE of the app's three recovery signals exist
// in a simulation. Any agent whose socket dropped stayed deaf for the rest of its run and reported it as the
// product being stale. Run `visible` on every instance before a round, or expect that class of false report.
//
// Companion: scripts/sim-actor.mjs (drive one instance), scripts/seed-room.mjs (give a room some volume).
// Ground truth is relay/relay.sqlite — never what the screen says afterwards.
import { WebSocket } from 'ws';

const [port, mode, secsArg] = process.argv.slice(2);
if (!port || !mode) { console.error('usage: app-lifecycle.probe.mjs <cdp-port> <background|offline|visible> [seconds]'); process.exit(2); }
const secs = Number(secsArg || 30);

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = list.find(x => x.type === 'page');
if (!target) { console.error('no page on port ' + port); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
let id = 0;
const send = (m, p) => new Promise((res, rej) => {
  const n = ++id;
  const on = d => { const x = JSON.parse(d); if (x.id === n) { ws.off('message', on); x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result); } };
  ws.on('message', on); ws.send(JSON.stringify({ id: n, method: m, params: p }));
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
await new Promise(r => ws.on('open', r));
await send('Page.enable', {}); await send('Runtime.enable', {}); await send('Network.enable', {});

if (mode === 'background') {
  // 'frozen' is the Page Lifecycle state Chrome puts a backgrounded tab into, and the closest thing a
  // desktop browser has to what Android does to a WebView. Only 'frozen' and 'active' are accepted here —
  // 'hidden' is rejected by CDP as an unidentified lifecycle state, which cost a run to discover.
  await send('Page.setWebLifecycleState', { state: 'frozen' });
  console.log(`backgrounded — publish something now; coming back in ${secs}s`);
  await sleep(secs * 1000);
  await send('Page.setWebLifecycleState', { state: 'active' });
  console.log('foregrounded again');
} else if (mode === 'offline') {
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  console.log(`offline — publish something now; back in ${secs}s`);
  await sleep(secs * 1000);
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  console.log('online again');
} else if (mode === 'visible') {
  // Override the getter rather than emulate: Emulation.setPageVisibility does not exist, and a headless page
  // has no way to become genuinely visible. Also fire the events the app listens for, so this is a real
  // foreground signal and not just a changed reading.
  await send('Runtime.evaluate', { expression: `(function(){
    try { Object.defineProperty(document, 'visibilityState', { configurable: true, get: function(){ return 'visible'; } }); } catch (e) {}
    try { Object.defineProperty(document, 'hidden', { configurable: true, get: function(){ return false; } }); } catch (e) {}
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    return document.visibilityState;
  })()`, returnByValue: true }).then(r => console.log('visibilityState is now: ' + r.result.value));
} else {
  console.error('unknown mode: ' + mode);
}
ws.close(); process.exit(0);
