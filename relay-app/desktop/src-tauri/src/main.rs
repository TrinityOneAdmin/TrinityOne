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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Relay(Mutex::new(None)))
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
                    // Combined "church-in-a-box": open the Steward console (church management), which auto-uses
                    // this local relay (same origin). relayapp=1 tells the console it is already running its own
                    // relay, so the setup wizard says so instead of asking for a relay address.
                    // First launch → the console, which shows "Start a new church" and then its own first-run
                    // wizard. Afterwards → the launcher (home.html), where the operator picks Full suite /
                    // Relay only / Console only.
                    // (?setup=1 was dropped 2026-07-26: it opened a SECOND setup wizard that has been deleted,
                    // so the param had become inert and the comment claiming it opened the wizard was false.)
                    let url = if first_run {
                        format!("http://127.0.0.1:{PORT}/steward.html?relayapp=1")
                    } else {
                        format!("http://127.0.0.1:{PORT}/relay-app/home.html")
                    };
                    if let Ok(u) = url.parse() {
                        let _ = win.navigate(u);
                    }
                    let _ = win.show();
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                if let Some(child) = window.state::<Relay>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running TrinityOne Relay");
}
