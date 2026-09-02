// ONE CHURCH CANNOT CALL ANOTHER CHURCH'S MEMBER A CHILD.
//   Run: node --test scripts/one-church-cannot-call-anothers-member-a-child.test.mjs
//
// Whether someone is a child is a judgement only their OWN church makes (AUDIT-2026-07-30 S3). A relay can
// carry several congregations, `minors:<churchpub>` is owner-written and has no membership test — a church
// may name ANY pubkey on the box — and the relay-wide MINORS set is every church's list merged. So a gate
// that asks the union instead of the church lets any co-tenant blank a named person's screen everywhere on
// the relay. This is not a hypothetical shape here: it is the shape of the worst bugs in this repo's
// history (AUDIT-2026-07-24's two cross-tenant criticals; AUDIT-2026-07-30 S1-S6).
//
// The adults-only-room gate in canRead's GROUP_D branch (scripts/gateway.mjs) is scoped with minorOf(),
// and NOTHING TESTED THAT. Measured 2026-08-31: replacing
//     if (gcp && minorOf(authed, gcp)) return false;
// with the relay-wide union
//     if ([...MINORS_BY.values()].some(s => s.has(authed))) return false;
// removed per-church scoping entirely, and scripts/an-adults-only-rooms-name-is-not-served-to-a-child.test.mjs
// — the file written for that gate — stayed 10/10 green, because it runs ONE church. So did the whole suite.
//
// What that costs, in the terms it happens in: Ann is an adult member of Grace Church. A second
// congregation on the same relay, which she has never joined, publishes a `minors:` list with her pubkey in
// it. Under the union her own church's chat list silently loses every room that is not marked child-safe.
// Nothing tells her, nothing tells Grace, and the relay is behaving exactly as written.
//
// This file also covers the SIBLING claim the same commit makes and that nothing tested either — the
// `GROUP_CHURCH.get(gid) || idNamesOwner(gid)` fallback. See the note above the last test.
//
// Two churches, four people, a real scripts/gateway.mjs on its own port and data directory, real sockets,
// real NIP-42 auth. The model for the setup and helpers is
// scripts/an-adults-only-rooms-name-is-not-served-to-a-child.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8806;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const MEMBER_D = 'trinityone/member:', GROUP_D = 'trinityone/group:', MINORS_D = 'trinityone/minors:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

// TWO CONGREGATIONS ON ONE RELAY. Not exotic: the shared community relays carry many, and the console's
// own Relays card invites a church onto one ("public ones for redundancy"). CHURCH_NPUB takes a
// comma-separated list, which is the shortest honest way to provision both.
const grace = K();          // church A — Ann's and Mia's church
const stmarks = K();        // church B — a co-tenant. Ann has never joined it.
const ap = grace.pub, bp = stmarks.pub;

const ann = K();   // an ADULT member of church A, and of nothing else. Church B will name her a child.
const mia = K();   // 15, a member of BOTH churches. Church A — her own — marks her a child. B does not.
const ben = K();   // an adult member of church B only.
const bea = K();   // a member of church B whom church B marks a child. B's own judgement about B's own room.

// Group ids in the field are `<churchpub first 16 hex>-<base36 time>` (src/steward.src.js:3639), and that
// prefix is what idNamesOwner() reads. Mint them the same way so the last test is about the real format.
const gid = (cp, tail) => cp.slice(0, 16) + '-' + tail;
const A_MARRIAGE = gid(ap, 'marriage');       // church A, adults-only
const A_YOUTH = gid(ap, 'youth');             // church A, child-safe
const B_MENS = gid(bp, 'mens');               // church B, adults-only
const A_ELDERS = gid(ap, 'elders');           // an id that NAMES church A — forged by church B, see the last test

let relay, dataDir, pub;

async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content, tags = []) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', NET], ...tags], content: JSON.stringify(content) }, who.sk);
const memberDoc = (who, cp) => doc(who, MEMBER_D + cp, { joined: now() });
// Exactly the shape src/steward.src.js publishes: `childsafe: true` when the church has marked the room,
// and the key ABSENT otherwise — absent is what adults-only looks like on the wire, and it is the default.
const groupDoc = (church, id, name, extra = {}) => doc(church, GROUP_D + id, { name, kind: extra.kind || 'open', ...extra });
const minorsDoc = (church, cp, people) => doc(church, MINORS_D + cp, { pubkeys: people.map(p => p.pub) });

