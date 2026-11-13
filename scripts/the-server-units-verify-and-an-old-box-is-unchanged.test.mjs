// THE SERVER UNITS ARE VALID SYSTEMD, AND AN EXISTING BOX IS UNCHANGED BY install.sh. Run: node --test scripts/the-server-units-verify-and-an-old-box-is-unchanged.test.mjs
// Relay storage plan step 6, test 6 (install.sh half). Renders install.sh's OWN unit heredocs through bash, writes the
// drop-ins with the real relay-datadir-apply.sh (stubbed systemctl, temp dirs), and runs `systemd-analyze verify` (no root
// needed) on them. Lifts install.sh's "where the data lives" block and runs it. NOT proven here: systemd actually
// honouring the drop-ins on a booted box (step-7 VM list).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SH = readFileSync(join(ROOT, 'relay-app/install.sh'), 'utf8');
function heredoc(target) {
  const start = SH.indexOf(`cat > "${target}" <<UNIT`); assert.ok(start >= 0, 'install.sh no longer writes ' + target);
  const end = SH.indexOf('\nUNIT\n', start); return SH.slice(start, end + 6).replace(/cat > "[^"]+" <<UNIT/, 'cat <<UNIT');
}
const render = (target, pre) => { const r = spawnSync('bash', ['-c', pre + '\n' + heredoc(target)], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
const PRE = `SVC=trinityone-relay; SVC_USER=nobody; DIR=${ROOT.replace(/\/$/, '')}; NODE_BIN=${process.execPath}; PORT=8000; DATA=$DIR/relay; RELAY_ENV=/etc/trinityone/relay.env`;

test('every unit install.sh writes verifies as systemd, with the drop-ins relay-datadir-apply.sh writes beside them', () => {
  const w = mkdtempSync(join(tmpdir(), 'trin-units-'));
  try {
    const sysd = join(w, 'systemd'), bin = join(w, 'bin'); mkdirSync(sysd); mkdirSync(bin);
    writeFileSync(join(bin, 'systemctl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const units = { 'trinityone-relay.service': '/etc/systemd/system/$SVC.service', 'trinityone-update.service': '/etc/systemd/system/trinityone-update.service',
      'trinityone-update.path': '/etc/systemd/system/trinityone-update.path', 'trinityone-move.service': '/etc/systemd/system/trinityone-move.service',
      'trinityone-move.path': '/etc/systemd/system/trinityone-move.path',
      'trinityone-move-recover.service': '/etc/systemd/system/trinityone-move-recover.service', 'trinityone-move-finish.service': '/etc/systemd/system/trinityone-move-finish.service' };
    for (const [n, t] of Object.entries(units)) writeFileSync(join(sysd, n), render(t, PRE));
    const ap = spawnSync('bash', [join(ROOT, 'scripts/relay-datadir-apply.sh'), '/mnt/church-disk/trinityone-relay'], { encoding: 'utf8',
      env: { ...process.env, PATH: bin + ':' + process.env.PATH, TRINITYONE_ETC: join(w, 'etc'), TRINITYONE_STATE_DIR: join(w, 'state'), TRINITYONE_SYSTEMD_DIR: sysd } });
    assert.equal(ap.status, 0, ap.stderr);
    const v = spawnSync('systemd-analyze', ['verify', ...Object.keys(units).map(n => join(sysd, n))], { encoding: 'utf8' });
    // trinityone-update.service etc. name units in the real /etc; only complaints about OUR files' syntax count
    const bad = (v.stderr || '').split('\n').filter(l => /Unknown (key|section)|Invalid|Failed to parse|not a valid|Unknown lvalue|bad setting/i.test(l));
    assert.deepEqual(bad, [], 'systemd rejected a unit: ' + v.stderr);
    const env = readFileSync(join(w, 'etc/relay.env'), 'utf8');
    assert.match(env, /^TRINITY_DATA_DIR=\/mnt\/church-disk\/trinityone-relay$/m); assert.match(env, /^TRINITY_DATA_DIR_PINNED=1$/m); assert.match(env, /^TRINITY_STORAGE_MODE=server$/m);
    assert.match(readFileSync(join(sysd, 'trinityone-relay.service.d/50-data-dir.conf'), 'utf8'), /RequiresMountsFor=\/mnt\/church-disk\/trinityone-relay/);
    const un = spawnSync('bash', [join(ROOT, 'scripts/relay-datadir-apply.sh'), '/mnt/x', '--unpinned'], { encoding: 'utf8',
      env: { ...process.env, PATH: bin + ':' + process.env.PATH, TRINITYONE_ETC: join(w, 'etc'), TRINITYONE_STATE_DIR: join(w, 'state'), TRINITYONE_SYSTEMD_DIR: sysd } });
    assert.equal(un.status, 0); assert.doesNotMatch(readFileSync(join(w, 'etc/relay.env'), 'utf8'), /PINNED/);
    const evil = spawnSync('bash', [join(ROOT, 'scripts/relay-datadir-apply.sh'), '/mnt/a b'], { encoding: 'utf8', env: { ...process.env, TRINITYONE_ETC: join(w, 'etc2'), TRINITYONE_SYSTEMD_DIR: sysd } });
    assert.notEqual(evil.status, 0, 'a folder with a space was written into relay.env'); assert.equal(existsSync(join(w, 'etc2/relay.env')), false);
  } finally { rmSync(w, { recursive: true, force: true }); }
});
test('the relay unit still stops on 78 and now reads relay.env', () => {
  const u = render('/etc/systemd/system/$SVC.service', PRE);
  assert.match(u, /^RestartPreventExitStatus=78$/m); assert.match(u, /^EnvironmentFile=-\/etc\/trinityone\/relay\.env$/m); assert.match(u, /^ReadWritePaths=.*\/relay$/m);
});
test('install.sh on an existing box with no relay.env: data stays $DIR/relay and the storage card stays OFF; a fresh box turns it on; relay.env wins', () => {
  const a = SH.indexOf('# WHERE THE DATA LIVES'), b = SH.indexOf("# The apps' origin:"); assert.ok(a > 0 && b > a, 'the data-folder block moved');
  const block = SH.slice(a, b);
  const run = (setup, storage = 'auto') => {
    const w = mkdtempSync(join(tmpdir(), 'trin-inst-'));
    try {
      const dir = join(w, 'opt'), etc = join(w, 'etc'); mkdirSync(dir); mkdirSync(etc); setup({ dir, etc });
      const r = spawnSync('bash', ['-c', `DIR=${dir}; STORAGE=${storage}; TRINITYONE_ETC=${etc}\n${block}\necho "$DATA|$STORAGE|$FRESH|$ENV_PINNED"`], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr); return r.stdout.trim().replace(dir, 'DIR').replace(w, 'W');
    } finally { rmSync(w, { recursive: true, force: true }); }
  };
  assert.equal(run(({ dir }) => mkdirSync(join(dir, 'relay'))), 'DIR/relay|0|0|0', 'an existing box (a8) was switched onto the new behaviour');
  assert.equal(run(() => {}), 'DIR/relay|1|1|0');
  assert.equal(run(({ dir }) => mkdirSync(join(dir, 'relay')), '1'), 'DIR/relay|1|0|0');
  assert.equal(run(({ dir }) => mkdirSync(join(dir, 'relay')), '0'), 'DIR/relay|0|0|0');
  assert.equal(run(({ dir, etc }) => { mkdirSync(join(dir, 'relay')); writeFileSync(join(etc, 'relay.env'), 'TRINITY_DATA_DIR=/mnt/d/trinityone-relay\nTRINITY_DATA_DIR_PINNED=1\n'); }), '/mnt/d/trinityone-relay|1|0|1',
    're-running the installer after a move would plant a second, empty relay folder');
});

// ── AUDIT C: H1 (the old copy is no longer writable), L3 (folder recorded before the relay starts), L4 (never create a missing folder)
function effectiveReadWritePaths(...unitTexts) {      // systemd semantics: later files append; an empty assignment resets
  let list = [];
  for (const t of unitTexts) for (const l of t.split('\n')) { const m = /^ReadWritePaths=(.*)$/.exec(l.trim()); if (m) list = m[1] === '' ? [] : [...list, m[1]]; }
  return list;
}
test('H1: after a move the relay can write the NEW folder only — the old copy is not in its writable set', () => {
  const w = mkdtempSync(join(tmpdir(), 'trin-rw-'));
  try {
    const sysd = join(w, 'systemd'), bin = join(w, 'bin'); mkdirSync(sysd); mkdirSync(bin);
    writeFileSync(join(bin, 'systemctl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const main = render('/etc/systemd/system/$SVC.service', PRE);                 // a box installed before the move: names $DIR/relay
    assert.deepEqual(effectiveReadWritePaths(main), [ROOT.replace(/\/$/, '') + '/relay']);
    const ap = spawnSync('bash', [join(ROOT, 'scripts/relay-datadir-apply.sh'), '/mnt/church-disk/trinityone-relay'], { encoding: 'utf8',
      env: { ...process.env, PATH: bin + ':' + process.env.PATH, TRINITYONE_ETC: join(w, 'etc'), TRINITYONE_STATE_DIR: join(w, 'state'), TRINITYONE_SYSTEMD_DIR: sysd } });
    assert.equal(ap.status, 0, ap.stderr);
    const drop = readFileSync(join(sysd, 'trinityone-relay.service.d/50-data-dir.conf'), 'utf8');
    assert.deepEqual(effectiveReadWritePaths(main, drop), ['/mnt/church-disk/trinityone-relay'], 'THE OLD COPY IS STILL WRITABLE BY THE RELAY: a compromised relay could steer the root remover through it');
    // and a re-run of install.sh after the move renders the live folder itself
    const moved = render('/etc/systemd/system/$SVC.service', PRE.replace('DATA=$DIR/relay', 'DATA=/mnt/church-disk/trinityone-relay'));
    assert.deepEqual(effectiveReadWritePaths(moved, drop), ['/mnt/church-disk/trinityone-relay']);
  } finally { rmSync(w, { recursive: true, force: true }); }
});

function lift(startMarker) {
  const a = SH.indexOf(startMarker); assert.ok(a >= 0, 'install.sh no longer has ' + startMarker);
  return SH.slice(a, SH.indexOf('\n}\n', a) + 3);
}
test('L4: an installer re-run with the drive unplugged refuses and creates nothing (mountpoint -q is the check)', () => {
  const w = mkdtempSync(join(tmpdir(), 'trin-l4-'));
  try {
    const bin = join(w, 'bin'); mkdirSync(bin);
    const run = ({ hadEnv = 1, data, mountOk }) => {
      writeFileSync(join(bin, 'mountpoint'), `#!/bin/sh\nexit ${mountOk ? 0 : 1}\n`, { mode: 0o755 });
      return spawnSync('bash', ['-c', `die() { echo "DIE: $*" >&2; exit 1; }\nHAD_ENV=${hadEnv}; ENV_PINNED=0; DIR=/opt/none-here; DATA=${data}\n${lift('is_mounted() {')}\n${lift('check_data_folder_present() {')}\ncheck_data_folder_present && echo PASSED`],
        { encoding: 'utf8', env: { ...process.env, PATH: bin + ':' + process.env.PATH } });
    };
    const missing = join(w, 'drive/trinityone-relay');
    let r = run({ data: missing, mountOk: false }); assert.notEqual(r.status, 0); assert.match(r.stderr, /missing/); assert.equal(existsSync(join(w, 'drive')), false, 'the installer created the folder under the mount point');
    mkdirSync(missing, { recursive: true });                                   // present but its drive is NOT mounted: it is the root disk under the mount point
    r = run({ data: missing, mountOk: false }); assert.notEqual(r.status, 0); assert.match(r.stderr, /not mounted/);
    r = run({ data: missing, mountOk: true }); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /PASSED/);
    r = run({ hadEnv: 0, data: join(w, 'nothing-yet'), mountOk: false }); assert.equal(r.status, 0, 'a fresh install (no relay.env) must not be refused');
    // it is called, as a bare statement, before anything writes into the data folder
    assert.match(SH, /^check_data_folder_present$/m);
    assert.ok(SH.search(/^check_data_folder_present$/m) < SH.indexOf('mkdir -p "$DATA"\nprintf'), 'the check runs after the folder is created');
  } finally { rmSync(w, { recursive: true, force: true }); }
});

test('L3: the data folder is recorded BEFORE the relay first starts, so the card shows at once', () => {
  assert.match(SH, /^record_data_folder$/m);
  assert.ok(SH.search(/^record_data_folder$/m) < SH.indexOf('systemctl restart "$SVC"'), 'relay.env is recorded after the relay restart');
  const w = mkdtempSync(join(tmpdir(), 'trin-l3-'));
  try {
    const bin = join(w, 'bin'); mkdirSync(bin); writeFileSync(join(bin, 'systemctl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const run = (extra, data) => {
      mkdirSync(data, { recursive: true }); if (extra) writeFileSync(join(data, 'relay-key.json'), '{}');
      const sysd = join(w, 'sd' + Math.random().toString(36).slice(2)); mkdirSync(sysd);
      const etc = join(w, 'etc' + Math.random().toString(36).slice(2));
      const r = spawnSync('bash', ['-c', `warn() { echo "WARN $*" >&2; }\nSTORAGE=1; ENV_PINNED=0; DIR=${ROOT.replace(/\/$/, '')}; DATA=${data}; SVC=trinityone-relay; ETC_DIR=${etc}\n${lift('record_data_folder() {')}\nrecord_data_folder`],
        { encoding: 'utf8', env: { ...process.env, PATH: bin + ':' + process.env.PATH, TRINITYONE_STATE_DIR: join(w, 'state'), TRINITYONE_SYSTEMD_DIR: sysd } });
      assert.equal(r.status, 0, r.stderr); return readFileSync(join(etc, 'relay.env'), 'utf8');
    };
    const fresh = run(false, join(w, 'fresh'));
    assert.match(fresh, /TRINITY_STORAGE_MODE=server/); assert.doesNotMatch(fresh, /PINNED/, 'a folder with no key yet must be recorded unpinned');
    assert.match(run(true, join(w, 'keyed')), /TRINITY_DATA_DIR_PINNED=1/);
  } finally { rmSync(w, { recursive: true, force: true }); }
});

// ── second audit: N2 (boot ordering), N4 (L4 over-broad / missing mountpoint tool), N5 (finish unit) ───────────────────
test('N2/N5: the move and update units are ordered After= the recover unit; the finish unit needs the relay up (Requisite, not Wants) and is bounded — and the whole set has no ordering cycle', () => {
  const w = mkdtempSync(join(tmpdir(), 'trin-ord-'));
  try {
    const t = n => render(`/etc/systemd/system/${n}`, PRE);
    const move = t('trinityone-move.service'), upd = t('trinityone-update.service'), rec = t('trinityone-move-recover.service'), fin = t('trinityone-move-finish.service'), relay = t('$SVC.service');
    for (const [n, u] of [['move', move], ['update', upd]]) assert.match(u, /^After=trinityone-move-recover\.service$/m, n + ' service can run before boot recovery: a request left from before shutdown could take the lock first and start the relay');
    assert.match(rec, /^Before=trinityone-relay\.service$/m);
    assert.match(fin, /^After=trinityone-relay\.service$/m); assert.match(fin, /^Requisite=trinityone-relay\.service$/m);
    assert.doesNotMatch(fin, /^Wants=/m, 'the finish unit pulls in (starts) a relay an admin had disabled');
    const to = /^TimeoutStartSec=(.*)$/m.exec(fin); assert.ok(to && /^\d+$/.test(to[1]) && Number(to[1]) <= 1800, 'the finish unit has no bound: boot waits on it for ever (' + (to && to[1]) + ')');
    assert.doesNotMatch(relay, /move-recover|move-finish/, 'the relay unit must not depend on the recovery units');
    // systemd itself: every unit together, with a real parser, finds no ordering cycle and no unknown directive
    const sysd = join(w, 'systemd'); mkdirSync(sysd);
    for (const n of ['trinityone-move.service', 'trinityone-update.service', 'trinityone-move-recover.service', 'trinityone-move-finish.service']) writeFileSync(join(sysd, n), t(n));
    writeFileSync(join(sysd, 'trinityone-relay.service'), relay);
    const v = spawnSync('systemd-analyze', ['verify', ...readdirSync(sysd).map(n => join(sysd, n))], { encoding: 'utf8' });
    assert.doesNotMatch(v.stderr || '', /ordering cycle|Found dependency|Unknown (key|section)|Failed to parse|Unknown lvalue/i, 'systemd rejected the units: ' + v.stderr);
  } finally { rmSync(w, { recursive: true, force: true }); }
});

test('N4: the reinstall check refuses only a PINNED folder, or a non-default one on an unmounted drive; a missing mountpoint tool falls back to findmnt, then /proc/mounts', () => {
  const w = mkdtempSync(join(tmpdir(), 'trin-n4-'));
  try {
    const bin = join(w, 'bin'); mkdirSync(bin);
    const fns = lift('is_mounted() {') + lift('check_data_folder_present() {');
    const tool = (name, code) => { writeFileSync(join(bin, name), `#!/bin/sh\nexit ${code}\n`, { mode: 0o755 }); };
    const run = (vars, { path = bin + ':' + process.env.PATH } = {}) => spawnSync('/bin/bash', ['-c', `die() { echo "DIE: $*" >&2; exit 1; }\n${vars}\n${fns}\ncheck_data_folder_present && echo PASSED`], { encoding: 'utf8', env: { ...process.env, PATH: path } });
    // (a) unpinned relay.env naming the default folder, which is missing (reinstall after rm -rf /opt/trinityone): NOT refused
    let r = run(`HAD_ENV=1; ENV_PINNED=0; DIR=${w}/opt; DATA=${w}/opt/relay`); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /PASSED/);
    // (b) the same but PINNED: refused
    r = run(`HAD_ENV=1; ENV_PINNED=1; DIR=${w}/opt; DATA=${w}/opt/relay`); assert.notEqual(r.status, 0); assert.match(r.stderr, /missing/);
    // (c) a non-default folder that is missing is refused even unpinned
    r = run(`HAD_ENV=1; ENV_PINNED=0; DIR=${w}/opt; DATA=${w}/drive/trinityone-relay`); assert.notEqual(r.status, 0);
    // (d) tool fallbacks with the folder present: no mountpoint tool -> findmnt decides
    mkdirSync(join(w, 'drive/trinityone-relay'), { recursive: true });
    const only = join(w, 'only'); mkdirSync(only);
    for (const t of ['awk', 'dirname', 'sed', 'cat']) { const p = spawnSync('/bin/bash', ['-c', `command -v ${t}`], { encoding: 'utf8' }).stdout.trim(); if (p) spawnSync('ln', ['-sf', p, join(only, t)]); }
    const vars = `HAD_ENV=1; ENV_PINNED=1; DIR=${w}/opt; DATA=${w}/drive/trinityone-relay`;
    writeFileSync(join(only, 'findmnt'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    r = run(vars, { path: only }); assert.notEqual(r.status, 0, 'findmnt said not mounted, yet the installer went on'); assert.match(r.stderr, /not mounted/);
    writeFileSync(join(only, 'findmnt'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    r = run(vars, { path: only }); assert.equal(r.status, 0, r.stderr + ' (findmnt said mounted)');
    // (e) neither tool: /proc/mounts decides. /proc is a real mountpoint; the folder two levels in is not.
    rmSync(join(only, 'findmnt'));
    const probe = spawnSync('/bin/bash', ['-c', `${lift('is_mounted() {')}\nis_mounted /proc && echo yes-proc; is_mounted ${w}/drive || echo no-drive`], { encoding: 'utf8', env: { ...process.env, PATH: only } });
    assert.match(probe.stdout, /yes-proc/, 'with no mountpoint and no findmnt, a real mount was reported as not mounted: ' + probe.stderr); assert.match(probe.stdout, /no-drive/);
  } finally { rmSync(w, { recursive: true, force: true }); }
});
