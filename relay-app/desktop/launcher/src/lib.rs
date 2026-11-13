// THE SUITE'S RELAY LAUNCHER — relay storage plan step 5 (TrinityOne-internal/reference/PLAN-relay-storage-location-
// 2026-11-12.html §2, §3, §8a-§8c).
//
// Everything the Suite decides about WHERE the relay's data is, and what to do when the relay stops asking for it to
// move, lives here and not in main.rs, for two reasons: it can be unit-tested without a window, and a headless host
// (src/bin/launcher-sim.rs) drives the SAME code from scripts/the-suite-launcher-*.test.mjs against a real gateway.
// main.rs supplies the one thing that needs Tauri: a `Host` that spawns the bundled Node sidecar and paints the splash.
//
// THE MOVE ITSELF IS NOT HERE. It is scripts/relay-move.mjs, run by the bundled Node (`Host::node`) through its CLI,
// which prints one JSON object. This file never copies, renames or checksums a relay's data; it decides WHEN to ask
// the mover, WHAT to do with the answer, and keeps the pointer's neighbours (the launcher's own notes) in storage.json.
//
// storage.json (in the app CONFIG dir, never inside a data folder — a missing drive must not take the note that says
// where the drive was) holds: dataDir / relayPub (the pointer, written ONLY by the mover at the switch step), move
// (the mover's journal), and launcher (this file's notes: lastRefusal, identityChanged). The gateway reads it and
// never writes it; this file writes only `launcher` and, when a steward removes an old copy, the journal's bookkeeping.
use serde_json::{json, Map, Value};
use std::fs;
use std::io::Write;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const MOVED_TO: &str = "MOVED-TO";
pub const MOVE_REQUEST: &str = ".move-request";
pub const REMOVE_REQUEST: &str = ".remove-old-request";
/// The gateway refuses to start (a missing drive, a moved-out folder, a foreign key) with this exit code (EX_CONFIG).
pub const EXIT_REFUSED: i32 = 78;
/// A failed check is rolled back and the relay started again; never more than this many times in one run, so a
/// folder that cannot be made to work ends in a message, not a loop.
const MAX_ROLLBACKS: u32 = 3;

// ── what the host (Tauri, or the headless sim) provides ─────────────────────────────────────────────────────
pub struct NodeOut {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

pub struct RelayEnv {
    /// TRINITY_DATA_DIR
    pub data_dir: PathBuf,
    /// TRINITY_DATA_DIR_PINNED=1 — the gateway then never creates the folder and never mints a key.
    pub pinned: bool,
    /// TRINITY_STORAGE_STATE (storage.json). TRINITY_STORAGE_MODE=suite is always set by the host.
    pub storage_state: PathBuf,
    /// this start is the step-8 check after a MOVE. The host must then start the relay exactly as it is and never
    /// change anything under it first (the Suite: no launch-time code update during a move's check).
    pub checking: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Exit {
    Code(i32),
    /// killed by a signal, or the host lost track of it
    Other,
}

pub trait RelayHandle: Send {
    /// None while it runs.
    fn exit(&self) -> Option<Exit>;
    /// the tail of what it wrote to stderr (the gateway says WHY it refused there)
    fn stderr_tail(&self) -> String;
    fn kill(&self);
}

#[derive(Debug, Clone, PartialEq)]
pub enum Progress {
    Starting,
    Moving { copied: u64, total: u64 },
    Checking,
    RolledBack,
    Notice(String),
    /// the relay was not started, and why — shown on the splash instead of a broken page
    Refused { title: String, reason: String },
}

/// What the host did on a supervising tick (see Host::tick).
pub enum Tick {
    /// nothing: keep supervising the same relay
    None,
    /// the host stopped the relay and started another one (the Suite: a code update was applied, or rolled back). The
    /// launcher adopts it and PROVES WHO ANSWERS again before it shows the control panel, as on every start.
    Replaced(Box<dyn RelayHandle>),
    /// the host stopped the relay because it had asked for a data move (.move-request): handle it as an exit 0
    MoveRequested,
    /// the host stopped the relay and must not start one (the Suite: the church's data is held aside by an update's
    /// restore that could not finish); the splash says why
    Stopped { title: String, reason: String },
}

pub trait Host: Sync {
    /// run the bundled Node on `<payload>/scripts/relay-move.mjs <args>` and wait for it
    fn node(&self, args: &[String]) -> NodeOut;
    fn spawn_relay(&self, env: &RelayEnv) -> Result<Box<dyn RelayHandle>, String>;
    fn progress(&self, p: &Progress);
    /// the relay answered and its identity was checked: show its control panel
    fn opened(&self, data_dir: &Path);
    fn log(&self, msg: &str);
    /// the app is closing
    fn quitting(&self) -> bool;
    fn port_open(&self, port: u16) -> bool {
        TcpStream::connect_timeout(&std::net::SocketAddr::from(([127, 0, 0, 1], port)), Duration::from_millis(400)).is_ok()
    }
    fn sleep_ms(&self, ms: u64) {
        std::thread::sleep(Duration::from_millis(ms));
    }
    /// The host's OWN crash recovery, run before ANY relay is started on `data_dir` — after the mover's recovery has
    /// decided the folder, before the step-8 begin-check counts it (the Suite: auto-update repairs a data restore a
    /// crash interrupted). Err((title, reason)) = start nothing; the splash says why.
    fn before_start(&self, _data_dir: &Path) -> Result<(), (String, String)> {
        Ok(())
    }
    /// Called about every 500 ms while a proven relay runs, and ONLY then: never while a mover runs, never during a
    /// move's check (the Suite: the timed code-update apply runs here, so a move and an apply can never overlap).
    fn tick(&self, _data_dir: &Path) -> Tick {
        Tick::None
    }
    /// The relay exited 0 asking for a move. Some(code) = the host refuses it now (the Suite: an update is being
    /// applied, or the church's data is held aside); it is recorded like any refused move and the relay restarts.
    fn move_blocked(&self, _data_dir: &Path) -> Option<String> {
        None
    }
}

pub struct Config {
    /// <app config dir>/storage.json
    pub config_file: PathBuf,
    /// <app data dir>/data — what an install that has never moved uses
    pub default_data: PathBuf,
    pub port: u16,
    /// after this many 250 ms steps without an open port the splash says the start is slow. The relay is NEVER killed
    /// for being slow (audit C M5: a slow Windows first run is normal, and the old code never gave up on it)
    pub up_steps: u32,
    /// relay-launch.log, named in every message that says the relay stopped
    pub log_path: PathBuf,
    /// how long a launcher waits for a running mover that makes NO PROGRESS (its journal state / copiedBytes unchanged)
    /// before it says the move looks stuck. Progress resets the clock: a long copy is never "stuck" (audit N1, M-1)
    pub mover_wait_ms: u64,
    /// after a MOVE, how many 250 ms steps the relay on the new folder gets to open its port before the check is
    /// treated as failed and rolled back (audit N6). A normal start has no such bound.
    pub check_steps: u32,
}

#[derive(Debug, PartialEq)]
pub enum RunEnd {
    /// the relay was not started, or stopped for good; the splash says why
    Refused(String),
    /// the app is closing
    Quit,
    /// the relay exited and nothing asked for it to be restarted (today's behaviour)
    Stopped(Option<i32>),
}

// ── the pointer ──────────────────────────────────────────────────────────────────────────────────────────────
/// THE ONE PLACE the data folder is decided (plan §2). Pure: `pointer` is the contents of storage.json, if any.
/// Absent file, unparseable file, no `dataDir`, or a non-absolute one -> the default, so an install that has never
/// moved behaves exactly as before. EVERY Rust reader of the data folder takes this value (or the `current` the
/// launcher publishes from it): TRINITY_DATA_DIR, the lan-access marker, the keep-awake-off marker, admin.json.
pub fn resolve_data_dir(pointer: Option<&str>, default: &Path) -> PathBuf {
    let dir = pointer
        .and_then(|t| serde_json::from_str::<Value>(t).ok())
        .and_then(|v| v.get("dataDir").and_then(|d| d.as_str()).map(|s| s.to_string()))
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from)
        .filter(|p| p.is_absolute());
    dir.unwrap_or_else(|| default.to_path_buf())
}

pub fn read_state(file: &Path) -> Value {
    fs::read_to_string(file).ok().and_then(|t| serde_json::from_str(&t).ok()).filter(|v: &Value| v.is_object()).unwrap_or_else(|| json!({}))
}

/// storage.json is shared with the mover (one process at a time: the launcher only runs it while the relay is down)
/// and read by the gateway. Whole-file replace: temp + fsync + rename.
pub fn write_state(file: &Path, v: &Value) -> std::io::Result<()> {
    if let Some(d) = file.parent() {
        fs::create_dir_all(d)?;
    }
    let tmp = file.with_extension(format!("json.tmp-{}", std::process::id()));
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(serde_json::to_string_pretty(v).unwrap_or_else(|_| "{}".into()).as_bytes())?;
        f.write_all(b"\n")?;
        f.sync_all()?;
    }
    fs::rename(&tmp, file)
}

fn update_state<F: FnOnce(&mut Map<String, Value>)>(file: &Path, f: F) {
    let mut v = read_state(file);
    if let Some(o) = v.as_object_mut() {
        f(o);
    }
    let _ = write_state(file, &v);
}

/// resolve from the file on disk
pub fn resolve_from_file(cfg: &Config) -> PathBuf {
    resolve_data_dir(fs::read_to_string(&cfg.config_file).ok().as_deref(), &cfg.default_data)
}

/// Pin only a folder that already has an identity. The very first run (a new, empty folder) must NOT be pinned until
/// the relay has made its key: the gateway then creates the folder's identity itself. Once a pointer exists the
/// steward chose that folder, so it is pinned whatever it holds — a missing drive refuses instead of starting empty.
pub fn should_pin(dir: &Path, pointer_names_dir: bool) -> bool {
    pointer_names_dir || dir.join("relay-key.json").is_file()
}

pub fn key_pub_of(dir: &Path) -> Option<String> {
    let v: Value = serde_json::from_str(&fs::read_to_string(dir.join("relay-key.json")).ok()?).ok()?;
    if v.get("sk").is_some() {
        v.get("pub").and_then(|p| p.as_str()).map(|s| s.to_string())
    } else {
        None
    }
}

// ── time (no chrono): UTC ISO-8601 with milliseconds ──────────────────────────────────────────────────────────
pub fn iso_from_unix_ms(ms: u64) -> String {
    let secs = (ms / 1000) as i64;
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    // Howard Hinnant's civil_from_days
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z", y, m, d, rem / 3600, (rem % 3600) / 60, rem % 60, ms % 1000)
}
fn now_iso() -> String {
    iso_from_unix_ms(SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0))
}

