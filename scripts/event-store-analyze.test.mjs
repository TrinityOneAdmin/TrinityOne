// The event store must give SQLite the statistics it needs to use its own indexes.
// Run: node --test scripts/event-store-analyze.test.mjs
//
// AUDIT-2026-07-30 P1. `openStore()` creates seven indexes, including `idx_dtag` — and SQLite never used it.
// With no statistics for the schema, the planner falls back to a heuristic and always picks
// `idx_kind_created`, because that index alone satisfies `ORDER BY created_at DESC` without a sort. So every
// `#d` lookup — the single most common read in the product, one per church document per feature — scanned the
// WHOLE kind-30078 partition.
//
// Measured on the real store before this fix:
//
//     PLAN:  SEARCH events USING INDEX idx_kind_created (kind=?)
//     one-document #d lookup, by corpus size:
//        10k rows   7.2 ms
//        50k rows  42.9 ms
//       100k rows  80.7 ms
//       200k rows 165.1 ms
//       400k rows 331.1 ms      ← linear, ~0.83 us/row
//
//     after ANALYZE (33 ms, one-off):
//     PLAN:  SEARCH events USING INDEX idx_dtag (dtag=?)
//       60k rows   0.16 ms      ← 65x
//
// This also removes the same scan from accept()'s per-member-document check (gateway.mjs), which runs on every
// one of the seven documents MyData syncs.
//
// The assertion is the PLAN, deliberately, not a timing. A timing assertion on a shared CI box is flaky, and
// "which index did the planner choose" is the actual invariant — a fast query with the wrong plan is a query
// that will be slow on a real congregation's relay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from './event-store.mjs';

// The exact SQL query() builds for `{kinds:[30078], '#d':[…], limit:n}` — the church-document read path.
const DOC_QUERY = 'SELECT raw FROM events WHERE kind IN (?) AND dtag IN (?) ORDER BY created_at DESC LIMIT ?';

function seeded(n = 5000) {
  const dir = mkdtempSync(join(tmpdir(), 'trin-analyze-'));
  const s = openStore(join(dir, 'ev.sqlite'), { maxEvents: 500000 });
  for (let i = 0; i < n; i++) {
    s.put({ id: 'i' + i, pubkey: 'p' + (i % 50), kind: 30078, created_at: 1700000000 + i,
      tags: [['d', 'trinityone/group:' + (i % 200)]], content: '{}', sig: 'x' });
  }
  return { s, dir, cleanup: () => { try { s.close(); } catch {} try { rmSync(dir, { recursive: true, force: true }); } catch {} } };
}
const planFor = (s) => s.db.prepare('EXPLAIN QUERY PLAN ' + DOC_QUERY)
  .all(30078, 'trinityone/group:7', 100).map(r => r.detail).join(' | ');

test('a document lookup uses the dtag index, not a scan of every event of that kind', () => {
  const { s, cleanup } = seeded();
  try {
    const plan = planFor(s);
    assert.match(plan, /idx_dtag/,
      'the planner is not using idx_dtag. Plan was:\n      ' + plan + '\n' +
      '    That index exists and is being ignored, so every church-document read scans the whole kind-30078\n' +
      '    partition — linear in corpus size (331ms at 400k rows). openStore() must ANALYZE so SQLite has the\n' +
      '    statistics to choose it.');
    assert.doesNotMatch(plan, /idx_kind_created/,
      'the planner still falls back to idx_kind_created for a d-tag lookup');
  } finally { cleanup(); }
});

test('the statistics actually exist — ANALYZE ran, rather than the plan flipping by luck', () => {
  const { s, cleanup } = seeded(500);
  try {
    const stat = s.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_stat1'").all();
    assert.equal(stat.length, 1, 'sqlite_stat1 does not exist, so ANALYZE never ran');
    const rows = s.db.prepare('SELECT tbl, idx FROM sqlite_stat1').all();
    assert.ok(rows.length > 0, 'sqlite_stat1 is empty — ANALYZE ran against no rows, or not at all');
    assert.ok(rows.some(r => r.idx === 'idx_dtag'), 'no statistics were gathered for idx_dtag specifically');
  } finally { cleanup(); }
});

