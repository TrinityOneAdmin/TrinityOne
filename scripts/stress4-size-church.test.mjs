// STRESS BATCH 4 / A. SIZE: a church with six months of history on a shared server S, then a fresh own box T.
// Corpus: scripts/stress4-corpus.mjs (300 members, 50 groups, 30k group messages, 5k DMs, 400 care requests,
// created_at spread over 180 days, all really signed). S is PRE-SEEDED on disk (store.importAll) and started, so its
// startup (hydrateMaps + reattribute + relabel) is measured on the full corpus. Every number is printed as
// "MEASURE ..." so a run can be read off the log.  Run: node --test scripts/stress4-size-church.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openStore } from './event-store.mjs';
import { finalizeEvent } from 'nostr-tools/pure';
import * as H from './relay-network-harness.mjs';
import { loadOrBuild } from './stress4-corpus.mjs';

const M = (...a) => console.log('MEASURE', ...a);
const C = loadOrBuild();
const church = { pub: C.church.pub, sk: Uint8Array.from(Buffer.from(C.church.sk, 'hex')) };
const TOTAL = C.events.length;
const ENV = { RELAY_MAX_EVENTS: '200000', RELAY_SYNC_TRACE: '1' };   // TRACE: each box logs every /sync it serves (since, lines sent) — A3 counts them   // the gateway default; the harness would otherwise set 5000
const rows = (relay, where = '1=1', args = []) => { const db = new DatabaseSync(join(relay.dataDir, 'relay.sqlite'), { readOnly: true }); try { return db.prepare('SELECT COUNT(*) n FROM events WHERE ' + where).get(...args).n; } finally { db.close(); } };
const byChurch = (relay) => { const db = new DatabaseSync(join(relay.dataDir, 'relay.sqlite'), { readOnly: true }); try { return Object.fromEntries(db.prepare('SELECT church c, COUNT(*) n FROM events GROUP BY church').all().map(r => [r.c.slice(0, 8) || '(none)', r.n])); } finally { db.close(); } };
const oldest = (relay, kind) => { const db = new DatabaseSync(join(relay.dataDir, 'relay.sqlite'), { readOnly: true }); try { return db.prepare('SELECT MIN(created_at) t FROM events WHERE kind = ?').get(kind).t; } finally { db.close(); } };
const timed = async (f) => { const t0 = Date.now(); const v = await f(); return [v, Date.now() - t0]; };
const seedDir = () => { const d = mkdtempSync(join(tmpdir(), 'trin-net-S-')); const st = openStore(join(d, 'relay.sqlite'), { maxEvents: 200000 }); const n = st.importAll(C.events); st.close(); return [d, n]; };
const publishList = async (relays, at) => { const doc = H.relaysDoc(church, relays, at); for (const r of relays) await H.publishAll(r, [doc]); };

let S, T;
let stamp = H.now();
const freshMs = 0;   // only quoted in a MEASURE line; A3 no longer depends on A1
const at = () => ++stamp;
after(() => { H.stopAll(); setTimeout(() => process.exit(process.exitCode || 0), 2000).unref(); });

before(async () => {
  const [dir, n] = seedDir();
  assert.equal(n, TOTAL, 'CONTROL: every corpus event went into the seeded store');
  const [s, ms] = await timed(() => H.startRelay({ name: 'S', churches: [church.pub], dataDir: dir, env: ENV }));
  S = s; M('S first start on a seeded', TOTAL, 'event store (hydrateMaps + reattribute + relabel), spawn->/status:', ms, 'ms');
  M('S rows by church after start:', JSON.stringify(byChurch(S)), 'log:', S.log.filter(l => /attributed|relabelled|migrated/.test(l)).join(' | '));
  T = await H.startRelay({ name: 'T', churches: [church.pub], env: ENV });
  await publishList([S, T], at());
});

test('A0 control: S holds the whole corpus under the church, T holds only the relay list', async () => {
  const ids = await H.corpusIds(S, church);
  assert.ok(ids.size >= TOTAL, `S serves ${ids.size} of ${TOTAL}`);   // + the relay list
  assert.ok((await H.corpusIds(T, church)).size <= 2, 'T is not empty at the start');
});

