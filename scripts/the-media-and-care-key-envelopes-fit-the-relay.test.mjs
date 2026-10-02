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
import { fnBody, stmt, liftKeyRead } from './test-slice.mjs';

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
    _mediaKeyVer: 0, _careKeyVer: 0,
    CAREKEY_D: 'trinityone/carekey:', churchSk: CHURCH_SK,
    decrypt3: (ct, ck) => nip44.v2.decrypt(ct, ck),
    _reCheckCareKeyPending: () => {}, _churchHasCareNeeds: async () => true,
    _localBlocked: new Set(), _isRelayAuthed: () => true,
    MEDIAKEY_D: 'trinityone/mediakey:', NET: 'trinityone',
    now: () => 1759300000,
    _hex: hex,
    // the shipped bundle's names for nip44 encrypt / conversation key (esbuild renames nip44e / nip44ck)
    encrypt2: (pl, ck) => nip44.v2.encrypt(pl, ck),
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
  const fit = [
    fnBody(BUNDLE, 'function _fitKeyRing(full, recipCount, sealSample) {', '_fitKeyRing in the shipped bundle'),
    // the care envelope reader, so a race can deliver a REAL envelope mid-await exactly as the subscription does
    stmt(BUNDLE, 'var _isCurrentCareEnv = (e) =>', '_isCurrentCareEnv in the shipped bundle'),
    fnBody(BUNDLE, 'function _ingestCareKeyEnv(e) {', '_ingestCareKeyEnv in the shipped bundle'),
    'scope._ingest = _ingestCareKeyEnv;',
    liftKeyRead(BUNDLE),   // _keyReadEpoch / _stillOn: every publisher checks them after its awaits
  ].join('\n');
  const bodies = [
    fnBody(BUNDLE, '    async ensureMediaKeyForMembers(memberPubs, stewardPubs) {', 'ensureMediaKeyForMembers in the shipped bundle'),
    fnBody(BUNDLE, '    async rotateMediaKey(memberPubs, stewardPubs) {', 'rotateMediaKey in the shipped bundle'),
    fnBody(BUNDLE, '    async ensureCareKeyForMembers(memberPubs, stewardPubs, opts) {', 'ensureCareKeyForMembers in the shipped bundle'),
    fnBody(BUNDLE, '    async rotateCareKey(memberPubs, stewardPubs) {', 'rotateCareKey in the shipped bundle'),
  ].join(',\n');
  scope.scope = scope;
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
    // THE CONSOLE KEEPS ITS WHOLE RING (audit of e73ef5f, finding 4): the envelope is trimmed to fit, but a key
    // this device holds may have sealed something, so the console must not forget it for that.
    const held = kind === 'media' ? e.scope._mediaKeyRing : e.scope._careKeyRing;
    assert.deepEqual(held, RING, `${name}: the console dropped keys from its OWN ring because the envelope was trimmed`);
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
  // the fresh key, then EVERY key the console held — the 50-key cap and the fit are what is PUBLISHED
  assert.deepEqual(e.scope._mediaKeyRing, [got[0], ...RING], 'the console dropped keys from its OWN ring because the envelope was trimmed');
});

// ── THE STATE MOVING UNDER AN AWAITING PUBLISHER (audit of e6a2e02 / e73ef5f, 2026-10-01) ─────────────────────
// Each publisher awaits — the care-needs check, the per-member sealing, the publish — and the console's key state
// can change in any of those gaps: a Block's rotation lands, or the church's envelope arrives on the subscription.
// A publisher that carries on from its pre-await snapshot puts an older ring back over the newer one.

// A care envelope as the church's console publishes it: the ring sealed to the church (and a member).
const careEnvelope = (ring, rev = 1, recips = [CHURCH]) => ({ pubkey: CHURCH, kind: 30078, created_at: 1759300000,
  tags: [['d', 'trinityone/carekey:' + CHURCH], ['t', 'trinityone']],
  content: JSON.stringify({ rev, keys: Object.fromEntries(recips.map(p => [p, nip44.v2.encrypt(JSON.stringify(ring), nip44.v2.utils.getConversationKey(CHURCH_SK, p))])) }) });
