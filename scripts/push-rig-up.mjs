#!/usr/bin/env node
// ── AN ISOLATED iOS-PUSH TEST RIG ────────────────────────────────────────────────────────────────────────
//
// A THROWAWAY gateway on a FREE port behind an EPHEMERAL cloudflared quick tunnel, configured so that an iOS
// Simulator can adopt it via a church invite and a DM to the sim's member fires a REAL contentless APNs push.
// This is the launcher a human runs PERSISTENTLY; it stays up until Ctrl-C and tears everything down on exit.
//
// WHAT IT IS NOT. It never touches the live Living Word relay: not port 8000, not the named Tailscale funnel
// (trinityone.tailc028ed.ts.net), not the named CF tunnel (test.trinityone.church). It picks its OWN free port
// (asserted != 8000) and mints its OWN one-off trycloudflare.com quick-tunnel hostname. On exit it kills the
// gateway, kills cloudflared, and removes the scratch data dir.
//
// WHY RELAY_PUBLIC_URL IS SET (correctness-critical — the trap the brief warned about). The member app's
// adoptInviteRelays proves the relay with the C2 possession proof: it dials wss://<tunnel-host>/relay and the
// gateway must SIGN that exact address in its /relay-identity answer. gateway.mjs's relayIdentityUrl() signs
// the dialled Host ONLY if the box DECLARES it (_declaredAddresses), and _declaredAddresses() reads
// RELAY_PUBLIC_URL. We spawn cloudflared FIRST, learn the tunnel host, then start the gateway with
// RELAY_PUBLIC_URL=wss://<tunnel-host>/relay — so the proof the sim asks for succeeds. Omit this and the proof
// fails with HTTP 421 and the sim SILENTLY never adopts the rig.
//
// WHY THE REAL APNs SENDER IS WIRED (not the spy). gateway.mjs wires the real contentless-APNs sender when
// (and only when) TRINITY_APNS_KEY_FILE / _KEY_ID / _TEAM_ID are present and the .p8 parses, AND
// TRINITY_PUSH_SPY_FILE is NOT set (the spy wins when present). This launcher is the REAL rig, so it sets the
// APNs env and NOT the spy. (The in-process validation uses the spy — scripts/push-rig-adoption.test.mjs.)
//
// THE RELAY-NET VOUCH. We generate a throwaway TEST CHURCH, register it on the rig via CHURCH_NPUB, and
// publish the church's SIGNED relay-net document (d=trinityone/relay-net) naming the RIG RELAY'S identity
// pubkey. That is proveRelay's ROOT 3 — the church's own signature admitting its box — which is also what a
// real self-hosting church signs. (The rig would also be admitted as root 'software' on the bare possession
// proof, since a trycloudflare address is not one we ship; the signed doc is the correct, realistic path and
// is what publishSetFor routes the member's writes by.)

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GATEWAY = join(ROOT, 'scripts', 'gateway.mjs');
const CLOUDFLARED = join(process.env.HOME || '/root', '.local/bin/cloudflared');

// ── APNs credentials (paths only; the gateway reads the .p8). Overridable by env for a different key. ──────
const APNS = {
  TRINITY_APNS_KEY_FILE: process.env.TRINITY_APNS_KEY_FILE || '/mnt/storage/projects/TrinityOne-internal/secrets/AuthKey_DAY6C9W78Y.p8',
  TRINITY_APNS_KEY_ID: process.env.TRINITY_APNS_KEY_ID || 'DAY6C9W78Y',
  TRINITY_APNS_TEAM_ID: process.env.TRINITY_APNS_TEAM_ID || 'U57K64A4RR',
  TRINITY_APNS_TOPIC: process.env.TRINITY_APNS_TOPIC || 'com.trinityone.app',
};

const log = (...a) => console.log('[push-rig]', ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// A free loopback port, re-checked, asserted never to be the live relay's 8000.
function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

// ── teardown, idempotent, and registered for every exit path ──────────────────────────────────────────────
const children = [];     // { proc, name }
let scratchDir = '';
let tearingDown = false;
function teardown(code = 0) {
  if (tearingDown) return; tearingDown = true;
  for (const c of children) { try { c.proc.kill('SIGKILL'); } catch {} }
  if (scratchDir) { try { rmSync(scratchDir, { recursive: true, force: true }); } catch {} }
  log('torn down (gateway + cloudflared killed, scratch removed).');
  process.exit(code);
}
process.on('SIGINT', () => { log('Ctrl-C — tearing down…'); teardown(0); });
process.on('SIGTERM', () => teardown(0));
process.on('uncaughtException', (e) => { log('fatal:', e && e.message || e); teardown(1); });

async function waitForStatus(port, proc, ms = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (proc.exitCode !== null) throw new Error(`gateway exited (code ${proc.exitCode}) before serving /status`);
    try { const r = await fetch(`http://127.0.0.1:${port}/status`); if (r.ok) return await r.json(); } catch {}
    await sleep(200);
  }
  throw new Error(`gateway never served /status on ${port} within ${ms}ms`);
}

