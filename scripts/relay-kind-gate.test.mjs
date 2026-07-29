// An event kind nobody has written a rule for must not be served to strangers.
// Run: node --test scripts/relay-kind-gate.test.mjs
//
// AUDIT-2026-07-29 S1. canRead gates kinds 0, 4, 5, 7 and 30078 with real care and then ended
// `if (e.kind !== 1) return true` — so every other kind fell off the end into default-ALLOW. The kind-30078
// branch directly above was inverted to default-DENY in July for exactly this reason ("a denylist cannot hold
// this line: every new feature is a new leak until someone remembers to edit it"), and the reasoning was never
// carried across to KINDS.
//
// Measured against a real gateway before the fix, publishing as an ordinary member and reading back over an
// ANONYMOUS socket:
//     9802  NIP-84 highlight (a verse you marked)   -> served to a stranger
//     30000 NIP-51 people set ("praying for")       -> served to a stranger
//     10003 NIP-51 bookmarks                        -> served to a stranger
//     30078 church doc (the gated baseline)         -> correctly refused
//
// Not exploitable on the day it was found: the shipped app publishes only 0/1/4/5/7/10002/27235/30078. It
// matters because reference/SPINE.md names all three of those kinds as the intended home for user-owned data
// — highlights as NIP-84, bookmarks and PEOPLE SETS as NIP-51 — and a "praying for" set is a congregation's
// social graph. The day that ships it is world-readable and nothing fails.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8983;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K(), member = K(), stranger = K();
let relay, dataDir;

const conn = () => new Promise((res, rej) => { const w = new WebSocket(WS_URL); w.on('open', () => res(w)); w.on('error', rej); });
const publish = (w, e) => new Promise(res => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { w.off('message', on); res([m[2], m[3] || '']); } };
  w.on('message', on); w.send(JSON.stringify(['EVENT', e]));
  setTimeout(() => res(['(no reply)', '']), 5000);
});
// Read with an optional identity. `as` null = a total stranger who never authenticates.
function read(filter, as) {
  return new Promise(async res => {
    const w = await conn();
    const got = [];
    const on = d => {
      const m = JSON.parse(d);
      if (m[0] === 'AUTH' && as) w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, as.sk)]));
      if (m[0] === 'EVENT' && m[1] === 'q') got.push(m[2]);
      if (m[0] === 'EOSE' && m[1] === 'q') { w.off('message', on); w.close(); res(got); }
    };
    w.on('message', on); w.send(JSON.stringify(['REQ', 'q', filter]));
    setTimeout(() => { try { w.close(); } catch (e) {} res(got); }, 6000);
  });
}

before(async () => {
  await requireFreePort(PORT, 'relay-kind-gate.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-kind-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub) },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  const w = await conn();
  await publish(w, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/member:' + church.pub], ['t', 'trinityone']], content: '{}' }, member.sk));
  w.close();
  await sleep(250);
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

const UNKNOWN = [
  [9802, 'a verse you highlighted (NIP-84)'],
  [30000, 'a "praying for" people set (NIP-51) — a congregation’s social graph'],
  [10003, 'your bookmarks (NIP-51)'],
  [31234, 'a kind nobody has invented a feature for yet'],
];

test('CONTROL: the member can publish these at all', async () => {
  // accept() is deliberately NOT tightened by this fix, so these must still be ACCEPTED. If they were refused
  // the read assertions below would pass for the wrong reason — nothing stored is trivially nothing served.
  const w = await conn();
  for (const [kind, what] of UNKNOWN) {
    const e = finalizeEvent({ kind, created_at: now(), tags: [['d', 'x' + kind]], content: 'SECRET-' + kind }, member.sk);
    const [ok, why] = await publish(w, e);
    assert.equal(ok, true, `kind ${kind} (${what}) was refused on write: ${why} — this test would then prove nothing`);
  }
  w.close();
});

test('a stranger is served none of them', async () => {
  for (const [kind, what] of UNKNOWN) {
    const got = await read({ kinds: [kind], authors: [member.pub] }, null);
    assert.deepEqual(got, [], `kind ${kind} — ${what} — was served to an anonymous stranger`);
  }
});

test('nor is another member of the same church', async () => {
  // Not merely "not anonymous". These are one member's OWN data; belonging to the same congregation is not a
  // reason to read someone's highlights or the list of people they pray for.
  for (const [kind] of UNKNOWN) {
    const got = await read({ kinds: [kind], authors: [member.pub] }, stranger);
    assert.deepEqual(got, [], `kind ${kind} was served to another authenticated member`);
  }
});

test('but the author can still read their own', async () => {
  // The escape hatch that keeps a future feature workable: whatever it stores, its owner can fetch it back.
  for (const [kind, what] of UNKNOWN) {
    const got = await read({ kinds: [kind], authors: [member.pub] }, member);
    assert.equal(got.length, 1, `a member cannot read back their own kind ${kind} (${what}) — that breaks any feature built on it`);
  }
});

// ── the things that must NOT have been broken by closing the tail ────────────────────────────────────────
test('the church’s relay list stays public', async () => {
  // NIP-65, published by the church key, read by members to follow a church whose relay moved. A member who
  // cannot read it cannot find their church, so gating it would break joining — it is named explicitly.
  const w = await conn();
  const [ok, why] = await publish(w, finalizeEvent({ kind: 10002, created_at: now(), tags: [['r', 'wss://relay.example/relay']], content: '' }, church.sk));
  w.close();
  assert.equal(ok, true, 'the church could not publish its relay list: ' + why);
  await sleep(200);
  const got = await read({ kinds: [10002], authors: [church.pub] }, null);
  assert.equal(got.length, 1, 'the church’s relay list is no longer readable — members cannot follow a moved relay');
});

test('the church’s own profile stays public, so people can still join', async () => {
  const w = await conn();
  await publish(w, finalizeEvent({ kind: 0, created_at: now(), tags: [], content: JSON.stringify({ name: 'Test Church' }) }, church.sk));
  w.close();
  await sleep(200);
  const got = await read({ kinds: [0], authors: [church.pub] }, null);
  assert.equal(got.length, 1, 'the church profile is gated — the invite/QR/follow flow reads exactly this before you are a member');
});

test('chat still reaches a member of the church', async () => {
  const w = await conn();
  const msg = finalizeEvent({ kind: 1, created_at: now(), tags: [['t', 'trinityone'], ['p', church.pub]], content: 'hello' }, member.sk);
  const [ok, why] = await publish(w, msg);
  w.close();
  assert.equal(ok, true, 'a member could not post: ' + why);
  await sleep(200);
  const got = await read({ kinds: [1], authors: [member.pub] }, member);
  assert.equal(got.length, 1, 'closing the tail also closed ordinary chat — kind 1 must still work');
});
