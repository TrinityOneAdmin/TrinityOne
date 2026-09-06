// A RELAY MUST FORGET THE CHURCH NAMES IT WAS GIVEN — WITHOUT FORGETTING THE CHURCHES.
// Run: node --test scripts/a-relay-forgets-the-names-it-was-given.test.mjs
//
// Owner's decision 2026-09-04 (reference/DOMAIN.md): a relay holds no church-supplied name; the operator's
// label is a petname derived from the key. The migration that clears names an older build wrote had NO test,
// and an audit of 7f5eed0 then reproduced three faults in it, one of them silent data loss:
//
//   · a CHURCH_NPUB-seeded church lives in CHURCH_PUBS but not in the file's `churches` array, so a rewrite
//     built from that array DROPPED it — and stamping `envMigrated` stopped the env var being folded in
//     again, so on the SECOND boot the congregation was gone and every write of theirs refused;
//   · `{...c}` over a string row (a documented shape) spread it into {"0":"n","1":"p",…};
//   · the top-level `{npub, name}` shape was never cleared.
//
// All three come from rewriting the rows that were read instead of writing the state they were folded into.
// These tests boot a REAL gateway twice, because every one of those faults only shows on the second boot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8849;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function boot(dataDir, env = {}) {
  const p = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '500', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
  for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE + '/status'); if (r.ok) break; } catch {} await sleep(150); }
  const token = JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token;
  const churches = (await (await fetch(BASE + '/config', { headers: { Authorization: 'Bearer ' + token } })).json()).churches;
  p.kill('SIGKILL'); await sleep(250);
  return { churches, log: out, disk: existsSync(join(dataDir, 'church.json')) ? JSON.parse(readFileSync(join(dataDir, 'church.json'), 'utf8')) : null };
}

