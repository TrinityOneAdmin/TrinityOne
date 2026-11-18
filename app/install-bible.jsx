// install-bible.jsx — "Install a Bible from a file": the sheet that answers a file arriving, and the handler for a
// file another app hands us ("Open with TrinityOne", Android).
//
// THE ENGINE DOES THE WORK. Bible.installFromBytes (engine.js) takes the bytes and answers a plain
// {ok, kind, abbr, name, already?, renamed?} / {ok:false, reason}. Everything that could hurt a phone — the size
// caps, the view/trigger refusal, "never replace an installed module" — is there. This file is only words and the
// one thing the engine cannot know: where the bytes came from.
//
// TWO WAYS IN, ONE SHEET.
//   · The member chose a file (Library button, first-run link, reader "Install a Bible from a file", a catalogue
//     import row): Bible.pickFile → the engine announces {phase:'installing'} then {phase:'result'} through
//     Bible.onFileInstall, and app.jsx puts both on this sheet. No confirm step: they just picked it.
//   · ANOTHER APP sent a file (a content:// URL from the Android intent filter). That is untrusted and nobody
//     asked for it, so NOTHING IS READ until the member taps Install, and the confirm step shows no name, size or
//     type — for a content:// URI none of them is known before the bytes are read (Capacitor Filesystem has no
//     display-name call). The real name appears after installing.
//
// WHAT THE OPEN-WITH READ IS NOT. It is fetch(Capacitor.convertFileSrc(url)) read as a STREAM with a running byte
// count that stops at the cap. There is deliberately NO Filesystem.readFile fallback: it hands the whole file over
// the bridge as base64 before any cap could apply, and a sender can point us at a stream of any size.
//
// THE MODULE'S NAME IS TEXT. It is drawn as a React child, never through dangerouslySetInnerHTML: the name comes
// from inside a stranger's file, and index.html has no CSP, so sanitizeHtml is the only barrier anywhere.
//
// Globals this file adds (app/*.jsx share ONE scope — a repeat of any of these in another file blanks the APK):
// IFS_MAX_BYTES, IFS_HANDLED_TTL_MS, IFS_PEEK_BYTES, ifsIsContentUrl, ifsHash, ifsWasHandled, ifsMarkHandled, ifsPeekAudio,
// ifsReadContent, ifsRunInstall, handleIncomingFile, ifsKindWord, InstallFromFileSheet.

const IFS_MAX_BYTES = 50 * 1024 * 1024;               // the same 50 MB the engine refuses above
const IFS_HANDLED_KEY = 'trinityone.handledFiles';   // localStorage, NOT sessionStorage: see ifsMarkHandled

// Android hands us a content:// URI. Nothing else is ours: file:, http(s):, javascript: and the rest are ignored,
// and this never reaches autoLoad's ?module= fetch path (engine.js) — that reads location.search, not an intent.
// Not our OWN FileProvider either (com.trinityone.app.fileprovider / com.trinityone.steward.fileprovider): that URI
// would have our own WebView read the app's own cache into the installer (audit N2). Nothing could leave the phone
// and a tap is still needed, but there is no reason to offer it.
function ifsIsContentUrl(url) {
  return typeof url === 'string' && /^content:\/\//i.test(url) && !/^content:\/\/com\.trinityone\.[a-z0-9_]+\.fileprovider(\/|$)/i.test(url);
}

// 64 bits (two independent 32-bit hashes), not 32: a collision would have swallowed a different file's confirm step.
function ifsHash(url) {
  let a = 5381, b = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    a = ((a << 5) + a + c) | 0;
    b = Math.imul(b ^ c, 0x01000193);
  }
  return (a >>> 0).toString(36) + '.' + (b >>> 0).toString(36);
}

