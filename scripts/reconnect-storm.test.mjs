// A congregation must not reconnect in one instant. Run: node --test scripts/reconnect-storm.test.mjs
//
// AUDIT-2026-07-30 P3. The relay is single-threaded, so simultaneous REQs are served in turn. Measured against
// a real relay (12k messages, twelve groups, twelve subscriptions each):
//
//     idle                              median  25ms   max     29ms
//     5 members reconnect  (60 REQs)    median  26ms   max  1,926ms
//     20 members reconnect (240 REQs)   median  26ms   max  7,096ms
//
// A CORRECTION to the audit, which reported 10,157ms as the five-member figure and presented it as
// "publish→OK latency" alongside idle medians. Re-run here, the MEDIAN is flat: the relay is not stalled for
// everyone. It is the WORST CASE that blows out, because a write arriving mid-burst waits behind the whole
// queue. Same mechanism, different shape — and worth stating, because "the relay stalls for ten seconds" and
// "one unlucky message waits seven" call for different fixes.
//
// WHAT THIS FILE DOES AND DOES NOT FIX — measured, after the change, against the same relay:
//
//     20 reconnect AT ONCE     (240 REQs)   median   30ms   max  7,017ms
//     20 reconnect SPREAD 3s   (240 REQs)   median  417ms   max  5,496ms
//
// Spreading the arrivals buys about 22% off the worst case and makes the median WORSE. That is not a
// disappointing result, it is arithmetic: 240 REQs at ~30ms each is ~7 seconds of work whenever it arrives, so
// smearing the arrivals smears the queue rather than shortening it. P3 IS NOT CLOSED BY THIS FILE, and a later
// reader must not assume otherwise because the tests are green.
//
// What the scheduler genuinely fixes is the MULTIPLIER, which is a different and real bug: `visibilitychange`
// was gated to once per 2.5s but `online` and `trinity-reconnect` were not. A flapping radio fired one full
// teardown and re-subscribe of ~15 subscriptions PER BLIP, and a phone that woke and regained signal in the
// same second did the whole thing twice. Twenty blips now cost one reconnect instead of twenty.
//
// The real fix for P3 is to reduce the WORK PER RECONNECT, not its timing: each of those 12 subscriptions asks
// for `limit:400` of backlog every single time, so a reconnect re-downloads history the client already has.
// `since` cursors would make a reconnect nearly free, and deduplicating the subscription set would cut the
// count. That is the next piece of work, and it is bigger than this one.
//
// These execute the real makeReconnectScheduler from app/app.jsx, with time and randomness injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');

