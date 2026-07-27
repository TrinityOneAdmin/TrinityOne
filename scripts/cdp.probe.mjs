// PROBE (not a test): evaluate an expression inside the running app's WebView via CDP.
// Usage: node scripts/cdp.probe.mjs '<js expression>'   (awaits promises)
//
// ── HOW TO ATTACH TO A PHONE (do this FIRST — the probe assumes port 9222 is already forwarded) ──
// This is how the 2026-07-26 restore bug was actually found: reading the code produced three wrong theories,
// and one look at the live app settled it. Keep this recipe; it is the difference between guessing and knowing.
//
//   source scripts/android-env.sh                    # adb/java are NOT on PATH by default on this box
//   adb devices -l                                   # confirm the device says `device`, not `unauthorized`
//   adb -s <SERIAL> shell input keyevent KEYCODE_WAKEUP     # a sleeping phone throttles the WebView to ZERO
//   adb -s <SERIAL> shell monkey -p com.trinityone.app -c android.intent.category.LAUNCHER 1   # if not running
//   PID=$(adb -s <SERIAL> shell pidof com.trinityone.app | tr -d '\r')
//   adb -s <SERIAL> forward --remove-all
//   adb -s <SERIAL> forward tcp:9222 localabstract:webview_devtools_remote_$PID
//   curl -s http://127.0.0.1:9222/json/list            # should list one page, url https://localhost/
//   node scripts/cdp.probe.mjs 'JSON.stringify({pub:(window.Fellowship||{}).myPubkey})'
//
// Devices (2026-07-26): OPPO CPH2477 = J77HDMTC7TKBZDFM over USB, identity "Sir Lloyd", a REAL member of
// TrinityLA — so anything it publishes lands on the owner's live console. Pixel 10 Pro = 192.168.0.230:5555
// over wifi adb, drops to `unauthorized` regularly and needs the on-screen prompt re-tapped.
//
// Requires webContentsDebuggingEnabled (currently true — see the webview-debug-temporary memory; it MUST be off
// at go-live, and this recipe stops working then, which is correct).
//
// Companions: cdp-frames.probe.mjs (records every WebSocket frame from a COLD boot — use it to prove "the relay
// sent it and the app dropped it" vs "it was never sent") and onboarding-shot.probe.mjs (screenshots the
// first-run screens in a local browser). If a probe reads zero, check in this order: screen asleep, app
// PIN-locked, no signal — before believing the app is broken.
import { WebSocket } from 'ws';

const expr = process.argv[2];
if (!expr) { console.error('usage: node scripts/cdp.probe.mjs "<expression>"'); process.exit(1); }

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find(p => p.type === 'page' && p.webSocketDebuggerUrl);
if (!page) { console.error('no page found'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
let id = 0;
const pending = new Map();
const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });

ws.on('message', (d) => {
  const m = JSON.parse(d);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
});

await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
try {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, allowUnsafeEvalBlockedByCSP: true });
  if (r.exceptionDetails) console.log('EXCEPTION:', JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails, null, 2));
  else console.log(typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value, null, 2));
} finally { ws.close(); }
