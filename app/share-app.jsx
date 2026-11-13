// share-app.jsx — "pass it on": hand the TrinityOne app to someone nearby with no relay, link, or internet on
// THEIR side. The app shares its own APK through the OS share sheet (Quick Share / Bluetooth / Signal / Files).
// A Bible or commentary is shared SEPARATELY, one file at a time, from Library → Installed (InstalledBrowser in
// screens-library.jsx); the recipient installs the APK, then imports the module with Library → Import.
//
// EVERY SHARE IS ONE FILE. The app and a Bible used to go out together as one two-file share
// (ACTION_SEND_MULTIPLE, typed */*). Signal's multi-file path keeps only images and videos, so it was left with
// nothing and closed its share screen without a word — the member picked Signal and nothing was sent (read from
// Signal's source, not proved here). A single file goes as ACTION_SEND instead. Whether Signal then takes an .apk,
// a .zip or a .mybible is a DEVICE check, not something this code or its tests establish.
//
// THE TYPE THE OTHER APP SEES. On native it is NOT ours to choose: @capacitor/share (SharePlugin.java
// getMimeType) takes it from the file name's extension via Android's MimeTypeMap, and falls back to */* when
// that has no answer. So .apk → package-archive and .zip → application/zip, but a .mybible / .bbl.mybible file
// (no Android type for "mybible") and any name MimeTypeMap will not parse — e.g. one containing a space, as an
// imported file's name can — go out as */*. shareOneFile's `mime` is used on the WEB path only.
//
// v1 is pure JS (CapacitorHttp fetch + Filesystem + @capacitor/share, all already used). Module bytes come from
// the engine's own cache (window.Bible.exportModule); the import side persists via Bible's file input.

const SHAREAPP_APK_URL = 'https://app.trinityone.church/trinityone.apk';   // canonical member APK
const SHAREAPP_APK_FILE = 'TrinityOne.apk';

// chunked base64 — String.fromCharCode(...wholeArray) overflows the call stack on a 16MB APK.
function shareAppToBase64(u8) {
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}

// SHARE EXACTLY ONE FILE. Returns 'shared' | 'dismissed' | 'failed'.
//   opts: { bytes | uri, filename, mime, title, dialogTitle, onOpen }   — `mime` is used on web only (see the
//   header); `onOpen()` is called just before the share sheet itself is asked for (after any file write)
// Native: `bytes` are written to CACHE (the dir the app's FileProvider exposes) to get a uri; then ONE file goes
// to the share sheet — never text or url alongside it (passing text makes Quick Share / Bluetooth send only the
// text). Backing out of the sheet is not a failure: the plugin rejects "Share canceled" and that is 'dismissed',
// with no toast. Anything else that fails says "Couldn't share {name}" — the plugin's own text goes to the log,
// not in front of the member.
// A copy this function WROTE (from `bytes`; never a `uri` it was handed, so never the APK's cache-once copy) is
// deleted at once ONLY if the share FAILED — then nothing was handed a uri. A 'shared' OR a 'dismissed' copy is
// kept until the start of the NEXT module share: Quick Share and Bluetooth hand the file to a background transfer
// that reads it AFTER the share sheet has returned, and "Share canceled" does not prove nothing is reading it —
// the Android chooser reports it for a pick that opens an overlay, such as the Quick Share sheet. At most one such
// copy is therefore left in CACHE (and the OS may clear CACHE itself); the pointer is in memory, so a restart
// forgets it.
// ACCEPTED, NOT FIXED (audit of 9e6c3b5c, LOW 2): sharing module B deletes A's copy, so if a slow Bluetooth
// transfer of A is still running when B is shared, A's transfer can be cut short. Keeping every copy instead
// would pile them up on a low-storage phone; the member can share A again.
// Web / PWA: navigator.share with one File where the browser can, otherwise a download.
let shareAppLastCopy = null;   // CACHE path of the last module copy shared or dismissed (deleted at the next one)
async function shareOneFile(opts, ctx) {
  const o = opts || {};
  const Cap = window.Capacitor, P = Cap && Cap.Plugins;
  const native = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const toast = (m) => { try { ctx && ctx.toast && ctx.toast(m); } catch (e) {} };
  const name = o.title || o.filename || 'this file';

  if (!native) {
    if (!o.bytes) { toast('Couldn’t share ' + name); return 'failed'; }
    try {
      const file = new File([o.bytes], o.filename, { type: o.mime || 'application/octet-stream' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { try { o.onOpen && o.onOpen(); } catch (e) {} await navigator.share({ files: [file], title: name }); return 'shared'; }
        catch (e) { if (e && e.name === 'AbortError') return 'dismissed'; }
      }
    } catch (e) {}
    try {
      const href = URL.createObjectURL(new Blob([o.bytes], { type: o.mime || 'application/octet-stream' }));
      const a = document.createElement('a'); a.href = href; a.download = o.filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(href); } catch (e) {} }, 60000);
      toast('Downloading ' + o.filename + ' — share the file from your device');
      return 'shared';
    } catch (e) { toast('Couldn’t share ' + name); return 'failed'; }
  }

  if (!(P && P.Share && P.Filesystem)) { toast('Sharing isn’t available on this device'); return 'failed'; }
  let uri = o.uri || null;
  let wrote = null;
  const drop = (path) => { try { Promise.resolve(P.Filesystem.deleteFile({ path, directory: 'CACHE' })).catch(() => {}); } catch (e) {} };
  if (!uri) {
    if (shareAppLastCopy && shareAppLastCopy !== o.filename) drop(shareAppLastCopy);
    shareAppLastCopy = null;
    try {
      const w = await P.Filesystem.writeFile({ path: o.filename, data: shareAppToBase64(o.bytes), directory: 'CACHE' });
      uri = w && w.uri;
      if (uri) wrote = o.filename;
    } catch (e) { uri = null; }
    if (!uri) { toast('Couldn’t get ' + name + ' ready to share — is the phone full?'); return 'failed'; }
  }
  let result;
  try {
    try { o.onOpen && o.onOpen(); } catch (e) {}
    await P.Share.share({ title: name, files: [uri], dialogTitle: o.dialogTitle || ('Share ' + name) });
    result = 'shared';
  } catch (e) {
    const msg = String((e && (e.message || e.errorMessage)) || e || '');
    if (/share cancel+ed/i.test(msg)) result = 'dismissed';
    else {
      try { console.warn('shareOneFile: ' + (o.filename || name) + ' — ' + msg); } catch (e2) {}
      toast('Couldn’t share ' + name);
      result = 'failed';
    }
  }
  // Accepted (audit N2): re-sharing the SAME module after a dismiss, and having that attempt fail, deletes the copy
  // the first (Quick Share overlay) attempt may still be reading — the write overwrote it under the same name.
  if (wrote) { if (result === 'failed') drop(wrote); else shareAppLastCopy = wrote; }
  return result;
}
window.shareOneFile = shareOneFile;

