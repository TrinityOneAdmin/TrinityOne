// TWO STEWARDS EDITING ONE TEAM'S ROSTER, OVER A REAL RELAY, WITH REAL TIMING.
// Run: node --test scripts/two-stewards-on-one-roster-are-warned-not-overwritten.test.mjs
//
// WHY A SIM AND NOT ANOTHER UNIT TEST. `a0b7a0d` (2026-10-07) deleted the roster-conflict guard from
// `RosterModal` by accident. For two days two stewards editing one team overwrote each other in silence; it
// came back in `bc69232`. `scripts/a-roster-save-notices-someone-elses-change.test.mjs` passes 7/7 and does
// mount the shipped component — but it is IN-PROCESS: it hands the modal a `roster` object with a `ts` the
// test chose, and the publish goes to a stub. The race this guard exists for lives in the two things that
// test cannot have: a round trip through a relay, and a clock. Specifically —
//
//   • `roster.ts` is NOT something the app computes. It is `e.created_at` off the wire (`_subAddr` in
//     src/steward.src.js), in WHOLE SECONDS, and it only reaches the second console because a live
//     subscription delivered the other steward's write. Every link in that chain is outside the unit test.
//   • Newest-wins is to the second (`publishRoster` → kind-30078 replaceable, `created_at: now()`), so two
//     saves inside ONE second are indistinguishable and the guard physically cannot fire. The component says
//     so in a comment. A sim is the only place that limit is observable, so this file measures the gap
//     between the two saves and prints it.
//
// WHAT THIS STANDS UP. One real `scripts/gateway.mjs` on a port obtained by binding (never a fixed number —
// see the audit brief in CLAUDE.md), the real `steward.html` console in headless chromium, a church created
// the real way through its own wizard (`scripts/new-church-session.mjs`), and a SECOND console in a SECOND
// chromium profile which becomes a co-steward the way a real one does: "Restore a church", the 12 words, its
// own console PIN. Two boxes, one church key, one relay. Nothing is seeded behind the UI's back — the trap
// in `sim-seed-through-the-ui` is that a helper which writes state directly skips the sealed publish and
// produces a church no steward could have made, and `roster:` is sealed under the church name key.
//
// THE SHAPE OF THE RUN.
//   A makes the team "Welcome" with two roles          → roster v0
//   A opens the roster.  B opens the SAME roster.      → both forms hold v0
//   A adds Ruth and saves.                             → roster v1 on the relay
//   B adds Sam and looks for Save.
//     ⇒ B must be WARNED, and B's plain Save must be GONE (nothing can be published by accident).
//     ⇒ "Reload their version" must bring RUTH — a name that only ever existed in A's browser — into B's form.
//     ⇒ "Save mine anyway" must publish, and must replace A's version. That is deliberate: B was told.
//
// All three ⇒ lines are the same single guard. Delete it and this file goes red naming the consequence.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { openNewChurch, CHROME, sleep, H, typeInto } from './new-church-session.mjs';

const WARNING = 'Someone else changed this roster after you opened it';
const TEAM = 'Welcome';
const RUTH = 'Ruth Carver';          // A types this one. It exists in no fixture and no test file but this line.
const SAM = 'Sam Oduya';             // B types this one.
const PIN_B = 'second-box-lamp-7714';

let A = null, B = null;
const timing = {};

