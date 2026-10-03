// A SOCKET THAT COMES BACK INSIDE THE RECONNECT DEBOUNCE MUST STILL CAUSE A RE-SUBSCRIBE.
// Run: node --test scripts/a-socket-that-returns-inside-the-debounce-is-not-lost.test.mjs
//
// Sim 2026-10-02, item 18 ("phones stop getting church updates after a relay restart"), second of two gaps.
//
//   1. the member foregrounds the app: the scheduler RUNS (bump + refetch) and records `last`;
//   2. every REQ that run sends goes out onto a socket the relay already killed. A half-open socket cannot know
//      until its first write is answered with a reset; a relay that has not finished restarting refuses the dial;
//   3. the pool dials again and a NEW socket opens ~100ms later -> `trinity-relay-returned`;
//   4. that signal went through `fire(false)`, which drops anything inside the 2.5s debounce "because the run
//      just made already covers it". It does not: that run's REQs predate the socket. Nothing re-subscribes, the
//      new socket carries no subscriptions, and services/rotas never arrive.
//
// Reproduced in a headless browser against two real gateways (one restarted): service and rota never arrived;
// with the signal honoured they arrived in the same second.
//
// WHAT CHANGED: the scheduler gains `returned()`. Outside the window it is exactly fire(false). Inside the window
// it DEFERS one run to the window's end instead of discarding it, so the debounce still bounds the rate (one run
// per window at most) and still never tears down twice in one instant. app.jsx's `trinity-relay-returned` handler
// calls it.
//
// CLAUDE.md rule 3: nothing here matches text in app/*.jsx to prove behaviour. makeReconnectScheduler is LIFTED
// from the source and RUN with an injected clock; the handler arrow is lifted and RUN against a recording
// scheduler. (Both ship unbundled, so a `false &&` in front of a guard would leave its text in place — which is
// why the handler is executed, not read.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const SRC = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');
const make = new Function(fnBody(SRC, 'function makeReconnectScheduler(bump, opts)', 'makeReconnectScheduler') + '; return makeReconnectScheduler;')();

function fakeEnv() {
  let t = 1000, nextId = 1;
  const timers = new Map();
  return {
    now: () => t,
    setTimeout: (fn, ms) => { const id = nextId++; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimeout: (id) => timers.delete(id),
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
const scheduler = (opts = {}) => { const env = fakeEnv(); let bumps = 0; const s = make(() => bumps++, { ...env, rand: () => 0.5, ...opts }); return { s, env, bumps: () => bumps }; };

test('CONTROL (the premise): an ordinary advisory signal inside the window IS dropped', () => {
  const x = scheduler();
  x.s.fire(true);                      // foreground: runs now
  x.env.advance(100);
  assert.equal(x.s.fire(false), false, 'fire(false) inside the window used to be dropped; if that changed, this file\'s premise needs re-reading');
  x.env.advance(10000);
  assert.equal(x.bumps(), 1, 'a dropped signal must leave nothing pending');
});

test('THE BUG: a returned socket 100ms after a run is NOT lost — one more run when the window closes', () => {
  const x = scheduler();
  x.s.fire(true);
  assert.equal(x.bumps(), 1);
  x.env.advance(100);
  assert.equal(x.s.returned(), true, 'the returned socket was thrown away by the debounce');
  assert.equal(x.bumps(), 1, 'it must not run INSIDE the window — that is the double teardown the debounce exists to prevent');
  x.env.advance(2399);
  assert.equal(x.bumps(), 1, 'ran before the window closed');
  x.env.advance(2);
  assert.equal(x.bumps(), 2, 'the re-subscribe for the returned socket never happened — services and rotas stay silent');
  x.env.advance(60000);
  assert.equal(x.bumps(), 2, 'and only once');
});

test('outside the window it is the ordinary jittered, collapsed path (one run for a congregation)', () => {
  const x = scheduler();
  assert.equal(x.s.returned(), true);
  assert.equal(x.bumps(), 0, 'a return outside the window must be jittered, not immediate');
  assert.equal(x.s.returned(), false, 'a second return while one is pending must collapse');
  x.env.advance(3000);
  assert.equal(x.bumps(), 1);
});

test('several returns inside one window cost ONE deferred run, and a flapping link is still rate-bounded', () => {
  const x = scheduler();
  x.s.fire(true);
  for (let i = 0; i < 8; i++) { x.env.advance(200); x.s.returned(); }
  x.env.advance(5000);
  assert.equal(x.bumps(), 2, 'eight returns in one window should collapse to a single deferred run');
  // a link that flaps for a minute: never more than one run per debounce window
  const y = scheduler();
  y.s.fire(true);
  for (let i = 0; i < 60; i++) { y.env.advance(1000); y.s.returned(); }
  y.env.advance(10000);
  assert.ok(y.bumps() <= Math.ceil(70000 / 2500) + 1, `a flapping link ran ${y.bumps()} times in 70s — the debounce no longer bounds the rate`);
  assert.ok(y.bumps() >= 2, 're-anchor: the flapping link caused no re-subscribe at all');
});

test('a return while a jittered run is already pending queues nothing more', () => {
  const x = scheduler();
  x.s.fire(false);               // jittered, pending
  assert.equal(x.env.pending(), 1);
  x.s.returned();
  assert.equal(x.env.pending(), 1);
  x.env.advance(5000);
  assert.equal(x.bumps(), 1);
});

test('cancel() clears a deferred run, so an unmounted app cannot fire into nothing', () => {
  const x = scheduler();
  x.s.fire(true); x.env.advance(100); x.s.returned();
  x.s.cancel();
  x.env.advance(10000);
  assert.equal(x.bumps(), 1);
});

test('a forced rebuild (trinity-reconnect) is unaffected and still never swallowed', () => {
  const x = scheduler();
  x.s.fire(true); x.env.advance(100); x.s.returned();
  x.s.force();
  assert.equal(x.bumps(), 2, 'force() must still run at once');
});

// ── THE POINT OF USE: the handler app.jsx registers for `trinity-relay-returned`, lifted and RUN ───────────────────
test('the app\'s trinity-relay-returned handler goes through returned(), not the dropping path', () => {
  const at = SRC.indexOf('const onRelayReturned =');
  assert.notEqual(at, -1, 'the handler is gone from app/app.jsx — re-anchor this test');
  const line = SRC.slice(at, SRC.indexOf('\n', at));
  const arrow = line.replace(/^const onRelayReturned =\s*/, '').replace(/;\s*$/, '');
  const calls = [];
  const fake = { fire: (...a) => { calls.push(['fire', ...a]); return true; }, returned: (...a) => { calls.push(['returned', ...a]); return true; } };
  new Function('sched', 'return (' + arrow + ');')(fake)();
  assert.deepEqual(calls.map((c) => c[0]), ['returned'],
    'a returned socket is handed to ' + JSON.stringify(calls) + ' — it must be returned(), or the debounce eats it');
});
