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
import { fnBody } from './test-slice.mjs';
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
  // Brace-matched, not a fixed 2600-character window: adding the delegated name-key guard and its explanation
  // pushed the group guard out of view and turned a correct fix red. Third time a fixed window has done this.
  const body = (() => { let d = 0; for (let i = DASH.indexOf('{', at); i < DASH.length; i++) { const c = DASH[i]; if (c === '{') d++; else if (c === '}' && --d === 0) return DASH.slice(at, i + 1); } return DASH.slice(at); })();
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

test('unblocking someone gives their keys back', () => {
  // `unblock` only rewrites the blocklist. The key distributor's effect closes over blockedSet through
  // notBlocked but did not list it as a dependency, so nothing re-ran: the person returned to the roster and
  // never received the group, care, media or name keys again. They saw empty rooms indefinitely, and weeks
  // after a reconciliation nobody would think to suspect keys. AUDIT-2026-07-27.
  const D = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
  const at = D.indexOf('const memberPubs = members.map');
  assert.notEqual(at, -1, 'the key distributor effect is gone');
  const deps = D.slice(at, D.indexOf('React.useEffect', at + 10));
  assert.match(deps, /\}, \[groups, members, stewardRoster, blockedList\]\)/,
    'blockedList is not a dependency of the key distributor — unblocking a member never restores their keys');
});

// A MEMBER WE COULD NOT KEY MUST NOT DISAPPEAR QUIETLY.
//
// THE DEFECT (independent audit, 2026-08-13). Three silent routes left a member without a room's key, and
// the member side treats "no copy for me" as REMOVAL — it deletes any key it held. So they lost the room
// rather than merely failing to gain it. Harmless-ish while a keyless member could still post in clear;
// once the send started refusing rather than publishing unlocked, it became permanent mutism with the app
// telling them to try again in a moment, for ever, and nobody — not them, not a steward — being told.
//
//   1. the console's per-member seal was `catch (e) {}`: one unusable pubkey was skipped and the publish
//      reported success. Skipping is right; being silent about it is not.
//   2. the background distributor recorded the new roster as handled whether or not anything was published,
//      and the publish it calls does nothing at all if that console has not yet received the room's key
//      envelope. The next tick then saw no change and never retried.
//   3. a delegated console cannot key at all (unchanged here — it is guarded elsewhere).
test('the console reports the members it could not seal to', () => {
  const SRC2 = readFileSync(new URL('../src/steward.src.js', import.meta.url), 'utf8');
  const at = SRC2.indexOf('async publishGroupKey(');
  assert.notEqual(at, -1, 'publishGroupKey moved — re-anchor rather than widening this test');
  const body = SRC2.slice(at, SRC2.indexOf('\n  },', at));
  assert.match(body, /catch \(e\) \{ missed\.push\(pk\); \}/,
    'a member the church cannot seal to is skipped silently, and the envelope publishes as a success — they ' +
    'lose the room and nobody is told');
  assert.match(body, /return \{ ok: true, skipped: skipped\.slice\(\) \};/,
    'the skips are collected but never handed back, so the caller cannot report them either');
  assert.match(body, /if \(ok === false\) return false;/,
    'a refused publish still reports success, so a failed key distribution looks identical to a good one');
});

