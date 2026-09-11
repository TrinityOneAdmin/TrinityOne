// A CLEARED WORKER'S PHONE READS ONE SESSION'S REGISTER — AND PROVABLY NOTHING ELSE.
// Run: node --test scripts/a-cleared-worker-reads-one-sessions-register.test.mjs
//
// Slice 3 of reference/SCOPE-CHECKIN-SURFACES-2026-09-09.md, read half. This is the first test in the repo of
// a MEMBER-APP reader for a check-in record: before it, `helperKeyFor` and `readCheckinHelperCopy` had no
// product caller anywhere in src/ or app/ — their only in-repo caller was a test, which CLAUDE.md rule 1 says
// is not a feature.
//
// ── WHAT IS SHIPPED CODE HERE AND WHAT IS FIXTURE ─────────────────────────────────────────────────────────
// Everything between a church sealing a record and a worker reading a name off it is lifted out of the built
// bundles and executed. Nothing in the chain is a stand-in:
//
//   • the ENVELOPE is minted by the shipped `buildHelperGrant` (scripts/checkin-role-source.mjs, which esbuild
//     inlines into both bundles) with real nip44 wrapping, per recipient;
//   • the RECORD's cleartext tags and its helper copy come from `_encCleartextTags` and `_encSealedCopies`
//     lifted out of vendor/steward.js — the console's real sealer, so the ['session'] tag the reader routes on
//     and the ['ck'] tag it opens are the ones a console really writes;
//   • the READER is `subscribeCheckinRegister` lifted out of vendor/fellowship.js, with the shipped
//     `readHelperGrant` / `helperKeyFor` / `readCheckinHelperCopy` / `checkinSessionOf` / `permissionAdmits`
//     underneath it and real nip44 for the crypto.
//
// ⚠ THE BUNDLE, NOT THE SOURCE. vendor/fellowship.js is rebuilt by `npm run build:fellowship`; editing
// src/fellowship.src.js and running this without that tests the OLD bundle and goes green. The freshness net
// is scripts/vendor-freshness.test.mjs, and only if the whole suite runs.
//
// ⚠ ESBUILD RENAMES ON COLLISION. In vendor/fellowship.js the nip44 pair are plain `decrypt` (:5296) and
// `getConversationKey` (:5194) — nip04's decrypt became `decrypt3` — so the stub names below are the BUNDLE's
// spellings, not the source's. Stub only the src/ spellings (`nip44d`, `nip44ck`) and the scope Proxy throws,
// which is the loud failure this harness wants rather than a silent no-op.
//
// NO RELAY AND NO PORT. Every assertion here is over a subscription's own handlers, so nothing binds a socket
// and this file cannot collide with the fixed-port relay tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import * as nip44 from 'nostr-tools/nip44';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { fnBody, stmt } from './test-slice.mjs';
import { buildHelperGrant, buildCheckinPermission, GRANT_SOURCE,
         readHelperGrant, helperKeyFor, readCheckinHelperCopy, checkinSessionOf,
         readCheckinPermission, permissionAdmits } from './checkin-role-source.mjs';

const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const STEWARD    = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

const hex = (u8) => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
const _unhex = (h) => new Uint8Array((String(h).match(/.{1,2}/g) || []).map(x => parseInt(x, 16)));
// REAL secp256k1 PAIRS, not random bytes. nip44's conversation key is an ECDH over the peer's pubkey, so a
// pubkey that is not a point on the curve makes every wrap throw — and buildHelperGrant CATCHES per recipient,
// which produces an envelope with an EMPTY `keys` object and makes "X holds no key" pass vacuously. That trap
// is written up in checkin-helper-mint-is-the-shipped-one.test.mjs:120-128; the `failed` assertion in
// envelope() below is the guard against walking into it again.
const keypair = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

// Four people, named once so a failure message names the same person twice.
const church  = keypair();
const morning = keypair();   // cleared, and holds the MORNING session's key
const evening = keypair();   // cleared, and holds the EVENING session's key — never the morning's
const nobody  = keypair();   // in this church and cleared for nothing

const AM = 'svc-sunday-am', PM = 'svc-sunday-pm';
const NOW = 1788600000;                    // a fixed clock: 2026-09-06T12:00:00Z, inside both windows below
const WIN = { from: NOW - 3600, until: NOW + 3600 };

const CHECKINPERM_D = 'trinityone/checkinperm:';
const CHECKINHELPER_D = 'trinityone/checkinhelper:';
const CHECKIN_D = 'trinityone/checkin:';

