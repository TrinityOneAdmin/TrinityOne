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
import { requireFreePort } from './test-ports.mjs';

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
  await requireFreePort(PORT, 'app-boots.test.mjs');
  await requireFreePort(CDP, 'app-boots.test.mjs (Chrome debug port)');
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
async function boot(path, { ms = 15000, seed = null, drive = null } = {}) {
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
    // WALK FURTHER IN, when a caller needs a screen that a first load never reaches. `drive` gets a small
    // helper that evaluates JS in the page and waits — enough to press through a wizard. Errors thrown while
    // driving are collected exactly like errors thrown at boot, which is the entire point: the screens behind
    // a login are the ones nothing else in this suite ever renders.
    if (drive) {
      const evalIn = async (expression) => {
        const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        return rr && rr.result && rr.result.result ? rr.result.result.value : undefined;
      };
      await drive({ evalIn, wait: sleep });
    }
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

test('the steward console mounts its DASHBOARD without throwing', { skip: !CHROME ? 'no chromium' : false, timeout: 180000 }, async () => {
  // THE ONE THAT BITES, for the console — the sibling of the member app's "WITH a church" case above.
  //
  // The test before this one stops at the LOCKED screen, which renders a PIN box and half a dozen components.
  // The dashboard renders dozens more: KeyDistributor, the capability mints, the nav, Members, Check-in. On
  // 2026-08-21 I added a guard referencing `church` to a component that has no such variable. EVERY unlocked
  // console died — "ReferenceError: church is not defined" — and the full suite was GREEN, because structural
  // tests read source as text, esbuild transpiles it happily (the file parses perfectly), and nothing here
  // ever rendered the screen. It was caught by hand, on a live console, hours later.
  //
  // Driving the real "Start a new church" path rather than seeding an encrypted key on purpose: the console
  // refuses to hold a plaintext seed, so a fixture would have to reproduce its AES-GCM/PBKDF2 format — and a
  // fixture that drifts from the real format silently stops testing anything. This cannot drift, because it
  // IS the path a steward walks.
  const r = await boot('/steward.html', { ms: 9000, drive: async ({ evalIn, wait }) => {
    const click = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`;
    const type = (ph, val) => `(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(ph)}));
      if(!i) return 'miss';
      const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
    await evalIn(click('/Start a new church/i')); await wait(2500);
    await evalIn(type('At least 8', 'cedar-harbour-lamp-42'));
    await evalIn(type('Type it again', 'cedar-harbour-lamp-42'));
    await evalIn(click('/Set PIN/i'));
    await wait(9000);   // key generation + first render of the whole dashboard
  } });

  assert.deepEqual(r.errors, [],
    `the console threw while rendering its dashboard:\n  ${r.errors.join('\n  ')}\n` +
    'This is the failure every other test in this suite is blind to: the file parses, the build succeeds, ' +
    'and the screen is dead.');
  // and it must actually have got there — a dashboard is far bigger than a PIN box, and asserting "no errors"
  // on a screen that never rendered would pass for ever.
  assert.ok(r.nodes > 120,
    `#root has ${r.nodes} nodes — the console did not reach its dashboard, so "no errors" proves nothing. ` +
    `Screen text: ${JSON.stringify(r.text)}`);
});
