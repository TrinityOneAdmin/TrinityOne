// "GIVE PEOPLE THIS" NEVER HANDS OUT AN ADDRESS THAT WORKS ONLY ON THIS COMPUTER — AND IT FOLLOWS THE TUNNEL.
// Run: node --test scripts/the-share-address-is-one-a-member-can-reach.test.mjs
//
// BACKLOG, the owner's screenshot of 2026-09-19: under "Give people this" the relay panel printed
// http://127.0.0.1:8787/install, a loopback address, beside the words "share the address". It resolves, on a
// member's phone, to the member's phone.
//
// REPRODUCED at 3a8c980 before touching anything, and it was worse than the screenshot: with the quick tunnel
// UP (a stand-in cloudflared that prints what the gateway looks for), /relay-app/apk-status STILL answered
// shareUrl http://127.0.0.1:<port>/install and the QR encoded the same. The gateway's installBase() read the
// operator's typed appUrl or the Host header, never the tunnel this box had opened — so a Suite box could not
// hand out a reachable address without the operator typing one into the "What this relay serves" card.
//
// Two halves, one rule. The gateway: a loopback Host gets the tunnel (or the Funnel the panel last saw); a LAN
// Host is left alone, because a phone on the hall wifi is exactly the member this card is for. The panel:
// loopback is refused and says why in one sentence naming the button; LAN is printed and labelled; public is
// printed as it is — the console's installPageUrl() rule, reused. Point of use (rule 1): the panel is driven in
// a real browser and the DOM is read; the lifted-function rows run the shipped loadApkStatus() the way
// a-church-can-hand-out-the-app-from-its-own-box.test.mjs does, so the two cannot drift apart.
//
// NOTHING REACHES PRODUCTION: the shipped hosts are refused inside the gateway and resolve to a dead port in
// the browser; the "tunnel" is a shell script that prints two lines and sleeps; Tailscale is pointed at a
// binary that does not exist, which is what a Suite box looks like.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { freePort } from './relay-network-harness.mjs';
import { fnBody } from './test-slice.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const TUNNEL_HOST = 'stub-tunnel-for-tests.trycloudflare.com';

const BLACKHOLE = `const real = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const u = String(input && input.url ? input.url : input);
  if (/trinityone\\.church|\\.ts\\.net|trycloudflare/i.test(u)) return Promise.reject(new Error('blackholed by test: ' + u));
  return real.call(this, input, init);
};\n`;
// What startCloudflared() waits for: the trycloudflare URL and a "Registered tunnel connection" line, then a
// process that stays up. Two lines and a sleep are the whole of it.
const FAKE_CF = `#!/bin/sh
echo "INF |  https://${TUNNEL_HOST}  |" >&2
echo "INF Registered tunnel connection connIndex=0" >&2
while true; do sleep 1; done
`;

let gw = null;
async function startGateway() {
  const port = await freePort('the share-address test\'s gateway');
  const dataDir = mkdtempSync(join(tmpdir(), 'trin-share-'));
  const preload = join(dataDir, 'blackhole.mjs'); writeFileSync(preload, BLACKHOLE);
  const cf = join(dataDir, 'fake-cloudflared.sh'); writeFileSync(cf, FAKE_CF); chmodSync(cf, 0o755);
  const proc = spawn(process.execPath, [join(ROOT, 'scripts/gateway.mjs'), String(port)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_SYNC: '0', RELAY_HOST: '127.0.0.1', RELAY_NO_OPEN: '1',
      RELAY_DIRECTORY: 'http://127.0.0.1:9', TRINITY_TAILSCALE_BIN: '/nonexistent/tailscale', CLOUDFLARED_BIN: cf, NODE_OPTIONS: '--import ' + preload },
  });
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 200 && !up; i++) { try { up = (await fetch(base + '/status')).ok; } catch {} if (!up) await sleep(150); }
  assert.ok(up, 'the gateway never served /status');
  let token = '';
  for (let i = 0; i < 20 && !token; i++) { try { token = JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token || ''; } catch {} if (!token) await sleep(150); }
  assert.ok(token, 'the gateway minted no admin token');
  return { port, base, dataDir, proc, token, stop() { try { proc.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} } };
}
const auth = () => ({ Authorization: 'Bearer ' + gw.token });
const apkStatus = async () => (await fetch(gw.base + '/relay-app/apk-status', { headers: auth() })).json();
// A request with a Host header of the test's choosing — the thing a browser will not let a script set.
const getWithHost = (path, host) => new Promise((res, rej) => {
  const r = request({ host: '127.0.0.1', port: gw.port, path, method: 'GET', headers: { Host: host, ...auth() } }, (resp) => {
    let b = ''; resp.on('data', d => { b += d; }); resp.on('end', () => res({ status: resp.statusCode, body: b }));
  });
  r.on('error', rej); r.end();
});