test('A1 first sync: wall time, passes, imported per pass, S responsiveness during the pull', async () => {
  const lat = []; let stop = false;
  const probe = (async () => { while (!stop) { const t0 = Date.now(); try { await fetch(S.base + '/status'); lat.push(Date.now() - t0); } catch { lat.push(-1); } await H.sleep(250); } })();
  const passes = []; const t0 = Date.now();
  for (let i = 0; i < 6; i++) {
    const [r, ms] = await timed(() => H.syncNow(T));
    passes.push({ imported: r.imported, ms, rowsOnT: rows(T) });
    if (rows(T, 'church = ?', [church.pub]) >= TOTAL) break;
  }
  stop = true; await probe;
  M('A1 fresh sync wall', Date.now() - t0, 'ms');
  M('A1 passes:', JSON.stringify(passes), 'total wall', Date.now() - t0, 'ms; S /status latency during the pull: max', Math.max(...lat), 'ms, p50', lat.sort((a, b) => a - b)[lat.length >> 1], 'ms, samples', lat.length);
  const d = await H.corpusDiff(S, T, church);
  assert.deepEqual([d.onlyOnA.length, d.onlyOnB.length], [0, 0], 'T and S hold different sets after the first sync');
  assert.equal(passes.filter(p => p.imported > 0).length, 1, 'the first sync needed more than one pass: ' + JSON.stringify(passes));
});

test('A2 retention at the default budget: a six-month church loses nothing on S or T', async () => {
  const sN = rows(S, 'church = ?', [church.pub]), tN = rows(T, 'church = ?', [church.pub]);
  M('A2 default budget: S church rows', sN, 'T church rows', tN, 'oldest message S/T', oldest(S, 1), oldest(T, 1), 'oldest DM S/T', oldest(S, 4), oldest(T, 4));
  assert.equal(sN, tN, 'S and T disagree about how much history the church has');
  assert.ok(tN >= TOTAL, 'old messages were culled at the default budget');
});

