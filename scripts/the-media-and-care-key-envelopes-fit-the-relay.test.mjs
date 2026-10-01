// THE SERMON AND CARE KEY ENVELOPES ARE FITTED TO THE RELAY'S 1 MB CAP.
//   Run: node --test scripts/the-media-and-care-key-envelopes-fit-the-relay.test.mjs
//
// An envelope carries one sealed copy of the whole key ring per recipient, and the relay refuses any message
// over 1 MB (scripts/gateway.mjs: `new WebSocketServer({ … maxPayload: 1024 * 1024 })`). The care-key
// rotation, the name key and the group key already shrink the ring to fit; three publishers did not —
// ensureMediaKeyForMembers, rotateMediaKey and ensureCareKeyForMembers — so in a big church with a long ring
// their envelope was refused and new members never got the sermon/care key (and a Block's rotation of the
// sermon key failed). Owner, 2026-10-01: drop the OLDEST keys to fit, keep the current one, same as the others.
//
// Nothing here is re-typed: the three functions and the shared fitter are sliced out of the SHIPPED
// vendor/steward.js and run with real NIP-44 sealing (nostr-tools), so the sizes are the real sizes. The
// published envelope is captured, measured as the relay would receive it, and every recipient's copy can be
// opened to read back which keys it holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nip44, generateSecretKey, getPublicKey } from 'nostr-tools';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const BUNDLE = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
const RELAY_CAP = 1024 * 1024;   // scripts/gateway.mjs maxPayload — asserted against the source below

const hex = (u8) => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/../g).map(b => parseInt(b, 16)));
// A RING OF 50 DISTINCT KEYS, newest first — RING[0] is the current key, RING[49] the oldest.
const RING = Array.from({ length: 50 }, (_, i) => hex(new Uint8Array(32).fill(i + 1)));

const CHURCH_SK = generateSecretKey();
const CHURCH = getPublicKey(CHURCH_SK);
const people = (n) => Array.from({ length: n }, () => { const s = generateSecretKey(); return { sk: s, pub: getPublicKey(s) }; });
const MANY = people(300);        // a church of ~300: a 50-key ring is ~1.7 MB here, far over the cap
const FEW = people(10);          // the control: a small church fits the whole ring

function engine({ media = {}, care = {} } = {}) {
  const published = [];
  const warned = [];
  const scope = {
    actingChurch: '', pub: CHURCH, churchPub: CHURCH, sk: CHURCH_SK,
    _mediaKeyHex: media.ring ? media.ring[0] : null, _mediaKeyRing: media.ring ? media.ring.slice() : [],
    _mediaKeyDocKeys: {}, _mediaKeyPushRefused: null,
    _careKeyHex: care.ring ? care.ring[0] : null, _careKeyRing: care.ring ? care.ring.slice() : [],
    _careKeyDocKeys: care.ring ? {} : null, _careKeyRev: 3, _careKeyChecked: true, _careKeyPending: [],
    _reCheckCareKeyPending: () => {}, _churchHasCareNeeds: async () => true,
    _localBlocked: new Set(), _isRelayAuthed: () => true,
    MEDIAKEY_D: 'trinityone/mediakey:', CAREKEY_D: 'trinityone/carekey:', NET: 'trinityone',
    now: () => 1759300000,
    _hex: hex,
    // the shipped bundle's names for nip44 encrypt / conversation key (esbuild renames nip44e / nip44ck)
    encrypt3: (pl, ck) => nip44.v2.encrypt(pl, ck),
    getConversationKey: (a, b) => nip44.v2.utils.getConversationKey(a, b),
    _sealEach: async (pl, targets, sealTo) => Object.fromEntries([...targets].map(t => [t, sealTo(pl, t)])),
    feChurch: (t) => ({ ...t, pubkey: CHURCH }),
    publish: async (evt, opts) => { published.push(evt); if (opts && typeof opts === 'object') opts.refused = false; return true; },
    console: { warn: (m) => warned.push(String(m)), log() {}, error() {} },
    JSON, Set, Object, Array, String, Number, Boolean, Promise, Error, Math, Date, crypto, Uint8Array,
    window: { dispatchEvent: () => true },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } },
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      throw new ReferenceError('the lifted key functions need `' + String(k) + '` — add a stub');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const fit = fnBody(BUNDLE, 'function _fitKeyRing(full, recipCount, sealSample) {', '_fitKeyRing in the shipped bundle');
  const bodies = [
    fnBody(BUNDLE, '    async ensureMediaKeyForMembers(memberPubs, stewardPubs) {', 'ensureMediaKeyForMembers in the shipped bundle'),
    fnBody(BUNDLE, '    async rotateMediaKey(memberPubs, stewardPubs) {', 'rotateMediaKey in the shipped bundle'),
    fnBody(BUNDLE, '    async ensureCareKeyForMembers(memberPubs, stewardPubs, opts) {', 'ensureCareKeyForMembers in the shipped bundle'),
  ].join(',\n');
  const api = new Function('scope', `with (scope) { ${fit}\n const _api = { ${bodies} }; return _api; }`)(proxy);
  return { api, published, warned, scope };
}

