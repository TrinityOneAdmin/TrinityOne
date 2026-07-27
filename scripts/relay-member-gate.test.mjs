// Two things a relay must never do, both found on 2026-07-27 and both reproduced against a real relay first.
// Run: node --test scripts/relay-member-gate.test.mjs
//
// 1. "AUTHENTICATED" IS NOT "MEMBER". canRead's kind-1 path had no membership test at all, and AUTH accepted
//    any key that could sign (`verifyEvent(evt) && !BLOCKED.has(evt.pubkey)`). So a keypair generated one
//    second ago read every open group of every church on the box. The comment above that code claimed it
//    "stops a passer-by harvesting a congregation's chat"; it did not. relay-childsafe.test.mjs could not see
//    this because every read it makes is authenticated AS A MEMBER — the one shape that was never tested.
//
// 2. ONE MALFORMED FILTER MUST NOT SILENCE THE CHURCH. `matchFilter` guarded the filter object but never that
//    `f.ids`/`f.authors`/`f.kinds` were arrays, so `{"ids":1}` threw a TypeError. Filters are stored verbatim
//    before anything validates them, the broadcast loop has no try/catch, and `process.on('uncaughtException')`
//    logs and keeps serving — so one frame from an anonymous socket stopped live delivery for everyone else
//    while the relay stayed up and looked healthy. No error reached any client.
//
// Both are written as "a stranger tries it and fails", because the failing case is the whole point.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';

const PORT = 8896;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs — a duplicate deadlocks both
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const MEMBER_D = 'trinityone/member:', GROUP_D = 'trinityone/group:';
const OPEN_G = 'grp-open', KIDS_G = 'grp-youth';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K(), member = K(), stranger = K(), other = K();
let relay, dataDir, wsPub;

const conn = () => new Promise((res, rej) => { const w = new WebSocket(WS_URL); w.on('open', () => res(w)); w.on('error', rej); });
const publish = (w, e) => new Promise(res => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { w.off('message', on); res(m[2]); } }; w.on('message', on); w.send(JSON.stringify(['EVENT', e])); });
const doc = (who, d, c) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', 'trinityone']], content: JSON.stringify(c) }, who.sk);
const chat = (who, g, t) => finalizeEvent({ kind: 1, created_at: now(), tags: [['t', 'trinityone'], ['t', g]], content: t }, who.sk);

// Read with a subscription that answers an AUTH challenge using `authSk` (or ignores it when null).
function reqCollect(w, subId, filter, authSk, window = 900) {
  return new Promise(resolve => {
    const events = [];
    const on = d => {
      const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === subId) events.push(m[2]);
      else if (m[0] === 'AUTH' && authSk) w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, authSk)]));
    };
    w.on('message', on);
    w.send(JSON.stringify(['REQ', subId, filter]));
    setTimeout(() => { w.off('message', on); try { w.send(JSON.stringify(['CLOSE', subId])); } catch {} resolve(events); }, window);
  });
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'trin-membergate-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000', CHURCH_NPUB: npubEncode(church.pub) },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  wsPub = await conn();
  assert.equal(await publish(wsPub, doc(member, MEMBER_D + church.pub, { joined: now() })), true);
  assert.equal(await publish(wsPub, doc(church, GROUP_D + OPEN_G, { name: 'Sunday Group' })), true);            // open: not invite-only, not child-safe
  assert.equal(await publish(wsPub, doc(church, GROUP_D + KIDS_G, { name: 'Youth', childsafe: true })), true);   // child-safe
  await sleep(250);
  assert.equal(await publish(wsPub, chat(member, OPEN_G, 'private congregation chat')), true, 'a member must be able to post');
  assert.equal(await publish(wsPub, chat(member, KIDS_G, 'youth group chat')), true);
  await sleep(200);
});
after(() => { try { wsPub && wsPub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('a member reads their own church’s open group', async () => {
  const w = await conn();
  const got = await reqCollect(w, 'a', { kinds: [1], '#t': [OPEN_G] }, member.sk);
  w.close();
  assert.equal(got.length, 1, 'a real member must still be able to read — this is the control');
});

test('an AUTHENTICATED stranger who is a member of nothing reads NOTHING', async () => {
  const w = await conn();
  const got = await reqCollect(w, 'b', { kinds: [1], '#t': [OPEN_G] }, stranger.sk);
  w.close();
  assert.deepEqual(got.map(e => e.content), [],
    'a keypair generated seconds ago read the congregation’s chat — "authenticated" is not "member"');
});

test('an authenticated stranger cannot harvest the whole relay with a bare kinds filter', async () => {
  const w = await conn();
  const got = await reqCollect(w, 'c', { kinds: [1] }, stranger.sk);
  w.close();
  assert.deepEqual(got.map(e => e.content), [], 'the broad-query route around the group filter must be closed too');
});

test('an ANONYMOUS reader gets nothing, including from a child-safe group', async () => {
  const w = await conn();
  const open = await reqCollect(w, 'd', { kinds: [1], '#t': [OPEN_G] }, null);
  const kids = await reqCollect(w, 'e', { kinds: [1], '#t': [KIDS_G] }, null);
  w.close();
  assert.deepEqual(open.map(e => e.content), [], 'anonymous read of an open group');
  assert.deepEqual(kids.map(e => e.content), [],
    'the child-safe carve-out left the youth group — the one containing children — as the only anonymously readable chat');
});

test('a member is still CHALLENGED for a child-safe group, so their client can authenticate', async () => {
  // The gate is worthless if the client is never told to authenticate: it would just render an empty room.
  const w = await conn();
  let challenged = false;
  const on = d => { const m = JSON.parse(d); if (m[0] === 'AUTH') challenged = true; };
  w.on('message', on);
  w.send(JSON.stringify(['REQ', 'f', { kinds: [1], '#t': [KIDS_G] }]));
  await sleep(700);
  w.off('message', on); w.close();
  assert.ok(challenged, 'no AUTH challenge for a child-safe group — a member’s app would show an empty room forever');
});

test('a member of ANOTHER church cannot read this church’s group', async () => {
  const w = await conn();
  await publish(w, doc(other, MEMBER_D + other.pub, { joined: now() }));   // a member doc naming a church that isn't ours
  await sleep(200);
  const got = await reqCollect(w, 'g', { kinds: [1], '#t': [OPEN_G] }, other.sk);
  w.close();
  assert.deepEqual(got.map(e => e.content), [], 'cross-tenant read of a congregation’s chat');
});

test('one malformed filter cannot silence live delivery for everyone else', async () => {
  // ORDER MATTERS, and getting it wrong made me briefly believe I had proved this when I had not.
  // The broadcast loop walks `subs` in insertion order, so a throw part-way through only starves the clients
  // registered AFTER the poisoned one. The poison must therefore connect FIRST. (My first attempt put an
  // ANONYMOUS victim ahead of it and read the resulting zero as the DoS — it was just the auth gate working.)
  const poison = await conn();
  for (const bad of [{ ids: 1 }, { authors: 'abc' }, { kinds: 1 }, { '#t': 5 }, { ids: { a: 1 } }]) {
    poison.send(JSON.stringify(['REQ', 'p' + Math.random().toString(36).slice(2), bad]));
    await sleep(60);
  }
  await sleep(300);

  const victim = await conn();
  const live = [];
  victim.on('message', d => {
    const m = JSON.parse(d);
    if (m[0] === 'EVENT' && m[1] === 'v') live.push(m[2]);
    if (m[0] === 'AUTH') victim.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, member.sk)]));
  });
  victim.send(JSON.stringify(['REQ', 'v', { kinds: [1], '#t': [OPEN_G] }]));
  await sleep(900);
  const before = live.length;

  const w2 = await conn();
  assert.equal(await publish(w2, chat(member, OPEN_G, 'message sent AFTER the poison')), true,
    'the publisher must still get an OK — the relay stays up, which is what makes this silent');
  await sleep(1000);
  victim.close(); poison.close(); w2.close();
  assert.equal(live.length - before, 1,
    'a member stopped receiving live messages after a stranger sent one malformed filter — and the relay stayed up, so nothing looked wrong');
  assert.ok((await fetch(`http://127.0.0.1:${PORT}/status`)).ok, 'the relay must survive a malformed filter');
});

