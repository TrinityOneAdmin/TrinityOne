// "STAY OPEN ON THIS PHONE FOR 30 DAYS" HAS TO SURVIVE THE APP BEING KILLED.
// Run: node --test scripts/a-remembered-phone-stays-open.test.mjs
//
// Owner, 2026-09-04: "I don't know if it actually sticks." It did not. Reproduced from a clean install on a
// Pixel 10 Pro: tick the box, force-stop ONCE, and the app asks for the PIN with the saved record DESTROYED.
//
// The chain, and why the failure is invisible. `setPin` wrote the account's pubkey ONLY into the localStorage
// marker. That marker does not reliably survive the app being killed. `init()` then takes its
// orphan-recovery branch — correct in itself, it rescues a PIN-locked identity rather than minting a new key
// — but it rewrote the marker WITHOUT the owner, because it had no way to know it. `rememberedSeed()` must
// fail closed (a record it cannot verify could be somebody else's key opening this church), so it deleted
// one it could no longer check. Ticking the box again just repeats the cycle.
//
// The fix is at the cause: the owner now travels WITH the ciphertext in the hardware store, which is the half
// that survives, so recovery can restore a complete marker. It is not the recovery path guessing — guessing
// the owner is precisely what the file's own comments forbid.
//
// There was NO test in the suite that drove this path at all, which is how it shipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BUNDLE = readFileSync(new URL('../vendor/identity.js', import.meta.url), 'utf8');

// A phone: a hardware store that survives, and a localStorage that we can make lose the marker the way a
// real WebView does when the app is killed before it flushes.
function phone() {
  const secure = new Map();
  const local = new Map();
  return {
    secure, local,
    // what the app sees
    localStorage: {
      getItem: (k) => (local.has(k) ? local.get(k) : null),
      setItem: (k, v) => { local.set(k, String(v)); },
      removeItem: (k) => { local.delete(k); },
    },
    SecureStorage: {
      get: async (k) => (secure.has(k) ? secure.get(k) : null),
      set: async (k, v) => { secure.set(k, String(v)); },
      remove: async (k) => { secure.delete(k); },
    },
    // the app is killed before the WebView flushes: the hardware store keeps everything, localStorage does not
    killBeforeFlush: () => { local.delete('trinityone.nostr.mnemonic.enc'); },
  };
}

