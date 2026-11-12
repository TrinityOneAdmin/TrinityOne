// A DECLINED "REQUEST TO HELP" STAYS DECLINED — AFTER A RELOAD AND ON THE OWNER'S OTHER DEVICE — AND THE OVERVIEW
// BANNER COUNTS THE SAME PEOPLE THE HELPERS PAGE LISTS.
//   Run: node --test scripts/a-declined-helper-request-stays-declined.test.mjs
//
// OWNER-REPORTED 2026-11-12 (Living Word, web build 268).
//   1. Settings → Helpers → "Requests to help": the × only set in-memory React state, so a dismissed request came back
//      on every reload, and the owner's other devices never knew it had been answered.
//   2. The Overview banner counted the RAW request stream ("5 people want to help steward") while the Helpers page
//      filtered out people already answered — so the page listed 4.
//
// THE FIX. The × is a real Decline, recorded with Approve/Remove in one sealed church document on the relay
// (d=trinityone/stewardhandled:<church>, NIP-44 sealed to the church key; Steward.markStewardRequestHandled /
// subscribeHandledStewardRequests) as well as in this browser's localStorage. A request NEWER than the answer shows
// again. The banner and the page both read useHelperRequests → pendingHelperRequests, so their counts are one list.
//
// POINT OF USE (CLAUDE.md rules 1 and 3). A real gateway on a free port, the real console (steward.html) in headless
// chromium, a church made through the real wizard; requests published by real requester keys; the real banner and the
// real × pressed. "Another device" is a SECOND chromium profile restored from the 12 words — it shares no
// localStorage, so only the relay document can tell it about the decline. Nothing here matches text in app/*.jsx.
// The live relays are blackholed (host-resolver-rules in new-church-session.mjs and below). Skips without chromium.
//
// AUDIT OF eb5c10eb (2026-11-12), the last four tests:
//   M1 — an Approve whose roster write is REFUSED must not be recorded as answered. The refusal is real: the relay
//        process is killed (SIGKILL) under the console, so setStewards meets its own _requireTrustedView refusal
//        ("steward-write-blocked"), then the SAME box is started again on the same port and data. The owner then
//        declines somebody else — which publishes the whole answers map — and the refused person's request must still
//        show after a reload and on a fresh second profile.
//   M2 — the answer is recorded as the created_at of the request answered (the requester's clock), not the owner's
//        clock: a re-request signed with a created_at NEWER than the declined request but OLDER than the moment of the
//        decline (a requester whose phone runs behind) still shows.
//   L4 — readers fold every copy of the answers document by the later time per person: two church-signed copies are
//        delivered in turn, the second carrying a SMALLER time for one person, and that person stays hidden.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, getPublicKey, nip19, nip44 } from 'nostr-tools';
import { privateKeyFromSeedWords } from 'nostr-tools/nip06';
import { openNewChurch, CHROME, PIN, sleep, H, typeInto, typePh, rawReq } from './new-church-session.mjs';

const STEWARDREQ_D = 'trinityone/stewardreq:';
const HANDLED_D = 'trinityone/stewardhandled:';
const MEMBER_D = 'trinityone/member:';
const PIN_B = 'second-box-lamp-7714';

let A = null, B = null;
const RUTH = H.key();   // declined with the ×
const SAM = H.key();    // left waiting
const MEMBER = H.key(), STRANGER = H.key();
const PAT = H.key();     // Approve pressed while the roster write is refused (M1)
const QUINN = H.key();   // declined after the box is back — the write that carries the whole answers map
const SKEW = H.key();    // declined, then asks again from a phone whose clock runs behind the owner's (M2)
const FX = H.key(), FY = H.key();   // the two-copies fold (L4)
let restarted = null;    // the gateway process this file started again after killing the first one
let declinedAt = 0;

const stewardReq = (who, cp, name, at) => finalizeEvent({ kind: 30078, created_at: at, tags: [['d', STEWARDREQ_D + cp], ['t', 'trinityone'], ['p', cp]],
  content: JSON.stringify({ n: nip44.v2.encrypt(JSON.stringify({ name }), nip44.v2.utils.getConversationKey(who.sk, cp)) }) }, who.sk);
const npub = (k) => nip19.npubEncode(k.pub);

