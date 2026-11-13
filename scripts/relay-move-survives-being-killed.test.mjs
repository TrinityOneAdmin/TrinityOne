// A RELAY DATA MOVE SURVIVES BEING KILLED AT ANY POINT.
// Run: node --test scripts/relay-move-survives-being-killed.test.mjs
//
// Relay storage plan step 2 (test 4). For each journal state a kill can leave behind, this writes that state and
// the matching folders, then runs the REAL recoverMove() from scripts/relay-move.mjs — the function the launcher
// will run before every relay start. It goes red if recovery hands back a folder the relay must not start on (a
// partial copy, a moved-out copy, a missing folder), or deletes a copy that was fully verified.
// The second half drives a real move end to end through the step-8 check: pass, fail -> rollback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, renameSync, cpSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { recoverMove, rollbackMove, moveRelayData, beginCheck, checkPassed, compareAfterRestart, jsonPointer, jsonFieldStore, startable, keyPubOf, isTombstoneOnly, LEAF, MOVED_TO, STAMP, MARK_INCOMPLETE } from './relay-move.mjs';

function makeRelay(dir, pub, sk) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'relay-key.json'), JSON.stringify({ sk, pub }));
  writeFileSync(join(dir, STAMP), JSON.stringify({ relayPub: pub }));
  writeFileSync(join(dir, 'blob.bin'), 'church data');
  const db = new DatabaseSync(join(dir, 'relay.sqlite'));
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE events(id TEXT); CREATE TABLE deletions(id TEXT); CREATE TABLE meta(k TEXT); INSERT INTO events VALUES ('a'),('b');");
  db.close();
}
function rig(mode) {
  const base = mkdtempSync(join(tmpdir(), 'trin-kill-'));
  const from = join(base, 'old', 'data'), to = join(base, 'drive', LEAF);
  mkdirSync(dirname(to), { recursive: true });
  const k = generateSecretKey(), pub = getPublicKey(k), sk = Buffer.from(k).toString('hex');
  makeRelay(from, pub, sk);
  const cfg = join(base, 'storage.json');
  const pointer = jsonPointer(cfg), journal = jsonFieldStore(cfg, 'move');
  pointer.write(from, pub);
  const j = (state, extra = {}) => journal.write({ from, to, relayPub: pub, counts: { events: 2, deletions: 0, meta: 0 }, mode, state, startedAt: new Date().toISOString(), ...extra });
  const fullCopy = (marker) => { cpSync(from, to, { recursive: true }); if (marker) writeFileSync(join(to, MARK_INCOMPLETE), 'x'); };
  return { base, from, to, pub, pointer, journal, j, fullCopy, done: () => rmSync(base, { recursive: true, force: true }) };
}
// The folder recovery hands back must be one the step-1 guard would start: this relay's key, no MOVED-TO, not partial.
function assertStartable(t, dir, why) {
  assert.ok(dir && existsSync(dir), why + ': recovery returned a folder that does not exist: ' + dir);
  assert.equal(JSON.parse(readFileSync(join(dir, 'relay-key.json'), 'utf8')).pub, t.pub, why + ': returned folder is not this relay');
  assert.equal(existsSync(join(dir, MARK_INCOMPLETE)), false, why + ': recovery would start the relay on a PARTIAL copy');
  assert.equal(existsSync(join(dir, MOVED_TO)), false, why + ': recovery would start the relay on a MOVED-OUT copy');
  assert.equal(readFileSync(join(dir, 'blob.bin'), 'utf8'), 'church data', why + ': data missing');
  assert.equal(t.pointer.read(), dir, why + ': the pointer does not name the folder recovery returned');
}

test('killed mid-rename (the rename happened, the journal did not catch up) -> renamed back, old folder in use', async () => {
  const t = rig('rename');
  try {
    t.j('renaming'); renameSync(t.from, t.to);
    const r = await recoverMove(t);
    assertStartable(t, r.dataDir, 'renaming/after');
    assert.equal(r.dataDir, t.from); assert.equal(existsSync(t.to), false);
    assert.equal(t.journal.read().state, 'failed');
  } finally { t.done(); }
});

test('killed before the rename -> old folder, nothing touched', async () => {
  const t = rig('rename');
  try {
    t.j('renaming');
    const r = await recoverMove(t);
    assertStartable(t, r.dataDir, 'renaming/before'); assert.equal(r.dataDir, t.from);
  } finally { t.done(); }
});

