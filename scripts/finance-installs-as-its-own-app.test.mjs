// FINANCE.HTML INSTALLS AS ITS OWN DESKTOP APP ("Install TrinityOne Finance"), WITH THE GOLD LEDGER ICON.
//   Run: node --test scripts/finance-installs-as-its-own-app.test.mjs
//
// finance.html links finance.webmanifest: its own name, its own `id` (so Chrome/Edge treat it as a different installed
// app from the member app, whose manifest.json scope "./" also covers this page), start_url finance.html, standalone,
// no orientation lock (a desktop surface), and the icons/finance-* set made by scripts/make-icons.mjs.
//
// POINT OF USE. Nothing here reads finance.webmanifest off disk to decide what a browser sees:
//   (a) a REAL gateway serves finance.html; the manifest is found through finance.html's OWN <link rel="manifest">,
//       fetched from the gateway, and every icon it names is fetched from the gateway and its PNG header measured;
//   (b) scripts/build-pages.sh and scripts/build-strict-tgz.sh are RUN and their output read (the manifest and icons
//       ship; _headers gives the manifest its type and the finance.html CSP lets it load); sw.js is RUN in a vm and its
//       activate handler, given the real finance.html, caches the manifest;
//   (c) headless chromium loads finance.html from a gateway started out of the strict relay bundle (the production CSP)
//       and CDP is asked what the BROWSER parsed: Page.getAppManifest (no errors, the right name/id) and
//       Page.getInstallabilityErrors (none).
// Nothing matches text in app/*.jsx (CLAUDE.md rule 3).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, symlinkSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { WebSocket } from 'ws';
import { freePort } from './relay-network-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const STRICT_SCRIPT = "script-src 'self' 'wasm-unsafe-eval'";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const scratch = [], procs = [];
const tmp = (tag) => { const d = mkdtempSync(join(tmpdir(), 'trin-fininst-' + tag + '-')); scratch.push(d); return d; };
after(() => { for (const p of procs) { try { p.kill('SIGKILL'); } catch {} } for (const d of scratch) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

// the manifest href of a page's <link rel="manifest"> (attribute order free), or null
const manifestHref = (html) => {
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/\brel="manifest"/i.test(tag)) continue;
    const h = tag.match(/\bhref="([^"]+)"/i); if (h) return h[1];
  }
  return null;
};
// width x height from a PNG's IHDR
const pngSize = (buf) => {
  assert.equal(buf.subarray(1, 4).toString('latin1'), 'PNG', 'not a PNG');
  return buf.readUInt32BE(16) + 'x' + buf.readUInt32BE(20);
};

const BLACKHOLE = `const real = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const u = String(input && input.url ? input.url : input);
  if (/trinityone\\.church|\\.ts\\.net|trycloudflare/i.test(u)) return Promise.reject(new Error('blackholed by test: ' + u));
  return real.call(this, input, init);
};\n`;
async function startGateway(dir) {
  const port = await freePort('the finance-install test\'s gateway');
  const dataDir = tmp('gwdata');
  const preload = join(dataDir, 'blackhole.mjs');
  writeFileSync(preload, BLACKHOLE);
  const proc = spawn(process.execPath, [join(dir, 'scripts/gateway.mjs'), String(port)], {
    cwd: dir, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, STRICT_CSP: '', RELAY_SYNC: '0', RELAY_HOST: '127.0.0.1', RELAY_NO_OPEN: '1',
      RELAY_DIRECTORY: 'http://127.0.0.1:9', TRINITY_TAILSCALE_BIN: '/nonexistent/tailscale', NODE_OPTIONS: '--import ' + preload },
  });
  procs.push(proc);
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 200 && !up; i++) { try { up = (await fetch(base + '/finance.html')).ok; } catch {} if (!up) await sleep(150); }
  assert.ok(up, 'the gateway in ' + dir + ' never served /finance.html');
  return { base, stop() { try { proc.kill('SIGKILL'); } catch {} } };
}

