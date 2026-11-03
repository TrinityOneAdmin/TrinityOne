// relay-selfheal.mjs -- self-healing tunnel supervisor for a self-hosted relay (SPEC §3 + §2, 2026-11-03).
//
// Two jobs, one periodic loop (tick):
//   §3 (silent mid-run death): a quick tunnel can die while cloudflared stays alive — detect + heal.
//   §2 (stay public across a reboot): when the stay-public flag is set but no tunnel is up, OPEN one.
//       The top-level boot hook re-opens ONCE 2.5s after boot with no retry; on a real reboot that one
//       shot misses (wifi/DNS not ready yet) and the box comes up private. This supervisor is the retry
//       safety net — it ensures a tunnel is up, uplink-gated and backed off, not only restarts a dead one.
//
// WHY §3 EXISTS: a Cloudflare quick tunnel can die AT THE EDGE (its trycloudflare.com name goes
// NXDOMAIN) while the local `cloudflared` process stays alive. The box then advertises a dead
// address for ever and nothing re-claims. Measured on `true-reed-88`, 2026-11-03. This watchdog
// detects that from OUTSIDE, kills the dead child, respawns a fresh tunnel (the only thing that mints
// a new url), and re-points the box's OWN directory name at it.
//
// EVERYTHING IS INJECTED (deps) so the decision is testable without a real tunnel or the network.
// The core is `tick()` — the exact function the running gateway arms on a timer. Points of care, all
// from the audit corrections at the top of SPEC-relay-self-healing-2026-11-03.md:
//
//   1. The probe MUST round-trip the public edge (external HTTPS GET of CF_URL), NEVER loopback — a
//      loopback check passes while the edge is dead, which is the whole bug.
//   2. N CONSECUTIVE failures before a heal (a single blip, incl. Cloudflare 530/1033, is transient).
//   3. Before healing, probe a known-good CONTROL url; if that also fails the UPLINK is down (box
//      asleep / no internet) — do NOT restart (that is a restart-storm against a dead uplink).
//   4. Heal order is KILL FIRST, then respawn, then reclaim: startCloudflared() is a no-op while
//      CF_CHILD && CF_URL are set, so without the teardown it returns the DEAD url and re-claims the
//      DEAD address. Only a fresh cloudflared process mints a new quick-tunnel url.
//   5. Never fight an in-flight start (boot re-open or a prior heal still spawning): defer while the
//      CF_STARTING lock is held, and sit out a boot grace window.
//   6. Exponential backoff + a cap on repeated heals, so a persistently-bad network cannot loop.
//   7. Re-heal promptly after the box wakes: node has no portable OS-resume event, so we detect a
//      suspend by the wall-clock GAP between ticks and reset the backoff/cap so a slept laptop does
//      not sit out a stale backoff after resuming.
//
// RULE 10 (relay admission): the watchdog only ever re-points THIS box's OWN name to THIS box's OWN
// new address and re-claims it (deps.reclaim is reclaimRelayName, which needs no argument and acts on
// MY_RELAY_NAME only). It never dials, admits, or learns any other relay. There is deliberately no dep
// that could reach another box.

export const DEFAULT_WATCHDOG_CONFIG = {
  intervalMs: 60_000,        // how often to probe our own public url
  failuresToHeal: 3,         // N consecutive failures before a heal (transient blips must persist)
  bootGraceMs: 20_000,       // don't heal within this long of arming (let the boot re-open settle)
  backoffBaseMs: 60_000,     // first backoff after a heal
  backoffCapMs: 30 * 60_000, // backoff never exceeds 30 min
  maxHeals: 6,               // stand down after this many heals until a probe succeeds or the box wakes
  resumeGapFactor: 2.5,      // a tick arriving >2.5x late means the process was suspended (wake)
};

