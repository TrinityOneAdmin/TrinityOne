// A CONSOLE THAT OPENS BEFORE ITS CHURCH NAME KEY ARRIVES NEVER WIPES A TEAM — THE REAL BROWSER, THE REAL RELAY.
// Run: node --test scripts/a-console-opened-before-its-key-keeps-its-teams.test.mjs
//
// THE BUG (HIGH, data loss, 2026-10-12). `roster:` is sealed under the church name key. A console that opens before
// that key arrives held the team as a locked copy, drew it as an EMPTY team, never re-read it when the key landed,
// and the next save published the empty team over the real one. The relay keeps only the newest copy.
//
// WHAT THIS STANDS UP. The real gateway on a free port, the real steward.html in headless chromium, a church made
// through its own wizard (scripts/new-church-session.mjs), a team made and a person added through the Rota page.
// Then the console is reloaded the way a steward reopens it, with ONE thing changed: every relay answer to the
// church name-key read is held back for KEY_DELAY_MS (a socket wrapper injected before the page loads — the same
// slow pipe the 2026-10-12 investigation measured). The console's cached copy of the rosters is cleared first, as on
// a second machine or a cleared browser: that is the case where nothing on the device can paint the team.
//
// THE POINT OF USE (CLAUDE.md rule 1). The assertions are on what the steward sees on the Rota page, on the Roster
// button they would press, on the roster form, and on the relay's own disk — never on a function's return alone.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openNewChurch, CHROME, sleep, typeInto } from './new-church-session.mjs';

const KEY_DELAY_MS = 15000;
const TEAM = 'Welcome', RUTH = 'Ruth Carver';
const LOCKED_TEXT = 'Can’t read this team yet';

// Hold back every message answering a REQ that asks for the church name key. Everything else passes untouched.
const SLOW_KEY = `(()=>{const W=window.WebSocket;const slow=new Set();class D extends W{constructor(...a){super(...a);const self=this;let h=null;
  Object.defineProperty(this,'onmessage',{get(){return h},set(f){h=f}});
  super.addEventListener('message',ev=>{let sid='';try{const m=JSON.parse(String(ev.data||''));sid=m[1];}catch(e){}
    const fire=()=>{try{h&&h.call(self,ev)}catch(e){}};
    if(sid&&slow.has(sid)){setTimeout(fire,${KEY_DELAY_MS});}else fire();});
  const s0=this.send.bind(this);this.send=(x)=>{try{const m=JSON.parse(String(x));if(m[0]==='REQ'&&String(x).includes('namekey:'))slow.add(m[1]);}catch(e){}return s0(x);};}}
  window.WebSocket=D;window.__slowKey=true;})()`;

