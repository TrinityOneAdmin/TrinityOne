// PROBE (not a test): a member who followed a church BEFORE that church connected its own relay then ADOPTS
// the box's address out of the church's signed trinityone/relay-net document — while KEEPING the shared /
// canonical relays — and the app UI stays RENDERED through the adoption. The on-device scenario minus the phone.
//
//   node scripts/member-adopts.probe.mjs
//
// WHAT IS REAL HERE, and what is not:
//   · The MEMBER is a real headless Chromium loading the real member app (vendor/fellowship.js) off a real
//     gateway. Nothing about the member is node-lifted.
//   · TWO real `node scripts/gateway.mjs` relays: S (shared relay; also serves the app) and T (the church's
//     own box). Each binds its own free port (never a fixed number — CLAUDE.md's port-collision trap).
//   · The signed relay-net document is a real kind-30078 event authored by the church key, PUBLISHED to S and
//     read back off the wire. Nothing injects churchRelayNet / netEntries / verify / the adoption result.
//   · T is ADOPTED: absent from the member's relay list before, present after. It is proved by a real
//     /relay-identity round trip to T (a different origin than the page), not pre-seeded and not origin-admitted.
//   · Production is BLACKHOLED at the resolver (app.trinityone.church / *.ts.net / trinityone.church -> 127.0.0.1:9)
//     exactly as scripts/named-invite.probe.mjs does, so the headless browser can never reach a real relay.
//     127.0.0.1 is NOT mapped, so S and T on loopback are reachable.
//
// WHY T IS REACHED OVER wss:// (a self-signed TLS front), not ws:// on loopback:
//   The shipped app ships a CSP whose connect-src is `'self' https: wss: ws:` — it has NO `http:`. On a real
//   phone this is a non-issue: the app is served from app.trinityone.church (https) and a church's OWN box is
//   reached at wss:// through its tunnel, so the /relay-identity proof fetch is https and allowed. The one
//   thing that is NOT allowed is a cross-origin *http://* fetch — which is exactly what a ws:// loopback box
//   on a different port would force. So T is fronted by a throwaway-TLS reverse proxy and dialled wss://,
//   matching how a phone reaches a second box; chromium is launched with --ignore-certificate-errors for the
//   self-signed cert, and nothing in the app is relaxed. T DECLARES that wss address via RELAY_PUBLIC_URL
//   (the same env a real tunnelled box uses), so its /relay-identity signs the address the client dialled.
//   S needs no TLS: the app is served from S, so S is same-origin ('self') and its own proof fetch is allowed.
//
// WHY A SECOND CHURCH KEY FOR THE CONTROL: churchRelayNet caches per-cp for 60s (RELAY_NET_TTL_MS). Running the
// control on the SAME church would cache an empty answer and block the primary for a minute. The control uses
// its own church whose doc names no box, so the two never interfere.

