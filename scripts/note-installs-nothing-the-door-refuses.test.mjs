// WHAT accept() REFUSES, note() MUST NOT INSTALL.
// Run: node --test scripts/note-installs-nothing-the-door-refuses.test.mjs
//
// THE GAP THIS FILE EXISTS TO CLOSE, and it is wider than check-in. Every relay test in this repo drives the
// LIVE WEBSOCKET, so everything they publish has been through accept() first; and the `restart()` helper that
// several of them use only replays documents accept() had already blessed. **Nothing anywhere drove note()
// with a document accept() refuses.** Two paths into this relay do exactly that, every day:
//
//   • /import — the restore/clone route, which calls store.put() and then hydrateMaps(), and never accept().
//     scripts/import-applies-policy.test.mjs pins that a restore must not LOSE anything, and is right to; this
//     file is its missing other half, which is that a restore must not GAIN anything either.
//   • relay-to-relay sync — both paths call note(e) directly (the cursor pull and the negentropy reconcile).
//
// So a rule enforced only at the door is a rule with two doors in behind it. Measured on 2026-09-09/10, one
// document at a time on a fresh relay: a `checkinperm:` d-tag spelled in UPPERCASE hex, a session id carrying
// a path segment, and a 300-character session id were each REFUSED LIVE, ACCEPTED THROUGH /import, SERVED THE
// SESSION KEY, ACCEPTED REGISTER WRITES, AND SURVIVED A RESTART. Bounded — both ingests require
// CHURCH_PUBS.has(e.pubkey), so none of it was a member or operator escalation — and still wrong, because two
// spellings of one suffix are two addressable documents writing one map entry: the church saw the uppercase
// clearance in its list, the person it named could not read their own clearance (canRead pins the lowercase
// form), and the console's lowercase tombstone could never remove it.
//
// AND WHY A READ GATE DID NOT SAVE IT. import-applies-policy.test.mjs says "a read gate is bypassed by none of
// them, because every delivery goes through it". That is true of the kind-4 case it was written about, where
// canRead() re-derives its answer FROM THE EVENT. It is NOT true here: canRead()'s `checkinhelper:` branch
// reads CHECKIN_HELPERS and calls checkinPermitted(), both of which are maps note() populates — so the read
// gate inherits whatever the looser door installed. A read gate is only a backstop when it recomputes.
//
// THE ASSERTIONS ARE REFUSALS, and the first test is the re-anchor that stops them being vacuous: /import
// genuinely does install a well-formed clearance and envelope, or every "installed nothing" below would pass
// against a route that installs nothing at all.
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

const PORT = 8903;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const unhex = h => Uint8Array.from(String(h).match(/.{1,2}/g).map(b => parseInt(b, 16)));

const church = K();
// ONE CAST MEMBER PER SPELLING, so no test can be answered by a clearance another test installed. `ok` is the
// control; every other name is a person a MALFORMED document tried to clear, and the assertion is that they
// were not.
const ok = K();        // a well-formed clearance, published live. The re-anchor.
const upper = K();     // cleared by a d-tag spelled in UPPERCASE hex
const dots = K();      // named on an envelope whose session id carries a path segment
const longs = K();     // named on an envelope with a 300-character session id
const gina = K();      // a guardian, so a register record has somebody to hang off

const S_OK = 'svc-ok';
// A PATH SEGMENT, not merely a dot. `.` is inside the charset accept() allows, so `svc..svc` is a legal session
// id at BOTH doors and would prove nothing; the shape the door refuses and the bare slice did not is one
// carrying a separator, so that is what is measured.
const S_DOTS = 'svc/../secret';
const S_LONG = 'x'.repeat(300);
const KEY_OK = '11'.repeat(32), KEY_DOTS = '22'.repeat(32), KEY_LONG = '33'.repeat(32), KEY_UP = '44'.repeat(32);
const S_UP = 'svc-up';

let relay, dataDir, w;
// THE ONE FIXTURE WHOSE EVENT ID IS NEEDED LATER, built once so the kind-5 below names the document that was
// really stored. Re-signing it with a fresh created_at would produce a different id, and the delete would then
// silently name nothing — which is the shape of a test that passes over a hole.
let OK_PERM;

