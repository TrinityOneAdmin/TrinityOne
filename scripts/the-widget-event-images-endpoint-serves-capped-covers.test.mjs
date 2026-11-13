// /public/<npub>/event-images.json SERVES THE WIDGET'S PER-EVENT COVER IMAGES — GATED LIKE THE CALENDAR FEED.
//   Run: node --test scripts/the-widget-event-images-endpoint-serves-capped-covers.test.mjs
//
// calendar-pilot-2026-11-05 item 3b. The .ics feed stays image-free (a data: URI must never bloat a
// subscription), so the embeddable widget reads the cover photo + focal point from THIS endpoint instead
// (gateway.mjs EVENT_IMAGES_ROUTE, built from the PUBEVENTS map). This is the point of use (CLAUDE.md rule 1):
// a real scripts/gateway.mjs, real WebSockets, a real HTTP fetch — delete the route or its "calendar must be on"
// gate and this file fails, even though public-calendar.mjs's own publicEventFields tests stay green.
//
// The gate is EXACTLY the calendar feed's: the church exists, the calendar switch is on, and an opted-out event
// is absent (it exposes no image either). The image is size-capped by publicEventFields on ingest; this file
// proves an over-cap image is served as NO image, not a sliced corrupt one.
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
import { PUB_IMG_MAX } from './public-calendar.mjs';   // the defensive cap the endpoint re-checks

