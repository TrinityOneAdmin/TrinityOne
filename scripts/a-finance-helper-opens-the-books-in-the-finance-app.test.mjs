// THE WHOLE FINANCE-APP PATH, END TO END: A TREASURER ASKS FROM finance.html, THE OWNER APPROVES (FINANCE PRE-PICKED),
// AND THE BOOKS OPEN IN THE FINANCE APP.
//   Run: node --test scripts/a-finance-helper-opens-the-books-in-the-finance-app.test.mjs
//
// T1Finance steps 1–2. The unit tests prove each piece where it is used (finance-app-shows-only-the-books,
// a-finance-app-request-preselects-the-finance-preset); this proves they meet: nothing in the finance app is a stub.
//   • the helper uses finance.html's real welcome ("Help with a church's books" → invite → name → Send → PIN);
//   • the owner's real Helpers page opens the approve sheet with "Finance helper" ALREADY ticked (the sealed app hint),
//     and the owner approves with their PIN;
//   • the owner's console hands over the books key (its own capability-key distribution);
//   • the helper's finance app lands on the church and renders the BOOK (DashFinanceBook's tab strip), not
//     "Waiting for the books", not "Not linked", and never the full console.
//
// POINT OF USE (CLAUDE.md rules 1 & 3): a real gateway on a free port; the owner's real console made through the real
// wizard (new-church-session.mjs); the helper in a SEPARATE headless chromium profile on finance.html. Everything is
// read from the two DOMs. Live relays are blackholed. Staging, as in a-removed-helper-is-told-and-sent-to-the-start:
// the box goes in the helper's extra-relays, because it does not host a bare helper key. Skips without chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { openNewChurch, CHROME, PIN, sleep, H, typeInto } from './new-church-session.mjs';

const HELPER_PIN = 'ledger-harbour-lamp-7';
let OWNER = null, HELPER = null, invite = '';
const SKIP = !CHROME ? 'no chromium' : false;

