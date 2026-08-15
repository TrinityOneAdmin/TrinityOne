// The congregation name key must survive the things that were destroying it.
// Run: node --test scripts/name-key-integrity.test.mjs
//
// AUDIT-2026-07-27. Stage 1 seals every member's name to a per-church key. Five separate defects meant that
// key could be lost, replaced or never loaded — and losing it does not degrade gracefully: every name in the
// congregation goes blank at once, on every phone, and the ciphertext left behind cannot be opened by anyone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { v2 as nip44v2 } from 'nostr-tools/nip44';
import { fnBody } from './test-slice.mjs';

const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
const hex = (u8) => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K(), alice = K(), bob = K();
const now = () => Math.floor(Date.now() / 1000);

// Lift the real member-side functions and run them against a scope we control.
// Brace-matched, and aware of quotes: _nameCipher contains startsWith('{'), and a matcher that counts braces
// inside string literals cut the function in half and produced a syntax error that looked like a code fault.
function grab(src, name) {
  const at = src.indexOf('function ' + name + '(');
  assert.notEqual(at, -1, name + ' missing from the shipped bundle');
  let depth = 0, q = '';
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  assert.fail('could not find the end of ' + name);
}
function memberSide(me, withKey = true) {
  const body = `
    const NET = 'trinityone';
    const _nameKeys = new Map(), _nameKeyTs = new Map(), _sealedNames = new Map(), profiles = {};
    const _churchRoster = new Map();
    const _unhexF = (h) => new Uint8Array((String(h).match(/.{1,2}/g) || []).map(x => parseInt(x, 16)));
    const decrypt = nip44v2.decrypt, getConversationKey = nip44v2.utils.getConversationKey;
    const nip44d = decrypt, nip44ck = getConversationKey;
    const pub = ${JSON.stringify(me.pub)};
    let sk = ${withKey ? '_SK' : 'null'};
    ${grab(FELLOWSHIP, '_nameCipher')}
    ${grab(FELLOWSHIP, '_ingestNameKey')}
    ${grab(FELLOWSHIP, '_openSealedName')}
    ${grab(FELLOWSHIP, '_ringId')}
    return { ingest: _ingestNameKey, open: _openSealedName, ringId: _ringId,
             keys: _nameKeys, ts: _nameKeyTs, giveKey: (k) => { sk = k; } };
  `;
  return new Function('nip44v2', '_SK', body)(nip44v2, me.sk);
}
// The envelope the console publishes: the ring, sealed per recipient.
const envelope = (recips, ring, at) => {
  const keys = {}, wrapped = JSON.stringify(ring.map(hex));
  for (const pk of recips) keys[pk] = nip44v2.encrypt(wrapped, nip44v2.utils.getConversationKey(church.sk, pk));
  return { pubkey: church.pub, created_at: at || now(), content: JSON.stringify({ rev: ring.length, keys }) };
};
const sealedName = (key, name) => nip44v2.encrypt(JSON.stringify({ name }), key);
const K1 = crypto.getRandomValues(new Uint8Array(32));
const K2 = crypto.getRandomValues(new Uint8Array(32));

test('a partial roster does not wipe everyone’s name key', () => {
  // The console republishes this on every roster tick and the roster arrives in pieces, so an early envelope
  // legitimately omits members who had not loaded yet. Treating "I am not in this envelope" as revocation
  // meant half a congregation went anonymous until a fuller envelope happened along.
  const m = memberSide(alice);
  m.ingest(church.pub, envelope([church.pub, alice.pub, bob.pub], [K1], now() - 100));
  assert.equal(m.keys.get(church.pub).length, 1, 'sanity: Alice holds the key');
  m.ingest(church.pub, envelope([church.pub, bob.pub], [K1], now()));   // Alice missing — roster still loading
  assert.ok((m.keys.get(church.pub) || []).length, 'a partial envelope deleted Alice’s name key — every name in her church goes blank');
  assert.equal(m.open(church.pub, bob.pub, sealedName(K1, 'Bob')), 'Bob');
});

test('an envelope that arrives before the signing key is not consumed', () => {
  // _nameKeyTs was bumped BEFORE the sk check, so a keyless pass moved the newest-wins cursor forward and the
  // same envelope was refused as stale when the key arrived and it was replayed. The key never loaded and every
  // name stayed blank for the whole session — and the docs hub uses a persisted since-cursor, so it does not
  // simply re-arrive next time.
  const m = memberSide(alice, false);
  const env = envelope([church.pub, alice.pub], [K1]);
  m.ingest(church.pub, env);
  assert.equal(m.ts.get(church.pub) || 0, 0, 'the newest-wins cursor moved on an envelope we could not use');
  m.giveKey(alice.sk);
  m.ingest(church.pub, env);   // the replay both recovery hooks now perform
  assert.ok((m.keys.get(church.pub) || []).length, 'replaying the envelope after the key arrived did nothing — names stay blank all session');
});

