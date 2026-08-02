// A RELAY THAT CANNOT SAVE MUST SAY SO. Run: node --test scripts/relay-storage-failure.test.mjs
//
// When the store refuses a write — a full disk, a read-only volume, a per-file limit, a corrupt image —
// store.put THROWS. That throw used to escape into the process-wide uncaughtException handler, which logs and
// carries on by design. Three things then happened at once:
//
//   * the event was lost
//   * the client got NO REPLY AT ALL. Not a rejection — silence. A publish simply never completes, so the
//     member's app sits waiting for an answer that will never come.
//   * /status kept answering ok:true, so a health check, an uptime monitor and the control dashboard all
//     stayed green while the church lost everything it sent.
//
// Measured before the fix, under a 1 MB per-file ceiling: 44 events stored, then 4 publishes that vanished
// with no reply and no operator signal anywhere except one line on stderr.
//
// Note the retention cull cannot prevent this. That budget counts EPHEMERAL EVENTS per church; it never
// touches the church's structure and cannot see media files at all.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8969;                       // unique across scripts/*.test.mjs and *.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K();
let relay, dataDir;

before(async () => {
  await requireFreePort(PORT, 'relay-storage-failure.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-storefail-'));
  // `ulimit -f` caps the size of any file this process may write, in 512-byte blocks. 2048 blocks = 1 MB —
  // enough for the relay to start and store a few events, then the store starts throwing. This reproduces a
  // full disk without needing one, and without touching anything outside the temp dir.
  relay = spawn('/bin/sh', ['-c', `ulimit -f 2048; exec "${process.execPath}" scripts/gateway.mjs ${PORT}`], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '20000', CHURCH_NPUB: npubEncode(church.pub) },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// Publish and wait for an answer. Resolves 'ok' / 'refused' / 'SILENCE' — the third is the finding.
async function publishOne(i) {
  const w = await new Promise((res, rej) => { const x = new WebSocket(WS_URL); x.on('open', () => res(x)); x.on('error', rej); });
  const ev = finalizeEvent({ kind: 1, created_at: now(),
    tags: [['t', 'trinityone'], ['p', church.pub]], content: 'x'.repeat(4000) + ' #' + i }, church.sk);
  const out = await new Promise(res => {
    const on = d => {
      const m = JSON.parse(d);
      if (m[0] === 'AUTH') w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(),
        tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, church.sk)]));
      if (m[0] === 'OK' && m[1] === ev.id) { w.off('message', on); res(m[2] ? 'ok' : 'refused:' + (m[3] || '')); }
    };
    w.on('message', on);
    w.send(JSON.stringify(['EVENT', ev]));
    setTimeout(() => res('SILENCE'), 5000);
  });
  w.close();
  return out;
}

test('a relay that cannot save answers the client instead of going quiet', async () => {
  const seen = [];
  for (let i = 0; i < 400 && !seen.some(r => r !== 'ok'); i++) seen.push(await publishOne(i));
  const firstBad = seen.find(r => r !== 'ok');

  assert.ok(firstBad, 'the store never refused a write, so this test proved nothing — the file ceiling is too '
    + 'high for this build, or the events are too small. Raise the payload or lower the ulimit.');
  assert.notEqual(firstBad, 'SILENCE',
    'the relay accepted the connection, failed to store the event, and said NOTHING. The member\'s app waits '
    + 'for an answer that never arrives, so a publish neither succeeds nor fails — it hangs. A refusal the '
    + 'client can see is the whole point: it can retry, warn, or queue. Silence it cannot act on.');
  assert.match(firstBad, /^refused:/, 'expected an explicit refusal, got: ' + firstBad);
  assert.match(firstBad, /storage/i,
    'the refusal should say the relay could not store it, so an operator reading a log knows to look at the '
    + 'disk rather than at the member: ' + firstBad);
});

test('…and stops reporting itself healthy', async () => {
  const s = await (await fetch(`http://127.0.0.1:${PORT}/status`, { cache: 'no-store' })).json();
  assert.equal(s.ok, false,
    'the relay is up, listening, and losing everything it is sent — and /status still says ok:true, so every '
    + 'uptime monitor and dashboard pointed at it stays green. "ok" has to mean "doing its job", not "the '
    + 'process is running".');
  assert.ok(s.degraded && s.degraded.what === 'storage', 'the status should name WHAT is degraded: ' + JSON.stringify(s.degraded));
  assert.ok(typeof s.degraded.reason === 'string' && s.degraded.reason.length, 'and why');
});

test('/status reports free disk space, which the retention cull cannot', async () => {
  // The cull is a COUNT of ephemeral events per church. It never touches the church's structure, it cannot
  // see media files, and nothing anywhere looked at actual space — so the first sign of a full disk was
  // silence. This is the reading an operator (or the console's relay tile) can act on before that happens.
  const s = await (await fetch(`http://127.0.0.1:${PORT}/status`, { cache: 'no-store' })).json();
  assert.ok(s.storage, '/status carries no storage reading at all');
  assert.equal(typeof s.storage.freeBytes, 'number', 'freeBytes missing: ' + JSON.stringify(s.storage));
  assert.equal(typeof s.storage.totalBytes, 'number', 'totalBytes missing: ' + JSON.stringify(s.storage));
  assert.ok(s.storage.totalBytes > 0, 'totalBytes should be a real figure');
  assert.ok(s.storage.usedPct >= 0 && s.storage.usedPct <= 100, 'usedPct out of range: ' + s.storage.usedPct);
});
