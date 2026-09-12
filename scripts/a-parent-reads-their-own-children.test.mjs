// A PARENT'S PHONE READS THEIR OWN CHILDREN — AND PROVABLY NOTHING ELSE.
// Run: node --test scripts/a-parent-reads-their-own-children.test.mjs
//
// STEP 2 of the parent surface, READER half. The sealing half is
// scripts/a-parent-opens-their-own-childs-copy.test.mjs (which also carries the MANDATORY NON-GUARDIAN
// NEGATIVE the scope doc requires) and the SCREEN is
// scripts/a-parent-sees-their-own-childs-pickup-code.test.mjs. A reader with no screen is an engine nobody
// consults (CLAUDE.md rule 1), so all three exist.
//
// THE OWNER'S CONSTRAINT, in his words: *"parents don't have any records surfaced to them… the code must
// still be shown as we designed."* So what this subscription may emit is one thing only — the children whose
// record THIS PHONE'S OWN KEY opened — and every test below is about something it must NOT emit.
//
// ── WHAT IS SHIPPED CODE HERE AND WHAT IS FIXTURE ─────────────────────────────────────────────────────────
//   • the READER is `subscribeMyChildrenCheckins` lifted out of vendor/fellowship.js, with the shared
//     `readCheckinGuardianCopy` / `checkinSessionOf` underneath it and real nip44 for the crypto;
//   • the RECORDS are written by the CONSOLE's own derivations (`_encCleartextTags`, `_encSealedCopies`,
//     `_encGuardianCopies`) lifted out of vendor/steward.js, and by the WORKER's `releaseCheckin` lifted out
//     of vendor/fellowship.js. Nothing between a church sealing a record and a parent reading a code off it
//     is this file's own copy.
//
// ⚠ THE BUNDLE, NOT THE SOURCE. `npm run build:fellowship` / `bash scripts/build-steward.sh` make vendor/*.js.
// ⚠ ESBUILD RENAMES ON COLLISION: in vendor/fellowship.js the nip44 pair are `decrypt` / `getConversationKey`
//   and in vendor/steward.js `encrypt3` / `getConversationKey`. Stub the src/ spellings and the scope Proxy
//   throws, which is the loud failure this harness wants.
//
// NO RELAY AND NO PORT.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import * as nip44 from 'nostr-tools/nip44';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { fnBody, stmt } from './test-slice.mjs';
import { checkinGuardianCopies, readCheckinGuardianCopy, checkinSessionOf, checkinGuardianPubs,
         MAX_SESSION_SECONDS } from './checkin-role-source.mjs';
import { D } from './trinity-doc-types.mjs';

const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const STEWARD    = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

const hex = (u8) => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array((String(h).match(/.{1,2}/g) || []).map(x => parseInt(x, 16)));
const keypair = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church   = keypair();
const mother   = keypair();   // Ivy's mother
const father   = keypair();   // Ivy's father
const stranger = keypair();   // another family's parent — a guardian, of somebody else's child
const worker   = keypair();   // a cleared children's worker, who authors the releases below

const SESSION = 'svc-sunday-am', OTHER_SESSION = 'svc-sunday-pm';
const NOW = 1788600000;                              // 2026-09-06T12:00:00Z
const SG_RING_KEY = hex(webcrypto.getRandomValues(new Uint8Array(32)));
const SESSION_KEY = hex(webcrypto.getRandomValues(new Uint8Array(32)));

// THE SHIPPED WINDOW, not a number restated here — a test that hard-coded a figure would go on passing if
// the product's own constant changed underneath it. It is BOUND TO MAX_SESSION_SECONDS in the bundle, which
// is the point: a session may legitimately run 26 hours (an all-day event, a residential), and a parent's
// view that expired first would drop the row WHILE THE CHILD WAS STILL IN THE ROOM.
// ⚠ EVALUATED OUT OF THE BUNDLE, NOT IMPORTED FROM THE SHARED MODULE, AND THE DIFFERENCE IS THE WHOLE
// POINT. The lifted reader reads `MYKIDS_WINDOW` as a FREE VARIABLE resolved through this file's scope stub.
// A stub taking its value from `MAX_SESSION_SECONDS` here would be this test answering its own question: a
// sabotage that rewrote the shipped constant to 16 hours changed nothing the reader saw, and the matrix row
// measuring it reported a clean pass. (Found by that row, 2026-09-11 — "a stub answers the question".)
// So both statements are evaluated out of vendor/fellowship.js, and what the reader is handed below is
// literally the number the product ships, however it is spelled.
const MYKIDS_WINDOW = new Function(
  stmt(FELLOWSHIP, 'var MAX_SESSION_SECONDS =', 'MAX_SESSION_SECONDS') + '\n' +
  stmt(FELLOWSHIP, 'var MYKIDS_WINDOW =', 'MYKIDS_WINDOW') + '\nreturn MYKIDS_WINDOW;')();
