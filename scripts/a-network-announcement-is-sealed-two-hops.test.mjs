// A NETWORK'S ANNOUNCEMENT IS SEALED IN TWO HOPS, AND ONLY A MEMBER OF A CHURCH THAT JOINED CAN READ IT (Networks MVP, N5b).
//   Run: node --test scripts/a-network-announcement-is-sealed-two-hops.test.mjs   (SOLO)
//
// PORTED 2026-11-18 onto the network wall (feat/networks-port-2026-11-18); no assertion changed except the event-body test's title.
// WHAT RUNS: the SHIPPED code, cut out of the rebuilt vendor/steward.js (the console: hop-1, hop-2, the post publisher) and
// vendor/fellowship.js (the member app: subscribeNetworkContent, the hub's late-name-key replay) by scripts/net-bundle-rig.mjs and
// run against a relay stand-in. Real NIP-44 throughout. Nothing here matches text in src/ or app/*.jsx (CLAUDE.md rule 3).
//
// WHAT THE RELAY STAND-IN DOES NOT DO: decide who may READ. That is the gateway's job (netReader) and is proved against the real
// gateway in a-sealed-network-posts-are-accepted-and-served-by-the-relay.test.mjs. So every "cannot read" below is CRYPTOGRAPHIC: the
// ciphertext is handed to the party and they still cannot open it.
//
// NON-VACUITY: each positive is followed by a SABOTAGE case that breaks the one seal it depends on (inside that one function, anchor
// asserted unique) and asserts the same member now FAILS to read. A test that cannot go red proves nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent } from 'nostr-tools/pure';
import { FELLOW, STEWARD, NET, K, rnd32, nowS, tag, fakeRelay, bootConsole, bootMember, sharedFns, scoped, tick, hexBytes, between } from './net-bundle-rig.mjs';

const same = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const ENGINE_HEAD = { hop1: 'async function _netSyncKey(', hop2: 'async function _netSyncHop2(', post: 'async function _netPublishPost(' };
const ENGINE_TAIL = { hop1: 'async function _netSyncHop2(', hop2: 'async function _netWithdrawHop2(', post: 'async function _netRemovePost(' };

// A world: network N, church A (joined; its console holds N's key = the FOUNDER), church B (never joined), members of each.
async function world({ hop2 = true, mutate = null, post = true } = {}) {
  const relay = fakeRelay();
  const N = { ...K(), name: 'Regions Beyond' }, A = K(), B = K();
  const nkA = rnd32(), nkB = rnd32();
  const cA = bootConsole({ relay, church: A, networks: [N], nameKey: nkA, founded: [N.pub], mutate });
  cA.join(N.pub);
  const r1 = await cA.api.syncNetworkKey(N.pub);
  const r2 = hop2 ? await cA.api.syncNetworkHop2(N.pub) : null;
  const r3 = post ? await cA.api.publishNetworkPost(N.pub, 'announcement', { text: 'Youth night is moved to Friday' }) : null;
  return { relay, N, A, B, nkA, nkB, cA, r1, r2, r3 };
}
async function read(relay, cp, nameKeys, npub) {
  const m = bootMember({ relay, cp, nameKeys });
  const seen = []; const stop = m.subscribe(npub, (r) => seen.push(r));
  await tick(); stop();
  return { m, seen, last: seen[seen.length - 1] };
}
const readerOf = (w, cp, keys) => read(w.relay, cp, keys.map(hexBytes), w.N.pub);

