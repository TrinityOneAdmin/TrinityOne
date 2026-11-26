// TrinityOne Finance — the desktop program (Tauri 2). T1Finance desktop plan §2 (TrinityOne-internal).
//
// ONE window on the BUNDLED finance.html (dist/, built by scripts/build-finance-desktop.sh). No relay, no sidecar, no
// shell plugin, no IPC: the page talks to the shared TrinityOne relays exactly as the Android finance app does
// (src/steward.src.js _packagedOrigin classes this origin as packaged). This file decides only three native things,
// all in Rust, none reachable from the page:
//   · where the window may navigate (nav::nav_decision — own origin only; file:/data:/foreign blob: refused);
//   · which addresses open in the SYSTEM BROWSER (the two-entry allow-list in nav.rs), via tauri-plugin-opener's
//     free `open_url` — the plugin is NOT registered, so it exposes no command to the page;
//   · that a download lands in the user's Downloads folder, under a bare file name, never overwriting.
// A new-window request (window.open, target=_blank) NEVER creates a window: it is denied, and an allow-listed address
// goes to the system browser. (skPrintable's window.open('') gets null and falls back to its in-page print overlay.)
// The window is built in setup() FROM tauri.conf.json's "main" entry (create: false there), so the config's
// useHttpsScheme: true is what the window uses — the origin, and with it where the helper's key is stored.
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod nav;

use nav::Nav;
use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{Manager, Url, WebviewWindowBuilder};

/// The parts nav.rs decides on, taken from the url crate's parse (lower-cased, path-normalised).
fn parts(u: &Url) -> nav::Parts<'_> {
    nav::Parts {
        scheme: u.scheme(),
        host: u.host_str(),
        port: u.port(),
        username: u.username(),
        password: u.password(),
        path: u.path(),
        query: u.query(),
        blob_inner: None,
    }
}

/// Decide for a URL; a blob: URL is decided on the origin inside it.
fn decide<T>(u: &Url, f: impl Fn(&nav::Parts) -> T) -> T {
    if u.scheme() == "blob" {
        if let Ok(inner) = Url::parse(u.path()) {
            let mut p = parts(u);
            p.blob_inner = Some(Box::new(parts(&inner)));
            return f(&p);
        }
    }
    f(&parts(u))
}

fn open_in_browser(u: &Url) {
    // only ever reached for an address nav.rs classed External (the fixed allow-list)
    if decide(u, nav::nav_decision) == Nav::External {
        let _ = tauri_plugin_opener::open_url(u.as_str(), None::<&str>);
    }
}

/// on_navigation: load it here (own origin, our frames, our blobs); hand an allow-listed address to `open`
/// (the system browser) and stay put; refuse the rest.
fn navigation_policy(u: &Url, open: &dyn Fn(&Url)) -> bool {
    match decide(u, nav::nav_decision) {
        Nav::Allow => true,
        Nav::External => { open(u); false }
        Nav::Block => false,
    }
}

/// on_new_window (window.open, target=_blank): NEVER a new window. An allow-listed address — the update banner's
/// https://github.com/TrinityOneAdmin/TrinityOne/releases/tag/finance-v<version> among them — goes to `open`
/// (the system browser); anything else, our own origin included, is simply denied.
fn new_window_policy<R: tauri::Runtime>(u: &Url, open: &dyn Fn(&Url)) -> NewWindowResponse<R> {
    if decide(u, nav::nav_decision) == Nav::External {
        open(u);
    }
    NewWindowResponse::Deny
}

