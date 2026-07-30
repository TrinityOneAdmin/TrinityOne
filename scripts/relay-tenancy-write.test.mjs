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
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { createHash } from 'node:crypto';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8857;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const MEMBER_D = 'trinityone/member:', GROUP_D = 'trinityone/group:', ROSTER_D = 'trinityone/roster:';
const MEALS_SETTINGS_D = 'trinityone/meals-settings', CAREREQ_D = 'trinityone/carereq:';
// AUDIT-2026-07-30 S1/S3/S4, item 6 of the fix plan. accept() builds ONE relay-wide `isMember` over the union of
// every church's members, so six write rules ask "a member of anything?" where they mean "a member of THIS
// church". canRead() was hoisted onto a scoped helper (effMemberOf/churchReader) and the write side was not.
const MINORS_D = 'trinityone/minors:', AVAIL_D = 'trinityone/careavail:', SAFE_D = 'trinityone/safe:';
const NEED_D = 'trinityone/care:', SLOT_D = 'trinityone/careslot:', SKIP_D = 'trinityone/careskip:';
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
// A PLAIN member of A: on no roster, holding no delegated authority. S3b needs one, because `mallory` is added to
// A's care team by an earlier test in this file, and careAdmin() then short-circuits the NEED_D rule before the
// minors check is ever reached — so the case passed while the bug was still live. Caught by sabotage.
const carol = K();
const GID = 'grpA-private-leadership', TEAM = 'teamA-care';
let relay, dataDir, pub;

async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
// `at` exists because addressable docs supersede by created_at, and on a TIE the LOWEST EVENT ID wins
// (event-store.mjs:138, NIP-01). `now()` has one-second resolution, so two tests rewriting the SAME d-tag inside
// one second are decided by a coin flip on random key material — S3 and S3b both rewrite `minors:<B>`, and the
// suite failed roughly one run in two until this was passed explicitly. A flaky security test is worse than none:
// it trains you to re-run instead of to read. The 15-minute future tolerance makes a small bump safe.
const doc = (who, d, content, extra = [], at = now()) => finalizeEvent({ kind: 30078, created_at: at, tags: [['d', d], ['t', 'trinityone'], ...extra], content: JSON.stringify(content) }, who.sk);
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
  assert.equal((await publish(pub, doc(carol, MEMBER_D + A.pub, { joined: now() })))[0], true, 'carol must be able to join A');
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

test('S1: a member of another church CANNOT post into this church’s open group', async () => {
  const control = await publish(pub, chat(alice, OPEN_GID, 'CONTROL: a real member of A'));
  assert.equal(control[0], true, 'a genuine member of A must still be able to post — if this fails the fix is a lockout');
  const attack = await publish(pub, chat(bob, OPEN_GID, 'INJECTED by a member of church B'));
  assert.equal(attack[0], false,
    'a member of church B posted into church A’s group chat, and it is delivered to A’s members as ordinary ' +
    'chat. gateway.mjs’s kind-1 tail ends `return isMember`, which is relay-wide. The same hole was closed for ' +
    'broadcast groups and for invite-only groups; the ordinary open group was not brought along.');
});

