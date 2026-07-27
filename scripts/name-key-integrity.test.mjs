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
  assert.match(fn, /if \(!_nameKeyChecked \|\| !_relayAuthed\) return/, 'the console will mint from a view it never established');
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
