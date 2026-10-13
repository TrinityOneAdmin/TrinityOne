// A MEMBER WHO JOINED WHILE NO CONSOLE WAS OPEN GETS THE ROOM KEY — EVEN ON A CONSOLE WITH NO SAVED MEMBER LIST —
// AND A MEMBER STILL WAITING FOR APPROVAL GETS NO ROOM, CARE OR SERMON KEY UNTIL THEY ARE APPROVED.
//   Run: node --test scripts/a-room-key-reaches-a-member-the-console-never-saw-join.test.mjs
//
// THE DEFECTS (2026-10-12, proved by the verify-roomkeys probe).
//   A. KeyDistributor (app/stew-dashboard.jsx) recorded the members it FIRST saw for each encrypted room as
//      "already keyed". True only on the console that created the room. On a console with no saved member list —
//      a new device, a reinstall, cleared data, a delegate — a member who joined while no console was open was
//      counted as keyed and never got the key: their room was empty and their posts refused, until somebody else
//      joined. (scripts/a-member-who-joined-while-the-console-was-away-gets-the-room-key.test.mjs passed throughout:
//      it switches church inside ONE page session, so the distributor's in-memory memo was never empty.) The
//      distributor now reconciles each room against its newest envelope (Steward.groupKeyRecipients).
//   B. With "require approval" on, a member awaiting approval (a member doc, not on the admitted list) was handed
//      the open-room, care and sermon keys. The relay already treats them as non-members (gateway.mjs
//      rebuildMembers). Those keys now go to approved members only; approving someone keys them at once.
//
// THE POINT OF USE (CLAUDE.md rule 1): a real gateway on a FREE port, the real console in headless chromium, the
// church made by the wizard, the console closed and reopened with its member cache CLEARED, and every key checked in
// the envelopes the relay actually stores. Skips itself without chromium. Derived from the probe's probe.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { finalizeEvent, nip19 } from 'nostr-tools';
import * as H from './relay-network-harness.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PIN = 'cedar-harbour-lamp-42';
const MEMBER_D = 'trinityone/member:', GROUPKEY_D = 'trinityone/groupkey:', CAREKEY_D = 'trinityone/carekey:', MEDIAKEY_D = 'trinityone/mediakey:', NAMEKEY_D = 'trinityone/namekey:';
const WAIT = 45000;

let relay, chr, ws, prof, evalIn, churchA = '', roomId = '', cdpPort = 0;
const M1 = H.key(), MF = H.key(), MA = H.key(), MP = H.key();
const errors = [];
const nm = (p) => p === churchA ? 'church' : p === M1.pub ? 'M1' : p === MF.pub ? 'MF' : p === MA.pub ? 'MA' : p === MP.pub ? 'MP' : String(p).slice(0, 6);
function held(where, ...args) {
  const db = new DatabaseSync(join(relay.dataDir, 'relay.sqlite'), { readOnly: true });
  try { return db.prepare('SELECT raw FROM events WHERE kind = 30078 AND ' + where).all(...args).map(r => { try { return JSON.parse(String(r.raw || '')); } catch { return {}; } }); }
  finally { db.close(); }
}
// the recipients of the NEWEST stored envelope for a d-tag
const recipsOf = (d) => { const e = held('dtag = ?', d).sort((a, b) => b.created_at - a.created_at)[0]; try { return Object.keys(JSON.parse(e.content).keys || {}); } catch { return []; } };
const room = () => recipsOf(GROUPKEY_D + roomId);
const care = () => recipsOf(CAREKEY_D + churchA);
const media = () => recipsOf(MEDIAKEY_D + churchA);
const names = () => recipsOf(NAMEKEY_D + churchA);
const show = () => `room [${room().map(nm)}] care [${care().map(nm)}] media [${media().map(nm)}]`;
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
// NO CONSOLE OPEN: the page leaves the console entirely (about:blank), so nothing is subscribed to anything.
async function closeConsole() { await evalIn(`(() => { location.href = 'about:blank'; return 1; })()`).catch(() => {}); await sleep(2500); }
// …and comes back as a console that has never seen this church's members: the saved member list is removed BEFORE
// the console script runs its first render (it is read in useStewardMembers' initial state).
async function openConsoleWithNoMemberCache() {
  await evalIn(`(() => { location.href = ${JSON.stringify(relay.base + '/steward.html')}; return 1; })()`).catch(() => {});
  await sleep(1500);
  await evalIn(`(() => { localStorage.removeItem('trinityone.steward.members.' + ${JSON.stringify(churchA)}); return 1; })()`).catch(() => {});
  await unlock();
}
// the admitted list as the console reads it, plus `add`, written through the console's own setAdmitted
const admit = (pubs) => evalIn(`(async () => { const S = window.Steward;
  const cur = await new Promise(res => { let done = false; S.subscribeAdmitted(l => { if (!done) { done = true; res(l); } }); setTimeout(() => { if (!done) { done = true; res([]); } }, 4000); });
  const r = await S.setAdmitted([...new Set([...(cur || []), ...${JSON.stringify(pubs)}])]); return (r === false || r == null) ? String(r) : 'ok'; })()`);
const admittedHeld = () => held('dtag = ?', 'trinityone/admitted:' + churchA).flatMap(e => { try { return JSON.parse(e.content).pubkeys || []; } catch { return []; } });

