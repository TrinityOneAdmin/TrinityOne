// THE APP-PAGE CSP MUST ADMIT THE YOUTUBE EMBED HOST — OR THE WATCH PLAYER IS A BLACK BOX IN THE BROWSER.
//   Run: node --test scripts/the-app-page-csp-admits-the-youtube-embed.test.mjs
//
// The Watch screen embeds a sermon/live video in a cross-origin <iframe> whose src is built by ytEmbedSrc()
// (app/screens-watch.jsx) and points at https://www.youtube-nocookie.com/embed/<id>. The app-page CSP that
// the gateway serves on index.html had frame-src 'self', which blocks that cross-origin iframe — on the web
// the player renders as a black rectangle (it still works in the APK WebView, which does not enforce page CSP
// the same way, so this was invisible until a browser pilot). The fix adds the youtube-nocookie host to
// frame-src.
//
// Point of use (CLAUDE.md rule 1): this spawns a REAL scripts/gateway.mjs and reads the Content-Security-Policy
// header off the served app shell — the exact header the browser enforces. Reverting frame-src back to 'self'
// fails HERE. It does NOT text-match app/*.jsx (rule 3): the second test LIFTS ytEmbedSrc out of the jsx and
// RUNS it, then asserts the origin it produces is one the served CSP admits — tying the policy to the real embed.
//
// Shared code touched (CLAUDE.md rule 2): the `CSP` constant in scripts/gateway.mjs is served on EVERY HTML
// response — index.html (the app shell, lines ~8362/8511) and the /install + /apks pages (~8397). Only the
// frame-src directive changed; the addition is a single cross-origin host (www.youtube-nocookie.com), so the
// one new capability is "this page may frame the cookieless YouTube embed". No other directive moved, so no
// other consumer of `CSP` loses anything.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { fnBody } from './test-slice.mjs';

const PORT = 19917;   // HIGH port (19900-19999) so a concurrent suite on the usual fixed ports cannot collide
const HTTP = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sk = generateSecretKey();
const NPUB = npubEncode(getPublicKey(sk));

let relay, dataDir;
async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`${HTTP}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }

before(async () => {
  await requireFreePort(PORT, 'the-app-page-csp-admits-the-youtube-embed.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-ytcsp-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: NPUB, RELAY_MAX_EVENTS: '5000', TRINITY_TAILSCALE_BIN: '/nonexistent' },
      stdio: 'ignore' });
  await waitReady();
});
after(async () => { try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('the served app-page CSP frame-src admits the YouTube embed host (and still frame-locks ancestors)', async () => {
  // Host is 127.0.0.1 (not the marketing apex), so '/' serves the app shell index.html — carrying `CSP`.
  const r = await fetch(`${HTTP}/`, { headers: { Host: '127.0.0.1' } });
  assert.equal(r.status, 200, 'the app shell was not served');
  assert.match(r.headers.get('content-type') || '', /text\/html/, 'the app shell is not HTML');
  const csp = r.headers.get('content-security-policy') || '';

  // THE FIX: frame-src must admit the cookieless YouTube embed host.
  const frameSrc = (csp.match(/frame-src ([^;]*)/) || [, ''])[1];
  assert.notEqual(frameSrc, '', 'the app-page CSP has no frame-src directive at all');
  assert.match(frameSrc, /https:\/\/www\.youtube-nocookie\.com/, 'frame-src does not admit www.youtube-nocookie.com — the Watch player iframe is blocked (black box) on the web');
  assert.match(frameSrc, /'self'/, 'frame-src dropped \'self\' — same-origin iframes (relay panel, print overlay) would break');

  // MINIMAL (audit): only the one cookieless host is admitted; www.youtube.com is NOT (no app iframe loads from it).
  assert.doesNotMatch(frameSrc, /https:\/\/www\.youtube\.com(?!-)/, 'frame-src admits www.youtube.com, which no iframe in the app actually loads from');

  // frame-ANCESTORS is unchanged — the app page itself is still not framable off-origin.
  assert.match(csp, /frame-ancestors 'self'/, 'frame-ancestors was loosened — the app page must stay un-framable cross-origin');
});

test('the host ytEmbedSrc() actually embeds is one the served CSP admits (lifted + run, rule 3)', async () => {
  // Lift the REAL builder from the jsx and run it — do not match text in app/*.jsx (ships unbundled).
  const SRC = readFileSync(new URL('../app/screens-watch.jsx', import.meta.url), 'utf8');
  const body = fnBody(SRC, 'function ytEmbedSrc(id) {', 'ytEmbedSrc');
  const ytEmbedSrc = new Function('return (' + body + ')')();   // pure: a string template, no React/DOM
  const src = ytEmbedSrc('dQw4w9WgXcQ');
  const origin = new URL(src).origin;   // https://www.youtube-nocookie.com
  assert.equal(origin, 'https://www.youtube-nocookie.com', 'ytEmbedSrc no longer embeds the cookieless YouTube host');

  const r = await fetch(`${HTTP}/`, { headers: { Host: '127.0.0.1' } });
  const frameSrc = ((r.headers.get('content-security-policy') || '').match(/frame-src ([^;]*)/) || [, ''])[1];
  assert.ok(frameSrc.includes(origin), `the served CSP frame-src (${frameSrc}) does not admit the origin ytEmbedSrc embeds (${origin})`);
});
