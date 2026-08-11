// BLOCKING SOMEONE MUST ACTUALLY TAKE THE KEY AWAY. Run: node --test scripts/key-rotation-size.test.mjs
//
// THE DEFECT (Fable verification audit, 2026-08-10). When a church blocks a member, the console rotates the
// care key and the media key: it mints a new key and republishes one document holding a sealed copy for every
// REMAINING member. The blocked person is not in that list, so from then on nothing new opens for them.
//
// The document is one relay message, and the relay caps a message at 1 MB (gateway.mjs, maxPayload). Measured
// here: a 12-key ring costs ~1,452 bytes per member once sealed, so the document crosses 1 MB at about 723
// members and the relay refuses it.
//
// It was refused SILENTLY. The console called rotateCareKey/rotateMediaKey without awaiting them and without
// reading their result, so a large church saw "blocked" while the member kept the key — which is the entire
// point of the operation, failing quietly, in the direction of leaving someone access they should not have.
//
// THE TRADE-OFF, stated because it is a real one: the ring carries superseded keys so that things sealed
// earlier still open. Trimming it costs access to OLDER sealed care records. Not rotating costs the removal
// itself. The removal wins — so the ring shrinks until the document fits, and says so when it does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/steward.src.js', import.meta.url), 'utf8');
const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

// The real arithmetic, so the threshold in the comments above can be re-derived rather than believed.
const RING_KEY_HEX = 64;
const sealedBytes = (ringLen) => {
  const plaintext = JSON.stringify(Array.from({ length: ringLen }, () => 'a'.repeat(RING_KEY_HEX))).length;
  const padded = Math.pow(2, Math.ceil(Math.log2(plaintext)));      // nip44 pads to a power of two
  return Math.ceil((1 + 32 + padded + 32) * 4 / 3);                 // version + nonce + padded + mac, base64
};
const docBytes = (members, ringLen) => members * (RING_KEY_HEX + sealedBytes(ringLen) + 6);

test('the 1 MB ceiling is real, and a full ring hits it in a large church', () => {
  assert.ok(docBytes(500, 12) < 1024 * 1024, 'a 500-member church should still fit a full ring');
  assert.ok(docBytes(750, 12) > 1024 * 1024,
    'the arithmetic behind this whole fix no longer holds — re-measure before trusting the comments');
});

test('shrinking the ring is what makes a large church fit', () => {
  assert.ok(docBytes(1000, 12) > 900000, 'a 1,000-member church with a full ring must not fit, or there is nothing to solve');
  assert.ok(docBytes(1000, 1) < 900000,
    'even a single-key ring will not fit 1,000 members, so trimming cannot be the answer and the document ' +
    'needs splitting instead — the code refuses loudly in that case, and this test should be updated with it');
});

test('rotation trims the ring rather than giving up', () => {
  const at = SRC.indexOf('async rotateCareKey(');
  const body = SRC.slice(at, SRC.indexOf('\n  },', at));
  assert.match(body, /while \(ring\.length >= 1\)/,
    'rotation builds one envelope and publishes it. On a church past ~723 members the relay refuses it and ' +
    'the blocked member keeps the care key');
  assert.match(body, /ring = ring\.slice\(0, Math\.max\(1, ring\.length - 2\)\)/, 'nothing actually shrinks the ring');
  assert.match(body, /ring\.length < 12.*trimmed/s,
    'the ring is trimmed silently — a church losing access to older sealed care records should be told');
  assert.match(body, /return false;/, 'a rotation that cannot be made to fit must report failure, not pretend');
});

test('the console notices a rotation that did not land, and shows it', () => {
  assert.match(DASH, /rotations\.push\(Promise\.resolve\(window\.Steward\.rotateCareKey\(/,
    'the console still fires rotation and forgets it — a failure cannot be noticed if it is never awaited');
  assert.match(DASH, /setBlockWarn\(/, 'nothing records a failed rotation');
  assert.match(DASH, /\{blockWarn \?/,
    'the failure is recorded into state that is never rendered. That exact mistake made the safety-check ' +
    'warning unreachable three times — the steward believes the person is out, and this is the only thing ' +
    'that says otherwise');
});

test('the shipped console carries it', () => {
  assert.match(VENDOR, /care key ring trimmed/,
    'vendor/steward.js predates this fix — run bash scripts/build-steward.sh');
});
