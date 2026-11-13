// A RELAY DATA MOVE CHECKS EVERYTHING BEFORE IT SWITCHES — AND A SAME-DRIVE MOVE IS ONE RENAME.
// Run: node --test scripts/relay-move-verifies-before-it-switches.test.mjs
//
// Relay storage plan step 2 (test 3), with the owner's §8a (2026-11-13): same volume = instant rename; cross
// volume (rename fails EXDEV) = copy + verify, never half-moved. Drives the REAL scripts/relay-move.mjs on real
// fixture folders (a real SQLite database in WAL mode, real blobs). The one thing faked is the EXDEV error, which
// only a second filesystem would produce: the rename function is injected to throw it, as libuv would.
//
// Every refusal case asserts the same three things: the pointer still names the old folder, the old folder is
// byte-for-byte as it was (no MOVED-TO), and no partial copy is left at the target.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, symlinkSync, readdirSync, statSync, truncateSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { moveRelayData, jsonPointer, jsonFieldStore, classifyTarget, parseMountinfo, parseMacMount, parseWinLogicalDisks, mountFor, checkPassed, beginCheck, relayLockHeld, processInfo, gatewayWouldStart, LEAF, MOVED_TO, STAMP, MARK_INCOMPLETE } from './relay-move.mjs';
import { spawnSync, spawn } from 'node:child_process';

function makeRelay(dir) {
  mkdirSync(dir, { recursive: true });
  const sk = generateSecretKey(), pub = getPublicKey(sk);
  writeFileSync(join(dir, 'relay-key.json'), JSON.stringify({ sk: Buffer.from(sk).toString('hex'), pub }));
  writeFileSync(join(dir, 'admin.json'), JSON.stringify({ token: 't' }));
  writeFileSync(join(dir, STAMP), JSON.stringify({ relayPub: pub }));
  mkdirSync(join(dir, 'blobs', 'ab'), { recursive: true });
  writeFileSync(join(dir, 'blobs', 'ab', 'cdef'), randomBytes(200000));
  writeFileSync(join(dir, 'cloudflared.log'), 'not carried by a copy');
  const db = new DatabaseSync(join(dir, 'relay.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE events(id TEXT, body TEXT); CREATE TABLE deletions(id TEXT); CREATE TABLE meta(k TEXT, v TEXT);');
  const ins = db.prepare('INSERT INTO events VALUES (?, ?)');
  for (let i = 0; i < 300; i++) ins.run('e' + i, 'x'.repeat(200));
  db.exec("INSERT INTO deletions VALUES ('d1'); INSERT INTO meta VALUES ('k','v');");
  return { pub, db };   // db left OPEN so its writes sit in the WAL; callers close it (or hold it to block the fold)
}
// a hash of every file in a folder, to prove a refused move left it exactly as it was
function snapshot(dir) {
  const out = {};
  const walk = rel => { for (const n of readdirSync(join(dir, rel)).sort()) { const r = rel ? join(rel, n) : n; const st = statSync(join(dir, r)); if (st.isDirectory()) walk(r); else out[r] = createHash('sha256').update(readFileSync(join(dir, r))).digest('hex'); } };
  walk(''); return out;
}
function rig() {
  const base = mkdtempSync(join(tmpdir(), 'trin-move-'));
  const from = join(base, 'app-data', 'data');
  const drive = join(base, 'drive'); mkdirSync(drive);
  const to = join(drive, LEAF);
  const r = makeRelay(from);
  const cfg = join(base, 'config', 'storage.json');
  const pointer = jsonPointer(cfg), journal = jsonFieldStore(cfg, 'move');
  pointer.write(from, r.pub);
  return { base, from, drive, to, pub: r.pub, db: r.db, pointer, journal, cfg,
    opts: extra => ({ from, to, pointer, journal, relayRunning: async () => false, mounts: null, ...extra }),
    done: () => { try { r.db.close(); } catch {} rmSync(base, { recursive: true, force: true }); } };
}
const exdevOnce = () => { let first = true; return (a, b) => { if (first) { first = false; const e = new Error('EXDEV: cross-device link not permitted'); e.code = 'EXDEV'; throw e; } return renameSync(a, b); }; };

function assertNothingSwitched(t, before, res, why) {
  assert.equal(res.ok, false, why + ': the move reported success');
  assert.equal(t.pointer.read(), t.from, why + ': THE POINTER WAS SWITCHED');
  assert.equal(existsSync(join(t.from, MOVED_TO)), false, why + ': the old folder was marked MOVED-TO');
  if (before) assert.deepEqual(snapshot(t.from), before, why + ': the old folder was changed');
  assert.ok(!existsSync(t.to) || readdirSync(t.to).length === 0, why + ': a partial copy was left at the target');
}

test('same drive: ONE rename — the data is moved, not copied; no old copy; pointer switched', async () => {
  const t = rig();
  try {
    t.db.close();
    const before = snapshot(t.from);
    const res = await moveRelayData(t.opts({}));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.mode, 'rename');
    assert.deepEqual(readdirSync(t.from), [MOVED_TO], 'a same-drive move must leave ONLY a MOVED-TO tombstone at the old path (owner: instant rename, no old copy)');
    assert.equal(t.pointer.read(), t.to);
    assert.equal(res.journal.oldCopy, null, 'a same-drive move recorded an old copy to remind about');
    const after = snapshot(t.to); delete after[STAMP]; const b = { ...before }; delete b[STAMP];
    for (const k of Object.keys(b)) if (!k.startsWith('relay.sqlite')) assert.equal(after[k], b[k], k + ' changed in the rename');
    assert.equal(JSON.parse(readFileSync(join(t.to, STAMP), 'utf8')).relayPub, t.pub);
  } finally { t.done(); }
});