test('TWO HOPS: the founder seals one ring to the joined church (hop-1), the church re-seals it for its members (hop-2), and a member reads the announcement', async () => {
  const w = await world();
  assert.equal(w.r1.ok, true, 'hop-1 was not published: ' + JSON.stringify(w.r1)); assert.equal(w.r1.minted, true);
  assert.equal(w.r2.ok, true, 'hop-2 was not published: ' + JSON.stringify(w.r2));
  assert.equal(w.r3.ok, true, 'the announcement was not published: ' + JSON.stringify(w.r3));
  const byD = (p) => w.relay.all().find(e => tag(e, 'd').startsWith(p));
  const h1 = byD('trinityone/netkey:'), h2 = byD('trinityone/netkeyc:'), ann = byD('trinityone/netann:');
  assert.equal(h1.pubkey, w.N.pub, 'hop-1 must be authored by the NETWORK key'); assert.equal(tag(h1, 'd'), 'trinityone/netkey:' + w.N.pub);
  assert.deepEqual(Object.keys(JSON.parse(h1.content).keys), [w.A.pub], 'hop-1 must wrap the ring for exactly the joined church');
  assert.equal(h2.pubkey, w.A.pub, 'hop-2 must be authored by the CHURCH key'); assert.equal(tag(h2, 'd'), 'trinityone/netkeyc:' + w.N.pub);
  assert.deepEqual(Object.keys(JSON.parse(h2.content)), ['e'], 'hop-2 must be the sealed {e} shape only');
  assert.equal(ann.pubkey, w.N.pub); assert.deepEqual(Object.keys(JSON.parse(ann.content)).sort(), ['e', 'v'], 'content must be {v,e} and nothing else');
  assert.deepEqual(ann.tags.map(t => t[0]).sort(), ['d', 't'], 'a network document may carry only d and t tags (the relay refuses any other)');
  assert.doesNotMatch(ann.content, /Youth|Friday/, 'the announcement is on the relay in the clear');
  const ring = sharedFns(STEWARD, ['openHop1AsNetwork']).openHop1AsNetwork(h1.content, w.N.sk);
  assert.ok(ring && ring.length === 1, 'the network could not open its own hop-1');
  for (const e of [h1, h2, ann]) assert.ok(!e.content.includes(ring[0]), 'a ring key is readable in a published document');
  const got = await readerOf(w, w.A.pub, [w.nkA]);
  assert.equal(got.last.state, 'ready'); assert.equal(got.last.announcements.length, 1);
  assert.equal(got.last.announcements[0].text, 'Youth night is moved to Friday'); assert.equal(got.last.announcements[0].networkPub, w.N.pub);
});

test('TWO HOPS (the lock): without the church\'s hop-2 the member is "locked" -- not an error, not an empty list -- and the same ciphertext is in front of them', async () => {
  const w = await world({ hop2: false });
  assert.ok(w.relay.all().some(e => tag(e, 'd').startsWith('trinityone/netann:')), 'setup: the sealed announcement must be on the relay');
  const got = await readerOf(w, w.A.pub, [w.nkA]);
  assert.equal(got.last.state, 'locked', 'a member with no hop-2 must be told "locked"');
  same(got.last.announcements, [], 'a member with no hop-2 read an announcement');
  // CONTROL: the identical world WITH hop-2 reads it
  const ok = await world();
  assert.equal((await readerOf(ok, ok.A.pub, [ok.nkA])).last.state, 'ready', 'CONTROL: with hop-2 the member could not read -- the lock above proves nothing');
});

test('A NAME KEY THAT ARRIVES LATE OPENS IT (the real hub replay, CHURCH_SEALED_PFXS): "waiting" becomes "ready" without a restart', async () => {
  const w = await world();
  const m = bootMember({ relay: w.relay, cp: w.A.pub, nameKeys: [] });   // the documents arrive BEFORE the name key
  const seen = []; const stop = m.subscribe(w.N.pub, (r) => seen.push(r));
  await tick();
  assert.equal(seen[seen.length - 1].state, 'locked', 'no name key yet: must read as locked');
  m.nameKeyLands([hexBytes(w.nkA)]); await tick();
  assert.equal(seen[seen.length - 1].state, 'ready', 'the name key landed and the hub replay did not re-open hop-2 -- the member stays on "waiting" until the app restarts');
  assert.equal(seen[seen.length - 1].announcements[0].text, 'Youth night is moved to Friday');
  stop();
});

