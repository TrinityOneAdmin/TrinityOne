// A RELAY RESERVES ITS NAME BEFORE IT IS PUBLIC — AND PUBLISHES IT WHEN PUBLIC ACCESS TURNS ON.
// Run: node --test scripts/a-relay-name-is-reserved-before-public.test.mjs   (own port 9017; never run concurrently)
//
// fix/reserve-relay-name-before-public. The relay-setup wizard's name step (and the dashboard's name card)
// POST the typed handle to /relay-names/mine. Before this change that handler REJECTED with a 400 whenever the
// relay was not yet reachable from the internet — but public access is deliberately the LAST setup step, so on a
// fresh box the name was always thrown away, contradicting the wizard's own copy ("others can type this once
// public access is on — that's the last step").
//
// Now, when the box is not public, the handler does a best-effort, FAIL-OPEN availability check against the
// directory and RESERVES the name locally (MY_RELAY_NAME + relay-myname.json). The EXISTING reclaimRelayName()
// — already called from startCloudflared() at go-public — publishes the signed directory claim once the box is
// public. When the box IS public, the handler is unchanged: an immediate signed directory claim.
//
// RULE 10 (RELAY-ADMISSION): reserving/registering a name changes only WHEN a name->address mapping is
// published, never WHICH relays a church admits. The resolve directory is discovery only; proveRelay still
// gates every connection. This test touches no relay list.
//
// NO CASE MAY TOUCH app.trinityone.church (memory: relay-bundle-publish-test-hits-the-network). The directory
// is stubbed on loopback (RELAY_DIRECTORY), and a blackhole preload REJECTS any fetch the gateway makes to the
// two hard-coded directory peers (app.trinityone.church, *.ts.net) so the fail-open path cannot reach the real
// network. The tunnel is a FAKE cloudflared that prints a trycloudflare URL and stays alive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { requireFreePort } from './test-ports.mjs';

const PORT = 9017;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A blackhole that REJECTS any fetch the gateway makes to the two hard-coded directory peers (and to a
// trycloudflare address), so the fail-open reserve path can never reach the real network when the stub is down.
function writeBlackhole(dir) {
  const p = join(dir, 'blackhole.mjs');
  writeFileSync(p, `const real = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const u = String(input && input.url ? input.url : input);
  if (/trinityone\\.church|\\.ts\\.net|trycloudflare/i.test(u)) return Promise.reject(new Error('blackholed by test: ' + u));
  return real.call(this, input, init);
};
`);
  return p;
}

// A fake cloudflared: prints a trycloudflare URL and the "Registered tunnel connection" line the gateway waits
// for, then stays alive (if it exits, the gateway clears CF_URL). No real tunnel, no network.
function writeFakeCloudflared(dir) {
  const p = join(dir, 'cloudflared');
  writeFileSync(p, '#!/bin/sh\necho "https://test-reserve.trycloudflare.com"\necho "Registered tunnel connection 1"\nexec sleep 60\n');
  chmodSync(p, 0o755);
  return p;
}

// A throwaway directory on loopback. `resolve(handle)` returns null for a 404 (free) or a record object for a
// 200. Every /relay-names/claim it receives is recorded (the go-public registration lands here).
function startStub(resolve) {
  return new Promise((done) => {
    const claims = [];
    const srv = createServer((req, res) => {
      const url = (req.url || '').split('?')[0];
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET' && url.startsWith('/relay-names/resolve/')) {
        const handle = decodeURIComponent(url.slice('/relay-names/resolve/'.length)).toLowerCase();
        const rec = resolve(handle);
        if (!rec) { res.writeHead(404); res.end('{"error":"no relay by that name"}'); return; }
        res.writeHead(200); res.end(JSON.stringify(rec)); return;
      }
      if (req.method === 'POST' && url === '/relay-names/claim') {
        let body = ''; req.on('data', c => { body += c; });
        req.on('end', () => { let bd = {}; try { bd = JSON.parse(body); } catch {} claims.push({ ...bd, auth: req.headers['authorization'] || '' }); res.writeHead(200); res.end('{"ok":true}'); });
        return;
      }
      res.writeHead(404); res.end('{}');
    });
    srv.listen(0, '127.0.0.1', () => done({ base: `http://127.0.0.1:${srv.address().port}`, claims, stop() { try { srv.close(); } catch {} } }));
  });
}

