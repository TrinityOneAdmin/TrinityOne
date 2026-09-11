// A PARENT WRITES AN ARRIVAL, AND NEVER A REGISTER ROW.
// Run: node --test scripts/a-parent-writes-an-arrival-never-a-register-row.test.mjs
//
// STEP 1 of the parent surface in reference/DESIGN-CHECKIN-IN-THE-MEMBER-APP-2026-09-09.md. Design §3 says a
// parent announces their own arrival at the children's room; §7 says the child almost always has NO ACCOUNT.
// Those two together are the whole reason this document exists rather than a parent-authored `checkin:` row.
//
// ── THE THING THIS FILE IS REALLY GUARDING ───────────────────────────────────────────────────────────────
// Nothing at this relay links a parent to a child. `guardianOfIn` is keyed on the CHILD's pubkey and a child
// with no key is in no map; `guardians:` is owner-only and is not served to ordinary members. So a
// parent-authored register row would have had no authority to be checked against, and would have reduced to
// "ANY MEMBER MAY INVENT A CHILD AND A PICKUP CODE" — the hole F-B (90c4bf5) closed three weeks ago, reopened
// by the front door. The FIRST test in this file is therefore not about arrivals at all: it is the strong
// form of "a parent never writes a record", asserted against the unchanged CHECKIN_D branch.
//
// Forging an arrival buys a spurious line on a worker's screen — the same data-quality nuisance the printed
// room code already knowingly accepts. Forging a register row buys a child. That asymmetry is the design.
//
// ── WHY THE GATE IS IN TWO HALVES, AND WHY BOTH HALVES ARE MEASURED SEPARATELY ───────────────────────────
//   • arrivalIdOk              — STATELESS. The d-tag's author suffix must equal e.pubkey. Consults no map,
//                                so it holds at the websocket door AND at all three ingest sites, exactly as
//                                carereqIdOk does and for the reason carereqIdOk's own comment records.
//   • checkinArrivalWindowOpen — consults the hydrated CHECKIN_HELPERS map, so it is the WEBSOCKET DOOR ONLY.
//                                An author-authority check on the import loop, which runs before
//                                hydrateMaps(), refused a safeguarding steward's own archive on restore this
//                                week (9f17160) and destroyed a finance journal by the same shape in August.
// The RESTORE test at the foot of this file is what proves that split was not decoration: an EMPTY relay
// receives the roster, the envelope and the arrival in ONE request, and keeps the arrival.
//
// EVERY REFUSAL HAS A PASSING BASELINE BESIDE IT, from the same actor over the same socket, because a parent
// who cannot write anything at all produces results identical to every negative here.
//
// THE WINDOW IS TESTED WITH THE CLOCK, NOT WITH created_at. created_at is the writer's to choose, so a window
// compared against it is no window at all: every event below is stamped honestly at `now()`, and the closed
// session is closed because the CHURCH's envelope says so and the relay reads its own clock.
//
// NO PORT SHARED WITH ANY OTHER FILE: this spawns its own gateway on 8913 with its own TRINITY_DATA_DIR.
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
import { fnBody } from './test-slice.mjs';
import { buildHelperGrant, buildCheckinPermission, GRANT_SOURCE } from './checkin-role-source.mjs';
import { D } from './trinity-doc-types.mjs';

const PORT = 8913;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs; checked free by requireFreePort
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const HOST = `127.0.0.1:${PORT}`;
const NET = 'trinityone';
const ROOT = new URL('../', import.meta.url).pathname;
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const unhex = h => Uint8Array.from(String(h).match(/.{1,2}/g).map(b => parseInt(b, 16)));

// THE CAST, named for what each one proves.
const church = K();       // St Chad's
const other = K();        // a CO-TENANT on the same box
const sgLead = K();       // a steward ticked for Safeguarding
const ada = K();          // a cleared, in-window helper for the MORNING session — the worker
const bea = K();          // a cleared helper for the session that CLOSES partway through this file
const gina = K();         // a PARENT. An ordinary member, and a guardian in the church's map.
const hank = K();         // another ordinary member — the address gina must never be able to write at
const kid = K();          // gina's child, who in this test DOES have a key (the exceptional case, §7)
const stranger = K();     // never joined this church at all