async function openFinanceApp(relay) {
  const cdp = await H.freePort('the finance helper Chrome debug port');
  const prof = mkdtempSync(join(tmpdir(), 'trin-finapp-chr-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9, MAP *.trycloudflare.com 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=420,900', `${relay.base}/finance.html`], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 60 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
  if (!targets || !targets.length) { try { chr.kill('SIGKILL'); } catch {} throw new Error('the finance app never exposed a debug target'); }
  const page = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map(); const errors = [];
  ws.on('message', (d) => { const m = JSON.parse(d);
    if (m.method === 'Runtime.exceptionThrown') { const e = m.params.exceptionDetails; errors.push((e.exception?.description || e.text || '').split('\n')[0]); }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  const s = { errors };
  s.ev = async (expression) => { const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (rr?.result?.exceptionDetails) throw new Error('in-page(finance): ' + JSON.stringify(rr.result.exceptionDetails).slice(0, 300)); return rr?.result?.result?.value; };
  s.text = () => s.ev(`(document.body.innerText||'').replace(/\\n/g,' / ')`);
  s.waitFor = async (expr, ms, label) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await s.ev(expr)) return true; } catch {} await sleep(300); } throw new Error('the finance app timed out waiting for ' + label + ' — screen: ' + String(await s.text()).slice(0, 400)); };
  s.press = async (re, label) => { const r = await s.ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`); if (r !== 'ok') throw new Error('nothing on the finance app matched ' + (label || re) + ' — screen: ' + String(await s.text()).slice(0, 300)); await sleep(400); };
  s.close = () => { try { ws.close(); } catch {} try { chr.kill('SIGKILL'); } catch {} setTimeout(() => { try { rmSync(prof, { recursive: true, force: true }); } catch {} }, 600); };
  return s;
}

before(async () => {
  if (!CHROME) return;
  OWNER = await openNewChurch({ wizard: 'skip', name: 'finapp' });
  await OWNER.waitFor(`!!(window.Steward && window.Steward.relayAuthed && window.Steward.relayAuthed())`, 60000, 'the owner logged in');
  invite = await OWNER.ev(`window.Steward.stewardInvitePayload()`);
  assert.ok(/^trinityone-stewardinvite:npub1/.test(invite), 'staging: the owner console gave no invite');
});
after(() => { try { HELPER && HELPER.close(); } catch {} try { OWNER && OWNER.close(); } catch {} H.stopAll(); });

test('a treasurer asks from the finance app, the owner approves with Finance pre-picked, and the books open there', { skip: SKIP, timeout: 480000 }, async () => {
  HELPER = await openFinanceApp(OWNER.relay);
  const h = HELPER;
  // ── the helper asks, through the finance app's own welcome ──
  await h.waitFor(`[...document.querySelectorAll('button')].some(x=>/Help with a church’s books/.test(x.textContent||''))`, 90000, 'the finance welcome');
  assert.equal(await h.ev(`[...document.querySelectorAll('button')].some(x=>/Start a new church/.test(x.textContent||''))`), false, 'the finance welcome offers "Start a new church"');
  await h.press(/Help with a church’s books/);
  await h.waitFor(`!!document.querySelector('input[aria-label="Church invite code"]')`, 30000, 'the invite step');
  await h.ev(`(() => { localStorage.setItem('trinityone.steward.extra-relays', JSON.stringify([${JSON.stringify(OWNER.relay.wsUrl)}])); return 1; })()`);
  await h.waitFor(`window.Steward.relayList().length > 0`, 30000, 'the finance app to prove the box');
  await h.ev(typeInto('input[aria-label="Church invite code"]', invite)); await sleep(300);
  await h.press(/^Next$/);
  await h.waitFor(`!!document.querySelector('input[aria-label="Your name"]')`, 10000, 'the name step');
  await h.ev(typeInto('input[aria-label="Your name"]', 'Tom Treasurer')); await sleep(300);
  await h.press(/^Send$/);
  await h.waitFor(`/Request sent/.test(document.body.innerText)`, 30000, 'Request sent');
  await h.press(/^Set a PIN & continue/);
  await h.waitFor(`!!document.querySelector('input[aria-label="Choose a console PIN or passphrase"]')`, 10000, 'the PIN step');
  await h.ev(typeInto('input[aria-label="Choose a console PIN or passphrase"]', HELPER_PIN)); await sleep(300);
  await h.press(/Set PIN & enter/);
  await h.waitFor(`/Waiting for/.test(document.body.innerText)`, 60000, 'the waiting-for-approval screen');
  const npub = await h.ev(`window.Steward.npub`);
  const hpub = await h.ev(`window.Steward.churchPub`);

  // ── the owner approves on the real Helpers page; the sheet opens on Finance ──
  await OWNER.press(/^Settings$/, 'Settings');
  const ROW = `[...document.querySelectorAll('button')].some(x=>/^Helpers *Let someone help/.test((x.textContent||'').trim()))`;
  if (!(await OWNER.ev(ROW))) await OWNER.ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/^Helpers/i.test((x.textContent||'').trim()) && !/Let someone/.test(x.textContent||'')); if(b) b.click(); return 1; })()`);
  await OWNER.waitFor(ROW, 30000, 'the Helpers settings row');
  await OWNER.press(/^Helpers\s*Let someone help/, 'the Helpers settings row');
  const np = JSON.stringify(npub);
  const ROWBTN = `[...document.querySelectorAll('div')].filter(d=>(d.innerText||'').includes(${np}) && (d.innerText.match(/npub1/g)||[]).length===1 && /Approve/.test(d.innerText)).sort((a,b)=>a.innerText.length-b.innerText.length).map(d=>[...d.querySelectorAll('button')].find(b=>/^Approve/.test((b.textContent||'').trim())))[0]`;
  await OWNER.waitFor(`!!(${ROWBTN})`, 60000, 'the treasurer\'s request row');
  await OWNER.ev(`(() => { (${ROWBTN}).click(); return 1; })()`);
  await OWNER.waitFor(`!!document.querySelector('input[aria-label="Your console PIN, to confirm this"]')`, 10000, 'the approve sheet');
  const picked = await OWNER.ev(`(() => { const r=[...document.querySelectorAll('input[type=radio]')].find(i=>i.checked); return r ? r.getAttribute('aria-label') : ''; })()`);
  assert.equal(picked, 'Finance helper', 'the owner\'s approve sheet did not open on the Finance preset for a finance-app request');
  await OWNER.ev(typeInto('input[aria-label="Your console PIN, to confirm this"]', PIN)); await sleep(300);
  await OWNER.press(/^Approve as helper$/, 'Approve as helper');

  // ── the finance app opens on the church, and shows the BOOK ──
  await h.waitFor(`window.Steward.actingChurch === ${JSON.stringify(OWNER.churchPub)}`, 90000, 'the finance app opening the church');
  try {
    await h.waitFor(`!!document.querySelector('[data-finance-shell]') && /in the bank/i.test(document.body.innerText) && !/Waiting for the books to be shared/.test(document.body.innerText)`, 180000, 'the book (the Summary, with its balances), with the books key received');
  } catch (e) {
    // WHERE THE BOOKS KEY STOPPED (audit F7: this failed once in a batch). Which side never moved: did the owner publish a
    // books-key envelope that names the treasurer, and does the treasurer's console hold a ring?
    const env = OWNER.rows(`kind = 30078 AND dtag = 'trinityone/financekey:${OWNER.churchPub}'`).map(r => { let k = []; try { k = Object.keys(JSON.parse(r.e.content).keys || {}); } catch (x) {} return { at: r.e.created_at, names: k.length, treasurer: k.includes(hpub) }; });
    const roster = OWNER.rows(`kind = 30078 AND dtag = 'trinityone/stewards:${OWNER.churchPub}'`).map(r => { let c = null; try { c = JSON.parse(r.e.content).caps || null; } catch (x) {} return { at: r.e.created_at, caps: c }; });
    const own = await OWNER.ev(`JSON.stringify({ authed: !!(window.Steward.relayAuthed && window.Steward.relayAuthed()), caps: (window.Steward.stewardCaps && window.Steward.stewardCaps()) || null, ring: (window.Steward.capKeyRing && window.Steward.capKeyRing('finance').length) || 0, relays: (window.Steward.relayList && window.Steward.relayList()) || [] })`).catch(() => '?');
    const hel = await h.ev(`JSON.stringify({ authed: !!(window.Steward.relayAuthed && window.Steward.relayAuthed()), ring: (window.Steward.capKeyRing && window.Steward.capKeyRing('finance').length) || 0, acting: window.Steward.actingChurch })`).catch(() => '?');
    throw new Error(e.message + '\n  relay financekey envelopes: ' + JSON.stringify(env) + '\n  relay steward roster: ' + JSON.stringify(roster) + '\n  owner: ' + own + '\n  treasurer: ' + hel);
  }
  const shown = String(await h.text());
  assert.doesNotMatch(shown, /Not linked to a church yet/);
  assert.equal(await h.ev(`[...document.querySelectorAll('button')].some(x=>/^(Members|Groups|Rota)$/.test((x.textContent||'').trim()))`), false, 'the finance app shows the full console\'s sections');
  // what the owner granted is exactly Finance (read from the owner's own roster state)
  assert.deepEqual(await OWNER.ev(`(window.Steward.stewardCaps() || {})[${JSON.stringify(hpub)}]`), ['finance'], 'the treasurer was granted something other than exactly Finance');
  assert.deepEqual(h.errors, [], 'the finance app threw:\n  ' + h.errors.join('\n  '));
});