test('a rotation still opens names sealed before it', () => {
  const m = memberSide(alice);
  m.ingest(church.pub, envelope([church.pub, alice.pub], [K1], now() - 100));
  const old = sealedName(K1, 'Maria');
  m.ingest(church.pub, envelope([church.pub, alice.pub], [K2, K1], now()));
  assert.equal(m.open(church.pub, bob.pub, old), 'Maria', 'the ring lost the superseded key — every name sealed before the block is unreadable');
  assert.equal(m.open(church.pub, bob.pub, sealedName(K2, 'Maria')), 'Maria');
});

test('a stranger cannot install a name key', () => {
  const m = memberSide(alice);
  const evil = K();
  const bad = envelope([church.pub, alice.pub], [K1]);
  bad.pubkey = evil.pub;
  m.ingest(church.pub, bad);
  assert.equal(m.keys.get(church.pub), undefined, 'a stranger installed the congregation’s name key');
});

test('the re-seal cache notices the key changed underneath it', () => {
  // _sealedMine was keyed on the NAME alone, so after a rotation the re-seal that exists specifically to heal a
  // rotation looked up "Maria", found "Maria", and skipped — leaving her name sealed under a dead key.
  const m = memberSide(alice);
  m.ingest(church.pub, envelope([church.pub, alice.pub], [K1], now() - 100));
  const id1 = m.ringId(church.pub);
  m.ingest(church.pub, envelope([church.pub, alice.pub], [K2, K1], now()));
  const id2 = m.ringId(church.pub);
  assert.ok(id1 && id2, 'the ring fingerprint is empty, so the cache cannot tell keys apart');
  assert.notEqual(id1, id2, 'the fingerprint did not change across a rotation — the re-seal will skip and the name stays under a dead key');
  assert.match(FELLOWSHIP, /_sealedMine\.get\(cp\) === stamp/, 'the re-seal cache is not keyed on the ring as well as the name');
});

// ── the console side ─────────────────────────────────────────────────────────────────────────────────────────
test('a delegated console cannot mint a name key over the owner’s', () => {
  // THE DESTRUCTIVE ONE. A delegated console can never read the owner's envelope, so it holds an EMPTY ring;
  // rotating from empty minted a brand-new single-key ring and published it as the church's name key. Members
  // accept it (newest wins, steward-authored is allowed) and every sealed name in the congregation stops
  // opening — the whole roster goes anonymous from one Block tap. Guarded on both sides.
  const at = STEWARD.indexOf('ensureNameKeyForMembers(memberPubs');
  assert.notEqual(at, -1, 'ensureNameKeyForMembers is gone from the shipped console bundle');
  const fn = STEWARD.slice(at, at + 2600);
  assert.match(fn, /if \(opts\.rotate && !ring\.length\) return/, 'a rotate with no ring still mints a replacement key');
  assert.match(fn, /if \(!ring\.length && _nameKeyDocKeys\) return/, 'an envelope exists and we are not in it — minting over it orphans every sealed name');
  assert.match(fn, /if \(!_nameKeyChecked \|\| !_isRelayAuthed\(\)\) return/, 'the console will mint from a view it never established');
  assert.match(DASH, /!delegated && window\.Steward\.ensureNameKeyForMembers/, 'block() still rotates the name key while acting as a delegated steward');
});

test('the envelope grows and never silently shrinks', () => {
  const at = STEWARD.indexOf('ensureNameKeyForMembers(memberPubs');
  const fn = STEWARD.slice(at, at + 2600);
  assert.match(fn, /opts\.rotate \? want : \[\.\.\..*?new Set\(\[\.\.\.want, \.\.\.Object\.keys\(have\)\]\)\]/,
    'a partial roster tick can drop existing recipients — a block is the only legitimate removal');
  assert.match(fn, /recips\.every\(\(?p2\)? => have\[p2\]\)/,
    'no self-guard: this republishes on every roster emit, and each envelope makes every phone re-open every name in the church');
  assert.match(fn, /\[cp, churchPub, \.\.\.\(?memberPubs \|\| \[\]\)?, \.\.\.\(?stewardPubs \|\| \[\]\)?\]/,
    'the acting church and the steward roster must be recipients, or a delegated console can never read the envelope at all');
});

