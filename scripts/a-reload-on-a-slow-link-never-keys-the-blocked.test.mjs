// A RELOAD ON A SLOW LINK NEVER WRAPS THE CHURCH'S KEYS TO THE MEMBER IT HAS BLOCKED.
//   Run: node --test scripts/a-reload-on-a-slow-link-never-keys-the-blocked.test.mjs
//
// The audit of 5276297 (HIGH 2; 2 runs and its baseline; also at 88f6666 and on main). The owner Blocks M in church A
// and reloads, on a slow link: every frame of the church's whole-corpus subscriptions arrives 6–9 s late. nostr-tools'
// own EOSE timer (4.4 s) answered the blocked-list subscription first, with no blocklist in it — `blocked: []`,
// stamped as the church's current list — and ~30 ms later the name and care envelopes went to [A, M (blocked), M3].
// The real blocklist arrived ~5 s later, too late: the enrolment only grows.
//
// Two defences now, and a row for each:
//   · the blocked list counts as the church's only on a GENUINE answer — a narrow read of the blocklist document
//     settled by every relay, the key reads' own machinery — so the enrolment waits for it;
//   · the console keeps the last genuine blocklist it saw for each church and starts from it, so the envelope
//     builders leave the blocked member out even before the relay has answered.
// Row 2 removes the device's copy before reloading, so only the first defence stands between M and the keys.
//
// THE POINT OF USE (CLAUDE.md rule 1): a real gateway on a FREE port, the real console in headless chromium, church
// A by the wizard, a real Block pressed on the Members screen, and a slow socket installed in the page for every
// new document: frames for whole-corpus REQs (kind-30078 with #t and no #d) AND for any read of the blocklist
// document itself are delivered DELAY ms late — a slow link slows the narrow read too. Every key
// envelope the console sends for A is captured off its socket. Derived from the audit's bq5.test.mjs (slowblocked).
// Skips itself without chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { finalizeEvent, nip19, nip44 } from 'nostr-tools';
import * as H from './relay-network-harness.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PIN = 'cedar-harbour-lamp-42';
const NAMEKEY_D = 'trinityone/namekey:', CAREKEY_D = 'trinityone/carekey:', MEMBER_D = 'trinityone/member:';
const DELAY = 9000;