// ── what the screen says, read from the DOM ──────────────────────────────────────────────────────────────────────
// The banner's count: the number in "N person wants / people want to help steward", or 0 when there is no banner.
const BANNER_COUNT = `(() => { const b=[...document.querySelectorAll('button')].find(x=>/want(s)? to help steward/.test(x.textContent||'')); if(!b) return 0; const m=(b.textContent||'').match(/(\\d+)\\s+(person wants|people want) to help steward/); return m ? Number(m[1]) : -1; })()`;
// The Helpers page's "Requests to help · N", or 0 when the section is absent (nothing waiting).
const PAGE_COUNT = `(() => { const t=document.body.innerText; const m=t.match(/Requests to help\\s*·\\s*(\\d+)/i); return m ? Number(m[1]) : 0; })()`;
// Is this requester's row on the Helpers page? Each row prints the requester's npub.
const rowShown = (np) => `document.body.innerText.includes(${JSON.stringify(np)})`;
// Press the × (Decline) on exactly this requester's row.
const declineRow = (np) => `(() => { const xs=[...document.querySelectorAll('button[aria-label="Decline this request"]')];
  const b=xs.find(x=>{ let n=x; for(let i=0;i<6&&n;i++){ n=n.parentElement; if(n&&(n.innerText||'').includes(${JSON.stringify(np)})&&(n.innerText.match(/npub1/g)||[]).length===1) return true; } return false; });
  if(!b) return 'miss:'+xs.length; b.click(); return 'ok'; })()`;

async function toOverview(s) {
  await s.press(/^Overview$/, 'the Overview section');
  await sleep(800);
}
async function toHelpers(s) {
  await s.press(/^Settings$/, 'Settings');
  // the PAGE row ("Helpers — Let someone help run the church…"), not the group header of the same name
  // the Helpers GROUP may be folded: open it first (its header is a button whose text is "Helpers" + a count)
  const ROW = `[...document.querySelectorAll('button')].some(x=>/^Helpers *Let someone help/.test((x.textContent||'').trim()))`;
  if (!(await s.ev(ROW))) await s.ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/^Helpers/i.test((x.textContent||'').trim()) && !/Let someone/.test(x.textContent||'')); if(b) b.click(); return 1; })()`);
  await s.waitFor(`[...document.querySelectorAll('button')].some(x=>/^Helpers *Let someone help/.test((x.textContent||'').trim()))`, 30000, 'the Helpers settings row');
  await s.press(/^Helpers\s*Let someone help/, 'the Helpers settings row');
  await s.waitFor(`/Invite|helper/i.test(document.body.innerText)`, 30000, 'the Helpers page');
  await sleep(800);
}

// ── another device: a second chromium profile, restored from the 12 words (no shared localStorage) ─────────────
async function secondConsole(relay, mnemonic) {
  const cdp = await H.freePort('the second owner console Chrome debug port');
  const prof = mkdtempSync(join(tmpdir(), 'trin-hdecl-b-chr-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9, MAP *.trycloudflare.com 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=1280,1200', `${relay.base}/steward.html`], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 60 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
  if (!targets || !targets.length) { try { chr.kill('SIGKILL'); } catch {} throw new Error('the second console never exposed a debug target'); }
  const page = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  const s = {};
  s.ev = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error('in-page(B): ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };
  s.waitFor = async (expr, ms = 60000, label = expr) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await s.ev(expr)) return true; } catch {} await sleep(300); } throw new Error('B timed out waiting for: ' + label); };
  s.press = async (re, label) => { const r = await s.ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`); if (r !== 'ok') throw new Error('nothing on B\'s screen matched ' + (label || re)); await sleep(400); };
  s.close = () => { try { ws.close(); } catch {} try { chr.kill('SIGKILL'); } catch {} setTimeout(() => { try { rmSync(prof, { recursive: true, force: true }); } catch {} }, 600); };
  await s.waitFor(`[...document.querySelectorAll('button')].some(x => /Restore a church/i.test((x.textContent||'').trim()))`, 90000, 'the welcome screen');
  await s.press(/Restore a church/i);
  await s.waitFor(`!!document.querySelector('textarea[aria-label^="Your church"]')`, 30000, 'the 12-word box');
  await s.ev(`(() => { const t=document.querySelector('textarea[aria-label^="Your church"]'); const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; set.call(t, ${JSON.stringify(mnemonic)}); t.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
  await sleep(300);
  await s.press(/^Restore church$/);
  await s.waitFor(`!!document.querySelector('input[aria-label="Choose a console PIN or passphrase"]')`, 60000, 'B\'s PIN gate');
  await s.ev(typeInto('input[aria-label="Choose a console PIN or passphrase"]', PIN_B));
  await s.ev(typeInto('input[aria-label="Repeat the console PIN or passphrase"]', PIN_B));
  await sleep(300);
  await s.press(/Set PIN & enter/i);
  await s.waitFor(`[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Settings')`, 60000, 'B\'s dashboard');
  await s.waitFor(`!!(window.Steward && window.Steward.relayAuthed && window.Steward.relayAuthed())`, 60000, 'B logged in to the relay');
  return s;
}

