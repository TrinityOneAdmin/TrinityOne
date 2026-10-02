// WHAT A CONSOLE WRITES WHILE ACTING FOR ANOTHER CHURCH STAYS THAT CHURCH'S — ITS ROOMS, ITS ROOM KEYS, ITS CALENDAR.
//   Run: node --test scripts/what-a-console-wrote-for-another-church-stays-that-churchs.test.mjs
//
// The audit of 5276297 (HIGH 1, 3 runs of 3, also at 88f6666 and on main). A console that owns church A and is a
// steward of church B makes an ENCRYPTED room while acting for B (publishGroup, then publishGroupKey to B's member).
// Acting for B it signs with ITS OWN key — A's — and stamps ['church', B]. Every church reader asks for
// `authors: [<the church>]`, so back on A the room came back in A's group list: on A's Overview and Groups, and in
// the key distributor, whose per-church memo had survived the switch and saw A's members as "new" recipients. It
// re-published B's room key signed by A, wrapped to A and A's members only. The relay accepted it (A is B's steward)
// and, same author and same d-tag, it REPLACED the envelope A had written for B — B's members lost the room.
//
// THE POINT OF USE (CLAUDE.md rule 1): a real gateway on a FREE port, the real console in headless chromium, church
// A made by the wizard, church B rostering A with its member MB, A's members M and M3. Every group-key envelope the
// console sends is captured off its socket; the relay's own copy is read from its database; and what A's screens
// show is read off the page. Derived from the audit's crossgroup.test.mjs. Skips itself without chromium.
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
const ROOM = 'Bede Sealed Room', SUPPER = 'Bede Harvest Supper';