async function startChrome(url) {
  const cdp = await freePort('the share-address test\'s Chrome debug port');
  const prof = mkdtempSync(join(tmpdir(), 'trin-share-chrome-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9, MAP *.trycloudflare.com 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD,
    `--user-data-dir=${prof}`, '--window-size=900,780', url], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  const evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr && rr.result && rr.result.exceptionDetails) {
      const e = rr.result.exceptionDetails;
      throw new Error('the page threw: ' + String((e.exception && e.exception.description) || e.text || 'threw').split('\n')[0]);
    }
    return rr && rr.result && rr.result.result ? rr.result.result.value : undefined;
  };
  return { evalIn, stop() { try { ws.close(); } catch {} try { chr.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} } };
}
// The share block as a person sees it: what is written, and what is actually on the screen.
const readShare = (c) => c.evalIn(`(() => {
  const t = (id) => { const e = document.getElementById(id); return e ? (e.textContent || '').trim() : null; };
  const shown = (id) => { const e = document.getElementById(id); return e ? getComputedStyle(e).display !== 'none' : null; };
  return JSON.stringify({ card: shown('installerCard'), h: t('installShareH'), p: t('installShareP'), url: t('installUrl'), urlShown: shown('installUrl'), qrShown: shown('installQr'), qrSrc: (document.getElementById('installQr') || {}).getAttribute ? document.getElementById('installQr').getAttribute('src') : null });
})()`);

before(async () => { gw = await startGateway(); });
after(() => { if (gw) gw.stop(); });

// ── the panel, driven, private then public ───────────────────────────────────────────────────────────────
test('a private Suite box prints no loopback address under "Give people this" — it says why and names the button; then the tunnel opens and the address follows',
  { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
  // The server's own answer to a loopback asker, before the tunnel: still the loopback address — that is the
  // input the panel must refuse, not a fixture. If this ever changes shape, the rest of the test is not
  // staging what it claims to.
  const before0 = await apkStatus();
  assert.equal(before0.shareUrl, gw.base + '/install', 'the staging is off: the box is not answering a loopback asker with a loopback address');
  const qrBefore = await (await fetch(gw.base + '/apks/qr.svg')).text();

  const c = await startChrome(gw.base + '/relay-app/control.html');
  try {
    let s = null;
    for (let i = 0; i < 30; i++) { await sleep(500); s = JSON.parse(await readShare(c)); if (s.card && s.h && s.h !== 'Give people this') break; }
    assert.ok(s && s.card, 'the installer card never appeared — the panel did not obtain the admin token from /local-token');
    assert.doesNotMatch(String(s.url), /127\.0\.0\.1|localhost/, 'THE PANEL PRINTS A LOOPBACK ADDRESS UNDER "GIVE PEOPLE THIS": ' + s.url);
    assert.equal(s.urlShown, false, 'a loopback address is on the screen to be shared');
    assert.equal(s.qrShown, false, 'the QR is on the screen, and it encodes the loopback address');
    assert.match(String(s.h), /not shareable/i, 'the heading still says "Give people this" over nothing anyone can use: ' + s.h);
    assert.match(String(s.p), /only on this computer/i, 'the card does not say the address works only on this computer: ' + s.p);
    assert.match(String(s.p), /Make it public/, 'the card does not name the button that gets an address people can use: ' + s.p);
    assert.match(String(s.p), /Reach members from anywhere/, 'the card does not say which card the button is in: ' + s.p);

    // Now "Make it public", the way the button does it. The panel notices the flipped state on its next tick
    // and re-reads the card — it must not sit on "Not shareable yet" for five minutes beside "On · public".
    const up = await (await fetch(gw.base + '/tunnel/up', { method: 'POST', headers: auth() })).json();
    assert.equal(up.ok, true, 'the stand-in tunnel did not come up: ' + JSON.stringify(up));
    const after1 = await apkStatus();
    assert.equal(after1.shareUrl, `https://${TUNNEL_HOST}/install`,
      'THE BOX STILL HANDS A LOOPBACK ASKER ITS LOOPBACK ADDRESS WITH THE TUNNEL UP: ' + after1.shareUrl + ' — installBase() is not folding CF_URL in');
    const qrAfter = await (await fetch(gw.base + '/apks/qr.svg')).text();
    assert.notEqual(qrAfter, qrBefore, 'the QR did not change when the address did — it still encodes the loopback address');
    for (let i = 0; i < 40; i++) { await sleep(500); s = JSON.parse(await readShare(c)); if (s.url === `https://${TUNNEL_HOST}/install`) break; }
    assert.equal(s.url, `https://${TUNNEL_HOST}/install`,
      'the panel did not pick the tunnel address up within 20s of going public — the card is still ' + JSON.stringify(s));
    assert.equal(s.urlShown, true, 'the shareable address is written but hidden');
    assert.equal(s.qrShown, true, 'the QR stays hidden with a shareable address to encode');
    assert.equal(s.h, 'Give people this', 'the heading did not return to "Give people this"');
    assert.match(String(s.p), /Point a phone camera/, 'the sentence did not return to the sharing instruction');
    assert.doesNotMatch(String(s.p), /only on this computer|own wifi/i, 'a public address is still labelled as local');
  } finally { c.stop(); }
});