// WHICH INSTALLED MODULES ARE OFFERED A SHARE: ONLY WHAT THE RECIPIENT CAN IMPORT. An allowlist — anything not
// named here is false. The recipient's import is the engine's loadModuleBytes (via Library → Import), which takes
// a MySword SQLite DB, a zip of one or of USFM books, a USFM file, or a cross-reference JSON.
//   · a catalogue Bible or commentary (.zip / .mybible / .cmt.mybible.zip) — imports on every pilot build;
//   · a record under imported/ — it exists only because the same import accepted that very file once
//     (ensureInput records it after loadModuleBytes returned). Bibles, commentaries and dictionaries only.
// NOT offered: JSON dictionaries / word definitions / original-language data (the import refuses them), cross-
// references (only builds from 2026-11-03 import them — owner: not in v1), devotionals (no module bytes), and a
// record with no or an unknown category.
function isShareableModule(r) {
  if (!r || typeof r.url !== 'string' || !r.url) return false;
  const cat = r.category;
  if (r.url.indexOf('imported/') === 0) return cat === 'bibles' || cat === 'commentaries' || cat === 'dictionaries';
  if (/\.json$/i.test(r.url)) return false;
  return cat === 'bibles' || cat === 'commentaries';
}
window.isShareableModule = isShareableModule;

// AN iPHONE CANNOT INSTALL WHAT THIS SHARES. The file is the Android APK and iOS has no way to install an app
// from a file, so on iOS the app-share is not offered at all (identity.jsx hides the row, ShareAppSheet renders
// nothing) and this refuses as a last guard. Owner: that includes an iPhone or iPad in Safari or on the Home
// Screen, where Capacitor says 'web'. So:
//   · the iOS app: getPlatform() === 'ios' (isNativePlatform() is true on iOS AND Android, so ask by name);
//   · iOS web: "iPhone" / "iPad" / "iPod" in the user agent or navigator.platform;
//   · iPadOS 13+, which by default reports itself as a Mac ("Macintosh" UA, platform "MacIntel"): a Mac with a
//     touch screen of more than one point. A real Mac reports maxTouchPoints 0, so a Mac desktop still sees it.
function shareAppOnIos() {
  try {
    const Cap = window.Capacitor;
    const p = Cap && Cap.getPlatform ? Cap.getPlatform() : '';
    if (p === 'ios') return true;
    // THE ANDROID APP IS NEVER iOS, whatever its user agent says: the WebView's UA carries the device model, and an
    // Android tablet such as Chuwi's "HiPad X" contains "iPad" (audit of a7d5f406, N1).
    if (p === 'android') return false;
    const nav = (typeof navigator !== 'undefined' && navigator) || window.navigator || {};
    const ua = String(nav.userAgent || ''), plat = String(nav.platform || '');
    // Whole words only, so "HiPad" in an Android browser's UA is not an iPad.
    if (/\b(iPhone|iPad|iPod)\b/.test(ua) || /^(iPhone|iPad|iPod)/.test(plat)) return true;
    // Accepted (audit N4, unverified): an Android browser in "desktop site" mode that reported MacIntel with touch
    // points would be taken for an iPad here and lose the row — web only; Chrome reports Linux.
    if (plat === 'MacIntel' && Number(nav.maxTouchPoints || 0) > 1) return true;
    return false;
  } catch (e) { return false; }
}
window.shareAppOnIos = shareAppOnIos;