/// on_download: only our own content (nav::download_allowed), saved in `dir` under a bare, safe, unused name.
fn download_target(url: &Url, suggested: &str, dir: Option<std::path::PathBuf>, exists: &dyn Fn(&std::path::Path) -> bool) -> Option<std::path::PathBuf> {
    if !decide(url, nav::download_allowed) {
        return None;
    }
    let dir = dir?;
    Some(nav::unique_in(&dir, &nav::safe_file_name(suggested), exists))
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let cfg = app.config().app.windows.iter().find(|w| w.label == "main").cloned()
                .ok_or("tauri.conf.json has no \"main\" window")?;
            WebviewWindowBuilder::from_config(app.handle(), &cfg)?
                .on_navigation(|u| navigation_policy(u, &open_in_browser))
                .on_new_window(|u, _features| new_window_policy(&u, &open_in_browser))
                .on_download(|webview, event| match event {
                    DownloadEvent::Requested { url, destination } => {
                        let suggested = destination.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                        match download_target(&url, &suggested, webview.path().download_dir().ok(), &|p| p.exists()) {
                            Some(to) => { *destination = to; true }
                            None => false,
                        }
                    }
                    _ => true,
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("TrinityOne Finance failed to start");
}

#[cfg(test)]
mod tests {
    // The same decisions, through the REAL url-crate parse the webview hands us — userinfo tricks, `..` and case.
    use super::*;
    fn d(s: &str) -> Nav { decide(&Url::parse(s).unwrap(), nav::nav_decision) }

    // this build's own origin, and the other OS's shape (refused here)
    const OWN: &str = if cfg!(windows) { "https://tauri.localhost" } else { "tauri://localhost" };
    const OTHER: &str = if cfg!(windows) { "tauri://localhost" } else { "https://tauri.localhost" };

    #[test]
    fn parsed_urls_decide_as_nav_rs_says() {
        assert_eq!(d(&format!("{OWN}/index.html")), Nav::Allow);
        assert_eq!(d(&format!("{OTHER}/index.html")), Nav::Block);
        // the url crate lower-cases a special scheme's host, so case is no way round the rule
        assert_eq!(d("HTTPS://TAURI.LOCALHOST/"), if cfg!(windows) { Nav::Allow } else { Nav::Block });
        assert_eq!(d("http://tauri.localhost/"), Nav::Block);
        assert_eq!(d(&format!("blob:{OWN}/2f0c-uuid")), Nav::Allow);
        assert_eq!(d(&format!("blob:{OTHER}/2f0c-uuid")), Nav::Block);
        assert_eq!(d("blob:https://evil.example/2f0c-uuid"), Nav::Block);
        assert_eq!(d("file:///etc/passwd"), Nav::Block);
        assert_eq!(d("data:text/html,hi"), Nav::Block);
        assert_eq!(d("about:srcdoc"), Nav::Allow);
        assert_eq!(d("https://app.trinityone.church/"), Nav::External);
        assert_eq!(d("https://app.trinityone.church@evil.com/"), Nav::Block);
        assert_eq!(d("https://app.trinityone.church:444/"), Nav::Block);
        assert_eq!(d("https://github.com/TrinityOneAdmin/TrinityOne/releases/tag/finance-v0.1.0"), Nav::External);
        assert_eq!(d("https://github.com/TrinityOneAdmin/TrinityOne/releases/tag/finance-v0.1.0/../../../../evil/x"), Nav::Block);
        assert_eq!(d("https://github.com/TrinityOneAdmin/TrinityOne/releases/tag/relay-v0.9.2"), Nav::Block);
    }

    #[test]
    fn downloads_only_from_our_own_content() {
        let a = |s: &str| decide(&Url::parse(s).unwrap(), nav::download_allowed);
        assert!(a(&format!("blob:{OWN}/uuid")));
        assert!(!a(&format!("blob:{OTHER}/uuid")));
        assert!(!a("blob:https://evil.example/uuid"));
        assert!(!a("https://app.trinityone.church/trinityone-finance.apk"));
    }

    // ---- the three handlers main() attaches, run with a recording opener in place of the system browser ----
    use std::cell::RefCell;
    fn with_opener<T>(f: impl FnOnce(&dyn Fn(&Url)) -> T) -> (T, Vec<String>) {
        let opened = RefCell::new(Vec::new());
        let open = |u: &Url| opened.borrow_mut().push(u.to_string());
        let r = f(&open);
        (r, opened.into_inner())
    }
    fn denied(r: &NewWindowResponse<tauri::Wry>) -> bool { matches!(r, NewWindowResponse::Deny) }

    #[test]
    fn a_new_window_is_never_created_and_only_the_allow_list_reaches_the_browser() {
        // the exact link the update banner builds (app/update-check.jsx, variant 'finance-desktop')
        let tag = "https://github.com/TrinityOneAdmin/TrinityOne/releases/tag/finance-v1.10.0";
        let (r, opened) = with_opener(|o| new_window_policy::<tauri::Wry>(&Url::parse(tag).unwrap(), o));
        assert!(denied(&r), "a new window was allowed");
        assert_eq!(opened, vec![tag.to_string()]);
        for bad in [
            "https://github.com/TrinityOneAdmin/TrinityOne/releases/tag/relay-v0.9.2",
            "https://github.com/TrinityOneAdmin/TrinityOne/releases/latest",
            "https://github.com/evil/TrinityOne/releases/tag/finance-v1.10.0",
            "https://evil.example/finance-v1.10.0",
            "http://github.com/TrinityOneAdmin/TrinityOne/releases/tag/finance-v1.10.0",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "about:blank",
            &format!("{OWN}/index.html"),
        ] {
            let (r, opened) = with_opener(|o| new_window_policy::<tauri::Wry>(&Url::parse(bad).unwrap(), o));
            assert!(denied(&r), "{bad}: a new window was allowed");
            assert!(opened.is_empty(), "{bad} was handed to the system browser");
        }
    }

    #[test]
    fn navigation_stays_home_and_sends_the_allow_list_out() {
        let (r, opened) = with_opener(|o| navigation_policy(&Url::parse(&format!("{OWN}/index.html")).unwrap(), o));
        assert!(r);
        assert!(opened.is_empty());
        let (r, opened) = with_opener(|o| navigation_policy(&Url::parse("https://app.trinityone.church/help").unwrap(), o));
        assert!(!r, "an external address was loaded IN the finance window");
        assert_eq!(opened, vec!["https://app.trinityone.church/help".to_string()]);
        for bad in ["https://evil.example/", "file:///etc/passwd", "data:text/html,x", &format!("{OTHER}/index.html")] {
            let (r, opened) = with_opener(|o| navigation_policy(&Url::parse(bad).unwrap(), o));
            assert!(!r, "{bad} was loaded");
            assert!(opened.is_empty(), "{bad} was handed to the system browser");
        }
    }

    #[test]
    fn a_download_lands_in_downloads_under_a_safe_unused_name_or_not_at_all() {
        let dir = Some(std::path::PathBuf::from("/dl"));
        let none = |_: &std::path::Path| false;
        let own_blob = Url::parse(&format!("blob:{OWN}/uuid")).unwrap();
        assert_eq!(download_target(&own_blob, "../../books.csv", dir.clone(), &none), Some(std::path::PathBuf::from("/dl/books.csv")));
        assert_eq!(download_target(&own_blob, "CON.csv", dir.clone(), &none), Some(std::path::PathBuf::from("/dl/_CON.csv")));
        let taken = |p: &std::path::Path| p == std::path::Path::new("/dl/books.csv");
        assert_eq!(download_target(&own_blob, "books.csv", dir.clone(), &taken), Some(std::path::PathBuf::from("/dl/books (1).csv")));
        assert_eq!(download_target(&own_blob, "books.csv", None, &none), None, "no Downloads folder: refuse, do not guess");
        let foreign = Url::parse("https://app.trinityone.church/trinityone-finance.apk").unwrap();
        assert_eq!(download_target(&foreign, "x.apk", dir, &none), None);
    }
}
