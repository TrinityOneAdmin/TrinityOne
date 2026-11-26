// THE PUSH HOOK FORWARDS A CONTENTLESS WAKE TO THE PUSH SERVICE — PHASE 2 of the push-service redesign.
// Run: node --test scripts/the-push-hook-forwards-to-the-service.test.mjs
//
// Since Phase 2 the relay no longer sends APNs itself: its push seam (sendContentlessPush -> _pushSender) FORWARDS
// each eligible recipient to the central key-holding service (scripts/push-service.mjs) as a signed POST /wake. The
// relay holds NO Apple .p8 any more; it signs the forward with its OWN identity key (relay-key.json).
//
// POINT OF USE (CLAUDE.md #1): the gateway is SPAWNED and driven over the wire with TRINITY_PUSH_SERVICE_URL set, so
// every assertion rides the SHIPPED hook, the SHIPPED canRead and the SHIPPED forwarder — not a mirror. The outbound
// POST is observed by a LOCAL capture HTTP server (we never hit a real service / real Apple).
//
// WHAT EACH CASE PINS, and each FAILS if its feature is deleted (sabotage-verified 2026-11-26, scoped):
//   FORWARD    — a live A->B DM forwards exactly one { token, env } for B, with a NIP-98 envelope signed by the
//                RELAY'S identity key (kind 27235, u=<service>/wake, method POST, payload=sha256(body)); the SENDER,
//                a bystander token-holder and a tokenless member are NOT forwarded.
//                SABOTAGE: break the envelope signing (sign with a stray key) -> the pubkey/verify check goes red.
//   SAFEGUARD  — a room message forwards ONLY the in-room adult reader; a MINOR in the (non-child-safe) room and a
//                church member NOT in the invite room are both withheld; the sender is not.
//                SABOTAGE: drop `if (!canRead(e, pub)) continue;` in maybePushNotify -> minor + outsider forwarded, red.
//   ALLOW+LIVE — a kind-7 reaction, an ungrouped kind-1, and a DM arriving by /import (replay) forward ZERO times.
//   A8 REFUSED — with the service URL pointed at a refused port, a live DM keeps the relay serving, the forward does
//                NOT throw and leaves NO unhandled rejection; a second DM is still accepted (ingest unaffected).
//                SABOTAGE: remove the forward's `.catch(...)` -> an ECONNREFUSED reject goes unhandled -> red.
//   A8 HUNG    — with the service URL pointed at a server that never answers, a live DM returns immediately (ingest
//                never awaits the forward) and the relay keeps serving with no unhandled rejection.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { D } from './trinity-doc-types.mjs';
import { WAKE_PATH } from './push-service.mjs';   // pin the '/wake' literal in gateway.mjs against the service's constant

const ROOT = new URL('../', import.meta.url).pathname;
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const sha256hex = buf => createHash('sha256').update(buf).digest('hex');

