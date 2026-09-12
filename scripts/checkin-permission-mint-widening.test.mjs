// A SAFEGUARDING STEWARD MAY CLEAR SOMEBODY FOR CHILDREN'S CHECK-IN — and four people still may not.
//   Run: node --test scripts/checkin-permission-mint-widening.test.mjs
//
// ⚠ THIS FILE COVERS A DELIBERATE ESCALATION AND THE CHANGE IT COVERS WANTS ITS OWN AUDIT.
//
// `trinityone/checkinperm:<person>` was church-key-only until 2026-09-10, and the comment on that rule said
// why in a sentence that is still true:
//
//     "A safeguarding steward can already read the whole children's register; what they must not gain is the
//      power to say who ELSE may. This document is now the ONLY thing that says that."
//
// An audit named exactly this as *"the escalation that matters, since they can already read the register but
// must not be able to hand it to a third party."* THE OWNER HAS WEIGHED THAT AND CHOSEN CONVENIENCE: in a
// real church the safeguarding lead is the person who knows who holds a DBS certificate, and routing every
// clearance through whoever holds the church key makes the lead's own job depend on somebody else's console.
//
// So this file is mostly REFUSALS, because the refusals are what bound the escalation. Every one runs
// against a real gateway process over a real websocket with real signed events, and asks what does NOT come
// back — the discipline scripts/checkin-helper-capability.test.mjs was written under, for the reason it
// gives: in August there were passing tests over a permission and not one over the refusal, and granting a
// steward Finance handed over the children's register.
//
// TWO CHURCHES ARE CONFIGURED ON THIS ONE BOX, which is the shipped topology, so "a co-tenant's steward"
// is a real actor here and not a description of one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { requireFreePort } from './test-ports.mjs';
import { buildHelperGrant, buildCheckinPermission, GRANT_SOURCE } from './checkin-role-source.mjs';
import { D } from './trinity-doc-types.mjs';

const PORT = 8909;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const unhex = h => Uint8Array.from(String(h).match(/.{1,2}/g).map(b => parseInt(b, 16)));

const church = K();
const other = K();          // a second congregation on the same box
const sgLead = K();         // OUR steward, ticked for safeguarding — the person this change is for
const treasurer = K();      // OUR steward, ticked for finance ONLY
const oldHand = K();        // OUR steward with NO caps recorded at all: unscoped, appointed before caps existed
const cara = K();           // an ordinary member of ours
const theirLead = K();      // the OTHER church's safeguarding steward
const ada = K();            // the helper a clearance is about
const gina = K();           // a guardian, so a record exists to be refused or served

const SESSION = 'svc-now';
const KEY = '11'.repeat(32);

let relay, dataDir, w;
const conn = () => new Promise((r, j) => { const s = new WebSocket(WS_URL); s.on('open', () => r(s)); s.on('error', j); });
const send = (s, e) => new Promise(res => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { s.off('message', on); res([m[2], m[3] || '']); } };
  s.on('message', on); s.send(JSON.stringify(['EVENT', e]));
});
async function publishAs(who, e) {
  const s = await conn();
  const authed = new Promise(res => {
    const on = d => { const m = JSON.parse(d);
      if (m[0] === 'AUTH') { s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)])); res(true); } };
    s.on('message', on); setTimeout(() => res(false), 400);
  });
  s.send(JSON.stringify(['REQ', 'warm', { kinds: [30078], limit: 1 }]));
  await authed; await sleep(80);
  const out = await send(s, e);
  s.close();
  return out;
}
function req(s, sub, f, sk, ms = 700) {
  return new Promise(res => { const out = [];
    const on = d => { const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === sub) out.push(m[2]);
      else if (m[0] === 'AUTH' && sk) s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, sk)])); };
    s.on('message', on); s.send(JSON.stringify(['REQ', sub, f]));
    setTimeout(() => { s.off('message', on); res(out); }, ms); });
}
async function asks(who, filter) {
  const s = await conn();
  await req(s, 'warm', { kinds: [30078], limit: 1 }, who.sk, 300);
  const got = await req(s, 'q' + Math.random().toString(36).slice(2, 7), filter, who.sk);
  s.close();
  return got;
}
const doc = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(),
  tags: [['d', d], ['t', NET], ...extra], content: typeof content === 'string' ? content : JSON.stringify(content) }, who.sk);

