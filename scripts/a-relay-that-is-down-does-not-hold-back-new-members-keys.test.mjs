// A RELAY THAT IS DOWN DOES NOT HOLD BACK A NEW MEMBER'S KEYS — AND THE BLOCKED STAY UNKEYED WHILE IT IS.
//   Run: node --test scripts/a-relay-that-is-down-does-not-hold-back-new-members-keys.test.mjs
//
// The audit of 831dcea (caused by b1dffb3). A church on two proved relays; the second goes down — a self-hosted box
// switched off stays admitted for up to 30 days, and the built-in relays cannot be removed. The console is reloaded
// while it is down, and a new member joins: no name, care or room key reached them in 90–180 s. At 6092c0b (before
// b1dffb3) all three arrived within 2 s. The key enrolment waits for the church's blocklist to be "current", and
// b1dffb3 made that wait for a genuine answer from EVERY relay in the set — which a relay that is down never gives.
//
// THE RULE NOW: the blocklist is current once every relay that is CONNECTED has given a genuine answer and at least
// one has; a relay whose connection has failed is left out, and when one is, this church's last genuine blocklist on
// the device is the floor (whatever the relays answered, everyone on the device copy stays blocked).
//
// THE POINT OF USE (CLAUDE.md rule 1): two real gateways on FREE ports, the real console in headless chromium, church
// A by the wizard, the second relay added and proved through the console's own addRelay, a real Block pressed on the
// Members screen, then the second relay killed and the console reloaded. Every key envelope the console sends is
// captured off its socket, and what the live relay holds is read from its database.
// TEST-ENV ONLY: Page.setBypassCSP — the console's CSP allows https:/wss:/ws: but not a second plain-http loopback
// origin, which is where the relay-identity proof is fetched from here; production relays are https.
// Derived from the audit's deadrelay.test.mjs. Skips itself without chromium.
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
const WAIT = 45000;   // the regression: nothing in 90–180 s; the fixed console keys a joiner in ~2 s

let r1, r2, chr, ws, prof, evalIn, cdpSend, churchA = '', ASK = null, roomId = '';
const B = H.key(), M = H.key(), MX = H.key(), M2 = H.key(), M3 = H.key();
const errors = [];
const nm = (p) => p === churchA ? 'A' : p === M.pub ? 'M' : p === MX.pub ? 'MX' : p === M2.pub ? 'M2' : p === M3.pub ? 'M3' : String(p).slice(0, 6);
function held(relay, where, ...args) {
  const db = new DatabaseSync(join(relay.dataDir, 'relay.sqlite'), { readOnly: true });
  try { return db.prepare('SELECT raw FROM events WHERE kind = 30078 AND ' + where).all(...args).map(r => { try { return JSON.parse(String(r.raw || '')); } catch { return {}; } }); }
  finally { db.close(); }
}
const recipsOn = (relay, d) => { const r = held(relay, 'dtag = ?', d)[0]; return r && r.content ? Object.keys(JSON.parse(r.content).keys || {}) : []; };
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
// every key envelope the console sends, off its socket, for every new document
const HOOK = `(() => { if (window.__envHooked) return; window.__envHooked = 1; window.__env = [];
  const os = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) { try { if (typeof d === 'string' && d.startsWith('["EVENT"')) { const e = JSON.parse(d)[1]; const dd = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
      if (/^trinityone\\/(namekey|carekey|mediakey|groupkey):/.test(dd)) window.__env.push({ d: dd, recips: Object.keys(JSON.parse(e.content).keys || {}) }); } } catch (x) {}
    return os.call(this, d); };
})();`;

