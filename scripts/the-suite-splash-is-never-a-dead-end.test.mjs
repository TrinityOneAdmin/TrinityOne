// THE SUITE'S "Starting your relay…" SPLASH IS NEVER A DEAD END, AND A FIRST LAUNCH STAYS ON THE LAUNCHER.
// Run: node --test scripts/the-suite-splash-is-never-a-dead-end.test.mjs
//
// Owner, 2026-09-19, on a fresh Ubuntu box: pressing the relay panel's own "← Back" landed on the bundled
// splash — no links, no address bar, nothing but quitting the app. The launcher's first-run redirect to the
// panel ran before the load event, which REPLACES the launcher's history entry (measured here at 3a8c980:
// [about:blank, control] — home.html's entry GONE, `href` or not), so `history.back()` from the panel landed
// below the launcher.
//
// Then the owner's first run of the REAL AppImage, 2026-09-22: the app opened on the relay panel, nothing said
// the two doors were one page back, and after the relay wizard nothing said the church is created in the
// console. So the redirect is gone altogether (relay-app/home.js): a first launch stays on the launcher, and
// test 1 here is the browser proving it — a fresh home.html off a real gateway, read three seconds later.
//
// And the splash itself carries two doors and says what it is waiting for, so a Back that reaches it — a Back
// from the launcher can, on any launch — is still not a trap (tests 2–5). Its first door is the LAUNCHER, the
// page the shell itself opens once the relay answers; the second is the console. The splash is served here
// from a plain static server because the gateway refuses to serve relay-app/desktop/ (deliberately: those are
// build sources), and it is pointed at the test's gateway with `?relay=`, which the shell never passes.
//
// TWO BOXES (2026-09-27). The launcher reads the BOX, never a marker, so the rows need two gateways: an
// EMPTY one for "a first launch stays on the launcher", and one seeded with a throwaway church for the
// owner's Back route, whose whole point is the launcher's two DOORS. See the second test for the detail.
//
// WHAT THIS CANNOT PROVE: the real shell is WebKitGTK, not Chromium; only a Suite build on a desktop shows
// the real window — the owner intends to check that Back by hand, and nothing in this file stands in for it.
// NOTHING REACHES PRODUCTION: the shipped hosts resolve to a dead port in the browser and
// are refused inside the gateway.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { freePort } from './relay-network-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const SPLASH = join(ROOT, 'relay-app/desktop/src-tauri/dist/index.html');

// ── a fresh Suite install: an EMPTY data dir, loopback, no origin, the shipped hosts refused ──────────────
const BLACKHOLE = `const real = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const u = String(input && input.url ? input.url : input);
  if (/trinityone\\.church|\\.ts\\.net|trycloudflare/i.test(u)) return Promise.reject(new Error('blackholed by test: ' + u));
  return real.call(this, input, init);
};\n`;
// TWO BOXES, BECAUSE THE LAUNCHER READS THE BOX AND THE ROWS NEED DIFFERENT ANSWERS (owner, 2026-09-23:
// "the state of the box decides whether the card is retired, never which button was pressed"). `gw` is the
// EMPTY box — no church, no name — and row 1 is about that box: a genuine first launch. `gwChurch` is the
// same gateway with one church in it, which is the only honest way to reach the launcher's two doors now
// that no marker can fake it. Nothing is shared between them but the code under test.
let gw = null, gwChurch = null, splashSrv = null, splashBase = '';
async function startGateway(extraEnv = {}) {
  const port = await freePort('the splash test\'s gateway');
  const dataDir = mkdtempSync(join(tmpdir(), 'trin-splash-'));
  const preload = join(dataDir, 'blackhole.mjs');
  writeFileSync(preload, BLACKHOLE);
  const proc = spawn(process.execPath, [join(ROOT, 'scripts/gateway.mjs'), String(port)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_SYNC: '0', RELAY_HOST: '127.0.0.1', RELAY_NO_OPEN: '1',
      RELAY_DIRECTORY: 'http://127.0.0.1:9', TRINITY_TAILSCALE_BIN: '/nonexistent/tailscale', NODE_OPTIONS: '--import ' + preload, ...extraEnv },
  });
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 200 && !up; i++) { try { up = (await fetch(base + '/status')).ok; } catch {} if (!up) await sleep(150); }
  assert.ok(up, 'the gateway never served /status');
  return { port, base, dataDir, proc, stop() { try { proc.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} } };
}

