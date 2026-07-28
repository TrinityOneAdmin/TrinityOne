// A member of TWO churches must stay readable in both. Run: node --test scripts/relay-multichurch.test.mjs
//
// AUDIT-2026-07-27. Belonging to two churches is ordinary — someone who moves, serves at a plant, or has
// family in another congregation. The relay tracked it in a single-valued map, member -> ONE church, last
// write wins. Once the kind-0 read gate started consulting that map, whichever member: doc the store
// rehydrated last decided which congregation was allowed to see that person's NAME. In the other church their
// messages rendered as "Anonymous …a1b2c3" forever, in chat and in the directory — and because the client
// re-requests any cached profile that has no name, every phone in that church re-fetched them in every 250 ms
// batch window for the whole session. Leaving one church also deleted the mapping for the other.
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

const PORT = 8901;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const MEMBER_D = 'trinityone/member:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const chA = K(), chB = K();          // two churches on one relay
const dual = K();                    // belongs to BOTH
const onlyA = K(), onlyB = K();      // one each
let relay, dataDir;

const conn = () => new Promise((res, rej) => { const w = new WebSocket(WS_URL); w.on('open', () => res(w)); w.on('error', rej); });
const publish = (w, e) => new Promise(res => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { w.off('message', on); res([m[2], m[3] || '']); } }; w.on('message', on); w.send(JSON.stringify(['EVENT', e])); });
const doc = (who, d, c) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', 'trinityone']], content: JSON.stringify(c) }, who.sk);
const profile = (who, name) => finalizeEvent({ kind: 0, created_at: now(), tags: [['t', 'trinityone']], content: JSON.stringify({ name }) }, who.sk);

// Each reader gets its OWN socket: ws._auth is per-connection, so sharing one would silently make every
// reader the same person (a mistake that made an earlier test assert nothing).
function readAs(who, filter, win = 900) {
  return new Promise(async resolve => {
    const w = await conn();
    const events = [];
    const on = d => { const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === 's') events.push(m[2]);
      else if (m[0] === 'AUTH') w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)])); };
    w.on('message', on);
    w.send(JSON.stringify(['REQ', 's', filter]));
    setTimeout(() => { try { w.close(); } catch {} resolve(events); }, win);
  });
}

before(async () => {
  await requireFreePort(PORT, 'relay-multichurch.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-multichurch-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000',
           CHURCH_NPUB: [npubEncode(chA.pub), npubEncode(chB.pub)].join(',') },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  const w = await conn();
  // Join order matters to the bug: A first, then B, so a single slot ends up holding B.
  await publish(w, doc(dual, MEMBER_D + chA.pub, { joined: now() }));
  await publish(w, doc(dual, MEMBER_D + chB.pub, { joined: now() }));
  await publish(w, doc(onlyA, MEMBER_D + chA.pub, { joined: now() }));
  await publish(w, doc(onlyB, MEMBER_D + chB.pub, { joined: now() }));
  await publish(w, profile(dual, 'Maria'));
  await sleep(400);
  w.close();
});
after(() => { try { relay.kill(); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('the church she joined SECOND can read her name', async () => {
  const got = await readAs(onlyB, { kinds: [0], authors: [dual.pub] });
  assert.equal(got.length, 1, 'her own second church cannot see her name');
});

test('the church she joined FIRST can read her name too', async () => {
  // This is the one that broke: one slot, last write wins, so church A lost her entirely.
  const got = await readAs(onlyA, { kinds: [0], authors: [dual.pub] });
  assert.equal(got.length, 1, 'a member of two churches shows as “Anonymous” to everyone in the church she joined first');
  assert.equal(JSON.parse(got[0].content).name, 'Maria');
});

test('someone in neither church still cannot read her name', async () => {
  const outsider = K();
  const got = await readAs(outsider, { kinds: [0], authors: [dual.pub] });
  assert.equal(got.length, 0, 'the multi-church fix opened the roster to strangers');
});

test('leaving one church does not remove her from the other', async () => {
  const w = await conn();
  await publish(w, finalizeEvent({ kind: 30078, created_at: now() + 1, tags: [['d', MEMBER_D + chB.pub], ['t', 'trinityone'], ['deleted', '1']], content: '' }, dual.sk));
  await sleep(400); w.close();
  const stillA = await readAs(onlyA, { kinds: [0], authors: [dual.pub] });
  assert.equal(stillA.length, 1, 'leaving church B deleted her membership of church A as well');
  const goneB = await readAs(onlyB, { kinds: [0], authors: [dual.pub] });
  assert.equal(goneB.length, 0, 'she left church B but its members can still read her');
});
