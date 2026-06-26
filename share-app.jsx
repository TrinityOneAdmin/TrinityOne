// share-app.jsx — "pass it on": hand the TrinityOne app to someone nearby with no relay, link, or
// internet on THEIR side. The app shares its own APK through the OS share sheet (Quick Share /
// Bluetooth / Files); the recipient taps the file to install. The sender fetches + caches the APK
// once (then it shares offline thereafter) — the resilience story at the device level.
//
// v1 is pure JS (CapacitorHttp fetch + Filesystem + @capacitor/share — all already used elsewhere).
// A future v2 could add a tiny native plugin to share the ALREADY-INSTALLED APK with zero pre-fetch
// (true offline-first), once there's a committed-plugin path + on-device testing.

// canonical member APK — served by every TrinityOne gateway and the church domain.
// TODO(post-pilot): derive from the active church's own domain for self-hosting churches.
const SHAREAPP_APK_URL = 'https://app.trinityone.church/trinityone.apk';
const SHAREAPP_APK_FILE = 'TrinityOne.apk';

// chunked base64 — String.fromCharCode(...wholeArray) overflows the call stack on a 16MB APK.
function shareAppToBase64(u8) {
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}

// Fetch (cache-once) the APK and offer it to the OS share sheet. onStatus(msg) drives the button label.
async function shareTrinityOneApp(ctx, onStatus) {
  const Cap = window.Capacitor, P = Cap && Cap.Plugins;
  const native = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const say = (m) => { try { onStatus && onStatus(m); } catch (e) {} };

  // web / installed PWA: a download is the on-device equivalent — they then pass the file on themselves
  if (!native) {
    try { const a = document.createElement('a'); a.href = SHAREAPP_APK_URL; a.download = SHAREAPP_APK_FILE; document.body.appendChild(a); a.click(); a.remove(); } catch (e) {}
    ctx && ctx.toast && ctx.toast('Downloading the app — share the file from your device');
    return { ok: true, where: 'download' };
  }
  if (!(P && P.Share && P.Filesystem)) { ctx && ctx.toast && ctx.toast('Sharing isn’t available on this device'); return { ok: false }; }

  try {
    // reuse a cached copy if present → works offline after the first time
    let uri = null;
    try { const st = await P.Filesystem.stat({ path: SHAREAPP_APK_FILE, directory: 'DATA' }); if (st && st.size > 1000000) uri = st.uri; } catch (e) {}
    if (!uri) {
      say('Preparing… (one-time, needs internet)');
      const res = await fetch(SHAREAPP_APK_URL);                 // CapacitorHttp makes this cross-origin fetch work
      if (!res.ok) throw new Error('download failed (' + res.status + ')');
      const u8 = new Uint8Array(await res.arrayBuffer());
      if (u8.length < 1000000) throw new Error('the downloaded file looks wrong');
      say('Almost ready…');
      const w = await P.Filesystem.writeFile({ path: SHAREAPP_APK_FILE, data: shareAppToBase64(u8), directory: 'DATA' });
      uri = w.uri;
    }
    say('');
    await P.Share.share({ title: 'TrinityOne', text: 'Here’s the TrinityOne app — install it and read Scripture. No account, no sign-up.', files: [uri], dialogTitle: 'Share the TrinityOne app' });
    return { ok: true, where: 'shared' };
  } catch (e) {
    say('');
    ctx && ctx.toast && ctx.toast('Couldn’t prepare the app — connect to the internet once, then try again');
    return { ok: false, error: String((e && e.message) || e) };
  }
}
window.shareTrinityOneApp = shareTrinityOneApp;

function ShareAppSheet({ open, onClose, ctx }) {
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const go = async () => { if (busy) return; setBusy(true); try { await shareTrinityOneApp(ctx, setStatus); } finally { setBusy(false); setStatus(''); } };
  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="74%" z={60}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700 }}>Share the app</div>
        <IconBtn name="x" onClick={onClose} />
      </div>
      <p style={{ fontFamily: 'var(--font-read)', fontSize: 15.5, lineHeight: 1.55, color: 'var(--ink-2)', margin: '4px 0 14px', textWrap: 'pretty' }}>
        Pass TrinityOne to someone next to you — over <b>Quick Share</b> or <b>Bluetooth</b>. No link, no app store, no internet needed on their phone. They tap the file to install, and they’re reading Scripture in seconds.</p>
      <div style={{ display: 'flex', gap: 11, padding: '12px 14px', borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--line)', marginBottom: 16, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
        <Icon name="shield" size={18} color="var(--sage)" /><div>They may need to allow “install from unknown sources” the first time — that’s normal for an app passed hand to hand.</div>
      </div>
      <button onClick={go} disabled={busy} style={{ width: '100%', padding: 15, borderRadius: 15, border: 'none', background: 'var(--sage)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: busy ? 'default' : 'pointer', fontFamily: 'var(--font-ui)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: busy ? 0.75 : 1 }}>
        <Icon name="share" size={17} color="#fff" /> {busy ? (status || 'Preparing…') : 'Share the app'}</button>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center', marginTop: 10, lineHeight: 1.45 }}>The first share downloads the app to your phone once; after that it works offline.</p>
    </BottomSheet>
  );
}
window.ShareAppSheet = ShareAppSheet;
