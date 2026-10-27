// G4: a relay-to-relay /sync pull (1) RESUMES after a kill instead of restarting from zero, and (2) PAGES, so an answer
// bigger than MAX_IMPORT still completes. Small purpose-built corpus; every claim is made against REAL gateways.
//   corpus: N signed care requests spaced 1000 s apart, except TIES of them that share ONE created_at (so a page
//   boundary, and a mid-pass cursor save, both land inside a run of equal timestamps).
// Run: flock /tmp/claude-1000/selfhost-tests.lock node --test scripts/relay-sync-resumes-and-pages.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { openStore } from './event-store.mjs';
import { finalizeEvent } from 'nostr-tools/pure';
import * as H from './relay-network-harness.mjs';

const N = 4000, TIE_FROM = 1500, TIES = 700;
const church = H.key();
const members = [H.key(), H.key(), H.key()];
const base = H.now() - N * 1000 - 100000;
const TIE_TS = base + TIE_FROM * 1000;
const events = Array.from({ length: N }, (_, i) => {
  const m = members[i % 3];
  const at = (i >= TIE_FROM && i < TIE_FROM + TIES) ? TIE_TS : base + i * 1000;
  return finalizeEvent({ kind: 30078, created_at: at, tags: [['d', 'trinityone/carereq:' + m.pub.slice(0, 16) + '-' + i], ['t', 'trinityone'], ['church', church.pub]], content: 'sealed?iv=BBBB' + 'y'.repeat(200) + i }, m.sk);
});
const ENV = { RELAY_MAX_EVENTS: '200000' };
const dbOf = (relay) => new DatabaseSync(join(relay.dataDir, 'relay.sqlite'), { readOnly: true });
const rowsIds = (relay) => { const db = dbOf(relay); try { return new Set(db.prepare('SELECT id FROM events WHERE church = ?').all(church.pub).map(r => r.id)); } finally { db.close(); } };
const seed = () => { const d = mkdtempSync(join(tmpdir(), 'trin-net-S-')); const st = openStore(join(d, 'relay.sqlite'), { maxEvents: 200000 }); st.importAll(events); st.close(); return d; };
const publishList = async (relays, at) => { const doc = H.relaysDoc(church, relays, at); for (const r of relays) await H.publishAll(r, [doc]); };
let stamp = H.now(); const at = () => ++stamp;
const BYTES = events.reduce((n, e) => n + JSON.stringify(e).length + 1, 0);
const cursorsOf = (relay) => { try { return JSON.parse(readFileSync(join(relay.dataDir, 'sync-cursors.json'), 'utf8')); } catch { return null; } };
const cursorTs = (relay) => { const c = cursorsOf(relay); return c ? Math.max(0, ...Object.values(c)) : 0; };

