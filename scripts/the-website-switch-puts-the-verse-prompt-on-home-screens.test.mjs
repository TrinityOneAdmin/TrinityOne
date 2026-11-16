// THE "VERSE PROMPTS ON MEMBERS' HOME SCREENS" SWITCH PUTS THE PROMPT ON THE PUBLIC FEED — REFS ONLY — AND TAKES IT OFF.
//   Run: node --test scripts/the-website-switch-puts-the-verse-prompt-on-home-screens.test.mjs
//
// reference/PLAN-phone-widget-2026-11-16.html §4b — the CONSOLE's point of use (CLAUDE.md rule 1). The relay half is
// proved by scripts/the-verse-prompt-feed-is-served-only-when-shared.test.mjs with hand-made documents; this file
// proves the console WRITES them: the switch on Settings → Your website → Verse prompts writes share:{versePrompt},
// and the owner console's reconciler (_webSyncVerse in src/steward.src.js) writes and withdraws the public copy.
// Delete the switch from the screen, or the reconciler, and this goes red while the relay test stays green.
//
// Setup is copied from scripts/the-website-switch-puts-the-calendar-on-the-feed.test.mjs (a real gateway on a fresh
// box, the real console in headless chromium through the real wizard). THE PROMPT ITSELF is sent through the engine's
// own window.Steward.publishVersePrompt / removeVersePrompt — the calls the Verse panel makes — because that panel's
// book/chapter pickers need a Bible module this test box does not hold; what is under test is the switch and the
// reconciler, not the picker. Rule 3: nothing matches text in app/*.jsx.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import * as H from './relay-network-harness.mjs';
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PIN = 'cedar-harbour-lamp-42';
let relay, chr, ws, prof, evalIn, cdpSend, reloadAndUnlock, churchPub = '', npub = '';
const errors = [];

// What the box holds, read from its OWN sqlite — not from anything the console could answer from cache.
function heldBy(cp, prefix) {
  const db = new DatabaseSync(join(relay.dataDir, 'relay.sqlite'), { readOnly: true });
  try {
    return db.prepare('SELECT dtag, raw FROM events WHERE pubkey = ? AND kind = 30078 AND dtag LIKE ? ORDER BY dtag').all(cp, prefix + '%').map(r => {
      let e = {}; try { e = JSON.parse(String(r.raw || '')); } catch {}
      return { dtag: String(r.dtag), content: String(e.content || ''), tombstone: (e.tags || []).some(t => t[0] === 'deleted') || !e.content };
    });
  }
  finally { db.close(); }
}

