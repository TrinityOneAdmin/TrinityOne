// A STEWARD'S APPROVAL MUST SURVIVE A LATER COPY OF THE LIST FROM THE CHURCH. Sim item 22 (2026-10-02).
// Run: node --test scripts/a-steward-approval-survives-a-later-church-copy.test.mjs
//
// `admitted:<church>` is one replaceable document PER AUTHOR: the church writes one, and every steward who approves
// somebody writes their own. The relay's gate unions them, and so does the console -- but the member app's
// subscribeChurchJoin kept a single `admitted` variable and overwrote it with whichever arrived last. So when the
// church's copy (which does not carry the steward's names) came after a steward's, the phone of a member the steward
// had approved stayed on "Waiting for approval" while the relay was already treating them as in.
//
// Driven in a real browser against a real relay: the steward's list names this phone and is OLDER, the church's list
// does not name it and is NEWER (so replay delivers the church's last -- the failing order). What the app concluded is
// read from the join state it caches for its own offline reopen. Nothing here reads app/*.jsx text (rule 3).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const PORT = 8783, CDP = 9443;   // unique across scripts/*.test.mjs -- a duplicate fixed port deadlocks both files
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nowS = () => Math.floor(Date.now() / 1000);
let relay, dataDir, relayWs;
const churchSk = generateSecretKey(), churchPub = getPublicKey(churchSk), churchNpub = npubEncode(churchPub);
const stewardSk = generateSecretKey(), stewardPub = getPublicKey(stewardSk);
const otherPub = getPublicKey(generateSecretKey());   // somebody the church itself approved

async function waitReady(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(200); }
  throw new Error('relay not ready');
}
const put = (evt) => new Promise(res => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { relayWs.off('message', on); res(m); } }; relayWs.on('message', on); relayWs.send(JSON.stringify(['EVENT', evt])); });

before(async () => {
  await requireFreePort(PORT, 'a-steward-approval-survives-a-later-church-copy.test.mjs');
  await requireFreePort(CDP, 'a-steward-approval-survives-a-later-church-copy.test.mjs (Chrome debug port)');
  if (!CHROME) return;
  dataDir = mkdtempSync(join(tmpdir(), 'trin-twoadmit-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: churchNpub, RELAY_MAX_EVENTS: '5000' },
  });
  await waitReady();
  relayWs = new WebSocket(WS_URL);
  await new Promise((res, rej) => { relayWs.on('open', res); relayWs.on('error', rej); });
  // The church, as setup leaves it: a profile, a join policy that REQUIRES APPROVAL, and a roster naming one steward.
  const ok = async (evt, what) => { const m = await put(evt); assert.equal(m[2], true, `${what} refused by the relay: ${m[3]}`); };
  await ok(finalizeEvent({ kind: 0, created_at: nowS(), tags: [], content: JSON.stringify({ name: 'St Test' }) }, churchSk), 'church profile');
  await ok(finalizeEvent({ kind: 30078, created_at: nowS(), tags: [['d', 'trinityone/joinpolicy:' + churchPub], ['t', 'trinityone']], content: JSON.stringify({ approval: true }) }, churchSk), 'join policy');
  await ok(finalizeEvent({ kind: 30078, created_at: nowS(), tags: [['d', 'trinityone/stewards:' + churchPub], ['t', 'trinityone']], content: JSON.stringify({ pubkeys: [stewardPub] }) }, churchSk), 'steward roster');
});
after(() => { try { relayWs && relayWs.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// One browser, driven by hand. Returns helpers; the caller closes it.
async function open(profileTag) {
  const prof = join(tmpdir(), 'trin-chr-twoadmit-' + process.pid + '-' + profileTag);
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
  let id = 0; const pend = new Map(); const errors = []; const frames = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.method === 'Network.webSocketFrameSent') frames.push(String((m.params.response || {}).payloadData || ''));
    if (m.method === 'Runtime.exceptionThrown') { const e = m.params.exceptionDetails; errors.push((e.exception?.description || e.text || '').split('\n')[0]); }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
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
  return { js, text, pageText, buttons, click, waitFor, hasButton, errors, close, frames };
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




// Open a set-up phone, learn its key, and return it still waiting on the follow link.
async function phone(tag) {
  const d = await open(tag);
  await sleep(2500);
  await d.js(`(() => { localStorage.setItem('trinityone.relays', ${JSON.stringify(JSON.stringify([WS_URL]))}); localStorage.setItem('trinityone.onboarded', 'true'); return 1; })()`);
  await d.js(`location.reload()`);
  await d.waitFor(`!!(window.Fellowship && window.Fellowship.myPubkey)`, 40000, 'this phone to have a key');
  const me = await d.js(`window.Fellowship.myPubkey`);
  return { d, me };
}
const follow = (d) => d.js(`location.href = '/index.html?follow=' + ${JSON.stringify(churchNpub)}`);
const cachedJoin = (d) => d.js(`localStorage.getItem('trinityone.joinstate.' + ${JSON.stringify(churchNpub)}) || ''`);
async function whenJoinStateIs(d, want, why) {
  const t0 = Date.now(); let last = '';
  while (Date.now() - t0 < 60000) {
    last = await cachedJoin(d);
    try { const s = JSON.parse(last || 'null'); if (s && s.approval === true && !!s.isAdmitted === want) return s; } catch {}
    await sleep(500);
  }
  assert.fail(`${why} -- the join state this phone reached was: ${last || '(nothing cached)'}`);
}

test('a member the STEWARD approved stays admitted on their phone when the church\u2019s list, which does not name them, arrives afterwards', { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  const { d, me } = await phone('steward');
  try {
    // The phone is open and waiting FIRST, so the two lists reach it live and in the order they are published: the
    // steward's, then the church's. (Stored documents come back in whatever order the relay chooses, which is why a
    // test that publishes both before the phone opens can pass on the old code.)
    await follow(d);
    await whenJoinStateIs(d, false, 'the phone never reached "approval required, not yet admitted"');
    const m1 = await put(finalizeEvent({ kind: 30078, created_at: nowS(), tags: [['d', 'trinityone/admitted:' + churchPub], ['t', 'trinityone'], ['church', churchPub]], content: JSON.stringify({ pubkeys: [me] }) }, stewardSk));
    assert.equal(m1[2], true, 'the relay refused the steward\u2019s approval list, so this test would prove nothing: ' + m1[3]);
    await whenJoinStateIs(d, true, 'the steward\u2019s approval never reached the phone at all');
    const m2 = await put(finalizeEvent({ kind: 30078, created_at: nowS() + 1, tags: [['d', 'trinityone/admitted:' + churchPub], ['t', 'trinityone']], content: JSON.stringify({ pubkeys: [otherPub] }) }, churchSk));
    assert.equal(m2[2], true, 'the relay refused the church\u2019s list: ' + m2[3]);
    // The church's list is now the newest thing the phone has been told. It must not undo the steward's approval.
    await sleep(1500);
    for (let i = 0; i < 10; i++) {
      const s = JSON.parse(await cachedJoin(d) || 'null');
      assert.ok(s && s.isAdmitted === true && s.isPending === false, 'a later copy of the list from the church un-admitted a member the steward had approved: ' + JSON.stringify(s));
      await sleep(500);
    }
  } finally { d.close(); }
});

test('a member NEITHER list names is still waiting (the union does not admit everybody)', { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  const { d } = await phone('nobody');
  try {
    await follow(d);
    const s = await whenJoinStateIs(d, false, 'a member nobody approved was not reported as waiting');
    assert.equal(s.isPending, true);
  } finally { d.close(); }
});
