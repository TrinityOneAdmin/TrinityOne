// A WORKER'S SESSION KEY OPENS ITS OWN SESSION'S RECORDS AND PROVABLY NOTHING ELSE.
// Run: node --test scripts/a-session-key-opens-one-session-and-nothing-else.test.mjs
//
// reference/DESIGN-CHECKIN-IN-THE-MEMBER-APP-2026-09-09.md §6 rule 2, and slice D of
// reference/SCOPE-CHECKIN-MEMBER-ACTIONS-2026-09-11.md: "the test that matters is the NEGATIVE one — with
// only a helper key, members / finance / safeguarding / care must be unreachable. That is the same test that
// caught the capability-key leak in August, where granting Finance handed over the children's register."
//
// scripts/checkin-key-separation.test.mjs holds that line for the CONSOLE's keys — a treasurer's Finance key
// and a lead's safeguarding RING key do not open each other's documents. It does not cover the WORKER's key.
// The worker holds neither of those: she holds a per-session symmetric key (helperKeyFor), and this feature
// hands it to a rota volunteer who is trusted with children and NOT with finance, the members list or the
// safeguarding register. So the invariant that matters for her is: her session key is a DISTINCT key that
// opens exactly its own session's ['ck'] copies — not another session's, not the ring's copy in `content`,
// and not a finance / care / member-name document sealed under any other key.
//
// WHERE THE POINT-OF-USE HALF LIVES, stated so this file is not mistaken for the whole of rule 2:
//   • the SCREEN showing only the register and no other privileged surface —
//     the-kids-tab-is-only-for-a-cleared-worker.test.mjs (the tab renders KidsRegister and nothing else);
//   • the shipped READER refusing another session's records with the wrong key —
//     a-cleared-worker-reads-one-sessions-register.test.mjs ("EVENING key opens nothing of the MORNING
//     register", and "the session TAG decides, not the key that happens to fit").
// This file holds the line at the ciphertext, "the only place it can be held honestly" — a paraphrase of the
// crypto would agree with itself for ever, so it runs the SHIPPED readCheckinHelperCopy and the SHIPPED sealer
// (the module gateway.mjs imports and esbuild inlines into vendor/fellowship.js), with real nip44.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import * as nip44 from 'nostr-tools/nip44';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
// THE SHIPPED READER, out of the one module the console, the relay and the member app all import — never a
// test-local copy, which would be the test answering the question it is named after.
import { readCheckinHelperCopy, checkinSessionOf } from './checkin-role-source.mjs';

const hex = (u8) => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/.{1,2}/g).map(b => parseInt(b, 16)));
const key = () => hex(webcrypto.getRandomValues(new Uint8Array(32)));

// The five keys a children's session lives beside, EACH DISTINCT AND RANDOM, exactly as the product mints
// them: issueCheckinSessionKeys is `crypto.getRandomValues(32)` per session, and CAP_KEYS.finance /
// .checkin / the name key / the care key are each their own random ring. None is derived from another; that
// independence is the whole fix from August, so the fixture must not quietly share one.
const SESSION_AM = key();     // the worker's key for the morning session — the ONLY key her phone holds
const SESSION_PM = key();     // another session's key — she is not on it
const RING_KEY   = key();     // trinityone/checkinkey: — the safeguarding ring's, sealing `content`
const FINANCE_KEY = key();    // the church ledger's
const CARE_KEY   = key();     // the care team's
const NAME_KEY   = key();     // the members-list name key

const AM = 'svc-am-2026-09-13';
const PM = 'svc-pm-2026-09-13';

// SEAL a check-in body into a ['ck'] copy under `keyHex`, and tag the record with `sid` — the shape
// _encSealedCopies + _encCleartextTags produce. `content` here stands for the ring's copy: it is present and
// is NOT the thing under test, because a worker must never read it.
const sealCk = (bodyObj, keyHex) => nip44.encrypt(JSON.stringify(bodyObj), unhex(keyHex));
const record = (bodyObj, sid, ckKeyHex, contentKeyHex) => ({
  tags: [['d', 'trinityone/checkin:ci1'], ['session', sid], ['enc', '2'], ['ck', sealCk(bodyObj, ckKeyHex)]],
  content: contentKeyHex ? nip44.encrypt(JSON.stringify(bodyObj), unhex(contentKeyHex)) : '',
});
// The shipped reader's unseal, wired to real nip44 — this is what subscribeCheckinRegister passes it.
const openWith = (tags, keyHex) => readCheckinHelperCopy(tags, keyHex, (ct, k) => nip44.decrypt(ct, unhex(k)));

