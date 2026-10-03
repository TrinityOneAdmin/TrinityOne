// TYPING 12 WORDS MUST ASK BEFORE IT REPLACES AN ACCOUNT THAT HAS BEEN USED. Sim item 15 (2026-10-02).
// Run: node --test scripts/restore-typed-words-ask-first.test.mjs
//
// The defect: doRestore (app/identity.jsx) called importMnemonic -- which DELETES the stored key before it stores the
// new one -- with no check at all. One wrong word that still passed the checksum swapped a member's account for a
// stranger's, with no warning and no way back. The backup-file route had always asked; the typed-words route never did.
//
// Driven through the real welcome fork in a real browser (rule 1: point of use). Nothing here reads app/*.jsx text
// (rule 3). Skips itself when chromium is unavailable, like restore-typed-words-ask-first.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { requireFreePort } from './test-ports.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const PORT = 8781, CDP = 9441;   // unique across scripts/*.test.mjs -- a duplicate fixed port deadlocks both files
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
  await requireFreePort(PORT, 'restore-typed-words-ask-first.test.mjs');
  await requireFreePort(CDP, 'restore-typed-words-ask-first.test.mjs (Chrome debug port)');
  if (!CHROME) return;
  dataDir = mkdtempSync(join(tmpdir(), 'trin-typed-'));
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
  const prof = join(tmpdir(), 'trin-chr-typed-' + process.pid + '-' + profileTag);
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


const CHURCH_NAME = 'St Aidan Testville';
// Make this phone look USED: the welcome fork still shows (onboarded stays false) but a church is followed, which is
// exactly how the app itself decides "there is an account here worth asking about".
async function markUsed(d) {
  await d.js(`(() => { const np = 'npub1' + 'q'.repeat(58); localStorage.setItem('trinityone.followedChurches', JSON.stringify([{ id: np, npub: np, name: ${JSON.stringify(CHURCH_NAME)}, initials: 'ST', sub: 'Followed' }])); localStorage.setItem('trinityone.activeChurch', JSON.stringify(np)); return 1; })()`);
}
async function toWordsScreen(d) {
  await d.click('I’ve used it before');
  await d.click('I have my 12 words');
  await d.waitFor(`!!document.querySelector('textarea')`, 8000, 'the words box');
}
const typeWords = (d, w) => d.js(`(() => { const t = document.querySelector('textarea'); const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; set.call(t, ${JSON.stringify(w)}); t.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
const boxValue = (d) => d.js(`(document.querySelector('textarea') || {}).value || ''`);
const npubNow = (d) => d.js(`(window.TrinityIdentity.current || {}).npub || ''`);
const isMine = (d, w) => d.js(`window.TrinityIdentity.whoseMnemonic(${JSON.stringify(w)}) === 'match'`);

test('typing someone else’s 12 words on a used phone asks first, names the church, keeps the words, and only replaces on a second yes', { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  const d = await freshDevice('ask');
  try {
    await markUsed(d);
    const other = generateMnemonic(wordlist);
    const before = await npubNow(d);
    assert.ok(before, 'the phone has no identity to protect -- the fixture is wrong');
    await toWordsScreen(d);
    await typeWords(d, other);
    await d.click('Restore my account');
    await sleep(800);
    const asked = await d.text();
    assert.match(asked, new RegExp('already have an account with ' + CHURCH_NAME), `no warning naming the church appeared:\n${asked.slice(0, 600)}`);
    assert.equal(await npubNow(d), before, 'the account was replaced BEFORE the member answered');
    assert.equal(await isMine(d, other), false, 'the typed words were adopted before the member said yes');
    assert.equal(await boxValue(d), other, 'the typed words were thrown away by the warning');
    assert.ok(await d.hasButton('Replace it and restore'), 'the button does not say what it will do');
    // "Keep my account" backs out and leaves the words where they are.
    await d.click('Keep my account');
    assert.doesNotMatch(await d.text(), /already have an account/i, 'the warning stayed up after "Keep my account"');
    assert.equal(await boxValue(d), other, '"Keep my account" lost the typed words');
    assert.equal(await npubNow(d), before, '"Keep my account" still changed the account');
    // Editing the words withdraws any consent: a corrected phrase is asked about afresh.
    await d.click('Restore my account');
    assert.match(await d.text(), /already have an account/i, 'second attempt was not asked');
    await typeWords(d, other + ' ');
    assert.doesNotMatch(await d.text(), /already have an account/i, 'editing the words left the old warning up');
    await d.click('Restore my account');
    assert.match(await d.text(), /already have an account/i, 'the edited words were not asked about again');
    // The second yes replaces.
    await d.click('Replace it and restore');
    await d.waitFor(`(() => { try { return window.TrinityIdentity.whoseMnemonic(${JSON.stringify(other)}) === 'match'; } catch (e) { return false; } })()`, 20000, 'the confirmed restore to take effect');
    assert.notEqual(await npubNow(d), before, 'saying yes did not replace the account');
  } finally { d.close(); }
});

test('a phrase that fails its checksum is told so, not met with a "this replaces your account" scare', { skip: !CHROME ? 'no chromium' : false, timeout: 180000 }, async () => {
  const d = await freshDevice('bad');
  try {
    await markUsed(d);
    const before = await npubNow(d);
    await toWordsScreen(d);
    await typeWords(d, 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon');   // right length, wrong checksum
    await d.click('Restore my account');
    await sleep(600);
    const t = await d.text();
    assert.match(t, /valid|check the words/i, `no "not a valid phrase" message:\n${t.slice(0, 500)}`);
    assert.doesNotMatch(t, /already have an account/i, 'an invalid phrase was treated as a different account');
    assert.equal(await npubNow(d), before);
  } finally { d.close(); }
});

test('typing the words of the account already on the phone is NOT warned about', { skip: !CHROME ? 'no chromium' : false, timeout: 180000 }, async () => {
  const d = await freshDevice('same');
  try {
    await markUsed(d);
    const mine = await d.js(`window.TrinityIdentity.exportMnemonic()`);
    assert.equal(String(mine).split(' ').length, 12, 'could not read this phone’s own words for the fixture');
    const before = await npubNow(d);
    await toWordsScreen(d);
    await typeWords(d, mine);
    await d.click('Restore my account');
    await sleep(1200);
    const t = await d.text();
    assert.doesNotMatch(t, /already have an account/i, 'a member typing their OWN words was scared with a replace warning');
    assert.ok(/Checking your words|Finding your church|couldn’t find your church|could not find your church/i.test(t), `the restore did not go ahead:\n${t.slice(0, 400)}`);
    assert.equal(await npubNow(d), before, 'restoring your own words changed who you are');
  } finally { d.close(); }
});

test('a phone nobody has used yet restores different words without any warning', { skip: !CHROME ? 'no chromium' : false, timeout: 180000 }, async () => {
  const d = await freshDevice('fresh');
  try {
    const other = generateMnemonic(wordlist);
    await toWordsScreen(d);
    await typeWords(d, other);
    await d.click('Restore my account');
    await sleep(1500);
    assert.doesNotMatch(await d.text(), /already have an account/i, 'a brand-new phone was warned about an account it does not have');
    await d.waitFor(`(() => { try { return window.TrinityIdentity.whoseMnemonic(${JSON.stringify(other)}) === 'match'; } catch (e) { return false; } })()`, 20000, 'the restore to take effect');
  } finally { d.close(); }
});