before(async () => {
  if (!CHROME) return;
  r1 = await H.startRelay({ name: 'down-relay-1', env: { TRINITY_TAILSCALE_BIN: '/nonexistent' } });
  r2 = await H.startRelay({ name: 'down-relay-2', env: { TRINITY_TAILSCALE_BIN: '/nonexistent' } });
  const cdp = await H.freePort('the down-relay test\'s Chrome debug port');
  prof = mkdtempSync(join(tmpdir(), 'trin-downrelay-chr-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=1280,1200', `${r1.base}/steward.html`], { stdio: 'ignore' });
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
  assert.equal(await evalIn(typeInto('input[aria-label="Church name"]', 'St Cuthbert Two Relays')), 'ok');
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
  // CONTROL, both relays up: two members join and are keyed
  await H.publishAll(r1, [joinTo(churchA, M), joinTo(churchA, MX)]); await H.publishAll(r2, [joinTo(churchA, M), joinTo(churchA, MX)]);
  assert.ok(await until(() => { const n = recipsOn(r1, NAMEKEY_D + churchA); return n.includes(M.pub) && n.includes(MX.pub); }, 60000),
    'CONTROL: with both relays up, the members who joined were never given the name key — the rows below would prove nothing');
  await sleep(3000);
  // THE BLOCK, pressed on the Members screen: MX
  await press('/^Members$/', 'the Members section'); await sleep(1500);
  await evalIn(`(() => { if (document.querySelector('button[title="Remove / block this member"]')) return 'direct'; const b = [...document.querySelectorAll('button')].find(x => /^More for /.test(x.getAttribute('aria-label') || '')); if (b) b.click(); return 'more'; })()`);
  await sleep(600);
  // MX's own row: the button whose nearest ancestor naming MX does not also name M (a list holds both rows)
  const opened = await evalIn(`(() => { const npub = ${JSON.stringify(nip19.npubEncode(MX.pub))}, other = ${JSON.stringify(nip19.npubEncode(M.pub))}; const btns = [...document.querySelectorAll('button[title="Remove / block this member"], button[title="Decline — blocks this person from joining or posting"]')];
    const mine = btns.find(b => { let n = b; for (let i = 0; i < 8 && n; i++) { n = n.parentElement; const t = (n && n.textContent) || ''; if (t.includes(npub.slice(0, 12))) return !t.includes(other.slice(0, 12)); if (t.includes(other.slice(0, 12))) return false; } return false; }) || null;
    if (!mine) return 'miss:' + btns.length; mine.click(); return 'ok'; })()`);
  assert.equal(opened, 'ok', 'no Block button for MX');
  await sleep(500);
  assert.equal(await evalIn(`(() => { const b = document.querySelector('button[title="Confirm — bans them from posting & hides their messages"]') || document.querySelector('button[title="Confirm — blocks them from joining or posting, and re-keys the church"]'); if (!b) return 'miss'; b.click(); return 'ok'; })()`), 'ok', 'no Block confirmation');
  assert.ok(await until(() => { const n = recipsOn(r1, NAMEKEY_D + churchA), c = recipsOn(r1, CAREKEY_D + churchA); return !n.includes(MX.pub) && !c.includes(MX.pub) && n.includes(M.pub); }, 30000),
    `CONTROL: the Block did not take MX out of A's name and care keys — name [${recipsOn(r1, NAMEKEY_D + churchA).map(nm)}], care [${recipsOn(r1, CAREKEY_D + churchA).map(nm)}], blocklists ${JSON.stringify([r1, r2].map(r => held(r, 'dtag = ?', BLOCKED_D + churchA).map(e => (JSON.parse(e.content).pubkeys || []).map(nm))))}, sent ${JSON.stringify((await evalIn('window.__env || []')).map(x => x.d.slice(11, 19) + ':' + x.recips.map(nm).join('/')))}`);
  for (const r of [r1, r2]) assert.ok(held(r, 'dtag = ?', BLOCKED_D + churchA).some(e => (JSON.parse(e.content).pubkeys || []).includes(MX.pub)), `CONTROL: ${r.name} does not hold the Block`);
  // an OPEN encrypted room, keyed to A's members
  const made = await evalIn(`(async () => { const S = window.Steward; const g = await S.publishGroup({ name: 'Cuthbert Sealed', encrypted: true });
    if (!g || !g.id) return { err: 'no group' }; const r = await S.publishGroupKey(g.id, [${JSON.stringify(M.pub)}]); return { id: g.id, key: r === null ? 'null' : r === false ? 'false' : 'ok' }; })()`);
  assert.equal(made.key, 'ok', 'CONTROL: the room\'s key was not published: ' + JSON.stringify(made));
  roomId = made.id;
  await sleep(3000);
  // RELAY 2 GOES DOWN, and stays in the church's set
  r2.proc.kill('SIGKILL');
  await sleep(2000);
  assert.equal(r2.alive(), false, 'CONTROL: relay 2 is still running');
});

