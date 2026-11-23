// A CHILD A PARENT INVITED, OR A STEWARD LINKED, IS TREATED AS A MINOR UNTIL THE CHURCH DECIDES
// (SIGNUP-SAFEGUARDING-GAPS gap 1A, owner rulings D1 and D6).   Run: node --test scripts/a-pending-child-is-a-minor-until-the-church-decides.test.mjs
//
// WHAT THIS CLOSES, said exactly: the PARENT-INVITED route (a parent mints a child account; the child holds a
// membership at once in an open church, and only Confirm used to write the church's `minors:` list) and the
// steward-LINKED route (`linkParent`: `guardians:` is written, then `minors:` as a second write). It does NOT close
// a child who joins on their own device: that child relies on the church's human admission, by design.
//
// THE MODEL (gateway.mjs). A child C of church cp is PENDING iff there is a parent P such that
//   (a valid-ack `guardreq:<C>` by P naming cp   OR   `guardians:<cp>` links C to P)
//   AND C is not in `minors:` AND the pair C|P is not `closed` AND C is not approved / a steward / the church.
// Pending children are added to THAT CHURCH's `MINORS_BY` set — the set every gate reads — so a pending child is
// gated exactly like a marked one: read gates AND write gates.
//
// REAL GATEWAY, TWICE. The same assertions run on a relay BOOTED ON A SEEDED STORE (hydrateMaps replay) and on a
// relay that is fed the same documents LIVE over a socket (accept + note). Nothing about any gate is stubbed.
// The member-app half (createChildAccount signing the ack) is Branch M; here the ack is built with the same
// fields the relay verifies, signed by the child's own key.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { openStore } from './event-store.mjs';
import { requireFreePort } from './test-ports.mjs';
import { buildCheckinPermission } from './checkin-role-source.mjs';

const NET = 'trinityone';
const base = Math.floor(Date.now() / 1000) - 3000;
let _n = 0; const tick = () => base + (++_n);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const A = K(), B = K();                      // two configured churches on one box
const adultZ = K(), peerZ = K();             // ordinary adults of A (controls)
const minorX = K();                          // explicitly marked child of A
const ackKid = K();                          // PARENT-INVITED: a valid-ack guardreq by parentP. Member of A AND of B.
const parentP = K();
const linkKid = K();                         // STEWARD-LINKED: guardians: only, no guardreq
const parentL = K();
const victim = K();                          // an ADULT of A named in a guardreq by parentP with NO ack (forgery)
const badAckKid = K();                       // an adult of A: guardreq with an ack signed by somebody else's key
const wrongChurchKid = K();                  // member of A whose ack names church B
const wrongParentKid = K();                  // member of A whose ack (signed by themselves) names a DIFFERENT parent than the guardreq's author
const tagParentKid = K(), contentParentKid = K(), contentChurchKid = K();   // each: an ack right in every field but ONE (the p-tag parent / content parent / content church) — so each check is tested on its own
const stewardK = K();                        // a steward of A who is (wrongly) named in a church link
const forgedSigKid = K();                    // member of A whose ack has the child's pubkey but somebody ELSE's signature
const forgedLinkSubject = K();               // an adult of A that a NON-church key tries to list in guardians:
const impostor = K();                        // a member who is not the church key
const bAdult = K();                          // adult of church B (control for per-church scope)
const ROOM_A = A.pub.slice(0, 16) + '-adults', ROOM_KIDS = A.pub.slice(0, 16) + '-kids', ROOM_B = B.pub.slice(0, 16) + '-bgroup';
const EV_ID = 'evtadultsonly';
const GATED = { minorX, ackKid, linkKid };
const SERVED = { adultZ, victim, badAckKid, wrongChurchKid, wrongParentKid, tagParentKid, contentParentKid, contentChurchKid, stewardK, forgedSigKid, forgedLinkSubject };

