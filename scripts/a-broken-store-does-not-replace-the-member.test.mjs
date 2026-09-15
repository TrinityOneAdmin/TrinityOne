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
import { fnBody } from './test-slice.mjs';

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
  // ⚠ USE THE HOUSE SLICER. This hand-rolled a brace walk, which was already the fix for `indexOf('\\n}')`
  // (the bundle is indented, so a source-spelled closing brace never appears at column 0 and the slice ran
  // to the end of the file). But a bare depth counter is blind to a brace inside a STRING, a COMMENT or a
  // REGEX, and `fnBody` in test-slice.mjs is quote- and comment-aware and walks the parameter list first.
  // Neither lifted function carries such a brace TODAY; the point is that the next edit to either of them
  // must not be able to make this test slice garbage and report it as a code failure.
  // Flagged by a local-model pass, 2026-09-14 — for the wrong reason (it said nested objects desynchronise
  // the counter, which they do not) but at the right line.
  const body = fnBody(SHIP, 'function _recoveryReference()', '_recoveryReference') + '\n' +
               fnBody(SHIP, 'function encOwnerPub()', 'encOwnerPub');
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

// ── ITEM 7's OTHER HALF: `settled` must mean "init finished", whichever way it went ─────────────────────
// app/app.jsx's locked-boot wipe now refuses to act until `window.TrinityIdentity.settled` is true, because
// `isLocked()` is `hasEnc() && !sessionMnemonic` and on a "remember me" boot that is true until a
// SecureStorage round trip completes — so a first-render read destroyed every church cache for a member who
// never locked. The flag is the load-bearing half of that fix and the harness in locked-boot-wipe.test.mjs
// STUBS it, so nothing there can see this wiring break. Driven off the shipped bundle here.
//
// ⚠ AND IT MUST SETTLE EVEN WHEN init() THREW: a phone whose secure store throws would otherwise leave the
// flag false for the session and never wipe on a genuinely locked boot — the mirror defect
// (AUDIT-2026-07-28 F7), and the worse of the two on a seized device.
// (An earlier version of this note said "this is why it is .finally and not .then". That was WRONG — the
// `.catch` before it converts the rejection, so both behave identically, and a sabotage swapping them came
// back green and was right to. The test below pins the BEHAVIOUR, which is what actually matters.)
function shippedSettle({ fails = false } = {}) {
  const win = { TrinityIdentity: {} };
  const tail = SHIP.slice(SHIP.indexOf('window.TrinityIdentity.settled = false;'));
  const end = tail.indexOf('});') + 3;
  const src = tail.slice(0, end);
  const run = new Function('window', 'init', 'console', src + '\nreturn window.TrinityIdentity;');
  const ID = run(win, () => (fails ? Promise.reject(new Error('secure store threw')) : Promise.resolve()),
    { error: () => {} });
  return ID;
}

test('settled is FALSE until identity has finished deciding', () => {
  const ID = shippedSettle();
  assert.equal(ID.settled, false,
    'IDENTITY REPORTS ITSELF SETTLED BEFORE IT HAS DECIDED ANYTHING. The locked-boot wipe then acts on a ' +
    'first-render guess, and on a "stay open" boot destroys every church cache for a member who never ' +
    'locked — offline, the congregation paints empty with nothing saying why.');
});

test('…and becomes TRUE once it has', async () => {
  const ID = shippedSettle();
  await ID.ready;
  assert.equal(ID.settled, true, 'identity finished and never said so, so the wipe would wait for ever');
});

test('a secure store that THREW still settles — or a locked phone never wipes at all', async () => {
  const ID = shippedSettle({ fails: true });
  await ID.ready;
  assert.equal(ID.settled, true,
    'INIT FAILED AND settled STAYED FALSE. On a seized, locked phone whose secure store threw, the wipe now ' +
    'waits for ever and every congregation cache stays on disk — the mirror of the defect it exists for, ' +
    'and the worse one.');
});
