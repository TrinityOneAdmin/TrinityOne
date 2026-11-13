// RELAY DATA MOVE — relay storage plan step 2 (TrinityOne-internal/reference/PLAN-relay-storage-location-2026-11-12.html,
// §3 as amended by the owner's §8a of 2026-11-13). A pure module plus a CLI. NOTHING CALLS IT YET: the gateway
// request (step 3), the panel (step 4), the Suite launcher (step 5) and the server root helper (step 6) come later.
//
// The relay must be STOPPED before any of this runs. The mover never starts or stops a relay itself; the caller
// (the launcher) does, and runs the step-8 "same key, same events" check with compareAfterRestart().
//
// SAME VOLUME  -> one atomic rename (owner, §8a). No old copy exists; rollback = rename back.
// CROSS VOLUME -> rename fails with EXDEV and nothing has changed; then fold the WAL, copy every file, verify every
//                 byte + the database, and only then flip the pointer. The old folder is kept, marked MOVED-TO (the
//                 gateway refuses to start on it — step 1), never auto-deleted; journal.oldCopy.since records when
//                 it became the old copy so a later step can remind after 7 days.
//
// The POINTER (which folder the launcher starts the relay on) and the JOURNAL (move state) live OUTSIDE both data
// folders, and are passed in as small {read, write} objects so the Suite (storage.json) and the server
// (/etc/trinityone/relay.env + drop-ins, step 6) can each supply their own. jsonFieldStore() is the file version.
import {
  readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync, rmSync, lstatSync, statSync,
  statfsSync, copyFileSync, openSync, fsyncSync, closeSync, chmodSync, rmdirSync, createReadStream, constants as FS,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname, sep, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';

// The fixed folder name created on the chosen drive (owner §8a: a drive from a list, never a typed path).
export const LEAF = 'trinityone-relay';
export const MARK_INCOMPLETE = '.trinity-move-incomplete';
export const STAMP = '.trinity-data-dir';
export const MOVED_TO = 'MOVED-TO';
// Not carried by a COPY (same list as the backup's excludes, gateway.mjs, plus the side files of a folded WAL and
// this feature's own request file). A RENAME carries everything, so it needs no list.
export const SKIP = new Set(['.restore-pending', '.bundle-cache', 'cloudflared.log', 'rejected.log', 'rejected.log.1',
  'relay-launch.log', 'relay.sqlite-shm', 'relay.sqlite-wal', '.move-request', MARK_INCOMPLETE]);
const SPACE_MARGIN = 512 * 1024 * 1024;
// States in which a move is under way and recoverMove() has work to do.
export const ACTIVE = new Set(['renaming', 'copying', 'verifying', 'switching', 'switched', 'checking', 'rolling-back']);

// ── drive eligibility ──────────────────────────────────────────────────────────────────────────────────────
// Refused (§2): network filesystems (SQLite WAL needs shared memory, sqlite.org/wal.html), sync-client folders
// (SQLite under a sync client corrupts and uploads), system folders. ALLOWED WITH A WARNING (owner §8a):
// filesystems without permissions — the UI must show a strong warning, so it is returned as a code, not a refusal.
const NETWORK_FS = new Set(['nfs', 'nfs4', 'cifs', 'smb', 'smb2', 'smb3', 'smbfs', 'afpfs', 'webdav', 'davfs', 'fuse.davfs',
  'sshfs', 'fuse.sshfs', '9p', 'ceph', 'glusterfs', 'fuse.glusterfs', 'lustre', 'fuse.rclone', 'fuse.s3fs', 'afs']);
const NO_PERMS_FS = new Set(['exfat', 'fuse.exfat', 'vfat', 'msdos', 'fat', 'fat32', 'ntfs', 'ntfs3', 'fuseblk', 'fuse.ntfs-3g']);
const SYNC_RE = /(^|[\\/])(OneDrive[^\\/]*|Dropbox[^\\/]*|Google Drive[^\\/]*|GoogleDrive[^\\/]*|Mobile Documents|CloudStorage|iCloud Drive[^\\/]*|iCloudDrive|Box Sync|pCloud Drive|MEGAsync|Nextcloud|ownCloud)([\\/]|$)/i;
const SYSTEM_POSIX = ['/etc', '/usr', '/boot', '/proc', '/sys', '/dev', '/root', '/var/log', '/bin', '/sbin', '/lib', '/lib64', '/System', '/Library', '/private/etc', '/private/var'];
const under = (p, root) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);

