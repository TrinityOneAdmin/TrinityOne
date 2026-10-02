// THE KEY ENROLMENT NEVER WRAPS ONE CHURCH'S KEYS TO ANOTHER CHURCH'S PEOPLE — ON A RELOAD, OR BEHIND THE LOCK.
//   Run: node --test scripts/the-key-enrolment-never-uses-another-churchs-lists.test.mjs
//
// The audit of 3bc8905 (2026-10-01) found two leaks still open in the real console, both present at d1116f6:
//   · RELOAD INTO A STEWARDED CHURCH B (8 reloads of 8). The dashboard opened the member list for the console's own
//     church A, the remembered switch to B followed ~2 ms later, and closing A's list before its EOSE made
//     nostr-tools fire its `oneose` — which delivered A's members ~150 ms AFTER the switch. The enrolment took that
//     fresh array for B's and published B's name and care envelopes wrapped to A's congregation.
//   · A BLOCK QUEUED ON THE NAME-KEY LOCK. ensureNameKeyForMembers captured its church only after waiting on the
//     lock, so a Block in A queued behind a slow member-join publish ran against B once the console had switched —
//     rotating B's key with A's member list — or did nothing, and block() (which warned only on false) said nothing.
//
// THE POINT OF USE (CLAUDE.md rule 1): a real gateway on a FREE port, the real console in headless chromium, a
// church made through the real wizard, a stewarded church B whose envelopes are wrapped to this console (so the
// console really does publish for B), B's own member MB and a member MB2 BLOCKED in B, A's members M and M3. Every
// key envelope the console sends for B is captured off the socket — across reloads, by a script installed for
// every new document — and checked from the outside. Derived from the audit harness (scratchpad bq.test.mjs).
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
import * as H from './relay-network-harness.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PIN = 'cedar-harbour-lamp-42';
const NAMEKEY_D = 'trinityone/namekey:', CAREKEY_D = 'trinityone/carekey:', MEMBER_D = 'trinityone/member:', BLOCKED_D = 'trinityone/blocked:';
const B_CARE = 'ab'.repeat(32), B_NAME = 'cd'.repeat(32);
const DELAY = 5000;   // the slow uplink: A's name-key EVENT frame leaves the socket this much later

let relay, chr, ws, prof, evalIn, cdpSend, churchA = '';
const B = H.key();
const M = H.key(), M3 = H.key(), M2 = H.key();     // church A's members; M is blocked in A; M2 joins A during the Block
const MB = H.key(), MB2 = H.key();                  // church B's members; MB2 is BLOCKED in B
const errors = [];
const A_PEOPLE = () => [M.pub, M2.pub, M3.pub];
const nm = (p) => p === B.pub ? 'B' : p === churchA ? 'A' : p === M.pub ? 'M (A, blocked)' : p === M3.pub ? 'M3 (A)' : p === M2.pub ? 'M2 (A)' : p === MB.pub ? 'MB (B)' : p === MB2.pub ? 'MB2 (B, BLOCKED)' : p.slice(0, 8);

