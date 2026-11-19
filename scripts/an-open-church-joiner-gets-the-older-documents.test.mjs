// A NEW MEMBER OF AN OPEN CHURCH GETS THE CHURCH'S OLDER DOCUMENTS ON THEIR FIRST DAY.
//   Run: node --test scripts/an-open-church-joiner-gets-the-older-documents.test.mjs
//
// Sim 2026-11-19 (TrinityOne-internal/reference/SIM-extras-98c7143d-2026-11-18.md, E2-F1, 3 of 3, also on main): in a
// church with approval OFF, a joiner's first full fetch of the docs hub and the members hub is answered BEFORE the
// relay counts them as a member — the app asks for "everything" in the same instant it publishes its member: doc.
// That thin answer was stamped as the day's full download (fullAt), so older plans, devotionals and members (older
// than the 3-day incremental window) did not reach the phone for up to 24 hours, however often it restarted.
// Approval-ON churches recovered through _noteAdmitted; an open church never writes admitted: for anyone.
//
// THE FIX: the first time a relay accepts this identity's member: doc for this church (announceMembership,
// !_joinSentFor before _markJoinSent), both hubs ask for everything once (_refullChurchHubs) — the same helper the
// approval path now uses.
//
// ── HOW THIS ASSERTS ─────────────────────────────────────────────────────────────────────────────────────────────
// A REAL relay (scripts/gateway.mjs) on a private port and data dir, a REAL nostr-tools SimplePool, and the SHIPPED
// hub, signer, readers, announceMembership and _noteAdmitted lifted out of vendor/fellowship.js by their bundle names
// (scripts/hub-race-harness.mjs). Only the publish transport is a stub, and it keeps the shipped rule (a relay that
// actually said OK). The shipped 1.3 s post-auth refetch is recorded and played by the test AFTER the refull has been
// answered (plan audit F4), so the REQ counts below do not depend on a race.
//
// Plan: TrinityOne-internal/reference/PLAN-open-church-join-full-fetch-2026-11-19.md (+ its audit's edits F1-F11).
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
import { memberApp, K, sleep, until, nowS, dOf, isFull, memStorage, HAS_REFULL } from './hub-race-harness.mjs';

const PORT = 19981, PORT_B = 19982;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const NET = 'trinityone';
const OLD = nowS() - 10 * 86400;      // ten days ago: outside the incremental window (3 days)
const open = { church: K(), abel: K(), bea: K(), nell: K(), olive: K(), url: `ws://127.0.0.1:${PORT}/relay` };      // approval OFF
const appr = { church: K(), abel: K(), bea: K(), nell: K(), url: `ws://127.0.0.1:${PORT_B}/relay` };   // approval ON (control)
const relays = [], dirs = [];

const connect = (url) => new Promise((res, rej) => { const s = new WebSocket(url); s.on('open', () => res(s)); s.on('error', rej); });
const send = (sock, evt) => new Promise((res) => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { sock.off('message', on); res([m[2], m[3] || '']); } };
  sock.on('message', on); sock.send(JSON.stringify(['EVENT', evt])); setTimeout(() => res([false, '(no reply)']), 5000);
});
const doc = (who, d, content, at, extra = []) => finalizeEvent({ kind: 30078, created_at: at, tags: [['d', d], ['t', NET], ...extra], content: JSON.stringify(content) }, who.sk);
async function anonymous(url, filters) {
  const s = await connect(url); const got = [];
  await new Promise(res => {
    s.on('message', d => { const m = JSON.parse(d); if (m[0] === 'EVENT' && m[1] === 'anon') got.push(m[2]); if (m[0] === 'EOSE' && m[1] === 'anon') res(); });
    s.send(JSON.stringify(['REQ', 'anon', ...filters])); setTimeout(res, 6000);
  });
  s.close(); return got;
}
const hubFilters = (cp) => [{ kinds: [30078], authors: [cp], '#t': [NET] }, { kinds: [30078], '#church': [cp], '#t': [NET] }];
const memFilters = (cp) => [{ kinds: [30078], '#p': [cp] }];

