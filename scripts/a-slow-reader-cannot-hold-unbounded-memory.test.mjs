// A SLOW READER CANNOT MAKE THE RELAY HOLD UNBOUNDED MEMORY — AND A SLOW-BUT-HONEST ONE IS NEVER CLOSED FOR IT.
//   Run: node --test scripts/a-slow-reader-cannot-hold-unbounded-memory.test.mjs
//
// The backpressure fix (b034633e, scripts/a-slow-reader-is-paused-not-dropped.test.mjs) pauses a backlog stream for a
// slow reader instead of closing it. A paused stream keeps its unsent items alive, so it is CHARGED their JSON bytes
// (falling as they are sent), and the guards are (scripts/gateway.mjs, SEND BACKPRESSURE):
//   • PROGRESS, not wall time: a pause that drains less than a floor (bytes/s over a window) is closed 1009. Churches
//     run on small pipes, so a slow reader that IS moving is never closed for taking long.
//   • PER SOCKET: a socket over its byte budget that has drained nothing for a grace period is closed 1009. A socket
//     that is draining is never closed for how much it asked for (46b198c3 did that — a console's ~17 REQs all pause at
//     their first item, so the charge was the whole request, and a church ~2× Living Word was closed on every connect).
//   • RELAY-WIDE: when a new charge crosses the relay's budget, the socket with the LEAST RECENT drain progress is
//     evicted — never the socket that crossed it. So parked non-reading sockets cannot lock an honest console out.
//
// Two real scripts/gateway.mjs relays on their own ports and data directories, real WebSockets, a member who really
// signs in. The corpus is N x ~20 KB sermons, so ONE subscription is ~8 MB — more than this box's loopback socket
// buffers absorb (measured: ~3-4 MB), so a big REQ to a paused reader really pauses. The relay-wide charge is read from
// the admin-only /stats (backlog.heldBytes), so release is asserted by the relay's own counter, not inferred.
//   Relay A (budgets): per socket 8 MB, relay-wide 20 MB, grace 1.5 s; progress window left at the 60 s default.
//   Relay B (progress): floor 600 KB/s averaged over an episode once it is 2 s old, no-movement 20 s, heartbeat 1 s;
//   budgets out of the way. Its readers sit behind a rate-limited proxy (a real slow link, as the relay sees it).
//   Relay C (parking): relay-wide 30 MB, per socket out of the way.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createServer, connect } from 'node:net';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { D } from './trinity-doc-types.mjs';

const NET = 'trinityone';
const N = 400;                 // sermons in the corpus
const BODY = 20000;            // ~20 KB each → ~8 MB per subscription
const MB = 1024 * 1024;
const PER_SOCKET = 8 * MB, RELAY_WIDE = 20 * MB, GRACE_MS = 1500, PAUSE_MS = 20000;
const WINDOW_MS = 2000, FLOOR = 600 * 1024, HEARTBEAT_MS = 1000, PARK_WIDE = 30 * MB;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K(), ann = K();
const BIG = { kinds: [30078], authors: [church.pub] };
const COMMON = { RELAY_WS_HIGH_WATER: String(64 * 1024), RELAY_WS_LOW_WATER: String(16 * 1024), RELAY_WS_PAUSE_MS: String(PAUSE_MS) };

