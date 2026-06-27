// event-store.mjs — durable, scalable event storage for the TrinityOne relay, on node:sqlite (built-in,
// no native dependency). Replaces the in-memory JSON-array store: events live on disk, REQ reads are
// indexed SQL (narrowed by kind / author / created_at / church / d-tag) with the canonical matchFilter
// applied for exactness, and retention protects structured docs while culling only the oldest ephemeral.
//
// Schema columns mirror the dimensions the relay actually queries; arbitrary #tags are matched in JS via
// matchFilter on the SQL-narrowed result (correct, and per-church/-kind narrowing keeps it cheap). A
// tag-index table (#p, #e, …) is the next optimisation for extreme single-pool scale — see BACKLOG.
import { DatabaseSync } from 'node:sqlite';

const dtagOf   = (e) => { const t = (e.tags || []).find(t => t[0] === 'd'); return t ? (t[1] || '') : ''; };
const churchOf = (e) => { const t = (e.tags || []).find(t => t[0] === 'church'); return t ? (t[1] || '') : ''; };

// NIP-01 replaceable (0 / 3 / 10000-19999) + addressable (30000-39999 by d-tag): exactly one kept per
// (pubkey, kind[, d]). These are the church's STRUCTURE (profiles, rosters, needs, settings) — never culled.
export function replKey(e) {
  const k = e.kind;
  if (k === 0 || k === 3 || (k >= 10000 && k < 20000)) return e.pubkey + ':' + k;
  if (k >= 30000 && k < 40000) return e.pubkey + ':' + k + ':' + dtagOf(e);
  return null;
}

// The relay's read predicate — the single source of truth for whether an event matches a filter.
export function matchFilter(evt, f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return false;
  if (f.ids && !f.ids.includes(evt.id)) return false;
  if (f.authors && !f.authors.includes(evt.pubkey)) return false;
  if (f.kinds && !f.kinds.includes(evt.kind)) return false;
  if (f.since && evt.created_at < f.since) return false;
  if (f.until && evt.created_at > f.until) return false;
  for (const k in f) if (k[0] === '#') {
    const tag = k.slice(1), vals = f[k];
    if (!evt.tags.some(t => t[0] === tag && vals.includes(t[1]))) return false;
  }
  return true;
}

export function openStore(dbPath, { maxEvents = 20000 } = {}) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
  db.exec(`CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    pubkey TEXT NOT NULL,
    kind INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    dtag TEXT NOT NULL DEFAULT '',
    church TEXT NOT NULL DEFAULT '',
    repl TEXT,                      -- replaceable key (null = ephemeral, culled oldest-first)
    structured INTEGER NOT NULL DEFAULT 0,
    raw TEXT NOT NULL               -- the verbatim event JSON, returned as-is to clients
  );`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kind    ON events(kind);
           CREATE INDEX IF NOT EXISTS idx_pubkey  ON events(pubkey);
           CREATE INDEX IF NOT EXISTS idx_created ON events(created_at);
           CREATE INDEX IF NOT EXISTS idx_church  ON events(church);
           CREATE INDEX IF NOT EXISTS idx_dtag    ON events(dtag);
           CREATE INDEX IF NOT EXISTS idx_repl    ON events(repl);
           CREATE INDEX IF NOT EXISTS idx_evict   ON events(structured, created_at);`);

  const qByRepl = db.prepare('SELECT id, created_at FROM events WHERE repl = ?');
  const qById   = db.prepare('SELECT 1 FROM events WHERE id = ?');
  const delById = db.prepare('DELETE FROM events WHERE id = ?');
  const ins     = db.prepare('INSERT OR REPLACE INTO events (id,pubkey,kind,created_at,dtag,church,repl,structured,raw) VALUES (?,?,?,?,?,?,?,?,?)');
  const qCount  = db.prepare('SELECT COUNT(*) AS n FROM events');
  const qEph    = db.prepare("SELECT COUNT(*) AS n FROM events WHERE structured = 0");
  const cullOld = db.prepare('DELETE FROM events WHERE id IN (SELECT id FROM events WHERE structured = 0 ORDER BY created_at ASC LIMIT ?)');

  // store an event. Returns 'stored' | 'have-newer' (a newer version of a replaceable doc already held) |
  // 'duplicate' (same id already stored). Replaceable docs replace older versions of the same key.
  function put(e) {
    if (!e || !e.id) return 'duplicate';
    if (qById.get(e.id)) return 'duplicate';   // already hold this exact event — no-op (no re-store/re-broadcast)
    const rk = replKey(e);
    if (rk) {
      const rows = qByRepl.all(rk);
      for (const r of rows) if ((r.created_at || 0) > (e.created_at || 0)) return 'have-newer';
      for (const r of rows) delById.run(r.id);
    }
    ins.run(e.id, e.pubkey, e.kind, e.created_at || 0, dtagOf(e), churchOf(e), rk, rk ? 1 : 0, JSON.stringify(e));
    return 'stored';
  }

  // run one Nostr filter: narrow on indexed columns in SQL, then apply matchFilter for exactness
  // (ids + arbitrary #tags). Returns events newest-first.
  function query(f) {
    if (!f || typeof f !== 'object' || Array.isArray(f)) return [];
    const where = [], args = [];
    const inClause = (col, vals) => { where.push(col + ' IN (' + vals.map(() => '?').join(',') + ')'); for (const v of vals) args.push(v); };
    if (Array.isArray(f.kinds) && f.kinds.length)   inClause('kind', f.kinds);
    if (Array.isArray(f.authors) && f.authors.length) inClause('pubkey', f.authors);
    if (Array.isArray(f.ids) && f.ids.length)       inClause('id', f.ids);
    if (Array.isArray(f['#d']) && f['#d'].length)   inClause('dtag', f['#d']);
    if (Array.isArray(f['#church']) && f['#church'].length) inClause('church', f['#church']);
    if (f.since) { where.push('created_at >= ?'); args.push(f.since); }
    if (f.until) { where.push('created_at <= ?'); args.push(f.until); }
    const lim = Math.max(1, Math.min(f.limit || 5000, 10000));
    const sql = 'SELECT raw FROM events' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY created_at DESC LIMIT ?';
    const rows = db.prepare(sql).all(...args, lim);
    const out = [];
    for (const r of rows) { let e; try { e = JSON.parse(r.raw); } catch { continue; } if (matchFilter(e, f)) out.push(e); }
    return out;
  }

  function count() { return qCount.get().n; }

  // retention: keep every structured (replaceable/addressable) doc; cull only the oldest ephemeral
  // (chat/DMs/reactions) down to the budget left after structure. Never drops the church's truth.
  function cull() {
    const total = count();
    if (total <= maxEvents) return 0;
    const eph = qEph.get().n;
    const structured = total - eph;
    const budget = Math.max(0, maxEvents - structured);
    const toCull = eph - budget;
    if (toCull <= 0) return 0;
    cullOld.run(toCull);
    return toCull;
  }

  // bulk import (one-time migration from the old JSON array). Wrapped in a transaction for speed.
  function importAll(arr) {
    if (!Array.isArray(arr) || !arr.length) return 0;
    let n = 0;
    db.exec('BEGIN');
    try { for (const e of arr) { if (put(e) === 'stored') n++; } db.exec('COMMIT'); }
    catch (err) { db.exec('ROLLBACK'); throw err; }
    return n;
  }

  return { db, put, query, count, cull, importAll, close: () => { try { db.close(); } catch {} }, replKey, matchFilter };
}