// classifyTarget: pure. info = { path, fsType, mountOptions:[...], free, need, mode:'suite'|'server', home, codeDir }
// Returns { eligible, refuse:[codes], warn:[codes] }.
export function classifyTarget(info) {
  const refuse = [], warn = [];
  const p = String(info.path || '');
  const fs = String(info.fsType || '').toLowerCase();
  const opts = (info.mountOptions || []).map(o => String(o).toLowerCase());
  if (/^\\\\/.test(p) || /^\/\/[^/]/.test(p)) refuse.push('network');          // UNC / smb:// style
  else if (NETWORK_FS.has(fs)) refuse.push('network');
  if (SYNC_RE.test(p)) refuse.push('sync-folder');
  if (p.startsWith('/')) {
    if (SYSTEM_POSIX.some(r => under(p, r)) || (under(p, '/run') && !under(p, '/run/media'))) refuse.push('system-folder');
    if (info.mode === 'server' && under(p, '/home')) refuse.push('system-folder');
  }
  if (info.codeDir && under(resolve(p), resolve(info.codeDir))) refuse.push('inside-app');
  if (typeof info.free === 'number' && typeof info.need === 'number' && info.free < info.need) refuse.push('not-enough-space');
  if (NO_PERMS_FS.has(fs) || opts.includes('noowners')) warn.push('no-permissions');
  if (p.startsWith('/media/') || p.startsWith('/run/media/') || p.startsWith('/Volumes/')) warn.push('removable');
  if (!fs && !/^\\\\/.test(p)) warn.push('filesystem-unknown');
  return { eligible: refuse.length === 0, refuse: [...new Set(refuse)], warn: [...new Set(warn)] };
}

// Linux /proc/self/mountinfo -> [{ mountpoint, fsType, source, options }]. Pure.
export function parseMountinfo(text) {
  const dec = s => s.replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
  const out = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    const [left, right] = line.split(' - ');
    if (!right) continue;
    const l = left.split(' '), r = right.split(' ');
    out.push({ mountpoint: dec(l[4]), fsType: r[0], source: dec(r[1] || ''), options: [...(l[5] || '').split(','), ...(r[2] || '').split(',')] });
  }
  return out;
}
// macOS `mount` output: "/dev/disk4s1 on /Volumes/T7 (exfat, local, nodev, nosuid, noowners)". Pure.
export function parseMacMount(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = /^(.*?) on (.*) \(([^)]*)\)\s*$/.exec(line);
    if (!m) continue;
    const opts = m[3].split(',').map(s => s.trim());
    out.push({ mountpoint: m[2], fsType: opts[0], source: m[1], options: opts.slice(1) });
  }
  return out;
}
// The mount holding path p (longest mountpoint prefix). Linux and macOS; elsewhere null (fs unknown — flagged).
export function mountFor(p, mounts) {
  const abs = resolve(p);
  let best = null;
  for (const m of mounts || []) if (under(abs, m.mountpoint) || m.mountpoint === '/') { if (!best || m.mountpoint.length > best.mountpoint.length) best = m; }
  return best;
}
export function systemMounts() {
  try {
    if (process.platform === 'linux') return parseMountinfo(readFileSync('/proc/self/mountinfo', 'utf8'));
    if (process.platform === 'darwin') return parseMacMount(execFileSync('mount', [], { encoding: 'utf8', timeout: 5000 }));
  } catch {}
  return null;
}
export function freeBytes(p) {
  let q = resolve(p);
  while (!existsSync(q) && dirname(q) !== q) q = dirname(q);
  const s = statfsSync(q); return Number(s.bavail) * Number(s.bsize);
}
export function targetFor(mountpoint) { return join(mountpoint, LEAF); }

