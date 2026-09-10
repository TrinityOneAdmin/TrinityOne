// WHO AUTHORISED THIS CLEARANCE, AND WHEN IS THAT QUESTION ASKED? — RED TEAM 2026-09-10, F3 / F4 / F5.
//   Run: node --test scripts/checkin-clearance-authorisation.test.mjs
//
// THREE FINDINGS, ONE MODEL. `trinityone/checkinperm:<person>` gained a second possible author on
// 2026-09-10 (the church, or a steward it explicitly ticked for safeguarding) and `CHECKIN_PERMITS` stored
// no author at all — so authorisation was decided at INGEST and then forgotten, and hydrateMaps() wipes and
// replays on every boot. This relay restarts itself, so "decided at ingest" really meant "re-decided on a
// schedule nobody chose, against a steward roster that has moved on".
//
//   F3  a WITHDRAWN clearance came back when the steward who withdrew it was de-capped. Measured across a
//       restart on one database: cleared → withdrawn (0) → de-capped, still 0 → RESTART → cleared again (1),
//       session key served, register served, writes accepted. Taking a capability away RE-GRANTED every
//       clearance that lead had ever withdrawn.
//   F4  the mirror: a clearance GRANTED by a steward kept admitting after that steward was de-capped, with
//       no restart, and evaporated at the next one — the unsafe direction live immediately, the availability
//       failure landing later as a volunteer refused at the desk while the console still said "cleared".
//   F5  a +899s clearance made the church's honest withdrawal accepted at the door and silently NOT
//       enforced, while the steward's own was refused by the store as `have-newer`. NEITHER AUTHOR COULD
//       WITHDRAW, for up to fifteen minutes, and nothing retried.
//
// THE FIX IS ONE MODEL, and each test below names the half of it that it holds up:
//   • a version is remembered WITH ITS AUTHOR, one slot per author (not one per person);
//   • a CLEARANCE counts only while its author still holds the authority to have written it — asked at USE
//     time, the shape grantorOk() has had for delegated grants since M2;
//   • a WITHDRAWAL counts for ever from the moment a door admitted it, and is never re-litigated;
//   • the cross-author answer is a maximum over the whole set with a withdrawal winning a tie, and stamps
//     are made comparable at the door by refusing a future-dated CLEARANCE (never a withdrawal).
//
// EVERY ROW RUNS AGAINST A REAL GATEWAY over a real websocket with real signed events, and F3 and F4 include
// A RESTART ON THE SAME DATABASE, because that is the axis both bugs lived on. Each test opens with a
// POSITIVE it would fail on if the fixture were broken — a refusal nothing could have granted is worthless.
//
// TWO CHURCHES ARE CONFIGURED ON THIS ONE BOX, the shipped topology, because note()'s CHECKINPERM_D branch
// now resolves the owning church STRUCTURALLY (the author is a configured church, or its ['church'] tag names
// one) instead of through checkinPermGrantor. A second configured church key therefore has to exist for the
// resolution to be exercised at all. The cross-tenant REFUSALS themselves are not re-asserted here — they are
// asserted by name, by enforcement, in scripts/checkin-permission-mint-widening.test.mjs ("ANOTHER CHURCH'S
// SAFEGUARDING STEWARD CANNOT CLEAR ANYBODY FOR OURS" and "…AND NEITHER CAN THE OTHER CHURCH'S OWN KEY,
// tagging its document to us"), and both still pass on this branch. Said that way round rather than claimed
// here, because a claim about coverage that lives in another file has to name the file.
import { test, before, beforeEach, after } from 'node:test';
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

const PORT = 8912;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const HOST = `127.0.0.1:${PORT}`;
const WS_URL = `ws://${HOST}/relay`;
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const unhex = h => Uint8Array.from(String(h).match(/.{1,2}/g).map(b => parseInt(b, 16)));

