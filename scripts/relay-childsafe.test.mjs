// SAFEGUARDING: adults-only group chat must be enforced by the RELAY, not by the client's list filter.
// Run: node --test scripts/relay-childsafe.test.mjs
//
// A church marks a group `childsafe` when under-18s may be in it. The member app filtered its group list with
// that flag (app/screens-chat.jsx) — but the relay had never heard of it (`grep childsafe scripts/gateway.mjs`
// returned nothing before this change). So the boundary was a UI preference: a minor on a modified build, an
// old build, or anyone issuing a raw REQ could read and post in adult-only rooms. It was the ONLY safeguarding
// control that wasn't relay-enforced, while the kind-4 DM gate, the NIP-17 block and the care-thread gate all
// were. This proves it now holds at the relay, and that child-safe rooms still work normally.
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

const PORT = 8859;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const MEMBER_D = 'trinityone/member:', GROUP_D = 'trinityone/group:', MINORS_D = 'trinityone/minors:';
const ADULT_G = 'grp-adults-only', KIDS_G = 'grp-youth';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K(), adult = K(), child = K();
let relay, dataDir, pub;

async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', 'trinityone']], content: JSON.stringify(content) }, who.sk);
const chat = (who, gid, text) => finalizeEvent({ kind: 1, created_at: now(), tags: [['t', 'trinityone'], ['t', gid]], content: text }, who.sk);

function reqCollect(ws, subId, filter, authSk, window = 800) {
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
  await requireFreePort(PORT, 'relay-childsafe.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-childsafe-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000', CHURCH_NPUB: npubEncode(church.pub) },
    stdio: 'ignore',
  });
  await waitReady();
  pub = await connect();
  for (const who of [adult, child]) assert.equal((await publish(pub, doc(who, MEMBER_D + church.pub, { joined: now() })))[0], true);
  assert.equal((await publish(pub, doc(church, GROUP_D + ADULT_G, { name: 'Leaders' })))[0], true);                     // no childsafe flag → adults only
  assert.equal((await publish(pub, doc(church, GROUP_D + KIDS_G, { name: 'Youth', childsafe: true })))[0], true);       // explicitly child-safe
  assert.equal((await publish(pub, doc(church, MINORS_D + church.pub, { pubkeys: [child.pub] })))[0], true);
  await sleep(200);
  assert.equal((await publish(pub, chat(adult, ADULT_G, 'adults talking')))[0], true, 'an adult can post in the adult group');
  await sleep(150);
});
after(() => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('a child cannot POST into a group that is not marked child-safe', async () => {
  const [ok] = await publish(pub, chat(child, ADULT_G, 'hello?'));
  assert.equal(ok, false, 'the relay must refuse a minor’s message to an adults-only group');
});

test('a child cannot READ an adults-only group, even authenticated', async () => {
  const ws = await connect();
  const got = await reqCollect(ws, 'c1', { kinds: [1], '#t': [ADULT_G] }, child.sk);
  ws.close();
  assert.equal(got.length, 0, 'a minor must not receive adults-only group messages');
});

test('an adult reads that same group normally (the gate is not a blanket block)', async () => {
  const ws = await connect();
  const got = await reqCollect(ws, 'c2', { kinds: [1], '#t': [ADULT_G] }, adult.sk);
  ws.close();
  assert.ok(got.length >= 1, 'an adult member must still read the adult group');
});

test('a child CAN post and read in a child-safe group', async () => {
  assert.equal((await publish(pub, chat(child, KIDS_G, 'hi youth group')))[0], true, 'a minor may post in a child-safe group');
  await sleep(150);
  const ws = await connect();
  const got = await reqCollect(ws, 'c3', { kinds: [1], '#t': [KIDS_G] }, child.sk);
  ws.close();
  assert.ok(got.length >= 1, 'a minor must be able to read their own youth group');
});

test('a child marking by ANOTHER church does not silence someone here', async () => {
  // MINORS is a relay-wide union of every church's list. Consulting it directly meant a marking made by any
  // co-tenant church silenced that person in EVERY other congregation's adult rooms — which is exactly what
  // happened on the live relay: an ordinary adult member could not post to their own church's main room.
  // Whether someone is a child is a judgement only their OWN church makes (as safeguardAllows already does).
  const other = K();
  assert.equal((await publish(pub, doc(other, MEMBER_D + church.pub, { joined: now() })))[0], true, 'joins this church');
  await sleep(120);
  // church B (a co-tenant) marks them as a child in ITS list — must not affect church A's rooms
  const B = K();
  const bMinors = finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', MINORS_D + B.pub], ['t', 'trinityone']], content: JSON.stringify({ pubkeys: [other.pub] }) }, B.sk);
  await publish(pub, bMinors);
  await sleep(200);
  assert.equal((await publish(pub, chat(other, ADULT_G, 'I am an adult here')))[0], true,
    'another church’s minors list must not restrict this church’s adult group');
});

test('un-marking a group as child-safe takes effect immediately', async () => {
  assert.equal((await publish(pub, doc(church, GROUP_D + KIDS_G, { name: 'Youth' })))[0], true, 'church removes the flag');
  await sleep(200);
  const [ok] = await publish(pub, chat(child, KIDS_G, 'still here?'));
  assert.equal(ok, false, 'once the flag is removed the group is adults-only again');
});
