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

  // Playback speed: one value for every surface, kept per device. Setting `src` makes the browser reload the
  // element and reset playbackRate to defaultPlaybackRate, so BOTH are set, and again on loadstart.
  const RATE_KEY = 'trinityone.audioRate';
  const RATES = [0.75, 1, 1.25, 1.5, 2];
  let rate = 1;
  try { const v = parseFloat(localStorage.getItem(RATE_KEY)); if (RATES.indexOf(v) >= 0) rate = v; } catch (e) {}
  const applyRate = () => { try { el.defaultPlaybackRate = rate; el.playbackRate = rate; } catch (e) {} };
  applyRate();

  let queue = [], qi = -1, playTok = 0, pending = false;   // pending = a queued track is still being fetched: the element holds NO source
  let state = { track: null, playing: false, loading: false, failed: false, t: 0, d: 0, rate, q: queue, qi };
  const subs = new Set();
  const emit = () => { state = { ...state }; subs.forEach(fn => { try { fn(state); } catch (e) {} }); };
  const set = (p) => { Object.assign(state, p); emit(); };

  el.addEventListener('timeupdate', () => set({ t: el.currentTime, d: el.duration || 0 }));
  el.addEventListener('loadstart', applyRate);
  el.addEventListener('durationchange', () => set({ d: el.duration || 0 }));
  el.addEventListener('play', () => set({ playing: true }));
  el.addEventListener('pause', () => set({ playing: false }));
  el.addEventListener('waiting', () => set({ loading: true }));
  el.addEventListener('playing', () => set({ loading: false, playing: true }));
  el.addEventListener('ended', () => { set({ playing: false }); api.next(); });
  el.addEventListener('error', () => set({ loading: false, playing: false }));

  // AN AUDIO-BIBLE CHAPTER'S BLOB ADDRESS IS LET GO WHEN THE PLAYER LEAVES IT (plan P1). Only tracks the audio-Bible code
  // made and marked {bibleLocal:true} — they always carry resolve(), so Previous or a replay simply resolves again and the
  // phone holds one chapter in memory at a time. Every other track (sermons, podcast episodes) is left exactly as before:
  // a queue's first sermon can hold a blob address with NOTHING to rebuild it from.
  function release(old, now) {
    if (!old || old === now || !old.bibleLocal || typeof old.resolve !== 'function' || !old.src) return;
    const u = old.src; delete old.src;
    try { if (/^blob:/.test(u)) URL.revokeObjectURL(u); } catch (e) {}
  }

  function mediaSession(track) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || '', artist: track.subtitle || '', album: track.album || 'TrinityOne',
        artwork: track.image ? [{ src: track.image, sizes: '512x512', type: 'image/png' }] : [],
      });
      const h = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch (e) {} };
      h('play', () => api.toggle()); h('pause', () => api.toggle());
      h('seekbackward', (d) => api.seek(-(d && d.seekOffset || 10)));
      h('seekforward', (d) => api.seek(d && d.seekOffset || 10));
      h('previoustrack', queue.length > 1 ? () => api.prev() : null);
      h('nexttrack', queue.length > 1 ? () => api.next() : null);
      h('seekto', (d) => { if (d && d.seekTime != null && el.duration) el.currentTime = d.seekTime; });
    } catch (e) {}
  }

  const api = {
    // play a track now. `list` (optional) sets the queue so ended → next and the lock-screen skip work.
    // track = { id, title, subtitle, src, image, album }
    // A queued track may carry `resolve()` (async → src) instead of `src` — a sermon's audio is a gated
    // download, fetched only when its turn comes, so "next" works without downloading the whole list.
    play(track, list) {
      if (!track || (!track.src && typeof track.resolve !== 'function')) return;
      if (Array.isArray(list) && list.length) { queue = list; qi = Math.max(0, list.findIndex(t => t.id === track.id)); }
      else { queue = [track]; qi = 0; }
      const tok = ++playTok;
      pending = false;
      const was = state.track;
      const start = () => {
        if (el.src !== track.src) el.src = track.src;
        release(was, track);
        applyRate();
        set({ track, loading: true, failed: false, q: queue, qi });
        mediaSession(track);
        el.play().then(() => set({ playing: true, loading: false })).catch(() => set({ playing: false, loading: false }));
      };
      if (track.src) { start(); return; }
      // DETACH the old source while the new one downloads: otherwise Play / the scrubber would drive the
      // PREVIOUS sermon's element under the NEW title. Play and seek are also no-ops until it lands.
      pending = true;
      try { el.pause(); el.removeAttribute('src'); el.load(); } catch (e) {}
      release(was, track);
      set({ track, loading: true, playing: false, failed: false, t: 0, d: 0, q: queue, qi });
      mediaSession(track);
      const fail = () => { if (tok === playTok) { pending = false; set({ loading: false, playing: false, failed: true }); } };
      Promise.resolve().then(() => track.resolve()).then(src => {
        if (tok !== playTok) { if (track.bibleLocal && src && /^blob:/.test(src)) { try { URL.revokeObjectURL(src); } catch (e) {} } return; }   // the listener chose something else while this downloaded
        if (!src) { fail(); return; }
        pending = false; track.src = src; start();
      }).catch(fail);
    },
    rates: RATES.slice(),
    get rate() { return rate; },
    setRate(r) {
      r = Number(r); if (RATES.indexOf(r) < 0) return;
      rate = r; applyRate();
      try { localStorage.setItem(RATE_KEY, String(r)); } catch (e) {}
      set({ rate });
    },
    // a failed fetch is retried by Play (the track is still current, it just has no source); a fetch in flight ignores it
    toggle() { if (!state.track || pending) return; if (state.failed) { api.play(state.track, queue); return; } if (el.paused) el.play().catch(() => {}); else el.pause(); },
    seek(delta) { if (!pending && el.duration) el.currentTime = Math.max(0, Math.min(el.duration, (el.currentTime || 0) + delta)); },
    seekTo(frac) { if (!pending && el.duration) el.currentTime = Math.max(0, Math.min(1, frac)) * el.duration; },
    next() { if (qi >= 0 && qi + 1 < queue.length) api.play(queue[qi + 1], queue); },
    prev() { if (el.currentTime > 3) { el.currentTime = 0; return; } if (qi > 0) api.play(queue[qi - 1], queue); },
    hasNext() { return qi >= 0 && qi + 1 < queue.length; },
    hasPrev() { return qi > 0; },
    stop() { playTok++; pending = false; try { el.pause(); el.removeAttribute('src'); el.load(); } catch (e) {} release(state.track, null); queue = []; qi = -1; set({ track: null, playing: false, loading: false, failed: false, t: 0, d: 0, q: queue, qi }); },
    get current() { return state.track; },
    subscribe(fn) { subs.add(fn); fn(state); return () => subs.delete(fn); },
  };
  window.TrinityAudio = api;
})();

