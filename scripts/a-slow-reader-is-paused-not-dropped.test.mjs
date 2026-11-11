// A SLOW READER IS PAUSED, NOT DROPPED — AND A READER WHO NEVER READS IS STILL CLOSED.
//   Run: node --test scripts/a-slow-reader-is-paused-not-dropped.test.mjs
//
// Measured live 2026-11-11: a steward console opens ~12 overlapping subscriptions that each return the church's
// whole corpus, ~17 MB is queued at once, a tunnel cannot drain it, and the relay used to close the socket with
// 1009 'too slow' the moment ws.bufferedAmount passed 16 MB — then the console reconnected and asked again, every
// ~16 s, for ever. The relay now PAUSES a backlog stream past a high-water mark and resumes below a low-water mark;
// audit II's bound (e63cc348) is kept: a reader that never drains is still closed 1009.
//
// A real scripts/gateway.mjs on its own port and data directory, real WebSockets, a real signed corpus, a member who
// really signs in (NIP-42). The client is made slow by pausing its own socket (ws.pause()): it stops reading, the
// kernel buffers fill, and the relay's bufferedAmount climbs — exactly what a tunnel does. Thresholds are lowered by
// env so the test is fast; the HARD CAP is left at its production 16 MB, so the old close-at-16MB code fails here.
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

const PORT = 8951;
const HTTP = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const N = 400;                 // sermons in the corpus
const BODY = 20000;            // ~20 KB each → ~8 MB per REQ
const SUBS = 6;                // 6 overlapping REQs → ~48 MB asked for at once, far past the 16 MB hard cap
const PAUSE_MS = 4000;         // stall bound for this test (production: 30 s)
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
// What can be in flight when the relay stops a stream: the kernel's socket buffers on both ends plus one high-water
// mark. Measured on loopback here it is a few MB; a whole subscription (N events, ~8 MB) is a generous ceiling that a
// stream which was NOT stopped (N x SUBS events) still overshoots six-fold.
const IN_FLIGHT = N;
const until = async (pred, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return; await sleep(20); } throw new Error('timed out waiting for ' + what); };
const authEvent = ch => finalizeEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [['challenge', ch], ['relay', WS_URL]], content: '' }, ann.sk);
const BIG = { kinds: [30078], authors: [church.pub] };
const subIds = p => Array.from({ length: SUBS }, (_, i) => p + i);

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

// Every sub got all N sermons, each followed by its EOSE. `ordered`: the REQ path sorts oldest→newest; the AUTH replay
// has always sent in store.query order (unchanged here), so order is only asserted where the relay promises it.
function assertComplete(c, ids, ordered = true) {
  for (const sid of ids) {
    const mine = c.log.map((m, i) => [m, i]).filter(([m]) => m[1] === sid && (m[0] === 'EVENT' || m[0] === 'EOSE'));
    const evs = mine.filter(([m]) => m[0] === 'EVENT').map(([m]) => m[2]);
    const eose = mine.filter(([m]) => m[0] === 'EOSE');
    assert.equal(evs.length, N, `${sid}: got ${evs.length} of ${N} events`);
    assert.equal(new Set(evs.map(e => e.id)).size, N, `${sid}: duplicates`);
    assert.equal(eose.length, 1, `${sid}: exactly one EOSE`);
    assert.equal(mine[mine.length - 1][0][0], 'EOSE', `${sid}: EOSE came last`);
    if (ordered) for (let i = 1; i < evs.length; i++) assert.ok(evs[i].created_at >= evs[i - 1].created_at, `${sid}: out of order at ${i}`);
  }
}

