// The console's church key must not sit in a plain file on a steward's phone.
// Run: node --test scripts/console-key-secure-store.test.mjs
//
// AUDIT-2026-07-30 S6. The member app moved its encrypted seed into the OS hardware store (Keystore/Keychain) in
// M12 — `src/identity.src.js:82-93` — and the console did not. The comment where this code now lives used to
// say the native migration was "queued as a follow-up commit — async-init refactor". That refactor was never
// actually required: every reader of the blob's CONTENT was already async, and every synchronous use was only a
// PRESENCE check, so the member app's marker split dropped straight in.
//
// Why it is worth the care: this is the CHURCH key. In plain localStorage the encrypted blob is a FILE — copied
// in seconds, then attacked OFFLINE at any speed with none of the PIN screen's throttling in the way. In the
// hardware store the ciphertext cannot be lifted off a forensic image at all.
//
// It protects a seized, POWERED-OFF phone. It does nothing about a phone seized unlocked, or a steward compelled
// to give up the PIN. That limit is stated in the source too, and this file does not assert more than that.
//
// THE FAILURE MODE THAT MATTERS MOST IS NOT THE LEAK — it is losing the key. A Keystore write that silently
// no-ops, followed by us cheerfully deleting the localStorage copy, would destroy the only record of a church's
// identity. So the invariant these tests hold is:
//
//        the localStorage copy is NEVER dropped until the hardware store has been written AND READ BACK equal.
//
// These execute the real functions. They are lifted from the SHIPPED BUNDLE (vendor/steward.js, per
// tests-must-drive-shipped-code) and the dynamic `import('@aparajita/capacitor-secure-storage')` is rewritten to
// hand back a stub — that substitution is module RESOLUTION only; every line of logic under test is the shipped
// one. Stated plainly because a lifted test that quietly rewrites behaviour is worthless.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

