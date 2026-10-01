// A CHURCH SWITCH WHILE A KEY PUBLISH IS IN FLIGHT HANDS NONE OF CHURCH A'S KEYS, OR MEMBERS, TO CHURCH B.
//   Run: node --test scripts/a-church-switch-mid-publish-hands-over-no-keys.test.mjs
//
// THE DEFECT (audit of d1116f6, 2026-10-01; present at its parent too). In the real console: Block a member of
// church A, and switch to church B while the Block's key rotation is publishing. The rotation committed its
// result AFTER the switch, so the console — now running B — held A's fresh care and name keys; its enrolment then
// published them AS B's envelopes, wrapped to B, A, and A's members INCLUDING THE MEMBER JUST BLOCKED. The Block
// was undone, and B's own console adopted A's keys. A member joining A with a switch during the name-key publish
// did the same with A's name key. And the enrolment, for a beat after the switch, still held church A's member
// list, so B's envelopes were wrapped to A's congregation.
//
// THE POINT OF USE (CLAUDE.md rule 1). A real gateway on a FREE port (never 8000), the real console in headless
// chromium, a church made through the real wizard, members who really join, and the REAL Block button. The
// switch is made by the console's own setActiveIdentity the instant the key envelope for A leaves the socket —
// the timing the audit used. Every key envelope the console sends for church B is captured off the socket and,
// with what the relay holds, checked from the outside: none may carry a key from church A's rings, and none may
// be wrapped to one of church A's members.
//
// Derived from the audit harness (scratchpad bleak.test.mjs). Skips itself when chromium is unavailable.
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
const NAMEKEY_D = 'trinityone/namekey:', CAREKEY_D = 'trinityone/carekey:', MEMBER_D = 'trinityone/member:';
const B_CARE = 'ab'.repeat(32), B_NAME = 'cd'.repeat(32);

let relay, chr, ws, prof, evalIn, churchA = '', ASK = null;
const B = H.key();
const M = H.key(), M3 = H.key(), M2 = H.key();     // church A's members; M is the one blocked; M2 joins later
const errors = [];