function loadScheduler() {
  const at = SRC.indexOf('function makeReconnectScheduler(');
  assert.notEqual(at, -1, 'makeReconnectScheduler is gone — re-anchor this test');
  let depth = 0, end = -1;
  for (let i = SRC.indexOf('{', at); i < SRC.length; i++) {
    if (SRC[i] === '{') depth++; else if (SRC[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  return new Function(SRC.slice(at, end) + '; return makeReconnectScheduler;')();
}

// A tiny deterministic clock + timer queue, so nothing here depends on wall time.
function fakeEnv(randSeq) {
  let t = 1000, nextId = 1, i = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimeout: (fn, ms) => { const id = nextId++; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimeout: (id) => timers.delete(id),
    rand: () => (Array.isArray(randSeq) ? randSeq[i++ % randSeq.length] : 0.5),
    advance(ms) {
      const target = t + ms;
      for (;;) {
        let due = null, dueId = null;
        for (const [id, x] of timers) if (x.at <= target && (!due || x.at < due.at)) { due = x; dueId = id; }
        if (!due) break;
        t = due.at; timers.delete(dueId); due.fn();
      }
      t = target;
    },
    pending: () => timers.size,
  };
}

test('a foreground reconnect is immediate — the member is watching the screen', () => {
  const make = loadScheduler();
  const env = fakeEnv();
  let bumps = 0;
  const s = make(() => bumps++, { ...env, rand: env.rand, jitterMs: 3000 });
  assert.equal(s.fire(true), true);
  assert.equal(bumps, 1,
    'foregrounding was delayed. Someone who just opened the app is waiting on the screen — spreading THEIR ' +
    'reconnect trades a real annoyance for a hypothetical one, and people open their phones at different ' +
    'moments anyway. Only router-driven events need spreading.');
});

test('a network reconnect is delayed by a random amount, not fired on the spot', () => {
  const make = loadScheduler();
  const env = fakeEnv([0.5]);
  let bumps = 0;
  const s = make(() => bumps++, { ...env, jitterMs: 3000 });
  s.fire(false);
  assert.equal(bumps, 0, 'the `online` event still reconnects immediately — this is the whole storm');
  env.advance(1400);
  assert.equal(bumps, 0, 'it fired earlier than its own jitter window');
  env.advance(200);
  assert.equal(bumps, 1, 'it never fired at all — a delayed reconnect that never happens is worse than a storm');
});

test('A CONGREGATION SPREADS OUT instead of arriving together', () => {
  // Fifty phones, one router, one instant. This asserts the spreading happens — NOT that it solves P3; measured
  // against a real relay it is worth about 22% of the worst case (see the header). It is kept because it costs
  // nothing and it is the half of the fix that composes with the real one: once a reconnect is cheap, spreading
  // what little work remains is what keeps the worst case flat.
  const make = loadScheduler();
  const FIFTY = 50, JITTER = 3000;
  const fired = [];
  const envs = [];
  for (let i = 0; i < FIFTY; i++) {
    const env = fakeEnv([(i * 37 % 100) / 100]);          // each phone gets its own random draw
    const s = make(() => fired.push(env.now()), { ...env, jitterMs: JITTER });
    s.fire(false);
    envs.push(env);
  }
  envs.forEach(e => e.advance(JITTER + 50));
  assert.equal(fired.length, FIFTY, 'not every phone reconnected — some members would be left stale');
  const buckets = new Map();
  for (const t of fired) { const b = Math.floor((t - 1000) / 250); buckets.set(b, (buckets.get(b) || 0) + 1); }
  const worst = Math.max(...buckets.values());
  assert.ok(worst <= FIFTY / 4,
    'the worst 250ms window still holds ' + worst + ' of ' + FIFTY + ' reconnects. They are not being spread, ' +
    'so the relay still receives one burst of ~' + (worst * 12) + ' REQs and any member publishing in that ' +
    'moment waits behind all of them.');
  assert.ok(buckets.size >= 6, 'the reconnects landed in only ' + buckets.size + ' windows — barely spread at all');
});

test('repeated signals collapse — a flapping radio cannot queue a reconnect per blip', () => {
  // `online` can fire many times in a few seconds on a marginal connection. Each one used to cost a full
  // teardown and re-subscribe of ~15 subscriptions.
  const make = loadScheduler();
  const env = fakeEnv([0.5]);
  let bumps = 0;
  const s = make(() => bumps++, { ...env, jitterMs: 3000, debounceMs: 2500 });
  for (let i = 0; i < 20; i++) s.fire(false);
  env.advance(4000);
  assert.equal(bumps, 1, 'twenty `online` events produced ' + bumps + ' reconnects. A flapping radio would ' +
    'tear down and re-open every subscription each time.');
});

test('…and the debounce is shared across foreground and network signals', () => {
  // A phone that wakes and regains signal in the same second fires BOTH. That must be one reconnect.
  const make = loadScheduler();
  const env = fakeEnv([0.5]);
  let bumps = 0;
  const s = make(() => bumps++, { ...env, jitterMs: 3000, debounceMs: 2500 });
  s.fire(true);                 // foreground: immediate
  s.fire(false);                // online, a moment later
  env.advance(4000);
  assert.equal(bumps, 1, 'foregrounding and reconnecting in the same moment caused two full re-subscribes');
});

test('after the debounce window a genuine later reconnect still works', () => {
  // Over-tightening control: the guard must not swallow reconnects for ever. A member whose signal returns
  // ten minutes later must re-subscribe, or they silently stop receiving anything.
  const make = loadScheduler();
  const env = fakeEnv([0.5]);
  let bumps = 0;
  const s = make(() => bumps++, { ...env, jitterMs: 3000, debounceMs: 2500 });
  s.fire(false); env.advance(4000);
  assert.equal(bumps, 1);
  s.fire(false); env.advance(4000);
  assert.equal(bumps, 2, 'a later reconnect was swallowed — the member would never catch up on what they missed');
});

test('cancel() clears a pending reconnect, so an unmounted app cannot fire into nothing', () => {
  const make = loadScheduler();
  const env = fakeEnv([0.9]);
  let bumps = 0;
  const s = make(() => bumps++, { ...env, jitterMs: 3000 });
  s.fire(false); s.cancel(); env.advance(5000);
  assert.equal(bumps, 0, 'a scheduled reconnect survived teardown');
  assert.equal(env.pending(), 0, 'the timer was left running');
});

test('every reconnect signal in app.jsx goes through the scheduler', () => {
  // The fix is worthless if one listener still bumps directly — that one listener becomes the storm.
  const at = SRC.indexOf('const [connTick, bumpConn]');
  assert.notEqual(at, -1, 're-anchor: connTick moved');
  const effect = SRC.slice(at, SRC.indexOf('// multi-church:', at));
  const direct = effect.split('\n').filter(l => /bumpConn\(x => x \+ 1\)/.test(l) && !/const sched =/.test(l));
  assert.deepEqual(direct, [],
    'these lines still bump connTick directly instead of going through the scheduler:\n  ' + direct.join('\n  '));
  assert.match(effect, /window\.addEventListener\('online', onOnline\)/, 're-anchor: the online listener moved');
  assert.match(effect, /sched\.fire\(false\)/, 'nothing uses the jittered path');
  assert.match(effect, /sched\.cancel\(\)/, 'the effect no longer cancels its pending reconnect on teardown');
});