// A CLEARANCE, from the SHIPPED builder, authored by whoever `by` is and tagged to whichever church `cp` is.
// Both are parameters because every refusal below is a different combination of the two.
const permission = (by, cp, who, opts = {}) => finalizeEvent({ kind: 30078, created_at: opts.at || now(),
  tags: [['d', D.CHECKINPERM + who.pub], ['t', NET], ['church', cp.pub], ['person', who.pub]],
  content: JSON.stringify(buildCheckinPermission({ person: who.pub, source: opts.source || 'steward',
    lifetime: opts.lifetime || 'open', from: opts.from != null ? opts.from : now() - 86400,
    until: opts.until !== undefined ? opts.until : null })) }, by.sk);
const unpermission = (by, cp, who, at) => finalizeEvent({ kind: 30078, created_at: at || now(),
  tags: [['d', D.CHECKINPERM + who.pub], ['t', NET], ['church', cp.pub], ['deleted', '1']], content: '' }, by.sk);

// The session envelope. STILL CHURCH-KEY-ONLY — this change does not touch it, and the session key is wrapped
// with the church key, so a steward's console could not mint a usable one even if the relay let it.
const grant = (session, helpers, from, until, key) => {
  const { doc: body } = buildHelperGrant({ session, source: GRANT_SOURCE, lifetime: 'session', from, until,
    helpers, keepers: [church.pub, sgLead.pub], sessionKeyHex: key,
    wrap: (p, pl) => nip44.encrypt(pl, nip44.utils.getConversationKey(church.sk, p)) });
  return finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', D.CHECKINHELPER + session], ['t', NET], ['church', church.pub], ['session', session]],
    content: JSON.stringify(body) }, church.sk);
};
const checkinRec = (id, guardianPub) => doc(church, D.CHECKIN + id,
  nip44.encrypt(JSON.stringify({ id, childName: 'A Child', code: '4821' }), unhex(KEY)),
  [['church', church.pub], ['session', SESSION], ...(guardianPub ? [['p', guardianPub]] : [])]);

// IS ADA ACTUALLY CLEARED, AS THE RELAY SEES IT? Asked through the ENFORCEMENT rather than by reading the
// document back, because the document being on disk is not the claim — `CHECKIN_PERMITS` is. Fetching the
// session key requires checkinPermitted() to be true (canRead's CHECKINHELPER_D branch), and it is the
// cheapest observable that depends on it and on nothing else this file changes.
const adaIsCleared = async () => (await asks(ada, { kinds: [30078], '#d': [D.CHECKINHELPER + SESSION] })).length === 1;

async function boot() {
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir,
      CHURCH_NPUB: npubEncode(church.pub) + ',' + npubEncode(other.pub) } });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
}

