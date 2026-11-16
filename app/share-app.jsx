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
//   opts: { bytes | uri, filename, mime, title, dialogTitle, onOpen, text }   — `mime` is used on web only (see
//   the header); `onOpen()` is called just before the share sheet itself is asked for (after any file write)
// `text` (optional, added 2026-11-16 for the verse card): words to go WITH the file. Without it — the APK and
// module shares — nothing below changes: the share carries the file alone, for the reason in the next paragraph.
// With it, native passes `text` to @capacitor/share (6.0.4 SharePlugin.java: one file + text and no url is ONE
// ACTION_SEND with EXTRA_TEXT and EXTRA_STREAM, its type taken from the file — shareFiles() sets it after the
// text/plain), and web passes it to navigator.share beside the file. A caller passing text accepts that Quick
// Share / Bluetooth may then send only the text. Never pass a url here: a link brings back the link preview.
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
      const withText = typeof o.text === 'string' && o.text !== '';
      if (navigator.canShare && navigator.canShare(withText ? { files: [file], text: o.text } : { files: [file] })) {
        try { try { o.onOpen && o.onOpen(); } catch (e) {} await navigator.share(withText ? { files: [file], title: name, text: o.text } : { files: [file], title: name }); return 'shared'; }
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
    const args = { title: name, files: [uri], dialogTitle: o.dialogTitle || ('Share ' + name) };
    if (typeof o.text === 'string' && o.text !== '') args.text = o.text;
    await P.Share.share(args);
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

// ── the "Share as image" card ──
// Moved here from app/app.jsx (2026-11-16) so a test can draw the real component; this file loads before
// app.jsx in index.html, and nothing else references ShareCard or CARD_STYLES. verseShareText / verseShareUrl
// are app.jsx globals, read only when a button is pressed (after every script has loaded).
// Header top: env(safe-area-inset-top) + 8px like the other overlays. It was + 50px, which on Android (where the
// WebView already sits below the status bar, inset 0) left a 50px empty band above the header.
// ── THE CARD AS A PICTURE (2026-11-16) ──
// "Share as image" used to send text plus a /v link, and the messenger then showed the WEBSITE's link preview
// (the /v page's og:image), not the card. Now the card is drawn on a canvas and the PNG is shared as ONE file
// through shareOneFile, with the verse words beside it (owner: image + words, NO link — the link is what
// brings the website preview back; accepted that Quick Share / Bluetooth may then drop the image).
// Fixed 1080 x 1350 (4:5) whatever the phone's width. Text that is too long steps the font down from 64px to
// 36px and, past that, ends in an ellipsis (fitting long passages properly is the next fix).
const SHARECARD_W = 1080, SHARECARD_H = 1350;
const SHARECARD_SPARKLE = ['M12 3.5c.7 4 1.8 5.1 5.8 5.8-4 .7-5.1 1.8-5.8 5.8-.7-4-1.8-5.1-5.8-5.8 4-.7 5.1-1.8 5.8-5.8Z',
  'M18.5 14.5c.3 1.7.8 2.2 2.5 2.5-1.7.3-2.2.8-2.5 2.5-.3-1.7-.8-2.2-2.5-2.5 1.7-.3 2.2-.8 2.5-2.5Z'];

// A card colour as the canvas can use it. `var(--x)` is resolved by a probe <span> inside `probe` (the card on
// screen; <body> if there is none), so a church's own accent — set on the app's root element, not on <html> —
// is the colour drawn.
// Whatever comes back is put through the canvas's own parser; anything it refuses gives `fallback`.
function shareCardColor(cx, value, fallback, probe) {
  let v = value;
  const host = probe || (typeof document !== 'undefined' && document.body);
  try {
    if (/^var\(--[\w-]+\)$/.test(v) && host && host.appendChild && typeof getComputedStyle === 'function') {
      // with the fallback inside var(), an undefined property gives the fallback, not the inherited text colour
      const sp = document.createElement('span'); sp.style.color = v.slice(0, -1) + ', ' + fallback + ')'; host.appendChild(sp);
      const c = getComputedStyle(sp).color; try { sp.remove(); } catch (e) {}
      if (c) v = c;
    }
  } catch (e) {}
  try { cx.fillStyle = '#010203'; cx.fillStyle = v; const got = cx.fillStyle; if (got && got !== '#010203') return got; } catch (e) {}
  return fallback;
}

// Words into lines no wider than `max`, measured by the canvas at its current font. A single word wider than
// the line is broken by characters.
function shareCardWrap(cx, text, max) {
  const lines = []; let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const tryLine = line ? line + ' ' + word : word;
    if (cx.measureText(tryLine).width <= max) { line = tryLine; continue; }
    if (line) lines.push(line);
    if (cx.measureText(word).width <= max) { line = word; continue; }
    line = '';
    for (const ch of word) { if (cx.measureText(line + ch).width > max && line) { lines.push(line); line = ch; } else line += ch; }
  }
  if (line) lines.push(line);
  return lines;
}