const church = K();
const other = K();          // a second congregation on the same box
const sgLead = K();         // OUR steward, ticked for safeguarding
const treasurer = K();      // OUR steward, ticked for FINANCE only — the August leak, in person
const cara = K();           // an ordinary member of ours
const gina = K();           // a guardian, so a record exists to be served or refused
// One volunteer per test, so no test can be carried by another's map entry.
// ONE VOLUNTEER PER ASSERTION, never shared, because a clearance is a PERSISTENT map entry: a person another
// test left withdrawn makes the next test's positive control unreachable, and a positive control that cannot
// pass turns every refusal beside it into a row that proves nothing. Three fixture bugs of exactly that shape
// were caught writing this file.
const vic = K();            // the fixture's own positive
const val = K();            // F3 — the church clears, the steward withdraws, the steward is de-capped
const vex = K();            // F3 — the same, with the steward REMOVED from the roster rather than re-scoped
const vera = K();           // F4 — the steward clears, the steward is de-capped, and is re-capped
const vin = K();            // F5 — the +899s stamp, refused
const vane = K();           // F5 — an ordinary +60s stamp, accepted (the pin must not refuse real drift)
const vola = K();           // the order-independence property note() already had, and must keep
const vid = K();            // per-author slots — a de-capped steward's LATER clearance over the church's withdrawal
const vim = K();            // both doors — the subject
const vale = K();           // both doors — the control imported alongside it
const vow = K();            // the tie — one stamp, two authors

const SESSION = 'svc-now';
const KEY = '11'.repeat(32);
const ALL = [vic, val, vex, vera, vin, vane, vola, vid, vim, vale, vow];

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
async function importAs(who, events) {
  const proof = finalizeEvent({ kind: 27235, created_at: now(),
    tags: [['u', `http://${HOST}/import`], ['method', 'POST'], ['church', church.pub]], content: '' }, who.sk);
  const r = await fetch(`http://${HOST}/import`, { method: 'POST',
    headers: { Authorization: 'Nostr ' + Buffer.from(JSON.stringify(proof)).toString('base64') },
    body: events.map(e => JSON.stringify(e)).join('\n') });
  return [r.status, await r.text()];
}
const doc = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(),
  tags: [['d', d], ['t', NET], ...extra], content: typeof content === 'string' ? content : JSON.stringify(content) }, who.sk);

// A CLEARANCE, from the SHIPPED builder. `by` and `cp` are both parameters because every row below is a
// different combination of them, and `at` because two of the three findings are about the stamp.
const permission = (by, cp, who, opts = {}) => finalizeEvent({ kind: 30078, created_at: opts.at || now(),
  tags: [['d', D.CHECKINPERM + who.pub], ['t', NET], ['church', cp.pub], ['person', who.pub]],
  content: JSON.stringify(buildCheckinPermission({ person: who.pub, source: opts.source || 'steward',
    lifetime: opts.lifetime || 'open', from: opts.from != null ? opts.from : now() - 86400,
    until: opts.until !== undefined ? opts.until : null })) }, by.sk);
const unpermission = (by, cp, who, at) => finalizeEvent({ kind: 30078, created_at: at || now(),
  tags: [['d', D.CHECKINPERM + who.pub], ['t', NET], ['church', cp.pub], ['deleted', '1']], content: '' }, by.sk);

// The session envelope. STILL CHURCH-KEY-ONLY, and untouched by this change.
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

// ── THE OBSERVABLES, all three of them, because "cleared" is not one thing ────────────────────────────────
//
// Asked through the ENFORCEMENT and never by reading the clearance back: the document being on disk is not
// the claim, `CHECKIN_PERMITS` is, and the finding under test is precisely a document on disk meaning one
// thing to the map and another to the corpus. All three of these go through checkinPermitted().
const holdsKey = async (who) => (await asks(who, { kinds: [30078], '#d': [D.CHECKINHELPER + SESSION] })).length;
const holdsRec = async (who) => (await asks(who, { kinds: [30078], '#d': [D.CHECKIN + 'r1'] })).length;
// A FRESH ADDRESS EVERY TIME. Re-using one made this observable lie: a second write to the same
// (author, kind, d-tag) inside the same second is refused by the STORE as `have-newer` — a tie broken by
// lowest event id — so a cleared volunteer read as unable to write and the row looked like a working refusal.
let _wn = 0;
const canWrite = async (who) => (await publishAs(who, doc(who, D.CHECKIN + 'w' + (++_wn) + '-' + who.pub.slice(0, 6), 'x',
  [['church', church.pub], ['session', SESSION]])))[0];
