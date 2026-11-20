// A CONSOLE NEVER MINTS A SECOND NETWORK KEY OVER THE REAL ONE -- whatever the relay withholds from it (Networks port, 2026-11-18).
//   Run: node --test scripts/a-founder-never-mints-a-second-network-key.test.mjs   (SOLO -- fixed port 19878)
//
// WHY THIS FILE EXISTS. bdb0092d narrowed the relay: netkey:<np> (the network's hop-1 key envelope) is now served to its AUTHOR and to a church
// key that is one of its RECIPIENTS -- nobody else. A console's ordinary pool is logged in as its CHURCH. So a founder console reading the
// envelope through that pool, while its church is not (or not yet, or no longer) a recipient, is told "nothing here" by a relay that holds the
// real ring -- and "nothing here" is the one answer that lets a founder mint. A second ring over the first stops every sealed post opening for
// every church. THE FIX (src/steward.src.js _netRingFor): a console that HOLDS the network key reads the envelope AS THE NETWORK, on a socket of
// its own (_queryAsKey), so the relay never withholds it; and that read reports whether every relay answered, so a partial read is "unknown".
//
// WHAT RUNS: the REAL gateway (throwaway data dir, spawned after this file is read); the console engine cut out of the SHIPPED vendor/steward.js
// by scripts/net-bundle-rig.mjs; and the SHIPPED _queryAsKey on the real nostr-tools pool. The console's pool reads as its church (gatewayRelay).
// Every guard is sabotaged in the lifted source, scoped to its own function, and each sabotage turns its test red.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { K, rnd32, NET, bootConsole, gatewayRelay, shippedQueryAsKey, sharedFns, scoped, STEWARD } from './net-bundle-rig.mjs';

const PORT = 19878, WS_URL = `ws://127.0.0.1:${PORT}/relay`, DEAD_URL = 'ws://127.0.0.1:1/relay';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const P = 'trinityone/';
const A = K(), C = K(), F = K();                   // A: the founder's church; C: a joined church; F: a church whose console imported a network key
const NETS = Array.from({ length: 9 }, () => K());  // one network per scenario, so no test inherits another's ring
const ALL = [A, C, F, ...NETS];
const seal = sharedFns(STEWARD, ['sealHop1', 'newNetKey', 'openHop1AsNetwork']);
let relay, dataDir, spawnedAt, seq = 0;