const gateSeal = (e) => {   // hold the FIRST sealing pass open until released
  let release; const gate = new Promise(r => { release = r; });
  const real = e.scope._sealEach; let first = true;
  e.scope._sealEach = async (pl, t, f) => { if (first) { first = false; await gate; } return real(pl, t, f); };
  return () => release();
};

test('RACE: a Block\'s sermon-key rotation that lands while a routine enrolment is sealing is not undone by it', async () => {
  const OLD = RING.slice(0, 3);
  const e = engine({ media: { ring: OLD } });
  const [blocked, a1, a2] = people(3), joiner = people(1)[0];
  e.scope._mediaKeyDocKeys = Object.fromEntries([CHURCH, blocked.pub, a1.pub, a2.pub].map(p => [p, 'x']));
  const release = gateSeal(e);
  const routine = e.api.ensureMediaKeyForMembers([blocked.pub, a1.pub, a2.pub, joiner.pub], []);   // a member joined
  await new Promise(r => setTimeout(r, 5));
  assert.equal(await e.api.rotateMediaKey([a1.pub, a2.pub, joiner.pub], []), true, 'CONTROL: the Block\'s rotation landed');
  const fresh = e.scope._mediaKeyHex;
  assert.ok(!OLD.includes(fresh), 'CONTROL: the rotation minted a fresh key');
  release(); await routine;
  assert.equal(e.scope._mediaKeyHex, fresh, 'THE CONSOLE\'S CURRENT SERMON KEY WENT BACK TO THE OLD ONE — the key the blocked member holds');
  assert.equal(e.published.length, 1, 'the routine enrolment published its pre-rotation ring AFTER the rotation, putting the blocked member back in the sermon envelope: ' + e.published.length + ' publishes');
  assert.ok(!Object.keys(JSON.parse(e.published[0].content).keys).includes(blocked.pub), 'CONTROL: the rotation left the blocked member out');
});

test('RACE: the same for the care key — a rotation during a routine enrolment is not undone', async () => {
  const OLD = RING.slice(0, 3);
  const e = engine({ care: { ring: OLD } });
  const [blocked, a1] = people(2), joiner = people(1)[0];
  e.scope._careKeyDocKeys = Object.fromEntries([CHURCH, blocked.pub, a1.pub].map(p => [p, 'x']));
  const release = gateSeal(e);
  const routine = e.api.ensureCareKeyForMembers([blocked.pub, a1.pub, joiner.pub], []);
  await new Promise(r => setTimeout(r, 5));
  assert.equal(await e.api.rotateCareKey([a1.pub, joiner.pub], []), true, 'CONTROL: the Block\'s rotation landed');
  const fresh = e.scope._careKeyHex;
  release(); await routine;
  assert.equal(e.scope._careKeyHex, fresh, 'the console\'s current care key went back to the pre-rotation one');
  assert.equal(e.published.length, 1, 'the routine enrolment published its pre-rotation care ring after the rotation');
});

test('RACE: the church\'s care envelope landing while the console checks for care needs is ADOPTED, never minted over', async () => {
  // The audit's 8-in-10: the mint gate opened, ensureCareKeyForMembers awaited _churchHasCareNeeds(), the real
  // envelope arrived during that wait, and the console then minted over it and — finding everyone keyed —
  // published nothing, sealing every need from then on with a key nobody else held.
  const REAL = hex(new Uint8Array(32).fill(0x77));
  const e = engine();
  e.scope._careKeyChecked = true; e.scope._careKeyDocKeys = null; e.scope._careKeyRev = 0;
  let release; const gate = new Promise(r => { release = r; });
  e.scope._churchHasCareNeeds = async () => { await gate; return false; };
  const run = e.api.ensureCareKeyForMembers([], []);
  await new Promise(r => setTimeout(r, 5));
  e.scope._ingest(careEnvelope([REAL]));        // the subscription delivers the church's real envelope
  assert.equal(e.scope._careKeyHex, REAL, 'CONTROL: the envelope was ingested');
  release();
  assert.equal(await run, false, 'the console carried on with a mint decided before the envelope arrived');
  assert.equal(e.scope._careKeyHex, REAL, 'THE CONSOLE REPLACED THE CHURCH\'S CARE KEY WITH ONE IT MINTED — needs sealed from now on open for nobody else');
  assert.equal(e.published.length, 0, 'a care envelope was published over the church\'s real one');
});

