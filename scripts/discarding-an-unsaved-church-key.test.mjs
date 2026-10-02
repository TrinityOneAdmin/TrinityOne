// THE FORCED-PIN GATE'S WAY BACK MUST FORGET ONLY WHAT WAS NEVER SAVED.
// Run: node --test scripts/discarding-an-unsaved-church-key.test.mjs
//
// Owner, 2026-09-22, seeing "Set a console PIN" on the Suite's first run: "We still need a back or cancel
// button at this stage." The gate was built inescapable (AUDIT-2026-07-28) because the seed it guards may exist
// only in memory and a RELOAD destroys it. That argues against reload, not against a Back that discards or
// keeps on purpose. `window.Steward.discardUnsavedKey()` is that Back's engine half, and the whole of its
// safety is in what it refuses to do:
//   • after createKey — nothing saved, nothing published — it forgets the seed and the device is empty again;
//   • after restoreKey over a church already on the device, it forgets the RESTORED seed and leaves the
//     previous church's ciphertext byte-for-byte where it was, so the old PIN still opens it;
//   • when the key in memory IS the saved one (needsPin false) it does nothing;
//   • when the seed is a legacy plaintext one on disk (KEY_LS) it does nothing — forgetting that from memory
//     would put "Set up a new church" over a live key, and the next setPin would delete it.
//
// Lifted from the SHIPPED bundle (vendor/steward.js), not the source, so a source edit that was never rebuilt
// cannot pass here. Stubs stand in for storage, the crypto and the relay pool; nothing stands in for the
// decision.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const SHIP = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const KEY_LS = 'trinityone.steward.church-key', ENC_LS = 'trinityone.steward.church-key.enc';

function engine(storeInit = {}) {
  const store = { ...storeInit };
  const events = [], closed = [], calls = { openRegGate: 0, reset: 0 };
  const Steward = { hasKey: false, needsPin: false, locked: false, pubkey: null, npub: null };
  const scope = {
    KEY_LS, ENC_LS,
    lsGet: (k) => (k in store ? store[k] : null),
    lsSet: (k, v) => { store[k] = String(v); },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    // setKey's real collaborators, as a-restore-leaves-the-old-key-openable.test.mjs stubs them
    privateKeyFromSeedWords: () => new Uint8Array(32),
    getPublicKey: () => 'ab'.repeat(32), getPublicKey2: () => 'ab'.repeat(32),
    npubEncode: () => 'npub1unsaved',
    generateSeedWords: () => 'fine flash wait silly next awkward charge front scout build damage river',
    _loadBoxHosts: () => { store['trinityone.steward.boxhosts.' + 'ab'.repeat(32)] = '0'; },   // what the real one leaves behind on a Suite box
    _refreshBoxHostsUs: () => {}, _gate: { refresh() {} }, relaysRaw: () => [],
    _armRegGate: () => {}, _openRegGate: () => { calls.openRegGate++; }, _resetChurchScopedState: () => { calls.reset++; },
    _blockedLastSet: () => new Set(), _localBlocked: new Set(), _localBlockedAt: 0,   // setKey/setActiveIdentity now seed the church's last blocklist (2026-10-02): not this file's question
    pool: { relays: new Map([['ws://relay.test/', {}]]), close: (urls) => { closed.push(...urls); } },
    needsPin: false,
    window: { Steward, dispatchEvent: (e) => { events.push(e.type); }, CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; } },
    sk: null, pub: null, churchSk: null, churchPub: null, currentMnemonic: null,
    String, JSON, Array, Object, Boolean, Number, Math, Promise, console, RegExp, Error, Uint8Array, Map, Set, Symbol,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the shipped discard needs a stub for ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const src = fnBody(SHIP, 'function setKey(mnemonic)', 'setKey') + '\n' +
    fnBody(SHIP, 'function _setNeedsPin(v)', '_setNeedsPin') + '\n' +
    fnBody(SHIP, 'function _boxHostsKey()', '_boxHostsKey') + '\n' +
    'return ({ setKey, _setNeedsPin, ' + fnBody(SHIP, 'createKey() {', 'createKey') + ', ' +
    fnBody(SHIP, 'discardUnsavedKey() {', 'discardUnsavedKey') + ' });';
  const api = new Function('scope', 'with (scope) { ' + src + ' }')(proxy);
  return { ...api, scope, store, events, closed, calls, Steward,
    // a restore's memory half: setKey + needsPin, exactly what restoreKey does around its checksum (lifted and
    // pinned separately in a-restore-leaves-the-old-key-openable.test.mjs)
    restoreOverIt: () => { api.setKey('restored'); api._setNeedsPin(true); },
    keyRows: () => Object.keys(store).filter(k => k.startsWith(KEY_LS)) };
}