// ── a block is honoured before the relay confirms it (AUDIT-2026-08-10 item B) ──────────────────────────────
// The recipient builders used to consult only the SUBSCRIBED blocklist, which round-trips through the relay.
// So the console that performs a block re-keyed the blocked member straight back in through its own stale
// React state: block() rotates them out, the roster effect re-runs with the old blockedList, and the
// grow-never-shrink merge re-adds them from `have`. The envelope carrying a copy sealed to the blocked pubkey
// then sits in the relay DB — lawful compulsion of the relay plus the blocked member's own sk (and a hostile
// ex-member is exactly who cooperates) opens every congregation name sealed under the current ring.
//
// This EXECUTES the shipped setBlocked and _ensureNameKeyLocked, lifted from vendor/steward.js, with the
// blocklist publish left UNRESOLVED — the exact window the bug lives in. The sync `_localBlocked` statement
// under test is the SAME statement the shipped code runs, not a test-local reimplementation.
function blockRig(have) {
  const setBlockedM = fnBody(STEWARD, 'setBlocked(pubkeys)', 'setBlocked in the shipped bundle');
  const ensureM = fnBody(STEWARD, 'async _ensureNameKeyLocked(', '_ensureNameKeyLocked in the shipped bundle');
  const src = `
    let _localBlocked = new Set();
    let _nameKeyRing = ['11'.repeat(32)];
    let _nameKeyDocKeys = HAVE;
    let _nameKeyChecked = true;
    const published = [];
    const churchSk = new Uint8Array(32).fill(3);
    const churchPub = CP, pub = CP, sk = churchSk, actingChurch = '';
    const NAME_RING_MAX = 12, NAMEKEY_D = 'trinityone/namekey:', BLOCKED_D = 'trinityone/blocked:', NET = 'trinityone';
    const _isRelayAuthed = () => true;
    const _requireTrustedView = () => {};
    const now = () => 1000;
    const _hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
    const toPubHex = (p) => /^[0-9a-f]{64}$/i.test(p) ? String(p).toLowerCase() : null;
    // esbuild renames the nip44 imports in the bundle — provide both spellings (see memberSide above)
    const encrypt3 = () => 'ct', getConversationKey = () => 'ck';
    const nip44e = encrypt3, nip44ck = getConversationKey;
    const _sealEach = async (payload, recips) => { const keys = {}; for (const pk of recips) keys[pk] = 'sealed'; return keys; };
    const finalizeEvent2 = (t) => t, finalizeEvent = finalizeEvent2, feChurch = (t) => t;
    // the blocklist publish NEVER resolves — the relay has not confirmed the block yet
    const publish = (evt) => {
      published.push(evt);
      const d = ((evt.tags || []).find((t) => t[0] === 'd') || [])[1] || '';
      return d.startsWith(BLOCKED_D) ? new Promise(() => {}) : Promise.resolve(evt);
    };
    const api = { ${setBlockedM}, ${ensureM} };
    return { api, published };
  `;
  return new Function('CP', 'HAVE', src)(church.pub, have);
}
const _nameEnvs = (rig) => rig.published.filter(e => String(((e.tags || []).find(t => t[0] === 'd') || [])[1] || '').startsWith('trinityone/namekey:'));

test('a block is honoured before the relay confirms it', async () => {
  const C = K().pub, D = K().pub;
  const rig = blockRig({ [church.pub]: 1, [alice.pub]: 1, [bob.pub]: 1, [C]: 1 });
  rig.api.setBlocked([C]);                                        // NOT awaited — the publish is in flight
  // the roster effect re-fires with the STALE list still containing C — the deterministic self-race
  await rig.api._ensureNameKeyLocked([alice.pub, bob.pub, C], []);
  assert.equal(_nameEnvs(rig).length, 0,
    'the stale roster tick republished the envelope — nothing changed once the blocked member is filtered, so nothing should publish');
  // …and a genuinely-new member D still gets keyed (kills the never-publish-anything mutant)
  await rig.api._ensureNameKeyLocked([alice.pub, bob.pub, C, D], []);
  const env = _nameEnvs(rig)[0];
  assert.ok(env, 'a new member joining must still trigger a publish');
  const keys = JSON.parse(env.content).keys;
  assert.ok(keys[alice.pub] && keys[bob.pub], 'legitimate members fell out of the envelope — an over-matching filter anonymises real members');
  assert.ok(keys[D], 'the new member is missing from the envelope');
  assert.ok(keys[church.pub], 'the church itself must stay a recipient');
  assert.equal(keys[C], undefined,
    'the member just blocked was sealed back into the name key from the stale `have` map — the grow-path re-add');
});

test('unblocking replaces the local set — the filter follows the newest list, not history', async () => {
  const C = K().pub, D = K().pub;
  const rig = blockRig({ [church.pub]: 1, [alice.pub]: 1 });
  rig.api.setBlocked([C]);
  rig.api.setBlocked([]);                                         // the steward unblocks — full replacement, not append
  await rig.api._ensureNameKeyLocked([alice.pub, C, D], []);
  const env = _nameEnvs(rig)[0];
  assert.ok(env, 'after the unblock the envelope must publish for the returning member');
  const keys = JSON.parse(env.content).keys;
  assert.ok(keys[C], 'the unblocked member must get keys back — the set is replaced, never merely appended to');
  assert.ok(keys[D] && keys[alice.pub]);
});

