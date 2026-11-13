// THE MOVER'S CHECK COMMANDS — what the Suite launcher asks of scripts/relay-move.mjs after a move (relay storage plan
// step 5). Run: node --test scripts/relay-move-check-commands.test.mjs
//
// `prove` and `verify-restart` are how the launcher learns WHO answered on the relay's port (rule 10): a signed nonce
// from /relay-identity, never the bare relayPub string in /status. Driven here through the real CLI against a real
// gateway, and against two look-alikes: a host that copies /status (a forwarder, or any other program on the port),
// and one that replays an old proof.
//   * begin-check is the EXACT count taken before the relay is spawned on the new folder.
//   * check-passed turns the journal's state into awaiting-confirm (copy) / done (rename).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { freePort } from './relay-network-harness.mjs';
import { openStore } from './event-store.mjs';
import { countRows } from './relay-move.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MOVER = join(ROOT, 'scripts/relay-move.mjs');
const run = promisify(execFile);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanups = [];
after(() => { for (const f of cleanups.reverse()) { try { f(); } catch {} } });

function folder(events = 0) {
  const base = mkdtempSync(join(tmpdir(), 'trin-check-cmds-'));
  cleanups.push(() => rmSync(base, { recursive: true, force: true }));
  const data = join(base, 'data'); mkdirSync(data);
  const sk = generateSecretKey(), pub = getPublicKey(sk);
  writeFileSync(join(data, 'relay-key.json'), JSON.stringify({ sk: Buffer.from(sk).toString('hex'), pub }));
  const st = openStore(join(data, 'relay.sqlite'), { maxEvents: 500 });
  const a = generateSecretKey(), t0 = Math.floor(Date.now() / 1000) - 600;
  for (let i = 0; i < events; i++) st.put(finalizeEvent({ kind: 1, created_at: t0 + i, tags: [], content: 'r' + i }, a), '');
  st.close();
  return { base, data, pub, state: join(base, 'storage.json') };
}
async function gateway(dir) {
  const port = await freePort('check commands gateway');
  const proc = spawn(process.execPath, [join(ROOT, 'scripts/gateway.mjs'), String(port)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TRINITY_DATA_DIR: dir, RELAY_SYNC: '0', RELAY_HOST: '127.0.0.1', RELAY_NO_OPEN: '1', RELAY_DIRECTORY: 'http://127.0.0.1:9', TRINITY_TAILSCALE_BIN: '/nonexistent/tailscale' } });
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  cleanups.push(() => { try { proc.kill('SIGKILL'); } catch {} });
  let up = false;
  for (let i = 0; i < 200 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${port}/status`)).ok; } catch {} if (!up) await sleep(150); }
  assert.ok(up, 'gateway never came up: ' + log);
  return { port, stop: () => proc.kill('SIGKILL') };
}
const cli = async (args) => { try { const r = await run(process.execPath, [MOVER, ...args], { cwd: ROOT }); return JSON.parse(r.stdout.trim().split('\n').pop()); } catch (e) { if (e.stdout) return JSON.parse(e.stdout.trim().split('\n').pop()); throw e; } };
const journalOf = (fx, over) => writeFileSync(fx.state, JSON.stringify({ move: { state: 'switched', mode: 'copy', from: join(fx.base, 'old'), to: fx.data, relayPub: fx.pub, counts: null, ...over } }));

test('prove: a real relay proves the key it signs a fresh nonce with', async () => {
  const fx = folder(3);
  const g = await gateway(fx.data);
  const r = await cli(['prove', '--port', String(g.port)]);
  assert.deepEqual({ ok: r.ok, relayPub: r.relayPub }, { ok: true, relayPub: fx.pub });
  g.stop();
});

test('prove: a host that only copies /status (a forwarder, another program on the port) proves NOTHING, however right its string is', async () => {
  const fx = folder();
  const port = await freePort('lookalike');
  const srv = createServer((req, res) => {
    if (req.url.startsWith('/status')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, relayPub: fx.pub, counts: { events: 0 } })); }
    else { res.writeHead(404); res.end(); }
  }).listen(port, '127.0.0.1');
  cleanups.push(() => srv.close());
  const r = await cli(['prove', '--port', String(port)]);
  assert.equal(r.ok, false, 'a /status look-alike was accepted as the relay: ' + JSON.stringify(r));
  // and through verify-restart, which the launcher uses after a move: never ok
  journalOf(fx, { counts: { events: 0, deletions: 0, meta: 0 } });
  const v = await cli(['verify-restart', '--pointer', fx.state, '--port', String(port), '--data-dir', fx.data]);
  assert.equal(v.ok, false); assert.ok(v.bad.includes('relay-key'), JSON.stringify(v));
});

test('prove: a replayed proof (valid signature, someone else\'s nonce) is refused', async () => {
  const fx = folder();
  const port = await freePort('replay');
  const sk = Buffer.from(JSON.parse(readFileSync(join(fx.data, 'relay-key.json'), 'utf8')).sk, 'hex');
  const old = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', 'relay-identity'], ['method', 'GET'], ['nonce', '0'.repeat(32)], ['relay', `ws://127.0.0.1:${port}/relay`]], content: '' }, sk);
  const srv = createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ proof: old })); }).listen(port, '127.0.0.1');
  cleanups.push(() => srv.close());
  const r = await cli(['prove', '--port', String(port)]);
  assert.equal(r.ok, false); assert.equal(r.code, 'wrong-nonce');
});

