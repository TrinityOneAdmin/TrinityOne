// THE FAMILY SHEET COMES BACK WHEN THE RADIO DOES — on its own, and when the parent taps "Try again".
// Run: node --test scripts/the-family-sheet-comes-back-with-the-radio.test.mjs
//
// Device round 2026-10-01 (Oppo, Android 12, build 24bdefd). A parent with a linked child and a PIN launched the
// app in airplane mode, unlocked, opened You → Children's accounts ("Couldn't reach your church just now") and
// switched the radio back on. The sheet stayed on "Couldn't reach" for 5 min 40 s, with
// Fellowship.relaysHealthy() true and relayReady() false the whole time; Home + reopen fixed it in 5 s.
//
// What was happening, reproduced here before the fix (the sheet still said "Couldn't reach" 150 s after the
// radio came on): every subscription the app made while offline had failed and closed. The FIRST socket to
// come back was opened by the outbox retrying the unlock's queued join announce — a PUBLISH. nostr-tools fires
// its connection-success hook only on its subscribe path, and the engine's handler treated any first socket as
// "first sight" anyway, so `trinity-relay-returned` never fired and nothing re-subscribed. The relay challenges
// only a gated REQ, so the phone never authenticated (relayReady false); and the 90-second beat skips whenever
// relaysHealthy() is true — which it now was. The two runs on the phone that DID recover are the ones where
// the beat came round before the outbox's retry; the timings in device-round-1001/NOTES.txt fit that order.
//
// This drives the REAL member app (index.html, the shipped vendor bundles, the .jsx compiled in the page) in
// headless Chromium against a REAL gateway. Between them sits a "radio": an HTTP forwarder that always serves
// the app's own files (on a phone they are inside the APK) and refuses everything that is network — the relay
// socket, /relay-identity, /status — while it is off. Nothing here matches source text (CLAUDE.md rule 3); it
// reads what the sheet SAYS.
//
// Skips itself when chromium is unavailable, like the other browser tests. Fixed ports, each pre-flighted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import * as nip44 from 'nostr-tools/nip44';
import { requireFreePort } from './test-ports.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const PORT = 8961, PORT_RADIO = 8962, CDP = 9376;   // unique across scripts/*.test.mjs and scripts/*.probe.mjs
const ROOT = new URL('..', import.meta.url).pathname;
const RELAY = `ws://127.0.0.1:${PORT_RADIO}/relay`;   // what the phone dials: through the radio
const DIRECT = `ws://127.0.0.1:${PORT}/relay`;        // what the church's console uses: always reachable
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const churchSk = generateSecretKey(), CP = getPublicKey(churchSk), NPUB = npubEncode(CP);
const KID = getPublicKey(generateSecretKey());
const KID_NAME = 'Cleo Radio';
let gateway, dataDir, radio, b, me;

// ── the radio ────────────────────────────────────────────────────────────────────────────────────────────────
const APP_FILE = /\.(html|js|jsx|mjs|css|json|woff2?|ttf|png|svg|ico|webmanifest|txt|map|jpg|jpeg|webp)$/i;
const NETWORK = /^\/(relay|status|relay-identity|public|feed|modules|api|upload|media|blossom|push|nip05|\.well-known)/i;
function makeRadio(listenPort, toPort) {
  let up = false; const live = new Set();
  const server = http.createServer((req, res) => {
    const path = (req.url || '/').split('?')[0];
    if (!up && !((path === '/' || APP_FILE.test(path)) && !NETWORK.test(path))) { req.socket.destroy(); return; }
    const fwd = http.request({ host: '127.0.0.1', port: toPort, method: req.method, path: req.url, headers: req.headers },
      (r2) => { res.writeHead(r2.statusCode, r2.headers); r2.pipe(res); });
    fwd.on('error', () => { try { req.socket.destroy(); } catch {} });
    req.pipe(fwd);
  });
  server.on('upgrade', (req, sock, head) => {
    if (!up) { sock.destroy(); return; }
    const u = net.connect(toPort, '127.0.0.1', () => {
      let raw = req.method + ' ' + req.url + ' HTTP/1.1\r\n';
      for (let i = 0; i < req.rawHeaders.length; i += 2) raw += req.rawHeaders[i] + ': ' + req.rawHeaders[i + 1] + '\r\n';
      u.write(raw + '\r\n'); if (head && head.length) u.write(head);
      sock.pipe(u); u.pipe(sock);
    });
    live.add(sock); live.add(u);
    const kill = () => { try { sock.destroy(); } catch {} try { u.destroy(); } catch {} live.delete(sock); live.delete(u); };
    sock.on('error', kill); u.on('error', kill); sock.on('close', kill); u.on('close', kill);
  });
  return {
    listen: () => new Promise((res, rej) => { server.once('error', rej); server.listen(listenPort, '127.0.0.1', res); }),
    on: () => { up = true; },
    // airplane mode: every live socket dies at once, and nothing new gets through
    off: () => { up = false; for (const s of live) { try { s.destroy(); } catch {} } live.clear(); },
    close: () => new Promise((res) => { up = false; for (const s of live) { try { s.destroy(); } catch {} } try { server.closeAllConnections(); } catch {} server.close(() => res()); }),
  };
}

