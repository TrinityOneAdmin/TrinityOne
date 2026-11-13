// A WAITING HELPER UNLOCKS ONTO THE WAITING SCREEN, AND THE GRANT STILL MOVES THEM ON — WITH NO SOCKET BEFORE UNLOCK.
//   Run: node --test scripts/a-waiting-helper-unlocks-onto-the-waiting-screen.test.mjs
//
// b8aae006 (part 3) put useStewardStewardedChurches() at the ROOT so StewardRoot can show a helper who has asked to
// help a church, and not yet been approved, StewardAwaitingApproval instead of an empty console — and move them on
// the moment the grant lands. Bug B (2026-11-13) gated that hook on an UNLOCKED console (it was dialling the relay
// from behind the PIN screen). This file proves the gate did not break the screen it exists for:
//
//   1. Reloaded to the PIN screen, the helper's console opens no socket to the relay.
//   2. After unlock the helper lands on "Waiting for … to approve you", and NOTHING else is painted first — no
//      dashboard, no empty console — between the unlock and the first stewarded-churches answer (every DOM
//      mutation is sampled from before the unlock).
//   3. When the church's owner lists the helper on its roster, the waiting screen gives way to the church
//      (the console acts as it) without a reload.
//
// The setup uses the engine's own calls behind the "Help run a church" button (createKeyQuiet, requestSteward,
// setPin, enterConsole — the same calls StewardWelcome makes); everything asserted is the real StewardRoot in
// headless chromium against a real gateway. Skips itself when chromium is unavailable.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, nip19 } from 'nostr-tools';
import * as H from './relay-network-harness.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PIN = 'cedar-harbour-lamp-42';
const LOCKED_HOLD_MS = 8000;

let relay, chr, ws, prof, evalIn, helper = '', relayUrl = '';
const B = H.key();   // the church the helper asks to help; its owner is this test

async function waitFor(expr, ms = 60000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await evalIn(expr)) return true; } catch {} await sleep(300); }
  throw new Error('timed out waiting for: ' + label);
}
const typePh = (ph, val) => `(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(ph)})); if(!i) return 'miss';
  const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
const click = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`;
const pinScreen = `[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('Your PIN or passphrase'))`;
const waiting = `/Waiting for .* to approve you/.test(document.body.innerText || '')`;
const HOOK = (url) => `(() => { if (window.__hooked) return; window.__hooked = 1;
  const W = window.WebSocket; window.__dials = 0;
  const Wd = function (u, p) { if (String(u) === ${JSON.stringify(url)}) window.__dials++; return p === undefined ? new W(u) : new W(u, p); };
  Wd.prototype = W.prototype; for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Wd[k] = W[k]; window.WebSocket = Wd;
})();`;
// What the root is painting, sampled on EVERY DOM mutation: 'pin' | 'waiting' | 'console' | 'other'.
const WATCH = `(() => { window.__screens = []; const what = () => {
    const t = document.body.innerText || '';
    if ([...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('Your PIN or passphrase'))) return 'pin';
    if (/Waiting for .* to approve you/.test(t)) return 'waiting';
    if (document.querySelector('.stew-root') && document.querySelector('.stew-root').children.length) return 'console';
    return 'other'; };
  const note = () => { const w = what(); if (window.__screens[window.__screens.length - 1] !== w) window.__screens.push(w); };
  new MutationObserver(note).observe(document.documentElement, { subtree: true, childList: true, characterData: true }); note(); return 'ok'; })()`;

