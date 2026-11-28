// POINT-OF-USE tests for the standalone push service (scripts/push-service.mjs). Run:
//   node --test scripts/push-service.test.mjs
//
// These drive the REAL HTTP route end to end: a real http.Server on an ephemeral port, real signed NIP-98 envelopes,
// and a MOCK APNs transport injected so no Apple call is ever made. Each case fails if its feature is removed.
//
// SABOTAGE-VERIFIED 2026-11-26 (scoped to the function under test, reverted after):
//   drop the per-token limit check      -> the rate-limit test goes red (excess requests get 202, not 429).
//   drop the verifyEnvelope sig check   -> the unsigned/bad-sig tests go red (a junk request gets accepted + sent).
//   add a field to contentlessPayload() -> the drift guard goes red (service payload != apns-cli-lib buildPayload()).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { EventEmitter } from 'node:events';
import { createPushService, makePooledSender, contentlessPayload, WAKE_PATH, NIP98_KIND } from './push-service.mjs';
import { buildPayload as libBuildPayload } from './apns-cli-lib.mjs';

const sha256hex = (buf) => createHash('sha256').update(buf).digest('hex');
const nowSec = () => Math.floor(Date.now() / 1000);

// A valid .p8 stand-in: a real EC P-256 private key in PEM, so buildJwt actually signs. (No real Apple contact — the
// transport is mocked.)
const CFG = (() => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }), keyId: 'ABC1234DEF', teamId: 'TEAM789XYZ', topic: 'com.trinityone.app' };
})();

// A relay identity keypair (the thing that signs the envelope).
const RELAY = (() => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; })();

// Build the "Nostr <base64(event)>" Authorization header over this exact request. Overridable bits let the bad cases
// tamper with one field at a time.
function authHeader({ sk = RELAY.sk, method = 'POST', path = WAKE_PATH, rawBody, createdAt = nowSec(), kind = NIP98_KIND, payloadHash } = {}) {
  const ev = finalizeEvent({
    kind,
    created_at: createdAt,
    tags: [['u', path], ['method', method], ['payload', payloadHash !== undefined ? payloadHash : sha256hex(rawBody)]],
    content: '',
  }, sk);
  return 'Nostr ' + Buffer.from(JSON.stringify(ev)).toString('base64');
}

// A mock APNs HTTP/2 transport: records every connect/request with its authority, :path, headers and posted body.
function apnsMock(record = {}) {
  record.connects = 0; record.requests = 0; record.authorities = []; record.sends = [];
  const fn = (authority) => {
    record.connects++;
    record.authorities.push(authority);
    const session = new EventEmitter();
    session.close = () => {}; session.destroy = () => {};
    session.request = (headers) => {
      record.requests++;
      const req = new EventEmitter();
      req.destroy = () => {};
      req.end = (body) => {
        record.sends.push({ authority, path: headers[':path'], topic: headers['apns-topic'], pushType: headers['apns-push-type'], body });
        setImmediate(() => { req.emit('response', { ':status': 200 }); req.emit('data', Buffer.from('')); req.emit('end'); });
      };
      return req;
    };
    return session;
  };
  return { fn, record };
}

// Start a service on an ephemeral port; return { base, svc, record, log }.
async function startService(opts = {}) {
  const mock = apnsMock();
  const logLines = [];
  const svc = createPushService({
    cfg: opts.cfg === null ? null : CFG,
    apnsTransport: mock.fn,
    log: (m) => logLines.push(String(m)),
    tokenLimit: opts.tokenLimit,
    tokenWindowMs: opts.tokenWindowMs,
    ...opts.extra,
  });
  const base = await new Promise((r) => svc.server.listen(0, '127.0.0.1', () => r('http://127.0.0.1:' + svc.server.address().port)));
  return { base, svc, record: mock.record, log: logLines };
}

async function post(base, { body, auth }) {
  const headers = { 'content-type': 'application/json' };
  if (auth) headers['authorization'] = auth;
  return fetch(base + WAKE_PATH, { method: 'POST', headers, body });
}