// ── a second steward's box ────────────────────────────────────────────────────────────────────────────────
// Deliberately NOT a second tab of A's browser: a second tab shares localStorage, so it would share A's key
// store and its cached roster, and "two consoles" would be one console with two Reacts. A separate profile is
// what a second machine is.
async function secondConsole(relay, mnemonic) {
  const cdp = await H.freePort('the second steward console Chrome debug port');
  const prof = mkdtempSync(join(tmpdir(), 'trin-roster-b-chr-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu',
    // Headless parks timers on a page it decides is hidden, which is the second of the two ways a headless
    // sim lies. Without these the console's own subscription callbacks run late enough that "B never saw A's
    // write" becomes a finding about the harness.
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=1280,1200', `${relay.base}/steward.html`], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 60 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
  if (!targets || !targets.length) { try { chr.kill('SIGKILL'); } catch {} throw new Error('the second console never exposed a debug target'); }
  const page = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map(); const errors = []; const frames = []; const urls = new Map();
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.method === 'Runtime.exceptionThrown') { const e = m.params.exceptionDetails; errors.push((e.exception?.description || e.text || '').split('\n')[0]); }
    if (m.method === 'Network.webSocketCreated') urls.set(m.params.requestId, m.params.url);
    // EVERY ROSTER FRAME B SENDS, AND THE RELAY'S ANSWER TO IT. `publishRoster` resolves null only when NO
    // relay accepted, so a form that closes means something answered OK — and that is not the same as the
    // relay having STORED it. Without these frames a write that vanished and a write that was refused look
    // identical from the outside, and this file hit exactly that once.
    if (m.method === 'Network.webSocketFrameSent' || m.method === 'Network.webSocketFrameReceived') {
      if (!String(urls.get(m.params.requestId) || '').includes('127.0.0.1')) return;
      const p = String(m.params.response.payloadData || '');
      if (/roster|"OK"|\["OK/.test(p)) frames.push({ t: Math.floor(Date.now() / 1000), dir: m.method.endsWith('Sent') ? '>' : '<', p: p.slice(0, 220) });
    }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Network.enable');
  const s = { name: 'B', errors, frames, cdp };
  s.ev = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error('in-page(B): ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };
  s.waitFor = async (expr, ms = 60000, label = expr) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await s.ev(expr)) return true; } catch {} await sleep(300); } throw new Error('B timed out waiting for: ' + label); };
  s.press = async (re, label) => { if (await s.ev(clickText(re)) !== 'ok') throw new Error('nothing on B\'s screen matched ' + (label || re)); await sleep(400); };
  s.text = () => s.ev(`document.body.innerText.replace(/\\n/g,' / ')`);
  s.close = () => { try { ws.close(); } catch {} try { chr.kill('SIGKILL'); } catch {} setTimeout(() => { try { rmSync(prof, { recursive: true, force: true }); } catch {} }, 600); };

  // ── become a co-steward the way a real one does ──
  await s.waitFor(`[...document.querySelectorAll('button')].some(x => /Restore a church/i.test((x.textContent||'').trim()))`, 90000, 'the welcome screen');
  await s.press(/Restore a church/i);
  await s.waitFor(`!!document.querySelector('textarea[aria-label^="Your church"]')`, 30000, 'the 12-word box');
  await s.ev(`(() => { const t=document.querySelector('textarea[aria-label^="Your church"]'); const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; set.call(t, ${JSON.stringify(mnemonic)}); t.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
  await sleep(300);
  await s.press(/^Restore church$/);
  // every route except "Start a new church" lands on the universal PIN gate
  await s.waitFor(`!!document.querySelector('input[aria-label="Choose a console PIN or passphrase"]')`, 60000, 'B\'s PIN gate');
  await s.ev(typeInto('input[aria-label="Choose a console PIN or passphrase"]', PIN_B));
  await s.ev(typeInto('input[aria-label="Repeat the console PIN or passphrase"]', PIN_B));
  await sleep(300);
  await s.press(/Set PIN & enter/i);
  await s.waitFor(`[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Settings')`, 60000, 'B\'s dashboard');
  // B HAS A DASHBOARD BEFORE B HAS THE CHURCH NAME KEY, and `roster:` is sealed under that key — so a save
  // from a just-restored console returns null and the sheet says "Not saved — your church's key hasn't
  // arrived yet." Measured here: one run in three. The app is HONEST about it (it refuses rather than
  // writing names in the clear, and it says so on the form), so this is a precondition of the sim and not a
  // defect of the guard under test — but it is worth the owner knowing that a co-steward restored from the
  // 12 words can reach a full-looking console and be unable to save for a few seconds, with no hint until
  // they try. Waiting for the key here is the honest fix for THIS file; it is not a fix for that.
  await s.waitFor(`!!(window.Steward && window.Steward.nameKeyReady && window.Steward.nameKeyReady())`, 60000,
    'B\'s church name key arriving — nothing B saves can be sealed until it does');
  return s;
}

// ── the handful of in-page gestures this sim needs ────────────────────────────────────────────────────────
const clickText = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`;
const clickAria = (aria) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')===${JSON.stringify(aria)}); if(b){b.click();return 'ok';} return 'miss'; })()`;
// Is a control a steward could press actually on screen? `undefined` from the unit test's `m.button(...)`
// becomes this: the button is not in the document at all.
const hasButton = (re) => `[...document.querySelectorAll('button')].some(x=>${re}.test((x.textContent||'').trim()))`;
// SCOPED TO THE ROSTER DIALOG, never document.body. SchModal sets `aria-label={title}` and the title is
// "<team> · roster", which is the only stable handle on it (SchModal carries no data- attribute — the
// `[data-stew-modal-panel]` one belongs to SkModal in stew-dashboard.jsx and this sheet is not one). Reading
// the whole page instead would let a name printed on the Rota board behind the sheet answer an assertion
// about what is ON the form, which is the "comments can satisfy assertions" failure in another costume.
const rosterOpen = `!!document.querySelector('[role="dialog"][aria-label$="roster"]')`;
const rosterShut = `!document.querySelector('[role="dialog"][aria-label$="roster"]')`;
const modalText = `(() => { const d=document.querySelector('[role="dialog"][aria-label$="roster"]'); return d ? d.innerText.replace(/\\n/g,' / ') : ''; })()`;

// Open the roster form for the one team, from the dashboard. Returns when the form is up with its roles on it.
async function openRoster(s) {
  await s.press(/^Rota$/, 'the Rota section');
  await s.waitFor(hasButton(/^Roster$/), 45000, s.name + '\'s team card with a Roster button');
  await s.press(/^Roster$/, 'the Roster button');
  await s.waitFor(rosterOpen, 20000, s.name + '\'s roster form');
  await s.waitFor(`${modalText}.includes('roles this team fills')`, 20000, s.name + '\'s roster form painting its body');
}

// Type a person's name into the roster form and press the + that adds them. Not a state poke: this is the
// only route a steward has, and it is what makes the two forms genuinely diverge.
async function addPerson(s, name) {
  await s.ev(typeInto('input[placeholder="Name"]', name));
  await sleep(250);
  const r = await s.ev(clickAria('Add this person to the team'));
  assert.equal(r, 'ok', s.name + ' could not reach the control that adds a person');
  await s.waitFor(`${modalText}.includes(${JSON.stringify(name)})`, 10000, name + ' appearing on ' + s.name + '\'s form');
}

// WAIT FOR THE SAVE THE WAY THE STEWARD DOES: the form stays open until every publish has come back, and
// closes itself only on success. A save that failed leaves the sheet up with its own message in it — which is
// the console's "not saved" channel — so a timeout here must QUOTE that message rather than report a hang.
// …AND PRESS AGAIN WHEN THE FORM SAYS TO. `publishRoster` seals `roster:` under the church NAME key and
// returns null without it, and the sheet then says "Not saved — your church's key hasn't arrived yet. Give
// it a moment and try again." A console restored from the 12 words hits that INTERMITTENTLY — measured on
// this box at roughly one run in three, and it survives waiting for `Steward.nameKeyReady()` before the save,
// so the ring is ready and then is not. A real steward does what the sheet tells them, so this does too, and
// it COUNTS the attempts into `timing.retries` and prints them: the retry keeps this file about the conflict
// guard without hiding the other thing. See the report note — it is not fixed here.
async function waitSaved(s, what, repress) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const until = Date.now() + 15000;
    while (Date.now() < until) { if (await s.ev(rosterShut)) { timing.retries = (timing.retries || 0) + (attempt - 1); return; } await sleep(400); }
    const said = String(await s.ev(modalText));
    if (!/key hasn/.test(said) || !repress) {
      throw new Error(`${s.name}'s ${what} never completed — the form is still open and says: "${said.slice(-400)}"`);
    }
    await sleep(2500);
    await repress();
  }
  throw new Error(`${s.name}'s ${what} was refused five times for want of the church name key, over ~90s. ` +
    `The sheet says "give it a moment and try again"; a steward who did that five times still has nothing saved.`);
}

