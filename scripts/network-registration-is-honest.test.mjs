// CREATING / JOINING / LEAVING A NETWORK REPORTS WHAT ACTUALLY HAPPENED, AND A CHURCH JOINS ONLY THROUGH RELAYS THAT CARRY THE WALL.
// Run: node --test scripts/network-registration-is-honest.test.mjs
//
// N2 (64b4d06b, ported 2026-11-18 onto the network wall): joinNetwork used to ignore publish()'s FALSE and answer with the network anyway;
// createNetwork saved the network's key (and showed its recovery words) BEFORE the join, so a refused join left an orphan identity; and it
// published a network-keyed church group (group:net-announce). NEW in the port (plan audit H1): joinNetwork REFUSES unless every relay the
// church writes to advertises 'network-wall-1' -- a missing marker blocks, a present one never admits (rule 10).
//
// HOW IT ASSERTS. resolveNetwork / joinNetwork / leaveNetwork / createNetwork / retryNetworkProfile and the whole network engine (incl.
// _readNetworkJoin and _netWallMissing) are cut out of the SHIPPED bundle (vendor/steward.js) by scripts/net-bundle-rig.mjs and run against a
// relay stand-in whose writes can be refused (with the relay's own words) or swallowed. The marker check reads through a stubbed fetch here;
// scripts/a-church-joins-a-network-only-through-relays-with-the-wall.test.mjs runs it against the REAL gateway.
// Callers of the public functions (rule 2): DashNetworksPanel in app/stew-dashboard.jsx (not yet rewired: Phase B2), and createNetwork ->
// joinNetwork / retryNetworkProfile. Nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { K, tag, fakeRelay, bootConsole } from './net-bundle-rig.mjs';

const R1 = 'wss://one.example/relay', R2 = 'wss://two.example/relay';
const WALL = { trinityone: { capabilities: ['network-wall-1'] } };
// a fetch that answers NIP-11 / status per host: 'nip11' | 'status' | 'none' | 'down'
const fetchFor = (byHost) => async (url, init) => {
  const host = new URL(url).host, mode = byHost[host] || 'nip11';
  if (mode === 'down') throw new Error('unreachable');
  const isStatus = /\/status$/.test(new URL(url).pathname);
  const body = isStatus ? (mode === 'status' ? { capabilities: ['network-wall-1'] } : { ok: true }) : (mode === 'nip11' ? WALL : { trinityone: {} });
  return { ok: true, json: async () => body };
};
// refuse(evt) -> reason | '' ; hideJoin: accept a join and never serve it back
function world({ refuse = () => '', hideJoin = false, seed = [], byHost = {}, relayUrls = [R1] } = {}) {
  const base = fakeRelay();
  for (const e of seed) base.put(e);
  const isJoin = (e) => e.kind === 30078 && tag(e, 'd').startsWith('trinityone/network:');
  const relay = { ...base, put: (e) => { const why = refuse(e); if (why) return { ok: false, reason: why }; if (hideJoin && isJoin(e)) return true; return base.put(e); } };
  const church = K();
  const c = bootConsole({ relay, church, joinApi: true, relayUrls, fetchImpl: fetchFor(byHost) });
  return { c, relay: base, church, isJoin };
}
const OTHER = K().pub;

test('CONTROL: a create that succeeds keeps the key, joins with the consent record (announcements + events, no feed), names the network, and creates NO group', async () => {
  const w = world();
  const r = await w.c.api.createNetwork('Sussex Gospel Partnership');
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.partial, undefined);
  assert.equal(w.c.savedKeys.length, 1, 'the key was not kept after a successful create');
  assert.equal(w.c.savedKeys[0].pub, r.networkPub);
  assert.equal(w.c.ls.get('trinityone.netring.mint.' + r.networkPub), '1', 'the founder flag was not set -- the first ring could never be minted');
  const join = w.c.published.find(w.isJoin);
  assert.equal(join.pubkey, w.church.pub, 'the join must be signed by the CHURCH key');
  assert.deepEqual(JSON.parse(join.content), { joined: true, v: 1, scopes: ['announcements', 'events'] });
  const prof = w.c.published.find(e => e.kind === 0);
  assert.equal(prof.pubkey, r.networkPub, 'the profile must be signed by the network key');
  assert.equal(JSON.parse(prof.content).name, 'Sussex Gospel Partnership');
  assert.deepEqual(w.c.published.filter(e => (tag(e, 'd') || '').includes('group:')), [], 'a network-keyed church group was published');
  assert.equal(w.c.published.length, 2);
});