// Boot a real gateway with the directory stubbed and the blackhole in place. `public` sets RELAY_PUBLIC_URL;
// `fakeTunnel` installs the fake cloudflared. Caller kills via the returned handle.
async function boot(dir, stubBase, { publicUrl = '', fakeTunnel = false } = {}) {
  const preload = writeBlackhole(dir);
  const env = {
    ...process.env, TRINITY_DATA_DIR: dir, RELAY_SYNC: '0', RELAY_HOST: '127.0.0.1', RELAY_NO_OPEN: '1',
    RELAY_DIRECTORY: stubBase, RELAY_DIRECTORY_PEERS: '', TRINITY_TAILSCALE_BIN: '/nonexistent/tailscale',
    NODE_OPTIONS: '--import ' + preload,
  };
  if (publicUrl) env.RELAY_PUBLIC_URL = publicUrl;
  if (fakeTunnel) env.CLOUDFLARED_BIN = writeFakeCloudflared(dir);
  const proc = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; proc.stdout.on('data', d => { out += d; }); proc.stderr.on('data', d => { out += d; });
  let up = false;
  for (let i = 0; i < 200 && !up; i++) { try { up = (await fetch(BASE + '/status')).ok; } catch {} if (!up) await sleep(150); }
  assert.ok(up, 'the gateway never served /status\n' + out);
  const token = JSON.parse(readFileSync(join(dir, 'admin.json'), 'utf8')).token;
  return { proc, token, out, stop() { try { proc.kill('SIGKILL'); } catch {} } };
}

const auth = (token) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + token });
const nameFileHandle = (dir) => { try { return JSON.parse(readFileSync(join(dir, 'relay-myname.json'), 'utf8')).handle; } catch { return undefined; } };

test('NOT PUBLIC + the directory says the name is FREE → it is reserved locally (reserved:true, written to disk)', async () => {
  await requireFreePort(PORT, 'a-relay-name-is-reserved-before-public.test.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'trin-reserve-free-'));
  const stub = await startStub(() => null);   // 404 for every handle: the name is free
  let g = null;
  try {
    g = await boot(dir, stub.base);
    const r = await fetch(BASE + '/relay-names/mine', { method: 'POST', headers: auth(g.token), body: JSON.stringify({ handle: 'grace-city' }) });
    const j = await r.json();
    assert.equal(r.status, 200, 'a free name on a not-public box was not accepted: ' + JSON.stringify(j));
    assert.equal(j.ok, true);
    assert.equal(j.reserved, true, 'the response does not mark this a RESERVATION — the client cannot tell a reserve from a live claim: ' + JSON.stringify(j));
    assert.equal(j.handle, 'grace-city');
    assert.equal(nameFileHandle(dir), 'grace-city', 'the reserved name was not persisted to relay-myname.json, so it is lost on the next boot');
    // GET reflects it back to the dashboard, still not public
    const m = await (await fetch(BASE + '/relay-names/mine', { headers: { Authorization: 'Bearer ' + g.token } })).json();
    assert.equal(m.handle, 'grace-city');
    assert.equal(m.relayWss, '', 're-anchor: the box must still be not-public for this case to mean anything');
  } finally { if (g) g.stop(); stub.stop(); await sleep(250); rmSync(dir, { recursive: true, force: true }); }
});

test('NOT PUBLIC + the directory says the name is TAKEN by another relay → 409, nothing stored', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-reserve-taken-'));
  const otherPub = getPublicKey(generateSecretKey());
  const stub = await startStub((handle) => ({ handle, url: 'wss://someone-else.example.test/relay', pub: otherPub }));
  let g = null;
  try {
    g = await boot(dir, stub.base);
    const r = await fetch(BASE + '/relay-names/mine', { method: 'POST', headers: auth(g.token), body: JSON.stringify({ handle: 'grace-city' }) });
    const j = await r.json();
    assert.equal(r.status, 409, 'a name already held by ANOTHER relay was not refused: ' + JSON.stringify(j));
    assert.match(String(j.error || ''), /taken/i);
    assert.equal(nameFileHandle(dir), undefined, 'a name taken by someone else was still reserved on disk');
    const m = await (await fetch(BASE + '/relay-names/mine', { headers: { Authorization: 'Bearer ' + g.token } })).json();
    assert.equal(m.handle, '', 'the gateway now reports a handle it was told it could not have');
  } finally { if (g) g.stop(); stub.stop(); await sleep(250); rmSync(dir, { recursive: true, force: true }); }
});

