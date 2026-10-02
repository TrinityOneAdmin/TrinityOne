// A BLOCKED READER IS SERVED NOTHING PRIVATE (sim finding 1).
//   Run: node --test scripts/a-blocked-reader-gets-nothing-private.test.mjs
//
// OWNER, 2026-10-02: "Block means NO private access of any kind." The relay's own rule is that a BLOCKED pubkey must
// never satisfy a read gate — but it only applied that rule to the AUTHOR of a stored event (blockedBy on the write
// side, in the REQ scan and the AUTH replay) and to "effective membership". Every OTHER grant asks who the reader is
// and never whether the church blocked them: stewardCan() (a delegate's reads), careAdmin() (the care team's roster),
// childCareReader()/approvedIn() (the cleared-adults list) and the minors:/guardians:/carereq: branches. So a blocked
// care-team member, delegate or cleared adult kept being served help requests and the children's lists.
//
// THE FIX (scripts/gateway.mjs). canRead()'s kind-30078 branch demotes a reader THIS church blocked to "nobody signed
// in" for that church's documents, once, at the top — so none of stewardCan/careAdmin/approvedIn is edited (grantorOk()
// asks stewardCan of whoever WROTE a roster; a block there would revoke every roster a blocked steward ever wrote). The
// blob upload and download gates ask the same of a steward.
//
// ── WHY THIS DRIVES A REAL RELAY ────────────────────────────────────────────────────────────────────────────────
// The gate is module-private and reads live maps that only exist in a running process. This spawns scripts/gateway.mjs
// in a fresh data directory and talks NIP-01/42 to it over a websocket, as a phone does — the REQ answer, the LIVE
// push of a new document, and the HTTP blob routes.
//
// Users of the shared code (rule 2): canRead has three callers, all through this one function — the live broadcast,
// the REQ scan and the NIP-42 AUTH replay (peer /sync streams the raw corpus and re-applies canRead on the receiving
// box). _blobUploader serves PUT /blob and DELETE /blob/<sha>; _blobMember serves GET /blob/<sha>. stewardCan (80
// call sites), careAdmin (23) and approvedIn (3) are NOT touched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { D } from './trinity-doc-types.mjs';

const PORT = 8744;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const now = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const key = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = key(), churchB = key();
const careGuy = key(), careOK = key();          // on the care team (roster:team1)
const delegate = key();                          // a steward ticked for Safeguarding
const adult = key(), kid = key();                // a youth-cleared adult, and a child
const asker = key();                             // an adult who asks for help
const blobSteward = key();                       // a steward ticked for content, who uploads media
const dual = key();                              // a member of BOTH churches

let relay = null, dataDir = null, w = null;

const doc = (who, d, content, tags = []) => finalizeEvent({
  kind: 30078, created_at: now(), content: typeof content === 'string' ? content : JSON.stringify(content),
  tags: [['d', d], ['t', 'trinityone'], ...tags],
}, who.sk);
const conn = () => new Promise((res, rej) => { const s = new WebSocket(WS_URL, { headers: { Host: `127.0.0.1:${PORT}` } }); s.on('open', () => res(s)); s.on('error', rej); });
const publish = (s, e) => new Promise((res) => {
  const on = (m) => { const a = JSON.parse(m); if (a[0] === 'OK' && a[1] === e.id) { s.off('message', on); res({ ok: a[2], why: a[3] || '' }); } };
  s.on('message', on); s.send(JSON.stringify(['EVENT', e]));
  setTimeout(() => { s.off('message', on); res({ ok: null, why: 'no answer in 8s' }); }, 8000);
});
// REQ as `who` (NIP-42 authenticated), return every event served within `ms`.
function req(s, sub, filter, who, ms = 1000) {
  return new Promise((res) => {
    const out = [];
    const on = (d) => {
      const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === sub) out.push(m[2]);
      else if (m[0] === 'AUTH' && who) s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)]));
    };
    s.on('message', on); s.send(JSON.stringify(['REQ', sub, filter]));
    setTimeout(() => { s.off('message', on); res(out); }, ms);
  });
}
const readAs = async (who, ds, ms) => { const s = await conn(); try { return await req(s, 'r' + Math.random().toString(36).slice(2, 6), { kinds: [30078], '#d': ds }, who, ms); } finally { s.close(); } };