for (const state of ['copying', 'verifying']) {
  test(`killed while ${state} -> partial copy (marked) removed, old folder in use`, async () => {
    const t = rig('copy');
    try {
      t.j(state); t.fullCopy(true);
      const r = await recoverMove(t);
      assertStartable(t, r.dataDir, state); assert.equal(r.dataDir, t.from);
      assert.equal(existsSync(t.to), false, 'the partial copy was left in place');
      assert.equal(r.action, 'none');
    } finally { t.done(); }
  });
}

test('killed after the copy was VERIFIED but before the pointer switched -> old folder in use, verified copy KEPT', async () => {
  const t = rig('copy');
  try {
    t.j('switching'); t.fullCopy(false);
    const r = await recoverMove(t);
    assertStartable(t, r.dataDir, 'switching/pointer-old'); assert.equal(r.dataDir, t.from);
    const j = t.journal.read();
    assert.ok(j.leftover, 'the verified copy is not recorded');
    assert.ok(existsSync(join(j.leftover, 'relay-key.json')), 'RECOVERY DELETED A VERIFIED COPY');
    assert.equal(existsSync(t.to), false, 'the copy still occupies the fixed folder name, so a retry would be refused');
  } finally { t.done(); }
});

test('killed after the pointer switched, before MOVED-TO -> finishes: new folder, old one marked and dated, check requested', async () => {
  const t = rig('copy');
  try {
    t.j('switching'); t.fullCopy(false); t.pointer.write(t.to, t.pub);
    const r = await recoverMove(t);
    assertStartable(t, r.dataDir, 'switching/pointer-new'); assert.equal(r.dataDir, t.to);
    assert.equal(r.action, 'check');
    assert.ok(existsSync(join(t.from, MOVED_TO)), 'the old copy was not marked MOVED-TO — an old launcher could start it');
    const j = t.journal.read(); assert.equal(j.state, 'switched'); assert.ok(Date.parse(j.oldCopy.since));
  } finally { t.done(); }
});

test('same-drive rename killed after the rename, before the pointer -> renamed back', async () => {
  const t = rig('rename');
  try {
    t.j('switching'); renameSync(t.from, t.to);
    const r = await recoverMove(t);
    assertStartable(t, r.dataDir, 'rename/switching'); assert.equal(r.dataDir, t.from);
  } finally { t.done(); }
});

test('switched, MOVED-TO lost -> rewritten; the relay is started on the new folder and checked', async () => {
  const t = rig('copy');
  try {
    t.fullCopy(false); t.pointer.write(t.to, t.pub); t.j('switched', { oldCopy: { path: t.from, since: new Date().toISOString() } });
    const r = await recoverMove(t);
    assertStartable(t, r.dataDir, 'switched'); assert.equal(r.action, 'check');
    assert.ok(existsSync(join(t.from, MOVED_TO)));
  } finally { t.done(); }
});

test('killed during the check: re-checked once, then rolled back — and the new copy is set aside, not deleted', async () => {
  const t = rig('copy');
  try {
    t.fullCopy(false); writeFileSync(join(t.from, MOVED_TO), 'moved'); t.pointer.write(t.to, t.pub);
    t.j('checking', { checkAttempts: 1 });
    const r1 = await recoverMove(t);
    assert.equal(r1.action, 'check'); assertStartable(t, r1.dataDir, 'checking/1');
    t.j('checking', { checkAttempts: 2, firstCheckAt: new Date().toISOString() });
    const r2 = await recoverMove(t);
    assertStartable(t, r2.dataDir, 'checking/2'); assert.equal(r2.dataDir, t.from);
    assert.equal(t.journal.read().state, 'rolled-back');
    const aside = readdirSync(dirname(t.to)).filter(n => n.startsWith(LEAF + '-failed-'));
    assert.equal(aside.length, 1, 'the new copy was deleted instead of kept for diagnosis');
  } finally { t.done(); }
});

test('killed half-way through a rollback of a rename -> the rollback finishes', async () => {
  const t = rig('rename');
  try {
    renameSync(t.from, t.to); t.pointer.write(t.to, t.pub); t.j('rolling-back');
    const r = await recoverMove(t);
    assertStartable(t, r.dataDir, 'rolling-back'); assert.equal(r.dataDir, t.from);
  } finally { t.done(); }
});

