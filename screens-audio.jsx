// screens-audio.jsx — a persistent audio engine + mini-player, shared by sermons (podcast feed) and
// (later) audio Bibles. The <audio> element lives outside React so playback survives navigation and
// overlay open/close; Media Session wires up lock-screen / Bluetooth / car controls.

// ── window.TrinityAudio: one app-wide audio player with a small queue + pub/sub ──
(function () {
  if (window.TrinityAudio) return;
  const el = document.createElement('audio');
  el.preload = 'metadata';
  el.setAttribute('playsinline', '');
  document.body.appendChild(el);

  let state = { track: null, playing: false, loading: false, t: 0, d: 0 };
  let queue = [], qi = -1;
  const subs = new Set();
  const emit = () => { state = { ...state }; subs.forEach(fn => { try { fn(state); } catch (e) {} }); };
  const set = (p) => { Object.assign(state, p); emit(); };

  el.addEventListener('timeupdate', () => set({ t: el.currentTime, d: el.duration || 0 }));
  el.addEventListener('durationchange', () => set({ d: el.duration || 0 }));
  el.addEventListener('play', () => set({ playing: true }));
  el.addEventListener('pause', () => set({ playing: false }));
  el.addEventListener('waiting', () => set({ loading: true }));
  el.addEventListener('playing', () => set({ loading: false, playing: true }));
  el.addEventListener('ended', () => { set({ playing: false }); api.next(); });
  el.addEventListener('error', () => set({ loading: false, playing: false }));

  function mediaSession(track) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || '', artist: track.subtitle || '', album: track.album || 'TrinityOne',
        artwork: track.image ? [{ src: track.image, sizes: '512x512', type: 'image/png' }] : [],
      });
      const h = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch (e) {} };
      h('play', () => api.toggle()); h('pause', () => api.toggle());
      h('seekbackward', (d) => api.seek(-(d && d.seekOffset || 15)));
      h('seekforward', (d) => api.seek(d && d.seekOffset || 30));
      h('previoustrack', queue.length > 1 ? () => api.prev() : null);
      h('nexttrack', queue.length > 1 ? () => api.next() : null);
      h('seekto', (d) => { if (d && d.seekTime != null && el.duration) el.currentTime = d.seekTime; });
    } catch (e) {}
  }

  const api = {
    // play a track now. `list` (optional) sets the queue so ended → next and the lock-screen skip work.
    // track = { id, title, subtitle, src, image, album }
    play(track, list) {
      if (!track || !track.src) return;
      if (Array.isArray(list) && list.length) { queue = list; qi = Math.max(0, list.findIndex(t => t.id === track.id)); }
      else { queue = [track]; qi = 0; }
      if (el.src !== track.src) el.src = track.src;
      set({ track, loading: true });
      mediaSession(track);
      el.play().then(() => set({ playing: true, loading: false })).catch(() => set({ playing: false, loading: false }));
    },
    toggle() { if (!state.track) return; if (el.paused) el.play().catch(() => {}); else el.pause(); },
    seek(delta) { if (el.duration) el.currentTime = Math.max(0, Math.min(el.duration, (el.currentTime || 0) + delta)); },
    seekTo(frac) { if (el.duration) el.currentTime = Math.max(0, Math.min(1, frac)) * el.duration; },
    next() { if (qi >= 0 && qi + 1 < queue.length) api.play(queue[qi + 1], queue); },
    prev() { if (el.currentTime > 3) { el.currentTime = 0; return; } if (qi > 0) api.play(queue[qi - 1], queue); },
    hasNext() { return qi >= 0 && qi + 1 < queue.length; },
    hasPrev() { return qi > 0; },
    stop() { try { el.pause(); el.removeAttribute('src'); el.load(); } catch (e) {} queue = []; qi = -1; set({ track: null, playing: false, t: 0, d: 0 }); },
    get current() { return state.track; },
    subscribe(fn) { subs.add(fn); fn(state); return () => subs.delete(fn); },
  };
  window.TrinityAudio = api;
})();