// Each of the two ANALYZE call sites is pinned by a test ONLY IT can fail. Removing the open-time call broke
// nothing at first — every test above seeds a fresh store, which exercises the fill-up path instead — and
// untestable redundancy is how a rule gets deleted later as dead code.
test('a RESTART analyses what is already on disk, before any new writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-analyze-restart-'));
  const file = join(dir, 'ev.sqlite');
  try {
    // first run: fill it, then drop the statistics so only the NEXT open can restore them
    const a = openStore(file, { maxEvents: 500000 });
    for (let i = 0; i < 5000; i++) {
      a.put({ id: 'i' + i, pubkey: 'p' + (i % 50), kind: 30078, created_at: 1700000000 + i,
        tags: [['d', 'trinityone/group:' + (i % 200)]], content: '{}', sig: 'x' });
    }
    a.db.exec('DROP TABLE IF EXISTS sqlite_stat1');
    a.close();

    // Check the precondition on a RAW connection, not the one that dropped the table: SQLite caches statistics
    // per connection, so the dropping connection keeps planning as though they were still there. My first
    // version asserted on `a` and failed with "statistics survived the DROP" — the drop had worked; the
    // connection had not noticed.
    {
      const raw = new DatabaseSync(file);
      const plan = raw.prepare('EXPLAIN QUERY PLAN ' + DOC_QUERY).all(30078, 'trinityone/group:7', 100).map(r => r.detail).join(' | ');
      raw.close();
      assert.doesNotMatch(plan, /idx_dtag/, 'the statistics survived the DROP, so this test cannot prove anything');
    }

    // second run through openStore: a plain reopen, ZERO puts. Only the open-time ANALYZE can fix the plan here.
    const b = openStore(file, { maxEvents: 500000 });
    try {
      assert.match(planFor(b), /idx_dtag/,
        'reopening a POPULATED database left the bad plan. A real relay restarts with data already on disk, so ' +
        'the fill-up trigger never fires for it — the open-time ANALYZE is what covers that, and it is missing.');
    } finally { b.close(); }
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
});

// ── and the results must be IDENTICAL. A plan change that changes answers is a data bug. ──────────────────
test('the same query returns the same events it did before', () => {
  const { s, cleanup } = seeded();
  try {
    const viaStore = s.query({ kinds: [30078], '#d': ['trinityone/group:7'], limit: 100 });
    assert.ok(viaStore.length > 0, 'the seeded store returned nothing — this test would pass vacuously');
    for (const e of viaStore) {
      assert.equal(e.kind, 30078);
      assert.equal((e.tags.find(t => t[0] === 'd') || [])[1], 'trinityone/group:7',
        'the dtag-indexed plan returned an event with the wrong d-tag');
    }
    // newest-first ordering is a contract the gateway relies on (newest-wins on addressable docs)
    const ts = viaStore.map(e => e.created_at);
    assert.deepEqual(ts, [...ts].sort((a, b) => b - a), 'results are no longer newest-first');
  } finally { cleanup(); }
});

test('an ANALYZE failure cannot stop a store from opening', () => {
  // ANALYZE WRITES sqlite_stat1, so it can fail — a read-only mount, a permission-restricted data dir, a
  // database another process holds. A relay refusing to boot because it could not gather statistics would be a
  // far worse bug than the slow query this fixes.
  //
  // My first version of this test called `db.exec('ANALYZE')` directly under `PRAGMA query_only`, which of
  // course threw — it was asserting that raw ANALYZE is safe, which is not the invariant and never was. The
  // invariant is that openStore() SURVIVES the failure.
  //
  // Forcing that failure from outside is not achievable honestly: a genuinely read-only SQLite file in WAL mode
  // fails to OPEN at all, so the test would prove something about WAL rather than about this guard. So this
  // asserts the guard is present and shaped correctly, and states plainly that it is a source assertion.
  const src = readFileSync(new URL('./event-store.mjs', import.meta.url), 'utf8');
  const m = src.match(/const runAnalyze = \(\) => \{[\s\S]*?\n  \};/);
  assert.ok(m, 'runAnalyze() is gone — ANALYZE may now be called unguarded');
  assert.match(m[0], /try \{[^}]*db\.exec\('ANALYZE'\)/,
    'ANALYZE is no longer inside a try — a read-only data dir would stop the relay booting');
  assert.match(m[0], /catch/, 'runAnalyze has no catch');
  // and nothing may call ANALYZE outside that one guarded helper
  const raw = (src.match(/db\.exec\('ANALYZE'\)/g) || []).length;
  assert.equal(raw, 1, 'ANALYZE is called from ' + raw + ' places; it must go through runAnalyze() only');
});