assert.ok(Number.isFinite(MYKIDS_WINDOW) && MYKIDS_WINDOW > 3600,
  'the shipped MYKIDS_WINDOW evaluated to ' + MYKIDS_WINDOW + ', which is not a window — re-anchor this test');

// ── THE CONSOLE'S WRITER, LIFTED OUT OF vendor/steward.js ─────────────────────────────────────────────────
function consoleWriter(actor, sessionKeys) {
  const scope = {
    sk: actor.sk, _ckSessionKeys: sessionKeys,
    encrypt3: nip44.v2.encrypt,
    getConversationKey: (a, b) => nip44.v2.utils.getConversationKey(a, b),
    checkinGuardianCopies, _unhex: unhex,
    JSON, Math, String, Array, Object, Set, RegExp, Boolean, Number,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the lifted console writer needs a stub for ' + String(k)); },
  });
  const liftVar = (sig, name) => new Function('scope', 'with (scope) { return (' +
    stmt(STEWARD, sig, name).replace(/^var\s+\w+\s*=\s*/, '').replace(/;\s*$/, '') + '); }')(proxy);
  return {
    cleartextTags: new Function(fnBody(STEWARD, 'function _encCleartextTags(kind, obj) {', '_encCleartextTags') + '\nreturn _encCleartextTags;')(),
    sealedCopies: liftVar('var _encSealedCopies = (kind, obj) =>', '_encSealedCopies'),
    guardianCopies: liftVar('var _encGuardianCopies = (kind, obj) =>', '_encGuardianCopies'),
  };
}
// One record, as encPublish assembles one. `at` is its created_at, which is what the freshness window reads
// when the record cannot be opened.
function record(id, body, { session = SESSION, at = NOW, by = church, guardians = [], expectGk = null } = {}) {
  const keys = new Map(); if (session) keys.set(session, SESSION_KEY);
  const w = consoleWriter(by, keys);
  const rec = { ...body, id, guardians, ...(session ? { session } : {}) };
  const sealed = w.sealedCopies('checkin', rec);
  const guarded = w.guardianCopies('checkin', rec);
  if (expectGk != null) assert.equal(guarded.length, expectGk,
    'fixture: the shipped _encGuardianCopies produced ' + guarded.length + ' copies, not ' + expectGk +
    ' — every refusal in this file would pass vacuously');
  return finalizeEvent({ kind: 30078, created_at: at,
    content: nip44.v2.encrypt(JSON.stringify(rec), unhex(SG_RING_KEY)),
    tags: [['d', D.CHECKIN + id], ['t', 'trinityone'], ['church', church.pub], ['enc', '2'],
      ...w.cleartextTags('checkin', rec), ...sealed, ...guarded] }, by.sk);
}
// A RELEASE, from the SHIPPED releaseCheckin out of vendor/fellowship.js — not hand-built, because the ['p']
// tag and the ['gk'] copy on a release are exactly what makes "collected" reachable by a parent at all.
function release(relId, { session = SESSION, manual = false, guardians = [], at = NOW + 1800 } = {}) {
  const captured = [];
  const scope = {
    toPub: (x) => x, sk: worker.sk, pub: worker.pub,
    _ckMemKeyGet: () => SESSION_KEY,
    encrypt: nip44.v2.encrypt,
    getConversationKey: (a, b) => nip44.v2.utils.getConversationKey(a, b),
    checkinGuardianPubs, checkinGuardianCopies, _unhex: unhex,
    finalizeEvent2: (t, s) => finalizeEvent({ ...t, created_at: at }, s),
    CHECKIN_D: D.CHECKIN, NET: 'trinityone', relaysForChurch: () => [],
    _publishAny: async (_r, e) => { captured.push(e); return true; },
    String, Date, Math, JSON, Number, Array, Object, Boolean, RegExp, console,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the shipped releaseCheckin needs a stub for ' + String(k)); },
  });
  const api = new Function('scope', 'with (scope) { return ({ ' +
    fnBody(FELLOWSHIP, 'async releaseCheckin(churchNpub, rec) {', 'releaseCheckin') + ' }); }')(proxy);
  return api.releaseCheckin(church.pub, { session, rel: relId, manual, guardians }).then(() => {
    assert.equal(captured.length, 1, 'fixture: the shipped release writer produced no document');
    return captured[0];
  });
}