test('cross drive (rename fails EXDEV): copies, verifies, switches; old copy kept, marked, dated', async () => {
  const t = rig();
  try {
    t.db.close();
    const res = await moveRelayData(t.opts({ rename: exdevOnce() }));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.mode, 'copy', 'EXDEV did not fall back to the copy path');
    assert.equal(t.pointer.read(), t.to);
    assert.ok(existsSync(join(t.from, 'relay-key.json')), 'the old copy was not kept');
    assert.match(readFileSync(join(t.from, MOVED_TO), 'utf8'), new RegExp(LEAF), 'the old copy is not marked MOVED-TO naming the new folder');
    assert.equal(existsSync(join(t.to, MARK_INCOMPLETE)), false);
    assert.equal(existsSync(join(t.to, 'cloudflared.log')), false, 'a skipped file was copied');
    assert.deepEqual(readFileSync(join(t.to, 'blobs', 'ab', 'cdef')), readFileSync(join(t.from, 'blobs', 'ab', 'cdef')));
    const j = t.journal.read();
    assert.equal(j.state, 'switched');
    assert.equal(j.oldCopy.path, t.from);
    assert.ok(!Number.isNaN(Date.parse(j.oldCopy.since)), 'the old copy has no creation time for the 7-day reminder');
    const db = new DatabaseSync(join(t.to, 'relay.sqlite'), { readOnly: true });
    assert.equal(db.prepare('SELECT count(*) n FROM events').get().n, 300, 'rows written to the WAL were lost in the copy');
    db.close();
  } finally { t.done(); }
});

test('cross drive: a WAL that cannot be folded (something holds the database) -> refused, nothing switched', async () => {
  const t = rig();
  try {
    const reader = new DatabaseSync(join(t.from, 'relay.sqlite'));
    reader.exec('BEGIN'); reader.prepare('SELECT count(*) FROM events').get();
    t.db.exec("INSERT INTO events VALUES ('late','y')");
    const res = await moveRelayData(t.opts({ rename: exdevOnce() }));
    assertNothingSwitched(t, null, res, 'unfoldable WAL');
    assert.match(res.code, /^wal-/);
    reader.exec('COMMIT'); reader.close();
  } finally { t.done(); }
});

test('cross drive: a byte flipped in a blob after the copy -> verify fails, copy deleted, nothing switched', async () => {
  const t = rig();
  try {
    t.db.close();
    const before = snapshot(t.from);
    const res = await moveRelayData(t.opts({ rename: exdevOnce(), _afterCopy: to => {
      const f = join(to, 'blobs', 'ab', 'cdef'); const b = readFileSync(f); b[1000] ^= 0xff; writeFileSync(f, b);
    } }));
    assertNothingSwitched(t, before, res, 'flipped byte');
    assert.equal(res.code, 'verify-failed');
    assert.equal(t.journal.read().state, 'failed');
  } finally { t.done(); }
});

