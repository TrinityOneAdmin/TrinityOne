// "STAY OPEN FOR 30 DAYS" ON THE STEWARD CONSOLE: NEVER THE PIN, NEVER A FILE, AND THE BOX TELLS THE TRUTH.
// Run: node --test scripts/stayopen-is-kept-in-the-keystore.test.mjs
//
// What it was: ticking the box saved `{ p: <the PIN in plaintext>, until }` to localStorage on every platform,
// and the next launch replayed `Steward.unlock(p)`. Threat model (owner): UK pilot, lawful compulsion and DEVICE
// SEIZURE — a plaintext PIN in a file comes straight off a forensic image. The box always drew unticked even
// while stay-open was active ("works but doesn't visually stick"), an expired record was ignored but never
// deleted, and nothing cleared it when the PIN changed.
//
// What it is now (makeStayOpen, src/steward.src.js): native only, in the Keystore-backed SecureStorage, and it
// keeps the PBKDF2 output for the current blob — not the PIN. A browser is not offered the box at all.
//
// RULE 1: the real StewardUnlock (app/steward-root.jsx) is mounted through console-screens.mjs and driven by its
// own controls. RULE 3: nothing here matches text in a .jsx file. The stay-open engine and the Steward methods
// the screen calls are LIFTED FROM THE SHIPPED BUNDLE (vendor/steward.js) and run for real over real WebCrypto.
// What is faked: the hardware store (a map), the platform answer (native or not), the clock, and unlock(pin)
// itself — the fake decrypts the same kind of blob the real one does, at a low iteration count so the suite is
// fast (the blob carries its own count, exactly as a real v2 blob does).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';
import { fnBody } from './test-slice.mjs';

const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const SS_KEY = BUNDLE.match(/var STAY_SS = "([^"]+)"/)[1];
const LEGACY = 'trinityone.steward.stayopen';
const PIN = 'cedar-harbour-lamp-42';
const SEED = 'fine flash wait silly next awkward charge front scout build damage river';
const DAY = 24 * 60 * 60 * 1000;

// ── the shipped engine, lifted ──────────────────────────────────────────────────────────────────────────────
const constFrom = (name) => {
  const m = BUNDLE.match(new RegExp('var ' + name + ' = ([^;\\n]+);'));
  assert.ok(m, name + ' is gone from the bundle — re-anchor, or rebuild: bash scripts/build-steward.sh');
  return 'var ' + name + ' = ' + m[1] + ';';
};
const ENGINE_SRC = [constFrom('STAY_LEGACY_LS'), constFrom('STAY_SS'), constFrom('STAY_TTL_MS'), constFrom('PIN_ITER_LEGACY'),
  constFrom('b64e'), constFrom('b64d'),
  fnBody(BUNDLE, 'async function deriveAesBits(', 'deriveAesBits'),
  fnBody(BUNDLE, 'function makeStayOpen(deps) {', 'makeStayOpen')].join('\n');
// the Steward methods the screen calls, out of the shipped object literal
const METHODS = ['stayOpenStatus() {', 'setStayOpen(pin, on) {', 'clearStayOpen() {', 'async unlockStayOpen() {', 'lock(reason) {']
  .map(a => fnBody(BUNDLE, BUNDLE.indexOf('    ' + a) + 4, a)).join(',\n');

function engine() {
  return new Function('crypto', 'console', 'btoa', 'atob', ENGINE_SRC + '\nreturn { makeStayOpen, deriveAesBits, b64e, b64d };')(
    webcrypto, { warn() {}, log() {} }, btoa, atob);
}

// A fake hardware store shaped like the Capacitor proxy (see console-key-secure-store.test.mjs for why).
function hardwareStore() {
  const map = {};
  const impl = {
    get: async (k) => { if (k === SS_KEY && hw.failGet > 0) { hw.failGet--; throw new Error('keystore slow'); } return k in map ? map[k] : null; },
    set: async (k, v) => { map[k] = String(v); },
    remove: async (k) => { if (hw.failRemove > 0) { hw.failRemove--; if (hw.silent) return; throw new Error('keystore busy'); } delete map[k]; },
  };
  const S = new Proxy(impl, { get: (t, p) => (p in t ? t[p] : (typeof p === 'symbol' ? undefined : () => { throw new Error('"SecureStorage.' + String(p) + '()" is not implemented on android'); })) });
  const hw = { map, S, failRemove: 0, silent: false, failGet: 0 };
  return hw;
}

// A real v2-shaped church-key blob: PBKDF2(pin, salt, it) → AES-GCM over the seed.
async function makeBlob(pin, seed, it = 1000) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16)), iv = webcrypto.getRandomValues(new Uint8Array(12));
  const base = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: it, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(seed)));
  const b = (u) => Buffer.from(u).toString('base64');
  return JSON.stringify({ v: 2, it, salt: b(salt), iv: b(iv), ct: b(ct) });
}
async function openBlob(pin, blobStr) {
  const o = JSON.parse(blobStr), d = (s) => new Uint8Array(Buffer.from(s, 'base64'));
  const base = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt: d(o.salt), iterations: o.it, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return new TextDecoder().decode(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: d(o.iv) }, key, d(o.ct)));
}