test('THE REGRESSION: clearing a legacy name must not de-provision an env-seeded church', async () => {
  await requireFreePort(PORT, 'a-relay-forgets-the-names-it-was-given.test.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'trin-forget-'));
  try {
    const fileChurch = npubEncode(getPublicKey(generateSecretKey()));
    const envChurch = npubEncode(getPublicKey(generateSecretKey()));
    writeFileSync(join(dir, 'church.json'), JSON.stringify({
      churches: [{ npub: fileChurch, name: 'St Legacy, Marchwood', by: 'operator', at: 1700000000 }],
    }, null, 2));

    const first = await boot(dir, { CHURCH_NPUB: envChurch });
    assert.equal(first.churches.length, 2, 'fixture: the first boot should serve both churches');

    const second = await boot(dir, { CHURCH_NPUB: envChurch });
    const npubs = second.churches.map(c => c.npub).sort();
    assert.deepEqual(npubs, [fileChurch, envChurch].sort(),
      'a church vanished on the second boot. Clearing the stored names rewrote the file from the rows it had ' +
      'just read — which do not include a CHURCH_NPUB-seeded church — and stamped envMigrated, so the env ' +
      'var was never folded in again. That congregation\'s writes are now refused, silently, and the relay ' +
      'reports itself healthy. Got: ' + JSON.stringify(second.churches.map(c => c.npub)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the stored name is cleared, once, and the file is not churned afterwards', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-forget2-'));
  try {
    const c = npubEncode(getPublicKey(generateSecretKey()));
    writeFileSync(join(dir, 'church.json'), JSON.stringify({ churches: [{ npub: c, name: 'St Identifiable', by: 'operator', at: 1700000000 }] }, null, 2));
    const first = await boot(dir);
    assert.doesNotMatch(JSON.stringify(first.disk), /Identifiable/, 'the church name is still on disk');
    assert.doesNotMatch(JSON.stringify(first.disk), /"name"/, 'church.json still carries a name field');
    assert.match(first.log, /cleared 1 stored church name/, 'it cleared the name without saying so');
    assert.equal(first.disk.churches[0].by, 'operator', 'provenance was dropped — the operator cannot place the row');

    const second = await boot(dir);
    assert.doesNotMatch(second.log, /cleared \d+ stored church name/,
      'it cleared names again on a file that had none. writeChurches ends in a whole-corpus rehydrate, so a ' +
      'migration that fires every boot rescans the corpus every boot.');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a fresh box never stores a name, so the migration never fires for it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-forget3-'));
  try {
    const c = npubEncode(getPublicKey(generateSecretKey()));
    await boot(dir, { CHURCH_NPUB: c });
    const second = await boot(dir, { CHURCH_NPUB: c });
    assert.doesNotMatch(JSON.stringify(second.disk), /"name"/,
      'persistChurches wrote a name of its own, so a brand-new box stores one and then reports on its next ' +
      'boot that an "older build" had stored it');
    assert.doesNotMatch(second.log, /cleared \d+ stored church name/, 'the migration fired on a box that never had a stored name');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the operator label is DERIVED FROM THE KEY — different churches, different labels', async () => {
  // The edited tests assert the label matches a shape and does not move. An audit showed they would all pass
  // over a CONSTANT label, which would defeat the whole point of H4: telling one row from another.
  const dir = mkdtempSync(join(tmpdir(), 'trin-forget4-'));
  try {
    const a = npubEncode(getPublicKey(generateSecretKey()));
    const b = npubEncode(getPublicKey(generateSecretKey()));
    writeFileSync(join(dir, 'church.json'), JSON.stringify({ churches: [{ npub: a }, { npub: b }], envMigrated: true }, null, 2));
    const r = await boot(dir);
    const labels = r.churches.map(c => c.name);
    assert.equal(labels.length, 2);
    assert.ok(labels.every(l => /^[A-Z][a-z]+ [A-Z][a-z]+ \d{4}$/.test(String(l || ''))), 'a row has no usable label: ' + JSON.stringify(labels));
    assert.notEqual(labels[0], labels[1],
      'two different churches were given the SAME label, so the operator cannot tell which row to remove — ' +
      'and removing the wrong one de-provisions a real congregation. That is the state H4 exists to prevent.');

    // …and stable: the same key must give the same label on a later boot, or the operator learns nothing.
    const again = await boot(dir);
    assert.deepEqual(again.churches.map(c => c.name).sort(), labels.slice().sort(), 'the label moved between boots');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a media grant from the FILE survives the rewrite; one from the ENV does not become permanent', async () => {
  // 52ceada made persistChurches carry `media`, because MEDIA_HOSTS is rebuilt from this file and dropping
  // it silently revoked a grant. But MEDIA_HOSTS also holds RELAY_MEDIA_CHURCHES grants, so the union was
  // written back — turning an env grant into a permanent on-disk one, after which removing the variable no
  // longer revoked it. Both directions matter, so both are asserted. Found by audit, 2026-09-05.
  const dirA = mkdtempSync(join(tmpdir(), 'trin-media-a-'));
  const dirB = mkdtempSync(join(tmpdir(), 'trin-media-b-'));
  try {
    const c = npubEncode(getPublicKey(generateSecretKey()));
    const legacy = (extra) => JSON.stringify({ churches: [{ npub: c, name: 'Legacy', by: 'operator', at: 1700000000, ...extra }] }, null, 2);

    writeFileSync(join(dirA, 'church.json'), legacy({ media: true }));
    const a = await boot(dirA);
    assert.equal(a.disk.churches[0].media, true,
      'a media grant written in church.json was dropped by the rewrite, silently revoking it — MEDIA_HOSTS ' +
      'is rebuilt from this file, so what is not written is not granted');

    writeFileSync(join(dirB, 'church.json'), legacy({}));
    const b = await boot(dirB, { RELAY_MEDIA_CHURCHES: c });
    assert.equal(b.disk.churches[0].media, undefined,
      'a grant that came from RELAY_MEDIA_CHURCHES was written to disk, so removing the variable no longer ' +
      'revokes it — an operator setting an env var does not expect it to become permanent');
  } finally { rmSync(dirA, { recursive: true, force: true }); rmSync(dirB, { recursive: true, force: true }); }
});
