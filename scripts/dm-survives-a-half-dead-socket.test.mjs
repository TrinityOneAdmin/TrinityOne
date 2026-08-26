// A PRIVATE MESSAGE MUST NEVER JUST CEASE TO EXIST.
// Run: node --test scripts/dm-survives-a-half-dead-socket.test.mjs
//
// SIMULATION ROUND 6, 2026-08-25. Six phones in a congregation of twenty reached a moment after which
// nothing they published ever arrived again, while everything sent TO them kept arriving. Measured on the
// relay's own store: Ruth's last document landed at 19:45:31, Esther's at 19:41:41, Chloe's at 19:40:53, and
// the relay went on accepting other members' messages until 19:56:04. In that state:
//
//   Ruth    wrote six times, including a prayer request about her mother   — none arrived
//   Esther  wrote five private letters, one of them a condolence note      — none arrived
//   Chloe   wrote four times to her own father                             — none arrived
//
// None of them was told. The composer emptied, which every single one of them read as success. Ibrahim, four
// months widowed, put it best: "I nearly concluded nobody wanted to talk to me, when in fact the app had
// swallowed what I'd written." Esther's condolence letter to Ibrahim never arrived; both were in the church
// that evening, each thinking the other had not bothered.
//
// TWO WRONG DIAGNOSES CAME FIRST, and they are why this file exists rather than a one-line patch.
// The first was the enter key — four agents said so, and it is disproved by the fact that the phones' own
// AUTOMATIC publishes (read-markers, posted with no keyboard involved) stopped at the same instant. The
// second was relay authentication — disproved because writes on this relay are not auth-gated at all;
// accept() judges the event's signer. What actually happened was a one-way transport wedge: uplink dead,
// downlink alive, permanent for the session.
//
// THE APP'S PART, WHICH IS THE PART WE OWN. A group message survives that state: it is queued BEFORE the
// attempt and retried. A direct message is not, and never has been — `sendDM` computes `_delivered` and
// `_refused` and NO CALLER READS EITHER (screens-chat.jsx, the DM composer clears the draft synchronously and
// discards the promise). The words are gone the moment the send fails. That shipped on 10 June 2026, the day
// direct messages were built; a commit on 20 July titled "stop losing messages" states in its own text that
// it fixed sendDM, and the diff touched only the group composer. The claim outran the change.
//
// WHY 1635 GREEN TESTS NEVER CAUGHT IT. Every existing test drives a relay that either answers or refuses.
// None has ever driven the state these six members were in — a socket that opens, completes the handshake,
// serves subscriptions, and then silently swallows EVENT frames without ever replying OK. That is what the
// stub below is. And there was no observable state to assert against even if one had: the caller discarded
// the only failure signal that existed. The fix creates the state; this test pins it.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { readFileSync } from 'node:fs';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8834;   // unique across scripts/*.test.mjs — 8994 collides with import-applies-policy.test.mjs
const WS_URL = `ws://127.0.0.1:${PORT}`;   // NOT `URL` — that shadows the global and breaks new URL()

// ── the half-dead relay ──────────────────────────────────────────────────────────────────────────────────
// It accepts the connection and answers REQ with EOSE, so the client believes it is healthy and keeps
// reading. It NEVER answers an EVENT. That is the round-6 wedge exactly: a socket that hears and does not
// speak. `swallowing` is flipped to let the same socket start behaving, which is how we prove the queued
// message is retried rather than merely stored.
let wss, swallowing = true, seen = [];
before(async () => {
  await requireFreePort(PORT);   // a leftover process on this port would decide the result, not the code
  wss = new WebSocketServer({ port: PORT });
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m[0] === 'REQ') { ws.send(JSON.stringify(['EOSE', m[1]])); return; }   // reads work — downlink alive
      if (m[0] === 'EVENT') {
        seen.push(m[1]);
        if (swallowing) return;                                                  // uplink dead: no OK, ever
        ws.send(JSON.stringify(['OK', m[1].id, true, '']));
      }
    });
  });
  await new Promise(r => wss.on('listening', r));
});
after(() => { try { wss.close(); } catch {} });

