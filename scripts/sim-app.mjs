// SIMULATE THE APP, NOT THE PROTOCOL — and count what was actually exercised.
//
//   node scripts/sim-app.mjs <base-url> <church-npub> [--members 4] [--rounds 1]
//
// WHY THIS AND NOT scripts/sim.mjs. That one publishes correct documents straight to a relay, which proves
// the RELAY behaves but can never fail the way the app fails. Every defect found on this branch lived in the
// client's own judgement — a send that decided wrongly whether to encrypt, a label that disagreed with the
// message beside it, a distributor that recorded a job done when nothing published. A script that writes
// correct events by construction cannot reproduce any of them. So this drives real app instances: each
// persona is a headless browser running the shipped client, doing what a member does.
//
// THE COVERAGE LEDGER. "Every feature, three times" is unmeasurable by eye across 318 public functions, so
// each instance is instrumented: every window.Fellowship / window.Steward call is counted in-page, and the
// counts are merged at the end. The report says what has been exercised, how often, and — the useful half —
// what has not been touched at all.
//
// AND ITS LIMIT, STATED. A function being CALLED is not the same as it being exercised in every way it can
// be used; a send that always succeeds never tests the refusal path. Coverage here is a floor, not a proof.
// The named scenarios below are what actually assert behaviour; the ledger only stops us believing we have
// covered something we have not touched at all.
import { WebSocket } from 'ws';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:8000';
const CHURCH = process.argv[3];
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const MEMBERS = Number(arg('--members', 3));
const ROUNDS = Number(arg('--rounds', 1));
const LEDGER = 'scripts/.sim-coverage.json';
if (!CHURCH) { console.error('usage: node scripts/sim-app.mjs <base-url> <church-npub> [--members N] [--rounds N]'); process.exit(2); }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, detail) => { console.log('    ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : '')); ok ? pass++ : fail++; };

// ── one app instance = one persona ─────────────────────────────────────────────────────────────────────────
async function persona(name, port) {
  const profile = mkdtempSync(join(process.env.TRINITY_SCRATCH || '/mnt/storage/tmp/trinity-scratch', 'sim-' + name + '-'));
  const chrome = spawn('chromium', ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
    '--no-first-run', '--disable-gpu', '--no-sandbox', 'about:blank'], { stdio: 'ignore' });
  let t;
  for (let i = 0; i < 40 && !t; i++) { await sleep(300); try { const r = await fetch(`http://127.0.0.1:${port}/json/list`); t = (await r.json()).find(x => x.type === 'page'); } catch {} }
  if (!t) throw new Error(name + ': no browser');
  const ws = new WebSocket(t.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  let id = 0;
  const send = (m, p) => new Promise((res, rej) => {
    const n = ++id;
    const on = d => { const x = JSON.parse(d); if (x.id === n) { ws.off('message', on); x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result); } };
    ws.on('message', on); ws.send(JSON.stringify({ id: n, method: m, params: p }));
  });
  await new Promise(r => ws.on('open', r));
  // Enabling Page makes this client answerable for the page's dialogs; a client that never answers one
  // parks the renderer for ever. See the note in scripts/sim-actor.mjs.
  ws.on('message', (d) => { let x; try { x = JSON.parse(d); } catch { return; }
    if (x.method === 'Page.javascriptDialogOpening')
      ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true, promptText: '' } })); });
  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  // THE LEDGER, installed before any app code runs. Wrapping on every new document survives the app's own
  // navigations; counting in-page rather than inferring from the relay is the only way to see calls that
  // never reach the wire — which is exactly where this week's defects were.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(function(){
    window.__cov = window.__cov || {};
    function wrap(objName){
      var tries = 0;
      var iv = setInterval(function(){
        var o = window[objName];
        if (!o || o.__wrapped) { if (++tries > 200) clearInterval(iv); return; }
        Object.keys(o).forEach(function(k){
          if (typeof o[k] !== 'function') return;
          var orig = o[k];
          o[k] = function(){ var key = objName + '.' + k; window.__cov[key] = (window.__cov[key]||0)+1; return orig.apply(this, arguments); };
        });
        o.__wrapped = true;
      }, 250);
    }
    wrap('Fellowship'); wrap('Steward');
  })();` });

  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.value;
  const api = {
    name, ws, chrome, send, ev,
    async goto(url, settle = 12000) { await send('Page.navigate', { url }); await sleep(settle); },
    async tap(label, req = true, waitMs = req ? 25000 : 4000) {
      const find = () => ev(`(function(){
        var all=[].slice.call(document.querySelectorAll('button,a,[role="button"],div,span,label')).filter(function(x){
          var tx=(x.innerText||'').trim(); var r=x.getBoundingClientRect();
          return tx.indexOf(${JSON.stringify(label)})===0 && r.width>25 && r.height>10;});
        if(!all.length) return null;
        all.sort(function(a,b){return (a.innerText||'').length-(b.innerText||'').length;});
        var e=all[0]; e.scrollIntoView({block:'center'}); var r=e.getBoundingClientRect();
        return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`);
      let box = null; const until = Date.now() + waitMs;
      while (!box && Date.now() < until) { box = await find(); if (!box) await sleep(1200); }
      if (!box) { if (req) throw new Error(name + ': control not found: ' + label); return false; }
      const { x, y } = JSON.parse(box);
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await sleep(60);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(1100); return true;
    },
    async type(phPart, value) {
      return ev(`(function(){
        var i=[].slice.call(document.querySelectorAll('input,textarea')).filter(function(x){return (x.placeholder||'').indexOf(${JSON.stringify(phPart)})>=0;})[0];
        if(!i) return 'no input';
        var s=Object.getOwnPropertyDescriptor(i.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype,'value').set;
        s.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok';})()`);
    },
    // SEND THE WAY A MEMBER SENDS. The send control is an icon with no text, so the label matcher never found
    // it — and because that tap was optional, the first run reported a conversation that never happened: three
    // instances "talked" and the relay received zero messages. The composer sends on Enter (screens-chat.jsx
    // binds it on the textarea), which is both how most people send and something CDP can press for real.
    async send(text) {
      const focused = await ev(`(function(){
        var t=[].slice.call(document.querySelectorAll('textarea')).filter(function(x){return /Message|Share a/.test(x.placeholder||'');})[0];
        if(!t) return 'no composer';
        t.focus();
        var s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
        s.call(t, ${JSON.stringify('')}); t.dispatchEvent(new Event('input',{bubbles:true}));
        return 'ok';})()`);
      if (focused !== 'ok') return focused;
      await ev(`(function(){
        var t=document.activeElement;
        var s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
        s.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);
      await sleep(250);
      for (const type of ['keyDown', 'keyUp']) {
        await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      }
      await sleep(1500);
      // did the composer clear? that is the app telling us it accepted the message
      return ev(`(function(){var t=[].slice.call(document.querySelectorAll('textarea')).filter(function(x){return /Message|Share a/.test(x.placeholder||'');})[0];
        return t && !t.value ? 'sent' : 'still-in-composer';})()`);
    },
    async coverage() { return (await ev('JSON.stringify(window.__cov||{})')) || '{}'; },
    close() { try { ws.close(); } catch {} try { chrome.kill(); } catch {} },
  };
  return api;
}

// ── onboarding: the one flow every persona needs ───────────────────────────────────────────────────────────
async function onboard(p, displayName) {
  await p.goto(`${BASE}/index.html`, 7000);
  await p.ev('(function(){ try { localStorage.clear(); } catch(e){} return 1; })()');
  await p.goto(`${BASE}/index.html?follow=${CHURCH}`, 15000);
  await p.tap('I’m new here');
  await p.type('Maria', displayName);
  await sleep(400);
  await p.tap('Continue as ' + displayName);
  await sleep(1200);
  await p.tap('I’ll back these up later', false);
  await sleep(600);
  await p.tap('Skip anyway', false);
  await p.tap('Skip', false);
  await sleep(1000);
  await p.tap('Skip for now', false);
  await sleep(8000);
  return p.ev('(window.Fellowship && window.Fellowship.myPubkey) || ""');
}

// ── PLAYING BOTH SIDES ──────────────────────────────────────────────────────────────────────────────────────
//
// A simulation that drives one persona and checks the relay is not a simulation of an interaction — it is one
// person talking into a room. Every interaction in this product has at least two ends: someone asks for help
// and a steward answers; someone sends and someone receives; a steward blocks and a member's app must react.
// The interesting failures live in the GAP between those ends, which is precisely the part one actor cannot
// reach. Chat looked fine all week from the sender's side; nothing had ever checked that the words arrived.
//
// So a beat names WHO acts, and the next beat names who must SEE it. The runner waits for the second side to
// catch up rather than asserting immediately — propagation is a round trip through the relay, and asserting
// straight after an action is how a screen that never updated gets recorded as a pass.
async function waitUntil(p, jsPredicate, ms = 30000, every = 1500) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if (await p.ev(`(function(){ ${jsPredicate} })()`)) return true; } catch (e) {}
    await sleep(every);
  }
  return false;
}
const sees = (text) => `return document.body.innerText.indexOf(${JSON.stringify(text)}) >= 0;`;

// One exchange, played from both ends: A says something in a room, B must see it, B answers, A must see THAT.
// Either direction failing is a real defect — a message that leaves the sender and never lands is invisible to
// every test that only watches the sender.
async function exchange(A, B, room, phraseA, phraseB) {
  for (const p of [A, B]) {
    await p.tap('Community', false); await sleep(2000);
    await p.tap(room, false); await sleep(2500);
  }
  const sentA = await A.send(phraseA);
  check(`${A.name} sends in ${room}`, sentA === 'sent', sentA);
  const gotA = await waitUntil(B, sees(phraseA), 40000);
  check(`…and ${B.name} receives it`, gotA, gotA ? 'arrived at the other app' : 'NEVER ARRIVED — the sender saw success');

  const sentB = await B.send(phraseB);
  check(`${B.name} answers`, sentB === 'sent', sentB);
  const gotB = await waitUntil(A, sees(phraseB), 40000);
  check(`…and ${A.name} sees the answer`, gotB, gotB ? 'the round trip closed' : 'the reply never came back');
  for (const p of [A, B]) { await p.ev('history.back()'); await sleep(1000); }
}

// ── the steward console — 207 of the 318 public functions live behind it ────────────────────────────────────
//
// Nothing in the member app can reach church creation, care approval, safeguarding, rotas or blocking, so a
// simulation without a console instance covers a third of the product at best. The console cannot restore the
// seeded church (its key exists only as raw hex, and restore takes twelve words), so it creates its own — which
// is the better test anyway: the creation flow is itself a large slice of the console, and every member who
// then joins is joining a church that was made the way a real one is.
async function consolePersona(port) {
  const p = await persona('console', port);
  await p.goto(`${BASE}/steward.html`, 14000);
  return p;
}

async function createChurch(p, name) {
  await p.tap('Start a new church');
  await sleep(1500);
  // the setup wizard asks for a name; the field's placeholder varies, so try the likely ones
  for (const ph of ['church', 'Church', 'name', 'Name', 'e.g.']) {
    const r = await p.type(ph, name);
    if (r === 'ok') break;
  }
  await sleep(500);
  for (const label of ['Continue', 'Create', 'Next', 'Save']) {
    if (await p.tap(label, false, 3000)) { await sleep(2500); break; }
  }
  // whatever the wizard asks next, keep going. The PIN step needs its own handling — it is two password
  // fields and a specific button, so an affirmative-tapping loop walks straight past it and the console sits
  // on "Set a console PIN" for ever. (The console's key signs as the whole church, so this step is not
  // skippable by design.)
  for (let i = 0; i < 10; i++) {
    const screen = String(await p.ev('document.body.innerText.slice(0,300)') || '');
    if (/Set a console PIN|Choose a PIN|console PIN/i.test(screen)) {
      const pins = await p.ev(`(function(){
        var f=[].slice.call(document.querySelectorAll('input')).filter(function(x){return x.type==='password'||/PIN|again/i.test(x.placeholder||'');});
        var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
        f.forEach(function(i){ s.call(i,'314159'); i.dispatchEvent(new Event('input',{bubbles:true})); });
        return f.length;})()`);
      await sleep(500);
      let moved = false;
      for (const label of ['Set a PIN', 'Set PIN', 'Continue', 'Save', 'Done']) {
        if (await p.tap(label, false, 2500)) { moved = true; await sleep(3000); break; }
      }
      if (!moved) { console.log('    (console: ' + pins + ' PIN fields filled, no button matched)'); break; }
      continue;
    }
    let moved = false;
    for (const label of ['Continue', 'Next', 'Skip for now', 'Skip', 'Done', 'Finish', 'Not now', 'Got it']) {
      if (await p.tap(label, false, 2000)) { moved = true; await sleep(2000); break; }
    }
    if (!moved) break;
  }
  await sleep(4000);
  return p.ev('(window.Steward && window.Steward.pubkey && window.Steward.pubkey()) || (window.Steward && window.Steward.churchPub) || ""');
}

// ── run ────────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n  app instances : ' + MEMBERS + '\n  church        : ' + CHURCH.slice(0, 24) + '…\n  rounds        : ' + ROUNDS + '\n');
const people = [];
const NAMES = ['Ruth', 'Hannah', 'Deborah', 'Naomi', 'Esther', 'Miriam', 'Lydia', 'Priscilla'];
for (let i = 0; i < MEMBERS; i++) people.push(await persona(NAMES[i], 9400 + i));

console.log('── the steward console ─────────────────────────────────────────────────────');
const con = await consolePersona(9399);
const churchPub = await createChurch(con, 'SIM Trinity Chapel');
check('the console created a church', /^[0-9a-f]{64}$/.test(churchPub || ''), (churchPub || 'no key').slice(0, 12) + '…');
const conScreen = await con.ev('document.body.innerText.slice(0,200).replace(/\\n/g," · ")');
console.log('    console shows: ' + String(conScreen).slice(0, 120));

console.log('\n── onboarding ──────────────────────────────────────────────────────────────');
for (let i = 0; i < people.length; i++) {
  const pk = await onboard(people[i], NAMES[i]);
  check(NAMES[i] + ' has an identity and a church', /^[0-9a-f]{64}$/.test(pk || ''), (pk || '').slice(0, 10) + '…');
}

console.log('\n── a conversation, played from both ends ───────────────────────────────────');
if (people.length >= 2) {
  for (let r = 0; r < ROUNDS; r++) {
    const stamp = Date.now().toString(36).slice(-4);
    await exchange(people[0], people[1], 'Readings',
      `${people[0].name}: is the reading still Isaiah? [${stamp}]`,
      `${people[1].name}: yes, Isaiah 40 [${stamp}]`);
  }
} else console.log('    (needs at least two instances)');

console.log('\n── coverage ────────────────────────────────────────────────────────────────');
const merged = {};
for (const p of [...people, con]) {
  const c = JSON.parse(await p.coverage());
  for (const [k, v] of Object.entries(c)) merged[k] = (merged[k] || 0) + v;
}
const surface = existsSync('/tmp/surface.json') ? JSON.parse(readFileSync('/tmp/surface.json', 'utf8')) : { fellowship: [], steward: [] };
const all = [...surface.fellowship.map(f => 'Fellowship.' + f), ...surface.steward.map(f => 'Steward.' + f)];
const touched = Object.keys(merged).filter(k => merged[k] > 0);
const thrice = touched.filter(k => merged[k] >= 3);
writeFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), merged }, null, 1));
console.log('    functions called at least once : ' + touched.length + (all.length ? ' of ' + all.length : ''));
console.log('    …at least three times          : ' + thrice.length);
console.log('    most exercised                 : ' + Object.entries(merged).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => k.replace('Fellowship.', 'F.').replace('Steward.', 'S.') + '×' + v).join('  '));
console.log('\n    ledger → ' + LEDGER);

for (const p of people) p.close();
con.close();
console.log('\n───────────────────────────────────────────────────────────────────────────');
console.log('  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