function held(where, ...args) {
  const db = new DatabaseSync(join(relay.dataDir, 'relay.sqlite'), { readOnly: true });
  try { return db.prepare('SELECT id, pubkey, dtag, raw FROM events WHERE kind = 30078 AND ' + where).all(...args).map(r => { let e = {}; try { e = JSON.parse(String(r.raw || '')); } catch {} return { id: String(r.id), pubkey: String(r.pubkey), dtag: String(r.dtag), e }; }); }
  finally { db.close(); }
}
const envelopeOf = (d) => held('dtag = ?', d)[0] || null;
// open whichever copy of an envelope we hold a key for (A's church key, or B's) → its ring
const openRing = (ev, who) => {
  const w = JSON.parse(ev.content).keys[who === 'A' ? churchA : B.pub]; if (!w) return null;
  const sk = who === 'A' ? ASK : B.sk;
  try { const p = nip44.v2.decrypt(w, nip44.v2.utils.getConversationKey(sk, ev.pubkey)); let r; try { r = JSON.parse(p); } catch { r = [p]; } return Array.isArray(r) ? r : [r]; } catch { return null; }
};
const ringOfA = (d) => { const env = envelopeOf(d + churchA); return env ? { id: env.id, ring: openRing(env.e, 'A') || [], recips: Object.keys(JSON.parse(env.e.content).keys) } : null; };

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
const join_ = (k) => { const ts = Math.floor(Date.now() / 1000); return finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', MEMBER_D + churchA], ['t', 'trinityone'], ['p', churchA]], content: JSON.stringify({ joined: ts }) }, k.sk); };

before(async () => {
  if (!CHROME) return;
  relay = await H.startRelay({ name: 'switch-mid-publish', env: { TRINITY_TAILSCALE_BIN: '/nonexistent' } });
  const cdp = await H.freePort('the mid-publish switch test\'s Chrome debug port');
  prof = mkdtempSync(join(tmpdir(), 'trin-midpub-chr-'));
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
  assert.equal(await evalIn(typeInto('input[aria-label="Church name"]', 'Church A Midpub')), 'ok');
  await sleep(300);
  await press('/^Continue$/');
  { const t0 = Date.now(); let ok = false; while (!ok && Date.now() - t0 < 30000) { try { ok = (JSON.parse(readFileSync(join(relay.dataDir, 'church.json'), 'utf8')).churches || []).some(c => c && c.npub === npubA); } catch {} if (!ok) await sleep(400); } assert.ok(ok, 'the box never registered church A'); }
  await waitFor(`localStorage.getItem('trinityone.steward.boxhosts.' + window.Steward.churchPub) === '1'`, 30000, 'the console to learn the box holds it');
  // CHURCH B names A's key as a steward and has its own care and name keys — wrapped to B AND to A, so the
  // console holds B's keys while it runs B, and its enrolment for B really does publish. That is what makes a
  // stale member list or a stale ring visible: with envelopes it cannot open, the console never writes B's.
  const reg = await fetch(relay.base + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + relay.adminToken },
    body: JSON.stringify({ addChurch: { npub: nip19.npubEncode(B.pub), name: 'Church B' } }) });
  assert.equal(reg.status, 200, 'the box would not register church B');
  const ts = Math.floor(Date.now() / 1000);
  const ckB = nip44.v2.utils.getConversationKey(B.sk, B.pub), ckBA = nip44.v2.utils.getConversationKey(B.sk, churchA);
  await H.publishAll(relay, [
    finalizeEvent({ kind: 0, created_at: ts, tags: [], content: JSON.stringify({ name: 'Church B Midpub' }) }, B.sk),
    finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', 'trinityone/stewards:' + B.pub], ['t', 'trinityone']], content: JSON.stringify({ pubkeys: [churchA] }) }, B.sk),
    finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', CAREKEY_D + B.pub], ['t', 'trinityone']], content: JSON.stringify({ keys: { [B.pub]: nip44.v2.encrypt(JSON.stringify([B_CARE]), ckB), [churchA]: nip44.v2.encrypt(JSON.stringify([B_CARE]), ckBA) }, rev: 1 }) }, B.sk),
    finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', NAMEKEY_D + B.pub], ['t', 'trinityone']], content: JSON.stringify({ keys: { [B.pub]: nip44.v2.encrypt(JSON.stringify([B_NAME]), ckB), [churchA]: nip44.v2.encrypt(JSON.stringify([B_NAME]), ckBA) }, rev: 1 }) }, B.sk),
  ]);
  await evalIn(`(() => { localStorage.setItem('trinityone.steward.wizard.done', '1'); localStorage.removeItem('trinityone.steward.newchurch'); return 'ok'; })()`);
  await evalIn(`(() => { location.reload(); return 'ok'; })()`);
  await sleep(3000);
  await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('Your PIN or passphrase'))`, 90000, 'the unlock screen');
  assert.equal(await evalIn(typePh('Your PIN or passphrase', PIN)), 'ok');
  await press('/^Unlock/');
  await waitFor(`[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Settings') && !document.querySelector('[data-stew-modal-panel]')`, 90000, 'the dashboard, with no wizard');
  await waitFor(`window.Steward.nameKeyReady() && !!window.Steward.careSeal({ a: 1 })`, 90000, 'church A\'s own name and care keys');
  await waitFor(`(window.Steward.identities() || []).some(x => x.kind === 'steward' && x.pub === ${JSON.stringify(B.pub)})`, 60000, 'church B in the switcher');
  ASK = privateKeyFromSeedWords(await evalIn('window.Steward.exportMnemonic()'));
  // TWO MEMBERS JOIN A, and the console keys them
  await H.publishAll(relay, [join_(M), join_(M3)]);
  { const t0 = Date.now(); let ok = false; while (Date.now() - t0 < 60000 && !ok) { const n = ringOfA(NAMEKEY_D), c = ringOfA(CAREKEY_D); ok = !!(n && c && n.recips.includes(M3.pub) && c.recips.includes(M3.pub) && n.recips.includes(M.pub)); if (!ok) await sleep(500); } assert.ok(ok, 'church A\'s members were never keyed — the rows below would prove nothing'); }
  await sleep(3000);
  // EVERY key envelope the console sends for church B, captured off the socket
  await evalIn(`(() => { const Bp = ${JSON.stringify(B.pub)}; window.__bSent = []; window.__armD = null;
    const os = WebSocket.prototype.send;
    WebSocket.prototype.send = function (d) {
      let switchNow = false;
      try { if (typeof d === 'string' && d.startsWith('["EVENT"')) { const e = JSON.parse(d)[1]; const dd = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
        if (/^trinityone\\/(namekey|carekey|mediakey):/.test(dd) && dd.endsWith(Bp)) window.__bSent.push(e);
        if (window.__armD && dd === window.__armD) { window.__armD = null; switchNow = true; } } } catch (x) {}
      const r = os.call(this, d);
      if (switchNow) queueMicrotask(() => { window.__switched = window.Steward.setActiveIdentity(Bp); });
      return r; };
    return 'ok'; })()`);
});

after(async () => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  H.stopAll();
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
});