// Share the APK (cache-once), alone, via the OS share sheet.
async function shareTrinityOneApp(ctx, onStatus) {
  const Cap = window.Capacitor, P = Cap && Cap.Plugins;
  const native = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const say = (m) => { try { onStatus && onStatus(m); } catch (e) {} };
  if (shareAppOnIos()) { ctx && ctx.toast && ctx.toast('The app can’t be passed on from an iPhone — share a Bible from your Library instead'); return { ok: false, where: 'ios' }; }

  // web / installed PWA: a download is the on-device equivalent
  if (!native) {
    try { const a = document.createElement('a'); a.href = SHAREAPP_APK_URL; a.download = SHAREAPP_APK_FILE; document.body.appendChild(a); a.click(); a.remove(); } catch (e) {}
    ctx && ctx.toast && ctx.toast('Downloading the app — share the file from your device');
    return { ok: true, where: 'download' };
  }
  if (!(P && P.Share && P.Filesystem)) { ctx && ctx.toast && ctx.toast('Sharing isn’t available on this device'); return { ok: false }; }

  // the APK — cache-once in CACHE (the dir the app's FileProvider exposes), then re-share offline
  let apkUri = null;
  try {
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
  } catch (e) {
    say('');
    ctx && ctx.toast && ctx.toast('Couldn’t prepare the share — connect to the internet once, then try again');
    return { ok: false, error: String((e && e.message) || e) };
  }
  say('');
  const r = await shareOneFile({ uri: apkUri, filename: SHAREAPP_APK_FILE, mime: 'application/vnd.android.package-archive',
    title: 'TrinityOne', dialogTitle: 'Share the TrinityOne app' }, ctx);
  return { ok: r !== 'failed', where: r };
}
window.shareTrinityOneApp = shareTrinityOneApp;

function ShareAppSheet({ open, onClose, ctx }) {
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  // is there a BIBLE on this phone that can be passed on separately? The pointer opens Library → Installed scoped
  // to Bibles, so a shareable commentary or dictionary alone would land the member on a list with no Share.
  const hasModule = React.useMemo(() => {
    try { const m = (window.Bible && window.Bible.installedMap && window.Bible.installedMap()) || {}; return Object.values(m).some(r => isShareableModule(r) && r.category === 'bibles'); } catch (e) { return false; }
  }, [open]);
  const go = async () => { if (busy) return; setBusy(true); try { await shareTrinityOneApp(ctx, setStatus); } finally { setBusy(false); setStatus(''); } };
  const toLibrary = () => { onClose && onClose(); ctx && ctx.openStore && ctx.openStore('installed', 'bibles'); };
  if (shareAppOnIos()) return null;   // nothing here an iPhone can use — the "Choose a Bible" pointer goes with it
  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="82%" z={60}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700 }}>Share the app</div>
        <IconBtn name="x" onClick={onClose} />
      </div>
      <p style={{ fontFamily: 'var(--font-read)', fontSize: 15.5, lineHeight: 1.55, color: 'var(--ink-2)', margin: '4px 0 16px', textWrap: 'pretty' }}>
        Pass TrinityOne to someone next to you — over <b>Quick Share</b> or <b>Bluetooth</b>. No link, no app store, no internet on their phone.</p>

      {native && hasModule ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.45 }}>
          <div style={{ flex: 1, minWidth: 0 }}>Want them to have a Bible too? Send it separately from your Library.</div>
          <button onClick={toLibrary} style={{ flexShrink: 0, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--clay)', borderRadius: 11, padding: '8px 12px', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5 }}>Choose a Bible</button>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 11, padding: '12px 14px', borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--line)', marginBottom: 16, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
        <Icon name="shield" size={18} color="var(--sage)" /><div>They may need to allow “install from unknown sources” the first time — normal for an app passed hand to hand. A Bible you send them separately goes in with <b>Library → Import</b>.</div>
      </div>
      <button onClick={go} disabled={busy} style={{ width: '100%', padding: 15, borderRadius: 15, border: 'none', background: 'var(--sage)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: busy ? 'default' : 'pointer', fontFamily: 'var(--font-ui)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: busy ? 0.75 : 1 }}>
        <Icon name="share" size={17} color="#fff" /> {busy ? (status || 'Preparing…') : 'Share the app'}</button>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center', marginTop: 10, lineHeight: 1.45 }}>The first share downloads the app to your phone once; after that it works offline.</p>
    </BottomSheet>
  );
}
window.ShareAppSheet = ShareAppSheet;