const MORNING = 'svc-morning', PM = 'svc-afternoon', GHOST = 'svc-never-minted';
const KEY_AM = '11'.repeat(32), KEY_PM = '22'.repeat(32), RING = '44'.repeat(32);

let relay, dataDir;
let w;                    // a plain unauthenticated socket, for the church's own seeding writes

const conn = () => new Promise((r, j) => { const s = new WebSocket(WS_URL); s.on('open', () => r(s)); s.on('error', j); });
const send = (s, e) => new Promise(res => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { s.off('message', on); res([m[2], m[3] || '']); } };
  s.on('message', on); s.send(JSON.stringify(['EVENT', e]));
});
// A socket that AUTHENTICATES as `who` before its write. Every check-in gate is authed-only, so an
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
// AN ENVELOPE WITH AN EXPLICIT WINDOW. `at` moves the created_at so a replacement envelope wins the store's
// newest-wins comparison outright rather than losing a same-second tie to the lower event id.
const grant = (session, helpers, key, from, until, at = now()) => {
  const { doc: body, failed } = buildHelperGrant({
    session, source: GRANT_SOURCE, lifetime: 'session', from, until,
    helpers, keepers: [church.pub, sgLead.pub], sessionKeyHex: key,
    wrap: (p, pl) => nip44.encrypt(pl, nip44.utils.getConversationKey(church.sk, p)),
  });
  assert.equal(failed.length, 0, 'the envelope could not be wrapped for ' + failed);
  return finalizeEvent({
    kind: 30078, created_at: at,
    tags: [['d', D.CHECKINHELPER + session], ['t', NET], ['church', church.pub], ['session', session]],
    content: JSON.stringify(body),
  }, church.sk);
};
// ── AN ARRIVAL, IN THE SHAPE THE SHIPPED WRITER EMITS ────────────────────────────────────────────────────
// d = checkinarrival:<sid>:<authorpubhex>; cleartext ['session'] and ['church']; content SELF-SEALED, so it
// is non-empty (an empty content is the tombstone convention) and opaque to every reader including the
// worker. NO CHILD'S NAME AND NO KEY MATERIAL: the document's only job is to deliver the author's pubkey
// provably, which the signature already does.
const arrivalAddr = (sid, pub) => D.CHECKINARRIVAL + sid + ':' + pub;
const selfSeal = (who, obj) => nip44.encrypt(JSON.stringify(obj), nip44.utils.getConversationKey(who.sk, who.pub));
const arrival = (who, sid, opts = {}) => finalizeEvent({
  kind: 30078, created_at: opts.at || now(),
  tags: [['d', arrivalAddr(opts.addrSid || sid, opts.addrPub || who.pub)], ['t', NET],
         ['church', (opts.cp || church).pub], ['session', opts.tagSid || sid]],
  content: selfSeal(who, { at: now() }),
}, who.sk);
const arrivalTomb = (who, sid) => finalizeEvent({
  kind: 30078, created_at: now(),
  tags: [['d', arrivalAddr(sid, who.pub)], ['t', NET], ['church', church.pub], ['session', sid], ['deleted', '1']],
  content: '',
}, who.sk);
// A REGISTER ROW, in the shape the console's publishCheckin emits — both locks and the cleartext tags.
const record = (author, id, session, sessionKey, body = {}, extra = []) => {
  const obj = { id, session, childName: 'Child ' + id, code: '4821', date: '2026-09-06', out: null, ...body };
  return doc(author, D.CHECKIN + id, nip44.encrypt(JSON.stringify(obj), unhex(RING)), [
    ['church', church.pub], ['enc', '2'], ['session', session],
    ['ck', nip44.encrypt(JSON.stringify(obj), unhex(sessionKey))],
    ...extra,
  ]);
};
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
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub) + ',' + npubEncode(other.pub) },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(150); }
  throw new Error('the gateway never came up on ' + PORT);
}
const stopRelay = async () => { try { relay.kill('SIGKILL'); } catch {} await sleep(400); };