before(async () => {
  if (!CHROME) return;
  A = await openNewChurch({ wizard: 'skip', name: 'hdecl' });
  const cp = A.churchPub;
  const at = Math.floor(Date.now() / 1000) - 120;
  await H.publishAll(A.relay, [stewardReq(RUTH, cp, 'Ruth Declined', at), stewardReq(SAM, cp, 'Sam Waiting', at)]);
  await A.waitFor(`!!(window.Steward && window.Steward.relayAuthed && window.Steward.relayAuthed())`, 60000, 'the console logged in');
});
after(() => { try { restarted && restarted.kill('SIGKILL'); } catch {} try { B && B.close(); } catch {} try { A && A.close(); } catch {} H.stopAll(); });
const SKIP = !CHROME ? 'no chromium' : false;

test('CONTROL: both requests reach the banner and the Helpers page before anything is declined', { skip: SKIP, timeout: 180000 }, async () => {
  await toOverview(A);
  await A.waitFor(`${BANNER_COUNT} === 2`, 45000, 'the banner to count the two requests');
  await toHelpers(A);
  try { await A.waitFor(`${rowShown(npub(RUTH))} && ${rowShown(npub(SAM))}`, 30000, 'both request rows on the Helpers page'); }
  catch (e) { throw new Error(e.message + ' — the page says: ' + String(await A.text()).slice(0, 1500)); }
  assert.equal(await A.ev(PAGE_COUNT), 2, 'the Helpers page does not list the two requests');
});

test('the × declines: the row goes, and after a RELOAD of the console it stays gone', { skip: SKIP, timeout: 240000 }, async () => {
  declinedAt = Math.floor(Date.now() / 1000);
  assert.equal(await A.ev(declineRow(npub(RUTH))), 'ok', 'could not find the × on Ruth\'s row');
  await sleep(600);
  assert.equal(await A.ev(rowShown(npub(RUTH))), false, 'Ruth\'s request is still listed right after the ×');
  assert.equal(await A.ev(rowShown(npub(SAM))), true, 'the × took Sam\'s request too — it must decline one person only');
  // the relay document is written after a read-back; give it a moment to land before the reload
  { const t0 = Date.now(); let ok = false; while (!ok && Date.now() - t0 < 20000) { ok = A.rows(`kind = 30078 AND dtag = '${HANDLED_D + A.churchPub}'`).length > 0; if (!ok) await sleep(400); }
    assert.ok(ok, 'the decline never reached the relay as a church document'); }
  await A.ev(`(() => { location.reload(); return 1; })()`);
  await sleep(2500);
  await A.waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('Your PIN or passphrase'))`, 90000, 'the unlock screen');
  await A.ev(typePh('Your PIN or passphrase', PIN));
  await A.press(/^Unlock/);
  await A.waitFor(`[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Settings')`, 90000, 'the dashboard after the reload');
  await toHelpers(A);
  await A.waitFor(rowShown(npub(SAM)), 45000, 'Sam\'s request after the reload (the list loaded)');
  await sleep(2000);   // the requests stream has delivered; give the relay document every chance to show its effect
  assert.equal(await A.ev(rowShown(npub(RUTH))), false, 'THE BUG: the declined request came back after a reload');
});

test('the banner counts exactly what the Helpers page lists when one request is from an already-answered person', { skip: SKIP, timeout: 180000 }, async () => {
  const page = await A.ev(PAGE_COUNT);
  assert.equal(page, 1, 'staging: the Helpers page should list Sam alone');
  await toOverview(A);
  await A.waitFor(`${BANNER_COUNT} !== 0`, 30000, 'the banner');
  await sleep(1500);
  assert.equal(await A.ev(BANNER_COUNT), page,
    'THE BUG: the banner counts a different number of people than the Helpers page lists (it is counting the raw stream)');
});

