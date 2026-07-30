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

test('every reconnect signal in app.jsx is wired to the RIGHT path', () => {
  // The scheduler tests above all drive the function directly, so none of them can see a WIRING mistake — and
  // the critical regression was exactly that: `trinity-reconnect` was attached to the advisory handler. Putting
  // it back there breaks no behavioural test, which is why this one exists and why it is anchored on app.jsx.
  const at = SRC.indexOf('const [connTick, bumpConn]');
  assert.notEqual(at, -1, 're-anchor: connTick moved');
  const effect = SRC.slice(at, SRC.indexOf('// multi-church:', at));

  // MANDATORY: reconnectAll() has already closed every hub, emptied the shared-sub registry and called
  // pool.close() on every socket before dispatching this. It must not be debounced, jittered or collapsed.
  assert.match(effect, /addEventListener\('trinity-reconnect',\s*onReconnectNeeded\)/,
    'trinity-reconnect is no longer on its own handler. If it shares the advisory path, a member who unlocks ' +
    'within the debounce window is left on an app whose sockets are all closed and never reopened.');
  const handler = effect.slice(effect.indexOf('const onReconnectNeeded'), effect.indexOf('const onReconnectNeeded') + 200);
  // force() already runs the bump callback, which refetches. A second refetch here doubles the church-doc
  // fetch on the most expensive path in the app — observed on device as two refetches for one unlock.
  assert.doesNotMatch(handler, /refetch\(\)/,
    'the trinity-reconnect handler refetches on top of force(), which already does. That is double work at the ' +
    'moment every subscription is being rebuilt.');
  assert.match(handler, /sched\.force\(\)/,
    'the trinity-reconnect handler no longer calls force(). Any debounced path can swallow it, and a swallowed ' +
    'rebuild after reconnectAll() is a silently dead app.');
  assert.doesNotMatch(handler, /sched\.fire\(/, 'the mandatory rebuild is going through the advisory path');

  // ADVISORY: these may be collapsed and spread.
  assert.match(effect, /addEventListener\('online',\s*onOnline\)/, 're-anchor: the online listener moved');
  assert.match(effect, /const onOnline = \(\) => \{ sched\.fire\(false\)/, 'online no longer takes the jittered path');
  assert.match(effect, /appStateChange[\s\S]{0,120}sched\.fire\(true\)/, 'native resume no longer refreshes immediately');
  assert.match(effect, /const onVis = [^\n]*sched\.fire\(true\)/, 'foregrounding no longer refreshes immediately');

  // Whitespace-tolerant: the old guard matched one exact spelling, so `bumpConn(n=>n+1)` would have slipped past.
  const direct = effect.split('\n').filter(l => /bumpConn\s*\(\s*\w+\s*=>/.test(l) && !/const sched =/.test(l));
  assert.deepEqual(direct, [],
    'these lines bump connTick directly instead of going through the scheduler:\n  ' + direct.join('\n  '));
  assert.match(effect, /sched\.cancel\(\)/, 'the effect no longer cancels its pending reconnect on teardown');
});

// ── A MANDATORY REBUILD MUST NEVER BE SWALLOWED ───────────────────────────────────────────────────────────
//
// Found by an adversarial audit of the commit above, and it was a live regression on main.
//
// `trinity-reconnect` is NOT an advisory "might be worth refreshing" signal like `online` or foregrounding.
// src/fellowship.src.js reconnectAll() fires it as the LAST step of a teardown it has already performed: every
// church-doc hub closed, the shared-subscription registry emptied, and pool.close() called on every relay
// socket. The event is the only thing that rebuilds them.
//
// The scheduler put all five signals behind one debounce, so this ordering left a member on a dead app:
//
//     app resumes  -> appStateChange  -> fire(true), immediate, last = t0
//     member unlocks with a PIN or fingerprint within 2.5s
//     deriveFromIdentity -> reconnectAll() -> everything torn down -> trinity-reconnect
//     fire(false) -> inside the debounce -> returns false, NOTHING pending, nothing ever runs
//
// The member sees the room exactly as they left it and it never updates again — no new messages, no care
// requests, no steward changes, and no error anywhere. Recovery depends on the 90s heartbeat, which only fires
// when relaysHealthy() is false, and that returns true if ANY one socket is alive.
//
// The lesson is not "the debounce was too aggressive". It is that a signal which REPAIRS state must not share a
// gate with signals that merely REFRESH it.
test('a PIN unlock rebuilds the subscriptions even moments after a foreground', () => {
  const make = loadScheduler();
  const env = fakeEnv([0.5]);
  let bumps = 0;
  const s = make(() => bumps++, { ...env, jitterMs: 3000, debounceMs: 2500 });
  s.fire(true);                    // foregrounded — immediate
  assert.equal(bumps, 1);
  env.advance(400);                // …and 0.4s later the member unlocks
  s.force();                       // reconnectAll() has ALREADY closed every socket
  assert.equal(bumps, 2,
    'the mandatory rebuild after a PIN unlock was swallowed by the debounce. reconnectAll() has already torn ' +
    'down every hub, the shared-subscription registry and every relay socket before firing this — so nothing ' +
    'reopens them. The member unlocks into an app that never updates again, with no error.');
  env.advance(60000);
  assert.equal(bumps, 2, 'the forced rebuild also left a timer pending, so it ran twice');
});

test('a forced rebuild cancels a pending jittered one rather than racing it', () => {
  const make = loadScheduler();
  const env = fakeEnv([0.9]);
  let bumps = 0;
  const s = make(() => bumps++, { ...env, jitterMs: 3000, debounceMs: 2500 });
  s.fire(false);                   // network blip: scheduled, not yet run
  s.force();                       // unlock arrives first
  assert.equal(bumps, 1, 'the forced rebuild did not run immediately');
  env.advance(10000);
  assert.equal(bumps, 1, 'the pending jittered reconnect still fired afterwards — two full re-subscribes');
});

test('foregrounding is immediate even while a jittered reconnect is pending', () => {
  // The comment in app.jsx claims foregrounding is never delayed. It was: the debounce check ran before the
  // immediate branch, so an `online` scheduled moments earlier deferred the member's own refresh by up to the
  // whole jitter window. The existing test only ever called fire(true) on a FRESH scheduler, so it asserted
  // the trivial case and stayed green.
  const make = loadScheduler();
  const env = fakeEnv([0.9]);
  let bumps = 0;
  const s = make(() => bumps++, { ...env, jitterMs: 3000, debounceMs: 2500 });
  s.fire(false);                   // jittered, ~2.7s away
  assert.equal(bumps, 0);
  s.fire(true);                    // member opens the app
  assert.equal(bumps, 1, 'the member who just opened the app waited for someone else\'s jitter window');
  env.advance(10000);
  assert.equal(bumps, 1, 'the superseded jittered reconnect fired as well');
});

test('the debounce measures from when a reconnect RAN, not when it was scheduled', () => {
  // `last` recorded the SCHEDULING time, so the guaranteed gap between two reconnects was debounceMs minus the
  // jitter actually drawn — zero at the top of the window. Two full teardown-and-re-subscribe cycles could land
  // in the same millisecond, which is the storm this scheduler exists to prevent.
  //
  // Asserted as the property rather than a fixed sequence: whatever the draws, no two reconnects may land
  // closer together than the debounce. A long jitter followed by a short one is what exposed it, and a fixed
  // rand() hides it entirely.
  const make = loadScheduler();
  const env = fakeEnv([1.0, 0.0, 1.0, 0.0]);
  const at = [];
  const s = make(() => at.push(env.now()), { ...env, jitterMs: 3000, debounceMs: 2500 });
  for (let i = 0; i < 10; i++) { s.fire(false); env.advance(1000); }
  assert.ok(at.length >= 2, 'expected repeated attempts over 10s to produce at least two reconnects, got ' + at.length);
  for (let i = 1; i < at.length; i++) {
    assert.ok(at[i] - at[i - 1] >= 2500,
      'two reconnects ran ' + (at[i] - at[i - 1]) + 'ms apart, inside the 2500ms debounce. `last` is being set ' +
      'when the timer is SCHEDULED rather than when it fires, so the real gap is debounceMs minus the jitter.');
  }
});
