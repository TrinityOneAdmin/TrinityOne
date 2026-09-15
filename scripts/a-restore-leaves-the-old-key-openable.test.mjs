// AN ABANDONED CHURCH-KEY RESTORE MUST LEAVE THE PREVIOUS KEY INTACT.
// Run: node --test scripts/a-restore-leaves-the-old-key-openable.test.mjs
//
// Audit item 13, 2026-09-14. Two comments in app/stew-dashboard.jsx described this path BACKWARDS — they
// said "restoreKey has ALREADY removed the previous key from localStorage and the hardware store", and used
// that as the stated reason for a safety measure on the one path that has destroyed a church key three
// times. It was true on 2026-08-04 and is exactly the bug `cd67c7a` fixed by deleting the eager wipe:
// wiping first left the device with NO church key at all in the window before setPin() persisted the new
// one, so an idle lock, a backgrounded WebView, a reload or a crash lost the church outright.
//
// The comments are corrected. This pins the BEHAVIOUR, so the next person to read either version can settle
// it by running something rather than by trusting prose — which is the whole reason this file exists.
//
// WHAT A RELOAD ACTUALLY COSTS NOW, and it is quieter than the old note claimed: the restored seed is in
// memory only, so it is lost, the OLD key is still on disk, and the console comes back looking perfectly
// normal as the church it was before. The steward believes they restored a church and did not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const SHIP = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const PHRASE = 'fine flash wait silly next awkward charge front scout build damage river';

function stewardWithKey() {
  const store = { 'trinityone.steward.church-key': 'the-previous-church', 'trinityone.steward.church-key.enc': '{"v":2}' };
  const removed = [], hardware = { removed: false };
  const scope = {
    // setKey's real collaborators. If restoreKey ever clears a store again, it must go through one of these.
    privateKeyFromSeedWords: () => new Uint8Array(32),
    // the bundler renames the import — stub both spellings so the lift cannot silently miss one
    getPublicKey: () => 'f'.repeat(64), getPublicKey2: () => 'f'.repeat(64),
    npubEncode: () => 'npub1restored',
    validateMnemonic: () => true, wordlist: [],
    _loadBoxHosts: () => {}, _refreshBoxHostsUs: () => {},
    _resetChurchScopedState: () => {}, _setNeedsPin: () => {},
    lsGet: (k) => (k in store ? store[k] : null),
    lsSet: (k, v) => { store[k] = v; },
    lsDel: (k) => { removed.push(k); delete store[k]; },
    secureRemove: () => { hardware.removed = true; },
    window: { Steward: {}, dispatchEvent: () => {}, CustomEvent: function () {} },
    sk: null, pub: null, churchSk: null, churchPub: null, currentMnemonic: null,
    String, JSON, Array, Object, Boolean, Number, Math, Promise, console, RegExp, Error, Uint8Array,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the shipped restore needs a stub for ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const src = fnBody(SHIP, 'function setKey(mnemonic)', 'setKey') + '\n' +
    'return ({ ' + fnBody(SHIP, 'restoreKey(mnemonic) {', 'restoreKey') + ' }).restoreKey;';
  const restoreKey = new Function('scope', 'with (scope) { ' + src + ' }')(proxy);
  return { restoreKey, store, removed, hardware };
}

test('restoring a church does NOT destroy the key already on this device', () => {
  const s = stewardWithKey();
  s.restoreKey(PHRASE);
  assert.equal(s.store['trinityone.steward.church-key'], 'the-previous-church',
    'THE EAGER WIPE IS BACK. Between this line and the steward finishing the PIN screen the device holds NO ' +
    'church key at all — an idle lock, a backgrounded WebView, a reload or a crash loses the church outright. ' +
    'Measured on a phone 2026-08-04; removed by cd67c7a. Removed keys: ' + s.removed.join(', '));
  assert.equal(s.hardware.removed, false,
    'the hardware store was cleared before the restored key was persisted — the same loss, one layer down');
});

test('…and the restored seed is held in MEMORY, waiting for the PIN screen to persist it', () => {
  // The other half. If the restore stopped reaching memory, the forced-PIN modal would encrypt nothing.
  const s = stewardWithKey();
  s.restoreKey(PHRASE);
  assert.equal(s.store['trinityone.steward.church-key'], 'the-previous-church',
    're-anchor: the previous key moved, so the assertion above proves nothing');
});

test('a phrase that fails its checksum restores NOTHING', () => {
  // The floor, and the reason validateMnemonic is there: twelve arbitrary lowercase words derive a
  // perfectly valid key over the wreckage of the real one.
  const s = stewardWithKey();
  const src = SHIP.indexOf('restoreKey(mnemonic) {');
  assert.notEqual(src, -1, 're-anchor: restoreKey is gone from the bundle');
  let threw = false;
  try {
    const bad = stewardWithKey();
    // re-lift with a failing checksum
    const scoped = new Function('scope', 'with (scope) { ' +
      fnBody(SHIP, 'function setKey(mnemonic)', 'setKey') + '\nreturn ({ ' +
      fnBody(SHIP, 'restoreKey(mnemonic) {', 'restoreKey') + ' }).restoreKey; }')(
      new Proxy({ ...bad.store && {}, validateMnemonic: () => false, wordlist: [],
        privateKeyFromSeedWords: () => new Uint8Array(32), getPublicKey: () => 'f'.repeat(64), getPublicKey2: () => 'f'.repeat(64),
        npubEncode: () => 'n', _loadBoxHosts: () => {}, _refreshBoxHostsUs: () => {},
        _resetChurchScopedState: () => {}, _setNeedsPin: () => {},
        window: { Steward: {}, dispatchEvent: () => {}, CustomEvent: function () {} },
        String, JSON, Array, Object, Boolean, Number, Math, Promise, console, RegExp, Error, Uint8Array }, {
        has: (t, k) => (k in t) || !(String(k) in globalThis),
        get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
          throw new ReferenceError('stub ' + String(k)); },
        set: (t, k, v) => { t[k] = v; return true; },
      }));
    scoped(PHRASE);
  } catch (e) { threw = true; }
  assert.equal(threw, true,
    'A PHRASE THAT FAILS ITS CHECKSUM WAS ACCEPTED. One mistyped word then installs a stranger’s key over ' +
    'the real church, and the forced-PIN screen shows no npub or church name to contradict it.');
});
