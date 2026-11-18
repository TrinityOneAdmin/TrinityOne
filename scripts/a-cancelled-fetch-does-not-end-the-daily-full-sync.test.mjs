// A FETCH THE APP CANCELLED IS NOT TODAY'S FULL DOWNLOAD.
//   Run: node --test scripts/a-cancelled-fetch-does-not-end-the-daily-full-sync.test.mjs
//
// Reported 2026-11-18 (TrinityOne-internal/reference/INVESTIGATION-oppo-devotional-missing-2026-11-18.md): a member's
// phone showed no devotional and no reading plans. Once a day the church-docs hub asks for everything; otherwise only
// for the last three days. At start-up the app cancels and replaces that request. nostr-tools reports the cancelled
// request as finished (its close counts as EOSE, and the close is deferred until after the replacement opened), and
// the hub took that as "today's full download is done" before anything had arrived. The post-auth refetch was then
// incremental, and the older documents — devotionals, plans, the congregation name key — never came for 24 hours.
//
// ── HOW THIS ASSERTS ─────────────────────────────────────────────────────────────────────────────────────────────
// A REAL relay (scripts/gateway.mjs) on a private port and data dir, a REAL nostr-tools SimplePool, and the SHIPPED
// hub, signer and readers lifted out of vendor/fellowship.js (scripts/hub-race-harness.mjs). The NIP-42 signer is
// the shipped statement; it waits on window.Fellowship.ready while the key is unset, which is how the test holds
// auth and orders everything without racing. The shipped 1.3 s post-auth timer is recorded, and the test calls
// refetchChurchDocs at the point it would fire. Auth is released well inside the relay's 2.5 s EOSE grace, and the
// elapsed time is asserted, so the run cannot silently become the slow-sign-in path (that path is T-B 5 / T-B 6 in
// a-cancelled-fetch-is-not-an-answer.test.mjs).
//
// Plan: TrinityOne-internal/reference/PLAN-hub-cancelled-fetch-not-full-2026-11-18.md, T-A (with the audit's T-A6).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { memberApp, K, sleep, until, nowS, dOf, isFull, nameKeyEnvelope, memStorage } from './hub-race-harness.mjs';

const PORT = 19975;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const URL_ = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const church = K(), ruth = K(), abel = K();
const cp = church.pub;
const OLD = nowS() - 10 * 86400;            // ten days ago: outside the incremental window (3 days)
let relay, dataDir;

const connect = () => new Promise((res, rej) => { const s = new WebSocket(URL_); s.on('open', () => res(s)); s.on('error', rej); });
const send = (sock, evt) => new Promise((res) => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { sock.off('message', on); res([m[2], m[3] || '']); } };
  sock.on('message', on); sock.send(JSON.stringify(['EVENT', evt])); setTimeout(() => res([false, '(no reply)']), 5000);
});
const doc = (who, d, content, at, extra = []) => finalizeEvent({ kind: 30078, created_at: at, tags: [['d', d], ['t', NET], ...extra], content: JSON.stringify(content) }, who.sk);
// Everything an ANONYMOUS reader is served for these filters (the control: the fixture must really be gated).
async function anonymous(filters) {
  const s = await connect(); const got = [];
  await new Promise(res => {
    s.on('message', d => { const m = JSON.parse(d); if (m[0] === 'EVENT' && m[1] === 'anon') got.push(m[2]); if (m[0] === 'EOSE' && m[1] === 'anon') res(); });
    s.send(JSON.stringify(['REQ', 'anon', ...filters])); setTimeout(res, 6000);
  });
  s.close(); return got;
}
const HUB_FILTERS = [{ kinds: [30078], authors: [cp], '#t': [NET] }, { kinds: [30078], '#church': [cp], '#t': [NET] }];
const MEM_FILTERS = [{ kinds: [30078], '#p': [cp] }];