// ── small helpers ──────────────────────────────────────────────────────────────────────────────────────────
function fsyncDir(d) { try { const fd = openSync(d, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } } catch {} }
export function writeAtomic(file, text) {
  const tmp = file + '.tmp-' + process.pid;
  const fd = openSync(tmp, 'w');
  try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, file); fsyncDir(dirname(file));
}
const readJson = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
export function keyPubOf(dir) { const k = readJson(join(dir, 'relay-key.json')); return (k && k.sk && k.pub) ? String(k.pub) : ''; }
export function hasSymlink(p) {
  let st; try { st = lstatSync(p); } catch { return false; }
  if (st.isSymbolicLink()) return true;
  if (st.isDirectory()) for (const c of readdirSync(p)) if (hasSymlink(join(p, c))) return true;
  return false;
}
// relative paths of every regular file under dir, skipping SKIP names at the top level
function listFiles(dir, rel = '', top = true, out = []) {
  for (const name of readdirSync(join(dir, rel)).sort()) {
    if (top && SKIP.has(name)) continue;
    const r = rel ? join(rel, name) : name;
    const st = lstatSync(join(dir, r));
    if (st.isDirectory()) listFiles(dir, r, false, out);
    else if (st.isFile()) out.push({ rel: r, size: st.size });
  }
  return out;
}
function sha256(file) {
  return new Promise((res, rej) => { const h = createHash('sha256'); createReadStream(file).on('error', rej).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))); });
}
async function openDb(file, opts) { const { DatabaseSync } = await import('node:sqlite'); return new DatabaseSync(file, opts || {}); }
// Fold the WAL into relay.sqlite. Refuses (returns a code) if anything still holds the database, or a WAL is left.
export async function foldWal(dir) {
  const db = join(dir, 'relay.sqlite');
  if (!existsSync(db)) return null;
  let h;
  try {
    h = await openDb(db);
    const r = h.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    if (!r || r.busy !== 0) return 'wal-busy';
  } catch { return 'database-unreadable'; }
  finally { try { h && h.close(); } catch {} }
  const wal = db + '-wal';
  if (existsSync(wal) && statSync(wal).size > 0) return 'wal-not-folded';
  return null;
}
// readOnly leaves empty -wal/-shm side files behind (it cannot remove them), so the SOURCE is opened normally —
// the relay is stopped, and the last connection's close removes them — and only the copy is opened readOnly.
export async function countRows(dir, { readOnly = false } = {}) {
  const db = join(dir, 'relay.sqlite');
  if (!existsSync(db)) return null;
  const h = await openDb(db, { readOnly });
  try {
    const c = {};
    for (const t of ['events', 'deletions', 'meta']) { try { c[t] = Number(h.prepare(`SELECT count(*) AS n FROM ${t}`).get().n); } catch { c[t] = null; } }
    return c;
  } finally { try { h.close(); } catch {} }
}
async function integrityOk(dir) {
  const db = join(dir, 'relay.sqlite');
  if (!existsSync(db)) return true;
  let h;
  try { h = await openDb(db, { readOnly: true }); const r = h.prepare('PRAGMA integrity_check').get(); return r && Object.values(r)[0] === 'ok'; }
  catch { return false; } finally { try { h && h.close(); } catch {} }
}

// A {read, write} store for one field of a JSON file, written atomically. The Suite keeps pointer and journal in
// storage.json (fields dataDir/relayPub and move); tests and the CLI use the same shape.
export function jsonFieldStore(file, field) {
  return {
    read() { const o = readJson(file); return o ? (o[field] ?? null) : null; },
    write(v) { const o = readJson(file) || {}; if (v === null || v === undefined) delete o[field]; else o[field] = v; mkdirSync(dirname(file), { recursive: true }); writeAtomic(file, JSON.stringify(o, null, 2) + '\n'); },
  };
}
// pointer = { read(): dataDir|null, write(dataDir, relayPub) }
export function jsonPointer(file) {
  const d = jsonFieldStore(file, 'dataDir'), k = jsonFieldStore(file, 'relayPub');
  return { read: () => d.read(), write(dir, pub) { const o = readJson(file) || {}; o.dataDir = dir; if (pub) o.relayPub = pub; mkdirSync(dirname(file), { recursive: true }); writeAtomic(file, JSON.stringify(o, null, 2) + '\n'); }, relayPub: () => k.read() };
}

