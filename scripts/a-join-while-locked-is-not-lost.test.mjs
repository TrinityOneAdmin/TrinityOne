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
const PORT = 8897, CDP = 9357;
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
