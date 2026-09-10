// RED TEAM PROBE — piece 1's `ck` fallback as a WRITE primitive.
//
// The relay admits an in-window helper's write to `checkin:<anything>` as long as the event carries a
// ['session'] tag naming a session they hold (proved by zz-redteam-matrix.probe.mjs). Before piece 1 such
// a record was unopenable by the church — no ring key, so encSubscribe parked it in the holding pen and
// nothing rendered. Piece 1 adds a SECOND way in: the ['ck'] tag, sealed under the session key the helper
// legitimately holds. So this asks whether the console now renders a helper's body over the church's own.
//
// The reader under test is the SHIPPED encSubscribe + encOpen + _encOpenSealedCopy, lifted out of
// vendor/steward.js with REAL nip44 underneath. Counters prove the harness entered them.
// Run: node scripts/zz-redteam-ck.probe.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { fnBody, stmt } from './test-slice.mjs';
import { readCheckinHelperCopy, checkinSessionOf } from './checkin-role-source.mjs';
import { D } from './trinity-doc-types.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const CHURCH = 'aa'.repeat(32);
const ADA    = 'cc'.repeat(32);
const RING   = '44'.repeat(32);
const KEY1   = '11'.repeat(32);
const S1 = 'a-svc-1', S2 = 'a-svc-2';
const unhex = h => Uint8Array.from(String(h).match(/.{1,2}/g).map(b => parseInt(b, 16)));

let openTries = 0, ckTries = 0;
const subs = [];
const stubs = {
  pub: CHURCH, churchPub: CHURCH, churchSk: unhex('99'.repeat(32)), actingChurch: null,
  NET: 'trinityone',
  _careRoster: new Set(),                       // no delegated stewards — only the church authors
  _capWaiters: { checkin: new Set() },
  _capState: { checkin: { ring: [RING], docKeys: null, rev: 1, checked: true, at: 0 } },
  _ckSessionKeys: new Map([[S1, KEY1]]),        // an owner console holds the keys it minted
  _unhex: unhex,
  // REAL nip44, under the names esbuild gave it in the bundle.
  encrypt3: (pl, k) => nip44.encrypt(pl, k),
  decrypt3: (ct, k) => { openTries++; return nip44.decrypt(ct, k); },
  getConversationKey: (sk, p) => nip44.utils.getConversationKey(sk, p),
  checkinSessionOf,
  readCheckinHelperCopy: (tags, keyHex, unseal) => { ckTries++; return readCheckinHelperCopy(tags, keyHex, unseal); },
  relays: () => ['wss://relay.test/relay'],
  pool: { subscribeMany: (_r, filters, handlers) => { subs.push({ filters, handlers }); return { close() {} }; } },
  // encSubscribe's tombstone path — captured, so a forget is visible rather than silent.
  _forgetById: (...a) => { forgets.push(a[2]); },
  _tombstoneTargets: () => [],
  _consoleDisplay: () => true,
  _consoleChurchVoice: () => true,
  _seedFromCache: () => {},
  _absorbById: () => {},
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
};
const forgets = [];
const proxyOf = (t) => new Proxy(t, {
  has: () => true,
  get: (o, k) => {
    if (k === Symbol.unscopables) return undefined;
    if (k in o) return o[k];
    const base = String(k).replace(/\d+$/, '');
    if (base in o) return o[base];
    if (k in globalThis) return globalThis[k];
    throw new ReferenceError('the lifted reader needs `' + String(k) + '` — add a stub');
  },
  set: (o, k, v) => { o[k] = v; return true; },
});
const scope = proxyOf(stubs);
const liftMethod = (sig, name) => {
  const body = fnBody(VENDOR, sig, name);
  assert.ok(body.length > 200, name + ': the slice is a stub (' + body.length + ' chars)');
  return new Function('scope', `with (scope) { return ({ ${body} }).${name}; }`)(scope);
};
const liftVar = (sig, name) => {
  const src = stmt(VENDOR, sig, name);
  return new Function('scope', `with (scope) { ${src} return ${name}; }`)(scope);
};

stubs.churchSkHeld = liftVar('var churchSkHeld = () =>', 'churchSkHeld');
stubs._encOpenSealedCopy = liftVar('var _encOpenSealedCopy = (kind, tags) =>', '_encOpenSealedCopy');
const encOpen = liftMethod('encOpen(kind, str) {', 'encOpen');
stubs.window = { Steward: { encOpen }, dispatchEvent: () => true };
const encSubscribe = liftMethod('encSubscribe(prefix, cb, kind) {', 'encSubscribe');

