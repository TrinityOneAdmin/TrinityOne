// A PACKAGED APP TALKS ONLY TO THE SHARED RELAYS — never to whatever answers at its own "localhost".
// Run: node --test scripts/a-packaged-app-talks-only-to-the-shared-relays.test.mjs
//
// Plan PLAN-T1FINANCE-DESKTOP-2026-11-17 §1 / §8 / §10, step 0 (rule 10: never widen which relays a church talks to).
//
// THE DEFECT. The console's "is this page inside an app?" checks knew one app shape: the Capacitor APK. A Tauri
// program serves the same files from tauri://localhost (Mac/Linux) or http(s)://tauri.localhost (Windows), so:
//   · ownRelay() named ws://localhost/relay or ws(s)://tauri.localhost/relay — a LOOPBACK relay as the church's
//     own. Any local process running our open-source relay there could prove a key and be admitted ('software'),
//     and would then receive the church's writes;
//   · _ownOrigin() offered http(s)://tauri.localhost to the relay-net census as "the box that served me";
//   · _originIsLoopback() said yes on tauri://localhost, so the console asked /local-token of the app bundle;
//   · joinUrl() accepted https://tauri.localhost as a public invite base;
//   · registerPush() sent the church-key proof to a relative /push/subscribe on the bundle's own origin;
//   · initChurch's DEV-ONLY ?churchkey= hook (app/steward-root.jsx) was live on tauri://localhost — and on the
//     Capacitor APK (https://localhost) — because both have hostname "localhost";
//   · stewOnSuite() (app/stew-dashboard.jsx) said "this is the Suite" on tauri://localhost.
// THE FIX: _packagedOrigin() in src/steward.src.js — Capacitor native, OR location.protocol 'tauri:', OR
// location.hostname 'tauri.localhost' — consulted at each of those sites; exposed as window.Steward.packagedOrigin.
//
// HOW IT ASSERTS (CLAUDE.md rules 1 and 3). Part 1 loads the WHOLE shipped bundle, vendor/steward.js, into a
// node:vm context whose `location` is each origin shape. Network access is impossible there: fetch and WebSocket
// are recorders that never connect. One line is appended inside the bundle's IIFE to hand the test the internal
// functions (ownRelay, _ownOrigin, _originIsLoopback, _dirBases, relaysRaw); nothing else in it is touched. The
// dev hook and the Suite gate are the REAL initChurch / stewOnSuite lifted from app/*.jsx and RUN in that same
// context against the real window.Steward — no text in a .jsx file is matched.
// Part 2 boots the real steward.html in headless chromium, served through CDP Fetch interception AT
// https://tauri.localhost/ and http://tauri.localhost/ (and, as the control, at a loopback Suite origin), with
// every non-fulfilled request failed and every hostname unresolvable. Chromium cannot serve a custom scheme
// through Fetch interception, so the tauri://localhost shape is covered by Part 1 only.
//
// THE CONTROLS ARE THE OTHER HALF OF THE CLAIM. A _packagedOrigin that matched too much would move every
// self-hosting Suite church onto the shared pool — the same class of harm in the other direction. So the hosted
// console (https://app.trinityone.church) and the Suite (http://127.0.0.1:8787/steward.html) are pinned unchanged.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { WebSocket as NodeWS } from 'ws';
import { generateSeedWords } from 'nostr-tools/nip06';
import { fnBody } from './test-slice.mjs';
import { freePort } from './relay-network-harness.mjs';
import { transformSync } from 'esbuild';
import { fakeReact, nodes, texts } from './console-screens.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const VENDOR = readFileSync(ROOT + 'vendor/steward.js', 'utf8');
const ROOT_JSX = readFileSync(ROOT + 'app/steward-root.jsx', 'utf8');
const DASH_JSX = readFileSync(ROOT + 'app/stew-dashboard.jsx', 'utf8');
const CANON = 'wss://app.trinityone.church/relay';
const CANON_HTTP = 'https://app.trinityone.church';
const KEY_LS = 'trinityone.steward.church-key';
// an address on THIS machine, in any of the spellings a page could produce
// values made inside the VM have that realm's Array/Object prototypes; deepEqual needs this realm's
const H = (v) => JSON.parse(JSON.stringify(v));
const LOCAL = /^(wss?|https?):\/\/(localhost|tauri\.localhost|127\.0\.0\.1|\[?::1\]?|0\.0\.0\.0)(:|\/|$)/i;

