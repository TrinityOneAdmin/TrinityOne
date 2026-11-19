// THE OPEN-CHURCH JOIN REFULL KEEPS EVERY RULE THE HUB ALREADY HAS: it survives a kill, it shares one download with
// the post-sign-in re-full (B), B's cap never blocks it and it never spends B's cap, and a refull nobody answered is
// not a full sync.
//   Run: node --test scripts/an-open-church-joiner-refull-keeps-the-hub-rules.test.mjs
//
// The companion of an-open-church-joiner-gets-the-older-documents.test.mjs (the real gateway). Here the relay is
// SCRIPTED (scriptedRelay in scripts/hub-race-harness.mjs: a real websocket server the test steers) under a REAL
// nostr-tools SimplePool, so the test decides when the relay answers, challenges or holds. The hub, the NIP-42
// signer, announceMembership and _refullChurchHubs are the SHIPPED ones, lifted out of vendor/fellowship.js. The
// publish is stubbed to "accepted": the scripted relay does not store events, and the transport is not under test.
//
// Plan: TrinityOne-internal/reference/PLAN-open-church-join-full-fetch-2026-11-19.md, O5-O7 (with audit F3, F4, F6).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent } from 'nostr-tools/pure';
import { requireFreePort } from './test-ports.mjs';
import { memberApp, scriptedRelay, K, sleep, until, nowS, isFull, memStorage, HAS_REFULL } from './hub-race-harness.mjs';

const PORT = 19983, PORT_DEAD = 19984;   // PORT_DEAD: nothing listens there (connection refused)
const NET = 'trinityone';
const church = K(), abel = K();
const cp = church.pub;
const OLD = nowS() - 10 * 86400;
const doc = (who, d, content, at, extra = []) => finalizeEvent({ kind: 30078, created_at: at, tags: [['d', d], ['t', NET], ...extra], content: JSON.stringify(content) }, who.sk);
let r;

before(async () => {
  await requireFreePort(PORT, 'an-open-church-joiner-refull-keeps-the-hub-rules.test.mjs');
  await requireFreePort(PORT_DEAD, 'an-open-church-joiner-refull-keeps-the-hub-rules.test.mjs');
  r = await scriptedRelay(PORT);
});
after(async () => { try { await r.close(); } catch {} });

// A fresh relay state: recent PUBLIC docs on both hubs (so each hub has a cursor and an incremental `since` really
// excludes the old corpus) and a ten-day-old GATED devotional.
function reset(graceMs = 2500) {
  r.mode = 'gate'; r.docs = []; r.log = []; r.graceMs = graceMs; r.challengeEveryReq = false; r.replayDelayMs = 0; r.refuseAuth = false;
  for (const s of r.socks) { try { s.ws.terminate(); } catch {} }
  r.add(doc(church, 'trinityone/joinpolicy:' + cp, { approval: false }, nowS() - 60), false);
  r.add(doc(abel, 'trinityone/member:' + cp, { joined: nowS() - 120 }, nowS() - 120, [['p', cp]]), false);
  r.add(doc(church, 'trinityone/devotional:d1', { title: 'Morning' }, OLD), true);
}
const joiner = (opts) => memberApp({ me: K(), relays: [r.url], announce: true, publishAny: async () => {}, ...opts });
const subscribe = (app) => { app.api.subscribeChurchDevotionals(cp, () => {}); app.api.subscribeChurchMembers(cp, () => {}); };
const thin = (app) => until(() => app.docsHub(cp) && app.docsHub(cp).fullAt > 0 && app.memHub(cp) && app.memHub(cp).fullAt > 0, 8000);

// ── O5: a kill between the trigger and the answer ───────────────────────────────────────────────────────────────
test('O5: killed after the join was accepted but before the refull answered — the next boot still asks for everything', async () => {
  reset();
  const app = joiner();
  subscribe(app);
  assert.ok(await thin(app), 'the first full of both hubs was answered');
  await sleep(1000);                                     // its 800 ms saves have landed
  r.mode = 'hold';                                       // from here the relay answers nothing
  const t0 = Date.now();
  assert.ok(await app.api.announceMembership(cp), 'the join was accepted');
  await until(() => app.hubReqs(cp).some(q => q.at >= t0) && app.memReqs(cp).some(q => q.at >= t0), 2000);
  // F6: a KILL — no unsubscribe, no teardown (the 0-ref teardown saves the hub and would mask a missing save)
  const disk = memStorage();
  for (const [k, v] of app.storage._map) disk.setItem(k, v);
  const next = joiner({ storage: disk });
  subscribe(next);
  assert.ok(await until(() => next.hubReqs(cp).length && next.memReqs(cp).length), 'the next boot opened both hubs');
  assert.ok(isFull(next.hubReqs(cp)[0]), 'docs hub: the boot after the kill must ask for everything');
  assert.ok(isFull(next.memReqs(cp)[0]), 'members hub: the boot after the kill must ask for everything');
  await sleep(200);
  next.clean(); next.close(); app.close();
});

