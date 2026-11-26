// scripts/apns-cli-lib.test.mjs — the STANDALONE APNs CLI lib. Run:
//   node --test scripts/apns-cli-lib.test.mjs
//
// apns-cli-lib.mjs REPLICATES the §15.2 contract (buildPayload / apnsUrl / buildHeaders) rather than importing the
// gateway (importing gateway.mjs boots the relay). These tests make sure the replica cannot silently drift from the
// SHIPPED sender, and that the JWT the lib mints is a real, verifiable ES256 token.
//
// WHAT EACH CASE PINS, and each FAILS if its feature regresses (sabotage-verified 2026-11-26, scoped):
//   drift: payload  — lib buildPayload() deep-equals the gateway's shipped buildPayload() (lifted + run), AND equals
//                     the literal §15.2 contract. SABOTAGE: add a field to the lib payload -> red.
//   drift: url      — lib apnsUrl() matches the gateway's for production + sandbox. SABOTAGE: swap hosts -> red.
//   drift: headers  — lib buildHeaders() deep-equals the gateway's. SABOTAGE: drop apns-collapse-id -> red.
//   jwt shape       — buildJwt mints an ES256 JWT verifiable with a GENERATED P-256 public key; header.kid,
//                     claims.iss/iat. SABOTAGE: alg 'HS256' / wrong iss -> red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync, verify as nodeVerify } from 'node:crypto';
import { buildPayload, apnsUrl, buildHeaders, buildJwt } from './apns-cli-lib.mjs';
import { fnBody } from './test-slice.mjs';

const GW = readFileSync(new URL('../scripts/gateway.mjs', import.meta.url), 'utf8');
const now = () => Math.floor(Date.now() / 1000);

// Lift the gateway's OWN contract functions out of the shipped source and run them — never a mirror, never a
// text-match. If the gateway's payload/url/headers change, these return the new value and the deepEqual goes red.
function liftGateway() {
  const src = [
    fnBody(GW, 'function buildPayload() {', 'buildPayload'),
    fnBody(GW, 'function apnsUrl(token, env) {', 'apnsUrl'),
    fnBody(GW, 'function buildHeaders(jwt, topic) {', 'buildHeaders'),
  ].join('\n');
  return new Function(src + '\nreturn { buildPayload, apnsUrl, buildHeaders };')();
}

// ── DRIFT GUARD: payload ──────────────────────────────────────────────────────────────────────────────────────
test('drift: the lib contentless payload deep-equals the gateway\'s shipped payload AND the §15.2 literal', () => {
  const gw = liftGateway();
  assert.deepEqual(buildPayload(), gw.buildPayload(),
    'the CLI lib payload drifted from the shipped gateway buildPayload() — they must stay identical');
  assert.deepEqual(buildPayload(), { aps: { alert: { 'loc-key': 'NEW_MESSAGE' }, sound: 'default', 'thread-id': 'trinityone-msgs' } },
    'the CLI lib payload drifted from the §15.2 contract literal');
  // And it carries no content / graph metadata.
  const flat = JSON.stringify(buildPayload()).toLowerCase();
  for (const forbidden of ['"body"', 'content-available', '"from"', '"sender"', '"church"', '"name"', '"text"']) {
    assert.ok(!flat.includes(forbidden), `the payload leaked ${forbidden}`);
  }
});

// ── DRIFT GUARD: url ──────────────────────────────────────────────────────────────────────────────────────────
test('drift: the lib apnsUrl matches the gateway\'s for production and sandbox', () => {
  const gw = liftGateway();
  for (const env of ['production', 'sandbox', '']) {
    assert.equal(apnsUrl('TOK', env), gw.apnsUrl('TOK', env), 'apnsUrl drifted for env=' + JSON.stringify(env));
  }
  assert.equal(apnsUrl('TOK', 'production'), 'https://api.push.apple.com/3/device/TOK');
  assert.equal(apnsUrl('TOK', 'sandbox'), 'https://api.sandbox.push.apple.com/3/device/TOK');
});

// ── DRIFT GUARD: headers ──────────────────────────────────────────────────────────────────────────────────────
test('drift: the lib buildHeaders deep-equals the gateway\'s', () => {
  const gw = liftGateway();
  assert.deepEqual(buildHeaders('JWT', 'com.trinityone.app'), gw.buildHeaders('JWT', 'com.trinityone.app'),
    'the CLI lib headers drifted from the shipped gateway buildHeaders()');
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
