// R-7: Deleting an invite-only or team room must CLOSE the read and write gates.
// Before this fix, the tombstone cleared the group maps, so canRead() fell through to
// the default-allow path and accept() skipped the invite/team gates — any member could
// read the room's messages and post new ones.
//   Run: node --test scripts/relay-deleted-room.test.mjs
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

const PORT = 8704;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const MEMBER_D = 'trinityone/member:';
const STEWARDS_D = 'trinityone/stewards:';
const GROUP_D = 'trinityone/group:';
const ROSTER_D = 'trinityone/roster:';
const NET = 'trinityone';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let _t = Math.floor(Date.now() / 1000) - 200; const now = () => ++_t;
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K(), steward = K();
const invited = K();   // member in the invite-only room
const outsider = K();  // member NOT in the invite-only room
const teamMember = K();   // on the team roster
const cp = church.pub;
const INVITE_GID = cp.slice(0, 16) + '-inv1';
const TEAM_GID = cp.slice(0, 16) + '-team1';
let relay, dataDir, ws;

const connect = () => new Promise((res, rej) => { const s = new WebSocket(WS_URL); s.on('open', () => res(s)); s.on('error', rej); });
const send = (sock, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { sock.off('message', on); res([m[2], m[3] || '']); } }; sock.on('message', on); sock.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', NET], ['church', cp], ...extra], content: JSON.stringify(content) }, who.sk);
const msg = (who, group) => finalizeEvent({ kind: 1, created_at: now(), tags: [['t', NET], ['church', cp], ['t', group]], content: 'hello from ' + who.pub.slice(0, 8) }, who.sk);
const tombstone = (who, d) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', NET], ['church', cp], ['deleted', '1']], content: '' }, who.sk);

function reqCollect(ws, subId, filter, authSk, window = 800) {
  return new Promise((resolve) => {
    const events = [];
    const on = (d) => { const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === subId) events.push(m[2]);
      else if (m[0] === 'AUTH' && authSk) ws.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, authSk)])); };
    ws.on('message', on); ws.send(JSON.stringify(['REQ', subId, filter]));
    setTimeout(() => { ws.off('message', on); try { ws.send(JSON.stringify(['CLOSE', subId])); } catch {} resolve(events); }, window);
  });
}

