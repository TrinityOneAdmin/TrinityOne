// A REQUEST TO HELP RUN A CHURCH CARRIES THE NAME THE PERSON GAVE — NOT A BLANK, AND NOT THEIR OWN CHURCH'S NAME.
//   Run: node --test scripts/a-helper-request-carries-the-persons-own-name.test.mjs
//   (HELPERNAME_SHOTS=<dir> also saves screenshots — desktop 1280 wide and phone 390 wide — of each step of the two
//   request screens, and the owner's request row.)
//
// OWNER-CONFIRMED 2026-11-12. requestSteward sealed `lastProfile.name` as the requester's name — but lastProfile is
// the console's cached CHURCH profile, not the person. So:
//   • a brand-new helper asking from the welcome screen always sent an empty name (the owner saw only the invented
//     name generated from the key), and
//   • someone who already runs a church, asking from Settings → Help run a church, sent THEIR CHURCH's name — the
//     owner saw "claims to be 'Trinity Church Littlehampton'".
// Neither screen asked the person for their name.
//
// THE FIX. Both screens ask for the person's name, prefilled from their own "Your name as a steward" (if they have
// one), and requestSteward(payload, name) seals THAT, still NIP-44 to the church key. An empty name is refused before
// anything is sent. The owner's Helpers page shows the given name first, with the invented name and the key underneath.
// THE ORDER (owner 2026-11-12): the invite first — scanned or pasted, with no name box and nothing blocking the
// camera — then, only for an invite that checks out, a second step "Your name" with Send and Back. An invalid invite
// shows its error on the first step and never reaches the name step.
//
// POINT OF USE (CLAUDE.md rules 1 and 3). A real gateway on a free port; the owner's real console made through the
// real wizard (new-church-session.mjs); the helpers are SEPARATE headless chromium profiles on the same relay, driving
// the real welcome screen and the real Settings page. What the owner sees is read from the owner's DOM; what was sent
// is read from the relay's own database. Nothing here matches text in app/*.jsx. Live relays are blackholed with
// host-resolver-rules, as in new-church-session.mjs. Skips without chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { openNewChurch, CHROME, PIN, sleep, H, typeInto, typePh } from './new-church-session.mjs';

const STEWARDREQ_D = 'trinityone/stewardreq:';
const SHOTS = process.env.HELPERNAME_SHOTS || '';
const NEW_HELPER_NAME = 'Ruth Bellamy';
const OTHER_CHURCH_NAME = 'Trinity Church Littlehampton';
const STEWARD_NAME = 'Margaret Hoyle';

let OWNER = null, NEWBIE = null, OTHER = null;
let invite = '';

// ── a second (third) console on the SAME relay: a fresh chromium profile, nothing shared with the owner ─────────────
async function openConsole(relay, tag) {
  const cdp = await H.freePort('a helper console Chrome debug port');
  const prof = mkdtempSync(join(tmpdir(), 'trin-hname-' + tag + '-chr-'));
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
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  const s = { send };
  s.ev = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error(`in-page(${tag}): ` + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };
  s.waitFor = async (expr, ms = 60000, label = expr) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await s.ev(expr)) return true; } catch {} await sleep(300); } let said = ''; try { said = String(await s.text()).slice(0, 900); } catch {} throw new Error(`${tag} timed out waiting for: ` + label + ' — the screen says: ' + said); };
  s.press = async (re, label) => { const r = await s.ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`); if (r !== 'ok') throw new Error(`nothing on ${tag}'s screen matched ` + (label || re)); await sleep(400); };
  s.text = () => s.ev(`document.body.innerText.replace(/\\n/g,' / ')`);
  s.close = () => { try { ws.close(); } catch {} try { chr.kill('SIGKILL'); } catch {} setTimeout(() => { try { rmSync(prof, { recursive: true, force: true }); } catch {} }, 600); };
  await s.waitFor(`[...document.querySelectorAll('button')].some(x => /Start a new church/i.test((x.textContent||'').trim()))`, 90000, 'the welcome screen');
  return s;
}