test('S3: a co-tenant church CANNOT mark another church’s adult as a minor', async () => {
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

// S3b — the OTHER relay-wide MINORS call site. The audit named two (gateway.mjs :1409 NEED_D and :1433
// AVAIL_D); the S3 case above only covers AVAIL_D, so this pins the one a test would otherwise miss. Being
// wrongly marked a child here does not just hide you from a volunteer list — it stops you OPENING A CARE NEED,
// which is how a member asks for help.
test('S3b: a co-tenant’s minor marking cannot stop an adult opening a care need in their OWN church', async () => {
  // A allows members to open their own needs. The NEED_D rule reads MEALS_OPEN_MEMBER, which is populated when
  // this settings document is INDEXED — not when the OK comes back — so poll for the effect instead of sleeping a
  // guessed interval. One run of this test went red on a 150ms sleep: the control need was refused because the
  // setting had not landed yet, which reads as "the fix does not work" when nothing was wrong with the fix.
  assert.equal((await publish(pub, doc(A, MEALS_SETTINGS_D, { enabled: true, adminGroupId: TEAM, openedBy: 'member' })))[0], true);
  let settingsLive = false;
  for (let i = 0; i < 40 && !settingsLive; i++) {
    await sleep(100);
    settingsLive = (await publish(pub, doc(carol, NEED_D + 'needA0', { title: 'probe' }, [['church', A.pub]])))[0];
  }
  assert.ok(settingsLive, 'openedBy:member never took effect, so this test cannot prove anything');
  // carol, not mallory: mallory is on A's care team by this point, and careAdmin() would satisfy the rule before
  // the minors check ran — the case would pass with the bug still live. Sabotage caught exactly that.
  assert.equal((await publish(pub, doc(carol, NEED_D + 'needA1', { title: 'meals' }, [['church', A.pub]])))[0], true,
    'control: an ordinary adult member of A can open a care need in A');
  // …and church B, which carol has never joined, marks her a child. Explicitly LATER than S3's write to the same
  // d-tag: same-second addressable writes tie-break on the lowest event id, which is random.
  assert.equal((await publish(pub, doc(B, MINORS_D + B.pub, { pubkeys: [carol.pub] }, [['church', B.pub]], now() + 30)))[0], true);
  await sleep(200);
  const after = await publish(pub, doc(carol, NEED_D + 'needA2', { title: 'meals again' }, [['church', A.pub]]));
  assert.equal(after[0], true,
    'a marking made by a church this person has never joined stopped them asking their OWN church for help. ' +
    'accept() consults the relay-wide MINORS union at the NEED_D rule; whether someone is a child is a judgement ' +
    'only their own church makes, as safeguardAllows() and the kind-1 child-safe check already do.');
});

test('S4: a member of another church CANNOT answer this church’s emergency safety check', async () => {
  const control = await publish(pub, doc(alice, SAFE_D + A.pub, { state: 'safe' }));
  assert.equal(control[0], true, 'CONTROL: a real member of A must still be able to mark themselves safe');
  const attack = await publish(pub, doc(bob, SAFE_D + A.pub, { state: 'safe' }));
  assert.equal(attack[0], false,
    'a member of church B answered church A’s safety roll-call. This is the post-emergency head count — the ' +
    'highest-stakes moment in the product — and subscribeSafetyResponses applies no roster filter, while the ' +
    'NIP-44 conversation key is symmetric, so the forgery DECRYPTS AND DISPLAYS as a genuine "safe".');
});

test('S4b: a member of another church CANNOT join this church’s here-to-help register', async () => {
  const attack = await publish(pub, doc(bob, AVAIL_D + A.pub, { free: true }, [['church', A.pub]]));
  assert.equal(attack[0], false,
    'a member of church B appears in church A’s volunteer register. Same unscoped `isMember` as S1/S4.');
});

// ── S2 + care slots. The audit ranked S2 CLAIMED and said "reproduce before fixing", so this is that. ─────
//
// The care id is relay-GLOBAL, like `group:` and `roster:` were before AUDIT-2026-07-24 C1/C2 gave them
// idOwnerOk(). note() records CARE_SKIPHASH and CARE_RECIPIENT keyed by the BARE id, so whichever church wrote
// last owns the in-memory entry — the two addressable events do not replace each other (different authors), but
// the MAP has room for only one.
//
// The per-day sha256(token) scheme exists so that ONLY the recipient can say "I don't need help on the 14th",
// without the relay ever learning who they are. Overwrite the hash and the genuine recipient's correct token
// stops matching: nobody brings food, and they cannot fix it. Silently, since a refused write has no failure
// channel in the member app.
const SKIP_DAY = '2026-08-14';
const TOKEN = 'the-real-recipients-token';
const hash = (s) => createHash('sha256').update(String(s)).digest('hex');
const skip = (who, careId, day, tok, at = now()) => finalizeEvent({ kind: 30078, created_at: at,
  tags: [['d', SKIP_D + careId + ':' + day], ['t', 'trinityone'], ['skiptok', tok], ['church', A.pub]], content: '{}' }, who.sk);

test('S2: a co-tenant church CANNOT hijack a care need’s skip tokens', async () => {
  // A opens a need whose per-day skip token is known only to the recipient.
  assert.equal((await publish(pub, doc(A, NEED_D + 'careX', { title: 'meals for the Hs' },
    [['church', A.pub], ['skiphash', SKIP_DAY, hash(TOKEN)]])))[0], true);
  await sleep(200);
  assert.equal((await publish(pub, skip(carol, 'careX', SKIP_DAY, TOKEN)))[0], true,
    'CONTROL: presenting the correct per-day token skips that day');

  // B republishes the SAME care id, naming itself, with a token of its own. accept()'s NEED_D rule resolved the
  // owning church from the EVENT, so B naming B satisfied `e.pubkey === cp` and this used to be ACCEPTED — that
  // is the hole. It must now be refused at the door, before note() can overwrite the map.
  const hijack = await publish(pub, doc(B, NEED_D + 'careX', { title: 'hijacked' },
    [['church', B.pub], ['skiphash', SKIP_DAY, hash('bs-token')]], now() + 30));
  assert.equal(hijack[0], false,
    'a co-tenant church republished another congregation’s care id. `care:<id>` is relay-global and the rule ' +
    'resolves the owning church from the event, so naming yourself was enough.');
  await sleep(200);

  const genuine = await publish(pub, skip(carol, 'careX', SKIP_DAY, TOKEN, now() + 60));
  assert.equal(genuine[0], true,
    'after a co-tenant church republished this care id, the genuine recipient’s own correct token no longer ' +
    'skips their day. CARE_SKIPHASH is keyed by the bare care id with no idOwnerOk() guard, so the last writer ' +
    'wins — the same relay-global id hole closed for group: and roster: in AUDIT-2026-07-24.');
});

test('S2b: a member of another church CANNOT fill a slot on this church’s care need', async () => {
  // `careslot:<careId>:<date>` ended on the relay-wide isMember. The audit flagged it under S4 as "same unscoped
  // shape at :1420". Scoping it needs the need's owning church, which is what the CARE_CHURCH map is for.
  assert.equal((await publish(pub, doc(A, NEED_D + 'careY', { title: 'lifts to hospital' }, [['church', A.pub]])))[0], true);
  await sleep(200);
  assert.equal((await publish(pub, doc(carol, SLOT_D + 'careY:' + SKIP_DAY, { bringing: 'a casserole' }, [['church', A.pub]])))[0], true,
    'CONTROL: a member of A can offer to help with A’s need');
  const attack = await publish(pub, doc(bob, SLOT_D + 'careY:' + SKIP_DAY, { bringing: 'nothing' }, [['church', A.pub]]));
  assert.equal(attack[0], false,
    'a member of church B signed up to help with church A’s care need. The care team sees a name they cannot ' +
    'place against a day that now looks covered, so nobody else volunteers for it.');
});

// The sixth unscoped rule. Low harm on its own — the church owner must still approve a request — but it is the
// same root cause, and the anti-flood cap deliberately does NOT count members, so being a member of somewhere
// else bought an exemption from it. Scoping is not a lockout: an outsider may still ask, they are just counted.
test('a member of another church is not EXEMPT from the steward-request flood cap', async () => {
  const STEWARDREQ_D = 'trinityone/stewardreq:';
  // Both are allowed to ask. The difference is which path they take — uncapped, or counted.
  assert.equal((await publish(pub, doc(carol, STEWARDREQ_D + A.pub, { note: 'I would like to help' })))[0], true,
    'a member of A can no longer offer to steward A — that is a lockout, not a fix');
  assert.equal((await publish(pub, doc(bob, STEWARDREQ_D + A.pub, { note: 'me too' })))[0], true,
    'an outsider may still ask to steward; they are counted against the cap, not refused');
  // The invariant is the EXEMPTION, and it is only observable through the cap. Assert the rule reads the scoped
  // predicate rather than the relay-wide union — stated plainly as a source assertion, because filling a 50-deep
  // cap over a websocket to prove it would add ~50s to the suite for one bit of information.
  const src = readFileSync(new URL('./gateway.mjs', import.meta.url), 'utf8');
  const at = src.indexOf('if (d.startsWith(STEWARDREQ_D))');
  assert.notEqual(at, -1, 're-anchor: the steward-request rule moved');
  const rule = src.slice(at, src.indexOf('\n    }', at));
  assert.match(rule, /churchWriter\(e\.pubkey, d\.slice\(STEWARDREQ_D\.length\)\)/,
    'the uncapped path is still gated on the relay-wide isMember, so a member of any co-tenant church skips ' +
    'straight into this church’s console');
  assert.doesNotMatch(rule, /!MEMBERS\.has\(x\.pubkey\)/,
    'the flood cap still exempts the relay-wide member union, so pending requests from other churches’ members ' +
    'are not counted');
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
test('S1b: a network declared by A has NO authority in B’s group', async () => {
  const attack = await publish(pub, chat(netA, OPEN_GID_B, 'A’s network posts into B'));
  assert.equal(attack[0], false,
    'a key that church A declared as its network can post into church B’s group. Network authority must be ' +
    'scoped to the church that declared it — the relay-wide NETWORKS union is not an authority anywhere.');
});