// ── THE PARENT'S PHONE: THE SHIPPED READER OUT OF vendor/fellowship.js ────────────────────────────────────
function phone(who, { now = NOW } = {}) {
  const emitted = [];
  let handler = null;
  const scope = {
    toPub: (x) => x, pub: who.pub, sk: who.sk,
    // The real _coalesce defers to a macrotask; here it runs at once so a test reads the answer without a
    // tick between every event. The deferral is not what is under test.
    _coalesce: (fn) => { const f = () => fn(); f.cancel = () => {}; return f; },
    _onChurchDocs: (cp, h) => { handler = h; return () => { handler = null; }; },
    // TRUSTED AUTHORS: the church key alone here. It decides only which TOMBSTONES are honoured.
    _churchVoice: (cp, rec) => (rec && rec._by) === church.pub,
    readCheckinGuardianCopy, checkinSessionOf,
    MYKIDS_WINDOW,
    // ⚠ THE BUNDLE'S SPELLINGS.
    decrypt: nip44.v2.decrypt, getConversationKey: (a, b) => nip44.v2.utils.getConversationKey(a, b),
    _unhex: unhex,
    CHECKIN_D: D.CHECKIN,
    Date: { now: () => now * 1000 },
    Map, Math, String, Number, Array, Object, JSON, Boolean, console,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the shipped parent reader needs a stub for ' + String(k)); },
  });
  const api = new Function('scope', 'with (scope) { return ({ ' +
    fnBody(FELLOWSHIP, 'subscribeMyChildrenCheckins(churchNpub, cb) {', 'subscribeMyChildrenCheckins') + ' }); }')(proxy);
  const stop = api.subscribeMyChildrenCheckins(church.pub, (v) => emitted.push(v));
  // ⚠ A COUNTER THAT PROVES THE HARNESS ENTERED THE CODE: nest the object literal wrong and nothing runs
  // while every negative below passes vacuously.
  assert.ok(handler && typeof handler.onevent === 'function',
    'the lifted subscribeMyChildrenCheckins never registered a docs-hub handler — this harness runs nothing');
  assert.deepEqual(handler.want, [D.CHECKIN],
    're-anchor: the reader asks the hub for a different slice than this test feeds it');
  const dtag = (e) => (e.tags.find(t => t[0] === 'd') || [])[1] || '';
  return {
    feed(...events) { for (const e of events) handler.onevent(e, dtag(e)); return this; },
    settle() { handler.oneose(); return this; },
    last() { assert.ok(emitted.length, 'the shipped reader emitted nothing at all, not even an empty answer'); return emitted[emitted.length - 1]; },
    emitted, stop,
  };
}
const namesOn = (v) => v.children.map(c => c.childName).sort();
const codesOn = (v) => v.children.map(c => c.code).sort();

// ── THE BASELINE. Everything works; every refusal below is measured against it. ───────────────────────────
test('BASELINE: a mother sees her own child and the pickup code the worker will ask for', () => {
  const p = phone(mother)
    .feed(record('ci-ivy', { childName: 'Ivy Henderson', code: '4417', in: NOW - 600 },
      { guardians: [mother.pub, father.pub], expectGk: 2 }))
    .settle();
  const v = p.last();
  assert.deepEqual(namesOn(v), ['Ivy Henderson'],
    'THE PARENT\'S SCREEN IS EMPTY. The record was served, the copy was sealed to her key, and no child ' +
    'reached the screen — which looks exactly like "nobody is checked in".');
  assert.deepEqual(codesOn(v), ['4417'], 'the row arrived without the pickup code, which is the whole point of the screen');
  assert.equal(v.children[0].out, undefined, 'a child nobody has collected was reported as collected');
  assert.equal(v.askAtDesk, 0, 'a record she CAN open was counted as one she cannot');
  assert.equal(v.settled, true, 'the reader never reported the corpus as read, so a screen cannot tell "loading" from "nothing"');
  // AND THE FATHER READS THE SAME THING FROM HIS OWN COPY — the find()-takes-the-first bug, at the reader.
  const q = phone(father)
    .feed(record('ci-ivy', { childName: 'Ivy Henderson', code: '4417', in: NOW - 600 },
      { guardians: [mother.pub, father.pub], expectGk: 2 }))
    .settle();
  assert.deepEqual(codesOn(q.last()), ['4417'],
    'THE SECOND GUARDIAN READ NOTHING. A reader that takes the first [\'gk\'] tag hands the mother\'s ' +
    'ciphertext to the father and never tries his own.');
  p.stop(); q.stop();
});

