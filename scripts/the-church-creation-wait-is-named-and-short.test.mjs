// THE WAIT ON THE WIZARD'S NAME STEP IS NAMED, AND SHORT.
// Run: node --test scripts/the-church-creation-wait-is-named-and-short.test.mjs
//
// Measured 2026-09-21 on 3a8c980, driving the real console (steward.html from a fresh loopback gateway)
// through the real wizard — Start a new church → PIN → name → Continue — with the shipped relays mapped to
// a local TARPIT (a socket that accepts and never writes a byte, which is what an unreachable *.ts.net host
// looks like from a box without Tailscale): Continue sat disabled for 12.1 s with NOTHING else on screen —
// no spinner, no sentence, no role="status". With the shipped relays refusing at once: 0.5 s. The box's own
// registration landed within the first second in both runs; the wait was selfRegister() posting to its
// bases one after another with a 6 s abort each (own origin, then two tarpits = 12 s), then publish().
//
// Two fixes, two commits, both pinned here:
//   1. the step SAYS what it is doing (owner's copy, 2026-09-21): at once "Telling your relay about your
//      church…", after 5 s "Still waiting for a relay to answer — up to a minute. Your church key is safe
//      on this device." — under the field, role="status", gone when the step advances. No button shortens it.
//   2. selfRegister posts to its bases IN PARALLEL, so the worst wait is one 6 s abort, not one per host.
//      The SET of bases is unchanged — CLAUDE.md rule 10 — and the fetch spy at the bottom lists it.
//
// POINT OF USE (rule 1, rule 3): the browser row reads the DOM of the shipped page on a clock; nothing here
// matches text in app/*.jsx. NOTHING REACHES PRODUCTION: the shipped hosts resolve to the tarpit in the
// browser and are refused inside the gateway (a fetch preload).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import * as H from './relay-network-harness.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const STEW = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
after(() => H.stopAll());

const FIRST = 'Telling your relay about your church…';
const SECOND = 'Still waiting for a relay to answer — up to a minute. Your church key is safe on this device.';

// Inside the gateway: the shipped hosts are refused before a socket opens (its directory gossip fires 10 s
// after boot). In the browser: --host-resolver-rules sends them to the tarpit.
const BLACKHOLE = `const real = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const u = String(input && input.url ? input.url : input);
  if (/trinityone\\.church|\\.ts\\.net|trycloudflare/i.test(u)) return Promise.reject(new Error('blackholed by test: ' + u));
  return real.call(this, input, init);
};\n`;

async function startTarpit() {
  const port = await H.freePort('the tarpit the shipped relays resolve to');
  const socks = new Set();
  let hits = 0;
  const srv = createServer((s) => { hits++; socks.add(s); s.on('error', () => {}); s.on('close', () => socks.delete(s)); });
  await new Promise(r => srv.listen(port, '127.0.0.1', r));
  return { port, hits: () => hits, stop() { for (const s of socks) s.destroy(); srv.close(); } };
}

async function startConsole(relay, tarpitPort) {
  const cdp = await H.freePort('the wizard-wait test\'s Chrome debug port');
  const prof = mkdtempSync(join(tmpdir(), 'trin-wizwait-chrome-'));
  const to = `127.0.0.1:${tarpitPort}`;
  const BLOCK = `--host-resolver-rules=MAP app.trinityone.church ${to}, MAP *.ts.net ${to}, MAP trinityone.church ${to}`;
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', BLOCK,
    `--user-data-dir=${prof}`, '--window-size=1280,1200', `${relay.base}/steward.html`], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  const evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr && rr.result && rr.result.exceptionDetails) {
      const e = rr.result.exceptionDetails;
      throw new Error('the page threw: ' + String((e.exception && e.exception.description) || e.text || 'threw').split('\n')[0]);
    }
    return rr && rr.result && rr.result.result ? rr.result.result.value : undefined;
  };
  return { evalIn, stop() { try { ws.close(); } catch {} try { chr.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} } };
}

