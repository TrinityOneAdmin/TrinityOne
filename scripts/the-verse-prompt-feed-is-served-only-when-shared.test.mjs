// THE CHURCH'S VERSE PROMPT IS ON THE PUBLIC FEED ONLY WHILE ITS OWNER HAS SWITCHED IT ON — AND NEVER ITS NOTE.
//   Run: node --test scripts/the-verse-prompt-feed-is-served-only-when-shared.test.mjs
//
// reference/PLAN-phone-widget-2026-11-16.html §4b. Members' home-screen widgets fetch
// /public/<npub>/verse-prompt.json in the background with no key. This drives a REAL scripts/gateway.mjs (same
// shape as scripts/the-widget-script-is-served-only-when-the-calendar-is-shared.test.mjs): signed documents over
// the websocket, the feed read over HTTP. Deleting the route, its switch check, the owner-only write rule or the
// note filter from gateway.mjs turns this red.
//
// The last test is the INGEST row memory ingest-rules-cannot-consult-hydrated-maps asks for: a FRESH relay whose
// store already holds the documents (planted on disk with no accept() pass, as /import writes them), started from
// nothing — so the rule that fills the map is exercised on replay, before any roster could have been read.
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
import { openStore } from './event-store.mjs';
import { D } from './trinity-doc-types.mjs';

const PORT = 19961;   // a HIGH port (19900-19999), unique across scripts/
const HTTP = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
let _tick = now();
const next = () => (_tick = Math.max(_tick + 1, now()));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const grace = K(), stmarks = K(), member = K();
const ap = grace.pub, bp = stmarks.pub, NPUB = npubEncode(ap), NPUB_B = npubEncode(bp);
const FEED = (npub) => `/public/${npub}/verse-prompt.json`;

