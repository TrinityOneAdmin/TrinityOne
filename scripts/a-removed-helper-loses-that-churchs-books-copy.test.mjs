// A CHURCH THAT REMOVES A HELPER TAKES ITS SEALED BOOKS OFF THAT HELPER'S DEVICE — EVEN WHEN IT IS NOT THE CHURCH OPEN.
//   Run: node --test scripts/a-removed-helper-loses-that-churchs-books-copy.test.mjs
//
// T1Finance M4. A console keeps a sealed copy of each church's books in localStorage (FINBOOK_LS + church key) so the
// Finance screen paints before the relay answers. _finBookClear runs on every identity switch and keeps only the church
// switched TO, so a removal from the church being acted for already took that church's copy with it (the switch away).
// A removal from a church the helper is NOT acting for switched nothing, so its copy stayed on the device. The revoke
// branches of subscribeStewardedChurches now drop the removed church's copy by name (_finBookDrop).
// Honest limit (reference/DOMAIN.md): this ends the local copy going forward; it cannot take back what the device held.
//
// POINT OF USE (CLAUDE.md rules 1 & 3). A real gateway on a free port holding two churches, A and B. A real helper in
// headless chromium on finance.html, made through its real welcome ("Help with a church's books" → PIN). A and B each
// publish a real church-signed roster naming that helper with Finance; the console discovers both and opens A. Then B
// removes the helper the way the owner's console does (a roster without them + the church-signed revocation notice,
// which is what the helper's console actually reads — the relay stops serving them the roster) and the assertion is
// the helper's own localStorage. (This drives the notice branch; the roster branch carries the same one-line drop.)
// The two sealed copies are written into localStorage by the test (their contents do not matter here, only whether the
// removal leaves them); everything else is the real engine over a real relay. Live relays are blackholed. Skips
// without chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent } from 'nostr-tools';
import * as H from './relay-network-harness.mjs';
import { CHROME, PIN, sleep, typePh } from './new-church-session.mjs';

const STEWARDS_D = 'trinityone/stewards:', STEWARDREVOKE_D = 'trinityone/stewardrevoke:', NET = 'trinityone';
const FINBOOK = 'trinityone.steward.financebook.';
const A = H.key(), B = H.key();
let relay = null, chr = null, cws = null, prof = '';
const SKIP = !CHROME ? 'no chromium' : false;

const roster = (church, pubkeys, at) => finalizeEvent({ kind: 30078, created_at: at, tags: [['d', STEWARDS_D + church.pub], ['t', NET]],
  content: JSON.stringify({ pubkeys, caps: Object.fromEntries(pubkeys.map(p => [p, ['finance']])) }) }, church.sk);

// what the owner's console publishes on Remove (Steward.publishStewardRevoke): a church-signed notice the removed
// helper can still read — the relay stops serving them the roster itself once they are off it
const revokeNotice = (church, pk, at) => finalizeEvent({ kind: 30078, created_at: at, tags: [['d', STEWARDREVOKE_D + pk], ['t', NET], ['p', pk]],
  content: JSON.stringify({ revoked: pk }) }, church.sk);

let ev = null;
const waitFor = async (expr, ms, label) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch {} await sleep(300); } throw new Error('timed out waiting for ' + label + ' — screen: ' + String(await ev(`(document.body.innerText||'').slice(0,200)`)).replace(/\n/g, ' / ')
  + ' — engine: ' + String(await ev(`JSON.stringify({ relays: (window.Steward.relayList && window.Steward.relayList()) || null, authed: !!(window.Steward.relayAuthed && window.Steward.relayAuthed()), ids: (window.Steward.identities && window.Steward.identities()) || null, acting: window.Steward.actingChurch || '' })`))); };
