// The console PIN has one minimum length, enforced where it cannot be bypassed.
// Run: node --test scripts/console-pin-floor.test.mjs
//
// AUDIT-2026-07-28 F18, and it is worse than the finding says. The audit points at the MEMBER app's engine
// (identity.src.js), which does enforce six. The console is a different engine, and window.Steward.setPin
// had NO length check at all — `if (!seed || !pin) return false` and nothing else.
//
// So the three places disagreed:
//     StewardForcedPin (steward-root.jsx)  — refuses under 6
//     PinModal (stew-dashboard.jsx)        — refuses under 4, message says "at least 4 digits"
//     window.Steward.setPin                — accepts anything non-empty
//
// The consequence is not a confusing error, it is a weaker key. A steward forced through the six-character
// gate on first run can afterwards open Settings → Security → Change PIN and set a FOUR character one, and it
// SUCCEEDS. That PIN is the only secret over the church key at rest — the key that, in the gate's own words,
// "signs as the whole church — if it leaks, an attacker can impersonate the church to every member".
//
// Fixed in the ENGINE, so every caller inherits it, rather than in the two screens that happen to exist today.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const S = readFileSync(ROOT + 'vendor/steward.js', 'utf8');
const DASH = readFileSync(ROOT + 'app/stew-dashboard.jsx', 'utf8');
const ROOTJSX = readFileSync(ROOT + 'app/steward-root.jsx', 'utf8');

// Run the SHIPPED setPin. Stubs stand in for storage and the key-derivation helper; the length rule under
// test is the function's own.
function loadSetPin() {
  const at = S.indexOf('async setPin(pin) {');
  assert.notEqual(at, -1, 'setPin is gone from the shipped console bundle — re-anchor this test');
  let depth = 0, end = -1;
  for (let i = S.indexOf('{', at); i < S.length; i++) {
    if (S[i] === '{') depth++; else if (S[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  const store = {};
  const scope = {
    currentMnemonic: 'abandon '.repeat(11) + 'about',
    KEY_LS: 'k', ENC_LS: 'e', PIN_ITER: 10,
    lsGet: (k) => store[k] || null,
    lsSet: (k, v) => { store[k] = v; },
    localStorage: { removeItem: (k) => { delete store[k]; } },
    deriveAes: async () => await crypto.subtle.importKey('raw', new Uint8Array(32), 'AES-GCM', false, ['encrypt']),
    b64e: (u8) => Buffer.from(u8).toString('base64'),
    _setNeedsPin: () => {},   // the real one clears the forced-PIN gate; irrelevant to the length rule
    crypto, TextEncoder, Uint8Array, JSON,
  };
  const args = Object.keys(scope);
  const fn = new Function(...args, `return ({ ${S.slice(at, end)} }).setPin;`)(...args.map(k => scope[k]));
  return { setPin: (p) => fn.call(null, p), store };
}

test('CONTROL: a proper PIN is accepted and does encrypt the seed', async () => {
  // If this fails every refusal below is meaningless, because setPin would be refusing everything.
  const { setPin, store } = loadSetPin();
  assert.equal(await setPin('123456'), true, 'a six-character PIN was refused — the TEST is broken, or the floor is too high');
  assert.ok(store.e, 'nothing was written, so nothing was encrypted');
  assert.ok(!store.k, 'the plaintext seed was left behind next to the encrypted one');
});

test('a four-character PIN is refused by the engine', async () => {
  // THE FINDING. This returned true before, so the console's Change-PIN screen could quietly downgrade the
  // encryption of the church key after the forced gate had demanded six.
  const { setPin, store } = loadSetPin();
  assert.equal(await setPin('1234'), false,
    'the console accepted a four-character PIN over the church key — the key that signs as the whole church');
  assert.ok(!store.e, 'it refused but still wrote an encrypted blob');
});

test('and so is five, and empty', async () => {
  const { setPin } = loadSetPin();
  assert.equal(await setPin('12345'), false, 'five characters is under the stated floor and was accepted');
  assert.equal(await setPin(''), false);
  assert.equal(await setPin(null), false);
});

test('every screen states the same minimum', () => {
  // The screens disagreed with each other AND with the engine. A UI that promises less than the engine
  // enforces produces "Couldn't set the PIN" with no reason; one that promises more is just wrong.
  const at = DASH.indexOf('function PinModal(');
  assert.notEqual(at, -1, 'PinModal is gone — re-anchor this test');
  const modal = DASH.slice(at, at + 2600);
  assert.doesNotMatch(modal, /pin\.length < 4/, 'the Change-PIN dialog still lets a four-character PIN through to an engine that refuses it');
  assert.match(modal, /pin\.length < 6/, 'the Change-PIN dialog does not enforce the same minimum as the engine');
  assert.doesNotMatch(modal, /at least 4 digits/, 'the dialog still tells the steward four is enough');
  const gate = ROOTJSX.slice(ROOTJSX.indexOf('function StewardForcedPin'), ROOTJSX.indexOf('window.StewardForcedPin'));
  assert.match(gate, /length < 6/, 'the forced gate no longer states six');
});
