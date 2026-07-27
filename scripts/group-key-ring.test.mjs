// Rotating an encrypted group's key must NOT erase everyone's history.
// Run: node --test scripts/group-key-ring.test.mjs
//
// I INTRODUCED THIS BUG on 2026-07-27. Blocking a member correctly rotated the care key and the media key but
// never a group key, so a blocked phone kept decrypting the group forever. My fix added
// `publishGroupKey(g.id, recips, {rotate:true})` for every encrypted group — and group keys, unlike care keys,
// had NO KEY RING. `_gkeys[k]` held exactly one key, `_decEvt` returned null when it could not open a message,
// and both callers did `if (!dec) return;` — so the message was DROPPED, not shown as locked. Blocking one
// spammer would have silently erased the readable history of the whole congregation's encrypted chat, on every
// phone, permanently.
//
// The care key had already solved this (`_careKeyRing`, "current key first, then superseded ones — so rotation
// never orphans old ciphertext"). This test drives the SHIPPED member bundle and asserts the group key now
// behaves the same way, including accepting the old bare-hex envelope shape from a console that hasn't updated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { v2 as nip44v2 } from 'nostr-tools/nip44';

const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const hex = (u8) => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K(), alice = K(), bob = K();
const GID = 'grp-prayer';
const now = () => Math.floor(Date.now() / 1000);

// Lift the real _ingestGroupKey/_decEvt out of the shipped bundle and run them with a scope we control.
function memberSide(me) {
  const grab = (name) => {
    const at = FELLOWSHIP.indexOf('function ' + name + '(');
    assert.notEqual(at, -1, name + ' missing from the shipped member bundle');
    let depth = 0, end = -1;
    for (let i = FELLOWSHIP.indexOf('{', at); i < FELLOWSHIP.length; i++) {
      const c = FELLOWSHIP[i];
      if (c === '{') depth++; else if (c === '}' && --depth === 0) { end = i + 1; break; }
    }
    return FELLOWSHIP.slice(at, end);
  };
  const src = `
    const GROUPKEY_D = "trinityone/groupkey:", NET = "trinityone", FUTURE_SKEW = 900;
    const _gkeys = {}, _gkeyTs = {}, _churchRoster = new Map();
    const _gkKey = (cp, gid) => cp + "|" + gid;
    const _unhex = (s) => Uint8Array.from(String(s).match(/.{1,2}/g).map(b => parseInt(b, 16)));
    // esbuild renames the nip44 imports in the bundle: the lifted code calls decrypt/getConversationKey,
    // not nip44d/nip44ck. Declaring the wrong names made _ingestGroupKey throw into its own try/catch and
    // store nothing, which looked exactly like the bug under test. Provide both spellings.
    const decrypt = nip44v2.decrypt, getConversationKey = nip44v2.utils.getConversationKey;
    const nip44d = decrypt, nip44ck = getConversationKey;
    const pub = ${JSON.stringify(me.pub)};
    const sk = _unhex(${JSON.stringify(hex(me.sk))});
    ${grab('_ingestGroupKey')}
    ${grab('_decEvt')}
    return { ingest: _ingestGroupKey, dec: _decEvt, keys: _gkeys, gkKey: _gkKey };
  `;
  return new Function('nip44v2', src)(nip44v2);
}

// Build an envelope exactly as the console's publishGroupKey does. `wrapped` is what gets sealed per recipient.
const envelope = (rev, recips, wrapped, at) => {
  const keys = {};
  for (const pk of recips) keys[pk] = nip44v2.encrypt(wrapped, nip44v2.utils.getConversationKey(church.sk, pk));
  return { pubkey: church.pub, created_at: at || now(), tags: [['d', 'trinityone/groupkey:' + GID], ['t', 'trinityone']], content: JSON.stringify({ rev, keys }) };
};
// An encrypted group message, as sendMessage seals it.
const encMsg = (key, text) => ({ pubkey: alice.pub, created_at: now(), tags: [['t', 'trinityone'], ['t', GID], ['enc', '1']], content: nip44v2.encrypt(text, key) });

const K1 = crypto.getRandomValues(new Uint8Array(32));
const K2 = crypto.getRandomValues(new Uint8Array(32));