// ── the mover's CLI ─────────────────────────────────────────────────────────────────────────────────────────
fn mover(host: &dyn Host, cfg: &Config, sub: &[&str], extra: &[String]) -> Option<Value> {
    let mut args: Vec<String> = vec!["scripts/relay-move.mjs".into(), sub[0].into()];
    for s in &sub[1..] {
        args.push((*s).into());
    }
    args.push("--pointer".into());
    args.push(cfg.config_file.to_string_lossy().into_owned());
    args.extend(extra.iter().cloned());
    let out = host.node(&args);
    // exit 2 = "refused / failed safely": its JSON is still the answer. Anything unparseable is no answer.
    let line = out.stdout.lines().rev().find(|l| l.trim_start().starts_with('{'))?;
    match serde_json::from_str::<Value>(line) {
        Ok(v) => Some(v),
        Err(_) => {
            host.log(&format!("mover {} printed unreadable output (exit {}): {}", sub[0], out.code, out.stderr.trim()));
            None
        }
    }
}
fn s_of<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(|x| x.as_str())
}

#[derive(Debug, PartialEq)]
pub enum Recovery {
    /// start the relay on this folder; `check` = run the step-8 check
    Start { dir: Option<PathBuf>, check: bool, identity_changed: Option<(String, String)> },
    /// do NOT start: the pointer names a drive that is not connected, or a state nothing may start from
    Refuse { code: String },
}

/// Pure reading of `relay-move.mjs recover`'s answer.
pub fn read_recovery(v: &Value) -> Recovery {
    let action = s_of(v, "action").unwrap_or("");
    if action == "refuse" || (action != "none" && action != "check") {
        return Recovery::Refuse { code: s_of(v, "code").unwrap_or("recover-failed").to_string() };
    }
    let dir = s_of(v, "dataDir").filter(|d| !d.is_empty()).map(PathBuf::from);
    let ic = if v.get("identityChanged").and_then(|b| b.as_bool()).unwrap_or(false) {
        Some((s_of(v, "expectedPub").unwrap_or("").to_string(), s_of(v, "foundPub").unwrap_or("").to_string()))
    } else {
        None
    };
    Recovery::Start { dir, check: action == "check", identity_changed: ic }
}

// ── the identity comparison (rule 10) ───────────────────────────────────────────────────────────────────────
#[derive(Debug, PartialEq)]
pub enum Identity {
    /// proven, and the same key as the one recorded
    Same,
    /// proven, and a DIFFERENT key — a stranger, or a restore of another relay's backup
    Changed { expected: String, proven: String },
    /// the relay could not prove a key (no valid signed answer): never treated as "same"
    Unproven { expected: String },
    /// nothing was recorded to compare with (a first run)
    NothingRecorded { proven: Option<String> },
}
/// `proven` is the key the relay SIGNED a nonce with (relay-move.mjs prove) — never the /status string.
pub fn compare_identity(proven: Option<&str>, recorded: Option<&str>) -> Identity {
    match (proven, recorded) {
        (_, None) | (_, Some("")) => Identity::NothingRecorded { proven: proven.map(|s| s.to_string()) },
        (None, Some(r)) => Identity::Unproven { expected: r.to_string() },
        (Some(p), Some(r)) if p == r => Identity::Same,
        (Some(p), Some(r)) => Identity::Changed { expected: r.to_string(), proven: p.to_string() },
    }
}
fn prove(host: &dyn Host, cfg: &Config) -> Option<String> {
    let p = mover(host, cfg, &["prove"], &["--port".into(), cfg.port.to_string()])?;
    if p.get("ok").and_then(|b| b.as_bool()) == Some(true) {
        s_of(&p, "relayPub").map(|s| s.to_string())
    } else {
        host.log(&format!("identity proof failed: {}", s_of(&p, "code").unwrap_or("?")));
        None
    }
}

// ── the launcher's own notes in storage.json ────────────────────────────────────────────────────────────────
fn record_refusal(cfg: &Config, kind: &str, code: &str, detail: Option<&str>) {
    update_state(&cfg.config_file, |o| {
        let l = o.entry("launcher").or_insert_with(|| json!({}));
        if let Some(lo) = l.as_object_mut() {
            lo.insert("lastRefusal".into(), json!({ "kind": kind, "code": code, "detail": detail, "at": now_iso() }));
        }
    });
}
fn clear_refusal(cfg: &Config) {
    update_state(&cfg.config_file, |o| {
        if let Some(l) = o.get_mut("launcher").and_then(|l| l.as_object_mut()) {
            l.remove("lastRefusal");
        }
    });
}
fn set_identity_note(cfg: &Config, note: Option<Value>) {
    update_state(&cfg.config_file, |o| {
        let l = o.entry("launcher").or_insert_with(|| json!({}));
        if let Some(lo) = l.as_object_mut() {
            match note {
                Some(n) => {
                    lo.insert("identityChanged".into(), n);
                }
                None => {
                    lo.remove("identityChanged");
                }
            }
        }
    });
}

// ── the main loop ───────────────────────────────────────────────────────────────────────────────────────────
pub fn run(host: &dyn Host, cfg: &Config) -> RunEnd {
    let mut rollbacks = 0u32;
    'start: loop {
        if host.quitting() {
            return RunEnd::Quit;
        }
        // 0. A MOVER MAY STILL BE RUNNING (audit C M4): the sidecar is not killed when the app closes, so a window
        //    closed mid-move and reopened finds the old mover still at work. Recovering now would delete its partial
        //    copy from under it, and starting the relay would open the folder it is copying. Wait for it.
        match wait_for_mover(host, cfg) {
            Waited::Free => {}
            Waited::Quit => return RunEnd::Quit,
            Waited::Stuck(alive) => {
                let lock = format!("{}.mover-lock", cfg.config_file.display());
                // NEVER suggest deleting the lock while a mover process may still be there: that is the M4 hazard (a
                // second launcher recovering under a mover that is still copying). Only when the holder is confirmed gone.
                let reason = match alive {
                    Some(false) => format!(
                        "A move of your relay's data did not finish and its process is gone. Close the app, delete the file {} and open it again: the launcher then recovers the move or undoes it. Details are in {}",
                        lock,
                        cfg.log_path.display()
                    ),
                    _ => format!(
                        "A move of your relay's data is still running but has made no progress for a long time. Close the app and open it again to keep waiting; do not delete anything. Details are in {}",
                        cfg.log_path.display()
                    ),
                };
                record_refusal(cfg, "start", "mover-stuck", None);
                host.progress(&Progress::Refused { title: "Your relay's move looks stuck".into(), reason: reason.clone() });
                return RunEnd::Refused(reason);
            }
        }
        // 1. CRASH RECOVERY, at every launch, before anything is spawned. The mover follows the pointer.
        let (dir, check, ic) = match mover(host, cfg, &["recover"], &[]).map(|v| read_recovery(&v)) {
            Some(Recovery::Start { dir, check, identity_changed }) => (dir.unwrap_or_else(|| resolve_from_file(cfg)), check, identity_changed),
            Some(Recovery::Refuse { code }) => return refuse_start(host, cfg, &code),
            None => {
                // the mover could not be run. An install that has never moved has nothing to recover; anything
                // else might be mid-move, and starting on a guess could start a stranger.
                let st = read_state(&cfg.config_file);
                if st.get("dataDir").is_some() || st.get("move").is_some() {
                    return refuse_start(host, cfg, "recover-failed");
                }
                host.log("recover could not run; no move was ever recorded, starting on the default folder");
                (resolve_from_file(cfg), false, None)
            }
        };
        // 2. a removal asked for while the app was closed (the folder the relay will use is the one it wrote to)
        process_remove_old(host, cfg, &dir);
        // 2b. THE HOST'S OWN CRASH RECOVERY, on the folder the mover just settled, before anything counts or starts it.
        //     Never the other way round: a move is only ever recovered by the mover, and an update's half-finished
        //     restore only by the host, and neither starts a relay over the other's half-finished state.
        if let Err((title, reason)) = host.before_start(&dir) {
            host.log(&format!("not starting the relay: {reason}"));
            record_refusal(cfg, "start", "host-refused", Some(&reason));
            host.progress(&Progress::Refused { title, reason: reason.clone() });
            return RunEnd::Refused(reason);
        }
        // 3. THE STEP-8 CHECK STARTS BEFORE THE RELAY DOES (plan §8c): exact row counts while nothing has run there
        if check {
            host.progress(&Progress::Checking);
            let bc = mover(host, cfg, &["begin-check"], &[]);
            if bc.as_ref().and_then(|v| v.get("ok")).and_then(|b| b.as_bool()) != Some(true) {
                host.log(&format!("begin-check failed: {:?} — rolling back", bc));
                if !roll_back(host, cfg, &mut rollbacks) {
                    return RunEnd::Refused("rollback".into());
                }
                continue;
            }
        }
        // 4. start the relay. Expected identity is read BEFORE it runs: the pointer's record, else the folder's key.
        let st = read_state(&cfg.config_file);
        let pointer_names_dir = st.get("dataDir").and_then(|d| d.as_str()).map(|s| !s.is_empty()).unwrap_or(false);
        let recorded = s_of(&st, "relayPub").map(|s| s.to_string()).or_else(|| key_pub_of(&dir));
        let env = RelayEnv { data_dir: dir.clone(), pinned: should_pin(&dir, pointer_names_dir), storage_state: cfg.config_file.clone(), checking: check };
        if !check && !ic_none(&ic) {
            host.log("recovery reports the folder's key differs from the pointer's record; the proof below decides what the steward is told");
        }
        host.progress(&Progress::Starting);
        let mut relay = match host.spawn_relay(&env) {
            Ok(r) => r,
            Err(e) => {
                host.log(&format!("SPAWN FAILED: {e}"));
                if !host.quitting() {
                    host.progress(&Progress::Refused { title: "Your relay didn't start".into(), reason: format!("{e}. Details are in {}", cfg.log_path.display()) });
                }
                return RunEnd::Stopped(None);
            }
        };
        let mut check = check;
        // 'adopt: the relay this launcher supervises. Entered once per start, and again whenever the host replaced the
        // relay (Tick::Replaced): every relay the launcher supervises is waited for and PROVEN here, never only the first.
        'adopt: loop {
            // 5. wait for the port, or for the relay to exit. A relay that is merely SLOW is never killed or abandoned.
            let mut up = false;
            let (mut steps, mut told) = (0u32, false);
            loop {
                if relay.exit().is_some() {
                    break;
                }
                if host.quitting() {
                    relay.kill();
                    return RunEnd::Quit;
                }
                if host.port_open(cfg.port) {
                    up = true;
                    break;
                }
                steps += 1;
                // N6: right after a MOVE a relay that never opens its port is a failed check, not a slow start
                if check && steps >= cfg.check_steps {
                    host.log("the relay on the new folder never opened its port; the check failed, rolling back");
                    relay.kill();
                    wait_exit(host, relay.as_ref());
                    if !roll_back(host, cfg, &mut rollbacks) {
                        return RunEnd::Refused("rollback".into());
                    }
                    continue 'start;
                }
                if steps >= cfg.up_steps && !told {
                    told = true;
                    host.progress(&Progress::Notice(format!("Still starting. The first start can take a few minutes. If it never finishes, details are in {}", cfg.log_path.display())));
                }
                host.sleep_ms(250);
            }
            if !up {
                let exit = relay.exit().unwrap_or(Exit::Other);
                if check {
                    // the relay did not come up from the new folder: take the move back
                    host.log(&format!("the relay did not start from the new folder (exit {:?}); rolling back", exit));
                    if !roll_back(host, cfg, &mut rollbacks) {
                        return RunEnd::Refused("rollback".into());
                    }
                    continue 'start;
                }
                match after_exit(host, cfg, &dir, &exit, relay.as_ref()) {
                    Next::Again => continue 'start,
                    Next::End(e) => return e,
                }
            }
            // 6. PROVE WHO ANSWERED, on every start (rule 10) — and on every relay the host put in its place. The port
            //    being open proves nothing: it may be another program, or another relay.
            let proven = prove(host, cfg);
            if check {
                let vr = mover(host, cfg, &["verify-restart"], &["--port".into(), cfg.port.to_string(), "--data-dir".into(), dir.to_string_lossy().into_owned()]);
                let ok = vr.as_ref().and_then(|v| v.get("ok")).and_then(|b| b.as_bool()) == Some(true);
                let moved_pub = s_of(&read_state(&cfg.config_file), "relayPub").map(|s| s.to_string());
                // the launcher's OWN comparison as well as the mover's: the key the relay signed must be the recorded one
                let same = compare_identity(proven.as_deref(), moved_pub.as_deref().or(recorded.as_deref())) == Identity::Same;
                if !ok || !same {
                    host.log(&format!("the check failed (verify-restart {:?}, identity same={}); rolling back", vr, same));
                    relay.kill();
                    wait_exit(host, relay.as_ref());
                    if !roll_back(host, cfg, &mut rollbacks) {
                        return RunEnd::Refused("rollback".into());
                    }
                    continue 'start;
                }
                mover(host, cfg, &["check-passed"], &[]);
                // the move's check is over: a relay the host puts in its place later is proven, but is not a move's check
                check = false;
            }
            match compare_identity(proven.as_deref(), recorded.as_deref()) {
                Identity::Same => set_identity_note(cfg, None),
                Identity::NothingRecorded { .. } => {}
                Identity::Changed { expected, proven } => {
                    host.log(&format!("IDENTITY CHANGED: expected {expected}, the relay proves {proven}"));
                    set_identity_note(cfg, Some(json!({ "expectedPub": expected, "provenPub": proven, "at": now_iso() })));
                    host.progress(&Progress::Notice("This relay's identity is not the one it had before. If you restored another relay's backup, that is expected.".into()));
                }
                Identity::Unproven { expected } => {
                    host.log("the relay could not prove its identity");
                    set_identity_note(cfg, Some(json!({ "expectedPub": expected, "provenPub": Value::Null, "at": now_iso() })));
                }
            }
            host.opened(&dir);
            // 7. supervise: act on a removal request, give the host its tick, wait for the relay to stop
            let mut tick = 0u32;
            let exit = loop {
                if let Some(e) = relay.exit() {
                    break e;
                }
                if host.quitting() {
                    return RunEnd::Quit;
                }
                if tick % 4 == 0 {
                    process_remove_old(host, cfg, &dir);
                }
                tick = tick.wrapping_add(1);
                match host.tick(&dir) {
                    Tick::None => {}
                    Tick::Replaced(r) => {
                        host.log("the host restarted the relay (a code update); proving who answers before the panel is shown again");
                        relay = r;
                        continue 'adopt;
                    }
                    Tick::MoveRequested => break Exit::Code(0),
                    Tick::Stopped { title, reason } => {
                        host.log(&format!("the host stopped the relay and will not start one: {reason}"));
                        record_refusal(cfg, "start", "host-stopped", Some(&reason));
                        host.progress(&Progress::Refused { title, reason: reason.clone() });
                        return RunEnd::Refused(reason);
                    }
                }
                host.sleep_ms(500);
            };
            match after_exit(host, cfg, &dir, &exit, relay.as_ref()) {
                Next::Again => continue 'start, // a move was handled: recover, check and start again
                Next::End(e) => return e,
            }
        }
    }
}

