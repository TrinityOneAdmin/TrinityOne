// REPLACING THE CONSOLE'S KEY DROPS THE OLD CHURCH'S HELPER IDENTITY — AND LOCKING DOES NOT.
// Run: node --test scripts/a-replacing-the-key-drops-the-old-churchs-identity.test.mjs
//
// BUG (2026-11-14, audit M1 of 1b0af5f6). A console that helps run church B and then restored church C (12 words,
// QR handoff, backup file) kept B in `stewardedChurches` and in `actingChurch`. identities() then hid C's own row
// (showOwn = !(_ownKeyBlank() && stewarded.length)), the auto-land moved the console to B, and every write was
// signed and stamped as B and refused by the relay.
//
// FIX: _forgetStewardedScope() runs in restoreKey (after validation, before setKey), createKey, createKeyQuiet and
// removeKey — the four places the console's OWN church changes — and NEVER in setKey, because a lock/unlock goes
// through setKey (_enterUnlocked) and a helper must come back to the church they were acting for.
//
// HOW IT ASSERTS (CLAUDE.md rules 1 & 3). The REAL functions are lifted from the SHIPPED bundle (vendor/steward.js)
// and run: restoreKey, adoptChurch, createKey, createKeyQuiet, removeKey, setKey, _enterUnlocked,
// _forgetStewardedScope, identities, subscribeStewardedChurches, setActiveIdentity. Nothing is matched in app/*.jsx.
// The point-of-use proof (the real Settings screen) is in a-locked-console-opens-no-relay-socket-before-unlock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const B = 'bb'.repeat(32);   // the church this console HELPS run
const WORDS_C = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OWN_A = 'ee'.repeat(32);
const pubOfWords = (m) => (m === WORDS_C ? 'cc'.repeat(32) : OWN_A);

function proxyOf(stubs) {
  return new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      if (String(k) in globalThis) return globalThis[String(k)];
      throw new ReferenceError('the lifted function needs `' + String(k) + '` — add a stub');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
}