// ── a locally-blocked member never re-enters the envelope (AUDIT-2026-08-10 item B) ────────────────────────
// The group-key sibling of the name-key race: the roster effect calls publishGroupKey with the same stale
// list in the same window after a block, so the console that performed the block wrapped the fresh key
// straight back to the blocked pubkey. EXECUTES the shipped publishGroupKey, lifted whole from
// vendor/steward.js with its collaborators stubbed.
test('a locally-blocked member is excluded from the group key envelope', async () => {
  const STEW2 = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
  const method = fnBody(STEW2, 'async publishGroupKey(', 'publishGroupKey in the shipped bundle');
  const C = K().pub;
  const src = `
    let _localBlocked = new Set([C]);
    const _skeys = { g1: [new Uint8Array(32).fill(9)] }, _srev = { g1: 1 }, _senvTs = {};
    const GROUP_RING_MAX = 12, GROUPKEY_D = 'trinityone/groupkey:', NET = 'trinityone';
    const churchSk = new Uint8Array(32).fill(3), churchPub = CP;
    const _isRelayAuthed = () => true;
    const now = () => 1000;
    const _hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
    const toPubHex = (p) => /^[0-9a-f]{64}$/i.test(p) ? String(p).toLowerCase() : null;
    // esbuild renames the nip44 imports in the bundle — provide both spellings
    const encrypt3 = () => 'ct', getConversationKey = () => 'ck';
    const nip44e = encrypt3, nip44ck = getConversationKey;
    const published = [];
    const publish = async (evt) => { published.push(evt); return evt; };
    const finalizeEvent2 = (t) => t, finalizeEvent = finalizeEvent2;
    const api = { ${method} };
    return { api, published };
  `;
  const rig = new Function('CP', 'C', src)(church.pub, C);
  const out = await rig.api.publishGroupKey('g1', [alice.pub, C]);
  assert.ok(out !== null && out !== false, 'sanity: the publish itself must go through');
  const keys = JSON.parse(rig.published[0].content).keys;
  assert.ok(keys[alice.pub], 'a legitimate member fell out of the envelope — an over-matching filter mutes real members');
  assert.ok(keys[church.pub], 'the church itself must stay a recipient');
  assert.equal(keys[C], undefined,
    'the freshly-rotated group key was wrapped straight back to the member just blocked');
});

// ── the distributor loop, EXECUTED ─────────────────────────────────────────────────────────────────────────
// AUDIT-2026-08-10 item C. subscribeMembers coalesces at ~150ms and re-emits a fresh array on every church
// event burst, so the roster effect re-runs constantly. The retry-on-failure semantics above are right, but
// without an in-flight guard a slow envelope publish is fired AGAIN on the next tick, and a persistently
// refused one is re-sent on EVERY tick — full near-1 MB envelopes, repeatedly, on the metered links this
// product is built for. These tests lift the real loop out of app/stew-dashboard.jsx and DRIVE it: comments
// cannot satisfy them, and a mutant that advances `last` optimistically or drops the guard goes red.
function distributorRig() {
  const D = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
  const loop = fnBody(D, 'for (const g of groups) {', 'the key distributor loop');
  const rig = {
    calls: [],
    result: Promise.resolve(true),          // what publishGroupKey resolves for the next call(s)
    nowVal: 1_000_000,                      // fake clock, advanced by hand
    last: { current: {} }, pending: { current: {} }, nextTry: { current: {} }, failCount: { current: {} },
  };
  const win = {
    Steward: { publishGroupKey: (gid, recips, opts) => { rig.calls.push([gid, [...recips], opts]); return rig.result; } },
    dispatchEvent: () => {},
  };
  const fakeDate = { now: () => rig.nowVal };
  const fn = new Function('groups', 'memberPubs', 'notBlocked', 'last', 'pending', 'nextTry', 'failCount',
    'window', 'Date', 'CustomEvent', loop);
  rig.tick = (groups, memberPubs) => fn(groups, memberPubs, () => true, rig.last, rig.pending, rig.nextTry,
    rig.failCount, win, fakeDate, function CustomEvent() {});
  return rig;
}
const settle = () => new Promise(res => setImmediate(res));
const G1 = { id: 'g1', name: 'Prayer', encrypted: true };

test('distributor: a publish in flight is not fired again by the next roster tick', async () => {
  const r = distributorRig();
  let resolve1; r.result = new Promise(res => { resolve1 = res; });
  r.tick([G1], ['a']);                       // first sighting — seeds `last`, publishes nothing
  assert.equal(r.calls.length, 0, 'sanity: the first sighting is already keyed by create/edit');
  r.tick([G1], ['a', 'b']);                  // someone joined → one publish starts
  r.tick([G1], ['a', 'b']);                  // the 150ms coalesced re-emit lands while it is still in flight
  r.tick([G1], ['a', 'b']);
  assert.equal(r.calls.length, 1, 'a slow envelope publish was fired again while still in flight — the metered-link burn');
  resolve1(true); await settle();
  r.tick([G1], ['a', 'b']);                  // done and recorded — nothing more to send
  assert.equal(r.calls.length, 1);
});

