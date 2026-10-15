// AN EXPLICIT UNBLOCK LIFTS A BLOCK THIS CONSOLE REMEMBERS — AND ONLY AN EXPLICIT UNBLOCK DOES (owner, 2026-10-15).
//   Run: node --test scripts/a-remembered-block-lifts-only-on-an-explicit-unblock.test.mjs
//
// THE BUG. A steward unblocked a member, yet one console treated them as blocked for ever, across restarts: left out of every
// key, off every rota, out of every room on that device, while the church saw them as fine. The device copy
// (`trinityone.steward.blockedlast.<church>`) re-seeded `_localBlocked` on every start and carried no clock, so nothing could
// tell a NEWER unblock from a relay that merely missed a Block; and the Members screen built its blocked list from the
// subscription alone, so a block held only by the device had no Unblock button.
//
// THE RULE (the owner's, narrowed 2026-10-15): a remembered block stays until the church EXPLICITLY unblocks that person.
// setBlocked({ unblock }) now names them on `unblocked` tags of the church-signed event; the device keeps when it learned of
// each block (`blockedsince.<church>`); subscribeBlocked lifts a block only for an authentic event that names the person and
// is newer. A newer list that merely OMITS them lifts nothing. And the Members screen always lists what THIS device holds.
//
// THE POINT OF USE (CLAUDE.md rule 1): two real gateways on FREE ports and the real console in headless chromium, as in
// a-blocked-member-this-console-remembers-stays-blocked.test.mjs. Rows, in order:
//   1. MANUAL LIFT — a block only the device remembers (a bare-array copy, from before the stamps) while the blocklist read
//      never settles (the page drops its REQ — the read that never answers) shows an Unblock button on the Members screen;
//      pressing it clears the device and publishes a church-signed event that names them.
//   2. A newer church list that omits a blocked person, with relay 2 down, and no unblock of them: still blocked.
//   3. The real Unblock control, then a console that never saw it (its device copy put back as it was): the reopened console
//      reads the event the control produced and lifts the block, with relay 2 still down — and re-keys the member.
// TEST-ENV ONLY: Page.setBypassCSP (see the sibling test). Skips itself without chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { finalizeEvent, nip19, nip44 } from 'nostr-tools';
import { privateKeyFromSeedWords } from 'nostr-tools/nip06';
import * as H from './relay-network-harness.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PIN = 'cedar-harbour-lamp-42';
const NAMEKEY_D = 'trinityone/namekey:', CAREKEY_D = 'trinityone/carekey:', MEMBER_D = 'trinityone/member:', GROUPKEY_D = 'trinityone/groupkey:';
const BLOCKED_D = 'trinityone/blocked:';
const WAIT = 30000;
let r1, r2, chr, ws, prof, evalIn, cdpSend, churchA = '', ASK = null, roomId = '';
const B = H.key(), M = H.key(), X1 = H.key(), X2 = H.key(), X3 = H.key();
const errors = [];
const nm = (p) => p === churchA ? 'A' : p === M.pub ? 'M' : p === X1.pub ? 'X1' : p === X2.pub ? 'X2' : p === X3.pub ? 'X3' : String(p).slice(0, 6);
function held(relay, where, ...args) {
  const db = new DatabaseSync(join(relay.dataDir, 'relay.sqlite'), { readOnly: true });
  try { return db.prepare('SELECT raw FROM events WHERE kind = 30078 AND ' + where).all(...args).map(r => { try { return JSON.parse(String(r.raw || '')); } catch { return {}; } }); }
  finally { db.close(); }
}
const recipsOn = (relay, d) => { const r = held(relay, 'dtag = ?', d)[0]; return r && r.content ? Object.keys(JSON.parse(r.content).keys || {}) : []; };
const blockedOn = (relay) => held(relay, 'dtag = ?', BLOCKED_D + churchA).map(e => JSON.parse(e.content).pubkeys || []);
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
async function reload() { await evalIn(`(() => { location.reload(); return 'ok'; })()`); await sleep(3000); await unlock(); }
// THE BLOCK, pressed on the Members screen for `who`: the button in the row that names `who` and no other member
async function blockOnScreen(who, others) {
  await press('/^Members$/', 'the Members section'); await sleep(2000);
  await evalIn(`(() => { if (document.querySelector('button[title="Remove / block this member"]')) return 'direct'; const b = [...document.querySelectorAll('button')].find(x => /^More for /.test(x.getAttribute('aria-label') || '')); if (b) b.click(); return 'more'; })()`);
  await sleep(600);
  const opened = await evalIn(`(() => { const me = ${JSON.stringify(nip19.npubEncode(who.pub).slice(0, 12))}, others = ${JSON.stringify(others.map(o => nip19.npubEncode(o.pub).slice(0, 12)))};
    const btns = [...document.querySelectorAll('button[title="Remove / block this member"], button[title="Decline — blocks this person from joining or posting"]')];
    const mine = btns.find(b => { let n = b; for (let i = 0; i < 8 && n; i++) { n = n.parentElement; const t = (n && n.textContent) || ''; if (t.includes(me)) return !others.some(o => t.includes(o)); if (others.some(o => t.includes(o))) return false; } return false; }) || null;
    if (!mine) return 'miss:' + btns.length; mine.click(); return 'ok'; })()`);
  assert.equal(opened, 'ok', 'no Block button for ' + nm(who.pub));
  await sleep(500);
  assert.equal(await evalIn(`(() => { const b = document.querySelector('button[title="Confirm — bans them from posting & hides their messages"]') || document.querySelector('button[title="Confirm — blocks them from joining or posting, and re-keys the church"]'); if (!b) return 'miss'; b.click(); return 'ok'; })()`), 'ok', 'no Block confirmation');
}
// every key envelope the console sends, off its socket; and TEST-ONLY: while localStorage['test.dropBlockedRead'] is '1', the
// REQ of the narrow read of the blocklist document is dropped — the read that never answers (the stream still delivers)
const HOOK = `(() => { if (window.__envHooked) return; window.__envHooked = 1; window.__env = [];
  const os = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) { try {
      if (typeof d === 'string' && d.startsWith('["EVENT"')) { const e = JSON.parse(d)[1]; const dd = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (/^trinityone\\/(namekey|carekey|mediakey|groupkey):/.test(dd)) window.__env.push({ d: dd, recips: Object.keys(JSON.parse(e.content).keys || {}) }); }
      if (typeof d === 'string' && d.startsWith('["REQ"') && localStorage.getItem('test.dropBlockedRead') === '1') {
        const fs = JSON.parse(d).slice(2).flat(); if (fs.some(f => (f['#d'] || []).some(x => String(x).startsWith('trinityone/blocked:')))) return; } } catch (x) {}
    return os.call(this, d); };
})();`;