enum Waited {
    Free,
    Quit,
    /// no progress for cfg.mover_wait_ms: never wait for ever behind a splash that says "Moving". Carries whether the
    /// holder's process is confirmed alive (Some(true)), confirmed gone (Some(false)) or unknown (None).
    Stuck(Option<bool>),
}
fn wait_for_mover(host: &dyn Host, cfg: &Config) -> Waited {
    let mut idle = 0u64;
    let mut last: Option<(String, u64, u64, u64, String)> = None;
    loop {
        let ls = mover(host, cfg, &["lock-status"], &[]);
        let held = ls.as_ref().and_then(|v| v.get("held").and_then(|b| b.as_bool())).unwrap_or(false);
        let alive = ls.as_ref().and_then(|v| v.get("alive").and_then(|b| b.as_bool()));
        if !held {
            return Waited::Free;
        }
        if host.quitting() {
            return Waited::Quit;
        }
        let st = read_state(&cfg.config_file);
        let m = st.get("move");
        let (cp, tot) = (m.and_then(|m| m.get("copiedBytes")).and_then(|x| x.as_u64()).unwrap_or(0), m.and_then(|m| m.get("totalBytes")).and_then(|x| x.as_u64()).unwrap_or(0));
        // PROGRESS, not the clock: any change of the move's state or copied bytes restarts the count
        let verified = m.and_then(|m| m.get("verifiedBytes")).and_then(|x| x.as_u64()).unwrap_or(0);
        let phase = m.and_then(|m| m.get("phase")).and_then(|x| x.as_str()).unwrap_or("").to_string();
        let sig = (m.and_then(|m| m.get("state")).and_then(|x| x.as_str()).unwrap_or("").to_string(), cp, tot, verified, phase.clone());
        // the database integrity check is one SQLite call that cannot report progress: while its phase marker stands and
        // the mover lock is held, the move is busy, not stuck
        if last.as_ref() != Some(&sig) || phase == "integrity" {
            last = Some(sig);
            idle = 0;
        }
        if idle >= cfg.mover_wait_ms {
            return Waited::Stuck(alive);
        }
        host.progress(&Progress::Moving { copied: cp, total: tot });
        host.sleep_ms(1000);
        idle += 1000;
    }
}

fn ic_none(ic: &Option<(String, String)>) -> bool {
    ic.is_none()
}

fn wait_exit(host: &dyn Host, relay: &dyn RelayHandle) -> Exit {
    for _ in 0..80 {
        if let Some(e) = relay.exit() {
            return e;
        }
        host.sleep_ms(100);
    }
    relay.kill();
    Exit::Other
}

enum Next {
    Again,
    End(RunEnd),
}
/// What to do when the relay stops.
fn after_exit(host: &dyn Host, cfg: &Config, dir: &Path, exit: &Exit, relay: &dyn RelayHandle) -> Next {
    match exit {
        Exit::Code(0) if dir.join(MOVE_REQUEST).exists() => {
            // A move never starts while the host has something half-done in this folder (the Suite: a code update
            // being applied, or the church's data held aside by its restore). One request, one attempt: it is
            // consumed and recorded as refused, exactly like a move the mover refuses, and the relay starts again.
            if let Some(code) = host.move_blocked(dir) {
                let _ = fs::remove_file(dir.join(MOVE_REQUEST));
                host.log(&format!("move refused by the host: {code}"));
                record_refusal(cfg, "move", &code, None);
                return Next::Again;
            }
            do_move(host, cfg, dir);
            Next::Again
        }
        Exit::Code(c) if *c == EXIT_REFUSED => {
            let (title, reason) = refusal_message(&relay.stderr_tail());
            record_refusal(cfg, "start", "gateway-refused", Some(&reason));
            host.progress(&Progress::Refused { title, reason: reason.clone() });
            Next::End(RunEnd::Refused(reason))
        }
        // anything else: say so, with the log path. The window used to stay on "Starting…" with its probe off (audit C M5)
        Exit::Code(c) => {
            host.log(&format!("[exit] {c}"));
            if !host.quitting() {
                host.progress(&Progress::Refused { title: "Your relay stopped".into(), reason: format!("It stopped unexpectedly (exit {c}). Open the app again. Details are in {}", cfg.log_path.display()) });
            }
            Next::End(RunEnd::Stopped(Some(*c)))
        }
        Exit::Other => {
            if !host.quitting() {
                host.progress(&Progress::Refused { title: "Your relay stopped".into(), reason: format!("It was ended unexpectedly. Open the app again. Details are in {}", cfg.log_path.display()) });
            }
            Next::End(RunEnd::Stopped(None))
        }
    }
}

fn refuse_start(host: &dyn Host, cfg: &Config, code: &str) -> RunEnd {
    let (title, reason) = match code {
        "drive-missing" | "folder-not-startable" | "pointer-mismatch" | "pointer-unexpected" | "pointer-unreadable" | "recover-failed" => (
            "Your relay's drive isn't connected".to_string(),
            "Plug in the drive that holds your relay's data, then open the app again. Nothing has been changed or created.".to_string(),
        ),
        other => ("Your relay didn't start".to_string(), format!("The move could not be finished safely ({other}). Nothing has been changed. Open the app again.")),
    };
    record_refusal(cfg, "start", code, None);
    host.progress(&Progress::Refused { title, reason: reason.clone() });
    RunEnd::Refused(reason)
}

fn roll_back(host: &dyn Host, cfg: &Config, count: &mut u32) -> bool {
    *count += 1;
    if *count > MAX_ROLLBACKS {
        host.progress(&Progress::Refused { title: "Your relay didn't start".into(), reason: "The move could not be checked and could not be undone safely. Open the app again.".into() });
        return false;
    }
    let r = mover(host, cfg, &["rollback"], &[]);
    let ok = r.as_ref().and_then(|v| v.get("ok")).and_then(|b| b.as_bool()) == Some(true);
    host.log(&format!("rollback -> {:?}", r));
    if ok {
        host.progress(&Progress::RolledBack);
    }
    // not ok: the next loop's `recover` decides (it re-runs an interrupted rollback, or refuses)
    true
}