// One "device": a hardware store, a localStorage, a church-key blob and a clock that persist across launches.
function device({ native = true } = {}) {
  return { native, hw: hardwareStore(), lsSeed: {}, blob: null, clock: Date.UTC(2026, 9, 10), unlockCalls: 0, blobFail: 0, blobFailMode: 'empty' };
}

// One LAUNCH of the console on that device: a fresh engine (fresh module state), a fresh screen, locked.
function launch(dev, { manualTimers = false } = {}) {
  const r = fakeReact();
  const b = fakeBrowser();
  const timers = [];   // with manualTimers the screen's setTimeout calls are RECORDED, not run: { f, ms }
  if (manualTimers) { b.window.setTimeout = (f, ms) => { timers.push({ f, ms }); return timers.length; }; b.window.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; }; }
  for (const [k, v] of Object.entries(dev.lsSeed)) b.localStorage.setItem(k, v);
  dev.ls = b.localStorage;
  const lib = engine();
  const stay = lib.makeStayOpen({
    secure: async () => ({ S: dev.hw.S }), isNative: () => dev.native, lsRemove: (k) => b.localStorage.removeItem(k),
    now: () => dev.clock, deriveBits: lib.deriveAesBits, pubOf: (m) => 'owner:' + m.split(' ')[0],
    // the shipped encBlobRaw answers '' both for "nothing there" and for "the store would not answer", and
    // THROWS for a lost device key; markerPresent is what tells the first from the second
    readBlob: async () => { if (dev.blobFail > 0) { dev.blobFail--; if (dev.blobFailMode === 'throw') throw new Error('keystore slow'); return ''; } return dev.blob || ''; },
    markerPresent: () => !!dev.blob,
  });
  const entered = [];
  const Steward = fakeSteward({ hasKey: false, locked: true, needsPin: false, keyStoreStuck: false, deviceKeyLost: false });
  const enter = (seed) => { entered.push(seed); Steward.hasKey = true; Steward.locked = false; b.window.dispatch('steward-key', { type: 'steward-key' }); };
  Steward.unlock = async (pin) => {
    dev.unlockCalls++;
    try { enter(await openBlob(pin, dev.blob)); return true; } catch (e) { return false; }
  };
  // the SHIPPED wrappers, bound to this launch's engine
  // lock(reason) is the SHIPPED method; its key-material variables are declared here so it does not leak globals
  const shipped = new Function('_stay', '_enterUnlocked', 'window', 'lsGet', 'CustomEvent',
    'const ENC_LS = "enc"; let needsPin = false, sk = null, pub = null, currentMnemonic = null, churchSk = null, churchPub = null; return ({ ' + METHODS + ' });')(
    stay, enter, b.window, () => (dev.blob ? 'marker' : null), b.window.CustomEvent);
  for (const k of Object.keys(shipped)) Steward[k] = shipped[k].bind(shipped);
  b.window.Steward = Steward;
  const { StewardUnlock } = loadConsole({ React: r.React, window: b.window, expr: '{ StewardUnlock }' });
  let tree;
  const draw = () => { r.reset(); tree = StewardUnlock({}); r.flush(); return tree; };
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(res => setImmediate(res)); };
  const box = () => nodes(tree).find(n => n.type === 'input' && n.props.type === 'checkbox');
  const pinField = () => nodes(tree).find(n => n.type === 'input' && n.props['aria-label'] === 'Your console PIN or passphrase');
  const unlockBtn = () => nodes(tree).find(n => n.type === 'button' && /Unlock/.test(texts(n).join(' ')));
  const mount = async () => { draw(); await settle(); draw(); };
  const typeAndUnlock = async (pin, tick) => {
    pinField().props.onChange({ target: { value: pin } }); draw();
    if (tick !== undefined) { assert.ok(box(), 'no stay-open box to set'); box().props.onChange({ target: { checked: tick } }); draw(); }
    await unlockBtn().props.onClick(); await settle();
  };
  // fresh(): the screen UNMOUNTS and a new instance mounts later, as React does when the lock screen comes back
  const idleLock = () => { Steward.lock('idle'); b.window.dispatch('steward-key', { type: 'steward-key' }); };
  return { Steward, stay, entered, idleLock, window: b.window, timers, vis: () => b.window.document.dispatch('visibilitychange', {}), draw, mount, fresh: () => r.fresh(), box, typeAndUnlock, settle, unmount: () => r.unmount(), lsKeys: () => [...Array(b.localStorage.length)].map((_, i) => b.localStorage.key(i)) };
}
const persist = (dev) => { dev.lsSeed = {}; for (let i = 0; i < dev.ls.length; i++) { const k = dev.ls.key(i); dev.lsSeed[k] = dev.ls.getItem(k); } };

