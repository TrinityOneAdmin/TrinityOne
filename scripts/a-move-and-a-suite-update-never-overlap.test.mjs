// A DATA MOVE AND THE SUITE'S CODE UPDATE NEVER OVERLAP — the panel's half.
// Run: node --test scripts/a-move-and-a-suite-update-never-overlap.test.mjs
//
// The Rust shell refuses a move itself while it applies an update or while an update's restore holds the church's
// data aside (launcher move_blocked; the apply harness's launcher scenarios). This is the card's half: the REAL
// gateway's GET /storage names why a move must wait, and POST /storage/move refuses with no request written.
//   suite-update-applying — suite/apply-in-progress (the shell holds it for the whole of an apply)
//   suite-data-held-aside — relay.sqlite*.restore-aside (an update's restore could not finish)
//   suite-update-due      — an update is staged, the switch is on and its window is open now (the shell's own rule)
// The decision function is LIFTED from gateway.mjs and run (rule 3), and the route is driven on a real gateway (rule 1).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireFreePort } from './test-ports.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 9071;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const procs = [], dirs = [];
after(() => { for (const p of procs) try { p.kill('SIGKILL'); } catch {} for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = name => { const d = mkdtempSync(join(tmpdir(), 'trin-mvupd-' + name + '-')); dirs.push(d); return d; };

// the shipped function, lifted between its markers and run
const SRC = readFileSync(join(ROOT, 'scripts/gateway.mjs'), 'utf8');
const body = SRC.slice(SRC.indexOf('// SUITE-UPDATE-BLOCKS-MOVE-BEGIN'), SRC.indexOf('// SUITE-UPDATE-BLOCKS-MOVE-END'));
assert.ok(body.includes('function suiteUpdateBlocksMove('), 'the markers moved: the lifted function is missing');
const suiteUpdateBlocksMove = new Function('existsSync', 'readFileSync', 'join', body + '\nreturn suiteUpdateBlocksMove;')(existsSync, readFileSync, join);

const at = (hh, mm, d = 13) => new Date(2026, 10, d, hh, mm);
function box({ marker = '03:00\n', ready = true, lastApplied = null } = {}) {
  const d = tmp('unit');
  mkdirSync(join(d, 'suite', 'staging'), { recursive: true });
  if (marker !== null) writeFileSync(join(d, 'suite-autoupdate'), marker);
  if (ready) writeFileSync(join(d, 'suite', 'staging', 'READY'), '{"sha":"x"}');
  if (lastApplied !== null) writeFileSync(join(d, 'suite', 'state.json'), JSON.stringify({ lastApplied }));
  return d;
}

test('an apply in progress, and data held aside by an update, each refuse a move', () => {
  const d = box({ marker: null, ready: false });
  assert.deepEqual(suiteUpdateBlocksMove(d, at(12, 0)), [], 'fixture: nothing to wait for');
  writeFileSync(join(d, 'suite', 'apply-in-progress'), '{}');
  assert.deepEqual(suiteUpdateBlocksMove(d, at(12, 0)), ['suite-update-applying']);
  rmSync(join(d, 'suite', 'apply-in-progress'));
  for (const f of ['relay.sqlite', 'relay.sqlite-wal', 'relay.sqlite-shm']) {
    writeFileSync(join(d, f + '.restore-aside'), 'x');
    assert.deepEqual(suiteUpdateBlocksMove(d, at(12, 0)), ['suite-data-held-aside'], f);
    rmSync(join(d, f + '.restore-aside'));
  }
});

test('an update about to be applied refuses a move only inside its window, once per window, the shell\'s rule', () => {
  assert.deepEqual(suiteUpdateBlocksMove(box(), at(3, 30)), ['suite-update-due'], 'staged, on, 03:30 in a 03:00 window');
  assert.deepEqual(suiteUpdateBlocksMove(box(), at(4, 59)), ['suite-update-due'], 'the window is two hours');
  assert.deepEqual(suiteUpdateBlocksMove(box(), at(5, 0)), [], '05:00 is past the window');
  assert.deepEqual(suiteUpdateBlocksMove(box(), at(2, 59)), [], 'before the window');
  assert.deepEqual(suiteUpdateBlocksMove(box({ ready: false }), at(3, 30)), [], 'nothing staged');
  assert.deepEqual(suiteUpdateBlocksMove(box({ marker: null }), at(3, 30)), [], 'auto-update switched off');
  assert.deepEqual(suiteUpdateBlocksMove(box({ lastApplied: '2026-11-13' }), at(3, 30)), [], 'already applied in this window');
  assert.deepEqual(suiteUpdateBlocksMove(box({ lastApplied: '2026-11-12' }), at(3, 30)), ['suite-update-due'], 'applied yesterday only');
  // a window that crosses midnight: 23:30–01:30; at 00:15 it is YESTERDAY's window
  assert.deepEqual(suiteUpdateBlocksMove(box({ marker: '23:30\n', lastApplied: '2026-11-12' }), at(0, 15)), [], 'yesterday\'s window already applied');
  assert.deepEqual(suiteUpdateBlocksMove(box({ marker: '23:30\n', lastApplied: '2026-11-11' }), at(0, 15)), ['suite-update-due']);
  assert.deepEqual(suiteUpdateBlocksMove(box({ marker: 'garbage' }), at(3, 30)), ['suite-update-due'], 'an unreadable time is the shell\'s default 03:00');
});

test('the real gateway: GET /storage names the update, and a move is refused with no request written', async () => {
  await requireFreePort(PORT, 'the move-vs-suite-update storage test');
  const dir = tmp('gw'), home = tmp('home');
  const env = { ...process.env, HOME: home, TRINITY_DATA_DIR: dir, TRINITY_STORAGE_MODE: 'suite', TRINITY_STORAGE_STATE: join(tmp('cfg'), 'storage.json'),
    RELAY_SYNC: '0', RELAY_HOST: '127.0.0.1', RELAY_NO_OPEN: '1', RELAY_DIRECTORY: 'http://127.0.0.1:9', TRINITY_TAILSCALE_BIN: '/nonexistent/tailscale' };
  const p = spawn(process.execPath, [join(ROOT, 'scripts/gateway.mjs'), String(PORT)], { cwd: ROOT, env, stdio: 'ignore' }); procs.push(p);
  for (let i = 0; i < 200; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  const tok = JSON.parse(readFileSync(join(dir, 'admin.json'), 'utf8')).token;
  const call = async (path, method = 'GET', b) => { const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: b && JSON.stringify(b) }); return { status: r.status, j: await r.json() }; };
  try {
    const ours = r => r.filter(c => c.startsWith('suite-'));
    const first = await call('/storage');
    assert.deepEqual(ours(first.j.refuse), [], 'fixture: no update refusal before any update');
    const drive = (first.j.drives[0] || {}).mountpoint;
    assert.ok(drive, 'fixture: the suite card offers at least the home folder');
    mkdirSync(join(dir, 'suite'), { recursive: true });
    for (const [code, make, undo] of [
      ['suite-update-applying', () => writeFileSync(join(dir, 'suite', 'apply-in-progress'), '{}'), () => rmSync(join(dir, 'suite', 'apply-in-progress'))],
      ['suite-data-held-aside', () => writeFileSync(join(dir, 'relay.sqlite.restore-aside'), 'x'), () => rmSync(join(dir, 'relay.sqlite.restore-aside'))],
    ]) {
      make();
      const r = await call('/storage');
      assert.ok(r.j.refuse.includes(code), code + ': ' + JSON.stringify(r.j.refuse));
      const m = await call('/storage/move', 'POST', { drive, acknowledge: ['no-permissions', 'removable'] });
      assert.equal(m.status, 409, code + ': a move was not refused: ' + JSON.stringify(m.j));
      assert.ok((m.j.refuse || []).includes(code), code + ': the refusal does not say why: ' + JSON.stringify(m.j));
      assert.equal(existsSync(join(dir, '.move-request')), false, code + ': a move request was written');
      undo();
      assert.deepEqual(ours((await call('/storage')).j.refuse), [], code + ': still refused after it cleared');
    }
  } finally { p.kill('SIGKILL'); await sleep(300); }
});

// Storage fixes audit of 457541b0, L-4: the REAL gateway's GET /update `suite.heldByRestore` — true only while an update
// is staged (suite/staging/READY) AND a restore waits for the relay's next boot (.restore-pending); the panel's line
// (suite-autoupdate-ui.test.mjs) is keyed on it. Both are created AFTER the boot (a boot consumes .restore-pending).
test('the real gateway: GET /update says a staged update is held back by a waiting restore, and only then', async () => {
  const PORT2 = 9072;
  await requireFreePort(PORT2, 'the heldByRestore test');
  const dir = tmp('hbr');
  const env = { ...process.env, HOME: tmp('home2'), TRINITY_DATA_DIR: dir, RELAY_SYNC: '0', RELAY_HOST: '127.0.0.1', RELAY_NO_OPEN: '1',
    RELAY_DIRECTORY: 'http://127.0.0.1:9', TRINITY_TAILSCALE_BIN: '/nonexistent/tailscale' };
  const p = spawn(process.execPath, [join(ROOT, 'scripts/gateway.mjs'), String(PORT2)], { cwd: ROOT, env, stdio: 'ignore' }); procs.push(p);
  for (let i = 0; i < 200; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT2}/status`)).ok) break; } catch {} await sleep(150); }
  const tok = JSON.parse(readFileSync(join(dir, 'admin.json'), 'utf8')).token;
  const held = async () => { const j = await (await fetch(`http://127.0.0.1:${PORT2}/update`, { headers: { Authorization: 'Bearer ' + tok } })).json(); assert.ok(j.suite, 'no suite status: ' + JSON.stringify(j).slice(0, 200)); return j.suite.heldByRestore; };
  try {
    assert.equal(await held(), false, 'nothing staged, nothing waiting');
    mkdirSync(join(dir, '.restore-pending'));
    assert.equal(await held(), false, 'a restore waits but no update is staged');
    mkdirSync(join(dir, 'suite', 'staging'), { recursive: true });
    writeFileSync(join(dir, 'suite', 'staging', 'READY'), JSON.stringify({ version: 'v2', sha: '2'.repeat(40), date: '2026-10-01T00:00:00Z' }));
    assert.equal(await held(), true, 'an update staged while a restore waits must say so');
    rmSync(join(dir, '.restore-pending'), { recursive: true });
    assert.equal(await held(), false, 'once the restore is done the update is no longer held');
  } finally { p.kill('SIGKILL'); await sleep(300); }
});
