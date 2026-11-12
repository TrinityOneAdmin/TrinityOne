// THE RELAYS PANEL MUST NOT BORROW A RED, NOR CALL A HELD RELAY DOWN. 2026-11-11, fix/relay-panel-truth.
// Run: node --test scripts/the-relay-panel-tells-the-truth-2026-11-11.test.mjs
//
// Two display-only fixes in src/steward.src.js, both proven here against the SHIPPED vendor/steward.js (rule 3):
//
//   CHANGE 1 (Option A) — relaySyncState(): the `/status.sync.ok` flag is the relay's BOX-WIDE aggregate (false
//   if ANY church on that box failed its last pass), so the removed `sync.ok === false → Catching up…` branch bled
//   one church's trouble onto every church's chip. A box-wide red must now fall through to blank, never redden
//   this church's "Synced". Lifted and run; the sabotage below re-adds the line and this file goes red.
//
//   CHANGE 2 (R1) — relayStatus(): the online/offline dot is derived from the HELD pool connection (the instance
//   our subscriptions/auth live on), not a throwaway `new WebSocket` dial that a slow/loaded link fails. The whole
//   shipped engine is run in a vm whose sockets NEVER open, so every dial fails — which means any row that reads
//   'on' can only have got there from the held-connection signal, exactly the thing under test. The audit
//   condition (do NOT read 'on' from bare listConnectionStatus()===true — the "connected but not listening"
//   false-GREEN) is pinned by the third case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFellowship } from './fellowship-vm.mjs';

const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

