// THE SCREEN, NOT THE ENGINE. Loads the real member app in a real browser against a real relay and reads what a
// pending member is TOLD about their request to join — before and after a relay has actually accepted it.
// Run: node --test scripts/a-join-while-locked-is-not-lost.test.mjs
//
// Device pass 2026-09-06 (/mnt/storage/tmp/trinity-scratch/round3/AUTH-DIAGNOSIS.md): a PIN-locked phone
// followed a church; nothing was queued or sent; the Today card said "Your request has been sent". The engine
// half of that fix lives in scripts/join-while-locked.test.mjs. This file exists because the copy lives in
// app/*.jsx, which ships unbundled — a `false &&` in front of the condition leaves every word in place and a
// text assertion still passes (CLAUDE.md rule 3). Only reading the rendered DOM can tell.
//
// Skips itself when chromium is unavailable, like app-boots.test.mjs. Fixed ports; requireFreePort refuses to
// run over a concurrent suite rather than fail on a collision.
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
const PORT = 8941, CDP = 9381;   // unique across scripts/*.mjs — 8897 was relay-clearance's, and the two collided in the suite
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
  await requireFreePort(PORT, 'a-join-while-locked-is-not-lost.test.mjs');
  await requireFreePort(CDP, 'a-join-while-locked-is-not-lost.test.mjs (Chrome debug port)');
  if (!CHROME) return;
  dataDir = mkdtempSync(join(tmpdir(), 'trin-join-'));
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
  const prof = mkdtempSync(join(tmpdir(), 'trin-join-chr-'));
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

test('a pending member is not told "your request has been sent" until a relay has accepted it', { skip: !CHROME ? 'no chromium' : false, timeout: 180000 }, async () => {
  const b = await browser();
  try {
    await b.waitText(/TrinityOne/, 40000, 'the app to mount');
    const me = await b.ev(SEED(false));
    assert.match(me, /^[0-9a-f]{64}$/, 'no identity was created');
    // Hold the boot heartbeat back for this launch so nothing announces on its own: the question is what the
    // screen says when NOTHING has been sent, and then what it says once something has.
    await b.ev(`localStorage.setItem('trinityone.hb:' + ${JSON.stringify(NPUB)}, String(Date.now()))`);
    await b.reload(2000);
    let t = await b.waitText(/Waiting to be let in/, 40000, 'the pending card (the church may not have been read as approval-gated)');
    await sleep(2000);   // let the card settle on its final wording before reading it
    t = await b.text();
    assert.equal(memberDocs(me).length, 0, 'the relay already holds a join — the heartbeat was not held back');
    assert.doesNotMatch(t, /has been sent/, 'the Today card says the request has been sent, and the relay holds nothing');
    assert.match(t, /hasn’t been sent yet/, 'the Today card does not say the request has not been sent');
    // Through to the pending screen (the card's button), which must say the same thing…
    await b.click('Check again');
    t = await b.waitText(/Waiting for approval/, 15000, 'the pending screen');
    assert.doesNotMatch(t, /has been sent/, 'the pending screen says the request has been sent, and the relay holds nothing');
    assert.match(t, /hasn’t been sent yet/, 'the pending screen does not say the request has not been sent');
    assert.match(t, /Not sent yet/, 'the badge still claims "Pending steward approval" over a request no steward has');
    // …and its Check again is the thing that actually sends it.
    await b.click('Check again', 3000);
    t = await b.waitText(/has been sent/, 15000, '"has been sent" after the relay accepted the join');
    assert.equal(memberDocs(me).length, 1, 'the screen says sent, and the relay does not hold the join');
    assert.doesNotMatch(t, /hasn’t been sent yet/, 'the screen still says not-sent over a join the relay holds');
    assert.match(t, /Pending steward approval/, 'the badge did not follow the fact');
    const stamp = JSON.parse(await b.ev(`localStorage.getItem('trinityone.joinsent')`) || '{}');
    assert.equal(stamp[CP] && stamp[CP].pub, me, 'the "sent" fact was not recorded for this identity');
    assert.deepEqual(b.errors, [], `the app threw:\n  ${b.errors.join('\n  ')}`);
  } finally { b.close(); }
});