// ── Part 1: the whole bundle in a VM ────────────────────────────────────────────────────────────────────────

// The bundle's last statement is `window.Steward.init();` inside its IIFE. Hand the test the internals there.
const TAIL = '  window.Steward.init();\n})();';
const EXPOSE = '  window.Steward.init();\n  globalThis.__probe = { ownRelay, _ownOrigin, _originIsLoopback, _dirBases, relaysRaw };\n})();';

function loadBundle(href, { capacitor = false, push = false } = {}) {
  assert.equal(VENDOR.split(TAIL).length, 2, 'vendor/steward.js no longer ends with window.Steward.init() inside its IIFE — re-anchor this test');
  for (const n of ['ownRelay', '_ownOrigin', '_originIsLoopback', '_dirBases', 'relaysRaw']) {
    assert.ok(new RegExp('\\n  (async )?function ' + n + '\\(').test(VENDOR), `vendor/steward.js has no top-level function ${n} (renamed by the bundler?) — re-anchor`);
  }
  const u = new URL(href);
  const location = { href: u.href, protocol: u.protocol, host: u.host, hostname: u.hostname, port: u.port,
    origin: u.protocol === 'tauri:' ? 'tauri://localhost' : u.origin, pathname: u.pathname, search: u.search, hash: u.hash };
  const store = new Map();
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
  const ss = new Map();
  const sessionStorage = { getItem: (k) => (ss.has(k) ? ss.get(k) : null), setItem: (k, v) => ss.set(k, String(v)), removeItem: (k) => ss.delete(k) };
  const fetches = [], sockets = [], timers = [];
  const listeners = new Map();
  // NO NETWORK: every fetch is recorded and refused; every socket is recorded and never opens.
  const fetch = (url, opts) => { fetches.push(String(url)); return Promise.reject(new TypeError('network blocked in test: ' + url)); };
  class WebSocket {
    constructor(url) { this.url = String(url); this.readyState = 0; sockets.push(this.url); }
    send() {} close() { this.readyState = 3; } addEventListener() {} removeEventListener() {}
  }
  WebSocket.CONNECTING = 0; WebSocket.OPEN = 1; WebSocket.CLOSING = 2; WebSocket.CLOSED = 3;
  const navigator = { onLine: true, userAgent: 'node-vm', language: 'en-GB', languages: ['en-GB'] };
  const ctx = {
    location, localStorage, sessionStorage, fetch, WebSocket, navigator,
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    // timers are RECORDED, never run: the probe asks synchronous questions, and nothing may fire after the test
    setTimeout: (f, ms) => { timers.push(ms); return timers.length; }, clearTimeout() {},
    setInterval: (f, ms) => { timers.push(ms); return timers.length; }, clearInterval() {},
    queueMicrotask, Promise, crypto: webcrypto, TextEncoder, TextDecoder, URL, URLSearchParams, atob, btoa,
    AbortSignal, AbortController, Uint8Array, ArrayBuffer, DataView, Date, Math, JSON,
    Event: class { constructor(t) { this.type = t; } },
    CustomEvent: class { constructor(t, i) { this.type = t; this.detail = i && i.detail; } },
    history: { replaceState() {} },
    document: { visibilityState: 'visible', hidden: false, addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {} }) },
    addEventListener: (t, f) => { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(f); },
    removeEventListener: (t, f) => { const s = listeners.get(t); if (s) s.delete(f); },
    dispatchEvent: (e) => { const s = listeners.get(e && e.type); if (s) [...s].forEach(f => { try { f(e); } catch {} }); return true; },
  };
  // The APK, as far as these checks can see it: window.Capacitor.isNativePlatform() is true.
  // The bundle carries its own @capacitor/core, which REBUILDS window.Capacitor when it first initialises and takes
  // isNativePlatform from CapacitorPlatforms.currentPlatform when one is installed — so that is where it is said,
  // or a plain stub silently turns into 'web' half-way through a test. getPlatform stays 'web' so plugin calls
  // resolve to their web implementations: a fake androidBridge sends the native plugin proxy into unbounded
  // recursion (memory: capacitor-plugin-proxy-trap). The APK's native storage is the device's test, not this one.
  if (capacitor) {
    const cur = { name: 'web', getPlatform: () => 'web', isNativePlatform: () => true };
    ctx.CapacitorPlatforms = { currentPlatform: cur, platforms: new Map([['web', cur]]), addPlatform() {}, setPlatform() {} };
    ctx.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'web', Plugins: {} };
  }
  if (push) {
    // A browser that CAN do web push, so registerPush() reaches its fetches unless something stops it first.
    ctx.Notification = { permission: 'granted', requestPermission: async () => 'granted' };
    ctx.PushManager = function PushManager() {};
    navigator.serviceWorker = { ready: Promise.resolve({ pushManager: { getSubscription: async () => null, subscribe: async () => ({ endpoint: 'https://push.example/x', toJSON() { return {}; } }) } }) };
  }
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(VENDOR.replace(TAIL, EXPOSE), ctx, { filename: 'vendor/steward.js' });
  assert.ok(ctx.__probe && ctx.Steward, 'the bundle did not load in the VM');
  return { ctx, p: ctx.__probe, S: ctx.Steward, fetches, sockets, store };
}

