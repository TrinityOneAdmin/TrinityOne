// AN APPROVED FINANCE HELPER IS HANDED THE BOOKS KEY BY THE OWNER'S CONSOLE AS IT STANDS — NO RELOAD ON EITHER SIDE.
//   Run: node --test scripts/an-approved-finance-helper-gets-the-books-without-an-owner-reload.test.mjs
//
// THE BUG (2026-11-18). The owner approves a helper with Finance on the real Helpers page; the helper's console opens the
// church and then sits on "Waiting for the books to be shared with you" until the OWNER reloads. The owner's console hands
// the books key over from the mint effect in app/stew-dashboard.jsx (ensureCapKeyFor per capability), which needs two
// live streams: the steward roster (who holds Finance) and the books-key envelope (`checked`, before it will mint). On a
// brand-new church those streams could open while the gate had the box OUT of the admitted set, and the reconnect
// ticker in app/steward-root.jsx then never re-opened them (its snapshot already listed the box) — so the owner console
// never heard its own roster change and never minted any books key, for the whole session. That race depends on boot
// timing, so on the unfixed code this test fails SOMETIMES, not every run; the deterministic proof of the mechanism is
// scripts/a-stream-opened-while-its-relay-was-out-is-reopened.test.mjs.
//
// POINT OF USE (CLAUDE.md rules 1 and 3). A real gateway on a free port; the owner's real console made through the real
// wizard (new-church-session.mjs); the helper in a SEPARATE headless chromium profile who asks through the real welcome
// screen ("Help run a church"), sets a PIN, and is approved on the owner's real Helpers page with the "Finance helper"
// preset and the owner's PIN. The helper's console must then open its Finance page on the BOOK — not "Waiting for the
// books" — while the owner's console is the same page load it was before the approve (a marker on `window` proves it).
// Nothing here matches text in app/*.jsx. Live relays are blackholed. Skips without chromium.
//
// ⚠ NOT A CODE FAILURE: chromium here is a snap (see CLAUDE.md, "Browser tests leak 171MB"); run-tests sweeps it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { openNewChurch, CHROME, PIN, sleep, H, typeInto } from './new-church-session.mjs';

const HELPER_PIN = 'ledger-harbour-lamp-8';
const SKIP = !CHROME ? 'no chromium' : false;
let OWNER = null, HELPER = null, invite = '';

async function openConsole(relay, tag) {
  const cdp = await H.freePort('the helper Chrome debug port');
  const prof = mkdtempSync(join(tmpdir(), 'trin-hbk-' + tag + '-chr-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9, MAP *.trycloudflare.com 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=1280,1200', `${relay.base}/steward.html`], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 60 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
  if (!targets || !targets.length) { try { chr.kill('SIGKILL'); } catch {} throw new Error(tag + ' never exposed a debug target'); }
  const page = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map(); const errors = [];
  ws.on('message', (d) => { const m = JSON.parse(d);
    if (m.method === 'Runtime.exceptionThrown') { const e = m.params.exceptionDetails; errors.push((e.exception?.description || e.text || '').split('\n')[0]); }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  const s = { tag, errors };
  s.ev = async (expression) => { const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (rr?.result?.exceptionDetails) throw new Error(`in-page(${tag}): ` + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300)); return rr?.result?.result?.value; };
  s.text = () => s.ev(`(document.body.innerText||'').replace(/\\n/g,' / ')`);
  s.waitFor = async (expr, ms, label) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await s.ev(expr)) return true; } catch {} await sleep(300); } let said = ''; try { said = String(await s.text()).slice(0, 600); } catch {} throw new Error(`${tag} timed out waiting for ` + label + ' — the screen says: ' + said); };
  s.press = async (re, label) => { const r = await s.ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`); if (r !== 'ok') throw new Error(`nothing on ${tag}'s screen matched ` + (label || re)); await sleep(400); };
  s.close = () => { try { ws.close(); } catch {} try { chr.kill('SIGKILL'); } catch {} setTimeout(() => { try { rmSync(prof, { recursive: true, force: true }); } catch {} }, 600); };
  await s.waitFor(`[...document.querySelectorAll('button')].some(x => /Start a new church/i.test((x.textContent||'').trim()))`, 90000, 'the welcome screen');
  return s;
}