before(async () => {
  if (!CHROME) return;
  relay = await H.startRelay({ name: 'roomkey-reconcile', env: { TRINITY_TAILSCALE_BIN: '/nonexistent' } });
  const cdp = await H.freePort('the roomkey-reconcile test\'s Chrome debug port');
  cdpPort = cdp;
  prof = mkdtempSync(join(tmpdir(), 'trin-roomkeyrec-chr-'));
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
  evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error('in-page: ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };
  // the church, by the wizard
  await waitFor(`[...document.querySelectorAll('button')].some(x => /Start a new church/i.test((x.textContent||'').trim()))`, 90000, 'Start a new church');
  await press('/Start a new church/i');
  await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('At least 8'))`, 60000, 'the PIN box');
  assert.equal(await evalIn(typePh('At least 8', PIN)), 'ok');
  assert.equal(await evalIn(typePh('Type it again', PIN)), 'ok');
  await press('/Set PIN/i');
  await waitFor(`!!document.querySelector('input[aria-label="Church name"]')`, 90000, 'the wizard name step');
  churchA = await evalIn(`window.Steward && window.Steward.churchPub || ''`);
  const npubA = await evalIn(`window.Steward.npub || ''`);
  assert.equal(await evalIn(typeInto('input[aria-label="Church name"]', 'St Bede Reconcile')), 'ok');
  await sleep(300);
  await press('/^Continue$/');
  { const t0 = Date.now(); let ok = false; while (!ok && Date.now() - t0 < 30000) { try { ok = (JSON.parse(readFileSync(join(relay.dataDir, 'church.json'), 'utf8')).churches || []).some(c => c && c.npub === npubA); } catch {} if (!ok) await sleep(400); } assert.ok(ok, 'the box never registered the church'); }
  await waitFor(`localStorage.getItem('trinityone.steward.boxhosts.' + window.Steward.churchPub) === '1'`, 30000, 'the console to learn the box holds it');
  await evalIn(`(() => { localStorage.setItem('trinityone.steward.wizard.done', '1'); localStorage.removeItem('trinityone.steward.newchurch'); location.reload(); return 'ok'; })()`);
  await sleep(3000);
  await unlock();
  await waitFor(`window.Steward.nameKeyReady() && !!window.Steward.careSeal({ a: 1 })`, 90000, 'the church\'s name and care keys');
  // A new church starts with approval ON (ensureJoinPolicy). Row A is about the reconcile, so the church is open-join
  // until row B switches approval on the way the Rules & privacy switch does.
  assert.equal(await evalIn(`window.Steward.setJoinPolicy(false).then(r => r ? 'ok' : String(r))`), 'ok', 'CONTROL: open join could not be set');
  await sleep(3000);
  // M1 joins; an OPEN encrypted room is made, keyed to M1; the sermon key is made as the upload screen makes it
  await H.publishAll(relay, [joinTo(churchA, M1)]);
  await sleep(5000);
  const made = await evalIn(`(async () => { const S = window.Steward; const g = await S.publishGroup({ name: 'Bede Sealed', encrypted: true });
    if (!g || !g.id) return { err: 'no group' }; const r = await S.publishGroupKey(g.id, [${JSON.stringify(M1.pub)}]); return { id: g.id, key: r === null ? 'null' : r === false ? 'false' : 'ok' }; })()`);
  assert.equal(made.key, 'ok', 'CONTROL: the room\'s key was not published: ' + JSON.stringify(made));
  roomId = made.id;
  assert.equal(await evalIn(`window.Steward.mediaEncryptor([${JSON.stringify(M1.pub)}]).then(() => 'ok', e => 'ERR ' + e.message)`), 'ok', 'CONTROL: the sermon key could not be made');
  assert.ok(await until(() => room().includes(M1.pub) && care().includes(M1.pub) && media().includes(M1.pub), WAIT),
    'CONTROL: M1 was not keyed to the room, care and sermon keys while the console was open — ' + show());
});

after(async () => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  H.stopAll();
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
});

const SKIP = !CHROME ? 'no chromium' : false;

test('A · a member who joined while no console was open is given the room key by a console with NO saved member list', { skip: SKIP, timeout: 240000 }, async () => {
  await closeConsole();
  await H.publishAll(relay, [joinTo(churchA, MF)]);                  // MF joins with no console open
  await sleep(3000);
  assert.ok(!room().includes(MF.pub), 'CONTROL: MF was keyed with no console open — this row would prove nothing');
  await openConsoleWithNoMemberCache();
  const got = await until(() => room().includes(MF.pub), WAIT);
  assert.ok(got, `A MEMBER WHO JOINED WHILE NO CONSOLE WAS OPEN WAS NEVER GIVEN THE ROOM KEY within ${WAIT / 1000} s by a console with no saved member list — ${show()}`);
  assert.ok(room().includes(M1.pub), 'the reconcile DROPPED a member the room was already keyed to — the phone deletes its key when that happens: ' + show());
});

test('B · with approval on, a member still waiting for approval gets NO room, care or sermon key — while an approved joiner gets all three', { skip: SKIP, timeout: 300000 }, async () => {
  // the Rules & privacy switch's order: grandfather everyone already here, then turn approval on. MA is admitted
  // ahead of joining (the control); MP is not (the pending member).
  assert.equal(await admit([M1.pub, MF.pub, MA.pub]), 'ok', 'the admitted list was not saved');
  assert.notEqual(await evalIn(`window.Steward.setJoinPolicy(true).then(r => String(r))`), 'false', 'approval could not be switched on');
  assert.ok(await until(() => admittedHeld().includes(MA.pub) && held('dtag = ?', 'trinityone/joinpolicy:' + churchA).length > 0, 20000), 'CONTROL: the admitted list / join policy never reached the relay');
  await closeConsole();
  await H.publishAll(relay, [joinTo(churchA, MA), joinTo(churchA, MP)]);   // both join with no console open
  await sleep(3000);
  await openConsoleWithNoMemberCache();
  // CONTROL — the distributor ran, with approval on, on this cold console: the approved joiner has all three
  assert.ok(await until(() => room().includes(MA.pub) && care().includes(MA.pub) && media().includes(MA.pub), WAIT),
    'CONTROL: an APPROVED member who joined while the console was closed was not keyed — this row would prove nothing: ' + show());
  // …and the name key DOES reach the pending member (they seal their name for the approval queue) — unchanged
  assert.ok(await until(() => names().includes(MP.pub), WAIT), 'the NAME key no longer reaches a member waiting for approval — they cannot seal their name for the queue');
  await sleep(5000);                                                  // give a wrong publish every chance to land
  assert.ok(!room().includes(MP.pub), 'THE OPEN ROOM\'S KEY WAS GIVEN TO A MEMBER STILL WAITING FOR APPROVAL — ' + show());
  assert.ok(!care().includes(MP.pub), 'THE CARE KEY WAS GIVEN TO A MEMBER STILL WAITING FOR APPROVAL — ' + show());
  assert.ok(!media().includes(MP.pub), 'THE SERMON KEY WAS GIVEN TO A MEMBER STILL WAITING FOR APPROVAL — ' + show());
});

test('C · approving them gives them all three at once', { skip: SKIP, timeout: 240000 }, async () => {
  assert.ok(!room().includes(MP.pub), 'CONTROL: MP already had the room key — run B first');
  assert.equal(await admit([MP.pub]), 'ok', 'the approval was not saved');
  const got = await until(() => room().includes(MP.pub) && care().includes(MP.pub) && media().includes(MP.pub), WAIT);
  assert.ok(got, `AN APPROVED MEMBER WAS NOT GIVEN THE ROOM, CARE AND SERMON KEYS within ${WAIT / 1000} s — ${show()}`);
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

// ── ROUND 2 (audit of 78ffad0): A BLOCKED PERSON STAYS OUT — ON THE LIVE CONSOLE AND ON A COLD ONE — AND UNBLOCK BRINGS THEM BACK ──
// HIGH 1 of the audit was a console re-wrapping the ROTATED room key to the person just blocked, because the lists it
// reconciled against were not fresh. The rows below drive the real engine against a real relay: MF is blocked and every
// key rotated away from them — by the same calls rotateChurchKeys (app/stew-dashboard.jsx, Block) makes, made here
// directly, so the Block screen itself is not what is under test — then the console stays open, then is closed and
// reopened cold. The reconcile must never put MF back. Unblocking MF must give all three keys back (P2: the hold is a
// hold, not a ban).
test('D · a blocked member\'s keys are rotated away and NOT handed back — not by the live console, not by a cold one', { skip: SKIP, timeout: 300000 }, async () => {
  assert.ok(room().includes(MF.pub) && care().includes(MF.pub) && media().includes(MF.pub), 'CONTROL: MF was not keyed before the block — run A–C first: ' + show());
  const r = await evalIn(`(async () => { const S = window.Steward;
    const ok = await S.setBlocked([${JSON.stringify(MF.pub)}]);
    const keep = ${JSON.stringify([M1.pub, MA.pub, MP.pub])};
    const r = [ok, await S.rotateCareKey(keep, []), await S.rotateMediaKey(keep, []), await S.publishGroupKey(${JSON.stringify(roomId)}, keep, { rotate: true })];
    return r.map(x => (x && typeof x === 'object') ? 'ok' : String(x)).join(','); })()`);
  assert.ok(!/false|null|undefined/.test(r), 'CONTROL: the block or a rotation did not land: ' + r);
  assert.ok(await until(() => !room().includes(MF.pub) && !care().includes(MF.pub) && !media().includes(MF.pub), 20000), 'CONTROL: the rotations did not take MF out: ' + show());
  // the live console: membership ticks, envelopes come back from the relay, the reconcile runs on each
  await H.publishAll(relay, [joinTo(churchA, M1)]);            // a roster event (M1 re-announces), so the distributor re-runs
  await sleep(15000);
  assert.ok(!room().includes(MF.pub), 'THE LIVE CONSOLE WRAPPED THE ROTATED ROOM KEY BACK TO THE MEMBER IT JUST BLOCKED — ' + show());
  assert.ok(!care().includes(MF.pub) && !media().includes(MF.pub), 'the live console gave the blocked member the care or sermon key back — ' + show());
  // a cold console: no saved member list, every list read afresh
  await closeConsole();
  await openConsoleWithNoMemberCache();
  await sleep(20000);
  assert.ok(!room().includes(MF.pub), 'A COLD CONSOLE WRAPPED THE ROTATED ROOM KEY BACK TO THE BLOCKED MEMBER — ' + show());
  assert.ok(!care().includes(MF.pub) && !media().includes(MF.pub), 'a cold console gave the blocked member the care or sermon key back — ' + show());
  assert.ok(room().includes(M1.pub) && care().includes(M1.pub), 'the rotation or the reconcile took a member who was NOT blocked out — ' + show());
});

test('E · unblocking them gives the room, care and sermon keys back', { skip: SKIP, timeout: 300000 }, async () => {
  assert.ok(!room().includes(MF.pub), 'CONTROL: MF still had the room key — run D first');
  const r = await evalIn(`window.Steward.setBlocked([], { unblock: [${JSON.stringify(MF.pub)}] }).then(x => String(!!x))`);
  assert.equal(r, 'true', 'the unblock was not saved');
  const got = await until(() => room().includes(MF.pub) && care().includes(MF.pub) && media().includes(MF.pub), WAIT);
  const why = got ? '' : await evalIn(`JSON.stringify({ blockedHere: window.Steward.blockedHere(), device: localStorage.getItem('trinityone.steward.blockedlast.' + ${JSON.stringify(churchA)}), relays: window.Steward.relayList(), join: window.Steward.joinPolicyFresh && window.Steward.joinPolicyFresh() })`).catch(e => String(e));
  assert.ok(got, `UNBLOCKING A MEMBER DID NOT GIVE THEM THEIR KEYS BACK within ${WAIT / 1000} s — ${show()} — console: ${why}`);
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

// ── ROUND 3a (MED): A REAL SECOND CONSOLE ──────────────────────────────────────────────────────────────────────────
// Row D is the console that pressed Block, and its own remembered blocklist protects it — with the freshness gate and
// the drop hold both removed from KeyDistributor, D still passed (audit of 244a6fe). This row is the auditor's case:
// a SECOND console (the owner's other device — here a second tab of the same browser profile, which shares the stored
// church key but not the first tab's memory) is AWAY while the first blocks MA and rotates the room. It comes back,
// its screens still holding the lists from before, and the rotated envelope arrives while the subscription that
// carries the blocklist is slow (a page-level WebSocket shim holds that one subscription's frames back — in order, its
// EOSE included: "that answer is late", not "the relay lied"). It must not wrap the new room key back to MA.
// The shim is installed before the console's scripts load; nostr-tools captures window.WebSocket at load.
const WS_SHIM = `(() => {
  const W = window.WebSocket; window.__ws = [];
  const H = window.__hold = { offline: false, on: false, d: '', subs: new Set(), q: [] };
  class HW extends W {
    constructor(u, p) { super(H.offline ? 'ws://127.0.0.1:9/' : u, p); window.__ws.push(this); }
    set onmessage(fn) { this.__on = fn; if (!this.__wired) { this.__wired = true; W.prototype.addEventListener.call(this, 'message', (ev) => this.__route(ev)); } }
    get onmessage() { return this.__on; }
    __route(ev) {
      let sid = null;
      try { const m = JSON.parse(ev.data); if (Array.isArray(m) && (m[0] === 'EVENT' || m[0] === 'EOSE' || m[0] === 'CLOSED')) { sid = m[1];
        if (H.on && m[0] === 'EVENT' && m[2] && (m[2].tags || []).some(t => t[0] === 'd' && (H.match ? H.match(String(t[1])) : String(t[1]).startsWith(H.d)))) H.subs.add(sid); } } catch (e) {}
      if (sid && H.subs.has(sid)) { H.q.push([this, ev]); return; }
      if (this.__on) this.__on(ev);
    }
  }
  window.WebSocket = HW;
  window.__release = () => { H.on = false; const q = H.q; H.q = []; H.subs.clear(); for (const [w, ev] of q) { try { w.__on && w.__on(ev); } catch (e) {} } return q.length; };
})();`;
async function secondConsole() {
  const t = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: 'PUT' })).json();
  const w2 = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { w2.on('open', res); w2.on('error', rej); });
  let id = 0; const pend = new Map();
  w2.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); w2.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: WS_SHIM });
  const ev = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error('in tab 2: ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };
  await send('Page.navigate', { url: relay.base + '/steward.html' });
  await sleep(2500);
  // unlock, as the first tab does
  const t0 = Date.now();
  while (Date.now() - t0 < 90000 && !(await ev(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('Your PIN or passphrase'))`).catch(() => false))) await sleep(400);
  await ev(typePh('Your PIN or passphrase', PIN)); await sleep(200);
  await ev(click('/^Unlock/')); await sleep(500);
  const t1 = Date.now();
  while (Date.now() - t1 < 90000 && !(await ev(`[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Settings') && !document.querySelector('[data-stew-modal-panel]')`).catch(() => false))) await sleep(400);
  return { ev, close: async () => { try { await fetch(`http://127.0.0.1:${cdpPort}/json/close/${t.id}`); } catch {} try { w2.close(); } catch {} } };
}
const blockAndRotate = (pk, keep) => evalIn(`(async () => { const S = window.Steward;
  const ok = await S.setBlocked([${JSON.stringify(pk)}]);
  const keep = ${JSON.stringify(keep)};
  const r = [ok, await S.rotateCareKey(keep, []), await S.rotateMediaKey(keep, []), await S.publishGroupKey(${JSON.stringify('')} + window.__roomId, keep, { rotate: true })];
  return r.map(x => (x && typeof x === 'object') ? 'ok' : String(x)).join(','); })()`);

