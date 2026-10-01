// AN OWNER'S SECOND UPLOAD KEEPS THE DELEGATE'S KEY.
//   Run: node --test scripts/an-owners-second-upload-keeps-the-delegates-key.test.mjs
//
// THE DEFECT. `mediaEncryptor` republished the media-key envelope on EVERY call: it minted a fresh
// random key, sealed it to [church, ...memberPubs], and published. A delegate steward (not a member)
// was sealed in by ensureMediaKeyForMembers, but the next owner upload overwrote the envelope with a
// fresh one that had no delegate entry. The delegate's subscribeMediaKey found nothing, _mediaKeyHex
// stayed null, and every subsequent encrypted upload from the delegate's console was refused.
//
// THE FIX: mediaEncryptor only mints and publishes when _mediaKeyHex is null (first upload ever).
// Once the key exists, it is reused — the encryptor is returned without touching the envelope.
// New members and stewards are added by ensureMediaKeyForMembers, which is called on roster changes.
//
// TWO INSTRUMENTS:
//   A. When the owner already has a key, mediaEncryptor returns an encryptor without publishing.
//   B. CONTROL: When no key exists, mediaEncryptor publishes the envelope and returns an encryptor.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { fnBody, liftKeyRead } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const BUNDLE = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');

const KEY = 'ab'.repeat(32);
const churchSk = generateSecretKey(), churchPub = getPublicKey(churchSk);
const memberSk = generateSecretKey(), memberPub = getPublicKey(memberSk);

const ENCRYPTOR = fnBody(BUNDLE, 'async mediaEncryptor(memberPubs) {', 'mediaEncryptor');
const SEAL_EACH = fnBody(BUNDLE, '  async function _sealEach(payload, targets, sealTo, onProgress) {', '_sealEach');

function ownerScope(opts = {}) {
  const published = [];
  const scope = {
    actingChurch: '',
    pub: churchPub, sk: churchSk,
    _mediaKeyHex: opts.hasKey ? KEY : null,
    _mediaKeyRing: opts.hasKey ? [KEY] : [],
    _mediaKeyDocKeys: opts.hasKey ? { [churchPub]: 'sealed-blob' } : null,
    _mediaKeyChecked: true,
    _mediaKeyPushRefused: null, _mediaKeyVer: 0,
    _localBlocked: new Set(),
    _sealEachFailed: [],
    _isRelayAuthed: () => true,
    MEDIAKEY_D: 'trinityone/mediakey:', NET: 'trinityone',
    now: () => 1758800000,
    _hex: (u8) => [...u8].map(b => b.toString(16).padStart(2, '0')).join(''),
    _unhex: (h) => new Uint8Array(h.match(/.{2}/g).map(b => parseInt(b, 16))),
    encrypt3: (pl, ck) => nip44.encrypt(pl, ck),
    getConversationKey: (a, b) => nip44.utils.getConversationKey(a, b),
    feChurch: (t) => ({ ...t, pubkey: churchPub }),
    publish: async (evt) => { published.push(evt); return true; },
    crypto: webcrypto,
  };
  const locals = ['_sealEach'];
  const proxy = new Proxy(scope, {
    has: (t, k) => (new Set(locals).has(String(k)) ? false : ((k in t) || !(String(k) in globalThis))),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      if (String(k) in globalThis) return globalThis[String(k)];
      throw new ReferenceError('the lifted mediaEncryptor needs `' + String(k) + '` — add a stub');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  // the shipped key-read guards (_keyReadEpoch, _stillOn): mediaEncryptor checks them after its awaits
  const api = new Function('scope', `with (scope) { ${SEAL_EACH} ${liftKeyRead(BUNDLE)}\n return { ${ENCRYPTOR} }; }`)(proxy);
  return { api, published, scope };
}

test('A. owner with an existing key: mediaEncryptor returns without publishing', async () => {
  const { api, published } = ownerScope({ hasKey: true });
  const encryptor = await api.mediaEncryptor([memberPub]);
  assert.equal(typeof encryptor, 'function',
    'mediaEncryptor did not return an encryptor function');
  assert.equal(published.length, 0,
    'THE OWNER\'S SECOND UPLOAD REPUBLISHED THE MEDIA KEY ENVELOPE — any delegate steward whose ' +
    'entry was in the FIRST envelope is now locked out, because the new one seals only to [church, ' +
    '...members] and delegates are not members');
});

test('B. CONTROL: owner with no key: mediaEncryptor mints and publishes', async () => {
  const { api, published, scope } = ownerScope({ hasKey: false });
  const encryptor = await api.mediaEncryptor([memberPub]);
  assert.equal(typeof encryptor, 'function',
    'mediaEncryptor did not return an encryptor function');
  assert.equal(published.length, 1,
    'first-ever upload should publish the media key envelope');
  assert.ok(scope._mediaKeyHex,
    'after first mint _mediaKeyHex should be set');
  assert.ok(scope._mediaKeyDocKeys,
    'after first mint _mediaKeyDocKeys should be set');
});
