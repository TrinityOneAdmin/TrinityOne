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

// Polls instead of sleeping a fixed time. In-browser Babel has to transpile every JSX file before the first
// screen exists, and on a busy box (the whole suite running) that is far longer than the 9s this used to
// assume: both dashboard tests passed alone and failed in the suite for that reason alone. `settles` returns
// the LAST value it saw, so when the budget runs out the caller's own assertion still runs and still reports
// what it always reported; a screen that really never arrives still fails, just at the budget.
async function settles(probe, ok, budget = 90000) {
  const t0 = Date.now();
  for (;;) {
    const v = await probe();
    if (ok(v) || Date.now() - t0 > budget) return v;
    await new Promise(r => setTimeout(r, 250));
  }
}
// …and the other half: wait until a value STOPS changing (unchanged for `quiet` ms), or `budget` runs out.
async function settled(probe, { quiet = 3000, budget = 15000 } = {}) {
  const t0 = Date.now();
  let last = await probe(), since = Date.now();
  while (Date.now() - t0 < budget && Date.now() - since < quiet) {
    await new Promise(r => setTimeout(r, 250));
    const v = await probe();
    if (v !== last) { last = v; since = Date.now(); }
  }
  return last;
}

// Load one page and report what mounted + every uncaught error it produced.
// `seed` is localStorage written BEFORE the app's real load: booting a first-run app with no church exercises
// almost none of the subscription code, so the shallow version of this test missed the very ReferenceError it
// was written for. We seed a followed+active church so the church-doc subscriptions actually run.
async function boot(path, { ms = 15000, seed = null, drive = null, tag = '' } = {}) {
  // `ms` is no longer a fixed sleep (see `settled` below): it caps the quiet window after the app has MOUNTED.
  // `tag` gives a boot its OWN profile. Two boots of the same path share a name otherwise, and measured
  // 2026-09-07: the second steward boot in one run woke up to the first's localStorage — a console already
  // holding a PIN-locked key — and landed on "Console locked" instead of the dashboard, every run. With its
  // own profile name it does not. (Why the wipe in `finally` did not take is not known; no profile dir was
  // left behind.)
  const prof = join(tmpdir(), 'trin-chr-' + process.pid + '-' + tag + Math.abs(path.split('').reduce((a, c) => a + c.charCodeAt(0), 0)));
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
    const evalIn = async (expression) => {
      const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      return rr && rr.result && rr.result.result ? rr.result.result.value : undefined;
    };
    const rootNodes = () => evalIn(`document.querySelectorAll('#root *').length`);
    if (seed) {
      // write the state, then reload so the app mounts WITH it (and drop errors from the throwaway first load).
      // Wait for the throwaway load to have an origin to write to — polled, not a fixed 2.5 s.
      await settles(() => evalIn(`document.readyState`), v => v === 'complete', 60000);
      await send('Runtime.evaluate', { expression: `(() => { ${Object.entries(seed).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(JSON.stringify(v))});`).join('')} })()`, returnByValue: true });
      errors.length = 0;
      await send('Page.enable');
      const firstLoad = await evalIn(`performance.timeOrigin`);
      await send('Page.reload', { ignoreCache: false });
      // the mount poll below must read the RELOADED page, not the throwaway one still on screen
      await settles(() => evalIn(`performance.timeOrigin`), v => v != null && v !== firstLoad, 60000);
    }
    // POLLED, NOT SLEPT (2026-11-13). This was a fixed `sleep(ms)` (15 s, 18 s with a church), and the suite run
    // on 120cc727 recorded "the member app mounts and throws nothing" with #root at 0 nodes: in-browser Babel
    // transpiles every JSX file before the first screen exists, and under full-suite load that took longer than
    // the sleep. Now: wait (up to 90 s) for the app to MOUNT, then for the tree to SETTLE — the node count
    // unchanged for 3 s — within at most `ms` more, so the subscriptions that run once a screen is up get their
    // chance to throw. A white screen still fails, at the budget, with the same assertion as before.
    await settles(rootNodes, n => n > 20, 90000);
    await settled(rootNodes, { quiet: 3000, budget: ms });
    // WALK FURTHER IN, when a caller needs a screen that a first load never reaches. `drive` gets a small
    // helper that evaluates JS in the page and waits — enough to press through a wizard. Errors thrown while
    // driving are collected exactly like errors thrown at boot, which is the entire point: the screens behind
    // a login are the ones nothing else in this suite ever renders.
    if (drive) await drive({ evalIn, wait: sleep });
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

// In-page helpers, as source strings for Runtime.evaluate: press the button whose text matches, type into the
// input whose placeholder contains. And the walk from a fresh console to its dashboard — "Start a new church",
// a PIN, and the wait for key generation — shared by every test that needs to be past the locked screen.
const click = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`;
const type = (ph, val) => `(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(ph)}));
  if(!i) return 'miss';
  const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
// `settles` (the poll used throughout) is defined above boot().
const toDashboard = async ({ evalIn, wait }) => {
  await settles(() => evalIn(click('/Start a new church/i')), v => v === 'ok');
  await settles(() => evalIn(type('At least 8', 'cedar-harbour-lamp-42')), v => v === 'ok');
  await evalIn(type('Type it again', 'cedar-harbour-lamp-42'));
  await evalIn(click('/Set PIN/i'));
  // key generation + first render of the whole dashboard: wait for it to be as big as a dashboard is
  await settles(() => evalIn(`document.querySelectorAll('#root *').length`), v => v > 120);
};

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
  const r = await boot('/steward.html', { ms: 9000, drive: toDashboard });

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

// THE CONSOLE'S HELP, IN THE REAL PAGE. scripts/steward-help.test.mjs proves the dialog through a miniature
// React; this one presses the same control in Chromium with every script steward.html loads sharing one real
// global scope — which is where a duplicate top-level name, a missing <script> tag, or a help file that
// assumes something only the member app has (window.TrinityIdentity) would actually show up.
test('a steward can open Help from the dashboard, read a guide, and Escape out of it', { skip: !CHROME ? 'no chromium' : false, timeout: 180000 }, async () => {
  const seen = {};
  const r = await boot('/steward.html', { ms: 9000, tag: 'help-', drive: async (d) => {
    await toDashboard(d);
    const { evalIn, wait } = d;
    const dialog = `document.querySelector('[role="dialog"][aria-label="Help"]')`;
    await settles(() => evalIn(`!![...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Help')`), v => v === true);
    seen.pressed = await evalIn(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Help'); if(!b) return 'miss'; b.click(); return 'ok'; })()`);
    seen.screen = await evalIn(`(document.body.innerText||'').trim().slice(0,240)`);
    await settles(() => evalIn(`!!${dialog} && ${dialog}.querySelectorAll('[data-help-id]').length`), v => v > 0, 30000);
    seen.list = await evalIn(`(() => { const d=${dialog}; if(!d) return null;
      const ids=[...d.querySelectorAll('[data-help-id]')].map(e=>e.getAttribute('data-help-id'));
      const known=new Set(((window.HelpData||{}).articles||[]).map(a=>a.id));
      return { ids, unknown: ids.filter(i=>!known.has(i)) }; })()`);
    await evalIn(`(() => { const b=document.querySelector('[data-help-id="console"]'); if(b) b.click(); })()`);
    await settles(() => evalIn(`(() => { const d=${dialog}; const a=((window.HelpData||{}).articles||[]).find(x=>x.id==='console'); const p=a&&(a.blocks||[]).find(b=>b.type==='p'); return !d || (!!p && (d.innerText||'').includes(p.text.slice(0,60))); })()`), v => v === true, 30000);
    seen.guide = await evalIn(`(() => { const d=${dialog}; if(!d) return null;
      const a=(window.HelpData.articles||[]).find(x=>x.id==='console'); const p=(a.blocks||[]).find(b=>b.type==='p');
      return { hasFirstParagraph: !!p && (d.innerText||'').includes(p.text.slice(0,60)), title: (d.querySelector('h2')||{}).textContent||'' }; })()`);
    await evalIn(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); })()`);
    seen.afterEscape = await settles(() => evalIn(`!!${dialog}`), v => v === false, 10000);
  } });
  assert.deepEqual(r.errors, [], `the console threw while opening Help:\n  ${r.errors.join('\n  ')}`);
  assert.equal(seen.pressed, 'ok', `no control with the accessible name "Help" on the dashboard. Screen text: ${JSON.stringify(seen.screen)}`);
  assert.ok(seen.list, 'pressing Help opened no dialog with role=dialog and the name "Help"');
  assert.ok(seen.list.ids.length >= 6, `only ${seen.list.ids.length} guides listed: ${JSON.stringify(seen.list.ids)}`);
  assert.deepEqual(seen.list.unknown, [], 'guides listed that are not in window.HelpData');
  assert.ok(seen.guide, 'the dialog vanished when a guide was opened');
  assert.ok(seen.guide.hasFirstParagraph, `the console guide's first paragraph is not on screen (title shown: ${JSON.stringify(seen.guide.title)})`);
  assert.equal(seen.afterEscape, false, 'Escape did not close the help dialog in the real page');
});