test('a member still reads pre-rotation history after a block rotates the key', () => {
  const m = memberSide(alice);
  m.ingest(church.pub, envelope(1, [church.pub, alice.pub, bob.pub], JSON.stringify([hex(K1)]), now() - 100));
  const old = encMsg(K1, 'prayer request from before the block');
  assert.equal(m.dec(church.pub, old).content, 'prayer request from before the block', 'sanity: the pre-rotation message opens');

  // the steward blocks Bob → rotate: new key first, superseded ones after
  m.ingest(church.pub, envelope(2, [church.pub, alice.pub], JSON.stringify([hex(K2), hex(K1)]), now()));

  const fresh = m.dec(church.pub, encMsg(K2, 'after the block'));
  assert.ok(fresh, 'a message under the NEW key must open');
  assert.equal(fresh.content, 'after the block');

  const still = m.dec(church.pub, old);
  assert.ok(still, 'the whole group’s history was erased by a rotation — every message before the block is gone from every phone');
  assert.equal(still.content, 'prayer request from before the block');
});

test('the blocked member loses the new key and cannot read what comes after', () => {
  const b = memberSide(bob);
  b.ingest(church.pub, envelope(1, [church.pub, alice.pub, bob.pub], JSON.stringify([hex(K1)]), now() - 100));
  assert.ok(b.dec(church.pub, encMsg(K1, 'before')), 'sanity: Bob could read before he was blocked');
  b.ingest(church.pub, envelope(2, [church.pub, alice.pub], JSON.stringify([hex(K2), hex(K1)]), now()));
  assert.equal(b.dec(church.pub, encMsg(K2, 'after the block')), null,
    'the blocked member is still decrypting the group — the rotation achieved nothing');
});

test('an envelope from an OLD console (bare hex, no ring) still works', () => {
  // Back-compat matters: a church whose console has not updated publishes the old shape. The care key
  // handles both ("older envelopes hold a bare hex string — accept both") and this must too, or updating
  // the member app before the console blanks every encrypted group.
  const m = memberSide(alice);
  m.ingest(church.pub, envelope(1, [church.pub, alice.pub], hex(K1), now()));
  const got = m.dec(church.pub, encMsg(K1, 'old-format envelope'));
  assert.ok(got, 'a bare-hex envelope from an un-updated console must still open the group');
  assert.equal(got.content, 'old-format envelope');
});

test('a message no key in the ring can open is still refused', () => {
  const m = memberSide(alice);
  m.ingest(church.pub, envelope(2, [church.pub, alice.pub], JSON.stringify([hex(K2), hex(K1)]), now()));
  const other = crypto.getRandomValues(new Uint8Array(32));
  assert.equal(m.dec(church.pub, encMsg(other, 'not for this group')), null,
    'the ring must not become a way to open anything');
});

test('an untrusted author cannot install a key ring', () => {
  const m = memberSide(alice);
  const evil = K();
  const bad = envelope(9, [church.pub, alice.pub], JSON.stringify([hex(K2)]), now());
  bad.pubkey = evil.pub;   // not the church, not a rostered steward
  m.ingest(church.pub, bad);
  assert.equal(m.keys[m.gkKey(church.pub, GID)], undefined, 'a stranger installed a group key');
});

// ── console side ───────────────────────────────────────────────────────────────────────────────────────────
// Structural, and weaker than the behavioural tests above: publishGroupKey lives inside a bundled object
// literal with a live relay pool, so it cannot be lifted and run the way _ingestGroupKey can. These catch a
// deletion, not a subtle break. The load-bearing guarantee is the member-side round trip above.