test('a REFUSED join: no success, no orphan key, nothing else published, and the relay\'s own words come back', async () => {
  const w = world({ refuse: () => 'blocked: not a member or not permitted for this group' });
  const r = await w.c.api.createNetwork('Doomed');
  assert.equal(r.ok, false); assert.equal(r.stage, 'join');
  assert.match(r.reason, /not a member or not permitted/);
  assert.equal(r.mnemonic, undefined, 'recovery words were handed back for a network that does not exist');
  assert.deepEqual(w.c.savedKeys, [], 'a network key was saved although the join was refused -- an orphan identity');
  assert.equal(w.c.published.length + w.c.refused.length, 1, 'something else was attempted after the join failed');
});

test('a join the relay ACCEPTS but that cannot be read back is not reported as done, and saves no key', async () => {
  const w = world({ hideJoin: true });
  const r = await w.c.api.createNetwork('Phantom');
  assert.equal(r.ok, false); assert.equal(r.stage, 'join');
  assert.deepEqual(w.c.savedKeys, []);
  assert.equal(w.c.published.length, 1);
});

test('join ok but the profile is refused: ok + partial + failed[profile], key kept, and a retry finishes it', async () => {
  let refuseProfile = true;
  const w = world({ refuse: (e) => (e.kind === 0 && refuseProfile ? 'rate-limited: slow down' : '') });
  const r = await w.c.api.createNetwork('Half');
  assert.equal(r.ok, true); assert.equal(r.partial, true); assert.deepEqual(r.failed, ['profile']);
  assert.match(r.reason, /rate-limited/);
  assert.ok(r.mnemonic, 'the recovery words must still be handed over: the church has joined this network');
  assert.equal(w.c.savedKeys.length, 1);
  refuseProfile = false;
  const again = await w.c.api.retryNetworkProfile(r.networkPub, 'Half');
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.ok(w.relay.all().some(e => e.kind === 0 && e.pubkey === r.networkPub), 'the retry published nothing');
});

test('joinNetwork: a refused publish is {ok:false, reason}, never a network object', async () => {
  const w = world({ refuse: () => 'blocked: nope' });
  const r = await w.c.api.joinNetwork(npubEncode(OTHER), { scopes: ['announcements'] });
  assert.equal(r.ok, false); assert.equal(r.stage, 'join'); assert.equal(r.reason, 'blocked: nope');
  assert.equal(r.networkPub, undefined);
});

test('joinNetwork: a malformed code, or the church\'s own code, never reaches publish', async () => {
  const w = world();
  assert.equal((await w.c.api.joinNetwork('not-a-code')).ok, false);
  assert.equal((await w.c.api.joinNetwork(w.church.pub)).ok, false, 'a church joined itself as a network');
  assert.equal(w.c.published.length + w.c.refused.length, 0);
  assert.equal(await w.c.api.resolveNetwork('not-a-code'), null);
  assert.equal((await w.c.api.resolveNetwork(npubEncode(OTHER))).networkPub, OTHER);
});

test('joinNetwork is READ-MODIFY-WRITE: an unknown field survives; scopes are the consent given minus unknown values -- and NEVER "feed"', async () => {
  const mk = (seedContent) => { const w0 = world(); const prior = finalizeEvent({ kind: 30078, created_at: 500, tags: [['d', 'trinityone/network:' + OTHER], ['t', 'trinityone'], ['p', OTHER]], content: JSON.stringify(seedContent) }, w0.church.sk); w0.relay.put(prior); return w0; };
  const w = mk({ joined: true, futureField: { a: 1 }, scopes: ['feed'] });
  const r = await w.c.api.joinNetwork(OTHER, { scopes: ['announcements', 'events', 'feed', 'bogus'] });
  assert.equal(r.ok, true, JSON.stringify(r));
  const doc = JSON.parse(w.c.published.find(w.isJoin).content);
  assert.deepEqual(doc.futureField, { a: 1 }, 'a field written by something else was wiped');
  assert.equal(doc.v, 1);
  assert.deepEqual(doc.scopes, ['announcements', 'events'], 'scopes must be the consent just given, minus unknown values -- and the feed is not a network scope');
  // with no scopes given, an old stored 'feed' is DROPPED on rewrite and the rest kept (never silently widened)
  const w2 = mk({ joined: true, scopes: ['feed', 'events'] });
  await w2.c.api.joinNetwork(OTHER);
  assert.deepEqual(JSON.parse(w2.c.published.find(w2.isJoin).content).scopes, ['events']);
  // a fresh join with no scopes carries none = the narrowest
  const w3 = world();
  await w3.c.api.joinNetwork(OTHER);
  assert.equal(JSON.parse(w3.c.published.find(w3.isJoin).content).scopes, undefined);
});

