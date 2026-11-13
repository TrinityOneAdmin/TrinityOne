// RELAY DATA MOVE — relay storage plan step 2 (TrinityOne-internal/reference/PLAN-relay-storage-location-2026-11-12.html,
// §3 as amended by the owner's §8a of 2026-11-13; hardened after Audit A of a32084f4). A pure module plus a CLI.
// NOTHING CALLS IT YET: the gateway request (step 3), the panel (step 4), the Suite launcher (step 5) and the server
// root helper (step 6) come later.
//
// The relay must be STOPPED before any of this runs (the caller's check, plus the gateway's .relay-lock). The mover
// never starts or stops a relay; the launcher does, and runs the step-8 check: beginCheck() BEFORE it spawns the
// relay on the new folder (exact row counts — nothing has run there yet), compareAfterRestart() after (proven key;
// counts may only have grown, because a live relay takes writes at once), then checkPassed() or rollbackMove().
//
// SAME VOLUME  -> one atomic rename (owner, §8a), then an EMPTY folder holding only MOVED-TO is left at the old path,
//                 so anything that still starts a relay there is refused (step 1) instead of minting a stranger.
//                 No old copy exists; rollback = remove that tombstone and rename back.
// CROSS VOLUME -> rename fails with EXDEV and nothing has changed; then fold the WAL, copy every file, fsync, verify
//                 every byte + the database, and only then flip the pointer. The old folder is kept, marked MOVED-TO,
//                 never auto-deleted; journal.oldCopy.since records when it became the old copy (7-day reminder).
//
// THE POINTER DECIDES. The pointer (which folder the launcher starts the relay on) and the journal (move state) live
// OUTSIDE both data folders and are injected as {read, write} objects. Recovery never hands back a folder other than
// the one the pointer names; if that folder is unreadable (drive unplugged) it says "do not start" instead.
import {
  readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync, rmSync, lstatSync, statSync,
  statfsSync, copyFileSync, openSync, fsyncSync, closeSync, chmodSync, rmdirSync, createReadStream, realpathSync,
  constants as FS,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname, basename, parse as parsePath } from 'node:path';
import { execFileSync, execFile } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';

// The fixed folder name created on the chosen drive (owner §8a: a drive from a list, never a typed path).
export const LEAF = 'trinityone-relay';
export const MARK_INCOMPLETE = '.trinity-move-incomplete';
export const STAMP = '.trinity-data-dir';
export const MOVED_TO = 'MOVED-TO';
// Not carried by a COPY (same list as the backup's excludes, gateway.mjs, plus the side files of a folded WAL and
// this feature's own files). A RENAME carries everything, so it needs no list.
export const SKIP = new Set(['.restore-pending', '.bundle-cache', 'cloudflared.log', 'rejected.log', 'rejected.log.1',
  'relay-launch.log', 'relay.sqlite-shm', 'relay.sqlite-wal', '.move-request', '.remove-old-request', '.relay-lock', MARK_INCOMPLETE]);
const SPACE_MARGIN = 512 * 1024 * 1024;
// A check interrupted twice is rolled back automatically only inside this window after the first check began, and
// only if the new folder has not taken writes since (audit A #15).
export const CHECK_WINDOW_MS = 10 * 60 * 1000;
// States in which a move is under way and recoverMove() has work to do.
export const ACTIVE = new Set(['renaming', 'copying', 'verifying', 'switching', 'switched', 'checking', 'rolling-back']);

