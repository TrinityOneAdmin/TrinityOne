// P5 keystone — end-to-end Suite JS auto-update apply harness.
//
// WHAT THIS PROVES, AND WHY IT IS NOT MOCKED (CLAUDE.md rule 1 — test the REAL code at the point of use).
// This drives the SHIPPED apply pipeline — maybe_apply → attempt_apply → verify_tarball → stop → unpack(tar)
// → atomic active/ swap → respawn (`node scripts/gateway.mjs`) → health (`GET /status`) → rollback — against
// REAL tarballs signed with a THROWAWAY Ed25519 key. The ONLY thing injected is the three-method RelayHost
// seam (spawn/stop/reload): in production it is TauriHost (Tauri sidecar + managed Relay slot + webview); here
// it is TestHost, which spawns the same gateway with `std::process::Command` and the REAL relay_env(), so the
// PAYLOAD_DIR trust-root invariant is exercised too. Everything the trust decision rests on runs for real:
//   • the signature gate is the REAL scripts/verify-suite-bundle.mjs run by the REAL node against the payload key;
//   • the anti-rollback floor is the REAL date_after/read_version_date arithmetic inside attempt_apply;
//   • the swap is the REAL rename dance in attempt_apply; the health check is the REAL health_probe over HTTP;
//   • the rollback + quarantine is the REAL rollback_and_restart + quarantine-sha write.
// If any guard were deleted from attempt_apply, the matching scenario below goes RED (sabotage-verified for the
// bad-signature and health-fail guards).
//
// Five scenarios, from the P5 plan, run SEQUENTIALLY in ONE #[test] because they all bind the production port
// (PORT = 8787) one at a time — this sidesteps cargo's parallel test threads without a global lock:
//   (a) a good, newer, validly-signed bundle ACTIVATES and the relay then serves v2;
//   (b) a BAD SIGNATURE is refused — v1 keeps running, nothing is activated;
//   (c) an OLDER (by instant) signed bundle is refused (installed-date floor);
//   (d) a bundle OLDER THAN THE BAKED-IN PAYLOAD is refused on a fresh box (the downgrade floor);
//   (e) a v2 that boots but FAILS HEALTH (identifies as the wrong version) ROLLS BACK to v1 and QUARANTINES the sha.
//
// Offline, no network. Ephemeral temp dirs, removed in teardown. Needs `node` and `tar` on PATH.

use super::*;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

// ── test RelayHost: spawns the gateway as a plain child, no Tauri ────────────────────────────────
struct TestHost {
    node: PathBuf,
    child: Arc<Mutex<Option<Child>>>,
}

impl TestHost {
    fn new(node: PathBuf) -> Self {
        TestHost { node, child: Arc::new(Mutex::new(None)) }
    }
}

impl RelayHost for TestHost {
    fn spawn_relay(
        &self,
        code_dir: &Path,
        payload: &Path,
        data_dir: &Path,
        _log: &Path,
    ) -> Option<Arc<AtomicBool>> {
        let mut cmd = Command::new(&self.node);
        cmd.current_dir(code_dir).arg("scripts/gateway.mjs").arg(PORT.to_string());
        // The REAL env assembly — so PAYLOAD_DIR (the trust root) is set exactly as in production.
        for (k, v) in relay_env(code_dir, payload, data_dir, "/nonexistent/cloudflared") {
            cmd.env(k, v);
        }
        cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        match cmd.spawn() {
            Ok(ch) => {
                *self.child.lock().unwrap() = Some(ch);
                let alive = Arc::new(AtomicBool::new(true));
                let alive2 = alive.clone();
                let slot = self.child.clone();
                // Clears the alive-flag when the child exits (or is taken by stop_relay) — the TestHost twin
                // of production's CommandEvent::Terminated pump, so wait_stopped() behaves identically.
                thread::spawn(move || loop {
                    thread::sleep(Duration::from_millis(150));
                    let mut g = slot.lock().unwrap();
                    match g.as_mut() {
                        Some(c) => match c.try_wait() {
                            Ok(Some(_)) => {
                                alive2.store(false, Ordering::SeqCst);
                                *g = None;
                                break;
                            }
                            Ok(None) => {}
                            Err(_) => {
                                alive2.store(false, Ordering::SeqCst);
                                break;
                            }
                        },
                        None => {
                            alive2.store(false, Ordering::SeqCst);
                            break;
                        }
                    }
                });
                Some(alive)
            }
            Err(_) => None,
        }
    }

    fn stop_relay(&self) {
        if let Some(mut ch) = self.child.lock().unwrap().take() {
            let _ = ch.kill();
            let _ = ch.wait();
        }
    }

    fn reload_webview(&self) {}
}

impl Drop for TestHost {
    fn drop(&mut self) {
        self.stop_relay();
    }
}

// ── small helpers ────────────────────────────────────────────────────────────────────────────────

// Ephemeral root; removed on drop.
struct TempRoot(PathBuf);
impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn node_bin() -> PathBuf {
    // Resolve an absolute node so the gateway/verifier/clock all use the same one; fall back to PATH lookup.
    if let Ok(out) = Command::new("sh").arg("-c").arg("command -v node").output() {
        if out.status.success() {
            let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !p.is_empty() {
                return PathBuf::from(p);
            }
        }
    }
    PathBuf::from("node")
}

fn write(path: &Path, contents: &str) {
    if let Some(d) = path.parent() {
        std::fs::create_dir_all(d).unwrap();
    }
    std::fs::write(path, contents).unwrap();
}

fn must(cmd: &mut Command, what: &str) {
    let st = cmd.status().unwrap_or_else(|e| panic!("{what}: spawn failed: {e}"));
    assert!(st.success(), "{what}: exited {st:?}");
}

// A minimal gateway that binds argv[2] on loopback and serves /status like the real one: "version" is line 1 of
// ITS OWN version.txt (the real gateway reports BUILD.sha, read the same way), plus a human "label" the tests use
// to tell trees apart. A `lie` gateway reports a version that is NOT its version.txt — the "wrong code answering"
// health failure.
fn gateway_src(label: &str, lie: bool) -> String {
    format!(
        "import http from 'node:http';\n\
         import {{readFileSync}} from 'node:fs';\n\
         const PORT = Number(process.argv[2]);\n\
         const LABEL = {l:?};\n\
         let V = ''; try {{ V = readFileSync('version.txt','utf8').split('\\n')[0].trim(); }} catch {{}}\n\
         if ({lie}) V = 'f'.repeat(40);\n\
         http.createServer((req,res)=>{{\n\
           if ((req.url||'').startsWith('/status')) {{\n\
             res.writeHead(200,{{'content-type':'application/json'}});\n\
             res.end(JSON.stringify({{version:V, label:LABEL, ok:true}}));\n\
             return;\n\
           }}\n\
           res.writeHead(404); res.end('no');\n\
         }}).listen(PORT,'127.0.0.1');\n",
        l = label,
        lie = if lie { "true" } else { "false" }
    )
}

const SHA2: &str = "2222222222222222222222222222222222222222";
const SHA3: &str = "3333333333333333333333333333333333333333";
const D_OCT: &str = "2026-10-01T00:00:00Z";

// A 40-hex sha made of one repeated digit — readable in assertions ("2222…" is v2).
fn sha_of(c: char) -> String {
    c.to_string().repeat(40)
}

