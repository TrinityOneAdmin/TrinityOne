// A NEWLY-ADOPTED RELAY IS SENT THE CHURCH'S SAFEGUARDING DOCUMENTS (reference/SAFEGUARDING-BOUNDARY.md).
// Run: node --test scripts/an-adopted-relay-gets-the-safeguarding-documents.test.mjs
//
// The relay ENFORCES a church's safeguarding from its OWN copy of four owner-signed documents —
// minors:/approved:/guardians:/blocked: (gateway.mjs MINORS_BY/APPROVED_BY/GUARDIANS_BY/BLOCKED_BY). A box the
// church has just adopted holds none of them until the next EDIT, and a sync-off church (the default) never mirrors
// them, so it fails OPEN where the church's own box refuses. The fix sends that box the church's CURRENT copy of
// each of the four the instant it enters the publish set — VERBATIM (owner's signature unchanged, never re-signed)
// and TARGETED to the new box only.
//
// Everything here is LIFTED WHOLE from the SHIPPED vendor/steward.js and executed (CLAUDE.md rule 3's vendor half):
// the REAL addRelay and the REAL _backfillSafeguardTo, driven through each adopt path's own shipped entry function
// (addRelay for manual Add/Connect, connectFoundRelays + autoPickRelays for Auto-find, autoJoinPublicRelays for B2),
// so each test fails if the backfill is removed from the one writer every path passes through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEWARD = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');

const CP = 'c'.repeat(64);                                   // the church key (author of every safeguarding doc)
const CHILD = 'a'.repeat(64), ADULT = 'b'.repeat(64), PARENT = 'd'.repeat(64), BANNED = 'e'.repeat(64);
const tick = () => new Promise((r) => setTimeout(r, 25));    // flush the fire-and-forget backfill's microtasks

// A current owner-signed document, as _oneComplete would return it (pubkey === the church key).
const doc = (d, content) => ({ pubkey: CP, kind: 30078, created_at: 1000, tags: [['d', d], ['t', 'trinityone']], content: JSON.stringify(content) });

// The four documents a fully-configured church holds. Keyed by the d-tag the backfill reads.
function fullDocs(pub = CP) {
  return {
    ['trinityone/minors:' + pub]: doc('trinityone/minors:' + pub, { pubkeys: [CHILD] }),
    ['trinityone/approved:' + pub]: doc('trinityone/approved:' + pub, { pubkeys: [ADULT], cleared: { [ADULT]: { by: pub, at: 9 } }, expiry: {} }),
    ['trinityone/guardians:' + pub]: doc('trinityone/guardians:' + pub, { links: { [CHILD]: [PARENT] } }),
    ['trinityone/blocked:' + pub]: doc('trinityone/blocked:' + pub, { pubkeys: [BANNED] }),
  };
}