test('NOT PUBLIC + the directory is UNREACHABLE → fail open, the name is reserved (an offline box is never blocked)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-reserve-down-'));
  let g = null;
  try {
    // Point the directory at a closed loopback port. The fall-through to the two hard-coded peers is blackholed,
    // so NOTHING reaches the real network; every peer errors and the reserve must still succeed.
    g = await boot(dir, 'http://127.0.0.1:1');
    const r = await fetch(BASE + '/relay-names/mine', { method: 'POST', headers: auth(g.token), body: JSON.stringify({ handle: 'grace-city' }) });
    const j = await r.json();
    assert.equal(r.status, 200, 'an offline/air-gapped first-run was BLOCKED when the directory could not be reached: ' + JSON.stringify(j));
    assert.equal(j.reserved, true, JSON.stringify(j));
    assert.equal(nameFileHandle(dir), 'grace-city', 'the name was not reserved when the directory was unreachable');
  } finally { if (g) g.stop(); await sleep(250); rmSync(dir, { recursive: true, force: true }); }
});

test('PUBLIC (ownUrl set) → the live signed directory claim path still runs (regression guard, unchanged)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-reserve-pub-'));
  const stub = await startStub(() => null);
  let g = null;
  try {
    g = await boot(dir, stub.base, { publicUrl: 'wss://pub.example.test/relay' });
    const r = await fetch(BASE + '/relay-names/mine', { method: 'POST', headers: auth(g.token), body: JSON.stringify({ handle: 'grace-city' }) });
    const j = await r.json();
    assert.equal(r.status, 200, 'the public claim path broke: ' + JSON.stringify(j));
    assert.equal(j.ok, true);
    assert.equal(j.reserved, undefined, 'a PUBLIC box answered with reserved:true — it must make a live claim, not a reservation: ' + JSON.stringify(j));
    assert.equal(j.url, 'wss://pub.example.test/relay', 'the live claim did not carry the public URL: ' + JSON.stringify(j));
    // the signed claim reached the directory (the stub recorded it)
    for (let i = 0; i < 20 && stub.claims.length === 0; i++) await sleep(100);
    assert.ok(stub.claims.some(c => c.handle === 'grace-city'), 'the public path did not post a signed claim to the directory: ' + JSON.stringify(stub.claims));
  } finally { if (g) g.stop(); stub.stop(); await sleep(250); rmSync(dir, { recursive: true, force: true }); }
});

test('REGISTER-ON-PUBLIC: a name reserved while not public is published to the directory when go-public runs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-reserve-go-'));
  const stub = await startStub(() => null);   // free, so the reserve succeeds
  let g = null;
  try {
    g = await boot(dir, stub.base, { fakeTunnel: true });
    // 1. reserve while not public
    const res = await (await fetch(BASE + '/relay-names/mine', { method: 'POST', headers: auth(g.token), body: JSON.stringify({ handle: 'grace-city' }) })).json();
    assert.equal(res.reserved, true, 'precondition: the name was not reserved: ' + JSON.stringify(res));
    // 2. go public — the fake tunnel comes up and finishOk() calls reclaimRelayName()
    const up = await (await fetch(BASE + '/tunnel/up', { method: 'POST', headers: { Authorization: 'Bearer ' + g.token } })).json();
    assert.equal(up.ok, true, 'the fake tunnel did not come up: ' + JSON.stringify(up) + '\n' + g.out);
    assert.equal(up.name, 'grace-city', 'go-public overwrote the RESERVED name (the pet-slug guard must preserve it): ' + JSON.stringify(up));
    // 3. reclaimRelayName() is fire-and-forget — wait for the signed claim to reach the directory
    for (let i = 0; i < 40 && !stub.claims.some(c => c.handle === 'grace-city'); i++) await sleep(150);
    const claim = stub.claims.find(c => c.handle === 'grace-city');
    assert.ok(claim, 'the RESERVED name was never published to the directory at go-public: ' + JSON.stringify(stub.claims));
    assert.match(String(claim.url || ''), /^wss:\/\/.+trycloudflare\.com\/relay$/, 'the published claim did not point at the new public URL: ' + JSON.stringify(claim));
    assert.match(String(claim.auth || ''), /^Nostr /, 'the claim carried no signed relay-identity authorization: ' + JSON.stringify(claim));
  } finally { if (g) g.stop(); stub.stop(); await sleep(400); rmSync(dir, { recursive: true, force: true }); }
});
