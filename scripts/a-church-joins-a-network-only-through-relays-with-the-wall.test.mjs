// A CHURCH JOINS A NETWORK ONLY THROUGH RELAYS THAT CARRY THE NETWORK WALL (plan audit H1; Networks port, 2026-11-18).
//   Run: node --test scripts/a-church-joins-a-network-only-through-relays-with-the-wall.test.mjs   (SOLO -- fixed ports 19876, 19877)
//
// THE POINT OF USE is joinNetwork, the method the Network panel calls, cut out of the SHIPPED bundle (vendor/steward.js) with the whole network
// engine, and run against the REAL gateway (throwaway data dir, spawned after this file is read): its NIP-11 document and /status are what the
// shipped marker check reads, over real HTTP. Beside it, an "old box": a plain HTTP server that answers both the way a relay from before the
// wall does -- no `network-wall-1` anywhere.
//   - the church's relay set is the real gateway only        -> the join is stored on the relay        (CONTROL)
//   - the set is the real gateway + the old box               -> refused, the old box named, NOTHING stored on the real relay
//   - the old box is the only relay                           -> refused
// The relay set is whatever the console already writes to (relays(), stubbed here as the list given): the check adds no relay and admits none.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { K, bootConsole, gatewayRelay } from './net-bundle-rig.mjs';

const PORT = 19876, OLD = 19877;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`, OLD_URL = `ws://127.0.0.1:${OLD}/relay`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const P = 'trinityone/';
const A = K(), N = K();
let relay, oldBox, dataDir, spawnedAt;

before(async () => {
  await requireFreePort(PORT, 'a-church-joins-a-network-only-through-relays-with-the-wall.test.mjs');
  await requireFreePort(OLD, 'a-church-joins-a-network-only-through-relays-with-the-wall.test.mjs (old box)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-wallmark-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(A.pub), RELAY_MAX_EVENTS: '5000' } });
  spawnedAt = Date.now();
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  // an old relay: the same two documents, without the marker (what a box from before 2026-11-18 serves)
  oldBox = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url.startsWith('/status')) res.end(JSON.stringify({ ok: true, relayPub: 'ab'.repeat(32), writePolicy: true }));
    else res.end(JSON.stringify({ name: 'TrinityOne relay', supported_nips: [1, 42], trinityone: { enforces: true, multiChurch: true } }));
  });
  await new Promise((r) => oldBox.listen(OLD, '127.0.0.1', r));
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { oldBox && oldBox.close(); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

const consoleWith = (urls) => bootConsole({ relay: gatewayRelay(WS_URL, A, [A, N]), church: A, joinApi: true, relayUrls: urls });
const joinDocs = async () => (await gatewayRelay(WS_URL, A, [A]).readAs(A, [{ kinds: [30078], authors: [A.pub], '#d': [P + 'network:' + N.pub] }]));

test('FRESHNESS (rule 10): the relay under test was spawned AFTER scripts/gateway.mjs was last written', () => {
  assert.ok(spawnedAt > statSync(new URL('./gateway.mjs', import.meta.url).pathname).mtimeMs);
});

test('the REAL gateway advertises the marker where the shipped check looks (NIP-11 trinityone.capabilities and /status capabilities)', async () => {
  const info = await (await fetch(`http://127.0.0.1:${PORT}/relay`, { headers: { Accept: 'application/nostr+json' } })).json();
  assert.ok(info.trinityone.capabilities.includes('network-wall-1'));
  assert.ok((await (await fetch(`http://127.0.0.1:${PORT}/status`)).json()).capabilities.includes('network-wall-1'));
});

test('REFUSED: the real gateway PLUS one old relay -- not joined, the old relay is named, and nothing reaches the real relay', async () => {
  const c = consoleWith([WS_URL, OLD_URL]);
  const r = await c.api.joinNetwork(npubEncode(N.pub), { scopes: ['announcements', 'events'] });
  assert.equal(r.ok, false, 'a church joined a network while one of its relays runs software without the wall: ' + JSON.stringify(r));
  assert.equal(r.stage, 'relay');
  assert.deepEqual(r.missing, [OLD_URL], 'the refusal named the wrong relays: ' + JSON.stringify(r.missing));
  assert.match(r.reason, new RegExp(String(OLD)), 'the reason does not say which relay');
  assert.equal(c.published.length + c.refused.length, 0, 'something was published although the join was refused');
  assert.deepEqual(await joinDocs(), [], 'a join document reached the real relay');
});

test('REFUSED: the old relay alone', async () => {
  const c = consoleWith([OLD_URL]);
  const r = await c.api.joinNetwork(N.pub);
  assert.equal(r.ok, false); assert.equal(r.stage, 'relay'); assert.deepEqual(r.missing, [OLD_URL]);
  assert.deepEqual(await joinDocs(), []);
});

test('CONTROL: the real gateway alone -- joined, and the join document is on the relay with the consent record', async () => {
  const c = consoleWith([WS_URL]);
  const r = await c.api.joinNetwork(npubEncode(N.pub), { scopes: ['announcements', 'events'] });
  assert.equal(r.ok, true, 'CONTROL: a church could not join through a relay that carries the wall -- the refusals above prove nothing: ' + JSON.stringify(r));
  const docs = await joinDocs();
  assert.equal(docs.length, 1);
  assert.deepEqual(JSON.parse(docs[0].content), { joined: true, v: 1, scopes: ['announcements', 'events'] });
});
