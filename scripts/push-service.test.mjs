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
import { createPushService, contentlessPayload, WAKE_PATH, NIP98_KIND } from './push-service.mjs';
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
