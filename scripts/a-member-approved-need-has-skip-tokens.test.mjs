// A MEMBER-APPROVED NEED HAS SKIP TOKENS.
//   Run: node --test scripts/a-member-approved-need-has-skip-tokens.test.mjs
//
// THE DEFECT. `approveCareRequest` and `publishCareNeed` in the member app (fellowship) did not add
// `skipEnc` or `skiphash` tags to the published care-need event. The steward console's version did
// (steward-meals.src.js), so "I'm covered" worked on steward-created needs but not on ones approved
// or opened through the member app. A member who asked for help and was approved could never mark a
// single day as "I'm covered" — the relay had no skip-token hashes to check against.
//
// THE FIX adds the same skip-token pattern to both fellowship functions: a random secret sealed to
// the recipient, per-day tokens derived from sha256(secret + ':' + day), and skiphash tags carrying
// sha256(token) for each date. The relay already knows how to check these (relay-careskip.test.mjs).
//
// TWO INSTRUMENTS:
//   A. approveCareRequest with forSelf=true emits skipEnc + skiphash tags
//   B. publishCareNeed with forSelf=true emits skipEnc + skiphash tags
//   CONTROL: approveCareRequest with forSelf=false emits neither

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { fnBody, liftSgMine } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const VENDOR = readFileSync(join(ROOT, 'vendor/fellowship.js'), 'utf8');

const hex = (u8) => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
const churchSk = generateSecretKey(), CHURCH = getPublicKey(churchSk);
const askerSk = generateSecretKey(), ASKER = getPublicKey(askerSk);

const APPROVE = fnBody(VENDOR, 'async approveCareRequest(req, fields) {', 'approveCareRequest');
const NEED = fnBody(VENDOR, 'async publishCareNeed(fields) {', 'publishCareNeed');
const SGMINE = liftSgMine(VENDOR);
const NEED_GUARD = (() => {
  const m = /\n  async function _careNeedRefusal\(cp\)[\s\S]*?\n  \}/.exec(VENDOR);
  assert.ok(m, 'could not lift _careNeedRefusal');
  return m[0];
})();

const SHA256HEX = fnBody(VENDOR, 'async function _sha256hex(', '_sha256hex');

function engine(publishResult = true) {
  const published = [];
  const stubs = {
    window: {
      Fellowship: {
        churchPub: CHURCH, ready: Promise.resolve(),
        setCareRequestStatus: async () => true,
      },
    },
    sk: askerSk, pub: ASKER,
    profiles: { [ASKER]: { name: 'Tester' } },
    _sgSelf: { cp: CHURCH, me: ASKER, isMinor: false, known: true },
    _carekeys: { [CHURCH]: [new Uint8Array(32)] },
    _careSeal: () => 'SEALED-BLOB',
    crypto: webcrypto,
    _hex: hex,
    encrypt: (plain, key) => nip44.encrypt(plain, key),
    getConversationKey: (a, b) => nip44.utils.getConversationKey(a, b),
    finalizeEvent2: finalizeEvent,
    _publishAny: async (_relays, evt) => { published.push(evt); if (!publishResult) throw new Error('refused'); return true; },
    churchRelays: () => ['wss://test.invalid'],
    NET: 'trinityone', CARE_D: 'trinityone/care:',
    console: { warn() {} },
  };
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      if (String(k) in globalThis) return globalThis[String(k)];
      throw new ReferenceError('the lifted engine needs `' + String(k) + '` — add a stub');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const api = new Function('scope', `with (scope) { ${SHA256HEX} ${SGMINE} ${NEED_GUARD}
    return { ${APPROVE}, ${NEED} }; }`)(scope);
  return { api, published };
}

test('A. approveCareRequest with forSelf=true emits skipEnc and skiphash tags', async () => {
  const { api, published } = engine();
  const dates = ['2026-10-01', '2026-10-02', '2026-10-03'];
  const result = await api.approveCareRequest(
    { id: 'req1', from: ASKER, forSelf: true, type: 'meals', note: 'test' },
    { dates }
  );
  assert.ok(result, 'approveCareRequest returned falsy');
  assert.equal(published.length, 1, 'expected one publish');
  const evt = published[0];
  const body = JSON.parse(evt.content);

  assert.ok(body.skipEnc, 'THE NEED HAS NO skipEnc — a member who asked for help through the member app ' +
    'can never mark "I\'m covered" for any day, because the relay has no skip-token secret to check against');

  const skipTags = evt.tags.filter(t => t[0] === 'skiphash');
  assert.equal(skipTags.length, dates.length,
    'expected one skiphash tag per date, got ' + skipTags.length);
  for (const day of dates) {
    const tag = skipTags.find(t => t[1] === day);
    assert.ok(tag, 'no skiphash tag for ' + day);
    assert.equal(tag[2].length, 64, 'skiphash value is not a 64-char hex string');
  }
});

test('B. publishCareNeed with forSelf=true emits skipEnc and skiphash tags', async () => {
  const { api, published } = engine();
  const dates = ['2026-10-05', '2026-10-06'];
  const result = await api.publishCareNeed({
    forSelf: true, type: 'other', dates, note: 'need help',
  });
  assert.ok(result, 'publishCareNeed returned falsy');
  assert.ok(result.id, 'publishCareNeed returned no id');
  assert.equal(published.length, 1, 'expected one publish');
  const evt = published[0];
  const body = JSON.parse(evt.content);

  assert.ok(body.skipEnc, 'THE MEMBER-OPENED NEED HAS NO skipEnc — "I\'m covered" will be refused by ' +
    'the relay for every day on every need a member opens themselves');

  const skipTags = evt.tags.filter(t => t[0] === 'skiphash');
  assert.equal(skipTags.length, dates.length,
    'expected one skiphash tag per date, got ' + skipTags.length);
});

test('CONTROL: approveCareRequest with forSelf=false emits no skip tokens', async () => {
  const { api, published } = engine();
  const result = await api.approveCareRequest(
    { id: 'req2', from: ASKER, forSelf: false, forName: 'Someone else', type: 'other', note: '' },
    { dates: ['2026-10-01'] }
  );
  assert.ok(result, 'approveCareRequest returned falsy');
  assert.equal(published.length, 1);
  const body = JSON.parse(published[0].content);
  assert.equal(body.skipEnc, undefined, 'a third-party need should have no skipEnc');
  assert.deepEqual(published[0].tags.filter(t => t[0] === 'skiphash'), [],
    'a third-party need should have no skiphash tags');
});
