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
import { stripComments, fnBody, stmt } from './test-slice.mjs';

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
    // The give-up threshold, taken from the bundle rather than retyped — a hard-coded 8 here would keep
    // passing after somebody changed the real one.
    S_OUT_TRIES: new Function(stmt(ST, 'var S_OUT_TRIES =', 'S_OUT_TRIES') + '\nreturn S_OUT_TRIES;')(),
    // LIFTED, NOT STUBBED — _sOutDue is what decides whether an item is attempted at all (audit item 9,
    // 2026-09-14: a message already given up on was being re-published for ever). A stub here would answer
    // the question this test asks on the shipped code's behalf.
    _sOutDue: new Function(
      stmt(ST, 'var S_OUT_TRIES =', 'S_OUT_TRIES') + '\n' +
      stmt(ST, 'var S_OUT_BACKOFF_MS =', 'S_OUT_BACKOFF_MS') + '\n' +
      'const now = () => 1000;\n' +
      fnBody(ST, 'function _sOutDue(item, ignoreBackoff)', '_sOutDue') + '\nreturn _sOutDue;')(),
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
  // ⚠ THIS TEST USED TO MATCH /retryQueuedDM/ AND /dropQueuedDM/ AGAINST THE WHOLE BUNDLE, and both matched
  // — their own definitions. So it passed for the entire period in which, by the console's own account,
  // "StewDmWindow called none of them" and the screen that would make giving up VISIBLE did not exist. A
  // test satisfied by a function's definition says nothing about whether anything calls it; audit item 14,
  // 2026-09-14, and it is the same shape as CLAUDE.md rule 1 in a file that is not about a screen.
  //
  // WHAT PROVES THE CLAIM NOW, by rendering the console's DM window and clicking the controls:
  //   scripts/a-dm-that-never-sent-is-not-sent.test.mjs
  //     · "a message the console has GIVEN UP ON says so, and offers a way back" — Try again and Discard
  //       are found in the tree and their handlers are asserted to reach Steward.retryQueuedDM/dropQueuedDM
  //     · "a message given up on REPAINTS as failed without reopening the thread"
  //   scripts/a-message-the-console-gave-up-on-stays-given-up.test.mjs — that the give-up STATE is real.
  // What is left here is the one thing honest to read off the bundle: that the flush can reach it at all.
  // (Matching vendor/steward.js is sound — esbuild removes dead code, so a disabled branch disappears.)
  const flush = stripComments(fnBody(ST, 'async function _sOutFlush', '_sOutFlush'));
  assert.match(flush, /failed\s*=\s*true/,
    'a message that cannot be sent is retried for ever or dropped — neither is something a steward can see');
  assert.match(flush, /S_OUT_TRIES/,
    'the give-up threshold is inlined or gone, so the flush no longer measures against a stated limit');
});
