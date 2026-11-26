// CONNECTION POOLING + PER-SEND TIMEOUT for the contentless-APNs sender — the one open audit item (LOW) on the
// Phase-3 relay sender. Run:
//   node --test scripts/apns-sender-pooling.test.mjs
//
// THE LEAK THIS CLOSES: the Phase-3 sender opened a NEW http2 session per recipient and had NO per-send timeout,
// so an established-but-SILENT Apple connection (connects, never answers) would leak a session on a relay that runs
// for weeks. Two changes, both proven here at the point of USE against the SHIPPED gateway.mjs source (lifted by
// the same slice + injected mock transport as apns-contentless-sender.test.mjs — never a mirror, never a text match):
//   1. a per-request timeout that DESTROYS the request and DROPS the (silent) session, never throwing into ingest;
//   2. a pooled session PER ORIGIN, reused across recipients/messages, dropped on close/error so the next reconnects.
//
// Each case FAILS if its feature is deleted (sabotage-verified 2026-11-26, scoped to the function under test):
//   timeout cleanup   — SABOTAGE: delete the setTimeout(...) teardown in apnsSend          -> this test's own
//                        deadline fires first => red (and the real code would hang/leak the socket).
//   reuse same origin — SABOTAGE: revert _apnsGetSession to connect-per-send               -> connects 2, not 1 => red.
//   separate origins  — proves prod and sandbox get SEPARATE sessions (2 connects, 2 authorities).
//   reconnect         — SABOTAGE: drop the session.on('close', drop) wiring                -> no reconnect => red.
//   never-throws      — a transport that errors mid-send does not throw out of sendContentlessPush; the body is
//                        still the exact contentless payload (regression over §15.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPrivateKey, sign as cryptoSign, generateKeyPairSync } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { decode as nip19decode } from 'nostr-tools/nip19';
import { fnBody, stmt } from './test-slice.mjs';

const GW = readFileSync(new URL('../scripts/gateway.mjs', import.meta.url), 'utf8');
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const flush = () => new Promise(r => setImmediate(r));

// Lift the real Phase-3 send path (pool + timeout + sender) and the real gating into one scope and RUN it. Same
// slice boundaries as apns-contentless-sender.test.mjs; additionally exposes the timeout knobs + the live session
// pool so a test can drive the real teardown fast and observe reuse.
function assemble() {
  const phase3 = GW.slice(GW.indexOf('let _pushSender = null;'), GW.indexOf('// ── WIRING.'));
  const parts = [
    phase3,
    fnBody(GW, 'function maybePushNotify(e) {', 'maybePushNotify'),
    fnBody(GW, 'function canRead(e, authed) {', 'canRead'),
    fnBody(GW, 'function safeguardAllows(minorPub, other) {', 'safeguardAllows'),
    fnBody(GW, 'function minorGoverningChurches(pub) {', 'minorGoverningChurches'),
    fnBody(GW, 'function dmBlockedBetween(a, b) {', 'dmBlockedBetween'),
    fnBody(GW, 'function toHexPub(s) {', 'toHexPub'),
    stmt(GW, 'const churchesOf = (m) =>', 'churchesOf'),
    stmt(GW, 'const gidOf = (e) =>', 'gidOf'),
  ];
  const TOKENS_BY_PUB = new Map();
  const api = new Function(
    'http2Connect', 'createPrivateKey', 'cryptoSign', 'readFileSync', 'nip19decode', 'NET',
    'TOKENS_BY_PUB', 'MINORS_BY', 'MEMBER_DOCS', 'MEMBER_CHURCHES', 'EMPTY_SET',
    parts.join('\n') + '\nreturn {' +
      ' makeApnsSender, sendContentlessPush, maybePushNotify,' +
      ' getCounters: () => _apnsCounters,' +
      ' sessionCount: () => _apnsSessions.size,' +
      ' setPushSender: (f) => { _pushSender = f; },' +
      ' setTransport: (f) => { _apnsH2Connect = f; },' +
      ' setLog: (f) => { _apnsLog = f; },' +
      ' setReqTimeout: (ms) => { _apnsReqTimeoutMs = ms; },' +
      ' setIdleTimeout: (ms) => { _apnsIdleTimeoutMs = ms; } };'
  )(
    () => { throw new Error('the real http2 transport was dialled — a test forgot setTransport()'); },
    createPrivateKey, cryptoSign, readFileSync, nip19decode, NET,
    TOKENS_BY_PUB, new Map(), new Map(), new Map(), new Set(),
  );
  api.TOKENS_BY_PUB = TOKENS_BY_PUB;
  return api;
}

