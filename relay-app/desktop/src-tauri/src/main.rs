// TrinityOne Relay — Tauri 2 desktop shell.
//
// What it does: on launch it starts the church relay (the gateway) as a BUNDLED Node sidecar — the user needs
// no Node installed — pointed at the read-only app payload for its code and at a writable per-user app-data dir
// (TRINITY_DATA_DIR) for its data. It shows a splash window immediately, waits for the relay to bind its port,
// then navigates the window to the relay's own control panel (same-origin, so /status etc. just work). On close
// it kills the relay child so nothing lingers.
//
// The payload (scripts/gateway.mjs + web app + minimal node_modules) is produced by scripts/build-relay-payload.sh
// and bundled as a Tauri resource. The Node runtime is shipped as the sidecar `binaries/trinityone-relay-<triple>`
// (a renamed official node binary, placed by scripts/fetch-node-sidecar.sh in CI).
//
// The relay is told to bind LOOPBACK (RELAY_HOST=127.0.0.1) unless the operator opts into LAN access in the
// control panel (the `lan-access` marker in the data dir): the window + a local browser reach it there, and
// Windows never shows a firewall prompt (loopback needs no network permission). Everything the app does with the
// relay is logged to <app-data>/relay-launch.log so a stuck launch is diagnosable without a console.
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use std::{thread, time::Duration};
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const PORT: u16 = 8787;

// The loopback-vs-network bind decision lives in its own dependency-free file so the node suite can compile and
// run its tests with plain rustc (scripts/relay-bind-setting.test.mjs). relay_env() below is its only caller.
mod bind_host;

// Holds the running relay child so we can kill it on exit. CommandChild::kill consumes self, hence the Option.
struct Relay(Mutex<Option<CommandChild>>);

// Append one line to the launch log (best-effort). This is our only window into a background launch failure,
// since the packaged app has no console (windows_subsystem = "windows").
fn applog(path: &Path, msg: &str) {
    use std::io::Write;
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{msg}");
    }
}

// ── keep-awake ────────────────────────────────────────────────────────────────────────────────
// While this church's relay is PUBLIC it stops the machine going to sleep, so the congregation stays
// reachable. The relay already re-dials its tunnel AFTER a wake; this closes the window BEFORE it — a
// closed laptop lid or an idle timeout should not quietly take a church's relay offline for hours.
//
// It asks the relay itself whether it's public, over the loopback port the relay already serves. A bare
// HTTP/1.0 GET over TcpStream (the same type this file uses for its readiness probe) is all that needs:
// loopback, plain HTTP, no TLS, one request, we close the connection. Pulling in reqwest/ureq + serde
// for two localhost GETs would graft a tree of crates onto a shell that today depends only on tauri —
// so we hand-write the request and pick the booleans we need out of the body by substring, rather than
// deserialising a response the relay itself formatted.
//
// AUTH: /tunnel/state and /tailscale/state are admin-gated (adminOK) and return 401 WITHOUT a bearer
// token — and adminOK deliberately does NOT trust 127.0.0.1, because a tunnel proxies requests in from
// loopback, so "it came from localhost" proves nothing. The correct credential is the admin token the
// gateway writes to `<data_dir>/admin.json` (mode 0600) at startup: we are the same user on the same
// machine (the Suite IS the local owner), and this is exactly how the control panel bootstraps itself
// via /local-token. So we read that file and send `Authorization: Bearer <token>` — not loopback trust.
fn http_get_loopback(path: &str, token: Option<&str>) -> Option<String> {
    use std::io::{Read, Write};
    let mut stream = TcpStream::connect(("127.0.0.1", PORT)).ok()?;
    // 2–3s is plenty on loopback; a hang must not stall the 15s controller tick.
    stream.set_read_timeout(Some(Duration::from_secs(3))).ok()?;
    stream.set_write_timeout(Some(Duration::from_secs(3))).ok()?;
    let auth = match token {
        Some(t) => format!("Authorization: Bearer {t}\r\n"),
        None => String::new(),
    };
    let req = format!("GET {path} HTTP/1.0\r\nHost: 127.0.0.1\r\n{auth}Connection: close\r\n\r\n");
    stream.write_all(req.as_bytes()).ok()?;
    let mut raw = String::new();
    stream.read_to_string(&mut raw).ok()?;
    // split off the status line + headers at the blank line; anything malformed → None (unknown).
    raw.split_once("\r\n\r\n").map(|(_, body)| body.to_string())
}

// Pull the admin bearer token out of `<data_dir>/admin.json`, read FRESH each tick: it's cheap, it
// self-heals a token rotation, and it rides out the first-launch race where the gateway may not have
// written the file yet on our first poll (we just skip that tick and try again 15s later).
fn read_admin_token(data_dir: &Path) -> Option<String> {
    let body = std::fs::read_to_string(data_dir.join("admin.json")).ok()?;
    extract_token(&body)
}

// Pure string slice, factored out so it's testable without a file: find `"token":"` (tolerating one
// space after the colon) and take up to the next `"`. Token charset is base64url (A-Za-z0-9-_), so the
// closing quote is an unambiguous terminator.
fn extract_token(body: &str) -> Option<String> {
    for open in ["\"token\":\"", "\"token\": \""] {
        if let Some(i) = body.find(open) {
            let rest = &body[i + open.len()..];
            if let Some(end) = rest.find('"') {
                if end > 0 {
                    return Some(rest[..end].to_string());
                }
            }
        }
    }
    None
}

// Coarse JSON probes — NOT a parser. We only ever need two booleans and "is this string field
// non-empty", from a response the relay itself emits, so substring matching is enough to stay
// serde-free. Tolerant of the one optional space after the colon (the only whitespace the relay varies).
fn json_bool_true(body: &str, key: &str) -> bool {
    let k = format!("\"{key}\":");
    body.contains(&format!("{k}true")) || body.contains(&format!("{k} true"))
}

fn json_str_nonempty(body: &str, key: &str) -> bool {
    // true iff the body carries `"key":"…"` whose first character after the opening quote is not the
    // closing quote — i.e. the string value has at least one character. `"url":""` → false.
    for open in [format!("\"{key}\":\""), format!("\"{key}\": \"")] {
        if let Some(i) = body.find(&open) {
            if let Some(c) = body[i + open.len()..].chars().next() {
                if c != '"' {
                    return true;
                }
            }
        }
    }
    false
}

// PURE decision — the point-of-use unit (CLAUDE.md rule 1). Kept free of I/O so the controller's actual
// policy can be exercised by `cargo test` without a relay running.
fn should_keep_awake(
    tunnel_running: bool,
    tunnel_has_url: bool,
    funnel_on: bool,
    funnel_has_url: bool,
    disabled: bool,
) -> bool {
    // The operator's off-switch wins over everything (see the marker contract on the controller thread).
    if disabled {
        return false;
    }
    // Public = a Cloudflare tunnel running with a URL, OR a Tailscale funnel on with a public URL.
    (tunnel_running && tunnel_has_url) || (funnel_on && funnel_has_url)
}

// The OS sleep inhibitor, driven by the controller thread. Held only while the relay is public and
// released the instant it isn't, so an offline relay never pins a laptop awake.
#[cfg(target_os = "windows")]
#[link(name = "kernel32")]
extern "system" {
    fn SetThreadExecutionState(es_flags: u32) -> u32;
}

// On mac/linux the inhibitor is a separate child process (caffeinate / systemd-inhibit). That child does
// NOT die when the Suite exits, so if it were owned only by the controller thread it would outlive the
// app and pin the machine awake until reboot. We therefore park it in Tauri-managed state — the same
// pattern as `Relay` — so the window's CloseRequested handler can reap it on quit too. The controller
// thread and the close handler share the one slot through an Arc. Windows needs none of this: its
// inhibitor is per-thread OS state the kernel clears automatically when the process exits.
#[cfg(any(target_os = "macos", target_os = "linux"))]
struct Inhibitor(std::sync::Arc<Mutex<Option<std::process::Child>>>);

struct KeepAwake {
    // The live inhibitor child lives in the shared, Tauri-managed slot (see Inhibitor). Windows stores
    // nothing here — its inhibitor is per-thread OS state, not a process.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    slot: std::sync::Arc<Mutex<Option<std::process::Child>>>,
}

impl KeepAwake {
    fn new(
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        slot: std::sync::Arc<Mutex<Option<std::process::Child>>>,
    ) -> Self {
        KeepAwake {
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            slot,
        }
    }

    #[cfg(target_os = "macos")]
    fn acquire(&mut self, log: &Path) {
        let mut guard = self.slot.lock().unwrap();
        if guard.is_some() {
            return;
        }
        // -i inhibit idle system sleep, -m prevent disk sleep, -s assert system sleep while on AC power.
        match std::process::Command::new("/usr/bin/caffeinate").args(["-i", "-m", "-s"]).spawn() {
            Ok(c) => *guard = Some(c),
            Err(e) => applog(log, &format!("keep-awake: caffeinate spawn failed: {e}")),
        }
    }

    #[cfg(target_os = "linux")]
    fn acquire(&mut self, log: &Path) {
        let mut guard = self.slot.lock().unwrap();
        if guard.is_some() {
            return;
        }
        // systemd-inhibit blocks sleep+idle for as long as the command it runs (sleep infinity) lives.
        // No systemd/logind → spawn fails; log once and no-op rather than crash the shell.
        match std::process::Command::new("systemd-inhibit")
            .args([
                "--what=sleep:idle",
                "--who=TrinityOne Relay",
                "--why=Church relay is public",
                "--mode=block",
                "sleep",
                "infinity",
            ])
            .spawn()
        {
            Ok(c) => *guard = Some(c),
            Err(e) => applog(log, &format!("keep-awake: systemd-inhibit unavailable, no-op: {e}")),
        }
    }

    #[cfg(target_os = "windows")]
    fn acquire(&mut self, _log: &Path) {
        // ES_CONTINUOUS = keep this request in force until explicitly cleared; ES_SYSTEM_REQUIRED = keep
        // the system from sleeping. Per-thread state: it holds only while the thread that set it lives —
        // the controller thread never exits, so the request stands for the whole public session.
        const ES_CONTINUOUS: u32 = 0x8000_0000;
        const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;
        unsafe {
            SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED);
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn release(&mut self, _log: &Path) {
        if let Some(mut c) = self.slot.lock().unwrap().take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }

    #[cfg(target_os = "windows")]
    fn release(&mut self, _log: &Path) {
        // Clear the request but stay continuous-mode: lets the system resume its normal idle timers.
        const ES_CONTINUOUS: u32 = 0x8000_0000;
        unsafe {
            SetThreadExecutionState(ES_CONTINUOUS);
        }
    }
}

// ── Suite JS auto-update (P2 — the app shell's half) ────────────────────────────────────────────
// This shell is the trust root. The signed JS bundle is checked/downloaded/staged by the relay (P3,
// gateway.mjs suiteAutoUpdate) into <TRINITY_DATA_DIR>/suite/, but it is NEVER activated there. The shell
// decides what code the relay runs:
//   • EVERY LAUNCH (startup): run the activated override (suite/active) only if auto-update is ON, its retained
//     tarball (active.tgz/active.sig) verifies against the READ-ONLY payload key, its SIGNED date is newer than
//     the installed Suite's own payload, and the unpacked tree matches it (repaired from the tarball if not) —
//     and then only if it actually comes up; anything else runs the baked-in payload. An override older than
//     (or as old as) the installed payload is deleted: a newer Suite was installed by hand. [audit H3, M1]
//   • TIMED APPLY: inside the operator's window (HH:MM to HH:MM + 2 h), once per window, if a verified bundle
//     is staged, re-verify it, enforce the anti-rollback floor, stop the relay, swap active/, restart from
//     active/, health-check, and roll back to last-good (or payload) on any failure. A window missed because the
//     computer was off or asleep is applied at the next START of the Suite, before the relay is first started
//     (owner decision Q3, PLAN-suite-js-autoupdate §10). Never at any other time. [audit H1]
// The verifier and the pinned release-pubkey.pem are ALWAYS taken from the read-only payload, never from the
// (writable) override — see verify_tarball and the PAYLOAD_DIR invariant in spawn_relay.

// The launch decision for an override that is on disk. Payload = run the shipped code, leave the files;
// Active = run the override; Retire = run the shipped code AND delete the override (it can never run again).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LaunchPick {
    Payload,
    Active,
    Retire,
}