test('cross drive: a truncated relay.sqlite -> refused, nothing switched', async () => {
  const t = rig();
  try {
    t.db.close();
    truncateSync(join(t.from, 'relay.sqlite'), 4096 + 100);
    const before = snapshot(t.from);
    const res = await moveRelayData(t.opts({ rename: exdevOnce() }));
    assertNothingSwitched(t, null, res, 'truncated database');
    assert.deepEqual(Object.keys(snapshot(t.from)).filter(k => !k.startsWith('relay.sqlite')), Object.keys(before).filter(k => !k.startsWith('relay.sqlite')));
  } finally { t.done(); }
});

test('cross drive: not enough space on the drive -> refused before copying anything', async () => {
  const t = rig();
  try {
    t.db.close();
    const res = await moveRelayData(t.opts({ rename: exdevOnce(), freeSpace: () => 1024 * 1024 }));
    assertNothingSwitched(t, null, res, 'not enough space');
    assert.equal(res.code, 'not-enough-space');
  } finally { t.done(); }
});

test('a symlink anywhere in the source -> refused', async () => {
  const t = rig();
  try {
    t.db.close();
    symlinkSync('/etc/passwd', join(t.from, 'blobs', 'ab', 'link'));
    const before = snapshot(t.from);
    const res = await moveRelayData(t.opts({}));
    assertNothingSwitched(t, before, res, 'symlink in source');
    assert.equal(res.code, 'source-has-symlink');
  } finally { t.done(); }
});

test('a non-empty target folder -> refused (and never renamed over)', async () => {
  const t = rig();
  try {
    t.db.close();
    mkdirSync(t.to); writeFileSync(join(t.to, 'someone-elses.txt'), 'keep me');
    const before = snapshot(t.from);
    const res = await moveRelayData(t.opts({}));
    assert.equal(res.ok, false);
    assert.equal(res.code, 'target-not-empty');
    assert.equal(t.pointer.read(), t.from);
    assert.deepEqual(snapshot(t.from), before);
    assert.equal(readFileSync(join(t.to, 'someone-elses.txt'), 'utf8'), 'keep me');
  } finally { t.done(); }
});

test('the relay is still running -> refused', async () => {
  const t = rig();
  try {
    t.db.close();
    const res = await moveRelayData(t.opts({ relayRunning: async () => true }));
    assertNothingSwitched(t, null, res, 'relay running');
    assert.equal(res.code, 'relay-running');
  } finally { t.done(); }
});

test('a network drive -> refused; an exFAT drive -> moved, with a no-permissions warning', async () => {
  const t = rig();
  try {
    t.db.close();
    const nfs = [{ mountpoint: '/', fsType: 'ext4', options: [] }, { mountpoint: t.drive, fsType: 'nfs4', options: [] }];
    const res = await moveRelayData(t.opts({ mounts: nfs }));
    assertNothingSwitched(t, null, res, 'network drive');
    assert.equal(res.code, 'target-ineligible'); assert.match(res.detail, /network/);
    const exfat = [{ mountpoint: '/', fsType: 'ext4', options: [] }, { mountpoint: t.drive, fsType: 'exfat', options: [] }];
    const ok = await moveRelayData(t.opts({ mounts: exfat }));
    assert.equal(ok.ok, true, 'an exFAT drive was refused — the owner allows it with a warning');
    assert.ok(ok.journal.warn.includes('no-permissions'), 'the exFAT warning is not reported for the UI');
  } finally { t.done(); }
});

test('only the fixed folder name on the drive is accepted', async () => {
  const t = rig();
  try {
    t.db.close();
    const res = await moveRelayData(t.opts({ to: join(t.drive, 'anything') }));
    assert.equal(res.code, 'target-not-fixed-leaf');
    assert.equal(t.pointer.read(), t.from);
  } finally { t.done(); }
});

