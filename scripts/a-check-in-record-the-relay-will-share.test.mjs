// THE RECORD THE CONSOLE ACTUALLY WRITES, PUT TO A REAL RELAY, AND ASKED FOR BY A HELPER AND A PARENT.
//   Run: node --test scripts/a-check-in-record-the-relay-will-share.test.mjs
//
// ⚠ WHY THIS FILE EXISTS — item 1 of reference/SCOPE-CHECKIN-SURFACES-2026-09-09.md, which is §6 of the
// design note happening in the shipped code:
//
//     "src/steward.src.js publishCheckin -> encPublish writes exactly [['d'], ['t'], ['enc','1']]. No
//      ['session'], no ['p']. Both read paths added on 2026-09-09 need one of those tags… So against any
//      check-in record a church holds today, a helper key opens nothing and a guardian sees nothing. The
//      tests that pass over those gates HAND-BUILD records carrying both tags."
//
// That is the exact shape §6 names: *the gate was correct and the test drove something that was not the
// shipped path.* scripts/checkin-helper-capability.test.mjs has a `checkin()` fixture that writes
// `[['church'], ['session'], ['p']]` by hand, so every one of its read assertions passed over a record no
// console has ever produced.
//
// So THIS file builds the record the way the console builds it — publishCheckin -> encPublish ->
// _encCleartextTags, ALL THREE LIFTED OUT OF vendor/steward.js, the bundle the console actually loads — and
// then puts it on a real gateway over a real websocket and asks for it as four different people.
//
// ── WHAT THIS PROVES, AND THE ONE THING IT DOES NOT ───────────────────────────────────────────────────────
//
// It proves the relay will SERVE the shipped record to an in-window cleared helper of its session and to the
// guardian it names, and to nobody else. That is the whole of item 1 and it is worth having: before this,
// both of those requests were REFUSED, which is a different failure from "served and unreadable" and looks
// nothing like it from a phone.
//
// ⚠ THE HEADER BELOW WAS TRUE UNTIL 2026-09-10 AND HALF OF IT IS NOW WRONG — corrected rather than left as a
// stale warning (CLAUDE.md rule 4), because a comment that says a feature does not exist is exactly what a
// later reader trusts.
//
// IT USED TO SAY: "this proves DELIVERY and says nothing about decryption", and the reasons were —
//
//   • `publishCheckin` seals through `encSeal('checkin', …)`, the SAFEGUARDING ring, and not the session key
//     from `checkinhelper:`, so a helper handed the ciphertext holds the wrong key for it. — HALF TRUE STILL:
//     `content` is exactly that ring's ciphertext and always will be. What changed is that piece 1 adds a
//     SECOND copy in a ['ck'] tag sealed under the session key, so the helper now has something their key
//     opens. The test '…AND SHE CAN OPEN IT' below proves that end to end, through this file's real relay.
//   • `helperKeyFor()` has no product caller anywhere in src/ or app/. — NO LONGER TRUE of the reader chain:
//     `readCheckinHelperCopy` beside it is called by the console's own encSubscribe, and both are exercised
//     here against a record a real gateway stored and served.
//   • a GUARDIAN holds neither key, so a parent served their own child's record can open nothing. — NO LONGER
//     TRUE as of 2026-09-11, STEP 2 of the parent surface. A THIRD copy rides in one ['gk'] tag per
//     ['p']-tagged guardian, sealed to that parent's own pubkey, and the two tests at the foot of this file
//     prove a guardian opens it after this relay has stored and served it — while the worker, the
//     safeguarding lead, another family's guardian and an ordinary member all open nothing from it.
//     NO READ GATE CHANGED FOR IT: canRead's CHECKIN_D branch has served a ['p']-tagged pubkey since the
//     feature shipped, which the guardian tests below have always asserted. Delivery was never the gap.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { requireFreePort } from './test-ports.mjs';
import { fnBody, stmt } from './test-slice.mjs';
import { buildHelperGrant, buildCheckinPermission, GRANT_SOURCE,
         readHelperGrant, helperKeyFor, readCheckinHelperCopy,
         checkinGuardianCopies, readCheckinGuardianCopy } from './checkin-role-source.mjs';
import { D } from './trinity-doc-types.mjs';

const PORT = 8908;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const unhex = h => Uint8Array.from(String(h).match(/.{1,2}/g).map(b => parseInt(b, 16)));

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

const church = K();
const sgLead = K();      // ticked for Safeguarding — reads the register today and must keep doing so
const ada = K();         // CLEARED, and on this session's envelope: the helper
const ben = K();         // CLEARED, and on LAST session's envelope: right key, wrong Sunday
const gina = K();        // the guardian this record names
const hank = K();        // a guardian of a different family
const cara = K();        // an ordinary member, cleared for nothing
// ── AND THE PEOPLE THE NARROWING OF 2026-09-11 IS ABOUT ───────────────────────────────────────────────────
// Six more, because "who loses it" and "who must keep it" are the same question asked twice and a narrowing
// that answers only the first is worse than the bug.
const tres = K();        // a steward ticked for FINANCE ALONE — the treasurer, and the headline of the defect
const rotaSt = K();      // a steward ticked for CONTENT alone — "Groups & rotas"
const memSt = K();       // a steward ticked for MEMBERS alone
const oldSt = K();       // a steward on the roster with NO `caps` entry — stewardCan()'s compatibility
                         // branch, and INDISTINGUISHABLE at the relay from the ordinary church whose roster
                         // has no `caps` key at all (the STEWARDS_D branch builds an empty Map either way).
                         // Owner 2026-09-12: they are REFUSED. They never held the register key.
const careBoss = K();    // a care-team ADMIN — on the roster of the church's configured meals admin group
const netKey = K();      // a key the church itself declared a network of — church-level authority it granted
const pat = K();         // a parent recorded in `guardians:` as the guardian of…
const teen = K();        // …an older young person who DOES have an account (the guardianOfIn route)
// ── AND A SECOND CHURCH, WHOSE ROSTER HAS NO `caps` KEY AT ALL ────────────────────────────────────────────
// The literal document the shipped console writes (`{ pubkeys: [...] }`) until somebody opens the capability
// editor — which is the ORDINARY church, not a legacy one, and the shape that made the 2026-09-12 decision
// necessary. It gets its own church because a church has one stewards: document, and rewriting the first
// church's would strip the capabilities every other test in this file rests on.
const plainChurch = K();
const plainSt = K();     // on that roster, with no capability list anywhere in the document
const plainMum = K();    // an ordinary member of that church, so an arrival has an author

const S_NOW = 'svc-now', S_LAST = 'svc-last', P_SESSION = 'svc-plain';
const CARE_TEAM = 'care-team-g1';
const SESSION_KEY = '11'.repeat(32), LAST_KEY = '22'.repeat(32);
// The key the CONSOLE actually seals a check-in with: the safeguarding capability ring. Named as itself so
// the "and nobody can open it" note above is visible in the fixture rather than only in prose.
const SG_CAP_KEY = '33'.repeat(32);