function relayAt(port) { return { port, http: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}/relay`, proc: null, dir: null, token: null }; }
const A = relayAt(8948), B = relayAt(8949), C = relayAt(8947);

async function waitReady(r, ms = 20000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const x = await fetch(`${r.http}/status`); if (x.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
async function backlog(r) { const x = await fetch(`${r.http}/stats?days=1`, { headers: { Authorization: 'Bearer ' + r.token } }); assert.equal(x.status, 200, '/stats'); return (await x.json()).backlog; }

// A client that records everything in arrival order and can stop reading (pause) on demand.
function client(r, url = r.ws) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url, { perMessageDeflate: false });
    const c = { ws, r, log: [], closeCode: null, challenge: null, closed: null };
    c.closed = new Promise(rs => ws.on('close', code => { c.closeCode = code; rs(code); }));
    ws.on('message', d => { const m = JSON.parse(d); if (m[0] === 'AUTH') c.challenge = m[1]; c.log.push(m); });
    ws.on('open', () => res(c)); ws.on('error', rej);
  });
}
const send = (c, m) => c.ws.send(JSON.stringify(m));
const until = async (pred, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return; await sleep(20); } throw new Error('timed out waiting for ' + what); };
const authEvent = (c) => finalizeEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [['challenge', c.challenge], ['relay', c.r.ws]], content: '' }, ann.sk);
async function signIn(c) {
  send(c, ['REQ', 'probe', { kinds: [30078], authors: [ann.pub] }]);
  await until(() => c.challenge, 5000, 'AUTH challenge');
  const a = authEvent(c);
  send(c, ['AUTH', a]);
  await until(() => c.log.some(m => m[0] === 'OK' && m[1] === a.id && m[2] === true), 5000, 'AUTH OK');
  await until(() => c.log.some(m => m[0] === 'EOSE' && m[1] === 'probe'), 5000, 'probe EOSE');
  send(c, ['CLOSE', 'probe']);
}
const eoseFor = (c, sid) => c.log.some(m => m[0] === 'EOSE' && m[1] === sid);
const eventsFor = (c, sid) => c.log.filter(m => m[0] === 'EVENT' && m[1] === sid).length;
async function pausedReader(r, prefix, subs) {
  const c = await client(r);
  await signIn(c);
  c.ws.pause();
  for (let i = 0; i < subs; i++) send(c, ['REQ', prefix + i, BIG]);
  await sleep(400);
  return c;
}
async function finish(c, prefix, subs, ms = 30000) {
  c.ws.resume();
  const ids = Array.from({ length: subs }, (_, i) => prefix + i);
  await until(() => c.closeCode !== null || ids.every(sid => eoseFor(c, sid)), ms, prefix + ': close or every EOSE');
  return ids;
}

// A SLOW LINK, for real: a TCP proxy that forwards relay→client at `rate` bytes/s (setRate changes it; 0 stops it).
// ws.pause()/resume() pacing cannot make a rate — measured here, a 250 ms pause per read still moved ~2.4 MB/s — so the
// relay's view of the link is shaped where the relay sees it: its socket stops draining exactly as a slow tunnel would.
// The proxy is the client's Host (127.0.0.1), so the NIP-42 relay binding still matches.
async function slowLink(r, rate) {
  const st = { rate, srv: null, url: '', setRate(b) { st.rate = b; } };
  st.srv = createServer(down => {
    const up = connect(r.port, '127.0.0.1');
    down.pipe(up);
    const q = []; let qb = 0, upDone = false;
    up.on('data', b => { q.push(b); qb += b.length; if (qb > 128 * 1024) up.pause(); });
    up.on('close', () => { upDone = true; }); up.on('error', () => {}); down.on('error', () => {});
    const tick = setInterval(() => {
      let budget = Math.floor(st.rate * 0.05);
      while (budget > 0 && q.length) {
        const b = q[0];
        if (b.length <= budget) { q.shift(); down.write(b); budget -= b.length; qb -= b.length; }
        else { down.write(b.subarray(0, budget)); q[0] = b.subarray(budget); qb -= budget; budget = 0; }
      }
      if (qb < 32 * 1024) up.resume();
      if (upDone && !q.length) { clearInterval(tick); down.end(); }
    }, 50);
    down.on('close', () => { clearInterval(tick); up.destroy(); });
  });
  await new Promise(rs => st.srv.listen(0, '127.0.0.1', rs));
  st.url = `ws://127.0.0.1:${st.srv.address().port}/relay`;
  return st;
}
const links = [];
async function slowReader(r, prefix, rate) {
  const link = await slowLink(r, 50 * MB); links.push(link);
  const c = await client(r, link.url);
  await signIn(c);
  link.setRate(rate);
  send(c, ['REQ', prefix + '0', BIG]);
  return { c, link };
}

async function startRelay(r, env) {
  await requireFreePort(r.port, 'a-slow-reader-cannot-hold-unbounded-memory.test.mjs');
  r.dir = mkdtempSync(join(tmpdir(), 'trin-heldbytes-'));
  r.proc = spawn(process.execPath, ['scripts/gateway.mjs', String(r.port)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: r.dir, CHURCH_NPUB: npubEncode(church.pub), TRINITY_TAILSCALE_BIN: '/nonexistent', RELAY_LOOPBACK_ONLY: '1', ...COMMON, ...env },
      stdio: 'ignore' });
  await waitReady(r);
  r.token = JSON.parse(readFileSync(join(r.dir, 'admin.json'), 'utf8')).token;
  // Seed: Ann joins; the church publishes N ~20 KB sermons. Paced under the 100 msg/s inbound limit.
  const c = await client(r);
  const pub = evt => new Promise(rs => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { c.ws.off('message', on); rs(m[2]); } }; c.ws.on('message', on); send(c, ['EVENT', evt]); });
  let t = Math.floor(Date.now() / 1000) - 100000;
  assert.equal(await pub(finalizeEvent({ kind: 30078, created_at: ++t, tags: [['d', D.MEMBER + church.pub], ['t', NET]], content: JSON.stringify({ joined: t }) }, ann.sk)), true, 'Ann joins');
  const body = 'x'.repeat(BODY);
  for (let i = 0; i < N; i++) {
    const ok = await pub(finalizeEvent({ kind: 30078, created_at: ++t, tags: [['d', D.SERMON + 's' + i], ['t', NET]], content: JSON.stringify({ id: 's' + i, title: 'Sermon ' + i, body }) }, church.sk));
    assert.equal(ok, true, 'sermon ' + i + ' stored');
    if (i % 50 === 49) await sleep(700);
  }
  c.ws.close();
}