test('F · a SECOND console that was away while MA was blocked comes back with stale lists and a slow blocklist answer — and does not re-key MA', { skip: SKIP, timeout: 360000 }, async () => {
  assert.ok(room().includes(MA.pub), 'CONTROL: MA is not in the room before the block — run A–E first: ' + show());
  const two = await secondConsole();
  try {
    assert.ok(await until(() => true, 1) && await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 60000) { if (await two.ev(`(() => { const r = window.Steward.groupKeyRecipients(${JSON.stringify(roomId)}); return !!(r && r.includes(${JSON.stringify(MA.pub)})); })()`).catch(() => false)) return true; await sleep(500); } return false; })(),
      'CONTROL: the second console never read the room\'s envelope with MA in it');
    await sleep(6000);                                         // let its lists settle — fresh, before the block
    // AWAY: its sockets closed, and any reconnect sent to a dead port
    await two.ev(`(() => { window.__hold.offline = true; for (const w of window.__ws) { try { w.close(); } catch (e) {} } return 1; })()`);
    await sleep(3000);
    // the FIRST console blocks MA and rotates the room, care and sermon keys away from them
    await evalIn(`(() => { window.__roomId = ${JSON.stringify(roomId)}; return 1; })()`);
    const r = await blockAndRotate(MA.pub, [M1.pub, MF.pub, MP.pub]);
    assert.ok(!/false|null|undefined/.test(r), 'CONTROL: the block or a rotation did not land: ' + r);
    assert.ok(await until(() => !room().includes(MA.pub), 20000), 'CONTROL: the rotation did not take MA out of the room: ' + show());
    // BACK: the blocklist's subscriptions are slow (held), everything else flows; the console reconnects
    await two.ev(`(() => { window.__hold.d = 'trinityone/blocked:'; window.__hold.on = true; window.__hold.offline = false; window.dispatchEvent(new Event('online')); return 1; })()`);
    await sleep(25000);
    assert.ok(!room().includes(MA.pub), 'THE SECOND CONSOLE WRAPPED THE ROTATED ROOM KEY BACK TO THE MEMBER JUST BLOCKED — from the lists it held before it went away (audit of 78ffad0, HIGH 1): ' + show());
    const held = await two.ev(`window.__hold.q.length`);
    assert.ok(held > 0, 'CONTROL: nothing was held back — the second console read the blocklist at once, so this row proved nothing');
    // the blocklist answer arrives: still nothing for MA
    await two.ev(`window.__release()`);
    await sleep(10000);
    assert.ok(!room().includes(MA.pub), 'once the blocklist arrived, the second console re-keyed MA anyway: ' + show());
    assert.ok(room().includes(M1.pub), 'CONTROL: a member who was not blocked lost the room key: ' + show());
  } finally { await two.close(); }
});