function held(where, ...args) {
  const db = new DatabaseSync(join(relay.dataDir, 'relay.sqlite'), { readOnly: true });
  try { return db.prepare('SELECT id, pubkey, dtag, raw FROM events WHERE kind = 30078 AND ' + where).all(...args).map(r => { let e = {}; try { e = JSON.parse(String(r.raw || '')); } catch {} return { id: String(r.id), pubkey: String(r.pubkey), dtag: String(r.dtag), e }; }); }
  finally { db.close(); }
}
const recipsOf = (d) => { const r = held('dtag = ?', d)[0]; return r ? Object.keys(JSON.parse(r.e.content).keys) : null; };
const click = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`;
const typeInto = (sel, val) => `(() => { const i=document.querySelector(${JSON.stringify(sel)}); if(!i) return 'miss';
  const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
const typePh = (ph, val) => `(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(ph)})); if(!i) return 'miss';
  const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
async function waitFor(expr, ms = 60000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await evalIn(expr)) return true; } catch {} await sleep(400); }
  throw new Error('timed out waiting for: ' + label);
}
const press = async (re, label) => { assert.equal(await evalIn(click(re)), 'ok', `nothing on screen matched ${label || re}`); await sleep(500); };
const joinTo = (church, k) => { const ts = Math.floor(Date.now() / 1000); return finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', MEMBER_D + church], ['t', 'trinityone'], ['p', church]], content: JSON.stringify({ joined: ts }) }, k.sk); };
const unlock = async () => {
  await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('Your PIN or passphrase'))`, 90000, 'the unlock screen');
  assert.equal(await evalIn(typePh('Your PIN or passphrase', PIN)), 'ok');
  await press('/^Unlock/');
};
// Installed for EVERY document, so it survives reloads: each key envelope the console sends for B; and, when armed,
// a delay on one outgoing frame (the slow uplink).
const SOCKET_HOOK = (bPub) => `(() => { if (window.__hooked) return; window.__hooked = 1; const Bp = ${JSON.stringify(bPub)};
  window.__bSent = []; window.__delayD = null; window.__delayed = 0;
  const os = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) {
    try { if (typeof d === 'string' && d.startsWith('["EVENT"')) { const e = JSON.parse(d)[1]; const dd = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
      if (/^trinityone\\/(namekey|carekey|mediakey):/.test(dd) && dd.endsWith(Bp)) window.__bSent.push(e);
      if (window.__delayD && dd === window.__delayD) { window.__delayD = null; window.__delayed = performance.now(); const self = this; setTimeout(() => { try { os.call(self, d); } catch (x) {} }, ${DELAY}); return; } } } catch (x) {}
    return os.call(this, d); };
})();`;

before(async () => {
  if (!CHROME) return;
  relay = await H.startRelay({ name: 'enrol-lists', env: { TRINITY_TAILSCALE_BIN: '/nonexistent' } });
  const cdp = await H.freePort('the enrolment-lists test\'s Chrome debug port');
  prof = mkdtempSync(join(tmpdir(), 'trin-enrol-chr-'));
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
  // CHURCH A, the real way
  await waitFor(`[...document.querySelectorAll('button')].some(x => /Start a new church/i.test((x.textContent||'').trim()))`, 90000, 'Start a new church');
  await press('/Start a new church/i');
  await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('At least 8'))`, 60000, 'the PIN box');
  assert.equal(await evalIn(typePh('At least 8', PIN)), 'ok');
  assert.equal(await evalIn(typePh('Type it again', PIN)), 'ok');
  await press('/Set PIN/i');
  await waitFor(`!!document.querySelector('input[aria-label="Church name"]')`, 90000, 'the wizard name step');
  churchA = await evalIn(`window.Steward && window.Steward.churchPub || ''`);
  const npubA = await evalIn(`window.Steward.npub || ''`);
  assert.equal(await evalIn(typeInto('input[aria-label="Church name"]', 'Church A Enrol')), 'ok');
  await sleep(300);
  await press('/^Continue$/');
  { const t0 = Date.now(); let ok = false; while (!ok && Date.now() - t0 < 30000) { try { ok = (JSON.parse(readFileSync(join(relay.dataDir, 'church.json'), 'utf8')).churches || []).some(c => c && c.npub === npubA); } catch {} if (!ok) await sleep(400); } assert.ok(ok, 'the box never registered church A'); }
  await waitFor(`localStorage.getItem('trinityone.steward.boxhosts.' + window.Steward.churchPub) === '1'`, 30000, 'the console to learn the box holds it');
  // CHURCH B rosters A; its care and name keys are wrapped to B, to A (this console), and to B's member MB; MB2 is
  // a member of B whom B has blocked
  const reg = await fetch(relay.base + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + relay.adminToken },
    body: JSON.stringify({ addChurch: { npub: nip19.npubEncode(B.pub), name: 'Church B' } }) });
  assert.equal(reg.status, 200, 'the box would not register church B');
  const ts = Math.floor(Date.now() / 1000) - 5;
  const wrap = (ring, recips) => Object.fromEntries(recips.map(p => [p, nip44.v2.encrypt(JSON.stringify(ring), nip44.v2.utils.getConversationKey(B.sk, p))]));
  await H.publishAll(relay, [
    finalizeEvent({ kind: 0, created_at: ts, tags: [], content: JSON.stringify({ name: 'Church B Enrol' }) }, B.sk),
    finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', 'trinityone/stewards:' + B.pub], ['t', 'trinityone']], content: JSON.stringify({ pubkeys: [churchA] }) }, B.sk),
    finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', CAREKEY_D + B.pub], ['t', 'trinityone']], content: JSON.stringify({ keys: wrap([B_CARE], [B.pub, churchA, MB.pub]), rev: 1 }) }, B.sk),
    finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', NAMEKEY_D + B.pub], ['t', 'trinityone']], content: JSON.stringify({ keys: wrap([B_NAME], [B.pub, churchA, MB.pub]), rev: 1 }) }, B.sk),
  ]);
  await H.publishAll(relay, [joinTo(B.pub, MB), joinTo(B.pub, MB2)]);
  await sleep(1100);
  await H.publishAll(relay, [finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', BLOCKED_D + B.pub], ['t', 'trinityone']], content: JSON.stringify({ pubkeys: [MB2.pub] }) }, B.sk)]);
  await cdpSend('Page.enable');
  await cdpSend('Page.addScriptToEvaluateOnNewDocument', { source: SOCKET_HOOK(B.pub) });
  await evalIn(`(() => { localStorage.setItem('trinityone.steward.wizard.done', '1'); localStorage.removeItem('trinityone.steward.newchurch'); return 'ok'; })()`);
  await evalIn(`(() => { location.reload(); return 'ok'; })()`);
  await sleep(3000);
  await unlock();
  await waitFor(`[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Settings') && !document.querySelector('[data-stew-modal-panel]')`, 90000, 'the dashboard, with no wizard');
  await waitFor(`window.Steward.nameKeyReady() && !!window.Steward.careSeal({ a: 1 })`, 90000, 'church A\'s own name and care keys');
  await waitFor(`(window.Steward.identities() || []).some(x => x.kind === 'steward' && x.pub === ${JSON.stringify(B.pub)})`, 60000, 'church B in the switcher');
  // A's members join, and the console keys them
  await H.publishAll(relay, [joinTo(churchA, M), joinTo(churchA, M3)]);
  { const t0 = Date.now(); let ok = false; while (Date.now() - t0 < 60000 && !ok) { const n = recipsOf(NAMEKEY_D + churchA), c = recipsOf(CAREKEY_D + churchA); ok = !!(n && c && n.includes(M3.pub) && c.includes(M3.pub) && n.includes(M.pub)); if (!ok) await sleep(500); } assert.ok(ok, 'church A\'s members were never keyed — the rows below would prove nothing'); }
  await sleep(3000);
});