before(async () => {
  await requireFreePort(PORT, 'a-founder-never-mints-a-second-network-key.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-nomint-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: [A, C, F].map((c) => npubEncode(c.pub)).join(','), RELAY_MAX_EVENTS: '20000' } });
  spawnedAt = Date.now();
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

const gw = (asChurch) => gatewayRelay(WS_URL, asChurch, ALL);
const joinAs = async (church, N) => { const r = await gw(church).put(finalizeEvent({ kind: 30078, created_at: now() + (seq++), tags: [['d', P + 'network:' + N.pub], ['t', NET], ['p', N.pub]], content: JSON.stringify({ joined: true, v: 1, scopes: ['announcements', 'events'] }) }, church.sk)); assert.equal(r, true, 'setup: join refused ' + JSON.stringify(r)); };
// publish a REAL ring for N wrapped ONLY to `recipients` (what the network did from some other console, before this one ever looked)
const ringWrappedTo = async (N, recipients) => {
  const k = seal.newNetKey();
  const content = seal.sealHop1(N.sk, [k], recipients.map(c => c.pub), 1);
  const r = await gw(A).put(finalizeEvent({ kind: 30078, created_at: now() - 60, tags: [['d', P + 'netkey:' + N.pub], ['t', NET]], content }, N.sk));   // in the past: what a console publishes next is newer
  assert.equal(r, true, 'setup: hop-1 refused ' + JSON.stringify(r));
  return k;
};
// the stored hop-1 as the NETWORK sees it: { key: ring[0], recipients, id }
const stored = async (N) => {
  const ev = (await gw(A).readAs(N, [{ kinds: [30078], authors: [N.pub], '#d': [P + 'netkey:' + N.pub] }]))[0];
  if (!ev) return null;
  const ring = seal.openHop1AsNetwork(ev.content, N.sk);
  return { id: ev.id, key: ring && ring[0], recipients: Object.keys(JSON.parse(ev.content).keys).sort() };
};
const founderConsole = (N, o = {}) => bootConsole({ relay: gw(A), church: A, networks: [N], founded: [N.pub], nameKey: rnd32(), relayUrl: WS_URL, queryAsKey: shippedQueryAsKey(), ...o });
const SYNC_KEY = ['async function _netSyncKey(', 'async function _netSyncHop2('];

test('FRESHNESS (rule 10): the relay under test was spawned AFTER scripts/gateway.mjs was last written', () => {
  assert.ok(spawnedAt > statSync(new URL('./gateway.mjs', import.meta.url).pathname).mtimeMs);
});

test('THE PREMISE, measured: the real relay withholds the envelope from a founder\'s CHURCH key that is not a recipient, and serves it to the network', async () => {
  const N = NETS[0];
  await joinAs(A, N); await joinAs(C, N);
  await ringWrappedTo(N, [C]);
  assert.deepEqual(await gw(A).readAs(A, [{ kinds: [30078], authors: [N.pub], '#d': [P + 'netkey:' + N.pub] }]), [], 'the relay served the envelope to a joined church it was not wrapped to');
  assert.ok(await stored(N), 'CONTROL: the network itself was not served its own envelope');
});

test('CONTROL: a genuine FIRST create mints -- founder, nothing on the relay, every relay answered', async () => {
  const N = NETS[1];
  await joinAs(A, N);
  const c = founderConsole(N);
  const r = await c.api.syncNetworkKey(N.pub);
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.minted, true, 'the founder could not start the first ring -- the refusals below prove nothing');
  assert.deepEqual((await stored(N)).recipients, [A.pub]);
  assert.equal(c.ls.get('trinityone.netring.seen.' + N.pub), '1', 'a published ring was not remembered');
});

test('FOUNDER, CHURCH NOT A RECIPIENT, FRESH DEVICE: it reads the real ring AS THE NETWORK, adds its church, and keeps the SAME key', async () => {
  const N = NETS[0];   // set up by THE PREMISE: a ring wrapped only to C
  const before_ = await stored(N);
  const c = founderConsole(N);   // fresh localStorage: nothing seen yet, founder flag set
  const r = await c.api.syncNetworkKey(N.pub);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.notEqual(r.minted, true, 'THE FOUNDER MINTED A SECOND RING over the real one');
  const after_ = await stored(N);
  assert.equal(after_.key, before_.key, 'the ring key changed -- every post sealed under it would stop opening');
  assert.deepEqual(after_.recipients, [A.pub, C.pub].sort(), 'the founder\'s church was not added, or C was dropped');
});

test('SABOTAGE (read through the church pool, as before the fix): the same founder on a fresh device MINTS over the real ring', async () => {
  const N = NETS[2];
  await joinAs(A, N); await joinAs(C, N);
  const real = await ringWrappedTo(N, [C]);
  const c = founderConsole(N, { mutate: (s) => scoped(s, 'async function _netRingFor(', 'async function _ownJoinLive(', 'holder ? nsk : null', 'null') });
  const r = await c.api.syncNetworkKey(N.pub);
  assert.equal(r.minted, true, 'THE SABOTAGE WAS NOT CAUGHT: reading as the church, the founder still did not mint -- the test above proves nothing');
  assert.notEqual((await stored(N)).key, real, 'with the sabotage the ring should have been replaced');
});

test('FOUNDER, A READ THAT FAILED (no relay answered): it waits and publishes nothing; and the sabotaged guard mints', async () => {
  const N = NETS[3];
  await joinAs(A, N); await joinAs(C, N);
  const real = await ringWrappedTo(N, [C]);
  const failing = async () => ({ events: [], complete: false });
  const c = founderConsole(N, { queryAsKey: failing });
  const r = await c.api.syncNetworkKey(N.pub);
  assert.equal(r.ok, false); assert.equal(r.waiting, true); assert.notEqual(r.minted, true);
  assert.equal(c.published.length, 0, 'a failed read published something');
  assert.equal((await stored(N)).key, real);
  // the readFailed guard in _netSyncKey removed: a fresh founder takes "could not look" as "nothing there"
  const s = founderConsole(N, { queryAsKey: failing, mutate: (src) => scoped(src, SYNC_KEY[0], SYNC_KEY[1], 'if (cur.readFailed) return { ok: false, waiting: true, reason: "Could not read the current network key just now \\u2014 it will try again rather than replace it." };', '') });
  const rs = await s.api.syncNetworkKey(N.pub);
  assert.equal(rs.minted, true, 'THE SABOTAGE WAS NOT CAUGHT: without the readFailed guard the founder still did not mint');
});

test('FOUNDER WHOSE ONLY RELAY IS UNREACHABLE (the SHIPPED _queryAsKey): "complete" is false, so it waits; with completeness faked it mints', async () => {
  const N = NETS[4];
  await joinAs(A, N); await joinAs(C, N);
  const real = await ringWrappedTo(N, [C]);
  // (2026-11-19: the wall probe is not under test here -- a dead relay can never confirm it, and the gate would stop this before the read. Stub it.)
  const wallOk = async () => ({ ok: true, json: async () => ({ trinityone: { capabilities: ['network-wall-1'] } }) });
  const c = founderConsole(N, { relayUrls: [DEAD_URL], fetchImpl: wallOk });
  const r = await c.api.syncNetworkKey(N.pub);
  assert.equal(r.waiting, true, JSON.stringify(r)); assert.equal(c.published.length, 0);
  assert.equal((await stored(N)).key, real);
  const lie = shippedQueryAsKey((code) => { const a = 'complete: Array.isArray(reasons) && reasons.length === list.length && reasons.every((r) => r === "closed automatically on eose")'; assert.equal(code.split(a).length, 2, 'sabotage anchor not unique in _queryAsKey'); return code.replace(a, 'complete: true'); });
  const s = founderConsole(N, { relayUrls: [DEAD_URL], queryAsKey: lie, fetchImpl: wallOk });
  assert.equal((await s.api.syncNetworkKey(N.pub)).minted, true, 'THE SABOTAGE WAS NOT CAUGHT: an unreachable relay reported as complete still did not mint');
});

test('RESTART: the same device after a reboot (same localStorage) -- an empty read waits (NETRING_SEEN), a real read leaves the key alone; without the seen-guard it mints', async () => {
  const N = NETS[5];
  await joinAs(A, N);
  const first = founderConsole(N);
  assert.equal((await first.api.syncNetworkKey(N.pub)).minted, true, 'setup: first mint');
  const real = (await stored(N)).key;
  // the reboot: a new console on the same device storage, whose first look at the relay comes back empty but complete (a relay just restarted)
  const empty = async (u, sk, f) => ({ events: [], complete: true });
  const again = founderConsole(N, { ls: first.ls, queryAsKey: empty });
  const r = await again.api.syncNetworkKey(N.pub);
  assert.equal(r.waiting, true, JSON.stringify(r)); assert.equal(again.published.length, 0, 'an empty read after a restart published a ring');
  const normal = founderConsole(N, { ls: first.ls });
  assert.equal((await normal.api.syncNetworkKey(N.pub)).unchanged, true, 'a normal read after a restart changed the envelope');
  assert.equal((await stored(N)).key, real);
  const s = founderConsole(N, { ls: first.ls, queryAsKey: empty, mutate: (src) => scoped(src, SYNC_KEY[0], SYNC_KEY[1], 'if (lsGet(NETRING_SEEN_LS + np) === "1") return { ok: false, waiting: true, reason: "The network key could not be read just now; a new one will not be minted over the existing one." };', '') });
  assert.equal((await s.api.syncNetworkKey(N.pub)).minted, true, 'THE SABOTAGE WAS NOT CAUGHT: without the seen-guard a restarted founder still did not mint on an empty read');
});

test('A NON-FOUNDER that holds the key (imported) never mints: it re-seals a ring it can read, and refuses when there is none; without the founder guard it mints', async () => {
  const N = NETS[6];
  await joinAs(F, N); await joinAs(C, N);
  const real = await ringWrappedTo(N, [C]);
  const imp = bootConsole({ relay: gw(F), church: F, networks: [N], founded: [], nameKey: rnd32(), relayUrl: WS_URL, queryAsKey: shippedQueryAsKey() });
  const r = await imp.api.syncNetworkKey(N.pub);
  assert.notEqual(r.minted, true, 'an imported key minted a ring');
  assert.equal((await stored(N)).key, real, 'an imported key replaced the ring');
  // no ring at all: the importer may not start one (only the console that created the network can)
  const N2 = NETS[7];
  await joinAs(F, N2);
  const none = bootConsole({ relay: gw(F), church: F, networks: [N2], founded: [], nameKey: rnd32(), relayUrl: WS_URL, queryAsKey: shippedQueryAsKey() });
  const r2 = await none.api.syncNetworkKey(N2.pub);
  assert.equal(r2.ok, false); assert.equal(r2.waiting, true); assert.equal(none.published.length, 0, 'a non-founder started a ring');
  const s = bootConsole({ relay: gw(F), church: F, networks: [N2], founded: [], nameKey: rnd32(), relayUrl: WS_URL, queryAsKey: shippedQueryAsKey(),
    mutate: (src) => scoped(src, 'function _netMintBlockers(', 'async function _netRingFor(', 'notFounder: lsGet(NETRING_MINT_LS + np) !== "1"', 'notFounder: false') });
  assert.equal((await s.api.syncNetworkKey(N2.pub)).minted, true, 'THE SABOTAGE WAS NOT CAUGHT: without the founder guard the importer still did not mint');
});

test('A JOINED CHURCH NOT YET IN THE KEY (no network key on its console): it cannot mint, publishes nothing, and says honestly it is waiting -- until the founder adds it', async () => {
  const N = NETS[8];
  await joinAs(A, N); await joinAs(C, N);
  const founder = founderConsole(N);
  assert.equal((await founder.api.syncNetworkKey(N.pub)).minted, true, 'setup');   // wraps only A: C has joined but nobody has told the founder yet
  const cC = bootConsole({ relay: gw(C), church: C, networks: [], nameKey: rnd32(), relayUrl: WS_URL, queryAsKey: shippedQueryAsKey() });
  const k = await cC.api.syncNetworkKey(N.pub);
  assert.equal(k.ok, false); assert.match(k.reason, /does not hold/);
  const h2 = await cC.api.syncNetworkHop2(N.pub);
  assert.equal(h2.ok, false); assert.equal(h2.waiting, true, 'a joined church not yet in the key must be WAITING, not in trouble');
  assert.equal(h2.reason, 'Waiting for the network to add this church to its key.', 'the reason must not claim the network has published nothing');
  assert.equal(cC.published.length, 0);
  const all = await cC.api.syncNetworkKeys({ force: true });
  assert.equal(all.ok, true); assert.equal(cC.api.networkStatus(N.pub).key, 'waiting', 'the status the Network panel will read is not "waiting"');
  // the founder's sync discovers C (N5c) and wraps it; C can now re-seal for its members
  assert.equal((await founder.api.syncNetworkKeys({ force: true })).ok, true);
  assert.deepEqual((await stored(N)).recipients, [A.pub, C.pub].sort(), 'the founder did not add the church that joined');
  assert.equal((await cC.api.syncNetworkHop2(N.pub)).ok, true, 'C still cannot open the ring after being added');
});
