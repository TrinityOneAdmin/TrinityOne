// A CONSOLE BACK FROM THE BACKGROUND — OR LAUNCHED WITH NO NETWORK — LOGS BACK IN AT ONCE, AND HEARS AGAIN.
//   Run: node --test scripts/a-console-back-from-the-background-can-approve-at-once.test.mjs
//
// Device round 2026-10-01 (Oppo, build 24bdefd). With the console in the background a few minutes, for 20–70 s
// after it came back an Approve on a join request said "Couldn't save the approved-members list … This console
// hasn't finished connecting to your church", relayAuthed() stayed false for ~70 s, and a retry after that
// worked. The WebView closes the page's sockets when it is backgrounded ("Page entered Back-Forward Cache" in
// the log), and the console learns of that when it resumes — after the visibilitychange its reconnect ticker
// listens for, or with none at all. Nothing else looked until the ticker's 90-second beat came round.
//
// Measured with one probe at three commits (scratchpad kd-resume): with a visibilitychange after the close the
// console is back in ~260 ms at 9c7d621 (before this branch), 3bc8905 and 21cd818 alike; with none, 67 s and 72 s
// at 9c7d621 after a 15-second background — the Oppo's ~70 s — and 49 s at 21cd818: whatever was left of the
// beat. Not a regression from 267fa08 (its key-read retry made one of the slow cases faster: 30 s → 2.6 s). The
// console never reacted to its own sockets closing.
//
// And the member app's 252b055, checked here for the console (the coordinator's item 2): after a launch with no
// network, the first socket back may be opened by a PUBLISH (or a one-shot read). The console then reported
// itself healthy on a socket nothing of its was listening on, never re-subscribed, and the relay — which
// challenges only a gated REQ — never asked it to log in: deaf to new members for the session.
//
// THE POINT OF USE (CLAUDE.md rule 1): a real gateway on a free port, the real console in headless chromium, a
// church made through the real wizard, join approval on, and a real Approve press on the Members screen. The
// "background" is the WebView's: every socket closed and the page FROZEN (Page.setWebLifecycleState), then
// thawed. The page's visibility is under the test's control, and the resume is timed just after the console's
// 90-second beat has fired, so the beat cannot be what rescues it. The "radio" is a switch in front of the
// page's WebSocket constructor: while it is off every dial goes to a port nothing listens on.
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
const MEMBER_D = 'trinityone/member:', NAMEKEY_D = 'trinityone/namekey:', CAREKEY_D = 'trinityone/carekey:', ADMITTED_D = 'trinityone/admitted:';
const PROMPT_MS = 10000;   // "at once": well inside the 90-second beat, with room for a slow test box

let relay, chr, ws, prof, evalIn, cdpSend, churchA = '';
const B = H.key(), M = H.key(), M3 = H.key();
const errors = [];

