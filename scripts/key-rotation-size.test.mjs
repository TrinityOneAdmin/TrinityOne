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
  assert.match(body, /for \(let n = full\.length; n >= 1;/,
    'rotation builds one envelope and publishes it. On a church past ~723 members the relay refuses it and ' +
    'the blocked member keeps the care key');
  // Sized by sealing ONE sample per candidate ring length, not by encrypting the whole church each time:
  // sealing costs ~5 ms per member on a workstation and several times that on a phone, so trial-encrypting
  // everyone per candidate turned a slow operation into an unusable one (measured: up to 48 s at 500).
  assert.match(body, /nip44e\(JSON\.stringify\(cand\), nip44ck\(sk, probe\)\)/,
    'the ring is sized by encrypting the entire church once per candidate length — that is quadratic in the ' +
    'thing that was already too slow');
  assert.doesNotMatch(body, /while \(ring\.length >= 1\)/, 'the trial-encrypt loop is back');
  assert.match(body, /per \* want\.length < 900000/,
    'the sample is measured but never compared against the ceiling, so the full ring is always chosen and ' +
    'the document is refused exactly as before — measuring without deciding is not a fix');
  assert.match(body, /ring\.length < full\.length.*trimmed/s,
    'the ring is trimmed silently — a church losing access to older sealed care records should be told');
  assert.match(body, /return false;/, 'a rotation that cannot be made to fit must report failure, not pretend');
});

// THE NAME KEY IS THE SAME DOCUMENT SHAPE AND WAS LEFT BEHIND (Fable pre-merge review, 2026-08-12). Care and
// media were made fit-aware and awaited; the name key — sealed per recipient with a ring of the same
// NAME_RING_MAX = 12, so refused by the relay at the same ~723 members — was neither. It was fired and
// forgotten one line below the two that were awaited. A blocked member who keeps the NAME key can still read
// every name in the congregation, which the block handler's own comment calls the one thing this encryption
// exists to stop. Of the three keys it was the worst one to silently fail to rotate.
test('the name key is fitted to the church, not just published and hoped for', () => {
  // The public entry point is a serialising wrapper (one name-key publish at a time — a second call landing
  // mid-publish saw the new ring with the stale recipient map and re-keyed the blocked member back in). The
  // decisions live in the locked implementation, so slice THAT; anchoring on the wrapper silently reads a
  // five-line function and every assertion below passes over nothing.
  const at = SRC.indexOf('async _ensureNameKeyLocked(');
  assert.notEqual(at, -1, 'the name-key implementation moved — re-anchor rather than widening this test');
  const body = SRC.slice(at, SRC.indexOf('\n  },', at));
  assert.match(body, /for \(let n = ring\.length; n >= 1;/,
    'the name key builds one envelope and publishes it. Past ~723 members the relay refuses it and a blocked ' +
    'member keeps the key that opens every name in the church');
  assert.match(body, /per \* recips\.length < 900000/,
    'the sample is measured but never compared against the ceiling, so the full ring is always chosen and the ' +
    'document is refused exactly as before');
  assert.match(body, /return false;/,
    'a name-key rotation that cannot be made to fit still resolves like a success, so the handler that now ' +
    'awaits it has nothing to report');
  assert.match(body, /_sealEach\(wrapped, recips/,
    'the name envelope still seals every recipient in one synchronous loop — seconds of frozen console in a ' +
    'large church, immediately after the steward taps Block');
});

test('blocking waits for the name key too, and says so if it did not land', () => {
  const at = DASH.indexOf('const block = (pk) =>');
  const body = DASH.slice(at, DASH.indexOf('\n  };', at));
  assert.match(body, /rotations\.push\(Promise\.resolve\(window\.Steward\.ensureNameKeyForMembers\(/,
    'the name key is fired and forgotten while the care and sermon keys are awaited beside it. A large church ' +
    'is told the person is blocked while they keep the key to the whole congregation\'s names');
  assert.match(body, /!delegated && window\.Steward\.ensureNameKeyForMembers/,
    'a DELEGATED console holds an empty ring, and rotating from empty republishes a brand-new single-key ring ' +
    'as the church name key — the whole roster goes anonymous from one Block tap. AUDIT-2026-07-27');
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
  assert.match(VENDOR, /name key ring trimmed/,
    'vendor/steward.js predates the NAME key half of this fix, so the shipped console still leaves a blocked ' +
    'member holding the key to every name in the church — run bash scripts/build-steward.sh');
});

// TWO NAME-KEY PUBLISHES MUST NOT OVERLAP.
//
// THE DEFECT (independent audit, 2026-08-13). The rotate assigns the new ring synchronously but only commits
// the recipient map after publishing. That gap used to be nanoseconds. Sealing per member with a yield every
// 25 stretched it to SECONDS in a large church — and the roster tick re-fires whenever the blocked list
// changes, which is precisely what a Block does. A second call landing in the gap sees the NEW ring beside
// the STALE recipient map, takes the grow-never-shrink path, and republishes the name key TO THE MEMBER JUST
// BLOCKED. The fix that made blocking take the name key away could hand it straight back.
test('name-key publishes are serialised, so a roster tick cannot re-key a blocked member', () => {
  const wrapper = SRC.slice(SRC.indexOf('async ensureNameKeyForMembers('), SRC.indexOf('async _ensureNameKeyLocked('));
  assert.match(wrapper, /while \(_nameKeyBusy\)/,
    'a second name-key publish can start while the first is still sealing — it sees the new ring with the ' +
    'old recipient list and re-keys the blocked member back in');
  assert.match(wrapper, /finally \{ _nameKeyBusy = null;/,
    'the lock is not released on every exit, so one failure wedges the name key for the rest of the session ' +
    '— every later block silently stops rotating it');
  assert.match(SRC, /let _nameKeyBusy = null;/, 'the lock is gone');
});
