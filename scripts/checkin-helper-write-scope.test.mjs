// A CHECK-IN HELPER MAY WRITE INTO HER OWN SESSION, AND PROVABLY NOWHERE ELSE IN THE REGISTER.
// Run: node --test scripts/checkin-helper-write-scope.test.mjs
//
// RED TEAM 2026-09-10, F1 — the merge blocker. accept()'s check-in branch bound a helper's write to the
// ['session'] tag ON THE INCOMING EVENT, a tag the writer chooses, and never asked which session the record
// at that d-tag belongs to. A helper cleared and in-window for session S1 was correctly refused every READ of
// a session-S2 record and was still ACCEPTED PUBLISHING AT THAT RECORD'S OWN ADDRESS by tagging her event S1.
//
// WHY IT IS A CHILD-SAFETY DEFECT AND NOT AN UNTIDINESS. Addressable events are per author, so the forgery
// does not replace the church's row in the store — it sits beside it and both are served. The console's
// register keys `byId` on the d-tag SUFFIX and take() is newest-wins, so the newer forgery renders. Piece 1's
// `ck` tag is what makes it bite: the forger seals a body under the session key she legitimately holds, and
// _encOpenSealedCopy looks the key up by the tag she wrote. `rec.code` is the pickup code and CheckoutModal
// releases a child on `code.trim() === String(rec.code)`.
//
// SO THIS FILE HAS THREE HALVES, and CLAUDE.md rule 1 is why there are three rather than one:
//
//   1. THE WEBSOCKET DOOR — a real gateway, real AUTH, real signed events. What accept() admits and refuses.
//   2. THE INGEST DOOR — /import, which does store.put with NO accept() pass. accept() and note() have
//      disagreed before and that is how a rule gets enforced on one and bypassed on the other; the uppercase
//      `checkinperm:` d-tag of 2026-09-10 is the worked example. Every refusal here is measured a second time
//      through /import, and once more after a RESTART, so a rehydrate cannot reinstate it.
//   3. THE POINT OF USE — the SHIPPED reader (encSubscribe + encOpen + _encOpenSealedCopy, lifted out of
//      vendor/steward.js with real nip44 underneath) fed exactly what the relay serves the church. A gate
//      nobody's screen consults is not a feature, and the harm in F1 was a rendered row, not a stored event.
//      So the register itself is asserted, not the OK frame.
//
// EVERY REFUSAL HAS A PASSING BASELINE BESIDE IT. A helper who cannot write at all, or an /import that
// imports nothing, would produce identical "refused" results — so the legitimate write is asserted in the
// same run, from the same actor, over the same socket, and /import is asked to accept a helper's honest
// record in the very request that refuses her forgery.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { requireFreePort } from './test-ports.mjs';
import { fnBody, stmt } from './test-slice.mjs';
import { buildHelperGrant, buildCheckinPermission, GRANT_SOURCE,
         readCheckinHelperCopy, checkinSessionOf } from './checkin-role-source.mjs';
import { D } from './trinity-doc-types.mjs';

const PORT = 8910;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs; checked free by requireFreePort
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const HOST = `127.0.0.1:${PORT}`;
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const unhex = h => Uint8Array.from(String(h).match(/.{1,2}/g).map(b => parseInt(b, 16)));

// THE CAST, named for what each one proves.
const church = K();       // St Chad's
const other = K();        // A CO-TENANT on the same box, deliberately reusing the same record address
const sgLead = K();       // a steward ticked for Safeguarding — must still be able to write anything
const ada = K();          // cleared, and in-window for MORNING only. The forger.
const bea = K();          // cleared, and in-window for AFTERNOON only
const dina = K();         // cleared, and in-window for MORNING — ada's COLLEAGUE, on the same session.
                          // A children's team is a team: the fixture had no two helpers on one session, which
                          // is why helper-vs-helper went unnoticed for so long.
const cara = K();         // an ordinary member, never cleared
const gina = K();         // a guardian, p-tagged on the morning record

const MORNING = 'svc-morning', AFTERNOON = 'svc-afternoon';
const KEY_AM = '11'.repeat(32), KEY_PM = '22'.repeat(32), RING = '44'.repeat(32);
const CODE = '4821';      // the church's pickup code. The forgery's whole purpose is to change this.

let relay, dataDir;
let w;                    // a plain unauthenticated socket, for the church's own seeding writes

