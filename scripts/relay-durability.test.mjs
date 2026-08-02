// TWO WAYS A CHURCH'S DATA GOES MISSING WITHOUT ANYTHING COMPLAINING.
// Run: node --test scripts/relay-durability.test.mjs
//
// 1. THE CHURCH REGISTRATION. CHURCH_NPUB is a SEED, migrated into church.json — but the migration only ran
//    when something else happened to save. A relay set up the way RELAY-SETUP.md documents (env var, never
//    touched the dashboard) therefore had no church.json at all, and /relay-backup tars the data dir, so the
//    archive could not contain what was never written. Restore onto a new box without remembering the
//    variable and the relay comes up not knowing which church it serves: the write policy is OFF — an OPEN
//    relay anyone may write to — and the congregation cannot read its own membership. It reports itself
//    healthy throughout.
//
// 2. THE SIDE FILE. In WAL mode rows land in `relay.sqlite-wal` and are folded into the main file later, so
//    on a small church the entire corpus can sit in the -wal indefinitely — measured at `relay.sqlite` 4 KB
//    against `-wal` 1.1 MB for a live 27-event church. Nothing closed the store on shutdown, so a hand-copied
//    `relay.sqlite` opened WITHOUT ERROR and contained NOTHING. reference/PILOT-CHECKLIST.md names that exact
//    file as the one holding all church data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, copyFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { openStore } from './event-store.mjs';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8966;                       // unique across scripts/*.test.mjs and *.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K();
let relay, dataDir;

before(async () => {
  await requireFreePort(PORT, 'relay-durability.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-durability-'));
  // Configured the way the setup guide documents: by environment variable, never through the dashboard.
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '20000', CHURCH_NPUB: npubEncode(church.pub) },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

async function publish(keys, content) {
  const w = await new Promise((res, rej) => { const x = new WebSocket(WS_URL); x.on('open', () => res(x)); x.on('error', rej); });
  const ev = finalizeEvent({ kind: 1, created_at: now(), tags: [['t', 'trinityone'], ['p', church.pub]], content }, keys.sk);
  const ok = await new Promise(res => {
    const on = d => { const m = JSON.parse(d);
      if (m[0] === 'AUTH') w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(),
        tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, keys.sk)]));
      if (m[0] === 'OK' && m[1] === ev.id) { w.off('message', on); res(!!m[2]); } };
    w.on('message', on); w.send(JSON.stringify(['EVENT', ev]));
    setTimeout(() => res(false), 6000);
  });
  w.close();
  return ok;
}

test('a church configured by environment variable is written to disk, so a backup can carry it', () => {
  const f = join(dataDir, 'church.json');
  assert.ok(existsSync(f),
    'the relay knows which church it serves but has written nothing to disk, so /relay-backup — which tars '
    + 'the data directory — cannot include it. Restore that archive onto a new box and the relay comes up as '
    + 'an OPEN relay with the congregation locked out of its own membership, reporting itself healthy.');
  const j = JSON.parse(readFileSync(f, 'utf8'));
  const npubs = (j.churches || []).map(c => c.npub);
  assert.ok(npubs.includes(npubEncode(church.pub)), 'church.json does not name the church: ' + JSON.stringify(j));
  assert.equal(j.envMigrated, true,
    'without the envMigrated stamp the env var is folded in again on the next boot, which is what resurrects '
    + 'a church the operator deliberately removed');
});

test('a clean shutdown folds the side file in, so the database file is the database', async () => {
  assert.equal(await publish(church, 'a message the church would expect to keep'), true, 'fixture: publish failed');
  await sleep(400);

  // What a runbook, a snapshot, or a careful person does: copy "the relay database".
  const main = join(dataDir, 'relay.sqlite');
  const wal = join(dataDir, 'relay.sqlite-wal');
  const walBefore = existsSync(wal) ? statSync(wal).size : 0;

  // Stop it the way a service manager does — SIGTERM, not SIGKILL.
  relay.kill('SIGTERM');
  const t0 = Date.now();
  while (Date.now() - t0 < 15000 && relay.exitCode === null && relay.signalCode === null) await sleep(100);
  await sleep(500);

  const copy = join(dataDir, 'hand-copied.sqlite');
  copyFileSync(main, copy);
  const store = openStore(copy, { maxEvents: 20000 });
  const n = store.count();
  store.close();

  assert.ok(n > 0,
    `a copy of relay.sqlite taken after a clean shutdown holds ${n} events. The church's data is still in the `
    + `side file (${walBefore} bytes of it before the stop), and this copy opens WITHOUT ERROR and reports an `
    + 'empty church — which is indistinguishable from a church that never had anything. PILOT-CHECKLIST.md '
    + 'names this exact file as the one holding all church data.');
});