// ── THE CHURCH'S SIDE, ALL SHIPPED ────────────────────────────────────────────────────────────────────────
// An envelope: one session's key, wrapped per recipient by the shipped minter with real nip44.
function envelope(session, sessionKeyHex, helpers) {
  const g = buildHelperGrant({
    session, source: GRANT_SOURCE, lifetime: 'session', from: WIN.from, until: WIN.until,
    helpers: helpers.map(h => h.pub), keepers: [church.pub], sessionKeyHex,
    // ⚠ THE RECIPIENT COMES FIRST. buildHelperGrant calls `wrap(p, sessionKeyHex)` — pubkey, then plaintext —
    // which is the opposite order to nip44's own `encrypt(plain, key)`, and getting it round the wrong way
    // wraps the PUBKEY under a conversation key derived from the session key. It throws nothing: it produces a
    // perfectly valid ciphertext that unwraps to something that is not 32 bytes of hex, so helperKeyFor answers
    // '' and every register in this file is empty for the wrong reason.
    wrap: (toPub, plain) => nip44.encrypt(plain, nip44.getConversationKey(church.sk, toPub)),
  });
  assert.deepEqual(g.failed, [], 'fixture: buildHelperGrant could not wrap a slot, so any "no key" below is vacuous');
  return { pubkey: church.pub, created_at: NOW - 600, content: JSON.stringify(g.doc),
           tags: [['d', CHECKINHELPER_D + session], ['t', 'trinityone'], ['church', church.pub], ['session', session]] };
}
// A clearance for one person, from the shipped builder.
function clearance(who, over = {}) {
  const doc = buildCheckinPermission({ person: who.pub, source: 'steward', lifetime: 'dated',
    from: over.from != null ? over.from : WIN.from, until: over.until != null ? over.until : WIN.until });
  return { pubkey: (over.by || church).pub, created_at: NOW - 900, content: JSON.stringify(doc),
           tags: [['d', CHECKINPERM_D + who.pub], ['t', 'trinityone'], ['church', church.pub]] };
}
// THE CONSOLE'S REAL SEALER, lifted out of vendor/steward.js. `_encSealedCopies` decides whether a record
// carries the helper's copy and what it is sealed under; `_encCleartextTags` decides the ['session'] tag the
// reader routes on. Both stubbed would be the test answering its own question.
const consoleSealer = (sessionKeys) => {
  // ⚠ `encrypt3`, NOT `nip44e`. In vendor/steward.js esbuild renamed nip44's encrypt on collision, and
  // _encSealedCopies CATCHES its own failure and returns [] — so stubbing the src/ spelling produces a record
  // with NO ['ck'] tag and every "the worker read her register" assertion in this file fails while every
  // "she opened nothing" assertion passes VACUOUSLY. It cost this file one debugging round; the `ck` assertion
  // in record() below is the guard that makes it impossible to ship green.
  const scope = { _ckSessionKeys: sessionKeys, encrypt3: nip44.encrypt, _unhex, JSON, Math, String, Array, Object, Set, RegExp };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the console sealer needs a stub for ' + String(k)); },
  });
  const cleartextTags = new Function(fnBody(STEWARD, 'function _encCleartextTags(kind, obj) {', '_encCleartextTags') + '\nreturn _encCleartextTags;')();
  const sealedCopies = new Function('scope', 'with (scope) { return (' +
    stmt(STEWARD, 'var _encSealedCopies = (kind, obj) =>', '_encSealedCopies').replace(/^var\s+\w+\s*=\s*/, '').replace(/;\s*$/, '') + '); }')(proxy);
  return { cleartextTags, sealedCopies };
};
// One check-in record, written the way publishCheckin writes one: `content` is the ring's ciphertext (opaque
// to a worker and DELIBERATELY not openable here — a worker holds no ring key and must not try), plus the
// cleartext tags and the ['ck'] copy from the shipped sealer.
function record(id, obj, session, sessionKeyHex, over = {}) {
  const keys = new Map();
  if (sessionKeyHex) keys.set(session, sessionKeyHex);
  const { cleartextTags, sealedCopies } = consoleSealer(keys);
  const body = { ...obj, id, session };
  const tags = [['d', CHECKIN_D + id], ['t', 'trinityone'], ['church', church.pub], ['enc', sessionKeyHex ? '2' : '1'],
    ...cleartextTags('checkin', body), ...sealedCopies('checkin', body)];
  // A COUNTER THAT PROVES THE SHIPPED SEALER RAN. `_encSealedCopies` swallows every failure and answers [],
  // so without this a mis-stubbed harness silently produces records with no helper copy at all — and the whole
  // file then reports a clean sheet of refusals it never tested.
  if (sessionKeyHex) assert.ok(tags.find(t => t[0] === 'ck'),
    'fixture: the shipped _encSealedCopies produced no ["ck"] copy for a session whose key it was given — the ' +
    'harness is stubbing a name the bundle does not use, and every refusal in this file would pass vacuously');
  if (over.session) {   // a record whose SESSION TAG says something other than the key it was sealed under
    for (const t of tags) if (t[0] === 'session') t[1] = over.session;
  }
  return { pubkey: over.by || church.pub, created_at: over.at || NOW, tags,
           content: 'RING-CIPHERTEXT-A-WORKER-CANNOT-OPEN-' + id };
}

