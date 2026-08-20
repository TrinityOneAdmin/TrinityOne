// A CHURCH'S KEY MUST NOT FOLLOW YOU INTO ANOTHER CHURCH.
// Run: node --test scripts/capability-key-churchswitch.test.mjs
//
// Found by an adversarial audit of the capability-key commit, 2026-08-20, and confirmed against the shipped
// bundle. `_capState` was reset by _resetChurchScopedState() — which only the RESTORE path calls — and not by
// setActiveIdentity(), which is what a steward uses to move between the churches they help run.
//
// Carrying it is not a stale cache. `st.at` and `st.rev` only ever ratchet upward, so church B's envelope
// (rev 1, like every new church) is compared against church A's and DISCARDED as older. The ring then stays
// church A's for the whole session, and encSeal seals church B's documents with it.
//
// Both halves are as bad as each other:
//   - B's children's register becomes readable by A's safeguarding stewards, and unreadable by B;
//   - B's ledger entry is unreadable by B FOR EVER, because the journal is append-only and the relay has
//     already consumed that sequence number. There is no way to rewrite it.
//
// The comment inside setActiveIdentity had warned, in advance, that adding per-church state without settling
// this was the bug class behind AUDIT-2026-07-27 and the 2026-08-04 key loss. The capability work added
// per-church state and did not settle it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments, fnBody } from './test-slice.mjs';
import { webcrypto } from 'node:crypto';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { v2 as nip44 } from 'nostr-tools/nip44';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');


const SRC = readFileSync(new URL('../src/steward.src.js', import.meta.url), 'utf8');
const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
const FIN = readFileSync(new URL('../app/stew-finance.jsx', import.meta.url), 'utf8');
// Pull the per-church reset OUT of setActiveIdentity and make it runnable. If someone stops resetting a
// ratchet there, this function stops resetting it here, and the behavioural tests at the foot of this file
// fail — which is the whole point of lifting it rather than restating it.
const SHIPPED_RESET = (() => {
  const body = stripComments(fnBody(SRC, 'setActiveIdentity(targetPub) {', 'setActiveIdentity'));
  const line = body.match(/for \(const k of Object\.keys\(CAP_KEYS\)\) _capState\[k\] = \{[^}]*\};/);
  assert.ok(line, 're-anchor: setActiveIdentity no longer resets _capState — the D1 fix is gone');
  return new Function('CAP_KEYS', '_capState', line[0]);
})();

test('setActiveIdentity clears every capability ring', () => {
  const body = stripComments(fnBody(SRC, 'setActiveIdentity(targetPub) {', 'setActiveIdentity'));
  assert.match(body, /_capState\[k\] = \{[^}]*ring: \[\]/,
    'switching church leaves the previous church\'s capability rings in place. encSeal will seal the new ' +
    'church\'s check-in records and ledger entries with the OLD church\'s key: unreadable to the church that ' +
    'wrote them, readable to the one that did not.');
  assert.match(body, /_checkinMigrated = ''/,
    'the check-in migration\'s once-per-church guard survives a switch, so the church you move to never ' +
    'gets its pre-split records moved off the shared key');
});

test('and it clears the RATCHETS, not just the ring', () => {
  // The subtle half. Clearing `ring` while leaving `rev`/`at` behind is worse than useless: the new church's
  // envelope is then rejected as older, the ring stays empty, and nothing ever fills it.
  const body = stripComments(fnBody(SRC, 'setActiveIdentity(targetPub) {', 'setActiveIdentity'));
  assert.match(body, /rev: 1/, 'the rev ratchet is not reset, so the new church\'s envelope is refused as older');
  assert.match(body, /at: 0/, 'the created_at ratchet is not reset, so the new church\'s envelope is refused as older');
  assert.match(body, /checked: false/,
    'the "we have looked" flag carries over, so the console will mint for a church it has never read');
});

