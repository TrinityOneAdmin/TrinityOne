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

// ROUND 3f (audit of 4bb1ed1). Two holes in 5c35bfd's rate limit, both proven against this gateway:
//   R1 — the AUTH budget did not hold in a connection's FIRST second: its counter started undefined, undefined + 1 is NaN,
//        and NaN > 10 is false, so every AUTH was taken (measured: 500 valid AUTHs at connect, 244 accepted, each one a
//        signature check and a re-run of the open REQs). 5c35bfd said AUTH "has its own budget of 10 a second"; it did not.
//   R2 — the frame was PARSED before anything was counted, so unparseable frames and non-arrays returned before the
//        counter and a CLOSE was never counted: a flood of garbage or of CLOSEs no longer closed the socket (1008), which
//        b102dc6's limit did. 5c35bfd said "persistent abuse still closes the socket"; for those two floods it did not.
async function challenged() {
  const s = await socket();
  s.ws.send(JSON.stringify(['REQ', 'priv', { kinds: [30078], '#d': ['trinityone/blocked:' + church.pub] }]));
  assert.ok(await until(() => s.frames.some(f => f[0] === 'AUTH')), 'CONTROL: the relay never challenged');
  s.challenge = s.frames.find(f => f[0] === 'AUTH')[1];
  return s;
}
const closedWith = (ws) => new Promise((res) => { if (ws.readyState === 3) return res(-1); ws.on('close', (code) => res(code)); setTimeout(() => res(null), 8000); });

test('R1: a burst of AUTHs in a connection\'s FIRST second is held to the AUTH budget', async () => {
  const { ws, frames, challenge } = await challenged();
  const auths = [];
  for (let i = 0; i < 60; i++) auths.push(finalizeEvent({ kind: 22242, created_at: H.now(), tags: [['relay', relay.wsUrl], ['challenge', challenge], ['n', String(i)]], content: '' }, church.sk));
  for (const a of auths) ws.send(JSON.stringify(['AUTH', a]));
  await until(() => frames.filter(f => f[0] === 'OK').length >= 60, 5000);
  const accepted = frames.filter(f => f[0] === 'OK' && f[2] === true).length;
  assert.ok(accepted >= 1, 'CONTROL: no AUTH was accepted at all');
  assert.ok(accepted <= 10, `THE AUTH BUDGET DID NOT HOLD IN THE FIRST SECOND: ${accepted} of 60 AUTHs were verified and accepted (budget 10)`);
  ws.close();
});

for (const [what, frame] of [
  ['unparseable garbage', () => 'x'.repeat(50000)],
  ['non-array JSON', () => JSON.stringify({ not: 'an array' })],
  ['CLOSE', () => JSON.stringify(['CLOSE', 'nothing'])],
  ['REQ', (i) => JSON.stringify(['REQ', 'f' + i, { kinds: [1], limit: 1 }])],
]) {
  test(`R2: a persistent flood of ${what} frames closes the socket (1008), as the limit always did`, async () => {
    const { ws } = await socket();
    const closed = closedWith(ws);
    for (let i = 0; i < 2000 && ws.readyState === 1; i++) ws.send(frame(i));
    const code = await closed;
    assert.equal(code, 1008, `A FLOOD OF ${what.toUpperCase()} FRAMES DID NOT CLOSE THE SOCKET — persistent abuse is no longer cut off (got ${code})`);
  });
}

test('R2: a REQ flood does not starve the login — an AUTH sent amid it is still answered', async () => {
  const { ws, frames, challenge } = await challenged();
  for (let i = 0; i < 400; i++) ws.send(JSON.stringify(['REQ', 'q' + i, { kinds: [1], limit: 1 }]));
  const auth = finalizeEvent({ kind: 22242, created_at: H.now(), tags: [['relay', relay.wsUrl], ['challenge', challenge]], content: '' }, church.sk);
  ws.send(JSON.stringify(['AUTH', auth]));
  assert.ok(await until(() => frames.some(f => f[0] === 'OK' && f[1] === auth.id), 5000), 'A REQ FLOOD STARVED THE LOGIN — no answer to the AUTH');
  ws.close();
});

// …and frames the relay cannot use at all are abuse in themselves, even UNDER the per-second cap: a client that keeps
// sending garbage (or non-arrays) below 300 a second is still cut off once it has sent enough of it.
for (const [what, frame] of [['unparseable garbage', () => 'x'.repeat(2000)], ['non-array JSON', () => JSON.stringify({ not: 'an array' })]]) {
  test(`R2: ${what} sent slowly — under the per-second cap — still closes the socket once it adds up`, async () => {
    const { ws } = await socket();
    const closed = closedWith(ws);
    for (let round = 0; round < 3 && ws.readyState === 1; round++) {
      for (let i = 0; i < 250 && ws.readyState === 1; i++) ws.send(frame(i));
      await H.sleep(1100);
    }
    const code = await closed;
    assert.equal(code, 1008, `${what.toUpperCase()} BELOW THE PER-SECOND CAP WAS NEVER CUT OFF (got ${code})`);
  });
}
