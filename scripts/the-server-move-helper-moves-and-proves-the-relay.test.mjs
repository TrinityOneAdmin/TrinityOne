// THE SERVER'S ROOT MOVE HELPER MOVES THE RELAY, PROVES IT IS THE SAME RELAY, OR PUTS IT BACK.
// Run: node --test scripts/the-server-move-helper-moves-and-proves-the-relay.test.mjs
//
// Relay storage plan step 6, test 5 (and the helper half of test 6). Drives the REAL scripts/relay-move.sh, the REAL
// relay-move-server.mjs and relay-move.mjs, relay-datadir-apply.sh, and a REAL gateway process, over a fake root: every
// path is a temp dir (/etc, /var/lib, systemd's folder, fstab, mountinfo), and `systemctl`, `chown` and `runuser` are
// stubs on PATH. The systemctl stub is a small model of the parts of systemd the helper leans on: `stop` kills the real
// relay, `start` spawns it from the folder relay.env names and records WHAT THE JOURNAL SAID AT THAT MOMENT.
//
// What it does NOT prove: systemd's own behaviour (Restart=always, RequiresMountsFor, the path unit firing), a real
// fstab mount, root ownership, or the service user. Those are the step-7 device list on a throwaway VM.
//
// The "drive" must be on a different filesystem from the data folder or the move is a same-volume rename (which the
// server helper refuses, by design). The data lives in the OS temp dir; the drive is made under /mnt/storage. A box with
// no second filesystem SKIPS these tests rather than passing vacuously.
//
// Set HELPER_SCRIPTS=<dir holding scripts/ and node_modules> to run the helper from a copy (the sabotage runs do).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { finalizeEvent, generateSecretKey, verifyEvent } from 'nostr-tools/pure';
import { openStore } from './event-store.mjs';
import { requireFreePort } from './test-ports.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HELPER_DIR = process.env.HELPER_SCRIPTS ? resolve(process.env.HELPER_SCRIPTS) : ROOT;
const PORT = 9061;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UID = process.getuid();

// a second filesystem to act as the drive
function otherDeviceBase() {
  const dev = statSync(tmpdir()).dev;
  for (const c of ['/mnt/storage', '/home', '/var/tmp', '/dev/shm']) {
    try { if (statSync(c).dev !== dev) { const d = mkdtempSync(join(c, 'trin-helper-')); return d; } } catch {}
  }
  return null;
}
const cleanups = [];
after(() => { for (const f of cleanups.reverse()) { try { f(); } catch {} } });

const STUB_SYSTEMCTL = `#!/usr/bin/env bash
B="$TRIN_BOX"
echo "$*" >> "$B/systemctl.log"
cmd="$1"; shift
alive() { [ -f "$B/relay.pid" ] && kill -0 "$(cat "$B/relay.pid")" 2>/dev/null; }
case "$cmd" in
  daemon-reload) exit 0;;
  is-active) for a in "$@"; do last="$a"; done; case "$last" in *-tunnel) exit 3;; esac; alive && exit 0; exit 3;;
  stop)
    if [ -f "$B/refuse-stop" ]; then exit 0; fi
    if alive; then p="$(cat "$B/relay.pid")"; kill "$p" 2>/dev/null; for i in $(seq 1 100); do kill -0 "$p" 2>/dev/null || break; sleep 0.1; done; kill -9 "$p" 2>/dev/null; fi
    rm -f "$B/relay.pid"; exit 0;;
  start)
    case "$1" in *-tunnel) exit 0;; esac
    alive && exit 0
    dd="$(sed -n 's/^TRINITY_DATA_DIR=//p' "$ETC/relay.env" | head -n1)"
    jst="$("$NODE" -e 'try{const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write((o.move&&o.move.state)||"none")}catch{process.stdout.write("none")}' "$STATE")"
    echo "start journal=$jst datadir=$dd" >> "$B/starts.log"
    if [ -f "$B/dont-start-on-new" ] && [ "$dd" != "$ORIG" ]; then exit 0; fi
    env_args=()
    while IFS='=' read -r k v; do [ -n "$k" ] && env_args+=("$k=$v"); done < "$ETC/relay.env"
    cd "$ROOT"
    setsid nohup env "\${env_args[@]}" RELAY_SYNC=0 RELAY_HOST=127.0.0.1 RELAY_NO_OPEN=1 RELAY_DIRECTORY=http://127.0.0.1:9 TRINITY_TAILSCALE_BIN=/nonexistent/tailscale \\
      "$NODE" scripts/gateway.mjs "$PORT" >> "$B/relay.log" 2>&1 < /dev/null 9>&- &    # (systemd would not hand the relay the helper's lock either)
    echo $! > "$B/relay.pid"; exit 0;;
  *) exit 0;;
esac
`;
const STUB_RUNUSER = '#!/usr/bin/env bash\nshift 3\nexec "$@"\n';
const STUB_CHOWN = '#!/usr/bin/env bash\necho "$*" >> "$TRIN_BOX/chown.log"\nexit 0\n';