// ── the move (the relay has stopped itself with exit 0 and left .move-request) ──────────────────────────────
/// Reads what the relay asked for, runs the mover, records a refusal. NEVER writes .move-request: the mover consumes
/// the one the relay left, and whatever happens next, one request is one attempt.
fn do_move(host: &dyn Host, cfg: &Config, dir: &Path) {
    let req_file = dir.join(MOVE_REQUEST);
    let req: Value = fs::read_to_string(&req_file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
    clear_refusal(cfg);
    // The request is a wish, not an authority (plan §2): only the DRIVE is taken from it. The mover recomputes the
    // fixed folder name and re-checks every refusal itself.
    let drive = s_of(&req, "drive").map(|s| s.to_string()).filter(|s| !s.is_empty());
    let drive = match drive {
        Some(d) => d,
        None => {
            let _ = fs::remove_file(&req_file);
            record_refusal(cfg, "move", "bad-request", None);
            return;
        }
    };
    host.progress(&Progress::Moving { copied: 0, total: 0 });
    let args: Vec<String> = vec![
        "--from".into(),
        dir.to_string_lossy().into_owned(),
        "--drive".into(),
        drive,
        "--port".into(),
        cfg.port.to_string(),
        "--mode".into(),
        "suite".into(),
    ];
    let done = std::sync::atomic::AtomicBool::new(false);
    let answer = std::thread::scope(|s| {
        // splash progress: the mover journals copiedBytes as it goes
        s.spawn(|| {
            while !done.load(std::sync::atomic::Ordering::Relaxed) {
                let st = read_state(&cfg.config_file);
                if let Some(m) = st.get("move") {
                    let state = s_of(m, "state").unwrap_or("");
                    let tot = m.get("totalBytes").and_then(|x| x.as_u64()).unwrap_or(0);
                    let cp = m.get("copiedBytes").and_then(|x| x.as_u64()).unwrap_or(0);
                    if state == "verifying" {
                        host.progress(&Progress::Checking);
                    } else if state == "copying" || state == "renaming" {
                        host.progress(&Progress::Moving { copied: cp, total: tot });
                    }
                }
                std::thread::sleep(Duration::from_millis(400));
            }
        });
        let a = mover(host, cfg, &["move"], &args);
        done.store(true, std::sync::atomic::Ordering::Relaxed);
        a
    });
    // the request is one-shot whatever happened (the mover has normally removed it already)
    let _ = fs::remove_file(&req_file);
    match answer {
        Some(v) if v.get("ok").and_then(|b| b.as_bool()) == Some(true) => host.log("move done; the check follows"),
        Some(v) => {
            let code = s_of(&v, "code").unwrap_or("move-failed");
            host.log(&format!("move refused: {code} {}", s_of(&v, "detail").unwrap_or("")));
            record_refusal(cfg, "move", code, s_of(&v, "detail"));
        }
        None => record_refusal(cfg, "move", "mover-failed", None),
    }
}

// ── removing the old copy ───────────────────────────────────────────────────────────────────────────────────
fn fold(p: &Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    if cfg!(any(windows, target_os = "macos")) {
        s.to_lowercase()
    } else {
        s
    }
}
fn under(p: &Path, root: &Path) -> bool {
    let (a, b) = (fold(p), fold(root));
    a == b || a.starts_with(&format!("{}/", b.trim_end_matches('/')))
}

/// THE RE-CHECK, made at the moment of deletion, on the filesystem as it is NOW (audit L-4 / N-c: the gateway checked
/// when the button was pressed; the folder can have changed since — a symlink dropped in, the live folder moved).
/// OK only if `target` is a real directory (not a link), is not the live folder, does not hold it, is not inside it,
/// does not resolve to it, and carries the MOVED-TO marker the mover put there.
pub fn target_is_safe_to_remove(target: &Path, live: &Path) -> Result<(), &'static str> {
    let meta = match fs::symlink_metadata(target) {
        Ok(m) => m,
        Err(_) => return Err("gone"),
    };
    if meta.file_type().is_symlink() {
        return Err("target-is-a-link");
    }
    if !meta.is_dir() {
        return Err("target-not-a-folder");
    }
    let real_t = fs::canonicalize(target).map_err(|_| "target-unreadable")?;
    let real_l = fs::canonicalize(live).map_err(|_| "live-folder-unreadable")?;
    for t in [target, real_t.as_path()] {
        for l in [live, real_l.as_path()] {
            if under(t, l) || under(l, t) {
                return Err("current-folder");
            }
        }
    }
    if !target.join(MOVED_TO).is_file() {
        return Err("not-marked-moved");
    }
    Ok(())
}

/// Empties `target` except its MOVED-TO note (which stays as the tombstone, plan §3 step 9), re-running the check
/// before every entry it deletes. Never follows a link: a link is unlinked, not entered.
pub fn remove_old_copy(target: &Path, live: &Path) -> Result<(), String> {
    match target_is_safe_to_remove(target, live) {
        Ok(()) => {}
        Err("gone") => return Ok(()), // nothing there: it is "removed"
        Err(e) => return Err(e.to_string()),
    }
    let entries: Vec<_> = fs::read_dir(target).map_err(|e| format!("read-failed: {e}"))?.filter_map(|e| e.ok()).collect();
    for e in entries {
        let name = e.file_name();
        if name.to_string_lossy() == MOVED_TO {
            continue;
        }
        // the moment of deletion: look again
        target_is_safe_to_remove(target, live).map_err(|c| c.to_string())?;
        let p = e.path();
        let meta = fs::symlink_metadata(&p).map_err(|e| format!("read-failed: {e}"))?;
        let r = if meta.is_dir() && !meta.file_type().is_symlink() { fs::remove_dir_all(&p) } else { fs::remove_file(&p) };
        r.map_err(|e| format!("delete-failed: {e}"))?;
    }
    Ok(())
}

/// Is `path` (with `kind`) something the journal recorded as removable? A request names ONLY a recorded old copy or
/// leftover; anything else is refused — the request file is writable by anything that can write the relay's folder.
pub fn recorded_for_removal(state: &Value, path: &str, kind: &str) -> bool {
    let m = match state.get("move") {
        Some(m) => m,
        None => return false,
    };
    match kind {
        "old-copy" => s_of(m, "state") == Some("awaiting-confirm") && m.get("oldCopy").and_then(|o| s_of(o, "path")) == Some(path),
        "leftover" => m.get("leftovers").and_then(|l| l.as_array()).map(|l| l.iter().any(|x| s_of(x, "path") == Some(path) && x.get("removedAt").is_none())).unwrap_or(false),
        _ => false,
    }
}

/// Journal bookkeeping once a recorded copy is gone: the leftover gets `removedAt`; the old copy ends the move
/// (`done`), which lets the next move start. `oldCopy.since` is kept untouched until then.
pub fn mark_removed(state: &mut Value, path: &str, kind: &str, at: &str) {
    if let Some(m) = state.get_mut("move").and_then(|m| m.as_object_mut()) {
        if let Some(l) = m.get_mut("leftovers").and_then(|l| l.as_array_mut()) {
            for x in l.iter_mut() {
                if s_of(x, "path") == Some(path) {
                    if let Some(xo) = x.as_object_mut() {
                        xo.insert("removedAt".into(), json!(at));
                    }
                }
            }
        }
        if kind == "old-copy" {
            m.insert("state".into(), json!("done"));
            m.insert("oldCopyRemovedAt".into(), json!(at));
            m.insert("oldCopy".into(), Value::Null);
        }
    }
}

pub fn process_remove_old(host: &dyn Host, cfg: &Config, live: &Path) {
    let req_file = live.join(REMOVE_REQUEST);
    let text = match fs::read_to_string(&req_file) {
        Ok(t) => t,
        Err(_) => return,
    };
    // one request, one attempt: gone before anything is deleted
    let _ = fs::remove_file(&req_file);
    let req: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    let (path, kind) = (s_of(&req, "path").unwrap_or("").to_string(), s_of(&req, "kind").unwrap_or("").to_string());
    let state = read_state(&cfg.config_file);
    if path.is_empty() || !recorded_for_removal(&state, &path, &kind) {
        host.log(&format!("remove-old refused: {path:?} is not recorded as an old copy"));
        record_refusal(cfg, "remove-old", "not-recorded", Some(&path));
        return;
    }
    match remove_old_copy(Path::new(&path), live) {
        Ok(()) => {
            host.log(&format!("removed the old copy at {path}"));
            let at = now_iso();
            update_state(&cfg.config_file, |o| {
                let mut v = Value::Object(std::mem::take(o));
                mark_removed(&mut v, &path, &kind, &at);
                if let Some(l) = v.get_mut("launcher").and_then(|l| l.as_object_mut()) {
                    l.remove("lastRefusal");
                }
                if let Value::Object(n) = v {
                    *o = n;
                }
            });
        }
        Err(code) => {
            host.log(&format!("remove-old refused: {code} ({path})"));
            record_refusal(cfg, "remove-old", &code, Some(&path));
        }
    }
}

// ── what the splash says ────────────────────────────────────────────────────────────────────────────────────
fn gb(b: u64) -> String {
    if b >= 1 << 30 {
        format!("{:.1} GB", b as f64 / (1u64 << 30) as f64)
    } else {
        format!("{:.0} MB", b as f64 / (1u64 << 20) as f64)
    }
}
/// (title, sub, kind) kind: busy | bad | note
pub fn splash_text(p: &Progress) -> (String, String, &'static str) {
    match p {
        Progress::Starting => ("Starting your relay…".into(), "Setting up your church's own corner of the network.".into(), "busy"),
        Progress::Moving { copied, total } => (
            "Moving your relay's data…".into(),
            if *total > 0 { format!("{} of {}. Members carry on through your church's other relays.", gb(*copied), gb(*total)) } else { "Members carry on through your church's other relays.".into() },
            "busy",
        ),
        Progress::Checking => ("Checking the copy…".into(), "Making sure every record arrived.".into(), "busy"),
        Progress::RolledBack => ("The relay didn't start from the new drive".into(), "It went back to the old folder. Nothing was lost.".into(), "note"),
        Progress::Notice(m) => ("Starting your relay…".into(), m.clone(), "note"),
        Progress::Refused { title, reason } => (title.clone(), reason.clone(), "bad"),
    }
}
pub fn pct(s: &str) -> String {
    let mut o = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
            o.push(b as char);
        } else {
            o.push_str(&format!("%{:02X}", b));
        }
    }
    o
}
/// The URL fragment the splash page (dist/index.html) reads: #t=<title>&s=<sub>&k=<kind>
pub fn splash_fragment(p: &Progress) -> String {
    let (t, s, k) = splash_text(p);
    format!("#t={}&s={}&k={}", pct(&t), pct(&s), k)
}

