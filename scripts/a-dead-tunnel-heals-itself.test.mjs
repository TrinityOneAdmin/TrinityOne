// A SELF-HOSTED BOX HEALS ITS OWN DEAD TUNNEL -- SPEC §3 (self-healing relays, 2026-11-03).
// Run: node --test scripts/a-dead-tunnel-heals-itself.test.mjs
//
// The bug this guards (measured on true-reed-88, 2026-11-03): a Cloudflare quick tunnel dies AT THE EDGE
// (its trycloudflare name goes NXDOMAIN / Cloudflare answers 530/1033) while the local cloudflared child
// stays alive, so the box advertises a dead address for ever and nothing re-claims. The watchdog in
// scripts/relay-selfheal.mjs detects that from OUTSIDE and heals: kill the dead child FIRST, respawn a
// fresh tunnel (the only thing that mints a new url), reclaim OUR name.
//
// POINT OF USE (CLAUDE.md rule 1), in two halves that BOTH fail if the watchdog is deleted:
//   1. The DECISION: we drive the exact tick() the running gateway arms, with every side effect stubbed,
//      and assert the three cornerstone behaviours -- heal only after N consecutive failures with a
//      reachable control url; NEVER restart when the control url is also down (uplink down); a single
//      transient failure does NOT restart. Plus heal order (kill-before-respawn), backoff+cap, the
//      CF_STARTING lock, boot grace, wake re-heal, and rule 10 (reclaim takes no argument -> own name only).
//   2. The WIRING: we spawn the real scripts/gateway.mjs and assert it actually ARMS the watchdog (the
//      armed line is printed by start(), so a commented-out arm cannot pass -- it is proven by execution,
//      not by text, defeating the app/*.jsx `false &&` trap even though gateway.mjs ships unbundled).
//
// Also covers SPEC §2 (confirmed failing after a real reboot, 2026-11-03): the top-level boot hook
// re-opens the tunnel ONCE 2.5s after boot with NO retry, so a reboot where wifi/DNS is not ready that
// early comes up private with the flag still set. The supervisor folds §2 in: stay-public ON + no
// tunnel up => OPEN one (uplink-gated, backed off), not only restart a dead one. See §2a/§2b/§2c below.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTunnelWatchdog, DEFAULT_WATCHDOG_CONFIG } from './relay-selfheal.mjs';
import { requireFreePort } from './test-ports.mjs';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

// ── A rig that records every side effect and lets the test own the clock. ──────────────────────────
function makeRig(opts = {}) {
  const calls = [];                 // ordered log of side effects: 'teardown' | 'start' | 'reclaim(<nargs>)'
  const state = { child: {}, url: 'https://dead-aaa.trycloudflare.com', startInFlight: false };
  const rig = {
    calls, state,
    clock: 1,                       // ms; the test advances this
    probeResult: { ok: false, status: 530 },   // own url dead at the edge by default
    controlOk: true,                // uplink up by default
    startOk: true,
    wantPublic: false,              // §2: has the operator asked to stay public?
    newUrlSeq: 0,
  };
  const deps = {
    getState: () => ({ ...state }),
    wantPublic: () => rig.wantPublic,
    probe: async () => rig.probeResult,
    controlProbe: async () => rig.controlOk,
    teardown: () => { calls.push('teardown'); state.child = null; state.url = ''; },
    start: async () => {
      calls.push('start');
      if (rig.startOk) { const u = `https://live-${++rig.newUrlSeq}.trycloudflare.com`; state.child = {}; state.url = u; return { ok: true, url: u }; }
      return { ok: false, error: 'spawn failed' };
    },
    reclaim: (...args) => { calls.push('reclaim(' + args.length + ')'); },   // rule 10: must be called with NO argument
    now: () => rig.clock,
    log: () => {},
  };
  rig.wd = createTunnelWatchdog(deps, { bootGraceMs: 0, intervalMs: 1000, failuresToHeal: 3,
    backoffBaseMs: 1000, backoffCapMs: 8000, maxHeals: 3, resumeGapFactor: 2.5, ...opts });
  // advance the clock a little between ticks so the wake heuristic never fires by accident
  rig.tick = async (dt = 100) => { rig.clock += dt; return rig.wd.tick(); };
  return rig;
}