const TOKEN = 'ab'.repeat(32);   // 64 hex, a realistic APNs device token

// ── 1. VALID signed /wake → ONE correct contentless APNs POST to the right host/path/topic; sandbox vs production route.
test('a valid signed /wake sends exactly one contentless APNs POST to the token on the right host', async () => {
  const { base, svc, record } = await startService();
  const body = JSON.stringify({ token: TOKEN, env: 'sandbox' });
  const res = await post(base, { body, auth: authHeader({ rawBody: Buffer.from(body) }) });
  assert.equal(res.status, 202, 'a valid signed wake should be accepted');
  // wait for the fire-and-forget send to register
  for (let i = 0; i < 50 && record.requests < 1; i++) await new Promise(r => setTimeout(r, 5));
  assert.equal(record.requests, 1, 'exactly one APNs request should have been sent');
  const s = record.sends[0];
  assert.equal(s.authority, 'https://api.sandbox.push.apple.com', 'sandbox token must route to the sandbox host');
  assert.equal(s.path, '/3/device/' + TOKEN, 'the APNs path must be /3/device/<token>');
  assert.equal(s.topic, 'com.trinityone.app', 'the apns-topic header must be the configured topic');
  assert.equal(s.pushType, 'alert', 'a contentless alert push');
  assert.deepEqual(JSON.parse(s.body), libBuildPayload(), 'the posted body must be the contentless §15.2 payload');
  await svc.close();
});

test('a production env token routes to the production Apple host', async () => {
  const { base, svc, record } = await startService();
  const body = JSON.stringify({ token: TOKEN, env: 'production' });
  const res = await post(base, { body, auth: authHeader({ rawBody: Buffer.from(body) }) });
  assert.equal(res.status, 202);
  for (let i = 0; i < 50 && record.requests < 1; i++) await new Promise(r => setTimeout(r, 5));
  assert.equal(record.sends[0].authority, 'https://api.push.apple.com', 'production token must route to the production host');
  await svc.close();
});

// ── 2. UNSIGNED / BAD-SIG / STALE → rejected, NOTHING sent.
test('an unsigned request is rejected (401) and sends nothing', async () => {
  const { base, svc, record } = await startService();
  const body = JSON.stringify({ token: TOKEN, env: 'sandbox' });
  const res = await post(base, { body });   // no Authorization
  assert.equal(res.status, 401, 'no envelope must be unauthorized');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(record.requests, 0, 'a rejected request must not send an APNs push');
  await svc.close();
});

test('a bad-signature request (payload hash does not match the body) is rejected (401) and sends nothing', async () => {
  const { base, svc, record } = await startService();
  const body = JSON.stringify({ token: TOKEN, env: 'sandbox' });
  // sign over a DIFFERENT body => the payload tag will not match the bytes the server received
  const auth = authHeader({ rawBody: Buffer.from(JSON.stringify({ token: TOKEN, env: 'production' })) });
  const res = await post(base, { body, auth });
  assert.equal(res.status, 401, 'an envelope whose payload hash does not bind the body must be rejected');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(record.requests, 0);
  await svc.close();
});

test('a stale-timestamp envelope is rejected (401) and sends nothing', async () => {
  const { base, svc, record } = await startService();
  const body = JSON.stringify({ token: TOKEN, env: 'sandbox' });
  const auth = authHeader({ rawBody: Buffer.from(body), createdAt: nowSec() - 3600 });   // one hour old
  const res = await post(base, { body, auth });
  assert.equal(res.status, 401, 'a stale envelope must be rejected');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(record.requests, 0);
  await svc.close();
});