// The REAL initChurch / stewOnSuite from app/*.jsx — lifted, then RUN inside the bundle's context.
// initChurch calls stewIsFinanceApp (steward-root.jsx, the finance branch) — lift the REAL one alongside, never a stub.
function runInitChurch(ctx) { vm.runInContext(fnBody(ROOT_JSX, 'function stewIsFinanceApp() {', 'stewIsFinanceApp') + '\n' + fnBody(ROOT_JSX, 'function initChurch() {', 'initChurch') + '\ninitChurch();', ctx); }
function stewOnSuite(ctx) { return vm.runInContext(fnBody(DASH_JSX, 'function stewOnSuite() {', 'stewOnSuite') + '\nstewOnSuite();', ctx); }

const PACKAGED = [
  ['tauri://localhost (Tauri on Mac/Linux)', 'tauri://localhost/steward.html', {}],
  ['http://tauri.localhost (Tauri on Windows, http)', 'http://tauri.localhost/steward.html', {}],
  ['https://tauri.localhost (Tauri on Windows, useHttpsScheme)', 'https://tauri.localhost/steward.html', {}],
  ['https://localhost + Capacitor (the APK)', 'https://localhost/steward.html', { capacitor: true }],
];

test('a packaged app names ONLY the shared relay as its own — at the internals and at every list built from them', () => {
  for (const [label, href, opts] of PACKAGED) {
    const { p, S } = loadBundle(href, opts);
    assert.equal(S.packagedOrigin(), true, `${label}: window.Steward.packagedOrigin() does not recognise a packaged app`);
    assert.equal(p.ownRelay(), CANON, `${label}: ownRelay() is ${p.ownRelay()} — a packaged app named its own bundle origin as the church's relay`);
    assert.equal(S.ownRelay(), CANON, `${label}: window.Steward.ownRelay() is ${S.ownRelay()}`);
    assert.equal(p._ownOrigin(), '', `${label}: _ownOrigin() is ${JSON.stringify(p._ownOrigin())} — the relay-net census would offer the app bundle as "the box that served me"`);
    assert.equal(p._originIsLoopback(), false, `${label}: _originIsLoopback() is true — the console would ask the app bundle for /local-token`);
    // POINT OF USE: the lists the console actually dials and publishes from
    const raw = H(p.relaysRaw());
    assert.deepEqual(raw.filter(u => LOCAL.test(u)), [], `${label}: relaysRaw() carries a local address: ${JSON.stringify(raw)}`);
    assert.ok(raw.includes(CANON), `${label}: CONTROL: relaysRaw() lost the shared relay`);
    const pub = H(S.relayList());
    assert.deepEqual(pub.filter(u => LOCAL.test(u)), [], `${label}: Steward.relayList() carries a local address: ${JSON.stringify(pub)}`);
    assert.deepEqual(H(p._dirBases()), [CANON_HTTP], `${label}: the directory would be asked at ${JSON.stringify(p._dirBases())}`);
    assert.equal(S.isSelfHosted(), false, `${label}: the console believes it is a self-hosted box`);
    assert.equal(S.whereChurchLives(), 'community', `${label}: the sidebar would say the church lives somewhere other than the community relays`);
  }
});

