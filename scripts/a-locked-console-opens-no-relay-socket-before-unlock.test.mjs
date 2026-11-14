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
// Three tests:
//   1. While the PIN screen is up the console opens NO socket to the relay at all; after unlock a member who joins
//      is given the church name key (the envelope names them).
//   2. Locking closes the stewarded-churches subscription (no REQ carrying our stewardrevoke filter stays open), and
//      unlocking reopens it.
//   3. Replacing the key (a restore of another church) reopens it for the NEW key, never the old one — and the console
//      then ACTS as the new church: it does not keep the old key's helper identity (restore-identity fix 2026-11-14).
//   4. The same, driven through the real Settings screen (Church key -> Restore from a recovery phrase).
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

let relay, chr, ws, prof, evalIn, churchA = '', wordsA = '', relayUrl = '';
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
  wordsA = await evalIn(`window.Steward.exportMnemonic() || ''`);   // so a later test can put this console back as church A
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
  // The identity is read in the SAME synchronous turn as the restore: the stewarded-churches discovery later re-reads
  // B's roster, finds C is not on it and evicts B on its own, so a later read sees a healed Map. The window before
  // that is the one every render and every write in between lives in (and, on a slow or unreachable relay, it is
  // not a window at all).
  const rr = JSON.parse(await evalIn(`(() => { window.Steward.restoreKey(${JSON.stringify(words)});
    return JSON.stringify({ own: window.Steward.churchPub, ids: window.Steward.identities().map(i => ({ k: i.kind, p: i.pub })),
      acting: window.Steward.actingChurch, active: window.Steward.activePub }); })()`));
  const churchC = String(rr.own || '');
  assert.ok(churchC && churchC !== churchA, 'CONTROL: the restore did not change the key');
  await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('At least 8'))`, 60000, 'the forced-PIN screen after the restore');
  assert.equal(await evalIn(typePh('At least 8', PIN)), 'ok');
  assert.equal(await evalIn(typePh('Type it again', PIN)), 'ok');
  await press('/Set PIN/i');
  await waitFor(`!window.Steward.needsPin`, 60000, 'the PIN to be set for the restored key');
  await waitFor(`[...window.__revokeSubs.values()].includes(${JSON.stringify(REVOKE_D + churchC)})`, 60000, 'the discovery to reopen for the NEW key');
  await sleep(6000);   // long enough for the old key's roster read to come back and (on the OLD code) evict B with a removal notice
  const open = await openRevokes();
  assert.ok(!open.includes(REVOKE_D + churchA), 'a stewarded-churches subscription for the OLD key is still open after the key was replaced: ' + JSON.stringify(open));
  // THE IDENTITY, not just the subscription (restore-identity fix 2026-11-14). Church A is rostered as a steward of B,
  // so before the restore this console's stewarded-churches Map holds B. Straight after restoring C it must act as C,
  // list C's own row, and not list B at all — and it must still be so once the discovery has settled.
  const settled = JSON.parse(await evalIn(`JSON.stringify({ ids: window.Steward.identities().map(i => ({ k: i.kind, p: i.pub })),
    acting: window.Steward.actingChurch, active: window.Steward.activePub, own: window.Steward.churchPub,
    removed: window.Steward.removedNotices(), text: document.body.innerText })`));
  // The first assertion on the OLD code is the meaningful one: church B listed (and C's own row hidden) straight after the restore.
  for (const [when, o] of [['straight after the restore', rr], ['after the discovery settled', settled]]) {
    assert.equal(o.own, churchC, `CONTROL (${when}): the console's own church is not the restored one`);
    assert.ok(!o.ids.some(i => i.p === B.pub), `${when}: the old key's church B is still listed`);
    assert.ok(o.ids.some(i => i.k === 'church' && i.p === churchC), `${when}: the restored church's own row is missing from the switcher`);
    assert.equal(o.active, churchC, `${when}: the active church is not the restored one`);
    assert.equal(o.acting || '', '', `${when}: the console still acts for the OLD key's church`);
  }
  // THE SYMPTOM A PERSON SAW on the old code: the old key's socket is still logged in, so B's roster (which does not name C)
  // comes back, B is evicted as a REMOVAL, and a full-screen "You've been removed from Church B" appears over the console.
  assert.deepEqual(settled.removed, [], 'a removal notice was written for church B after a restore — the console told the person they had been removed: ' + JSON.stringify(settled.removed));
  assert.ok(!/been removed|removed you as a helper/i.test(settled.text), 'a "removed from a church" screen is showing after a restore');
});

