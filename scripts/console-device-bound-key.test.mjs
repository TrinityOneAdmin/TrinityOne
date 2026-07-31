// A copied browser profile file must not be enough to attack the church key.
// Run: node --test scripts/console-device-bound-key.test.mjs
//
// AUDIT-2026-07-30. On native the ciphertext lives in the OS hardware store and a copied file yields nothing
// (scripts/console-key-secure-store.test.mjs). A BROWSER has no such store — and that is where most stewards
// actually run the console. So the encrypted church key sits in a file that can be copied in seconds and then
// attacked OFFLINE, at any speed, with none of the unlock screen's throttling in the way. At the shipped cost
// (PBKDF2, 600k rounds) six digits is about half a minute of one graphics card.
//
// The browser can hold a key JavaScript may USE but never READ: generated non-extractable, the CryptoKey object
// itself kept in IndexedDB. Wrapping the blob with it means a copied file is not enough — an attacker needs the
// browser profile too, and is then reduced to guessing through a browser instead of on a GPU farm.
//
// IT IS HARDENING, NOT CUSTODY, and that distinction is the point of half these tests. Losing the browser
// profile makes the blob unopenable, which is ACCEPTABLE — the steward restores from their 12 words. What is
// NOT acceptable is the silent version: device key gone, blob present, every correct passphrase reported as
// "wrong", and the steward trying harder for ever. So the failure must be DISTINGUISHABLE, and it is asserted
// here more thoroughly than the happy path.
//
// Executes the real makeDeviceWrap from the SHIPPED BUNDLE against Node's real WebCrypto — real AES-GCM keys,
// real encrypt/decrypt. Only the key STORE is faked (there is no IndexedDB in Node), which is the one piece
// that cannot exist here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

function lift(name) {
  const starts = [BUNDLE.indexOf('async function ' + name + '('), BUNDLE.indexOf('function ' + name + '('),
    BUNDLE.search(new RegExp('(?:var|const|let) ' + name + '\\s*='))].filter(i => i >= 0);
  assert.ok(starts.length, name + ' is gone from the bundle — rebuild: bash scripts/build-steward.sh');
  const at = Math.min(...starts);
  let d = 0, i = BUNDLE.indexOf('{', at);
  for (; i < BUNDLE.length; i++) { const c = BUNDLE[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) break; } }
  return BUNDLE.slice(at, i + 1);
}
const b64e = (u8) => Buffer.from(u8).toString('base64');
const b64d = (s) => new Uint8Array(Buffer.from(s, 'base64'));

// Build the real wrapper over a fake key store. `keyStore.k` is the browser profile: delete it to simulate a
// reinstall, replace it to simulate a different machine.
async function harness({ startWithKey = true } = {}) {
  const src = lift('makeDeviceWrap');
  const make = new Function('b64e', 'b64d', 'TextEncoder', 'TextDecoder', 'console', '_deviceKey',
    src + '; return makeDeviceWrap;')(b64e, b64d, TextEncoder, TextDecoder, { warn() {}, log() {} }, async () => null);
  const store = { k: null };
  if (startWithKey) store.k = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const w = make({
    subtle: webcrypto.subtle,
    randomBytes: (n) => webcrypto.getRandomValues(new Uint8Array(n)),
    getKey: async (create) => {
      if (store.k) return store.k;
      if (!create) return null;
      store.k = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      return store.k;
    },
  });
  return { w, store };
}
const BLOB = JSON.stringify({ v: 2, it: 600000, salt: 'c2FsdA==', iv: 'aXY=', ct: 'Y2lwaGVy' });

test('the stored file is no longer the whole secret', async () => {
  const { w } = await harness();
  const wrapped = await w.wrap(BLOB);
  assert.ok(wrapped, 'nothing was wrapped');
  assert.ok(wrapped.indexOf('"salt"') === -1 && wrapped.indexOf(BLOB) === -1,
    'the PIN-encrypted blob is still readable inside the stored value, so copying the file is still enough to ' +
    'start guessing offline — which is the entire point of this change.');
  assert.equal(JSON.parse(wrapped).dev, 1, 'the wrapped form is not tagged, so a failure to open it cannot be told apart from a wrong passphrase');
});

