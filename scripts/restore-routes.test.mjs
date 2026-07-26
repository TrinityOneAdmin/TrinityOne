// The three ways back into an account, driven through the REAL screens in a REAL browser.
// Run: node --test scripts/restore-routes.test.mjs
//
// AUDIT-2026-07-26 CRITICALs 1 and 2. Both were render-flow bugs, and both were invisible to every kind of test
// this project had: the code parsed, the units passed, and the member was still stuck.
//   1. finishRestore left `rMode === 'xfer'` when it found no church, so the transfer screen kept winning the
//      render and the no-church screen — built for exactly that case — could never be reached. The member sat
//      on "Bringing your account across…" forever with a disabled Back button.
//   2. The "I've lost my 12 words" route never wrote `onboarded`, so "Done — take me to my church" reloaded
//      into the welcome wizard, which asked a member their steward had just reconnected whether they had ever
//      used TrinityOne before. The scanner they asked for was consumed underneath it and never appeared.
// So this clicks the actual buttons and reads the actual screen. Nothing here can be satisfied by source text.
//
// Skips itself (rather than failing) when chromium is unavailable, like app-boots.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const PORT = 8895, CDP = 9352;   // unique across scripts/*.test.mjs — a duplicate fixed port deadlocks both files
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let relay, dataDir;

async function waitReady(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(200); }
  throw new Error('relay not ready');
}

before(async () => {
  if (!CHROME) return;
  dataDir = mkdtempSync(join(tmpdir(), 'trin-routes-'));
  const cp = getPublicKey(generateSecretKey());   // a THROWAWAY church, never a real one
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
  });
  await waitReady();
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// One browser, driven by hand. Returns helpers; the caller closes it.
async function open(profileTag) {
  const prof = join(tmpdir(), 'trin-chr-routes-' + process.pid + '-' + profileTag);
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  // Headless throttles timers on a page it considers hidden, so the splash's own dismissal never fires and the
  // app looks broken (scripts/onboarding-shot.probe.mjs was written after I nearly reported that as a bug).
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=420,900', `http://127.0.0.1:${PORT}/index.html`], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map(); const errors = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.method === 'Runtime.exceptionThrown') { const e = m.params.exceptionDetails; errors.push((e.exception?.description || e.text || '').split('\n')[0]); }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  const js = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails));
    return r.result.result.value;
  };
  // The restore panes and the wizard are full-screen overlays (z-index 70/71) drawn OVER the running app, so
  // document.body.innerText is the app underneath them as well and matches almost anything. Read the overlay.
  const text = () => js(`(() => { const els = [...document.querySelectorAll('div')].filter(e => { const z = getComputedStyle(e).zIndex; return z === '70' || z === '71'; }); return els.length ? (els[els.length - 1].innerText || '') : ''; })()`);
  const pageText = () => js(`(document.body.innerText || '')`);
  const buttons = () => js(`JSON.stringify([...document.querySelectorAll('button')].map(b => (b.innerText || '').replace(/\\s+/g, ' ').trim()).filter(Boolean))`);
  // click the first button whose visible label contains this string — i.e. what a member's thumb does
  const click = async (label) => {
    const hit = await js(`(() => { const b = [...document.querySelectorAll('button')].find(e => ((e.innerText||'').indexOf(${JSON.stringify(label)}) >= 0)); if (!b) return false; b.click(); return true; })()`);
    assert.ok(hit, `no button on screen said "${label}" — buttons were: ${await buttons()}`);
    await sleep(600);
  };
  // poll until an expression is truthy; the app mounts slowly in headless with the production relays blackholed
  const waitFor = async (expr, ms = 25000, why = '') => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await js(expr)) return true; await sleep(500); }
    assert.fail(`timed out waiting for ${why || expr} — buttons were: ${await buttons()}`);
  };
  const hasButton = (label) => js(`[...document.querySelectorAll('button')].some(e => ((e.innerText||'').indexOf(${JSON.stringify(label)}) >= 0))`);
  const close = () => { try { ws.close(); } catch {} try { chr.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} };
  return { js, text, pageText, buttons, click, waitFor, hasButton, errors, close };
}

// A first-run device pointed at the local relay, with the splash out of the way.
async function freshDevice(tag) {
  const d = await open(tag);
  await sleep(2500);
  await d.js(`localStorage.setItem('trinityone.relays', ${JSON.stringify(JSON.stringify([WS_URL]))})`);
  await d.js(`location.reload()`);
  // the splash sits over everything for a moment and dismisses itself on a timer; keep clicking it away
  for (let i = 0; i < 20; i++) {
    await d.js(`(() => { const s = document.querySelector('.to-splash'); if (s) s.click(); return 1; })()`);
    if (await d.hasButton('I’m new here')) break;
    await sleep(1000);
  }
  await d.waitFor(`[...document.querySelectorAll('button')].some(e => ((e.innerText||'').indexOf('I’m new here') >= 0))`, 20000, 'the welcome fork');
  return d;
}