// Build a world whose REAL addRelay + REAL _backfillSafeguardTo run against a scripted relay. `docs` is what
// _oneComplete answers per d-tag (an absent key = the church never created that document). `pool.publish` is the
// spy: every (urls, ev) the backfill targets is recorded. window.Steward.addRelay is the REAL lifted function, so
// a path that calls it exercises the real backfill.
function world(opts = {}) {
  const { sk = 'sk', pub = CP, actingChurch = '', network = false, docs = fullDocs(), startStore = [] } = opts;
  let store = [...startStore];
  const published = [];
  const reads = [];
  const pool = { publish: (urls, ev) => { published.push({ urls: [...urls], ev }); return [Promise.resolve('')]; } };
  const steward = {};
  const CE = function (n) { this.type = n; };
  const scope = {
    sk, pub, actingChurch,
    _viewingNetwork: () => network,
    MINORS_D: 'trinityone/minors:', APPROVED_D: 'trinityone/approved:', GUARDIANS_D: 'trinityone/guardians:', BLOCKED_D: 'trinityone/blocked:',
    RELAYS_LS: 'trinityone.relays',
    _oneComplete: async (filters) => {
      const f = filters[0] || {}; const d = (f['#d'] || [])[0] || '';
      reads.push(d);
      return { ev: docs[d] || null, complete: true, answered: 1, asked: 1, askedUrls: ['r'], answeredUrls: ['r'] };
    },
    pool,
    normRelay: (u) => String(u || '').trim(),
    ownRelay: () => 'wss://own.example/relay',
    isOwnRelaySpelling: () => false,
    isSharedRelaySpelling: (u) => (opts.shared || []).includes(String(u || '').trim()),
    extraRelays: () => store.slice(),
    lsSet: (k, v) => { if (k === 'trinityone.relays') store = JSON.parse(v); },
    undeclineRelay: () => {},
    window: { dispatchEvent: () => {}, Steward: steward, CustomEvent: CE },
    CustomEvent: CE,
    Math, JSON, Number, Array, Set, String, Object, Promise, Boolean, RegExp, setTimeout,
  };
  const names = Object.keys(scope);
  // The REAL addRelay (an object method) and the REAL backfill, over this scope.
  const core = `const _o = { ${fnBody(STEWARD, 'addRelay(input) {')} };\n` +
    fnBody(STEWARD, 'async function _backfillSafeguardTo(urls) {') + '\n' +
    'return _o.addRelay;';
  const addRelay = new Function(...names, core)(...names.map((k) => scope[k]));
  steward.addRelay = addRelay;
  return { scope, names, steward, pool, published, reads, store: () => store, run: (fn) => fn };
}

// targets published for a given d-tag suffix (minors/approved/guardians/blocked)
const sentFor = (published, dPrefix) => published.filter((p) => p.ev && p.ev.tags.some((t) => t[0] === 'd' && t[1].startsWith(dPrefix)));

test('manual Add/Connect: addRelay sends the new box ALL FOUR current safeguarding docs, verbatim and targeted', async () => {
  const docs = fullDocs();
  const w = world({ docs });
  const url = 'wss://newbox.example/relay';
  const r = w.steward.addRelay(url);
  assert.equal(r, url, 'addRelay should have adopted the new box');
  await tick();

  const kinds = ['trinityone/minors:', 'trinityone/approved:', 'trinityone/guardians:', 'trinityone/blocked:'];
  for (const k of kinds) {
    const sent = sentFor(w.published, k);
    assert.equal(sent.length, 1, `the ${k} document was not sent to the adopted box (the relay cannot enforce it)`);
    assert.deepEqual(sent[0].urls, [url], `${k} was not TARGETED to the new box only`);
    // VERBATIM: the EXACT owner-signed event instance _oneComplete returned, never a re-signed copy.
    assert.equal(sent[0].ev.pubkey, CP, `${k} was sent under the wrong signer — it must be the owner's own event`);
    assert.equal(sent[0].ev, docs[k + CP], `${k} was not the verbatim current event (it was re-signed, not re-sent)`);
  }
  // CURRENT content, not a stale/empty view: the real child / cleared adult / guardian link / ban are carried.
  assert.ok(sentFor(w.published, 'trinityone/minors:')[0].ev.content.includes(CHILD), 'the minors list sent did not carry the current child');
  assert.ok(sentFor(w.published, 'trinityone/blocked:')[0].ev.content.includes(BANNED), 'the blocklist sent did not carry the current ban');
});