let relay, chr, ws, prof, evalIn, cdpSend, churchA = '', roomId = '';
const B = H.key(), M = H.key(), M3 = H.key(), M2 = H.key(), MB = H.key();
const errors = [];
const nm = (p) => p === B.pub ? 'B' : p === churchA ? 'A' : p === M.pub ? 'M (A)' : p === M3.pub ? 'M3 (A)' : p === M2.pub ? 'M2 (A)' : p === MB.pub ? 'MB (B)' : String(p).slice(0, 6);
function held(where, ...args) {
  const db = new DatabaseSync(join(relay.dataDir, 'relay.sqlite'), { readOnly: true });
  try { return db.prepare('SELECT pubkey, dtag, raw FROM events WHERE kind = 30078 AND ' + where).all(...args).map(r => { let e = {}; try { e = JSON.parse(String(r.raw || '')); } catch {} return { pubkey: String(r.pubkey), e }; }); }
  finally { db.close(); }
}
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
const press = async (re, label) => { assert.equal(await evalIn(click(re)), 'ok', `nothing on screen matched ${label || re}`); await sleep(700); };
const joinTo = (church, k) => { const ts = Math.floor(Date.now() / 1000); return finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', MEMBER_D + church], ['t', 'trinityone'], ['p', church]], content: JSON.stringify({ joined: ts }) }, k.sk); };
const screenText = () => evalIn(`document.body.innerText.replace(/\\s+/g, ' ')`);
// every group-key envelope the console sends, whichever church it is on — off the socket, for every document
const HOOK = `(() => { if (window.__hooked) return; window.__hooked = 1; window.__gk = [];
  const os = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) { try { if (typeof d === 'string' && d.startsWith('["EVENT"')) { const e = JSON.parse(d)[1]; const dd = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
      if (dd.startsWith('trinityone/groupkey:')) window.__gk.push({ d: dd, pubkey: e.pubkey, church: ((e.tags.find(t => t[0] === 'church') || [])[1] || ''), recips: Object.keys(JSON.parse(e.content).keys || {}) }); } } catch (x) {}
    return os.call(this, d); };
})();`;

before(async () => {
  if (!CHROME) return;
  relay = await H.startRelay({ name: 'for-another-church', env: { TRINITY_TAILSCALE_BIN: '/nonexistent' } });
  const cdp = await H.freePort('the for-another-church test\'s Chrome debug port');
  prof = mkdtempSync(join(tmpdir(), 'trin-xchurch-chr-'));
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
  assert.equal(await evalIn(typeInto('input[aria-label="Church name"]', 'St Aidan Xchurch')), 'ok');
  await sleep(300);
  await press('/^Continue$/');
  { const t0 = Date.now(); let ok = false; while (!ok && Date.now() - t0 < 30000) { try { ok = (JSON.parse(readFileSync(join(relay.dataDir, 'church.json'), 'utf8')).churches || []).some(c => c && c.npub === npubA); } catch {} if (!ok) await sleep(400); } assert.ok(ok, 'the box never registered church A'); }
  await waitFor(`localStorage.getItem('trinityone.steward.boxhosts.' + window.Steward.churchPub) === '1'`, 30000, 'the console to learn the box holds it');
  // church B rosters A; its name and care keys are wrapped to B, A and B's member MB
  const reg = await fetch(relay.base + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + relay.adminToken },
    body: JSON.stringify({ addChurch: { npub: nip19.npubEncode(B.pub), name: 'St Bede' } }) });
  assert.equal(reg.status, 200, 'the box would not register church B');
  const ts = Math.floor(Date.now() / 1000) - 5;
  const wrap = (ring, recips) => Object.fromEntries(recips.map(p => [p, nip44.v2.encrypt(JSON.stringify(ring), nip44.v2.utils.getConversationKey(B.sk, p))]));
  await H.publishAll(relay, [
    finalizeEvent({ kind: 0, created_at: ts, tags: [], content: JSON.stringify({ name: 'St Bede' }) }, B.sk),
    finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', 'trinityone/stewards:' + B.pub], ['t', 'trinityone']], content: JSON.stringify({ pubkeys: [churchA] }) }, B.sk),
    finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', CAREKEY_D + B.pub], ['t', 'trinityone']], content: JSON.stringify({ keys: wrap(['ab'.repeat(32)], [B.pub, churchA, MB.pub]), rev: 1 }) }, B.sk),
    finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', NAMEKEY_D + B.pub], ['t', 'trinityone']], content: JSON.stringify({ keys: wrap(['cd'.repeat(32)], [B.pub, churchA, MB.pub]), rev: 1 }) }, B.sk),
  ]);
  await H.publishAll(relay, [joinTo(B.pub, MB)]);
  await evalIn(`(() => { localStorage.setItem('trinityone.steward.wizard.done', '1'); localStorage.removeItem('trinityone.steward.newchurch'); return 'ok'; })()`);
  await cdpSend('Page.enable');
  await cdpSend('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
  await evalIn(`(() => { location.reload(); return 'ok'; })()`);
  await sleep(3000);
  await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('Your PIN or passphrase'))`, 90000, 'the unlock screen');
  assert.equal(await evalIn(typePh('Your PIN or passphrase', PIN)), 'ok');
  await press('/^Unlock/');
  await waitFor(`[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Settings') && !document.querySelector('[data-stew-modal-panel]')`, 90000, 'the dashboard');
  await waitFor(`window.Steward.nameKeyReady() && !!window.Steward.careSeal({ a: 1 })`, 90000, 'church A\'s own keys');
  await waitFor(`(window.Steward.identities() || []).some(x => x.kind === 'steward' && x.pub === ${JSON.stringify(B.pub)})`, 60000, 'church B in the switcher');
  await H.publishAll(relay, [joinTo(churchA, M), joinTo(churchA, M3)]);
  await sleep(6000);
  // ACTING FOR B: an encrypted room keyed to B's member, and a calendar event
  assert.equal(await evalIn(`window.Steward.setActiveIdentity(${JSON.stringify(B.pub)})`), true, 'CONTROL: switched to B');
  await waitFor(`window.Steward.nameKeyReady()`, 60000, 'B\'s name key');
  await sleep(4000);
  const made = await evalIn(`(async () => { const S = window.Steward;
    const g = await S.publishGroup({ name: ${JSON.stringify(ROOM)}, encrypted: true });
    if (!g || !g.id) return { err: 'no group' };
    const r = await S.publishGroupKey(g.id, [${JSON.stringify(MB.pub)}]);
    const ev = await S.publishEvent({ date: new Date().toISOString().slice(0, 10), time: '18:00', title: ${JSON.stringify(SUPPER)} });
    return { id: g.id, key: r === null ? 'null' : r === false ? 'false' : 'ok', ev: !!ev }; })()`);
  assert.ok(made && made.id && made.key === 'ok' && made.ev, 'CONTROL: could not make B\'s room and event: ' + JSON.stringify(made));
  roomId = made.id;
  await sleep(6000);
});