before(async () => {
  await requireFreePort(PORT, 'a-cancelled-fetch-does-not-end-the-daily-full-sync.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-hubrace-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp) }, stdio: 'ignore' });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(200); }
  const ws = await connect();
  const put = async (evt, what) => { const [ok, why] = await send(ws, evt); assert.equal(ok, true, `the relay refused the fixture's ${what}: ${why}`); };
  await put(finalizeEvent({ kind: 0, created_at: OLD, tags: [['t', NET]], content: JSON.stringify({ name: 'St Example' }) }, church.sk), 'church profile');
  // an approval-on church, ten days old, with two admitted members
  await put(doc(ruth, 'trinityone/member:' + cp, { joined: OLD }, OLD, [['p', cp]]), 'member doc (ruth)');
  await put(doc(abel, 'trinityone/member:' + cp, { joined: OLD }, OLD, [['p', cp]]), 'member doc (abel)');
  await put(doc(church, 'trinityone/admitted:' + cp, { pubkeys: [ruth.pub, abel.pub] }, OLD), 'admitted list');
  await put(doc(church, 'trinityone/devotional:d1', { title: 'Morning', body: 'Psalm 23' }, OLD), 'devotional');
  await put(doc(church, 'trinityone/plan:p1', { title: 'Mark in a month', days: [] }, OLD), 'plan');
  await put(nameKeyEnvelope(church, ruth, OLD), 'name key envelope');
  // …and ONE recent public document, so the hub's cursor is today (as on the Oppo) and an incremental fetch's
  // `since` really does exclude the ten-day-old corpus
  await put(doc(church, 'trinityone/joinpolicy:' + cp, { approval: true }, nowS() - 60), 'join policy');
  ws.close();
  await sleep(300);
});
after(async () => { try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── the control: if the corpus is not withheld from an anonymous reader, every case below is void ─────────────────
test('control: the relay withholds the ten-day-old corpus from an anonymous reader (and serves the join policy)', async () => {
  const got = await anonymous(HUB_FILTERS);
  const ds = got.map(dOf);
  assert.ok(ds.includes('trinityone/joinpolicy:' + cp), 'the public join policy should be served anonymously');
  for (const d of ['trinityone/devotional:d1', 'trinityone/plan:p1', 'trinityone/namekey:' + cp]) assert.ok(!ds.includes(d), `${d} was served to an anonymous reader — the fixture is not gated, the test is void`);
});

// ── T-A 1: the docs hub race (the bug), and T-A 4 / T-A 5 on the same boot ──────────────────────────────────────
let boot1 = null, authAt1 = 0;
test('T-A 1: a full fetch cancelled before auth does not end the daily full sync — the devotional and the plan arrive', async () => {
  const app = boot1 = memberApp({ me: ruth, relays: [URL_], holdAuth: true });
  let devos = null, plans = null;
  app.api.subscribeChurchDevotionals(cp, d => { devos = d; });
  app.api.subscribeChurchPlans(cp, p => { plans = p; });
  // A: the full REQ, unauthenticated; the relay challenges and holds its EOSE
  assert.ok(await until(() => app.hubReqs(cp).length === 1), 'the hub opened');
  assert.ok(isFull(app.hubReqs(cp)[0]), 'A is the full fetch');
  assert.ok(await until(() => app.docsHub(cp).since > 0), 'the public join policy arrived on A');
  // B: a start-up refetch replaces A; A's deferred close then lands
  app.api.refetchChurchDocs();
  await sleep(400);
  // C: the post-auth refetch (the shipped 1.3 s timer, played here)
  app.api.refetchChurchDocs();
  const lastReqAt = Date.now();
  const C = app.hubReqs(cp).at(-1);
  await sleep(150);
  app.releaseAuth();
  assert.ok(Date.now() - lastReqAt < 1500, 'auth must be released inside the relay\'s 2.5 s EOSE grace, or this is the slow-sign-in path');
  assert.ok(await until(() => app.t._relayAuthOkAt > 0), 'the relay accepted the auth');
  authAt1 = app.t._relayAuthedAt;
  await until(() => devos && devos.length && plans && plans.length, 6000);
  await sleep(1200);   // let the hub's 800 ms save land
  assert.equal(app.hubReqs(cp).length, 3, 'exactly A, B and C were sent');
  assert.ok(isFull(C), `C (the post-auth refetch) must still ask for everything; it sent since=${JSON.stringify(C.filters.map(f => f.since))}`);
  assert.equal((devos || []).length, 1, 'the ten-day-old devotional reached subscribeChurchDevotionals');
  assert.equal((plans || []).length, 1, 'the ten-day-old plan reached subscribeChurchPlans');
  const saved = app.persisted('trinityone.docshub.' + cp);
  assert.ok(saved && saved.fullAt * 1000 >= authAt1 - 1000, `persisted fullAt (${saved && saved.fullAt}) must not predate the auth (${Math.floor(authAt1 / 1000)})`);
  app.clean();
});

test('T-A 4 (F12, names): after that boot the name is never sealed to the church key alone, and the ring holds the old key', async () => {
  assert.ok(boot1, 'T-A 1 ran');
  const app = boot1;
  await app.api.syncSealedNames([cp]);
  await sleep(100);
  const bad = app.published.filter(p => p.ring === 0);
  assert.deepEqual(bad, [], 'syncSealedNames published the name with an EMPTY name-key ring — sealed to the church key only, the member is Anonymous to the congregation');
  assert.ok((app.t._nameKeys.get(cp) || []).length > 0, 'the ten-day-old congregation name key should be in the ring');
  app.clean();
});

test('T-A 5 (small pipes): once a full has completed, the next refetch is incremental', async () => {
  assert.ok(boot1, 'T-A 1 ran');
  const app = boot1;
  app.api.refetchChurchDocs();
  const r = app.hubReqs(cp).at(-1);
  assert.ok(!isFull(r), 'a refetch after a completed full must send `since`');
  await sleep(300);
  app.clean();
  app.close();
});

// ── T-A 2: the members hub race ───────────────────────────────────────────────────────────────────────────────
test('T-A 2: the members hub — a cancelled full fetch does not stop the ten-day-old member being listed', async () => {
  // the control for THIS case, decided by measurement (audit F7): the member docs must be withheld anonymously
  const anon = await anonymous(MEM_FILTERS);
  assert.ok(!anon.some(e => dOf(e) === 'trinityone/member:' + cp), 'member: docs are served to an anonymous reader — this case is void here and belongs in T-B');
  // a warm phone whose daily full is due: cursor recent, last full two days ago
  const storage = memStorage();
  storage.setItem('trinityone.memhub.' + cp, JSON.stringify({ since: nowS() - 60, fullAt: nowS() - 2 * 86400, members: [] }));
  const app = memberApp({ me: ruth, relays: [URL_], holdAuth: true, storage });
  let list = null;
  const sub = () => app.api.subscribeChurchMembers(cp, (m) => { list = m; });
  let off = sub();
  assert.ok(await until(() => app.memReqs(cp).length === 1));
  assert.ok(isFull(app.memReqs(cp)[0]), 'A is the full fetch (the daily one is due)');
  await sleep(200);
  off(); off = sub();           // the connTick teardown to 0 refs + re-register: A cancelled, B opened
  await sleep(400);             // A's deferred close lands
  off(); off = sub();           // and again (C)
  const lastReqAt = Date.now();
  const C = app.memReqs(cp).at(-1);
  await sleep(150);
  app.releaseAuth();
  assert.ok(Date.now() - lastReqAt < 1500, 'auth released inside the relay\'s grace');
  await until(() => list && list.some(m => m.pubkey === abel.pub), 6000);
  assert.ok(isFull(C), 'C must still be the full fetch');
  assert.ok(list && list.some(m => m.pubkey === abel.pub), 'the ten-day-old member is listed');
  off(); await sleep(200);
  app.clean(); app.close();
});

// ── T-A 3: cancelled at 0 refs, reopened later ────────────────────────────────────────────────────────────────
test('T-A 3: a full fetch torn down at 0 refs and reopened later is still full', async () => {
  const app = memberApp({ me: ruth, relays: [URL_], holdAuth: true });
  let off = app.api.subscribeChurchDevotionals(cp, () => {});
  assert.ok(await until(() => app.docsHub(cp) && app.docsHub(cp).since > 0), 'A delivered the public join policy');
  off();                        // 0 refs: A is cancelled and nothing replaces it
  await sleep(500);             // its deferred close lands
  off = app.api.subscribeChurchDevotionals(cp, () => {});
  const r = app.hubReqs(cp).at(-1);
  assert.equal(app.hubReqs(cp).length, 2);
  assert.ok(isFull(r), `the reopen must be full; it sent since=${JSON.stringify(r.filters.map(f => f.since))}`);
  off(); await sleep(200);
  app.clean(); app.close();
});

// ── T-A 6 (audit F4): an incremental answer never stamps the daily full ───────────────────────────────────────
test('T-A 6: a live INCREMENTAL answer does not count as the daily full — the full still runs when it falls due', async () => {
  let offset = 0;
  class Clock extends Date { static now() { return Date.now() + offset; } }
  const storage = memStorage();
  const fakeNowS = () => Math.floor(Clock.now() / 1000);
  storage.setItem('trinityone.docshub.' + cp, JSON.stringify({ since: fakeNowS() - 60, fullAt: fakeNowS() - Math.round(23.9 * 3600), events: [] }));
  const app = memberApp({ me: ruth, relays: [URL_], clock: Clock, storage });
  let devos = null;
  app.api.subscribeChurchDevotionals(cp, d => { devos = d; });
  assert.ok(await until(() => app.hubReqs(cp).length === 1));
  assert.ok(!isFull(app.hubReqs(cp)[0]), 'the first open is incremental (the last full was 23.9 h ago)');
  assert.ok(await until(() => app.docsHub(cp).eosed, 8000), 'the incremental fetch was answered');
  offset = Math.round(0.2 * 3600 * 1000);   // 0.2 h later: the daily full is now due
  app.api.refetchChurchDocs();
  assert.ok(isFull(app.hubReqs(cp).at(-1)), 'the full fetch must run once 24 h have passed since the last FULL, whatever incremental fetches happened since');
  await sleep(300);
  app.clean(); app.close();
});