// A console that is helping church B: own key blank, Map = {B}, acting as B.
function build({ acting = true, relays = [] } = {}) {
  const subs = [];
  const store = new Map();
  const events = [];
  const stewardedChurches = new Map([[B, { name: 'Church B' }]]);
  const Steward = {};
  const noop = () => {};
  const stubs = {
    churchPub: OWN_A, churchSk: 'ab'.repeat(32), sk: 'ab'.repeat(32), pub: acting ? B : OWN_A, currentMnemonic: 'old words',
    actingChurch: acting ? B : '', stewardedChurches, _stewardedBroad: null,
    ACTIVE_ID_KEY: 'trinityone.steward.active', OWN_NAME_LS: 'trinityone.steward.ownname.', SELFREG_KEY: 'trinityone.steward.selfreg',
    HELPERKEY_LS: 'trinityone.steward.helperkey.', KEY_LS: 'trinityone.steward.key', PENDING_CHURCH_KEY: 'trinityone.steward.pending-church',
    NET: 'trinityone', STEWARDS_D: 'trinityone/stewards:', STEWARDREVOKE_D: 'trinityone/stewardrevoke:',
    privateKeyFromSeedWords: (m) => 'sk:' + m, getPublicKey2: (s) => pubOfWords(String(s).slice(3)),
    validateMnemonic: () => true, wordlist: [], generateSeedWords: () => WORDS_C,
    npubEncode: (p) => 'npub_' + p, toPubHex: (x) => (/^[0-9a-f]{64}$/i.test(x) ? x.toLowerCase() : null),
    _migrateNetKeysToSealed: noop, _blockedLastSet: () => [], _localBlocked: [], _localBlockedAt: 0,
    _loadBoxHosts: noop, _refreshBoxHostsUs: noop, _gate: { refresh: () => Promise.resolve(relays.slice()), admit: () => relays.slice() },
    relaysRaw: () => relays.slice(), adoptNetDocAddresses: () => null, _ownOrigin: () => '',
    _resetChurchScopedState: noop, _stay: { clear: noop }, _setNeedsPin: noop, _armRegGate: noop,
    becomeStewardPayload: noop,
    encBlobRemove: () => true, _minorsLastClear: noop, _sgClearClear: noop, _finBookClear: noop, _seedSweep: noop,
    _clearanceSent: { clear: noop }, _ckSessionKeys: { clear: noop }, _latestGuardNotice: { clear: noop }, _senvPending: { clear: noop },
    CAP_KEYS: {}, _capState: {}, _keyReadEpoch: 0, _careKeyVer: 0, _mediaKeyVer: 0, netKeys: () => [],
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: () => null, length: 0 },
    lsGet: (k) => (store.has(k) ? store.get(k) : null), lsSet: (k, v) => store.set(k, v),
    pool: { subscribeMany: (urls, filters, handlers) => { subs.push({ urls, filters, handlers }); return { close() {} }; } },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    window: { Steward, addEventListener() {}, removeEventListener() {}, dispatchEvent: (e) => { events.push(e); return true; } },
  };
  Steward.actingChurch = stubs.actingChurch; Steward.churchPub = OWN_A; Steward.activePub = stubs.pub;
  const scope = proxyOf(stubs);
  const lift = (anchor, name) => new Function('scope', `with (scope) { return (${fnBody(VENDOR, anchor, name)}); }`)(scope);
  const method = (anchor, name) => new Function('scope', `with (scope) { return ({ ${fnBody(VENDOR, anchor, name)} }).${name}; }`)(scope);
  // The helper and setKey are the REAL ones from the bundle; _ownKeyBlank & co. too, so identities() judges honestly.
  stubs._forgetStewardedScope = lift('function _forgetStewardedScope() {', '_forgetStewardedScope');
  stubs.setKey = lift('function setKey(mnemonic) {', 'setKey');
  stubs._enterUnlocked = lift('function _enterUnlocked(seed) {', '_enterUnlocked');
  stubs._ownChurchName = lift('function _ownChurchName() {', '_ownChurchName');
  stubs._ownKeyRegistered = lift('function _ownKeyRegistered() {', '_ownKeyRegistered');
  stubs._ownKeyBlank = lift('function _ownKeyBlank() {', '_ownKeyBlank');
  const api = {
    restoreKey: method('restoreKey(mnemonic) {', 'restoreKey'),
    createKey: method('createKey() {', 'createKey'),
    createKeyQuiet: method('createKeyQuiet() {', 'createKeyQuiet'),
    removeKey: method('removeKey() {', 'removeKey'),
    adoptChurch: method('adoptChurch(payload) {', 'adoptChurch'),
    identities: method('identities() {', 'identities'),
    subscribe: method('subscribeStewardedChurches(cb) {', 'subscribeStewardedChurches'),
    setActiveIdentity: method('setActiveIdentity(targetPub, { persist = true } = {}) {', 'setActiveIdentity'),
  };
  for (const k of ['restoreKey', 'createKey', 'createKeyQuiet', 'removeKey', 'adoptChurch', 'identities']) Steward[k] = (...a) => api[k].apply(Steward, a);
  Steward.setActiveIdentity = (...a) => api.setActiveIdentity.apply(Steward, a);
  Steward.becomeStewardPayload = () => 'payload';
  return { stubs, store, events, Steward, api, subs };
}

const picked = (h) => { const got = []; const real = h.Steward.setActiveIdentity; h.Steward.setActiveIdentity = (p, o) => { got.push(p); return real(p, o); }; return got; };

function assertScopeForgotten(h, what) {
  assert.equal(h.stubs.stewardedChurches.size, 0, `${what}: church B is still in stewardedChurches`);
  assert.equal(h.stubs.actingChurch, '', `${what}: actingChurch is still set`);
  assert.equal(h.Steward.actingChurch, '', `${what}: the window.Steward mirror still says we act for a church`);
}

for (const [name, run] of [
  ['restoreKey (12 words / backup file)', (h) => h.Steward.restoreKey(WORDS_C)],
  ['adoptChurch (handoff QR / pasted code / ?adopt= link)', (h) => h.Steward.adoptChurch('trinityone-church:' + WORDS_C)],
  ['createKey', (h) => h.Steward.createKey()],
  ['createKeyQuiet ("Help run a church")', (h) => h.Steward.createKeyQuiet()],
  ['removeKey', (h) => h.Steward.removeKey()],
]) {
  test(`replacing the key via ${name} drops church B from the helper scope`, () => {
    const h = build();
    assert.equal(h.stubs.stewardedChurches.has(B), true, 'CONTROL: the fixture does not start as a helper of B');
    assert.equal(h.stubs.actingChurch, B, 'CONTROL: the fixture does not start acting as B');
    run(h);
    assertScopeForgotten(h, name);
  });
}

