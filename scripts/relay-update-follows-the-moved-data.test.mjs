// "UPDATE NOW" FOLLOWS THE MOVED DATA — AND AN EXISTING BOX (a8) IS UNCHANGED.
// Run: node --test scripts/relay-update-follows-the-moved-data.test.mjs
//
// Relay storage plan step 6, test 6 (relay-update.sh half). Runs the REAL scripts/relay-update.sh end to end over a
// fake root: DIR, the systemd folder, /etc and /var/lib are temp dirs; curl, systemctl, chown and npm are stubs on PATH;
// the bundle is a real tarball signed with a real Ed25519 key and checked by the script's own openssl verification.
//
//   * NO relay.env (a8 today): every data path is $DIR/relay, exactly as before — flag, status, log, APKs. Two things DO
//     change on an existing box, on purpose, and are asserted so nobody mistakes them for drift: the
//     RestartPreventExitStatus=78 drop-in is added (audit A #8: without it a relay that refused its folder is restarted
//     every 3 s), and the code backup is no longer left under the data folder.
//   * relay.env present: the flag is consumed from, and update-status.json / update.log / the APKs are written to, the
//     folder it names; $DIR/relay is untouched.
//
// What it does NOT prove: systemd's behaviour on a real box, the real path unit firing, the real network.
// Set UPDATE_SH=<path> to run a sabotaged copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const UPDATE_SH = process.env.UPDATE_SH ? resolve(process.env.UPDATE_SH) : join(ROOT, 'scripts/relay-update.sh');

const STUB_CURL = `#!/usr/bin/env bash
out=""; url=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; -w|--max-time|-H) shift 2;; -*) shift;; *) url="$1"; shift;; esac; done
echo "curl $url" >> "$TRIN_BOX/curl.log"
case "$url" in
  */bundle.tgz) cp "$TRIN_BOX/bundle.tgz" "$out";;
  */bundle.sig) cp "$TRIN_BOX/bundle.sig" "$out";;
  */trinityone.apk|*/trinityone-steward.apk) head -c 1200000 /dev/zero > "$out";;
  */status) printf '{"ok":true}';;
  */local-token) printf '{"token":"t"}';;
  */relay-addresses) printf 'loopbackOnly 1\\n';;
  *) exit 22;;
esac
`;
const STUB_SYSTEMCTL = '#!/usr/bin/env bash\necho "$*" >> "$TRIN_BOX/systemctl.log"\nexit 0\n';
const STUB_NOOP = '#!/usr/bin/env bash\necho "$*" >> "$TRIN_BOX/$(basename "$0").log"\nexit 0\n';

function box({ relayEnv = null } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'trin-update-'));
  const dir = join(base, 'opt'), bin = join(base, 'bin'), sysd = join(base, 'systemd'), etc = join(base, 'etc'), state = join(base, 'state');
  for (const d of [dir, bin, sysd, etc, state, join(dir, 'relay'), join(dir, 'relay-app'), join(dir, 'scripts')]) mkdirSync(d, { recursive: true });
  for (const [n, c] of [['curl', STUB_CURL], ['systemctl', STUB_SYSTEMCTL], ['chown', STUB_NOOP], ['npm', STUB_NOOP]]) writeFileSync(join(bin, n), c, { mode: 0o755 });
  // a real release key + a signed bundle
  const k = join(base, 'k.pem'); spawnSync('openssl', ['genpkey', '-algorithm', 'ed25519', '-out', k]);
  const pub = spawnSync('openssl', ['pkey', '-in', k, '-pubout'], { encoding: 'utf8' }).stdout;
  writeFileSync(join(dir, 'relay-app/release-pubkey.pem'), pub);
  const b = join(base, 'bundle'); mkdirSync(join(b, 'scripts'), { recursive: true });
  writeFileSync(join(b, 'scripts/gateway.mjs'), '// new build\n'); writeFileSync(join(b, 'version.txt'), 'abcdef1\n2026-01-01T00:00:00+00:00\n');
  spawnSync('tar', ['-czf', join(base, 'bundle.tgz'), '-C', b, '.']);
  spawnSync('openssl', ['pkeyutl', '-sign', '-inkey', k, '-rawin', '-in', join(base, 'bundle.tgz'), '-out', join(base, 'bundle.sig')]);
  writeFileSync(join(dir, 'version.txt'), 'oldold1\n2025-01-01T00:00:00+00:00\n');
  const data = relayEnv ? join(base, 'drive/trinityone-relay') : join(dir, 'relay');
  mkdirSync(data, { recursive: true });
  if (relayEnv) writeFileSync(join(etc, 'relay.env'), `TRINITY_DATA_DIR=${data}\nTRINITY_STORAGE_MODE=server\n`);
  writeFileSync(join(data, 'origin'), 'https://origin.example\n'); writeFileSync(join(data, 'code-source'), 'https://github.com/x/y/releases/latest/download\n');
  writeFileSync(join(data, '.update-request'), '1\n');
  const env = { ...process.env, PATH: bin + ':' + process.env.PATH, TRIN_BOX: base, TRINITYONE_DIR: dir, TRINITYONE_RELAY_ENV: join(etc, 'relay.env'),
    TRINITYONE_STATE_DIR: state, TRINITYONE_SYSTEMD_DIR: sysd, TRINITYONE_SVC: 'trinityone-relay', TRINITYONE_PORT: '8000', TRINITYONE_USER: 'nobody',
    HEALTH_TRIES: '1', PROOF_TRIES: '1', PROOF_SLEEP: '0' };
  const run = () => spawnSync('bash', [UPDATE_SH], { env, encoding: 'utf8', timeout: 120000 });
  return { base, dir, data, sysd, state, run, log: f => { try { return readFileSync(join(base, f), 'utf8'); } catch { return ''; } }, done: () => rmSync(base, { recursive: true, force: true }) };
}
const DROPIN = b => join(b.sysd, 'trinityone-relay.service.d/10-refused-data-folder.conf');