test('leaveNetwork: a refused publish is {ok:false}; an accepted one is {ok:true} and withdraws this church\'s hop-2', async () => {
  const w = world();
  assert.deepEqual(await w.c.api.leaveNetwork(OTHER), { ok: true });
  assert.ok(w.c.published.some(e => tag(e, 'd') === 'trinityone/netkeyc:' + OTHER && e.tags.some(t => t[0] === 'deleted')), 'leaving did not withdraw the hop-2 re-seal');
  const r = await world({ refuse: () => 'blocked: x' }).c.api.leaveNetwork(OTHER);
  assert.equal(r.ok, false); assert.equal(r.reason, 'blocked: x');
});

// ── THE WALL MARKER (plan audit H1) ────────────────────────────────────────────────────────────────────────────────────────────────────────
test('WALL: a join through relays that all advertise network-wall-1 goes ahead (CONTROL) -- by NIP-11, or by /status', async () => {
  const w = world({ relayUrls: [R1, R2], byHost: { 'one.example': 'nip11', 'two.example': 'status' } });
  const r = await w.c.api.joinNetwork(OTHER, { scopes: ['announcements'] });
  assert.equal(r.ok, true, 'CONTROL: every relay carries the wall and the join was still refused -- the refusals below prove nothing: ' + JSON.stringify(r));
});

test('WALL: ONE relay without the marker (or unreachable) refuses the join, names that relay, and publishes NOTHING', async () => {
  for (const mode of ['none', 'down']) {
    const w = world({ relayUrls: [R1, R2], byHost: { 'one.example': 'nip11', 'two.example': mode } });
    const r = await w.c.api.joinNetwork(OTHER, { scopes: ['announcements', 'events'] });
    assert.equal(r.ok, false, mode + ': a church joined a network through a relay that does not carry the wall');
    assert.equal(r.stage, 'relay');
    assert.deepEqual(r.missing, [R2], mode + ': the refusal must name exactly the relay that lacks it');
    assert.match(r.reason, /two\.example/, 'the reason must say which relay');
    assert.equal(w.c.published.length + w.c.refused.length, 0, mode + ': something was published although the join was refused');
  }
});

test('WALL: createNetwork through a relay without the marker saves NO key and publishes nothing', async () => {
  const w = world({ byHost: { 'one.example': 'none' } });
  const r = await w.c.api.createNetwork('Too early');
  assert.equal(r.ok, false); assert.equal(r.stage, 'relay');
  assert.deepEqual(w.c.savedKeys, []); assert.equal(w.c.published.length + w.c.refused.length, 0);
});

test('WALL: no relay ready at all refuses the join (an empty set is not "every relay has it")', async () => {
  const w = world({ relayUrls: [] });
  const r = await w.c.api.joinNetwork(OTHER);
  assert.equal(r.ok, false); assert.equal(r.stage, 'relay');
  assert.equal(w.c.published.length + w.c.refused.length, 0);
});

