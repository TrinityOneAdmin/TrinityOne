// THE DESKTOP FINANCE PROGRAM OFFERS ITS OWN NEWER RELEASE — THE EXACT TAG PAGE — AND NOTHING ELSE.
// Run: node --test scripts/finance-desktop-offers-its-own-update.test.mjs
//
// T1Finance desktop plan §5 test 7 (point of use). The REAL build (scripts/build-finance-desktop.sh) is booted in
// headless chromium AT https://tauri.localhost/index.html under the program's CSP — the harness of
// scripts/finance-desktop-boots-at-its-packaged-origin.test.mjs, reused — and the address the banner reads,
// https://app.trinityone.church/finance-desktop-latest.json, is answered per case by CDP Fetch (with
// Access-Control-Allow-Origin: *, as the gateway and Pages send it — see
// scripts/finance-desktop-update-manifest-is-readable-cross-origin.test.mjs). Nothing reaches the real network.
//
// Installed = tauri.conf.json's version (the build stamp the bundle carries). Per case, a fresh page load, then:
//   · a newer final version → the banner is on screen, says "download and install it", and "Open download page"
//     opens EXACTLY https://github.com/TrinityOneAdmin/TrinityOne/releases/tag/finance-v<version> (window.open is
//     recorded; in the program, main.rs new_window_policy sends that address to the system browser);
//   · a manifest whose `url` names somewhere hostile → the link is STILL the fixed tag page;
//   · the same version, an older one, a prerelease 1.2.0-rc1, a malformed version, a body that is not JSON, and the
//     newer version served WITHOUT the CORS header → no banner. Each "no banner" case asserts the manifest WAS
//     requested, so it is not vacuous.
// Unwire StewardRoot's choice of the 'finance-desktop' variant and the first case fails. The semver compare
// (1.10.0 > 1.9.0) is unit-tested in scripts/finance-desktop-update-banner-reads-only-its-own-release.test.mjs.
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
const log = { sockets: [], requests: [], missing: [], blocked: [], errors: [], console: [], manifest: [] };
const MANIFEST_URL = 'https://app.trinityone.church/finance-desktop-latest.json';
const TAG = 'https://github.com/TrinityOneAdmin/TrinityOne/releases/tag/finance-v';
let served = { body: '{}', cors: true };   // what the manifest address answers, per case

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
      if (u && u.origin + u.pathname === MANIFEST_URL) {
        log.manifest.push(request.url);
        const headers = [{ name: 'Content-Type', value: 'application/json' }, { name: 'Cache-Control', value: 'no-store' }];
        if (served.cors) headers.push({ name: 'Access-Control-Allow-Origin', value: '*' });   // as the gateway and Pages send it
        send('Fetch.fulfillRequest', { requestId, responseCode: 200, body: Buffer.from(served.body).toString('base64'), responseHeaders: headers });
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

const banner = `/A newer TrinityOne Finance is ready/.test(document.body.innerText)`;
const bump = (v, i) => v.split('.').map((n, j) => (j === i ? Number(n) + 1 : j > i ? 0 : Number(n))).join('.');

async function bootWith(body, { cors = true } = {}) {
  served = { body, cors };
  log.manifest.length = 0;
  await send('Page.navigate', { url: ORIGIN + '/index.html' });
  await waitFor(`!!window.Steward && /Help with a church’s books/.test(document.body.innerText)`, 120000, 'the finance welcome to mount');
  const t0 = Date.now();
  while (!log.manifest.length && Date.now() - t0 < 20000) await sleep(200);
  assert.ok(log.manifest.length >= 1, 'INSTRUMENT: the page never asked for ' + MANIFEST_URL + ', so "no banner" would prove nothing');
  await sleep(1500);   // the fetch has been answered; give React a beat to paint a banner if it is going to
}

test('the desktop program offers a newer release as the exact tag page, and nothing for same/older/prerelease/malformed/no-CORS', { skip: SKIP, timeout: 600000 }, async () => {
  const installed = CONF.version;
  const newer = bump(installed, 1);   // e.g. 0.1.0 -> 0.2.0
  const older = installed === '0.0.0' ? null : (() => { const p = installed.split('.').map(Number); if (p[2] > 0) p[2]--; else if (p[1] > 0) { p[1]--; p[2] = 99; } else { p[0]--; p[1] = 99; p[2] = 99; } return p.join('.'); })();
  assert.match(installed, /^\d+\.\d+\.\d+$/, 'the test assumes a final installed version');

  // 1. newer final release → the banner, and the exact fixed link
  await bootWith(JSON.stringify({ version: newer }));
  await waitFor(banner, 15000, 'the update banner for ' + newer);
  assert.equal(await evalIn(`/Open download page/.test(document.body.innerText) && !/Downloading/.test(document.body.innerText)`), true);
  const opened = await evalIn(`(() => { const got = []; window.open = (u, t) => { got.push([String(u), t]); return null; };
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === 'Open download page'); if (!b) return 'no button'; b.click(); return JSON.stringify(got); })()`);
  assert.equal(opened, JSON.stringify([[TAG + newer, '_blank']]), 'the banner opened something other than the fixed tag page');

  // 2. a hostile manifest: the link is still built from the version under the fixed prefix
  await bootWith(JSON.stringify({ version: newer, url: 'https://evil.example/TrinityOneFinance.exe', pageUrl: 'https://evil.example/', link: 'javascript:alert(1)' }));
  await waitFor(banner, 15000, 'the update banner (hostile manifest)');
  const opened2 = await evalIn(`(() => { const got = []; window.open = (u, t) => { got.push([String(u), t]); return null; };
    [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === 'Open download page').click(); return JSON.stringify(got); })()`);
  assert.equal(opened2, JSON.stringify([[TAG + newer, '_blank']]), 'a url from the manifest was used');

  // 3. nothing to offer
  const none = [
    ['the same version', JSON.stringify({ version: installed })],
    ['a prerelease', JSON.stringify({ version: '1.2.0-rc1' })],
    ['a prerelease of the next version', JSON.stringify({ version: newer + '-rc1' })],
    ['a malformed version', JSON.stringify({ version: 'one.two' })],
    ['a body that is not JSON', '<html>not json</html>'],
  ];
  if (older) none.push(['an older version', JSON.stringify({ version: older })]);
  for (const [what, body] of none) {
    await bootWith(body);
    assert.equal(await evalIn(banner), false, 'a banner for ' + what);
  }
  await bootWith(JSON.stringify({ version: newer }), { cors: false });
  assert.equal(await evalIn(banner), false, 'INSTRUMENT: without Access-Control-Allow-Origin the page still read the manifest — the CORS header is not what this depends on');

  assert.deepEqual(log.errors, [], 'the bundle threw:\n  ' + log.errors.join('\n  '));
  const out = log.blocked.filter((u) => !/^https:\/\/app\.trinityone\.church\//.test(u));
  assert.deepEqual(out, [], 'the program fetched from outside its bundle: ' + JSON.stringify(out));
});