// ── 1a. Heal only after N CONSECUTIVE failures; order is kill-then-respawn-then-reclaim. ────────────
test('dead own url + reachable control: heals after N failures, kill before respawn', async () => {
  const rig = makeRig();
  let r = await rig.tick(); assert.equal(r.action, 'wait', '1st failure must only count');
  r = await rig.tick(); assert.equal(r.action, 'wait', '2nd failure must only count');
  assert.deepEqual(rig.calls, [], 'no side effect before N failures reached (a 530 is transient within the window)');
  r = await rig.tick(); assert.equal(r.action, 'healed', '3rd (Nth) consecutive failure heals');
  assert.deepEqual(rig.calls, ['teardown', 'start', 'reclaim(0)'],
    'heal order must be teardown (kill the dead child) BEFORE start (respawn) THEN reclaim');
  assert.match(r.url, /^https:\/\/live-1\./, 'a fresh url was adopted');
});

// ── 1b. A SINGLE transient failure must NOT restart. ────────────────────────────────────────────────
test('a single transient failure does not restart; a recovery resets the count', async () => {
  const rig = makeRig();
  await rig.tick();                                   // fail #1
  rig.probeResult = { ok: true, status: 200 };        // edge recovers
  let r = await rig.tick(); assert.equal(r.action, 'ok', 'recovery clears the state');
  rig.probeResult = { ok: false, status: 0 };         // now fail twice more
  await rig.tick(); r = await rig.tick();
  assert.equal(r.action, 'wait', 'only 2 consecutive failures after the reset -> still no heal');
  assert.deepEqual(rig.calls, [], 'no restart from a transient blip');
});

// ── 2. Uplink down (control url ALSO fails): must NOT restart (no storm against a dead uplink). ─────
test('own url AND control url down => uplink is down => never restarts', async () => {
  const rig = makeRig();
  rig.controlOk = false;
  let last;
  for (let i = 0; i < 8; i++) last = await rig.tick();   // well past N
  assert.equal(last.action, 'skip', 'classified as uplink-down');
  assert.equal(last.reason, 'uplink-down');
  assert.deepEqual(rig.calls, [], 'a dead uplink must never trigger teardown/respawn');
});

// ── 3. CF_STARTING lock: never fight an in-flight start (boot re-open or a prior heal still spawning). ─
test('defers while a start is in flight (CF_STARTING lock held)', async () => {
  const rig = makeRig();
  rig.state.startInFlight = true;
  let last; for (let i = 0; i < 5; i++) last = await rig.tick();
  assert.equal(last.action, 'defer');
  assert.equal(last.reason, 'start-in-flight');
  assert.deepEqual(rig.calls, [], 'must not kill a child that a start is bringing up');
});

// ── 4. Boot grace: no heal until the boot re-open has had time to settle. ───────────────────────────
test('defers during the boot grace window, then proceeds', async () => {
  const rig = makeRig({ bootGraceMs: 5000 });
  let r = await rig.tick(100); assert.equal(r.action, 'defer', 'inside boot grace');
  assert.equal(r.reason, 'boot-grace');
  rig.clock = 6000;                                   // past the grace window
  await rig.tick(0); await rig.tick(); r = await rig.tick();
  assert.equal(r.action, 'healed', 'heals once the boot grace has elapsed');
});

// ── 5. Backoff + cap: a persistently-dead respawn must not loop; it caps and stands down. ───────────
test('backoff spaces heals and a cap stops the loop', async () => {
  const rig = makeRig({ maxHeals: 3, backoffBaseMs: 1000, backoffCapMs: 8000 });
  rig.startOk = true;
  // every respawn comes up but immediately looks dead again (bad network): drive many ticks, jumping the
  // clock well past each backoff so a heal is always *allowed* when the count is reached.
  let heals = 0, capped = false;
  for (let i = 0; i < 40; i++) {
    const r = await rig.tick(2000);                   // +2s each tick clears backoffBase; big jumps avoided (< 2500 wake threshold)
    if (r.action === 'healed') heals++;
    if (r.action === 'capped') capped = true;
  }
  assert.equal(heals, 3, 'heals exactly maxHeals times then stops');
  assert.ok(capped, 'reaches the cap and stands down instead of looping for ever');
  assert.equal(rig.wd.stats.heals, 3, 'stats agree');
});

// ── 6. Wake: a slept box with a stale backoff/cap re-heals promptly after resume. ───────────────────
test('a detected wake resets the cap and re-heals', async () => {
  const rig = makeRig({ maxHeals: 1, intervalMs: 1000, resumeGapFactor: 2.5 });
  // drive to the cap (advancing the clock past each backoff, but under the 2500ms wake threshold)
  let r; for (let i = 0; i < 12; i++) { r = await rig.tick(400); if (r.action === 'capped') break; }
  assert.equal(r.action, 'capped', 'stuck at the cap');
  const healsBefore = rig.wd.stats.heals;
  // now the box sleeps: the next tick arrives far later than the interval (> 1000*2.5 = 2500ms)
  r = await rig.tick(5000);
  assert.equal(rig.wd.stats.resumes, 1, 'wake detected from the clock gap');
  assert.equal(r.action, 'healed', 'cap was reset on wake, so it heals again');
  assert.equal(rig.wd.stats.heals, healsBefore + 1);
});

