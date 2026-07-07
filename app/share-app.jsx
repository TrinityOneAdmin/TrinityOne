// share-app.jsx — "pass it on": hand the TrinityOne app (and optionally a Bible in the right language)
// to someone nearby with no relay, link, or internet on THEIR side. The app shares its own APK — and a
// Bible the sender picks — through the OS share sheet (Quick Share / Bluetooth / Files). The recipient
// installs the APK, then imports the Bible (Library → Import), and reads Scripture fully offline.
//
// v1 is pure JS (CapacitorHttp fetch + Filesystem + @capacitor/share, all already used). Bible bytes come
// from the engine's own cache (window.Bible.exportModule); the import side persists via Bible's file input.

const SHAREAPP_APK_URL = 'https://app.trinityone.church/trinityone.apk';   // canonical member APK
const SHAREAPP_APK_FILE = 'TrinityOne.apk';

// chunked base64 — String.fromCharCode(...wholeArray) overflows the call stack on a 16MB APK.
function shareAppToBase64(u8) {
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}

// Share the APK (cache-once) + optionally a chosen Bible module, files-only, via the OS share sheet.
async function shareTrinityOneApp(ctx, onStatus, bibleUrl) {
  const Cap = window.Capacitor, P = Cap && Cap.Plugins;
  const native = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const say = (m) => { try { onStatus && onStatus(m); } catch (e) {} };

  // web / installed PWA: a download is the on-device equivalent
  if (!native) {
    try { const a = document.createElement('a'); a.href = SHAREAPP_APK_URL; a.download = SHAREAPP_APK_FILE; document.body.appendChild(a); a.click(); a.remove(); } catch (e) {}
    ctx && ctx.toast && ctx.toast('Downloading the app — share the file from your device');
    return { ok: true, where: 'download' };
  }
  if (!(P && P.Share && P.Filesystem)) { ctx && ctx.toast && ctx.toast('Sharing isn’t available on this device'); return { ok: false }; }

  try {
    const files = [];
    // 1) the APK — cache-once in CACHE (the dir the app's FileProvider exposes), then re-share offline
    let apkUri = null;
    try { const st = await P.Filesystem.stat({ path: SHAREAPP_APK_FILE, directory: 'CACHE' }); if (st && st.size > 1000000) apkUri = st.uri; } catch (e) {}
    if (!apkUri) {
      say('Preparing the app…');
      const res = await fetch(SHAREAPP_APK_URL);                 // CapacitorHttp makes this cross-origin fetch work
      if (!res.ok) throw new Error('download failed (' + res.status + ')');
      const u8 = new Uint8Array(await res.arrayBuffer());
      if (u8.length < 1000000) throw new Error('the downloaded file looks wrong');
      const w = await P.Filesystem.writeFile({ path: SHAREAPP_APK_FILE, data: shareAppToBase64(u8), directory: 'CACHE' });
      apkUri = w.uri;
    }
    files.push(apkUri);

    // 2) optionally a Bible the sender chose — so the recipient reads in their language, offline
    if (bibleUrl && window.Bible && window.Bible.exportModule) {
      say('Adding the Bible…');
      try {
        const ex = await window.Bible.exportModule(bibleUrl);
        if (ex && ex.bytes && ex.bytes.length) {
          const wb = await P.Filesystem.writeFile({ path: ex.filename, data: shareAppToBase64(ex.bytes), directory: 'CACHE' });
          files.push(wb.uri);
        }
      } catch (e) { /* couldn't export the Bible — still share the app */ }
    }

    say('');
    // FILES ONLY — passing text/url alongside makes Quick Share / Bluetooth send only the text, dropping the files.
    await P.Share.share({ title: 'TrinityOne', files, dialogTitle: 'Share the TrinityOne app' });
    return { ok: true, where: 'shared' };
  } catch (e) {
    say('');
    ctx && ctx.toast && ctx.toast('Couldn’t prepare the share — connect to the internet once, then try again');
    return { ok: false, error: String((e && e.message) || e) };
  }
}
window.shareTrinityOneApp = shareTrinityOneApp;

function ShareAppSheet({ open, onClose, ctx }) {
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const [bibleUrl, setBibleUrl] = React.useState('');
  const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  // the sender's installed Bibles — so they can include the right language (never forced to English)
  const bibles = React.useMemo(() => {
    try { const m = (window.Bible && window.Bible.installedMap && window.Bible.installedMap()) || {}; return Object.values(m).filter(x => x && (x.category === 'bibles' || x.kind === 'bible')); } catch (e) { return []; }
  }, [open]);
  const go = async () => { if (busy) return; setBusy(true); try { await shareTrinityOneApp(ctx, setStatus, bibleUrl); } finally { setBusy(false); setStatus(''); } };
  const lbl = { display: 'block', fontSize: 11.5, fontWeight: 800, letterSpacing: '.5px', color: 'var(--ink-3)', margin: '0 2px 7px' };
  const sel = { width: '100%', height: 48, borderRadius: 13, border: '1px solid var(--line)', background: 'var(--surface)', padding: '0 14px', fontSize: 15, fontFamily: 'var(--font-ui)', color: 'var(--ink)', outline: 'none' };
  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="82%" z={60}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700 }}>Share the app</div>
        <IconBtn name="x" onClick={onClose} />
      </div>
      <p style={{ fontFamily: 'var(--font-read)', fontSize: 15.5, lineHeight: 1.55, color: 'var(--ink-2)', margin: '4px 0 16px', textWrap: 'pretty' }}>
        Pass TrinityOne to someone next to you — over <b>Quick Share</b> or <b>Bluetooth</b>. No link, no app store, no internet on their phone.</p>

      {native && bibles.length ? (
        <div style={{ marginBottom: 16 }}>
          <label style={lbl}>SEND A BIBLE TOO — SO THEY CAN READ OFFLINE</label>
          <select value={bibleUrl} onChange={e => setBibleUrl(e.target.value)} style={sel}>
            <option value="">Just the app — no Bible</option>
            {bibles.map(b => <option key={b.url} value={b.url}>{b.name || b.abbr}</option>)}
          </select>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.45 }}>Pick the language they read — they’ll get Scripture without ever needing the internet.</div>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 11, padding: '12px 14px', borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--line)', marginBottom: 16, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
        <Icon name="shield" size={18} color="var(--sage)" /><div>They may need to allow “install from unknown sources” the first time, then open <b>Library → Import</b> to add the Bible — both normal for an app passed hand to hand.</div>
      </div>
      <button onClick={go} disabled={busy} style={{ width: '100%', padding: 15, borderRadius: 15, border: 'none', background: 'var(--sage)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: busy ? 'default' : 'pointer', fontFamily: 'var(--font-ui)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: busy ? 0.75 : 1 }}>
        <Icon name="share" size={17} color="#fff" /> {busy ? (status || 'Preparing…') : (bibleUrl ? 'Share app + Bible' : 'Share the app')}</button>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center', marginTop: 10, lineHeight: 1.45 }}>The first share downloads the app to your phone once; after that it works offline.</p>
    </BottomSheet>
  );
}
window.ShareAppSheet = ShareAppSheet;
