// THE REAL CONTENTLESS APNs SEND PATH — PHASE 3 of the iOS APNs feature (relay side). Run:
//   node --test scripts/apns-contentless-sender.test.mjs
//
// Phase 1 added the token REGISTRY, Phase 2 the ingest PUSH HOOK (maybePushNotify) and the SEAM
// (sendContentlessPush -> _pushSender). This phase implements the real APNs sender behind that seam: an ES256
// JWT (crypto) + a contentless HTTP/2 POST to Apple (http2), both Node built-ins, no new npm dependency.
//
// POINT OF USE (CLAUDE.md #1, #3): every assertion runs the SHIPPED gateway.mjs source, lifted by brace-match
// (test-slice.mjs), never a mirror and never a text-match. The whole Phase-3 block (builders + config + JWT cache
// + injectable transport + the sender) and the real canRead/maybePushNotify gating are lifted into one scope and
// RUN. The HTTP/2 transport is injected (a mock), so a send is observed exactly as it would hit Apple, with no
// network call and NO live Apple credentials (which do not exist yet — the .p8 / entitlement are owner-pending).
//
// WHAT EACH CASE PINS, and each FAILS if its feature is deleted (sabotage-verified 2026-11-26, scoped to the
// function under test):
//   buildPayload   — the payload is CONTENTLESS and matches the §15.2 contract exactly.
//                    SABOTAGE: add a `body`/content field to buildPayload            -> red.
//   apnsUrl        — production vs sandbox routing.
//                    SABOTAGE: swap the two hosts in apnsUrl                         -> red.
//   buildJwt       — a real ES256 JWT, verifiable with a GENERATED P-256 public key; header.kid, claims.iss/iat.
//                    SABOTAGE: alg 'HS256' / wrong iss in buildJwt                   -> red.
//   seam+gating    — a live kind-4 A->B DM through maybePushNotify + the seam + the real sender hits the mock
//                    transport ONCE, for B's token, with the right URL/topic/headers/contentless body; the
//                    SENDER A, a token-holder C who is not the ['p'] target, and a tokenless target N get nothing.
//                    SABOTAGE: drop `if (pub === e.pubkey) continue;` in maybePushNotify -> red (sender pushed).
//   config absent  — readApnsConfig returns null (no throw) when env is incomplete; an unwired seam sends nothing.
//                    SABOTAGE: make readApnsConfig throw on an absent key             -> red.
//   F2 no-graph    — the sender's log output during a (mock) send carries NO pubkey and NO {from,to} pair.
//                    SABOTAGE: make _apnsNote log the recipient pubkey               -> red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { generateKeyPairSync, createPublicKey, verify as nodeVerify, createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { decode as nip19decode } from 'nostr-tools/nip19';
import { fnBody, stmt } from './test-slice.mjs';

const GW = readFileSync(new URL('../scripts/gateway.mjs', import.meta.url), 'utf8');
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

// ── Assemble the REAL shipped Phase-3 send path + the real canRead/maybePushNotify gating into one scope and
// RUN it. Empty safeguarding state (no minors, no blocks, no churches) exercises canRead's kind-4 DM-narrowing —
// `authed === e.pubkey || authed === targetHex` — which is the "wrong token-holders get nothing" gating; the
// minor/block/room bars are proven over FULL state by a-new-message-pushes-only-to-readers-who-can-see-it.test.mjs
// (the spawned Phase-2 test). http2Connect is handed in but overridden by setTransport, so Apple is never dialled.
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
      ' buildPayload, apnsUrl, _b64url, buildJwt, buildHeaders, readApnsConfig, _apnsJwtCached, makeApnsSender,' +
      ' sendContentlessPush, maybePushNotify, canRead,' +
      ' getCounters: () => _apnsCounters,' +
      ' setPushSender: (f) => { _pushSender = f; },' +
      ' setTransport: (f) => { _apnsH2Connect = f; },' +
      ' setLog: (f) => { _apnsLog = f; } };'
  )(
    () => { throw new Error('the real http2 transport was dialled — a test forgot setTransport()'); },
    createPrivateKey, cryptoSign, readFileSync, nip19decode, NET,
    TOKENS_BY_PUB, new Map(), new Map(), new Map(), new Set(),
  );
  api.TOKENS_BY_PUB = TOKENS_BY_PUB;
  return api;
}