before(async () => {
  await requireFreePort(PORT, 'checkin-permission-mint-widening.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-ckwiden-'));
  await boot();
  w = await conn();
  for (const who of [sgLead, treasurer, oldHand, cara, ada, gina]) await send(w, doc(who, D.MEMBER + church.pub, { joined: now() }));
  await send(w, doc(theirLead, D.MEMBER + other.pub, { joined: now() }));
  // OUR roster: the lead is ticked for safeguarding, the treasurer for finance, and `oldHand` has NO entry
  // in `caps` at all — which stewardCan() reads as "full steward (compat)" and this rule must not.
  await send(w, doc(church, D.STEWARDS + church.pub, { pubkeys: [sgLead.pub, treasurer.pub, oldHand.pub],
    caps: { [sgLead.pub]: ['safeguarding'], [treasurer.pub]: ['finance'] } }));
  // THEIR roster: their own safeguarding lead, on their own church.
  await send(w, doc(other, D.STEWARDS + other.pub, { pubkeys: [theirLead.pub], caps: { [theirLead.pub]: ['safeguarding'] } }));
  await send(w, doc(church, D.GUARDIANS + church.pub, { links: {} }));
  await sleep(200);
  const t = now();
  await send(w, grant(SESSION, [ada.pub], t - 600, t + 3600, KEY));
  await send(w, checkinRec('r1', gina.pub));
  await sleep(250);
});
after(() => { try { w && w.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── THE POSITIVE, without which every refusal below is vacuous ─────────────────────────────────────────────

test('A SAFEGUARDING STEWARD CLEARS SOMEBODY, AND THE RELAY ENFORCES IT', async () => {
  assert.equal(await adaIsCleared(), false, 'fixture: Ada is cleared before this test does anything');
  const [ok, msg] = await publishAs(sgLead, permission(sgLead, church, ada));
  assert.equal(ok, true, 'the safeguarding steward\'s clearance was refused at the door: ' + msg);
  await sleep(250);
  assert.equal(await adaIsCleared(), true,
    'the clearance was STORED AND NOT ENFORCED — which is the worst outcome of the two, because the console ' +
    'shows the steward a cleared volunteer and the relay refuses them. note() keys CHECKIN_PERMITS by the ' +
    'CHURCH; a copy filed under the steward\'s own pubkey is a clearance no lookup ever finds.');
  // AND THE WHOLE POINT OF IT: the record itself.
  assert.equal((await asks(ada, { kinds: [30078], '#d': [D.CHECKIN + 'r1'] })).length, 1,
    'a helper cleared by the safeguarding steward is still refused the register');
});

test('…and the steward may withdraw a clearance THE CHURCH granted', async () => {
  await publishAs(church, permission(church, church, ada, { at: now() - 20 }));
  await sleep(200);
  assert.equal(await adaIsCleared(), true, 'fixture: the church\'s own clearance did not take');
  const [ok, msg] = await publishAs(sgLead, unpermission(sgLead, church, ada));
  assert.equal(ok, true, 'the steward\'s withdrawal was refused: ' + msg);
  await sleep(250);
  assert.equal(await adaIsCleared(), false,
    'the steward could clear somebody and not un-clear them. A one-way power over a safeguarding record is ' +
    'worse than no power: the lead who added somebody by mistake cannot undo it.');
});

// ── AND THE REFUSALS THAT BOUND IT ─────────────────────────────────────────────────────────────────────────

test('AN ORDINARY MEMBER CANNOT CLEAR ANYBODY', async () => {
  const [ok] = await publishAs(cara, permission(cara, church, ada));
  assert.equal(ok, false, 'ANY MEMBER OF THE CONGREGATION CAN NOW CLEAR THEMSELVES FOR THE CHILDREN\'S REGISTER');
  await sleep(200);
  assert.equal(await adaIsCleared(), false, 'and it was enforced');
});

test('A FINANCE-ONLY STEWARD CANNOT — the August leak, asserted as a refusal', async () => {
  // In August, granting a steward Finance handed over the children's register. This is the same mistake in
  // its 2026-09 form: the widening must follow the capability tick, not the roster seat.
  const [ok] = await publishAs(treasurer, permission(treasurer, church, ada));
  assert.equal(ok, false, 'a steward ticked for FINANCE ONLY cleared somebody for the children\'s register');
  await sleep(200);
  assert.equal(await adaIsCleared(), false, 'and it was enforced');
});

test('AN UNSCOPED STEWARD CANNOT — this capability is not part of "everything"', async () => {
  // stewardCan() answers `!caps` as "full steward (compat)", so the ordinary helper WOULD admit `oldHand`.
  // This rule uses stewardCanExplicitly instead, agreeing with what the console has said since 2026-08-20:
  // the children's register has to be given on purpose. Without it, upgrading this relay would silently hand
  // the power to clear volunteers to every steward any church ever appointed.
  const [ok] = await publishAs(oldHand, permission(oldHand, church, ada));
  assert.equal(ok, false,
    'A STEWARD WITH NO CAPABILITY LIST CLEARED SOMEBODY. Every church that appointed stewards before ' +
    'capabilities existed has one of these, and none of them was asked about the children\'s register.');
  await sleep(200);
  assert.equal(await adaIsCleared(), false, 'and it was enforced');
});

test('ANOTHER CHURCH\'S SAFEGUARDING STEWARD CANNOT CLEAR ANYBODY FOR OURS', async () => {
  // Both churches are configured on this box. `theirLead` really is a safeguarding steward — of the other
  // congregation — so this is not a test about an unprivileged key; it is the cross-tenant case.
  const [ok] = await publishAs(theirLead, permission(theirLead, church, ada));
  assert.equal(ok, false,
    'A CO-TENANT CHURCH\'S STEWARD CLEARED SOMEBODY FOR OUR CHILDREN\'S REGISTER. The ["church"] tag is not ' +
    'authority: the author has to be on THAT church\'s own signed roster.');
  await sleep(200);
  assert.equal(await adaIsCleared(), false, 'and it was enforced');
});

test('…AND NEITHER CAN THE OTHER CHURCH\'S OWN KEY, tagging its document to us', async () => {
  // A configured church key passes `CHURCH_PUBS.has(e.pubkey)`, which is why the OLD rule keyed the map by
  // the author: their document could not touch our map. The new rule keys by the church the grantor resolves
  // to, so the resolution must not resolve a foreign church key to US.
  const [ok] = await publishAs(other, permission(other, church, ada));
  await sleep(200);
  assert.equal(await adaIsCleared(), false,
    'ANOTHER CONFIGURED CHURCH CLEARED SOMEBODY FOR OURS. Storing it is survivable (their map, their ' +
    'business); enforcing it for us is a cross-tenant hole in a safeguarding gate. ok=' + ok);
});

test('the church key keeps everything it had', async () => {
  const [ok, msg] = await publishAs(church, permission(church, church, ada));
  assert.equal(ok, true, 'the church can no longer clear its own volunteers: ' + msg);
  await sleep(250);
  assert.equal(await adaIsCleared(), true, 'the church\'s own clearance is no longer enforced');
  const [ok2] = await publishAs(church, unpermission(church, church, ada));
  assert.equal(ok2, true, 'the church can no longer withdraw a clearance');
  await sleep(250);
  assert.equal(await adaIsCleared(), false, 'the church\'s own withdrawal is no longer enforced');
});

test('THE SESSION ENVELOPE IS STILL CHURCH-KEY-ONLY — the widening stopped at the permission', async () => {
  // The sharper document is the one that was widened; the one carrying KEY MATERIAL was not. Said as a test
  // because the comment on the old rule claimed widening the envelope would then be "a formality", and a
  // later reader might take that as an invitation.
  const t = now();
  const { doc: body } = buildHelperGrant({ session: 'svc-steward', source: GRANT_SOURCE, lifetime: 'session',
    from: t - 60, until: t + 600, helpers: [ada.pub], keepers: [church.pub, sgLead.pub], sessionKeyHex: '77'.repeat(32),
    wrap: (p, pl) => nip44.encrypt(pl, nip44.utils.getConversationKey(sgLead.sk, p)) });
  const [ok] = await publishAs(sgLead, finalizeEvent({ kind: 30078, created_at: t,
    tags: [['d', D.CHECKINHELPER + 'svc-steward'], ['t', NET], ['church', church.pub], ['session', 'svc-steward']],
    content: JSON.stringify(body) }, sgLead.sk));
  assert.equal(ok, false,
    'a safeguarding steward minted a SESSION KEY ENVELOPE. Only the church key can wrap that key to a ' +
    'recipient in the way every reader expects, so this would be an envelope nobody can open — and the ' +
    'authority to hand out register keys is the thing this whole feature exists to hold in one place.');
});

// ── THE ORDER-INDEPENDENCE THE SECOND AUTHOR MADE NECESSARY ────────────────────────────────────────────────

test('A WITHDRAWN CLEARANCE DOES NOT COME BACK WHEN AN OLDER GRANT ARRIVES AFTERWARDS', async () => {
  // ⚠ THIS IS THE DEFECT THE WIDENING WOULD HAVE INTRODUCED, and it is not hypothetical.
  //
  // While the church key was the only author, a grant and its tombstone shared ONE addressable slot, so the
  // store replaced one with the other and put() only ever handed note() the newer. `byP.delete(who)` was
  // therefore final. With TWO authors they are two addresses, both live in the corpus for ever, and the
  // answer has to be re-derived from whatever order they arrive in — which syncChurchFromPeer decides, every
  // 5 to 7 minutes, from a peer that may hold only one of them.
  //
  // Driven in the order that breaks a delete: the steward's TOMBSTONE first, then the church's OLDER grant
  // at an address this relay has never seen. put() stores it as new (it is a different author), note() runs,
  // and with a delete-on-tombstone map the withdrawn clearance is reinstalled.
  const person = K();
  await send(w, doc(person, D.MEMBER + church.pub, { joined: now() }));
  const t = now();
  const [okT] = await publishAs(sgLead, unpermission(sgLead, church, person, t));
  assert.equal(okT, true, 'fixture: the steward\'s tombstone was refused');
  await sleep(200);
  const [okG] = await publishAs(church, permission(church, church, person, { at: t - 600 }));
  assert.equal(okG, true, 'fixture: the church\'s older grant was refused at the door, so this proves nothing');
  await sleep(250);
  // Read the enforcement, not the documents: both documents genuinely exist, which is the point.
  await send(w, grant('svc-p', [person.pub], t - 600, t + 3600, '99'.repeat(32)));
  await sleep(200);
  const got = await asks(person, { kinds: [30078], '#d': [D.CHECKINHELPER + 'svc-p'] });
  assert.deepEqual(got, [],
    'A WITHDRAWN CLEARANCE CAME BACK because an older grant arrived after the tombstone. A steward\'s ' +
    'safeguarding decision was reversed by a peer sync, with nothing on any screen to say so.');
});

test('…AND IT IS STILL WITHDRAWN AFTER A RESTART', async () => {
  // The relay rehydrates every stored document through note() on each boot, and it restarts itself. A rule
  // that holds only in the first of those is a rule with an expiry date.
  const before = await asks(ada, { kinds: [30078], '#d': [D.CHECKINHELPER + SESSION] });
  assert.deepEqual(before, [], 'fixture: Ada is cleared going into the restart test');
  try { w && w.close(); } catch {}
  await new Promise(r => { relay.on('exit', r); try { relay.kill('SIGKILL'); } catch { r(); } });
  await sleep(300);
  await boot();
  await sleep(700);
  w = await conn();
  assert.deepEqual(await asks(ada, { kinds: [30078], '#d': [D.CHECKINHELPER + SESSION] }), [],
    'a withdrawn clearance was reinstated by the boot rehydrate');
});

test('…AND A NEWER GRANT AFTER A WITHDRAWAL STILL CLEARS THEM — the withdrawal is not permanent', async () => {
  // The positive control for the two above. A `revoked` marker that outranked everything would pass both of
  // them and make a person unclearable for ever, which is the shape a mis-aimed fix takes.
  const [ok, msg] = await publishAs(sgLead, permission(sgLead, church, ada, { at: now() }));
  assert.equal(ok, true, 're-clearing was refused at the door: ' + msg);
  await sleep(250);
  assert.equal(await adaIsCleared(), true,
    'a person who was once withdrawn can never be cleared again — the remembered withdrawal is outranking ' +
    'a later decision instead of being ordered against it');
});
