// A FETCH THE APP CANCELLED, OR ONE NO RELAY ANSWERED, IS NOT AN ANSWER — for the daily full sync, for the
// safeguarding list ("we know who the children are"), or for the sealed-name gate.
//   Run: node --test scripts/a-cancelled-fetch-is-not-an-answer.test.mjs
//
// The companion of a-cancelled-fetch-does-not-end-the-daily-full-sync.test.mjs (the real gateway). Here the relay
// is SCRIPTED (scriptedRelay in scripts/hub-race-harness.mjs: a real websocket server the test steers) under a REAL
// nostr-tools SimplePool, so the library's own deferred close and handleClose -> handleEose run for real while the
// test decides exactly when each relay answers, refuses, challenges or is unreachable. The hub, the shipped NIP-42
// signer, _noteAuthAccepted (so _relayAuthOkAt is set by a real OK), reconnectAll, subscribeChurchSafeguard and
// syncSealedNames are the SHIPPED ones, lifted out of vendor/fellowship.js with their bundle names.
//
// Why both safety readers are here: `minorsKnown` (subscribeChurchSafeguard) and the sealed-name gate
// (syncSealedNames) both read hub.eosedAt as "the relay answered us after it knew who we were". A cancelled fetch,
// or an incremental one over a full that finished before sign-in, made them read an answer that never came. For the
// name gate that publishes the member's name sealed to the church key only — the member shows as Anonymous to the
// congregation (owner has seen Anonymous members on real phones; this is one way it happens).
//
// Plan: TrinityOne-internal/reference/PLAN-hub-cancelled-fetch-not-full-2026-11-18.md, T-B, with the audit's
// T-B2c (F2) and T-B6 (F1).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent } from 'nostr-tools/pure';
import { requireFreePort } from './test-ports.mjs';
import { memberApp, scriptedRelay, K, sleep, until, nowS, isFull, nameKeyEnvelope, memStorage } from './hub-race-harness.mjs';

const P1 = 19976, P2 = 19977, DEAD1 = 19978, DEAD2 = 19979;   // DEAD*: nothing listens there (connection refused)
const NET = 'trinityone';
const church = K(), ruth = K(), child = K();
const cp = church.pub;
const OLD = nowS() - 10 * 86400;
const doc = (who, d, content, at, extra = []) => finalizeEvent({ kind: 30078, created_at: at, tags: [['d', d], ['t', NET], ...extra], content: JSON.stringify(content) }, who.sk);
const deadUrl = (p) => `ws://127.0.0.1:${p}/`;
let r1, r2;

before(async () => {
  for (const p of [P1, P2, DEAD1, DEAD2]) await requireFreePort(p, 'a-cancelled-fetch-is-not-an-answer.test.mjs');
  r1 = await scriptedRelay(P1);
  r2 = await scriptedRelay(P2);
});
after(async () => { try { await r1.close(); } catch {} try { await r2.close(); } catch {} });
const reset = (r, mode = 'gate') => { r.mode = mode; r.docs = []; r.log = []; r.graceMs = 2500; r.challengeEveryReq = false; r.replayDelayMs = 0; for (const s of r.socks) { try { s.ws.terminate(); } catch {} } };
const warm = (fullAgoS) => { const s = memStorage(); s.setItem('trinityone.docshub.' + cp, JSON.stringify({ since: nowS() - 60, fullAt: nowS() - fullAgoS, events: [] })); return s; };
const noAnonSeal = (app) => app.published.filter(p => p.ring === 0);

// ── T-B 1: F12, safeguarding AND names ──────────────────────────────────────────────────────────────────────────
test('T-B 1: a fetch cancelled after auth is not an answer — minorsKnown stays false and no name is sealed to the church key', async () => {
  reset(r1, 'hold'); r1.challengeEveryReq = true;
  const app = memberApp({ me: ruth, relays: [r1.url] });
  const lists = [];
  app.api.subscribeChurchSafeguard(cp, l => lists.push(l));
  assert.ok(await until(() => app.t._relayAuthOkAt > 0), 'the relay accepted our auth (a real OK)');
  app.api.refetchChurchDocs();                       // the first sub is replaced before the relay answered it
  assert.ok(await until(() => r1.closes().length === 1), 'the first sub was CLOSEd');
  await sleep(200);
  assert.ok(!app.docsHub(cp).eosedAt, `hub.eosedAt was stamped (${app.docsHub(cp).eosedAt}) by a sub nobody answered`);
  assert.ok(lists.every(l => !l.minorsKnown), 'subscribeChurchSafeguard said minorsKnown:true over an answer that never came');
  await app.api.syncSealedNames([cp]);
  assert.deepEqual(noAnonSeal(app), [], 'syncSealedNames sealed the name to the church key only over an answer that never came');
  // control: the replacement's own answer does count
  r1.eose();
  assert.ok(await until(() => app.docsHub(cp).eosedAt > 0), 'the replacement was answered');
  assert.equal(lists.at(-1).minorsKnown, true, 'control: a live post-auth answer is an answer');
  app.clean(); app.close();
});

