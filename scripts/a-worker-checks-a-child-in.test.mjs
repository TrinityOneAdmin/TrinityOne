// A WORKER CHECKS A CHILD IN FROM HER OWN PHONE, AND THE RELAY ADMITS WHAT THE MEMBER APP ACTUALLY EMITS.
// Run: node --test scripts/a-worker-checks-a-child-in.test.mjs
//
// Slice B of reference/SCOPE-CHECKIN-MEMBER-ACTIONS-2026-09-11.md. checkin-helper-write-scope.test.mjs proves
// what the relay's CHECKIN_D branch ADMITS and REFUSES, using events built by hand. That is not the feature:
// "the gate admits a hand-built record" and "the shipped writer produces a record the gate admits" are
// different claims. This lifts Fellowship.writeCheckin out of vendor/fellowship.js — the bundle esbuild ships
// — runs it against a REAL gateway with real AUTH, and proves its output is admitted, readable, and refused
// to the uncleared.
//
// KNOT 1 (the scope doc): a worker holds the SESSION key, not the safeguarding RING key, so she seals ONLY the
// ['ck'] copy and leaves NO ring copy — the ring reads her record through the session key it holds as an
// envelope keeper. And `content` is a NON-EMPTY sentinel, not empty: an empty `content` is the tombstone
// convention (checkinTombstone is `!e.content`), which the relay would refuse (F-D) and the reader would read
// as a deletion.
//
// KNOT (§8): it FAILS LOUD. No session key on the phone → { ok:false } and NOTHING published, never an
// optimistic write the parent would misread as "registered".
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
import { buildHelperGrant, buildCheckinPermission, GRANT_SOURCE, readCheckinHelperCopy,
         checkinGuardianPubs, checkinGuardianCopies, readCheckinGuardianCopy } from './checkin-role-source.mjs';
import { D } from './trinity-doc-types.mjs';

const PORT = 8934;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs; checked free by requireFreePort
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const unhex = h => Uint8Array.from(String(h).match(/.{1,2}/g).map(b => parseInt(b, 16)));
const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

const church = K();
const sgLead = K();       // a steward ticked for safeguarding — a KEEPER of the session envelope
const ada = K();          // cleared, in-window: the worker
const cara = K();         // an ordinary member, never cleared
const gina = K();         // A PARENT — an ordinary member whose SIGNED ARRIVAL is the only lawful source of a guardian p-tag
const SESSION = 'svc-morning';
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
    s.on('message', on); setTimeout(() => res(false), 600);
  });
  s.send(JSON.stringify(['REQ', 'warm', { kinds: [30078], limit: 1 }]));
  assert.equal(await authed, true, 'the relay never sent an AUTH challenge — the write below would be refused for the wrong reason');
  await sleep(100);
  const out = await send(s, e); s.close(); return out;
}
function reqOn(s, sub, f, sk, ms = 700) {
  return new Promise(res => { const out = [];
    const on = d => { const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === sub) out.push(m[2]);
      else if (m[0] === 'AUTH' && sk) s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, sk)])); };
    s.on('message', on); s.send(JSON.stringify(['REQ', sub, f]));
    setTimeout(() => { s.off('message', on); res(out); }, ms); });
}
async function asks(who, filter) {
  const s = await conn();
  await reqOn(s, 'warm', { kinds: [30078], limit: 1 }, who.sk, 350);
  const got = await reqOn(s, 'q' + Math.random().toString(36).slice(2, 7), filter, who.sk);
  s.close(); return got;
}
const doc = (who, d, content, extra = []) => finalizeEvent({
  kind: 30078, created_at: now(), tags: [['d', d], ['t', NET], ...extra],
  content: typeof content === 'string' ? content : JSON.stringify(content) }, who.sk);
const permission = (by, whoPub) => finalizeEvent({
  kind: 30078, created_at: now(), tags: [['d', D.CHECKINPERM + whoPub], ['t', NET], ['church', by.pub], ['person', whoPub]],
  content: JSON.stringify(buildCheckinPermission({ person: whoPub, source: 'steward', lifetime: 'open', from: now() - 86400, until: null })) }, by.sk);
// The session envelope, keepers = church + safeguarding lead (KNOT 1: the ring is a keeper, so it holds the
// session key and reads a worker's ck copy).
const grant = () => {
  const t = now();
  const { doc: body, failed } = buildHelperGrant({ session: SESSION, source: GRANT_SOURCE, lifetime: 'session',
    from: t - 600, until: t + 3600, helpers: [ada.pub], keepers: [church.pub, sgLead.pub], sessionKeyHex: KEY,
    wrap: (p, pl) => nip44.encrypt(pl, nip44.utils.getConversationKey(church.sk, p)) });
  assert.equal(failed.length, 0, 'the envelope could not be wrapped for ' + failed);
  return finalizeEvent({ kind: 30078, created_at: t, tags: [['d', D.CHECKINHELPER + SESSION], ['t', NET], ['church', church.pub], ['session', SESSION]], content: JSON.stringify(body) }, church.sk);
};