test('A NON-JOINED CHURCH cannot read: its console cannot open hop-1, publishes no hop-2, and its member is locked even holding every ciphertext', async () => {
  const w = await world();
  const cB = bootConsole({ relay: w.relay, church: w.B, nameKey: w.nkB });
  const before = w.relay.all().length;
  const r = await cB.api.syncNetworkHop2(w.N.pub);
  assert.equal(r.ok, false, 'a church that never joined re-sealed the network key: ' + JSON.stringify(r));
  assert.equal(w.relay.all().length, before, 'a non-joined church published a document');
  assert.equal(cB.published.length, 0);
  const got = await readerOf(w, w.B.pub, [w.nkB]);
  assert.equal(got.last.state, 'locked'); same(got.last.announcements, []);
  // and even A's hop-2, misrouted to B's member, does not open under B's name key
  const h2 = w.relay.all().find(e => tag(e, 'd').startsWith('trinityone/netkeyc:'));
  assert.equal(sharedFns(FELLOW, ['openHop2']).openHop2(h2.content, [hexBytes(w.nkB)]), null, 'hop-2 opened under another church\'s name key');
  assert.ok(sharedFns(FELLOW, ['openHop2']).openHop2(h2.content, [hexBytes(w.nkA)]), 'CONTROL: it must open under the right name key');
});

test('SABOTAGE 1 (hop-2 sealed under the wrong key): the member is locked -- so the positive test above can fail', async () => {
  const w = await world({ mutate: (s) => scoped(s, ENGINE_HEAD.hop2, ENGINE_TAIL.hop2, 'sealHop2(cur.ring, nk)', 'sealHop2(cur.ring, "ab".repeat(32))') });
  assert.equal(w.r2.ok, true, 'setup: the sabotaged console still publishes');
  const got = await readerOf(w, w.A.pub, [w.nkA]);
  assert.notEqual(got.last.state, 'ready', 'THE SABOTAGE WAS NOT CAUGHT: a hop-2 sealed under a stranger\'s key still opened for the member');
  same(got.last.announcements, []);
});

test('SABOTAGE 2 (hop-1 wraps for nobody): the joined church cannot open the ring, so no hop-2 and no read', async () => {
  const w = await world({ mutate: (s) => scoped(s, ENGINE_HEAD.hop1, ENGINE_TAIL.hop1, 'sealHop1(nsk, ring, [...want], ring.length)', 'sealHop1(nsk, ring, [], ring.length)') });
  assert.equal(w.r2.ok, false, 'THE SABOTAGE WAS NOT CAUGHT: the church re-sealed a ring it was never given');
  assert.equal((await readerOf(w, w.A.pub, [w.nkA])).last.state, 'locked');
});

test('SABOTAGE 3 (post sealed under a ring that is not the shared one): the member is ready but cannot read it', async () => {
  const w = await world({ mutate: (s) => scoped(s, ENGINE_HEAD.post, ENGINE_TAIL.post, 'sealPost(body, cur.ring)', 'sealPost(body, [rnd32x()])').replace('function _netPublishSetFor(', 'const rnd32x = () => "cd".repeat(32);\nfunction _netPublishSetFor(') });
  const got = await readerOf(w, w.A.pub, [w.nkA]);
  same(got.last.announcements, [], 'THE SABOTAGE WAS NOT CAUGHT: a post sealed under a stray key was read');
  assert.equal(got.last.unreadable, 1, 'the unreadable post must be counted, not silently dropped');
});