// ── the move ───────────────────────────────────────────────────────────────────────────────────────────────
// opts: { from, to, pointer, journal, relayRunning: async () => bool, mode, mounts?, freeSpace?: p=>bytes,
//         rename?: (a,b)=>void (injectable so a test can force EXDEV), now?: ()=>Date, onProgress?, _afterCopy? }
// Returns { ok:true, mode:'rename'|'copy', journal } or { ok:false, code, detail? }. On ok:false the pointer is
// unchanged and `from` is exactly as it was.
export async function moveRelayData(opts) {
  const { pointer, journal } = opts;
  const from = resolve(opts.from), to = resolve(opts.to);
  const rename = opts.rename || renameSync;
  const now = opts.now || (() => new Date());
  const freeSpace = opts.freeSpace || freeBytes;
  const no = (code, detail) => ({ ok: false, code, ...(detail ? { detail } : {}) });

  const prev = journal.read();
  if (prev && ACTIVE.has(prev.state)) return no('move-in-progress', prev.state);
  if (typeof opts.relayRunning !== 'function') return no('relay-state-unknown');
  if (await opts.relayRunning()) return no('relay-running');
  const cur = pointer.read();
  if (cur && resolve(cur) !== from) return no('not-current-folder', cur);
  if (!existsSync(from)) return no('source-missing');
  if (existsSync(join(from, MOVED_TO))) return no('source-moved');
  const relayPub = keyPubOf(from);
  if (!relayPub) return no('source-has-no-key');
  const stamp = readJson(join(from, STAMP));
  if (stamp && stamp.relayPub && stamp.relayPub !== relayPub) return no('source-foreign');
  if (hasSymlink(from)) return no('source-has-symlink');
  if (from === to || under(to, from) || under(from, to)) return no('target-overlaps-source');
  if (basename(to) !== LEAF) return no('target-not-fixed-leaf');
  if (!existsSync(dirname(to))) return no('drive-missing');
  if (existsSync(to)) {
    if (lstatSync(to).isSymbolicLink() || !lstatSync(to).isDirectory()) return no('target-not-empty');
    if (readdirSync(to).length) return no('target-not-empty');
  }
  const mounts = opts.mounts !== undefined ? opts.mounts : systemMounts();
  const m = mounts ? mountFor(dirname(to), mounts) : null;
  const cls = classifyTarget({ path: to, fsType: m && m.fsType, mountOptions: m && m.options, mode: opts.mode, codeDir: opts.codeDir });
  if (!cls.eligible) return no('target-ineligible', cls.refuse.join(','));

  const walErr = await foldWal(from);
  if (walErr) return no(walErr);
  let counts; try { counts = await countRows(from); } catch { return no('database-unreadable'); }
  const base = { from, to, relayPub, counts, warn: cls.warn, startedAt: now().toISOString() };

  // 1. same volume: one atomic rename
  journal.write({ ...base, state: 'renaming', mode: 'rename' });
  let removedEmpty = false;
  if (existsSync(to)) { rmdirSync(to); removedEmpty = true; }        // empty (checked above); Windows can't rename onto one
  try {
    rename(from, to);
  } catch (e) {
    if (!e || e.code !== 'EXDEV') {
      if (removedEmpty) { try { mkdirSync(to); } catch {} }
      journal.write({ ...base, state: 'failed', mode: 'rename', code: 'rename-failed', detail: String(e && e.code || e), endedAt: now().toISOString() });
      return no('rename-failed', String(e && e.code || e));
    }
    return copyMove(opts, base, { from, to, relayPub, counts, now, freeSpace });
  }
  // renamed — switch the pointer; on any failure rename back
  try {
    journal.write({ ...base, state: 'switching', mode: 'rename' });
    if (keyPubOf(to) !== relayPub) throw new Error('key changed in rename');
    writeAtomic(join(to, STAMP), JSON.stringify({ relayPub, stampedAt: now().toISOString() }) + '\n');
    pointer.write(to, relayPub);
  } catch (e) {
    try { if (!existsSync(from)) rename(to, from); } catch {}
    try { pointer.write(from, relayPub); } catch {}
    journal.write({ ...base, state: 'failed', mode: 'rename', code: 'switch-failed', detail: String(e && e.message || e), endedAt: now().toISOString() });
    return no('switch-failed', String(e && e.message || e));
  }
  const j = { ...base, state: 'switched', mode: 'rename', oldCopy: null, switchedAt: now().toISOString() };
  journal.write(j);
  return { ok: true, mode: 'rename', journal: j };
}