before(async () => {
  await startRelay(A, { RELAY_WS_MAX_HELD_BYTES: String(PER_SOCKET), RELAY_WS_MAX_HELD_BYTES_ALL: String(RELAY_WIDE), RELAY_WS_HELD_GRACE_MS: String(GRACE_MS) });
  await startRelay(C, { RELAY_WS_MAX_HELD_BYTES: String(1024 * MB), RELAY_WS_MAX_HELD_BYTES_ALL: String(PARK_WIDE) });
  await startRelay(B, { RELAY_WS_PROGRESS_WINDOW_MS: String(WINDOW_MS), RELAY_WS_PROGRESS_FLOOR: String(FLOOR), RELAY_WS_HEARTBEAT_MS: String(HEARTBEAT_MS), RELAY_WS_MAX_HELD_BYTES: String(1024 * MB), RELAY_WS_MAX_HELD_BYTES_ALL: String(2048 * MB) });
});
after(async () => { for (const l of links) { try { l.srv.close(); } catch {} } for (const r of [A, B, C]) { try { r.proc && r.proc.kill('SIGKILL'); } catch {} } await sleep(200); for (const r of [A, B, C]) { try { r.dir && rmSync(r.dir, { recursive: true, force: true }); } catch {} } });

test('(i) PER SOCKET: a NON-draining socket over its budget (2 subs, 16 MB > 8 MB) is closed 1009 after the grace — not at the 20 s no-drain bound; a reader beside it is untouched', { timeout: 60000 }, async t => {
  const b = await client(A);
  await signIn(b);
  const a = await pausedReader(A, 'A', 2);
  const charged = (await backlog(A)).heldBytes;
  assert.ok(charged > PER_SOCKET, `the paused socket is not charged over its budget (${charged}) — the instrument is not measuring`);
  send(b, ['REQ', 'b1', { ...BIG, limit: 100 }]);
  await until(() => eoseFor(b, 'b1') || b.closeCode !== null, 20000, 'b1 EOSE');
  await sleep(GRACE_MS + 1500);   // far inside the 20 s no-drain bound: only the per-socket guard can have closed A
  const later = (await backlog(A)).heldBytes;
  t.diagnostic(`charged ${charged} → ${later} bytes after the grace`);
  assert.equal(later, 0, 'the over-budget non-draining socket still holds its charge after the grace');
  await finish(a, 'A', 2);
  assert.equal(a.closeCode, 1009, `the over-budget socket was not closed 1009 (code ${a.closeCode})`);
  assert.ok(!(eoseFor(a, 'A0') && eoseFor(a, 'A1')), 'the over-budget socket was served in full');
  assert.equal(b.closeCode, null, `the normal reader was closed (code ${b.closeCode})`);
  assert.equal(eventsFor(b, 'b1'), 100, 'the normal reader got all 100 events');
  b.ws.close();
});

test('(v) a FAST reader that asks for 2× its budget in one go (2 subs, 16 MB > 8 MB) gets every event and every EOSE — no 1009', { timeout: 60000 }, async t => {
  const c = await client(A);
  await signIn(c);
  c.ws.pause();   // hold the first read back a moment, so every stream is paused (and charged) at once, as on a tunnel
  for (let i = 0; i < 2; i++) send(c, ['REQ', 'F' + i, BIG]);   // one tick, as a console does
  await sleep(300); const peak = (await backlog(A)).heldBytes; c.ws.resume();
  await until(() => c.closeCode !== null || ['F0', 'F1'].every(s => eoseFor(c, s)), 40000, 'close or every EOSE');
  t.diagnostic(`fast reader: close ${c.closeCode}, events ${eventsFor(c, 'F0') + eventsFor(c, 'F1')} of ${2 * N}; peak charge ${peak}`);
  assert.equal(c.closeCode, null, `a reader that was reading was closed (code ${c.closeCode})`);
  assert.ok(peak > PER_SOCKET, `the reader was never charged over its budget (${peak}) — this proves nothing`);
  for (const s of ['F0', 'F1']) assert.equal(eventsFor(c, s), N, s + ' got every event');
  c.ws.close();
});

