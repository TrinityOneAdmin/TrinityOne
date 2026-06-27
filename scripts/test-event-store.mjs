// test-event-store.mjs — regression test for the relay's SQLite event store.
// Proves store.query() returns exactly what the old full-scan matchFilter did, plus replaceable dedup +
// smart retention. Self-contained (synthetic events); also runs the real relay-db.json if present.
//   node scripts/test-event-store.mjs
import { openStore, matchFilter } from './event-store.mjs';
import { existsSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let failures = 0;
const ok = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) failures++; };
const ids = (a) => a.map(e => e.id).sort().join(',');
const freshDb = () => { const p = join(tmpdir(), 'to-store-test-' + Math.floor(process.hrtime()[1]) + '.sqlite'); for (const s of ['', '-wal', '-shm']) { try { rmSync(p + s); } catch {} } return p; };

function ev(o) { return { id: o.id, pubkey: o.pubkey || 'p1', kind: o.kind, created_at: o.created_at || 1000, tags: o.tags || [], content: o.content || '' }; }

// ---- synthetic corpus covering profiles, addressable docs, chat, DMs, church-tagged ----
const corpus = [
  ev({ id: 'a', kind: 0, pubkey: 'alice', created_at: 100, content: '{"name":"Alice"}' }),
  ev({ id: 'b', kind: 0, pubkey: 'bob', created_at: 101, content: '{"name":"Bob"}' }),
  ev({ id: 'c', kind: 30078, pubkey: 'church1', created_at: 200, tags: [['d', 'trinityone/care:1'], ['t', 'trinityone'], ['church', 'church1']] }),
  ev({ id: 'd', kind: 30078, pubkey: 'church1', created_at: 201, tags: [['d', 'trinityone/meals-settings'], ['t', 'trinityone'], ['church', 'church1']] }),
  ev({ id: 'e', kind: 1, pubkey: 'alice', created_at: 300, tags: [['t', 'trinityone'], ['t', 'group7']], content: 'hi' }),
  ev({ id: 'f', kind: 1, pubkey: 'bob', created_at: 301, tags: [['t', 'trinityone'], ['t', 'group7']], content: 'yo' }),
  ev({ id: 'g', kind: 4, pubkey: 'alice', created_at: 400, tags: [['p', 'bob'], ['t', 'trinityone']], content: 'dm' }),
  ev({ id: 'h', kind: 7, pubkey: 'bob', created_at: 500, tags: [['e', 'e'], ['t', 'trinityone']], content: '+' }),
];

const db = freshDb();
const store = openStore(db, { maxEvents: 20000 });
ok(store.importAll(corpus) === corpus.length, `imported ${corpus.length} synthetic events`);

const filters = [
  { kinds: [0] }, { kinds: [1] }, { kinds: [4] }, { kinds: [0, 1, 4, 7, 30078] },
  { authors: ['alice'] }, { authors: ['church1'] }, { kinds: [0], authors: ['bob'] },
  { kinds: [30078], '#church': ['church1'], '#t': ['trinityone'] },
  { kinds: [30078], '#d': ['trinityone/meals-settings'] },
  { kinds: [4], '#p': ['bob'] }, { kinds: [1], '#t': ['group7'] },
  { since: 300 }, { until: 200 }, { ids: ['a', 'h'] }, { kinds: [99] },
];
let pass = 0;
for (const f of filters) { if (ids(store.query(f)) === ids(corpus.filter(e => matchFilter(e, f)))) pass++; else { failures++; console.log('  ✗ ' + JSON.stringify(f)); } }
ok(pass === filters.length, `correctness: ${pass}/${filters.length} filters == full-scan matchFilter`);

// replaceable dedup
const before = store.count();
ok(store.put(ev({ id: 'd2', kind: 30078, pubkey: 'church1', created_at: 250, tags: [['d', 'trinityone/meals-settings'], ['church', 'church1']] })) === 'stored', 'newer addressable stored');
ok(store.count() === before, 'count unchanged (older addressable replaced)');
ok(store.put(ev({ id: 'd3', kind: 30078, pubkey: 'church1', created_at: 100, tags: [['d', 'trinityone/meals-settings'], ['church', 'church1']] })) === 'have-newer', 'older addressable → have-newer');
ok(store.put(corpus[0]) === 'duplicate', 'same id → duplicate');

// retention: PER-CHURCH ephemeral budget; structured always kept; a chatty church can't evict a quiet one
const s2 = openStore(freshDb(), { maxEvents: 3 });   // each church keeps its 3 newest ephemeral
const struct = Array.from({ length: 3 }, (_, i) => ev({ id: 's' + i, kind: 30078, pubkey: 'p' + i, created_at: i, tags: [['d', 'x'], ['church', 'cA']] }));
s2.importAll(struct);
for (let i = 0; i < 10; i++) s2.put(ev({ id: 'a' + i, kind: 1, created_at: 100 + i }), 'cA');   // chatty church A floods
for (let i = 0; i < 2; i++) s2.put(ev({ id: 'b' + i, kind: 1, created_at: 200 + i }), 'cB');     // quiet church B
s2.cull();
ok(s2.query({ kinds: [1] }).filter(e => e.id[0] === 'a').length === 3, 'per-church: chatty church A capped to its 3 newest');
ok(s2.query({ kinds: [1] }).filter(e => e.id[0] === 'b').length === 2, "per-church: quiet church B's chat ALL survived A's flood");
ok(struct.every(s => s2.query({ ids: [s.id] }).length === 1), 'per-church: ALL structured kept');

// reattribute: fill the church column for events stored without one (migrated chat / pre-map writes)
const s3 = openStore(freshDb(), { maxEvents: 100 });
s3.put(ev({ id: 'u1', kind: 1, created_at: 1, tags: [['t', 'grp1']] }));   // no church passed → column ''
const churchCol = (id) => s3.db.prepare('SELECT church FROM events WHERE id = ?').get(id).church;
ok(churchCol('u1') === '', 'reattribute: church column empty before');
const rn = s3.reattribute(e => e.tags.some(t => t[0] === 't' && t[1] === 'grp1') ? 'cX' : '');
ok(rn === 1 && churchCol('u1') === 'cX', 'reattribute: church column filled in (retention bucket; tags/serving unchanged)');

// real data, if present
const realPath = 'relay/relay-db.json';
if (existsSync(realPath)) {
  try {
    const real = JSON.parse(readFileSync(realPath, 'utf8'));
    if (Array.isArray(real) && real.length) {
      const rs = openStore(freshDb(), { maxEvents: 50000 }); rs.importAll(real);
      const fs2 = [{ kinds: [0] }, { kinds: [30078], '#t': ['trinityone'] }, ...[...new Set(real.map(e => e.pubkey))].slice(0, 5).map(p => ({ authors: [p] }))];
      let rp = 0; for (const f of fs2) if (ids(rs.query(f)) === ids(real.filter(e => matchFilter(e, f)))) rp++; else failures++;
      ok(rp === fs2.length, `real data (${real.length} events): ${rp}/${fs2.length} filters == full-scan`);
    }
  } catch (e) { console.log('(skipped real-data check: ' + e.message + ')'); }
}

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nALL PASS');
process.exit(failures ? 1 : 0);