let relay, chr, ws, prof, evalIn, cdpSend, churchA = '';
const B = H.key(), M = H.key(), M3 = H.key();
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
  while (Date.now() - t0 < ms) { try { if (await evalIn(expr)) return true; } catch {} await sleep(400); }
  throw new Error('timed out waiting for: ' + label);
}
const press = async (re, label) => { assert.equal(await evalIn(click(re)), 'ok', `nothing on screen matched ${label || re}`); await sleep(500); };
const joinTo = (church, k) => { const ts = Math.floor(Date.now() / 1000); return finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', MEMBER_D + church], ['t', 'trinityone'], ['p', church]], content: JSON.stringify({ joined: ts }) }, k.sk); };
async function unlock() {
  await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('Your PIN or passphrase'))`, 90000, 'the unlock screen');
  assert.equal(await evalIn(typePh('Your PIN or passphrase', PIN)), 'ok');
  await press('/^Unlock/');
}
// THE SLOW LINK, installed for every new document once armed (sessionStorage), and the envelopes sent for A
const SLOW = (aPub) => `(() => { if (window.__slowHooked) return; window.__slowHooked = 1; window.__sentA = [];
  const Ap = ${JSON.stringify(aPub)};
  const os = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) { try { if (typeof d === 'string') { const a = JSON.parse(d);
      if (a[0] === 'REQ' && sessionStorage.getItem('__slow') === '1' && a.slice(2).flat().some(f => f && (f.kinds || []).includes(30078) && ((f['#t'] && !f['#d']) || (f['#d'] || []).some(x => String(x).startsWith('trinityone/blocked:'))))) (window.__slowSubs = window.__slowSubs || new Set()).add(a[1]);
      if (a[0] === 'EVENT') { const e = a[1]; const dd = (e.tags.find(t => t[0] === 'd') || [])[1] || ''; if (/^trinityone\\/(namekey|carekey|mediakey):/.test(dd) && dd.endsWith(Ap)) window.__sentA.push({ d: dd.slice(11, 19), recips: Object.keys(JSON.parse(e.content).keys || {}) }); } } } catch (x) {}
    return os.call(this, d); };
  const desc = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
  Object.defineProperty(WebSocket.prototype, 'onmessage', { configurable: true, get() { return desc.get.call(this); }, set(fn) {
    const w = fn ? (ev) => { try { const d = ev.data; if (typeof d === 'string' && (d.startsWith('["EVENT"') || d.startsWith('["EOSE"'))) { const a = JSON.parse(d); if (window.__slowSubs && window.__slowSubs.has(a[1])) { window.__delayedN = (window.__delayedN || 0) + 1; setTimeout(() => fn(ev), ${DELAY}); return; } } } catch (x) {} return fn(ev); } : fn;
    desc.set.call(this, w); } });
})();`;

before(async () => {
  if (!CHROME) return;
  relay = await H.startRelay({ name: 'slow-blocked', env: { TRINITY_TAILSCALE_BIN: '/nonexistent' } });
  const cdp = await H.freePort('the slow-blocked test\'s Chrome debug port');
  prof = mkdtempSync(join(tmpdir(), 'trin-slowblk-chr-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=1280,1200', `${relay.base}/steward.html`], { stdio: 'ignore' });
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
  await send('Runtime.enable');
  cdpSend = send;
  evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error('in-page: ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };
  await waitFor(`[...document.querySelectorAll('button')].some(x => /Start a new church/i.test((x.textContent||'').trim()))`, 90000, 'Start a new church');
  await press('/Start a new church/i');
  await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('At least 8'))`, 60000, 'the PIN box');
  assert.equal(await evalIn(typePh('At least 8', PIN)), 'ok');
  assert.equal(await evalIn(typePh('Type it again', PIN)), 'ok');
  await press('/Set PIN/i');
  await waitFor(`!!document.querySelector('input[aria-label="Church name"]')`, 90000, 'the wizard name step');
  churchA = await evalIn(`window.Steward && window.Steward.churchPub || ''`);
  const npubA = await evalIn(`window.Steward.npub || ''`);
  assert.equal(await evalIn(typeInto('input[aria-label="Church name"]', 'St Aidan Slow Link')), 'ok');
  await sleep(300);
  await press('/^Continue$/');
  { const t0 = Date.now(); let ok = false; while (!ok && Date.now() - t0 < 30000) { try { ok = (JSON.parse(readFileSync(join(relay.dataDir, 'church.json'), 'utf8')).churches || []).some(c => c && c.npub === npubA); } catch {} if (!ok) await sleep(400); } assert.ok(ok, 'the box never registered church A'); }
  await waitFor(`localStorage.getItem('trinityone.steward.boxhosts.' + window.Steward.churchPub) === '1'`, 30000, 'the console to learn the box holds it');
  // something the relay withholds from a socket that has not logged in, so its lazy NIP-42 challenge fires at all:
  // a stewarded church B whose envelopes are wrapped to this console
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
  await cdpSend('Page.enable');
  await cdpSend('Page.addScriptToEvaluateOnNewDocument', { source: SLOW(churchA) });
  await evalIn(`(() => { localStorage.setItem('trinityone.steward.wizard.done', '1'); localStorage.removeItem('trinityone.steward.newchurch'); location.reload(); return 'ok'; })()`);
  await sleep(3000);
  await unlock();
  await waitFor(`[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Settings') && !document.querySelector('[data-stew-modal-panel]')`, 90000, 'the dashboard');
  await waitFor(`window.Steward.nameKeyReady() && !!window.Steward.careSeal({ a: 1 })`, 90000, 'church A\'s own keys');
  await H.publishAll(relay, [joinTo(churchA, M), joinTo(churchA, M3)]);
  { const t0 = Date.now(); let ok = false; while (Date.now() - t0 < 60000 && !ok) { const n = recipsOf(NAMEKEY_D + churchA), c = recipsOf(CAREKEY_D + churchA); ok = !!(n && c && n.includes(M.pub) && n.includes(M3.pub) && c.includes(M3.pub)); if (!ok) await sleep(500); } assert.ok(ok, 'church A\'s members were never keyed'); }
  await sleep(3000);
  // THE BLOCK, pressed on the Members screen
  await press('/^Members$/', 'the Members section'); await sleep(1500);
  await evalIn(`(() => { if (document.querySelector('button[title="Remove / block this member"]')) return 'direct'; const b = [...document.querySelectorAll('button')].find(x => /^More for /.test(x.getAttribute('aria-label') || '')); if (b) b.click(); return 'more'; })()`);
  await sleep(600);
  const opened = await evalIn(`(() => { const npub = ${JSON.stringify(nip19.npubEncode(M.pub))}; const btns = [...document.querySelectorAll('button[title="Remove / block this member"], button[title="Decline — blocks this person from joining or posting"]')];
    const mine = btns.find(b => { let n = b; for (let i = 0; i < 8 && n; i++) { n = n.parentElement; if (n && (n.textContent || '').includes(npub.slice(0, 12))) return true; } return false; }) || null;
    if (!mine) return 'miss:' + btns.length; mine.click(); return 'ok'; })()`);
  assert.equal(opened, 'ok', 'no Block button for M');
  await sleep(500);
  assert.equal(await evalIn(`(() => { const b = document.querySelector('button[title="Confirm — bans them from posting & hides their messages"]') || document.querySelector('button[title="Confirm — blocks them from joining or posting, and re-keys the church"]'); if (!b) return 'miss'; b.click(); return 'ok'; })()`), 'ok', 'no Block confirmation');
  await sleep(15000);
  const n = recipsOf(NAMEKEY_D + churchA), c = recipsOf(CAREKEY_D + churchA);
  assert.ok(n && c && !n.includes(M.pub) && !c.includes(M.pub) && n.includes(M3.pub), 'CONTROL: the Block did not take M out of A\'s name and care keys — the rows below would prove nothing');
});