// ── 3. A FORBIDDEN body field (content/sender/church/aps) → rejected, even with a VALID signature over those bytes.
test('a /wake body carrying a forbidden content field is rejected (400) even when correctly signed', async () => {
  const { base, svc, record } = await startService();
  for (const extra of [{ content: 'hi' }, { sender: 'x' }, { church: 'c' }, { aps: {} }]) {
    const body = JSON.stringify({ token: TOKEN, env: 'sandbox', ...extra });
    const auth = authHeader({ rawBody: Buffer.from(body) });   // VALID sig over the exact (forbidden) body
    const res = await post(base, { body, auth });
    assert.equal(res.status, 400, 'a body with ' + Object.keys(extra)[0] + ' must be rejected as not contentless');
  }
  await new Promise(r => setTimeout(r, 20));
  assert.equal(record.requests, 0, 'no forbidden-field request may reach Apple');
  await svc.close();
});

// ── 4. PER-TOKEN RATE LIMIT (the core security gate): under the limit allowed, over the limit rejected (429).
test('the per-recipient-token rate limit allows up to N then rejects the rest with 429', async () => {
  const { base, svc, record } = await startService({ tokenLimit: 2, tokenWindowMs: 60000 });
  const body = JSON.stringify({ token: TOKEN, env: 'sandbox' });
  const codes = [];
  for (let i = 0; i < 4; i++) {
    const res = await post(base, { body, auth: authHeader({ rawBody: Buffer.from(body) }) });
    codes.push(res.status);
  }
  assert.deepEqual(codes, [202, 202, 429, 429], 'the first 2 should be accepted and the next 2 rate-limited');
  for (let i = 0; i < 50 && record.requests < 2; i++) await new Promise(r => setTimeout(r, 5));
  assert.equal(record.requests, 2, 'only the under-limit sends should have reached Apple');

  // A DIFFERENT token is NOT throttled — the gate is PER recipient token.
  const body2 = JSON.stringify({ token: 'cd'.repeat(32), env: 'sandbox' });
  const res2 = await post(base, { body: body2, auth: authHeader({ rawBody: Buffer.from(body2) }) });
  assert.equal(res2.status, 202, 'a different recipient token must not be throttled by another token\'s limit');
  await svc.close();
});

// ── 5. MISSING .p8 CONFIG → 503, the service stays up (does not crash).
test('with no APNs config a signed /wake returns 503 and the service keeps serving', async () => {
  const { base, svc, record } = await startService({ cfg: null });
  const body = JSON.stringify({ token: TOKEN, env: 'sandbox' });
  const res = await post(base, { body, auth: authHeader({ rawBody: Buffer.from(body) }) });
  assert.equal(res.status, 503, 'unconfigured service must answer 503, not crash');
  assert.equal(record.requests, 0, 'nothing can be sent with no key');
  // still serving: a second request also answers cleanly
  const res2 = await post(base, { body, auth: authHeader({ rawBody: Buffer.from(body) }) });
  assert.equal(res2.status, 503, 'the service is still up after the first 503');
  await svc.close();
});

// ── 6. DRIFT GUARD: the service's contentless payload must deep-equal apns-cli-lib's buildPayload() (§15.2).
test('the service contentless payload never diverges from apns-cli-lib buildPayload()', () => {
  assert.deepEqual(contentlessPayload(), libBuildPayload(), 'the service payload drifted from the §15.2 contract');
});

