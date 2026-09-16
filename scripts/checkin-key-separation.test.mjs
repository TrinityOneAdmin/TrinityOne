// A TREASURER MAY NOT READ A CHILD'S PICKUP CODE.
// Run: node --test scripts/checkin-key-separation.test.mjs
//
// Found while building capability-scoped delegation, 2026-08-20. Kids check-in records went out through
// encPublish -> encSelf, and so did the church's ledger. encSelf sealed BOTH with one key derived from the
// church's own secret. When Finance became a delegatable capability, that key had to be handed to every
// treasurer — and it opened the children's register with it: each child's name, room, session, and the pickup
// code that says who is allowed to collect them.
//
// Nobody granted that. The steward console showed a treasurer with one capability ticked. The person picking
// the capabilities had no way to know the two were the same secret, because nothing on the screen or in the
// document names said so.
//
// The fix is one key per capability (CAP_KEYS in src/steward.src.js). These tests hold that line at the only
// place it can be held honestly: the ciphertext.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { fnBody, stripComments, stmt } from './test-slice.mjs';
// THE SHIPPED GRANT BUILDER AND THE SHIPPED READERS, out of the module esbuild inlines into
// vendor/steward.js. The acceptance tests at the foot of this file drive the whole double-lock chain, and a
// test-local envelope or a test-local `ck` reader would be the test answering the question it is named after.
import { checkinGuardianCopies, checkinGuardianPubs, readCheckinGuardianCopy,
         buildHelperGrant, readHelperGrant, helperKeyFor, readCheckinHelperCopy, checkinSessionOf,
         GRANT_SOURCE } from './checkin-role-source.mjs';
import { D } from './trinity-doc-types.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const STEW = readFileSync(new URL('../src/steward.src.js', import.meta.url), 'utf8');
const GW = readFileSync(new URL('../scripts/gateway.mjs', import.meta.url), 'utf8');
const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

const hex = (u8) => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/.{1,2}/g).map(b => parseInt(b, 16)));
const church = (() => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; })();
const legacyKey = hex(nip44.utils.getConversationKey(church.sk, church.pub));
const financeKey = hex(webcrypto.getRandomValues(new Uint8Array(32)));
const checkinKey = hex(webcrypto.getRandomValues(new Uint8Array(32)));

// THE SHIPPED TABLE, parsed out of the bundle. Restating it here — which the first version of this file did —
// makes every test below agree with a copy of the design rather than with the design. Marking check-in
// `legacy: true` in the product would then change nothing here, and that single flag is what decides whether
// a treasurer can read a child's pickup code.
const CAP = (() => {
  const m = VENDOR.match(/CAP_KEYS\s*=\s*\{([\s\S]*?)\n\s*\};/);
  assert.ok(m, 're-anchor: CAP_KEYS is not in the bundle under that name');
  const out = {};
  // Parse the WHOLE entry, field by field, rather than a fixed field list. The first version of this matched
  // d/cap/legacy positionally and silently dropped `explicit` when it was added — so every test below went on
  // asserting against a table that no longer matched the product, and the one that should have caught an
  // unscoped steward inheriting the children's register passed instead.
  for (const line of m[1].split('\n')) {
    const e = line.match(/(\w+):\s*\{([^}]*)\}/);
    if (!e) continue;
    const entry = {};
    for (const f of e[2].split(',')) {
      const kv = f.match(/\s*(\w+):\s*(?:"([^"]*)"|(true|false))/);
      if (kv) entry[kv[1]] = kv[2] !== undefined ? kv[2] : kv[3] === 'true';
    }
    if (entry.d) out[e[1]] = entry;
  }
  assert.ok(out.finance && out.checkin, 're-anchor: could not parse finance/checkin out of CAP_KEYS');
  return out;
})();

// The shipped seal/open, lifted and run for real. A paraphrase of them would agree with itself for ever.
function console_({ finance = [], checkin = [], ownerKey = false }) {
  const stubs = {
    _capState: {
      finance: { ring: finance, docKeys: null, rev: 1, at: 0, checked: false },
      checkin: { ring: checkin, docKeys: null, rev: 1, at: 0, checked: false },
    },
    CAP_KEYS: JSON.parse(JSON.stringify(CAP)),
    churchSk: ownerKey ? church.sk : null, churchPub: church.pub,
    actingChurch: ownerKey ? '' : church.pub, churchSkHeld: () => !!ownerKey,
    nip44e: (p, k) => nip44.encrypt(p, k), nip44d: (c, k) => nip44.decrypt(c, k),
    nip44ck: (a, b) => nip44.utils.getConversationKey(a, b),
    encrypt: (p, k) => nip44.encrypt(p, k), decrypt: (c, k) => nip44.decrypt(c, k),
    getConversationKey: (a, b) => nip44.utils.getConversationKey(a, b),
    _unhex: unhex, _hex: hex, crypto: webcrypto,
  };
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      const b = String(k).replace(/[0-9]+$/, ''); if (b in t) return t[b];
      throw new ReferenceError('needs a stub for ' + String(k)); },
  });
  const mk = (n) => new Function('scope', `with (scope) { return ({ ${fnBody(VENDOR, n + '(kind', n)} }).${n}; }`)(scope);
  return { seal: mk('encSeal'), open: mk('encOpen') };
}

test('the register does NOT carry the legacy key, and the books do', () => {
  // One flag, and the entire separation rests on it. The legacy self-key sealed everything encSelf ever
  // wrote; any ring containing it inherits every other capability's history. Finance must keep it — the
  // ledger is append-only and the relay pins each entry to an exact next sequence, so its past cannot be
  // re-keyed. Nothing else may have it.
  assert.equal(CAP.checkin.legacy, false,
    'the children\'s register carries the legacy self-key — the same key the BOOKS ring contains — so ' +
    'granting a treasurer Finance hands them every child\'s name, room and pickup code');
  assert.equal(CAP.checkin.cap, 'safeguarding', 'the register\'s key is handed out with the wrong capability');
  assert.equal(CAP.finance.legacy, true,
    'the books lost the legacy key, so every entry written before the envelope existed is now unreadable');
});

const RECORD = { id: 'ci1', childName: 'Esther Ncube', room: 'Lambs', code: '4417', note: 'collected by gran' };

test('a steward given ONLY Finance cannot read a check-in record', () => {
  // the safeguarding lead writes the register
  const lead = console_({ checkin: [checkinKey] });
  const rec = lead.seal('checkin', RECORD);
  assert.ok(rec, 're-anchor: a safeguarding delegate can no longer write the register at all');

  // the treasurer holds the books' ring, legacy key and all, and nothing else
  const treasurer = console_({ finance: [financeKey, legacyKey] });
  assert.equal(treasurer.open('checkin', rec), null,
    'the treasurer decrypted a child\'s check-in. The Finance capability hands over the children\'s register ' +
    '— name, room and pickup code — and the console that granted it said only "Finance".');
  assert.equal(treasurer.open('finance', rec), null,
    'the books\' own ring opens a check-in record, so the two capabilities are still one secret');
});

test('and the safeguarding lead cannot read the books', () => {
  // The same wall, the other way round. A safeguarding lead is often a volunteer with no business seeing
  // giving totals, salaries or benevolence payments.
  const treasurer = console_({ finance: [financeKey, legacyKey] });
  const entry = treasurer.seal('finance', { memo: 'Pastor stipend', amount: -2100 });
  const lead = console_({ checkin: [checkinKey] });
  assert.equal(lead.open('finance', entry), null, 'the safeguarding key opens the church ledger');
  assert.equal(lead.open('checkin', entry), null, 'the safeguarding key opens the church ledger');
});

test('the safeguarding lead CAN read what the owner wrote to the register', () => {
  // Isolation is worthless if it also breaks the feature. The owner mints and holds every ring.
  const owner = console_({ finance: [financeKey, legacyKey], checkin: [checkinKey], ownerKey: true });
  const rec = owner.seal('checkin', RECORD);
  const lead = console_({ checkin: [checkinKey] });
  assert.deepEqual(lead.open('checkin', rec), RECORD,
    'the person the church put in charge of children cannot open the register the church wrote');
});

test('a delegate with NO safeguarding key gets nothing, and no legacy fallback saves them', () => {
  const owner = console_({ finance: [financeKey, legacyKey], checkin: [checkinKey], ownerKey: true });
  const rec = owner.seal('checkin', RECORD);
  const nobody = console_({});
  assert.equal(nobody.open('checkin', rec), null, 'an unkeyed delegate reads the register');
  // and they cannot WRITE one either — encSeal must not fall back to the legacy key for a non-legacy
  // capability, or the first record a church ever writes lands back on the shared secret.
  assert.equal(nobody.seal('checkin', RECORD), null, 'an unkeyed delegate can forge a register entry');
});