test('no move under way -> the pointer as it is', async () => {
  const t = rig('copy');
  try { const r = await recoverMove(t); assert.equal(r.action, 'none'); assert.equal(r.dataDir, t.from); } finally { t.done(); }
});

// ── end to end through the step-8 check ──
const exdev = () => { let first = true; return (a, b) => { if (first) { first = false; const e = new Error('EXDEV'); e.code = 'EXDEV'; throw e; } return renameSync(a, b); }; };
const run = (t, extra) => moveRelayData({ from: t.from, to: t.to, pointer: t.pointer, journal: t.journal, relayRunning: async () => false, mounts: null, ...extra });

test('cross-drive move, check passes -> awaiting the steward; old copy kept with its date', async () => {
  const t = rig('copy');
  try {
    const m = await run(t, { rename: exdev() }); assert.equal(m.ok, true, JSON.stringify(m));
    const bc = await beginCheck(t); assert.equal(bc.ok, true, JSON.stringify(bc.bad)); const j = bc.journal;
    assert.deepEqual(compareAfterRestart(j, { relayPub: t.pub, counts: j.counts }), []);
    assert.ok(compareAfterRestart(j, { relayPub: 'f'.repeat(64), counts: j.counts }).includes('relay-key'));
    assert.ok(compareAfterRestart(j, { relayPub: t.pub, counts: { ...j.counts, events: 1 } }).includes('event-count'));
    const done = checkPassed(t);
    assert.equal(done.state, 'awaiting-confirm');
    assert.equal(done.oldCopy.path, t.from); assert.ok(Date.parse(done.oldCopy.since));
    assert.ok(existsSync(join(t.from, 'relay-key.json')), 'the old copy was deleted automatically');
    assert.equal((await recoverMove(t)).action, 'none');
  } finally { t.done(); }
});

test('cross-drive move, check FAILS -> rollback: old folder back in use, tombstone gone, new copy set aside', async () => {
  const t = rig('copy');
  try {
    const m = await run(t, { rename: exdev() }); assert.equal(m.ok, true);
    assert.equal((await beginCheck(t)).ok, true);
    const r = rollbackMove(t);
    assert.equal(r.ok, true);
    assertStartable(t, r.dataDir, 'rollback/copy');
    assert.equal(readdirSync(dirname(t.to)).filter(n => n.startsWith(LEAF + '-failed-')).length, 1);
  } finally { t.done(); }
});

test('same-drive move, check passes -> done, no old copy; check fails -> renamed back', async () => {
  const a = rig('rename');
  try {
    const m = await run(a); assert.equal(m.mode, 'rename');
    assert.equal((await beginCheck(a)).ok, true); const done = checkPassed(a);
    assert.equal(done.state, 'done'); assert.equal(done.oldCopy, null);
  } finally { a.done(); }
  const b = rig('rename');
  try {
    const m = await run(b); assert.equal(m.mode, 'rename');
    await beginCheck(b); const r = rollbackMove(b);
    assertStartable(b, r.dataDir, 'rollback/rename'); assert.equal(existsSync(b.to), false);
  } finally { b.done(); }
});

// ── Audit A of a32084f4 ──────────────────────────────────────────────────────────────────────────────────────
const unplug = t => renameSync(dirname(t.to), dirname(t.to) + '-UNPLUGGED');
const replug = t => renameSync(dirname(t.to) + '-UNPLUGGED', dirname(t.to));

for (const moved of [true, false]) {
  test(`#1 killed after the switch, then the new drive is MISSING at the next start (MOVED-TO ${moved ? 'written' : 'not yet written'}) -> do not start anywhere`, async () => {
    const t = rig('copy');
    try {
      t.j('switching'); t.fullCopy(false); t.pointer.write(t.to, t.pub);
      if (moved) writeFileSync(join(t.from, MOVED_TO), 'moved');
      unplug(t);
      const r = await recoverMove(t);
      assert.equal(r.action, 'refuse', 'recovery handed back a folder although the pointer names a drive that is not connected: ' + JSON.stringify(r));
      assert.equal(r.code, 'drive-missing'); assert.equal(r.dataDir, null);
      assert.equal(r.expected, t.to);
      assert.equal(t.pointer.read(), t.to, 'the pointer was changed');
      assert.equal(t.journal.read().state, 'switching', 'the journal moved on, so the next start cannot finish the switch');
      replug(t);
      const r2 = await recoverMove(t);
      assertStartable(t, r2.dataDir, 'drive back'); assert.equal(r2.dataDir, t.to); assert.equal(r2.action, 'check');
      assert.ok(existsSync(join(t.from, MOVED_TO)), 'the old copy is startable alongside the new one');
    } finally { t.done(); }
  });
}