const click = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`;
const clickSel = (sel) => `(() => { const b=document.querySelector(${JSON.stringify(sel)}); if(b){b.click();return 'ok';} return 'miss'; })()`;
const typeInto = (sel, val) => `(() => { const i=document.querySelector(${JSON.stringify(sel)}); if(!i) return 'miss';
  const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
const typePh = (ph, val) => `(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(ph)})); if(!i) return 'miss';
  const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
async function waitFor(expr, ms = 60000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await evalIn(expr)) return true; } catch {} await sleep(400); }
  throw new Error('timed out waiting for: ' + label);
}
const press = async (re, label) => { assert.equal(await evalIn(click(re)), 'ok', `nothing on screen matched ${label || re}`); await sleep(500); };
before(async () => {
  if (!CHROME) return;
  relay = await H.startRelay({ name: 'website', env: { TRINITY_TAILSCALE_BIN: '/nonexistent' } });
  const cdp = await H.freePort('the website-feed test\'s Chrome debug port');
  prof = mkdtempSync(join(tmpdir(), 'trin-website-chr-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=1280,1200', `${relay.base}/steward.html`], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d);
    if (m.method === 'Runtime.exceptionThrown') { const e = m.params.exceptionDetails; errors.push((e.exception?.description || e.text || '').split('\n')[0]); }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  cdpSend = send;                 // the viewport rows below drive Emulation.setDeviceMetricsOverride
  evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error('in-page: ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };

  // The real path: a new church, a PIN, the wizard's name step (which registers the church on this box).
  await waitFor(`[...document.querySelectorAll('button')].some(x => /Start a new church/i.test((x.textContent||'').trim()))`, 90000, 'Start a new church');
  await press('/Start a new church/i');
  await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('At least 8'))`, 60000, 'the PIN box');
  assert.equal(await evalIn(typePh('At least 8', PIN)), 'ok');
  assert.equal(await evalIn(typePh('Type it again', PIN)), 'ok');
  await press('/Set PIN/i');
  await waitFor(`!!document.querySelector('input[aria-label="Church name"]')`, 90000, 'the wizard name step');
  churchPub = await evalIn(`window.Steward && window.Steward.churchPub || ''`);
  assert.match(churchPub, /^[0-9a-f]{64}$/, 'no church key after the PIN step');
  npub = await evalIn(`window.Steward.npub || ''`);
  assert.match(npub, /^npub1[a-z0-9]{58}$/);
  assert.equal(await evalIn(typeInto('input[aria-label="Church name"]', 'Grace Church, Milltown')), 'ok');
  await sleep(300);
  await press('/^Continue$/');
  // the box registered the church (church.json is written on the first registration)
  { const t0 = Date.now(); let ok = false; while (!ok && Date.now() - t0 < 30000) { try { ok = (JSON.parse(readFileSync(join(relay.dataDir, 'church.json'), 'utf8')).churches || []).some(c => c && c.npub === npub); } catch {} if (!ok) await sleep(400); } assert.ok(ok, 'the box never registered the church'); }
  await waitFor(`localStorage.getItem('trinityone.steward.boxhosts.' + window.Steward.churchPub) === '1'`, 30000, 'the console to learn the box holds it');
  // Past the wizard by the door the console itself uses when setup is finished: the done marker, then a
  // reload and an unlock. (The words/quiz step is a ceremony this file is not about.)
  reloadAndUnlock = async () => {
    await evalIn(`(() => { location.reload(); return 'ok'; })()`);
    await sleep(3000);
    await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('Your PIN or passphrase'))`, 90000, 'the unlock screen');
    assert.equal(await evalIn(typePh('Your PIN or passphrase', PIN)), 'ok');
    await press('/^Unlock/');
    await waitFor(`[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Settings') && !document.querySelector('[data-stew-modal-panel]')`, 90000, 'the dashboard, with no wizard');
    await sleep(2500);
  };
  await evalIn(`(() => { localStorage.setItem('trinityone.steward.wizard.done', '1'); localStorage.removeItem('trinityone.steward.newchurch'); return 'ok'; })()`);
  await reloadAndUnlock();
  // ONE GROUP, THE WAY THE WIZARD'S "Create a few spaces" STEP WOULD HAVE MADE ONE — and it is load-bearing.
  // MEASURED 2026-09-22 on this branch: a church whose corpus holds NO private document is never challenged by
  // the relay (NIP-42 is lazy: it challenges on a WITHHELD event), so the console never authenticates, so
  // _ensureNameKeyLocked refuses to mint the church name key ("!_isRelayAuthed()"), so no event can be sealed
  // and every calendar save reads "not saved". A group document is private, so the next boot is challenged
  // on the first REQ that matches it. That is the steward's second day; this file is not about it, and the
  // finding is recorded in the branch report rather than fixed here.
  await press('/^Groups$/', 'the Groups section');
  await press('/^New group$/', 'New group');
  await waitFor(`!!document.querySelector('input[aria-label="Name"]')`, 20000, 'the New group dialog');
  assert.equal(await evalIn(typeInto('input[aria-label="Name"]', 'Whole church')), 'ok');
  await press('/^Create group$/', 'Create group');
  { const t0 = Date.now(); let n = 0; while (Date.now() - t0 < 20000) { n = heldBy(churchPub, 'trinityone/group:').length; if (n) break; await sleep(400); } assert.equal(n, 1, 'the group never reached the box'); }
  await reloadAndUnlock();
});

after(async () => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  H.stopAll();
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
});

const SKIP = !CHROME ? 'no chromium' : false;
const FEED = () => `${relay.base}/public/${npub}/verse-prompt.json`;
async function pollFeed(pred, ms = 30000) {
  const t0 = Date.now(); let last = null;
  while (Date.now() - t0 < ms) { const r = await fetch(FEED()); last = { status: r.status, text: await r.text() }; if (pred(last)) return last; await sleep(400); }
  return last;
}
const SWITCH = `button[aria-label="Show verse prompts on members' home screens"]`;
async function openVerseTab() {
  await press('/^Settings$/', 'the Settings section');
  await waitFor(`[...document.querySelectorAll('button.set-item')].some(b => /Your website/.test(b.textContent||''))`, 20000, 'the Your website row');
  assert.equal(await evalIn(`(() => { const b=[...document.querySelectorAll('button.set-item')].find(b => /Your website/.test(b.textContent||'')); b.click(); return 'ok'; })()`), 'ok');
  await sleep(500);
  await press('/^Verse prompts$/', 'the Verse prompts tab');
  await waitFor(`document.querySelector(${JSON.stringify(SWITCH)}) && !document.querySelector(${JSON.stringify(SWITCH)}).disabled`, 30000, 'the verse-prompt switch (enabled: the engine has answered)');
}