test('a document the church never created is NOT sent (empty == absent at the relay — nothing fabricated)', async () => {
  // This church marked children and a ban, but never created an approved: or guardians: document.
  const docs = {
    ['trinityone/minors:' + CP]: fullDocs()['trinityone/minors:' + CP],
    ['trinityone/blocked:' + CP]: fullDocs()['trinityone/blocked:' + CP],
  };
  const w = world({ docs });
  w.steward.addRelay('wss://newbox.example/relay');
  await tick();
  assert.equal(sentFor(w.published, 'trinityone/minors:').length, 1, 'the existing minors list must still be sent');
  assert.equal(sentFor(w.published, 'trinityone/blocked:').length, 1, 'the existing blocklist must still be sent');
  assert.equal(sentFor(w.published, 'trinityone/approved:').length, 0, 'an approved: doc that never existed must not be fabricated');
  assert.equal(sentFor(w.published, 'trinityone/guardians:').length, 0, 'a guardians: doc that never existed must not be fabricated');
});

test('no backfill when addRelay does not adopt (duplicate / own / shared returns false)', async () => {
  // duplicate: already in the store
  const dup = world({ startStore: ['wss://already.example/relay'] });
  assert.equal(dup.steward.addRelay('wss://already.example/relay'), false);
  await tick();
  assert.equal(dup.published.length, 0, 'a duplicate add re-sent the documents — the backfill must fire only on a genuine new adoption');

  // own relay
  const own = world();
  assert.equal(own.steward.addRelay('wss://own.example/relay'), false);
  await tick();
  assert.equal(own.published.length, 0, 'adding the own relay triggered a backfill');

  // shared pool spelling
  const sh = world({ shared: ['wss://shared.example/relay'] });
  assert.equal(sh.steward.addRelay('wss://shared.example/relay'), false);
  await tick();
  assert.equal(sh.published.length, 0, 'a shared-relay spelling triggered a backfill');
});

test('a delegated / network view does not backfill (owner-only docs; matches every church-doc writer)', async () => {
  const del = world({ actingChurch: 'f'.repeat(64) });
  del.steward.addRelay('wss://newbox.example/relay');
  await tick();
  assert.equal(del.published.length, 0, 'a delegated console backfilled owner-only safeguarding docs');

  const net = world({ network: true });
  net.steward.addRelay('wss://newbox.example/relay');
  await tick();
  assert.equal(net.published.length, 0, 'a network view backfilled owner-only safeguarding docs');
});

test('Auto-find (connectFoundRelays): each connected box is sent the four safeguarding docs', async () => {
  const w = world();
  const names = w.names;
  // publishRelayList / rememberRelayName are post-adopt collaborators here; the box entering the set via addRelay
  // is what must backfill.
  w.steward.publishRelayList = async () => {};
  w.steward.rememberRelayName = () => {};
  const src = `const _o = { ${fnBody(STEWARD, 'async connectFoundRelays(picks) {')} };\nreturn _o.connectFoundRelays;`;
  const connectFoundRelays = new Function(...names, src)(...names.map((k) => w.scope[k]));
  await connectFoundRelays([{ url: 'wss://find-1.example/relay', name: 'find-1' }, { url: 'wss://find-2.example/relay', name: 'find-2' }]);
  await tick();
  for (const url of ['wss://find-1.example/relay', 'wss://find-2.example/relay']) {
    for (const k of ['trinityone/minors:', 'trinityone/approved:', 'trinityone/guardians:', 'trinityone/blocked:']) {
      const sent = w.published.filter((p) => p.urls[0] === url && p.ev.tags.some((t) => t[0] === 'd' && t[1].startsWith(k)));
      assert.equal(sent.length, 1, `Auto-find connected ${url} without sending it the ${k} document`);
    }
  }
});