test('#1 switched / checking and the drive is missing -> refuse, never the old folder', async () => {
  for (const state of ['switched', 'checking']) {
    const t = rig('copy');
    try {
      t.fullCopy(false); writeFileSync(join(t.from, MOVED_TO), 'moved'); t.pointer.write(t.to, t.pub);
      t.j(state, { checkAttempts: 2, firstCheckAt: new Date().toISOString(), oldCopy: { path: t.from, since: new Date().toISOString() } });
      unplug(t);
      const r = await recoverMove(t);
      assert.equal(r.action, 'refuse', state + ': ' + JSON.stringify(r));
      assert.equal(t.pointer.read(), t.to);
    } finally { t.done(); }
  }
});

for (const mode of ['copy', 'rename']) {
  test(`#2 ${mode}: the pointer write lands then throws, and the write-back fails -> the new folder is NOT destroyed; recovery follows the pointer`, async () => {
    const t = rig(mode);
    try {
      let cur = t.from;
      const pointer = { read: () => cur, write(d) { cur = d; throw new Error('daemon-reload failed'); } };
      const rename = mode === 'copy' ? exdev() : renameSync;
      const m = await moveRelayData({ from: t.from, to: t.to, pointer, journal: t.journal, relayRunning: async () => false, mounts: null, rename });
      assert.equal(m.ok, false);
      assert.equal(cur, t.from, 'fixture: the write-back should have landed (it throws after setting)');
    } finally { t.done(); }
    // now the harder one: the write-back does NOT land
    const u = rig(mode);
    try {
      let cur = u.from, n = 0;
      const pointer = { read: () => cur, write(d) { n++; if (n === 1) cur = d; throw new Error('daemon-reload failed'); } };
      const rename = mode === 'copy' ? exdev() : renameSync;
      const m = await moveRelayData({ from: u.from, to: u.to, pointer, journal: u.journal, relayRunning: async () => false, mounts: null, rename });
      assert.equal(m.ok, false); assert.equal(m.code, 'switch-uncertain');
      assert.equal(cur, u.to, 'fixture: the pointer should name the new folder');
      assert.equal(JSON.parse(readFileSync(join(u.to, 'relay-key.json'), 'utf8')).pub, u.pub, 'THE FOLDER THE POINTER NAMES WAS DESTROYED');
      assert.equal(existsSync(join(u.to, MARK_INCOMPLETE)), false);
      const r = await recoverMove({ journal: u.journal, pointer: { read: () => cur, write(d) { cur = d; } } });
      assert.equal(r.dataDir, u.to); assert.equal(r.action, 'check');
    } finally { u.done(); }
  });
}

test('#5 the first check counts the new folder BEFORE the relay runs (exact); after the restart more events are fine', async () => {
  const t = rig('copy');
  try {
    const m = await run(t, { rename: exdev() }); assert.equal(m.ok, true);
    const db = new DatabaseSync(join(t.to, 'relay.sqlite')); db.exec("INSERT INTO events VALUES ('stray')"); db.close();
    const bc = await beginCheck(t);
    assert.equal(bc.ok, false, 'a new folder with rows the source never had passed the pre-start check');
    assert.deepEqual(bc.bad, ['event-count']);
    const j = bc.journal;
    assert.deepEqual(compareAfterRestart(j, { relayPub: t.pub, counts: { events: 9, deletions: 0, meta: 0 } }), [], 'a live relay that took new events failed the check — a healthy move would be rolled back');
    assert.deepEqual(compareAfterRestart(j, { relayPub: t.pub, counts: { events: 1, deletions: 0, meta: 0 } }), ['event-count']);
  } finally { t.done(); }
});