// ── THE SHIPPED WRITER, LIFTED. `_publishAny` is stubbed to CAPTURE the event so the test can both inspect it
// and submit it over the socket itself; every other name is the bundle's own. ─────────────────────────────
function liftWriteCheckin(actor, keys /* sid -> hex */) {
  const captured = [];
  const scope = {
    toPub: (x) => x, sk: actor.sk, pub: actor.pub,
    _ckMemKeyGet: (cp, sid) => keys[sid] || '',
    encrypt: (pt, k) => nip44.encrypt(pt, k), _unhex: unhex,
    // STEP 2 of the parent surface: the writer seals a ['gk'] copy per guardian. THE REAL SHARED FUNCTION,
    // not a stub — it is the derivation under test, and `getConversationKey` is the bundle's spelling of the
    // nip44 pair it seals with.
    getConversationKey: (a, b) => nip44.utils.getConversationKey(a, b),
    checkinGuardianCopies,
    finalizeEvent2: (t, s) => finalizeEvent(t, s),
    // THE SHIPPED LOCAL-DAY HELPER, lifted rather than stubbed. `writeCheckin` stamps the record's calendar
    // `date` with it, the console's register filters `r.date === today` against ITS local day, and a stub
    // here could quietly agree with a UTC implementation — which is the bug scripts/calendar-day.test.mjs
    // exists to stop. Lifting it means this harness gets whatever the bundle really does.
    _todayISO: new Function('return (' + stmt(FELLOWSHIP, 'var _todayISO = () =>', '_todayISO')
      .replace(/^var\s+\w+\s*=\s*/, '').replace(/;\s*$/, '') + ');')(),
    CHECKIN_D: D.CHECKIN, NET, relaysForChurch: () => [],
    _publishAny: async (_relays, evt) => { captured.push(evt); return true; },
    String, Date, Math, JSON, Number, Array, Object, Boolean, RegExp, console,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the shipped writeCheckin needs a stub for ' + String(k)); },
  });
  const api = new Function('scope', 'with (scope) { return ({ ' +
    fnBody(FELLOWSHIP, 'async writeCheckin(churchNpub, rec) {', 'writeCheckin') + ' }); }')(proxy);
  return { writeCheckin: api.writeCheckin, captured };
}
// Same lift, the PARENT'S ARRIVAL writer (step 1 of the parent surface). No session key and no key material
// of any kind: she seals to her OWN key, which is why the only crypto stub it needs is the conversation key
// with herself.
function liftWriteArrival(actor) {
  const captured = [];
  const scope = {
    toPub: (x) => x, sk: actor.sk, pub: actor.pub,
    encrypt: (pt, k) => nip44.encrypt(pt, k),
    getConversationKey: (a, b) => nip44.utils.getConversationKey(a, b),
    finalizeEvent2: (t, sec) => finalizeEvent(t, sec),
    CHECKINARRIVAL_D: D.CHECKINARRIVAL, NET, relaysForChurch: () => [],
    _publishAny: async (_relays, evt) => { captured.push(evt); return true; },
    String, Date, Math, JSON, Number, Array, Object, Boolean, RegExp, console,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the shipped writeArrival needs a stub for ' + String(k)); },
  });
  const api = new Function('scope', 'with (scope) { return ({ ' +
    fnBody(FELLOWSHIP, 'async writeArrival(churchNpub, rec) {', 'writeArrival') + ' }); }')(proxy);
  return { writeArrival: api.writeArrival, captured };
}
// Same lift, the RELEASE writer (slice C / KNOT 2).
function liftReleaseCheckin(actor, keys) {
  const captured = [];
  const scope = {
    toPub: (x) => x, sk: actor.sk, pub: actor.pub,
    _ckMemKeyGet: (cp, sid) => keys[sid] || '',
    encrypt: (pt, k) => nip44.encrypt(pt, k), _unhex: unhex,
    // STEP 2: a release now carries the guardian's ['p'] tag and their ['gk'] copy, so a parent learns their
    // child was checked out from a document they can read. Both shared functions are the real ones.
    getConversationKey: (a, b) => nip44.utils.getConversationKey(a, b),
    checkinGuardianPubs, checkinGuardianCopies,
    finalizeEvent2: (t, s) => finalizeEvent(t, s),
    // THE SHIPPED LOCAL-DAY HELPER, lifted rather than stubbed. `writeCheckin` stamps the record's calendar
    // `date` with it, the console's register filters `r.date === today` against ITS local day, and a stub
    // here could quietly agree with a UTC implementation — which is the bug scripts/calendar-day.test.mjs
    // exists to stop. Lifting it means this harness gets whatever the bundle really does.
    _todayISO: new Function('return (' + stmt(FELLOWSHIP, 'var _todayISO = () =>', '_todayISO')
      .replace(/^var\s+\w+\s*=\s*/, '').replace(/;\s*$/, '') + ');')(),
    CHECKIN_D: D.CHECKIN, NET, relaysForChurch: () => [],
    _publishAny: async (_relays, evt) => { captured.push(evt); return true; },
    String, Date, Math, JSON, Number, Array, Object, Boolean, RegExp, console,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the shipped releaseCheckin needs a stub for ' + String(k)); },
  });
  const api = new Function('scope', 'with (scope) { return ({ ' +
    fnBody(FELLOWSHIP, 'async releaseCheckin(churchNpub, rec) {', 'releaseCheckin') + ' }); }')(proxy);
  return { releaseCheckin: api.releaseCheckin, captured };
}

async function boot() {
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub) } });
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(150); }
  throw new Error('the gateway never came up on ' + PORT);
}

