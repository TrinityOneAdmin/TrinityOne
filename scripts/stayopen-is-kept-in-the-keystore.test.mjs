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
const SS_KEY = BUNDLE.match(/var STAY_SS = "([^"]+)"/)[1];
// the Steward methods the screen calls, out of the shipped object literal
const METHODS = ['stayOpenStatus() {', 'setStayOpen(pin, on) {', 'clearStayOpen() {', 'async unlockStayOpen() {']
  .map(a => fnBody(BUNDLE, BUNDLE.indexOf('    ' + a) + 4, a)).join(',\n');

function engine() {
  return new Function('crypto', 'console', 'btoa', 'atob', ENGINE_SRC + '\nreturn { makeStayOpen, deriveAesBits, b64e, b64d };')(
    webcrypto, { warn() {}, log() {} }, btoa, atob);
}

// A fake hardware store shaped like the Capacitor proxy (see console-key-secure-store.test.mjs for why).
function hardwareStore() {
  const map = {};
  const impl = {
    get: async (k) => (k in map ? map[k] : null),
    set: async (k, v) => { map[k] = String(v); },
    remove: async (k) => { delete map[k]; },
  };
  const S = new Proxy(impl, { get: (t, p) => (p in t ? t[p] : (typeof p === 'symbol' ? undefined : () => { throw new Error('"SecureStorage.' + String(p) + '()" is not implemented on android'); })) });
  return { map, S };
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
  return { native, hw: hardwareStore(), lsSeed: {}, blob: null, clock: Date.UTC(2026, 9, 10), unlockCalls: 0 };
}

// One LAUNCH of the console on that device: a fresh engine (fresh module state), a fresh screen, locked.
function launch(dev) {
  const r = fakeReact();
  const b = fakeBrowser();
  for (const [k, v] of Object.entries(dev.lsSeed)) b.localStorage.setItem(k, v);
  dev.ls = b.localStorage;
  const lib = engine();
  const stay = lib.makeStayOpen({
    secure: async () => ({ S: dev.hw.S }), isNative: () => dev.native, lsRemove: (k) => b.localStorage.removeItem(k),
    now: () => dev.clock, readBlob: async () => dev.blob || '', deriveBits: lib.deriveAesBits, pubOf: (m) => 'owner:' + m.split(' ')[0],
  });
  const entered = [];
  const Steward = fakeSteward({ hasKey: false, locked: true, needsPin: false });
  const enter = (seed) => { entered.push(seed); Steward.hasKey = true; Steward.locked = false; b.window.dispatch('steward-key', { type: 'steward-key' }); };
  Steward.unlock = async (pin) => {
    dev.unlockCalls++;
    try { enter(await openBlob(pin, dev.blob)); return true; } catch (e) { return false; }
  };
  // the SHIPPED wrappers, bound to this launch's engine
  const shipped = new Function('_stay', '_enterUnlocked', 'return ({ ' + METHODS + ' });')(stay, enter);
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
  return { Steward, stay, entered, draw, mount, fresh: () => r.fresh(), box, typeAndUnlock, settle, unmount: () => r.unmount(), lsKeys: () => [...Array(b.localStorage.length)].map((_, i) => b.localStorage.key(i)) };
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
  // the idle lock: the same launch, the screen comes back as a NEW instance
  L.Steward.hasKey = false; L.Steward.locked = true;
  await L.mount();
  assert.equal(L.Steward.hasKey, false, 'a lock later in the same launch reopened by itself — the lock does nothing');
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
