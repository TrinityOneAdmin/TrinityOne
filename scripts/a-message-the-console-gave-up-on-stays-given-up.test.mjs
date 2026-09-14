// THE CONSOLE'S OUTBOX MUST ACTUALLY GIVE UP, AND MUST NOT GIVE UP TOO SOON.
// Run: node --test scripts/a-message-the-console-gave-up-on-stays-given-up.test.mjs
//
// Audit item 9, 2026-09-14, and MEASURED ON A REAL CONSOLE before it was written: a steward console in a real
// browser, on an origin with no provable relay, was seeded with one message already marked `failed` after its
// eight tries. Over the next two minutes `tries` went 9, then 10. The message had been given up on and was
// still going back on the wire — every 45 seconds, for the life of the install, up to 200 of them. The
// comment directly above the code promised the opposite, and `item.lastTry` was written and never read.
//
// ⚠ AND THE SECOND HALF IS WHY THIS FILE HAS MORE THAN ONE TEST. Skipping failed items ALONE would have been
// a worse bug than the one it fixed: the flush runs every 45 seconds, so eight tries were spent in six
// minutes flat. Any six-minute outage — a router reboot, a phone in a lift, a church hall with one bar —
// would then permanently give up on every message queued at the time, and a steward would find their reply
// dead with no signal that anything was ever wrong. The backoff is load-bearing, not a refinement.
//
// ⚠ THE REAL OUTBOX IS LIFTED OUT OF vendor/steward.js AND RUN — the whole cluster, so `_sOutbox` is the
// module's own array and not a copy. Only `publish`, the clock and the store are stubbed; every decision
// about WHETHER to publish is the shipped one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stmt } from './test-slice.mjs';

const SHIP = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

function outbox({ accept = false } = {}) {
  const store = new Map();
  let clock = 1_000_000;                       // SECONDS — `now()` in this bundle is epoch seconds
  const attempts = [];
  const src = [
    stmt(SHIP, 'var S_OUTBOX_MAX =', 'S_OUTBOX_MAX'),
    stmt(SHIP, 'var _sOutKey =', '_sOutKey'),
    stmt(SHIP, 'var _sOutbox =', '_sOutbox'),
    stmt(SHIP, 'var _sOutPlain =', '_sOutPlain'),
    stmt(SHIP, 'var _sFlushing =', '_sFlushing'),
    fnBody(SHIP, 'function _sOutLoad()', '_sOutLoad'),
    fnBody(SHIP, 'function _sOutSave()', '_sOutSave'),
    stmt(SHIP, 'var S_OUT_TRIES =', 'S_OUT_TRIES'),
    stmt(SHIP, 'var S_OUT_BACKOFF_MS =', 'S_OUT_BACKOFF_MS'),
    fnBody(SHIP, 'function _sOutDue(item, ignoreBackoff)', '_sOutDue'),
    fnBody(SHIP, 'async function _sOutFlush(ignoreBackoff)', '_sOutFlush'),
  ].join('\n');
  const api = new Function('lsGet', 'lsSet', 'publish', 'now', 'sk', 'pub', 'window',
    src + '\nreturn { flush: _sOutFlush, load: _sOutLoad, save: _sOutSave, due: _sOutDue, get box(){return _sOutbox}, set box(v){_sOutbox=v} };')(
      (k) => (store.has(k) ? store.get(k) : null),
      (k, v) => store.set(k, v),
      async (evt) => { attempts.push(evt.id); return accept; },
      () => clock,
      'sk', 'consolepub',
      { addEventListener: () => {}, dispatchEvent: () => {} });
  return { api, attempts, tick: (s) => { clock += s; }, store };
}

const seed = (o, item) => { o.api.box = [item]; o.api.save(); };
const one = (o) => o.api.box[0];

test('a message the console has GIVEN UP ON never goes back on the wire', async () => {
  // The state measured on the real console: eight tries spent, `failed` set, and the last attempt long ago
  // so no backoff can be the thing holding it back.
  const o = outbox();
  seed(o, { evt: { id: 'm1' }, peer: 'p', at: 1, tries: 8, failed: true, lastTry: 1 });
  for (let i = 0; i < 5; i++) { o.tick(3600); await o.api.flush(); }
  assert.deepEqual(o.attempts, [],
    'A MESSAGE THE CONSOLE HAD GIVEN UP ON WAS PUBLISHED AGAIN — ' + o.attempts.length + ' times. This is the ' +
    'defect measured on a live console: `tries` climbed 9, 10, … for ever, while the comment above the code ' +
    'said a message is "eventually given up on rather than retried for ever".');
  assert.equal(one(o).tries, 8, 'the try count moved on a message nobody should have retried');
});

test('…and the relay coming back does NOT revive it either — only the steward can', async () => {
  // `steward-relay-returned` passes ignoreBackoff. That must skip the WAIT, never the give-up: a failed
  // message is the steward's to revive from the screen (Try again / Discard), which is what makes the
  // give-up state visible rather than a silent discard.
  const o = outbox();
  seed(o, { evt: { id: 'm1' }, peer: 'p', at: 1, tries: 8, failed: true, lastTry: 1 });
  await o.api.flush(true);
  assert.deepEqual(o.attempts, [], 'a relay-returned flush republished a message that had been given up on');
});

test('a WAITING message is still sent, and cleared when the relay takes it', async () => {
  // Re-anchor. A guard that refused everything would pass both tests above and deliver nothing at all.
  const o = outbox({ accept: true });
  seed(o, { evt: { id: 'm1' }, peer: 'p', at: 1, tries: 0 });
  await o.api.flush();
  assert.deepEqual(o.attempts, ['m1'], 'a plain queued message was never attempted');
  assert.equal(o.api.box.length, 0, 'a message the relay accepted is still sitting in the outbox');
});

test('EIGHT TRIES MUST NOT BE SPENT IN SIX MINUTES — the backoff is what stops a short outage killing a reply', async () => {
  // The flush fires every 45s. Without a wait between attempts, a six-minute outage burns every try and the
  // message is dead. Walk the clock in 45-second steps, as the real interval does, and count how long the
  // eighth try takes to arrive.
  const o = outbox();
  seed(o, { evt: { id: 'm1' }, peer: 'p', at: 1, tries: 0 });
  let elapsed = 0;
  for (let i = 0; i < 400 && !one(o).failed; i++) { await o.api.flush(); o.tick(45); elapsed += 45; }
  assert.equal(one(o).failed, true, 're-anchor: the message never reached the give-up state at all');
  assert.ok(elapsed > 30 * 60,
    'THE CONSOLE GAVE UP AFTER ' + Math.round(elapsed / 60) + ' MINUTES. A router reboot is longer than that. ' +
    'Every message queued during a brief outage is permanently dead, and the steward is not told why.');
  assert.equal(o.attempts.length, 8, 'the give-up threshold is no longer eight attempts: ' + o.attempts.length);
});

test('the relay coming back skips the WAIT for a message still trying', async () => {
  // The other half of ignoreBackoff, and the reason it exists: a message must not sit out a half-hour wait
  // that was measured against an outage which has just ended.
  const o = outbox();
  seed(o, { evt: { id: 'm1' }, peer: 'p', at: 1, tries: 3, lastTry: 1_000_000 });
  await o.api.flush();
  assert.deepEqual(o.attempts, [], 're-anchor: a message inside its backoff was attempted anyway');
  await o.api.flush(true);
  assert.deepEqual(o.attempts, ['m1'],
    'the relay came back and a waiting message still sat out its backoff — the steward waits minutes for a ' +
    'send that could have gone at once');
});