// ── THE WORKER'S PHONE: THE SHIPPED READER OUT OF vendor/fellowship.js ────────────────────────────────────
function phone(who) {
  const emitted = [];
  let handler = null;
  const scope = {
    toPub: (x) => x,
    pub: who.pub, sk: who.sk,
    // The real _coalesce defers to a macrotask; here it runs at once so a test reads the answer without a
    // tick between every event. The DEFERRAL is not what is under test and a queue would only hide which
    // event produced which answer.
    _coalesce: (fn) => { const f = () => fn(); f.cancel = () => {}; return f; },
    _onChurchDocs: (cp, h) => { handler = h; return () => { handler = null; }; },
    // TRUSTED AUTHORS: the church key alone in this harness. It decides only which TOMBSTONES are honoured
    // (see the reader's own note on red-team F1 — it does not filter records by author, on purpose).
    _churchVoice: (cp, rec) => (rec && rec._by) === church.pub,
    readHelperGrant, helperKeyFor, readCheckinHelperCopy, checkinSessionOf, readCheckinPermission, permissionAdmits,
    _unhex,
    // ⚠ THE BUNDLE'S SPELLINGS. See the header note on esbuild renaming.
    decrypt: nip44.decrypt, getConversationKey: nip44.getConversationKey,
    CHECKINPERM_D, CHECKINHELPER_D, CHECKIN_D,
    Date: { now: () => NOW * 1000 },
    Map, Math, String, Number, Array, Object, JSON, Boolean, console,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the shipped reader needs a stub for ' + String(k)); },
  });
  const api = new Function('scope', 'with (scope) { return ({ ' +
    fnBody(FELLOWSHIP, 'subscribeCheckinRegister(churchNpub, cb) {', 'subscribeCheckinRegister') + ' }); }')(proxy);
  const stop = api.subscribeCheckinRegister(church.pub, (v) => emitted.push(v));
  // ⚠ A COUNTER THAT PROVES THE HARNESS ENTERED THE CODE. fnBody returns the whole function INCLUDING its
  // signature and the house scaffold wraps it in an object literal; nest that wrong and nothing runs while
  // every negative below passes vacuously. If no subscription was opened there is no `handler` and this fails
  // here rather than reporting a clean sheet.
  assert.ok(handler && typeof handler.onevent === 'function',
    'the lifted subscribeCheckinRegister never registered a docs-hub handler — this harness is running nothing');
  assert.deepEqual(handler.want, [CHECKINPERM_D, CHECKINHELPER_D, CHECKIN_D],
    're-anchor: the reader no longer asks the hub for these three document types, so it is replaying a ' +
    'different slice of the corpus than this test feeds it');
  const dtag = (e) => (e.tags.find(t => t[0] === 'd') || [])[1] || '';
  return {
    feed(...events) { for (const e of events) handler.onevent(e, dtag(e)); return this; },
    settle() { handler.oneose(); return this; },
    last() { assert.ok(emitted.length, 'the shipped reader emitted nothing at all, not even an empty answer'); return emitted[emitted.length - 1]; },
    emitted, stop,
  };
}
// Every child's name the register would put on a screen, across every session.
const namesOn = (v) => v.sessions.flatMap(s => s.rows.map(r => r.childName)).sort();
const codesOn = (v) => v.sessions.flatMap(s => s.rows.map(r => String(r.code)));

const AM_KEY = hex(webcrypto.getRandomValues(new Uint8Array(32)));
const PM_KEY = hex(webcrypto.getRandomValues(new Uint8Array(32)));

