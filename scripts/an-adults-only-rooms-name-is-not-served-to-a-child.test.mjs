// AN ADULTS-ONLY ROOM'S NAME IS NOT SERVED TO A CHILD.
//   Run: node --test scripts/an-adults-only-rooms-name-is-not-served-to-a-child.test.mjs
//
// What a young person experiences without this. Mia, 15, opens the app. Her chat list reads "Marriage
// counselling", "Safeguarding concerns", "Elders — pastoral". She taps one: an empty room. She types; the
// box empties and nothing appears. THE NAME IS THE DISCLOSURE — it is a list of what the adults in her
// church are dealing with, and half of it is about her or about people she knows.
//
// WHY THE EXISTING PROTECTIONS MISS IT. Measured against a real gateway, 2026-08-31, with a room named
// `Marriage counselling` and `childsafe` absent: the room's MESSAGES were correctly withheld from the minor
// (0 served; an adult got 1) and her own post was refused — and the group DEFINITION was served to her,
// content {"name":"Marriage counselling","kind":"open"}. A room-list REQ as the minor returned both the
// child-safe room and that one. No earlier branch of canRead returned false for her.
//
// The client does filter (`app/screens-chat.jsx`, `.filter(g => !iAmMinor || g.childsafe)`), and
// scripts/adults-only-rooms-stay-hidden.test.mjs covers that half. A client filter is not a boundary: it
// runs on the reader's own device, after a cache has already painted, and answers "am I a minor?" from a
// document that may not have arrived. This file asks the RELAY, on a real socket, with real NIP-42 auth.
//
// THE PRECEDENT IS FIFTEEN LINES ABOVE THE GAP. canRead already withholds a TEAM room's definition, with a
// comment giving this exact reasoning — "Listing the room is what makes it look joinable, so the DEFINITION
// has to go too." The child-safe case never got the same treatment.
//
// AND WHAT MUST NOT BREAK, which is most of this file:
//   · a team room the church STAFFED her onto must still be named to her — see the note on that test;
//   · a child-safe room must still reach the child — a church may deliberately run NO rooms for its children
//     (reference/DOMAIN.md), so an empty list is legitimate, but an empty list for the wrong reason is a
//     silent blank screen and worse than the leak;
//   · every ordinary ADULT member must still see every room. This gate sits on the path that draws the chat
//     list for the whole congregation;
//   · the console must still see everything, or a steward cannot understand what a young person sees.
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

const PORT = 8804;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const MEMBER_D = 'trinityone/member:', GROUP_D = 'trinityone/group:', ROSTER_D = 'trinityone/roster:';
const MINORS_D = 'trinityone/minors:', STEWARDS_D = 'trinityone/stewards:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K();   // the console — the vicar's laptop
const mia    = K();   // 15
const ann    = K();   // an ordinary adult member. The common case; must not break.
const sam    = K();   // a steward given the Groups & rotas job
const cp = church.pub;

// Two ordinary rooms and two team rooms, so the ORDER of the two checks inside the GROUP_D branch is tested
// and not merely asserted in a comment.
const YOUTH = 'youthgroup', MARRIAGE = 'marriagecounselling', ELDERS = 'elderspastoral';
const TEAMSAFE = 'creche', TEAMADULT = 'pastoralteam';
let relay, dataDir, pub;