let relay, dataDir, ws;
async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`${HTTP}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
function startRelay(dir) {
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dir, CHURCH_NPUB: NPUB + ',' + NPUB_B, RELAY_MAX_EVENTS: '5000', TRINITY_TAILSCALE_BIN: '/nonexistent' },
      stdio: 'ignore' });
  return waitReady();
}
async function stopRelay() { try { ws && ws.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} await sleep(300); }
const connect = () => new Promise((res, rej) => { const w = new WebSocket(WS_URL); w.on('open', () => res(w)); w.on('error', rej); });
const publish = (w, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { w.off('message', on); res([m[2], m[3] || '']); } }; w.on('message', on); w.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, body, extra = []) => finalizeEvent({ kind: 30078, created_at: next(), tags: [['d', d], ['t', NET], ...extra], content: body == null ? '' : JSON.stringify(body) }, who.sk);
const share = (who, cp, body) => doc(who, D.SHARE + cp, body);
const copy = (who, cp, body) => doc(who, D.PUBVERSE + cp, body);
const tomb = (who, cp) => doc(who, D.PUBVERSE + cp, null, [['deleted', '1']]);
const get = (p, init) => fetch(HTTP + p, init);

const PROMPT = { ref: 'John 3:16; Romans 8:28', note: 'SECRET NOTE — see you at the vicarage', schedule: [{ at: 1900000000, ref: 'Psalms 23:1', note: 'ALSO SECRET' }] };

before(async () => {
  await requireFreePort(PORT, 'the-verse-prompt-feed-is-served-only-when-shared.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-versefeed-'));
  await startRelay(dataDir);
  ws = await connect();
});
after(async () => { await stopRelay(); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('CONTROL: no switch and no copy, a copy with the switch off, or an unknown church — all the same 404', async () => {
  assert.equal((await get(FEED(NPUB))).status, 404, 'a church that never shared has a verse-prompt feed');
  assert.equal((await publish(ws, copy(grace, ap, PROMPT)))[0], true, 're-anchor: the church could not write its own public copy');
  await sleep(200);
  assert.equal((await get(FEED(NPUB))).status, 404, 'THE SWITCH IS IGNORED: a copy is served although the owner never switched verse prompts on');
  assert.equal((await publish(ws, share(grace, ap, { calendar: true, optOut: [], address: 'own' })))[0], true);
  await sleep(200);
  assert.equal((await get(FEED(NPUB))).status, 404, 'the CALENDAR switch put the verse prompt on the public feed');
  assert.equal((await get(FEED(npubEncode(K().pub)))).status, 404);
  assert.equal((await get(`/public/${ap}/verse-prompt.json`)).status, 404, 'a hex key is not an address');
});

test('switched on: refs and times are served — and the NOTE is not, even though the copy carried one', async () => {
  assert.equal((await publish(ws, share(grace, ap, { calendar: true, versePrompt: true, optOut: [], address: 'own' })))[0], true);
  await sleep(200);
  const r = await get(FEED(NPUB));
  assert.equal(r.status, 200, 'the verse-prompt switch did not put the copy on the feed');
  assert.equal(r.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.equal(r.headers.get('set-cookie'), null);
  const raw = await r.text();
  assert.equal(/SECRET|vicarage|note/i.test(raw), false, 'THE STEWARD\'S NOTE IS ON THE PUBLIC INTERNET: ' + raw);
  const j = JSON.parse(raw);
  assert.equal(j.ref, 'John 3:16; Romans 8:28');
  assert.deepEqual(j.schedule, [{ at: 1900000000, ref: 'Psalms 23:1' }]);
  assert.ok(Number(j.ts) > 0, 'no ts — a widget cannot tell a newer copy from an older one');
  assert.equal(/Grace|church"/i.test(raw), false, 'the feed names the church');
  assert.equal((await get(FEED(NPUB), { method: 'HEAD' })).status, 200);
  assert.equal((await get(FEED(NPUB), { method: 'POST', body: 'x' })).status, 405);
});

test('a tombstoned copy, or the switch turned off, takes it down at once', async () => {
  assert.equal((await publish(ws, tomb(grace, ap)))[0], true);
  await sleep(200);
  assert.equal((await get(FEED(NPUB))).status, 404, 'a cleared prompt is still on the public feed');
  assert.equal((await publish(ws, copy(grace, ap, { ref: 'Psalms 46:1' })))[0], true);
  await sleep(200);
  assert.equal((await get(FEED(NPUB))).status, 200, 're-anchor: a fresh copy after the tombstone was not served');
  assert.equal((await publish(ws, share(grace, ap, { calendar: true, versePrompt: false, optOut: [], address: 'own' })))[0], true);
  await sleep(200);
  assert.equal((await get(FEED(NPUB))).status, 404, 'turning the switch off left the verse prompt public');
});

test('only the church\'s own key, naming itself, writes the public copy', async () => {
  assert.equal((await publish(ws, share(grace, ap, { versePrompt: true, optOut: [], address: 'own' })))[0], true);
  // a stranger writing "Grace's" copy under their own key
  const [ok1] = await publish(ws, copy(member, ap, { ref: 'FORGED 1:1' }));
  assert.equal(ok1, false, 'a non-church key was allowed to write pubverse:<church>');
  // another church writing Grace's d-tag
  const [ok2] = await publish(ws, copy(stmarks, ap, { ref: 'FORGED 2:2' }));
  assert.equal(ok2, false, 'one church was allowed to write another church\'s public verse prompt');
  await sleep(200);
  const raw = await (await get(FEED(NPUB))).text();
  assert.equal(raw.includes('FORGED'), false, 'a forged copy reached the public feed: ' + raw);
  assert.equal((await get(FEED(NPUB_B))).status, 404, 'St Mark\'s has a feed it never switched on');
});

test('a same-second tie between two copies serves the LOWEST event id, whichever arrived last (audit F10)', async () => {
  assert.equal((await publish(ws, share(grace, ap, { versePrompt: true, optOut: [], address: 'own' })))[0], true);
  const at = next();
  const mk = (ref) => finalizeEvent({ kind: 30078, created_at: at, tags: [['d', D.PUBVERSE + ap], ['t', NET]], content: JSON.stringify({ ref }) }, grace.sk);
  const [x, y] = [mk('Tie 1:1'), mk('Tie 2:2')].sort((p, q) => (p.id < q.id ? -1 : 1));   // x has the lower id
  await publish(ws, x);
  await publish(ws, y);   // later arrival, higher id — the store keeps x
  await sleep(200);
  const j = JSON.parse(await (await get(FEED(NPUB))).text());
  assert.equal(j.ref, JSON.parse(x.content).ref, 'the feed serves the later-arriving copy of a same-second tie, not the one the store keeps');
});

test('INGEST: a fresh relay replaying a store that already holds the documents serves the copy (no roster needed)', async () => {
  await stopRelay();
  const fresh = mkdtempSync(join(tmpdir(), 'trin-versefeed-fresh-'));
  try {
    // Start once so the store exists, stop, plant with no accept() pass (as /import writes), start again.
    await startRelay(fresh); await stopRelay();
    const st = openStore(join(fresh, 'relay.sqlite'));
    try {
      assert.equal(st.put(share(grace, ap, { versePrompt: true, optOut: [], address: 'own' }), ap), 'stored');
      assert.equal(st.put(copy(grace, ap, { ref: 'Isaiah 41:10', note: 'PLANTED NOTE' }), ap), 'stored');
      // and a forgery planted beside it, which accept() never saw — the ingest rule alone must refuse it
      assert.equal(st.put(copy(member, ap, { ref: 'FORGED 3:3' }), ap), 'stored');
      // and ANOTHER CHURCH's key writing Grace's d-tag, newer than Grace's own — only the self-naming rule refuses it
      assert.equal(st.put(copy(stmarks, ap, { ref: 'FORGED 4:4' }), ap), 'stored');
    } finally { st.close(); }
    await startRelay(fresh);
    const r = await get(FEED(NPUB));
    assert.equal(r.status, 200, 'after a replay from disk the shared verse prompt is not served — the ingest rule depends on something not yet loaded');
    const raw = await r.text();
    assert.equal(JSON.parse(raw).ref, 'Isaiah 41:10');
    assert.equal(/FORGED|PLANTED|note/i.test(raw), false, 'the replayed feed carries a forgery or a note: ' + raw);
  } finally {
    await stopRelay();
    try { rmSync(fresh, { recursive: true, force: true }); } catch {}
    await startRelay(dataDir); ws = await connect();
  }
});