test('CONTROL: a prompt sent with the switch OFF never reaches the public feed', { skip: SKIP, timeout: 240000 }, async () => {
  assert.equal(await evalIn(`window.Steward.whereChurchLives()`), 'this-computer', 'the console does not know the box holds its church');
  const sent = await evalIn(`window.Steward.publishVersePrompt('John 3:16', 'A PRIVATE NOTE', [{ at: 1900000000, ref: 'Psalms 23:1', note: 'ANOTHER NOTE' }]).then(r => !!(r && r.ts))`);
  assert.equal(sent, true, 're-anchor: the console could not send a verse prompt');
  await sleep(4000);
  assert.equal((await fetch(FEED())).status, 404, 'a verse prompt is public although nobody switched it on');
  assert.equal(heldBy(churchPub, 'trinityone/pubverse:').filter(r => !r.tombstone).length, 0, 'a public copy was written with the switch off');
});

test('Settings → Your website → Verse prompts → the switch: the prompt is on the feed, refs and times only', { skip: SKIP, timeout: 240000 }, async () => {
  await openVerseTab();
  assert.equal(await evalIn(`document.querySelector(${JSON.stringify(SWITCH)}).getAttribute('aria-checked')`), 'false', 'the switch is on before anyone touched it — it must default OFF');
  assert.equal(await evalIn(clickSel(SWITCH)), 'ok');
  await waitFor(`document.querySelector(${JSON.stringify(SWITCH)}).getAttribute('aria-checked') === 'true'`, 20000, 'the switch to read on');
  // OWNER 2026-11-16 (audit F9): the moment it is on, the screen must WARN that the passages AND their scheduled
  // times are public on the internet. Read off the rendered page, not the source.
  const warn = await evalIn(`(() => { const w = document.querySelector('[role="alert"][data-verse-public-warning]'); if (!w) return null; const r = w.getBoundingClientRect(); return { text: w.textContent || '', shown: r.height > 0 && r.width > 0 }; })()`);
  assert.ok(warn && warn.shown, 'with verse prompts switched on there is NO visible warning that they are public on the internet');
  assert.match(warn.text, /public/i);
  assert.match(warn.text, /times/i, 'the warning does not say the SCHEDULED TIMES are public too');
  const share = heldBy(churchPub, 'trinityone/share:').find(r => !r.tombstone);
  assert.ok(share && JSON.parse(share.content).versePrompt === true, 'the switch did not write versePrompt into the church\'s share: document');
  const got = await pollFeed(r => r.status === 200);
  assert.equal(got.status, 200, 'with the switch on, the console never put the verse prompt on the public feed (the reconciler did not write the copy)');
  const j = JSON.parse(got.text);
  assert.equal(j.ref, 'John 3:16');
  assert.deepEqual(j.schedule, [{ at: 1900000000, ref: 'Psalms 23:1' }]);
  assert.equal(/PRIVATE|ANOTHER NOTE|note/i.test(got.text), false, 'the note reached the public feed: ' + got.text);
  const held = heldBy(churchPub, 'trinityone/pubverse:').filter(r => !r.tombstone);
  assert.equal(held.length, 1);
  assert.equal(/PRIVATE|ANOTHER|note/i.test(held[0].content), false, 'the console wrote the NOTE into the public copy on the box: ' + held[0].content);
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

test('a new prompt replaces the copy; clearing the prompt takes it off; and the switch takes it off too', { skip: SKIP, timeout: 240000 }, async () => {
  await evalIn(`window.Steward.publishVersePrompt('Romans 8:28', '', undefined).then(() => 'ok')`);
  let got = await pollFeed(r => r.status === 200 && JSON.parse(r.text).ref === 'Romans 8:28');
  assert.equal(got.status === 200 && JSON.parse(got.text).ref, 'Romans 8:28', 'a newer prompt never replaced the public copy');
  await evalIn(`window.Steward.removeVersePrompt().then(() => 'ok')`);
  got = await pollFeed(r => r.status === 404);
  assert.equal(got.status, 404, 'a CLEARED prompt is still on the public feed');
  await evalIn(`window.Steward.publishVersePrompt('Isaiah 41:10', '', undefined).then(() => 'ok')`);
  got = await pollFeed(r => r.status === 200);
  assert.equal(got.status, 200, 're-anchor: a prompt sent after the clear was not mirrored');
  await openVerseTab();
  assert.equal(await evalIn(clickSel(SWITCH)), 'ok');
  await waitFor(`document.querySelector(${JSON.stringify(SWITCH)}).getAttribute('aria-checked') === 'false'`, 20000, 'the switch to read off');
  got = await pollFeed(r => r.status === 404);
  assert.equal(got.status, 404, 'turning the switch OFF left the verse prompt on the public feed');
  { const t0 = Date.now(); let live = 1; while (Date.now() - t0 < 20000) { live = heldBy(churchPub, 'trinityone/pubverse:').filter(r => !r.tombstone).length; if (!live) break; await sleep(400); }
    assert.equal(live, 0, 'switching off did not tombstone the public copy on the box (it is merely unserved)'); }
});