test('a packaged app never asks its own origin for the admin token, the tunnel, or its relay name', async () => {
  for (const [label, href, opts] of PACKAGED) {
    const { S, fetches } = loadBundle(href, opts);
    const t = H(await S.tunnelState());
    assert.deepEqual(t, { supported: false, running: false }, `${label}: tunnelState() thinks there is a tunnel to manage`);
    assert.equal(await S.ownRelayName(), '', `${label}: ownRelayName() answered`);
    await assert.rejects(() => S.goPublic(), /isn.t running its own relay/, `${label}: goPublic() did not refuse`);
    const bad = fetches.filter(u => /\/(local-token|tunnel|config|relay-names)\b/.test(u));
    assert.deepEqual(bad, [], `${label}: asked the app bundle's own origin: ${JSON.stringify(bad)}`);
  }
});

test('a packaged app\'s invite link is the public app address, never its own origin', () => {
  for (const [label, href, opts] of PACKAGED) {
    const { S } = loadBundle(href, opts);
    const u = S.joinUrl();
    assert.ok(u.startsWith(CANON_HTTP + '/?follow='), `${label}: joinUrl() is ${u} — an invite that opens the app bundle's origin on someone else's device`);
    assert.ok(u.includes('&relay=' + encodeURIComponent(CANON)), `${label}: joinUrl() carries a relay other than the shared one: ${u}`);
  }
});

