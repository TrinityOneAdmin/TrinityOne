// THE STORAGE API MOVES A RELAY ONLY WHEN ITS STEWARD ASKS, ON THE RELAY'S OWN COMPUTER — AND DOES NOT EXIST ON A BOX
// THAT HAS NOT OPTED IN.
// Run: node --test scripts/the-storage-api-moves-only-on-the-relays-own-computer.test.mjs
//
// Relay storage plan step 3 (TrinityOne-internal/reference/PLAN-relay-storage-location-2026-11-12.html §7, owner §8a).
// GET /storage, POST /storage/move, POST /storage/remove-old in scripts/gateway.mjs.
//
// Every test spawns the REAL gateway on a temp data folder and talks to it over real HTTP (node:http, so the test
// controls the Host header and the socket's address, which is what the local-only gate reads). Nothing is lifted.
//   * unset TRINITY_STORAGE_MODE (every box today): the three paths answer exactly as a path that never existed
//   * admin token: none / wrong -> 401, nothing written
//   * Suite local-only: a tunnelled (forwarding headers, a public Host) or LAN request is refused even WITH the token
//   * a move writes .move-request and the relay exits 0 with its WAL folded and its lock note gone
//   * the folder-level refusals the audits asked for, the leftovers list, the 7-day reminder, remove-old
//   * request files never travel in a backup, and a restore never applies one
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { parseWinLogicalDisks } from './relay-move.mjs';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8874;
const ROOT = new URL('..', import.meta.url).pathname;
const TOKEN = 'storage-test-admin-token-0123456789abcdef';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));

// A data folder that already belongs to a relay: a key and a known admin token.
function relayFolder(base) {
  const dir = join(base, 'data'); mkdirSync(dir, { recursive: true });
  const sk = generateSecretKey();
  const pub = getPublicKey(sk);
  writeFileSync(join(dir, 'relay-key.json'), JSON.stringify({ sk: Buffer.from(sk).toString('hex'), pub }));
  writeFileSync(join(dir, 'admin.json'), JSON.stringify({ token: TOKEN }));
  return { dir, pub };
}

async function boot(dataDir, env = {}) {
  await requireFreePort(PORT, 'the-storage-api-moves-only-on-the-relays-own-computer.test.mjs');
  const p = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '500', RELAY_NO_OPEN: '1', TRINITY_STORAGE_MODE: '', TRINITY_STORAGE_STATE: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const g = { p, log: '', code: undefined, signal: undefined };
  p.stdout.on('data', d => { g.log += d; }); p.stderr.on('data', d => { g.log += d; });
  g.exited = new Promise(res => p.on('exit', (code, signal) => { g.code = code; g.signal = signal; res(code); }));
  for (let i = 0; i < 200 && g.code === undefined; i++) {
    try { const r = await http('GET', '/status'); if (r.status === 200) return g; } catch {}
    await sleep(150);
  }
  p.kill('SIGKILL'); await g.exited;
  throw new Error('the gateway did not start (exit ' + g.code + '). Log:\n' + g.log);
}
async function stop(g) { if (g.code === undefined) { g.p.kill('SIGKILL'); await g.exited; } await sleep(200); }

// Real HTTP with full control of the Host header and of which local address the socket comes from.
function http(method, path, { token, headers = {}, body, host = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const h = { Host: `127.0.0.1:${PORT}`, ...headers };
    if (token) h.Authorization = 'Bearer ' + token;
    const data = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
    if (data !== undefined) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(data); }
    const r = request({ host, port: PORT, method, path, headers: h, agent: false }, res => {
      let b = ''; res.setEncoding('utf8'); res.on('data', c => { b += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch {} resolve({ status: res.statusCode, body: b, json, headers: res.headers }); });
    });
    r.on('error', reject); r.setTimeout(15000, () => r.destroy(new Error('timeout')));
    if (data !== undefined) r.write(data);
    r.end();
  });
}
// A temp "home folder": on Linux the Suite offers the home folder as a place to keep the data.
function suiteEnv(base, extra = {}) {
  const home = join(base, 'home'); mkdirSync(home, { recursive: true });
  const state = join(base, 'storage.json');
  return { home, state, env: { TRINITY_STORAGE_MODE: 'suite', TRINITY_STORAGE_STATE: state, HOME: home, USER: 'nobody-storage-test', ...extra } };
}
const lanAddress = () => Object.values(networkInterfaces()).flat().find(a => a && a.family === 'IPv4' && !a.internal)?.address || '';

