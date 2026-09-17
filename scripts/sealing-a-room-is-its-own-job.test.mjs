// SEALING A ROOM IS ITS OWN JOB — the relay door for `trinityone/groupkey:`.
// Run: node --test scripts/sealing-a-room-is-its-own-job.test.mjs
//
// PLAIN ENGLISH, because the failure this closes is easy to say and was hard to see. An "encrypted room" in
// this app is a room whose messages are locked. The key that unlocks it is one document — `groupkey:<room>` —
// and the church wraps a copy of it for each person who is allowed in.
//
// That document had NO RULE OF ITS OWN at the relay. It fell off the end of accept()'s list onto the generic
// last line, `if (!isMember) return false`, and `isMember` asks a question with no church in it: "is this key
// a member of ANY congregation on this box?" Measured on a live relay before this branch existed:
//
//   · A STEWARD OF THIS CHURCH WHO HAD NOT ALSO JOINED IT WAS REFUSED — verbatim
//     ["OK",…,false,"blocked: not a member or not permitted for this group"]. The relay let her make the
//     room, flip it to encrypted and write a rota into it, and then refused the key. The room existed, said
//     it was encrypted, and nobody could read a word in it. Publishing a `member:` document for her made the
//     identical write succeed, which pins the cause to membership and nothing else.
//   · A MEMBER OF A DIFFERENT CHURCH ON THE SAME RELAY WAS ACCEPTED writing this church's room key.
//
// The wrong person got in and the right person was kept out, by one missing rule. The owner's line:
// "There should be Nothing that crosses churches."
//
// AND THE FIX IS NOT "give it the same rule as group:". That rule is the `content` capability, which already
// covers groups, plans, devotionals, rotas, rosters, services, rooms, bookings, run sheets, categories and
// pinned sermons. Minting a room's key means HOLDING that key, and holding it means being able to read the
// room — so "may run the rotas" and "may read the sealed rooms" are now two different ticks. The new one is
// `sealedrooms`.
//
// WHY stewardCan AND NOT stewardCanExplicitly, asserted below rather than argued. An UNSCOPED steward — one
// the church has never narrowed — could seal a room yesterday, through the very catch-all this branch
// replaces, provided they had also joined the church. An explicit-only gate would take that away the morning
// the relay updated, which is the availability failure the note on stewardCan() exists to forbid. The
// children's register was the opposite case (no delegate of any kind could open one before its capability
// existed), which is why that one IS explicit.
//
// WHAT THIS FILE DOES NOT COVER, said out loud: the three console-honesty defects found in the same
// investigation are a separate job and are untouched here — the background key distributor's silent forever
// retry, the setup wizard un-flagging a room whose key failed, and the Groups list painting "Encrypted" off
// the group document's flag with no check that a key exists.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const PORT = 19911;                       // a HIGH port, so a concurrent suite on the usual fixed ports cannot collide
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const STEWARDS_D = 'trinityone/stewards:', GROUP_D = 'trinityone/group:', GROUPKEY_D = 'trinityone/groupkey:';
const MEMBER_D = 'trinityone/member:', ROTA_D = 'trinityone/rota:';
const now = () => Math.floor(Date.now() / 1000);
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

// TWO CHURCHES ON ONE BOX, which is the ordinary case for this product and not an exotic one: relay/church.json
// carries nine today. Without the second church the cross-church half of this cannot be measured at all.
const A = K();                    // "our" church
const B = K();                    // a co-tenant congregation that has never heard of us
const sealer   = K();             // steward of A, caps ['sealedrooms'], NOT a member of A
const contentOnly = K();          // steward of A, caps ['content'] — may run the rotas, may not hold the key
const unscoped = K();             // steward of A with NO caps entry at all — the compatibility case
const bMember  = K();             // an ordinary member of B, and of nowhere else
const aMember  = K();             // an ordinary member of A, no steward seat — the catch-all's old beneficiary

const GID = A.pub.slice(0, 16) + '-prayer';       // the shape the console mints: <churchpub16>-<something>
const BGID = B.pub.slice(0, 16) + '-bprayer';
let relay, dataDir;

