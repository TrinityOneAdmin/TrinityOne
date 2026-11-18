// THE NETWORK KEY IS WALLED OFF FROM A CHURCH'S CHILDREN AND CARE DATA (Phase 2, 2026-10-20).
// Run: node --test scripts/the-network-key-cannot-read-a-churchs-child-and-care-data.test.mjs
//
// A "network key" is a SECOND church-level key a church grants authority to, so a group of churches can host
// one another's announcements and events (reference/DOMAIN.md). The owner's safeguarding decision: that
// shared cross-church key must NOT reach a member church's children, check-in register, care data or the
// confidential child-contact routes. This test proves it on a REAL relay with TWO entities — a church, and a
// second key the church has genuinely joined as its network.
//
// WHY A TWO-ENTITY FIXTURE (CLAUDE.md rules 1 & 7). A single-church test cannot tell "the network key is
// refused" from "the network relationship never formed". So the FIRST control below proves the relationship
// is LIVE — the network key IS served a church `plan:` (a non-care doc that legitimately flows to a network).
// Only then does "refused the children/care docs" mean the strip, not a dead link.
//
// WHAT IS ASSERTED, per protected document:
//   • the NETWORK KEY is REFUSED           (the strip)
//   • the CHURCH itself is SERVED          (the door is not broken for its owner)
//   • a SAFEGUARDING STEWARD is SERVED     (the access the owner insisted we keep)
// and on the write side, the network key cannot FORGE a care need / skip / request-resolution, while the
// church still can.
//
// THE RELAY is the real gateway on a throwaway data dir and an isolated port. Nothing is stubbed; canRead and
// accept() decide every result.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8796;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

// d-tag prefixes (trinity-doc-types.mjs)
const D = {
  NETWORK: 'trinityone/network:', STEWARDS: 'trinityone/stewards:', MEMBER: 'trinityone/member:',
  MINORS: 'trinityone/minors:', GUARDIANS: 'trinityone/guardians:', APPROVED: 'trinityone/approved:',
  NEED: 'trinityone/care:', SLOT: 'trinityone/careslot:', SKIP: 'trinityone/careskip:',
  AVAIL: 'trinityone/careavail:', CARETEAM: 'trinityone/careteam:', CAREREQ: 'trinityone/carereq:',
  CAREREQSTATUS: 'trinityone/carereqstatus:', CARECHAT: 'trinityone/carechat:',
  CHECKIN: 'trinityone/checkin:', PLAN: 'trinityone/plan:',
  ROSTER: 'trinityone/roster:', MEALS: 'trinityone/meals-settings',
};

const church = K(), networkKey = K(), steward = K(), member = K(), cleared = K(), minor = K(), parent = K();
const careMember = K();   // a real, legitimate care-team admin (on a CHURCH-authored roster)
const key2 = K();         // a fresh proxy key the network key tries to install on the care team
const ISO = '2026-10-18', CARE_ID = 'needfeed1', REQ_ID = minor.pub + '-req1';
const TEAM = church.pub + '-careteam';   // the care-team group id (namespaced to the church, per ID_OWNER_RE)
let relay, dataDir;

const spawnRelay = () => spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
  cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
  env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub), RELAY_MAX_EVENTS: '5000' },
});
async function waitUp() { for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(150); } throw new Error('relay did not come up'); }
const connect = (who) => new Promise((res, rej) => {
  const w = new WebSocket(WS_URL);
  w.on('open', () => { w.on('message', (d) => { const m = JSON.parse(d);
    if (m[0] === 'AUTH' && who) w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)])); }); res(w); });
  w.on('error', rej);
});
const publish = (w, evt) => new Promise((res) => { const on = (d) => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { w.off('message', on); res([m[2], m[3] || '']); } }; w.on('message', on); w.send(JSON.stringify(['EVENT', evt])); });
const read = (w, filters) => new Promise((res) => {
  const out = []; const id = 'r' + Math.random().toString(36).slice(2, 7);
  const on = (d) => { const m = JSON.parse(d); if (m[0] === 'EVENT' && m[1] === id) out.push(m[2]); if (m[0] === 'EOSE' && m[1] === id) setTimeout(() => { w.off('message', on); res(out); }, 200); };
  w.on('message', on); w.send(JSON.stringify(['REQ', id, ...filters])); setTimeout(() => { w.off('message', on); res(out); }, 4000);
});
const doc = (k, d, body, extra = []) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', 'trinityone'], ...extra], content: JSON.stringify(body) }, k.sk);
const CH = [['church', church.pub]];