test('classifyTarget: refuses network / sync / system, warns (never refuses) on drives without permissions', () => {
  const c = (o) => classifyTarget({ fsType: 'ext4', ...o });
  assert.deepEqual(c({ path: '/mnt/nas/' + LEAF, fsType: 'cifs' }).refuse, ['network']);
  assert.deepEqual(c({ path: '\\\\server\\share\\' + LEAF, fsType: '' }).refuse, ['network']);
  assert.ok(c({ path: '/Users/ann/Library/CloudStorage/OneDrive-Personal/' + LEAF }).refuse.includes('sync-folder'));
  assert.ok(c({ path: 'C:\\Users\\ann\\OneDrive\\Documents\\' + LEAF, fsType: 'ntfs' }).refuse.includes('sync-folder'));
  assert.ok(c({ path: '/Users/ann/Library/Mobile Documents/com~apple~CloudDocs/' + LEAF, fsType: 'apfs' }).refuse.includes('sync-folder'));
  assert.ok(c({ path: '/etc/' + LEAF }).refuse.includes('system-folder'));
  assert.ok(c({ path: '/home/ann/' + LEAF, mode: 'server' }).refuse.includes('system-folder'));
  assert.equal(c({ path: '/home/ann/' + LEAF, mode: 'suite' }).eligible, true);
  for (const fs of ['exfat', 'vfat', 'msdos', 'ntfs3']) {
    const r = c({ path: '/media/ann/T7/' + LEAF, fsType: fs });
    assert.equal(r.eligible, true, fs + ' was refused');
    assert.ok(r.warn.includes('no-permissions'), fs + ' not flagged');
  }
  const mac = c({ path: '/Volumes/T7/' + LEAF, fsType: 'apfs', mountOptions: ['local', 'noowners'] });
  assert.equal(mac.eligible, true); assert.ok(mac.warn.includes('no-permissions'), 'macOS "ignore ownership" not flagged');
  assert.ok(c({ path: '/mnt/big/' + LEAF, free: 10, need: 100 }).refuse.includes('not-enough-space'));
});

test('mount tables parse and resolve to the longest matching mount', () => {
  const li = parseMountinfo('22 1 8:1 / / rw,relatime - ext4 /dev/sda1 rw\n90 22 8:17 / /media/ann/Samsung\\040T7 rw - exfat /dev/sdb1 rw,uid=1000\n');
  const m = mountFor('/media/ann/Samsung T7/' + LEAF, li);
  assert.equal(m.fsType, 'exfat'); assert.equal(m.mountpoint, '/media/ann/Samsung T7');
  const mac = parseMacMount('/dev/disk3s1 on / (apfs, local, journaled)\n/dev/disk4s1 on /Volumes/T7 (exfat, local, nodev, nosuid, noowners)\n');
  assert.equal(mountFor('/Volumes/T7/' + LEAF, mac).fsType, 'exfat');
  assert.ok(mountFor('/Volumes/T7/x', mac).options.includes('noowners'));
});

test('a stale relay lock (its process is gone) does not block a move, and is not copied', async () => {
  const t = rig();
  try {
    t.db.close();
    writeFileSync(join(t.from, '.relay-lock'), JSON.stringify({ pid: 2147483646 }));
    const res = await moveRelayData(t.opts({ rename: exdevOnce() }));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(existsSync(join(t.to, '.relay-lock')), false, 'a lock note was carried into the new folder');
  } finally { t.done(); }
});

// ── Audit A of a32084f4 ──────────────────────────────────────────────────────────────────────────────────────
const ROOT = new URL('..', import.meta.url).pathname;