test('(iv) AUTH replay larger than the per-socket budget (2 x 8 MB > 8 MB) to a reader that is reading: everything replayed, then the held EOSEs — no 1009', { timeout: 60000 }, async t => {
  const c = await client(A);
  for (const sid of ['v0', 'v1']) send(c, ['REQ', sid, BIG]);   // unauthenticated: withheld, EOSE held
  await until(() => c.challenge, 5000, 'AUTH challenge');
  const a = authEvent(c);
  send(c, ['AUTH', a]);
  await until(() => c.closeCode !== null || (eoseFor(c, 'v0') && eoseFor(c, 'v1')), 40000, 'close or both EOSEs');
  t.diagnostic(`replay: close ${c.closeCode}, events v0 ${eventsFor(c, 'v0')} v1 ${eventsFor(c, 'v1')}`);
  assert.ok(c.log.some(m => m[0] === 'OK' && m[1] === a.id && m[2] === true), 'signed in');
  assert.equal(c.closeCode, null, `a replay to a reading member was refused (code ${c.closeCode})`);
  for (const s of ['v0', 'v1']) {
    assert.equal(eventsFor(c, s), N, s + ' got every withheld event');
    const lastEvt = c.log.findLastIndex(m => m[0] === 'EVENT' && m[1] === s), eose = c.log.findIndex(m => m[0] === 'EOSE' && m[1] === s);
    assert.ok(eose > lastEvt, s + ': EOSE came before the replay finished');
  }
  c.ws.close();
});

test('(iii) the charge is unsent bytes: it FALLS as a paused stream drains, CLOSE and a vanished socket return theirs, and the relay-wide counter ends at exactly 0', { timeout: 90000 }, async t => {
  // Falls as it drains: a stream behind a stopped link, let through ~1.5 MB, then stopped again.
  const { c: s, link } = await slowReader(A, 'S', 0);
  await sleep(500);
  const h0 = (await backlog(A)).heldBytes;
  link.setRate(1 * MB); await sleep(1500); link.setRate(0); await sleep(500);
  const h1 = (await backlog(A)).heldBytes;
  t.diagnostic(`paused ${h0} → after ~1.5 MB through the link ${h1}`);
  assert.ok(h0 > 2 * MB, `the paused stream is not charged (${h0})`);
  assert.ok(h1 > 0 && h1 < h0 - MB / 2, `the charge did not fall as items were sent (${h0} → ${h1})`);
  link.setRate(50 * MB);
  await until(() => eoseFor(s, 'S0') || s.closeCode !== null, 30000, 'S EOSE');
  assert.equal(s.closeCode, null); assert.equal(eventsFor(s, 'S0'), N);
  // CLOSE while paused: nothing more for it, no EOSE, the socket stays open, the charge comes back.
  const x = await pausedReader(A, 'X', 1);
  send(x, ['CLOSE', 'X0']);
  x.ws.resume(); await sleep(1500);
  assert.equal(x.closeCode, null, 'CLOSE mid-pause closed the socket');
  assert.ok(!eoseFor(x, 'X0'), 'a CLOSEd stream got an EOSE');
  assert.equal((await backlog(A)).heldBytes, 0, 'a CLOSEd stream kept its charge on an open socket');
  // A paused socket that simply goes away.
  const h = await pausedReader(A, 'H', 1);
  assert.ok((await backlog(A)).heldBytes > 4 * MB, 'the vanishing socket was never charged');
  h.ws.terminate(); await sleep(800);
  s.ws.close(); x.ws.close(); await sleep(500);
  const end = await backlog(A);
  t.diagnostic(`end: ${JSON.stringify(end)}`);
  // Exactly 0: a charge returned twice drives it negative, one never returned leaves it positive.
  assert.equal(end.heldBytes, 0, 'the relay-wide charge did not return to exactly 0');
  assert.equal(end.heldSockets, 0, 'a socket is still listed as holding a charge');
});

