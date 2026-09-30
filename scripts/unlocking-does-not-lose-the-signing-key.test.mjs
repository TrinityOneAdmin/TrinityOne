// UNLOCKING DOES NOT LOSE THE SIGNING KEY — AND LOCKING STILL DOES.
// Run: node --test scripts/unlocking-does-not-lose-the-signing-key.test.mjs
//
// a34a5bd made "Lock now" really lock: the member app's 'trinity-identity-lock' handler clears the signing key.
// But the PIN screen (app/identity.jsx) fires that SAME event after a SUCCESSFUL unlock, to make the app re-read
// its lock state. Whenever it landed after the key had loaded, the member was left signed in on screen and unable
// to send anything until a restart. Found by the 2026-09-30 status check, measured the same day in a real browser
// by delaying the event (the order a phone's slower key read produces). Never shipped: main's handler re-derives.
//
// HOW IT ASSERTS. The real member app, a real relay, a real browser, the real PIN screen. "Can send" is measured
// by asking the shipped engine to sign and publish a reply; a key-less engine returns nothing. The late event is
// the same dispatch the PIN screen makes, just made again after the key has loaded.
// Harness copied from a-join-while-locked-is-not-lost.test.mjs (house style: each browser test owns its ports).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { DatabaseSync } from 'node:sqlite';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const PORT = 8952, CDP = 9392;   // unique across scripts/*.mjs
const ROOT = new URL('..', import.meta.url).pathname;
const RELAY = `ws://127.0.0.1:${PORT}/relay`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const churchSk = generateSecretKey(), CP = getPublicKey(churchSk), NPUB = npubEncode(CP);
let relay, dataDir;

async function waitReady(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(200); }
  throw new Error('relay not ready');
}
// publish one event as the church and wait for the relay's OK
function publishAsChurch(tmpl) {
  return new Promise((res, rej) => {
    const evt = finalizeEvent(tmpl, churchSk);
    const ws = new WebSocket(RELAY);
    const t = setTimeout(() => { ws.close(); rej(new Error('no OK for ' + evt.id)); }, 8000);
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', evt])));
    ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m[0] === 'OK' && m[1] === evt.id) { clearTimeout(t); ws.close(); m[2] ? res(evt) : rej(new Error(m[3])); } });
  });
}
// what the relay actually holds — read straight off its store, no gate in the way
function memberDocs(pub) {
  const db = new DatabaseSync(join(dataDir, 'relay.sqlite'), { readOnly: true });
  try { return db.prepare('select created_at from events where dtag = ? and pubkey = ? order by created_at').all('trinityone/member:' + CP, pub); }
  finally { db.close(); }
}