test('(a) native: tick + unlock keeps a record in the hardware store, and NOTHING PIN-like anywhere in localStorage', async () => {
  const dev = device(); dev.blob = await makeBlob(PIN, SEED);
  const L = launch(dev);
  await L.mount();
  assert.ok(L.box(), 'THE POINT OF USE: the steward APK’s lock screen shows no "Stay open" box');
  assert.equal(L.box().props.checked, false, 'the box starts ticked with no record on the device');
  await L.typeAndUnlock(PIN, true);
  assert.equal(L.Steward.hasKey, true, 're-anchor: the PIN did not unlock');
  for (const k of L.lsKeys()) assert.ok(!String(dev.ls.getItem(k)).includes(PIN), 'the PIN is in localStorage under ' + k);
  assert.equal(dev.ls.getItem(LEGACY), null, 'the old plaintext record was written');
  const raw = dev.hw.map[SS_KEY];
  assert.ok(raw, 'ticking the box kept nothing in the hardware store');
  assert.ok(!raw.includes(PIN), 'the hardware-store record holds the PIN itself');
  const rec = JSON.parse(raw);
  assert.equal(rec.owner, 'owner:fine', 'the record does not name the church it was made for');
  assert.equal(rec.until, dev.clock + 30 * DAY, 'the record does not expire in 30 days');
  L.unmount();
});

test('(b) relaunch: the record opens the console by itself, as the right church', async () => {
  const dev = device(); dev.blob = await makeBlob(PIN, SEED);
  const L1 = launch(dev); await L1.mount(); await L1.typeAndUnlock(PIN, true); persist(dev); L1.unmount();
  dev.unlockCalls = 0;
  const L2 = launch(dev);
  await L2.mount();
  assert.equal(L2.Steward.hasKey, true, 'THE FEATURE: a relaunch with a live stay-open record still asks for the PIN');
  assert.deepEqual(L2.entered, [SEED], 'the replay entered with the wrong seed');
  assert.equal(dev.unlockCalls, 0, 'the replay went through unlock(pin) — so something is still holding a PIN');
  L2.unmount();
});

test('(c) after a lock the box shows TICKED; untick + unlock deletes the record', async () => {
  const dev = device(); dev.blob = await makeBlob(PIN, SEED);
  const L1 = launch(dev); await L1.mount(); await L1.typeAndUnlock(PIN, true); persist(dev); L1.unmount();
  const L = launch(dev);
  await L.mount();                                       // relaunch: replayed and open
  assert.equal(L.Steward.hasKey, true, 're-anchor: the relaunch did not replay');
  L.fresh();
  // a lock that does NOT re-arm replay (the engine latch is still used up from the cold start; a real idle lock
  // now re-arms it, see test (i)): the same launch, the screen comes back as a NEW instance
  L.Steward.hasKey = false; L.Steward.locked = true;
  await L.mount();
  assert.equal(L.Steward.hasKey, false, 'a lock that did not re-arm replay reopened by itself — the once-per-mount latch is gone');
  assert.ok(L.box(), 're-anchor: no box after a lock');
  assert.equal(L.box().props.checked, true, 'THE DEFECT: stay-open is active and the box draws UNTICKED');
  await L.typeAndUnlock(PIN, false);
  assert.equal(L.Steward.hasKey, true, 're-anchor: the PIN did not unlock');
  assert.equal(dev.hw.map[SS_KEY], undefined, 'unticking and unlocking left the stay-open record in the hardware store');
  L.unmount();
});

test('(d) a browser: no box at all, and nothing is kept', async () => {
  const dev = device({ native: false }); dev.blob = await makeBlob(PIN, SEED);
  const L = launch(dev);
  await L.mount();
  assert.equal(L.box(), undefined, 'THE DEFECT: a plain browser is offered "Stay open for 30 days" — there is nowhere safe to keep it');
  assert.ok(nodes(L.draw()).some(n => n.type === 'button' && /Unlock/.test(texts(n).join(' '))), 're-anchor: the browser lock screen has no Unlock');
  await L.typeAndUnlock(PIN);
  assert.equal(L.Steward.hasKey, true, 're-anchor: the PIN did not unlock');
  assert.deepEqual(Object.keys(dev.hw.map), [], 'something was written to a hardware store in a browser');
  for (const k of L.lsKeys()) assert.ok(!String(dev.ls.getItem(k)).includes(PIN), 'the PIN is in localStorage under ' + k);
  L.unmount();
});

for (const native of [true, false]) {
  test('(e) ' + (native ? 'native' : 'browser') + ': a legacy plaintext-PIN record is deleted on load and NOT used', async () => {
    const dev = device({ native }); dev.blob = await makeBlob(PIN, SEED);
    dev.lsSeed[LEGACY] = JSON.stringify({ p: PIN, until: dev.clock + 10 * DAY });
    const L = launch(dev);
    await L.mount();
    assert.equal(dev.ls.getItem(LEGACY), null, 'the plaintext PIN is still in localStorage after the lock screen loaded');
    assert.equal(dev.unlockCalls, 0, 'the legacy plaintext PIN was replayed');
    assert.equal(L.Steward.hasKey, false, 'the console opened from the legacy plaintext record');
    if (native) assert.equal(L.box().props.checked, false, 'a legacy record shows as an active stay-open');
    L.unmount();
  });
}