test('ANOTHER DEVICE (a second browser restored from the 12 words, no shared storage) does not show the declined request', { skip: SKIP, timeout: 300000 }, async () => {
  B = await secondConsole(A.relay, A.mnemonic);
  await toHelpers(B);
  await B.waitFor(rowShown(npub(SAM)), 60000, 'Sam\'s request on the second device (the list loaded)');
  await sleep(3000);
  assert.equal(await B.ev(rowShown(npub(RUTH))), false,
    'THE BUG: the owner\'s other device still shows the request they declined — the decline is not held by the church');
  assert.equal(await B.ev(PAGE_COUNT), 1, 'the second device lists a different number of requests');
  await toOverview(B);
  await B.waitFor(`${BANNER_COUNT} !== 0`, 30000, 'the second device\'s banner');
  await sleep(1500);
  assert.equal(await B.ev(BANNER_COUNT), 1, 'the second device\'s banner disagrees with its Helpers page');
});

test('a NEWER request from the declined person shows again — on both devices', { skip: SKIP, timeout: 240000 }, async () => {
  while (Math.floor(Date.now() / 1000) <= declinedAt + 1) await sleep(300);
  await H.publishAll(A.relay, [stewardReq(RUTH, A.churchPub, 'Ruth Asks Again', Math.floor(Date.now() / 1000))]);
  await toHelpers(B);
  await B.waitFor(rowShown(npub(RUTH)), 45000, 'Ruth\'s NEWER request on the second device — a request after the decline must show');
  assert.equal(await B.ev(PAGE_COUNT), 2);
  await toHelpers(A);
  await A.waitFor(rowShown(npub(RUTH)), 45000, 'Ruth\'s NEWER request on the first device');
  await toOverview(A);
  await A.waitFor(`${BANNER_COUNT} === 2`, 30000, 'the banner to count the re-request');
});