const click = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`;
const typeInto = (pick, val) => `(() => { const i=${pick}; if(!i) return 'miss';
  const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
const byPlaceholder = (ph) => `[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(ph)}))`;
// One reading of the step: which step is up, whether Continue is disabled, and every role="status" line.
const SAMPLE = `(() => {
  const b=[...document.querySelectorAll('button')].find(x=>/^Continue$/.test((x.textContent||'').trim()));
  const step0=[...document.querySelectorAll('div')].some(d=>d.children.length===0&&/^Welcome to your console$/.test((d.textContent||'').trim()));
  const step1=[...document.querySelectorAll('div')].some(d=>d.children.length===0&&/recovery key/.test(d.textContent||''));
  const status=[...document.querySelectorAll('[role="status"]')].map(s=>(s.textContent||'').replace(/\\s+/g,' ').trim());
  return JSON.stringify({ cont: b ? (b.disabled ? 'disabled' : 'enabled') : 'absent', step: step1 ? 1 : (step0 ? 0 : -1), status });
})()`;

test('the name step names its wait — at once, again after 5 s, gone when the step advances — and the wait is one timeout, not one per host',
  { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
  const tarpit = await startTarpit();
  const preDir = mkdtempSync(join(tmpdir(), 'trin-wizwait-pre-'));
  const preload = join(preDir, 'blackhole.mjs'); writeFileSync(preload, BLACKHOLE);
  // A fresh, private box — the Suite install, first run: no churches, so the first self-registration is the
  // bootstrap one the gateway accepts. TRINITY_TAILSCALE_BIN keeps this dev box's real Funnel out of it.
  const relay = await H.startRelay({ name: 'suite-box', env: { RELAY_HOST: '127.0.0.1', RELAY_NO_OPEN: '1', RELAY_DIRECTORY: 'http://127.0.0.1:9',
    TRINITY_TAILSCALE_BIN: '/nonexistent/tailscale', NODE_OPTIONS: '--import ' + preload } });
  let c = null;
  try {
    c = await startConsole(relay, tarpit.port);
    await sleep(9000);
    // The real path, the way a churchwarden walks it.
    assert.equal(await c.evalIn(click('/Start a new church/i')), 'ok', 'the console never offered "Start a new church"');
    await sleep(2500);
    assert.equal(await c.evalIn(typeInto(byPlaceholder('At least 8'), 'cedar-harbour-lamp-42')), 'ok', 'the PIN box was not on screen');
    assert.equal(await c.evalIn(typeInto(byPlaceholder('Type it again'), 'cedar-harbour-lamp-42')), 'ok', 'the confirm-PIN box was not on screen');
    assert.equal(await c.evalIn(click('/Set PIN/i')), 'ok', 'the console never offered "Set PIN"');
    await sleep(12000);   // key generation + the first render of the whole dashboard, wizard included
    assert.match(String(await c.evalIn(`window.Steward && window.Steward.churchPub || ''`)), /^[0-9a-f]{64}$/, 'no church key after the PIN step');
    assert.equal(await c.evalIn(typeInto('document.querySelector(\'input[aria-label="Church name"]\')', 'St Columba in the Tarpit')), 'ok', 'the name field was not on screen');
    await sleep(300);
    const before = JSON.parse(await c.evalIn(SAMPLE));
    assert.equal(before.step, 0, 'staging: the name step is not up — ' + JSON.stringify(before));
    assert.deepEqual(before.status.filter(s => s === FIRST || s === SECOND), [], 'staging: the wait line is on screen before Continue was pressed');

    // Press Continue and READ THE SCREEN every 200 ms until the step advances. Every reading is kept, so a
    // failure names what was on screen at each second rather than "expected true".
    const t0 = Date.now();
    assert.equal(await c.evalIn(click('/^Continue$/')), 'ok', 'the wizard never offered "Continue"');
    const readings = [];
    let advancedAt = null;
    for (let i = 0; i < 400; i++) {
      const s = JSON.parse(await c.evalIn(SAMPLE));
      const at = (Date.now() - t0) / 1000;
      readings.push({ at: Number(at.toFixed(2)), ...s });
      if (s.step === 1) { advancedAt = at; break; }
      await sleep(200);
    }
    const trail = () => '\n' + readings.map(r => `  t=${r.at}s step=${r.step} Continue=${r.cont} status=${JSON.stringify(r.status)}`).join('\n');
    assert.ok(advancedAt !== null, 'the wizard never left the name step (80 s):' + trail());
    if (process.env.WIZWAIT_TRAIL) console.log('readings:' + trail());   // the clock, for a by-eye check

    // 1. AT ONCE: the first sentence is under the field within a second of pressing Continue, as role="status".
    const first = readings.find(r => r.status.includes(FIRST));
    assert.ok(first, 'the first sentence never appeared — Continue was pressed and the step said nothing:' + trail());
    assert.ok(first.at <= 1.0, 'the first sentence took ' + first.at + ' s to appear (limit 1 s):' + trail());
    assert.equal(first.cont, 'disabled', 'the sentence is up but Continue is not disabled — the line says a wait the button denies');
    // 2. AFTER 5 s: the second sentence replaces it, and the first is gone.
    const second = readings.find(r => r.status.includes(SECOND));
    assert.ok(second, 'the second sentence never appeared, though the step waited ' + advancedAt.toFixed(1) + ' s:' + trail());
    assert.ok(second.at >= 4.8, 'the second sentence appeared at ' + second.at + ' s — before the 5 s the copy promises:' + trail());
    assert.ok(second.at <= 6.2, 'the second sentence appeared at ' + second.at + ' s — the 5 s timer is late (limit 6.2 s):' + trail());
    assert.ok(!second.status.includes(FIRST), 'both sentences on screen at once:' + trail());
    const earlySecond = readings.find(r => r.at < 4.6 && r.status.includes(SECOND));
    assert.ok(!earlySecond, 'the "still waiting" line was up at ' + (earlySecond && earlySecond.at) + ' s, before anything was slow:' + trail());
    // 3. GONE when the step advances: the recovery-key step shows neither line.
    const last = readings[readings.length - 1];
    assert.equal(last.step, 1);
    assert.deepEqual(last.status.filter(s => s === FIRST || s === SECOND), [], 'the wait line outlived the name step:' + trail());

    // 4. SHORT: with two shipped hosts in a tarpit the step took 12.1 s on 3a8c980 (one 6 s abort per host, in
    //    turn). Posting to the bases in parallel makes that one 6 s abort plus the publish (measured 6.2 s).
    //    11 s is the bound with margin: it fails for the sequential loop and passes a slow pass of the
    //    parallel one.
    assert.ok(advancedAt < 11, 'the name step took ' + advancedAt.toFixed(1) + ' s — the bases are being dialled one after another again (limit 11 s):' + trail());
    assert.ok(tarpit.hits() >= 2, 'the tarpit saw ' + tarpit.hits() + ' connections — the shipped hosts were not dialled, so this run measured nothing');
  } finally {
    if (c) c.stop();
    tarpit.stop();
    try { rmSync(preDir, { recursive: true, force: true }); } catch {}
  }
});

// ── the wizard's own accounting, lifted and RUN (rule 3) ────────────────────────────────────────────────
// Take `saveName`'s arrow function, from its `async (` to the brace that closes it.
function sliceSaveName(src) {
  const at = src.indexOf('const saveName = async () => {');
  assert.notEqual(at, -1, 'saveName is missing — re-anchor this test rather than widening the window');
  const arrow = src.indexOf('async () => {', at);
  const open = src.indexOf('{', arrow);
  let depth = 0, i = open;
  for (; i < src.length; i++) { const ch = src[i]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) break; } }
  assert.ok(i < src.length, 'saveName never closes — the brace walk ran off the end');
  const body = src.slice(arrow, i + 1);
  assert.ok(body.length > 200, 'saveName sliced to a stub — re-anchor rather than widening');
  return body;
}

