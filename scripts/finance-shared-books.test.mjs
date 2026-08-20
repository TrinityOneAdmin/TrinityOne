// THE CHURCH BOOKS MUST BE SHAREABLE WITHOUT HANDING OVER THE CHURCH KEY.
// Run: node --test scripts/finance-shared-books.test.mjs
//
// Finance was sealed with nip44(churchSk, churchPub) — the church key talking to itself — so only a console
// holding that key could read or write it. Under a delegated steward the writes were refused and the reads
// returned nothing, and the module then silently re-seeded an EMPTY book on reload. That data loss is why
// Finance was hidden from delegates outright (audit 2026-07-06 #3), and why an owner could grant the finance
// capability and their treasurer would still find no Finance tab, with nothing explaining it.
//
// The fix is the envelope this codebase already uses for care, names, media and groups: a key of the books'
// own, wrapped to each reader. Owner-only to mint — a treasurer who could re-key the books could lock the
// church out of its own ledger.
//
// AND THE RING IS WHAT AVOIDS A MIGRATION. The envelope carries [newKey, legacySelfKey]. The legacy key is
// exactly nip44(churchSk, churchPub), which every existing entry is already sealed with — so a delegate
// handed the ring reads the whole history from before they existed, and not one entry is re-encrypted. The
// journal is append-only and relay-sequenced; rewriting it to migrate would be the worst possible answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { fnBody, stripComments } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
const hex = (u8) => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/.{1,2}/g).map(b => parseInt(b, 16)));

const church = (() => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; })();

// Lift encSelf/decSelf together with the ring they read, and run them for real — the question is whether a
// delegate holding the ring can open what the owner sealed, and only the actual ciphertext answers it.
function books({ ring, ownerKey }) {
  const stubs = {
    _finRing: ring,
    churchSk: ownerKey ? church.sk : null,
    churchPub: church.pub,
    actingChurch: ownerKey ? '' : church.pub,
    churchSkHeld: () => !!ownerKey,
    // esbuild renames these on the way into the bundle (nip44e -> encrypt3, nip44ck -> getConversationKey),
    // and the proxy's trailing-digit fallback only helps if the BASE name is stubbed. Stub both spellings.
    nip44e: (plain, key) => nip44.encrypt(plain, key),
    nip44d: (ct, key) => nip44.decrypt(ct, key),
    nip44ck: (a, b) => nip44.utils.getConversationKey(a, b),
    encrypt: (plain, key) => nip44.encrypt(plain, key),
    decrypt: (ct, key) => nip44.decrypt(ct, key),
    getConversationKey: (a, b) => nip44.utils.getConversationKey(a, b),
    _unhex: unhex, _hex: hex, crypto: webcrypto,
  };
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      // esbuild suffixes renamed imports (encrypt -> encrypt3). Without this the lookup throws, encSelf's
      // own try/catch swallows it, and the function quietly returns null — which reads exactly like "this
      // console cannot write the books" and cost half an hour.
      const base = String(k).replace(/[0-9]+$/, '');
      if (base in t) return t[base];
      throw new ReferenceError('needs a stub for ' + String(k));
    },
  });
  const mk = (name) => new Function('scope', `with (scope) { return ({ ${fnBody(VENDOR, name + '(', name)} }).${name}; }`)(scope);
  return { encSelf: mk('encSelf'), decSelf: mk('decSelf') };
}

const legacyKey = hex(nip44.utils.getConversationKey(church.sk, church.pub));
const freshKey = hex(webcrypto.getRandomValues(new Uint8Array(32)));

test('a delegate holding the ring reads the books the OWNER wrote before they existed', () => {
  // the owner, before any envelope: sealed with the legacy self-key
  const ownerBefore = books({ ring: [], ownerKey: true });
  const old = ownerBefore.encSelf({ memo: 'Gift day offering', amount: 240 });
  assert.ok(old, 're-anchor: an owner with no envelope can no longer write the books at all');

  // the treasurer, holding [new, legacy]
  const treasurer = books({ ring: [freshKey, legacyKey], ownerKey: false });
  assert.deepEqual(treasurer.decSelf(old), { memo: 'Gift day offering', amount: 240 },
    'the ring does not open entries written before the envelope existed. Every church with books already ' +
    'kept would hand its treasurer an empty ledger, which is exactly the data loss this replaces.');
});