test('switching church resets the name key', () => {
  // subscribeNameKey is mounted once with an empty dependency list, so the ring was carried across an identity
  // switch — and the roster effect then published church A's key as church B's, wrapped to B's members. That
  // hands every member of B the key that opens A's sealed names.
  assert.match(STEWARD, /_nameKeyRing = \[\];\s*_nameKeyDocKeys = null;\s*_nameKeyChecked = false/,
    'the name key survives an identity switch and leaks between churches');
  const at = STEWARD.search(/_nameKeyRing = \[\];\s*_nameKeyDocKeys = null/);
  const near = STEWARD.slice(Math.max(0, at - 700), at);
  assert.match(near, /lastProfile = \{\}/, 'the reset must sit in setActiveIdentity beside the other per-identity state');
});

test('switching church resets the just-published clearance cache too', () => {
  // AUDIT-4 B6. Same family as the name-key reset above, and the same reasoning: setActiveIdentity clears
  // every per-church global precisely because carrying one across leaks between churches. _clearanceSent was
  // added by the read-before-write work and keyed by MEMBER PUBKEY ALONE — no church in the key — so within
  // its 15s freshness window a member who belongs to both churches could be skipped for the wrong one, and
  // church B would never receive their clearance. Their app for B then falls back to the minors: list the
  // relay will not serve an ordinary member, and treats them as an adult.
  //
  // Structural, like the name-key guard beside it: the behavioural cost of driving a full identity switch
  // through the bundle is high, and what matters is that the reset is present and sits in the right function.
  assert.match(STEWARD, /_clearanceSent\.clear\(\)/,
    'the just-published clearance cache is never cleared on an identity switch');
  const at = STEWARD.search(/_nameKeyRing = \[\];\s*_nameKeyDocKeys = null/);
  assert.ok(at > 0, 're-anchor: the identity-switch reset block moved');
  const block = STEWARD.slice(Math.max(0, at - 1200), at + 1200);
  assert.match(block, /_clearanceSent\.clear\(\)/,
    'the clearance cache is cleared somewhere, but NOT in setActiveIdentity beside the other per-church state ' +
    '— so a church switch still carries it across');
});

test('a member awaiting approval can still say what they are called', () => {
  // The relay deliberately lets a pending member write their sealed name so a gated church has a name to
  // approve — but the name KEY is served only to admitted members, and rightly so. Sealed to the church key
  // instead, so the steward sees it and nobody else does.
  const at = STEWARD.indexOf('openMemberName(content, authorPub)');
  assert.notEqual(at, -1, 'openMemberName no longer accepts the author, so the pending copy cannot be opened');
  // Seal with NO congregation key, exactly as a pending member does, using the shipped builder — then open it
  // as the console does. If the fallback is dropped, `c` becomes unreadable to the church and this goes red.
  const payload = sealDoc(alice)(church.pub, 'Grace', undefined);
  const c = JSON.parse(payload).c;
  assert.ok(c, 'a pending member with no congregation key publishes nothing, so a gated church sees a nameless npub');
  const got = JSON.parse(nip44v2.decrypt(c, nip44v2.utils.getConversationKey(church.sk, alice.pub)));
  assert.equal(got.name, 'Grace', 'the pending seal is not openable by the church key');
  // and it is NOT readable by a fellow member
  let leaked = false;
  try { JSON.parse(nip44v2.decrypt(c, nip44v2.utils.getConversationKey(bob.sk, alice.pub))); leaked = true; } catch (e) {}
  assert.equal(leaked, false, 'a pending member’s name is readable by other members');
});

test('the console actually reads sealed names', () => {
  // openMemberName had NO callers. The console resolved every name from the cleartext kind-0 beside it, so the
  // sealed copy was written by every member, stored by the relay, and read by nobody — the mechanism present
  // and doing nothing.
  assert.match(STEWARD, /window\.Steward\.openMemberName\(c, pk\)/, 'the roster does not use the sealed name');
  assert.match(STEWARD, /d === NAME_D \+ pub/, 'the console never subscribes to members’ sealed name documents');
});

