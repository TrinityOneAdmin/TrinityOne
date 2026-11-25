// nav.rs — where the TrinityOne Finance window may go, what opens in the system browser, and where a download lands.
//
// PURE AND DEPENDENCY-FREE ON PURPOSE: it takes an already-parsed URL (the `url` crate's parts, which Tauri hands
// main.rs), so the node suite compiles and runs these tests with plain `rustc --test`
// (scripts/finance-desktop-is-helpers-only.test.mjs), and `cargo test` runs them too.
//
// THE RULES (T1Finance desktop plan §2 + §8):
//   · the window stays on its OWN origin, which depends on the OS it was BUILT for (own_origin, cfg(windows)):
//     tauri://localhost on Mac/Linux, https://tauri.localhost on Windows (useHttpsScheme: true) — never both. http://tauri.localhost is REFUSED: the scheme is pinned to https, and a build that
//     flipped it would orphan every helper's stored key — better that it shows nothing than silently moves origin;
//   · about:blank / about:srcdoc are allowed (frames our own code writes into: the print overlay's srcdoc iframe);
//   · blob: is allowed ONLY for a blob minted by our own origin (`blob:tauri://localhost/…`) — that is how a CSV/PDF
//     is downloaded (an <a download> of a blob URL), and WebKitGTK asks the navigation policy before it turns that
//     into a download. Any other blob:, and every data:, file:, javascript: or other scheme, is BLOCKED;
//   · exactly two kinds of address open in the SYSTEM BROWSER (never in this window): https://app.trinityone.church/…
//     and https://github.com/TrinityOneAdmin/TrinityOne/releases/tag/finance-v<version>. Nothing else does.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Nav {
    /// load it in this window
    Allow,
    /// refuse it here and hand it to the system browser
    External,
    /// refuse it, full stop
    Block,
}

/// A parsed URL, as the `url` crate gives it (lower-cased scheme/host, normalised path).
pub struct Parts<'a> {
    pub scheme: &'a str,
    pub host: Option<&'a str>,
    pub port: Option<u16>,
    pub username: &'a str,
    pub password: Option<&'a str>,
    pub path: &'a str,
    pub query: Option<&'a str>,
    /// for `blob:` only — the parts of the origin URL inside it (`blob:<origin>/<uuid>`), parsed the same way
    pub blob_inner: Option<Box<Parts<'a>>>,
}

const RELEASE_TAG_PATH: &str = "/TrinityOneAdmin/TrinityOne/releases/tag/finance-v";

fn plain(u: &Parts) -> bool {
    u.port.is_none() && u.username.is_empty() && u.password.is_none()
}

/// This program's own origin ON THE OS IT WAS BUILT FOR: https://tauri.localhost on Windows (useHttpsScheme: true),
/// tauri://localhost everywhere else (Mac, Linux). Only ONE of the two is ever its own — the other shape is a
/// different origin that this build never serves, so it is refused like any foreign address.
pub fn own_origin(u: &Parts) -> bool {
    own_origin_on(u, cfg!(windows))
}

/// own_origin for a named platform — pure, so the Linux test run checks the Windows answer too.
pub fn own_origin_on(u: &Parts, windows: bool) -> bool {
    plain(u)
        && match (u.scheme, u.host) {
            ("tauri", Some("localhost")) => !windows,
            ("https", Some("tauri.localhost")) => windows,
            _ => false,
        }
}

fn semverish(s: &str) -> bool {
    let core = s.split('-').next().unwrap_or("");
    let nums: Vec<&str> = core.split('.').collect();
    nums.len() == 3
        && nums.iter().all(|n| !n.is_empty() && n.len() <= 6 && n.bytes().all(|b| b.is_ascii_digit()))
        && s.len() <= 40
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
}

/// The system-browser allow-list. Exactly these two; nothing else ever leaves the program.
pub fn external_allowed(u: &Parts) -> bool {
    if u.scheme != "https" || !plain(u) {
        return false;
    }
    match u.host {
        Some("app.trinityone.church") => u.path.starts_with('/'),
        Some("github.com") => {
            u.query.is_none()
                && u.path.strip_prefix(RELEASE_TAG_PATH).map(semverish).unwrap_or(false)
        }
        _ => false,
    }
}

pub fn nav_decision(u: &Parts) -> Nav {
    if own_origin(u) {
        return Nav::Allow;
    }
    match u.scheme {
        "about" => {
            if u.path == "blank" || u.path == "srcdoc" {
                Nav::Allow
            } else {
                Nav::Block
            }
        }
        "blob" => match &u.blob_inner {
            Some(inner) if own_origin(inner) => Nav::Allow,
            _ => Nav::Block,
        },
        "https" if external_allowed(u) => Nav::External,
        _ => Nav::Block,
    }
}