// A mock HTTP/2 transport: records the authority, request headers and body, then (async, like the real one)
// answers with a status. Shaped exactly like the subset makeApnsSender uses: connect()->session.request()->req.
function mockTransport(record, status = 200) {
  return (authority) => {
    const session = new EventEmitter();
    session.close = () => { record.closed = (record.closed || 0) + 1; };
    session.request = (headers) => {
      record.calls = (record.calls || 0) + 1;
      record.authority = authority;
      record.headers = headers;
      const req = new EventEmitter();
      req.end = (body) => {
        record.body = body;
        setImmediate(() => { req.emit('response', { ':status': status }); req.emit('data', Buffer.from('')); req.emit('end'); });
      };
      return req;
    };
    return session;
  };
}

// A generated P-256 keypair standing in for the owner-pending Apple .p8 — enough to prove the JWT path end to end.
function testKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { pem: privateKey.export({ type: 'pkcs8', format: 'pem' }), pub: publicKey };
}
const CFG = (() => { const k = testKeypair(); return { keyPem: k.pem, pub: k.pub, keyId: 'ABC1234DEF', teamId: 'TEAM789XYZ', topic: 'com.trinityone.app' }; })();
const flush = () => new Promise(r => setImmediate(r));

// ── buildPayload: CONTENTLESS, matches §15.2 exactly ────────────────────────────────────────────────────────
test('buildPayload is the exact contentless §15.2 payload — no body, no sender, no church, no content-available', () => {
  const { buildPayload } = assemble();
  const p = buildPayload();
  assert.deepEqual(p, { aps: { alert: { title: 'TrinityOne', body: 'New message' }, sound: 'default', 'thread-id': 'trinityone-msgs' } },
    'the contentless payload drifted from the §15.2 contract');
  const flat = JSON.stringify(p).toLowerCase();
  // "body" is a legitimate STATIC alert field now ("New message", owner 2026-11-26); the deepEqual above pins its
  // EXACT value, so real message content cannot ride in it. Still forbid dynamic content / graph metadata:
  for (const forbidden of ['content-available', '"from"', '"sender"', '"church"', '"name"', '"text"']) {
    assert.ok(!flat.includes(forbidden), `the payload leaked ${forbidden} — it must carry no message content and no graph metadata`);
  }
});

// ── apnsUrl: production vs sandbox ──────────────────────────────────────────────────────────────────────────
test('apnsUrl routes production and sandbox tokens to the right Apple host', () => {
  const { apnsUrl } = assemble();
  assert.equal(apnsUrl('TOK', 'production'), 'https://api.push.apple.com/3/device/TOK', 'production did not route to api.push.apple.com');
  assert.equal(apnsUrl('TOK', 'sandbox'), 'https://api.sandbox.push.apple.com/3/device/TOK', 'sandbox did not route to api.sandbox.push.apple.com');
  // anything that is not the literal 'sandbox' is production (a token with no/garbage env must not go to sandbox)
  assert.equal(apnsUrl('TOK', ''), 'https://api.push.apple.com/3/device/TOK', 'an empty env must default to production');
});