test('after createKey (nothing saved), discard empties the device: no key in memory, no key in storage, needsPin off', () => {
  const e = engine();
  e.createKey();
  assert.equal(e.Steward.hasKey, true, 're-anchor: createKey no longer puts a key in memory');
  assert.equal(e.scope.needsPin, true, 're-anchor: createKey no longer arms needsPin');
  assert.deepEqual(e.keyRows(), [], 're-anchor: createKey wrote a key to storage — it is memory-only by design (SECURITY-AUDIT-2026-06-25)');

  assert.equal(e.discardUnsavedKey(), true, 'discard refused an unsaved, freshly created key — the gate’s Back would do nothing');
  assert.equal(e.Steward.hasKey, false, 'hasKey is still true after the discard, so StewardRoot would go on showing the gate');
  assert.equal(e.scope.currentMnemonic, null, 'THE SEED IS STILL IN MEMORY after "Go back — nothing has been created yet"');
  assert.equal(e.scope.sk, null, 'the signing key is still in memory after the discard');
  assert.equal(e.scope.needsPin, false, 'needsPin is still set, so the gate would come straight back');
  assert.equal(e.Steward.locked, false, 'a device with no saved church came back LOCKED — the unlock screen with nothing to unlock');
  assert.deepEqual(e.keyRows(), [], 'a church-key row is in storage after discarding a key that was never saved');
  assert.deepEqual(Object.keys(e.store).filter(k => /boxhosts/.test(k)), [], 'the boxhosts cache line for the discarded church was left behind');
  assert.ok(e.events.includes('steward-key'), 'no steward-key event — StewardRoot reads hasKey only on that event, so nothing re-renders');
  assert.equal(e.calls.openRegGate, 1, 'the registration gate armed by createKey was left armed with nothing being founded');
  assert.deepEqual(e.closed, ['ws://relay.test/'], 'the relay sockets were kept open — a socket authed as the discarded key');
});

test('a SAVED key survives: discard is a no-op when the key in memory is the persisted one', () => {
  const e = engine({ [ENC_LS]: '{"v":2,"ct":"the-saved-church"}' });
  // an unlocked console: seed in memory, needsPin false (setPin cleared it), ciphertext on disk
  e.setKey('saved'); e._setNeedsPin(false);
  assert.equal(e.discardUnsavedKey(), false, 'discard reported success over a SAVED key');
  assert.equal(e.scope.currentMnemonic, 'saved', 'THE SAVED CHURCH WAS FORGOTTEN FROM MEMORY by a discard meant only for unsaved keys');
  assert.equal(e.Steward.hasKey, true, 'hasKey dropped over a saved key');
  assert.equal(e.store[ENC_LS], '{"v":2,"ct":"the-saved-church"}', 'the saved ciphertext was touched');
  assert.deepEqual(e.events, [], 'a no-op discard fired an event');
  assert.deepEqual(e.closed, [], 'a no-op discard closed the relay sockets');
});