// Wait (briefly) for the card's fonts, so the canvas does not draw in the fallback serif.
async function shareCardFonts() {
  try {
    const f = document.fonts; if (!f || !f.load) return;
    const all = Promise.all(['500 64px Newsreader', '700 32px Sora'].map(x => Promise.resolve(f.load(x)).catch(() => null)));
    await Promise.race([all, new Promise(r => setTimeout(r, 2500))]);
  } catch (e) {}
}

// Draw the card for `verse` in style `st` (a CARD_STYLES entry) and return its PNG bytes. Throws if the canvas
// cannot produce one.
async function shareCardPng(verse, st, probe) {
  await shareCardFonts();
  const W = SHARECARD_W, H = SHARECARD_H, PAD = 104;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d');
  if (!cx) throw new Error('no 2d canvas');
  const k = st.cv;
  const col = (pair) => shareCardColor(cx, pair[0], pair[1], probe);
  const fg = col(k.fg), mark = col(k.mark), refCol = col(k.ref);
  if (k.to) {
    // 155deg, as the CSS card: from the top-left-ish corner to the bottom-right-ish one
    const a = (155 - 90) * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
    const half = (Math.abs(W * dx) + Math.abs(H * dy)) / 2;
    const g = cx.createLinearGradient(W / 2 - dx * half, H / 2 - dy * half, W / 2 + dx * half, H / 2 + dy * half);
    g.addColorStop(0, col(k.from)); g.addColorStop(1, col(k.to));
    cx.fillStyle = g;
  } else cx.fillStyle = col(k.from);
  cx.fillRect(0, 0, W, H);
  if (k.border) { cx.strokeStyle = col(k.border); cx.lineWidth = 4; cx.strokeRect(2, 2, W - 4, H - 4); }
  const sparkle = (x, y, size, color, alpha, lw) => {
    if (typeof Path2D !== 'function') return;
    cx.save(); cx.globalAlpha = alpha; cx.translate(x, y); cx.scale(size / 24, size / 24);
    cx.strokeStyle = color; cx.lineWidth = lw; cx.lineCap = 'round'; cx.lineJoin = 'round';
    for (const d of SHARECARD_SPARKLE) cx.stroke(new Path2D(d));
    cx.restore();
  };
  sparkle(W - 360, -64, 420, fg, k.border ? 0.06 : 0.14, 1.3);

  // the words: the largest size from 64px down to 36px whose lines fit, else 36px ending in an ellipsis
  const quote = '\u201C' + String(verse.text || '').trim() + '\u201D';
  const ref = String(verse.ref || '').trim() + ' \u00B7 ' + (verse.version || 'WEB');
  const MARK = 84, GAP1 = 56, GAP2 = 60, REF = 44;
  const room = H - 2 * PAD - MARK - GAP1 - GAP2 - REF - 60;
  let size = 64, lines = [];
  for (; size >= 36; size -= 4) {
    cx.font = '500 ' + size + 'px Newsreader, Georgia, serif';
    lines = shareCardWrap(cx, quote, W - 2 * PAD);
    if (lines.length * size * 1.4 <= room) break;
  }
  if (size < 36) {
    size = 36; cx.font = '500 36px Newsreader, Georgia, serif';
    lines = shareCardWrap(cx, quote, W - 2 * PAD);
    const fit = Math.max(1, Math.floor(room / (size * 1.4)));
    if (lines.length > fit) {
      lines = lines.slice(0, fit);
      let last = lines[fit - 1];
      while (last && cx.measureText(last + '\u2026').width > W - 2 * PAD) last = last.slice(0, -1);
      lines[fit - 1] = last.replace(/\s+$/, '') + '\u2026';
    }
  }
  const lh = size * 1.4;
  const block = MARK + GAP1 + lines.length * lh + GAP2 + REF;
  let y = Math.max(PAD, (H - block) / 2);
  sparkle(PAD, y, MARK, mark, 1, 1.8);
  y += MARK + GAP1;
  cx.fillStyle = fg; cx.textBaseline = 'top'; cx.textAlign = 'left';
  for (const ln of lines) { cx.fillText(ln, PAD, y + (lh - size) / 2); y += lh; }
  y += GAP2;
  cx.font = '700 44px Sora, system-ui, sans-serif'; cx.fillStyle = refCol;
  cx.globalAlpha = k.border ? 1 : 0.9; cx.fillText(ref, PAD, y); cx.globalAlpha = 1;
  cx.font = '700 34px Sora, system-ui, sans-serif'; cx.fillStyle = fg; cx.globalAlpha = 0.5; cx.textAlign = 'right';
  cx.fillText('TRINITYONE', W - 70, H - 70 - 34); cx.globalAlpha = 1;

  const blob = await new Promise((res) => { try { cv.toBlob(res, 'image/png'); } catch (e) { res(null); } });
  if (!blob) throw new Error('the canvas made no PNG');
  return new Uint8Array(await blob.arrayBuffer());
}