// ── NEGATIVE 1. ANOTHER FAMILY'S CHILD IS ABSENT, BY NAME. ────────────────────────────────────────────────
test('a session with three children and two families shows a parent ONLY their own', () => {
  // Exactly the corpus a busy Sunday produces, and the shape that makes this a screen rather than a register:
  // if anything here could widen, this is where it would show.
  const corpus = [
    record('ci-ivy',  { childName: 'Ivy Henderson', code: '4417', in: NOW - 600 }, { guardians: [mother.pub, father.pub], expectGk: 2 }),
    record('ci-milo', { childName: 'Milo Henderson', code: '9081', in: NOW - 590 }, { guardians: [mother.pub], expectGk: 1 }),
    record('ci-zoe',  { childName: 'Zoe Adeyemi',   code: '5150', in: NOW - 580 }, { guardians: [stranger.pub], expectGk: 1 }),
  ];
  const p = phone(mother).feed(...corpus).settle();
  const v = p.last();
  assert.deepEqual(namesOn(v), ['Ivy Henderson', 'Milo Henderson'],
    'a parent was shown a child who is not theirs, or lost one who is');
  assert.ok(!namesOn(v).includes('Zoe Adeyemi'),
    'ANOTHER FAMILY\'S CHILD IS ON THIS PARENT\'S SCREEN, BY NAME. This surface is "your own children", ' +
    'never a register — the owner: "parents don\'t have any records surfaced to them".');
  assert.ok(!codesOn(v).includes('5150'), 'another family\'s PICKUP CODE reached this phone — the field that releases a child');
  assert.equal(v.askAtDesk, 0,
    'the other family\'s record was counted as one this parent is missing, which would put "ask the worker ' +
    'for the pickup code" on the screen of somebody with nothing to ask about');

  // AND THE OTHER FAMILY SEES THE MIRROR IMAGE, so this is not "the reader shows nothing to anyone".
  const q = phone(stranger).feed(...corpus).settle();
  assert.deepEqual(namesOn(q.last()), ['Zoe Adeyemi'], 'the other family\'s own child did not reach their own phone');
  p.stop(); q.stop();
});

// ── NEGATIVE 2. A RECORD I AM NOT NAMED ON IS NOT MINE, WHATEVER IT CARRIES. ──────────────────────────────
test('a record that does NOT [\'p\']-tag me is neither shown nor counted, even with a gk on it', () => {
  // BOTH conditions are required and this proves the first one carries weight on its own. A hostile
  // in-window helper (red-team F1) can seal a gk to any pubkey she likes; what she cannot do is have the
  // relay serve it to somebody it does not name — and this phone does not render it either way.
  const evt = record('ci-forged', { childName: 'A Child Who Is Not Yours', code: '0000', in: NOW - 60 },
    { guardians: [mother.pub], expectGk: 1 });
  // Strip the ['p'] tag, keeping the ['gk'] copy sealed to the mother. This is the record the relay would
  // never serve her — and the question is what her phone does if a box ever did.
  const stripped = { ...evt, tags: evt.tags.filter(t => t[0] !== 'p') };
  const p = phone(mother).feed(stripped).settle();
  const v = p.last();
  assert.deepEqual(namesOn(v), [],
    'A RECORD THAT NAMES NOBODY WAS RENDERED because its ciphertext happened to open. The cleartext [\'p\'] ' +
    'tag is the field the relay\'s own read rule keys on, and this screen must agree with the box.');
  assert.equal(v.askAtDesk, 0, 'a record that does not name me was counted as a code I am missing');
  p.stop();
});

// ── NEGATIVE 3. A RECORD THAT NAMES ME AND CARRIES NO COPY FOR ME. ────────────────────────────────────────
test('a record with NO gk yields nothing, and is reported as "ask at the desk" rather than as empty', () => {
  // The walk-up at the desk, the dead phone, the record written before this shipped, the console that could
  // not seal. All ordinary; none is a fault; and NONE of them may look like an empty screen.
  const evt = record('ci-desk', { childName: 'Ivy Henderson', code: '4417', in: NOW - 600 }, { guardians: [] });
  const named = { ...evt, tags: [...evt.tags, ['p', mother.pub]] };   // served to her, sealed to nobody
  assert.equal(named.tags.filter(t => t[0] === 'gk').length, 0, 'fixture: this record HAS a guardian copy, so it tests nothing');

  const p = phone(mother).feed(named);
  // ⚠ READ BEFORE settle(), DELIBERATELY. The line must be on the screen the moment the record lands — a
  // parent standing at a door is the person least able to wait for a spinner that may never resolve.
  const before = p.last();
  assert.equal(before.askAtDesk, 1,
    'THE SCREEN HAD NOTHING TO SAY UNTIL EOSE. "Served and unreadable" and "no children here" are different ' +
    'things and this one has words for it; making it wait turns the honest answer into a blank.');
  assert.deepEqual(namesOn(before), [], 'a record this phone cannot open produced a row anyway');
  const v = p.settle().last();
  assert.equal(v.askAtDesk, 1);
  assert.deepEqual(namesOn(v), []);
  assert.deepEqual(codesOn(v), [], 'a code appeared for a record with no copy in it');
  p.stop();
});

