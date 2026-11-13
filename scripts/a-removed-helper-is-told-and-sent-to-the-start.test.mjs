// A HELPER THE CHURCH REMOVES IS TOLD SO, AND SENT BACK TO THE START — BUT ONLY ON A REAL REMOVAL.
//   Run: node --test scripts/a-removed-helper-is-told-and-sent-to-the-start.test.mjs
//
// OWNER DEVICE TEST 2026-11-13 (integration 69dd2d98): "Revoke works, but we need a prompt on the revoked account, the
// church resets to 'your church' it should automatically tell the user they were removed and lead them back to the
// 'start a church' screen." The removed helper's console evicted the church (the church-signed stewardrevoke: notice)
// and fell back to its own BLANK signing key — an empty dashboard titled "your church", with nothing said.
//
// THE FIX. subscribeStewardedChurches records the removal (Steward.removedNotices) when — and only when — a SIGNED
// removal was read and every relay in that read had answered; StewardRoot shows "You've been removed from <church>" in
// place of the empty console when the helper has nothing else to run (Steward.removedLeavesNothing), and Continue
// discards the bare helper key so the start screen ("Start a new church" / "Help run a church") comes up.
//
// POINT OF USE (CLAUDE.md rules 1 and 3). A real gateway on a free port; the owner's real console made through the real
// wizard (new-church-session.mjs); two helpers in SEPARATE headless chromium profiles who ask through the real welcome
// screen, set a PIN, and are approved and later removed through the owner's real Helpers page. What each person sees is
// read from their own DOM. Nothing here matches text in app/*.jsx. Live relays are blackholed. Skips without chromium.
//
// THE CONTROLS. (1) A helper whose relay is UNREACHABLE when the removal happens — and who reloads, so the cached list
// paints with nothing to confirm it — is NOT told anything and still sees the church: an absent read is not a removal.
// The block is checked to be real (the console never logs in), so the control cannot pass vacuously. When the relay is
// reachable again, the same console IS told. (2) A helper still on the roster when another is removed is not told.
// (3) The owner's console never shows the notice.
//
// ⚠ NOT A CODE FAILURE: chromium here is a snap (see CLAUDE.md, "Browser tests leak 171MB"); run-tests sweeps it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { openNewChurch, CHROME, PIN, sleep, H, typeInto, typePh } from './new-church-session.mjs';

const REVOKE_D = 'trinityone/stewardrevoke:';
const CHURCH_NAME = 'First Session Church';   // what new-church-session.mjs names the owner's church
const HELPER_PIN = 'helper-lamp-harbour-9';

let OWNER = null, ONE = null, TWO = null;
let invite = '';

