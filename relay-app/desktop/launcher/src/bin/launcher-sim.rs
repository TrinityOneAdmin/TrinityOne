// A HEADLESS HOST for the Suite launcher (src/lib.rs): the same `run()` the app calls, with a plain child process
// standing in for the Tauri sidecar and stdout lines standing in for the splash. It exists so that
// scripts/the-suite-launcher-*.test.mjs can drive the REAL launcher against a REAL gateway. It is not shipped.
//
//   launcher-sim --config-file F --default-data D --payload P --node NODE --port N [--gateway scripts/gateway.mjs]
//                [--up-steps N] [--env K=V]...
//
// Reports on stdout, one line each: `SIM spawn <dir> pinned=<0|1>`, `SIM progress <splash fragment>`,
// `SIM opened <dir>`, `SIM end <how it ended>`. Closing its stdin makes it kill the relay and exit (the app closing).
use std::io::{BufRead, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use trinityone_launcher::*;

struct Sim {
    node: String,
    payload: PathBuf,
    gateway: String,
    port: u16,
    env: Vec<(String, String)>,
    quit: Arc<AtomicBool>,
    live: Arc<Mutex<Option<Arc<Mutex<Child>>>>>,
    /// bytes of output the relay has written: its progress, for the post-move bound (full audit M-1)
    activity: Arc<AtomicU64>,
}

struct SimRelay {
    child: Arc<Mutex<Child>>,
    exit: Arc<Mutex<Option<Exit>>>,
    err: Arc<Mutex<String>>,
}
impl RelayHandle for SimRelay {
    fn exit(&self) -> Option<Exit> {
        self.exit.lock().unwrap().clone()
    }
    fn stderr_tail(&self) -> String {
        self.err.lock().unwrap().clone()
    }
    fn kill(&self) {
        let _ = self.child.lock().unwrap().kill();
    }
}

fn say(s: &str) {
    let mut o = std::io::stdout().lock();
    let _ = writeln!(o, "{s}");
    let _ = o.flush();
}

impl Host for Sim {
    fn node(&self, args: &[String]) -> NodeOut {
        match Command::new(&self.node).current_dir(&self.payload).args(args).output() {
            Ok(o) => NodeOut { code: o.status.code().unwrap_or(-1), stdout: String::from_utf8_lossy(&o.stdout).into_owned(), stderr: String::from_utf8_lossy(&o.stderr).into_owned() },
            Err(e) => NodeOut { code: -1, stdout: String::new(), stderr: e.to_string() },
        }
    }
    fn spawn_relay(&self, env: &RelayEnv) -> Result<Box<dyn RelayHandle>, String> {
        let mut c = Command::new(&self.node);
        c.current_dir(&self.payload)
            .arg(&self.gateway)
            .arg(self.port.to_string())
            .env("TRINITY_DATA_DIR", &env.data_dir)
            .env("TRINITY_STORAGE_MODE", "suite")
            .env("TRINITY_STORAGE_STATE", &env.storage_state)
            .env("RELAY_HOST", "127.0.0.1")
            .env("RELAY_NO_OPEN", "1")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if env.pinned {
            c.env("TRINITY_DATA_DIR_PINNED", "1");
        } else {
            c.env_remove("TRINITY_DATA_DIR_PINNED");
        }
        for (k, v) in &self.env {
            c.env(k, v);
        }
        let mut child = c.spawn().map_err(|e| e.to_string())?;
        say(&format!("SIM spawn {} pinned={}", env.data_dir.display(), if env.pinned { 1 } else { 0 }));
        say(&format!("SIM relay-pid {}", child.id()));
        let err = Arc::new(Mutex::new(String::new()));
        if let Some(mut so) = child.stdout.take() {
            let act = self.activity.clone();
            std::thread::spawn(move || {
                let mut b = [0u8; 4096];
                while let Ok(n) = so.read(&mut b) {
                    if n == 0 {
                        break;
                    }
                    act.fetch_add(n as u64, Ordering::SeqCst);
                }
            });
        }
        if let Some(mut se) = child.stderr.take() {
            let e2 = err.clone();
            let act = self.activity.clone();
            std::thread::spawn(move || {
                let mut b = [0u8; 4096];
                while let Ok(n) = se.read(&mut b) {
                    if n == 0 {
                        break;
                    }
                    act.fetch_add(n as u64, Ordering::SeqCst);
                    let mut g = e2.lock().unwrap();
                    g.push_str(&String::from_utf8_lossy(&b[..n]));
                    let l = g.len();
                    if l > 8000 {
                        *g = g[l - 8000..].to_string();
                    }
                }
            });
        }
        let child = Arc::new(Mutex::new(child));
        *self.live.lock().unwrap() = Some(child.clone());
        let exit = Arc::new(Mutex::new(None));
        let (c2, x2) = (child.clone(), exit.clone());
        std::thread::spawn(move || loop {
            let st = c2.lock().unwrap().try_wait();
            match st {
                Ok(Some(s)) => {
                    // let the stderr reader catch up before anyone reads the tail
                    std::thread::sleep(std::time::Duration::from_millis(150));
                    *x2.lock().unwrap() = Some(s.code().map(Exit::Code).unwrap_or(Exit::Other));
                    break;
                }
                Ok(None) => std::thread::sleep(std::time::Duration::from_millis(50)),
                Err(_) => {
                    *x2.lock().unwrap() = Some(Exit::Other);
                    break;
                }
            }
        });
        Ok(Box::new(SimRelay { child, exit, err }))
    }
    fn progress(&self, p: &Progress) {
        say(&format!("SIM progress {}", splash_fragment(p)));
    }
    fn opened(&self, d: &Path) {
        say(&format!("SIM opened {}", d.display()));
    }
    fn log(&self, m: &str) {
        eprintln!("SIM log {m}");
    }
    fn quitting(&self) -> bool {
        self.quit.load(Ordering::Relaxed)
    }
    fn activity(&self) -> u64 {
        self.activity.load(Ordering::SeqCst)
    }
}

fn main() {
    let mut a = std::collections::HashMap::<String, String>::new();
    let mut envs: Vec<(String, String)> = vec![];
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < args.len() {
        if let Some(k) = args[i].strip_prefix("--") {
            let v = args.get(i + 1).cloned().unwrap_or_default();
            if k == "env" {
                if let Some((x, y)) = v.split_once('=') {
                    envs.push((x.to_string(), y.to_string()));
                }
            } else {
                a.insert(k.to_string(), v);
            }
            i += 2;
        } else {
            i += 1;
        }
    }
    let get = |k: &str| a.get(k).cloned().unwrap_or_else(|| panic!("launcher-sim: --{k} is required"));
    let cfg = Config {
        config_file: PathBuf::from(get("config-file")),
        default_data: PathBuf::from(get("default-data")),
        port: get("port").parse().expect("--port"),
        up_steps: a.get("up-steps").and_then(|s| s.parse().ok()).unwrap_or(240),
        mover_wait_ms: a.get("mover-wait-ms").and_then(|s| s.parse().ok()).unwrap_or(600_000),
        check_steps: a.get("check-steps").and_then(|s| s.parse().ok()).unwrap_or(1200),
        check_ceiling_steps: a.get("check-ceiling-steps").and_then(|s| s.parse().ok()).unwrap_or(14400),
        log_path: PathBuf::from(a.get("log-file").cloned().unwrap_or_else(|| "relay-launch.log".into())),
    };
    let quit = Arc::new(AtomicBool::new(false));
    let live: Arc<Mutex<Option<Arc<Mutex<Child>>>>> = Arc::new(Mutex::new(None));
    {
        let q = quit.clone();
        std::thread::spawn(move || {
            let mut l = String::new();
            while std::io::stdin().lock().read_line(&mut l).map(|n| n > 0).unwrap_or(false) {
                l.clear();
            }
            q.store(true, Ordering::Relaxed);
        });
    }
    let sim = Sim { node: get("node"), payload: PathBuf::from(get("payload")), gateway: a.get("gateway").cloned().unwrap_or_else(|| "scripts/gateway.mjs".into()), port: cfg.port, env: envs, quit: quit.clone(), live: live.clone(), activity: Arc::new(AtomicU64::new(0)) };
    let end = run(&sim, &cfg);
    say(&format!("SIM end {end:?}"));
    // the app closing takes the relay with it
    let last = live.lock().unwrap().clone();
    if let Some(c) = last {
        let _ = c.lock().unwrap().kill();
    }
}
