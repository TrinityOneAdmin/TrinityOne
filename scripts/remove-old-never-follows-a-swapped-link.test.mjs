// "REMOVE OLD COPY" NEVER FOLLOWS A LINK THE RELAY SWAPS IN, AT ANY DEPTH. Run: node --test scripts/remove-old-never-follows-a-swapped-link.test.mjs
// Audit C H1 (reproduced by the auditor): after a move the relay can still write the old copy, and the root remover re-checked
// only the top folder, then deleted by path, so a subfolder swapped for a link to some other folder was followed and that
// folder's files were deleted. This reproduces it with the REAL removeRecorded: a second process swaps `blobs/` for a link to
// a victim folder as fast as it can while the remover runs. The victim must come through whole, every trial.
// HONEST SCOPE (second audit, N3): this race is a SMOKE test. The old rmSync is unsafe only inside its own recursion, so it
// loses victim files in some runs (the first audit saw it) and none in others (the second saw 0 of 48); this test is green
// against the old code most of the time. The deterministic proof of the fix is the `rm` shape test below.
// Also: the CLI's remove-old runs the deletion AS THE SERVICE USER (runuser delete-tree), root keeping only the journal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeRecorded } from './relay-move-server.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SWAPPER = `
const fs = require('fs'); const [old, victim] = process.argv.slice(1);
const blobs = old + '/blobs', away = old + '/blobs.away';
for (;;) {
  try { fs.renameSync(blobs, away); fs.symlinkSync(victim, blobs); } catch {}
  try { fs.unlinkSync(blobs); fs.renameSync(away, blobs); } catch {}
}`;

function fixture() {
  const w = mkdtempSync(join(tmpdir(), 'trin-race-'));
  const old = join(w, 'old'), live = join(w, 'live'), victim = join(w, 'victim');
  for (const d of [old, live, victim, join(old, 'blobs')]) mkdirSync(d, { recursive: true });
  writeFileSync(join(old, 'MOVED-TO'), 'moved'); writeFileSync(join(old, 'relay-key.json'), JSON.stringify({ sk: 'a', pub: 'P' }));
  for (let i = 0; i < 3000; i++) writeFileSync(join(old, 'blobs', 'f' + i), 'x');
  for (let i = 0; i < 50; i++) writeFileSync(join(victim, 'precious' + i), 'keep');
  return { w, old, live, victim };
}

test('SMOKE: a subfolder swapped for a link to another folder, while the remover runs, costs that folder nothing (3 trials)', async () => {
  for (let trial = 0; trial < 3; trial++) {
    const f = fixture();
    const sw = spawn(process.execPath, ['-e', SWAPPER, f.old, f.victim], { stdio: 'ignore' });
    try {
      await new Promise(r => setTimeout(r, 150));
      removeRecorded({ path: f.old, liveDirs: [f.live], relayPub: 'P' });
    } finally { sw.kill('SIGKILL'); await new Promise(r => setTimeout(r, 100)); }
    assert.equal(readdirSync(f.victim).length, 50, `trial ${trial}: THE REMOVER FOLLOWED A SWAPPED LINK and deleted ${50 - readdirSync(f.victim).length} file(s) outside the old copy`);
    rmSync(f.w, { recursive: true, force: true });
  }
});

test('a link anywhere inside the old copy is unlinked, never entered', () => {
  const f = fixture();
  try {
    rmSync(join(f.old, 'blobs'), { recursive: true }); mkdirSync(join(f.old, 'a/b'), { recursive: true });
    spawnSync('ln', ['-s', f.victim, join(f.old, 'a/b/link')]); spawnSync('ln', ['-s', f.victim, join(f.old, 'toplink')]);
    const r = removeRecorded({ path: f.old, liveDirs: [f.live], relayPub: 'P' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(readdirSync(f.victim).length, 50);
    assert.deepEqual(readdirSync(f.old), ['MOVED-TO']);
  } finally { rmSync(f.w, { recursive: true, force: true }); }
});

test('the CLI deletes through runuser (the service user), root only keeps the journal', () => {
  const f = fixture();
  try {
    const bin = join(f.w, 'bin'); mkdirSync(bin);
    writeFileSync(join(bin, 'runuser'), '#!/usr/bin/env bash\necho "$*" >> "' + join(f.w, 'runuser.log') + '"\nshift 3\nexec "$@"\n', { mode: 0o755 });
    const state = join(f.w, 'state.json');
    writeFileSync(state, JSON.stringify({ dataDir: f.live, relayPub: 'P', move: { state: 'awaiting-confirm', mode: 'copy', from: f.old, to: f.live, relayPub: 'P', oldCopy: { path: f.old, since: new Date().toISOString() } } }));
    writeFileSync(join(f.w, 'req.json'), JSON.stringify({ path: f.old }));
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts/relay-move-server.mjs'), 'remove-old', '--state', state, '--request', join(f.w, 'req.json'), '--live', f.live, '--run-as-user', 'nobody'],
      { encoding: 'utf8', env: { ...process.env, PATH: bin + ':' + process.env.PATH } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(readFileSync(join(f.w, 'runuser.log'), 'utf8'), /-u nobody -- .*relay-move-server\.mjs delete-tree --path /, 'the deletion did not run as the service user');
    assert.deepEqual(readdirSync(f.old), ['MOVED-TO']);
    const j = JSON.parse(readFileSync(state, 'utf8')).move; assert.equal(j.state, 'done'); assert.ok(j.oldCopy.removedAt);
    // a delete-tree that is refused (the live folder) reports it and root records it
    writeFileSync(state, JSON.stringify({ dataDir: f.live, relayPub: 'P', move: { state: 'awaiting-confirm', mode: 'copy', from: f.old, to: f.live, relayPub: 'P', oldCopy: { path: f.live, since: 'x' } } }));
    writeFileSync(join(f.w, 'req.json'), JSON.stringify({ path: f.live }));
    writeFileSync(join(f.live, 'relay-key.json'), '{}');
    const r2 = spawnSync(process.execPath, [join(ROOT, 'scripts/relay-move-server.mjs'), 'remove-old', '--state', state, '--request', join(f.w, 'req.json'), '--live', f.live, '--run-as-user', 'nobody'],
      { encoding: 'utf8', env: { ...process.env, PATH: bin + ':' + process.env.PATH } });
    assert.equal(r2.status, 2); assert.ok(existsSync(join(f.live, 'relay-key.json')));
  } finally { rmSync(f.w, { recursive: true, force: true }); }
});

// ── N3 (second audit): what actually tells the new delete from the old one ───────────────────────────────────────────
// The race above is a SMOKE TEST, not proof. The old rmSync is unsafe only in a window INSIDE its own recursion (between its
// lstat of a subfolder and its readdir), which no outside caller can hit on demand: measured, the old delete lost victim files
// in some runs and none in 48 others, so this test passes against the old code most of the time. What can be asserted
// deterministically is HOW the delete is done: every entry goes through GNU `rm -rf --one-file-system -- <entry>`, which
// walks by open directory descriptor. A `rm` on PATH that records its argv shows that; rmSync never calls it.
test('the delete of every entry is handed to `rm -rf --one-file-system --` (the descriptor-walking delete), not done by path in node', () => {
  const f = fixture();
  const bin = join(f.w, 'bin'); mkdirSync(bin);
  const log = join(f.w, 'rm.log');
  writeFileSync(join(bin, 'rm'), '#!/bin/sh\necho "$@" >> "' + log + '"\nexec /bin/rm "$@"\n', { mode: 0o755 });
  const saved = process.env.PATH; process.env.PATH = bin + ':' + saved;
  try {
    const r = removeRecorded({ path: f.old, liveDirs: [f.live], relayPub: 'P' });
    assert.equal(r.ok, true, JSON.stringify(r));
    const lines = readFileSync(log, 'utf8').trim().split('\n').sort();
    assert.deepEqual(lines, [`-rf --one-file-system -- ${join(f.old, 'blobs')}`, `-rf --one-file-system -- ${join(f.old, 'relay-key.json')}`], 'THE DELETE IS NOT BY rm -rf --one-file-system: it is the by-path delete again');
    assert.deepEqual(readdirSync(f.old), ['MOVED-TO']);
  } finally { process.env.PATH = saved; rmSync(f.w, { recursive: true, force: true }); }
});
test('links planted at depth BEFORE the delete (not a race) are unlinked and their targets are untouched', () => {
  const f = fixture();
  try {
    rmSync(join(f.old, 'blobs'), { recursive: true });
    mkdirSync(join(f.old, 'blobs/deep/deeper'), { recursive: true });
    for (const where of ['blobs/l1', 'blobs/deep/l2', 'blobs/deep/deeper/l3']) spawnSync('ln', ['-s', f.victim, join(f.old, where)]);
    writeFileSync(join(f.old, 'blobs/deep/deeper/real'), 'x');
    const r = removeRecorded({ path: f.old, liveDirs: [f.live], relayPub: 'P' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(readdirSync(f.victim).length, 50, 'a link planted at depth was followed');
    assert.deepEqual(readdirSync(f.old), ['MOVED-TO']);
  } finally { rmSync(f.w, { recursive: true, force: true }); }
});
