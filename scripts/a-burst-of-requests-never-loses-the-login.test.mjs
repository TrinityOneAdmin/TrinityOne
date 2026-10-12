// A BURST OF REQUESTS NEVER LOSES THE LOGIN — round 3e (audit of b102dc6, the "delegate stall").
//
// The relay caps a connection at 100 messages a second (a CPU guard: every EVENT is a schnorr verify). It used to drop
// every frame past the 100th WITHOUT A WORD. A console opening a church sends more than that in its first second —
// measured in console-keys-follow-the-church-switch: 102 REQ/CLOSE frames on one socket in the second before its AUTH —
// so the AUTH was the frame dropped. No OK came; nostr-tools then gave up on the login for the life of the socket
// ("auth timed out", cached), and every private read on it waited for a login that could not happen: the name key
// never came back after a church switch.
//
// The rule now: AUTH and CLOSE are not counted against the 100 (AUTH has its own small budget), and a REQ or EVENT
// over the limit is ANSWERED — CLOSED / OK false, "rate-limited:" — so a client knows to ask again. Driven against the
// real gateway over a real socket.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { finalizeEvent } from 'nostr-tools/pure';
import * as H from './relay-network-harness.mjs';

const church = H.key();
let relay;
before(async () => {
  relay = await H.startRelay({ name: 'burst-login', churches: [church.pub], env: { TRINITY_TAILSCALE_BIN: '/nonexistent' } });
  // something private stored, so a read of it makes the relay challenge (its NIP-42 challenge is lazy)
  await H.publishAll(relay, [finalizeEvent({ kind: 30078, created_at: H.now(), tags: [['d', 'trinityone/blocked:' + church.pub], ['t', 'trinityone']], content: JSON.stringify({ pubkeys: [] }) }, church.sk)]);
});
after(() => { H.stopAll(); });

function socket() {
  return new Promise((res, rej) => {
    const ws = new WebSocket(relay.wsUrl); const frames = [];
    ws.on('message', (d) => { try { frames.push(JSON.parse(String(d))); } catch {} });
    ws.on('open', () => res({ ws, frames })); ws.on('error', rej);
  });
}
const until = async (pred, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await H.sleep(50); } return pred(); };

test('a login sent after a burst of more than 100 requests in one second is still answered — and accepted', async () => {
  const { ws, frames } = await socket();
  // a private document read first, so the relay's lazy NIP-42 challenge fires
  ws.send(JSON.stringify(['REQ', 'priv', { kinds: [30078], '#d': ['trinityone/blocked:' + church.pub] }]));
  assert.ok(await until(() => frames.some(f => f[0] === 'AUTH')), 'CONTROL: the relay never challenged — this row would prove nothing');
  const challenge = frames.find(f => f[0] === 'AUTH')[1];
  for (let i = 0; i < 150; i++) ws.send(JSON.stringify(['REQ', 'b' + i, { kinds: [1], limit: 1 }]));   // the burst, all in one tick
  const auth = finalizeEvent({ kind: 22242, created_at: H.now(), tags: [['relay', relay.wsUrl], ['challenge', challenge]], content: '' }, church.sk);
  ws.send(JSON.stringify(['AUTH', auth]));
  const ok = await until(() => frames.some(f => f[0] === 'OK' && f[1] === auth.id), 5000);
  assert.ok(ok, 'THE LOGIN WAS DROPPED: a burst of requests in the same second took its place, so no OK ever came — the console would wait on a login that never happens');
  assert.equal(frames.find(f => f[0] === 'OK' && f[1] === auth.id)[2], true, 'the login was answered but refused');
  // …and the requests the limit turned away were TOLD so, not silently dropped
  await until(() => frames.filter(f => f[0] === 'CLOSED' || f[0] === 'EOSE').length >= 150, 5000);
  const answered = new Set(frames.filter(f => f[0] === 'CLOSED' || f[0] === 'EOSE').map(f => f[1]));
  const silent = Array.from({ length: 150 }, (_, i) => 'b' + i).filter(id => !answered.has(id));
  assert.deepEqual(silent, [], 'REQUESTS OVER THE LIMIT WERE DROPPED WITHOUT AN ANSWER — a client waits for an end-of-stored-events that never comes');
  const limited = frames.filter(f => f[0] === 'CLOSED' && /^rate-limited:/.test(f[2] || ''));
  assert.ok(limited.length > 0, 'CONTROL: no request was over the limit — the burst was not a burst');
  ws.close();
});
