// "REMEMBER ME" MUST NOT OPEN A DIFFERENT ACCOUNT. Run: node --test scripts/remember-account-binding.test.mjs
//
// THE DEFECT THIS EXISTS FOR (pre-merge audit, 2026-08-07). rememberClear() was called from regenerate(),
// removePin(), forgetDevice() and lock() — but not from importMnemonic() or setPin(). And init() applied a
// remembered seed with NO check that it belonged to the account the encrypted blob holds. So:
//
//   1. Alice ticks "stay open on this phone for 30 days".
//   2. The phone is restored to Bob's 12 words   -> importMnemonic, record untouched.
//   3. Bob sets a community PIN                  -> setPin, record untouched.
//   4. Next launch: hasEnc() is true, the record is still inside Alice's 30 days, so the app opens
//      AS ALICE, WITH NO PIN. Bob's PIN-protected identity never loads.
//
// That is a cross-account key mix and a defeat of the PIN — the same bypass commit 23f0798 exists to close,
// rebuilt four commits later as a feature.
//
// WHY THE FIX IS AN OWNERSHIP CHECK RATHER THAN TWO MORE rememberClear() CALLS. Adding the two missing calls
// fixes the two paths we happened to think of. The bug WAS the list of paths being incomplete, so a fix shaped
// like a longer list has the same failure mode — and the next path added to this file inherits it silently.
// Binding the record to the account it came from makes a stale record inert no matter how it survived. The two
// clears are still there as hygiene, but nothing security-critical rests on their being complete.
//
// THIS TEST IS BEHAVIOURAL BY CONSTRUCTION. It lifts the shipped function and runs it against a fake store.
// It does not grep the source for the shape of a fix. The sibling file remember-device.test.mjs contains a
// test named "locking clears the remembered seed" whose entire assertion is that the string `rememberClear()`
// appears in lock() — the defect there was that the call is not AWAITED, which such an assertion can never
// see. `node scripts/sabotage.mjs remember` proves this one goes red when the check is removed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = readFileSync(ROOT + 'src/identity.src.js', 'utf8');
const VENDOR = readFileSync(ROOT + 'vendor/identity.js', 'utf8');

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const BOB_SEED = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const ALICE_SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// Lift the shipped bodies and run them for real. Only the dynamic plugin import is replaced — see the sibling
// file for why `({ SecureStorage })` cannot be used as the replacement (temporal dead zone swallows into catch).
function rig({ native = true, record = null, markerPub = ALICE } = {}) {
  const sec = new Map();
  if (record) sec.set('trinityone.nostr.remember', JSON.stringify(record));
  const SecureStorage = {
    async get(k) { return sec.has(k) ? sec.get(k) : null; },
    async set(k, v) { sec.set(k, String(v)); },
    async remove(k) { sec.delete(k); },
  };
  const pick = (name) => {
    const at = SRC.indexOf('async function ' + name);
    assert.notEqual(at, -1, name + '() does not exist in src/identity.src.js.\n\n' +
      '  If this is the first run: that IS the defect. Nothing in the boot path checks that a remembered\n' +
      '  seed belongs to the account the encrypted blob holds, so a record left behind by a previous\n' +
      '  identity opens the phone as that identity, with no PIN.');
    let depth = 0, q = '';
    for (let i = SRC.indexOf('{', at); i < SRC.length; i++) {
      const c = SRC[i], prev = SRC[i - 1];
      if (q) { if (c === q && prev !== '\\') q = ''; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; continue; }
      if (c === '/' && SRC[i + 1] === '/') { i = SRC.indexOf('\n', i); if (i === -1) break; continue; }
      if (c === '{') depth++; else if (c === '}' && --depth === 0) return SRC.slice(at, i + 1);
    }
    assert.fail('could not find the end of ' + name);
  };
  const bodies = ['rememberRead', 'rememberWrite', 'rememberClear', 'rememberedSeed'].map(pick).join('\n')
    .replace(/await import\('@aparajita\/capacitor-secure-storage'\)/g, '({ SecureStorage: __SS })');
  const scope = {
    __SS: SecureStorage,
    REMEMBER_KEY: 'trinityone.nostr.remember',
    isNative: () => native,
    nowSec: () => Math.floor(Date.now() / 1000),
    encOwnerPub: () => markerPub,
    deriveProfile: (m) => ({ pubkey: m === ALICE_SEED ? ALICE : BOB }),
    console: { warn() {} },
  };
  const names = Object.keys(scope);
  const api = new Function(...names, bodies + '\nreturn { rememberedSeed, rememberWrite };')(...names.map(n => scope[n]));
  return { ...api, sec };
}

