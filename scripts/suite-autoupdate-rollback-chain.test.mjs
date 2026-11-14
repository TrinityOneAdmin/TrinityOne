// One chained test: a REAL rollback's state.json -> the REAL gateway's GET /update -> the REAL control.js panel text.
// (Plan PLAN-suite-rollback-to-installer-2026-11-14, item 2.) Each link is the shipped code, run:
//   state.json   captured from the Rust apply harness scenario (h) ("bad v3 over good v2 rolls back to last-good"),
//                i.e. written by write_state in main.rs, not by hand. ONE field differs from the capture: restoreFailed
//                is "" — the harness box has no sqlite store, so its capture carries an "Attention" restore warning
//                that would (correctly) hide the lines this test is about; a clean rollback writes "".
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

const REAL_ROLLBACK_STATE = {
  installedSha: '2222222222222222222222222222222222222222', installedVersion: 'v2', installedDate: '2026-10-01T00:00:00Z',
  lastApplied: '2026-11-13', lastOutcome: 'rolledback', lastReason: 'the update started but reported the wrong version',
  autoOff: true, addressBefore: 'https://before-v2.trycloudflare.com', restoreFailed: '',
};

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
  writeFileSync(join(dataDir, 'suite', 'state.json'), JSON.stringify(REAL_ROLLBACK_STATE) + '\n');
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

test('a real rollback state.json -> GET /update -> the panel tells the steward to close and reopen, and that the release is skipped', async () => {
  const suite = (await (await call('/update')).json()).suite;
  assert.equal(suite.lastOutcome, 'rolledback', 're-anchor: /update did not carry the rollback: ' + JSON.stringify(suite));
  assert.equal(suite.running, 'update', 're-anchor: the gateway is not running as a downloaded update');
  assert.equal(suite.enabled, false);
  const text = panelText(suite);
  assert.match(text, /The last update was rolled back \(the update started but reported the wrong version\)/);
  assert.match(text, /that release will be skipped/);
  assert.match(text, /Fully close and reopen the app to go back to the version it came with/);
  assert.match(text, /Off: at the next start the Suite goes back to the version it came with \(aaaaaaa\)/);
});