test('(f) an expired record is DELETED when read, and the box is unticked', async () => {
  const dev = device(); dev.blob = await makeBlob(PIN, SEED);
  const L1 = launch(dev); await L1.mount(); await L1.typeAndUnlock(PIN, true); persist(dev); L1.unmount();
  assert.ok(dev.hw.map[SS_KEY], 're-anchor: no record was made');
  dev.clock += 30 * DAY + 1;
  const L = launch(dev);
  await L.mount();
  assert.equal(L.Steward.hasKey, false, 'an expired stay-open record still opened the console');
  assert.equal(dev.hw.map[SS_KEY], undefined, 'an expired record was ignored but left in the hardware store');
  assert.equal(L.box().props.checked, false, 'an expired record draws the box ticked');
  L.unmount();
});

test('a failed replay deletes the record — wrong church, or bytes that do not open the blob', async () => {
  for (const spoil of ['owner', 'key']) {
    const dev = device(); dev.blob = await makeBlob(PIN, SEED);
    const L1 = launch(dev); await L1.mount(); await L1.typeAndUnlock(PIN, true); persist(dev); L1.unmount();
    const rec = JSON.parse(dev.hw.map[SS_KEY]);
    if (spoil === 'owner') rec.owner = 'owner:someone-else';
    else rec.k = Buffer.from(new Uint8Array(32)).toString('base64');
    dev.hw.map[SS_KEY] = JSON.stringify(rec);
    const L = launch(dev);
    await L.mount();
    assert.equal(L.Steward.hasKey, false, 'a spoiled record (' + spoil + ') opened the console');
    assert.equal(dev.hw.map[SS_KEY], undefined, 'a failed replay (' + spoil + ') left the record behind');
    assert.equal(L.box().props.checked, false, 'after a failed replay the box still draws ticked');
    L.unmount();
  }
});

test('a record made under an old PIN cannot open the blob a new PIN wrote — and is deleted on sight', async () => {
  const dev = device(); dev.blob = await makeBlob(PIN, SEED);
  const L1 = launch(dev); await L1.mount(); await L1.typeAndUnlock(PIN, true); persist(dev); L1.unmount();
  dev.blob = await makeBlob('a-brand-new-passphrase', SEED);   // what setPin writes: same seed, new salt
  const L = launch(dev);
  await L.mount();
  assert.equal(L.Steward.hasKey, false, 'the old PIN’s stay-open record opened the blob written by the new PIN');
  assert.equal(dev.hw.map[SS_KEY], undefined, 'the dead record was left in the hardware store');
  L.unmount();
});

// ── (g) the paths that end it, run out of the shipped bundle ──────────────────────────────────────────────
function liftMethod(anchor, scope) {
  const names = Object.keys(scope);
  const src = fnBody(BUNDLE, BUNDLE.indexOf('    ' + anchor) + 4, anchor);
  return new Function(...names, 'return ({ ' + src + ' });')(...names.map(n => scope[n]));
}
async function deviceWithRecord() {
  const dev = device(); dev.blob = await makeBlob(PIN, SEED);
  const L1 = launch(dev); await L1.mount(); await L1.typeAndUnlock(PIN, true); persist(dev); L1.unmount();
  assert.ok(dev.hw.map[SS_KEY], 're-anchor: no record to clear');
  return { dev, stay: launch(dev).stay };
}

test('(g) changing the PIN (setPin) deletes the stay-open record', async () => {
  const { dev, stay } = await deviceWithRecord();
  const store = {};
  const o = liftMethod('async setPin(pin) {', {
    currentMnemonic: SEED, KEY_LS: 'k', ENC_LS: 'e', PIN_ITER: 10,
    lsGet: (k) => store[k] || null, localStorage: { removeItem: (k) => { delete store[k]; } },
    deriveAes: async () => webcrypto.subtle.importKey('raw', new Uint8Array(32), 'AES-GCM', false, ['encrypt']),
    b64e: (u) => Buffer.from(u).toString('base64'), _setNeedsPin: () => {},
    encBlobWrite: async () => true, _stay: stay, crypto: webcrypto, window: {},
  });
  assert.equal(await o.setPin('a-brand-new-passphrase'), true, 're-anchor: setPin refused');
  assert.equal(dev.hw.map[SS_KEY], undefined, 'THE DEFECT: a new PIN left the stay-open record in place');
});

test('(g) removing the lock, removing the church, and restoring from 12 words each delete it', async () => {
  {
    const { dev, stay } = await deviceWithRecord();
    const o = liftMethod('async removeLock(pin) {', { currentMnemonic: SEED, lsGet: () => '{}', ENC_LS: 'e', _setNeedsPin: () => {}, _stay: stay,
      window: { Steward: { verifyPin: async () => true } } });
    assert.equal(await o.removeLock(PIN), true, 're-anchor: removeLock refused');
    assert.equal(dev.hw.map[SS_KEY], undefined, 'removeLock left the stay-open record');
  }
  {
    const { dev, stay } = await deviceWithRecord();
    const o = liftMethod('removeKey() {', { localStorage: { removeItem() {} }, KEY_LS: 'k', encBlobRemove: async () => true, _stay: stay,
      _minorsLastClear: () => {},   // fix/child-safety-leaks' sealed children lists — inert here; that file tests its own clear
      window: { Steward: {}, dispatchEvent() {} }, CustomEvent: class {} });
    await o.removeKey(); await new Promise(r => setImmediate(r));
    assert.equal(dev.hw.map[SS_KEY], undefined, 'removeKey ("Remove this church from this device") left the stay-open record');
  }
  {
    const { dev, stay } = await deviceWithRecord();
    const o = liftMethod('restoreKey(mnemonic) {', { validateMnemonic: () => true, wordlist: [], setKey: () => {}, _resetChurchScopedState: () => {},
      _setNeedsPin: () => {}, _stay: stay, window: { Steward: {}, dispatchEvent() {} }, CustomEvent: class {} });
    o.restoreKey(SEED); await new Promise(r => setImmediate(r));
    assert.equal(dev.hw.map[SS_KEY], undefined, 'restoreKey (12 words) left the stay-open record');
  }
});