// ── the church's side: a guardian notice naming the child, sealed to the parent ─────────────────────────────
function publishAsChurch(evt) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(DIRECT);
    const t = setTimeout(() => { ws.close(); rej(new Error('no OK for ' + evt.id)); }, 8000);
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', evt])));
    ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m[0] === 'OK' && m[1] === evt.id) { clearTimeout(t); ws.close(); m[2] ? res(evt) : rej(new Error(m[3])); } });
    ws.on('error', rej);
  });
}
const guardNotice = (parentPub, obj) => finalizeEvent({ kind: 30078, created_at: now() - 5,
  tags: [['d', 'trinityone/guardnotice:' + parentPub], ['t', 'trinityone'], ['p', parentPub]],
  content: nip44.encrypt(JSON.stringify(obj), nip44.getConversationKey(churchSk, parentPub)) }, churchSk);

// ── one browser, driven over CDP ─────────────────────────────────────────────────────────────────────────────
// Every WebSocket the page opens is noted with the stack that opened it, once `__radioWatch` is set — so the test
// can show it reproduced the phone's order (a PUBLISH reopened the socket) rather than passing over a run in
// which something else happened to.
const WATCH = `(() => {
  const W = window.WebSocket;
  const Watched = function (url, p) {
    if (window.__radioWatch) (window.__radioOpened = window.__radioOpened || []).push({ url: String(url), at: performance.now(), stack: String(new Error().stack || '') });
    return p === undefined ? new W(url) : new W(url, p);
  };
  Watched.prototype = W.prototype;
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Watched[k] = W[k];
  window.WebSocket = Watched;
})();`;
async function browser() {
  const prof = mkdtempSync(join(tmpdir(), 'trin-radio-chr-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD,
    `--user-data-dir=${prof}`, '--window-size=420,900', 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map(); const errors = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.method === 'Runtime.exceptionThrown') { const e = m.params.exceptionDetails; errors.push((e.exception?.description || e.text || '').split('\n')[0]); }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: WATCH });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT_RADIO}/index.html` });
  const ev = async (expression) => { const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (rr.result?.exceptionDetails) throw new Error('in page: ' + JSON.stringify(rr.result.exceptionDetails.exception?.description || rr.result.exceptionDetails.text)); return rr.result?.result?.value; };
  const text = () => ev('((document.body && document.body.innerText) || "").replace(/\\s+/g, " ")');
  return {
    ev, errors, text,
    reload: async (ms) => { await send('Page.reload', { ignoreCache: false }); await sleep(ms); },
    waitText: async (re, ms = 30000, what = String(re)) => { const t0 = Date.now(); let t = ''; while (Date.now() - t0 < ms) { t = await text(); if (re.test(t)) return t; await sleep(500); } assert.fail(`waited ${ms}ms and never saw ${what}; screen reads: "${t.slice(0, 240)}"`); },
    // the LAST visible element whose own text starts with the label: the sheet sits on top of the screen behind it
    tap: async (label, sel = 'button, [role=button]') => { const hit = await ev(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => (e.innerText || '').trim().startsWith(${JSON.stringify(label)})); const el = els[els.length - 1]; if (!el) return false; el.click(); return true; })()`); assert.ok(hit, `nothing labelled "${label}" on screen`); await sleep(1200); },
    close: () => { try { ws.close(); } catch {} try { chr.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} },
  };
}
const openFamily = async () => { await b.tap('You'); await b.tap('Children’s accounts', 'button, [role=button], div'); };
async function unlockViaScreen() {
  await b.waitText(/Enter your PIN/, 40000, 'the PIN screen');
  const typed = await b.ev(`(() => { const i = [...document.querySelectorAll('input')].find(i => /pin/i.test(i.placeholder || '') || i.type === 'password'); if (!i) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '123456'); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  assert.ok(typed, 'no PIN field on the lock screen');
  await b.tap('Unlock');
}
// Airplane mode on, a cold launch, unlock, open the sheet, and wait for it to say it could not reach the church.
async function offlineLaunchToCouldntReach() {
  radio.off();
  await b.reload(2500);
  await unlockViaScreen();
  await openFamily();
  const t = await b.waitText(/Couldn’t reach your church just now/, 30000, '"Couldn’t reach your church" with the radio off');
  assert.ok(!t.includes(KID_NAME), 'CONTROL: the child is on screen with the radio off — the rig is not offline, or the lock did not clear the list');
  assert.equal(await b.ev('window.Fellowship.relayReady()'), false, 'CONTROL: relayReady() with the radio off');
}
const childShown = (t) => t.includes(KID_NAME) && /Linked by your steward|Linked & protected/.test(t);

before(async () => {
  await requireFreePort(PORT, 'the-family-sheet-comes-back-with-the-radio.test.mjs (gateway)');
  await requireFreePort(PORT_RADIO, 'the-family-sheet-comes-back-with-the-radio.test.mjs (radio)');
  await requireFreePort(CDP, 'the-family-sheet-comes-back-with-the-radio.test.mjs (Chrome debug port)');
  if (!CHROME) return;
  dataDir = mkdtempSync(join(tmpdir(), 'trin-radio-'));
  // the phone dials the relay THROUGH the radio, so that is the address the relay must declare and sign
  writeFileSync(join(dataDir, 'relay-addresses.json'), JSON.stringify([RELAY]));
  gateway = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore', env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: NPUB, RELAY_MAX_EVENTS: '5000' },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(200); }
  radio = makeRadio(PORT_RADIO, PORT); await radio.listen(); radio.on();

  // An onboarded member of the church, online; the church links them to a child; the sheet shows it; a PIN.
  b = await browser();
  await b.waitText(/TrinityOne/, 40000, 'the app to mount');
  me = await b.ev(`(async () => {
    localStorage.setItem('trinityone.onboarded', 'true');
    try { await window.TrinityIdentity.ready; } catch (e) {}
    await window.TrinityIdentity.regenerate();
    localStorage.setItem('trinityone.relays', JSON.stringify([${JSON.stringify(RELAY)}]));
    localStorage.setItem('trinityone.followedChurches', JSON.stringify([{ id: ${JSON.stringify(NPUB)}, npub: ${JSON.stringify(NPUB)}, name: 'Radio Test Church', initials: 'RT', sub: 'Followed' }]));
    localStorage.setItem('trinityone.activeChurch', JSON.stringify(${JSON.stringify(NPUB)}));
    return (window.TrinityIdentity.current || {}).pubkey;
  })()`);
  assert.match(String(me), /^[0-9a-f]{64}$/, 'no identity was created');
  await b.reload(2500);
  await b.waitText(/Today/, 40000, 'the Today screen');
  for (let i = 0; i < 60 && !(await b.ev('window.Fellowship.relayReady()')); i++) await sleep(500);
  assert.equal(await b.ev('window.Fellowship.relayReady()'), true, 'CONTROL: the member never reached the relay online');
  await publishAsChurch(guardNotice(me, { children: [KID], child: KID, name: KID_NAME, church: CP }));
  await openFamily();
  const t = await b.waitText(new RegExp(KID_NAME), 20000, 'the linked child online');
  assert.ok(childShown(t), 'CONTROL: online, the sheet does not show the child as linked');
  assert.equal(await b.ev(`window.TrinityIdentity.setPin('123456').then(() => true)`), true, 'the PIN was not set');
});
after(async () => {
  try { b && b.close(); } catch {}
  try { radio && await radio.close(); } catch {}
  try { gateway && gateway.kill('SIGKILL'); } catch {}
  try { dataDir && rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

test('after an offline launch, the sheet finds the linked child on its own once the relay is reachable — no reload, no tap', { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  await offlineLaunchToCouldntReach();
  // THE PHONE'S ORDER. The unlock queued the join announce in the outbox while offline; its retry is what reopens
  // the socket below, before the 90-second beat comes round. If it is not queued, this run cannot show the bug.
  const queued = await b.ev(`JSON.parse(localStorage.getItem('trinityone.outbox') || '[]').length`);
  assert.ok(queued > 0, 'PRECONDITION: nothing is queued in the outbox, so nothing but the 90-second beat will reopen the socket — this run cannot reproduce the phone');
  await b.ev(`window.__sameDocument = 'radio-1'; window.__radioOpened = []; window.__radioWatch = true; true`);
  radio.on();
  const t0 = Date.now();
  let t = '';
  while (Date.now() - t0 < 75000) { t = await b.text(); if (childShown(t)) break; await sleep(1000); }
  const opened = await b.ev('window.__radioOpened || []');
  assert.equal(await b.ev('window.__sameDocument'), 'radio-1', 'the page was reloaded — the point is that it recovers WITHOUT one');
  assert.ok(opened.length, 'no socket was opened after the radio came back at all');
  // The first socket after the radio came back was opened by a PUBLISH — the case the phone hit. (A run where a
  // subscription got there first is the case the 90-second beat always handled; it would prove nothing here.)
  assert.match(opened[0].stack, /\bpublish\b/i, 'PRECONDITION: the first socket after the radio came back was not opened by a publish, so this run did not reproduce the phone’s order. Stack:\n' + opened[0].stack.split('\n').slice(0, 8).join('\n'));
  assert.ok(childShown(t),
    `THE FAMILY SHEET STAYED STUCK after the radio came back (${Math.round((Date.now() - t0) / 1000)}s): the socket came back, nothing re-subscribed, ` +
    `and the relay was never asked for the parent's notice. Screen: "${t.slice(0, 200)}"`);
  assert.ok(!/Couldn’t reach your church/.test(t), 'the child is listed but the sheet still says it could not reach the church');
  assert.equal(await b.ev('window.Fellowship.relayReady()'), true, 'the sheet recovered but relayReady() is still false');
  assert.deepEqual(b.errors, [], `the app threw:\n  ${b.errors.join('\n  ')}`);
});

