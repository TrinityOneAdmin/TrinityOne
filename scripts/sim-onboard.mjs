// ONBOARD ONE SIMULATED MEMBER INTO A CHURCH, FAST, AND LEAVE THE APP RUNNING FOR AN ACTOR.
//
//   node scripts/sim-onboard.mjs <port> <name> --url <appUrl> --church <npub> --relay <wss>
//
// WHY SCRIPT THIS AT ALL, given the project's rule about driving the real app. Because the wizard is not what
// a 30-member round is testing, and an actor who spends forty of their two hundred actions typing a display
// name and confirming twelve words has that much less attention for care, safeguarding and the church network.
// The previous round settled this the same way. A FEW members are still walked through the real wizard by
// hand, precisely so the wizard keeps being exercised — see the round brief.
//
// The KEY is the app's own. It mints and persists one on first load, so nothing is injected: deriving a key out
// here would prove the simulation's crypto works rather than the app's. This only writes the state the wizard
// would have written — onboarded, display name, followed church — and then reloads, so every later step runs
// through the ordinary boot path.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocket } from 'ws';

const [port, name] = process.argv.slice(2);
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const URL_ = arg('--url', 'http://127.0.0.1:8000/index.html');
const CHURCH = arg('--church', '');
const RELAY = arg('--relay', '');
const CHURCH_NAME = arg('--church-name', 'the church');
if (!port || !name || !CHURCH) { console.error('usage: sim-onboard.mjs <port> <name> --church <npub> [--url U] [--relay wss]'); process.exit(2); }

const SCRATCH = process.env.TRINITY_SCRATCH || '/mnt/storage/tmp/trinity-scratch';
const profile = mkdtempSync(join(SCRATCH, 'actor-' + name.replace(/\W+/g, '') + '-'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const chrome = spawn('chromium', ['--headless=new', '--remote-debugging-port=' + port,
  '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', URL_], { stdio: 'ignore', detached: true });
chrome.unref();

let target = null;
for (let i = 0; i < 80 && !target; i++) {
  await sleep(300);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page'); } catch {}
}
if (!target) { console.log(JSON.stringify({ ok: false, name, port: +port, why: 'browser never came up' })); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
let id = 0;
const send = (m, p) => new Promise((res, rej) => {
  const n = ++id;
  const on = d => { const x = JSON.parse(d); if (x.id === n) { ws.off('message', on); x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result); } };
  ws.on('message', on); ws.send(JSON.stringify({ id: n, method: m, params: p }));
});
await new Promise(r => ws.on('open', r));
await send('Runtime.enable', {}); await send('Page.enable', {});
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.value;

// Wait for the app to mint its OWN identity. It does this on first load and persists the mnemonic itself, so
// there is nothing to inject: deriving a key out here would prove the simulation's crypto works rather than
// the app's. All that is missing afterwards is the state the wizard would have written.
let minted = '';
for (let i = 0; i < 80 && !minted; i++) { await sleep(500); minted = await ev('(window.Fellowship && window.Fellowship.myPubkey) || ""').catch(() => ''); }
if (!minted) { console.log(JSON.stringify({ ok: false, name, port: +port, why: 'the app never minted an identity' })); process.exit(1); }

const setup = await ev(`(function(){
  try {
    if (!localStorage.getItem('trinityone.nostr.mnemonic')) return 'ERR the app kept no mnemonic to persist';
    localStorage.setItem('trinityone.onboarded', 'true');
    // ACTIVE, not merely followed. Writing only followedChurches leaves activeChurch null, and every church
    // subscription resolves through `churches.find(c => c.id === activeChurch)` — so the app subscribes to
    // nothing, publishes no name, and reports the church as empty while chat still works. Seventeen of
    // twenty-nine members landed in exactly that state on 2026-08-18 and showed as "Anonymous" to everyone.
    localStorage.setItem('trinityone.activeChurch', ${JSON.stringify(CHURCH)});
    localStorage.setItem('trinityone.profile', JSON.stringify({ name: ${JSON.stringify(name)} }));
    localStorage.setItem('trinityone.followedChurches', JSON.stringify([{
      id: ${JSON.stringify(CHURCH)}, npub: ${JSON.stringify(CHURCH)}, name: ${JSON.stringify(CHURCH_NAME)},
      initials: ${JSON.stringify(CHURCH_NAME.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase())},
      accent: '', tagline: '', sub: 'Followed', verified: false, members: 1,
      channel: '', audioFeed: '', lnaddr: '', giving: false, picture: '', banner: '', bannerFade: 16, features: {}, rules: {}
    }]));
    ${RELAY ? `try { localStorage.setItem('trinityone.relays', JSON.stringify([${JSON.stringify(RELAY)}])); } catch (e) {}` : ''}
    return 'ok';
  } catch (e) { return 'ERR ' + e.message; }
})()`);
if (setup !== 'ok') { console.log(JSON.stringify({ ok: false, name, port: +port, why: setup })); process.exit(1); }

await send('Page.reload', { ignoreCache: true });
await sleep(9000);

// Report the pubkey the APP derived — the console needs it to admit, and reporting it proves the identity
// actually took rather than the page quietly minting a second one.
let pub = '';
for (let i = 0; i < 20 && !pub; i++) { await sleep(700); pub = await ev('(window.Fellowship && window.Fellowship.myPubkey) || ""').catch(() => ''); }
console.log(JSON.stringify({ ok: !!pub, name, port: +port, pubkey: pub, profile }));
ws.close();
process.exit(0);