test('a restore over an existing church: discard forgets the RESTORED seed and leaves the previous church locked and openable', () => {
  const e = engine({ [ENC_LS]: '{"v":2,"ct":"the-previous-church"}' });
  e.restoreOverIt();
  assert.equal(e.scope.currentMnemonic, 'restored', 're-anchor: the in-memory restore did not land');
  assert.equal(e.discardUnsavedKey(), true, '"Keep my current church" was refused over a restore that had not been saved');
  assert.equal(e.scope.currentMnemonic, null, 'the restored seed is still in memory');
  assert.equal(e.store[ENC_LS], '{"v":2,"ct":"the-previous-church"}', 'THE PREVIOUS CHURCH’S CIPHERTEXT CHANGED — the old PIN no longer opens the old church');
  assert.equal(e.Steward.locked, true, 'the console is not locked, so the previous church would not be offered for unlock');
  assert.equal(e.Steward.hasKey, false, 'hasKey is still true after discarding the restored seed');
  assert.equal(e.scope.needsPin, false, 'needsPin still set — the gate would come back over the unlock screen');
  assert.equal(e.calls.reset, 1, 'the restored church’s module state was carried back into the previous church');
});

test('a legacy plaintext seed on disk is NOT discarded — that seed IS the church', () => {
  const e = engine({ [KEY_LS]: 'the legacy church seed words' });
  // what init() does on a legacy install: load it, force a PIN
  e.setKey(e.store[KEY_LS]); e._setNeedsPin(true);
  assert.equal(e.discardUnsavedKey(), false, 'discard accepted a legacy plaintext migration — "Set up a new church" would now sit over a live key');
  assert.equal(e.scope.currentMnemonic, 'the legacy church seed words', 'the legacy seed was forgotten from memory');
  assert.equal(e.scope.needsPin, true, 'the forced PIN was cleared over a plaintext seed');
  assert.equal(e.store[KEY_LS], 'the legacy church seed words', 'the legacy seed was removed from storage');
});

// ── THE GATE RE-ARMS FOR THE NEXT CHURCH (AUDIT-suite-B5-B6 D1) ──────────────────────────────────────────
// The engine above STUBS _armRegGate/_openRegGate, so it cannot see this: discardUnsavedKey() opened the
// registration gate but left `_regGate` holding the resolved promise, and _armRegGate() is `if (!_regGate) …`,
// so the NEXT createKey() could not arm a fresh one — church #2's founding writes went out with no gate at
// all (the R5-5 "ten refused writes" shape). Measured by the auditor on the shipped bundle: church #1's first
// publish waited 1502 ms; after Back + Start again, church #2's waited 0 ms. This engine lifts the SHIPPED
// gate (_armRegGate, _openRegGate, _awaitFirstAdmission, _waitForRegistration — the wait publish() and
// _publishToRelays() both apply) with a short REG_GATE_MS and nobody registering, so "waits on the gate" is
// the whole budget and "no gate" is at once.
function engineWithRealGate(regGateMs) {
  const store = {};
  const Steward = { hasKey: false, needsPin: false, locked: false, pubkey: null, npub: null };
  const scope = {
    KEY_LS, ENC_LS,
    lsGet: (k) => (k in store ? store[k] : null),
    lsSet: (k, v) => { store[k] = String(v); },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    privateKeyFromSeedWords: () => new Uint8Array(32),
    getPublicKey: () => 'ab'.repeat(32), getPublicKey2: () => 'ab'.repeat(32),
    npubEncode: () => 'npub1unsaved',
    generateSeedWords: () => 'fine flash wait silly next awkward charge front scout build damage river',
    _loadBoxHosts: () => {}, _refreshBoxHostsUs: () => {}, _gate: { refresh() {}, admit: () => [] }, relaysRaw: () => [],
    _resetChurchScopedState: () => {},
    _blockedLastSet: () => new Set(), _localBlocked: new Set(), _localBlockedAt: 0,   // setKey/setActiveIdentity now seed the church's last blocklist (2026-10-02): not this file's question
    pool: { relays: new Map(), close: () => {} },
    needsPin: false, actingChurch: false,
    window: { Steward, dispatchEvent: () => {}, CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; } },
    sk: null, pub: null, churchSk: null, churchPub: null, currentMnemonic: null,
    setTimeout, Date,
    String, JSON, Array, Object, Boolean, Number, Math, Promise, console, RegExp, Error, Uint8Array, Map, Set, Symbol,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the shipped gate needs a stub for ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  // the gate's own state, declared where the lifted functions close over it — as in the bundle
  const src = 'let _regGate = null, _openGate = null, _proofWaited = false, _regNeedsName = false, _regGen = 0; const REG_GATE_MS = ' + regGateMs + ', PROOF_GATE_MS = 0;\n' +
    fnBody(SHIP, 'function _armRegGate()', '_armRegGate') + '\n' +
    fnBody(SHIP, 'function _openRegGate(gen)', '_openRegGate') + '\n' +
    fnBody(SHIP, 'function _awaitFirstAdmission(ms)', '_awaitFirstAdmission') + '\n' +
    fnBody(SHIP, 'async function _waitForRegistration()', '_waitForRegistration') + '\n' +
    fnBody(SHIP, 'function setKey(mnemonic)', 'setKey') + '\n' +
    fnBody(SHIP, 'function _setNeedsPin(v)', '_setNeedsPin') + '\n' +
    fnBody(SHIP, 'function _boxHostsKey()', '_boxHostsKey') + '\n' +
    'return ({ setKey, _setNeedsPin, _waitForRegistration, _armRegGate, _openRegGate, gate: () => _regGate, gen: () => _regGen, ' + fnBody(SHIP, 'createKey() {', 'createKey') + ', ' +
    fnBody(SHIP, 'discardUnsavedKey() {', 'discardUnsavedKey') + ', ' +
    fnBody(SHIP, 'async selfRegister(name, opts) {', 'selfRegister') + ' });';
  const api = new Function('scope', 'with (scope) { ' + src + ' }')(proxy);
  // how long a publish would be held by the gate right now (nobody registers, so a held write waits the budget)
  const firstPublishWait = async () => { const t0 = Date.now(); await api._waitForRegistration(); return Date.now() - t0; };
  return { ...api, scope, firstPublishWait };
}