// React hook: subscribe a component to the audio engine's state
function useTrinityAudio() {
  const [s, setS] = React.useState(() => (window.TrinityAudio ? { track: window.TrinityAudio.current, playing: false, loading: false, t: 0, d: 0 } : { track: null, playing: false, loading: false, t: 0, d: 0 }));
  React.useEffect(() => (window.TrinityAudio ? window.TrinityAudio.subscribe(setS) : undefined), []);
  return s;
}

const fmtTime = (s) => { s = Math.max(0, Math.floor(s || 0)); const m = Math.floor(s / 60), ss = s % 60; return m + ':' + String(ss).padStart(2, '0'); };

// ── MiniPlayer: a persistent bar docked above the tab bar whenever something is loaded ──
function MiniPlayer({ ctx }) {
  const a = useTrinityAudio();
  if (!a.track) return null;
  const pct = a.d ? (a.t / a.d) * 100 : 0;
  return (
    <div onClick={() => ctx.openListen && ctx.openListen()} style={{
      position: 'absolute', left: 12, right: 12, zIndex: 24,
      bottom: 'calc(max(12px, env(safe-area-inset-bottom)) + 74px)',
      display: 'flex', alignItems: 'center', gap: 11, padding: '8px 10px', cursor: 'pointer', overflow: 'hidden',
      background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 18, boxShadow: 'var(--shadow-lg)',
      animation: 'trinityRise .22s ease both',
    }}>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2.5, background: 'var(--line)' }}>
        <div style={{ width: pct + '%', height: '100%', background: 'var(--clay)' }} />
      </div>
      <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: a.track.image ? `center/cover url(${a.track.image})` : 'color-mix(in oklab, var(--clay) 14%, var(--surface))', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {!a.track.image ? <Icon name="headphones" size={19} color="var(--clay)" /> : null}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.track.title}</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.track.subtitle || ''}</div>
      </div>
      <button onClick={(e) => { e.stopPropagation(); window.TrinityAudio.toggle(); }} aria-label={a.playing ? 'Pause' : 'Play'} style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 999, border: 'none', background: 'var(--clay)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {a.loading ? <span style={{ width: 16, height: 16, borderRadius: 999, border: '2px solid rgba(255,255,255,.5)', borderTopColor: '#fff', display: 'inline-block', animation: 'trinitySpin .8s linear infinite' }} /> : <Icon name={a.playing ? 'pause' : 'play'} size={18} color="#fff" />}
      </button>
      <button onClick={(e) => { e.stopPropagation(); window.TrinityAudio.stop(); }} aria-label="Close player" style={{ width: 30, height: 38, flexShrink: 0, border: 'none', background: 'none', color: 'var(--ink-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="x" size={16} color="var(--ink-3)" />
      </button>
    </div>
  );
}

// ── Audio Bible: public-domain recorded narration (Berean Standard Bible, via the Free Use Bible API) ──
// audio.bible.helloao.org serves a clean per-chapter MP3 (CDN, range-supported). The text the member
// reads is WEB/KJV; this is a companion narration, not a verse-synced reading of that exact translation.
const USFM_ORDER = ('GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER ' +
  'LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL ' +
  '1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV').split(' ');
// Audio sources: BSB streams per-chapter from the Free Use Bible API; WEB is the public-domain World
// English Bible (matches the WEB text) downloaded as an offline module (see the store below).
const AUDIO_BIBLE_OPTIONS = {
  translations: [{ id: 'BSB', name: 'Berean Standard', stream: true }, { id: 'WEB', name: 'World English', local: true }],
  readers: [{ id: 'david', name: 'David' }, { id: 'hays', name: 'Hays' }, { id: 'souer', name: 'Souer' }],
};
const transName = (id) => (AUDIO_BIBLE_OPTIONS.translations.find(t => t.id === id) || {}).name || id;
function getAudioChoice() {
  let v = 'BSB/david'; try { if (typeof lsGet === 'function') v = lsGet('trinityone.audioVoice', 'BSB/david') || 'BSB/david'; } catch (e) {}
  const [t, r] = String(v).split('/');
  const translation = AUDIO_BIBLE_OPTIONS.translations.some(x => x.id === t) ? t : 'BSB';
  const reader = AUDIO_BIBLE_OPTIONS.readers.some(x => x.id === r) ? r : 'david';
  return { translation, reader };
}
// BSB streaming track (per-chapter MP3 on the helloao CDN)
function bsbChapterTrack(bookNum, chap, reader) {
  const code = USFM_ORDER[bookNum - 1]; if (!code) return null;
  const label = (window.Bible && window.Bible.bookName) ? window.Bible.bookName(bookNum) : ('Book ' + bookNum);
  return { id: 'bible:' + bookNum + ':' + chap, title: label + ' ' + chap, subtitle: 'Audio Bible · Berean Standard',
    src: 'https://audio.bible.helloao.org/api/BSB/' + code + '/' + chap + '/audio/' + (reader || 'david') + '.mp3', album: 'Audio Bible' };
}

