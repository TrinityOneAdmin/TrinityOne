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
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, nip19, nip44 } from 'nostr-tools';
import { openNewChurch, CHROME, PIN, sleep, H, typeInto, typePh, rawReq } from './new-church-session.mjs';

const STEWARDREQ_D = 'trinityone/stewardreq:';
const HANDLED_D = 'trinityone/stewardhandled:';
const MEMBER_D = 'trinityone/member:';
const PIN_B = 'second-box-lamp-7714';

let A = null, B = null;
const RUTH = H.key();   // declined with the ×
const SAM = H.key();    // left waiting
const MEMBER = H.key(), STRANGER = H.key();
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
after(() => { try { B && B.close(); } catch {} try { A && A.close(); } catch {} H.stopAll(); });
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
