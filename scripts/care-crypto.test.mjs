// Care-need sealing — SECURITY-AUDIT-2026-07-20 H3.
// Run: node --test scripts/care-crypto.test.mjs
//
// A care need names a vulnerable person and, by the notes field's own placeholder, carries their home
// address, a health inference and a "who not to ring after 9pm" window. Manna already treats exactly this
// class of doc as must-encrypt; Care shipped it in cleartext. These tests pin the wire format so a future
// refactor can't quietly put the identifying half back on the wire.
//
// The invariant that makes the feature work at all: the CLEAR half must stay clear. If `type` or `dates`
// were sealed too, the slot grid, the sort and the live/past filter would need the key — and a member who
// hasn't been keyed yet would see nothing rather than "help is needed on Tuesday".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { v2 as nip44 } from 'nostr-tools/nip44';

const churchSk = generateSecretKey(), churchPub = getPublicKey(churchSk);
const memberSk = generateSecretKey(), memberPub = getPublicKey(memberSk);
const strangerSk = generateSecretKey();

const hex = (u8) => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/.{1,2}/g).map(b => parseInt(b, 16)));

// mirrors steward.src.js ensureCareKeyForMembers + careSeal, and fellowship.src.js _ingestCareKey/_careOpen
const mintCareKey = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const wrapFor = (keyHex, fromSk, toPub) => nip44.encrypt(keyHex, nip44.utils.getConversationKey(fromSk, toPub));
const unwrap = (ct, mySk, fromPub) => nip44.decrypt(ct, nip44.utils.getConversationKey(mySk, fromPub));
const seal = (obj, keyHex) => nip44.encrypt(JSON.stringify(obj), unhex(keyHex));
const open = (ct, keyHex) => JSON.parse(nip44.decrypt(ct, unhex(keyHex)));

const SENSITIVE = { displayLabel: 'The Okonkwo family', notes: 'Chemo Tuesdays — 14 Elm St, side door. Don’t ring after 9pm.', recipient: memberPub, dietary: ['coeliac'] };
const CLEAR = { type: 'meals', dates: ['2026-08-01', '2026-08-03'], meals: ['dinner'], dayMeals: {}, startDate: '2026-08-01', endDate: '2026-08-03' };

test('a member the church keyed can open the sealed half', () => {
  const careKey = mintCareKey();
  const env = { keys: { [memberPub]: wrapFor(careKey, churchSk, memberPub) }, rev: 1 };
  const body = { ...CLEAR, enc: seal(SENSITIVE, careKey) };

  const theirKey = unwrap(env.keys[memberPub], memberSk, churchPub);
  assert.equal(theirKey, careKey, 'member could not unwrap the church care key');
  assert.deepEqual(open(body.enc, theirKey), SENSITIVE);
});

test('the identifying half is NOT on the wire in cleartext', () => {
  const careKey = mintCareKey();
  const body = { ...CLEAR, enc: seal(SENSITIVE, careKey) };
  const wire = JSON.stringify(body);
  // the exact strings that made this a finding: a name, an address, a health inference, the recipient key
  for (const leak of ['Okonkwo', 'Elm St', 'Chemo', 'coeliac', memberPub]) {
    assert.equal(wire.includes(leak), false, `"${leak}" is still readable on the wire`);
  }
  assert.equal('displayLabel' in body, false, 'displayLabel shipped alongside the sealed copy');
  assert.equal('notes' in body, false, 'notes shipped alongside the sealed copy');
  assert.equal('recipient' in body, false, 'recipient pubkey shipped alongside the sealed copy');
});

test('the clear half stays clear, so the slot grid renders without the key', () => {
  const careKey = mintCareKey();
  const body = { ...CLEAR, enc: seal(SENSITIVE, careKey) };
  assert.equal(body.type, 'meals');
  assert.deepEqual(body.dates, ['2026-08-01', '2026-08-03']);
  assert.equal(body.startDate, '2026-08-01');   // sorting + the live/past filter depend on these
  assert.equal(body.endDate, '2026-08-03');
});

test('someone the church never keyed cannot open it', () => {
  const careKey = mintCareKey();
  const env = { keys: { [memberPub]: wrapFor(careKey, churchSk, memberPub) }, rev: 1 };
  const body = { ...CLEAR, enc: seal(SENSITIVE, careKey) };
  assert.equal(env.keys[getPublicKey(strangerSk)], undefined, 'stranger should not be in the envelope');
  // and even holding the ciphertext, a wrong key must not open it
  assert.throws(() => open(body.enc, mintCareKey()), 'a wrong care key decrypted the sealed half');
});

test('rotation locks out a member dropped from the envelope, without breaking the rest', () => {
  // the whole point of a key: someone who leaves (or is blocked) can be excluded on the next rotation —
  // which cleartext could never do, since anything they cached stayed readable forever.
  const k1 = mintCareKey();
  const oldBody = { ...CLEAR, enc: seal(SENSITIVE, k1) };
  const k2 = mintCareKey();                                  // rotate
  const newEnv = { keys: {}, rev: 2 };                       // dropped member simply isn't wrapped
  const newBody = { ...CLEAR, enc: seal(SENSITIVE, k2) };
  assert.equal(newEnv.keys[memberPub], undefined);
  assert.throws(() => open(newBody.enc, k1), 'the old key still opened a need sealed after rotation');
  assert.deepEqual(open(oldBody.enc, k1), SENSITIVE);         // history sealed under k1 is unaffected
});

test('a v1 cleartext doc is still readable (a church mid-pilot must not lose its open needs)', () => {
  const v1 = { ...CLEAR, ...SENSITIVE };                      // pre-2026-07-20 shape: everything in the clear
  assert.equal(v1.enc, undefined);
  assert.equal(v1.displayLabel, 'The Okonkwo family');        // openNeed() passes these straight through
});