test('A3 SIGKILL T halfway through its first sync, restart on the same dataDir, converge with no gaps', async () => {
  const T2 = await H.startRelay({ name: 'T2', churches: [church.pub], env: ENV });
  await publishList([S, T, T2], at());
  const t0 = Date.now();
  const p = H.syncNow(T2).catch(() => null);
  await H.waitFor(() => rows(T2, 'church = ?', [church.pub]) >= TOTAL * 0.4, { timeout: 120000, every: 100, label: 'T2 40% in' });
  const atKill = rows(T2, 'church = ?', [church.pub]); const killMs = Date.now() - t0;
  T2.proc.kill('SIGKILL'); await new Promise(r => T2.proc.once('exit', r)); await p;
  const cur = join(T2.dataDir, 'sync-cursors.json');
  M('A3 killed T2 at', atKill, 'of', TOTAL, 'rows after', killMs, 'ms; cursor file on disk after kill:', existsSync(cur) ? readFileSync(cur, 'utf8').slice(0, 200) : '(none)');
  const [T2b, startMs] = await timed(() => H.moveRelay(T2));
  M('A3 restart of T2 on the same dataDir: spawn->/status', startMs, 'ms; rows on disk at restart', rows(T2b, 'church = ?', [church.pub]));
  await publishList([S, T, T2b], at());
  const passes = [];
  const onDiskAtRestart = rows(T2b, 'church = ?', [church.pub]);
  assert.ok(existsSync(cur), 'no cursor file survived the SIGKILL: the restart can only start from zero');
  // COUNT-BASED proof of resume (wall time is only a MEASURE line: it depends on what else the box is doing).
  //  - the cursor saved before the kill is > 0 and no newer than the newest corpus row actually stored;
  //  - the restart's FIRST /sync to each peer that had a cursor starts at (cursor - overlap), not at 0;
  //  - the lines each such peer streams to the restarted box are <= the corpus events at or after that point (+ a few).
  const OVERLAP = 600, MARGIN = 10;
  const saved = JSON.parse(readFileSync(cur, 'utf8'));
  const stored = new Set(); { const db = new DatabaseSync(join(T2b.dataDir, 'relay.sqlite'), { readOnly: true }); try { for (const r of db.prepare('SELECT id FROM events WHERE church = ?').all(church.pub)) stored.add(r.id); } finally { db.close(); } }
  const newestStored = Math.max(...C.events.filter(e => stored.has(e.id)).map(e => e.created_at));
  const traces = (relay) => relay.log.filter(l => l.includes('[sync-trace]') && l.includes('church=' + church.pub.slice(0, 8))).map(l => ({ since: +/since=(\d+)/.exec(l)[1], sent: +/sent=(\d+)/.exec(l)[1] }));
  const before = new Map([[S, traces(S).length], [T, traces(T).length]]);
  const cursorOf = (relay) => saved[church.pub + '@' + relay.base] || 0;
  const withCursor = [S, T].filter(r => cursorOf(r) > 0);
  assert.ok(withCursor.length >= 1, 'no peer has a saved cursor: ' + JSON.stringify(saved));
  for (const r of withCursor) assert.ok(cursorOf(r) <= newestStored, `${r.name}: cursor ${cursorOf(r)} is newer than the newest stored corpus row ${newestStored}`);
  M('A3 cursor file at the kill:', JSON.stringify(saved), 'newest stored corpus row', newestStored, 'rows on disk', onDiskAtRestart);
  for (let i = 0; i < 6; i++) {
    const [r, ms] = await timed(() => H.syncNow(T2b));
    passes.push({ imported: r.imported, ms, rows: rows(T2b, 'church = ?', [church.pub]) });
    if (rows(T2b, 'church = ?', [church.pub]) >= TOTAL) break;
  }
  M('A3 passes after restart:', JSON.stringify(passes), 'cursor file now:', existsSync(cur) ? readFileSync(cur, 'utf8').slice(0, 200) : '(none)', '(fresh sync was', freshMs || 'n/a', 'ms)');
  for (const r of withCursor) {
    const after = traces(r).slice(before.get(r)), c = cursorOf(r);
    assert.ok(after.length >= 1, `${r.name} never served the restarted box`);
    const wantSince = Math.max(0, c - OVERLAP);
    assert.ok(after[0].since >= wantSince, `${r.name}: the restart's first /sync began at since=${after[0].since}, before the saved cursor ${c} less the overlap (${wantSince}): it restarted from the past`);
    const streamed = after.reduce((n, t) => n + t.sent, 0), allowed = C.events.filter(e => e.created_at >= wantSince).length + MARGIN;
    M('A3', r.name, 'first since', after[0].since, 'cursor', c, 'lines streamed to the restarted box', streamed, 'allowed', allowed, 'of', TOTAL);
    assert.ok(streamed <= allowed, `${r.name} streamed ${streamed} lines after the restart, more than the ${allowed} at/after the saved cursor: not a resume`);
  }
  assert.ok(passes[0].imported <= TOTAL - onDiskAtRestart + 5, `restart pass imported ${passes[0].imported}, more than the ${TOTAL - onDiskAtRestart} missing`);
  const d = await H.corpusDiff(S, T2b, church);
  assert.deepEqual([d.onlyOnA.filter(i => true).length > 1 ? d.onlyOnA.length : 0, d.onlyOnB.length], [0, 0], 'gaps or extras after the restart');
  assert.equal(rows(T2b, 'id IN (SELECT id FROM events GROUP BY id HAVING COUNT(*) > 1)'), 0);
});

test('A4 startup cost with the corpus: S restart and T restart (second start, nothing left to attribute)', async () => {
  const [S2, sMs] = await timed(() => H.moveRelay(S));
  M('A4 S restart (hydrateMaps + reattribute + relabel over', TOTAL, 'rows): spawn->/status', sMs, 'ms; log:', S2.log.filter(l => /attributed|relabelled/.test(l)).join(' | ') || '(nothing to attribute/relabel)');
  const [T2, tMs] = await timed(() => H.moveRelay(T));
  M('A4 T restart: spawn->/status', tMs, 'ms');
  S = S2; T = T2;
  assert.ok(sMs < 60000 && tMs < 60000, 'startup took over a minute');
});