// ── ROUND 3c, HIGH 1 (audit of 432c676): BLOCK, PRESSED ON THE MEMBERS SCREEN, TAKES NOBODY ELSE'S KEY — AND HOW FAST ──
// 3a narrowed every rotation to the approved members it could name, and the member app deletes a key it is no longer
// given — so a Block that could not tell approval rotated care, sermon and rooms to the admitted list alone, and in an
// open-join church to nobody. The owner's rule is "once admitted, rooms open". This row presses Block on the real screen
// and reads every key envelope the console SENDS (off its socket, not the relay's newest copy, so a drop the distributor
// repaired a second later is still seen): none of the rotated envelopes may leave out an approved member who stays. Then
// a member approved and joining straight after the Block is timed until they hold all three keys. Both times are logged
// as the liveness measurement.
const blockOnScreen = async (who, others) => {
  const npub = (p) => nip19.npubEncode(p).slice(0, 12);
  await evalIn(click('/^Members$/')); await sleep(2000);
  await evalIn(`(() => { if (document.querySelector('button[title="Remove / block this member"]')) return 'direct'; const b = [...document.querySelectorAll('button')].find(x => /^More for /.test(x.getAttribute('aria-label') || '')); if (b) b.click(); return 'more'; })()`);
  await sleep(600);
  const opened = await evalIn(`(() => { const me = ${JSON.stringify(npub(who.pub))}, others = ${JSON.stringify(others.map(o => npub(o.pub)))};
    const btns = [...document.querySelectorAll('button[title="Remove / block this member"], button[title="Decline — blocks this person from joining or posting"]')];
    const mine = btns.find(b => { let n = b; for (let i = 0; i < 8 && n; i++) { n = n.parentElement; const t = (n && n.textContent) || ''; if (t.includes(me)) return !others.some(o => t.includes(o)); if (others.some(o => t.includes(o))) return false; } return false; }) || null;
    if (!mine) return 'miss:' + btns.length; mine.click(); return 'ok'; })()`);
  assert.equal(opened, 'ok', 'no Block button for ' + nm(who.pub));
  await sleep(500);
  assert.equal(await evalIn(`(() => { const b = document.querySelector('button[title="Confirm — bans them from posting & hides their messages"]') || document.querySelector('button[title="Confirm — blocks them from joining or posting, and re-keys the church"]'); if (!b) return 'miss'; b.click(); return 'ok'; })()`), 'ok', 'no Block confirmation');
};
const MG = H.key();   // joins in row G; stays through row H's Block
const SEND_HOOK = `(() => { if (window.__envHooked) { window.__env = []; return 1; } window.__envHooked = 1; window.__env = [];
  const os = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) { try { if (typeof d === 'string' && d.startsWith('["EVENT"')) { const e = JSON.parse(d)[1]; const dd = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
      if (/^trinityone\\/(carekey|mediakey|groupkey):/.test(dd)) window.__env.push({ d: dd, at: Date.now(), recips: Object.keys(JSON.parse(e.content).keys || {}) }); } } catch (x) {}
    return os.call(this, d); }; return 1; })()`;
