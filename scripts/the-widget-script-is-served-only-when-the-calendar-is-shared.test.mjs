// THE EMBEDDABLE WIDGET IS SERVED ONLY WHILE A CHURCH'S CALENDAR SWITCH IS ON, AND IT PHONES HOME TO NOBODY.
//   Run: node --test scripts/the-widget-script-is-served-only-when-the-calendar-is-shared.test.mjs
//
// reference/DESIGN-embeddable-church-info.md phase 3. scripts/public-widget.mjs is the pure builder (its own
// parser and occurrence-expansion are unit-tested directly in
// scripts/the-widget-scripts-own-ics-parser-reads-what-the-feed-writes.test.mjs). This file is the point of
// use (CLAUDE.md rule 1): a real scripts/gateway.mjs, so deleting the route — or its "calendar must be on"
// check — from gateway.mjs fails HERE even though the builder's own tests stay green.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { D } from './trinity-doc-types.mjs';

const PORT = 19917;   // a HIGH port (19900-19999), so a concurrent suite on the usual fixed ports cannot collide
const HTTP = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const SHARE_D = D.SHARE;
const now = () => Math.floor(Date.now() / 1000);
let _tick = now();
const next = () => (_tick = Math.max(_tick + 1, now()));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const grace = K(), stmarks = K();
const ap = grace.pub, bp = stmarks.pub, NPUB = npubEncode(ap), NPUB_B = npubEncode(bp), NPUB_UNKNOWN = npubEncode(K().pub);

let relay, dataDir, pub;
async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`${HTTP}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
function startRelay() {
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: NPUB + ',' + NPUB_B, RELAY_MAX_EVENTS: '5000', TRINITY_TAILSCALE_BIN: '/nonexistent' },
      stdio: 'ignore' });
  return waitReady();
}
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const shareDoc = (who, cp, body) => finalizeEvent({ kind: 30078, created_at: next(), tags: [['d', SHARE_D + cp], ['t', NET]], content: JSON.stringify(body) }, who.sk);
const get = (path) => fetch(HTTP + path);
const widgetUrl = (npub) => `/public/${npub}/widget.js`;

before(async () => {
  await requireFreePort(PORT, 'the-widget-script-is-served-only-when-the-calendar-is-shared.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-widget-'));
  await startRelay();
  pub = await connect();
});
after(async () => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('CONTROL: with no share: document, an unknown church, or a malformed address, the widget is a 404', async () => {
  assert.equal((await get(widgetUrl(NPUB))).status, 404, 'a church that never switched sharing on has a widget script');
  assert.equal((await get(widgetUrl(NPUB_UNKNOWN))).status, 404, 'a church this relay does not hold has a widget script');
  assert.equal((await get(`/public/${ap}/widget.js`)).status, 404, 'a hex pubkey is not an address; only the npub form is');
  assert.equal((await get(`/public/${NPUB}/widget.JS`)).status, 404, 'case must not matter to the 404, only to the route');
});

test('turning the calendar switch on serves the widget, with the strict CSP and no cookie', async () => {
  assert.equal((await publish(pub, shareDoc(grace, ap, { calendar: true, optOut: [], address: 'own' })))[0], true);
  await sleep(200);
  const r = await get(widgetUrl(NPUB));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.match(r.headers.get('content-security-policy') || '', /default-src 'none'/, 'no strict CSP on the served script');
  assert.match(r.headers.get('content-security-policy') || '', /script-src 'self'/, 'the widget cannot run as its own script tag under its own CSP header');
  assert.equal(r.headers.get('set-cookie'), null, 'a cookie was set on a public script');
  assert.equal(r.headers.get('access-control-allow-origin'), '*', 'a church’s own site cannot load the script cross-origin');
  const text = await r.text();
  assert.match(text, /^\(function\(\)\{/, 'the script is not the self-contained IIFE public-widget.mjs builds');
});

test('turning the switch back off takes the widget down at once, same as the calendar feed', async () => {
  assert.equal((await publish(pub, shareDoc(grace, ap, { calendar: false, optOut: [], address: 'own' })))[0], true);
  await sleep(200);
  assert.equal((await get(widgetUrl(NPUB))).status, 404, 'DELETING THE SWITCH FROM SETTINGS would leave the widget script reachable — it must not');
});

test('a co-tenant church\'s switch never turns on another church\'s widget', async () => {
  assert.equal((await publish(pub, shareDoc(stmarks, bp, { calendar: true, optOut: [], address: 'own' })))[0], true);
  await sleep(200);
  assert.equal((await get(widgetUrl(NPUB_B))).status, 200, 're-anchor: St Mark\'s own switch did not turn its own widget on');
  assert.equal((await get(widgetUrl(NPUB))).status, 404, 'St Mark\'s switch turned Grace\'s widget on too');
});

test('the served bytes make no reference to any external host, and only fetch a same-origin calendar.ics', async () => {
  assert.equal((await publish(pub, shareDoc(grace, ap, { calendar: true, optOut: [], address: 'own' })))[0], true);
  await sleep(200);
  const text = await (await get(widgetUrl(NPUB))).text();
  assert.equal(/https?:\/\//.test(text), false, 'the widget script names an external URL: ' + (text.match(/https?:\/\/\S+/) || [])[0]);
  assert.equal(/\b(cdn|googleapis|gstatic|jsdelivr|unpkg|cloudflare)\b/i.test(text), false, 'the widget script names a third-party host');
  assert.match(text, /['"]\/calendar\.ics['"]/, 'the widget does not fetch a relative, same-origin calendar.ics');
  assert.equal(/document\.write|eval\(/.test(text), false, 'the widget uses an injection-prone API');
});

test('POST and HEAD behave the same as the calendar route', async () => {
  const post = await fetch(`${HTTP}${widgetUrl(NPUB)}`, { method: 'POST', body: 'x' });
  assert.equal(post.status, 405, 'a POST to the widget script was not refused');
  const head = await fetch(`${HTTP}${widgetUrl(NPUB)}`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'text/javascript; charset=utf-8');
});