before(async () => {
  if (!CHROME) return;
  OWNER = await openNewChurch({ wizard: 'skip', name: 'hbkey' });
  await OWNER.waitFor(`!!(window.Steward && window.Steward.relayAuthed && window.Steward.relayAuthed())`, 60000, 'the owner logged in');
  invite = await OWNER.ev(`window.Steward.stewardInvitePayload()`);
  assert.ok(/^trinityone-stewardinvite:npub1/.test(invite), 'staging: the owner console gave no invite');
});
after(() => { try { HELPER && HELPER.close(); } catch {} try { OWNER && OWNER.close(); } catch {} H.stopAll(); });

test('the owner approves a Finance helper and, with NO owner reload, the helper\'s Finance page opens on the book', { skip: SKIP, timeout: 480000 }, async () => {
  const h = HELPER = await openConsole(OWNER.relay, 'helper');
  // ── the helper asks through the real welcome screen ──
  await h.press(/^Help run a church$/, 'Help run a church');
  await h.waitFor(`!!document.querySelector('input[aria-label="Church invite code"]')`, 30000, 'the invite step');
  // STAGING, as in a-removed-helper-is-told-and-sent-to-the-start: the box does not host a bare helper key, so put it in
  // the helper's relay list (the shipped community relays are blackholed here).
  await h.ev(`(() => { localStorage.setItem('trinityone.steward.extra-relays', JSON.stringify([${JSON.stringify(OWNER.relay.wsUrl)}])); return 1; })()`);
  await h.waitFor(`window.Steward.relayList().length > 0`, 30000, 'the helper console to prove the box');
  await h.ev(typeInto('input[aria-label="Church invite code"]', invite)); await sleep(300);
  await h.press(/^Next$/, 'Next');
  await h.waitFor(`!!document.querySelector('input[aria-label="Your name"]')`, 10000, 'the name step');
  await h.ev(typeInto('input[aria-label="Your name"]', 'Tom Treasurer')); await sleep(300);
  await h.press(/^Send$/, 'Send');
  await h.waitFor(`/Request sent/.test(document.body.innerText)`, 30000, 'Request sent');
  await h.press(/^Set a PIN & continue/, 'Set a PIN & continue');
  await h.waitFor(`!!document.querySelector('input[aria-label="Choose a console PIN or passphrase"]')`, 10000, 'the PIN step');
  await h.ev(typeInto('input[aria-label="Choose a console PIN or passphrase"]', HELPER_PIN)); await sleep(300);
  await h.press(/Set PIN & enter/, 'Set PIN & enter');
  await h.waitFor(`/Waiting for/.test(document.body.innerText)`, 60000, 'the waiting-for-approval screen');
  const npub = await h.ev(`window.Steward.npub`);
  const hpub = await h.ev(`window.Steward.pubkey`);

  // ── the owner approves on the real Helpers page, choosing "Finance helper" ──
  // THE SAME PAGE LOAD, before and after: a reload wipes this marker, so the hand-over cannot be credited to one.
  await OWNER.ev(`(() => { window.__sameLoad = 'hbk-' + Date.now(); return 1; })()`);
  const loadMark = await OWNER.ev(`window.__sameLoad`);
  await OWNER.press(/^Settings$/, 'Settings');
  const ROW = `[...document.querySelectorAll('button')].some(x=>/^Helpers *Let someone help/.test((x.textContent||'').trim()))`;
  if (!(await OWNER.ev(ROW))) await OWNER.ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/^Helpers/i.test((x.textContent||'').trim()) && !/Let someone/.test(x.textContent||'')); if(b) b.click(); return 1; })()`);
  await OWNER.waitFor(ROW, 30000, 'the Helpers settings row');
  await OWNER.press(/^Helpers\s*Let someone help/, 'the Helpers settings row');
  const np = JSON.stringify(npub);
  const ROWBTN = `[...document.querySelectorAll('div')].filter(d=>(d.innerText||'').includes(${np}) && (d.innerText.match(/npub1/g)||[]).length===1 && /Approve/.test(d.innerText)).sort((a,b)=>a.innerText.length-b.innerText.length).map(d=>[...d.querySelectorAll('button')].find(b=>/^Approve/.test((b.textContent||'').trim())))[0]`;
  await OWNER.waitFor(`!!(${ROWBTN})`, 60000, 'the helper\'s request row');
  await OWNER.ev(`(() => { (${ROWBTN}).click(); return 1; })()`);
  await OWNER.waitFor(`!!document.querySelector('input[aria-label="Your console PIN, to confirm this"]')`, 10000, 'the approve sheet');
  const r = await OWNER.ev(`(() => { const i=document.querySelector('input[type=radio][aria-label="Finance helper"]'); if(!i) return 'miss'; i.click(); return 'ok'; })()`);
  assert.equal(r, 'ok', 'staging: the approve sheet has no "Finance helper" preset');
  await sleep(300);
  assert.equal(await OWNER.ev(`(() => { const r=[...document.querySelectorAll('input[type=radio]')].find(i=>i.checked); return r ? r.getAttribute('aria-label') : ''; })()`), 'Finance helper', 'staging: the Finance preset did not take');
  await OWNER.ev(typeInto('input[aria-label="Your console PIN, to confirm this"]', PIN)); await sleep(300);
  await OWNER.press(/^Approve as helper$/, 'Approve as helper');

  // ── the helper's console opens the church, and its Finance page shows the BOOK ──
  await h.waitFor(`window.Steward.actingChurch === ${JSON.stringify(OWNER.churchPub)}`, 90000, 'the helper\'s console opening the church');
  // THE BOOK: its tab strip (Transactions and Reports are the two tabs drawn at every width) and no "Waiting" wall.
  const TABS = `['Transactions','Reports'].every(l => [...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === l))`;
  const BOOK = `${TABS} && !/Waiting for the books to be shared/.test(document.body.innerText)`;
  try {
    await h.waitFor(`[...document.querySelectorAll('button')].some(x=>/^Finance$/.test((x.textContent||'').trim()))`, 60000, 'a Finance tab on the helper\'s console');
    // ON the Finance page = the book or its "Waiting for the books" wall is drawn. A church opening can put the console
    // back on Overview, so the tab is pressed again until it holds — the books key is what is being waited for, not a click.
    const ON_FIN = `${TABS} || /Waiting for the books to be shared/.test(document.body.innerText)`;
    const t0 = Date.now();
    while (Date.now() - t0 < 90000 && !(await h.ev(BOOK))) {
      if (!(await h.ev(ON_FIN))) await h.ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/^Finance$/.test((x.textContent||'').trim())); if(b) b.click(); return 1; })()`);
      await sleep(500);
    }
    await h.waitFor(BOOK, 1000, 'the book (its tab strip), with the books key received');
  } catch (e) {
    const env = OWNER.rows(`kind = 30078 AND dtag = 'trinityone/financekey:${OWNER.churchPub}'`).map(rw => { let k = []; try { k = Object.keys(JSON.parse(rw.e.content).keys || {}); } catch (x) {} return { at: rw.e.created_at, names: k.length, helper: k.includes(hpub) }; });
    const roster = OWNER.rows(`kind = 30078 AND dtag = 'trinityone/stewards:${OWNER.churchPub}'`).map(rw => { let c = null; try { c = JSON.parse(rw.e.content).caps || null; } catch (x) {} return { at: rw.e.created_at, caps: c }; });
    const own = await OWNER.ev(`JSON.stringify({ sameLoad: window.__sameLoad, authed: !!(window.Steward.relayAuthed && window.Steward.relayAuthed()), caps: window.Steward.stewardCaps(), ring: window.Steward.capKeyRing('finance').length })`).catch(() => '?');
    const hel = await h.ev(`JSON.stringify({ authed: !!(window.Steward.relayAuthed && window.Steward.relayAuthed()), ring: window.Steward.capKeyRing('finance').length, acting: window.Steward.actingChurch })`).catch(() => '?');
    throw new Error(e.message + '\n  relay financekey envelopes: ' + JSON.stringify(env) + '\n  relay roster: ' + JSON.stringify(roster) + '\n  owner: ' + own + '\n  helper: ' + hel);
  }
  // the owner's console is the page load that did the approve — no reload was involved
  assert.equal(await OWNER.ev(`window.__sameLoad`), loadMark, 'the owner\'s console was reloaded, so this proves nothing about the hand-over');
  // what the owner granted is exactly Finance, read from the owner's own state
  assert.deepEqual(await OWNER.ev(`(window.Steward.stewardCaps() || {})[${JSON.stringify(hpub)}]`), ['finance'], 'the helper was granted something other than exactly Finance');
  assert.deepEqual(h.errors, [], 'the helper console threw:\n  ' + h.errors.join('\n  '));
});