const doc = (who, d, content, tags = [], at = 0) => finalizeEvent({ kind: 30078, created_at: at || tick(), tags: [['d', d], ['t', NET], ...tags], content: typeof content === 'string' ? content : JSON.stringify(content) }, who.sk);
const memberDoc = (who, cp) => doc(who, 'trinityone/member:' + cp, { joined: 1 }, [['p', cp]]);
const groupDoc = (church, id, extra = {}) => doc(church, 'trinityone/group:' + id, { name: id, kind: 'open', ...extra }, [['church', church.pub]]);
const minorsDoc = (list) => doc(A, 'trinityone/minors:' + A.pub, { pubkeys: list });
const guardiansDoc = (links, closed) => doc(A, 'trinityone/guardians:' + A.pub, { links, ...(closed ? { closed } : {}) });
const approvedDoc = (list) => doc(A, 'trinityone/approved:' + A.pub, { pubkeys: list });
const ack = (child, parentPub, cp) => finalizeEvent({ kind: 30078, created_at: tick(), tags: [['d', 'trinityone/guardreq:ack:' + cp], ['p', parentPub], ['t', NET]], content: JSON.stringify({ parent: parentPub, church: cp }) }, child.sk);
// an ack with ONE field wrong: { tagParent, contentParent, contentChurch } override the right values
const ackOne = (child, parentPub, cp, o = {}) => finalizeEvent({ kind: 30078, created_at: tick(), tags: [['d', 'trinityone/guardreq:ack:' + cp], ['p', o.tagParent || parentPub], ['t', NET]], content: JSON.stringify({ parent: o.contentParent || parentPub, church: o.contentChurch || cp }) }, child.sk);
const guardreq = (parent, childPub, cp, a) => doc(parent, 'trinityone/guardreq:' + childPub, { child: childPub, parent: parent.pub, ...(a ? { ack: a } : {}) }, [['p', cp], ['p', childPub]]);
const chat = (who, gid, text, cp) => finalizeEvent({ kind: 1, created_at: tick(), tags: [['t', NET], ['t', gid], ['p', cp || A.pub]], content: text }, who.sk);

const corpus = () => [
  ...[adultZ, peerZ, minorX, ackKid, parentP, linkKid, parentL, victim, badAckKid, wrongChurchKid, wrongParentKid, tagParentKid, contentParentKid, contentChurchKid, stewardK, forgedSigKid, forgedLinkSubject, impostor].map(m => memberDoc(m, A.pub)),
  memberDoc(ackKid, B.pub), memberDoc(bAdult, B.pub),
  groupDoc(A, ROOM_A, { eventPolicy: 'everyone' }), groupDoc(A, ROOM_KIDS, { childsafe: true }), groupDoc(B, ROOM_B),
  minorsDoc([minorX.pub]),
  guardiansDoc({ [linkKid.pub]: [parentL.pub], [stewardK.pub]: [parentL.pub] }),
  doc(A, 'trinityone/stewards:' + A.pub, { pubkeys: [stewardK.pub] }),
  guardreq(parentP, ackKid.pub, A.pub, ack(ackKid, parentP.pub, A.pub)),                       // VALID
  guardreq(parentP, victim.pub, A.pub, null),                                                  // no ack: a forgery
  guardreq(parentP, badAckKid.pub, A.pub, ack(victim, parentP.pub, A.pub)),                    // ack signed by the WRONG key
  guardreq(parentP, wrongChurchKid.pub, A.pub, ack(wrongChurchKid, parentP.pub, B.pub)),        // ack names ANOTHER church
  guardreq(parentP, wrongParentKid.pub, A.pub, ack(wrongParentKid, parentL.pub, A.pub)),        // ack names a DIFFERENT parent
  guardreq(parentP, forgedSigKid.pub, A.pub, { ...ack(forgedSigKid, parentP.pub, A.pub), sig: ack(victim, parentP.pub, A.pub).sig }),   // right pubkey, WRONG signature
  guardreq(parentP, tagParentKid.pub, A.pub, ackOne(tagParentKid, parentP.pub, A.pub, { tagParent: parentL.pub })),
  guardreq(parentP, contentParentKid.pub, A.pub, ackOne(contentParentKid, parentP.pub, A.pub, { contentParent: parentL.pub })),
  guardreq(parentP, contentChurchKid.pub, A.pub, ackOne(contentChurchKid, parentP.pub, A.pub, { contentChurch: B.pub })),
  doc(A, 'trinityone/event:' + EV_ID, { title: 'Marriage counselling supper', where: 'The vicarage' }, [['t', ROOM_A]]),
  chat(adultZ, ROOM_A, 'adults only chat'), chat(bAdult, ROOM_B, 'church b chat', B.pub),
];