// ── the gateway's rule, by Host header ───────────────────────────────────────────────────────────────────
test('a LAN asker keeps its LAN address even with the tunnel up — the hall-wifi member stays on the hall wifi', async () => {
  // the tunnel is up from the test above (or comes up here if this file is run with the other filtered out)
  const up = await (await fetch(gw.base + '/tunnel/up', { method: 'POST', headers: auth() })).json();
  assert.equal(up.ok, true, 'no tunnel');
  const r = await getWithHost('/relay-app/apk-status', '192.168.1.50:' + gw.port);
  assert.equal(r.status, 200, 'apk-status refused the LAN asker: ' + r.body.slice(0, 120));
  assert.equal(JSON.parse(r.body).shareUrl, 'http://192.168.1.50:' + gw.port + '/install',
    'a phone that reached the box over the hall wifi was handed the tunnel address, which would send its 80 MB download round the internet');
  const l6 = await getWithHost('/relay-app/apk-status', '[::1]:' + gw.port);
  assert.equal(JSON.parse(l6.body).shareUrl, `https://${TUNNEL_HOST}/install`, 'the IPv6 loopback spelling is not treated as loopback');
});

test('a box whose public road is a Tailscale Funnel hands a loopback asker the Funnel address', { timeout: 60000 }, async () => {
  // A second gateway with a stand-in `tailscale` CLI that answers the three calls tsState() makes, and no
  // cloudflared at all. The panel polls /tailscale/state every 4 s while open; that read is what warms the
  // cache installBase() consults, so the test makes the same read first.
  const port = await freePort('the Funnel gateway');
  const dataDir = mkdtempSync(join(tmpdir(), 'trin-share-ts-'));
  const preload = join(dataDir, 'blackhole.mjs'); writeFileSync(preload, BLACKHOLE);
  const ts = join(dataDir, 'fake-tailscale.sh');
  writeFileSync(ts, `#!/bin/sh
case "$1 $2" in
  "status --json") echo '{"BackendState":"Running","Self":{"DNSName":"stub-box.tailnet-test.ts.net."}}' ;;
  "serve status") echo '{"AllowFunnel":{"stub-box.tailnet-test.ts.net:443":true}}' ;;
  *) echo '' ;;
esac
`); chmodSync(ts, 0o755);
  const proc = spawn(process.execPath, [join(ROOT, 'scripts/gateway.mjs'), String(port)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_SYNC: '0', RELAY_HOST: '127.0.0.1', RELAY_NO_OPEN: '1',
      RELAY_DIRECTORY: 'http://127.0.0.1:9', TRINITY_TAILSCALE_BIN: ts, CLOUDFLARED_BIN: '/nonexistent/cloudflared', NODE_OPTIONS: '--import ' + preload },
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    let up = false;
    for (let i = 0; i < 200 && !up; i++) { try { up = (await fetch(base + '/status')).ok; } catch {} if (!up) await sleep(150); }
    assert.ok(up, 'the Funnel gateway never served /status');
    let token = '';
    for (let i = 0; i < 20 && !token; i++) { try { token = JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token || ''; } catch {} if (!token) await sleep(150); }
    const H = { Authorization: 'Bearer ' + token };
    const cold = await (await fetch(base + '/relay-app/apk-status', { headers: H })).json();
    assert.equal(cold.shareUrl, base + '/install', 'staging: before anything has asked Tailscale, the loopback asker gets loopback');
    const st = await (await fetch(base + '/tailscale/state', { headers: H })).json();
    assert.equal(st.publicUrl, 'https://stub-box.tailnet-test.ts.net', 'the stand-in tailscale was not read as a Funnel: ' + JSON.stringify(st));
    const warm = await (await fetch(base + '/relay-app/apk-status', { headers: H })).json();
    assert.equal(warm.shareUrl, 'https://stub-box.tailnet-test.ts.net/install',
      'with the Funnel known to the box, a loopback asker was still handed ' + warm.shareUrl);
  } finally { try { proc.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} }
});