const KEYGEN_MJS: &str = "import {generateKeyPairSync} from 'node:crypto';\n\
import {writeFileSync} from 'node:fs';\n\
const {publicKey, privateKey} = generateKeyPairSync('ed25519');\n\
writeFileSync(process.argv[2], publicKey.export({type:'spki',format:'pem'}));\n\
writeFileSync(process.argv[3], privateKey.export({type:'pkcs8',format:'pem'}));\n";

const SIGNER_MJS: &str = "import {readFileSync, writeFileSync} from 'node:fs';\n\
import {createPrivateKey, sign} from 'node:crypto';\n\
const data = readFileSync(process.argv[2]);\n\
const key = createPrivateKey(readFileSync(process.argv[4]));\n\
writeFileSync(process.argv[3], sign(null, data, key));\n";

// What goes INSIDE a test bundle (and so is covered by its signature): the gateway's label, the signed sha +
// commit date in version.txt, and whether the gateway lies about its version.
struct Bundle<'a> {
    label: &'a str,
    sha: &'a str,
    date: &'a str,
    lie: bool,
}

// Build a real Suite-shaped .tgz (version.txt, release-origin, scripts/gateway.mjs — what the real verifier
// requires), leading "./" like build-suite-js-bundle.sh, and sign the EXACT tarball bytes with `signing_key`
// (same raw-Ed25519 path the verifier checks). Pass the payload-pinned private key for a valid bundle, or a
// DIFFERENT key to forge an invalid-signature bundle over a perfectly good tarball. Writes bundle.tgz + bundle.sig
// into `staging`; the caller writes READY.
fn build_signed_bundle(node: &Path, tools: &Path, signing_key: &Path, staging: &Path, b: &Bundle) {
    let stage = staging.join(".build");
    let _ = std::fs::remove_dir_all(&stage);
    write(&stage.join("scripts").join("gateway.mjs"), &gateway_src(b.label, b.lie));
    write(&stage.join("version.txt"), &format!("{}\n{}\n", b.sha, b.date));
    write(&stage.join("release-origin"), "https://example.invalid\n");
    let tgz = staging.join("bundle.tgz");
    let sig = staging.join("bundle.sig");
    must(Command::new("tar").arg("-czf").arg(&tgz).arg("-C").arg(&stage).arg("."), "tar bundle");
    must(
        Command::new(node).arg(tools.join("signer.mjs")).arg(&tgz).arg(&sig).arg(signing_key),
        "sign bundle",
    );
    let _ = std::fs::remove_dir_all(&stage);
}

// The common case: a well-behaved bundle labelled `label`, signed sha `sha`, signed date `date`.
fn good<'a>(label: &'a str, sha: &'a str, date: &'a str) -> Bundle<'a> {
    Bundle { label, sha, date, lie: false }
}

fn write_ready(staging: &Path, version: &str, sha: &str, date: &str) {
    write(
        &staging.join("READY"),
        &format!("{{\"version\":\"{version}\",\"sha\":\"{sha}\",\"date\":\"{date}\"}}\n"),
    );
}

// Read the label of the tree the relay on PORT currently serves at /status (REAL probe), or None.
fn served_version() -> Option<String> {
    let body = http_get_loopback("/status", None)?;
    json_str_value(&body, "label")
}

fn wait_for_served(expect: &str, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if served_version().as_deref() == Some(expect) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(Duration::from_millis(200));
    }
}

fn wait_port_free(timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if !port_reachable() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(Duration::from_millis(150));
    }
}

// One scenario's fixtures: a read-only payload (v1), a writable data dir + suite tree, the throwaway key.
struct Fixture {
    _root: TempRoot,
    payload: PathBuf,
    data_dir: PathBuf,
    suite_dir: PathBuf,
    staging: PathBuf,
    tools: PathBuf,
    priv_key: PathBuf,
    node: PathBuf,
}

// Build a fresh box: payload with a REAL verifier + the throwaway pubkey as the pinned key, a v1 gateway, and
// a version.txt whose date is `payload_date`. `at` is the suite-autoupdate marker time (we use 00:00 so the
// apply window is always open). Generates one throwaway Ed25519 keypair.
fn fresh_box(tag: &str, payload_date: &str) -> Fixture {
    let node = node_bin();
    let root = std::env::temp_dir().join(format!(
        "trin-apply-{tag}-{}-{}",
        std::process::id(),
        Instant::now().elapsed().as_nanos()
    ));
    let _ = std::fs::remove_dir_all(&root);
    let payload = root.join("payload");
    let data_dir = root.join("data");
    let suite_dir = data_dir.join("suite");
    let staging = suite_dir.join("staging");
    let tools = root.join("tools");
    std::fs::create_dir_all(&staging).unwrap();
    std::fs::create_dir_all(&tools).unwrap();

    // Payload: the REAL verifier (so verify_tarball runs the shipped crypto), the pinned key = throwaway pub,
    // the baked-in v1 gateway, and version.txt (line 2 = commit date) for the anti-rollback floor.
    let repo_verifier = repo_root().join("scripts").join("verify-suite-bundle.mjs");
    std::fs::create_dir_all(payload.join("scripts")).unwrap();
    std::fs::copy(&repo_verifier, payload.join("scripts").join("verify-suite-bundle.mjs"))
        .expect("copy real verify-suite-bundle.mjs");
    write(&payload.join("scripts").join("gateway.mjs"), &gateway_src("v1", false));
    write(&payload.join("version.txt"), &format!("{}\n{payload_date}\n", sha_of('1')));

    // Throwaway Ed25519 key: public → payload/relay-app/release-pubkey.pem (the pinned trust root), private
    // kept only under tools/ for signing bundles in this test.
    write(&tools.join("keygen.mjs"), KEYGEN_MJS);
    write(&tools.join("signer.mjs"), SIGNER_MJS);
    let pub_key = payload.join("relay-app").join("release-pubkey.pem");
    std::fs::create_dir_all(pub_key.parent().unwrap()).unwrap();
    let priv_key = tools.join("release-key.pem");
    must(
        Command::new(&node).arg(tools.join("keygen.mjs")).arg(&pub_key).arg(&priv_key),
        "keygen",
    );

    // Enable marker (apply window always open).
    write(&data_dir.join("suite-autoupdate"), "00:00\n");

    Fixture {
        _root: TempRoot(root),
        payload,
        data_dir,
        suite_dir,
        staging,
        tools,
        priv_key,
        node,
    }
}

// Locate the repo root (…/TrinityOne) from this crate dir (…/relay-app/desktop/src-tauri).
fn repo_root() -> PathBuf {
    let crate_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    crate_dir.join("..").join("..").join("..").canonicalize().unwrap()
}

// The test clock: a fixed local time-of-day (minutes) on 2026-11-13, at the REAL current epoch. The fixtures'
// marker is "00:00", so 30 (00:30) is inside the window and 840 (14:00) is not.
const IN_WINDOW: u32 = 30;
fn clock_at(min: u32) -> impl Fn() -> Option<LocalNow> {
    move || Some(LocalNow { min, today: "2026-11-13".into(), yesterday: "2026-11-12".into(), epoch: now_epoch() })
}

fn env_for<'a>(host: &'a dyn RelayHost, fx: &'a Fixture, log: &'a Path, clock: &'a dyn Fn() -> Option<LocalNow>) -> ApplyEnv<'a> {
    ApplyEnv {
        host,
        suite_dir: &fx.suite_dir,
        payload: &fx.payload,
        data_dir: &fx.data_dir,
        log,
        node: Some(fx.node.as_path()),
        clock,
    }
}