async function copyMove(opts, base, { from, to, relayPub, counts, now, freeSpace }) {
  const { pointer, journal } = opts;
  const fail = (code, detail) => {
    // a copy is only ever deleted while it carries the incomplete marker
    try { if (existsSync(join(to, MARK_INCOMPLETE))) rmSync(to, { recursive: true, force: true }); } catch {}
    journal.write({ ...base, state: 'failed', mode: 'copy', code, ...(detail ? { detail } : {}), endedAt: now().toISOString() });
    return { ok: false, code, ...(detail ? { detail } : {}) };
  };
  let files; try { files = listFiles(from); } catch (e) { return fail('source-unreadable', String(e && e.code || e)); }
  const total = files.reduce((a, f) => a + f.size, 0);
  const need = Math.ceil(total * 1.1) + SPACE_MARGIN;
  let free; try { free = freeSpace(dirname(to)); } catch { free = -1; }
  if (!(free >= need)) return fail('not-enough-space', `need ${need}, free ${free}`);

  journal.write({ ...base, state: 'copying', mode: 'copy', totalBytes: total, copiedBytes: 0 });
  try {
    mkdirSync(to, { recursive: false });
  } catch (e) { if (!(e && e.code === 'EEXIST' && readdirSync(to).length === 0)) return fail('target-unwritable', String(e && e.code || e)); }
  try {
    writeFileSync(join(to, MARK_INCOMPLETE), 'A relay data move did not finish. This folder is safe to delete.\n');
    let done = 0, last = 0;
    for (const f of files) {
      mkdirSync(dirname(join(to, f.rel)), { recursive: true });
      copyFileSync(join(from, f.rel), join(to, f.rel), FS.COPYFILE_FICLONE);
      done += f.size;
      if (done - last > 64 * 1024 * 1024) { last = done; journal.write({ ...base, state: 'copying', mode: 'copy', totalBytes: total, copiedBytes: done }); if (opts.onProgress) opts.onProgress(done, total); }
    }
  } catch (e) { return fail(e && e.code === 'EPERM' ? 'target-permission-denied' : 'copy-failed', String(e && e.code || e)); }
  if (opts._afterCopy) await opts._afterCopy(to);

  // verify: same file list + sizes, same bytes, a sound database with the same rows, the same identity key
  journal.write({ ...base, state: 'verifying', mode: 'copy', totalBytes: total, copiedBytes: total });
  let got; try { got = listFiles(to); } catch { return fail('verify-failed', 'list'); }
  if (JSON.stringify(got) !== JSON.stringify(files)) return fail('verify-failed', 'file list or sizes differ');
  for (const f of files) {
    let a, b;
    try { [a, b] = await Promise.all([sha256(join(from, f.rel)), sha256(join(to, f.rel))]); } catch { return fail('verify-failed', 'read ' + f.rel); }
    if (a !== b) return fail('verify-failed', 'content differs: ' + f.rel);
  }
  if (!(await integrityOk(to))) return fail('verify-failed', 'database integrity');
  let c2; try { c2 = await countRows(to, { readOnly: true }); } catch { return fail('verify-failed', 'database unreadable'); }
  if (JSON.stringify(c2) !== JSON.stringify(counts)) return fail('verify-failed', 'row counts differ');
  if (keyPubOf(to) !== relayPub) return fail('verify-failed', 'identity key differs');
  // the integrity open may leave side files; the copy must not carry a WAL it was not verified with
  for (const s of ['relay.sqlite-wal', 'relay.sqlite-shm']) { try { rmSync(join(to, s), { force: true }); } catch {} }

  // permissions (no-ops on exFAT/FAT — flagged to the UI as 'no-permissions')
  try { chmodSync(to, 0o700); } catch {}
  for (const s of ['admin.json', 'relay-key.json', 'vapid.json', 'release-key.pem']) { try { if (existsSync(join(to, s))) chmodSync(join(to, s), 0o600); } catch {} }

  // mark and switch
  journal.write({ ...base, state: 'switching', mode: 'copy', totalBytes: total });
  try {
    writeAtomic(join(to, STAMP), JSON.stringify({ relayPub, stampedAt: now().toISOString() }) + '\n');
    rmSync(join(to, MARK_INCOMPLETE), { force: true }); fsyncDir(to);
    pointer.write(to, relayPub);
  } catch (e) {
    try { pointer.write(from, relayPub); } catch {}
    try { writeFileSync(join(to, MARK_INCOMPLETE), 'switch failed\n'); } catch {}
    return fail('switch-failed', String(e && e.message || e));
  }
  const since = now().toISOString();
  try { writeAtomic(join(from, MOVED_TO), movedNote(to, since)); } catch {}   // recoverMove re-writes it if this is lost
  const j = { ...base, state: 'switched', mode: 'copy', totalBytes: total, oldCopy: { path: from, since }, switchedAt: since };
  journal.write(j);
  return { ok: true, mode: 'copy', journal: j };
}
function movedNote(to, when) { return `This relay's data moved to ${to} on ${when}. This old copy must not be started.\n`; }