// ── THE BASELINE. Everything works; every refusal below is measured against this. ─────────────────────────
test('BASELINE: a cleared worker reads her own session — the names and the pickup codes', () => {
  const p = phone(morning)
    .feed(clearance(morning),
          envelope(AM, AM_KEY, [morning]),
          record('ci-1', { childName: 'Esther Ncube', code: '4417' }, AM, AM_KEY),
          record('ci-2', { childName: 'Amos Bello', code: '9081' }, AM, AM_KEY))
    .settle();
  const v = p.last();
  assert.equal(v.cleared, true, 'the shipped reader did not recognise this worker\'s own clearance document');
  assert.equal(v.keysHeld, 1, 'the shipped helperKeyFor gave this cleared helper no session key at all');
  assert.equal(v.sessions.length, 1);
  assert.equal(v.sessions[0].session, AM);
  assert.deepEqual(namesOn(v), ['Amos Bello', 'Esther Ncube'],
    'THE REGISTER IS EMPTY FOR A WORKER WHO HOLDS THE KEY. The records were served, the key was held, and no ' +
    'row reached the screen — which looks exactly like "no children are checked in".');
  assert.deepEqual(codesOn(v).sort(), ['4417', '9081'],
    'the rows arrived without pickup codes, which is the field the door needs');
  assert.equal(v.unreadable, 0, 'a record was reported unreadable in the baseline, so nothing below is about a key');
  assert.equal(v.foreign, 0, 'a record was reported as another session\'s in the baseline');
  assert.equal(v.lapsed, false);
  assert.equal(v.notYet, false);
  assert.equal(v.settled, true, 'the reader never reported the corpus as read, so a screen cannot tell "loading" from "nothing"');
  p.stop();
});

// ── NEGATIVE 1. NO CLEARANCE — with everything else succeeding. ───────────────────────────────────────────
test('a worker the church has NOT cleared sees nothing, and the machinery around her works', () => {
  // The envelope names HER (so a reader keying only off the envelope would hand her the key), the records are
  // sealed under a key she could unwrap, and the ONLY thing missing is the clearance. Both halves are what
  // the relay requires; a screen that leant on one of them would pass a test that fed both.
  const p = phone(nobody)
    .feed(envelope(AM, AM_KEY, [nobody]),
          record('ci-1', { childName: 'Esther Ncube', code: '4417' }, AM, AM_KEY))
    .settle();
  const v = p.last();
  assert.equal(v.cleared, false,
    'the shipped reader reported an UNCLEARED person as cleared — the Kids tab is shown from this field');
  assert.equal(v.lapsed, false, 'a person the church never cleared was told her clearance had ended');
  assert.equal(v.notYet, false, 'a person the church never cleared was told her clearance had not started');
  assert.equal(v.from, null);
  assert.equal(v.until, null);
  // AND THE HONEST LIMIT, STATED RATHER THAN OVERCLAIMED: the relay would never serve her either document.
  // This reader is not the gate and must not be sold as one — what it owes is that the CLEARANCE field, which
  // is what makes the tab exist, is false when no clearance document arrived.
  p.stop();
});

// ── NEGATIVE 2. ONE SESSION'S KEY OPENS NOTHING OF ANOTHER'S. ─────────────────────────────────────────────
test('a worker holding the EVENING key opens nothing of the MORNING register', () => {
  // She is cleared, she holds a real session key, and she is served the morning's records — which is exactly
  // what the relay does to a person cleared for the year while a console has run ahead and minted. Every
  // piece works; the only thing that must not happen is a row.
  const p = phone(evening)
    .feed(clearance(evening),
          envelope(PM, PM_KEY, [evening]),
          record('ci-1', { childName: 'Esther Ncube', code: '4417' }, AM, AM_KEY),
          record('ci-2', { childName: 'Amos Bello', code: '9081' }, AM, AM_KEY))
    .settle();
  const v = p.last();
  assert.equal(v.cleared, true, 're-anchor: this worker is not cleared, so the refusal below is not about the key');
  assert.equal(v.keysHeld, 1, 're-anchor: this worker holds no key at all, so nothing here is about which key');
  assert.deepEqual(namesOn(v), [],
    'A MORNING REGISTER WAS HANDED TO AN EVENING HELPER. The reader tried a key the record\'s own session tag ' +
    'did not name — the exact fallback the red-team pass of 2026-09-10 found.');
  assert.deepEqual(codesOn(v), [], 'a child\'s PICKUP CODE from another session reached this phone');
  assert.equal(v.foreign, 2,
    'the two records from a session this phone holds no key for were not reported as such — so the screen ' +
    'cannot tell "another session" from "nobody is here", and one of those is a worker staring at an empty room');
  assert.equal(v.unreadable, 0,
    'another session\'s records were filed as "cannot open", which would tell this worker to go and ask at a ' +
    'desk about a register that is not hers');
  assert.equal(v.sessions.length, 1, 'a session this phone holds no key for was given a card on the screen');
  assert.equal(v.sessions[0].session, PM);
  assert.deepEqual(v.sessions[0].rows, [], 'her own session shows rows it was never fed');
  p.stop();
});