// ── NEGATIVE 4. `content` IS NOT A WAY IN. ───────────────────────────────────────────────────────────────
test('a record whose `content` is readable JSON still yields the parent nothing from it', () => {
  const rec = { id: 'ci-clear', childName: 'Ivy Henderson', code: 'CLEARTEXT-9999', session: SESSION, guardians: [mother.pub] };
  const w = consoleWriter(church, new Map([[SESSION, SESSION_KEY]]));
  const evt = finalizeEvent({ kind: 30078, created_at: NOW, content: JSON.stringify(rec),
    tags: [['d', D.CHECKIN + rec.id], ['t', 'trinityone'], ['church', church.pub], ['session', SESSION],
           ['p', mother.pub]] }, church.sk);
  const p = phone(mother).feed(evt).settle();
  const v = p.last();
  assert.deepEqual(codesOn(v), [],
    'THE PARENT\'S READER OPENED `content`. That half of the double lock belongs to the safeguarding ring ' +
    'and a parent holds no ring key; a reader that falls back to it reads whatever an author put there.');
  assert.equal(v.askAtDesk, 1, 'a record naming her that she cannot open was not reported as one');
  p.stop();
});

// ── COLLECTED ARRIVES AS A DOCUMENT, NOT AS AN ABSENCE. ──────────────────────────────────────────────────
test('a worker\'s checkout reaches the parent — and a release scoped to ANOTHER session never folds', async () => {
  const rec = record('ci-ivy', { childName: 'Ivy Henderson', code: '4417', in: NOW - 3600 }, { guardians: [mother.pub], expectGk: 1 });
  const rel = await release('ci-ivy', { guardians: [mother.pub] });
  assert.ok(rel.tags.some(t => t[0] === 'p' && t[1] === mother.pub),
    'fixture: the shipped release writer emitted no guardian tag, so the fold below is vacuous');
  // THE EXPECTED TIME COMES OUT OF THE RELEASE'S OWN SEALED BODY, not out of a constant here: the shipped
  // writer stamps `out` from its own clock, and a test that restated a number would be asserting about a
  // fixture rather than about the document the phone actually folds.
  const relOut = readCheckinGuardianCopy(rel.tags,
    (ct) => nip44.v2.decrypt(ct, nip44.v2.utils.getConversationKey(mother.sk, rel.pubkey))).out;
  assert.ok(Number.isFinite(relOut), 'fixture: the release carries no collection time for the parent to read');

  const p = phone(mother).feed(rec, rel).settle();
  const v = p.last();
  assert.equal(v.children.length, 1, 'the release was rendered as a child of its own — a phantom row');
  assert.equal(v.children[0].out, relOut,
    'THE PARENT\'S SCREEN STILL SAYS THE CHILD IS IN THE ROOM. A guardian is never served a tombstone, so ' +
    '"collected" can only ever arrive as a release they can read; without the fold the screen is wrong for ever.');
  assert.equal(v.children[0].manual, false, 'a code-matched checkout was reported as by-hand');
  assert.equal(v.children[0].code, '4417', 'a collected child lost the record of their own pickup code');
  assert.equal(v.askAtDesk, 0, 'the release was counted as a missing pickup code');

  // A BY-HAND RELEASE IS DISTINCT — design §7: "visible to the guardian afterwards, so a parent can see
  // their child was collected without their code."
  const byHand = await release('ci-ivy', { guardians: [mother.pub], manual: true });
  const q = phone(mother).feed(rec, byHand).settle();
  assert.equal(q.last().children[0].manual, true, 'a by-hand release reached the parent looking like an ordinary one');

  // A RELEASE SHE CANNOT OPEN IS NOT A MISSING PICKUP CODE. A release written before this shipped — or by a
  // writer that could not seal to her — names her and yields her nothing. Counting it would put "ask the
  // worker for the pickup code" on the screen of a parent whose child has already gone home with them.
  const unopenable = await release('ci-ivy', { guardians: [father.pub] });
  const served = { ...unopenable, tags: [...unopenable.tags.filter(t => t[0] !== 'p'), ['p', mother.pub]] };
  assert.equal(readCheckinGuardianCopy(served.tags,
    (c) => nip44.v2.decrypt(c, nip44.v2.utils.getConversationKey(mother.sk, served.pubkey))), null,
    'fixture: the mother CAN open this release, so the count below is not about an unopenable one');
  const s = phone(mother).feed(rec, served).settle();
  assert.equal(s.last().askAtDesk, 0,
    'A RELEASE THIS PHONE CANNOT OPEN WAS COUNTED AS A MISSING PICKUP CODE. The [\'rel\'] tag is cleartext ' +
    'and needs no key, so a reader can always tell a checkout from a child — and telling a parent to ask ' +
    'the desk for the code of a child they have already collected is the opposite of helping.');
  assert.deepEqual(namesOn(s.last()), ['Ivy Henderson'],
    're-anchor: the child row vanished too, so the count above is about an empty screen rather than a release');
  s.stop();

  // AND THE F1 SHAPE, ONE LEVEL UP: a release admitted under the EVENING session must not mark a morning
  // child collected. Both session tags are cleartext, so the guard is structural and needs no key.
  const wrongSession = await release('ci-ivy', { session: OTHER_SESSION, guardians: [mother.pub] });
  const r = phone(mother).feed(rec, wrongSession).settle();
  assert.equal(r.last().children[0].out, undefined,
    'A RELEASE FROM ANOTHER SESSION MARKED THIS CHILD COLLECTED. The two [\'session\'] tags must match, or ' +
    'a helper scoped to one Sunday can sign a child out of another.');
  p.stop(); q.stop(); r.stop();
});