// ── a helper's console: a fresh chromium profile on the same relay, nothing shared with the owner ─────────────────────
async function openConsole(relay, tag) {
  const cdp = await H.freePort('a helper console Chrome debug port');
  const prof = mkdtempSync(join(tmpdir(), 'trin-rmh-' + tag + '-chr-'));
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
  let id = 0; const pend = new Map();
  const s = { tag, relayFramesIn: 0 };
  const wsIds = new Set();
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.method === 'Network.webSocketCreated' && /\/relay/.test(m.params.url || '')) wsIds.add(m.params.requestId);
    if (m.method === 'Network.webSocketFrameReceived' && wsIds.has(m.params.requestId)) s.relayFramesIn++;
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Network.enable'); await send('Page.enable');
  s.send = send;
  s.ev = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error(`in-page(${tag}): ` + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };
  s.text = () => s.ev(`document.body.innerText.replace(/\\n/g,' / ')`);
  s.waitFor = async (expr, ms = 60000, label = expr) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await s.ev(expr)) return true; } catch {} await sleep(300); } let said = ''; try { said = String(await s.text()).slice(0, 900); } catch {} throw new Error(`${tag} timed out waiting for: ` + label + ' — the screen says: ' + said); };
  s.press = async (re, label) => { const r = await s.ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`); if (r !== 'ok') throw new Error(`nothing on ${tag}'s screen matched ` + (label || re)); await sleep(400); };
  // THE RELAY MADE UNREACHABLE for this console alone, from its next load: every socket it opens to the box is sent to
  // a closed port instead, so the connection is refused exactly as a relay that is down refuses it. (CDP's
  // Network.setBlockedURLs does not stop WebSockets — measured: 378 relay frames still arrived through it.)
  let blockId = null;
  s.blockRelay = async (on) => {
    if (blockId) { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: blockId }); blockId = null; }
    if (!on) return;
    const r = await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const want = ${JSON.stringify(relay.wsUrl)}; const W = window.WebSocket;
      window.WebSocket = class extends W { constructor(u, ...rest) { super(String(u).startsWith(want) ? 'ws://127.0.0.1:9/relay' : u, ...rest); } }; })();` });
    blockId = r?.result?.identifier || null;
    if (!blockId) throw new Error('could not install the relay block in ' + tag);
  };
  s.close = () => { try { ws.close(); } catch {} try { chr.kill('SIGKILL'); } catch {} setTimeout(() => { try { rmSync(prof, { recursive: true, force: true }); } catch {} }, 600); };
  await s.waitFor(`[...document.querySelectorAll('button')].some(x => /Start a new church/i.test((x.textContent||'').trim()))`, 90000, 'the welcome screen');
  return s;
}

// The real welcome-screen path: Help run a church → the invite → a name → Send → a PIN → the waiting screen.
async function becomeHelper(s, name) {
  await s.press(/^Help run a church$/, 'Help run a church');
  await s.waitFor(`!!document.querySelector('input[aria-label="Church invite code"]')`, 30000, 'the invite step');
  // STAGING, as in a-helper-request-carries-the-persons-own-name: this box does not host the helper's bare key, so the
  // console would publish to the shipped community relays (blackholed here). Put the box in the helper's relay list.
  await s.ev(`(() => { localStorage.setItem('trinityone.steward.extra-relays', JSON.stringify([${JSON.stringify(OWNER.relay.wsUrl)}])); return 1; })()`);
  await s.waitFor(`window.Steward.relayList().length > 0`, 30000, 'the helper console to prove the box');
  await s.ev(typeInto('input[aria-label="Church invite code"]', invite));
  await sleep(300);
  await s.press(/^Next$/, 'Next');
  await s.waitFor(`!!document.querySelector('input[aria-label="Your name"]')`, 10000, 'the name step');
  await s.ev(typeInto('input[aria-label="Your name"]', name));
  await sleep(300);
  await s.press(/^Send$/, 'Send');
  await s.waitFor(`/Request sent/.test(document.body.innerText)`, 30000, 'the "Request sent" state');
  await s.press(/^Set a PIN & continue/, 'Set a PIN & continue');
  await s.waitFor(`!!document.querySelector('input[aria-label="Choose a console PIN or passphrase"]')`, 10000, 'the helper PIN step');
  await s.ev(typeInto('input[aria-label="Choose a console PIN or passphrase"]', HELPER_PIN));
  await sleep(300);
  await s.press(/Set PIN & enter/, 'Set PIN & enter');
  await s.waitFor(`/Waiting for/.test(document.body.innerText)`, 60000, 'the waiting-for-approval screen');
  s.pub = await s.ev(`window.Steward.pubkey`);
  s.npub = await s.ev(`window.Steward.npub`);
}

async function toHelpers(s) {
  await s.press(/^Settings$/, 'Settings');
  const ROW = `[...document.querySelectorAll('button')].some(x=>/^Helpers *Let someone help/.test((x.textContent||'').trim()))`;
  if (!(await s.ev(ROW))) await s.ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/^Helpers/i.test((x.textContent||'').trim()) && !/Let someone/.test(x.textContent||'')); if(b) b.click(); return 1; })()`);
  await s.waitFor(ROW, 30000, 'the Helpers settings row');
  await s.press(/^Helpers\s*Let someone help/, 'the Helpers settings row');
  await s.waitFor(`/Invite|helper/i.test(document.body.innerText)`, 30000, 'the Helpers page');
  await sleep(600);
}