function held(where, ...args) {
  const db = new DatabaseSync(join(relay.dataDir, 'relay.sqlite'), { readOnly: true });
  try { return db.prepare('SELECT raw FROM events WHERE kind = 30078 AND ' + where).all(...args).map(r => { try { return JSON.parse(String(r.raw || '')); } catch { return {}; } }); }
  finally { db.close(); }
}
const recipsOf = (d) => { const r = held('dtag = ?', d)[0]; return r && r.content ? Object.keys(JSON.parse(r.content).keys || {}) : null; };
const admitted = () => { const r = held('dtag = ?', ADMITTED_D + churchA).sort((a, b) => b.created_at - a.created_at)[0]; try { return (JSON.parse(r.content).pubkeys) || []; } catch { return []; } };
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
async function within(expr, ms) {   // how long until `expr` holds, or null
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await evalIn(expr)) return Date.now() - t0; } catch {} await sleep(200); }
  return null;
}
const press = async (re, label) => { assert.equal(await evalIn(click(re)), 'ok', `nothing on screen matched ${label || re}`); await sleep(500); };
const joinTo = (church, k) => { const ts = Math.floor(Date.now() / 1000); return finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', MEMBER_D + church], ['t', 'trinityone'], ['p', church]], content: JSON.stringify({ joined: ts }) }, k.sk); };
const unlock = async () => {
  await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('Your PIN or passphrase'))`, 90000, 'the unlock screen');
  assert.equal(await evalIn(typePh('Your PIN or passphrase', PIN)), 'ok');
  await press('/^Unlock/');
};
// Installed for EVERY document. Visibility under the test's control; every socket the page opens, so the test can
// close them as the WebView does; the radio; and the console's 90-second beat, so a resume can be timed after it.
const HOOK = (relayUrl) => `(() => { if (window.__hooked) return; window.__hooked = 1; window.__vis = 'visible';
  try { Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get() { return window.__vis; } });
        Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get() { return window.__vis !== 'visible'; } }); } catch (e) {}
  window.__radioOff = (() => { try { return sessionStorage.getItem('__radioOffAtBoot') === '1'; } catch (e) { return false; } })();
  const W = window.WebSocket; window.__socks = []; window.__dials = 0; window.__deadDials = 0;
  const Wd = function (u, p) { let url = String(u);
    if (url === ${JSON.stringify(relayUrl)}) { window.__dials++; if (window.__radioOff) { window.__deadDials++; url = 'ws://127.0.0.1:9/relay'; } }
    const s = p === undefined ? new W(url) : new W(url, p); window.__socks.push(s); return s; };
  Wd.prototype = W.prototype; for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Wd[k] = W[k]; window.WebSocket = Wd;
  const si = window.setInterval; window.__beats = [];
  window.setInterval = function (fn, ms, ...a) { const id = si.call(this, fn, ms, ...a); if (ms === 90000) window.__beats.push({ at: performance.now(), stack: String(new Error().stack || '') }); return id; };
})();`;
const closeAll = () => evalIn(`(() => { let n = 0; for (const s of window.__socks) if (s.readyState <= 1) { try { s.close(); n++; } catch (e) {} } return n; })()`);
const lifecycle = async (state) => { const r = await cdpSend('Page.setWebLifecycleState', { state }); assert.ok(!r.error, 'could not set the page ' + state + ': ' + JSON.stringify(r.error)); };
// wait until the console's own reconnect beat has just fired, so the next one is ~80 s away
async function justAfterTheBeat() {
  const at = await evalIn(`(window.__beats.find(b => /_wireStewardConn/.test(b.stack)) || {}).at`);
  assert.ok(typeof at === 'number', 'the console\'s 90-second reconnect beat was not found — re-anchor this test (it times the resume against it)');
  for (;;) { const ph = await evalIn(`(performance.now() - ${at}) % 90000`); if (ph > 1500 && ph < 4000) return ph; await sleep(ph < 1500 ? 300 : Math.min(5000, 90000 - ph + 1600)); }
}
async function openMembers() { await press('/^Members$/', 'the Members section'); await sleep(1000); }

before(async () => {
  if (!CHROME) return;
  relay = await H.startRelay({ name: 'back-from-bg', env: { TRINITY_TAILSCALE_BIN: '/nonexistent' } });
  const cdp = await H.freePort('the back-from-the-background test\'s Chrome debug port');
  prof = mkdtempSync(join(tmpdir(), 'trin-bgres-chr-'));
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
  cdpSend = send;
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK(relay.base.replace(/^http/, 'ws') + '/relay') });
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
  assert.equal(await evalIn(typeInto('input[aria-label="Church name"]', 'Church Back From The Background')), 'ok');
  await sleep(300);
  await press('/^Continue$/');
  { const t0 = Date.now(); let ok = false; while (!ok && Date.now() - t0 < 30000) { try { ok = (JSON.parse(readFileSync(join(relay.dataDir, 'church.json'), 'utf8')).churches || []).some(c => c && c.npub === npubA); } catch {} if (!ok) await sleep(400); } assert.ok(ok, 'the box never registered the church'); }
  await waitFor(`localStorage.getItem('trinityone.steward.boxhosts.' + window.Steward.churchPub) === '1'`, 30000, 'the console to learn the box holds it');
  // Something the relay withholds from a socket that has not logged in, so its lazy NIP-42 challenge fires at all
  // (an empty church never challenges — a known limit, _requireTrustedView): a church B whose envelopes are
  // wrapped to this console.
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
  await evalIn(`(() => { localStorage.setItem('trinityone.steward.wizard.done', '1'); localStorage.removeItem('trinityone.steward.newchurch'); location.reload(); return 'ok'; })()`);
  await sleep(3000);
  await unlock();
  await waitFor(`[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Settings') && !document.querySelector('[data-stew-modal-panel]')`, 90000, 'the dashboard, with no wizard');
  await waitFor(`window.Steward.nameKeyReady() && !!window.Steward.careSeal({ a: 1 })`, 90000, 'the church\'s own keys');
  await H.publishAll(relay, [joinTo(churchA, M), joinTo(churchA, M3)]);
  { const t0 = Date.now(); let ok = false; while (Date.now() - t0 < 60000 && !ok) { const n = recipsOf(NAMEKEY_D + churchA); ok = !!(n && n.includes(M3.pub)); if (!ok) await sleep(500); } assert.ok(ok, 'the church\'s members were never keyed'); }
  // join approval on, everyone already here grandfathered — as the Settings switch does it
  await waitFor(`window.Steward.relayAuthed()`, 60000, 'the console logged in');
  assert.ok(await evalIn(`Promise.resolve(window.Steward.setAdmitted([${JSON.stringify(M.pub)}, ${JSON.stringify(M3.pub)}])).then(r => !!r)`), 'CONTROL: could not grandfather the members');
  assert.ok(await evalIn(`Promise.resolve(window.Steward.setJoinPolicy(true)).then(r => !!r)`), 'CONTROL: could not turn join approval on');
  await openMembers();
  await sleep(3000);
});