// Slice a method body out of the bundle by its exact signature anchor, brace-matched (same idiom as
// sync-readback-reads-the-gated-doc-authenticated.test.mjs).
function lift(anchor) {
  const i = BUNDLE.indexOf(anchor);
  assert.ok(i > 0, `${anchor} is not in the shipped bundle — rebuild (bash scripts/build-steward.sh) or re-anchor`);
  let d = 0;
  for (let k = BUNDLE.indexOf('{', i); k < BUNDLE.length; k++) {
    if (BUNDLE[k] === '{') d++;
    else if (BUNDLE[k] === '}') { d--; if (!d) return BUNDLE.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces slicing ' + anchor);
}

// ── CHANGE 1: relaySyncState, lifted from the bundle and run (BUNDLE name is the object-method name, kept) ───
function relaySyncState() {
  const body = lift('relaySyncState(sync) {');
  return new Function('Number', 'return (function ' + body + ')')(Number);
}

test('a box-wide ok:false does NOT redden this church\'s chip — it falls through to blank (Option A)', () => {
  const f = relaySyncState();
  // The exact shape the removed branch caught: a box reporting ok:false while THIS church has peers and a dated
  // pass. Before Option A this read { state:'behind', label:'Catching up…' } — a borrowed red. Now it is blank.
  const v = f({ ok: false, error: 'another church on this box failed its pass', peers: 2, at: 123 });
  assert.notEqual(v.state, 'behind', 'THE DEFECT: a box-wide ok:false still reddens this church\'s chip');
  assert.notEqual(v.label, 'Catching up…', 'THE DEFECT: a box-wide ok:false still says "Catching up…" for this church');
  assert.deepEqual(v, { state: 'unknown', label: '' },
    'a box-wide red must fall through to unknown/blank, not a borrowed state');
});

// SABOTAGE CHECK (in-repo, no tree edit): re-adding the removed line is exactly this classifier, so if it ever
// comes back the case above goes red. Here we prove the control is live — the OTHER branches still classify, so
// the removal narrowed one branch and broke nothing else.
test('control: the surviving branches still classify this church\'s own state', () => {
  const f = relaySyncState();
  assert.deepEqual(f({ at: 1700000000, imported: 3, ok: true, error: '', running: false, peers: 1 }),
    { state: 'synced', label: 'Synced' }, 'a clean dated pass with peers must still read Synced');
  assert.equal(f({ ok: true, at: 1700000000, peers: 0 }).state, 'island',
    'peers:0 is still an island — removing the box-wide branch must not touch this one');
  assert.equal(f({ running: true, peers: 1 }).label, 'Catching up…', 'a box mid-import is still catching up');
  assert.equal(f(null).label, '', 'no /status.sync → still say nothing');
});

// ── CHANGE 2: relayStatus, the SHIPPED method, run whole in a vm whose dials never open ──────────────────────
const words = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

async function console_() {
  const { S, exposed } = loadFellowship({ bundle: 'steward', expose: ['pool', '_subbedOn', '_authedRelays', '_authAccepted'] });
  await S.restoreKey(words);
  const first = (await S.relayStatus())[0];
  assert.ok(first && first.url, 'the console has no relays at all — the fixture is wrong');
  return { S, exposed, url: first.url };
}

test('control: every dial fails and the pool holds nothing — the relay is off', async () => {
  const { S } = await console_();
  const all = await S.relayStatus();
  assert.ok(all.length > 0 && all.every(r => r.status === 'off'),
    'the harness should make every dial fail with nothing held: ' + JSON.stringify(all.map(r => [r.url, r.status])));
});

test('a relay the pool HOLDS OPEN and we are subscribed on reads "on" — even though the dial fails', async () => {
  const { S, exposed, url } = await console_();
  const inst = { connected: true };                     // the AbstractRelay our subscriptions live on
  exposed.pool.relays = new Map([[url, inst]]);         // the pool is genuinely holding this socket
  exposed.pool.listConnectionStatus = () => new Map([[url, true]]);
  exposed._subbedOn.set(url, inst);                     // …and it is the instance we subscribed on
  const row = (await S.relayStatus()).find(r => r.url === url);
  assert.equal(row.status, 'on', 'THE DEFECT: a relay carrying the console\'s own traffic is reported Offline');
  assert.equal(row.viaPool, true, 'a held relay must be flagged viaPool');
  assert.equal(row.ms, null, 'no latency was measured, so none should be claimed');
});

test('a relay the pool authed/accepted our login on also reads "on"', async () => {
  const { S, exposed, url } = await console_();
  const inst = { connected: true };
  exposed.pool.relays = new Map([[url, inst]]);
  exposed.pool.listConnectionStatus = () => new Map([[url, true]]);
  exposed._authAccepted.set(url, inst);                 // the relay accepted our NIP-42 on this very socket
  const row = (await S.relayStatus()).find(r => r.url === url);
  assert.equal(row.status, 'on', 'a relay we are authenticated on must read on');
  assert.equal(row.viaPool, true);
});

test('CONNECTED-BUT-NOT-LISTENING is NOT "on" (no false-GREEN): a bare open socket with nothing subscribed/authed', async () => {
  const { S, exposed, url } = await console_();
  const inst = { connected: true };
  exposed.pool.relays = new Map([[url, inst]]);         // an instance IS present and
  exposed.pool.listConnectionStatus = () => new Map([[url, true]]);   // listConnectionStatus says connected…
  // …but NOTHING records that our subscriptions or auth live on it (the dropped-then-reopened-by-a-one-shot-read
  // state relaysHealthy was written to defeat). _subbedOn / _authAccepted / _authedRelays all empty.
  const row = (await S.relayStatus()).find(r => r.url === url);
  assert.equal(row.status, 'off',
    'THE REGRESSION WE MUST NOT INTRODUCE: a connected-but-not-listening socket read "on" from bare ' +
    'listConnectionStatus() — trading the false-RED for the false-GREEN');
  assert.notEqual(row.viaPool, true, 'a connected-but-not-listening socket must not be flagged held');
});

test('the return shape is preserved (url, status, ms, member) so the console callers are unaffected', async () => {
  const { S } = await console_();
  const rows = await S.relayStatus();
  for (const r of rows) {
    assert.ok('url' in r && 'status' in r && 'ms' in r && 'member' in r,
      'a row is missing one of url/status/ms/member: ' + JSON.stringify(r));
    assert.ok(r.status === 'on' || r.status === 'off', 'status must be on|off: ' + r.status);
  }
});