const conn = () => new Promise((r, j) => { const s = new WebSocket(WS_URL); s.on('open', () => r(s)); s.on('error', j); });
const send = (s, e) => new Promise(res => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { s.off('message', on); res([m[2], m[3] || '']); } };
  s.on('message', on); s.send(JSON.stringify(['EVENT', e]));
  setTimeout(() => { s.off('message', on); res([null, 'no OK in time']); }, 2500);
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
// Ask AS somebody, on a socket of their own so a stale AUTH can never make a refusal look like a grant.
async function asks(who, filter) {
  const s = await conn();
  await req(s, 'warm', { kinds: [30078], limit: 1 }, who.sk, 300);
  const got = await req(s, 'q' + Math.random().toString(36).slice(2, 7), filter, who.sk);
  s.close();
  return got;
}

const doc = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(),
  tags: [['d', d], ['t', NET], ...extra], content: typeof content === 'string' ? content : JSON.stringify(content) }, who.sk);

// The two documents under test, built by the SHIPPED builders — never restated here, so a test cannot be
// asserting against its own idea of what a clearance is. `dTag` is passed separately BECAUSE that is the whole
// subject: the body is always well-formed and only the suffix is bent.
const permissionAt = (dTag, who, opts = {}) => finalizeEvent({ kind: 30078, created_at: opts.at || now(),
  tags: [['d', dTag], ['t', NET], ['church', church.pub], ['person', who.pub]],
  content: JSON.stringify(buildCheckinPermission({ person: who.pub, source: 'steward', lifetime: 'open',
    from: (opts.from != null ? opts.from : now() - 86400), until: null })) }, church.sk);

const grantAt = (dTag, session, helpers, from, until, key) => {
  const { doc: body, failed } = buildHelperGrant({ session, source: GRANT_SOURCE, lifetime: 'session',
    from, until, helpers, keepers: [church.pub], sessionKeyHex: key,
    wrap: (p, pl) => nip44.encrypt(pl, nip44.utils.getConversationKey(church.sk, p)) });
  assert.deepEqual(failed, [], 'the fixture could not wrap the session key to somebody — the envelope would be empty');
  return finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', dTag], ['t', NET], ['church', church.pub], ['session', session]],
    content: JSON.stringify(body) }, church.sk);
};
const checkin = (who, id, session, guardianPub, key) => doc(who, D.CHECKIN + id,
  nip44.encrypt(JSON.stringify({ id, childName: 'A Child', code: '4821' }), unhex(key)),
  [['church', church.pub], ['session', session], ...(guardianPub ? [['p', guardianPub]] : [])]);

// NIP-98 proof bound to /import, signed by the church key.
const auth = (path) => 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({
  kind: 27235, created_at: now(), content: '',
  tags: [['u', `http://127.0.0.1:${PORT}${path}`], ['method', 'POST'], ['church', church.pub]],
}, church.sk))).toString('base64');

