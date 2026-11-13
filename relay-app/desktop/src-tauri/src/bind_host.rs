// Which network address the Suite's relay listens on — the decision that keeps a church's Suite off a hall's
// guest wifi (AUDIT-2026-07-27). Loopback (this computer only) unless the operator has switched on LAN access
// in the control panel, which makes the gateway write the `lan-access` marker into the data dir
// (gateway.mjs: join(DATA_DIR, 'lan-access')).
//
// This file has NO dependencies on purpose, so it compiles and tests on its own, without Tauri or cargo:
//     rustc --edition 2021 --test src/bind_host.rs -o /tmp/bind_host && /tmp/bind_host
// That is how scripts/relay-bind-setting.test.mjs runs these tests inside the node suite. main.rs includes this
// same file as `mod bind_host` and relay_env() calls relay_bind_host() for every relay launch (first start and
// every auto-update respawn), so the tests below run the code the Suite runs.
use std::path::Path;

pub const LAN_ACCESS_MARKER: &str = "lan-access";
pub const LOOPBACK: &str = "127.0.0.1";
pub const ALL_INTERFACES: &str = "0.0.0.0";

pub fn relay_bind_host(data_dir: &Path) -> &'static str {
    if data_dir.join(LAN_ACCESS_MARKER).exists() {
        ALL_INTERFACES
    } else {
        LOOPBACK
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    // A real, empty data dir under the system temp dir; removed on drop.
    struct Dir(PathBuf);
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn fresh(tag: &str) -> Dir {
        let p = std::env::temp_dir().join(format!(
            "trin-bind-{tag}-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        Dir(p)
    }

    #[test]
    fn no_marker_listens_on_this_computer_only() {
        let d = fresh("none");
        assert_eq!(relay_bind_host(&d.0), "127.0.0.1");
    }

    #[test]
    fn the_marker_opens_it_to_the_network() {
        let d = fresh("on");
        std::fs::write(d.0.join("lan-access"), "1").unwrap();
        assert_eq!(relay_bind_host(&d.0), "0.0.0.0");
    }

    #[test]
    fn removing_the_marker_closes_it_again() {
        let d = fresh("off");
        let m = d.0.join("lan-access");
        std::fs::write(&m, "1").unwrap();
        assert_eq!(relay_bind_host(&d.0), "0.0.0.0");
        std::fs::remove_file(&m).unwrap();
        assert_eq!(relay_bind_host(&d.0), "127.0.0.1");
    }

    #[test]
    fn a_first_run_with_no_data_dir_is_loopback() {
        let d = fresh("missing");
        let gone = d.0.join("not-created-yet");
        assert_eq!(relay_bind_host(&gone), "127.0.0.1");
    }

    #[test]
    fn only_the_exact_marker_in_the_data_dir_counts() {
        let d = fresh("lookalike");
        // near-miss names in the data dir, and the right name one level UP, must all leave it on loopback
        std::fs::write(d.0.join("lan-access.tmp"), "1").unwrap();
        std::fs::write(d.0.join("lan_access"), "1").unwrap();
        let data = d.0.join("data");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(d.0.join("lan-access"), "1").unwrap(); // parent of `data`, not `data` itself
        assert_eq!(relay_bind_host(&data), "127.0.0.1");
    }
}