// PURE launch decision (cargo-testable). `signed` is the identity of active.tgz as verified against the
// read-only payload key (None = absent, unverifiable, or no node to verify with).
//   • nothing verifiable on disk                        → Payload (never run unverified code)
//   • its signed date is NOT after the payload's own    → Retire  (a newer — or the same — Suite was installed
//                                                                  by hand; the override is obsolete) [audit H3]
//   • auto-update switched OFF                          → Payload (switching off returns to the shipped code at
//                                                                  the next start; the files are kept so
//                                                                  switching back on resumes it) [audit H3]
//   • otherwise                                         → Active
fn launch_pick(enabled: bool, signed: Option<&SignedId>, payload_date: &str) -> LaunchPick {
    match signed {
        None => LaunchPick::Payload,
        Some(id) if !date_after(&id.date, payload_date) => LaunchPick::Retire,
        Some(_) if !enabled => LaunchPick::Payload,
        Some(_) => LaunchPick::Active,
    }
}

// Where to recover to if a freshly-applied bundle fails its health check.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RollbackTarget {
    Keep,     // health ok — keep the new active/
    LastGood, // roll back to the retained previous override
    Payload,  // no last-good — fall back to the baked-in payload
}

// PURE rollback decision (cargo-testable).
fn rollback_target(health_ok: bool, have_last_good: bool) -> RollbackTarget {
    if health_ok {
        RollbackTarget::Keep
    } else if have_last_good {
        RollbackTarget::LastGood
    } else {
        RollbackTarget::Payload
    }
}

// The post-respawn health verdict. Keep{store_degraded} means the new code is applied (store_degraded only
// changes the recorded outcome label). Rollback{quarantine} means revert; quarantine marks the sha so it is
// never auto-applied again.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Outcome {
    Keep { store_degraded: bool },
    Rollback { quarantine: bool },
}

// [AUDIT FIX #1 — MEDIUM] PURE post-respawn health decision (cargo-testable). The old gate quarantined+rolled
// back a GOOD bundle whenever /status reported ok:false, but gateway.mjs sets `ok: !STORE_DEGRADED` (L7155),
// i.e. ok:false means ONLY "the store is degraded" — a transient data-plane problem that is INDEPENDENT of
// which code version booted. So the decision is:
//   • not reachable (no /status inside the window)        → the new code never booted      → Rollback+quarantine
//   • reachable but version/sha does NOT match READY      → wrong code is answering         → Rollback+quarantine
//   • reachable, version matches, ok:true                 → healthy                          → Keep
//   • reachable, version matches, ok:false BUT solely a   → booted + identifies correctly;   → Keep (note degraded,
//     degraded STORAGE store (degraded.what=="storage")     bad code is not the cause            do NOT quarantine)
//   • reachable, version matches, ok:false for ANY OTHER  → conservative: treat as bad       → Rollback+quarantine
//     reason (no storage-degraded evidence)
// Being conservative about the storage case is deliberate: today ok:false ⟺ STORE_DEGRADED ⟺ what=="storage",
// but a future non-storage ok:false must still fail closed.
fn health_outcome(reachable: bool, version_match: bool, ok: bool, degraded_storage: bool) -> Outcome {
    if !reachable || !version_match {
        // No boot, or the wrong code identified itself: the new bundle is genuinely bad.
        return Outcome::Rollback { quarantine: true };
    }
    if ok {
        return Outcome::Keep { store_degraded: false };
    }
    // ok:false while version matches → keep ONLY if the sole reason is a degraded store.
    if degraded_storage {
        Outcome::Keep { store_degraded: true }
    } else {
        Outcome::Rollback { quarantine: true }
    }
}

// [AUDIT FIX #2 — LOW] Char-safe short sha. The old `&r_sha[..7]` (and `&r_sha[..r_sha.len().min(7)]`) slice
// on BYTE boundaries and panic if byte index 7 lands inside a multibyte char — a malformed-but-benign sha
// could crash the controller thread. Taking chars is boundary-safe and simply yields fewer chars for shorts.
fn short_sha(s: &str) -> String {
    s.chars().take(7).collect()
}

// [AUDIT FIX #3 — LOW] After a stop-timeout (kill didn't confirm within the window) the controller must not
// kill→wait→respawn every minute against a wedged child. This PURE helper says whether the apply cooldown has
// elapsed: no cooldown set → proceed; otherwise proceed only once `now` has reached the stored retry instant.
fn cooldown_elapsed(now: Instant, retry_at: Option<Instant>) -> bool {
    match retry_at {
        None => true,
        Some(t) => now >= t,
    }
}

// How long to back off apply attempts after a stop-timeout. Long enough to stop the ~60s thrash; the church
// stays ONLINE on its current code throughout, and a later tick retries once the window elapses.
const APPLY_COOLDOWN: Duration = Duration::from_secs(3600);

// The local wall clock, as the operator set HH:MM in: minutes-of-day, today's and yesterday's dates, and the
// epoch seconds of the same instant.
#[derive(Debug, Clone, PartialEq, Eq)]
struct LocalNow {
    min: u32,
    today: String,
    yesterday: String,
    epoch: i64,
}

// How long after HH:MM an update may still be applied. [audit H1] The old rule ("any time after HH:MM today")
// installed a bundle within a minute of it arriving — mid-afternoon, Sunday morning — while the panel said
// "tonight". Two hours is enough for a computer that wakes a little late, and never reaches the working day
// from an early-morning time.
const APPLY_WINDOW_MIN: u32 = 120;

// Minutes since the most recent HH:MM (0..1439). PURE.
fn mins_into_window(now_min: u32, target_min: u32) -> u32 {
    (now_min + 1440 - target_min % 1440) % 1440
}

// The calendar day the most recent window STARTED on (a window that opened at 23:30 yesterday is still
// yesterday's at 00:15 today). Used to apply at most once per window. PURE.
fn window_day(now: &LocalNow, target_min: u32) -> &str {
    if now.min >= target_min {
        &now.today
    } else {
        &now.yesterday
    }
}

// PURE: is a running Suite inside its apply window, with nothing applied in this window yet? The
// staged-READY-present and marker-enabled gates are checked by the caller (they are I/O, not policy).
fn due(now: &LocalNow, target_min: u32, last_applied: &str) -> bool {
    mins_into_window(now.min, target_min) < APPLY_WINDOW_MIN && last_applied != window_day(now, target_min)
}

// PURE: at a START of the Suite, was the most recent window missed while an update was already waiting? True
// when the bundle was staged before that window opened and nothing was applied in it — the computer was off or
// asleep then. (A bundle that arrived after the window waits for the next one.) Owner decision Q3.
fn missed_window(now: &LocalNow, target_min: u32, staged_epoch: i64, last_applied: &str) -> bool {
    let opened = now.epoch - now.epoch.rem_euclid(60) - (mins_into_window(now.min, target_min) as i64) * 60;
    staged_epoch < opened && last_applied != window_day(now, target_min)
}

// Parse "HH:MM" (tolerating surrounding whitespace / trailing newline) to minutes-of-day.
fn parse_hhmm(s: &str) -> Option<u32> {
    let t = s.trim();
    let (h, m) = t.split_once(':')?;
    let h: u32 = h.trim().parse().ok()?;
    let m: u32 = m.trim().parse().ok()?;
    if h > 23 || m > 59 {
        return None;
    }
    Some(h * 60 + m)
}

// Days since 1970-01-01 for a proleptic-Gregorian date (Howard Hinnant's algorithm). PURE.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400; // [0, 399]
    let mp = (m + 9) % 12; // Mar=0 … Feb=11
    let doy = (153 * mp + 2) / 5 + d - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146097 + doe - 719468
}

// Parse an ISO-8601 / RFC-3339 instant to epoch SECONDS. PURE. Handles "YYYY-MM-DD",
// "YYYY-MM-DDThh:mm:ss", a fractional-second part (ignored), and a trailing offset ("Z", "+01:00", "-0500").
// This is the Rust twin of gateway.mjs's Date.parse use: an offset is applied so two instants compare by the
// MOMENT they name, not by their text (git %cI stamps carry offsets, so "…+01:00" vs "…Z" order the opposite
// way lexically). A datetime with no offset is read as UTC (deterministic + testable); in practice every date
// this handles — READY.date and payload version.txt's %cI — carries an offset.
fn parse_instant(s: &str) -> Option<i64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    let (date_part, rest) = match s.find(['T', 't', ' ']) {
        Some(i) => (&s[..i], &s[i + 1..]),
        None => (s, ""),
    };
    let mut dps = date_part.split('-');
    let y: i64 = dps.next()?.trim().parse().ok()?;
    let mo: i64 = dps.next()?.parse().ok()?;
    let d: i64 = dps.next()?.parse().ok()?;
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) {
        return None;
    }
    let days = days_from_civil(y, mo, d);
    let (mut hh, mut mi, mut ss, mut off) = (0i64, 0i64, 0i64, 0i64);
    if !rest.is_empty() {
        // The offset begins at a 'Z'/'z', or at a '+'/'-' that is not the first character of `rest`.
        let mut tz_idx = None;
        for (i, c) in rest.char_indices() {
            if c == 'Z' || c == 'z' || ((c == '+' || c == '-') && i > 0) {
                tz_idx = Some(i);
                break;
            }
        }
        let (time_str, tz_str) = match tz_idx {
            Some(i) => (&rest[..i], &rest[i..]),
            None => (rest, ""),
        };
        let mut tps = time_str.trim().split(':');
        hh = tps.next().and_then(|x| x.trim().parse().ok()).unwrap_or(0);
        mi = tps.next().and_then(|x| x.parse().ok()).unwrap_or(0);
        if let Some(sec) = tps.next() {
            ss = sec.split('.').next().unwrap_or("0").parse().unwrap_or(0);
        }
        let tzc = tz_str.trim();
        if !tzc.is_empty() && !tzc.eq_ignore_ascii_case("z") {
            let sign = if tzc.starts_with('-') { -1 } else { 1 };
            let digits: String = tzc[1..].chars().filter(|c| c.is_ascii_digit()).collect();
            let oh: i64 = digits.get(0..2).and_then(|x| x.parse().ok()).unwrap_or(0);
            let om: i64 = digits.get(2..4).and_then(|x| x.parse().ok()).unwrap_or(0);
            off = sign * (oh * 3600 + om * 60);
        }
    }
    Some(days * 86400 + hh * 3600 + mi * 60 + ss - off)
}

// Strictly-after by INSTANT. PURE. Mirrors gateway.mjs suiteDateAfter EXACTLY: an unparseable `a` → false
// (refuse); an unparseable/empty floor `b` → true (nothing valid to beat).
fn date_after(a: &str, b: &str) -> bool {
    match parse_instant(a) {
        None => false,
        Some(ta) => match parse_instant(b) {
            None => true,
            Some(tb) => ta > tb,
        },
    }
}

// Coarse JSON string-value read (NOT a parser) — the same house style as json_bool_true / json_str_nonempty.
// Returns the value of `"key":"…"` up to the next quote. The only values we read with it (sha, date, version,
// lastApplied, installedDate) are plain tokens with no embedded quote or escape, so this is sufficient.
fn json_str_value(body: &str, key: &str) -> Option<String> {
    for open in [format!("\"{key}\":\""), format!("\"{key}\": \"")] {
        if let Some(i) = body.find(&open) {
            let rest = &body[i + open.len()..];
            if let Some(end) = rest.find('"') {
                return Some(rest[..end].to_string());
            }
        }
    }
    None
}

// Minimal JSON string-literal encoder for the handful of state.json values we write.
fn jstr(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 2);
    o.push('"');
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '\r' => o.push_str("\\r"),
            '\t' => o.push_str("\\t"),
            _ => o.push(c),
        }
    }
    o.push('"');
    o
}