// ── THE SHIPPED WRITER, LIFTED ────────────────────────────────────────────────────────────────────────────
// Four functions out of vendor/steward.js, and NOTHING between the record and the wire is a test's own copy:
// publishCheckin decides the body, encSeal decides which key seals it, _encCleartextTags decides the tags,
// and encPublish assembles the event. What is stubbed is the world — the key, the clock, the socket.
function shippedWriter() {
  const sent = [];
  const stubs = {
    sk: church.sk,
    pub: church.pub,
    churchSk: church.sk,
    churchPub: church.pub,
    actingChurch: null,
    churchSkHeld: () => true,
    now,
    NET,
    _todayISO: () => new Date().toISOString().slice(0, 10),
    // THE REGISTER'S OWN KEY RING, as capKeyRing('checkin') would hold it. It is deliberately NOT SESSION_KEY
    // — `content` is sealed to the safeguarding ring and always was.
    //
    // THE COMMENT HERE UNTIL 2026-09-10 SAID "this is the fixture that makes the sealing gap visible… nothing
    // here can make it be [SESSION_KEY]", and that gap is now closed rather than merely described. Piece 1 of
    // reference/SCOPE-CHECKIN-SEALING-2026-09-10.md double-locks the record: `content` stays exactly this
    // ring's ciphertext, and a SECOND copy rides in an added ['ck'] tag sealed under the session key. So both
    // keys appear below, they seal different halves of one record, and the test at the foot of this file
    // proves a helper opens the half meant for them AFTER A REAL RELAY HAS SERVED IT.
    _capState: { checkin: { ring: [SG_CAP_KEY], rev: 1, docKeys: {} }, finance: { ring: [], rev: 0, docKeys: {} } },
    // WHICH SESSION KEYS THIS CONSOLE HOLDS. In the product subscribeCheckinSessionKeys unwraps our own slot
    // out of each envelope into this map; here it is seeded with the same SESSION_KEY the grant below wraps
    // to Ada, so the writer seals the helper's copy under the key her envelope will really hand her.
    _ckSessionKeys: new Map([[S_NOW, SESSION_KEY]]),
    _unhex: unhex,
    nip44e: (pt, k) => nip44.encrypt(pt, k),
    encrypt: (pt, k) => nip44.encrypt(pt, k),
    nip44ck: (sk, p) => nip44.utils.getConversationKey(sk, p),
    getConversationKey: (sk, p) => nip44.utils.getConversationKey(sk, p),
    // feChurch stamps the ['church'] tag on every church document and signs it. The real one, in shape: the
    // relay resolves which church a record belongs to from that tag, so a test that omitted it would be
    // asking a different question.
    feChurch: (tmpl) => finalizeEvent({ ...tmpl,
      tags: [...(tmpl.tags || []), ...((tmpl.tags || []).some(t => t[0] === 'church') ? [] : [['church', church.pub]])] }, church.sk),
    publish: (e) => { sent.push(e); return Promise.resolve(true); },
    crypto,
    Math,
    Date,
    JSON,
    String,
    Array,
    Number,
    Set,
    Promise,
  };
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      // esbuild RENAMES on collision — `nip44e` arrives as `encrypt3` in the bundle. Strip a trailing digit
      // and try again, exactly as the scaffold in checkin-helper-mint-is-the-shipped-one.test.mjs does.
      const base = String(k).replace(/\d+$/, '');
      if (base in t) return t[base];
      throw new ReferenceError('the lifted check-in writer needs `' + String(k) + '` — add a stub');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  // The tag derivation is a top-level function declaration, so it evaluates as itself.
  const tagFn = new Function('scope', `with (scope) { ${fnBody(VENDOR, 'function _encCleartextTags(kind, obj) {', '_encCleartextTags')} return _encCleartextTags; }`)(scope);
  stubs._encCleartextTags = tagFn;
  // AND THE HELPER'S-COPY BUILDER, lifted the same way — it is the writer half of piece 1, so a stub would be
  // the test answering the question it is named after. Unlike _encCleartextTags it closes over the harness
  // (`_ckSessionKeys`, `nip44e`, `_unhex`), so it is evaluated with the scope.
  stubs._encSealedCopies = new Function('scope',
    'with (scope) { return (' + stmt(VENDOR, 'var _encSealedCopies = (kind, obj) =>', '_encSealedCopies')
      .replace(/^var\s+\w+\s*=\s*/, '').replace(/;\s*$/, '') + '); }')(scope);
  // AND THE GUARDIAN'S-COPY BUILDER — STEP 2 of the parent surface, lifted the same way and for the same
  // reason. It closes over `sk` and the bundle's nip44 pair, and it calls the shared `checkinGuardianCopies`
  // (inlined into the bundle by esbuild under its own name), so that too is reached through the scope.
  stubs.checkinGuardianCopies = checkinGuardianCopies;
  stubs._encGuardianCopies = new Function('scope',
    'with (scope) { return (' + stmt(VENDOR, 'var _encGuardianCopies = (kind, obj) =>', '_encGuardianCopies')
      .replace(/^var\s+\w+\s*=\s*/, '').replace(/;\s*$/, '') + '); }')(scope);
  const lift = (sig, name) => {
    const body = fnBody(VENDOR, sig, name);
    return new Function('scope', `with (scope) { return ({ ${body} }).${name}; }`)(scope);
  };
  const encSeal = lift('encSeal(kind, obj) {', 'encSeal');
  const encPublish = lift('encPublish(dtag, obj, kind) {', 'encPublish');
  const publishCheckin = lift('publishCheckin(rec) {', 'publishCheckin');
  // publishCheckin and encPublish both reach for `window.Steward`, which in the console is the object they
  // live on. Wiring the LIFTED ones in is what keeps the chain real end to end.
  stubs.window = { Steward: { encSeal: (k, o) => encSeal.call({}, k, o), encPublish: (d, o, k) => encPublish.call({}, d, o, k) } };
  return { sent, write: (rec) => publishCheckin.call({}, rec) };
}

// ── the relay, and the four people who ask it questions ───────────────────────────────────────────────────
let relay, dataDir, w;
const conn = () => new Promise((r, j) => { const s = new WebSocket(WS_URL); s.on('open', () => r(s)); s.on('error', j); });
const send = (s, e) => new Promise(res => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { s.off('message', on); res([m[2], m[3] || '']); } };
  s.on('message', on); s.send(JSON.stringify(['EVENT', e]));
});
function req(s, sub, f, sk, ms = 700) {
  return new Promise(res => { const out = [];
    const on = d => { const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === sub) out.push(m[2]);
      else if (m[0] === 'AUTH' && sk) s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, sk)])); };
    s.on('message', on); s.send(JSON.stringify(['REQ', sub, f]));
    setTimeout(() => { s.off('message', on); res(out); }, ms); });
}
// One socket per question, so a stale AUTH can never make a refusal look like a grant.
async function asks(who, filter) {
  const s = await conn();
  await req(s, 'warm', { kinds: [30078], limit: 1 }, who.sk, 300);
  const got = await req(s, 'q' + Math.random().toString(36).slice(2, 7), filter, who.sk);
  s.close();
  return got;
}
const doc = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(),
  tags: [['d', d], ['t', NET], ...extra], content: typeof content === 'string' ? content : JSON.stringify(content) }, who.sk);
// Envelope and clearance from the SHIPPED builders, so a fixture cannot disagree with what the relay enforces.
const grant = (session, helpers, from, until, key) => {
  const { doc: body } = buildHelperGrant({ session, source: GRANT_SOURCE, lifetime: 'session', from, until,
    helpers, keepers: [church.pub, sgLead.pub], sessionKeyHex: key,
    wrap: (p, pl) => nip44.encrypt(pl, nip44.utils.getConversationKey(church.sk, p)) });
  return finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', D.CHECKINHELPER + session], ['t', NET], ['church', church.pub], ['session', session]],
    content: JSON.stringify(body) }, church.sk);
};
const permission = (who) => finalizeEvent({ kind: 30078, created_at: now(),
  tags: [['d', D.CHECKINPERM + who.pub], ['t', NET], ['church', church.pub], ['person', who.pub]],
  content: JSON.stringify(buildCheckinPermission({ person: who.pub, source: 'steward', lifetime: 'open',
    from: now() - 86400, until: null })) }, church.sk);

// THE RECORD UNDER TEST: written by the lifted console, re-signed as the church, and put on the relay. Only
// the SIGNING is done here — every tag and the whole body come out of the bundle.
async function putShipped(rec) {
  const h = shippedWriter();
  await h.write(rec);
  assert.equal(h.sent.length, 1, 'the lifted writer published ' + h.sent.length + ' documents, not one');
  const ev = h.sent[0];
  const [ok, msg] = await send(w, ev);
  assert.equal(ok, true, 'the relay refused the record the shipped console produced: ' + msg);
  return ev;
}