// ── O6: B — the post-sign-in re-full ─────────────────────────────────────────────────────────────────────────────
// The first full is answered BEFORE sign-in (the relay's grace runs out), so B is owed. Then sign-in, then the join.
async function preAuthThenAuth() {
  reset(300);
  const app = joiner({ holdAuth: true });
  subscribe(app);
  assert.ok(await thin(app), 'the first full of both hubs was answered (before sign-in)');
  assert.equal(app.docsHub(cp).fullPreAuth, true, 'instrument: that full was answered before sign-in, so B is owed');
  app.releaseAuth();
  assert.ok(await until(() => app.t._relayAuthOkAt > 0, 6000), 'the relay accepted our auth');
  await sleep(300);
  return { app, authAt: app.t._relayAuthedAt };
}
const fullsSince = (app, at) => app.hubReqs(cp).filter(q => q.at >= at && isFull(q));

test('O6a: join accepted before the post-sign-in refetch — ONE full answers both the join and B, and the refetch is then incremental', async () => {
  const { app, authAt } = await preAuthThenAuth();
  const t0 = Date.now();
  assert.ok(await app.api.announceMembership(cp), 'the join was accepted');
  assert.ok(await until(() => app.docsHub(cp).fullAt * 1000 >= t0 - 1000 && app.docsHub(cp).refullDone, 4000), 'the refull was answered and counted as B\'s re-full');
  app.api.refetchChurchDocs();                           // the shipped post-auth refetch, played after it
  assert.ok(!isFull(app.hubReqs(cp).at(-1)), 'the post-sign-in refetch must be incremental — the join\'s full already served B');
  assert.equal(fullsSince(app, authAt).length, 1, 'exactly one full docs REQ after sign-in');
  await sleep(200);
  app.clean(); app.close();
});

test('O6b: B already spent this session — the join still gets its full (the cap never blocks it); the reverse order is recorded', async (t) => {
  const { app, authAt } = await preAuthThenAuth();
  app.api.refetchChurchDocs();                           // B's re-full first
  assert.ok(isFull(app.hubReqs(cp).at(-1)), 'instrument: B\'s re-full is full');
  assert.ok(await until(() => app.docsHub(cp).refullDone, 4000), 'instrument: B was answered and its cap spent');
  const t0 = Date.now();
  assert.ok(await app.api.announceMembership(cp), 'the join was accepted');
  assert.ok(await until(() => app.hubReqs(cp).some(q => q.at >= t0), 2000), 'the join reopened the docs hub');
  assert.ok(isFull(app.hubReqs(cp).filter(q => q.at >= t0)[0]), 'the join\'s refull must be full although B\'s cap is spent');
  await until(() => app.docsHub(cp).fullAt * 1000 >= t0 - 1000, 4000);
  t.diagnostic(`reverse order (B first, then the join): ${fullsSince(app, authAt).length} answered full docs REQs after sign-in (expected 2; the later one is the complete one)`);
  await sleep(200);
  app.clean(); app.close();
});

test('O6c: a refull answered BEFORE sign-in does not spend B — the post-sign-in refetch is still full', async () => {
  assert.ok(HAS_REFULL, 'the bundle has no _refullChurchHubs');
  reset(300);
  const app = joiner({ holdAuth: true });
  subscribe(app);
  assert.ok(await thin(app), 'the first full was answered before sign-in');
  const t0 = Date.now();
  app.api._refullChurchHubs(cp);                         // the trigger, while sign-in is still pending
  assert.ok(isFull(app.hubReqs(cp).at(-1)), 'the refull is full');
  assert.ok(await until(() => app.docsHub(cp).fullAt * 1000 >= t0 - 1000, 3000), 'the refull was answered (before sign-in)');
  await sleep(50);
  assert.equal(app.docsHub(cp).fullPreAuth, true, 'that answer was before sign-in, so B is still owed');
  app.releaseAuth();
  assert.ok(await until(() => app.t._relayAuthOkAt > 0, 6000), 'the relay accepted our auth');
  app.api.refetchChurchDocs();                           // the shipped post-auth refetch
  assert.ok(isFull(app.hubReqs(cp).at(-1)), 'the post-sign-in refetch must still be full — the pre-sign-in refull must not spend B');
  assert.equal(app.docsHub(cp).refullDone, false, 'refullDone was set before B\'s re-full was answered');
  assert.ok(await until(() => app.docsHub(cp).refullDone === true, 4000), 'B\'s re-full, once answered, sets refullDone');
  await sleep(200);
  app.clean(); app.close();
});

// ── O7: nobody answered the refull ──────────────────────────────────────────────────────────────────────────────
test('O7: a refull that no relay answered is not a full sync — the next open still asks for everything', async () => {
  reset();
  const app = joiner();
  subscribe(app);
  assert.ok(await thin(app), 'the first full of both hubs was answered');
  app.setRelays([`ws://127.0.0.1:${PORT_DEAD}/`]);        // the relay is gone when the join lands
  const t0 = Date.now();
  assert.ok(await app.api.announceMembership(cp), 'the join was accepted');
  assert.ok(await until(() => app.hubReqs(cp).some(q => q.at >= t0) && app.docsHub(cp).eosedAt >= t0, 6000), 'the reopen settled');
  await sleep(100);
  assert.equal(app.docsHub(cp).fullAt, 0, 'docs hub: fullAt was stamped by a refull nobody answered');
  assert.equal(app.memHub(cp).fullAt, 0, 'members hub: fullAt was stamped by a refull nobody answered');
  app.api.refetchChurchDocs();
  assert.ok(isFull(app.hubReqs(cp).at(-1)), 'the next open must still be full');
  await sleep(200);
  app.clean(); app.close();
});