after(async () => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  H.stopAll();
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
});

const SKIP = !CHROME ? 'no chromium' : false;
// NO KEY ENVELOPE FOR B — sent by the console, or held by the relay — names one of A's people, or MB2 (blocked in
// B); and none drops B's own member MB.
async function problemsForB(label) {
  const sent = await evalIn('window.__bSent || []');
  const rows = [CAREKEY_D, NAMEKEY_D].map(d => held('dtag = ?', d + B.pub)[0]).filter(Boolean).map(r => r.e);
  const out = [];
  for (const ev of [...sent, ...rows]) {
    const d = ((ev.tags.find(t => t[0] === 'd') || [])[1] || '').slice(11, 19);
    const recips = Object.keys(JSON.parse(ev.content).keys);
    const aPeople = recips.filter(p => A_PEOPLE().includes(p));
    if (aPeople.length) out.push(`${label}: ${d} for church B wrapped to church A's ${aPeople.map(nm).join(', ')}`);
    if (recips.includes(MB2.pub)) out.push(`${label}: ${d} for church B wrapped to MB2, whom church B has BLOCKED`);
    if (!recips.includes(MB.pub)) out.push(`${label}: ${d} for church B drops church B's own member MB`);
  }
  return { out, sent: sent.length };
}

test('a Block in A queued behind a slow name-key publish, then a switch to B: B gets none of A\'s people, and the steward is told the name key was not changed', { skip: SKIP, timeout: 300000 }, async () => {
  await evalIn(`(() => { window.__bSent = []; const S = window.Steward; window.__rot = [];
    const on = S.ensureNameKeyForMembers; S.ensureNameKeyForMembers = async function (...a) { const r = await on.apply(this, a); if (a[2] && a[2].rotate) window.__rot.push(r === false ? 'false' : r === null ? 'null' : 'done'); return r; };
    return 1; })()`);
  await press('/^Members$/', 'the Members section');
  await sleep(1500);
  await evalIn(`(() => { if (document.querySelector('button[title="Remove / block this member"]')) return 'direct'; const b = [...document.querySelectorAll('button')].find(x => /^More for /.test(x.getAttribute('aria-label') || '')); if (b) b.click(); return 'more'; })()`);
  await sleep(600);
  const opened = await evalIn(`(() => { const npub = ${JSON.stringify(nip19.npubEncode(M.pub))}; const btns = [...document.querySelectorAll('button[title="Remove / block this member"], button[title="Decline — blocks this person from joining or posting"]')];
    const mine = btns.find(b => { let n = b; for (let i = 0; i < 8 && n; i++) { n = n.parentElement; if (n && (n.textContent || '').includes(npub.slice(0, 12))) return true; } return false; }) || null;
    if (!mine) return 'miss:' + btns.length; mine.click(); return 'ok'; })()`);
  assert.equal(opened, 'ok', 'no Block button for member M on the Members screen');
  await sleep(500);
  // a member joins A; A's name-key publish (a grow, holding the name-key lock) goes out slowly
  await evalIn(`(() => { window.__delayD = ${JSON.stringify(NAMEKEY_D + churchA)}; return 1; })()`);
  await H.publishAll(relay, [joinTo(churchA, M2)]);
  await waitFor(`window.__delayed > 0`, 30000, 'A\'s name-key publish, delayed on the socket');
  // the steward confirms the Block — its name-key rotation queues behind the lock — and the console switches to B
  assert.equal(await evalIn(`(() => { const b = document.querySelector('button[title="Confirm — bans them from posting & hides their messages"]') || document.querySelector('button[title="Confirm — blocks them from joining or posting, and re-keys the church"]'); if (!b) return 'miss'; b.click(); return 'ok'; })()`), 'ok', 'no Block confirmation');
  await sleep(50);
  assert.equal(await evalIn(`window.Steward.setActiveIdentity(${JSON.stringify(B.pub)})`), true, 'CONTROL: switched to B');
  await sleep(DELAY + 12000);
  const { out, sent } = await problemsForB('queued Block');
  const rot = await evalIn('window.__rot || []');
  assert.ok(rot.length, 'CONTROL: the Block did not run the name-key rotation');
  const aName = recipsOf(NAMEKEY_D + churchA);
  if (aName.includes(M.pub)) {
    // the rotation did not happen for A — then block() must have been told, and must say so
    if (!rot.some(r => r === 'false' || r === 'null')) out.push(`church A's name key still wraps to the blocked member, and the rotation told block() "${rot.join(',')}"`);
  }
  assert.deepEqual(out, [], `${out.length} problem(s); the console sent ${sent} key envelope(s) for church B; rotation results ${JSON.stringify(rot)}`);
});

