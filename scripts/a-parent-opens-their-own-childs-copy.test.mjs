// A PARENT OPENS THEIR OWN CHILD'S COPY — AND PROVABLY NOBODY ELSE'S.
// Run: node --test scripts/a-parent-opens-their-own-childs-copy.test.mjs
//
// STEP 2 of the parent surface (reference/DESIGN-CHECKIN-IN-THE-MEMBER-APP-2026-09-09.md §2/§4/§7, and the
// STOP-AND-PLAN section of reference/SCOPE-CHECKIN-MEMBER-ACTIONS-2026-09-11.md). This file is the SEALING
// half: the `['gk']` copy a parent can open. The READER is
// scripts/a-parent-reads-their-own-children.test.mjs and the SCREEN is
// scripts/a-parent-sees-their-own-childs-pickup-code.test.mjs.
//
// ⚠ THE SCOPE DOC MAKES ONE TEST MANDATORY BEFORE THIS MAY SHIP: "a full point-of-use test that a
// NON-GUARDIAN (a member, a sibling, another family's parent) opens NOTHING — the guardianOfIn-not-
// guardianLinkedIn sibling trap the sealing doc records is exactly the mistake to prove against." It is the
// first test below and it is written as a REFUSAL, not as a permission.
//
// ── WHAT IS SHIPPED CODE HERE AND WHAT IS FIXTURE ─────────────────────────────────────────────────────────
// Every step between a record being written and a parent reading a pickup code off it is lifted out of the
// built bundles and executed:
//   • the CONSOLE's writer — `_encCleartextTags`, `_encSealedCopies` and the new `_encGuardianCopies`, all
//     three out of vendor/steward.js, with real nip44;
//   • the WORKER's writers — `writeCheckin` and `releaseCheckin` out of vendor/fellowship.js;
//   • the PARENT's opener — the shared `readCheckinGuardianCopy`, which is the same function esbuild inlines
//     into vendor/fellowship.js for the reader to call.
// What is stubbed is the world: the clock, the socket, the key ring.
//
// ⚠ THE BUNDLE, NOT THE SOURCE. `npm run build:fellowship` and `bash scripts/build-steward.sh` are what make
// vendor/*.js; editing src/ and running this without them tests the OLD bundles and goes green.
//
// NO RELAY AND NO PORT. Delivery — who the relay hands a record to — is proved against a REAL gateway in
// scripts/a-check-in-record-the-relay-will-share.test.mjs, which needed no gate change for any of this.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import * as nip44 from 'nostr-tools/nip44';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { fnBody, stmt } from './test-slice.mjs';
import { checkinGuardianPubs, checkinGuardianCopies, readCheckinGuardianCopy,
         readCheckinHelperCopy, buildHelperGrant, GRANT_SOURCE } from './checkin-role-source.mjs';
import { D } from './trinity-doc-types.mjs';

const STEWARD    = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

const hex = (u8) => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array((String(h).match(/.{1,2}/g) || []).map(x => parseInt(x, 16)));
const key32 = () => hex(webcrypto.getRandomValues(new Uint8Array(32)));
// REAL secp256k1 PAIRS. nip44's conversation key is an ECDH over the peer's pubkey, so random bytes make
// every seal throw — and checkinGuardianCopies CATCHES per guardian, which would turn "she opened nothing"
// into a vacuous pass. The `gk` count assertions below are the guard against walking into that.
const keypair = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

// ── THE PEOPLE. Named once so a failure message names the same person twice. ──────────────────────────────
const church  = keypair();
const mother  = keypair();   // a guardian of Ivy — ['p']-tagged on Ivy's record
const father  = keypair();   // ALSO a guardian of Ivy — the second ['p'] tag, and the whole of test 2
const sibling = keypair();   // Ivy's older brother. In the church's family map, NOT a guardian of this record
const other   = keypair();   // another family's parent — a guardian, of somebody else's child
const member  = keypair();   // an ordinary member of the congregation
const worker  = keypair();   // a cleared, in-window children's worker

const SESSION = 'svc-sunday-am';
const NOW = 1788600000;                 // 2026-09-06T12:00:00Z
const SG_RING_KEY = key32();            // the safeguarding ring — what `content` is sealed to
const SESSION_KEY = key32();            // the worker's key — what the ['ck'] copy is sealed under