async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content, tags = []) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', NET], ...tags], content: JSON.stringify(content) }, who.sk);
const memberDoc = who => doc(who, MEMBER_D + cp, { joined: now() });
// Exactly the shape src/steward.src.js publishes: `childsafe: true` when the church has marked the room, and
// the key ABSENT otherwise — absent is what "adults-only" looks like on the wire, and it is the default.
const groupDoc = (id, name, extra = {}) => doc(church, GROUP_D + id, { name, kind: extra.kind || 'open', ...extra });
const rosterDoc = (id, people) => doc(church, ROSTER_D + id, { people: people.map(p => ({ pub: p.pub })) });
const chat = (who, gid, text) => finalizeEvent({ kind: 1, created_at: now(), tags: [['t', NET], ['t', gid]], content: text }, who.sk);

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
// WHICH ROOMS DOES THIS PERSON'S CHAT LIST DRAW? Asked the way subscribeChurchGroups asks it — a REQ over the
// group d-tags — and reduced to the NAMES the relay hands back, because the name is the thing at stake.
let _sub = 0;
async function roomsNamedTo(who, ids = [YOUTH, MARRIAGE, ELDERS, TEAMSAFE, TEAMADULT]) {
  const ws = await connect();
  const evs = await reqCollect(ws, 'gd' + (++_sub), { kinds: [30078], '#d': ids.map(i => GROUP_D + i) }, who && who.sk);
  ws.close();
  const names = new Set();
  for (const e of evs) { try { const n = JSON.parse(e.content || '{}').name; if (n) names.add(n); } catch {} }
  return names;
}
async function messagesIn(who, gid) {
  const ws = await connect();
  const evs = await reqCollect(ws, 'm' + (++_sub), { kinds: [1], '#t': [gid] }, who && who.sk);
  ws.close();
  return evs.length;
}