const live = (pub) => ({ m: ALICE_SEED, until: Math.floor(Date.now() / 1000) + 86400, pub });

test('a record for THIS account still opens the phone', async () => {
  const r = rig({ record: live(ALICE), markerPub: ALICE });
  assert.equal(await r.rememberedSeed(), ALICE_SEED,
    'the feature no longer works at all — a member who ticked "stay open for 30 days" is asked for a PIN');
});

test('a record left by a PREVIOUS account does not open the phone', async () => {
  const r = rig({ record: live(ALICE), markerPub: BOB });
  assert.equal(await r.rememberedSeed(), null,
    'THE BYPASS: the phone now holds Bob\'s PIN-encrypted identity, but a record left behind by Alice ' +
    'opened it as Alice with no PIN. Her church, DMs and care records are readable by whoever holds it.');
});

test('a stale record is destroyed, not merely ignored', async () => {
  const r = rig({ record: live(ALICE), markerPub: BOB });
  await r.rememberedSeed();
  assert.equal(r.sec.has('trinityone.nostr.remember'), false,
    'the mismatched record survived. A seed for an account this device no longer holds is sitting in the ' +
    'secure store with nothing left to expire it — rememberRead only clears on TIME, and this one is live');
});

test('an unbindable record is REFUSED, not trusted', async () => {
  // A device whose PIN was set before this binding existed has no recorded owner. Fail CLOSED: we cannot
  // prove the record belongs here, and the cost of guessing wrong is someone else's account opening.
  const noOwner = rig({ record: live(ALICE), markerPub: null });
  assert.equal(await noOwner.rememberedSeed(), null,
    'with no recorded owner the check cannot be made, and it opened the phone anyway — fails OPEN, which ' +
    'is the same as not having the check on exactly the devices that predate it');
  const noPub = rig({ record: { m: ALICE_SEED, until: Math.floor(Date.now() / 1000) + 86400 }, markerPub: ALICE });
  assert.equal(await noPub.rememberedSeed(), null,
    'a record with no owner recorded on it was trusted — a record written before this existed must not be ' +
    'assumed to belong to whoever is here now');
});

test('an expired record is still refused once binding is in play', async () => {
  const r = rig({ record: { m: ALICE_SEED, until: Math.floor(Date.now() / 1000) - 1, pub: ALICE }, markerPub: ALICE });
  assert.equal(await r.rememberedSeed(), null,
    'binding has taken over from expiry — a matching account now opens the phone for ever, and the 30-day ' +
    'bound is the whole reason this was chosen over "never ask again"');
});

test('the web build never remembers, bound or not', async () => {
  const r = rig({ native: false, record: live(ALICE), markerPub: ALICE });
  assert.equal(await r.rememberedSeed(), null, 'the browser has no hardware store to hold a seed in');
});

test('the shipped bundle carries the binding, not just the source', () => {
  assert.match(VENDOR, /rememberedSeed/,
    'vendor/identity.js predates this fix, so the APK still has the bypass however green src/ looks — ' +
    'run npm run build:bundles');
});

// The round trip, not two halves assumed to meet. The first version of this fix bound the record on the READ
// side and silently failed to bind it on the WRITE side — an edit that no-matched on indentation. Every test
// still passed, because they all built their records by hand. Only the sabotage runner noticed.
test('a record this device writes is readable by this device', async () => {
  const r = rig({ record: null, markerPub: ALICE });
  assert.equal(await r.rememberWrite(ALICE_SEED, Math.floor(Date.now() / 1000) + 86400), true, 'the write failed');
  assert.equal(await r.rememberedSeed(), ALICE_SEED,
    'a record written by this device was then refused by it — the write and read sides disagree about the ' +
    'shape of the record, so "remember me" silently does nothing');
});

test('a record written for one account is refused by another', async () => {
  const r = rig({ record: null, markerPub: ALICE });
  await r.rememberWrite(BOB_SEED, Math.floor(Date.now() / 1000) + 86400);   // Bob's seed, Alice's device
  assert.equal(await r.rememberedSeed(), null,
    'the write side is not recording which account the seed belongs to, so the read side has nothing to ' +
    'check against and the binding is decorative');
});