// ── T-B 2: nobody answered ───────────────────────────────────────────────────────────────────────────────────────
async function nobodyAnswered(relays, label) {
  const storage = warm(2 * 86400);
  const before = JSON.parse(storage.getItem('trinityone.docshub.' + cp)).fullAt;
  const app = memberApp({ me: ruth, relays, storage });
  let eoses = 0;
  app.api._onChurchDocs(cp, { onevent() {}, oneose() { eoses++; } });
  if (relays.length) assert.ok(isFull(app.hubReqs(cp)[0]), 'the daily full is due, so the open is full');
  assert.ok(await until(() => eoses > 0, 6000), `${label}: the hub settled`);
  await sleep(50);
  assert.equal(app.docsHub(cp).fullAt, before, `${label}: fullAt was stamped although no relay answered`);
  if (!relays.length) app.setRelays([deadUrl(DEAD1)]);
  app.api.refetchChurchDocs();
  assert.ok(isFull(app.hubReqs(cp).at(-1)), `${label}: the next open must still be full`);
  await sleep(100);
  app.clean(); app.close();
}
test('T-B 2a: every relay answers CLOSED auth-required — not a full sync', async () => {
  reset(r1, 'closed-auth'); reset(r2, 'closed-auth');
  await nobodyAnswered([r1.url, r2.url], 'all CLOSED');
});
test('T-B 2b: every relay refuses the connection — not a full sync', async () => {
  await nobodyAnswered([deadUrl(DEAD1), deadUrl(DEAD2)], 'all refused');
});
test('T-B 2c (audit F2): an empty relay list — asked nobody — is not a full sync', async () => {
  await nobodyAnswered([], 'empty list');
});

test('T-B 2d: the members hub — every relay refuses the connection — not a full sync either', async () => {
  const storage = memStorage();
  const fullAt0 = nowS() - 2 * 86400;
  storage.setItem('trinityone.memhub.' + cp, JSON.stringify({ since: nowS() - 60, fullAt: fullAt0, members: [] }));
  const app = memberApp({ me: ruth, relays: [deadUrl(DEAD1), deadUrl(DEAD2)], storage });
  let done = 0;
  const off = app.api.subscribeChurchMembers(cp, (_m, isDone) => { if (isDone) done++; });
  assert.ok(isFull(app.memReqs(cp)[0]), 'the daily full is due, so the open is full');
  assert.ok(await until(() => done > 0, 6000), 'the members hub settled');
  await sleep(50);
  assert.equal(app.memHub(cp).fullAt, fullAt0, 'members hub: fullAt was stamped although no relay answered');
  off(); await sleep(50);
  const off2 = app.api.subscribeChurchMembers(cp, () => {});
  assert.ok(isFull(app.memReqs(cp).at(-1)), 'members hub: the next open must still be full');
  off2(); await sleep(100);
  app.clean(); app.close();
});

// ── T-B 3: documents the multi-relay rule ───────────────────────────────────────────────────────────────────────
test('T-B 3 (documents the rule): one relay answers and one is unreachable — that IS the full sync (replicas)', async () => {
  reset(r1, 'gate');
  const app = memberApp({ me: ruth, relays: [r1.url, deadUrl(DEAD1)], storage: warm(2 * 86400) });
  let eoses = 0;
  app.api._onChurchDocs(cp, { onevent() {}, oneose() { eoses++; } });
  assert.ok(await until(() => eoses > 0, 6000));
  await sleep(50);
  assert.ok(app.docsHub(cp).fullAt >= nowS() - 5, 'fullAt stamped by the answering relay');
  app.api.refetchChurchDocs();
  assert.ok(!isFull(app.hubReqs(cp).at(-1)), 'the next open is incremental');
  await sleep(100);
  app.clean(); app.close();
});

// ── T-B 4: documents the library ────────────────────────────────────────────────────────────────────────────────
test('T-B 4 (documents nostr-tools, not this fix): an EOSE for a sub after its CLOSE changes nothing', async () => {
  reset(r1, 'hold');
  const app = memberApp({ me: ruth, relays: [r1.url], storage: warm(2 * 86400) });
  app.api._onChurchDocs(cp, { onevent() {}, oneose() {} });
  assert.ok(await until(() => r1.subIds().length === 1));
  const aId = r1.subIds()[0];
  app.api.refetchChurchDocs();
  assert.ok(await until(() => r1.closes().includes(aId)));
  await sleep(200);
  const h = app.docsHub(cp);
  const snap = { eosed: h.eosed, eosedAt: h.eosedAt, fullAt: h.fullAt };
  r1.rawEose(aId);                                     // the gateway's _pendingEose leak, as seen on the Oppo
  await sleep(200);
  assert.deepEqual({ eosed: h.eosed, eosedAt: h.eosedAt, fullAt: h.fullAt }, snap);
  app.clean(); app.close();
});