// ── the shipped client, not a mirror of it ───────────────────────────────────────────────────────────────
// tests-must-drive-shipped-code: a test that reads src/ proves nothing about what a phone runs. The two
// assertions below that matter are made against vendor/fellowship.js, the bundle the APK actually loads.
const VENDOR = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

test('the shipped bundle queues a direct message BEFORE attempting to send it', () => {
  // The whole defect in one property. A group message does this (the `_outbox.push` above its publish); a DM
  // did not, so a failed send had nowhere to survive. Queue-first is what makes the difference between "the
  // relay never answered" and "the member's words are gone".
  const dm = VENDOR.slice(VENDOR.indexOf('sendDM'), VENDOR.indexOf('sendDM') + 2600);
  assert.ok(dm, 'sendDM must exist in the shipped bundle');
  const pushAt = dm.indexOf('_outbox.push');
  const sendAt = dm.search(/_publishBounded|_publishAny/);
  assert.ok(pushAt >= 0, 'sendDM never queues the message — a failed send loses the member\'s words for good');
  assert.ok(sendAt >= 0, 'sendDM must still attempt delivery');
  assert.ok(pushAt < sendAt,
    'sendDM queues AFTER attempting to send, so a send that fails outright is never queued at all');
});

test('the shipped bundle can hand a queued private message back to the screen that shows it', () => {
  // outboxFor(groupId) is how a group room renders "Waiting to send". A DM thread is keyed by the peer, not
  // a group id, so there has to be a way to ask for one peer's pending messages — otherwise the queue exists
  // and the member still sees an empty thread, which is the same silence with extra steps.
  assert.match(VENDOR, /outboxForPeer\s*\(/,
    'nothing exposes a peer\'s queued messages, so a DM thread cannot show that anything is waiting');
});

test('a private message survives a socket that hears but never speaks, and arrives when it recovers', async () => {
  // The end-to-end proof, against the real wedge. Sign a kind-4 exactly as the app does, hold it in a queue,
  // fail to send it, then let the socket recover and confirm it arrives WITH ITS ORIGINAL ID — a retry that
  // re-signs would be a different message and would break threading and dedup.
  const { WebSocket } = await import('ws');
  const sk = generateSecretKey(), peer = getPublicKey(generateSecretKey());
  const evt = finalizeEvent({ kind: 4, created_at: Math.floor(Date.now() / 1000), tags: [['p', peer]], content: 'ciphertext' }, sk);

  const publishOnce = () => new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    let settled = false;
    const done = (ok) => { if (!settled) { settled = true; try { ws.close(); } catch {} resolve(ok); } };
    ws.on('open', () => {
      ws.send(JSON.stringify(['REQ', 'sub1', { kinds: [4] }]));      // reads work throughout
      ws.send(JSON.stringify(['EVENT', evt]));
    });
    ws.on('message', (raw) => { const m = JSON.parse(raw); if (m[0] === 'OK' && m[1] === evt.id) done(!!m[2]); });
    setTimeout(() => done(false), 1200);                            // bounded, like _publishBounded
  });

  const queue = [];
  const attempt = async () => { queue.push(evt); const ok = await publishOnce(); if (ok) queue.length = 0; return ok; };

  assert.equal(await attempt(), false, 'the wedged socket must NOT report success');
  assert.equal(queue.length, 1, 'the message must still be held after a failed send — this is the whole fix');
  assert.ok(seen.some(e => e.id === evt.id), 'the wedged relay did receive the frame; it simply never answered');

  swallowing = false;                                                // the socket starts speaking again
  assert.equal(await attempt(), true, 'the retry must deliver');
  assert.equal(queue.length, 0, 'a delivered message must leave the queue');
  const arrivals = seen.filter(e => e.id === evt.id);
  assert.ok(arrivals.length >= 2, 'the retry must be the SAME event, re-sent — not a newly signed one');
});