after(async () => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  H.stopAll();
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
});

const SKIP = !CHROME ? 'no chromium' : false;

// After the console is back: it is logged in again PROMPTLY, it HEARS a new request to join, and an Approve press
// lets that person in on the relay.
async function backAndApproving(label, t0, bound = PROMPT_MS) {
  const authedIn = (await within(`window.Steward.relayAuthed()`, 60000)) === null ? null : Date.now() - t0;
  const k = H.key();
  await H.publishAll(relay, [joinTo(churchA, k)]);
  const heardIn = await within(`[...document.querySelectorAll('button')].filter(x => (x.textContent||'').trim() === 'Approve').length === 1`, 30000);
  const out = [];
  if (authedIn === null || authedIn > bound) out.push(`${label}: logged back in ${authedIn === null ? 'NOT AT ALL within 60 s' : 'only after ' + authedIn + ' ms'} — an Approve in that time is refused`);
  if (heardIn === null) out.push(`${label}: a member who asked to join after the console came back NEVER APPEARED on the Members screen — it is deaf`);
  else {
    await press('/^Approve$/', 'the Approve button');
    const t1 = Date.now(); let ok = false;
    while (!ok && Date.now() - t1 < 15000) { ok = admitted().includes(k.pub); if (!ok) await sleep(400); }
    if (!ok) out.push(`${label}: Approve was pressed and the relay's approved-members list never named them`);
  }
  return out;
}

test('back from the background with NO visibilitychange (the WebView that does not say): logged in again at once, hearing, and Approve lands', { skip: SKIP, timeout: 300000 }, async () => {
  await waitFor(`window.Steward.relayAuthed() && window.Steward.relaysHealthy()`, 120000, 'logged in and healthy before the background');
  await justAfterTheBeat();
  await evalIn(`(() => { window.__vis = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); return 1; })()`);
  const n = await closeAll();
  assert.ok(n >= 1, 'CONTROL: the console had no open socket to lose');
  await lifecycle('frozen');
  await sleep(8000);
  await lifecycle('active');
  await evalIn(`(() => { window.__vis = 'visible'; return 1; })()`);   // visible again — and nothing said so
  const t0 = Date.now();
  assert.notEqual(await within(`!window.Steward.relayAuthed()`, 3000), null, 'CONTROL: closing the sockets did not log the console out — this row proves nothing');
  const out = await backAndApproving('no visibilitychange', t0);
  assert.deepEqual(out, []);
});

// A LINK THAT DROPS AGAIN RIGHT AFTER THE CONSOLE CAME BACK — the WebView's sockets closing a second time (the
// device log has "Page entered Back-Forward Cache" twice in six minutes), a flaky Wi-Fi handover. The look the
// console took on coming back started the ticker's 20-second floor, and every signal inside it — this drop
// included — was thrown away: the next look was the 90-second beat. Now the drop is said, and a look the floor
// turns away is deferred to the end of the floor rather than dropped.
test('a link that drops again right after the console came back is looked at again within the floor, not left for the beat', { skip: SKIP, timeout: 300000 }, async () => {
  await waitFor(`window.Steward.relayAuthed() && window.Steward.relaysHealthy()`, 120000, 'logged in and healthy before the background');
  await justAfterTheBeat();
  await evalIn(`(() => { window.__vis = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); return 1; })()`);
  assert.ok(await closeAll() >= 1, 'CONTROL: the console had no open socket to lose');
  await lifecycle('frozen');
  await sleep(3000);
  await lifecycle('active');
  await evalIn(`(() => { window.__vis = 'visible'; document.dispatchEvent(new Event('visibilitychange')); return 1; })()`);
  // the visibilitychange path brings it back (it always did) …
  assert.notEqual(await within(`window.Steward.relayAuthed() && window.Steward.relaysHealthy()`, 15000), null, 'CONTROL: the console did not come back on a visibilitychange at all');
  await sleep(1500);                              // its login answered, so the drop below cannot land mid-login
  // … and then the link drops again
  assert.ok(await closeAll() >= 1, 'CONTROL: the console had no socket to lose the second time');
  const t0 = Date.now();
  assert.notEqual(await within(`!window.Steward.relayAuthed()`, 3000), null, 'CONTROL: the second drop did not log the console out — this row proves nothing');
  const out = await backAndApproving('dropped again inside the floor', t0, 25000);
  assert.deepEqual(out, []);
});

