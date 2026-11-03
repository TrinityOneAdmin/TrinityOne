// THE RELAY ENFORCES ITS OWN CEILING ON A RECEIPT ATTACHMENT — a thin pipe is not a blob store.
//   Run: node --test scripts/finance-attachment-cap.test.mjs
//
// Phase 2 adds finance/attachment:<id> (an inline ENCRYPTED receipt image) as a REPLACEABLE finance/ doc. The
// client shrinks the image to ~200KB, but a client cap is bypassable — a modified or old console can push a
// bigger body. So accept() caps the body at FIN_ATTACHMENT_MAX (~300KB) where the data LANDS, under the same
// church-OR-finance-steward gate as every other finance/ doc and well below the generic 1 MB WS frame limit
// that is the only other backstop. This drives the REAL gateway and proves the cap AND that authority is
// unchanged (the attachment is admitted for the church and a finance steward, refused for a stranger).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

// Grab an OS-assigned free port (bind :0, read it, release) so this test never collides with a concurrent
// suite or the sibling build agent's relay — no fixed port to clash on.
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

const STEWARDS_D = 'trinityone/stewards:', ATT_D = 'finance/attachment:', NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K(), treasurer = K(), stranger = K();
const cp = church.pub;
let PORT, WS_URL, relay, dataDir;

async function waitReady(ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 150)); }
  throw new Error('relay never came up on :' + PORT);
}
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res({ ok: m[2], why: m[3] || '' }); } };
  ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt]));
});
let rosterAt = now();
const roster = (pubkeys, caps) => finalizeEvent({ kind: 30078, created_at: ++rosterAt, tags: [['d', STEWARDS_D + cp], ['t', NET]], content: JSON.stringify({ pubkeys, caps }) }, church.sk);
const attachment = (who, id, content) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', ATT_D + id], ['t', NET], ['church', cp]], content }, who.sk);

before(async () => {
  PORT = await freePort();
  await requireFreePort(PORT, 'finance-attachment-cap.test.mjs');
  WS_URL = `ws://127.0.0.1:${PORT}/relay`;
  dataDir = mkdtempSync(join(tmpdir(), 'trin-attcap-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' }, stdio: 'ignore',
  });
  await waitReady();
});
after(() => { try { relay.kill(); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('the relay is carrying this church at all', async () => {
  assert.ok((await fetch(`http://127.0.0.1:${PORT}/status`)).ok, 'the relay never came up, so nothing below proves anything');
});

test('a small receipt is accepted from the church key AND from a finance steward', async () => {
  const ws = await connect();
  assert.equal((await publish(ws, roster([treasurer.pub], { [treasurer.pub]: ['finance'] }))).ok, true, 'the church could not publish its own roster');
  await new Promise(r => setTimeout(r, 150));
  const small = 'x'.repeat(4000);
  assert.equal((await publish(ws, attachment(church, 'a1', small))).ok, true, 'the church key could not attach a small receipt');
  assert.equal((await publish(ws, attachment(treasurer, 'a2', small))).ok, true, 'a finance steward could not attach a small receipt');
  ws.close();
});

test('a receipt over the cap is REFUSED, and the reason names the cap — not a generic "not permitted"', async () => {
  const ws = await connect();
  const big = 'x'.repeat(300 * 1024 + 2048);   // over FIN_ATTACHMENT_MAX (~300KB), under the 1 MB WS frame limit
  const r = await publish(ws, attachment(treasurer, 'a3', big));
  assert.equal(r.ok, false, 'an oversized receipt was stored — the relay has no size ceiling and a thin pipe becomes a blob store');
  assert.match(r.why, /large|receipt/i, 'the refusal did not say the image was too large: ' + JSON.stringify(r.why));
  ws.close();
});

test('a stranger cannot attach a receipt at all (authority unchanged by the cap)', async () => {
  const ws = await connect();
  const r = await publish(ws, attachment(stranger, 'a4', 'x'.repeat(1000)));
  assert.equal(r.ok, false, 'a non-steward wrote a finance/attachment doc — the cap widened who may write finance data');
  ws.close();
});