function runSaveName({ publishProfile }) {
  const log = [];
  const timers = new Map(); let nextT = 1;
  const scope = {
    name: 'St Columba, lifted', church: { name: '', nip05: '' },
    setBusy: (v) => log.push(['busy', v]), setNameSlow: (v) => log.push(['slow', v]), nameSlowTimer: { current: null },
    setTimeout: (fn, ms) => { const t = nextT++; timers.set(t, { fn, ms }); log.push(['timer', ms]); return t; },
    clearTimeout: (t) => { if (timers.delete(t)) log.push(['cleared', t]); },
    next: () => log.push(['next']),
    window: { Steward: { selfRegister: async () => ({ ok: true }), publishProfile, ensureJoinPolicy: async () => true } },
  };
  const fn = new Function('scope', `with (scope) { return (${sliceSaveName(STEW)}); }`)(scope);
  return { log, timers, run: () => fn() };
}

test('the 5 s timer is armed with `busy` and cleared with it — on the good path', async () => {
  const h = runSaveName({ publishProfile: async () => true });
  await h.run();
  assert.deepEqual(h.log.filter(e => e[0] === 'timer'), [['timer', 5000]], 'saveName did not arm a 5 s timer for the "still waiting" line: ' + JSON.stringify(h.log));
  assert.equal(h.timers.size, 0, 'the timer outlived the wait — it would flip the line on a step that is no longer waiting: ' + JSON.stringify(h.log));
  assert.deepEqual(h.log.filter(e => e[0] === 'busy').map(e => e[1]), [true, false]);
  assert.equal(h.log[h.log.length - 1][0], 'next');
});