// ── 7. PRIVACY: across a run of sends + rejects, NO device token and NO 64-hex pubkey appears in the service log.
test('the service log never contains a device token or a 64-hex pubkey', async () => {
  const { base, svc, log } = await startService({ tokenLimit: 1, tokenWindowMs: 60000 });
  const body = JSON.stringify({ token: TOKEN, env: 'sandbox' });
  await post(base, { body, auth: authHeader({ rawBody: Buffer.from(body) }) });   // accepted + sent
  await post(base, { body, auth: authHeader({ rawBody: Buffer.from(body) }) });   // rate-limited
  await post(base, { body });                                                     // unsigned (401)
  await post(base, { body: JSON.stringify({ token: TOKEN, env: 'sandbox', content: 'x' }), auth: authHeader({ rawBody: Buffer.from(JSON.stringify({ token: TOKEN, env: 'sandbox', content: 'x' })) }) });
  for (let i = 0; i < 50 && log.length < 1; i++) await new Promise(r => setTimeout(r, 5));
  await new Promise(r => setTimeout(r, 20));
  const text = log.join('\n');
  assert.ok(log.length > 0, 'the service should have logged coarse status lines');
  assert.ok(!text.includes(TOKEN), 'the device token leaked into the log');
  assert.ok(!text.includes(RELAY.pub), 'the relay pubkey leaked into the log');
  assert.equal(/[0-9a-f]{64}/i.test(text), false, 'a 64-hex token/pubkey leaked into the log');
  await svc.close();
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// CONNECTION POOL + PER-SEND TIMEOUT for the SERVICE's makePooledSender (scripts/push-service.mjs).
//
// These five cases were the whole of scripts/apns-sender-pooling.test.mjs, which covered the pool/timeout on the
// RELAY's old makeApnsSender. When the APNs sender moved to the central key-holding service (commit cc890548) that
// file was deleted and its coverage was NOT re-created against the service's port — so the pool/timeout behaviour on
// the ONE box that now holds the .p8 was left untested. This restores it, driving the SERVICE's makePooledSender
// directly through its injectable `connect` transport (the same mock mechanism apnsMock uses above):
//   makePooledSender(cfg, { connect, log, reqTimeoutMs, idleTimeoutMs }) -> { send(token, env), counters, sessionCount() }.
//
// SABOTAGE-VERIFIED 2026-11-26 (scoped to makePooledSender in push-service.mjs, reverted after):
//   neuter the per-send setTimeout teardown           -> §8 (timeout) goes red (request/session never torn down).
//   make getSession always connect (drop reuse)       -> §9 (reuse) goes red (2 connects, not 1).
//   drop the session.on('close', drop) wiring         -> §11 (reconnect) goes red (a dead session is reused).
const flush = () => new Promise(r => setImmediate(r));

// A pooled-transport mock: counts connects / requests / closes / destroys per session and records the dialled
// authority. `answer:false` yields a session that connects and accepts the request but NEVER responds — the silent
// connection the per-send timeout must tear down. The shape (EventEmitter session with request()/close()/destroy(),
// EventEmitter req with end()/destroy()) matches what makePooledSender.send drives.
function poolMock(record, { answer = true, status = 200 } = {}) {
  record.connects = 0; record.requests = 0; record.closed = 0; record.destroyed = 0; record.reqDestroyed = 0;
  record.authorities = []; record.lastSession = null;
  return (authority) => {
    record.connects++;
    record.authorities.push(authority);
    const session = new EventEmitter();
    session.close = () => { record.closed++; };
    session.destroy = () => { record.destroyed++; };
    record.lastSession = session;
    session.request = () => {
      record.requests++;
      const req = new EventEmitter();
      req.destroy = () => { record.reqDestroyed++; };
      req.end = () => {
        if (!answer) return;   // SILENT: connects, accepts the request, never answers.
        setImmediate(() => { req.emit('response', { ':status': status }); req.emit('data', Buffer.from('')); req.emit('end'); });
      };
      return req;
    };
    return session;
  };
}

const HEXTOK_A = 'ab'.repeat(32), HEXTOK_B = 'cd'.repeat(32), HEXTOK_C = 'ef'.repeat(32);

// ── 8. TIMEOUT CLEANUP: a silent session (connects, never answers) is torn down by the per-send timeout — the request
// is destroyed, the session closed and dropped from the pool, the timeout counted, and nothing throws out of send().
test('makePooledSender: a silent APNs connection is torn down by the per-send timeout (request destroyed, session dropped, no throw)', async () => {
  const rec = {};
  const sender = makePooledSender(CFG, { connect: poolMock(rec, { answer: false }), reqTimeoutMs: 40 });
  assert.doesNotThrow(() => sender.send(HEXTOK_A, 'production'), 'a silent send threw out of makePooledSender');
  // Our OWN deadline (far shorter than any real hang) — a MISSING timeout fails deterministically instead of hanging.
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && !(rec.reqDestroyed && rec.closed)) { await flush(); await new Promise(r => setTimeout(r, 10)); }
  assert.ok(rec.reqDestroyed >= 1, 'the timeout did not destroy the stalled request (the leak is not closed)');
  assert.ok(rec.closed >= 1, 'the timeout did not close the silent session (the session would leak)');
  assert.equal(sender.sessionCount(), 0, 'the silent session was not dropped from the pool after timeout');
  assert.equal(sender.counters.timeout, 1, 'the timeout was not counted');
  assert.equal(sender.counters.ok, 0, 'a silent send must not count as ok');
});

// ── 9. REUSE SAME ORIGIN: two sends to the same environment reuse ONE pooled session (connect once, request twice).
test('makePooledSender: two sends to the same origin reuse a single pooled session (one connect, two requests)', async () => {
  const rec = {};
  const sender = makePooledSender(CFG, { connect: poolMock(rec, { answer: true }) });
  sender.send(HEXTOK_A, 'production');
  await flush(); await flush();
  sender.send(HEXTOK_B, 'production');
  await flush(); await flush();
  assert.equal(rec.connects, 1, 'the second same-origin send opened a NEW session instead of reusing the pooled one');
  assert.equal(rec.requests, 2, 'both sends should have been dispatched on the pooled session');
  assert.equal(sender.sessionCount(), 1, 'the pool should hold exactly one session for the origin');
});

// ── 10. SEPARATE ORIGINS: a production send and a sandbox send use SEPARATE pooled sessions (two connects, two hosts).
test('makePooledSender: production and sandbox tokens use separate pooled sessions (different Apple hosts)', async () => {
  const rec = {};
  const sender = makePooledSender(CFG, { connect: poolMock(rec, { answer: true }) });
  sender.send(HEXTOK_A, 'production');
  await flush(); await flush();
  sender.send(HEXTOK_A, 'sandbox');
  await flush(); await flush();
  assert.equal(rec.connects, 2, 'prod and sandbox must not share a session — they are different Apple hosts');
  assert.deepEqual(new Set(rec.authorities), new Set(['https://api.push.apple.com', 'https://api.sandbox.push.apple.com']),
    'the two sessions did not go to the prod and sandbox hosts');
  assert.equal(sender.sessionCount(), 2, 'the pool should hold one session per origin');
});

// ── 11. RECONNECT AFTER CLOSE: once a cached session emits 'close' the pool evicts it and the next send reconnects.
test('makePooledSender: after a pooled session closes, the next send reconnects with a new session', async () => {
  const rec = {};
  const sender = makePooledSender(CFG, { connect: poolMock(rec, { answer: true }) });
  sender.send(HEXTOK_A, 'production');
  await flush(); await flush();
  assert.equal(rec.connects, 1, 'the first send should open one session');
  rec.lastSession.emit('close');   // Apple drops the connection (the real 'close'/'goaway'/'error' the pool drops on)
  assert.equal(sender.sessionCount(), 0, 'a closed session was not evicted from the pool');
  sender.send(HEXTOK_A, 'production');
  await flush(); await flush();
  assert.equal(rec.connects, 2, 'the send after a close did not reconnect (it reused a dead session)');
  assert.equal(sender.sessionCount(), 1, 'the pool should hold the reconnected session');
});

// ── 12. NEVER THROWS INTO INGEST / STILL CONTENTLESS: an erroring transport does not throw out of send(), the error
// is counted, the session is dropped, and the body put on the wire is still the exact §15.2 contentless payload.
test('makePooledSender: a transport that errors mid-send never throws out of send() and the body stays contentless', async () => {
  let sentBody = null;
  const errTransport = () => {
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
  const sender = makePooledSender(CFG, { connect: errTransport });
  assert.doesNotThrow(() => sender.send(HEXTOK_A, 'production'), 'a mid-send error threw out of makePooledSender');
  await flush(); await flush();
  assert.deepEqual(JSON.parse(sentBody), libBuildPayload(), 'the body on the wire drifted from the contentless §15.2 payload');
  assert.ok(sender.counters.err >= 1, 'the mid-send error was not counted');
  assert.equal(sender.sessionCount(), 0, 'the errored session was not dropped from the pool');
});