test('the console publishes a RING, not a single key', () => {
  const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
  const at = STEWARD.indexOf('publishGroupKey(');
  assert.notEqual(at, -1, 'publishGroupKey missing from the shipped console bundle');
  const body = STEWARD.slice(at, at + 2000);
  assert.match(body, /ring\s*=\s*\[\s*key,\s*\.\.\.ring\s*\]/, 'rotation no longer carries the superseded keys — a block will erase the group’s history again');
  assert.match(body, /JSON\.stringify\(r\.map\(/, 'the envelope must wrap the whole ring');
  assert.doesNotMatch(body, /nip44e\(_hex\(key\)/, 'the envelope is still wrapping one bare key');
});

test('the console seals new posts under the CURRENT key only', () => {
  const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
  assert.match(STEWARD, /_skeys\[group\]\s*\|\|\s*\[\]\)\[0\]/, 'posts must be sealed under ring[0], never an arbitrary ring entry');
});

test('blocking is refused while acting as a delegated steward, and never re-keys a blocked member', () => {
  const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
  const at = DASH.indexOf('const block = (pk)');
  const body = DASH.slice(at, at + 2600);
  assert.match(body, /!delegated\s*&&\s*Array\.isArray\(groups\)/,
    'a delegated steward can re-key another church’s group under the wrong key and lock the owner out');
  const dist = DASH.slice(DASH.indexOf('const memberPubs = members.map'), DASH.indexOf('const memberPubs = members.map') + 600);
  assert.match(dist, /filter\(notBlocked\)/,
    'the key distributor hands the freshly-rotated key straight back to the blocked member on the next roster tick');
});

// ── the phones that have NOT updated ─────────────────────────────────────────────────────────────────────────
// The ring shipped as a straight payload change: the envelope stopped carrying a bare hex key and started
// carrying a JSON array. The compat note above reasoned about updating the member app before the console. The
// direction that actually happens is the reverse — the console and relay update first and phones follow over
// days — and in THAT direction an installed app parses `["ab..","cd.."]` through _unhex into garbage, fails to
// decrypt, and _decEvt drops the message at both call sites. Every member on an un-updated phone would have
// opened their group to an EMPTY ROOM, with no error and nothing to diagnose. AUDIT-2026-07-27.
//
// OLD_PARSE below is a frozen copy of the ingest that shipped. It is deliberately NOT read from the repo: it
// stands in for APKs already installed on people's phones, which no future commit can change.
const OLD_PARSE = (envContent, me) => {
  const env = JSON.parse(envContent || '{}');
  const mine = env.keys && env.keys[me.pub];
  if (!mine) return null;
  const plain = nip44v2.decrypt(mine, nip44v2.utils.getConversationKey(me.sk, church.pub));
  return Uint8Array.from(String(plain).match(/.{1,2}/g).map(b => parseInt(b, 16)));   // _unhex, verbatim
};

// Build the envelope with the CONSOLE'S OWN builder, lifted out of the shipped bundle. Writing a second copy
// of it here passed its own sabotage happily — a mirror test asserts that my idea of the envelope works, not
// that the console emits it. publishGroupKey itself can't be lifted (live relay pool), but `build` is a
// self-contained arrow, so this is the real thing.
const consoleBuild = (recips) => {
  const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
  const at = STEWARD.indexOf('const build = (r) =>');
  assert.notEqual(at, -1, 'the console’s envelope builder is gone from the shipped bundle');
  let depth = 0, end = -1;
  for (let i = STEWARD.indexOf('{', at); i < STEWARD.length; i++) {
    const c = STEWARD[i];
    if (c === '{') depth++; else if (c === '}' && --depth === 0) { end = i + 1; break; }
  }
  const src = `
    const rev2 = 2, recips = RECIPS, churchSk = SK;
    const _hex = HEX, getConversationKey = CK, encrypt3 = ENC;
    ${STEWARD.slice(at, end)};
    return build;
  `.replace('RECIPS', JSON.stringify(recips)).replace('SK', 'SKV').replace('HEX', 'HEXV').replace('CK', 'CKV').replace('ENC', 'ENCV');
  return new Function('SKV', 'HEXV', 'CKV', 'ENCV', src)(church.sk, hex, nip44v2.utils.getConversationKey, nip44v2.encrypt);
};

const dualEnvelope = (rev, recips, ring, at) => ({
  pubkey: church.pub, created_at: at || now(),
  tags: [['d', 'trinityone/groupkey:' + GID], ['t', 'trinityone']],
  content: consoleBuild(recips)(ring),
});

test('a phone that has NOT updated still reads the group after the console updates', () => {
  const env = dualEnvelope(2, [church.pub, alice.pub], [K2, K1]);
  const got = OLD_PARSE(env.content, alice);
  assert.ok(got, 'an un-updated phone got nothing from the new envelope');
  assert.equal(got.length, 32, 'an un-updated phone parsed the envelope into a ' + got.length + '-byte key — every encrypted group goes silently empty');
  assert.equal(hex(got), hex(K2), 'the un-updated phone must end up with the CURRENT group key');
});

test('an updated phone still gets the whole ring from the same envelope', () => {
  const m = memberSide(alice);
  m.ingest(church.pub, dualEnvelope(2, [church.pub, alice.pub], [K2, K1]));
  assert.equal(m.dec(church.pub, encMsg(K2, 'after')).content, 'after', 'the current key must open new messages');
  assert.equal(m.dec(church.pub, encMsg(K1, 'before')).content, 'before', 'the superseded key must still open history');
});

test('the console writes BOTH shapes, and bounds the envelope', () => {
  const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
  const at = STEWARD.indexOf('const build = (r)');
  assert.notEqual(at, -1, 'the dual-shape envelope builder is gone — un-updated phones will go blind');
  const body = STEWARD.slice(at, at + 700);
  assert.match(body, /keys\[pk\]\s*=\s*\w+\(cur,/, 'the current key must still be sealed bare under `keys` for un-updated phones');
  assert.match(body, /rings\[pk\]\s*=\s*\w+\(wrapped,/, 'the ring must be sealed under `rings`');
  assert.match(STEWARD, /content\.length\s*>\s*(?:900000|9e5)/, 'nothing stops a large church sealing the ring past the relay’s 1 MB cap');
});
