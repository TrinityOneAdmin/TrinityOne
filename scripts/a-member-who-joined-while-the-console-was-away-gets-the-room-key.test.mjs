// A MEMBER WHO JOINED CHURCH A WHILE THE CONSOLE WAS ACTING FOR CHURCH B IS GIVEN A'S ROOM KEYS WHEN IT COMES BACK.
//   Run: node --test scripts/a-member-who-joined-while-the-console-was-away-gets-the-room-key.test.mjs
//
// The audit of 831dcea (caused by 6092c0b). The key distributor's memo — the members it last keyed each room to — was
// wiped whenever the church the console runs changed, so on the way back from B every room of A's was a "first
// sighting": the member who had joined A meanwhile was recorded as already keyed and never given the room key
// (2/2 not keyed within 60 s at 831dcea; keyed in ~1 s at b6dd71b). The memo is now kept per church: back on A, A's
// rooms are compared with A's roster as last keyed. (Keeping a room id seen in B out of A's memo — the reason for
// 6092c0b's wipe — is what-a-console-wrote-for-another-church-stays-that-churchs.test.mjs.)
//
// THE POINT OF USE (CLAUDE.md rule 1): a real gateway on a FREE port, the real console in headless chromium, church
// A by the wizard, church B rostering A as its steward, an open encrypted room in A, the switches made through the
// console's own setActiveIdentity, and the room-key envelope read from the relay's database. Derived from the audit's
// away.test.mjs. Skips itself without chromium.
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
const NAMEKEY_D = 'trinityone/namekey:', CAREKEY_D = 'trinityone/carekey:', MEMBER_D = 'trinityone/member:', GROUPKEY_D = 'trinityone/groupkey:';
const WAIT = 30000;   // the regression: not keyed in 60 s; the fixed console keys them in ~1 s