// Publish one event to the rig over its loopback websocket and wait for the relay's OK.
function publish(wsUrl, ev) {
  return new Promise((resolve, reject) => {
    const w = new WebSocket(wsUrl);
    const t = setTimeout(() => { try { w.close(); } catch {} reject(new Error('publish timeout for ' + ev.id.slice(0, 8))); }, 10000);
    w.on('open', () => w.send(JSON.stringify(['EVENT', ev])));
    w.on('error', (e) => { clearTimeout(t); reject(e); });
    w.on('message', (d) => {
      let m; try { m = JSON.parse(d); } catch { return; }
      if (m[0] === 'OK' && m[1] === ev.id) { clearTimeout(t); try { w.close(); } catch {} ; (m[2] ? resolve(m[3] || '') : reject(new Error('relay refused: ' + (m[3] || '')))); }
    });
  });
}

// Spawn cloudflared and resolve once we have BOTH the trycloudflare URL and a registered edge connection —
// the gateway's own tunnel code uses the same two-signal rule, because the URL prints before the edge is up.
function startCloudflared(port) {
  return new Promise((resolve, reject) => {
    if (!existsSync(CLOUDFLARED)) { reject(new Error('cloudflared not found at ' + CLOUDFLARED)); return; }
    const proc = spawn(CLOUDFLARED, ['tunnel', '--no-autoupdate', '--url', 'http://localhost:' + port], { stdio: ['ignore', 'pipe', 'pipe'] });
    children.push({ proc, name: 'cloudflared' });
    let url = '', registered = false, done = false;
    const onData = (d) => {
      const s = String(d);
      const m = s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i); if (m) url = m[0];
      if (/Registered tunnel connection|Connection [0-9a-f-]+ registered/i.test(s)) registered = true;
      if (url && registered && !done) { done = true; resolve(url); }
    };
    proc.stdout.on('data', onData); proc.stderr.on('data', onData);
    proc.stdout.on('error', () => {}); proc.stderr.on('error', () => {});
    proc.on('exit', () => { if (!done) { done = true; reject(new Error('cloudflared exited before the tunnel was up')); } });
    setTimeout(() => { if (!done) { done = true; reject(new Error('cloudflared did not come up within 40s')); } }, 40000);
  });
}