const SKIP = !CHROME ? 'no chromium' : false;
// NO ENVELOPE FOR CHURCH B — sent by the console or held by the relay — carries a key from church A's rings, or is
// wrapped to one of church A's members.
async function checkB(aRings, aMembers, label) {
  const sent = await evalIn('window.__bSent || []');
  const relayRows = [envelopeOf(CAREKEY_D + B.pub), envelopeOf(NAMEKEY_D + B.pub)].filter(Boolean).map(r => r.e);
  const nm = (p) => p === M.pub ? 'M (blocked)' : p === M2.pub ? 'M2' : p === M3.pub ? 'M3' : p.slice(0, 8);
  const problems = [];
  for (const ev of [...sent, ...relayRows]) {
    const d = (ev.tags.find(t => t[0] === 'd') || [])[1];
    const recips = Object.keys(JSON.parse(ev.content).keys);
    const leakedTo = recips.filter(p => aMembers.includes(p));
    if (leakedTo.length) problems.push(`${label}: ${d.slice(11, 19)} for church B wrapped to church A's member(s) ${leakedTo.map(nm).join(', ')}`);
    for (const who of ['A', 'B']) {
      const ring = openRing(ev, who) || [];
      const leaked = ring.filter(k => aRings.has(k));
      if (leaked.length) problems.push(`${label}: ${d.slice(11, 19)} for church B carries ${leaked.length} of church A's keys`);
    }
  }
  return { problems, sentForB: sent.length };
}


// THE CONSOLE, RUNNING B, HOLDS B'S KEYS AND NONE OF A'S: its care seal opens under B's care key and under none of
// A's; and a name sealed under church A's current name key does not open (the audit's visible symptom: it did).
async function consoleInBHoldsOnlyB(label) {
  const problems = [];
  const ct = await evalIn(`window.Steward.careSeal({ probe: 'B' })`);
  const opens = (k) => { try { nip44.v2.decrypt(ct, Uint8Array.from(k.match(/../g).map(b => parseInt(b, 16)))); return true; } catch { return false; } };
  if (!ct) problems.push(`${label}: in church B the console holds no care key (B's envelope is wrapped to it)`);
  else {
    if (!opens(B_CARE)) problems.push(`${label}: IN CHURCH B THE CONSOLE SEALS CARE WITH A KEY THAT IS NOT CHURCH B'S`);
    for (const k of ringOfA(CAREKEY_D).ring) if (opens(k)) problems.push(`${label}: IN CHURCH B THE CONSOLE SEALS CARE WITH CHURCH A'S CARE KEY`);
  }
  const aName = ringOfA(NAMEKEY_D).ring[0];
  const sealedInA = nip44.v2.encrypt(JSON.stringify({ name: 'Miriam (a member of A)' }), Uint8Array.from(aName.match(/../g).map(b => parseInt(b, 16))));
  const opened = await evalIn(`window.Steward.openMemberName(${JSON.stringify(sealedInA)}, ${JSON.stringify(M3.pub)})`);
  if (opened) problems.push(`${label}: IN CHURCH B THE CONSOLE OPENS A NAME SEALED UNDER CHURCH A'S NAME KEY ("${opened}")`);
  return problems;
}