before(async () => {
  await requireFreePort(PORT, 'a-check-in-record-the-relay-will-share.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-ckrec-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    // TWO CONFIGURED CHURCHES. The second exists for one purpose: to carry a steward roster with NO `caps`
    // KEY AT ALL — the literal document src/steward.src.js publishes until somebody opens the capability
    // editor. It could not be done on the first church, because a church has ONE stewards: document and
    // replacing it mid-file would strip the capabilities every other test here depends on.
    env: { ...process.env, TRINITY_DATA_DIR: dataDir,
           CHURCH_NPUB: `${npubEncode(church.pub)},${npubEncode(plainChurch.pub)}` } });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  w = await conn();
  for (const who of [sgLead, ada, ben, gina, hank, cara,
                     tres, rotaSt, memSt, oldSt, careBoss, pat, teen]) await send(w, doc(who, D.MEMBER + church.pub, { joined: now() }));
  // THE ROSTER THE NARROWING IS MEASURED AGAINST. Four capability-scoped stewards and one legacy steward
  // with no `caps` entry at all — which is the shape stewardCan()'s compatibility branch exists for, and the
  // reason checkinReader() asks stewardCan() rather than stewardCanExplicitly().
  await send(w, doc(church, D.STEWARDS + church.pub, {
    pubkeys: [sgLead.pub, tres.pub, rotaSt.pub, memSt.pub, oldSt.pub],
    caps: { [sgLead.pub]: ['safeguarding'], [tres.pub]: ['finance'], [rotaSt.pub]: ['content'], [memSt.pub]: ['members'] } }));
  // A CARE-TEAM ADMIN, built the way the relay resolves one: the church's meals settings name an admin group,
  // and that group's roster names the person. careAdmin() is the grant being taken away here, so a fixture
  // that only *claimed* to make one would be testing nothing.
  await send(w, doc(church, D.MEALS_SETTINGS, { enabled: true, adminGroupId: CARE_TEAM }));
  await send(w, doc(church, D.ROSTER + CARE_TEAM, { pubs: [careBoss.pub] }));
  // A NETWORK KEY, declared BY THE CHURCH OVER ITSELF — the only way one can be declared (note()'s NETWORK_D
  // branch requires CHURCH_PUBS.has(e.pubkey)).
  await send(w, doc(church, D.NETWORK + netKey.pub, { joined: now() }));
  // THE STEWARD CONTROL'S OWN FIXTURE: a rota the church has narrowed to stewards. This is the role-only
  // document the FIXTURE CONTROL test keys on — see the ⚠ note there for why `stewards:<cp>`, which is
  // member-readable, could not do the job. It touches nothing else in this file: ROTA_VIS is consulted by
  // the rota:/runsheet: branch alone.
  await send(w, doc(church, D.ROTA_SETTINGS, { visibility: 'stewards' }));
  await send(w, doc(church, D.ROTA + 'r1', { e: 'sealed-rota' }, [['church', church.pub]]));
  // THE PARENT↔CHILD MAP: pat is recorded as a guardian of teen, and teen is marked a child. That is the
  // second guardian route — the one for a young person who has an account of their own.
  await send(w, doc(church, D.GUARDIANS + church.pub, { links: { [teen.pub]: [pat.pub] } }));
  await send(w, doc(church, D.MINORS + church.pub, { pubkeys: [teen.pub] }));
  for (const who of [ada, ben]) await send(w, permission(who));
  await sleep(150);
  const t = now();
  await send(w, grant(S_NOW, [ada.pub], t - 600, t + 3600, SESSION_KEY));
  await send(w, grant(S_LAST, [ben.pub], t - 8 * 3600, t - 5 * 3600, LAST_KEY));

  // ── THE SECOND CHURCH: A ROSTER WITH NO `caps` KEY AT ALL ───────────────────────────────────────────────
  // Note what is NOT written below: no `caps`. That is the document src/steward.src.js actually publishes
  // until somebody opens the capability editor, so this is the shape of the ordinary church.
  for (const who of [plainSt, plainMum]) await send(w, doc(who, D.MEMBER + plainChurch.pub, { joined: now() }));
  await send(w, doc(plainChurch, D.STEWARDS + plainChurch.pub, { pubkeys: [plainSt.pub] }));
  await send(w, doc(plainChurch, D.ROTA_SETTINGS, { visibility: 'stewards' }));
  await send(w, doc(plainChurch, D.ROTA + 'pr1', { e: 'sealed-rota' }, [['church', plainChurch.pub]]));
  // THE CLEARANCE AND THE ENVELOPE NAME plainMum, NOT plainSt, AND THAT IS THE POINT. Both documents have a
  // route in of their own — "the person a clearance names" and "a pubkey the envelope names" — and those
  // routes are NOT the steward grant and are not what changed. If they named plainSt he would be admitted by
  // them whatever checkinReader() said, and the refusals asserted below would be unmeasurable.
  await send(w, doc(plainChurch, D.CHECKINPERM + plainMum.pub,
    buildCheckinPermission({ person: plainMum.pub, source: 'steward', lifetime: 'open', from: t - 86400, until: null }),
    [['church', plainChurch.pub], ['person', plainMum.pub]]));
  await sleep(150);
  await send(w, finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', D.CHECKINHELPER + P_SESSION], ['t', NET], ['church', plainChurch.pub], ['session', P_SESSION]],
    content: JSON.stringify(buildHelperGrant({ session: P_SESSION, source: GRANT_SOURCE, lifetime: 'session',
      from: t - 600, until: t + 3600, helpers: [plainMum.pub], keepers: [plainChurch.pub],
      sessionKeyHex: SESSION_KEY,
      wrap: (p, pl) => nip44.encrypt(pl, nip44.utils.getConversationKey(plainChurch.sk, p)) }).doc) },
    plainChurch.sk));
  await sleep(150);
  await send(w, finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', D.CHECKIN + 'plain-1'], ['t', NET], ['church', plainChurch.pub], ['session', P_SESSION],
           ['p', plainMum.pub], ['enc', '1']],
    content: nip44.encrypt(JSON.stringify({ id: 'plain-1', childName: 'A Child', code: '6006' }), unhex(SESSION_KEY)) },
    plainChurch.sk));
  await send(w, finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', D.CHECKINARRIVAL + P_SESSION + ':' + plainMum.pub], ['t', NET], ['church', plainChurch.pub],
           ['session', P_SESSION]], content: JSON.stringify({ at: now() }) }, plainMum.sk));
  await sleep(250);
});
after(() => { try { w && w.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── WHAT THE SHIPPED WRITER PUTS ON THE WIRE ──────────────────────────────────────────────────────────────

test('the shipped writer emits BOTH tags the relay\'s read gates key on', async () => {
  const h = shippedWriter();
  await h.write({ id: 'r1', child: 'kid', childName: 'A Child', date: '2026-09-13', in: 1789000000, code: '4821',
    session: S_NOW, guardians: [gina.pub] });
  const ev = h.sent[0];
  const tag = (n) => ev.tags.filter(t => t[0] === n).map(t => t[1]);
  assert.deepEqual(tag('session'), [S_NOW],
    'NO [\'session\'] TAG. checkinHelperOf() has nothing else to go on, so every cleared helper of every ' +
    'session is refused this record — item 1 of the scope note, back again.');
  assert.deepEqual(tag('p'), [gina.pub],
    'NO [\'p\'] TAG. The guardian rule in canRead walks these, and design §7 says the record hangs off the ' +
    'GUARDIAN\'s key because the child has no phone. Without it a parent sees nothing of their own child.');
  // '2', NOT '1' — CHANGED 2026-09-10 WITH PIECE 1, and deliberately rather than by flipping a fixture.
  // The marker declares that a SECOND ciphertext rides in the tags, after the ['enc','care1'] precedent in
  // src/fellowship.src.js. It follows the copy and only the copy: the test below on a record with no session
  // asserts '1', because a record with no helper copy must stay byte-identical to what this writer produced
  // yesterday. THE MARKER RESCUES NO OLD READER — only leaving `content` alone does that, which is what the
  // ring assertions here and in checkin-key-separation.test.mjs hold.
  assert.deepEqual(tag('enc'), ['2'],
    're-anchor: a record carrying a helper copy no longer declares it. Nothing in this codebase reads `enc` ' +
    'on a check-in path, so this is a marker for whoever comes next rather than a gate — but a marker that ' +
    'disagrees with the tags is worse than none.');
  assert.equal(tag('ck').length, 1,
    'NO [\'ck\'] TAG. The relay serves a cleared helper this record (the tests below prove it), and without ' +
    'this tag there is nothing on it their session key opens — served but unreadable, which is the state ' +
    'piece 1 exists to end and which looks nothing like being refused from a phone.');
  assert.equal(tag('d')[0], D.CHECKIN + 'r1', 're-anchor: the d-tag is not the registry\'s');
  // AND THE BODY CARRIES THEM TOO — which is not duplication for its own sake. migrateCheckinKeys()
  // republishes this body through the same encPublish, and the body is the only place the tags can be
  // re-derived from; a record whose session lived only in a tag would lose it the first time it was re-keyed.
  const body = JSON.parse(nip44.decrypt(ev.content, unhex(SG_CAP_KEY)));
  assert.equal(body.session, S_NOW, 'the sealed body does not carry the session, so a re-key would strip the tag');
  assert.deepEqual(body.guardians, [gina.pub], 'the sealed body does not carry the guardians, same problem');
});

test('a malformed or duplicated guardian is dropped, not published as an inert tag', async () => {
  const h = shippedWriter();
  await h.write({ id: 'r2', session: S_NOW, guardians: [gina.pub, gina.pub, 'npub1nope', '', null, gina.pub.toUpperCase()] });
  const ps = h.sent[0].tags.filter(t => t[0] === 'p').map(t => t[1]);
  // The relay compares `toHexPub(t[1]) || t[1]`, so anything that is not already lower-case 64-hex would be
  // compared as a literal and match nobody. Refusing it here means it is ABSENT rather than present-and-inert,
  // which is the difference between a screen that can tell somebody was left out and one that cannot.
  assert.deepEqual(ps, [gina.pub], 'the p tags are ' + JSON.stringify(ps) + ' — an npub, a blank or a repeat got through');
});

test('a record with no session and no guardian is still WRITTEN — nothing blocks a check-in', async () => {
  // reference/DOMAIN.md: "a ratio outside policy, a helper whose clearance has lapsed, a rota with a gap —
  // none of these may stop a child being checked in". A church with no service in today's calendar is the
  // same case. The record must exist; what it loses is who else can open it.
  const h = shippedWriter();
  const out = await h.write({ id: 'r3', childName: 'A Child' });
  assert.ok(out !== null && out !== false, 'a check-in with no session was REFUSED by the shipped writer');
  assert.equal(h.sent.length, 1, 'nothing was published for a check-in with no session');
  assert.deepEqual(h.sent[0].tags.filter(t => t[0] === 'session' || t[0] === 'p'), [],
    'a record with no session named one anyway');
});

// ── AND WHAT A REAL RELAY DOES WITH IT ────────────────────────────────────────────────────────────────────

test('THE HELPER OF THAT SESSION IS SERVED THE SHIPPED RECORD — the request that used to be refused', async () => {
  await putShipped({ id: 'live-1', childName: 'A Child', code: '4821', session: S_NOW, guardians: [gina.pub] });
  await sleep(200);
  const got = await asks(ada, { kinds: [30078], '#d': [D.CHECKIN + 'live-1'] });
  assert.equal(got.length, 1,
    'A CLEARED, IN-WINDOW HELPER WAS REFUSED THE RECORD THE CONSOLE ACTUALLY WROTE. This is item 1 of the ' +
    'scope note in one assertion: the gate is right, and the writer emitted nothing for it to read.');
});

test('…AND SHE CAN OPEN IT — the double lock, end to end, through a real relay', async () => {
  // ⚠ THE ONE THING reference/SCOPE-CHECKIN-SEALING-2026-09-10.md LISTS AS UNVERIFIED: "the writer shape is
  // proved compatible and the relay is proved to serve it, but not that a helper or guardian client can open
  // it end to end." This is that assertion, and every link in it is shipped code:
  //
  //   the shipped writer seals the record  →  a real gateway stores and serves it  →  the shipped
  //   readHelperGrant parses the envelope the shipped buildHelperGrant made  →  the shipped helperKeyFor
  //   hands Ada her key  →  the shipped readCheckinHelperCopy opens the tag.
  //
  // Nothing between the church sealing the record and Ada reading it is this file's own code, and the record
  // is the one the RELAY handed back rather than the one the writer kept — so a relay that dropped or
  // rewrote the tag would fail here rather than pass.
  const written = await putShipped({ id: 'live-open', childName: 'Esther Ncube', code: '7742',
    session: S_NOW, guardians: [gina.pub] });
  await sleep(200);
  const got = await asks(ada, { kinds: [30078], '#d': [D.CHECKIN + 'live-open'] });
  assert.equal(got.length, 1, 'fixture: the in-window helper was not served the record at all');
  const served = got[0];
  assert.equal(served.id, written.id,
    'THE RELAY CHANGED THE EVENT. The ck tag is inside the event id, so this is the property piece 1 relies ' +
    'on to say a relay cannot strip the helper copy undetected — if the id still matched a modified event, ' +
    'that reasoning would be wrong.');
  assert.equal(verifyEvent(served), true, 'the served event does not verify, so the tag could have been altered');

  // ── ADA'S OWN ROUTE TO THE KEY: her envelope, parsed and unwrapped by the shipped functions ──
  const env = await asks(ada, { kinds: [30078], '#d': [D.CHECKINHELPER + S_NOW] });
  assert.equal(env.length, 1, 'fixture: the cleared helper was not served her own session envelope');
  const parsed = readHelperGrant(env[0].content);
  assert.ok(parsed, 'the shipped parser refused the envelope the shipped builder made and the relay stored');
  const key = helperKeyFor(parsed, ada.pub, now(),
    (ct) => nip44.decrypt(ct, nip44.utils.getConversationKey(ada.sk, church.pub)));
  assert.equal(key, SESSION_KEY,
    'the key Ada recovers from her own envelope is not the one the desk sealed with, so the two halves of ' +
    'this feature were built against different fixtures');

  // ── AND THE RECORD OPENS ──
  const opened = readCheckinHelperCopy(served.tags, key, (ct, k) => nip44.decrypt(ct, unhex(k)));
  assert.ok(opened, 'A CLEARED, IN-WINDOW HELPER WAS SERVED THE RECORD AND COULD NOT OPEN IT. That is the ' +
    '"served but unreadable" state the scope note warns looks nothing like being refused from a phone: the ' +
    'room shows empty and nothing anywhere says why.');
  assert.equal(opened.code, '7742', 'she opened something other than the pickup code, which is the field the door needs');
  assert.equal(opened.childName, 'Esther Ncube');

  // ── AND `content` STILL BELONGS TO THE CHURCH ALONE. The additive shape's whole promise.
  assert.equal(JSON.parse(nip44.decrypt(served.content, unhex(SG_CAP_KEY))).code, '7742',
    'the safeguarding ring can no longer open `content` on a record that has been through a real relay');
  assert.throws(() => nip44.decrypt(served.content, unhex(SESSION_KEY)),
    're-anchor: the session key opens `content` too, so the two locks are not two locks');

  // ── AND BEN, CLEARED FOR LAST WEEK, GETS NOWHERE EVEN WITH THE CIPHERTEXT IN HAND. The relay refuses him
  // the record (the next test proves that); this proves the ciphertext would not yield to him either, which
  // is what makes one revocation enough.
  const benKey = helperKeyFor(readHelperGrant(env[0].content), ben.pub, now(),
    (ct) => nip44.decrypt(ct, nip44.utils.getConversationKey(ben.sk, church.pub)));
  assert.equal(benKey, '', 'fixture: last week\'s helper is on THIS session\'s envelope');
  assert.equal(readCheckinHelperCopy(served.tags, LAST_KEY, (ct, k) => nip44.decrypt(ct, unhex(k))), null,
    'LAST WEEK\'S SESSION KEY OPENED THIS WEEK\'S RECORD. Per-session keys are the mechanism that makes a ' +
    'clearance narrow, and it has just failed at the only layer that still works if every gate does not.');
});

test('THE GUARDIAN THE RECORD NAMES IS SERVED IT, and the other family\'s guardian is not', async () => {
  await putShipped({ id: 'live-2', childName: 'A Child', code: '5133', session: S_NOW, guardians: [gina.pub] });
  await sleep(200);
  assert.equal((await asks(gina, { kinds: [30078], '#d': [D.CHECKIN + 'live-2'] })).length, 1,
    'the guardian named in the record the console wrote cannot fetch it — the [\'p\'] tag is the entire ' +
    'mechanism for a parent seeing their own child, and design §7 rests on it');
  assert.deepEqual(await asks(hank, { kinds: [30078], '#d': [D.CHECKIN + 'live-2'] }), [],
    'ANOTHER FAMILY\'S GUARDIAN WAS SERVED THIS CHILD\'S RECORD');
});

test('a helper of a DIFFERENT session is refused it, and so is an ordinary member', async () => {
  await putShipped({ id: 'live-3', childName: 'A Child', code: '6244', session: S_NOW, guardians: [gina.pub] });
  await sleep(200);
  assert.deepEqual(await asks(ben, { kinds: [30078], '#d': [D.CHECKIN + 'live-3'] }), [],
    'BEN IS CLEARED FOR THE YEAR AND HOLDS LAST SUNDAY\'S ENVELOPE, and was served this Sunday\'s record. ' +
    'The session tag has to be the one he holds, not merely present.');
  assert.deepEqual(await asks(cara, { kinds: [30078], '#d': [D.CHECKIN + 'live-3'] }), [],
    'an ordinary member of the congregation was served a child\'s check-in record');
});

test('the safeguarding lead and the church still read it — this narrowed nothing they had', async () => {
  await putShipped({ id: 'live-4', childName: 'A Child', code: '7355', session: S_NOW, guardians: [gina.pub] });
  await sleep(200);
  assert.equal((await asks(sgLead, { kinds: [30078], '#d': [D.CHECKIN + 'live-4'] })).length, 1,
    'the safeguarding steward lost access to the register');
  assert.equal((await asks(church, { kinds: [30078], '#d': [D.CHECKIN + 'live-4'] })).length, 1,
    'the church lost access to its own register');
});

test('THE RECORD EVERY CHURCH HOLDS TODAY — no session, no guardian — reaches neither of them', async () => {
  // This is the state of the corpus BEFORE this change, asserted so the size of item 1 is on the record and
  // so the fix cannot be quietly reverted without a failure. It is also the honest answer for a church with
  // no service document: the register still works for the church and its stewards, and for nobody else.
  await putShipped({ id: 'live-5', childName: 'A Child', code: '8466' });
  await sleep(200);
  assert.deepEqual(await asks(ada, { kinds: [30078], '#d': [D.CHECKIN + 'live-5'] }), [],
    'a record naming no session was served to a helper anyway — the session gate is not the thing deciding');
  assert.deepEqual(await asks(gina, { kinds: [30078], '#d': [D.CHECKIN + 'live-5'] }), [],
    'a record naming no guardian was served to a guardian anyway');
  assert.equal((await asks(sgLead, { kinds: [30078], '#d': [D.CHECKIN + 'live-5'] })).length, 1,
    'the safeguarding lead cannot read an untagged record either, which would break every register in use');
});

// ── STEP 2 OF THE PARENT SURFACE: SERVED *AND* OPENABLE ───────────────────────────────────────────────────
// Delivery was never the question — `canRead`'s CHECKIN_D branch has served a ['p']-tagged pubkey since the
// feature shipped, and the test above proves it against this running gateway. What a parent has never had is
// a copy they hold the key to. These two drive the whole chain over a REAL relay: the shipped console writes
// it, the box stores and serves it, and the parent opens it with nothing but their own secret key.
//
// NO GATE CHANGED FOR ANY OF THIS. If a future edit needs one, that is the signal to stop.
const opensAs = (who, evt) => readCheckinGuardianCopy(evt.tags,
  (ct) => nip44.decrypt(ct, nip44.utils.getConversationKey(who.sk, evt.pubkey)));

test('THE GUARDIAN OPENS THE RECORD THE RELAY SERVED HER — and no other reader of it can', async () => {
  await putShipped({ id: 'live-6', childName: 'Esther Ncube', code: '9317', session: S_NOW, guardians: [gina.pub] });
  await sleep(200);
  const [served] = await asks(gina, { kinds: [30078], '#d': [D.CHECKIN + 'live-6'] });
  assert.ok(served, 're-anchor: the relay no longer serves a guardian her own child\'s record at all');
  assert.ok(served.tags.some(t => t[0] === 'gk'),
    'THE RECORD CAME OFF A REAL RELAY WITH NO GUARDIAN COPY ON IT. The tag is inside the event id, so a box ' +
    'cannot strip it undetected — which means the writer did not put one there.');

  assert.equal(opensAs(gina, served)?.code, '9317',
    'THE GUARDIAN WAS SERVED HER OWN CHILD\'S RECORD AND COULD NOT OPEN IT. That is the state the parent ' +
    'surface existed to end: served ciphertext, no key, and a screen that can only say "ask at the desk".');
  assert.equal(opensAs(gina, served).childName, 'Esther Ncube');

  // AND EVERY OTHER PERSON THIS BOX SERVES THE SAME RECORD GAINS NOTHING FROM THE GUARDIAN'S COPY. Ada (the
  // cleared worker) and the safeguarding lead both read this record — through the ['ck'] copy and through
  // `content` — and neither may read it through a parent's.
  assert.equal(opensAs(ada, served), null, 'the cleared worker\'s key opened a GUARDIAN\'s copy');
  assert.equal(opensAs(sgLead, served), null, 'the safeguarding lead\'s key opened a GUARDIAN\'s copy');
  assert.equal(opensAs(hank, served), null, 'another family\'s guardian opened this child\'s copy');
  assert.equal(opensAs(cara, served), null, 'an ordinary member opened this child\'s copy');
  // …and `content` is still the ring's alone, on a record that has been through the box.
  assert.equal(JSON.parse(nip44.decrypt(served.content, unhex(SG_CAP_KEY))).code, '9317',
    'the safeguarding ring lost `content` on a record carrying a guardian copy');
});

test('A CHURCH WITH NO SERVICE DOCUMENT still hands its parents the pickup code', async () => {
  // `_encSealedCopies` gives up the moment a record has no session ("an ordinary Sunday with no service
  // document" — its own words). The guardian copy deliberately does not share that early return, or every
  // such church would silently lose its PARENTS' codes while its own register carried on working.
  await putShipped({ id: 'live-7', childName: 'A Child', code: '2280', guardians: [gina.pub] });
  await sleep(200);
  const [served] = await asks(gina, { kinds: [30078], '#d': [D.CHECKIN + 'live-7'] });
  assert.ok(served, "the relay refused a guardian a record that names her but no session — the ['p'] rule " +
    'is independent of the session rule and must stay so');
  assert.equal(served.tags.filter(t => t[0] === 'session').length, 0,
    're-anchor: this record DOES carry a session, so it is not testing the no-service-document church');
  assert.equal(served.tags.filter(t => t[0] === 'ck').length, 0,
    're-anchor: the helper copy survived a record with no session, so the early return this is about is gone');
  assert.equal(opensAs(gina, served)?.code, '2280',
    'A CHURCH WITH NO SERVICE DOCUMENT LOST ITS PARENTS\' PICKUP CODES — the guardian copy was derived ' +
    'inside the session\'s early return.');
});

// ══ A TREASURER IS NOT SERVED THE CHILDREN'S REGISTER ══════════════════════════════════════════════════════
//
// THE DEFECT, in one sentence: canRead's kind-30078 section short-circuits on
// `stewardCan(authed, cp, 'any') || careAdmin(authed, cp)` BEFORE it reaches any check-in rule, so every
// branch below that line was dead code for anyone it admitted. A steward holding ANY ONE capability — a
// treasurer ticked for Finance, a volunteer ticked for Groups & rotas, a Members steward — and every
// care-team admin were served every `trinityone/checkin:` and `trinityone/checkinarrival:` the church has
// ever written.
//
// WHY "THEY CANNOT OPEN IT" IS NOT AN ANSWER, and this is the whole reason the fix is worth making. The body
// is sealed three ways over (the safeguarding ring in `content`, the session key in ['ck'], the parent's own
// key in ['gk']) and none of them yields. But the TAGS ARE CLEARTEXT and always must be, because the relay
// routes on them: ['p', <guardian pubkey>] and ['session', <sessionId>]. `roster:` maps a pubkey to a name
// and a session maps to a dated service, so the whole history of "this named parent had a child at church on
// this date" came out of the tags with no key at all. That is a family-composition and attendance record for
// the congregation's children, derived by somebody the church gave the books to.
//
// AND THE PRODUCT SAID THE OPPOSITE. The console's own copy: a record opens to "you, anyone you have given
// Safeguarding to, a cleared helper holding that session's key, and the child's own guardians". A treasurer
// is in none of those four categories.
//
// EVERY ASSERTION BELOW GOES OVER A REAL WEBSOCKET TO THE GATEWAY THIS FILE ALREADY SPAWNS, as the person
// named, after a real NIP-42 AUTH. Nothing here asks canRead() a question directly.
//
// ── THE ARRIVAL, built here because no other fixture in this file writes one ───────────────────────────────
// d = checkinarrival:<sessionId>:<authorpubhex>, authored by the parent, ['session'] agreeing with the
// address. It carries a parent's pubkey in its own ADDRESS and the session in a cleartext tag, so it leaks
// the same inference as the register by a shorter route.
const arrival = (who, sid) => finalizeEvent({ kind: 30078, created_at: now(),
  tags: [['d', D.CHECKINARRIVAL + sid + ':' + who.pub], ['t', NET], ['church', church.pub], ['session', sid]],
  content: JSON.stringify({ at: now() }) }, who.sk);

const one = (got, d) => got.filter(e => (e.tags.find(t => t[0] === 'd') || [])[1] === d).length;

test('FIXTURE CONTROL: the roster, the care team, the network and the parent map all really took', async () => {
  // A BASELINE ROW FOR THE WHOLE SECTION. Every "X is refused" assertion below is satisfied by a fixture that
  // silently failed to make X anything at all — a steward doc the relay rejected makes a treasurer into an
  // ordinary member, and "an ordinary member is refused" is a different and much weaker claim. So prove each
  // role EXISTS by a grant ONLY THAT ROLE HAS, before asserting what it no longer reaches.
  //
  // ⚠ THE FIRST VERSION OF THIS CONTROL USED `stewards:<cp>` AND DID NOT WORK, and it is worth saying why
  // rather than quietly swapping the document. Its comment claimed that doc is "served to the church, its
  // network and its stewards, and to nobody else." That is false: scripts/trinity-doc-types.mjs declares it
  // `read: 'members'` and an independent persona matrix measured all sixteen members reading it. So it caught
  // a stewards: write the relay REJECTED, and missed the failure that actually matters — a document that
  // LANDED and failed to make the person a steward (a typo'd pubkey, a caps shape the STEWARDS_D branch
  // parses differently). In that case the control stayed green and every refusal below silently became
  // "an ordinary member is refused".
  //
  //   • A STEWARD — any capability — is proved by `rota:` under `rota-settings` visibility 'stewards', which
  //     is role-only by construction: canRead returns false for an ordinary member and the church, its
  //     network, ANY steward and a care admin have already returned true. That is the general steward grant
  //     this fix deliberately does NOT touch, so it answers exactly "is this person a steward of this church"
  //     and nothing else.
  //     AND IT IS NOT BLIND TO AN OVER-GRANT EITHER, which is the other way a caps map can go wrong: if the
  //     caps failed to parse, stewardCan()'s compatibility branch makes the treasurer a FULL steward, he
  //     satisfies stewardCan(…,'safeguarding') and the register tests below go red rather than green. Both
  //     directions of a mis-parsed roster are therefore caught, one here and one there.
  //   • a care admin — `minors:`, whose read rule names careAdmin() explicitly and which this fix does NOT
  //     touch: if the care admin can read it, careAdmin() resolved.
  //   • the network key — the same `minors:` rule, which names networkOf() explicitly.
  const rotaDoc = D.ROTA + 'r1', minorsDoc = D.MINORS + church.pub;
  for (const [who, name] of [[tres, 'the treasurer'], [rotaSt, 'the rota steward'], [memSt, 'the members steward'], [oldSt, 'the legacy steward']])
    assert.equal(one(await asks(who, { kinds: [30078], '#d': [rotaDoc] }), rotaDoc), 1,
      name + ' is not a steward on this relay at all — every refusal below would pass for the wrong reason, ' +
      'because "an ordinary member is refused the register" is a far weaker claim than the one being made');
  assert.deepEqual(await asks(cara, { kinds: [30078], '#d': [rotaDoc] }), [],
    're-anchor: an ordinary member reads a stewards-only rota, so the steward control above proves nothing');
  assert.equal(one(await asks(careBoss, { kinds: [30078], '#d': [minorsDoc] }), minorsDoc), 1,
    'careBoss is not a care-team admin on this relay — careAdmin() needs meals-settings AND the named ' +
    'group\'s roster, and one of the two did not take');
  assert.equal(one(await asks(netKey, { kinds: [30078], '#d': [minorsDoc] }), minorsDoc), 1,
    'the network key was not recorded — networkOf() is false, so "the network still reads it" below would ' +
    'be measuring nothing');
  assert.deepEqual(await asks(cara, { kinds: [30078], '#d': [minorsDoc] }), [],
    're-anchor: an ordinary member reads `minors:`, so the two controls above prove nothing');
});

test('A TREASURER IS REFUSED THE REGISTER — and so is a rota steward, a members steward and a care admin', async () => {
  await putShipped({ id: 'narrow-1', childName: 'A Child', code: '1001', session: S_NOW, guardians: [gina.pub] });
  await sleep(200);
  const dtag = D.CHECKIN + 'narrow-1';
  for (const [who, name] of [[tres, 'A STEWARD TICKED FOR FINANCE ALONE'], [rotaSt, 'A STEWARD TICKED FOR GROUPS & ROTAS ALONE'],
                             [memSt, 'A STEWARD TICKED FOR MEMBERS ALONE'], [careBoss, 'A CARE-TEAM ADMIN']])
    assert.deepEqual(await asks(who, { kinds: [30078], '#d': [dtag] }), [],
      name + ' WAS SERVED A CHILD\'S CHECK-IN RECORD. The body is sealed to them, but [\'p\'] and ' +
      '[\'session\'] are cleartext and the roster turns that pubkey into a name — so this is "the Hendersons ' +
      'had a child at church on 13 September", for the whole history, to somebody the church gave the books to.');
});

test('…AND THE SAME PEOPLE ARE REFUSED AN ARRIVAL, which names a household in its own address', async () => {
  const ev = arrival(gina, S_NOW);
  const [ok, msg] = await send(w, ev);
  assert.equal(ok, true, 'fixture: the relay refused the arrival this test is about: ' + msg);
  await sleep(200);
  const dtag = (ev.tags.find(t => t[0] === 'd') || [])[1];
  for (const [who, name] of [[tres, 'the treasurer'], [rotaSt, 'the rota steward'], [memSt, 'the members steward'], [careBoss, 'the care admin']])
    assert.deepEqual(await asks(who, { kinds: [30078], '#d': [dtag] }), [],
      name + ' was served an arrival. The address IS `<session>:<parent pubkey>`, so serving it needs no ' +
      'tags read and no keys at all — it is "this family was at the creche door this morning" in the d-tag.');
  // …and the people it is for still get it: the parent who wrote it, and the worker on that session.
  assert.equal(one(await asks(gina, { kinds: [30078], '#d': [dtag] }), dtag), 1, 'the parent lost her own arrival');
  assert.equal(one(await asks(ada, { kinds: [30078], '#d': [dtag] }), dtag), 1,
    'the in-window helper of that session lost the arrival she is meant to work from');
  assert.deepEqual(await asks(cara, { kinds: [30078], '#d': [dtag] }), [], 're-anchor: an ordinary member reads arrivals');
});

test('…AND A TREASURER IS REFUSED THE HELPER ENVELOPE AND THE CLEARANCE', async () => {
  // Both are cleartext documents naming the church's children's-work team — `checkinhelper:` in its `pubs`
  // array, `checkinperm:` by being addressed at the person's own pubkey. Neither is a register record, and
  // both were served to the same people for the same reason: the short-circuit ran first.
  const env = D.CHECKINHELPER + S_NOW, perm = D.CHECKINPERM + ada.pub;
  for (const [who, name] of [[tres, 'the treasurer'], [rotaSt, 'the rota steward'], [memSt, 'the members steward'], [careBoss, 'the care admin']]) {
    assert.deepEqual(await asks(who, { kinds: [30078], '#d': [env] }), [],
      name + ' was served the session envelope, whose cleartext `pubs` names everyone rostered to children\'s ' +
      'work that morning');
    assert.deepEqual(await asks(who, { kinds: [30078], '#d': [perm] }), [],
      name + ' was served a clearance, which is the church\'s cleared safeguarding team one person at a time');
  }
  // AND THE PEOPLE THEY ARE FOR STILL HAVE THEM.
  assert.equal(one(await asks(ada, { kinds: [30078], '#d': [env] }), env), 1,
    'the in-window helper lost her own session envelope — she is then granted the register and refused the key');
  assert.equal(one(await asks(ada, { kinds: [30078], '#d': [perm] }), perm), 1,
    'the person the clearance names lost it — her own screen can no longer say when it ends');
  assert.equal(one(await asks(sgLead, { kinds: [30078], '#d': [env] }), env), 1, 'the safeguarding lead lost the envelope');
  assert.equal(one(await asks(church, { kinds: [30078], '#d': [perm] }), perm), 1, 'the church lost its own clearance document');
});

test('WHO MUST KEEP IT, EVERY ONE: church, network, safeguarding steward, legacy steward, helper, guardian', async () => {
  // The other half of the narrowing, and the half that makes it safe. A gate that closed on the treasurer and
  // also on the crèche is a worse outcome than the bug — the register is what a church runs its Sunday from.
  await putShipped({ id: 'narrow-2', childName: 'A Child', code: '2002', session: S_NOW, guardians: [gina.pub] });
  await sleep(200);
  const dtag = D.CHECKIN + 'narrow-2';
  for (const [who, name] of [[church, 'THE CHURCH KEY'], [netKey, 'THE NETWORK KEY THE CHURCH DECLARED'],
                             [sgLead, 'THE SAFEGUARDING STEWARD'],
                             [ada, 'THE IN-WINDOW CLEARED HELPER'], [gina, 'THE GUARDIAN THE RECORD NAMES']])
    assert.equal(one(await asks(who, { kinds: [30078], '#d': [dtag] }), dtag), 1,
      name + ' LOST THE CHILDREN\'S REGISTER. A narrowing that takes it from any of these is worse than the ' +
      'defect it closes: this is the document a creche is run from, and a register that goes blank ' +
      'mid-session is not a safeguarding record.');
  // `oldSt` WAS IN THIS LIST UNTIL 2026-09-12 and was moved out by the owner's decision, not by an edit that
  // tidied it away — see the test immediately below, which asserts the refusal in its own right.
});

// FLIPPED 2026-09-12 BY THE OWNER'S DECISION, and the old title and claim are kept here rather than deleted
// (CLAUDE.md rules 4 and 8). It was
//   'THE LEGACY STEWARD IS THE stewardCan-vs-stewardCanExplicitly DECISION, asserted rather than assumed'
// and it asserted that an UNSCOPED steward KEEPS the register, on this reasoning:
//
//     "THIS TEST IS WHY THE CHOICE IS stewardCan(). Swap checkinReader() to stewardCanExplicitly() and this
//      fails — the measurement of what the stricter rule would cost… Every church that exists today
//      appointed its stewards that way, so this is a relay update stripping working churches of their
//      children's register — an availability failure dressed as a security improvement."
//
// THAT WAS REASONING ABOUT A MIGRATION THAT DOES NOT EXIST. Owner, 2026-09-12: "There are no live churches.
// This isn't an issue I dont think. U need to remember that we are pre pilot still." reference/DOMAIN.md now
// carries the standing rule — stop pricing migrations until the pilot starts.
test('AN UNSCOPED STEWARD IS REFUSED ALL FOUR CHECK-IN DOCUMENTS — the church shape that made this necessary', async () => {
  // THE TWO GATES DISAGREED, AND THAT DISAGREEMENT WAS THE LEAK.
  //   • the KEY gate is strict: `_capAllows` returns `!spec.explicit` and CAP_KEYS.checkin is explicit,
  //     so this steward is NEVER wrapped into `checkinkey:` and never could open one record. The console
  //     already tells them: "Safeguarding has to be given on purpose — it isn't included in 'everything'".
  //   • the READ gate was loose: stewardCan()'s `if (!caps) return true` served them every record anyway.
  // So what they got was ciphertext they could not open — and the TAGS ARE CLEARTEXT, which is the whole
  // disclosure this commit exists to close. The strict predicate makes the read gate agree with the key gate.
  //
  // AND THIS IS THE ORDINARY CHURCH, NOT A LEGACY ONE: src/steward.src.js publishes `{ pubkeys: [...] }`
  // with no `caps` key at all unless somebody opens the capability editor, and at the relay that is
  // INDISTINGUISHABLE from oldSt's shape here (the STEWARDS_D branch builds an empty Map for both, so
  // `byPub.get(pub)` is undefined either way). The caps-free roster is driven literally, against its own
  // church, by the test after this one.
  await putShipped({ id: 'narrow-3', childName: 'A Child', code: '3003', session: S_NOW, guardians: [gina.pub] });
  const av = arrival(hank, S_NOW);
  assert.equal((await send(w, av))[0], true, 'fixture: the relay refused the arrival this test needs');
  await sleep(200);
  const four = [[D.CHECKIN + 'narrow-3', 'the register record'],
                [(av.tags.find(t => t[0] === 'd') || [])[1], 'the arrival'],
                [D.CHECKINHELPER + S_NOW, 'the session envelope'],
                [D.CHECKINPERM + ada.pub, 'the clearance']];
  for (const [dtag, what] of four) {
    assert.deepEqual(await asks(oldSt, { kinds: [30078], '#d': [dtag] }), [],
      'AN UNSCOPED STEWARD WAS SERVED ' + what.toUpperCase() + '. They hold no capability list, so they ' +
      'have never been given the register key and could never open a record — serving it to them hands ' +
      'over the cleartext-tag inference and nothing else.');
    // AND THE CHURCH KEY HOLDER KEEPS ALL FOUR, in the same breath.
    assert.equal(one(await asks(church, { kinds: [30078], '#d': [dtag] }), dtag), 1,
      'THE CHURCH LOST ' + what.toUpperCase() + ' — the narrowing reached past the person it was aimed at');
  }
  // …AND oldSt REALLY IS A STEWARD, proved by the same role-only document the FIXTURE CONTROL uses. Without
  // this the four refusals above are satisfied by a roster that never made him one, which is the failure
  // mode that control exists for.
  const rotaDoc = D.ROTA + 'r1';
  assert.equal(one(await asks(oldSt, { kinds: [30078], '#d': [rotaDoc] }), rotaDoc), 1,
    're-anchor: oldSt is not a steward of this church at all, so every refusal above proves nothing');
});

test('THE OTHER GUARDIAN ROUTE — the church\'s own parent-child map — survives the narrowing', async () => {
  // For an older young person who DOES have an account, the record names THEM in ['p'] and the parent is
  // found through `guardians:`. That is guardianOfIn(), directional, with minorOf() as a second refusal.
  await putShipped({ id: 'narrow-4', childName: 'A Teenager', code: '4004', session: S_NOW, guardians: [teen.pub] });
  await sleep(200);
  const dtag = D.CHECKIN + 'narrow-4';
  assert.equal(one(await asks(pat, { kinds: [30078], '#d': [dtag] }), dtag), 1,
    'A PARENT RECORDED IN THE CHURCH\'S OWN `guardians:` MAP LOST THEIR CHILD\'S RECORD. This route is the ' +
    'only one for a young person with an account of their own, and it lives at the FOOT of the moved block — ' +
    'so a narrowing that returned early would have cut it silently.');
  assert.equal(one(await asks(teen, { kinds: [30078], '#d': [dtag] }), dtag), 1,
    're-anchor: the person the record NAMES reads it by the p-tag rule, independent of the map');
  assert.deepEqual(await asks(hank, { kinds: [30078], '#d': [dtag] }), [],
    'another family\'s guardian was served this record through the map');
  assert.deepEqual(await asks(tres, { kinds: [30078], '#d': [dtag] }), [],
    're-anchor: the treasurer reads it, so nothing above is evidence of anything');
});

test('A RECORD THE CHURCH DID NOT WRITE — the one that proves checkinReader and not the author rule', async () => {
  // ⚠ WHY THIS TEST EXISTS, and it is a sabotage finding rather than a hunch. Every other record in this file
  // is signed by the CHURCH, and canRead returns true for `authed === e.pubkey` long before any check-in rule
  // runs — so "the church still reads its own register" was being satisfied by the AUTHOR rule, and deleting
  // `authed === cp` from checkinReader() left all 18 tests green. A grant nothing can redden is a grant
  // nobody can rely on.
  //
  // A HELPER-AUTHORED RECORD IS THE ORDINARY CASE THIS COVERS, not a contrivance: accept()'s CHECKIN_D branch
  // has admitted an in-window helper's write since 2026-09-09, because the people who actually do this job are
  // rota volunteers and must not have to be made safeguarding stewards to check a child in. So the register a
  // church opens on a Sunday contains rows it did not sign.
  const rec = finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', D.CHECKIN + 'byhelper-1'], ['t', NET], ['church', church.pub], ['session', S_NOW], ['p', gina.pub], ['enc', '1']],
    content: nip44.encrypt(JSON.stringify({ id: 'byhelper-1', childName: 'A Child', code: '5005' }), unhex(SESSION_KEY)) }, ada.sk);
  const [ok, msg] = await send(w, rec);
  assert.equal(ok, true, 'fixture: the relay refused the in-window helper\'s own check-in record: ' + msg);
  await sleep(200);
  const dtag = D.CHECKIN + 'byhelper-1';
  for (const [who, name] of [[church, 'THE CHURCH KEY'], [netKey, 'THE NETWORK KEY'], [sgLead, 'THE SAFEGUARDING STEWARD'],
                             [gina, 'THE GUARDIAN THE RECORD NAMES']])
    assert.equal(one(await asks(who, { kinds: [30078], '#d': [dtag] }), dtag), 1,
      name + ' CANNOT READ A ROW ITS OWN CRECHE VOLUNTEER WROTE. The register is one document per child and ' +
      'the church did not sign most of them — a gate that serves only what the church authored hands it a ' +
      'register with the morning missing from it.');
  // oldSt MOVED FROM THE LIST ABOVE TO THE ONE BELOW on 2026-09-12, by the owner's decision.
  for (const [who, name] of [[tres, 'the treasurer'], [rotaSt, 'the rota steward'], [careBoss, 'the care admin'],
                             [oldSt, 'an UNSCOPED steward'], [cara, 'an ordinary member']])
    assert.deepEqual(await asks(who, { kinds: [30078], '#d': [dtag] }), [],
      name + ' was served a helper-authored check-in record');
});

test('THE CAPS-FREE ROSTER, LITERALLY — the document the shipped console writes, against its own church', async () => {
  // THE TEST THE 2026-09-12 DECISION IS ABOUT. Everything above uses `oldSt`, who sits on a roster that HAS a
  // caps map and simply has no entry in it. That is indistinguishable from this at the relay — the STEWARDS_D
  // branch builds an empty Map whichever way the document is shaped, so `byPub.get(pub)` is undefined for
  // both — but "indistinguishable" is an argument, and this is the measurement. `plainChurch`'s roster is
  // written with NO `caps` KEY AT ALL, which is what src/steward.src.js publishes until somebody opens the
  // capability editor. It is the ORDINARY church, and it was the one leaking.
  //
  // ALL FOUR DOCUMENTS, because the short-circuit that caused this widened all four at once and a fix
  // measured on the register alone would leave the other three open.
  //
  // ⚠ THE CLEARANCE AND THE ENVELOPE DELIBERATELY NAME plainMum. Each has a route in of its own — "the person
  // a clearance names", "a pubkey the envelope names" — which is NOT the steward grant and is not what
  // changed. Naming plainSt in either would admit him by that route whatever checkinReader() decided, and the
  // refusal would be unmeasurable. The controls at the foot prove those routes still work.
  const four = [[D.CHECKIN + 'plain-1', 'the register record'],
                [D.CHECKINARRIVAL + P_SESSION + ':' + plainMum.pub, 'the arrival'],
                [D.CHECKINHELPER + P_SESSION, 'the session envelope'],
                [D.CHECKINPERM + plainMum.pub, 'the clearance']];
  // FIRST, THAT HE REALLY IS A STEWARD OF THAT CHURCH — the role-only rota document, the same control the
  // FIXTURE CONTROL test uses and for the same reason: without it, a roster the relay quietly rejected turns
  // every refusal below into the much weaker "an ordinary member is refused".
  const rotaDoc = D.ROTA + 'pr1';
  assert.equal(one(await asks(plainSt, { kinds: [30078], '#d': [rotaDoc] }), rotaDoc), 1,
    'the caps-free roster did not take at all — plainSt is not a steward, so nothing below is evidence');
  assert.deepEqual(await asks(plainMum, { kinds: [30078], '#d': [rotaDoc] }), [],
    're-anchor: an ordinary member of that church reads a stewards-only rota, so the control proves nothing');

  for (const [dtag, what] of four) {
    assert.deepEqual(await asks(plainSt, { kinds: [30078], '#d': [dtag] }), [],
      'A STEWARD ON A ROSTER WITH NO `caps` KEY WAS SERVED ' + what.toUpperCase() + '. This is the document ' +
      'the shipped console writes for every church nobody has configured, so it is the common case and not ' +
      'the edge one. CAP_KEYS.checkin is explicit, so this person has never held the register key and could ' +
      'never open a record — what they were being handed was the cleartext tags and nothing else.');
    assert.equal(one(await asks(plainChurch, { kinds: [30078], '#d': [dtag] }), dtag), 1,
      'THE CHURCH KEY LOST ' + what.toUpperCase() + ' IN ITS OWN CHURCH. Nothing functional may be lost ' +
      'here: the owner keeps everything, and only the delegate who could never open it stops being served.');
  }
  // AND THE TWO ROUTES THAT ARE NOT THE STEWARD GRANT STILL WORK, or the four refusals above would be
  // satisfied by a gate that had closed on everybody.
  assert.equal(one(await asks(plainMum, { kinds: [30078], '#d': [D.CHECKINPERM + plainMum.pub] }),
    D.CHECKINPERM + plainMum.pub), 1,
    'the person a clearance NAMES cannot read their own — her screen has no way to say when it ends');
  assert.equal(one(await asks(plainMum, { kinds: [30078], '#d': [D.CHECKINHELPER + P_SESSION] }),
    D.CHECKINHELPER + P_SESSION), 1,
    'the pubkey the envelope NAMES cannot fetch it — she is granted the register and refused the key');
});
