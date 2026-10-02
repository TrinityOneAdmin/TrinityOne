// A BRAND-NEW CHURCH'S FIRST SESSION, DRIVEN THE WAY A STEWARD DRIVES IT. Not a test: imported by the tests that
// need one (a-new-church-signs-in-on-its-own, a-new-church-gets-its-keys-in-its-first-session, …).
//
// WHAT IT DOES. Starts a real gateway on a free port (never 8000) with a fresh data directory, opens the real
// console (steward.html) in headless chromium, and makes a church the real way — Start a new church, a PIN, the
// wizard's name step, the recovery-words quiz — then either stops at the wizard's rooms step ('rooms') or ends
// setup with "Skip setup" and waits for the dashboard ('skip'). It does NOT reload and it does not open a tab:
// a new church's first session is exactly what this exists to stand in.
//
// WHAT IT KEEPS. Every frame the console sends to / receives from the relay (CDP, with the time it was seen),
// so a test can say when the first AUTH challenge arrived and what the console sent; and a RAW LOGGING
// SUBSCRIBER — a plain WebSocket signed in as the church — that records every event the relay passes it with the
// time, because the relay keeps only the newest copy of a replaceable document and a test that asks the
// database afterwards cannot see a key envelope that was written and then replaced.
//
// WHY ONE FILE. CLAUDE.md rule 1 asks for a test at the point of use, and the point of use here is a console in
// a browser over a socket to a relay; three tests need that, and three copies of 150 lines of CDP are three
// places for a wizard change to break quietly. Derived from scripts/console-keys-follow-the-church-switch.test.mjs.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { privateKeyFromSeedWords } from 'nostr-tools/nip06';
import * as H from './relay-network-harness.mjs';

export const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
export const PIN = 'cedar-harbour-lamp-42';
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export { H };