// React hook: subscribe a component to the audio engine's state
function useTrinityAudio() {
  const [s, setS] = React.useState(() => ({ track: window.TrinityAudio ? window.TrinityAudio.current : null, playing: false, loading: false, failed: false, t: 0, d: 0, rate: 1, q: [], qi: -1 }));
  React.useEffect(() => (window.TrinityAudio ? window.TrinityAudio.subscribe(setS) : undefined), []);
  return s;
}

const fmtTime = (s) => { s = Math.max(0, Math.floor(s || 0)); const m = Math.floor(s / 60), ss = s % 60; return m + ':' + String(ss).padStart(2, '0'); };

// A sermon's audio is a member-gated download, so its queue entries carry `resolve()` (fetch + verify +
// decrypt) instead of a `src`; the engine calls it when that sermon's turn comes. `o` = { subtitle, toast,
// churchNpub }; returns a track the engine can queue. Failure toasts and resolves to null (engine stops loading).
function sermonAudioTrack(s, o) {
  o = o || {};
  const hosts = (s.hosts && s.hosts.length) ? s.hosts : (s.host ? [s.host] : []);
  return { id: s.id, title: s.title, subtitle: o.subtitle || '', album: o.subtitle || '', image: s.image,
    resolve: async () => {
      const FS = window.Fellowship;
      try {
        if (!hosts.length || !s.sha256 || !FS) throw new Error('This sermon is unavailable');
        const dec = s.enc && FS.mediaDecryptor ? await FS.mediaDecryptor(o.churchNpub) : null;
        if (s.enc && !dec) throw new Error('needs the church media key');
        return await FS.fetchSermon({ sha256: s.sha256, hosts, mime: s.mime, enc: s.enc }, { mime: s.mime || 'audio/mpeg', decrypt: dec });
      } catch (e) { if (o.toast) o.toast('Couldn’t load: ' + ((e && e.message) || 'error')); return null; }
    } };
}

// ── THE PLAYER. Owner decision 2026-10-11: ONE player, the floating one docked above the tab bar. The pages
// (Bible reader, Watch, Listen) keep their lists and play buttons and draw NO controls of their own.
// It is built from three small pieces so each control exists once: AudioScrubber, AudioButtons, AudioQueue.

// timeline: elapsed · draggable / tappable rail · total. `durationText` is shown until the audio reports its length.
function AudioScrubber({ a, durationText }) {
  const dragging = React.useRef(false);
  const A = window.TrinityAudio;
  const pct = a.d ? Math.min(100, (a.t / a.d) * 100) : 0;
  const seekFrom = (e) => { const r = e.currentTarget.getBoundingClientRect(); if (r && r.width && A) A.seekTo((e.clientX - r.left) / r.width); };
  const time = { fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', minWidth: 34, fontVariantNumeric: 'tabular-nums', flexShrink: 0 };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={time}>{fmtTime(a.t)}</span>
      <div role="slider" tabIndex={0} aria-label="Seek" title="Seek" aria-valuemin={0} aria-valuemax={Math.round(a.d || 0)} aria-valuenow={Math.round(a.t || 0)} aria-valuetext={fmtTime(a.t) + ' of ' + fmtTime(a.d)}
        onPointerDown={(e) => { dragging.current = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch (x) {} seekFrom(e); }}
        onPointerMove={(e) => { if (dragging.current) seekFrom(e); }}
        onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }}
        onKeyDown={(e) => { if (!A) return; if (e.key === 'ArrowLeft') { e.preventDefault(); A.seek(-5); } else if (e.key === 'ArrowRight') { e.preventDefault(); A.seek(5); } }}
        style={{ flex: 1, minWidth: 0, padding: '9px 0', cursor: 'pointer', touchAction: 'none' }}>
        <div style={{ height: 5, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
          <div style={{ width: pct + '%', height: '100%', background: 'var(--clay)', borderRadius: 3 }} />
        </div>
      </div>
      <span style={{ ...time, textAlign: 'right' }}>{a.d ? fmtTime(a.d) : (durationText || '')}</span>
    </div>
  );
}