// ── (a) the real gateway, from finance.html's own link ─────────────────────────────────────────────────────────────
test('the gateway: finance.html links a manifest it serves as application/manifest+json, every icon it lists is a real PNG of its declared size, and it is a different app from the member one',
  { timeout: 120000 }, async () => {
  const gw = await startGateway(ROOT);
  try {
    const pageUrl = gw.base + '/finance.html';
    const html = await (await fetch(pageUrl)).text();
    assert.match(html, /TrinityOne Finance/, 'the gateway did not serve finance.html');
    const href = manifestHref(html);
    assert.ok(href, 'finance.html has no <link rel="manifest"> — Chrome/Edge will not offer to install it');
    const mUrl = new URL(href, pageUrl).href;
    const mRes = await fetch(mUrl);
    assert.equal(mRes.status, 200, 'the manifest finance.html links is not served: ' + mUrl);
    assert.match(mRes.headers.get('content-type') || '', /^application\/manifest\+json/, 'the manifest is served with the wrong type');
    const man = JSON.parse(await mRes.text());
    assert.equal(man.name, 'TrinityOne Finance');
    assert.equal(man.short_name, 'Finance');
    assert.equal(man.display, 'standalone');
    assert.equal(man.orientation, undefined, 'the finance manifest locks an orientation — it is a desktop app');
    assert.equal(new URL(man.start_url, mUrl).href, pageUrl, 'start_url does not open finance.html');
    // the scope must contain start_url, or the browser ignores the scope
    assert.ok(pageUrl.startsWith(new URL(man.scope || './', mUrl).href), 'start_url is outside the scope');
    // icons: each one fetched through the gateway, a PNG of the size it claims; a 512 "any" and a 512 "maskable"
    assert.ok(Array.isArray(man.icons) && man.icons.length, 'the manifest lists no icons');
    for (const ic of man.icons) {
      const r = await fetch(new URL(ic.src, mUrl));
      assert.equal(r.status, 200, ic.src + ' is not served');
      assert.match(r.headers.get('content-type') || '', /^image\/png/, ic.src + ' is not served as a PNG');
      assert.equal(ic.type, 'image/png');
      assert.equal(pngSize(Buffer.from(await r.arrayBuffer())), ic.sizes, ic.src + ' is not the size the manifest declares');
      assert.match(ic.src, /^icons\/finance-/, ic.src + ' is not one of the finance icons');
    }
    const has = (size, purpose) => man.icons.some(i => i.sizes === size && (i.purpose || 'any').split(/\s+/).includes(purpose));
    assert.ok(has('512x512', 'any'), 'no 512px icon — the installed app would use a blurry upscale');
    assert.ok(has('512x512', 'maskable'), 'no maskable 512px icon');
    // a DIFFERENT app from the member one: compare the manifests' resolved ids (id defaults to start_url when absent)
    const iHtml = await (await fetch(gw.base + '/index.html')).text();
    const iUrl = new URL(manifestHref(iHtml), gw.base + '/index.html').href;
    const member = await (await fetch(iUrl)).json();
    const idOf = (m, u) => new URL(m.id || m.start_url, new URL(m.start_url, u)).href.split('#')[0];
    assert.notEqual(idOf(man, mUrl), idOf(member, iUrl), 'the finance manifest has the member app\'s id — installing one would replace the other');
    assert.notEqual(man.name, member.name);
  } finally { gw.stop(); }
});

// ── (b) the two builds, and sw.js ──────────────────────────────────────────────────────────────────────────────────
const SHIPPED = ['finance.webmanifest', 'icons/finance-192.png', 'icons/finance-512.png', 'icons/finance-maskable-512.png'];