class Rig {
  constructor(name, port, seeded) { this.name = name; this.port = port; this.seeded = seeded; this.url = `ws://127.0.0.1:${port}/relay`; }
  async start() {
    await requireFreePort(this.port, 'a-pending-child-is-a-minor-until-the-church-decides.test.mjs');
    this.dir = mkdtempSync(join(tmpdir(), 'trin-pending-'));
    if (this.seeded) { const store = openStore(join(this.dir, 'relay.sqlite'), { maxEvents: 5000 }); for (const e of corpus()) store.put(e); store.close(); }
    this.proc = spawn(process.execPath, ['scripts/gateway.mjs', String(this.port)], { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: this.dir, RELAY_MAX_EVENTS: '5000', CHURCH_NPUB: `${npubEncode(A.pub)},${npubEncode(B.pub)}` }, stdio: 'ignore' });
    const t0 = Date.now(); for (;;) { try { const r = await fetch(`http://127.0.0.1:${this.port}/status`); if (r.ok) break; } catch {} if (Date.now() - t0 > 15000) throw new Error('relay never came up'); await sleep(150); }
    if (!this.seeded) {   // LIVE: members first, then the church's documents, then the member documents that depend on them
      for (const e of corpus()) { const [ok, msg] = await this.publish(e); if (!ok && !/duplicate|newer/.test(msg)) throw new Error(this.name + ': fixture refused ' + (e.tags.find(t => t[0] === 'd') || [])[1] + ' (' + msg + ')'); }
    }
    await sleep(300);
  }
  stop() { try { this.proc && this.proc.kill('SIGKILL'); } catch {} try { rmSync(this.dir, { recursive: true, force: true }); } catch {} }
  connect() { return new Promise((res, rej) => { const ws = new WebSocket(this.url); ws.on('open', () => res(ws)); ws.on('error', rej); }); }
  async publish(evt) { const ws = await this.connect(); try { return await new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); }); } finally { ws.close(); } }
  // authenticated read as `who`; returns the events served
  read(who, filter) {
    return new Promise(async (res, rej) => {
      let ws; try { ws = await this.connect(); } catch (e) { return rej(e); }
      const seen = []; let authId = '', asked = 0; const done = () => { try { ws.close(); } catch {} res(seen); }; const t = setTimeout(done, 8000);
      const ask = () => { asked++; ws.send(JSON.stringify(['REQ', 'r' + asked, filter])); };
      ws.on('message', d => { const m = JSON.parse(d);
        if (m[0] === 'AUTH') { const evt = finalizeEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [['relay', this.url], ['challenge', m[1]]], content: '' }, who.sk); authId = evt.id; ws.send(JSON.stringify(['AUTH', evt])); return; }
        if (m[0] === 'OK' && m[1] === authId) { if (m[2] !== true) { clearTimeout(t); return done(); } ask(); return; }
        if (m[0] === 'EVENT' && String(m[1]).startsWith('r')) seen.push(m[2]);
        if (m[0] === 'EOSE' && String(m[1]).startsWith('r') && authId) { clearTimeout(t); done(); } });
      ask();
    });
  }
}