test('G · a Block pressed on the Members screen takes no approved member\'s key, even for a moment — and a member approved straight after is keyed promptly', { skip: SKIP, timeout: 300000 }, async () => {
  assert.ok([M1, MF, MP].every(k => room().includes(k.pub) && care().includes(k.pub) && media().includes(k.pub)), 'CONTROL: M1, MF and MP are not all keyed before the Block — run A–F first: ' + show());
  await evalIn(SEND_HOOK);
  const t0 = Date.now();
  await blockOnScreen(MP, [M1, MF]);
  assert.ok(await until(() => !room().includes(MP.pub) && !care().includes(MP.pub) && !media().includes(MP.pub), 45000), 'CONTROL: the Block did not rotate MP out of all three keys: ' + show());
  const tRotated = Date.now() - t0;
  const sent = await evalIn('window.__env');
  const rotated = sent.filter(x => !x.recips.includes(MP.pub) && (x.d === GROUPKEY_D + roomId || x.d === CAREKEY_D + churchA || x.d === MEDIAKEY_D + churchA));
  assert.ok(rotated.length >= 3, 'CONTROL: the console sent fewer than three rotated envelopes: ' + JSON.stringify(sent.map(x => x.d.slice(11, 19))));
  for (const x of rotated) {
    for (const k of [M1, MF]) assert.ok(x.recips.includes(k.pub), `A BLOCK TOOK ${nm(k.pub)}'S ${x.d.slice(11, 19)} AWAY — an approved member who stays, dropped by the rotation (the member app deletes the key it is no longer given): [${x.recips.map(nm)}]`);
  }
  // a member approved and joining straight after the Block (MG: module scope, row H blocks around them)
  assert.equal(await admit([MG.pub]), 'ok', 'the approval was not saved');
  const t1 = Date.now();
  await H.publishAll(relay, [joinTo(churchA, MG)]);
  const got = await until(() => room().includes(MG.pub) && care().includes(MG.pub) && media().includes(MG.pub), WAIT);
  const tJoin = Date.now() - t1;
  console.log(`[liveness] Block → all three keys rotated (seen on the relay): ${(tRotated / 1000).toFixed(1)} s; approved member dropped by any rotated envelope: none; member approved after the Block → keyed to room, care and sermon: ${got ? (tJoin / 1000).toFixed(1) + ' s' : 'NOT within ' + WAIT / 1000 + ' s'}`);
  assert.ok(got, `A MEMBER APPROVED STRAIGHT AFTER A BLOCK WAS NOT KEYED within ${WAIT / 1000} s — ${show()}`);
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

// ── ROUND 3d, LOW 2 (audit of 0f5cd2d): SOMEONE WHO HAS LEFT IS NOT CARRIED THROUGH A BLOCK ──────────────────────────────
// 3c's floor kept every current holder of a key through a Block, so a member who had LEFT (their member document
// tombstoned) kept every rotated key — against the owner's rule that someone who leaves cannot read what is sealed after
// they left (DOMAIN 2026-09-30). The console's member list now says when it is a genuine read of the member documents,
// and then a holder not on it is let go. Here M1, keyed to all three, leaves; the steward Blocks MF on the real screen;
// none of the rotated envelopes the console SENDS may include M1, and the member who stays (MG) keeps everything.
test('H · someone who has LEFT is not carried through a Block pressed on the Members screen — once the member list is a genuine read', { skip: SKIP, timeout: 300000 }, async () => {
  assert.ok([M1, MF].every(k => room().includes(k.pub) && care().includes(k.pub) && media().includes(k.pub)), 'CONTROL: M1 and MF are not both keyed — run A–G first: ' + show());
  const ts = Math.floor(Date.now() / 1000);
  await H.publishAll(relay, [finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', MEMBER_D + churchA], ['t', 'trinityone'], ['p', churchA], ['deleted', '1']], content: '' }, M1.sk)]);
  // the console's member list drops M1, and is FRESH (a genuine read of the member documents has settled)
  const fresh = await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 45000) {
    const r = await evalIn(`new Promise(res => { let done = false; const off = window.Steward.subscribeMembers(l => { if (done) return; if (window.Steward.listIsFresh(l)) { done = true; try { off(); } catch (e) {} res({ fresh: true, m1: l.some(m => m.pubkey === ${JSON.stringify(M1.pub)}) }); } }); setTimeout(() => { if (!done) { done = true; try { off(); } catch (e) {} res({ fresh: false }); } }, 15000); })`);
    if (r && r.fresh && !r.m1) return true; await sleep(1000); } return false; })();
  assert.ok(fresh, 'CONTROL: the console\'s member list never became a fresh read without M1 — over a real relay the member-document read did not settle, or M1\'s leaving was not seen');
  await evalIn(SEND_HOOK);
  await blockOnScreen(MF, [MG]);
  assert.ok(await until(() => !room().includes(MF.pub) && !care().includes(MF.pub) && !media().includes(MF.pub), 45000), 'CONTROL: the Block did not rotate MF out: ' + show());
  const sent = await evalIn('window.__env');
  const rotated = sent.filter(x => !x.recips.includes(MF.pub) && (x.d === GROUPKEY_D + roomId || x.d === CAREKEY_D + churchA || x.d === MEDIAKEY_D + churchA));
  assert.ok(rotated.length >= 3, 'CONTROL: fewer than three rotated envelopes were sent');
  for (const x of rotated) assert.ok(!x.recips.includes(M1.pub), `SOMEONE WHO HAS LEFT (M1) WAS CARRIED THROUGH THE BLOCK'S ${x.d.slice(11, 19)} ROTATION: [${x.recips.map(nm)}]`);
  // …AND THE MEMBER WHO STAYS KEEPS EVERYTHING (round 3e, LOW 2) — the dangerous direction: a rotation that dropped MG
  // would make MG's phone delete the key. Every rotated envelope the console sent, and the relay's copy afterwards.
  for (const x of rotated) assert.ok(x.recips.includes(MG.pub), `THE BLOCK'S ${x.d.slice(11, 19)} ROTATION DROPPED MG, A MEMBER WHO STAYS — their phone deletes the key: [${x.recips.map(nm)}]`);
  assert.ok(room().includes(MG.pub) && care().includes(MG.pub) && media().includes(MG.pub), 'after the Block, MG (a member who stays) is missing from a key on the relay: ' + show());
  await sleep(10000);   // the distributor's ticks: M1 must not be handed back either
  assert.ok(!room().includes(M1.pub) && !care().includes(M1.pub) && !media().includes(M1.pub), 'the distributor handed the rotated keys back to someone who has LEFT: ' + show());
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

// ── ROUND 3e, MED 1 (audit of b102dc6): A BLOCK WHILE THE KEY READS ARE STILL SETTLING ─────────────────────────────────
// In a console's first seconds, or after a dropped connection, the care and sermon reads have not settled, and since 3d a
// rotation must not run from what the device last held. It used to answer `false`: the person stayed blocked but kept the
// keys, the screen said "try blocking them again" (the Blocked list offers only Unblock), and nothing ever ran it. Now
// Block waits up to 10 s, then the engine REMEMBERS the rotation and runs it when the read settles, and the screen says so.
// Here a second tab of the console opens with its care-key AND sermon-key reads held back (the page-level WebSocket shim of
// row F, armed before the page loads), presses Block on MG, waits out the 10 s, and only then lets the reads through.
test('I · a Block while the care and sermon reads are still held back is REMEMBERED, said truthfully, and runs once they settle', { skip: SKIP, timeout: 360000 }, async () => {
  assert.ok(room().includes(MG.pub) && care().includes(MG.pub) && media().includes(MG.pub), 'CONTROL: MG is not keyed — run A–H first: ' + show());
  const t = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: 'PUT' })).json();
  const w2 = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { w2.on('open', res); w2.on('error', rej); });
  let id = 0; const pend = new Map();
  w2.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); w2.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => { const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); return rr?.result?.result?.value; };
  try {
    await send('Runtime.enable'); await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: WS_SHIM });
    // hold every subscription that carries a care or sermon envelope — its events AND its EOSE — from the first frame
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const H = window.__hold; H.on = true; H.d = 'trinityone/'; H.match = (d) => d.startsWith('trinityone/carekey:') || d.startsWith('trinityone/mediakey:'); })();` });
    await send('Page.navigate', { url: relay.base + '/steward.html' });
    await sleep(2500);
    const t0 = Date.now();
    while (Date.now() - t0 < 90000 && !(await ev(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('Your PIN or passphrase'))`).catch(() => false))) await sleep(400);
    await ev(typePh('Your PIN or passphrase', PIN)); await sleep(200); await ev(click('/^Unlock/'));
    const t1 = Date.now();
    while (Date.now() - t1 < 90000 && !(await ev(`[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Members')`).catch(() => false))) await sleep(400);
    assert.equal(await ev(`window.Steward.keysFresh('care')`), false, 'CONTROL: the care read was not held back — this row would prove nothing');
    // Block MG on the Members screen of THIS tab
    await ev(click('/^Members$/')); await sleep(2000);
    const me = nip19.npubEncode(MG.pub).slice(0, 12);
    await ev(`(() => { if (document.querySelector('button[title="Remove / block this member"]')) return 1; const b = [...document.querySelectorAll('button')].find(x => /^More for /.test(x.getAttribute('aria-label') || '')); if (b) b.click(); return 1; })()`);
    await sleep(600);
    assert.equal(await ev(`(() => { const btns = [...document.querySelectorAll('button[title="Remove / block this member"], button[title="Decline — blocks this person from joining or posting"]')];
      const mine = btns.find(b => { let n = b; for (let i = 0; i < 8 && n; i++) { n = n.parentElement; if (((n && n.textContent) || '').includes(${JSON.stringify(me)})) return true; } return false; }); if (!mine) return 'miss'; mine.click(); return 'ok'; })()`), 'ok', 'no Block button for MG');
    await sleep(500);
    assert.equal(await ev(`(() => { const b = document.querySelector('button[title="Confirm — bans them from posting & hides their messages"]') || document.querySelector('button[title="Confirm — blocks them from joining or posting, and re-keys the church"]'); if (!b) return 'miss'; b.click(); return 'ok'; })()`), 'ok', 'no Block confirmation');
    await sleep(13000);                                       // past the 10 s wait: the rotation must now be REMEMBERED
    const said = await ev('document.body.innerText');
    assert.match(said, /will be removed as soon as this console finishes connecting/, 'A WAITING ROTATION WAS NOT SAID AS WAITING: ' + said.slice(0, 400));
    assert.doesNotMatch(said, /Try blocking them again|grown past what one key document/, 'THE SCREEN TOLD THE STEWARD TO BLOCK AGAIN (the Blocked list offers only Unblock) OR BLAMED THE CHURCH\'S SIZE');
    assert.ok(care().includes(MG.pub), 'CONTROL: the care key rotated while its read was held — this row would prove nothing');
    // the reads arrive
    await ev(`window.__release()`);
    assert.ok(await until(() => !care().includes(MG.pub) && !media().includes(MG.pub), 45000), 'THE REMEMBERED ROTATION NEVER RAN once the reads settled — MG still holds the care or sermon key: ' + show());
    assert.ok(await (async () => { const t2 = Date.now(); while (Date.now() - t2 < 20000) { if (/Done — they can no longer open anything sealed/.test(await ev('document.body.innerText'))) return true; await sleep(500); } return false; })(), 'the screen never said the waiting rotation had run');
  } finally { try { await fetch(`http://127.0.0.1:${cdpPort}/json/close/${t.id}`); } catch {} try { w2.close(); } catch {} }
});

