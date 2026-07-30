// CROSS-TENANT WRITES into relay-global id namespaces. Run: node --test scripts/relay-tenancy-write.test.mjs
//
// WHY THIS FILE EXISTS. `relay-tenancy.test.mjs` proves church B cannot READ church A's documents. It never
// tested whether B can WRITE into an id namespace A is using — and `group:<id>` / `roster:<id>` are keyed by a
// bare id with no church in the d-tag, so "is a configured church key" was the whole write gate. That gap was
// worth two criticals (AUDIT-2026-07-24), both proven with a live PoC:
//
//   1. B republishes `group:<A's group id>` WITHOUT visibility:invite. The relay's GROUP_VIS now says "open",
//      and canRead() serves every message ever posted in A's private group to ANONYMOUS connections.
//   2. B republishes `roster:<A's care-team id>` listing itself. careAdmin(B, A) becomes true, which is a read
//      grant for A's ask-for-help requests, safeguarding lists and entire member roster.
//
// Both are now refused: an id belongs to the church that first defined it (idOwnerOk), enforced in accept()
// AND in note() (so a forgery already on disk cannot win on rehydrate).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8857;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const MEMBER_D = 'trinityone/member:', GROUP_D = 'trinityone/group:', ROSTER_D = 'trinityone/roster:';
const MEALS_SETTINGS_D = 'trinityone/meals-settings', CAREREQ_D = 'trinityone/carereq:';
// AUDIT-2026-07-30 S1/S3/S4, item 6 of the fix plan. accept() builds ONE relay-wide `isMember` over the union of
// every church's members, so six write rules ask "a member of anything?" where they mean "a member of THIS
// church". canRead() was hoisted onto a scoped helper (effMemberOf/churchReader) and the write side was not.
const MINORS_D = 'trinityone/minors:', AVAIL_D = 'trinityone/careavail:', SAFE_D = 'trinityone/safe:';
const NETWORK_D = 'trinityone/network:';
const OPEN_GID = 'grpA-prayer-open', OPEN_GID_B = 'grpB-prayer-open';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const A = K(), B = K(), alice = K(), mallory = K();   // A = victim church, B = co-tenant attacker church
const bob = K();   // a member of B ONLY — never joined A. The whole point of the cross-tenant cases.
// BELONGING IS NOT EXCLUSIVE, and the fix must not assume it is. Owner correction, 2026-07-30: "a person can be
// members of a number of churches, and can be members of a church network." So the scoped question is "a member
// of THIS church?", never "which church is this person's?" — two very different rules, and only one is right.
const dual = K();   // a member of BOTH A and B — every scoped rule must keep letting them write to EITHER
const netA = K();   // a network A declared. Church-level authority over A, and none at all over B.
const GID = 'grpA-private-leadership', TEAM = 'teamA-care';
let relay, dataDir, pub;

async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', 'trinityone'], ...extra], content: JSON.stringify(content) }, who.sk);
// a group message carries ['t', <groupId>] alongside ['t','trinityone'] — that is what gidOf() reads
const chat = (who, gid, text) => finalizeEvent({ kind: 1, created_at: now(), tags: [['t', 'trinityone'], ['t', gid]], content: text }, who.sk);

function reqCollect(ws, subId, filter, authSk, window = 700) {
  return new Promise((resolve) => {
    const events = [];
    const on = (d) => { const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === subId) events.push(m[2]);
      else if (m[0] === 'AUTH' && authSk) ws.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, authSk)])); };
    ws.on('message', on); ws.send(JSON.stringify(['REQ', subId, filter]));
    setTimeout(() => { ws.off('message', on); try { ws.send(JSON.stringify(['CLOSE', subId])); } catch {} resolve(events); }, window);
  });
}