// DO NOT PRESS SAVE INSIDE THE SECOND THE LAST SAVE LANDED IN.
//
// `publishRoster` stamps a kind-30078 replaceable event with `created_at: now()` in WHOLE SECONDS, and the
// relay keeps the newest copy — so a write whose created_at equals the stored one is not newer and is
// refused. On a local box the whole A-saves → B-is-warned → B-chooses sequence can finish inside one second,
// and this file failed once, at exactly one step, with the relay still holding the previous version: a
// refused write that the form reported as saved.
//
// So each save here waits for the clock to tick past the version it is replacing. That is the harness making
// the GUARD the thing under test rather than the clock — and it is deliberately NOT a silent sleep: every
// save is still followed by a strict `>` assertion on the relay's own created_at, so a same-second collision
// fails loudly instead of passing as a green that proved nothing. See the report note: a steward pressing
// "Save mine anyway" inside that second appears to succeed and does not, which is a separate defect from
// the one this file covers and is not fixed here.
async function tickPast(sec) { while (Math.floor(Date.now() / 1000) <= sec) await sleep(120); }

// The created_at the relay actually stored for this team's roster, in whole seconds. The CONTENT is sealed
// under the church name key, so the names are not readable here and must not be asserted from the database —
// what arrived at the other console's screen is the honest proof of that, and is what this file uses.
function rosterStamps(s) {
  return s.rows(`dtag LIKE 'trinityone/roster:%'`).map(r => (r.e && r.e.created_at) || 0).sort((a, b) => a - b);
}