// ── ROUND 3g (audit of b4b7277): "TRY AGAIN" RUNS THE REAL RETRY, END TO END ─────────────────────────────────────────────
// every-key-path's Try again rows give the screen a status from a stub; here the console's own runner produces it. MJ is
// keyed, then blocked on the Members screen while the room-key publish is refused (the page drops that one EVENT on its
// socket). The screen must name the room key it could not change and offer "Try again"; with the publish let through,
// pressing it must really rotate the room — MJ out, on the relay — and the screen must then say Done.
const MJ = H.key();
test('J · a Block whose ROOM key could not change offers "Try again" — which really rotates the room, and the screen says Done', { skip: SKIP, timeout: 300000 }, async () => {
  assert.equal(await admit([MJ.pub]), 'ok', 'CONTROL: MJ could not be approved');
  await H.publishAll(relay, [joinTo(churchA, MJ)]);
  assert.ok(await until(() => room().includes(MJ.pub) && care().includes(MJ.pub), WAIT), 'CONTROL: MJ was never keyed: ' + show());
  // refuse the room-key publish: drop any EVENT for this room's key envelope on the socket
  await evalIn(`(() => { if (!window.__gkDropHooked) { window.__gkDropHooked = 1; const os = WebSocket.prototype.send;
    WebSocket.prototype.send = function (d) { try { if (window.__dropGk && typeof d === 'string' && d.startsWith('["EVENT"') && d.includes('"trinityone/groupkey:')) return; } catch (e) {} return os.call(this, d); }; }
    window.__dropGk = true; return 1; })()`);
  await evalIn(click('/^Members$/')); await sleep(1500);
  await blockOnScreen(MJ, []);
  const said1 = await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 60000) { const t = await evalIn('document.body.innerText'); if (/could not change the key for Bede Sealed yet/.test(t)) return t; await sleep(1000); } return await evalIn('document.body.innerText'); })();
  assert.match(said1, /could not change the key for Bede Sealed yet/, 'the refused room-key rotation was not named: ' + said1.slice(0, 400));
  assert.ok(room().includes(MJ.pub), 'CONTROL: the room key rotated though its publish was refused — this row would prove nothing');
  // let it through, and press Try again
  await evalIn(`(() => { window.__dropGk = false; return 1; })()`);
  assert.equal(await evalIn(click('/^Try again$/')), 'ok', 'no "Try again" on screen for the room key that could not change');
  assert.ok(await until(() => !room().includes(MJ.pub), 45000), 'TRY AGAIN DID NOT ROTATE THE ROOM — MJ still holds its key on the relay: ' + show());
  assert.ok(await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 30000) { if (/Done — they can no longer open anything sealed/.test(await evalIn('document.body.innerText'))) return true; await sleep(500); } return false; })(),
    'the screen never said Done after the retry ran');
  assert.ok(room().includes(MA.pub) === false && care().includes(MJ.pub) === false, 'the Block left MJ a care key, or put MA back: ' + show());
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});