before(async () => {
  if (!CHROME) return;
  relay = await H.startRelay({ name: 'waiting-helper-unlock', env: { TRINITY_TAILSCALE_BIN: '/nonexistent' } });
  relayUrl = relay.base.replace(/^http/, 'ws') + '/relay';
  const reg = await fetch(relay.base + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + relay.adminToken },
    body: JSON.stringify({ addChurch: { npub: nip19.npubEncode(B.pub), name: 'Church B' } }) });
  assert.equal(reg.status, 200, 'the box would not register church B');
  const ts = Math.floor(Date.now() / 1000) - 5;
  await H.publishAll(relay, [
    finalizeEvent({ kind: 0, created_at: ts, tags: [], content: JSON.stringify({ name: 'Church B' }) }, B.sk),
    finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', 'trinityone/stewards:' + B.pub], ['t', 'trinityone']], content: JSON.stringify({ pubkeys: [] }) }, B.sk),
  ]);
  const cdp = await H.freePort('the waiting-helper test\'s Chrome debug port');
  prof = mkdtempSync(join(tmpdir(), 'trin-waithelp-chr-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=1280,1200', 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK(relayUrl) });
  await send('Page.navigate', { url: `${relay.base}/steward.html` });
  evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error('in-page: ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };
  await waitFor(`[...document.querySelectorAll('button')].some(x => /Help run a church/i.test((x.textContent||'').trim()))`, 90000, 'the welcome screen');
  // "Help run a church" -> paste the invite -> request sent -> set a PIN -> into the console (StewardWelcome's calls)
  helper = await evalIn(`(async () => { window.Steward.createKeyQuiet(); localStorage.setItem('trinityone.steward.wizard.done', '1');
    const r = await window.Steward.requestSteward(${JSON.stringify('trinityone-stewardinvite:' + nip19.npubEncode(B.pub))}, 'Waiting Helper');
    if (!r || !r.ok) return 'request failed: ' + JSON.stringify(r);
    await window.Steward.setPin(${JSON.stringify(PIN)}); window.Steward.enterConsole(); return window.Steward.churchPub; })()`);
  assert.match(String(helper), /^[0-9a-f]{64}$/, 'CONTROL: the helper could not send its request: ' + helper);
  await waitFor(waiting, 60000, 'CONTROL: the waiting screen straight after the request');
  await evalIn(`(location.reload(), 'ok')`);
  await sleep(1500);
});

after(async () => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  H.stopAll();
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
});

const SKIP = !CHROME ? 'no chromium' : false;

test('POINT OF USE: a waiting helper reloads to the PIN screen with no relay socket, unlocks straight onto the waiting screen, and the grant moves them on', { skip: SKIP, timeout: 240000 }, async () => {
  await waitFor(pinScreen, 90000, 'the unlock screen');
  await sleep(LOCKED_HOLD_MS);
  assert.equal(await evalIn('window.__dials'), 0, 'the helper\'s console dialled the relay while still LOCKED at the PIN screen');
  assert.equal(await evalIn(WATCH), 'ok');
  assert.equal(await evalIn(typePh('Your PIN or passphrase', PIN)), 'ok');
  assert.equal(await evalIn(click('/^Unlock/')), 'ok', 'no Unlock button');
  await waitFor(waiting, 60000, 'the waiting screen after unlock — a waiting helper was not shown it');
  await sleep(2000);
  const seen = await evalIn('window.__screens');
  const afterPin = seen.slice(seen.lastIndexOf('pin') + 1).filter(s => s !== 'other');
  assert.equal(afterPin[0], 'waiting', 'between the unlock and the waiting screen the root painted ' + JSON.stringify(seen) + ' — a flash of the wrong screen');
  assert.ok(!afterPin.includes('console'), 'after unlock the helper saw the console before/around the waiting screen: ' + JSON.stringify(seen));
  assert.ok(await evalIn(waiting), 'the waiting screen did not stay up while the request is outstanding');
  assert.ok((await evalIn('window.__dials')) > 0, 'CONTROL: the console never dialled the relay after unlock');
  // the owner approves: the roster now lists the helper
  await H.publishAll(relay, [finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', 'trinityone/stewards:' + B.pub], ['t', 'trinityone']], content: JSON.stringify({ pubkeys: [helper] }) }, B.sk)]);
  await waitFor(`!(${waiting}) && window.Steward.actingChurch === ${JSON.stringify(B.pub)}`, 60000, 'the waiting screen to give way to the granted church, without a reload');
});