before(async () => {
  await requireFreePort(PORT, 'a-worker-checks-a-child-in.test.mjs (it spawns its own gateway)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-worker-checkin-'));
  await boot();
  w = await conn();
  for (const who of [sgLead, ada, cara, gina]) await send(w, doc(who, D.MEMBER + church.pub, { joined: now() }));
  await send(w, doc(church, D.STEWARDS + church.pub, { pubkeys: [sgLead.pub], caps: { [sgLead.pub]: ['safeguarding'] } }));
  await send(w, doc(church, D.GUARDIANS + church.pub, { links: {} }));
  await sleep(200);
  await send(w, permission(church, ada.pub));
  await send(w, grant());
  await sleep(400);
});
after(async () => { try { w.close(); } catch {} try { relay.kill('SIGKILL'); } catch {} await sleep(300); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('BASELINE: the shipped writer, run as an in-window helper, emits a record the RELAY ADMITS', async () => {
  const { writeCheckin, captured } = liftWriteCheckin(ada, { [SESSION]: KEY });
  const res = await writeCheckin(church.pub, { session: SESSION, childName: 'Ada Okonkwo', code: '7788' });
  assert.equal(res.ok, true, 'the shipped writer refused a cleared, in-window helper: ' + JSON.stringify(res));
  assert.equal(captured.length, 1, 'writeCheckin returned ok but published nothing');
  const evt = captured[0];
  const tag = (n) => (evt.tags.find(t => t[0] === n) || [])[1];

  // THE SHAPE THE GATE REQUIRES, off the shipped event.
  assert.equal(tag('session'), SESSION, 'the record is not tagged with her session — the gate refuses it and the reader cannot route it');
  assert.equal(tag('church'), church.pub, 'no church tag, so namedChurch cannot resolve the owner');
  assert.equal(tag('enc'), '2', 'the additive marker is missing');
  assert.ok(String(tag('d')).startsWith(D.CHECKIN), 'the d-tag is not a check-in address');
  assert.ok(tag('ck'), 'NO ck COPY — she holds the session key and must seal one');
  assert.equal(evt.tags.some(t => t[0] === 'p'), false, 'a guardian was tagged for a check-in nobody claimed — the worker\'s phone holds no guardian map (KNOT 1) and may only ever name a pubkey a SIGNED ARRIVAL delivered');
  // ⚠ content MUST BE NON-EMPTY or the relay refuses it as a TOMBSTONE and the reader deletes the row.
  assert.notEqual(evt.content, '', 'content is EMPTY — read as a tombstone (F-D) by the relay and the reader');
  assert.equal(nip44.decrypt(evt.content, unhex(KEY)), JSON.stringify({ enc: 2 }), 'the sentinel is not the expected non-body marker under the session key');
  // The ck copy opens with the session key — her own phone and the ring (via its keeper slot) read it.
  const body = readCheckinHelperCopy(evt.tags, KEY, (ct, k) => nip44.decrypt(ct, unhex(k)));
  assert.ok(body && body.childName === 'Ada Okonkwo' && body.code === '7788', 'the shipped ck copy does not open with the session key');
  assert.equal(body.out, null, 'a check-in is not a checkout; out must be null');

  // THE WEBSOCKET DOOR admits her own signed event, and it lands on the box.
  const [ok, msg] = await publishAs(ada, evt);
  assert.equal(ok, true, 'THE RELAY REFUSED THE EVENT THE MEMBER APP ACTUALLY EMITS — writer and gate disagree: ' + msg);
  await sleep(300);
  const copies = await asks(church, { kinds: [30078], '#d': [tag('d')] });
  assert.ok(copies.some(e => e.id === evt.id), 'the admitted record is not on the box');
});

test('a SAFEGUARDING lead — a keeper of the session envelope — can OPEN a worker-written record (KNOT 1)', async () => {
  // The worker sealed no ring copy. The lead reads her record because she holds the session key from her
  // keeper slot in the envelope, and opens the ck copy with it. This is the whole of KNOT 1, end to end.
  const { writeCheckin, captured } = liftWriteCheckin(ada, { [SESSION]: KEY });
  await writeCheckin(church.pub, { session: SESSION, childName: 'Bao Nguyen', code: '3355' });
  const evt = captured[0];
  await publishAs(ada, evt);
  await sleep(200);
  // The lead unwraps HER OWN keeper slot from the envelope to recover the session key.
  const envs = await asks(sgLead, { kinds: [30078], '#d': [D.CHECKINHELPER + SESSION] });
  assert.equal(envs.length, 1, 'the safeguarding lead was not served the session envelope she is a keeper of');
  const env = JSON.parse(envs[0].content);
  const wrapped = env.keys[sgLead.pub];
  assert.ok(wrapped, 'the lead has no keeper slot in the envelope — the mint did not wrap the ring in');
  const sessionKey = nip44.decrypt(wrapped, nip44.utils.getConversationKey(sgLead.sk, church.pub));
  assert.match(sessionKey, /^[0-9a-f]{64}$/, 'the lead could not recover the session key from her slot');
  // The lead is SERVED the worker's record…
  const recs = await asks(sgLead, { kinds: [30078], '#d': [(evt.tags.find(t => t[0] === 'd') || [])[1]] });
  const mine = recs.find(e => e.id === evt.id);
  assert.ok(mine, 'the safeguarding lead was not served the worker\'s record');
  // …and OPENS it with the session key, though the worker sealed no copy to the ring.
  const body = readCheckinHelperCopy(mine.tags, sessionKey, (ct, k) => nip44.decrypt(ct, unhex(k)));
  assert.ok(body && body.childName === 'Bao Nguyen' && body.code === '3355',
    'THE SAFEGUARDING LEAD CANNOT READ A WORKER-WRITTEN RECORD. KNOT 1 is broken: her keeper slot did not open the ck copy.');
});

test('the shipped writer FAILS LOUD with no session key on the phone, and emits NOTHING (§8)', async () => {
  const { writeCheckin, captured } = liftWriteCheckin(cara, {} /* holds no key */);
  const res = await writeCheckin(church.pub, { session: SESSION, childName: 'Ada Okonkwo', code: '7788' });
  assert.equal(res.ok, false, 'a phone holding no session key was told the check-in succeeded');
  assert.equal(res.reason, 'no-key', 'the refusal reason is not the honest one: ' + JSON.stringify(res));
  assert.equal(captured.length, 0,
    'A RECORD WAS PUBLISHED OPTIMISTICALLY WITHOUT A KEY. §8: fail LOUD, never accept it and reconcile later.');
});

test('the shipped writer refuses a check-in with no name and no session', async () => {
  const { writeCheckin, captured } = liftWriteCheckin(ada, { [SESSION]: KEY });
  assert.equal((await writeCheckin(church.pub, { session: SESSION, childName: '   ' })).reason, 'no-name', 'a nameless child was checked in');
  assert.equal((await writeCheckin(church.pub, { childName: 'Ada' })).reason, 'no-session', 'a record with no session — unroutable — was written');
  assert.equal(captured.length, 0, 'a refused check-in still published something');
});

test('the relay REFUSES the shipped record when an UNCLEARED member signs it', async () => {
  // Being able to CRAFT the shape is not being admitted to write it. Take the exact event the shipped writer
  // produced, re-sign it as an uncleared member, submit → refused by checkinHelperOf.
  const { writeCheckin, captured } = liftWriteCheckin(ada, { [SESSION]: KEY });
  await writeCheckin(church.pub, { session: SESSION, childName: 'Ada Okonkwo', code: '7788' });
  const src = captured[0];
  const resigned = finalizeEvent({ kind: 30078, created_at: now(), tags: src.tags, content: src.content }, cara.sk);
  const [ok, msg] = await publishAs(cara, resigned);
  assert.equal(ok, false, 'an UNCLEARED member published into the children\'s register by re-signing a helper\'s record shape');
  assert.match(String(msg), /blocked|invalid|restricted|not/i, 'refused, but not as a policy refusal: ' + msg);
});

test('the shipped releaseCheckin (slice C) emits a SEPARATE release document the relay ADMITS', async () => {
  // KNOT 2: a checkout is its own fresh checkin: address with a ['rel'] tag — never a rewrite of the church's
  // record (F-B). It rides the same helper gate: fresh address, so checkinChurchHolds and the session-conflict
  // check both pass, and checkinHelperOf admits her.
  const { releaseCheckin, captured } = liftReleaseCheckin(ada, { [SESSION]: KEY });
  const res = await releaseCheckin(church.pub, { session: SESSION, rel: 'ci-somechild', manual: false });
  assert.equal(res.ok, true, 'the shipped release writer refused a cleared, in-window helper: ' + JSON.stringify(res));
  const evt = captured[0];
  const tag = (n) => (evt.tags.find(t => t[0] === n) || [])[1];
  assert.equal(tag('rel'), 'ci-somechild', 'the release does not carry the ["rel"] tag the reader folds on');
  assert.equal(tag('session'), SESSION, 'the release is not tagged with her session');
  assert.ok(String(tag('d')).startsWith(D.CHECKIN) && tag('d') !== D.CHECKIN + 'ci-somechild',
    'the release wrote AT the check-in\'s own address — a rewrite F-B refuses, not a separate document');
  assert.notEqual(evt.content, '', 'empty content — the relay reads it as a tombstone');
  const body = readCheckinHelperCopy(evt.tags, KEY, (ct, k) => nip44.decrypt(ct, unhex(k)));
  assert.ok(body && body.rel === 'ci-somechild' && Number.isFinite(body.out) && body.manual === false && body.by === ada.pub,
    'the release body is not the { rel, out, manual, by } the reader folds');
  // The websocket door admits it.
  const [ok, msg] = await publishAs(ada, evt);
  assert.equal(ok, true, 'THE RELAY REFUSED THE RELEASE THE MEMBER APP EMITS: ' + msg);
});

test('a MANUAL release is admitted and marked manual; and the relay REFUSES a release from an uncleared member', async () => {
  const { releaseCheckin, captured } = liftReleaseCheckin(ada, { [SESSION]: KEY });
  await releaseCheckin(church.pub, { session: SESSION, rel: 'ci-x', manual: true });
  const evt = captured[0];
  const body = readCheckinHelperCopy(evt.tags, KEY, (ct, k) => nip44.decrypt(ct, unhex(k)));
  assert.equal(body.manual, true, 'a manual release was not marked manual — §7 requires it recorded distinctly');
  assert.equal((await publishAs(ada, evt))[0], true, 'the manual release was refused by the relay');
  // An uncleared member cannot release a child: re-sign the shape and submit.
  const resigned = finalizeEvent({ kind: 30078, created_at: now(), tags: evt.tags, content: evt.content }, cara.sk);
  const [ok, msg] = await publishAs(cara, resigned);
  assert.equal(ok, false, 'an UNCLEARED member released a child by re-signing a release shape');
  assert.match(String(msg), /blocked|invalid|restricted|not/i, 'refused, but not as a policy refusal: ' + msg);
});

test('the shipped releaseCheckin FAILS LOUD with no key, and refuses a release naming no check-in', async () => {
  const noKey = liftReleaseCheckin(cara, {});
  assert.equal((await noKey.releaseCheckin(church.pub, { session: SESSION, rel: 'ci-x' })).reason, 'no-key', 'a phone with no key was told the release succeeded');
  assert.equal(noKey.captured.length, 0, 'a release was published without a key (§8)');
  const held = liftReleaseCheckin(ada, { [SESSION]: KEY });
  assert.equal((await held.releaseCheckin(church.pub, { session: SESSION })).reason, 'no-rel', 'a release naming no check-in was written — the reader could fold it onto nothing');
  assert.equal(held.captured.length, 0, 'a refused release still published something');
});

// ══════════════ THE GUARDIAN P-TAG — ONLY EVER FROM A SIGNED ARRIVAL ══════════════
// STEP 1 of the parent surface, 2026-09-11. The worker's phone holds NO guardian map: the relay withholds
// minors:/guardians: from ordinary members on purpose, and it must stay that way. So `rec.guardian` is only
// ever the pubkey the worker CONFIRMED off an arrival on her screen — a document the relay admitted only from
// that pubkey's own address (scripts/a-parent-writes-an-arrival-never-a-register-row.test.mjs). The link
// between the tag and the person is therefore a SIGNATURE, never an inference.

test('a check-in FROM AN ARRIVAL p-tags exactly that guardian, and the relay admits it', async () => {
  const { writeCheckin, captured } = liftWriteCheckin(ada, { [SESSION]: KEY });
  const res = await writeCheckin(church.pub, { session: SESSION, childName: 'Milo Henderson', code: '5512', guardian: gina.pub });
  assert.equal(res.ok, true, 'the shipped writer refused a check-in carrying a guardian: ' + JSON.stringify(res));
  const evt = captured[0];
  const ps = evt.tags.filter(t => t[0] === 'p').map(t => t[1]);
  assert.deepEqual(ps, [gina.pub],
    'THE RECORD DOES NOT NAME THE GUARDIAN THE ARRIVAL DELIVERED, or names more than one. Exactly one pubkey, ' +
    'and it is the one the worker confirmed — a second would be a guess about a family this phone has no map ' +
    'for. Tagged: ' + JSON.stringify(ps));
  // …and the sealed body agrees with the cleartext tag, so a reader with a key and a reader without one
  // cannot disagree about who this child belongs to.
  const body = readCheckinHelperCopy(evt.tags, KEY, (ct, k) => nip44.decrypt(ct, unhex(k)));
  assert.deepEqual(body.guardians, [gina.pub], 'the sealed body names a different guardian set from the cleartext tag');
  // THE WEBSOCKET DOOR. A p-tag must not make the record something the gate refuses — a check-in that the
  // relay rejects is a child not in the register.
  const [ok, msg] = await publishAs(ada, evt);
  assert.equal(ok, true, 'THE RELAY REFUSED A WORKER RECORD CARRYING A GUARDIAN TAG — the parent surface writes records the box will not take: ' + msg);
  await sleep(300);
  const d = (evt.tags.find(t => t[0] === 'd') || [])[1];
  assert.ok((await asks(church, { kinds: [30078], '#d': [d] })).some(e => e.id === evt.id), 'the admitted record is not on the box');
  // AND THE NAMED GUARDIAN IS SERVED IT. canRead's CHECKIN_D branch already does this for a p-tagged pubkey;
  // said out loud because it is the ONLY thing the tag buys today. She is handed CIPHERTEXT SHE CANNOT OPEN —
  // there is no guardian-sealed copy, which is STEP 2 and deliberately not built (a `gk` written with no
  // reader is an engine nobody consults). This is delivery, not readability, and must not be described as more.
  const hers = await asks(gina, { kinds: [30078], '#d': [d] });
  assert.equal(hers.length, 1, 'the guardian the record names is not served it at all');
  assert.equal(readCheckinHelperCopy(hers[0].tags, '00'.repeat(32), (ct, k) => nip44.decrypt(ct, unhex(k))), null,
    'a guardian-openable copy exists — that is STEP 2 and is not supposed to be here yet; if it has been ' +
    'built, it needs the non-guardian negative test the scope doc makes mandatory before it ships');
});

test('a MALFORMED guardian is dropped SILENTLY — the child is still checked in', async () => {
  // reference/DOMAIN.md and design §10: nothing in this feature blocks a child reaching the room. A record
  // with no guardian link is a complete record; refusing the whole check-in over a display detail is not.
  // And the spellings matter: an npub, an object or a list would each reach the tag as something the relay's
  // read gate cannot match, and a reader would paint a guardian who is not one.
  for (const bad of ['npub1ginaxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'Sarah Henderson',
                     gina.pub.toUpperCase() + 'ff', {}, [gina.pub], null, 12345]) {
    const { writeCheckin, captured } = liftWriteCheckin(ada, { [SESSION]: KEY });
    const res = await writeCheckin(church.pub, { session: SESSION, childName: 'Yara', code: '1200', guardian: bad });
    assert.equal(res.ok, true, 'A CHILD WAS BLOCKED FROM THE REGISTER over a malformed guardian field: ' + JSON.stringify(bad));
    assert.equal(captured[0].tags.some(t => t[0] === 'p'), false,
      'a malformed guardian reached the record as a p-tag: ' + JSON.stringify(bad) +
      ' — tagged ' + JSON.stringify(captured[0].tags.filter(t => t[0] === 'p')));
    const body = readCheckinHelperCopy(captured[0].tags, KEY, (ct, k) => nip44.decrypt(ct, unhex(k)));
    assert.deepEqual(body.guardians, [], 'the malformed guardian reached the sealed body instead: ' + JSON.stringify(body.guardians));
  }
});

test('a guardian pubkey is normalised to ONE spelling, the one the relay stores', async () => {
  // The relay's read gate matches a p-tag against a 64-hex `authed`. An upper-case copy of the same key is
  // the same person and a different string, so a record carrying one would be served to nobody.
  const { writeCheckin, captured } = liftWriteCheckin(ada, { [SESSION]: KEY });
  await writeCheckin(church.pub, { session: SESSION, childName: 'Milo', code: '9000', guardian: gina.pub.toUpperCase() });
  assert.deepEqual(captured[0].tags.filter(t => t[0] === 'p').map(t => t[1]), [gina.pub],
    'an upper-case guardian pubkey was written as-is, so the relay serves the record to nobody and no reader matches it');
});

// ══════════════ THE SHIPPED ARRIVAL WRITER, AGAINST THE SHIPPED GATE ══════════════
// tests-must-drive-shipped-code: the relay-side file builds its arrivals by hand, which proves the GATE.
// This proves the two agree — that the event the member app actually signs is the event the box admits.
//
// ⚠ THIS PARAGRAPH SAID "NOTHING IN app/ CALLS writeArrival YET" UNTIL 2026-09-12, AND IT IS NO LONGER TRUE.
// §3b of reference/PLAN-CHECKIN-NO-TYPING-2026-09-11.md gave it one: `ctx.checkinArrive` in app/app.jsx,
// called by WereHereCard in app/screens-today.jsx, driven on the rendered screen in
// scripts/a-parent-shows-a-code-instead-of-typing.test.mjs. So the rule-1 hole this paragraph declared is
// closed; what stays true, and is still the reason this file drives the relay end to end, is that the writer
// grants no authority — any member could sign this event by hand, and the gate that matters is the relay's.

test('the shipped writeArrival emits an arrival the RELAY ADMITS, carrying no key material and no child', async () => {
  const { writeArrival, captured } = liftWriteArrival(gina);
  const res = await writeArrival(church.pub, { session: SESSION });
  assert.equal(res.ok, true, 'the shipped writer refused a member announcing her own arrival: ' + JSON.stringify(res));
  assert.equal(captured.length, 1, 'writeArrival returned ok but published nothing');
  const evt = captured[0];
  const tag = (n) => (evt.tags.find(t => t[0] === n) || [])[1];
  assert.equal(tag('d'), D.CHECKINARRIVAL + SESSION + ':' + gina.pub,
    'THE ADDRESS DOES NOT NAME ITS AUTHOR. arrivalIdOk refuses that at all four doors, so this is a writer ' +
    'the gate can never admit. Wrote: ' + tag('d'));
  assert.equal(tag('session'), SESSION, 'no cleartext session tag, so no reader can route it without a key');
  assert.equal(tag('church'), church.pub, 'no church tag, so namedChurch cannot resolve the owner and the gate refuses it');
  assert.ok(!String(tag('d')).startsWith(D.CHECKIN),
    'THE ARRIVAL IS BEING WRITTEN AT A REGISTER ADDRESS. A parent-authored `checkin:` row is the hole F-B closed.');
  // ⚠ content MUST BE NON-EMPTY, or the relay and every reader take it for a TOMBSTONE — the same trap the
  // worker's sentinel exists for, one document over.
  assert.notEqual(evt.content, '', 'content is EMPTY — read as a withdrawal by the relay and by the reader');
  // IT CARRIES NO KEY MATERIAL AND NO CHILD. Opened here ONLY to prove that, and by the author herself — no
  // other party in this product can, which is the point.
  const mine = nip44.decrypt(evt.content, nip44.utils.getConversationKey(gina.sk, gina.pub));
  const body = JSON.parse(mine);
  assert.deepEqual(Object.keys(body), ['at'], 'the arrival body carries something other than a timestamp: ' + mine);
  assert.doesNotMatch(mine, /[0-9a-f]{64}/i, 'something that looks like a key or a pubkey is sealed into the arrival body');
  // THE WEBSOCKET DOOR admits her own signed event, and it lands.
  const [ok, msg] = await publishAs(gina, evt);
  assert.equal(ok, true, 'THE RELAY REFUSED THE ARRIVAL THE MEMBER APP ACTUALLY EMITS — writer and gate disagree: ' + msg);
  await sleep(300);
  assert.ok((await asks(church, { kinds: [30078], '#d': [tag('d')] })).some(e => e.id === evt.id), 'the admitted arrival is not on the box');
});

test('the shipped writeArrival cannot be pointed at somebody else, because it composes the address from its OWN key', async () => {
  // The relay refuses a foreign address anyway. This is the belt: the caller has no parameter that reaches
  // the author half of the address, so the shipped writer can never be the thing that violates the rule.
  const { writeArrival, captured } = liftWriteArrival(gina);
  await writeArrival(church.pub, { session: SESSION, pub: cara.pub, author: cara.pub, guardian: cara.pub });
  assert.equal((captured[0].tags.find(t => t[0] === 'd') || [])[1], D.CHECKINARRIVAL + SESSION + ':' + gina.pub,
    'a caller-supplied field reached the author half of the address');
  assert.equal(captured[0].pubkey, gina.pub, 'the arrival was signed by somebody other than the address names');
});

test('writeArrival refuses to write a sessionless arrival rather than writing an unroutable one', async () => {
  const { writeArrival, captured } = liftWriteArrival(gina);
  assert.equal((await writeArrival(church.pub, {})).reason, 'no-session', 'an arrival naming no session — which the gate refuses and no reader can route — was written');
  assert.equal(captured.length, 0, 'it reported a refusal and published anyway');
});

// ── THE CALENDAR DAY THE RECORD IS STAMPED WITH ───────────────────────────────────────────────────────────
//
// The record's `date` is not decoration: the console's register is `recs.filter(r => r.date === today)`
// (app/stew-dashboard.jsx), compared against the DESK's local day. src/steward.src.js has stamped a local
// `_todayISO()` since it was written; this phone-side writer stamped `new Date().toISOString().slice(0,10)`
// — the UTC day — so a worker checking a child in on a Sunday MORNING in Auckland or Sydney wrote YESTERDAY's
// date, and the child she had just checked in never appeared on the desk's own register. That is the
// 2026-07-24 kids-roll bug returning in the one writer that post-dates the guard, and scripts/calendar-day.
// test.mjs (a source scan) was red on this branch because of it.
//
// A scan is not a point-of-use proof, so this drives the SHIPPED writer under a real timezone and reads the
// date off the event. It is deterministic all year round without faking the clock: at every instant, at
// least one of UTC+14 and UTC-12 sits on a different calendar day from UTC, so one of the two always makes
// "local" and "UTC" disagree — and that is the case the bug lived in.
test('the record is stamped with the LOCAL calendar day, or a morning check-in vanishes from the desk', async () => {
  const was = process.env.TZ;
  try {
    const local = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    let tz = null;
    for (const cand of ['Pacific/Kiritimati', 'Etc/GMT+12']) {     // UTC+14 and UTC-12, the two extremes
      process.env.TZ = cand;
      if (local() !== new Date().toISOString().slice(0, 10)) { tz = cand; break; }
    }
    assert.ok(tz, 're-anchor: neither UTC+14 nor UTC-12 differs from UTC right now, which should be impossible');
    const utcDay = new Date().toISOString().slice(0, 10);
    const localDay = local();
    const { writeCheckin, captured } = liftWriteCheckin(ada, { [SESSION]: KEY });
    await writeCheckin(church.pub, { childName: 'A Child', code: '4821', session: SESSION });
    assert.equal(captured.length, 1, 'the shipped writer published ' + captured.length + ' documents, not one');
    const body = JSON.parse(nip44.decrypt((captured[0].tags.find(t => t[0] === 'ck') || [])[1], unhex(KEY)));
    assert.equal(body.date, localDay,
      'THE CHECK-IN WAS STAMPED WITH THE WRONG CALENDAR DAY in ' + tz + ': the record says ' + body.date +
      ' and the desk beside her believes it is ' + localDay + '. The console filters its register on exactly ' +
      'this field, so the child she just checked in is not on the list — and neither is the pickup code.');
    assert.notEqual(body.date, utcDay,
      're-anchor: the local day and the UTC day agree in ' + tz + ', so this assertion proved nothing');
  } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
});

// ── "THAT DIDN'T SEND" MUST NOT BE SAID ABOUT A WRITE THAT SENT ───────────────────────────────────────────
//
// Device finding F1, reference/DEVICE-VERIFICATION-two-phone-2026-09-11.md: writeArrival reported
// `{ok:false}` TWICE on the Pixel over writes that had SUCCEEDED. `_publishAny` throws whenever no relay
// acknowledges inside WEDGE_ACK_MS, and this writer flattened every throw into one "publish-failed" — so a
// slow ack over the Funnel, or a socket closing after the event was already on the wire, read as a refusal.
//
// That is worse than a silent failure. A parent is told their arrival did not send, walks to the desk and
// says so, and the arrival is already on the relay and about to appear on the worker's screen. The member is
// sent to undo something that worked.
//
// So there are THREE answers now, and these tests pin all three. The classification itself is tested one
// level down, against the SHIPPED `_publishAny` and the SHIPPED regexes, so nothing here rests on a test's
// own opinion of what a refusal looks like.
function liftArrivalWithPublish(actor, publishImpl) {
  const scope = {
    toPub: (x) => x, sk: actor.sk, pub: actor.pub,
    encrypt: (pt, k) => nip44.encrypt(pt, k),
    getConversationKey: (a, b) => nip44.utils.getConversationKey(a, b),
    finalizeEvent2: (t, sec) => finalizeEvent(t, sec),
    CHECKINARRIVAL_D: D.CHECKINARRIVAL, NET, relaysForChurch: () => ['wss://one.example/relay'],
    _publishAny: publishImpl,
    String, Date, Math, JSON, Number, Array, Object, Boolean, RegExp, console,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the shipped writeArrival needs a stub for ' + String(k)); },
  });
  return new Function('scope', 'with (scope) { return ({ ' +
    fnBody(FELLOWSHIP, 'async writeArrival(churchNpub, rec) {', 'writeArrival') + ' }); }')(proxy).writeArrival;
}

test('a relay that READ the arrival and said no is reported as a refusal', async () => {
  const w = liftArrivalWithPublish(gina, async () => { const e = new Error('blocked: not a member'); e.refused = true; throw e; });
  const res = await w(church.pub, { session: SESSION });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'refused',
    'a settled refusal was not reported as one, so a parent cannot be told the difference between "the church ' +
    'will not take this" and "we could not reach anyone"');
});

