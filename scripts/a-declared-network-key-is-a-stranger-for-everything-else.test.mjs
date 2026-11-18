// A DECLARED NETWORK KEY IS A STRANGER, EXCEPT WHERE A CHURCH NAMED IT. Run: node --test scripts/a-declared-network-key-is-a-stranger-for-everything-else.test.mjs
//
// Audit 2026-11-18 asked for three things the other files do not prove, each on a REAL relay with a REAL church and a really-joined
// network key (relay-network-harness: own port, own dir):
//   (a) a network key that is ALSO a member of the church still cannot privately message a child (safeguardAllows has no networkOf);
//   (b) a network key the church has BANNED cannot send a stewardreq: (the per-church ban has no network exemption);
//   (c) `NETWORKS.has(authed)` no longer widens READS: what a stranger is refused, a declared network key is refused too (a profile of
//       someone in no church, a church key's group-less reaction, a church key's chat in a group the relay holds no definition for),
//       while a network's OWN profile stays public.
// Each refusal is paired with the accepted/served control that proves the fixture is live. Sabotage for each is in the commit message.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as H from './relay-network-harness.mjs';
import { D } from './trinity-doc-types.mjs';
import { finalizeEvent } from 'nostr-tools/pure';

const NET = 'trinityone';
const church = H.key(), network = H.key(), kid = H.key(), adult = H.key(), cleared = H.key(), banned = H.key(), bannedNet = H.key();
const loner = H.key(), stranger = H.key(), outsider = H.key(), pureNet = H.key();   // pureNet: declared by the church, NEVER a member of it
const cp = church.pub;
let relay, seq = 0;
const at = () => H.now() + (seq++);
const ev = (k, d, body, extra = [['church', cp]]) => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', d], ['t', NET], ...extra], content: JSON.stringify(body) }, k.sk);
const raw = (k, kind, tags, content = 'x') => finalizeEvent({ kind, created_at: at(), tags, content }, k.sk);
const writes = async (evt) => { const w = await H.connect(relay); try { return (await H.publish(w, evt)); } finally { try { w.close(); } catch {} } };
const reads = async (who, filter) => (await H.readAs(relay, who, filter)).length > 0;

before(async () => {
  relay = await H.startRelay({ name: 'netstranger', churches: [cp] });
  const pa = (e) => H.publishAll(relay, [e]);
  await pa(ev(church, D.NETWORK + network.pub, { joined: H.now() }, []));
  await pa(ev(church, D.NETWORK + bannedNet.pub, { joined: H.now() }, []));
  await pa(ev(church, D.NETWORK + pureNet.pub, { joined: H.now() }, []));
  for (const m of [kid, adult, cleared, network, bannedNet]) await pa(ev(m, D.MEMBER + cp, { joined: H.now() }, [['p', cp]]));
  await pa(ev(church, D.MINORS + cp, { pubkeys: [kid.pub] }, []));
  await pa(ev(church, D.APPROVED + cp, { pubkeys: [cleared.pub] }, []));
  await pa(ev(church, D.BLOCKED + cp, { pubkeys: [banned.pub, bannedNet.pub] }, []));
  await H.sleep(400);
});
after(() => { try { H.stopAll(); } catch {} });

// ── (a) ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('(a) a network key that is ALSO a member cannot privately message a child; the church and a cleared adult can', async () => {
  const dm = (from) => raw(from, 4, [['p', kid.pub]], 'hello');
  assert.equal((await writes(dm(church)))[0], true, 're-anchor: the church cannot message its own child -- the DM door is broken');
  assert.equal((await writes(dm(cleared)))[0], true, 're-anchor: a cleared adult cannot message the child -- the DM door is broken');
  assert.equal((await writes(dm(adult)))[0], false, 're-anchor: an uncleared adult member messaged a child -- the fixture does not discriminate');
  const r = await writes(dm(network));
  assert.equal(r[0], false, 'A DECLARED NETWORK KEY THAT IS ALSO A MEMBER PRIVATELY MESSAGED A CHILD: ' + r[1]);
});