async function waitReady(ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('relay never came up');
}
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res({ ok: m[2], why: m[3] || '' }); } };
  ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt]));
});
function readAuthed(ws, subId, filter, who, window = 700) {
  return new Promise((resolve) => {
    const events = [];
    const on = (d) => {
      const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === subId) events.push(m[2]);
      else if (m[0] === 'AUTH') ws.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)]));
    };
    ws.on('message', on); ws.send(JSON.stringify(['REQ', subId, filter]));
    setTimeout(() => { ws.off('message', on); try { ws.send(JSON.stringify(['CLOSE', subId])); } catch {} resolve(events); }, window);
  });
}

// STRICTLY NEWER EACH TIME, for the same reason relay-steward-caps.test.mjs says: a replaceable event ties on
// created_at and NIP-01 breaks the tie by event id, so two rosters inside one second are a coin flip and the
// loser reads exactly like the relay ignoring capabilities.
let rosterAt = now();
const rosterA = (caps) => finalizeEvent({ kind: 30078, created_at: ++rosterAt, tags: [['d', STEWARDS_D + A.pub], ['t', NET]],
  content: JSON.stringify(caps === null
    ? { pubkeys: [sealer.pub, contentOnly.pub, unscoped.pub] }
    : { pubkeys: [sealer.pub, contentOnly.pub, unscoped.pub], caps }) }, A.sk);

const group   = (who, cp, id) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', GROUP_D + id], ['t', NET], ['church', cp]], content: JSON.stringify({ name: 'Prayer', kind: 'group', encrypted: true }) }, who.sk);
// The envelope EXACTLY as publishGroupKey signs it: no ['church'] tag anywhere, because publishGroupKey does
// not go through feChurch. A rule that resolved the owning church from a tag would pass this test against a
// hand-made event and fail against every envelope the product actually writes.
let keyAt = now();
const groupkey = (who, id) => finalizeEvent({ kind: 30078, created_at: ++keyAt, tags: [['d', GROUPKEY_D + id], ['t', NET]], content: JSON.stringify({ rev: 1, keys: {}, rings: {} }) }, who.sk);
const memberDoc = (who, cp) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', MEMBER_D + cp], ['t', NET]], content: JSON.stringify({ joined: now() }) }, who.sk);
const rota = (who, cp) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', ROTA_D + cp.slice(0, 16) + '-sun'], ['t', NET], ['church', cp]], content: JSON.stringify({ name: 'Sunday' }) }, who.sk);

