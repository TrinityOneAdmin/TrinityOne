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

window.MiniPlayer = MiniPlayer;
window.useTrinityAudio = useTrinityAudio;
window.audioFmtTime = fmtTime;