// ── 7. onResume() hook also forces a prompt check. ─────────────────────────────────────────────────
test('onResume() clears backoff and runs a check immediately', async () => {
  const rig = makeRig({ maxHeals: 1 });
  let r; for (let i = 0; i < 12; i++) { r = await rig.tick(400); if (r.action === 'capped') break; }
  assert.equal(r.action, 'capped');
  r = await rig.wd.onResume();
  assert.equal(r.action, 'healed', 'onResume un-sticks the cap and re-heals');
});

// ── 8. Idle when the box was never made public (no tunnel to guard, stay-public OFF). ───────────────
test('idle (no side effects) when there is no tunnel up and stay-public is off', async () => {
  const rig = makeRig();
  rig.state.child = null; rig.state.url = ''; rig.wantPublic = false;
  let last; for (let i = 0; i < 5; i++) last = await rig.tick();
  assert.equal(last.action, 'idle');
  assert.equal(last.reason, 'not-public');
  assert.deepEqual(rig.calls, [], 'nothing to probe or heal when the operator never went public');
});

// ── §2a. stay-public ON + no tunnel up => the supervisor OPENS one (boot-reopen safety net). ────────
test('stay-public on and no tunnel up: supervisor opens one (no teardown — there is nothing to kill)', async () => {
  const rig = makeRig({ bootGraceMs: 0 });
  rig.state.child = null; rig.state.url = ''; rig.wantPublic = true;
  const r = await rig.tick();
  assert.equal(r.action, 'opened', 'a missing/failed boot re-open is recovered by opening a tunnel');
  assert.deepEqual(rig.calls, ['start', 'reclaim(0)'], 'opens (start) + reclaims OUR name; NO teardown when no child exists');
  assert.match(r.url, /^https:\/\/live-1\./);
  assert.equal(rig.wd.stats.opens, 1);
});

// ── §2b. Boot-recovery open is uplink-gated: a box still mid-boot (no internet yet) does NOT storm. ──
test('stay-public on but uplink down: supervisor does not try to open (no storm mid-boot)', async () => {
  const rig = makeRig({ bootGraceMs: 0 });
  rig.state.child = null; rig.state.url = ''; rig.wantPublic = true; rig.controlOk = false;
  let last; for (let i = 0; i < 5; i++) last = await rig.tick(400);
  assert.equal(last.action, 'skip');
  assert.equal(last.reason, 'uplink-down');
  assert.deepEqual(rig.calls, [], 'never spawns cloudflared while the uplink is down');
});

// ── §2c. Boot grace lets the 2.5s top-level boot hook go first before the supervisor opens one. ─────
test('stay-public on + no tunnel: defers during boot grace, then opens', async () => {
  const rig = makeRig({ bootGraceMs: 5000 });
  rig.state.child = null; rig.state.url = ''; rig.wantPublic = true;
  let r = await rig.tick(100); assert.equal(r.action, 'defer');
  assert.equal(r.reason, 'boot-grace');
  rig.clock = 6000;
  r = await rig.tick(0);
  assert.equal(r.action, 'opened', 'opens once the boot hook has had its window');
});

// ── 9. WIRING: the real gateway.mjs actually ARMS the watchdog (proven by execution, not by text). ──
const PORT = 8791;
let relay, dataDir, stdout = '';
before(async () => {
  await requireFreePort(PORT, 'a-dead-tunnel-heals-itself.test.mjs (gateway wiring check)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-selfheal-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TRINITY_DATA_DIR: dataDir } });
  relay.stdout.on('data', d => { stdout += String(d); });
  relay.stderr.on('data', d => { stdout += String(d); });
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('the real gateway arms the tunnel watchdog at boot', async () => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !/\[selfheal\] tunnel watchdog armed/.test(stdout)) await new Promise(r => setTimeout(r, 200));
  assert.match(stdout, /\[selfheal\] tunnel watchdog armed \(interval=\d+ms, N=\d+\)/,
    'gateway.mjs must execute tunnelWatchdog.start() at boot (deleting the arm removes this line)');
});

// A tiny sanity check that the shipped defaults are the ones the SPEC calls for (N consecutive, not one).
test('shipped defaults require N>1 consecutive failures', () => {
  assert.ok(DEFAULT_WATCHDOG_CONFIG.failuresToHeal >= 2, 'a single failure must never heal');
});