const click = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`;
export const typePh = (ph, val) => `(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(ph)})); if(!i) return 'miss'; const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
export const typeInto = (sel, val) => `(() => { const i=document.querySelector(${JSON.stringify(sel)}); if(!i) return 'miss'; const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;

// One-line summary of a relay frame, enough to ask "was that a REQ for safetycheck:" or "was that an AUTH challenge".
function brief(p) {
  try {
    const m = JSON.parse(p), t = m[0];
    if (t === 'EVENT' && m.length === 3) { const e = m[2]; return `EVENT<${m[1]}> k${e.kind} d=${((e.tags || []).find(x => x[0] === 'd') || [])[1] || ''}`; }
    if (t === 'EVENT') { const e = m[1]; return `EVENT k${e.kind} d=${((e.tags || []).find(x => x[0] === 'd') || [])[1] || ''}`; }
    if (t === 'REQ') return 'REQ ' + m[1] + ' ' + JSON.stringify(m.slice(2));
    if (t === 'AUTH') return 'AUTH ' + (typeof m[1] === 'string' ? 'CHALLENGE' : 'RESPONSE');
    if (t === 'OK') return 'OK ' + String(m[1]).slice(0, 8) + ' ' + m[2] + ' ' + (m[3] || '');
    return t + ' ' + (m[1] || '');
  } catch { return String(p).slice(0, 80); }
}

// ONE UNAUTHENTICATED REQ, raw: did the relay send an AUTH challenge, and did it serve any event? Resolves at EOSE.
export function rawReq(relay, filter) {
  return new Promise((resolve, reject) => {
    const w = new WebSocket(relay.wsUrl), out = { auth: false, events: 0, frames: [] };
    const timer = setTimeout(() => { try { w.close(); } catch {} reject(new Error('no EOSE for ' + JSON.stringify(filter))); }, 8000);
    w.on('message', (d) => {
      let m; try { m = JSON.parse(d); } catch { return; }
      out.frames.push(m[0]);
      if (m[0] === 'AUTH') out.auth = true;
      if (m[0] === 'EVENT') out.events++;
      if (m[0] === 'EOSE') { clearTimeout(timer); setTimeout(() => { try { w.close(); } catch {} resolve(out); }, 250); }   // a challenge sent right after the EOSE still counts
    });
    w.on('open', () => w.send(JSON.stringify(['REQ', 'q', filter])));
    w.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

// A RELAY THAT PREDATES THE KEY-ENVELOPE CHALLENGE — this gateway with exactly that one clause removed. Production
// runs the previous main, so the client's own sign-in (the console's _loginSoon) has to work without it. The copy
// must sit beside the real one so its imports and the static files it serves resolve (the harness's old builds
// serve no console); it is named *.tmp.* so .gitignore covers a crashed run, and it is removed on exit. Returns
// { path, remove }. The caller proves it is an old relay by asking it (see relay-challenges-a-key-read.test.mjs).
export function gatewayWithoutKeyChallenge() {
  const real = join(H.ROOT, 'scripts', 'gateway.mjs');
  const src = readFileSync(real, 'utf8');
  const anchor = " || wantsKeyD) { try { ws.send(JSON.stringify(['AUTH', ws._challenge])); } catch {} }";
  const n = src.split(anchor).length - 1;
  if (n !== 1) throw new Error('expected the key-envelope challenge clause exactly once in scripts/gateway.mjs, found ' + n + ' — re-anchor this helper rather than widening it');
  const path = join(H.ROOT, 'scripts', '.gateway-before-key-challenge-' + process.pid + '.tmp.mjs');
  writeFileSync(path, src.replace(anchor, ") { try { ws.send(JSON.stringify(['AUTH', ws._challenge])); } catch {} }"));
  const remove = () => { try { rmSync(path, { force: true }); } catch {} };
  process.on('exit', remove);
  return { path, remove };
}

// opts.gateway — a different gateway.mjs to run (the "old relay" case); opts.wizard — 'skip' (default) | 'rooms'
// opts.logger — keep the raw church-signed subscriber (default true)
export async function openNewChurch({ gateway, wizard = 'skip', logger = true, name = 'ncs' } = {}) {
  if (!CHROME) throw new Error('no chromium');
  const t0 = Date.now();
  const relay = await H.startRelay({ name, entry: gateway || undefined, env: { TRINITY_TAILSCALE_BIN: '/nonexistent' } });
  const cdp = await H.freePort('the new-church session Chrome debug port');
  const prof = mkdtempSync(join(tmpdir(), 'trin-ncs-chr-'));   // unique per run: a fixed profile serves run 1's bundle from the service worker
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=1280,1200', `${relay.base}/steward.html`], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 60 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
  if (!targets || !targets.length) { try { chr.kill('SIGKILL'); } catch {} throw new Error('chromium never exposed a debug target'); }
  const page = targets.find(t => t.type === 'page') || targets[0];
  const cws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { cws.on('open', res); cws.on('error', rej); });

  const s = { relay, frames: [], events: [], errors: [], t0, churchPub: '', mnemonic: '', pin: PIN };
  let id = 0; const pend = new Map(); const urls = new Map();
  cws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.method === 'Runtime.exceptionThrown') { const e = m.params.exceptionDetails; s.errors.push((e.exception?.description || e.text || '').split('\n')[0]); }
    if (m.method === 'Network.webSocketCreated') urls.set(m.params.requestId, m.params.url);
    if (m.method === 'Network.webSocketFrameReceived' || m.method === 'Network.webSocketFrameSent') {
      const url = urls.get(m.params.requestId) || ''; if (!url.includes('127.0.0.1')) return;   // the box under test; the shipped defaults are blocked above
      s.frames.push({ t: Date.now() - t0, dir: m.method.endsWith('Sent') ? '>' : '<', f: brief(m.params.response.payloadData) });
    }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); cws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Network.enable');
  s.ev = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error('in-page: ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };
  s.waitFor = async (expr, ms = 60000, label = expr) => { const tt = Date.now(); while (Date.now() - tt < ms) { try { if (await s.ev(expr)) return true; } catch {} await sleep(300); } throw new Error('timed out waiting for: ' + label); };
  s.press = async (re, label) => { if (await s.ev(click(re)) !== 'ok') throw new Error('nothing on screen matched ' + (label || re)); await sleep(400); };
  s.text = () => s.ev(`document.body.innerText.replace(/\\n/g,' / ')`);
  s.firstFrame = (re, after = 0) => s.frames.find(f => f.t >= after && re.test(f.f));
  s.rows = (where) => {
    const db = new DatabaseSync(join(relay.dataDir, 'relay.sqlite'), { readOnly: true });
    try { return db.prepare('SELECT kind, dtag, raw FROM events WHERE ' + where).all().map(r => { let e = {}; try { e = JSON.parse(String(r.raw || '')); } catch {} return { kind: r.kind, d: String(r.dtag || ''), e }; }); }
    finally { db.close(); }
  };
  s.close = () => {
    try { cws.close(); } catch {}
    try { s.logger && s.logger.close(); } catch {}
    try { chr.kill('SIGKILL'); } catch {}
    relay.stop();
    setTimeout(() => { try { rmSync(prof, { recursive: true, force: true }); } catch {} }, 600);
  };

  try {
    // ── the church, made the real way ──
    await s.waitFor(`[...document.querySelectorAll('button')].some(x => /Start a new church/i.test((x.textContent||'').trim()))`, 90000, 'Start a new church');
    await s.press(/Start a new church/i);
    await s.waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('At least 8'))`, 60000, 'the PIN box');
    await s.ev(typePh('At least 8', PIN)); await s.ev(typePh('Type it again', PIN));
    await s.press(/Set PIN/i);
    await s.waitFor(`!!document.querySelector('input[aria-label="Church name"]')`, 90000, 'the wizard name step');
    s.churchPub = await s.ev(`window.Steward.churchPub`);
    s.mnemonic = await s.ev(`window.Steward.exportMnemonic()`);
    s.tChurch = Date.now() - t0;
    if (logger) await startLogger(s);
    await s.ev(typeInto('input[aria-label="Church name"]', 'First Session Church'));
    await s.press(/^Continue$/);
    await s.waitFor(`/12 words are your church/.test(document.body.innerText)`, 60000, 'the recovery step');
    await s.ev(`(() => { const i=document.querySelector('input[type=checkbox]'); if(!i.checked) i.click(); return 1; })()`);
    await sleep(500); await s.press(/^Continue$/);
    await s.waitFor(`/Quick check/.test(document.body.innerText)`, 30000, 'the quick check');
    const words = s.mnemonic.split(' ');
    await s.ev(`(() => { const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; const words=${JSON.stringify(words)}; const nums=[...document.body.innerText.matchAll(/WORD #(\\d+)/g)].map(m=>Number(m[1])); const ins=[...document.querySelectorAll('input')].filter(i=>i.type==='text').slice(0,3); ins.forEach((i,k)=>{set.call(i,words[nums[k]-1]); i.dispatchEvent(new Event('input',{bubbles:true}));}); return ins.length; })()`);
    await sleep(500); await s.press(/^Continue$/);
    await s.waitFor(`/Create a few spaces/.test(document.body.innerText)`, 30000, 'the rooms step');
    s.tRooms = Date.now() - t0;
    if (wizard === 'skip') {
      await s.press(/^Skip setup$/);
      await s.waitFor(`[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Settings') && !document.querySelector('[data-stew-modal-panel]') && !/Skip setup/.test(document.body.innerText)`, 30000, 'the dashboard');
      s.tDash = Date.now() - t0;
    }
  } catch (e) { s.close(); throw e; }
  return s;
}