// ── DRIVE IT ────────────────────────────────────────────────────────────────────────────────────────
let rows = [];
encSubscribe(D.CHECKIN, (r) => { rows = r; }, 'checkin');
assert.equal(subs.length, 1, 'the lifted encSubscribe opened no subscription');
const deliver = (e) => subs[0].handlers.onevent(e);
const show = () => rows.map(r => `${r.id}:${r.childName || '?'}/${r.code || '?'}${r.out ? '/OUT=' + r.out : ''}`).sort();

const churchRec = (id, session, guardian) => ({
  pubkey: CHURCH, created_at: 1789000000,
  tags: [['d', D.CHECKIN + id], ['t', 'trinityone'], ['enc', '1'], ['session', session],
    ...(guardian ? [['p', guardian]] : [])],
  content: nip44.encrypt(JSON.stringify({ id, session, childName: 'Real ' + id, code: '4821', date: '2026-09-06' }), unhex(RING)),
});
// What an in-window helper of S1 can sign and the relay will store: garbage `content` (no ring key) and
// a `ck` tag sealed under the session key they hold. `session` is the tag they are entitled to.
const helperForge = (id, body, at = 1789000900) => ({
  pubkey: ADA, created_at: at,
  tags: [['d', D.CHECKIN + id], ['t', 'trinityone'], ['church', CHURCH], ['enc', '2'], ['session', S1],
    ['ck', nip44.encrypt(JSON.stringify(body), unhex(KEY1))]],
  content: nip44.encrypt('not for the ring', unhex('ee'.repeat(32))),
});

deliver(churchRec('r1', S1, 'dd'.repeat(32)));
deliver(churchRec('r2', S2, null));
assert.ok(openTries > 0, 'HARNESS NEVER REACHED THE DECRYPT — every row below would be vacuous');
console.log('BASELINE, the church\'s own two records:            ', show());
assert.deepEqual(show(), ['r1:Real r1/4821', 'r2:Real r2/4821'], 'the baseline register is wrong — stop here');

// 1. the helper overwrites a record in HER OWN session
deliver(helperForge('r1', { id: 'r1', session: S1, childName: 'Real r1', code: '0000', out: 'A. Stranger' }));
console.log('after the helper rewrites r1 (her own session):    ', show());

// 2. …and one in a session she holds no key for, tagged with the session she does
deliver(helperForge('r2', { id: 'r2', session: S1, childName: 'Real r2', code: '0000', out: 'A. Stranger' }));
console.log('after she rewrites r2 (session S2, tagged S1):     ', show());

// 3. a body whose `id` disagrees with its address — the row-identity fork the scope doc warns about
deliver(helperForge('r3', { id: 'r1', session: S1, childName: 'Fork', code: '9999' }));
console.log('after a ck body whose id ("r1") ≠ its address r3:  ', show());
console.log('   …the row keyed r3 reports its own id as:         ',
  JSON.stringify((rows.find(r => r.childName === 'Fork') || {}).id));

// 4. an OLDER forgery must not win
deliver(helperForge('r1', { id: 'r1', childName: 'Older forgery', code: '1111' }, 1788999000));
console.log('after an OLDER forgery of r1:                      ', show());

// 5. and the tombstone the relay accepted from her
deliver({ pubkey: ADA, created_at: 1789001000, content: '',
  tags: [['d', D.CHECKIN + 'r1'], ['t', 'trinityone'], ['church', CHURCH], ['session', S1], ['deleted', '1']] });
console.log('after her (relay-accepted) tombstone of r1:        ', show(), 'forgets:', forgets);

// 6. THE ROTATION QUESTION. A steward whose safeguarding tick is removed loses the checkinkey: ring
//    (rotateCapKey). Does the `ck` copy hand them records sealed under the NEW ring anyway, as long as
//    their slot is still in that session's envelope?  Model it as a console holding ONLY the session key.
const ROTATED = 'bb'.repeat(32);
stubs._capState.checkin.ring = [];                 // the ring was rotated away from this console
let rows2 = [];
subs.length = 0;
const encSubscribe2 = liftMethod('encSubscribe(prefix, cb, kind) {', 'encSubscribe');
encSubscribe2(D.CHECKIN, (r) => { rows2 = r; }, 'checkin');
const afterRotation = {
  pubkey: CHURCH, created_at: 1789100000,
  tags: [['d', D.CHECKIN + 'r9'], ['t', 'trinityone'], ['enc', '2'], ['session', S1],
    ['ck', nip44.encrypt(JSON.stringify({ id: 'r9', childName: 'Written AFTER the rotation', code: '7777' }), unhex(KEY1))]],
  content: nip44.encrypt(JSON.stringify({ id: 'r9', childName: 'Written AFTER the rotation', code: '7777' }), unhex(ROTATED)),
};
deliver(afterRotation);
console.log('\nring rotated away, session key kept — record written AFTER the rotation:',
  rows2.map(r => `${r.id}:${r.childName}/${r.code}`));

console.log('\ncounters — decrypt attempts %d, ck-parser entries %d', openTries, ckTries);