// Enter the PIN through the real lock screen: the field, then the Unlock button.
async function unlockViaScreen(b) {
  await b.waitText(/Enter your PIN/, 30000, 'the PIN screen');
  const typed = await b.ev(`(() => { const i = [...document.querySelectorAll('input')].find(i => /pin/i.test(i.placeholder || '') || i.type === 'password'); if (!i) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '123456'); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  assert.ok(typed, 'no PIN field on the lock screen');
  await b.click('Unlock', 1000);
}

test('the sequence from the phone: set a PIN, boot locked, follow a church, unlock — the join lands, and the screen never says it was sent before it was', { skip: !CHROME ? 'no chromium' : false, timeout: 300000 }, async () => {
  const b = await browser();
  try {
    await b.waitText(/TrinityOne/, 40000, 'the app to mount');
    const me = await b.ev(SEED(true));
    assert.match(me, /^[0-9f0-9a-f]{64}$/, 'no identity was created');
    // NOTE on what this half can and cannot prove. A locked boot wipes hb:<npub> (clearCommunityCache), so
    // the boot heartbeat ALWAYS fires keyless here and records the same intent the follow link's handler
    // does: deleting either call alone leaves this green. That is real redundancy on a PIN phone, not a
    // blind test — the heartbeat door is isolated in the second half, the follow-link door in the last test.
    // the follow link, opened on a phone that boots PIN-locked (params are scrubbed on arrival, so this is the one chance)
    await b.nav(`/index.html?follow=${NPUB}&relay=${encodeURIComponent(RELAY)}`, 1000);
    await b.waitText(/Enter your PIN/, 40000, 'a locked boot');
    await sleep(6000);   // long enough for the relay round-trips the old code used to make
    assert.equal(await b.ev('window.TrinityIdentity.isLocked()'), true, 'the app did not boot locked');
    let intents = JSON.parse(await b.ev(`localStorage.getItem('trinityone.joinintent')`) || '[]');
    assert.deepEqual(intents.map(i => [i.cp, i.forPub]), [[CP, me]], 'no join intent was recorded for the locked identity');
    assert.equal(await b.ev(`localStorage.getItem('trinityone.outbox')`) || '[]', '[]', 'something unsigned was queued in the outbox');
    assert.equal(memberDocs(me).length, 0, 'a locked phone published a join — with what key?');
    let t = await b.text();
    assert.doesNotMatch(t, /has been sent/, 'the screen says the request has been sent while the phone is locked and nothing left it');
    // …and says what is actually true: it will be asked for when the PIN goes in. Neither "sent" nor a bare
    // "not sent" (which reads as a fault, with a Check again that cannot help while locked).
    assert.match(t, /when you unlock/, 'a locked phone with a queued join does not tell the person it will be sent when they unlock');
    assert.doesNotMatch(t, /hasn’t been sent yet/, 'the locked phone reads its own promise as a fault');
    // …unlock, through the real lock screen
    await unlockViaScreen(b);
    t = await b.waitText(/has been sent/, 30000, '"has been sent" after unlocking');
    assert.equal(memberDocs(me).length, 1, 'the screen says sent, and the relay does not hold the join');
    const firstAt = memberDocs(me)[0].created_at;
    intents = JSON.parse(await b.ev(`localStorage.getItem('trinityone.joinintent')`) || '[]');
    assert.deepEqual(intents, [], 'the intent was kept after it was acted on');
    // The boot heartbeat door: lock (which wipes hb:<npub>), relaunch locked, unlock. The heartbeat fires
    // keyless at boot and used to bail silently; now it leaves an intent, and the unlock re-announces.
    await b.ev(`(() => { window.TrinityIdentity.lock(); return true; })()`);
    await sleep(1500);
    await b.reload(1000);
    await b.waitText(/Enter your PIN/, 40000, 'a locked relaunch');
    await sleep(5000);
    intents = JSON.parse(await b.ev(`localStorage.getItem('trinityone.joinintent')`) || '[]');
    assert.deepEqual(intents.map(i => [i.cp, i.forPub]), [[CP, me]], 'the boot heartbeat ran keyless and left no intent behind');
    await sleep(1500);   // the relay stores created_at in seconds; make the re-announce distinguishable
    await unlockViaScreen(b);
    await b.waitText(/has been sent/, 30000, '"has been sent" after the second unlock');
    const t0 = Date.now(); let docs = memberDocs(me);
    while (Date.now() - t0 < 15000 && !(docs.length && docs[docs.length - 1].created_at > firstAt)) { await sleep(500); docs = memberDocs(me); }
    assert.ok(docs.length && docs[docs.length - 1].created_at > firstAt, 'the heartbeat door: unlocking after a locked boot did not re-announce the join');
    assert.deepEqual(b.errors, [], `the app threw:\n  ${b.errors.join('\n  ')}`);
  } finally { b.close(); }
});

test('an intent left by a different identity is refused when THIS key arrives — nobody joins on someone else\'s behalf', { skip: !CHROME ? 'no chromium' : false, timeout: 180000 }, async () => {
  const b = await browser();
  try {
    await b.waitText(/TrinityOne/, 40000, 'the app to mount');
    const me = await b.ev(SEED(false));
    const stranger = getPublicKey(generateSecretKey());
    // a promise made on this device by a previous identity, for THIS church; hb held back so only the intent could announce
    await b.ev(`localStorage.setItem('trinityone.joinintent', JSON.stringify([{ cp: ${JSON.stringify(CP)}, forPub: ${JSON.stringify(stranger)}, at: 1 }])); localStorage.setItem('trinityone.hb:' + ${JSON.stringify(NPUB)}, String(Date.now()))`);
    await b.reload(2000);
    await b.waitText(/Waiting to be let in/, 40000, 'the pending card');
    await sleep(4000);
    assert.equal(await b.ev(`localStorage.getItem('trinityone.joinintent')`), '[]', 'the stranger\'s intent was not dropped');
    assert.equal(memberDocs(me).length, 0, 'this identity announced a join that another identity asked for');
    assert.equal(memberDocs(stranger).length, 0);
    assert.doesNotMatch(await b.text(), /has been sent/);
    assert.deepEqual(b.errors, [], `the app threw:\n  ${b.errors.join('\n  ')}`);
  } finally { b.close(); }
});

test('the follow link itself announces the join (unlocked; heartbeat held back so nothing else can)', { skip: !CHROME ? 'no chromium' : false, timeout: 180000 }, async () => {
  const b = await browser();
  try {
    await b.waitText(/TrinityOne/, 40000, 'the app to mount');
    const me = await b.ev(SEED(false));
    // an onboarded member with no church yet; hb for the church seeded so the heartbeat stays quiet on the next launch
    await b.ev(`localStorage.setItem('trinityone.followedChurches', '[]'); localStorage.removeItem('trinityone.activeChurch'); localStorage.setItem('trinityone.hb:' + ${JSON.stringify(NPUB)}, String(Date.now()))`);
    await b.nav(`/index.html?follow=${NPUB}&relay=${encodeURIComponent(RELAY)}`, 1000);
    await b.waitText(/has been sent/, 40000, '"has been sent" after opening the follow link');
    assert.equal(memberDocs(me).length, 1, 'the screen says sent, and the relay does not hold the join');
    assert.equal(await b.ev(`localStorage.getItem('trinityone.joinintent')`) || '[]', '[]', 'an intent was recorded on a phone that had its key');
    assert.deepEqual(b.errors, [], `the app threw:\n  ${b.errors.join('\n  ')}`);
  } finally { b.close(); }
});