test('a rejected phrase changes NOTHING (the clear comes after validation)', () => {
  const h = build();
  assert.throws(() => h.Steward.restoreKey('too short'), /12-word/);
  assert.equal(h.stubs.stewardedChurches.has(B), true, 'a phrase that was rejected still wiped the helper scope');
  assert.equal(h.stubs.actingChurch, B);
});

test('after a restore, identities() lists the restored church and NOT church B, and nothing lands the console in B', () => {
  const h = build();
  h.Steward.restoreKey(WORDS_C);
  const C = h.stubs.churchPub;
  assert.equal(C, pubOfWords(WORDS_C), 'CONTROL: the restore did not change the key');
  const ids = h.api.identities.call(h.Steward);
  assert.ok(ids.some(i => i.kind === 'church' && i.pub === C), 'the restored church has no row in the switcher');
  assert.ok(!ids.some(i => i.pub === B), 'the old key\'s church B is still listed');
  const got = picked(h);
  h.api.subscribe.call(h.Steward, () => {});
  assert.deepEqual(got, [], 'the console was moved into a church after the restore — the auto-land still saw church B');
  assert.equal(h.stubs.actingChurch, '', 'actingChurch is not empty after the restore');
});

test('CONTROL: without the restore the same console DOES list B and hide the blank own row (the bug is real in this fixture)', () => {
  const h = build();
  const ids = h.api.identities.call(h.Steward);
  assert.ok(ids.some(i => i.pub === B), 'the fixture is not a helper of B');
  assert.ok(!ids.some(i => i.kind === 'church'), 'the blank own row is shown — the fixture does not reproduce the hidden-row condition');
});

// NEGATIVE GUARD: lock then unlock must still return a helper to church B. Goes red if the clear moves into setKey.
test('NEGATIVE GUARD: lock then unlock returns the helper to church B (the clear is not in setKey)', () => {
  const h = build();
  h.Steward.setActiveIdentity = (p) => {   // the REAL setActiveIdentity needs half the console; this one honours the same precondition it does
    if (h.stubs.stewardedChurches.has(p)) { h.stubs.actingChurch = p; h.Steward.actingChurch = p; h.stubs.pub = p; return true; }
    return false;
  };
  h.stubs._enterUnlocked(OWN_A + '-seed');   // setKey (real) then the return to the acting church
  assert.equal(h.stubs.stewardedChurches.has(B), true, 'unlocking forgot church B');
  assert.equal(h.stubs.actingChurch, B, 'a helper was dropped into its own empty church by a lock and unlock');
});

// L3 (audit of 02eb001a): a LATE roster event for the OLD key must not put church B back. The discovery subscription for
// the old key is only closed when React's effect cleans up (a render later); _forgetStewardedScope cannot close it, so the
// handlers themselves ignore any event once the key they were opened for is gone.
test('a late roster event for the OLD key, arriving after a restore, does not put church B back', async () => {
  const LATE = 'dd'.repeat(32);
  const roster = (cp) => ({ tags: [['d', 'trinityone/stewards:' + cp], ['t', 'trinityone']], content: JSON.stringify({ pubkeys: [OWN_A] }), created_at: 100 });
  const h = build({ relays: ['wss://r'] });
  h.api.subscribe.call(h.Steward, () => {});
  await new Promise(r => setTimeout(r, 0));
  const sub = h.subs.find(x => x.filters && x.filters[0] && (x.filters[0].kinds || []).includes(30078));
  assert.ok(sub, 'CONTROL: the discovery subscription never opened');
  sub.handlers.onevent(roster(LATE));
  assert.equal(h.stubs.stewardedChurches.has(LATE), true, 'CONTROL: a roster that lists this console did not add its church while the key was current');
  h.Steward.restoreKey(WORDS_C);
  assert.equal(h.stubs.stewardedChurches.size, 0, 'CONTROL: the restore did not empty the Map');
  sub.handlers.onevent(roster(B));   // the old key's roster arrives late
  assert.equal(h.stubs.stewardedChurches.size, 0, 'a late event for the OLD key put a church back into the Map after the restore');
});