after(async () => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  H.stopAll();
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
});

const SKIP = !CHROME ? 'no chromium' : false;
const sentTo = async (who) => (await evalIn('window.__env || []')).filter(x => x.d.endsWith(churchA) || x.d.includes(roomId)).filter(x => x.recips.includes(who)).map(x => x.d);

test('relay 2 down, the console reloaded: a member who joins is given the name, care and room keys', { skip: SKIP, timeout: 300000 }, async () => {
  await reload();
  assert.ok((await evalIn('window.Steward.relayList()')).includes(r2.wsUrl), 'CONTROL: relay 2 left the church\'s set — this row is not about a relay that is down');
  await sleep(12000);
  await evalIn('(() => { window.__env = []; return 1; })()');
  await H.publishAll(r1, [joinTo(churchA, M2)]);
  const got = await until(() => recipsOn(r1, NAMEKEY_D + churchA).includes(M2.pub) && recipsOn(r1, CAREKEY_D + churchA).includes(M2.pub) && recipsOn(r1, GROUPKEY_D + roomId).includes(M2.pub), WAIT);
  const now = (d) => recipsOn(r1, d).map(nm).sort().join(',');
  assert.ok(got, `A MEMBER WHO JOINED WHILE A PROVED RELAY WAS DOWN WAS NOT KEYED within ${WAIT / 1000} s (audit of 831dcea) — name [${now(NAMEKEY_D + churchA)}], care [${now(CAREKEY_D + churchA)}], room [${now(GROUPKEY_D + roomId)}]`);
  assert.deepEqual(await sentTo(MX.pub), [], 'a key envelope was sent wrapped to MX, the member A blocked');
  for (const d of [NAMEKEY_D + churchA, CAREKEY_D + churchA, GROUPKEY_D + roomId]) assert.ok(!recipsOn(r1, d).includes(MX.pub), `relay 1 now holds ${d.slice(11, 19)} wrapped to MX, the member A blocked`);
});

// THE FLOOR. Relay 1 now holds a blocklist WITHOUT MX — standing in for a relay that missed the Block (written newer,
// so the relay replaces its copy; signed by the church, as the console signs it). Relay 2, which holds the Block, is
// down. The console's own copy of the blocklist — written when the Block was pressed — must keep MX unkeyed.
test('…and while relay 2 is down, a relay copy without the Block does not undo it: the device\'s blocklist is the floor', { skip: SKIP, timeout: 300000 }, async () => {
  const unblocked = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000) + 1, tags: [['d', BLOCKED_D + churchA], ['t', 'trinityone']], content: JSON.stringify({ pubkeys: [] }) }, ASK);
  await H.publishAll(r1, [unblocked]);
  assert.ok(held(r1, 'dtag = ?', BLOCKED_D + churchA).every(e => !(JSON.parse(e.content).pubkeys || []).includes(MX.pub)), 'CONTROL: relay 1 still holds the Block — this row would prove nothing');
  assert.ok(JSON.parse(await evalIn(`localStorage.getItem('trinityone.steward.blockedlast.' + ${JSON.stringify(churchA)}) || '[]'`)).includes(MX.pub), 'CONTROL: the console has no copy of the Block on the device');
  await reload();
  await sleep(12000);
  await evalIn('(() => { window.__env = []; return 1; })()');
  await H.publishAll(r1, [joinTo(churchA, M3)]);
  const got = await until(() => recipsOn(r1, NAMEKEY_D + churchA).includes(M3.pub), WAIT);
  assert.ok(got, `CONTROL: M3 was never given the name key within ${WAIT / 1000} s — the enrolment did not run, so the floor proved nothing`);
  await sleep(3000);
  assert.deepEqual(await sentTo(MX.pub), [], 'A KEY ENVELOPE WAS SENT WRAPPED TO MX, whom this console blocked — a relay copy without the Block undid it while the relay holding it was down');
  for (const d of [NAMEKEY_D + churchA, CAREKEY_D + churchA, GROUPKEY_D + roomId]) assert.ok(!recipsOn(r1, d).includes(MX.pub), `relay 1 now holds ${d.slice(11, 19)} wrapped to MX`);
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});
