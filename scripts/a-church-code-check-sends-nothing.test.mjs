// A CODE THAT IS NOT A CHURCH MUST NOT BE ANNOUNCED TO, NOT EVEN BY THE HEARTBEAT. Sim item 20 (2026-10-02).
// Run: node --test scripts/a-church-code-check-sends-nothing.test.mjs
//
// The defect: followChurch makes the church ACTIVE before checkChurch has answered, and app.jsx's membership heartbeat
// is an effect keyed on the active church -- so on the very render that followed the code it signed and queued a
// `member:<code>` document for something that might not be a church. M-9 had fixed followChurch's own announce and
// missed that one. The relay refuses such a document (rejected.log showed it, five times), so the harm is small, but
// the phone still sent and then retried a membership request for a code that was never a church.
//
// Driven in a real browser: the page follows a code by its ?follow= link and every websocket frame it SENDS is read.
// Nothing here reads app/*.jsx text (rule 3). Skips itself when chromium is unavailable.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const PORT = 8782, CDP = 9442;   // unique across scripts/*.test.mjs -- a duplicate fixed port deadlocks both files
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nowS = () => Math.floor(Date.now() / 1000);
let relay, dataDir;
const churchSk = generateSecretKey(), churchPub = getPublicKey(churchSk);
const churchNpub = npubEncode(churchPub);
const strangerPub = getPublicKey(generateSecretKey());   // a valid key that is NOT a church: nobody ever published a join policy for it
const strangerNpub = npubEncode(strangerPub);

async function waitReady(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(200); }
  throw new Error('relay not ready');
}

before(async () => {
  await requireFreePort(PORT, 'a-church-code-check-sends-nothing.test.mjs');
  await requireFreePort(CDP, 'a-church-code-check-sends-nothing.test.mjs (Chrome debug port)');
  if (!CHROME) return;
  dataDir = mkdtempSync(join(tmpdir(), 'trin-nochurch-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: churchNpub, RELAY_MAX_EVENTS: '5000' },
  });
  await waitReady();
  // The church, as the setup wizard leaves it: a profile and a join policy. checkChurch reads the join policy.
  const ws = new WebSocket(WS_URL);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  const put = (evt) => new Promise(res => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res(m[2]); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
  assert.equal(await put(finalizeEvent({ kind: 0, created_at: nowS(), tags: [], content: JSON.stringify({ name: 'St Test' }) }, churchSk)), true, 'church profile');
  assert.equal(await put(finalizeEvent({ kind: 30078, created_at: nowS(), tags: [['d', 'trinityone/joinpolicy:' + churchPub]], content: JSON.stringify({ approval: false }) }, churchSk)), true, 'church join policy');
  ws.close();
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// One browser, driven by hand. Returns helpers; the caller closes it.
async function open(profileTag) {
  const prof = join(tmpdir(), 'trin-chr-nochurch-' + process.pid + '-' + profileTag);
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  // Headless throttles timers on a page it considers hidden, so the splash's own dismissal never fires and the
  // app looks broken (scripts/onboarding-shot.probe.mjs was written after I nearly reported that as a bug).
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=420,900', `http://127.0.0.1:${PORT}/index.html`], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map(); const errors = []; const frames = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.method === 'Network.webSocketFrameSent') frames.push(String((m.params.response || {}).payloadData || ''));
    if (m.method === 'Runtime.exceptionThrown') { const e = m.params.exceptionDetails; errors.push((e.exception?.description || e.text || '').split('\n')[0]); }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  const js = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails));
    return r.result.result.value;
  };
  // The restore panes and the wizard are full-screen overlays (z-index 70/71) drawn OVER the running app, so
  // document.body.innerText is the app underneath them as well and matches almost anything. Read the overlay.
  const text = () => js(`(() => { const els = [...document.querySelectorAll('div')].filter(e => { const z = getComputedStyle(e).zIndex; return z === '70' || z === '71'; }); return els.length ? (els[els.length - 1].innerText || '') : ''; })()`);
  const pageText = () => js(`(document.body.innerText || '')`);
  const buttons = () => js(`JSON.stringify([...document.querySelectorAll('button')].map(b => (b.innerText || '').replace(/\\s+/g, ' ').trim()).filter(Boolean))`);
  // click the first button whose visible label contains this string — i.e. what a member's thumb does
  const click = async (label) => {
    const hit = await js(`(() => { const b = [...document.querySelectorAll('button')].find(e => ((e.innerText||'').indexOf(${JSON.stringify(label)}) >= 0)); if (!b) return false; b.click(); return true; })()`);
    assert.ok(hit, `no button on screen said "${label}" — buttons were: ${await buttons()}`);
    await sleep(600);
  };
  // poll until an expression is truthy; the app mounts slowly in headless with the production relays blackholed
  const waitFor = async (expr, ms = 25000, why = '') => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await js(expr)) return true; await sleep(500); }
    assert.fail(`timed out waiting for ${why || expr} — buttons were: ${await buttons()}`);
  };
  const hasButton = (label) => js(`[...document.querySelectorAll('button')].some(e => ((e.innerText||'').indexOf(${JSON.stringify(label)}) >= 0))`);
  const close = () => { try { ws.close(); } catch {} try { chr.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} };
  return { js, text, pageText, buttons, click, waitFor, hasButton, errors, close, frames };
}

