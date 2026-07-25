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
  // COMPOSITE (col, created_at) indexes: every read path is `WHERE <col> IN (…) ORDER BY created_at DESC`, so a
  // single-column index still forced a TEMP B-TREE sort of the whole matching partition (EXPLAIN-confirmed). The
  // composite lets SQLite walk the index in created_at order and stop at LIMIT — no full-partition sort. PERF-2026-07-13.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kind_created   ON events(kind, created_at);
           CREATE INDEX IF NOT EXISTS idx_pubkey_created ON events(pubkey, created_at);
           CREATE INDEX IF NOT EXISTS idx_church_created ON events(church, created_at);
           CREATE INDEX IF NOT EXISTS idx_created ON events(created_at);
           CREATE INDEX IF NOT EXISTS idx_dtag    ON events(dtag);
           CREATE INDEX IF NOT EXISTS idx_repl    ON events(repl);
           CREATE INDEX IF NOT EXISTS idx_cull    ON events(structured, church, created_at);`);
  // drop the now-redundant single-column indexes (the composite's leading column serves the same lookups) so writes
  // don't maintain duplicate b-trees. Idempotent + safe: composites above already cover kind/pubkey/church equality.
  db.exec(`DROP INDEX IF EXISTS idx_kind; DROP INDEX IF EXISTS idx_pubkey; DROP INDEX IF EXISTS idx_church;`);

  const qByRepl = db.prepare('SELECT id, created_at FROM events WHERE repl = ?');
  const qById   = db.prepare('SELECT 1 FROM events WHERE id = ?');
  const delById = db.prepare('DELETE FROM events WHERE id = ?');
  const qAuthorById = db.prepare('SELECT pubkey FROM events WHERE id = ?');
  const ins     = db.prepare('INSERT OR REPLACE INTO events (id,pubkey,kind,created_at,dtag,church,repl,structured,raw) VALUES (?,?,?,?,?,?,?,?,?)');
  const qCount  = db.prepare('SELECT COUNT(*) AS n FROM events');
  const qOverBudget      = db.prepare('SELECT church, COUNT(*) AS n FROM events WHERE structured = 0 GROUP BY church HAVING n > ?');
  const cullOldForChurch = db.prepare('DELETE FROM events WHERE id IN (SELECT id FROM events WHERE structured = 0 AND church = ? ORDER BY created_at ASC LIMIT ?)');
  const updChurch        = db.prepare('UPDATE events SET church = ? WHERE id = ?');
  const qUnattributed    = db.prepare("SELECT id, raw FROM events WHERE church = ''");

  // store an event. Returns 'stored' | 'have-newer' (a newer version of a replaceable doc already held) |
  // 'duplicate' (same id already stored) | 'deleted' (its author tombstoned it — a resync must not resurrect it).
  // Replaceable docs replace older versions of the same key.
  // `church` is the gateway-RESOLVED owning church (for per-church retention); falls back to the event's tag.
  function put(e, church) {
    if (!e || !e.id) return 'duplicate';
    // ROBUSTNESS-2026-07-13: reject a FAR-FUTURE created_at. Replaceable docs (roster/blocklist/stewards/admitted)
    // supersede purely by created_at, so a future-dated one (clock-skew or malice) can NEVER be corrected — an
    // honest-timestamped fix is rejected as 'have-newer', pinning the stale state cluster-wide via replication.
    // 15-min tolerance absorbs normal skew. Applies to every path (live + import + sync) since put() is the choke.
    if ((e.created_at || 0) > Math.floor(Date.now() / 1000) + 900) return 'future';
    if (qById.get(e.id)) return 'duplicate';   // already hold this exact event — no-op (no re-store/re-broadcast)
    if (isDeleted(e.id, e.pubkey)) return 'deleted';   // its author deleted it; a resync must not bring it back
    const rk = replKey(e);
    const ch = (church != null) ? church : churchOf(e);   // gateway passes the RESOLVED owning church; else the tag
    if (rk) {
      const rows = qByRepl.all(rk);
      // NIP-01 tie-break: newer created_at wins; on a TIE the LOWEST id wins. Comparing only created_at meant
      // two relays holding different same-second versions each thought the other's was replaceable, so they
      // swapped forever under negentropy — and every flip hard-deletes the version it replaces.
      for (const r of rows) {
        const rt = r.created_at || 0, et = e.created_at || 0;
        if (rt > et) return 'have-newer';
        if (rt === et && String(r.id) < String(e.id)) return 'have-newer';
      }
      // AUDIT-2026-07-24: replacing a doc was DELETE-then-INSERT with no transaction, on the one hot path that
      // destroys data (reattribute/importAll were already wrapped). A throw between the two — or a power cut,
      // since synchronous=NORMAL lets the DELETE reach disk while the INSERT doesn't — left the church's
      // roster / blocklist / stewards / sealed care need simply GONE, not stale. Make the swap atomic.
      db.exec('BEGIN');
      try {
        for (const r of rows) delById.run(r.id);
        ins.run(e.id, e.pubkey, e.kind, e.created_at || 0, dtagOf(e), ch, rk, 1, JSON.stringify(e));
        db.exec('COMMIT');
      } catch (err) { try { db.exec('ROLLBACK'); } catch {} throw err; }
      return 'stored';
    }
    ins.run(e.id, e.pubkey, e.kind, e.created_at || 0, dtagOf(e), ch, rk, 0, JSON.stringify(e));
    return 'stored';
  }

  // run one Nostr filter: narrow on indexed columns in SQL, then apply matchFilter for exactness
  // (ids + arbitrary #tags). Returns events newest-first.
  // `budget` (optional {left}) is a shared cross-filter scan allowance for one REQ: the gateway passes ONE budget to
  // every filter so a crafted many-filter REQ can't force 32×200k row parses (E1). Only the tag scan spends it.
  function query(f, budget) {
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
    // Does the filter constrain a tag NOT indexed in SQL (#t/#p/#e/…)? Those are matched only by matchFilter AFTER
    // the SQL rows come back — so a plain `ORDER BY created_at DESC LIMIT lim` would return the newest `lim` rows of
    // the indexed set and then drop the matching-but-older ones (a quiet #t group's history drowned out by a chatty
    // one, or old DMs past the cap — silent, permanent data loss). Stream newest→oldest and collect `lim` POST-match
    // rows instead, bounded by the indexed WHERE + a hard scan cap so a pathological filter can't run away.
    const tagKeys = Object.keys(f).filter(k => k[0] === '#' && k !== '#d' && k !== '#church');
    const out = [];
    if (tagKeys.length) {
      const sql = 'SELECT raw FROM events' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY created_at DESC';
      let scanned = 0;
      for (const r of db.prepare(sql).iterate(...args)) {
        if (++scanned > 200000) break;   // per-filter safety cap
        if (budget && --budget.left <= 0) break;   // aggregate cross-filter budget — bounds a crafted many-filter REQ (E1)
        let e; try { e = JSON.parse(r.raw); } catch { continue; }
        if (matchFilter(e, f)) { out.push(e); if (out.length >= lim) break; }
      }
      return out;
    }
    const sql = 'SELECT raw FROM events' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY created_at DESC LIMIT ?';
    for (const r of db.prepare(sql).all(...args, lim)) { let e; try { e = JSON.parse(r.raw); } catch { continue; } if (matchFilter(e, f)) out.push(e); }
    return out;
  }
  // Uncapped ASC iteration by kind — for BOOT hydration only (rebuilding in-memory maps). Unlike query() it has
  // NO display cap, so a church past 10k structured docs isn't silently truncated. Not a client read path.
  function eachKind(kinds, cb) {
    const sql = 'SELECT raw FROM events WHERE kind IN (' + kinds.map(() => '?').join(',') + ') ORDER BY created_at ASC';
    for (const r of db.prepare(sql).all(...kinds)) { let e; try { e = JSON.parse(r.raw); } catch { continue; } cb(e); }
  }

  function count() { return qCount.get().n; }

  // A tiny key/value table for relay bookkeeping that must survive restarts (currently the deletion-backfill
  // watermark). Kept here so it shares the store's transaction + file, not a second sidecar to keep in sync.
  const qKindCount = db.prepare('SELECT COUNT(*) AS n FROM events WHERE kind = ?');
  function countKind(k) { return qKindCount.get(k).n; }
  db.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);');
  const qMetaGet = db.prepare('SELECT v FROM meta WHERE k = ?');
  const qMetaSet = db.prepare('INSERT INTO meta (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v = excluded.v');
  function getMeta(k) { const r = qMetaGet.get(k); return r ? r.v : null; }
  function setMeta(k, v) { qMetaSet.run(k, String(v)); }
  function countDeletions() { return db.prepare('SELECT COUNT(*) AS n FROM deletions').get().n; }

  // NIP-09 support: the author of a stored event (or null), and a hard delete by id.
  function authorOf(id) { const r = qAuthorById.get(id); return r ? r.pubkey : null; }
  function del(id) { try { return delById.run(id).changes > 0; } catch { return false; } }

  // AUDIT-2026-07-24: deleted content RESURRECTED. `del()` is a bare DELETE that leaves no trace, so the next
  // resync with a peer that still holds the event pulled it straight back in — a member who deleted a message
  // watched it reappear. Three separate holes, one table closes all three:
  //   1. no record of the deletion, so nothing could refuse the re-import;
  //   2. the caller applied deletions only when put() returned 'stored', so a relay that ALREADY held the kind-5
  //      never re-applied it (the common case after any restart);
  //   3. negentropy imports in ID order, so a kind-5 processed BEFORE its target simply found nothing to delete
  //      and the target landed moments later, permanently.
  // A tombstone is authoritative only for the pubkey that claimed it, and put() only honours one whose pubkey
  // matches the event's own author — so recording a tombstone for an event we don't hold is safe even though we
  // cannot yet check authorship. Tombstones are ~100 bytes and are kept forever: a deletion that expires is a
  // deletion that undoes itself, which is the bug.
  db.exec(`CREATE TABLE IF NOT EXISTS deletions (
    target_id TEXT NOT NULL,
    pubkey    TEXT NOT NULL,
    church    TEXT NOT NULL DEFAULT '',
    at        INTEGER NOT NULL,
    PRIMARY KEY (target_id, pubkey)
  );`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_deletions_church ON deletions(church);');
  const insTomb   = db.prepare('INSERT OR IGNORE INTO deletions (target_id,pubkey,church,at) VALUES (?,?,?,?)');
  const qTombMine = db.prepare('SELECT 1 FROM deletions WHERE target_id = ? AND pubkey = ?');
  const qRowById  = db.prepare('SELECT pubkey, church FROM events WHERE id = ?');

  // Apply one NIP-09 deletion: `pubkey` asks to delete `targetId`. Deletes it if we hold it AND the requester is
  // its author; records the tombstone either way so it can never come back. Idempotent — call it on every kind-5,
  // every time, including duplicates and imports.
  function applyDeletion(targetId, pubkey, at) {
    if (!targetId || !pubkey) return false;
    const row = qRowById.get(targetId);
    if (row && row.pubkey !== pubkey) return false;   // not yours to delete — no tombstone, no delete
    try { insTomb.run(targetId, pubkey, (row && row.church) || '', at || Math.floor(Date.now() / 1000)); } catch {}
    return row ? del(targetId) : false;
  }
  // Is this event tombstoned BY ITS OWN AUTHOR?
  //
  // AUDIT 2026-07-25 (CRITICAL, defeated the whole feature): this used to fetch ONE row for the target id and
  // compare its pubkey. The table is keyed (target_id, pubkey), so MANY pubkeys can tombstone the same id, and
  // SQLite served that read from the autoindex — i.e. the LEXICOGRAPHICALLY LOWEST pubkey, whatever the insert
  // order. kind-5 is world-readable and broadcast, so any member could watch for deletions, echo the same
  // e-tag under their own key, and — whenever their key sorted below the author's — permanently un-delete it.
  // "You can never unsend anything on this relay", available to anyone who could read the relay.
  // The query must be index-EXACT on (target_id, pubkey). No null-pubkey branch: a caller that omits the
  // author would match a forged tombstone, which is the same bug with a different entry point.
  function isDeleted(id, pubkey) {
    if (!id || !pubkey) return false;
    return !!qTombMine.get(id, pubkey);
  }

  // Backup: every stored event this relay holds for one church, oldest-first, as parsed objects. `cp` is the
  // gateway-resolved owning church (the `church` column). The caller decides what to serialise (JSONL) + how to
  // gate access. Restore is just importAll() of these events back into a store.
  const qExportChurch = db.prepare('SELECT raw FROM events WHERE church = ? ORDER BY created_at ASC');
  function exportChurch(cp) { const out = []; for (const r of qExportChurch.all(cp)) { try { out.push(JSON.parse(r.raw)); } catch {} } return out; }
  // relay resync: a church's events at/after `since` (created_at), oldest-first. Queries the church COLUMN directly
  // (like exportChurch) — NOT via a #church filter, which matchFilter would wrongly narrow to tag-carrying events.
  const qExportChurchSince = db.prepare('SELECT raw FROM events WHERE church = ? AND created_at >= ? ORDER BY created_at ASC');
  function exportChurchSince(cp, since) { const out = []; for (const r of qExportChurchSince.all(cp, since || 0)) { try { out.push(JSON.parse(r.raw)); } catch {} } return out; }
  // negentropy resync: just the event IDs a church holds (for bucketed set-difference), and the raw events for a
  // given ID list (to pull only the true difference). Cheap ID-only scan; the events fetch is bounded by the caller.
  const qChurchIds = db.prepare('SELECT id FROM events WHERE church = ?');
  // Claim ONLY what we actually hold.
  //
  // This briefly also returned tombstoned ids, to stop negentropy re-offering a deleted event every round. That
  // was wrong: a tombstone's `church` is whatever we knew at the moment the kind-5 arrived ('' when the target
  // was not held yet), so two relays applying the SAME genuine deletion file it under different churches. The
  // bucket fingerprints then never match, the bucket is re-diffed every pass, the peer asks for an event we
  // will never send, and the responder re-scans the whole church every time — reintroducing, on the responder
  // side, the 256-full-scans stall that was just removed from the requester side. AUDIT 2026-07-25.
  // Re-offering a deleted id costs one refused write per sync; non-convergence costs a permanent loop.
  function churchEventIds(cp) { return qChurchIds.all(cp).map((r) => r.id); }
  const qEventByIdCh = db.prepare('SELECT raw FROM events WHERE church = ? AND id = ?');
  function syncEventsByIds(cp, ids) { const out = []; if (!Array.isArray(ids)) return out; for (const id of ids) { const r = qEventByIdCh.get(cp, id); if (r) { try { out.push(JSON.parse(r.raw)); } catch {} } } return out; }

  // retention (per-church fairness): every structured (replaceable/addressable) doc is kept forever; each
  // church — including the '' shared bucket for unattributed DMs/reactions — keeps only its newest
  // `maxEvents` EPHEMERAL events (chat/DMs/reactions). So a chatty church can't age out a quiet church's
  // chat; each church gets its own guaranteed budget. (maxEvents is now the PER-CHURCH ephemeral budget.)
  function cull() {
    let culled = 0;
    for (const row of qOverBudget.all(maxEvents)) { const over = row.n - maxEvents; cullOldForChurch.run(row.church, over); culled += over; }
    return culled;
  }

  // re-resolve the church column for events stored without one (migrated chat, or events stored before the
  // gateway's group→church / member→church maps existed). Idempotent — only touches church='' rows.
  function reattribute(resolveFn) {
    const rows = qUnattributed.all();
    if (!rows.length) return 0;
    let n = 0;
    db.exec('BEGIN');
    try { for (const r of rows) { let e; try { e = JSON.parse(r.raw); } catch { continue; } const ch = resolveFn(e); if (ch) { updChurch.run(ch, r.id); n++; } } db.exec('COMMIT'); }
    catch (err) { db.exec('ROLLBACK'); throw err; }
    return n;
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

  // ── purge a church's data (RELAY-AUDIT-2026-07-20 H3) ───────────────────────────────────────────────
  // Removing a church from the write policy previously deleted NOTHING: its events stayed in the DB forever
  // (all kind-30078 docs are `structured` and exempt from culling), became unreadable to everyone including
  // the church itself once `owningChurch()` could no longer resolve them, and still counted in /status. The
  // operator had no way to reclaim the disk or honour a deletion request. This is that path.
  //
  // Three ways an event belongs to a church, all needed — attribution alone misses the church's own posts on
  // a relay where resolveChurch never ran, and misses the member docs that ARE the roster:
  //   1. attributed to it (the `church` column, set by resolveChurch on write)
  //   2. authored by its key
  //   3. a `<prefix><churchpub>`-suffixed doc (member:/minors:/stewards:/… — the d-tag names the church)
  const PURGE_WHERE = 'church = ? OR pubkey = ? OR dtag LIKE ?';
  const qPurgeCount = db.prepare(`SELECT COUNT(*) AS n FROM events WHERE ${PURGE_WHERE}`);
  const qPurgeIds   = db.prepare(`SELECT id FROM events WHERE ${PURGE_WHERE}`);
  const doPurge     = db.prepare(`DELETE FROM events WHERE ${PURGE_WHERE}`);
  const purgeArgs   = (cp) => [cp, cp, '%:' + cp];
  // Count first so the dashboard can show the scale BEFORE the operator commits — deleting a congregation's
  // history should never be a surprise.
  function countChurchData(cp) { if (!cp) return 0; try { return qPurgeCount.get(...purgeArgs(cp)).n | 0; } catch { return 0; } }
  function purgeChurch(cp) {
    if (!cp) return { events: 0, ids: [] };
    try {
      const ids = qPurgeIds.all(...purgeArgs(cp)).map(r => r.id);   // returned so the caller can drop matching blobs
      const n = doPurge.run(...purgeArgs(cp)).changes | 0;
      return { events: n, ids };
    } catch (e) { return { events: 0, ids: [], error: String((e && e.message) || e) }; }
  }
  // Dashboard aggregates. Every query here rides an existing index (idx_created, idx_kind_created,
  // idx_church_created), so this stays cheap as the pool grows.
  const qDaily   = db.prepare(`SELECT created_at / 86400 AS d, COUNT(*) AS n FROM events WHERE created_at >= ? GROUP BY d`);
  const qKinds   = db.prepare(`SELECT kind, COUNT(*) AS n FROM events GROUP BY kind ORDER BY n DESC`);
  const qByChurch= db.prepare(`SELECT church, COUNT(*) AS n FROM events WHERE church <> '' GROUP BY church ORDER BY n DESC LIMIT 8`);
  const qOldest  = db.prepare(`SELECT MIN(created_at) AS t FROM events`);
  // `days` of DENSE buckets — a day with no events must come back as 0, not be missing. A sparse series
  // silently rescales the chart and makes a quiet week look identical to a busy one.
  function activity(days = 30, nowSec = Math.floor(Date.now() / 1000)) {
    const n = Math.max(1, Math.min(365, days | 0));
    const today = Math.floor(nowSec / 86400);
    const since = (today - n + 1) * 86400;
    const seen = new Map();
    try { for (const r of qDaily.all(since)) seen.set(r.d | 0, r.n | 0); } catch {}
    const daily = [];
    for (let i = 0; i < n; i++) { const d = today - n + 1 + i; daily.push({ day: d * 86400, n: seen.get(d) || 0 }); }
    let kinds = [], churches = [], oldest = 0;
    try { kinds = qKinds.all().map(r => ({ kind: r.kind | 0, n: r.n | 0 })); } catch {}
    try { churches = qByChurch.all().map(r => ({ church: r.church, n: r.n | 0 })); } catch {}
    try { oldest = (qOldest.get() || {}).t | 0; } catch {}
    return { days: n, daily, kinds, churches, oldest };
  }
  return { db, put, query, eachKind, count, countKind, countDeletions, getMeta, setMeta, authorOf, del, applyDeletion, isDeleted, exportChurch, exportChurchSince, churchEventIds, syncEventsByIds, cull, reattribute, importAll, countChurchData, purgeChurch, activity, close: () => { try { db.close(); } catch {} }, replKey, matchFilter };
}