function rig() {
  const driveBase = otherDeviceBase();
  if (!driveBase) return null;
  const box = mkdtempSync(join(tmpdir(), 'trin-helper-box-'));
  cleanups.push(() => { rmSync(box, { recursive: true, force: true }); rmSync(driveBase, { recursive: true, force: true }); });
  const dir = n => { const p = join(box, n); mkdirSync(p, { recursive: true }); return p; };
  const etc = dir('etc'), state = dir('state'), bin = dir('bin'), sysd = dir('systemd'), data = dir('data'), drive = join(driveBase, 'usb1');
  mkdirSync(drive); chmodSync(drive, 0o755); chmodSync(driveBase, 0o755);
  writeFileSync(join(bin, 'systemctl'), STUB_SYSTEMCTL, { mode: 0o755 });
  writeFileSync(join(bin, 'runuser'), STUB_RUNUSER, { mode: 0o755 });
  writeFileSync(join(bin, 'chown'), STUB_CHOWN, { mode: 0o755 });
  const stateFile = join(state, 'move-state.json');
  writeFileSync(join(etc, 'relay.env'), `TRINITY_DATA_DIR=${data}\nTRINITY_DATA_DIR_PINNED=1\nTRINITY_STORAGE_MODE=server\nTRINITY_STORAGE_STATE=${stateFile}\n`);
  writeFileSync(join(box, 'fstab'), `/dev/sdz1 ${drive} ext4 defaults 0 2\n`);
  writeFileSync(join(box, 'mountinfo'), `361 29 8:33 / ${drive} rw,relatime shared:99 - ext4 /dev/sdz1 rw\n`);
  const env = {
    ...process.env, PATH: bin + ':' + process.env.PATH, TRIN_BOX: box, ETC: etc, STATE: stateFile, NODE: process.execPath, ROOT, PORT: String(PORT), ORIG: data,
    TRINITYONE_DIR: HELPER_DIR, TRINITYONE_ETC: etc, TRINITYONE_STATE_DIR: state, TRINITYONE_SYSTEMD_DIR: sysd, TRINITYONE_FSTAB: join(box, 'fstab'),
    TRINITYONE_MOUNTINFO: join(box, 'mountinfo'), TRINITYONE_ROOT_UID: String(UID), TRINITYONE_OWNER_CHECK_FROM: driveBase, TRINITYONE_USER: 'nobody',
    TRINITYONE_PORT: String(PORT), TRINITYONE_NODE: process.execPath, PROVE_TRIES: '30', PROVE_SLEEP: '0.3',
  };
  const r = { box, etc, state, stateFile, data, drive, driveBase, sysd, env, target: join(drive, 'trinityone-relay') };
  r.systemctl = (...a) => spawnSync(join(bin, 'systemctl'), a, { env, encoding: 'utf8' });
  r.helper = () => { const o = spawnSync('bash', [join(HELPER_DIR, 'scripts/relay-move.sh')], { env, encoding: 'utf8', timeout: 120000 }); r.lastOutput = (o.stdout || '') + (o.stderr || ''); if (process.env.DEBUG_HELPER) console.error(r.lastOutput); return o; };
  r.journal = () => { try { return JSON.parse(readFileSync(stateFile, 'utf8')); } catch { return null; } };
  r.log = f => { try { return readFileSync(join(box, f), 'utf8'); } catch { return ''; } };
  r.relayEnv = () => Object.fromEntries(readFileSync(join(etc, 'relay.env'), 'utf8').split('\n').filter(Boolean).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
  return r;
}
async function up(timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return true; } catch {} await sleep(150); }
  return false;
}
async function down(timeoutMs = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { try { await fetch(`http://127.0.0.1:${PORT}/status`); } catch { return true; } await sleep(150); }
  return false;
}
// the relay's own pid is in box/relay.pid; always make sure it is gone when a scenario ends
function killRelay(r) { try { const p = Number(readFileSync(join(r.box, 'relay.pid'), 'utf8')); process.kill(p, 'SIGKILL'); } catch {} }

