// THE BUILT DESKTOP FINANCE BUNDLE BOOTS AT THE PROGRAM'S OWN ORIGIN, UNDER ITS OWN CSP, AND TALKS ONLY TO THE SHARED RELAY.
// Run: node --test scripts/finance-desktop-boots-at-its-packaged-origin.test.mjs
//
// T1Finance desktop plan §5 test 2 (+ §8: boot both origin shapes, no real network). The REAL build script
// (scripts/build-finance-desktop.sh) writes the bundle into a private temp folder; headless chromium then loads it
// AT https://tauri.localhost/index.html — the origin the Windows program has with useHttpsScheme: true — every
// request answered from that bundle by CDP Fetch, with the Content-Security-Policy header set to
// finance-app/desktop/src-tauri/tauri.conf.json's app.security.csp (what Tauri serves it with). Every other request is
// FAILED and recorded, every hostname is unresolvable, and WebSockets are recorded from Network.webSocketCreated
// (fired when the page constructs one, whether or not it connects). The walk is the real one a new helper takes:
// "Help with a church's books" → a PIN → "Not linked to a church yet".
//
// Asserted: the shell renders; no uncaught error; no CSP violation (and, as the instrument, eval IS refused — the
// header really applied); no request for a file the bundle lacks; isSecureContext; window.Steward.packagedOrigin()
// is true; the ONLY socket the page constructs is wss://app.trinityone.church/relay; nothing asks the app's own origin
// for /config, /local-token, /tunnel or any relay route; no request leaves the bundle except to that relay.
//
// THE OTHER ORIGIN SHAPE, tauri://localhost (Mac + Linux), CANNOT BE SERVED BY CHROMIUM: Fetch interception does not
// take a custom scheme. It is covered by scripts/a-packaged-app-talks-only-to-the-shared-relays.test.mjs Part 1 (the
// same vendor/steward.js in a VM at tauri://localhost) and by launching the real Linux build. Said, not skipped quietly.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { WebSocket as NodeWS } from 'ws';
import { freePort } from './relay-network-harness.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const CONF = JSON.parse(readFileSync(join(ROOT, 'finance-app/desktop/src-tauri/tauri.conf.json'), 'utf8'));
const CSP = CONF.app.security.csp;
const CANON = 'wss://app.trinityone.church/relay';
const ORIGIN = 'https://tauri.localhost';
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find((p) => existsSync(p));
const SKIP = !CHROME ? 'no chromium' : false;
const PIN = 'cedar-harbour-lamp-42';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };

let T, OUT, chr, cdp, prof, send, evalIn;
const log = { sockets: [], requests: [], missing: [], blocked: [], errors: [], console: [] };