// POINT OF USE (restore-identity fix 2026-11-14): the REAL Settings screen, not restoreKey() called from the page.
// Deleting the restoreKey call from doRestore leaves the key unchanged (the CONTROL below fails). Deleting the engine's
// _forgetStewardedScope() from restoreKey leaves church B in the Map; the old key's socket then brings B's roster back,
// B is evicted as a removal, and a full-screen "You've been removed from Church B" covers the dashboard — so on the old
// code this test fails at the removal-screen assertion (and, were that skipped, would time out waiting for the dashboard).
test('Settings -> Church key -> Restore from a recovery phrase: a console that helps run church B becomes the restored church, not B', { skip: SKIP, timeout: 300000 }, async () => {
  // Setup: put this console back as church A (rostered as a steward of B) through the engine, and wait until it knows B.
  assert.ok(wordsA, 'CONTROL: the words of church A were not captured');
  const back = await evalIn(`(() => { window.Steward.restoreKey(${JSON.stringify(wordsA)}); return window.Steward.churchPub; })()`);
  assert.equal(back, churchA, 'CONTROL: could not put the console back as church A');
  await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('At least 8'))`, 60000, 'the forced-PIN screen after putting church A back');
  assert.equal(await evalIn(typePh('At least 8', PIN)), 'ok');
  assert.equal(await evalIn(typePh('Type it again', PIN)), 'ok');
  await press('/Set PIN/i');
  await waitFor(`!window.Steward.needsPin`, 60000, 'the PIN for church A');
  await waitFor(dashboard, 90000, 'the dashboard as church A');
  await waitFor(`window.Steward.identities().some(i => i.kind === 'steward' && i.pub === ${JSON.stringify(B.pub)})`, 90000, 'CONTROL: the console to know it helps run church B');
  // Drive the real screen. confirm() is the "this replaces the church on this device" prompt — accept it.
  const wordsD = generateSeedWords();
  await evalIn(`(window.confirm = () => true, 'ok')`);
  await press('/^Settings$/', 'the Settings button');
  // the Master key group is collapsed on a fresh console: open it, then the page
  await waitFor(`[...document.querySelectorAll('button')].some(x => /Master key/.test((x.textContent||'')))`, 30000, 'the Master key group');
  await press('/Master key/', 'Master key');
  await waitFor(`[...document.querySelectorAll('button')].some(x => /Church key/.test((x.textContent||'')))`, 30000, 'the Church key section');
  await press('/Church key/', 'Church key');
  await waitFor(`[...document.querySelectorAll('button')].some(x => /Restore from a recovery phrase/.test((x.textContent||'')))`, 30000, 'the Restore from a recovery phrase button');
  await press('/Restore from a recovery phrase/', 'Restore from a recovery phrase');
  await waitFor(`!!document.querySelector('textarea[placeholder^="word one"]')`, 30000, 'the phrase box');
  assert.equal(await evalIn(`(() => { const t=document.querySelector('textarea[placeholder^="word one"]'); const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; set.call(t, ${JSON.stringify(wordsD)}); t.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`), 'ok');
  await sleep(300);
  await press('/Restore church/', 'Restore church');
  await waitFor(`window.Steward.churchPub !== ${JSON.stringify(churchA)}`, 30000, 'CONTROL: pressing Restore church changed the console\'s key (the screen calls restoreKey)');
  const churchD = await evalIn(`window.Steward.churchPub`);
  await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('At least 8'))`, 60000, 'the forced-PIN screen after the restore');
  assert.equal(await evalIn(typePh('At least 8', PIN)), 'ok');
  assert.equal(await evalIn(typePh('Type it again', PIN)), 'ok');
  await press('/Set PIN/i');
  await waitFor(`!window.Steward.needsPin`, 60000, 'the PIN for the restored church');
  await sleep(6000);
  const o = JSON.parse(await evalIn(`JSON.stringify({ ids: window.Steward.identities().map(i => ({ k: i.kind, p: i.pub })),
    acting: window.Steward.actingChurch, active: window.Steward.activePub, own: window.Steward.churchPub, text: document.body.innerText,
    removed: window.Steward.removedNotices() })`));
  assert.ok(!/been removed|removed you as a helper/i.test(o.text), 'a "removed from a church" screen is showing after the restore — on the old code this is what covers the dashboard');
  assert.deepEqual(o.removed, [], 'a removal notice was written for church B after the restore: ' + JSON.stringify(o.removed));
  await waitFor(dashboard, 90000, 'the dashboard as the restored church');
  assert.equal(o.own, churchD, 'the console\'s own church is not the restored one');
  assert.equal(o.acting, '', 'the console still acts for church B after restoring another church');
  assert.equal(o.active, churchD, 'the active church is not the restored one');
  assert.ok(o.ids.some(i => i.k === 'church' && i.p === churchD), 'the restored church has no row in the switcher');
  assert.ok(!o.ids.some(i => i.p === B.pub), 'church B is still listed after restoring another church');
  assert.ok(!/Church B/.test(o.text), 'the words "Church B" are still on screen after restoring another church');
});