// What the relay receives, sized the way it sizes it: the whole ["EVENT", …] frame, signature included.
const frameBytes = (evt) => Buffer.byteLength(JSON.stringify(['EVENT', { ...evt, id: 'f'.repeat(64), sig: 'f'.repeat(128) }]));
// Open one recipient's copy, as their app would.
function ringFor(evt, who) {
  const o = JSON.parse(evt.content);
  const w = o.keys[who.pub];
  assert.ok(w, 'the envelope has no copy for a recipient it was asked to key');
  return JSON.parse(nip44.v2.decrypt(w, nip44.v2.utils.getConversationKey(who.sk, CHURCH)));
}

test('the cap this file sizes against is the relay\'s', () => {
  const gw = readFileSync(join(ROOT, 'scripts/gateway.mjs'), 'utf8');
  assert.match(gw, /new WebSocketServer\(\{ noServer: true, maxPayload: 1024 \* 1024,/,
    'the relay\'s message cap changed — re-measure RELAY_CAP here before trusting any row below');
});

test('CONTROL — a small church gets the WHOLE ring, untrimmed, from all three', async () => {
  const m = engine({ media: { ring: RING }, care: { ring: RING } });
  await m.api.ensureMediaKeyForMembers(FEW.map(p => p.pub), []);
  await m.api.ensureCareKeyForMembers(FEW.map(p => p.pub), []);
  await m.api.rotateMediaKey(FEW.map(p => p.pub), []);
  assert.equal(m.published.length, 3, 'one of the three did not publish at all: ' + m.published.length);
  assert.deepEqual(ringFor(m.published[0], FEW[3]), RING, 'media: a ring that fits was trimmed anyway');
  assert.deepEqual(ringFor(m.published[1], FEW[3]), RING, 'care: a ring that fits was trimmed anyway');
  const rot = ringFor(m.published[2], FEW[3]);
  assert.equal(rot.length, 50, 'rotation: the ring is capped at 50 (fresh + 49), and that fits a small church');
  assert.deepEqual(rot.slice(1), RING.slice(0, 49), 'rotation: the superseded keys were not carried in order');
  assert.deepEqual(m.warned, [], 'a church that fits was told its ring was trimmed');
});

for (const [name, run, kind] of [
  ['ensureMediaKeyForMembers', (api, ps) => api.ensureMediaKeyForMembers(ps, []), 'media'],
  ['ensureCareKeyForMembers', (api, ps) => api.ensureCareKeyForMembers(ps, []), 'care'],
]) {
  test(`${name}: a 50-key ring for 300 people is trimmed from the OLDEST end until it fits under the cap`, async () => {
    const e = engine({ [kind]: { ring: RING } });
    const out = await run(e.api, MANY.map(p => p.pub));
    assert.equal(e.published.length, 1, `${name} published nothing`);
    const bytes = frameBytes(e.published[0]);
    assert.ok(bytes < RELAY_CAP, `${name} published a ${bytes}-byte envelope; the relay refuses anything over ${RELAY_CAP}, so these 300 people never get the key`);
    assert.notEqual(out, false, `${name} reported failure on a publish that landed`);
    const got = ringFor(e.published[0], MANY[150]);
    assert.ok(got.length < RING.length && got.length >= 1, `${name}: ring of ${got.length} — nothing was trimmed, yet it fits?`);
    assert.equal(got[0], RING[0], `${name}: the CURRENT key is not first — everything sealed from now on would be unreadable`);
    assert.deepEqual(got, RING.slice(0, got.length), `${name}: the keys kept are not the NEWEST ${got.length} — the wrong end of the ring was dropped`);
    assert.ok(e.warned.some(w => /ring trimmed/.test(w)), `${name}: the ring was trimmed silently`);
    // the console's own ring now matches what it published, so its next publish does not re-grow it
    const held = kind === 'media' ? e.scope._mediaKeyRing : e.scope._careKeyRing;
    assert.deepEqual(held, got, `${name}: the console holds a different ring from the one it published`);
  });
}

test('rotateMediaKey: a rotation for 300 people keeps the fresh key and the newest old keys, and fits', async () => {
  const e = engine({ media: { ring: RING } });
  const out = await e.api.rotateMediaKey(MANY.map(p => p.pub), []);
  assert.equal(out, true, 'the rotation reported failure — a Block would leave the removed member with the sermon key');
  assert.equal(e.published.length, 1);
  const bytes = frameBytes(e.published[0]);
  assert.ok(bytes < RELAY_CAP, `rotateMediaKey published a ${bytes}-byte envelope; the relay refuses it and the blocked member keeps the key`);
  const got = ringFor(e.published[0], MANY[7]);
  assert.ok(got.length < 50, 'nothing was trimmed');
  assert.equal(got[0], e.scope._mediaKeyHex, 'the fresh key is not the current one');
  assert.ok(!RING.includes(got[0]), 'no fresh key was minted');
  assert.deepEqual(got.slice(1), RING.slice(0, got.length - 1), 'the superseded keys kept are not the newest ones');
  assert.deepEqual(e.scope._mediaKeyRing, got, 'the console holds a different ring from the one it published');
});
