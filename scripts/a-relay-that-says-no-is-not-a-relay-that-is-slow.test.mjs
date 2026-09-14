// WHEN A RELAY READS A CHECK-IN AND SAYS NO, THE APP MUST KNOW THAT IT WAS TOLD NO.
// Run: node --test scripts/a-relay-that-says-no-is-not-a-relay-that-is-slow.test.mjs
//
// Audit, 2026-09-14, and it refuted the fix committed hours earlier. `_publishAny` attaches `err.refused` so
// the three check-in writers can tell a settled refusal from a silent relay. It decided that flag from the
// FULFILLED results only:
//     err.refused = rs.some(r => r.status === 'fulfilled' && _PUB_REFUSED.test(...))
// nostr-tools settles a publish the other way round — OK:true resolves with the reason, OK:**false** rejects
// with it — so `refused` was FALSE for every refusal this product can actually produce, and the branch was
// dead. A relay answering `blocked: not a member or not permitted for this group` was reported to a children's
// worker as "we couldn't confirm that — it may well have saved". A child waved into a room over a record the
// relay had explicitly thrown away. The inversion of the thing the fix was written to prevent.
//
// ⚠ WHY THIS FILE RUNS A REAL SOCKET. The tests that shipped with that fix stubbed `_publishAny` and supplied
// `err.refused` themselves — so they passed with `err.refused = false` hard-coded into the bundle, and passed
// again with the whole refusal vocabulary emptied. A stub cannot test the line that reads the wire. This
// opens a WebSocket server, speaks NIP-01, and drives the SHIPPED `_publishAny` out of vendor/fellowship.js
// against every answer a relay can give. Same reason scripts/console-publish-honesty.test.mjs does.
//
// The four outcomes, and who is telling the truth:
//   OK:true                  → resolves           → no throw at all
//   OK:false "blocked: …"    → REJECTS            → refused  (settled: say so plainly)
//   no OK at all             → rejects, timed out → unconfirmed (NOT a verdict — it may well have landed)
//   socket closes mid-flight → rejects            → unconfirmed
//   nowhere to publish       → never opens        → not-sent (settled: nothing left the phone)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { WebSocket } from 'ws';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { requireFreePort } from './test-ports.mjs';
import { fnBody, stmt } from './test-slice.mjs';

const PORT = 8979;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs; checked free by requireFreePort
const URL_ = `ws://127.0.0.1:${PORT}/relay`;
const SHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

// HOW THE RELAY ANSWERS, set per test. 'accept' | 'refuse:<reason>' | 'silent' | 'close'
let MODE = 'accept';
let wss, pool;

before(async () => {
  // AWAITED, AND BEFORE THE SERVER BINDS. It returns a promise; called bare it settles after our own
  // WebSocketServer has taken the port and then reports the port held — by us. It cost twenty minutes.
  await requireFreePort(PORT, 'a-relay-that-says-no-is-not-a-relay-that-is-slow');
  wss = new WebSocketServer({ port: PORT });
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(String(raw)); } catch { return; }
      if (m[0] !== 'EVENT') return;
      const id = m[1] && m[1].id;
      if (MODE === 'accept') return ws.send(JSON.stringify(['OK', id, true, '']));
      if (MODE.startsWith('refuse:')) return ws.send(JSON.stringify(['OK', id, false, MODE.slice(7)]));
      if (MODE === 'close') return setTimeout(() => { try { ws.close(); } catch {} }, 30);
      /* 'silent' — read it, say nothing at all, which is the case the Pixel measured */
    });
  });
  await new Promise(r => wss.once('listening', r));
  pool = new SimplePool();
});
after(() => { try { pool.close([URL_]); } catch {} try { wss.close(); } catch {} });