// One line, all three, so a partial fix (the key served and the register refused, or either without the
// write gate) cannot pass as a whole one.
const clearance = async (who) => [await holdsKey(who), await holdsRec(who), await canWrite(who)];
const CLEARED = [1, 1, true], REFUSED = [0, 0, false];

async function boot() {
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir,
      CHURCH_NPUB: npubEncode(church.pub) + ',' + npubEncode(other.pub) } });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://${HOST}/status`)).ok) break; } catch {} await sleep(150); }
}
// THE AXIS F3 AND F4 LIVE ON. Same data directory, so every document is replayed through note() by
// hydrateMaps() with accept() nowhere in the path — which is where a rule that only ran at the door
// stopped running.
async function reboot() {
  try { w && w.close(); } catch {}
  try { relay.kill('SIGKILL'); } catch {}
  await sleep(600);
  await boot();
  await sleep(700);
  w = await conn();
}
// EVERY ROSTER SAVE CARRIES A STRICTLY INCREASING STAMP. The roster is ONE addressable document, so two
// saves inside the same second are two versions of one slot and the store answers `have-newer` on the
// second — tie-broken by lowest event id, a coin flip. A de-cap that silently did not save reads exactly
// like a de-cap that was correctly ignored, which is a false green in both directions.
let _rts = 0;
const rosterDoc = (pubkeys, caps) => { _rts = Math.max(now(), _rts + 1);
  return finalizeEvent({ kind: 30078, created_at: _rts,
    tags: [['d', D.STEWARDS + church.pub], ['t', NET]], content: JSON.stringify({ pubkeys, caps }) }, church.sk); };
// De-cap or re-cap our safeguarding lead, live. `caps: {…: ['members']}` is an EXPLICIT list, which is how
// a church says "not safeguarding" — stewardCan() would read an absent entry as "full steward (compat)".
const setLeadCaps = async (caps) => {
  const [ok, msg] = await publishAs(church, rosterDoc([sgLead.pub, treasurer.pub],
    { [sgLead.pub]: caps, [treasurer.pub]: ['finance'] }));
  assert.equal(ok, true, 'fixture: the roster re-save was refused, so nothing below is measuring a de-cap: ' + msg);
  await sleep(350);
};
// …and remove them from the roster altogether, which is what "the lead moved on" actually looks like.
const removeLead = async () => {
  const [ok, msg] = await publishAs(church, rosterDoc([treasurer.pub], { [treasurer.pub]: ['finance'] }));
  assert.equal(ok, true, 'fixture: the roster re-save was refused: ' + msg);
  await sleep(350);
};