test('…and this browser can still open it', async () => {
  const { w } = await harness();
  const wrapped = await w.wrap(BLOB);
  assert.equal(await w.unwrap(wrapped), BLOB, 'the steward could not unlock on the very machine that stored it');
});

test('A COPY OF THE FILE ON ANOTHER MACHINE IS USELESS', async () => {
  // The attack this exists to stop: the localStorage file is exfiltrated and opened elsewhere.
  const a = await harness();
  const wrapped = await a.w.wrap(BLOB);
  const b = await harness();                       // a different browser profile — its own key
  await assert.rejects(() => b.w.unwrap(wrapped),
    (e) => e.deviceKeyMissing === true,
    'another machine opened the wrapped blob. The wrap is not actually bound to this browser, so a copied ' +
    'file can still be attacked offline exactly as before.');
});

test('LOSING THE BROWSER PROFILE IS REPORTED, NOT MISTAKEN FOR A WRONG PASSPHRASE', async () => {
  // The failure mode that would waste a steward's evening. Reinstall / clear site data / new machine: the blob
  // is unopenable, and that is fine — they restore from their 12 words. What must never happen is the console
  // saying "wrong PIN" and the steward trying harder for ever.
  const { w, store } = await harness();
  const wrapped = await w.wrap(BLOB);
  store.k = null;                                   // profile cleared
  await assert.rejects(() => w.unwrap(wrapped),
    (e) => e.deviceKeyMissing === true,
    'the console cannot tell "this computer no longer holds the key" from "you typed it wrong". The steward ' +
    'would be told their passphrase is wrong, for ever, with the real answer (restore from your 12 words) ' +
    'never offered.');
});

test('unlock() and verifyPin() surface that state, and CLEAR it on the next attempt', () => {
  // This used to grep for the identifiers in a 700-char window and never look at the order. It was green while
  // the flag was a LATCH — set once, never reset — so after recovering in place an ordinary typo reported
  // "your passphrase is fine, this computer no longer recognises the key", and the caller's early return also
  // skipped the failed-attempt counter, silently disabling the escalating lockout for the rest of the session.
  for (const fn of ['unlock', 'verifyPin']) {
    const at = BUNDLE.indexOf('async ' + fn + '(pin)');
    assert.notEqual(at, -1, 're-anchor: ' + fn + ' moved');
    const body = BUNDLE.slice(at, at + 900);
    const cleared = body.indexOf('deviceKeyLost = false');
    const set = body.indexOf('deviceKeyLost = true');
    assert.notEqual(cleared, -1,
      fn + '() never clears deviceKeyLost, so it latches: once one eviction sets it, every later WRONG ' +
      'passphrase is reported as a lost device key and the attempt counter is skipped.');
    assert.notEqual(set, -1, fn + '() no longer sets deviceKeyLost, so the UI cannot explain the one state it exists for');
    assert.ok(cleared < set,
      fn + '() clears the flag AFTER setting it, or in the wrong branch — it must be reset at the top so it ' +
      'describes THIS attempt rather than any previous one.');
    assert.match(body, /deviceKeyMissing/, fn + '() no longer distinguishes a lost device key from a wrong passphrase');
  }
});

test('a platform without the capability keeps working, unwrapped', async () => {
  // Private browsing, an old browser, a locked-down profile. A console that cannot be hardened must still WORK
  // — refusing to store the key would be a far worse outcome than storing it as we always did.
  const src = lift('makeDeviceWrap');
  const make = new Function('b64e', 'b64d', 'TextEncoder', 'TextDecoder', 'console', '_deviceKey',
    src + '; return makeDeviceWrap;')(b64e, b64d, TextEncoder, TextDecoder, { warn() {}, log() {} }, async () => null);
  const w = make({ subtle: webcrypto.subtle, getKey: async () => null });
  assert.equal(await w.wrap(BLOB), null,
    'wrap() should report "cannot" so the caller stores the blob as before; anything else risks a console that ' +
    'cannot save its key at all');
});

