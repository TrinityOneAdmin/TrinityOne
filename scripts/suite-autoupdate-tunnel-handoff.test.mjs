// audit AUDIT-suite-autoupdate-be258b42 MEDIUM 6 — before the Suite shell stops the relay to swap in an update it
// calls POST /suite/prepare-restart. Proven here against a REAL gateway and a FAKE cloudflared (a script that
// prints a trycloudflare URL + "Registered tunnel connection" and then sleeps, recording its pid):
//   • the relay's cloudflared child is killed (a hard kill of the relay would have orphaned it),
//   • the stay-public flag (tunnel-on) is KEPT, so the restarted relay opens a tunnel again,
//   • the answer carries the address that was in use, and it needs the admin token;
//   • GET /update's suite.addressChanged reports from → to once state.json records the old address.
// No network: the tunnel is fake, the directory and update base point at a dead port.
// Run: node --test scripts/suite-autoupdate-tunnel-handoff.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, chmodSync, mkdirSync, cpSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort } from './relay-network-harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
let relay, dataDir, port, work, out = '';
// The route exists only on a PACKAGED Suite (audit 00aadeed N4), so the gateway runs from a scratch tree that
// carries release-origin, like an installed Suite's payload.
function packagedTree(dir) {
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  for (const f of readdirSync(join(ROOT, 'scripts'))) if (f.endsWith('.mjs') && !f.includes('.test.')) cpSync(join(ROOT, 'scripts', f), join(dir, 'scripts', f));
  cpSync(join(ROOT, 'relay-app'), join(dir, 'relay-app'), { recursive: true, filter: (p) => !p.includes('/desktop') });
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  writeFileSync(join(dir, 'version.txt'), 'a'.repeat(40) + '\n2026-09-21T00:00:00+00:00\n');
  writeFileSync(join(dir, 'release-origin'), 'http://127.0.0.1:9\n');
  return dir;
}
const pidFile = () => join(work, 'cf.pid');
const tok = () => { try { return JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token || ''; } catch { return ''; } };
const call = (p, method = 'GET', auth = true) => fetch(`http://127.0.0.1:${port}${p}`, { method, headers: auth ? { Authorization: 'Bearer ' + tok() } : {} });

before(async () => {
  work = mkdtempSync(join(tmpdir(), 'trin-suite-tunnel-'));
  dataDir = join(work, 'data'); mkdirSync(dataDir);
  const fake = join(work, 'fake-cloudflared');
  writeFileSync(fake, `#!/bin/sh\necho $$ > ${JSON.stringify(pidFile())}\necho "INF |  https://quiet-dove-test.trycloudflare.com  |"\necho "INF Registered tunnel connection connIndex=0"\nexec sleep 600\n`);
  chmodSync(fake, 0o755);
  port = await freePort('suite-autoupdate-tunnel-handoff gateway');
  const tree = packagedTree(join(work, 'payload'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(port)], {
    cwd: tree, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_SYNC: '0', CLOUDFLARED_BIN: fake, RELAY_DIRECTORY: 'http://127.0.0.1:9',
      SUITE_UPDATE_BASE: 'http://127.0.0.1:9', RELAY_SELFHEAL_INTERVAL_MS: '3600000', RELAY_NO_OPEN: '1' },
  });
  relay.stdout.on('data', (d) => { out += d; }); relay.stderr.on('data', (d) => { out += d; });
  let up = false;
  for (let i = 0; i < 150 && !up; i++) { await sleep(150); try { up = !!tok() && (await call('/tunnel/state')).ok; } catch {} }
  assert.ok(up, 'gateway did not come up\n' + out.slice(-800));
});
after(() => {
  try { const p = Number(readFileSync(pidFile(), 'utf8')); if (alive(p)) process.kill(p, 'SIGKILL'); } catch {}
  try { relay && relay.kill('SIGKILL'); } catch {}
  try { rmSync(work, { recursive: true, force: true }); } catch {}
});