test('#6 same drive: the old path holds ONLY a MOVED-TO tombstone, and the REAL gateway refuses to start there', async () => {
  const t = rig();
  try {
    t.db.close();
    const res = await moveRelayData(t.opts({}));
    assert.equal(res.mode, 'rename');
    const r = spawnSync(process.execPath, ['scripts/gateway.mjs', '8875'], { cwd: ROOT, env: { ...process.env, TRINITY_DATA_DIR: t.from, RELAY_NO_OPEN: '1' }, encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 78, 'a relay started at the old path after a same-drive move — a new, empty relay with a new key. ' + r.stderr);
    assert.equal(existsSync(join(t.from, 'relay-key.json')), false, 'a key was minted at the old path');
  } finally { t.done(); }
});

test('#3 every copied file and directory is fsynced BEFORE the pointer is switched', async () => {
  const t = rig();
  try {
    t.db.close();
    const synced = new Set(); let syncedAtSwitch = null;
    const realWrite = t.pointer.write.bind(t.pointer);
    const pointer = { read: () => t.pointer.read(), write: (d, p) => { if (d === t.to) syncedAtSwitch = new Set(synced); return realWrite(d, p); } };
    const res = await moveRelayData(t.opts({ pointer, rename: exdevOnce(), _fsync: p => { synced.add(p); return true; } }));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.ok(syncedAtSwitch, 'the pointer was never switched');
    for (const f of ['relay.sqlite', 'relay-key.json', join('blobs', 'ab', 'cdef')]) assert.ok(syncedAtSwitch.has(join(t.to, f)), f + ' was not fsynced before the switch');
    for (const d of [t.to, join(t.to, 'blobs'), join(t.to, 'blobs', 'ab'), t.drive]) assert.ok(syncedAtSwitch.has(d), d + ' (directory) was not fsynced before the switch');
  } finally { t.done(); }
});

test('#4 a "drive" that is a symlink into a sync folder is refused, and nothing lands there', async () => {
  const t = rig();
  try {
    t.db.close();
    const dropbox = join(t.base, 'Dropbox'); mkdirSync(dropbox);
    const usb = join(t.base, 'usb'); symlinkSync(dropbox, usb);
    const res = await moveRelayData(t.opts({ to: join(usb, LEAF) }));
    assertNothingSwitched({ ...t, to: join(dropbox, LEAF) }, null, res, 'symlinked drive');
    assert.equal(res.code, 'target-path-has-symlink');
    const direct = await moveRelayData(t.opts({ to: join(dropbox, LEAF) }));
    assert.equal(direct.code, 'target-ineligible'); assert.match(direct.detail, /sync-folder/);
  } finally { t.done(); }
});

test('#11 a staged restore in the folder -> refused (a copy would silently drop it)', async () => {
  const t = rig();
  try {
    t.db.close();
    mkdirSync(join(t.from, '.restore-pending'));
    const res = await moveRelayData(t.opts({}));
    assertNothingSwitched(t, null, res, 'restore pending');
    assert.equal(res.code, 'restore-pending');
  } finally { t.done(); }
});

test('#14 a second move is refused while the first move\'s old copy still awaits removal', async () => {
  const t = rig();
  try {
    t.db.close();
    const first = await moveRelayData(t.opts({ rename: exdevOnce() }));
    assert.equal(first.ok, true);
    assert.equal((await beginCheck(t)).ok, true); checkPassed(t);
    const drive2 = join(t.base, 'drive2'); mkdirSync(drive2);
    const second = await moveRelayData({ ...t.opts({}), from: t.to, to: join(drive2, LEAF) });
    assert.equal(second.ok, false, 'a second move overwrote the record of an old copy that is still on disk');
    assert.equal(second.code, 'old-copy-awaiting-removal');
    assert.equal(t.journal.read().oldCopy.path, t.from, 'the old copy\'s record was lost');
    assert.equal(t.pointer.read(), t.to);
  } finally { t.done(); }
});

test('#12 Windows: system folders refused case-insensitively; a mapped network letter is refused; removable flagged', () => {
  for (const p of ['C:\\Windows\\' + LEAF, 'c:\\program files\\TrinityOne\\' + LEAF, 'D:\\ProgramData\\' + LEAF])
    assert.ok(classifyTarget({ path: p, fsType: 'ntfs', platform: 'win32' }).refuse.includes('system-folder'), p);
  assert.equal(classifyTarget({ path: 'E:\\' + LEAF, fsType: 'exfat', platform: 'win32' }).eligible, true);
  const disks = parseWinLogicalDisks(JSON.stringify([
    { DeviceID: 'C:', DriveType: 3, FileSystem: 'NTFS' }, { DeviceID: 'E:', DriveType: 2, FileSystem: 'exFAT' },
    { DeviceID: 'Z:', DriveType: 4, FileSystem: 'NTFS', ProviderName: '\\\\nas\\share' }]));
  const z = mountFor('z:\\' + LEAF, disks, 'win32');
  assert.equal(z.mountpoint, 'Z:\\', 'drive letters must match case-insensitively');
  assert.deepEqual(classifyTarget({ path: 'Z:\\' + LEAF, fsType: z.fsType, platform: 'win32' }).refuse, ['network'], 'a mapped network drive was accepted');
  const e = mountFor('E:\\' + LEAF, disks, 'win32');
  const ce = classifyTarget({ path: 'E:\\' + LEAF, fsType: e.fsType, mountOptions: e.options, platform: 'win32' });
  assert.ok(ce.warn.includes('removable') && ce.warn.includes('no-permissions'));
  assert.ok(classifyTarget({ path: '/system/Library/' + LEAF, fsType: 'apfs', platform: 'darwin' }).refuse.includes('system-folder'), 'macOS paths are case-insensitive');
  assert.ok(classifyTarget({ path: 'C:\\Users\\ann\\TrinityOne Suite\\payload\\' + LEAF, fsType: 'ntfs', platform: 'win32', codeDir: 'c:\\users\\ann\\trinityone suite\\payload' }).refuse.includes('inside-app'));
});

test('#12 the CLI refuses a target inside the app\'s own code folder', () => {
  const r = spawnSync(process.execPath, ['scripts/relay-move.mjs', 'classify', '--path', join(ROOT, 'scripts')], { cwd: ROOT, encoding: 'utf8' });
  const out = JSON.parse(r.stdout);
  assert.ok(out.refuse.includes('inside-app'), 'the CLI does not pass codeDir: ' + r.stdout);
});

// ── Audit B of ba306e52 ──────────────────────────────────────────────────────────────────────────────────────
test('N4 a failed fsync (EIO from a dying stick) fails the copy move; nothing is switched', async () => {
  const t = rig();
  try {
    t.db.close();
    const before = snapshot(t.from);
    const res = await moveRelayData(t.opts({ rename: exdevOnce(), _fsync: () => false }));
    assertNothingSwitched(t, before, res, 'fsync failed');
    assert.equal(res.code, 'copy-not-durable');
    // only ONE FILE fails to sync (directories fine): still not durable, still nothing switched
    const res2 = await moveRelayData(t.opts({ rename: exdevOnce(), _fsync: p => !p.endsWith('cdef') }));
    assertNothingSwitched(t, before, res2, 'one file fsync failed');
    assert.equal(res2.code, 'copy-not-durable', 'a file that did not reach the disk was switched to');
  } finally { t.done(); }
});

test('N4 a same-drive rename fsyncs both parent folders before the pointer is switched', async () => {
  const t = rig();
  try {
    t.db.close();
    const synced = new Set(); let atSwitch = null;
    const realWrite = t.pointer.write.bind(t.pointer);
    const pointer = { read: () => t.pointer.read(), write: (d, p) => { if (d === t.to) atSwitch = new Set(synced); return realWrite(d, p); } };
    const res = await moveRelayData(t.opts({ pointer, _fsync: p => { synced.add(p); return true; } }));
    assert.equal(res.mode, 'rename');
    assert.ok(atSwitch && atSwitch.has(t.drive), 'the new parent was not fsynced after the rename');
    assert.ok(atSwitch.has(join(t.base, 'app-data')), 'the old parent was not fsynced after the rename');
  } finally { t.done(); }
});

test('N8 a target holding only an old MOVED-TO tombstone counts as empty', async () => {
  const t = rig();
  try {
    t.db.close();
    mkdirSync(t.to); writeFileSync(join(t.to, MOVED_TO), 'moved somewhere else long ago');
    const res = await moveRelayData(t.opts({}));
    assert.equal(res.ok, true, 'a drive that once held this relay refuses every later move: ' + JSON.stringify(res));
  } finally { t.done(); }
});

test('N6 a reused pid is not a relay: the lock is held only when the live process runs gateway.mjs (all three OS paths)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-lock-'));
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 30000)'], { stdio: 'ignore' });
  try {
    writeFileSync(join(dir, '.relay-lock'), JSON.stringify({ pid: child.pid }));
    const as = commandLine => async () => ({ commandLine, startedAt: null });
    for (const platform of ['linux', 'darwin', 'win32']) {
      assert.equal(await relayLockHeld(dir, { platform, info: as('C:\\Windows\\notepad.exe') }), false, platform + ': an unrelated process that reused the pid blocked a move');
      assert.equal(await relayLockHeld(dir, { platform, info: as('node scripts/gateway.mjs 8090') }), true, platform);
      assert.equal(await relayLockHeld(dir, { platform, info: as(null) }), true, platform + ': unknown must count as held');
    }
    // the real lookups this box can run: /proc, and `ps -ww -p PID -o command=` (the macOS path, here on procps)
    assert.match((await processInfo(child.pid, 'linux')).commandLine, /setTimeout/);
    assert.match((await processInfo(child.pid, 'darwin')).commandLine || '', /setTimeout/, 'ps did not return the command line');
    assert.equal(await relayLockHeld(dir, { platform: 'darwin' }), false, 'a live non-gateway process was taken for a relay');
  } finally { child.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); }
});

