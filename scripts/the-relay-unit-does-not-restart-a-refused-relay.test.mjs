// THE RELAY'S SERVICE UNIT DOES NOT RESTART A RELAY THAT REFUSED ITS DATA FOLDER.
// Run: node --test scripts/the-relay-unit-does-not-restart-a-refused-relay.test.mjs
//
// Audit A finding 8 (relay storage plan step 1). The gateway exits 78 when it refuses its data folder (missing
// drive, MOVED-TO, foreign). With Restart=always + RestartSec=3 and no RestartPreventExitStatus, systemd
// restarted it every 3 s for ever (3 s is under the default StartLimitBurst window). This renders the unit the
// installer ACTUALLY writes — by running install.sh's own heredoc through bash — and the checked-in dev unit,
// and checks both carry RestartPreventExitStatus=78; and spawns the real gateway to prove 78 is the code it uses.
// What it does NOT prove: systemd's behaviour on a real box (that is systemd's contract, device-test territory).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

function serviceSection(unitText) {
  const out = {}; let sec = '';
  for (const raw of unitText.split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    const m = /^\[(.+)\]$/.exec(l); if (m) { sec = m[1]; continue; }
    const i = l.indexOf('='); if (i < 0) continue;
    const k = sec + '.' + l.slice(0, i); (out[k] = out[k] || []).push(l.slice(i + 1));
  }
  return out;
}
function renderInstallerUnit() {
  const sh = readFileSync(join(ROOT, 'relay-app/install.sh'), 'utf8');
  const start = sh.indexOf('cat > "/etc/systemd/system/$SVC.service" <<UNIT');
  assert.ok(start >= 0, 'could not find the relay unit heredoc in install.sh');
  const end = sh.indexOf('\nUNIT\n', start);
  const block = sh.slice(start, end + 6).replace('cat > "/etc/systemd/system/$SVC.service" <<UNIT', 'cat <<UNIT');
  const r = spawnSync('bash', ['-c', 'SVC_USER=trinityone DIR=/opt/trinityone NODE_BIN=/usr/bin/node PORT=8090\n' + block], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test('the installer\'s relay unit stops on exit 78 instead of restarting every 3 s', () => {
  const u = serviceSection(renderInstallerUnit());
  assert.deepEqual(u['Service.Restart'], ['always'], 'fixture: the unit no longer uses Restart=always — re-read this test');
  assert.ok((u['Service.RestartPreventExitStatus'] || []).join(' ').split(/\s+/).includes('78'),
    'install.sh writes a relay unit that restarts a relay which refused its data folder — a 3-second loop for ever');
});

test('the checked-in dev unit does the same', () => {
  const u = serviceSection(readFileSync(join(ROOT, 'deploy/systemd/trinity-gateway.service'), 'utf8'));
  assert.ok((u['Service.RestartPreventExitStatus'] || []).join(' ').split(/\s+/).includes('78'));
});

test('78 is the code the real gateway exits with when it refuses its folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-unit-'));
  try {
    writeFileSync(join(dir, 'MOVED-TO'), 'moved to /elsewhere');
    const r = spawnSync(process.execPath, ['scripts/gateway.mjs', '8873'], { cwd: ROOT, env: { ...process.env, TRINITY_DATA_DIR: dir, RELAY_NO_OPEN: '1' }, encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 78, 'the gateway refusal code changed; the units must change with it. ' + r.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