// ── T-B 5: part B — a full answered before sign-in is redone once after it ─────────────────────────────────────
test('T-B 5 (B): a full sync that finished before we authenticated is redone once after we do — and only once', async () => {
  reset(r1, 'gate');
  r1.add(doc(church, 'trinityone/joinpolicy:' + cp, { approval: true }, nowS() - 60), false);
  const app = memberApp({ me: ruth, relays: [r1.url] });
  app.api._onChurchDocs(cp, { onevent() {}, oneose() {} });
  assert.ok(await until(() => app.docsHub(cp).eosed), 'the full fetch was answered');
  assert.equal(app.t._relayAuthOkAt, 0, 'and it was answered BEFORE any auth');
  r1.challenge();                                      // the relay now asks who we are; we sign; it says OK
  assert.ok(await until(() => app.t._relayAuthOkAt > 0), 'auth accepted');
  app.api.refetchChurchDocs();                         // the post-auth refetch
  assert.ok(isFull(app.hubReqs(cp).at(-1)), 'the post-auth refetch must ask for everything again');
  const okAt = app.t._relayAuthOkAt;
  assert.ok(await until(() => app.docsHub(cp).eosedAt > okAt), 'the post-auth full was answered');
  await sleep(50);
  app.api.refetchChurchDocs();
  assert.ok(!isFull(app.hubReqs(cp).at(-1)), 'bounded: after a post-auth full the next open is incremental');
  await sleep(100);
  app.clean(); app.close();
});

// ── T-B 6 (audit F1): the PIN-locked boot ───────────────────────────────────────────────────────────────────────
test('T-B 6 (locked boot): until the full post-auth answer lands, minorsKnown stays false and no name is sealed to the church key', async () => {
  reset(r1, 'gate');
  r1.graceMs = 100;                                    // the relay's grace runs out while the phone is locked
  r1.add(doc(church, 'trinityone/joinpolicy:' + cp, { approval: true }, nowS() - 60), false);    // public, recent
  r1.add(doc(church, 'trinityone/minors:' + cp, { pubkeys: [child.pub] }, OLD), true);          // gated, old
  r1.add(nameKeyEnvelope(church, ruth, OLD), true);                                              // gated, old
  r1.add(doc(church, 'trinityone/devotional:new', { title: 'Today' }, nowS() - 120), true);      // gated, recent
  const app = memberApp({ me: ruth, relays: [r1.url], locked: true });
  const lists = [];
  const reg = () => app.api.subscribeChurchSafeguard(cp, l => lists.push(l));
  let off = reg();
  assert.ok(await until(() => app.docsHub(cp).eosed), 'the keyless fetch was answered (grace EOSE, public docs only)');
  assert.equal(app.t._relayAuthedAt, 0, 'nothing authenticated while locked');
  r1.graceMs = 5000; r1.replayDelayMs = 50;
  app.unlock();                                        // key derived, reconnectAll
  // connTick re-registers on a fresh socket a moment later. Not in the same tick: nostr-tools' old relay deletes
  // its url from pool.relays when its socket finishes closing, and a new relay registered before that is lost
  // from the map (then _noteAuthAccepted cannot find it and _relayAuthOkAt is never set).
  await sleep(300);
  off(); off = reg();
  const sub2 = await (async () => { await until(() => r1.subIds().length === 2); return r1.subIds()[1]; })();
  assert.ok(await until(() => app.t._relayAuthOkAt > 0), 'the fresh socket authenticated');
  assert.ok(await until(() => r1.log.some(l => l.dir === 'out' && l.msg[0] === 'EOSE' && l.msg[1] === sub2)), 'the relay answered the reopen');
  await sleep(150);
  assert.ok(lists.every(l => !l.minorsKnown), 'minorsKnown:true before the church\'s list of children had arrived');
  await app.api.syncSealedNames([cp]);
  assert.deepEqual(noAnonSeal(app), [], 'syncSealedNames sealed the name to the church key only before the name key arrived');
  // the shipped post-auth refetch (1.3 s timer, played here)
  app.api.refetchChurchDocs();
  const done = await until(() => lists.some(l => l.minors.includes(child.pub)) && (app.t._nameKeys.get(cp) || []).length > 0, 6000);
  assert.ok(done, 'the ten-day-old list of children and name key arrived after auth');
  await sleep(150);
  assert.deepEqual(noAnonSeal(app), [], 'never sealed to the church key only');
  assert.equal(lists.at(-1).minorsKnown, true);
  off(); await sleep(100);
  app.clean(); app.close();
});