// Build a watchdog. `deps`:
//   getState()      -> { child, url, startInFlight }   (gateway's CF_CHILD / CF_URL / !!CF_STARTING)
//   wantPublic()    -> boolean   TUNNEL_FLAG present = the operator asked to "stay public" (SPEC §2)
//   probe(url)      -> Promise<{ ok:boolean, status?:number }>   external edge GET of OUR url
//   controlProbe()  -> Promise<boolean>                           a known-good canonical url
//   teardown()      -> void    mirror /tunnel/down: CF_CHILD.kill(); CF_CHILD=null; CF_URL=''  (NOT the flag)
//   start()         -> Promise<{ ok:boolean, url?:string }>       startCloudflared()
//   reclaim()       -> Promise<void>|void                          reclaimRelayName() — OUR name only
//   now()           -> number  (ms; injectable for tests)
//   log(msg)        -> void
export function createTunnelWatchdog(deps, config = {}) {
  const cfg = { ...DEFAULT_WATCHDOG_CONFIG, ...config };
  const now = deps.now || Date.now;
  const log = deps.log || (() => {});

  let consecutive = 0;        // consecutive failed probes of our own url
  let healCount = 0;          // heals since the last healthy probe (drives backoff + cap)
  let nextHealAllowedAt = 0;  // backoff gate
  let lastTickAt = 0;
  let armedAt = now();
  let timer = null;
  const stats = { ticks: 0, heals: 0, opens: 0, resumes: 0, lastAction: '', lastStatus: undefined };

  async function tick(trigger = 'timer') {
    const t = now();
    stats.ticks++;
    // (7) Wake heuristic: a periodic tick that arrived far later than its interval means the process
    // was suspended (laptop slept). Clear any stale backoff/cap so we re-heal fast once awake.
    if (lastTickAt && (t - lastTickAt) > cfg.intervalMs * cfg.resumeGapFactor) {
      stats.resumes++;
      nextHealAllowedAt = 0; healCount = 0;
      log(`[selfheal] wake detected (gap ${t - lastTickAt}ms > ${cfg.intervalMs * cfg.resumeGapFactor}ms) — backoff reset, checking now`);
    }
    lastTickAt = t;

    const st = deps.getState() || {};
    const tunnelUp = !!(st.url && st.child);

    // ── SPEC §2: "stay public" must survive a reboot. The top-level boot hook re-opens the tunnel ONCE,
    // 2.5s after boot, with NO retry — so on a real reboot, where wifi/DNS often is not ready that early
    // (or cloudflared's single attempt hits a transient edge failure), that one shot misses and the box
    // comes up private with the flag still on disk. The supervisor is the safety net: whenever the
    // stay-public flag is set and NO tunnel is up, it OPENS one (not just restarts a dead one) and keeps
    // retrying, uplink-gated and backed off, until it succeeds.
    if (!tunnelUp) {
      consecutive = 0;
      if (!(deps.wantPublic && deps.wantPublic())) return rec('idle', 'not-public');   // operator didn't ask to stay public
      if (st.startInFlight) return rec('defer', 'start-in-flight');                     // (5) boot hook is already spawning one
      if (t - armedAt < cfg.bootGraceMs) return rec('defer', 'boot-grace');             // (5) let the 2.5s boot hook go first
      if (t < nextHealAllowedAt) return rec('backoff', `wait ${nextHealAllowedAt - t}ms`);
      if (healCount >= cfg.maxHeals) { log(`[selfheal] open cap reached (${healCount}/${cfg.maxHeals}) — standing down until the box wakes`); return rec('capped', 'max-opens'); }
      // Only open when the uplink is actually up, else we storm against a dead network / a box mid-boot.
      if (!(await deps.controlProbe())) return rec('skip', 'uplink-down');
      log(`[selfheal] stay-public is ON but no tunnel is up — opening one (boot recovery, attempt #${healCount + 1})`);
      const o = await startSafely();
      if (o.ok) { try { await deps.reclaim(); } catch {} }
      healCount++; stats.opens++;
      nextHealAllowedAt = t + Math.min(cfg.backoffCapMs, cfg.backoffBaseMs * Math.pow(2, healCount - 1));
      log(o.ok ? `[selfheal] tunnel opened on boot recovery: ${o.url}` : `[selfheal] boot-recovery open failed — backing off ${nextHealAllowedAt - t}ms`);
      return rec(o.ok ? 'opened' : 'open-failed', 'boot-ensure', o.ok ? o.url : '');
    }

    // (5) Never fight an in-flight start — the boot re-open or a prior heal is already spawning a child.
    if (st.startInFlight) return rec('defer', 'start-in-flight');
    // (5) Boot grace — let the boot re-open settle before we are ever allowed to kill a child.
    if (t - armedAt < cfg.bootGraceMs) return rec('defer', 'boot-grace');

    // (1) External edge probe of OUR OWN current url. deps.probe must go out through real DNS/the edge.
    const p = await deps.probe(st.url);
    stats.lastStatus = p ? p.status : undefined;
    if (p && p.ok) { consecutive = 0; healCount = 0; nextHealAllowedAt = 0; return rec('ok', 'reachable'); }

    // (2) Count the failure. A single failure — including a transient Cloudflare 530/1033 — is not enough.
    consecutive++;
    if (consecutive < cfg.failuresToHeal)
      return rec('wait', `fail ${consecutive}/${cfg.failuresToHeal}${p && p.status ? ` (status ${p.status})` : ''}`);

    // (3) N failures reached — is it MY tunnel, or is my uplink down? Probe a known-good control url.
    const controlOk = await deps.controlProbe();
    if (!controlOk) {
      // Uplink down / box asleep: our url and a canonical url both fail. Restarting cloudflared now
      // would be a storm against a dead uplink. Hold the failure count pinned so we act the instant
      // the uplink returns.
      consecutive = cfg.failuresToHeal;
      log('[selfheal] own url unreachable AND control url unreachable — uplink is down, NOT restarting');
      return rec('skip', 'uplink-down');
    }
    // (6) Tunnel is dead while the uplink is fine → heal, subject to backoff + cap.
    if (t < nextHealAllowedAt) return rec('backoff', `wait ${nextHealAllowedAt - t}ms`);
    if (healCount >= cfg.maxHeals) {
      log(`[selfheal] heal cap reached (${healCount}/${cfg.maxHeals}) — standing down until a probe succeeds or the box wakes`);
      return rec('capped', 'max-heals');
    }

    // (4) HEAL — kill FIRST, then respawn, then reclaim. Order is load-bearing.
    const deadUrl = st.url;
    log(`[selfheal] HEAL: own url ${deadUrl} unreachable ${consecutive}x, control url reachable → tunnel is dead at the edge (heal #${healCount + 1})`);
    deps.teardown();                               // CF_CHILD.kill(); CF_CHILD=null; CF_URL=''  (keep the flag — we stay public)
    const r = await startSafely();
    const ok = r.ok;
    if (ok) { try { await deps.reclaim(); } catch {} }   // re-point OUR name at the new url (own box only; rule 10)
    healCount++;
    stats.heals++;
    nextHealAllowedAt = t + Math.min(cfg.backoffCapMs, cfg.backoffBaseMs * Math.pow(2, healCount - 1));
    consecutive = 0;                               // re-evaluate the NEW url on the next interval
    log(ok ? `[selfheal] heal ok: new url ${r.url} (next heal no sooner than +${nextHealAllowedAt - t}ms)`
          : `[selfheal] heal FAILED to spawn a new tunnel — backing off ${nextHealAllowedAt - t}ms`);
    return rec(ok ? 'healed' : 'heal-failed', deadUrl, ok ? r.url : '');
  }

  function rec(action, reason, url) { stats.lastAction = action; return { action, reason, url }; }
  async function startSafely() {   // startCloudflared() but never throws, so a rejected spawn still backs off
    try { const r = await deps.start(); return { ok: !!(r && r.ok), url: r && r.url, error: r && r.error }; }
    catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  }

  // Arm/disarm the periodic timer. Self-rescheduling setTimeout (not setInterval) so a slow probe can
  // never overlap the next tick. Unref'd so it never holds the process open.
  function start() {
    if (timer) return;
    armedAt = now(); lastTickAt = 0;
    const loop = () => {
      timer = setTimeout(() => { tick('timer').catch(() => {}).finally(loop); }, cfg.intervalMs);
      if (timer && timer.unref) timer.unref();
    };
    loop();
    log(`[selfheal] tunnel watchdog armed (interval=${cfg.intervalMs}ms, N=${cfg.failuresToHeal})`);
  }
  function stop() { if (timer) { clearTimeout(timer); timer = null; } }

  // (7) Extra trigger hook for a real OS resume/online event, if the host can supply one. Resets the
  // backoff and runs a check immediately. Harmless if never called (the timer still covers it).
  function onResume() { nextHealAllowedAt = 0; healCount = 0; stats.resumes++; return tick('resume'); }

  return { tick, onResume, start, stop, stats, config: cfg };
}
