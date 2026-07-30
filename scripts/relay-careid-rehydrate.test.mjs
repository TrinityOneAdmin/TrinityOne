// A forged care id already ON DISK must not win at boot. Run: node --test scripts/relay-careid-rehydrate.test.mjs
//
// AUDIT-2026-07-30 S2, second half. `care:<id>` is a relay-GLOBAL id, and CARE_SKIPHASH / CARE_RECIPIENT /
// CARE_CHURCH are keyed by the bare id — so the last church to write one owns the entry. accept() now refuses a
// co-tenant's republish at the door, and relay-tenancy-write.test.mjs proves that.
//
// This file exists because that proof does not cover the OTHER path. On boot the gateway replays every stored
// event through note(), and accept() is not in that path at all. So a forgery that reached the disk some other
// way — written before the guard shipped, arriving over replication, or restored from a backup taken while the
// hole was open — would poison the map at every restart, for ever, with nothing refusing it.
//
// The distinction matters because the live-path guard was sabotage-verified and this one was NOT: removing
// note()'s check broke no test, since accept() had already refused the write. Untestable redundancy is how a
// real rule gets deleted later as dead code — the same trap as the event store's open-time ANALYZE.
//
// It also retro-covers the note() half of the AUDIT-2026-07-24 C1/C2 guards (group:/roster:), which shipped with
// "enforced in accept() AND in note()" in the commit message and no test for the second half.
//
// Method: write both events STRAIGHT INTO the store, bypassing the relay entirely, then boot a gateway on that
// directory and ask it a question only the surviving map can answer — does the genuine recipient's own per-day
// token still skip their day?
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { openStore } from './event-store.mjs';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8986;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NEED_D = 'trinityone/care:', SKIP_D = 'trinityone/careskip:';
const CARE_ID = 'careRehydrate1', SKIP_DAY = '2026-08-14', TOKEN = 'the-real-recipients-token';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const hash = (s) => createHash('sha256').update(String(s)).digest('hex');

const A = K(), B = K(), recipient = K();
let relay, dataDir;

const waitReady = async (ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); };
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const need = (who, cp, tokenHash, at) => finalizeEvent({ kind: 30078, created_at: at,
  tags: [['d', NEED_D + CARE_ID], ['t', 'trinityone'], ['church', cp], ['skiphash', SKIP_DAY, tokenHash]], content: JSON.stringify({ title: 'meals' }) }, who.sk);

before(async () => {
  await requireFreePort(PORT, 'relay-careid-rehydrate.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-careid-'));

  // Seed the store DIRECTLY. This is the whole point: neither event goes through accept(), so only note()'s guard
  // can decide which one owns the id when the relay replays them at boot.
  const store = openStore(join(dataDir, 'relay.sqlite'), { maxEvents: 5000 });
  const t0 = now() - 600;
  store.put(need(A, A.pub, hash(TOKEN), t0));            // A opened the need, with the recipient's real token
  store.put(need(B, B.pub, hash('bs-token'), t0 + 60));  // B's forgery, NEWER — so it wins any last-writer race
  store.close();

  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000', CHURCH_NPUB: `${npubEncode(A.pub)},${npubEncode(B.pub)}` },
    stdio: 'ignore',
  });
  await waitReady();
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('the genuine recipient’s own token still skips their day after a restart', async () => {
  // The skip rule is token-based and needs no membership — `tokOk` alone satisfies it — so this asks exactly one
  // question: whose skiphash is in the map? A's (the guard held) or B's (the forgery won on rehydrate)?
  const ws = await connect();
  try {
    const [ok, msg] = await publish(ws, finalizeEvent({ kind: 30078, created_at: now(),
      tags: [['d', SKIP_D + CARE_ID + ':' + SKIP_DAY], ['t', 'trinityone'], ['skiptok', TOKEN], ['church', A.pub]],
      content: '{}' }, recipient.sk));
    assert.equal(ok, true,
      'the recipient’s correct per-day token was refused (' + msg + ') after a restart. A co-tenant church’s ' +
      'forged care:<id> already on disk won at rehydrate, because note() replays stored events without ' +
      'accept() in the path. The per-day sha256(token) scheme exists so ONLY the recipient can say "I don’t ' +
      'need help that day"; with the map poisoned they cannot, and nobody brings food.');
  } finally { ws.close(); }
});

test('…and the forged token does NOT skip it', async () => {
  // Control: if this passed too, the test above would prove nothing — it would mean the skip rule accepts anything.
  const ws = await connect();
  try {
    const [ok] = await publish(ws, finalizeEvent({ kind: 30078, created_at: now(),
      tags: [['d', SKIP_D + CARE_ID + ':' + SKIP_DAY], ['t', 'trinityone'], ['skiptok', 'bs-token'], ['church', A.pub]],
      content: '{}' }, B.sk));
    assert.equal(ok, false,
      'the forging church’s own token skipped the day, so the map holds B’s hash — or the skip rule is not ' +
      'checking the token at all, which would make the first test vacuous.');
  } finally { ws.close(); }
});