test('(g) "Restore this church with my 12 words" on the lock screen clears it before reloading', async () => {
  const dev = device(); dev.blob = await makeBlob(PIN, SEED);
  const L1 = launch(dev); await L1.mount(); await L1.typeAndUnlock(PIN, true); persist(dev); L1.unmount();
  const L = launch(dev);
  // reach the lost-key state through the screen's own path: unlock() reports the device key gone
  L.Steward.unlock = async () => { L.Steward.deviceKeyLost = true; return false; };
  await L.mount(); L.fresh();   // the launch replays (and opens) first — lock again, as the idle timer would
  L.Steward.hasKey = false; L.Steward.locked = true;
  await L.mount();
  await L.typeAndUnlock(PIN);
  const tree = L.draw();
  const btn = nodes(tree).find(n => n.type === 'button' && texts(n).join(' ').includes('Restore this church with my 12 words'));
  assert.ok(btn, 're-anchor: the lost-key screen has no "Restore this church with my 12 words"');
  // location.reload is a no-op in fakeBrowser; the question is what it awaited first. The handler's own 3 s
  // guard timer is unref'd by fakeBrowser, so hold the loop open for it — otherwise a handler that awaits ONLY
  // the guard is reported as "cancelled" instead of failing the assertion below.
  const hold = setTimeout(() => {}, 5000);
  try { await btn.props.onClick(); } finally { clearTimeout(hold); }
  assert.equal(dev.hw.map[SS_KEY], undefined, 'the restore-from-12-words button reloaded with the stay-open record still in the hardware store');
  L.unmount();
});

// ── a removal the Keystore could not do ───────────────────────────────────────────────────────────────────
// clear() used to swallow a failed S.remove, and save(pin, false) - the steward UNTICKING the box - answered
// "done" over a record that was still there and still opening the church.
test('(h) the engine does not claim an untick worked when the record is still in the hardware store', async () => {
  const dev = device(); dev.blob = await makeBlob(PIN, SEED);
  const L = launch(dev); await L.mount(); await L.typeAndUnlock(PIN, true);
  assert.ok(dev.hw.map[SS_KEY], 're-anchor: no record was made');
  dev.hw.failRemove = 1;
  assert.equal(await L.stay.save(PIN, false), false, 'save(off) said true over a record that is still in the Keystore');
  assert.ok(dev.hw.map[SS_KEY], 're-anchor: the failing remove did not leave the record');
  assert.equal(await L.stay.save(PIN, false), true, 'a removal that worked was not reported');
  assert.equal(dev.hw.map[SS_KEY], undefined);
  // and the quieter way to fail: remove() RESOLVES but the record is still there. Only reading it back sees that.
  await L.stay.save(PIN, true);
  dev.hw.failRemove = 1; dev.hw.silent = true;
  assert.equal(await L.stay.save(PIN, false), false, 'a remove() that resolved without deleting was reported as done');
  assert.ok(dev.hw.map[SS_KEY], 're-anchor: the silent remove deleted the record');
  L.unmount();
});

test('(h) POINT OF USE: untick + unlock when the first removal fails still ends with the record gone', async () => {
  const dev = device(); dev.blob = await makeBlob(PIN, SEED);
  const L1 = launch(dev); await L1.mount(); await L1.typeAndUnlock(PIN, true); persist(dev); L1.unmount();
  const L = launch(dev); await L.mount(); L.fresh();
  L.Steward.hasKey = false; L.Steward.locked = true;
  await L.mount();
  assert.equal(L.box().props.checked, true, 're-anchor: the box is not ticked after a lock');
  dev.hw.failRemove = 1;
  await L.typeAndUnlock(PIN, false);
  assert.equal(L.Steward.hasKey, true, 're-anchor: the PIN did not unlock');
  assert.equal(dev.hw.map[SS_KEY], undefined, 'the steward unticked the box, the first removal failed, and the key stayed in the Keystore');
  L.unmount();
});