after(async () => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  H.stopAll();
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
});

const SKIP = !CHROME ? 'no chromium' : false;
const envFor = () => held('dtag = ?', GROUPKEY_D + roomId).map(r => ({ author: nm(r.pubkey), recips: Object.keys(JSON.parse(r.e.content).keys || {}).map(nm) }));

test('CONTROL: acting for B, B\'s room is on B\'s Groups and its key is wrapped to B and B\'s member', { skip: SKIP, timeout: 120000 }, async () => {
  const env = envFor();
  assert.equal(env.length, 1, 'CONTROL: the relay does not hold one envelope for B\'s room: ' + JSON.stringify(env));
  assert.ok(env[0].recips.includes('B') && env[0].recips.includes('MB (B)'), 'CONTROL: B\'s room key is not wrapped to B and MB: ' + JSON.stringify(env));
  await press('/^Groups$/', 'the Groups section');
  await sleep(1500);
  assert.match(await screenText(), new RegExp(ROOM), 'CONTROL: B\'s own Groups screen does not show the room — the rows below would prove nothing');
  await press('/^Calendar$/', 'the Calendar section');
  await sleep(2000);
  assert.match(await screenText(), new RegExp(SUPPER), 'CONTROL: B\'s own Calendar does not show the event — the calendar row below would prove nothing');
});

test('back on A, then a member joins A: B\'s room key is never sent to A\'s people, and the relay still holds B\'s', { skip: SKIP, timeout: 300000 }, async () => {
  await evalIn('(() => { window.__gk = []; return 1; })()');
  assert.equal(await evalIn(`window.Steward.setActiveIdentity(${JSON.stringify(churchA)})`), true, 'CONTROL: switched back to A');
  await sleep(12000);
  await H.publishAll(relay, [joinTo(churchA, M2)]);                       // A grows: the key distributor's busiest moment
  await sleep(15000);
  const sent = (await evalIn('window.__gk || []')).filter(x => x.d === GROUPKEY_D + roomId).map(x => ({ signer: nm(x.pubkey), church: x.church ? nm(x.church) : '', recips: x.recips.map(nm) }));
  assert.deepEqual(sent, [], 'B\'S ROOM KEY WAS RE-PUBLISHED FROM CHURCH A (audit of 5276297, HIGH 1): ' + JSON.stringify(sent));
  const env = envFor();
  assert.ok(env.length === 1 && env[0].recips.includes('MB (B)') && env[0].recips.includes('B'), 'THE RELAY NO LONGER HOLDS B\'S ROOM KEY FOR B AND ITS MEMBER — they have lost the room: ' + JSON.stringify(env));
  assert.ok(!env[0].recips.some(r => / \(A\)$/.test(r)), 'the relay holds B\'s room key wrapped to A\'s people: ' + JSON.stringify(env));
});

test('back on A: A\'s Groups and Calendar do not show what the console wrote for B', { skip: SKIP, timeout: 120000 }, async () => {
  assert.equal(await evalIn('window.Steward.actingChurch || ""'), '', 'CONTROL: not back on A');
  await press('/^Groups$/', 'the Groups section');
  await sleep(1500);
  assert.doesNotMatch(await screenText(), new RegExp(ROOM), 'CHURCH A\'S GROUPS SHOW B\'S ROOM — and the key distributor and Block walk this same list');
  await press('/^Calendar$/', 'the Calendar section');
  await sleep(2000);
  assert.doesNotMatch(await screenText(), new RegExp(SUPPER), 'church A\'s calendar shows the event the console wrote for B');
  // …and the engine's own lists, which the website feed and every other screen read
  const lists = await evalIn(`new Promise(res => { const S = window.Steward; let g = null, ev = null; const done = () => { if (g && ev) { sg(); se(); res({ g, ev }); } };
    const sg = S.subscribeGroups(l => { g = (l || []).map(x => x.name); done(); }); const se = S.subscribeEvents(l => { ev = (l || []).map(x => x.title); done(); });
    setTimeout(() => res({ g: g || [], ev: ev || [], late: true }), 8000); })`);
  assert.ok(!lists.g.includes(ROOM), 'A\'s group list holds B\'s room: ' + JSON.stringify(lists.g));
  assert.ok(!lists.ev.includes(SUPPER), 'A\'s event list holds B\'s event: ' + JSON.stringify(lists.ev));
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});
