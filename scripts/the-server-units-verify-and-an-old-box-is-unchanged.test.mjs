// THE SERVER UNITS ARE VALID SYSTEMD, AND AN EXISTING BOX IS UNCHANGED BY install.sh. Run: node --test scripts/the-server-units-verify-and-an-old-box-is-unchanged.test.mjs
// Relay storage plan step 6, test 6 (install.sh half). Renders install.sh's OWN unit heredocs through bash, writes the
// drop-ins with the real relay-datadir-apply.sh (stubbed systemctl, temp dirs), and runs `systemd-analyze verify` (no root
// needed) on them. Lifts install.sh's "where the data lives" block and runs it. NOT proven here: systemd actually
// honouring the drop-ins on a booted box (step-7 VM list).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
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
      'trinityone-move.path': '/etc/systemd/system/trinityone-move.path' };
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