// ── (i) an IDLE lock reopens from the live record (owner decision 2026-10-15) ─────────────────────────────────
// Device-confirmed on a Pixel: stay-open survived a hard restart but not the idle auto-lock, because a
// backgrounded WebView keeps the module alive and the once-per-launch latch stayed used up. The record was alive
// and valid, and unlockStayOpen() answered null ("skipped") over it.
test('(i) POINT OF USE: tick + unlock, then the IDLE lock — the console reopens by itself from the record, no PIN typed', async () => {
  const dev = device(); dev.blob = await makeBlob(PIN, SEED);
  const L = launch(dev); await L.mount(); await L.typeAndUnlock(PIN, true);
  assert.ok(dev.hw.map[SS_KEY], 're-anchor: no record was made');
  assert.equal(L.entered.length, 1);
  dev.unlockCalls = 0;
  L.idleLock();                                  // the SHIPPED lock('idle'): same module, same latch, same launch
  assert.equal(L.Steward.hasKey, false, 're-anchor: the idle lock did not lock');
  L.fresh(); await L.mount();
  assert.equal(L.Steward.hasKey, true, 'THE DEFECT: after an idle lock the console stays on the PIN prompt although the stay-open record is alive');
  assert.deepEqual(L.entered, [SEED, SEED], 'the idle replay entered with the wrong seed');
  assert.equal(dev.unlockCalls, 0, 'the idle replay went through unlock(pin)');
  assert.ok(dev.hw.map[SS_KEY], 'the idle replay deleted the record');
  // and it keeps working: a SECOND idle lock reopens again
  L.idleLock(); L.fresh(); await L.mount();
  assert.equal(L.Steward.hasKey, true, 'a second idle lock did not reopen');
  L.unmount();
});

test('(i) a lock that is NOT idle still locks (only lock("idle") re-arms replay)', async () => {
  const dev = device(); dev.blob = await makeBlob(PIN, SEED);
  const L = launch(dev); await L.mount(); await L.typeAndUnlock(PIN, true);
  L.Steward.lock(); L.window.dispatch('steward-key', {});
  L.fresh(); await L.mount();
  assert.equal(L.Steward.hasKey, false, 'a lock with no reason reopened by itself');
  assert.equal(L.box().props.checked, true, 'the box is not ticked after a plain lock');
  L.unmount();
});

test('(i) POINT OF USE: the console idle timer (StewardRoot) calls lock("idle")', () => {
  const r = fakeReact(), b = fakeBrowser(), calls = [], timers = [];
  b.window.setTimeout = (f, ms) => { timers.push({ f, ms }); return timers.length; }; b.window.clearTimeout = () => {};
  b.window.Steward = fakeSteward({ hasKey: true, locked: false, needsPin: false, hasPinLock: () => true, lock: (...a) => { calls.push(a); }, selfRegister: async () => {} });
  const { StewardRoot } = loadConsole({ React: r.React, window: b.window, expr: '{ StewardRoot }' });
  r.reset(); StewardRoot({}); r.flush();
  const idle = timers.filter(t => t.ms === 10 * 60 * 1000);
  assert.equal(idle.length >= 1, true, 're-anchor: StewardRoot armed no 10-minute idle timer');
  idle[idle.length - 1].f();
  assert.deepEqual(calls, [['idle']], 'THE POINT OF USE: the idle timer did not lock with the reason "idle", so the lock cannot re-arm stay-open');
  r.unmount();
});

// ── (j) a store that did not answer is not a dead record ──────────────────────────────────────────────────────
for (const mode of ['store-throws', 'blob-empty', 'blob-throws']) {
  test('(j) transient miss (' + mode + ') on resume: the record SURVIVES, the box stays ticked, and a retry reopens with no PIN', async () => {
    const dev = device(); dev.blob = await makeBlob(PIN, SEED);
    const L1 = launch(dev); await L1.mount(); await L1.typeAndUnlock(PIN, true); persist(dev); L1.unmount();
    const before = dev.hw.map[SS_KEY]; dev.unlockCalls = 0;
    if (mode === 'store-throws') dev.hw.failGet = 2; else { dev.blobFail = 2; dev.blobFailMode = mode === 'blob-throws' ? 'throw' : 'empty'; }
    const L = launch(dev, { manualTimers: true });
    await L.mount();
    assert.equal(L.Steward.hasKey, false, 're-anchor: the failing read opened the console');
    assert.equal(dev.hw.map[SS_KEY], before, 'THE DEFECT: a slow Keystore read DELETED the live 30-day record');
    assert.equal(L.box().props.checked, true, 'the box was unticked over a record that is still alive');
    assert.ok(L.timers.some(t => t.ms === 1000), 'no retry was scheduled after a transient miss');
    dev.hw.failGet = 0; dev.blobFail = 0;
    L.timers.shift().f(); await L.settle();       // the first backoff fires; the store answers now
    assert.equal(L.Steward.hasKey, true, 'the retry did not reopen the console');
    assert.deepEqual(L.entered, [SEED]);
    assert.equal(dev.unlockCalls, 0, 'the retry went through unlock(pin)');
    assert.equal(dev.hw.map[SS_KEY], before, 'the retry changed the record');
    L.unmount();
  });
}