test('verify-restart: the same key and the same events pass; a different recorded key fails; fewer events fail', async () => {
  const fx = folder(4);
  const counts = await countRows(fx.data);
  const g = await gateway(fx.data);
  journalOf(fx, { counts });
  const ok = await cli(['verify-restart', '--pointer', fx.state, '--port', String(g.port), '--data-dir', fx.data]);
  assert.equal(ok.ok, true, JSON.stringify(ok)); assert.equal(ok.relayPub, fx.pub); assert.equal(ok.events, 4);
  journalOf(fx, { counts, relayPub: 'ab'.repeat(32) });
  const wrongKey = await cli(['verify-restart', '--pointer', fx.state, '--port', String(g.port), '--data-dir', fx.data]);
  assert.equal(wrongKey.ok, false); assert.ok(wrongKey.bad.includes('relay-key'), JSON.stringify(wrongKey));
  journalOf(fx, { counts: { ...counts, events: 9 } });
  const fewer = await cli(['verify-restart', '--pointer', fx.state, '--port', String(g.port), '--data-dir', fx.data]);
  assert.equal(fewer.ok, false); assert.ok(fewer.bad.includes('event-count'), JSON.stringify(fewer));
  g.stop();
});

test('begin-check: exact counts before the relay runs (more events than recorded is a failure too); check-passed ends the move', async () => {
  const fx = folder(5);
  const counts = await countRows(fx.data);
  journalOf(fx, { counts });
  const good = await cli(['begin-check', '--pointer', fx.state]);
  assert.equal(good.ok, true, JSON.stringify(good));
  assert.equal(JSON.parse(readFileSync(fx.state, 'utf8')).move.state, 'checking');
  assert.ok(JSON.parse(readFileSync(fx.state, 'utf8')).move.preStartCounts, 'the pre-start counts were not recorded');
  const passed = await cli(['check-passed', '--pointer', fx.state]);
  assert.equal(passed.ok, true); assert.equal(JSON.parse(readFileSync(fx.state, 'utf8')).move.state, 'awaiting-confirm');
  // the folder holds MORE than the journal recorded: an exact check on a relay that has not run catches it
  journalOf(fx, { counts: { ...counts, events: counts.events - 1 } });
  const bad = await cli(['begin-check', '--pointer', fx.state]);
  assert.equal(bad.ok, false); assert.ok(bad.bad.includes('event-count'), JSON.stringify(bad));
});
