// BOOT ONE LIVE APP INSTANCE AND LEAVE IT RUNNING, so an actor can drive it with sim-actor.mjs.
//
//   node scripts/sim-launch.mjs <port> <url> [--name Ada] [--desktop]
//
// WHY SEPARATE FROM sim-app.mjs. That script owns the whole round — it spawns personas, drives them through a
// scripted scenario and tears them down. Actors need the opposite: a browser that OUTLIVES the process that
// started it, because each actor command is its own short-lived CLI call and the state has to live in the app
// the way it does for a real person.
//
// A UNIQUE PROFILE EVERY TIME, deliberately. A fixed --user-data-dir keeps the service worker from run 1, so
// run 2 silently loads run 1's bundle and every finding is about code that is no longer on disk. This has
// bitten before; the profile is a mkdtemp and never reused.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';

const [port, url] = process.argv.slice(2);
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const NAME = arg('--name', 'actor');
const DESKTOP = process.argv.includes('--desktop');
if (!port || !url) { console.error('usage: sim-launch.mjs <port> <url> [--name X] [--desktop]'); process.exit(2); }

const SCRATCH = process.env.TRINITY_SCRATCH || '/mnt/storage/tmp/trinity-scratch';
const profile = mkdtempSync(join(SCRATCH, 'actor-' + NAME + '-'));

const chrome = spawn('chromium', ['--headless=new', '--remote-debugging-port=' + port,
  '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
  // MUTE. These are real browsers on the operator's machine, so an actor tapping the audio Bible or
  // "Listen to this page" plays out of the box's speakers — which happened mid-round on 2026-08-18 and
  // is startling if you have walked away from the desk. It does NOT disable the audio element, so an
  // actor can still observe that playback started; it just does not make noise in the room.
  '--mute-audio',
  // the funnel serves over TLS with a real cert; keep this OFF so a cert problem is VISIBLE rather than
  // silently tolerated in a simulation and then a surprise on a member's phone.
  url], { stdio: 'ignore', detached: true });
chrome.unref();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 60 && !target; i++) {
  await sleep(300);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page'); } catch {}
}
if (!target) { console.error(NAME + ': browser never came up on ' + port); process.exit(1); }

// Phone metrics unless asked otherwise — the steward console is a desktop tool and is unusable at 390px.
if (!DESKTOP) {
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  let id = 0;
  const send = (m, p) => new Promise((res) => {
    const n = ++id;
    const on = d => { const x = JSON.parse(d); if (x.id === n) { ws.off('message', on); res(x.result); } };
    ws.on('message', on); ws.send(JSON.stringify({ id: n, method: m, params: p }));
  });
  await new Promise(r => ws.on('open', r));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  ws.close();
}

// PROVE WHICH BUILD LOADED. A probe that cannot say what it ran is a probe that will one day report on a
// bundle that no longer exists.
console.log(JSON.stringify({ ok: true, name: NAME, port: Number(port), url, profile }));