test('prepare-restart closes the relay\'s tunnel child, keeps the stay-public flag, and returns the old address', async () => {
  const r = await (await call('/tunnel/up', 'POST')).json();
  assert.equal(r.url, 'https://quiet-dove-test.trycloudflare.com', 're-anchor: the fake tunnel did not open: ' + JSON.stringify(r));
  const pid = Number(readFileSync(pidFile(), 'utf8'));
  assert.ok(alive(pid), 're-anchor: the fake cloudflared is not running');
  assert.ok(existsSync(join(dataDir, 'tunnel-on')), 're-anchor: no stay-public flag');

  assert.equal((await call('/suite/prepare-restart', 'POST', false)).status, 401, 'must need the admin token');
  assert.ok(alive(pid), 'an unauthorised call must not touch the tunnel');

  const j = await (await call('/suite/prepare-restart', 'POST')).json();
  assert.equal(j.url, 'https://quiet-dove-test.trycloudflare.com', 'the address in use is returned');
  let gone = false;
  for (let i = 0; i < 40 && !gone; i++) { gone = !alive(pid); if (!gone) await sleep(100); }
  assert.ok(gone, 'the cloudflared child was left running (it would be orphaned by the restart)');
  assert.ok(existsSync(join(dataDir, 'tunnel-on')), 'the stay-public flag must be kept so the restarted relay re-opens a tunnel');
  assert.equal((await (await call('/tunnel/state')).json()).running, false);
});

test('GET /update reports the address change recorded by the shell', async () => {
  const r = await (await call('/tunnel/up', 'POST')).json();   // a new tunnel (the fake prints the same host)
  assert.ok(r.ok, JSON.stringify(r));
  mkdirSync(join(dataDir, 'suite'), { recursive: true });
  writeFileSync(join(dataDir, 'suite', 'state.json'), JSON.stringify({ lastOutcome: 'applied', addressBefore: 'https://old-name.trycloudflare.com' }));
  const s = (await (await call('/update')).json()).suite;
  assert.deepEqual(s.addressChanged, { from: 'https://old-name.trycloudflare.com', to: 'https://quiet-dove-test.trycloudflare.com' });
  writeFileSync(join(dataDir, 'suite', 'state.json'), JSON.stringify({ lastOutcome: 'applied', addressBefore: 'https://quiet-dove-test.trycloudflare.com' }));
  assert.equal((await (await call('/update')).json()).suite.addressChanged, null, 'same address → nothing to say');
});

test('a server relay (not a packaged Suite) does not have the route at all', async () => {
  const p2 = await freePort('suite-autoupdate-tunnel-handoff server gateway');
  const d2 = mkdtempSync(join(tmpdir(), 'trin-suite-tunnel-srv-'));
  const g = spawn(process.execPath, ['scripts/gateway.mjs', String(p2)], { cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: d2, RELAY_SYNC: '0', RELAY_DIRECTORY: 'http://127.0.0.1:9', SUITE_UPDATE_BASE: 'http://127.0.0.1:9', RELAY_NO_OPEN: '1' } });
  try {
    const t2 = () => { try { return JSON.parse(readFileSync(join(d2, 'admin.json'), 'utf8')).token || ''; } catch { return ''; } };
    let up = false;
    for (let i = 0; i < 150 && !up; i++) { await sleep(150); try { up = !!t2() && (await fetch(`http://127.0.0.1:${p2}/status`)).ok; } catch {} }
    assert.ok(up, 'server gateway did not come up');
    const r = await fetch(`http://127.0.0.1:${p2}/suite/prepare-restart`, { method: 'POST', headers: { Authorization: 'Bearer ' + t2() } });
    const body = await r.text();
    assert.ok(!/"url"/.test(body), 'a server relay answered the Suite-only route: ' + r.status + ' ' + body.slice(0, 120));
  } finally { try { g.kill('SIGKILL'); } catch {} try { rmSync(d2, { recursive: true, force: true }); } catch {} }
});
