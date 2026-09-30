// THE CONSOLE KEEPS THE NEWEST NAME-KEY LIST, WHATEVER ORDER THE COPIES ARRIVE IN.
// Run: node --test scripts/the-console-keeps-the-newest-name-key.test.mjs
//
// Found by the audit of 660f063 (2026-09-30), and present on main. subscribeNameKey took whichever copy of the
// church's name-key envelope arrived LAST. With two relays holding different versions — one not yet synced after
// a rotation — the older copy could land second and put the console back on the old ring. The next routine
// update (a member appears) then PUBLISHED that old ring as the newest envelope; phones take the newest, so the
// new key dropped out, everything sealed under it stopped opening, and the key a Block had rotated away — the
// one the blocked member still holds — became current again.
// The member app has always kept the newest (_nameKeyTs); the console now does the same.
//
// HOW IT ASSERTS. subscribeNameKey and _ensureNameKeyLocked are lifted from the SHIPPED vendor/steward.js, with
// real NIP-44. The envelopes are signed-shape events delivered through the handler the console registers; the
// ring the next update publishes is read back by opening it with the church key, as a phone would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { fnBody, stmt } from './test-slice.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const churchSk = generateSecretKey(), CP = getPublicKey(churchSk);
const M1 = getPublicKey(generateSecretKey()), M2 = getPublicKey(generateSecretKey());
const hex = (b) => Buffer.from(b).toString('hex');
const OLD = hex(generateSecretKey()), NEW = hex(generateSecretKey());
const ck = (a, b) => nip44.utils.getConversationKey(a, b);

function once(anchor) {
  const at = STEWARD.indexOf(anchor);
  assert.notEqual(at, -1, `${anchor} is missing from vendor/steward.js`);
  assert.equal(STEWARD.indexOf(anchor, at + 1), -1, `${anchor} appears twice in vendor/steward.js`);
  return at;
}
const fn = (a) => fnBody(STEWARD, once(a), a);
const st = (a) => { once(a); return stmt(STEWARD, a); };

function console_() {
  const handlers = [], published = [];
  const world = {
    pub: CP, churchPub: CP, churchSk, actingChurch: '', NET: 'trinityone', NAMEKEY_D: 'trinityone/namekey:',
    decrypt3: nip44.decrypt, encrypt3: nip44.encrypt, getConversationKey: ck, _hex: hex,
    relays: () => ['wss://a', 'wss://b'], _byChurchOrSteward: () => true, _webQueueSync: () => {},
    _isRelayAuthed: () => true, NAME_RING_MAX: 50, toPubHex: (p) => p, _localBlocked: new Set(),
    _sealEach: async (pl, recips, f) => Object.fromEntries(recips.map(p => [p, f(pl, p)])),
    publish: async (e) => { published.push(e); return e; }, feChurch: (x) => x, now: () => 500,
    pool: { subscribeMany: (_r, _f, h) => { handlers.push(h); return { close() {} }; } },
  };
  const names = Object.keys(world);
  const body = `let _nameKeyRing = [], _nameKeyDocKeys = null, _nameKeyChecked = false;
    ${/var _nameKeyAt = 0;/.test(STEWARD) ? st('var _nameKeyAt = 0;') : ''}
    ${st('var _nameKeyListeners')}
    ${fn('function _nameKeyRingChanged()')}
    ${fn('function _nameKeyReady()')}
    const S = { ${fn('async _ensureNameKeyLocked(memberPubs, stewardPubs, opts = {})')}, ${fn('subscribeNameKey()')} };
    return { S, ring: () => _nameKeyRing };`;
  const api = new Function(...names, body)(...names.map(n => world[n]));
  return { api, handlers, published };
}
// An envelope as the console publishes it: the ring sealed to the church and to each member.
const envelope = (at, ring, recips = [CP, M1]) => ({ pubkey: CP, created_at: at, kind: 30078, tags: [['d', 'trinityone/namekey:' + CP]],
  content: JSON.stringify({ rev: ring.length, keys: Object.fromEntries(recips.map(p => [p, nip44.encrypt(JSON.stringify(ring), ck(churchSk, p))])) }) });
const openRing = (evt) => JSON.parse(nip44.decrypt(JSON.parse(evt.content).keys[CP], ck(churchSk, CP)));

test('an OLDER copy arriving second does not put the console back on the old ring', () => {
  const c = console_();
  c.api.S.subscribeNameKey();
  const h = c.handlers[0];
  h.onevent(envelope(300, [NEW, OLD]));                          // relay A: after the Block's rotation
  h.onevent(envelope(200, [OLD]));                               // relay B: not yet synced
  assert.equal(c.api.ring()[0], NEW, 'the console went back to the ring from before the rotation');
});

test('…so the next routine update publishes the NEW ring, not the old one', async () => {
  const c = console_();
  c.api.S.subscribeNameKey();
  const h = c.handlers[0];
  h.onevent(envelope(300, [NEW, OLD]));
  h.onevent(envelope(200, [OLD]));
  h.oneose();
  const out = await c.api.S._ensureNameKeyLocked([M1, M2], []);   // a new member appears
  assert.ok(out, 'CONTROL: the update published');
  assert.equal(openRing(c.published.at(-1))[0], NEW, 'the update republished the pre-rotation ring as the newest — the Block is undone');
});

test('CONTROL: copies in the ordinary order — newest last — are unaffected', async () => {
  const c = console_();
  c.api.S.subscribeNameKey();
  const h = c.handlers[0];
  h.onevent(envelope(200, [OLD]));
  h.onevent(envelope(300, [NEW, OLD]));
  assert.equal(c.api.ring()[0], NEW);
  h.oneose();
  await c.api.S._ensureNameKeyLocked([M1, M2], []);
  assert.equal(openRing(c.published.at(-1))[0], NEW);
});

test("the console's OWN publish counts as the newest: an older copy arriving after it is refused", async () => {
  const c = console_();
  c.api.S.subscribeNameKey();
  const h = c.handlers[0];
  h.onevent(envelope(300, [NEW, OLD]));
  h.oneose();
  await c.api.S._ensureNameKeyLocked([M1, M2], [], { rotate: true });   // a Block: rotate, published at now() = 500
  const rotated = c.api.ring()[0];
  assert.notEqual(rotated, NEW, 'CONTROL: the rotation minted a new key');
  h.onevent(envelope(400, [NEW, OLD]));                          // another steward's copy from before our rotation
  assert.equal(c.api.ring()[0], rotated, "an older copy replaced the console's own newer rotation");
});