/// A download is accepted only from this program's own content: its own origin, or a blob it minted.
pub fn download_allowed(u: &Parts) -> bool {
    own_origin(u) || matches!(&u.blob_inner, Some(inner) if u.scheme == "blob" && own_origin(inner))
}

const MAX_NAME_CHARS: usize = 180;

/// A Windows reserved device name (CON, PRN, AUX, NUL, COM0-9, LPT0-9, and the superscript-digit COM/LPT forms) as
/// the part before the FIRST dot, any case: `con.csv`, `Nul`, `lpt1.tar.gz` all open a device, not a file, on Windows.
fn windows_reserved(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").trim_end_matches(' ').to_ascii_uppercase();
    match stem.as_str() {
        "CON" | "PRN" | "AUX" | "NUL" => true,
        _ => {
            let (head, tail) = stem.split_at(stem.char_indices().nth(3).map(|(i, _)| i).unwrap_or(stem.len()));
            (head == "COM" || head == "LPT")
                && matches!(tail, "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "\u{b9}" | "\u{b2}" | "\u{b3}")
        }
    }
}

/// The bare file name to save as: the last path component of what the webview suggested, with nothing that could
/// climb out of the Downloads folder or name a device. Never empty; at most 180 characters, and a cut keeps the
/// extension (`…long name.pdf` stays a .pdf).
pub fn safe_file_name(suggested: &str) -> String {
    let last = suggested.rsplit(|c| c == '/' || c == '\\').next().unwrap_or("");
    let cleaned: String = last
        .chars()
        .map(|c| if c.is_control() || matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_start_matches('.').trim_end_matches(|c| c == '.' || c == ' ');
    if trimmed.is_empty() {
        return "download".to_string();
    }
    let name = if windows_reserved(trimmed) { format!("_{trimmed}") } else { trimmed.to_string() };
    if name.chars().count() <= MAX_NAME_CHARS {
        return name;
    }
    // too long: keep a short extension whole and cut the stem
    let ext = match name.rfind('.') {
        Some(i) if i > 0 && name[i..].chars().count() <= 16 => &name[i..],
        _ => "",
    };
    let stem_len = MAX_NAME_CHARS - ext.chars().count();
    let stem: String = name[..name.len() - ext.len()].chars().take(stem_len).collect();
    format!("{}{ext}", stem.trim_end_matches(|c| c == '.' || c == ' '))
}

/// `<dir>/<name>`, or `<dir>/<stem> (n).<ext>` for the first n that does not exist — never overwrite a file.
/// KNOWN RACE (accepted, not fixed): this checks existence and the webview creates the file later, so a file that
/// appears in between (another download finishing at the same instant, under the same name) can be overwritten.
/// Closing it needs an exclusive create the webview's download API does not offer.
pub fn unique_in(dir: &std::path::Path, name: &str, exists: &dyn Fn(&std::path::Path) -> bool) -> std::path::PathBuf {
    let first = dir.join(name);
    if !exists(&first) {
        return first;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    for n in 1..10_000 {
        let p = dir.join(format!("{stem} ({n}){ext}"));
        if !exists(&p) {
            return p;
        }
    }
    dir.join(format!("{stem} ({}){ext}", std::process::id()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p<'a>(scheme: &'a str, host: Option<&'a str>, path: &'a str) -> Parts<'a> {
        Parts { scheme, host, port: None, username: "", password: None, path, query: None, blob_inner: None }
    }
    fn blob<'a>(inner: Parts<'a>) -> Parts<'a> {
        Parts { scheme: "blob", host: None, port: None, username: "", password: None, path: "x", query: None, blob_inner: Some(Box::new(inner)) }
    }

    // this build's own origin, and the other OS's shape — which this build must refuse
    const OWN: (&str, &str) = if cfg!(windows) { ("https", "tauri.localhost") } else { ("tauri", "localhost") };
    const OTHER: (&str, &str) = if cfg!(windows) { ("tauri", "localhost") } else { ("https", "tauri.localhost") };
    fn own<'a>(path: &'a str) -> Parts<'a> { p(OWN.0, Some(OWN.1), path) }
    fn other<'a>(path: &'a str) -> Parts<'a> { p(OTHER.0, Some(OTHER.1), path) }

    #[test]
    fn own_origin_is_the_one_shape_of_this_os() {
        assert_eq!(nav_decision(&own("/index.html")), Nav::Allow);
        assert_eq!(nav_decision(&other("/index.html")), Nav::Block, "the other OS's origin shape is not this build's own");
        assert_eq!(own_origin(&p("tauri", Some("localhost"), "/")), !cfg!(windows));
        assert_eq!(own_origin(&p("https", Some("tauri.localhost"), "/")), cfg!(windows));
    }

    #[test]
    fn own_origin_on_each_platform() {
        let tauri = p("tauri", Some("localhost"), "/index.html");
        let https = p("https", Some("tauri.localhost"), "/index.html");
        // Windows: https://tauri.localhost only
        assert!(own_origin_on(&https, true));
        assert!(!own_origin_on(&tauri, true));
        // Mac / Linux: tauri://localhost only
        assert!(own_origin_on(&tauri, false));
        assert!(!own_origin_on(&https, false));
        for w in [true, false] {
            assert!(!own_origin_on(&p("http", Some("tauri.localhost"), "/"), w));
            assert!(!own_origin_on(&p("https", Some("localhost"), "/"), w));
            assert!(!own_origin_on(&p("tauri", Some("tauri.localhost"), "/"), w));
            let mut ported = p(if w { "https" } else { "tauri" }, Some(if w { "tauri.localhost" } else { "localhost" }), "/");
            ported.port = Some(8443);
            assert!(!own_origin_on(&ported, w));
        }
    }

    #[test]
    fn http_tauri_localhost_and_lookalikes_blocked() {
        assert_eq!(nav_decision(&p("http", Some("tauri.localhost"), "/")), Nav::Block);
        assert_eq!(nav_decision(&p("tauri", Some("evil"), "/")), Nav::Block);
        assert_eq!(nav_decision(&p("https", Some("localhost"), "/")), Nav::Block);
        assert_eq!(nav_decision(&p("https", Some("tauri.localhost.evil.com"), "/")), Nav::Block);
        let mut ported = p("https", Some("tauri.localhost"), "/");
        ported.port = Some(8443);
        assert_eq!(nav_decision(&ported), Nav::Block);
        let mut user = p("tauri", Some("localhost"), "/");
        user.username = "x";
        assert_eq!(nav_decision(&user), Nav::Block);
    }

    #[test]
    fn file_data_javascript_and_foreign_blobs_blocked() {
        assert_eq!(nav_decision(&p("file", None, "/etc/passwd")), Nav::Block);
        assert_eq!(nav_decision(&p("data", None, "text/html,<script>1</script>")), Nav::Block);
        assert_eq!(nav_decision(&p("javascript", None, "alert(1)")), Nav::Block);
        assert_eq!(nav_decision(&p("about", None, "config")), Nav::Block);
        assert_eq!(nav_decision(&blob(p("https", Some("evil.example"), "/"))), Nav::Block);
        let bare = Parts { blob_inner: None, ..p("blob", None, "x") };
        assert_eq!(nav_decision(&bare), Nav::Block);
    }

    #[test]
    fn own_blobs_and_our_frames_allowed() {
        assert_eq!(nav_decision(&blob(own("/"))), Nav::Allow);
        assert_eq!(nav_decision(&blob(other("/"))), Nav::Block);
        assert_eq!(nav_decision(&p("about", None, "blank")), Nav::Allow);
        assert_eq!(nav_decision(&p("about", None, "srcdoc")), Nav::Allow);
    }

    #[test]
    fn exactly_the_two_external_addresses() {
        assert_eq!(nav_decision(&p("https", Some("app.trinityone.church"), "/")), Nav::External);
        assert_eq!(nav_decision(&p("https", Some("app.trinityone.church"), "/help")), Nav::External);
        let tag = "/TrinityOneAdmin/TrinityOne/releases/tag/finance-v0.1.0";
        assert_eq!(nav_decision(&p("https", Some("github.com"), tag)), Nav::External);
        assert_eq!(nav_decision(&p("https", Some("github.com"), "/TrinityOneAdmin/TrinityOne/releases/tag/finance-v1.2.3-rc1")), Nav::External);
        // not the finance tag, not that repo, not a release page, not https, not a version
        for bad in [
            "/TrinityOneAdmin/TrinityOne/releases/tag/relay-v0.9.2",
            "/TrinityOneAdmin/TrinityOne/releases/latest",
            "/TrinityOneAdmin/TrinityOne/releases/tag/finance-v",
            "/TrinityOneAdmin/TrinityOne/releases/tag/finance-v1.2",
            "/TrinityOneAdmin/TrinityOne/releases/tag/finance-v1.2.3/../../evil",
            "/TrinityOneAdmin/TrinityOne/releases/tag/finance-v1.2.3/download",
            "/Someone/TrinityOne/releases/tag/finance-v1.2.3",
            "/TrinityOneAdmin/TrinityOne",
        ] {
            assert_eq!(nav_decision(&p("https", Some("github.com"), bad)), Nav::Block, "{bad}");
        }
        let mut q = p("https", Some("github.com"), tag);
        q.query = Some("x=1");
        assert_eq!(nav_decision(&q), Nav::Block);
        assert_eq!(nav_decision(&p("http", Some("app.trinityone.church"), "/")), Nav::Block);
        assert_eq!(nav_decision(&p("https", Some("trinityone.church"), "/")), Nav::Block);
        assert_eq!(nav_decision(&p("https", Some("app.trinityone.church.evil.com"), "/")), Nav::Block);
        assert_eq!(nav_decision(&p("https", Some("example.com"), "/")), Nav::Block);
        let mut u = p("https", Some("app.trinityone.church"), "/");
        u.username = "a";
        assert_eq!(nav_decision(&u), Nav::Block);
        let mut port = p("https", Some("app.trinityone.church"), "/");
        port.port = Some(444);
        assert_eq!(nav_decision(&port), Nav::Block);
    }

    #[test]
    fn downloads_only_from_our_own_content() {
        assert!(download_allowed(&blob(own("/"))));
        assert!(download_allowed(&own("/x.csv")));
        assert!(!download_allowed(&blob(other("/"))));
        assert!(!download_allowed(&other("/x.csv")));
        assert!(!download_allowed(&blob(p("https", Some("evil.example"), "/"))));
        assert!(!download_allowed(&p("https", Some("app.trinityone.church"), "/x.apk")));
        assert!(!download_allowed(&p("data", None, "text/csv,a")));
    }

    #[test]
    fn file_names_cannot_climb_out_of_downloads() {
        assert_eq!(safe_file_name("books-2026.csv"), "books-2026.csv");
        assert_eq!(safe_file_name("../../.bashrc"), "bashrc");
        assert_eq!(safe_file_name("C:\\Windows\\x.exe"), "x.exe");
        assert_eq!(safe_file_name("/home/me/.ssh/id"), "id");
        assert_eq!(safe_file_name("a:b?.pdf"), "a_b_.pdf");
        assert_eq!(safe_file_name(""), "download");
        assert_eq!(safe_file_name("..."), "download");
        assert_eq!(safe_file_name("x."), "x");
    }

    #[test]
    fn windows_device_names_are_never_the_file_name() {
        for (given, want) in [
            ("CON", "_CON"), ("con.csv", "_con.csv"), ("Nul.pdf", "_Nul.pdf"), ("prn", "_prn"), ("aux.tar.gz", "_aux.tar.gz"),
            ("COM1.csv", "_COM1.csv"), ("com9", "_com9"), ("LPT1.txt", "_LPT1.txt"), ("lpt9.pdf", "_lpt9.pdf"),
            ("COM\u{b9}.csv", "_COM\u{b9}.csv"), ("con .csv", "_con .csv"), ("../../NUL", "_NUL"),
        ] {
            assert_eq!(safe_file_name(given), want, "{given}");
        }
        // not reserved: a longer word, COM10, a name that only CONTAINS a device name
        for ok in ["console.csv", "COM10.csv", "LPT.csv", "nullable.pdf", "my-con.csv", "aux_books.csv", "COMA.csv"] {
            assert_eq!(safe_file_name(ok), ok);
        }
    }

    #[test]
    fn a_long_name_is_cut_to_180_and_keeps_its_extension() {
        let long = format!("{}.pdf", "a".repeat(300));
        let got = safe_file_name(&long);
        assert_eq!(got.chars().count(), 180);
        assert!(got.ends_with(".pdf"), "{got}");
        assert_eq!(got, format!("{}.pdf", "a".repeat(176)));
        // multi-byte characters are counted as characters, and the cut never splits one
        let wide = format!("{}.csv", "\u{e9}".repeat(400));
        let got = safe_file_name(&wide);
        assert_eq!(got.chars().count(), 180);
        assert!(got.ends_with(".csv"));
        // no extension (or an absurd one): a plain cut
        assert_eq!(safe_file_name(&"b".repeat(400)), "b".repeat(180));
        let weird = format!("x.{}", "e".repeat(300));
        assert_eq!(safe_file_name(&weird).chars().count(), 180);
        // a cut that lands on a space or dot does not leave one before the extension's dot
        let spaced = format!("{} z.pdf", "c".repeat(175));
        assert_eq!(safe_file_name(&spaced), format!("{}.pdf", "c".repeat(175)));
        // at exactly 180 it is untouched
        let exact = format!("{}.pdf", "d".repeat(176));
        assert_eq!(safe_file_name(&exact), exact);
    }

    #[test]
    fn never_overwrites() {
        let d = std::path::Path::new("/dl");
        let taken = |q: &std::path::Path| q == std::path::Path::new("/dl/a.csv") || q == std::path::Path::new("/dl/a (1).csv");
        assert_eq!(unique_in(d, "a.csv", &taken), std::path::PathBuf::from("/dl/a (2).csv"));
        assert_eq!(unique_in(d, "b.csv", &taken), std::path::PathBuf::from("/dl/b.csv"));
        let all = |q: &std::path::Path| q == std::path::Path::new("/dl/noext");
        assert_eq!(unique_in(d, "noext", &all), std::path::PathBuf::from("/dl/noext (1)"));
    }
}
