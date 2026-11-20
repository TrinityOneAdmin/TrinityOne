// A join's read-back must prove THE write, not the stale predecessor (sim 2026-11-20 U1: a rejoin whose
// write never reached any relay read back the pre-leave join — same author, same d — and said "You have
// joined"). Executes the REAL joinNetwork sliced from the SHIPPED vendor/steward.js with real signing;
// stubs are the true externals only. Run: node --test scripts/network-join-readback-proves-the-write.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { fnBody } from './test-slice.mjs';

const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const CSK = generateSecretKey();
const NP = getPublicKey(generateSecretKey());

function rig({ readBack, publishOk = true }) {
  const state = { published: [] };
  const body = fnBody(BUNDLE, 'async joinNetwork(input, jopts) {', 'joinNetwork');
  const S = new Function('churchSk', 'churchPub', 'actingChurch', 'toPubHex', 'relays', '_netWallCheck',
    '_readNetworkJoin', 'NETWORK_SCOPES', 'NETWORK_D', 'NET', '_monotonic', 'now',
    'finalizeEvent', 'finalizeEvent2', 'finalizeEvent3', 'publish', 'npubEncode', '_joinedNets', 'window',
    'return ({ ' + body + ' });')(
    CSK, getPublicKey(CSK), '', (x) => /^[0-9a-f]{64}$/.test(x) ? x : null, () => ['ws://x/relay'],
    async () => ({ lacking: [], unreachable: [] }),
    async () => readBack(state), ['announcements', 'events'], 'trinityone/network:', 'trinityone',
    (e) => e, () => 1795200000,
    finalizeEvent, finalizeEvent, finalizeEvent,
    async (evt) => { state.published.push(evt); return publishOk; }, npubEncode, new Set(), { dispatchEvent: () => {} });
  return { S, state };
}

test('a read-back that returns an OLDER copy refuses the join — existence is not evidence', async () => {
  const { S } = rig({ readBack: () => ({ doc: { joined: true, v: 1 }, ts: 1795100000, id: 'f'.repeat(64) }) });
  const r = await S.joinNetwork(NP);
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'readback');
  assert.match(r.reason, /OLDER copy/, 'the stale read-back was accepted — the sim’s false "You have joined" is back');
});

test('a read-back that returns THE signed document joins (control)', async () => {
  const { S, state } = rig({ readBack: (st) => { const e = st.published[0]; return e ? { doc: JSON.parse(e.content), ts: e.created_at, id: e.id } : null; } });
  const r = await S.joinNetwork(NP, { scopes: ['announcements', 'events'] });
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.scopes, ['announcements', 'events']);
});

test('a publish no relay accepted still refuses at the join stage (control)', async () => {
  const { S } = rig({ publishOk: false, readBack: () => null });
  const r = await S.joinNetwork(NP);
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'join');
});