// ── WEB audio module: download + store per-chapter MP3s (extracted from the public-domain zips) ──
const ADB_STORE = 'chapters';
function _adb() {
  return new Promise((res, rej) => { const r = indexedDB.open('trinityone-audio', 1);
    r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains(ADB_STORE)) db.createObjectStore(ADB_STORE); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function _adbGet(key) { const db = await _adb(); return new Promise(res => { const rq = db.transaction(ADB_STORE).objectStore(ADB_STORE).get(key); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null); }); }
async function _adbPut(key, blob) { const db = await _adb(); return new Promise((res, rej) => { const tx = db.transaction(ADB_STORE, 'readwrite'); tx.objectStore(ADB_STORE).put(blob, key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); }
async function _adbKeys() { const db = await _adb(); return new Promise(res => { const rq = db.transaction(ADB_STORE).objectStore(ADB_STORE).getAllKeys(); rq.onsuccess = () => res(rq.result || []); rq.onerror = () => res([]); }); }
async function _adbDel(keys) { const db = await _adb(); return new Promise(res => { const tx = db.transaction(ADB_STORE, 'readwrite'); keys.forEach(k => tx.objectStore(ADB_STORE).delete(k)); tx.oncomplete = () => res(); tx.onerror = () => res(); }); }

let _webManifest = null;
async function getWebManifest() {
  if (_webManifest) return _webManifest;
  try { const r = await fetch('web-audio-manifest.json'); _webManifest = await r.json(); } catch (e) { _webManifest = { chapters: {} }; }
  return _webManifest;
}
const _webKey = (book, chap) => 'WEB/' + book + '/' + chap;
async function webChapterUrl(book, chap) { const b = await _adbGet(_webKey(book, chap)); return b ? URL.createObjectURL(b) : null; }
// how much of a book is downloaded
async function webBookState(book) {
  const man = await getWebManifest(); const bk = man.chapters[String(book)]; if (!bk) return { total: 0, have: 0 };
  const total = Object.keys(bk).length; const keys = await _adbKeys(); const pre = _webKey(book, '');
  const have = keys.filter(k => String(k).indexOf(pre) === 0).length; return { total, have };
}
async function webDownloadedBooks() { const keys = await _adbKeys(); const s = new Set(); keys.forEach(k => { const m = /^WEB\/(\d+)\//.exec(String(k)); if (m) s.add(+m[1]); }); return s; }
async function removeWebBook(book) { const keys = await _adbKeys(); await _adbDel(keys.filter(k => String(k).indexOf(_webKey(book, '')) === 0)); }
// download one book: range-fetch each chapter slice via the gateway proxy, inflate (raw DEFLATE), store
let _audioBase = null;   // a pool gateway that serves /audiozip (cached after the first probe)
async function pickAudioBase() {
  if (_audioBase) return _audioBase;
  const FS = window.Fellowship; const urls = [...new Set([...((FS && FS.relays) || []), ...((FS && FS.CANONICAL_RELAYS) || [])])];
  const bases = urls.map(u => { try { const x = new URL(u); return (x.protocol === 'wss:' ? 'https:' : 'http:') + '//' + x.host; } catch (e) { return null; } }).filter(Boolean);
  for (const b of bases) { try { const r = await fetch(b + '/audiozip?t=nt&start=0&len=4'); if (r.ok) { _audioBase = b; return b; } } catch (e) {} }
  return null;
}
async function downloadWebBook(book, onProgress, getAborted) {
  const man = await getWebManifest(); const bk = man.chapters[String(book)]; if (!bk) throw new Error('no such book');
  const base = await pickAudioBase();
  if (!base) throw new Error('No download server reachable — your church relay needs updating');
  const t = book <= 39 ? 'ot' : 'nt';
  const chaps = Object.keys(bk).map(Number).sort((a, b) => a - b);
  for (let i = 0; i < chaps.length; i++) {
    if (getAborted && getAborted()) throw new Error('cancelled');
    const c = chaps[i], key = _webKey(book, c);
    if (!(await _adbGet(key))) {
      const [off, csize] = bk[String(c)];
      const r = await fetch(base + '/audiozip?t=' + t + '&start=' + off + '&len=' + (csize + 96));
      if (!r.ok) throw new Error('download failed');
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('bad chunk');   // 'PK'
      const nlen = buf[26] | (buf[27] << 8), elen = buf[28] | (buf[29] << 8), ds = 30 + nlen + elen;
      const mp3 = window.fflate.inflateSync(buf.subarray(ds, ds + csize));
      await _adbPut(key, new Blob([mp3], { type: 'audio/mpeg' }));
    }
    if (onProgress) onProgress(i + 1, chaps.length);
  }
  return true;
}

// play a chapter — local WEB if chosen + downloaded, else BSB stream; queues the book to auto-advance
async function playBibleChapter(bookNum, chap) {
  if (!window.TrinityAudio || !USFM_ORDER[bookNum - 1]) return false;
  const { translation, reader } = getAudioChoice();
  const max = (window.Bible && window.Bible.maxChapter) ? (window.Bible.maxChapter(bookNum) || chap) : chap;
  const label = (window.Bible && window.Bible.bookName) ? window.Bible.bookName(bookNum) : ('Book ' + bookNum);
  if (translation === 'WEB') {
    const here = await webChapterUrl(bookNum, chap);
    if (here) {
      const queue = [];
      for (let c = 1; c <= max; c++) { const u = (c === chap) ? here : await webChapterUrl(bookNum, c); if (u) queue.push({ id: 'bible:' + bookNum + ':' + c, title: label + ' ' + c, subtitle: 'Audio Bible · World English', src: u, album: 'Audio Bible' }); }
      const track = queue.find(t => t.id === 'bible:' + bookNum + ':' + chap) || queue[0];
      window.TrinityAudio.play(track, queue); return true;
    }
    if (window.trinityToast) window.trinityToast('Download this book in Library to hear the World English audio — playing Berean Standard for now');
  }
  const queue = []; for (let c = 1; c <= max; c++) { const t = bsbChapterTrack(bookNum, c, reader); if (t) queue.push(t); }
  const track = bsbChapterTrack(bookNum, chap, reader);
  if (!track) return false;
  window.TrinityAudio.play(track, queue);
  return true;
}

// ── Audio Bibles library: download public-domain WEB audio per book for offline listening ──
function AudioBiblesScreen({ open, onClose, ctx }) {
  const [man, setMan] = React.useState(null);
  const [done, setDone] = React.useState(new Set());     // books fully downloaded
  const [prog, setProg] = React.useState({});            // book -> {have,total}
  const [busy, setBusy] = React.useState(null);          // 'book:N' | 'nt' | 'ot' | null
  const abort = React.useRef(false);
  const refresh = async () => { setDone(new Set(await window.TrinityAudioBible.webDownloadedBooks())); };
  React.useEffect(() => { if (!open) return; window.TrinityAudioBible.getWebManifest().then(setMan); refresh(); }, [open]);
  const books = (window.Bible && window.Bible.bookMeta) ? window.Bible.bookMeta() : [];
  const bookMB = (n) => { if (!man || !man.chapters[String(n)]) return 0; let s = 0; for (const c in man.chapters[String(n)]) s += man.chapters[String(n)][c][1]; return Math.round(s / 1048576); };
  const doBook = async (n) => {
    abort.current = false;
    try { await window.TrinityAudioBible.downloadWebBook(n, (have, total) => setProg(p => ({ ...p, [n]: { have, total } })), () => abort.current); }
    finally { setProg(p => { const q = { ...p }; delete q[n]; return q; }); }
    await refresh();
  };
  const one = async (n) => { if (busy) return; setBusy('book:' + n); try { await doBook(n); ctx.toast(window.Bible.bookName(n) + ' downloaded'); } catch (e) { if (e.message !== 'cancelled') ctx.toast(e.message || 'Download failed'); } setBusy(null); };
  const all = async (which) => { if (busy) return; setBusy(which); abort.current = false; const range = which === 'nt' ? books.filter(b => b.num >= 40) : books.filter(b => b.num < 40); try { for (const b of range) { if (abort.current) break; if (!done.has(b.num)) await doBook(b.num); } ctx.toast('Download complete'); } catch (e) { if (e.message !== 'cancelled') ctx.toast(e.message || 'Download stopped'); } setBusy(null); };
  const stop = () => { abort.current = true; };
  const remove = async (n) => { await window.TrinityAudioBible.removeWebBook(n); refresh(); };

  const seg = { display: 'flex', gap: 8, marginBottom: 16 };
  const headBtn = (which, label) => <button onClick={() => (busy ? stop() : all(which))} style={{ flex: 1, padding: '11px', borderRadius: 13, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13.5, background: busy === which ? 'var(--clay-deep)' : 'var(--clay)', color: '#fff' }}>{busy === which ? 'Stop' : label}</button>;
  const row = (b) => {
    const isDone = done.has(b.num); const p = prog[b.num]; const downloading = busy === 'book:' + b.num || (busy && busy.indexOf('book:') !== 0 && p);
    return (
      <div key={b.num} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 4px', borderBottom: '1px solid var(--line-2)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--ink)' }}>{b.name}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{p ? p.have + ' / ' + p.total + ' chapters' : (isDone ? 'Downloaded · ' + bookMB(b.num) + ' MB' : b.ch + ' chapters · ~' + bookMB(b.num) + ' MB')}</div>
        </div>
        {p ? (
          <div style={{ width: 70, height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden', flexShrink: 0 }}><div style={{ width: (p.total ? (p.have / p.total) * 100 : 0) + '%', height: '100%', background: 'var(--clay)' }} /></div>
        ) : isDone ? (
          <button onClick={() => remove(b.num)} title="Remove" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}><Icon name="trash" size={15} color="currentColor" /></button>
        ) : (
          <button onClick={() => one(b.num)} disabled={!!busy} style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 11px', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1, color: 'var(--clay)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12.5 }}><Icon name="cloud" size={15} color="currentColor" /> Get</button>
        )}
      </div>
    );
  };
  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 50, flexShrink: 0, background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px 12px' }}>
          <IconBtn name="chevL" onClick={onClose} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 21, fontWeight: 700 }}>Audio Bibles</h1>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>World English Bible · public domain</div>
          </div>
        </div>
      </div>
      <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 18px 40px' }}>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 16px' }}>Download books to listen offline — this matches the WEB text you read. Large files; Wi-Fi recommended. Set <b>World English</b> as your Audio Bible voice in Read → Settings.</p>
        <div style={seg}>{headBtn('nt', 'New Testament')}{headBtn('ot', 'Old Testament')}</div>
        <SectionLabel>New Testament</SectionLabel>
        <div style={{ marginBottom: 18 }}>{books.filter(b => b.num >= 40).map(row)}</div>
        <SectionLabel>Old Testament</SectionLabel>
        <div>{books.filter(b => b.num < 40).map(row)}</div>
      </div>
    </Overlay>
  );
}

window.AudioBiblesScreen = AudioBiblesScreen;
window.MiniPlayer = MiniPlayer;
window.useTrinityAudio = useTrinityAudio;
window.audioFmtTime = fmtTime;
window.playBibleChapter = playBibleChapter;
window.bibleChapterTrackId = (b, c) => 'bible:' + b + ':' + c;
window.AUDIO_BIBLE_OPTIONS = AUDIO_BIBLE_OPTIONS;
window.getAudioChoice = getAudioChoice;
window.TrinityAudioBible = { getWebManifest, downloadWebBook, removeWebBook, webBookState, webDownloadedBooks };