test('build-pages.sh: the deploy ships the manifest and its icons, _headers types it, and the /finance.html CSP lets it load', { timeout: 300000 }, () => {
  const out = join(tmp('pages'), 'dist');
  execFileSync('bash', ['scripts/build-pages.sh'], { cwd: ROOT, env: { ...process.env, PAGES_OUT: out }, stdio: 'pipe', timeout: 300000 });
  const html = readFileSync(join(out, 'finance.html'), 'utf8');
  const href = manifestHref(html);
  assert.equal(href, 'finance.webmanifest', 'the deployed finance.html does not link the finance manifest');
  for (const f of SHIPPED) assert.ok(existsSync(join(out, f)), 'the Pages deploy is missing ' + f);
  const man = JSON.parse(readFileSync(join(out, href), 'utf8'));
  for (const ic of man.icons) assert.ok(existsSync(join(out, ic.src)), 'the Pages deploy is missing the manifest icon ' + ic.src);
  const headers = readFileSync(join(out, '_headers'), 'utf8');
  assert.match(headers, /^\/\*\.webmanifest\n  Content-Type: application\/manifest\+json$/m, '_headers does not serve the manifest as application/manifest+json');
  const csp = (headers.match(/^\/finance\.html\n  Content-Security-Policy: (.+)$/m) || [])[1];
  assert.ok(csp, '/finance.html has no CSP route');
  // manifest-src falls back to default-src: 'self' must be allowed by whichever governs it
  const dir = (name) => { const d = csp.split(';').map(s => s.trim()).find(s => s.split(/\s+/)[0] === name); return d ? d.split(/\s+/).slice(1) : null; };
  const governing = dir('manifest-src') || dir('default-src');
  assert.ok(governing && governing.includes("'self'"), 'the /finance.html CSP blocks a same-origin manifest: ' + csp);
});

let strictDir = null;
function buildStrict() {
  if (strictDir) return strictDir;
  const d = tmp('strict');
  const tgz = join(d, 'web.tgz');
  execFileSync('bash', ['scripts/build-strict-tgz.sh', tgz, 'HEAD'], { cwd: ROOT, stdio: 'pipe', timeout: 300000 });
  const x = join(d, 'x');
  mkdirSync(x, { recursive: true });
  execFileSync('tar', ['-xzf', tgz, '-C', x]);
  strictDir = x;
  return x;
}

test('build-strict-tgz.sh (the relay bundle): ships the manifest and its icons, and its finance.html links it', { timeout: 300000 }, () => {
  const x = buildStrict();
  assert.equal(manifestHref(readFileSync(join(x, 'finance.html'), 'utf8')), 'finance.webmanifest', 'the relay bundle\'s finance.html does not link the manifest');
  for (const f of SHIPPED) assert.ok(existsSync(join(x, f)), 'the relay bundle is missing ' + f);
  const man = JSON.parse(readFileSync(join(x, 'finance.webmanifest'), 'utf8'));
  for (const ic of man.icons) assert.ok(existsSync(join(x, ic.src)), 'the relay bundle is missing the manifest icon ' + ic.src);
});

test('sw.js: activate with a finance.html window open caches the manifest finance.html links (read from the real finance.html)', async () => {
  const realFinance = readFileSync(join(ROOT, 'finance.html'), 'utf8');
  const store = new Map();
  const keyOf = (u) => '.' + new URL(typeof u === 'string' ? u : u.url, 'https://app.example/').pathname;
  class Resp { constructor(body) { this.body = String(body); this.ok = true; } async text() { return this.body; } clone() { return new Resp(this.body); } }
  const fetchFn = async (u) => new Resp(keyOf(u) === './finance.html' ? realFinance : '/* ' + keyOf(u) + ' */');
  const cache = { add: async (u) => { store.set(keyOf(u), await (await fetchFn(u)).text()); }, put: async (req, res) => { store.set(keyOf(req), await res.text()); } };
  const listeners = {};
  const self = { addEventListener: (t, f) => { listeners[t] = f; }, location: { origin: 'https://app.example' },
    clients: { claim: async () => {}, matchAll: async () => [{ url: 'https://app.example/finance.html' }] }, skipWaiting: () => {}, registration: { showNotification() {} } };
  const caches = { open: async () => cache, keys: async () => [], delete: async () => true, match: async () => undefined };
  const ctx = vm.createContext({ self, caches, fetch: fetchFn, Response: Resp, Request: class { constructor(u) { this.url = u; } }, URL, console: { warn() {}, log() {} } });
  vm.runInContext(readFileSync(join(ROOT, 'sw.js'), 'utf8'), ctx, { filename: 'sw.js' });
  let p = null; listeners.activate({ waitUntil: (x) => { p = x; } }); await p;
  assert.ok(store.has('./finance.html'), 'CONTROL: activate did not cache finance.html at all');
  assert.ok(store.has('./finance.webmanifest'), 'activate cached finance.html but not the manifest it links');
});

