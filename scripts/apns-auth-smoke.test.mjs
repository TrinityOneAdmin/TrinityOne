// scripts/apns-auth-smoke.test.mjs — the no-device auth smoke check's status->verdict interpreter. Run:
//   node --test scripts/apns-auth-smoke.test.mjs
//
// apns-auth-smoke.mjs sends the contentless payload to a BOGUS token at each host and interprets Apple's reply. The
// interpretation is a PURE function (verdict) so it is testable with synthetic responses — no network, no .p8.
// Importing the module must NOT fire a send; the CLI's main() is behind an import.meta entry-point guard.
//
// WHAT EACH CASE PINS (sabotage-verified 2026-11-26, scoped to verdict()):
//   400 BadDeviceToken      -> creds-valid  (ok): auth passed, the bogus DEVICE was rejected as expected.
//   410                     -> creds-valid  (ok).
//   403 InvalidProviderToken-> creds-invalid (not ok): key/keyId/team wrong.
//   401                     -> creds-invalid (not ok).
//   403 TopicDisallowed     -> topic-wrong  (not ok).
//   200 (bogus token)       -> unexpected   (not ok): a bogus token must never be accepted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './apns-auth-smoke.mjs';

test('400 BadDeviceToken => CREDS VALID (auth passed, device rejected)', () => {
  const v = verdict(400, 'BadDeviceToken');
  assert.equal(v.kind, 'creds-valid');
  assert.equal(v.ok, true);
  assert.match(v.text, /CREDS VALID/);
});

test('410 => CREDS VALID (auth passed)', () => {
  const v = verdict(410, 'Unregistered');
  assert.equal(v.kind, 'creds-valid');
  assert.equal(v.ok, true);
});

test('403 InvalidProviderToken => CREDS INVALID', () => {
  const v = verdict(403, 'InvalidProviderToken');
  assert.equal(v.kind, 'creds-invalid');
  assert.equal(v.ok, false);
  assert.match(v.text, /CREDS INVALID/);
});

test('403 ExpiredProviderToken and 401 both => CREDS INVALID', () => {
  assert.equal(verdict(403, 'ExpiredProviderToken').kind, 'creds-invalid');
  assert.equal(verdict(403, 'ExpiredProviderToken').ok, false);
  assert.equal(verdict(401, 'MissingProviderToken').kind, 'creds-invalid');
  assert.equal(verdict(401, 'MissingProviderToken').ok, false);
});

test('403 TopicDisallowed => TOPIC WRONG', () => {
  const v = verdict(403, 'TopicDisallowed');
  assert.equal(v.kind, 'topic-wrong');
  assert.equal(v.ok, false);
  assert.match(v.text, /TOPIC WRONG/);
});

test('200 for a bogus token => UNEXPECTED (never ok — a bogus token must not be accepted)', () => {
  const v = verdict(200, '');
  assert.equal(v.kind, 'unexpected');
  assert.equal(v.ok, false);
});

test('an unmapped reply is UNEXPECTED and prints the raw status/reason', () => {
  const v = verdict(429, 'TooManyRequests');
  assert.equal(v.kind, 'unexpected');
  assert.equal(v.ok, false);
  assert.match(v.text, /429/);
  assert.match(v.text, /TooManyRequests/);
});