test('#9 rollback: the new folder is tombstoned and set aside BEFORE the old one\'s MOVED-TO is removed; if that fails, it stops', async () => {
  const t = rig('copy');
  try {
    const m = await run(t, { rename: exdev() }); assert.equal(m.ok, true);
    const r0 = rollbackMove({ journal: t.journal, pointer: t.pointer, rename: () => { const e = new Error('EBUSY'); e.code = 'EBUSY'; throw e; } });
    assert.equal(r0.ok, false); assert.equal(r0.code, 'rollback-blocked');
    assert.ok(existsSync(join(t.from, MOVED_TO)), 'the old folder was un-tombstoned although the new one could not be set aside');
    assert.ok(existsSync(join(t.to, MOVED_TO)), 'the new folder was not tombstoned first');
    assert.equal(t.journal.read().state, 'rolling-back');
    const r = await recoverMove(t);   // resumes the rollback with a working rename
    assertStartable(t, r.dataDir, 'rollback resumed');
    const aside = readdirSync(dirname(t.to)).filter(n => n.startsWith(LEAF + '-failed-'));
    assert.equal(aside.length, 1);
    assert.ok(existsSync(join(dirname(t.to), aside[0], MOVED_TO)), 'the set-aside copy is a startable identity clone');
  } finally { t.done(); }
});

test('#9 a verified copy set aside by recovery carries a tombstone', async () => {
  const t = rig('copy');
  try {
    t.j('switching'); t.fullCopy(false);
    await recoverMove(t);
    const j = t.journal.read();
    assert.ok(existsSync(join(j.leftover, MOVED_TO)), 'the -interrupted- copy is a startable identity clone');
  } finally { t.done(); }
});