test('and what the delegate writes, the owner can read', () => {
  const treasurer = books({ ring: [freshKey, legacyKey], ownerKey: false });
  const entry = treasurer.encSelf({ memo: 'Hall hire', amount: -75 });
  assert.ok(entry, 'a delegate holding the books key still cannot write an entry');
  const owner = books({ ring: [freshKey, legacyKey], ownerKey: true });
  assert.deepEqual(owner.decSelf(entry), { memo: 'Hall hire', amount: -75 },
    'the church cannot read its own treasurer\'s entries');
});

test('someone with NO ring reads nothing — the books are not merely hidden in the UI', () => {
  const treasurer = books({ ring: [freshKey, legacyKey], ownerKey: false });
  const entry = treasurer.encSelf({ memo: 'Hall hire', amount: -75 });
  const stranger = books({ ring: [], ownerKey: false });
  assert.equal(stranger.decSelf(entry), null,
    'a steward without the finance capability can still decrypt the ledger, so the capability is a UI ' +
    'preference rather than a protection');
});

test('the owner keeps writing with the CURRENT key once an envelope exists', () => {
  const owner = books({ ring: [freshKey, legacyKey], ownerKey: true });
  const entry = owner.encSelf({ memo: 'Rent', amount: -900 });
  assert.deepEqual(nip44.decrypt(entry, unhex(freshKey)), JSON.stringify({ memo: 'Rent', amount: -900 }),
    'the owner is still sealing with the legacy self-key, so anything they write is unreadable to the very ' +
    'treasurer they just granted access to');
});

