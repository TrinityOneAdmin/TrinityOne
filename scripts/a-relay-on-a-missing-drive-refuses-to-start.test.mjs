// A RELAY ON A MISSING DRIVE MUST REFUSE TO START — NOT COME UP EMPTY AS A STRANGER.
// Run: node --test scripts/a-relay-on-a-missing-drive-refuses-to-start.test.mjs
//
// Relay storage plan, step 1 (risk R1). gateway.mjs used to mkdirSync a missing data folder and then mint a
// new relay-key.json and admin.json. With the data on a drive that is unplugged, or whose Windows letter
// changed, the relay came up EMPTY with a NEW identity — unknown to every church that trusts it (rule 10).
//
// Every test here spawns the REAL gateway process on a temp folder. The refusal tests fail if the guard is
// deleted: the gateway then creates the folder / mints a key / opens a database, and keeps running.
// The boot tests pin today's behaviour for every box that sets no TRINITY_DATA_DIR_PINNED (backward compat).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8863;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = new URL('..', import.meta.url).pathname;
const REFUSED = 78;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function keyFile(dir) {
  const sk = generateSecretKey();
  const k = { sk: Buffer.from(sk).toString('hex'), pub: getPublicKey(sk) };
  writeFileSync(join(dir, 'relay-key.json'), JSON.stringify(k));
  return k.pub;
}
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));

function start(dataDir, env = {}) {
  const p = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '500', RELAY_NO_OPEN: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const r = { p, log: '', code: undefined };
  p.stdout.on('data', d => { r.log += d; }); p.stderr.on('data', d => { r.log += d; });
  r.exited = new Promise(res => p.on('exit', (code) => { r.code = code; res(code); }));
  return r;
}

// Expect a refusal: the process must EXIT with 78 on its own, without ever answering /status.
async function expectRefusal(dataDir, env) {
  await requireFreePort(PORT, 'a-relay-on-a-missing-drive-refuses-to-start.test.mjs');
  const r = start(dataDir, env);
  let answered = false;
  const deadline = Date.now() + 20000;
  while (r.code === undefined && Date.now() < deadline) {
    try { const s = await fetch(BASE + '/status'); if (s.ok) { answered = true; break; } } catch {}
    await sleep(150);
  }
  if (r.code === undefined) { r.p.kill('SIGKILL'); await r.exited; }
  assert.equal(answered, false, 'the relay STARTED and answered /status on a folder it must refuse. Log:\n' + r.log);
  assert.equal(r.code, REFUSED, 'the gateway did not exit with the refusal code ' + REFUSED + ' (got ' + r.code + '). Log:\n' + r.log);
  assert.match(r.log, /RELAY NOT STARTED/, 'the refusal said nothing a volunteer could read in the log');
  return r.log;
}

// Expect a normal boot; returns /status and kills the process.
async function expectBoot(dataDir, env) {
  await requireFreePort(PORT, 'a-relay-on-a-missing-drive-refuses-to-start.test.mjs');
  const r = start(dataDir, env);
  let status = null;
  for (let i = 0; i < 200 && r.code === undefined; i++) {
    try { const s = await fetch(BASE + '/status'); if (s.ok) { status = await s.json(); break; } } catch {}
    await sleep(150);
  }
  r.p.kill('SIGKILL'); await r.exited; await sleep(200);
  assert.ok(status, 'the relay did not start (exit ' + r.code + '). Log:\n' + r.log);
  return { status, log: r.log };
}

