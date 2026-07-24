// CROSS-TENANT WRITES into relay-global id namespaces. Run: node --test scripts/relay-tenancy-write.test.mjs
//
// WHY THIS FILE EXISTS. `relay-tenancy.test.mjs` proves church B cannot READ church A's documents. It never
// tested whether B can WRITE into an id namespace A is using — and `group:<id>` / `roster:<id>` are keyed by a
// bare id with no church in the d-tag, so "is a configured church key" was the whole write gate. That gap was
// worth two criticals (AUDIT-2026-07-24), both proven with a live PoC:
//
//   1. B republishes `group:<A's group id>` WITHOUT visibility:invite. The relay's GROUP_VIS now says "open",
//      and canRead() serves every message ever posted in A's private group to ANONYMOUS connections.
//   2. B republishes `roster:<A's care-team id>` listing itself. careAdmin(B, A) becomes true, which is a read
//      grant for A's ask-for-help requests, safeguarding lists and entire member roster.
//
// Both are now refused: an id belongs to the church that first defined it (idOwnerOk), enforced in accept()
// AND in note() (so a forgery already on disk cannot win on rehydrate).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';

const PORT = 8857;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const MEMBER_D = 'trinityone/member:', GROUP_D = 'trinityone/group:', ROSTER_D = 'trinityone/roster:';
const MEALS_SETTINGS_D = 'trinityone/meals-settings', CAREREQ_D = 'trinityone/carereq:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const A = K(), B = K(), alice = K(), mallory = K();   // A = victim church, B = co-tenant attacker church
const GID = 'grpA-private-leadership', TEAM = 'teamA-care';
let relay, dataDir, pub;

async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', 'trinityone'], ...extra], content: JSON.stringify(content) }, who.sk);
// a group message carries ['t', <groupId>] alongside ['t','trinityone'] — that is what gidOf() reads
const chat = (who, gid, text) => finalizeEvent({ kind: 1, created_at: now(), tags: [['t', 'trinityone'], ['t', gid]], content: text }, who.sk);

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

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'trin-xtenant-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000', CHURCH_NPUB: `${npubEncode(A.pub)},${npubEncode(B.pub)}` },
    stdio: 'ignore',
  });
  await waitReady();
  pub = await connect();
  // church A: a member, a PRIVATE (invite-only) leadership group, a care team, and a member's help request
  assert.equal((await publish(pub, doc(alice, MEMBER_D + A.pub, { joined: now() })))[0], true);
  assert.equal((await publish(pub, doc(mallory, MEMBER_D + A.pub, { joined: now() })))[0], true);
  assert.equal((await publish(pub, doc(A, GROUP_D + GID, { name: 'Leadership', visibility: 'invite', members: [alice.pub] })))[0], true);
  assert.equal((await publish(pub, doc(A, ROSTER_D + TEAM, { people: [{ pub: alice.pub }] })))[0], true);
  assert.equal((await publish(pub, doc(A, MEALS_SETTINGS_D, { enabled: true, adminGroupId: TEAM })))[0], true);
  await sleep(150);
  assert.equal((await publish(pub, chat(alice, GID, 'MEETING AT THE FARMHOUSE 9PM')))[0], true, 'a member of the private group can post');
  assert.equal((await publish(pub, doc(alice, CAREREQ_D + 'r1', { keys: {}, enc: 'SEALED' }, [['church', A.pub]])))[0], true);
  await sleep(150);
});
after(() => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('a co-tenant church CANNOT redefine another church’s group id', async () => {
  const [ok] = await publish(pub, doc(B, GROUP_D + GID, { name: 'Leadership', members: [mallory.pub] }));
  assert.equal(ok, false, 'church B redefining A’s group id must be refused');
});

test('the private group’s messages stay withheld from anonymous readers', async () => {
  const ws = await connect(); const got = await reqCollect(ws, 'x1', { kinds: [1], '#t': [GID] }); ws.close();
  assert.equal(got.length, 0, 'an anonymous REQ must not receive a message from an invite-only group');
});

test('a co-tenant church CANNOT rewrite another church’s team roster', async () => {
  const [ok] = await publish(pub, doc(B, ROSTER_D + TEAM, { people: [{ pub: mallory.pub }] }));
  assert.equal(ok, false, 'church B rewriting A’s care-team roster must be refused');
});

test('the hijack does not grant care-admin: A’s sealed help request stays private', async () => {
  const ws = await connect(); const got = await reqCollect(ws, 'x2', { kinds: [30078], '#d': [CAREREQ_D + 'r1'] }, mallory.sk); ws.close();
  assert.equal(got.length, 0, 'a member who forged the roster must not read A’s ask-for-help request');
});

test('the OWNING church can still edit its own group and roster (the guard is not a lockout)', async () => {
  assert.equal((await publish(pub, doc(A, GROUP_D + GID, { name: 'Leadership team', visibility: 'invite', members: [alice.pub, mallory.pub] })))[0], true);
  assert.equal((await publish(pub, doc(A, ROSTER_D + TEAM, { people: [{ pub: alice.pub }, { pub: mallory.pub }] })))[0], true);
});