// The bundled node sidecar, resolved next to our own executable (the same convention main.rs already uses for
// trinityone-cloudflared). Used to run the verifier and to read local wall-clock time.
fn node_sidecar_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let name = if cfg!(windows) {
        "trinityone-relay-node.exe"
    } else {
        "trinityone-relay-node"
    };
    Some(dir.join(name))
}

// The build identity read from INSIDE a verified bundle (its signed version.txt): the 40-hex git sha and the ISO
// commit date. [AUDIT be258b42 HIGH 2] This — never READY or suite-latest.json, which nobody signs — is what every
// "is this newer?", quarantine and installed-identity decision uses.
#[derive(Debug, Clone, PartialEq, Eq)]
struct SignedId {
    sha: String,
    date: String,
}

// Read the verifier's stdout line {"sha":"…","date":"…"}. PURE. None unless both are present and well-formed.
fn parse_signed_id(stdout: &str) -> Option<SignedId> {
    let sha = json_str_value(stdout, "sha")?;
    let date = json_str_value(stdout, "date")?;
    if sha.len() != 40 || !sha.chars().all(|c| c.is_ascii_hexdigit()) || parse_instant(&date).is_none() {
        return None;
    }
    Some(SignedId { sha, date })
}

// Authoritatively verify a retained/staged tarball against the READ-ONLY payload verifier + key, and return the
// identity INSIDE the verified bytes. The verifier (scripts/verify-suite-bundle.mjs) and the pinned
// release-pubkey.pem are ALWAYS taken from `payload`, never from a (writable) override, so a tampered active/
// cannot supply its own verifier or key. Exit 0 + a well-formed identity line = good; anything else = None.
fn verify_tarball(node: &Path, payload: &Path, tgz: &Path, sig: &Path, log: &Path) -> Option<SignedId> {
    let verifier = payload.join("scripts").join("verify-suite-bundle.mjs");
    let key = payload.join("relay-app").join("release-pubkey.pem");
    match std::process::Command::new(node)
        .arg(&verifier)
        .arg(tgz)
        .arg(sig)
        .arg(&key)
        .stdin(Stdio::null())
        .stderr(Stdio::piped())
        .output()
    {
        Ok(o) if o.status.success() => {
            let id = parse_signed_id(&String::from_utf8_lossy(&o.stdout));
            if id.is_none() {
                applog(log, "suite: verifier passed but printed no usable identity; refusing");
            }
            id
        }
        Ok(o) => {
            applog(log, &format!(
                "suite: verify refused {tgz:?} ({:?}): {}",
                o.status.code(),
                String::from_utf8_lossy(&o.stderr).trim()
            ));
            None
        }
        Err(e) => {
            applog(log, &format!("suite: verifier spawn failed: {e}"));
            None
        }
    }
}

// Seconds since the Unix epoch, from the system clock (no timezone needed — instants only).
fn now_epoch() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// How far ahead of this computer's clock a signed build date may be. A release is dated by its commit, which is
// in the past; a day covers clock skew. Anything later is refused, so a bogus far-future date can never become
// the installed floor and freeze every later update (audit HIGH 2, "freeze all updates for good").
const MAX_FUTURE_SKEW_SECS: i64 = 86_400;

// The anti-rollback floor: the later of the shipped payload's own date and the recorded installed date. PURE. An
// installedDate that is itself beyond the future-skew bound is IGNORED (it could only have come from a bad
// record), so a stale far-future record cannot freeze updates either.
fn anti_rollback_floor(payload_date: &str, installed_date: &str, now: i64) -> String {
    let installed_sane = parse_instant(installed_date)
        .map(|t| t <= now + MAX_FUTURE_SKEW_SECS)
        .unwrap_or(false);
    if installed_sane && date_after(installed_date, payload_date) {
        installed_date.to_string()
    } else {
        payload_date.to_string()
    }
}

// PURE accept/refuse for a VERIFIED bundle, using only its signed identity. Err(reason) on refusal:
//   "sha-mismatch" — the signed sha is not the one staged as READY (what the relay said it downloaded);
//   "future-date"  — the signed date is beyond the clock-skew bound;
//   "not-newer"    — the signed date is not strictly after the floor (anti-rollback / downgrade floor).
fn signed_bundle_verdict(signed: &SignedId, ready_sha: &str, floor: &str, now: i64) -> Result<(), &'static str> {
    if signed.sha != ready_sha {
        return Err("sha-mismatch");
    }
    match parse_instant(&signed.date) {
        Some(t) if t > now + MAX_FUTURE_SKEW_SECS => return Err("future-date"),
        Some(_) => {}
        None => return Err("not-newer"),
    }
    if !date_after(&signed.date, floor) {
        return Err("not-newer");
    }
    Ok(())
}

// Does the unpacked override tree match the tarball it was unpacked from? [audit M1] Only the tarball is signed;
// the folder that RUNS can be damaged afterwards (antivirus removing a file, a rename that failed mid-swap). A
// cheap identity check: its version.txt names the signed sha, and the two files every Suite bundle has exist.
fn active_tree_matches(dir: &Path, signed: &SignedId) -> bool {
    let v = std::fs::read_to_string(dir.join("version.txt")).unwrap_or_default();
    v.lines().next().map(|l| l.trim() == signed.sha).unwrap_or(false)
        && dir.join("scripts").join("gateway.mjs").is_file()
        && dir.join("release-origin").is_file()
}

// Remove the override and everything that could bring it back at a launch (active/, its retained tarball, and
// the last-good set). Used when it is obsolete (a newer Suite was installed) or would not start.
fn retire_override(suite_dir: &Path, log: &Path) {
    for d in ["active", "active.new", "last-good"] {
        let _ = std::fs::remove_dir_all(suite_dir.join(d));
    }
    for f in ["active.tgz", "active.sig", "last-good.tgz", "last-good.sig"] {
        let _ = std::fs::remove_file(suite_dir.join(f));
    }
    applog(log, "suite: override retired (active/, its tarball and last-good removed)");
}

// What the launch decided: the tree to run, and — when it is the override — its signed identity.
struct LaunchChoice {
    dir: PathBuf,
    signed: Option<SignedId>,
}

// EVERY LAUNCH: which tree the relay starts from (I/O around the pure launch_pick). Verifies active.tgz with the
// READ-ONLY payload verifier + key, compares its SIGNED date with the payload's own version.txt date, honours the
// auto-update switch (the `suite-autoupdate` marker in `data_dir`), and for an override that will run checks the
// unpacked tree against the signed identity, re-extracting it from the verified tarball if it does not match.
// Anything that fails is the baked-in payload.
fn launch_code_dir(payload: &Path, suite_dir: &Path, data_dir: &Path, node: Option<&Path>, log: &Path) -> LaunchChoice {
    let shipped = LaunchChoice { dir: payload.to_path_buf(), signed: None };
    let active_dir = suite_dir.join("active");
    let active_tgz = suite_dir.join("active.tgz");
    let active_sig = suite_dir.join("active.sig");
    if !active_tgz.exists() && !active_dir.exists() {
        applog(log, "launch: running baked-in payload (no update applied)");
        return shipped;
    }
    let signed = match node {
        Some(n) if active_tgz.exists() && active_sig.exists() => verify_tarball(n, payload, &active_tgz, &active_sig, log),
        _ => None,
    };
    let enabled = data_dir.join("suite-autoupdate").exists();
    match launch_pick(enabled, signed.as_ref(), &read_version_date(payload)) {
        LaunchPick::Payload => {
            applog(log, &format!(
                "launch: running baked-in payload ({})",
                if signed.is_none() { "override not verifiable" } else { "auto-update is off" }
            ));
            shipped
        }
        LaunchPick::Retire => {
            applog(log, "launch: the installed Suite is as new as or newer than the downloaded update; running it and retiring the update");
            retire_override(suite_dir, log);
            shipped
        }
        LaunchPick::Active => {
            let id = signed.expect("Active implies a signed identity");
            if !active_tree_matches(&active_dir, &id) {
                // [audit M1] Re-extract the folder from the verified tarball rather than run a damaged one.
                applog(log, "launch: suite/active does not match its signed tarball; re-extracting it");
                let fresh = suite_dir.join("active.new");
                let _ = std::fs::remove_dir_all(&fresh);
                let ok = std::fs::create_dir_all(&fresh).is_ok()
                    && untar(&active_tgz, &fresh, log)
                    && active_tree_matches(&fresh, &id)
                    && {
                        let _ = std::fs::remove_dir_all(&active_dir);
                        rename_retry(&fresh, &active_dir, log).is_ok()
                    };
                if !ok {
                    let _ = std::fs::remove_dir_all(&fresh);
                    applog(log, "launch: could not repair suite/active; running baked-in payload");
                    return shipped;
                }
            }
            applog(log, &format!("launch: running activated override (suite/active, {})", short_sha(&id.sha)));
            LaunchChoice { dir: active_dir, signed: Some(id) }
        }
    }
}

// Local wall-clock, via the bundled node (the Rust std has no timezone-aware local time and we add no crate):
// minutes-of-day, today's and yesterday's "YYYY-MM-DD" in the machine's local time — the clock the operator set
// HH:MM in — and epoch seconds. Called only once an apply is actually plausible (marker on AND a bundle staged),
// so it is not a hot path.
fn local_now(node: &Path) -> Option<LocalNow> {
    let out = std::process::Command::new(node)
        .arg("-e")
        .arg("const p=n=>String(n).padStart(2,'0');const f=d=>d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());const n=Date.now();const d=new Date(n);const y=new Date(d.getFullYear(),d.getMonth(),d.getDate()-1);process.stdout.write((d.getHours()*60+d.getMinutes())+' '+f(d)+' '+f(y)+' '+Math.floor(n/1000))")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout);
    let mut it = s.split_whitespace();
    let min: u32 = it.next()?.parse().ok()?;
    let today = it.next()?.to_string();
    let yesterday = it.next()?.to_string();
    let epoch: i64 = it.next()?.parse().ok()?;
    Some(LocalNow { min, today, yesterday, epoch })
}

// PURE env assembly for a relay launch (cargo-testable). `code_dir` is the tree the relay's cwd will be set
// to (payload OR an activated override); it is deliberately NOT what PAYLOAD_DIR points at.
//
// [P3-AUDIT — HIGH, trust root] PAYLOAD_DIR is ALWAYS the read-only `payload`, independent of `code_dir`. The
// relay resolves its verifier + pinned release-pubkey.pem from PAYLOAD_DIR || ROOT; when launching an override,
// ROOT (cwd) is the writable active/ dir, so if PAYLOAD_DIR were omitted — or set to code_dir — the override
// would silently become its own trust root. The test `override_env_payload_dir_is_payload` goes red if this
// line is weakened. The rest matches the original single-spawn site exactly.
//
// RELAY_HOST is decided HERE, from the `lan-access` marker in `data_dir` (bind_host::relay_bind_host), so every
// launch path — first start, apply respawn, rollback respawn, and the apply harness's TestHost — gets it from the
// same place. (Moved here from spawn_relay 2026-11-13, behaviour unchanged, so it can be tested.)
fn relay_env(
    _code_dir: &Path,
    payload: &Path,
    data_dir: &Path,
    cloudflared: &str,
) -> Vec<(String, String)> {
    let relay_host = bind_host::relay_bind_host(data_dir);
    vec![
        ("TRINITY_DATA_DIR".into(), data_dir.to_string_lossy().to_string()),
        // the bundled cloudflared, so the relay can start a Cloudflare quick tunnel ("go public") itself
        ("CLOUDFLARED_BIN".into(), cloudflared.to_string()),
        // BIND ADDRESS: loopback by default; 0.0.0.0 only when the operator opted into LAN access.
        ("RELAY_HOST".into(), relay_host.to_string()),
        // the Tauri window IS the control UI; don't also open a browser.
        ("RELAY_NO_OPEN".into(), "1".into()),
        // Trust root — ALWAYS the read-only payload, in BOTH launch modes. See the doc above.
        ("PAYLOAD_DIR".into(), payload.to_string_lossy().to_string()),
    ]
}

