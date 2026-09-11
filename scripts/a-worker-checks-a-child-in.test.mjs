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
import { fnBody } from './test-slice.mjs';
import { buildHelperGrant, buildCheckinPermission, GRANT_SOURCE, readCheckinHelperCopy } from './checkin-role-source.mjs';
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
    finalizeEvent2: (t, s) => finalizeEvent(t, s),
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
// Same lift, the RELEASE writer (slice C / KNOT 2).
function liftReleaseCheckin(actor, keys) {
  const captured = [];
  const scope = {
    toPub: (x) => x, sk: actor.sk, pub: actor.pub,
    _ckMemKeyGet: (cp, sid) => keys[sid] || '',
    encrypt: (pt, k) => nip44.encrypt(pt, k), _unhex: unhex,
    finalizeEvent2: (t, s) => finalizeEvent(t, s),
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
  for (const who of [sgLead, ada, cara]) await send(w, doc(who, D.MEMBER + church.pub, { joined: now() }));
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
  assert.equal(evt.tags.some(t => t[0] === 'p'), false, 'a guardian was tagged — the worker\'s phone holds no guardian map (KNOT 1)');
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