// ── Audit C of fdba15d8 ──────────────────────────────────────────────────────────────────────────────────────
test('C2 a command line cut short by macOS ps is not trusted; the lookup asks ps for full width', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-lock-c2-'));
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 30000)', 'x'.repeat(300) + '-END'], { stdio: 'ignore' });
  try {
    writeFileSync(join(dir, '.relay-lock'), JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString() }));
    const cut = '/Applications/TrinityOne Suite.app/Contents/MacOS/trinityone-relay-node scripts/gatew';   // 79+ columns, no "gateway.mjs"
    assert.equal(await relayLockHeld(dir, { platform: 'darwin', info: async () => ({ commandLine: cut, startedAt: null }) }), true,
      'a relay whose command line ps cut short was taken for "not a relay" — the mover would move a live folder');
    const calls = [];
    await processInfo(child.pid, 'darwin', async (cmd, args) => { calls.push([cmd, ...args].join(' ')); return null; });
    assert.ok(calls.some(c => /^ps .*-ww/.test(c) && /command=/.test(c)), 'the macOS lookup does not ask ps for unlimited width: ' + calls.join(' | '));
    const real = await processInfo(child.pid, 'darwin');   // procps here; on a Mac this still needs checking
    assert.match(real.commandLine || '', /-END/, 'the full command line was not returned');
  } finally { child.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); }
});

