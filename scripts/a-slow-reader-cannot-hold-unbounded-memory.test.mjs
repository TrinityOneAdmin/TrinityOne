// A SLOW READER CANNOT MAKE THE RELAY HOLD UNBOUNDED MEMORY — IN BYTES, ACROSS THE RELAY, OR BY TRICKLING.
//   Run: node --test scripts/a-slow-reader-cannot-hold-unbounded-memory.test.mjs
//
// Audit 2026-11-11 F1 on the backpressure fix (b034633e, scripts/a-slow-reader-is-paused-not-dropped.test.mjs): a
// paused stream keeps its whole matched array alive, and the only bound was an EVENT count — but one event can be
// ~1 MB, there is no per-IP cap, and the 30 s stall timer re-arms whenever a reader drains a little, so a trickling
// reader was never closed. Now: a per-socket byte budget, a relay-wide byte budget, and a total-stall bound per stream,
// each closing 1009 'too slow' — and never touching any other socket. Plus the AUTH replay checks the byte budget while
// it is being collected, before anything is sent.
//
// A real scripts/gateway.mjs on its own port and data directory, real WebSockets, a member who really signs in. The
// corpus is the other file's: N x ~20 KB sermons, so ONE subscription holds ~8 MB — more than this box's loopback
// socket buffers absorb (measured: ~3-4 MB), so every big REQ to a paused reader really pauses. Budgets are scaled
// down by env so they are crossed by a known number of paused subscriptions:
//   per socket 12 MB  → one paused sub fits (8), two do not (16)
//   relay-wide 20 MB  → two paused subs on two sockets fit (16), a third does not (24)
//   total stall 5 s   (the per-pause stall bound is raised to 20 s, so only the TOTAL bound can close a trickler)
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