// previous · −10 · play/pause · +10 · next · speed pill
function AudioButtons({ a }) {
  const A = window.TrinityAudio;
  if (!A) return null;
  const q = a.q || [], qi = a.qi;
  const hasNext = qi >= 0 && qi + 1 < q.length;
  const btn = { width: 38, height: 38, borderRadius: 999, border: 'none', background: 'transparent', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13, padding: 0, flexShrink: 0 };
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
      <button onClick={() => A.prev()} aria-label="Previous track" title="Previous" style={btn}><Icon name="rewind" size={20} color="currentColor" /></button>
      <button onClick={() => A.seek(-10)} aria-label="Back 10 seconds" title="Back 10 seconds" style={btn}>{'−10'}</button>
      <button onClick={() => A.toggle()} aria-label={a.playing ? 'Pause' : 'Play'} title={a.playing ? 'Pause' : 'Play'} style={{ ...btn, width: 44, height: 44, background: 'var(--clay)', color: 'var(--on-clay)' }}>
        {a.loading ? <span style={{ width: 18, height: 18, borderRadius: 999, border: '2.5px solid rgba(255,255,255,.45)', borderTopColor: 'currentColor', display: 'inline-block', animation: 'trinitySpin .8s linear infinite' }} /> : <Icon name={a.playing ? 'pause' : 'play'} size={20} color="currentColor" />}
      </button>
      <button onClick={() => A.seek(10)} aria-label="Forward 10 seconds" title="Forward 10 seconds" style={btn}>{'+10'}</button>
      <button onClick={() => A.next()} disabled={!hasNext} aria-label="Next track" title="Next" style={{ ...btn, opacity: hasNext ? 1 : 0.35, cursor: hasNext ? 'pointer' : 'default' }}><Icon name="forward" size={20} color="currentColor" /></button>
      <button onClick={() => { const rs = A.rates || [1]; const i = rs.indexOf(a.rate); A.setRate(rs[(i + 1) % rs.length]); }} aria-label={'Playback speed ' + a.rate + '×, tap to change'} title={'Playback speed ' + a.rate + '× · tap to change'}
        style={{ minWidth: 40, height: 28, marginLeft: 4, padding: '0 8px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, background: 'var(--surface-2)', color: 'var(--ink)', flexShrink: 0 }}>{a.rate + '×'}</button>
    </div>
  );
}

// the queue, current item marked; tapping an item plays it (tapping the current one pauses / resumes)
function AudioQueue({ a }) {
  const listRef = React.useRef(null);
  const A = window.TrinityAudio;
  const qi = a.qi, q = a.q || [];
  React.useEffect(() => {
    try { const box = listRef.current; const cur = box && box.querySelector && box.querySelector('[aria-current]'); if (cur && box.scrollTo) box.scrollTo({ top: Math.max(0, cur.offsetTop - box.offsetTop - 6) }); } catch (e) {}
  }, [qi, q.length]);
  if (!A || q.length < 2) return null;
  return (
    <div ref={listRef} role="list" aria-label="Up next" className="no-scrollbar" style={{ maxHeight: 200, overflowY: 'auto', position: 'relative' }}>
      {q.map((t, i) => {
        const isCur = i === qi;
        return (
          <button key={t.id} role="listitem" aria-current={isCur ? 'true' : undefined} aria-label={(isCur ? 'Now playing: ' : 'Play ') + t.title} title={t.title} onClick={() => (isCur ? A.toggle() : A.play(t, q))}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 6px', border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 13.5, fontWeight: isCur ? 700 : 500, color: 'var(--ink)', background: isCur ? 'color-mix(in oklab, var(--clay) 10%, var(--surface))' : 'transparent' }}>
            <span style={{ width: 16, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>{isCur ? <Icon name={a.playing ? 'pause' : 'play'} size={12} color="currentColor" /> : null}</span>
            <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── MiniPlayer: THE player, docked above the tab bar whenever something is loaded. Title, timeline, the
// controls row, and "Up next" (collapsed; the list opens just above the player). Tapping it does NOT navigate.
// `bottom` lets a full-screen overlay (Listen) dock the same player at its own foot, where there is no tab bar.
//
// THE SPACE IT TAKES (audits of e4a17a0 D2, and the device result on 1e0cdbc). A floating player sits over
// the bottom of whatever page is under it. It publishes, as a CSS variable on <html>, the distance from the
// BOTTOM OF THE VIEWPORT TO ITS OWN TOP EDGE (+ a 12px gap) — 0 when nothing is loaded, when it unmounts, or
// when inline — and every scrolling page uses max(its own bottom padding, that). Measuring the top edge, not
// the player's height, is the point: on a phone the player sits above the tab bar AND the gesture-bar
// safe-area inset, and "height + a guessed tab-bar constant" left the last card behind it on the Pixel and
// the Oppo. Re-measured on every render, on resize (rotation, safe-area change) and when the box changes size
// (Up next opened). ScreenScroll (Today, Library + Watch, Community, Plans, Search) and the reader use
// `--trinity-player-h`; Listen, which docks its own copy, passes `heightVar="--trinity-listen-player-h"`.
// `inline` = the desktop layout: the player takes its own row in the layout, covers nothing, publishes 0.
function MiniPlayer({ ctx, bottom, inline, heightVar }) {
  const a = useTrinityAudio();
  const [showQ, setShowQ] = React.useState(false);
  const boxRef = React.useRef(null);
  const cssVar = heightVar || '--trinity-player-h';
  React.useEffect(() => {
    const root = typeof document !== 'undefined' && document.documentElement;
    if (!root || !root.style || typeof root.style.setProperty !== 'function') return undefined;
    const put = () => {
      const box = !inline && boxRef.current;
      const vh = (typeof window !== 'undefined' && window.innerHeight) || 0;
      const top = box && box.getBoundingClientRect ? box.getBoundingClientRect().top : null;
      const d = (box && vh && top != null) ? Math.max(0, Math.ceil(vh - top)) : 0;
      root.style.setProperty(cssVar, (d ? d + 12 : 0) + 'px');
    };
    put();
    let ro = null;
    try { if (boxRef.current && typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(put); ro.observe(boxRef.current); } } catch (e) {}
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    try { if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', put); if (vv && vv.addEventListener) vv.addEventListener('resize', put); } catch (e) {}
    return () => {
      try { if (ro) ro.disconnect(); } catch (e) {}
      try { if (window.removeEventListener) window.removeEventListener('resize', put); if (vv && vv.removeEventListener) vv.removeEventListener('resize', put); } catch (e) {}
      root.style.setProperty(cssVar, '0px');
    };
  });
  if (!a.track || !window.TrinityAudio) return null;
  const A = window.TrinityAudio;
  const hasQ = (a.q || []).length > 1;
  const open = showQ && hasQ;
  const flip = () => { if (hasQ) setShowQ(v => !v); };
  const card = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 18, boxShadow: 'var(--shadow-lg)' };
  const small = { width: 32, height: 32, flexShrink: 0, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, borderRadius: 999 };
  const words = (
    <React.Fragment>
      <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.track.title}</div>
      {a.failed
        ? <div role="status" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--clay)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{'Couldn’t load · press Play to retry'}</div>
        : <div style={{ fontSize: 11.5, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.track.subtitle || ''}</div>}
    </React.Fragment>
  );
  return (
    <div ref={boxRef} role="region" aria-label="Audio player" style={inline ? {
      position: 'relative', width: '100%', maxWidth: 560, margin: '0 auto', padding: '8px 12px 10px', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', gap: 6,
    } : {
      position: 'absolute', left: 12, right: 12, zIndex: 24,
      bottom: bottom || 'calc(max(12px, env(safe-area-inset-bottom)) + 74px)',
      display: 'flex', flexDirection: 'column', gap: 6, animation: 'trinityRise .22s ease both',
    }}>
      {open ? <div style={{ ...card, padding: 6 }}><AudioQueue a={a} /></div> : null}
      <div style={{ ...card, padding: '8px 10px 6px', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, background: a.track.image ? `center/cover url(${a.track.image})` : 'color-mix(in oklab, var(--clay) 14%, var(--surface))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {!a.track.image ? <Icon name="headphones" size={17} color="var(--clay)" /> : null}
          </div>
          {hasQ
            ? <button onClick={flip} aria-label={a.track.title} aria-expanded={open} title={open ? 'Hide up next' : 'Show up next'} style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--font-ui)' }}>{words}</button>
            : <div style={{ flex: 1, minWidth: 0 }}>{words}</div>}
          {hasQ ? <button onClick={flip} aria-label="Up next" aria-expanded={open} title={open ? 'Hide up next' : 'Up next'} style={{ ...small, background: open ? 'var(--surface-2)' : 'none' }}><Icon name="menu" size={17} color="var(--ink-2)" /></button> : null}
          <button onClick={() => A.stop()} aria-label="Close player" title="Close player" style={small}><Icon name="x" size={16} color="var(--ink-3)" /></button>
        </div>
        <AudioScrubber a={a} durationText={a.track.duration} />
        <AudioButtons a={a} />
      </div>
    </div>
  );
}

// ── Audio Bible: public-domain recorded narration (Berean Standard Bible, via the Free Use Bible API) ──
// audio.bible.helloao.org serves a clean per-chapter MP3 (CDN, range-supported). The text the member
// reads is WEB/KJV; this is a companion narration, not a verse-synced reading of that exact translation.
const USFM_ORDER = ('GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER ' +
  'LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL ' +
  '1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV').split(' ');
// Audio sources: BSB streams per-chapter from the Free Use Bible API; WEB is the public-domain World English Bible
// (David Williams's reading, matches the WEB text) downloaded book by book; and any audio Bible the member added
// themselves ("Add your own"). Where the chapters live is app/audio-store.jsx (window.TrinityAudioStore).
const AUDIO_BIBLE_OPTIONS = {
  translations: [{ id: 'BSB', name: 'Berean Standard', stream: true }, { id: 'WEB', name: 'World English', local: true }],
  readers: [{ id: 'david', name: 'David' }, { id: 'hays', name: 'Hays' }, { id: 'souer', name: 'Souer' }],
};
const transName = (id) => (AUDIO_BIBLE_OPTIONS.translations.find(t => t.id === id) || {}).name || id;
// the member's own audio Bibles that are finished (READY) — a pending import is never offered
function audioOwnSets() {
  const S = window.TrinityAudioStore;
  try { return S ? S.readySets().filter(r => r.source === 'own') : []; } catch (e) { return []; }
}
// The saved choice is "<translation or set id>/<reader>". It is checked against the built-ins plus the registry's READY
// sets; anything else (a removed set, a half-imported one, junk) falls back to Berean Standard / David.
function getAudioChoice() {
  let v = 'BSB/david'; try { if (typeof lsGet === 'function') v = lsGet('trinityone.audioVoice', 'BSB/david') || 'BSB/david'; } catch (e) {}
  const [t, r] = String(v).split('/');
  const set = audioOwnSets().find(x => x.id === t) || null;
  const translation = (AUDIO_BIBLE_OPTIONS.translations.some(x => x.id === t) || set) ? t : 'BSB';
  const reader = AUDIO_BIBLE_OPTIONS.readers.some(x => x.id === r) ? r : 'david';
  return { translation, reader, set };
}
const audioMB = (bytes) => { const mb = (bytes || 0) / 1048576; return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.max(1, Math.round(mb)) + ' MB'; };
// every audio Bible the Reading settings sheet lists, each with its own caption
function audioBibleChoices() {
  return [
    { id: 'BSB', name: 'Berean Standard', stream: true, caption: 'Streams from helloao.org · public-domain narration. They can see which chapter you listen to.' },
    { id: 'WEB', name: 'World English', caption: 'Read by David Williams · public domain · matches the WEB text. Download books in Library → Audio Bibles; until then, Listen plays Berean Standard.' },
    ...audioOwnSets().map(s => ({ id: s.id, name: s.name || 'My audio Bible', own: true,
      caption: [s.reader ? 'Read by ' + s.reader : '', s.lang || '', (s.chapters || 0) + ' chapters', s.bytes ? audioMB(s.bytes) : '', 'on this phone'].filter(Boolean).join(' · ') + '. Chapters it doesn\u2019t have play in Berean Standard.' })),
  ];
}
// BSB streaming track (per-chapter MP3 on the helloao CDN)
function bsbChapterTrack(bookNum, chap, reader) {
  const code = USFM_ORDER[bookNum - 1]; if (!code) return null;
  const label = (window.Bible && window.Bible.bookName) ? window.Bible.bookName(bookNum) : ('Book ' + bookNum);
  return { id: 'bible:' + bookNum + ':' + chap, title: label + ' ' + chap, subtitle: 'Audio Bible · Berean Standard',
    src: 'https://audio.bible.helloao.org/api/BSB/' + code + '/' + chap + '/audio/' + (reader || 'david') + '.mp3', album: 'Audio Bible' };
}
// A chapter stored on this device. No src: the engine calls resolve() when its turn comes (the chapter is read into memory
// then, one at a time) and lets the blob address go when it moves on — `bibleLocal` is what allows that (engine P1).
function bibleLocalTrack(setId, setName, bookNum, chap, label) {
  return { id: 'bible:' + bookNum + ':' + chap, title: label + ' ' + chap, subtitle: 'Audio Bible · ' + setName, album: 'Audio Bible', bibleLocal: true, setId,
    resolve: () => window.TrinityAudioStore.chapterUrl(setId, bookNum, chap) };
}

// ── World English: the manifest, and the existing download (still through /audiozip — unchanged in Build 1) ──
let _webManifest = null;
async function getWebManifest() {
  if (_webManifest) return _webManifest;
  try { const r = await fetch('web-audio-manifest.json'); _webManifest = await r.json(); } catch (e) { _webManifest = { chapters: {} }; }
  return _webManifest;
}
// how much of a book is on this device (both stores while World English is moving into file storage)
async function webBookState(book) {
  const man = await getWebManifest(); const bk = man.chapters[String(book)]; if (!bk) return { total: 0, have: 0 };
  const want = Object.keys(bk).map(Number);
  const got = new Set((await window.TrinityAudioStore.listBook('WEB', book)).map(x => x.chap));
  return { total: want.length, have: want.filter(c => got.has(c)).length };
}
// "Downloaded" = EVERY chapter the manifest lists for that book is here. One chapter used to be enough, so a book whose
// download was stopped part-way said "Downloaded" and offered only the bin.
async function webDownloadedBooks() {
  const man = await getWebManifest(); const all = await window.TrinityAudioStore.listAll('WEB'); const s = new Set();
  for (const b of Object.keys(man.chapters || {})) {
    const want = Object.keys(man.chapters[b] || {}).map(Number); const have = all.get(+b);
    if (want.length && have && want.every(c => have.has(c))) s.add(+b);
  }
  return s;
}
async function removeWebBook(book) { await window.TrinityAudioStore.removeWebBook(book); }
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
  const S = window.TrinityAudioStore;
  const man = await getWebManifest(); const bk = man.chapters[String(book)]; if (!bk) throw new Error('no such book');
  try { if (S.ensureGate) await S.ensureGate(); } catch (e) {}   // iOS: a closed gate is tried once more before choosing the store
  const base = await pickAudioBase();
  if (!base) throw new Error('No download server reachable — your church relay needs updating');
  const t = book <= 39 ? 'ot' : 'nt';
  const chaps = Object.keys(bk).map(Number).sort((a, b) => a - b);
  for (let i = 0; i < chaps.length; i++) {
    if (getAborted && getAborted()) throw new Error('cancelled');
    const c = chaps[i];
    if (!(await S.hasChapter('WEB', book, c))) {   // B4: "already have it?" reads BOTH stores, so a moved chapter is not fetched again
      const [off, csize] = bk[String(c)];
      const r = await fetch(base + '/audiozip?t=' + t + '&start=' + off + '&len=' + (csize + 96));
      if (!r.ok) throw new Error('download failed');
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('bad chunk');   // 'PK'
      const nlen = buf[26] | (buf[27] << 8), elen = buf[28] | (buf[29] << 8), ds = 30 + nlen + elen;
      const mp3 = window.fflate.inflateSync(buf.subarray(ds, ds + csize));
      await S.putWebChapter(book, c, mp3);   // M4: app file storage on Android, IndexedDB elsewhere
    }
    if (onProgress) onProgress(i + 1, chaps.length);
  }
  return true;
}

// play a chapter — World English or one of the member's own audio Bibles if chosen and that chapter is here, else the
// BSB stream; queues the book (the chapters this device has) so it auto-advances
async function playBibleChapter(bookNum, chap) {
  if (!window.TrinityAudio || !USFM_ORDER[bookNum - 1]) return false;
  const { translation, reader, set } = getAudioChoice();
  const max = (window.Bible && window.Bible.maxChapter) ? (window.Bible.maxChapter(bookNum) || chap) : chap;
  const label = (window.Bible && window.Bible.bookName) ? window.Bible.bookName(bookNum) : ('Book ' + bookNum);
  if (translation !== 'BSB') {
    const S = window.TrinityAudioStore;
    const name = set ? (set.name || 'My audio Bible') : transName(translation);
    let have = [];
    try { have = S ? await S.listBook(translation, bookNum) : []; } catch (e) { have = []; }
    if (have.some(x => x.chap === chap)) {
      const queue = have.map(x => bibleLocalTrack(translation, name, bookNum, x.chap, label));
      const track = queue.find(t => t.id === 'bible:' + bookNum + ':' + chap);
      window.TrinityAudio.play(track, queue); return true;
    }
    if (window.trinityToast) window.trinityToast(translation === 'WEB'
      ? 'Download this book in Library to hear the World English audio — playing Berean Standard for now'
      : name + ' has no recording of ' + label + ' ' + chap + ' — playing Berean Standard for now');
  }
  const queue = []; for (let c = 1; c <= max; c++) { const t = bsbChapterTrack(bookNum, c, reader); if (t) queue.push(t); }
  const track = bsbChapterTrack(bookNum, chap, reader);
  if (!track) return false;
  window.TrinityAudio.play(track, queue);
  return true;
}

// ── "Add your own": the progress sheet, the check screen and the name screen (plan N4) ──
const AUDIO_IMPORT_WORDS = {
  'too-many': 'That zip has more than 5,000 files in it.',
  'entry-too-big': 'One file in it is bigger than 64 MB.',
  'too-big': 'It holds more than 3 GB of audio.',
  'over-4gb': 'Zips over 4 GB can\u2019t be read yet.',
  'stored-descriptor': 'That zip was made in a way TrinityOne can\u2019t read yet. Zip the files again and try once more.',
  broken: 'That zip is damaged or incomplete.',
  'no-space': 'There isn\u2019t enough room on this device.',
  'no-registry': 'TrinityOne couldn\u2019t save its list of audio Bibles.',
  none: 'No audio files were found in it.',
  failed: 'Something went wrong reading it.',
};
// one picked file (or the open-with hand-over) as a source the store can stream: never arrayBuffer() on the whole file
function audioPickedSource(f) {
  return { name: (f && f.name) || '', head: [], reader: (f && typeof f.stream === 'function') ? f.stream().getReader() : null };
}

function AudioImportPanel({ imp, setImp, abortRef, onDone, ctx }) {
  const S = window.TrinityAudioStore;
  const books = (window.Bible && window.Bible.bookMeta) ? window.Bible.bookMeta().filter(b => b.num <= 66) : [];
  const nameOf = (n) => { const b = books.find(x => x.num === n); return b ? b.name : (window.Bible && window.Bible.bookName ? window.Bible.bookName(n) : 'Book ' + n); };
  const [where, setWhere] = React.useState({});            // n -> {book, chap}
  const [ask, setAsk] = React.useState(null);              // n waiting for "replace?"
  const [form, setForm] = React.useState({ name: '', lang: 'English', reader: '', licence: 'own' });
  const [saving, setSaving] = React.useState(false);
  // Cancel always frees the screen at once (round-5 R5-2): while reading, the import is told to stop and cleans up behind
  // it; the panel does not wait for it
  const cancel = async () => { if (imp.phase === 'reading') { abortRef.current = true; setImp(null); return; } if (imp.id) await S.cancelImport(imp.id); setImp(null); };
  const btn = (primary) => ({ flex: 1, padding: '12px', borderRadius: 13, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 14, border: primary ? 'none' : '1px solid var(--line)', background: primary ? 'var(--clay)' : 'var(--surface)', color: primary ? 'var(--on-clay)' : 'var(--ink-2)' });
  const field = { width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'var(--font-ui)', fontSize: 14.5, marginBottom: 12 };
  const lbl = { fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6, display: 'block' };
  const card = { border: '1px solid var(--line)', borderRadius: 16, background: 'var(--surface)', padding: 16, marginBottom: 16 };
  const place = async (u, replace) => {
    const w = where[u.n] || {};
    const r = await S.placeUnplaced(imp.id, u.n, w.book, w.chap, { replace: !!replace });
    if (r.exists) { setAsk(u.n); return; }
    setAsk(null);
    if (!r.ok) { ctx && ctx.toast && ctx.toast('Pick a book and a chapter it has'); return; }
    setImp({ ...imp, res: { ...imp.res, chapters: imp.res.chapters + (replace ? 0 : 1), unplaced: imp.res.unplaced.filter(x => x.n !== u.n) } });
  };
  const leave = async (u) => { await S.leaveOut(imp.id, u.n); setAsk(null); setImp({ ...imp, res: { ...imp.res, unplaced: imp.res.unplaced.filter(x => x.n !== u.n) } }); };
  const save = async () => {
    if (saving) return; setSaving(true);
    const r = await S.finishImport(imp.id, form);
    setSaving(false);
    if (!r.ok) { setImp({ phase: 'error', reason: r.reason === 'empty' ? 'none' : (r.reason || 'failed') }); await S.cancelImport(imp.id); return; }
    setImp(null);
    if (ctx && ctx.toast) ctx.toast('Added \u201c' + (form.name.trim() || 'My audio Bible') + '\u201d · choose it in Read → Settings');
    onDone && onDone();
  };

  if (imp.phase === 'reading') {
    const p = imp.p || {};
    return (
      <div role="status" style={card}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Adding your audio Bible…</div>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginBottom: 14 }}>{(p.chapters || 0) + ' chapters found so far' + (p.bytes ? ' · ' + audioMB(p.bytes) + ' read' : '')}. Keep TrinityOne open.</div>
        <div style={{ display: 'flex', gap: 8 }}><button onClick={cancel} style={btn(false)}>Cancel</button></div>
      </div>
    );
  }
  if (imp.phase === 'error') {
    return (
      <div role="alert" style={card}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, marginBottom: 6 }}>{'That couldn\u2019t be added'}</div>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginBottom: 14 }}>{(AUDIO_IMPORT_WORDS[imp.reason] || AUDIO_IMPORT_WORDS.failed) + ' Nothing was added.'}</div>
        <div style={{ display: 'flex', gap: 8 }}><button onClick={() => setImp(null)} style={btn(true)}>OK</button></div>
      </div>
    );
  }
  const res = imp.res || { chapters: 0, books: 0, unplaced: [] };
  if (imp.phase === 'check') {
    return (
      <div style={card}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Check what was found</div>
        <div data-audio-found="" style={{ fontSize: 13.5, color: 'var(--ink-2)', marginBottom: 12 }}>{'Found ' + res.chapters.toLocaleString('en-GB') + ' chapters across ' + res.books + ' books' + (res.unplaced.length ? ' · ' + res.unplaced.length + ' not recognised' : '')}</div>
        {res.unplaced.map(u => {
          const w = where[u.n] || {};
          const max = w.book ? (S.CHAPTERS[w.book - 1] || 1) : 1;
          return (
            <div key={u.n} data-unplaced={u.n} style={{ borderTop: '1px solid var(--line-2)', padding: '10px 0' }}>
              <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--ink)', overflowWrap: 'anywhere', marginBottom: 8 }}>{u.name || 'Unnamed file'}</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <select aria-label="Book" value={w.book || ''} onChange={(e) => setWhere({ ...where, [u.n]: { book: +e.target.value || null, chap: 1 } })} style={{ ...field, marginBottom: 0, flex: '2 1 140px', width: 'auto' }}>
                  <option value="">Book…</option>
                  {books.map(b => <option key={b.num} value={b.num}>{b.name}</option>)}
                </select>
                <input aria-label="Chapter" type="number" min={1} max={max} value={w.chap || ''} onChange={(e) => setWhere({ ...where, [u.n]: { ...w, chap: +e.target.value || null } })} style={{ ...field, marginBottom: 0, flex: '1 1 70px', width: 'auto' }} />
              </div>
              {ask === u.n ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: 'var(--ink-2)', flex: '1 1 100%' }}>{nameOf(w.book) + ' ' + w.chap + ' is already there. Replace it with this file?'}</span>
                  <button onClick={() => place(u, true)} style={btn(true)}>Replace</button>
                  <button onClick={() => setAsk(null)} style={btn(false)}>Keep the one there</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => place(u, false)} disabled={!w.book || !w.chap} style={{ ...btn(true), opacity: (w.book && w.chap) ? 1 : 0.5 }}>Place</button>
                  <button onClick={() => leave(u)} style={btn(false)}>Leave out</button>
                </div>
              )}
            </div>
          );
        })}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={cancel} style={btn(false)}>Cancel</button>
          <button onClick={() => setImp({ ...imp, phase: 'name' })} style={btn(true)}>Next</button>
        </div>
      </div>
    );
  }
  // name
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const lic = (v, words) => (
    <button key={v} role="radio" aria-checked={form.licence === v} onClick={() => setForm({ ...form, licence: v })}
      style={{ flex: 1, padding: '10px', borderRadius: 12, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13, border: form.licence === v ? '2px solid var(--clay)' : '1px solid var(--line)', background: form.licence === v ? 'var(--clay-soft)' : 'var(--surface-2)', color: form.licence === v ? 'var(--clay-ink)' : 'var(--ink-2)' }}>{words}</button>
  );
  return (
    <div style={card}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Name it</div>
      <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginBottom: 12 }}>{res.chapters.toLocaleString('en-GB') + ' chapters across ' + res.books + ' books.'}</div>
      <label style={lbl}>Name<input aria-label="Name" value={form.name} onChange={set('name')} placeholder="World English, read by…" style={{ ...field, marginTop: 6 }} /></label>
      <label style={lbl}>Language<input aria-label="Language" value={form.lang} onChange={set('lang')} style={{ ...field, marginTop: 6 }} /></label>
      <label style={lbl}>Reader<input aria-label="Reader" value={form.reader} onChange={set('reader')} style={{ ...field, marginTop: 6 }} /></label>
      <div style={lbl}>Where it came from</div>
      <div role="radiogroup" aria-label="Where it came from" style={{ display: 'flex', gap: 8, marginBottom: 14 }}>{lic('own', 'My own copy')}{lic('free', 'Free licence')}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={cancel} style={btn(false)}>Cancel</button>
        <button onClick={save} disabled={saving} style={btn(true)}>Save</button>
      </div>
    </div>
  );
}