before(async () => {
  await requireFreePort(PORT, 'an-adults-only-rooms-name-is-not-served-to-a-child.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-roomname-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
      stdio: 'ignore' });
  await waitReady();
  pub = await connect();
  for (const who of [mia, ann, sam]) assert.equal((await publish(pub, memberDoc(who)))[0], true, 'joined');
  assert.equal((await publish(pub, doc(church, STEWARDS_D + cp, { pubkeys: [sam.pub], caps: { [sam.pub]: ['content'] } })))[0], true, 'steward roster');
  await sleep(150);
  assert.equal((await publish(pub, groupDoc(YOUTH, 'Youth group', { childsafe: true })))[0], true, 'youth room');
  assert.equal((await publish(pub, groupDoc(MARRIAGE, 'Marriage counselling')))[0], true, 'adults-only room');
  // An INVITE-ONLY adults-only room. It takes a different path through the branch (GROUP_VIS is 'invite', not
  // 'team', so it is not roster-decided) and the relay serves its definition to the whole church — invite
  // membership is honoured on the client. So the name reaches a minor unless this gate stops it.
  assert.equal((await publish(pub, groupDoc(ELDERS, 'Elders — pastoral', { visibility: 'invite', members: [ann.pub] })))[0], true, 'invite-only adults-only room');
  assert.equal((await publish(pub, groupDoc(TEAMSAFE, 'Crèche team', { kind: 'team', childsafe: true })))[0], true, 'child-safe team room');
  assert.equal((await publish(pub, groupDoc(TEAMADULT, 'Pastoral team', { kind: 'team' })))[0], true, 'adults-only team room');
  // Mia is staffed onto BOTH team rooms. A church really does put a 15-year-old on the crèche rota; the
  // adults-only one is the case that decides where the new check has to sit inside the branch.
  assert.equal((await publish(pub, rosterDoc(TEAMSAFE, [mia, ann])))[0], true, 'crèche roster');
  assert.equal((await publish(pub, rosterDoc(TEAMADULT, [mia, ann])))[0], true, 'pastoral roster');
  await sleep(200);
  // One message in each ordinary room, from an adult, so the message gate can be re-anchored below.
  assert.equal((await publish(pub, chat(ann, YOUTH, 'see you Friday')))[0], true, 'youth message');
  assert.equal((await publish(pub, chat(ann, MARRIAGE, 'a difficult call this week')))[0], true, 'adults-only message');
  await sleep(150);
});
after(async () => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('BEFORE anyone marks her, Mia is shown every room — the premise, not the fix', async () => {
  const names = await roomsNamedTo(mia);
  assert.equal(names.has('Marriage counselling'), true, 're-anchor: she was not being served it anyway, so nothing below is a real test');
  assert.equal(names.has('Elders — pastoral'), true, 're-anchor: the invite-only room was not being served to her anyway');
  assert.equal(names.has('Youth group'), true, 're-anchor: the ordinary room list is not working at all');
});

test('the church marks Mia as a child', async () => {
  assert.equal((await publish(pub, doc(church, MINORS_D + cp, { pubkeys: [mia.pub] })))[0], true, 'minors list');
  await sleep(250);
});

test('A YOUNG PERSON IS NOT SERVED THE NAME OF AN ADULTS-ONLY ROOM', async () => {
  const names = await roomsNamedTo(mia);
  assert.equal(names.has('Marriage counselling'), false, 'the adults-only room was named to a child');
  assert.equal(names.has('Elders — pastoral'), false, 'the invite-only adults-only room was named to a child');
});

test('…and the room she IS meant to have still reaches her, so this is not a blank chat list', async () => {
  const names = await roomsNamedTo(mia);
  assert.equal(names.has('Youth group'), true, 'the child-safe room stopped being served — a silent blank screen');
  assert.equal(names.has('Crèche team'), true, 'the child-safe TEAM room she is rostered on stopped being served');
});

// A DECIDED BEHAVIOUR, NOT AN OVERSIGHT — and asserted so that changing it has to be deliberate. The new
// check sits AFTER the team branch, which RETURNS, so a team room is decided by its roster alone. A team room
// is already withheld from everyone the church has not staffed onto it, so the only person this could
// additionally hide it from is a young person the church deliberately put on that team; telling her the name
// of the team she serves on is not a disclosure, and blanking it would take that team's name and icon off her
// own serving view (app/app.jsx `_teamMeta` is fed by this same subscription).
test('a TEAM room she is staffed onto is still named to her, whether or not it is marked child-safe', async () => {
  const names = await roomsNamedTo(mia);
  assert.equal(names.has('Pastoral team'), true, 'a minor lost the name of a team her church rostered her onto');
});

test('…but a team room she is NOT staffed onto stays hidden, as it always was', async () => {
  const sara = K();
  assert.equal((await publish(pub, memberDoc(sara)))[0], true, 'joined');
  await sleep(200);
  const names = await roomsNamedTo(sara);
  assert.equal(names.has('Pastoral team'), false, 're-anchor: the team gate is not working, so the line above proves nothing');
  assert.equal(names.has('Crèche team'), false, 're-anchor: the team gate is not working');
});

test('an ordinary ADULT member still sees every room — the common case, and most of the traffic', async () => {
  const names = await roomsNamedTo(ann);
  for (const n of ['Youth group', 'Marriage counselling', 'Elders — pastoral', 'Crèche team', 'Pastoral team'])
    assert.equal(names.has(n), true, `an adult lost "${n}"`);
});

test('the church and its steward still see every room, so the console can explain what she sees', async () => {
  for (const [who, label] of [[church, 'the church key'], [sam, 'a steward']]) {
    const names = await roomsNamedTo(who);
    for (const n of ['Youth group', 'Marriage counselling', 'Elders — pastoral', 'Crèche team', 'Pastoral team'])
      assert.equal(names.has(n), true, `${label} lost "${n}"`);
  }
});

test('the message gate is unchanged — this fix is about the NAME, not the messages', async () => {
  assert.equal(await messagesIn(mia, MARRIAGE), 0, 're-anchor: a minor is being served an adults-only room’s messages');
  assert.equal(await messagesIn(mia, YOUTH), 1, 're-anchor: a minor lost a child-safe room’s messages');
  assert.equal(await messagesIn(ann, MARRIAGE), 1, 're-anchor: an adult lost the adults-only room’s messages');
});

test('an anonymous reader is served no room definition at all — unchanged, and worth keeping true', async () => {
  const names = await roomsNamedTo(null);
  assert.equal(names.size, 0, 'a stranger was handed the congregation’s room list');
});