// Desktop, then (unless `phone: false`) the same screen at phone width. Settings must pass `phone: false`: at phone
// width Settings becomes a list and the open page — with the step it was on — closes; its phone shots are a separate
// pass at the end of the Settings test.
async function shot(s, name, { phone = true } = {}) {
  if (!SHOTS) return;
  try {
    mkdirSync(SHOTS, { recursive: true });
    const r = await s.send('Page.captureScreenshot', { format: 'png' });
    if (r?.result?.data) writeFileSync(join(SHOTS, name + '-desktop.png'), Buffer.from(r.result.data, 'base64'));
    if (!phone) return;
    await s.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(500);
    const p = await s.send('Page.captureScreenshot', { format: 'png' });
    if (p?.result?.data) writeFileSync(join(SHOTS, name + '-phone.png'), Buffer.from(p.result.data, 'base64'));
  } catch {} finally { try { await s.send('Emulation.clearDeviceMetricsOverride'); await sleep(400); } catch {} }
}

// Make a church in a helper console through the real wizard — the same steps new-church-session.mjs drives.
async function makeChurch(s, name) {
  await s.press(/Start a new church/i);
  await s.waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('At least 8'))`, 60000, 'the PIN box');
  await s.ev(typePh('At least 8', PIN)); await s.ev(typePh('Type it again', PIN));
  await s.press(/Set PIN/i);
  await s.waitFor(`!!document.querySelector('input[aria-label="Church name"]')`, 90000, 'the wizard name step');
  const mnemonic = await s.ev(`window.Steward.exportMnemonic()`);
  await s.ev(typeInto('input[aria-label="Church name"]', name));
  await s.press(/^Continue$/);
  await s.waitFor(`/12 words are your church/.test(document.body.innerText)`, 60000, 'the recovery step');
  await s.ev(`(() => { const i=document.querySelector('input[type=checkbox]'); if(!i.checked) i.click(); return 1; })()`);
  await sleep(500); await s.press(/^Continue$/);
  await s.waitFor(`/Quick check/.test(document.body.innerText)`, 30000, 'the quick check');
  const words = mnemonic.split(' ');
  await s.ev(`(() => { const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; const words=${JSON.stringify(words)}; const nums=[...document.body.innerText.matchAll(/WORD #(\\d+)/g)].map(m=>Number(m[1])); const ins=[...document.querySelectorAll('input')].filter(i=>i.type==='text').slice(0,3); ins.forEach((i,k)=>{set.call(i,words[nums[k]-1]); i.dispatchEvent(new Event('input',{bubbles:true}));}); return ins.length; })()`);
  await sleep(500); await s.press(/^Continue$/);
  await s.waitFor(`/Create a few spaces/.test(document.body.innerText)`, 30000, 'the rooms step');
  await s.press(/^Skip setup$/);
  await s.waitFor(`[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Settings') && !document.querySelector('[data-stew-modal-panel]') && !/Skip setup/.test(document.body.innerText)`, 30000, 'the dashboard');
}

// Open a Settings page by its row (title + description), unfolding its group first if it is folded.
async function toSettingsPage(s, rowRe, groupName, readyExpr) {
  await s.press(/^Settings$/, 'Settings');
  const ROW = `[...document.querySelectorAll('button')].some(x=>${rowRe}.test((x.textContent||'').trim()))`;
  if (!(await s.ev(ROW))) await s.ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>new RegExp('^'+${JSON.stringify(groupName)},'i').test((x.textContent||'').trim()) && !${rowRe}.test((x.textContent||'').trim())); if(b) b.click(); return 1; })()`);
  await s.waitFor(ROW, 30000, 'the settings row ' + rowRe);
  await s.press(rowRe, 'the settings row ' + rowRe);
  await s.waitFor(readyExpr, 30000, 'the settings page ' + rowRe);
  await sleep(600);
}
const toHelpers = (s) => toSettingsPage(s, /^Helpers\s*Let someone help/, 'Helpers', `/Invite|helper/i.test(document.body.innerText)`);
const toHelpOthers = (s) => toSettingsPage(s, /^Help run a church\s*Help another church/, 'Helpers', `!!document.querySelector('input[aria-label="Church invite code"]')`);

// The owner's request row for this npub: the innermost block that names that npub and no other.
const rowText = (np) => `(() => { const els=[...document.querySelectorAll('div')].filter(d=>(d.innerText||'').includes(${JSON.stringify(np)}) && (d.innerText.match(/npub1/g)||[]).length===1 && /Approve/.test(d.innerText));
  if(!els.length) return ''; els.sort((a,b)=>a.innerText.length-b.innerText.length); return els[0].innerText; })()`;
const reqRowsFrom = (pubHex) => OWNER.rows(`kind = 30078 AND dtag = '${STEWARDREQ_D + OWNER.churchPub}'`).filter(r => r.e.pubkey === pubHex);
const setNameField = (s, v) => s.ev(typeInto('input[aria-label="Your name"]', v));
const hasNameStep = (s) => s.ev(`!!document.querySelector('input[aria-label="Your name"]')`);
const BAD_INVITE = 'trinityone-stewardinvite:npub1notachurch';
const fieldValue = (s) => s.ev(`(() => { const i=document.querySelector('input[aria-label="Your name"]'); return i ? i.value : null; })()`);

before(async () => {
  if (!CHROME) return;
  // A box that offers to host other churches (Settings → "Offer to host other churches"; the community relays are
  // all like this), so church A in the third test can register on the same relay as the owner's church B.
  process.env.RELAY_OPEN = '1';
  OWNER = await openNewChurch({ wizard: 'skip', name: 'hname' });
  await OWNER.waitFor(`!!(window.Steward && window.Steward.relayAuthed && window.Steward.relayAuthed())`, 60000, 'the owner logged in');
  invite = await OWNER.ev(`window.Steward.stewardInvitePayload()`);
  assert.ok(/^trinityone-stewardinvite:npub1/.test(invite), 'staging: the owner console gave no invite');
});
after(() => { try { NEWBIE && NEWBIE.close(); } catch {} try { OTHER && OTHER.close(); } catch {} try { OWNER && OWNER.close(); } catch {} H.stopAll(); });
const SKIP = !CHROME ? 'no chromium' : false;

test('welcome screen: the invite step has no name box, and an invalid invite never reaches the name step', { skip: SKIP, timeout: 240000 }, async () => {
  NEWBIE = await openConsole(OWNER.relay, 'new');
  await NEWBIE.press(/^Help run a church$/, 'Help run a church');
  await NEWBIE.waitFor(`!!document.querySelector('input[aria-label="Church invite code"]')`, 30000, 'the invite step');
  // STAGING, NOT THE FEATURE: this box does not host the helper's bare key (its /config says so), so the console
  // drops the box and publishes to the shipped community relays — which this test blackholes. In production a
  // helper's console IS served by the community relay, so it reaches the owner there. Here the box is put in the
  // helper's own relay list (the relay panel's store) and the test waits until it has proved itself.
  await NEWBIE.ev(`(() => { localStorage.setItem('trinityone.steward.extra-relays', JSON.stringify([${JSON.stringify(OWNER.relay.wsUrl)}])); return 1; })()`);
  await NEWBIE.waitFor(`window.Steward.relayList().length > 0`, 30000, 'the helper console to prove the box');
  assert.equal(await hasNameStep(NEWBIE), false, 'the invite step shows a "Your name" box — the name must come after the invite');
  await shot(NEWBIE, 'welcome-1-invite-step');
  await NEWBIE.ev(typeInto('input[aria-label="Church invite code"]', BAD_INVITE));
  await sleep(300);
  await NEWBIE.press(/^Next$/, 'Next');
  await sleep(600);
  assert.equal(await hasNameStep(NEWBIE), false, 'an invalid invite reached the name step');
  assert.ok(/doesn.t look like a church invite/i.test(await NEWBIE.text()), 'no error for an invalid invite on the invite step');
  assert.ok(await NEWBIE.ev(`!!document.querySelector('input[aria-label="Church invite code"]')`), 'the invite box is gone after an invalid invite');
});

test('welcome screen: a valid invite asks for a name; Send with no name is refused and nothing reaches the relay', { skip: SKIP, timeout: 240000 }, async () => {
  await NEWBIE.ev(typeInto('input[aria-label="Church invite code"]', invite));
  await sleep(300);
  await NEWBIE.press(/^Next$/, 'Next');
  await NEWBIE.waitFor(`!!document.querySelector('input[aria-label="Your name"]')`, 10000, 'the name step');
  assert.equal(await NEWBIE.ev(`!!document.querySelector('input[aria-label="Church invite code"]')`), false, 'the name step still shows the invite box');
  assert.equal(await fieldValue(NEWBIE), '', 'the name box is not empty for a brand-new helper');
  await NEWBIE.press(/^Send$/, 'Send');
  await sleep(2500);
  const me = await NEWBIE.ev(`window.Steward.pubkey`);
  assert.ok(/^[0-9a-f]{64}$/.test(me || ''), 'staging: the helper console holds no key');
  assert.equal(reqRowsFrom(me).length, 0, 'THE BUG: a request with an empty name was sent');
  const t = await NEWBIE.text();
  assert.ok(!/Request sent/.test(t), 'the screen says "Request sent" over a request that was refused');
  assert.ok(/Add your name first/.test(t), 'no plain error about the name: ' + t.slice(0, 600));
  assert.equal(await hasNameStep(NEWBIE), true, 'the refusal left the name step');
  await shot(NEWBIE, 'welcome-3-empty-name-error');
});

test('a new helper types a name on the welcome screen, sends, and the owner\'s Helpers page shows THAT name first', { skip: SKIP, timeout: 240000 }, async () => {
  await setNameField(NEWBIE, NEW_HELPER_NAME);
  await sleep(300);
  await shot(NEWBIE, 'welcome-2-name-step');
  await NEWBIE.press(/^Send$/, 'Send');
  await NEWBIE.waitFor(`/Request sent/.test(document.body.innerText)`, 30000, 'the "Request sent" state');
  await shot(NEWBIE, 'welcome-4-request-sent');
  const me = await NEWBIE.ev(`window.Steward.pubkey`);
  const np = await NEWBIE.ev(`window.Steward.npub`);
  const rows = reqRowsFrom(me);
  assert.equal(rows.length, 1, 'the request never reached the relay');
  assert.ok(!rows[0].e.content.includes(NEW_HELPER_NAME), 'the name was written to the relay in the clear');
  assert.equal(typeof JSON.parse(rows[0].e.content).n, 'string', 'the request is not in the sealed {n} shape');

  await toHelpers(OWNER);
  await OWNER.waitFor(`${rowText(np)}.length > 0`, 45000, 'the new helper\'s request row on the owner\'s Helpers page');
  const row = await OWNER.ev(rowText(np));
  assert.ok(row.includes(NEW_HELPER_NAME), 'THE BUG: the owner does not see the name the helper typed. Row: ' + row);
  const nice = await OWNER.ev(`window.Steward.stewardName(${JSON.stringify(me)})`);
  assert.ok(nice && row.includes(nice), 'the invented name is no longer on the row. Row: ' + row);
  assert.ok(row.indexOf(NEW_HELPER_NAME) < row.indexOf(nice), 'the given name is not shown first, above the invented name. Row: ' + row);
  await OWNER.ev(`(() => { const els=[...document.querySelectorAll('div')].filter(d=>(d.innerText||'').includes(${JSON.stringify(np)}) && (d.innerText.match(/npub1/g)||[]).length===1 && /Approve/.test(d.innerText)); els.sort((a,b)=>a.innerText.length-b.innerText.length); if(els[0]) els[0].scrollIntoView({block:'center'}); return 1; })()`);
  await sleep(300);
  await shot(OWNER, 'owner-request-row');
  NEWBIE.close(); NEWBIE = null;
});

test('someone who runs church A asks to help church B from Settings: invite first, then their name — B\'s owner sees the PERSON\'s name, never church A\'s', { skip: SKIP, timeout: 420000 }, async () => {
  OTHER = await openConsole(OWNER.relay, 'other');
  await makeChurch(OTHER, OTHER_CHURCH_NAME);
  await OTHER.waitFor(`!!(window.Steward && window.Steward.relayAuthed && window.Steward.relayAuthed())`, 60000, 'church A logged in');
  // staging for the bug: church A's profile (its name) is loaded in this console — what the old code sealed
  await OTHER.waitFor(`document.body.innerText.includes(${JSON.stringify(OTHER_CHURCH_NAME)})`, 30000, 'church A\'s name on its own dashboard');
  // the person's own name, set the ordinary way: Settings → Your name as a steward
  await toSettingsPage(OTHER, /^Your name as a steward\s*Under every notice/, 'People', `!!document.querySelector('input[aria-label="Your role"]')`);
  await setNameField(OTHER, STEWARD_NAME);
  await OTHER.press(/^Save$/, 'Save');
  await sleep(800);
  await toHelpOthers(OTHER);
  // step 1: the invite, with no name box
  assert.equal(await hasNameStep(OTHER), false, 'the Settings invite step shows a "Your name" box — the name must come after the invite');
  await shot(OTHER, 'settings-1-invite-step', { phone: false });
  await OTHER.ev(typeInto('input[aria-label="Church invite code"]', BAD_INVITE));
  await sleep(300);
  await OTHER.press(/^Next$/, 'Next');
  await sleep(600);
  assert.equal(await hasNameStep(OTHER), false, 'an invalid invite reached the name step on Settings');
  assert.ok(/doesn.t look like a church invite/i.test(await OTHER.text()), 'no error for an invalid invite on the Settings invite step');
  // step 2: a valid invite asks for the name, prefilled with the person's own steward name
  await OTHER.ev(typeInto('input[aria-label="Church invite code"]', invite));
  await sleep(300);
  await OTHER.press(/^Next$/, 'Next');
  await OTHER.waitFor(`!!document.querySelector('input[aria-label="Your name"]')`, 10000, 'the Settings name step');
  assert.equal(await fieldValue(OTHER), STEWARD_NAME, 'the "Your name" field is not prefilled with the person\'s own steward name');
  const me = await OTHER.ev(`window.Steward.pubkey`);
  const np = await OTHER.ev(`window.Steward.npub`);
  // an emptied name is refused here too, and nothing is published
  await setNameField(OTHER, '');
  await sleep(300);
  await OTHER.press(/^Send$/, 'Send');
  await sleep(2500);
  assert.equal(reqRowsFrom(me).length, 0, 'THE BUG: Settings sent a request with an empty name');
  assert.ok(/Add your name first/.test(await OTHER.text()), 'no plain error about the name on Settings');
  assert.ok(!/Request sent/.test(await OTHER.text()), 'Settings says "Request sent" over a refused request');
  await shot(OTHER, 'settings-3-empty-name-error', { phone: false });
  await setNameField(OTHER, STEWARD_NAME);
  await sleep(300);
  await shot(OTHER, 'settings-2-name-step', { phone: false });
  await OTHER.press(/^Send$/, 'Send');
  await OTHER.waitFor(`/Request sent/.test(document.body.innerText)`, 30000, 'the "Request sent" message');
  await shot(OTHER, 'settings-4-request-sent', { phone: false });
  assert.equal(reqRowsFrom(me).length, 1, 'church A\'s request never reached the relay');

  await toHelpers(OWNER);
  await OWNER.waitFor(`${rowText(np)}.length > 0`, 45000, 'church A\'s request row on church B\'s Helpers page');
  const row = await OWNER.ev(rowText(np));
  assert.ok(!row.includes(OTHER_CHURCH_NAME), 'THE BUG: church B\'s owner sees church A\'s NAME as the person asking. Row: ' + row);
  assert.ok(row.includes(STEWARD_NAME), 'church B\'s owner does not see the person\'s own name. Row: ' + row);

  // SCREENSHOTS ONLY (HELPERNAME_SHOTS): the same Settings steps at phone width. Asserts nothing new; a second Send
  // replaces the same request (one replaceable document per church).
  if (SHOTS) {
    await OTHER.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    try {
      await sleep(800);
      await OTHER.press(/^Help run a church\s*Help another church/, 'the Help run a church row (phone)');
      await OTHER.waitFor(`!!document.querySelector('input[aria-label="Church invite code"]')`, 15000, 'the invite step (phone)');
      await sleep(500);
      const snap = async (name) => { const r = await OTHER.send('Page.captureScreenshot', { format: 'png' }); if (r?.result?.data) writeFileSync(join(SHOTS, name + '-phone.png'), Buffer.from(r.result.data, 'base64')); };
      await snap('settings-1-invite-step');
      await OTHER.ev(typeInto('input[aria-label="Church invite code"]', invite)); await sleep(300);
      await OTHER.press(/^Next$/, 'Next (phone)');
      await OTHER.waitFor(`!!document.querySelector('input[aria-label="Your name"]')`, 10000, 'the name step (phone)');
      await snap('settings-2-name-step');
      await setNameField(OTHER, ''); await sleep(300);
      await OTHER.press(/^Send$/, 'Send (phone)'); await sleep(1200);
      await snap('settings-3-empty-name-error');
      await setNameField(OTHER, STEWARD_NAME); await sleep(300);
      await OTHER.press(/^Send$/, 'Send (phone)');
      await OTHER.waitFor(`/Request sent/.test(document.body.innerText)`, 30000, 'the "Request sent" message (phone)');
      await snap('settings-4-request-sent');
    } finally { try { await OTHER.send('Emulation.clearDeviceMetricsOverride'); } catch {} }
  }
});