let relay, chr, ws, prof, evalIn, cdpSend, churchA = '', roomId = '';
const B = H.key(), MB = H.key(), M = H.key(), M3 = H.key(), MC = H.key(), M2 = H.key();
const errors = [];
const nm = (p) => p === B.pub ? 'B' : p === churchA ? 'A' : p === M.pub ? 'M' : p === M3.pub ? 'M3' : p === MC.pub ? 'MC' : p === M2.pub ? 'M2' : p === MB.pub ? 'MB' : String(p).slice(0, 6);
function held(where, ...args) {
  const db = new DatabaseSync(join(relay.dataDir, 'relay.sqlite'), { readOnly: true });
  try { return db.prepare('SELECT raw FROM events WHERE kind = 30078 AND ' + where).all(...args).map(r => { try { return JSON.parse(String(r.raw || '')); } catch { return {}; } }); }
  finally { db.close(); }
}
const roomRecips = () => held('dtag = ?', GROUPKEY_D + roomId).flatMap(e => { try { return Object.keys(JSON.parse(e.content).keys || {}); } catch { return []; } });
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
async function until(pred, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(1000); } return pred(); }
const press = async (re, label) => { assert.equal(await evalIn(click(re)), 'ok', `nothing on screen matched ${label || re}`); await sleep(500); };
const joinTo = (church, k) => { const ts = Math.floor(Date.now() / 1000); return finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', MEMBER_D + church], ['t', 'trinityone'], ['p', church]], content: JSON.stringify({ joined: ts }) }, k.sk); };
async function unlock() {
  await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('Your PIN or passphrase'))`, 90000, 'the unlock screen');
  assert.equal(await evalIn(typePh('Your PIN or passphrase', PIN)), 'ok');
  await press('/^Unlock/');
  await waitFor(`[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Settings') && !document.querySelector('[data-stew-modal-panel]')`, 90000, 'the dashboard');
}

before(async () => {
  if (!CHROME) return;
  relay = await H.startRelay({ name: 'away-room-key', env: { TRINITY_TAILSCALE_BIN: '/nonexistent' } });
  const cdp = await H.freePort('the away-room-key test\'s Chrome debug port');
  prof = mkdtempSync(join(tmpdir(), 'trin-awayroom-chr-'));
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
  // church A, by the wizard
  await waitFor(`[...document.querySelectorAll('button')].some(x => /Start a new church/i.test((x.textContent||'').trim()))`, 90000, 'Start a new church');
  await press('/Start a new church/i');
  await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('At least 8'))`, 60000, 'the PIN box');
  assert.equal(await evalIn(typePh('At least 8', PIN)), 'ok');
  assert.equal(await evalIn(typePh('Type it again', PIN)), 'ok');
  await press('/Set PIN/i');
  await waitFor(`!!document.querySelector('input[aria-label="Church name"]')`, 90000, 'the wizard name step');
  churchA = await evalIn(`window.Steward && window.Steward.churchPub || ''`);
  const npubA = await evalIn(`window.Steward.npub || ''`);
  assert.equal(await evalIn(typeInto('input[aria-label="Church name"]', 'St Hilda Away')), 'ok');
  await sleep(300);
  await press('/^Continue$/');
  { const t0 = Date.now(); let ok = false; while (!ok && Date.now() - t0 < 30000) { try { ok = (JSON.parse(readFileSync(join(relay.dataDir, 'church.json'), 'utf8')).churches || []).some(c => c && c.npub === npubA); } catch {} if (!ok) await sleep(400); } assert.ok(ok, 'the box never registered church A'); }
  await waitFor(`localStorage.getItem('trinityone.steward.boxhosts.' + window.Steward.churchPub) === '1'`, 30000, 'the console to learn the box holds it');
  // church B, which rosters A as its steward, with its member MB
  const reg = await fetch(relay.base + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + relay.adminToken },
    body: JSON.stringify({ addChurch: { npub: nip19.npubEncode(B.pub), name: 'Church B' } }) });
  assert.equal(reg.status, 200, 'the box would not register church B');
  const ts = Math.floor(Date.now() / 1000) - 5;
  const wrap = (ring, recips) => Object.fromEntries(recips.map(p => [p, nip44.v2.encrypt(JSON.stringify(ring), nip44.v2.utils.getConversationKey(B.sk, p))]));
  await H.publishAll(relay, [
    finalizeEvent({ kind: 0, created_at: ts, tags: [], content: JSON.stringify({ name: 'Church B Away' }) }, B.sk),
    finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', 'trinityone/stewards:' + B.pub], ['t', 'trinityone']], content: JSON.stringify({ pubkeys: [churchA] }) }, B.sk),
    finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', CAREKEY_D + B.pub], ['t', 'trinityone']], content: JSON.stringify({ keys: wrap(['ab'.repeat(32)], [B.pub, churchA, MB.pub]), rev: 1 }) }, B.sk),
    finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', NAMEKEY_D + B.pub], ['t', 'trinityone']], content: JSON.stringify({ keys: wrap(['cd'.repeat(32)], [B.pub, churchA, MB.pub]), rev: 1 }) }, B.sk),
  ]);
  await H.publishAll(relay, [joinTo(B.pub, MB)]);
  await evalIn(`(() => { localStorage.setItem('trinityone.steward.wizard.done', '1'); localStorage.removeItem('trinityone.steward.newchurch'); location.reload(); return 'ok'; })()`);
  await sleep(3000);
  await unlock();
  await waitFor(`window.Steward.nameKeyReady() && !!window.Steward.careSeal({ a: 1 })`, 90000, 'church A\'s own name and care keys');
  await waitFor(`(window.Steward.identities() || []).some(x => x.kind === 'steward' && x.pub === ${JSON.stringify(B.pub)})`, 60000, 'church B in the switcher');
  await H.publishAll(relay, [joinTo(churchA, M), joinTo(churchA, M3)]);
  await sleep(6000);
  // an OPEN encrypted room in A, keyed to A's members
  const made = await evalIn(`(async () => { const S = window.Steward; const g = await S.publishGroup({ name: 'Hilda Sealed', encrypted: true });
    if (!g || !g.id) return { err: 'no group' }; const r = await S.publishGroupKey(g.id, [${JSON.stringify(M.pub)}, ${JSON.stringify(M3.pub)}]); return { id: g.id, key: r === null ? 'null' : r === false ? 'false' : 'ok' }; })()`);
  assert.equal(made.key, 'ok', 'CONTROL: the room\'s key was not published: ' + JSON.stringify(made));
  roomId = made.id;
  await sleep(4000);
  // CONTROL: a member who joins while the console is ON A is keyed — the distributor works here at all
  await H.publishAll(relay, [joinTo(churchA, MC)]);
  assert.ok(await until(() => roomRecips().includes(MC.pub), 60000), `CONTROL: a member who joined while the console was on A was not given the room key — [${roomRecips().map(nm)}]`);
});

after(async () => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  H.stopAll();
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
});

const SKIP = !CHROME ? 'no chromium' : false;

test('a member who joins A while the console acts for B is given A\'s room key when the console comes back to A', { skip: SKIP, timeout: 300000 }, async () => {
  assert.equal(await evalIn(`window.Steward.setActiveIdentity(${JSON.stringify(B.pub)})`), true, 'the switch to B was refused');
  await waitFor(`window.Steward.actingChurch === ${JSON.stringify(B.pub)}`, 30000, 'the console acting for B');
  await sleep(6000);
  await H.publishAll(relay, [joinTo(churchA, M2)]);                  // M2 joins A while the console is on B
  await sleep(4000);
  assert.ok(!roomRecips().includes(M2.pub), 'CONTROL: M2 was keyed while the console was on B — this row would prove nothing');
  assert.equal(await evalIn(`window.Steward.setActiveIdentity(${JSON.stringify(churchA)})`), true, 'the switch back to A was refused');
  await waitFor(`!window.Steward.actingChurch && window.Steward.churchPub === ${JSON.stringify(churchA)}`, 30000, 'the console back on A');
  const got = await until(() => roomRecips().includes(M2.pub), WAIT);
  assert.ok(got, `A MEMBER WHO JOINED A WHILE THE CONSOLE WAS ON B WAS NEVER GIVEN A'S ROOM KEY within ${WAIT / 1000} s (audit of 831dcea) — the relay's envelope is wrapped to [${roomRecips().map(nm)}]`);
  assert.ok(!roomRecips().includes(MB.pub) && !roomRecips().includes(B.pub), `A's room key was wrapped to church B's people: [${roomRecips().map(nm)}]`);
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});