after(async () => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  H.stopAll();
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
});

const SKIP = !CHROME ? 'no chromium' : false;
// reload on the slow link; what does the console send for A, and is the relay's copy still without M?
async function reloadSlow(label, { forgetDeviceCopy }) {
  await evalIn(`(() => { sessionStorage.setItem('__slow', '1');
    ${forgetDeviceCopy ? `for (const k of Object.keys(localStorage)) if (k.startsWith('trinityone.steward.blockedlast.')) localStorage.removeItem(k);` : ''}
    location.reload(); return 1; })()`);
  await sleep(2500);
  await unlock();
  await sleep(DELAY + 15000);
  const delayed = await evalIn('window.__delayedN || 0');
  assert.ok(delayed > 0, 'CONTROL: no frame was delayed — this row is not on a slow link');
  const sent = await evalIn('window.__sentA || []');
  const out = [];
  for (const s of sent) if (s.recips.includes(M.pub)) out.push(`${label}: ${s.d} for A sent wrapped to M, the member A blocked`);
  for (const d of [NAMEKEY_D, CAREKEY_D]) { const r = recipsOf(d + churchA); if (r && r.includes(M.pub)) out.push(`${label}: the relay now holds A's ${d.slice(11, 19)} wrapped to M`); }
  return out;
}

test('a reload on a slow link after a Block: no key envelope for the church names the blocked member', { skip: SKIP, timeout: 300000 }, async () => {
  assert.deepEqual(await reloadSlow('reload', { forgetDeviceCopy: false }), []);
});

test('…and on a console with no copy of the blocklist on the device, the enrolment WAITS for the church\'s genuine answer', { skip: SKIP, timeout: 300000 }, async () => {
  assert.deepEqual(await reloadSlow('reload, no device copy', { forgetDeviceCopy: true }), []);
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});
