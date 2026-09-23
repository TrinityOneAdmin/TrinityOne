// THE FORCED-PIN GATE'S BACK, DRIVEN ON THE REAL CONSOLE IN A REAL BROWSER.
// Run: node --test scripts/the-pin-gate-goes-back-in-a-browser.test.mjs
//
// Owner, 2026-09-22, on the Suite's first run: "We still need a back or cancel button at this stage."
// scripts/the-pin-gate-has-a-way-back.test.mjs mounts the gate and the root in the vm harness with a FAKE
// engine. This file is the row with nothing faked: the real steward.html off the real gateway, the real
// bundle's discardUnsavedKey, real localStorage, at the Suite's 900x780 window.
//   1. Start a new church → "Set a console PIN" → "Go back — nothing has been created yet" → the setup
//      choices, and localStorage holds no `trinityone.steward.church-key*`.
//   2. Start a new church → set a PIN → (reload: the console locks, the PIN opens it) → Settings → Church key →
//      Restore from a recovery phrase → "Set a console PIN" → "Keep my current church" → "Console locked" →
//      the SAME PIN opens the SAME church, and the ciphertext on disk is byte-for-byte what it was.
// Production hosts are black-holed: the console dials CANONICAL_RELAYS from any origin (app-boots.test.mjs).
// Skips itself when chromium is unavailable, like the other browser tests, so CI without a browser is green.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { generateSeedWords } from 'nostr-tools/nip06';
import { requireFreePort } from './test-ports.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const PORT = 8879, CDP = 9372;   // unique across scripts/*.test.mjs — a duplicate fixed port deadlocks both files
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PIN = 'cedar-harbour-lamp-42';
const ENC_LS = 'trinityone.steward.church-key.enc';

let relay, chr, ws, dataDir, prof, js, send;
const errors = [];

async function waitReady(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(200); }
  throw new Error('relay not ready');
}

before(async () => {
  if (!CHROME) return;
  await requireFreePort(PORT, 'the-pin-gate-goes-back-in-a-browser.test.mjs');
  await requireFreePort(CDP, 'the-pin-gate-goes-back-in-a-browser.test.mjs (Chrome debug port)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-pinback-'));
  const cp = getPublicKey(generateSecretKey());   // a THROWAWAY church, never a real npub
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
  });
  await waitReady();
  prof = join(tmpdir(), 'trin-pinback-chr-' + process.pid);
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=900,780', `http://127.0.0.1:${PORT}/steward.html`], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.method === 'Runtime.exceptionThrown') { const e = m.params.exceptionDetails; errors.push((e.exception?.description || e.text || '').split('\n')[0]); }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  js = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error('in-page: ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };
});