const PORT = 8948;
const HTTP = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const N = 400;                 // sermons in the corpus
const BODY = 20000;            // ~20 KB each → ~8 MB per subscription
const MB = 1024 * 1024;
const PER_SOCKET = 12 * MB, RELAY_WIDE = 20 * MB, STALL_TOTAL_MS = 5000, PAUSE_MS = 20000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K(), ann = K();
let relay, dataDir;
async function waitReady(ms = 20000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`${HTTP}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }

// A client that records everything in arrival order and can stop reading (pause) on demand.
function client() {
  return new Promise((res, rej) => {
    const ws = new WebSocket(WS_URL, { perMessageDeflate: false });
    const c = { ws, log: [], closeCode: null, challenge: null, closed: null };
    c.closed = new Promise(r => ws.on('close', code => { c.closeCode = code; r(code); }));
    ws.on('message', d => { const m = JSON.parse(d); if (m[0] === 'AUTH') c.challenge = m[1]; c.log.push(m); });
    ws.on('open', () => res(c)); ws.on('error', rej);
  });
}
const send = (c, m) => c.ws.send(JSON.stringify(m));
// Resolves once the socket has delivered nothing for `ms` (or closed): everything the relay was going to send has arrived.
const quiet = async (c, ms, max = 40000) => { const t0 = Date.now(); let n = -1, since = Date.now(); while (Date.now() - t0 < max) { if (c.log.length !== n) { n = c.log.length; since = Date.now(); } else if (Date.now() - since >= ms || c.closeCode !== null) return; await sleep(50); } throw new Error('socket never went quiet'); };
const until = async (pred, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return; await sleep(20); } throw new Error('timed out waiting for ' + what); };
const authEvent = ch => finalizeEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [['challenge', ch], ['relay', WS_URL]], content: '' }, ann.sk);
const BIG = { kinds: [30078], authors: [church.pub] };

// Sign in as Ann (a member): a gated probe REQ earns the challenge; answer it; wait for OK and the probe's EOSE.
async function signIn(c) {
  send(c, ['REQ', 'probe', { kinds: [30078], authors: [ann.pub] }]);
  await until(() => c.challenge, 5000, 'AUTH challenge');
  const a = authEvent(c.challenge);
  send(c, ['AUTH', a]);
  await until(() => c.log.some(m => m[0] === 'OK' && m[1] === a.id && m[2] === true), 5000, 'AUTH OK');
  await until(() => c.log.some(m => m[0] === 'EOSE' && m[1] === 'probe'), 5000, 'probe EOSE');
  send(c, ['CLOSE', 'probe']);
}

const eoseFor = (c, sid) => c.log.some(m => m[0] === 'EOSE' && m[1] === sid);
const eventsFor = (c, sid) => c.log.filter(m => m[0] === 'EVENT' && m[1] === sid).length;
// A signed-in reader that has stopped reading and asked for `subs` big subscriptions. It is given time to pause.
async function pausedReader(prefix, subs) {
  const c = await client();
  await signIn(c);
  c.ws.pause();
  for (let i = 0; i < subs; i++) send(c, ['REQ', prefix + i, BIG]);
  await sleep(400);
  return c;
}
// Resume, then: was it closed (and with what), or did it get every subscription in full?
async function finish(c, prefix, subs) {
  c.ws.resume();
  const ids = Array.from({ length: subs }, (_, i) => prefix + i);
  await until(() => c.closeCode !== null || ids.every(sid => eoseFor(c, sid)), 30000, prefix + ': close or every EOSE');
  if (c.closeCode === null) await quiet(c, 300);
  return ids;
}

before(async () => {
  await requireFreePort(PORT, 'a-slow-reader-cannot-hold-unbounded-memory.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-heldbytes-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub), TRINITY_TAILSCALE_BIN: '/nonexistent', RELAY_LOOPBACK_ONLY: '1',
        RELAY_WS_HIGH_WATER: String(64 * 1024), RELAY_WS_LOW_WATER: String(16 * 1024), RELAY_WS_PAUSE_MS: String(PAUSE_MS),
        RELAY_WS_MAX_HELD_BYTES: String(PER_SOCKET), RELAY_WS_MAX_HELD_BYTES_ALL: String(RELAY_WIDE), RELAY_WS_STALL_TOTAL_MS: String(STALL_TOTAL_MS) },
      stdio: 'ignore' });
  await waitReady();
  // Seed: Ann joins; the church publishes N ~20 KB sermons. Paced under the 100 msg/s inbound limit.
  const c = await client();
  const pub = evt => new Promise(r => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { c.ws.off('message', on); r(m[2]); } }; c.ws.on('message', on); send(c, ['EVENT', evt]); });
  let t = Math.floor(Date.now() / 1000) - 100000;
  assert.equal(await pub(finalizeEvent({ kind: 30078, created_at: ++t, tags: [['d', D.MEMBER + church.pub], ['t', NET]], content: JSON.stringify({ joined: t }) }, ann.sk)), true, 'Ann joins');
  const body = 'x'.repeat(BODY);
  for (let i = 0; i < N; i++) {
    const ok = await pub(finalizeEvent({ kind: 30078, created_at: ++t, tags: [['d', D.SERMON + 's' + i], ['t', NET]], content: JSON.stringify({ id: 's' + i, title: 'Sermon ' + i, body }) }, church.sk));
    assert.equal(ok, true, 'sermon ' + i + ' stored');
    if (i % 50 === 49) await sleep(700);
  }
  c.ws.close();
});
after(async () => { try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('(i) PER-SOCKET bytes: a paused socket holding two subscriptions (16 MB > 12 MB) is closed 1009; a normal reader beside it is untouched', { timeout: 60000 }, async t => {
  const b = await client();
  await signIn(b);
  const a = await pausedReader('A', 2);
  send(b, ['REQ', 'b1', { ...BIG, limit: 100 }]);   // a normal reader, reading, on the same relay while A is over budget
  await until(() => eoseFor(b, 'b1') || b.closeCode !== null, 20000, 'b1 EOSE');
  await finish(a, 'A', 2);
  t.diagnostic(`A: close ${a.closeCode}, events ${eventsFor(a, 'A0') + eventsFor(a, 'A1')} of ${2 * N}`);
  assert.equal(a.closeCode, 1009, `the over-budget socket was not closed 1009 (code ${a.closeCode})`);
  assert.ok(!(eoseFor(a, 'A0') && eoseFor(a, 'A1')), 'the over-budget socket was served in full');
  assert.equal(b.closeCode, null, `the normal reader was closed (code ${b.closeCode})`);
  assert.equal(eventsFor(b, 'b1'), 100, 'the normal reader got all 100 events');
  send(b, ['REQ', 'b2', { ...BIG, limit: 5 }]);
  await until(() => eoseFor(b, 'b2') || b.closeCode !== null, 10000, 'b2 EOSE');
  assert.equal(eventsFor(b, 'b2'), 5, 'the normal reader is still being served');
  b.ws.close();
});

test('(iii) RELAY-WIDE bytes: two paused sockets (16 MB) fit, a third (24 MB > 20 MB) is closed and the first two are not; every charge is returned exactly once', { timeout: 90000 }, async t => {
  const c = await pausedReader('C', 1), d = await pausedReader('D', 1), e = await pausedReader('E', 1);
  await finish(e, 'E', 1);
  assert.equal(e.closeCode, 1009, `the socket that crossed the relay-wide budget was not closed 1009 (code ${e.closeCode})`);
  await finish(c, 'C', 1); await finish(d, 'D', 1);
  for (const [x, p] of [[c, 'C'], [d, 'D']]) { assert.equal(x.closeCode, null, `${p} (already paused, within budget) was closed (code ${x.closeCode})`); assert.equal(eventsFor(x, p + '0'), N, `${p} got every event`); x.ws.close(); }
  // A paused socket that simply goes away must return its charge too.
  const h = await pausedReader('H', 1); h.ws.terminate(); await sleep(500);
  // If C, D or H had kept its charge (8 MB each), two more paused subscriptions would not fit.
  const f = await pausedReader('F', 1), g = await pausedReader('G', 1);
  await finish(f, 'F', 1); await finish(g, 'G', 1);
  t.diagnostic(`after release: F close ${f.closeCode} events ${eventsFor(f, 'F0')}, G close ${g.closeCode} events ${eventsFor(g, 'G0')}`);
  for (const [x, p] of [[f, 'F'], [g, 'G']]) { assert.equal(x.closeCode, null, `${p} closed — a finished or vanished stream kept its charge (code ${x.closeCode})`); assert.equal(eventsFor(x, p + '0'), N, `${p} got every event`); x.ws.close(); }
  // …and returned it only ONCE: a double release would leave the total short, and a third paused socket would fit.
  const p = await pausedReader('P', 1), q = await pausedReader('Q', 1), r = await pausedReader('R', 1);
  await finish(r, 'R', 1);
  assert.equal(r.closeCode, 1009, `the relay-wide budget no longer bites (code ${r.closeCode}) — a charge was returned twice`);
  await finish(p, 'P', 1); await finish(q, 'Q', 1);
  assert.equal(p.closeCode, null); assert.equal(q.closeCode, null);
  p.ws.close(); q.ws.close();
});

test('(ii) TOTAL stall: a reader that trickles (drains a little, often) is closed 1009 once its stream has been paused past the total bound', { timeout: 60000 }, async t => {
  const c = await pausedReader('T', 1);
  const t0 = Date.now();
  let trickling = true;
  c.ws.on('message', () => { if (!trickling) return; c.ws.pause(); setTimeout(() => { if (trickling) c.ws.resume(); }, 1000); });   // ~one socket read (≤64 KB) a second
  c.ws.resume();
  await Promise.race([c.closed, sleep(STALL_TOTAL_MS + 12000)]);
  trickling = false; c.ws.resume();
  await Promise.race([c.closed, sleep(5000)]);
  const got = eventsFor(c, 'T0');
  t.diagnostic(`trickler: close ${c.closeCode} after ~${Date.now() - t0} ms, ${got} of ${N} events`);
  assert.ok(got > 0, 'the trickler received nothing — this would be a stall, not a trickle');
  assert.equal(c.closeCode, 1009, `the trickling reader was not closed 1009 (code ${c.closeCode})`);
  assert.ok(!eoseFor(c, 'T0'), 'the trickler was served everything');
});

test('(iv) AUTH replay: a replay larger than the per-socket budget is refused while it is collected — closed 1009, nothing replayed', { timeout: 60000 }, async () => {
  const c = await client();
  for (const sid of ['v0', 'v1']) send(c, ['REQ', sid, BIG]);   // unauthenticated: withheld; 2 x 8 MB to replay > 12 MB
  await until(() => c.challenge, 5000, 'AUTH challenge');
  const a = authEvent(c.challenge);
  send(c, ['AUTH', a]);                                          // reading normally throughout
  await Promise.race([c.closed, sleep(15000)]);
  assert.ok(c.log.some(m => m[0] === 'OK' && m[1] === a.id && m[2] === true), 'signed in');
  assert.equal(c.closeCode, 1009, `an over-budget replay was not refused (code ${c.closeCode})`);
  assert.equal(c.log.filter(m => m[0] === 'EVENT').length, 0, 'replayed events were sent before the budget was checked');
});