// B1 audit (2026-11-19): the probe asked relays one at a time, so each dead relay cost up to ~13s. It now asks them all at once (still fail-closed).
test('WALL PROBE IS PARALLEL: three slow relays are checked in about the time of one; SABOTAGE (one at a time) takes three times as long', async () => {
  const slowFetch = async () => { await new Promise(r => setTimeout(r, 700)); return { ok: true, json: async () => ({ trinityone: { capabilities: ['network-wall-1'] } }) }; };
  const urls = ['wss://a.example/relay', 'wss://b.example/relay', 'wss://c.example/relay'];
  const time = async (mutate) => {
    const relay = fakeRelay(), church = K();
    const c = bootConsole({ relay, church, joinApi: true, relayUrls: urls, fetchImpl: slowFetch, mutate });
    const t0 = Date.now(); const r = await c.api.joinNetwork(OTHER); return { ms: Date.now() - t0, r };
  };
  const par = await time(null);
  assert.equal(par.r.ok, true, JSON.stringify(par.r));
  const serial = (s) => { const a = 'const got = await Promise.all((urls || []).map((u) => ask(u).catch(() => "down")));'; assert.equal(s.split(a).length, 2, 'sabotage anchor not unique'); return s.replace(a, 'const got = []; for (const u of (urls || [])) got.push(await ask(u).catch(() => "down"));'); };   // (re-anchored B2a audit: the probe now answers ok / none / down)
  const ser = await time(serial);
  // A RATIO, NOT A WALL-CLOCK NUMBER (re-audit 2026-11-19: an absolute 1500ms could flake under load; load slows both runs alike). Three relays
  // asked one at a time take ~3x one; asked together, ~1x. Parallel must be under half of serial.
  assert.ok(par.ms * 2 < ser.ms, 'three relays took ' + par.ms + 'ms in parallel vs ' + ser.ms + 'ms one at a time -- they are not being asked together');
});

// ── B2a re-audit (2026-11-19): two engine paths that were only tested through the screen ─────────────────────────────────────────────────────
test('JOIN, A RELAY THAT DOES NOT ANSWER: refused with "couldn\'t reach … try again later", the relay listed as unreachable (not lacking), nothing published; SABOTAGE lets it through', async () => {
  const run = (mutate) => { const base = fakeRelay(), church = K(); const c = bootConsole({ relay: base, church, joinApi: true, relayUrls: [R1, R2], fetchImpl: fetchFor({ 'two.example': 'down' }), mutate }); return c; };
  const c = run(null);
  const r = await c.api.joinNetwork(OTHER, { scopes: ['announcements'] });
  assert.equal(r.ok, false); assert.equal(r.stage, 'relay');
  assert.deepEqual(r.unreachable, [R2]); assert.deepEqual(r.lacking, []);
  assert.match(r.reason, /couldn’t reach wss:\/\/two\.example\/relay/); assert.match(r.reason, /Try again later/);
  assert.equal(c.published.length + c.refused.length, 0, 'something was published although a relay could not be checked');
  const cut = (src) => { const a = 'if (unreachable.length) return { ok: false, stage: "relay"'; assert.equal(src.split(a).length, 2, 'sabotage anchor not unique'); return src.replace(a, 'if (false) return { ok: false, stage: "relay"'); };
  const s = run(cut);
  assert.equal((await s.api.joinNetwork(OTHER, { scopes: ['announcements'] })).ok, true, 'THE SABOTAGE WAS NOT CAUGHT: with the unreachable branch removed the join was still refused');
});

test('networkJoinerCount: a PARTIAL read (not every relay answered) is { atLeast: n }; a complete one is n; nothing known is null; SABOTAGE (a plain number) goes red', async () => {
  const N = K(), A = K(), C = K();
  const base = fakeRelay();
  for (const ch of [A, C]) base.put(finalizeEvent({ kind: 30078, created_at: 100, tags: [['d', 'trinityone/network:' + N.pub], ['t', 'trinityone'], ['p', N.pub]], content: JSON.stringify({ joined: true, v: 1, scopes: ['announcements'] }) }, ch.sk));
  const count = async (complete, mutate, empty) => bootConsole({ relay: base, church: A, networks: [N], mutate,
    queryAsKey: async (u, sk, f) => ({ events: empty ? [] : await base.querySync(u, f), complete }) }).api.networkJoinerCount(N.pub);
  assert.deepEqual(await count(false), { atLeast: 2 }, 'a partial read gave a confident number');
  assert.equal(await count(true), 2, 'a complete read did not give the number');
  assert.equal(await count(true, null, true), null, 'an empty read claimed a count (never 0)');
  const plain = (src) => { const a = 'return jr.authoritative ? jr.joiners.length : { atLeast: jr.joiners.length };'; assert.equal(src.split(a).length, 2, 'sabotage anchor not unique'); return src.replace(a, 'return jr.joiners.length;'); };
  assert.equal(await count(false, plain), 2, 'THE SABOTAGE WAS NOT CAUGHT: the partial read still said "at least"');
});