async function startChrome(url) {
  const cdp = await freePort('the splash test\'s Chrome debug port');
  const prof = mkdtempSync(join(tmpdir(), 'trin-splash-chrome-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD,
    `--user-data-dir=${prof}`, '--window-size=900,780', url], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  const evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr && rr.result && rr.result.exceptionDetails) {
      const e = rr.result.exceptionDetails;
      throw new Error('the page threw: ' + String((e.exception && e.exception.description) || e.text || 'threw').split('\n')[0]);
    }
    return rr && rr.result && rr.result.result ? rr.result.result.value : undefined;
  };
  const goto = async (u) => { await send('Page.navigate', { url: u }); };
  // WHAT THE BROWSER HOLDS, not what the page thinks it did. `history.length` is the number the panel reads;
  // the entry list is the thing that decides where Back lands.
  const history = async () => { const h = await send('Page.getNavigationHistory'); return h.result.entries.map(e => e.url); };
  return { send, evalIn, goto, history, stop() { try { ws.close(); } catch {} try { chr.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} } };
}

before(async () => {
  if (!CHROME) return;
  gw = await startGateway();
  // A throwaway church, minted here — never a real one, and never a constant somebody could mistake for one.
  // CHURCH_NPUB is the gateway's own seed for "this relay serves this church"; it is what makes
  // /status.writePolicy true (scripts/gateway.mjs: `writePolicy: CHURCH_PUBS.size > 0`).
  gwChurch = await startGateway({ CHURCH_NPUB: npubEncode(getPublicKey(generateSecretKey())) });
  // the splash, byte for byte, from a port of its own
  const sp = await freePort('the splash test\'s static server');
  const html = readFileSync(SPLASH);
  splashSrv = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); });
  await new Promise(r => splashSrv.listen(sp, '127.0.0.1', r));
  splashBase = `http://127.0.0.1:${sp}`;
});
after(() => { if (gw) gw.stop(); if (gwChurch) gwChurch.stop(); if (splashSrv) splashSrv.close(); });

const doorsOn = (c) => c.evalIn(`[...document.querySelectorAll('a.mode')].map(a => a.getAttribute('href')).sort().join(' ')`);


test('a first launch STAYS on the launcher: the first-run card, no redirect, no "reopen the app" line',
  { skip: !CHROME ? 'no chromium' : false, timeout: 90000 }, async () => {
  // The shape of the Suite window: one entry below the launcher (the splash there; about:blank here). Nothing
  // in storage — this is the very first run. Since 2026-09-22 (owner, after his AppImage test) a first run shows
  // ONE card in place of the two doors; scripts/the-suite-first-run-is-one-guided-path.test.mjs drives the card.
  // What this row still proves is the page does not LEAVE.
  const c = await startChrome('about:blank');
  try {
    await c.goto(gw.base + '/relay-app/home.html');
    await sleep(3000);
    assert.match(String(await c.evalIn('location.href')), /\/relay-app\/home\.html$/,
      'A FIRST LAUNCH LEFT THE LAUNCHER for ' + (await c.evalIn('location.href')) + '. On 2026-09-22 the owner’s ' +
      'first run of the real app opened on the relay panel, with nothing saying the two doors were one page back.');
    const entries = await c.history();
    assert.deepEqual(entries.filter(u => !/^about:blank$/.test(u)), [gw.base + '/relay-app/home.html'],
      'the browser holds ' + JSON.stringify(entries) + ' — the launcher navigated somewhere and came back, or was replaced');
    assert.equal(await doorsOn(c), '/relay-app/control.html /steward.html', 'the launcher does not carry both doors');
    // On a FIRST run the card is on screen and the doors are not — the doors are one choice away, never gone.
    const shown = await c.evalIn(`(() => { const on = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; }; return JSON.stringify({ card: on(document.getElementById('firstRun')), doors: [...document.querySelectorAll('a.mode')].map(on) }); })()`);
    assert.deepEqual(JSON.parse(shown), { card: true, doors: [false, false] }, 'a first run shows ' + shown + ' — expected the first-run card and no doors');
    const text = String(await c.evalIn('document.body.innerText'));
    assert.doesNotMatch(text, /reopen the app/i,
      'the launcher still says "reopen the app to return here" — false (the console and the panel both link back) and poor');
    assert.equal(await c.evalIn("sessionStorage.getItem('to_relay_setup_tried')"), null,
      'the once-per-run redirect marker is still being written — something still tries to redirect');
  } finally { c.stop(); }
});

