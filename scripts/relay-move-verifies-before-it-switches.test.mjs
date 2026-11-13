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
import { moveRelayData, jsonPointer, jsonFieldStore, classifyTarget, parseMountinfo, parseMacMount, mountFor, LEAF, MOVED_TO, STAMP, MARK_INCOMPLETE } from './relay-move.mjs';

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
    assert.equal(existsSync(t.from), false, 'a same-drive move left the old folder behind (owner: instant rename, no old copy)');
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