test('minting stays with the owner', () => {
  const body = stripComments(fnBody(VENDOR, 'async ensureFinanceKeyFor(stewardPubs, caps) {', 'ensureFinanceKeyFor'));
  assert.match(body, /if \(!churchSkHeld\(\) \|\| actingChurch\) return false/,
    'a delegated steward can mint or rotate the books key — so a treasurer could re-key the ledger and lock ' +
    'the church out of its own accounts');
  assert.match(body, /_isRelayAuthed\(\)/,
    'the mint gate does not check that the relay actually answered us. Concluding "no envelope exists" from ' +
    'an unauthenticated read is how key envelopes get minted twice and orphan what the first one sealed.');
  // quote-agnostic: the bundler rewrites single quotes to double on the way in
  assert.match(body, /indexOf\(["']finance["']\)/, 'the envelope is wrapped to stewards the church never gave finance to');
});

test('a delegate writes as themselves, with the church named', () => {
  const body = stripComments(fnBody(VENDOR, 'encPublish(dtag, obj) {', 'encPublish'));
  assert.match(body, /feChurch\(/,
    'encPublish signs with the church key, which a delegate does not hold — every write refused, and the ' +
    'module then re-seeds an empty book from the empty read');
  assert.doesNotMatch(body, /finalizeEvent\([^)]*churchSk/, 're-anchor: the old church-key signature is back');
});

test('the reader watches for steward-authored entries too', () => {
  const body = stripComments(fnBody(VENDOR, 'encSubscribe(prefix, cb) {', 'encSubscribe'));
  assert.match(body, /["']#church["']: \[cp\]/,   // the bundler normalises quotes
    'only church-authored documents are read, so a treasurer\'s own entries are invisible to everyone ' +
    'including themselves');
  assert.match(body, /_careRoster\.has\(e\.pubkey\)/,
    'any author\'s document is accepted into the book as long as it is church-tagged — a revoked steward, or ' +
    'anyone at all, could write the church\'s ledger as far as this reader is concerned');
});

test('Finance is offered to a capable delegate, and padlocked for the rest', () => {
  const src = stripComments(DASH);
  assert.match(src, /const finOn = !!window\.DashFinance && stewCapState\('finance'\)\.allowed;/,
    'Finance is still hidden from every delegate regardless of what their church granted them');
});

// ── AND TAKING FINANCE AWAY MUST TAKE THE BOOKS AWAY ──────────────────────────────────────────────────────
// Sharing the books was built on 2026-08-19 without rotation: removing a treasurer rewrote the envelope
// without them and left the KEY unchanged, so they carried on reading — including entries written after they
// left. The care key and the media key have rotated on removal for months. This is the same contract.
//
// The honest half, which the code comments carry too: rotation protects the FUTURE. Anyone who held the old
// key can still open everything written before it. What changes is that nothing they see afterwards is new.
test('only the owner rotates, and only when somebody has actually lost access', () => {
  const body = stripComments(fnBody(VENDOR, 'async rotateFinanceKey(stewardPubs, caps) {', 'rotateFinanceKey'));
  assert.match(body, /if \(!churchSkHeld\(\) \|\| actingChurch\) return false/,
    'a delegated steward can rotate the books key, which would let a treasurer re-key the ledger away from ' +
    'the church that owns it');
  assert.match(body, /_isRelayAuthed\(\)/,
    'rotation can run on an unauthenticated read of the envelope — the same mistake that orphans key material');
  assert.match(body, /slice\(0, 12\)/, 'the ring is unbounded, so an envelope can grow past what a relay accepts');

  const ensure = stripComments(fnBody(VENDOR, 'async ensureFinanceKeyFor(stewardPubs, caps) {', 'ensureFinanceKeyFor'));
  assert.match(ensure, /rotateFinanceKey/,
    'losing a treasurer still only rewrites the envelope, which changes nothing they can read');
});

// Drive the SHIPPED rotation, rather than modelling it. The first version of the two tests above built the
// rings by hand, so breaking the ring construction in the product left them green — the same flaw this repo
// keeps re-learning: a sabotage must run through the code under test or it proves only that the test passes.
function runRotate({ ring, allowed, caps }) {
    const published = [];
    const stubs = {
      churchSkHeld: () => true, actingChurch: '', _isRelayAuthed: () => true, _finChecked: true,
      _finRing: ring.slice(), _finRev: 1, _finDocKeys: null,
      pub: church.pub, sk: church.sk, churchPub: church.pub,
      crypto: webcrypto, _hex: hex, _unhex: unhex,
      encrypt: (p2, k) => nip44.encrypt(p2, k), decrypt: (c, k) => nip44.decrypt(c, k),
      getConversationKey: (a, b) => nip44.utils.getConversationKey(a, b),
      nip44e: (p2, k) => nip44.encrypt(p2, k), nip44ck: (a, b) => nip44.utils.getConversationKey(a, b),
      _sealEach: async (payload, want, seal) => { const out = {}; for (const w of want) out[w] = seal(payload, w); return out; },
      feChurch: (t) => t, publish: async (e) => { published.push(e); return e; },
      now: () => 1787280000, FINKEY_D: 'trinityone/financekey:', NET: 'trinityone',
      window: { Steward: {} },
    };
    const scope = new Proxy(stubs, {
      has: (t, k) => (k in t) || !(String(k) in globalThis),
      get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
        const b = String(k).replace(/[0-9]+$/, ''); if (b in t) return t[b];
        throw new ReferenceError('needs a stub for ' + String(k)); },
      set: (t, k, v) => { t[k] = v; return true; },
    });
    const body = fnBody(VENDOR, 'async rotateFinanceKey(stewardPubs, caps) {', 'rotateFinanceKey');
    const fn = new Function('scope', `with (scope) { return ({ ${body} }).rotateFinanceKey; }`)(scope);
    return { fn, published, stubs };
}

test('the SHIPPED rotation mints a new key and keeps the old ones', async () => {
  const treasurerSk = generateSecretKey(), treasurerPub = getPublicKey(treasurerSk);
  const oldKey = freshKey;
  const { fn, published, stubs } = runRotate({ ring: [oldKey, legacyKey] });
  await fn([treasurerPub], { [treasurerPub]: ['finance'] });
  assert.equal(published.length, 1, 'rotation published no new envelope');

  const env = JSON.parse(published[0].content);
  const mine = env.keys[treasurerPub];
  assert.ok(mine, 'the remaining treasurer was not given the new ring');
  const ring = JSON.parse(nip44.decrypt(mine, nip44.utils.getConversationKey(church.sk, treasurerPub)));

  assert.notEqual(ring[0], oldKey, 'rotation reused the same key, so nothing changed for anyone removed');
  assert.ok(ring.includes(oldKey), 'the superseded key was dropped, orphaning every entry written before now');
  assert.ok(ring.includes(legacyKey), 'the legacy key was dropped, orphaning the books written before sharing existed');
  assert.equal(env.rev, 2, 'the revision did not advance, so a lagging relay cannot tell which envelope is newer');
  void stubs;
});

test('the removed treasurer cannot read what is written after the rotation', async () => {
  // Drives rotateFinanceKey itself and then uses the ring it really published. The first version of this
  // test built both rings by hand: deleting the whole function left it green, which is no test at all.
  const keptSk = generateSecretKey(), keptPub = getPublicKey(keptSk);
  const goneSk = generateSecretKey(), gonePub = getPublicKey(goneSk);
  const oldRing = [freshKey, legacyKey];

  const { fn, published } = runRotate({ ring: oldRing });
  await fn([keptPub, gonePub], { [keptPub]: ['finance'], [gonePub]: ['care'] });   // gone lost finance
  const env = JSON.parse(published[0].content);
  assert.ok(!env.keys[gonePub], 'the removed treasurer was handed the new ring anyway');

  const keptRing = JSON.parse(nip44.decrypt(env.keys[keptPub], nip44.utils.getConversationKey(church.sk, keptPub)));
  const after = books({ ring: keptRing, ownerKey: false }).encSelf({ memo: 'Gas bill', amount: -140 });

  assert.equal(books({ ring: oldRing, ownerKey: false }).decSelf(after), null,
    'a treasurer whose Finance was taken away can still read entries written afterwards — the envelope was ' +
    'rewritten without them but the key never changed');
  assert.deepEqual(books({ ring: keptRing, ownerKey: false }).decSelf(after), { memo: 'Gas bill', amount: -140 },
    'the remaining treasurer lost access at the rotation');
  const before = books({ ring: oldRing, ownerKey: false }).encSelf({ memo: 'Harvest', amount: 310 });
  assert.deepEqual(books({ ring: keptRing, ownerKey: false }).decSelf(before), { memo: 'Harvest', amount: 310 },
    'rotation orphaned the ledger written before it — the superseded keys must stay in the ring');
});

test('a failed publish adopts nothing', async () => {
  // An offline minute used to leave the console sealing entries with a key that existed nowhere but that
  // tab's memory, and the next reload overwrote it. In an append-only journal that is unrecoverable.
  const treasurerPub = getPublicKey(generateSecretKey());
  const { fn, stubs } = runRotate({ ring: [freshKey, legacyKey] });
  stubs.publish = async () => false;                       // every relay refused
  const r = await fn([treasurerPub], { [treasurerPub]: ['finance'] });
  assert.equal(r, false, 'a refused rotation reported success');
  assert.deepEqual(stubs._finRing, [freshKey, legacyKey],
    'the console adopted a ring it never managed to publish, so everything it seals next is unreadable to ' +
    'everyone including itself after a reload');
});

test('rotation refuses until the envelope has actually been looked for', async () => {
  const treasurerPub = getPublicKey(generateSecretKey());
  const { fn, published, stubs } = runRotate({ ring: [freshKey, legacyKey] });
  stubs._finChecked = false;                               // subscription has not reached EOSE
  const r = await fn([treasurerPub], { [treasurerPub]: ['finance'] });
  assert.equal(r, false, 'rotated on an unfinished read of the corpus');
  assert.equal(published.length, 0, 'published an envelope before knowing what was already there');
});