const CFG = (() => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }), pub: publicKey, keyId: 'ABC1234DEF', teamId: 'TEAM789XYZ', topic: 'com.trinityone.app' };
})();

// A transport that answers normally (200) and records connects, requests and closes. `answer:false` makes the
// session connect but NEVER emit a response — the silent-connection leak the timeout must tear down.
function poolMock(record, { answer = true, status = 200 } = {}) {
  record.connects = 0; record.requests = 0; record.closed = 0;
  record.authorities = [];
  return (authority) => {
    record.connects++;
    record.authorities.push(authority);
    const session = new EventEmitter();
    session.close = () => { record.closed++; };
    session.destroy = () => { record.destroyed = (record.destroyed || 0) + 1; };
    record.lastSession = session;
    session.request = () => {
      record.requests++;
      const req = new EventEmitter();
      req.destroy = () => { record.reqDestroyed = (record.reqDestroyed || 0) + 1; };
      req.end = () => {
        if (!answer) return;   // SILENT: connects, accepts the request, never answers.
        setImmediate(() => { req.emit('response', { ':status': status }); req.emit('data', Buffer.from('')); req.emit('end'); });
      };
      return req;
    };
    return session;
  };
}

// ── 1. TIMEOUT CLEANUP: a session that never answers is torn down after the per-request timeout; nothing throws,
// nothing is left inflight. The test gives itself its OWN short deadline so a MISSING timeout fails deterministically
// (red) instead of hanging the runner.
test('a silent APNs connection is torn down by the per-send timeout — request destroyed, session closed, no throw', async () => {
  const api = assemble();
  const rec = {};
  api.setTransport(poolMock(rec, { answer: false }));   // connects, never responds
  api.setReqTimeout(40);                                // fast, deterministic deadline for the real timeout
  api.setPushSender(api.makeApnsSender(CFG));
  const A = K(), B = K();
  const dm = finalizeEvent({ kind: 4, created_at: now(), tags: [['p', B.pub]], content: 'x' }, A.sk);

  assert.doesNotThrow(() => api.sendContentlessPush(B.pub, { token: 'tok-silent', env: 'prod' }, dm), 'the silent send threw into ingest');

  // Our OWN deadline (longer than the sender's 40ms, far shorter than any hang): the teardown MUST have happened.
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && !(rec.reqDestroyed && rec.closed)) { await flush(); await new Promise(r => setTimeout(r, 10)); }

  assert.ok(rec.reqDestroyed >= 1, 'the timeout did not destroy the stalled request (the leak is not closed)');
  assert.ok(rec.closed >= 1, 'the timeout did not close the silent session (the session would leak)');
  assert.equal(api.sessionCount(), 0, 'the silent session was not dropped from the pool after timeout');
  assert.equal(api.getCounters().timeout, 1, 'the timeout was not counted coarsely');
  assert.equal(api.getCounters().ok, 0, 'a silent send must not count as ok');
});

// ── 2. REUSE SAME ORIGIN: two sends to the same environment reuse ONE session (connect once, request twice).
test('two sends to the same origin reuse a single pooled session (one connect, two requests)', async () => {
  const api = assemble();
  const rec = {};
  api.setTransport(poolMock(rec, { answer: true }));
  api.setPushSender(api.makeApnsSender(CFG));
  const A = K(), B = K(), C = K();
  const dmB = finalizeEvent({ kind: 4, created_at: now(), tags: [['p', B.pub]], content: 'x' }, A.sk);
  const dmC = finalizeEvent({ kind: 4, created_at: now(), tags: [['p', C.pub]], content: 'y' }, A.sk);
  api.sendContentlessPush(B.pub, { token: 'tok-B', env: 'prod' }, dmB);
  await flush(); await flush();
  api.sendContentlessPush(C.pub, { token: 'tok-C', env: 'prod' }, dmC);
  await flush(); await flush();
  assert.equal(rec.connects, 1, 'the second same-origin send opened a NEW session instead of reusing the pooled one');
  assert.equal(rec.requests, 2, 'both recipients should have been sent');
  assert.equal(api.sessionCount(), 1, 'the pool should hold exactly one session for the origin');
});

