// Chained tests: the state.json a REAL Rust rollback wrote -> the REAL gateway's GET /update -> the REAL control.js panel.
// (Plan PLAN-suite-rollback-to-installer-2026-11-14, item 2; audit f4baad21.) Each link is the shipped code, run:
//   state.json   scripts/fixtures/suite-rollback-state-{quarantined,not-quarantined}.json. These are written by the real
//                write_state in main.rs: the Rust apply harness (relay-app/desktop/src-tauri/src/apply_harness_test.rs)
//                compares the state.json of scenario (h) (bad update, quarantined) and scenario (q) (silent start, NOT
//                quarantined) with them and FAILS if they have gone stale (regenerate: TRIN_WRITE_FIXTURES=1 cargo test).
//                restoreFailed is blanked in them: the harness box has no store, so its capture carries a machine path and
//                an Attention warning that would hide the lines under test; a clean rollback writes "".
//   /update      a real scripts/gateway.mjs, run as a packaged Suite on a downloaded override (PAYLOAD_DIR != its tree)
//   panel text   wireSuiteAutoUpdate lifted out of relay-app/control.js and run on a fake DOM (as suite-autoupdate-ui does)
// Run: node --test scripts/suite-autoupdate-rollback-chain.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort } from './relay-network-harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fixture = (name) => JSON.parse(readFileSync(join(ROOT, 'scripts', 'fixtures', name), 'utf8'));
const QUARANTINED = fixture('suite-rollback-state-quarantined.json');
const NOT_QUARANTINED = fixture('suite-rollback-state-not-quarantined.json');

const m = readFileSync(join(ROOT, 'relay-app', 'control.js'), 'utf8').match(/\/\/ SUITE-AUTOUPDATE-UI-BEGIN[^\n]*\n([\s\S]*?)\/\/ SUITE-AUTOUPDATE-UI-END/);
assert.ok(m, 'SUITE-AUTOUPDATE-UI markers are gone from control.js; re-anchor this test');
const { wireSuiteAutoUpdate } = new Function(m[1] + '\nreturn { wireSuiteAutoUpdate };')();
function panelText(suite) {
  const els = { suiteAutoToggle: { style: {}, dataset: {} }, suiteAutoTime: { style: {}, dataset: {}, value: '03:00' },
    suiteAutoStatus: { style: {}, textContent: '' }, suiteAutoHint: { style: { display: 'none' } }, suiteAutoAck: { style: { display: 'none' } } };
  wireSuiteAutoUpdate({ getElementById: (id) => els[id] || null, activeElement: null }, async () => ({ ok: true, json: async () => ({ ok: true }) }), () => ({}), suite);
  return els.suiteAutoStatus.textContent;
}

let relay, work, dataDir, port, out = '';
const tok = () => { try { return JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token || ''; } catch { return ''; } };
const call = (p) => fetch(`http://127.0.0.1:${port}${p}`, { headers: { Authorization: 'Bearer ' + tok() } });