// ── every gate, as ONE function returning { gate: boolean "served / accepted" } for a subject ────────────────────────
async function verdicts(rig, who) {
  const v = {};
  v['read chat (canRead kind-1, :7204)'] = (await rig.read(who, { kinds: [1], '#t': [ROOM_A], limit: 10 })).length > 0;
  v['read group definition (canRead group:, :7044)'] = (await rig.read(who, { kinds: [30078], '#d': ['trinityone/group:' + ROOM_A] })).length > 0;
  v['read event (canRead event:, :7104)'] = (await rig.read(who, { kinds: [30078], '#d': ['trinityone/event:' + EV_ID] })).length > 0;
  v['write chat (accept kind-1, :6145)'] = (await rig.publish(chat(who, ROOM_A, 'hello from ' + who.pub.slice(0, 6)))) [0];
  v['write availability (accept AVAIL, :5907)'] = (await rig.publish(doc(who, 'trinityone/careavail:' + A.pub, { slots: [] }, [['church', A.pub]])))[0];
  v['write event (accept EVENT delegated member, :5384)'] = (await rig.publish(doc(who, 'trinityone/event:ev-' + who.pub.slice(0, 8), { title: 'x' }, [['t', ROOM_A], ['church', A.pub]])))[0];
  v['open a care need (accept NEED_D, :5877)'] = (await rig.publish(doc(who, 'trinityone/care:' + who.pub.slice(0, 16) + '-need1', { enc: 'x' }, [['church', A.pub]])))[0];
  return v;
}
// church-signed writes naming the subject: refused for a minor, accepted for an adult
async function churchWrites(rig, who) {
  const v = {};
  v['approved: names them (accept :5436)'] = (await rig.publish(approvedDoc([who.pub])))[0];
  v['check-in clearance names them (accept :5564)'] = (await rig.publish(doc(A, 'trinityone/checkinperm:' + who.pub, buildCheckinPermission({ person: who.pub, source: 'steward', lifetime: 'dated', from: base - 3600, until: base + 86400 * 2 }), [['church', A.pub]])))[0];
  return v;
}

function suite(label, rig) {
  test(label + ' FIXTURE CONTROL: the care-need gate is open to members (church setting) and an adult passes every gate, so a refusal below is the minor rule', async () => {
    const [ok, msg] = await rig.publish(doc(A, 'trinityone/meals-settings', { enabled: true, visibility: 'all', openedBy: 'member' }));
    assert.ok(ok || /newer|duplicate/.test(msg), 'fixture: ' + msg);
    await sleep(200);
    const v = await verdicts(rig, adultZ);
    for (const [g, ok2] of Object.entries(v)) assert.equal(ok2, true, 'CONTROL FAILED — an ordinary adult of the church was refused at: ' + g + ' (the fixture, not the safeguarding rule, is wrong)');
  });

  for (const [name, who] of Object.entries(GATED)) {
    test(label + ' ' + name + ' is gated at EVERY reader — read gates and the write gates (union coverage)', async () => {
      const v = await verdicts(rig, who);
      const open = Object.entries(v).filter(([, ok]) => ok).map(([g]) => g);
      assert.deepEqual(open, [], name + ' WAS SERVED / ACCEPTED AT: ' + open.join('; '));
    });
  }
  // the church-signed write gates are checked last in the file's order, one subject at a time (they change `approved:`)
  test(label + ' the church cannot clear a pending child for youth or check-in (an `approved:` / clearance naming a minor is refused) — and can for an adult', async () => {
    for (const [name, who] of Object.entries(GATED)) {
      const v = await churchWrites(rig, who);
      const open = Object.entries(v).filter(([, ok]) => ok).map(([g]) => g);
      assert.deepEqual(open, [], name + ' WAS CLEARED BY THE CHURCH: ' + open.join('; '));
    }
    const ctl = await churchWrites(rig, peerZ);
    for (const [g, ok] of Object.entries(ctl)) assert.equal(ok, true, 'CONTROL: the church could not write ' + g + ' for an ordinary adult, so the refusals above prove nothing');
  });

  for (const [name, who] of Object.entries(SERVED)) {
    test(label + ' ADVERSARIAL: ' + name + ' (an adult, named by a forgery or a bad ack) is NOT swept up — served at every reader', async () => {
      const v = await verdicts(rig, who);
      const shut = Object.entries(v).filter(([, ok]) => !ok).map(([g]) => g);
      assert.deepEqual(shut, [], name + ' WAS REFUSED AT: ' + shut.join('; ') + ' — an adult was treated as a child');
    });
  }

  test(label + ' per-church: a child pending in A is an ordinary member of church B on the same box (the S3 scope stays true)', async () => {
    const got = await rig.read(ackKid, { kinds: [1], '#t': [ROOM_B], limit: 10 });
    assert.equal(got.length, 1, 'THE PENDING CHILD OF CHURCH A WAS GATED IN CHURCH B — the union reached across churches');
    assert.equal((await rig.publish(chat(ackKid, ROOM_B, 'b room', B.pub)))[0], true, 'the pending child could not write in church B');
  });
}