test('(j) a transient miss is also retried when the app comes back to the foreground', async () => {
  const dev = device(); dev.blob = await makeBlob(PIN, SEED);
  const L1 = launch(dev); await L1.mount(); await L1.typeAndUnlock(PIN, true); persist(dev); L1.unmount();
  dev.hw.failGet = 2;   // status() and replay() each read once
  const L = launch(dev, { manualTimers: true }); await L.mount();
  assert.equal(L.Steward.hasKey, false);
  L.vis(); await L.settle();
  assert.equal(L.Steward.hasKey, true, 'visibilitychange→visible did not retry the stay-open replay');
  L.unmount();
});

test('(j) a transient miss that never clears: bounded backoff 1s/2s/4s/8s, then the PIN prompt — record untouched, the PIN still works', async () => {
  const dev = device(); dev.blob = await makeBlob(PIN, SEED);
  const L1 = launch(dev); await L1.mount(); await L1.typeAndUnlock(PIN, true); persist(dev); L1.unmount();
  const before = dev.hw.map[SS_KEY];
  dev.hw.failGet = 1e6;
  const L = launch(dev, { manualTimers: true }); await L.mount();
  const waited = [];
  for (let i = 0; i < 10 && L.timers.length; i++) { const t = L.timers.shift(); waited.push(t.ms); t.f(); await L.settle(); }
  assert.deepEqual(waited, [1000, 2000, 4000, 8000], 'the retry budget is not 1s,2s,4s,8s');
  L.draw();
  assert.equal(L.Steward.hasKey, false);
  assert.equal(dev.hw.map[SS_KEY], before, 'running out of retries deleted the record');
  assert.equal(L.box().props.checked, true, 'running out of retries unticked the box');
  dev.hw.failGet = 0;
  await L.typeAndUnlock(PIN);                   // the prompt is usable: the typed PIN opens it
  assert.equal(L.Steward.hasKey, true, 'after the budget the PIN prompt did not work');
  L.unmount();
});

// ── (k) a record that is DEFINITELY dead is still deleted, and the prompt shows ───────────────────────────────
test('(k) malformed record, wrong version, and an unreadable-JSON record are deleted at once (not retried)', async () => {
  for (const spoil of ['not json', JSON.stringify({ v: 9 })]) {
    const dev = device(); dev.blob = await makeBlob(PIN, SEED);
    const L1 = launch(dev); await L1.mount(); await L1.typeAndUnlock(PIN, true); persist(dev); L1.unmount();
    dev.hw.map[SS_KEY] = spoil;
    const L = launch(dev, { manualTimers: true }); await L.mount();
    assert.equal(L.Steward.hasKey, false);
    assert.equal(dev.hw.map[SS_KEY], undefined, 'a dead record (' + spoil + ') was kept');
    assert.equal(L.timers.length, 0, 'a dead record was retried');
    assert.equal(L.box().props.checked, false, 'a dead record leaves the box ticked');
    L.unmount();
  }
});

test('(k) a blob that WAS read, with a different salt, is dead: record deleted (the engine asked the store and it answered)', async () => {
  const dev = device(); dev.blob = await makeBlob(PIN, SEED);
  const L1 = launch(dev); await L1.mount(); await L1.typeAndUnlock(PIN, true); persist(dev); L1.unmount();
  dev.blob = await makeBlob(PIN, SEED);          // same PIN, new salt
  const L = launch(dev, { manualTimers: true }); await L.mount();
  assert.equal(dev.hw.map[SS_KEY], undefined, 'a salt mismatch against a readable blob was kept');
  assert.equal(L.timers.length, 0);
  assert.equal(L.box().props.checked, false);
  L.unmount();
});

// ── (l) a typed wrong PIN is exactly what it was ──────────────────────────────────────────────────────────────
test('(l) a wrong TYPED PIN counts toward the guard, says so, and does not touch a live stay-open record', async () => {
  const dev = device(); dev.blob = await makeBlob(PIN, SEED);
  const L1 = launch(dev); await L1.mount(); await L1.typeAndUnlock(PIN, true); persist(dev); L1.unmount();
  const before = dev.hw.map[SS_KEY];
  dev.hw.failGet = 1e6;                          // keep it on the prompt: the store never answers
  const L = launch(dev, { manualTimers: true }); await L.mount();
  while (L.timers.length) { L.timers.shift().f(); await L.settle(); }
  dev.hw.failGet = 0;
  for (let i = 1; i <= 2; i++) {
    await L.typeAndUnlock('not-the-pin-' + i);
    assert.equal(L.Steward.hasKey, false, 'a wrong PIN unlocked');
    assert.equal(JSON.parse(dev.ls.getItem('trinityone.steward.pinguard')).fails, i, 'the failed-attempt counter did not move');
    assert.match(texts(L.draw()).join(' '), /Wrong PIN/, 'no wrong-PIN message');
    assert.equal(dev.hw.map[SS_KEY], before, 'a wrong typed PIN touched the stay-open record');
  }
  L.unmount();
});