before(async () => {
  await requireFreePort(PORT, 'checkin-clearance-authorisation.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-ckauth-'));
  await boot();
  w = await conn();
  for (const who of [sgLead, treasurer, cara, gina, ...ALL]) await send(w, doc(who, D.MEMBER + church.pub, { joined: now() }));
  await send(w, rosterDoc([sgLead.pub, treasurer.pub],
    { [sgLead.pub]: ['safeguarding'], [treasurer.pub]: ['finance'] }));
  await send(w, doc(other, D.STEWARDS + other.pub, { pubkeys: [], caps: {} }));
  await send(w, doc(church, D.GUARDIANS + church.pub, { links: {} }));
  await sleep(250);
  const t = now();
  await send(w, grant(SESSION, ALL.map(v => v.pub), t - 600, t + 7200, KEY));
  await send(w, checkinRec('r1', gina.pub));
  await sleep(300);
});
// EVERY TEST STARTS FROM THE SAME ROSTER, and this is not tidiness — it is what makes a SABOTAGE MATRIX
// readable. Several tests below de-cap the lead in the middle and re-tick her at the end; when a sabotage
// makes one of them fail early, that trailing line never runs and every test after it inherits a de-capped
// roster, so one broken rule reports as six. Resetting here means each row's failures are its own.
beforeEach(async () => { await setLeadCaps(['safeguarding']); });
after(() => { try { w && w.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── THE FIXTURE ITSELF, so that no refusal below can be vacuous ───────────────────────────────────────────

test('THE FIXTURE GRANTS: an envelope alone clears nobody, and a clearance clears', async () => {
  // Named in the envelope and not yet cleared. If this were already CLEARED the file would be measuring
  // nothing; if the envelope did not name them, every "cleared" below would be unreachable for a second
  // reason and the fix could be reverted without a single row moving.
  assert.deepEqual(await clearance(vic), REFUSED, 'fixture: Vic is cleared before anything cleared her');
  const [ok, msg] = await publishAs(church, permission(church, church, vic, { at: now() - 60 }));
  assert.equal(ok, true, 'fixture: the church\'s own clearance was refused at the door: ' + msg);
  await sleep(300);
  assert.deepEqual(await clearance(vic), CLEARED,
    'fixture: the church cleared Vic and the relay did not enforce it — the three observables this file ' +
    'measures (session key, register, write) are not reachable, so every assertion below is vacuous');
});

// ── F3. A WITHDRAWAL IS NEVER RE-LITIGATED ────────────────────────────────────────────────────────────────

test('F3 — a WITHDRAWN clearance stays withdrawn when the withdrawing steward is DE-CAPPED, ACROSS A RESTART', async () => {
  // The CHURCH clears Val; the safeguarding lead withdraws it — the shipped, supported act — and is then
  // re-scoped, which is an ordinary thing for a church to do.
  const [okG, gMsg] = await publishAs(church, permission(church, church, val, { at: now() - 60 }));
  assert.equal(okG, true, 'fixture: the church\'s clearance was refused: ' + gMsg);
  await sleep(300);
  assert.deepEqual(await clearance(val), CLEARED, 'fixture: the church cleared Val and it was not enforced');

  const [ok, msg] = await publishAs(sgLead, unpermission(sgLead, church, val));
  assert.equal(ok, true, 'the safeguarding steward\'s withdrawal was refused at the door: ' + msg);
  await sleep(300);
  assert.deepEqual(await clearance(val), REFUSED, 'the withdrawal was accepted and not enforced');

  await reboot();
  assert.deepEqual(await clearance(val), REFUSED,
    'the withdrawal did not survive a restart with the roster UNCHANGED — that is not F3, that is the ' +
    'order-independence note() already had, and it has been broken');

  await setLeadCaps(['members']);
  assert.deepEqual(await clearance(val), REFUSED,
    'de-capping the steward reinstated the clearance she withdrew, with no restart at all');

  await reboot();
  assert.deepEqual(await clearance(val), REFUSED,
    'THE CLAIM: hydrateMaps() replayed the corpus, checkinPermGrantor() no longer vouched for the ' +
    'withdrawing steward, her tombstone was DROPPED and the church\'s older clearance was the only version ' +
    'left — so Val is cleared again, holds the session key, is served the children\'s register and her ' +
    'writes are accepted. Taking a capability off a safeguarding lead RE-GRANTED every clearance she ever ' +
    'withdrew, on a restart this relay performs on itself.');
});

test('F3 — …and when she is REMOVED FROM THE ROSTER ALTOGETHER, which is what "the lead moved on" means', async () => {
  // The de-cap above is the re-scoping case. A lead who LEAVES is off the roster, so `_stewardCaps` and
  // STEWARD_CAPS cannot describe her at all — which is why the fix cannot be "ask whether the church still
  // vouches for her in some weaker capacity". A withdrawal has to stand on its own.
  const [okG, gMsg] = await publishAs(church, permission(church, church, vex, { at: now() - 60 }));
  assert.equal(okG, true, 'fixture: the church\'s clearance was refused: ' + gMsg);
  await sleep(300);
  assert.deepEqual(await clearance(vex), CLEARED, 'fixture: the church cleared Vex and it was not enforced');
  const [okW, wMsg] = await publishAs(sgLead, unpermission(sgLead, church, vex));
  assert.equal(okW, true, 'fixture: the withdrawal was refused: ' + wMsg);
  await sleep(300);
  assert.deepEqual(await clearance(vex), REFUSED, 'fixture: the withdrawal was not enforced');

  await removeLead();
  assert.deepEqual(await clearance(vex), REFUSED, 'removing the steward from the roster reinstated the clearance she withdrew');
  await reboot();
  assert.deepEqual(await clearance(vex), REFUSED,
    'the withdrawing steward is off the roster entirely and her withdrawal was dropped on the rehydrate. A ' +
    'withdrawal must be able to win: it can only ever REFUSE somebody, so keeping it in force needs no ' +
    'continuing authority — only the door that admitted it needed one.');
});

// ── F4. A CLEARANCE ANSWERS FOR ITS AUTHOR, AT USE TIME ───────────────────────────────────────────────────

test('F4 — a clearance GRANTED by a steward stops granting the moment that steward is de-capped, with NO restart', async () => {
  assert.deepEqual(await clearance(vera), REFUSED, 'fixture: Vera is cleared before anything cleared her');
  const [ok, msg] = await publishAs(sgLead, permission(sgLead, church, vera));
  assert.equal(ok, true, 'fixture: the safeguarding steward\'s clearance was refused: ' + msg);
  await sleep(300);
  assert.deepEqual(await clearance(vera), CLEARED, 'fixture: the steward\'s clearance was not enforced');

  // The positive across a restart FIRST, so the refusal below cannot be a rehydrate that simply loses
  // steward-authored documents.
  await reboot();
  assert.deepEqual(await clearance(vera), CLEARED,
    'fixture: a steward-authored clearance did not survive a restart with the roster unchanged, so the ' +
    'refusal this test is about would be indistinguishable from a broken rehydrate');

  await setLeadCaps(['members']);
  assert.deepEqual(await clearance(vera), REFUSED,
    'THE CLAIM: the steward who cleared Vera holds no safeguarding capability any more and her clearance ' +
    'still admits — the session key served, the register served, writes accepted — because authorisation ' +
    'was decided at ingest and never asked again. grantorOk()\'s own comment states the rule: "revoking a ' +
    'steward immediately drops the grants they created — no re-derivation pass, the check just runs at ' +
    'use-time". It ran at use time for a group leader and a care admin, and not for this.');

  await reboot();
  assert.deepEqual(await clearance(vera), REFUSED,
    'and it must be the SAME answer after a restart — the old code refused only after one, so the unsafe ' +
    'direction was live immediately and the availability failure landed later, as a volunteer refused at ' +
    'the desk while the console still listed her as cleared');

  await setLeadCaps(['safeguarding']);
  assert.deepEqual(await clearance(vera), CLEARED,
    'A ONE-WAY DOOR. Re-ticking the lead for safeguarding must bring her clearances back: de-capping ' +
    'somebody by mistake otherwise destroys work no console can restore. This is why note() records the ' +
    'version whoever wrote it and leaves the authority question to use time — asking it at the ingest as ' +
    'well meant the rehydrate DROPPED the clearance from the map, and nothing replays a stored document ' +
    'except another hydrateMaps(). Measured at 0/0/false before that half of the fix.');
});

test('PER-AUTHOR SLOTS — a de-capped steward\'s LATER clearance no longer buries the church\'s withdrawal', async () => {
  // THIS IS THE ROW THE PER-AUTHOR SLOTS EXIST FOR, and neither half of the fix passes it alone.
  //
  // The church WITHDRAWS Vid; the safeguarding lead then clears her — legitimately, and later, which is the
  // "whoever may clear may withdraw" symmetry the widening deliberately has. Then the lead is de-capped. The
  // old map kept ONE entry per person, so the entry was the steward's clearance (the later stamp) with no
  // author recorded, and de-capping her changed nothing: a person the CHURCH had withdrawn stayed cleared on
  // the word of somebody the church no longer trusts with the question.
  //
  // ⚠ AND THIS FIXTURE IS ALSO THE MEASUREMENT OF WHAT IS *NOT* FIXED, so it is written down here rather
  // than left for somebody to rediscover. The first two steps are a withdrawal at T and a clearance at T+120
  // resolving to CLEARED — and that is the SAME relay state a STALE clearance would produce if it had been
  // published BEFORE the withdrawal by a device 120s fast. The relay cannot tell those two apart, so inside
  // checkinPermFutureOk's window a stale clearance can still outrank a withdrawal.
  //
  // DO NOT "FIX" IT BY MAKING A WITHDRAWAL BEAT EVERY CLEARANCE INSIDE THE BAND. That is the obvious move
  // and it breaks the row directly below this comment, and with it the shipped behaviour
  // checkin-permission-mint-widening.test.mjs asserts by name — "…AND A NEWER GRANT AFTER A WITHDRAWAL
  // STILL CLEARS THEM — the withdrawal is not permanent". A cross-author re-grant would silently fail for
  // two minutes, which is the accepted-and-not-enforced shape this whole change exists to remove.
  const [okW, wMsg] = await publishAs(church, unpermission(church, church, vid, now() - 120));
  assert.equal(okW, true, 'fixture: the church\'s withdrawal was refused: ' + wMsg);
  await sleep(250);
  assert.deepEqual(await clearance(vid), REFUSED, 'fixture: withdrawn and not enforced');

  const [okC, cMsg] = await publishAs(sgLead, permission(sgLead, church, vid, { at: now() }));
  assert.equal(okC, true, 'fixture: the steward\'s later clearance was refused: ' + cMsg);
  await sleep(300);
  assert.deepEqual(await clearance(vid), CLEARED,
    'fixture: a NEWER clearance after a withdrawal must clear them — a remembered withdrawal that outranked ' +
    'everything would make a person unclearable for ever, which is the shape a mis-aimed fix takes');

  await setLeadCaps(['members']);
  assert.deepEqual(await clearance(vid), REFUSED,
    'THE CLAIM: with the steward de-capped, the only version left that this church still vouches for is its ' +
    'OWN WITHDRAWAL — so Vid must be refused. The old code could not reach this answer at all: one entry ' +
    'per person means the church\'s withdrawal was overwritten by the later clearance and there was nothing ' +
    'to fall back to, and no author was recorded to disqualify.');
  await reboot();
  assert.deepEqual(await clearance(vid), REFUSED, 'and the same after a rehydrate');
  await setLeadCaps(['safeguarding']);
  assert.deepEqual(await clearance(vid), CLEARED, 'and re-ticking her restores it, as above');
});

// ── F5. THE STAMP ─────────────────────────────────────────────────────────────────────────────────────────

test('F5 — a CLEARANCE dated far into the future is refused at the door, and a withdrawal never is', async () => {
  // THE POSITIVE FIRST, and it is the one that matters: the pin must not refuse an ordinary clock.
  const [okNear, nearMsg] = await publishAs(sgLead, permission(sgLead, church, vane, { at: now() + 60 }));
  assert.equal(okNear, true,
    'a clearance one minute ahead of this relay\'s clock was REFUSED: ' + nearMsg + '. Phones and ' +
    'Raspberry Pis drift by seconds; a pin that refuses ordinary drift stops a church clearing anybody.');
  await sleep(300);
  assert.deepEqual(await clearance(vane), CLEARED, 'fixture: the near-stamped clearance was not enforced');

  // …and now the stamp the store allows and this document must not.
  const [okFar, farMsg] = await publishAs(sgLead, permission(sgLead, church, vin, { at: now() + 899 }));
  assert.equal(okFar, false,
    'a clearance dated +899s was accepted. created_at is this document\'s ORDERING KEY across its two ' +
    'authors and scripts/event-store.mjs allows +900s of it, so a fast device pins a clearance up to ' +
    'fifteen minutes ahead and every honest withdrawal either author signs carries a LOWER stamp: the ' +
    'church\'s is accepted at the door and silently dropped, and the steward\'s own is refused by the store ' +
    'as have-newer, so NEITHER AUTHOR CAN WITHDRAW and nothing retries. (Refused, not clamped: a clamp has ' +
    'to be remembered, and the only thing that could remember it is wiped and replayed on every boot.) ' + farMsg);
  await sleep(250);
  assert.deepEqual(await clearance(vin), REFUSED, 'and the refusal was enforced');

  // A WITHDRAWAL IS NEVER REFUSED FOR ITS STAMP — refusing one is the unsafe direction.
  const [okTomb, tombMsg] = await publishAs(sgLead, unpermission(sgLead, church, vane, now() + 899));
  assert.equal(okTomb, true,
    'a WITHDRAWAL dated into the future was refused: ' + tombMsg + '. The asymmetry is the whole model — a ' +
    'clearance widens access to a children\'s register and must answer for itself, a withdrawal narrows ' +
    'and must always be able to land.');
  await sleep(300);
  assert.deepEqual(await clearance(vane), REFUSED, 'the future-stamped withdrawal was accepted and not enforced');
});

// ── THE PROPERTY note() ALREADY HAD, WHICH THIS CHANGE MUST NOT COST ──────────────────────────────────────

test('A WITHDRAWAL STILL WINS WHEN IT ARRIVES BEFORE ITS GRANT — order-independence, kept', async () => {
  // note()'s CHECKINPERM_D branch went to real trouble over this: a withdrawal is stored AS A VERSION
  // ({revoked:true, ts}) rather than as a delete, so a tombstone arriving before the grant it cancels still
  // wins. syncChurchFromPeer runs every 5-7 minutes and this relay restarts itself, so the order really is
  // arbitrary. The comparison moved INSIDE one author's own slot with this fix; this proves the property
  // moved with it.
  //
  // The tombstone is published FIRST at a LATER stamp, then the grant it cancels arrives with an earlier
  // one — which is what a peer sync, or a rehydrate replaying an old copy, looks like.
  const t = now();
  const [okT] = await publishAs(sgLead, unpermission(sgLead, church, vola, t));
  assert.equal(okT, true, 'fixture: the tombstone was refused');
  await sleep(250);
  const [okG, gMsg] = await publishAs(church, permission(church, church, vola, { at: t - 300 }));
  assert.equal(okG, true, 'fixture: the older grant was refused at the door, so nothing raced anything: ' + gMsg);
  await sleep(300);
  assert.deepEqual(await clearance(vola), REFUSED,
    'an OLDER clearance arriving after the withdrawal that cancels it REINSTATED it. Delete-on-tombstone ' +
    'is order-dependent and note() deliberately stopped doing it; the per-author slots this fix introduces ' +
    'must keep comparing within a slot, or the property is silently gone.');
  await reboot();
  assert.deepEqual(await clearance(vola), REFUSED, 'and it did not survive the rehydrate, where the replay order is the store\'s');
});

test('A TIE GOES TO THE WITHDRAWAL — fail closed, and the relay folds it the way the console does', async () => {
  // ADDED BECAUSE THE SABOTAGE MATRIX FOUND NOTHING. Removing the `(ts === wts && pm.revoked)` clause from
  // checkinPermitted() changed no relay result at all, while the same removal on the console side failed a
  // test immediately — so the relay's half of the rule was a claim with nothing behind it. The two halves
  // have to agree, or a console showing "withdrawn" sits over a relay still admitting them.
  //
  // Two authors, ONE stamp. Nothing orders them, so the answer has to be CHOSEN rather than discovered, and
  // for a children's register the direction to fail in is "refused". The stamp is fixed for both documents
  // so the tie is real rather than a race this test happened to win.
  const t = now() - 30;
  const [okC, cMsg] = await publishAs(sgLead, permission(sgLead, church, vow, { at: t }));
  assert.equal(okC, true, 'fixture: the steward\'s clearance was refused: ' + cMsg);
  await sleep(250);
  assert.deepEqual(await clearance(vow), CLEARED, 'fixture: the clearance alone was not enforced, so a tie proves nothing');

  const [okW, wMsg] = await publishAs(church, unpermission(church, church, vow, t));
  assert.equal(okW, true, 'fixture: the church\'s withdrawal at the same stamp was refused at the door: ' + wMsg);
  await sleep(300);
  assert.deepEqual(await clearance(vow), REFUSED,
    'A CLEARANCE AND A WITHDRAWAL AT THE SAME TIMESTAMP, FROM TWO AUTHORS, RESOLVED TO "CLEARED". Whichever ' +
    'the Map happens to iterate second would decide, which is a safeguarding answer settled by insertion ' +
    'order. checkinPermitted() breaks the tie for the withdrawal deliberately; so does the console\'s emit().');
  await reboot();
  assert.deepEqual(await clearance(vow), REFUSED,
    'and the same after a rehydrate, where the insertion order is store.eachKind\'s and not the wire\'s');
});

// ── BOTH DOORS ────────────────────────────────────────────────────────────────────────────────────────────

test('BOTH DOORS — the ingest installs no clearance the websocket refuses, and no future-stamped one either', async () => {
  // The positive: /import really does install a clearance, so the refusals below are refusals and not a
  // route that never worked.
  const [st, body] = await importAs(church, [permission(church, church, vale, { at: now() - 30 })]);
  assert.equal(st, 200, '/import refused the church\'s own authorisation: ' + body);
  await sleep(500);
  assert.deepEqual(await clearance(vale), CLEARED, 'fixture: /import installed nothing at all, so nothing below is a door test');

  // 1. AN ORDINARY MEMBER'S CLEARANCE — refused at the websocket, then pushed through /import with the
  //    church's own operator credential.
  const byMember = permission(cara, church, vim);
  const [okWs] = await publishAs(cara, byMember);
  assert.equal(okWs, false, 'an ordinary member cleared somebody at the websocket');
  // 2. A FINANCE-ONLY STEWARD'S — the August leak, in person.
  const byFinance = permission(treasurer, church, vim);
  const [okFin] = await publishAs(treasurer, byFinance);
  assert.equal(okFin, false, 'a FINANCE-only steward cleared somebody at the websocket');
  // 3. A FUTURE-STAMPED ONE FROM THE CHURCH ITSELF — the F5 pin, which must hold at the ingest too, because
  //    note() runs AFTER store.put() and a rule stated only there would leave the poisoned stamp on disk for
  //    the next hydrateMaps() to replay with `now` moved past it.
  const future = permission(church, church, vim, { at: now() + 899 });

  const [st2, body2] = await importAs(church, [byMember, byFinance, future]);
  assert.equal(st2, 200, '/import errored: ' + body2);
  await sleep(600);
  assert.deepEqual(await clearance(vim), REFUSED,
    'ONE OF THE THREE DOCUMENTS THE WEBSOCKET REFUSES WAS INSTALLED AND ENFORCED BY THE INGEST. accept() ' +
    'and note() have disagreed on this very document before — see the uppercase-hex d-tag correction on ' +
    'note()\'s CHECKINPERM_D branch — and /import does store.put with no accept() pass at all: ' + body2);
  await reboot();
  assert.deepEqual(await clearance(vim), REFUSED,
    'and not after a rehydrate either, which is where a document already on disk gets its second chance');
  assert.deepEqual(await clearance(vale), CLEARED,
    'the control imported alongside them stopped being enforced, so the three refusals above may be a ' +
    'broken ingest rather than three working refusals');
});