// Spawn the relay sidecar from `code_dir`, wiring a FRESH stdout/stderr pump and an alive-flag the pump clears
// when the child exits (CommandEvent::Terminated, or the event channel closing). Returns that alive-flag so the
// controller can wait for a clean stop before any swap/rebind. The child is parked in the Tauri-managed Relay
// slot so the window-close handler still reaps whichever child is current.
//
// [P3-AUDIT — HIGH, trust root] PAYLOAD_DIR is set to the READ-ONLY payload in BOTH launch modes. The relay
// resolves its verifier + pinned release-pubkey.pem from PAYLOAD_DIR || ROOT; when launching an override, ROOT
// is the writable active/ dir, so omitting PAYLOAD_DIR would silently make the override its own trust root.
// When launching the payload itself PAYLOAD_DIR == ROOT, which is correct and harmless. All other env matches
// the original single-spawn site (TRINITY_DATA_DIR, CLOUDFLARED_BIN, RELAY_HOST, RELAY_NO_OPEN).
fn spawn_relay(
    app: &AppHandle,
    code_dir: &Path,
    payload: &Path,
    data_dir: &Path,
    log: &Path,
) -> Option<Arc<AtomicBool>> {
    let cmd = match app.shell().sidecar("trinityone-relay-node") {
        Ok(c) => c,
        Err(e) => {
            applog(log, &format!("SIDECAR RESOLVE FAILED: {e}"));
            return None;
        }
    };
    let cloudflared = std::env::current_exe()
        .ok()
        .and_then(|p| {
            p.parent().map(|d| {
                d.join(if cfg!(windows) {
                    "trinityone-cloudflared.exe"
                } else {
                    "trinityone-cloudflared"
                })
            })
        })
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "cloudflared".into());
    let mut cmd = cmd
        .current_dir(code_dir.to_path_buf())
        .arg("scripts/gateway.mjs")
        .arg(PORT.to_string());
    for (k, v) in relay_env(code_dir, payload, data_dir, &cloudflared) {
        cmd = cmd.env(k, v);
    }
    match cmd.spawn() {
        Ok((mut rx, child)) => {
            applog(log, &format!("sidecar spawned OK (cwd={code_dir:?})"));
            *app.state::<Relay>().0.lock().unwrap() = Some(child);
            let alive = Arc::new(AtomicBool::new(true));
            let alive2 = alive.clone();
            let lp = log.to_path_buf();
            tauri::async_runtime::spawn(async move {
                while let Some(ev) = rx.recv().await {
                    match ev {
                        CommandEvent::Stdout(b) => {
                            applog(&lp, &format!("[out] {}", String::from_utf8_lossy(&b).trim_end()))
                        }
                        CommandEvent::Stderr(b) => {
                            applog(&lp, &format!("[err] {}", String::from_utf8_lossy(&b).trim_end()))
                        }
                        CommandEvent::Error(e) => applog(&lp, &format!("[error] {e}")),
                        CommandEvent::Terminated(t) => {
                            applog(&lp, &format!("[exit] {t:?}"));
                            alive2.store(false, Ordering::SeqCst);
                        }
                        _ => {}
                    }
                }
                // Channel closed → no more events will come → the child is gone.
                alive2.store(false, Ordering::SeqCst);
            });
            Some(alive)
        }
        Err(e) => {
            applog(log, &format!("SPAWN FAILED: {e}"));
            None
        }
    }
}

// Is the relay port currently accepting connections?
fn port_reachable() -> bool {
    TcpStream::connect(("127.0.0.1", PORT)).is_ok()
}

// Wait until the port accepts connections (relay is up), or the timeout elapses.
fn wait_port_up(timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if port_reachable() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(Duration::from_millis(250));
    }
}

// After kill(), wait for BOTH the pid to be gone (the pump cleared the alive-flag on Terminated / channel
// close) AND the port to be free. CommandChild::kill() returns before the async exit, so this guards against a
// Windows file lock on the old node and against EADDRINUSE on the restart.
fn wait_stopped(alive: &Arc<AtomicBool>, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if !alive.load(Ordering::SeqCst) && !port_reachable() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(Duration::from_millis(200));
    }
}

// Unpack a .tgz into dest using the system tar (bsdtar on Windows 10 1803+, GNU/BSD tar on mac/Linux). The
// bundle is produced with a leading "./" (build-suite-js-bundle.sh) so this lands scripts/ etc. at dest root.
fn untar(tgz: &Path, dest: &Path, log: &Path) -> bool {
    match std::process::Command::new("tar")
        .arg("-xzf")
        .arg(tgz)
        .arg("-C")
        .arg(dest)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
    {
        Ok(s) if s.success() => true,
        Ok(s) => {
            applog(log, &format!("suite: tar exited {s:?}"));
            false
        }
        Err(e) => {
            applog(log, &format!("suite: tar spawn failed: {e}"));
            false
        }
    }
}

// Rename with a short retry window (Windows may briefly lock a just-released file).
fn rename_retry(from: &Path, to: &Path, log: &Path) -> std::io::Result<()> {
    let mut last = std::fs::rename(from, to);
    let mut tries = 0;
    while last.is_err() && tries < 20 {
        thread::sleep(Duration::from_millis(100));
        last = std::fs::rename(from, to);
        tries += 1;
    }
    if let Err(ref e) = last {
        applog(log, &format!("suite: rename {from:?} -> {to:?} failed: {e}"));
    }
    last
}

// Atomic file write (temp + rename), so a reader never sees a half-written state.json / quarantine-sha.
fn write_file_atomic(path: &Path, contents: &str, log: &Path) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, contents)?;
    let r = std::fs::rename(&tmp, path);
    if let Err(ref e) = r {
        applog(log, &format!("suite: finalise {path:?} failed: {e}"));
    }
    r
}

// What state.json records (GET /update reads it for the control panel). installed* is the override the Suite is
// running or will run at the next start (empty = the shipped payload); lastApplied is the window day of the last
// attempt; lastOutcome is "applied" / "applied-store-degraded" / "rolledback" / "launch-failed"; lastReason
// says why in plain words; autoOff is true when this shell switched auto-update off after a failure.
struct StateRec<'a> {
    sha: &'a str,
    version: &'a str,
    date: &'a str,
    last_applied: &'a str,
    outcome: &'a str,
    reason: &'a str,
    auto_off: bool,
}

fn write_state(suite_dir: &Path, r: &StateRec, log: &Path) {
    let json = format!(
        "{{\"installedSha\":{},\"installedVersion\":{},\"installedDate\":{},\"lastApplied\":{},\"lastOutcome\":{},\"lastReason\":{},\"autoOff\":{}}}\n",
        jstr(r.sha),
        jstr(r.version),
        jstr(r.date),
        jstr(r.last_applied),
        jstr(r.outcome),
        jstr(r.reason),
        if r.auto_off { "true" } else { "false" },
    );
    let _ = write_file_atomic(&suite_dir.join("state.json"), &json, log);
}

// [audit M7] After a failed update the shell switches auto-update OFF (the design note: "a rollback should
// switch it off and say so"): it removes the `suite-autoupdate` marker — the shell's only read of the setting —
// and the relay, which is restarted right after, reads the marker's absence as "off" (gateway.mjs loadSettings).
fn switch_auto_update_off(data_dir: &Path, log: &Path) {
    match std::fs::remove_file(data_dir.join("suite-autoupdate")) {
        Ok(_) => applog(log, "suite: auto-update switched OFF after a failed update"),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => applog(log, &format!("suite: could not switch auto-update off: {e}")),
    }
}

// Remove the staged bundle so a failed/consumed bundle is never reconsidered.
fn discard_staging(suite_dir: &Path) {
    let staging = suite_dir.join("staging");
    let _ = std::fs::remove_file(staging.join("READY"));
    let _ = std::fs::remove_file(staging.join("bundle.tgz"));
    let _ = std::fs::remove_file(staging.join("bundle.sig"));
}

// Health probe (I/O): poll public GET /status within the window and report the four facts health_outcome
// needs — (reachable, version_match, ok, degraded_storage). "version" must equal the SIGNED sha of the bundle we
// activated: the gateway reports BUILD.sha, which it reads from the same signed version.txt, so a match proves
// the code answering is the code we verified (audit HIGH 2 — the unsigned READY label no longer counts).
// `degraded_storage` is read from the `what` field of gateway.mjs's `degraded` object — emitted ONLY when
// STORE_DEGRADED, and then always `"storage"`; it is the only `what` key in /status.
// Returns as soon as it sees a fully-healthy state (version match + ok:true) so a clean apply is not labelled
// degraded over a transient blip; otherwise reports the best facts observed up to the deadline.
fn health_probe(signed_sha: &str, timeout: Duration) -> (bool, bool, bool, bool) {
    let deadline = Instant::now() + timeout;
    let mut reachable = false;
    let mut version_match = false;
    let mut degraded_storage = false;
    loop {
        if let Some(body) = http_get_loopback("/status", None) {
            reachable = true;
            let v_match = json_str_value(&body, "version")
                .map(|v| !signed_sha.is_empty() && v == signed_sha)
                .unwrap_or(false);
            if v_match {
                version_match = true;
                if json_bool_true(&body, "ok") {
                    // Fully healthy — the best possible verdict; stop here.
                    return (true, true, true, false);
                }
                // ok:false → is the sole reported degradation a storage one?
                degraded_storage =
                    json_str_value(&body, "what").map(|w| w == "storage").unwrap_or(false);
            }
        }
        if Instant::now() >= deadline {
            return (reachable, version_match, false, degraded_storage);
        }
        thread::sleep(Duration::from_millis(500));
    }
}

// Point the control window at the (freshly-served) app again after a swap.
fn reload_webview(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("control") {
        if let Ok(u) = format!("http://127.0.0.1:{PORT}/relay-app/home.html").parse() {
            let _ = win.navigate(u);
        }
    }
}

// ── Relay process host (apply seam) ─────────────────────────────────────────────────────────────
// The apply orchestration (maybe_apply / attempt_apply / spawn_and_wait / rollback_and_restart) needs exactly
// three capabilities from the Tauri shell: spawn the relay child (parking it in the managed Relay slot), stop
// the current child, and point the control webview at the freshly-served app. Those three are the ONLY coupling
// to AppHandle. Factoring them behind this trait lets the end-to-end apply harness drive the REAL orchestration
// against a REAL `node scripts/gateway.mjs` child with no Tauri runtime, while production keeps byte-identical
// behaviour through TauriHost — which delegates spawn/reload to the UNCHANGED spawn_relay / reload_webview free
// fns and keeps the exact take+kill the apply path used inline at its two stop points. This is a pure seam: it
// moves no verify, anti-rollback, swap or health decision — those all stay in attempt_apply.
trait RelayHost {
    fn spawn_relay(&self, code_dir: &Path, payload: &Path, data_dir: &Path, log: &Path) -> Option<Arc<AtomicBool>>;
    fn stop_relay(&self);
    fn reload_webview(&self);
}

// Production host: delegates verbatim to the existing free fns + the existing Relay-slot kill.
struct TauriHost {
    app: AppHandle,
}

impl RelayHost for TauriHost {
    fn spawn_relay(&self, code_dir: &Path, payload: &Path, data_dir: &Path, log: &Path) -> Option<Arc<AtomicBool>> {
        spawn_relay(&self.app, code_dir, payload, data_dir, log)
    }
    fn stop_relay(&self) {
        if let Some(child) = self.app.state::<Relay>().0.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
    fn reload_webview(&self) {
        reload_webview(&self.app);
    }
}

// The payload's own build date (version.txt line 2 = git %cI), for the anti-rollback floor. Empty on an
// unstamped working tree ($Format…) — treated by date_after as "nothing to beat".
fn read_version_date(payload: &Path) -> String {
    match std::fs::read_to_string(payload.join("version.txt")) {
        Ok(s) => s.lines().nth(1).map(|x| x.trim().to_string()).unwrap_or_default(),
        Err(_) => String::new(),
    }
}

// Everything the apply/launch orchestration needs, bundled so the harness can drive the REAL functions: the relay
// host seam, the four paths, the node sidecar (verify + clock), and the clock itself (injected so a test can say
// "it is 14:00" without waiting for 14:00; production passes local_now on the node sidecar).
struct ApplyEnv<'a> {
    host: &'a dyn RelayHost,
    suite_dir: &'a Path,
    payload: &'a Path,
    data_dir: &'a Path,
    log: &'a Path,
    node: Option<&'a Path>,
    clock: &'a dyn Fn() -> Option<LocalNow>,
}

