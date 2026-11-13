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
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, renameSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { recoverMove, rollbackMove, moveRelayData, beginCheck, checkPassed, compareAfterRestart, jsonPointer, jsonFieldStore, LEAF, MOVED_TO, STAMP, MARK_INCOMPLETE } from './relay-move.mjs';

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

test('killed mid-rename (the rename happened, the journal did not catch up) -> renamed back, old folder in use', () => {
  const t = rig('rename');
  try {
    t.j('renaming'); renameSync(t.from, t.to);
    const r = recoverMove(t);
    assertStartable(t, r.dataDir, 'renaming/after');
    assert.equal(r.dataDir, t.from); assert.equal(existsSync(t.to), false);
    assert.equal(t.journal.read().state, 'failed');
  } finally { t.done(); }
});

test('killed before the rename -> old folder, nothing touched', () => {
  const t = rig('rename');
  try {
    t.j('renaming');
    const r = recoverMove(t);
    assertStartable(t, r.dataDir, 'renaming/before'); assert.equal(r.dataDir, t.from);
  } finally { t.done(); }
});

for (const state of ['copying', 'verifying']) {
  test(`killed while ${state} -> partial copy (marked) removed, old folder in use`, () => {
    const t = rig('copy');
    try {
      t.j(state); t.fullCopy(true);
      const r = recoverMove(t);
      assertStartable(t, r.dataDir, state); assert.equal(r.dataDir, t.from);
      assert.equal(existsSync(t.to), false, 'the partial copy was left in place');
      assert.equal(r.action, 'none');
    } finally { t.done(); }
  });
}

test('killed after the copy was VERIFIED but before the pointer switched -> old folder in use, verified copy KEPT', () => {
  const t = rig('copy');
  try {
    t.j('switching'); t.fullCopy(false);
    const r = recoverMove(t);
    assertStartable(t, r.dataDir, 'switching/pointer-old'); assert.equal(r.dataDir, t.from);
    const j = t.journal.read();
    assert.ok(j.leftover, 'the verified copy is not recorded');
    assert.ok(existsSync(join(j.leftover, 'relay-key.json')), 'RECOVERY DELETED A VERIFIED COPY');
    assert.equal(existsSync(t.to), false, 'the copy still occupies the fixed folder name, so a retry would be refused');
  } finally { t.done(); }
});

test('killed after the pointer switched, before MOVED-TO -> finishes: new folder, old one marked and dated, check requested', () => {
  const t = rig('copy');
  try {
    t.j('switching'); t.fullCopy(false); t.pointer.write(t.to, t.pub);
    const r = recoverMove(t);
    assertStartable(t, r.dataDir, 'switching/pointer-new'); assert.equal(r.dataDir, t.to);
    assert.equal(r.action, 'check');
    assert.ok(existsSync(join(t.from, MOVED_TO)), 'the old copy was not marked MOVED-TO — an old launcher could start it');
    const j = t.journal.read(); assert.equal(j.state, 'switched'); assert.ok(Date.parse(j.oldCopy.since));
  } finally { t.done(); }
});

test('same-drive rename killed after the rename, before the pointer -> renamed back', () => {
  const t = rig('rename');
  try {
    t.j('switching'); renameSync(t.from, t.to);
    const r = recoverMove(t);
    assertStartable(t, r.dataDir, 'rename/switching'); assert.equal(r.dataDir, t.from);
  } finally { t.done(); }
});

test('switched, MOVED-TO lost -> rewritten; the relay is started on the new folder and checked', () => {
  const t = rig('copy');
  try {
    t.fullCopy(false); t.pointer.write(t.to, t.pub); t.j('switched', { oldCopy: { path: t.from, since: new Date().toISOString() } });
    const r = recoverMove(t);
    assertStartable(t, r.dataDir, 'switched'); assert.equal(r.action, 'check');
    assert.ok(existsSync(join(t.from, MOVED_TO)));
  } finally { t.done(); }
});

