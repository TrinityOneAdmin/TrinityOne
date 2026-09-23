// PHASE 2 FEED SETTINGS (Settings → Your website): "how far ahead", "what it is called" and "how much of
// each event" must be read by THE RELAY, not just built correctly by scripts/public-calendar.mjs in
// isolation — that module is unit-tested in scripts/the-public-calendar-file-says-what-it-means.test.mjs.
// This file drives scripts/gateway.mjs's own publicFeed() route with a real share: document, the way a
// church's console actually writes one, so a horizon that stops being READ (only built) still shows here
// as a failure even though the builder's own tests stay green.
//
// Run: node --test scripts/the-website-horizon-and-calname-settings-drive-the-feed.test.mjs
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
import { unfoldIcs } from './public-calendar.mjs';

const PORT = 19916;   // a HIGH port (19900-19999), so a concurrent suite on the usual fixed ports cannot collide
const HTTP = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const SHARE_D = D.SHARE, PUBEVENT_D = D.PUBEVENT;
const now = () => Math.floor(Date.now() / 1000);
let _tick = now();
const next = () => (_tick = Math.max(_tick + 1, now()));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const grace = K();
const ap = grace.pub, NPUB = npubEncode(ap);

// Dates RELATIVE TO WHEN THE TEST RUNS, not hardcoded — a horizon is a distance from "now", and a fixed
// future date would go stale (or start failing the wrong way) the day it stops being far enough ahead.
const addMonths = (months, at = new Date()) => {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};
const SOON = addMonths(0), IN_2M = addMonths(2), IN_5M = addMonths(5), IN_7M = addMonths(7), IN_13M = addMonths(13);
const EV_SOON = 'evtsoon', EV_2M = 'evt2m', EV_5M = 'evt5m', EV_7M = 'evt7m', EV_13M = 'evt13m';
const COPY = {
  [EV_SOON]: { title: 'This week', date: SOON, time: '19:00', where: 'The hall', blurb: 'Notes here' },
  [EV_2M]:   { title: 'In two months', date: IN_2M, time: '19:00', where: 'The hall', blurb: '' },
  [EV_5M]:   { title: 'In five months', date: IN_5M, time: '19:00', where: 'The hall', blurb: '' },
  [EV_7M]:   { title: 'In seven months', date: IN_7M, time: '19:00', where: 'The hall', blurb: '' },
  [EV_13M]:  { title: 'In thirteen months', date: IN_13M, time: '19:00', where: 'The hall', blurb: '' },
};

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
const doc = (who, d, content, at = 0) => finalizeEvent({ kind: 30078, created_at: at || next(), tags: [['d', d], ['t', NET]], content: typeof content === 'string' ? content : JSON.stringify(content) }, who.sk);
const shareDoc = (patch) => doc(grace, SHARE_D + ap, { calendar: true, optOut: [], address: 'own', ...patch });
const copyDoc = (id, body) => doc(grace, PUBEVENT_D + id, body);

function parseIcs(text) {
  const lines = text.replace(/\r\n[ \t]/g, '').split('\r\n').filter(Boolean);
  const cal = { props: {}, events: [] }; let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { cal.events.push(cur); cur = null; continue; }
    const i = line.indexOf(':'); (cur || cal.props)[line.slice(0, i).split(';')[0]] = line.slice(i + 1);
  }
  return cal;
}
const get = (path) => fetch(HTTP + path);
const feedTitles = async () => {
  const cal = parseIcs(await (await get(`/public/${NPUB}/calendar.ics`)).text());
  return cal.events.map(e => e.SUMMARY).sort();
};

