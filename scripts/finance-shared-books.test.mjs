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

// THE SHIPPED CAPABILITY TABLE, read out of the bundle rather than restated. Which capability seals what, and
// which one carries the legacy self-key, is the whole security question here — a copy in this file would go
// on agreeing with itself after someone changed the real one.
// The shipped who-gets-a-key predicate, lifted rather than stubbed. It is the single rule that decides
// whether someone receives a capability's key; a stub here would let this file agree with itself while the
// product handed the children's register to the wrong people.
const SHIPPED_CAP_ALLOWS = (() => {
  const m = VENDOR.match(/_capAllows = \(spec, caps\) => \(p2\) => \{[\s\S]*?\n  \};/);
  assert.ok(m, 're-anchor: _capAllows is not in the bundle under that name');
  return new Function('return ' + m[0].replace(/^_capAllows = /, ''))();
})();

const SHIPPED_CAP_KEYS = (() => {
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

test('the books carry the legacy key and the children\'s register does NOT', () => {
  // The one line of this design that decides whether a treasurer can read a child's pickup code. The legacy
  // self-key sealed everything encSelf ever wrote, so any capability whose ring contains it inherits every
  // other capability's history. Finance has to carry it — the ledger is append-only and the relay pins each
  // entry to an exact next sequence number, so its past cannot be re-keyed. Nothing else may.
  assert.equal(SHIPPED_CAP_KEYS.finance.legacy, true,
    'the books no longer carry the legacy key, so every entry written before the envelope existed is now ' +
    'unreadable — a church opening its accounts to an empty ledger');
  assert.equal(SHIPPED_CAP_KEYS.checkin.legacy, false,
    'the children\'s register carries the legacy self-key, which is the key the BOOKS ring also contains. ' +
    'Granting a treasurer Finance would hand them every child\'s name, room and pickup code.');
  assert.equal(SHIPPED_CAP_KEYS.checkin.cap, 'safeguarding',
    'the check-in key is handed out with the wrong capability');
});

// Lift encSeal/encOpen together with the rings they read, and run them for real — the question is whether a
// delegate holding a ring can open what the owner sealed, and only the actual ciphertext answers it.
//
// `rings` is per capability: { finance: [...], checkin: [...] }. It used to be a single `ring`, because a
// single key sealed everything — which is precisely the defect the check-in tests at the foot of this file
// now guard against.
function books({ ring, rings, ownerKey }) {
  const st = rings || { finance: ring || [], checkin: [] };
  const stubs = {
    _capState: {
      finance: { ring: st.finance || [], docKeys: null, rev: 1, at: 0, checked: false },
      checkin: { ring: st.checkin || [], docKeys: null, rev: 1, at: 0, checked: false },
    },
    // The legacy-fallback flag, read straight from the shipped table rather than restated here — if someone
    // marks check-in `legacy: true` this harness must start failing, not quietly agree with them.
    CAP_KEYS: JSON.parse(JSON.stringify(SHIPPED_CAP_KEYS)),
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
  const mk = (name) => new Function('scope', `with (scope) { return ({ ${fnBody(VENDOR, name + '(kind', name)} }).${name}; }`)(scope);
  const seal = mk('encSeal'), open = mk('encOpen');
  // encSelf/decSelf are the books' names for these. Bound here the same way the shipped wrappers bind them,
  // and asserted to BE that binding in 'the books are the finance capability, by name' below.
  return { seal, open, encSelf: (o) => seal('finance', o), decSelf: (c) => open('finance', c) };
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
  const body = stripComments(fnBody(VENDOR, 'async ensureCapKeyFor(kind, stewardPubs, caps) {', 'ensureCapKeyFor'));
  assert.match(body, /if \(!churchSkHeld\(\) \|\| actingChurch\) return false/,
    'a delegated steward can mint or rotate the books key — so a treasurer could re-key the ledger and lock ' +
    'the church out of its own accounts');
  assert.match(body, /_isRelayAuthed\(\)/,
    'the mint gate does not check that the relay actually answered us. Concluding "no envelope exists" from ' +
    'an unauthenticated read is how key envelopes get minted twice and orphan what the first one sealed.');
  // quote-agnostic: the bundler rewrites single quotes to double on the way in
  assert.match(body, /_capAllows\(spec, caps\)/,
    'the envelope is wrapped to stewards the church never gave this capability to — the grant is a UI ' +
    'preference rather than a key');
  // ...and the shared predicate really does gate on the capability, and honour the explicit-grant flag
  const pred = stripComments(VENDOR.match(/_capAllows = \(spec, caps\) => \(p2\) => \{[\s\S]*?\n  \};/)[0]);
  assert.match(pred, /indexOf\(spec\.cap\)/, 'the predicate does not check the capability at all');
  assert.match(pred, /spec\.explicit/,
    'the predicate ignores the explicit-grant flag, so an unscoped steward inherits the children\'s register');
});

test('a delegate writes as themselves, with the church named', () => {
  const body = stripComments(fnBody(VENDOR, 'encPublish(dtag, obj, kind) {', 'encPublish'));
  assert.match(body, /feChurch\(/,
    'encPublish signs with the church key, which a delegate does not hold — every write refused, and the ' +
    'module then re-seeds an empty book from the empty read');
  assert.doesNotMatch(body, /finalizeEvent\([^)]*churchSk/, 're-anchor: the old church-key signature is back');
});

test('the reader watches for steward-authored entries too', () => {
  const body = stripComments(fnBody(VENDOR, 'encSubscribe(prefix, cb, kind) {', 'encSubscribe'));
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
  const body = stripComments(fnBody(VENDOR, 'async rotateCapKey(kind, stewardPubs, caps) {', 'rotateCapKey'));
  assert.match(body, /if \(!churchSkHeld\(\) \|\| actingChurch\) return false/,
    'a delegated steward can rotate the books key, which would let a treasurer re-key the ledger away from ' +
    'the church that owns it');
  assert.match(body, /_isRelayAuthed\(\)/,
    'rotation can run on an unauthenticated read of the envelope — the same mistake that orphans key material');
  assert.match(body, /slice\(0, 12\)/, 'the ring is unbounded, so an envelope can grow past what a relay accepts');

  const ensure = stripComments(fnBody(VENDOR, 'async ensureCapKeyFor(kind, stewardPubs, caps) {', 'ensureCapKeyFor'));
  assert.match(ensure, /rotateCapKey/,
    'losing a treasurer still only rewrites the envelope, which changes nothing they can read');
});

// Drive the SHIPPED rotation, rather than modelling it. The first version of the two tests above built the
// rings by hand, so breaking the ring construction in the product left them green — the same flaw this repo
// keeps re-learning: a sabotage must run through the code under test or it proves only that the test passes.
function runRotate({ ring, allowed, caps }) {
    const published = [];
    const stubs = {
      churchSkHeld: () => true, actingChurch: '', _isRelayAuthed: () => true,
      _capState: { finance: { ring: ring.slice(), docKeys: null, rev: 1, at: 0, checked: true } },
      CAP_KEYS: JSON.parse(JSON.stringify(SHIPPED_CAP_KEYS)),
      pub: church.pub, sk: church.sk, churchPub: church.pub,
      crypto: webcrypto, _hex: hex, _unhex: unhex,
      encrypt: (p2, k) => nip44.encrypt(p2, k), decrypt: (c, k) => nip44.decrypt(c, k),
      getConversationKey: (a, b) => nip44.utils.getConversationKey(a, b),
      nip44e: (p2, k) => nip44.encrypt(p2, k), nip44ck: (a, b) => nip44.utils.getConversationKey(a, b),
      _sealEach: async (payload, want, seal) => { const out = {}; for (const w of want) out[w] = seal(payload, w); return out; },
      feChurch: (t) => t, publish: async (e) => { published.push(e); return e; },
      now: () => 1787280000, NET: 'trinityone',
      _capRingChanged: () => {},   // the retry notifier — nothing is subscribed in this harness
      _warnUnsealed: () => {}, _sealEachFailed: [], _capAllows: SHIPPED_CAP_ALLOWS,
      window: { Steward: {} },
    };
    const scope = new Proxy(stubs, {
      has: (t, k) => (k in t) || !(String(k) in globalThis),
      get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
        const b = String(k).replace(/[0-9]+$/, ''); if (b in t) return t[b];
        throw new ReferenceError('needs a stub for ' + String(k)); },
      set: (t, k, v) => { t[k] = v; return true; },
    });
    const body = fnBody(VENDOR, 'async rotateCapKey(kind, stewardPubs, caps) {', 'rotateCapKey');
    const fn = new Function('scope', `with (scope) { return ({ ${body} }).rotateCapKey; }`)(scope);
    return { fn, published, stubs };
}

// Drive ensureCapKeyFor for real. Everything above tests what happens once an envelope EXISTS; this asks the
// question nobody asked — whether one is ever created.
function runEnsure({ ring, docKeys, checked = true, publishOk = true, unsealable = [], kind = 'finance' }) {
  const published = [], warned = [];
  const stubs = {
    _warnUnsealed: (cap, failed) => { if (failed && failed.length) warned.push({ cap, failed: failed.slice() }); },
    _capAllows: SHIPPED_CAP_ALLOWS,
    _sealEachFailed: [],
    churchSkHeld: () => true, actingChurch: '', _isRelayAuthed: () => true,
    // every capability the shipped table knows about, so a test can drive any of them
    _capState: Object.fromEntries(Object.keys(SHIPPED_CAP_KEYS).map(k => [k,
      k === kind ? { ring: ring.slice(), docKeys, rev: 1, at: 0, checked }
                 : { ring: [], docKeys: null, rev: 1, at: 0, checked: false }])),
    CAP_KEYS: JSON.parse(JSON.stringify(SHIPPED_CAP_KEYS)),
    pub: church.pub, sk: church.sk, churchPub: church.pub, churchSk: church.sk,
    crypto: webcrypto, _hex: hex, _unhex: unhex,
    encrypt: (p2, k) => nip44.encrypt(p2, k), getConversationKey: (a, b) => nip44.utils.getConversationKey(a, b),
    nip44e: (p2, k) => nip44.encrypt(p2, k), nip44ck: (a, b) => nip44.utils.getConversationKey(a, b),
    _legacyBookKeyHex: () => legacyKey,
    // mirrors the shipped _sealEach: a recipient it cannot seal to is skipped and RECORDED, not thrown
    _sealEach: async (payload, want, seal) => { const o = {}; stubs._sealEachFailed = [];
      for (const w of want) { if (unsealable.indexOf(w) >= 0) { stubs._sealEachFailed.push(w); continue; } o[w] = seal(payload, w); } return o; },
    feChurch: (t) => t, publish: async (e) => { if (!publishOk) return false; published.push(e); return e; },
    now: () => 1787280000, NET: 'trinityone', _capRingChanged: () => {},
    window: { Steward: {} },
  };
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      const b = String(k).replace(/[0-9]+$/, ''); if (b in t) return t[b];
      throw new ReferenceError('needs a stub for ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const body = fnBody(VENDOR, 'async ensureCapKeyFor(kind, stewardPubs, caps) {', 'ensureCapKeyFor');
  const fn = new Function('scope', `with (scope) { return ({ ${body} }).ensureCapKeyFor; }`)(scope);
  return { fn, published, stubs, warned };
}

test('a steward the envelope could NOT be sealed to is reported, not silently dropped', () => {
  // Found live, 2026-08-20: a roster entry whose pubkey is not a valid curve point was skipped inside
  // _sealEach's per-recipient try/catch, the envelope went out one recipient short, and ensureCapKeyFor
  // answered "published". The owner sees a capability ticked beside a name; that person sees an empty
  // screen. Publishing the short envelope is still right — one bad entry must not deny the capability to
  // everyone else — but reporting it as a clean success is not.
  return (async () => {
    const good = getPublicKey(generateSecretKey());
    const bad = '11'.repeat(32);            // not a point on the curve
    const { fn, published, warned } = runEnsure({ ring: [], docKeys: null, unsealable: [bad] });
    await fn('finance', [good, bad], { [good]: ['finance'], [bad]: ['finance'] });
    assert.equal(published.length, 1, 'the envelope was not published at all — one bad entry must not deny everyone else');
    const env = JSON.parse(published[0].content);
    assert.ok(env.keys[good], 're-anchor: the good steward was left out too');
    assert.ok(!env.keys[bad], 're-anchor: the unsealable steward somehow got a key');
    assert.equal(warned.length, 1,
      'nobody was told that a steward was left out of the envelope. They hold the capability in the console ' +
      'and no key on the relay, and there is nothing anywhere connecting the two.');
    assert.deepEqual(warned[0].failed, [bad], 'the wrong steward was named in the warning');
  })();
});

test('a church with NO envelope gets its FIRST one minted', async () => {
  // MEASURED against the shipped bundle of 2026-08-19: for a church with no envelope this returned false and
  // published nothing, every single time — the guard meant to stop a blind re-seal also blocked the case
  // where there is nothing to re-seal. So no church ever received a finance key, no treasurer could ever be
  // wrapped into one, and the whole shared-books feature was inert. The Finance screen's "not available for
  // delegated stewards" wall was hiding a path that could not have worked if it had been removed.
  const { fn, published, stubs } = runEnsure({ ring: [], docKeys: null });
  const treasurerPub = getPublicKey(generateSecretKey());
  const r = await fn('finance', [treasurerPub], { [treasurerPub]: ['finance'] });
  assert.notEqual(r, false, 'ensureCapKeyFor refused to mint the first envelope');
  assert.equal(published.length, 1, 'no envelope was published, so this church can never share its books');
  const env = JSON.parse(published[0].content);
  assert.ok(env.keys[church.pub], 'the church did not wrap the key to itself — it cannot read its own books');
  assert.ok(env.keys[treasurerPub], 'the treasurer was not wrapped in, so the grant hands over nothing');
  assert.equal(stubs._capState.finance.ring.length, 2, 'the minted ring should be [fresh, legacy]');
  assert.equal(stubs._capState.finance.ring[1], legacyKey, 'the legacy key is not in the ring, so the existing books are lost');
});

test('an UNSCOPED steward gets the books, but NOT the children\'s register', () => {
  // The upgrade rule everywhere else in this product: a roster entry with no `caps` list means "as powerful
  // as before capabilities existed", so upgrading a relay cannot strip a working delegate. Right for the
  // books — a steward who could already act for the church could already be handed the ledger.
  //
  // Wrong for the register, because there the CRYPTO used to be a stricter gate than the roster. Before
  // 2026-08-20 no delegate of any kind could open a check-in record: they were sealed to the church's own
  // key. Wrapping the new key to unscoped stewards would hand every steward appointed before capabilities
  // existed the name, room and pickup code of every child — in an upgrade, with nobody asked, and the blurb
  // that explains what Safeguarding grants is only ever shown to an owner who opens the capability editor.
  return (async () => {
    const old = getPublicKey(generateSecretKey());     // on the roster, no caps entry at all
    for (const [kind, shouldGet] of [['finance', true], ['checkin', false]]) {
      const { fn, published } = runEnsure({ kind, ring: kind === 'finance' ? [] : [freshKey], docKeys: null });
      await fn(kind, [old], {});                        // caps deliberately EMPTY — the pre-capabilities shape
      assert.equal(published.length, 1, `${kind}: nothing was published`);
      const env = JSON.parse(published[0].content);
      assert.equal(!!env.keys[old], shouldGet, shouldGet
        ? 'an unscoped steward lost access to the books on upgrade — a working delegate stripped by a relay update'
        : 'an unscoped steward was handed the children\'s register key. Nobody could read those records ' +
          'before today; this hands them to every steward a church appointed before capabilities existed, ' +
          'silently, on upgrade.');
      assert.ok(env.keys[church.pub], `${kind}: the church itself was left out`);
    }
  })();
});

test('the mint does not fire for a church that does not exist', () => {
  // Round 7, R7-2. "Owner console only" was written as `!S.actingChurch` — but a DELEGATE viewing their own
  // identity also has no acting church, so the console minted capability envelopes for a church that exists
  // nowhere. Measured in relay/rejected.log: one properly seated steward refused 28 times, every d-tag keyed
  // to his own pubkey (financekey x6, checkinkey x6, carekey x13). Those refusals raise a sticky banner
  // telling the user their work was not saved — while the relay was accepting everything they actually did —
  // and its suggested remedy destroys a church key if followed.
  const dash = stripComments(DASH);
  // Anchored on ORDER, not a character window — a lazy quantifier matched only the first line and passed
  // against the sabotage, which is the third time today a regex window has quietly proved nothing.
  const ownerOnly = dash.indexOf('if (!S || S.actingChurch || !S.ensureCapKeyFor) return;');
  const nameGuard = dash.indexOf('if (!church.name) return;');
  assert.ok(ownerOnly > 0, 're-anchor: the mint guard changed shape');
  assert.ok(nameGuard > ownerOnly && nameGuard - ownerOnly < 200,
    'the mint still fires on a console whose own church has never been created — so a delegated steward ' +
    'generates refused writes for a church nobody hosts, and meets a permanent "changes weren\'t saved" banner');
});

test('the PADLOCK layer and the KEY layer read one rule, not two copies of it', () => {
  // Round 7, R7-17. The `explicit` decision was made in the key layer only. stewCapState() went on treating
  // "no capability list" as "everything", so an unscoped steward got an UNLOCKED Check-in tab, the screen
  // rendered for her, and the register key was then withheld — correctly, and silently. Five taps, no form,
  // no error. Her words: "I found the edges of what I could do by things quietly not happening."
  //
  // The fix is not a second copy of the rule in the console. It is one question, asked of the module that
  // owns CAP_KEYS. A copy is exactly how the two layers drifted apart.
  const vendorHas = /capNeedsExplicitGrant\(cap\)\s*\{[^}]*CAP_KEYS\[k\]\.explicit/.test(VENDOR);
  assert.ok(vendorHas,
    'the module does not expose capNeedsExplicitGrant reading CAP_KEYS.explicit, so the console has nothing ' +
    'to ask and must be keeping its own copy of which capabilities need an explicit grant');

  const dash = stripComments(DASH);
  const body = dash.slice(dash.indexOf('function stewCapState'), dash.indexOf('function stewCapState') + 1400);
  assert.match(body, /capNeedsExplicitGrant\(cap\)/,
    'stewCapState still says "unscoped means everything" without asking whether this capability has to be ' +
    'given on purpose — so the padlock says yes while the key says no, and the user meets a dead button');
  assert.match(body, /unscoped: true/,
    're-anchor: the unscoped refusal is no longer distinguishable, so the panel cannot explain itself to ' +
    'someone who believes they already have everything');
});

test('and the refusal an UNSCOPED steward reads is not the one a scoped steward reads', () => {
  // "Your church hasn't given you Safeguarding" is the plain truth for someone who was given three areas and
  // not this one. To someone who has everything it reads as a mistake or a demotion — so it has to say that
  // this area is never part of "everything", and why.
  const dash = stripComments(DASH);
  const panel = dash.slice(dash.indexOf('function StewCapBlocked'), dash.indexOf('function StewCapBlocked') + 2600);
  assert.match(panel, /st\.unscoped/, 'StewCapBlocked does not distinguish the two readers');
  assert.match(panel, /never\s+included automatically/,
    'the unscoped refusal does not tell them this area is never part of "everything"');
  assert.match(panel, /haven.t lost anything/,
    'the unscoped refusal does not say they have lost nothing — which is the fact that stops it reading as a demotion');
  assert.match(panel, /one click/, 'the unscoped refusal does not tell them how small the fix is');
});

test('an EXPLICIT safeguarding grant does get the register', () => {
  // The other half — the exception must not make the capability unusable.
  return (async () => {
    const lead = getPublicKey(generateSecretKey());
    const { fn, published } = runEnsure({ kind: 'checkin', ring: [freshKey], docKeys: null });
    await fn('checkin', [lead], { [lead]: ['safeguarding'] });
    const env = JSON.parse(published[0].content);
    assert.ok(env.keys[lead],
      'a steward the church explicitly gave Safeguarding to did not receive the register key, so the ' +
      'capability grants nothing at all');
  })();
});

test('a church that ALREADY has an envelope is not re-minted over', async () => {
  // The other half of the same guard: once an envelope exists, an unchanged audience must publish nothing.
  const treasurerPub = getPublicKey(generateSecretKey());
  const { fn, published } = runEnsure({ ring: [freshKey, legacyKey], docKeys: { [church.pub]: 'x', [treasurerPub]: 'y' } });
  const r = await fn('finance', [treasurerPub], { [treasurerPub]: ['finance'] });
  assert.equal(r, false, 'an unchanged audience still republished the envelope');
  assert.equal(published.length, 0, 'the envelope was rewritten for no reason, bumping created_at on every render');
});

test('a mint whose publish FAILS adopts nothing', async () => {
  // Otherwise this console holds a key that exists nowhere else, seals the church's records with it, and the
  // next reload — which rebuilds the ring from the envelope that was never written — cannot open any of them.
  const { fn, stubs } = runEnsure({ ring: [], docKeys: null, publishOk: false });
  const r = await fn('finance', [], {});
  assert.equal(r, false, 'a failed publish was reported as success');
  assert.deepEqual(stubs._capState.finance.ring, [],
    'the console kept a key the relay never accepted. Every entry it seals from here is unrecoverable.');
});

test('minting waits until the envelope has actually been looked for', async () => {
  const { fn, published } = runEnsure({ ring: [], docKeys: null, checked: false });
  assert.equal(await fn('finance', [], {}), false, 'minted on an unfinished read');
  assert.equal(published.length, 0,
    'a mint decided before an authenticated EOSE republishes a stale ring as new and orphans everything the ' +
    'real key sealed');
});

test('the SHIPPED rotation mints a new key and keeps the old ones', async () => {
  const treasurerSk = generateSecretKey(), treasurerPub = getPublicKey(treasurerSk);
  const oldKey = freshKey;
  const { fn, published, stubs } = runRotate({ ring: [oldKey, legacyKey] });
  await fn('finance', [treasurerPub], { [treasurerPub]: ['finance'] });
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
  await fn('finance', [keptPub, gonePub], { [keptPub]: ['finance'], [gonePub]: ['care'] });   // gone lost finance
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
  const r = await fn('finance', [treasurerPub], { [treasurerPub]: ['finance'] });
  assert.equal(r, false, 'a refused rotation reported success');
  assert.deepEqual(stubs._capState.finance.ring, [freshKey, legacyKey],
    'the console adopted a ring it never managed to publish, so everything it seals next is unreadable to ' +
    'everyone including itself after a reload');
});

test('rotation refuses until the envelope has actually been looked for', async () => {
  const treasurerPub = getPublicKey(generateSecretKey());
  const { fn, published, stubs } = runRotate({ ring: [freshKey, legacyKey] });
  stubs._capState.finance.checked = false;                 // subscription has not reached EOSE
  const r = await fn('finance', [treasurerPub], { [treasurerPub]: ['finance'] });
  assert.equal(r, false, 'rotated on an unfinished read of the corpus');
  assert.equal(published.length, 0, 'published an envelope before knowing what was already there');
});
