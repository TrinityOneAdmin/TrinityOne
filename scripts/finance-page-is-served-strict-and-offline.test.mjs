// FINANCE.HTML IS SERVED LIKE THE OTHER APP SHELLS: PRE-TRANSPILED, UNDER THE STRICT CSP, AND OFFLINE AS ITSELF.
//   Run: node --test scripts/finance-page-is-served-strict-and-offline.test.mjs
//
// T1Finance plan §5 (audit F3 HIGH, F11). Three places decide how an app shell reaches a browser, and each had a
// hand list of exactly two shells (index.html, steward.html):
//   • scripts/build-pages.sh   — the Cloudflare Pages deploy: transpiles the shells, ABORTS if one still carries
//                                Babel / .jsx / an inline script, and writes the strict-CSP `_headers` routes;
//   • scripts/build-strict-tgz.sh — the relay's web bundle: deletes EVERY .jsx, so a shell it does not rewrite is a
//                                dead page on every relay;
//   • scripts/gateway.mjs      — ONE CSP for the whole box, strict only when every shell is Babel-free
//                                (shellsAreStrict), so a lax finance.html must keep it lax and a strict one must not.
// And sw.js fell back to index.html — the MEMBER app — for any navigation it could not fetch, finance.html included.
//
// POINT OF USE. The two build scripts are RUN (build-pages into a scratch PAGES_OUT, build-strict-tgz at HEAD into a
// scratch .tgz) and their output read. The gateway is STARTED from that extracted strict bundle and asked for
// /finance.html — the header it sends is the assertion — and again with a lax finance.html swapped in. sw.js is RUN
// in a vm with a fake service-worker scope and its fetch / activate handlers driven. Nothing matches text in app/*.jsx.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, symlinkSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import vm from 'node:vm';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const STRICT_SCRIPT = "script-src 'self' 'wasm-unsafe-eval'";
const scratch = [];
const tmp = (tag) => { const d = mkdtempSync(join(tmpdir(), 'trin-fin-' + tag + '-')); scratch.push(d); return d; };
const procs = [];
after(() => { for (const p of procs) { try { p.kill('SIGKILL'); } catch {} } for (const d of scratch) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

// every local file a page loads through src= / href= (no URLs, no anchors)
const localRefs = (html) => [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(u => !/^(https?:|#|data:|mailto:)/.test(u));
const babelFree = (html, label) => {
  assert.doesNotMatch(html, /type="text\/babel"/, label + ' still loads in-browser Babel scripts');
  assert.doesNotMatch(html, /babel\.min\.js/, label + ' still loads the Babel runtime');
  assert.doesNotMatch(html, /src="[^"]*\.jsx"/, label + ' still points at .jsx files');
  assert.doesNotMatch(html, /<script>/, label + ' has an inline script — the strict CSP blocks it');
};

let pagesOut = null;
function buildPages() {
  if (pagesOut) return pagesOut;
  const out = join(tmp('pages'), 'dist');
  execFileSync('bash', ['scripts/build-pages.sh'], { cwd: ROOT, env: { ...process.env, PAGES_OUT: out }, stdio: 'pipe', timeout: 300000 });
  pagesOut = out;
  return out;
}

test('build-pages.sh: finance.html is transpiled, every file it loads is in the deploy, and it gets the strict CSP route', () => {
  const out = buildPages();
  const html = readFileSync(join(out, 'finance.html'), 'utf8');
  babelFree(html, 'pages-dist/finance.html');
  assert.match(html, /<script src="finance-mode\.js"><\/script>/, 'the app flag is not loaded');
  assert.match(html, /<script src="app\/finance-shell\.js"><\/script>/, 'the finance shell is not loaded as transpiled .js');
  for (const ref of localRefs(html)) assert.ok(existsSync(join(out, ref)), 'finance.html references ' + ref + ', which the deploy does not contain');
  const headers = readFileSync(join(out, '_headers'), 'utf8');
  const route = (p) => { const m = headers.match(new RegExp('^' + p.replace(/\./g, '\\.') + '\\n  Content-Security-Policy: (.+)$', 'm')); return m ? m[1] : null; };
  assert.ok(route('/finance.html'), '/finance.html has no CSP route in _headers');
  assert.ok(route('/finance.html').includes(STRICT_SCRIPT), '/finance.html is not given the strict script-src');
  assert.equal(route('/finance.html'), route('/steward.html'), '/finance.html is not given the SAME CSP as the console');
  // CONTROL: the two shells that were already there are still built the same way
  babelFree(readFileSync(join(out, 'steward.html'), 'utf8'), 'pages-dist/steward.html');
  babelFree(readFileSync(join(out, 'index.html'), 'utf8'), 'pages-dist/index.html');
});

let strictDir = null;
function buildStrict() {
  if (strictDir) return strictDir;
  const d = tmp('strict');
  const tgz = join(d, 'web.tgz');
  execFileSync('bash', ['scripts/build-strict-tgz.sh', tgz, 'HEAD'], { cwd: ROOT, stdio: 'pipe', timeout: 300000 });
  const x = join(d, 'x');
  execFileSync('mkdir', ['-p', x]);
  execFileSync('tar', ['-xzf', tgz, '-C', x]);
  strictDir = x;
  return x;
}

test('build-strict-tgz.sh (the relay bundle): finance.html is rewritten to the transpiled scripts, which it ships', () => {
  const x = buildStrict();
  const html = readFileSync(join(x, 'finance.html'), 'utf8');
  babelFree(html, 'the relay bundle\'s finance.html');
  for (const ref of localRefs(html)) assert.ok(existsSync(join(x, ref)), 'the relay bundle\'s finance.html references ' + ref + ', which the bundle does not contain');
});

// ── the gateway's ONE CSP ──────────────────────────────────────────────────────────────────────────────────────────
const GW = readFileSync(join(ROOT, 'scripts/gateway.mjs'), 'utf8');
const shellsAreStrict = new Function(GW.match(/const STRICT_SHELLS = \[[^\]]*\];/)[0] + '\n' + fnBody(GW, 'function shellsAreStrict(readShell) {', 'shellsAreStrict') + '\nreturn shellsAreStrict;')();

test('shellsAreStrict: strict only when index, steward AND finance are Babel-free; an absent finance.html is not held against it', () => {
  const LAX = '<script type="text/babel" src="app/x.jsx"></script>', OK = '<script src="app/x.js"></script>';
  const reader = (m) => (f) => { if (!(f in m)) throw new Error('ENOENT'); return m[f]; };
  assert.equal(shellsAreStrict(reader({ 'index.html': OK, 'steward.html': OK, 'finance.html': OK })), true);
  assert.equal(shellsAreStrict(reader({ 'index.html': OK, 'steward.html': OK, 'finance.html': LAX })), false, 'a lax finance.html was served a strict CSP that breaks it');
  assert.equal(shellsAreStrict(reader({ 'index.html': OK, 'steward.html': OK })), true, 'an older build with no finance.html lost its strict CSP');
  assert.equal(shellsAreStrict(reader({ 'index.html': OK, 'steward.html': LAX, 'finance.html': OK })), false);
  assert.equal(shellsAreStrict(reader({ 'steward.html': OK, 'finance.html': OK })), false, 'no index.html must never read as strict');
});

const freePort = () => new Promise((res, rej) => { const s = createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
async function cspServedFor(dir, path) {
  const port = await freePort();
  const data = tmp('gwdata');
  const gw = spawn(process.execPath, ['scripts/gateway.mjs', String(port)], { cwd: dir, stdio: 'ignore', env: { ...process.env, TRINITY_DATA_DIR: data, STRICT_CSP: '' } });
  procs.push(gw);
  try {
    const t0 = Date.now();
    for (;;) {
      try { const r = await fetch(`http://127.0.0.1:${port}${path}`); if (r.ok) { const body = await r.text(); return { csp: r.headers.get('content-security-policy') || '', body }; } } catch {}
      if (Date.now() - t0 > 30000) throw new Error('the gateway in ' + dir + ' never served ' + path);
      await new Promise(r => setTimeout(r, 200));
    }
  } finally { try { gw.kill('SIGKILL'); } catch {} }
}

test('the gateway started from the strict relay bundle serves finance.html under the strict CSP — and a lax finance.html turns it off', { timeout: 240000 }, async () => {
  const x = buildStrict();
  if (!existsSync(join(x, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(x, 'node_modules'), 'dir');   // read-only use: the gateway bundles nothing
  // the gateway UNDER TEST is this tree's, not the copy the bundle archived from HEAD (identical once committed; this way
  // an uncommitted change — or a sabotage — to scripts/gateway.mjs is what answers)
  copyFileSync(join(ROOT, 'scripts/gateway.mjs'), join(x, 'scripts/gateway.mjs'));
  const strict = await cspServedFor(x, '/finance.html');
  assert.match(strict.body, /TrinityOne Finance/, 'the gateway did not serve finance.html');
  assert.ok(strict.csp.includes(STRICT_SCRIPT), 'a fully transpiled bundle (finance.html included) is served the LAX CSP: ' + strict.csp);
  // swap in the untranspiled finance.html: the box must fall back to the CSP that page can run under
  copyFileSync(join(ROOT, 'finance.html'), join(x, 'finance.html'));
  const lax = await cspServedFor(x, '/finance.html');
  assert.doesNotMatch(lax.csp, /script-src 'self' 'wasm-unsafe-eval'(;|$)/, 'a lax finance.html was served the strict CSP, which blocks its Babel');
  assert.match(lax.csp, /'unsafe-eval'/);
});

// ── sw.js ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// A fake service-worker scope: one Cache keyed by path, a network that can be cut, and the window clients open.
function loadSW({ online = true, clientUrls = [], pages = {} } = {}) {
  const store = new Map();   // './path' -> body
  const keyOf = (u) => { const s = typeof u === 'string' ? u : u.url; const p = new URL(s, 'https://app.example/').pathname; return '.' + p; };
  class Resp { constructor(body, init = {}) { this.body = String(body); this.ok = (init.status || 200) < 400; this.headers = init.headers || {}; } async text() { return this.body; } clone() { return new Resp(this.body); } }
  const net = { online };
  const fetchFn = async (u) => {
    if (!net.online) throw new TypeError('Failed to fetch');
    const k = keyOf(u);
    if (k in pages) return new Resp(pages[k]);
    return new Resp('/* ' + k + ' */');
  };
  const cache = { add: async (u) => { const r = await fetchFn(u); store.set(keyOf(u), await r.text()); }, put: async (req, res) => { store.set(keyOf(req), await res.text()); } };
  const listeners = {};
  const self = {
    addEventListener: (t, f) => { listeners[t] = f; },
    location: { origin: 'https://app.example' },
    clients: { claim: async () => {}, matchAll: async () => clientUrls.map(url => ({ url })) },
    skipWaiting: () => {}, registration: { showNotification() {} },
  };
  const caches = { open: async () => cache, keys: async () => [], delete: async () => true, match: async (u) => (store.has(keyOf(u)) ? new Resp(store.get(keyOf(u))) : undefined) };
  const ctx = vm.createContext({ self, caches, fetch: fetchFn, Response: Resp, Request: class { constructor(u) { this.url = u; } }, URL, console: { warn() {}, log() {} } });
  vm.runInContext(readFileSync(join(ROOT, 'sw.js'), 'utf8'), ctx, { filename: 'sw.js' });
  const navigate = async (path) => {
    let p = null;
    listeners.fetch({ request: { url: 'https://app.example' + path, method: 'GET', mode: 'navigate', headers: {}, credentials: 'same-origin' }, respondWith: (x) => { p = x; } });
    const r = await p; return r ? r.body : null;
  };
  const activate = async () => { let p = null; listeners.activate({ waitUntil: (x) => { p = x; } }); await p; };
  return { store, net, navigate, activate };
}

test('sw.js offline: finance.html falls back to its OWN cached shell — never to the member app', async () => {
  const sw = loadSW({ online: false });
  sw.store.set('./index.html', 'MEMBER APP'); sw.store.set('./', 'MEMBER APP');
  const none = await sw.navigate('/finance.html');
  assert.doesNotMatch(none, /MEMBER APP/, 'offline, finance.html was answered with the member app');
  assert.match(none, /offline/i, 'with nothing cached the finance app should get the honest offline page');
  sw.store.set('./finance.html', 'FINANCE APP');
  assert.equal(await sw.navigate('/finance.html'), 'FINANCE APP', 'the cached finance shell was not used offline');
  // CONTROL: the member app and the console keep their fallback to the cached member shell
  assert.equal(await sw.navigate('/index.html?x=1'), 'MEMBER APP');
  assert.equal(await sw.navigate('/steward.html'), 'MEMBER APP', 'CONTROL: the console\'s offline fallback changed (it is out of scope here)');
});

test('sw.js activate with a finance.html window open caches the finance shell and what it loads', async () => {
  const page = '<script src="finance-mode.js"></script><script src="app/finance-shell.jsx"></script><link rel="stylesheet" href="brand.css">';
  const sw = loadSW({ clientUrls: ['https://app.example/finance.html'], pages: { './finance.html': page, './index.html': '<script src="app/app.jsx"></script>' } });
  await sw.activate();
  for (const k of ['./finance.html', './finance-mode.js', './app/finance-shell.jsx', './brand.css']) assert.ok(sw.store.has(k), 'activate did not cache ' + k);
  // and with no finance window open, member devices pay nothing for it
  const sw2 = loadSW({ clientUrls: ['https://app.example/index.html'], pages: { './finance.html': page } });
  await sw2.activate();
  assert.ok(!sw2.store.has('./finance.html'), 'a member device cached the finance app it never opened');
});
