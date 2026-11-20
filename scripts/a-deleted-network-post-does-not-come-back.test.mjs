// A DELETED NETWORK POST DOES NOT COME BACK WHEN AN OLDER COPY ARRIVES FROM ANOTHER RELAY (B1 audit, 2026-11-19).
//   Run: node --test scripts/a-deleted-network-post-does-not-come-back.test.mjs
//
// A post lives on every relay the network wrote to, and relays answer in any order. The member reader (subscribeNetworkContent, vendor/fellowship.js)
// and the console reader (subscribeNetworkPosts, vendor/steward.js) used to forget a post when its deletion arrived -- so the OLDER live copy that a
// slower second relay delivered next put it straight back. Both now remember each deletion's time per post and ignore older copies; a NEWER copy
// (the network re-posting under the same id) still shows. WHAT RUNS: both shipped readers, cut out of the bundles by scripts/net-bundle-rig.mjs,
// over a "two relays" stand-in that delivers the deletion first and the older copy second. Each reader's guard is sabotaged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent } from 'nostr-tools/pure';
import { K, rnd32, tag, NET, fakeRelay, bootConsole, bootMember, tick, hexBytes, scoped } from './net-bundle-rig.mjs';

const P = 'trinityone/';
// a world with one post, then deleted; returns the stand-in plus the OLD live copy a second relay still holds
async function world() {
  const relay = fakeRelay(), N = K(), A = K(), nk = rnd32();
  const c = bootConsole({ relay, church: A, networks: [N], nameKey: nk, founded: [N.pub] });
  c.join(N.pub);
  assert.equal((await c.api.syncNetworkKey(N.pub)).ok, true); assert.equal((await c.api.syncNetworkHop2(N.pub)).ok, true);
  const p = await c.api.publishNetworkPost(N.pub, 'announcement', { text: 'Youth night is moved to Friday' }); assert.equal(p.ok, true);
  const live = relay.all().find(e => tag(e, 'd') === P + 'netann:' + p.id);
  await new Promise(r => setTimeout(r, 1100));   // the deletion is a later second than the post
  assert.equal((await c.api.removeNetworkPost(N.pub, 'announcement', p.id)).ok, true);
  return { relay, N, A, nk, c, live, id: p.id };
}
// what the reader sees when relay 1 (current: the deletion) answers first and relay 2 (stale: the old live copy) answers after it
const twoRelays = (relay, late) => ({ ...relay, subscribeMany: (u, f, h) => { const s = relay.subscribeMany(u, f, { onevent: h.onevent, oneose() {} }); setTimeout(() => { for (const e of late) h.onevent(e); try { h.oneose && h.oneose(); } catch (x) {} }, 5); return s; } });
async function memberSees(w, late, mutate) {
  const m = bootMember({ relay: twoRelays(w.relay, late), cp: w.A.pub, nameKeys: [hexBytes(w.nk)], mutate });
  const seen = []; const stop = m.subscribe(w.N.pub, (r) => seen.push(r)); await tick(60); stop();
  return seen[seen.length - 1];
}
async function consoleSees(w, late, mutate) {
  const c2 = bootConsole({ relay: twoRelays(w.relay, late), church: w.A, networks: [w.N], nameKey: w.nk, founded: [w.N.pub], mutate });
  const seen = []; const stop = c2.api.subscribeNetworkPosts(w.N.pub, (ps) => seen.push(ps)); await tick(80); stop();
  return seen[seen.length - 1] || [];
}
const memberGuard = (s) => scoped(s, '    subscribeNetworkContent(', '__api.__replay', 'if ((dead.get(d) || -1) >= (e.created_at || 0)) return;', '');
const consoleGuard = (s) => scoped(s, '    subscribeNetworkPosts(', 'window.Steward = __api;', 'if ((dead.get(d) || -1) >= (e.created_at || 0)) return;', '');

test('MEMBER: the deletion first, the older copy second -- the post stays gone (CONTROL: with no late copy it is gone too, and a NEWER re-post shows)', async () => {
  const w = await world();
  assert.equal((await memberSees(w, [])).announcements.length, 0, 'CONTROL: the deleted post shows even with no stale relay');
  const got = await memberSees(w, [w.live]);
  assert.equal(got.state, 'ready'); assert.equal(got.announcements.length, 0, 'an older copy from a second relay brought a deleted post back for the member');
  const again = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000) + 5, tags: [['d', P + 'netann:' + w.id], ['t', NET]], content: w.live.content }, w.N.sk);
  assert.equal((await memberSees(w, [again])).announcements.length, 1, 'a NEWER copy under the same id (a re-post) must still show -- the guard over-blocks');
});

test('MEMBER SABOTAGE: without the remembered deletion the older copy brings the post back', async () => {
  const w = await world();
  assert.equal((await memberSees(w, [w.live], memberGuard)).announcements.length, 1, 'THE SABOTAGE WAS NOT CAUGHT: the member reader still hid the stale copy');
});

test('CONSOLE: the same arrival order -- the post stays gone in the console\'s preview; SABOTAGE brings it back', async () => {
  const w = await world();
  assert.equal((await consoleSees(w, [w.live])).length, 0, 'an older copy from a second relay brought a deleted post back in the console');
  assert.equal((await consoleSees(w, [w.live], consoleGuard)).length, 1, 'THE SABOTAGE WAS NOT CAUGHT: the console reader still hid the stale copy');
});
