// Does the app actually BOOT? Loads the real member app and the real steward console in a real browser.
// Run: node --test scripts/app-boots.test.mjs
//
// 2026-07-26: I shipped `ReferenceError: emit is not defined` to the phone AND to the live relay. The member
// app rendered nothing — a white screen — and the full suite was 273 GREEN the whole time, because not one of
// those tests ever loaded the page. A regex cleanup had left an `emit,` property in a method with no `emit` in
// scope; unit tests over source text and vendor bundles cannot see that, and neither can a build, because the
// file parses perfectly. Only running it fails.
//
// This is deliberately shallow and slow: it does not assert features, only that each app mounts something into
// #root and throws no uncaught exception while doing it. That is the single cheapest guard against the worst
// failure class in this project — the app that looks installed and shows nothing.
//
// Skips itself (rather than failing) when chromium is unavailable, so CI without a browser stays green.
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
const PORT = 8893, CDP = 9350;
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
  dataDir = mkdtempSync(join(tmpdir(), 'trin-boot-'));
  const cp = getPublicKey(generateSecretKey());
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
  });
  await waitReady();
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// Load one page and report what mounted + every uncaught error it produced.
// `seed` is localStorage written BEFORE the app's real load: booting a first-run app with no church exercises
// almost none of the subscription code, so the shallow version of this test missed the very ReferenceError it
// was written for. We seed a followed+active church so the church-doc subscriptions actually run.
async function boot(path, { ms = 15000, seed = null } = {}) {
  const prof = join(tmpdir(), 'trin-chr-' + process.pid + '-' + Math.abs(path.split('').reduce((a, c) => a + c.charCodeAt(0), 0)));
  // Never let a test reach production. The app dials wss://app.trinityone.church and the Tailscale funnel from
  // CANONICAL_RELAYS regardless of where the page came from; resolving them to a dead local port means a test
  // cannot write to the live relay even by accident.
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu',
    BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=1280,1200', `http://127.0.0.1:${PORT}${path}`], { stdio: 'ignore' });
  try {
    let targets = null;
    for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch {} }
    assert.ok(targets && targets.length, 'chromium never exposed a debug target');
    const page = targets.find(t => t.type === 'page') || targets[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    let id = 0; const pend = new Map(); const errors = [];
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.method === 'Runtime.exceptionThrown') {
        const e = m.params.exceptionDetails;
        errors.push((e.exception?.description || e.text || '').split('\n')[0]);
      }
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    });
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Runtime.enable');
    if (seed) {
      // write the state, then reload so the app mounts WITH it (and drop errors from the throwaway first load)
      await sleep(2500);
      await send('Runtime.evaluate', { expression: `(() => { ${Object.entries(seed).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(JSON.stringify(v))});`).join('')} })()`, returnByValue: true });
      errors.length = 0;
      await send('Page.enable');
      await send('Page.reload', { ignoreCache: false });
    }
    await sleep(ms);
    const r = await send('Runtime.evaluate', {
      expression: `JSON.stringify({ nodes: document.querySelectorAll('#root *').length, body: document.querySelectorAll('body *').length, text: (document.body.innerText||'').trim().slice(0,80) })`,
      returnByValue: true,
    });
    ws.close();
    return { ...JSON.parse(r.result.result.value), errors };
  } finally { try { chr.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} }
}

// A church the app will treat as followed + active. It MUST be freshly generated, never a real npub.
//
// 2026-07-26: this was hardcoded to the OWNER'S REAL CHURCH. The member app always dials CANONICAL_RELAYS
// (a8) no matter which relay serves the page, so every headless boot minted a fresh identity, followed that
// church and announced membership — putting an "Anonymous wants to join" request on the owner's live console.
// Each `npm test` boots three. Fifteen of them piled up before anyone noticed.
// Two independent guards now: a throwaway church per run, AND chromium is pointed at a black hole for the
// production hosts (see BLOCK_PROD) so no test traffic can reach a8 even if something else regresses.
const CHURCH = npubEncode(getPublicKey(generateSecretKey()));
const SEEDED = {
  'trinityone.onboarded': true,
  'trinityone.activeChurch': CHURCH,
  'trinityone.followedChurches': [{ id: CHURCH, npub: CHURCH, name: 'Boot Test Church', initials: 'BT', sub: 'Followed' }],
};

test('the member app mounts and throws nothing', { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
  const r = await boot('/index.html');
  // A ReferenceError in any subscribe method leaves React with an empty #root while every script still parses.
  assert.deepEqual(r.errors, [], `the member app threw during boot:\n  ${r.errors.join('\n  ')}`);
  assert.ok(r.nodes > 20, `#root has ${r.nodes} nodes — the member app rendered nothing (white screen)`);
  assert.ok(r.text.length > 0, 'the member app rendered no text');
});

test('the member app mounts WITH a church without throwing', { skip: !CHROME ? 'no chromium' : false, timeout: 150000 }, async () => {
  // This is the one that bites. With a church active the app runs subscribeChurchGroups, subscribeCareNeeds,
  // subscribeMealsSettings, subscribeMessageTags and the rest — where a ReferenceError in any single one blanks
  // the whole screen while every file still parses and every unit test stays green.
  const r = await boot('/index.html', { seed: SEEDED, ms: 18000 });
  assert.deepEqual(r.errors, [], `the member app threw with a church active:\n  ${r.errors.join('\n  ')}`);
  assert.ok(r.nodes > 20, `#root has ${r.nodes} nodes — white screen with a church active`);
});

test('the steward console mounts and throws nothing', { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
  const r = await boot('/steward.html');
  assert.deepEqual(r.errors, [], `the console threw during boot:\n  ${r.errors.join('\n  ')}`);
  assert.ok(r.nodes > 20, `#root has ${r.nodes} nodes — the console rendered nothing`);
});
