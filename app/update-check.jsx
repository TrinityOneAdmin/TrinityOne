// update-check.jsx — sideloaded apps get no Play Store nudge, so check for a newer APK on open.
// On a native launch we read the installed versionCode (App.getInfo().build), fetch a tiny manifest
// (apk-latest.json, served from the church domain), and if a higher versionCode is published we show a
// dismissible banner that opens the APK download. Web/PWA updates handle themselves, so this is native-only —
// EXCEPT the desktop finance program ('finance-desktop', below), which has its own manifest, its own guard and
// never downloads anything itself.

const UPDATE_MANIFEST = 'https://app.trinityone.church/apk-latest.json';   // { versionCode, versionName, url, stewardVersionCode, stewardUrl, financeVersionCode, financeUrl }
const UPDATE_APK_URL = 'https://app.trinityone.church/trinityone.apk';
const UPDATE_STEWARD_APK_URL = 'https://app.trinityone.church/trinityone-steward.apk';
const _updLaunched = new Set();   // module-level one-shot: version codes we've already launched a download for. Survives component remounts (a per-component ref does NOT), so the download fires AT MOST once per version per app session — the real fix for repeated downloads from one Update tap.

// THREE APPS, THREE ROWS IN ONE MANIFEST (T1Finance M2, 2026-11-17). Each app reads ONLY its own fields and keeps its
// own "Later": offering a different app's APK installs a SECOND app (different applicationId) and leaves this one as
// it was. 'member' and 'steward' are exactly what they were; 'finance' is new and has NO fallback url — a manifest
// without financeVersionCode AND financeUrl offers the finance app nothing, never another app's APK.
// Any other variant reads the member row, as before (variant==='steward' else member).
// CALLERS (rule 2): app/app.jsx (member, no variant), app/steward-root.jsx StewardRoot (variant 'steward' on
// steward.html, 'finance' on finance.html, 'finance-desktop' in the desktop finance program).
const UPDATE_VARIANTS = {
  member:  { code: 'versionCode',        url: 'url',        fallback: UPDATE_APK_URL,         snooze: 'trinityone.updateSnoozed' },
  steward: { code: 'stewardVersionCode', url: 'stewardUrl', fallback: UPDATE_STEWARD_APK_URL, snooze: 'trinityone.steward.updateSnoozed' },
  finance: { code: 'financeVersionCode', url: 'financeUrl', fallback: '',                     snooze: 'trinityone.finance.updateSnoozed' },
};

