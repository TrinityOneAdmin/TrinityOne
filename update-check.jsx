// update-check.jsx — sideloaded apps get no Play Store nudge, so check for a newer APK on open.
// On a native launch we read the installed versionCode (App.getInfo().build), fetch a tiny manifest
// (apk-latest.json, served from the church domain), and if a higher versionCode is published we show a
// dismissible banner that opens the APK download. Web/PWA updates handle themselves, so this is native-only.

const UPDATE_MANIFEST = 'https://app.trinityone.church/apk-latest.json';   // { versionCode, versionName, url }
const UPDATE_APK_URL = 'https://app.trinityone.church/trinityone.apk';

function UpdateBanner({ ctx }) {
  const [upd, setUpd] = React.useState(null);   // { name, code } once a newer build is found
  const [busy, setBusy] = React.useState(false); // one-shot: a tapped download must not spawn duplicates
  const busyRef = React.useRef(false);           // SYNCHRONOUS guard — state lags a render, so rapid taps fired several downloads at once
  React.useEffect(() => {
    const Cap = window.Capacitor, P = Cap && Cap.Plugins;
    const native = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
    if (!native || !(P && P.App && P.App.getInfo)) return;
    let alive = true;
    (async () => {
      try {
        const cur = await P.App.getInfo();                                  // { version, build }
        const installed = parseInt(cur && cur.build, 10) || 0;
        const res = await fetch(UPDATE_MANIFEST + '?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) return;
        const m = await res.json();
        const latest = parseInt(m && m.versionCode, 10) || 0;
        if (!alive || !latest || latest <= installed) return;               // already current
        let snoozed = 0; try { snoozed = parseInt(localStorage.getItem('trinityone.updateSnoozed') || '0', 10); } catch (e) {}
        if (latest > snoozed) setUpd({ name: m.versionName || '', code: latest });   // honour "Later" per version
      } catch (e) {}
    })();
    return () => { alive = false; };
  }, []);
  if (!upd) return null;
  const later = () => { try { localStorage.setItem('trinityone.updateSnoozed', String(upd.code)); } catch (e) {} setUpd(null); };
  const get = () => {
    if (busyRef.current) return;                       // ref blocks rapid double/triple taps instantly (state lags a render → multiple downloads)
    busyRef.current = true;
    setBusy(true);
    // cache-bust by version so a CDN (Cloudflare) can't hand back a stale APK → downgrade → "App not installed"
    const url = UPDATE_APK_URL + '?v=' + ((upd && upd.code) || Date.now());
    try { window.open(url, '_blank'); } catch (e) { try { location.href = url; } catch (e2) {} }
  };
  return (
    <div style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 10px)', left: 12, right: 12, zIndex: 70, margin: '0 auto', maxWidth: 460,
      background: 'var(--ink)', color: 'var(--paper)', borderRadius: 16, boxShadow: 'var(--shadow-lg)', padding: '12px 14px',
      display: 'flex', alignItems: 'center', gap: 12, animation: 'trinityFade .4s ease both' }}>
      <div style={{ width: 36, height: 36, borderRadius: 11, background: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name="arrowUp" size={19} color="#fff" /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Update available{upd.name ? ' · ' + upd.name : ''}</div>
        <div style={{ fontSize: 12, opacity: .8, lineHeight: 1.35 }}>A newer version of TrinityOne is ready to install.</div>
      </div>
      <button onClick={later} style={{ border: 'none', background: 'transparent', color: 'var(--paper)', opacity: .7, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '6px 4px', fontFamily: 'var(--font-ui)' }}>Later</button>
      <button onClick={get} disabled={busy} style={{ border: 'none', background: 'var(--clay)', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? .65 : 1, padding: '8px 14px', borderRadius: 11, fontFamily: 'var(--font-ui)' }}>{busy ? 'Downloading…' : 'Update'}</button>
    </div>
  );
}
window.UpdateBanner = UpdateBanner;
