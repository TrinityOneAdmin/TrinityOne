// A JOINED NETWORK KEY READS AND WRITES NO FINANCE, HOLDS NO ROOM KEY, AND THE RELAY SAYS IT HAS THE WALL.
// Run: node --test scripts/a-network-key-reads-no-finance-and-no-room-keys.test.mjs
//
// OWNER DECISION 2026-11-18 (binding): a church's JOINED network key gets none of finance (ALL finance/ docs, the aggregate
// journal / accounts / funds included -- this reverses the 2026-10-30 / 2026-11-07 position) and none of the sealed group-room
// key envelopes (GROUPKEY_D). It also advertises `network-wall-1` so a client can later refuse to join a network on a relay
// that lacks the wall.
//
// REAL GATEWAY on a throwaway data dir (relay-network-harness: own port, own dir, torn down in after()). The church publishes
// the join doc `trinityone/network:<networkpub>` from its OWN key -- the only way networkOf() becomes true.
//
// NON-VACUITY. (a) CONTROL: the network key IS a live network -- a kind-1 line a stranger is refused is ACCEPTED from it.
// (b) every refusal is paired with the church AND the right steward being SERVED/ACCEPTED the same document.
// (c) sabotage record: re-adding `networkOf(authed, cp) ||` to the generic finance/ read, or `networkOf(e.pubkey, owner) ||` to the
// GROUPKEY_D write, fails the matching tests below (scoped to the enclosing branch; see the commit message).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import * as H from './relay-network-harness.mjs';
import { D } from './trinity-doc-types.mjs';
import { finalizeEvent } from 'nostr-tools/pure';

const NET = 'trinityone';
const church = H.key(), network = H.key(), treasurer = H.key(), roomSteward = H.key(), member = H.key(), stranger = H.key();
const cp = church.pub;
let relay, spawnedAt, seq = 0;
const at = () => H.now() + (seq++);
const ev = (k, d, body, extra = [['church', cp]]) =>
  finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', d], ['t', NET], ...extra], content: JSON.stringify(body) }, k.sk);

// every finance/ kind the registry knows, authored by the church. [label, d]
const FIN = [
  ['journal',      D.FIN_JOURNAL + '1'],
  ['account',      'finance/account:bank'],
  ['fund',         'finance/fund:general'],
  ['settings',     'finance/settings'],
  ['attachment',   D.FIN_ATTACHMENT + 'a1'],
  ['template',     'finance/template:t1'],
  ['reconcile',    'finance/reconcile:r1'],
  ['budget',       'finance/budget:2026'],
  ['invoice',      D.FIN_INVOICE + 'i1'],
  ['contact',      D.FIN_CONTACT + 'c1'],
  ['bill',         D.FIN_BILL + 'b1'],
  ['billapproval', D.FIN_BILLAPPROVAL + 'b1:' + treasurer.pub],
  ['donor',        D.FIN_DONOR + 'dn1'],
];
const stored = {};

async function writes(who, evt) {   // the relay's own OK frame
  const w = await H.connect(relay);
  try { return (await H.publish(w, evt))[0]; } finally { try { w.close(); } catch {} }
}
const served = async (who, d) => (await H.readAs(relay, who, { kinds: [30078], '#d': [d] })).length > 0;
const line = (k) => finalizeEvent({ kind: 1, created_at: H.now(), tags: [['church', cp]], content: 'hi ' + Math.random() }, k.sk);

before(async () => {
  relay = await H.startRelay({ name: 'netwall', churches: [cp] }); spawnedAt = Date.now();
  const author = (e) => H.publishAll(relay, [e]);
  await author(ev(church, D.NETWORK + network.pub, { joined: H.now() }, []));
  await author(ev(church, D.STEWARDS + cp, { pubkeys: [treasurer.pub, roomSteward.pub], caps: { [treasurer.pub]: ['finance'], [roomSteward.pub]: ['sealedrooms'] } }, []));
  await author(ev(church, D.GROUP + 'g1', { name: 'Leaders', visibility: 'invite', members: [member.pub] }));
  await H.sleep(300);
  for (const [label, d] of FIN) stored[label] = d;
  for (const [label, d] of FIN) await author(ev(label === 'billapproval' ? treasurer : church, d, { sealed: 'x', bill: 'b1', ts: H.now() }));
});
after(() => { try { H.stopAll(); } catch {} });

