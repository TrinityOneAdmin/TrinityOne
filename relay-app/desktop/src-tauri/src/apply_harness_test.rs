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
        for (k, v) in relay_env(code_dir, payload, data_dir, "/nonexistent/cloudflared", "127.0.0.1") {
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

// A minimal gateway that binds argv[2] on loopback and serves {"version":V,"ok":true} on /status.
fn gateway_src(version: &str) -> String {
    format!(
        "import http from 'node:http';\n\
         const PORT = Number(process.argv[2]);\n\
         const VERSION = {v:?};\n\
         http.createServer((req,res)=>{{\n\
           if ((req.url||'').startsWith('/status')) {{\n\
             res.writeHead(200,{{'content-type':'application/json'}});\n\
             res.end(JSON.stringify({{version:VERSION, ok:true}}));\n\
             return;\n\
           }}\n\
           res.writeHead(404); res.end('no');\n\
         }}).listen(PORT,'127.0.0.1');\n",
        v = version
    )
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

// Build a real .tgz whose scripts/gateway.mjs serves `gw_version`, then sign it with the throwaway key.
// Writes bundle.tgz + bundle.sig into `staging` and returns nothing (caller writes READY).
// Build a real .tgz whose scripts/gateway.mjs serves `gw_version`, then sign the EXACT tarball bytes with
// `signing_key` (same raw-Ed25519 path the verifier checks). Pass the payload-pinned private key for a valid
// bundle, or a DIFFERENT key to forge an invalid-signature bundle over a perfectly good tarball.
fn build_signed_bundle(
    node: &Path,
    tools: &Path,
    signing_key: &Path,
    staging: &Path,
    gw_version: &str,
) {
    let stage = staging.join(".build");
    let _ = std::fs::remove_dir_all(&stage);
    write(&stage.join("scripts").join("gateway.mjs"), &gateway_src(gw_version));
    let tgz = staging.join("bundle.tgz");
    let sig = staging.join("bundle.sig");
    // Real tarball, leading "./" like build-suite-js-bundle.sh so unpack is a plain `tar -xzf`.
    must(Command::new("tar").arg("-czf").arg(&tgz).arg("-C").arg(&stage).arg("."), "tar bundle");
    must(
        Command::new(node).arg(tools.join("signer.mjs")).arg(&tgz).arg(&sig).arg(signing_key),
        "sign bundle",
    );
    let _ = std::fs::remove_dir_all(&stage);
}

fn write_ready(staging: &Path, version: &str, sha: &str, date: &str) {
    write(
        &staging.join("READY"),
        &format!("{{\"version\":\"{version}\",\"sha\":\"{sha}\",\"date\":\"{date}\"}}\n"),
    );
}

// Read the version string the relay on PORT currently serves at /status (REAL probe), or None.
fn served_version() -> Option<String> {
    let body = http_get_loopback("/status", None)?;
    json_str_value(&body, "version")
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
    write(&payload.join("scripts").join("gateway.mjs"), &gateway_src("v1"));
    write(&payload.join("version.txt"), &format!("sha-v1\n{payload_date}\n"));

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

// Start the baked-in payload (v1) via the REAL spawn_and_wait, so cur_code_dir/cur_alive are set exactly as in
// production. Returns (cur_code_dir, cur_alive). Asserts v1 is actually serving.
fn start_v1(host: &TestHost, fx: &Fixture, log: &Path) -> (PathBuf, Arc<AtomicBool>) {
    let mut cur_code_dir = fx.payload.clone();
    let mut cur_alive = Arc::new(AtomicBool::new(true));
    let up = spawn_and_wait(
        host,
        &fx.payload,
        &fx.payload,
        &fx.data_dir,
        log,
        &mut cur_code_dir,
        &mut cur_alive,
    );
    assert!(up, "v1 payload relay failed to come up");
    assert!(wait_for_served("v1", Duration::from_secs(10)), "v1 did not serve /status");
    (cur_code_dir, cur_alive)
}

fn run_apply(host: &TestHost, fx: &Fixture, log: &Path, cur: &mut (PathBuf, Arc<AtomicBool>)) {
    let mut cooldown: Option<Instant> = None;
    maybe_apply(
        host,
        &fx.suite_dir,
        &fx.payload,
        &fx.data_dir,
        log,
        Some(fx.node.as_path()),
        &mut cur.0,
        &mut cur.1,
        &mut cooldown,
    );
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

    eprintln!("ALL 5 apply-harness scenarios passed");
}

// (a) good, newer, validly-signed bundle → activates; relay serves v2.
fn scenario_a_good_bundle_activates() {
    eprintln!("── scenario (a): good newer bundle activates ──");
    let fx = fresh_box("a", "2026-01-01T00:00:00Z");
    let log = fx.data_dir.join("relay-launch.log");
    build_signed_bundle(&fx.node, &fx.tools, &fx.priv_key, &fx.staging, "v2");
    write_ready(&fx.staging, "v2", "sha-v2", "2026-10-01T00:00:00Z"); // newer than payload floor

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
    build_signed_bundle(&fx.node, &fx.tools, &wrong_priv, &fx.staging, "v2");
    write_ready(&fx.staging, "v2", "sha-v2", "2026-10-01T00:00:00Z");

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
    build_signed_bundle(&fx.node, &fx.tools, &fx.priv_key, &fx.staging, "v2");
    write_ready(&fx.staging, "v2", "sha-v2", "2026-03-01T00:00:00Z"); // older than installedDate

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
    build_signed_bundle(&fx.node, &fx.tools, &fx.priv_key, &fx.staging, "v2");
    write_ready(&fx.staging, "v2", "sha-v2", "2026-03-01T00:00:00Z"); // older than payload version.txt date

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
    build_signed_bundle(&fx.node, &fx.tools, &fx.priv_key, &fx.staging, "WRONG-not-v2");
    write_ready(&fx.staging, "v2", "sha-v2", "2026-10-01T00:00:00Z");

    let host = TestHost::new(fx.node.clone());
    let mut cur = start_v1(&host, &fx, &log);
    run_apply(&host, &fx, &log, &mut cur);

    // Rolled back to the baked-in payload (v1 — there was no prior override / last-good on a fresh box).
    assert!(wait_for_served("v1", Duration::from_secs(15)), "relay must be back on v1 after a health-fail rollback");
    assert!(!fx.suite_dir.join("active").exists(), "active/ must be gone after a rollback to payload");
    let quarantined = std::fs::read_to_string(fx.suite_dir.join("quarantine-sha")).unwrap_or_default();
    assert_eq!(quarantined.trim(), "sha-v2", "the failed sha must be quarantined");
    assert_eq!(read_state_field(&fx.suite_dir, "lastOutcome").as_deref(), Some("rolledback"), "state not 'rolledback'");
    assert!(!fx.staging.join("READY").exists(), "staging must be discarded after a rollback");
    host.stop_relay();
    eprintln!("   (e) OK — wrong-version v2 rolled back to v1, sha-v2 quarantined, state=rolledback");
}