// "ALREADY HANDLED" LIVES IN localStorage. Android re-delivers the old intent when the app is relaunched from
// Recents, after the read permission that came with it has gone; in sessionStorage the marker died with the
// process, so the sheet reopened and then failed. A hash and a time, never the URL (it can name a person's file).
function ifsHandled() {
  try { const v = JSON.parse(localStorage.getItem(IFS_HANDLED_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
// A marker LAPSES. Android re-delivers the old intent on a relaunch from Recents, which is minutes, so a marker
// younger than this swallows the replay; but one that lived for ever hid a file the member had declined (or that
// failed) and then really opened again from a cold start (audit L1).
const IFS_HANDLED_TTL_MS = 15 * 60 * 1000;
function ifsWasHandled(h) { return ifsHandled().some(r => r && r.h === h && typeof r.t === 'number' && Date.now() - r.t < IFS_HANDLED_TTL_MS); }
function ifsMarkHandled(h) {
  try { localStorage.setItem(IFS_HANDLED_KEY, JSON.stringify([...ifsHandled().filter(r => r && r.h !== h), { h, t: Date.now() }].slice(-8))); } catch (e) {}
}

// AN AUDIO BIBLE ARRIVES THE SAME WAY (plan N3/P2/B1). While the first IFS_PEEK_BYTES are read, a zip (the stream starts
// PK\x03\x04) is looked into: directories, __MACOSX/ and readme / licence / .txt / .pdf / .jpg / .png entries are passed
// over, and if the FIRST OTHER entry is audio — by its name (.mp3 .m4a .ogg) or by its first inflated bytes — the
// verdict is 'audio'. Anything else, or no verdict within IFS_PEEK_BYTES, is 'other' and the Bible route carries on
// exactly as before. Re-run over everything read so far on each chunk (≤ 256 KB), so a header split across chunks is
// simply 'more'. A passed-over entry stored with a data descriptor has no length to skip by: that ends the peek ('other').
const IFS_PEEK_BYTES = 256 * 1024;
function ifsPeekAudio(chunks) {
  const F = window.fflate;
  if (!F || typeof F.Unzip !== 'function') return 'other';
  // the ONE audio check the store uses too (app/audio-store.jsx sniff: ID3, a real MPEG II/III frame, ftyp, OggS)
  const S = window.TrinityAudioStore;
  const isAudio = (u) => !!(S && typeof S.sniff === 'function' && S.sniff(u));
  let verdict = null;
  try {
    const unz = new F.Unzip((file) => {
      if (verdict) return;
      const name = String(file.name || ''); const base = name.split('/').pop().toLowerCase();
      if (/\/$/.test(name) || /(^|\/)__MACOSX\//.test(name) || /^(readme|licen[cs]e)/.test(base) || /\.(txt|pdf|jpe?g|png)$/.test(base)) {
        if (file.compression === 0 && file.size === undefined) { verdict = 'other'; return; }
        file.ondata = () => {}; file.start(); return;
      }
      if (/\.(mp3|m4a|ogg)$/.test(base)) { verdict = 'audio'; return; }
      const got = []; let n = 0;
      file.ondata = (err, dat, fin) => {
        if (verdict) return;
        if (err) { verdict = 'other'; return; }
        if (dat && dat.length) { got.push(dat); n += dat.length; }
        if (n >= 12 || fin) { const u = new Uint8Array(n); let at = 0; for (const g of got) { u.set(g, at); at += g.length; } verdict = isAudio(u) ? 'audio' : 'other'; }
      };
      file.start();
    });
    unz.register(F.UnzipInflate);
    for (const c of chunks) { unz.push(c, false); if (verdict) break; }
  } catch (e) { return verdict || 'other'; }
  return verdict || 'more';
}

// Read a content:// file as a stream, stopping at the cap. Resolves a Uint8Array, or the string 'too-big'.
// Rejects when it cannot be read at all — the caller says "couldn't read that file" and does NOTHING else.
// opts.onAudio (optional): when the peek above says audio, it is called with { head: Uint8Array[] already read, reader }
// — the SAME live reader, so the file is never opened twice — and this returns 'audio'. With no onAudio nothing peeks.
// A declared length over the cap is still refused at once when nothing peeks; when something does, the first
// IFS_PEEK_BYTES are read first, because a large audio zip declares a large length too.
async function ifsReadContent(url, opts) {
  const cap = window.Capacitor;
  if (!cap || typeof cap.convertFileSrc !== 'function') throw new Error('no native bridge');
  const res = await fetch(cap.convertFileSrc(url));
  if (!res || !res.ok || !res.body || typeof res.body.getReader !== 'function') throw new Error('unreadable');
  const declared = Number((res.headers && res.headers.get && res.headers.get('content-length')) || 0);
  const reader = res.body.getReader();
  let peek = (opts && typeof opts.onAudio === 'function') ? 'more' : 'off';
  if (declared > IFS_MAX_BYTES && peek === 'off') { try { await reader.cancel(); } catch (e) {} return 'too-big'; }
  const chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > IFS_MAX_BYTES) { try { await reader.cancel(); } catch (e) {} return 'too-big'; }
    chunks.push(value);
    if (peek === 'more') {
      const h = chunks[0].length >= 4 ? chunks[0] : (() => { const u = new Uint8Array(Math.min(4, total)); let at = 0; for (const c of chunks) { const k = Math.min(c.length, u.length - at); u.set(c.subarray(0, k), at); at += k; if (at >= u.length) break; } return u; })();
      const v = h.length < 4 ? 'more' : (h[0] === 0x50 && h[1] === 0x4B && h[2] === 0x03 && h[3] === 0x04) ? ifsPeekAudio(chunks) : 'other';
      if (v === 'audio') { opts.onAudio({ head: chunks.slice(), reader }); return 'audio'; }
      if (v === 'other' || total >= IFS_PEEK_BYTES) peek = 'off';
      if (peek === 'off' && declared > IFS_MAX_BYTES) { try { await reader.cancel(); } catch (e) {} return 'too-big'; }
    }
  }
  const out = new Uint8Array(total); let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

// The tap on Install for a file another app sent. opts.onAudio (app.jsx) takes an audio Bible to the Audio Bibles
// screen; the Install sheet is then closed by hand — it ignores its own close while busy, and this is the one path that
// may close it then.
async function ifsRunInstall(url, show, opts) {
  show({ phase: 'installing' });
  let result;
  try {
    const bytes = await ifsReadContent(url, opts && typeof opts.onAudio === 'function' ? { onAudio: opts.onAudio } : undefined);
    if (bytes === 'audio') { show(null); return; }
    result = bytes === 'too-big' ? { ok: false, reason: 'too-big' } : await window.Bible.installFromBytes(bytes, '');
  } catch (e) {
    result = { ok: false, reason: 'unreadable' };
  }
  show({ phase: 'result', result });
}

// An intent URL arrived. `replay` = it came from getLaunchUrl(), which keeps returning the SAME url, so it is
// ignored if we have already shown it once; a live appUrlOpen means the member just tapped, so it always shows.
// Returns what it did ('ignored' | 'handled' | 'shown'). It only OPENS THE CONFIRM STEP — nothing is read here.
function handleIncomingFile(url, replay, show) {
  if (!ifsIsContentUrl(url)) return 'ignored';
  const h = ifsHash(url);
  if (replay && ifsWasHandled(h)) return 'handled';
  ifsMarkHandled(h);
  show({ phase: 'confirm', url });
  return 'shown';
}

function ifsKindWord(kind) {
  return kind === 'comment' ? 'commentary' : kind === 'dict' ? 'dictionary' : kind === 'crossref' ? 'cross-references' : 'Bible';
}

// "Read it now": make the new Bible active AND move the reader to a passage it really has. setActive alone leaves the reader on
// the member's old place, and a partial Bible (a draft, a portion, one book) has no text there: a blank page under a chapter heading.
// The current place is kept when the new Bible has text at it.
function ifsReadNow(abbr, ctx) {
  try { window.Bible.setActive(abbr); } catch (e) {}
  try {
    const at = window.Bible.passageFor && window.Bible.passageFor(abbr, ctx && ctx.loc);
    const here = ctx && ctx.loc;
    if (at && ctx && ctx.setLoc && !(here && here.book === at.book && here.chap === at.chap)) ctx.setLoc({ book: at.book, chap: at.chap });
  } catch (e) {}
}

function InstallFromFileSheet({ state, onInstall, onClose, ctx }) {
  const s = state || {};
  const open = !!state;
  const busy = s.phase === 'installing';
  const r = s.result || {};
  const close = () => { if (!busy) onClose && onClose(); };
  const word = ifsKindWord(r.kind);
  const Word = word.charAt(0).toUpperCase() + word.slice(1);

  let tone = 'var(--sage)', icon = 'check', title = '', name = null, names = null, body = '', buttons = [];
  const ok = { label: 'OK', onClick: close };
  if (s.phase === 'confirm') {
    tone = 'var(--clay)'; icon = 'plus';
    title = 'Install this file?';
    body = 'Another app sent TrinityOne a file. If it is a Bible, commentary, dictionary or audio Bible it will be saved on this phone and work with no internet. Only install files from people you trust.';
    buttons = [{ label: 'Install', primary: true, onClick: () => onInstall && onInstall() }, { label: 'Not now', onClick: close }];
  } else if (busy) {
    tone = 'var(--clay)'; icon = 'download';
    title = 'Installing…';
    body = 'Reading the file. A big one can take about half a minute on an older phone. Keep TrinityOne open.';
  } else if (s.phase === 'result' && r.ok && r.already) {
    title = 'You already have this ' + word; name = r.name; body = 'Nothing was changed.';
    buttons = r.kind === 'bible' || !r.kind
      ? [{ label: 'Read it now', primary: true, onClick: () => { ifsReadNow(r.abbr, ctx); ctx && ctx.go && ctx.go('read'); ctx && ctx.closeStore && ctx.closeStore(); close(); } }, { label: 'Done', onClick: close }]
      : [{ label: 'Done', primary: true, onClick: close }];
  } else if (s.phase === 'result' && r.ok) {
    title = Word + ' installed'; name = r.name;
    body = r.renamed ? 'You already have a different ' + word + ' with this name, so this one is labelled to tell them apart.' : 'It is on this phone now. You can read it with no internet.';
    buttons = r.kind === 'bible'
      ? [{ label: 'Read it now', primary: true, onClick: () => { ifsReadNow(r.abbr, ctx); ctx && ctx.go && ctx.go('read'); ctx && ctx.closeStore && ctx.closeStore(); close(); } }, { label: 'Done', onClick: close }]
      : [{ label: 'Open Library', primary: true, onClick: () => { close(); ctx && ctx.openStore && ctx.openStore('installed', r.kind === 'dict' ? 'dictionaries' : 'commentaries'); } }, { label: 'Done', onClick: close }];
  } else if (s.phase === 'result') {
    tone = 'var(--clay-ink)'; icon = 'x';
    if (r.reason === 'link-refused') {
      title = 'TrinityOne can\u2019t open that link';
      body = 'It points to a file that isn\u2019t in TrinityOne\u2019s own library, so nothing was downloaded. You can add Bibles from the Library.';
      buttons = [ok, { label: 'Open Library', onClick: () => { close(); ctx && ctx.openStore && ctx.openStore('featured', 'bibles'); } }];
    } else if (r.reason === 'quarantined') {
      const many = Array.isArray(r.names) && r.names.length > 1;
      title = many ? 'Saved files were not opened' : 'A saved file was not opened';
      name = many ? null : r.name; names = many ? r.names : null;
      body = (many ? 'They' : 'It') + ' could freeze TrinityOne, so ' + (many ? 'they were' : 'it was') + ' not loaded. ' + (many ? 'They are' : 'It is') + ' still on this phone: you can remove ' + (many ? 'them' : 'it') + ' in Library, under Installed.';
      buttons = [ok, { label: 'Open Library', onClick: () => { close(); ctx && ctx.openStore && ctx.openStore('installed'); } }];
    }
    else if (r.reason === 'too-big') { title = 'That file is too big'; body = 'TrinityOne takes files up to 50 MB. Nothing was installed.'; buttons = [ok]; }
    else if (r.reason === 'no-space') { title = 'Not enough room on this phone'; body = 'Nothing was installed. Free some space and try again.'; buttons = [ok]; }
    // engine.js _installOne: a Bible file with chapters but not one verse this phone can read (2026-11-18)
    else if (r.reason === 'no-text') {
      title = 'This Bible has no text TrinityOne can read'; body = 'Nothing was installed.';
      buttons = [ok, { label: 'How do I get a Bible?', onClick: () => { close(); ctx && ctx.openStore && ctx.openStore('featured', 'bibles'); } }];
    }
    else if (r.reason === 'unreadable') { title = 'TrinityOne couldn’t read that file'; body = 'Nothing was installed.'; buttons = [ok]; }
    else {
      title = 'TrinityOne can’t use this file';
      body = 'It isn’t a Bible, commentary or dictionary TrinityOne can read, or it isn’t safe to open. Nothing was installed.';
      buttons = [ok, { label: 'How do I get a Bible?', onClick: () => { close(); ctx && ctx.openStore && ctx.openStore('featured', 'bibles'); } }];
    }
  }

  return (
    <BottomSheet open={open} onClose={close} maxHeight="82%" z={70}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '6px 4px 4px' }}>
        <div style={{ width: 54, height: 54, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'color-mix(in oklab, ' + tone + ' 14%, var(--surface))', color: tone, marginBottom: 12 }}>
          {busy ? <Spinner size={24} /> : <Icon name={icon} size={26} stroke={2} />}
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 21, fontWeight: 700, lineHeight: 1.2 }}>{title}</div>
        {name ? <div style={{ fontFamily: 'var(--font-read)', fontSize: 17, fontWeight: 600, margin: '8px 0 0', overflowWrap: 'anywhere' }}>{name}</div> : null}
        {names ? names.map((n, i) => <div key={i} style={{ fontFamily: 'var(--font-read)', fontSize: 16, fontWeight: 600, margin: '6px 0 0', overflowWrap: 'anywhere' }}>{n}</div>) : null}
        <p style={{ fontFamily: 'var(--font-read)', fontSize: 15.5, lineHeight: 1.55, color: 'var(--ink-2)', margin: '8px 0 18px', textWrap: 'pretty' }}>{body}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, width: '100%' }}>
          {buttons.map(b => (
            <button key={b.label} onClick={b.onClick} style={{
              width: '100%', padding: 14, borderRadius: 15, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 15,
              border: b.primary ? 'none' : '1px solid var(--line)',
              background: b.primary ? 'var(--clay)' : 'var(--surface)', color: b.primary ? 'var(--on-clay)' : 'var(--ink-2)' }}>{b.label}</button>
          ))}
        </div>
      </div>
    </BottomSheet>
  );
}
window.InstallFromFileSheet = InstallFromFileSheet;
window.handleIncomingFile = handleIncomingFile;
window.ifsRunInstall = ifsRunInstall;
window.ifsReadContent = ifsReadContent;