after(async () => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  try { relay && relay.kill('SIGKILL'); } catch {}
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
  try { dataDir && rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

// ── driving helpers: what a steward's finger does, read back from the DOM ──
const buttons = () => js(`JSON.stringify([...document.querySelectorAll('button')].map(b => (b.innerText||'').replace(/\\s+/g,' ').trim()).filter(Boolean))`);
const hasButton = (label) => js(`[...document.querySelectorAll('button')].some(b => ((b.innerText||'').replace(/\\s+/g,' ').indexOf(${JSON.stringify(label)}) >= 0))`);
const click = async (label) => {
  const hit = await js(`(() => { const b = [...document.querySelectorAll('button')].find(e => ((e.innerText||'').replace(/\\s+/g,' ').indexOf(${JSON.stringify(label)}) >= 0)); if (!b) return false; b.click(); return true; })()`);
  assert.ok(hit, `no button on screen said "${label}" — buttons were: ${await buttons()}`);
  await sleep(700);
};
// React listens for `input`; set the value through the prototype setter so the tracker sees a change
const type = (selector, val) => js(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); if (!i) return 'miss';
  const proto = i.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
const waitFor = async (expr, ms, why) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await js(expr)) return; } catch {} await sleep(500); }
  assert.fail(`timed out waiting for ${why} — buttons were: ${await buttons()}`);
};
// OPEN A SHUT SETTINGS GROUP BEFORE REACHING FOR A ROW INSIDE IT. The Settings index groups its pages under
// four disclosure headers; whether they start open or shut is a product decision that has moved (2026-09-22:
// shut by default in the Suite window, open on the phone). A steward reaching "Church key" presses SECURITY
// first when it is shut, so the walk does too — and does nothing when the header is already open or when
// this build has no group headers at all, which keeps this row honest on both sides of that change.
// Returns 'opened' | 'already-open' | 'no-header'.
//
// 'no-header' IS ONLY HONEST WHEN THE PAGE HAS NO GROUP HEADERS AT ALL (AUDIT-round-a-fixes-2026-09-22 F4).
// The first cut of this helper matched nothing — the expression below is a template literal, so its '\b' and
// '/\s+/' reached Chromium as a backspace and an 's' — and returned 'no-header' as though the build had no
// groups. The guard added with it, `['opened','already-open','no-header'].includes(r)`, admitted that value,
// so it could not have caught the bug it was added for. It now reports the headers it DID see and refuses
// 'no-header' whenever there are any: a build with no disclosure headers is a legitimate answer, a matcher
// that walks past four of them is not.
//
// AND THE WITNESS MUST NOT COME FROM THE SAME SELECTOR AS THE SUSPECT (AUDIT-round-c C9). `headers` used to
// be mapped from the very `button[aria-expanded]` query the matcher searches, so the one regression class
// that would empty the match — the group headers rendered WITHOUT aria-expanded, an ordinary a11y change —
// emptied the evidence with it: r = 'no-header', headers = [], `deepEqual(headers, [])` passed, and the
// helper reported "there was nothing to press" in silence. MEASURED at 2444129 by scoping exactly that
// change to the Settings group header in app/stew-dashboard.jsx: this file stayed 2 pass / 0 fail.
// The headers are now counted by their own class (`.set-grp`, stew-dashboard.jsx's disclosure button),
// which no part of the matcher touches — so "no headers on this page" has to be true of the PAGE, not just
// of the query that failed. And when the matcher does find something, the same independent selector has to
// agree that what it found is a group header.
const openSettingsGroup = async (name) => {
  // A PLAIN PREFIX MATCH, no regex, for the reason above.
  const raw = await js(`(() => {
    const hs = [...document.querySelectorAll('button[aria-expanded]')];
    const grp = [...document.querySelectorAll('button.set-grp')];
    const headers = grp.map(e => (e.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 40));
    const b = hs.find(e => (e.innerText || '').trim().toLowerCase().indexOf(${JSON.stringify(name)}.toLowerCase()) === 0);
    if (!b) return JSON.stringify({ r: 'no-header', headers });
    const witnessed = grp.indexOf(b) >= 0;
    if (b.getAttribute('aria-expanded') === 'true') return JSON.stringify({ r: 'already-open', headers, witnessed });
    b.click(); return JSON.stringify({ r: 'opened', headers, witnessed });
  })()`);
  const { r, headers, witnessed } = JSON.parse(raw);
  assert.ok(['opened', 'already-open', 'no-header'].includes(r), 'openSettingsGroup read back ' + JSON.stringify(r));
  if (r !== 'no-header') assert.equal(witnessed, true,
    'openSettingsGroup pressed a button[aria-expanded] that is not one of the Settings group headers (.set-grp). ' +
    'The headers it can see are ' + JSON.stringify(headers) + '. Either the matcher hit some other disclosure ' +
    'on the page, or the group header class was renamed — in which case the witness this guard depends on is ' +
    'no longer independent of the attribute the matcher uses (AUDIT-round-c C9).');
  if (r === 'no-header') assert.deepEqual(headers, [],
    'openSettingsGroup found no "' + name + '" group header, but this page HAS ' + headers.length + ' collapsible header(s): ' +
    JSON.stringify(headers) + '. That is a broken matcher, not a build without groups — and a silent "there ' +
    'was nothing to press" is how this walk went green over a Settings index it never opened (F4).');
  if (r === 'opened') await sleep(700);
  return r;
};
const heading = () => js(`(document.querySelector('h1')||{}).innerText || ''`);
const keyRows = () => js(`JSON.stringify(Object.keys(localStorage).filter(k => k.startsWith('trinityone.steward.church-key')))`);
const setupScreen = async () => (await hasButton('Start a new church')) && (await hasButton('Restore a church')) && (await hasButton('Help run a church'));
const startNewChurch = async () => {
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Start a new church/.test(b.innerText||''))`, 90000, 'the setup choices');
  await click('Start a new church');
  await waitFor(`(document.querySelector('h1')||{}).innerText === 'Set a console PIN'`, 15000, 'the Set a console PIN gate');
};
const setPin = async () => {
  await type('input[aria-label="Choose a console PIN or passphrase"]', PIN);
  await type('input[aria-label="Repeat the console PIN or passphrase"]', PIN);
  await click('Set PIN & enter');
};
const unlock = async () => {
  await waitFor(`(document.querySelector('h1')||{}).innerText === 'Console locked'`, 15000, 'the Console locked screen');
  await type('input[placeholder="Your PIN or passphrase"]', PIN);
  await click('Unlock');
  await waitFor(`window.Steward && window.Steward.hasKey && !window.Steward.locked && !window.Steward.needsPin`, 20000, 'the PIN to open the church');
};

test('Start a new church → the gate → "Go back — nothing has been created yet" → the setup choices, with no church key in storage', { skip: !CHROME ? 'no chromium' : false, timeout: 180000 }, async () => {
  await startNewChurch();
  assert.equal(await js(`JSON.stringify({ hasKey: window.Steward.hasKey, needsPin: window.Steward.needsPin })`), '{"hasKey":true,"needsPin":true}', 'the gate is up without an unsaved key behind it — re-anchor');
  assert.equal(await hasButton('Go back — nothing has been created yet'), true, `THE DEFECT: the gate has no way back after Start a new church. Buttons: ${await buttons()}`);
  assert.equal(await hasButton('Keep my current church'), false, 'a brand-new church was offered "Keep my current church"');

  await click('Go back — nothing has been created yet');
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Start a new church/.test(b.innerText||''))`, 15000, 'the setup choices to come back');
  assert.equal(await setupScreen(), true, `after Back the screen is not the setup choices — buttons: ${await buttons()}`);
  assert.notEqual(await heading(), 'Set a console PIN', 'the gate is still on screen after Back');
  assert.equal(await keyRows(), '[]', 'a church-key row is in localStorage after going back from a church that was never created');
  assert.equal(await js(`localStorage.getItem('trinityone.steward.newchurch')`), null, 'the newchurch wizard marker survived Back');
  assert.equal(await js(`JSON.stringify({ hasKey: window.Steward.hasKey, needsPin: window.Steward.needsPin, locked: window.Steward.locked })`), '{"hasKey":false,"needsPin":false,"locked":false}', 'the engine still holds the discarded key');
  // and the device is genuinely reusable: a second Start a new church reaches the gate again, with a DIFFERENT key
  await click('Start a new church');
  await waitFor(`(document.querySelector('h1')||{}).innerText === 'Set a console PIN'`, 15000, 'the gate on the second attempt');
  await click('Go back — nothing has been created yet');
  await waitFor(`[...document.querySelectorAll('button')].some(b => /Start a new church/.test(b.innerText||''))`, 15000, 'the setup choices, second time');
  assert.equal(await keyRows(), '[]');
});

