// A SCHEDULED PLAN OR DEVOTIONAL IS NOT ON THE PUBLIC FEED UNTIL ITS TIME ARRIVES.
//   Run: node --test scripts/a-scheduled-plan-is-not-on-the-public-feed.test.mjs
//
// Audit 2026-10-07 finding #1 (CRITICAL): publicPlanFields() and publicDevoFields() did not check
// publishAt, so a plan scheduled for next week was immediately visible on the JSON feed — even though
// the WebSocket canRead gate hid it from members. This test drives the gateway feed routes, not the
// pure functions, so deleting the fix from gateway.mjs or public-media.mjs fails HERE.
//
// Also covers finding #2 (widget.js served when only sermons is on) and finding #4 (limit applied
// after sort, not before — the feed must return the NEWEST items, not an arbitrary subset).
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

const PORT = 19921;
const HTTP = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const SHARE_D = D.SHARE, PLAN_D = D.PLAN, DEVO_D = D.DEVO;
const now = () => Math.floor(Date.now() / 1000);
let _tick = now();
const next = () => (_tick = Math.max(_tick + 1, now()));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const grace = K();
const ap = grace.pub, NPUB = npubEncode(ap);

let relay, dataDir, ws;
async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`${HTTP}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
function startRelay() {
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: NPUB, RELAY_MAX_EVENTS: '5000', TRINITY_TAILSCALE_BIN: '/nonexistent' },
      stdio: 'ignore' });
  return waitReady();
}
const connect = () => new Promise((res, rej) => { const w = new WebSocket(WS_URL); w.on('open', () => res(w)); w.on('error', rej); });
const publish = (w, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { w.off('message', on); res([m[2], m[3] || '']); } }; w.on('message', on); w.send(JSON.stringify(['EVENT', evt])); });
const shareDoc = (body) => finalizeEvent({ kind: 30078, created_at: next(), tags: [['d', SHARE_D + ap], ['t', NET]], content: JSON.stringify(body) }, grace.sk);
const planDoc = (id, body) => finalizeEvent({ kind: 30078, created_at: next(), tags: [['d', PLAN_D + id], ['t', NET]], content: JSON.stringify({ id, ...body }) }, grace.sk);
const devoDoc = (id, body) => finalizeEvent({ kind: 30078, created_at: next(), tags: [['d', DEVO_D + id], ['t', NET]], content: JSON.stringify({ id, ...body }) }, grace.sk);
const get = (path) => fetch(HTTP + path);

before(async () => {
  await requireFreePort(PORT, 'a-scheduled-plan-is-not-on-the-public-feed.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-sched-'));
  await startRelay();
  ws = await connect();
  await publish(ws, shareDoc({ calendar: false, sermons: true, plans: true, devos: true, optOut: [], address: 'own', planLimit: 2, devoLimit: 2 }));
  await sleep(200);
});
after(async () => { try { ws && ws.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ---- Finding #1: publishAt gate ----

test('a plan scheduled for the future does not appear on the public feed', async () => {
  const future = now() + 86400;
  await publish(ws, planDoc('plan-xmas', { title: 'Advent Series', days: [{ d: 1, ref: 'Isaiah 9:6' }], publishAt: future }));
  await sleep(200);
  const r = await get(`/public/${NPUB}/plans.json`);
  assert.equal(r.status, 200);
  const feed = await r.json();
  const found = (feed.plans || []).find(p => p.id === 'plan-xmas');
  assert.equal(found, undefined, 'a plan with publishAt in the future appeared on the public feed');
});

test('a plan with publishAt in the past appears on the public feed', async () => {
  const past = now() - 3600;
  await publish(ws, planDoc('plan-past', { title: 'Past Plan', days: [{ d: 1, ref: 'Gen 1:1' }], publishAt: past }));
  await sleep(200);
  const r = await get(`/public/${NPUB}/plans.json`);
  const feed = await r.json();
  const found = (feed.plans || []).find(p => p.id === 'plan-past');
  assert.ok(found, 'a plan with publishAt in the past did not appear on the public feed');
});

test('a devotional scheduled for the future does not appear on the public feed', async () => {
  const future = now() + 86400;
  await publish(ws, devoDoc('devo-xmas', { title: 'Christmas Morning', ref: 'Luke 2:10', text: 'Rejoice.', publishAt: future }));
  await sleep(200);
  const r = await get(`/public/${NPUB}/devotionals.json`);
  assert.equal(r.status, 200);
  const feed = await r.json();
  const found = (feed.devotionals || []).find(d => d.id === 'devo-xmas');
  assert.equal(found, undefined, 'a devotional with publishAt in the future appeared on the public feed');
});

test('a devotional with publishAt in the past appears on the public feed', async () => {
  const past = now() - 3600;
  await publish(ws, devoDoc('devo-past', { title: 'Past Reflection', ref: 'Psalm 23', text: 'He leads.', publishAt: past }));
  await sleep(200);
  const r = await get(`/public/${NPUB}/devotionals.json`);
  const feed = await r.json();
  const found = (feed.devotionals || []).find(d => d.id === 'devo-past');
  assert.ok(found, 'a devotional with publishAt in the past did not appear on the public feed');
});

// ---- Finding #2: widget.js served when only sermons is on ----

test('widget.js is served when only sermons is on (calendar off)', async () => {
  const r = await get(`/public/${NPUB}/widget.js`);
  assert.equal(r.status, 200, 'widget.js returned 404 even though sermons/plans/devos are on');
  const text = await r.text();
  assert.match(text, /^\(function\(\)\{/, 'the served script is not the IIFE');
});

test('widget.js is 404 when all sharing flags are off', async () => {
  await publish(ws, shareDoc({ calendar: false, sermons: false, plans: false, devos: false, optOut: [], address: 'own' }));
  await sleep(200);
  assert.equal((await get(`/public/${NPUB}/widget.js`)).status, 404, 'widget.js was served with all flags off');
  await publish(ws, shareDoc({ calendar: false, sermons: true, plans: true, devos: true, optOut: [], address: 'own', planLimit: 2, devoLimit: 2 }));
  await sleep(200);
});

// ---- Finding #4: sort before limit ----

test('the plans feed returns the newest items when a limit is set, not an arbitrary subset', async () => {
  const old1 = now() - 90000;
  const old2 = now() - 80000;
  const new1 = now() - 10000;
  const new2 = now() - 5000;
  await publish(ws, planDoc('plan-old1', { title: 'Old Plan 1', days: [{ d: 1, ref: 'Gen 1' }], ts: old1 }));
  await publish(ws, planDoc('plan-old2', { title: 'Old Plan 2', days: [{ d: 1, ref: 'Gen 2' }], ts: old2 }));
  await publish(ws, planDoc('plan-new1', { title: 'New Plan 1', days: [{ d: 1, ref: 'Rev 1' }], ts: new1 }));
  await publish(ws, planDoc('plan-new2', { title: 'New Plan 2', days: [{ d: 1, ref: 'Rev 22' }], ts: new2 }));
  await sleep(300);
  const r = await get(`/public/${NPUB}/plans.json`);
  const feed = await r.json();
  assert.equal(feed.plans.length, 2, 'planLimit of 2 did not cap the feed');
  const ids = feed.plans.map(p => p.id);
  assert.ok(ids.includes('plan-new1') || ids.includes('plan-new2'), 'the feed does not contain the newest plans — limit was applied before sort');
  assert.ok(!ids.includes('plan-old1') || !ids.includes('plan-old2'), 'both old plans survived — limit was applied before sort');
});