test('a packaged app with a church key dials only the shared relay, and sends the push proof nowhere', async () => {
  for (const [label, href, opts] of PACKAGED.filter(([, , o]) => !o.capacitor)) {   // the APK's secure store is native; its own test is the device
    const { S, sockets, fetches } = loadBundle(href, { ...opts, push: true });
    assert.equal(S.init(generateSeedWords()), true, `${label}: CONTROL: the console would not take a key`);
    assert.ok(S.hasKey, `${label}: CONTROL: no key in memory`);
    await new Promise(r => setImmediate(r));
    assert.ok(sockets.length > 0, `${label}: CONTROL: with a key the console dialled nothing at all, so "no local socket" proves nothing`);
    assert.deepEqual([...new Set(sockets)].filter(u => u !== CANON), [], `${label}: dialled ${JSON.stringify([...new Set(sockets)])}`);
    assert.equal(await S.registerPush(), 'unsupported', `${label}: registerPush() went ahead inside a packaged app`);
    const pushes = fetches.filter(u => /\/push\//.test(u));
    assert.deepEqual(pushes, [], `${label}: sent ${JSON.stringify(pushes)} to the app bundle's own origin`);
  }
});

test('the DEV ?churchkey= hook is refused inside a packaged app — the real initChurch, run against the real bundle', () => {
  for (const [label, href, opts] of PACKAGED) {
    const words = generateSeedWords();
    const { ctx, S, store } = loadBundle(href + '?churchkey=' + encodeURIComponent(words), opts);
    runInitChurch(ctx);
    assert.equal(S.hasKey, false, `${label}: ?churchkey= loaded a church key in a RELEASE build — a crafted link can replace the church identity`);
    assert.equal(store.get(KEY_LS), undefined, `${label}: ?churchkey= wrote the seed to localStorage`);
  }
});

test('the Suite-only links are hidden inside a packaged app — the real stewOnSuite, run against the real bundle', () => {
  for (const [label, href, opts] of PACKAGED) {
    const { ctx } = loadBundle(href, opts);
    assert.equal(stewOnSuite(ctx), false, `${label}: stewOnSuite() is true — "Relay & Suite home" and "Back to the Suite" point at a launcher that is not there`);
  }
});

// ── the finance app, and the push button (T1Finance desktop plan §10, 2026-11-18) ───────────────────────────────────

// finance.html runs finance-mode.js (window.TRINITY_APP = 'finance') first; here it is run in the bundle's context
// before the lifted initChurch reads it — the real file, not a flag set by hand.
const FINANCE_MODE = readFileSync(ROOT + 'finance-mode.js', 'utf8');

test('the DEV ?churchkey= hook is refused in the FINANCE app even on a dev box — the real initChurch, stewIsFinanceApp and finance-mode.js', () => {
  for (const host of ['http://localhost:8787', 'http://127.0.0.1:8787']) {
    const words = generateSeedWords();
    const { ctx, S, store } = loadBundle(host + '/finance.html?churchkey=' + encodeURIComponent(words));
    vm.runInContext(FINANCE_MODE, ctx, { filename: 'finance-mode.js' });
    assert.equal(ctx.TRINITY_APP, 'finance', 're-anchor: finance-mode.js no longer sets the app flag');
    assert.equal(S.packagedOrigin(), false, `${host}: a dev box was classed as a packaged app, so this would not test the finance gate`);
    runInitChurch(ctx);
    assert.equal(S.hasKey, false, `${host}: ?churchkey= loaded a CHURCH key into the finance app — it is for helpers only`);
    assert.equal(store.get(KEY_LS), undefined, `${host}: ?churchkey= wrote the seed to localStorage in the finance app`);
  }
  // the control on the same dev hosts: the steward console still takes the hook (the 127.0.0.1 Suite case is below)
  const words = generateSeedWords();
  const { ctx, S } = loadBundle('http://localhost:8787/steward.html?churchkey=' + encodeURIComponent(words));
  runInitChurch(ctx);
  assert.equal(S.hasKey, true, 'CONTROL: the steward console at localhost no longer takes the dev hook, so the finance refusal proves nothing');
});

// The REAL PushEnabler from app/stew-dashboard.jsx, transpiled the way the build does it and RUN in the bundle's
// context against the real window.Steward, with a hook-faithful React stand-in (console-screens.mjs fakeReact).
function renderPushEnabler(ctx) {
  const fr = fakeReact();
  ctx.React = fr.React;
  ctx.Icon = function Icon() { return null; };
  const js = transformSync(fnBody(DASH_JSX, 'function PushEnabler() {', 'PushEnabler'), { loader: 'jsx', jsx: 'transform' }).code;
  vm.runInContext(js + '\nglobalThis.__PushEnabler = PushEnabler;', ctx, { filename: 'PushEnabler' });
  fr.reset(); const first = ctx.__PushEnabler();
  fr.flush(); fr.reset(); const second = ctx.__PushEnabler();
  return { first, second };
}

test('the "Notify my phone on joins" push button is not offered inside a packaged app — the real PushEnabler, run against the real bundle', async () => {
  for (const [label, href, opts] of PACKAGED) {
    const { ctx, fetches } = loadBundle(href, { ...opts, push: true });
    const { first, second } = renderPushEnabler(ctx);
    assert.equal(first, null, `${label}: PushEnabler rendered on its first paint — a push button for endpoints a packaged app does not have`);
    assert.equal(second, null, `${label}: PushEnabler rendered after its effect ran`);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(fetches.filter((u) => /\/push\//.test(u)), [], `${label}: PushEnabler reached the push endpoints`);
  }
  // CONTROL: the hosted console, in a browser that can do web push, still shows it
  const { ctx } = loadBundle('https://app.trinityone.church/steward.html', { push: true });
  const { first } = renderPushEnabler(ctx);
  assert.ok(first && first.type === 'button', 'CONTROL: the hosted console no longer renders the push button, so its absence above proves nothing');
  assert.match(texts(first).join(' '), /Notify my phone on joins|Join alerts are on/);
});

// ── the controls: what must NOT move ─────────────────────────────────────────────────────────────────────────

test('CONTROL: the hosted console at app.trinityone.church is unchanged', () => {
  const { p, S } = loadBundle('https://app.trinityone.church/steward.html');
  assert.equal(S.packagedOrigin(), false, 'the hosted console was classed as a packaged app');
  assert.equal(p.ownRelay(), CANON);
  assert.equal(p._ownOrigin(), CANON_HTTP, 'the hosted console stopped naming its own origin to the census');
  assert.equal(p._originIsLoopback(), false);
  assert.ok(S.joinUrl().startsWith(CANON_HTTP + '/?follow='));
});

test('CONTROL: the Suite at http://127.0.0.1:8787 keeps its own box — a too-broad gate would move self-hosting churches onto the pool', async () => {
  const SUITE = 'http://127.0.0.1:8787/steward.html';
  const { p, S, ctx, fetches } = loadBundle(SUITE, { push: true });
  assert.equal(S.packagedOrigin(), false, 'the Suite was classed as a packaged app');
  assert.equal(p.ownRelay(), 'ws://127.0.0.1:8787/relay', 'the Suite lost its own relay');
  assert.equal(S.ownRelay(), 'ws://127.0.0.1:8787/relay');
  assert.equal(p._ownOrigin(), 'http://127.0.0.1:8787');
  assert.equal(p._originIsLoopback(), true, 'the Suite can no longer ask its own box for the admin token');
  assert.ok(p.relaysRaw().includes('ws://127.0.0.1:8787/relay') && p.relaysRaw().includes(CANON));
  assert.deepEqual(H(p._dirBases()), ['http://127.0.0.1:8787', CANON_HTTP]);
  assert.equal(S.isSelfHosted(), true);
  assert.equal(stewOnSuite(ctx), true, 'stewOnSuite() is false on the Suite — the way back to the launcher is gone');
  // the push path is still taken where it applies (instrument check for the packaged push assertion)
  assert.equal(S.init(generateSeedWords()), true);
  await S.registerPush();
  assert.ok(fetches.includes('/push/vapid'), 'CONTROL: on the Suite registerPush() never reached /push/vapid, so its absence in a packaged app proves nothing: ' + JSON.stringify(fetches));
});

test('CONTROL: the DEV ?churchkey= hook still works on the Suite origin', () => {
  const words = generateSeedWords();
  const { ctx, S, store } = loadBundle('http://127.0.0.1:8787/steward.html?churchkey=' + encodeURIComponent(words));
  runInitChurch(ctx);
  assert.equal(S.hasKey, true, 'the dev hook no longer loads a key on the Suite — the refusal above may be the hook being dead, not gated');
  assert.equal(store.get(KEY_LS), words);
});

// ── Part 2: the real console, booted in chromium AT a packaged origin ───────────────────────────────────────
//
// Every request the page makes is paused by CDP Fetch. A request to one of the origins this test serves is
// answered from the working tree (a missing file is a 404); every other request is FAILED and recorded. Every
// hostname is unresolvable (--host-resolver-rules), so nothing here can reach the network even through a path
// Fetch does not see. WebSockets are not paused by Fetch; they are recorded from Network.webSocketCreated, which
// fires when the page constructs one, whether or not it ever connects.

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const SKIP = !CHROME ? 'no chromium' : false;
const PIN = 'cedar-harbour-lamp-42';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.jsx': 'text/babel', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
let chr, cdp, prof, suiteOrigin = '';
const served = new Set();          // origins answered from the working tree
let log = { sockets: [], requests: [], blocked: [], errors: [] };
let send, evalIn;

before(async () => {
  if (!CHROME) return;
  // The Suite control's origin: a loopback port NOTHING listens on, so its relay socket is refused, never answered.
  suiteOrigin = 'http://127.0.0.1:' + await freePort('the packaged-origin test\'s stand-in Suite origin');
  for (const o of ['https://tauri.localhost', 'http://tauri.localhost', 'https://localhost', suiteOrigin]) served.add(o);
  const port = await freePort('the packaged-origin test\'s Chrome debug port');
  prof = mkdtempSync(join(tmpdir(), 'trin-pkgorigin-chr-'));
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, '--no-sandbox', '--disable-gpu',
    '--host-resolver-rules=MAP * ~NOTFOUND', `--user-data-dir=${prof}`, '--window-size=1280,1200', 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  cdp = new NodeWS(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { cdp.on('open', res); cdp.on('error', rej); });
  let id = 0; const pend = new Map();
  send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); cdp.send(JSON.stringify({ id: i, method, params })); });
  cdp.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    if (m.method === 'Network.webSocketCreated') log.sockets.push(m.params.url);
    if (m.method === 'Runtime.exceptionThrown') { const e = m.params.exceptionDetails; log.errors.push((e.exception?.description || e.text || '').split('\n')[0]); }
    if (m.method === 'Fetch.requestPaused') {
      const { requestId, request } = m.params;
      let u; try { u = new URL(request.url); } catch { u = null; }
      if (u && served.has(u.origin)) {
        log.requests.push({ origin: u.origin, path: u.pathname, method: request.method });
        const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
        const file = join(ROOT, rel);
        if (!rel.includes('..') && existsSync(file) && !file.endsWith('/')) {
          let body; try { body = readFileSync(file); } catch { body = null; }
          if (body) {
            send('Fetch.fulfillRequest', { requestId, responseCode: 200, body: body.toString('base64'),
              responseHeaders: [{ name: 'Content-Type', value: MIME[extname(file)] || 'application/octet-stream' }, { name: 'Cache-Control', value: 'no-store' }] });
            return;
          }
        }
        send('Fetch.fulfillRequest', { requestId, responseCode: 404, body: '', responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }] });
        return;
      }
      log.blocked.push(request.url);
      send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
    }
  });
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  // No service worker: its own fetches would not pass through this page's Fetch interception.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { if (navigator.serviceWorker) Object.defineProperty(Object.getPrototypeOf(navigator.serviceWorker), 'register', { value: () => new Promise(() => {}), configurable: true }); } catch (e) {}` });
  // https://localhost is served ONLY as the APK: a native Capacitor platform, said where the bundle's own
  // @capacitor/core reads it (see the VM harness above for why it is CapacitorPlatforms and not a bridge).
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (location.origin === 'https://localhost') { const cur = { name: 'web', getPlatform: () => 'web', isNativePlatform: () => true };
    window.CapacitorPlatforms = { currentPlatform: cur, platforms: new Map([['web', cur]]) }; window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'web', Plugins: {} }; }` });
  evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error('in-page: ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };
});

after(() => {
  try { cdp && cdp.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
});

async function waitFor(expr, ms = 90000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await evalIn(expr)) return true; } catch {} await sleep(300); }
  throw new Error('timed out waiting for: ' + label);
}
const typePh = (ph, val) => `(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(ph)})); if(!i) return 'miss';
  const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