const click = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`;
const hasButton = (re) => `[...document.querySelectorAll('button')].some(x=>${re}.test((x.textContent||'').trim()))`;
const rosterOpen = `!!document.querySelector('[role="dialog"][aria-label$="roster"]')`;
const rosterShut = `!document.querySelector('[role="dialog"][aria-label$="roster"]')`;
const modalText = `(() => { const d=document.querySelector('[role="dialog"][aria-label$="roster"]'); return d ? d.innerText.replace(/\\n/g,' / ') : ''; })()`;
const rosterBtn = `[...document.querySelectorAll('button')].find(x=>/^Roster$/.test((x.textContent||'').trim()))`;

let A = null;
before(async () => { if (CHROME) A = await openNewChurch({ name: 'lockedroster', wizard: 'skip', logger: false }); });
after(() => { try { A && A.close(); } catch {} });

// The roster rows the relay holds: [{ d, created_at, id }]. Content is sealed — the stamps and ids are the proof.
const relayRosters = () => A.rows(`dtag LIKE 'trinityone/roster:%'`).map(r => ({ d: r.d, at: r.e.created_at, id: r.e.id }));

test('a console opened before its name key shows the team as unreadable, cannot wipe it, and shows it once the key lands', { skip: !CHROME, timeout: 300000 }, async () => {
  // ── a team with a person on it, made through the Rota page ──
  await A.press(/^Rota$/, 'the Rota section');
  await A.press(/New team/, 'New team');
  await A.waitFor(`!!document.querySelector('textarea[aria-label^="Roles to fill"]')`, 20000, 'the New team form');
  await A.ev(typeInto('input[aria-label="Name"]', TEAM));
  await A.ev(`(() => { const t=document.querySelector('textarea[aria-label^="Roles to fill"]'); const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; set.call(t, 'Greeter\\nUsher'); t.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
  await sleep(300);
  await A.press(/Create team/, 'Create team');
  await A.waitFor(hasButton(/^Service$/), 30000, 'the add-a-service control');
  await A.press(/^Service$/, 'Service');
  await A.waitFor(`!!document.querySelector('input[aria-label="Date"]')`, 20000, 'the add-a-service form');
  await A.ev(`(() => { const i=document.querySelector('input[aria-label="Date"]'); const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(i, new Date(Date.now()+7*864e5).toISOString().slice(0,10)); i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true})); return i.value; })()`);
  await sleep(500);
  await A.press(/^Add service/, 'Add service');
  await A.waitFor(hasButton(/^Roster$/), 45000, 'the team card');
  await A.press(/^Roster$/, 'Roster');
  await A.waitFor(rosterOpen, 20000, 'the roster form');
  await A.ev(typeInto('input[placeholder="Name"]', RUTH));
  await sleep(250);
  assert.equal(await A.ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')==='Add this person to the team'); if(b){b.click();return 'ok';} return 'miss'; })()`), 'ok');
  await A.waitFor(`${modalText}.includes(${JSON.stringify(RUTH)})`, 10000, 'Ruth on the form');
  const v0 = Math.max(0, ...relayRosters().map(r => r.at));
  while (Math.floor(Date.now() / 1000) <= v0) await sleep(120);   // a save in the second v0 was stamped in would tie
  await A.press(/^Save roster$/, 'Save roster');
  await A.waitFor(rosterShut, 30000, 'the roster save to finish');
  const saved = relayRosters();
  assert.equal(saved.length, 1, 'expected one roster on the relay: ' + JSON.stringify(saved));
  assert.ok(saved[0].at > v0, 'the roster with Ruth never reached the relay');

  // ── reopen the console with the name key held back, and nothing cached for the rosters ──
  await A.send('Page.enable');
  await A.send('Page.addScriptToEvaluateOnNewDocument', { source: SLOW_KEY });
  await A.ev(`(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('trinityone.steward.addr.v2.trinityone/roster:') || k.startsWith('trinityone.steward.keyenv.name.')) localStorage.removeItem(k); return 1; })()`);
  // (0fecf4c: the console now keeps a device copy of the name-key envelope, so a second machine or cleared browser
  // has neither — clear that too, or the key "lands" from the device before the relay is ever asked)
  await A.send('Page.reload', { ignoreCache: false });
  await sleep(1500);
  await A.waitFor(`!!document.querySelector('input[aria-label="Your console PIN or passphrase"]')`, 60000, 'the unlock screen');
  await A.ev(typeInto('input[aria-label="Your console PIN or passphrase"]', A.pin));
  await sleep(200);
  await A.ev(`(()=>{const i=document.querySelector('input[aria-label="Your console PIN or passphrase"]');i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return 1;})()`);
  await A.waitFor(hasButton(/^Rota$/), 60000, 'the dashboard after reopening');
  assert.equal(await A.ev('!!window.__slowKey'), true, 'the slow-key wrapper did not load — this run proves nothing');
  await A.press(/^Rota$/, 'Rota');

  // ── while the key is held back ──
  await A.waitFor(`document.body.innerText.includes(${JSON.stringify(LOCKED_TEXT)})`, 30000, 'the locked team saying so');
  assert.equal(await A.ev('window.Steward.nameKeyReady()'), false, 'the key arrived early — the window this test needs has closed; raise KEY_DELAY_MS');
  assert.equal(await A.ev(`(${rosterBtn}||{}).disabled === true`), true, 'THE DEFECT: the Roster button of a team this console cannot read is live');
  await A.ev(`(${rosterBtn}).click(), 1`);
  await sleep(500);
  assert.equal(await A.ev(rosterShut), true, 'pressing Roster on an unreadable team opened a form built from nothing');
  // A save from any other door (the engine itself, with an empty team) is refused too, and the relay copy is untouched.
  const teamId = saved[0].d.slice('trinityone/roster:'.length);
  const r = await A.ev(`Promise.resolve(window.Steward.publishRoster(${JSON.stringify(teamId)}, { roles: [], people: [], pods: [] })).then(x => JSON.stringify({ x, why: window.Steward.lastSaveFailure() }))`);
  assert.deepEqual(JSON.parse(r), { x: null, why: 'locked' }, 'THE DEFECT: an empty roster was published over a team this console could not read: ' + r);
  assert.deepEqual(relayRosters(), saved, 'the relay copy of the team changed while the console could not read it');

  // ── the key lands ──
  await A.waitFor('window.Steward.nameKeyReady()', KEY_DELAY_MS + 30000, 'the name key arriving');
  await A.waitFor(`!document.body.innerText.includes(${JSON.stringify(LOCKED_TEXT)})`, 20000, 'THE DEFECT: the team stayed unreadable after the key arrived');
  await A.waitFor(`(${rosterBtn}||{}).disabled === false`, 10000, 'the Roster button coming back');
  await A.press(/^Roster$/, 'Roster');
  await A.waitFor(rosterOpen, 20000, 'the roster form');
  await A.waitFor(`${modalText}.includes(${JSON.stringify(RUTH)})`, 10000, 'THE DEFECT: the real team did not appear once the key arrived — ' + RUTH + ' is missing from the form');
  assert.deepEqual(relayRosters(), saved, 'the relay copy changed with nobody saving');
});