test('after a Back, a SECOND "Start a new church" is gated again: its first publish waits on registration like the first church’s did', async () => {
  const MS = 800;
  const e = engineWithRealGate(MS);
  // control: a church founded with no Back — its first publish is held for the whole budget
  const c = engineWithRealGate(MS);
  c.createKey();
  const control = await c.firstPublishWait();
  assert.ok(control >= MS - 100, 're-anchor: church #1’s first publish was not held by the gate (' + control + ' ms) — the lifted gate is not the one that holds founding writes');
  // church #1 → Back (the forced-PIN gate’s way back) → church #2
  e.createKey();
  const g1 = e.gate();
  assert.ok(g1 instanceof Promise, 're-anchor: createKey did not arm the gate');
  assert.equal(e.discardUnsavedKey(), true, 're-anchor: the discard was refused');
  e.createKey();
  const g2 = e.gate();
  const second = await e.firstPublishWait();
  assert.ok(second >= MS - 100, 'CHURCH #2, CREATED AFTER A BACK, HAS NO FOUNDING-WRITE GATE (AUDIT-suite-B5-B6 D1): its first publish waited ' + second + ' ms; church #1’s waited ' + control + ' ms. Start → Back → Start on the Suite founds a church whose first writes the relay refuses (the R5-5 shape).');
  assert.notEqual(g2, g1, 'after a Back the next church could not arm its own gate: _regGate is still church #1’s resolved promise, so _armRegGate() was a no-op');
});