// seed a first-run relay folder: start it once (it makes its identity key, admin token and database), stop it, put real
// signed records in the real store, start it again
async function seedAndRun(r, events = 25) {
  await requireFreePort(PORT, 'the server move helper test');
  assert.equal(r.systemctl('start', 'trinityone-relay').status, 0);
  assert.ok(await up(), 'the first relay never came up:\n' + r.log('relay.log'));
  r.systemctl('stop', 'trinityone-relay'); assert.ok(await down(), 'the relay did not stop');
  const st = openStore(join(r.data, 'relay.sqlite'), { maxEvents: 500 });
  const author = generateSecretKey(), t0 = Math.floor(Date.now() / 1000) - 3600;
  for (let i = 0; i < events; i++) st.put(finalizeEvent({ kind: 1, created_at: t0 + i, tags: [], content: 'record ' + i }, author), '');
  st.close();
  assert.equal(r.systemctl('start', 'trinityone-relay').status, 0);
  assert.ok(await up(), 'the relay did not come back up');
  const key = JSON.parse(readFileSync(join(r.data, 'relay-key.json'), 'utf8'));
  return { pub: key.pub, events };
}
function writeMoveRequest(r, extra = {}) {
  // exactly the shape gateway.mjs writes (storageWriteRequest), tmp + rename
  const o = { drive: r.drive, target: r.target, from: r.data, relayPub: 'ignored-by-the-helper', events: 25, sizeBytes: 1, sameDrive: false, warn: [], mode: 'server', requestedAt: new Date().toISOString(), ...extra };
  writeFileSync(join(r.data, '.move-request.tmp-1'), JSON.stringify(o) + '\n'); renameTmp(join(r.data, '.move-request.tmp-1'), join(r.data, '.move-request'));
}
const renameTmp = (a, b) => spawnSync('mv', [a, b]);
async function identityOK(pub) {
  const nonce = 'ab'.repeat(16);
  const j = await (await fetch(`http://127.0.0.1:${PORT}/relay-identity?nonce=${nonce}`)).json();
  return verifyEvent(j.proof) && j.proof.pubkey === pub && j.proof.tags.some(t => t[0] === 'nonce' && t[1] === nonce);
}
async function adminGet(r, path) {
  const tok = JSON.parse(readFileSync(join(r.relayEnv().TRINITY_DATA_DIR, 'admin.json'), 'utf8')).token;
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { headers: { Authorization: 'Bearer ' + tok } });
  return { status: res.status, j: await res.json() };
}
const eventCount = dir => { const db = new DatabaseSync(join(dir, 'relay.sqlite'), { readOnly: true }); try { return Number(db.prepare('SELECT count(*) AS n FROM events').get().n); } finally { db.close(); } };

function withRig(name, fn) {
  test(name, async t => {
    const r = rig();
    if (!r) { t.skip('no second filesystem on this machine to act as the drive'); return; }
    try { await fn(r); } finally { killRelay(r); await sleep(300); }
  });
}