async function startRelay(port, cp) {
  const dataDir = mkdtempSync(join(tmpdir(), 'trin-openjoin-')); dirs.push(dataDir);
  const p = spawn(process.execPath, ['scripts/gateway.mjs', String(port)],
    { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp) }, stdio: 'ignore' });
  relays.push(p);
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${port}/status`)).ok) return; } catch {} await sleep(200); }
  throw new Error('gateway on ' + port + ' did not come up');
}
async function seed(c, approval) {
  const cp = c.church.pub;
  const ws = await connect(c.url);
  const put = async (evt, what) => { const [ok, why] = await send(ws, evt); assert.equal(ok, true, `the relay refused the fixture's ${what}: ${why}`); };
  await put(finalizeEvent({ kind: 0, created_at: OLD, tags: [['t', NET]], content: JSON.stringify({ name: approval ? 'St Approval' : 'St Open' }) }, c.church.sk), 'church profile');
  await put(doc(c.abel, 'trinityone/member:' + cp, { joined: OLD }, OLD, [['p', cp]]), 'member doc (abel)');
  await put(doc(c.bea, 'trinityone/member:' + cp, { joined: OLD }, OLD, [['p', cp]]), 'member doc (bea)');
  if (approval) await put(doc(c.church, 'trinityone/admitted:' + cp, { pubkeys: [c.abel.pub, c.bea.pub] }, OLD), 'admitted list');
  await put(doc(c.church, 'trinityone/devotional:d1', { title: 'Morning', body: 'Psalm 23' }, OLD), 'devotional');
  await put(doc(c.church, 'trinityone/plan:p1', { title: 'Mark in a month', days: [] }, OLD), 'plan');
  await put(doc(c.church, 'trinityone/minors:' + cp, { pubkeys: [c.bea.pub] }, OLD), 'minors list');
  // one RECENT public document, so the docs hub's cursor is today and an incremental `since` excludes the old corpus
  await put(doc(c.church, 'trinityone/joinpolicy:' + cp, { approval }, nowS() - 60), 'join policy');
  ws.close();
}

