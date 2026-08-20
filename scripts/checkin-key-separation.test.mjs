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
import { fnBody, stripComments } from './test-slice.mjs';

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
  for (const line of m[1].split('\n')) {
    const e = line.match(/(\w+):\s*\{\s*d:\s*"([^"]+)",\s*cap:\s*"([^"]+)",\s*legacy:\s*(true|false)/);
    if (e) out[e[1]] = { d: e[2], cap: e[3], legacy: e[4] === 'true' };
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
  };
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      const b = String(k).replace(/[0-9]+$/, ''); if (b in t) return t[b];
      throw new ReferenceError('needs a stub for ' + String(k)); },
  });
  // All three lifted together into ONE object, so publishCheckin's `window.Steward.encPublish` really is the
  // shipped encPublish, and encPublish's `encSeal` really is the shipped encSeal.
  const src = ['publishCheckin(rec)', 'encPublish(dtag', 'encSeal(kind']
    .map((sig, i) => fnBody(VENDOR, sig, ['publishCheckin', 'encPublish', 'encSeal'][i])).join(',\n');
  const api = new Function('scope', `with (scope) { return { ${src} }; }`)(scope);
  Object.assign(stubs.window.Steward, api);
  return { api, events };
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
  assert.match(src, /subscribeCheckins\(cb\)\s*\{\s*return[^\n]*encSubscribe\([^\n]*['"]checkin['"]\)/,
    'subscribeCheckins reads with the books\' ring');
});

test('the relay refuses a check-in write from anyone but the church or a SAFEGUARDING steward', () => {
  // Addressable docs REPLACE on write. Before this rule, `checkin:<id>` fell to the member catch-all, so any
  // member of the church could overwrite a child's presence record with anything and it would vanish from the
  // register. Reading it was never possible; destroying it needed no key at all.
  const gw = stripComments(GW);
  const rule = gw.match(/if \(d\.startsWith\(CHECKIN_D\)\)[^\n]*/);
  assert.ok(rule, 'the relay has no rule for checkin: docs, so they fall to the member catch-all and any ' +
    'member of the church can overwrite a child\'s check-in record');
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