before(async () => {
  work = mkdtempSync(join(tmpdir(), 'trin-suite-rbchain-'));
  dataDir = join(work, 'data'); mkdirSync(join(dataDir, 'suite'), { recursive: true });
    // the downloaded override tree (what the relay runs from) and the read-only installer payload (PAYLOAD_DIR)
  const tree = join(work, 'active'), payload = join(work, 'payload');
  mkdirSync(join(tree, 'scripts'), { recursive: true }); mkdirSync(payload);
  for (const f of readdirSync(join(ROOT, 'scripts'))) if (f.endsWith('.mjs') && !f.includes('.test.')) cpSync(join(ROOT, 'scripts', f), join(tree, 'scripts', f));
  cpSync(join(ROOT, 'relay-app'), join(tree, 'relay-app'), { recursive: true, filter: (p) => !p.includes('/desktop') });
  symlinkSync(join(ROOT, 'node_modules'), join(tree, 'node_modules'));
  writeFileSync(join(tree, 'version.txt'), 'b'.repeat(40) + '\n2026-10-01T00:00:00+00:00\n');
  writeFileSync(join(tree, 'release-origin'), 'http://127.0.0.1:9\n');
  writeFileSync(join(payload, 'version.txt'), 'a'.repeat(40) + '\n2026-09-21T00:00:00+00:00\n');
  port = await freePort('suite-autoupdate-rollback-chain gateway');
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(port)], { cwd: tree, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, PAYLOAD_DIR: payload, RELAY_SYNC: '0', RELAY_DIRECTORY: 'http://127.0.0.1:9',
      SUITE_UPDATE_BASE: 'http://127.0.0.1:9', RELAY_SELFHEAL_INTERVAL_MS: '3600000', RELAY_NO_OPEN: '1' } });
  relay.stdout.on('data', (d) => { out += d; }); relay.stderr.on('data', (d) => { out += d; });
  let up = false;
  for (let i = 0; i < 150 && !up; i++) { await sleep(150); try { up = !!tok() && (await call('/update')).ok; } catch {} }
  assert.ok(up, 'gateway did not come up\n' + out.slice(-800));
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(work, { recursive: true, force: true }); } catch {} });

const putState = (st) => writeFileSync(join(dataDir, 'suite', 'state.json'), JSON.stringify(st) + '\n');
async function render(st) {
  putState(st);
  const suite = (await (await call('/update')).json()).suite;
  assert.equal(suite.lastOutcome, 'rolledback', 're-anchor: /update did not carry the rollback: ' + JSON.stringify(suite));
  assert.equal(suite.running, 'update', 're-anchor: the gateway is not running as a downloaded update');
  assert.equal(suite.enabled, false);
  return { suite, text: panelText(suite) };
}
const OFF_LINE = /Off: fully close and reopen the app and the Suite goes back to the version it came with \(aaaaaaa\)/;

test('the fixtures are what the Rust shell writes: both rolled back, auto-update off, and they differ on quarantined', () => {
  assert.equal(QUARANTINED.lastOutcome, 'rolledback'); assert.equal(NOT_QUARANTINED.lastOutcome, 'rolledback');
  assert.equal(QUARANTINED.autoOff, true); assert.equal(NOT_QUARANTINED.autoOff, true);
  assert.equal(QUARANTINED.quarantined, true); assert.equal(NOT_QUARANTINED.quarantined, false);
  assert.equal(QUARANTINED.restoreFailed, ''); assert.equal(NOT_QUARANTINED.restoreFailed, '');
});

test('QUARANTINED rollback (scenario h) -> /update -> panel says the release will be skipped, and to close and reopen once', async () => {
  const { suite, text } = await render(QUARANTINED);
  assert.equal(suite.quarantined, true, '/update must pass the shell\'s quarantined flag through');
  assert.match(text, /The last update was rolled back \(the update started but reported the wrong version\), so automatic updates were turned off and that release will be skipped\./);
  assert.match(text, /Turn them on to try the next release; that also brings back the update running now, at the next start\./);
  assert.match(text, OFF_LINE);
  assert.equal((text.match(/close and reopen/g) || []).length, 1, 'close-and-reopen is said once, not twice');
});

test('NOT quarantined rollback (scenario q: a silent start) -> /update -> panel does NOT say skipped, says it will be tried again', async () => {
  const { suite, text } = await render(NOT_QUARANTINED);
  assert.equal(suite.quarantined, false);
  assert.match(text, /The last update was rolled back \(the update did not answer in time\), so automatic updates were turned off\. This release will be tried again if you turn updates back on, and the update running now comes back at the next start\./);
  assert.doesNotMatch(text, /skipped/i);
  assert.match(text, OFF_LINE);
});

test('an OLD state.json with no quarantined field never claims "skipped"', async () => {
  const old = { ...QUARANTINED }; delete old.quarantined;
  const { suite, text } = await render(old);
  assert.equal(suite.quarantined, false);
  assert.doesNotMatch(text, /skipped/i);
  assert.match(text, /This release will be tried again if you turn updates back on/);
});
