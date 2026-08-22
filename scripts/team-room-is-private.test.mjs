// A SERVING TEAM'S ROOM IS PRIVATE TO ITS ROSTER.
// Run: node --test scripts/team-room-is-private.test.mjs
//
// Round 9 (2026-08-21) measured the opposite. The Welcome team's roster was {"roles":[...],"people":[],"pods":[]}
// — EMPTY — and two messages from people who were not on it are on the relay in that room. Samuel read its
// header as "Members only". Three members reported the contradiction from the other side without prompting:
//   Daniel: "Serving still says 'You're not on a serving team yet', even though I can see and post in the
//            Welcome team room."
//   Priya:  "The Serving screen says I'm not on a serving team yet even though the Welcome team chat is in my
//            list and I posted in it."
// The cause is the two-list split: chat reads the GROUP doc, serving reads the ROSTER doc, and only serving
// honoured it. A team room was therefore an open church-wide room wearing a "Members only" label.
//
// WHO MAY READ ONE (owner's decision, 2026-08-21): the roster, the church key, and any steward who can EDIT
// groups — capability `content`, the "Groups & rotas" tickbox. NOT every steward: Sandra was added with
// Finance ONLY, and a finance delegate gaining the Youth room is exactly the leak capability keys exist to
// stop. The steward clause also settles the empty-roster case — a steward creates a team on Monday and staffs
// it on Friday, and must be able to see their own room in between.
//
// This is enforced at the RELAY, not in the client list. A client-side filter is cosmetic: the messages are on
// the relay and any socket can ask for them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8997;   // isolated: 8841 was already claimed (the port-collision test caught it)
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const churchSk = generateSecretKey(), churchPub = getPublicKey(churchSk);
const contentSk = generateSecretKey(), contentPub = getPublicKey(contentSk);   // steward: Groups & rotas
const financeSk = generateSecretKey(), financePub = getPublicKey(financeSk);   // steward: Finance ONLY
const onSk = generateSecretKey(), onPub = getPublicKey(onSk);                  // member ON the roster
const offSk = generateSecretKey(), offPub = getPublicKey(offSk);               // member NOT on the roster

const TEAM = churchPub.slice(0, 16) + '-welcome';
let relay, dataDir;

const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res(m[2] === true); } };
  ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt]));
  setTimeout(() => { ws.off('message', on); res(false); }, 2500);
});
// Read the team room AS a given identity, answering the relay's NIP-42 challenge so the read is authenticated.
function readRoom(ws, subId, authSk, window = 800) {
  return new Promise((resolve) => {
    const events = [];
    const on = (d) => {
      const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === subId) events.push(m[2]);
      else if (m[0] === 'AUTH' && authSk) {
        const a = finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, authSk);
        ws.send(JSON.stringify(['AUTH', a]));
        setTimeout(() => ws.send(JSON.stringify(['REQ', subId, { kinds: [1], '#t': [TEAM] }])), 120);
      }
    };
    ws.on('message', on);
    ws.send(JSON.stringify(['REQ', subId, { kinds: [1], '#t': [TEAM] }]));
    setTimeout(() => { ws.off('message', on); try { ws.send(JSON.stringify(['CLOSE', subId])); } catch {} resolve(events); }, window);
  });
}
const seeMsg = (evts) => evts.some(e => /rota for Sunday/.test(e.content || ''));

before(async () => {
  await requireFreePort(PORT, 'team-room-is-private.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-team-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000' }, stdio: 'ignore',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) break; } catch {} await sleep(150); }

  // REGISTER THE CHURCH. Without this the relay has no CHURCH_PUBS entry, so it never ingests the group or
  // roster docs at all — nothing is gated because nothing is known. A church that has not registered is not a
  // church to this relay, which is the whole point of the write policy.
  const token = JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token;
  const reg = await fetch(`http://127.0.0.1:${PORT}/config`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ addChurch: { npub: npubEncode(churchPub), name: 'Test church' } }) });
  assert.ok(reg.ok, 'church registered at the relay');

  const ws = await connect();
  const D = (d, content, sk) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', NET]], content: JSON.stringify(content) }, sk);

  // the church, its members, and its delegated stewards
  // A MEMBER DOC IS SIGNED BY THE MEMBER, not by the church: the relay keys MEMBER_DOCS off e.pubkey, which
  // is why a real church has one document per person (round 9 had five). Seeding a single church-signed doc
  // with a `members` array enrols nobody, and every "member cannot read" assertion then passes for the wrong
  // reason — the reader was never a member at all.
  for (const [sk, who] of [[onSk, 'on'], [offSk, 'off']]) {
    assert.ok(await publish(ws, D('trinityone/member:' + churchPub, { name: who, joined: now() }, sk)), who + ' joined');
  }
  assert.ok(await publish(ws, D('trinityone/stewards:' + churchPub, {
    pubkeys: [contentPub, financePub],
    caps: { [contentPub]: ['content'], [financePub]: ['finance'] },
    names: { [contentPub]: 'Ade (groups & rotas)', [financePub]: 'Sandra (finance only)' },
  }, churchSk)), 'stewards seeded');

  // the team, its roster (only `on` is on it), and one message in the room
  assert.ok(await publish(ws, D('trinityone/group:' + TEAM, { name: 'Welcome team', kind: 'team', sub: 'Serving team' }, churchSk)), 'team seeded');
  assert.ok(await publish(ws, D('trinityone/roster:' + TEAM, { roles: [{ id: 'r1', name: 'Lead' }], people: [{ pub: onPub }], pods: [] }, churchSk)), 'roster seeded');
  assert.ok(await publish(ws, finalizeEvent({ kind: 1, created_at: now(), tags: [['t', NET], ['t', TEAM], ['church', churchPub]], content: 'rota for Sunday — please swap if you cannot make it' }, churchSk)), 'room message seeded');
  ws.close();
});