// did a REQ by this connection return the event with id `evtId`?
async function served(who, evtId) {
  const w = await connect(who);
  await sleep(200);   // let the lazy NIP-42 AUTH round-trip complete before the gated read
  const got = await read(w, [{ ids: [evtId], kinds: [30078] }]);
  w.close();
  return got.some((e) => e.id === evtId);
}

const stored = {};   // label -> event id we expect to read-test

before(async () => {
  await requireFreePort(PORT, 'the-network-key-cannot-read-a-churchs-child-and-care-data.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-netkey-'));
  relay = spawnRelay(); await waitUp();

  const w = await connect(null);      // anonymous writer for self-signed member docs
  const cw = await connect(church);   // the church key

  const ok = async (conn, evt, why) => { const [k, msg] = await publish(conn, evt); assert.equal(k, true, why + ' (' + msg + ')'); return evt; };

  // 1. the church GENUINELY joins networkKey as its network (authored by the church key — the only way)
  await ok(cw, doc(church, D.NETWORK + networkKey.pub, { joined: now() }), 'church could not declare its network');
  // 2. a steward the church EXPLICITLY ticked for safeguarding
  await ok(cw, doc(church, D.STEWARDS + church.pub, { pubkeys: [steward.pub], caps: { [steward.pub]: ['safeguarding'] } }), 'steward roster refused');
  // 3. ordinary members join (self-signed), incl. a cleared adult and a minor
  for (const m of [member, cleared, minor]) await ok(w, doc(m, D.MEMBER + church.pub, { joined: now() }, [['p', church.pub]]), 'member join refused');
  // 4. safeguarding lists
  await ok(cw, doc(church, D.MINORS + church.pub, { pubkeys: [minor.pub] }), 'minors list refused');
  await ok(cw, doc(church, D.GUARDIANS + church.pub, { links: { [minor.pub]: [parent.pub] } }), 'guardians map refused');
  await ok(cw, doc(church, D.APPROVED + church.pub, { pubkeys: [cleared.pub] }), 'approved list refused');
  // the care module + a CHURCH-authored care-team roster (so a legitimate care admin exists, and MEALS_ADMIN_GROUP
  // is set — the indirect-door test depends on this and must not rely on another test having run first). The
  // network key is DELIBERATELY listed on this church-authored roster too: careAdmin() must still refuse it
  // (networkOf -> never a care admin), so being listed on a legitimate care team buys it nothing.
  await ok(cw, doc(church, D.MEALS, { adminGroupId: TEAM }), 'meals-settings (care module config) refused');
  await ok(cw, doc(church, D.ROSTER + TEAM, { pubs: [careMember.pub, networkKey.pub] }, CH), 'church care-team roster refused');
  await sleep(300);   // let the relay rebuild MINORS/APPROVED/NETWORKS/ROSTER maps before the care writes read them

  // 5. the protected documents (church-authored so they exist to be read-tested)
  stored.plan      = (await ok(cw, doc(church, D.PLAN + 'p1', { title: 'Harvest', draft: false }, CH), 'plan refused')).id;
  stored.checkin   = (await ok(cw, doc(church, D.CHECKIN + 'sess1', { x: 1 }, CH), 'checkin refused')).id;
  stored.need      = (await ok(cw, doc(church, D.NEED + CARE_ID, { id: CARE_ID, type: 'meals', dates: [ISO] }, [...CH, ['p', church.pub]]), 'care need refused')).id;
  stored.slot      = (await ok(cw, doc(church, D.SLOT + CARE_ID + ':' + ISO, { careId: CARE_ID, iso: ISO }, CH), 'care slot refused')).id;
  stored.skip      = (await ok(cw, doc(church, D.SKIP + CARE_ID + ':' + ISO, { careId: CARE_ID, iso: ISO }, CH), 'care skip refused')).id;
  stored.avail     = (await ok(cw, doc(church, D.AVAIL + church.pub, { note: 'can drive' }), 'availability refused')).id;
  stored.careteam  = (await ok(cw, doc(church, D.CARETEAM + church.pub, { pubs: [member.pub] }), 'care-team roster refused')).id;
  stored.minors    = church.pub && (await read(cw, [{ kinds: [30078], '#d': [D.MINORS + church.pub] }]))[0].id;
  stored.guardians = (await read(cw, [{ kinds: [30078], '#d': [D.GUARDIANS + church.pub] }]))[0].id;
  // a MINOR's private ask-for-help — gated by childCareReader (the confidential child-contact route)
  stored.carereq   = (await ok(w, doc(minor, D.CAREREQ + REQ_ID, { sealed: 1 }, CH), 'minor carereq refused')).id;

  w.close(); cw.close();
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── THE LIVE-RELATIONSHIP CONTROL (without this, every "refused" below could be a dead network link) ──────
// N1 (2026-10-21) removed the network key's authority over church CONTENT, so a church plan: can no longer be the
// proof that the link is live (it used to be). What still rides the link is only member-shaped BREADTH: accept()
// treats a joined network key as a known writer for a catch-all document that a stranger is refused. So the
// control is: the same undeclared document is REFUSED to a stranger and ACCEPTED from the joined network key.
// Sabotage proof: make networkOf() return false and the second assertion fails.
test('CONTROL: the join really took -- the church\'s own network:<key> declaration is stored and served back to the church', async () => {
  // WALL (2026-11-18): a declared network key can do nothing a stranger cannot, so liveness cannot be anchored on a differential any
  // more; this shows the declaration is stored. Non-vacuity of each refusal below is proved by per-door SABOTAGE (re-add networkOf).
  const cw0 = await connect(church); await sleep(200);
  const got = await read(cw0, [{ kinds: [30078], authors: [church.pub], '#d': ['trinityone/network:' + networkKey.pub] }]); cw0.close();
  assert.equal(got.length, 1, 'the church\'s join declaration was not stored -- the network link never formed, so every refusal below proves nothing');
});

// ── THE READ DOORS ───────────────────────────────────────────────────────────────────────────────────────
const READ_DOORS = [
  ['check-in register (checkinReader)', 'checkin'],
  ['care need (catch-all)',             'need'],
  ['care slot sign-up (catch-all)',     'slot'],
  ['care skip (catch-all)',             'skip'],
  ['availability (catch-all)',          'avail'],
  ['care-team roster (catch-all)',      'careteam'],
  ['minors list (safeguarding read)',   'minors'],
  ['guardians map (safeguarding read)', 'guardians'],
  ["a minor's ask-for-help (childCareReader)", 'carereq'],
];
for (const [label, key] of READ_DOORS) {
  test(`READ: the network key is REFUSED ${label}; church + safeguarding steward still served`, async () => {
    assert.equal(await served(networkKey, stored[key]), false, `the network key READ ${label} — the strip did not take`);
    assert.equal(await served(church, stored[key]), true, `the church cannot read its own ${label} — the door is broken`);
    assert.equal(await served(steward, stored[key]), true, `a safeguarding steward cannot read ${label} — access the owner insisted on is gone`);
  });
}

test('READ: an ordinary member still reads a care document (member access is untouched)', async () => {
  assert.equal(await served(member, stored.need), true, 'an ordinary member lost access to the care need — the strip over-reached');
});

// ── THE WRITE GATES (integrity: the network key must not FORGE care records) ─────────────────────────────
test('WRITE: the network key cannot forge a care SKIP; the church still can', async () => {
  const nw = await connect(networkKey); await sleep(200);
  const bad = doc(networkKey, D.SKIP + CARE_ID + ':' + '2026-10-25', { careId: CARE_ID, iso: '2026-10-25' }, CH);
  assert.equal((await publish(nw, bad))[0], false, 'the network key forged a care skip (defeating the per-day skiphash)');
  const cw = await connect(church); await sleep(200);
  const good = doc(church, D.SKIP + CARE_ID + ':' + '2026-10-26', { careId: CARE_ID, iso: '2026-10-26' }, CH);
  assert.equal((await publish(cw, good))[0], true, 're-anchor: the church itself can no longer write a skip — the gate is broken');
  nw.close(); cw.close();
});

test('WRITE: the network key cannot forge a care NEED; the church still can', async () => {
  const nw = await connect(networkKey); await sleep(200);
  const bad = doc(networkKey, D.NEED + 'netforged1', { id: 'netforged1', type: 'meals', dates: [ISO] }, [...CH, ['p', church.pub]]);
  assert.equal((await publish(nw, bad))[0], false, 'the network key forged a care need in the congregation');
  const cw = await connect(church); await sleep(200);
  const good = doc(church, D.NEED + 'churchneed2', { id: 'churchneed2', type: 'meals', dates: [ISO] }, [...CH, ['p', church.pub]]);
  assert.equal((await publish(cw, good))[0], true, 're-anchor: the church itself can no longer open a need — the gate is broken');
  nw.close(); cw.close();
});

test('WRITE: the network key cannot forge a request RESOLUTION; the church still can', async () => {
  const nw = await connect(networkKey); await sleep(200);
  // a status over a NON-minor member's request → the plain networkOf strip at CAREREQSTATUS_D
  const bad = doc(networkKey, D.CAREREQSTATUS + member.pub + '-r1', { status: 'declined' }, [...CH, ['p', member.pub]]);
  assert.equal((await publish(nw, bad))[0], false, 'the network key forged a care request resolution');
  const cw = await connect(church); await sleep(200);
  const good = doc(church, D.CAREREQSTATUS + member.pub + '-r1', { status: 'handled' }, [...CH, ['p', member.pub]]);
  assert.equal((await publish(cw, good))[0], true, 're-anchor: the church itself can no longer resolve a request — the gate is broken');
  nw.close(); cw.close();
});

// ── THE INDIRECT DOOR: care-admin via the care-team roster (the change-audit's headline) ─────────────────
// careAdmin() is still a reader of minors:/guardians: and the care docs ON PURPOSE. The hole was that the
// network key could BECOME a care admin — by being listed on the care-team roster, and/or by AUTHORING it
// (the roster write + grantor checks admit networkOf). These two tests prove it cannot, while a legitimate,
// church-appointed care admin still reads everything a care admin should.
test('CONTROL: a CHURCH-authored care-team roster makes a real care admin, who reads minors: and the need', async () => {
  // the care-team was set up (church-authored) in before(); this only reads it back
  assert.equal(await served(careMember, stored.minors), true, 'a real church-appointed care admin cannot read minors: — the fix over-blocked legitimate care admins');
  assert.equal(await served(careMember, stored.need), true, 'a real church-appointed care admin cannot read the care need — the fix over-blocked');
});

test('careAdmin REFUSES the network key even when the CHURCH lists it on the care team', async () => {
  // before() lists the network key on the church's OWN (church-authored) care-team roster. careAdmin() refuses
  // it anyway — networkOf -> never a care admin — so a network key cannot read child/care data by being put on
  // a legitimate care team. Sabotage: drop `networkOf(pub,cp)` from careAdmin() and both assertions fail.
  assert.equal(await served(networkKey, stored.minors), false, 'the network key, listed on the church care team, read minors: — careAdmin networkOf-exclusion is gone');
  assert.equal(await served(networkKey, stored.need), false, 'the network key, listed on the church care team, read the care need');
});

test('THE INDIRECT DOOR + ITS DoS: a network roster write neither reads child data nor displaces the real care team', async () => {
  const nw = await connect(networkKey); await sleep(200);
  // the network key tries to OVERWRITE the church's care-team roster (hosting lets it author roster:<TEAM>),
  // listing itself AND a fresh proxy key it controls. The write is ACCEPTED at the socket — so a refusal below
  // is a relay RULE at work, not a bounced write (non-vacuous).
  // N1 (2026-10-21): the roster write is now REFUSED AT THE SOCKET (leaderOf/idOwnerOk carry no networkOf), so the
  // Phase-2 ingest guard below is defence in depth and this test's job is that NOTHING of it lands. The church's own
  // roster write (before()) proves the same door is open to its owner.
  const [ok] = await publish(nw, doc(networkKey, D.ROSTER + TEAM, { pubs: [networkKey.pub, key2.pub] }, CH));
  assert.equal(ok, false, 'the network key WROTE a roster document — N1 (leaderOf/idOwnerOk) did not take');
  nw.close(); await sleep(300);
  // TWO rules close this and the test exercises BOTH:
  //  1. the INGEST GUARD (Phase-2 residual) refuses a network-key roster that would DISPLACE the church's own,
  //     so ROSTER_PEOPLE/ROSTER_BY keep the church's care team. Sabotage: remove that guard and the careMember
  //     assertions below fail — the real care admin is knocked OFF the team (the denial of service).
  //  2. careAdmin() never treats the network key, or a roster it authored, as a care admin — so neither key
  //     reads child/care data.
  assert.equal(await served(networkKey, stored.minors), false, 'the network key read minors: via the care-team roster');
  assert.equal(await served(networkKey, stored.need), false, 'the network key read the care need via the care-team roster');
  assert.equal(await served(key2, stored.minors), false, 'a proxy key the network installed read minors:');
  assert.equal(await served(key2, stored.need), false, 'a proxy key the network installed read the care need');
  // THE DoS (Phase-2 residual): the church's real, appointed care admin is UNTOUCHED by the network's write.
  assert.equal(await served(careMember, stored.minors), true, 'the network key knocked the real care admin off the team (roster-overwrite DoS is open)');
  assert.equal(await served(careMember, stored.need), true, 'the network key knocked the real care admin off the care need (roster-overwrite DoS is open)');
});

// ── CHILD-CONTACT WRITE (safeguardAllows): private route INTO a child's thread ───────────────────────────
test('WRITE: the network key cannot message into a minor\'s care thread; a cleared adult can', async () => {
  const nw = await connect(networkKey); await sleep(200);
  const bad = doc(networkKey, D.CARECHAT + REQ_ID + ':m1', { sealed: 1 }, [...CH, ['p', minor.pub]]);
  assert.equal((await publish(nw, bad))[0], false, 'the network key wrote into a minor\'s confidential care thread (safeguardAllows let it in)');
  // a church-APPROVED adult (cleared to contact youth) is the legitimate writer — proves the door is not shut for all
  const aw = await connect(cleared); await sleep(200);
  const good = doc(cleared, D.CARECHAT + REQ_ID + ':m2', { sealed: 1 }, [...CH, ['p', minor.pub]]);
  assert.equal((await publish(aw, good))[0], true, 're-anchor: a cleared adult can no longer reach the thread — safeguardAllows is broken for everyone');
  nw.close(); aw.close();
});


// ── careAdmin's THIRD guard: a NETWORK-AUTHORED roster confers care-admin to nobody ──────────────────────
// The DoS guard above blocks a network key from DISPLACING a church roster, so this path is only reachable
// when the network is the roster's FIRST writer and the church points its care team there without ever
// authoring it. careAdmin() still refuses, because the roster's author is the network key, not the church or
// an 'any'-steward. MUST BE LAST: it repoints this church's care-team group (MEALS_ADMIN_GROUP) to TEAM2.
test('careAdmin confers nothing from a NETWORK-FIRST care-team roster (a proxy key is still refused)', async () => {
  const TEAM2 = church.pub + '-careteam2';
  const nw = await connect(networkKey); await sleep(200);
  // network is the FIRST writer of this roster id (no church version to displace), listing a proxy key it controls
  // N1 (2026-10-21): the network key can no longer author a roster at all (it used to be the first writer here).
  assert.equal((await publish(nw, doc(networkKey, D.ROSTER + TEAM2, { pubs: [key2.pub] }, CH)))[0], false, 'the network key authored a roster — N1 did not take');
  const cw = await connect(church); await sleep(200);
  // the church points its care team at that network-authored group
  assert.equal((await publish(cw, doc(church, D.MEALS, { adminGroupId: TEAM2 })))[0], true, 'meals-settings write refused');
  nw.close(); cw.close(); await sleep(400);
  // key2 is ON the (network-authored) care-team roster the church now points to — careAdmin refuses it anyway,
  // because the roster's grantor is the network key. Sabotage: replace the (src.by===src.cp || steward) grantor
  // check in careAdmin() with grantorOk(src) and both assertions fail (grantorOk admits networkOf).
  assert.equal(await served(key2, stored.minors), false, 'a proxy on a network-authored care-team roster read minors: — careAdmin grantor check is gone');
  assert.equal(await served(key2, stored.need), false, 'a proxy on a network-authored care-team roster read the care need');
  // POSITIVE CONTROL (proves the refusals above ran against a LIVE, populated map, not a dead pipeline): the
  // CHURCH now RECLAIMS TEAM2 — a church author displaces a network-first entry, the DoS guard being inert
  // when prev.by is the network — listing the SAME key2. careAdmin's grantor is now the church, so key2 IS
  // served. If this failed, the 'refused' assertions above would prove nothing (the map was never filled).
  const cw2 = await connect(church); await sleep(200);
  assert.equal((await publish(cw2, doc(church, D.ROSTER + TEAM2, { pubs: [key2.pub] }, CH)))[0], true, 'church reclaim of TEAM2 refused');
  cw2.close(); await sleep(400);
  assert.equal(await served(key2, stored.minors), true, 'the care-team pipeline is dead: key2 on a CHURCH-authored TEAM2 is still refused minors: — the refusals above proved nothing');
  assert.equal(await served(key2, stored.need), true, 'the care-team pipeline is dead: key2 on a CHURCH-authored TEAM2 is still refused the need');
});
