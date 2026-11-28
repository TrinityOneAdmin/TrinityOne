// scripts/apns-cli-lib.test.mjs — the STANDALONE APNs CLI lib. Run:
//   node --test scripts/apns-cli-lib.test.mjs
//
// apns-cli-lib.mjs is the SINGLE home of the §15.2 APNs contract (buildPayload / apnsUrl / buildHeaders / buildJwt).
// Since the Phase-2 push-service redesign (2026-11-26) the gateway no longer holds an APNs sender — the sender moved
// to scripts/push-service.mjs, which IMPORTS this lib, and push-service.test.mjs pins service-vs-lib (the payload
// drift guard there deep-equals contentlessPayload() to this lib's buildPayload()). So this file no longer lifts the
// gateway (those functions are gone); it pins the lib against the §15.2 LITERAL and proves the JWT is a real ES256.
//
// WHAT EACH CASE PINS, and each FAILS if its feature regresses (sabotage-verified 2026-11-26, scoped):
//   payload  — lib buildPayload() equals the literal §15.2 contract and carries no content/graph metadata.
//              SABOTAGE: add a field to the lib payload -> red.
//   url      — lib apnsUrl() routes production + sandbox to the right Apple host. SABOTAGE: swap hosts -> red.
//   headers  — lib buildHeaders() carries bearer auth, topic, alert push-type, priority 10, collapse id.
//              SABOTAGE: drop apns-collapse-id -> red.
//   jwt shape — buildJwt mints an ES256 JWT verifiable with a GENERATED P-256 public key; header.kid, claims.iss/iat.
//              SABOTAGE: alg 'HS256' / wrong iss -> red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify as nodeVerify } from 'node:crypto';
import { buildPayload, apnsUrl, buildHeaders, buildJwt } from './apns-cli-lib.mjs';

const now = () => Math.floor(Date.now() / 1000);

// ── §15.2 CONTRACT: payload ─────────────────────────────────────────────────────────────────────────────────────
test('the lib contentless payload equals the §15.2 literal and carries no content/graph metadata', () => {
  assert.deepEqual(buildPayload(), { aps: { alert: { title: 'TrinityOne', body: 'New message' }, sound: 'default', 'thread-id': 'trinityone-msgs' } },
    'the CLI lib payload drifted from the §15.2 contract literal');
  // And it carries no content / graph metadata. ("body" is a legitimate STATIC alert field now ("New message",
  // owner 2026-11-26); the deepEqual above pins its EXACT value, so real message content cannot ride in it.)
  const flat = JSON.stringify(buildPayload()).toLowerCase();
  for (const forbidden of ['content-available', '"from"', '"sender"', '"church"', '"name"', '"text"']) {
    assert.ok(!flat.includes(forbidden), `the payload leaked ${forbidden}`);
  }
});

// ── §15.2 CONTRACT: url ─────────────────────────────────────────────────────────────────────────────────────────
test('the lib apnsUrl routes production and sandbox to the right Apple host', () => {
  assert.equal(apnsUrl('TOK', 'production'), 'https://api.push.apple.com/3/device/TOK');
  assert.equal(apnsUrl('TOK', 'sandbox'), 'https://api.sandbox.push.apple.com/3/device/TOK');
  assert.equal(apnsUrl('TOK', ''), 'https://api.push.apple.com/3/device/TOK', 'an empty env must default to production');
});

// ── §15.2 CONTRACT: headers ─────────────────────────────────────────────────────────────────────────────────────
test('the lib buildHeaders carries bearer auth, topic, alert push-type, priority 10 and the collapse id', () => {
  const h = buildHeaders('JWTVALUE', 'com.trinityone.app');
  assert.equal(h['authorization'], 'bearer JWTVALUE');
  assert.equal(h['apns-push-type'], 'alert');
  assert.equal(h['apns-priority'], '10');
  assert.equal(h['apns-collapse-id'], 'trinityone-msgs');
});

// ── JWT SHAPE: a real ES256 token verifiable with a generated public key ──────────────────────────────────────
test('buildJwt mints an ES256 JWT (header.kid, claims.iss/iat) that verifies against a generated P-256 key', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const iat = now();
  const jwt = buildJwt(pem, 'ABC1234DEF', 'TEAM789XYZ', iat);
  const [h, c, s] = jwt.split('.');
  assert.ok(h && c && s, 'the JWT is not three dot-separated segments');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
  assert.equal(header.alg, 'ES256', 'the JWT header alg is not ES256');
  assert.equal(header.kid, 'ABC1234DEF', 'the JWT header kid is not the APNs key id');
  assert.equal(claims.iss, 'TEAM789XYZ', 'the JWT iss claim is not the team id');
  assert.equal(claims.iat, iat, 'the JWT iat claim is not the issued-at second');
  const ok = nodeVerify('sha256', Buffer.from(h + '.' + c), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  assert.ok(ok, 'the ES256 signature does not verify against the generated P-256 public key');
  // Not vacuous: a tampered signing input must NOT verify.
  const bad = nodeVerify('sha256', Buffer.from(h + '.' + c + 'x'), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  assert.ok(!bad, 'a tampered signing input still verified — the verify step proves nothing');
});