// The owner approves this helper's request on the real Helpers page (the approve sheet asks for the owner's PIN).
async function approve(h, name) {
  await toHelpers(OWNER);
  const np = JSON.stringify(h.npub);
  const ROWBTN = `[...document.querySelectorAll('div')].filter(d=>(d.innerText||'').includes(${np}) && (d.innerText.match(/npub1/g)||[]).length===1 && /Approve/.test(d.innerText)).sort((a,b)=>a.innerText.length-b.innerText.length).map(d=>[...d.querySelectorAll('button')].find(x=>/^Approve/.test((x.textContent||'').trim())))[0]`;
  await OWNER.waitFor(`!!(${ROWBTN})`, 45000, 'the request row for ' + name);
  await OWNER.ev(`(() => { (${ROWBTN}).click(); return 1; })()`);
  await OWNER.waitFor(`!!document.querySelector('input[aria-label="Your console PIN, to confirm this"]')`, 10000, 'the approve sheet');
  await OWNER.ev(typeInto('input[aria-label="The helper’s name, as you know them"]', name));
  await OWNER.ev(typeInto('input[aria-label="Your console PIN, to confirm this"]', PIN));
  await sleep(300);
  await OWNER.press(/^Approve as helper$/, 'Approve as helper');
  await h.waitFor(`window.Steward.actingChurch === ${JSON.stringify(OWNER.churchPub)}`, 90000, name + '\'s console opening the church');
}

// The owner removes this helper on the real Helpers page, and the church-signed notice reaches the relay.
async function removeHelper(h) {
  await toHelpers(OWNER);
  const tag = JSON.stringify(h.pub.slice(0, 10));
  const r1 = await OWNER.ev(`(() => { const rows=[...document.querySelectorAll('div')].filter(d=>(d.innerText||'').includes(${tag}) && [...d.querySelectorAll('button')].some(b=>b.title==='Revoke this helper')).sort((a,b)=>a.innerText.length-b.innerText.length);
    const b=rows[0] && [...rows[0].querySelectorAll('button')].find(x=>x.title==='Revoke this helper'); if(!b) return 'miss'; b.click(); return 'ok'; })()`);
  assert.equal(r1, 'ok', 'no Revoke control on the owner\'s row for ' + h.tag);
  await sleep(400);
  const r2 = await OWNER.ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.title==='Confirm — revoke this helper immediately'); if(!b) return 'miss'; b.click(); return 'ok'; })()`);
  assert.equal(r2, 'ok', 'no confirm control for removing ' + h.tag);
  const t0 = Date.now(); let ok = false;
  while (!ok && Date.now() - t0 < 45000) { ok = OWNER.rows(`kind = 30078 AND dtag = '${REVOKE_D + h.pub}'`).some(r => r.e.content && r.e.pubkey === OWNER.churchPub); if (!ok) await sleep(400); }
  assert.ok(ok, 'the owner\'s removal of ' + h.tag + ' never reached the relay');
}

async function reloadAndUnlock(h) {
  await h.ev(`(() => { location.reload(); return 1; })()`);
  await sleep(2500);
  await h.waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('Your PIN or passphrase'))`, 90000, 'the unlock screen');
  await h.ev(typePh('Your PIN or passphrase', HELPER_PIN));
  await h.press(/^Unlock/, 'Unlock');
  await h.waitFor(`!!(window.Steward && window.Steward.hasKey && !window.Steward.locked)`, 30000, 'the console unlocked');
}

const TOLD = `/You.ve been removed/.test(document.body.innerText)`;
const notices = (s) => s.ev(`JSON.stringify(window.Steward.removedNotices ? window.Steward.removedNotices() : null)`);

before(async () => {
  if (!CHROME) return;
  OWNER = await openNewChurch({ wizard: 'skip', name: 'rmhelp' });
  await OWNER.waitFor(`!!(window.Steward && window.Steward.relayAuthed && window.Steward.relayAuthed())`, 60000, 'the owner logged in');
  invite = await OWNER.ev(`window.Steward.stewardInvitePayload()`);
  assert.ok(/^trinityone-stewardinvite:npub1/.test(invite), 'staging: the owner console gave no invite');
});
after(() => { try { ONE && ONE.close(); } catch {} try { TWO && TWO.close(); } catch {} try { OWNER && OWNER.close(); } catch {} H.stopAll(); });
const SKIP = !CHROME ? 'no chromium' : false;

test('staging: two helpers ask through the welcome screen and the owner approves both', { skip: SKIP, timeout: 480000 }, async () => {
  ONE = await openConsole(OWNER.relay, 'one');
  await becomeHelper(ONE, 'Ruth Helper');
  TWO = await openConsole(OWNER.relay, 'two');
  await becomeHelper(TWO, 'Sam Helper');
  await approve(ONE, 'Ruth Helper');
  await approve(TWO, 'Sam Helper');
  await ONE.waitFor(`document.body.innerText.includes(${JSON.stringify(CHURCH_NAME)})`, 45000, 'Ruth\'s console showing the church');
  await TWO.waitFor(`document.body.innerText.includes(${JSON.stringify(CHURCH_NAME)})`, 45000, 'Sam\'s console showing the church');
  assert.equal(await ONE.ev(TOLD), false, 'an approved helper is told they were removed');

});