// ── THE WINDOW: A CHILD IS NOT IN A ROOM THREE SUNDAYS LATER. ────────────────────────────────────────────
test('LAST Sunday\'s record is neither shown nor counted — no tombstone will ever arrive to remove it', () => {
  const old = NOW - MYKIDS_WINDOW - 600;
  const p = phone(mother)
    .feed(record('ci-old', { childName: 'Ivy Henderson', code: '1111', in: old }, { at: old, guardians: [mother.pub], expectGk: 1 }),
          record('ci-now', { childName: 'Milo Henderson', code: '2222', in: NOW - 60 }, { guardians: [mother.pub], expectGk: 1 }))
    .settle();
  const v = p.last();
  assert.deepEqual(namesOn(v), ['Milo Henderson'],
    'A RECORD FROM OUTSIDE THE WINDOW IS ON THE SCREEN. A guardian is never served a tombstone, so nothing ' +
    'will ever arrive to say that child went home: the row would say they are in a room for ever.');

  // AND AN UNREADABLE ONE FROM OUTSIDE THE WINDOW IS NOT COUNTED EITHER, or a parent would be told to ask
  // the desk about a Sunday three weeks ago, every day, for ever.
  const stale = record('ci-stale', { childName: 'X', code: '3333' }, { at: old, guardians: [] });
  const q = phone(mother).feed({ ...stale, tags: [...stale.tags, ['p', mother.pub]] }).settle();
  assert.equal(q.last().askAtDesk, 0, 'a record from outside the window was counted as a code to ask for today');
  p.stop(); q.stop();
});

// ── NOTHING AT ALL IS AN ANSWER, NOT A STATE. ────────────────────────────────────────────────────────────
test('a member with no children checked in gets an empty answer, and the screen can tell it from loading', () => {
  const p = phone(stranger).feed(
    record('ci-ivy', { childName: 'Ivy Henderson', code: '4417', in: NOW - 60 }, { guardians: [mother.pub], expectGk: 1 }));
  assert.equal(p.last().settled, false, 'the reader claimed the corpus was read before EOSE');
  const v = p.settle().last();
  assert.deepEqual(v.children, [], 'a member with no children of their own was handed a child');
  assert.equal(v.askAtDesk, 0, 'a member with nothing to do with check-in was told to ask a worker for a code');
  assert.equal(v.settled, true);
  p.stop();
});

// ── A TOMBSTONE IS HONOURED ONLY FROM THE CHURCH'S OWN VOICE. ────────────────────────────────────────────
test('a stranger cannot erase a child from their own parent\'s screen', () => {
  const rec = record('ci-ivy', { childName: 'Ivy Henderson', code: '4417', in: NOW - 60 }, { guardians: [mother.pub], expectGk: 1 });
  const forged = finalizeEvent({ kind: 30078, created_at: NOW + 10, content: '',
    tags: [['d', D.CHECKIN + 'ci-ivy'], ['t', 'trinityone'], ['deleted', '1']] }, stranger.sk);
  const p = phone(mother).feed(rec, forged).settle();
  assert.deepEqual(namesOn(p.last()), ['Ivy Henderson'],
    'A STRANGER\'S TOMBSTONE HID A CHILD FROM THEIR OWN PARENT. kind-30078 is per-author, so a forged ' +
    'deletion never replaces the original on a relay — keying purely on the d-tag is what would honour it.');
  // The church's own withdrawal IS honoured, so this is a filter and not a blanket refusal.
  const real = finalizeEvent({ kind: 30078, created_at: NOW + 20, content: '',
    tags: [['d', D.CHECKIN + 'ci-ivy'], ['t', 'trinityone'], ['deleted', '1']] }, church.sk);
  const q = phone(mother).feed(rec, real).settle();
  assert.deepEqual(namesOn(q.last()), [], 'the church could not withdraw its own record');
  p.stop(); q.stop();
});

// ── THE HOSTILE BODY. A helper may author a record (F-B), so a body is not trusted for its types. ────────
test('a hostile sealed body reaches the screen as strings, never as objects', () => {
  const evt = record('ci-hostile', { childName: { toString: 1 }, code: ['4417'], in: { x: 1 }, out: 'soon' },
    { guardians: [mother.pub], expectGk: 1 });
  const p = phone(mother).feed(evt).settle();
  const row = p.last().children[0];
  assert.ok(row, 'the hostile record vanished entirely, so this proves nothing about typing');
  assert.equal(typeof row.childName, 'string', 'an OBJECT reached a row as a name — React refuses an object child by throwing, and the only boundary above a Today card is the app root');
  assert.equal(typeof row.code, 'string', 'an ARRAY reached a row as a pickup code');
  assert.equal(row.in, undefined, 'an object reached a row as a check-in time');
  assert.equal(row.out, undefined, 'an unparseable string reached a row as a collection time');
  p.stop();
});