before(async () => {
  await requireFreePort(PORT, 'relay-tenancy-write.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-xtenant-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000', CHURCH_NPUB: `${npubEncode(A.pub)},${npubEncode(B.pub)}` },
    stdio: 'ignore',
  });
  await waitReady();
  pub = await connect();
  // church A: a member, a PRIVATE (invite-only) leadership group, a care team, and a member's help request
  assert.equal((await publish(pub, doc(alice, MEMBER_D + A.pub, { joined: now() })))[0], true);
  assert.equal((await publish(pub, doc(mallory, MEMBER_D + A.pub, { joined: now() })))[0], true);
  assert.equal((await publish(pub, doc(A, GROUP_D + GID, { name: 'Leadership', visibility: 'invite', members: [alice.pub] })))[0], true);
  assert.equal((await publish(pub, doc(A, ROSTER_D + TEAM, { people: [{ pub: alice.pub }] })))[0], true);
  assert.equal((await publish(pub, doc(A, MEALS_SETTINGS_D, { enabled: true, adminGroupId: TEAM })))[0], true);
  await sleep(150);
  assert.equal((await publish(pub, chat(alice, GID, 'MEETING AT THE FARMHOUSE 9PM')))[0], true, 'a member of the private group can post');
  assert.equal((await publish(pub, doc(alice, CAREREQ_D + 'r1', { keys: {}, enc: 'SEALED' }, [['church', A.pub]])))[0], true);
  // …and the pieces the cross-tenant cases need: a member of B, and A's ORDINARY open group. The invite-only
  // group above was already guarded (AUDIT-2026-07-24); the OPEN group — the one a congregation actually talks
  // in — was never brought along.
  assert.equal((await publish(pub, doc(bob, MEMBER_D + B.pub, { joined: now() })))[0], true, 'bob must be able to join his OWN church');
  assert.equal((await publish(pub, doc(A, GROUP_D + OPEN_GID, { name: 'Prayer', kind: 'group' }, [['church', A.pub]])))[0], true);
  // …and the pieces the OVER-TIGHTENING controls need: someone who belongs to both churches, a group in B for
  // them to write to, and a network A declared (and B did not).
  assert.equal((await publish(pub, doc(dual, MEMBER_D + A.pub, { joined: now() })))[0], true, 'dual must be able to join A');
  assert.equal((await publish(pub, doc(dual, MEMBER_D + B.pub, { joined: now() })))[0], true, 'dual must be able to join B as well');
  assert.equal((await publish(pub, doc(B, GROUP_D + OPEN_GID_B, { name: 'Prayer', kind: 'group' }, [['church', B.pub]])))[0], true);
  assert.equal((await publish(pub, doc(A, NETWORK_D + netA.pub, { joined: now() }, [['church', A.pub]])))[0], true, 'A must be able to declare a network');
  await sleep(150);
});
after(() => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('a co-tenant church CANNOT redefine another church’s group id', async () => {
  const [ok] = await publish(pub, doc(B, GROUP_D + GID, { name: 'Leadership', members: [mallory.pub] }));
  assert.equal(ok, false, 'church B redefining A’s group id must be refused');
});

test('the private group’s messages stay withheld from anonymous readers', async () => {
  const ws = await connect(); const got = await reqCollect(ws, 'x1', { kinds: [1], '#t': [GID] }); ws.close();
  assert.equal(got.length, 0, 'an anonymous REQ must not receive a message from an invite-only group');
});

test('a co-tenant church CANNOT rewrite another church’s team roster', async () => {
  const [ok] = await publish(pub, doc(B, ROSTER_D + TEAM, { people: [{ pub: mallory.pub }] }));
  assert.equal(ok, false, 'church B rewriting A’s care-team roster must be refused');
});

test('the hijack does not grant care-admin: A’s sealed help request stays private', async () => {
  const ws = await connect(); const got = await reqCollect(ws, 'x2', { kinds: [30078], '#d': [CAREREQ_D + 'r1'] }, mallory.sk); ws.close();
  assert.equal(got.length, 0, 'a member who forged the roster must not read A’s ask-for-help request');
});

test('the OWNING church can still edit its own group and roster (the guard is not a lockout)', async () => {
  assert.equal((await publish(pub, doc(A, GROUP_D + GID, { name: 'Leadership team', visibility: 'invite', members: [alice.pub, mallory.pub] })))[0], true);
  assert.equal((await publish(pub, doc(A, ROSTER_D + TEAM, { people: [{ pub: alice.pub }, { pub: mallory.pub }] })))[0], true);
});


// ── AUDIT-2026-07-30 S1/S3/S4 — cross-tenant WRITES. Item 6 of the fix plan. ──────────────────────────────
//
// These are marked `todo` DELIBERATELY, and that is the point of this commit: they document a reproduction that
// FAILS against today's code. A todo test runs and reports without breaking the suite, so the repro is committed
// and visible instead of living in a session. Removing `todo` is the FIRST step of the scoping fix — each rule
// change then has a case that is proved to bite before the rule is touched.
//
// Latent, not live: a8 hosts ONE church with self-registration locked (gateway.mjs:2585 refuses when
// `!community && CHURCH_PUBS.size`). They go live the day a second church shares a box, or "Offer to host" is
// switched on — which is a deliberate product direction, so this is "before the first shared relay".
//
// Each case carries a CONTROL that must stay ACCEPT. Scoping too tightly would silently disable genuine
// members, which is worse than the finding.

test('S1: a member of another church CANNOT post into this church’s open group', { todo: 'reproduction for the accept() scoping fix — fails today' }, async () => {
  const control = await publish(pub, chat(alice, OPEN_GID, 'CONTROL: a real member of A'));
  assert.equal(control[0], true, 'a genuine member of A must still be able to post — if this fails the fix is a lockout');
  const attack = await publish(pub, chat(bob, OPEN_GID, 'INJECTED by a member of church B'));
  assert.equal(attack[0], false,
    'a member of church B posted into church A’s group chat, and it is delivered to A’s members as ordinary ' +
    'chat. gateway.mjs’s kind-1 tail ends `return isMember`, which is relay-wide. The same hole was closed for ' +
    'broadcast groups and for invite-only groups; the ordinary open group was not brought along.');
});

test('S3: a co-tenant church CANNOT mark another church’s adult as a minor', { todo: 'reproduction for the accept() scoping fix — fails today' }, async () => {
  const before = await publish(pub, doc(mallory, AVAIL_D + A.pub, { free: true }, [['church', A.pub]]));
  assert.equal(before[0], true, 'CONTROL: an adult of A can register as available before B interferes');
  // church B lists an adult of church A — who has never joined B — in B's own minors list
  assert.equal((await publish(pub, doc(B, MINORS_D + B.pub, { pubkeys: [mallory.pub] })))[0], true);
  await sleep(200);
  const after = await publish(pub, doc(mallory, AVAIL_D + A.pub, { free: true }, [['church', A.pub]]));
  assert.equal(after[0], true,
    'after church B listed them, an adult of church A can no longer register as available to help their OWN ' +
    'church. accept() consults the relay-wide MINORS union; safeguardAllows() was scoped per-church for exactly ' +
    'this reason (REVIEW-2026-07-20 B4) and these two call sites were not. A targeted, silent denial of service.');
});

test('S4: a member of another church CANNOT answer this church’s emergency safety check', { todo: 'reproduction for the accept() scoping fix — fails today' }, async () => {
  const control = await publish(pub, doc(alice, SAFE_D + A.pub, { state: 'safe' }));
  assert.equal(control[0], true, 'CONTROL: a real member of A must still be able to mark themselves safe');
  const attack = await publish(pub, doc(bob, SAFE_D + A.pub, { state: 'safe' }));
  assert.equal(attack[0], false,
    'a member of church B answered church A’s safety roll-call. This is the post-emergency head count — the ' +
    'highest-stakes moment in the product — and subscribeSafetyResponses applies no roster filter, while the ' +
    'NIP-44 conversation key is symmetric, so the forgery DECRYPTS AND DISPLAYS as a genuine "safe".');
});

test('S4b: a member of another church CANNOT join this church’s here-to-help register', { todo: 'reproduction for the accept() scoping fix — fails today' }, async () => {
  const attack = await publish(pub, doc(bob, AVAIL_D + A.pub, { free: true }, [['church', A.pub]]));
  assert.equal(attack[0], false,
    'a member of church B appears in church A’s volunteer register. Same unscoped `isMember` as S1/S4.');
});

// ── OVER-TIGHTENING CONTROLS. These pass TODAY and must still pass after the scoping fix. ─────────────────
//
// Owner correction, 2026-07-30: a person may belong to SEVERAL churches, and to a church network. So the fix
// must ask "is this author a member of the church that owns the thing being written?" — never "which single
// church does this author belong to?". If any of these turn red, the fix has silently disabled real people, and
// that is a worse bug than the cross-tenant writes it closes: a member locked out of their own congregation's
// chat sees an app that simply does not work, with nothing on screen to say why.
//
// They are ordinary tests, not `todo`, precisely because they are green before the change. That is what makes
// them a guard rather than a wish.

test('CONTROL: someone who belongs to BOTH churches can write to EITHER — open group chat', async () => {
  assert.equal((await publish(pub, chat(dual, OPEN_GID, 'dual writes in A')))[0], true,
    'a member of both A and B was refused in A’s group — the scoping is treating belonging as exclusive');
  assert.equal((await publish(pub, chat(dual, OPEN_GID_B, 'dual writes in B')))[0], true,
    'a member of both A and B was refused in B’s group — the scoping is treating belonging as exclusive');
});

test('CONTROL: …and to the here-to-help register of BOTH', async () => {
  assert.equal((await publish(pub, doc(dual, AVAIL_D + A.pub, { free: true }, [['church', A.pub]])))[0], true,
    'a dual member cannot volunteer in A');
  assert.equal((await publish(pub, doc(dual, AVAIL_D + B.pub, { free: true }, [['church', B.pub]])))[0], true,
    'a dual member cannot volunteer in B');
});

test('CONTROL: …and can answer the safety roll-call of BOTH', async () => {
  // The roll-call is the highest-stakes write in the product. Someone who worships at two churches, or has moved
  // and not yet left the old one, must be able to say "I am safe" to each of them.
  assert.equal((await publish(pub, doc(dual, SAFE_D + A.pub, { safe: true }, [['church', A.pub]])))[0], true,
    'a dual member cannot mark themselves safe to A');
  assert.equal((await publish(pub, doc(dual, SAFE_D + B.pub, { safe: true }, [['church', B.pub]])))[0], true,
    'a dual member cannot mark themselves safe to B');
});

test('CONTROL: a church can still post in its own group, and so can a network it declared', async () => {
  // Scoping to "effective member" ALONE would refuse the church key itself and its network — neither appears in
  // any member roster. The write side must mirror churchReader(): the church, its network, its stewards, or an
  // effective member.
  assert.equal((await publish(pub, chat(A, OPEN_GID, 'the church itself posts')))[0], true,
    'church A can no longer post in its own group');
  assert.equal((await publish(pub, chat(netA, OPEN_GID, 'the network posts')))[0], true,
    'a network A declared can no longer post in A’s group');
});

// S1b — FOUND BY THE CONTROL ABOVE, 2026-07-30, and it was not in the audit.
//
// I wrote this case expecting it to pass, with a comment asserting REVIEW-2026-07-20 B3 had already scoped the
// network check. It fails. Writing the assumption down as a test is what caught it; asserting it in a comment is
// what would have shipped it.
//
// Why it fails: `isNetwork` at gateway.mjs:1264 is scoped ONLY when the event names a church —
// `_netCp ? networkOf(e.pubkey, _netCp) : NETWORKS.has(e.pubkey)`. A kind-1 chat message scopes by GROUP and
// carries no ['church'] tag, so `_netCp` is empty and the check falls back to the relay-wide NETWORKS union —
// exactly the hole B3 closed, re-opened for every rule that does not resolve a church itself. The B-2 comments
// at :1466 and :1473 spotted this for broadcast and invite-only groups and fixed those two branches; the
// reasoning ("every church-scoped rule keys off the d-tag suffix") does not hold for the open-group tail either.
//
// So S1's fix must scope the AUTHORITY as well as the membership: resolve the group's owning church and ask the
// scoped question of it, rather than trusting a relay-wide leader flag computed before the group is known.
test('S1b: a network declared by A has NO authority in B’s group', { todo: 'reproduction found by the over-tightening controls — fails today' }, async () => {
  const attack = await publish(pub, chat(netA, OPEN_GID_B, 'A’s network posts into B'));
  assert.equal(attack[0], false,
    'a key that church A declared as its network can post into church B’s group. Network authority must be ' +
    'scoped to the church that declared it — the relay-wide NETWORKS union is not an authority anywhere.');
});