const clickBtn = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`;
const mounted = `!!window.Steward && document.querySelectorAll('#root *').length > 20`;
const dashboard = `[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Settings') && !document.querySelector('[data-stew-modal-panel]')`;
const suiteLink = `[...document.querySelectorAll('a')].some(a => /Relay\\s*&\\s*Suite home/.test(a.textContent || ''))`;
async function go(url) { await send('Page.navigate', { url }); await sleep(500); await waitFor(mounted, 120000, 'the console to mount at ' + url); }
async function setPinToDashboard() {
  await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('At least 8'))`, 90000, 'the forced PIN screen');
  assert.equal(await evalIn(typePh('At least 8', PIN)), 'ok');
  assert.equal(await evalIn(typePh('Type it again', PIN)), 'ok');
  assert.equal(await evalIn(clickBtn('/Set PIN/i')), 'ok', 'no Set PIN button');
  await waitFor(dashboard, 120000, 'the dashboard');
}
const fresh = () => { log = { sockets: [], requests: [], blocked: [], errors: [] }; };
const norm = (u) => String(u).replace(/\/+$/, '');

test('CONTROL (browser): the console at a loopback Suite origin dials its own box, asks it for the admin token, and offers the Suite link', { skip: SKIP, timeout: 300000 }, async () => {
  const words = generateSeedWords();
  await go(suiteOrigin + '/steward.html');
  await evalIn(`(localStorage.setItem('trinityone.steward.wizard.done', '1'), 'ok')`);
  fresh();
  await go(suiteOrigin + '/steward.html?churchkey=' + encodeURIComponent(words));
  assert.equal(await evalIn('window.Steward.hasKey'), true, 'the DEV ?churchkey= hook did not load the key on the Suite origin — the packaged refusal below would then prove nothing');
  assert.equal(await evalIn('window.Steward.packagedOrigin()'), false);
  await setPinToDashboard();
  await waitFor(suiteLink, 30000, '"Relay & Suite home" in the sidebar on the Suite');
  assert.equal(await evalIn('stewOnSuite()'), true, 'stewOnSuite() is false on the Suite');
  await sleep(6000);
  const own = suiteOrigin.replace(/^http/, 'ws') + '/relay';
  assert.ok(log.sockets.map(norm).includes(own), 'INSTRUMENT: the Suite console never constructed a socket to its own box, so the packaged "no local socket" below proves nothing: ' + JSON.stringify(log.sockets));
  assert.ok(log.requests.some(r => r.path === '/local-token'), 'INSTRUMENT: the Suite console never asked its own origin for /local-token, so its absence below proves nothing: ' + JSON.stringify(log.requests.filter(r => !/\.(js|jsx|css|json|wasm|html|svg|png|woff2?)$/.test(r.path))));
});

// https://localhost (+ Capacitor) is the APK — the one shape whose hostname is "localhost" that chromium can serve,
// so it is the browser case for the hostname-only gates (the dev hook, the sidebar's Suite link). tauri://localhost
// has the same hostname and is covered in Part 1.
for (const ORIGIN of ['https://tauri.localhost', 'http://tauri.localhost', 'https://localhost']) {
  test(`at ${ORIGIN}: the dev key hook is refused, the only socket is the shared relay, and nothing asks the app's own origin for a relay's admin routes`, { skip: SKIP, timeout: 300000 }, async () => {
    const words = generateSeedWords();
    fresh();
    await go(ORIGIN + '/steward.html?churchkey=' + encodeURIComponent(words));
    assert.equal(await evalIn('window.Steward.packagedOrigin()'), true, `${ORIGIN} is not recognised as a packaged app`);
    assert.equal(await evalIn('window.Steward.hasKey'), false, `the DEV ?churchkey= hook loaded a church key at ${ORIGIN}`);
    assert.equal(await evalIn(`localStorage.getItem(${JSON.stringify(KEY_LS)})`), null, `the DEV ?churchkey= hook wrote the seed at ${ORIGIN}`);
    // now give it a church the way an upgraded install has one (a legacy plaintext seed, which forces a PIN)
    await evalIn(`(localStorage.setItem(${JSON.stringify(KEY_LS)}, ${JSON.stringify(words)}), localStorage.setItem('trinityone.steward.wizard.done', '1'), 'ok')`);
    fresh();
    await go(ORIGIN + '/steward.html');
    await setPinToDashboard();
    assert.equal(await evalIn('window.Steward.hasKey'), true, 'CONTROL: the console has no church key, so it had nothing to dial');
    await sleep(8000);
    assert.equal(await evalIn('window.Steward.ownRelay()'), CANON);
    assert.equal(await evalIn(suiteLink), false, `"Relay & Suite home" is in the sidebar at ${ORIGIN} — a link to a launcher that is not there`);
    assert.equal(await evalIn('stewOnSuite()'), false);
    const socks = [...new Set(log.sockets.map(norm))];
    assert.ok(socks.length > 0, 'CONTROL: the console constructed no socket at all, so "only the shared relay" proves nothing');
    assert.deepEqual(socks.filter(u => u !== CANON), [], `at ${ORIGIN} the console constructed sockets to ${JSON.stringify(socks)}`);
    const admin = log.requests.filter(r => /^\/(config|local-token|tunnel|relay-names|push|relay-identity|status)\b/.test(r.path));
    assert.deepEqual(admin, [], `at ${ORIGIN} the console asked the app's own origin for relay routes: ${JSON.stringify(admin)}`);
    const local = log.blocked.filter(u => LOCAL.test(u));
    assert.deepEqual(local, [], `at ${ORIGIN} the console tried to reach this machine: ${JSON.stringify(local)}`);
  });
}