const PORT = 19920;   // was 19918, which the-embed-page-is-framable-cross-origin also claims (moved 2026-11-13). A HIGH port (19900-19999), unique across the suite, so a concurrent run cannot collide
const HTTP = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const SHARE_D = D.SHARE, PUBEVENT_D = D.PUBEVENT;
const now = () => Math.floor(Date.now() / 1000);
let _tick = now();
const next = () => (_tick = Math.max(_tick + 1, now()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const grace = K();
const ap = grace.pub, NPUB = npubEncode(ap), NPUB_UNKNOWN = npubEncode(K().pub);
const dataUri = (n) => 'data:image/jpeg;base64,' + 'A'.repeat(n);

// A picture event, a plain (no-image) event, an over-cap event, and one with a picture but opted out.
const EV_PIC = 'evtpic', EV_PLAIN = 'evtplain', EV_BIG = 'evtbig', EV_OPTED = 'evtopted';
const SMALL = dataUri(300), BIG = dataUri(PUB_IMG_MAX + 500);
const COPY = {
  [EV_PIC]:   { title: 'Harvest supper', date: '2026-10-03', time: '19:30', where: 'Hall', blurb: '', image: SMALL, imgPos: { x: 20, y: 80 }, imgZoom: 2 },
  [EV_PLAIN]: { title: 'PCC meeting',     date: '2026-10-05', time: '19:30', where: 'Vestry', blurb: '' },
  [EV_BIG]:   { title: 'Big poster',      date: '2026-10-07', time: '18:00', where: 'Green', blurb: '', image: BIG, imgPos: { x: 10, y: 10 }, imgZoom: 3 },
  [EV_OPTED]: { title: 'Private review',  date: '2026-10-09', time: '10:00', where: 'Office', blurb: '', image: SMALL, imgPos: { x: 40, y: 60 }, imgZoom: 2 },
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
const publish = (ws, evt) => new Promise((res) => { const on = (d) => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content) => finalizeEvent({ kind: 30078, created_at: next(), tags: [['d', d], ['t', NET]], content: JSON.stringify(content) }, who.sk);
const shareDoc = (body) => doc(grace, SHARE_D + ap, body);
const copyDoc = (id, body) => doc(grace, PUBEVENT_D + id, body);
const get = (path) => fetch(HTTP + path, { redirect: 'manual' });

before(async () => {
  await requireFreePort(PORT, 'the-widget-event-images-endpoint-serves-capped-covers.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-evimg-'));
  await startRelay();
  pub = await connect();
  for (const id of Object.keys(COPY)) assert.equal((await publish(pub, copyDoc(id, COPY[id])))[0], true, 'copy ' + id);
  await sleep(150);
});
after(async () => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('CONTROL: with the calendar switch off (or absent), event-images.json is a 404', async () => {
  assert.equal((await get(`/public/${NPUB}/event-images.json`)).status, 404, 'a church that never switched the calendar on serves event images');
  assert.equal((await get(`/public/${NPUB_UNKNOWN}/event-images.json`)).status, 404, 'a church this relay does not hold serves event images');
  assert.equal((await get(`/public/${ap}/event-images.json`)).status, 404, 'a hex pubkey is not an address; only the npub form is');
});

test('with the calendar on, event-images.json carries the capped cover + focal point, and only for events that have one', async () => {
  assert.equal((await publish(pub, shareDoc({ calendar: true, optOut: [EV_OPTED], address: 'own' })))[0], true, 'the switch');
  await sleep(200);
  const r = await get(`/public/${NPUB}/event-images.json`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(r.headers.get('cache-control'), 'public, max-age=300', 'the images map is not cached like the .ics');
  assert.match(r.headers.get('content-security-policy') || '', /default-src 'none'/, 'no strict CSP on the served map');
  assert.equal(r.headers.get('set-cookie'), null, 'a cookie was set on a public map');
  assert.equal(r.headers.get('access-control-allow-origin'), '*', 'the map cannot be read cross-origin by the embedding site');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const map = JSON.parse(await r.text());

  // EV_PIC: present, with the SMALL (capped) image byte-for-byte and the steward's focal point + zoom.
  assert.ok(map[EV_PIC], 'the event with a cover image is missing from the map');
  assert.equal(map[EV_PIC].image, SMALL, 'the map did not carry the capped cover image');
  assert.deepEqual(map[EV_PIC].imgPos, { x: 20, y: 80 }, 'the focal point did not reach the map');
  assert.equal(map[EV_PIC].imgZoom, 2, 'the zoom did not reach the map');

  // EV_PLAIN: no image -> absent. EV_OPTED: opted out -> absent (exposes no image either). EV_BIG: over the cap
  // -> the image was stripped on ingest, so it is absent (never a sliced, corrupt data: URI).
  assert.equal(EV_PLAIN in map, false, 'an event with no image appears in the map');
  assert.equal(EV_OPTED in map, false, 'AN OPTED-OUT EVENT EXPOSED ITS IMAGE — the opt-out does not cover the images map');
  assert.equal(EV_BIG in map, false, 'AN OVER-CAP IMAGE WAS SERVED — the size cap is defeated');
  assert.deepEqual(Object.keys(map).sort(), [EV_PIC].sort(), 'the map holds something other than exactly the one eligible event');
});

test('no data: URI the map serves ever exceeds the cap', async () => {
  const map = JSON.parse(await (await get(`/public/${NPUB}/event-images.json`)).text());
  for (const k of Object.keys(map)) {
    assert.ok(typeof map[k].image === 'string' && /^data:image\//.test(map[k].image), k + ' carried a non-data image');
    assert.ok(map[k].image.length <= PUB_IMG_MAX, k + ' carried an over-cap image: ' + map[k].image.length);
  }
});

test('HEAD is a 200 with no body; POST is a 405, same as the calendar route', async () => {
  const head = await fetch(`${HTTP}/public/${NPUB}/event-images.json`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal((await head.text()), '', 'HEAD returned a body');
  const post = await fetch(`${HTTP}/public/${NPUB}/event-images.json`, { method: 'POST', body: 'x' });
  assert.equal(post.status, 405, 'a POST to the images map was not refused');
});

test('switching the calendar off takes the images map down at once', async () => {
  assert.equal((await publish(pub, shareDoc({ calendar: false, optOut: [], address: 'own' })))[0], true);
  await sleep(200);
  assert.equal((await get(`/public/${NPUB}/event-images.json`)).status, 404, 'THE SWITCH IS OFF AND THE IMAGES MAP IS STILL SERVED');
});