test('UNSET (every box today): /storage, /storage/move and /storage/remove-old answer exactly as a path that never existed', async () => {
  const base = mkdtempSync(join(tmpdir(), 'trin-storage-unset-'));
  try {
    const { dir } = relayFolder(base);
    for (const mode of [undefined, 'yes']) {   // unset, and a value that is not suite|server
      const g = await boot(dir, mode ? { TRINITY_STORAGE_MODE: mode, TRINITY_STORAGE_STATE: join(base, 'storage.json'), HOME: base } : {});
      try {
        for (const [method, path, body] of [['GET', '/storage'], ['POST', '/storage/move', { drive: base }], ['POST', '/storage/remove-old', { path: base }]]) {
          const got = await http(method, path, { token: TOKEN, body });
          const ctl = await http(method, path.replace('storage', 'storage-never-a-route'), { token: TOKEN, body });
          assert.equal(got.status, ctl.status, `${method} ${path} (mode ${mode}) answered ${got.status}, a path that never existed answers ${ctl.status}: ${got.body}`);
          assert.equal(got.body, ctl.body, `${method} ${path} (mode ${mode}) answered differently from a path that never existed`);
          assert.notEqual(got.status, 200, `${method} ${path} answered 200 on a box that has not opted in`);
        }
        assert.equal(existsSync(join(dir, '.move-request')), false, 'an unset box wrote a move request');
        assert.equal(existsSync(join(dir, '.remove-old-request')), false, 'an unset box wrote a remove request');
        assert.equal((await http('GET', '/status')).status, 200, 'the relay stopped');
        assert.equal(g.code, undefined, 'the relay exited');
      } finally { await stop(g); }
    }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('admin token: none, or a wrong one, is refused on every storage route, and nothing is written', async () => {
  const base = mkdtempSync(join(tmpdir(), 'trin-storage-auth-'));
  try {
    const { dir } = relayFolder(base);
    const s = suiteEnv(base);
    const g = await boot(dir, s.env);
    try {
      for (const token of [undefined, 'wrong', TOKEN.replace(/.$/, 'X')]) {   // absent, short, same length
        for (const [method, path, body] of [['GET', '/storage'], ['POST', '/storage/move', { drive: s.home }], ['POST', '/storage/remove-old', { path: base }]]) {
          const r = await http(method, path, { token, body });
          assert.equal(r.status, 401, `${method} ${path} with token ${token === undefined ? '(none)' : JSON.stringify(token)} answered ${r.status}: ${r.body}`);
        }
      }
      assert.equal(existsSync(join(dir, '.move-request')), false, 'a move request was written without the admin token');
      assert.equal(existsSync(join(dir, '.remove-old-request')), false, 'a remove request was written without the admin token');
      assert.equal((await http('GET', '/status')).status, 200, 'the relay stopped for an unauthenticated request');
      // the same request WITH the token is accepted, so the 401s above were the token and nothing else
      assert.equal((await http('GET', '/storage', { token: TOKEN })).status, 200);
    } finally { await stop(g); }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('Suite local-only: a tunnelled, forwarded or LAN request cannot move the relay or remove a copy, even with the token', async () => {
  const base = mkdtempSync(join(tmpdir(), 'trin-storage-local-'));
  try {
    const { dir } = relayFolder(base);
    const s = suiteEnv(base);
    const old = join(base, 'old-copy');
    mkdirSync(old);
    writeFileSync(s.state, JSON.stringify({ move: { state: 'awaiting-confirm', mode: 'copy', from: old, to: dir, oldCopy: { path: old, since: new Date().toISOString() } } }));
    const g = await boot(dir, s.env);
    try {
      // what cloudflared and other forwarders deliver: a LOOPBACK socket carrying forwarding headers or a public Host
      const tunnelled = [
        { 'X-Forwarded-For': '203.0.113.9' },
        { Forwarded: 'for=203.0.113.9' },
        { 'CF-Connecting-IP': '203.0.113.9' },
        { 'CF-Ray': '8a1b2c3d4e5f-LHR' },
        { 'X-Real-IP': '203.0.113.9' },
        { 'Tailscale-User-Login': 'someone@example.com' },
        { Host: 'quiet-river-1234.trycloudflare.com' },
        { Host: 'box.tail1234.ts.net' },
      ];
      for (const headers of tunnelled) {
        const r = await http('POST', '/storage/move', { token: TOKEN, headers, body: { drive: s.home } });
        assert.equal(r.status, 403, `a move with ${JSON.stringify(headers)} answered ${r.status}: ${r.body}`);
        assert.equal(r.json && r.json.error, 'local-only');
        const rm = await http('POST', '/storage/remove-old', { token: TOKEN, headers, body: { path: old } });
        assert.equal(rm.status, 403, `remove-old with ${JSON.stringify(headers)} answered ${rm.status}: ${rm.body}`);
        const gt = await http('GET', '/storage', { token: TOKEN, headers });
        assert.equal(gt.status, 200, 'the card cannot even be read from another device');
        assert.equal(gt.json.local, false, `GET with ${JSON.stringify(headers)} was reported local`);
        assert.equal(gt.json.canChange, false);
      }
      assert.equal(existsSync(join(dir, '.move-request')), false, 'a tunnelled request wrote a move request');
      assert.equal(existsSync(join(dir, '.remove-old-request')), false, 'a tunnelled request wrote a remove request');
      assert.equal((await http('GET', '/status')).status, 200, 'a tunnelled request stopped the relay');
      // the same remove-old from the relay's own computer is accepted, so the refusals above were the gate
      const okLocal = await http('POST', '/storage/remove-old', { token: TOKEN, body: { path: old } });
      assert.equal(okLocal.status, 200, okLocal.body);
      rmSync(join(dir, '.remove-old-request'), { force: true });
    } finally { await stop(g); }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('Suite local-only: a request from another computer on the LAN (non-loopback socket) is refused, even with a loopback Host', async (t) => {
  const lan = lanAddress();
  if (!lan) { t.skip('this machine has no non-loopback IPv4 address; the LAN case is NOT proven here'); return; }
  const base = mkdtempSync(join(tmpdir(), 'trin-storage-lan-'));
  try {
    const { dir } = relayFolder(base);
    const s = suiteEnv(base);
    const g = await boot(dir, s.env);   // no RELAY_HOST: binds 0.0.0.0, as with the Suite's LAN-access toggle on
    try {
      const r = await http('POST', '/storage/move', { token: TOKEN, host: lan, headers: { Host: `127.0.0.1:${PORT}` }, body: { drive: s.home } });
      assert.equal(r.status, 403, `a LAN move answered ${r.status}: ${r.body}`);
      const gt = await http('GET', '/storage', { token: TOKEN, host: lan, headers: { Host: `127.0.0.1:${PORT}` } });
      assert.equal(gt.json.local, false, 'a LAN request was reported local');
      assert.equal(existsSync(join(dir, '.move-request')), false);
      assert.equal(g.code, undefined, 'a LAN request stopped the relay');
    } finally { await stop(g); }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('Server mode: a move is NOT local-only (panel only, the root helper is the boundary) but still needs the token', async () => {
  const base = mkdtempSync(join(tmpdir(), 'trin-storage-server-'));
  try {
    const { dir } = relayFolder(base);
    const g = await boot(dir, { TRINITY_STORAGE_MODE: 'server', TRINITY_STORAGE_STATE: join(base, 'move-state.json') });
    try {
      const gt = await http('GET', '/storage', { token: TOKEN, headers: { 'X-Forwarded-For': '203.0.113.9' } });
      assert.equal(gt.status, 200, gt.body);
      assert.equal(gt.json.mode, 'server');
      assert.equal(gt.json.local, false);
      assert.equal(gt.json.canChange, true, 'a server panel opened through the tunnel must be able to ask');
      // an offered-drive check still applies: a typed path is never accepted
      const r = await http('POST', '/storage/move', { token: TOKEN, headers: { 'X-Forwarded-For': '203.0.113.9' }, body: { drive: '/etc' } });
      assert.equal(r.status, 400, r.body);
      assert.equal(r.json.error, 'drive-not-offered');
      assert.equal((await http('POST', '/storage/move', { body: { drive: '/etc' } })).status, 401);
      assert.equal(existsSync(join(dir, '.move-request')), false);
    } finally { await stop(g); }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('the card: current folder and size, the drive list judged by the mover\'s own checks, leftovers, the 7-day reminder', async () => {
  const base = mkdtempSync(join(tmpdir(), 'trin-storage-card-'));
  try {
    const { dir } = relayFolder(base);
    writeFileSync(join(dir, 'blob.bin'), Buffer.alloc(300000, 7));
    const s = suiteEnv(base);
    const g = await boot(dir, s.env);
    try {
      let r = (await http('GET', '/storage', { token: TOKEN })).json;
      assert.equal(r.mode, 'suite');
      assert.equal(r.local, true);
      assert.equal(r.canChange, true);
      assert.equal(r.current.path, dir);
      assert.ok(r.current.sizeBytes >= 300000, 'the size does not count the data folder: ' + r.current.sizeBytes);
      assert.ok(r.current.freeBytes > 0);
      assert.deepEqual(r.refuse, [], 'a box with nothing pending refuses a move: ' + JSON.stringify(r.refuse));
      assert.equal(r.move, null);
      assert.deepEqual(r.leftovers, []);
      const home = r.drives.find(d => d.mountpoint === s.home);
      assert.ok(home, 'the home folder is not offered: ' + JSON.stringify(r.drives.map(d => d.mountpoint)));
      assert.equal(home.target, join(s.home, 'trinityone-relay'), 'the folder name is not the fixed leaf');
      assert.equal(home.eligible, true, 'the home folder was refused: ' + JSON.stringify(home.refuse));
      assert.equal(home.sameDrive, true, 'a temp home on the same disk as the temp data folder was not seen as the same drive');

      // a non-empty folder already at the fixed name is refused; one holding only a MOVED-TO tombstone is not
      mkdirSync(join(s.home, 'trinityone-relay'));
      writeFileSync(join(s.home, 'trinityone-relay', 'something.txt'), 'x');
      r = (await http('GET', '/storage', { token: TOKEN })).json;
      assert.deepEqual(r.drives.find(d => d.mountpoint === s.home).refuse, ['target-not-empty']);
      rmSync(join(s.home, 'trinityone-relay', 'something.txt'));
      writeFileSync(join(s.home, 'trinityone-relay', 'MOVED-TO'), 'moved\n');
      r = (await http('GET', '/storage', { token: TOKEN })).json;
      assert.equal(r.drives.find(d => d.mountpoint === s.home).eligible, true, 'a tombstone-only target was refused');

      // journal: a kept old copy is a refusal, is shown with its age, and the reminder fires at 7 days
      const old = join(base, 'old'); mkdirSync(old);
      const days = n => new Date(Date.now() - n * 86400000).toISOString();
      const journal = (move) => writeFileSync(s.state, JSON.stringify({ dataDir: dir, move }));
      journal({ state: 'awaiting-confirm', mode: 'copy', from: old, to: dir, oldCopy: { path: old, since: days(2) },
        leftovers: [{ path: join(base, 'aside-1'), kind: 'set-aside', since: days(1) }, { path: join(base, 'gone'), kind: 'tombstone', since: days(3), removedAt: days(1) }] });
      r = (await http('GET', '/storage', { token: TOKEN })).json;
      assert.ok(r.refuse.includes('old-copy-awaiting-removal'), JSON.stringify(r.refuse));
      assert.equal(r.oldCopy.path, old);
      assert.equal(r.oldCopy.exists, true);
      assert.equal(r.oldCopy.ageDays, 2);
      assert.equal(r.oldCopy.remind, false, 'reminded after 2 days');
      assert.deepEqual(r.leftovers.map(l => [l.path, l.kind, l.exists]), [[join(base, 'aside-1'), 'set-aside', false]], 'leftovers wrong (a removedAt entry must not be offered again)');
      journal({ state: 'awaiting-confirm', mode: 'copy', from: old, to: dir, oldCopy: { path: old, since: days(8) } });
      r = (await http('GET', '/storage', { token: TOKEN })).json;
      assert.equal(r.oldCopy.remind, true, 'no reminder after 8 days');

      // a move under way
      journal({ state: 'copying', mode: 'copy', from: dir, to: join(s.home, 'trinityone-relay'), totalBytes: 10, copiedBytes: 4 });
      r = (await http('GET', '/storage', { token: TOKEN })).json;
      assert.ok(r.refuse.includes('move-in-progress'), JSON.stringify(r.refuse));
      assert.equal(r.move.state, 'copying');
      assert.equal(r.move.copiedBytes, 4);

      // a staged restore
      journal({ state: 'done', mode: 'rename', from: old, to: dir });
      mkdirSync(join(dir, '.restore-pending'));
      r = (await http('GET', '/storage', { token: TOKEN })).json;
      assert.deepEqual(r.refuse, ['restore-pending']);
      const mv = await http('POST', '/storage/move', { token: TOKEN, body: { drive: s.home } });
      assert.equal(mv.status, 409, mv.body);
      assert.deepEqual(mv.json.refuse, ['restore-pending']);
      rmSync(join(dir, '.restore-pending'), { recursive: true });

      // ANOTHER live relay process holding this folder (its lock note names a running gateway that is not us)
      const other = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', 'scripts/gateway.mjs'], { stdio: 'ignore' });
      try {
        await sleep(300);
        const mine = readFileSync(join(dir, '.relay-lock'), 'utf8');
        writeFileSync(join(dir, '.relay-lock'), JSON.stringify({ pid: other.pid, startedAt: new Date(Date.now() - 1000).toISOString() }));
        r = (await http('GET', '/storage', { token: TOKEN })).json;
        assert.deepEqual(r.refuse, ['relay-running']);
        writeFileSync(join(dir, '.relay-lock'), mine);
      } finally { other.kill('SIGKILL'); }
      r = (await http('GET', '/storage', { token: TOKEN })).json;
      assert.deepEqual(r.refuse, [], 'the refusals did not clear: ' + JSON.stringify(r.refuse));
      assert.equal(existsSync(join(dir, '.move-request')), false, 'a refused move wrote a request');
      assert.equal(g.code, undefined, 'a refused move stopped the relay');
    } finally { await stop(g); }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('the card: a symlinked place is refused, and with no journal location a move is refused', async () => {
  const base = mkdtempSync(join(tmpdir(), 'trin-storage-link-'));
  try {
    const { dir } = relayFolder(base);
    const real = join(base, 'real-home'); mkdirSync(real);
    const linked = join(base, 'linked-home'); symlinkSync(real, linked);
    const g = await boot(dir, { TRINITY_STORAGE_MODE: 'suite', HOME: linked, USER: 'nobody-storage-test' });   // NO TRINITY_STORAGE_STATE
    try {
      const r = (await http('GET', '/storage', { token: TOKEN })).json;
      const d = r.drives.find(x => x.mountpoint === linked);
      assert.ok(d, 'the home folder is not listed');
      assert.deepEqual(d.refuse, ['path-has-symlink'], 'a symlinked place was offered: ' + JSON.stringify(d));
      assert.ok(r.refuse.includes('storage-state-unknown'), 'a box that cannot read its move journal offered a move: ' + JSON.stringify(r.refuse));
      const mv = await http('POST', '/storage/move', { token: TOKEN, body: { drive: linked } });
      assert.equal(mv.status, 409, mv.body);
      assert.equal(existsSync(join(dir, '.move-request')), false);
    } finally { await stop(g); }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('remove-old asks only for a folder the journal recorded, never the folder in use, and does not stop the relay', async () => {
  const base = mkdtempSync(join(tmpdir(), 'trin-storage-remove-'));
  try {
    const { dir, pub } = relayFolder(base);
    const s = suiteEnv(base);
    const old = join(base, 'old'); mkdirSync(old);
    const aside = join(base, 'aside'); mkdirSync(aside);
    writeFileSync(s.state, JSON.stringify({ move: { state: 'awaiting-confirm', mode: 'copy', from: old, to: dir, oldCopy: { path: old, since: new Date().toISOString() },
      leftovers: [{ path: aside, kind: 'set-aside', since: new Date().toISOString() }, { path: dir, kind: 'tombstone', since: new Date().toISOString() }] } }));
    const g = await boot(dir, s.env);
    try {
      for (const path of ['/etc', join(base, 'not-recorded'), '', 42]) {
        const r = await http('POST', '/storage/remove-old', { token: TOKEN, body: { path } });
        assert.equal(r.status, 400, `remove-old ${JSON.stringify(path)} answered ${r.status}: ${r.body}`);
      }
      const cur = await http('POST', '/storage/remove-old', { token: TOKEN, body: { path: dir } });
      assert.equal(cur.status, 409, 'the folder in use could be asked for removal: ' + cur.body);
      assert.equal(existsSync(join(dir, '.remove-old-request')), false);
      let r = await http('POST', '/storage/remove-old', { token: TOKEN, body: { path: old } });
      assert.equal(r.status, 200, r.body);
      assert.deepEqual((({ path, kind, relayPub }) => ({ path, kind, relayPub }))(readJson(join(dir, '.remove-old-request'))), { path: old, kind: 'old-copy', relayPub: pub });
      r = await http('POST', '/storage/remove-old', { token: TOKEN, body: { path: aside } });
      assert.equal(r.status, 200, r.body);
      assert.equal(readJson(join(dir, '.remove-old-request')).kind, 'leftover');
      assert.ok(existsSync(old) && existsSync(aside), 'the gateway removed something itself');
      assert.equal((await http('GET', '/status')).status, 200);
      assert.equal(g.code, undefined, 'remove-old stopped the relay');
    } finally { await stop(g); }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('a move from the relay\'s own computer: only an offered drive; writes .move-request, then exits 0 with the WAL folded', async () => {
  const base = mkdtempSync(join(tmpdir(), 'trin-storage-move-'));
  try {
    const { dir, pub } = relayFolder(base);
    const s = suiteEnv(base);
    const g = await boot(dir, s.env);
    try {
      for (const drive of ['/etc', join(s.home, 'trinityone-relay'), s.home + '/', '', null]) {
        const r = await http('POST', '/storage/move', { token: TOKEN, body: { drive } });
        assert.equal(r.status, 400, `a move to ${JSON.stringify(drive)} answered ${r.status}: ${r.body}`);
        assert.equal(r.json.error, 'drive-not-offered');
      }
      assert.equal(existsSync(join(dir, '.move-request')), false);
      assert.equal(g.code, undefined);
      const wal = join(dir, 'relay.sqlite-wal');
      assert.ok(existsSync(wal) && statSync(wal).size > 0, 'precondition: the running relay has a non-empty WAL (else the fold proves nothing)');
      const r = await http('POST', '/storage/move', { token: TOKEN, body: { drive: s.home } });
      assert.equal(r.status, 200, r.body);
      assert.equal(r.json.stopping, true);
      const code = await Promise.race([g.exited, sleep(15000).then(() => 'timeout')]);
      assert.equal(code, 0, 'the relay did not exit cleanly after a move request (got ' + code + ', signal ' + g.signal + '). Log:\n' + g.log);
      const req = readJson(join(dir, '.move-request'));
      assert.equal(req.drive, s.home);
      assert.equal(req.target, join(s.home, 'trinityone-relay'));
      assert.equal(req.from, dir);
      assert.equal(req.relayPub, pub);
      assert.equal(typeof req.events, 'number');
      assert.ok(!existsSync(wal) || statSync(wal).size === 0, 'the relay exited with an unfolded WAL: a copy of relay.sqlite would lose the newest writes');
      assert.equal(existsSync(join(dir, '.relay-lock')), false, 'the relay left its lock note: the mover would think it still runs');
      assert.equal(existsSync(join(s.home, 'trinityone-relay')), false, 'the gateway moved data itself');
    } finally { await stop(g); }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('request files never travel: a backup leaves them out and a restore never applies one', async () => {
  const base = mkdtempSync(join(tmpdir(), 'trin-storage-backup-'));
  try {
    const { dir } = relayFolder(base);
    writeFileSync(join(dir, '.move-request'), '{"drive":"/media/x"}\n');
    writeFileSync(join(dir, '.remove-old-request'), '{"path":"/media/x/old"}\n');
    let g = await boot(dir);   // UNSET mode: this protects every box, opted in or not
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/relay-backup`, { headers: { Authorization: 'Bearer ' + TOKEN } });
      assert.equal(res.status, 200);
      const tgz = join(base, 'b.tgz'); writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
      const { spawnSync } = await import('node:child_process');
      const list = spawnSync('tar', ['-tzf', tgz], { encoding: 'utf8' }).stdout;
      assert.match(list, /relay-key\.json/, 'precondition: the backup holds the key');
      assert.doesNotMatch(list, /move-request|remove-old-request/, 'a backup carried a request to the launcher:\n' + list);
    } finally { await stop(g); }
    rmSync(join(dir, '.move-request')); rmSync(join(dir, '.remove-old-request'));
    // a hand-made backup that does carry them, staged for restore-on-boot
    const staging = join(dir, '.restore-pending'); mkdirSync(staging);
    writeFileSync(join(staging, 'church.json'), '{}');
    writeFileSync(join(staging, '.move-request'), '{"drive":"/media/x"}\n');
    writeFileSync(join(staging, '.remove-old-request'), '{"path":"/media/x/old"}\n');
    g = await boot(dir);
    try {
      assert.match(g.log, /restored relay data from a backup/, 'precondition: the restore ran. Log:\n' + g.log);
      assert.equal(existsSync(join(dir, '.move-request')), false, 'a restore applied a move request from another box');
      assert.equal(existsSync(join(dir, '.remove-old-request')), false, 'a restore applied a remove request from another box');
    } finally { await stop(g); }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

// A preload that adds lines to what the gateway reads from /proc/self/mountinfo and replaces /etc/fstab, so a test
// can present an exFAT drive or a mounted-but-not-in-fstab drive. Everything the gateway does with them is real.
function fakeMountsPreload(base) {
  const f = join(base, 'fake-mounts.mjs');
  writeFileSync(f, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const add = process.env.TEST_MOUNTINFO_ADD || '', fstab = process.env.TEST_FSTAB;
const sysRoot = process.env.TEST_SYSFS_ROOT || '';                     // /sys/... is read from here instead
const dirMap = JSON.parse(process.env.TEST_READDIR_MAP || '{}');       // listing a mapped folder lists another
const sys = p => sysRoot && String(p).startsWith('/sys/') ? sysRoot + String(p) : p;
const orig = fs.promises.readFile, origRp = fs.promises.realpath, origRd = fs.promises.readdir;
fs.promises.readFile = async function (p, ...a) {
  if (String(p) === '/etc/fstab' && fstab !== undefined) return fstab;
  const t = await orig.call(this, sys(p), ...a);
  return String(p) === '/proc/self/mountinfo' && add ? String(t) + add : t;
};
fs.promises.realpath = async function (p, ...a) { return origRp.call(this, sys(p), ...a); };
fs.promises.readdir = async function (p, ...a) { return origRd.call(this, dirMap[String(p)] || p, ...a); };
syncBuiltinESMExports();\n`);
  return '--import ' + f;
}

test('owner §8b: a move to a drive with no file permissions is refused unless the request carries the acknowledgement', async () => {
  const base = mkdtempSync(join(tmpdir(), 'trin-storage-ack-'));
  try {
    const { dir } = relayFolder(base);
    const s = suiteEnv(base);
    const g = await boot(dir, { ...s.env, NODE_OPTIONS: fakeMountsPreload(base), TEST_MOUNTINFO_ADD: `9999 1 0:999 / ${s.home} rw,relatime shared:999 - exfat /dev/sdz1 rw\n` });
    try {
      const d = (await http('GET', '/storage', { token: TOKEN })).json.drives.find(x => x.mountpoint === s.home);
      assert.ok(d && d.eligible, 'precondition: the exFAT home drive is offered: ' + JSON.stringify(d));
      assert.ok(d.warn.includes('no-permissions'), 'precondition: the exFAT drive carries the no-permissions warning');
      for (const body of [{ drive: s.home }, { drive: s.home, acknowledge: [] }, { drive: s.home, acknowledge: 'no-permissions' }, { drive: s.home, acknowledge: ['removable'] }]) {
        const r = await http('POST', '/storage/move', { token: TOKEN, body });
        assert.equal(r.status, 409, `a move to an exFAT drive with ${JSON.stringify(body)} answered ${r.status}: ${r.body}`);
        assert.deepEqual(r.json.refuse, ['no-permissions-not-acknowledged']);
      }
      assert.equal(existsSync(join(dir, '.move-request')), false, 'an unacknowledged exFAT move wrote a request');
      assert.equal(g.code, undefined, 'an unacknowledged exFAT move stopped the relay');
      const ok = await http('POST', '/storage/move', { token: TOKEN, body: { drive: s.home, acknowledge: ['no-permissions'] } });
      assert.equal(ok.status, 200, 'the acknowledged move was refused: ' + ok.body);
      assert.equal(await Promise.race([g.exited, sleep(15000).then(() => 'timeout')]), 0);
      assert.equal(readJson(join(dir, '.move-request')).drive, s.home);
    } finally { await stop(g); }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('server mode: a drive mounted but not in /etc/fstab is listed, refused with not-in-fstab; an fstab one is not, and may be moved to THROUGH THE TUNNEL with the token', async () => {
  const base = mkdtempSync(join(tmpdir(), 'trin-storage-fstab-'));
  try {
    const { dir } = relayFolder(base);
    const inTab = join(base, 'disk-in-fstab'), loose = join(base, 'disk-by-hand');
    mkdirSync(inTab); mkdirSync(loose);
    const g = await boot(dir, { TRINITY_STORAGE_MODE: 'server', TRINITY_STORAGE_STATE: join(base, 'move-state.json'), NODE_OPTIONS: fakeMountsPreload(base),
      TEST_MOUNTINFO_ADD: `9998 1 0:998 / ${inTab} rw,relatime shared:998 - ext4 /dev/sdy1 rw\n9999 1 0:999 / ${loose} rw,relatime shared:999 - ext4 /dev/sdz1 rw\n`,
      TEST_FSTAB: `# test fstab\n/dev/sdy1 ${inTab} ext4 defaults 0 2\n/dev/sda2 none swap sw 0 0\n` });
    try {
      const r = (await http('GET', '/storage', { token: TOKEN })).json;
      const a = r.drives.find(x => x.mountpoint === inTab), b = r.drives.find(x => x.mountpoint === loose);
      assert.ok(a, 'the fstab drive is not listed: ' + JSON.stringify(r.drives.map(x => x.mountpoint)));
      assert.equal(a.eligible, true, 'the fstab ext4 drive was refused: ' + JSON.stringify(a.refuse));
      assert.ok(b, 'a mounted drive that is not in fstab is not listed at all (the steward cannot learn why)');
      assert.ok(b.refuse.includes('not-in-fstab'), 'a drive not in fstab was offered on a server: ' + JSON.stringify(b));
      const mv = await http('POST', '/storage/move', { token: TOKEN, body: { drive: loose } });
      assert.equal(mv.status, 409, mv.body);
      assert.equal(existsSync(join(dir, '.move-request')), false);
      // owner §8b: on a SERVER a move may be started through the tunnel, with the admin token
      const tunnelled = { 'X-Forwarded-For': '203.0.113.9', 'CF-Connecting-IP': '203.0.113.9', Host: 'quiet-river-1234.trycloudflare.com' };
      assert.equal((await http('POST', '/storage/move', { headers: tunnelled, body: { drive: inTab } })).status, 401, 'a tunnelled move without the token was not refused');
      const ok = await http('POST', '/storage/move', { token: TOKEN, headers: tunnelled, body: { drive: inTab } });
      assert.equal(ok.status, 200, 'a server refused a tunnelled move with the token: ' + ok.body);
      assert.equal(await Promise.race([g.exited, sleep(15000).then(() => 'timeout')]), 0);
      assert.equal(readJson(join(dir, '.move-request')).drive, inTab);
    } finally { await stop(g); }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('owner §8b: a REMOVABLE drive (USB wear) needs its acknowledgement too, whatever its filesystem; a fixed one needs none', async () => {
  for (const [fs, opts, need] of [['ext4', 'rw,removable', ['removable']], ['exfat', 'rw,removable', ['no-permissions', 'removable']], ['ext4', 'rw', []]]) {
    const base = mkdtempSync(join(tmpdir(), 'trin-storage-usb-'));
    try {
      const { dir } = relayFolder(base);
      const s = suiteEnv(base);
      const g = await boot(dir, { ...s.env, NODE_OPTIONS: fakeMountsPreload(base), TEST_MOUNTINFO_ADD: `9999 1 0:999 / ${s.home} rw,relatime shared:999 - ${fs} /dev/sdz1 ${opts}\n` });
      try {
        const d = (await http('GET', '/storage', { token: TOKEN })).json.drives.find(x => x.mountpoint === s.home);
        assert.ok(d && d.eligible, `precondition (${fs} ${opts}): the drive is offered: ` + JSON.stringify(d));
        assert.equal(d.warn.includes('removable'), opts.includes('removable'), `${fs} ${opts}: removable warning wrong: ` + JSON.stringify(d.warn));
        if (need.length) {
          for (const partial of [[], need.slice(0, -1)]) {
            const r = await http('POST', '/storage/move', { token: TOKEN, body: { drive: s.home, acknowledge: partial } });
            assert.equal(r.status, 409, `${fs} ${opts} with acknowledge ${JSON.stringify(partial)} answered ${r.status}: ${r.body}`);
            assert.ok(r.json.refuse.includes(need[need.length - 1] + '-not-acknowledged'), JSON.stringify(r.json));
          }
          assert.equal(existsSync(join(dir, '.move-request')), false, `${fs} ${opts}: an unacknowledged move wrote a request`);
        }
        const ok = await http('POST', '/storage/move', { token: TOKEN, body: { drive: s.home, acknowledge: need } });
        assert.equal(ok.status, 200, `${fs} ${opts} with acknowledge ${JSON.stringify(need)} was refused: ${ok.body}`);
        assert.equal(await Promise.race([g.exited, sleep(15000).then(() => 'timeout')]), 0);
      } finally { await stop(g); }
    } finally { rmSync(base, { recursive: true, force: true }); }
  }
});

test('audit B M-1: a request older than this run of the relay (never consumed) is stale, not "under way"; a fresh one still refuses', async () => {
  const base = mkdtempSync(join(tmpdir(), 'trin-storage-stale-'));
  try {
    const { dir } = relayFolder(base);
    const s = suiteEnv(base);
    writeFileSync(join(dir, '.move-request'), JSON.stringify({ drive: s.home, requestedAt: new Date(Date.now() - 3600e3).toISOString() }));
    const g = await boot(dir, s.env);
    try {
      let r = (await http('GET', '/storage', { token: TOKEN })).json;
      assert.ok(!r.refuse.includes('move-already-requested'), 'a stale request left from before this start blocks every move for ever: ' + JSON.stringify(r.refuse));
      assert.equal(r.requests.move.stale, true);
      // a request written by THIS run (the relay stops straight after, so this only happens if the stop failed) refuses
      writeFileSync(join(dir, '.move-request'), JSON.stringify({ drive: s.home, requestedAt: new Date().toISOString() }));
      r = (await http('GET', '/storage', { token: TOKEN })).json;
      assert.ok(r.refuse.includes('move-already-requested'), 'a live request was ignored: ' + JSON.stringify(r.refuse));
      assert.equal(r.requests.move.stale, false);
      // while a move is under way a request is never stale
      writeFileSync(join(dir, '.move-request'), JSON.stringify({ drive: s.home, requestedAt: new Date(Date.now() - 3600e3).toISOString() }));
      writeFileSync(s.state, JSON.stringify({ move: { state: 'copying', from: dir, to: join(s.home, 'trinityone-relay') } }));
      r = (await http('GET', '/storage', { token: TOKEN })).json;
      assert.equal(r.requests.move.stale, false, 'a request during an active move was called stale');
    } finally { await stop(g); }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('audit B L-4: remove-old refuses a recorded path that holds, sits inside, or symlinks to the live folder', async () => {
  const base = mkdtempSync(join(tmpdir(), 'trin-storage-l4-'));
  try {
    const { dir } = relayFolder(base);
    mkdirSync(join(dir, 'blobs'));
    const s = suiteEnv(base);
    const link = join(base, 'link-to-data'); symlinkSync(dir, link);
    const fine = join(base, 'aside'); mkdirSync(fine);
    const now = new Date().toISOString();
    writeFileSync(s.state, JSON.stringify({ move: { state: 'done', mode: 'copy', from: base, to: dir,
      leftovers: [base, join(dir, 'blobs'), link, fine].map(p => ({ path: p, kind: 'set-aside', since: now })) } }));
    const g = await boot(dir, s.env);
    try {
      for (const [path, why] of [[base, 'a folder that HOLDS the live one'], [join(dir, 'blobs'), 'a folder INSIDE the live one'], [link, 'a symlink TO the live one']]) {
        const r = await http('POST', '/storage/remove-old', { token: TOKEN, body: { path } });
        assert.equal(r.status, 409, `remove-old accepted ${why}: ${r.body}`);
        assert.equal(existsSync(join(dir, '.remove-old-request')), false, `a removal was requested for ${why}`);
      }
      assert.equal((await http('POST', '/storage/remove-old', { token: TOKEN, body: { path: fine } })).status, 200, 'an unrelated recorded leftover was refused');
    } finally { await stop(g); }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('audit B L-2: on Linux the Suite offers /media/$USER/* only when the entry is a real mountpoint', async () => {
  const base = mkdtempSync(join(tmpdir(), 'trin-storage-l2-'));
  try {
    const { dir } = relayFolder(base);
    const s = suiteEnv(base);
    const fakeMedia = join(base, 'media-listing'); mkdirSync(join(fakeMedia, 'STICK'), { recursive: true }); mkdirSync(join(fakeMedia, 'LEFTOVER'));
    const user = 'storage-test-user';
    const g = await boot(dir, { ...s.env, USER: user, NODE_OPTIONS: fakeMountsPreload(base),
      TEST_READDIR_MAP: JSON.stringify({ ['/media/' + user]: fakeMedia }),
      TEST_MOUNTINFO_ADD: `9999 1 0:999 / /media/${user}/STICK rw,relatime shared:999 - vfat /dev/sdz1 rw\n` });
    try {
      const r = (await http('GET', '/storage', { token: TOKEN })).json;
      const mps = r.drives.map(d => d.mountpoint);
      assert.ok(mps.includes(`/media/${user}/STICK`), 'a mounted stick under /media/$USER is not offered: ' + JSON.stringify(mps));
      assert.ok(!mps.includes(`/media/${user}/LEFTOVER`), 'a directory left under /media/$USER after an unmount is offered (the R1 trap): ' + JSON.stringify(mps));
    } finally { await stop(g); }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('audit B L-6 (Linux): a drive whose block device is on USB or removable gets the wear warning wherever it is mounted', async () => {
  // an injected /sys: three block devices — one under a USB bus, one whose disk says removable=1, one plain SATA
  const cases = [['sdq1', 'pci0000:00/0000:00:14.0/usb2/2-1/2-1:1.0/host6/target6:0:0/6:0:0:0/block/sdq/sdq1', '0', true],
                 ['sdr1', 'pci0000:00/0000:00:17.0/ata3/host2/target2:0:0/2:0:0:0/block/sdr/sdr1', '1', true],
                 ['sds1', 'pci0000:00/0000:00:17.0/ata4/host3/target3:0:0/3:0:0:0/block/sds/sds1', '0', false]];
  for (const [dev, path, removable, want] of cases) {
    const base = mkdtempSync(join(tmpdir(), 'trin-storage-l6-'));
    try {
      const { dir } = relayFolder(base);
      const s = suiteEnv(base);
      const sys = join(base, 'sysroot');
      const devDir = join(sys, 'sys', 'devices', path); mkdirSync(devDir, { recursive: true });
      writeFileSync(join(devDir, '..', 'removable'), removable + '\n');
      writeFileSync(join(devDir, 'partition'), '1\n');
      mkdirSync(join(sys, 'sys', 'class', 'block'), { recursive: true });
      symlinkSync(devDir, join(sys, 'sys', 'class', 'block', dev));
      const g = await boot(dir, { ...s.env, NODE_OPTIONS: fakeMountsPreload(base), TEST_SYSFS_ROOT: sys,
        TEST_MOUNTINFO_ADD: `9999 1 0:999 / ${s.home} rw,relatime shared:999 - ext4 /dev/${dev} rw\n` });
      try {
        const d = (await http('GET', '/storage', { token: TOKEN })).json.drives.find(x => x.mountpoint === s.home);
        assert.ok(d, 'the drive is not listed');
        assert.equal(d.warn.includes('removable'), want, `${dev} (${path.includes('/usb') ? 'USB' : 'SATA'}, removable=${removable}): wear warning ${want ? 'missing' : 'wrongly shown'}: ${JSON.stringify(d.warn)}`);
        if (want) assert.equal((await http('POST', '/storage/move', { token: TOKEN, body: { drive: s.home } })).status, 409, 'a USB drive was moved to without the acknowledgement');
      } finally { await stop(g); }
    } finally { rmSync(base, { recursive: true, force: true }); }
  }
});

test('audit B L-6 (Windows, parser only — the real PowerShell query is a step-7 device check): a USB bus marks a drive removable', () => {
  const rows = parseWinLogicalDisks(JSON.stringify([
    { DeviceID: 'C:', DriveType: 3, FileSystem: 'NTFS', BusType: 'NVMe' },
    { DeviceID: 'E:', DriveType: 3, FileSystem: 'exFAT', BusType: 'USB' },      // a USB SSD reports DriveType 3 (fixed)
    { DeviceID: 'F:', DriveType: 3, FileSystem: 'NTFS', BusType: '7' },          // the numeric BusType enum (7 = USB)
    { DeviceID: 'G:', DriveType: 2, FileSystem: 'FAT32' },                       // a stick: removable by DriveType alone
    { DeviceID: 'H:', DriveType: 3, FileSystem: 'NTFS' },                        // no bus known: not flagged
  ]));
  const rem = Object.fromEntries(rows.map(r => [r.mountpoint, r.options.includes('removable')]));
  assert.deepEqual(rem, { 'C:\\': false, 'E:\\': true, 'F:\\': true, 'G:\\': true, 'H:\\': false });
});
