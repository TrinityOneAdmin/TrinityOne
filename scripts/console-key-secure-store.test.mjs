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
  const parts = ['_secureStore', '_encIsMarker', 'encBlobRaw', 'encBlobWrite', 'encBlobRemove', 'encBlobRemoveResume', 'migrateEncToSecure']
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
    remove: async (k) => { calls.remove++; if (secure.__failRemove || store.__failRemove) throw new Error('keystore busy'); delete store[k]; },
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
  const PENDING = 'trinityone.steward.church-key.removing';
  const fn = new Function('_devWrap', '__SECURE__', 'localStorage', 'lsGet', 'lsSet', '_isNative', 'console', 'ENC_LS', 'ENC_PENDING_LS',
    src + '\nreturn { encBlobRaw, encBlobWrite, encBlobRemove, encBlobRemoveResume, migrateEncToSecure, _encIsMarker };');
  const api = fn(devWrap, SecureStorage, localStorage, (k) => localStorage.getItem(k), (k, v) => localStorage.setItem(k, v),
    () => nativeMode, { warn() {}, log() {} }, KEY, PENDING);
  return { ...api, lsData, store, calls, KEY, PENDING };
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

// ── the caller ───────────────────────────────────────────────────────────────────────────────────────────
// Everything above proves encBlobRemove() clears the hardware store. None of it proves the steward's button
// ever lets that finish. HANDOFF-2026-07-31 item 1: the one caller was
//
//     onClick={() => { window.Steward.removeKey(); window.location.reload(); }}
//
// removeKey() returns a promise (S6, so the Keystore half CAN be awaited) and this discarded it, so the
// reload could tear the WebView down mid-`SecureStorage.remove()`. The steward is told the church key is gone
// from this device; the ciphertext is still in the Keystore. That is precisely the exposure S6 closed, re-opened
// at the call site — and no test above can see it, because they all call encBlobRemove() directly.
//
// So this EXECUTES the real handler lifted out of app/stew-dashboard.jsx (a classic script the console loads
// as-is — there is no build step between that file and the phone) and asserts the ordering.
const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