test('Auto-find (autoPickRelays): each auto-picked box is sent the four safeguarding docs', async () => {
  const w = world();
  const names = w.names;
  w.steward.publishRelayList = async () => {};
  // autoPickRelays' own collaborators (discovery + pick + the publish-set `have` check) are stubbed; the box
  // entering the publish set through the REAL addRelay is what is under test.
  const extra = {
    ...w.scope,
    discoverRelayOffers: async () => [{ url: 'wss://pick-1.example/relay' }],
    relays: () => [],
    pickRelays: (offers, n) => offers.slice(0, n || 2),
  };
  const extraNames = Object.keys(extra);
  const src = `const _o = { ${fnBody(STEWARD, 'async autoPickRelays(n) {')} };\nreturn _o.autoPickRelays;`;
  const autoPickRelays = new Function(...extraNames, src)(...extraNames.map((k) => extra[k]));
  await autoPickRelays(1);
  await tick();
  for (const k of ['trinityone/minors:', 'trinityone/approved:', 'trinityone/guardians:', 'trinityone/blocked:']) {
    const sent = w.published.filter((p) => p.urls[0] === 'wss://pick-1.example/relay' && p.ev.tags.some((t) => t[0] === 'd' && t[1].startsWith(k)));
    assert.equal(sent.length, 1, `autoPickRelays adopted a box without sending it the ${k} document`);
  }
});

// ── THE TWO SWAP PATHS THAT BYPASS addRelay ──────────────────────────────────────────────────────────────
// `extraRelays()` is also rewritten DIRECTLY through _writeExtraRelays — never through addRelay — by two swap
// branches: refreshNamedRelays (the tunnel-address swap of a named relay) and adoptNetDocAddresses' stale-swap
// (a box re-pointed, from the church's own relay-net document, to a genuinely different address). When the new
// address is a DIFFERENT admitted box (an unpinned/legacy re-point, a same-key replaced machine), that box
// enters the church's publish set holding none of the four safeguarding docs and fails OPEN — exactly what the
// backfill closes. Each branch now fires the SAME _backfillSafeguardTo, but only when the address actually
// changed; a same-url refresh must not re-publish. Both functions are lifted WHOLE from the shipped
// vendor/steward.js with the REAL _writeExtraRelays and REAL _backfillSafeguardTo, so deleting either backfill
// call makes these go red.

// refreshNamedRelays over the world's scope, with the REAL _writeExtraRelays + REAL _backfillSafeguardTo. The
// named-relay resolve/admit collaborators are stubbed; the swap write + backfill are the shipped code.
function refreshWorld(opts = {}) {
  const w = world(opts);
  const extra = {
    ...w.scope,
    _refreshingNames: false,
    getNamedRelays: () => (opts.named || []).map((e) => ({ ...e })),
    resolveRelayName: async (name) => (opts.resolve ? opts.resolve(name) : null),
    verifyRelayIdentity: async () => ({ relayPub: '' }),   // not consulted on the unpinned (no entry.pub) path
    admitRemoteRelay: async () => (opts.admit === undefined ? true : opts.admit),
    setNamedRelays: () => {},
  };
  const names = Object.keys(extra);
  const src = [
    fnBody(STEWARD, 'function _writeExtraRelays(list) {'),
    fnBody(STEWARD, 'async function _backfillSafeguardTo(urls) {'),
    fnBody(STEWARD, 'async function refreshNamedRelays() {'),
    'return refreshNamedRelays;',
  ].join('\n');
  const refreshNamedRelays = new Function(...names, src)(...names.map((k) => extra[k]));
  return { ...w, refreshNamedRelays };
}

test('refreshNamedRelays: a swap to a DIFFERENT address backfills the four safeguarding docs to the new url', async () => {
  const old = 'wss://old.example/relay', neu = 'wss://new.example/relay';
  const w = refreshWorld({ startStore: [old], named: [{ name: 'box', url: old }], resolve: () => ({ url: neu }), admit: true });
  await w.refreshNamedRelays();
  await tick();
  assert.ok(w.store().includes(neu) && !w.store().includes(old), 'the swap did not land in the store');
  for (const k of ['trinityone/minors:', 'trinityone/approved:', 'trinityone/guardians:', 'trinityone/blocked:']) {
    const sent = w.published.filter((p) => p.urls[0] === neu && p.ev.tags.some((t) => t[0] === 'd' && t[1].startsWith(k)));
    assert.equal(sent.length, 1, `the swapped-in box was not sent the ${k} document — it fails OPEN`);
    assert.deepEqual(sent[0].urls, [neu], `${k} was not TARGETED to the new url only`);
    assert.equal(sent[0].ev.pubkey, CP, `${k} was not the owner's verbatim event`);
  }
});