// ── (c) what chromium parsed ───────────────────────────────────────────────────────────────────────────────────────
async function startChrome() {
  const cdp = await freePort('the finance-install test\'s Chrome debug port');
  const prof = mkdtempSync(join(tmpdir(), 'trin-fininst-chrome-'));
  scratch.push(prof);
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD,
    `--user-data-dir=${prof}`, '--window-size=1100,900', 'about:blank'], { stdio: 'ignore' });
  procs.push(chr);
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  return { send, stop() { try { ws.close(); } catch {} try { chr.kill('SIGKILL'); } catch {} } };
}

test('chromium, under the production strict CSP, parses finance.html\'s manifest with no errors and finds the page installable as "TrinityOne Finance"',
  { skip: !CHROME ? 'no chromium' : false, timeout: 300000 }, async () => {
  const x = buildStrict();
  if (!existsSync(join(x, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(x, 'node_modules'), 'dir');   // read-only: the gateway bundles nothing
  // the gateway under test is this tree's (identical once committed; an uncommitted change to it is what answers)
  copyFileSync(join(ROOT, 'scripts/gateway.mjs'), join(x, 'scripts/gateway.mjs'));
  const gw = await startGateway(x);
  const c = await startChrome();
  try {
    const csp = (await fetch(gw.base + '/finance.html')).headers.get('content-security-policy') || '';
    assert.ok(csp.includes(STRICT_SCRIPT), 'CONTROL: the bundle gateway is not serving the strict CSP, so this is not the production page: ' + csp);
    await c.send('Page.navigate', { url: gw.base + '/finance.html' });
    let am = null, inst = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      await sleep(500);
      const r = await c.send('Page.getAppManifest');
      am = r.result || r.error;
      if (am && am.url && am.data) break;
    }
    console.log('    manifest: ' + JSON.stringify({ url: am && am.url, errors: am && am.errors, typed: !!(am && am.manifest), id: am && am.manifest && am.manifest.id }));
    assert.ok(am && am.url, 'chromium found no manifest on finance.html: ' + JSON.stringify(am));
    assert.equal(am.url, gw.base + '/finance.webmanifest');
    assert.deepEqual(am.errors, [], 'chromium reported errors parsing the finance manifest: ' + JSON.stringify(am.errors));
    // chromium reports errors: [] for a manifest that 404s — its body is what proves it was fetched
    assert.ok(am.data, 'chromium fetched no manifest body (the link points at a file the box does not serve)');
    const data = JSON.parse(am.data);
    assert.equal(data.name, 'TrinityOne Finance');
    if (am.manifest) {   // the typed form (newer chromium): what the browser resolved
      assert.equal(am.manifest.name, 'TrinityOne Finance');
      assert.equal(am.manifest.startUrl, gw.base + '/finance.html');
      assert.equal(am.manifest.id, gw.base + '/finance.html');
    }
    for (let i = 0; i < 20; i++) {
      const r = await c.send('Page.getInstallabilityErrors');
      inst = r.result ? r.result.installabilityErrors : r.error;
      if (Array.isArray(inst) && inst.length === 0) break;
      await sleep(500);
    }
    console.log('    installability errors: ' + JSON.stringify(inst));
    assert.deepEqual(inst, [], 'chromium says finance.html is not installable: ' + JSON.stringify(inst));
  } finally { c.stop(); gw.stop(); }
});