test('AN ACK THAT NEVER CAME IS "UNCONFIRMED", NEVER "it did not send" — the defect measured on the Pixel', async () => {
  const w = liftArrivalWithPublish(gina, async () => { throw new Error('publish timed out'); });
  const res = await w(church.pub, { session: SESSION });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'unconfirmed',
    'A TIMED-OUT ACKNOWLEDGEMENT IS REPORTED AS A FAILED WRITE. The event is signed and on the wire and may ' +
    'already be on the worker\'s screen. Measured twice on the Pixel, 2026-09-11: the parent is sent to the ' +
    'desk to report a failure that did not happen.');
  assert.ok(res.id, 'the unconfirmed answer carries no address, so a caller cannot even say which arrival it was');
});

test('a socket that closed mid-publish is unconfirmed too — it is not a verdict', async () => {
  // The device's SECOND message. It is a rejected promise, so no relay ever spoke: nobody refused and nobody
  // accepted. The event may well have landed.
  const w = liftArrivalWithPublish(gina, async () => { throw new Error('relay connection closed'); });
  assert.equal((await w(church.pub, { session: SESSION })).reason, 'unconfirmed',
    'a closed socket is being read as the church refusing a family');
});

test('and a write that landed still says so', async () => {
  const w = liftArrivalWithPublish(gina, async () => true);
  const res = await w(church.pub, { session: SESSION });
  assert.equal(res.ok, true);
});