// ── kind-0 / 5 / 7 (AUDIT-2026-07-27) ──────────────────────────────────────────────────────────────────────
// canRead ended `if (e.kind !== 1) return true;`. kind-1 and kind-4 were carefully gated and everything else
// fell off the end into default-allow. So an anonymous socket could ask for {kinds:[0]} and receive every
// member's display name and verified handle — on a single-church relay, that IS the congregation, i.e. the
// arrest list. Worse, a reaction is a kind-7 carrying ['p', peer] and ['k','4'] in cleartext, so {kinds:[7]}
// partly reconstructs the very DM graph the kind-4 gate exists to withhold, and kind-0 puts names to it.
// A CHURCH's own kind-0 must stay public — someone deciding whether to join has to see its name first.

const profile = (who, name) => finalizeEvent({ kind: 0, created_at: now(), tags: [], content: JSON.stringify({ name }) }, who.sk);
const reaction = (who, targetId, peerPub) => finalizeEvent({ kind: 7, created_at: now(), tags: [['e', targetId], ['p', peerPub], ['t', 'trinityone'], ['k', '4']], content: '+' }, who.sk);

test('an anonymous stranger cannot harvest the congregation’s names', async () => {
  const w = await conn();
  assert.equal(await publish(w, profile(member, 'Maria Alvarez')), true);
  assert.equal(await publish(w, profile(church, 'St Mary’s')), true);
  await sleep(250);
  const got = await reqCollect(w, 'p1', { kinds: [0] }, null);
  const names = got.map(e => { try { return JSON.parse(e.content).name; } catch { return ''; } });
  w.close();
  assert.ok(!names.includes('Maria Alvarez'),
    'an unauthenticated socket read a member’s real name — on a church’s own relay that is the whole roster');
});

test('a church’s OWN profile stays public, so joining still works', async () => {
  const w = await conn();
  const got = await reqCollect(w, 'p2', { kinds: [0], authors: [church.pub] }, null);
  w.close();
  const names = got.map(e => { try { return JSON.parse(e.content).name; } catch { return ''; } });
  assert.ok(names.includes('St Mary’s'),
    'the church’s own profile must stay readable or nobody can see who they are about to join');
});

test('a member of the church can still read another member’s name', async () => {
  const w = await conn();
  const got = await reqCollect(w, 'p3', { kinds: [0], authors: [member.pub] }, member.sk);
  w.close();
  const names = got.map(e => { try { return JSON.parse(e.content).name; } catch { return ''; } });
  assert.ok(names.includes('Maria Alvarez'), 'members must still see each other’s names — this is the control');
});

test('an anonymous stranger cannot reconstruct the DM graph from reactions', async () => {
  const w = await conn();
  const target = 'a'.repeat(64);
  assert.equal(await publish(w, reaction(member, target, other.pub)), true);
  await sleep(250);
  const got = await reqCollect(w, 'r1', { kinds: [7] }, null);
  w.close();
  assert.deepEqual(got.map(e => e.pubkey), [],
    'reactions carry ["p",peer] and ["k","4"] in cleartext — serving them anonymously undoes the kind-4 gate');
});