test('MINT SAFETY: a console that did not found the network, one on an unproved relay, or one not logged in will NOT start a ring; and it will not replace one it cannot open', async () => {
  const mk = (over) => { const relay = fakeRelay(), N = K(), A = K(); const c = bootConsole({ relay, church: A, networks: [N], nameKey: rnd32(), ...over }); c.join(N.pub); return { relay, N, A, c }; };
  const notFounder = mk({ founded: [] });
  const r0 = await notFounder.c.api.syncNetworkKey(notFounder.N.pub);
  assert.equal(r0.ok, false); assert.equal(notFounder.c.published.length, 0, 'an imported/second console minted a ring over what it cannot see');
  const unproved = mk({ founded: ['x'], unproved: ['wss://not-yet-proved'] }); unproved.c.ls.set('trinityone.netring.mint.' + unproved.N.pub, '1');
  assert.equal((await unproved.c.api.syncNetworkKey(unproved.N.pub)).waiting, true); assert.equal(unproved.c.published.length, 0, 'minted on an unproved relay');
  const out = mk({ authed: false }); out.c.ls.set('trinityone.netring.mint.' + out.N.pub, '1');
  assert.equal((await out.c.api.syncNetworkKey(out.N.pub)).waiting, true); assert.equal(out.c.published.length, 0, 'minted while not logged in');
  // CONTROL: the same console, founded + proved + logged in, does mint
  const good = mk({}); good.c.ls.set('trinityone.netring.mint.' + good.N.pub, '1');
  assert.equal((await good.c.api.syncNetworkKey(good.N.pub)).minted, true, 'CONTROL: the founder could not mint -- the refusals above prove nothing');
  // a NON-founder cannot see an envelope the relay holds (the real relay serves netkey: only to its author and a wrapped church): it
  // must refuse, not start a second ring beside the real one
  const w = await world();
  const stranger = K();
  const hidden = { ...w.relay, querySync: async (u, f) => (await w.relay.querySync(u, f)).filter(e => !tag(e, 'd').startsWith('trinityone/netkey:')) };
  const cS = bootConsole({ relay: hidden, church: stranger, networks: [w.N], nameKey: rnd32(), founded: [] });
  const before = w.relay.all().length;
  const rs = await cS.api.syncNetworkKey(w.N.pub);
  assert.equal(rs.ok, false); assert.equal(rs.waiting, true); assert.equal(w.relay.all().length, before, 'a console that could not see the real ring wrote a second one');
  // an envelope that EXISTS and that this console cannot open (sealed by some other key): never replaced
  const X = K(), forged = sharedFns(STEWARD, ['sealHop1', 'newNetKey']);
  const relay2 = fakeRelay(), N2 = K(), A2 = K();
  relay2.put(finalizeEvent({ kind: 30078, created_at: nowS() - 5, tags: [['d', 'trinityone/netkey:' + N2.pub], ['t', NET]], content: forged.sealHop1(X.sk, [forged.newNetKey()], [A2.pub], 1) }, N2.sk));
  const c2 = bootConsole({ relay: relay2, church: A2, networks: [N2], nameKey: rnd32(), founded: [N2.pub] }); c2.join(N2.pub);
  const r2 = await c2.api.syncNetworkKey(N2.pub);
  assert.equal(r2.ok, false, 'a ring this console cannot open was replaced'); assert.equal(c2.published.length, 0);
});

test('SABOTAGE 4 (the mint blockers removed): a console on an unproved relay mints -- so the MINT SAFETY test can fail', async () => {
  const mutate = (s) => scoped(s, 'function _netMintBlockers(', 'async function _netRingFor(', 'return { unproved, notAuthed: !_isRelayAuthed(), notFounder: lsGet(NETRING_MINT_LS + np) !== "1" };', 'return { unproved: [], notAuthed: false, notFounder: false };');
  const relay = fakeRelay(), N = K(), A = K();
  const c = bootConsole({ relay, church: A, networks: [N], nameKey: rnd32(), founded: [], unproved: ['wss://x'], mutate }); c.join(N.pub);
  const r = await c.api.syncNetworkKey(N.pub);
  assert.equal(r.minted, true, 'THE SABOTAGE WAS NOT CAUGHT: with the blockers removed the console still refused to mint');
});

