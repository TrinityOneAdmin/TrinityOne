// Joining a church must not be fire-and-forget — it is the only thing that makes a member visible.
// Run: node --test scripts/join-announce-retry.test.mjs
//
// UX audit 2026-08-04, tranche 1 item 5. There is no join-request event: "pending" is derived from an
// ABSENCE, and the steward's list is `members.filter(m => !admitted.has(m.pubkey))`. So the single
// announceMembership publish is the only thing that puts someone in front of a steward — and it was
// `try { await _publishAny(...) } catch { console.warn(...) }`. No outbox, no retry, no signal.
//
// Three failures stacked: the heartbeat marked itself done on ATTEMPT (so a failure set the 12-hour clock
// anyway), "Check again" re-ran the READ subscription rather than re-announcing, and the screen said "has
// been sent" in the past tense with the result discarded — ending "there's nothing to do in the meantime",
// which is the instruction that guarantees they stay invisible.
//
// A group chat message got 50 persisted retries and a visible "Waiting to send". This got a console.warn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const FELLOW = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');
const CHAT = readFileSync(new URL('../app/screens-chat.jsx', import.meta.url), 'utf8');

test('the join announce is queued for retry, like a chat message', () => {
  const fn = fnBody(FELLOW, 'async announceMembership', 'announceMembership');
  assert.match(fn, /_outbox\.push\(/,
    'announceMembership publishes once and forgets. If it fails the church never learns anyone asked, and ' +
    'nothing will try again.');
  assert.match(fn, /_outboxSave\(\)/, 'the queued announce is not persisted, so it dies with the app');
  // Queue BEFORE attempting, or a failure in the attempt skips the queue entirely (the E1 rule).
  const q = fn.indexOf('_outbox.push('), a = fn.indexOf('_publishAny(');
  assert.ok(q !== -1 && a !== -1 && q < a, 'queue first, then attempt — otherwise a throw loses the announce');
  assert.match(fn, /return ok \? evt : null/, 'the caller cannot tell whether the announce actually landed');
});

test('the 12-hour heartbeat is stamped on success, not on attempt', () => {
  assert.ok(!/const beat = \(\) => \{ F\.announceMembership\(np\); if \(lsCanWrite/.test(APP),
    'the heartbeat stamps itself before knowing the announce landed, so a failed announce silences retries ' +
    'for twelve hours and the member stays invisible');
  assert.match(APP, /announceMembership\(np\)\)\.then\(ok =>/, 'the stamp no longer waits for the result');
});

test('"Check again" re-sends the thing that makes them visible', () => {
  const fn = fnBody(APP, 'retryConnection: () =>', 'retryConnection');
  assert.match(fn, /announceMembership/,
    'retryConnection only re-subscribes. A member whose announce never landed can tap it for ever and stay ' +
    'invisible — and it is the only action offered on the screen where they are stuck.');
});

test('the screen does not claim "sent" while it is still queued', () => {
  assert.match(APP, /joinQueued:/, 'ctx no longer exposes whether the announce is still waiting');
  assert.match(FELLOW, /joinQueued\(npubOrHex\)/, 'the engine cannot report a queued announce');
  assert.match(CHAT, /still waiting to send/,
    'the pending screen states "has been sent" unconditionally — the one claim it cannot make');
  assert.ok(!/there’s nothing to do in the meantime/.test(CHAT),
    'the screen still tells a member there is nothing to do, which is exactly what keeps them invisible');
});