// Start the baked-in payload (v1) via the REAL spawn_and_wait, so the RunState is set exactly as in production.
// Asserts v1 is actually serving.
fn start_v1(host: &dyn RelayHost, fx: &Fixture, log: &Path) -> RunState {
    let clock = clock_at(IN_WINDOW);
    let env = env_for(host, fx, log, &clock);
    let mut st = RunState { code_dir: fx.payload.clone(), alive: Arc::new(AtomicBool::new(false)), cooldown_until: None };
    let up = spawn_and_wait(&env, &mut st, &fx.payload);
    assert!(up, "v1 payload relay failed to come up");
    assert!(wait_for_served("v1", Duration::from_secs(10)), "v1 did not serve /status");
    st
}

// One controller tick at local time `min`.
fn tick_at(host: &dyn RelayHost, fx: &Fixture, log: &Path, st: &mut RunState, min: u32) {
    let clock = clock_at(min);
    let env = env_for(host, fx, log, &clock);
    maybe_apply(&env, st);
}

// One controller tick inside the window.
fn run_apply(host: &dyn RelayHost, fx: &Fixture, log: &Path, st: &mut RunState) {
    tick_at(host, fx, log, st, IN_WINDOW);
}

// A Suite START at local time `min` — the REAL startup(): code choice, missed-window apply, first spawn, launch check.
fn start_at(host: &dyn RelayHost, fx: &Fixture, log: &Path, min: u32) -> RunState {
    let clock = clock_at(min);
    let env = env_for(host, fx, log, &clock);
    startup(&env)
}

fn read_state_field(suite_dir: &Path, key: &str) -> Option<String> {
    let raw = std::fs::read_to_string(suite_dir.join("state.json")).ok()?;
    json_str_value(&raw, key)
}

// ── the keystone test ────────────────────────────────────────────────────────────────────────────

#[test]
fn end_to_end_apply_harness() {
    // Preflight: a stray relay on PORT would answer our probes and turn a BROKEN apply green (AUDIT F14).
    assert!(
        !port_reachable(),
        "port {PORT} is already in use; a leftover relay would make this harness report false results. \
         Kill it and re-run. (This is NOT a code failure.)"
    );

    scenario_a_good_bundle_activates();
    assert!(wait_port_free(Duration::from_secs(10)), "port not free after (a)");

    scenario_b_bad_signature_refused();
    assert!(wait_port_free(Duration::from_secs(10)), "port not free after (b)");

    scenario_c_older_bundle_refused();
    assert!(wait_port_free(Duration::from_secs(10)), "port not free after (c)");

    scenario_d_older_than_payload_refused();
    assert!(wait_port_free(Duration::from_secs(10)), "port not free after (d)");

    scenario_e_health_fail_rolls_back_and_quarantines();
    assert!(wait_port_free(Duration::from_secs(10)), "port not free after (e)");

    scenario_j_signed_sha_must_match_ready();
    assert!(wait_port_free(Duration::from_secs(10)), "port not free after (j)");

    scenario_k_far_future_signed_date_refused_and_does_not_freeze();
    assert!(wait_port_free(Duration::from_secs(10)), "port not free after (k)");

    scenario_l_staged_at_14_waits_for_the_window();
    assert!(wait_port_free(Duration::from_secs(10)), "port not free after (l)");

    scenario_m_missed_window_applies_at_the_next_start();
    assert!(wait_port_free(Duration::from_secs(10)), "port not free after (m)");

    scenario_n_newer_suite_installed_retires_the_override();
    assert!(wait_port_free(Duration::from_secs(10)), "port not free after (n)");

    scenario_o_damaged_active_is_repaired_or_falls_back();
    assert!(wait_port_free(Duration::from_secs(10)), "port not free after (o)");

    scenario_f_toggle_off_launch_runs_shipped_code_and_ignores_staging();
    assert!(wait_port_free(Duration::from_secs(10)), "port not free after (f)");

    scenario_g_relaunch_after_an_apply_runs_the_update();
    assert!(wait_port_free(Duration::from_secs(10)), "port not free after (g)");

    scenario_h_bad_update_over_a_good_one_rolls_back_to_last_good();
    assert!(wait_port_free(Duration::from_secs(10)), "port not free after (h)");

    scenario_i_relay_that_will_not_stop_backs_off();
    assert!(wait_port_free(Duration::from_secs(10)), "port not free after (i)");

    eprintln!("ALL apply-harness scenarios passed");
}

// (a) good, newer, validly-signed bundle → activates; relay serves v2.
fn scenario_a_good_bundle_activates() {
    eprintln!("── scenario (a): good newer bundle activates ──");
    let fx = fresh_box("a", "2026-01-01T00:00:00Z");
    let log = fx.data_dir.join("relay-launch.log");
    build_signed_bundle(&fx.node, &fx.tools, &fx.priv_key, &fx.staging, &good("v2", SHA2, "2026-10-01T00:00:00Z"));
    write_ready(&fx.staging, "v2", SHA2, "2026-10-01T00:00:00Z"); // newer than payload floor

    let host = TestHost::new(fx.node.clone());
    let mut cur = start_v1(&host, &fx, &log);
    run_apply(&host, &fx, &log, &mut cur);

    assert!(wait_for_served("v2", Duration::from_secs(15)), "relay is not serving v2 after a good apply");
    assert!(fx.suite_dir.join("active").join("scripts").join("gateway.mjs").exists(), "active/ not populated");
    assert!(fx.suite_dir.join("active.tgz").exists(), "active.tgz not retained");
    assert!(fx.suite_dir.join("active.sig").exists(), "active.sig not retained");
    assert_eq!(read_state_field(&fx.suite_dir, "lastOutcome").as_deref(), Some("applied"), "state not 'applied'");
    assert_eq!(read_state_field(&fx.suite_dir, "installedVersion").as_deref(), Some("v2"));
    // staging consumed
    assert!(!fx.staging.join("READY").exists(), "staging READY not cleared after apply");
    host.stop_relay();
    eprintln!("   (a) OK — relay serves v2, active/ + retained tarball present, state=applied");
}

// (b) bad signature → refused; v1 keeps running, nothing activated.
fn scenario_b_bad_signature_refused() {
    eprintln!("── scenario (b): bad signature refused ──");
    let fx = fresh_box("b", "2026-01-01T00:00:00Z");
    let log = fx.data_dir.join("relay-launch.log");
    // A perfectly good v2 tarball — but signed with a DIFFERENT key than the payload pins, so ONLY the
    // signature guard can refuse it (date is newer than the floor; the tarball unpacks fine). This isolates
    // the bad-sig guard: if verify were removed, this bundle WOULD activate and serve v2.
    let wrong_priv = fx.tools.join("wrong-priv.pem");
    must(
        Command::new(&fx.node)
            .arg(fx.tools.join("keygen.mjs"))
            .arg(fx.tools.join("wrong-pub.pem"))
            .arg(&wrong_priv),
        "wrong keygen",
    );
    build_signed_bundle(&fx.node, &fx.tools, &wrong_priv, &fx.staging, &good("v2", SHA2, "2026-10-01T00:00:00Z"));
    write_ready(&fx.staging, "v2", SHA2, "2026-10-01T00:00:00Z");

    let host = TestHost::new(fx.node.clone());
    let mut cur = start_v1(&host, &fx, &log);
    run_apply(&host, &fx, &log, &mut cur);

    assert_eq!(served_version().as_deref(), Some("v1"), "v1 must keep running after a bad-sig refusal");
    assert!(!fx.suite_dir.join("active").exists(), "active/ must NOT be created for a bad-sig bundle");
    assert!(fx.suite_dir.join("state.json").is_file() == false, "no apply → no state.json");
    assert!(!fx.staging.join("READY").exists(), "a failed-verify bundle's staging must be discarded");
    host.stop_relay();
    eprintln!("   (b) OK — bad sig refused, v1 still serving, no active/, staging discarded");
}

