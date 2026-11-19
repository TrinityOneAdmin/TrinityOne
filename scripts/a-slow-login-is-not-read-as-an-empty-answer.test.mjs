// A SLOW LOGIN IS NOT READ AS "THERE IS NOTHING" (B1 audit, 2026-11-19).
//   Run: node --test scripts/a-slow-login-is-not-read-as-an-empty-answer.test.mjs   (SOLO -- fixed port 19879)
//
// THE BUG. The relay withholds a private document from a socket that has not logged in, and holds its end-of-stored-events for the login -- but
// only for EOSE_AUTH_GRACE_MS (2.5s, scripts/gateway.mjs). A console on a slow line finishes logging in after that, so the first answer is what an
// ANONYMOUS reader gets, and it arrives looking complete. For the network-key read that is "no key" (the founder's mint door); for the join read it
// is "nobody joined" (the door to dropping churches). THE FIX (src/steward.src.js _queryAsKey): when a relay challenged, wait for the login to settle
// and ask again on the now-logged-in socket; a login that fails or never settles makes the answer INCOMPLETE.
//
// WHAT RUNS: the REAL gateway (throwaway data dir, spawned after this file is read) and the SHIPPED _queryAsKey lifted from vendor/steward.js, on
// the real nostr-tools pool, with a signer that takes 3.5s -- a login slower than the relay's grace. The sabotage removes the re-ask.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { K, NET, gatewayRelay, shippedQueryAsKey, sharedFns, STEWARD } from './net-bundle-rig.mjs';

const PORT = 19879, WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const P = 'trinityone/';
const A = K(), C = K(), N = K();
let relay, dataDir, spawnedAt;
const slow = async (t, sk) => { await sleep(3500); return finalizeEvent(t, sk); };   // a login slower than EOSE_AUTH_GRACE_MS
const KEY_F = [{ kinds: [30078], authors: [N.pub], '#d': [P + 'netkey:' + N.pub], limit: 5 }];
const JOIN_F = [{ kinds: [30078], '#d': [P + 'network:' + N.pub], limit: 500 }];
const NO_REASK = (code) => { const a = 'if (!challenged.length) return first;'; assert.equal(code.split(a).length, 2, 'sabotage anchor not unique in _queryAsKey'); return code.replace(a, 'return first;'); };

before(async () => {
  await requireFreePort(PORT, 'a-slow-login-is-not-read-as-an-empty-answer.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-slowauth-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: [A, C].map((c) => npubEncode(c.pub)).join(','), RELAY_MAX_EVENTS: '5000' } });
  spawnedAt = Date.now();
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  const gw = gatewayRelay(WS_URL, A, [A, C, N]);
  let seq = 0;
  for (const c of [A, C]) assert.equal(await gw.put(finalizeEvent({ kind: 30078, created_at: now() + (seq++), tags: [['d', P + 'network:' + N.pub], ['t', NET], ['p', N.pub]], content: JSON.stringify({ joined: true, v: 1, scopes: ['announcements'] }) }, c.sk)), true);
  const s = sharedFns(STEWARD, ['sealHop1', 'newNetKey']);
  assert.equal(await gw.put(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', P + 'netkey:' + N.pub], ['t', NET]], content: s.sealHop1(N.sk, [s.newNetKey()], [A.pub], 1) }, N.sk)), true);
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('FRESHNESS (rule 10): the relay under test was spawned AFTER scripts/gateway.mjs was last written', () => {
  assert.ok(spawnedAt > statSync(new URL('./gateway.mjs', import.meta.url).pathname).mtimeMs);
});

test('CONTROL: with a fast login the shipped helper reads the network key envelope and both join documents, complete', async () => {
  const k = await shippedQueryAsKey()([WS_URL], N.sk, KEY_F);
  assert.equal(k.complete, true); assert.equal(k.events.length, 1);
  const j = await shippedQueryAsKey()([WS_URL], N.sk, JOIN_F);
  assert.equal(j.complete, true); assert.deepEqual(j.events.map(e => e.pubkey).sort(), [A.pub, C.pub].sort());
});

test('A LOGIN SLOWER THAN THE RELAY\'S GRACE: the envelope and the join documents still come back (re-asked once the login settled)', { timeout: 60000 }, async () => {
  const k = await shippedQueryAsKey(null, { finalize: slow })([WS_URL], N.sk, KEY_F);
  assert.equal(k.events.length, 1, 'a slow login read the network key as ABSENT -- the door a founder mints through: ' + JSON.stringify(k));
  assert.equal(k.complete, true);
  const j = await shippedQueryAsKey(null, { finalize: slow })([WS_URL], N.sk, JOIN_F);
  assert.deepEqual(j.events.map(e => e.pubkey).sort(), [A.pub, C.pub].sort(), 'a slow login read "nobody joined" -- churches would be dropped from the key');
});

test('SABOTAGE (no re-ask): the same slow login gets a FALSE "complete and empty" from the real relay -- the bug, measured', { timeout: 60000 }, async () => {
  const k = await shippedQueryAsKey(NO_REASK, { finalize: slow })([WS_URL], N.sk, KEY_F);
  assert.equal(k.events.length, 0, 'THE SABOTAGE WAS NOT CAUGHT: without the re-ask the slow login still got the envelope (the relay held its answer?)');
  assert.equal(k.complete, true, 'the premise: the first answer arrives looking complete');
});