test('(vi) PARKING: two non-reading sockets park ~24 MB; an honest console that pauses briefly at connect pushes past 30 MB — the parker with the LEAST RECENT progress is evicted, the console is served', { timeout: 90000 }, async t => {
  // Two subs each: the first fills the loopback buffers (its unsent tail varies run to run, ~3.5-5.5 MB), the second
  // pauses at its first item and is charged all ~8 MB — so each socket holds ~11.5-13.5 MB, two hold ≤ 30 MB, and a
  // third pushes past 30 MB by less than one parker: exactly one eviction is needed.
  const p1 = await pausedReader(C, 'P', 2); await sleep(500);
  const p2 = await pausedReader(C, 'Q', 2); await sleep(500);
  const parked = (await backlog(C)).heldBytes;
  assert.ok(parked > 20 * MB && parked <= PARK_WIDE, `the parkers do not hold ~24 MB (${parked})`);
  const L = await pausedReader(C, 'L', 2);   // pauses at connect, briefly (400 ms), as on a tunnel
  await finish(L, 'L', 2);
  t.diagnostic(`console: close ${L.closeCode}, ${eventsFor(L, 'L0') + eventsFor(L, 'L1')} of ${2 * N}; parked ${parked}`);
  assert.equal(L.closeCode, null, `the honest console was closed (code ${L.closeCode}) — the newcomer was refused instead of a parker`);
  assert.equal(eventsFor(L, 'L0') + eventsFor(L, 'L1'), 2 * N, 'the console got every event');
  for (const c of [p1, p2]) c.ws.resume();
  await until(() => [[p1, 'P'], [p2, 'Q']].every(([c, p]) => c.closeCode !== null || (eoseFor(c, p + '0') && eoseFor(c, p + '1'))), 30000, 'parkers end');
  t.diagnostic(`parkers: P ${p1.closeCode}, Q ${p2.closeCode}`);
  assert.equal(p1.closeCode, 1009, `the least-recent-progress parker was not the one evicted (code ${p1.closeCode})`);
  assert.equal(p2.closeCode, null, `the more recent parker was evicted (code ${p2.closeCode})`);
  for (const c of [L, p2]) c.ws.close();
  await sleep(500);
  assert.equal((await backlog(C)).heldBytes, 0, 'the relay-wide charge did not return to 0 after eviction');
});

test('(ii) PROGRESS floor: a reader on a link below the floor (150 KB/s < 600 KB/s) is closed 1009 by the floor, before the 20 s no-movement bound', { timeout: 60000 }, async t => {
  const { c, link } = await slowReader(B, 'T', 150 * 1024);
  const t0 = Date.now();
  await sleep(1000);
  assert.ok((await backlog(B)).heldBytes > 2 * MB, 'the trickler never paused — this proves nothing');
  let closedAt = 0;
  for (let k = 0; k < 60 && !closedAt; k++) { if ((await backlog(B)).heldBytes === 0) closedAt = Date.now(); else await sleep(250); }
  const got = eventsFor(c, 'T0');
  link.setRate(50 * MB);   // let what is in flight through, so the client sees how it ended
  await Promise.race([c.closed, sleep(10000)]);
  t.diagnostic(`trickler: charge released after ~${closedAt ? closedAt - t0 : '-'} ms with ${got} of ${N} events read; close ${c.closeCode}`);
  assert.ok(closedAt, 'the trickler still holds its charge after 15 s — it was not closed');
  assert.ok(closedAt - t0 < 16000, 'closed only at the no-movement bound, not by the floor');
  assert.equal(c.closeCode, 1009, `the trickling reader was not closed 1009 (code ${c.closeCode})`);
  assert.ok(!eoseFor(c, 'T0'), 'the trickler was served everything');
});

test('(ii-b) a SLOW-BUT-HONEST reader (800 KB/s, above the floor) whose backlog takes ~10 s — twice the old wall-clock bound at this scale, ten heartbeats, the relay seeing no drain for seconds at a time — gets everything + EOSE, not closed', { timeout: 120000 }, async t => {
  const { c } = await slowReader(B, 'W', 800 * 1024);
  const t0 = Date.now();
  await until(() => c.closeCode !== null || eoseFor(c, 'W0'), 100000, 'close or EOSE');
  const secs = (Date.now() - t0) / 1000;
  t.diagnostic(`honest slow reader: close ${c.closeCode}, ${eventsFor(c, 'W0')} of ${N} in ${secs.toFixed(1)} s (floor ${FLOOR / 1024} KB/s)`);
  assert.equal(c.closeCode, null, `a slow reader that was moving was closed (code ${c.closeCode})`);
  assert.equal(eventsFor(c, 'W0'), N, 'it got every event');
  assert.ok(secs > 7, `the backlog drained in ${secs.toFixed(1)} s — not slow enough to prove anything against a wall-clock bound`);
  c.ws.close();
});