const conn = () => new Promise((r, j) => { const s = new WebSocket(WS_URL); s.on('open', () => r(s)); s.on('error', j); });
const send = (s, e) => new Promise(res => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { s.off('message', on); res([m[2], m[3] || '']); } };
  s.on('message', on); s.send(JSON.stringify(['EVENT', e]));
});
// A socket that AUTHENTICATES as `who` before its write. The check-in gates are authed-only, so an
// unauthenticated write would be refused for the WRONG REASON and every negative below would be vacuous.
async function publishAs(who, e) {
  const s = await conn();
  const authed = new Promise(res => {
    const on = d => {
      const m = JSON.parse(d);
      if (m[0] === 'AUTH') { s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)])); res(true); }
    };
    s.on('message', on); setTimeout(() => res(false), 600);
  });
  s.send(JSON.stringify(['REQ', 'warm', { kinds: [30078], limit: 1 }]));
  const gotChallenge = await authed;
  assert.equal(gotChallenge, true, 'the relay never sent an AUTH challenge — the write below would be refused for the wrong reason');
  await sleep(100);
  const out = await send(s, e); s.close(); return out;
}
function req(s, sub, f, sk, ms = 700) {
  return new Promise(res => {
    const out = [];
    const on = d => {
      const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === sub) out.push(m[2]);
      else if (m[0] === 'AUTH' && sk) s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, sk)]));
    };
    s.on('message', on); s.send(JSON.stringify(['REQ', sub, f]));
    setTimeout(() => { s.off('message', on); res(out); }, ms);
  });
}
async function asks(who, filter) {
  const s = await conn();
  await req(s, 'warm', { kinds: [30078], limit: 1 }, who.sk, 350);
  const got = await req(s, 'q' + Math.random().toString(36).slice(2, 7), filter, who.sk);
  s.close(); return got;
}
const copiesOf = async (d) => (await asks(church, { kinds: [30078], '#d': [d] }));