// THE SHARE BUTTON: the card as a PNG plus the verse words (verseShareText, app/app.jsx — words and reference,
// no link). If the picture cannot be made, the words alone go, still with no link, and the member is told.
async function shareCardShare(verse, st, probe, ctx) {
  const text = verseShareText(verse);
  let bytes = null;
  try { bytes = await shareCardPng(verse, st, probe); }
  catch (e) { try { console.warn('shareCardPng: ' + ((e && e.message) || e)); } catch (e2) {} }
  if (!bytes) {
    try { ctx.toast && ctx.toast('Couldn\'t make the picture \u2014 sharing the words'); } catch (e) {}
    return ctx.shareText(text, 'A verse for you');
  }
  return window.shareOneFile({ bytes, filename: 'TrinityOne-verse.png', mime: 'image/png', title: 'Verse card', dialogTitle: 'Share this verse', text }, ctx);
}

// `cv`: the same look for the canvas — [colour, fallback] pairs; a var(--x) is resolved on the card on screen.
const CARD_STYLES = [
  { id: 'clay', bg: 'linear-gradient(155deg, var(--clay), var(--clay-deep))', fg: '#fff', serif: true,
    cv: { from: ['var(--clay)', '#C25A38'], to: ['var(--clay-deep)', '#9C4327'], fg: ['#fff', '#fff'], mark: ['#fff', '#fff'], ref: ['#fff', '#fff'] } },
  { id: 'sage', bg: 'linear-gradient(155deg, #6BA17C, #3C6E57)', fg: '#fff', serif: true,
    cv: { from: ['#6BA17C', '#6BA17C'], to: ['#3C6E57', '#3C6E57'], fg: ['#fff', '#fff'], mark: ['var(--clay)', '#C25A38'], ref: ['#fff', '#fff'] } },
  { id: 'paper', bg: 'var(--surface)', fg: 'var(--ink)', serif: true, bordered: true,
    cv: { from: ['var(--surface)', '#FFFDF8'], fg: ['var(--ink)', '#221C16'], mark: ['var(--clay)', '#C25A38'], ref: ['var(--clay)', '#C25A38'], border: ['var(--line)', 'rgba(34,28,22,0.10)'] } },
  { id: 'night', bg: 'linear-gradient(155deg, #2a2218, #16120c)', fg: '#F3ECDC', serif: true,
    cv: { from: ['#2a2218', '#2a2218'], to: ['#16120c', '#16120c'], fg: ['#F3ECDC', '#F3ECDC'], mark: ['var(--clay)', '#C25A38'], ref: ['#F3ECDC', '#F3ECDC'] } },
];
function ShareCard({ verse, open, onClose, ctx }) {
  const [style, setStyle] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const cardRef = React.useRef(null);
  React.useEffect(() => { if (open) setStyle(0); }, [open]);
  if (!verse) return null;
  const s = CARD_STYLES[style];
  const share = async () => {
    if (busy) return;
    setBusy(true);
    try { await shareCardShare(verse, s, cardRef.current, ctx); } finally { setBusy(false); }
  };
  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)', display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px' }}>
          <IconBtn name="chevL" onClick={onClose} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17 }}>Share verse</span>
          {/* Both share buttons send the card as a picture plus the verse words, and no link (shareCardShare). */}
          <IconBtn name="share" title="Share this verse" onClick={share} />
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 26px' }}>
          <div ref={cardRef} style={{
            width: '100%', aspectRatio: '4/5', borderRadius: 26, background: s.bg, color: s.fg,
            border: s.bordered ? '1px solid var(--line)' : 'none', boxShadow: 'var(--shadow-lg)',
            display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 30, position: 'relative', overflow: 'hidden',
            transition: 'background .3s',
          }}>
            <div style={{ position: 'absolute', right: -20, top: -20, opacity: s.bordered ? .06 : .14 }}>
              <Icon name="sparkle" size={130} stroke={1.3} color={s.fg} /></div>
            <Icon name="sparkle" size={26} stroke={1.8} color={s.id === 'clay' ? '#fff' : 'var(--clay)'} />
            <p style={{ fontFamily: s.serif ? 'var(--font-read)' : 'var(--font-ui)', fontSize: 25, lineHeight: 1.4,
              fontWeight: 500, margin: '18px 0 20px', textWrap: 'pretty' }}>“{verse.text}”</p>
            <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 14, letterSpacing: '.5px',
              color: s.bordered ? 'var(--clay)' : s.fg, opacity: s.bordered ? 1 : .9 }}>{verse.ref} · {verse.version || 'WEB'}</div>
            <div style={{ position: 'absolute', bottom: 16, right: 22, fontSize: 11, fontWeight: 700, letterSpacing: '1px', opacity: .5 }}>TRINITYONE</div>
          </div>
        </div>
        <div style={{ padding: '4px 26px 8px' }}>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 18 }}>
            {CARD_STYLES.map((c, i) => (
              <button key={c.id} onClick={() => setStyle(i)} style={{
                width: 46, height: 46, borderRadius: 14, background: c.bg, cursor: 'pointer',
                border: style === i ? '2.5px solid var(--clay)' : '1px solid var(--line)', flexShrink: 0,
              }} />
            ))}
          </div>
          <button onClick={share} disabled={busy} style={{
            width: '100%', padding: 15, borderRadius: 16, border: 'none', background: 'var(--clay)', color: 'var(--on-clay)',
            fontWeight: 700, fontSize: 15.5, cursor: 'pointer', fontFamily: 'var(--font-ui)', marginBottom: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}><Icon name="share" size={18} color="#fff" /> {busy ? 'Preparing\u2026' : 'Share this verse'}</button>
        </div>
      </div>
    </Overlay>
  );
}