// The regression guard the audit of cec135f found lost with the redirect's tests: the ROUTE the owner took.
//
// STAGED BY THE BOX, NOT BY A MARKER (owner's decision, 2026-09-27). Until 571abbf (2026-09-23) this row
// wrote `to_relay_setup_seen` into localStorage to mean "not a first launch". That mechanism is gone: the
// owner's rule is "the state of the box decides whether the card is retired, never which button was
// pressed", relay-app/home.js reads no marker at all any more, and its sibling row
// scripts/the-suite-first-run-is-one-guided-path.test.mjs ("the console wizard's 'done' marker does not
// retire the first-run card") exists to keep it that way. So this row runs against a SECOND gateway that
// really holds a church, on a fresh, EMPTY browser profile.
//
// WHAT THAT PROVES: on a box that genuinely has a church, the launcher shows its two doors, the "Manage a
// relay" door opens the panel, and the panel's own "← Back" lands back on that launcher — with both doors
// on it, not on the bundled splash and not below the launcher in history. The staging is a real HTTP answer
// from a real gateway (/status.writePolicy, which scripts/gateway.mjs sets from CHURCH_PUBS.size), so
// nothing here asserts against something the test itself faked: `fetch` is untouched and localStorage is
// asserted empty at the point the launcher decides.
//
// WHAT IT DOES NOT PROVE: that a box with NO church behaves this way — a first launch shows the card, and
// row 1 above is the one that measures that. Nor the real window: this is Chromium, and the Suite shell is
// WebKitGTK, so only a Suite build on a desktop proves the actual Back. The owner intends to check that by
// hand; nobody should read this row as covering it.
test('from the launcher through "Manage a relay", the panel\'s "← Back" lands on the launcher with both doors — not below it',
  { skip: !CHROME ? 'no chromium' : false, timeout: 90000 }, async () => {
  // re-anchor the staging before measuring anything with it: a gateway that stopped reporting its church
  // would send this row down the first-run card path and it must say so, not quietly measure the wrong page.
  assert.equal((await (await fetch(gwChurch.base + '/status')).json()).writePolicy, true,
    'staging: the second gateway does not report the church it was seeded with, so this row measures nothing');
  assert.equal((await (await fetch(gw.base + '/status')).json()).writePolicy, false,
    'staging: the EMPTY gateway reports a church — the two boxes are no longer different and row 1 is measuring this one');
  const c = await startChrome('about:blank');
  try {
    // A launch that is NOT the first, because the BOX is not fresh: this relay holds a church. No marker is
    // set and none is read — the launcher asks the box (relay-app/home.js, /status.writePolicy).
    await c.goto(gwChurch.base + '/relay-app/home.html');
    await sleep(3000);
    assert.equal(await c.evalIn(`localStorage.getItem('to_relay_setup_seen')`), null,
      'staging: something wrote the old "a wizard finished" marker — the doors below must come from the box, not from storage');
    assert.equal(await c.evalIn(`document.body.getAttribute('data-first-run')`), 'doors', 'staging: the launcher did not show its doors on a box that holds a church');
    // press the launcher's own door, as a person does (not a navigate)
    assert.equal(await c.evalIn(`(() => { const a = [...document.querySelectorAll('a.mode')].find(a => /control\.html/.test(a.href)); if (!a) return 'miss'; a.click(); return 'ok'; })()`), 'ok', 'no "Manage a relay" door');
    await sleep(2500);
    assert.match(String(await c.evalIn('location.href')), /\/relay-app\/control\.html/, 'the door did not open the panel');
    // press the panel's own Back control, as a person does
    // (#openConsole is the panel's "← Back" — by id, because `\s` inside a template literal is just `s`)
    const pressed = await c.evalIn(`(() => { const b = document.getElementById('openConsole'); if (!b) return 'miss'; b.click(); return 'ok'; })()`);
    assert.equal(pressed, 'ok', 'the panel has no "← Back" control (#openConsole)');
    await sleep(2500);
    assert.match(String(await c.evalIn('location.href')), /\/relay-app\/home\.html$/,
      'THE OWNER\'S ROUTE: Back from the panel landed on ' + (await c.evalIn('location.href')) + ', not the launcher');
    assert.equal(await doorsOn(c), '/relay-app/control.html /steward.html', 'the launcher Back landed on does not offer both doors');
    // ON SCREEN, not merely in the DOM: `doorsOn` reads href attributes, which survive `hidden`. The doors
    // are the way out of this page, so a Back that lands on the first-run card instead is still the dead end.
    const shown = await c.evalIn(`(() => { const on = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; }; return JSON.stringify({ card: on(document.getElementById('firstRun')), doors: [...document.querySelectorAll('a.mode')].map(on) }); })()`);
    assert.deepEqual(JSON.parse(shown), { card: false, doors: [true, true] },
      'the launcher Back landed on shows ' + shown + ' — expected both doors on screen over a relay that holds a church');
    assert.equal(await c.evalIn(`document.body.getAttribute('data-first-run')`), 'doors', 'the launcher Back landed on shows the first-run card over a relay that holds a church');
  } finally { c.stop(); }
});

// ── the splash itself ────────────────────────────────────────────────────────────────────────────────────
const readSplash = (c) => c.evalIn(`(() => {
  const a = (id) => { const e = document.getElementById(id); return e ? { href: e.href, disabled: e.getAttribute('aria-disabled'), text: (e.textContent || '').trim(), shown: getComputedStyle(e).display !== 'none' } : null; };
  const hint = document.getElementById('hint');
  return JSON.stringify({ suite: a('goSuite'), console: a('goConsole'), hint: hint ? (hint.textContent || '').trim() : null, title: (document.querySelector('h1') || {}).textContent || '' });
})()`);