test('the OWNER can still open records written before the split, but no delegate can', () => {
  // The migration case. Everything already on a relay is sealed with the legacy key; those records must not
  // become unreadable, and the owner is the only one who may see them until migrateCheckinKeys() moves them.
  const old = nip44.encrypt(JSON.stringify(RECORD), unhex(legacyKey));
  const owner = console_({ checkin: [checkinKey], ownerKey: true });
  assert.deepEqual(owner.open('checkin', old), RECORD,
    'records written before check-in had its own key are now unreadable to the church itself — a register ' +
    'silently emptied by an upgrade');
  const lead = console_({ checkin: [checkinKey] });
  assert.equal(lead.open('checkin', old), null, 're-anchor: a delegate is deriving the legacy key somehow');
});

test('a fresh check-in is sealed with the SAFEGUARDING key, not the legacy one', () => {
  const owner = console_({ checkin: [checkinKey], ownerKey: true });
  const rec = owner.seal('checkin', RECORD);
  assert.deepEqual(JSON.parse(nip44.decrypt(rec, unhex(checkinKey))), RECORD,
    'the owner is sealing new register entries with the legacy key even though a safeguarding key exists, ' +
    'so every record it writes stays readable to Finance');
});

// Drive publishCheckin ITSELF — the whole chain, publishCheckin -> encPublish -> encSeal — and read the key
// off the ciphertext it produces. The tests above prove encSeal can keep two keys apart; this proves the
// children's register is actually wired to it. Reverting just the wiring (dropping the 'checkin' argument, so
// encPublish falls back to its 'finance' default) is a one-character change that looks identical on screen
// and reinstates the entire leak.
function publishedCheckin({ finance, checkin, ownerKey }) {
  const subs = [];
  const events = [];
  const stubs = {
    _capState: {
      finance: { ring: finance || [], docKeys: null, rev: 1, at: 0, checked: false },
      checkin: { ring: checkin || [], docKeys: null, rev: 1, at: 0, checked: false },
    },
    CAP_KEYS: JSON.parse(JSON.stringify(CAP)),
    churchSk: ownerKey ? church.sk : null, churchPub: church.pub,
    actingChurch: ownerKey ? '' : church.pub, churchSkHeld: () => !!ownerKey,
    sk: church.sk, pub: church.pub,
    nip44e: (p, k) => nip44.encrypt(p, k), nip44d: (c, k) => nip44.decrypt(c, k),
    nip44ck: (a, b) => nip44.utils.getConversationKey(a, b),
    encrypt: (p, k) => nip44.encrypt(p, k), decrypt: (c, k) => nip44.decrypt(c, k),
    getConversationKey: (a, b) => nip44.utils.getConversationKey(a, b),
    _unhex: unhex, _hex: hex, crypto: webcrypto,
    feChurch: (t) => t, publish: async (e) => { events.push(e); return e; },
    now: () => 1787280000, NET: 'trinityone', _todayISO: () => '2026-08-20',
    Date: { now: () => 1787280000000 }, Math: globalThis.Math,
    window: { Steward: {} },   // filled in below with the very functions we lift, so the chain is the real one
    // WHICH SESSION KEYS THIS CONSOLE HOLDS — module state in the console, written by
    // subscribeCheckinSessionKeys as each envelope arrives and read by the sealer. A fresh Map per harness,
    // and EMPTY by default: the default fixture below is therefore a record with NO helper copy, which is
    // exactly what a church with no envelope for today still gets. Tests that want the copy put a key in it.
    _ckSessionKeys: new Map(),
    // AND THE WORLD encSubscribe NEEDS — added 2026-09-10 with piece 1, because the READER half of the
    // double lock had to be executed rather than described. The pool is captured, not dialled: the events
    // fed to it below are the ones the SHIPPED WRITER in this same harness really produced, so what comes
    // out the other end is what a console would actually hold.
    pool: { subscribeMany: (_r, filters, handlers) => { subs.push({ filters, handlers }); return { close() {} }; } },
    relays: () => ['wss://relay.test/relay'],
    _careRoster: new Set(),
    _capWaiters: { finance: new Set(), checkin: new Set() },
    // PIECE 3's READ STAMP, which subscribeCheckinSessionKeys also writes. Nothing in THIS file is about the
    // EOSE gate — that is driven in scripts/checkin-session-keys-are-not-issued-early.test.mjs — but the
    // lifted subscription bumps and stamps these, so they have to exist.
    _ckKeysSettled: '', _ckKeysGen: 0, _ckKeysSettledGen: -1,
    _isRelayAuthed: () => true,
    CHECKINHELPER_D: 'trinityone/checkinhelper:',
    // THE SHARED READERS, imported from the module esbuild inlines into the bundle rather than stubbed —
    // they are the rules about what a malformed record means, which is what the reader tests are about.
    readCheckinHelperCopy, checkinSessionOf,
  };
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      const b = String(k).replace(/[0-9]+$/, ''); if (b in t) return t[b];
      throw new ReferenceError('needs a stub for ' + String(k)); },
  });
  // AND THE TAG DERIVATION, LIFTED RATHER THAN STUBBED — added 2026-09-10, when encPublish started asking
  // for it. It decides the CLEARTEXT tags on a check-in record (['session'] and one ['p'] per guardian), so a
  // stub here would hide it from the one test that runs this whole chain, and this file's subject is exactly
  // "what does the shipped chain actually produce". It is a top-level function declaration closed over
  // nothing, so it evaluates as itself.
  stubs._encCleartextTags = new Function(
    fnBody(VENDOR, 'function _encCleartextTags(kind, obj) {', '_encCleartextTags') +
    '\nreturn _encCleartextTags;')();
  // AND THE HELPER'S-COPY BUILDER, LIFTED THE SAME WAY — added 2026-09-10 with piece 1 of
  // reference/SCOPE-CHECKIN-SEALING-2026-09-10.md. It decides whether a record carries a second ciphertext
  // sealed under the session key, and it is the subject of the three tests at the foot of this file, so a
  // stub would be the test answering its own question. Unlike _encCleartextTags it CLOSES OVER the harness
  // (`_ckSessionKeys`, `nip44e`, `_unhex`), so it is evaluated with the scope.
  stubs._encSealedCopies = new Function('scope',
    'with (scope) { return (' + stmt(VENDOR, 'var _encSealedCopies = (kind, obj) =>', '_encSealedCopies')
      .replace(/^var\s+\w+\s*=\s*/, '').replace(/;\s*$/, '') + '); }')(scope);
  // AND THE GUARDIAN'S-COPY BUILDER — STEP 2 of the parent surface, lifted for the same reason as the two
  // above. It is deliberately NOT part of _encSealedCopies: that one gives up the moment a record has no
  // session, and a church with no service document must still hand its parents their pickup code. It closes
  // over `sk`, the bundle's nip44 pair and the shared `checkinGuardianCopies`, so it is evaluated with the
  // scope and that shared function is reachable through it.
  stubs.checkinGuardianCopies = checkinGuardianCopies;
  stubs._encGuardianCopies = new Function('scope',
    'with (scope) { return (' + stmt(VENDOR, 'var _encGuardianCopies = (kind, obj) =>', '_encGuardianCopies')
      .replace(/^var\s+\w+\s*=\s*/, '').replace(/;\s*$/, '') + '); }')(scope);
  // All three lifted together into ONE object, so publishCheckin's `window.Steward.encPublish` really is the
  // shipped encPublish, and encPublish's `encSeal` really is the shipped encSeal.
  // AND THE BRIDGE FROM THE CONSOLE TO THE SHARED READER — which session (from the cleartext tag), which key
  // we hold for it, then readCheckinHelperCopy. Lifted, not stubbed: it is the decision the reader tests are
  // named after. It closes over _ckSessionKeys, nip44d and _unhex, so it needs the scope.
  stubs._encOpenSealedCopy = new Function('scope',
    'with (scope) { return (' + stmt(VENDOR, 'var _encOpenSealedCopy = (kind, tags) =>', '_encOpenSealedCopy')
      .replace(/^var\s+\w+\s*=\s*/, '').replace(/;\s*$/, '') + '); }')(scope);
  // FIVE FUNCTIONS IN ONE OBJECT, so publishCheckin's `window.Steward.encPublish` really is the shipped
  // encPublish, encPublish's `encSeal` really is the shipped encSeal, and encSubscribe's
  // `window.Steward.encOpen` really is the shipped encOpen. Nothing in the chain is a stand-in.
  const src = ['publishCheckin(rec)', 'encPublish(dtag', 'encSeal(kind', 'encOpen(kind', 'encSubscribe(prefix, cb, kind) {']
    .map((sig, i) => fnBody(VENDOR, sig, ['publishCheckin', 'encPublish', 'encSeal', 'encOpen', 'encSubscribe'][i])).join(',\n');
  const api = new Function('scope', `with (scope) { return { ${src} }; }`)(scope);
  Object.assign(stubs.window.Steward, api);
  // `stubs` IS RETURNED so a test can seed _ckSessionKeys — the module state subscribeCheckinSessionKeys
  // writes. Seeding it is how a test says "this console holds that session's key" without stubbing the
  // decision of whether a copy gets sealed, which is the thing under test.
  // `scope` and `subs` are returned so the session-key SUBSCRIPTION can be lifted against the same world —
  // the map it writes has to be the map the sealer reads, or the gate is untestable by construction.
  return { api, events, stubs, subs, scope };
}