// ── Stage 2: the name leaves kind-0 entirely ─────────────────────────────────────────────────────────────────
// Stage 1 sealed a member's name to their congregation and left the cleartext copy in kind-0 beside it, so the
// relay still held a named roster and the gate was only about who was allowed to read it. Stage 2 removes the
// copy. The thing that quietly depended on it was RESTORE: a member coming back from their 12 words on a new
// phone got their name from that kind-0, and nothing else on the network knew it. So the name document now
// carries a second copy sealed to the member's own key. AUDIT-2026-07-27.
function restoreSide(me) {
  const body = `
    const MEMBER_D = 'trinityone/member:', NAME_D = 'trinityone/name:';
    const decrypt = nip44v2.decrypt, getConversationKey = nip44v2.utils.getConversationKey;
    const nip44d = decrypt, nip44ck = getConversationKey;
    const pub = ${JSON.stringify(me.pub)};
    const sk = _SK;
    const _dtag = (e) => ((e.tags || []).find(t => t[0] === 'd') || [])[1] || '';
    ${grab(FELLOWSHIP, '_nameCipher')}
    ${grab(FELLOWSHIP, '_restoreFold')}
    return _restoreFold();
  `;
  return new Function('nip44v2', '_SK', body)(nip44v2, me.sk);
}
// The payload built by the SHIPPED _sealNameDoc, not by a copy of it here. Writing a second copy passed
// happily with the self-recovery half deleted from the real code.
function sealDoc(who) {
  const body = `
    const encrypt = nip44v2.encrypt, getConversationKey = nip44v2.utils.getConversationKey;
    const nip44e = encrypt, nip44ck = getConversationKey;
    const sk = _SK, pub = ${JSON.stringify(who.pub)};
    ${grab(FELLOWSHIP, '_sealNameDoc')}
    return _sealNameDoc;
  `;
  return new Function('nip44v2', '_SK', body)(nip44v2, who.sk);
}
const nameDoc = (who, cp, name, ring, at) => ({
  kind: 30078, pubkey: who.pub, created_at: at || now(),
  tags: [['d', 'trinityone/name:' + cp], ['t', 'trinityone'], ['church', cp]],
  content: sealDoc(who)(cp, name, ring),
});

test('a restored member gets their name back with no kind-0 anywhere', () => {
  const fold = restoreSide(alice);
  fold.add({ kind: 30078, pubkey: alice.pub, created_at: now(), tags: [['d', 'trinityone/member:' + church.pub]], content: JSON.stringify({ joined: now() }) });
  fold.add(nameDoc(alice, church.pub, 'Maria', K1));
  const r = fold.result();
  assert.deepEqual(r.churches, [church.pub], 'the church did not come back');
  assert.equal(r.name, 'Maria', 'restore brought the churches back and left the member nameless — nothing on the network can tell them who they are');
});

test('nobody else can read the recovery copy', () => {
  const doc = nameDoc(alice, church.pub, 'Maria', K1);
  const m = JSON.parse(doc.content).m;
  let leaked = false;
  // the church key, a fellow member, and the congregation key all in turn
  for (const trial of [() => nip44v2.decrypt(m, nip44v2.utils.getConversationKey(church.sk, alice.pub)),
                       () => nip44v2.decrypt(m, nip44v2.utils.getConversationKey(bob.sk, alice.pub)),
                       () => nip44v2.decrypt(m, K1)]) {
    try { JSON.parse(trial()); leaked = true; } catch (e) {}
  }
  assert.equal(leaked, false, 'the member’s own recovery copy is readable by someone else');
});

test('the congregation copy still opens for the congregation', () => {
  const m = memberSide(bob);
  m.ingest(church.pub, envelope([church.pub, bob.pub], [K1]));
  assert.equal(m.open(church.pub, alice.pub, nameDoc(alice, church.pub, 'Maria', K1).content), 'Maria',
    'the two-copy document broke the ordinary path — every name in the church goes blank');
});

test('a child’s name is not published in the clear either', () => {
  // The most sensitive instance: a child's name in a world-shaped cleartext profile, published by the parent's
  // own app at setup. And the guardian request beside it carried the child's name AND the parent's, in a
  // document any member of the church could read.
  const at = FELLOWSHIP.indexOf('createChildAccount');
  const fn = FELLOWSHIP.slice(at, at + 3000);
  assert.match(fn, /childProfile = \{\}/, 'a child’s kind-0 still carries their name');
  assert.doesNotMatch(fn, /parentName:/, 'the guardian request still carries the parent’s name in the clear');
  assert.doesNotMatch(fn, /childName: name/, 'the guardian request still carries the child’s name in the clear');
  assert.match(fn, /trinityone\/name:/, 'nothing publishes the child’s sealed name, so the steward sees a nameless npub');
});