test('A CHURCH THAT LEAVES IS ROTATED OUT; THE NAME KEY ROTATING RE-SEALS; A REPEAT SAYS NOTHING', async () => {
  const w = await world();
  const C = K(), nkC = rnd32(), cC = bootConsole({ relay: w.relay, church: C, networks: [], nameKey: nkC }); cC.join(w.N.pub, C);
  const add = await w.cA.api.syncNetworkKey(w.N.pub, { add: [C.pub] });
  assert.equal(add.ok, true); assert.deepEqual(add.recipients.sort(), [w.A.pub, C.pub].sort());
  assert.equal((await cC.api.syncNetworkHop2(w.N.pub)).ok, true, 'a church added to hop-1 could not re-seal');
  assert.equal((await readerOf(w, C.pub, [nkC])).last.state, 'ready', 'a joined second church\'s member could not read');
  const oldRing = sharedFns(STEWARD, ['openHop1AsNetwork']).openHop1AsNetwork(w.relay.all().find(e => tag(e, 'd').startsWith('trinityone/netkey:')).content, w.N.sk);
  // C leaves
  const drop = await w.cA.api.syncNetworkKey(w.N.pub, { drop: [C.pub] });
  assert.equal(drop.ok, true); assert.equal(drop.rotated, true); assert.deepEqual(drop.recipients, [w.A.pub]);
  const h1 = w.relay.all().find(e => tag(e, 'd').startsWith('trinityone/netkey:'));
  const newRing = sharedFns(STEWARD, ['openHop1AsNetwork']).openHop1AsNetwork(h1.content, w.N.sk);
  assert.equal(newRing.length, oldRing.length + 1, 'a leave must add a key'); assert.notEqual(newRing[0], oldRing[0]); assert.equal(newRing[1], oldRing[0], 'the old key must stay so older posts still open');
  assert.equal(sharedFns(STEWARD, ['openHop1ForChurch']).openHop1ForChurch(h1.content, C.sk, C.pub, w.N.pub), null, 'the church that left can still unwrap the new ring');
  assert.equal((await cC.api.syncNetworkHop2(w.N.pub)).ok, false, 'the church that left re-sealed the new ring');
  // a post after the rotation is readable by A's member (hop-2 re-sealed first) and NOT by C's (still on the old ring)
  assert.equal((await w.cA.api.syncNetworkHop2(w.N.pub)).ok, true);
  assert.equal((await w.cA.api.publishNetworkPost(w.N.pub, 'announcement', { text: 'After C left' })).ok, true);
  const a = (await readerOf(w, w.A.pub, [w.nkA])).last.announcements.map(x => x.text);
  assert.ok(a.includes('After C left') && a.includes('Youth night is moved to Friday'), 'A\'s member lost a post across the rotation: ' + a);
  const c = (await readerOf(w, C.pub, [nkC])).last;
  assert.ok(!c.announcements.map(x => x.text).includes('After C left'), 'the church that left read a post sealed after it left');
  // name key rotation re-seals; an identical second call publishes nothing
  const n0 = w.cA.published.length;
  assert.equal((await w.cA.api.syncNetworkHop2(w.N.pub)).unchanged, true); assert.equal(w.cA.published.length, n0, 'a repeat call republished');
  const nk2 = rnd32(); w.cA.api.__set('_nameKeyRing', [nk2, w.nkA]);
  assert.equal((await w.cA.api.syncNetworkHop2(w.N.pub)).ok, true); assert.equal(w.cA.published.length, n0 + 1, 'a rotated name key did not re-seal hop-2');
  assert.equal((await readerOf(w, w.A.pub, [nk2, w.nkA])).last.state, 'ready', 'a member holding the new name ring could not read');
  assert.notEqual((await readerOf(w, w.A.pub, [w.nkA])).last.state, 'ready', 'CONTROL: a member who only holds the OLD name key must not open the re-sealed hop-2');
});

test('EVENTS: the same body as a church event MINUS groupId; and a withdrawn post disappears for the member', async () => {
  const w = await world();
  const ev = await w.cA.api.publishNetworkPost(w.N.pub, 'event', { title: 'Regional prayer night', date: '2026-11-14', time: '19:30', where: 'St Aidan’s', groupId: 'some-private-room', blurb: 'All welcome' });
  assert.equal(ev.ok, true, JSON.stringify(ev));
  const stored = w.relay.all().find(e => tag(e, 'd') === 'trinityone/netevent:' + ev.id);
  assert.doesNotMatch(stored.content, /prayer|Aidan/, 'the event is on the relay in the clear');
  const ring = sharedFns(STEWARD, ['openHop1AsNetwork']).openHop1AsNetwork(w.relay.all().find(e => tag(e, 'd').startsWith('trinityone/netkey:')).content, w.N.sk);
  const body = sharedFns(STEWARD, ['openPost']).openPost(stored.content, ring);
  assert.equal(body.title, 'Regional prayer night'); assert.ok(!('groupId' in body), 'a network event carries a groupId (it would route into a church-owned room)');
  const got = (await readerOf(w, w.A.pub, [w.nkA])).last;
  assert.equal(got.events.length, 1); assert.equal(got.events[0].title, 'Regional prayer night'); assert.equal(got.events[0].date, '2026-11-14'); assert.ok(!('groupId' in got.events[0]));
  const rm = await w.cA.api.removeNetworkPost(w.N.pub, 'event', ev.id); assert.equal(rm.ok, true);
  const tomb = w.relay.all().find(e => tag(e, 'd') === 'trinityone/netevent:' + ev.id);
  assert.equal(tomb.content, ''); assert.ok(tomb.tags.some(t => t[0] === 'deleted'));
  assert.equal((await readerOf(w, w.A.pub, [w.nkA])).last.events.length, 0, 'a withdrawn event is still shown');
});