test('RACE: a care envelope this console is NOT in, landing during that same wait, stops the mint too', async () => {
  // The harder half: the envelope exists but was not wrapped to this console (a delegated steward the owner has
  // not keyed yet). There is no key to adopt, so only the re-check after the await stands between the console
  // and a fresh key published OVER the church's real envelope.
  const other = people(1)[0];
  const e = engine();
  e.scope._careKeyChecked = true; e.scope._careKeyDocKeys = null; e.scope._careKeyRev = 0;
  let release; const gate = new Promise(r => { release = r; });
  e.scope._churchHasCareNeeds = async () => { await gate; return false; };
  const run = e.api.ensureCareKeyForMembers([], []);
  await new Promise(r => setTimeout(r, 5));
  e.scope._ingest(careEnvelope([hex(new Uint8Array(32).fill(0x55))], 1, [other.pub]));   // not wrapped to us
  assert.ok(e.scope._careKeyDocKeys && !e.scope._careKeyHex, 'CONTROL: the envelope was recorded, and holds no copy for this console');
  release();
  assert.equal(await run, false, 'the console carried on with a mint decided before the envelope arrived');
  assert.equal(e.published.length, 0, 'A FRESH CARE KEY WAS PUBLISHED OVER THE CHURCH\'S REAL ENVELOPE — every need sealed under it is now unreadable');
});

test('a minted care key that the relay REFUSES is never used to seal (the network-view case)', async () => {
  const e = engine();
  e.scope._careKeyChecked = true; e.scope._careKeyDocKeys = null; e.scope._careKeyRev = 0;
  e.scope._churchHasCareNeeds = async () => false;
  e.scope.publish = async (evt, opts) => { e.published.push(evt); if (opts && typeof opts === 'object') opts.refused = true; return false; };
  assert.equal(await e.api.ensureCareKeyForMembers([], []), false, 'CONTROL: the refused publish reported failure');
  assert.equal(e.published.length, 1, 'CONTROL: the mint was attempted');
  assert.equal(e.scope._careKeyHex, null, 'THE CONSOLE KEPT A CARE KEY THE RELAY NEVER RECEIVED — careSeal() would seal needs nobody else can open');
});

test('CONTROL: a first care key that DOES land is adopted, and seals', async () => {
  const e = engine();
  e.scope._careKeyChecked = true; e.scope._careKeyDocKeys = null; e.scope._careKeyRev = 0;
  e.scope._churchHasCareNeeds = async () => false;
  assert.notEqual(await e.api.ensureCareKeyForMembers([], []), false);
  assert.equal(e.published.length, 1, 'the first care key was not published');
  assert.ok(e.scope._careKeyHex, 'the console did not adopt the care key it published');
  assert.deepEqual(ringForChurch(e.published[0]), [e.scope._careKeyHex], 'the console holds a different key from the one it published');
});
function ringForChurch(evt) {
  return JSON.parse(nip44.v2.decrypt(JSON.parse(evt.content).keys[CHURCH], nip44.v2.utils.getConversationKey(CHURCH_SK, CHURCH)));
}

// ── WHAT THE PUBLISHERS PROMISE ABOUT AWAITS, PINNED ONE BY ONE (rule 4; audit of d1116f6) ──────────────────
// Each sealing pass waits on its own gate, released by hand in the order a row needs.
const gateEverySeal = (e) => {
  const gates = [];
  const real = e.scope._sealEach;
  e.scope._sealEach = async (pl, t, f) => { let release; const g = new Promise(r => { release = r; }); gates.push(release); await g; return real(pl, t, f); };
  return gates;
};