// (c) older (by instant) signed bundle → refused by the installed-date floor.
fn scenario_c_older_bundle_refused() {
    eprintln!("── scenario (c): older-than-installed bundle refused ──");
    let fx = fresh_box("c", "2026-01-01T00:00:00Z");
    let log = fx.data_dir.join("relay-launch.log");
    // Already installed something dated 2026-09-01; the staged bundle is dated 2026-03-01 (older) but validly signed.
    write(
        &fx.suite_dir.join("state.json"),
        "{\"installedSha\":\"old\",\"installedVersion\":\"v-old\",\"installedDate\":\"2026-09-01T00:00:00Z\",\"lastApplied\":\"2000-01-01\"}\n",
    );
    build_signed_bundle(&fx.node, &fx.tools, &fx.priv_key, &fx.staging, &good("v2", SHA2, "2026-03-01T00:00:00Z"));
    // READY (unsigned, written from the manifest) CLAIMS a new date — the forged-manifest rollback of audit HIGH 2.
    // Only the date inside the signed version.txt may decide, so this must still be refused.
    write_ready(&fx.staging, "v2", SHA2, "2099-01-01T00:00:00Z");

    let host = TestHost::new(fx.node.clone());
    let mut cur = start_v1(&host, &fx, &log);
    run_apply(&host, &fx, &log, &mut cur);

    assert_eq!(served_version().as_deref(), Some("v1"), "v1 must keep running after an older-bundle refusal");
    assert!(!fx.suite_dir.join("active").exists(), "active/ must NOT be created for an older bundle");
    // installed identity unchanged, staging discarded
    assert_eq!(read_state_field(&fx.suite_dir, "installedVersion").as_deref(), Some("v-old"));
    assert!(!fx.staging.join("READY").exists(), "an anti-rollback-refused bundle's staging must be discarded");
    host.stop_relay();
    eprintln!("   (c) OK — older-than-installed refused, v1 still serving, install identity unchanged");
}

// (d) bundle older than the baked-in payload on a fresh box → refused by the downgrade floor.
fn scenario_d_older_than_payload_refused() {
    eprintln!("── scenario (d): older-than-payload refused on a fresh box ──");
    // Fresh box (no state.json); payload is dated 2026-06-01; the staged bundle is dated 2026-03-01 (older).
    let fx = fresh_box("d", "2026-06-01T00:00:00Z");
    let log = fx.data_dir.join("relay-launch.log");
    build_signed_bundle(&fx.node, &fx.tools, &fx.priv_key, &fx.staging, &good("v2", SHA2, "2026-03-01T00:00:00Z"));
    write_ready(&fx.staging, "v2", SHA2, "2099-01-01T00:00:00Z"); // forged-new READY date; the signed date is older than the payload

    let host = TestHost::new(fx.node.clone());
    let mut cur = start_v1(&host, &fx, &log);
    run_apply(&host, &fx, &log, &mut cur);

    assert_eq!(served_version().as_deref(), Some("v1"), "v1 must keep running after a downgrade-floor refusal");
    assert!(!fx.suite_dir.join("active").exists(), "active/ must NOT be created below the payload floor");
    assert!(!fx.staging.join("READY").exists(), "a below-floor bundle's staging must be discarded");
    host.stop_relay();
    eprintln!("   (d) OK — below-payload-floor refused on a fresh box, v1 still serving");
}

// (e) v2 boots but fails health (wrong reported version) → rolls back to v1 and quarantines the sha.
fn scenario_e_health_fail_rolls_back_and_quarantines() {
    eprintln!("── scenario (e): health-fail rolls back + quarantines (≈45s health timeout) ──");
    let fx = fresh_box("e", "2026-01-01T00:00:00Z");
    let log = fx.data_dir.join("relay-launch.log");
    // The bundle verifies + beats the floor, so it IS applied — but its gateway reports a version that does
    // NOT match READY, i.e. the "wrong code answering" health failure. Health must roll it back + quarantine.
    build_signed_bundle(&fx.node, &fx.tools, &fx.priv_key, &fx.staging, &Bundle { label: "WRONG-not-v2", sha: SHA2, date: "2026-10-01T00:00:00Z", lie: true });
    write_ready(&fx.staging, "v2", SHA2, "2026-10-01T00:00:00Z");

    let host = TestHost::new(fx.node.clone());
    let mut cur = start_v1(&host, &fx, &log);
    run_apply(&host, &fx, &log, &mut cur);

    // Rolled back to the baked-in payload (v1 — there was no prior override / last-good on a fresh box).
    assert!(wait_for_served("v1", Duration::from_secs(15)), "relay must be back on v1 after a health-fail rollback");
    assert!(!fx.suite_dir.join("active").exists(), "active/ must be gone after a rollback to payload");
    let quarantined = std::fs::read_to_string(fx.suite_dir.join("quarantine-sha")).unwrap_or_default();
    assert_eq!(quarantined.trim(), SHA2, "the failed sha must be quarantined");
    assert_eq!(read_state_field(&fx.suite_dir, "lastOutcome").as_deref(), Some("rolledback"), "state not 'rolledback'");
    assert!(!fx.staging.join("READY").exists(), "staging must be discarded after a rollback");
    host.stop_relay();
    eprintln!("   (e) OK — wrong-version v2 rolled back to v1, sha-v2 quarantined, state=rolledback");
}

// (j) READY names one sha, the signed bundle is another (e.g. the relay staged a different release than the
//     manifest said, or a manifest points at an older signed bundle under a new sha). Refused, nothing activated.
fn scenario_j_signed_sha_must_match_ready() {
    eprintln!("── scenario (j): signed sha differs from READY sha — refused ──");
    let fx = fresh_box("j", "2026-01-01T00:00:00Z");
    let log = fx.data_dir.join("relay-launch.log");
    build_signed_bundle(&fx.node, &fx.tools, &fx.priv_key, &fx.staging, &good("v2", SHA2, D_OCT));
    write_ready(&fx.staging, "v3", SHA3, D_OCT); // READY claims v3; the signed bytes are v2
    let host = TestHost::new(fx.node.clone());
    let mut cur = start_v1(&host, &fx, &log);
    run_apply(&host, &fx, &log, &mut cur);
    assert_eq!(served_version().as_deref(), Some("v1"), "a bundle whose signed sha is not READY's must not activate");
    assert!(!fx.suite_dir.join("active").exists(), "no active/ for a sha mismatch");
    assert!(!fx.staging.join("READY").exists(), "a mismatched staging must be discarded");
    host.stop_relay();
    eprintln!("   (j) OK — sha mismatch refused, v1 still serving");
}