// ── generic relay drivers, parameterised by port ───────────────────────────────────────────────────────────────
const conn = (port) => new Promise((r, j) => { const s = new WebSocket(`ws://127.0.0.1:${port}/relay`); s.on('open', () => r(s)); s.on('error', j); });
const send = (s, e) => new Promise(res => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { s.off('message', on); res(m); } };
  s.on('message', on); s.send(JSON.stringify(['EVENT', e]));
  setTimeout(() => res(['(no reply)', e.id, null, '']), 5000);
});
async function publishAs(port, who, e) {
  const wsUrl = `ws://127.0.0.1:${port}/relay`;
  const s = await conn(port);
  await new Promise(res => { const on = d => { const m = JSON.parse(d); if (m[0] === 'AUTH') { s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', wsUrl], ['challenge', m[1]]], content: '' }, who.sk)])); res(true); } }; s.on('message', on); setTimeout(() => res(false), 600); });
  s.send(JSON.stringify(['REQ', 'warm', { kinds: [1], limit: 1 }]));
  await sleep(120);
  const out = await send(s, e); s.close(); return out;
}
async function waitReady(port) { const t0 = Date.now(); while (Date.now() - t0 < 25000) { try { if ((await fetch(`http://127.0.0.1:${port}/status`)).ok) return true; } catch {} await sleep(150); } return false; }

const NET = 'trinityone';
const member = (church, who) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', D.MEMBER + church.pub], ['t', NET]], content: JSON.stringify({ joined: now() }) }, who.sk);
const token = (who) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', D.PUSHTOKEN + who.pub], ['t', NET]], content: JSON.stringify({ token: 'apns-' + who.pub.slice(0, 6), platform: 'ios', env: 'prod', ts: now() }) }, who.sk);
const tokOf = (who) => 'apns-' + who.pub.slice(0, 6);
const dm = (from, toPub, ts = now()) => finalizeEvent({ kind: 4, created_at: ts, tags: [['p', toPub], ['t', NET]], content: 'ciphertext' }, from.sk);
const roomMsg = (from, church, gid, ts = now()) => finalizeEvent({ kind: 1, created_at: ts, tags: [['t', gid], ['t', NET], ['p', church.pub]], content: 'hello room' }, from.sk);

function spawnRelay(port, dataDir, church, extraEnv, stderrSink) {
  const r = spawn(process.execPath, ['scripts/gateway.mjs', String(port)], {
    cwd: ROOT, stdio: ['ignore', 'ignore', stderrSink ? 'pipe' : 'ignore'],
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub), TRINITY_TAILSCALE_BIN: '/nonexistent', ...extraEnv },
  });
  if (stderrSink) r.stderr.on('data', d => stderrSink.buf += d.toString());
  return r;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// GROUP 1 — the forward is correct, gated, sender-excluded, kind-allowlisted and live-path-only.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const PORT = 8927;              // gateway (unique across scripts/*.test.mjs AND scripts/*.probe.mjs)
const CAP_PORT = 8928;          // local capture server standing in for the push service
const SERVICE_URL = `http://127.0.0.1:${CAP_PORT}`;

const church = K(), A = K(), B = K(), C = K(), M = K(), E = K(), N = K();
const GID = 'room-' + Math.random().toString(16).slice(2, 10);
let relay, dataDir, relayPub, capServer, captured = [];

const resetCap = () => { captured = []; };
async function waitCaptured(n, ms = 2000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (captured.length >= n) break; await sleep(40); } return captured; }
// decode the NIP-98 "Nostr <base64(event)>" header into its event
function authEvent(auth) { const m = /^Nostr\s+(.+)$/.exec(auth || ''); if (!m) return null; try { return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')); } catch { return null; } }

before(async () => {
  await requireFreePort(PORT, 'the-push-hook-forwards-to-the-service.test.mjs (spawns its own gateway)');
  await requireFreePort(CAP_PORT, 'the-push-hook-forwards-to-the-service.test.mjs (binds a capture server)');
  // the capture server records every POST (raw body + auth header) and 202s, like the real /wake.
  capServer = http.createServer((req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => { const raw = Buffer.concat(chunks); captured.push({ method: req.method, url: req.url, auth: req.headers['authorization'], raw, body: (() => { try { return JSON.parse(raw.toString('utf8')); } catch { return null; } })() }); res.writeHead(202); res.end('accepted\n'); });
  });
  await new Promise(r => capServer.listen(CAP_PORT, '127.0.0.1', r));

  dataDir = mkdtempSync(join(tmpdir(), 'trin-pushfwd-'));
  relay = spawnRelay(PORT, dataDir, church, { TRINITY_PUSH_SERVICE_URL: SERVICE_URL });
  assert.ok(await waitReady(PORT), 'relay did not come up');
  relayPub = JSON.parse(readFileSync(join(dataDir, 'relay-key.json'), 'utf8')).pub;   // the identity key it must sign with

  for (const who of [A, B, C, M, E, N]) assert.equal((await publishAs(PORT, who, member(church, who)))[2], true, 'fixture: a member could not join');
  for (const who of [A, B, C, M, E]) assert.equal((await publishAs(PORT, who, token(who)))[2], true, 'fixture: a member could not register a token');
  assert.equal((await publishAs(PORT, church, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', D.GROUP + GID], ['t', NET]], content: JSON.stringify({ visibility: 'invite', members: [C.pub, B.pub, M.pub], name: 'Room' }) }, church.sk)))[2], true, 'fixture: the group def was refused');
  assert.equal((await publishAs(PORT, church, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', D.MINORS + church.pub], ['t', NET]], content: JSON.stringify({ pubkeys: [M.pub] }) }, church.sk)))[2], true, 'fixture: the minors doc was refused');
  await sleep(400);
  resetCap();
  assert.equal(captured.length, 0, 'fixture publishes (all kind-30078) forwarded a wake — the allowlist is not holding');
});
after(async () => { try { relay && relay.kill('SIGKILL'); } catch {} try { capServer && await new Promise(r => capServer.close(r)); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('a live DM forwards one contentless { token, env } for the recipient, signed by the relay identity key', async () => {
  resetCap();
  assert.equal((await publishAs(PORT, A, dm(A, B.pub)))[2], true, 'the DM was refused at the frame');
  const got = await waitCaptured(1);
  assert.equal(got.length, 1, 'expected exactly one forward for A->B; got ' + got.length);
  const req = got[0];
  // it is a POST to /wake with a CONTENTLESS body: recipient token + env only (no sender/church/message fields)
  assert.equal(req.method, 'POST'); assert.equal(req.url, WAKE_PATH);
  assert.deepEqual(Object.keys(req.body).sort(), ['env', 'token'], 'the forward body carried more than { token, env }: ' + JSON.stringify(req.body));
  assert.equal(req.body.token, tokOf(B), 'the forwarded token is not B\'s');
  assert.equal(req.body.env, 'production', 'the token env (prod) was not mapped to production');
  // the NIP-98 envelope is signed by THE RELAY'S identity key and binds this exact request
  const ev = authEvent(req.auth);
  assert.ok(ev, 'no NIP-98 Authorization envelope on the forward');
  assert.ok(verifyEvent(ev), 'the forward envelope signature does not verify');
  assert.equal(ev.pubkey, relayPub, 'the envelope was NOT signed by the relay identity key (relay-key.json)');
  assert.equal(ev.kind, 27235, 'the envelope is not a kind-27235 NIP-98 event');
  const tag = n => (ev.tags.find(t => t[0] === n) || [])[1];
  assert.equal(tag('method'), 'POST');
  assert.equal(tag('u'), SERVICE_URL + WAKE_PATH, 'the signed u-tag is not <service>/wake');
  assert.equal(tag('payload'), sha256hex(req.raw), 'the payload tag is not sha256(body) — the signature is not bound to this body');
});

test('a live DM forwards NOBODY but the recipient — not the sender, not a bystander, not a tokenless member', async () => {
  // A->B must not forward for A (sender), C (token-holder, not the p-target) or N (no token).
  resetCap();
  assert.equal((await publishAs(PORT, A, dm(A, B.pub)))[2], true, 'the DM was refused at the frame');
  await waitCaptured(1); await sleep(200);
  const tokens = captured.map(r => r.body && r.body.token);
  assert.deepEqual(tokens, [tokOf(B)], 'exactly B should be forwarded; got ' + JSON.stringify(tokens));
  assert.ok(!tokens.includes(tokOf(A)), 'the SENDER was forwarded to the service');
  assert.ok(!tokens.includes(tokOf(C)), 'a third party to the DM was forwarded — canRead did not narrow to the p-tag');
  // and a DM to the tokenless member N forwards nothing at all
  resetCap();
  assert.equal((await publishAs(PORT, A, dm(A, N.pub)))[2], true, 'the DM to N was refused at the frame');
  await sleep(300);
  assert.equal(captured.length, 0, 'a forward fired for A->N although N holds no token');
});

test('SAFEGUARDING: a room message forwards the in-room reader but withholds the minor and the non-member', async () => {
  resetCap();
  assert.equal((await publishAs(PORT, C, roomMsg(C, church, GID)))[2], true, 'the room message was refused at the frame');
  await waitCaptured(1); await sleep(200);
  const tokens = captured.map(r => r.body && r.body.token);
  assert.deepEqual(tokens, [tokOf(B)], 'exactly B (in-room, adult, token) should be forwarded; got ' + JSON.stringify(tokens));
  assert.ok(!tokens.includes(tokOf(M)), 'SAFEGUARDING REGRESSION: a MINOR in a non-child-safe room was forwarded');
  assert.ok(!tokens.includes(tokOf(E)), 'a church member NOT in the invite-only room was forwarded');
  assert.ok(!tokens.includes(tokOf(C)), 'the SENDER of the room message was forwarded');
});

test('the kind allowlist and the replay paths forward ZERO times (reaction, ungrouped kind-1, /import)', async () => {
  resetCap();
  assert.equal((await publishAs(PORT, C, finalizeEvent({ kind: 7, created_at: now(), tags: [['t', GID], ['t', NET], ['e', 'a'.repeat(64)], ['p', church.pub]], content: '+' }, C.sk)))[2], true, 'the reaction was refused at the frame');
  assert.equal((await publishAs(PORT, C, finalizeEvent({ kind: 1, created_at: now(), tags: [['t', NET], ['p', church.pub]], content: 'ungrouped' }, C.sk)))[2], true, 'the ungrouped kind-1 was refused at the frame');
  // a brand-new A->B DM pushed through the RESTORE door (/import) — a replay path, must forward nothing
  const nip98 = (who, path, extra = []) => 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({ kind: 27235, created_at: now(), tags: [['u', `http://127.0.0.1:${PORT}${path}`], ['method', 'POST'], ...extra], content: '' }, who.sk))).toString('base64');
  const restored = dm(A, B.pub, now() - 3600);
  const r = await fetch(`http://127.0.0.1:${PORT}/import`, { method: 'POST', headers: { Authorization: nip98(church, '/import', [['church', church.pub]]), 'Content-Type': 'application/x-ndjson' }, body: JSON.stringify(restored) + '\n' });
  const body = await r.json().catch(() => ({}));
  assert.equal(r.status, 200, '/import refused the church key: ' + JSON.stringify(body));
  assert.equal(body.imported, 1, 'the DM was not stored by /import, so a zero-forward result is vacuous: ' + JSON.stringify(body));
  await sleep(400);
  assert.equal(captured.length, 0, 'a non-message kind, an ungrouped kind-1, or an /import replay forwarded a wake: ' + JSON.stringify(captured.map(c => c.body)));
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// GROUP 2 — a8 outage: a refused / hung service must never throw, never leave an unhandled rejection, never stall ingest.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
async function seedDM(port, ch) {
  for (const who of [A, B]) assert.equal((await publishAs(port, who, member(ch, who)))[2], true, 'a8 fixture: member join refused');
  assert.equal((await publishAs(port, B, token(B)))[2], true, 'a8 fixture: token register refused');
}

test('A8 REFUSED: a live DM to a refused push service keeps the relay serving with NO unhandled rejection', async () => {
  const P = 8929, REFUSED = 8936;   // nothing ever listens on REFUSED
  await requireFreePort(P, 'a8-refused gateway');
  await requireFreePort(REFUSED, 'a8-refused target (left unbound)');
  const dd = mkdtempSync(join(tmpdir(), 'trin-a8refused-'));
  const sink = { buf: '' };
  const ch = K();
  const r = spawnRelay(P, dd, ch, { TRINITY_PUSH_SERVICE_URL: `http://127.0.0.1:${REFUSED}` }, sink);
  try {
    assert.ok(await waitReady(P), 'a8-refused relay did not come up');
    await seedDM(P, ch);
    // drive a DM: the forward tries the refused port and must swallow the ECONNREFUSED reject
    assert.equal((await publishAs(P, A, dm(A, B.pub)))[2], true, 'the DM was refused at the frame');
    await sleep(600);   // let the forward's fetch reject and settle
    // ingest is unaffected: the relay still serves and still accepts a second message
    assert.ok((await fetch(`http://127.0.0.1:${P}/status`)).ok, 'the relay stopped serving after a refused forward');
    assert.equal((await publishAs(P, A, dm(A, B.pub, now() + 1)))[2], true, 'a SECOND DM was refused — ingest was affected by the outage');
    await sleep(400);
    assert.ok(!sink.buf.includes('[unhandledRejection]'), 'the forward left an UNHANDLED REJECTION on a refused service:\n' + sink.buf);
    assert.ok(!sink.buf.includes('[uncaughtException]'), 'the forward threw an uncaught exception on a refused service:\n' + sink.buf);
  } finally { try { r.kill('SIGKILL'); } catch {} try { rmSync(dd, { recursive: true, force: true }); } catch {} }
});

test('A8 HUNG: a live DM to a never-answering push service returns immediately and the relay keeps serving', async () => {
  const P = 8932, HUNG = 8933;
  await requireFreePort(P, 'a8-hung gateway');
  await requireFreePort(HUNG, 'a8-hung target server');
  const hung = http.createServer(() => { /* accept the socket, NEVER respond */ });
  await new Promise(r => hung.listen(HUNG, '127.0.0.1', r));
  const dd = mkdtempSync(join(tmpdir(), 'trin-a8hung-'));
  const sink = { buf: '' };
  const ch = K();
  const r = spawnRelay(P, dd, ch, { TRINITY_PUSH_SERVICE_URL: `http://127.0.0.1:${HUNG}` }, sink);
  try {
    assert.ok(await waitReady(P), 'a8-hung relay did not come up');
    await seedDM(P, ch);
    const t0 = Date.now();
    assert.equal((await publishAs(P, A, dm(A, B.pub)))[2], true, 'the DM was refused at the frame');
    assert.ok(Date.now() - t0 < 4000, 'the DM took too long — ingest awaited the hung forward');   // forward is fire-and-forget
    await sleep(500);
    assert.ok((await fetch(`http://127.0.0.1:${P}/status`)).ok, 'the relay stopped serving while a forward hung');
    assert.ok(!sink.buf.includes('[unhandledRejection]'), 'the forward left an unhandled rejection while hung:\n' + sink.buf);
  } finally { try { r.kill('SIGKILL'); } catch {} try { await new Promise(res => hung.close(res)); } catch {} try { rmSync(dd, { recursive: true, force: true }); } catch {} }
});