test('launched with NO network, then the first socket back is opened by a publish: the console re-subscribes, logs in and hears (the member app\'s 252b055, in the console)', { skip: SKIP, timeout: 300000 }, async () => {
  await evalIn(`(() => { sessionStorage.setItem('__radioOffAtBoot', '1'); location.reload(); return 1; })()`);
  await sleep(2500);
  await unlock();
  await waitFor(`[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Settings')`, 90000, 'the dashboard');
  await waitFor(`window.__deadDials >= 1`, 30000, 'the console to try its relay with the radio off');
  await sleep(3000);
  assert.equal(await evalIn('window.Steward.relayAuthed()'), false, 'CONTROL: logged in with the radio off — this row proves nothing');
  await openMembers();
  await justAfterTheBeat();   // (this document's beat — so the beat is not what rescues it either)
  // the radio comes back, and the first thing to open a socket is a publish (the join policy, unchanged)
  const dialsBefore = await evalIn(`(() => { sessionStorage.removeItem('__radioOffAtBoot'); window.__radioOff = false; return window.__dials; })()`);
  await evalIn(`(() => { window.Steward.setJoinPolicy(true); return 1; })()`);
  const t0 = Date.now();
  await sleep(300);
  assert.ok((await evalIn('window.__dials')) > dialsBefore, 'CONTROL: the publish did not dial the relay — this row proves nothing');
  const out = await backAndApproving('offline launch', t0);
  assert.deepEqual(out, []);
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

// THE DEVICE'S OWN SEQUENCE, END TO END (device round 2026-10-01): Approve pressed while the console cannot reach its
// relay is refused — on the row and on the banner, with nothing thrown out of the click — and once it is back, the
// retry lets the person in and the banner that named the approved-members list goes.
test('an Approve refused while the console is out says so and throws nothing; the retry lands and the banner goes', { skip: SKIP, timeout: 300000 }, async () => {
  await waitFor(`window.Steward.relayAuthed() && window.Steward.relaysHealthy()`, 120000, 'logged in and healthy first');
  const k = H.key();
  await H.publishAll(relay, [joinTo(churchA, k)]);
  await waitFor(`[...document.querySelectorAll('button')].filter(x => (x.textContent||'').trim() === 'Approve').length === 1`, 30000, 'the join request on the Members screen');
  const before = errors.length;
  // the radio goes: every socket dies and nothing new gets through
  await evalIn(`(() => { window.__radioOff = true; return 1; })()`);
  await closeAll();
  await waitFor(`!window.Steward.relayAuthed()`, 10000, 'the console to notice it is out');
  await press('/^Approve$/', 'the Approve button');
  await sleep(1500);
  const said = await evalIn(`document.body.innerText.replace(/\\s+/g, ' ')`);
  assert.deepEqual(errors.slice(before), [], 'APPROVE THREW OUT OF THE CLICK (device round 2026-10-01: Uncaught Error … at admitMember)');
  assert.match(said, /Couldn’t save the approved-members list/, 'the refusal is not on the banner');
  assert.match(said, /Couldn’t let [^—]* in — this console hasn’t finished connecting to your church/, 'the row said nothing about the refused Approve');
  assert.ok(!admitted().includes(k.pub), 'CONTROL: the refused Approve was written anyway — this row proves nothing');
  // the radio comes back; the console logs back in by itself, and the retry lets them in
  await evalIn(`(() => { window.__radioOff = false; return 1; })()`);
  assert.notEqual(await within(`window.Steward.relayAuthed()`, 60000), null, 'the console never logged back in once the radio was back');
  await press('/^Approve$/', 'the Approve button, again');
  { const t1 = Date.now(); let ok = false; while (!ok && Date.now() - t1 < 15000) { ok = admitted().includes(k.pub); if (!ok) await sleep(400); } assert.ok(ok, 'the retried Approve never reached the relay'); }
  await sleep(1500);
  assert.doesNotMatch(await evalIn(`document.body.innerText.replace(/\\s+/g, ' ')`), /Couldn’t save the approved-members list/,
    'THE BANNER STAYED after the retry let the person in (on the Oppo it sat there, collapsed: "Couldn\'t save the appr…")');
});