test('publishCheckin seals with the SAFEGUARDING key — the whole chain, not just encSeal', async () => {
  const { api, events } = publishedCheckin({ finance: [financeKey, legacyKey], checkin: [checkinKey], ownerKey: true });
  await api.publishCheckin({ id: 'ci1', childName: 'Esther Ncube', room: 'Lambs', code: '4417' });
  assert.equal(events.length, 1, 're-anchor: publishCheckin published nothing');
  const ct = events[0].content;

  // the treasurer's ring must not open it...
  for (const k of [financeKey, legacyKey]) {
    assert.throws(() => nip44.decrypt(ct, unhex(k)),
      'publishCheckin sealed a child\'s record with a key the BOOKS ring contains, so every treasurer can ' +
      'read the register. This is the original defect: encPublish defaults to the finance capability, and ' +
      'dropping the \'checkin\' argument silently restores it.');
  }
  // ...and the safeguarding lead's must
  const got = JSON.parse(nip44.decrypt(ct, unhex(checkinKey)));
  assert.equal(got.code, '4417', 'the register is not readable with the safeguarding key');
  assert.equal(got.childName, 'Esther Ncube');
});

test('publishCheckin and subscribeCheckins actually NAME the checkin capability', () => {
  // The ciphertext tests above prove encSeal separates the keys. This proves the register is wired to it —
  // the version of this change that got the crypto right and left publishCheckin on the default was one
  // character away, and behaved identically on every screen.
  const src = stripComments(STEW);
  assert.match(src, /publishCheckin\(rec\)[\s\S]*?encPublish\([\s\S]*?['"]checkin['"]\s*\)/,
    'publishCheckin does not pass the checkin capability, so it falls to the default and seals the ' +
    'children\'s register with the books\' key');
  // RE-ANCHORED 2026-09-11, the same trap the test below this one already carries a note about: this matched
  // `[^\n]*` — the rest of ONE LINE — which was right while subscribeCheckins was a one-liner and went wrong
  // the moment it grew a body (folding a worker's release onto the child it collects). Slice the whole
  // FUNCTION instead, so the assertion survives the reader growing without passing or failing by accident.
  const subFn = src.match(/subscribeCheckins\(cb\)\s*\{[\s\S]*?\n  \},/);
  assert.ok(subFn, 're-anchor: subscribeCheckins is no longer a method on the Steward object');
  const capArgs = [...subFn[0].matchAll(/encSubscribe\(([\s\S]*?)\)/g)];
  assert.equal(capArgs.length, 1, 'subscribeCheckins now calls encSubscribe ' + capArgs.length + ' times — re-anchor this test');
  assert.match(subFn[0], /['"]checkin['"]\s*\)\s*;?\s*$|['"]checkin['"]\s*\)/,
    'subscribeCheckins reads with the books\' ring');
  assert.doesNotMatch(subFn[0], /encSubscribe\([^)]*['"]finance['"]/, 'the register is read with the FINANCE ring');
});

test('the relay refuses a check-in write from anyone but the church or a SAFEGUARDING steward', () => {
  // Addressable docs REPLACE on write. Before this rule, `checkin:<id>` fell to the member catch-all, so any
  // member of the church could overwrite a child's presence record with anything and it would vanish from the
  // register. Reading it was never possible; destroying it needed no key at all.
  const gw = stripComments(GW);
  // RE-ANCHORED 2026-09-09. This matched `[^\n]*` — the rest of ONE LINE — which was right while the rule was a
  // one-liner and became silently wrong the moment the check-in helper capability made it a block: the match
  // then captured `if (d.startsWith(CHECKIN_D)) {` and nothing else, and every assertion below it would have
  // failed for a reason that has nothing to do with what they are about. Slice the whole BLOCK instead, so
  // this test survives the rule growing a third branch without either passing or failing by accident.
  const rule = gw.match(/if \(d\.startsWith\(CHECKIN_D\)\) \{[\s\S]*?\n    \}/) || gw.match(/if \(d\.startsWith\(CHECKIN_D\)\)[^\n]*/);
  assert.ok(rule, 'the relay has no rule for checkin: docs, so they fall to the member catch-all and any ' +
    'member of the church can overwrite a child\'s check-in record');
  // COUNT CODE, NOT BLANK LINES. This was `.split('\n').length < 40` and broke on 2026-09-16 when a twenty-
  // line COMMENT was added inside the rule — `stripComments` replaces a comment line with an EMPTY line
  // rather than removing it, so the slice went to 49 lines while the rule itself stayed at 11 lines of code.
  // The guard is here to catch the slice running away past its own block, which is a code question; a
  // comment growing must never fail it, or the next person to explain something in that block gets a red
  // suite and no idea why.
  const ruleCode = rule[0].split('\n').filter(l => l.trim()).length;
  assert.ok(ruleCode < 40, 're-anchor: the checkin: write rule slice ran away past its own block — ' +
    ruleCode + ' lines of code');
  assert.match(rule[0], /stewardCan\(e\.pubkey, cp, ['"]safeguarding['"]\)/,
    'the check-in write rule does not admit a safeguarding steward, so the capability grants nothing');
  assert.match(rule[0], /e\.pubkey === cp/, 'the church itself cannot write its own register');
  // and it must come BEFORE the member catch-all, or it never runs. Anchored on CODE, not on the comment
  // that explains the catch-all: comments are stripped here, and this repo has already shipped an assertion
  // that a comment satisfied.
  const cap = gw.indexOf('authors: [e.pubkey], limit: MEMBER_DOC_CAP');   // the catch-all's BODY, not the declaration
  assert.ok(cap > 0 && gw.indexOf('d.startsWith(CHECKIN_D)') < cap,
    're-anchor: the check-in rule now sits after the member doc-cap catch-all, where it can never be reached');
});

test('the KEY envelope is owner-only on the relay', () => {
  const gw = stripComments(GW);
  const rule = gw.match(/if \(d\.startsWith\(CHECKINKEY_D\)\)[^\n]*/);
  assert.ok(rule, 'the relay does not gate checkinkey: at all — anyone may publish the envelope that decides ' +
    'who reads the children\'s register');
  assert.match(rule[0], /e\.pubkey === cp/, 'the check-in key envelope is not owner-only');
  assert.doesNotMatch(rule[0], /stewardCan/,
    'a delegated steward can mint the register\'s key envelope, so a safeguarding lead could hand the ' +
    'register to whoever they liked — including themselves after being removed');
  assert.match(gw, /CP_SUFFIXED_D = \[[^\]]*CHECKINKEY_D/,
    'checkinkey: is not in CP_SUFFIXED_D, so the read gate cannot resolve which church it belongs to and ' +
    'default-deny will refuse it to the church\'s own stewards');
});

test('the migration moves old records off the shared key, and only the owner runs it', () => {
  const body = stripComments(fnBody(STEW, 'async migrateCheckinKeys(timeoutMs) {', 'migrateCheckinKeys'));
  assert.match(body, /churchSkHeld\(\)/, 'the migration runs on a delegate console, which cannot derive the legacy key');
  assert.match(body, /encPublish\([^\n]*['"]checkin['"]\)/, 're-sealed records are not written back under the checkin capability');
  assert.match(body, /for \(const k of st\.ring\)[\s\S]{0,160}return;/,
    'the migration does not skip records already on the new key, so every run rewrites the whole register');
});

// ── the screen ────────────────────────────────────────────────────────────────────────────────────────────
test('the check-in screen never claims a record it did not write', () => {
  // Giving the register its own key made this write ABLE to fail — a console without the safeguarding key
  // returns null from encPublish. The handler dropped the promise on the floor, so the child appeared as
  // "in" on screen and nothing existed anywhere. Of every control in this console, this is the one that must
  // not lie: a child's presence, and who is allowed to collect them.
  const src = stripComments(DASH);
  const body = fnBody(src, 'const writeCheckin = async (rec, what) => {', 'writeCheckin');
  assert.match(body, /await window\.Steward\.publishCheckin\(rec\)/, 'the check-in write is not awaited, so its result cannot be checked');
  assert.match(body, /ok === false \|\| ok == null/, 'a null result — what encPublish returns when it declines — reads as success');
  assert.match(body, /steward-write-blocked/, 'a failed check-in tells nobody');

  // and NOTHING calls publishCheckin around it
  const direct = [...src.matchAll(/Steward\.publishCheckin\(/g)];
  assert.equal(direct.length, 1,
    `${direct.length} calls to publishCheckin — exactly one is allowed, inside writeCheckin(). A control that ` +
    'calls it directly is how a check-in gets shown as recorded when it was refused.');
  assert.match(body, /Steward\.publishCheckin\(/, 're-anchor: the one permitted call is no longer in writeCheckin');
});

test('and it refuses to check a child in with no key, rather than writing into the void', () => {
  const src = stripComments(DASH);
  assert.match(src, /subscribeCapKey\(['"]checkin['"]/, 'the check-in screen does not watch for its own key, so it cannot know whether it can write');
  assert.match(src, /disabled=\{!minors\.length \|\| !sgKey\}/,
    '"Check a child in" is still offered when this console holds no safeguarding key. An empty register and ' +
    'a register this console cannot write look identical on screen, and one of them is a child marked ' +
    'present in a room with no record of it.');
});

test('the owner console mints the register\'s key, or nothing can ever be written', () => {
  const src = stripComments(DASH);
  assert.match(src, /_capKinds = \['finance', 'checkin'\]/,
    'the console no longer mints a key for every capability that has one — a capability minted for nobody ' +
    'means the first delegate given it sees an empty screen');
  assert.match(src, /ensureCapKeyFor\(kind, _stewardsForKey, caps\)/, 're-anchor: the mint loop changed shape');
  assert.match(src, /migrateCheckinKeys/, 'nothing moves the pre-split records off the shared key');
});

test('the migration only spends its one attempt when it actually finished', () => {
  // Found by adversarial audit, 2026-08-20. `_checkinMigrated = cp` was set on ENTRY, so a run that moved
  // nothing — the relay never EOSEd, the pipe is thin, every re-publish was refused — burned the single
  // attempt this session was going to make, threw its result away, and told nobody. What is left behind is
  // the whole pre-split register, still sealed with the key the BOOKS ring carries: the exact disclosure the
  // migration exists to close, now permanent for that session and invisible.
  const body = stripComments(fnBody(STEW, 'async migrateCheckinKeys(timeoutMs) {', 'migrateCheckinKeys'));
  // Anchored on ORDER, not on a character window: the guard must be set AFTER the publish loop, not before
  // the scan. A fixed-width lookahead silently stopped matching when the return statement between them grew.
  const setAt = body.indexOf('_checkinMigrated = cp;');
  const loopAt = body.indexOf('for (const [id, rec] of stale)');
  assert.ok(setAt > 0 && loopAt > 0, 're-anchor: the migration changed shape');
  assert.ok(setAt > loopAt,
    'the once-per-church guard is set before the records are moved, so a run that moves nothing still burns ' +
    'the single attempt this session was going to make');
  assert.match(body, /if \(sawEose && !failed\) _checkinMigrated = cp;/,
    'the guard is not conditional on the run having completed cleanly');
  assert.match(body, /steward-write-blocked/,
    'a partial migration tells nobody, so a church cannot know its old records are still readable by Finance');
  assert.match(body, /sawEose = true/,
    'a TIMEOUT is being treated as "there is nothing left to move" — on a thin pipe that is every run');
});

test('a timeout is distinguishable from a finished scan', () => {
  const body = stripComments(fnBody(STEW, 'async migrateCheckinKeys(timeoutMs) {', 'migrateCheckinKeys'));
  assert.match(body, /oneose: \(\) => finish\(true\)/, 'EOSE no longer records that the scan completed');
  assert.match(body, /setTimeout\(\(\) => finish\(false\)/, 'the timeout path is not marked as incomplete');
});

test('the register survives the volunteer standing down', () => {
  // The relay half. This commit is the first that lets a delegated steward write a check-in at all, so it is
  // the first where the retraction rule can reach one — and retraction would stop serving every record they
  // wrote, TO THE CHURCH ITSELF. Children marked present vanish from the register mid-session.
  const gw = stripComments(GW);
  const line = gw.match(/const retractionExempt = [^\n]*/);
  assert.ok(line, 're-anchor: retractionExempt is gone');
  assert.match(line[0], /CHECKIN_D/,
    'the children\'s register is not exempt from retraction, so a crèche volunteer standing down erases ' +
    'every check-in they ever recorded — including children currently in the room');
  assert.match(line[0], /startsWith\(['"]finance\/['"]\)/,
    're-anchor: the finance exemption went with it (it covers the whole module, not just the journal — see ' +
    'delegated-finance.test.mjs for why the journal alone was not enough)');
});

test('the pickup code is labelled where it can actually be read', () => {
  // Round 7, the real half of R7-3. A safeguarding lead looking at a checked-in child saw two unlabelled
  // values and said: "I couldn't tell which one is 'the' pickup code — I'd have read 9079 to a parent, but I
  // was guessing." He was right, and guessing is not good enough for the number that decides whether a child
  // leaves with the right adult.
  //
  // The hex he saw was a different bug (a PIN unlock left his console reading its own empty documents, so
  // names fell back to 'Child <hex>'). But the code itself carried no visible label either way: its only one
  // was a `title` tooltip, which does not exist on a touch screen and is not read aloud.
  // ⚠ ANCHORED ON "'pickup: '", NOT "' · pickup: '" — re-anchored 2026-09-12. The row stopped being a
  // concatenation and became a `.filter(Boolean).join(' · ')` of its parts, so that an unusable arrival time
  // contributes nothing instead of painting "Invalid Date" or a dangling "In ·". The separator therefore
  // moved out of the copy and into the join, and the old anchor matched nothing — which this assertion
  // caught, as it is there to. Nothing about what this test CLAIMS has changed.
  const src = stripComments(DASH);
  const at = src.indexOf("'pickup: '");
  assert.notEqual(at, -1, 're-anchor: the checked-in row no longer names the pickup list');
  const row = src.slice(at, at + 1400);
  assert.ok(row.length > 100, 're-anchor: the checked-in row changed shape');
  assert.match(row, />CODE</,
    'the pickup code has no visible label, so the only way to know which number to read to a parent is to guess');
  assert.match(row, /aria-label=\{'Pickup code '/,
    'the code has no accessible name — a steward using a screen reader hears a bare number with no idea what it is');
  assert.match(row, /split\(''\)\.join\(' '\)/,
    'the accessible name reads the code as one number rather than digit by digit, which is how it gets ' +
    'misheard on a phone call');
});


// ══ PIECE 1: THE DOUBLE LOCK — A HELPER'S OWN COPY OF A CHECK-IN RECORD ═══════════════════════════════════
//
// reference/SCOPE-CHECKIN-SEALING-2026-09-10.md, piece 1, and the owner's decision of that date. `content`
// stays the safeguarding ring's ciphertext, byte for byte; the helper's copy rides in an added signed
// `['ck', …]` tag sealed under that session's key, with the marker bumped to `['enc','2']`.
//
// EVERYTHING HERE IS THE SHIPPED CHAIN WITH REAL NIP-44. The writer is lifted out of vendor/steward.js
// (publishCheckin → encPublish → encSeal + _encSealedCopies); the envelope is built by the shipped
// buildHelperGrant; the helper's key comes back through the shipped readHelperGrant → helperKeyFor; the copy
// is opened by the shipped readCheckinHelperCopy. Nothing between the church sealing a record and a helper
// reading it is this file's own code.
//
// ⚠ WHAT THESE TESTS CANNOT PROVE, stated here rather than in a report nobody reads with the code: A HELPER
// HAS NO CLIENT. `grep -c checkin src/fellowship.src.js` finds one unrelated line, so there is no member-app
// check-in surface at all, and `publishCheckin` is reachable only from the steward console. So "a cleared
// helper opens a record THEY wrote" is unbuildable today in its literal form — the write half belongs to
// slice 3. What is proved is the sealing contract end to end: a record written AT THE DESK for a session a
// helper is cleared for opens with the key that helper's own envelope gives them, and with nothing else.
const helper = (() => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; })();
const other = (() => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; })();   // cleared for a DIFFERENT session
const treasurer = (() => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; })();
const AT = 1787280000;                    // the harness clock, so a window is never what decides a test
const SESSION = 'svc-sunday-am';
const OTHER_SESSION = 'svc-sunday-pm';

// AN ENVELOPE THE CHURCH REALLY SIGNED, built by the shipped builder with real NIP-44 wrapping. This is the
// only place a session key exists in the product, so a hand-written one would prove nothing about what a
// helper can actually get hold of.
function envelopeFor(session, pubs, sessionKeyHex) {
  const built = buildHelperGrant({ session, source: GRANT_SOURCE, lifetime: 'session', from: AT - 3600,
    until: AT + 3600, helpers: pubs, keepers: [church.pub], sessionKeyHex,
    wrap: (p2, plaintext) => nip44.encrypt(plaintext, nip44.utils.getConversationKey(church.sk, p2)) });
  assert.deepEqual(built.failed, [], 'fixture: the shipped builder could not wrap somebody, so this envelope is short');
  return JSON.stringify(built.doc);
}
// AND THE HELPER'S OWN ROUTE TO THE KEY — the shipped parser and the shipped time-scoped membership test,
// unwrapping with the HELPER'S secret. Returns '' exactly as it does in the product when a turn is not on.
const keyAsSeenBy = (envelopeContent, who, at = AT) => {
  const grant = readHelperGrant(envelopeContent);
  assert.ok(grant, 'fixture: the shipped parser refused the envelope the shipped builder just made');
  return helperKeyFor(grant, who.pub, at, (ct) => nip44.decrypt(ct, nip44.utils.getConversationKey(who.sk, church.pub)));
};
const unseal = (ct, k) => nip44.decrypt(ct, unhex(k));
const tagOf = (e, name) => (e.tags.find(t => t[0] === name) || [])[1];

test('A CLEARED HELPER OPENS A RECORD WRITTEN AT THE DESK — the whole double lock, shipped end to end', async () => {
  const sessionKey = hex(webcrypto.getRandomValues(new Uint8Array(32)));
  const envelope = envelopeFor(SESSION, [helper.pub], sessionKey);

  // THE CONSOLE'S SIDE: it holds this session's key because subscribeCheckinSessionKeys unwrapped its own
  // slot out of that envelope. Put it where the sealer reads it, which is the state that subscription leaves.
  const { api, events, stubs } = publishedCheckin({ finance: [financeKey, legacyKey], checkin: [checkinKey], ownerKey: true });
  stubs._ckSessionKeys.set(SESSION, sessionKey);
  await api.publishCheckin({ id: 'ci-am', child: 'k'.repeat(64), childName: 'Esther Ncube', code: '4417',
    session: SESSION, guardians: [], room: 'Lambs' });
  assert.equal(events.length, 1, 're-anchor: publishCheckin published nothing');
  const e = events[0];

  // ── the shape, before anyone opens anything ──
  assert.equal(tagOf(e, 'enc'), '2', 'the marker was not bumped, so nothing downstream can tell there is a second copy');
  assert.ok(tagOf(e, 'ck'), 'THE HELPER\'S COPY IS NOT ON THE RECORD. A cleared helper is served this event ' +
    'by the relay and holds the session key; without the ck tag there is nothing that key opens, which is ' +
    'the state this whole slice exists to end');
  assert.equal(tagOf(e, 'session'), SESSION,
    'the cleartext session tag is missing, so neither the relay nor a reader can tell which key to reach for');

  // ── ⚠ `content` IS UNTOUCHED, and this is the assertion that stands between this change and every console
  // on the current bundle rendering an empty register. The ring must still open it, on its own, exactly as
  // before.
  const churchCopy = JSON.parse(nip44.decrypt(e.content, unhex(checkinKey)));
  assert.equal(churchCopy.code, '4417', 'the safeguarding ring can no longer open `content` — the additive ' +
    'shape has stopped being additive, and every console on the shipped bundle now renders an EMPTY ' +
    'REGISTER WITH NO ERROR (measured by the audit against a reshaped content)');
  assert.equal(churchCopy.childName, 'Esther Ncube');

  // ── THE HELPER, through their own envelope and nothing else ──
  const key = keyAsSeenBy(envelope, helper);
  assert.match(key, /^[0-9a-f]{64}$/, 'the shipped helperKeyFor gave this cleared helper no key at all');
  assert.equal(key, sessionKey, 're-anchor: the key a helper recovers is not the one the desk sealed with');
  const helperCopy = readCheckinHelperCopy(e.tags, key, unseal);
  assert.ok(helperCopy, 'A CLEARED HELPER COULD NOT OPEN THE RECORD. This is the acceptance test for the ' +
    'whole slice: the relay serves them the event, their envelope gives them the key, and the key must open ' +
    'the copy the desk sealed');
  assert.equal(helperCopy.code, '4417', 'the helper opened something, but not the pickup code — which is the ' +
    'one field a leader at the door actually needs');
  assert.equal(helperCopy.childName, 'Esther Ncube');
  // BOTH COPIES ARE THE SAME BODY. A helper reading a different record from the church's is worse than a
  // helper reading nothing: two screens disagreeing about which child is present.
  assert.deepEqual(helperCopy, churchCopy,
    'the two copies of one record are not the same body, so the church and the helper would show different ' +
    'things about the same child');
  // AND THE ROW IDENTITY AGREES WITH THE ADDRESS. encSubscribe does `byId.set(id, { id, ...obj, ts })`, so a
  // body whose `id` disagrees with its d-tag FORKS the record — the same child present on one row and
  // collected on another. The scope note moved that finding into piece 1 because piece 1 edits this body.
  assert.equal(helperCopy.id, tagOf(e, 'd').slice('trinityone/checkin:'.length),
    'the sealed body\'s `id` disagrees with the record\'s own address, which forks the row');
});

test('…AND A HELPER CLEARED FOR A DIFFERENT SESSION OPENS NOTHING', async () => {
  // The point of a per-session key. Last Sunday's helper, or the helper on the other room's rota, is served
  // the ciphertext by the relay and must get nowhere with it.
  const amKey = hex(webcrypto.getRandomValues(new Uint8Array(32)));
  const pmKey = hex(webcrypto.getRandomValues(new Uint8Array(32)));
  assert.notEqual(amKey, pmKey, 're-anchor: the fixture gave both sessions the same key');
  const pmEnvelope = envelopeFor(OTHER_SESSION, [other.pub], pmKey);

  const { api, events, stubs } = publishedCheckin({ finance: [financeKey, legacyKey], checkin: [checkinKey], ownerKey: true });
  stubs._ckSessionKeys.set(SESSION, amKey);
  await api.publishCheckin({ id: 'ci-am', childName: 'Esther Ncube', code: '4417', session: SESSION, guardians: [] });
  const e = events[0];

  const theirKey = keyAsSeenBy(pmEnvelope, other);
  assert.match(theirKey, /^[0-9a-f]{64}$/, 'fixture: the other helper holds no key at all, so this proves nothing');
  assert.equal(readCheckinHelperCopy(e.tags, theirKey, unseal), null,
    'A HELPER CLEARED FOR ANOTHER SESSION OPENED THIS ONE\'S RECORD. Per-session keys are the mechanism that ' +
    'makes a clearance narrow — "last Sunday\'s helper holds last Sunday\'s key" — and it has just failed');
  // AND THEY ARE NOT ON THIS SESSION'S ENVELOPE EITHER, so the two halves agree: the relay would refuse them
  // and the key would not work if it did not.
  const amEnvelope = envelopeFor(SESSION, [helper.pub], amKey);
  assert.equal(keyAsSeenBy(amEnvelope, other), '',
    'the shipped helperKeyFor handed this session\'s key to somebody the church did not clear for it');
});

test('…AND A FINANCE-ONLY STEWARD OPENS NOTHING, though the relay serves them the ciphertext', async () => {
  // gateway.mjs:3604 serves EVERY check-in record to any steward, a Finance-only one included. That is
  // deliberate and unchanged by this slice — which makes the ciphertext the only thing standing between a
  // treasurer and a child's pickup code, exactly as it was before the second copy existed.
  const sessionKey = hex(webcrypto.getRandomValues(new Uint8Array(32)));
  const { api, events, stubs } = publishedCheckin({ finance: [financeKey, legacyKey], checkin: [checkinKey], ownerKey: true });
  stubs._ckSessionKeys.set(SESSION, sessionKey);
  await api.publishCheckin({ id: 'ci-am', childName: 'Esther Ncube', code: '4417', session: SESSION, guardians: [] });
  const e = events[0];

  // NOT `content` — that is the original defect and the tests above already hold it. THE NEW SURFACE IS THE
  // TAG, and a second ciphertext is a second chance to have sealed it with the wrong key.
  for (const k of [financeKey, legacyKey]) {
    assert.throws(() => nip44.decrypt(tagOf(e, 'ck'), unhex(k)),
      'THE HELPER\'S COPY OPENS WITH A KEY FROM THE BOOKS RING. The second lock has re-created the exact ' +
      'defect this file exists for, on a new surface: every treasurer can read a child\'s pickup code again.');
  }
  // …and the treasurer's own conversation key gets nowhere either, since they are not a helper.
  assert.throws(() => nip44.decrypt(tagOf(e, 'ck'), nip44.utils.getConversationKey(treasurer.sk, church.pub)),
    'the helper copy is readable by anyone the church ever talked to');
  // AND THE SHIPPED READER REFUSES A NON-KEY rather than handing a cipher an empty string. helperKeyFor
  // returns '' for "not a helper", and '' must never be treated as a key.
  assert.equal(readCheckinHelperCopy(e.tags, '', unseal), null, 'the reader accepted an empty key');
  assert.equal(readCheckinHelperCopy(e.tags, financeKey, unseal), null, 'the reader opened the copy with a books key');
});

test('NO SESSION KEY MEANS NO SECOND COPY — AND THE RECORD IS STILL WRITTEN', async () => {
  // ⚠ THE RULE THAT MATTERS MOST IN THIS SLICE. publishCheckin already returns null and publishes nothing
  // when the RING is empty; piece 1 must not add a second such path. A church with no service document for
  // today, or one whose envelope has not arrived, still checks children in — reference/DOMAIN.md and design
  // §10: nothing may stand between a child and the desk. What is lost is who else can open the record.
  const { api, events, stubs } = publishedCheckin({ finance: [financeKey, legacyKey], checkin: [checkinKey], ownerKey: true });
  assert.equal(stubs._ckSessionKeys.size, 0, 're-anchor: this fixture was supposed to hold no session keys');
  await api.publishCheckin({ id: 'ci-nokey', childName: 'Esther Ncube', code: '4417', session: SESSION, guardians: [] });
  assert.equal(events.length, 1,
    'A CHECK-IN WAS REFUSED BECAUSE NO SESSION KEY WAS AVAILABLE. That is the one thing this feature may ' +
    'never do: a child is at the door and the register did not record them');
  const e = events[0];
  assert.equal(tagOf(e, 'ck'), undefined, 'a ck tag was emitted with no key to seal it under, so it is write-only garbage');
  assert.equal(tagOf(e, 'enc'), '1',
    'the marker claims a second copy that is not there. A record with no helper copy must be byte-identical ' +
    'to what this writer produced yesterday, which is what keeps a mixed corpus honest');
  assert.equal(JSON.parse(nip44.decrypt(e.content, unhex(checkinKey))).code, '4417',
    'and the church cannot read its own register');

  // AND A SESSION-LESS RECORD IS THE SAME — a church running three rooms off one service, or none at all.
  events.length = 0;
  stubs._ckSessionKeys.set(SESSION, hex(webcrypto.getRandomValues(new Uint8Array(32))));
  await api.publishCheckin({ id: 'ci-nosess', childName: 'Esther Ncube', code: '4417', guardians: [] });
  assert.equal(events.length, 1, 'a record with no session was refused');
  assert.equal(tagOf(events[0], 'ck'), undefined,
    'a record with no session got a helper copy anyway — sealed under some other session\'s key, which is a ' +
    'record one set of helpers can open and the church did not intend');
  assert.equal(tagOf(events[0], 'enc'), '1', 'and the marker was bumped for a copy that is not there');
});

test('THE WRITER SEALS UNDER THIS SESSION\'S KEY OR NONE — never under whichever one it happens to hold', async () => {
  // ⚠ FOUND BY SABOTAGE, NOT BY DESIGN, and it is the gap worth recording. Making _encSealedCopies fall back
  // to "any session key in the map" when the named session has none passed EVERY other test in this file:
  // the positives always hold exactly the right key, and the no-key case holds none at all. So the one shape
  // nothing covered was the console holding SOME OTHER Sunday's key — which is the ordinary state of a
  // console two weeks into a fortnight's horizon.
  //
  // What it would cost: a record for the morning session sealed under the evening session's key. Every helper
  // cleared for the evening reads the morning's register, and no gate anywhere notices — the relay checks
  // that they are an in-window helper of the session THEY name, and the ciphertext is what decides the rest.
  const pmKey = hex(webcrypto.getRandomValues(new Uint8Array(32)));
  const { api, events, stubs } = publishedCheckin({ finance: [financeKey, legacyKey], checkin: [checkinKey], ownerKey: true });
  stubs._ckSessionKeys.set(OTHER_SESSION, pmKey);           // we hold the EVENING key…
  await api.publishCheckin({ id: 'ci-am', childName: 'Esther Ncube', code: '4417',
    session: SESSION, guardians: [] });                     // …and write a MORNING record
  assert.equal(events.length, 1, 'the record was refused, which is the one thing this feature may never do');
  const e = events[0];
  assert.equal(tagOf(e, 'ck'), undefined,
    'A RECORD WAS SEALED UNDER A DIFFERENT SESSION\'S KEY. Every helper cleared for that other session can ' +
    'now read this one\'s register, which is precisely the narrowing per-session keys exist to provide');
  assert.equal(tagOf(e, 'enc'), '1', 'and the marker claims a second copy that nobody the church intended can open');
  // The evening's helper must get nowhere with the morning's record, checked through the shipped reader.
  const pmEnvelope = envelopeFor(OTHER_SESSION, [other.pub], pmKey);
  assert.equal(readCheckinHelperCopy(e.tags, keyAsSeenBy(pmEnvelope, other), unseal), null,
    'the evening session\'s helper opened a morning record');
  // …and the church can still read it, because that half never depended on a session key.
  assert.equal(JSON.parse(nip44.decrypt(e.content, unhex(checkinKey))).code, '4417');
});

test('THE SECOND WRITER INHERITS IT — migrateCheckinKeys cannot strip the helper copy off a re-keyed record', async () => {
  // ⚠ THE TRAP THE SCOPE NOTE NAMES. `trinityone/checkin:` HAS TWO WRITERS: publishCheckin, and
  // migrateCheckinKeys — which re-publishes an existing body onto the safeguarding key AUTOMATICALLY, on a
  // 1200 ms timer from app/stew-dashboard.jsx, with no user action. A migration that did not re-emit this tag
  // would silently strip the helper's copy off every record it touched: the register stays visible to the
  // church and quietly stops being readable by the helper, with nothing on screen to look at.
  //
  // IT IS PREVENTED STRUCTURALLY RATHER THAN BY REMEMBERING, and that is what this test pins. The derivation
  // lives inside encPublish, which is the ONLY way either writer reaches the wire — so migrate gets the tag
  // without knowing it exists. Two assertions, because either alone can be satisfied by the wrong thing:
  const sessionKey = hex(webcrypto.getRandomValues(new Uint8Array(32)));
  const { api, events, stubs } = publishedCheckin({ finance: [financeKey, legacyKey], checkin: [checkinKey], ownerKey: true });
  stubs._ckSessionKeys.set(SESSION, sessionKey);

  // 1. encPublish ITSELF emits it — driven exactly as migrateCheckinKeys drives it, with a body recovered
  //    from a decrypted record rather than through publishCheckin.
  const recovered = { id: 'ci-old', childName: 'Esther Ncube', code: '4417', session: SESSION, guardians: [], date: '2026-08-20' };
  await api.encPublish('trinityone/checkin:ci-old', recovered, 'checkin');
  assert.equal(events.length, 1, 're-anchor: encPublish published nothing');
  assert.ok(tagOf(events[0], 'ck'),
    'A RE-KEYED RECORD LOST ITS HELPER COPY. migrateCheckinKeys re-publishes through this exact call, on a ' +
    'timer, for every record still on the legacy key — so this is every record in a migrating church going ' +
    'quietly unreadable to the helper who wrote it');
  assert.equal(readCheckinHelperCopy(events[0].tags, sessionKey, unseal).code, '4417',
    'the re-keyed record carries a ck tag that does not open');

  // 2. …and the migration really does go through it, rather than building its own event. If it ever stopped,
  //    assertion 1 would still pass while the product silently regressed.
  const mig = fnBody(VENDOR, 'async migrateCheckinKeys(timeoutMs) {', 'migrateCheckinKeys');
  assert.match(mig, /window\.Steward\.encPublish\(PRE \+ id, rec, "checkin"\)/,
    're-anchor: migrateCheckinKeys no longer re-publishes through encPublish, so it no longer inherits the ' +
    'helper copy and needs its own test');
  assert.doesNotMatch(mig, /finalizeEvent|_publishToRelays/,
    'migrateCheckinKeys has started building its own event instead of going through encPublish, which is ' +
    'how the two writers come to disagree about what a check-in record carries');
});

test('THE DERIVATION IS A NO-OP FOR EVERY OTHER KIND — encPublish is shared with five other call sites', async () => {
  // app/stew-finance.jsx x4 and src/steward-manna.src.js publish through the same function. A `ck` tag on a
  // ledger entry would be a second ciphertext of the church's accounts, sealed under a children's session
  // key, and nothing would ever read it.
  const sessionKey = hex(webcrypto.getRandomValues(new Uint8Array(32)));
  const { api, events, stubs } = publishedCheckin({ finance: [financeKey, legacyKey], checkin: [checkinKey], ownerKey: true });
  stubs._ckSessionKeys.set(SESSION, sessionKey);
  // A ledger-shaped body that HAS a `session` field, which is the case that would slip through a check on the
  // body instead of on the kind.
  await api.encPublish('finance/journal:7', { id: '7', amount: 2500, session: SESSION }, 'finance');
  assert.equal(events.length, 1, 're-anchor: the finance publish went nowhere');
  assert.equal(tagOf(events[0], 'ck'), undefined,
    'A LEDGER ENTRY WAS GIVEN A CHECK-IN HELPER\'S COPY. encPublish is shared, so the second copy has to be ' +
    'gated on the KIND and not on what the body happens to contain');
  assert.equal(tagOf(events[0], 'enc'), '1', 'and the marker was bumped on a document with no second copy');
  assert.equal(tagOf(events[0], 'session'), undefined, 're-anchor: the cleartext tag derivation has stopped being checkin-only too');
});


// ── AND THE POINT OF USE FOR THE READER: THE REGISTER THE SCREEN RENDERS ──────────────────────────────────
// The tests above prove readCheckinHelperCopy opens the tag. This proves the CONSOLE'S REGISTER does — the
// array `subscribeCheckins` emits, which `window.useStewardCheckins` hands to DashCheckin and which becomes
// the rows a leader reads names off. A reader function nothing consults is not a feature (CLAUDE.md rule 1),
// and until this test the fallback in encSubscribe's take() was exactly that.
//
// THE SHIPPED encSubscribe IS EXECUTED, not text-matched: its pool is captured, and it is fed the very event
// the shipped writer in this harness produced.
function registerFrom(h, events) {
  let rows = null;
  const stop = h.api.encSubscribe('trinityone/checkin:', (r) => { rows = r; }, 'checkin');
  const sub = h.subs[h.subs.length - 1];
  assert.ok(sub, 'the lifted encSubscribe never opened a subscription — the pool stub was not reached, so ' +
    'this harness is running nothing');
  for (const e of events) sub.handlers.onevent({ ...e, pubkey: church.pub, created_at: e.created_at || 1787280000 });
  sub.handlers.oneose();
  stop();
  assert.ok(Array.isArray(rows), 'the shipped subscription emitted nothing at all, not even an empty list');
  return rows;
}

test('POINT OF USE: A CONSOLE WITH NO RING BUT A SESSION KEY STILL SEES THE REGISTER', async () => {
  // WHO THIS IS FOR, and it is a real person in a real state rather than a contrivance: a DELEGATED
  // SAFEGUARDING STEWARD whose `checkinkey:` envelope has not arrived — or never will, because the church has
  // not re-wrapped it since granting them — but who holds a session key from that envelope's KEEPER SLOT.
  // Before piece 1 such a steward saw an empty register with every record sitting in encSubscribe's holding
  // pen and nothing on screen to explain it. The piece-3 audit recorded those keeper slots as "written and
  // never read by any code path"; this is the path that reads them.
  const sessionKey = hex(webcrypto.getRandomValues(new Uint8Array(32)));

  // 1. THE CHURCH WRITES THE RECORD, ring and all — the shipped writer, real crypto.
  const desk = publishedCheckin({ finance: [financeKey, legacyKey], checkin: [checkinKey], ownerKey: true });
  desk.stubs._ckSessionKeys.set(SESSION, sessionKey);
  await desk.api.publishCheckin({ id: 'ci-am', childName: 'Esther Ncube', code: '4417', session: SESSION,
    guardians: [], date: '2026-08-20' });
  const record = desk.events[0];
  assert.ok(tagOf(record, 'ck'), 'fixture: the writer produced no helper copy, so this proves nothing');

  // 2. A CONSOLE THAT HOLDS NO REGISTER RING AT ALL, but does hold the session key.
  const delegate = publishedCheckin({ finance: [], checkin: [], ownerKey: false });
  assert.equal(delegate.api.encOpen('checkin', record.content), null,
    're-anchor: this console can open `content` after all, so the fallback is not what is being tested');
  const blind = registerFrom(delegate, [record]);
  assert.deepEqual(blind, [],
    're-anchor: a console with neither key produced a register row, so nothing below is about the session key');

  // 3. …AND THE SAME CONSOLE ONCE ITS SESSION KEY ARRIVES.
  const helperSide = publishedCheckin({ finance: [], checkin: [], ownerKey: false });
  helperSide.stubs._ckSessionKeys.set(SESSION, sessionKey);
  const rows = registerFrom(helperSide, [record]);
  assert.equal(rows.length, 1,
    'THE REGISTER IS EMPTY FOR A CONSOLE THAT HOLDS THE SESSION KEY. The record was served, the key was ' +
    'held, and the row never reached the screen — which looks exactly like "no children are checked in", ' +
    'the failure DashCheckin already carries a comment about');
  assert.equal(rows[0].code, '4417', 'the row arrived without the pickup code, which is the field the door needs');
  assert.equal(rows[0].childName, 'Esther Ncube');
  assert.equal(rows[0].id, 'ci-am',
    'the row is keyed by something other than the record\'s own address, which forks it — the same child ' +
    'present on one row and collected on another');
});

test('…AND THE HOLDING PEN KEEPS THE TAGS, so a record parked before its key arrives still opens', async () => {
  // THE HALF THAT IS EASY TO MISS AND HARD TO NOTICE. take() is called from TWO places: a live delivery, and
  // a retry once a key lands. The pen between them stored only { content, ts } — so had the tags not been
  // added to it, the fallback would work on a live delivery and silently not on a retry, which is the commoner
  // path on a cold start (the documents and the envelopes race, and the documents usually win).
  const sessionKey = hex(webcrypto.getRandomValues(new Uint8Array(32)));
  const desk = publishedCheckin({ finance: [financeKey, legacyKey], checkin: [checkinKey], ownerKey: true });
  desk.stubs._ckSessionKeys.set(SESSION, sessionKey);
  await desk.api.publishCheckin({ id: 'ci-am', childName: 'Esther Ncube', code: '4417', session: SESSION, guardians: [] });
  const record = desk.events[0];

  // The record arrives FIRST, with no key held: it goes into the pen.
  const late = publishedCheckin({ finance: [], checkin: [], ownerKey: false });
  let rows = null;
  const stop = late.api.encSubscribe('trinityone/checkin:', (r) => { rows = r; }, 'checkin');
  const sub = late.subs[late.subs.length - 1];
  sub.handlers.onevent({ ...record, pubkey: church.pub, created_at: 1787280000 });
  sub.handlers.oneose();
  assert.deepEqual(rows, [], 're-anchor: the record opened straight away, so it was never in the pen');

  // NOW the envelope lands, the key is learned, and the ring-changed waiter fires the retry — exactly as
  // subscribeCapKey's _capRingChanged does in the product.
  late.stubs._ckSessionKeys.set(SESSION, sessionKey);
  assert.equal(late.stubs._capWaiters.checkin.size, 1,
    're-anchor: encSubscribe registered no retry, so nothing here can be triggered');
  for (const fn of late.stubs._capWaiters.checkin) fn();
  stop();
  assert.equal(rows.length, 1,
    'A RECORD PARKED IN THE HOLDING PEN NEVER OPENED, even once its key arrived. The pen must carry the tags ' +
    'as well as the content, or the helper copy is reachable only on a live delivery — and on a cold start ' +
    'the documents beat the envelopes, so the retry is the usual path');
  assert.equal(rows[0].code, '4417');
});

test('POINT OF USE: THE READER ROUTES BY SESSION — the right key filed under the WRONG session opens nothing', async () => {
  // ⚠ THE READER HALF OF THE CROSS-SESSION LEAK, and it was unguarded until this test. The writer half is
  // covered ('THE WRITER SEALS UNDER THIS SESSION'S KEY OR NONE'); reintroducing the SAME fallback in
  // _encOpenSealedCopy instead — `_ckSessionKeys.get(sid) || [..._ckSessionKeys.values()][0]` — passed every
  // other test in this file. That is the direction that leaks: it hands a morning register to an evening
  // helper on the READ side, where no writer decision is involved at all.
  //
  // WHY EVERYTHING ELSE WAS BLIND TO IT. Every other fixture here files the key under the record's OWN
  // session, so routing and "try everything" are indistinguishable. The reader-side negative above
  // ('…AND A HELPER CLEARED FOR A DIFFERENT SESSION OPENS NOTHING') calls readCheckinHelperCopy directly with
  // the wrong key BY HAND, which proves the cipher refuses a wrong key — never in doubt — and says nothing
  // about whether the routing picked the right one. This is the same vacuity shape as the `unseal`-that-throws
  // finding one layer up: a negative that passes because the crypto happened to fail, not because a rule held.
  //
  // THE ONE CONSTRUCTION THAT SEPARATES THEM: the console holds THE VERY KEY THE RECORD IS SEALED WITH, filed
  // under a DIFFERENT session id. The cipher cannot save us here — that key opens the tag perfectly. Only the
  // lookup by session id stands between the record and the screen. Asserted through registerFrom, so the
  // decision is made by the shipped encSubscribe, not by a parser call of the test's own.
  const amKey = hex(webcrypto.getRandomValues(new Uint8Array(32)));

  // The morning record, sealed under the morning key by the shipped writer.
  const desk = publishedCheckin({ finance: [financeKey, legacyKey], checkin: [checkinKey], ownerKey: true });
  desk.stubs._ckSessionKeys.set(SESSION, amKey);
  await desk.api.publishCheckin({ id: 'ci-am', childName: 'Esther Ncube', code: '4417', session: SESSION,
    guardians: [], date: '2026-08-20' });
  const record = desk.events[0];
  assert.ok(tagOf(record, 'ck'), 'fixture: the writer produced no helper copy, so this proves nothing');
  assert.equal(checkinSessionOf(record.tags), SESSION,
    'fixture: the record does not name the morning session, so the lookup under test is not the one exercised');

  // THE EVENING CONSOLE — holding the morning's key, but filed under the evening session. This is not a
  // contrived state: it is what a console has after the evening envelope arrives and the morning one is
  // re-wrapped, or simply after any two sessions' keepers overlap.
  const evening = publishedCheckin({ finance: [], checkin: [], ownerKey: false });
  evening.stubs._ckSessionKeys.set(OTHER_SESSION, amKey);
  assert.equal(evening.api.encOpen('checkin', record.content), null,
    're-anchor: this console can open `content`, so the row below would not come from the helper copy');
  assert.equal(readCheckinHelperCopy(record.tags, amKey, unseal)?.code, '4417',
    're-anchor: the key this console holds does NOT open the tag, so the cipher would refuse it anyway and ' +
    'this fixture cannot tell routing from a lucky failure — which is the whole point of it');

  const rows = registerFrom(evening, [record]);
  assert.deepEqual(rows, [],
    'A CONSOLE OPENED A RECORD FROM A SESSION IT HOLDS NO KEY FOR. The reader tried a key it holds for a ' +
    'DIFFERENT session and it happened to fit, so the evening\'s helpers now read the morning\'s register — ' +
    'names, pickup codes and guardians for children they were never cleared for. Nothing else notices: the ' +
    'relay only checks that the reader is an in-window helper of the session THEY name, and the ciphertext ' +
    'decides the rest. _encOpenSealedCopy must look up ONLY checkinSessionOf(tags) and refuse when that ' +
    'session has no key');

  // …AND THE SAME CONSOLE, ONE MAP ENTRY DIFFERENT, DOES SEE IT — so the emptiness above is the session
  // lookup refusing, not this harness failing to deliver anything at all.
  const morning = publishedCheckin({ finance: [], checkin: [], ownerKey: false });
  morning.stubs._ckSessionKeys.set(SESSION, amKey);
  assert.equal(registerFrom(morning, [record]).length, 1,
    're-anchor: filed under the RIGHT session the same key still produced no row, so the assertion above ' +
    'passes for the wrong reason and proves nothing about routing');
});


// ── AND WHERE THE KEY COMES FROM IN THE FIRST PLACE ───────────────────────────────────────────────────────
// Every test above SEEDS `_ckSessionKeys`, which is the right shape for asking "what does the writer do with
// a key it holds" — but it means none of them exercises the one line that puts a key there. That line is
// inside subscribeCheckinSessionKeys' onevent, it unwraps OUR OWN slot out of a real envelope, and IT WAS
// WRITTEN WRONG FIRST TIME:
//
//     const mine = c.keys[pub];   nip44d(mine, nip44ck(sk, pub))        ← wrong
//     const mine = c.keys[churchPub];   nip44d(mine, nip44ck(sk, e.pubkey))   ← right
//
// `churchPub` IS THIS CONSOLE'S OWN KEY AND `pub` IS NOT. In delegated mode `pub` is the CHURCH's key and
// `churchPub` is the steward's own; for an OWNER they are the same pubkey — so the wrong version worked
// perfectly for every owner console and silently recovered nothing for every delegate. That is the shape of
// bug this codebase keeps producing, and the reason it survives review is that the owner path is the one
// anybody tests. So both are driven here.
function sessionKeysFrom({ delegated }) {
  const h = publishedCheckin({ finance: [], checkin: [], ownerKey: !delegated });
  // A DELEGATE'S CONSOLE, as setActiveIdentity leaves it: `pub` is the CHURCH, `churchPub` is this console's
  // OWN key, `sk` is this console's own secret. (For an owner the harness already has all three as the
  // church.) The naming is historical and is the trap this test exists for.
  if (delegated) { h.stubs.pub = church.pub; h.stubs.churchPub = delegated.pub; h.stubs.sk = delegated.sk; }
  const read = new Function('scope', `with (scope) { return ({ ${fnBody(VENDOR, 'subscribeCheckinSessionKeys(cb) {', 'subscribeCheckinSessionKeys')} }).subscribeCheckinSessionKeys; }`)(h.scope);
  const stop = read.call({}, () => {});
  const sub = h.subs[h.subs.length - 1];
  assert.ok(sub, 'the lifted subscription never opened one — this harness is running nothing');
  return { h, sub, stop };
}

test('THE SESSION KEY IS RECOVERED FROM OUR OWN SLOT — for the owner AND for a delegate', async () => {
  const sessionKey = hex(webcrypto.getRandomValues(new Uint8Array(32)));
  const lead = (() => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; })();

  // ONE REAL ENVELOPE, wrapped by the SHIPPED builder to the church AND to a safeguarding steward — which is
  // exactly what publishCheckinHelpers produces (`keepers = [cp, ...stewards.filter(allowed)]`).
  const content = (() => {
    const built = buildHelperGrant({ session: SESSION, source: GRANT_SOURCE, lifetime: 'session',
      from: AT - 3600, until: AT + 3600, helpers: [helper.pub], keepers: [church.pub, lead.pub],
      sessionKeyHex: sessionKey,
      wrap: (p2, pt) => nip44.encrypt(pt, nip44.utils.getConversationKey(church.sk, p2)) });
    assert.deepEqual(built.failed, [], 'fixture: the shipped builder could not wrap somebody');
    assert.ok(built.doc.keys[church.pub] && built.doc.keys[lead.pub],
      'fixture: the envelope has no slot for the church or for the lead, so this proves nothing');
    return JSON.stringify(built.doc);
  })();
  const envelope = { pubkey: church.pub, created_at: AT - 60, content,
    tags: [['d', D.CHECKINHELPER + SESSION], ['t', 'trinityone'], ['church', church.pub], ['session', SESSION]] };

  // ── THE OWNER CONSOLE ──
  const own = sessionKeysFrom({ delegated: null });
  own.sub.handlers.onevent(envelope);
  own.sub.handlers.oneose();
  own.stop();
  assert.equal(own.h.stubs._ckSessionKeys.get(SESSION), sessionKey,
    'THE OWNER CONSOLE DID NOT RECOVER THE SESSION KEY from an envelope it signed itself. Nothing can seal a ' +
    'helper copy after this: publishCheckin looks the key up in exactly this map');

  // ── A DELEGATED SAFEGUARDING STEWARD'S CONSOLE — the case the first version got wrong ──
  const del = sessionKeysFrom({ delegated: lead });
  del.sub.handlers.onevent(envelope);
  del.sub.handlers.oneose();
  del.stop();
  assert.equal(del.h.stubs._ckSessionKeys.get(SESSION), sessionKey,
    'A DELEGATED STEWARD RECOVERED NO SESSION KEY from their OWN keeper slot. `pub` is the CHURCH on a ' +
    'delegate\'s console and `churchPub` is their own key — reading keys[pub] there fetches the CHURCH\'S ' +
    'slot and tries to open it with the delegate\'s conversation key, which fails silently and leaves the ' +
    'keeper slots as decorative as the piece-3 audit found them');

  // ── AND A CONSOLE WITH NO SLOT AT ALL RECOVERS NOTHING, rather than something. The negative that stops
  // both assertions above passing on a harness that simply writes the key whatever arrives.
  const stranger = (() => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; })();
  const out = sessionKeysFrom({ delegated: stranger });
  out.sub.handlers.onevent(envelope);
  out.sub.handlers.oneose();
  out.stop();
  assert.equal(out.h.stubs._ckSessionKeys.size, 0,
    'a console the church never wrapped a slot to recovered the session key anyway');
});

test('…AND A STAND-DOWN FORGETS IT — the envelope was the only place that key existed', async () => {
  // revokeCheckinHelpers replaces the envelope with a tombstone, and the envelope was the only copy of the
  // key. So after a stand-down NOBODY can open that session's helper copies, the church included — and a
  // console keeping a stale copy in memory would go on sealing NEW records under a key it can no longer
  // re-derive after a reload, which is write-only garbage by any other name.
  const sessionKey = hex(webcrypto.getRandomValues(new Uint8Array(32)));
  const built = buildHelperGrant({ session: SESSION, source: GRANT_SOURCE, lifetime: 'session',
    from: AT - 3600, until: AT + 3600, helpers: [helper.pub], keepers: [church.pub], sessionKeyHex: sessionKey,
    wrap: (p2, pt) => nip44.encrypt(pt, nip44.utils.getConversationKey(church.sk, p2)) });
  const base = { pubkey: church.pub, content: JSON.stringify(built.doc),
    tags: [['d', D.CHECKINHELPER + SESSION], ['t', 'trinityone'], ['church', church.pub], ['session', SESSION]] };

  const s2 = sessionKeysFrom({ delegated: null });
  s2.sub.handlers.onevent({ ...base, created_at: AT - 120 });
  assert.equal(s2.h.stubs._ckSessionKeys.get(SESSION), sessionKey, 'fixture: the key was never learned');
  s2.sub.handlers.onevent({ ...base, created_at: AT - 60, content: '',
    tags: [...base.tags, ['deleted', '1']] });
  s2.stop();
  assert.equal(s2.h.stubs._ckSessionKeys.has(SESSION), false,
    'A STOOD-DOWN SESSION\'S KEY IS STILL IN MEMORY. Every record written after this is sealed under a key ' +
    'that exists nowhere else — unopenable by anyone, including this console, the moment it reloads');
});