test('Restore over an existing church → the gate → "Keep my current church" → the current church still opens with its PIN, ciphertext untouched', { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  // a real church on the device: Start a new church, set the PIN. The wizard is kept off (see
  // the-console-fits-a-360px-phone.test.mjs for why refusing the delete is the only non-racy way).
  await js(`(() => { const orig = Storage.prototype.removeItem; Storage.prototype.removeItem = function (k) { if (k === 'trinityone.steward.wizard.done') return; return orig.call(this, k); };
    localStorage.setItem('trinityone.steward.wizard.done', '1'); return 'ok'; })()`);
  await startNewChurch();
  await setPin();
  await waitFor(`window.Steward && window.Steward.hasKey && !window.Steward.needsPin && localStorage.getItem(${JSON.stringify(ENC_LS)})`, 20000, 'the PIN to save the church');
  const npub = await js(`window.Steward.npub`);
  const ct = await js(`localStorage.getItem(${JSON.stringify(ENC_LS)})`);
  assert.ok(npub && ct, 're-anchor: no church was saved');

  // reload straight into Settings: the console must lock, and the PIN must open it (the baseline "openable")
  await js(`location.href = location.pathname + '?tab=settings'`);
  await sleep(2000);
  await unlock();
  assert.equal(await js(`window.Steward.npub`), npub, 'the PIN opened a different church than the one just created');
  await waitFor(`[...document.querySelectorAll('button')].some(b => /^(Church key|SECURITY)/.test((b.innerText||'').trim()))`, 30000, 'the Settings index (its Church key row, or the Security group that holds it)');
  await openSettingsGroup('SECURITY');
  await waitFor(`[...document.querySelectorAll('button')].some(b => /^Church key/.test((b.innerText||'').trim()))`, 30000, 'the Settings index with its Church key row');
  await js(`(() => { const b = [...document.querySelectorAll('button')].find(e => /^Church key/.test((e.innerText||'').trim())); b.click(); return 1; })()`);
  await sleep(800);
  await click('Restore from a recovery phrase');
  await js(`window.confirm = () => true`);   // "This replaces the church currently on this device" — a real confirm parks headless Chromium for ever
  assert.equal(await type('textarea[placeholder="word one  word two  word three …"]', generateSeedWords()), 'ok', 're-anchor: the restore textarea is gone');
  await sleep(300);
  await click('Restore church');
  await waitFor(`(document.querySelector('h1')||{}).innerText === 'Set a console PIN'`, 15000, 'the gate after a restore');
  assert.equal(await js(`window.Steward.npub === ${JSON.stringify(npub)}`), false, 're-anchor: the restore did not put a different key in memory');
  assert.equal(await hasButton('Keep my current church'), true, `THE DEFECT: no "Keep my current church" on the gate after a restore over an existing church. Buttons: ${await buttons()}`);
  assert.equal(await hasButton('nothing has been created yet'), false, 'a restore over an existing church was labelled as if nothing existed');

  await click('Keep my current church');
  await unlock();
  assert.equal(await js(`window.Steward.npub`), npub, 'THE OLD PIN OPENED THE WRONG CHURCH after "Keep my current church"');
  assert.equal(await js(`localStorage.getItem(${JSON.stringify(ENC_LS)})`), ct, 'the previous church’s ciphertext changed under "Keep my current church"');
  await waitFor(`document.querySelectorAll('#root *').length > 40`, 30000, 'the dashboard to come back up');
  assert.notEqual(await heading(), 'Set a console PIN', 'the gate came back after the church was kept');
  assert.notEqual(await heading(), 'Console locked', 'the console stayed locked after the right PIN');
  const bad = errors.filter(e => !/WebSocket|net::ERR|Failed to fetch|NetworkError/.test(e));   // the black-holed production relays log connection failures; those are the guard working
  assert.deepEqual(bad, [], 'uncaught exceptions on the page during the walk');
});