// ── every kind-0 READER, not just the one I happened to look at ─────────────────────────────────────────────
// Scoping Stage 2 I grepped for `kind: 0` — which finds the two places that PUBLISH a profile — and reasoned
// about the readers I already knew. There were five readers, reachable by `e.kind === 0` / `kinds: [0]`, and
// two of them had their own private copy of the profile-cache logic. The member hub's copy was the worst: it
// is the roster the member app actually renders, and it overwrote a decrypted name with an empty string.
// AUDIT-2026-07-27.
test('no kind-0 reader overwrites a name that has already been decrypted', () => {
  const SRC = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
  const sites = [...SRC.matchAll(/profiles\[e\.pubkey\] = \{/g)];
  assert.ok(sites.length >= 2, 'expected at least two profile-cache writers; found ' + sites.length);
  for (const m of sites) {
    // the WHOLE line: the member hub computes `nm` (with the had.name fallback) before the assignment, so
    // slicing forward from the match alone reported a correct fix as broken.
    const line = SRC.slice(SRC.lastIndexOf('\n', m.index) + 1, SRC.indexOf('\n', m.index));
    assert.match(line, /\.\.\.had/, 'a kind-0 reader replaces the whole cached profile instead of merging — it will wipe a decrypted name');
    assert.match(line, /had\.name/, 'a kind-0 reader lets an empty kind-0 name win over one already decrypted');
  }
});

test('no kind-0 reader refetches every member for ever', () => {
  const SRC = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
  // "have we asked", never "did we get a name" — since Stage 2 no member's kind-0 has one, so a name-based
  // test matches every member of the church in every batch window, permanently.
  assert.doesNotMatch(SRC, /filter\(pk => !\(profiles\[pk\] && profiles\[pk\]\.name\)\)/,
    'a profile fetcher still refetches anything without a name — that is now every member, for ever');
  assert.doesNotMatch(SRC, /profAuthors\.has\(pk\) \|\| \(profiles\[pk\] && profiles\[pk\]\.name\)/,
    'the member hub still re-queues every member on every roster tick');
});

test('the roster row is not blanked by a nameless profile', () => {
  const SRC = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
  const at = SRC.indexOf('const m = hub.byPub.get(e.pubkey); if (m) {');
  assert.notEqual(at, -1, 'the member hub no longer updates roster rows from kind-0 — re-anchor this test');
  assert.match(SRC.slice(at, at + 220), /if \(nm\) m\.name = nm/,
    'the member hub writes the kind-0 name onto the roster row unconditionally, so a nameless profile blanks a decrypted name');
});

// ── getting your own name back after a locked boot ───────────────────────────────────────────────────────────
// A locked boot wipes every `trinityone.profile*` key — deliberate forensic hygiene, and the member's own name
// is identifying so it goes too. Before Stage 2 that was invisible: the name lived in the public kind-0 and
// came straight back. It does not any more, so ONE lock left a member permanently "Anonymous" — and because
// re-sealing needs the name in memory, their sealed copy would never refresh either, so a key rotation would
// erase them from the congregation for good. Found on a real phone, 2026-07-28.
function ownNameSide(me) {
  const body = `
    const decrypt = nip44v2.decrypt, getConversationKey = nip44v2.utils.getConversationKey;
    const nip44d = decrypt, nip44ck = getConversationKey;
    const PROFILE_KEY = 'trinityone.profile';
    const profiles = {}, saved = {};
    const localStorage = { setItem: (k,v) => { saved[k] = v; }, getItem: (k) => saved[k] || null };
    const saveProfiles = () => {};
    const window = { Fellowship: { myProfile: null }, dispatchEvent: () => {} };
    const CustomEvent = function(){};
    const pub = ${JSON.stringify(me.pub)};
    const sk = _SK;
    ${grab(FELLOWSHIP, '_nameCipher')}
    ${grab(FELLOWSHIP, '_recoverOwnName')}
    return { recover: _recoverOwnName, w: window, saved, profiles };
  `;
  return new Function('nip44v2', '_SK', body)(nip44v2, me.sk);
}

test('a member gets their own name back from their own sealed copy', () => {
  const side = ownNameSide(alice);
  const doc = nameDoc(alice, church.pub, 'Maria', K1);
  assert.equal(side.w.Fellowship.myProfile, null, 'sanity: the locked boot wiped the profile');
  const ok = side.recover(church.pub, doc);
  assert.equal(ok, true, 'the member cannot recover their own name — one lock leaves them Anonymous for ever');
  assert.equal(side.w.Fellowship.myProfile.name, 'Maria');
  assert.match(side.saved['trinityone.profile'] || '', /Maria/, 'the recovered name must be written back to disk, or the next boot loses it again');
});

test('it never overwrites a name the member already has', () => {
  const side = ownNameSide(alice);
  side.w.Fellowship.myProfile = { name: 'Maria Renamed' };
  const ok = side.recover(church.pub, nameDoc(alice, church.pub, 'Maria', K1));
  assert.equal(ok, false, 'recovery clobbered a name the member had already set');
  assert.equal(side.w.Fellowship.myProfile.name, 'Maria Renamed');
});

test('it only ever reads OUR OWN document', () => {
  const side = ownNameSide(alice);
  const ok = side.recover(church.pub, nameDoc(bob, church.pub, 'Bob', K1));
  assert.equal(ok, false, 'a member adopted someone else’s name as their own');
  assert.equal(side.w.Fellowship.myProfile, null);
});

// ── a member awaiting approval must still have a name ────────────────────────────────────────────────────────
// Reported 2026-07-28: a phone joined as "Testi Bob" and appeared on the steward console as "Anon". Confirmed
// against the live relay — 19 members had a join document and only 18 had a name; the missing one was the
// phone. publishSealedName has always handled the pending case, sealing to the CHURCH key because a member
// awaiting approval has no congregation key by design. That fallback was unreachable: syncSealedNames built
// its list from _nameKeys, so the only people it skipped were precisely the ones a steward needs to see —
// the ones asking to join, whose name is how you decide whether to approve them.
test('the sync covers churches we hold no congregation key for', () => {
  // Anchor on the DEFINITION. Plain indexOf('syncSealedNames') found an earlier call site and tested a
  // window of unrelated code — reporting a correct fix as broken.
  const at = FELLOWSHIP.search(/async syncSealedNames\s*\(/);
  assert.notEqual(at, -1, 'syncSealedNames is gone from the shipped bundle');
  const fn = FELLOWSHIP.slice(at, at + 1400);
  assert.match(fn, /_docsHubs\.keys\(\)/,
    'the list is built from the congregation keys we hold, so a member awaiting approval is skipped and shows as Anon');
  assert.doesNotMatch(fn, /!\(_nameKeys\.get\(cp\) \|\| \[\]\)\.length\) continue/,
    'a missing congregation key still skips the member — the pending fallback stays unreachable');
});

test('and the pending copy it writes is the one the church can open', () => {
  // Belt and braces: prove the shape a pending member ends up publishing is readable by the church key and
  // by nobody else. This is what the steward console reads to put a name on a join request.
  const payload = sealDoc(alice)(church.pub, 'Testi Bob', undefined);
  const c = JSON.parse(payload).c;
  const got = JSON.parse(nip44v2.decrypt(c, nip44v2.utils.getConversationKey(church.sk, alice.pub)));
  assert.equal(got.name, 'Testi Bob', 'the church cannot read a pending member’s name');
  let leaked = false;
  try { JSON.parse(nip44v2.decrypt(c, nip44v2.utils.getConversationKey(bob.sk, alice.pub))); leaked = true; } catch (e) {}
  assert.equal(leaked, false, 'another member can read a pending member’s name');
});

// ── and the rest of the profile a locked boot wiped ──────────────────────────────────────────────────────────
// Reported the same afternoon I fixed the NAME: "Testi Bob's picture has gone". The locked-boot wipe takes the
// whole stored profile — name, about, picture, avatar — and _recoverOwnName restored only the name, so a
// member's photo vanished on every locked boot and came back only if they noticed and re-added it. Unlike the
// name, these ARE published in kind-0, so they can simply be read back. AUDIT-2026-07-28.
function ownProfileSide(me, current) {
  const body = `
    const PROFILE_KEY = 'trinityone.profile';
    const saved = {};
    const localStorage = { setItem: (k,v) => { saved[k] = v; }, getItem: (k) => saved[k] || null };
    const window = { Fellowship: { myProfile: CURRENT }, dispatchEvent: () => {} };
    const CustomEvent = function(){};
    const pub = ${JSON.stringify(me.pub)};
    ${grab(FELLOWSHIP, '_recoverOwnProfile')}
    return { recover: _recoverOwnProfile, w: window, saved };
  `.replace('CURRENT', JSON.stringify(current));
  return new Function(body)();
}
const k0 = (who, content) => ({ pubkey: who.pub, kind: 0, content: JSON.stringify(content) });
const PHOTO = { kind: 'photo', color: '#C2913A', photo: 'data:image/webp;base64,AAAA' };

test('a wiped profile gets its picture and avatar back from our own kind-0', () => {
  const side = ownProfileSide(alice, { name: 'Maria' });   // name recovered already; the rest still missing
  assert.equal(side.recover(k0(alice, { about: 'hello', picture: 'data:image/png;base64,BBBB', av: PHOTO })), true);
  assert.equal(side.w.Fellowship.myProfile.av.kind, 'photo', 'the avatar was not restored');
  assert.equal(side.w.Fellowship.myProfile.picture, 'data:image/png;base64,BBBB');
  assert.equal(side.w.Fellowship.myProfile.name, 'Maria', 'recovery must not disturb the name');
  assert.match(side.saved['trinityone.profile'] || '', /photo/, 'it must be written back, or the next boot loses it again');
});

test('it never undoes a newer picture the member just set', () => {
  const side = ownProfileSide(alice, { name: 'Maria', av: { kind: 'symbol', color: '#111' } });
  assert.equal(side.recover(k0(alice, { av: PHOTO })), false, 'an older published avatar overwrote a newer local one');
  assert.equal(side.w.Fellowship.myProfile.av.kind, 'symbol');
});

test('it only ever reads OUR OWN profile', () => {
  const side = ownProfileSide(alice, {});
  assert.equal(side.recover(k0(bob, { av: PHOTO })), false, 'a member adopted someone else’s avatar');
  assert.equal(side.w.Fellowship.myProfile.av, undefined);
});

test('and something actually asks for it', () => {
  assert.match(FELLOWSHIP, /!mine\.av && !mine\.picture\)[\s\S]{0,80}requestProfiles/,
    'nothing requests our own kind-0, so the refill only happens by luck');
});