const CHILD = { id: 'ci1', childName: 'Esther Ncube', code: '4417', session: AM };

// ── THE BASELINE. Her key opens her session. Every refusal below is measured against this. ────────────────
test('BASELINE: the worker\'s session key opens her own session\'s record', () => {
  const rec = record(CHILD, AM, SESSION_AM, RING_KEY);
  assert.equal(checkinSessionOf(rec.tags), AM, 'fixture: the session tag is not the morning\'s');
  const obj = openWith(rec.tags, SESSION_AM);
  assert.ok(obj, 'the shipped reader could not open a record sealed under the very key it was handed');
  assert.equal(obj.childName, 'Esther Ncube', 'the copy opened but the body is wrong — the fixture proves nothing');
  assert.equal(obj.code, '4417', 'the pickup code, the field the door needs, did not survive the round trip');
});

// ── THE CAPABILITY LEAK, THE WAY IT ACTUALLY HAPPENED: one key opening a document it must not. ─────────────
test('her session key opens NOTHING sealed under any OTHER key — this is the August invariant for the worker', () => {
  // Each of these is a real document sealed under a real, distinct key. If the worker's session key opened any
  // of them, a rota volunteer trusted only with the creche would be reading it — which is precisely what
  // granting Finance did to the children's register before CAP_KEYS split the secrets.
  const cases = [
    ['another session\'s check-in record', record(CHILD, PM, SESSION_PM, RING_KEY)],
    ['the safeguarding ring\'s copy in content, re-cast as a ck tag', { tags: [['session', AM], ['ck', nip44.encrypt(JSON.stringify(CHILD), unhex(RING_KEY))]], content: '' }],
    ['a finance ledger entry', { tags: [['session', AM], ['ck', nip44.encrypt(JSON.stringify({ memo: 'Pastor stipend', amount: -2100 }), unhex(FINANCE_KEY))]], content: '' }],
    ['a care need', { tags: [['session', AM], ['ck', nip44.encrypt(JSON.stringify({ recipient: 'a vulnerable member', notes: 'meals Tue/Thu' }), unhex(CARE_KEY))]], content: '' }],
    ['a member\'s name from the members list', { tags: [['session', AM], ['ck', nip44.encrypt(JSON.stringify({ name: 'Maureen Dacre' }), unhex(NAME_KEY))]], content: '' }],
  ];
  for (const [what, rec] of cases) {
    // The record is TAGGED with the morning session, so a reader that tried "any key I hold" would reach for
    // SESSION_AM and hand back the plaintext. readCheckinHelperCopy returns null when the key does not open
    // the copy — it does NOT throw, so one hostile document cannot take the register down with it.
    assert.equal(openWith(rec.tags, SESSION_AM), null,
      'THE WORKER\'S SESSION KEY OPENED ' + what.toUpperCase() + '. A key scoped to one creche session read ' +
      'a document from outside it — the capability leak this whole feature is built to refuse.');
  }
});

// ── THE OTHER DIRECTION: a capability key does not open HER records either. ────────────────────────────────
test('a finance or care key does not open the worker\'s session record', () => {
  const rec = record(CHILD, AM, SESSION_AM, RING_KEY);
  for (const [what, k] of [['the finance key', FINANCE_KEY], ['the care key', CARE_KEY], ['the name key', NAME_KEY], ['another session\'s key', SESSION_PM]]) {
    assert.equal(openWith(rec.tags, k), null,
      'A CHILD\'S PICKUP CODE WAS READ WITH ' + what.toUpperCase() + '. The session\'s ck copy is sealed to ' +
      'the session key alone; nothing else may open it.');
  }
});

// ── AND THE RING'S OWN COPY IS NOT THE WORKER'S TO READ. ──────────────────────────────────────────────────
test('the worker never reaches `content` — she holds no ring key and readCheckinHelperCopy only ever reads the ck tag', () => {
  // `content` is the safeguarding ring's copy of the very same body. A worker holds no ring key; the reader
  // must open the ck tag and NOTHING in content. readCheckinHelperCopy takes only `tags`, so it cannot reach
  // content at all — pinned here because a future "fall back to content" would be exactly the wrong widening.
  const rec = record(CHILD, AM, SESSION_AM, RING_KEY);
  assert.ok(rec.content, 'fixture: the ring copy is absent, so "does not read it" would pass vacuously');
  // Give the reader the RING key and the record. It still only reads the ck tag (sealed under SESSION_AM), so
  // the ring key opens nothing here — the reader has no path to content, whatever key it is handed.
  assert.equal(openWith(rec.tags, RING_KEY), null,
    'the ring key opened the ck copy, or the reader reached into content — either is a door the worker path must not have');
});