before(async () => {
  await requireFreePort(PORT, 'relay-deleted-room.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-delroom-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
    stdio: 'ignore',
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) break; } catch {} await sleep(150); }
  ws = await connect();

  // register all as members
  for (const who of [invited, outsider, teamMember, steward]) {
    assert.equal((await send(ws, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', MEMBER_D + cp]], content: JSON.stringify({ joined: now() }) }, who.sk)))[0], true, who.pub.slice(0, 8) + ' joined');
  }
  // set steward roster
  assert.equal((await send(ws, doc(church, STEWARDS_D + cp, { pubkeys: [steward.pub], caps: { [steward.pub]: ['content'] } })))[0], true, 'roster');
  await sleep(200);

  // create an invite-only room with `invited` as the only member
  assert.equal((await send(ws, doc(church, GROUP_D + INVITE_GID, {
    name: 'Secret Room', visibility: 'invite', members: [invited.pub],
  })))[0], true, 'invite room created');

  // create a team room with a roster
  assert.equal((await send(ws, doc(church, GROUP_D + TEAM_GID, {
    name: 'Care Team', kind: 'team',
  })))[0], true, 'team room created');
  // set team roster
  assert.equal((await send(ws, doc(church, ROSTER_D + TEAM_GID, {
    pubs: [teamMember.pub],
  })))[0], true, 'team roster');
  await sleep(200);

  // post messages in both rooms
  assert.equal((await send(ws, msg(invited, INVITE_GID)))[0], true, 'invite msg');
  assert.equal((await send(ws, msg(teamMember, TEAM_GID)))[0], true, 'team msg');
  await sleep(200);
});
after(() => { try { ws && ws.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('CONTROL: before deletion, invited member reads the invite room', async () => {
  const cws = await connect();
  const msgs = await reqCollect(cws, 'ci', { kinds: [1], '#t': [INVITE_GID] }, invited.sk);
  cws.close();
  assert.equal(msgs.length, 1, 'invited member sees the message');
});

test('CONTROL: before deletion, outsider cannot read the invite room', async () => {
  const cws = await connect();
  const msgs = await reqCollect(cws, 'co', { kinds: [1], '#t': [INVITE_GID] }, outsider.sk);
  cws.close();
  assert.equal(msgs.length, 0, 'outsider must NOT see invite room messages');
});

test('CONTROL: before deletion, team member reads the team room', async () => {
  const cws = await connect();
  const msgs = await reqCollect(cws, 'ct', { kinds: [1], '#t': [TEAM_GID] }, teamMember.sk);
  cws.close();
  assert.equal(msgs.length, 1, 'team member sees the message');
});

test('after deleting the invite room, outsider still cannot read it', async () => {
  // tombstone the invite room
  assert.equal((await send(ws, tombstone(church, GROUP_D + INVITE_GID)))[0], true, 'tombstone accepted');
  await sleep(200);

  const cws = await connect();
  const msgs = await reqCollect(cws, 'do', { kinds: [1], '#t': [INVITE_GID] }, outsider.sk);
  cws.close();
  assert.equal(msgs.length, 0,
    'DEFECT (pre-fix): after deleting the invite room, outsider reads its messages because ' +
    'GROUP_VIS was cleared and canRead fell through to the default-allow path');
});

test('after deleting the invite room, even the former invited member cannot read it', async () => {
  const cws = await connect();
  const msgs = await reqCollect(cws, 'di', { kinds: [1], '#t': [INVITE_GID] }, invited.sk);
  cws.close();
  assert.equal(msgs.length, 0,
    'after deletion, the former invited member should not read the room');
});

test('after deleting the invite room, the church can still read it (recovery)', async () => {
  const cws = await connect();
  const msgs = await reqCollect(cws, 'dc', { kinds: [1], '#t': [INVITE_GID] }, church.sk);
  cws.close();
  assert.equal(msgs.length, 1, 'the church must still read a deleted room (for recovery/undo)');
});

test('after deleting the team room, outsider cannot read it', async () => {
  // tombstone the team room
  assert.equal((await send(ws, tombstone(church, GROUP_D + TEAM_GID)))[0], true, 'team tombstone accepted');
  await sleep(200);

  const cws = await connect();
  const msgs = await reqCollect(cws, 'dt', { kinds: [1], '#t': [TEAM_GID] }, outsider.sk);
  cws.close();
  assert.equal(msgs.length, 0,
    'DEFECT (pre-fix): after deleting the team room, outsider reads its messages');
});

test('after deleting a room, new posts are refused', async () => {
  // try to post into the deleted invite room
  const [ok, reason] = await send(ws, msg(invited, INVITE_GID));
  assert.equal(ok, false, 'a post into a deleted room must be refused, got: ' + ok + ' ' + reason);
});

test('UNDO: re-publishing the invite room definition restores access', async () => {
  // re-publish the invite room (undo)
  assert.equal((await send(ws, doc(church, GROUP_D + INVITE_GID, {
    name: 'Secret Room', visibility: 'invite', members: [invited.pub],
  })))[0], true, 'undo: re-publish');
  await sleep(200);

  // invited member should be able to read again
  const cws = await connect();
  const msgs = await reqCollect(cws, 'ui', { kinds: [1], '#t': [INVITE_GID] }, invited.sk);
  cws.close();
  assert.equal(msgs.length, 1, 'after undo, invited member reads the room again');

  // outsider still cannot
  const cws2 = await connect();
  const msgs2 = await reqCollect(cws2, 'uo', { kinds: [1], '#t': [INVITE_GID] }, outsider.sk);
  cws2.close();
  assert.equal(msgs2.length, 0, 'after undo, outsider still cannot read the invite room');
});

test('the member hub filter (#p) does not leak deleted rooms', async () => {
  // re-delete the invite room
  assert.equal((await send(ws, tombstone(church, GROUP_D + INVITE_GID)))[0], true, 're-tombstone');
  await sleep(200);

  // the member hub uses {kinds:[1], '#p':[cp]} — this must not return deleted-room messages
  const cws = await connect();
  const msgs = await reqCollect(cws, 'hp', { kinds: [1], '#p': [cp] }, outsider.sk);
  cws.close();
  // filter for only messages from our test rooms
  const leaked = msgs.filter(e => (e.tags || []).some(t => t[0] === 't' && (t[1] === INVITE_GID || t[1] === TEAM_GID)));
  assert.equal(leaked.length, 0,
    'DEFECT (pre-fix): the #p filter leaks deleted room messages to any member');
});
