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
// IT DOES NOT PROVE EITHER OF THEM CAN OPEN IT, and that must not be glossed (CLAUDE.md rule 4). Measured
// while writing this file, and recorded in the scope note for slice 3:
//
//   • `publishCheckin` seals through `encSeal('checkin', …)`, which uses the SAFEGUARDING CAPABILITY KEY
//     ring (`trinityone/checkinkey:`, wrapped to the church and its safeguarding stewards). It does NOT use
//     the session key from `checkinhelper:`. So a helper handed this ciphertext holds the wrong key for it.
//   • a GUARDIAN holds neither key, so a parent served their own child's record can open nothing at all.
//   • `helperKeyFor()` — the function that hands a helper their session key — still has no product caller
//     anywhere in src/ or app/.
//
// The tags were necessary and are not sufficient. Which key a check-in record should be sealed under is a
// design decision for slice 3 (the member-app reader), not something to invent inside a tag fix, and the
// tests below therefore assert DELIVERY and say nothing about decryption.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { requireFreePort } from './test-ports.mjs';
import { fnBody, stmt } from './test-slice.mjs';
import { buildHelperGrant, buildCheckinPermission, GRANT_SOURCE } from './checkin-role-source.mjs';
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

const S_NOW = 'svc-now', S_LAST = 'svc-last';
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
    // THE REGISTER'S OWN KEY RING, as capKeyRing('checkin') would hold it. This is the fixture that makes
    // the sealing gap visible: it is not SESSION_KEY, and nothing here can make it be.
    _capState: { checkin: { ring: [SG_CAP_KEY], rev: 1, docKeys: {} }, finance: { ring: [], rev: 0, docKeys: {} } },
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
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub) } });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  w = await conn();
  for (const who of [sgLead, ada, ben, gina, hank, cara]) await send(w, doc(who, D.MEMBER + church.pub, { joined: now() }));
  await send(w, doc(church, D.STEWARDS + church.pub, { pubkeys: [sgLead.pub], caps: { [sgLead.pub]: ['safeguarding'] } }));
  await send(w, doc(church, D.GUARDIANS + church.pub, { links: {} }));
  for (const who of [ada, ben]) await send(w, permission(who));
  await sleep(150);
  const t = now();
  await send(w, grant(S_NOW, [ada.pub], t - 600, t + 3600, SESSION_KEY));
  await send(w, grant(S_LAST, [ben.pub], t - 8 * 3600, t - 5 * 3600, LAST_KEY));
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
  assert.deepEqual(tag('enc'), ['1'], 're-anchor: the record stopped declaring itself encrypted');
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