function lift(decl, what) {
  const i = BUNDLE.indexOf(decl);
  assert.ok(i > 0, what + ' is not in vendor/identity.js — re-anchor this test');
  let d = 0;
  for (let k = BUNDLE.indexOf('{', i + decl.length - 1); k < BUNDLE.length; k++) {
    if (BUNDLE[k] === '{') d++;
    else if (BUNDLE[k] === '}') { d--; if (!d) return BUNDLE.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces slicing ' + what);
}

// The three shipped pieces this turns on, over ONE fake phone.
function engine(p) {
  const src = [
    lift('async function hasOrphanEncBlob(', 'hasOrphanEncBlob'),
    lift('async function orphanEncOwner(', 'orphanEncOwner'),
    lift('async function rememberedSeed(', 'rememberedSeed'),
    lift('async function rememberRead(', 'rememberRead'),
    lift('async function rememberClear(', 'rememberClear'),
    lift('function encOwnerPub(', 'encOwnerPub'),
    lift('function encMarker(', 'encMarker'),
  ].join('\n');
  const names  = ['ENC_KEY', 'REMEMBER_KEY', 'localStorage', 'isNative', 'nowSec', 'console', 'JSON', 'String', 'Date',
                  '__SS'];
  const values = ['trinityone.nostr.mnemonic.enc', 'trinityone.nostr.remember', p.localStorage,
                  () => true, () => Math.floor(Date.now() / 1000), { warn() {} }, JSON, String, Date, p.SecureStorage];
  // esbuild rewrites the dynamic plugin import into its own lazy-module form
  // (`await Promise.resolve().then(() => (init_esm(), esm_exports))`), so shim THAT, not the original
  // specifier. Matching the source form instead leaves the lifted code reaching for a module that is not
  // there — it throws inside its own try/catch and every case reads as "the feature is broken". Cost one
  // confusing red run before this line said so.
  // …and the replacement must not be `({ SecureStorage })`. The shipped line is
  // `const { SecureStorage } = await import(...)`, so an object literal naming SecureStorage refers to the
  // binding being declared on that very line — a temporal dead zone ReferenceError, swallowed by the
  // function's own try/catch, and every case then reads as "the feature is broken". Bind a different name.
  const shimmed = src.replace(/await Promise\.resolve\(\)\.then\(\(\) => \(init_esm\(\), esm_exports\)\)/g,
                              '({ SecureStorage: __SS })');
  assert.ok(!/esm_exports/.test(shimmed), 'the plugin import shim no longer matches the bundle — re-anchor it');
  return new Function(...names,
    shimmed + '\nreturn { hasOrphanEncBlob, orphanEncOwner, rememberedSeed };')(...values);
}

const OWNER = '0309aa78cdea753fe27acc5776dc4863f8ea980aa78b077fe8ae4527d596d2f2';
const SEED  = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

// What setPin leaves behind on a phone, as of this fix.
function afterSetPin(p, { blobCarriesOwner = true } = {}) {
  const blob = { v: 2, it: 600000, salt: 's', iv: 'i', ct: 'c' };
  if (blobCarriesOwner) blob.pub = OWNER;
  p.secure.set('trinityone.nostr.mnemonic.enc', JSON.stringify(blob));
  p.local.set('trinityone.nostr.mnemonic.enc', JSON.stringify({ v: 2, native: 1, pub: OWNER }));
  p.secure.set('trinityone.nostr.remember', JSON.stringify({ m: SEED, until: Math.floor(Date.now() / 1000) + 30 * 86400, pub: OWNER }));
}

test('the blob knows whose it is, so a lost marker can be rebuilt WHOLE', async () => {
  const p = phone(); afterSetPin(p);
  p.killBeforeFlush();
  const e = engine(p);
  assert.equal(await e.hasOrphanEncBlob(), true, 'the recovery path does not even see the orphaned blob');
  assert.equal(await e.orphanEncOwner(), OWNER,
    'the ciphertext does not carry its owner, so recovery can only write a marker the "stay open" record can ' +
    'never be checked against — which is the reported bug');
});

test('after the marker is lost and rebuilt, the remembered seed still opens the phone', async () => {
  const p = phone(); afterSetPin(p);
  p.killBeforeFlush();
  const e = engine(p);
  // exactly what init() now does on that branch
  const who = await e.orphanEncOwner();
  p.localStorage.setItem('trinityone.nostr.mnemonic.enc',
    JSON.stringify(who ? { v: 2, native: 1, pub: who } : { v: 2, native: 1 }));
  const seed = await e.rememberedSeed();
  assert.equal(seed, SEED,
    'the phone asked for the PIN despite holding a valid 30-day record — the member ticked a box, was told ' +
    'it saved, and is locked out on the very next launch');
  assert.ok(p.secure.has('trinityone.nostr.remember'),
    'and the record was DESTROYED on the way, so ticking the box again fails identically');
});

test('MEASURED: without the owner on the blob, that same boot loses the record', async () => {
  // The state the app shipped in. This control is what stops the test above passing for the wrong reason.
  const p = phone(); afterSetPin(p, { blobCarriesOwner: false });
  p.killBeforeFlush();
  const e = engine(p);
  const who = await e.orphanEncOwner();
  assert.equal(who, '', 'this control no longer reproduces the old state — re-anchor it');
  p.localStorage.setItem('trinityone.nostr.mnemonic.enc', JSON.stringify({ v: 2, native: 1 }));
  assert.equal(await e.rememberedSeed(), null, 'it should refuse — there is nothing to check the record against');
  assert.equal(p.secure.has('trinityone.nostr.remember'), false,
    'and this is the part that makes it permanent: the record is deleted, not just ignored');
});

test('a record belonging to a DIFFERENT account is still refused and destroyed', async () => {
  // The guarantee the fix must not weaken. Fail closed: a record that does not match is inert however it
  // survived, and is cleared on sight rather than left to expire on time it may have plenty of.
  const p = phone(); afterSetPin(p);
  p.secure.set('trinityone.nostr.remember',
    JSON.stringify({ m: SEED, until: Math.floor(Date.now() / 1000) + 30 * 86400, pub: 'f'.repeat(64) }));
  const e = engine(p);
  assert.equal(await e.rememberedSeed(), null,
    'a remembered seed from another account opened this phone — that is the bypass this check exists for');
  assert.equal(p.secure.has('trinityone.nostr.remember'), false, 'a mismatched record must be destroyed on sight');
});

test('an EXPIRED record is refused, however whole the marker is', async () => {
  const p = phone(); afterSetPin(p);
  p.secure.set('trinityone.nostr.remember',
    JSON.stringify({ m: SEED, until: Math.floor(Date.now() / 1000) - 60, pub: OWNER }));
  const e = engine(p);
  assert.equal(await e.rememberedSeed(), null, '30 days must mean 30 days — a window that renews itself is not a window');
});

// ── AND THE SHIPPED setPin MUST ACTUALLY PUT THE OWNER THERE ──────────────────────────────────────────────
//
// Every case above hands the fake phone a blob the TEST wrote. That proves the recovery path reads the owner
// and says nothing about whether setPin ever writes one — and measured, it said nothing: deleting `pub` from
// the shipped setPin left this file 5/0 green. Fourth time on this branch that a test could not see the thing
// it is named for, so this one runs setPin itself and reads what it hands to the hardware store.
test('setPin writes the owner alongside the ciphertext', async () => {
  const i = BUNDLE.indexOf('async setPin(pin) {');
  assert.ok(i > 0, 'setPin is not in vendor/identity.js — re-anchor this test');
  let d = 0, end = i;
  for (let k = BUNDLE.indexOf('{', i + 18); k < BUNDLE.length; k++) {
    if (BUNDLE[k] === '{') d++;
    else if (BUNDLE[k] === '}') { d--; if (!d) { end = k + 1; break; } }
  }
  const run = async (native) => {
    const stored = {};
    const names  = ['sessionMnemonic', 'secureGet', 'rememberClear', 'crypto', 'deriveAes', 'PIN_ITER', 'b64e',
                    'TextEncoder', 'deriveProfile', 'isNative', 'secureSetEnc', 'localStorage', 'ENC_KEY',
                    'window', 'secureRemove', 'JSON', 'Uint8Array'];
    const values = [null, async () => SEED, async () => {}, globalThis.crypto,
                    async () => globalThis.crypto.subtle.importKey('raw', new Uint8Array(32), 'AES-GCM', false, ['encrypt']),
                    600000, (b) => Buffer.from(b).toString('base64'), TextEncoder,
                    () => ({ pubkey: OWNER }), () => native,
                    async (blob) => { stored.secure = blob; return true; },
                    { setItem: (k, v) => { stored.local = v; } }, 'trinityone.nostr.mnemonic.enc',
                    { TrinityIdentity: {} }, async () => {}, JSON, Uint8Array];
    const ok = await new Function(...names, 'return ({ ' + BUNDLE.slice(i, end) + ' }).setPin;')(...values)('goodpin123');
    return { ok, ...stored };
  };

  const nat = await run(true);
  assert.equal(nat.ok, true, 'setPin failed outright in this harness — re-anchor it');
  const blob = JSON.parse(nat.secure);
  assert.equal(blob.pub, OWNER,
    'the ciphertext in the hardware store does not carry its owner. That store is the half that SURVIVES the ' +
    'app being killed, so without it the recovery path can only rebuild a marker the "stay open" record can ' +
    'never be checked against — and the record is then deleted rather than used');
  assert.ok(blob.ct && blob.iv && blob.salt, 'the blob lost a field it needs to decrypt at all');
  assert.equal(JSON.parse(nat.local).pub, OWNER, 'the localStorage marker lost its owner');

  // …and the web half must be unchanged: there is no secure store there, the whole blob lives in
  // localStorage, and "stay open" is not offered at all.
  const web = await run(false);
  assert.equal(web.secure, undefined, 'the web path wrote to a hardware store it does not have');
  assert.equal(JSON.parse(web.local).ct !== undefined, true, 'on web the FULL blob must stay in localStorage');
});