// What is running now: the code dir, the alive-flag of the current child (cleared by the pump when it exits),
// and the stop-timeout back-off.
struct RunState {
    code_dir: PathBuf,
    alive: Arc<AtomicBool>,
    cooldown_until: Option<Instant>,
}

// Spawn the relay from `dir`, record it as current, and wait for the port. Returns whether it came up. Shared by
// startup, apply-start, recover and rollback.
fn spawn_and_wait(env: &ApplyEnv, st: &mut RunState, dir: &Path) -> bool {
    st.code_dir = dir.to_path_buf();
    match env.host.spawn_relay(dir, env.payload, env.data_dir, env.log) {
        Some(a) => {
            st.alive = a;
            wait_port_up(Duration::from_secs(45))
        }
        None => false,
    }
}

// Shared rollback-and-restart: restore active/ to last-good (or the baked-in payload), restart there, reload the
// webview, record a "rolledback" state that keeps the PREVIOUS installed identity, and switch auto-update off
// (audit M7). ASSUMES the relay is already stopped. Keeps the church ONLINE on known-good code. Does NOT write
// quarantine — the caller decides that, since a retain failure is a local-disk problem, not a bad bundle.
fn rollback_and_restart(env: &ApplyEnv, st: &mut RunState, prev_state_raw: &str, day: &str, reason: &str) {
    let suite_dir = env.suite_dir;
    let active = suite_dir.join("active");
    let last_good = suite_dir.join("last-good");
    let dir = match rollback_target(false, last_good.exists()) {
        RollbackTarget::LastGood => {
            let _ = std::fs::remove_dir_all(&active);
            let _ = rename_retry(&last_good, &active, env.log);
            let _ = std::fs::remove_file(suite_dir.join("active.tgz"));
            let _ = std::fs::remove_file(suite_dir.join("active.sig"));
            let _ = rename_retry(&suite_dir.join("last-good.tgz"), &suite_dir.join("active.tgz"), env.log);
            let _ = rename_retry(&suite_dir.join("last-good.sig"), &suite_dir.join("active.sig"), env.log);
            active.clone()
        }
        RollbackTarget::Payload | RollbackTarget::Keep => {
            let _ = std::fs::remove_dir_all(&active);
            let _ = std::fs::remove_file(suite_dir.join("active.tgz"));
            let _ = std::fs::remove_file(suite_dir.join("active.sig"));
            env.payload.to_path_buf()
        }
    };
    switch_auto_update_off(env.data_dir, env.log);
    spawn_and_wait(env, st, &dir);
    env.host.reload_webview();
    // Keep the previous installed identity (we reverted); mark lastApplied so a bad bundle isn't retried in this
    // window, and record the rollback + why for the UI.
    let prev_sha = json_str_value(prev_state_raw, "installedSha").unwrap_or_default();
    let prev_ver = json_str_value(prev_state_raw, "installedVersion").unwrap_or_default();
    let prev_date = json_str_value(prev_state_raw, "installedDate").unwrap_or_default();
    write_state(suite_dir, &StateRec {
        sha: &prev_sha, version: &prev_ver, date: &prev_date, last_applied: day,
        outcome: "rolledback", reason, auto_off: true,
    }, env.log);
    discard_staging(suite_dir);
}

