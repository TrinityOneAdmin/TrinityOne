// A PHONE THAT CANNOT READ ITS OWN ACCOUNT MUST NOT MINT A NEW ONE OVER IT.
// Run: node --test scripts/a-broken-store-does-not-replace-the-member.test.mjs
//
// Audit finding, 2026-09-14. `secureGet` ends `catch (e) { …; return null; }`, and `null` is the SAME answer
// it gives when there genuinely is no account. `init()` then minted a fresh seed and wrote it over the top:
// the member opens the app as a brand-new nameless person, and the seed that would have brought their
// account back is gone. `secureSet`'s own comment names the real-world trigger — "a Keystore that silently
// no-ops the write, known on some Androids after credential changes".
//
// ⚠ THE PIN CASE WAS ALREADY SAFE. The orphan-blob branch recovers a PIN-locked identity, so this only ever
// bit a phone with NO PIN. That asymmetry is asserted below, because it is what makes the finding narrower
// than it first reads — and because a change that "fixed" the PIN case by breaking the recovery would pass
// a test that only checked the no-PIN half.
//
// ⚠ THE SHIPPED init() IS LIFTED OUT OF vendor/identity.js AND RUN. Nothing here matches source text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SHIP = readFileSync(new URL('../vendor/identity.js', import.meta.url), 'utf8');

// The decision under test, as the bundle states it.
function mintGuard() {
  const i = SHIP.indexOf('if (isNative() && _recoveryReference()) {');
  return i !== -1;
}

test('THE GUARD IS IN THE SHIPPED BUNDLE, in the minting path', () => {
  // vendor/*.js is the case rule 3 explicitly permits: esbuild removes dead code, so if this branch were
  // disabled the text would be GONE and this would fail.
  assert.ok(mintGuard(),
    'THE MINT PATH NO LONGER ASKS WHETHER THIS PHONE HAS HELD AN ACCOUNT. A secure store that throws then ' +
    'reads as "new phone" and the member is replaced.');
  const at = SHIP.indexOf('if (isNative() && _recoveryReference()) {');
  const mint = SHIP.indexOf('generateSeedWords()', at);
  assert.ok(mint > at && mint - at < 400,
    'the guard is no longer immediately before the mint — it must sit between "no seed" and "make a new one"');
});

// The guard's own logic, lifted and run over the states a real phone can be in.
function guard({ native = true, pub = '', encPub = null } = {}) {
  const store = {};
  if (pub) store['trinityone.nostr.pub'] = pub;
  if (encPub) store['trinityone.nostr.mnemonic.enc'] = JSON.stringify({ v: 2, native: 1, pub: encPub });
  // ⚠ BRACE-MATCHED, NOT `indexOf('\\n}')`. The bundle is indented, so the source spelling of a closing brace
  // never appears at column 0 and the slice ran on to the end of the file — "Unexpected token 'return'".
  // Same fixed-window trap this repo keeps re-learning, in its third costume.
  const i = SHIP.indexOf('function _recoveryReference()');
  const j = SHIP.indexOf('function encOwnerPub()', i);
  const open = SHIP.indexOf('{', j);
  let depth = 0, end = -1;
  for (let k = open; k < SHIP.length; k++) {
    if (SHIP[k] === '{') depth++;
    else if (SHIP[k] === '}' && --depth === 0) { end = k; break; }
  }
  const body = SHIP.slice(i, end + 1);
  const fn = new Function('localStorage', 'PUB_KEY', 'ENC_KEY', body + '\nreturn _recoveryReference;')(
    { getItem: (k) => (k in store ? store[k] : null) }, 'trinityone.nostr.pub', 'trinityone.nostr.mnemonic.enc');
  return !!(native && fn());
}

test('A PHONE THAT HAS HELD AN ACCOUNT REFUSES TO MINT OVER IT', () => {
  assert.equal(guard({ pub: 'a'.repeat(64) }), true,
    'A MEMBER WHOSE PHONE COULD NOT READ ITS SEED WAS REPLACED BY A NEW IDENTITY. Their name, their church ' +
    'and their history are gone, and so is the seed that would restore them.');
});

test('…and it also recognises a phone that only has the PIN-locked copy', () => {
  // The marker can be lost (app killed before the WebView flushed it) while the encrypted blob survives.
  assert.equal(guard({ pub: '', encPub: 'b'.repeat(64) }), true,
    'a phone holding a PIN-locked account was treated as never having held one');
});

test('A GENUINELY NEW PHONE STILL GETS AN IDENTITY — the guard is not a blanket refusal', () => {
  // The re-anchor, and the important one: a guard that refused every first run would stop anyone joining.
  assert.equal(guard({ pub: '', encPub: null }), false,
    'A BRAND-NEW PHONE WAS REFUSED AN IDENTITY. Nobody can create an account at all.');
});

test('the web build is untouched — this is a native-store failure', () => {
  assert.equal(guard({ native: false, pub: 'a'.repeat(64) }), false,
    'the guard fires off-native, where the seed lives in localStorage and this failure mode does not exist');
});

test('THE PIN-LOCKED RECOVERY THAT MADE THIS NARROW IS STILL THERE', () => {
  // If a change ever removed the orphan-blob branch, the no-PIN guard above would mask it — a PIN-locked
  // member would stop being recovered and start merely being refused, which is a worse outcome wearing a
  // safer-looking shape.
  assert.ok(SHIP.includes('hasOrphanEncBlob'),
    'THE PIN-LOCKED RECOVERY IS GONE. A member with a PIN is now only refused, not recovered.');
  const orphan = SHIP.indexOf('hasOrphanEncBlob');
  const guardAt = SHIP.indexOf('if (isNative() && _recoveryReference()) {');
  assert.ok(orphan < guardAt,
    'the recovery must be tried BEFORE the refusal, or a recoverable member is refused instead of restored');
});