before(async () => {
  T = mkdtempSync(join(tmpdir(), 'trin-fdboot-'));
  OUT = join(T, 'dist');
  const b = spawnSync('bash', ['scripts/build-finance-desktop.sh', OUT], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(b.status, 0, 'scripts/build-finance-desktop.sh failed: ' + (b.stderr || '').slice(-600));
  if (!CHROME) return;
  const port = await freePort('the finance-desktop boot test\'s Chrome debug port');
  prof = mkdtempSync(join(tmpdir(), 'trin-fdboot-chr-'));
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, '--no-sandbox', '--disable-gpu',
    '--host-resolver-rules=MAP * ~NOTFOUND', `--user-data-dir=${prof}`, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find((t) => t.type === 'page') || targets[0];
  cdp = new NodeWS(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { cdp.on('open', res); cdp.on('error', rej); });
  let id = 0; const pend = new Map();
  send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); cdp.send(JSON.stringify({ id: i, method, params })); });
  cdp.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    if (m.method === 'Network.webSocketCreated') log.sockets.push(m.params.url);
    if (m.method === 'Runtime.exceptionThrown') { const e = m.params.exceptionDetails; log.errors.push((e.exception?.description || e.text || '').split('\n')[0]); }
    if (m.method === 'Log.entryAdded') log.console.push(m.params.entry.text || '');
    if (m.method === 'Fetch.requestPaused') {
      const { requestId, request } = m.params;
      let u; try { u = new URL(request.url); } catch { u = null; }
      if (u && u.origin === ORIGIN) {
        log.requests.push({ path: u.pathname, method: request.method });
        const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
        const file = join(OUT, rel);
        if (!rel.includes('..') && existsSync(file) && !file.endsWith('/')) {
          const headers = [{ name: 'Content-Type', value: MIME[extname(file)] || 'application/octet-stream' }, { name: 'Cache-Control', value: 'no-store' }];
          if (extname(file) === '.html') headers.push({ name: 'Content-Security-Policy', value: CSP });
          send('Fetch.fulfillRequest', { requestId, responseCode: 200, body: readFileSync(file).toString('base64'), responseHeaders: headers });
          return;
        }
        log.missing.push(u.pathname);
        send('Fetch.fulfillRequest', { requestId, responseCode: 404, body: '', responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }] });
        return;
      }
      log.blocked.push(request.url);
      send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
    }
  });
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Log.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  // CSP violations, as the page itself sees them (a CDP-injected script is not subject to the page's CSP)
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__cspv = []; document.addEventListener('securitypolicyviolation', (e) => window.__cspv.push(e.violatedDirective + ' ' + e.blockedURI + ' ' + (e.sourceFile || '') + ':' + e.lineNumber));` });
  evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error('in-page: ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };
});

after(() => {
  try { cdp && cdp.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
  try { T && rmSync(T, { recursive: true, force: true }); } catch {}
});

async function waitFor(expr, ms = 90000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await evalIn(expr)) return true; } catch {} await sleep(300); }
  throw new Error('timed out waiting for: ' + label + ' — screen: ' + JSON.stringify(await evalIn(`(document.body && document.body.innerText || '').slice(0, 300)`).catch(() => '?')));
}
const typePh = (ph, val) => `(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(ph)})); if(!i) return 'miss';
  const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