// A plain WebSocket signed in AS THE CHURCH (its 12 words), subscribed to everything it may read.
async function startLogger(s) {
  const sk = privateKeyFromSeedWords(s.mnemonic);
  if (getPublicKey(sk) !== s.churchPub) throw new Error('the recovery words do not give the church key');
  const w = new WebSocket(s.relay.wsUrl); let on = false;
  s.logger = { w, close() { try { w.close(); } catch {} } };
  w.on('message', (d) => {
    let m; try { m = JSON.parse(d); } catch { return; }
    if (m[0] === 'AUTH') w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [['relay', s.relay.wsUrl], ['challenge', m[1]]], content: '' }, sk)]));
    else if (m[0] === 'OK' && m[2] && !on) { on = true; w.send(JSON.stringify(['REQ', 'all', { kinds: [30078] }, { kinds: [0, 1, 5, 7, 4] }])); }
    else if (m[0] === 'EVENT') {
      const e = m[2], content = String(e.content || '');
      s.events.push({ t: Date.now() - s.t0, kind: e.kind, d: ((e.tags || []).find(x => x[0] === 'd') || [])[1] || '', author: e.pubkey, sealed: /^\{"e":/.test(content) || /"e":"/.test(content), content, id: e.id, tags: e.tags || [] });
    }
  });
  await new Promise(r => w.on('open', r));
  w.send(JSON.stringify(['REQ', 'prov', { kinds: [30078], '#d': ['trinityone/safetycheck:' + s.churchPub] }]));   // the one question every relay answers with a challenge
  const tt = Date.now(); while (!on && Date.now() - tt < 10000) await sleep(100);
  if (!on) throw new Error('the raw logger could not sign in as the church');
}
