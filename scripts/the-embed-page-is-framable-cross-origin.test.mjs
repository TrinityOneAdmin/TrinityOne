// THE PUBLIC EMBED PAGE IS FRAMABLE BY ANY ORIGIN — AND NOTHING ELSE ON THE RELAY IS.
//   Run: node --test scripts/the-embed-page-is-framable-cross-origin.test.mjs
//
// A pilot church could not show the calendar/info widget on its Google Site: the embed we handed out was a
// <script> snippet, and Google Sites (like Wix and Squarespace) sandboxes a pasted page script so it never
// runs. The new /public/<npub>/embed route serves a tiny HTML page — the IDENTICAL public, no-auth widget —
// that a church can frame with an <iframe>, which those builders DO render.
//
// Point of use (CLAUDE.md rule 1): this spawns a REAL scripts/gateway.mjs. Deleting the /embed route, or
// re-adding X-Frame-Options to it (which SEC_HEADERS would do if it were spread in), fails HERE. The widget
// builder's own tests and the widget-preview tests stay green over that hole; this is the test that does not.
//
// Shared code touched (CLAUDE.md rule 2): publicFeed() in scripts/gateway.mjs gains one route; it reuses the
// widget.js builder and the exact widget-preview gate (church exists + per-mode share flag). SEC_HEADERS is
// NOT edited — this route deliberately does not spread it, so no other consumer of SEC_HEADERS changes.
//
// The jsx snippet half is the last test below: widgetEmbedSnippets() is LIFTED from app/stew-dashboard.jsx
// and RUN (rule 3 — app/*.jsx ships unbundled, so matching its text proves nothing), asserting the iframe
// points at /embed and the script at /widget.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { D } from './trinity-doc-types.mjs';
import { fnBody } from './test-slice.mjs';

const PORT = 19918;   // a HIGH port (19900-19999), so a concurrent suite on the usual fixed ports cannot collide
const HTTP = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const SHARE_D = D.SHARE;
const now = () => Math.floor(Date.now() / 1000);
let _tick = now();
const next = () => (_tick = Math.max(_tick + 1, now()));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const grace = K();
const ap = grace.pub, NPUB = npubEncode(ap), NPUB_UNKNOWN = npubEncode(K().pub);