test('care: an envelope arriving DURING the publish is not overwritten by what this console published', async () => {
  const e = engine({ care: { ring: RING.slice(0, 2) } });
  const [a1] = people(1), joiner = people(1)[0];
  e.scope._careKeyDocKeys = { [CHURCH]: 'x', [a1.pub]: 'x' };
  const theirs = { [CHURCH]: 'theirs', [a1.pub]: 'theirs', [joiner.pub]: 'theirs' };
  e.scope.publish = async (evt) => { e.published.push(evt); e.scope._careKeyDocKeys = theirs; e.scope._careKeyVer++; return { id: 'ok' }; };   // the subscription delivers another console's envelope mid-publish
  await e.api.ensureCareKeyForMembers([a1.pub, joiner.pub], []);
  assert.equal(e.published.length, 1, 'CONTROL: the enrolment published');
  assert.equal(e.scope._careKeyDocKeys, theirs, 'THE CONSOLE OVERWROTE THE ENVELOPE THAT ARRIVED DURING ITS PUBLISH with its own older view');
});

test('media: an envelope arriving DURING the publish is not overwritten by what this console published', async () => {
  const e = engine({ media: { ring: RING.slice(0, 2) } });
  const [a1] = people(1), joiner = people(1)[0];
  e.scope._mediaKeyDocKeys = { [CHURCH]: 'x', [a1.pub]: 'x' };
  const theirs = { [CHURCH]: 'theirs', [a1.pub]: 'theirs', [joiner.pub]: 'theirs' };
  e.scope.publish = async (evt, opts) => { e.published.push(evt); e.scope._mediaKeyDocKeys = theirs; e.scope._mediaKeyVer++; if (opts && typeof opts === 'object') opts.refused = false; return { id: 'ok' }; };
  await e.api.ensureMediaKeyForMembers([a1.pub, joiner.pub], []);
  assert.equal(e.published.length, 1, 'CONTROL: the enrolment published');
  assert.equal(e.scope._mediaKeyDocKeys, theirs, 'THE CONSOLE OVERWROTE THE ENVELOPE THAT ARRIVED DURING ITS PUBLISH with its own older view');
});

for (const kind of ['care', 'media']) {
  test(`${kind}: a rotation that has STARTED (still sealing) stops a routine enrolment from publishing the old ring`, async () => {
    const e = engine({ [kind]: { ring: RING.slice(0, 2) } });
    const [blocked, a1] = people(2), joiner = people(1)[0];
    e.scope[kind === 'care' ? '_careKeyDocKeys' : '_mediaKeyDocKeys'] = { [CHURCH]: 'x', [blocked.pub]: 'x', [a1.pub]: 'x' };
    const gates = gateEverySeal(e);
    const routine = kind === 'care' ? e.api.ensureCareKeyForMembers([blocked.pub, a1.pub, joiner.pub], []) : e.api.ensureMediaKeyForMembers([blocked.pub, a1.pub, joiner.pub], []);
    await new Promise(r => setTimeout(r, 5));
    const block = kind === 'care' ? e.api.rotateCareKey([a1.pub, joiner.pub], []) : e.api.rotateMediaKey([a1.pub, joiner.pub], []);
    await new Promise(r => setTimeout(r, 5));
    assert.equal(gates.length, 2, 'CONTROL: both are sealing');
    gates[0]();                                       // the enrolment finishes sealing FIRST, the rotation still running
    await routine;
    assert.equal(e.published.length, 0, `THE ENROLMENT PUBLISHED THE PRE-ROTATION ${kind.toUpperCase()} RING, WITH THE MEMBER BEING BLOCKED IN IT, while the Block's rotation was under way`);
    gates[1](); assert.equal(await block, true, 'CONTROL: the rotation landed');
    assert.equal(e.published.length, 1, 'CONTROL: only the rotation published');
    assert.ok(!Object.keys(JSON.parse(e.published[0].content).keys).includes(blocked.pub), 'CONTROL: the rotation left the blocked member out');
  });
}