// ── NEGATIVE 3. THE SESSION TAG DECIDES, NOT THE KEY THAT HAPPENS TO FIT. ─────────────────────────────────
test('a record whose SESSION TAG names a session she does not hold opens nothing, even sealed under her key', () => {
  // THE ONE THE PIECE-1 AUDIT SAID ITS OWN TESTS WERE BLIND TO. Every fixture filed its key under the
  // record's own session, so a reader that ignored the tag and tried every held key would have passed the lot.
  // Here the ['ck'] copy really is sealed under the MORNING key — the key this phone holds — and the record's
  // cleartext session tag says EVENING. `checkinSessionOf` must decide, so nothing opens.
  const rec = record('ci-1', { childName: 'Esther Ncube', code: '4417' }, AM, AM_KEY, { session: PM });
  // RE-ANCHORED FOUR WAYS, so an empty register cannot pass here for the wrong reason.
  assert.equal(checkinSessionOf(rec.tags), PM, 'fixture: the session tag was not overridden, so this proves nothing');
  assert.ok(rec.tags.find(t => t[0] === 'ck'), 'fixture: the record carries no helper copy at all');
  assert.equal(readCheckinHelperCopy(rec.tags, AM_KEY, (ct, k) => nip44.decrypt(ct, _unhex(k))).code, '4417',
    'fixture: the copy does not open with the morning key either, so the refusal below is not about the tag');
  const p = phone(morning)
    .feed(clearance(morning), envelope(AM, AM_KEY, [morning]), rec)
    .settle();
  const v = p.last();
  assert.equal(v.keysHeld, 1, 're-anchor: this phone holds no key, so nothing here is about the session tag');
  assert.deepEqual(namesOn(v), [],
    'THE READER OPENED A RECORD BY "ANY KEY I HOLD" RATHER THAN BY THE RECORD\'S OWN SESSION. That is how a ' +
    'morning register reaches an evening helper, and the record need not even be honestly tagged for it.');
  assert.equal(v.foreign, 1, 'the record was not reported as belonging to a session this phone holds no key for');
  // …AND THE CONTROL: the same record, honestly tagged, does open. Without this the assertion above passes
  // over a reader that opens nothing at all.
  const ok = phone(morning)
    .feed(clearance(morning), envelope(AM, AM_KEY, [morning]),
          record('ci-1', { childName: 'Esther Ncube', code: '4417' }, AM, AM_KEY))
    .settle().last();
  assert.deepEqual(namesOn(ok), ['Esther Ncube'], 'CONTROL: the reader opens nothing whatever the tag says');
  p.stop();
});

// ── NEGATIVE 4. SERVED, AND THIS PHONE CANNOT OPEN IT — TOLD APART FROM AN EMPTY ROOM. ────────────────────
test('a record written with no helper copy is "cannot open", never "nobody is here"', () => {
  // The ordinary case, and not a fault: publishCheckin OMITS the ['ck'] copy when the console holds no session
  // key, rather than refusing to write, because nothing may block a check-in. Every record written before the
  // double lock landed is in this state too.
  const bare = record('ci-1', { childName: 'Esther Ncube', code: '4417' }, AM, '');
  assert.equal(bare.tags.find(t => t[0] === 'ck'), undefined, 'fixture: the record HAS a helper copy, so this proves nothing');
  assert.equal(checkinSessionOf(bare.tags), AM, 'fixture: the record lost its session tag, so it would be unroutable for a different reason');
  const v = phone(morning).feed(clearance(morning), envelope(AM, AM_KEY, [morning]), bare).settle().last();
  assert.equal(v.unreadable, 1,
    '"REFUSED" AND "SERVED BUT UNREADABLE" ARE DIFFERENT FAILURES and this one vanished. A worker would be ' +
    'shown an empty register for a room with a child in it.');
  assert.equal(v.foreign, 0, 'a record in her OWN session was filed as another session\'s');
  assert.deepEqual(namesOn(v), [], 'a row was rendered from a record that carries no copy this phone can read');
  assert.equal(v.keysHeld, 1, 're-anchor: she holds no key, so "cannot open" would be true for a different reason');

  // AND A COPY SEALED UNDER A KEY THAT IS NOT THE SESSION'S is the same honest state — not a row, not silence.
  const wrong = record('ci-2', { childName: 'Amos Bello', code: '9081' }, AM, PM_KEY);
  assert.ok(wrong.tags.find(t => t[0] === 'ck'), 'fixture: no copy was sealed at all');
  const v2 = phone(morning).feed(clearance(morning), envelope(AM, AM_KEY, [morning]), wrong).settle().last();
  assert.equal(v2.unreadable, 1, 'a copy sealed under the wrong key produced neither a row nor an honest count');
  assert.deepEqual(namesOn(v2), [], 'a row came out of ciphertext this phone cannot open');
});