test('killed during the check: re-checked once, then rolled back — and the new copy is set aside, not deleted', () => {
  const t = rig('copy');
  try {
    t.fullCopy(false); writeFileSync(join(t.from, MOVED_TO), 'moved'); t.pointer.write(t.to, t.pub);
    t.j('checking', { checkAttempts: 1 });
    const r1 = recoverMove(t);
    assert.equal(r1.action, 'check'); assertStartable(t, r1.dataDir, 'checking/1');
    t.j('checking', { checkAttempts: 2 });
    const r2 = recoverMove(t);
    assertStartable(t, r2.dataDir, 'checking/2'); assert.equal(r2.dataDir, t.from);
    assert.equal(t.journal.read().state, 'rolled-back');
    const aside = readdirSync(dirname(t.to)).filter(n => n.startsWith(LEAF + '-failed-'));
    assert.equal(aside.length, 1, 'the new copy was deleted instead of kept for diagnosis');
  } finally { t.done(); }
});

test('killed half-way through a rollback of a rename -> the rollback finishes', () => {
  const t = rig('rename');
  try {
    renameSync(t.from, t.to); t.pointer.write(t.to, t.pub); t.j('rolling-back');
    const r = recoverMove(t);
    assertStartable(t, r.dataDir, 'rolling-back'); assert.equal(r.dataDir, t.from);
  } finally { t.done(); }
});

test('no move under way -> the pointer as it is', () => {
  const t = rig('copy');
  try { const r = recoverMove(t); assert.equal(r.action, 'none'); assert.equal(r.dataDir, t.from); } finally { t.done(); }
});

// ── end to end through the step-8 check ──
const exdev = () => { let first = true; return (a, b) => { if (first) { first = false; const e = new Error('EXDEV'); e.code = 'EXDEV'; throw e; } return renameSync(a, b); }; };
const run = (t, extra) => moveRelayData({ from: t.from, to: t.to, pointer: t.pointer, journal: t.journal, relayRunning: async () => false, mounts: null, ...extra });

test('cross-drive move, check passes -> awaiting the steward; old copy kept with its date', async () => {
  const t = rig('copy');
  try {
    const m = await run(t, { rename: exdev() }); assert.equal(m.ok, true, JSON.stringify(m));
    const j = beginCheck(t);
    assert.deepEqual(compareAfterRestart(j, { relayPub: t.pub, counts: j.counts }), []);
    assert.ok(compareAfterRestart(j, { relayPub: 'f'.repeat(64), counts: j.counts }).includes('relay-key'));
    assert.ok(compareAfterRestart(j, { relayPub: t.pub, counts: { ...j.counts, events: 1 } }).includes('event-count'));
    const done = checkPassed(t);
    assert.equal(done.state, 'awaiting-confirm');
    assert.equal(done.oldCopy.path, t.from); assert.ok(Date.parse(done.oldCopy.since));
    assert.ok(existsSync(join(t.from, 'relay-key.json')), 'the old copy was deleted automatically');
    assert.equal(recoverMove(t).action, 'none');
  } finally { t.done(); }
});

test('cross-drive move, check FAILS -> rollback: old folder back in use, tombstone gone, new copy set aside', async () => {
  const t = rig('copy');
  try {
    const m = await run(t, { rename: exdev() }); assert.equal(m.ok, true);
    beginCheck(t);
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
    beginCheck(a); const done = checkPassed(a);
    assert.equal(done.state, 'done'); assert.equal(done.oldCopy, null);
  } finally { a.done(); }
  const b = rig('rename');
  try {
    const m = await run(b); assert.equal(m.mode, 'rename');
    beginCheck(b); const r = rollbackMove(b);
    assertStartable(b, r.dataDir, 'rollback/rename'); assert.equal(existsSync(b.to), false);
  } finally { b.done(); }
});