before(async () => {
  if (!CHROME) return;
  A = await openNewChurch({ name: 'rosterrace', wizard: 'skip', logger: false });
  A.name = 'A';   // openNewChurch's session has no name of its own; the failure messages below quote it
  B = await secondConsole(A.relay, A.mnemonic);
  assert.equal(await B.ev('window.Steward.churchPub'), A.churchPub, 'the second console is not on the same church — the rest of this file would prove nothing');
  // The first of the two ways a headless sim lies. The app behaves differently on a page it is told is
  // hidden, so a run on a hidden page is a run of a different product.
  for (const s of [A, B]) timing['visibility-' + s.name] = await s.ev('document.visibilityState');
});

after(() => { try { B && B.close(); } catch {} try { A && A.close(); } catch {} });

// OPT-IN, DELIBERATELY. Measured across two operators, 12 of 16 runs green — and the ONE cause of
// every red is co-steward-name-key-refuses-roster-save: a steward restored from the 12 words reports
// nameKeyReady() true and the save path then disagrees, ~1 run in 3. Never the conflict guard.
//
// A test that reddens one run in four does not belong in the default suite. That is precisely how
// this repo reached 188 failures nobody could read, and how a real regression hid under them for two
// days. It stays out until the readiness signal is fixed — the fix is a real signal, NOT more retries
// here. Run it on purpose:
//
//     RUN_ROSTER_SIM=1 node --test scripts/two-stewards-on-one-roster-are-warned-not-overwritten.test.mjs
//
const GATE = !CHROME ? 'no chromium'
  : !process.env.RUN_ROSTER_SIM ? 'opt-in: set RUN_ROSTER_SIM=1 (flaky on the co-steward name key, not on the guard)'
  : false;