// (k) A validly signed bundle dated far in the future (a bogus commit date) — audit HIGH 2's "freeze all updates
//     for good". Refused; and a far-future installedDate already on disk does not block a genuine newer release.
fn scenario_k_far_future_signed_date_refused_and_does_not_freeze() {
    eprintln!("── scenario (k): far-future signed date refused; a far-future record cannot freeze updates ──");
    let fx = fresh_box("k", "2026-01-01T00:00:00Z");
    let log = fx.data_dir.join("relay-launch.log");
    build_signed_bundle(&fx.node, &fx.tools, &fx.priv_key, &fx.staging, &good("v2", SHA2, "2099-01-01T00:00:00Z"));
    write_ready(&fx.staging, "v2", SHA2, "2099-01-01T00:00:00Z");
    let host = TestHost::new(fx.node.clone());
    let mut cur = start_v1(&host, &fx, &log);
    run_apply(&host, &fx, &log, &mut cur);
    assert_eq!(served_version().as_deref(), Some("v1"), "a far-future-dated bundle must not activate");
    assert!(!fx.suite_dir.join("active").exists());
    assert!(fx.suite_dir.join("state.json").is_file() == false, "a refused bundle must not record an installed date");

    // A record poisoned with a far-future installedDate (e.g. written before this fix) must not freeze updates:
    // a genuine, newer, validly signed release still applies.
    write(
        &fx.suite_dir.join("state.json"),
        "{\"installedSha\":\"x\",\"installedVersion\":\"vx\",\"installedDate\":\"2099-01-01T00:00:00Z\",\"lastApplied\":\"2000-01-01\"}\n",
    );
    build_signed_bundle(&fx.node, &fx.tools, &fx.priv_key, &fx.staging, &good("v2", SHA2, D_OCT));
    write_ready(&fx.staging, "v2", SHA2, D_OCT);
    run_apply(&host, &fx, &log, &mut cur);
    assert!(wait_for_served("v2", Duration::from_secs(15)), "a far-future installedDate froze a genuine update");
    assert_eq!(read_state_field(&fx.suite_dir, "installedDate").as_deref(), Some(D_OCT), "installedDate must be the SIGNED date");
    host.stop_relay();
    eprintln!("   (k) OK — far-future signed date refused; poisoned floor ignored; signed date recorded");
}

// ══ audit be258b42 HIGH 1 / HIGH 3 / MEDIUM 1 — WHEN an update applies, and WHAT runs at a start ══════════════

// Set a file's modification time (READY's mtime is when the relay staged it).
fn set_mtime(path: &Path, epoch: i64) {
    must(Command::new("touch").arg("-d").arg(format!("@{epoch}")).arg(path), "touch -d");
}

// (l) [H1] A bundle staged at 14:00 is NOT applied by the 14:00 tick, nor by a start at 14:00, nor at 23:59; it is
//     applied by the first tick inside the next window (00:00–02:00 here). The panel's "tonight" is now true.
fn scenario_l_staged_at_14_waits_for_the_window() {
    eprintln!("── scenario (l): staged at 14:00 waits for the window ──");
    let fx = fresh_box("l", "2026-01-01T00:00:00Z");
    let log = fx.data_dir.join("relay-launch.log");
    build_signed_bundle(&fx.node, &fx.tools, &fx.priv_key, &fx.staging, &good("v2", SHA2, D_OCT));
    write_ready(&fx.staging, "v2", SHA2, D_OCT); // staged "now"
    let host = TestHost::new(fx.node.clone());
    // A START at 14:00: the bundle arrived after today's 00:00 window → nothing missed → runs v1, applies nothing.
    let mut st = start_at(&host, &fx, &log, 840);
    assert!(wait_for_served("v1", Duration::from_secs(10)), "a 14:00 start must run v1");
    for min in [840u32, 900, 1439, 125] {
        tick_at(&host, &fx, &log, &mut st, min);
        assert_eq!(served_version().as_deref(), Some("v1"), "applied outside the window at minute {min}");
        assert!(!fx.suite_dir.join("active").exists(), "active/ created outside the window at minute {min}");
    }
    assert!(fx.staging.join("READY").exists(), "the staged bundle must wait");
    tick_at(&host, &fx, &log, &mut st, 5); // 00:05 — inside the window
    assert!(wait_for_served("v2", Duration::from_secs(15)), "not applied inside the window");
    host.stop_relay();
    eprintln!("   (l) OK — 14:00/15:00/23:59/02:05 ticks and a 14:00 start left v1; 00:05 applied v2");
}

// (m) [H1 + owner decision Q3] The computer was OFF during the window with an update already waiting: the next
//     START (at 09:00, outside any window) applies it before the relay first runs. And one that arrived AFTER the
//     window is not applied at a start.
fn scenario_m_missed_window_applies_at_the_next_start() {
    eprintln!("── scenario (m): a missed window applies at the next start ──");
    let fx = fresh_box("m", "2026-01-01T00:00:00Z");
    let log = fx.data_dir.join("relay-launch.log");
    build_signed_bundle(&fx.node, &fx.tools, &fx.priv_key, &fx.staging, &good("v2", SHA2, D_OCT));
    write_ready(&fx.staging, "v2", SHA2, D_OCT);
    let now = now_epoch();
    // clock says 09:00 → today's 00:00 window opened 9 h ago. Staged 10 h ago = before it: missed.
    set_mtime(&fx.staging.join("READY"), now - 10 * 3600);
    let host = TestHost::new(fx.node.clone());
    let st = start_at(&host, &fx, &log, 540);
    assert_eq!(st.code_dir, fx.suite_dir.join("active"), "a missed window must be applied at the next start");
    assert!(wait_for_served("v2", Duration::from_secs(15)), "the start did not bring up the update");
    assert_eq!(read_state_field(&fx.suite_dir, "lastApplied").as_deref(), Some("2026-11-13"));
    host.stop_relay();
    assert!(wait_port_free(Duration::from_secs(10)));

    // A second box: staged 8 h ago = AFTER the 00:00 window opened (9 h ago) → not missed → waits.
    let fx2 = fresh_box("m2", "2026-01-01T00:00:00Z");
    let log2 = fx2.data_dir.join("relay-launch.log");
    build_signed_bundle(&fx2.node, &fx2.tools, &fx2.priv_key, &fx2.staging, &good("v2", SHA2, D_OCT));
    write_ready(&fx2.staging, "v2", SHA2, D_OCT);
    set_mtime(&fx2.staging.join("READY"), now - 8 * 3600);
    let host2 = TestHost::new(fx2.node.clone());
    let st2 = start_at(&host2, &fx2, &log2, 540);
    assert_eq!(st2.code_dir, fx2.payload, "an update that arrived after the window must not apply at a start");
    assert!(wait_for_served("v1", Duration::from_secs(10)));
    assert!(fx2.staging.join("READY").exists());
    host2.stop_relay();
    eprintln!("   (m) OK — missed window applied at the 09:00 start; a post-window arrival waited");
}