// ── CLEARED, AND NO KEY. The commonest state there is, and the one nothing could say before. ──────────────
test('cleared with NO envelope is "no keys have reached this phone", not an empty register', () => {
  // Nothing mints session keys unless an OWNER console is open, so a church whose console stays shut has
  // cleared helpers holding no keys, for any Sunday, ever. Before this screen there was no surface on which
  // that was visible, and the console's own panel was measured claiming the opposite.
  const v = phone(morning).feed(clearance(morning)).settle().last();
  assert.equal(v.cleared, true, 'the clearance document did not reach the shipped reader');
  assert.equal(v.keysHeld, 0, 'a key appeared from nowhere');
  assert.deepEqual(v.sessions, [], 'a session card was invented for a session this phone holds no key for');
  assert.equal(v.settled, true,
    'the reader swallowed its EOSE because it had nothing to show — so the one screen that could tell a ' +
    'worker "nothing is wrong, no key has been issued" would sit on a loading state that never resolves');
});

// ── A FUTURE CLEARANCE HAS NOT ENDED. The console shipped this wrong and a sim caught it four times. ──────
test('a clearance that has not started yet says so — it has NOT "ended"', () => {
  const v = phone(morning).feed(clearance(morning, { from: NOW + 86400, until: NOW + 172800 })).settle().last();
  assert.equal(v.cleared, false, 'a clearance whose window has not opened admitted somebody');
  assert.equal(v.notYet, true,
    'A CLEARANCE FOR NEXT SUNDAY IS NOT REPORTED AS PENDING. The console shipped exactly this as a binary on ' +
    '2026-09-10 and told a churchwarden four times over that a clearance she had just granted had ENDED.');
  assert.equal(v.lapsed, false, 'a clearance that has not started was reported as ended');
  assert.equal(v.from, NOW + 86400, 'the screen has no date to name, so it cannot say WHEN it starts');
});

test('a clearance whose window has passed is "ended", and the register it already holds stays readable', () => {
  // reference/DOMAIN.md: "say a key has expired, do not lock someone out of a room mid-session." So the state
  // is reported AND the rows stay. A reader that dropped them would be the block the whole feature forbids.
  const v = phone(morning)
    .feed(clearance(morning, { from: NOW - 172800, until: NOW - 86400 }),
          envelope(AM, AM_KEY, [morning]),
          record('ci-1', { childName: 'Esther Ncube', code: '4417' }, AM, AM_KEY))
    .settle().last();
  assert.equal(v.cleared, false, 'an expired clearance still admits');
  assert.equal(v.lapsed, true, 'an expired clearance is silent, so a worker cannot tell why records stopped arriving');
  assert.equal(v.notYet, false, 'an expired clearance was reported as not yet started');
  assert.deepEqual(namesOn(v), ['Esther Ncube'],
    'THE REGISTER WAS TAKEN OFF THE SCREEN BECAUSE A CLEARANCE LAPSED. DOMAIN.md forbids exactly that: the ' +
    'app says a key has expired, it does not lock somebody out of a room mid-session.');
});

test('a clearance the SAFEGUARDING STEWARD wrote counts — the relay admits it, and the phone must not second-guess', () => {
  // Red team 2026-09-11, F-A. The relay has accepted a safeguarding steward's clearance since 2026-09-10
  // (checkinPermGrantor) and serves the person everything that follows; the reader dropped it as
  // "church-key-only", so a steward-cleared helper read `cleared:false` — and with no key minted yet, no
  // Kids tab at all. Same fixture as the baseline, one field different: who signed the clearance.
  const sgLead = keypair();
  const v = phone(morning)
    .feed(clearance(morning, { by: sgLead }), envelope(AM, AM_KEY, [morning]),
          record('ci-1', { childName: 'Esther Ncube', code: '4417' }, AM, AM_KEY))
    .settle().last();
  assert.equal(v.cleared, true,
    'A STEWARD\'S CLEARANCE IS INVISIBLE TO THE PERSON IT CLEARS. The relay served it (only the church or a ' +
    'safeguarding steward can write one; only the person can read it) and the phone threw it away — before a ' +
    'key arrives that is no Kids tab for the commonest way a church clears somebody.');
  // and before any key has been minted, the tab must exist for her: the rule ServingScreen applies
  const noKey = phone(morning).feed(clearance(morning, { by: sgLead })).settle().last();
  assert.equal(!noKey.cleared && !noKey.notYet && !(noKey.keysHeld > 0), false,
    'with a steward-written clearance and no key yet, the screen\'s nothingKnown rule hides the tab');
});