test('CONTROL setup: Sam\'s relay goes unreachable and his console reloads — it paints the church from cache and says nothing', { skip: SKIP, timeout: 240000 }, async () => {
  await TWO.blockRelay(true);
  await reloadAndUnlock(TWO);
  TWO.relayFramesIn = 0;
  await sleep(8000);
  assert.equal(TWO.relayFramesIn, 0, 'staging: the block is not real — Sam\'s console still hears the relay');
  assert.equal(await TWO.ev(`!!(window.Steward.relayAuthed && window.Steward.relayAuthed())`), false, 'staging: Sam\'s console logged in through the block');
  assert.equal(await TWO.ev(TOLD), false, 'a helper whose relay is unreachable was told they were removed');
});

test('THE FEATURE, live: the owner removes Ruth while her console is open — she is told, by church name, in place of the empty console', { skip: SKIP, timeout: 240000 }, async () => {
  await removeHelper(ONE);
  await ONE.waitFor(TOLD, 60000, 'Ruth being told she was removed');
  const t = await ONE.text();
  assert.ok(t.includes('You’ve been removed from ' + CHURCH_NAME), 'the notice does not name the church: ' + t.slice(0, 400));
  assert.ok(/Continue/.test(t), 'the notice has no way on: ' + t.slice(0, 400));
  assert.equal(await ONE.ev(`[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Settings')`), false, 'the empty console is still on screen behind the notice');
  assert.equal(await TWO.ev(TOLD), false, 'CONTROL: Sam, still on the roster, was told about a removal');
});

test('Continue takes Ruth to the start screen, with no key left on the device; the owner never sees the notice', { skip: SKIP, timeout: 120000 }, async () => {
  await ONE.press(/^Continue$/, 'Continue');
  await ONE.waitFor(`[...document.querySelectorAll('button')].some(x => /Start a new church/i.test((x.textContent||'').trim())) && [...document.querySelectorAll('button')].some(x => /^Help run a church$/.test((x.textContent||'').trim()))`, 30000, 'the start screen');
  assert.equal(await ONE.ev(`!!window.Steward.hasKey`), false, 'the helper key is still on the device');
  assert.equal(await ONE.ev(`localStorage.getItem('trinityone.steward.church-key.enc')`), null, 'the encrypted helper key is still stored');
  await OWNER.press(/^Overview$/, 'Overview');
  await sleep(1500);
  assert.equal(await OWNER.ev(TOLD), false, 'the owner\'s console shows the removal notice');
  assert.equal(await notices(OWNER), '[]', 'the owner\'s console holds a removal notice');
});

test('CONTROL: Sam is removed while his relay is unreachable — a reload paints the church and tells him NOTHING', { skip: SKIP, timeout: 240000 }, async () => {
  await removeHelper(TWO);
  await reloadAndUnlock(TWO);
  TWO.relayFramesIn = 0;
  await sleep(15000);
  assert.equal(TWO.relayFramesIn, 0, 'staging: the block is not real — Sam\'s console heard the relay');
  assert.equal(await TWO.ev(TOLD), false, 'THE HAZARD: a helper was told they were removed from an absent read');
  assert.equal(await notices(TWO), '[]', 'a removal was recorded with no read behind it');
  assert.equal(await TWO.ev(`window.Steward.actingChurch`), OWNER.churchPub, 'the cached church was dropped with no read behind it');
});

test('…and the same console, its relay back, IS told and taken to the start screen', { skip: SKIP, timeout: 240000 }, async () => {
  await TWO.blockRelay(false);
  await reloadAndUnlock(TWO);
  await TWO.waitFor(TOLD, 90000, 'Sam being told, once the relay can answer');
  assert.ok((await TWO.text()).includes('You’ve been removed from ' + CHURCH_NAME), 'the notice does not name the church');
  await TWO.press(/^Continue$/, 'Continue');
  await TWO.waitFor(`[...document.querySelectorAll('button')].some(x => /Start a new church/i.test((x.textContent||'').trim()))`, 30000, 'the start screen');
  assert.equal(await OWNER.ev(TOLD), false, 'the owner\'s console shows the removal notice');
});