// THE SHIPPED _publishAny, LIFTED AND RUN over a real pool and a real socket. Only its collaborators that
// are about relay ADMISSION are stubbed (this file is not about the gate); everything that decides an
// OUTCOME — _classify, _dedupeRelays, _wedgeKey, _PUB_REFUSED, _PUB_FAILED, _PUB_SILENT — is the shipped one.
// `raw` is what the church has CONFIGURED; `targets` is what survived the admission gate. They differ in
// exactly one situation and it is the one that matters most: the church has relays, and none of them could
// be proved to run our software (CLAUDE.md rule 10). _publishAny refuses to open a socket at all there.
function shippedPublishAny(targets, raw) {
  const lifted = ['function _dedupeRelays(list) {', 'function _classify(r) {', 'function _wedgeKey(']
    .map(a => fnBody(SHIP, a, a)).join('\n');
  // `var`, not `const` — esbuild rewrites top-level declarations on the way into the bundle, and anchoring
  // on the SOURCE spelling finds nothing. The failure is loud (fnBody/stmt both refuse a missing anchor),
  // which is the only reason this is a comment and not a defect.
  const consts = ['var _PUB_REFUSED =', 'var _PUB_FAILED =', 'var _PUB_SILENT =', 'var WEDGE_ACK_MS =']
    .map(a => stmt(SHIP, a, a)).join('\n');
  const body = fnBody(SHIP, 'function _publishAny(relays, evt) {', '_publishAny');
  const src = `${consts}\n${lifted}\n${body}\nreturn _publishAny;`;
  return new Function('pool', '_netRelays', 'churchRelaysRaw', '_noteSendResult', 'NO_NETWORK_RELAY',
    `return (function(){ ${src} })();`)(
      pool, () => targets, () => (raw === undefined ? targets : raw), () => {}, 'no-network-relay');
}