test('a helper copy with the WRONG TYPES in it reaches the screen as strings and numbers, never as objects', () => {
  // Red team 2026-09-11, F-C. The reader vouched for "a JSON object" and nothing inside it; `childName: {…}`
  // and `out: {…}` reached KidsRow as JSX children, which React refuses by throwing, and the only error
  // boundary above the row is the app root. A helper in her window can write such a record.
  const v = phone(morning)
    .feed(clearance(morning), envelope(AM, AM_KEY, [morning]),
          record('good', { childName: 'Real Child', code: '4417', in: 1789080000 }, AM, AM_KEY),
          record('evil', { childName: { nope: true }, code: { a: 1 }, in: 'soon', out: { when: 2 } }, AM, AM_KEY),
          record('numeric', { childName: 7, code: 1234, out: '1789084514' }, AM, AM_KEY))
    .settle().last();
  const rows = Object.fromEntries(v.sessions.flatMap(s => s.rows).map(r => [r.id, r]));
  assert.equal(typeof rows.good.childName, 'string'); assert.equal(rows.good.in, 1789080000);
  assert.equal(typeof rows.evil.childName, 'string',
    'AN OBJECT REACHED THE SCREEN AS A CHILD\'S NAME. React throws on it and the whole app blanks: ' + JSON.stringify(rows.evil.childName));
  assert.equal(rows.evil.childName, '', 'a name that is not a string must read as absent, not as "[object Object]"');
  assert.equal(typeof rows.evil.code, 'string'); assert.equal(rows.evil.code, '');
  assert.equal(rows.evil.out, undefined, 'an `out` that is not a time was kept: ' + JSON.stringify(rows.evil.out));
  assert.equal(rows.evil.in, undefined);
  assert.equal(rows.numeric.childName, '7'); assert.equal(rows.numeric.code, '1234');
  assert.equal(rows.numeric.out, 1789084514, 'a numeric string `out` (an older writer) was dropped');
});

test('a WITHDRAWN clearance is reported as withdrawn — not as "never cleared", and not silently', () => {
  // Device finding D3, 2026-09-11: after the church withdrew a helper's clearance the phone kept the register
  // through a resume and a cold start with no line saying anything had changed. The tombstone arrived; the
  // state had no word for it. This is that word. The rows stay (the phone already holds them, and the relay
  // serves nothing new) — whether to DROP them is the owner's call, not this reader's.
  const tomb = { pubkey: church.pub, created_at: NOW - 60, content: '',
                 tags: [['d', CHECKINPERM_D + morning.pub], ['t', 'trinityone'], ['church', church.pub], ['deleted', '1']] };
  const v = phone(morning)
    .feed(clearance(morning), envelope(AM, AM_KEY, [morning]),
          record('ci-1', { childName: 'Esther Ncube', code: '4417' }, AM, AM_KEY), tomb)
    .settle().last();
  assert.equal(v.cleared, false, 'a withdrawn clearance still admits');
  assert.equal(v.withdrawn, true,
    'A WITHDRAWAL IS SILENT. The church took this clearance away and the phone reports the same state as ' +
    'somebody who was never cleared — the screen has nothing to say. State: ' + JSON.stringify({ cleared: v.cleared, lapsed: v.lapsed, notYet: v.notYet, withdrawn: v.withdrawn }));
  assert.equal(v.lapsed, false, 'a withdrawal was reported as an expiry');
  assert.deepEqual(namesOn(v), ['Esther Ncube'], 'the reader dropped the rows the phone already held — that decision is not this reader\'s to take');
  // and never cleared is NOT withdrawn — the cold-start race, where nothing has arrived, must not say "withdrawn"
  const never = phone(morning).feed(envelope(AM, AM_KEY, [morning])).settle().last();
  assert.equal(never.withdrawn, false, 'a phone that has never seen a clearance document reports one as withdrawn');
  // nor is a clearance body this parser cannot vouch for (relay/app version skew) — audit 2026-09-11
  const junk = { ...clearance(morning), content: JSON.stringify({ person: morning.pub, lifetime: 'forever' }) };
  const skew = phone(morning).feed(junk, envelope(AM, AM_KEY, [morning])).settle().last();
  assert.equal(skew.cleared, false, 're-anchor: an unreadable clearance must not clear');
  assert.equal(skew.withdrawn, false, 'a clearance this phone cannot read is reported as "withdrawn by the church"');
  // and a withdrawal the SAFEGUARDING STEWARD signed is a withdrawal — the relay honours it (red team F-A / audit F1)
  const sgLead = keypair();
  const sgTomb = { ...tomb, pubkey: sgLead.pub };
  const byLead = phone(morning).feed(clearance(morning), envelope(AM, AM_KEY, [morning]), sgTomb).settle().last();
  assert.equal(byLead.cleared, false, 'A STEWARD\'S WITHDRAWAL IS IGNORED BY THE PHONE, which goes on saying cleared');
  assert.equal(byLead.withdrawn, true, 'a steward-signed withdrawal is not reported as one');
});

