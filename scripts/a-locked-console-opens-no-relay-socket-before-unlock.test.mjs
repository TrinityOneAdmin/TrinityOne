// A LOCKED CONSOLE OPENS NO RELAY SOCKET BEFORE UNLOCK — AND A NEW JOINER IS KEYED AFTER IT.
//   Run: node --test scripts/a-locked-console-opens-no-relay-socket-before-unlock.test.mjs
//
// Bug B (2026-11-13). b8aae006 mounted useStewardStewardedChurches() at the ROOT of the console
// (app/steward-root.jsx StewardRoot), which renders while the PIN screen is still up. Its discovery read
// (subscribeStewardedChurches, src/steward.src.js) dialled the relay from behind the PIN screen. The read covers
// withheld documents, so the relay challenged; a locked console cannot sign, so the login was marked failed.
// After unlock the heal tore that socket down and the console re-subscribed everything twice ~500 ms apart —
// more than 100 frames in the relay's one-second window — and the relay rate-limited the name-key grow. New
// joiners were never keyed until some unrelated change re-ran the distributor.
//
// THE POINT OF USE (CLAUDE.md rule 1): a real gateway on a free port, the real console in headless chromium, a
// church made through the real wizard, a relay that holds a document withheld from an unauthenticated socket
// (church B's key envelopes, wrapped to this console, as in a-console-back-from-the-background-can-approve-at-once),
// and the console reloaded to its PIN screen. Every socket the page opens, and every REQ/CLOSE it sends, is seen
// through a hook on the page's WebSocket constructor.
//
//   1. While the PIN screen is up the console opens NO socket to the relay at all.
//   2. After unlock a member who joins is given the church name key (the envelope names them).
//   3. Locking closes the stewarded-churches subscription (no REQ carrying our stewardrevoke filter stays open).
//   4. Replacing the key (a restore of another church) reopens it for the NEW key, never the old one.
// Skips itself when chromium is unavailable.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { finalizeEvent, nip19, nip44 } from 'nostr-tools';
import { generateSeedWords } from 'nostr-tools/nip06';
import * as H from './relay-network-harness.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PIN = 'cedar-harbour-lamp-42';
const MEMBER_D = 'trinityone/member:', NAMEKEY_D = 'trinityone/namekey:', CAREKEY_D = 'trinityone/carekey:';
const REVOKE_D = 'trinityone/stewardrevoke:';
const LOCKED_HOLD_MS = 8000;

let relay, chr, ws, prof, evalIn, churchA = '', relayUrl = '';
const B = H.key();
const errors = [];