withRig('a move request: the helper stops the relay ITSELF, moves it, starts it, proves it is the same relay — and the move stands', async r => {
  const { pub, events } = await seedAndRun(r);
  writeMoveRequest(r);
  const res = r.helper();
  assert.equal(res.status, 0, res.stderr);

  const calls = r.log('systemctl.log').split('\n').filter(l => /^(stop|start) /.test(l));
  const stopAt = calls.findIndex(l => l === 'stop trinityone-relay');
  assert.ok(stopAt >= 0, 'THE HELPER NEVER STOPPED THE RELAY UNIT. The unit has Restart=always: the relay\'s own exit 0 would be restarted. calls: ' + calls.join(' | '));
  assert.ok(calls.indexOf('start trinityone-relay', stopAt) > stopAt, 'no start after the stop: ' + calls.join(' | '));

  // the relay that came back is the new folder\'s, and it is the SAME relay
  assert.ok(await up(), 'the relay is not running after the move:\n' + r.log('relay.log').slice(-1500));
  assert.equal(r.relayEnv().TRINITY_DATA_DIR, r.target, 'relay.env does not name the new folder');
  assert.equal(r.relayEnv().TRINITY_DATA_DIR_PINNED, '1');
  assert.equal(r.relayEnv().TRINITY_STORAGE_MODE, 'server');
  assert.ok(await identityOK(pub), 'the relay on the new folder does not prove the old relay\'s identity key');
  assert.equal(JSON.parse(readFileSync(join(r.target, 'relay-key.json'), 'utf8')).pub, pub);
  assert.ok(eventCount(r.target) >= events, 'the new folder holds fewer records than the old one');
  assert.equal(eventCount(r.data), eventCount(r.target), 'the old copy and the new folder disagree about how many records there are');

  // the old folder can never be started: it is marked, and still holds the data (a copy: kept until the steward removes it)
  assert.ok(existsSync(join(r.data, 'MOVED-TO')), 'no MOVED-TO in the old folder');
  assert.ok(existsSync(join(r.data, 'relay.sqlite')), 'the old copy was not kept');

  // permissions
  assert.equal(statSync(r.target).mode & 0o777, 0o700, 'the data folder is not 0700');
  for (const f of ['admin.json', 'relay-key.json']) assert.equal(statSync(join(r.target, f)).mode & 0o777, 0o600, f + ' is not 0600');
  // move-state.json must be readable by the relay user, and GET /storage must be able to show it
  assert.ok((statSync(r.stateFile).mode & 0o044) === 0o044, 'move-state.json is not world-readable: the relay user could not show the move');
  const j = r.journal(); assert.equal(j.move.state, 'awaiting-confirm'); assert.equal(j.dataDir, r.target);
  const g = await adminGet(r, '/storage');
  assert.equal(g.status, 200); assert.equal(g.j.move.state, 'awaiting-confirm');
  assert.equal(g.j.oldCopy.path, r.data); assert.equal(g.j.oldCopy.exists, true);

  // systemd drop-ins + the 78 rule
  const rw = readFileSync(join(r.sysd, 'trinityone-relay.service.d/50-data-dir.conf'), 'utf8');
  assert.match(rw, new RegExp('ReadWritePaths=' + r.target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\n'));
  assert.match(rw, new RegExp('RequiresMountsFor=' + r.target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(readFileSync(join(r.sysd, 'trinityone-update.path.d/50-data-dir.conf'), 'utf8'), new RegExp('PathExists=' + r.target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/.update-request'));
  assert.match(readFileSync(join(r.sysd, 'trinityone-move.path.d/50-data-dir.conf'), 'utf8'), /\.move-request\nPathExists=.*\.remove-old-request/);
  assert.match(readFileSync(join(r.sysd, 'trinityone-relay.service.d/10-refused-data-folder.conf'), 'utf8'), /RestartPreventExitStatus=78/);
  // one-shot: the helper never re-creates the request, in either folder
  assert.equal(existsSync(join(r.data, '.move-request')), false); assert.equal(existsSync(join(r.target, '.move-request')), false);
});

withRig('beginCheck runs BEFORE the relay is started on the new folder (the exact counts are on record first)', async r => {
  await seedAndRun(r);
  writeMoveRequest(r);
  assert.equal(r.helper().status, 0);
  const starts = r.log('starts.log').split('\n').filter(Boolean);
  const onNew = starts.filter(l => l.includes('datadir=' + r.target));
  assert.ok(onNew.length >= 1, 'the relay was never started on the new folder: ' + starts.join(' | '));
  assert.match(onNew[0], /journal=checking/, 'THE RELAY WAS STARTED BEFORE beginCheck: at its start the journal said "' + (onNew[0] || '') + '". The exact row counts must be recorded while nothing has run on the new folder.');
  const j = r.journal().move;
  assert.ok(j.preStartCounts && j.preStartCounts.events >= 25, 'no pre-start counts were recorded: ' + JSON.stringify(j.preStartCounts));
});

withRig('a failed check rolls the move back: relay.env, the old folder and the identity all return', async r => {
  const { pub, events } = await seedAndRun(r);
  writeFileSync(join(r.box, 'dont-start-on-new'), '');           // the relay on the new folder never comes up
  r.env.PROVE_TRIES = '2'; r.env.PROVE_SLEEP = '0.2';
  writeMoveRequest(r);
  const res = r.helper();
  assert.equal(res.status, 0, res.stderr);
  assert.equal(r.relayEnv().TRINITY_DATA_DIR, r.data, 'relay.env still names the NEW folder after the rollback');
  assert.equal(existsSync(join(r.data, 'MOVED-TO')), false, 'the old folder is still marked MOVED-TO: the relay would refuse to start');
  rmSync(join(r.box, 'dont-start-on-new'));
  assert.ok(await up(), 'the relay is not running on the old folder after the rollback:\n' + r.log('relay.log').slice(-1500));
  assert.ok(await identityOK(pub), 'the identity did not survive the rollback');
  assert.equal(eventCount(r.data), events);
  assert.equal(r.journal().move.state, 'rolled-back');
  assert.equal(existsSync(r.target), false, 'a startable copy was left at the target path');
  assert.ok(readdirSync(r.drive).some(n => n.startsWith('trinityone-relay-failed-')), 'the new folder was not set aside for diagnosis');
});

withRig('a request the helper does not accept is refused, recorded where GET /storage shows it, and the relay is started again', async r => {
  await seedAndRun(r);
  writeFileSync(join(r.box, 'fstab'), '# nothing\n');           // the drive is not an fstab mount
  writeMoveRequest(r);
  const res = r.helper();
  assert.equal(res.status, 0, res.stderr);
  assert.ok(await up(), 'the relay was left stopped after a refused request');
  assert.equal(r.relayEnv().TRINITY_DATA_DIR, r.data);
  assert.equal(existsSync(join(r.data, '.move-request')), false, 'the request was not consumed (the path unit would loop)');
  assert.equal(existsSync(join(r.data, 'MOVED-TO')), false);
  const g = await adminGet(r, '/storage');
  assert.equal(g.j.move.code, 'not-in-fstab', 'the refusal code is not where the card can read it: ' + JSON.stringify(g.j.move));
  assert.equal(g.j.move.state, 'failed');
  assert.equal(existsSync(join(r.drive, 'trinityone-relay')), false, 'a leaf was left on a drive the helper refused');
});

withRig('remove old copy: deletes only the recorded old copy, keeps the MOVED-TO note, marks it removed; the live relay is never stopped', async r => {
  const { pub } = await seedAndRun(r);
  writeMoveRequest(r);
  assert.equal(r.helper().status, 0);
  assert.ok(await up());
  const callsBefore = r.log('systemctl.log').split('\n').length;
  // 1) a path nobody recorded
  writeFileSync(join(r.target, '.remove-old-request'), JSON.stringify({ path: r.etc }) + '\n');
  assert.equal(r.helper().status, 0);
  assert.ok(existsSync(r.etc), 'removed a folder the journal never recorded');
  assert.equal(r.journal().move.refusal.code, 'remove-not-recorded');
  // 2) the live folder
  writeFileSync(join(r.target, '.remove-old-request'), JSON.stringify({ path: r.target }) + '\n');
  assert.equal(r.helper().status, 0);
  assert.ok(existsSync(join(r.target, 'relay-key.json')), 'THE LIVE FOLDER WAS EMPTIED');
  // 3) the recorded old copy
  writeFileSync(join(r.target, '.remove-old-request'), JSON.stringify({ path: r.data }) + '\n');
  assert.equal(r.helper().status, 0);
  assert.deepEqual(readdirSync(r.data), ['MOVED-TO'], 'the old copy was not removed down to its tombstone');
  const j = r.journal().move;
  assert.equal(j.state, 'done'); assert.ok(j.oldCopy.removedAt, 'the old copy was not marked removedAt');
  assert.equal(existsSync(join(r.target, '.remove-old-request')), false, 'the remove request was not consumed');
  assert.ok(await identityOK(pub), 'the live relay was disturbed by the removal');
  const stops = r.log('systemctl.log').split('\n').slice(callsBefore - 1).filter(l => l.startsWith('stop'));
  assert.deepEqual(stops, [], 'removing an old copy stopped the relay');
  const g = await adminGet(r, '/storage');
  assert.equal(g.j.oldCopy, null, 'GET /storage still offers the removed old copy');
});

withRig('the move helper refuses to act when the relay unit will not stop (nothing is touched)', async r => {
  await seedAndRun(r);
  writeFileSync(join(r.box, 'refuse-stop'), '');
  writeMoveRequest(r);
  assert.equal(r.helper().status, 0);
  assert.equal(r.relayEnv().TRINITY_DATA_DIR, r.data);
  assert.equal(existsSync(join(r.data, 'MOVED-TO')), false);
  assert.equal(existsSync(join(r.drive, 'trinityone-relay')), false);
  assert.equal(r.journal().move.code, 'could-not-stop');
});