before(async () => {
  await requireFreePort(PORT, 'sealing-a-room-is-its-own-job.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-seal-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(A.pub) + ',' + npubEncode(B.pub), RELAY_MAX_EVENTS: '5000' },
    stdio: 'ignore',
  });
  await waitReady();
  const ws = await connect();
  // Both congregations, their members and their rooms. Asserted rather than fired-and-forgotten: a seeding
  // step that silently failed would make every refusal below read as the new rule biting when it is really
  // the fixture being empty.
  assert.equal((await publish(ws, memberDoc(aMember, A.pub))).ok, true, 'seed: A member could not join A');
  assert.equal((await publish(ws, memberDoc(bMember, B.pub))).ok, true, 'seed: B member could not join B');
  assert.equal((await publish(ws, group(A, A.pub, GID))).ok, true, 'seed: church A could not define its own room');
  assert.equal((await publish(ws, group(B, B.pub, BGID))).ok, true, 'seed: church B could not define its own room');
  assert.equal((await publish(ws, rosterA({ [sealer.pub]: ['sealedrooms'], [contentOnly.pub]: ['content'] }))).ok, true, 'seed: A could not publish its steward roster');
  await new Promise(r => setTimeout(r, 150));
  ws.close();
});
after(() => { try { relay.kill(); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── THE CONTROL. Every probe below reads an OK/false off a socket, and an OK/false is also what a relay that
// never came up, a fixture that never seeded and a d-tag nobody gates produce. This row has a known answer.
test('CONTROL: the relay is up, carrying BOTH churches, and the fixture actually seeded', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/status`);
  assert.ok(r.ok, 'the relay never came up, so nothing below proves anything');
  // ONE SOCKET PER IDENTITY. NIP-42 binds a connection to the pubkey that answered its challenge, so a second
  // read down the same socket is answered as the FIRST identity however the handler is written — which is a
  // way to read zero and call it a refusal. Learned here: the first draft of this control did exactly that.
  const wsA = await connect();
  const seen = await readAuthed(wsA, 'ctl', { kinds: [30078], '#d': [GROUP_D + GID] }, A);
  assert.equal(seen.length, 1, 'church A\'s own room definition is not on the relay — the fixture did not seed, so every refusal below is vacuous');
  wsA.close();
  const wsB = await connect();
  const seenB = await readAuthed(wsB, 'ctl2', { kinds: [30078], '#d': [GROUP_D + BGID] }, B);
  assert.equal(seenB.length, 1, 'church B is not really on this box, so the cross-church rows below prove nothing');
  wsB.close();
});

// ── THE ROW THAT WAS THE BUG. A steward of this church, not a member of it. ───────────────────────────────
test('a steward with Sealed rooms, who never joined the church, may write its room key', async () => {
  const ws = await connect();
  // First prove she is genuinely NOT a member, or the row below could be passing for the old reason.
  const her = await readAuthed(ws, 'mem', { kinds: [30078], '#d': [MEMBER_D + A.pub], authors: [sealer.pub] }, A);
  assert.equal(her.length, 0, 're-anchor: this steward has a member: document, so this is no longer the case the bug was about');
  const r = await publish(ws, groupkey(sealer, GID));
  assert.equal(r.ok, true,
    'the steward the church ticked for Sealed rooms was refused her own room\'s key: "' + r.why + '". ' +
    'The relay lets her create the room and flip it to encrypted, so the room exists, says it is encrypted, ' +
    'and nobody can read a word in it.');
  ws.close();
});

test('and she can still do it after the church reaches her — being a member changes nothing either way', async () => {
  const ws = await connect();
  assert.equal((await publish(ws, memberDoc(sealer, A.pub))).ok, true, 're-anchor: the steward could not join her own church');
  await new Promise(r => setTimeout(r, 120));
  assert.equal((await publish(ws, groupkey(sealer, GID))).ok, true, 'joining the church took the capability away');
  ws.close();
});

// ── THE ROW THAT MAKES THE CAPABILITY MEAN SOMETHING. ────────────────────────────────────────────────────
test('a steward scoped to Groups & rotas may run the rotas and may NOT hold the room key', async () => {
  const ws = await connect();
  assert.equal((await publish(ws, rota(contentOnly, A.pub))).ok, true,
    're-anchor: the content steward cannot write a rota either, so the refusal below says nothing about ' +
    'sealed rooms — it says the roster never landed');
  const r = await publish(ws, groupkey(contentOnly, GID));
  assert.equal(r.ok, false,
    'a steward given Groups & rotas alone minted an encrypted room\'s key. Minting it means holding it, and ' +
    'holding it means reading the room — so "may run the rotas" would silently be "may read the private rooms".');
  ws.close();
});

// ── THE CROSSING, which the same line closes. ────────────────────────────────────────────────────────────
test('a member of a CO-TENANT church is refused this church\'s room key', async () => {
  const ws = await connect();
  // Prove they are a real, accepted member of somewhere — otherwise the refusal is just "unknown key".
  assert.equal((await publish(ws, memberDoc(bMember, B.pub))).ok, true, 're-anchor: the co-tenant member is not actually a member of B');
  const r = await publish(ws, groupkey(bMember, GID));
  assert.equal(r.ok, false,
    'a member of a different congregation on the same relay wrote OUR room\'s key. These documents are ' +
    'addressable, so their copy REPLACES ours and every phone in this church loses the room. ' +
    'The owner\'s rule: there should be nothing that crosses churches.');
  ws.close();
});

test('and a steward of the co-tenant church is refused too, capability or not', async () => {
  const ws = await connect();
  // B gives bMember EVERY capability including sealedrooms — on ITS OWN roster. Ours is not its to write.
  const bRoster = finalizeEvent({ kind: 30078, created_at: ++rosterAt, tags: [['d', STEWARDS_D + B.pub], ['t', NET]],
    content: JSON.stringify({ pubkeys: [bMember.pub], caps: { [bMember.pub]: ['sealedrooms', 'content'] } }) }, B.sk);
  assert.equal((await publish(ws, bRoster)).ok, true, 're-anchor: church B could not publish its own roster');
  await new Promise(r => setTimeout(r, 150));
  assert.equal((await publish(ws, groupkey(bMember, BGID))).ok, true,
    're-anchor: B\'s own steward cannot seal B\'s own room, so the refusal below is not about crossing');
  const r = await publish(ws, groupkey(bMember, GID));
  assert.equal(r.ok, false, 'a steward of ANOTHER church held our room\'s key because their own church ticked a box');
  ws.close();
});

// ── AND THE TWO ROWS THE SABOTAGE MATRIX ADDED. The first draft of this file did NOT catch a resolution
//    that asked the WRITER instead of the GROUP: S4 — reordering the owner lookup to `namedChurch(e) ||
//    (CHURCH_PUBS.has(e.pubkey) ? e.pubkey : '') || GROUP_CHURCH.get(gid)` — left all fourteen rows green.
//    Both rows below are the same property said twice: NOTHING TRUSTS A ['church'] TAG ON ITS OWN, and
//    being *a* church on this box is not being *THIS* church.
test('a CO-TENANT CHURCH\'S OWN KEY cannot replace our room\'s key', async () => {
  const ws = await connect();
  // B is a fully configured church here and can seal its OWN room — proved first, so the refusal below is
  // about whose room it is and not about B being unknown to the relay.
  assert.equal((await publish(ws, groupkey(B, BGID))).ok, true, 're-anchor: church B cannot seal its own room');
  const r = await publish(ws, groupkey(B, GID));
  assert.equal(r.ok, false,
    'another congregation\'s church key replaced OUR room\'s key. This is the shape of AUDIT-2026-07-24 ' +
    'CRITICAL-1: being *a* church key on the box was enough to rewrite *another* church\'s group. These ' +
    'documents are addressable, so their envelope REPLACES ours and every phone in this church loses the room.');
  ws.close();
});

test('and naming your own church in a [\'church\'] tag does not move the room to it', async () => {
  const ws = await connect();
  // bMember holds ['sealedrooms'] on B's own roster (granted two tests above) and now writes OUR room's key
  // while tagging the event with B. A rule that resolved the owning church from the tag would accept this.
  const forged = finalizeEvent({ kind: 30078, created_at: ++keyAt,
    tags: [['d', GROUPKEY_D + GID], ['t', NET], ['church', B.pub]],
    content: JSON.stringify({ rev: 1, keys: {}, rings: {} }) }, bMember.sk);
  assert.equal((await publish(ws, forged)).ok, false,
    'the owning church was taken from a tag the writer chose. A room belongs to the church that owns the ' +
    'GROUP; the tag is a claim, not a fact — "NOTHING TRUSTS A [\'church\'] TAG ON ITS OWN".');
  ws.close();
});

// ── AN ORDINARY MEMBER OF THIS CHURCH. The catch-all used to admit them; nothing ever chose that. ────────
test('an ordinary member of this church may no longer mint a room key', async () => {
  const ws = await connect();
  const r = await publish(ws, groupkey(aMember, GID));
  assert.equal(r.ok, false,
    'any member of the congregation could replace the room key, which locks everyone else out of a room ' +
    'they are in. The old catch-all allowed this and nobody chose it.');
  ws.close();
});

// ── THE CHURCH'S OWN KEY, WHICH MUST NEVER BE REFUSED. Three shapes of id, including one the relay has ────
//    never seen a definition for, because that is the case a resolution bug would break.
test('the church\'s own key always seals — known room, unknown room, and a room whose id names nobody', async () => {
  const ws = await connect();
  assert.equal((await publish(ws, groupkey(A, GID))).ok, true, 'the church was refused the key to its own room');
  const unknown = A.pub.slice(0, 16) + '-never-defined-here';
  assert.equal((await publish(ws, groupkey(A, unknown))).ok, true,
    'the church was refused a room this relay has no definition for. publish() resolves on the FIRST relay ' +
    'to accept, so a relay that has not yet received the group document is the ordinary case, not a corner.');
  assert.equal((await publish(ws, groupkey(A, 'legacy-room-no-owner-prefix'))).ok, true,
    'the church was refused a room whose id predates the owner prefix');
  ws.close();
});

test('an envelope for no room at all is refused', async () => {
  const ws = await connect();
  assert.equal((await publish(ws, groupkey(A, ''))).ok, false, 'an envelope addressed to no room was accepted');
  ws.close();
});

// ── (C) COMPATIBILITY, BOTH WAYS. This is the decision the brief asked to be made deliberately. ──────────
test('an UNSCOPED steward keeps sealing — the compatibility case, and the reason this is not an explicit-only gate', async () => {
  const ws = await connect();
  // `unscoped` is on the roster and absent from `caps`, which is what every roster written before
  // capabilities existed means: as powerful as before.
  const r = await publish(ws, groupkey(unscoped, GID));
  assert.equal(r.ok, true,
    'a steward the church never narrowed lost the ability to seal a room the morning the relay updated. ' +
    'That is an availability failure dressed as a security improvement — and it is exactly what the console ' +
    'produces when an owner ticks EVERY box, because the capability editor collapses "all ticked" to ' +
    'caps: null (unscoped).');
  ws.close();
});

test('…and an EXPLICIT empty list still means nothing at all', async () => {
  const ws = await connect();
  const nobody = K();
  assert.equal((await publish(ws, finalizeEvent({ kind: 30078, created_at: ++rosterAt, tags: [['d', STEWARDS_D + A.pub], ['t', NET]],
    content: JSON.stringify({ pubkeys: [sealer.pub, contentOnly.pub, unscoped.pub, nobody.pub], caps: { [sealer.pub]: ['sealedrooms'], [contentOnly.pub]: ['content'], [nobody.pub]: [] } }) }, A.sk))).ok, true,
    're-anchor: the roster itself was refused');
  await new Promise(r => setTimeout(r, 150));
  assert.equal((await publish(ws, groupkey(nobody, GID))).ok, false, 'a steward with an explicit empty capability list sealed a room');
  assert.equal((await publish(ws, groupkey(sealer, GID))).ok, true, 're-anchor: the sealer lost the capability when the roster was rewritten');
  ws.close();
});

// ── NOTHING ALREADY STORED STOPS BEING SERVED. The rule is a WRITE gate; canRead is untouched. ───────────
test('every envelope already on disk is still served, to a member and to the church', async () => {
  const ws = await connect();
  const asMember = await readAuthed(ws, 'ro', { kinds: [30078], '#d': [GROUPKEY_D + GID] }, aMember);
  assert.equal(asMember.length, 1,
    'a member of the church is no longer served the key to a room they are in. The new rule is a write gate ' +
    'and must not have touched reads at all.');
  const asChurch = await readAuthed(ws, 'rc', { kinds: [30078], '#d': [GROUPKEY_D + GID] }, A);
  assert.equal(asChurch.length, 1, 'the church is no longer served its own room key');
  ws.close();
});

// ── THE INGEST PATH. Confirmed, not asserted: a new write rule must not be able to run over a restore. ───
test('the rule cannot run on the ingest path — /import and peer sync call store.put with no accept() pass', () => {
  // WHY THIS MATTERS ENOUGH TO TEST. Replaying a write gate over an import once deleted a church's whole
  // finance journal and everyone who was on it. So the separation is load-bearing, and a rule added here
  // must be shown to be on the DOOR only. Read the source rather than trusting the memory of it.
  const src = readFileSync(new URL('./gateway.mjs', import.meta.url), 'utf8');
  const i = src.indexOf('if (d.startsWith(GROUPKEY_D)) {');
  assert.ok(i > 0, 're-anchor: the groupkey branch is gone from gateway.mjs');
  // exactly one such branch, and it is inside accept()
  assert.equal(src.split('if (d.startsWith(GROUPKEY_D)) {').length - 1, 1, 'there is more than one groupkey branch — say which door each is on');
  const acceptAt = src.indexOf('function accept(e) {');
  assert.ok(acceptAt > 0 && i > acceptAt, 'the groupkey branch is not inside accept()');
  // EVERY store.put() SITE, and none of them may call accept(). Three exist: the /import loop, the restore
  // route and the relay-to-relay pull. Each takes its own hand-picked, MAP-FREE guards (carereqIdOk,
  // arrivalIdOk, checkinSessionOkOnIngest, checkinPermFutureOk) precisely because the door's rules cannot
  // run there — the new groupkey rule reads GROUP_CHURCH, a hydrated map, so it is a door rule and only that.
  const code = src.split('\n').filter(l => !l.trim().startsWith('//'));
  const putLines = code.filter(l => l.includes('store.put('));
  assert.ok(putLines.length >= 3, 're-anchor: the store.put sites have moved; found ' + putLines.length);
  const withAccept = putLines.filter(l => /\baccept\s*\(/.test(l));
  assert.deepEqual(withAccept, [],
    'an ingest path now runs accept(). Replaying the write gate over an import once deleted a church\'s ' +
    'whole finance journal, and a rule added at the door must not have reached the restore.');
  assert.ok(/GROUP_CHURCH\.get\(gid\)/.test(src.slice(i, i + 900)),
    're-anchor: the branch no longer reads GROUP_CHURCH, so the claim that it is a door-only rule needs rechecking');
});

// ── AND THE DOOR IS THE ONLY THING BEING TRUSTED. A last structural check with a known answer. ───────────
test('the branch RETURNS on every path — it never narrows a document and then falls through', () => {
  // The finance read-gate defect was exactly this shape: a branch that selected a document, applied a
  // condition, and then fell out of the `if` to the permissive code below, serving it to everyone anyway.
  const src = readFileSync(new URL('./gateway.mjs', import.meta.url), 'utf8');
  const i = src.indexOf('if (d.startsWith(GROUPKEY_D)) {');
  const body = src.slice(i, src.indexOf('\n    }\n', i) + 6);
  const stmts = body.split('\n').map(l => l.trim())
    .filter(l => l && !l.startsWith('//') && l !== '}' && !l.startsWith('if (d.startsWith(GROUPKEY_D))'));
  // every line that decides something must decide it with a `return`
  const decidesWithoutReturning = stmts.filter(l => /^if\s*\(/.test(l) && !/return/.test(l));
  assert.deepEqual(decidesWithoutReturning, [], 'a condition in the groupkey branch does not return — it falls through');
  assert.match(body, /return e\.pubkey === owner/, 're-anchor: the branch no longer ends in a return');
});

// ── LAST, BECAUSE IT REWRITES THE ROSTER FOR EVERYBODY. The shape every church in the field has today. ──
test('a roster written before capabilities existed — no `caps` key at all — keeps sealing', async () => {
  // The (C) case in its commonest real form. `caps` absent for the WHOLE roster, not merely for one steward:
  // that is what every roster published before 2026-08-19 looks like, and it is what the console produces the
  // moment an owner who never opened the capability panel presses Remove on somebody. If upgrading the relay
  // stopped those churches sealing rooms, this would be an availability failure dressed as a fix.
  const ws = await connect();
  assert.equal((await publish(ws, rosterA(null))).ok, true, 're-anchor: the plain roster was refused');
  await new Promise(r => setTimeout(r, 150));
  for (const [who, name] of [[sealer, 'the sealer'], [contentOnly, 'the content steward'], [unscoped, 'the unscoped steward']]) {
    assert.equal((await publish(ws, groupkey(who, GID))).ok, true,
      name + ' lost the ability to seal a room the morning the relay updated, because their church has ' +
      'never written a capability list at all');
  }
  // …and it still does not let a co-tenant in. An unscoped roster widens THIS church, never the box.
  assert.equal((await publish(ws, groupkey(bMember, GID))).ok, false, 'an unscoped roster let another church\'s member in');
  ws.close();
});