let relay, dataDir, pub;
async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`${HTTP}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
function startRelay() {
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: NPUB, RELAY_MAX_EVENTS: '5000', TRINITY_TAILSCALE_BIN: '/nonexistent' },
      stdio: 'ignore' });
  return waitReady();
}
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const shareDoc = (who, cp, body) => finalizeEvent({ kind: 30078, created_at: next(), tags: [['d', SHARE_D + cp], ['t', NET]], content: JSON.stringify(body) }, who.sk);
const get = (path) => fetch(HTTP + path);
const embedUrl = (npub, mode) => `/public/${npub}/embed` + (mode ? `?mode=${mode}` : '');

before(async () => {
  await requireFreePort(PORT, 'the-embed-page-is-framable-cross-origin.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-embed-'));
  await startRelay();
  pub = await connect();
});
after(async () => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('CONTROL: no share document, an unknown church, or a bad address is a 404', async () => {
  assert.equal((await get(embedUrl(NPUB))).status, 404, 'a church that never switched sharing on has an embed page');
  assert.equal((await get(embedUrl(NPUB_UNKNOWN))).status, 404, 'a church this relay does not hold has an embed page');
  assert.equal((await get(`/public/${ap}/embed`)).status, 404, 'a hex pubkey is not an address; only the npub form is');
});

test('turning the calendar switch on serves a framable embed page', async () => {
  assert.equal((await publish(pub, shareDoc(grace, ap, { calendar: true, optOut: [], address: 'own' })))[0], true);
  await sleep(200);
  const r = await get(embedUrl(NPUB, 'list'));
  assert.equal(r.status, 200, 'the embed page is not served when the calendar is shared');
  assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8');

  // (1) THE PAGE LOADS widget.js — it is the real widget, not a hand-rolled copy.
  const html = await r.text();
  assert.match(html, /<script src="\/public\/[a-z0-9]+\/widget\.js[^"]*" data-mode="list">/, 'the embed page does not load the same-origin widget.js with the chosen mode');

  // (2) NO X-Frame-Options — the whole point. If SEC_HEADERS were spread in, this would be SAMEORIGIN and no
  //     cross-origin site (a Google Site) could frame it. This assertion fails if that header comes back.
  assert.equal(r.headers.get('x-frame-options'), null, 'the embed page sends X-Frame-Options and so cannot be framed cross-origin');

  // (3) A CSP whose frame-ancestors permits cross-origin framing, while the rest of it stays tight.
  const csp = r.headers.get('content-security-policy') || '';
  assert.match(csp, /frame-ancestors \*/, 'the embed page CSP does not allow cross-origin framing');
  assert.match(csp, /default-src 'none'/, 'the embed page CSP is not otherwise tight (default-src)');
  assert.match(csp, /script-src 'self'/, 'the embed page CSP does not allow its one same-origin script');
  assert.doesNotMatch(csp, /frame-ancestors 'none'|frame-ancestors 'self'/, 'the embed page CSP still locks framing');

  // (3b) THE EMBED MUST ACTUALLY WORK, not just frame (added 2026-11-06). widget.js's whole job is a SAME-ORIGIN
  //      fetch (calendar.ics / event-images.json / sermons.xml / plans.json / devotionals.json). Under
  //      default-src 'none' with NO connect-src, every one of those is CSP-blocked and the page shows "Calendar
  //      unavailable right now" — the embed route was dead by its own CSP. img-src is needed for the event cover
  //      photos (same-origin data: URIs), and style-src for BOTH the embed HTML's own inline <style> AND the one
  //      <style> block widget.js injects — without it the widget renders completely unstyled (verified in a
  //      headless browser: default-src 'none' blocks a dynamically-inserted <style>). Deleting any of these three
  //      directives fails HERE.
  assert.match(csp, /connect-src 'self'/, 'the embed CSP has no connect-src — widget.js\'s same-origin fetch of calendar.ics is CSP-blocked and the embed is dead');
  assert.match(csp, /img-src 'self' data:/, 'the embed CSP has no img-src self data: — event cover photos (data: URIs) are blocked');
  assert.match(csp, /style-src [^;]*'unsafe-inline'/, 'the embed CSP has no style-src unsafe-inline — the embed + widget inline <style> blocks are blocked and the widget renders unstyled');
  // minimal: no third-party host anywhere in the policy (same-origin, data:, and keywords only).
  assert.doesNotMatch(csp.replace(/frame-ancestors \*/, ''), /https?:\/\//, 'the embed CSP admits a third-party host — it must stay same-origin only');

  // (4) still CORS-open and cookieless, like every other public route.
  assert.equal(r.headers.get('access-control-allow-origin'), '*', 'the embed page is not CORS-open');
  assert.equal(r.headers.get('set-cookie'), null, 'a cookie was set on a public page');
  // and it keeps the harmless half of the security headers, by hand.
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff', 'the embed page dropped nosniff');
});

test('a mode outside the allow-list falls back to list; HEAD matches GET', async () => {
  const r = await get(embedUrl(NPUB, 'list"><script>alert(1)</script>'));
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /data-mode="list"/, 'an unknown mode was not clamped to the allow-list');
  assert.doesNotMatch(html, /alert\(1\)/, 'the mode query was reflected into the page unescaped');
  const head = await fetch(`${HTTP}${embedUrl(NPUB, 'list')}`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('x-frame-options'), null, 'HEAD reintroduced X-Frame-Options');
});

test('turning the switch back off takes the embed page down at once', async () => {
  assert.equal((await publish(pub, shareDoc(grace, ap, { calendar: false, optOut: [], address: 'own' })))[0], true);
  await sleep(200);
  assert.equal((await get(embedUrl(NPUB, 'list'))).status, 404, 'DELETING THE SWITCH would leave the embed page reachable — it must not');
});

test('a sermons-mode embed is gated on the sermons flag, not the calendar flag', async () => {
  // calendar off, sermons on: a calendar-mode embed is 404 but a sermons-mode embed is served.
  assert.equal((await publish(pub, shareDoc(grace, ap, { calendar: false, sermons: true, optOut: [], address: 'own' })))[0], true);
  await sleep(200);
  assert.equal((await get(embedUrl(NPUB, 'list'))).status, 404, 'a calendar-mode embed served with the calendar switch off');
  const r = await get(embedUrl(NPUB, 'sermons'));
  assert.equal(r.status, 200, 'a sermons-mode embed was not served with sermons sharing on');
  assert.match(await r.text(), /data-mode="sermons"/);
  assert.equal(r.headers.get('x-frame-options'), null);
});

// ── THE JSX SNIPPET (CLAUDE.md rule 3): lift widgetEmbedSnippets() out of app/stew-dashboard.jsx and RUN it.
// Nothing here matches text in the jsx; the two snippet strings the function RETURNS are asserted.
test('widgetEmbedSnippets() builds an iframe at /embed (default) and a script at /widget.js', () => {
  const SRC = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
  const body = fnBody(SRC, 'function widgetEmbedSnippets(url, mode) {', 'widgetEmbedSnippets');
  const widgetEmbedSnippets = new Function('return (' + body + ')')();   // pure: no React, no DOM
  const feed = 'https://relay.example/public/npub1abc/calendar.ics';
  const { iframe, script } = widgetEmbedSnippets(feed, 'month');

  // the iframe — the one a Google Site can render — points at the framable /embed route with the mode.
  assert.match(iframe, /^<iframe src="https:\/\/relay\.example\/public\/npub1abc\/embed\?mode=month"/, 'the iframe does not point at the /embed route with the mode');
  assert.match(iframe, /width="100%"/, 'the iframe is not full width');
  assert.match(iframe, /height="\d+"/, 'the iframe has no fixed height');
  assert.match(iframe, /loading="lazy"/, 'the iframe is not lazy-loaded');
  assert.doesNotMatch(iframe, /\/widget\.js/, 'the iframe wrongly points at widget.js');

  // the script — the raw-HTML fallback — still points at widget.js with the mode as data-mode.
  assert.match(script, /^<script src="https:\/\/relay\.example\/public\/npub1abc\/widget\.js" data-mode="month">/, 'the script snippet is malformed');
  assert.match(script, /<\/script>$/, 'the script snippet is not closed');

  // the mode flows through to both.
  const two = widgetEmbedSnippets(feed, 'list');
  assert.match(two.iframe, /mode=list/);
  assert.match(two.script, /data-mode="list"/);
});