const ck = (sk, pub) => nip44.v2.utils.getConversationKey(sk, pub);
// THE PARENT'S OPENER, exactly as the member app calls it: every ['gk'] tag tried against the conversation
// key between MY secret and the record AUTHOR's pubkey.
const opensFor = (who, evt) => readCheckinGuardianCopy(evt.tags, (ct) => nip44.v2.decrypt(ct, ck(who.sk, evt.pubkey)));

// ── THE CONSOLE'S WRITER, LIFTED OUT OF vendor/steward.js ─────────────────────────────────────────────────
// All three derivations, with the console's real crypto. A stub for any of them would be this file answering
// the question it is named after.
//
// ⚠ THE BUNDLE'S SPELLINGS. esbuild renames on collision: `nip44e` is `encrypt3` in vendor/steward.js and
// `nip44ck` is `getConversationKey`. Stub the src/ spellings and the scope Proxy throws — which is the loud
// failure this harness wants, because `_encSealedCopies` and `checkinGuardianCopies` both SWALLOW their own
// failures and answer [], so a mis-stubbed harness silently produces records with no second copy at all and
// every refusal in this file passes vacuously. The `gk`/`ck` counters in consoleRecord() are the guard.
function consoleWriter(actor, sessionKeys) {
  const scope = {
    sk: actor.sk,
    _ckSessionKeys: sessionKeys,
    encrypt3: nip44.v2.encrypt,
    getConversationKey: (a, b) => nip44.v2.utils.getConversationKey(a, b),
    checkinGuardianCopies,
    _unhex: unhex,
    JSON, Math, String, Array, Object, Set, RegExp, Boolean, Number,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the lifted console writer needs a stub for ' + String(k)); },
  });
  const liftVar = (sig, name) => new Function('scope',
    'with (scope) { return (' + stmt(STEWARD, sig, name)
      .replace(/^var\s+\w+\s*=\s*/, '').replace(/;\s*$/, '') + '); }')(proxy);
  return {
    cleartextTags: new Function(fnBody(STEWARD, 'function _encCleartextTags(kind, obj) {', '_encCleartextTags') + '\nreturn _encCleartextTags;')(),
    sealedCopies: liftVar('var _encSealedCopies = (kind, obj) =>', '_encSealedCopies'),
    guardianCopies: liftVar('var _encGuardianCopies = (kind, obj) =>', '_encGuardianCopies'),
  };
}

// ONE CHECK-IN RECORD, the way encPublish assembles one: `content` sealed to the safeguarding ring, the
// cleartext tags, the helper's ['ck'] copy and the guardian's ['gk'] copies. Signed by the console.
function consoleRecord(body, { session = SESSION, sessionKey = SESSION_KEY, by = church, expectGk = null } = {}) {
  const keys = new Map(); if (session && sessionKey) keys.set(session, sessionKey);
  const w = consoleWriter(by, keys);
  const rec = session ? { ...body, session } : { ...body };
  const sealed = w.sealedCopies('checkin', rec);
  const guarded = w.guardianCopies('checkin', rec);
  const tags = [['d', D.CHECKIN + rec.id], ['t', 'trinityone'], ['church', church.pub],
    ['enc', (sealed.length || guarded.length) ? '2' : '1'],
    ...w.cleartextTags('checkin', rec), ...sealed, ...guarded];
  // A COUNTER THAT PROVES THE SHIPPED SEALER RAN. Both derivations swallow failure and answer [].
  const gkN = tags.filter(t => t[0] === 'gk').length;
  if (expectGk != null) assert.equal(gkN, expectGk,
    'fixture: the shipped _encGuardianCopies produced ' + gkN + ' guardian copies, not ' + expectGk + ' — the ' +
    'harness is stubbing a name the bundle does not use, and every refusal in this file would pass vacuously');
  return finalizeEvent({ kind: 30078, created_at: NOW,
    content: nip44.v2.encrypt(JSON.stringify(rec), unhex(SG_RING_KEY)), tags }, by.sk);
}