// Build a live copy of the storage helpers over a fake localStorage + fake secure store.
function harness({ nativeMode = true, secure = {}, ls = {} } = {}) {
  // Brace-match to the real end of each declaration. A fixed-window or single-line regex is a slow-acting trap
  // here: esbuild rewrites `const x = (a) => {…}` to a multi-line `var x = (a) => {…}`, so a pattern tuned to the
  // source shape silently stops matching the bundle — which is the file that actually ships.
  const lift = (name) => {
    const starts = [
      BUNDLE.indexOf('async function ' + name + '('),
      BUNDLE.indexOf('function ' + name + '('),
      BUNDLE.search(new RegExp('(?:var|const|let) ' + name + '\\s*=')),
    ].filter(i => i >= 0);
    assert.ok(starts.length, name + ' is gone from the bundle — re-anchor this test, or rebuild: bash scripts/build-steward.sh');
    const at = Math.min(...starts);
    const open = BUNDLE.indexOf('{', at);
    let depth = 0, i = open;
    for (; i < BUNDLE.length; i++) {
      const c = BUNDLE[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) break; }
    }
    assert.ok(depth === 0, name + ': braces did not balance — re-anchor this test');
    return BUNDLE.slice(at, i + 1);
  };
  const parts = ['_secureStore', '_encIsMarker', 'encBlobRaw', 'encBlobWrite', 'encBlobRemove', 'migrateEncToSecure']
    .map(lift).join(';\n')
    // Replace ONLY the module load. esbuild inlines the dynamic import as
    // `Promise.resolve().then(() => (init_esm(), esm_exports))`, which cannot resolve outside a browser — so
    // this hands back the stub module instead. _secureStore()'s OWN body still runs, which is the point: the
    // device bug lived in what that function RETURNS across an async boundary, and a version of this file that
    // injected _secureStore as a seam could never have seen it.
    .replace('Promise.resolve().then(() => (init_esm(), esm_exports))', 'Promise.resolve({ SecureStorage: __SECURE__ })');
  const store = { ...secure };
  const calls = { set: 0, get: 0, remove: 0 };
  // A CAPACITOR-SHAPED stub, not a plain object. window.Capacitor.Plugins.SecureStorage is a PROXY that turns
  // every property access into a native call, so touching `.then` on it asks Android for a method named "then".
  // A plain-object stub hides that completely — which is exactly how the first version of this file passed while
  // the shipped code hung for ever on a real phone:
  //
  //     Uncaught (in promise) Error: "SecureStorage.then()" is not implemented on android
  //
  // `_secureStore()` was an async function RETURNING the proxy, and the await machinery probes any returned
  // value for `.then`. The plugin answered, the call failed, and setPin never settled. Modelling the proxy here
  // is what makes that reproducible off-device.
  const impl = {
    set: async (k, v) => { calls.set++; if (secure.__failSet) throw new Error('keystore unavailable'); store[k] = secure.__writeGarbage ? 'CORRUPTED' : v; },
    get: async (k) => { calls.get++; if (secure.__failGet) throw new Error('keystore unavailable'); return store[k] === undefined ? null : store[k]; },
    remove: async (k) => { calls.remove++; delete store[k]; },
  };
  const SecureStorage = new Proxy(impl, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (typeof prop === 'symbol') return undefined;
      // Anything else — including `then` — is a native method that does not exist on Android.
      return () => { throw new Error('"SecureStorage.' + String(prop) + '()" is not implemented on android'); };
    },
  });
  const lsData = { ...ls };
  const localStorage = { getItem: (k) => (k in lsData ? lsData[k] : null), setItem: (k, v) => { lsData[k] = String(v); }, removeItem: (k) => { delete lsData[k]; } };
  const src = parts;
  const KEY = 'trinityone.steward.church-key.enc';
  // AUDIT-2026-07-30: encBlobWrite now also asks _devWrap to bind the blob to this browser on the WEB path.
  // Injected here as a PASS-THROUGH so these tests keep testing what they are about — where the ciphertext
  // lands and whether it can be lost. The wrap has its own file, console-device-bound-key.test.mjs.
  const devWrap = { wrap: async () => null, unwrap: async (x) => x, isWrapped: () => false };
  const fn = new Function('_devWrap', '__SECURE__', 'localStorage', 'lsGet', 'lsSet', '_isNative', 'console', 'ENC_LS',
    src + '\nreturn { encBlobRaw, encBlobWrite, encBlobRemove, migrateEncToSecure, _encIsMarker };');
  const api = fn(devWrap, SecureStorage, localStorage, (k) => localStorage.getItem(k), (k, v) => localStorage.setItem(k, v),
    () => nativeMode, { warn() {}, log() {} }, KEY);
  return { ...api, lsData, store, calls, KEY };
}
const BLOB = JSON.stringify({ v: 2, it: 600000, salt: 'c2FsdA==', iv: 'aXY=', ct: 'Y2lwaGVy' });

test('on native the ciphertext goes to the hardware store, and localStorage keeps only a marker', async () => {
  const h = harness();
  assert.equal(await h.encBlobWrite(BLOB), true);
  assert.equal(h.store[h.KEY], BLOB, 'the blob never reached the hardware store');
  const left = h.lsData[h.KEY];
  assert.ok(left && left.indexOf('"ct"') === -1,
    'the ciphertext is STILL in localStorage (' + String(left).slice(0, 40) + '…). That file is copyable in ' +
    'seconds and then brute-forceable offline — the whole point of this change.');
  assert.equal(JSON.parse(left).native, 1, 'the marker is missing, so presence checks like hasPinLock() break');
});

test('…and reading it back returns the real ciphertext', async () => {
  const h = harness();
  await h.encBlobWrite(BLOB);
  assert.equal(await h.encBlobRaw(), BLOB, 'the blob cannot be read back — the steward could never unlock');
});

test('A KEYSTORE THAT SILENTLY WRITES NOTHING MUST NOT COST THE CHURCH ITS KEY', async () => {
  // The dangerous direction. If we trusted set() and dropped the localStorage copy, the only record of the
  // church's identity would be gone — far worse than the exposure this change fixes.
  const h = harness({ secure: { __writeGarbage: true } });
  assert.equal(await h.encBlobWrite(BLOB), true, 'the write must still report success — the key IS saved, just not where we hoped');
  assert.equal(h.lsData[h.KEY], BLOB,
    'the localStorage copy was dropped even though the hardware store read back something different. The ' +
    'church key would now exist nowhere. This is the failure this whole design is arranged to prevent.');
  assert.equal(await h.encBlobRaw(), BLOB, 'and it must still be readable, or the steward is locked out');
});