test('the subscription reads its state LIVE, never captures it', () => {
  // A switch REPLACES _capState[kind]. A subscription holding the old object writes the arriving ring into a
  // detached one and still fires its callback — so the screen reports a key that the sealing path does not
  // have, which is the worst of both: it looks like it works.
  const body = stripComments(fnBody(SRC, 'subscribeCapKey(kind, cb) {', 'subscribeCapKey'));
  assert.doesNotMatch(body, /const st = _capState\[kind\];/,
    'subscribeCapKey still binds _capState[kind] once at subscribe time, so it survives a church switch as a ' +
    'detached object');
  assert.match(body, /const S = \(\) => _capState\[kind\]/, 're-anchor: the live accessor is gone');
  assert.match(body, /\(actingChurch \|\| pub\) !== cp/,
    'a subscription opened for the previous church still writes into the current church\'s state');
});

test('every capability-key effect re-subscribes on identity AND reconnect', () => {
  // makeSub (steward-root.jsx) uses [idv, conn] for every other subscription in this console. These three
  // were mounted with [] — they never followed a church switch, and never re-issued their REQ after a relay
  // restart, which is a failure mode this project has already been bitten by once.
  for (const [name, src] of [['stew-dashboard.jsx', DASH], ['stew-finance.jsx', FIN]]) {
    const s = stripComments(src);
    const subs = [...s.matchAll(/subscribeCapKey\([\s\S]{0,220}?\}, \[([^\]]*)\]\)/g)];
    assert.ok(subs.length, `${name}: re-anchor — no subscribeCapKey effect found`);
    for (const m of subs) {
      assert.match(m[1], /Idv|idv/, `${name}: a subscribeCapKey effect does not re-subscribe on identity change`);
      assert.match(m[1], /Conn|conn/, `${name}: a subscribeCapKey effect does not re-subscribe after a reconnect`);
    }
  }
});

test('the mint is driven by a signal, not by a single stopwatch', () => {
  // For a church with no delegated stewards both original deps are constant ('' and '{}'), so the effect
  // fired exactly once, 1200 ms after mount. If the envelope subscription had not reached an authenticated
  // EOSE by then, ensureCapKeyFor returns false and NOTHING mints a key again that session — so "Check a
  // child in" stays disabled all session, for a feature that needed no envelope at all yesterday.
  const s = stripComments(DASH);
  const m = s.match(/ensureCapKeyFor\(kind, _stewardsForKey, caps\)[\s\S]{0,900}?\}, \[([^\]]*)\]\)/);
  assert.ok(m, 're-anchor: the mint effect changed shape');
  assert.match(m[1], /tick/,
    'the mint effect does not re-run when the key subscription delivers, so it is one 1200 ms race with no ' +
    'second attempt — lose it and the church has no register key for the rest of the session');
  assert.match(m[1], /Idv|idv/, 'the mint does not re-run for the church you switch to');
});

// ── the behaviour, not just the shape ────────────────────────────────────────────────────────────────────
// Drive the SHIPPED subscribeCapKey across a church switch and ask the one question that matters: after
// moving to church B, which key does encSeal use? The structural tests above check that the right lines are
// present; this checks what the code actually does with them.
const hex = (u8) => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/.{1,2}/g).map(b => parseInt(b, 16)));