import { spawn, execFileSync } from 'node:child_process';
import { rmSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import * as H from './relay-network-harness.mjs';

const CHROME = ['/snap/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
if (!CHROME) { console.error('no chromium found'); process.exit(1); }

const OUTDIR = '/tmp/claude-1000';
try { mkdirSync(OUTDIR, { recursive: true }); } catch {}
const SHOT = join(OUTDIR, 'member-adopts-after.png');
const CDP = 9371;                                  // high, clear of the suite's chrome ports
const PROFILE = join(OUTDIR, 'member-adopts-chr-' + process.pid);
const KEYF = join(OUTDIR, 'member-adopts-proxy-key.pem');
const CRTF = join(OUTDIR, 'member-adopts-proxy-cert.pem');
const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const RELAY_NET_D = 'trinityone/relay-net';
const now = () => Math.floor(Date.now() / 1000);
let _docAt = now();
const relayNetDocFor = (church, rows) => finalizeEvent(
  { kind: 30078, created_at: ++_docAt, tags: [['d', RELAY_NET_D], ['t', 'trinityone']], content: JSON.stringify(rows) }, church.sk);
const mkChurch = () => { const sk = generateSecretKey(); const pub = getPublicKey(sk); return { sk, pub, npub: npubEncode(pub) }; };

let PASS = true;
const line = (s) => console.log(s);
const assert = (label, cond, extra) => { line((cond ? '  ASSERT PASS: ' : '  ASSERT FAIL: ') + label + (extra ? ('   ' + extra) : '')); if (!cond) PASS = false; };

const church = mkChurch();       // the primary church — its signed doc names box T
const church2 = mkChurch();      // the control church — its signed doc names NO box

// ── a throwaway-TLS reverse proxy: terminates https/wss, forwards to T's plain http/ws ───────────────────
let tTarget = 0;                                   // T's real http port, set once T is up
function startTlsProxy(cert, key) {
  const server = https.createServer({ cert, key }, (creq, cres) => {
    const preq = http.request({ host: '127.0.0.1', port: tTarget, method: creq.method, path: creq.url,
      headers: { ...creq.headers, 'x-forwarded-proto': 'https' } }, (pres) => { cres.writeHead(pres.statusCode, pres.headers); pres.pipe(cres); });
    preq.on('error', () => { try { cres.writeHead(502); cres.end(); } catch {} });
    creq.pipe(preq);
  });
  server.on('upgrade', (creq, csock, chead) => {
    const usock = net.connect(tTarget, '127.0.0.1', () => {
      let raw = `${creq.method} ${creq.url} HTTP/1.1\r\n`;
      for (let i = 0; i < creq.rawHeaders.length; i += 2) raw += `${creq.rawHeaders[i]}: ${creq.rawHeaders[i + 1]}\r\n`;
      raw += '\r\n';
      usock.write(raw);
      if (chead && chead.length) usock.write(chead);
      usock.pipe(csock); csock.pipe(usock);
    });
    usock.on('error', () => { try { csock.destroy(); } catch {} });
    csock.on('error', () => { try { usock.destroy(); } catch {} });
  });
  server.on('error', (e) => line('  [tls-proxy] ' + e.message));
  return server;
}

let S, T, chr, ws, proxy;
try {
  // ── self-signed cert for 127.0.0.1 (chromium ignores it; shape is still valid) ─────────────────────────
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', KEYF, '-out', CRTF,
    '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  proxy = startTlsProxy(readFileSync(CRTF), readFileSync(KEYF));
  await new Promise((res, rej) => { proxy.once('error', rej); proxy.listen(0, '127.0.0.1', res); });
  const PROXY_PORT = proxy.address().port;
  const T_DIAL = `wss://127.0.0.1:${PROXY_PORT}/relay`;   // how the member dials the box — exactly what the doc will name

  // ── two real gateways, church registered on both ───────────────────────────────────────────────────────
  line('\n=== standing up two real gateways (S = shared/app, T = the church box behind TLS) ===');
  S = await H.startRelay({ name: 'SHARED', churches: [church.pub, church2.pub] });
  // T declares the wss address the client will dial (its TLS front), the way a tunnelled box declares its public URL.
  T = await H.startRelay({ name: 'BOX', churches: [church.pub, church2.pub], env: { RELAY_PUBLIC_URL: T_DIAL } });
  tTarget = T.port;
  if (S.relayPub === T.relayPub) throw new Error('S and T came up as the same box — nothing below would mean anything');
  const APP = `http://127.0.0.1:${S.port}/`;
  line(`  S: ${S.base}  (serves app + relay ${S.wsUrl})  relayPub=${S.relayPub.slice(0, 12)}`);
  line(`  T: ${T.base}  dialled by the member as ${T_DIAL}  relayPub=${T.relayPub.slice(0, 12)}`);
  line(`  church npub:  ${church.npub}`);

  // ── headless chromium, production blackholed, self-signed cert accepted ────────────────────────────────
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu',
    '--ignore-certificate-errors',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    BLOCK_PROD, `--user-data-dir=${PROFILE}`, '--window-size=420,900', APP], { stdio: 'ignore' });

  let page = null;
  for (let i = 0; i < 80 && !page; i++) {
    await sleep(400);
    try { page = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find(p => p.type === 'page' && p.webSocketDebuggerUrl); } catch {}
  }
  if (!page) throw new Error('chromium never exposed a page over CDP');
  ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  let id = 0; const pending = new Map();
  const send = (m, p) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', d => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  await send('Page.enable', {}); await send('Runtime.enable', {});
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, allowUnsafeEvalBlockedByCSP: true })).result.value;
  const relays = async () => JSON.parse(await ev('JSON.stringify(window.Fellowship && window.Fellowship.relays || [])'));
  const bodyLen = async () => Number(await ev('(document.body.innerText||"").length'));
  const hasBrand = async () => !!(await ev('(document.body.innerText||document.documentElement.innerText||"").includes("TrinityOne") || !!document.querySelector(".to-splash,#root")'));

  // ── wait for the real app + its Fellowship API to load ─────────────────────────────────────────────────
  line('\n=== waiting for the real member app to load off S ===');
  let fellowshipUp = false;
  for (let i = 0; i < 60 && !fellowshipUp; i++) { await sleep(500); try { fellowshipUp = !!(await ev('!!(window.Fellowship && window.Fellowship.setChurch && window.Fellowship.setRelays && window.Fellowship.relayVerified)')); } catch {} }
  if (!fellowshipUp) throw new Error('window.Fellowship never appeared — the app did not boot');
  for (let i = 0; i < 20; i++) { const r = await ev('(()=>{const s=document.querySelector(".to-splash"); if(!s) return "gone"; try{s.click();}catch(e){} return "clicked";})()'); if (r === 'gone') break; await sleep(500); }
  for (let i = 0; i < 20 && (await bodyLen()) <= 200; i++) await sleep(500);
  line(`  app booted. body text length = ${await bodyLen()}, brand/root present = ${await hasBrand()}`);

  // ── the member's existing relay list: the shared pool (S) + the compiled canonical entries ─────────────
  const CANON = JSON.parse(await ev('JSON.stringify(window.Fellowship.CANONICAL_RELAYS||[])'));
  line('\n=== seeding the follower relay list: S + CANONICAL (the shared pool), NO box ===');
  line('  CANONICAL (blackholed at resolver): ' + JSON.stringify(CANON));
  await ev('window.Fellowship.setRelays(' + JSON.stringify([S.wsUrl, ...CANON]) + ')');
  line('  window.Fellowship.relays = ' + JSON.stringify(await relays()));

  const hasAll = (list, wants) => wants.every(w => list.includes(w));

  // ── CONTROL: a church whose signed doc names NO box ────────────────────────────────────────────────────
  line('\n=== CONTROL: church2 publishes a relay-net doc that names NO box ===');
  await H.publishAll(S, [relayNetDocFor(church2, [])]);
  line('  published church2 relay-net doc (content = []) to S');
  await ev('window.Fellowship.setChurch(' + JSON.stringify(church2.npub) + ')');
  await sleep(6000);                                 // let the fire-and-forget adopt read + settle (clears _adoptingNetDoc)
  const ctrl = await relays();
  line('  window.Fellowship.relays after setChurch(church2) = ' + JSON.stringify(ctrl));
  assert('CONTROL: box T NOT adopted when the church names no box', !ctrl.includes(T_DIAL));
  assert('CONTROL: shared pool (S + CANONICAL) retained', hasAll(ctrl, [S.wsUrl, ...CANON]));
  assert('CONTROL: app still rendered (body text > 200)', (await bodyLen()) > 200, 'len=' + (await bodyLen()));

  // ── BEFORE: the box is absent from the member's list ───────────────────────────────────────────────────
  line('\n=== BEFORE (primary): the member follows church but has never heard of box T ===');
  const before = await relays();
  line('  window.Fellowship.relays = ' + JSON.stringify(before));
  assert('BEFORE: box T is ABSENT from the relay list', !before.includes(T_DIAL), T_DIAL);
  assert('BEFORE: S + CANONICAL present', hasAll(before, [S.wsUrl, ...CANON]));

  // ── publish the church's REAL signed relay-net doc naming box T, read it back off the wire ─────────────
  line('\n=== the church signs a relay-net doc naming box T and publishes it to S ===');
  const doc = relayNetDocFor(church, [{ pubkey: T.relayPub, alwaysOn: true, url: T_DIAL }]);
  await H.publishAll(S, [doc]);
  const readback = await H.readAs(S, church, { kinds: [30078], authors: [church.pub], '#d': [RELAY_NET_D] }, 1200);
  const seen = readback.find(e => e.id === doc.id);
  const row = seen ? (JSON.parse(seen.content)[0] || {}) : {};
  assert('the signed doc is really on S (read back off the wire)', !!seen, seen ? ('names pubkey=' + String(row.pubkey).slice(0, 12) + ' url=' + row.url) : 'NOT FOUND');

  // ── trigger the member's normal launch path: setChurch drives adoptChurchNetDocAddresses ───────────────
  line('\n=== triggering the shipped launch path: window.Fellowship.setChurch(church) ===');
  await ev('window.Fellowship.setChurch(' + JSON.stringify(church.npub) + ')');
  let after = before;
  for (let i = 0; i < 50; i++) { after = await relays(); if (after.includes(T_DIAL)) break; await sleep(500); }
  line('  window.Fellowship.relays = ' + JSON.stringify(after));

  // ── AFTER: the box was adopted, the shared pool kept, and the admission was a real proof ───────────────
  line('\n=== AFTER adoption ===');
  assert('AFTER: box T is now in the relay list (ADOPTED, absent->present)', after.includes(T_DIAL), T_DIAL);
  assert('AFTER: S retained', after.includes(S.wsUrl));
  assert('AFTER: every CANONICAL entry retained (shared pool not dropped)', hasAll(after, CANON), JSON.stringify(CANON));
  const verified = await ev('window.Fellowship.relayVerified(' + JSON.stringify(T_DIAL) + ')');
  assert('AFTER: the gate ADMITS T (relayVerified true => T proved a relay-identity key)', verified === true, 'relayVerified=' + verified);
  // a direct, real /relay-identity round trip to T, proving the box answered with the key the doc named
  const provedPub = await ev('(async()=>{try{const p=await window.Fellowship.verifyRelayIdentity(' + JSON.stringify(T_DIAL) + ');return p?p.relayPub:null;}catch(e){return "ERR:"+String(e&&e.message||e)}})()');
  assert('AFTER: a real round trip to T returns a proof whose key == the key the church signed', provedPub === T.relayPub, 'proved=' + String(provedPub).slice(0, 16) + ' expected=' + T.relayPub.slice(0, 16));
  const pageHost = await ev('location.host');
  assert('AFTER: admission is NOT by origin — page origin (' + pageHost + ') differs from the box dialled (' + T_DIAL + ')', !T_DIAL.includes(pageHost));

  // ── BLANK-SCREEN CHECK ─────────────────────────────────────────────────────────────────────────────────
  line('\n=== blank-screen check after adoption ===');
  const len = await bodyLen();
  const brand = await hasBrand();
  const snippet = await ev('(document.body.innerText||"").replace(/\\s+/g," ").slice(0,160)');
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(SHOT, Buffer.from(r.data, 'base64'));
  line('  screenshot -> ' + SHOT);
  line('  body text (first 160 chars): ' + JSON.stringify(snippet));
  assert('BLANK-CHECK: body is NOT empty (innerText length > 200)', len > 200, 'len=' + len);
  assert('BLANK-CHECK: a real member screen is rendered (TrinityOne brand / #root present)', brand === true);

  line('\n=== RESULT: ' + (PASS ? 'ALL ASSERTS PASSED' : 'ONE OR MORE ASSERTS FAILED') + ' ===');
} catch (e) {
  PASS = false;
  line('\n!! PROBE ERROR: ' + (e && e.stack || e));
} finally {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  try { proxy && proxy.close(); } catch {}
  try { H.stopAll(); } catch {}
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch {}
  try { rmSync(KEYF, { force: true }); rmSync(CRTF, { force: true }); } catch {}
  try { setTimeout(() => process.exit(PASS ? 0 : 1), 3000).unref(); } catch {}
  process.exitCode = PASS ? 0 : 1;
}