test('CONTROL: two real consoles, one church, one relay — and B can see what A publishes', { skip: GATE }, async () => {
  assert.equal(timing['visibility-A'], 'visible', 'console A thinks it is hidden: headless throttling makes this a run of a different app');
  assert.equal(timing['visibility-B'], 'visible', 'console B thinks it is hidden: headless throttling makes this a run of a different app');

  // A makes the team. Team creation publishes the group AND the roster's roles (NewTeamModal.create), so
  // this is roster v0 and both forms will be opened on it.
  await A.press(/^Rota$/, 'the Rota section');
  await A.press(/New team/, 'New team');
  await A.waitFor(`!!document.querySelector('textarea[aria-label^="Roles to fill"]')`, 20000, 'the New team form');
  await A.ev(typeInto('input[aria-label="Name"]', TEAM));
  await A.ev(`(() => { const t=document.querySelector('textarea[aria-label^="Roles to fill"]'); const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; set.call(t, 'Greeter\\nUsher'); t.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
  await sleep(300);
  await A.press(/Create team/, 'Create team');

  // AND A SERVICE, because the Rota board only draws its team cards — and so the "Roster" button — once
  // there is a service to put people on; with none it says "Add a service to start building a rota." A sim
  // that reached for Roster without this found nothing and would have read as a broken console.
  await A.waitFor(hasButton(/^Service$/), 30000, 'the add-a-service control');
  await A.press(/^Service$/, 'Service');
  await A.waitFor(`!!document.querySelector('input[aria-label="Date"]')`, 20000, 'the add-a-service form');
  await A.ev(`(() => { const i=document.querySelector('input[aria-label="Date"]'); const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(i, new Date(Date.now()+7*864e5).toISOString().slice(0,10)); i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true})); return i.value; })()`);
  await sleep(500);
  await A.press(/^Add service/, 'Add service');
  await A.waitFor(hasButton(/^Roster$/), 45000, 'A\'s team card with a Roster button');

  // …and B must receive all of it, through the relay, with no reload. If this fails nothing later means anything.
  await B.press(/^Rota$/, 'the Rota section');
  await B.waitFor(`document.body.innerText.includes(${JSON.stringify(TEAM)})`, 90000, 'the team reaching B through the relay');
  await B.waitFor(hasButton(/^Roster$/), 90000, 'B\'s own team card, built from documents B never wrote');
  const v0 = rosterStamps(A);
  assert.equal(v0.length, 1, 'expected exactly one roster document on the relay, found ' + v0.length);
  timing.v0 = v0[0];
});

test('B is WARNED, and B\'s plain Save is GONE, when A saves the roster B has open', { skip: GATE }, async () => {
  await openRoster(A);
  await openRoster(B);
  // Both forms are open on v0 and neither has saved. This is the whole premise and it is worth asserting:
  // if B's form were already warning, the warning below would be about nothing.
  assert.doesNotMatch(await A.ev(modalText), new RegExp(WARNING), 'A was warned before anyone had written');
  assert.doesNotMatch(await B.ev(modalText), new RegExp(WARNING), 'B was warned before anyone had written');
  assert.ok(await A.ev(hasButton(/^Save roster$/)), 'A has no Save roster button — the fixture proves nothing');
  assert.ok(await B.ev(hasButton(/^Save roster$/)), 'B has no Save roster button — the fixture proves nothing');

  await addPerson(A, RUTH);
  await addPerson(B, SAM);
  assert.ok(!(await B.ev(modalText)).includes(RUTH), 'B\'s form already holds A\'s person — the two forms never diverged');

  // A saves. The modal closes itself only once every publish has come back, so this is the real wait.
  const tA = Date.now();
  await tickPast(timing.v0);
  await A.press(/^Save roster$/, 'A\'s Save roster');
  await waitSaved(A, 'first Save roster', () => A.press(/^Save roster$/, 'A\'s Save roster, again'));
  timing.aSaveMs = Date.now() - tA;

  // THE RELAY CONFIRMS IT, not the browser that sent it. created_at is seconds, and a second write inside the
  // same second as v0 would be invisible to the guard by construction — so say which it was rather than
  // letting a same-second run pass as a green that proved nothing.
  await H.waitFor(() => rosterStamps(A)[0] > timing.v0, { timeout: 30000, label: 'the relay storing a NEWER roster than v0' });
  timing.v1 = rosterStamps(A)[0];
  assert.ok(timing.v1 > timing.v0, `A's save landed in the same second as v0 (both ${timing.v1}) — newest-wins is to the second, so NO version check of this shape could have fired. This is not a pass.`);

  // …and now the thing the in-process test cannot reach: B's open form noticing, off the wire.
  // The label is the failure message. With the guard gone this wait is the FIRST thing that fails, so it —
  // not the assertion under it — has to say what a steward loses.
  await B.waitFor(`${modalText}.includes(${JSON.stringify(WARNING)})`, 60000, 'THE DEFECT a0b7a0d SHIPPED: A saved this roster and B\'s open form says nothing. B\'s next Save silently replaces A\'s people and roles, and neither steward is ever told');
  assert.match(await B.ev(modalText), new RegExp(WARNING),
    'THE DEFECT a0b7a0d SHIPPED: B\'s form says nothing about A\'s write. B\'s next Save silently deletes A\'s people and roles, and neither steward is told.');
  assert.equal(await B.ev(hasButton(/^Save roster$/)), false,
    'the plain Save roster button is still on B\'s screen over A\'s change — one ordinary click now destroys A\'s work with no choice made');
  assert.ok(await B.ev(hasButton(/Reload their version/)), 'B is warned but offered no way to take A\'s version');
  assert.ok(await B.ev(hasButton(/Save mine anyway/)), 'B is warned but offered no way to knowingly keep their own');
  // Nothing was published by the warning itself: the relay still holds A's version and only A's.
  assert.deepEqual(rosterStamps(A), [timing.v1], 'a roster was written while B was only being warned');
});

