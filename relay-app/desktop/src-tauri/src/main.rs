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
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::sync::Mutex;
use std::{thread, time::Duration};
use tauri::{Manager, WindowEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const PORT: u16 = 8787;

// Holds the running relay child so we can kill it on exit. CommandChild::kill consumes self, hence the Option.
struct Relay(Mutex<Option<CommandChild>>);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Relay(Mutex::new(None)))
        .setup(|app| {
            // read-only code payload (bundled resource) + writable data dir (per-user app-data)
            let payload = app.path().resource_dir()?.join("payload");
            let gateway = payload.join("scripts").join("gateway.mjs");
            let data_dir = app.path().app_data_dir()?.join("data");
            std::fs::create_dir_all(&data_dir).ok();

            // start the relay: bundled node <gateway.mjs> <port>, data redirected to the writable dir
            let sidecar = app
                .shell()
                .sidecar("trinityone-relay-node")?
                .arg(gateway.to_string_lossy().to_string())
                .arg(PORT.to_string())
                .env("TRINITY_DATA_DIR", data_dir.to_string_lossy().to_string())
                .env("RELAY_NO_OPEN", "1"); // the Tauri window IS the control UI; don't also open a browser
            match sidecar.spawn() {
                Ok((mut rx, child)) => {
                    *app.state::<Relay>().0.lock().unwrap() = Some(child);
                    // drain + log the relay's output (also prevents pipe backpressure stalling the child)
                    tauri::async_runtime::spawn(async move {
                        while let Some(ev) = rx.recv().await {
                            match ev {
                                CommandEvent::Stdout(b) | CommandEvent::Stderr(b) => {
                                    eprint!("[relay] {}", String::from_utf8_lossy(&b));
                                }
                                _ => {}
                            }
                        }
                    });
                }
                Err(e) => eprintln!("failed to start relay sidecar: {e}"),
            }

            // wait for the relay to accept connections, then point the window at its control panel
            if let Some(win) = app.get_webview_window("control") {
                thread::spawn(move || {
                    for _ in 0..240 {
                        // up to ~60s
                        if TcpStream::connect(("127.0.0.1", PORT)).is_ok() {
                            break;
                        }
                        thread::sleep(Duration::from_millis(250));
                    }
                    let url = format!("http://localhost:{PORT}/relay-app/control.html");
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