test('refreshNamedRelays: a same-url refresh does NOT backfill (no address change, no re-publish)', async () => {
  const same = 'wss://same.example/relay';
  const w = refreshWorld({ startStore: [same], named: [{ name: 'box', url: same }], resolve: () => ({ url: same }), admit: true });
  await w.refreshNamedRelays();
  await tick();
  assert.deepEqual(w.store(), [same], 'a same-url refresh must not change the store');
  assert.equal(w.published.length, 0, 'a same-url refresh re-published the safeguarding docs — the backfill must fire only on an address change');
});

// adoptNetDocAddresses over the world's scope, with the REAL _writeExtraRelays + REAL _backfillSafeguardTo. The
// net-doc read/prove/admit collaborators are stubbed so a single entry drives the STALE-SWAP branch; the swap
// write + backfill are the shipped code. `_staleBoxSpelling` returns the already-listed (undiallable) spelling
// of the same box, so the branch replaces it with the new diallable address.
function adoptWorld(opts = {}) {
  const w = world(opts);
  const { addr, stale, key = 'f'.repeat(64) } = opts;
  const extra = {
    ...w.scope,
    churchPub: CP,
    relayNetDoc: async () => ({ ev: { pubkey: CP, content: '{}' } }),
    parseRelayNet: () => [{ url: addr, pubkey: key }],
    _readCovers: () => false,
    retireDeadAdoptedRows: async () => {},
    _netDocDialUrl: (u) => String(u || ''),
    _isDeclined: () => false,
    _staleBoxSpelling: (u) => (u === addr ? stale : ''),
    isOwnRelaySpelling: () => false,
    _alreadyACandidate: () => false,
    verifyRelayIdentity: async () => ({ relayPub: key }),
    admitRemoteRelay: async () => true,
    setAdoptedRelays: () => {},
    adoptedRelays: () => [],
    _rememberAdoptedName: () => {},
    _tagAdopted: () => {},
    NETDOC_ADOPT_MAX: 8,
  };
  const names = Object.keys(extra);
  const src = [
    fnBody(STEWARD, 'function _writeExtraRelays(list) {'),
    fnBody(STEWARD, 'async function _backfillSafeguardTo(urls) {'),
    fnBody(STEWARD, 'async function adoptNetDocAddresses() {'),
    'return adoptNetDocAddresses;',
  ].join('\n');
  const adoptNetDocAddresses = new Function(...names, src)(...names.map((k) => extra[k]));
  return { ...w, adoptNetDocAddresses };
}

test('net-doc stale-swap: re-pointing a box to a DIFFERENT address backfills the four safeguarding docs to it', async () => {
  const addr = 'wss://moved.example/relay', stale = 'wss://stale.example/relay';
  const w = adoptWorld({ startStore: [stale], addr, stale });
  const added = await w.adoptNetDocAddresses();
  await tick();
  assert.deepEqual(added, [addr], 'the stale-swap did not adopt the moved address');
  assert.ok(w.store().includes(addr) && !w.store().includes(stale), 'the store was not swapped to the new address');
  for (const k of ['trinityone/minors:', 'trinityone/approved:', 'trinityone/guardians:', 'trinityone/blocked:']) {
    const sent = w.published.filter((p) => p.urls[0] === addr && p.ev.tags.some((t) => t[0] === 'd' && t[1].startsWith(k)));
    assert.equal(sent.length, 1, `the stale-swapped box was not sent the ${k} document — it fails OPEN`);
    assert.deepEqual(sent[0].urls, [addr], `${k} was not TARGETED to the new url only`);
    assert.equal(sent[0].ev.pubkey, CP, `${k} was not the owner's verbatim event`);
  }
});