test('PINNED + the folder is gone (drive unplugged): refuses, and creates nothing', async () => {
  const base = mkdtempSync(join(tmpdir(), 'trin-r1-gone-'));
  try {
    const dir = join(base, 'Samsung T7', 'trinityone-relay');
    const log = await expectRefusal(dir, { TRINITY_DATA_DIR_PINNED: '1' });
    assert.match(log, /missing/);
    assert.equal(existsSync(dir), false, 'the gateway CREATED the missing data folder — an empty stranger relay under the mount point');
    assert.equal(existsSync(join(base, 'Samsung T7')), false, 'the gateway created a parent of the missing folder');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('PINNED + the folder is another relay\'s (stamp names a different key): refuses, touches nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-r1-foreign-'));
  try {
    const pub = keyFile(dir);
    const other = getPublicKey(generateSecretKey());
    writeFileSync(join(dir, '.trinity-data-dir'), JSON.stringify({ relayPub: other }));
    const log = await expectRefusal(dir, { TRINITY_DATA_DIR_PINNED: '1' });
    assert.match(log, /different relay/);
    assert.equal(readJson(join(dir, 'relay-key.json')).pub, pub, 'the relay key was replaced');
    assert.equal(readJson(join(dir, '.trinity-data-dir')).relayPub, other, 'the stamp was rewritten — the evidence is gone');
    assert.equal(existsSync(join(dir, 'admin.json')), false, 'an admin token was minted in a refused folder');
    assert.equal(existsSync(join(dir, 'relay.sqlite')), false, 'a database was created in a refused folder');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('PINNED + the folder has files but no relay key: refuses, mints none', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-r1-nokey-'));
  try {
    writeFileSync(join(dir, 'church.json'), JSON.stringify({ churches: [] }));
    await expectRefusal(dir, { TRINITY_DATA_DIR_PINNED: '1' });
    assert.equal(existsSync(join(dir, 'relay-key.json')), false, 'a NEW relay identity was minted in a pinned folder');
    assert.equal(existsSync(join(dir, 'admin.json')), false, 'an admin token was minted in a pinned folder');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MOVED-TO in the folder: refuses even when NOT pinned, and names where the data went', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-r1-moved-'));
  try {
    const pub = keyFile(dir);
    writeFileSync(join(dir, 'MOVED-TO'), "This relay's data moved to /media/church/Samsung T7/trinityone-relay on 2026-11-13.\n");
    const log = await expectRefusal(dir, {});
    assert.match(log, /\/media\/church\/Samsung T7\/trinityone-relay/, 'the refusal does not say where the data moved to');
    assert.equal(readJson(join(dir, 'relay-key.json')).pub, pub);
    assert.equal(existsSync(join(dir, 'relay.sqlite')), false, 'a database was opened in a moved-out folder');
    assert.equal(existsSync(join(dir, 'admin.json')), false, 'an admin token was minted in a moved-out folder');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MOVED-TO refuses under PINNED too', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-r1-moved2-'));
  try {
    const pub = keyFile(dir);
    writeFileSync(join(dir, '.trinity-data-dir'), JSON.stringify({ relayPub: pub }));
    writeFileSync(join(dir, 'MOVED-TO'), 'moved to D:\\TrinityOne Relay Data');
    const log = await expectRefusal(dir, { TRINITY_DATA_DIR_PINNED: '1' });
    assert.match(log, /moved/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('NOT pinned, fresh box: a missing folder is still created (as today) and stamped with the key it mints', async () => {
  const base = mkdtempSync(join(tmpdir(), 'trin-r1-fresh-'));
  try {
    const dir = join(base, 'data');
    const { status } = await expectBoot(dir, {});
    assert.ok(existsSync(dir), 'the first-install path no longer creates the data folder');
    const pub = readJson(join(dir, 'relay-key.json')).pub;
    assert.equal(readJson(join(dir, '.trinity-data-dir')).relayPub, pub, 'a fresh folder was not stamped with its own key');
    assert.equal(status.relayPub, pub, '/status serves a different key from the one on disk');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('NOT pinned, an existing box upgrading (key, no stamp): adopted once, key unchanged — and then boots pinned', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-r1-adopt-'));
  try {
    const pub = keyFile(dir);
    writeFileSync(join(dir, 'admin.json'), JSON.stringify({ token: 'existing-token' }));
    await expectBoot(dir, {});
    assert.equal(readJson(join(dir, 'relay-key.json')).pub, pub, 'upgrading replaced the relay identity');
    assert.equal(readJson(join(dir, 'admin.json')).token, 'existing-token', 'upgrading replaced the admin token');
    const stamp = readJson(join(dir, '.trinity-data-dir'));
    assert.equal(stamp.relayPub, pub, 'the existing folder was not adopted');
    // second boot does not rewrite it
    await expectBoot(dir, {});
    assert.deepEqual(readJson(join(dir, '.trinity-data-dir')), stamp, 'the stamp was rewritten on a later boot');
    // and the stamped folder satisfies a pinned launcher
    await expectBoot(dir, { TRINITY_DATA_DIR_PINNED: '1' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('PINNED + an existing folder with a key and no stamp: adopted (the one-time migration), not refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-r1-adopt-pinned-'));
  try {
    const pub = keyFile(dir);
    await expectBoot(dir, { TRINITY_DATA_DIR_PINNED: '1' });
    assert.equal(readJson(join(dir, '.trinity-data-dir')).relayPub, pub);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a staged restore of ANOTHER relay\'s backup (no stamp in it) is not refused, even pinned: re-stamped to the restored key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-r1-restore-'));
  try {
    const oldPub = keyFile(dir);
    writeFileSync(join(dir, '.trinity-data-dir'), JSON.stringify({ relayPub: oldPub }));
    const staging = join(dir, '.restore-pending'); mkdirSync(staging);
    const newPub = keyFile(staging);
    writeFileSync(join(staging, 'MOVED-TO'), 'a tombstone that must not be imported');
    await expectBoot(dir, { TRINITY_DATA_DIR_PINNED: '1' });
    assert.equal(readJson(join(dir, 'relay-key.json')).pub, newPub, 'the restore did not apply');
    assert.equal(readJson(join(dir, '.trinity-data-dir')).relayPub, newPub, 'the folder was not re-stamped to the restored key');
    assert.equal(existsSync(join(dir, 'MOVED-TO')), false, 'a backup imported a MOVED-TO tombstone');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Audit A finding 7: a launcher that pins on the very first run creates an EMPTY folder; that must start.
test('PINNED + an existing, COMPLETELY EMPTY folder (first run): starts, makes its key, stamps it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-r1-fresh-pinned-'));
  try {
    const { status } = await expectBoot(dir, { TRINITY_DATA_DIR_PINNED: '1' });
    const pub = readJson(join(dir, 'relay-key.json')).pub;
    assert.equal(status.relayPub, pub);
    assert.equal(readJson(join(dir, '.trinity-data-dir')).relayPub, pub, 'the fresh pinned folder was not stamped');
    await expectBoot(dir, { TRINITY_DATA_DIR_PINNED: '1' });   // and starts again, pinned, on the stamped folder
    assert.equal(readJson(join(dir, 'relay-key.json')).pub, pub, 'the second pinned boot changed the key');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Audit A finding 13: a backup carrying a .trinity-data-dir WITHOUT its matching key must not import that stamp.
test('a staged restore with a foreign stamp and no key: the stamp is not imported, a pinned relay still starts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-r1-restore-stamp-'));
  try {
    const pub = keyFile(dir);
    writeFileSync(join(dir, '.trinity-data-dir'), JSON.stringify({ relayPub: pub }));
    const staging = join(dir, '.restore-pending'); mkdirSync(staging);
    writeFileSync(join(staging, 'church.json'), JSON.stringify({ churches: [] }));
    writeFileSync(join(staging, '.trinity-data-dir'), JSON.stringify({ relayPub: getPublicKey(generateSecretKey()) }));
    await expectBoot(dir, { TRINITY_DATA_DIR_PINNED: '1' });
    assert.equal(readJson(join(dir, '.trinity-data-dir')).relayPub, pub, 'a foreign stamp was imported from the backup');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a staged restore whose key and stamp DISAGREE: the stamp is dropped and re-made from the restored key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-r1-restore-mismatch-'));
  try {
    keyFile(dir);
    const staging = join(dir, '.restore-pending'); mkdirSync(staging);
    const newPub = keyFile(staging);
    writeFileSync(join(staging, '.trinity-data-dir'), JSON.stringify({ relayPub: getPublicKey(generateSecretKey()) }));
    await expectBoot(dir, { TRINITY_DATA_DIR_PINNED: '1' });
    assert.equal(readJson(join(dir, '.trinity-data-dir')).relayPub, newPub);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Audit A finding 10: a move must not run against a folder a live relay holds, even if the caller's port check
// says the relay is stopped (wrong port, second process). The REAL gateway marks the folder; the REAL mover reads it.
test('a running relay marks its folder, and the mover refuses it even when told the relay is stopped', async () => {
  const { moveRelayData, jsonPointer, jsonFieldStore, LEAF } = await import('./relay-move.mjs');
  const base = mkdtempSync(join(tmpdir(), 'trin-r1-lock-'));
  const dir = join(base, 'data'); mkdirSync(dir);
  await requireFreePort(PORT, 'a-relay-on-a-missing-drive-refuses-to-start.test.mjs');
  const r = start(dir, {});
  try {
    let up = false;
    for (let i = 0; i < 200 && r.code === undefined; i++) { try { if ((await fetch(BASE + '/status')).ok) { up = true; break; } } catch {} await sleep(150); }
    assert.ok(up, 'relay did not start. ' + r.log);
    assert.equal(readJson(join(dir, '.relay-lock')).pid, r.p.pid, 'the gateway did not mark its data folder as in use');
    mkdirSync(join(base, 'drive'));
    const cfg = join(base, 'storage.json');
    const res = await moveRelayData({ from: dir, to: join(base, 'drive', LEAF), pointer: jsonPointer(cfg), journal: jsonFieldStore(cfg, 'move'), relayRunning: async () => false, mounts: null });
    assert.equal(res.ok, false, 'the mover moved a folder a live relay is writing to');
    assert.equal(res.code, 'relay-running');
  } finally { if (r.code === undefined) { r.p.kill('SIGKILL'); await r.exited; } rmSync(base, { recursive: true, force: true }); }
});