test('FRESHNESS (rule 10): the relay under test was spawned AFTER scripts/gateway.mjs was last written', () => {
  assert.ok(spawnedAt > statSync(new URL('./gateway.mjs', import.meta.url).pathname).mtimeMs, 'a stale relay enforces old gates');
});

test('CONTROL: the network key IS a live network -- a chat line a stranger is refused is ACCEPTED from it', async () => {
  assert.equal(await writes(stranger, line(stranger)), false, 'a stranger was accepted -- the control does not discriminate');
  assert.equal(await writes(network, line(network)), true, 'the declared network key was refused -- the link never formed, so every refusal below proves nothing');
});

for (const [label, d] of FIN) {
  test(`READ finance/${label}: the network key is REFUSED; the church and a finance steward are served; a member and a stranger are not`, async () => {
    assert.equal(await served(church, d), true, `re-anchor: the church cannot read its own ${label} -- the doc is not live`);
    assert.equal(await served(treasurer, d), true, `re-anchor: a finance steward cannot read ${label} -- the strip over-reached`);
    assert.equal(await served(network, d), false, `THE NETWORK KEY READ finance/${label}`);
    assert.equal(await served(member, d), false, `a plain member read finance/${label}`);
    assert.equal(await served(stranger, d), false, `a stranger read finance/${label}`);
  });
}

test('WRITE finance: the network key is REFUSED a journal entry and an account; the church and a finance steward are accepted', async () => {
  const mk = (k, d) => ev(k, d, { sealed: 'y' });
  assert.equal(await writes(network, mk(network, 'finance/account:netwrite')), false, 'the network key WROTE a finance account');
  assert.equal(await writes(network, mk(network, D.FIN_JOURNAL + '900')), false, 'the network key WROTE a journal entry');
  assert.equal(await writes(church, mk(church, 'finance/account:churchwrite')), true, 're-anchor: the church cannot write an account');
  assert.equal(await writes(treasurer, mk(treasurer, 'finance/account:stewardwrite')), true, 're-anchor: a finance steward cannot write an account');
});

// ── SEALED GROUP-ROOM KEY ENVELOPES (GROUPKEY_D) ─────────────────────────────────────────────────────────────
const GK = D.GROUPKEY + 'g1';
test('WRITE groupkey:<room>: the network key is REFUSED; the church and a sealedrooms steward are accepted', async () => {
  const mk = (k) => ev(k, GK, { keys: { x: 'y' } });
  assert.equal(await writes(network, mk(network)), false, 'THE NETWORK KEY WROTE A ROOM-KEY ENVELOPE (GROUPKEY_D owner grant)');
  assert.equal(await writes(church, mk(church)), true, 're-anchor: the church cannot publish a room key');
  assert.equal(await writes(roomSteward, mk(roomSteward)), true, 're-anchor: a sealedrooms steward cannot publish a room key');
  assert.equal(await writes(treasurer, mk(treasurer)), false, 'a finance-only steward wrote a room key -- the capability grants too much');
});

test('READ groupkey:<room>: the network key is NOT served the envelope; its author (the church) is', async () => {
  assert.equal(await served(church, GK), true, 're-anchor: the church cannot read its own room-key envelope');
  assert.equal(await served(network, GK), false, 'THE NETWORK KEY READ A ROOM-KEY ENVELOPE');
});

// ── THE CAPABILITY MARKER ────────────────────────────────────────────────────────────────────────────────────
test('the relay advertises network-wall-1 in /status and in its NIP-11 document', async () => {
  const st = await (await fetch(`${relay.base}/status`)).json();
  assert.ok(Array.isArray(st.capabilities) && st.capabilities.includes('network-wall-1'), '/status lacks capabilities:[network-wall-1]: ' + JSON.stringify(st.capabilities));
  const n11 = await (await fetch(`${relay.base}/relay`, { headers: { accept: 'application/nostr+json' } })).json();
  assert.ok(n11.trinityone && Array.isArray(n11.trinityone.capabilities) && n11.trinityone.capabilities.includes('network-wall-1'),
    'NIP-11 trinityone.capabilities lacks network-wall-1: ' + JSON.stringify(n11.trinityone && n11.trinityone.capabilities));
  assert.equal(st.relayPub, n11.trinityone.relayPub, 'unrelated fields moved: relayPub differs between /status and NIP-11');
});