test('the splash carries both doors and says what it is waiting for while the relay is NOT answering',
  { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
  const dead = await freePort('a port nothing listens on');   // bound, released, and never listened on again
  const c = await startChrome(`${splashBase}/index.html?relay=http://127.0.0.1:${dead}`);
  try {
    await sleep(2500);
    const s = JSON.parse(await readSplash(c));
    assert.ok(s.suite && s.console, 'THE SPLASH HAS NO EXITS. A person who reaches it by Back has nothing to press but quit.');
    assert.equal(s.suite.href, `http://127.0.0.1:${dead}/relay-app/home.html`, 'the Suite door points somewhere other than the launcher');
    assert.equal(s.console.href, `http://127.0.0.1:${dead}/steward.html`, 'the console link points somewhere else');
    assert.ok(s.suite.shown && s.console.shown, 'the doors are in the page but not on the screen');
    assert.equal(s.suite.disabled, 'true', 'with the relay down the Suite door claims to be ready');
    assert.equal(s.console.disabled, 'true', 'with the relay down the console link claims to be ready');
    assert.match(String(s.hint), /starting in the background/i,
      'nothing on the splash says the wait is the relay starting, so "Starting your relay…" reads as "wait" and not "you are stuck"');
    assert.match(String(s.hint), /open when it answers/i, 'the line does not say when the doors open');
    // PRESSABLE ANYWAY. The dimming is advice, never a lock: a poll the shell's webview refuses must not
    // become the trap this page exists to remove.
    assert.equal(await c.evalIn(`getComputedStyle(document.getElementById('goSuite')).pointerEvents`), 'auto', 'the dimmed link cannot be clicked');
  } finally { c.stop(); }
});

test('…and the doors come alive when the relay answers, pointing at that relay',
  { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
  const c = await startChrome(`${splashBase}/index.html?relay=${gw.base}`);
  try {
    let s = null;
    for (let i = 0; i < 20; i++) { await sleep(500); s = JSON.parse(await readSplash(c)); if (s.suite && s.suite.disabled === 'false') break; }
    assert.ok(s && s.suite, 'the splash has no Suite door');
    assert.equal(s.suite.disabled, 'false', 'the relay is answering /status and the splash never noticed');
    assert.equal(s.console.disabled, 'false', 'the relay is answering /status and the console link stayed dimmed');
    assert.equal(s.suite.href, gw.base + '/relay-app/home.html', 'the live link points somewhere other than the relay that answered');
    assert.match(String(s.hint), /answering/i, 'the line still says the relay is starting after it answered');
    // A door that WORKS: follow it and land on the LAUNCHER served by that relay — with its own two doors.
    await c.evalIn(`document.getElementById('goSuite').click(); 'ok'`);
    await sleep(2000);
    assert.equal(await c.evalIn('location.href'), gw.base + '/relay-app/home.html', 'the Suite door did not open the launcher');
    assert.equal(await doorsOn(c), '/relay-app/control.html /steward.html', 'the launcher the door opened does not offer both doors');
  } finally { c.stop(); }
});

test('with no ?relay the splash points at the port the shell starts the relay on',
  { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
  // main.rs is compiled Rust, so rule 3 does not apply to reading its constant; the splash is unbundled HTML, so
  // its side is READ OFF THE DOM.
  const rs = readFileSync(join(ROOT, 'relay-app/desktop/src-tauri/src/main.rs'), 'utf8');
  const m = rs.match(/const PORT:\s*u16\s*=\s*(\d+)/);
  assert.ok(m, 'main.rs no longer declares `const PORT: u16` — re-anchor this test');
  const c = await startChrome(`${splashBase}/index.html`);
  try {
    await sleep(1500);
    const s = JSON.parse(await readSplash(c));
    assert.equal(s.suite.href, `http://127.0.0.1:${m[1]}/relay-app/home.html`, 'the splash and the shell disagree about where the relay is');
    assert.equal(s.console.href, `http://127.0.0.1:${m[1]}/steward.html`, 'the splash and the shell disagree about where the relay is');
  } finally { c.stop(); }
});

test('the splash refuses a ?relay that is not this machine', { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
  // The query exists for this file. A page that let any address in would send a person's first click — and a
  // /status poll — wherever the query said.
  const c = await startChrome(`${splashBase}/index.html?relay=https://evil.example`);
  try {
    await sleep(1500);
    const s = JSON.parse(await readSplash(c));
    assert.match(s.suite.href, /^http:\/\/127\.0\.0\.1:\d+\//, 'the splash followed a ?relay pointing off this machine');
  } finally { c.stop(); }
});