// ── 3. SEPARATE ORIGINS: a production send and a sandbox send use SEPARATE sessions (two connects, two authorities).
test('production and sandbox tokens use separate pooled sessions (different origins)', async () => {
  const api = assemble();
  const rec = {};
  api.setTransport(poolMock(rec, { answer: true }));
  api.setPushSender(api.makeApnsSender(CFG));
  const A = K(), B = K();
  const prod = finalizeEvent({ kind: 4, created_at: now(), tags: [['p', B.pub]], content: 'x' }, A.sk);
  api.sendContentlessPush(B.pub, { token: 'tok-prod', env: 'prod' }, prod);
  await flush(); await flush();
  api.sendContentlessPush(B.pub, { token: 'tok-sb', env: 'sandbox' }, prod);
  await flush(); await flush();
  assert.equal(rec.connects, 2, 'prod and sandbox must not share a session — they are different Apple hosts');
  assert.deepEqual(new Set(rec.authorities), new Set(['https://api.push.apple.com', 'https://api.sandbox.push.apple.com']),
    'the two sessions did not go to the prod and sandbox hosts');
  assert.equal(api.sessionCount(), 2, 'the pool should hold one session per origin');
});

// ── 4. RECONNECT AFTER CLOSE: once the cached session closes, the next send opens a fresh one.
test('after a pooled session closes, the next send reconnects with a new session', async () => {
  const api = assemble();
  const rec = {};
  api.setTransport(poolMock(rec, { answer: true }));
  api.setPushSender(api.makeApnsSender(CFG));
  const A = K(), B = K();
  const dm = finalizeEvent({ kind: 4, created_at: now(), tags: [['p', B.pub]], content: 'x' }, A.sk);
  api.sendContentlessPush(B.pub, { token: 'tok-B', env: 'prod' }, dm);
  await flush(); await flush();
  assert.equal(rec.connects, 1, 'the first send should open one session');
  // Apple drops the connection (the real 'close'/'goaway'/'error' the pool drops on):
  rec.lastSession.emit('close');
  assert.equal(api.sessionCount(), 0, 'a closed session was not evicted from the pool');
  api.sendContentlessPush(B.pub, { token: 'tok-B', env: 'prod' }, dm);
  await flush(); await flush();
  assert.equal(rec.connects, 2, 'the send after a close did not reconnect (it reused a dead session)');
  assert.equal(api.sessionCount(), 1, 'the pool should hold the reconnected session');
});

// ── 5. NEVER THROWS INTO INGEST / STILL CONTENTLESS: an erroring transport does not throw out of the seam, and the
// body is still the exact §15.2 contentless payload (regression).
test('a transport that errors mid-send never throws out of the seam and the body stays contentless', async () => {
  const api = assemble();
  let sentBody = null;
  const errTransport = (authority) => {
    const session = new EventEmitter();
    session.close = () => {}; session.destroy = () => {};
    session.request = () => {
      const req = new EventEmitter();
      req.destroy = () => {};
      req.end = (body) => { sentBody = body; setImmediate(() => req.emit('error', new Error('mid-send reset'))); };
      return req;
    };
    return session;
  };
  api.setTransport(errTransport);
  api.setPushSender(api.makeApnsSender(CFG));
  const A = K(), B = K();
  const dm = finalizeEvent({ kind: 4, created_at: now(), tags: [['p', B.pub]], content: 'x' }, A.sk);
  assert.doesNotThrow(() => api.sendContentlessPush(B.pub, { token: 'tok-B', env: 'prod' }, dm), 'a mid-send error threw into ingest');
  await flush(); await flush();
  assert.deepEqual(JSON.parse(sentBody), { aps: { alert: { 'loc-key': 'NEW_MESSAGE' }, sound: 'default', 'thread-id': 'trinityone-msgs' } },
    'the body on the wire drifted from the contentless §15.2 payload');
  assert.equal(api.getCounters().err >= 1, true, 'the mid-send error was not counted');
  assert.equal(api.sessionCount(), 0, 'the errored session was not dropped from the pool');
});