test('a plain unwrapped blob still opens — existing consoles are not locked out', async () => {
  // Every steward already running has an unwrapped blob. If unwrap() choked on it they would all be locked out
  // by an upgrade, which is the worst possible way to ship a security improvement.
  const { w } = await harness();
  assert.equal(await w.unwrap(BLOB), BLOB, 'an existing unwrapped blob is no longer readable after the upgrade');
});

test('the write path read-checks before trusting the wrap', () => {
  // Same discipline as the hardware store: never leave behind a blob we cannot open again.
  const at = BUNDLE.indexOf('async function encBlobWrite(');
  assert.notEqual(at, -1, 're-anchor: encBlobWrite moved');
  const body = BUNDLE.slice(at, at + 1400);
  assert.match(body, /_devWrap\.wrap\(/, 'the web path no longer binds the blob to the browser');
  // These three used to be vacuous, and an audit proved it by sabotage: deleting the `if (!_isNative())` guard
  // and deleting the read-back comparison BOTH left all of them green. `_isNative()` matched the pre-existing
  // native branch on encBlobWrite's second line, 43 characters in — nothing to do with the wrap at all.
  // Anchored on the wrap's own block now, and on the comparison rather than the mere mention of unwrap.
  const wrapAt = body.indexOf('_devWrap.wrap(');
  const wrapBlock = body.slice(Math.max(0, wrapAt - 400), wrapAt + 500);
  assert.match(wrapBlock, /!_isNative\(\)/,
    'the wrap is no longer behind a !_isNative() guard, so it layers over the native Keystore path that was ' +
    'verified on a device — buying nothing and risking the thing that works.');
  assert.match(wrapBlock, /back === str/,
    'the wrapped blob is stored without COMPARING the read-back. A wrap we cannot reverse would lock the ' +
    'steward out on their next visit with no idea why — and merely calling unwrap() does not check that.');
});

test('THE DEVICE KEY IS GENERATED NON-EXTRACTABLE — the crux of the whole design', () => {
  // Every test above injects its own key, so not one of them can see the flag the SHIPPED code passes. If that
  // flag were `true`, any script running on the page — an XSS, a malicious extension, a compromised
  // dependency — could export the key's bytes, and then a copied localStorage file is exactly as attackable as
  // it was before. The wrap would look identical and protect nothing.
  //
  // Caught by sabotage: flipping it to `true` broke no test until this one existed.
  const at = BUNDLE.indexOf('async function _deviceKey(');
  assert.notEqual(at, -1, 're-anchor: _deviceKey moved');
  const body = BUNDLE.slice(at, at + 900);
  const gen = body.match(/generateKey\([^)]*\}\s*,\s*(true|false)\s*,/);
  assert.ok(gen, 're-anchor: the generateKey call moved or changed shape');
  assert.equal(gen[1], 'false',
    'the device key is generated EXTRACTABLE. Any script on the page could then read its bytes, and a copied ' +
    'localStorage file becomes as attackable as it was before this change — while every other test here still ' +
    'passes, because they supply their own key.');
});

test('…and it is stored, not re-derived — a fresh key each boot would lock the steward out', () => {
  // The other half: a key regenerated on every load could never open yesterday's blob.
  const at = BUNDLE.indexOf('async function _deviceKey(');
  const body = BUNDLE.slice(at, at + 900);
  assert.match(body, /if \(found\) return found;/,
    '_deviceKey no longer returns an existing key before creating one, so every boot would mint a fresh key ' +
    'and the previous blob would be permanently unopenable.');
  assert.match(body, /if \(!create\) return null;/,
    'a read-only lookup can now CREATE a key. unwrap() calls getKey(false) precisely so that a missing key is ' +
    'reported rather than silently replaced with a new one that cannot open anything.');
});