// (n) [H3] After an update was applied, the church installs a NEWER Suite by hand (its payload is dated after the
//     override). The next start runs the new Suite's own code and deletes the obsolete override.
fn scenario_n_newer_suite_installed_retires_the_override() {
    eprintln!("── scenario (n): a newer Suite installed by hand wins over the downloaded update ──");
    let fx = fresh_box("n", "2026-01-01T00:00:00Z");
    let log = fx.data_dir.join("relay-launch.log");
    install_active(&fx, &fx.priv_key, "v2"); // signed 2026-10-01
    // "Install" a newer Suite: the read-only payload is replaced by one dated 2026-11-01.
    write(&fx.payload.join("version.txt"), &format!("{}\n2026-11-01T00:00:00Z\n", sha_of('4')));
    write(&fx.payload.join("scripts").join("gateway.mjs"), &gateway_src("v4-installed", false));
    let host = TestHost::new(fx.node.clone());
    let st = start_at(&host, &fx, &log, 840);
    assert_eq!(st.code_dir, fx.payload, "a newer installed Suite must run its own code");
    assert!(wait_for_served("v4-installed", Duration::from_secs(10)), "the newly installed Suite is not what runs");
    assert!(!fx.suite_dir.join("active").exists(), "the obsolete override must be deleted");
    assert!(!fx.suite_dir.join("active.tgz").exists(), "its tarball must be deleted");
    host.stop_relay();
    eprintln!("   (n) OK — newer installed Suite runs; the older override was retired");
}

// (o) [M1] The unpacked override is damaged after it was applied. (1) A file deleted from active/ → the start
//     re-extracts it from the verified tarball and runs the update. (2) The override boots but never answers as
//     its signed build (here: it crashes at once) → the start returns to the shipped code, retires the override,
//     switches auto-update off and records why — the relay is NOT left down.
fn scenario_o_damaged_active_is_repaired_or_falls_back() {
    eprintln!("── scenario (o): a damaged override is repaired, or the start falls back ──");
    let fx = fresh_box("o", "2026-01-01T00:00:00Z");
    let log = fx.data_dir.join("relay-launch.log");
    install_active(&fx, &fx.priv_key, "v2");
    std::fs::remove_file(fx.suite_dir.join("active").join("scripts").join("gateway.mjs")).unwrap();
    let host = TestHost::new(fx.node.clone());
    let st = start_at(&host, &fx, &log, 840);
    assert_eq!(st.code_dir, fx.suite_dir.join("active"));
    assert!(wait_for_served("v2", Duration::from_secs(10)), "a damaged active/ was not repaired from its tarball");
    assert!(fx.suite_dir.join("active").join("scripts").join("gateway.mjs").exists());
    host.stop_relay();
    assert!(wait_port_free(Duration::from_secs(10)));

    // (2) a validly signed override that will not start
    let fx2 = fresh_box("o2", "2026-01-01T00:00:00Z");
    let log2 = fx2.data_dir.join("relay-launch.log");
    let tmp = fx2.suite_dir.join(".mk");
    std::fs::create_dir_all(&tmp).unwrap();
    build_signed_bundle(&fx2.node, &fx2.tools, &fx2.priv_key, &tmp, &good("v2", SHA2, D_OCT));
    // rebuild the tarball with a gateway that exits immediately, then sign it
    let st_dir = tmp.join("st");
    std::fs::create_dir_all(&st_dir).unwrap();
    must(Command::new("tar").arg("-xzf").arg(tmp.join("bundle.tgz")).arg("-C").arg(&st_dir), "untar");
    write(&st_dir.join("scripts").join("gateway.mjs"), "process.exit(3);\n");
    must(Command::new("tar").arg("-czf").arg(tmp.join("bundle.tgz")).arg("-C").arg(&st_dir).arg("."), "retar");
    must(Command::new(&fx2.node).arg(fx2.tools.join("signer.mjs")).arg(tmp.join("bundle.tgz")).arg(tmp.join("bundle.sig")).arg(&fx2.priv_key), "resign");
    let active = fx2.suite_dir.join("active");
    std::fs::create_dir_all(&active).unwrap();
    must(Command::new("tar").arg("-xzf").arg(tmp.join("bundle.tgz")).arg("-C").arg(&active), "untar active");
    std::fs::rename(tmp.join("bundle.tgz"), fx2.suite_dir.join("active.tgz")).unwrap();
    std::fs::rename(tmp.join("bundle.sig"), fx2.suite_dir.join("active.sig")).unwrap();
    let _ = std::fs::remove_dir_all(&tmp);
    let host2 = TestHost::new(fx2.node.clone());
    let t0 = Instant::now();
    let st2 = start_at(&host2, &fx2, &log2, 840);
    assert_eq!(st2.code_dir, fx2.payload, "an override that will not start must fall back to the shipped code");
    assert!(wait_for_served("v1", Duration::from_secs(10)), "the relay was left down");
    assert!(!fx2.suite_dir.join("active").exists(), "the broken override must be retired");
    assert!(!fx2.data_dir.join("suite-autoupdate").exists(), "auto-update must be switched off");
    assert_eq!(read_state_field(&fx2.suite_dir, "lastOutcome").as_deref(), Some("launch-failed"));
    eprintln!("   (o) took {:?}", t0.elapsed());
    host2.stop_relay();
    eprintln!("   (o) OK — a deleted file was re-extracted; a crashing override fell back to v1 and was retired");
}

// ══ Added 2026-11-13 (audit AUDIT-integration-all-1aa19150 MEDIUM 2): the LAUNCH choice, the toggle-off path,
// a relaunch after an apply, rollback to LAST-GOOD (not just to payload), and a relay that will not stop. ══════

// Put a signed `gw_version` override in place exactly as a finished apply leaves it: suite/active/ unpacked from the
// tarball, and the tarball + signature retained as suite/active.tgz + active.sig (what launch_code_dir re-verifies).
fn install_active(fx: &Fixture, key: &Path, gw_version: &str) {
    let tmp = fx.suite_dir.join(".mk-active");
    std::fs::create_dir_all(&tmp).unwrap();
    build_signed_bundle(&fx.node, &fx.tools, key, &tmp, &good(gw_version, SHA2, D_OCT));
    let active = fx.suite_dir.join("active");
    let _ = std::fs::remove_dir_all(&active);
    std::fs::create_dir_all(&active).unwrap();
    must(Command::new("tar").arg("-xzf").arg(tmp.join("bundle.tgz")).arg("-C").arg(&active), "untar active");
    std::fs::rename(tmp.join("bundle.tgz"), fx.suite_dir.join("active.tgz")).unwrap();
    std::fs::rename(tmp.join("bundle.sig"), fx.suite_dir.join("active.sig")).unwrap();
    let _ = std::fs::remove_dir_all(&tmp);
}

fn launch(fx: &Fixture, node: Option<&Path>) -> PathBuf {
    let log = fx.data_dir.join("relay-launch.log");
    launch_code_dir(&fx.payload, &fx.suite_dir, &fx.data_dir, node, &log).dir
}

// ── launch choice: real files, real signatures, the real verifier — no port needed, so these run in parallel ──

#[test]
fn launch_with_nothing_downloaded_runs_the_shipped_payload() {
    let fx = fresh_box("launch-none", "2026-01-01T00:00:00Z");
    // A box that never turned auto-update on has no suite/ dir at all.
    std::fs::remove_dir_all(&fx.suite_dir).unwrap();
    assert_eq!(launch(&fx, Some(&fx.node)), fx.payload, "no update downloaded must run the shipped payload");
    // A bundle that is only STAGED (downloaded, verified, waiting for the apply time) is never run at launch.
    std::fs::create_dir_all(&fx.staging).unwrap();
    build_signed_bundle(&fx.node, &fx.tools, &fx.priv_key, &fx.staging, &good("v2", SHA2, "2026-10-01T00:00:00Z"));
    write_ready(&fx.staging, "v2", SHA2, "2026-10-01T00:00:00Z");
    assert_eq!(launch(&fx, Some(&fx.node)), fx.payload, "a staged-but-not-applied bundle must not be launched");
}