test('PRIVACY, measured on the relay: the record is sealed — a stranger gets nothing, a member gets ciphertext only', { skip: SKIP, timeout: 60000 }, async () => {
  const cp = A.churchPub;
  const filt = { kinds: [30078], '#d': [HANDLED_D + cp] };
  const anon = await rawReq(A.relay, filt);
  assert.equal(anon.events, 0, 'an anonymous reader was served the church\'s helper-answers document');
  const stranger = await H.readAs(A.relay, STRANGER, filt, 2500);
  assert.equal(stranger.length, 0, 'a signed-in stranger was served the church\'s helper-answers document');
  const ts = Math.floor(Date.now() / 1000);
  await H.publishAll(A.relay, [finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', MEMBER_D + cp], ['t', 'trinityone'], ['p', cp]], content: JSON.stringify({ joined: ts }) }, MEMBER.sk)]);
  await sleep(500);
  const asMember = await H.readAs(A.relay, MEMBER, filt, 2500);
  // whether a member gets the envelope at all is the relay's default member rule; what matters is that it is sealed
  for (const e of asMember) {
    assert.ok(!e.content.includes(RUTH.pub) && !e.content.includes(npub(RUTH)), 'a member can read WHO the owner declined, in the clear');
    assert.equal(typeof JSON.parse(e.content).e, 'string', 'the document is not in the sealed {e} shape');
  }
  const own = A.rows(`kind = 30078 AND dtag = '${HANDLED_D + cp}'`);
  assert.ok(own.length && own.every(r => r.e.pubkey === cp), 'the document is not signed by the church key');
  assert.ok(own.every(r => !r.e.content.includes(RUTH.pub)), 'the stored document carries a requester pubkey in the clear');
});

// ── the audit of eb5c10eb: M1, M2, L4 ─────────────────────────────────────────────────────────────────────────────
// Press "Approve…" on exactly this requester's row.
const approveRow = (np) => `(() => { const xs=[...document.querySelectorAll('button')].filter(x=>/^Approve…$/.test((x.textContent||'').trim()));
  const b=xs.find(x=>{ let n=x; for(let i=0;i<6&&n;i++){ n=n.parentElement; if(n&&(n.innerText||'').includes(${JSON.stringify(np)})&&(n.innerText.match(/npub1/g)||[]).length===1) return true; } return false; });
  if(!b) return 'miss:'+xs.length; b.click(); return 'ok'; })()`;
const handledRows = () => A.rows(`kind = 30078 AND dtag = '${HANDLED_D + A.churchPub}'`);
const newestHandledAt = () => handledRows().reduce((m, r) => Math.max(m, r.e.created_at || 0), 0);
async function waitHandledAfter(at, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) { if (newestHandledAt() > at) return; await sleep(400); }
  throw new Error('the answers document was never rewritten on the relay after ' + label);
}
// The same box, started again: same entry, same port, same data directory, same environment as H.startRelay.
async function restartBox(relay) {
  const env = { ...process.env, TRINITY_DATA_DIR: relay.dataDir, RELAY_SYNC: '0', RELAY_MAX_EVENTS: '5000', ...(relay.env || {}) };
  for (let i = 0; i < 3; i++) {
    const proc = spawn(process.execPath, [relay.entry, String(relay.port)], { cwd: H.ROOT, stdio: 'ignore', env });
    const t0 = Date.now();
    while (Date.now() - t0 < 25000 && proc.exitCode === null) {
      try { const r = await fetch(`${relay.base}/status`); if (r.ok) return proc; } catch {}
      await sleep(150);
    }
    try { proc.kill('SIGKILL'); } catch {}
    await sleep(1000);   // the port may still be held by the killed box for a moment
  }
  throw new Error('the box did not come back on port ' + relay.port);
}
async function reloadA() {
  await A.ev(`(() => { location.reload(); return 1; })()`);
  await sleep(2500);
  await A.waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('Your PIN or passphrase'))`, 90000, 'the unlock screen');
  await A.ev(typePh('Your PIN or passphrase', PIN));
  await A.press(/^Unlock/);
  await A.waitFor(`[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Settings')`, 90000, 'the dashboard after the reload');
  await A.waitFor(`!!(window.Steward && window.Steward.relayAuthed && window.Steward.relayAuthed())`, 60000, 'the console logged in after the reload');
}

test('M1: an Approve whose roster write is REFUSED is not recorded — the request still shows, after a reload', { skip: SKIP, timeout: 360000 }, async () => {
  const cp = A.churchPub;
  const at = Math.floor(Date.now() / 1000) - 60;
  await H.publishAll(A.relay, [stewardReq(PAT, cp, 'Pat Refused', at), stewardReq(QUINN, cp, 'Quinn Declined', at)]);
  await toHelpers(A);
  await A.waitFor(`${rowShown(npub(PAT))} && ${rowShown(npub(QUINN))}`, 45000, 'Pat\'s and Quinn\'s requests on the Helpers page');
  // open Pat's approve sheet while the box is up; the PIN goes in now, so the click below is the whole Approve
  assert.equal(await A.ev(approveRow(npub(PAT))), 'ok', 'could not find Approve… on Pat\'s row');
  await A.waitFor(`[...document.querySelectorAll('button')].some(x=>/^Approve as helper$/.test((x.textContent||'').trim()))`, 15000, 'the approve sheet');
  if (await A.ev(`!!document.querySelector('input[aria-label="Your console PIN, to confirm this"]')`)) await A.ev(typeInto('input[aria-label="Your console PIN, to confirm this"]', PIN));
  await A.ev(`(() => { window.__blocked = []; window.addEventListener('steward-write-blocked', e => window.__blocked.push(e.detail)); return 1; })()`);
  // THE REFUSAL: the box goes away under the console (its logger socket must not crash this process when it does)
  try { A.logger && A.logger.w && A.logger.w.on('error', () => {}); } catch {}
  const handledBefore = newestHandledAt();
  const first = A.relay.proc;
  first.kill('SIGKILL');
  if (first.exitCode === null && first.signalCode === null) await new Promise(r => first.once('exit', r));
  await A.waitFor(`!window.Steward.relayAuthed()`, 30000, 'the console to notice the box went away');
  await A.press(/^Approve as helper$/, 'Approve as helper');
  await sleep(1500);
  const blocked = await A.ev(`JSON.stringify(window.__blocked || [])`);
  assert.match(blocked, /steward roster/, 'staging: the roster write was not refused — this test proves nothing unless it is: ' + blocked);
  assert.equal(await A.ev(rowShown(npub(PAT))), true, 'THE BUG (M1): a refused Approve hid Pat\'s request at once — he is not a helper');
  // the same box comes back, and the owner answers somebody else: that write carries the whole answers map
  restarted = await restartBox(A.relay);
  assert.equal(await A.ev(declineRow(npub(QUINN))), 'ok', 'could not find the × on Quinn\'s row');
  await waitHandledAfter(handledBefore, 'declining Quinn');
  const rosters = A.rows(`kind = 30078 AND dtag = 'trinityone/stewards:${cp}'`);
  assert.ok(rosters.every(r => !String(r.e.content || '').includes(PAT.pub)), 'staging: Pat reached the roster after all');
  await reloadA();
  await toHelpers(A);
  await A.waitFor(rowShown(npub(SAM)), 45000, 'the request list after the reload');
  await sleep(2000);
  assert.equal(await A.ev(rowShown(npub(QUINN))), false, 'staging: Quinn\'s decline did not hold over the reload');
  assert.equal(await A.ev(rowShown(npub(PAT))), true, 'THE BUG (M1): after a refused Approve and a reload, Pat\'s request is gone');
});

test('M2: a re-request signed with a time NEWER than the declined request but OLDER than the owner\'s clock at the decline still shows', { skip: SKIP, timeout: 240000 }, async () => {
  const cp = A.churchPub;
  const nowS = Math.floor(Date.now() / 1000);
  await H.publishAll(A.relay, [stewardReq(SKEW, cp, 'Skew First', nowS - 600)]);   // a phone ten minutes behind
  await toHelpers(A);
  await A.waitFor(rowShown(npub(SKEW)), 45000, 'the first request from the slow-clock phone');
  const before = newestHandledAt();
  assert.equal(await A.ev(declineRow(npub(SKEW))), 'ok', 'could not find the × on the slow-clock row');
  await waitHandledAfter(before, 'declining the slow-clock request');
  await sleep(600);
  assert.equal(await A.ev(rowShown(npub(SKEW))), false, 'staging: the × did not decline the slow-clock request');
  // asks again five minutes later by its own clock — still five minutes BEFORE the owner's clock at the decline
  const again = nowS - 300;
  assert.ok(again < Math.floor(Date.now() / 1000) - 60, 'staging: the re-request must be older than the owner\'s clock at the decline');
  await H.publishAll(A.relay, [stewardReq(SKEW, cp, 'Skew Again', again)]);
  await A.waitFor(rowShown(npub(SKEW)), 45000,
    'THE BUG (M2): a genuine re-request from a phone whose clock runs behind is hidden, because the decline was timed by the owner\'s clock');
});

test('L4: readers fold every copy of the answers document by the LATER time per person', { skip: SKIP, timeout: 240000 }, async () => {
  const cp = A.churchPub;
  const csk = privateKeyFromSeedWords(A.mnemonic);
  assert.equal(getPublicKey(csk), cp, 'staging: the 12 words do not give the church key');
  const ck = nip44.v2.utils.getConversationKey(csk, cp);
  // what the relay holds now, opened with the church key — kept in both copies so this test hides nobody else
  const cur = handledRows().sort((a, b) => b.e.created_at - a.e.created_at)[0];
  const base = cur ? (JSON.parse(nip44.v2.decrypt(JSON.parse(cur.e.content).e, ck)).at || {}) : {};
  const copy = (at, created) => finalizeEvent({ kind: 30078, created_at: created, tags: [['d', HANDLED_D + cp], ['t', 'trinityone']],
    content: JSON.stringify({ e: nip44.v2.encrypt(JSON.stringify({ cp, at: { ...base, ...at } }), ck) }) }, csk);
  const nowS = Math.floor(Date.now() / 1000);
  await H.publishAll(A.relay, [stewardReq(FX, cp, 'Fold X', nowS - 100), stewardReq(FY, cp, 'Fold Y', nowS - 100)]);
  await toHelpers(A);
  await A.waitFor(`${rowShown(npub(FX))} && ${rowShown(npub(FY))}`, 45000, 'both fold requests on the Helpers page');
  const t1 = Math.max(nowS, newestHandledAt()) + 1;
  await H.publishAll(A.relay, [copy({ [FX.pub]: nowS - 50 }, t1)]);                                 // copy 1: X answered
  await A.waitFor(`!${rowShown(npub(FX))}`, 30000, 'copy 1 to reach the console (X hidden)');
  await H.publishAll(A.relay, [copy({ [FY.pub]: nowS - 50, [FX.pub]: nowS - 200 }, t1 + 1)]);   // copy 2: Y answered, X OLDER
  await A.waitFor(`!${rowShown(npub(FY))}`, 30000, 'copy 2 to reach the console (Y hidden)');
  await sleep(1500);
  assert.equal(await A.ev(rowShown(npub(FX))), false,
    'the reader took the LAST copy, not the later time: copy 2\'s older entry for X brought X\'s request back');
});

test('M1 + M2 on ANOTHER DEVICE (a fresh profile from the 12 words): the refused approve and the slow-clock re-request both show', { skip: SKIP, timeout: 300000 }, async () => {
  try { B && B.close(); } catch {}
  B = await secondConsole(A.relay, A.mnemonic);
  await toHelpers(B);
  await B.waitFor(rowShown(npub(SAM)), 60000, 'the request list on the fresh profile');
  await sleep(3000);
  assert.equal(await B.ev(rowShown(npub(QUINN))), false, 'staging: the fresh profile did not read the answers document (Quinn shows)');
  assert.equal(await B.ev(rowShown(npub(PAT))), true, 'THE BUG (M1): a refused Approve hides the request on the owner\'s other device');
  assert.equal(await B.ev(rowShown(npub(SKEW))), true, 'THE BUG (M2): the slow-clock re-request is hidden on the owner\'s other device');
});

// AUDIT OF 0252ae9a (2026-11-12), M2 + L3. A request's name is written by the REQUESTER: anyone who knows the church's
// public key can publish one, sealed to the church or (the pre-2026-09-05 form) in the clear. A name of 5, true,
// ["x"] or {} reached the Helpers page, whose `.split` (initials) or text child threw in render — the whole console
// dropped to the crash card, on the very page where the owner would decline it. Published here exactly as an
// attacker would, by hand; read back from the owner's real DOM; the real × pressed.
const HOSTILE = [
  { k: H.key(), name: 5 }, { k: H.key(), name: true }, { k: H.key(), name: ['x'] }, { k: H.key(), name: {} },
  { k: H.key(), name: 'Q'.repeat(500) },
];
const CLEAR_HOSTILE = [{ k: H.key(), name: 42 }, { k: H.key(), name: { a: 1 } }];   // the old clear-text `name`
const clearReq = (who, cp, name, at) => finalizeEvent({ kind: 30078, created_at: at, tags: [['d', STEWARDREQ_D + cp], ['t', 'trinityone'], ['p', cp]],
  content: JSON.stringify({ name }) }, who.sk);

test('M2/L3: requests whose name is a number, boolean, array, object or 500 characters — the Helpers page renders every row, cuts the long name, and the × still declines', { skip: SKIP, timeout: 300000 }, async () => {
  const cp = A.churchPub;
  const at = Math.floor(Date.now() / 1000) - 30;
  await H.publishAll(A.relay, [...HOSTILE.map(h => stewardReq(h.k, cp, h.name, at)), ...CLEAR_HOSTILE.map(h => clearReq(h.k, cp, h.name, at))]);
  const all = [...HOSTILE, ...CLEAR_HOSTILE];
  await toHelpers(A);
  const crashed = `/This screen stopped working/.test(document.body.innerText)`;
  try { await A.waitFor(all.map(h => rowShown(npub(h.k))).join(' && '), 45000, 'every hostile request row on the Helpers page'); }
  catch (e) {
    throw new Error((await A.ev(crashed) ? 'THE BUG (M2): the console dropped to the crash card on the Helpers page. ' : '') + e.message);
  }
  await sleep(1500);
  assert.equal(await A.ev(crashed), false, 'THE BUG (M2): the console shows the crash card');
  assert.equal(await A.ev(`document.body.innerText.includes(${JSON.stringify('Q'.repeat(60))})`), true,
    'staging: the long name is not shown at all');
  assert.equal(await A.ev(`document.body.innerText.includes(${JSON.stringify('Q'.repeat(61))})`), false,
    'THE BUG (L3): a hand-made 500-character name is shown uncut — the reader must cut it to the 60 the sender allows');
  // the × on a hostile row (the number-named one) declines that one person only
  const victim = npub(HOSTILE[0].k);
  assert.equal(await A.ev(declineRow(victim)), 'ok', 'could not find the × on the number-named row');
  await A.waitFor(`!${rowShown(victim)}`, 15000, 'the number-named row to go after the ×');
  for (const h of all.slice(1)) assert.equal(await A.ev(rowShown(npub(h.k))), true, 'the × took another hostile request with it');
  assert.equal(await A.ev(crashed), false, 'the console crashed after the ×');
});
