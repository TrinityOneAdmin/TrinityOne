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
import { mkdtempSync, rmSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort } from './relay-network-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const TUNNEL_HOST = 'stub-tunnel-for-tests.trycloudflare.com';

const BLACKHOLE = `const real = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const u = String(input && input.url ? input.url : input);
  if (/trinityone\\.church|\\.ts\\.net|trycloudflare/i.test(u)) return Promise.reject(new Error('blackholed by test: ' + u));
  return real.call(this, input, init);
};\n`;
// What startCloudflared() waits for: the trycloudflare URL and a "Registered tunnel connection" line, then a
// process that stays up. Two lines and a sleep are the whole of it — and the sleep ends when the gateway
// that spawned it is gone, because SIGKILL on the gateway does not reach its children and the first cut of
// this left ten of these loops running for ever (measured: one per test run, until pkill).
const FAKE_CF = `#!/bin/sh
echo "INF |  https://${TUNNEL_HOST}  |" >&2
echo "INF Registered tunnel connection connIndex=0" >&2
P=$PPID; while kill -0 $P 2>/dev/null; do sleep 1; done
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


before(async () => { gw = await startGateway(); });
after(() => { if (gw) gw.stop(); });

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