test('B2 auto-join (autoJoinPublicRelays): the community box it adopts is sent the four safeguarding docs', async () => {
  const w = world();
  const names = w.names;
  const key = (n) => String(n).padStart(2, '0').repeat(32).slice(0, 64);
  const addr = 'wss://community-1.example/relay';
  // The B2 pass + its real cap/ordering helpers, lifted, with the REAL addRelay wired into window.Steward.
  const b2scope = {
    ...w.scope,
    PUBLIC_TARGET_DEFAULT: 5,
    CANONICAL_RELAYS: ['wss://app.trinityone.church/relay'],
    RELAYS_REMOVED_D: 'trinityone/relays-removed', RELAYPREFS_D: 'trinityone/relayprefs',
    _readRelayPrefs: async () => ({ prefs: { publicAuto: true, publicTarget: 5, chosen: [] }, complete: true }),
    discoverRelayOffers: async () => [{ url: addr, name: 'community-1', ms: 10 }],
    relays: () => [],
    relayNetEntries: async () => [],
    _ownChurchName: () => 'St Aidan',
    _isDeclined: () => false,
    verifyRelayIdentity: async () => ({ relayPub: key(1) }),
    sharedRelayKeys: () => [],
    relayNetCandidates: () => [],
    selfPublicRelay: () => '',
    _gate: { provedKey: () => '' },
    _writeRelayPrefs: async () => ({ written: true }),
    // B3 (2026-11-22): the pass reads the church's removed-relay keys through _removedKeysRead and stands down when
    // that read is not complete. "Complete, nothing removed" here — this test is about the backfill; the read itself
    // is run for real in community-relays-auto-join.test.mjs.
    _removedKeysRead: async () => ({ complete: true, keys: new Set() }),
    rankOffersByLatency: undefined,  // lifted below
  };
  // B2 reads a tombstone doc via _oneComplete(RELAYS_REMOVED_D); the world's _oneComplete answers null for it (none).
  b2scope.window = { dispatchEvent: () => {}, Steward: Object.assign(w.steward, {
    registerAtRelay: async () => ({ ok: true, status: 200 }),
    rememberRelayName: () => {},
    signRelay: async () => ({ published: true, proven: [{ url: addr, pubkey: key(1) }] }),
    publishRelayList: () => Promise.resolve(null),
    removeRelay: () => { throw new Error('B2 must never auto-remove'); },
    unsignRelay: () => { throw new Error('B2 must never auto-unsign'); },
  }), CustomEvent: w.scope.CustomEvent };
  const b2names = Object.keys(b2scope);
  const src = [
    fnBody(STEWARD, 'function _clampPublicTarget(n) {'),
    fnBody(STEWARD, 'function _communityCap(publicTarget) {'),
    fnBody(STEWARD, 'function _mergeChosen(a, b) {'),
    fnBody(STEWARD, 'function rankOffersByLatency(offers) {'),
    fnBody(STEWARD, 'async function autoJoinPublicRelays() {'),
    'return autoJoinPublicRelays;',
  ].join('\n');
  const autoJoin = new Function(...b2names, src)(...b2names.map((k) => b2scope[k]));
  const res = await autoJoin();
  assert.equal(res.ran, true, 'the B2 pass did not run');
  assert.equal(res.added.length, 1, 'the B2 pass did not adopt the community box');
  await tick();
  for (const k of ['trinityone/minors:', 'trinityone/approved:', 'trinityone/guardians:', 'trinityone/blocked:']) {
    const sent = w.published.filter((p) => p.urls[0] === addr && p.ev.tags.some((t) => t[0] === 'd' && t[1].startsWith(k)));
    assert.equal(sent.length, 1, `B2 auto-joined ${addr} without sending it the ${k} document — it fails OPEN`);
  }
});