// L2 (audit of 02eb001a) — POINT OF USE for the other half of the rule: a helper acting in church B who does a REAL lock and
// a REAL unlock (the PIN screen) is still acting in B. The clear must never move into setKey. Read at the moment unlock
// finishes (the `steward-key` event _enterUnlocked fires), because the discovery later re-lands the console in B from the
// remembered church and would hide a clear in setKey if read late.
test('a helper acting in church B who locks and unlocks through the PIN screen is still acting in church B', { skip: SKIP, timeout: 300000 }, async () => {
  assert.ok(wordsA, 'CONTROL: the words of church A were not captured');
  assert.equal(await evalIn(`(() => { window.Steward.restoreKey(${JSON.stringify(wordsA)}); return window.Steward.churchPub; })()`), churchA, 'CONTROL: could not put the console back as church A');
  await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('At least 8'))`, 60000, 'the forced-PIN screen');
  assert.equal(await evalIn(typePh('At least 8', PIN)), 'ok');
  assert.equal(await evalIn(typePh('Type it again', PIN)), 'ok');
  await press('/Set PIN/i');
  await waitFor(`!window.Steward.needsPin`, 60000, 'the PIN for church A');
  await waitFor(dashboard, 90000, 'the dashboard as church A');
  await waitFor(`window.Steward.identities().some(i => i.kind === 'steward' && i.pub === ${JSON.stringify(B.pub)})`, 90000, 'CONTROL: the console to know it helps run church B');
  assert.equal(await evalIn(`window.Steward.setActiveIdentity(${JSON.stringify(B.pub)})`), true, 'CONTROL: could not switch to church B');
  assert.equal(await evalIn(`window.Steward.actingChurch`), B.pub, 'CONTROL: the console is not acting in church B before the lock');
  await evalIn(`(window.__atUnlock = null, window.addEventListener('steward-key', () => { if (window.Steward.hasKey && !window.Steward.locked) window.__atUnlock = { acting: window.Steward.actingChurch, active: window.Steward.activePub, stewarded: window.Steward.identities().some(i => i.kind === 'steward') }; }), 'ok')`);
  await evalIn(`(window.Steward.lock(), 'ok')`);
  await waitFor(pinScreen, 30000, 'the PIN screen after locking');
  assert.equal(await evalIn(typePh('Your PIN or passphrase', PIN)), 'ok');
  await press('/^Unlock/');
  await waitFor(`!!window.__atUnlock`, 60000, 'the unlock to finish');
  const at = await evalIn(`window.__atUnlock`);
  assert.equal(at.acting, B.pub, 'the helper was dropped out of church B at the moment of unlocking: ' + JSON.stringify(at));
  await waitFor(dashboard, 90000, 'the dashboard after unlocking');
  assert.equal(await evalIn(`window.Steward.actingChurch`), B.pub, 'the helper is not acting in church B after the unlock');
});