test('"Try again" on the sheet asks the church again at once — before anything else would have', { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  await b.ev(`(() => { window.TrinityIdentity.lock(); return true; })()`);
  await sleep(1500);
  await offlineLaunchToCouldntReach();
  radio.on();
  // NOTHING ELSE MAY BE ABOUT TO DO IT. The outbox's first retry after a launch is 45 s in (_obTick) and the beat
  // is 90 s; the tap must land, and the 8 s allowed for the answer must end, before either — otherwise a pass
  // here could be the automatic recovery the test above proves, and say nothing about the button.
  const at = await b.ev('performance.now()');
  assert.ok(at < 35000, `PRECONDITION: the rig reached the tap ${Math.round(at / 1000)}s after launch; it must be under 35s for the 8s window to close before the outbox's first retry at 45s`);
  await b.ev(`window.__sameDocument = 'radio-2'; true`);
  await b.tap('Try again');
  // the tap visibly does something: back to "Checking…" while it asks (or straight to the answer)
  const right = await b.text();
  assert.ok(/Checking with your church/.test(right) || childShown(right), 'tapping Try again left the sheet saying it could not reach the church, with nothing to show it is trying');
  const t0 = Date.now();
  let t = '';
  while (Date.now() - t0 < 8000) { t = await b.text(); if (childShown(t)) break; await sleep(500); }
  assert.ok(childShown(t), `"Try again" did not bring the child back within 8s of the tap. Screen: "${t.slice(0, 200)}"`);
  assert.ok(await b.ev('performance.now()') < 45000, 'PRECONDITION: the answer came after the outbox’s first retry could have fetched it');
  assert.equal(await b.ev('window.__sameDocument'), 'radio-2', 'the page was reloaded');
  assert.deepEqual(b.errors, [], `the app threw:\n  ${b.errors.join('\n  ')}`);
});