before(async () => {
  await requireFreePort(PORT, 'a-parent-writes-an-arrival-never-a-register-row.test.mjs (it spawns its own gateway)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-arrival-'));
  await boot();
  w = await conn();
  for (const who of [sgLead, ada, bea, gina, hank, kid]) await send(w, doc(who, D.MEMBER + church.pub, { joined: now() }));
  await send(w, doc(church, D.STEWARDS + church.pub, { pubkeys: [sgLead.pub], caps: { [sgLead.pub]: ['safeguarding'] } }));
  // GINA IS A GUARDIAN IN THE CHURCH'S OWN MAP, and her child has a key. That is the EXCEPTIONAL case (§7 —
  // most children have no account), and it is here on purpose: it is the strongest possible footing for the
  // first test. If even a church-recognised guardian of a church-recognised child is refused the register,
  // then a parent of the ordinary child — who is in no map at all — never had a route.
  await send(w, doc(church, D.GUARDIANS + church.pub, { links: { [kid.pub]: [gina.pub] } }));
  await send(w, doc(church, D.MINORS + church.pub, { pubkeys: [kid.pub] }));
  await send(w, doc(other, D.STEWARDS + other.pub, { pubkeys: [] }));
  await sleep(250);
  await send(w, permission(church, ada.pub));
  await send(w, permission(church, bea.pub));
  const t = now();
  await send(w, grant(MORNING, [ada.pub], KEY_AM, t - 600, t + 3600));
  await send(w, grant(PM, [bea.pub], KEY_PM, t - 600, t + 3600));
  await send(w, record(church, 'am1', MORNING, KEY_AM, {}, [['p', gina.pub]]));
  await sleep(400);
});
after(async () => {
  try { w.close(); } catch {}
  await stopRelay();
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

// ══════════════ 1. A PARENT NEVER WRITES A REGISTER ROW ══════════════

test('THE STRONG FORM: a GUARDIAN, correctly tagged, is still refused the children\'s register', async () => {
  // This is the property the whole design turns on, so it is asserted before anything about arrivals exists.
  // gina is an effective member, a guardian in the church's own `guardians:` map, and her child is in
  // `minors:`. Her event carries every cleartext tag a real record carries and names the session correctly.
  // She is refused because she is not the church, not a safeguarding steward, and not a helper — and that
  // branch is UNCHANGED by this work.
  const [ok, msg] = await publishAs(gina, record(gina, 'gina-forged', MORNING, KEY_AM, { code: '0000' }, [['p', gina.pub]]));
  assert.equal(ok, false,
    'A PARENT AUTHORED A CHILDREN\'S REGISTER ROW. Nothing at this relay links a parent to a child (guardianOfIn ' +
    'is keyed on the CHILD\'s pubkey, and the ordinary child has no key at all), so this reduces to "any member ' +
    'may invent a child and a pickup code" — the hole F-B closed. msg: ' + msg);
  assert.match(String(msg), /blocked|invalid|restricted|not/i, 'refused, but with a message that does not read as a policy refusal: ' + msg);
  assert.equal((await copiesOf(D.CHECKIN + 'gina-forged')).length, 0, 'the frame said no and the event is on disk anyway');
});

test('THE STRONG FORM, SECOND HALF: nothing in the member app writes a check-in record except writeCheckin / releaseCheckin', () => {
  // CLAUDE.md rule 3: this file ships UNBUNDLED, so no assertion here may be about the presence of text. It is
  // about the ABSENCE of a construct, which `false &&` cannot hide — a d-tag the app never composes is a
  // record the app never writes. Anchored on the two functions by name and brace-matched, so a third writer
  // added tomorrow lands outside both slices and reddens this.
  const src = readFileSync(ROOT + 'src/fellowship.src.js', 'utf8');
  const writer = fnBody(src, '  async writeCheckin(churchNpub, rec) {', 'writeCheckin');
  const releaser = fnBody(src, '  async releaseCheckin(churchNpub, rec) {', 'releaseCheckin');
  // Every place the member app composes a `trinityone/checkin:` ADDRESS. The reader's `d.startsWith(CHECKIN_D)`
  // and `d.slice(CHECKIN_D.length)` are reads, not writes, so the construct hunted for is CONCATENATION.
  const composes = [];
  const re = /CHECKIN_D \+/g;
  let m;
  while ((m = re.exec(src))) composes.push(m.index);
  assert.ok(composes.length > 0, 're-anchor: nothing in this file composes a check-in address at all, so this test now proves nothing');
  const outside = composes.filter(i => !writer.includes(src.slice(i, i + 40)) && !releaser.includes(src.slice(i, i + 40)));
  assert.deepEqual(outside.map(i => src.slice(Math.max(0, i - 60), i + 40).split('\n').pop()), [],
    'SOMETHING OTHER THAN writeCheckin/releaseCheckin COMPOSES A CHECK-IN RECORD ADDRESS in the member app. ' +
    'Both of those are gated on holding a session key the church issued to a CLEARED worker; a third writer is ' +
    'a route into the children\'s register that this file has never looked at.');
});

// ══════════════ 2. AN ARRIVAL'S ADDRESS NAMES ITS AUTHOR ══════════════

test('BASELINE: a member writes her OWN arrival in a live session, and it lands', async () => {
  // Without this every refusal below is satisfied by a parent who can write nothing at all — the shape a
  // broken before() produces, and the reason a-sabotage-matrix-needs-a-baseline-row exists.
  const [ok, msg] = await publishAs(gina, arrival(gina, MORNING));
  assert.equal(ok, true, 'a member of this church could not announce her own arrival at a live session: ' + msg);
  const on = await copiesOf(arrivalAddr(MORNING, gina.pub));
  assert.equal(on.length, 1, 'the frame said yes and nothing is on disk');
  assert.ok(on[0].content && on[0].content.length > 20,
    'the arrival\'s content is empty — which is the TOMBSTONE convention, so this record reads as a withdrawal ' +
    'of itself. The shipped writer self-seals a body for exactly this reason (see writeCheckin\'s sentinel).');
});

test('A MEMBER CANNOT WRITE AN ARRIVAL AT ANOTHER MEMBER\'S ADDRESS — the websocket door', async () => {
  // The one authority an arrival carries is "this pubkey says it is here". An address the signer does not own
  // detaches the document from its only claim: gina could put hank's family at the creche door, and — once the
  // worker's screen exists — hand a child to whoever answered to hank's name.
  const [ok, msg] = await publishAs(gina, arrival(gina, MORNING, { addrPub: hank.pub }));
  assert.equal(ok, false, 'a member wrote an arrival at ANOTHER member\'s address — the arrival no longer names who signed it');
  assert.equal((await copiesOf(arrivalAddr(MORNING, hank.pub))).length, 0, 'refused at the frame and stored anyway');
});

test('AN ADDRESS THAT NAMES NOBODY IS REFUSED OUTRIGHT, not waved through', async () => {
  // carereqIdOk's "ONE RULE, NOT TWO": a fallback for addresses with no owner suffix is the very bypass the
  // check exists to close, preserved inside the thing that replaced it.
  const bare = finalizeEvent({
    kind: 30078, created_at: now(),
    tags: [['d', D.CHECKINARRIVAL + MORNING], ['t', NET], ['church', church.pub], ['session', MORNING]],
    content: selfSeal(gina, { at: now() }),
  }, gina.sk);
  const [ok] = await publishAs(gina, bare);
  assert.equal(ok, false, 'an arrival at an address with no author suffix was accepted — it names nobody, so it claims nothing and nobody owns it');
  // …AND THE INGEST DOOR REFUSES IT FOR THE SAME REASON, WHICH IS THE ONLY PLACE THAT CAN BE MEASURED.
  // FOUND BY THE SABOTAGE MATRIX, 2026-09-11: with `if (!m) return false` flipped to `return true` inside
  // arrivalIdOk, the websocket assertion above STILL PASSED — accept()'s branch also refuses a d-tag it
  // cannot read a session out of, so the door has two rules over this case and the test was pinning the
  // wrong one. The import loop runs ONLY the stateless half, so it is where "an address that names nobody
  // is refused outright" is actually a claim about arrivalIdOk. Sibling of carereqIdOk's ONE RULE, NOT TWO.
  const [status, body] = await importAs(church, [bare, arrival(gina, MORNING)]);
  assert.equal(status, 200, '/import refused the church key — the ingest door is not being exercised');
  assert.equal(body.invalid, 1,
    'THE IMPORT DOOR ACCEPTED AN ARRIVAL AT AN ADDRESS THAT NAMES NOBODY. imported=' + body.imported +
    ' invalid=' + body.invalid + ' — the fallback carereqIdOk had to delete, preserved one document over.');
  await sleep(300);
  assert.equal((await copiesOf(D.CHECKINARRIVAL + MORNING)).length, 0, 'the unowned address is on disk');
});

test('THE CLEARTEXT SESSION TAG MUST AGREE WITH THE ADDRESS', async () => {
  // The F1 shape, one document over. Readers route by the ['session'] tag; the store keys on the d-tag. Left
  // to disagree, an arrival living at the afternoon's address renders on the morning worker's screen.
  const [ok] = await publishAs(gina, arrival(gina, MORNING, { addrSid: PM, tagSid: MORNING }));
  assert.equal(ok, false, 'an arrival stored at ONE session\'s address was accepted carrying ANOTHER session\'s cleartext tag');
});

// ══════════════ 3. WHO, AND WHEN ══════════════

test('A NON-MEMBER CANNOT WRITE AN ARRIVAL AT ALL', async () => {
  const [ok] = await publishAs(stranger, arrival(stranger, MORNING));
  assert.equal(ok, false, 'somebody who has never joined this church announced an arrival at its children\'s session');
});

test('A CO-TENANT\'S MEMBER CANNOT WRITE INTO THIS CHURCH\'S SESSION', async () => {
  // `isMember` inside accept() is the relay-WIDE union — any key that ever published a member: doc to any
  // church on the box. On a shared relay that would be a co-tenant writing into this congregation's creche,
  // so the branch asks churchWriter() against the NAMED church instead.
  const coTenant = K();
  await send(w, doc(coTenant, D.MEMBER + other.pub, { joined: now() }));
  await sleep(250);
  const [ok] = await publishAs(coTenant, arrival(coTenant, MORNING));
  assert.equal(ok, false, 'a member of the OTHER church on this box wrote an arrival into St Chad\'s children\'s session');
});

test('A SESSION WITH NO ENVELOPE TAKES NO ARRIVALS', async () => {
  const [ok] = await publishAs(gina, arrival(gina, GHOST));
  assert.equal(ok, false, 'an arrival was accepted for a session this church has never minted an envelope for — an unbounded new address per invented session id');
});

test('A CLOSED SESSION TAKES NO ARRIVALS — measured with the CLOCK, never with created_at', async () => {
  // gina's PM arrival lands while the session is OPEN. The church then republishes the envelope with a window
  // that ended an hour ago — the ordinary way a session ends — and the SAME honest event, stamped now(), is
  // refused. Nothing about the event changed; only the relay's own clock against the church's own window.
  const [okOpen] = await publishAs(gina, arrival(gina, PM));
  assert.equal(okOpen, true, 'the baseline failed: gina could not write a PM arrival while the PM session was open, so the refusal below proves nothing');
  const t = now();
  await send(w, grant(PM, [bea.pub], KEY_PM, t - 7200, t - 3600, t + 5));
  await sleep(400);
  const [okClosed, msg] = await publishAs(gina, arrival(gina, PM));
  assert.equal(okClosed, false, 'a session whose window closed an hour ago still accepted an arrival: ' + msg);
  // AND THE HELPER'S OWN WINDOW WENT WITH IT — the envelope is one document, so this also proves the
  // republish took effect rather than being dropped by the store's newest-wins tie.
  const [okBea] = await publishAs(bea, record(bea, 'bea-late', PM, KEY_PM));
  assert.equal(okBea, false, 'the replacement envelope never took effect — the closed-session refusal above is measuring the OLD window');
});

test('A PARENT MAY WITHDRAW HER OWN ARRIVAL, and only inside the window', async () => {
  // "We are not coming after all" is the same act by the same person at the same address, so it passes by the
  // same rule — and it is deliberately NOT exempted from the window, or a tombstone would be a way to reach a
  // session that has closed.
  const [okTomb] = await publishAs(gina, arrivalTomb(gina, MORNING));
  assert.equal(okTomb, true, 'a parent could not withdraw her own arrival in a live session');
  const [okLate] = await publishAs(gina, arrivalTomb(gina, PM));
  assert.equal(okLate, false, 'a tombstone reached a CLOSED session — the window has an exemption it must not have');
  // Put the morning arrival back, for the read tests below.
  await sleep(1100);
  const [okAgain] = await publishAs(gina, arrival(gina, MORNING));
  assert.equal(okAgain, true, 'a parent who changed her mind twice could not re-announce — the register is not re-writable and the tests below have no subject');
  await sleep(300);
});

// ══════════════ 4. WHO IS SERVED AN ARRIVAL ══════════════

test('canRead: an ordinary member is served NOBODY ELSE\'S arrival', async () => {
  // An arrival is a presence record for a named household — who was at church, and when. The congregation has
  // no use for it, and the default-deny shape of this branch is what the helper grant lacked until 2026-09-09,
  // when a rule that narrowed a document and then fell through served it to every member anyway.
  const got = await asks(hank, { kinds: [30078], '#d': [arrivalAddr(MORNING, gina.pub)] });
  assert.equal(got.length, 0, 'AN ORDINARY MEMBER WAS SERVED ANOTHER FAMILY\'S ARRIVAL. Served: ' + JSON.stringify(got.map(e => e.pubkey)));
  // BASELINE: the same socket, the same filter shape, a document he IS entitled to. Without this the
  // assertion above is satisfied by a relay that serves hank nothing at all.
  const mine = await asks(hank, { kinds: [30078], '#d': [D.MEMBER + church.pub] });
  assert.ok(mine.length > 0, 'this member is served nothing whatsoever — the refusal above is vacuous');
});

test('canRead: the author is served her own arrival, and an IN-WINDOW helper of that session is served it', async () => {
  const hers = await asks(gina, { kinds: [30078], '#d': [arrivalAddr(MORNING, gina.pub)] });
  assert.equal(hers.length, 1, 'a parent cannot read back her own arrival — she has no way to tell whether it worked');
  const worker = await asks(ada, { kinds: [30078], '#d': [arrivalAddr(MORNING, gina.pub)] });
  assert.equal(worker.length, 1, 'THE WORKER IS NOT SERVED THE ARRIVAL. The whole feature is a queue on her screen; without delivery there is no queue.');
});

test('canRead: a helper whose session has CLOSED is served no arrival from it', async () => {
  // bea's PM envelope was replaced with a past window above, so she is out of window everywhere. Her own
  // session's arrival — which she could read an hour ago — is now refused. That is the rota tie: access ends
  // when the turn does, enforced rather than assumed.
  const got = await asks(bea, { kinds: [30078], '#d': [arrivalAddr(PM, gina.pub)] });
  assert.equal(got.length, 0, 'a helper out of her window was served an arrival from it: ' + JSON.stringify(got.map(e => e.pubkey)));
  // BASELINE: it is genuinely on disk, and the church can still read it.
  assert.equal((await copiesOf(arrivalAddr(PM, gina.pub))).length, 1, 'the PM arrival is not on the box — the refusal above is measuring an empty address');
});

test('canRead: a MORNING helper is served no arrival from the afternoon', async () => {
  const got = await asks(ada, { kinds: [30078], '#d': [arrivalAddr(PM, gina.pub)] });
  assert.equal(got.length, 0, 'a helper cleared for one session was served another session\'s arrivals');
});

// ══════════════ 5. AN ARRIVAL IS INERT UNTIL A WORKER ACTS ══════════════

test('A forged arrival never becomes a register row on its own — an affirmative act by the worker is required', async () => {
  // hank is an ordinary member with no child in this church and no business at the creche door. He announces
  // an arrival, which the relay admits — that is the design: a spurious line on a worker's screen is the same
  // data-quality nuisance the printed room code already accepts. What it must never be is a child.
  const [ok] = await publishAs(hank, arrival(hank, MORNING));
  assert.equal(ok, true, 'the baseline failed: hank could not write an arrival, so the assertions below prove nothing');
  await sleep(250);
  // NOTHING APPEARED IN THE REGISTER. The arrival lives in its own namespace and no reader converts one.
  const his = await asks(church, { kinds: [30078], authors: [hank.pub] });
  const register = his.filter(e => ((e.tags.find(t => t[0] === 'd') || [])[1] || '').startsWith(D.CHECKIN));
  assert.deepEqual(register.map(e => (e.tags.find(t => t[0] === 'd') || [])[1]), [],
    'AN ARRIVAL TURNED ITSELF INTO A REGISTER ROW authored by the person who announced it.');
  assert.ok(his.some(e => ((e.tags.find(t => t[0] === 'd') || [])[1] || '').startsWith(D.CHECKINARRIVAL)),
    'the baseline failed: hank holds no arrival on this box either, so the assertion above is vacuous');
  // …AND HANK CANNOT WRITE ONE HIMSELF. Announcing an arrival buys no authority over the register at all.
  const [okRow] = await publishAs(hank, record(hank, 'hank-row', MORNING, KEY_AM, {}, [['p', hank.pub]]));
  assert.equal(okRow, false, 'having announced an arrival, an ordinary member could then write his own register row');
  // THE AFFIRMATIVE ACT. ada — a cleared, in-window worker — writes the row, p-tagging exactly the pubkey the
  // signed arrival delivered. This is the only route from an arrival to a child in the register.
  const [okAda] = await publishAs(ada, record(ada, 'ada-from-arrival', MORNING, KEY_AM, {}, [['p', hank.pub]]));
  assert.equal(okAda, true, 'the CLEARED WORKER could not write the row the arrival is for — the feature has no completion');
  await sleep(250);
  const made = await copiesOf(D.CHECKIN + 'ada-from-arrival');
  assert.equal(made.length, 1, 'the worker\'s row is not on disk');
  assert.equal(made[0].pubkey, ada.pub, 'the row on disk was not authored by the worker');
});

test('THE REGISTER\'S OWN GATE IS UNTOUCHED BY ANY OF THIS — an arrival address is never judged by it, and vice versa', async () => {
  // The two prefixes are disjoint (`checkin:` vs `checkina…`), and this asserts it from both sides rather than
  // from reading them. FIRST: a register row whose id carries no `:<64hex>` suffix — the shape arrivalIdOk
  // refuses — is still accepted from the church. If arrivalIdOk had leaked onto the register, the church's own
  // ordinary records would start being refused for having ids that name nobody.
  const [okPlain] = await publishAs(church, record(church, 'plain-id', MORNING, KEY_AM));
  assert.equal(okPlain, true, 'the register refused the church a record with an ordinary id — the arrival\'s address rule has leaked onto CHECKIN_D');
  // SECOND: an arrival is not served by the register's read rule either. gina is p-tagged on am1 and reads it
  // as a guardian; that must not extend to hank's arrival, which names her nowhere.
  const got = await asks(gina, { kinds: [30078], '#d': [arrivalAddr(MORNING, hank.pub)] });
  assert.equal(got.length, 0, 'a guardian of a checked-in child was served another household\'s arrival');
});

// ══════════════ 6. THE RESTORE ══════════════
// LAST IN THE FILE, because it destroys the relay and rebuilds it empty.

test('A RESTORE keeps its arrivals — the ingest door consults no map', async () => {
  // THE REGRESSION THIS EXISTS FOR (b0ba242 / 9f17160, both this week): an author-authority check was added to
  // the import loop, and that loop puts every line BEFORE hydrateMaps() reads the archive it is importing — so
  // the roster inside the request had not been read when the events were judged, a safeguarding steward's own
  // tombstone was refused, and the child she had removed came back as present on every restore. The same shape
  // deleted a whole finance journal in August.
  //
  // The arrival's WINDOW half reads CHECKIN_HELPERS, which is filled by note() — i.e. AFTER the put. So if it
  // ran here, every arrival in every archive would be refused for want of a session the archive is carrying.
  // It does not run here; only the stateless half does. This is that split, measured.
  try { w.close(); } catch {}
  await stopRelay();
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  dataDir = mkdtempSync(join(tmpdir(), 'trin-arrival-restore-'));
  await boot();
  await sleep(500);
  w = await conn();
  const t = now();
  const archive = [
    doc(gina, D.MEMBER + church.pub, { joined: t }),
    doc(ada, D.MEMBER + church.pub, { joined: t }),
    doc(church, D.STEWARDS + church.pub, { pubkeys: [sgLead.pub], caps: { [sgLead.pub]: ['safeguarding'] } }),
    permission(church, ada.pub),
    grant(MORNING, [ada.pub], KEY_AM, t - 600, t + 3600),
    arrival(gina, MORNING),
  ];
  const [status, body] = await importAs(church, archive);
  assert.equal(status, 200, '/import refused the church key — the restore door is not being exercised');
  assert.equal(body.invalid, 0,
    'THE RESTORE REFUSED SOMETHING: imported=' + body.imported + ' invalid=' + body.invalid +
    ' — an arrival judged before the envelope sitting beside it in the same request had been read. That is ' +
    'exactly the b0ba242 shape: the window half must not run on ingest.');
  await sleep(400);
  assert.equal((await copiesOf(arrivalAddr(MORNING, gina.pub))).length, 1,
    'the arrival did not survive the restore — a family\'s record of being at church is lost on every restore');
});

test('…AND THE RESTORE STILL REFUSES A FORGED ADDRESS, because that half IS stateless', async () => {
  // The other side of the same split. arrivalIdOk asks the event about itself, so it holds on an archive — and
  // must, or a forged arrival could be laundered in by replication and sit beside the honest one, with every
  // reader newest-wins.
  const forged = arrival(gina, MORNING, { addrPub: hank.pub });
  const honest = arrival(hank, MORNING);
  const [status, body] = await importAs(church, [forged, honest]);
  assert.equal(status, 200, '/import refused the church key');
  assert.equal(body.invalid, 1,
    'THE IMPORT DOOR ACCEPTED AN ARRIVAL AT SOMEBODY ELSE\'S ADDRESS. imported=' + body.imported +
    ' invalid=' + body.invalid + ' — the rule holds at the websocket and is bypassed by replication.');
  await sleep(400);
  assert.equal((await copiesOf(arrivalAddr(MORNING, hank.pub))).length, 1,
    'only the forgery was meant to be refused; hank\'s own honest arrival in the same request is missing, so ' +
    'this test is measuring an import that rejected everything');
  assert.equal((await copiesOf(arrivalAddr(MORNING, hank.pub)))[0].pubkey, hank.pub,
    'the document at hank\'s address is signed by somebody else — the forgery landed and the honest one did not');
});