const anEvent = () => finalizeEvent(
  { kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', 'checkin:t' + Math.random()]], content: 'x' },
  generateSecretKey());

async function publish(targets = [URL_], raw) {
  try { await shippedPublishAny(targets, raw)(targets, anEvent()); return { threw: false }; }
  catch (e) { return { threw: true, refused: !!(e && e.refused), unsent: !!(e && e.unsent), message: String(e && e.message) }; }
}

test('a relay that ACCEPTS does not throw at all', async () => {
  MODE = 'accept';
  const r = await publish();
  assert.equal(r.threw, false, 'a publish the relay acknowledged was reported as a failure: ' + r.message);
});

// THE CASE THE WHOLE FILE EXISTS FOR. Every one of these is a refusal TrinityOne's own relay sends
// (scripts/gateway.mjs) or the production nostr-rs-relay image sends.
for (const reason of [
  'blocked: not a member or not permitted for this group',
  'error: relay storage unavailable — nothing was saved',
  'invalid: signature failed',
  'restricted: not authenticated',
  'rate-limited: slow down',
  'auth-required: we can\'t serve unauthenticated users',
]) {
  test(`a relay that READ it and said "${reason.split(':')[0]}" is reported as REFUSED`, async () => {
    MODE = 'refuse:' + reason;
    const r = await publish();
    assert.equal(r.threw, true, 're-anchor: a refused publish did not throw');
    assert.equal(r.refused, true,
      'A SETTLED REFUSAL WAS NOT RECORDED AS ONE, so every caller softens it into "we couldn\'t confirm that ' +
      '— it may well have saved". At a children\'s door that waves a child into a room over a record the relay ' +
      'threw away. Relay said: ' + reason + ' / app saw: ' + r.message);
    assert.equal(r.unsent, false, 'a refusal is not "nothing was sent" — it was sent, read, and rejected');
  });
}

test('a relay that reads it and NEVER ANSWERS is NOT a refusal — it may well have landed', async () => {
  // The Pixel defect, F1, 2026-09-11. Softening is right here and only here.
  MODE = 'silent';
  const r = await publish();
  assert.equal(r.threw, true, 're-anchor: a silent relay was treated as an acknowledgement');
  assert.equal(r.refused, false,
    'SILENCE WAS REPORTED AS A REFUSAL. Nobody refused anything — the event is signed, on the wire and often ' +
    'lands a moment later, and telling a worker it was turned away sends her to undo something that worked.');
  assert.equal(r.unsent, false, 'it did leave the phone — the socket was open and the event was written to it');
});

test('a socket that CLOSES mid-publish is unconfirmed too — a dropped connection is not a verdict', async () => {
  MODE = 'close';
  const r = await publish();
  assert.equal(r.threw, true, 're-anchor');
  assert.equal(r.refused, false, 'a dropped socket was reported as the relay refusing. Nobody read it and said no.');
});

test('ONE relay refusing among silent ones still counts as refused', async () => {
  // The pilot's own default is two addresses to one box, so the mixed case is ordinary, not exotic.
  MODE = 'refuse:blocked: not a member or not permitted for this group';
  const r = await publish([URL_, 'ws://127.0.0.1:1/relay']);
  assert.equal(r.refused, true,
    'a refusal was lost because another address in the list said nothing. The question is "did ANY relay ' +
    'refuse", never "what did the first one say".');
});

test('NOWHERE TO PUBLISH is "not-sent" — settled, and never softened', async () => {
  // The admission gate (CLAUDE.md rule 10) emptied the list, or there is no relay at all. No socket is
  // opened, so there is no event in flight to be hopeful about. Reported as a flat failure, correctly.
  const r = await publish([]);
  assert.equal(r.threw, true, 're-anchor: publishing to nowhere reported success');
  assert.equal(r.unsent, true,
    'NOTHING LEFT THE DEVICE AND THE APP DOES NOT KNOW IT. Every caller then tells a worker the check-in ' +
    '"may well have reached your church" when no socket was ever opened. Message: ' + r.message);
  assert.equal(r.refused, false, 'nobody refused it — there was nobody to refuse it');
});

test('THE ADMISSION GATE emptying the list is "not-sent" too — no socket is opened at all', async () => {
  // CLAUDE.md rule 10, the security boundary: the church HAS relays configured, and not one of them could be
  // proved to run our software, so _publishAny refuses before touching the network. This is the path a
  // compelled or replaced box produces, and it is the one where a soft "it may well have saved" would be
  // worst — the gate did its job, nothing was published, and the worker must be told plainly.
  const r = await publish([], ['wss://a-relay-we-could-not-prove.example/relay']);
  assert.equal(r.threw, true, 're-anchor: a publish the gate blocked reported success');
  assert.match(r.message, /no-network-relay/,
    're-anchor: this took the empty-list path, not the gate path, so it proves nothing about the gate');
  assert.equal(r.unsent, true,
    'THE ADMISSION GATE BLOCKED THE PUBLISH AND THE APP DOES NOT KNOW IT WAS BLOCKED. No socket was opened, ' +
    'yet every caller reports "we couldn\'t confirm that — it may well have reached your church".');
  assert.equal(r.refused, false, 'no relay refused it — no relay was dialled');
});

test('A RELAY THAT CANNOT BE REACHED AT ALL is "not-sent" — no socket opened, nothing was written', async () => {
  // THE COMMONEST FAILURE IN THE ROOM THIS FEATURE IS FOR, and the first version of this fix got it wrong:
  // a children's worker in a hall with no signal. pool.publish resolves an unopenable socket as the string
  // `connection failure: …`, which is deliberately not in the refusal vocabulary — so neither flag was set
  // and she was told "we couldn't confirm that reached your church — it may well have." It did not. These
  // writers have no retry queue, so the register will never show the child.
  const dead = 'ws://127.0.0.1:1/relay';           // nothing listens on port 1
  const r = await publish([dead]);
  assert.equal(r.threw, true, 're-anchor: publishing to an unreachable relay reported success');
  assert.equal(r.unsent, true,
    'AN UNREACHABLE RELAY IS REPORTED AS "it may well have saved". No socket was ever opened. Message: ' + r.message);
  assert.equal(r.refused, false, 'nobody refused it — nothing was reachable to refuse it');
});

test('…but ONE unreachable address alongside a SILENT one is still only "unconfirmed"', async () => {
  // The other half, and the reason this is `every` and not `some`: the silent relay may well have taken it.
  MODE = 'silent';
  const r = await publish(['ws://127.0.0.1:1/relay', URL_]);
  assert.equal(r.unsent, false,
    'a relay that read the event and said nothing was written off as "nothing was sent" because a DIFFERENT ' +
    'address could not be dialled. The event may well be on the relay, and the worker is being sent to undo it.');
});

test('…and an unreachable address alongside a REFUSAL is a refusal', async () => {
  MODE = 'refuse:blocked: not a member or not permitted for this group';
  const r = await publish(['ws://127.0.0.1:1/relay', URL_]);
  assert.equal(r.refused, true, 'a settled refusal was lost because another address could not be dialled');
  assert.equal(r.unsent, false, 'it reached a relay, which read it and said no — that is not "nothing was sent"');
});
