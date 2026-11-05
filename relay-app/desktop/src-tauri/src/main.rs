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
use std::path::Path;
use std::sync::Mutex;
use std::{thread, time::Duration};
use tauri::{Manager, WindowEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const PORT: u16 = 8787;

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

            // start the relay: bundled node scripts/gateway.mjs <port> (cwd = payload), data → writable dir,
            // bound to loopback so there's no firewall prompt.
            let cmd = match app.shell().sidecar("trinityone-relay-node") {
                Ok(c) => c,
                Err(e) => {
                    applog(&log, &format!("SIDECAR RESOLVE FAILED: {e}"));
                    return Ok(());
                }
            };
            let cmd = cmd
                .current_dir(payload.clone())
                .arg("scripts/gateway.mjs")
                .arg(PORT.to_string())
                .env("TRINITY_DATA_DIR", data_dir.to_string_lossy().to_string())
                // the bundled cloudflared, so the relay can start a Cloudflare quick tunnel ("go public") itself
                .env("CLOUDFLARED_BIN", std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join(if cfg!(windows) { "trinityone-cloudflared.exe" } else { "trinityone-cloudflared" }))).map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|| "cloudflared".into()))
                // BIND ADDRESS. Loopback by default: the app window reaches the relay via 127.0.0.1, and nothing
                // else on the network can. A church that wants phones on its own wifi to connect directly turns
                // that on in the control panel, which writes the `lan-access` marker read here at start-up.
                //
                // AUDIT-2026-07-27: this used to set no RELAY_HOST at all, so the gateway took its server default
                // of 0.0.0.0 and the desktop relay was reachable by anyone on the same network — a church hall's
                // guest wifi, a coffee shop — while the comment here AND the one on BIND_HOST in gateway.mjs both
                // stated it bound loopback. Two comments asserting a protection that was not implemented.
                //
                // Windows shows a one-time "allow network access?" prompt when this is on; the loopback path works
                // regardless of the answer, so a missed prompt never stalls the app — it just gates OTHER devices.
                .env("RELAY_HOST", if data_dir.join("lan-access").exists() { "0.0.0.0" } else { "127.0.0.1" })
                .env("RELAY_NO_OPEN", "1"); // the Tauri window IS the control UI; don't also open a browser
            match cmd.spawn() {
                Ok((mut rx, child)) => {
                    applog(&log, "sidecar spawned OK");
                    *app.state::<Relay>().0.lock().unwrap() = Some(child);
                    let lp = log.clone();
                    tauri::async_runtime::spawn(async move {
                        while let Some(ev) = rx.recv().await {
                            match ev {
                                CommandEvent::Stdout(b) => applog(&lp, &format!("[out] {}", String::from_utf8_lossy(&b).trim_end())),
                                CommandEvent::Stderr(b) => applog(&lp, &format!("[err] {}", String::from_utf8_lossy(&b).trim_end())),
                                CommandEvent::Error(e) => applog(&lp, &format!("[error] {e}")),
                                CommandEvent::Terminated(t) => applog(&lp, &format!("[exit] {t:?}")),
                                _ => {}
                            }
                        }
                    });
                }
                Err(e) => applog(&log, &format!("SPAWN FAILED: {e}")),
            }

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
            {
                let dd = data_dir.clone();
                let lp = log.clone();
                thread::spawn(move || {
                    let mut ka = KeepAwake::new(
                        #[cfg(any(target_os = "macos", target_os = "linux"))]
                        inhibitor_slot,
                    );
                    let mut held = false;
                    let mut token_warned = false; // log the "no token yet" case once, not every 15s
                    loop {
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
}