// ── THE GATE BELONGS TO A CHURCH (AUDIT-round-a-fixes-2026-09-22 F2) ────────────────────────
// Row 5 proves the next church can ARM a gate. It does not stop somebody else OPENING it. `_openRegGate()`
// carried no identity — it resolved whatever `_regGate` happened to be — and `selfRegister`'s `finally`
// (`if (!_regNeedsName) _openRegGate();`) is fired fire-and-forget from app/steward-root.jsx (`adopt()` and
// `initChurch()`), so a registration begun for the ABANDONED church could land after the Back and after the
// next `createKey()` and open church #2's gate at once. Measured by the auditor on the shipped bundle:
// control 801 ms, row 5's path 802 ms, and the stale-answer path 0 ms — church #2 ungated.
//
// Reachable, and the two conditions correlate the wrong way: Restore a church → `adopt()` fires
// `selfRegister('')` without awaiting → forced-PIN gate → "Go back" → "Start a new church". A relay that is
// merely UNREACHABLE leaves `_regNeedsName` false, so the `finally` does call `_openRegGate()` — and an
// unreachable relay is also what makes the call slow enough to still be in flight.
//
// Both rows below run the SHIPPED `selfRegister` out of vendor/steward.js, not a stand-in for its `finally`.

test('a registration left over from the ABANDONED church cannot open the NEXT church\'s gate', async () => {
  const MS = 800;
  // control: a church founded with no Back at all — its first publish is held for the whole budget
  const c = engineWithRealGate(MS);
  c.createKey();
  const control = await c.firstPublishWait();
  assert.ok(control >= MS - 100, 're-anchor: church #1’s first publish was not held by the gate (' + control + ' ms)');

  const e = engineWithRealGate(MS);
  e.createKey();                                  // church #1 — createKey arms its gate
  const g1 = e.gate();
  // The Back happens while selfRegister is INSIDE: after `_armRegGate()`, before its `finally`. The shipped
  // order is `_armRegGate(); try { if (!churchSk || !churchPub) return; … } finally { … _openRegGate(); }`,
  // so the read of `churchSk` is exactly that instant — which is why the stub is read there and not earlier.
  let back = null, backSk = e.scope.churchSk;
  Object.defineProperty(e.scope, 'churchSk', { configurable: true,
    get() {
      if (back === null) {
        back = e.discardUnsavedKey();             // "Go back — nothing has been created yet"
        e.createKey();                            // "Start a new church" — church #2 arms its own gate
        return null;                              // …and the abandoned registration falls through to its finally
      }
      return backSk;
    },
    set(v) { backSk = v; } });
  await e.selfRegister('');
  assert.equal(back, true, 're-anchor: the staged Back never happened inside selfRegister, so this row measures nothing');
  const g2 = e.gate();
  assert.notEqual(g2, g1, 're-anchor: church #2 did not arm a gate of its own (that is row 5’s defect, not this one)');
  const second = await e.firstPublishWait();
  assert.ok(second >= MS - 100, 'A REGISTRATION BEGUN FOR THE ABANDONED CHURCH OPENED CHURCH #2’S GATE (AUDIT-round-a F2): its first publish waited ' + second + ' ms; church #1’s waited ' + control + ' ms. Restore → Back → Start founds a church whose first writes the relay refuses (the R5-5 shape).');
});

test('the ordinary single-church path still opens its gate: the registration that belongs to this church opens it, once, and nothing hangs', async () => {
  const LONG = 60000;                              // far longer than this test would tolerate if the gate never opened
  const e = engineWithRealGate(LONG);
  e.createKey();
  assert.ok(e.gate() instanceof Promise, 're-anchor: createKey did not arm the gate');
  e.scope.churchSk = null;                         // the early return inside selfRegister; its finally still runs
  await e.selfRegister('');
  const t0 = Date.now();
  const first = await e.firstPublishWait();
  assert.ok(first < 2000, 'THE GATE NEVER OPENED FOR THE CHURCH THAT REGISTERED: the first publish waited ' + first + ' ms of a ' + LONG + ' ms budget — church creation would hang on its own founding writes, which is worse than the race this guards against.');
  assert.equal(e.gate(), null, 'the gate was not latched open after the wait — every later publish would pay it again');
  const secondWait = await e.firstPublishWait();
  assert.ok(secondWait < 200, 'a later publish paid the gate a second time (' + secondWait + ' ms): the once-per-session latch is gone');
  assert.ok(Date.now() - t0 < 5000, 'staging: the whole ordinary path took longer than five seconds');
});