// THE DESKTOP FINANCE PROGRAM (T1Finance desktop plan §4, D4: a banner only — never an auto-updater). A FOURTH,
// SEPARATE manifest, finance-desktop-latest.json = { version: "1.2.0" }, of which ONLY `version` is read. The program
// compares it as SEMVER against window.TRINITY_BUILD.version (its build stamp, scripts/build-finance-desktop.sh) —
// never parseInt, so 1.10.0 is newer than 1.9.0. A version that is not plain MAJOR.MINOR.PATCH (a prerelease
// "1.2.0-rc1", build metadata, anything else) offers nothing. The link is BUILT from the version under a fixed
// prefix — a url in the manifest is never used — and it is exactly the address the program's Rust allow-list hands
// to the system browser (finance-app/desktop/src-tauri/src/nav.rs). The banner only opens that page.
const UPDATE_DESKTOP_MANIFEST = 'https://app.trinityone.church/finance-desktop-latest.json';
const UPDATE_DESKTOP_TAG = 'https://github.com/TrinityOneAdmin/TrinityOne/releases/tag/finance-v';
const UPDATE_DESKTOP_SNOOZE = 'trinityone.financeDesktop.updateSnoozed';
const UPDATE_FINAL_SEMVER = /^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/;
// [major, minor, patch, prerelease-or-''] of a semver string, or null. The INSTALLED build may be a prerelease
// (an -rc build); a published one may not (updatePick refuses it).
function updateSemver(v) {
  const m = /^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})(?:-([0-9A-Za-z.-]+))?$/.exec(typeof v === 'string' ? v : '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] || ''] : null;
}
// true when `a` is a strictly newer version than `b` (a final release outranks a prerelease of the same core).
// An unreadable `b` (no build stamp) is never "older" — nothing is offered against a version we cannot read.
function updateSemverNewer(a, b) {
  const x = updateSemver(a), y = updateSemver(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return !x[3] && !!y[3];
}
window.updateSemverNewer = updateSemverNewer;
// a GATE, not a hint: the program is a packaged origin (src/steward.src.js _packagedOrigin) that is NOT Capacitor,
// and it carries the desktop build stamp. On the web or in an APK this is false and the variant shows nothing.
function updateIsDesktopProgram() {
  const S = window.Steward, B = window.TRINITY_BUILD, Cap = window.Capacitor;
  if (Cap && Cap.isNativePlatform && Cap.isNativePlatform()) return false;
  return !!(S && typeof S.packagedOrigin === 'function' && S.packagedOrigin() && B && B.app === 'finance-desktop');
}

// The row this app reads from a fetched manifest: { latest, apkUrl, snoozeKey }, or null when it offers this app nothing.
// For 'finance-desktop': { latest: '1.10.0', pageUrl: <the fixed tag page>, snoozeKey }, or null.
function updatePick(m, variant) {
  if (variant === 'finance-desktop') {
    const ver = m && typeof m.version === 'string' ? m.version : '';
    if (!UPDATE_FINAL_SEMVER.test(ver)) return null;
    return { latest: ver, pageUrl: UPDATE_DESKTOP_TAG + ver, snoozeKey: UPDATE_DESKTOP_SNOOZE };
  }
  const v = UPDATE_VARIANTS[variant] || UPDATE_VARIANTS.member;
  const latest = parseInt(m && m[v.code], 10) || 0;
  const file = m && typeof m[v.url] === 'string' && m[v.url] ? m[v.url] : '';
  const apkUrl = file ? 'https://app.trinityone.church/' + file : v.fallback;
  if (!latest || !apkUrl) return null;
  return { latest, apkUrl, snoozeKey: v.snooze };
}
window.updatePick = updatePick;

// The desktop program's banner: shows when finance-desktop-latest.json names a final version newer than this build
// and newer than the one "Later" was pressed for. "Open download page" opens the release page (window.open — the
// program's Rust new-window handler sends exactly that address to the system browser and opens no window); the
// helper downloads and installs it themselves. Nothing here downloads or installs.
function UpdateBannerDesktop() {
  const [upd, setUpd] = React.useState(null);   // { latest, pageUrl } once a newer release is listed
  React.useEffect(() => {
    if (!updateIsDesktopProgram()) return;
    const installed = window.TRINITY_BUILD.version;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(UPDATE_DESKTOP_MANIFEST + '?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) return;
        const pick = updatePick(await res.json(), 'finance-desktop');
        if (!alive || !pick || !updateSemverNewer(pick.latest, installed)) return;
        let snoozed = ''; try { snoozed = localStorage.getItem(UPDATE_DESKTOP_SNOOZE) || ''; } catch (e) {}
        if (snoozed && !updateSemverNewer(pick.latest, snoozed)) return;   // "Later" was pressed for this version (or a newer one)
        setUpd({ latest: pick.latest, pageUrl: pick.pageUrl });
      } catch (e) {}
    })();
    return () => { alive = false; };
  }, []);
  if (!upd) return null;
  const later = () => { try { localStorage.setItem(UPDATE_DESKTOP_SNOOZE, upd.latest); } catch (e) {} setUpd(null); };
  const open = () => { try { window.open(upd.pageUrl, '_blank'); } catch (e) {} setUpd(null); };   // hidden for this session only: not installed yet, so it returns next launch
  return (
    <div data-update-banner="finance-desktop" style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 10px)', left: 12, right: 12, zIndex: 70, margin: '0 auto', maxWidth: 460,
      background: 'var(--ink)', color: 'var(--paper)', borderRadius: 16, boxShadow: 'var(--shadow-lg)', padding: '12px 14px',
      display: 'flex', alignItems: 'center', gap: 12, animation: 'trinityFade .4s ease both' }}>
      <div style={{ width: 36, height: 36, borderRadius: 11, background: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name="arrowUp" size={19} color="#fff" /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Update available · {upd.latest}</div>
        <div style={{ fontSize: 12, opacity: .8, lineHeight: 1.35 }}>A newer TrinityOne Finance is ready — download and install it.</div>
      </div>
      <button onClick={later} style={{ border: 'none', background: 'transparent', color: 'var(--paper)', opacity: .7, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '6px 4px', fontFamily: 'var(--font-ui)' }}>Later</button>
      <button onClick={open} data-update-open={upd.pageUrl} style={{ border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', padding: '8px 14px', borderRadius: 11, fontFamily: 'var(--font-ui)' }}>Open download page</button>
    </div>
  );
}

// `variant` prop: 'member' (default), 'steward', 'finance' — see UPDATE_VARIANTS above — or 'finance-desktop'
// (UpdateBannerDesktop: its own manifest, guard, compare, snooze and words).
function UpdateBanner({ ctx, variant }) {
  // before any hook ON PURPOSE, and safe: a mount's variant never changes (StewardRoot derives it from the page's
  // origin and build stamp, both fixed for the page's life), so each mount always runs the same hooks.
  if (variant === 'finance-desktop') return <UpdateBannerDesktop />;
  const snoozeKey = (UPDATE_VARIANTS[variant] || UPDATE_VARIANTS.member).snooze;
  const [upd, setUpd] = React.useState(null);   // { name, code, apkUrl } once a newer build is found
  const [busy, setBusy] = React.useState(false); // one-shot: a tapped download must not spawn duplicates
  const busyRef = React.useRef(false);           // SYNCHRONOUS guard — state lags a render, so rapid taps fired several downloads at once
  React.useEffect(() => {
    const Cap = window.Capacitor, P = Cap && Cap.Plugins;
    // APK sideload updates are an ANDROID-ONLY mechanism (sideloaded apps get no Play Store nudge). The guard used to
    // be isNativePlatform(), which is ALSO true on iOS — so on iPhone this banner fired and its Update button opened
    // https://app.trinityone.church/trinityone.apk, i.e. it offered an ANDROID package for download on iOS. It tripped
    // because the iOS build number parses BELOW the Android versionCode in apk-latest.json (225), so latest > installed.
    // iOS updates come from TestFlight / the App Store, which nudge on their own. Gate strictly to Android by NAME —
    // share-app.jsx:180 records the same isNativePlatform() trap. (2026-11-19, reported from the TestFlight pilot.)
    const android = !!(Cap && Cap.getPlatform && Cap.getPlatform() === 'android');
    if (!android || !(P && P.App && P.App.getInfo)) return;
    let alive = true;
    (async () => {
      try {
        const cur = await P.App.getInfo();                                  // { version, build }
        const installed = parseInt(cur && cur.build, 10) || 0;
        const res = await fetch(UPDATE_MANIFEST + '?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) return;
        const m = await res.json();
        // Read the correct fields for this variant (updatePick). The steward APK shares the same versionCode
        // sequence (release.sh bumps android/app/build.gradle once for both), so a manifest that
        // only carries the member fields (old format) is treated as "no update available" by the
        // steward rather than offering the wrong APK — and by the finance app, which needs its own two fields.
        const pick = updatePick(m, variant);
        if (!alive || !pick || pick.latest <= installed) return;            // nothing for this app, or already current
        const latest = pick.latest, apkUrl = pick.apkUrl;
        let snoozed = 0; try { snoozed = parseInt(localStorage.getItem(snoozeKey) || '0', 10); } catch (e) {}
        if (latest > snoozed) setUpd({ name: m.versionName || '', code: latest, apkUrl });   // honour "Later" per version
      } catch (e) {}
    })();
    return () => { alive = false; };
  }, []);
  if (!upd) return null;
  const later = () => { try { localStorage.setItem(snoozeKey, String(upd.code)); } catch (e) {} setUpd(null); };
  const get = () => {
    const code = (upd && upd.code) || 0;
    // HARD one-shot: the module-level set survives remounts AND any number of taps, so the download launches
    // at most ONCE per version per session. This is what finally stops the repeated downloads.
    if (_updLaunched.has(code)) { setUpd(null); return; }
    _updLaunched.add(code);
    busyRef.current = true;
    setBusy(true);
    try { localStorage.setItem(snoozeKey, String(code)); } catch (e) {}   // persist too: a reopen never re-shows/re-downloads this version
    setUpd(null);                                       // dismiss the banner immediately — no second tap is even possible
    // cache-bust by version so a CDN (Cloudflare) can't hand back a stale APK → downgrade → "App not installed"
    const url = (upd.apkUrl || UPDATE_APK_URL) + '?v=' + (code || Date.now());
    try { window.open(url, '_blank'); } catch (e) {}   // single launch; the location.href fallback was a second download path — removed
  };
  return (
    <div style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 10px)', left: 12, right: 12, zIndex: 70, margin: '0 auto', maxWidth: 460,
      background: 'var(--ink)', color: 'var(--paper)', borderRadius: 16, boxShadow: 'var(--shadow-lg)', padding: '12px 14px',
      display: 'flex', alignItems: 'center', gap: 12, animation: 'trinityFade .4s ease both' }}>
      <div style={{ width: 36, height: 36, borderRadius: 11, background: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name="arrowUp" size={19} color="#fff" /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Update available{upd.name ? ' · ' + upd.name : ''}</div>
        <div style={{ fontSize: 12, opacity: .8, lineHeight: 1.35 }}>A newer version of {variant === 'finance' ? 'TrinityOne Finance' : 'TrinityOne'} is ready to install.</div>
      </div>
      <button onClick={later} style={{ border: 'none', background: 'transparent', color: 'var(--paper)', opacity: .7, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '6px 4px', fontFamily: 'var(--font-ui)' }}>Later</button>
      <button onClick={get} disabled={busy} style={{ border: 'none', background: 'var(--clay)', color: 'var(--on-clay)', fontSize: 13.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? .65 : 1, padding: '8px 14px', borderRadius: 11, fontFamily: 'var(--font-ui)' }}>{busy ? 'Downloading…' : 'Update'}</button>
    </div>
  );
}
window.UpdateBanner = UpdateBanner;