test('a hardware store that throws is survived the same way', async () => {
  const h = harness({ secure: { __failSet: true } });
  assert.equal(await h.encBlobWrite(BLOB), true);
  assert.equal(h.lsData[h.KEY], BLOB, 'a throwing Keystore lost the key instead of falling back to localStorage');
});

test('web/desktop still persists its key, and never reaches for a native store', async () => {
  // This used to assert the stored value was the BARE blob. That is no longer true and must not be forced
  // back: on the web the blob is now bound to the browser (console-device-bound-key.test.mjs). What still
  // matters here — and is what this file is for — is that the key is persisted, is readable again, and that a
  // browser build never calls a native secure store. The wrap is injected as a pass-through above, so this
  // asserts the SHAPE of the web path rather than the wrapping itself.
  const h = harness({ nativeMode: false });
  assert.equal(await h.encBlobWrite(BLOB), true);
  assert.ok(h.lsData[h.KEY], 'the desktop console no longer persists its key at all');
  assert.equal(h.calls.set, 0, 'the browser build reached for a native secure store');
  assert.equal(await h.encBlobRaw(), BLOB, 'the desktop console cannot read its own key back');
});

test('an existing native install migrates once, and only on a verified read-back', async () => {
  const h = harness({ ls: { 'trinityone.steward.church-key.enc': BLOB } });   // legacy: full blob on disk
  assert.equal(await h.migrateEncToSecure(), true, 'an existing steward install never moves off localStorage');
  assert.equal(h.store[h.KEY], BLOB);
  assert.ok(h.lsData[h.KEY].indexOf('"ct"') === -1, 'the plain copy was left behind after a successful migration');
  // idempotent: a second boot must not re-run it
  h.calls.set = 0;
  assert.equal(await h.migrateEncToSecure(), false, 'the migration ran twice');
  assert.equal(h.calls.set, 0, 'the migration rewrote the hardware store on a later boot');
});

test('a failing migration leaves the device exactly as it was', async () => {
  const h = harness({ ls: { 'trinityone.steward.church-key.enc': BLOB }, secure: { __failSet: true } });
  assert.equal(await h.migrateEncToSecure(), false, 'it claimed to migrate onto a store that threw');
  assert.equal(h.lsData[h.KEY], BLOB,
    'the migration removed the localStorage copy without getting the blob into the hardware store. A steward ' +
    'whose Keystore misbehaves must simply stay as they were, never lose the key.');
});

test('removing the key clears the hardware store too, not just the file', async () => {
  // removeKey() tells the steward it "removes the church key from THIS device". That is untrue if the
  // Keystore copy outlives it — and this is the at-rest exposure the change exists to close.
  const h = harness();
  await h.encBlobWrite(BLOB);
  await h.encBlobRemove();
  assert.equal(h.store[h.KEY], undefined, 'the ciphertext survived in the hardware store after removal');
  assert.equal(h.lsData[h.KEY], undefined, 'the marker survived, so the console still thinks a PIN is set');
});

test('a marker whose blob cannot be fetched is a FAILED unlock, not an open door', () => {
  // encBlobRaw() returns '' when the store refuses. unlock() must treat that as "wrong PIN", never as
  // "no PIN set" — the latter would hand the console to whoever is holding the phone.
  const un = BUNDLE.match(/async unlock\(pin\) \{[\s\S]*?\n {4}\}/);
  assert.ok(un, 're-anchor: unlock() moved');
  // matched in two parts: the bundler reflows this onto separate lines
  assert.match(un[0], /raw = await encBlobRaw\(\);/, 'unlock() no longer reads through encBlobRaw()');
  assert.match(un[0], /if \(!raw\) return lsGet\(ENC_LS\) \? false : true;/,
    'unlock() no longer distinguishes "no PIN is set" from "a PIN is set but the hardware store would not ' +
    'open". Treating the second as the first unlocks the console for anyone holding the phone.');
});