const R_HYDRATE = new Rig('[hydrate]', 9082, true), R_LIVE = new Rig('[live]', 9083, false);
before(async () => { await R_HYDRATE.start(); await R_LIVE.start(); });
after(() => { R_HYDRATE.stop(); R_LIVE.stop(); });

suite(R_HYDRATE.name, R_HYDRATE);
suite(R_LIVE.name, R_LIVE);

test('a guardians: document signed by a NON-church key is refused live, and pends nobody (live relay)', async () => {
  const forged = doc(impostor, 'trinityone/guardians:' + A.pub, { links: { [forgedLinkSubject.pub]: [impostor.pub] } });
  const [ok] = await R_LIVE.publish(forged);
  assert.equal(ok, false, 'a non-church key was allowed to write the church\'s guardians map');
  assert.equal((await verdicts(R_LIVE, forgedLinkSubject))['read chat (canRead kind-1, :7204)'], true, 'the subject of a forged guardians: doc was treated as a child');
});
test('…and a forged guardians: doc already on disk is ignored at hydrate (store.put bypasses accept; note() requires the church key)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-pending-forged-')); const port = 9084; await requireFreePort(port, 'forged');
  const store = openStore(join(dir, 'relay.sqlite'), { maxEvents: 5000 });
  for (const e of [memberDoc(adultZ, A.pub), memberDoc(forgedLinkSubject, A.pub), groupDoc(A, ROOM_A), doc(impostor, 'trinityone/guardians:' + A.pub, { links: { [forgedLinkSubject.pub]: [impostor.pub] } }), chat(adultZ, ROOM_A, 'x')]) store.put(e);
  store.close();
  const rig = new Rig('[forged]', port, false); rig.dir = dir;
  rig.proc = spawn(process.execPath, ['scripts/gateway.mjs', String(port)], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, TRINITY_DATA_DIR: dir, CHURCH_NPUB: npubEncode(A.pub) }, stdio: 'ignore' });
  try {
    const t0 = Date.now(); for (;;) { try { if ((await fetch(`http://127.0.0.1:${port}/status`)).ok) break; } catch {} if (Date.now() - t0 > 15000) throw new Error('down'); await sleep(150); }
    assert.equal((await rig.read(forgedLinkSubject, { kinds: [1], '#t': [ROOM_A] })).length, 1, 'a guardians: doc signed by a non-church key pended its subject after a restart');
  } finally { rig.stop(); }
});

test('a detached ack published as an event of its own is refused at the door (it is not a document type), so it can never be stored or replayed', async () => {
  const [ok] = await R_LIVE.publish(ack(peerZ, parentP.pub, A.pub));
  assert.equal(ok, false, 'the detached acknowledgement was ACCEPTED as a standalone document');
});

// ── STATE TRANSITIONS on the live relay: designed DM behaviour, the two-write window, and every way an adult is cleared ──
const dm = (from, toPub) => finalizeEvent({ kind: 4, created_at: tick(), tags: [['p', toPub]], content: 'hello' }, from.sk);
const readsChat = async (who) => (await R_LIVE.read(who, { kinds: [1], '#t': [ROOM_A], limit: 10 })).length > 0;
const hasRoomDef = async (who) => (await R_LIVE.read(who, { kinds: [30078], '#d': ['trinityone/group:' + ROOM_A] })).length > 0;