#[test]
fn launch_runs_an_applied_override_whose_tarball_verifies() {
    let fx = fresh_box("launch-ok", "2026-01-01T00:00:00Z");
    install_active(&fx, &fx.priv_key, "v2");
    assert_eq!(launch(&fx, Some(&fx.node)), fx.suite_dir.join("active"));
}

#[test]
fn launch_refuses_a_tampered_retained_tarball() {
    let fx = fresh_box("launch-tamper", "2026-01-01T00:00:00Z");
    install_active(&fx, &fx.priv_key, "v2");
    let tgz = fx.suite_dir.join("active.tgz");
    let mut b = std::fs::read(&tgz).unwrap();
    let mid = b.len() / 2;
    b[mid] ^= 0xff;
    std::fs::write(&tgz, b).unwrap();
    assert_eq!(launch(&fx, Some(&fx.node)), fx.payload, "a corrupted active.tgz must fall back to the payload");
}

#[test]
fn launch_refuses_an_override_signed_by_another_key_even_with_its_own_key_planted() {
    let fx = fresh_box("launch-forged", "2026-01-01T00:00:00Z");
    let wrong_pub = fx.tools.join("wrong-pub.pem");
    let wrong_priv = fx.tools.join("wrong-priv.pem");
    must(Command::new(&fx.node).arg(fx.tools.join("keygen.mjs")).arg(&wrong_pub).arg(&wrong_priv), "wrong keygen");
    install_active(&fx, &wrong_priv, "v2");
    // The attacker also plants their own key AND a verifier that always says yes inside the writable override.
    // The launch must still verify with the READ-ONLY payload's verifier and key.
    let a = fx.suite_dir.join("active");
    write(&a.join("relay-app").join("release-pubkey.pem"), &std::fs::read_to_string(&wrong_pub).unwrap());
    write(&a.join("scripts").join("verify-suite-bundle.mjs"), "process.exit(0);\n");
    assert_eq!(launch(&fx, Some(&fx.node)), fx.payload, "an override signed by a key the payload does not pin must not run");
}

#[test]
fn launch_refuses_an_override_missing_its_signature_or_tarball() {
    let fx = fresh_box("launch-missing", "2026-01-01T00:00:00Z");
    install_active(&fx, &fx.priv_key, "v2");
    let sig = fx.suite_dir.join("active.sig");
    let tgz = fx.suite_dir.join("active.tgz");
    std::fs::rename(&sig, fx.suite_dir.join("held.sig")).unwrap();
    assert_eq!(launch(&fx, Some(&fx.node)), fx.payload, "no active.sig must run the payload");
    std::fs::rename(fx.suite_dir.join("held.sig"), &sig).unwrap();
    std::fs::remove_file(&tgz).unwrap();
    assert_eq!(launch(&fx, Some(&fx.node)), fx.payload, "no active.tgz must run the payload");
}

#[test]
fn launch_without_the_node_sidecar_runs_the_payload() {
    let fx = fresh_box("launch-nonode", "2026-01-01T00:00:00Z");
    install_active(&fx, &fx.priv_key, "v2");
    assert_eq!(launch(&fx, None), fx.payload, "with no node to verify with, nothing unverified may run");
    // and a node path that does not exist is the same as none (the verifier cannot run)
    assert_eq!(launch(&fx, Some(Path::new("/nonexistent/node"))), fx.payload);
}

// ── port-binding scenarios (run in sequence by end_to_end_apply_harness) ─────────────────────────────────────

// (f) TOGGLE OFF — what every Suite does on every start unless the operator opted in. Nothing applied → the launch
//     runs the shipped payload and the relay serves it; and even a bundle sitting in staging is NOT applied by
//     the controller tick, because the enable marker is absent.
fn scenario_f_toggle_off_launch_runs_shipped_code_and_ignores_staging() {
    eprintln!("── scenario (f): toggle off — launch runs shipped code, staging ignored ──");
    let fx = fresh_box("f", "2026-01-01T00:00:00Z");
    let log = fx.data_dir.join("relay-launch.log");
    std::fs::remove_file(fx.data_dir.join("suite-autoupdate")).unwrap(); // the toggle is OFF
    build_signed_bundle(&fx.node, &fx.tools, &fx.priv_key, &fx.staging, &good("v2", SHA2, "2026-10-01T00:00:00Z"));
    write_ready(&fx.staging, "v2", SHA2, "2026-10-01T00:00:00Z");

    let host = TestHost::new(fx.node.clone());
    // A REAL start inside the window: with the switch off nothing is applied and the shipped code runs.
    let mut cur = start_at(&host, &fx, &log, IN_WINDOW);
    assert_eq!(cur.code_dir, fx.payload, "with nothing applied the start must run the shipped payload");
    assert!(wait_for_served("v1", Duration::from_secs(10)), "the shipped payload (v1) is not what the relay serves");

    run_apply(&host, &fx, &log, &mut cur);
    assert_eq!(served_version().as_deref(), Some("v1"), "toggle OFF but the staged bundle was applied");
    assert!(!fx.suite_dir.join("active").exists(), "toggle OFF but active/ was created");
    assert!(fx.staging.join("READY").exists(), "toggle OFF must leave staging alone");
    host.stop_relay();
    eprintln!("   (f) OK — payload launched and served, staged bundle left alone with the toggle off");
}

// (g) The Suite is quit and started again after a good apply: the REAL startup picks active/ (its retained tarball
//     verifies, it is newer than the payload, the switch is on, the tree matches) and the relay serves the update.
fn scenario_g_relaunch_after_an_apply_runs_the_update() {
    eprintln!("── scenario (g): relaunch after a good apply runs the update ──");
    let fx = fresh_box("g", "2026-01-01T00:00:00Z");
    let log = fx.data_dir.join("relay-launch.log");
    build_signed_bundle(&fx.node, &fx.tools, &fx.priv_key, &fx.staging, &good("v2", SHA2, "2026-10-01T00:00:00Z"));
    write_ready(&fx.staging, "v2", SHA2, "2026-10-01T00:00:00Z");
    {
        let host = TestHost::new(fx.node.clone());
        let mut cur = start_v1(&host, &fx, &log);
        run_apply(&host, &fx, &log, &mut cur);
        assert!(wait_for_served("v2", Duration::from_secs(15)), "precondition: the apply did not take");
        host.stop_relay(); // quit the Suite
    }
    assert!(wait_port_free(Duration::from_secs(10)), "the relay did not stop");
    let host = TestHost::new(fx.node.clone());
    let cur = start_at(&host, &fx, &log, 840); // the next start, at 14:00
    assert_eq!(cur.code_dir, fx.suite_dir.join("active"), "after a good apply the next start must run the update");
    assert!(wait_for_served("v2", Duration::from_secs(10)), "the restarted relay is not serving the update");
    host.stop_relay();
    eprintln!("   (g) OK — relaunch picked active/ and serves v2");
}

// Pretend a day has passed: the apply runs once per calendar day (due()), so a second apply needs an earlier
// lastApplied. Only that one field is changed.
fn yesterday_in_state(suite_dir: &Path) {
    let p = suite_dir.join("state.json");
    let raw = std::fs::read_to_string(&p).unwrap();
    let la = json_str_value(&raw, "lastApplied").expect("state.json has lastApplied");
    std::fs::write(&p, raw.replace(&format!("\"lastApplied\":\"{la}\""), "\"lastApplied\":\"2000-01-01\"")).unwrap();
}