function reqCollect(ws, subId, filter, authSk, window = 700) {
  return new Promise((resolve) => {
    const events = [];
    const on = (d) => { const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === subId) events.push(m[2]);
      else if (m[0] === 'AUTH' && authSk) ws.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, authSk)])); };
    ws.on('message', on); ws.send(JSON.stringify(['REQ', subId, filter]));
    setTimeout(() => { ws.off('message', on); try { ws.send(JSON.stringify(['CLOSE', subId])); } catch {} resolve(events); }, window);
  });
}
// WHICH ROOMS DOES THIS PERSON'S CHAT LIST DRAW? Asked the way subscribeChurchGroups asks it — a REQ over
// the group d-tags — and reduced to the NAMES the relay hands back, because the name is the disclosure.
let _sub = 0;
const ALL_ROOMS = [A_MARRIAGE, A_YOUTH, B_MENS, A_ELDERS];
async function roomsNamedTo(who, ids = ALL_ROOMS) {
  const ws = await connect();
  const evs = await reqCollect(ws, 'gd' + (++_sub), { kinds: [30078], '#d': ids.map(i => GROUP_D + i) }, who && who.sk);
  ws.close();
  const names = new Set();
  for (const e of evs) { try { const n = JSON.parse(e.content || '{}').name; if (n) names.add(n); } catch {} }
  return names;
}