// The staged bundle, if there is one and the switch is on: (READY version label, READY sha, READY mtime epoch,
// the HH:MM target in minutes, the marker text). None = nothing to do.
fn staged_and_enabled(env: &ApplyEnv) -> Option<(String, String, i64, u32, String)> {
    let at_raw = std::fs::read_to_string(env.data_dir.join("suite-autoupdate")).ok()?; // not enabled → None
    let target_min = parse_hhmm(&at_raw).unwrap_or(180); // default 03:00, matching the relay default
    // Anything staged? (P3 may leave an unverified .tmp with no READY after a crash — we act only on READY.)
    let ready_path = env.suite_dir.join("staging").join("READY");
    let ready_raw = std::fs::read_to_string(&ready_path).ok()?;
    let staged_epoch = std::fs::metadata(&ready_path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(i64::MAX);
    let r_version = json_str_value(&ready_raw, "version").unwrap_or_default();
    let r_sha = json_str_value(&ready_raw, "sha").unwrap_or_default();
    if r_sha.is_empty() {
        applog(env.log, "suite: staged READY missing sha; discarding");
        discard_staging(env.suite_dir);
        return None;
    }
    Some((r_version, r_sha, staged_epoch, target_min, at_raw.trim().to_string()))
}

// THE CONTROLLER TICK (about once a minute while the Suite runs). Applies a staged update only INSIDE the
// operator's window and once per window [audit H1]. Called OUTSIDE the keep-awake-off / token early-continues so
// turning keep-awake off never disables auto-update.
fn maybe_apply(env: &ApplyEnv, st: &mut RunState) {
    // [AUDIT FIX #3] After a stop-timeout we back off (see attempt_apply).
    if !cooldown_elapsed(Instant::now(), st.cooldown_until) {
        return;
    }
    let Some((r_version, r_sha, _staged, target_min, at)) = staged_and_enabled(env) else { return };
    if env.node.is_none() {
        applog(env.log, "suite: apply gate — node sidecar not found; cannot verify/apply");
        return;
    }
    let Some(now) = (env.clock)() else { return };
    let state_raw = std::fs::read_to_string(env.suite_dir.join("state.json")).unwrap_or_default();
    let last_applied = json_str_value(&state_raw, "lastApplied").unwrap_or_default();
    if !due(&now, target_min, &last_applied) {
        return;
    }
    let day = window_day(&now, target_min).to_string();
    applog(env.log, &format!("suite: inside the apply window ({at}, now {}min); applying staged {r_version}", now.min));
    attempt_apply(env, st, &r_version, &r_sha, &state_raw, &day);
}

// EVERY START of the Suite, before the relay first runs. (1) Choose the code tree (launch_code_dir: H3 + the
// M1 tree repair). (2) If an update is waiting and its window is open now, or was missed while the computer was
// off or asleep, apply it now — the relay is not running yet, so nobody is cut off (owner decision Q3). (3)
// Start the relay if the apply did not, and when it is the override, confirm it really comes up and identifies
// as the signed build; if not, return to the shipped code, retire the override and switch auto-update off
// (audit M1 — "the relay stays down on every launch").
fn startup(env: &ApplyEnv) -> RunState {
    let choice = launch_code_dir(env.payload, env.suite_dir, env.data_dir, env.node, env.log);
    let mut st = RunState {
        code_dir: choice.dir.clone(),
        alive: Arc::new(AtomicBool::new(false)), // nothing is running yet
        cooldown_until: None,
    };
    if let (Some((r_version, r_sha, staged, target_min, _)), Some(_)) = (staged_and_enabled(env), env.node) {
        if let Some(now) = (env.clock)() {
            let state_raw = std::fs::read_to_string(env.suite_dir.join("state.json")).unwrap_or_default();
            let last_applied = json_str_value(&state_raw, "lastApplied").unwrap_or_default();
            if due(&now, target_min, &last_applied) || missed_window(&now, target_min, staged, &last_applied) {
                let day = window_day(&now, target_min).to_string();
                applog(env.log, &format!("launch: an update ({r_version}) was waiting for a window this computer missed or is in; applying it before starting"));
                attempt_apply(env, &mut st, &r_version, &r_sha, &state_raw, &day);
            }
        }
    }
    if st.alive.load(Ordering::SeqCst) {
        return st; // the apply (or its rollback) already started the relay and health-checked it
    }
    let dir = st.code_dir.clone();
    let up = spawn_and_wait(env, &mut st, &dir);
    if let Some(id) = choice.signed.as_ref().filter(|_| dir == choice.dir) {
        let (reachable, version_match, _, _) = if up {
            health_probe(&id.sha, Duration::from_secs(30))
        } else {
            (false, false, false, false)
        };
        if !(reachable && version_match) {
            applog(env.log, &format!(
                "launch: the downloaded update did not come up (port={up} reachable={reachable} version_match={version_match}); returning to the shipped code"
            ));
            env.host.stop_relay();
            let _ = wait_stopped(&st.alive, Duration::from_secs(20));
            retire_override(env.suite_dir, env.log);
            switch_auto_update_off(env.data_dir, env.log);
            let prev_raw = std::fs::read_to_string(env.suite_dir.join("state.json")).unwrap_or_default();
            let la = json_str_value(&prev_raw, "lastApplied").unwrap_or_default();
            write_state(env.suite_dir, &StateRec {
                sha: "", version: "", date: "", last_applied: &la, outcome: "launch-failed",
                reason: "the downloaded update would not start, so the Suite went back to the version it came with",
                auto_off: true,
            }, env.log);
            let payload = env.payload.to_path_buf();
            spawn_and_wait(env, &mut st, &payload);
            env.host.reload_webview();
        }
    }
    st
}

// The 8-step apply, fail-closed at every step. Any failure leaves the Suite running a known-good tree (the one it
// was already running, last-good, or the baked-in payload) and never leaves a half-applied active/. When called
// from startup nothing is running yet: the stop is then a no-op and every abort path that would "restart the
// current code" leaves that to startup.
fn attempt_apply(env: &ApplyEnv, st: &mut RunState, r_version: &str, r_sha: &str, prev_state_raw: &str, day: &str) {
    let (suite_dir, payload, log) = (env.suite_dir, env.payload, env.log);
    let node = match env.node {
        Some(n) => n,
        None => return,
    };
    let staging = suite_dir.join("staging");
    let s_tgz = staging.join("bundle.tgz");
    let s_sig = staging.join("bundle.sig");
    let was_running = st.alive.load(Ordering::SeqCst);
    // Restart whatever was running before (only if something was).
    let restart_prev = |st: &mut RunState| {
        if was_running {
            let prev = st.code_dir.clone();
            spawn_and_wait(env, st, &prev);
        }
    };

    // 1. Authoritatively re-verify the staged tarball (don't trust READY alone). Payload verifier + key. The
    //    identity used from here on is the one INSIDE the signed bytes (audit HIGH 2) — READY is only a hint.
    let signed = if s_tgz.exists() && s_sig.exists() {
        verify_tarball(node, payload, &s_tgz, &s_sig, log)
    } else {
        None
    };
    let signed = match signed {
        Some(id) => id,
        None => {
            applog(log, "suite: APPLY aborted — staged bundle failed signature verify; discarding staging");
            discard_staging(suite_dir);
            return;
        }
    };

    // 2. Anti-rollback, from the SIGNED identity: it must be what READY named, not dated in the future, and
    //    strictly after MAX(payload date, installed date) by INSTANT.
    let installed_date = json_str_value(prev_state_raw, "installedDate").unwrap_or_default();
    let now = now_epoch();
    let floor = anti_rollback_floor(&read_version_date(payload), &installed_date, now);
    if let Err(why) = signed_bundle_verdict(&signed, r_sha, &floor, now) {
        applog(log, &format!(
            "suite: APPLY aborted — {why} (signed {} {} vs READY {r_sha}, floor {floor}); discarding",
            short_sha(&signed.sha), signed.date
        ));
        discard_staging(suite_dir);
        return;
    }
    let r_sha: &str = &signed.sha;
    let r_date: &str = &signed.date;

    // 3. Quarantine: a sha that already failed health is never auto-applied again.
    let q = std::fs::read_to_string(suite_dir.join("quarantine-sha")).unwrap_or_default();
    if q.trim() == r_sha {
        applog(log, "suite: APPLY aborted — staged sha is quarantined; discarding staging");
        discard_staging(suite_dir);
        return;
    }

    // 4. Stop the relay and confirm it is fully down (pid gone AND port free) before touching active/.
    applog(log, "suite: stopping relay for code swap");
    env.host.stop_relay();
    if !wait_stopped(&st.alive, Duration::from_secs(20)) {
        // [AUDIT FIX #3] Back off before retrying so we don't kill→20s-wait→respawn every ~60s against a
        // wedged child. The relay never swapped, so restarting prev keeps the church online meanwhile.
        st.cooldown_until = Some(Instant::now() + APPLY_COOLDOWN);
        applog(log, "suite: APPLY aborted — relay did not stop cleanly; restarting current code, keeping staging; backing off apply ~1h");
        let prev = st.code_dir.clone();
        spawn_and_wait(env, st, &prev);
        return;
    }

    // 5. Unpack to active.new, then promote: active -> last-good, active.new -> active (same-fs renames).
    let active = suite_dir.join("active");
    let active_new = suite_dir.join("active.new");
    let last_good = suite_dir.join("last-good");
    let _ = std::fs::remove_dir_all(&active_new);
    if let Err(e) = std::fs::create_dir_all(&active_new) {
        applog(log, &format!("suite: APPLY aborted — mkdir active.new failed: {e}; restarting current"));
        restart_prev(st);
        return;
    }
    if !untar(&s_tgz, &active_new, log) {
        applog(log, "suite: APPLY aborted — unpack failed; restarting current");
        let _ = std::fs::remove_dir_all(&active_new);
        restart_prev(st);
        return;
    }
    // Roll the previous override (if any) to last-good, including its retained verified tarball.
    let _ = std::fs::remove_dir_all(&last_good);
    if active.exists() {
        let _ = rename_retry(&active, &last_good, log);
        let _ = rename_retry(&suite_dir.join("active.tgz"), &suite_dir.join("last-good.tgz"), log);
        let _ = rename_retry(&suite_dir.join("active.sig"), &suite_dir.join("last-good.sig"), log);
    }
    if let Err(e) = rename_retry(&active_new, &active, log) {
        applog(log, &format!("suite: APPLY FAILED at swap ({e}); restoring and restarting"));
        if last_good.exists() && !active.exists() {
            let _ = rename_retry(&last_good, &active, log);
            let _ = rename_retry(&suite_dir.join("last-good.tgz"), &suite_dir.join("active.tgz"), log);
            let _ = rename_retry(&suite_dir.join("last-good.sig"), &suite_dir.join("active.sig"), log);
        }
        if was_running {
            // Restart what was running; if that was the override and it could not be put back, the payload.
            let dir = if st.code_dir == active && !active.exists() { payload.to_path_buf() } else { st.code_dir.clone() };
            spawn_and_wait(env, st, &dir);
        }
        return;
    }
    // The retained verified tarball the next launch re-checks against the payload key. [AUDIT FIX #4] A copy
    // failure is FATAL to the apply: active/ is the new code, so a missing/partial active.(tgz,sig) would make
    // the NEXT launch verify a stale or absent pair and silently fall back — active/ and its retained tarball
    // must never disagree. The relay is still stopped here (step 6 hasn't run), so roll back and restart on
    // known-good code. NOT quarantined: the bundle is fine, only this box's local copy failed.
    if std::fs::copy(&s_tgz, suite_dir.join("active.tgz")).is_err()
        || std::fs::copy(&s_sig, suite_dir.join("active.sig")).is_err()
    {
        applog(log, "suite: APPLY FAILED — could not retain active.(tgz,sig); rolling back to last-good/payload");
        rollback_and_restart(env, st, prev_state_raw, day, "this computer could not keep a copy of the update");
        applog(log, "suite: rollback complete (retain failure)");
        return;
    }

    // 6. Start from active/ (PAYLOAD_DIR=payload via spawn_relay), reload the webview.
    applog(log, "suite: starting relay from active/ (override)");
    let came_up = spawn_and_wait(env, st, &active);
    env.host.reload_webview();

    // 7. Health: probe public /status for reachability, version identity, ok, and whether an ok:false is
    //    SOLELY a degraded store; decide via the pure matrix. [AUDIT FIX #1] A good bundle that boots and
    //    identifies correctly is NOT rolled back/quarantined just because the store is transiently degraded.
    let (reachable, version_match, ok, degraded_storage) = if came_up {
        health_probe(r_sha, Duration::from_secs(45))
    } else {
        (false, false, false, false) // never bound the port → no boot
    };
    match health_outcome(reachable, version_match, ok, degraded_storage) {
        Outcome::Keep { store_degraded } => {
            // 8. Record success and clear staging. The new code booted and identifies as what we activated.
            let outcome = if store_degraded { "applied-store-degraded" } else { "applied" };
            write_state(suite_dir, &StateRec {
                sha: r_sha, version: r_version, date: r_date, last_applied: day, outcome, reason: "", auto_off: false,
            }, log);
            discard_staging(suite_dir);
            let short = short_sha(r_sha);
            if store_degraded {
                applog(log, &format!("suite: APPLY OK (store degraded — kept, not quarantined) — now running {r_version} ({short})"));
            } else {
                applog(log, &format!("suite: APPLY OK — now running {r_version} ({short})"));
            }
        }
        Outcome::Rollback { quarantine } => {
            applog(log, &format!(
                "suite: APPLY health check FAILED (reachable={reachable} version_match={version_match} ok={ok}) — rolling back{}",
                if quarantine { " and quarantining sha" } else { "" }
            ));
            // Quarantine the sha so it is never auto-applied again (always true for a genuine health failure).
            if quarantine {
                let _ = write_file_atomic(&suite_dir.join("quarantine-sha"), &format!("{r_sha}\n"), log);
            }
            // Stop the freshly-started (bad) relay, then roll back and restart on known-good code.
            env.host.stop_relay();
            let _ = wait_stopped(&st.alive, Duration::from_secs(20));
            let why = if !reachable {
                "the update did not start"
            } else if !version_match {
                "the update started but reported the wrong version"
            } else {
                "the update started but reported a problem"
            };
            rollback_and_restart(env, st, prev_state_raw, day, why);
            applog(log, "suite: rollback complete");
        }
    }
}

fn main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Relay(Mutex::new(None)));
    // mac/linux only: the shared slot for the inhibitor child, so CloseRequested can reap it (FINDING 2).
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let builder = builder.manage(Inhibitor(std::sync::Arc::new(Mutex::new(None))));
    builder
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?.join("data");
            std::fs::create_dir_all(&data_dir).ok();
            let log = app.path().app_data_dir()?.join("relay-launch.log");
            let _ = std::fs::remove_file(&log); // fresh log each launch

            // First-ever launch → open the guided setup wizard once; afterwards → the dashboard. (A marker file,
            // since the church identity itself lives in the webview's storage, not something Rust can see.)
            let marker = app.path().app_data_dir()?.join(".setup-shown");
            let first_run = !marker.exists();
            if first_run {
                let _ = std::fs::write(&marker, "1");
            }

            // read-only code payload (bundled resource). Pass the script RELATIVE to a working dir set to the
            // payload, so a space in the install path ("…\TrinityOne Relay\…") can't corrupt the arg.
            let payload = app.path().resource_dir()?.join("payload");
            let gateway_abs = payload.join("scripts").join("gateway.mjs");
            applog(&log, &format!("payload   = {payload:?} (exists={})", payload.exists()));
            applog(&log, &format!("gateway   = {gateway_abs:?} (exists={})", gateway_abs.exists()));
            applog(&log, &format!("data_dir  = {data_dir:?}"));
            applog(&log, &format!("exe       = {:?}", std::env::current_exe()));

            // EVERY LAUNCH: the code choice, a waiting update whose window was missed, and the first spawn all
            // happen in startup(), run first thing on the controller thread below (so a launch-time apply never
            // blocks the window from opening). The window thread just waits for the port, as before.
            let suite_dir = data_dir.join("suite");
            let node = node_sidecar_path();

            // wait for the relay to accept connections, then point the window at its control panel (127.0.0.1,
            // not localhost — on Windows localhost can resolve to IPv6 ::1 while the relay listens on IPv4).
            if let Some(win) = app.get_webview_window("control") {
                let lp = log.clone();
                thread::spawn(move || {
                    let mut up = false;
                    for _ in 0..480 {
                        // up to ~2 min (first run on Windows can be slow: Defender scans the bundled runtime)
                        if TcpStream::connect(("127.0.0.1", PORT)).is_ok() {
                            up = true;
                            break;
                        }
                        thread::sleep(Duration::from_millis(250));
                    }
                    applog(&lp, &format!("port {PORT} reachable = {up}"));
                    // ALWAYS the launcher (home.html), first run included. It asks "What should this computer
                    // do for your church?" and offers the two doors: "Run your church" (the Steward console)
                    // and "Manage a relay" (the control panel).
                    //
                    // First run used to go straight to steward.html, so somebody installing the Suite purely to
                    // run a relay for their church was walked into church setup with no way past it, and only
                    // ever saw the chooser on the SECOND launch. Reported 2026-09-08.
                    //
                    // No mode is passed in the address, deliberately — scripts/suite-two-doors.test.mjs pins
                    // that. Where the church's records live is DETECTED (_boxHostsUs asks this box's /config
                    // whether it holds this church), not declared by the door you came through; declaring it is
                    // what once split one congregation into two halves that could not see each other.
                    // (?relayapp=1 was dropped here 2026-09-08: nothing has read it since the sticky host
                    // marker was deleted — it was inert, like ?setup=1 before it.)
                    let url = format!("http://127.0.0.1:{PORT}/relay-app/home.html");
                    if let Ok(u) = url.parse() {
                        let _ = win.navigate(u);
                    }
                    let _ = win.show();
                });
            }

            // keep-awake controller: every ~15s ask the relay whether it's public and hold/release the
            // OS sleep inhibitor to match. It runs for the life of the process — which is deliberate on
            // Windows, where the inhibitor is per-thread state that evaporates if its thread exits, so it
            // MUST be set and cleared from this same long-lived thread.
            //
            // AUTH: the state endpoints are admin-gated, so each tick we read the admin token the gateway
            // wrote to `<data_dir>/admin.json` and send it as a bearer (see read_admin_token / the comment
            // on http_get_loopback for why this, not loopback trust). No token readable yet (first-launch
            // race, or rotated) → we can't tell, so we defer the tick and log the fact once.
            //
            // OFF-SWITCH CONTRACT: the file `<data_dir>/keep-awake-off` is the operator's opt-out. If it
            // exists we release and never hold the inhibitor (public or not), and skip the network probes
            // entirely; its absence is the default (keep awake while public). Fix C owns writing/removing
            // that marker from the control panel — the path is the same `data_dir` the gateway uses, so
            // both sides agree on where it lives.
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            let inhibitor_slot = app.state::<Inhibitor>().0.clone();
            // Handed to the controller so it can start the relay and drive the auto-update apply: a handle to
            // spawn/kill the relay, the suite + payload dirs, and the node sidecar for verify + local-clock reads.
            let app_ctrl = app.handle().clone();
            let suite_c = suite_dir.clone();
            let payload_c = payload.clone();
            let node_c = node.clone();
            {
                let dd = data_dir.clone();
                let lp = log.clone();
                thread::spawn(move || {
                    // The production RelayHost: wraps this thread's AppHandle clone so the apply path can
                    // spawn/stop the relay child and reload the webview (see TauriHost).
                    let host = TauriHost { app: app_ctrl };
                    let node_for_clock = node_c.clone();
                    let clock = move || node_for_clock.as_deref().and_then(local_now);
                    let env = ApplyEnv {
                        host: &host,
                        suite_dir: &suite_c,
                        payload: &payload_c,
                        data_dir: &dd,
                        log: &lp,
                        node: node_c.as_deref(),
                        clock: &clock,
                    };
                    // FIRST: choose the code tree, apply a missed update, start the relay (see startup).
                    let mut run = startup(&env);
                    let mut ka = KeepAwake::new(
                        #[cfg(any(target_os = "macos", target_os = "linux"))]
                        inhibitor_slot,
                    );
                    let mut held = false;
                    let mut token_warned = false; // log the "no token yet" case once, not every 15s
                    // Throttle the auto-update apply check to ~once a minute (HH:MM is minute-resolution and
                    // apply is once per window); the keep-awake policy below keeps its own 15s cadence.
                    let mut last_apply_eval = Instant::now();
                    loop {
                        // ── SUITE AUTO-UPDATE APPLY ─────────────────────────────────────────────────────
                        // Evaluated at the TOP of the tick, BEFORE the keep-awake-off and token early-continues
                        // below and OUTSIDE any #[cfg] block, so (a) turning keep-awake OFF never also disables
                        // auto-update and (b) the swap/respawn runs on every OS, Windows included. It gates on
                        // its OWN suite-autoupdate marker, reads staging/READY from disk, and health-probes the
                        // PUBLIC /status — no admin token needed. [AUDIT#2 MEDIUM] [AUDIT FIX #4]
                        if last_apply_eval.elapsed() >= Duration::from_secs(60) {
                            last_apply_eval = Instant::now();
                            maybe_apply(&env, &mut run);
                        }
                        // Off-switch FIRST, before any network GET: release if we were holding, then idle.
                        if dd.join("keep-awake-off").exists() {
                            if held {
                                ka.release(&lp);
                                applog(&lp, "keep-awake: released (off-switch)");
                                held = false;
                            }
                            thread::sleep(Duration::from_secs(15));
                            continue;
                        }
                        // Need the admin token to read the gated state endpoints; without it, defer.
                        let token = match read_admin_token(&dd) {
                            Some(t) => {
                                token_warned = false;
                                t
                            }
                            None => {
                                if !token_warned {
                                    applog(&lp, "keep-awake: admin token not readable yet; deferring");
                                    token_warned = true;
                                }
                                thread::sleep(Duration::from_secs(15));
                                continue;
                            }
                        };
                        // Evaluate the Cloudflare tunnel first. If it's already the public path we're
                        // public — and we SKIP /tailscale/state, which spawns 1–3 tailscale CLIs per call.
                        // Only consult the funnel when the tunnel isn't carrying us. (unknown / connect /
                        // timeout → empty body → helpers read false → not public via that path.)
                        let tunnel = http_get_loopback("/tunnel/state", Some(&token)).unwrap_or_default();
                        let tunnel_running = json_bool_true(&tunnel, "running");
                        let tunnel_has_url = json_str_nonempty(&tunnel, "url");
                        let (funnel_on, funnel_has_url) = if tunnel_running && tunnel_has_url {
                            (false, false)
                        } else {
                            let funnel =
                                http_get_loopback("/tailscale/state", Some(&token)).unwrap_or_default();
                            (json_bool_true(&funnel, "funnelOn"), json_str_nonempty(&funnel, "publicUrl"))
                        };
                        // `disabled` already handled above, so pass false here; keeps should_keep_awake pure.
                        let want = should_keep_awake(
                            tunnel_running,
                            tunnel_has_url,
                            funnel_on,
                            funnel_has_url,
                            false,
                        );
                        if want != held {
                            if want {
                                ka.acquire(&lp);
                                applog(&lp, "keep-awake: HELD (public)");
                            } else {
                                ka.release(&lp);
                                applog(&lp, "keep-awake: released");
                            }
                            held = want;
                        }
                        thread::sleep(Duration::from_secs(15));
                    }
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                if let Some(child) = window.state::<Relay>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
                // Reap the sleep-inhibitor child too (FINDING 2): caffeinate / systemd-inhibit is a
                // separate process that would otherwise survive the Suite and keep the machine awake
                // until reboot. Windows has no such child — its ES state is cleared by process exit.
                #[cfg(any(target_os = "macos", target_os = "linux"))]
                if let Some(mut child) = window.state::<Inhibitor>().0.lock().unwrap().take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running TrinityOne Relay");
}

// End-to-end apply harness (P5 keystone): drives the REAL maybe_apply/attempt_apply pipeline against REAL
// signed tarballs and a REAL `node scripts/gateway.mjs` child, through the RelayHost seam. See the file.
#[cfg(test)]
#[path = "apply_harness_test.rs"]
mod apply_harness_test;

// Point-of-use tests for the pure keep-awake logic (CLAUDE.md rule 1). No relay, no OS calls — these
// exercise the exact decision the controller makes and the exact substring reads it feeds it. Run with
// `cargo test` on the build machine (the Tauri toolchain is not installed on the authoring box).
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_via_tunnel_keeps_awake() {
        assert!(should_keep_awake(true, true, false, false, false));
    }

    #[test]
    fn public_via_funnel_keeps_awake() {
        assert!(should_keep_awake(false, false, true, true, false));
    }

    #[test]
    fn not_public_does_not_keep_awake() {
        assert!(!should_keep_awake(false, false, false, false, false));
        // running/on but no URL yet → not actually reachable → not public.
        assert!(!should_keep_awake(true, false, true, false, false));
    }

    #[test]
    fn disabled_overrides_everything() {
        assert!(!should_keep_awake(true, true, true, true, true));
    }

    #[test]
    fn json_bool_true_reads() {
        assert!(json_bool_true("{\"running\":true,\"url\":\"x\"}", "running"));
        assert!(json_bool_true("{\"running\": true}", "running")); // tolerant of one space
        assert!(!json_bool_true("{\"running\":false}", "running"));
        assert!(!json_bool_true("{\"funnelOn\":true}", "running")); // wrong key
    }

    #[test]
    fn json_str_nonempty_reads() {
        assert!(json_str_nonempty("{\"url\":\"https://x.trycloudflare.com\"}", "url"));
        assert!(json_str_nonempty("{\"url\": \"wss://y\"}", "url")); // tolerant of one space
        assert!(!json_str_nonempty("{\"url\":\"\"}", "url")); // empty string value → false
        assert!(!json_str_nonempty("{\"running\":true}", "url")); // key absent
    }

    #[test]
    fn extract_token_reads() {
        assert_eq!(extract_token("{\"token\":\"abc\"}"), Some("abc".to_string()));
        assert_eq!(extract_token("{\"token\": \"a-b_C9\"}"), Some("a-b_C9".to_string())); // one space + base64url
        assert_eq!(extract_token("{\"token\":\"\"}"), None); // empty token → None
        assert_eq!(extract_token("{\"other\":\"x\"}"), None); // field absent
    }

    // ── Suite auto-update (P2) pure-decision tests ──────────────────────────────────────────────

    // audit be258b42 HIGH 3: an override runs only when it verifies, is newer than the installed Suite, and the
    // switch is on; one that is not newer is retired (a newer Suite was installed by hand).
    #[test]
    fn launch_pick_runs_an_override_only_when_signed_newer_and_switched_on() {
        let pd = "2026-06-01T00:00:00Z";
        let id = |d: &str| SignedId { sha: "2".repeat(40), date: d.into() };
        assert_eq!(launch_pick(true, Some(&id("2026-10-01T00:00:00Z")), pd), LaunchPick::Active);
        assert_eq!(launch_pick(true, None, pd), LaunchPick::Payload, "unverifiable → shipped code");
        assert_eq!(launch_pick(false, None, pd), LaunchPick::Payload);
        assert_eq!(launch_pick(false, Some(&id("2026-10-01T00:00:00Z")), pd), LaunchPick::Payload, "switched off → shipped code, files kept");
        assert_eq!(launch_pick(true, Some(&id("2026-03-01T00:00:00Z")), pd), LaunchPick::Retire, "older than the installed Suite → retired");
        assert_eq!(launch_pick(true, Some(&id(pd)), pd), LaunchPick::Retire, "as old as the installed Suite → retired");
        assert_eq!(launch_pick(false, Some(&id("2026-03-01T00:00:00Z")), pd), LaunchPick::Retire, "obsolete even when switched off");
    }

    #[test]
    fn rollback_target_decides() {
        assert_eq!(rollback_target(true, true), RollbackTarget::Keep); // healthy → keep new
        assert_eq!(rollback_target(true, false), RollbackTarget::Keep);
        assert_eq!(rollback_target(false, true), RollbackTarget::LastGood); // fail + have last-good
        assert_eq!(rollback_target(false, false), RollbackTarget::Payload); // fail + none → payload
    }

    // audit be258b42 HIGH 1: apply only inside HH:MM .. HH:MM+2h, once per window.
    #[test]
    fn due_window() {
        let at = |min: u32| LocalNow { min, today: "2026-11-12".into(), yesterday: "2026-11-11".into(), epoch: 0 };
        assert!(due(&at(180), 180, ""), "03:00 with a 03:00 target");
        assert!(due(&at(181), 180, ""));
        assert!(due(&at(299), 180, ""), "04:59 is still inside 03:00–05:00");
        assert!(!due(&at(300), 180, ""), "05:00 is outside the window");
        assert!(!due(&at(120), 180, ""), "before the time");
        assert!(!due(&at(600), 180, "2026-11-11"), "10:00 is NOT due, whatever was applied before (the old bug)");
        assert!(!due(&at(840), 180, ""), "14:00 is not due");
        assert!(!due(&at(200), 180, "2026-11-12"), "already applied in this window");
        assert!(due(&at(200), 180, "2026-11-11"), "applied yesterday, today's window open");
        // A window that crosses midnight: 23:30 → 01:30. At 00:15 the window is yesterday's.
        assert!(due(&at(15), 1410, ""), "00:15 inside a 23:30 window");
        assert!(!due(&at(15), 1410, "2026-11-11"), "…but not if yesterday's window already applied");
        assert!(due(&at(1420), 1410, "2026-11-11"), "23:40 today: today's window");
        assert!(!due(&at(100), 1410, ""), "01:40 is past a 23:30 window");
        assert_eq!(window_day(&at(15), 1410), "2026-11-11");
        assert_eq!(window_day(&at(200), 180), "2026-11-12");
    }

    // Owner decision Q3: a window missed while the computer was off is applied at the next START — only if the
    // update was already waiting when that window opened.
    #[test]
    fn missed_window_at_start() {
        // now = 2026-11-12 09:00:30 local-as-UTC (epoch chosen so seconds = 30); target 03:00 → window opened 03:00.
        let nine = parse_instant("2026-11-12T09:00:30Z").unwrap();
        let now = LocalNow { min: 540, today: "2026-11-12".into(), yesterday: "2026-11-11".into(), epoch: nine };
        let staged_yesterday = parse_instant("2026-11-11T15:00:00Z").unwrap();
        let staged_after_window = parse_instant("2026-11-12T08:00:00Z").unwrap();
        assert!(missed_window(&now, 180, staged_yesterday, ""), "waiting since yesterday, off at 03:00 → apply now");
        assert!(!missed_window(&now, 180, staged_after_window, ""), "arrived after the window → wait for the next");
        assert!(!missed_window(&now, 180, staged_yesterday, "2026-11-12"), "the window already ran");
        assert!(missed_window(&now, 180, staged_yesterday, "2026-11-11"), "only an earlier window ran");
    }

    #[test]
    fn parse_hhmm_reads() {
        assert_eq!(parse_hhmm("03:00"), Some(180));
        assert_eq!(parse_hhmm("03:00\n"), Some(180)); // trailing newline (the marker's content)
        assert_eq!(parse_hhmm(" 23:59 "), Some(23 * 60 + 59));
        assert_eq!(parse_hhmm("00:00"), Some(0));
        assert_eq!(parse_hhmm("24:00"), None); // hour out of range
        assert_eq!(parse_hhmm("03:60"), None); // minute out of range
        assert_eq!(parse_hhmm("0300"), None); // no colon
    }

    #[test]
    fn date_after_orders_by_instant_not_text() {
        // Same wall-clock text, different offsets: 03:00+01:00 is EARLIER (02:00Z) than 03:00Z. A string
        // compare would call them equal; by instant the Z one is later.
        assert!(date_after("2026-11-12T03:00:00Z", "2026-11-12T03:00:00+01:00"));
        assert!(!date_after("2026-11-12T03:00:00+01:00", "2026-11-12T03:00:00Z"));
        // Across a day boundary with offsets: 2026-11-12T23:30:00-02:00 == 2026-11-13T01:30:00Z, which is
        // LATER than 2026-11-13T00:30:00Z — so the earlier-text, earlier-day string is the later instant.
        assert!(date_after("2026-11-12T23:30:00-02:00", "2026-11-13T00:30:00+00:00"));
        assert!(!date_after("2026-11-13T00:30:00+00:00", "2026-11-12T23:30:00-02:00"));
        // Equal instants expressed differently → not strictly after.
        assert!(!date_after("2026-11-12T02:00:00Z", "2026-11-12T03:00:00+01:00"));
        // Compact offset form (+0100) parses the same as +01:00.
        assert!(date_after("2026-11-12T03:00:00Z", "2026-11-12T03:00:00+0100"));
        // Mirror suiteDateAfter edge rules: bad `a` → false; bad/empty floor → true.
        assert!(!date_after("not-a-date", "2026-11-12T00:00:00Z"));
        assert!(date_after("2026-11-12T00:00:00Z", ""));
        assert!(date_after("2026-11-12T00:00:00Z", "garbage"));
    }

    #[test]
    fn parse_instant_matches_known_epochs() {
        // 1970-01-01T00:00:00Z = 0.
        assert_eq!(parse_instant("1970-01-01T00:00:00Z"), Some(0));
        // 2000-01-01T00:00:00Z = 946684800.
        assert_eq!(parse_instant("2000-01-01T00:00:00Z"), Some(946684800));
        // Offset is applied: 2000-01-01T01:00:00+01:00 is the same instant as 00:00:00Z.
        assert_eq!(parse_instant("2000-01-01T01:00:00+01:00"), Some(946684800));
        // Date-only → UTC midnight.
        assert_eq!(parse_instant("1970-01-02"), Some(86400));
        // Fractional seconds are ignored.
        assert_eq!(parse_instant("1970-01-01T00:00:01.500Z"), Some(1));
        assert_eq!(parse_instant(""), None);
    }

    #[test]
    fn json_str_value_reads() {
        let ready = "{\"version\":\"v2\",\"sha\":\"abc123\",\"date\":\"2026-11-12T03:00:00Z\"}";
        assert_eq!(json_str_value(ready, "sha"), Some("abc123".to_string()));
        assert_eq!(json_str_value(ready, "version"), Some("v2".to_string()));
        assert_eq!(json_str_value(ready, "date"), Some("2026-11-12T03:00:00Z".to_string()));
        assert_eq!(json_str_value("{\"sha\": \"spaced\"}", "sha"), Some("spaced".to_string())); // one space
        assert_eq!(json_str_value(ready, "missing"), None);
    }

    #[test]
    fn override_env_payload_dir_is_payload() {
        use std::path::Path;
        let payload = Path::new("/opt/app/payload");
        let active = Path::new("/home/u/.local/share/trinity/data/suite/active");
        let data = Path::new("/home/u/.local/share/trinity/data");
        // Launching the OVERRIDE: cwd is active/, but PAYLOAD_DIR must still point at the read-only payload —
        // never at the override — or the relay's trust root is defeated.
        let env = relay_env(active, payload, data, "/opt/app/cloudflared");
        let pd = env.iter().find(|(k, _)| k == "PAYLOAD_DIR").map(|(_, v)| v.as_str());
        assert_eq!(pd, Some("/opt/app/payload"));
        assert_ne!(pd, Some(active.to_string_lossy().as_ref())); // NOT the writable override
        // And the rest of the contract the relay depends on is carried.
        let get = |k: &str| env.iter().find(|(kk, _)| kk == k).map(|(_, v)| v.clone());
        assert_eq!(get("TRINITY_DATA_DIR").as_deref(), Some("/home/u/.local/share/trinity/data"));
        assert_eq!(get("RELAY_HOST").as_deref(), Some("127.0.0.1"));
        assert_eq!(get("RELAY_NO_OPEN").as_deref(), Some("1"));
        assert_eq!(get("CLOUDFLARED_BIN").as_deref(), Some("/opt/app/cloudflared"));
        // Launching the PAYLOAD itself: PAYLOAD_DIR == payload == cwd, still correct.
        let env2 = relay_env(payload, payload, data, "/opt/app/cloudflared");
        assert_eq!(
            env2.iter().find(|(k, _)| k == "PAYLOAD_DIR").map(|(_, v)| v.as_str()),
            Some("/opt/app/payload")
        );
    }

    // The env every relay launch gets carries the bind decision read from the REAL data dir: loopback with no
    // `lan-access` marker, all interfaces with it. Real temp dir, real marker file — so flipping or deleting the
    // marker check in bind_host, or relay_env ignoring it, turns this red.
    #[test]
    fn relay_env_binds_loopback_unless_the_lan_access_marker_exists() {
        let data = std::env::temp_dir().join(format!("trin-relay-env-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&data);
        std::fs::create_dir_all(&data).unwrap();
        let payload = Path::new("/opt/app/payload");
        let host = |env: Vec<(String, String)>| {
            env.into_iter().find(|(k, _)| k == "RELAY_HOST").map(|(_, v)| v)
        };
        assert_eq!(host(relay_env(payload, payload, &data, "cf")).as_deref(), Some("127.0.0.1"));
        std::fs::write(data.join("lan-access"), "1").unwrap();
        assert_eq!(host(relay_env(payload, payload, &data, "cf")).as_deref(), Some("0.0.0.0"));
        std::fs::remove_file(data.join("lan-access")).unwrap();
        assert_eq!(host(relay_env(payload, payload, &data, "cf")).as_deref(), Some("127.0.0.1"));
        let _ = std::fs::remove_dir_all(&data);
    }

    // [AUDIT FIX #1] The post-respawn health matrix: a good bundle that boots + identifies is kept even when
    // the store is transiently degraded; only genuine code failure (no boot, wrong version, or a NON-storage
    // ok:false) rolls back + quarantines.
    #[test]
    fn health_outcome_matrix() {
        // reachable + version match + ok:true → keep, not degraded, no quarantine.
        assert_eq!(health_outcome(true, true, true, false), Outcome::Keep { store_degraded: false });
        // reachable + version match + ok:false SOLELY because the store is degraded → keep (note degraded),
        // do NOT roll back, do NOT quarantine. This is the whole point of the fix.
        assert_eq!(health_outcome(true, true, false, true), Outcome::Keep { store_degraded: true });
        // reachable + version match + ok:false for a NON-storage reason → roll back + quarantine (fail-closed).
        assert_eq!(health_outcome(true, true, false, false), Outcome::Rollback { quarantine: true });
        // reachable but the WRONG code identified itself (version mismatch) → roll back + quarantine, even if
        // ok and even if a storage flag happened to be set.
        assert_eq!(health_outcome(true, false, true, false), Outcome::Rollback { quarantine: true });
        assert_eq!(health_outcome(true, false, false, true), Outcome::Rollback { quarantine: true });
        // not reachable → the new code never booted → roll back + quarantine (other flags irrelevant).
        assert_eq!(health_outcome(false, false, false, false), Outcome::Rollback { quarantine: true });
        assert_eq!(health_outcome(false, true, true, true), Outcome::Rollback { quarantine: true });
    }

    // [AUDIT FIX #2] The short-sha helper must never panic on a non-ASCII / multibyte sha and must truncate on
    // CHARACTER boundaries. `&r_sha[..7]` would panic here because byte 7 falls inside a multibyte char.
    // audit be258b42 HIGH 2: the identity printed by the verifier is the only one trusted.
    #[test]
    fn parse_signed_id_reads_only_a_wellformed_identity() {
        let sha = "a".repeat(40);
        let good = format!("{{\"sha\":\"{sha}\",\"date\":\"2026-10-01T00:00:00Z\"}}\n");
        assert_eq!(parse_signed_id(&good), Some(SignedId { sha: sha.clone(), date: "2026-10-01T00:00:00Z".into() }));
        assert_eq!(parse_signed_id(""), None, "no output (an old verifier) is not an identity");
        assert_eq!(parse_signed_id("{\"sha\":\"sha-v2\",\"date\":\"2026-10-01\"}"), None, "a non-hex sha");
        assert_eq!(parse_signed_id(&format!("{{\"sha\":\"{sha}\",\"date\":\"soon\"}}")), None, "a non-date");
    }

    #[test]
    fn signed_bundle_verdict_uses_the_signed_identity() {
        let now = parse_instant("2026-11-13T00:00:00Z").unwrap();
        let s2 = "2".repeat(40);
        let id = |d: &str| SignedId { sha: s2.clone(), date: d.into() };
        assert_eq!(signed_bundle_verdict(&id("2026-10-01T00:00:00Z"), &s2, "2026-09-01T00:00:00Z", now), Ok(()));
        assert_eq!(signed_bundle_verdict(&id("2026-10-01T00:00:00Z"), &"3".repeat(40), "2026-09-01T00:00:00Z", now), Err("sha-mismatch"));
        assert_eq!(signed_bundle_verdict(&id("2026-08-01T00:00:00Z"), &s2, "2026-09-01T00:00:00Z", now), Err("not-newer"));
        assert_eq!(signed_bundle_verdict(&id("2026-09-01T00:00:00Z"), &s2, "2026-09-01T00:00:00Z", now), Err("not-newer"), "equal is not newer");
        assert_eq!(signed_bundle_verdict(&id("2026-11-13T23:00:00Z"), &s2, "", now), Ok(()), "within a day of skew is fine");
        assert_eq!(signed_bundle_verdict(&id("2026-11-15T00:00:00Z"), &s2, "", now), Err("future-date"));
        assert_eq!(signed_bundle_verdict(&id("2099-01-01T00:00:00Z"), &s2, "", now), Err("future-date"));
    }

    #[test]
    fn anti_rollback_floor_ignores_a_far_future_record() {
        let now = parse_instant("2026-11-13T00:00:00Z").unwrap();
        assert_eq!(anti_rollback_floor("2026-01-01T00:00:00Z", "2026-10-01T00:00:00Z", now), "2026-10-01T00:00:00Z");
        assert_eq!(anti_rollback_floor("2026-06-01T00:00:00Z", "2026-03-01T00:00:00Z", now), "2026-06-01T00:00:00Z");
        assert_eq!(anti_rollback_floor("2026-01-01T00:00:00Z", "", now), "2026-01-01T00:00:00Z");
        assert_eq!(anti_rollback_floor("2026-01-01T00:00:00Z", "2099-01-01T00:00:00Z", now), "2026-01-01T00:00:00Z",
            "a far-future installedDate must not become the floor");
    }

    #[test]
    fn short_sha_is_char_safe() {
        assert_eq!(short_sha("abcdef0123456789"), "abcdef0"); // normal: first 7 chars
        assert_eq!(short_sha("abc"), "abc"); // shorter than 7 → whole string, no panic
        assert_eq!(short_sha(""), ""); // empty → empty, no panic
        // Multibyte: a byte-slice at 7 would panic; char-take yields 7 chars safely.
        let s = "é€αβγδεζη"; // each char is 2–3 bytes, so byte 7 is mid-char
        assert_eq!(short_sha(s).chars().count(), 7);
        assert_eq!(short_sha(s), "é€αβγδε");
    }

    // [AUDIT FIX #3] Cooldown gate: no cooldown set → proceed; a future retry instant → wait; a past one →
    // proceed again.
    #[test]
    fn cooldown_gate() {
        let now = Instant::now();
        assert!(cooldown_elapsed(now, None)); // never backed off → always proceed
        assert!(!cooldown_elapsed(now, Some(now + Duration::from_secs(3600)))); // backed off, not yet elapsed
        assert!(cooldown_elapsed(now, Some(now - Duration::from_secs(1)))); // elapsed → proceed
        assert!(cooldown_elapsed(now, Some(now))); // boundary: now >= retry_at → proceed
    }

    #[test]
    fn jstr_escapes() {
        assert_eq!(jstr("abc"), "\"abc\"");
        assert_eq!(jstr("a\"b"), "\"a\\\"b\"");
        assert_eq!(jstr("a\\b"), "\"a\\\\b\"");
        // A state.json value round-trips back out through json_str_value unchanged.
        let v = "2026-11-12T03:00:00Z";
        let doc = format!("{{\"date\":{}}}", jstr(v));
        assert_eq!(json_str_value(&doc, "date"), Some(v.to_string()));
    }
}