test('“I’ve lost my 12 words” → “take me to my church” does not land back in the welcome wizard', { skip: !CHROME ? 'no chromium' : false, timeout: 180000 }, async () => {
  const d = await freshDevice('lost');
  try {
    assert.match(await d.text(), /used TrinityOne before/i, 'a first launch must ask the new-or-returning question');
    await d.click('I’ve used it before');
    await d.click('I’ve lost my 12 words');
    assert.match(await d.text(), /Ask your church/i, 'the lost-words screen did not open');
    await d.click('Done — take me to my church');
    await sleep(10000);   // this route reloads the app
    await d.waitFor(`document.querySelectorAll('#root *').length > 20`, 30000, 'the app to come back up');
    assert.equal(await d.hasButton('I’m new here'), false,
      'the welcome wizard came back and asked a member their steward had just reconnected whether they were new here');
    assert.equal(await d.js(`localStorage.getItem('trinityone.onboarded')`), 'true',
      'the lost-words route still leaves the device looking un-onboarded');
    // and the thing they actually asked for — the church scanner — must be what they got, not a silent app
    assert.match(await d.pageText(), /follow|scan|church code|add a church/i,
      `the church scanner never opened after the reconnect handoff — buttons were: ${await d.buttons()}`);
  } finally { d.close(); }
});

test('a transfer that finds no church reaches the no-church screen instead of hanging', { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  const d = await freshDevice('xfer');
  try {
    // Record what beginTransfer hands the screen, so this test can play the OLD phone with the same bundle.
    // Nothing in the app is modified — we only observe its return value.
    await d.js(`(() => { const ID = window.TrinityIdentity, orig = ID.beginTransfer.bind(ID); window.__xfer = null; ID.beginTransfer = () => { const r = orig(); window.__xfer = r; return r; }; return 1; })()`);
    await d.click('I’ve used it before');
    await d.click('I still have my old phone');
    assert.match(await d.text(), /old phone/i, 'the transfer screen did not open');
    const qr = await d.js(`(window.__xfer || {}).qr || ''`);
    assert.match(qr, /^trinityone:xfer:[0-9a-f]{64}$/, 'the new phone did not mint a throwaway key');
    await d.click('My old phone has scanned it');
    // Headless has no camera, so the scanner shows its paste box — which is the same fallback a member with a
    // broken camera gets, and it did not exist before AUDIT-2026-07-26 #8.
    assert.ok(await d.js(`!!document.querySelector('[data-qr-manual]')`),
      'no camera and no way to paste — the transfer route is a dead end on any phone that cannot scan');
    const sealed = await d.js(`(async () => { const s = await window.TrinityIdentity.sealTransfer(window.__xfer.qr); window.__sealed = s; return JSON.stringify(s); })()`);
    const { qr: payload, code } = JSON.parse(sealed);
    await d.js(`(() => { const t = document.querySelector('[data-qr-manual]'); const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; set.call(t, ${JSON.stringify(payload)}); t.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
    await sleep(400);
    await d.click('Use this code');
    await sleep(1500);
    // The check code must now be on screen AND must be the one the sealing side computed, or the member is
    // being asked to compare two numbers that were never meant to agree. AUDIT-2026-07-26 S5.
    const checking = await d.text();
    assert.match(checking, /check code/i, `the confirm step never appeared:\n${checking.slice(0, 500)}`);
    assert.ok(checking.includes(code), `the two sides disagree on the check code (sealing side said "${code}"):\n${checking.slice(0, 500)}`);
    await d.click('They match');
    // finishRestore now runs against a relay that has never heard of this key: no church to find. That is the
    // exact case CRITICAL 1 dead-ended on.
    await sleep(25000);
    const after = await d.text();
    assert.doesNotMatch(after, /Bringing your account across/i,
      'still sitting on "Bringing your account across…" — this is the permanent dead-end, and Back was disabled');
    assert.match(after, /couldn’t find your church|could not find your church/i,
      `the no-church screen was never reached:\n${after.slice(0, 500)}`);
  } finally { d.close(); }
});

test('declining the check code leaves the member as themselves', { skip: !CHROME ? 'no chromium' : false, timeout: 180000 }, async () => {
  const d = await freshDevice('reject');
  try {
    await d.js(`(() => { const ID = window.TrinityIdentity, orig = ID.beginTransfer.bind(ID); window.__xfer = null; ID.beginTransfer = () => { const r = orig(); window.__xfer = r; return r; }; return 1; })()`);
    const before = await d.js(`(window.TrinityIdentity.current || {}).npub || ''`);
    await d.click('I’ve used it before');
    await d.click('I still have my old phone');
    await d.click('My old phone has scanned it');
    const payload = await d.js(`(async () => (await window.TrinityIdentity.sealTransfer(window.__xfer.qr)).qr)()`);
    await d.js(`(() => { const t = document.querySelector('[data-qr-manual]'); const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; set.call(t, ${JSON.stringify(payload)}); t.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
    await sleep(400);
    await d.click('Use this code');
    await sleep(1500);
    await d.click('They’re different');
    await sleep(1200);
    assert.equal(await d.js(`(window.TrinityIdentity.current || {}).npub || ''`), before,
      'saying the codes differ still changed who this phone is');
    assert.doesNotMatch(await d.text(), /check code/i, 'the confirm screen stayed up after the member said no');
    // The npub check above cannot bite hard here — with one browser the "old phone" is this phone, so an
    // account adopted by mistake looks identical. (scripts/identity-transfer.test.mjs runs two independent
    // bundles and DOES catch that.) What this can prove is that saying no actually threw the decrypted words
    // away rather than merely hiding the screen: nothing is left to confirm afterwards.
    const left = await d.js(`window.TrinityIdentity.confirmTransfer().then(() => 'ADOPTED').catch(e => e.message)`);
    assert.match(String(left), /Nothing to confirm/i,
      'the 12 words were still sitting in memory after the member said the codes did not match');
  } finally { d.close(); }
});