// ── paths, per platform ────────────────────────────────────────────────────────────────────────────────────
// macOS and Windows filesystems are case-insensitive by default; Windows takes either slash.
const foldCase = pf => pf === 'win32' || pf === 'darwin';
function pkey(p, pf) { let s = String(p); if (pf === 'win32') s = s.replace(/\//g, '\\'); return foldCase(pf) ? s.toLowerCase() : s; }
function underP(p, root, pf = process.platform) {
  const S = pf === 'win32' ? '\\' : '/';
  const a = pkey(p, pf), b = pkey(root, pf);
  return a === b || a.startsWith(b.endsWith(S) ? b : b + S);
}
export function samePath(a, b, pf = process.platform) { return !!a && !!b && pkey(resolve(a), pf) === pkey(resolve(b), pf); }

// ── drive eligibility ──────────────────────────────────────────────────────────────────────────────────────
// Refused (§2): network filesystems (SQLite WAL needs shared memory, sqlite.org/wal.html), sync-client folders
// (SQLite under a sync client corrupts and uploads), system folders. ALLOWED WITH A WARNING (owner §8a):
// filesystems without permissions — the UI must show a strong warning, so it is returned as a code, not a refusal.
const NETWORK_FS = new Set(['nfs', 'nfs4', 'cifs', 'smb', 'smb2', 'smb3', 'smbfs', 'afpfs', 'webdav', 'davfs', 'fuse.davfs',
  'sshfs', 'fuse.sshfs', '9p', 'ceph', 'glusterfs', 'fuse.glusterfs', 'lustre', 'fuse.rclone', 'fuse.s3fs', 'afs']);
const NO_PERMS_FS = new Set(['exfat', 'fuse.exfat', 'vfat', 'msdos', 'fat', 'fat32', 'ntfs', 'ntfs3', 'fuseblk', 'fuse.ntfs-3g']);
const SYNC_RE = /(^|[\\/])(OneDrive[^\\/]*|Dropbox[^\\/]*|Google Drive[^\\/]*|GoogleDrive[^\\/]*|Mobile Documents|CloudStorage|iCloud Drive[^\\/]*|iCloudDrive|Box Sync|pCloud Drive|MEGAsync|Nextcloud|ownCloud)([\\/]|$)/i;
const SYSTEM_POSIX = ['/etc', '/usr', '/boot', '/proc', '/sys', '/dev', '/root', '/var/log', '/bin', '/sbin', '/lib', '/lib64', '/System', '/Library', '/private/etc', '/private/var'];
const SYSTEM_WIN = /^[a-z]:\\(windows|program files|program files \(x86\)|programdata|\$recycle\.bin|system volume information|recovery|boot)(\\|$)/i;

// classifyTarget: pure. info = { path, fsType, mountOptions:[...], free, need, mode:'suite'|'server', codeDir, platform }
// Returns { eligible, refuse:[codes], warn:[codes] }.
export function classifyTarget(info) {
  const refuse = [], warn = [];
  const pf = info.platform || process.platform;
  const p = String(info.path || '');
  const fs = String(info.fsType || '').toLowerCase();
  const opts = (info.mountOptions || []).map(o => String(o).toLowerCase());
  const win = pf === 'win32' || /^[a-z]:[\\/]/i.test(p) || /^\\\\/.test(p);
  if (/^\\\\/.test(p) || /^\/\/[^/]/.test(p)) refuse.push('network');          // UNC / smb:// style
  else if (NETWORK_FS.has(fs)) refuse.push('network');
  if (SYNC_RE.test(p)) refuse.push('sync-folder');
  if (win) {
    if (SYSTEM_WIN.test(p.replace(/\//g, '\\'))) refuse.push('system-folder');
  } else if (p.startsWith('/')) {
    if (SYSTEM_POSIX.some(r => underP(p, r, pf)) || (underP(p, '/run', pf) && !underP(p, '/run/media', pf))) refuse.push('system-folder');
    if (info.mode === 'server' && underP(p, '/home', pf)) refuse.push('system-folder');
  }
  if (info.codeDir && underP(p, info.codeDir, win ? 'win32' : pf)) refuse.push('inside-app');
  if (typeof info.free === 'number' && typeof info.need === 'number' && info.free < info.need) refuse.push('not-enough-space');
  if (NO_PERMS_FS.has(fs) || opts.includes('noowners')) warn.push('no-permissions');
  if (p.startsWith('/media/') || p.startsWith('/run/media/') || p.startsWith('/Volumes/') || opts.includes('removable')) warn.push('removable');
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
// Windows: Win32_LogicalDisk plus each letter's disk BusType (Get-Partition -> Get-Disk; built-in Storage module,
// no native code). Most USB SSDs/HDDs report DriveType 3 (fixed), so the bus is what says "USB" (audit B L-6).
// NOT RUN ON WINDOWS YET — a step-7 device check: confirm a USB SSD comes back BusType "USB" (or 7).
const WIN_DISKS_PS = "$b=@{}; try { Get-Partition -ErrorAction Stop | Where-Object { $_.DriveLetter } | ForEach-Object { $b[[string]$_.DriveLetter] = [string](Get-Disk -Number $_.DiskNumber).BusType } } catch {}; "
  + "Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,DriveType,FileSystem,ProviderName,@{n='BusType';e={$b[[string]$_.DeviceID.Substring(0,1)]}} | ConvertTo-Json -Compress";
// Windows rows: DeviceID, DriveType (4 = network, 2 = removable), FileSystem, ProviderName, BusType.
// DriveType 4 = network (a MAPPED drive letter), 2 = removable. Pure. (A `subst` drive is not distinguishable here.)
export function parseWinLogicalDisks(json) {
  let rows; try { rows = JSON.parse(String(json || '')); } catch { return []; }
  if (!Array.isArray(rows)) rows = rows ? [rows] : [];
  return rows.filter(r => r && /^[A-Za-z]:$/.test(r.DeviceID || '')).map(r => ({
    mountpoint: r.DeviceID.toUpperCase() + '\\',
    fsType: Number(r.DriveType) === 4 ? 'smb' : String(r.FileSystem || '').toLowerCase(),
    source: r.ProviderName || '',
    options: (Number(r.DriveType) === 2 || /^(usb|7)$/i.test(String(r.BusType || ''))) ? ['removable'] : [],
  }));
}
// The mount holding path p (longest mountpoint prefix).
export function mountFor(p, mounts, pf = process.platform) {
  let best = null;
  for (const m of mounts || []) if (m.mountpoint === '/' || underP(p, m.mountpoint, pf)) { if (!best || m.mountpoint.length > best.mountpoint.length) best = m; }
  return best;
}
export function systemMounts() {
  try {
    if (process.platform === 'linux') return parseMountinfo(readFileSync('/proc/self/mountinfo', 'utf8'));
    if (process.platform === 'darwin') return parseMacMount(execFileSync('mount', [], { encoding: 'utf8', timeout: 5000 }));
    if (process.platform === 'win32') return parseWinLogicalDisks(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      WIN_DISKS_PS], { encoding: 'utf8', timeout: 15000, windowsHide: true }));
  } catch {}
  return null;
}
// The same lookup without blocking: the gateway serves the drive list from a live server, where `mount` or a cold
// PowerShell start (up to 15 s) must not stall the event loop (audit C C8 / audit D: a step-3 obligation).
export async function systemMountsAsync(pf = process.platform) {
  const run = (cmd, args, timeout) => new Promise((res, rej) => execFile(cmd, args, { encoding: 'utf8', timeout, windowsHide: true }, (e, out) => e ? rej(e) : res(out)));
  try {
    if (pf === 'linux') { const { readFile } = await import('node:fs/promises'); return parseMountinfo(await readFile('/proc/self/mountinfo', 'utf8')); }
    if (pf === 'darwin') return parseMacMount(await run('mount', [], 5000));
    if (pf === 'win32') return parseWinLogicalDisks(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      WIN_DISKS_PS], 15000));
  } catch {}
  return null;
}
// Linux: is the block device behind a mount removable or on USB? (audit B L-6: a USB disk mounted outside /media —
// an fstab /mnt mount, say — must still get the wear warning.) /sys/class/block/<dev> resolves to a path under
// /sys/devices that contains a "/usb" component for anything on a USB bus; a partition's parent disk carries
// `removable`. Never throws; false when it cannot tell. `source` is the mount's source, e.g. /dev/sdb1.
export async function blockDeviceIsUsbOrRemovable(source) {
  try {
    const m = /^\/dev\/([A-Za-z0-9._-]+)$/.exec(String(source || '')); if (!m) return false;
    const fsp = await import('node:fs/promises');
    const dev = await fsp.realpath('/sys/class/block/' + m[1]);
    if (/\/usb\d*\//.test(dev + '/')) return true;
    for (const f of [dev + '/removable', dirname(dev) + '/removable']) {
      try { if (String(await fsp.readFile(f, 'utf8')).trim() === '1') return true; } catch {}
    }
  } catch {}
  return false;
}
export function freeBytes(p) {
  let q = resolve(p);
  while (!existsSync(q) && dirname(q) !== q) q = dirname(q);
  const s = statfsSync(q); return Number(s.bavail) * Number(s.bsize);
}
export function targetFor(mountpoint) { return join(mountpoint, LEAF); }
// Does any component of p (an absolute path) resolve through a symlink? macOS's own fixed links (/var, /tmp, /etc
// -> /private/…) are allowed; nothing else is (audit A #4: a symlinked "drive" defeated every refusal).
const DARWIN_OS_LINKS = new Set(['/var', '/tmp', '/etc']);
export function pathHasSymlink(p, pf = process.platform) {
  const abs = resolve(p); const root = parsePath(abs).root;
  let cur = root;
  for (const part of abs.slice(root.length).split(/[\\/]+/).filter(Boolean)) {
    cur = join(cur, part);
    let st; try { st = lstatSync(cur); } catch { return false; }   // the rest does not exist yet
    if (st.isSymbolicLink() && !(pf === 'darwin' && DARWIN_OS_LINKS.has(cur))) return true;
  }
  return false;
}

// ── small helpers ──────────────────────────────────────────────────────────────────────────────────────────
function fsyncDir(d) { try { const fd = openSync(d, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } } catch {} }
// fsync a file or directory so it is on the medium, not only in the page cache (audit A #3). Windows cannot open a
// directory, and needs a writable handle to flush a file; both are tried.
export function fsyncPath(p) {
  let fd;
  try { fd = openSync(p, 'r+'); } catch { try { fd = openSync(p, 'r'); } catch { return false; } }
  try { fsyncSync(fd); return true; } catch { return false; } finally { try { closeSync(fd); } catch {} }
}
export function writeAtomic(file, text) {
  const tmp = file + '.tmp-' + process.pid;
  const fd = openSync(tmp, 'w');
  try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, file); fsyncDir(dirname(file));
}
const readJson = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
// The gateway writes <dir>/.relay-lock {pid, startedAt} at start-up (audit A #10); relayLockHeld() below decides.
// The command line and start time of a live pid, ASYNC so a server caller's event loop is never blocked by a cold
// PowerShell start (audit C C8). Linux: /proc + `ps -o lstart=`; macOS: `ps -ww` (without -ww BSD ps cuts the line
// to the terminal width or 79 columns, which could hide "gateway.mjs" behind a long app path — audit C C2);
// Windows: Win32_Process via PowerShell. Any value can be null = unknown. NOT run on a real Mac or Windows yet.
const execFileP = (cmd, args, timeout) => new Promise(res => execFile(cmd, args, { encoding: 'utf8', timeout, windowsHide: true }, (e, out) => res(e ? null : out)));
export async function processInfo(pid, pf = process.platform, run = execFileP) {
  pid = Number(pid);
  if (pf === 'win32') {
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { $p.CreationDate.ToUniversalTime().ToString('o'); $p.CommandLine }`], 15000);
    if (!out) return { commandLine: null, startedAt: null };
    const [first, ...rest] = out.split(/\r?\n/);
    return { commandLine: rest.join(' ').trim() || null, startedAt: Date.parse(first) || null };
  }
  let commandLine = null;
  if (pf === 'linux') { try { commandLine = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' '); } catch {} }
  if (commandLine === null) commandLine = await run('ps', ['-ww', '-p', String(pid), '-o', 'command='], 5000);
  const lstart = await run('ps', ['-p', String(pid), '-o', 'lstart='], 5000);
  return { commandLine: commandLine === null ? null : String(commandLine).trim(), startedAt: lstart ? (Date.parse(lstart.trim()) || null) : null };
}
// Held = the pid is alive and its command line runs gateway.mjs — WHATEVER the start time says (audit D D-1: Linux
// ps recomputes a start time from the current clock, so after a clock step a live relay's start looks later than its
// lock; a gateway that reused the pid only makes the move wait, which is safe). The start time is used only to rule
// out a pid reused by a NON-gateway process when the command line is ambiguous. Unknown counts as held (refusing a
// move is safe; moving a live relay's folder is not), and so, on macOS only, does a node command line long enough to
// have been cut short by BSD ps (Linux /proc and Windows are never truncated — D-4). The gateway itself never reads
// the lock, so it can never stop a relay from starting.
const START_SLACK_MS = 5000;   // ps lstart has 1 s resolution; clocks and the lock write add a little
export async function relayLockHeld(dir, { platform = process.platform, info = processInfo } = {}) {
  const l = readJson(join(dir, '.relay-lock'));
  const pid = l && Number(l.pid);
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;   // -1 / 0 / 1.5 are not a process (audit E E-6)
  try { process.kill(pid, 0); } catch (e) { if (!e || e.code !== 'EPERM') return false; }
  const p = await info(pid, platform) || {};
  const cmd = p.commandLine;
  if (cmd !== null && cmd !== undefined && /gateway\.mjs/.test(cmd)) return true;
  const lockAt = l && Date.parse(l.startedAt);
  // a later, NON-gateway process — but on Linux an unknown command line with a known (clock-recomputed) start time
  // proves nothing, so that case stays held (audit E E-2)
  if (p.startedAt && lockAt && p.startedAt > lockAt + START_SLACK_MS && !(platform === 'linux' && (cmd === null || cmd === undefined))) return false;
  if (cmd === null || cmd === undefined) return true;
  if (platform === 'darwin' && /node/i.test(cmd) && cmd.length >= 79) return true;   // possibly cut short by BSD ps
  return false;
}
export function keyPubOf(dir) { const k = readJson(join(dir, 'relay-key.json')); return (k && k.sk && k.pub) ? String(k.pub) : ''; }
// A folder the step-1 guard would start: this relay's key, no MOVED-TO, not a partial copy.
export function startable(dir, pub) {
  return !!dir && keyPubOf(dir) === pub && !existsSync(join(dir, MOVED_TO)) && !existsSync(join(dir, MARK_INCOMPLETE));
}
// What the step-1 gateway guard checks for a PINNED folder, judged on the folder's OWN identity (audit C C1): a usable
// key, no MOVED-TO, no incomplete marker, and a stamp (if any) naming that same key. Used outside an active move,
// where a restore of another relay's backup may legitimately have changed the identity since the journal was written.
export function gatewayWouldStart(dir) {
  const k = keyPubOf(dir);
  if (!k || existsSync(join(dir, MOVED_TO)) || existsSync(join(dir, MARK_INCOMPLETE))) return false;
  if (!existsSync(join(dir, STAMP))) return true;
  const st = readJson(join(dir, STAMP));
  return !!(st && st.relayPub === k);
}
// An empty folder holding only MOVED-TO: what a same-drive rename leaves at the old path.
// Also accepts an EMPTY folder or one holding only a half-written MOVED-TO.tmp-* (a kill while it was being made,
// audit B N2), so recovery can always clear it. It never holds data: the data is in the folder it names.
export function isTombstoneOnly(dir) {
  try { return readdirSync(dir).every(n => n === MOVED_TO || n.startsWith(MOVED_TO + '.tmp-')); } catch { return false; }
}
// Build a MOVED-TO-only folder at `dir` atomically (audit B N2): made in a sibling temp folder, then renamed into
// place, so `dir` is either absent or a complete tombstone — never an empty folder a launcher could start a
// stranger relay in. Both parents are fsynced.
export function makeTombstoneDir(dir, note, fsync = fsyncPath) {
  const tmp = dir + '.tombstone-tmp-' + process.pid;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp);
  writeAtomic(join(tmp, MOVED_TO), note);
  renameSync(tmp, dir);
  dirSynced(dirname(dir), fsync);
}
// directory fsync: Windows cannot open a directory, so only there is a failure tolerated (audit B N4)
function dirSynced(d, fsync = fsyncPath) {
  if (fsync(d) || process.platform === 'win32') return true;
  throw Object.assign(new Error('could not fsync ' + d), { code: 'ENOTDURABLE' });
}
export function hasSymlink(p) {
  let st; try { st = lstatSync(p); } catch { return false; }
  if (st.isSymbolicLink()) return true;
  if (st.isDirectory()) for (const c of readdirSync(p)) if (hasSymlink(join(p, c))) return true;
  return false;
}
// relative paths of every regular file under dir, skipping SKIP names at the top level
function listFiles(dir, rel = '', top = true, out = []) {
  for (const name of readdirSync(join(dir, rel)).sort()) {
    if (top && (SKIP.has(name) || /^(relay-key\.json|\.trinity-data-dir)\.tmp-\d+$/.test(name))) continue;   // a key temp holds a secret: never copied
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
// readOnly leaves empty -wal/-shm side files behind (it cannot remove them), so a folder no relay is running on is
// opened normally — the last connection's close removes them — and only the unverified copy is opened readOnly.
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
// counts comparison: exact, or (after a relay has run) every table at least what was recorded
function countsBad(rec, got, { atLeast = false } = {}) {
  if (!rec) return false;
  if (!got) return true;
  for (const k of Object.keys(rec)) {
    if (rec[k] === null) continue;
    if (got[k] === null || got[k] === undefined) return true;
    if (atLeast ? got[k] < rec[k] : got[k] !== rec[k]) return true;
  }
  return false;
}
function movedOn(rec, got) { return !!(rec && got && Object.keys(rec).some(k => rec[k] !== null && got[k] > rec[k])); }

// A {read, write} store for one field of a JSON file, written atomically. The Suite keeps pointer and journal in
// storage.json (fields dataDir/relayPub and move); tests and the CLI use the same shape.
export function jsonFieldStore(file, field) {
  return {
    read() { const o = readJson(file); return o ? (o[field] ?? null) : null; },
    write(v) { const o = readJson(file) || {}; if (v === null || v === undefined) delete o[field]; else o[field] = v; mkdirSync(dirname(file), { recursive: true }); writeAtomic(file, JSON.stringify(o, null, 2) + '\n'); },
  };
}
// pointer = { read(): dataDir|null, write(dataDir, relayPub), relayPub?(): pub|null — the identity the pointer expects;
//             optional, read through a try (a throwing pointer never makes recovery throw) }
export function jsonPointer(file) {
  const d = jsonFieldStore(file, 'dataDir'), k = jsonFieldStore(file, 'relayPub');
  return { read: () => d.read(), write(dir, pub) { const o = readJson(file) || {}; o.dataDir = dir; if (pub) o.relayPub = pub; mkdirSync(dirname(file), { recursive: true }); writeAtomic(file, JSON.stringify(o, null, 2) + '\n'); }, relayPub: () => k.read() };
}
const safeRead = pointer => { try { return { ok: true, v: pointer.read() }; } catch { return { ok: false, v: null }; } };

function movedNote(to, when) { return `This relay's data moved to ${to} on ${when}. This old copy must not be started.\n`; }
function asideNote(from, when, why) { return `This folder was set aside on ${when} after ${why}. The relay's data is in ${from}. Do not start a relay on this folder.\n`; }
const stamp = when => when.toISOString().replace(/[:.]/g, '-');
// Put a complete copy out of the way, tombstoned FIRST so it is never startable even if the rename fails.
// Leftovers (rename tombstones, set-aside copies) are recorded in journal.leftovers and carried across moves, so
// step 3 can list them and offer to remove them (audit B N8).
function withLeftover(j, path, kind, now) {
  const list = Array.isArray(j && j.leftovers) ? j.leftovers.filter(l => l && l.path !== path) : [];
  list.push({ path, kind, since: now().toISOString() });
  return list;
}
function setAside(dir, suffix, note, rename, now) {
  writeAtomic(join(dir, MOVED_TO), note);
  const aside = dir + '-' + suffix + '-' + stamp(now());
  rename(dir, aside);
  return aside;
}
// Undo a same-drive rename: remove the tombstone at `from` (only if that is all it holds), rename `to` back.
function undoRename(j, rename) {
  if (keyPubOf(j.to) !== j.relayPub) return startable(j.from, j.relayPub);
  if (existsSync(j.from)) { if (!isTombstoneOnly(j.from)) return false; rmSync(j.from, { recursive: true, force: true }); }
  rename(j.to, j.from);
  return startable(j.from, j.relayPub);
}

// ── the move ───────────────────────────────────────────────────────────────────────────────────────────────
// opts: { from, to, pointer, journal, relayRunning: async () => bool, mode, mounts?, freeSpace?: p=>bytes,
//         rename?: (a,b)=>void (injectable so a test can force EXDEV), now?: ()=>Date, codeDir?, platform?,
//         onProgress?, _afterCopy?, _fsync? }
// Returns { ok:true, mode:'rename'|'copy', journal } or { ok:false, code, detail? }. On ok:false the pointer names
// `from` and `from` is as it was — except code 'switch-uncertain', where the pointer could not be confirmed and
// everything is left for recoverMove(), which follows the pointer.
export async function moveRelayData(opts) {
  const { pointer, journal } = opts;
  const pf = opts.platform || process.platform;
  const from = resolve(opts.from);
  const rename = opts.rename || renameSync;
  const now = opts.now || (() => new Date());
  const freeSpace = opts.freeSpace || freeBytes;
  const no = (code, detail) => ({ ok: false, code, ...(detail ? { detail } : {}) });

  // THE REQUEST IS ONE-SHOT (audit B M-1). The gateway leaves <from>/.move-request for the launcher; it is consumed
  // here, before anything else — before any refusal, rename or copy — so a rename cannot carry it into the new
  // folder, a failed or refused move cannot leave it behind to be acted on at the next close, and a rollback (which
  // renames the folder back) has nothing to bring back. One request, one attempt.
  let names = []; try { names = readdirSync(from); } catch {}
  for (const n of names) if (n === '.move-request' || /^\.move-request\.tmp-\d+$/.test(n)) { try { rmSync(join(from, n), { force: true }); } catch {} }
  const prev = journal.read();
  if (prev && ACTIVE.has(prev.state)) return no('move-in-progress', prev.state);
  // one old copy at a time (audit A #14): "Remove old copy" deletes only the folder recorded as old, so a second
  // move must not overwrite that record while the first copy — cleartext church records — is still on disk.
  if (prev && prev.state === 'awaiting-confirm') return no('old-copy-awaiting-removal', prev.oldCopy && prev.oldCopy.path);
  if (typeof opts.relayRunning !== 'function') return no('relay-state-unknown');
  if (await opts.relayRunning()) return no('relay-running');
  const cur = pointer.read();
  if (cur && !samePath(cur, from, pf)) return no('not-current-folder', cur);
  if (!existsSync(from)) return no('source-missing');
  if (await relayLockHeld(from, { platform: pf })) return no('relay-running', 'a relay process still holds this folder');
  if (existsSync(join(from, MOVED_TO))) return no('source-moved');
  if (existsSync(join(from, '.restore-pending'))) return no('restore-pending');   // audit A #11: a copy would drop it
  const relayPub = keyPubOf(from);
  if (!relayPub) return no('source-has-no-key');
  const stampOnDisk = readJson(join(from, STAMP));
  if (stampOnDisk && stampOnDisk.relayPub && stampOnDisk.relayPub !== relayPub) return no('source-foreign');
  if (hasSymlink(from)) return no('source-has-symlink');
  if (basename(resolve(opts.to)) !== LEAF) return no('target-not-fixed-leaf');
  const driveDir = dirname(resolve(opts.to));
  if (!existsSync(driveDir)) return no('drive-missing');
  if (pathHasSymlink(driveDir, pf)) return no('target-path-has-symlink');
  let to; try { to = join(realpathSync(driveDir), LEAF); } catch { return no('drive-missing'); }
  if (samePath(from, to, pf) || underP(to, from, pf) || underP(from, to, pf)) return no('target-overlaps-source');
  if (existsSync(to)) {
    if (lstatSync(to).isSymbolicLink() || !lstatSync(to).isDirectory()) return no('target-not-empty');
    if (readdirSync(to).length && !isTombstoneOnly(to)) return no('target-not-empty');
  }
  const mounts = opts.mounts !== undefined ? opts.mounts : systemMounts();
  const m = mounts ? mountFor(dirname(to), mounts, pf) : null;
  const cls = classifyTarget({ path: to, fsType: m && m.fsType, mountOptions: m && m.options, mode: opts.mode, codeDir: opts.codeDir, platform: pf });
  if (!cls.eligible) return no('target-ineligible', cls.refuse.join(','));

  const walErr = await foldWal(from);
  if (walErr) return no(walErr);
  let counts; try { counts = await countRows(from); } catch { return no('database-unreadable'); }
  const base = { from, to, relayPub, counts, warn: cls.warn, startedAt: now().toISOString(), leftovers: (prev && Array.isArray(prev.leftovers)) ? prev.leftovers : [] };

  // 1. same volume: one atomic rename
  journal.write({ ...base, state: 'renaming', mode: 'rename' });
  let removedEmpty = false, oldNote = null;
  // POSIX renames onto an EMPTY folder, so only a stale tombstone (or Windows, which can't rename onto any) is cleared;
  // the server helper (step 6) pre-creates the leaf root-owned-parent, where the service user cannot rmdir it
  if (existsSync(to) && (pf === 'win32' || readdirSync(to).length)) {   // empty or a stale tombstone (checked above)
    try { oldNote = readFileSync(join(to, MOVED_TO), 'utf8'); } catch {}
    rmSync(to, { recursive: true, force: true }); removedEmpty = true;
  }
  try {
    rename(from, to);
  } catch (e) {
    if (!e || e.code !== 'EXDEV') {
      // audit C C4: a stale tombstone goes back as it was — never a bare empty folder a launcher could start in
      if (removedEmpty) { try { if (oldNote !== null) makeTombstoneDir(to, oldNote); else mkdirSync(to); } catch {} }
      journal.write({ ...base, state: 'failed', mode: 'rename', code: 'rename-failed', detail: String(e && e.code || e), endedAt: now().toISOString() });
      return no('rename-failed', String(e && e.code || e));
    }
    return copyMove(opts, base, { from, to, relayPub, counts, now, freeSpace, rename });
  }
  // renamed — make it durable, tombstone the old path, stamp, switch the pointer
  const fsync = opts._fsync || fsyncPath;
  try {
    dirSynced(dirname(to), fsync); dirSynced(dirname(from), fsync);          // audit B N4: the rename itself is durable
    makeTombstoneDir(from, movedNote(to, now().toISOString()), fsync);        // audit B N2: atomic, never an empty folder
    journal.write({ ...base, state: 'switching', mode: 'rename' });
    if (keyPubOf(to) !== relayPub) throw new Error('key changed in rename');
    writeAtomic(join(to, STAMP), JSON.stringify({ relayPub, stampedAt: now().toISOString() }) + '\n');
    pointer.write(to, relayPub);
  } catch (e) {
    const msg = String(e && e.message || e);
    try { pointer.write(from, relayPub); } catch {}
    const p = safeRead(pointer);
    if (!p.ok || !samePath(p.v || from, from, pf)) {
      // audit A #2: the pointer may name `to` — touch nothing; recovery follows the pointer
      journal.write({ ...base, state: 'switching', mode: 'rename', note: 'switch uncertain: ' + msg });
      return no('switch-uncertain', msg);
    }
    // audit B N1: the undo can fail too (e.g. a scanner holding the folder). Only a CONFIRMED undo ends the move;
    // otherwise the journal stays 'switching' and recovery retries the undo before anything starts.
    let undone = false; try { undone = undoRename({ from, to, relayPub }, rename); } catch {}
    if (!undone) {
      journal.write({ ...base, state: 'switching', mode: 'rename', note: 'switch failed, undo pending: ' + msg });
      return no('switch-failed-undo-pending', msg);
    }
    journal.write({ ...base, state: 'failed', mode: 'rename', code: 'switch-failed', detail: msg, endedAt: now().toISOString() });
    return no('switch-failed', msg);
  }
  const j = { ...base, state: 'switched', mode: 'rename', oldCopy: null, leftovers: withLeftover(base, from, 'tombstone', now), switchedAt: now().toISOString() };
  journal.write(j);
  return { ok: true, mode: 'rename', journal: j };
}

async function copyMove(opts, base, { from, to, relayPub, counts, now, freeSpace, rename }) {
  const { pointer, journal } = opts;
  const pf = opts.platform || process.platform;
  const fsync = opts._fsync || fsyncPath;
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
  const dirs = new Set([to]);
  try {
    writeFileSync(join(to, MARK_INCOMPLETE), 'A relay data move did not finish. This folder is safe to delete.\n');
    let done = 0, last = 0;
    for (const f of files) {
      const dst = join(to, f.rel);
      let d = dirname(dst); while (!dirs.has(d) && d.length > to.length) { dirs.add(d); d = dirname(d); }
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(join(from, f.rel), dst, FS.COPYFILE_FICLONE);
      done += f.size;
      if (done - last > 64 * 1024 * 1024) { last = done; journal.write({ ...base, state: 'copying', mode: 'copy', totalBytes: total, copiedBytes: done }); if (opts.onProgress) opts.onProgress(done, total); }
    }
    // durable before it is verified or switched to (audit A #3): every file, then every directory, deepest first
    // audit B N4: a failed fsync (EIO from a dying stick) fails the move; directory fsync is tolerated on Windows only
    for (const f of files) if (!fsync(join(to, f.rel))) return fail('copy-not-durable', f.rel);
    for (const d of [...dirs].sort((a, b) => b.length - a.length)) dirSynced(d, fsync);
    dirSynced(dirname(to), fsync);
  } catch (e) { return fail(e && e.code === 'EPERM' ? 'target-permission-denied' : e && e.code === 'ENOTDURABLE' ? 'copy-not-durable' : 'copy-failed', String(e && e.message || e)); }
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
  if (countsBad(counts, c2)) return fail('verify-failed', 'row counts differ');
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
    const msg = String(e && e.message || e);
    try { pointer.write(from, relayPub); } catch {}
    const p = safeRead(pointer);
    if (!p.ok || !samePath(p.v || from, from, pf)) {
      // audit A #2: the pointer may name the verified copy — never destroy it; recovery follows the pointer
      journal.write({ ...base, state: 'switching', mode: 'copy', totalBytes: total, note: 'switch uncertain: ' + msg });
      return { ok: false, code: 'switch-uncertain', detail: msg };
    }
    try { writeFileSync(join(to, MARK_INCOMPLETE), 'switch failed\n'); } catch {}
    return fail('switch-failed', msg);
  }
  const since = now().toISOString();
  try { writeAtomic(join(from, MOVED_TO), movedNote(to, since)); } catch {}   // recoverMove re-writes it if this is lost
  const j = { ...base, state: 'switched', mode: 'copy', totalBytes: total, oldCopy: { path: from, since }, switchedAt: since };
  journal.write(j);
  return { ok: true, mode: 'copy', journal: j };
}

// ── the step-8 check ──────────────────────────────────────────────────────────────────────────────────────
// beginCheck: the launcher calls it BEFORE it spawns the relay on the new folder. Nothing has run there yet on the
// first attempt, so the counts must be EXACTLY the recorded ones (audit A #5); on a re-check the relay has already
// run there, so they may only have grown. Returns { ok, bad:[...], journal }. Not ok -> rollbackMove().
export async function beginCheck({ journal, now = () => new Date() }) {
  const j = journal.read(); if (!j || !['switched', 'checking'].includes(j.state)) return { ok: false, bad: ['no-move-to-check'] };
  const attempts = (j.checkAttempts || 0) + 1;
  const bad = [];
  if (keyPubOf(j.to) !== j.relayPub) bad.push('relay-key');
  let c = null; try { c = await countRows(j.to); } catch {}
  if (countsBad(j.counts, c, { atLeast: attempts > 1 })) bad.push('event-count');
  const n = { ...j, state: 'checking', checkAttempts: attempts, firstCheckAt: j.firstCheckAt || now().toISOString(), preStartCounts: c };
  journal.write(n);
  return { ok: bad.length === 0, bad, journal: n };
}
// After the restart. observed = { relayPub PROVEN by the launcher via /relay-identity (never the bare /status
// string, rule 10), counts? }. A live relay takes writes and syncs from peers at once, so counts may only be >=.
export function compareAfterRestart(j, observed) {
  const bad = [];
  if (!observed || observed.relayPub !== j.relayPub) bad.push('relay-key');
  if (observed && observed.counts && countsBad(j.counts, observed.counts, { atLeast: true })) bad.push('event-count');
  return bad;
}
export function checkPassed({ journal, now = () => new Date() }) {
  const j = journal.read(); if (!j || !['switched', 'checking'].includes(j.state)) return null;
  // copy: the old copy stays until the steward removes it (never automatic); rename: there is no old copy
  const n = { ...j, state: j.mode === 'copy' ? 'awaiting-confirm' : 'done', checkedAt: now().toISOString() };
  journal.write(n); return n;
}

// Roll back a switched move (failed check). Idempotent: safe to re-run after being killed part-way. Order matters
// (audit A #9): the new folder is tombstoned and set aside BEFORE the old folder's MOVED-TO is removed, and a step
// that fails stops the rollback with the journal left at 'rolling-back' — never two startable folders.
export function rollbackMove({ journal, pointer, rename = renameSync, now = () => new Date() }) {
  const j = journal.read();
  if (!j || !['switching', 'switched', 'checking', 'rolling-back'].includes(j.state)) return { ok: false, code: 'nothing-to-roll-back' };
  journal.write({ ...j, state: 'rolling-back' });
  const blocked = (why) => ({ ok: false, code: 'rollback-blocked', detail: why });
  let aside = null;
  if (j.mode === 'rename') {
    let ok = false; try { ok = undoRename(j, rename); } catch (e) { return blocked(String(e && e.message || e)); }
    if (!ok) return blocked('the relay\'s data is not where the move left it');
    pointer.write(j.from, j.relayPub);
  } else {
    if (!startable(j.from, j.relayPub) && !(keyPubOf(j.from) === j.relayPub && existsSync(join(j.from, MOVED_TO)))) return blocked('the old copy is not intact');
    if (existsSync(j.to)) {
      try { aside = setAside(j.to, 'failed', asideNote(j.from, now().toISOString(), 'a relay data move was rolled back'), rename, now); }
      catch (e) { return blocked('could not set the new folder aside: ' + String(e && e.code || e)); }
    }
    pointer.write(j.from, j.relayPub);
    rmSync(join(j.from, MOVED_TO), { force: true });
  }
  const n = { ...j, state: 'rolled-back', ...(aside ? { leftover: aside, leftovers: withLeftover(j, aside, 'set-aside', now) } : {}), endedAt: now().toISOString() };
  journal.write(n);
  return { ok: true, dataDir: j.from, journal: n };
}

// The data has left j.from: make sure nothing can start a relay there. Copy: a MOVED-TO in the old copy (if its drive
// is connected). Rename: an atomic MOVED-TO-only folder if the path is empty. Best effort; re-run on every start.
// A kill while makeTombstoneDir was building leaves <from>.tombstone-tmp-<pid>. It holds no data: delete it when it
// holds only a tombstone and its pid is gone, otherwise record it as a leftover (audit C C6).
function sweepTombstoneTemps(j, journal, now) {
  let names; try { names = readdirSync(dirname(j.from)); } catch { return; }
  const pre = basename(j.from) + '.tombstone-tmp-';
  let rec = null;
  for (const n of names) {
    if (!n.startsWith(pre) || !/^\d+$/.test(n.slice(pre.length))) continue;   // only names makeTombstoneDir writes (D N-4)
    const p = join(dirname(j.from), n), pid = Number(n.slice(pre.length));
    // our own pid on a temp older than this process is a previous run's (audit E E-5, as the gateway's N-1)
    let alive = false;
    if (pid === process.pid) { try { alive = statSync(p).mtimeMs >= Date.now() - process.uptime() * 1000 - 1000; } catch {} }
    else if (pid) { try { process.kill(pid, 0); alive = true; } catch (e) { alive = !!(e && e.code === 'EPERM'); } }
    if (alive) continue;
    if (isTombstoneOnly(p)) { try { rmSync(p, { recursive: true, force: true }); } catch {} }
    else if (!(j.leftovers || []).some(l => l.path === p)) rec = withLeftover({ leftovers: rec || j.leftovers }, p, 'tombstone-temp', now);
  }
  if (rec) { j.leftovers = rec; journal.write(j); }
}
function ensureOldTombstoned(j, now) {
  const note = movedNote(j.to, (j.oldCopy && j.oldCopy.since) || now().toISOString());
  try {
    if (j.mode === 'copy') { if (existsSync(j.from) && !existsSync(join(j.from, MOVED_TO))) writeAtomic(join(j.from, MOVED_TO), note); }
    else if (!existsSync(j.from)) makeTombstoneDir(j.from, note);
    else if (isTombstoneOnly(j.from) && !existsSync(join(j.from, MOVED_TO))) writeAtomic(join(j.from, MOVED_TO), note);
  } catch {}
}

// ── recovery: run by the launcher BEFORE starting the relay, every start ──────────────────────────────────
// THE POINTER DECIDES (audit A #1). Returns one of:
//   { dataDir, action: 'none' }   start the relay on dataDir (always the folder the pointer names)
//   { dataDir, action: 'check' }  start it there and run the step-8 check
//   { dataDir: null, action: 'refuse', code, expected }  do NOT start: e.g. the pointer names a drive that is not
//                                  connected. The journal is left as it was, so the next start tries again.
// Never deletes a folder without the incomplete marker. In an active move the folder returned is checked against the
// pointer and against this relay's recorded key; outside one, against what the pinned gateway itself checks
// (gatewayWouldStart), since a restore may have changed the identity since the move.
export async function recoverMove({ journal, pointer, rename = renameSync, now = () => new Date(), platform }) {
  const pf = platform || process.platform;
  const j = journal.read();
  const pr = safeRead(pointer);
  if (!pr.ok) return { dataDir: null, action: 'refuse', code: 'pointer-unreadable' };
  const refuse = (code, expected) => ({ dataDir: null, action: 'refuse', code, ...(expected ? { expected } : {}) });
  if (!j) return { dataDir: pr.v, action: 'none' };
  if (!ACTIVE.has(j.state)) {
    // A past move is recorded: the folder the pointer names must still be one the gateway would start (audit B N1),
    // and the folder the data LEFT must not be (audit B N3 — re-tombstoned here, outside the active states too).
    // Judged as the gateway judges it — NOT against the journal's relayPub: a restore of another relay's backup
    // after the move is a supported flow and changes the identity (audit C C1).
    const dir = pr.v || j.from;
    if (j.relayPub && !gatewayWouldStart(dir)) return refuse(keyPubOf(dir) ? 'folder-not-startable' : 'drive-missing', dir);
    if (j.mode === 'rename') sweepTombstoneTemps(j, journal, now);
    // Re-tombstone the recorded old copy while it still awaits removal (audit C C3: a 'done' rename tombstone the
    // steward removed is not re-created) — whatever identity the new folder holds now: the old copy still holds the
    // data that moved, so a later restore elsewhere does not make it safe to start (audit D D-3).
    if (j.state === 'awaiting-confirm' && j.to && samePath(dir, j.to, pf) && j.from && !samePath(j.from, j.to, pf)) ensureOldTombstoned(j, now);
    // The folder is one the gateway would start, but it may no longer be the relay the pointer recorded (a restore
    // of another relay's backup, or a drive letter now naming another relay's drive). Not refused — that would lock
    // out a supported restore (C1) — but flagged, so the launcher compares it with the identity it PROVES via
    // /relay-identity and tells the steward (audit D D-2).
    let recorded = null; try { recorded = typeof pointer.relayPub === 'function' ? pointer.relayPub() : null; } catch {}   // audit E E-3
    const expected = recorded || j.relayPub;
    const found = keyPubOf(dir);
    if (expected && found !== expected) return { dataDir: pr.v, action: 'none', identityChanged: true, expectedPub: expected, foundPub: found };
    return { dataDir: pr.v, action: 'none' };
  }
  if (j.mode === 'rename') sweepTombstoneTemps(j, journal, now);
  const failed = (note, extra = {}) => { journal.write({ ...j, state: 'failed', code: 'interrupted', note, ...extra, endedAt: now().toISOString() }); };
  // the result must be the folder the pointer names, and one the gateway would start
  const give = (r) => {
    if (r.action === 'refuse') return r;
    const p = safeRead(pointer);
    if (!p.ok || !samePath(p.v || j.from, r.dataDir, pf)) return refuse('pointer-mismatch', p.v);
    if (!startable(r.dataDir, j.relayPub)) return refuse(keyPubOf(r.dataDir) ? 'folder-not-startable' : 'drive-missing', r.dataDir);
    return r;
  };

  if (j.state === 'rolling-back') {
    const r = rollbackMove({ journal, pointer, rename, now });
    return r.ok ? give({ dataDir: j.from, action: 'none', note: 'finished rolling back' }) : refuse(r.code, j.from);
  }
  const onTo = !!pr.v && samePath(pr.v, j.to, pf);
  const onFrom = !pr.v || samePath(pr.v, j.from, pf);
  if (!onTo && !onFrom) return refuse('pointer-unexpected', pr.v);

  if (onTo) {
    // The switch happened. The new folder must be readable; if its drive is not connected, do not start anywhere.
    if (keyPubOf(j.to) !== j.relayPub) return refuse('drive-missing', j.to);
    ensureOldTombstoned(j, now);
    if (!['switched', 'checking'].includes(j.state)) {
      const since = now().toISOString();
      // audit B N3: a copy move ALWAYS records its old copy, even if that drive is unplugged right now
      journal.write({ ...j, state: 'switched', oldCopy: j.mode === 'copy' ? { path: j.from, since } : null,
        ...(j.mode === 'rename' ? { leftovers: withLeftover(j, j.from, 'tombstone', now) } : {}), switchedAt: since });
      return give({ dataDir: j.to, action: 'check', note: 'finished the switch' });
    }
    if (j.state === 'checking' && (j.checkAttempts || 0) >= 2) {
      // audit A #15: roll back automatically only soon after the move AND if the new folder has taken no writes
      let c = null; try { c = await countRows(j.to); } catch {}
      const within = Date.parse(j.firstCheckAt || j.switchedAt || 0) + CHECK_WINDOW_MS >= now().getTime();
      if (within && !movedOn(j.counts, c)) {
        const r = rollbackMove({ journal, pointer, rename, now });
        return r.ok ? give({ dataDir: j.from, action: 'none', note: 'check did not finish twice; rolled back' }) : refuse(r.code, j.to);
      }
      return give({ dataDir: j.to, action: 'check', note: 'the new folder has moved on (or the window has passed): not rolling back automatically' });
    }
    return give({ dataDir: j.to, action: 'check', note: j.state === 'checking' ? 're-running the check' : 'run the check' });
  }

  // The pointer names the OLD folder: the switch did not happen (or was undone).
  if (j.mode === 'rename') {
    let ok = false; try { ok = undoRename(j, rename); } catch {}
    if (!ok) return refuse(keyPubOf(j.to) || keyPubOf(j.from) ? 'folder-not-startable' : 'drive-missing', j.from);
    failed('renamed back');
    return give({ dataDir: j.from, action: 'none', note: 'renamed back' });
  }
  if (existsSync(j.to)) {
    if (existsSync(join(j.to, MARK_INCOMPLETE))) { try { rmSync(j.to, { recursive: true, force: true }); } catch {} }
    else if (keyPubOf(j.to)) {
      // a verified copy that never became current: tombstoned and kept, out of the fixed folder name
      let aside; try { aside = setAside(j.to, 'interrupted', asideNote(j.from, now().toISOString(), 'an interrupted relay data move'), rename, now); } catch { aside = j.to; }
      if (!startable(j.from, j.relayPub)) return refuse('folder-not-startable', j.from);
      failed('switch did not happen; copy kept', { leftover: aside, leftovers: withLeftover(j, aside, 'set-aside', now) });
      return give({ dataDir: j.from, action: 'none', note: 'copy set aside' });
    }
  }
  if (!startable(j.from, j.relayPub)) return refuse(keyPubOf(j.from) ? 'folder-not-startable' : 'drive-missing', j.from);
  failed(j.state === 'renaming' ? 'nothing moved' : 'partial copy removed');
  return give({ dataDir: j.from, action: 'none', note: 'interrupted; the old folder is unchanged' });
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────────────
//   node scripts/relay-move.mjs move     --from DIR --drive MOUNT --pointer FILE [--journal FILE] --port N [--mode suite|server]
//   node scripts/relay-move.mjs recover  --pointer FILE [--journal FILE]
//   node scripts/relay-move.mjs rollback --pointer FILE [--journal FILE]
//   node scripts/relay-move.mjs classify --path DIR [--mode suite|server]
// Prints one JSON object. Exit 0 = ok, 2 = refused / failed safely, 1 = usage or unexpected error.
const CODE_DIR = fileURLToPath(new URL('..', import.meta.url));   // the app's own code: never a target
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
    return moveRelayData({ ...store(), from: a.from, to: targetFor(a.drive), mode: a.mode, codeDir: CODE_DIR, relayRunning: () => portOpen(port) });
  }
  if (cmd === 'recover') { const r = await recoverMove(store()); return r.action === 'refuse' ? { ok: false, ...r } : r; }
  if (cmd === 'rollback') return rollbackMove(store());
  if (cmd === 'classify') {
    if (!a.path) throw new Error('classify needs --path');
    const ms = systemMounts(); let real = resolve(a.path); try { real = realpathSync(a.path); } catch {}
    const m = ms && mountFor(real, ms); let free; try { free = freeBytes(real); } catch {}
    const c = classifyTarget({ path: real, fsType: m && m.fsType, mountOptions: m && m.options, mode: a.mode, codeDir: CODE_DIR });
    if (pathHasSymlink(a.path)) { c.refuse.push('path-has-symlink'); c.eligible = false; }
    return { mount: m, free, ...c };
  }
  throw new Error('usage: relay-move.mjs move|recover|rollback|classify …');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).then(r => { console.log(JSON.stringify(r)); process.exit(r && r.ok === false ? 2 : 0); },
    e => { console.error(String(e && e.message || e)); process.exit(1); });
}
