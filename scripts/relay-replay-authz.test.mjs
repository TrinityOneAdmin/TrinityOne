// A write the relay REFUSES must not change who is authorised.
// Run: node --test scripts/relay-replay-authz.test.mjs
//
// AUDIT 2026-07-26, CRITICAL. note() ran BEFORE store.put(), so an event that was then refused had already
// rewritten the relay's live authorization maps. Replay is not author-gated — any socket may send any validly
// signed event — so anyone holding a stale copy of a church doc could replay it and revert authorization until
// the next restart re-ran hydrateMaps(). The durable store stayed correct the whole time, which is what made it
// invisible: nothing in the DB looked wrong.
//
// The worst shape is READ access: replaying a stale invite-only group doc put the attacker back into
// GROUP_MEMBERS, which canRead() consults, exposing that group's history.
//
// HONEST LIMIT (2026-07-26): the fix — note() only for putRes === 'stored' — is in gateway.mjs, but this file
// does NOT yet reproduce the attack. My first attempt assumed a `{left:true}` member doc revokes posting, and
// it does not: a member who "leaves" can still post, so the sequence proved nothing. What remains here is the
// guard that the fix did not break legitimate re-joining. A real reproduction needs the group-doc variant the
// auditor used (stale invite-only group doc -> GROUP_MEMBERS -> canRead), and is recorded in AUDIT-BACKLOG.md.
// Do not read the green tick on this file as "the replay attack is covered". It is not.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';

const PORT = 8881;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const MEMBER_D = 'trinityone/member:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K(), M = K(), N = K();
const cp = church.pub;
let relay, dataDir, ws;

const connect = () => new Promise((res, rej) => { const s = new WebSocket(WS_URL); s.on('open', () => res(s)); s.on('error', rej); });
const pub = (sock, evt) => new Promise(r => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { sock.off('message', on); r([m[2], m[3] || '']); } }; sock.on('message', on); sock.send(JSON.stringify(['EVENT', evt])); });
const memberDoc = (who, at) => finalizeEvent({ kind: 30078, created_at: at || now(), tags: [['d', MEMBER_D + cp]], content: JSON.stringify({ joined: at || now() }) }, who.sk);
const leaveDoc  = (who, at) => finalizeEvent({ kind: 30078, created_at: at || now(), tags: [['d', MEMBER_D + cp]], content: JSON.stringify({ left: true }) }, who.sk);
const msg = (who, text) => finalizeEvent({ kind: 1, created_at: now(), tags: [['t', 'trinityone'], ['church', cp]], content: text }, who.sk);

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'trin-replay-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' } });
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(200); }
  ws = await connect();
});
after(() => { try { ws && ws.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });



test('a legitimate re-join still works (the fix must not break rejoining)', async () => {
  const fresh = memberDoc(M, now() + 10);   // genuinely newer → stored → note() runs
  assert.equal((await pub(ws, fresh))[0], true, 'a new member doc is accepted');
  await sleep(200);
  assert.equal((await pub(ws, msg(M, 'rejoined properly')))[0], true,
    'a member who legitimately re-joins must be able to post again');
});