test('reloading into church B never publishes B\'s keys to church A\'s members (three reloads)', { skip: SKIP, timeout: 600000 }, async () => {
  const all = [];
  let sentTotal = 0;
  for (let i = 0; i < 3; i++) {
    if ((await evalIn('window.Steward.actingChurch')) !== B.pub) assert.equal(await evalIn(`window.Steward.setActiveIdentity(${JSON.stringify(B.pub)})`), true, 'CONTROL: switched to B');
    await sleep(8000);
    // B's cached lists go, as on a console that has not been here for a while — A's member list is what is on hand
    await evalIn(`(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('trinityone.steward.') && k.endsWith(${JSON.stringify(B.pub)}) && !/boxhosts/.test(k)) localStorage.removeItem(k); return 1; })()`);
    await evalIn(`(() => { location.reload(); return 'ok'; })()`);
    await sleep(2500);
    await unlock();
    await sleep(20000);
    assert.equal(await evalIn('window.Steward.actingChurch'), B.pub, 'CONTROL: the reload did not restore the console into church B');
    const { out, sent } = await problemsForB('reload ' + (i + 1));
    all.push(...out); sentTotal += sent;
    assert.equal(await evalIn(`window.Steward.setActiveIdentity(${JSON.stringify(churchA)})`), true, 'CONTROL: switched back to A');
    await sleep(8000);
  }
  assert.deepEqual(all, [], `${all.length} problem(s) across three reloads; the console sent ${sentTotal} key envelope(s) for church B`);
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});