function held(where, ...args) {
  const db = new DatabaseSync(join(relay.dataDir, 'relay.sqlite'), { readOnly: true });
  try { return db.prepare('SELECT raw FROM events WHERE kind = 30078 AND ' + where).all(...args).map(r => { try { return JSON.parse(String(r.raw || '')); } catch { return {}; } }); }
  finally { db.close(); }
}
const recipsOf = (d) => { const r = held('dtag = ?', d)[0]; return r && r.content ? Object.keys(JSON.parse(r.content).keys || {}) : null; };
const click = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`;
const typeInto = (sel, val) => `(() => { const i=document.querySelector(${JSON.stringify(sel)}); if(!i) return 'miss';
  const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
const typePh = (ph, val) => `(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(ph)})); if(!i) return 'miss';
  const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
async function waitFor(expr, ms = 60000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await evalIn(expr)) return true; } catch {} await sleep(300); }
  throw new Error('timed out waiting for: ' + label);
}
const press = async (re, label) => { assert.equal(await evalIn(click(re)), 'ok', `nothing on screen matched ${label || re}`); await sleep(500); };
const joinTo = (church, k) => { const ts = Math.floor(Date.now() / 1000); return finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', MEMBER_D + church], ['t', 'trinityone'], ['p', church]], content: JSON.stringify({ joined: ts }) }, k.sk); };
const pinScreen = `[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('Your PIN or passphrase'))`;
const dashboard = `[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Settings') && !document.querySelector('[data-stew-modal-panel]')`;

// Installed for EVERY document: counts dials to the relay, and keeps the set of OPEN subscriptions that carry a
// stewardrevoke filter — only subscribeStewardedChurches sends one — per socket, by subscription id.
const HOOK = (url) => `(() => { if (window.__hooked) return; window.__hooked = 1;
  const W = window.WebSocket; window.__dials = 0; window.__dialLog = []; window.__revokeSubs = new Map(); let n = 0;
  const Wd = function (u, p) { const s = p === undefined ? new W(u) : new W(u, p); const id = ++n;
    if (String(u) === ${JSON.stringify(url)}) { window.__dials++; window.__dialLog.push({ at: performance.now(), stack: String(new Error().stack || '').split('\\n').slice(2, 7).join(' < ') }); }
    const send = s.send.bind(s);
    s.send = (d) => { try { const m = JSON.parse(String(d));
        if (m[0] === 'REQ') { const fs = m.slice(2).flat(); const r = fs.flatMap(f => (f && f['#d']) || []).filter(x => String(x).startsWith(${JSON.stringify(REVOKE_D)}));
          if (r.length) window.__revokeSubs.set(id + '|' + m[1], r[0]); }
        if (m[0] === 'CLOSE') window.__revokeSubs.delete(id + '|' + m[1]);
      } catch (e) {} return send(d); };
    s.addEventListener('close', () => { for (const k of [...window.__revokeSubs.keys()]) if (k.startsWith(id + '|')) window.__revokeSubs.delete(k); });
    return s; };
  Wd.prototype = W.prototype; for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Wd[k] = W[k]; window.WebSocket = Wd;
})();`;
const openRevokes = () => evalIn(`[...window.__revokeSubs.values()]`);

before(async () => {
  if (!CHROME) return;
  relay = await H.startRelay({ name: 'locked-no-socket', env: { TRINITY_TAILSCALE_BIN: '/nonexistent' } });
  relayUrl = relay.base.replace(/^http/, 'ws') + '/relay';
  const cdp = await H.freePort('the locked-console test\'s Chrome debug port');
  prof = mkdtempSync(join(tmpdir(), 'trin-lockedsock-chr-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=1280,1200', 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d);
    if (m.method === 'Runtime.exceptionThrown') { const e = m.params.exceptionDetails; errors.push((e.exception?.description || e.text || '').split('\n')[0]); }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK(relayUrl) });
  await send('Page.navigate', { url: `${relay.base}/steward.html` });
  evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error('in-page: ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };
  // the church, the real way
  await waitFor(`[...document.querySelectorAll('button')].some(x => /Start a new church/i.test((x.textContent||'').trim()))`, 90000, 'Start a new church');
  await press('/Start a new church/i');
  await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('At least 8'))`, 60000, 'the PIN box');
  assert.equal(await evalIn(typePh('At least 8', PIN)), 'ok');
  assert.equal(await evalIn(typePh('Type it again', PIN)), 'ok');
  await press('/Set PIN/i');
  await waitFor(`!!document.querySelector('input[aria-label="Church name"]')`, 90000, 'the wizard name step');
  churchA = await evalIn(`window.Steward && window.Steward.churchPub || ''`);
  const npubA = await evalIn(`window.Steward.npub || ''`);
  assert.equal(await evalIn(typeInto('input[aria-label="Church name"]', 'Church Locked At Boot')), 'ok');
  await sleep(300);
  await press('/^Continue$/');
  { const t0 = Date.now(); let ok = false; while (!ok && Date.now() - t0 < 30000) { try { ok = (JSON.parse(readFileSync(join(relay.dataDir, 'church.json'), 'utf8')).churches || []).some(c => c && c.npub === npubA); } catch {} if (!ok) await sleep(400); } assert.ok(ok, 'the box never registered the church'); }
  await waitFor(`localStorage.getItem('trinityone.steward.boxhosts.' + window.Steward.churchPub) === '1'`, 30000, 'the console to learn the box holds it');
  // A document the relay withholds from a socket that has not logged in, so the lazy NIP-42 challenge fires.
  const reg = await fetch(relay.base + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + relay.adminToken },
    body: JSON.stringify({ addChurch: { npub: nip19.npubEncode(B.pub), name: 'Church B' } }) });
  assert.equal(reg.status, 200, 'the box would not register church B');
  const ts = Math.floor(Date.now() / 1000) - 5;
  const wrap = (ring, recips) => Object.fromEntries(recips.map(p => [p, nip44.v2.encrypt(JSON.stringify(ring), nip44.v2.utils.getConversationKey(B.sk, p))]));
  await H.publishAll(relay, [
    finalizeEvent({ kind: 0, created_at: ts, tags: [], content: JSON.stringify({ name: 'Church B' }) }, B.sk),
    finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', 'trinityone/stewards:' + B.pub], ['t', 'trinityone']], content: JSON.stringify({ pubkeys: [churchA] }) }, B.sk),
    finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', CAREKEY_D + B.pub], ['t', 'trinityone']], content: JSON.stringify({ keys: wrap(['ab'.repeat(32)], [B.pub, churchA]), rev: 1 }) }, B.sk),
    finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', NAMEKEY_D + B.pub], ['t', 'trinityone']], content: JSON.stringify({ keys: wrap(['cd'.repeat(32)], [B.pub, churchA]), rev: 1 }) }, B.sk),
  ]);
  // Let the console mint its own envelopes first, so the reload is an ESTABLISHED church.
  await waitFor(`window.Steward.nameKeyReady && window.Steward.nameKeyReady()`, 90000, 'the church\'s own name key before the reload');
  await evalIn(`(() => { localStorage.setItem('trinityone.steward.wizard.done', '1'); localStorage.removeItem('trinityone.steward.newchurch'); location.reload(); return 'ok'; })()`);
  await sleep(1500);
});

after(async () => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  H.stopAll();
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
});

const SKIP = !CHROME ? 'no chromium' : false;

test('POINT OF USE: at the PIN screen the console opens no socket to the relay; after unlock a new joiner is keyed', { skip: SKIP, timeout: 240000 }, async () => {
  await waitFor(pinScreen, 90000, 'the unlock screen');
  await sleep(LOCKED_HOLD_MS);
  assert.equal(await evalIn(pinScreen), true, 'CONTROL: the console left the PIN screen on its own');
  const dials = await evalIn('window.__dials');
  const log = await evalIn('window.__dialLog');
  assert.equal(dials, 0, `the console dialled the relay ${dials} time(s) while still LOCKED at the PIN screen — a locked console cannot answer the relay's login challenge. First dial from: ${log[0] && log[0].stack}`);
  assert.deepEqual(await openRevokes(), [], 'a stewarded-churches subscription was open behind the PIN screen');
  // unlock
  assert.equal(await evalIn(typePh('Your PIN or passphrase', PIN)), 'ok');
  await press('/^Unlock/');
  await waitFor(dashboard, 90000, 'the dashboard after unlock');
  await waitFor('window.__dials > 0', 30000, 'CONTROL: the console dials the relay once unlocked');
  await waitFor(`window.__revokeSubs.size > 0`, 30000, 'CONTROL: the stewarded-churches discovery opens once unlocked');
  assert.ok((await openRevokes()).every(d => d === REVOKE_D + churchA), 'the discovery opened for a key that is not this console\'s');
  await waitFor(`window.Steward.nameKeyReady() && !!window.Steward.careSeal({ a: 1 })`, 90000, 'the church\'s own keys after unlock');
  const k = H.key();
  await H.publishAll(relay, [joinTo(churchA, k)]);
  const t0 = Date.now(); let ok = false;
  while (Date.now() - t0 < 60000 && !ok) { const n = recipsOf(NAMEKEY_D + churchA); ok = !!(n && n.includes(k.pub)); if (!ok) await sleep(500); }
  assert.ok(ok, 'a member who joined after the console was unlocked was never given the church name key');
});

test('locking closes the stewarded-churches subscription', { skip: SKIP, timeout: 120000 }, async () => {
  await waitFor(dashboard, 30000, 'the dashboard');
  await waitFor(`window.__revokeSubs.size > 0`, 30000, 'CONTROL: the discovery is open before the lock');
  await evalIn(`(window.Steward.lock(), 'ok')`);
  await waitFor(pinScreen, 30000, 'the PIN screen after locking');
  await sleep(3000);
  assert.deepEqual(await openRevokes(), [], 'the stewarded-churches subscription survived the lock — it is still discovering for a key the console no longer holds');
  // and it comes back on unlock
  assert.equal(await evalIn(typePh('Your PIN or passphrase', PIN)), 'ok');
  await press('/^Unlock/');
  await waitFor(dashboard, 90000, 'the dashboard after the second unlock');
  await waitFor(`window.__revokeSubs.size > 0`, 30000, 'the discovery did not reopen after unlocking again');
});

test('replacing the key reopens the subscription for the NEW key, never the old one', { skip: SKIP, timeout: 180000 }, async () => {
  await waitFor(dashboard, 30000, 'the dashboard');
  await waitFor(`window.__revokeSubs.size > 0`, 30000, 'CONTROL: the discovery is open before the restore');
  const words = generateSeedWords();
  const r = await evalIn(`(() => { const r = window.Steward.restoreKey(${JSON.stringify(words)}); return window.Steward.churchPub; })()`);
  const churchC = String(r || '');
  assert.ok(churchC && churchC !== churchA, 'CONTROL: the restore did not change the key');
  await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('At least 8'))`, 60000, 'the forced-PIN screen after the restore');
  assert.equal(await evalIn(typePh('At least 8', PIN)), 'ok');
  assert.equal(await evalIn(typePh('Type it again', PIN)), 'ok');
  await press('/Set PIN/i');
  await waitFor(`!window.Steward.needsPin`, 60000, 'the PIN to be set for the restored key');
  await waitFor(`[...window.__revokeSubs.values()].includes(${JSON.stringify(REVOKE_D + churchC)})`, 60000, 'the discovery to reopen for the NEW key');
  await sleep(2000);
  const open = await openRevokes();
  assert.ok(!open.includes(REVOKE_D + churchA), 'a stewarded-churches subscription for the OLD key is still open after the key was replaced: ' + JSON.stringify(open));
});