// ── (m) a failed replay does not loop ─────────────────────────────────────────────────────────────────────────
test('(m) a failed (dead) replay runs once: no retry timer, no re-run on visibilitychange, record gone, prompt shown', async () => {
  const dev = device(); dev.blob = await makeBlob(PIN, SEED);
  const L1 = launch(dev); await L1.mount(); await L1.typeAndUnlock(PIN, true); persist(dev); L1.unmount();
  const rec = JSON.parse(dev.hw.map[SS_KEY]); rec.k = Buffer.from(new Uint8Array(32)).toString('base64'); dev.hw.map[SS_KEY] = JSON.stringify(rec);
  const L = launch(dev, { manualTimers: true });
  let calls = 0; const real = L.Steward.unlockStayOpen; L.Steward.unlockStayOpen = (...a) => { calls++; return real(...a); };
  await L.mount();
  L.vis(); await L.settle(); L.vis(); await L.settle();
  assert.equal(calls, 1, 'a failed replay was run again (' + calls + ' calls)');
  assert.equal(L.timers.length, 0, 'a failed replay scheduled a retry');
  assert.equal(dev.hw.map[SS_KEY], undefined);
  assert.equal(L.Steward.hasKey, false);
  assert.equal(L.box().props.checked, false);
  // and the idle path cannot loop it either: re-arm finds no record
  L.Steward.lock('idle'); L.fresh(); await L.mount();
  assert.equal(calls, 1, 'the idle re-arm replayed a record that was already deleted');
  assert.equal(L.Steward.hasKey, false);
  L.unmount();
});

// ── (n) a typed PIN beats the automatic replay (the box was dead for ~15s after an idle resume) ───────────────
// The replay owns `busy` while it backs off 1s/2s/4s/8s; the button was disabled for that whole time, so a
// steward who typed the PIN straight away could not submit it. Now the typed PIN cancels the replay (deleting
// nothing) and unlocks at once. Driven through the real StewardUnlock, with the shipped engine behind it.
const mainButton = (L) => nodes(L.draw()).find(n => n.type === 'button' && /Unlock|Reopening|Unlocking/.test(texts(n).join(' ')));
test('(n) POINT OF USE: while the replay is backing off, a typed PIN unlocks at once — no timers drained, record untouched, no retry left', async () => {
  const dev = device(); dev.blob = await makeBlob(PIN, SEED);
  const L1 = launch(dev); await L1.mount(); await L1.typeAndUnlock(PIN, true); persist(dev); L1.unmount();
  const before = dev.hw.map[SS_KEY];
  dev.hw.failGet = 2;
  const L = launch(dev, { manualTimers: true }); await L.mount();
  assert.equal(L.Steward.hasKey, false);
  assert.ok(L.timers.some(t => t.ms === 1000), 'not in the replay backoff: the test is not at the point of the defect');
  dev.hw.failGet = 0;
  const pinField = () => nodes(L.draw()).find(n => n.type === 'input' && n.props['aria-label'] === 'Your console PIN or passphrase');
  assert.equal(mainButton(L).props.disabled, true, 're-anchor: with no PIN typed the button is disabled');
  assert.match(texts(L.draw()).join(' '), /Reopening automatically/, 'the hint is missing');
  pinField().props.onChange({ target: { value: PIN } });
  const btn = mainButton(L);
  assert.equal(btn.props.disabled, false, 'THE DEFECT: a typed PIN could not be submitted while the replay was backing off');
  assert.match(texts(btn).join(' '), /Unlock/);
  await btn.props.onClick(); await L.settle();
  assert.equal(L.Steward.hasKey, true, 'the typed PIN did not unlock while the replay was pending');
  assert.equal(dev.hw.map[SS_KEY], before, 'cancelling the replay touched the stay-open record');
  assert.deepEqual(L.timers.filter(t => !t.cleared), [], 'a retry timer is still pending after the typed PIN cancelled the replay');
  L.unmount();
});
test('(n) a cancelled replay stays off for the mount: a stale timer and a later visibilitychange do nothing; WRONG typed PINs keep the record and 5 misses still lock out', async () => {
  const dev = device(); dev.blob = await makeBlob(PIN, SEED);
  const L1 = launch(dev); await L1.mount(); await L1.typeAndUnlock(PIN, true); persist(dev); L1.unmount();
  const before = dev.hw.map[SS_KEY];
  dev.hw.failGet = 1e6;
  const L = launch(dev, { manualTimers: true }); await L.mount();
  let calls = 0; const real = L.Steward.unlockStayOpen; L.Steward.unlockStayOpen = (...a) => { calls++; return real(...a); };
  const pending = L.timers.slice();
  for (let i = 1; i <= 5; i++) {
    await L.typeAndUnlock('wrong-pin-' + i);
    assert.equal(L.Steward.hasKey, false);
    assert.equal(JSON.parse(dev.ls.getItem('trinityone.steward.pinguard')).fails, i, 'miss ' + i + ' not counted');
    assert.equal(dev.hw.map[SS_KEY], before, 'a wrong typed PIN touched the live record');
    L.draw();
  }
  assert.match(texts(L.draw()).join(' '), /Too many attempts|Locked/, 'the 5th miss did not lock out');
  for (const t of pending) t.f();               // a stale timer firing after the cancel
  L.vis(); await L.settle();
  assert.equal(calls, 0, 'the replay ran again after a typed PIN cancelled it');
  assert.equal(dev.hw.map[SS_KEY], before);
  L.unmount();
});