before(async () => {
  await requireFreePort(PORT, 'unlocking-does-not-lose-the-signing-key.test.mjs');
  await requireFreePort(CDP, 'unlocking-does-not-lose-the-signing-key.test.mjs (Chrome debug port)');
  if (!CHROME) return;
  dataDir = mkdtempSync(join(tmpdir(), 'trin-unlock-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: NPUB, RELAY_MAX_EVENTS: '5000' },
  });
  await waitReady();
  // a church that requires approval — the only kind with a "waiting to be let in" screen
  await publishAsChurch({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', 'trinityone/joinpolicy:' + CP], ['t', 'trinityone']], content: JSON.stringify({ approval: true }) });
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// One browser, driven over CDP. `ev` evaluates and awaits; `text` is the rendered page; `click` presses the
// first button whose visible label starts with the given words.
async function browser() {
  const prof = mkdtempSync(join(tmpdir(), 'trin-unlock-chr-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD,
    `--user-data-dir=${prof}`, '--window-size=900,1400', `http://127.0.0.1:${PORT}/index.html`], { stdio: 'ignore' });
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
  const ev = async (expression) => { const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (rr.result?.exceptionDetails) throw new Error('in page: ' + JSON.stringify(rr.result.exceptionDetails.exception?.description || rr.result.exceptionDetails.text)); return rr.result?.result?.value; };
  return {
    ev, errors,
    nav: async (path, ms) => { await send('Page.navigate', { url: `http://127.0.0.1:${PORT}${path}` }); await sleep(ms); },
    reload: async (ms) => { await send('Page.reload', { ignoreCache: false }); await sleep(ms); },
    text: () => ev('(document.body.innerText || "").replace(/\\s+/g, " ")'),
    // The app compiles its screens in the browser (Babel) and mounts several seconds in; poll for words, never sleep for them.
    waitText: async (re, ms = 30000, what = String(re)) => { const t0 = Date.now(); let t = ''; while (Date.now() - t0 < ms) { t = await ev('(document.body.innerText || "").replace(/\\s+/g, " ")'); if (re.test(t)) return t; await sleep(500); } assert.fail(`waited ${ms}ms and never saw ${what}; screen reads: "${t.slice(0, 200)}"`); },
    click: async (label, ms = 1500) => { const hit = await ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => (b.innerText || '').trim().startsWith(${JSON.stringify(label)})); if (!b) return false; b.click(); return true; })()`); assert.ok(hit, `no button labelled "${label}" on screen`); await sleep(ms); },
    close: () => { try { ws.close(); } catch {} try { chr.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} },
  };
}
// an onboarded member of this church, with its own relay list pointed at the test relay
const SEED = (pinSet) => `(async () => {
  localStorage.setItem('trinityone.onboarded', 'true');
  try { await window.TrinityIdentity.ready; } catch (e) {}
  await window.TrinityIdentity.regenerate();
  localStorage.setItem('trinityone.relays', JSON.stringify([${JSON.stringify(RELAY)}]));
  localStorage.setItem('trinityone.followedChurches', JSON.stringify([{ id: ${JSON.stringify(NPUB)}, npub: ${JSON.stringify(NPUB)}, name: 'Join Test Church', initials: 'JT', sub: 'Followed' }]));
  localStorage.setItem('trinityone.activeChurch', JSON.stringify(${JSON.stringify(NPUB)}));
  ${pinSet ? "await window.TrinityIdentity.setPin('123456');" : ''}
  return (window.TrinityIdentity.current || {}).pubkey;
})()`;

// Enter the PIN through the real lock screen: the field, then the Unlock button.
async function unlockViaScreen(b) {
  await b.waitText(/Enter your PIN/, 30000, 'the PIN screen');
  const typed = await b.ev(`(() => { const i = [...document.querySelectorAll('input')].find(i => /pin/i.test(i.placeholder || '') || i.type === 'password'); if (!i) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '123456'); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  assert.ok(typed, 'no PIN field on the lock screen');
  await b.click('Unlock', 1000);
}


// Ask the shipped engine to sign something. With a key it publishes and answers { ok, ... } (the relay may refuse a
// made-up request — that still proves a signed event was sent). Without one it returns nothing.
const CAN_SEND = `(async () => {
  const r = await Promise.race([window.Fellowship.respondToServingRequest(${JSON.stringify(NPUB)}, 'probe', 'accept'), new Promise(res => setTimeout(() => res('timeout'), 8000))]);
  return { signed: !!(r && typeof r === 'object'), myPubkey: window.Fellowship.myPubkey || null, locked: !!window.TrinityIdentity.locked };
})()`;

test('locked -> unlock -> the stray event arrives late -> still able to send; then Lock now -> not able to send', { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  const b = await browser();
  try {
    await b.waitText(/TrinityOne/, 40000, 'the app to mount');
    const me = await b.ev(SEED(true));
    assert.match(me, /^[0-9a-f]{64}$/, 'no identity was created');
    await b.reload(3000);
    let s = await b.ev(CAN_SEND);
    assert.deepEqual([s.signed, s.locked], [false, true], 'CONTROL: a phone that booted locked could sign, or did not read as locked');

    await unlockViaScreen(b);
    await sleep(2000);
    s = await b.ev(CAN_SEND);
    assert.equal(s.locked, false, 'the real PIN screen did not unlock');
    assert.equal(s.signed, true, 'after unlocking through the PIN screen the app cannot send');

    // The PIN screen's own dispatch, landing AFTER the key loaded — the order a phone produces.
    await b.ev(`window.dispatchEvent(new CustomEvent('trinity-identity-lock'))`);
    await sleep(2000);
    s = await b.ev(CAN_SEND);
    assert.equal(s.myPubkey, me, 'the unlock event arriving late cleared the member\'s identity from the engine');
    assert.equal(s.signed, true, 'the unlock event arriving late left an unlocked member unable to send');

    // And the other direction must still hold: the real "Lock now" forgets the key.
    await b.ev(`window.TrinityIdentity.lock()`);
    await sleep(1500);
    s = await b.ev(CAN_SEND);
    assert.equal(s.locked, true, 'Lock now did not lock');
    assert.equal(s.signed, false, 'after Lock now the phone can still sign');
    assert.deepEqual(b.errors, [], `the app threw:\n  ${b.errors.join('\n  ')}`);
  } finally { b.close(); }
});