const press = async (re) => { const r = await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`); assert.equal(r, 'ok', 'nothing on screen matched ' + re); await sleep(400); };

before(async () => {
  if (!CHROME) return;
  relay = await H.startRelay({ name: 'finrm', churches: [A.pub, B.pub], env: { TRINITY_TAILSCALE_BIN: '/nonexistent' } });
  const cdp = await H.freePort('the finance helper Chrome debug port');
  prof = mkdtempSync(join(tmpdir(), 'trin-finrm-chr-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9, MAP *.trycloudflare.com 127.0.0.1:9';
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=420,900', `${relay.base}/finance.html`], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 60 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  cws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { cws.on('open', res); cws.on('error', rej); });
  let id = 0; const pend = new Map();
  cws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); cws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  ev = async (expression) => { const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (rr?.result?.exceptionDetails) throw new Error('in-page: ' + JSON.stringify(rr.result.exceptionDetails).slice(0, 300)); return rr?.result?.result?.value; };
});
after(() => { try { cws && cws.close(); } catch {} try { chr && chr.kill('SIGKILL'); } catch {} try { H.stopAll(); } catch {} setTimeout(() => { try { rmSync(prof, { recursive: true, force: true }); } catch {} }, 600); });

test('a helper removed by a church it is NOT acting for loses that church\'s sealed books — and keeps the open church\'s', { skip: SKIP, timeout: 300000 }, async () => {
  // the helper, made through the finance app's real welcome
  await waitFor(`[...document.querySelectorAll('button')].some(x=>/Help with a church’s books/.test(x.textContent||''))`, 90000, 'the finance welcome');
  await press(/Help with a church’s books/);
  await press(/Set a PIN & continue/);
  assert.equal(await ev(typePh('At least 8', PIN)), 'ok');
  await press(/Set PIN & enter/);
  await waitFor(`!!document.querySelector('[data-finance-shell]')`, 60000, 'the finance shell');
  const me = await ev(`window.Steward.churchPub`);
  assert.match(String(me), /^[0-9a-f]{64}$/, 'no helper key');
  // STAGING, as in a-removed-helper-is-told-and-sent-to-the-start: this box does not host the helper's bare key, so the
  // console would read from the shipped community relays (blackholed here). Put the box in the helper's relay list.
  await ev(`(localStorage.setItem('trinityone.steward.extra-relays', JSON.stringify([${JSON.stringify(relay.wsUrl)}])), 1)`);
  await waitFor(`window.Steward.relayList().length > 0`, 30000, 'the helper console to prove the box');

  // both churches name the helper, with Finance
  const t0 = H.now();
  await H.publishAll(relay, [roster(A, [me], t0), roster(B, [me], t0)]);
  await waitFor(`(window.Steward.identities()||[]).filter(i=>i.kind==='steward').length === 2`, 90000, 'both churches in the helper\'s switcher');
  await ev(`(window.Steward.setActiveIdentity(${JSON.stringify(A.pub)}), 1)`);
  await waitFor(`window.Steward.isDelegated() && window.Steward.actingChurch === ${JSON.stringify(A.pub)}`, 20000, 'the helper acting for church A');

  // a sealed copy of each church's books on this device (A is open; B is not)
  await ev(`(localStorage.setItem(${JSON.stringify(FINBOOK + A.pub)}, '{"s":"sealed-A"}'), localStorage.setItem(${JSON.stringify(FINBOOK + B.pub)}, '{"s":"sealed-B"}'), 1)`);
  await sleep(2500);
  assert.notEqual(await ev(`localStorage.getItem(${JSON.stringify(FINBOOK + B.pub)})`), null, 'CONTROL: B\'s copy vanished before any removal — the test would pass vacuously');

  // church B removes the helper, the way the owner's console does: a roster without them, and the revocation notice
  await H.publishAll(relay, [roster(B, [], t0 + 5), revokeNotice(B, me, t0 + 5)]);
  await waitFor(`(window.Steward.identities()||[]).filter(i=>i.kind==='steward').length === 1`, 90000, 'church B gone from the helper\'s switcher');
  assert.equal(await ev(`window.Steward.actingChurch`), A.pub, 'the console left church A — then the identity switch, not the removal, would be what cleared B');
  await waitFor(`localStorage.getItem(${JSON.stringify(FINBOOK + B.pub)}) === null`, 10000, 'church B\'s sealed books to leave the device');
  assert.notEqual(await ev(`localStorage.getItem(${JSON.stringify(FINBOOK + A.pub)})`), null, 'the OPEN church\'s books were removed too');
});
