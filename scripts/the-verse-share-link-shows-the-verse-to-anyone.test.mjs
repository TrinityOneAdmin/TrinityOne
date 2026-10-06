// THE VERSE SHARE LINK SHOWS THE VERSE TO ANYONE WHO OPENS IT.
//   Run: node --test scripts/the-verse-share-link-shows-the-verse-to-anyone.test.mjs
//
// Point of use (CLAUDE.md rule 1): a real scripts/gateway.mjs started as a child process, so
// deleting the /v route from gateway.mjs fails HERE even though public-verse.mjs's own unit tests
// stay green. The verseShareUrl/verseShareFull functions are lifted from app/app.jsx via test-slice
// and run — so deleting the share link from the ShareCard also fails HERE.
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

const PORT = 19921;
const HTTP = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K();
const NPUB = npubEncode(church.pub);

let relay, dataDir;
async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`${HTTP}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }

before(async () => {
  await requireFreePort(PORT, 'the-verse-share-link-shows-the-verse-to-anyone.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-verse-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: NPUB, RELAY_MAX_EVENTS: '5000', TRINITY_TAILSCALE_BIN: '/nonexistent' },
      stdio: 'ignore' });
  await waitReady();
});
after(async () => { try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── gateway route ──

test('GET /v with ref, text, version renders the verse with OG tags', async () => {
  const r = await fetch(`${HTTP}/v?r=${encodeURIComponent('John 3:16')}&t=${encodeURIComponent('For God so loved the world')}&v=WEB`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  const html = await r.text();
  assert.ok(html.includes('For God so loved the world'), 'verse text in body');
  assert.ok(html.includes('John 3:16'), 'reference in body');
  assert.ok(html.includes('WEB'), 'version in body');
  assert.match(html, /og:title/, 'OG title tag present');
  assert.match(html, /og:description/, 'OG description tag present');
});

test('GET /v with no params still serves a valid page', async () => {
  const r = await fetch(`${HTTP}/v`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('<!DOCTYPE html>'), 'valid HTML');
  assert.ok(html.includes('TrinityOne'), 'branding present');
});

test('GET /v escapes HTML in query params', async () => {
  const r = await fetch(`${HTTP}/v?r=${encodeURIComponent('<script>alert(1)</script>')}&t=${encodeURIComponent('<img onerror=x>')}`);
  const html = await r.text();
  assert.ok(!html.includes('<script>alert'), 'script not injected');
  assert.ok(!html.includes('<img onerror'), 'img not injected');
});

test('GET /v sets a strict CSP', async () => {
  const r = await fetch(`${HTTP}/v?r=test&t=test`);
  const csp = r.headers.get('content-security-policy') || '';
  assert.match(csp, /default-src 'none'/, 'default-src none');
  assert.match(csp, /frame-ancestors 'none'/, 'no framing');
});

test('POST /v is rejected', async () => {
  const r = await fetch(`${HTTP}/v`, { method: 'POST' });
  assert.equal(r.status, 405);
});

// ── app-side: verseShareUrl and verseShareFull ──

test('verseShareFull includes a public URL when relays are available', () => {
  const ROOT = new URL('..', import.meta.url).pathname;
  const src = readFileSync(join(ROOT, 'app', 'app.jsx'), 'utf8');
  const urlFn = fnBody(src, 'function verseShareUrl(v)');
  const fullFn = fnBody(src, 'function verseShareFull(v)');
  const textFn = fnBody(src, 'function verseShareText(v)');
  const window = { Fellowship: { relays: ['wss://my.church.example/relay'] } };
  const verseShareText = new Function('v', 'var window = ' + JSON.stringify(window) + ';\n' + textFn.replace(/^function verseShareText\(v\)\s*\{/, '').replace(/\}$/, ''));
  const verseShareUrl = new Function('v', 'var window = ' + JSON.stringify(window) + ';\n' + urlFn.replace(/^function verseShareUrl\(v\)\s*\{/, '').replace(/\}$/, ''));
  const verseShareFull = new Function('v', 'var window = ' + JSON.stringify(window) + ';\nvar verseShareText = ' + textFn + ';\nvar verseShareUrl = ' + urlFn + ';\n' + fullFn.replace(/^function verseShareFull\(v\)\s*\{/, '').replace(/\}$/, ''));

  const verse = { text: 'For God so loved the world', ref: 'John 3:16', version: 'WEB' };
  const url = verseShareUrl(verse);
  assert.ok(url.startsWith('https://my.church.example/v?'), 'URL starts with relay HTTP base + /v');
  assert.ok(url.includes('r=John'), 'URL has ref param');
  assert.ok(url.includes('t=For+God'), 'URL has text param');
  assert.ok(url.includes('v=WEB'), 'URL has version param');

  const full = verseShareFull(verse);
  assert.ok(full.includes('For God so loved the world'), 'full text includes verse');
  assert.ok(full.includes('John 3:16'), 'full text includes ref');
  assert.ok(full.includes('https://my.church.example/v?'), 'full text includes URL');
});

test('verseShareUrl strips /relay from the WSS path', () => {
  const ROOT = new URL('..', import.meta.url).pathname;
  const src = readFileSync(join(ROOT, 'app', 'app.jsx'), 'utf8');
  const urlFn = fnBody(src, 'function verseShareUrl(v)');
  const window = { Fellowship: { relays: ['wss://my.church.example/relay'] } };
  const verseShareUrl = new Function('v', 'var window = ' + JSON.stringify(window) + ';\n' + urlFn.replace(/^function verseShareUrl\(v\)\s*\{/, '').replace(/\}$/, ''));

  const url = verseShareUrl({ text: 'test', ref: 'Gen 1:1' });
  assert.ok(!url.includes('/relay/v'), 'no /relay in the URL path');
  assert.ok(url.includes('.example/v?'), 'clean path');
});

test('verseShareUrl returns empty when no relays', () => {
  const ROOT = new URL('..', import.meta.url).pathname;
  const src = readFileSync(join(ROOT, 'app', 'app.jsx'), 'utf8');
  const urlFn = fnBody(src, 'function verseShareUrl(v)');
  const window = { Fellowship: { relays: [] } };
  const verseShareUrl = new Function('v', 'var window = ' + JSON.stringify(window) + ';\n' + urlFn.replace(/^function verseShareUrl\(v\)\s*\{/, '').replace(/\}$/, ''));

  const url = verseShareUrl({ text: 'test', ref: 'Gen 1:1' });
  assert.equal(url, '', 'no URL when no relays');
});