before(async () => {
  await requireFreePort(PORT, 'the-website-horizon-and-calname-settings-drive-the-feed.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-horizon-'));
  await startRelay();
  pub = await connect();
  assert.equal((await publish(pub, finalizeEvent({ kind: 0, created_at: now(), tags: [], content: JSON.stringify({ name: 'Grace Church' }) }, grace.sk)))[0], true, 'church profile');
  for (const id of Object.keys(COPY)) assert.equal((await publish(pub, copyDoc(id, COPY[id])))[0], true, 'copy ' + id);
});
after(async () => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('with no horizonMonths in share: the default is 6 months, not "everything we have"', async () => {
  assert.equal((await publish(pub, shareDoc({})))[0], true);
  await sleep(200);
  const titles = await feedTitles();
  assert.deepEqual(titles, ['In five months', 'In two months', 'This week'].sort(),
    're-anchor: the default horizon is no longer 6 months, or the relay is not reading it');
  assert.equal(titles.includes('In seven months'), false, 'a document with no horizonMonths published everything, not the 6-month default');
});

test('horizonMonths: 3 drops everything past 3 months out, even though it was already on the feed', async () => {
  assert.equal((await publish(pub, shareDoc({ horizonMonths: 3 })))[0], true);
  await sleep(200);
  assert.deepEqual(await feedTitles(), ['In two months', 'This week'].sort(), 'DELETING THE HORIZON SETTING FROM THE SCREEN would leave this feed unchanged — it must not');
});

test('horizonMonths: 12 includes everything up to a year out, still excludes 13 months out', async () => {
  assert.equal((await publish(pub, shareDoc({ horizonMonths: 12 })))[0], true);
  await sleep(200);
  assert.deepEqual(await feedTitles(), ['In five months', 'In seven months', 'In two months', 'This week'].sort());
});

test('an unrecognised horizonMonths value (a hand-edited or forged document) reads as the 6-month default, not as "no limit"', async () => {
  assert.equal((await publish(pub, shareDoc({ horizonMonths: 999 })))[0], true);
  await sleep(200);
  assert.deepEqual(await feedTitles(), ['In five months', 'In two months', 'This week'].sort());
});

test('a per-event address stays reachable past the horizon — a direct link someone was given keeps working', async () => {
  assert.equal((await publish(pub, shareDoc({ horizonMonths: 3 })))[0], true);
  await sleep(200);
  assert.deepEqual(await feedTitles(), ['In two months', 'This week'].sort());
  const r = await get(`/public/${NPUB}/e/${EV_13M}.ics`);
  assert.equal(r.status, 200, 'an event beyond the horizon is unreachable even at its own direct address');
  const cal = parseIcs(await r.text());
  assert.equal(cal.events[0].SUMMARY, 'In thirteen months');
});

test('calName overrides X-WR-CALNAME, and detail: short drops LOCATION/DESCRIPTION — read from the relay, not just built by the module', async () => {
  assert.equal((await publish(pub, shareDoc({ horizonMonths: 12, calName: 'St Aidan’s — What’s On', detail: 'short' })))[0], true);
  await sleep(200);
  const text = await (await get(`/public/${NPUB}/calendar.ics`)).text();
  const flat = unfoldIcs(text);
  const cal = parseIcs(text);
  assert.equal(cal.props['X-WR-CALNAME'], 'St Aidan’s — What’s On', 're-anchor: calName is not reaching the served feed');
  assert.equal(flat.includes('LOCATION'), false, 'detail: short is not reaching the served feed — LOCATION is still there');
  assert.equal(flat.includes('DESCRIPTION'), false, 'detail: short is not reaching the served feed — DESCRIPTION is still there');
  assert.equal(flat.includes('SUMMARY:This week'), true, 'detail: short dropped the title too');
  // CONTROL: switch back to full/blank calName and see both take effect
  assert.equal((await publish(pub, shareDoc({ horizonMonths: 12, calName: '', detail: 'full' })))[0], true);
  await sleep(200);
  const text2 = await (await get(`/public/${NPUB}/calendar.ics`)).text();
  const cal2 = parseIcs(text2);
  assert.equal(cal2.props['X-WR-CALNAME'], 'Grace Church', 'an empty calName should fall back to the church name on the served feed');
  assert.equal(unfoldIcs(text2).includes('LOCATION:The hall'), true, 'detail: full should still carry LOCATION on the served feed');
});