// (h) A good v2 is running as the override; the next night's v3 boots but fails health. It must roll back to v2
//     (LAST-GOOD — scenario (e) only covers rollback to the payload), keep v2's retained tarball, quarantine v3,
//     record that it rolled back while still installed as v2, and switch auto-update off (audit M7).
fn scenario_h_bad_update_over_a_good_one_rolls_back_to_last_good() {
    eprintln!("── scenario (h): bad v3 over good v2 rolls back to last-good (≈45s health timeout) ──");
    let fx = fresh_box("h", "2026-01-01T00:00:00Z");
    let log = fx.data_dir.join("relay-launch.log");
    build_signed_bundle(&fx.node, &fx.tools, &fx.priv_key, &fx.staging, &good("v2", SHA2, "2026-10-01T00:00:00Z"));
    write_ready(&fx.staging, "v2", SHA2, "2026-10-01T00:00:00Z");
    let host = TestHost::new(fx.node.clone());
    let mut cur = start_v1(&host, &fx, &log);
    run_apply(&host, &fx, &log, &mut cur);
    assert!(wait_for_served("v2", Duration::from_secs(15)), "precondition: v2 did not apply");
    let v2_tgz = std::fs::read(fx.suite_dir.join("active.tgz")).unwrap();

    yesterday_in_state(&fx.suite_dir);
    build_signed_bundle(&fx.node, &fx.tools, &fx.priv_key, &fx.staging, &Bundle { label: "WRONG-not-v3", sha: SHA3, date: "2026-10-02T00:00:00Z", lie: true });
    write_ready(&fx.staging, "v3", SHA3, "2026-10-02T00:00:00Z");
    run_apply(&host, &fx, &log, &mut cur);

    assert!(wait_for_served("v2", Duration::from_secs(15)), "after v3 failed health the relay must be back on v2, not the payload");
    assert_eq!(cur.code_dir, fx.suite_dir.join("active"), "the controller's current code dir must be active/ (holding v2)");
    assert_eq!(std::fs::read(fx.suite_dir.join("active.tgz")).unwrap(), v2_tgz, "active.tgz must be v2's again");
    assert!(!fx.suite_dir.join("last-good").exists(), "last-good/ must have been moved back to active/");
    let q = std::fs::read_to_string(fx.suite_dir.join("quarantine-sha")).unwrap_or_default();
    assert_eq!(q.trim(), SHA3, "v3 must be quarantined");
    assert_eq!(read_state_field(&fx.suite_dir, "lastOutcome").as_deref(), Some("rolledback"));
    assert_eq!(read_state_field(&fx.suite_dir, "installedVersion").as_deref(), Some("v2"), "installed identity must stay v2");
    assert!(!fx.staging.join("READY").exists(), "v3's staging must be discarded");
    host.stop_relay();
    assert!(wait_port_free(Duration::from_secs(10)), "the relay did not stop");
    // [audit M7] a rollback switches auto-update OFF, and says so in state.json …
    assert!(!fx.data_dir.join("suite-autoupdate").exists(), "a rollback must switch auto-update off");
    let raw = std::fs::read_to_string(fx.suite_dir.join("state.json")).unwrap();
    assert!(raw.contains("\"autoOff\":true"), "state.json must record that auto-update was switched off: {raw}");
    assert_eq!(read_state_field(&fx.suite_dir, "lastReason").as_deref(), Some("the update started but reported the wrong version"));
    // … so [audit H3] the next start returns to the shipped code; v2 stays on disk (it runs again if switched back on).
    assert_eq!(launch(&fx, Some(&fx.node)), fx.payload, "switched off → the next start runs the shipped code");
    assert!(fx.suite_dir.join("active.tgz").exists(), "v2 is kept, not deleted, when merely switched off");
    write(&fx.data_dir.join("suite-autoupdate"), "00:00\n");
    assert_eq!(launch(&fx, Some(&fx.node)), fx.suite_dir.join("active"), "switched back on → v2 runs again");
    eprintln!("   (h) OK — v3 rolled back to v2 (last-good), sha-v3 quarantined, auto-update switched off");
}

// A host whose stop never lands (a wedged relay child). Each respawn parks the previous child so teardown can
// still reap it; the drop kills everything.
struct WedgedHost {
    inner: TestHost,
    parked: Mutex<Vec<Child>>,
}
impl RelayHost for WedgedHost {
    fn spawn_relay(&self, code_dir: &Path, payload: &Path, data_dir: &Path, log: &Path) -> Option<Arc<AtomicBool>> {
        if let Some(c) = self.inner.child.lock().unwrap().take() {
            self.parked.lock().unwrap().push(c);
        }
        self.inner.spawn_relay(code_dir, payload, data_dir, log)
    }
    fn stop_relay(&self) {}
    fn reload_webview(&self) {}
}
impl Drop for WedgedHost {
    fn drop(&mut self) {
        for mut c in self.parked.lock().unwrap().drain(..) {
            let _ = c.kill();
            let _ = c.wait();
        }
        self.inner.stop_relay();
    }
}

// (i) The relay will not stop for the swap. The apply must abort WITHOUT touching active/, keep the church on the
//     code it was running, keep the staged bundle for later, and back off (~1h) instead of retrying every minute.
fn scenario_i_relay_that_will_not_stop_backs_off() {
    eprintln!("── scenario (i): a relay that will not stop — abort, stay up, back off (≈20s stop timeout) ──");
    let fx = fresh_box("i", "2026-01-01T00:00:00Z");
    let log = fx.data_dir.join("relay-launch.log");
    build_signed_bundle(&fx.node, &fx.tools, &fx.priv_key, &fx.staging, &good("v2", SHA2, "2026-10-01T00:00:00Z"));
    write_ready(&fx.staging, "v2", SHA2, "2026-10-01T00:00:00Z");
    let host = WedgedHost { inner: TestHost::new(fx.node.clone()), parked: Mutex::new(Vec::new()) };
    let clock = clock_at(IN_WINDOW);
    let env = env_for(&host, &fx, &log, &clock);
    let mut st = RunState { code_dir: fx.payload.clone(), alive: Arc::new(AtomicBool::new(false)), cooldown_until: None };
    assert!(spawn_and_wait(&env, &mut st, &fx.payload));
    assert!(wait_for_served("v1", Duration::from_secs(10)), "v1 did not serve");

    let t0 = Instant::now();
    maybe_apply(&env, &mut st);
    let until = st.cooldown_until.expect("a stop timeout must set the apply cooldown");
    assert!(until >= t0 + Duration::from_secs(50 * 60), "the back-off is shorter than ~1h");
    assert_eq!(served_version().as_deref(), Some("v1"), "the church must stay on the code it was running");
    assert_eq!(st.code_dir, fx.payload, "the current code dir must still be the payload");
    assert!(!fx.suite_dir.join("active").exists(), "nothing may be swapped when the relay did not stop");
    assert!(fx.staging.join("READY").exists(), "the staged bundle must be kept for a later attempt");

    // The next tick (a minute later in production) does nothing while the cooldown runs — returns at once.
    let t1 = Instant::now();
    maybe_apply(&env, &mut st);
    assert!(t1.elapsed() < Duration::from_secs(5), "a tick inside the cooldown tried to apply again");
    assert!(fx.staging.join("READY").exists());
    eprintln!("   (i) OK — aborted without a swap, v1 still serving, staging kept, backed off ~1h");
}