// ── a sealed name must not block the avatar ──────────────────────────────────────────────────────────────────
// Reported 2026-07-28: display pictures missing in chat, while showing correctly in the steward console.
// A regression from Stage 2. _openSealedName creates a profiles entry holding ONLY a name, and requestProfiles
// had been changed to skip anyone "already in profiles" — so for every member whose name arrived by the sealed
// route, their kind-0 was never fetched, and kind-0 is where the avatar lives. The console was unaffected
// because subscribeMembers resolves profiles by a different path.
test('having a sealed name does not stop the avatar being fetched', () => {
  const at = FELLOWSHIP.search(/requestProfiles\s*\(pubkeys\)/);
  assert.notEqual(at, -1, 'requestProfiles is gone from the shipped bundle');
  const fn = FELLOWSHIP.slice(at, at + 700);
  assert.doesNotMatch(fn, /!\(pk in profiles\)/,
    'the fetch is gated on having an ENTRY — a sealed name creates one with no avatar, so kind-0 never arrives');
  assert.match(fn, /_k0Seen\.has\(pk\)/,
    'the fetch must be gated on whether we ASKED the relay, not on whether some entry exists');
});

test('but a member with no profile at all is not re-asked for ever', () => {
  // The churn this replaced was real: gating on "has a name" refetched every member in every batch window.
  assert.match(FELLOWSHIP, /oneose\(\)\s*\{[^}]*_k0Seen\.add\(pk\)/,
    'nothing marks a pubkey as asked when the relay answers with nothing, so it will be re-asked in every window');
});

