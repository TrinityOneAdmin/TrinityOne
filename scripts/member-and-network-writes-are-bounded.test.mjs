// A STRANGER CANNOT FLOOD THE BOX WITH JUNK "JOIN" AND "NETWORK" RECORDS.
// Run: node --test scripts/member-and-network-writes-are-bounded.test.mjs
//
// Before this fix (R-8, audit 2026-09-27), `accept()` returned `true` unconditionally for any d-tag starting
// with `member:` or `network:`. A stranger could store 1,400 junk records without being a member, without
// naming a real church, and without hitting MEMBER_DOC_CAP. `network:` was worse: only a church key should
// declare its network, but any key could.
//
// The fix:
//   · `network:` → only a key this box knows as a church (`CHURCH_PUBS.has(e.pubkey)`)
//   · `member:` → the suffix must name a church this box hosts (`CHURCH_PUBS.has(cp)`)
//     OR the author already holds this exact d-tag (update, not flood)
//
// Callers of the changed line: `accept()` is called from the websocket EVENT handler only; `/import` and
// relay-to-relay sync bypass it, so restores and peer exchange are unaffected.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const PORT = 19931;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const ROOT = new URL('../', import.meta.url).pathname;
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K();
const stranger = K();

let relay, dataDir;

const conn = () => new Promise((r, j) => { const s = new WebSocket(WS_URL); s.on('open', () => r(s)); s.on('error', j); });
const send = (s, e) => new Promise(res => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { s.off('message', on); res(m); } };
  s.on('message', on); s.send(JSON.stringify(['EVENT', e]));
  setTimeout(() => res(['(no reply)', e.id, null, '']), 5000);
});
async function publishAs(who, e) {
  const s = await conn();
  const authed = new Promise(res => {
    const on = d => {
      const m = JSON.parse(d);
      if (m[0] === 'AUTH') { s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)])); res(true); }
    };
    s.on('message', on); setTimeout(() => res(false), 600);
  });
  s.send(JSON.stringify(['REQ', 'warm', { kinds: [30078], limit: 1 }]));
  await authed;
  await sleep(100);
  const out = await send(s, e); s.close(); return out;
}
const doc = (who, d, content, extra = []) => finalizeEvent({
  kind: 30078, created_at: now(),
  tags: [['d', d], ['t', NET], ...extra],
  content: typeof content === 'string' ? content : JSON.stringify(content),
}, who.sk);

before(async () => {
  await requireFreePort(PORT, 'member-and-network-writes-are-bounded.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-flood-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub), TRINITY_TAILSCALE_BIN: '/nonexistent' },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── CONTROLS: the normal paths still work ──────────────────────────────────────────────────────────────
test('CONTROL: a stranger can join a church that this box hosts', async () => {
  const frame = await publishAs(stranger, doc(stranger, 'trinityone/member:' + church.pub, { joined: now() }));
  assert.equal(frame[2], true, 'a real join was refused: ' + JSON.stringify(frame));
});

test('CONTROL: the church can declare its network', async () => {
  const netKey = K();
  const frame = await publishAs(church, doc(church, 'trinityone/network:' + netKey.pub, { joined: now() }));
  assert.equal(frame[2], true, 'the church could not declare its network: ' + JSON.stringify(frame));
});

// ── THE HOLES, now closed ──────────────────────────────────────────────────────────────────────────────
test('R-8: a stranger CANNOT write member: for a church this box does not host', async () => {
  const fakeCp = K().pub;
  const frame = await publishAs(stranger, doc(stranger, 'trinityone/member:' + fakeCp, { joined: now() }));
  assert.equal(frame[2], false,
    'THE HOLE: a stranger stored a join record for a church nobody on this box has heard of. ' +
    'Frame: ' + JSON.stringify(frame));
});

test('R-8: a stranger CANNOT write network: at all', async () => {
  const netKey = K();
  const frame = await publishAs(stranger, doc(stranger, 'trinityone/network:' + netKey.pub, { joined: now() }));
  assert.equal(frame[2], false,
    'THE HOLE: a stranger declared a network — only a church key should. Frame: ' + JSON.stringify(frame));
});

test('R-8: even a MEMBER cannot write network:', async () => {
  const netKey = K();
  const frame = await publishAs(stranger, doc(stranger, 'trinityone/network:' + netKey.pub, { via: 'member' }));
  assert.equal(frame[2], false,
    'a member declared a network — only a church key should. Frame: ' + JSON.stringify(frame));
});

// ── R-12: the reject log is excluded from backups ──────────────────────────────────────────────────────
test('R-12: /relay-backup excludes the reject log', async () => {
  // Trigger a refusal so rejected.log exists
  const frame = await publishAs(stranger, doc(stranger, 'trinityone/network:junk', { flood: true }));
  assert.equal(frame[2], false, 'the refusal did not happen');
  await sleep(300);
  assert.ok(existsSync(join(dataDir, 'rejected.log')), 'no rejected.log was written at all');
  // Fetch the backup and list its contents — rejected.log must be absent
  const token = JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token;
  const r = await fetch(`http://127.0.0.1:${PORT}/relay-backup`, {
    headers: { Authorization: 'Bearer ' + token },
  });
  assert.equal(r.status, 200, 'could not fetch backup: ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  // Write temp file, list with tar
  const { execSync } = await import('node:child_process');
  const tmp = join(dataDir, '_backup.tgz');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(tmp, buf);
  const listing = execSync(`tar tzf ${tmp}`).toString();
  assert.equal(listing.includes('rejected.log'), false,
    'rejected.log is in the backup — an attacker can fill the backup file: ' + listing.split('\n').filter(l => l.includes('rejected')).join(', '));
});