// ── after the launcher restarts the relay ─────────────────────────────────────────────────────────────────
// observed = { relayPub (PROVEN by the launcher via /relay-identity, never the bare /status string), counts }.
export function compareAfterRestart(j, observed) {
  const bad = [];
  if (!observed || observed.relayPub !== j.relayPub) bad.push('relay-key');
  if (j.counts && JSON.stringify(observed && observed.counts) !== JSON.stringify(j.counts)) bad.push('event-count');
  return bad;
}
export function beginCheck({ journal }) {
  const j = journal.read(); if (!j || !['switched', 'checking'].includes(j.state)) return null;
  const n = { ...j, state: 'checking', checkAttempts: (j.checkAttempts || 0) + 1 }; journal.write(n); return n;
}
export function checkPassed({ journal, now = () => new Date() }) {
  const j = journal.read(); if (!j || !['switched', 'checking'].includes(j.state)) return null;
  // copy: the old copy stays until the steward removes it (never automatic); rename: there is no old copy
  const n = { ...j, state: j.mode === 'copy' ? 'awaiting-confirm' : 'done', checkedAt: now().toISOString() };
  journal.write(n); return n;
}

// Roll back a switched move (failed step-8 check). Idempotent: safe to re-run after being killed part-way.
export function rollbackMove({ journal, pointer, rename = renameSync, now = () => new Date() }) {
  const j = journal.read();
  if (!j || !['switching', 'switched', 'checking', 'rolling-back'].includes(j.state)) return { ok: false, code: 'nothing-to-roll-back' };
  journal.write({ ...j, state: 'rolling-back' });
  if (j.mode === 'rename') {
    if (existsSync(j.to) && !existsSync(j.from)) rename(j.to, j.from);
    pointer.write(j.from, j.relayPub);
  } else {
    pointer.write(j.from, j.relayPub);
    try { rmSync(join(j.from, MOVED_TO), { force: true }); } catch {}
    if (existsSync(j.to)) {
      const aside = j.to + '-failed-' + now().toISOString().replace(/[:.]/g, '-');
      try { rename(j.to, aside); } catch {}
    }
  }
  const n = { ...j, state: 'rolled-back', endedAt: now().toISOString() };
  journal.write(n);
  return { ok: true, dataDir: j.from, journal: n };
}