// the OLD build = this branch's base commit, every local import extracted (harness extractOldBuild copies only three)
const OLD_REV = 'c8e0d5d7';
function extractFullOld(rev) {
  const dir = mkdtempSync(join(H.ROOT, '.oldbuild-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  const seen = new Set(), todo = ['gateway.mjs'];
  while (todo.length) {
    const f = todo.pop(); if (seen.has(f)) continue; seen.add(f);
    const txt = execFileSync('git', ['-C', H.GIT_ROOT, 'show', `${rev}:scripts/${f}`], { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });
    writeFileSync(join(dir, 'scripts', f), txt);
    for (const m of txt.matchAll(/from\s+'\.\/([A-Za-z0-9._-]+\.mjs)'/g)) todo.push(m[1]);
    for (const m of txt.matchAll(/import\(\s*'\.\/([A-Za-z0-9._-]+\.mjs)'/g)) todo.push(m[1]);
  }
  return join(dir, 'scripts', 'gateway.mjs');
}
let oldEntry;
after(() => { H.stopAll(); setTimeout(() => process.exit(process.exitCode || 0), 1500).unref(); });
const start = (name, extra = {}) => H.startRelay({ name, churches: [church.pub], env: { ...ENV, ...(extra.env || {}) }, ...(extra.entry ? { entry: extra.entry } : {}), ...(extra.dataDir ? { dataDir: extra.dataDir } : {}) });
const sync = async (relay, max = 12) => { const passes = []; for (let i = 0; i < max; i++) { const t0 = Date.now(); const r = await H.syncNow(relay); passes.push({ imported: r.imported, ms: Date.now() - t0 }); if (rowsIds(relay).size >= N) break; } return passes; };
const proofGet = (relay, qs) => { const url = `${relay.base}/sync?church=${church.pub}${qs}`; return fetch(url, { headers: { Authorization: H.nip98(church.sk, url, 'GET', church.pub) } }); };

test('CONTROL: the corpus is bigger than the caps used below, and has a tie run', () => {
  assert.ok(BYTES > 2_500_000, 'corpus is ' + BYTES + ' bytes');
  assert.equal(new Set(events.map(e => e.created_at)).size, N - TIES + 1);
});

test('server: ?limit pages the church oldest-first, (created_at,id) ordered, across a tie run, no gap or repeat; no limit = whole body, no paging header', async () => {
  const S = await start('S', { dataDir: seed() });
  const want = new Set((await H.corpus(S, church)).map(e => e.id));
  assert.ok(want.size >= N);
  const seen = []; let after = '', pages = 0, last = null;
  for (;;) {
    const r = await proofGet(S, '&since=0&limit=128' + (after ? '&after=' + after : ''));
    assert.equal(r.status, 200); assert.equal(r.headers.get('x-sync-limit'), '128');
    const evs = (await r.text()).split('\n').filter(Boolean).map(l => JSON.parse(l));
    assert.ok(evs.length <= 128);
    for (const e of evs) { if (last) assert.ok(e.created_at > last.created_at || (e.created_at === last.created_at && e.id > last.id), 'order'); last = e; seen.push(e.id); }
    pages++; after = r.headers.get('x-sync-next') || ''; if (!after) break;
  }
  assert.equal(seen.length, want.size); assert.deepEqual(new Set(seen), want);
  assert.ok(pages >= Math.ceil(want.size / 128));
  const plain = await proofGet(S, '&since=0');
  assert.equal(plain.headers.get('x-sync-limit'), null, 'an un-asked-for default limit would truncate for old clients');
  assert.equal((await plain.text()).split('\n').filter(Boolean).length, want.size);
  S.stop();
});

test('PAGED pull: a corpus several times RELAY_MAX_IMPORT syncs fully in ONE pass', async () => {
  const S = await start('S', { dataDir: seed() }); const T = await start('T', { env: { RELAY_MAX_IMPORT: '300000', RELAY_SYNC_PAGE: '300' } });
  await publishList([S, T], at());
  const passes = await sync(T);
  // the negentropy reconcile can fill a gap the /sync pull left, so row counts alone cannot show the PULL finished:
  // the pull's own cursor must have reached the newest event (a capped, unpaged pull stalls short of it: see MIXED).
  assert.ok(cursorTs(T) >= Math.max(...events.map(e => e.created_at)), 'the /sync pull itself did not reach the end: cursor ' + cursorTs(T));
  assert.equal(rowsIds(T).size, rowsIds(S).size, JSON.stringify(passes));
  assert.equal(passes.filter(p => p.imported > 0).length, 1, JSON.stringify(passes));
  const d = await H.corpusDiff(S, T, church); assert.deepEqual([d.onlyOnA.length, d.onlyOnB.length], [0, 0]);
  S.stop(); T.stop();
});

test('RESUME: SIGKILL right after a cursor save (and again inside the tie run), restart: no gap, and the restart pulls only the remainder', async () => {
  const S = await start('S', { dataDir: seed() });
  let T = await start('T', { env: { RELAY_SYNC_SAVE_EVERY: '100', RELAY_SYNC_PAGE: '250' } });
  await publishList([S, T], at());
  const kill = async (relay, cond, label) => {
    const p = H.syncNow(relay).catch(() => null);
    await H.waitFor(cond, { timeout: 60000, every: 3, label });
    relay.proc.kill('SIGKILL'); await new Promise(r => relay.proc.once('exit', r)); await p;
  };
  // kill 1: as soon as the first cursor file exists
  await kill(T, () => existsSync(join(T.dataDir, 'sync-cursors.json')), 'first cursor save');
  let have = rowsIds(T); const c1 = cursorTs(T);
  assert.ok(have.size > 0 && have.size < N, 'killed after ' + have.size + ' rows: the sync was not interrupted');
  const missingBefore = events.filter(e => e.created_at < c1 && !have.has(e.id));
  assert.equal(missingBefore.length, 0, 'the saved cursor ' + c1 + ' is AHEAD of stored rows: ' + missingBefore.length + ' older events absent');
  // POWER-CUT view: only the main database file, as if the un-synced WAL tail never reached the disk. A cursor must never
  // be ahead of THAT (store.flushDurable() before each cursor write is what guarantees it).
  const mainOnly = (relay) => { const d = mkdtempSync(join(tmpdir(), 'trin-pc-')); copyFileSync(join(relay.dataDir, 'relay.sqlite'), join(d, 'relay.sqlite')); const db = new DatabaseSync(join(d, 'relay.sqlite'), { readOnly: true }); try { return new Set(db.prepare('SELECT id FROM events WHERE church = ?').all(church.pub).map(r => r.id)); } finally { db.close(); } };
  { const m = mainOnly(T); assert.equal(events.filter(e => e.created_at < c1 && !m.has(e.id)).length, 0, 'power-cut view: cursor ' + c1 + ' is ahead of the rows that reached the main db file'); }
  T = await H.moveRelay(T);
  // kill 2: the cursor has reached the tie run, so the kill lands with the tied events only partly stored
  await kill(T, () => cursorTs(T) >= TIE_TS, 'cursor inside the tie run');
  have = rowsIds(T); const c2 = cursorTs(T);
  assert.ok(have.size < N, 'sync had finished before the second kill');
  assert.equal(events.filter(e => e.created_at < c2 && !have.has(e.id)).length, 0, 'cursor ahead of stored rows (tie run)');
  { const m = mainOnly(T); assert.equal(events.filter(e => e.created_at < c2 && !m.has(e.id)).length, 0, 'power-cut view (tie run): cursor ahead of the main db file'); }
  const onDisk = have.size; T = await H.moveRelay(T);
  const passes = await sync(T);
  const d = await H.corpusDiff(S, T, church); assert.deepEqual([d.onlyOnA.length, d.onlyOnB.length], [0, 0], 'gap after resume');
  const first = passes[0].imported;
  assert.ok(first <= (rowsIds(S).size - onDisk) + 5, `restart imported ${first}, more than the ${rowsIds(S).size - onDisk} missing`);
  const db = dbOf(T); try { assert.equal(db.prepare('SELECT COUNT(*) n FROM events WHERE id IN (SELECT id FROM events GROUP BY id HAVING COUNT(*) > 1)').get().n, 0); } finally { db.close(); }
  S.stop(); T.stop();
});

test('store: checkpoint() and flushDurable() really checkpoint the WAL (checkpoint() used to call a method DatabaseSync lacks)', () => {
  const d = mkdtempSync(join(tmpdir(), 'trin-fd-')); const st = openStore(join(d, 'relay.sqlite'), { maxEvents: 1000 });
  st.importAll(events.slice(0, 50));
  const wal = join(d, 'relay.sqlite-wal');
  assert.ok(existsSync(wal) && statSync(wal).size > 0, 'control: rows are sitting in the WAL');
  assert.equal(st.checkpoint(), true, 'checkpoint() must report success');
  assert.equal(statSync(wal).size, 0, 'checkpoint() must fold the WAL into the main file (TRUNCATE)');
  st.importAll(events.slice(50, 100));
  const r = st.flushDurable(); assert.ok(r && r.log > 0 && r.checkpointed === r.log, JSON.stringify(r));
  assert.equal(st.exportChurchPage(church.pub, 0, '', 10).length, 10);
  st.close();
});

test('MIXED: NEW client, OLD server (limit ignored): still converges; with a cap smaller than the answer it makes progress per pass (cursor kept on failure) and finishes', async () => {
  oldEntry = extractFullOld(OLD_REV);
  assert.ok(H.gatewayDiffersFrom(OLD_REV), 'OLD is the working tree: vacuous');
  const S = await H.startRelay({ name: 'oldS', churches: [church.pub], entry: oldEntry, env: ENV, dataDir: seed() });
  const T = await start('T', { env: { RELAY_MAX_IMPORT: '1000000', RELAY_SYNC_SAVE_EVERY: '200' } });
  await publishList([S, T], at());
  const plain = await proofGet(S, '&since=0&limit=100'); assert.equal(plain.headers.get('x-sync-limit'), null, 'the old server must not honour limit');
  const lastTs = Math.max(...events.map(e => e.created_at));
  const r1 = await H.syncNow(T);
  // the cap WAS hit (the cursor stops short of the newest event) yet the pass kept what it had read (a cursor exists).
  // Before this change a failed pass wrote no cursor at all. The rest of the corpus arrives in the SAME pass through
  // the separate negentropy reconcile, which is why a capped /sync was never visible as a stuck sync.
  const c = cursorTs(T);
  assert.ok(c > 0 && c < lastTs - 100000, 'cursor after the capped pass: ' + c + ' (newest event ' + lastTs + ')');
  const passes = [r1, ...await sync(T, 20)];
  const d = await H.corpusDiff(S, T, church); assert.deepEqual([d.onlyOnA.length, d.onlyOnB.length], [0, 0], JSON.stringify(passes));
  S.stop(); T.stop();
});

test('MIXED: OLD client, NEW server (no limit sent): converges as before', async () => {
  const S = await start('S', { dataDir: seed() });
  const T = await H.startRelay({ name: 'oldT', churches: [church.pub], entry: oldEntry, env: ENV });
  await publishList([S, T], at());
  const passes = await sync(T);
  const d = await H.corpusDiff(S, T, church); assert.deepEqual([d.onlyOnA.length, d.onlyOnB.length], [0, 0], JSON.stringify(passes));
  S.stop(); T.stop();
});

test('a FUTURE-dated event on the peer does not drag the cursor ahead: an honest event published afterwards is still pulled', async () => {
  const S = await start('S', { dataDir: seed() }); const T = await start('T');
  await publishList([S, T], at());
  const m = members[0], nowS = H.now();
  const mk = (i, ts) => finalizeEvent({ kind: 30078, created_at: ts, tags: [['d', 'trinityone/carereq:' + m.pub.slice(0, 16) + '-' + i], ['t', 'trinityone'], ['church', church.pub]], content: 'sealed?iv=BBBB' + 'z'.repeat(50) + i }, m.sk);
  const rawInsert = (relay, e) => { const db = new DatabaseSync(join(relay.dataDir, 'relay.sqlite')); try { db.exec('PRAGMA busy_timeout=5000'); db.prepare('INSERT INTO events (id,pubkey,kind,created_at,dtag,church,repl,structured,raw) VALUES (?,?,?,?,?,?,?,?,?)').run(e.id, e.pubkey, e.kind, e.created_at, e.tags[0][1], church.pub, null, 0, JSON.stringify(e)); } finally { db.close(); } };
  const future = mk(90001, nowS + 3600), honest = mk(90002, nowS - 60);
  rawInsert(S, future);                        // S holds an event dated an hour ahead (S itself would refuse it over the wire; a hostile peer would not)
  await sync(T, 3);
  assert.ok(!rowsIds(T).has(future.id), 'T stored the future-dated event');
  const c1 = cursorTs(T);
  assert.ok(c1 > 0 && c1 < nowS, 'cursor after pass 1 is ' + c1 + ' (now ' + nowS + '): the future event moved it');
  rawInsert(S, honest);                        // an ordinary event arrives on S afterwards
  await H.syncNow(T);
  assert.ok(rowsIds(T).has(honest.id), 'the honest event was skipped: the cursor had been dragged past it');
  S.stop(); T.stop();
});