// ── two bugs an adversarial review of my own work found, 2026-07-28 ──────────────────────────────────────────
test('a mid-session lock does not blank every face for the rest of the session', () => {
  // clearCommunityCache empties `profiles`, which is what made the OLD fetch gate self-healing. Gating on
  // _k0Seen instead fixed the churn and removed that healing: after a lock, every member was filtered out of
  // requestProfiles for ever, so no kind-0 arrived again. Our own profile too — so _recoverOwnProfile never
  // ran, and the next edit republished a kind-0 with an empty picture, destroying the photo on the relay.
  const at = FELLOWSHIP.search(/clearCommunityCache/);
  assert.notEqual(at, -1, 'clearCommunityCache is gone');
  const fn = FELLOWSHIP.slice(at, at + 1600);
  assert.match(fn, /_k0Seen\.clear\(\)/,
    'the wipe does not reset "have we asked the relay", so a lock leaves every member permanently unfetchable');
});

test('an admitted member is never downgraded to the church-key name copy', () => {
  // Dropping the ring check let a PENDING member publish (right) and also let an ADMITTED member republish
  // while the ring was transiently empty — a locked boot, or a warm buffer. That took the church-key branch
  // and replaced their congregation-sealed name with one only the owner can read: Anonymous to everyone else.
  const at = FELLOWSHIP.search(/async syncSealedNames\s*\(/);
  const fn = FELLOWSHIP.slice(at, at + 1400);
  assert.match(fn, /hub\.eosed/,
    'syncSealedNames publishes on an empty ring without waiting for the relay to answer, so a boot race downgrades a real member');
  const ringAt = fn.indexOf('ring.length'), pubAt = fn.indexOf('publishSealedName');
  assert.ok(ringAt !== -1 && ringAt < pubAt, 'the ring must be checked before anything is published');
});

// ── "a restore never publishes over a profile it has not read" USED TO LIVE HERE ────────────────────────
// It asserted that `_k0Seen.has(pub)` appeared in setProfile, before `const wire =`. Both strings were
// present in the vulnerable code, so the test could not fail: it was green for a full day standing over a
// live bug that was destroying members' photos and directory opt-outs on the relay, and its green tick is
// what stopped anyone looking again. AUDIT-2026-07-28 F1/F13.
//
// A test shaped like the FIX cannot fail while the bug survives beside it. The real coverage is
// scripts/profile-overwrite.test.mjs, which RUNS the shipped setProfile against a relay that never answers
// and asserts on what came out on the wire. Do not re-add a string-matching version of this here.

test('the directory opt-out survives a locked boot too', () => {
  // `hidden` is published, so it was always recoverable — it simply was not recovered, so a lock silently
  // made a member who had opted OUT of the directory visible again.
  const at = FELLOWSHIP.indexOf('function _recoverOwnProfile');
  const fn = fnBody(FELLOWSHIP, at);
  assert.match(fn, /hidden/, 'a member who opted out of the directory is made visible again by a lock');
});