const doc = (who, d, content, extra = []) => finalizeEvent({
  kind: 30078, created_at: now(),
  tags: [['d', d], ['t', NET], ...extra],
  content: typeof content === 'string' ? content : JSON.stringify(content),
}, who.sk);
const permission = (by, whoPub) => finalizeEvent({
  kind: 30078, created_at: now(),
  tags: [['d', D.CHECKINPERM + whoPub], ['t', NET], ['church', by.pub], ['person', whoPub]],
  content: JSON.stringify(buildCheckinPermission({ person: whoPub, source: 'steward', lifetime: 'open', from: now() - 86400, until: null })),
}, by.sk);
const grant = (churchK, session, helpers, key) => {
  const t = now();
  const { doc: body, failed } = buildHelperGrant({
    session, source: GRANT_SOURCE, lifetime: 'session', from: t - 600, until: t + 3600,
    helpers, keepers: [churchK.pub, sgLead.pub], sessionKeyHex: key,
    wrap: (p, pl) => nip44.encrypt(pl, nip44.utils.getConversationKey(churchK.sk, p)),
  });
  assert.equal(failed.length, 0, 'the envelope could not be wrapped for ' + failed);
  return finalizeEvent({
    kind: 30078, created_at: t,
    tags: [['d', D.CHECKINHELPER + session], ['t', NET], ['church', churchK.pub], ['session', session]],
    content: JSON.stringify(body),
  }, churchK.sk);
};
// A record in the shape the SHIPPED writer emits: `content` sealed to the safeguarding ring, plus the
// cleartext ['session'] / ['p'] tags _encCleartextTags derives, plus piece 1's ['ck'] copy under the
// session key. Both locks, so the point-of-use half below is not testing a shape nothing produces.
const record = (author, id, session, sessionKey, body, extra = []) => {
  const obj = { id, session, childName: 'Child ' + id, code: CODE, date: '2026-09-06', out: null, ...body };
  return doc(author, D.CHECKIN + id, nip44.encrypt(JSON.stringify(obj), unhex(RING)), [
    ['church', (extra.cp || church).pub || church.pub], ['enc', '2'], ['session', session],
    ['ck', nip44.encrypt(JSON.stringify(obj), unhex(sessionKey))],
    ...(Array.isArray(extra) ? extra : []),
  ]);
};
// What the forger can actually sign: she has no ring key, so `content` is garbage to the church — and a
// ['ck'] copy sealed under the session key she DOES hold, tagged with the session she IS entitled to.
const forgeryBy = (who, id, session, body, extra = []) => {
  const obj = { id, session, childName: 'Child ' + id, code: '0000', date: '2026-09-06', out: 'collected by A. Stranger', ...body };
  return doc(who, D.CHECKIN + id, nip44.encrypt(JSON.stringify(obj), unhex('ee'.repeat(32))), [
    ['church', church.pub], ['enc', '2'], ['session', session],
    ['ck', nip44.encrypt(JSON.stringify(obj), unhex(KEY_AM))],
    ...extra,
  ]);
};
const forgery = (id, session, body) => forgeryBy(ada, id, session, body);
const nip98 = (who, path, extra = []) => 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({
  kind: 27235, created_at: now(), tags: [['u', `http://${HOST}${path}`], ['method', 'POST'], ...extra], content: '',
}, who.sk))).toString('base64');
const importAs = async (who, events) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/import`, {
    method: 'POST',
    headers: { Authorization: nip98(who, '/import', [['church', church.pub]]), 'Content-Type': 'application/x-ndjson' },
    body: events.map(e => JSON.stringify(e)).join('\n') + '\n',
  });
  return [r.status, await r.json().catch(() => ({}))];
};

async function boot() {
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub) + ',' + npubEncode(other.pub) },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(150); }
  throw new Error('the gateway never came up on ' + PORT);
}
const stopRelay = async () => { try { relay.kill('SIGKILL'); } catch {} await sleep(400); };

before(async () => {
  await requireFreePort(PORT, 'checkin-helper-write-scope.test.mjs (it spawns its own gateway)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-ck-writescope-'));
  await boot();
  w = await conn();
  for (const who of [sgLead, ada, bea, dina, cara, gina]) await send(w, doc(who, D.MEMBER + church.pub, { joined: now() }));
  await send(w, doc(church, D.STEWARDS + church.pub, { pubkeys: [sgLead.pub], caps: { [sgLead.pub]: ['safeguarding'] } }));
  await send(w, doc(church, D.GUARDIANS + church.pub, { links: {} }));
  await send(w, doc(other, D.STEWARDS + other.pub, { pubkeys: [] }));
  await sleep(250);
  await send(w, permission(church, ada.pub));
  await send(w, permission(church, bea.pub));
  await send(w, permission(church, dina.pub));
  await send(w, grant(church, MORNING, [ada.pub, dina.pub], KEY_AM));
  await send(w, grant(church, AFTERNOON, [bea.pub], KEY_PM));
  // The church's own two records: one at each session. `pm1` is the address ada must never be able to touch.
  await send(w, record(church, 'am1', MORNING, KEY_AM, {}, [['p', gina.pub]]));
  await send(w, record(church, 'pm1', AFTERNOON, KEY_PM, {}));
  await sleep(400);
});
after(async () => {
  try { w.close(); } catch {}
  await stopRelay();
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

// ── 1. THE WEBSOCKET DOOR ────────────────────────────────────────────────────────────────────────────────
test('BASELINE: the helper can still do her job — a new record, and an update inside her own session', async () => {
  // Without this test every refusal below is satisfied by a helper who can write nothing at all, which is
  // exactly the shape a broken before() produces.
  const [okNew] = await publishAs(ada, forgery('ada-new', MORNING, { out: null }));
  assert.equal(okNew, true, 'a cleared, in-window helper could not check a child in — the feature is dead, and every refusal below is vacuous');
  // Her OWN record she may update; the church's she may not, even in her session (F-B below). A clear second
  // later, or the STORE refuses the same-second rewrite as `have-newer` (see the note on canWrite).
  await sleep(1100);
  const [okOwn] = await publishAs(ada, forgery('ada-new', MORNING, { out: 1 }));
  assert.equal(okOwn, true, 'a helper could not update a record SHE wrote in her own session — the gate is refusing the case the capability exists for');
  const [okChurch] = await publishAs(church, record(church, 'pm1', AFTERNOON, KEY_PM, { code: '5555' }));
  assert.equal(okChurch, true, 'the church key was refused its own register');
  const [okSg] = await publishAs(sgLead, record(sgLead, 'pm1', AFTERNOON, KEY_PM, { code: '6666' }));
  assert.equal(okSg, true, 'a safeguarding steward was refused the register — the feature exists so volunteers need not be made stewards, not so stewards lose it');
});

test('THE DEFECT: a helper cannot publish at another session\'s address by tagging her own session', async () => {
  const [ok, msg] = await publishAs(ada, forgery('pm1', MORNING, {}));
  assert.equal(ok, false, 'RED TEAM F1: a helper in-window for the MORNING was accepted writing at the AFTERNOON record\'s own address, so she can set any child\'s pickup code on any record from any date');
  assert.match(String(msg), /blocked|invalid|restricted|not/i, 'refused, but with a message that does not read as a policy refusal: ' + msg);
  // And nothing landed. `ok:false` is the frame; this is the disk.
  const copies = await copiesOf(D.CHECKIN + 'pm1');
  assert.ok(copies.length > 0, 'the church\'s own pm1 is gone — this test is now measuring an empty address, not a refusal');
  assert.deepEqual([...new Set(copies.map(e => e.pubkey))].filter(p => p === ada.pub), [],
    'the helper\'s forgery is on the box at the afternoon record\'s address');
});

test('BASELINE: dina is a working helper on ada\'s session — or everything below is vacuous', async () => {
  // Two helpers on ONE session. The fixture had never had that, which is how helper-versus-helper went
  // unnoticed: ada and bea are on different sessions, so every earlier test here was really about sessions.
  const [ok] = await publishAs(dina, forgeryBy(dina, 'dina-new', MORNING, { out: null }));
  assert.equal(ok, true, 'a second cleared, in-window helper could not check a child in at all — the grant ' +
    'fixture is wrong and every refusal below would pass for the wrong reason');
});

test('ONE HELPER DOES NOT OVERWRITE ANOTHER\'S RECORD — the pickup code stays the one that was written', async () => {
  // Measured 2026-09-16, before this gate: Ada checked a child in with code 1111; Dana published at THE SAME
  // ADDRESS with 9999; the relay took it, the safeguarding lead was served both, and the console renders
  // newest-wins with no author — so 9999 is what the desk releases the child on. checkinChurchHolds closed
  // this address to a helper when the CHURCH held it (red team F-B); nobody had closed it when a COLLEAGUE
  // held it, though the invariant written beside that gate says "a helper may CREATE records and update her
  // own".
  await sleep(1100);   // a clear second, or the store refuses the rewrite as `have-newer` and proves nothing
  const [ok, msg] = await publishAs(dina, forgeryBy(dina, 'ada-new', MORNING, { code: '9999' }));
  assert.equal(ok, false, 'A HELPER REWROTE A COLLEAGUE\'S CHECK-IN RECORD. The pickup code the desk shows ' +
    'is now hers, the original is invisible, and nothing on any screen says the record changed hands: ' + msg);

  // …and nothing landed. `ok:false` is the frame; this is the disk.
  const copies = await copiesOf(D.CHECKIN + 'ada-new');
  assert.ok(copies.length > 0, 'ada\'s own record is gone — this is now measuring an empty address, not a refusal');
  assert.equal(copies.filter(e => e.pubkey === dina.pub).length, 0,
    'the colleague\'s copy is on the box beside ada\'s, so the console still has two to choose between');
});

test('…but SIGNING A CHILD OUT is untouched, because collection writes its own record', async () => {
  // THE CONTROL THE OWNER ASKED FOR, 2026-09-16: *"One worker needs to be able to sign in, and another needs
  // to be able to sign out, thats how teams work."* Exactly right, and it is why this gate is about ONE
  // ADDRESS rather than about one child: releaseCheckin (src/fellowship.src.js) mints its OWN id (`cr…`) and
  // names the check-in it collects in a ['rel'] tag, so a colleague collecting a child never writes where the
  // first helper wrote. If this test ever fails, the gate above has been widened into something that breaks
  // an ordinary Sunday — see reference/DOMAIN.md, "a child is not owned by the volunteer who signed them in".
  const [ok, msg] = await publishAs(dina, forgeryBy(dina, 'cr-dina-1', MORNING, { out: 1 }, [['rel', 'ada-new']]));
  assert.equal(ok, true, 'a helper could not sign out a child a COLLEAGUE signed in. That is how a children\'s ' +
    'team actually works, and this gate must never refuse it: ' + msg);
});

test('…and ada may still update the record SHE wrote', async () => {
  // The other half of the invariant: "a helper may create records and update her own". A gate that refused
  // this would stop a volunteer correcting her own typo.
  await sleep(1100);
  const [ok] = await publishAs(ada, forgery('ada-new', MORNING, { code: '1212' }));
  assert.equal(ok, true, 'a helper could no longer update her OWN record — the gate is refusing the case the ' +
    'capability exists for');
});

test('…and a CO-TENANT church\'s record at the same address cannot lock this church\'s helper out', async () => {
  // Check-in ids are a relay-GLOBAL namespace on a shared box. If the new gate counted another church's
  // record it would hand any co-tenant a way to close addresses in THIS church's register — a denial of
  // service dressed as a safeguard. Scoped the same way checkinSessionConflict is.
  await send(w, doc(other, D.MEMBER + other.pub, { joined: now() }));
  await send(w, record(other, 'shared-id', MORNING, KEY_AM, {}, { cp: other }));
  await sleep(300);
  const [ok, msg] = await publishAs(dina, forgeryBy(dina, 'shared-id', MORNING, { out: null }));
  assert.equal(ok, true, 'a DIFFERENT church\'s record at the same global id stopped this church\'s helper ' +
    'checking a child in: ' + msg);
});

test('…and the church, or a safeguarding steward, may still correct a helper\'s record', async () => {
  await sleep(1100);
  const [okC] = await publishAs(church, record(church, 'dina-new', MORNING, KEY_AM, { code: '7777' }));
  assert.equal(okC, true, 'the church could not correct a helper-written record');
  await sleep(1100);
  const [okS] = await publishAs(sgLead, record(sgLead, 'dina-new', MORNING, KEY_AM, { code: '8888' }));
  assert.equal(okS, true, 'a safeguarding steward could not correct a helper-written record');
});

test('…and she cannot reach it by tagging the session she does NOT hold either', async () => {
  const [ok] = await publishAs(ada, forgery('pm1', AFTERNOON, {}));
  assert.equal(ok, false, 'a helper wrote into a session she holds no clearance for by naming it honestly');
});

test('F-B: a helper cannot REPLACE the church\'s record for a child in her own session — she creates, she never overwrites', async () => {
  // Red team 2026-09-11: a helper in her window republished the church's record — forged pickup code, forged
  // "collected" — and the console and every co-helper's phone rendered her copy newest-wins with no author.
  const [ok, msg] = await publishAs(ada, forgery('am1', MORNING, { code: '0000', out: 'collected by A. Stranger' }));
  assert.equal(ok, false, 'A HELPER REPLACED THE CHURCH\'S RECORD FOR A CHILD IN HER SESSION — her pickup code now renders on the console: ' + msg);
  const copies = await copiesOf(D.CHECKIN + 'am1');
  assert.equal(copies.filter(e => e.pubkey === ada.pub).length, 0, 'the helper\'s copy is on the box beside the church\'s');
  // a safeguarding steward's record is the church's voice too
  const [okSgRec] = await publishAs(sgLead, record(sgLead, 'sg-owned', MORNING, KEY_AM, {}));
  assert.equal(okSgRec, true, 'fixture: a safeguarding steward could not write a record');
  const [okOver] = await publishAs(ada, forgery('sg-owned', MORNING, {}));
  assert.equal(okOver, false, 'a helper replaced a record a safeguarding steward wrote');
  // and the church may still overwrite HERS (a leader correcting a helper's entry)
  const [okC] = await publishAs(church, record(church, 'ada-new', MORNING, KEY_AM, { code: '7777' }));
  assert.equal(okC, true, 'the church could not correct a helper-written record');
});

test('a helper cannot TOMBSTONE a record — not even one in her own session — at either door', async () => {
  // Red team 2026-09-11, F-D: a hand-crafted `deleted` event carrying her session tag passed the session
  // test (nothing disagreed) and was stored, on a tip whose notes said a helper cannot tombstone. The
  // readers ignored it, so nothing vanished; the gate was still looser than the invariant.
  const tomb = (who, id, extra = []) => doc(who, D.CHECKIN + id, '', [['church', church.pub], ['session', MORNING], ['deleted', '1'], ...extra]);
  const [okHer, msg] = await publishAs(ada, tomb(ada, 'am1'));
  assert.equal(okHer, false, 'A HELPER\'S TOMBSTONE OF A RECORD IN HER OWN SESSION WAS ACCEPTED: ' + msg);
  const [okEmpty] = await publishAs(ada, doc(ada, D.CHECKIN + 'am1', '', [['church', church.pub], ['session', MORNING]]));
  assert.equal(okEmpty, false, 'an empty-content record from a helper (a tombstone without the tag) was accepted');
  // (NOT applied on /import — see the RESTORE test at the foot of this file for why, and what it costs.)
  // the controls: the church and a safeguarding steward still remove records, and the helper still writes
  const [okSg] = await publishAs(sgLead, tomb(sgLead, 'sg-gone'));
  assert.equal(okSg, true, 'a safeguarding steward\'s tombstone was refused — removeCheckin from a steward console is dead');
  const [okCh] = await publishAs(church, tomb(church, 'ch-gone'));
  assert.equal(okCh, true, 'the church\'s own tombstone was refused');
  const [okWrite] = await publishAs(ada, forgery('am-still-writes', MORNING, { out: null }));
  assert.equal(okWrite, true, 'the helper can no longer write a record at all — the refusal above is measuring a dead writer');
});

test('an ordinary member is refused the register outright, cleared or not', async () => {
  const [ok] = await publishAs(cara, doc(cara, D.CHECKIN + 'cara1', 'zz', [['church', church.pub], ['session', MORNING]]));
  assert.equal(ok, false, 'an uncleared member wrote into the children\'s register');
});

test('a CO-TENANT church\'s record at the same address cannot refuse this church\'s helper', async () => {
  // The other half of scoping by church: a d-tag suffix is a relay-global namespace, so without the cp
  // filter a co-tenant could publish `checkin:am2` naming a session of their own and lock this church's
  // children's desk out of that address — a denial of service, arriving as "the tablet won't check her in".
  await send(w, record(other, 'am2', 'their-svc', KEY_PM, {}, [['church', other.pub]]));
  await sleep(200);
  const [ok] = await publishAs(ada, forgery('am2', MORNING, { out: null }));
  assert.equal(ok, true, 'a co-tenant church\'s record at the same d-tag refused this church\'s cleared helper');
});

// ── 2. THE POINT OF USE: what the console's register actually renders ────────────────────────────────────
test('the SHIPPED register, fed what the relay serves, still shows the church\'s pickup code', async () => {
  const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
  let openTries = 0, ckTries = 0;
  const subs = [];
  const stubs = {
    pub: church.pub, churchPub: church.pub, churchSk: church.sk, actingChurch: null, NET,
    _careRoster: new Set([sgLead.pub]),
    _capWaiters: { checkin: new Set() },
    _capState: { checkin: { ring: [RING], docKeys: null, rev: 1, checked: true, at: 0 } },
    _ckSessionKeys: new Map([[MORNING, KEY_AM], [AFTERNOON, KEY_PM]]),
    _unhex: unhex,
    encrypt3: (pl, k) => nip44.encrypt(pl, k),
    decrypt3: (ct, k) => { openTries++; return nip44.decrypt(ct, k); },
    getConversationKey: (sk, p) => nip44.utils.getConversationKey(sk, p),
    checkinSessionOf,
    readCheckinHelperCopy: (tags, keyHex, unseal) => { ckTries++; return readCheckinHelperCopy(tags, keyHex, unseal); },
    relays: () => ['wss://relay.test/relay'],
    pool: { subscribeMany: (_r, filters, handlers) => { subs.push({ filters, handlers }); return { close() {} }; } },
    _forgetById: () => {}, _tombstoneTargets: () => [], _consoleDisplay: () => true,
    _consoleChurchVoice: () => true, _seedFromCache: () => {}, _absorbById: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  const scope = new Proxy(stubs, {
    has: () => true,
    get: (o, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in o) return o[k];
      const base = String(k).replace(/\d+$/, '');
      if (base in o) return o[base];
      if (k in globalThis) return globalThis[k];
      throw new ReferenceError('the lifted reader needs `' + String(k) + '` — add a stub');
    },
    set: (o, k, v) => { o[k] = v; return true; },
  });
  const liftMethod = (sig, name) => {
    const body = fnBody(VENDOR, sig, name);
    assert.ok(body.length > 200, name + ': the slice is a stub (' + body.length + ' chars) — the reader under test is not the shipped one');
    return new Function('scope', `with (scope) { return ({ ${body} }).${name}; }`)(scope);
  };
  const liftVar = (sig, name) => new Function('scope', `with (scope) { ${stmt(VENDOR, sig, name)} return ${name}; }`)(scope);
  stubs.churchSkHeld = liftVar('var churchSkHeld = () =>', 'churchSkHeld');
  stubs._encOpenSealedCopy = liftVar('var _encOpenSealedCopy = (kind, tags) =>', '_encOpenSealedCopy');
  const encOpen = liftMethod('encOpen(kind, str) {', 'encOpen');
  stubs.window = { Steward: { encOpen }, dispatchEvent: () => true };
  const encSubscribe = liftMethod('encSubscribe(prefix, cb, kind) {', 'encSubscribe');

  let rows = [];
  encSubscribe(D.CHECKIN, (r) => { rows = r; }, 'checkin');
  assert.equal(subs.length, 1, 'the lifted encSubscribe opened no subscription — nothing below is being read');

  // EXACTLY WHAT THE RELAY SERVES THE CHURCH, not a hand-built corpus. This is the join between the two
  // halves of the file: the gate decided what is on the box, and this is the screen reading it.
  const served = await asks(church, { kinds: [30078], '#d': [D.CHECKIN + 'am1', D.CHECKIN + 'pm1'] });
  assert.ok(served.length >= 2, 'the relay served fewer than the two records seeded — the register below would be empty for the wrong reason');
  for (const e of served.sort((a, b) => (a.created_at || 0) - (b.created_at || 0))) subs[0].handlers.onevent(e);
  assert.ok(openTries > 0, 'the harness never reached a decrypt — every assertion below is vacuous');
  assert.ok(ckTries >= 0, 'the ck parser was never wired');

  const byId = new Map(rows.map(r => [r.id, r]));
  const pm1 = byId.get('pm1');
  assert.ok(pm1, 'the afternoon record does not render at all — this is measuring an empty register, not a defended one');
  // The church over-wrote pm1's code in the BASELINE test above (church '5555', then the steward '6666'),
  // and both are legitimate. What must NOT be there is the forger's.
  assert.notEqual(pm1.code, '0000', 'RED TEAM F1 AT THE POINT OF USE: the console renders the helper\'s pickup code over the church\'s on a record from a session she was never cleared for');
  assert.equal(pm1.out, null, 'the console renders "collected by A. Stranger" on a record the helper could not read');
  const am1 = byId.get('am1');
  assert.ok(am1, 'the morning record does not render — the helper\'s legitimate update was lost');
});

// ── 3. THE INGEST DOOR: /import writes straight to the store with no accept() pass ──────────────────────
test('/import refuses the same forgery, and imports the helper\'s honest record in the same request', async () => {
  // The negative is only worth something if the machinery around it works, so ONE request carries both: a
  // legitimate helper-authored record at a NEW address (must land) and the forgery at the afternoon
  // record's address (must not). An /import that stored nothing would pass a refusal test on its own.
  const honest = forgery('imp-ok', MORNING, { out: null });
  const bad = forgery('pm1', MORNING, { code: '0000' });
  const [status, body] = await importAs(church, [honest, bad]);
  assert.equal(status, 200, '/import refused the church key — the import door is not being exercised');
  assert.equal(body.imported, 1, 'expected exactly the honest record to land, got imported=' + body.imported + ' invalid=' + body.invalid);
  assert.equal(body.invalid, 1, 'the forgery was not counted as refused: invalid=' + body.invalid);
  await sleep(400);
  const okCopies = await copiesOf(D.CHECKIN + 'imp-ok');
  assert.equal(okCopies.length, 1, 'the honest helper-authored record did not survive /import — the refusal above is about a broken importer, not about the rule');
  const badCopies = await copiesOf(D.CHECKIN + 'pm1');
  assert.equal(badCopies.filter(e => e.pubkey === ada.pub).length, 0,
    'RED TEAM F1 THROUGH THE OTHER DOOR: /import installed a helper\'s record at another session\'s address');
});

test('A RESTORE KEEPS BOTH HELPERS\' RECORDS AT ONE ADDRESS — the new gate is the door only', async () => {
  // ⚠ THE TEST THIS FIX MOST NEEDS, and the one whose absence has cost this project twice.
  //
  // The websocket gate above refuses a second helper at one address. An archive from ANY box running today
  // legitimately contains exactly that — those records were written before the gate existed — and /import
  // deliberately never calls accept(). If anybody ever "tidies" the new rule onto the ingest path, a restore
  // would silently drop one of the pair, and a DIFFERENT one each time, because /import's order is arbitrary.
  // That is precisely the shape of the 2026-08-20 incident (a write gate replayed over an import deleted a
  // church's whole finance journal) and of the steward tombstone refused on every restore.
  //
  // So: two helper-authored records at ONE address, through /import, in one request. BOTH must land.
  const first  = forgeryBy(ada,  'restore-pair', MORNING, { code: '1111' });
  const second = forgeryBy(dina, 'restore-pair', MORNING, { code: '9999' });
  const [status, body] = await importAs(church, [first, second]);
  assert.equal(status, 200, '/import refused the church key — the import door is not being exercised');
  assert.equal(body.invalid, 0,
    'a restore REFUSED a legitimate archived record. The new helper gate has reached the ingest path, and ' +
    'every church restoring a backup will silently lose check-in records: invalid=' + body.invalid);
  await sleep(400);
  const copies = await copiesOf(D.CHECKIN + 'restore-pair');
  const authors = new Set(copies.map(e => e.pubkey));
  assert.ok(authors.has(ada.pub) && authors.has(dina.pub),
    'a restore kept only one of two archived helper records at this address, so a child\'s register is now ' +
    'missing an entry that was on the box before the backup. Authors kept: ' + [...authors].length);
});

test('…and a RESTART does not reinstate it', async () => {
  // The uppercase-`checkinperm:` finding of 2026-09-10 survived a restart, so a rehydrate is part of the
  // proof rather than a courtesy. The control is the honest record, which MUST still be there.
  try { w.close(); } catch {}
  await stopRelay();
  await boot();
  await sleep(600);
  w = await conn();
  const badCopies = await copiesOf(D.CHECKIN + 'pm1');
  assert.equal(badCopies.filter(e => e.pubkey === ada.pub).length, 0, 'the forgery came back after a restart');
  const okCopies = await copiesOf(D.CHECKIN + 'imp-ok');
  assert.equal(okCopies.length, 1, 'the honest record did NOT survive the restart — the assertion above is measuring an empty box');
});

test('A RESTORE keeps a safeguarding steward\'s tombstone — the ingest door consults no roster', async () => {
  // Audit of b0ba242, 2026-09-11: the first version of the helper-tombstone refusal ran on /import through
  // stewardCan(), and /import puts every line BEFORE hydrateMaps() reads the roster in the same archive — so
  // a steward's tombstone was judged a helper's, refused, and the child she had removed came back as present
  // on every restore. Measured: imported=6 invalid=1, the record on disk with tomb:false. Here: an EMPTY relay
  // receives an archive carrying the roster, the steward's record and her tombstone of it, in one request.
  try { w.close(); } catch {}
  await stopRelay();
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  dataDir = mkdtempSync(join(tmpdir(), 'trin-ck-restore-'));
  await boot();
  await sleep(500);
  w = await conn();
  const roster = doc(church, D.STEWARDS + church.pub, { pubkeys: [sgLead.pub], caps: { [sgLead.pub]: ['safeguarding'] } });
  const member = doc(sgLead, D.MEMBER + church.pub, { joined: now() });
  const rec = record(sgLead, 'mistake', MORNING, KEY_AM, { code: '1111' });
  // LATER than the record by a clear margin: a tombstone in the same second as the record it replaces loses
  // the store's same-second tie (lowest id wins), which would fail this test for a reason that is not the rule.
  const gone = finalizeEvent({ kind: 30078, created_at: now() + 30, tags: [['d', D.CHECKIN + 'mistake'], ['t', NET], ['church', church.pub], ['deleted', '1']], content: '' }, sgLead.sk);
  const [status, body] = await importAs(church, [member, roster, rec, gone]);
  assert.equal(status, 200, '/import refused the church key — the restore door is not being exercised');
  assert.equal(body.invalid, 0, 'THE RESTORE REFUSED SOMETHING: imported=' + body.imported + ' invalid=' + body.invalid +
    ' — a steward\'s tombstone judged before the roster it sits beside has been read');
  await sleep(400);
  const copies = await copiesOf(D.CHECKIN + 'mistake');
  assert.ok(copies.some(e => e.pubkey === sgLead.pub && !e.content), 'the steward\'s tombstone did not survive the restore — the child she removed is back');
});