// ── THE WINDOW IS MEASURED ON THE EVENT, NEVER ON THE SEALED BODY ────────────────────────────────────────
// Both faults below were found by an audit on 2026-09-11, in a `fresh()` that read the body's `in` where the
// copy opened and `created_at` where it did not. Everything else in this reader routes on cleartext the
// relay enforces; the window was the exception, and it was the one thing between a stale record and "a child
// is in a room for ever".
test('a body dated in the FUTURE does not keep a child on the screen for ever', () => {
  // Measured before the fix: `in: NOW + 400 days` sat on the parent's screen at +0, +30, +200 and +399 days.
  const far = NOW + 400 * 86400;
  const rec = record('ci-future', { childName: 'Ivy Henderson', code: '4417', in: far },
    { at: NOW, guardians: [mother.pub], expectGk: 1 });
  assert.deepEqual(namesOn(phone(mother).feed(rec).settle().last()), ['Ivy Henderson'],
    're-anchor: the record is not shown even on the day it was published, so the ageing below proves nothing');
  for (const days of [2, 30, 399]) {
    const later = phone(mother, { now: NOW + days * 86400 }).feed(rec).settle().last();
    assert.deepEqual(namesOn(later), [],
      'A RECORD DATED IN THE FUTURE WAS STILL ON THE PARENT\'S SCREEN ' + days + ' DAYS LATER. No tombstone ' +
      'will ever arrive to remove it, so the only thing that can is the window — and a window a writer can ' +
      'push past is not one.');
  }

  // AND THE SAME FOR THE EVENT ITSELF. `created_at` is the writer's to choose too, so the window is
  // SYMMETRIC: a record dated a year ahead is shown for one window from now and then ages out, rather than
  // sitting on a parent's screen until the clock catches up with it.
  const ahead = record('ci-ahead', { childName: 'Milo Henderson', code: '9081' },
    { at: NOW + 365 * 86400, guardians: [mother.pub], expectGk: 1 });
  assert.deepEqual(namesOn(phone(mother).feed(ahead).settle().last()), [],
    'AN EVENT DATED A YEAR AHEAD IS ON THE PARENT\'S SCREEN TODAY, and will be every day until then. A ' +
    'one-sided window (`at - ts <= W`) never ages a future record out at all.');
});

test('the window is BOUND to the longest session a church may run, not to a figure of its own', () => {
  assert.match(stmt(FELLOWSHIP, 'var MYKIDS_WINDOW =', 'MYKIDS_WINDOW'), /=\s*MAX_SESSION_SECONDS\s*;/,
    'THE SHIPPED WINDOW IS NO LONGER BOUND TO MAX_SESSION_SECONDS. A figure of its own drifts apart from the ' +
    'longest session a church may run, and the parent\'s row then expires before the session that produced ' +
    'it — which is what 16 hours cost, measured on an all-day event.');
  assert.equal(MAX_SESSION_SECONDS, 26 * 3600,
    're-anchor: MAX_SESSION_SECONDS moved, so every window assertion in this file is about a different length');
});

test('a console clock a day behind does not silently EMPTY a parent\'s screen', () => {
  // Measured before the fix: a record published NOW whose body said `in` was 17 hours ago vanished, with
  // askAtDesk at 0 — indistinguishable from "no children here", which is the exact conflation the three
  // states exist to prevent. Ordinary clock drift, and this product's own positioning is thin pipes and
  // devices whose clocks are not NTP-perfect.
  // ⚠ THE SKEW IS BEYOND THE WINDOW, deliberately. At 17 hours against a 26-hour window the old rule hid
  // nothing and the sabotage row measuring this bit nothing — the figure has to be one the body-reading rule
  // would actually have thrown away.
  const skewed = record('ci-skew', { childName: 'Ivy Henderson', code: '4417', in: NOW - MYKIDS_WINDOW - 3600 },
    { at: NOW, guardians: [mother.pub], expectGk: 1 });
  const v = phone(mother).feed(skewed).settle().last();
  assert.deepEqual(codesOn(v), ['4417'],
    'A RECORD PUBLISHED THIS MINUTE WAS HIDDEN because the body it carried disagreed with the clock. The ' +
    'parent is told nothing and shown nothing, at the door, with the code in their pocket all along.');
  assert.equal(v.askAtDesk, 0, 're-anchor: it was counted rather than shown, so the line above is about the wrong branch');
});