test('THE STEWARD HAS A WAY OUT ON THAT SCREEN, not just a message', () => {
  // The critical audit finding. The message used to say 'Use "I have my 12 words"' — a control that exists
  // only in the MEMBER app (app/identity.jsx). The console's equivalent is called "Restore a church" and lives
  // on StewardWelcome, which steward-root.jsx renders ONLY when no key blob exists. While locked, StewardUnlock
  // is the whole screen. So a steward holding their 12 words on paper, with an intact church, was told to press
  // a button that was not there and could not be reached — their only real escape being to clear site data by
  // hand, which nothing mentioned.
  //
  // A message is not a way out. This asserts the AFFORDANCE exists on the locked screen, and that the words
  // match a control the steward can actually see.
  const ROOT = readFileSync(new URL('../app/steward-root.jsx', import.meta.url), 'utf8');
  const at = ROOT.indexOf('function StewardUnlock');
  assert.notEqual(at, -1, 're-anchor: StewardUnlock moved');
  const screen = ROOT.slice(at, ROOT.indexOf('\nfunction ', at + 10));

  assert.match(screen, /deviceKeyLost/, 'the unlock screen no longer detects the lost-device-key state');
  assert.match(screen, /setLostKey\(true\)/, 'the state is detected but never recorded for the render');
  assert.match(screen, /lostKey \?/, 'nothing on the locked screen changes when the device key is gone');
  assert.match(screen, /Restore this church with my 12 words/,
    'there is no restore control on the locked screen. The message alone is a dead end — this is the one ' +
    'moment the feature exists for, and the steward cannot act on it.');
  // and the message must name what they can actually press
  assert.doesNotMatch(screen, /Use “I have my 12 words”/,
    'the message still names a control from the member app that does not exist in the console.');

  const branch = screen.slice(screen.indexOf('deviceKeyLost'));
  assert.ok(branch.indexOf('return;') !== -1 && branch.indexOf('return;') < branch.indexOf('const fails'),
    'the lost-device-key branch falls through into the failed-attempt counter. It is not a wrong guess, so it ' +
    'must not push the steward towards a lockout.');
});

test('a broken IndexedDB store is rebuilt, not swallowed for ever', () => {
  // A failed createObjectStore still COMMITS the upgrade at version 1 with no store. Every later transaction
  // then throws, _deviceKey returns null, and because the version was hardcoded the upgrade never ran again —
  // so the console either silently protected nothing, or was permanently locked out of an already-wrapped
  // blob. Confirmed reachable by the audit, which hit it by accident.
  const at = BUNDLE.indexOf('async function _idb(');
  assert.notEqual(at, -1, 're-anchor: _idb moved or is no longer async');
  const body = BUNDLE.slice(at, at + 700);
  assert.match(body, /objectStoreNames\.contains\(DEV_STORE\)/,
    '_idb no longer checks the object store actually exists. An upgrade that failed to create it commits ' +
    'anyway, and every later transaction throws for ever.');
  assert.match(body, /version \|\| 1\) \+ 1|\+ 1/,
    'there is no version bump, so a database stuck without its store can never be repaired — the version is ' +
    'the only thing that triggers another upgrade.');
  // Asserted as the GUARD'S PRESENCE, not the absence of a try/catch. The absence form is brittle — sabotage
  // put the swallowing version back and this test stayed green, because a regex for "no try/catch here" is
  // defeated by any reformatting the bundler happens to do.
  const up = BUNDLE.slice(BUNDLE.indexOf('function _openIdb('), BUNDLE.indexOf('function _openIdb(') + 600);
  assert.match(up, /onupgradeneeded[\s\S]{0,220}objectStoreNames\.contains\(DEV_STORE\)/,
    'the upgrade handler no longer checks whether the store already exists before creating it, and its failure ' +
    'is swallowed — which commits the upgrade with NO object store and, because the version is fixed, can ' +
    'never repair itself.');
});

test('the browser is asked to keep the key rather than treat it as disposable', () => {
  // Best-effort storage can be evicted under pressure and by some clear-site-data paths. The asymmetric case —
  // the encrypted blob survives, the device key does not — is the one that strands a steward. Recoverable from
  // the 12 words, but it should not happen because the browser tidied up.
  const at = BUNDLE.indexOf('async function _deviceKey(');
  const body = BUNDLE.slice(at, at + 1100);
  assert.match(body, /navigator\.storage[\s\S]{0,40}persist\(\)/,
    'nothing asks for persistent storage, so the device key is evictable. Ask BEFORE minting the key the ' +
    'browser is then expected to keep.');
  assert.ok(body.indexOf('persist()') < body.indexOf('generateKey'),
    'persistence is requested after the key is generated — ask first, so the key it is asked to keep is ' +
    'covered from the moment it exists.');
});