async function main() {
  // 1. port + scratch
  const port = await freePort();
  if (port === 8000) throw new Error('refusing to use port 8000 (the live Living Word relay)');
  scratchDir = mkdtempSync(join('/tmp', 'trin-pushrig-'));
  log('port', port, '· data dir', scratchDir);

  // 2. ephemeral quick tunnel FIRST, so we can declare its host to the gateway
  log('bringing up an ephemeral cloudflared quick tunnel…');
  const tunnelUrl = await startCloudflared(port);          // https://<rand>.trycloudflare.com
  const tunnelHost = new URL(tunnelUrl).host;
  const rigWss = 'wss://' + tunnelHost + '/relay';
  log('tunnel up:', tunnelUrl);

  // 3. the gateway, declaring the tunnel address and with the REAL APNs sender wired
  const church = (() => { const sk = generateSecretKey(); const pub = getPublicKey(sk); return { sk, pub, npub: npubEncode(pub) }; })();
  const gw = spawn(process.execPath, [GATEWAY, String(port)], {
    cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
      TRINITY_DATA_DIR: scratchDir,
      RELAY_PUBLIC_URL: rigWss,         // ← makes relayIdentityUrl() sign the tunnel address (adoption proof)
      CHURCH_NPUB: church.npub,         // ← registers the test church on this box
      RELAY_SYNC: '0',                  // isolated rig: no background peer sync
      RELAY_MAX_EVENTS: '20000',
      ...APNS,                          // ← real contentless-APNs sender (NO spy here)
    },
  });
  children.push({ proc: gw, name: 'gateway' });
  const st = await waitForStatus(port, gw);
  const rigRelayPub = st.relayPub;
  if (!/^[0-9a-f]{64}$/i.test(String(rigRelayPub || ''))) throw new Error('gateway served /status without a usable relayPub');
  log('gateway up · rig relay identity pubkey', rigRelayPub);

  // 4. the church's SIGNED relay-net document, vouching the rig relay's identity pubkey (proveRelay root 3).
  //    Shape parseRelayNet() accepts: [{pubkey, alwaysOn, url?}]. pubkey is what admission reads; url is a hint.
  const relayNetContent = [{ pubkey: rigRelayPub, url: rigWss, alwaysOn: true }];
  const relayNetEvent = finalizeEvent(
    { kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', 'trinityone/relay-net'], ['t', 'trinityone']], content: JSON.stringify(relayNetContent) },
    church.sk);
  await publish('ws://127.0.0.1:' + port + '/relay', relayNetEvent);
  log('published the church-signed relay-net doc to the rig.');

  // 4b. the church's OPEN join-policy doc — checkChurch() (fellowship.src.js) confirms a church EXISTS via this
  //     doc; without it the member app's follow gets "No church found". Open-join (approval:false) so the sim
  //     self-joins with no steward approval. church-signed (owner-only at the relay door).
  const joinPolicyEvent = finalizeEvent(
    { kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', 'trinityone/joinpolicy:' + church.pub]], content: JSON.stringify({ approval: false }) },
    church.sk);
  await publish('ws://127.0.0.1:' + port + '/relay', joinPolicyEvent);
  // 4c. a kind-0 profile so the church shows a name rather than "Church".
  const profileEvent = finalizeEvent(
    { kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify({ name: 'Push Test Church' }) },
    church.sk);
  await publish('ws://127.0.0.1:' + port + '/relay', profileEvent);
  // persist the church key (hex, 0600) to the scratch dir so further church-signed docs can be published without a relaunch.
  const keyFile = join(scratchDir, 'church-key.json');
  writeFileSync(keyFile, JSON.stringify({ sk: Buffer.from(church.sk).toString('hex'), pub: church.pub, npub: church.npub }), { mode: 0o600 });
  log('published joinpolicy (open-join) + kind-0 name; church key saved to', keyFile);

  // 5. the three handoff artifacts
  const invite = tunnelUrl + '/?follow=' + church.npub + '&relay=' + encodeURIComponent(rigWss);
  const line = '─'.repeat(78);
  console.log('\n' + line);
  console.log('  iOS-PUSH TEST RIG IS UP.  (Ctrl-C to tear it all down.)');
  console.log(line);
  console.log('\n  (1) RIG RELAY (wss):\n      ' + rigWss);
  console.log('\n  (2) TEST-CHURCH INVITE  — open this on the iOS Simulator to follow the church and adopt the rig:');
  console.log('      ' + invite);
  console.log('\n  (3) CHURCH-SIGNED relay-net DOC  (proveRelay root 3 vouch for the rig relay pubkey):');
  console.log('      church npub : ' + church.npub);
  console.log('      church pub  : ' + church.pub);
  console.log('      rig relayPub: ' + rigRelayPub);
  console.log('      doc content : ' + JSON.stringify(relayNetContent));
  console.log('      doc event   : ' + JSON.stringify(relayNetEvent));
  console.log('      joinpolicy  : open-join (approval:false) + kind-0 name "Push Test Church" published ✓');
  console.log('\n  APNs: real contentless sender wired from ' + APNS.TRINITY_APNS_KEY_FILE);
  console.log('        (key ' + APNS.TRINITY_APNS_KEY_ID + ', team ' + APNS.TRINITY_APNS_TEAM_ID + ', topic ' + APNS.TRINITY_APNS_TOPIC + ')');
  console.log('\n  NEXT: on the sim, open invite (2); once joined, register the sim member and send it a DM —');
  console.log('        the rig sends a real contentless APNs push to the sim member\'s token.');
  console.log('\n' + line + '\n');

  // 6. stay up; if either child dies, bring the whole rig down rather than advertise a dead address
  gw.on('exit', (c) => { log('gateway exited (' + c + ')'); teardown(1); });
  children.find(c => c.name === 'cloudflared').proc.on('exit', () => { log('cloudflared exited'); teardown(1); });
  await new Promise(() => {});   // forever, until a signal
}

main().catch((e) => { log('startup failed:', e && e.message || e); teardown(1); });