before(async () => {
  await requireFreePort(PORT, 'one-church-cannot-call-anothers-member-a-child.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-twochurch-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dataDir,
             CHURCH_NPUB: npubEncode(ap) + ',' + npubEncode(bp), RELAY_MAX_EVENTS: '5000' },
      stdio: 'ignore' });
  await waitReady();
  pub = await connect();
  assert.equal((await publish(pub, memberDoc(ann, ap)))[0], true, 'Ann joins church A');
  assert.equal((await publish(pub, memberDoc(mia, ap)))[0], true, 'Mia joins church A');
  assert.equal((await publish(pub, memberDoc(mia, bp)))[0], true, 'Mia joins church B too');
  assert.equal((await publish(pub, memberDoc(ben, bp)))[0], true, 'Ben joins church B');
  assert.equal((await publish(pub, memberDoc(bea, bp)))[0], true, 'Bea joins church B');
  await sleep(150);
  assert.equal((await publish(pub, groupDoc(grace, A_MARRIAGE, 'Marriage counselling')))[0], true, 'A’s adults-only room');
  assert.equal((await publish(pub, groupDoc(grace, A_YOUTH, 'Youth group', { childsafe: true })))[0], true, 'A’s child-safe room');
  assert.equal((await publish(pub, groupDoc(stmarks, B_MENS, 'Men’s group')))[0], true, 'B’s adults-only room');
  await sleep(200);
});
after(async () => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('CONTROL: two churches really are provisioned, and everyone is served their own church’s rooms', async () => {
  const s = await fetch(`http://127.0.0.1:${PORT}/status`).then(r => r.json());
  assert.ok(s, 'the relay has no /status — re-anchor this test');
  for (const [who, label, want] of [
    [ann, 'Ann (church A)', ['Marriage counselling', 'Youth group']],
    [mia, 'Mia (both)', ['Marriage counselling', 'Youth group', 'Men’s group']],
    [ben, 'Ben (church B)', ['Men’s group']],
  ]) {
    const names = await roomsNamedTo(who);
    for (const n of want) assert.equal(names.has(n), true, `${label} was not served "${n}" — nothing below is a real test`);
  }
  assert.equal((await roomsNamedTo(ann)).has('Men’s group'), false,
    'Ann was served a room belonging to a church she has never joined — the per-church gate is not working at all');
});

test('the two churches publish their safeguarding lists — and church B names Ann, who is not its member', async () => {
  assert.equal((await publish(pub, minorsDoc(grace, ap, [mia])))[0], true, 'A marks Mia a child');
  // `minors:` is owner-written with NO membership test, by design — a church lists whoever it lists. This is
  // the whole reason the READ side has to ask a scoped question rather than a merged one.
  assert.equal((await publish(pub, minorsDoc(stmarks, bp, [ann, bea])))[0], true, 'B names Ann and Bea children');
  await sleep(300);
});

test('re-anchor: a church’s OWN child is withheld from its OWN adults-only room', async () => {
  const names = await roomsNamedTo(mia);
  assert.equal(names.has('Marriage counselling'), false,
    'church A’s adults-only room was named to church A’s own child — the gate this file is about is not ' +
    'running, so every assertion below would pass over a relay with no safeguarding at all');
  const bNames = await roomsNamedTo(bea);
  assert.equal(bNames.has('Men’s group'), false, 'church B’s adults-only room was named to church B’s own child');
});

test('ANN’S OWN CHURCH STILL NAMES HER ITS ROOMS, THOUGH A CO-TENANT CALLS HER A CHILD', async () => {
  const names = await roomsNamedTo(ann);
  assert.equal(names.has('Marriage counselling'), true,
    'Ann is an adult member of church A. Church B — which she has never joined — put her pubkey in its own ' +
    'minors: list, and church A’s adults-only rooms then vanished from her chat list. Whether someone is a ' +
    'child is a judgement only their OWN church makes (AUDIT-2026-07-30 S3): ask minorOf(authed, <the room’s ' +
    'church>), never the relay-wide MINORS union, which is every church’s list merged');
  assert.equal(names.has('Youth group'), true, 'Ann lost her own church’s child-safe room as well');
});

test('…and the same in the other direction: church A’s child keeps church B’s rooms, because B has not marked her', async () => {
  const names = await roomsNamedTo(mia);
  assert.equal(names.has('Men’s group'), true,
    'Mia is a child according to church A and an ordinary member according to church B. Church A’s judgement ' +
    'governs church A’s rooms and nothing else; using the union hands A a veto over B’s congregation');
});

test('…and she still has her own church’s child-safe room, so this is not a blank chat list', async () => {
  assert.equal((await roomsNamedTo(mia)).has('Youth group'), true,
    'the child-safe room stopped being served — a silent blank screen is worse than the leak');
});

test('an adult of either church is unaffected — the common case, and most of the traffic', async () => {
  assert.equal((await roomsNamedTo(ben)).has('Men’s group'), true, 'an ordinary adult of church B lost his church’s room');
  for (const [who, label] of [[grace, 'church A’s own key'], [stmarks, 'church B’s own key']]) {
    const names = await roomsNamedTo(who);
    assert.ok(names.size > 0, `${label} was served nothing at all`);
  }
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// THE SIBLING CLAIM: `GROUP_CHURCH.get(gid) || idNamesOwner(gid)`.
//
// Measured 2026-08-31: dropping `|| idNamesOwner(gid)` also left every test in the suite green.
//
// The fallback matters when the relay HOLDS a room definition but never recorded who owns it. That happens
// on exactly the path gateway.mjs names in its own comments: "/import and relay-to-relay sync call
// store.put() directly and never reach [accept()], so a forged copy could arrive by replication and sit
// beside the real one". Ingest still applies AUDIT-2026-07-24 C1 — a group id whose prefix names church A
// may only be defined by A — so it REFUSES to record ownership for a co-tenant's forgery, and GROUP_CHURCH
// stays empty for that id while the event itself is stored and served.
//
// With the fallback, idNamesOwner() reads the church out of the id and the safeguarding gate runs. Without
// it, gcp is empty, the gate is skipped, and the room's name is served.
//
// WHY MIA IS THE RIGHT READER FOR THIS, and the reason it cannot pass by accident: the forgery is signed by
// church B, so if ingest HAD recorded ownership it would have recorded B — and B has never called Mia a
// child. Mia being refused therefore means the relay resolved the governing church as A, which nothing but
// idNamesOwner() can do here.
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────

// NIP-98 proof bound to /import, signed by the church key.
const importAuth = (church, cp) => 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({
  kind: 27235, created_at: now(), content: '',
  tags: [['u', `http://127.0.0.1:${PORT}/import`], ['method', 'POST'], ['church', cp]],
}, church.sk))).toString('base64');

test('the LIVE door refuses a co-tenant’s room under an id that names another church', async () => {
  const [ok, msg] = await publish(pub, groupDoc(stmarks, A_ELDERS, 'Elders — pastoral'));
  assert.equal(ok, false, 'church B redefined a group id belonging to church A over a plain socket — ' +
    'AUDIT-2026-07-24 C1 is not holding, and the import path below is not the only way in');
  assert.ok(typeof msg === 'string');
});

test('…so it arrives by /import instead, which does not run that door', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/import`, {
    method: 'POST',
    headers: { Authorization: importAuth(stmarks, bp), 'Content-Type': 'application/x-ndjson' },
    body: JSON.stringify(groupDoc(stmarks, A_ELDERS, 'Elders — pastoral')),
  });
  const body = await r.json();
  assert.equal(r.status, 200, 'the import was refused: ' + JSON.stringify(body));
  assert.equal(body.imported, 1, 'the forged room definition was not stored, so the test below proves nothing');
  await sleep(900);   // the map rehydrate runs on setImmediate after the response
  // …and it really is on the box and servable. Without this the next test cannot tell "the relay withheld
  // it" from "the relay never had it" — an absence claim is the weakest thing a round produces.
  assert.equal((await roomsNamedTo(ben)).has('Elders — pastoral'), true,
    'the forged definition is not being served to anyone, so the safeguarding assertion below is vacuous');
});

test('A CHILD IS STILL PROTECTED FROM A ROOM WHOSE OWNER ONLY ITS ID KNOWS', async () => {
  const names = await roomsNamedTo(mia);
  assert.equal(names.has('Elders — pastoral'), false,
    'this room definition is stored with no recorded owner, because ingest refused a co-tenant’s claim on ' +
    'an id that names church A. The only thing left that can say which church governs it is the ' +
    '`|| idNamesOwner(gid)` fallback beside GROUP_CHURCH.get(gid) — without it the adults-only gate is ' +
    'skipped and the room is named to a child of that church');
});