after(() => { try { relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('a member NOT on the roster cannot read the team room', async () => {
  const ws = await connect();
  const seen = await readRoom(ws, 'off', offSk); ws.close();
  assert.equal(seeMsg(seen), false,
    'a church member who is not on the team roster still reads the team room. Round 9: two members posted ' +
    'into a "Members only" room whose roster was empty, while Serving correctly told them they were on no team.');
});

test('a member ON the roster can read it', async () => {
  const ws = await connect();
  const seen = await readRoom(ws, 'on', onSk); ws.close();
  assert.equal(seeMsg(seen), true, 'the people actually on the team lost their own room — the fix has overshot');
});

test('the church key can read it', async () => {
  const ws = await connect();
  const seen = await readRoom(ws, 'church', churchSk); ws.close();
  assert.equal(seeMsg(seen), true, 'the church cannot read a room it owns');
});

test('a steward who can edit groups can read it, even with an empty roster', async () => {
  const ws = await connect();
  const seen = await readRoom(ws, 'content', contentSk); ws.close();
  assert.equal(seeMsg(seen), true,
    'a steward holding "Groups & rotas" (capability `content`) must see every room in order to manage it — ' +
    'and must not lose a team they created before they have staffed it');
});

test('a FINANCE-only steward cannot read it', async () => {
  const ws = await connect();
  const seen = await readRoom(ws, 'finance', financeSk); ws.close();
  assert.equal(seeMsg(seen), false,
    'Sandra was given Finance and nothing else. A finance delegate reading the church\'s team and youth rooms ' +
    'is the exact leak capability keys exist to prevent.');
});

// Reading the ROOM'S DEFINITION, not its messages. Gating the messages alone left the room listed in the
// member's chat list, where it accepted typing and silently discarded it — Nkechi, round 10: "I typed a reply
// and pressed send; the box emptied but my message never appeared." Owner: "a user should just not see rooms
// they are not added to."
function readGroupDoc(ws, subId, authSk, window = 800) {
  const filter = { kinds: [30078], '#d': ['trinityone/group:' + TEAM] };
  return new Promise((resolve) => {
    const events = [];
    const on = (d) => {
      const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === subId) events.push(m[2]);
      else if (m[0] === 'AUTH' && authSk) {
        const a = finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, authSk);
        ws.send(JSON.stringify(['AUTH', a]));
        setTimeout(() => ws.send(JSON.stringify(['REQ', subId, filter])), 120);
      }
    };
    ws.on('message', on);
    ws.send(JSON.stringify(['REQ', subId, filter]));
    setTimeout(() => { ws.off('message', on); try { ws.send(JSON.stringify(['CLOSE', subId])); } catch {} resolve(events); }, window);
  });
}
const seesDef = (evts) => evts.some(e => /Welcome team/.test(e.content || ''));

test('a non-roster member is not even shown that the team room exists', async () => {
  const ws = await connect();
  const seen = await readGroupDoc(ws, 'defoff', offSk); ws.close();
  assert.equal(seesDef(seen), false,
    'the team room\'s definition is still served to someone not on its roster, so the room is listed, ' +
    'accepts typing, and silently discards it');
});

test('the roster, the church and a content steward still see the definition', async () => {
  for (const [who, sk] of [['roster member', onSk], ['church', churchSk], ['content steward', contentSk]]) {
    const ws = await connect();
    const seen = await readGroupDoc(ws, 'def-' + who.replace(/\s/g, ''), sk); ws.close();
    assert.equal(seesDef(seen), true, who + ' lost sight of a team room they must be able to manage or use');
  }
});

test('an anonymous socket cannot read it', async () => {
  const ws = await connect();
  const seen = await readRoom(ws, 'anon', null); ws.close();
  assert.equal(seeMsg(seen), false, 'the team room is served to an unauthenticated socket');
});