const D_MINORS = D.MINORS + church.pub;
const idFor = (who) => who.pub.slice(0, 16) + '-r1';
const D_ASK = D.CAREREQ + idFor(asker);
const D_KIDASK = D.CAREREQ + idFor(kid);
const D_JOIN = D.JOINPOLICY + church.pub;
const D_NAMEKEY_B = D.NAMEKEY + churchB.pub;

const blocklist = async (pubs) => {
  await sleep(1100);
  const r = await publish(w, doc(church, D.BLOCKED + church.pub, { pubkeys: pubs.map(p => p.pub) }));
  assert.equal(r.ok, true, 'fixture: the blocklist write was refused (' + r.why + ')');
  await sleep(500);
};

before(async () => {
  await requireFreePort(PORT, 'a-blocked-reader-gets-nothing-private.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-blk-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: `${npubEncode(church.pub)},${npubEncode(churchB.pub)}` },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  w = await conn();
  const must = async (p, what) => { const r = await p; assert.equal(r.ok, true, `fixture: ${what} was refused (${r.why}) — nothing below would mean anything`); };
  for (const who of [careGuy, careOK, delegate, adult, kid, asker, blobSteward, dual]) await must(publish(w, doc(who, D.MEMBER + church.pub, { joined: now() })), 'a member joining church');
  await must(publish(w, doc(dual, D.MEMBER + churchB.pub, { joined: now() })), 'a member joining church B');
  await must(publish(w, doc(church, D.STEWARDS + church.pub, { pubkeys: [delegate.pub, blobSteward.pub], caps: { [delegate.pub]: ['safeguarding'], [blobSteward.pub]: ['content'] } })), 'the steward roster');
  await must(publish(w, doc(church, D.MEALS_SETTINGS, { enabled: true, adminGroupId: 'team1', openedBy: 'steward' })), 'the care module settings');
  await must(publish(w, doc(church, D.ROSTER + 'team1', { people: [{ id: 'p1', name: 'x', pub: careGuy.pub }, { id: 'p2', name: 'y', pub: careOK.pub }] })), 'the care team roster');
  await must(publish(w, doc(church, D.MINORS + church.pub, { pubkeys: [kid.pub] })), 'the list of children');
  await must(publish(w, doc(church, D.APPROVED + church.pub, { pubkeys: [adult.pub] })), 'the cleared-adults list');
  await must(publish(w, doc(church, D_JOIN, { approval: false })), 'the join policy');
  await must(publish(w, doc(asker, D_ASK, 'sealed', [['church', church.pub]])), 'an adult’s request for help');
  await must(publish(w, doc(kid, D_KIDASK, 'sealed', [['church', church.pub]])), 'a child’s request for help');
  await must(publish(w, doc(churchB, D_NAMEKEY_B, { rev: 1, keys: {} })), 'church B’s name key');
  await sleep(500);
});
after(async () => {
  try { w && w.close(); } catch {}
  try { relay && relay.kill('SIGKILL'); } catch {}
  await sleep(200);
  try { dataDir && rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

const dTags = (evs) => evs.map(e => (e.tags.find(t => t[0] === 'd') || [])[1]).sort();

test('CONTROL: before any block, the care team, the delegate and the cleared adult read what their role grants', async () => {
  assert.deepEqual(dTags(await readAs(careGuy, [D_ASK, D_MINORS])), [D_ASK, D_MINORS].sort(), 'a care-team member did not read the request and the children’s list — the fixture grants nothing, so the test below proves nothing');
  assert.deepEqual(dTags(await readAs(delegate, [D_MINORS])), [D_MINORS], 'a Safeguarding delegate did not read the children’s list');
  assert.deepEqual(dTags(await readAs(adult, [D_KIDASK])), [D_KIDASK], 'a cleared adult did not read a child’s request');
});

test('a BLOCKED care-team member, delegate and cleared adult are served NOTHING private', async () => {
  await blocklist([careGuy, delegate, adult]);
  assert.deepEqual(await readAs(careGuy, [D_ASK, D_MINORS]), [], 'A BLOCKED CARE-TEAM MEMBER IS STILL SERVED HELP REQUESTS AND THE CHILDREN’S LIST');
  assert.deepEqual(await readAs(delegate, [D_MINORS]), [], 'A BLOCKED DELEGATE IS STILL SERVED THE CHILDREN’S LIST');
  assert.deepEqual(await readAs(adult, [D_KIDASK]), [], 'A BLOCKED CLEARED ADULT IS STILL SERVED A CHILD’S REQUEST FOR HELP');
  // the others on the same lists are untouched — a block is one person, not the role
  assert.deepEqual(dTags(await readAs(careOK, [D_ASK, D_MINORS])), [D_ASK, D_MINORS].sort(), 'blocking one care-team member took the grant away from another');
});

test('a blocked reader is anonymous, not dead: a public document is still served', async () => {
  assert.deepEqual(dTags(await readAs(careGuy, [D_JOIN])), [D_JOIN], 'the join policy is public and a blocked person could not read it — the block should demote them to an anonymous reader, not silence them');
});

test('the ban is THIS church’s: someone C blocked still reads church B’s documents', async () => {
  await blocklist([careGuy, delegate, adult, dual]);
  const got = await readAs(dual, [D_NAMEKEY_B]);
  assert.deepEqual(dTags(got), [D_NAMEKEY_B], 'A BAN BY CHURCH C REACHED CHURCH B — a member of B who C blocked can no longer read B’s documents');
});

test('a LIVE document is not pushed to a blocked reader, and is to the one who is not blocked', async () => {
  const sBlocked = await conn(), sOK = await conn();
  const gotBlocked = [], gotOK = [];
  const watch = (s, who, sub, sink) => new Promise((res) => {
    s.on('message', (d) => {
      const m = JSON.parse(d);
      if (m[0] === 'AUTH') s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)]));
      else if (m[0] === 'EVENT' && m[1] === sub) sink.push(m[2]);
      else if (m[0] === 'EOSE' && m[1] === sub) res();
    });
    s.send(JSON.stringify(['REQ', sub, { kinds: [30078], '#d': [D_MINORS] }]));
    setTimeout(res, 1500);
  });
  await Promise.all([watch(sBlocked, careGuy, 'lb', gotBlocked), watch(sOK, careOK, 'lo', gotOK)]);
  await sleep(1100);
  const kid2 = key();
  const r = await publish(w, finalizeEvent({ kind: 30078, created_at: now(), content: JSON.stringify({ pubkeys: [kid.pub, kid2.pub] }), tags: [['d', D_MINORS], ['t', 'trinityone']] }, church.sk));
  assert.equal(r.ok, true, 'fixture: the church could not republish the children’s list (' + r.why + ')');
  await sleep(1500);
  sBlocked.close(); sOK.close();
  const pushed = (evs) => evs.filter(e => String(e.content).includes(kid2.pub));
  assert.equal(pushed(gotOK).length, 1, 'CONTROL: an unblocked care-team member was not pushed the new children’s list — the push path is not under test');
  assert.deepEqual(pushed(gotBlocked), [], 'A BLOCKED CARE-TEAM MEMBER WAS PUSHED THE NEW CHILDREN’S LIST LIVE');
  assert.deepEqual(gotBlocked, [], 'a blocked care-team member was served the children’s list on subscribe');
});