// THE DOOR ACCEPT() IS NOT BEHIND. Returns the relay's own count, so a test can tell "refused by the import"
// from "accepted and then ignored" — a distinction the whole file turns on.
const doImport = async (events) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/import`, {
    method: 'POST', headers: { Authorization: auth('/import'), 'Content-Type': 'application/x-ndjson' },
    body: events.map(e => JSON.stringify(e)).join('\n'),
  });
  const body = await r.json();
  await sleep(900);   // hydrateMaps() runs on setImmediate AFTER the response, and it is the whole point
  return { status: r.status, body };
};

async function boot() {
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub) } });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
}
// REBOOT ON THE SAME DATA DIRECTORY. Every stored document replays through note() with accept() nowhere in the
// path, so "what this relay believes" and "what it has written down" are two different answers and a rule that
// holds only in the first of them expires at the next restart. This relay restarts itself.
async function restart() {
  try { w && w.close(); } catch {}
  await new Promise(r => { relay.on('exit', r); try { relay.kill('SIGKILL'); } catch { r(); } });
  await sleep(300);
  await boot();
  await sleep(700);
  w = await conn();
}

// CAN THIS PERSON OPEN THIS SESSION? The one observable that needs BOTH halves of the conjunction to have been
// installed: canRead()'s checkinhelper: rule requires the asker to be named in CHECKIN_HELPERS *and*
// checkinPermitted() to be true, and both of those maps are populated by note() alone.
const opensSession = async (who, session) =>
  (await asks(who, { kinds: [30078], '#d': [D.CHECKINHELPER + session] })).length > 0;

before(async () => {
  await requireFreePort(PORT, 'note-installs-nothing-the-door-refuses.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-note-'));
  await boot();
  w = await conn();
  for (const who of [ok, upper, dots, longs, gina]) await send(w, doc(who, D.MEMBER + church.pub, { joined: now() }));
  await sleep(200);
});
after(() => { try { w && w.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── THE RE-ANCHOR: /import REALLY DOES INSTALL CHECK-IN DOCUMENTS ──────────────────────────────────────────

test('a well-formed clearance and envelope, IMPORTED, do admit the helper — or nothing below proves anything', async () => {
  const t = now();
  OK_PERM = permissionAt(D.CHECKINPERM + ok.pub, ok);
  const r = await doImport([OK_PERM, grantAt(D.CHECKINHELPER + S_OK, S_OK, [ok.pub], t - 600, t + 3600, KEY_OK)]);
  assert.equal(r.status, 200, 'the import was rejected outright: ' + JSON.stringify(r.body));
  assert.equal(r.body.imported, 2, 're-anchor: /import did not store both documents, so nothing here is measuring the ingest');
  assert.equal(await opensSession(ok, S_OK), true,
    '/import stored a well-formed clearance and envelope and the helper they name still cannot open the ' +
    'session. Every "installed nothing" assertion in this file would then pass against a route that installs ' +
    'nothing at all, and the whole file would be vacuous.');
  const [wrote] = await publishAs(ok, checkin(ok, 'r-ok', S_OK, gina.pub, KEY_OK));
  assert.equal(wrote, true, 're-anchor: an imported clearance+envelope does not let its helper write the register either');
});

// ── UPPERCASE HEX: THE SPELLING THE INGEST FOLDED ONTO THE MAP ENTRY THE DOOR HAD REFUSED ──────────────────

test('an UPPERCASE-hex clearance suffix is refused at the door', async () => {
  const [accepted, why] = await publishAs(church, permissionAt(D.CHECKINPERM + upper.pub.toUpperCase(), upper));
  assert.equal(accepted, false,
    'accept() stored a clearance under an UPPERCASE-hex d-tag. Every lookup keys on that suffix, so the same ' +
    'person would have two clearance documents and one map entry: ' + why);
});

test('…AND THE SAME DOCUMENT INSTALLS NOTHING THROUGH /import', async () => {
  // THE MEASUREMENT. Until 2026-09-10 the ingest read `d.slice(...).toLowerCase()`, so the suffix the door had
  // just refused was folded straight onto the lowercase map entry — and this relay then served the session key
  // and took register writes on a clearance no door had ever admitted.
  const t = now();
  const r = await doImport([
    permissionAt(D.CHECKINPERM + upper.pub.toUpperCase(), upper),
    grantAt(D.CHECKINHELPER + S_UP, S_UP, [upper.pub], t - 600, t + 3600, KEY_UP),
  ]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.imported, 2, 're-anchor: the import did not store the pair, so the refusal below is about nothing');
  assert.equal(await opensSession(upper, S_UP), false,
    'a clearance the websocket door REFUSED was installed through /import and the relay handed its session ' +
    'key over. accept() and note() must apply the same d-tag rule, or a restore and a peer sync are two ways ' +
    'in behind the gate.');
  const [wrote] = await publishAs(upper, checkin(upper, 'r-upper', S_UP, gina.pub, KEY_UP));
  assert.equal(wrote, false,
    'the relay accepted a write into the children\'s register from somebody cleared only by a document the ' +
    'door refused');
});

test('…AND IT IS STILL NOT INSTALLED AFTER A RESTART', async () => {
  // The rehydrate is note()'s other caller and the one that runs unattended. A rule that holds until the next
  // reboot is a rule with a scheduled expiry, and this relay restarts itself.
  await restart();
  assert.equal(await opensSession(upper, S_UP), false,
    'the uppercase clearance came back on the boot rehydrate. accept() is nowhere in that path, so the ingest ' +
    'is the only thing that can refuse it.');
  assert.equal(await opensSession(ok, S_OK), true,
    're-anchor: the well-formed pair did not survive the restart either, so the refusal above is not about spelling');
});

// ── A SESSION ID THAT IS NOT A SESSION ID ─────────────────────────────────────────────────────────────────

test('a session id with a path segment in it, and a 300-character one, are refused at the door', async () => {
  const t = now();
  for (const [label, sid, key, who] of [['a `..` in the id', S_DOTS, KEY_DOTS, dots], ['300 characters', S_LONG, KEY_LONG, longs]]) {
    const [accepted, why] = await publishAs(church, grantAt(D.CHECKINHELPER + sid, sid, [who.pub], t - 600, t + 3600, key));
    assert.equal(accepted, false, `accept() stored an envelope whose session id has ${label}: ${why}`);
  }
});

test('…AND NEITHER INSTALLS AN ENVELOPE THROUGH /import', async () => {
  // The ingest bounded the session id not at all — a bare `d.slice()` — while the door bounded it at 128
  // characters of [A-Za-z0-9._:-]. Both malformed shapes were installed by a restore and survived a reboot.
  // Each is paired with a WELL-FORMED clearance for its helper, so the only thing that can refuse them is the
  // envelope's own suffix.
  const t = now();
  const r = await doImport([
    permissionAt(D.CHECKINPERM + dots.pub, dots),
    permissionAt(D.CHECKINPERM + longs.pub, longs),
    grantAt(D.CHECKINHELPER + S_DOTS, S_DOTS, [dots.pub], t - 600, t + 3600, KEY_DOTS),
    grantAt(D.CHECKINHELPER + S_LONG, S_LONG, [longs.pub], t - 600, t + 3600, KEY_LONG),
  ]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.imported, 4, 're-anchor: the import did not store all four, so the refusals below are about nothing');
  // The clearances DID install — they are well-formed — which is what makes the two refusals below about the
  // session id and nothing else.
  assert.equal(await opensSession(dots, S_DOTS), false,
    'an envelope whose session id carries a path segment was refused live and installed by a restore, and ' +
    'the relay ' +
    'served its session key');
  assert.equal(await opensSession(longs, S_LONG), false,
    'an envelope with a 300-character session id was refused live and installed by a restore, and the relay ' +
    'served its session key');
  for (const [who, sid, key, id] of [[dots, S_DOTS, KEY_DOTS, 'r-dots'], [longs, S_LONG, KEY_LONG, 'r-longs']]) {
    const [wrote] = await publishAs(who, checkin(who, id, sid, gina.pub, key));
    assert.equal(wrote, false, 'the relay took a register write against a session id no door ever admitted');
  }
});

test('…and a restart does not put either of them back', async () => {
  await restart();
  assert.equal(await opensSession(dots, S_DOTS), false, 'the path-segment session came back on the boot rehydrate');
  assert.equal(await opensSession(longs, S_LONG), false, 'the 300-character session came back on the boot rehydrate');
  assert.equal(await opensSession(ok, S_OK), true,
    're-anchor: nothing survives this restart, so the two refusals above are not about the session id');
});

// ── AND THE HALF OF THE CONJUNCTION THAT FAILED OPEN ON A MID-LIFE REHYDRATE ────────────────────────────────

test('A WITHDRAWN CLEARANCE STAYS WITHDRAWN ACROSS A MID-LIFE REHYDRATE, not only across a restart', async () => {
  // CHECKIN_PERMITS was missing from clearDerivedMaps() until 2026-09-10 — the ONE line on which the two
  // check-in siblings differed — and it failed OPEN. clearDerivedMaps() is what hydrateMaps() calls before
  // rebuilding, so a permission removed from the corpus was never forgotten by a mid-life rehydrate: the map
  // kept its entry, the relay went on handing out the session key and accepting register writes on a clearance
  // it no longer held, and it self-corrected only at the next process restart.
  //
  // A kind-5 DELETE, not the addressable tombstone the console publishes: this is the case where the document
  // LEAVES THE CORPUS, so the rebuild pass has nothing to re-derive it from and only the clear can forget it.
  assert.equal(await opensSession(ok, S_OK), true, 're-anchor: the control helper cannot open the session before the delete either');
  const del = finalizeEvent({ kind: 5, created_at: now() + 1, tags: [['e', OK_PERM.id]], content: '' }, church.sk);
  const [deleted, dwhy] = await send(w, del);
  assert.equal(deleted, true, 'the relay refused the church\'s own kind-5, so the clearance never left the corpus: ' + dwhy);
  await sleep(300);
  // ANY /import TRIGGERS THE REHYDRATE, and so does a /config save. One unrelated document is enough — the
  // church's own member marker — because what is under test is clearDerivedMaps(), not what was imported.
  const r = await doImport([doc(church, D.MEMBER + church.pub, { joined: now() })]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await opensSession(ok, S_OK), false,
    'the church deleted a clearance out of the corpus, a mid-life hydrateMaps() ran, and the relay still ' +
    'served the session key on it. CHECKIN_PERMITS is half of the conjunction the whole restructure rests on ' +
    'and it must be cleared with its sibling — a map that outlives the document it was derived from fails OPEN.');
  const [wrote] = await publishAs(ok, checkin(ok, 'r-after-del', S_OK, gina.pub, KEY_OK));
  assert.equal(wrote, false, 'and the relay went on taking register writes on a clearance it no longer holds');
});