// ── recovery: run by the launcher BEFORE starting the relay, every start ──────────────────────────────────
// Returns { dataDir, action: 'none'|'check', note }. 'check' = start the relay on dataDir and run the step-8 check
// (beginCheck / compareAfterRestart / checkPassed or rollbackMove). Never deletes a folder without the incomplete
// marker; never returns a folder that is not a complete relay of the recorded key.
export function recoverMove({ journal, pointer, rename = renameSync, now = () => new Date() }) {
  const j = journal.read();
  const cur = () => pointer.read();
  if (!j || !ACTIVE.has(j.state)) return { dataDir: cur(), action: 'none' };
  const failed = (note, extra = {}) => { journal.write({ ...j, state: 'failed', code: 'interrupted', note, ...extra, endedAt: now().toISOString() }); return { dataDir: j.from, action: 'none', note }; };

  if (j.state === 'rolling-back') { const r = rollbackMove({ journal, pointer, rename, now }); return { dataDir: r.dataDir || j.from, action: 'none', note: 'finished rolling back' }; }
  if (j.state === 'renaming') {
    if (!existsSync(j.from) && existsSync(j.to) && keyPubOf(j.to) === j.relayPub) { rename(j.to, j.from); return failed('renamed back'); }
    return failed('nothing moved');
  }
  if (j.state === 'copying' || j.state === 'verifying') {
    if (existsSync(join(j.to, MARK_INCOMPLETE))) { try { rmSync(j.to, { recursive: true, force: true }); } catch {} return failed('partial copy removed'); }
    return failed('no partial copy found');
  }
  if (j.state === 'switching') {
    const p = cur();
    if (p && resolve(p) === resolve(j.to) && keyPubOf(j.to) === j.relayPub) {
      // the switch happened; finish it
      const since = now().toISOString();
      let oldCopy = null;
      if (j.mode === 'copy' && existsSync(j.from)) { try { if (!existsSync(join(j.from, MOVED_TO))) writeAtomic(join(j.from, MOVED_TO), movedNote(j.to, since)); } catch {} oldCopy = { path: j.from, since }; }
      journal.write({ ...j, state: 'switched', oldCopy, switchedAt: since });
      return { dataDir: j.to, action: 'check', note: 'finished the switch' };
    }
    if (j.mode === 'rename') {
      if (!existsSync(j.from) && existsSync(j.to)) rename(j.to, j.from);
      try { pointer.write(j.from, j.relayPub); } catch {}
      return failed('renamed back');
    }
    // a verified copy that never became current: kept, set aside so a retry can use the fixed folder name
    let aside = null;
    if (existsSync(j.to)) {
      if (existsSync(join(j.to, MARK_INCOMPLETE))) { try { rmSync(j.to, { recursive: true, force: true }); } catch {} }
      else { aside = j.to + '-interrupted-' + now().toISOString().replace(/[:.]/g, '-'); try { rename(j.to, aside); } catch { aside = j.to; } }
    }
    return failed('switch did not happen; copy kept', aside ? { leftover: aside } : {});
  }
  // switched / checking: the pointer is the new folder
  if (j.mode === 'copy' && existsSync(j.from) && !existsSync(join(j.from, MOVED_TO))) { try { writeAtomic(join(j.from, MOVED_TO), movedNote(j.to, (j.oldCopy && j.oldCopy.since) || now().toISOString())); } catch {} }
  if (j.state === 'checking' && (j.checkAttempts || 0) >= 2) {
    const r = rollbackMove({ journal, pointer, rename, now });
    return { dataDir: r.dataDir || j.from, action: 'none', note: 'check did not finish twice; rolled back' };
  }
  return { dataDir: j.to, action: 'check', note: j.state === 'checking' ? 're-running the check' : 'run the check' };
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────────────
//   node scripts/relay-move.mjs move     --from DIR --drive MOUNT --pointer FILE [--journal FILE] --port N [--mode suite|server]
//   node scripts/relay-move.mjs recover  --pointer FILE [--journal FILE]
//   node scripts/relay-move.mjs rollback --pointer FILE [--journal FILE]
//   node scripts/relay-move.mjs classify --path DIR [--mode suite|server]
// Prints one JSON object. Exit 0 = ok, 2 = refused / failed safely, 1 = usage or unexpected error.
function portOpen(port) {
  return new Promise(res => { const s = createConnection({ host: '127.0.0.1', port }); const done = v => { try { s.destroy(); } catch {} res(v); }; s.once('connect', () => done(true)); s.once('error', () => done(false)); setTimeout(() => done(true), 3000); });
}
async function cli(argv) {
  const cmd = argv[0]; const a = {};
  for (let i = 1; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  const store = () => { if (!a.pointer) throw new Error('--pointer required'); const jf = a.journal || a.pointer; return { pointer: jsonPointer(a.pointer), journal: jsonFieldStore(jf, 'move') }; };
  if (cmd === 'move') {
    if (!a.from || !a.drive || !a.port) throw new Error('move needs --from, --drive and --port');
    const port = Number(a.port);
    return moveRelayData({ ...store(), from: a.from, to: targetFor(a.drive), mode: a.mode, relayRunning: () => portOpen(port) });
  }
  if (cmd === 'recover') return recoverMove(store());
  if (cmd === 'rollback') return rollbackMove(store());
  if (cmd === 'classify') { const ms = systemMounts(); const m = ms && mountFor(a.path, ms); let free; try { free = freeBytes(a.path); } catch {} return { mount: m, free, ...classifyTarget({ path: resolve(a.path), fsType: m && m.fsType, mountOptions: m && m.options, mode: a.mode }) }; }
  throw new Error('usage: relay-move.mjs move|recover|rollback|classify …');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).then(r => { console.log(JSON.stringify(r)); process.exit(r && r.ok === false ? 2 : 0); },
    e => { console.error(String(e && e.message || e)); process.exit(1); });
}