// ── media: the blob routes ask the same of a steward ───────────────────────────────────────────────────────────
const BODY = Buffer.from('a sermon, in a handful of bytes');
const SHA = createHash('sha256').update(BODY).digest('hex');
const nostrAuth = (who, kind, tags) => 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({ kind, created_at: now(), tags, content: kind === 24242 ? 'upload' : '' }, who.sk))).toString('base64');
const putBlob = (who) => fetch(`http://127.0.0.1:${PORT}/blob`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', Authorization: nostrAuth(who, 24242, [['t', 'upload'], ['church', church.pub], ['x', SHA], ['expiration', String(now() + 300)]]) }, body: BODY });
const getBlob = (who) => { const u = `http://127.0.0.1:${PORT}/blob/${SHA}`; return fetch(u, { headers: { Authorization: nostrAuth(who, 27235, [['u', u], ['method', 'GET']]) } }); };

test('a steward uploads and downloads media — until the church blocks them', async () => {
  const up = await putBlob(blobSteward);
  assert.ok(up.status >= 200 && up.status < 300, 'CONTROL: an unblocked content steward could not upload (' + up.status + ' ' + (await up.text()) + ')');
  assert.equal((await getBlob(blobSteward)).status, 200, 'CONTROL: an unblocked steward could not download the media');
  await blocklist([careGuy, delegate, adult, dual, blobSteward]);
  assert.equal((await putBlob(blobSteward)).status, 401, 'A BLOCKED STEWARD UPLOADED MEDIA');
  assert.equal((await getBlob(blobSteward)).status, 401, 'A BLOCKED STEWARD DOWNLOADED MEMBERS-ONLY MEDIA');
  assert.equal((await getBlob(careOK)).status, 200, 'CONTROL: a member who is not blocked lost the media with them');
});