before(async () => {
  await requireFreePort(PORT, 'a-slow-reader-is-paused-not-dropped.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-backpressure-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub), TRINITY_TAILSCALE_BIN: '/nonexistent', RELAY_LOOPBACK_ONLY: '1',
        RELAY_WS_HIGH_WATER: String(64 * 1024), RELAY_WS_LOW_WATER: String(16 * 1024), RELAY_WS_PAUSE_MS: String(PAUSE_MS),
        // The byte budgets (production 32 MB per socket / 128 MB relay-wide) are raised here so that THIS file tests
        // pausing and the stall bound with a 48 MB backlog; the budgets have their own file,
        // a-slow-reader-cannot-hold-unbounded-memory.test.mjs.
        RELAY_WS_MAX_HELD_BYTES: String(256 * 1024 * 1024), RELAY_WS_MAX_HELD_BYTES_ALL: String(1024 * 1024 * 1024) },
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
  // One large PUBLIC event (a relay list is world-readable) for (d) to fill an anonymous reader's buffer with.
  assert.equal(await pub(finalizeEvent({ kind: 10002, created_at: ++t, tags: [['r', 'wss://example.invalid']], content: 'x'.repeat(FILL_BYTES) }, church.sk)), true, 'large kind-10002 stored');
  c.ws.close();
});
after(async () => { try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('(a) REQ path: a reader that stops reading for a while gets EVERY event, in order, then EOSE — and is not closed', { timeout: 60000 }, async () => {
  const c = await client();
  await signIn(c);
  c.ws.pause();                                   // stop reading: the tunnel is slow
  for (const sid of subIds('a')) send(c, ['REQ', sid, BIG]);
  await sleep(2000);                              // well under the stall bound
  c.ws.resume();
  await until(() => subIds('a').every(sid => c.log.some(m => m[0] === 'EOSE' && m[1] === sid)) || c.closeCode !== null, 40000, 'all EOSEs');
  assert.equal(c.closeCode, null, `the relay closed a slow reader (code ${c.closeCode})`);
  assertComplete(c, subIds('a'));
  c.ws.close();
});

test('(a2) AUTH replay path: a large replay of withheld docs to a slow reader pauses too, and the held EOSEs wait for it', { timeout: 60000 }, async () => {
  const c = await client();
  for (const sid of subIds('r')) send(c, ['REQ', sid, BIG]);   // unauthenticated: the sermons are withheld, EOSE held
  await until(() => c.challenge, 5000, 'AUTH challenge');
  assert.equal(c.log.filter(m => m[0] === 'EVENT').length, 0, 'nothing is served before sign-in');
  c.ws.pause();
  const a = authEvent(c.challenge);
  send(c, ['AUTH', a]);                           // the replay of ~48 MB starts now, into a socket nobody reads
  await sleep(3000);                              // past the 2.5 s EOSE grace — a held EOSE must not fire mid-replay
  c.ws.resume();
  await until(() => subIds('r').every(sid => c.log.some(m => m[0] === 'EOSE' && m[1] === sid)) || c.closeCode !== null, 40000, 'all EOSEs');
  assert.equal(c.closeCode, null, `the relay closed a slow reader during replay (code ${c.closeCode})`);
  assertComplete(c, subIds('r'), false);
  c.ws.close();
});

test('(b) a reader that NEVER drains is still closed 1009 "too slow" after the stall bound', { timeout: 60000 }, async t => {
  const c = await client();
  await signIn(c);
  c.ws.pause();
  for (const sid of subIds('b')) send(c, ['REQ', sid, BIG]);
  await sleep(PAUSE_MS + 3000);                   // never read past the bound
  c.ws.resume();                                  // now read what was queued — the close frame is behind it
  await Promise.race([c.closed, sleep(30000)]);
  assert.equal(c.closeCode, 1009, `expected 1009, got ${c.closeCode}`);
  const got = c.log.filter(m => m[0] === 'EVENT' && String(m[1]).startsWith('b')).length;
  t.diagnostic(`events received before the close: ${got} (bound ${IN_FLIGHT}; never stopped: ${N * SUBS})`);
  assert.ok(got <= IN_FLIGHT, `the stalled reader was sent ${got} events — more than could have been in flight when it was closed`);
  assert.ok(!subIds('b').every(sid => c.log.some(m => m[0] === 'EOSE' && m[1] === sid)), 'every EOSE arrived — the stream was never stopped');
});

test('(c) a subscription CLOSEd while its stream is paused gets nothing more and no EOSE; the socket stays usable', { timeout: 60000 }, async t => {
  const c = await client();
  await signIn(c);
  c.ws.pause();
  for (const sid of subIds('c')) send(c, ['REQ', sid, BIG]);
  await sleep(500);
  for (const sid of subIds('c')) send(c, ['CLOSE', sid]);
  await sleep(500);
  send(c, ['REQ', 'after', { kinds: [30078], authors: [ann.pub] }]);
  c.ws.resume();
  await until(() => c.log.some(m => m[0] === 'EOSE' && m[1] === 'after') || c.closeCode !== null, 30000, 'EOSE for the later REQ');
  // Drain FULLY: a stream that ignored the CLOSE keeps sending at loopback speed after resume(), so wait until the
  // socket has been silent for 1.5 s — by then a leaked stream has sent everything it had (audit 2026-11-11 F2: the
  // old check ran while such streams were still mid-way, so it passed even with the CLOSE check removed).
  await quiet(c, 1500);
  assert.equal(c.closeCode, null, `closed (code ${c.closeCode})`);
  const got = c.log.filter(m => m[0] === 'EVENT' && String(m[1]).startsWith('c')).length;
  t.diagnostic(`events received for the CLOSEd subs: ${got} (bound ${IN_FLIGHT}; never stopped: ${N * SUBS})`);
  assert.ok(got <= IN_FLIGHT, `${got} events of the CLOSEd subscriptions arrived — more than was in flight when they were CLOSEd`);
  for (const sid of subIds('c')) assert.ok(!c.log.some(m => m[0] === 'EOSE' && m[1] === sid), `${sid}: EOSE sent after CLOSE`);
  assert.ok(c.log.some(m => m[0] === 'EVENT' && m[1] === 'after'), 'the later REQ was answered');
  c.ws.close();
});

// (d) audit 2026-11-11 F3 — the held-EOSE branch for a REQ that was asked UNAUTHENTICATED, was paused, and finishes
// while an AUTH replay (itself paused) is still sending what that REQ was denied. Its EOSE must wait for the replay.
// The only thing an anonymous reader can be sent in bulk is public, so the buffer is filled with one large kind-10002
// (relay list, world-readable) asked for many times; the sub under test asks for that public event AND the sermons.
const FILL = 24, FILL_BYTES = 800 * 1024;
test('(d) a paused REQ that finishes DURING an AUTH replay: all its events, then exactly one EOSE', { timeout: 60000 }, async () => {
  const c = await client();
  send(c, ['REQ', 'probe', { kinds: [30078], authors: [ann.pub] }]);   // the challenge is per connection: learn it while reading
  await until(() => c.challenge, 5000, 'AUTH challenge');
  send(c, ['CLOSE', 'probe']);
  c.ws.pause();
  for (let k = 0; k < FILL; k++) send(c, ['REQ', 'fill' + k, { kinds: [10002], authors: [church.pub] }]);
  send(c, ['REQ', 'd', { kinds: [10002, 30078], authors: [church.pub] }]);   // public 10002 (paused behind the fill) + withheld sermons
  send(c, ['AUTH', authEvent(c.challenge)]);   // replay of d's N sermons starts — paused too
  await sleep(1500);
  c.ws.resume();
  await until(() => c.log.some(m => m[0] === 'EOSE' && m[1] === 'd') || c.closeCode !== null, 40000, 'EOSE for d');
  await quiet(c, 1500);
  assert.equal(c.closeCode, null, `closed (code ${c.closeCode})`);
  const mine = c.log.filter(m => m[1] === 'd' && (m[0] === 'EVENT' || m[0] === 'EOSE'));
  const evs = mine.filter(m => m[0] === 'EVENT');
  assert.equal(evs.filter(m => m[2].kind === 10002).length, 1, 'the public event was sent once');
  assert.equal(new Set(evs.filter(m => m[2].kind === 30078).map(m => m[2].id)).size, N, 'every withheld sermon was replayed');
  assert.equal(mine.filter(m => m[0] === 'EOSE').length, 1, 'exactly one EOSE');
  assert.equal(mine[mine.length - 1][0], 'EOSE', `EOSE came before ${mine.length - 1 - mine.findIndex(m => m[0] === 'EOSE')} of d's events`);
  c.ws.close();
});

// (e) audit 2026-11-11 F4 — a signed-in REQ that REPLACES a subId whose unauthenticated EOSE is still held. That held
// EOSE vouched for the OLD stream; flushed by the replay it would land before the new stream's events, then a second.
test('(e) a REQ that replaces a sub whose EOSE is held gets exactly one EOSE, after all its events', { timeout: 60000 }, async () => {
  const c = await client();
  for (const sid of subIds('e')) send(c, ['REQ', sid, BIG]);   // unauthenticated: withheld, EOSEs held
  await until(() => c.challenge, 5000, 'AUTH challenge');
  c.ws.pause();
  send(c, ['AUTH', authEvent(c.challenge)]);   // ~48 MB replay, paused
  send(c, ['REQ', 'e0', BIG]);                  // signed in now: replaces e0 while its old EOSE is still listed
  await sleep(1500);
  c.ws.resume();
  await until(() => subIds('e').every(sid => c.log.some(m => m[0] === 'EOSE' && m[1] === sid)) || c.closeCode !== null, 40000, 'all EOSEs');
  await quiet(c, 1500);
  assert.equal(c.closeCode, null, `closed (code ${c.closeCode})`);
  const mine = c.log.filter(m => m[1] === 'e0' && (m[0] === 'EVENT' || m[0] === 'EOSE'));
  assert.equal(mine.filter(m => m[0] === 'EOSE').length, 1, `e0 got ${mine.filter(m => m[0] === 'EOSE').length} EOSEs`);
  assert.equal(mine[mine.length - 1][0], 'EOSE', 'e0: EOSE came last');
  assert.equal(new Set(mine.filter(m => m[0] === 'EVENT').map(m => m[2].id)).size, N, 'e0: every event');
  assertComplete(c, subIds('e').slice(1), false);
  c.ws.close();
});