function twoChurches() {
  const A = (() => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; })();
  const B = (() => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; })();
  const keyA = hex(webcrypto.getRandomValues(new Uint8Array(32)));
  const keyB = hex(webcrypto.getRandomValues(new Uint8Array(32)));
  const state = { checkin: { ring: [], docKeys: null, rev: 1, at: 0, checked: false } };
  const ctx = { actingChurch: '', pub: A.pub, sk: A.sk, churchPub: A.pub, churchSk: A.sk };
  let handlers = null;
  const stubs = {
    CAP_KEYS: { checkin: { d: 'trinityone/checkinkey:', cap: 'safeguarding', legacy: false, explicit: true } },
    _capWaiters: { checkin: new Set() }, _capRingChanged: () => {},
    _authFuture: () => false, _isRelayAuthed: () => true, churchSkHeld: () => true,
    relays: () => ['ws://x'], NET: 'trinityone',
    pool: { subscribeMany: (_r, _f, h) => { handlers = h; return { close() {} }; } },
    nip44d: (c, k) => nip44.decrypt(c, k), nip44ck: (a, b) => nip44.utils.getConversationKey(a, b),
    nip44e: (p, k) => nip44.encrypt(p, k),
    decrypt: (c, k) => nip44.decrypt(c, k), encrypt: (p, k) => nip44.encrypt(p, k),
    getConversationKey: (a, b) => nip44.utils.getConversationKey(a, b),
    _unhex: unhex, _hex: hex, crypto: webcrypto,
    get _capState() { return state; },
    get actingChurch() { return ctx.actingChurch; }, get pub() { return ctx.pub; },
    get sk() { return ctx.sk; }, get churchPub() { return ctx.churchPub; }, get churchSk() { return ctx.churchSk; },
  };
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      const b = String(k).replace(/[0-9]+$/, ''); if (b in t) return t[b];
      throw new ReferenceError('needs a stub for ' + String(k)); },
  });
  const mk = (sig, n) => new Function('scope', `with (scope) { return ({ ${fnBody(VENDOR, sig, n)} }).${n}; }`)(scope);
  const api = { subscribeCapKey: mk('subscribeCapKey(kind, cb) {', 'subscribeCapKey'), encSeal: mk('encSeal(kind', 'encSeal') };
  const envelope = (church, key, rev, at) => ({
    pubkey: church.pub, created_at: at,
    content: JSON.stringify({ rev, keys: { [church.pub]: nip44.encrypt(JSON.stringify([key]), nip44.utils.getConversationKey(church.sk, church.pub)) } }),
    tags: [['d', 'trinityone/checkinkey:' + church.pub]],
  });
  return { A, B, keyA, keyB, state, ctx, api,
    deliver: (e) => handlers.onevent(e), eose: () => handlers.oneose(),
    envelope,
    // THE SHIPPED RESET, LIFTED — not a copy of it. Hand-writing "what setActiveIdentity does" here would
    // make these tests pass their own sabotage: drop `rev: 1` from the product and this harness would still
    // reset it correctly in its own version, and the behavioural proof below would be about a
    // reimplementation. This repo has shipped that mistake before. So the statement is pulled out of
    // setActiveIdentity's own body and executed.
    switchTo: (C) => { ctx.actingChurch = ''; ctx.pub = C.pub; ctx.sk = C.sk; ctx.churchPub = C.pub; ctx.churchSk = C.sk;
      SHIPPED_RESET(stubs.CAP_KEYS, state); },
  };
}

test('after switching church, the register is sealed with the NEW church\'s key', () => {
  const t = twoChurches();
  // church A, which has rotated a few times — so its rev outranks any new church's
  t.api.subscribeCapKey('checkin', () => {});
  t.deliver(t.envelope(t.A, t.keyA, 3, 2000)); t.eose();
  assert.deepEqual(t.state.checkin.ring, [t.keyA], 're-anchor: church A never got its own key');

  // ...the steward switches to church B and B's envelope arrives on a fresh subscription
  t.switchTo(t.B);
  t.api.subscribeCapKey('checkin', () => {});
  t.deliver(t.envelope(t.B, t.keyB, 1, 1000));      // rev 1, and OLDER created_at — like every new church

  assert.deepEqual(t.state.checkin.ring, [t.keyB],
    'after switching to church B the console still holds church A\'s key. B\'s envelope is rev 1 and every ' +
    'ratchet carried over, so it was discarded as "older" — and encSeal now seals B\'s children\'s register ' +
    'with A\'s key: unreadable to B, readable to A\'s safeguarding stewards.');

  const rec = t.api.encSeal('checkin', { childName: 'Esther Ncube', code: '4417' });
  assert.throws(() => nip44.decrypt(rec, unhex(t.keyA)), 'church B\'s record opens with church A\'s key');
  assert.deepEqual(JSON.parse(nip44.decrypt(rec, unhex(t.keyB))), { childName: 'Esther Ncube', code: '4417' },
    'church B\'s record does not open with church B\'s own key');
});