test('the operator\'s typed address still wins over everything', async () => {
  const r = await fetch(gw.base + '/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ appUrl: 'https://grace.example' }) });
  assert.equal(r.status, 200, 'could not set appUrl: ' + await r.text());
  try {
    assert.equal((await apkStatus()).shareUrl, 'https://grace.example/install', 'a typed appUrl no longer wins over the tunnel');
  } finally {
    await fetch(gw.base + '/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ appUrl: '' }) });
  }
});

// ── the shipped function, run over the three kinds of address ────────────────────────────────────────────
// Same lift as a-church-can-hand-out-the-app-from-its-own-box.test.mjs §4, with the three share elements
// added to the DOM it writes into. relay-app/control.js ships unbundled (rule 3), so this RUNS it.
const CONTROL = readFileSync(join(ROOT, 'relay-app/control.js'), 'utf8');
function fakeDom(ids) {
  const els = new Map();
  for (const id of ids) els.set(id, { id, textContent: '', innerHTML: '', checked: false, href: '', style: {} });
  return { els, document: { getElementById: (id) => els.get(id) || null } };
}
async function runPanel(shareUrl) {
  const src = fnBody(CONTROL, 'async function loadApkStatus()', 'loadApkStatus');
  const dom = fakeDom(['apkHeld', 'installerCard', 'keepApkCurrent', 'installUrl', 'openInstall', 'installShareH', 'installShareP', 'installQr']);
  const globals = {
    document: dom.document,
    esc: (s) => String(s || '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])),
    authHeaders: () => ({ Authorization: 'Bearer t' }),
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ behind: false, holding: 2, keepCurrent: false, shareUrl, files: [] }) }),
  };
  const key = '__share_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map((k) => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + src + '\nexport { loadApkStatus };').toString('base64'));
  await mod.loadApkStatus();
  const g = (id) => dom.els.get(id);
  return { url: g('installUrl').textContent, urlDisplay: g('installUrl').style.display, qrDisplay: g('installQr').style.display, h: g('installShareH').textContent, p: g('installShareP').textContent };
}

test('loopback: refused, with the sentence and the button', async () => {
  const r = await runPanel('http://127.0.0.1:8787/install');
  assert.equal(r.url, '', 'the loopback address was written to the card');
  assert.equal(r.qrDisplay, 'none', 'the QR of a loopback address is shown');
  assert.match(r.h, /not shareable/i); assert.match(r.p, /only on this computer/i); assert.match(r.p, /Make it public/);
  for (const u of ['http://localhost:8787/install', 'http://[::1]:8787/install', 'http://0.0.0.0:8787/install']) {
    assert.equal((await runPanel(u)).url, '', u + ' was printed as shareable');
  }
});

test('LAN: printed and labelled as the church\'s own wifi, QR shown', async () => {
  const r = await runPanel('http://192.168.1.50:8787/install');
  assert.equal(r.url, 'http://192.168.1.50:8787/install', 'a LAN address was refused — on most church networks it is the only address there is');
  assert.equal(r.qrDisplay, 'block', 'the QR of a LAN address is hidden');
  assert.equal(r.h, 'Give people this');
  assert.match(r.p, /own wifi/i, 'a LAN address is not labelled as working on the church\'s wifi only');
  assert.match(r.p, /Make it public/, 'the LAN sentence does not say how to get an address that works anywhere');
});

test('public: printed as it is, QR shown, the ordinary sentence', async () => {
  const r = await runPanel('https://grace.example/install');
  assert.equal(r.url, 'https://grace.example/install');
  assert.equal(r.qrDisplay, 'block');
  assert.equal(r.h, 'Give people this');
  assert.match(r.p, /Point a phone camera/); assert.doesNotMatch(r.p, /only on this computer|own wifi/i);
});

test('no address at all: nothing printed, and the card says so rather than "—"', async () => {
  const r = await runPanel('');
  assert.equal(r.url, ''); assert.equal(r.qrDisplay, 'none'); assert.match(r.h, /no address/i);
});