test('AN ALL-DAY SESSION KEEPS ITS ROW — the window is the longest session a church may run', () => {
  // HELPER_LIFETIMES.day.max, PERMISSION_LIFETIMES.day.max and MAX_SESSION_SECONDS are all 26 hours, exactly
  // so a church can run "a morning and an afternoon, or an all-day event" off one session. At 16 hours the
  // parent's row vanished WHILE THE CHILD WAS STILL IN THE ROOM and the worker's key was still live — and
  // the release, when it came, then had no row to fold onto.
  const at = NOW - 20 * 3600;
  const rec = record('ci-lockin', { childName: 'Ivy Henderson', code: '4417', in: at },
    { at, guardians: [mother.pub], expectGk: 1 });
  assert.deepEqual(codesOn(phone(mother).feed(rec).settle().last()), ['4417'],
    'A 20-HOUR-OLD SESSION LOST THE PARENT\'S ROW while a 26-hour session key is still live. A lock-in or a ' +
    'residential is the sharp case, and the child is still in the room.');
  // …and it does age out, so this is a window and not its absence.
  const stale = record('ci-stale', { childName: 'Ivy Henderson', code: '4417' },
    { at: NOW - MYKIDS_WINDOW - 600, guardians: [mother.pub], expectGk: 1 });
  assert.deepEqual(namesOn(phone(mother).feed(stale).settle().last()), [],
    're-anchor: nothing ages out at all, so the window is gone rather than lengthened');
});

// ── THE ORDINARY DESK CHECKOUT: THE CONSOLE REWRITES THE RECORD AT THE SAME ADDRESS ──────────────────────
test('a CONSOLE checkout reaches the parent — the row is re-opened, never inherited', () => {
  // app/stew-dashboard.jsx CheckoutModal → writeCheckin({...r, out}) → publishCheckin → encPublish. It does
  // not write a release document at all; it republishes the record with `out` set, so the parent learns of it
  // from their own gk copy of the REWRITE. That only works because the reader drops its memo for an address
  // whose newer version arrives — an audit's sabotage of that one line reddened nothing, and the line is
  // what the whole ordinary desk path rests on.
  const before = record('ci-ivy', { childName: 'Ivy Henderson', code: '4417', in: NOW - 3600 },
    { guardians: [mother.pub], expectGk: 1 });
  const after  = record('ci-ivy', { childName: 'Ivy Henderson', code: '4417', in: NOW - 3600, out: NOW + 900 },
    { at: NOW + 900, guardians: [mother.pub], expectGk: 1 });
  const p = phone(mother).feed(before);
  assert.equal(p.last().children[0].out, undefined, 're-anchor: the child reads as collected before the checkout');
  const v = p.feed(after).settle().last();
  assert.equal(v.children.length, 1, 'the rewrite produced a SECOND row for one child — the record forked');
  assert.equal(v.children[0].out, NOW + 900,
    'THE ORDINARY DESK CHECKOUT NEVER REACHES THE PARENT. The console rewrites the record rather than ' +
    'writing a release, so a reader that kept its first opening of that address shows the child as present ' +
    'for the rest of the day — and no tombstone will ever say otherwise.');
  p.stop();
});

// ── WHAT THIS READER IS NOT, SAID IN A TEST SO NOBODY HAS TO TAKE THE COMMENT ON FAITH ───────────────────
test('the reader does NOT filter by author — the known relay gap, carried honestly with `_by`', () => {
  // AN AUDIT REFUTED THE CLAIM THAT USED TO STAND HERE. It said requiring the cleartext ['p'] tag defeated a
  // hostile in-window helper (red-team F1) because "she has to name me there too". SHE CAN: she writes both
  // the tag and the copy. So this is written down as what it is — the SAME unfixed relay defect
  // subscribeCheckinRegister records, inherited, not new, and not fixable on a phone that holds no envelope
  // and no roster and therefore cannot tell a cleared helper from any other member. Filtering to the church's
  // voice would hide every WORKER-WRITTEN record, which is the ordinary path.
  //
  // WHAT IT IS WORTH: a spurious line on a parent's screen — a child who does not exist, with a code that
  // releases nobody, because the code is compared at the door against the WORKER's register.
  const forged = record('ci-forged', { childName: 'A Child Who Is Not Hers', code: '0000', in: NOW - 60 },
    { by: stranger, guardians: [mother.pub], expectGk: 1 });
  const v = phone(mother).feed(forged).settle().last();
  assert.deepEqual(namesOn(v), ['A Child Who Is Not Hers'],
    'THIS TEST HAS GONE GREEN THE OTHER WAY, which is good news that must not pass silently: an author ' +
    'filter has appeared. Check it does not hide WORKER-WRITTEN records — a worker is an ordinary member and ' +
    'her records are the ordinary path — then rewrite this test to assert the refusal.');
  assert.equal(v.children[0]._by, stranger.pub,
    '`_by` IS NOT ON THE ROW. It is carried precisely because this reader cannot filter by author today; ' +
    'drop it and the fix, when the relay gets one, has nowhere to land.');
});