// ── THE CLASSIFICATION ITSELF, ON THE SHIPPED FUNCTION ────────────────────────────────────────────────────
// `_publishAny` decides `refused`, and it is the half a test could most easily fake. So this lifts the REAL
// one out of vendor/fellowship.js together with the REAL _classify and the REAL regexes, and stubs only the
// world — the pool, the relay filter, the wedge detector.
function liftPublishAny(settle /* array of {status,value|reason} */) {
  const noted = [];
  const scope = {
    _dedupeRelays: (l) => l,
    _netRelays: (l) => l,
    churchRelaysRaw: () => [],
    NO_NETWORK_RELAY: 'no-network-relay',
    WEDGE_ACK_MS: 8000,
    _wedgeKey: (u) => u,
    _noteSendResult: (u, o) => noted.push(o),
    pool: { relays: new Map(), publish: () => settle.map(s => (s.status === 'fulfilled' ? Promise.resolve(s.value) : Promise.reject(new Error(s.reason)))) },
    Promise, Error, String, Array, Object, Boolean, Number, Math, JSON, console,
  };
  // THE REAL REGEXES AND THE REAL CLASSIFIER. A test's own copy of "what counts as a refusal" would be
  // exactly the stub that answers the question it was written to ask, so all four are lifted out of the
  // shipped bundle. `_classify` is built with the regexes as plain PARAMETERS rather than through the scope
  // Proxy below: fnBody returns a whole `function` declaration, and a declaration inside a `with` block is
  // shadowed by the Proxy (whose `has` claims every name not already global), so the function could never
  // see itself.
  const rx = (name, anchor) => new Function('return ' + stmt(FELLOWSHIP, anchor, name).replace(/^var\s+\w+\s*=\s*/, '').replace(/;\s*$/, ''))();
  scope._PUB_FAILED = rx('_PUB_FAILED', 'var _PUB_FAILED =');
  scope._PUB_REFUSED = rx('_PUB_REFUSED', 'var _PUB_REFUSED =');
  const _PUB_SILENT = rx('_PUB_SILENT', 'var _PUB_SILENT =');
  scope._classify = new Function('_PUB_FAILED', '_PUB_SILENT',
    fnBody(FELLOWSHIP, 'function _classify(r) {', '_classify') + ' return _classify;')(scope._PUB_FAILED, _PUB_SILENT);
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the shipped _publishAny needs a stub for ' + String(k)); },
  });
  const api = new Function('scope', 'with (scope) { ' +
    fnBody(FELLOWSHIP, 'function _publishAny(relays, evt) {', '_publishAny') + ' return _publishAny; }')(proxy);
  return { publishAny: api, noted };
}

