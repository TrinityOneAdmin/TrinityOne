// REMOVING THE LOCK MUST NOT DESTROY THE KEY. Run: node --test scripts/console-removelock-keeps-key.test.mjs
//
// HANDOFF-2026-08-05 finding K3, and the third instance of one shape. cd67c7a fixed it in restoreKey: do not
// destroy the durable copy before the replacement exists, because between the two the seed is a JS local and
// anything that ends the context — an idle auto-lock, a backgrounded WebView, a crash, an OS memory reclaim —
// takes the church with it.
//
// removeLock had the same order and a WORSE window. restoreKey's gap is however long the forced-PIN modal
// takes; removeLock's is the same modal, reached by a steward who has just been told the lock is gone, with
// nothing forcing them to finish. Unbounded and user-paced. `await encBlobRemove()` cleared localStorage AND
// the hardware store, leaving `currentMnemonic` as the only copy of the church key in existence.
//
// Nothing needed the eager removal: setPin() → encBlobWrite() writes the same slot, so completing the flow
// overwrites the old ciphertext anyway. An abandoned "remove the lock" now leaves the previous key intact and
// openable with the OLD PIN — the steward keeps their church instead of losing it, which is the same trade
// cd67c7a made. The at-rest posture is unchanged: the blob is ciphertext either way, and the seed is never
// written to disk in plaintext.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

function grab(src, sig) {
  let at = src.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the shipped bundle — re-anchor this test, or rebuild');
  if (src.slice(Math.max(0, at - 6), at) === 'async ') at -= 6;
  let depth = 0, q = '';
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  assert.fail('could not find the end of ' + sig);
}

// Run the SHIPPED removeLock with its module-level dependencies injected.
function lockRemover({ mnemonic = 'a b c d e f g h i j k l', hasMarker = true, pinOk = true } = {}) {
  const seen = { removed: 0, needsPin: 0, verified: 0 };
  const scope = {
    currentMnemonic: mnemonic,
    lsGet: (k) => (hasMarker ? JSON.stringify({ native: 1 }) : null),
    ENC_LS: 'trinityone.steward.church-key.enc',
    encBlobRemove: async () => { seen.removed++; return true; },
    _setNeedsPin: (v) => { seen.needsPin++; },
    window: { Steward: { verifyPin: async () => { seen.verified++; return pinOk; }, locked: true } },
  };
  const names = Object.keys(scope);
  const obj = new Function(...names, 'return ({ ' + grab(STEWARD, 'async removeLock(pin) {') + ' });')(...names.map(n => scope[n]));
  return { removeLock: (p) => obj.removeLock(p), seen, Steward: scope.window.Steward };
}

test('removing the lock does not destroy the stored key', async () => {
  const r = lockRemover();
  const ok = await r.removeLock('1234');
  assert.equal(ok, true, 'the correct PIN should still be accepted');
  assert.equal(r.seen.removed, 0,
    'removeLock destroyed the encrypted key before any replacement existed. From here until the steward ' +
    'finishes typing a new PIN — an unbounded, user-paced window — the church key exists ONLY in memory, and ' +
    'an idle lock, a backgrounded WebView or a crash loses it outright. setPin() overwrites the same slot, so ' +
    'nothing needed the eager removal');
  assert.equal(r.seen.needsPin, 1, 'the steward must still be forced straight into setting a new PIN');
});

test('a wrong PIN still refuses, and changes nothing', async () => {
  const r = lockRemover({ pinOk: false });
  assert.equal(await r.removeLock('0000'), false, 'a wrong PIN must not remove the lock');
  assert.equal(r.seen.removed, 0, 'a refused attempt touched the stored key');
  assert.equal(r.seen.needsPin, 0, 'a refused attempt forced a re-PIN anyway');
});

test('with no key in memory there is nothing to do', async () => {
  const r = lockRemover({ mnemonic: '' });
  assert.equal(await r.removeLock('1234'), false);
  assert.equal(r.seen.removed, 0, 'removeLock cleared the stored blob while holding no seed to replace it ' +
    'with — the one case that is unrecoverable rather than merely risky');
});

// The screen has to match. The merged copy states the key "is DELETED from this device" and that it is
// "only held in memory" until a new PIN is set. Both were true and are now false, and a steward who believes
// the old PIN is dead has been told the opposite of the recovery route that still works.
test('the PIN screen does not claim the key was deleted', () => {
  assert.ok(!/stored key is DELETED from this device/.test(DASH),
    'the remove-lock copy still tells the steward their stored key was deleted and the church key is held ' +
    'only in memory. Neither is true now, and the difference is what they would do if the console closed');
});