// ── THE WORKER'S WRITERS, LIFTED OUT OF vendor/fellowship.js ──────────────────────────────────────────────
// `_publishAny` captures the event instead of sending it, so the test reads exactly what the phone would sign.
function workerWriter(actor, keys, name) {
  const captured = [];
  const scope = {
    toPub: (x) => x, sk: actor.sk, pub: actor.pub,
    _ckMemKeyGet: (cp, sid) => keys[sid] || '',
    encrypt: nip44.v2.encrypt,
    getConversationKey: (a, b) => nip44.v2.utils.getConversationKey(a, b),
    checkinGuardianPubs, checkinGuardianCopies,
    _unhex: unhex,
    finalizeEvent2: (t, s) => finalizeEvent(t, s),
    CHECKIN_D: D.CHECKIN, NET: 'trinityone', relaysForChurch: () => [],
    _publishAny: async (_relays, evt) => { captured.push(evt); return true; },
    String, Date, Math, JSON, Number, Array, Object, Boolean, RegExp, console,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the shipped ' + name + ' needs a stub for ' + String(k)); },
  });
  const api = new Function('scope', 'with (scope) { return ({ ' +
    fnBody(FELLOWSHIP, 'async ' + name + '(churchNpub, rec) {', name) + ' }); }')(proxy);
  return { fn: api[name], captured };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════