test('C2 a process that started AFTER the lock was written is a reused pid, not the relay', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-lock-c2b-'));
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 30000)'], { stdio: 'ignore' });
  try {
    const lockAt = Date.now() - 3600 * 1000;
    writeFileSync(join(dir, '.relay-lock'), JSON.stringify({ pid: child.pid, startedAt: new Date(lockAt).toISOString() }));
    const gw = 'node scripts/gateway.mjs 8090';
    assert.equal(await relayLockHeld(dir, { platform: 'win32', info: async () => ({ commandLine: gw, startedAt: lockAt + 60000 }) }), false, 'a later process with the same pid was taken for the relay');
    assert.equal(await relayLockHeld(dir, { platform: 'win32', info: async () => ({ commandLine: gw, startedAt: lockAt - 1000 }) }), true);
    const real = await processInfo(child.pid, 'linux');
    assert.ok(real.startedAt && Math.abs(real.startedAt - Date.now()) < 120000, 'ps -o lstart= gave no usable start time: ' + real.startedAt);
  } finally { child.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); }
});

test('C4 a stale tombstone at the target is put back if the rename then fails', async () => {
  const t = rig();
  try {
    t.db.close();
    mkdirSync(t.to); writeFileSync(join(t.to, MOVED_TO), 'moved somewhere else long ago\n');
    const res = await moveRelayData(t.opts({ rename: () => { const e = new Error('EBUSY'); e.code = 'EBUSY'; throw e; } }));
    assert.equal(res.code, 'rename-failed');
    assert.deepEqual(readdirSync(t.to), [MOVED_TO], 'the tombstone was replaced by an EMPTY folder a launcher could start a stranger in');
    assert.equal(readFileSync(join(t.to, MOVED_TO), 'utf8'), 'moved somewhere else long ago\n');
  } finally { t.done(); }
});

test('C6 a key temp file (it holds a secret) is never carried by a copy move', async () => {
  const t = rig();
  try {
    t.db.close();
    writeFileSync(join(t.from, 'relay-key.json.tmp-4242'), '{"sk":"secret"}');
    const res = await moveRelayData(t.opts({ rename: exdevOnce() }));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(existsSync(join(t.to, 'relay-key.json.tmp-4242')), false, 'a secret key temp file was copied to the new drive');
  } finally { t.done(); }
});

test('C1 gatewayWouldStart judges a folder by its OWN key: a restored foreign identity with a matching stamp is fine', () => {
  const t = rig();
  try {
    t.db.close();
    assert.equal(gatewayWouldStart(t.from), true);
    const k = generateSecretKey(), pub = getPublicKey(k);
    writeFileSync(join(t.from, 'relay-key.json'), JSON.stringify({ sk: Buffer.from(k).toString('hex'), pub }));
    assert.equal(gatewayWouldStart(t.from), false, 'a stamp naming another key must be refused, as the pinned gateway does');
    writeFileSync(join(t.from, STAMP), JSON.stringify({ relayPub: pub }));
    assert.equal(gatewayWouldStart(t.from), true);
    writeFileSync(join(t.from, MOVED_TO), 'x'); assert.equal(gatewayWouldStart(t.from), false);
  } finally { t.done(); }
});