// ── (b) ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('(b) a network key the church has BANNED cannot send a stewardreq:; an unbanned stranger and the unbanned network key can', async () => {
  const req = (k) => ev(k, D.STEWARDREQ + cp, { note: 'may I help' });
  assert.equal((await writes(req(outsider)))[0], true, 're-anchor: an unbanned stranger cannot send a stewardreq: -- the door is closed for everybody');
  assert.equal((await writes(req(network)))[0], true, 're-anchor: the unbanned declared network key cannot send a stewardreq: -- the narrowing closed the human-admission door');
  assert.equal((await writes(req(banned)))[0], false, 're-anchor: a banned stranger sent a stewardreq: -- the ban is not in force');
  const r = await writes(req(bannedNet));
  assert.equal(r[0], false, 'A BANNED DECLARED NETWORK KEY SENT A STEWARDREQ (the ban exemption for networks is back): ' + r[1]);
});

// ── (c) ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('(c1) a profile of someone in no church is served to a church key, NOT to a declared network key and NOT to a stranger', async () => {
  const p = raw(loner, 0, [], JSON.stringify({ name: 'Loner' }));
  assert.equal((await writes(p))[0], true, 'fixture: the relay refused a stranger profile');
  await H.sleep(200);
  const f = { kinds: [0], authors: [loner.pub] };
  assert.equal(await reads(loner, f), true, 're-anchor: the author cannot read their own profile');
  assert.equal(await reads(church, f), true, 're-anchor: the church key cannot read the profile -- the kind-0 door for church keys is broken');
  assert.equal(await reads(stranger, f), false, 'a stranger read a profile of someone in no church');
  assert.equal(await reads(pureNet, f), false, 'A DECLARED NETWORK KEY READ A PROFILE A STRANGER IS REFUSED (NETWORKS.has(authed) widens kind 0)');
});

test('(c2) a church key\'s group-less reaction is served to nobody a stranger is not, declared network key included', async () => {
  const r = raw(church, 7, [['e', 'a'.repeat(64)], ['p', cp]], '+');
  assert.equal((await writes(r))[0], true, 'fixture: the church key could not react');
  await H.sleep(200);
  const f = { kinds: [7], authors: [cp] };
  assert.equal(await reads(church, f), true, 're-anchor: the church cannot read its own reaction');
  assert.equal(await reads(stranger, f), false, 'a stranger read a church key\'s group-less reaction');
  assert.equal(await reads(pureNet, f), false, 'A DECLARED NETWORK KEY READ A GROUP-LESS REACTION A STRANGER IS REFUSED (NETWORKS.has(authed), kind 7)');
});

test('(c3) a church key\'s chat in a group the relay holds no definition for is served to nobody a stranger is not, declared network key included', async () => {
  const m = raw(church, 1, [['t', 'ghost-room'], ['church', cp]], 'hello ghost');
  assert.equal((await writes(m))[0], true, 'fixture: the church key could not post into an undefined group');
  await H.sleep(200);
  const f = { kinds: [1], authors: [cp], '#t': ['ghost-room'] };
  assert.equal(await reads(church, f), true, 're-anchor: the church cannot read its own chat line');
  assert.equal(await reads(stranger, f), false, 'a stranger read chat in an undefined group');
  assert.equal(await reads(pureNet, f), false, 'A DECLARED NETWORK KEY READ CHAT IN AN UNDEFINED GROUP (NETWORKS.has(authed), kind 1)');
});

test('(c4) a network\'s OWN profile stays public: a stranger reads it', async () => {
  assert.equal((await writes(raw(pureNet, 0, [], JSON.stringify({ name: 'Diocese' }))))[0], true, 'fixture: the network key could not publish its own profile');
  await H.sleep(200);
  assert.equal(await reads(stranger, { kinds: [0], authors: [pureNet.pub] }), true, 'a stranger cannot read a network\'s own profile -- joining flows read it');
});
