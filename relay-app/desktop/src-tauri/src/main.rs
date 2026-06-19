// TrinityOne Relay — Tauri 2 desktop shell (v0.7.1 scaffold).
// Spawns the relay (gateway), waits for it to listen, then opens the control GUI window pointed at the
// local gateway so /status is same-origin. Kills the relay child on exit. See ../README.md.
//
// NOTE: scaffold — finalize against the installed Tauri 2 CLI. Ship the relay as a bundled Node sidecar
// (`binaries/trinityone-relay-<triple>`, built with node --experimental-sea / pkg) so users need no Node;
// until then this shells out to system `node scripts/gateway.mjs`.
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use std::process::{Child, Command};
use std::sync::Mutex;
use std::{thread, time::Duration};
use tauri::{Manager, WindowEvent};

const PORT: u16 = 8000;

struct Relay(Mutex<Option<Child>>);

fn spawn_relay() -> std::io::Result<Child> {
    // dev: system node + repo gateway. prod: replace with the bundled sidecar via tauri-plugin-shell.
    Command::new("node")
        .arg("scripts/gateway.mjs")
        .arg(PORT.to_string())
        .spawn()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Relay(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            match spawn_relay() {
                Ok(child) => { *app.state::<Relay>().0.lock().unwrap() = Some(child); }
                Err(e) => { eprintln!("failed to start relay: {e}"); }
            }
            // give the relay a moment to bind, then reveal the control window pointed at the local gateway
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(1500));
                let url = format!("http://localhost:{PORT}/relay-app/control.html");
                if let Some(win) = handle.get_webview_window("control") {
                    let _ = win.eval(&format!("window.location.replace('{url}')"));
                    let _ = win.show();
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                if let Some(mut child) = window.state::<Relay>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running TrinityOne Relay");
}