test('T1 DESIGNED (owner D1): before Confirm a parent cannot DM their own pending child, and neither can an uncleared adult', async () => {
  assert.equal((await R_LIVE.publish(dm(parentP, ackKid.pub)))[0], false, 'the parent could DM the pending child before any link');
  assert.equal((await R_LIVE.publish(dm(adultZ, ackKid.pub)))[0], false, 'an uncleared adult could DM a pending child');
  assert.equal((await R_LIVE.publish(dm(adultZ, peerZ.pub)))[0], true, 'CONTROL: adult-to-adult DM refused');
});
test('T2 THE CONFIRM TWO-WRITE WINDOW fails CLOSED: guardians: lands first (no minors: yet) and both children are STILL gated; the parent can now DM', async () => {
  const [ok] = await R_LIVE.publish(guardiansDoc({ [linkKid.pub]: [parentL.pub], [ackKid.pub]: [parentP.pub] }));
  assert.equal(ok, true, 'fixture: guardians doc refused'); await sleep(300);
  assert.equal(await readsChat(ackKid), false, 'THE PARENT-INVITED CHILD READ THE ADULTS-ONLY ROOM BETWEEN setGuardians AND setMinors');
  assert.equal(await readsChat(linkKid), false, 'R5: THE STEWARD-LINKED CHILD (NO GUARDREQ) READ THE ADULTS-ONLY ROOM BETWEEN setGuardians AND setMinors');
  assert.equal(await hasRoomDef(linkKid), false, 'R5: the room definition was served to the linked child');
  assert.equal((await R_LIVE.publish(dm(parentP, ackKid.pub)))[0], true, 'once linked the parent could not DM their child (the guardian route)');
});
test('T3 after Confirm writes minors: the children are gated by the explicit list', async () => {
  await R_LIVE.publish(minorsDoc([minorX.pub, ackKid.pub, linkKid.pub])); await sleep(300);
  assert.equal(await readsChat(ackKid), false); assert.equal(await readsChat(linkKid), false);
});
test('T4 CLEARING an adult: closing the pair clears the pending signal even while the link stays and minors: no longer names them', async () => {
  await R_LIVE.publish(minorsDoc([minorX.pub])); await sleep(200);
  assert.equal(await readsChat(ackKid), false, 'CONTROL: unmarking alone must NOT clear a child who still has a link (D6/D7: unmark also unlinks, in the console)');
  assert.equal(await readsChat(linkKid), false, 'CONTROL: same for the linked child');
  const now = Math.floor(Date.now() / 1000);
  await R_LIVE.publish(guardiansDoc({ [linkKid.pub]: [parentL.pub], [ackKid.pub]: [parentP.pub] }, { [ackKid.pub + '|' + parentP.pub]: now, [linkKid.pub + '|' + parentL.pub]: now })); await sleep(300);
  assert.equal(await readsChat(ackKid), true, 'A DECLINED / CLOSED PARENT-INVITED CHILD STAYED GATED — an adult is never cleared');
  assert.equal(await readsChat(linkKid), true, 'a closed steward link stayed gated');
  assert.equal(await readsChat(minorX), false, 'the explicitly marked child must stay gated throughout');
});
test('T5 removing the link and closing the pair (Unlink) also leaves them cleared; a link whose pair is closed pends nobody; a NEW live link re-pends', async () => {
  const now = Math.floor(Date.now() / 1000);
  await R_LIVE.publish(guardiansDoc({}, { [ackKid.pub + '|' + parentP.pub]: now, [linkKid.pub + '|' + parentL.pub]: now })); await sleep(300);
  assert.equal(await readsChat(ackKid), true); assert.equal(await readsChat(linkKid), true);
  await R_LIVE.publish(guardiansDoc({ [linkKid.pub]: [parentL.pub] }, { [ackKid.pub + '|' + parentP.pub]: now, [linkKid.pub + '|' + parentL.pub]: now })); await sleep(300);
  assert.equal(await readsChat(linkKid), true, 'a link whose pair is closed pends nobody');
  await R_LIVE.publish(guardiansDoc({ [linkKid.pub]: [parentL.pub] })); await sleep(300);   // the pair is no longer closed: the link is live again
  assert.equal(await readsChat(linkKid), false, 'a live church link did not gate the child');
});
test('T6 a CLEARED adult (approved:) who also appears in a link is never pending; an uncleared adult with the same link is (the exclusion bites)', async () => {
  // peerZ was cleared by the church in the write-gate test above (approved: [peerZ]); adultZ was not.
  await R_LIVE.publish(guardiansDoc({ [peerZ.pub]: [parentL.pub], [adultZ.pub]: [parentL.pub] })); await sleep(300);
  assert.equal(await readsChat(adultZ), false, 'CONTROL: an uncleared adult named in a church link should read as pending');
  assert.equal(await readsChat(peerZ), true, 'A CLEARED ADULT WAS TREATED AS A CHILD because a link named them');
});