// L1 (audit of 02eb001a) — RECORDED BEHAVIOUR, not an endorsement. After a restore, "Keep my current church" (Back at the PIN
// screen) and an unlock re-enter as the helper's OWN key with an empty scope; the console goes back to church B only when the
// discovery re-subscribes and reads the helper's per-key cache plus the remembered ACTIVE_ID_KEY. Before the fix the Map
// survived the restore, so this was instant. Not a one-line fix (the Map would have to be saved and restored across the
// restore), so it is pinned here instead.
test('RECORDED: restore, then Back and unlock — opens as the own key first, and returns to church B when the discovery re-subscribes', () => {
  const h = build();
  h.store.set('trinityone.steward.stewarded.' + OWN_A, JSON.stringify([{ cp: B, name: 'Church B' }]));   // what the helper's own cache holds
  h.store.set('trinityone.steward.active', B);                                                          // ACTIVE_ID_KEY is deliberately left alone
  h.Steward.restoreKey(WORDS_C);
  h.stubs._enterUnlocked('old seed words');   // Back, then unlock: the old key is back
  assert.equal(h.stubs.churchPub, OWN_A, 'CONTROL: the old key is not back');
  assert.equal(h.stubs.actingChurch, '', 'the console unlocked straight into B — the recorded behaviour has changed (good, but update this test)');
  assert.equal(h.stubs.stewardedChurches.size, 0, 'the Map survived the restore — the recorded behaviour has changed');
  const got = picked(h);
  h.api.subscribe.call(h.Steward, () => {});
  assert.deepEqual(got, [B], 'the discovery did not return the helper to church B from its cache and the remembered church');
});

// A late NAME lookup in the old closure (resolveName's kind-0 handler) must not rename a church or rewrite the cache.
// Its own guard, tested alone: the roster handler's guard (above) does not cover it. The church is put into the Map by
// hand AFTER the restore so that only the guard — not an empty Map — stops the rename.
test('a late name lookup for the OLD key, arriving after a restore, does not rename a church or write the old key\'s cache', async () => {
  const LATE = 'dd'.repeat(32);
  const h = build({ relays: ['wss://r'] });
  h.api.subscribe.call(h.Steward, () => {});
  await new Promise(r => setTimeout(r, 0));
  const disc = h.subs.find(x => x.filters && x.filters[0] && (x.filters[0].kinds || []).includes(30078));
  assert.ok(disc, 'CONTROL: the discovery subscription never opened');
  disc.handlers.onevent({ tags: [['d', 'trinityone/stewards:' + LATE], ['t', 'trinityone']], content: JSON.stringify({ pubkeys: [OWN_A] }), created_at: 100 });
  const nameSub = h.subs.find(x => x.filters && x.filters[0] && (x.filters[0].kinds || []).includes(0) && (x.filters[0].authors || []).includes(LATE));
  assert.ok(nameSub, 'CONTROL: no name lookup was opened for the church the roster named');
  nameSub.handlers.onevent({ content: JSON.stringify({ name: 'First Name' }) });
  assert.equal(h.stubs.stewardedChurches.get(LATE).name, 'First Name', 'CONTROL: a name lookup did not rename the church while the key was current');
  h.Steward.restoreKey(WORDS_C);
  h.stubs.stewardedChurches.set(LATE, { name: 'Church' });
  const cacheKey = 'trinityone.steward.stewarded.' + OWN_A;
  const before = h.store.get(cacheKey);
  nameSub.handlers.onevent({ content: JSON.stringify({ name: 'Late Name' }) });
  assert.equal(h.stubs.stewardedChurches.get(LATE).name, 'Church', 'a late name lookup for the OLD key renamed a church after the restore');
  assert.equal(h.store.get(cacheKey), before, 'a late name lookup for the OLD key rewrote the old key\'s per-key cache');
});