test('an existing box with NO relay.env: every data path is $DIR/relay, as before', () => {
  const b = box();
  try {
    const r = b.run(); assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(join(b.data, '.update-request')), false, 'the flag was not consumed from $DIR/relay');
    assert.equal(JSON.parse(readFileSync(join(b.data, 'update-status.json'), 'utf8')).state, 'ok');
    assert.match(readFileSync(join(b.data, 'update.log'), 'utf8'), /update complete/);
    assert.ok(existsSync(join(b.data, 'apks/trinityone.apk')), 'the APKs did not land in $DIR/relay/apks');
    assert.ok(existsSync(join(b.data, 'installed-files.txt')), 'the manifest is not in $DIR/relay');
    assert.match(b.log('curl.log'), /https:\/\/github.com\/x\/y\/releases\/latest\/download\/bundle\.tgz/, 'the code source was not read from $DIR/relay/code-source');
    assert.match(readFileSync(join(b.dir, 'scripts/gateway.mjs'), 'utf8'), /new build/, 'the new code was not unpacked');
    assert.equal(existsSync(join(b.dir, 'relay/.code-backup.tgz')), false, 'a code backup was left under the data folder');
    assert.deepEqual(readdirSync(b.data).filter(n => /backup/.test(n)), []);
    // the sandbox config is NOT created on a box that never opted in
    assert.equal(existsSync(join(b.base, 'etc/relay.env')), false, 'relay-update.sh created a relay.env on a box that had none');
    assert.deepEqual(b.log('chown.log').split('\n').filter(l => l.includes('-R nobody:nobody')).map(l => l.split(' ').pop()), [b.data]);
  } finally { b.done(); }
});

test('the restart-prevent-78 drop-in is added to an already-installed box, once', () => {
  const b = box();
  try {
    assert.equal(existsSync(DROPIN(b)), false, 'fixture: the drop-in already exists');
    const r = b.run(); assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(DROPIN(b)), 'THE 78 DROP-IN WAS NOT ADDED: a8 would restart a relay that refused its data folder every 3 s for ever');
    assert.equal(readFileSync(DROPIN(b), 'utf8'), '[Service]\nRestartPreventExitStatus=78\n');
    assert.match(b.log('systemctl.log'), /^daemon-reload$/m, 'systemd was not told to reload');
    // before the restart of the relay: the first reload must come before the restart
    const calls = b.log('systemctl.log').split('\n').filter(Boolean);
    assert.ok(calls.indexOf('daemon-reload') < calls.indexOf('restart trinityone-relay'), 'the drop-in was added after the relay restart: ' + calls.join(' | '));
    // again: idempotent — no second reload for it
    writeFileSync(join(b.data, '.update-request'), '1\n'); writeFileSync(join(b.base, 'systemctl.log'), '');
    const r2 = b.run(); assert.equal(r2.status, 0, r2.stderr);
    assert.doesNotMatch(b.log('systemctl.log'), /daemon-reload/, 'a second update reloaded systemd again for a drop-in that was already there');
  } finally { b.done(); }
});

test('with a relay.env: the flag, status, log, manifest and APKs all follow it, and $DIR/relay is untouched', () => {
  const b = box({ relayEnv: true });
  try {
    mkdirSync(join(b.dir, 'relay'), { recursive: true }); writeFileSync(join(b.dir, 'relay/MOVED-TO'), 'moved\n');
    const before = readdirSync(join(b.dir, 'relay')).sort();
    const r = b.run(); assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(join(b.data, '.update-request')), false, 'the flag was not consumed from the moved folder: the path unit would loop');
    assert.equal(JSON.parse(readFileSync(join(b.data, 'update-status.json'), 'utf8')).state, 'ok', 'update-status.json did not reach the folder the relay reads');
    assert.ok(existsSync(join(b.data, 'update.log')) && existsSync(join(b.data, 'installed-files.txt')) && existsSync(join(b.data, 'apks/trinityone.apk')));
    assert.match(b.log('curl.log'), /https:\/\/github.com\/x\/y\/releases\/latest\/download\/bundle\.tgz/, 'the code source was not read from the moved folder');
    assert.deepEqual(readdirSync(join(b.dir, 'relay')).sort(), before, 'the update wrote into the OLD folder');
    assert.deepEqual(b.log('chown.log').split('\n').filter(l => l.includes('-R nobody:nobody')).map(l => l.split(' ').pop()), [b.data]);
  } finally { b.done(); }
});

test('the code backup is outside the data folder, and a failed build is rolled back from it', () => {
  const b = box({ relayEnv: true });
  try {
    // the new build never reports healthy: make /status answer degraded
    const curl = readFileSync(join(b.base, 'bin/curl'), 'utf8').replace(`printf '{"ok":true}'`, `printf '{"ok":false}'`);
    writeFileSync(join(b.base, 'bin/curl'), curl, { mode: 0o755 });
    const r = b.run(); assert.equal(r.status, 1, 'a build that never became healthy was not reported as failed');
    assert.equal(JSON.parse(readFileSync(join(b.data, 'update-status.json'), 'utf8')).state, 'rolledback');
    assert.deepEqual(readdirSync(b.data).filter(n => /code-backup/.test(n)), [], 'a code backup lives in the data folder');
    assert.ok(existsSync(join(b.state, 'code-backup.tgz')), 'no code backup in the state folder to roll back from');
    assert.match(b.log('systemctl.log'), /restart trinityone-relay\n[\s\S]*restart trinityone-relay/, 'the relay was not restarted again after the rollback');
  } finally { b.done(); }
});