before(async () => {
  await requireFreePort(PORT, 'an-open-church-joiner-gets-the-older-documents.test.mjs');
  await requireFreePort(PORT_B, 'an-open-church-joiner-gets-the-older-documents.test.mjs');
  await startRelay(PORT, open.church.pub);
  await startRelay(PORT_B, appr.church.pub);
  await seed(open, false);
  await seed(appr, true);
  await sleep(300);
});
after(async () => { for (const p of relays) { try { p.kill('SIGKILL'); } catch {} } await sleep(200); for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

// ── the control: if the old corpus is not withheld from an anonymous reader, every case below is void ─────────────
test('control 0: the relay withholds the ten-day-old corpus (docs AND member docs) from an anonymous reader', async () => {
  const cp = open.church.pub;
  const ds = (await anonymous(open.url, hubFilters(cp))).map(dOf);
  assert.ok(ds.includes('trinityone/joinpolicy:' + cp), 'the public join policy should be served anonymously');
  for (const d of ['trinityone/devotional:d1', 'trinityone/plan:p1', 'trinityone/minors:' + cp]) assert.ok(!ds.includes(d), `${d} was served to an anonymous reader — the fixture is not gated, the test is void`);
  const ms = (await anonymous(open.url, memFilters(cp))).map(dOf);
  assert.ok(!ms.includes('trinityone/member:' + cp), 'member: docs are served to an anonymous reader — the members half of O1 is void');
});

// Boot a joiner, let the THIN full fetch land (the instrument check that the bug's precondition really happened),
// then join through the shipped announceMembership.
async function joinOpen(c, storage, me = c.nell) {
  const cp = c.church.pub;
  let memSinceAtReopen = null, okAt = 0;
  const app = memberApp({ me, relays: [c.url], storage, announce: true, realAdmitted: true,
    // F5: the members hub's `since` just BEFORE the refull touches that hub (S7's detector needs it > 0). Read when the
    // first docs REQ after the OK goes out: the helper reopens the docs hub first, before it touches the members hub.
    onReq: (rec) => { if (okAt && memSinceAtReopen === null && rec.filters.some(f => f.authors && f.authors[0] === cp)) memSinceAtReopen = (app.t._memHubs.get(cp) || {}).since; } });
  const seen = { devos: null, plans: null, members: null, lists: [] };
  app.api.subscribeChurchDevotionals(cp, d => { seen.devos = d; });
  app.api.subscribeChurchPlans(cp, p => { seen.plans = p; });
  app.api.subscribeChurchMembers(cp, (m) => { seen.members = m; });
  app.api.subscribeChurchSafeguard(cp, l => { seen.lists.push(l); });
  assert.ok(await until(() => app.t._relayAuthOkAt > 0, 8000), 'the relay accepted the auth');
  assert.ok(await until(() => app.docsHub(cp).fullAt > 0 && app.memHub(cp).fullAt > 0, 8000), 'the first full fetch of both hubs was answered (and stamped)');
  await sleep(300);
  const thin = { devos: (seen.devos || []).length, plans: (seen.plans || []).length, fullAt: app.docsHub(cp).fullAt, eosedAt: app.docsHub(cp).eosedAt };
  const reqsBefore = { docs: app.hubReqs(cp).length, mem: app.memReqs(cp).length };
  const ok = await app.api.announceMembership(cp);
  okAt = Date.now();
  return { app, seen, thin, ok, okAt, reqsBefore, memSince: () => memSinceAtReopen };
}

let o1 = null;
test('O1: an open-church joiner gets the ten-day-old devotional, plan and members on the FIRST session (one extra full of each hub)', async () => {
  const c = open, cp = c.church.pub;
  const r = o1 = await joinOpen(c, memStorage());
  const { app, seen } = r;
  // instrument: the bug's precondition — the first full was thin
  assert.equal(r.thin.devos, 0, 'instrument: the joiner already had the old devotional before joining — the thin first answer did not happen, so this run proves nothing');
  assert.ok(r.ok, 'announceMembership reported the join as accepted');
  // wait for the refull to be answered (or give the base its chance)
  await until(() => (seen.devos || []).length === 1 && (seen.plans || []).length === 1 && (seen.members || []).some(m => m.pubkey === c.abel.pub), 6000);
  await sleep(300);
  // F4: the shipped post-auth refetch, played AFTER the refull was answered
  app.api.refetchChurchDocs();
  await sleep(1200);   // let it settle and the 800 ms saves land
  const docsAfter = app.hubReqs(cp).filter(q => q.at >= r.okAt);
  const memAfter = app.memReqs(cp).filter(q => q.at >= r.okAt);
  assert.equal((seen.devos || []).length, 1, 'the ten-day-old devotional reached subscribeChurchDevotionals');
  assert.equal((seen.plans || []).length, 1, 'the ten-day-old plan reached subscribeChurchPlans');
  for (const who of [c.abel, c.bea]) assert.ok((seen.members || []).some(m => m.pubkey === who.pub), 'a ten-day-old member is listed');
  assert.equal(docsAfter.filter(isFull).length, 1, `exactly one full docs REQ after the OK (sent ${docsAfter.length}: ${docsAfter.map(q => isFull(q) ? 'FULL' : 'inc').join(',')})`);
  assert.equal(memAfter.filter(isFull).length, 1, `exactly one full members-30078 REQ after the OK (sent ${memAfter.length})`);
  const k1 = memAfter.map(q => q.filters.find(f => (f.kinds || []).includes(1))).filter(Boolean);
  assert.ok(k1.length, 'the members hub was reopened after the OK');
  // F5: the kind-1 assertion is only meaningful if the hub had a cursor when it was reopened
  assert.ok(r.memSince() > 0, `instrument: the members hub had no cursor (since=${r.memSince()}) when the refull began, so the kind-1 check below is void`);
  for (const f of k1) assert.ok(f.since > 0, 'the chat (kind-1) half must stay incremental after the refull — never re-pull the chat history');
  const sd = app.persisted('trinityone.docshub.' + cp), sm = app.persisted('trinityone.memhub.' + cp);
  assert.ok(sd && sd.fullAt * 1000 >= r.okAt - 1000, `persisted docs fullAt (${sd && sd.fullAt}) predates the OK`);
  assert.ok(sm && sm.fullAt * 1000 >= r.okAt - 1000, `persisted members fullAt (${sm && sm.fullAt}) predates the OK`);
  app.clean();
});

test('O4: safety — the refull never stamps eosedAt early and never widens what an ordinary member is served', async (t) => {
  assert.ok(o1, 'O1 ran');
  const { app, seen } = o1, cp = open.church.pub;
  const h = app.docsHub(cp);
  // every eosedAt written after the trigger belongs to a sub opened after the OK
  const refullReq = app.hubReqs(cp).filter(q => q.at >= o1.okAt)[0];
  assert.ok(refullReq, 'a docs REQ was sent after the OK');
  assert.ok(h.eosedAt >= refullReq.at, `docs-hub eosedAt (${h.eosedAt}) predates the REQ it should belong to (${refullReq.at})`);
  // F1: an ordinary member is never served minors: — the refull must not change that
  assert.ok(![...h.buf.values()].some(e => dOf(e) === 'trinityone/minors:' + cp), 'the joiner was served the church\'s minors: list');
  assert.deepEqual(seen.lists.at(-1).minors, [], 'subscribeChurchSafeguard reports a minors list to an ordinary member');
  t.diagnostic(`minorsKnown before the join: ${seen.lists.find(l => l) ? seen.lists[0].minorsKnown : '?'}; after: ${seen.lists.at(-1).minorsKnown} (recorded, not asserted)`);
  // the helper itself writes fullAt and dirty only — never eosed/eosedAt/fullPreAuth/refullDone/since
  assert.ok(HAS_REFULL, 'the bundle has no _refullChurchHubs');
  const snap = (x) => ({ eosed: x.eosed, eosedAt: x.eosedAt, fullPreAuth: x.fullPreAuth, refullDone: x.refullDone, since: x.since });
  const d0 = snap(h), m0 = snap(app.memHub(cp));
  app.api._refullChurchHubs(cp);
  assert.deepEqual(snap(h), d0, 'the helper changed a docs-hub field it must never touch');
  assert.deepEqual(snap(app.memHub(cp)), m0, 'the helper changed a members-hub field it must never touch');
  assert.equal(h.fullAt, 0); assert.equal(app.memHub(cp).fullAt, 0);
  await sleep(1500);
  app.clean(); app.close();
});

test('O2: a restart keeps the older documents, and a later announce (the heartbeat) does not ask for everything again', async () => {
  const c = open, cp = c.church.pub;
  // A joiner of her own: O1's joiner is already a member on this relay, so her first full would not be thin.
  const storage = memStorage();
  const first = await joinOpen(c, storage, c.olive);
  assert.equal(first.thin.devos, 0, 'instrument: the first full was not thin');
  await until(() => (first.seen.devos || []).length === 1, 5000);
  await sleep(1300);   // let the saves land
  first.app.close();
  // the restart: same storage
  const app = memberApp({ me: c.olive, relays: [c.url], storage, announce: true, realAdmitted: true });
  let devos = null, plans = null;
  app.api.subscribeChurchDevotionals(cp, d => { devos = d; });
  app.api.subscribeChurchPlans(cp, p => { plans = p; });
  app.api.subscribeChurchMembers(cp, () => {});
  assert.ok(await until(() => app.hubReqs(cp).length >= 1));
  assert.ok(!isFull(app.hubReqs(cp)[0]), 'the restart\'s first docs REQ is incremental (today\'s full is done)');
  assert.ok(await until(() => app.t._relayAuthOkAt > 0 && app.docsHub(cp).eosed, 8000));
  await sleep(300);
  assert.equal((devos || []).length, 1, 'after a restart the ten-day-old devotional is still there');
  assert.equal((plans || []).length, 1, 'after a restart the ten-day-old plan is still there');
  const before = app.reqs.length, t0 = Date.now();
  const hb = await app.api.announceMembership(cp);
  assert.ok(hb, 'the heartbeat landed');
  assert.match(hb.content, /"hb":1/, 'the second announce is a heartbeat');
  await sleep(1200);
  const after = app.reqs.slice(before).filter(q => q.at >= t0);
  assert.equal(after.filter(isFull).length, 0, 'a later announce asked for everything again — the refull must fire once per join, not every session');
  app.clean(); app.close();
});

// ── O3: the approval-ON control ──────────────────────────────────────────────────────────────────────────────────
let o3 = null;
test('O3a (control): in an approval church the steward\'s admission still brings the ten-day-old devotional and plan', async () => {
  const c = appr, cp = c.church.pub;
  const r = o3 = await joinOpen(c, memStorage());
  const { app, seen } = r;
  assert.ok(r.ok, 'the pending join was accepted');
  await sleep(1500);   // whatever the join triggers settles
  assert.equal((seen.devos || []).length, 0, 'instrument: a PENDING member was served the gated devotional');
  // the steward admits them: a fresh admitted: list, which reaches the open docs hub live and runs the real _noteAdmitted
  const ws = await connect(c.url);
  const [ok, why] = await send(ws, doc(c.church, 'trinityone/admitted:' + cp, { pubkeys: [c.abel.pub, c.bea.pub, c.nell.pub] }, nowS()));
  ws.close();
  assert.equal(ok, true, 'the relay refused the admission: ' + why);
  await until(() => (seen.devos || []).length === 1 && (seen.plans || []).length === 1, 8000);
  assert.equal((seen.devos || []).length, 1, 'after admission the ten-day-old devotional arrived');
  assert.equal((seen.plans || []).length, 1, 'after admission the ten-day-old plan arrived');
});

test('O3b: in an approval church the admission also brings members who joined more than three days ago', async () => {
  assert.ok(o3, 'O3a ran');
  const { app, seen } = o3, c = appr;
  await until(() => (seen.members || []).some(m => m.pubkey === c.abel.pub), 4000);
  for (const who of [c.abel, c.bea]) assert.ok((seen.members || []).some(m => m.pubkey === who.pub), 'a ten-day-old member is listed after admission');
  await sleep(300);
  app.clean(); app.close();
});