// ── THE RACE THE CONSOLE'S HOLDING PEN GOT WRONG. ─────────────────────────────────────────────────────────
test('records arriving BEFORE the envelope still open when the key lands', () => {
  // On a cold start this is the ORDINARY order: the docs hub replays its persisted corpus oldest-first, so the
  // records reach the reader before any envelope can be unwrapped. The console's own pen stored only
  // { content, ts } and lost the tags, so a retry could never find the ['ck'] copy — a whole register would
  // have read as unreadable for ever.
  const p = phone(morning)
    .feed(record('ci-1', { childName: 'Esther Ncube', code: '4417' }, AM, AM_KEY),
          record('ci-2', { childName: 'Amos Bello', code: '9081' }, AM, AM_KEY));
  const before = p.last();
  assert.deepEqual(namesOn(before), [], 're-anchor: rows appeared before any key was held, so the retry proves nothing');
  assert.equal(before.foreign, 2, 're-anchor: the records were not held as another session\'s while no key was held');

  p.feed(clearance(morning), envelope(AM, AM_KEY, [morning])).settle();
  const after = p.last();
  assert.deepEqual(namesOn(after), ['Amos Bello', 'Esther Ncube'],
    'THE KEY ARRIVED AND NOTHING RE-OPENED. Every record already on the phone stays shut for the life of the ' +
    'session — which on a cold start is every record there is.');
  assert.equal(after.foreign, 0, 'the records are still filed as another session\'s after their own key arrived');
});

// ── AND THE THING A WORKER MUST NOT BE ABLE TO DO: OPEN `content`. ────────────────────────────────────────
test('the register never comes from `content` — a worker holds no safeguarding ring key and does not try', () => {
  // `content` is sealed to the church's SAFEGUARDING RING. The whole double-lock design rests on a worker
  // reading only the ['ck'] tag, so this feeds a record whose `content` is a plain, readable JSON body — the
  // shape a reader that had quietly fallen back to `content` would happily render — and asserts nothing comes
  // out of it. A reader that ever learns to open `content` would be opening the church's copy.
  const naked = record('ci-1', { childName: 'Esther Ncube', code: '4417' }, AM, '');
  naked.content = JSON.stringify({ id: 'ci-1', childName: 'LEAKED FROM CONTENT', code: '0000', session: AM });
  const v = phone(morning).feed(clearance(morning), envelope(AM, AM_KEY, [morning]), naked).settle().last();
  assert.deepEqual(namesOn(v), [],
    'THE READER OPENED `content`. That is the safeguarding ring\'s copy, and a worker must never read it — ' +
    'the helper\'s copy is the ["ck"] tag and nothing else.');
  assert.equal(v.unreadable, 1, 'and the honest state was lost too');
});

// ── A STRANGER'S TOMBSTONE MUST NOT HIDE A CHILD WHO IS IN THE ROOM. ──────────────────────────────────────
test('a tombstone from somebody the reader does not trust removes nothing', () => {
  const live = record('ci-1', { childName: 'Esther Ncube', code: '4417' }, AM, AM_KEY);
  const p = phone(morning).feed(clearance(morning), envelope(AM, AM_KEY, [morning]), live).settle();
  assert.deepEqual(namesOn(p.last()), ['Esther Ncube'], 're-anchor: the row was never there to remove');

  p.feed({ pubkey: evening.pub, created_at: NOW + 60, content: '',
           tags: [['d', CHECKIN_D + 'ci-1'], ['deleted', '1'], ['session', AM]] });
  assert.deepEqual(namesOn(p.last()), ['Esther Ncube'],
    'A STRANGER\'S TOMBSTONE TOOK A CHILD OFF THE REGISTER. kind-30078 is per-author so it never replaced the ' +
    'record on the relay — honouring it here simply hides a child who is in the room.');

  // …and the church's own tombstone IS honoured, so the assertion above is not passing over a reader that
  // ignores every deletion.
  p.feed({ pubkey: church.pub, created_at: NOW + 120, content: '',
           tags: [['d', CHECKIN_D + 'ci-1'], ['deleted', '1'], ['session', AM]] });
  assert.deepEqual(namesOn(p.last()), [], 'CONTROL: the reader honours no tombstone at all, from anybody');
});
