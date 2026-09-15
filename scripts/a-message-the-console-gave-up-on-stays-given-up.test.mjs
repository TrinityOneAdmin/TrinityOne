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
  const reload = { on: false, fn: () => {} };
  const thrower = { on: false };
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
      async (evt) => {
        attempts.push(evt.id);
        // WHAT THE DM WINDOW DOES, FROM INSIDE THE FLUSH. `outboxForPeer()` opens with `_sOutLoad()`, and the
        // window's `steward-outbox` listener calls it from inside `_sOutSave()` — synchronously, mid-loop.
        // Off by default so the other tests measure the flush alone.
        if (reload && reload.on) reload.fn();
        if (thrower && thrower.on) throw new Error('publish blew up');
        return accept;
      },
      () => clock,
      'sk', 'consolepub',
      { addEventListener: () => {}, dispatchEvent: () => {} });
  reload.fn = () => api.load();
  return { api, attempts, reload, thrower, tick: (s) => { clock += s; }, store };
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
  // ⚠ A FLOOR ALONE IS NOT ENOUGH, and the audit of this fix proved it: with only "> 30 minutes" asserted,
  // dropping the cap, moving the base from 45s to 10 minutes, and cutting it to 31s ALL PASSED — a 3.5×
  // change to how long a church keeps trying went unnoticed. Pin the shape, not just one side of it.
  assert.ok(elapsed > 90 * 60 && elapsed < 130 * 60,
    'the give-up window is now ' + Math.round(elapsed / 60) + ' minutes; it is meant to be about 105 ' +
    '(1.5 + 3 + 6 + 12 + 24 + 30 + 30). Too short abandons a reply over a short outage; too long leaves a ' +
    'steward watching "Waiting to send" all morning with no Try again button.');
});

test('the gaps between tries are the intended schedule, not just "some backoff"', async () => {
  // 90s, 3m, 6m, 12m, 24m, then half-hourly. Asserting the shape is what stops a silent change to how long
  // a church keeps trying — the cap, the base and the doubling are each a separate way to get this wrong.
  const o = outbox();
  seed(o, { evt: { id: 'm1' }, peer: 'p', at: 1, tries: 0 });
  const at = [];
  let t = 0;
  for (let i = 0; i < 400 && !one(o).failed; i++) {
    const before = o.attempts.length;
    await o.api.flush();
    if (o.attempts.length > before) at.push(t);
    o.tick(45); t += 45;
  }
  const gaps = at.slice(1).map((v, i) => Math.round((v - at[i]) / 60));
  assert.deepEqual(gaps, [2, 3, 6, 12, 24, 30, 30],
    'the retry schedule changed. Measured gaps in minutes: ' + JSON.stringify(gaps) + '. Expected roughly ' +
    '1.5, 3, 6, 12, 24, 30, 30 — rounded to the 45-second tick the real interval runs on.');
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


test('A DM WINDOW BEING OPEN MUST NOT DEFEAT THE BACKOFF', async () => {
  // Found by the audit of this fix, 2026-09-14, and it is the two halves of one commit fighting each other.
  // `_sOutSave()` dispatches `steward-outbox`; the DM window's listener — the FIRST listener that event has
  // ever had — calls `outboxForPeer()`, which opens with `_sOutLoad()` and REPLACES `_sOutbox` with freshly
  // parsed objects. The flush is iterating a snapshot of the old ones, so every `tries`/`lastTry` it writes
  // lands on an orphan and the next save serialises the reloaded array without them.
  // `tries` and `lastTry` were write-only until the backoff read them, so this was harmless for a year.
  // Measured cost once it was not: 20 queued messages over a dead relay went on the wire 1086 times instead
  // of 160 — the tail item 111 times instead of 8 — and only ever while a steward has a thread open, which
  // is the one state the waiting bubble exists for. On the thin pipe this product is built for.
  const o = outbox();
  o.reload.on = true;                       // a DM window is open
  seed(o, { evt: { id: 'm1' }, peer: 'p', at: 1, tries: 0 });
  await o.api.flush();
  assert.equal(one(o).tries, 1,
    'THE TRY COUNT DID NOT SURVIVE THE FLUSH. With a DM window open the backoff never engages and the ' +
    'message is retried every 45 seconds — and it can never reach the give-up state either, because the ' +
    'count it is measured against is being thrown away. tries = ' + one(o).tries);
  // …and it still gives up in the same time it would with no window open.
  let elapsed = 0;
  for (let i = 0; i < 400 && !one(o).failed; i++) { await o.api.flush(); o.tick(45); elapsed += 45; }
  assert.equal(one(o).failed, true, 'with a window open the message never reaches the give-up state at all');
  assert.ok(elapsed > 30 * 60, 'the backoff collapsed to ' + Math.round(elapsed / 60) + ' minutes');
  assert.equal(o.attempts.length, 8,
    'the message went on the wire ' + o.attempts.length + ' times instead of 8, because a DM window was open');
});

test('a publish that THROWS is a failed try, not the end of the queue', async () => {
  // There was no try/catch in the loop: a rejection propagated out, `finally` cleared the flag and the
  // caller's .catch swallowed it — so every message BEHIND it was never attempted, and its own `tries` never
  // moved, so it could never be given up on either. publish() opens with _waitForRegistration() and calls
  // relays(); either can reject. Found by the audit of this fix.
  const o = outbox();
  o.api.box = [{ evt: { id: 'm1' }, peer: 'p', at: 1, tries: 0 }, { evt: { id: 'm2' }, peer: 'p', at: 2, tries: 0 }];
  o.api.save();
  o.thrower.on = true;
  await o.api.flush();
  assert.equal(o.api.box[0].tries, 1,
    'a publish that threw was not counted as a try, so this message can never be given up on');
  assert.ok(o.attempts.includes('m2'),
    'THE SECOND MESSAGE WAS NEVER ATTEMPTED. One message that makes publish throw silently strands every ' +
    'message queued behind it, for the life of the install.');
});

test('a clock that moved BACKWARDS does not silence a waiting message', async () => {
  // `lastTry` is written from this machine's clock. A console that booted with a fast RTC and was corrected
  // by NTP has a lastTry in the future, the subtraction goes negative, and the item is skipped — never
  // attempted, never counted, never given up on, while the bubble says "Waiting to send". Measured by the
  // audit: a day fast meant a day of silence.
  const o = outbox();
  seed(o, { evt: { id: 'm1' }, peer: 'p', at: 1, tries: 2, lastTry: 1_000_000 + 86400 });
  await o.api.flush();
  assert.deepEqual(o.attempts, ['m1'],
    'A MESSAGE WAS HELD FOR THE LENGTH OF A CLOCK SKEW. The steward watches "Waiting to send" and nothing ' +
    'ever happens — no attempt, no give-up, no Try again button.');
});