test('SHIPPED: `refused` is set only when a relay actually answered no', async () => {
  const { publishAny } = liftPublishAny([{ status: 'fulfilled', value: 'blocked: not a member' }]);
  const err = await publishAny(['wss://a/relay'], {}).then(() => null, (e) => e);
  assert.ok(err, 're-anchor: a refusal resolved successfully');
  assert.equal(err.refused, true, 'a relay said "blocked:" and the caller is not told it was a settled refusal');
});

test('SHIPPED: a timeout is NOT a refusal', async () => {
  const { publishAny } = liftPublishAny([{ status: 'rejected', reason: 'publish timed out' }]);
  const err = await publishAny(['wss://a/relay'], {}).then(() => null, (e) => e);
  assert.equal(err.refused, false,
    'a timed-out acknowledgement is being reported as the relay refusing the event — the Pixel defect, one ' +
    'level down from writeArrival');
});

test('SHIPPED: "connection failure" is NOT a refusal — the socket never opened, so nobody refused anything', async () => {
  // It matches _PUB_FAILED and must NOT match _PUB_REFUSED. That one-word difference is the whole reason
  // _PUB_REFUSED exists as a separate pattern rather than reusing _PUB_FAILED.
  const { publishAny } = liftPublishAny([{ status: 'fulfilled', value: 'connection failure' }]);
  const err = await publishAny(['wss://a/relay'], {}).then(() => null, (e) => e);
  assert.equal(err.refused, false,
    'an unreachable relay is being reported to a member as the church refusing them');
});

test('SHIPPED: ONE relay refusing among several silent ones still counts as refused', async () => {
  // The pilot ships two addresses to one box, so a mixed outcome is the ordinary case, not an exotic one.
  // The old code took the FIRST message it found; this asks whether ANY relay refused.
  const { publishAny } = liftPublishAny([
    { status: 'rejected', reason: 'publish timed out' },
    { status: 'fulfilled', value: 'invalid: bad address' },
  ]);
  const err = await publishAny(['wss://a/relay', 'wss://b/relay'], {}).then(() => null, (e) => e);
  assert.equal(err.refused, true,
    'a relay refused this event and the caller was told nobody answered, because the first relay in the list ' +
    'happened to be the silent one');
});