// 1. THE MANDATORY NEGATIVE. A NON-GUARDIAN OPENS NOTHING.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════
test('THE MANDATORY NEGATIVE: an ordinary member, another family\'s parent and a SIBLING open nothing', () => {
  // Ivy's record, with BOTH her parents named. Every other person below is real, in this church, and has a
  // live key — the only thing they do not have is a ['p'] tag on this record.
  const evt = consoleRecord({ id: 'ci-ivy', childName: 'Ivy Henderson', code: '4417',
    guardians: [mother.pub, father.pub] }, { expectGk: 2 });

  // ── RE-ANCHOR FIRST, so every refusal below is measured against a copy that really opens. A file whose
  // baseline is broken reports a clean sheet of refusals it never tested (the sabotage-matrix lesson).
  assert.equal(opensFor(mother, evt)?.code, '4417',
    're-anchor: the guardian herself cannot open her own copy, so every refusal below is vacuous');

  // ── AN ORDINARY MEMBER of the congregation.
  assert.equal(opensFor(member, evt), null,
    'AN ORDINARY MEMBER OPENED A CHILD\'S PICKUP CODE. The gk copy is the only thing standing between a ' +
    'served ciphertext and a stranger reading the code that releases a child.');

  // ── ANOTHER FAMILY'S PARENT. A guardian — of somebody else.
  assert.equal(opensFor(other, evt), null,
    'ANOTHER FAMILY\'S PARENT OPENED THIS CHILD\'S RECORD. Being a guardian is not the question; being a ' +
    'guardian OF THIS CHILD is.');

  // ── THE SIBLING TRAP, which is the one the sealing doc names by name. Ivy's older brother is linked to
  // her in the church's family map and would match a `guardianLinkedIn`-shaped test; he is not a ['p']-tagged
  // guardian of this record and must open nothing. The relay's own gate makes the same distinction with
  // guardianOfIn() being directional, and this is the sealing half of it.
  assert.equal(opensFor(sibling, evt), null,
    'A SIBLING OPENED HIS SISTER\'S CHECK-IN RECORD. "Linked to" is not "guardian of" — this is the exact ' +
    'mistake reference/SCOPE-CHECKIN-SEALING-2026-09-10.md records, arriving by the sealing route instead ' +
    'of the gate route.');

  // ── AND THE WORKER, who holds the session key. She reads the register through the ['ck'] copy and must
  // gain nothing from the guardian's — stated because "she can read it anyway" is true and is NOT the point:
  // a gk that opened to a session key would make every worker's phone a key to every parent's copy on every
  // record it was ever served, in perpetuity, and the ck copy is revoked with the envelope.
  assert.equal(opensFor(worker, evt), null,
    'the worker\'s own key opened a GUARDIAN\'s copy — the two locks are not two locks');
  assert.ok(readCheckinHelperCopy(evt.tags, SESSION_KEY, (c, k) => nip44.v2.decrypt(c, unhex(k))),
    're-anchor: the worker cannot open the helper copy either, so the line above proves nothing');
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════
// 2. TWO GUARDIANS, TWO COPIES — the find()-takes-the-first bug, given its own test.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════
test('BOTH of a child\'s guardians open their OWN copy — not just whichever tag comes first', () => {
  const evt = consoleRecord({ id: 'ci-two', childName: 'Ivy Henderson', code: '9081',
    guardians: [mother.pub, father.pub] }, { expectGk: 2 });

  // THE ORDER IS THE TEST. `tags.find(t => t[0] === 'gk')` returns the MOTHER's copy to everyone, so the
  // mother reads the code and the father reads nothing — and it looks exactly like "the app does not work
  // for me" rather than like a bug. Both are asserted, and the father's is the one that catches it.
  assert.equal(opensFor(mother, evt)?.code, '9081', 'the FIRST guardian could not open her copy');
  assert.equal(opensFor(father, evt)?.code, '9081',
    'THE SECOND GUARDIAN READ NOTHING. A reader that takes the first [\'gk\'] tag hands the mother\'s ' +
    'ciphertext to the father, never tries his own, and one parent of every two-parent family is silently ' +
    'left with no pickup code.');
  assert.equal(opensFor(mother, evt).childName, 'Ivy Henderson');
  assert.equal(opensFor(father, evt).childName, 'Ivy Henderson');

  // AND THE ORDER REVERSED, because "it works for whoever is listed first" is exactly the shape that passes
  // a one-parent test.
  const rev = consoleRecord({ id: 'ci-two-r', childName: 'Ivy Henderson', code: '9081',
    guardians: [father.pub, mother.pub] }, { expectGk: 2 });
  assert.equal(opensFor(mother, rev)?.code, '9081', 'the guardian listed SECOND could not open her copy');
  assert.equal(opensFor(father, rev)?.code, '9081', 'the guardian listed FIRST could not open his copy');
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════
// 3. ONLY A ['p']-TAGGED PUBKEY GETS A COPY — the two derivations cannot disagree.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════
test('the guardian copies are sealed to EXACTLY the pubkeys the record [\'p\']-tags, malformed input included', () => {
  // A hostile / sloppy guardians array: an npub, an object, a one-element array (the shape that defeated a
  // bare String()+regex in writeCheckin), a duplicate in a different case, and two good ones.
  //
  // ⚠ THE ONE-ELEMENT ARRAY NAMES A PERSON WHO IS ON NO OTHER LINE. It was `[father.pub]` first, and the
  // sabotage matrix showed that row biting nothing: father is already listed as a bare string, so the
  // de-duplication swallowed the coercion and the divergence was invisible. The sibling appears here and
  // NOWHERE ELSE, so dropping the `typeof === 'string'` guard from either derivation puts HIM in one list
  // and not the other, which is exactly the failure this test exists to catch.
  const rec = { id: 'ci-mixed', childName: 'A Child', code: '1234', session: SESSION,
    guardians: [mother.pub, 'npub1notahexpubkey', { pub: father.pub }, [sibling.pub], mother.pub.toUpperCase(),
                '', null, father.pub, '  ' + mother.pub + '  '] };
  const w = consoleWriter(church, new Map([[SESSION, SESSION_KEY]]));
  const pTags = w.cleartextTags('checkin', rec).filter(t => t[0] === 'p').map(t => t[1]);
  const gkPubs = checkinGuardianPubs(rec);
  assert.deepEqual(gkPubs, pTags,
    'THE GUARDIAN COPIES AND THE [\'p\'] TAGS DISAGREE ABOUT WHO A GUARDIAN IS. A gk with no p is a copy ' +
    'the relay never serves its recipient (invisible, unopenable); a p with no gk is a parent who is told ' +
    'nothing. Both normalisations must be the same one.');
  assert.deepEqual(pTags, [mother.pub, father.pub],
    're-anchor: the console\'s own [\'p\'] derivation no longer refuses malformed guardians, so the ' +
    'agreement above is agreement about the wrong list');
  assert.equal(w.guardianCopies('checkin', rec).length, 2,
    'the shipped derivation sealed a copy to something that is not one of the two real guardians');
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════
// 4. THE EARLY-RETURN TRAP: a church with NO SERVICE DOCUMENT still gives the parent their code.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════
test('a church with NO service document still seals the parent\'s copy — gk does not ride on the session', () => {
  // `_encSealedCopies` answers [] the moment a record has no `session` ("an ordinary Sunday with no service
  // document" — its own words), which is a real and common church. Deriving the guardian copy inside that
  // branch would cost every such church its parents' pickup codes while the church's own register carried on
  // working, with nothing on any screen to look at.
  const evt = consoleRecord({ id: 'ci-nosvc', childName: 'Ivy Henderson', code: '5150',
    guardians: [mother.pub] }, { session: '', expectGk: 1 });

  assert.equal(evt.tags.filter(t => t[0] === 'session').length, 0,
    're-anchor: this fixture DOES carry a session tag, so it is not testing the no-service-document church');
  assert.equal(evt.tags.filter(t => t[0] === 'ck').length, 0,
    're-anchor: the helper copy survived a record with no session, so the early return this test is about ' +
    'is no longer there');
  assert.equal(opensFor(mother, evt)?.code, '5150',
    'A CHURCH WITH NO SERVICE DOCUMENT LOST ITS PARENTS\' PICKUP CODES. The guardian copy was derived ' +
    'inside _encSealedCopies\' `if (!sid) return []`, so the one thing that still works for that church — ' +
    'the parent\'s own copy — silently stopped working.');
  assert.equal(opensFor(member, evt), null, 're-anchor: anyone opens this record, so the line above is not about a key');
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════
// 5. `content` IS NEVER THE PARENT'S ROUTE IN.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════
test('the parent reads the TAGS and never `content` — a readable content yields them nothing', () => {
  // A record whose `content` is PLAIN, READABLE JSON. On a real relay this cannot be a check-in record the
  // console wrote — but a hostile or broken writer can produce one, and a reader that fell back to `content`
  // would hand a stranger the pickup code of every record they were ever served.
  const rec = { id: 'ci-clear', childName: 'Ivy Henderson', code: '7742', session: SESSION, guardians: [mother.pub] };
  const w = consoleWriter(church, new Map([[SESSION, SESSION_KEY]]));
  const evt = finalizeEvent({ kind: 30078, created_at: NOW,
    content: JSON.stringify({ ...rec, code: 'CLEARTEXT-9999' }),
    tags: [['d', D.CHECKIN + rec.id], ['t', 'trinityone'], ['church', church.pub], ['enc', '2'],
      ...w.cleartextTags('checkin', rec), ...w.guardianCopies('checkin', rec)] }, church.sk);

  const got = opensFor(mother, evt);
  assert.equal(got.code, '7742',
    'the guardian read the code out of `content` rather than out of her own sealed copy');
  assert.notEqual(got.code, 'CLEARTEXT-9999',
    'THE PARENT\'S READER FELL BACK TO `content`. It is the ring\'s half of the double lock and a parent ' +
    'holds no ring key; a reader that opens it reads whatever the author put there.');
  // And a record with NO gk at all yields nothing, however readable its content is.
  const noGk = finalizeEvent({ kind: 30078, created_at: NOW, content: JSON.stringify(rec),
    tags: [['d', D.CHECKIN + 'ci-nogk'], ['t', 'trinityone'], ['church', church.pub], ['session', SESSION],
           ['p', mother.pub]] }, church.sk);
  assert.equal(opensFor(mother, noGk), null,
    'A RECORD WITH NO GUARDIAN COPY YIELDED A BODY ANYWAY, out of cleartext `content`. "No copy for me" is ' +
    'the honest answer and the screen has words for it; inventing one out of `content` is not.');
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════
// 6. THE WORKER'S OWN WRITER seals the copy too — and to exactly the one pubkey the arrival delivered.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════
test('a WORKER\'s check-in seals the parent\'s copy — to the arrival\'s guardian, and to nobody else', async () => {
  const w = workerWriter(worker, { [SESSION]: SESSION_KEY }, 'writeCheckin');
  const res = await w.fn(church.pub, { session: SESSION, childName: 'Ivy Henderson', code: '3312', guardian: mother.pub });
  assert.equal(res.ok, true, 'the shipped worker writer refused to write at all: ' + JSON.stringify(res));
  const evt = w.captured[0];
  assert.equal(evt.tags.filter(t => t[0] === 'gk').length, 1,
    'THE WORKER WROTE NO GUARDIAN COPY. The arrival named the parent, the relay will serve them the record, ' +
    'and there is nothing in it they can open.');
  assert.equal(opensFor(mother, evt)?.code, '3312', 'the parent the arrival named could not open the worker\'s record');
  assert.equal(opensFor(mother, evt).childName, 'Ivy Henderson');
  assert.equal(opensFor(father, evt), null,
    'the worker\'s phone sealed a copy to a guardian NO ARRIVAL NAMED — it holds no guardian map and must ' +
    'never guess a family');
  assert.equal(opensFor(other, evt), null, 'another family\'s parent opened a worker-written record');

  // AND NO ARRIVAL MEANS NO COPY — a walk-up at the desk, which is an ordinary Sunday and not a fault. The
  // record is complete, the church reads it, and the parent's screen says to ask the worker for the code.
  const walkUp = workerWriter(worker, { [SESSION]: SESSION_KEY }, 'writeCheckin');
  const r2 = await walkUp.fn(church.pub, { session: SESSION, childName: 'A Child', code: '5001' });
  assert.equal(r2.ok, true, 'a check-in with no guardian was REFUSED — nothing in this feature may block a child');
  assert.equal(walkUp.captured[0].tags.filter(t => t[0] === 'gk').length, 0, 'a guardian copy was invented from nothing');
  assert.equal(walkUp.captured[0].tags.filter(t => t[0] === 'p').length, 0, 're-anchor: a guardian was tagged from nothing either');
  assert.ok(readCheckinHelperCopy(walkUp.captured[0].tags, SESSION_KEY, (c, k) => nip44.v2.decrypt(c, unhex(k))),
    'the walk-up record lost the WORKER\'s copy as well, so it is broken rather than guardian-less');
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════
// 7. A CHECKOUT REACHES THE PARENT — or their screen shows a child present for ever.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════
test('a worker\'s CHECKOUT carries the parent\'s tag and copy, so "collected" can reach them at all', async () => {
  const w = workerWriter(worker, { [SESSION]: SESSION_KEY }, 'releaseCheckin');
  const res = await w.fn(church.pub, { session: SESSION, rel: 'ci-ivy', manual: false, guardians: [mother.pub, father.pub] });
  assert.equal(res.ok, true, 'the shipped release writer refused: ' + JSON.stringify(res));
  const evt = w.captured[0];

  // THE ['p'] TAG IS WHAT MAKES THE RELAY SERVE IT. canRead's CHECKIN_D branch is UNCHANGED — it has always
  // returned true for a p-tagged pubkey; a release that carried no p-tag was simply never served to the
  // family, so a guardian could never learn their child had been collected (a guardian is never served a
  // tombstone either, so "the record went away" is not available as a signal).
  assert.deepEqual(evt.tags.filter(t => t[0] === 'p').map(t => t[1]).sort(), [mother.pub, father.pub].sort(),
    'THE RELEASE NAMES NO GUARDIAN, so the relay serves it to nobody in the family and the parent\'s screen ' +
    'shows a child present for ever.');
  assert.equal(evt.tags.filter(t => t[0] === 'gk').length, 2, 'the release carries no guardian copy to open');
  assert.equal(evt.tags.filter(t => t[0] === 'rel').length, 1, 're-anchor: the release lost the tag readers fold it by');

  const m = opensFor(mother, evt), f = opensFor(father, evt);
  assert.equal(m.rel, 'ci-ivy', 'the guardian\'s copy of the release does not name the check-in it collects');
  assert.equal(m.manual, false, 'a code-matched checkout reached the parent marked as by-hand');
  assert.equal(f.rel, 'ci-ivy', 'the SECOND guardian could not open the release — the find()-first bug again');
  assert.equal(opensFor(other, evt), null, 'another family\'s parent opened this release');
  assert.equal(opensFor(member, evt), null, 'an ordinary member opened this release');

  // A BY-HAND RELEASE IS RECORDED DISTINCTLY AND IS VISIBLE TO THE GUARDIAN — design §7, in those words.
  const byHand = workerWriter(worker, { [SESSION]: SESSION_KEY }, 'releaseCheckin');
  await byHand.fn(church.pub, { session: SESSION, rel: 'ci-ivy', manual: true, guardians: [mother.pub] });
  assert.equal(opensFor(mother, byHand.captured[0]).manual, true,
    'a MANUAL release reached the parent looking like an ordinary code-matched one — §7 requires a parent to ' +
    'be able to see their child was collected WITHOUT their code');

  // AND A HOSTILE SEALED BODY REACHES NEITHER A TAG NOR A CIPHER. The guardians on a release come from a row
  // a helper may have written (F-B), so `guardians: [{…}]` must be refused before it becomes a ['p'] tag.
  const junk = workerWriter(worker, { [SESSION]: SESSION_KEY }, 'releaseCheckin');
  await junk.fn(church.pub, { session: SESSION, rel: 'ci-ivy', guardians: [{ pub: mother.pub }, 'npub1x', [mother.pub]] });
  assert.deepEqual(junk.captured[0].tags.filter(t => t[0] === 'p'), [],
    'a malformed guardian entry became a [\'p\'] tag — String([x]) is x, and a list is the shape this ' +
    'writer must never accept');
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════
// 7b. A SEAL THAT FAILS COSTS THAT GUARDIAN THEIR COPY — AND NEVER COSTS THE CHILD THEIR CHECK-IN.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════
test('a guardian whose key will not seal loses THEIR copy and nothing else', async () => {
  // reference/DOMAIN.md and design §10: nothing in this feature may stand between a child and the desk. A
  // guardian pubkey that is 64 hex characters and NOT a point on the curve — a corrupted map entry, a typo
  // that survived the regex — makes nip44's conversation key throw. checkinGuardianCopies catches per
  // guardian, and both writers compute it OUTSIDE their own try/catch so a throw could not be mistaken for
  // a seal-failed refusal.
  //
  // UNTESTED UNTIL AN AUDIT SAID SO, 2026-09-11: removing that try/catch left every check-in test green.
  const BAD = 'ff'.repeat(32);
  assert.throws(() => ck(mother.sk, BAD), 'fixture: this pubkey seals fine, so nothing below is about a failure');

  // ── THE CONSOLE. Two guardians, one of them unsealable.
  const evt = consoleRecord({ id: 'ci-badkey', childName: 'Ivy Henderson', code: '4417',
    guardians: [BAD, mother.pub] }, { expectGk: 1 });
  assert.equal(opensFor(mother, evt)?.code, '4417',
    'A BROKEN GUARDIAN ENTRY TOOK THE GOOD ONE WITH IT. One family member\'s key failing must never cost ' +
    'the other their pickup code.');
  assert.equal(evt.tags.filter(t => t[0] === 'p').length, 2,
    're-anchor: the bad pubkey never became a [\'p\'] tag either, so the record is not the shape this tests');
  assert.equal(JSON.parse(nip44.v2.decrypt(evt.content, unhex(SG_RING_KEY))).code, '4417',
    'THE RECORD ITSELF WAS LOST TO A GUARDIAN\'S BROKEN KEY. The church could not read its own register ' +
    'because one parent\'s pubkey was corrupt — which is the shape "nothing blocks a check-in" forbids.');

  // ── AND THE WORKER'S WRITER, where a refusal would be a child not checked in at a door.
  const w = workerWriter(worker, { [SESSION]: SESSION_KEY }, 'writeCheckin');
  const res = await w.fn(church.pub, { session: SESSION, childName: 'Ivy Henderson', code: '3312', guardian: BAD });
  assert.equal(res.ok, true,
    'THE WORKER WAS REFUSED THE WHOLE CHECK-IN because one guardian pubkey would not seal: ' +
    JSON.stringify(res) + '. A parent\'s copy failing must cost that parent their copy, never the child ' +
    'their place in the room.');
  assert.equal(w.captured[0].tags.filter(t => t[0] === 'gk').length, 0, 'a copy was sealed to a key that cannot hold one');
  assert.ok(readCheckinHelperCopy(w.captured[0].tags, SESSION_KEY, (c, k) => nip44.v2.decrypt(c, unhex(k))),
    'the WORKER lost her own copy of the record over a guardian\'s broken key');

  // ── AND THE RELEASE, where a refusal would be a child who cannot be signed out of a room.
  const r = workerWriter(worker, { [SESSION]: SESSION_KEY }, 'releaseCheckin');
  const rr = await r.fn(church.pub, { session: SESSION, rel: 'ci-badkey', guardians: [BAD, mother.pub] });
  assert.equal(rr.ok, true, 'a child could not be CHECKED OUT because a guardian pubkey would not seal: ' + JSON.stringify(rr));
  assert.equal(opensFor(mother, r.captured[0]).rel, 'ci-badkey', 'the good guardian lost their copy of the release too');
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════
// 8. THE SHAPE IS ADDITIVE. A record without the copy is byte-identical to yesterday's.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════
test('a record with NO guardians is exactly the record this writer produced yesterday', () => {
  // The property the sealing doc measured for ['ck'] and the reason `content` is not reshaped: a mixed corpus
  // has to stay honest, and the relay rehydrates ALL history on every update.
  const rec = { id: 'ci-plain', childName: 'A Child', code: '1111', session: SESSION };
  const w = consoleWriter(church, new Map([[SESSION, SESSION_KEY]]));
  assert.deepEqual(w.guardianCopies('checkin', rec), [], 'a record with no guardians grew a guardian copy');
  assert.deepEqual(w.guardianCopies('finance', { guardians: [mother.pub] }), [],
    'THE DERIVATION FIRED ON A FINANCE DOCUMENT. encPublish is shared with five other call sites ' +
    '(app/stew-finance.jsx x4, src/steward-manna.src.js) and a ledger entry has no guardians.');
  assert.deepEqual(w.guardianCopies('members', { guardians: [mother.pub] }), [], 'the derivation fired on a members document');
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════
// 9. THE ENVELOPE AND THE RING ARE UNCHANGED BY ANY OF THIS.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════
test('the ring still opens `content` and the worker still opens [\'ck\'] — nothing was taken away', () => {
  const evt = consoleRecord({ id: 'ci-all', childName: 'Ivy Henderson', code: '4417',
    guardians: [mother.pub, father.pub] }, { expectGk: 2 });
  assert.equal(JSON.parse(nip44.v2.decrypt(evt.content, unhex(SG_RING_KEY))).code, '4417',
    'the safeguarding ring lost its own copy of a record');
  assert.equal(readCheckinHelperCopy(evt.tags, SESSION_KEY, (c, k) => nip44.v2.decrypt(c, unhex(k))).code, '4417',
    'the cleared worker lost her copy of a record');
  assert.equal(evt.tags.filter(t => t[0] === 'enc')[0][1], '2', 'the marker no longer says there is a second ciphertext');
  // AND THE THREE COPIES REALLY ARE THREE DIFFERENT CIPHERTEXTS under three different keys.
  const cts = new Set([evt.content, ...evt.tags.filter(t => t[0] === 'ck' || t[0] === 'gk').map(t => t[1])]);
  assert.equal(cts.size, 4, 'two of the four copies on this record are the same ciphertext, so they are not four locks');
  assert.throws(() => nip44.v2.decrypt(evt.tags.find(t => t[0] === 'gk')[1], unhex(SESSION_KEY)),
    're-anchor: the session key opens a guardian copy, so test 1\'s worker refusal proves nothing');
});

// A grant is built here for one reason only: to keep this file honest that the session key it seals with is
// the same one a real envelope hands a worker. Nothing above depends on the envelope, and if that ever stops
// being true this assertion is where it shows.
test('fixture check: the session key sealed with is the one a real envelope carries', () => {
  const { doc: g, failed } = buildHelperGrant({ session: SESSION, source: GRANT_SOURCE, lifetime: 'session',
    from: NOW - 600, until: NOW + 3600, helpers: [worker.pub], keepers: [church.pub], sessionKeyHex: SESSION_KEY,
    wrap: (toPub, plain) => nip44.v2.encrypt(plain, ck(church.sk, toPub)) });
  assert.deepEqual(failed, [], 'the fixture envelope could not be wrapped, so nothing above is about a real key');
  assert.ok(g.keys[worker.pub], 'the worker has no slot in her own session envelope');
});