// A5. The member app's first open, wire level. The two group-chat filters are the shipped bundle's own (asserted to be
// present in vendor/fellowship.js below, then used verbatim): subscribeGroups {kinds:[1],'#t':[ids],limit:500} and
// subscribeGroup {kinds:[1,5],'#t':[gid],limit:200}. Each REQ is timed to its EOSE as an authenticated member and
// compared with the true newest-N from the corpus. (The shipped app additionally decrypts and drops events with no ['p',church]
// tag, which this synthetic corpus does not carry, so what is measured is what the RELAY hands the phone, not what is painted.)
test('A5 first open of a 6-month church: the bundle\'s group REQs finish, and return the newest history', async () => {
  const src = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
  assert.ok(src.includes("kinds: [1], \"#t\": groupIds, limit: 500") || /kinds: \[1\], ['"]#t['"]: groupIds, limit: 500/.test(src), 'the bundle no longer sends the all-groups REQ this test copies');
  assert.ok(/kinds: \[1, 5\], ['"]#t['"]: \[groupId\], limit: 200/.test(src), 'the bundle no longer sends the per-group REQ this test copies');
  const me = { sk: Uint8Array.from(Buffer.from(C.members[0].sk, 'hex')), pub: C.members[0].pub };
  const gids = Array.from({ length: 50 }, (_, i) => 'grp' + i);
  const msgs = C.events.filter(e => e.kind === 1).sort((a, b) => b.created_at - a.created_at);
  const req = (relay, filter) => new Promise(async (res) => {
    const w = await H.connect(relay); const t0 = Date.now(); const got = [];
    const done = (why) => { try { w.close(); } catch {} res({ ms: Date.now() - t0, n: got.length, why, ids: got.map(e => e.id) }); };
    const to = setTimeout(() => done('TIMEOUT 20s'), 20000);
    w.on('message', (d) => { const m = JSON.parse(d); if (m[0] === 'EVENT') got.push(m[2]); else if (m[0] === 'EOSE') { clearTimeout(to); done('EOSE'); } else if (m[0] === 'AUTH') w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: H.now(), tags: [['relay', relay.wsUrl], ['challenge', m[1]]], content: '' }, me.sk)])); });
    w.send(JSON.stringify(['REQ', 'a5', filter]));
  });
  const all = await req(S, { kinds: [1], '#t': gids, limit: 500 });
  const want = new Set(msgs.slice(0, 500).map(e => e.id));
  const wrong = all.ids.filter(i => !want.has(i)).length;
  M('A5 all-groups REQ: ', all.why, all.ms, 'ms,', all.n, 'events; of the true newest 500, returned', all.ids.filter(i => want.has(i)).length, '; not-in-newest-500:', wrong);
  const per = []; const t0 = Date.now(); let short = 0, slow = 0, timeouts = 0;
  for (const g of gids) {
    const r = await req(S, { kinds: [1, 5], '#t': [g], limit: 200 });
    const truth = msgs.filter(e => e.tags.some(t => t[1] === g)).slice(0, 200);
    const have = new Set(r.ids); const missing = truth.filter(e => !have.has(e.id)).length;
    per.push(r.ms); if (missing) short++; if (r.ms > 2000) slow++; if (r.why !== 'EOSE') timeouts++;
  }
  per.sort((a, b) => a - b);
  M('A5 50 per-group REQs sequential total', Date.now() - t0, 'ms; p50', per[25], 'max', per[49], 'ms; REQs slower than 2 s:', slow, '; REQs that did not reach EOSE:', timeouts, '; REQs missing some of their true newest 200:', short);
  assert.equal(all.why, 'EOSE', 'the all-groups REQ never finished');
  assert.equal(wrong, 0, 'the all-groups REQ returned events that are not the newest');
  assert.equal(short, 0, 'some group REQs did not return that group\'s newest messages');
});