test('a Block in church A, with a switch to church B while the rotation publishes, hands B none of A\'s keys or members — and the blocked member gets none of A\'s new keys', { skip: SKIP, timeout: 240000 }, async () => {
  const aRings = new Set([...(ringOfA(CAREKEY_D).ring), ...(ringOfA(NAMEKEY_D).ring)]);
  // what block() is told by each rotation, as it is told it
  await evalIn(`(() => { const S = window.Steward; window.__rot = [];
    const oc = S.rotateCareKey; S.rotateCareKey = async function (...a) { const r = await oc.apply(this, a); window.__rot.push(['care', r]); return r; };
    const on = S.ensureNameKeyForMembers; S.ensureNameKeyForMembers = async function (...a) { const r = await on.apply(this, a); if (a[2] && a[2].rotate) window.__rot.push(['name', r === false ? false : r === null ? null : true]); return r; };
    window.__armD = ${JSON.stringify(CAREKEY_D + churchA)}; return 'armed'; })()`);
  await press('/^Members$/', 'the Members section');
  await sleep(1500);
  await evalIn(`(() => { if (document.querySelector('button[title="Remove / block this member"]')) return 'direct'; const b = [...document.querySelectorAll('button')].find(x => /^More for /.test(x.getAttribute('aria-label') || '')); if (b) b.click(); return 'more'; })()`);
  await sleep(600);
  // the member row for M: the block button nearest M's npub on screen
  const blocked = await evalIn(`(() => { const npub = ${JSON.stringify(nip19.npubEncode(M.pub))}; const btns = [...document.querySelectorAll('button[title="Remove / block this member"], button[title="Decline — blocks this person from joining or posting"]')];
    const mine = btns.find(b => { let n = b; for (let i = 0; i < 8 && n; i++) { n = n.parentElement; if (n && (n.textContent || '').includes(npub.slice(0, 12))) return true; } return false; }) || null;
    if (!mine) return 'miss:' + btns.length; mine.click(); return 'ok'; })()`);
  assert.equal(blocked, 'ok', 'no Block button for member M on the Members screen');
  await sleep(500);
  assert.equal(await evalIn(`(() => { const b = document.querySelector('button[title="Confirm — bans them from posting & hides their messages"]') || document.querySelector('button[title="Confirm — blocks them from joining or posting, and re-keys the church"]'); if (!b) return 'miss'; b.click(); return 'ok'; })()`), 'ok', 'no Block confirmation');
  await waitFor(`window.__switched === true`, 30000, 'the switch to church B as the rotation\'s envelope left the socket');
  await sleep(15000);
  const { problems, sentForB } = await checkB(aRings, [M.pub, M3.pub], 'Block');
  // THE BLOCKED MEMBER: every rotation that says it landed must have left them out of church A's envelope; one that
  // did not land must have SAID so (block() warns only on false)
  const rot = await evalIn('window.__rot || []');
  for (const [kind, r] of rot) {
    const a = ringOfA(kind === 'care' ? CAREKEY_D : NAMEKEY_D);
    if (r === true && a.recips.includes(M.pub)) problems.push(`the ${kind} rotation reported success, but church A's ${kind} envelope still wraps the key to the blocked member`);
    if (r === null) problems.push(`the ${kind} rotation was declined silently (null) — block() reports only false, so the steward is told nothing`);
  }
  assert.ok(rot.some(([k]) => k === 'care'), 'CONTROL: the Block did not run the care rotation');
  for (const ev of await evalIn('window.__bSent || []')) if (Object.keys(JSON.parse(ev.content).keys).includes(M.pub)) problems.push('THE BLOCKED MEMBER WAS WRAPPED INTO A KEY ENVELOPE FOR CHURCH B');
  assert.equal(await evalIn(`window.Steward.actingChurch`), B.pub, 'CONTROL: the console is running church B');
  problems.push(...await consoleInBHoldsOnlyB('Block'));
  assert.deepEqual(problems, [], `${problems.length} problem(s); the console sent ${sentForB} key envelope(s) for church B`);
});

test('a member joining church A, with a switch to church B while A\'s name key publishes, hands B none of A\'s keys or members', { skip: SKIP, timeout: 240000 }, async () => {
  // back to A by the header switcher, and wait for A's keys
  assert.equal(await evalIn(`(() => { const b=document.querySelector('button[title="Switch between your church, networks, and churches you steward"]'); if(!b) return 'miss'; b.click(); return 'ok'; })()`), 'ok', 'the header switcher is not on screen');
  await sleep(500);
  assert.equal(await evalIn(`(() => { const b=[...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('Your church')); if(!b) return 'miss'; b.click(); return 'ok'; })()`), 'ok', 'no switcher row for church A');
  await waitFor(`window.Steward.activePub === ${JSON.stringify(churchA)} && window.Steward.nameKeyReady() && !!window.Steward.careSeal({ a: 1 })`, 60000, 'church A\'s keys back on the console');
  await sleep(4000);
  await evalIn(`(() => { window.__bSent = []; window.__switched = false; return 1; })()`);
  const aRings = new Set([...(ringOfA(CAREKEY_D).ring), ...(ringOfA(NAMEKEY_D).ring)]);
  await evalIn(`(() => { window.__armD = ${JSON.stringify(NAMEKEY_D + churchA)}; return 'armed'; })()`);
  await H.publishAll(relay, [join_(M2)]);             // a member joins church A: the enrolment re-wraps A's name key
  await waitFor(`window.__switched === true`, 60000, 'the switch to church B as A\'s name-key envelope left the socket');
  await sleep(15000);
  for (const k of (ringOfA(NAMEKEY_D) || { ring: [] }).ring) aRings.add(k);
  const { problems, sentForB } = await checkB(aRings, [M.pub, M2.pub, M3.pub], 'member joined');
  problems.push(...await consoleInBHoldsOnlyB('member joined'));
  assert.deepEqual(problems, [], `${problems.length} problem(s); the console sent ${sentForB} key envelope(s) for church B`);
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});