/// The gateway's refusal is written to stderr as
///   ✖ RELAY NOT STARTED: <why>\n    data folder: <dir>\n    <what to do>\n    (refusing rather than …)
/// -> (title, reason shown on the splash: why + what to do).
pub fn refusal_message(stderr: &str) -> (String, String) {
    let lines: Vec<&str> = stderr.lines().map(|l| l.trim()).collect();
    let i = lines.iter().rposition(|l| l.contains("RELAY NOT STARTED:"));
    if let Some(i) = i {
        let why = lines[i].split("RELAY NOT STARTED:").nth(1).unwrap_or("").trim().to_string();
        let todo: Vec<&str> = lines[i + 1..].iter().copied().filter(|l| !l.is_empty() && !l.starts_with("data folder:") && !l.starts_with("(refusing")).collect();
        let reason = if todo.is_empty() { why } else { format!("{} {}", why, todo.join(" ")) };
        return ("Your relay didn't start".into(), reason);
    }
    ("Your relay didn't start".into(), "It stopped before it could start, and chose not to run (exit 78). Open the app again; if this stays, the relay's data folder or drive needs attention.".into())
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("trin-launcher-{}-{}-{}", name, std::process::id(), now_iso().replace([':', '.'], "-")));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    // ── the pointer ─────────────────────────────────────────────────────────────────────────────────────
    #[test]
    fn resolve_absent_pointer_is_the_default() {
        let d = Path::new("/app/data");
        assert_eq!(resolve_data_dir(None, d), PathBuf::from("/app/data"));
        assert_eq!(resolve_data_dir(Some("{}"), d), PathBuf::from("/app/data"));
        assert_eq!(resolve_data_dir(Some("not json"), d), PathBuf::from("/app/data"));
    }
    #[test]
    fn resolve_pointer_wins_when_it_names_an_absolute_folder() {
        let d = Path::new("/app/data");
        let abs = if cfg!(windows) { "E:\\\\trinityone-relay" } else { "/media/me/T7/trinityone-relay" };
        let t = format!("{{\"dataDir\":\"{}\",\"relayPub\":\"ab\"}}", abs);
        assert_eq!(resolve_data_dir(Some(&t), d), PathBuf::from(abs.replace("\\\\", "\\")));
    }
    #[test]
    fn resolve_ignores_an_empty_or_relative_pointer() {
        let d = Path::new("/app/data");
        assert_eq!(resolve_data_dir(Some("{\"dataDir\":\"\"}"), d), PathBuf::from("/app/data"));
        assert_eq!(resolve_data_dir(Some("{\"dataDir\":\"relative/dir\"}"), d), PathBuf::from("/app/data"));
        assert_eq!(resolve_data_dir(Some("{\"dataDir\":5}"), d), PathBuf::from("/app/data"));
    }
    #[test]
    fn first_run_is_not_pinned_until_the_relay_has_a_key() {
        let d = tmp("pin");
        assert!(!should_pin(&d, false), "an empty folder on the very first run must not be pinned");
        fs::write(d.join("relay-key.json"), "{}").unwrap();
        assert!(should_pin(&d, false), "a folder with an identity is pinned");
        let e = tmp("pin2");
        assert!(should_pin(&e, true), "a folder the steward chose (a pointer exists) is always pinned");
    }
    #[test]
    fn key_pub_needs_a_secret_key_too() {
        let d = tmp("key");
        fs::write(d.join("relay-key.json"), "{\"pub\":\"aa\"}").unwrap();
        assert_eq!(key_pub_of(&d), None);
        fs::write(d.join("relay-key.json"), "{\"sk\":\"bb\",\"pub\":\"aa\"}").unwrap();
        assert_eq!(key_pub_of(&d), Some("aa".into()));
    }
    #[test]
    fn iso_time_is_right() {
        assert_eq!(iso_from_unix_ms(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_from_unix_ms(1_700_000_000_123), "2023-11-14T22:13:20.123Z");
        assert_eq!(iso_from_unix_ms(1_782_000_000_000), "2026-06-21T00:00:00.000Z");
    }
    #[test]
    fn state_is_written_whole_and_other_fields_survive() {
        let d = tmp("state");
        let f = d.join("cfg").join("storage.json");
        write_state(&f, &json!({ "dataDir": "/x", "move": { "state": "done" } })).unwrap();
        update_state(&f, |o| {
            o.insert("launcher".into(), json!({ "a": 1 }));
        });
        let v = read_state(&f);
        assert_eq!(v["dataDir"], "/x");
        assert_eq!(v["move"]["state"], "done");
        assert_eq!(v["launcher"]["a"], 1);
        assert!(!fs::read_dir(d.join("cfg")).unwrap().any(|e| e.unwrap().file_name().to_string_lossy().contains(".tmp-")), "a temp file was left behind");
    }

    // ── the answer of `recover` ──────────────────────────────────────────────────────────────────────────
    #[test]
    fn recovery_is_read_as_the_mover_means_it() {
        assert_eq!(read_recovery(&json!({"dataDir":"/a","action":"none"})), Recovery::Start { dir: Some("/a".into()), check: false, identity_changed: None });
        assert_eq!(read_recovery(&json!({"dataDir":"/b","action":"check"})), Recovery::Start { dir: Some("/b".into()), check: true, identity_changed: None });
        assert_eq!(read_recovery(&json!({"dataDir":null,"action":"none"})), Recovery::Start { dir: None, check: false, identity_changed: None });
        assert_eq!(read_recovery(&json!({"ok":false,"dataDir":null,"action":"refuse","code":"drive-missing"})), Recovery::Refuse { code: "drive-missing".into() });
        // an answer that is neither: never started on
        assert_eq!(read_recovery(&json!({"hello":1})), Recovery::Refuse { code: "recover-failed".into() });
        assert_eq!(
            read_recovery(&json!({"dataDir":"/a","action":"none","identityChanged":true,"expectedPub":"e","foundPub":"f"})),
            Recovery::Start { dir: Some("/a".into()), check: false, identity_changed: Some(("e".into(), "f".into())) }
        );
    }

    // ── the identity comparison ──────────────────────────────────────────────────────────────────────────
    #[test]
    fn identity_same_changed_unproven_and_unrecorded() {
        assert_eq!(compare_identity(Some("aa"), Some("aa")), Identity::Same);
        assert_eq!(compare_identity(Some("bb"), Some("aa")), Identity::Changed { expected: "aa".into(), proven: "bb".into() });
        // a relay that cannot prove a key is NEVER "same" — the bare /status string is not evidence (rule 10)
        assert_eq!(compare_identity(None, Some("aa")), Identity::Unproven { expected: "aa".into() });
        assert_eq!(compare_identity(Some("aa"), None), Identity::NothingRecorded { proven: Some("aa".into()) });
        assert_eq!(compare_identity(Some("aa"), Some("")), Identity::NothingRecorded { proven: Some("aa".into()) });
    }

    // ── the splash ───────────────────────────────────────────────────────────────────────────────────────
    #[test]
    fn splash_fragment_carries_the_text_and_is_url_safe() {
        let f = splash_fragment(&Progress::Refused { title: "Your relay didn't start".into(), reason: "the data folder is missing (drive?) & more".into() });
        assert!(f.starts_with("#t=Your%20relay%20didn%27t%20start&s=the%20data%20folder"), "{f}");
        assert!(f.ends_with("&k=bad"));
        assert!(!f.contains(' ') && !f.contains('\'') && f[1..].matches('#').count() == 0);
        assert!(splash_fragment(&Progress::Moving { copied: 1 << 30, total: 3 << 30 }).contains("1.0%20GB%20of%203.0%20GB"));
    }
    #[test]
    fn the_gateways_refusal_text_becomes_the_splash_reason() {
        let err = "\n  ✖ RELAY NOT STARTED: the relay's data folder is missing (is its drive unplugged, or did its drive letter change?).\n    data folder: /media/me/T7/trinityone-relay\n    Reconnect the drive that holds it, then start the relay again. Nothing has been created or changed.\n    (refusing rather than starting an empty relay with a new identity — exit 78)\n\n";
        let (t, r) = refusal_message(err);
        assert_eq!(t, "Your relay didn't start");
        assert!(r.starts_with("the relay's data folder is missing"), "{r}");
        assert!(r.contains("Reconnect the drive that holds it"), "{r}");
        assert!(!r.contains("data folder: /media"), "the splash must not repeat the path line: {r}");
        // an exit 78 with nothing readable still says something, never a blank page
        assert!(refusal_message("").1.contains("exit 78"));
    }

    // ── the old-copy remover ─────────────────────────────────────────────────────────────────────────────
    fn old_copy(base: &Path) -> PathBuf {
        let o = base.join("old");
        fs::create_dir_all(o.join("blobs")).unwrap();
        fs::write(o.join("relay.sqlite"), "x").unwrap();
        fs::write(o.join("blobs").join("a"), "y").unwrap();
        fs::write(o.join(MOVED_TO), "moved").unwrap();
        o
    }
    #[test]
    fn remove_old_empties_the_copy_and_keeps_only_the_tombstone() {
        let b = tmp("rm1");
        let live = b.join("live");
        fs::create_dir_all(&live).unwrap();
        fs::write(live.join("relay.sqlite"), "live").unwrap();
        let o = old_copy(&b);
        remove_old_copy(&o, &live).unwrap();
        let left: Vec<_> = fs::read_dir(&o).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(left, vec![MOVED_TO.to_string()]);
        assert!(live.join("relay.sqlite").exists(), "the live folder was touched");
    }
    #[test]
    fn remove_old_refuses_the_live_folder_in_every_shape() {
        let b = tmp("rm2");
        let live = b.join("live");
        fs::create_dir_all(&live).unwrap();
        fs::write(live.join(MOVED_TO), "x").unwrap(); // even a marked one
        fs::write(live.join("relay.sqlite"), "live").unwrap();
        // the live folder itself
        assert_eq!(remove_old_copy(&live, &live), Err("current-folder".into()));
        // a folder that CONTAINS the live folder
        let outer = b.join("outer");
        fs::create_dir_all(&outer).unwrap();
        fs::write(outer.join(MOVED_TO), "x").unwrap();
        let inner_live = outer.join("trinityone-relay");
        fs::create_dir_all(&inner_live).unwrap();
        fs::write(inner_live.join("relay.sqlite"), "live").unwrap();
        assert_eq!(remove_old_copy(&outer, &inner_live), Err("current-folder".into()));
        // a folder INSIDE the live folder
        let inside = live.join("sub");
        fs::create_dir_all(&inside).unwrap();
        fs::write(inside.join(MOVED_TO), "x").unwrap();
        assert_eq!(remove_old_copy(&inside, &live), Err("current-folder".into()));
        assert!(live.join("relay.sqlite").exists() && inner_live.join("relay.sqlite").exists());
    }
    #[cfg(unix)]
    #[test]
    fn remove_old_refuses_a_link_to_the_live_folder_and_never_follows_one() {
        use std::os::unix::fs::symlink;
        let b = tmp("rm3");
        let live = b.join("live");
        fs::create_dir_all(&live).unwrap();
        fs::write(live.join("relay.sqlite"), "live").unwrap();
        fs::write(live.join(MOVED_TO), "x").unwrap();
        // the "old copy" path has been swapped for a symlink to the live folder (the TOCTOU)
        let link = b.join("old");
        symlink(&live, &link).unwrap();
        assert_eq!(remove_old_copy(&link, &live), Err("target-is-a-link".into()));
        // a link INSIDE the old copy is unlinked, never entered
        let o = old_copy(&b.join("x"));
        symlink(&live, o.join("sneaky")).unwrap();
        remove_old_copy(&o, &live).unwrap();
        assert!(live.join("relay.sqlite").exists(), "the live folder was deleted THROUGH a symlink");
        assert!(!o.join("sneaky").exists());
    }
    #[test]
    fn remove_old_only_touches_a_folder_the_mover_marked() {
        let b = tmp("rm4");
        let live = b.join("live");
        fs::create_dir_all(&live).unwrap();
        let notes = b.join("my-documents");
        fs::create_dir_all(&notes).unwrap();
        fs::write(notes.join("thesis.doc"), "precious").unwrap();
        assert_eq!(remove_old_copy(&notes, &live), Err("not-marked-moved".into()));
        assert!(notes.join("thesis.doc").exists());
        // already gone is fine
        assert_eq!(remove_old_copy(&b.join("nowhere"), &live), Ok(()));
    }
    #[test]
    fn a_removal_names_only_what_the_journal_recorded() {
        let st = json!({ "move": { "state": "awaiting-confirm", "oldCopy": { "path": "/old", "since": "s" },
            "leftovers": [ { "path": "/l1", "kind": "tombstone" }, { "path": "/l2", "removedAt": "t" } ] } });
        assert!(recorded_for_removal(&st, "/old", "old-copy"));
        assert!(!recorded_for_removal(&st, "/etc", "old-copy"));
        assert!(!recorded_for_removal(&st, "/old", "leftover"));
        assert!(recorded_for_removal(&st, "/l1", "leftover"));
        assert!(!recorded_for_removal(&st, "/l2", "leftover"), "a leftover already removed is not offered again");
        // once the move is 'done' the old copy is not recorded any more
        let done = json!({ "move": { "state": "done", "oldCopy": { "path": "/old" } } });
        assert!(!recorded_for_removal(&done, "/old", "old-copy"));
        assert!(!recorded_for_removal(&json!({}), "/old", "old-copy"));
    }
    #[test]
    fn marking_a_removal_sets_removed_at_and_ends_the_move_but_keeps_since() {
        let mut st = json!({ "move": { "state": "awaiting-confirm", "oldCopy": { "path": "/old", "since": "S" }, "leftovers": [ { "path": "/l1", "since": "L" } ] } });
        mark_removed(&mut st, "/l1", "leftover", "T");
        assert_eq!(st["move"]["leftovers"][0]["removedAt"], "T");
        assert_eq!(st["move"]["state"], "awaiting-confirm", "removing a leftover must not end the move");
        assert_eq!(st["move"]["leftovers"][0]["since"], "L");
        mark_removed(&mut st, "/old", "old-copy", "T2");
        assert_eq!(st["move"]["state"], "done");
        assert_eq!(st["move"]["oldCopyRemovedAt"], "T2");
        assert!(st["move"]["oldCopy"].is_null());
    }

    // ── the flow, with a scripted mover ─────────────────────────────────────────────────────────────────
    struct FakeRelay {
        exit: Mutex<Option<Exit>>,
        err: String,
    }
    impl RelayHandle for FakeRelay {
        fn exit(&self) -> Option<Exit> {
            self.exit.lock().unwrap().clone()
        }
        fn stderr_tail(&self) -> String {
            self.err.clone()
        }
        fn kill(&self) {
            *self.exit.lock().unwrap() = Some(Exit::Other);
        }
    }
    struct Fake {
        calls: Mutex<Vec<String>>,
        answers: Mutex<Vec<(&'static str, Value)>>,
        spawns: Mutex<Vec<(PathBuf, bool)>>,
        relays: Mutex<Vec<(Option<Exit>, String)>>,
        port_after: Mutex<u32>,
        bump: Mutex<Option<(PathBuf, u64)>>,
        bump_key: Mutex<&'static str>,
        progresses: Mutex<Vec<String>>,
        // the host hooks (integration with the Suite auto-update): scripted ticks, a move refusal, a start refusal
        ticks: Mutex<Vec<&'static str>>,
        blocked: Mutex<Option<String>>,
        before: Mutex<Option<(String, String)>>,
        checking: Mutex<Vec<bool>>,
    }
    impl Fake {
        fn new(answers: Vec<(&'static str, Value)>, relays: Vec<(Option<Exit>, &str)>) -> Fake {
            Fake { calls: Mutex::new(vec![]), answers: Mutex::new(answers), spawns: Mutex::new(vec![]), relays: Mutex::new(relays.into_iter().map(|(e, s)| (e, s.to_string())).collect()), port_after: Mutex::new(0), bump: Mutex::new(None), bump_key: Mutex::new("copiedBytes"), progresses: Mutex::new(vec![]), ticks: Mutex::new(vec![]), blocked: Mutex::new(None), before: Mutex::new(None), checking: Mutex::new(vec![]) }
        }
        fn calls(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }
    }
    impl Host for Fake {
        fn node(&self, args: &[String]) -> NodeOut {
            let sub = args[1].clone();
            self.calls.lock().unwrap().push(sub.clone());
            let mut a = self.answers.lock().unwrap();
            let pos = a.iter().position(|(k, _)| *k == sub);
            let v = match pos {
                Some(i) => a.remove(i).1,
                None => json!({"ok": false, "code": "unscripted"}),
            };
            NodeOut { code: 0, stdout: format!("{}\n", v), stderr: String::new() }
        }
        fn spawn_relay(&self, env: &RelayEnv) -> Result<Box<dyn RelayHandle>, String> {
            self.calls.lock().unwrap().push("SPAWN".into());
            self.spawns.lock().unwrap().push((env.data_dir.clone(), env.pinned));
            self.checking.lock().unwrap().push(env.checking);
            let (e, s) = self.relays.lock().unwrap().remove(0);
            Ok(Box::new(FakeRelay { exit: Mutex::new(e), err: s }))
        }
        fn progress(&self, p: &Progress) {
            self.progresses.lock().unwrap().push(format!("{:?}", p));
        }
        fn opened(&self, _d: &Path) {
            self.calls.lock().unwrap().push("OPENED".into());
        }
        fn log(&self, _m: &str) {}
        // the app "closes" once a page has opened, every scripted tick has been given, and every relay a tick put in
        // place has had its page opened too
        fn quitting(&self) -> bool {
            let c = self.calls.lock().unwrap();
            let opened = c.iter().filter(|x| *x == "OPENED").count();
            let replaced = c.iter().filter(|x| *x == "TICK:replace").count();
            opened > replaced && self.ticks.lock().unwrap().is_empty()
        }
        fn before_start(&self, _d: &Path) -> Result<(), (String, String)> {
            self.calls.lock().unwrap().push("BEFORE_START".into());
            match self.before.lock().unwrap().clone() {
                Some(e) => Err(e),
                None => Ok(()),
            }
        }
        fn tick(&self, _d: &Path) -> Tick {
            let mut t = self.ticks.lock().unwrap();
            if t.is_empty() {
                return Tick::None;
            }
            let what = t.remove(0);
            self.calls.lock().unwrap().push(format!("TICK:{what}"));
            match what {
                "replace" => Tick::Replaced(Box::new(FakeRelay { exit: Mutex::new(None), err: String::new() })),
                _ => Tick::None,
            }
        }
        fn move_blocked(&self, _d: &Path) -> Option<String> {
            self.blocked.lock().unwrap().clone()
        }
        fn port_open(&self, _p: u16) -> bool {
            let mut n = self.port_after.lock().unwrap();
            if *n > 0 {
                *n -= 1;
                return false;
            }
            true
        }
        fn sleep_ms(&self, _ms: u64) {
            // a mover that is making progress: its journal's copiedBytes grows each second
            if let Some((f, n)) = self.bump.lock().unwrap().as_mut() {
                *n += 1;
                let key = *self.bump_key.lock().unwrap();
                update_state(f, |o| {
                    let mv = match key {
                        "integrity" => json!({"state": "verifying", "phase": "integrity", "totalBytes": 1000}),
                        k => json!({"state": "verifying", k: *n, "totalBytes": 1000}),
                    };
                    o.insert("move".into(), mv);
                });
            }
        }
    }
    fn cfg_in(b: &Path) -> Config {
        Config { config_file: b.join("cfg").join("storage.json"), default_data: b.join("data"), port: 18787, up_steps: 3, log_path: b.join("relay-launch.log"), mover_wait_ms: 600_000, check_steps: 2 }
    }
    fn first(calls: &[String], what: &str) -> usize {
        calls.iter().position(|c| c == what).unwrap_or_else(|| panic!("{what} never happened: {calls:?}"))
    }

    #[test]
    fn recover_runs_before_the_relay_is_spawned_and_begin_check_before_the_relay_after_a_move() {
        let b = tmp("flow1");
        let cfg = cfg_in(&b);
        let newdir = b.join("T7").join("trinityone-relay");
        fs::create_dir_all(&newdir).unwrap();
        let f = Fake::new(
            vec![
                ("recover", json!({"dataDir": newdir.to_string_lossy(), "action": "check"})),
                ("begin-check", json!({"ok": true, "bad": []})),
                ("prove", json!({"ok": true, "relayPub": "aa"})),
                ("verify-restart", json!({"ok": true, "bad": []})),
                ("check-passed", json!({"ok": true})),
                ("prove", json!({"ok": true, "relayPub": "aa"})),
            ],
            vec![(None, "")],
        );
        write_state(&cfg.config_file, &json!({"dataDir": newdir.to_string_lossy(), "relayPub": "aa", "move": {"state":"switched"}})).unwrap();
        let end = run(&f, &cfg);
        let c = f.calls();
        assert!(first(&c, "recover") < first(&c, "SPAWN"), "recover must run before the relay is spawned: {c:?}");
        assert!(first(&c, "begin-check") < first(&c, "SPAWN"), "begin-check must run BEFORE the relay is spawned: {c:?}");
        assert!(first(&c, "SPAWN") < first(&c, "verify-restart") && first(&c, "verify-restart") < first(&c, "check-passed"));
        assert_eq!(f.spawns.lock().unwrap()[0], (newdir, true), "the relay must start on the pointer's folder, pinned");
        assert_eq!(end, RunEnd::Quit);
        assert_eq!(read_state(&cfg.config_file)["launcher"].get("identityChanged"), None, "a matching proof must leave no identity warning");
    }
    #[test]
    fn a_failed_begin_check_rolls_back_and_the_relay_is_not_started_on_the_new_folder() {
        let b = tmp("flow2");
        let cfg = cfg_in(&b);
        let newdir = b.join("T7").join("x");
        let olddir = b.join("data");
        let f = Fake::new(
            vec![
                ("recover", json!({"dataDir": newdir.to_string_lossy(), "action": "check"})),
                ("begin-check", json!({"ok": false, "bad": ["event-count"]})),
                ("rollback", json!({"ok": true, "dataDir": olddir.to_string_lossy()})),
                ("recover", json!({"dataDir": olddir.to_string_lossy(), "action": "none"})),
                ("prove", json!({"ok": true, "relayPub": "aa"})),
            ],
            vec![(Some(Exit::Code(3)), "")],
        );
        fs::create_dir_all(&olddir).unwrap();
        let _ = run(&f, &cfg);
        let c = f.calls();
        assert!(first(&c, "rollback") < first(&c, "SPAWN"), "rolled back before any spawn: {c:?}");
        assert_eq!(f.spawns.lock().unwrap()[0].0, olddir, "the relay was started on the new folder after a failed check");
    }
    #[test]
    fn an_identity_that_does_not_prove_fails_the_check_even_when_everything_else_looks_fine() {
        let b = tmp("flow3");
        let cfg = cfg_in(&b);
        let newdir = b.join("T7").join("trinityone-relay");
        let olddir = b.join("data");
        fs::create_dir_all(&olddir).unwrap();
        // verify-restart says ok (a lying or old mover), but the relay's proof is for a different key
        let f = Fake::new(
            vec![
                ("recover", json!({"dataDir": newdir.to_string_lossy(), "action": "check"})),
                ("begin-check", json!({"ok": true, "bad": []})),
                ("prove", json!({"ok": true, "relayPub": "STRANGER"})),
                ("verify-restart", json!({"ok": true, "bad": []})),
                ("rollback", json!({"ok": true})),
                ("recover", json!({"dataDir": olddir.to_string_lossy(), "action": "none"})),
                ("prove", json!({"ok": true, "relayPub": "aa"})),
            ],
            vec![(None, ""), (Some(Exit::Code(3)), "")],
        );
        write_state(&cfg.config_file, &json!({"dataDir": newdir.to_string_lossy(), "relayPub": "aa", "move": {"state":"switched"}})).unwrap();
        let _ = run(&f, &cfg);
        let c = f.calls();
        assert!(c.contains(&"rollback".to_string()), "a relay that proves a different key must be rolled back: {c:?}");
        assert!(!c.contains(&"check-passed".to_string()), "the move was confirmed for a stranger: {c:?}");
    }
    #[test]
    fn exit_78_shows_the_reason_and_does_not_restart_or_open_a_page() {
        let b = tmp("flow4");
        let cfg = cfg_in(&b);
        let err = "  ✖ RELAY NOT STARTED: the relay's data folder is missing (is its drive unplugged?).\n    Reconnect the drive that holds it.\n";
        let f = Fake::new(vec![("recover", json!({"dataDir": null, "action": "none"}))], vec![(Some(Exit::Code(78)), err)]);
        let end = run(&f, &cfg);
        match end {
            RunEnd::Refused(r) => assert!(r.contains("data folder is missing") && r.contains("Reconnect the drive"), "{r}"),
            other => panic!("{other:?}"),
        }
        assert!(!f.calls().contains(&"OPENED".to_string()), "a refused relay opened a page");
        assert_eq!(f.spawns.lock().unwrap().len(), 1, "a refusal must not be retried in a loop");
        let st = read_state(&cfg.config_file);
        assert_eq!(st["launcher"]["lastRefusal"]["kind"], "start");
    }
    #[test]
    fn a_refused_move_is_recorded_and_the_request_is_never_recreated() {
        let b = tmp("flow5");
        let cfg = cfg_in(&b);
        let data = b.join("data");
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join(MOVE_REQUEST), "{\"drive\":\"/media/x\"}").unwrap();
        let f = Fake::new(
            vec![
                ("recover", json!({"dataDir": data.to_string_lossy(), "action": "none"})),
                ("prove", json!({"ok": true, "relayPub": "aa"})),
                ("move", json!({"ok": false, "code": "target-ineligible", "detail": "not-enough-space"})),
                ("recover", json!({"dataDir": data.to_string_lossy(), "action": "none"})),
                ("prove", json!({"ok": true, "relayPub": "aa"})),
            ],
            vec![(Some(Exit::Code(0)), ""), (Some(Exit::Code(3)), "")],
        );
        let _ = run(&f, &cfg);
        assert!(!data.join(MOVE_REQUEST).exists(), "the .move-request is still there, or was put back");
        let st = read_state(&cfg.config_file);
        assert_eq!(st["launcher"]["lastRefusal"]["code"], "target-ineligible");
        assert_eq!(st["launcher"]["lastRefusal"]["detail"], "not-enough-space");
        assert_eq!(st["launcher"]["lastRefusal"]["kind"], "move");
        // and it started the relay again afterwards
        assert_eq!(f.spawns.lock().unwrap().len(), 2);
    }
    #[test]
    fn the_move_asks_the_mover_for_the_drive_only_never_the_target_in_the_request() {
        let b = tmp("flow6");
        let cfg = cfg_in(&b);
        let data = b.join("data");
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join(MOVE_REQUEST), "{\"drive\":\"/media/x\",\"target\":\"/etc/evil\",\"from\":\"/root\"}").unwrap();
        struct Rec(Fake, Mutex<Vec<Vec<String>>>);
        impl Host for Rec {
            fn node(&self, a: &[String]) -> NodeOut {
                if a[1] == "move" {
                    self.1.lock().unwrap().push(a.to_vec());
                }
                self.0.node(a)
            }
            fn spawn_relay(&self, e: &RelayEnv) -> Result<Box<dyn RelayHandle>, String> {
                self.0.spawn_relay(e)
            }
            fn progress(&self, p: &Progress) {
                self.0.progress(p)
            }
            fn opened(&self, d: &Path) {
                self.0.opened(d)
            }
            fn log(&self, m: &str) {
                self.0.log(m)
            }
            fn quitting(&self) -> bool {
                self.0.quitting()
            }
            fn port_open(&self, p: u16) -> bool {
                self.0.port_open(p)
            }
            fn sleep_ms(&self, _m: u64) {}
        }
        let inner = Fake::new(
            vec![
                ("recover", json!({"dataDir": data.to_string_lossy(), "action": "none"})),
                ("prove", json!({"ok": true, "relayPub": "aa"})),
                ("move", json!({"ok": false, "code": "x"})),
                ("recover", json!({"dataDir": data.to_string_lossy(), "action": "none"})),
                ("prove", json!({"ok": true, "relayPub": "aa"})),
            ],
            vec![(Some(Exit::Code(0)), ""), (Some(Exit::Code(3)), "")],
        );
        let h = Rec(inner, Mutex::new(vec![]));
        let _ = run(&h, &cfg);
        let m = h.1.lock().unwrap();
        let args = m[0].join(" ");
        assert!(args.contains("--drive /media/x"), "{args}");
        assert!(!args.contains("/etc/evil") && !args.contains("/root"), "the mover was handed a path from the request: {args}");
        assert!(args.contains(&format!("--from {}", data.to_string_lossy())), "{args}");
    }
    #[test]
    fn a_changed_identity_is_recorded_for_the_card_and_a_matching_one_clears_it() {
        let b = tmp("flow7");
        let cfg = cfg_in(&b);
        let data = b.join("data");
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join("relay-key.json"), "{\"sk\":\"s\",\"pub\":\"recorded\"}").unwrap();
        // the port is answered by a relay that proves a DIFFERENT key than the folder holds
        let f = Fake::new(
            vec![("recover", json!({"dataDir": data.to_string_lossy(), "action": "none"})), ("prove", json!({"ok": true, "relayPub": "someone-else"}))],
            vec![(None, "")],
        );
        assert_eq!(run(&f, &cfg), RunEnd::Quit);
        let st = read_state(&cfg.config_file);
        assert_eq!(st["launcher"]["identityChanged"]["expectedPub"], "recorded");
        assert_eq!(st["launcher"]["identityChanged"]["provenPub"], "someone-else");
        // next start: it proves the recorded key -> the warning is cleared
        let f2 = Fake::new(
            vec![("recover", json!({"dataDir": data.to_string_lossy(), "action": "none"})), ("prove", json!({"ok": true, "relayPub": "recorded"}))],
            vec![(None, "")],
        );
        assert_eq!(run(&f2, &cfg), RunEnd::Quit);
        assert!(read_state(&cfg.config_file)["launcher"].get("identityChanged").is_none());
        // a relay that cannot prove anything is recorded too, never treated as the same
        let f3 = Fake::new(
            vec![("recover", json!({"dataDir": data.to_string_lossy(), "action": "none"})), ("prove", json!({"ok": false, "code": "unreachable"}))],
            vec![(None, "")],
        );
        assert_eq!(run(&f3, &cfg), RunEnd::Quit);
        assert!(read_state(&cfg.config_file)["launcher"]["identityChanged"]["provenPub"].is_null());
    }

    #[test]
    fn a_slow_start_is_never_killed_and_the_splash_is_told() {
        let b = tmp("slow");
        let cfg = cfg_in(&b); // up_steps 3
        let data = b.join("data");
        fs::create_dir_all(&data).unwrap();
        let f = Fake::new(vec![("recover", json!({"dataDir": data.to_string_lossy(), "action": "none"})), ("prove", json!({"ok": true, "relayPub": "aa"}))], vec![(None, "")]);
        *f.port_after.lock().unwrap() = 40; // the port opens only after 40 polls: far past up_steps
        assert_eq!(run(&f, &cfg), RunEnd::Quit);
        let c = f.calls();
        assert!(c.contains(&"OPENED".to_string()), "a slow relay was abandoned: {c:?}");
        assert_eq!(f.spawns.lock().unwrap().len(), 1, "a slow relay was restarted");
        let p = f.progresses.lock().unwrap().join("|");
        assert!(p.contains("Still starting") && p.contains("relay-launch.log"), "{p}");
    }
    #[test]
    fn an_exit_that_is_not_78_says_so_with_the_log_path() {
        let b = tmp("exit1");
        let cfg = cfg_in(&b);
        let f = Fake::new(vec![("recover", json!({"dataDir": null, "action": "none"}))], vec![(Some(Exit::Code(1)), "")]);
        assert_eq!(run(&f, &cfg), RunEnd::Stopped(Some(1)));
        let p = f.progresses.lock().unwrap().join("|");
        assert!(p.contains("Refused") && p.contains("exit 1") && p.contains("relay-launch.log"), "{p}");
    }
    #[test]
    fn a_running_mover_is_waited_for_before_recover_or_spawn() {
        let b = tmp("lock");
        let cfg = cfg_in(&b);
        let f = Fake::new(
            vec![
                ("lock-status", json!({"held": true})),
                ("lock-status", json!({"held": true})),
                ("lock-status", json!({"held": false})),
                ("recover", json!({"dataDir": null, "action": "none"})),
                ("prove", json!({"ok": true, "relayPub": "aa"})),
            ],
            vec![(None, "")],
        );
        let _ = run(&f, &cfg);
        let c = f.calls();
        let last_lock = c.iter().rposition(|x| x == "lock-status").unwrap();
        assert_eq!(c.iter().filter(|x| *x == "lock-status").count(), 3, "{c:?}");
        assert!(last_lock < first(&c, "recover") && first(&c, "recover") < first(&c, "SPAWN"), "recover/spawn ran while a mover was held: {c:?}");
        assert!(f.progresses.lock().unwrap().iter().any(|p| p.starts_with("Moving")), "the splash was not told");
    }

    #[test]
    fn a_mover_that_never_finishes_ends_in_a_message_with_the_log_path_and_the_lock_file() {
        let b = tmp("stuck");
        let mut cfg = cfg_in(&b);
        cfg.mover_wait_ms = 3000;
        let held: Vec<(&'static str, Value)> = (0..10).map(|_| ("lock-status", json!({"held": true}))).collect();
        let f = Fake::new(held, vec![]);
        match run(&f, &cfg) {
            RunEnd::Refused(r) => assert!(r.contains("relay-launch.log") && !r.contains("delete the file"), "{r}"),
            other => panic!("{other:?}"),
        }
        assert!(!f.calls().contains(&"SPAWN".to_string()) && !f.calls().contains(&"recover".to_string()), "{:?}", f.calls());
        assert_eq!(read_state(&cfg.config_file)["launcher"]["lastRefusal"]["code"], "mover-stuck");
    }

    #[test]
    fn a_slow_but_progressing_move_is_never_called_stuck_and_one_without_progress_is() {
        let b = tmp("prog");
        let mut cfg = cfg_in(&b);
        cfg.mover_wait_ms = 3000;
        // 12 seconds held, far past 3 s, but the journal's copiedBytes moves every second -> never stuck
        let mut a: Vec<(&'static str, Value)> = (0..12).map(|_| ("lock-status", json!({"held": true, "alive": true}))).collect();
        a.push(("lock-status", json!({"held": false})));
        a.push(("recover", json!({"dataDir": null, "action": "none"})));
        a.push(("prove", json!({"ok": true, "relayPub": "aa"})));
        let f = Fake::new(a, vec![(None, "")]);
        *f.bump.lock().unwrap() = Some((cfg.config_file.clone(), 0));
        assert_eq!(run(&f, &cfg), RunEnd::Quit, "a progressing move was called stuck: {:?}", f.progresses.lock().unwrap());
        assert!(f.calls().contains(&"SPAWN".to_string()));
        // the same 12 seconds with NO progress is stuck
        let b2 = tmp("noprog");
        let mut cfg2 = cfg_in(&b2);
        cfg2.mover_wait_ms = 3000;
        let a2: Vec<(&'static str, Value)> = (0..12).map(|_| ("lock-status", json!({"held": true, "alive": true}))).collect();
        let f2 = Fake::new(a2, vec![]);
        assert!(matches!(run(&f2, &cfg2), RunEnd::Refused(_)));
        assert!(!f2.calls().contains(&"SPAWN".to_string()));
    }
    #[test]
    fn the_stuck_message_never_says_delete_the_lock_while_the_mover_may_be_alive() {
        for (alive, delete) in [(Some(true), false), (None, false), (Some(false), true)] {
            let b = tmp("msg");
            let mut cfg = cfg_in(&b);
            cfg.mover_wait_ms = 2000;
            let ls = match alive { Some(a) => json!({"held": true, "alive": a}), None => json!({"held": true}) };
            let f = Fake::new((0..8).map(|_| ("lock-status", ls.clone())).collect(), vec![]);
            let r = match run(&f, &cfg) { RunEnd::Refused(r) => r, o => panic!("{o:?}") };
            assert_eq!(r.contains("delete the file"), delete, "alive={alive:?}: {r}");
            assert!(r.contains("relay-launch.log"));
        }
    }

    #[test]
    fn a_long_verify_is_not_stuck_hashing_progress_counts_and_the_integrity_phase_is_busy() {
        for key in ["verifiedBytes", "integrity"] {
            let b = tmp("verify");
            let mut cfg = cfg_in(&b);
            cfg.mover_wait_ms = 3000;
            let mut a: Vec<(&'static str, Value)> = (0..12).map(|_| ("lock-status", json!({"held": true, "alive": true}))).collect();
            a.push(("lock-status", json!({"held": false})));
            a.push(("recover", json!({"dataDir": null, "action": "none"})));
            a.push(("prove", json!({"ok": true, "relayPub": "aa"})));
            let f = Fake::new(a, vec![(None, "")]);
            *f.bump.lock().unwrap() = Some((cfg.config_file.clone(), 0));
            *f.bump_key.lock().unwrap() = key;
            assert_eq!(run(&f, &cfg), RunEnd::Quit, "{key}: a long verify was called stuck: {:?}", f.progresses.lock().unwrap());
        }
    }

    // ── the host hooks: the Suite's code auto-update runs INSIDE this loop (integration 2026-11-13) ──────────
    #[test]
    fn the_hosts_own_recovery_runs_after_the_movers_and_before_begin_check_and_a_refusal_starts_nothing() {
        let b = tmp("hook1");
        let cfg = cfg_in(&b);
        let newdir = b.join("T7").join("trinityone-relay");
        fs::create_dir_all(&newdir).unwrap();
        write_state(&cfg.config_file, &json!({"dataDir": newdir.to_string_lossy(), "relayPub": "aa", "move": {"state":"switched"}})).unwrap();
        // 1. the host refuses (an update's restore left the church's data held aside): nothing is counted or started
        let f = Fake::new(vec![("recover", json!({"dataDir": newdir.to_string_lossy(), "action": "check"}))], vec![]);
        *f.before.lock().unwrap() = Some(("Your church's data needs attention".into(), "held aside".into()));
        let end = run(&f, &cfg);
        let c = f.calls();
        assert!(first(&c, "recover") < first(&c, "BEFORE_START"), "the mover's recovery settles the folder first: {c:?}");
        assert!(!c.contains(&"begin-check".to_string()) && !c.contains(&"SPAWN".to_string()), "a host refusal must start and count nothing: {c:?}");
        assert_eq!(end, RunEnd::Refused("held aside".into()));
        assert_eq!(read_state(&cfg.config_file)["launcher"]["lastRefusal"]["code"], "host-refused");
        // 2. the host is content: its recovery still runs before the check counts the store and before the spawn,
        //    and the spawn is told it is a move's check (so the Suite applies no update before it)
        let f = Fake::new(
            vec![
                ("recover", json!({"dataDir": newdir.to_string_lossy(), "action": "check"})),
                ("begin-check", json!({"ok": true, "bad": []})),
                ("prove", json!({"ok": true, "relayPub": "aa"})),
                ("verify-restart", json!({"ok": true, "bad": []})),
                ("check-passed", json!({"ok": true})),
            ],
            vec![(None, "")],
        );
        let _ = run(&f, &cfg);
        let c = f.calls();
        assert!(first(&c, "BEFORE_START") < first(&c, "begin-check") && first(&c, "begin-check") < first(&c, "SPAWN"), "{c:?}");
        assert_eq!(f.checking.lock().unwrap()[0], true, "the start after a move must be marked as its check");
    }

    #[test]
    fn a_relay_the_host_replaces_is_proven_again_and_the_host_ticks_only_after_the_check() {
        let b = tmp("hook2");
        let cfg = cfg_in(&b);
        let newdir = b.join("T7").join("trinityone-relay");
        fs::create_dir_all(&newdir).unwrap();
        write_state(&cfg.config_file, &json!({"dataDir": newdir.to_string_lossy(), "relayPub": "aa", "move": {"state":"switched"}})).unwrap();
        let f = Fake::new(
            vec![
                ("recover", json!({"dataDir": newdir.to_string_lossy(), "action": "check"})),
                ("begin-check", json!({"ok": true, "bad": []})),
                ("prove", json!({"ok": true, "relayPub": "aa"})),
                ("verify-restart", json!({"ok": true, "bad": []})),
                ("check-passed", json!({"ok": true})),
                // the relay an update put in place proves a DIFFERENT key: the launcher must notice
                ("prove", json!({"ok": true, "relayPub": "STRANGER"})),
            ],
            vec![(None, "")],
        );
        *f.ticks.lock().unwrap() = vec!["replace"];
        let end = run(&f, &cfg);
        let c = f.calls();
        assert_eq!(end, RunEnd::Quit);
        assert!(first(&c, "check-passed") < first(&c, "TICK:replace"), "an update may only run after the move's check passed: {c:?}");
        let proves: Vec<usize> = c.iter().enumerate().filter(|(_, x)| *x == "prove").map(|(i, _)| i).collect();
        let opens: Vec<usize> = c.iter().enumerate().filter(|(_, x)| *x == "OPENED").map(|(i, _)| i).collect();
        assert_eq!((proves.len(), opens.len()), (2, 2), "the replaced relay must be proven and the panel reopened: {c:?}");
        assert!(first(&c, "TICK:replace") < proves[1] && proves[1] < opens[1], "prove BEFORE the panel is shown again: {c:?}");
        assert_eq!(f.spawns.lock().unwrap().len(), 1, "the launcher must adopt the host's relay, not start a second one");
        assert_eq!(read_state(&cfg.config_file)["launcher"]["identityChanged"]["provenPub"], "STRANGER", "a changed identity after an update must be recorded");
    }

    #[test]
    fn a_move_is_refused_while_the_host_has_an_update_half_done() {
        let b = tmp("hook3");
        let cfg = cfg_in(&b);
        let data = b.join("data");
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join(MOVE_REQUEST), "{\"drive\":\"/media/x\"}").unwrap();
        let f = Fake::new(
            vec![
                ("recover", json!({"dataDir": data.to_string_lossy(), "action": "none"})),
                ("recover", json!({"dataDir": data.to_string_lossy(), "action": "none"})),
                ("prove", json!({"ok": true, "relayPub": "aa"})),
                ("move", json!({"ok": true})),
            ],
            // the relay stops itself for the move (exit 0 with .move-request), then is started again
            vec![(Some(Exit::Code(0)), ""), (None, "")],
        );
        *f.blocked.lock().unwrap() = Some("suite-update-applying".into());
        let _ = run(&f, &cfg);
        let c = f.calls();
        assert!(!c.contains(&"move".to_string()), "the mover was run while the host had an update half done: {c:?}");
        assert!(!data.join(MOVE_REQUEST).exists(), "one request, one attempt: the refused request must be consumed");
        let st = read_state(&cfg.config_file);
        assert_eq!(st["launcher"]["lastRefusal"]["kind"], "move");
        assert_eq!(st["launcher"]["lastRefusal"]["code"], "suite-update-applying", "the card must be told why");
        assert_eq!(f.spawns.lock().unwrap().len(), 2, "the relay must be started again on the same folder");
    }
}