test('#15 a check interrupted twice is NOT rolled back if the new folder has taken writes, or if the window has passed', async () => {
  const t = rig('copy');
  try {
    t.fullCopy(false); writeFileSync(join(t.from, MOVED_TO), 'moved'); t.pointer.write(t.to, t.pub);
    const db = new DatabaseSync(join(t.to, 'relay.sqlite')); db.exec("INSERT INTO events VALUES ('written after the move')"); db.close();
    t.j('checking', { checkAttempts: 2, firstCheckAt: new Date().toISOString() });
    const r = await recoverMove(t);
    assert.equal(r.dataDir, t.to, 'writes made on the new folder were stranded by an automatic rollback');
    assert.equal(r.action, 'check');
  } finally { t.done(); }
  const u = rig('copy');
  try {
    u.fullCopy(false); writeFileSync(join(u.from, MOVED_TO), 'moved'); u.pointer.write(u.to, u.pub);
    u.j('checking', { checkAttempts: 2, firstCheckAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
    const r = await recoverMove(u);
    assert.equal(r.dataDir, u.to, 'rolled back an hour after the move');
  } finally { u.done(); }
});

// ── Audit B of ba306e52 ──────────────────────────────────────────────────────────────────────────────────────
test('N1 same drive: the switch fails AND the rename back fails -> the journal stays active; recovery finishes the undo', async () => {
  const t = rig('rename');
  try {
    let cur = t.from;
    const pointer = { read: () => cur, write(d) { if (d === t.to) throw new Error('ENOSPC writing pointer'); cur = d; } };
    let n = 0; const rename = (a, b) => { n++; if (n === 2) { const e = new Error('EPERM rename back'); e.code = 'EPERM'; throw e; } renameSync(a, b); };
    const m = await moveRelayData({ from: t.from, to: t.to, pointer, journal: t.journal, relayRunning: async () => false, mounts: null, rename });
    assert.equal(m.ok, false);
    assert.equal(t.journal.read().state, 'switching', 'the journal says the move is over although the data is still in the new folder');
    const r = await recoverMove({ journal: t.journal, pointer });
    assert.equal(r.dataDir, t.from);
    assert.ok(startable(t.from, t.pub), 'RECOVERY HANDED BACK A FOLDER THAT DOES NOT EXIST — a launcher would start a stranger relay there');
  } finally { t.done(); }
});

test('N1 a finished move whose folder has since vanished -> refuse, not "start there"', async () => {
  const t = rig('copy');
  try {
    t.j('failed');
    rmSync(t.from, { recursive: true, force: true });
    const r = await recoverMove(t);
    assert.equal(r.action, 'refuse', 'recovery passed a missing folder through because the journal was not active: ' + JSON.stringify(r));
  } finally { t.done(); }
});

for (const leftover of ['empty', 'tmpfile']) {
  test(`N2 killed while the rename tombstone was being made (${leftover}) -> recovery renames back`, async () => {
    const t = rig('rename');
    try {
      t.j('renaming'); renameSync(t.from, t.to); mkdirSync(t.from);
      if (leftover === 'tmpfile') writeFileSync(join(t.from, MOVED_TO + '.tmp-123'), 'x');
      const r = await recoverMove(t);
      assertStartable(t, r.dataDir, 'N2 ' + leftover); assert.equal(r.dataDir, t.from);
    } finally { t.done(); }
  });
}

test('N3 copy move killed before MOVED-TO, old drive unplugged at the next start: the old copy is still recorded and re-tombstoned when it returns', async () => {
  const t = rig('copy');
  try {
    const m = await run(t, { rename: exdev() }); assert.equal(m.ok, true);
    const j = t.journal.read(); delete j.oldCopy; t.journal.write({ ...j, state: 'switching' }); rmSync(join(t.from, MOVED_TO));
    const oldParent = dirname(t.from); renameSync(oldParent, oldParent + '-UNPLUGGED');
    const r = await recoverMove(t); assert.equal(r.action, 'check');
    assert.equal((await beginCheck(t)).ok, true);
    const done = checkPassed(t);
    assert.equal(done.oldCopy && done.oldCopy.path, t.from, 'the old copy was forgotten because its drive was unplugged');
    renameSync(oldParent + '-UNPLUGGED', oldParent);
    const r2 = await recoverMove(t);
    assert.equal(r2.dataDir, t.to);
    assert.ok(existsSync(join(t.from, MOVED_TO)), 'the returned old copy is a startable identity clone');
  } finally { t.done(); }
});

test('N8 leftovers are recorded and carried: the rename tombstone, and a set-aside copy after a rollback', async () => {
  const a = rig('rename');
  try {
    const m = await run(a); assert.equal(m.mode, 'rename');
    assert.ok(m.journal.leftovers.some(l => l.path === a.from && l.kind === 'tombstone'), 'the rename tombstone is not recorded');
  } finally { a.done(); }
  const b = rig('copy');
  try {
    const m = await run(b, { rename: exdev() }); assert.equal(m.ok, true);
    const r = rollbackMove(b); assert.equal(r.ok, true);
    assert.ok(r.journal.leftovers.some(l => l.kind === 'set-aside' && l.path.startsWith(b.to + '-failed-')), 'the set-aside copy is not recorded');
  } finally { b.done(); }
});

// ── Audit C of fdba15d8 ──────────────────────────────────────────────────────────────────────────────────────
for (const mode of ['rename', 'copy']) {
  test(`C1 ${mode}: after a finished move, restoring ANOTHER relay's backup into the folder does not lock the box out`, async () => {
    const t = rig(mode);
    try {
      const m = await run(t, mode === 'copy' ? { rename: exdev() } : {}); assert.equal(m.ok, true);
      assert.equal((await beginCheck(t)).ok, true); checkPassed(t);
      // what the gateway's restore-on-boot leaves: the backup's key, and a stamp re-made from it
      const k = generateSecretKey(), pub = getPublicKey(k);
      writeFileSync(join(t.to, 'relay-key.json'), JSON.stringify({ sk: Buffer.from(k).toString('hex'), pub }));
      writeFileSync(join(t.to, STAMP), JSON.stringify({ relayPub: pub }));
      const r = await recoverMove(t);
      assert.equal(r.action, 'none', 'a box that restored another relay\'s backup is refused at every start: ' + JSON.stringify(r));
      assert.equal(r.dataDir, t.to);
    } finally { t.done(); }
  });
}

test('C3 a "done" rename tombstone the steward removed is not re-created at the next start', async () => {
  const t = rig('rename');
  try {
    const m = await run(t); assert.equal(m.mode, 'rename');
    assert.equal((await beginCheck(t)).ok, true); checkPassed(t);
    rmSync(t.from, { recursive: true, force: true });
    const r = await recoverMove(t);
    assert.equal(r.dataDir, t.to);
    assert.equal(existsSync(t.from), false, 'a removed tombstone came back at the next start');
  } finally { t.done(); }
});

test('C6 a tombstone temp folder left by a kill is cleared (dead pid, tombstone only) or recorded as a leftover', async () => {
  const t = rig('rename');
  try {
    const m = await run(t); assert.equal(m.mode, 'rename');
    const clean = t.from + '.tombstone-tmp-2147483646'; mkdirSync(clean); writeFileSync(join(clean, MOVED_TO), 'x');
    const odd = t.from + '.tombstone-tmp-2147483645'; mkdirSync(odd); writeFileSync(join(odd, 'something'), 'x');
    await recoverMove(t);
    assert.equal(existsSync(clean), false, 'a tombstone-only temp folder was left behind');
    assert.ok(existsSync(odd), 'a temp folder holding something else was deleted');
    assert.ok((t.journal.read().leftovers || []).some(l => l.path === odd && l.kind === 'tombstone-temp'), 'it is not listed as a leftover');
  } finally { t.done(); }
});

// ── Audit D of 260c4fdb ──────────────────────────────────────────────────────────────────────────────────────
test('D-2 after a finished move, a folder now holding ANOTHER relay is started but flagged identity-changed', async () => {
  const t = rig('rename');
  try {
    const m = await run(t); assert.equal(m.ok, true);
    assert.equal((await beginCheck(t)).ok, true); checkPassed(t);
    const same = await recoverMove(t);
    assert.equal(same.action, 'none'); assert.ok(!same.identityChanged, 'flagged although nothing changed');
    const k = generateSecretKey(), pub = getPublicKey(k);
    writeFileSync(join(t.to, 'relay-key.json'), JSON.stringify({ sk: Buffer.from(k).toString('hex'), pub }));
    writeFileSync(join(t.to, STAMP), JSON.stringify({ relayPub: pub }));
    const r = await recoverMove(t);
    assert.equal(r.action, 'none', 'refusing would lock out a supported restore (audit C C1)');
    assert.equal(r.identityChanged, true, 'another relay\'s folder was accepted silently');
    assert.equal(r.expectedPub, t.pub); assert.equal(r.foundPub, pub);
  } finally { t.done(); }
});

test('D-3 copy move awaiting confirmation, a foreign restore, then the old drive returns: the old copy is still tombstoned', async () => {
  const t = rig('copy');
  try {
    const m = await run(t, { rename: exdev() }); assert.equal(m.ok, true);
    assert.equal((await beginCheck(t)).ok, true); checkPassed(t);
    rmSync(join(t.from, MOVED_TO));                          // its drive was unplugged when MOVED-TO was due
    const oldParent = dirname(t.from); renameSync(oldParent, oldParent + '-UNPLUGGED');
    const k = generateSecretKey(), pub = getPublicKey(k);    // a restore of another relay's backup into the new folder
    writeFileSync(join(t.to, 'relay-key.json'), JSON.stringify({ sk: Buffer.from(k).toString('hex'), pub }));
    writeFileSync(join(t.to, STAMP), JSON.stringify({ relayPub: pub }));
    await recoverMove(t);
    renameSync(oldParent + '-UNPLUGGED', oldParent);
    await recoverMove(t);
    assert.ok(existsSync(join(t.from, MOVED_TO)), 'the old copy (which holds the data that moved) is left startable');
  } finally { t.done(); }
});

test('N-4 only <leaf>.tombstone-tmp-<digits> folders are swept; anything else with that prefix is left alone', async () => {
  const t = rig('rename');
  try {
    const m = await run(t); assert.equal(m.mode, 'rename');
    const notes = t.from + '.tombstone-tmp-notes'; mkdirSync(notes);
    await recoverMove(t);
    assert.ok(existsSync(notes), 'a folder the mover never wrote was deleted');
  } finally { t.done(); }
});

// ── Audit E of 045b5d6b ──────────────────────────────────────────────────────────────────────────────────────
test('E-3 a pointer whose relayPub() throws does not make recovery throw', async () => {
  const t = rig('rename');
  try {
    const m = await run(t); assert.equal(m.ok, true);
    assert.equal((await beginCheck(t)).ok, true); checkPassed(t);
    const pointer = { read: () => t.pointer.read(), write: (d, p) => t.pointer.write(d, p), relayPub() { throw new Error('config unreadable'); } };
    const r = await recoverMove({ journal: t.journal, pointer });
    assert.equal(r.action, 'none'); assert.equal(r.dataDir, t.to);
  } finally { t.done(); }
});

test('E-5 a tombstone temp carrying OUR pid but older than this process is a previous run\'s: swept', async () => {
  const t = rig('rename');
  try {
    const m = await run(t); assert.equal(m.mode, 'rename');
    const mine = t.from + '.tombstone-tmp-' + process.pid; mkdirSync(mine); writeFileSync(join(mine, MOVED_TO), 'x');
    const old = new Date(Date.now() - 24 * 3600e3); utimesSync(mine, old, old);
    await recoverMove(t);
    assert.equal(existsSync(mine), false, 'a previous run\'s tombstone temp with our pid was kept for ever');
  } finally { t.done(); }
});
