// A STEWARD'S PRIVATE REPLY MUST SURVIVE A BAD MOMENT, TOO.
// Run: node --test scripts/steward-dm-survives-too.test.mjs
//
// The member app was fixed yesterday: a direct message is queued before it is attempted, so a failed send
// leaves the words waiting instead of destroying them. The console was not, and it was worse than unfixed —
// it had NO OUTBOX AT ALL. Not "sendDM does not use it": the mechanism did not exist. So a vicar answering a
// parishioner through a stalled connection lost what she had written, silently, exactly as six members did in
// simulation round 6.
//
// It also gates the "Contact your church" route being built alongside: a way IN to a console that drops its
// replies is worse than no way in at all, because the member is then certain they were ignored rather than
// merely unlucky.
//
// WHAT THIS FILE GUARDS, and each of these is a mistake already made once this week:
//   · queue BEFORE attempting, or a send that fails outright is never queued
//   · carry the peer, or the queue exists and the conversation can never find it
//   · retry the SAME event id, because a re-signed retry is a different message and breaks threading
//   · give up VISIBLY rather than silently — a discard nobody sees is the defect we started from
//   · keep it to kind-4 only. The church's documents are republished from live state by the code that owns
//     them; queueing a stale roster or key would be far more dangerous than losing it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments, fnBody } from './test-slice.mjs';

const ST = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

const lift = (name, stubs, anchor) => {
  const src = fnBody(ST, anchor || ('function ' + name), name);
  const proxy = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(k in globalThis),
    get: (t, k) => { if (k in t) return t[k]; if (k === Symbol.unscopables) return undefined;
      throw new ReferenceError('needs a stub for ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  // eslint-disable-next-line no-new-func
  return new Function('scope', `with (scope) { ${src}; return ${name}; }`)(proxy);
};

test('the console queues a private message BEFORE attempting to send it', () => {
  const body = stripComments(fnBody(ST, 'async sendDM(', 'sendDM'));
  const pushAt = body.indexOf('_sOutbox.push');
  const sendAt = body.indexOf('publish(evt)');
  assert.ok(pushAt >= 0, 'the console never queues a private message — a failed send destroys the words');
  assert.ok(sendAt >= 0, 'the console must still attempt delivery');
  assert.ok(pushAt < sendAt, 'it queues AFTER attempting, so a send that fails outright is never queued');
});

test('a queued message records which conversation it belongs to', () => {
  const body = stripComments(fnBody(ST, 'async sendDM(', 'sendDM'));
  assert.match(body, /peer:\s*peerHex/,
    'the queued message does not record its peer, so no conversation can ever find it again');
});

test('the retry re-sends the SAME event, and stops trying eventually — visibly', async () => {
  // Drives the real flush. A re-signed retry would be a different message: it would break threading, defeat
  // the relay's dedup, and could arrive twice.
  let attempts = 0; const ids = [];
  const store = {};
  const flush = lift('_sOutFlush', {
    _sFlushing: false, sk: new Uint8Array(32),
    _sOutbox: [{ evt: { id: 'dm-1' }, peer: 'p'.repeat(64), at: 1, tries: 0 }],
    _sOutPlain: new Map(),
    _sOutLoad: () => {}, _sOutSave: () => {},
    publish: async (e) => { attempts++; ids.push(e.id); return false; },   // every relay refuses
    now: () => 1000,
    lsGet: (k) => store[k], lsSet: (k, v) => { store[k] = v; },
    _sOutKey: () => 'k', S_OUTBOX_MAX: 200,
  }, 'async function _sOutFlush');
  await flush();
  assert.equal(attempts, 1, 'the flush did not attempt the queued message');
  assert.deepEqual(ids, ['dm-1'], 'the retry sent a different event — a re-signed message breaks threading');
});

test('the outbox carries private messages ONLY, never the church\'s documents', () => {
  // A general write queue here would be actively dangerous: a roster or a key republished from a stale queued
  // copy could undo a removal or orphan a room. Documents are rebuilt from live state by the code that owns
  // them; only a human's typed words need holding.
  const send = stripComments(fnBody(ST, 'async sendDM(', 'sendDM'));
  assert.match(send, /kind:\s*4/, 'sendDM no longer signs a kind-4 — check what this queue now carries');
  const pushes = (stripComments(ST).match(/_sOutbox\.push/g) || []).length;
  assert.equal(pushes, 1,
    'something other than sendDM is pushing into the console outbox — it must not become a general write queue');
});

test('giving up is visible, and reversible by the steward', () => {
  const flush = stripComments(fnBody(ST, 'async function _sOutFlush', '_sOutFlush'));
  assert.match(flush, /failed\s*=\s*true/,
    'a message that cannot be sent is retried for ever or dropped — neither is something a steward can see');
  assert.match(stripComments(ST), /retryQueuedDM/, 'a steward cannot retry a message the app gave up on');
  assert.match(stripComments(ST), /dropQueuedDM/, 'a steward cannot discard a message the app gave up on');
});