before(async () => {
  if (!CHROME) return;
  r1 = await H.startRelay({ name: 'lifts-1', env: { TRINITY_TAILSCALE_BIN: '/nonexistent' } });
  r2 = await H.startRelay({ name: 'lifts-2', env: { TRINITY_TAILSCALE_BIN: '/nonexistent' } });
  const cdp = await H.freePort('the lift test\'s Chrome debug port');
  prof = mkdtempSync(join(tmpdir(), 'trin-lifts-chr-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=1440,1200', `${r1.base}/steward.html`], { stdio: 'ignore' });
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
  // church A, by the wizard, on relay 1
  await waitFor(`[...document.querySelectorAll('button')].some(x => /Start a new church/i.test((x.textContent||'').trim()))`, 90000, 'Start a new church');
  await press('/Start a new church/i');
  await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('At least 8'))`, 60000, 'the PIN box');
  assert.equal(await evalIn(typePh('At least 8', PIN)), 'ok');
  assert.equal(await evalIn(typePh('Type it again', PIN)), 'ok');
  await press('/Set PIN/i');
  await waitFor(`!!document.querySelector('input[aria-label="Church name"]')`, 90000, 'the wizard name step');
  churchA = await evalIn(`window.Steward && window.Steward.churchPub || ''`);
  const npubA = await evalIn(`window.Steward.npub || ''`);
  assert.equal(await evalIn(typeInto('input[aria-label="Church name"]', 'St Chad Lifts')), 'ok');
  await sleep(300);
  await press('/^Continue$/');
  { const t0 = Date.now(); let ok = false; while (!ok && Date.now() - t0 < 30000) { try { ok = (JSON.parse(readFileSync(join(r1.dataDir, 'church.json'), 'utf8')).churches || []).some(c => c && c.npub === npubA); } catch {} if (!ok) await sleep(400); } assert.ok(ok, 'relay 1 never registered church A'); }
  await waitFor(`localStorage.getItem('trinityone.steward.boxhosts.' + window.Steward.churchPub) === '1'`, 30000, 'the console to learn the box holds it');
  const reg2 = await fetch(r2.base + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + r2.adminToken },
    body: JSON.stringify({ addChurch: { npub: npubA, name: 'Church A' } }) });
  assert.equal(reg2.status, 200, 'relay 2 would not register church A');
  // something relay 1 withholds from a socket that has not logged in, so its lazy NIP-42 challenge fires at all:
  // a stewarded church B whose envelopes are wrapped to this console (as the other browser key tests do)
  const reg1 = await fetch(r1.base + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + r1.adminToken },
    body: JSON.stringify({ addChurch: { npub: nip19.npubEncode(B.pub), name: 'Church B' } }) });
  assert.equal(reg1.status, 200, 'relay 1 would not register church B');
  const ts = Math.floor(Date.now() / 1000) - 5;
  const wrap = (ring, recips) => Object.fromEntries(recips.map(p => [p, nip44.v2.encrypt(JSON.stringify(ring), nip44.v2.utils.getConversationKey(B.sk, p))]));
  await H.publishAll(r1, [
    finalizeEvent({ kind: 0, created_at: ts, tags: [], content: JSON.stringify({ name: 'Church B' }) }, B.sk),
    finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', 'trinityone/stewards:' + B.pub], ['t', 'trinityone']], content: JSON.stringify({ pubkeys: [churchA] }) }, B.sk),
    finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', CAREKEY_D + B.pub], ['t', 'trinityone']], content: JSON.stringify({ keys: wrap(['ab'.repeat(32)], [B.pub, churchA]), rev: 1 }) }, B.sk),
    finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', NAMEKEY_D + B.pub], ['t', 'trinityone']], content: JSON.stringify({ keys: wrap(['cd'.repeat(32)], [B.pub, churchA]), rev: 1 }) }, B.sk),
  ]);
  await evalIn(`(() => { localStorage.setItem('trinityone.steward.wizard.done', '1'); localStorage.removeItem('trinityone.steward.newchurch'); return 'ok'; })()`);
  await reload();
  await waitFor(`window.Steward.nameKeyReady() && !!window.Steward.careSeal({ a: 1 })`, 90000, 'church A\'s own name and care keys (one relay)');
  ASK = privateKeyFromSeedWords(await evalIn('window.Steward.exportMnemonic()'));
  // relay 2 joins the church's set through the console's own door, and proves itself
  await evalIn(`window.Steward.addRelay(${JSON.stringify(r2.wsUrl)})`);
  await cdpSend('Page.enable');
  await cdpSend('Page.setBypassCSP', { enabled: true });   // TEST-ENV ONLY — see the header
  await cdpSend('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
  await reload();
  await waitFor(`(window.Steward.relayList() || []).length >= 2`, 90000, 'relay 2 admitted (proved)');
  await reload();                                          // every subscription opens over both relays from the start
  await waitFor(`(window.Steward.relayList() || []).length >= 2`, 60000, 'relay 2 still admitted after a reload');
  await waitFor(`window.Steward.nameKeyReady() && !!window.Steward.careSeal({ a: 1 })`, 90000, 'church A\'s own name and care keys');
  // CONTROL, both relays up: members join and are keyed
  await H.publishAll(r1, [joinTo(churchA, M), joinTo(churchA, X1), joinTo(churchA, X2)]); await H.publishAll(r2, [joinTo(churchA, M), joinTo(churchA, X1), joinTo(churchA, X2)]);
  assert.ok(await until(() => { const n = recipsOn(r1, NAMEKEY_D + churchA); return n.includes(M.pub) && n.includes(X1.pub) && n.includes(X2.pub); }, 60000),
    'CONTROL: with both relays up, the members who joined were never given the name key — the rows below would prove nothing');
  await sleep(3000);
});

after(async () => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  H.stopAll();
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
});

const SKIP = !CHROME ? 'no chromium' : false;
const devCopy = async () => JSON.parse(await evalIn(`localStorage.getItem('trinityone.steward.blockedlast.' + ${JSON.stringify(churchA)}) || '[]'`));
const heldHere = async () => await evalIn('window.Steward.blockedHere()');
const sentTo = async (who) => (await evalIn('window.__env || []')).filter(x => x.d.endsWith(churchA)).filter(x => x.recips.includes(who)).map(x => x.d);
const blockDoc = () => held(r1, 'dtag = ?', BLOCKED_D + churchA)[0] || null;
// the Members screen's own controls for the blocked list: "See blocked", a row's Unblock, and its confirmation
async function unblockOnScreen(who) {
  await press('/^Members$/', 'the Members section'); await sleep(1500);
  await evalIn(`(() => { const b = [...document.querySelectorAll('button')].find(x => /^See blocked/.test((x.textContent || '').trim())); if (b) b.click(); return 1; })()`);
  await sleep(800);
  const hex = who.pub.slice(0, 12);
  const row = `[...document.querySelectorAll('button')].filter(b => /^Unblock /.test(b.getAttribute('aria-label') || '')).find(b => (b.parentElement && b.parentElement.textContent || '').includes(${JSON.stringify(hex)}))`;
  assert.equal(await evalIn(`(() => { const b = ${row}; if (!b) return 'miss'; b.click(); return 'ok'; })()`), 'ok', 'no Unblock button for ' + nm(who.pub));
  await sleep(500);
  assert.equal(await evalIn(`(() => { const b = [...document.querySelectorAll('button')].find(x => /^Confirm: let /.test(x.getAttribute('aria-label') || '') && (x.parentElement && x.parentElement.textContent || '').includes(${JSON.stringify(hex)})); if (!b) return 'miss'; b.click(); return 'ok'; })()`), 'ok', 'no Unblock confirmation for ' + nm(who.pub));
}
// is MX listed under "See blocked" on the Members screen?
async function shownBlocked(who) {
  await press('/^Members$/', 'the Members section'); await sleep(1500);
  await evalIn(`(() => { const b = [...document.querySelectorAll('button')].find(x => /^See blocked/.test((x.textContent || '').trim())); if (b) b.click(); return 1; })()`);
  await sleep(800);
  return await evalIn(`[...document.querySelectorAll('button')].some(b => /^Unblock /.test(b.getAttribute('aria-label') || '') && (b.parentElement && b.parentElement.textContent || '').includes(${JSON.stringify(who.pub.slice(0, 12))}))`);
}


// A console opened from a blank page does not reach its relays until it is reloaded once (measured: no frame on any socket
// after Page.navigate + unlock, 138 after a reload) — so every reopen here ends in a reload, or a row would assert over a
// console that never read the relay.
const reopen = async () => {
  await evalIn(`(() => { location.href = 'about:blank'; return 1; })()`).catch(() => {});
  await sleep(1500);
  await cdpSend('Page.navigate', { url: r1.base + '/steward.html' });
  await sleep(2500);
  await reload();
};
const seedOnQuietPage = async (js) => {                   // same origin, no console: localStorage is ours alone
  await evalIn(`(() => { location.href = 'about:blank'; return 1; })()`).catch(() => {});
  await sleep(1500);
  await cdpSend('Page.navigate', { url: r1.base + '/robots.txt' });
  await sleep(1500);
  await evalIn(`(() => { ${js} return 1; })()`);
};
const unblockTags = (ev) => ((ev && ev.tags) || []).filter(t => t[0] === 'unblocked').map(t => t[1]);
const listOf = (ev) => { try { return JSON.parse(ev.content).pubkeys || []; } catch { return []; } };

test('1. MANUAL LIFT: a block only this device remembers, while the blocklist read never answers, has an Unblock button — and pressing it clears the device and tells the church', { skip: SKIP, timeout: 300000 }, async () => {
  // the device copy as every console had it before the stamps: a bare array, no `blockedsince`. The relay lists nobody.
  // Written on a page where the console is NOT running (a live console would settle its read and overwrite the seed).
  await seedOnQuietPage(`localStorage.setItem('trinityone.steward.blockedlast.' + ${JSON.stringify(churchA)}, ${JSON.stringify(JSON.stringify([X3.pub]))});
    localStorage.removeItem('trinityone.steward.blockedsince.' + ${JSON.stringify(churchA)}); localStorage.setItem('test.dropBlockedRead', '1');`);
  await cdpSend('Page.navigate', { url: r1.base + '/steward.html' });
  await sleep(2500);
  await reload();
  await sleep(6000);
  assert.ok((await heldHere()).includes(X3.pub), 'CONTROL: this console does not hold X3 as blocked after the reopen — the stuck state is not in play');
  assert.ok(!(blockDoc() ? listOf(blockDoc()) : []).includes(X3.pub), 'CONTROL: the church\'s list names X3 — this row is about a block only the device holds');
  assert.ok(await shownBlocked(X3), 'A BLOCK THIS DEVICE REMEMBERS HAS NO UNBLOCK BUTTON: the Members screen lists only the subscribed list, so a steward cannot clear a stuck block by hand');
  await unblockOnScreen(X3);
  assert.ok(await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 30000) { if (!(await heldHere()).includes(X3.pub)) return true; await sleep(500); } return false; })(),
    'pressing Unblock did not take X3 off this console (`blockedHere`)');
  assert.ok(!(await devCopy()).includes(X3.pub), 'pressing Unblock left X3 on the device copy — the next start re-seeds the block');
  assert.ok(await until(() => unblockTags(blockDoc()).includes(X3.pub), 20000), 'the Unblock published no church-signed event naming X3 — no other console can tell it from a relay that missed a Block: ' + JSON.stringify(blockDoc() && blockDoc().tags));
  assert.ok(!listOf(blockDoc()).includes(X3.pub), 'the published list still names X3');
  await evalIn(`(() => { localStorage.removeItem('test.dropBlockedRead'); return 1; })()`);
});

test('2. setup: M, X1 and X2 are members; X1 and X2 are Blocked on the Members screen; relay 2 goes down and the console is reopened', { skip: SKIP, timeout: 300000 }, async () => {
  await reload();
  await waitFor(`window.Steward.nameKeyReady() && !!window.Steward.careSeal({ a: 1 })`, 90000, 'church A\'s keys');
  await blockOnScreen(X1, [M, X2]);
  assert.ok(await until(() => { const n = recipsOn(r1, NAMEKEY_D + churchA); return !n.includes(X1.pub) && n.includes(M.pub) && listOf(blockDoc()).includes(X1.pub); }, 40000), 'CONTROL: the Block of X1 did not land');
  await sleep(3000);
  await blockOnScreen(X2, [M, X1]);
  assert.ok(await until(() => { const l = listOf(blockDoc()); return l.includes(X1.pub) && l.includes(X2.pub); }, 40000), 'CONTROL: the Block of X2 did not land');
  assert.ok(await until(() => !recipsOn(r1, NAMEKEY_D + churchA).includes(X2.pub), 30000), 'CONTROL: X2 is still keyed after the Block');
  await sleep(4000);
  assert.ok(blockedOn(r2).some(l => l.includes(X1.pub) && l.includes(X2.pub)), 'CONTROL: relay 2 does not hold both Blocks');
  await evalIn(`(() => { location.href = 'about:blank'; return 1; })()`).catch(() => {});
  await sleep(2000);
  r2.proc.kill('SIGKILL');
  await sleep(2000);
  assert.equal(r2.alive(), false, 'CONTROL: relay 2 is still running');
  await cdpSend('Page.navigate', { url: r1.base + '/steward.html' });
  await sleep(2500);
  await reload();
  assert.ok((await heldHere()).includes(X1.pub) && (await heldHere()).includes(X2.pub), 'CONTROL: this console does not hold both as blocked after the reopen');
  assert.ok((await evalIn('window.Steward.relayList()')).includes(r2.wsUrl), 'CONTROL: relay 2 left the church\'s set');
});

test('3. a newer church list that OMITS X2, with no unblock of X2, leaves X2 blocked on this console — now and after a reopen', { skip: SKIP, timeout: 300000 }, async () => {
  const cur = blockDoc();
  const at = Math.max(Math.floor(Date.now() / 1000), cur.created_at + 1);
  // what a steward who never knew of the Block of X2 writes (or a relay that missed it serves): newer, X2 nowhere in it
  await H.publishAll(r1, [finalizeEvent({ kind: 30078, created_at: at, tags: [['d', BLOCKED_D + churchA], ['t', 'trinityone']], content: JSON.stringify({ pubkeys: [X1.pub] }) }, ASK)]);
  assert.ok(await until(() => { const d = blockDoc(); return d && d.created_at === at && !listOf(d).includes(X2.pub); }, 15000), 'CONTROL: relay 1 does not hold the newer list');
  await evalIn('(() => { window.__env = []; return 1; })()');
  await sleep(12000);
  assert.ok((await heldHere()).includes(X2.pub), 'A NEWER LIST THAT OMITTED X2 LIFTED THE BLOCK on this console — a relay that missed the Block would release them');
  assert.ok((await devCopy()).includes(X2.pub), 'the omission took X2 off the device copy');
  assert.deepEqual(await sentTo(X2.pub), [], 'A KEY WAS SENT TO X2 after a list that merely left them out');
  await reopen();
  await sleep(10000);
  assert.ok((await heldHere()).includes(X2.pub) && (await devCopy()).includes(X2.pub), 'after a reopen, X2 is no longer remembered as blocked');
  assert.ok(await shownBlocked(X2), 'X2 is not shown under "See blocked" after the reopen');
  assert.ok(!recipsOn(r1, NAMEKEY_D + churchA).includes(X2.pub), 'X2 was keyed');
});

test('4. the real Unblock of X1 publishes an event that names them; a console that never saw it (device copy as it was) lifts the block on its next start, relay 2 still down — and X1 is keyed again, X2 is not', { skip: SKIP, timeout: 400000 }, async () => {
  await unblockOnScreen(X1);
  assert.ok(await until(() => { const d = blockDoc(); return d && unblockTags(d).includes(X1.pub); }, 30000), 'the Unblock control published no event naming X1: ' + JSON.stringify(blockDoc() && blockDoc().tags));
  const ev = blockDoc();
  assert.ok(!listOf(ev).includes(X1.pub) && listOf(ev).includes(X2.pub), 'the published list is not "everyone but X1": ' + JSON.stringify(listOf(ev).map(nm)));
  await sleep(16000);                                        // relay 2 is down: the write waits for it, then reports
  // THE STUCK CONSOLE: put its device copy back as it was before it saw the unblock — X1 and X2 remembered, no stamp
  await seedOnQuietPage(`localStorage.setItem('trinityone.steward.blockedlast.' + ${JSON.stringify(churchA)}, ${JSON.stringify(JSON.stringify([X1.pub, X2.pub]))});
    localStorage.removeItem('trinityone.steward.blockedsince.' + ${JSON.stringify(churchA)});`);
  await cdpSend('Page.navigate', { url: r1.base + '/steward.html' });
  await sleep(2500);
  await reload();
  const t0 = Date.now(); let lifted = false;
  while (Date.now() - t0 < 40000 && !lifted) { lifted = !(await heldHere()).includes(X1.pub); if (!lifted) await sleep(700); }
  assert.ok(lifted, 'AN EXPLICIT UNBLOCK DID NOT LIFT THE REMEMBERED BLOCK: after a restart this console still holds X1 as blocked, though the church unblocked them — the frozen-out member');
  assert.ok(!(await devCopy()).includes(X1.pub), 'X1 is still on the device copy — the next start re-seeds the block');
  assert.ok((await heldHere()).includes(X2.pub) && (await devCopy()).includes(X2.pub), 'the lift took X2, whom the church still blocks, off this console');
  assert.ok(await until(() => recipsOn(r1, NAMEKEY_D + churchA).includes(X1.pub), 60000), 'X1 was never given the name key again after the lift');
  assert.ok(!recipsOn(r1, NAMEKEY_D + churchA).includes(X2.pub), 'X2 was keyed');
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});