test('a subscription left over from the previous church cannot POISON the new one', () => {
  // The first version of this test only checked that A's key did not land in B's ring — and it passed with
  // the guard deliberately removed, because `churchPub` had already moved to B so the per-recipient lookup
  // missed anyway. It proved nothing.
  //
  // The damage a stale delivery actually does is to the RATCHETS. `st.at` and `st.rev` only move upward, so
  // one late envelope from a long-lived church A (rev 9) silently raises church B's floor — and then B's own
  // envelope, which is rev 1 like every new church's, is discarded as older. The console ends up holding no
  // key for B at all, for the rest of the session, with nothing on screen to say why.
  const t = twoChurches();
  t.api.subscribeCapKey('checkin', () => {});       // church A's subscription, never closed
  t.eose();
  t.switchTo(t.B);
  t.deliver(t.envelope(t.A, t.keyA, 9, 9000));      // A's envelope arrives late, on A's still-open socket

  assert.equal(t.state.checkin.rev, 1,
    'a late envelope from the PREVIOUS church raised this church\'s rev floor to 9. Church B\'s own ' +
    'envelope is rev 1, so it will now be refused as "older" and B will never receive its key.');
  assert.equal(t.state.checkin.at, 0, 'the same, via the created_at ratchet');
  assert.deepEqual(t.state.checkin.ring, [], 'the previous church\'s key was written into this church\'s state');

  // and prove the consequence is really gone: B's own envelope still lands
  t.api.subscribeCapKey('checkin', () => {});
  t.deliver(t.envelope(t.B, t.keyB, 1, 1000));
  assert.deepEqual(t.state.checkin.ring, [t.keyB],
    'church B\'s own envelope was refused after the stale delivery — the console holds no register key at all');
});

// ── unlocking must not strand a delegate ─────────────────────────────────────────────────────────────────
// Found by round 7 (R7-25) and reproduced on a live console. lock() forgets key material and leaves
// `actingChurch` alone. unlock() calls setKey(), which rebuilds `pub` from THIS DEVICE'S seed — the church
// for an owner, the steward's personal key for a delegate. So a delegated console came back from a PIN
// unlock still saying "Acting as steward for <church>" in its header while every subscription read the
// delegate's own empty documents.
//
// Measured before the fix: subscribeSafeguard went {minors: 1, guardians: 1, loaded: true} -> {minors: 0,
// guardians: 0, loaded: false} across a lock/unlock. The kids check-in panel then rendered "No children
// marked yet", which hides the WHOLE register including a child currently checked in — so there was no
// "Check out" control left to press. That is the entire explanation for R7-1, which had been filed as a
// check-out bug. Every symptom was silence.
test('unlocking restores the acting identity, or claims none', () => {
  const body = stripComments(fnBody(SRC, 'async unlock(pin) {', 'unlock'));
  const setKeyAt = body.indexOf('setKey(seed)');
  const restoreAt = body.indexOf('setActiveIdentity(target)');
  assert.ok(setKeyAt > 0, 're-anchor: unlock no longer calls setKey');
  assert.ok(restoreAt > 0,
    'unlock() does not restore the acting identity. setKey() has just reset `pub` to this device\'s own key ' +
    'while `actingChurch` survived the lock, so a delegated console comes back claiming to act for a church ' +
    'whose documents it can no longer read — and says nothing.');
  assert.ok(restoreAt > setKeyAt,
    'the restore runs BEFORE setKey, so setKey overwrites it again — the same broken state, one line later');
  assert.match(body, /actingChurch = ''; window\.Steward\.actingChurch = '';/,
    'the acting church is not cleared before re-entering, so a failed restore leaves the console half in a ' +
    'church it cannot read rather than honestly in its own identity');
});

test('lock() still does not clear the acting church — the restore depends on it', () => {
  // If lock() ever starts clearing actingChurch, the restore above silently becomes a no-op and delegates go
  // back to being dropped into their own church on every unlock. Anchored so that change cannot pass quietly.
  const body = stripComments(fnBody(SRC, 'lock() {', 'lock'));
  assert.doesNotMatch(body, /actingChurch = ''/,
    'lock() now clears actingChurch, so unlock() has nothing to restore and every delegate is dropped back ' +
    'into their own empty church whenever the console idles');
  assert.match(body, /sk = null; pub = null;/, 're-anchor: lock no longer forgets the key material');
});