// Lift the onClick={…} expression that contains `needle`, brace-matched rather than line- or regex-bounded so
// reformatting the JSX cannot silently stop this from matching the shipped handler.
function liftHandler(needle) {
  const hit = DASH.indexOf(needle);
  assert.ok(hit > 0, 'the removeKey call site is gone from stew-dashboard.jsx — re-anchor this test');
  const at = DASH.lastIndexOf('onClick={', hit);
  assert.ok(at > 0, 'removeKey() is no longer called from an onClick — re-anchor this test');
  const open = at + 'onClick='.length;
  let depth = 0, i = open;
  for (; i < DASH.length; i++) {
    const c = DASH[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  assert.ok(depth === 0, 'braces did not balance lifting the handler — re-anchor this test');
  assert.ok(i > hit, 'the brace match ended before the removeKey call — re-anchor this test');
  return DASH.slice(open + 1, i);            // the expression inside onClick={ … }
}

test('THE REMOVE BUTTON MUST NOT RELOAD OUT FROM UNDER THE KEYSTORE DELETION', async () => {
  const order = [];
  let resolveRemoval;
  // A Keystore that takes a moment, which is what it does on a real phone. Resolves only when we say so.
  const removal = new Promise(r => { resolveRemoval = () => { order.push('keystore-cleared'); r(true); }; });
  const win = {
    Steward: { removeKey: () => { order.push('removeKey-called'); return removal; } },
    location: { reload: () => { order.push('reload'); } },
  };
  const handler = new Function('window', 'return (' + liftHandler('window.Steward.removeKey()') + ');')(win);
  const ret = handler();

  // Let every microtask drain. A synchronous caller has already reloaded by now.
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(order, ['removeKey-called'],
    'the page reloaded while the Keystore removal was still in flight (' + order.join(' → ') + '). On a real ' +
    'device that tears down the WebView mid-remove(), so the church key ciphertext survives in the hardware ' +
    'store after the steward was told this device had forgotten it.');

  resolveRemoval();
  await ret;                                  // the handler must give the caller something to wait on
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(order, ['removeKey-called', 'keystore-cleared', 'reload'],
    'the reload did not follow the completed removal (' + order.join(' → ') + ')');
});

test('…and removeKey() actually hands back something to await', async () => {
  // The other half of the same invariant, and the half the two tests around it CANNOT see, because they stub
  // removeKey. If a later edit drops the `return done` (there used to be a dead `return true` sitting right
  // under it, inviting exactly that), the awaiting caller above still awaits — it just awaits `undefined`, which
  // resolves on the next microtask, and the race is silently back with every test still green.
  // Executes the SHIPPED method out of the bundle.
  const at = BUNDLE.indexOf('    removeKey() {');
  assert.ok(at > 0, 'removeKey() is gone from the bundle — re-anchor this test, or rebuild: bash scripts/build-steward.sh');
  const open = BUNDLE.indexOf('{', at);
  let depth = 0, i = open;
  for (; i < BUNDLE.length; i++) {
    const c = BUNDLE[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  const body = BUNDLE.slice(open + 1, i);
  let cleared = false;
  const sentinel = new Promise(r => setTimeout(() => { cleared = true; r('cleared'); }, 5));
  const win = { Steward: {}, dispatchEvent() {} };
  const fn = new Function('localStorage', 'KEY_LS', 'encBlobRemove', 'window', 'CustomEvent', body);
  const got = fn({ removeItem() {} }, 'k', () => sentinel, win, class { constructor(t, o) { this.type = t; Object.assign(this, o); } });

  assert.ok(got && typeof got.then === 'function',
    'removeKey() returned ' + String(got) + ' rather than a promise, so `await window.Steward.removeKey()` in ' +
    'the Remove & reload handler resolves immediately and reloads straight through the Keystore deletion again.');
  assert.equal(cleared, false, 'the hardware-store removal had already finished synchronously — re-check this test');
  assert.equal(await got, 'cleared', 'the promise removeKey() returned is not the hardware-store removal');
  assert.equal(win.Steward.hasKey, false, 'removeKey() no longer clears the in-memory key state');
});

test('…and a Keystore that throws still reloads, rather than trapping the steward on the page', async () => {
  // The safe direction. If remove() rejects we have still cleared localStorage, and a steward who pressed
  // "Remove & reload" and got neither a removal nor a reload has no way to tell what happened.
  const order = [];
  const win = {
    Steward: { removeKey: () => Promise.reject(new Error('keystore unavailable')) },
    location: { reload: () => { order.push('reload'); } },
  };
  const handler = new Function('window', 'return (' + liftHandler('window.Steward.removeKey()') + ');')(win);
  await handler();
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(order, ['reload'], 'a rejected removal left the steward on an unchanged page with no reload');
});

// ── a removal that gets cut off must finish later ────────────────────────────────────────────────────────
// AUDIT-2026-07-31. The Remove & reload handler races removeKey() against a 3s timeout, because a native
// bridge call can hang rather than throw and an unbounded await leaves a dead button. But encBlobRemove()
// cleared the localStorage marker FIRST — so if the timeout won, the reload fired mid-remove(), encBlobRaw()
// short-circuited on the missing marker, and the next boot looked perfectly clean while the church-key
// ciphertext sat in the Android Keystore. Nothing would ever try again: encBlobRemove() is only reached from
// removeKey() and forgetPin(), and both then find nothing to do.
//
// That is the exact failure S6 exists to prevent, reached by a different route — and the fix that introduced
// it shipped with no test at all, which is how it survived a sabotage pass.
test('A REMOVAL CUT OFF BY THE RELOAD IS FINISHED AT THE NEXT BOOT', async () => {
  const h = harness();
  await h.encBlobWrite(BLOB);
  assert.equal(h.store[h.KEY], BLOB, 'fixture: the blob should be in the hardware store');

  // The Keystore hangs — the case the 3s bound exists for. The page reloads out from under it.
  h.store.__failRemove = true;
  await h.encBlobRemove();
  assert.equal(h.store[h.KEY], BLOB, 'fixture: this removal was supposed to fail');
  assert.ok(h.lsData[h.PENDING],
    'nothing recorded that a removal was started, so the church key is now stranded in the hardware store ' +
    'with no marker, no caller, and nothing that will ever try to remove it again');

  // Next boot: the Keystore is working again.
  delete h.store.__failRemove;
  assert.equal(await h.encBlobRemoveResume(), true, 'the interrupted removal was not resumed at boot');
  assert.equal(h.store[h.KEY], undefined, 'the church-key ciphertext is STILL in the hardware store');
  assert.equal(h.lsData[h.PENDING], undefined, 'the breadcrumb was left behind, so every boot retries for ever');
});

test('…and a boot with no interrupted removal does nothing at all', async () => {
  const h = harness();
  await h.encBlobWrite(BLOB);
  assert.equal(await h.encBlobRemoveResume(), false, 'a normal boot tried to delete the church key');
  assert.equal(h.store[h.KEY], BLOB, 'a normal boot REMOVED the church key — catastrophic');
});

test('…and a successful removal leaves no breadcrumb to retry', async () => {
  const h = harness();
  await h.encBlobWrite(BLOB);
  await h.encBlobRemove();
  assert.equal(h.lsData[h.PENDING], undefined,
    'a clean removal still left the retry marker, so the next boot re-runs a delete that already succeeded');
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