// ── buildJwt: a real ES256 JWT verifiable with a GENERATED public key ───────────────────────────────────────
test('buildJwt produces an ES256 JWT with the right header(kid) and claims(iss,iat), verifiable by the public key', () => {
  const { buildJwt } = assemble();
  const iat = now();
  const jwt = buildJwt(CFG.keyPem, CFG.keyId, CFG.teamId, iat);
  const [h, c, s] = jwt.split('.');
  assert.ok(h && c && s, 'the JWT is not three dot-separated segments');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
  assert.equal(header.alg, 'ES256', 'the JWT header alg is not ES256');
  assert.equal(header.kid, CFG.keyId, 'the JWT header kid is not the APNs key id');
  assert.equal(claims.iss, CFG.teamId, 'the JWT iss claim is not the Apple team id');
  assert.equal(claims.iat, iat, 'the JWT iat claim is not the issued-at second');
  // The signature verifies against the matching PUBLIC key — the proof it is a real ES256 signature, not bytes.
  const ok = nodeVerify('sha256', Buffer.from(h + '.' + c), { key: CFG.pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  assert.ok(ok, 'the ES256 signature does not verify against the generated P-256 public key');
  // And a tampered claim does NOT verify (so the check above is not vacuous).
  const bad = nodeVerify('sha256', Buffer.from(h + '.' + c + 'x'), { key: CFG.pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  assert.ok(!bad, 'a tampered signing input still verified — the verify step proves nothing');
});

// ── buildHeaders: the APNs request headers ──────────────────────────────────────────────────────────────────
test('buildHeaders carries bearer auth, the topic, alert push-type, priority 10 and the collapse id', () => {
  const { buildHeaders } = assemble();
  const h = buildHeaders('JWTVALUE', 'com.trinityone.app');
  assert.equal(h['authorization'], 'bearer JWTVALUE', 'authorization is not a bearer JWT');
  assert.equal(h['apns-topic'], 'com.trinityone.app', 'apns-topic is wrong');
  assert.equal(h['apns-push-type'], 'alert', 'apns-push-type must be alert for a contentless user-facing wake');
  assert.equal(h['apns-priority'], '10', 'apns-priority must be 10');
  assert.equal(h['apns-collapse-id'], 'trinityone-msgs', 'apns-collapse-id must coalesce a burst into one New message');
});

// ── END-TO-END through the seam with a MOCK transport + the real gating ─────────────────────────────────────
test('a live kind-4 A->B DM through maybePushNotify + the real sender hits the mock ONCE, for B, contentless', async () => {
  const api = assemble();
  const A = K(), B = K(), C = K(), N = K();
  // B and C hold tokens; N does not. C is NOT the ['p'] target of A->B, so canRead must withhold it.
  api.TOKENS_BY_PUB.set(B.pub, { token: 'tok-B', platform: 'ios', env: 'prod' });
  api.TOKENS_BY_PUB.set(C.pub, { token: 'tok-C', platform: 'ios', env: 'prod' });
  api.TOKENS_BY_PUB.set(A.pub, { token: 'tok-A', platform: 'ios', env: 'prod' });   // the SENDER holds a token too
  const rec = {};
  api.setTransport(mockTransport(rec, 200));
  api.setPushSender(api.makeApnsSender(CFG));

  const dm = finalizeEvent({ kind: 4, created_at: now(), tags: [['p', B.pub], ['t', NET]], content: 'ciphertext' }, A.sk);
  api.maybePushNotify(dm);
  await flush(); await flush();

  assert.equal(rec.calls, 1, 'exactly one APNs request should be made (for B) — got ' + (rec.calls || 0));
  assert.equal(rec.authority, 'https://api.push.apple.com', 'the request did not go to the production APNs host');
  assert.equal(rec.headers[':method'], 'POST', 'the APNs request is not a POST');
  assert.equal(rec.headers[':path'], '/3/device/tok-B', 'the request path is not B\'s token (sender/bystander/tokenless leaked in?)');
  assert.equal(rec.headers['apns-topic'], 'com.trinityone.app', 'the apns-topic is wrong on the wire');
  assert.equal(rec.headers['apns-push-type'], 'alert', 'the apns-push-type is wrong on the wire');
  assert.equal(rec.headers['apns-priority'], '10', 'the apns-priority is wrong on the wire');
  assert.equal(rec.headers['apns-collapse-id'], 'trinityone-msgs', 'the collapse id is wrong on the wire');
  assert.match(rec.headers['authorization'], /^bearer eyJ/, 'the authorization is not a bearer JWT');
  assert.deepEqual(JSON.parse(rec.body), { aps: { alert: { title: 'TrinityOne', body: 'New message' }, sound: 'default', 'thread-id': 'trinityone-msgs' } },
    'the body on the wire is not the contentless payload');
  // NOTHING else: not the sender A, not the bystander C, not the tokenless N.
  assert.ok(!rec.body || rec.headers[':path'] === '/3/device/tok-B', 'a non-recipient token was dialled');
  assert.equal(api.getCounters().sent, 1, 'the sender counted more than the single eligible recipient');
  assert.equal(api.getCounters().ok, 1, 'a 200 from APNs was not counted as ok');
});

// A sandbox token routes to the sandbox host (direct through the seam, same sender).
test('a sandbox-env token routes the send to the sandbox APNs host', async () => {
  const api = assemble();
  const A = K(), B = K();
  const rec = {};
  api.setTransport(mockTransport(rec, 200));
  api.setPushSender(api.makeApnsSender(CFG));
  const dm = finalizeEvent({ kind: 4, created_at: now(), tags: [['p', B.pub]], content: 'x' }, A.sk);
  api.sendContentlessPush(B.pub, { token: 'tok-sb', env: 'sandbox' }, dm);
  await flush(); await flush();
  assert.equal(rec.authority, 'https://api.sandbox.push.apple.com', 'a sandbox token did not route to the sandbox host');
  assert.equal(rec.headers[':path'], '/3/device/tok-sb', 'the sandbox request path is wrong');
});

// ── CONFIG ABSENT: readApnsConfig returns null gracefully; an unwired seam sends nothing ────────────────────
test('config absent => readApnsConfig returns null (no throw) and the unwired seam sends nothing, no crash', async () => {
  const api = assemble();
  // Fully absent, and each partial combination — none may throw, all must be null.
  assert.equal(api.readApnsConfig({}), null, 'an empty env should yield null config');
  assert.equal(api.readApnsConfig({ TRINITY_APNS_KEY_ID: 'x', TRINITY_APNS_TEAM_ID: 'y' }), null, 'a missing key FILE should yield null');
  assert.equal(api.readApnsConfig({ TRINITY_APNS_KEY_FILE: '/nonexistent/key.p8', TRINITY_APNS_KEY_ID: 'x', TRINITY_APNS_TEAM_ID: 'y' }), null, 'an unreadable key file should yield null, not throw');
  // A readable but malformed key file is also a null (startup no-op), not a per-push throw.
  const dir = mkdtempSync(join(tmpdir(), 'trin-apns-cfg-'));
  try {
    const bad = join(dir, 'bad.p8'); writeFileSync(bad, 'not a key');
    assert.equal(api.readApnsConfig({ TRINITY_APNS_KEY_FILE: bad, TRINITY_APNS_KEY_ID: 'x', TRINITY_APNS_TEAM_ID: 'y' }), null, 'a malformed .p8 should yield null');
    // A COMPLETE, valid config parses (so the null results above are a decision, not a blanket failure).
    const good = join(dir, 'good.p8'); writeFileSync(good, CFG.keyPem);
    const cfg = api.readApnsConfig({ TRINITY_APNS_KEY_FILE: good, TRINITY_APNS_KEY_ID: 'kid', TRINITY_APNS_TEAM_ID: 'team' });
    assert.ok(cfg && cfg.keyId === 'kid' && cfg.topic === 'com.trinityone.app', 'a complete, valid config did not load');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  // Unwired seam (the production reality today): nothing is dialled, nothing throws.
  const rec = {};
  api.setTransport(mockTransport(rec, 200));   // present but must never be reached
  const A = K(), B = K();
  const dm = finalizeEvent({ kind: 4, created_at: now(), tags: [['p', B.pub]], content: 'x' }, A.sk);
  assert.doesNotThrow(() => api.sendContentlessPush(B.pub, { token: 'tok', env: 'prod' }, dm), 'an unwired seam threw');
  await flush();
  assert.equal(rec.calls || 0, 0, 'the seam dialled the transport although no sender is wired (config absent)');
});

// ── F2: the sender logs COUNTS/codes only — never a pubkey, never a {from,to} pair ──────────────────────────
test('F2: the sender logs no pubkey and no communication-graph pair during a send (counts/codes only)', async () => {
  const A = K(), B = K();
  const dm = finalizeEvent({ kind: 4, created_at: now(), tags: [['p', B.pub]], content: 'x' }, A.sk);
  const logs = [];
  const run = async (status) => {
    const api = assemble();
    api.setLog((m) => logs.push(String(m)));
    api.setTransport(mockTransport({}, status));
    api.setPushSender(api.makeApnsSender(CFG));
    api.sendContentlessPush(B.pub, { token: 'tok-B', env: 'prod' }, dm);
    await flush(); await flush();
  };
  await run(200);   // ok path
  await run(410);   // error path (a 410 would mean dead token; still code-only logging)
  await run(400);
  assert.ok(logs.length > 0, 'the sender logged nothing at all during a send — F2 would be vacuous');
  const hay = logs.join('\n');
  const hex = new RegExp('[0-9a-f]{64}');
  assert.ok(!hex.test(hay), 'a 64-hex pubkey appeared in the sender log — communication-graph metadata leaked: ' + JSON.stringify(logs));
  for (const p of [A.pub, B.pub, A.pub.slice(0, 16), B.pub.slice(0, 16)]) {
    assert.ok(!hay.includes(p), 'a recipient/sender pubkey appeared in the sender log: ' + JSON.stringify(logs));
  }
  for (const pair of ['"to"', '"from"', 'to:', 'from:']) {
    assert.ok(!hay.includes(pair), `the sender log carried a ${pair} field — a from/to pair is graph metadata: ` + JSON.stringify(logs));
  }
  assert.ok(!hay.includes('tok-B'), 'the device token appeared in the sender log');
});