test('"Reload their version" brings A\'s person — off the relay — into B\'s form', { skip: GATE }, async () => {
  // No warning means no "Reload their version" either: with the guard gone a steward has NO WAY to take the
  // other steward's version short of retyping it, and no reason to know they should.
  await B.press(/Reload their version/, 'B\'s Reload their version — absent, so A\'s work can only be kept by B retyping it from memory');
  await B.waitFor(`${modalText}.includes(${JSON.stringify(RUTH)})`, 20000, 'A\'s person arriving in B\'s form');
  const t = await B.ev(modalText);
  assert.ok(t.includes(RUTH), `Reload their version did not bring A's person across. "${RUTH}" was typed into A's browser and has travelled relay→B's subscription→B's form; without it the only way to keep A's work is for B to retype it from memory.`);
  assert.doesNotMatch(t, new RegExp(WARNING), 'B reloaded and is still being warned about a change B now holds');
  assert.ok(await B.ev(hasButton(/^Save roster$/)), 'after reloading, B has no ordinary way to save');
});

test('"Save mine anyway" publishes, and does replace A\'s version — the documented choice B was told about', { skip: GATE }, async () => {
  // Re-stage the conflict from scratch: B's form is now on A's version, so there is nothing to overrule.
  // A adds nothing new; A simply saves again, which is enough to move the version on.
  await B.press(/^Cancel$/, 'B closing the form');
  await sleep(500);
  await openRoster(B);
  await openRoster(A);
  await addPerson(A, 'Tom Reed');
  await tickPast(timing.v1);
  await A.press(/^Save roster$/, 'A\'s second save');
  await waitSaved(A, 'second Save roster', () => A.press(/^Save roster$/, 'A\'s second Save roster, again'));
  await H.waitFor(() => rosterStamps(A)[0] > timing.v1, { timeout: 30000, label: 'the relay storing A\'s second roster' });
  timing.v2 = rosterStamps(A)[0];
  await B.waitFor(`${modalText}.includes(${JSON.stringify(WARNING)})`, 60000,
    'B to be warned a second time. Unwarned, "Save mine anyway" is not a choice B made — it is the only Save there is, and it deletes A\'s work');

  // B keeps their own, knowingly. The form B is holding is A's v1 (Ruth) plus nothing — so what B publishes
  // must be v1's people WITHOUT Tom: that is the replacement, and it is the behaviour the warning bought
  // B the chance to avoid.
  await tickPast(timing.v2);
  await B.press(/Save mine anyway/, 'B\'s Save mine anyway');
  await waitSaved(B, 'Save mine anyway', () => B.press(/Save mine anyway/, 'B\'s Save mine anyway, again'));
  try { await H.waitFor(() => rosterStamps(A)[0] > timing.v2, { timeout: 30000, label: 'B\'s own version reaching the relay' }); }
  catch (e) {
    throw new Error('B chose "Save mine anyway", the form closed as though it had saved, and the relay still holds ' +
      JSON.stringify(rosterStamps(A)) + ' (A\'s version was ' + timing.v2 + ', the clock is now ' + Math.floor(Date.now() / 1000) +
      '). B\'s work is gone and B was told it was kept.\n  B\'s last roster frames: ' +
      JSON.stringify(B.frames.slice(-6), null, 1));
  }
  timing.v3 = rosterStamps(A)[0];
  assert.ok(timing.v3 > timing.v2, '"Save mine anyway" published nothing — a steward who was warned and chose to keep their own work lost it instead');

  // And A's console, with no reload, must now be showing B's version rather than its own. The replacement is
  // visible to the steward it happened to, which is the difference between this and the silent overwrite.
  await openRoster(A);
  await A.waitFor(`!${modalText}.includes('Tom Reed')`, 60000, 'A\'s console taking B\'s replacement');
  const after = await A.ev(modalText);
  assert.ok(!after.includes('Tom Reed'), '"Save mine anyway" did not replace A\'s version — the one documented behaviour of this control');
  assert.ok(after.includes(RUTH), 'B\'s version lost the person B had just reloaded from A');
  console.log(`\n    real timing — v0=${timing.v0} v1=${timing.v1} v2=${timing.v2} v3=${timing.v3} (relay created_at, seconds)` +
              `\n                  A's save, click to form closed: ${timing.aSaveMs}ms` +
              `\n                  gap v0→v1: ${timing.v1 - timing.v0}s   v1→v2: ${timing.v2 - timing.v1}s   v2→v3: ${timing.v3 - timing.v2}s` +
              `\n                  saves refused for want of the church name key, then retried: ${timing.retries || 0}\n`);
});