test('NOTHING IS PUBLISHED IN THE CLEAR: an empty post, an unknown type, a missing key, or a refused write all report not-ok and leave the relay as it was', async () => {
  const w = await world();
  const n = w.relay.all().length;
  assert.equal((await w.cA.api.publishNetworkPost(w.N.pub, 'announcement', { text: '   ' })).ok, false);
  assert.equal((await w.cA.api.publishNetworkPost(w.N.pub, 'event', { title: 'No date' })).ok, false);
  assert.equal((await w.cA.api.publishNetworkPost(w.N.pub, 'poll', { text: 'x' })).ok, false);
  assert.equal((await w.cA.api.publishNetworkPost(K().pub, 'announcement', { text: 'not my network' })).ok, false, 'posted AS a network this console does not hold');
  assert.equal(w.relay.all().length, n);
  const cNoName = bootConsole({ relay: fakeRelay(), church: w.A, networks: [w.N], founded: [w.N.pub] });
  assert.equal((await cNoName.api.syncNetworkHop2(w.N.pub)).waiting, true, 'hop-2 with no name key must WAIT, never fall back to the clear');
  assert.equal(cNoName.published.length, 0);
});

// Ported 2026-11-18: the church's own publishEvent no longer goes through churchEventBody (its body grew fields since October -- see
// src/network-seal.src.js), so this pins the SHARED module's maps only: the network body is the core church-event body minus groupId.
test('THE NETWORK EVENT BODY: the shared core church-event map, and the network body is the same minus groupId', () => {
  const f = sharedFns(STEWARD, ['churchEventBody', 'netEventBody', 'churchEventFields', 'netEventFields']);
  const ev = { date: '2026-10-25', time: '10:30', title: 'Harvest', where: 'Hall', blurb: 'b', accent: 'red', image: 'i', groupId: 'g', recur: 'monthly', day: 0, nth: -1 };
  same(f.churchEventBody(ev), ev, 'the church event body changed shape');
  same(f.churchEventBody({}), { date: '', time: '', title: 'Event', where: '', blurb: '', accent: 'var(--clay)', image: '', groupId: '', recur: '', day: null, nth: null });
  const { groupId, ...rest } = ev; same(f.netEventBody(ev), rest);
  assert.ok(!('groupId' in f.netEventFields({ ...ev })));
});

test('syncNetworkKeys (what the roster tick and the join/create buttons call) sets up hop-1 AND hop-2 for a founder, then is throttled', async () => {
  const relay = fakeRelay(), N = K(), A = K();
  const c = bootConsole({ relay, church: A, networks: [N], nameKey: rnd32(), founded: [N.pub] }); c.join(N.pub);
  const r = await c.api.syncNetworkKeys({ force: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  const ds = relay.all().map(e => tag(e, 'd')).filter(d => d.includes('netkey'));
  assert.deepEqual(ds.sort(), ['trinityone/netkey:' + N.pub, 'trinityone/netkeyc:' + N.pub].sort(), 'the sync did not publish both hops');
  const n = c.published.length;
  assert.equal((await c.api.syncNetworkKeys()).skipped, true, 'a roster tick re-ran the sync inside the throttle window');
  assert.equal(c.published.length, n);
});