// ── Audio Bibles library: your own audio Bibles, and World English per book for offline listening ──
// `incoming` = a stream handed over by "Open with TrinityOne" (install-bible.jsx peeked and saw audio): {head, reader}.
function AudioBiblesScreen({ open, onClose, ctx, incoming, onIncomingTaken }) {
  const [man, setMan] = React.useState(null);
  const [done, setDone] = React.useState(new Set());     // books fully downloaded
  const [prog, setProg] = React.useState({});            // book -> {have,total}
  const [busy, setBusy] = React.useState(null);          // 'book:N' | 'nt' | 'ot' | null
  const [own, setOwn] = React.useState(() => audioOwnSets());
  const [imp, setImp] = React.useState(null);            // the "Add your own" flow, or null
  const abort = React.useRef(false);
  const impAbort = React.useRef(false);
  const pickRef = React.useRef(null);
  const refresh = async () => { setDone(new Set(await window.TrinityAudioBible.webDownloadedBooks())); };
  React.useEffect(() => { if (!open) return; window.TrinityAudioBible.getWebManifest().then(setMan); refresh(); setOwn(audioOwnSets()); }, [open]);
  // ONE IMPORT AT A TIME, AND IT SHOWS AT ONCE (audit #2): the progress panel goes up (and "Add your own" is disabled)
  // before anything is awaited; the store then waits only for the boot sweep, never for World English moving.
  const importing = React.useRef(false);
  const startImport = async (sources) => {
    const S = window.TrinityAudioStore;
    if (!S || importing.current) return false;
    importing.current = true; impAbort.current = false;
    setImp({ phase: 'reading', id: null, p: {} });
    try {
      let id = null;
      try { id = await S.beginImport(); } catch (e) { setImp({ phase: 'error', reason: 'no-registry' }); return true; }
      setImp(x => (x && x.phase === 'reading' ? { ...x, id } : x));
      const res = await S.importSources(id, sources, { onProgress: (p) => setImp(x => (x && x.phase === 'reading' ? { ...x, p } : x)), getAborted: () => impAbort.current });
      if (res.ok && impAbort.current) { await S.cancelImport(id); setImp(null); return true; }   // cancelled just as it finished
      if (!res.ok) { setImp(res.reason === 'cancelled' ? null : { phase: 'error', reason: res.reason }); return true; }
      if (!res.chapters && !res.unplaced.length) { await S.cancelImport(id); setImp({ phase: 'error', reason: 'none' }); return true; }
      setImp({ phase: res.unplaced.length ? 'check' : 'name', id, res });
      return true;
    } finally { importing.current = false; }
  };
  React.useEffect(() => {
    if (!open || !incoming) return;
    if (onIncomingTaken) onIncomingTaken();
    // one import at a time: a second file handed over mid-import is let go (its stream closed), not queued
    if (imp || importing.current) { try { if (incoming.reader && incoming.reader.cancel) incoming.reader.cancel(); } catch (e) {} if (ctx && ctx.toast) ctx.toast('Finish adding the audio Bible you started first'); return; }
    startImport([{ name: '', head: incoming.head || [], reader: incoming.reader }]);
  }, [open, incoming]);
  const onPicked = (e) => {
    const files = [...((e && e.target && e.target.files) || [])];
    try { e.target.value = ''; } catch (x) {}
    if (files.length) startImport(files.map(audioPickedSource));
  };
  // Remove asks first (audit #10): the files can only come back from wherever the member got them
  const [askRm, setAskRm] = React.useState(null);
  const removeOwn = async (s) => {
    setAskRm(null);
    // the set being removed may be the one playing: stop it rather than leave Next pointing at deleted files
    try { const cur = window.TrinityAudio && window.TrinityAudio.current; if (cur && cur.bibleLocal && cur.setId === s.id) window.TrinityAudio.stop(); } catch (e) {}
    const r = await window.TrinityAudioStore.removeSet(s.id);
    setOwn(audioOwnSets());
    if (r && r.ok && ctx && ctx.toast) ctx.toast('Removed \u201c' + (s.name || 'My audio Bible') + '\u201d · ' + audioMB(r.bytes) + ' freed');
  };
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
  const headBtn = (which, label) => <button onClick={() => (busy ? stop() : all(which))} style={{ flex: 1, padding: '11px', borderRadius: 13, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13.5, background: busy === which ? 'var(--clay-deep)' : 'var(--clay)', color: 'var(--on-clay)' }}>{busy === which ? 'Stop' : label}</button>;
  const row = (b) => {
    const isDone = done.has(b.num); const p = prog[b.num]; const downloading = busy === 'book:' + b.num || (busy && busy.indexOf('book:') !== 0 && p);
    return (
      <div key={b.num} data-book={b.num} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 4px', borderBottom: '1px solid var(--line-2)' }}>
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
  const ownRow = (s) => (
    <div key={s.id} data-own-set={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 4px', borderBottom: '1px solid var(--line-2)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--ink)', overflowWrap: 'anywhere' }}>{s.name || 'My audio Bible'}</div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{[s.reader, s.lang, (s.chapters || 0) + ' chapters', audioMB(s.bytes), s.licence === 'free' ? 'free licence' : 'my own copy'].filter(Boolean).join(' · ')}</div>
      </div>
      <button onClick={() => setAskRm(s)} aria-label={'Remove ' + (s.name || 'My audio Bible')} title="Remove" style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 9, padding: '6px 8px', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}><Icon name="trash" size={15} color="currentColor" /></button>
    </div>
  );
  return (
    <Overlay open={open} onClose={onClose}>
      <div style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)', flexShrink: 0, background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px 12px' }}>
          <IconBtn name="chevL" onClick={onClose} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 21, fontWeight: 700 }}>Audio Bibles</h1>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Your own recordings · World English (public domain)</div>
          </div>
        </div>
      </div>
      <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 18px 40px' }}>
        {askRm ? (
          <div role="alertdialog" aria-label="Remove audio Bible" style={{ border: '1px solid var(--line)', borderRadius: 16, background: 'var(--surface)', padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 14.5, color: 'var(--ink)', lineHeight: 1.5, marginBottom: 12, overflowWrap: 'anywhere' }}>{'Remove ' + (askRm.name || 'My audio Bible') + '? This frees ' + audioMB(askRm.bytes) + '; you\u2019d need the files again to re-add it.'}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setAskRm(null)} style={{ flex: 1, padding: '12px', borderRadius: 13, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 14, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink-2)' }}>Cancel</button>
              <button onClick={() => removeOwn(askRm)} style={{ flex: 1, padding: '12px', borderRadius: 13, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 14, border: 'none', background: 'var(--clay)', color: 'var(--on-clay)' }}>Remove</button>
            </div>
          </div>
        ) : null}
        {imp ? <AudioImportPanel imp={imp} setImp={setImp} abortRef={impAbort} onDone={() => setOwn(audioOwnSets())} ctx={ctx} /> : null}
        <SectionLabel>Your audio Bibles</SectionLabel>
        <div style={{ marginBottom: 12 }}>{own.map(ownRow)}</div>
        <input ref={pickRef} type="file" multiple accept=".zip,audio/*" onChange={onPicked} style={{ display: 'none' }} data-audio-pick="" />
        <button onClick={() => { if (!imp && pickRef.current && pickRef.current.click) pickRef.current.click(); }} disabled={!!imp}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '13px 14px', borderRadius: 14, border: '1px dashed var(--line)', background: 'var(--surface-2)', cursor: imp ? 'default' : 'pointer', opacity: imp ? 0.5 : 1, color: 'var(--clay)', fontWeight: 700, fontSize: 14, fontFamily: 'var(--font-ui)', marginBottom: 6 }}>
          <Icon name="plus" size={18} /> Add your own
        </button>
        <p style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5, margin: '0 0 20px' }}>A .zip of chapter recordings, or several audio files. Only add recordings you own or that have a free licence.</p>
        <SectionLabel>World English</SectionLabel>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 16px' }}>Read by David Williams, public domain. Download books to listen offline — this matches the WEB text you read. Large files; Wi-Fi recommended. Set <b>World English</b> as your Audio Bible in Read → Settings.</p>
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
window.sermonAudioTrack = sermonAudioTrack;
window.audioFmtTime = fmtTime;
window.playBibleChapter = playBibleChapter;
window.bibleChapterTrackId = (b, c) => 'bible:' + b + ':' + c;
window.AUDIO_BIBLE_OPTIONS = AUDIO_BIBLE_OPTIONS;
window.getAudioChoice = getAudioChoice;
window.audioBibleChoices = audioBibleChoices;
window.TrinityAudioBible = { getWebManifest, downloadWebBook, removeWebBook, webBookState, webDownloadedBooks };