test('…and on a throw from publishProfile: busy and the line are both cleared, so the step is not left disabled and silent', async () => {
  const h = runSaveName({ publishProfile: async () => { throw new Error('NO_NETWORK_RELAY'); } });
  await assert.rejects(h.run, /NO_NETWORK_RELAY/);
  assert.equal(h.timers.size, 0, 'the 5 s timer was left armed after the throw: ' + JSON.stringify(h.log));
  assert.deepEqual(h.log.filter(e => e[0] === 'busy').map(e => e[1]), [true, false], 'busy was not reset on the throw — Continue stays disabled for ever: ' + JSON.stringify(h.log));
  assert.equal(h.log.filter(e => e[0] === 'slow').pop()[1], false, 'the line was left on screen after the throw');
  assert.ok(!h.log.some(e => e[0] === 'next'), 'the wizard advanced past a profile that never published');
});

// ── the engine, lifted from the SHIPPED bundle and run with a fetch spy ─────────────────────────────────
// The same lift as only-the-wizard-puts-a-church-on-the-serving-box: the proxy throws on any identifier the
// stubs do not name, so a new dependency in selfRegister is a loud failure here rather than a silent one.
import { fnBody } from './test-slice.mjs';
const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const ORIGIN = 'http://127.0.0.1:8787';          // the box serving the console (the Suite)
const CONFIG = 'http://192.168.1.20:8787';       // where configBase() points — a relay the church chose
// THE SHIPPED LIST, read out of the bundle rather than typed here, so this pin follows the list that ships.
const SHIPPED = (() => {
  const m = VENDOR.match(/CANONICAL_RELAYS\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, 'CANONICAL_RELAYS is not in vendor/steward.js — re-anchor');
  return m[1].split(',').map(x => x.trim().replace(/^["'`]|["'`]$/g, '')).filter(Boolean);
})();
assert.equal(SHIPPED.length, 2, 'the shipped relay list is ' + JSON.stringify(SHIPPED) + ' — this test was written against two; re-measure before changing the pin');
const asBase = (r) => r.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:').replace(/\/relay\/?$/i, '');

function liftSelfRegister({ fetch }) {
  const stubs = {
    churchSk: new Uint8Array(32).fill(7), churchPub: 'PUB', pub: 'PUB', actingChurch: null,
    _regNeedsName: false, _armRegGate: () => {}, _openRegGate: () => {}, _markRegOk: () => {},
    npubEncode: (p) => 'npub_' + p,
    CANONICAL_RELAYS: SHIPPED,
    SELFREG_KEY: 'sr',
    finalizeEvent: (e) => ({ ...e, id: 'evt', sig: 'sig', pubkey: 'PUB' }),
    now: () => 1788500000,
    _ownOrigin: () => ORIGIN,
    window: { Steward: { configBase: () => CONFIG }, dispatchEvent: () => true },
    localStorage: { getItem: () => '{}', setItem: () => {} },
    AbortSignal: { timeout: () => undefined },
    _boxHostsUs: false, lsSet: () => {}, _boxHostsKey: () => 'bh',
    _gate: { refresh: () => Promise.resolve([]) }, relaysRaw: () => [],
    fetch,
  };
  const proxy = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, '');
      if (base in t) return t[base];
      throw new ReferenceError('the lifted selfRegister needs `' + String(k) + '` — add a stub');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const body = fnBody(VENDOR, 'async selfRegister(name, opts) {', 'selfRegister');
  const fn = new Function('scope', `with (scope) { return ({ ${body} }).selfRegister; }`)(proxy);
  return (name, opts) => fn.call({}, name, opts);
}

// WHAT WAS DIALLED ON 3a8c980, by the sequential loop, for the wizard's call (createHere, configBase not
// the pool): the serving origin, configBase(), then each shipped relay as an https base. The set — not the
// order — is what rule 10 protects, and this list is the whole of it.
const DIALLED_BEFORE = [ORIGIN, CONFIG, ...SHIPPED.map(asBase)];

test('rule 10: the bases dialled are exactly the ones the sequential loop dialled — the same four, nothing added, nothing dropped', async () => {
  const posts = [];
  const run = liftSelfRegister({ fetch: async (u) => { posts.push(String(u).replace(/\/config$/, '')); return { ok: true, json: async () => ({}) }; } });
  await run('St Columba, lifted', { createHere: true });
  assert.deepEqual([...posts].sort(), [...DIALLED_BEFORE].sort(),
    'selfRegister dialled ' + JSON.stringify(posts) + '; on 3a8c980 it dialled ' + JSON.stringify(DIALLED_BEFORE));
  assert.equal(posts.length, new Set(posts).size, 'a base was dialled twice: ' + JSON.stringify(posts));
});

test('…and the four are all in flight before any of them has answered', async () => {
  // A fetch that does not answer until told to. Sequential code dials the second base only after the first
  // resolves, so at the first pause exactly ONE would be pending; parallel code has all four pending.
  const pending = []; let resolved = 0;
  const run = liftSelfRegister({ fetch: (u) => new Promise((res) => pending.push({ u: String(u).replace(/\/config$/, ''), res })) });
  const p = run('St Columba, lifted', { createHere: true });
  await sleep(50);
  assert.equal(resolved, 0);
  assert.deepEqual(pending.map(x => x.u).sort(), [...DIALLED_BEFORE].sort(),
    'with no relay having answered yet, ' + pending.length + ' base(s) were dialled: ' + JSON.stringify(pending.map(x => x.u)) +
    ' — the bases are being asked one after another, so every unreachable host adds its own timeout to the wait');
  // Let them answer, in reverse dial order, and the function still comes back accepted with every mark.
  for (const x of [...pending].reverse()) { resolved++; x.res({ ok: true, json: async () => ({}) }); }
  const out = await p;
  assert.equal(out.ok, true);
  assert.deepEqual(out.refused, []); assert.deepEqual(out.unreachable, []);
});

test('…and a base that throws or refuses is still told apart from one that accepts, per base, when they land out of order', async () => {
  const run = liftSelfRegister({ fetch: async (u) => {
    const b = String(u).replace(/\/config$/, '');
    if (b === ORIGIN) { await sleep(30); return { ok: false, status: 403, json: async () => ({ error: 'this relay is already set up for its church' }) }; }
    if (b === CONFIG) throw new TypeError('Failed to fetch');
    return { ok: true, json: async () => ({}) };
  } });
  const out = await run('St Columba, lifted', { createHere: true });
  assert.equal(out.ok, true, 'a shipped relay accepted, so ok');
  assert.deepEqual(out.refused.map(r => [r.base, r.status, r.why]), [[ORIGIN, 403, 'this relay is already set up for its church']]);
  assert.deepEqual(out.unreachable, [CONFIG]);
});