// A first-run device pointed at the local relay, with the splash out of the way.
async function freshDevice(tag) {
  const d = await open(tag);
  await sleep(2500);
  await d.js(`localStorage.setItem('trinityone.relays', ${JSON.stringify(JSON.stringify([WS_URL]))})`);
  await d.js(`location.reload()`);
  // the splash sits over everything for a moment and dismisses itself on a timer; keep clicking it away
  for (let i = 0; i < 20; i++) {
    await d.js(`(() => { const s = document.querySelector('.to-splash'); if (s) s.click(); return 1; })()`);
    if (await d.hasButton('I’m new here')) break;
    await sleep(1000);
  }
  await d.waitFor(`[...document.querySelectorAll('button')].some(e => ((e.innerText||'').indexOf('I’m new here') >= 0))`, 20000, 'the welcome fork');
  return d;
}



// A phone that has been set up (onboarded) and pointed at the local relay, then opened on a follow link.
async function followByLink(tag, npub) {
  const d = await open(tag);
  await sleep(2500);
  await d.js(`(() => { localStorage.setItem('trinityone.relays', ${JSON.stringify(JSON.stringify([WS_URL]))}); localStorage.setItem('trinityone.onboarded', 'true'); return 1; })()`);
  await d.js(`location.href = '/index.html?follow=' + ${JSON.stringify(npub)}`);
  return d;
}
const announcesTo = (d, hex) => d.frames.filter(f => f.includes('trinityone/member:' + hex));
const followed = (d) => d.js(`localStorage.getItem('trinityone.followedChurches') || '[]'`);

test('a code that is not a church is dropped and the phone never sends a membership document for it', { skip: !CHROME ? 'no chromium' : false, timeout: 180000 }, async () => {
  const d = await followByLink('stranger', strangerNpub);
  try {
    // Wait for the church check to FINISH -- the app says "No church found for that code." when it concludes -- otherwise
    // "nothing was sent" could simply mean the app had not got round to it yet. (Polled fast: the toast is brief.)
    const t0 = Date.now(); let said = false;
    while (Date.now() - t0 < 90000 && !said) { said = await d.js(`(document.body.innerText || '').includes('No church found for that code')`); if (!said) await sleep(200); }
    assert.ok(said, 'the church check never concluded "not found" for a code that is not a church');
    assert.doesNotMatch(await followed(d), new RegExp(strangerNpub.slice(0, 20)), 'the code is still followed after "not found"');
    await sleep(3000);   // let any heartbeat or queued join that was going to go, go
    assert.deepEqual(announcesTo(d, strangerPub), [], 'the phone sent a membership document for a code that is not a church');
  } finally { d.close(); }
});

test('a real church still gets its membership document (so the test above is not passing because nothing is ever sent)', { skip: !CHROME ? 'no chromium' : false, timeout: 180000 }, async () => {
  const d = await followByLink('real', churchNpub);
  try {
    await d.waitFor(`(localStorage.getItem('trinityone.followedChurches') || '').includes(${JSON.stringify(churchNpub.slice(0, 20))})`, 40000, 'the church to be followed');
    const t0 = Date.now();
    while (Date.now() - t0 < 60000 && !announcesTo(d, churchPub).length) await sleep(500);
    assert.ok(announcesTo(d, churchPub).length >= 1, 'following a real church sent no membership document at all -- the join is broken, not just gated');
  } finally { d.close(); }
});