test('distributor: a roster that grew DURING the flight is still retried after it ends', async () => {
  const r = distributorRig();
  let resolve1; r.result = new Promise(res => { resolve1 = res; });
  r.tick([G1], ['a']);
  r.tick([G1], ['a', 'b']);                  // publish for a,b in flight
  r.tick([G1], ['a', 'b', 'c']);             // c joins mid-flight — skipped now, must NOT be lost
  assert.equal(r.calls.length, 1);
  resolve1(true); await settle();            // `last` advances with the a,b captured AT CALL TIME
  r.result = Promise.resolve(true);
  r.tick([G1], ['a', 'b', 'c']);
  assert.equal(r.calls.length, 2, 'the joiner who arrived during the flight was never keyed — silent, permanent');
  assert.deepEqual(r.calls[1][1].sort(), ['a', 'b', 'c']);
});

test('distributor: a refused publish backs off instead of hammering, then retries and succeeds', async () => {
  const r = distributorRig();
  r.result = Promise.resolve(false);         // the relay refuses (size, quota, down)
  r.tick([G1], ['a']);
  r.tick([G1], ['a', 'b']);
  await settle();
  assert.equal(r.calls.length, 1);
  r.tick([G1], ['a', 'b']);                  // next coalesced tick, milliseconds later
  await settle();
  assert.equal(r.calls.length, 1, 'a refused near-1 MB envelope is re-sent on every 150ms roster tick');
  r.nowVal += 61_000;                        // past the 60s backoff cap
  r.result = Promise.resolve(true);
  r.tick([G1], ['a', 'b']);
  await settle();
  assert.equal(r.calls.length, 2, 'backoff must be a delay, not a tombstone — the retry is the whole repair');
  r.tick([G1], ['a', 'b']);                  // success advanced `last` — no further sends
  assert.equal(r.calls.length, 2, 'success must advance `last` (the never-publish mutant fails here)');
});

test('distributor: a rejected publish clears the in-flight guard rather than wedging the group', async () => {
  const r = distributorRig();
  r.result = Promise.reject(new Error('socket died'));
  r.tick([G1], ['a']);
  r.tick([G1], ['a', 'b']);
  await settle();
  assert.equal(r.calls.length, 1);
  assert.ok(!r.pending.current.g1, 'the guard stayed shut after a throw — this group is silently wedged for ever');
  r.result = Promise.resolve(true);
  r.tick([G1], ['a', 'b']);
  await settle();
  assert.equal(r.calls.length, 2, 'after a throw the next tick must try again');
});

test('a room that could not be keyed is retried, not marked done', () => {
  const DASH2 = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
  // Brace-matched, not a fixed window: test-windows.test.mjs exists because a hand-picked character count
  // silently stops covering the code it names the moment that code grows, and every assertion after the cut
  // then reads a truncated slice and passes over nothing. This one was 532 characters short on its first run.
  const body = fnBody(DASH2, 'if (key !== prev) {', 'the key distributor branch');
  assert.match(body, /if \(r === null \|\| r === false\) return;/,
    'the roster is recorded as handled even when nothing was published — publishGroupKey does nothing when ' +
    'this console has no ring yet, so the member who joined in that window is never keyed, and the next ' +
    'tick sees no change and never comes back');
  assert.match(DASH2, /could not be given the key for/,
    'members that could not be keyed are not surfaced to the steward, who is the only person able to fix it');
  assert.match(DASH2, /steward-write-blocked'[^)]*group key/s,
    'the warning does not go through the console\'s existing write-blocked channel, so it is raised somewhere ' +
    'nobody is watching');
});