const clickBtn = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`;
const norm = (u) => String(u).replace(/\/+$/, '');

test(`the built bundle boots at ${ORIGIN} under the program's CSP, reaches "Not linked to a church yet", and talks only to the shared relay`, { skip: SKIP, timeout: 300000 }, async () => {
  await send('Page.navigate', { url: ORIGIN + '/index.html' });
  await waitFor(`!!window.Steward && document.querySelectorAll('#root *').length > 5 && /Help with a church’s books/.test(document.body.innerText)`, 120000, 'the finance welcome to mount');
  const seen = {};
  seen.secure = await evalIn('window.isSecureContext');
  seen.packaged = await evalIn('window.Steward.packagedOrigin()');
  seen.build = await evalIn('JSON.stringify(window.TRINITY_BUILD)');
  seen.app = await evalIn('window.TRINITY_APP');
  seen.ownRelay = await evalIn('window.Steward.ownRelay()');
  seen.sw = await evalIn(`navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(r => r.length) : 0`);
  // the real walk a new helper takes, to the "not linked" screen
  await waitFor(`${clickBtn('/Help with a church’s books/')} === 'ok'`, 60000, '"Help with a church\'s books"');
  await waitFor(`${clickBtn('/Set a PIN & continue/')} === 'ok'`, 60000, '"Set a PIN & continue"');
  await waitFor(`${typePh('At least 8', PIN)} === 'ok'`, 60000, 'the PIN box');
  assert.equal(await evalIn(clickBtn('/Set PIN & enter/')), 'ok', 'no "Set PIN & enter"');
  await waitFor(`!!document.querySelector('[data-finance-shell]') && /Not linked to a church yet/.test(document.body.innerText)`, 90000, '"Not linked to a church yet"');
  assert.equal(await evalIn('window.Steward.hasKey'), true, 'CONTROL: the walk made no helper key, so there was nothing to dial');
  await sleep(8000);   // let the helper's subscriptions dial out
  const cspv = await evalIn('window.__cspv');
  const cspConsole = log.console.filter((t) => /Content Security Policy/i.test(t));
  // the instrument: the header really applied. Runtime.evaluate itself is exempt from a page's CSP, so it inserts an
  // INLINE <script> element, which the page's policy does govern — refused, and reported — AFTER the clean read above.
  seen.inlineBlocked = await evalIn(`(() => { const s = document.createElement('script'); s.textContent = 'window.__inl = 1'; document.head.appendChild(s); return window.__inl !== 1; })()`);
  await sleep(300);
  seen.inlineReported = await evalIn(`window.__cspv.some(v => /^script-src/.test(v) && / inline /.test(v))`);

  assert.deepEqual(log.errors, [], 'the bundle threw at boot:\n  ' + log.errors.join('\n  '));
  assert.deepEqual(cspv, [], 'CSP violations under the program\'s own policy: ' + JSON.stringify(cspv));
  assert.deepEqual(cspConsole, [], 'the console reported CSP refusals');
  assert.equal(seen.inlineBlocked, true, 'INSTRUMENT: an inline script ran, so the CSP header was not applied and "no violation" proves nothing');
  assert.equal(seen.inlineReported, true, 'INSTRUMENT: the refused inline script raised no securitypolicyviolation, so the listener sees nothing');
  // ONE NAMED EXCEPTION, reported as an open finding (2026-11-18): engine.js installs the default Bible on every boot
  // with no Bible loaded (`installModule(DEFAULT_MODULE)`), and finance.html loads engine.js. The finance screens never
  // show a Bible, the bundle does not carry the 3 MB module, and the program does not fall back to the network for it
  // (engine.js ASSET_BASE is Capacitor-only), so it is a local 404 and nothing more. Any OTHER missing file fails.
  assert.deepEqual(log.missing.filter((p) => p !== '/modules/engbsb.zip'), [], 'the page asked for files the bundle lacks (dead asset URLs in the program)');
  assert.ok(log.requests.length >= 20, 'INSTRUMENT: only ' + log.requests.length + ' requests were served from the bundle');
  assert.equal(seen.secure, true, 'not a secure context — WebCrypto (the key, the PIN) would be unavailable');
  assert.equal(seen.packaged, true, ORIGIN + ' is not recognised as a packaged app (src/steward.src.js _packagedOrigin)');
  assert.equal(seen.ownRelay, CANON, 'the program names a relay other than the shared one as its own');
  assert.equal(seen.app, 'finance');
  assert.deepEqual(JSON.parse(seen.build), { app: 'finance-desktop', version: CONF.version, sha: JSON.parse(seen.build).sha });
  assert.match(JSON.parse(seen.build).sha, /^[0-9a-f]{12}$|^unknown$/);
  assert.equal(seen.sw, 0, 'a service worker registered in the program');
  assert.ok(!log.requests.some((r) => /sw(-register)?\.js$/.test(r.path)), 'the page asked for the service worker');
  const socks = [...new Set(log.sockets.map(norm))];
  assert.ok(socks.length > 0, 'INSTRUMENT: the helper constructed no socket at all, so "only the shared relay" proves nothing');
  assert.deepEqual(socks.filter((u) => u !== CANON), [], 'the program constructed sockets to ' + JSON.stringify(socks));
  const admin = log.requests.filter((r) => /^\/(config|local-token|tunnel|relay-names|push|relay-identity|status)\b/.test(r.path));
  assert.deepEqual(admin, [], 'the program asked its own origin for relay routes: ' + JSON.stringify(admin));
  const out = log.blocked.filter((u) => !/^https:\/\/app\.trinityone\.church\//.test(u));
  assert.deepEqual(out, [], 'the program tried to fetch from outside its bundle (other than the shared relay): ' + JSON.stringify(out));
});
