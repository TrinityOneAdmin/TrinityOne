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

  // RECOVERY (plan 2026-11-18, Fix 1). A network cut used to leave the element dead: `error`, then `pause`, and
  // Play called el.play() on an element that never fetches again. Now a streamed (http/https) track retries by
  // itself at these delays and then shows "Couldn't load"; Play, return-to-the-app and a seek reload it in place.
  // TEST HOOK (documented): window.__TRINITY_AUDIO_TEST__ = { retryMs: [..], stallMs: n }, read ONCE when this
  // engine starts, shortens the schedule for scripts/the-audio-player-recovers-in-a-browser.test.mjs. The
  // shipped defaults are asserted by scripts/the-audio-player-recovers.test.mjs through api.retrySchedule.
  const HOOK = (window.__TRINITY_AUDIO_TEST__ && typeof window.__TRINITY_AUDIO_TEST__ === 'object') ? window.__TRINITY_AUDIO_TEST__ : {};
  const RETRY_MS = Array.isArray(HOOK.retryMs) && HOOK.retryMs.length ? HOOK.retryMs.slice() : [2000, 5000, 15000, 30000];
  const STALL_MS = HOOK.stallMs > 0 ? HOOK.stallMs : 45000;   // no progress for this long while meant to be advancing = an error

  let queue = [], qi = -1, playTok = 0, pending = false;   // pending = a queued track is still being fetched: the element holds NO source
  // wantPlay: the listener wants sound. Set by play()/resume(); cleared by pause(), stop(), the end of the queue, a
  // NotAllowedError from play(). NEVER by the element's own `pause` event: Chromium fires that before `ended`
  // and after `error`, and clearing it there would turn off both auto-advance and recovery.
  let wantPlay = false, resumeAt = 0, attempts = 0;
  let retryTimer = null, stallTimer = null, seekOnLoad = null, firstLoad = false;
  let state = { track: null, playing: false, loading: false, failed: false, retrying: false, t: 0, d: 0, rate, q: queue, qi };
  const subs = new Set();
  const emit = () => { state = { ...state }; subs.forEach(fn => { try { fn(state); } catch (e) {} }); };
  const set = (p) => { Object.assign(state, p); emit(); };
  // which tracks retry by themselves: streamed ones (https:, and http: for the local dev gateway). A blob: that
  // errors is bad data, not the network, so it goes straight to "Couldn't load".
  const isNet = (src) => /^https?:/i.test(String(src || ''));
  const errored = () => !!(el.error || state.retrying || state.failed);

  const clearSeek = () => { if (seekOnLoad) { try { el.removeEventListener('loadedmetadata', seekOnLoad); } catch (e) {} seekOnLoad = null; } };
  const cancelRetry = () => { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } clearSeek(); };
  const disarm = () => { if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; } };
  // the no-progress guard: armed only while the element is meant to be advancing (or waiting for the first
  // canplay of a load this engine started), never during a resolve() download, never for a blob.
  const shouldArm = () => !!(wantPlay && !pending && !retryTimer && state.track && isNet(state.track.src) && (!el.paused || firstLoad));
  const rearm = () => { disarm(); if (shouldArm()) stallTimer = setTimeout(onStall, STALL_MS); };
  const arm = () => { if (!stallTimer) rearm(); else if (!shouldArm()) disarm(); };
  function onStall() { stallTimer = null; if (shouldArm()) onFail(); }

  // a pending play() promise rejects with AbortError on every reload and NotSupportedError when the load fails
  // (the `error` event handles that one). Only NotAllowedError means "the browser will not play this": stop wanting.
  const onPlayReject = (tok) => (e) => {
    if (tok !== playTok) return;
    if (e && e.name === 'NotAllowedError') { wantPlay = false; disarm(); set({ playing: false, loading: false, retrying: false }); osSync(); }
  };

  // reload the CURRENT element in place. Assigning `src` runs the load algorithm even for the same value, and
  // nothing else here does: start()'s same-src guard is exactly why Play was dead after an error. No el.load()
  // after it: that would abort the load the assignment just began.
  function reloadEl(track, at) {
    const tok = playTok;
    cancelRetry();
    if (at > 0) {
      seekOnLoad = () => { clearSeek(); if (tok !== playTok) return; try { el.currentTime = at; } catch (e) {} };
      el.addEventListener('loadedmetadata', seekOnLoad);
    }
    el.src = track.src;
    applyRate();
    firstLoad = true; rearm();
    el.play().then(() => { if (tok === playTok) set({ playing: true, loading: false }); }).catch(onPlayReject(tok));
  }
  // "retry now": Play on an errored/failed track, resume() from the OS, return-to-app, a seek while errored.
  function retryNow() {
    const track = state.track; if (!track) return;
    cancelRetry(); disarm();
    attempts = 0; wantPlay = true;
    osTap();   // retry-now is a tap or a return to the app: the foreground
    if (track.src && typeof track.resolve === 'function' && !isNet(track.src)) {
      // a resolved blob (a sermon, a local chapter) that broke: drop it and resolve once more, at the position
      delete track.src; begin(track, queue, resumeAt); return;
    }
    if (!track.src) { begin(track, queue, resumeAt); return; }   // its resolve() failed: try the download once more
    set({ failed: false, retrying: true, loading: true, playing: true });
    reloadEl(track, resumeAt);   // a stream, or a blob with nothing to rebuild it from (reused on purpose)
  }
  // the element failed (an `error`, or the no-progress guard)
  function onFail() {
    if (!state.track || pending) return;
    cancelRetry(); disarm(); firstLoad = false;
    if (!wantPlay) { set({ loading: false, playing: false, retrying: false }); return; }   // Play will reload it
    if (isNet(state.track.src) && attempts < RETRY_MS.length) {
      const tok = playTok, wait = RETRY_MS[attempts++];
      set({ failed: false, retrying: true, loading: true, playing: true });
      retryTimer = setTimeout(() => { retryTimer = null; if (tok !== playTok || !wantPlay || !state.track) return; reloadEl(state.track, resumeAt); }, wait);
      return;
    }
    set({ failed: true, retrying: false, loading: false, playing: false });   // wantPlay stays: return-to-app may retry
    osSync();
  }

  el.addEventListener('timeupdate', () => { if (el.currentTime > 0) resumeAt = el.currentTime; set({ t: el.currentTime, d: el.duration || 0 }); rearm(); });
  el.addEventListener('progress', rearm);
  el.addEventListener('loadeddata', rearm);
  el.addEventListener('canplay', () => { firstLoad = false; rearm(); });
  el.addEventListener('loadstart', applyRate);
  el.addEventListener('durationchange', () => { set({ d: el.duration || 0 }); osPos(); });
  el.addEventListener('seeked', osPos);
  el.addEventListener('ratechange', osPos);
  el.addEventListener('play', () => { set({ playing: true }); arm(); osPos(); });
  el.addEventListener('pause', () => { if (!state.retrying) set({ playing: false }); arm(); osPos(); });
  el.addEventListener('waiting', () => { set({ loading: true }); arm(); });
  el.addEventListener('playing', () => { if (state.retrying) { cancelRetry(); attempts = 0; } set({ loading: false, playing: true, retrying: false, failed: false }); firstLoad = false; rearm(); });
  el.addEventListener('ended', () => {
    set({ playing: false });
    if (api.hasNext()) { begin(queue[qi + 1], queue, 0, true); return; }
    wantPlay = false; disarm();   // the end of the queue: nothing more is wanted
    osSend('none');
  });
  el.addEventListener('error', onFail);

  // back in the app (the native signal, and visibilitychange for the web and the PWA): a stream that is waiting
  // to retry, or has given up, retries now. Never navigator.onLine.
  const onReturn = () => {
    const t = state.track;
    if (!wantPlay || !t || pending || !isNet(t.src)) return;
    if (retryTimer || state.failed || el.error) retryNow();
  };
  try {
    const AppP = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (AppP && AppP.addListener) Promise.resolve(AppP.addListener('appStateChange', (s) => { if (s && s.isActive) onReturn(); })).catch(() => {});
  } catch (e) {}
  try { if (document.addEventListener) document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onReturn(); }); } catch (e) {}

  // ── OS CONTROLS (plan 2026-11-18, Fix 2). On Android the vendored plugin (native/trinity-media-session) draws the
  // notification and the lock-screen card, takes Bluetooth / headset buttons, and runs the mediaPlayback foreground
  // service that keeps playback alive with the screen off. Elsewhere (iOS, the web, desktop) navigator.mediaSession
  // does what it can. The plugin object is read synchronously, here, and never returned from an async function (a
  // Capacitor plugin proxy returned from one is awaited as a thenable and hangs).
  const MSP = (() => { try { const C = window.Capacitor; return (C && typeof C.isPluginAvailable === 'function' && C.isPluginAvailable('MediaSession') && C.Plugins && C.Plugins.MediaSession) || null; } catch (e) { return null; } })();
  const NAV = (!MSP && typeof navigator !== 'undefined' && navigator && navigator.mediaSession) ? navigator.mediaSession : null;
  // the app icon, pre-encoded (96 px): the plugin takes ONLY data: artwork, and metadata always carries some
  const APP_ICON = 'data:image/jpeg;base64,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';
  const PAUSED_TO_NONE_MS = 10 * 60000;   // owner's choice: after 10 minutes paused the card and the service go
  let osState = 'none', osPausedTimer = null;
  const quiet = (p) => { try { if (p && typeof p.catch === 'function') p.catch(() => {}); } catch (e) {} };
  function osSend(st) {
    if (st === osState) return;
    osState = st;
    if (osPausedTimer) { clearTimeout(osPausedTimer); osPausedTimer = null; }
    if (st === 'paused') osPausedTimer = setTimeout(() => { osPausedTimer = null; if (osState === 'paused') osSend('none'); }, PAUSED_TO_NONE_MS);
    if (MSP) {
      try {
        const p = MSP.setPlaybackState({ playbackState: st });
        // a refused foreground start (Android 12+ from the background): this track has no OS controls and no
        // keep-awake; back to 'none' so the listener's next tap tries the service again
        if (st === 'playing') { if (p && typeof p.catch === 'function') p.catch(() => { if (osState === 'playing') osState = 'none'; }); }
        else quiet(p);
      } catch (e) { if (st === 'playing') osState = 'none'; }
    } else if (NAV) { try { NAV.playbackState = st; } catch (e) {} }
  }
  // the FIRST 'playing' after 'none' is sent only from here: inside api.play()/resume()/retry-now (the listener's
  // tap) or the return-to-app retry, i.e. with the app in the foreground. Never from a media event.
  function osTap() { osSend('playing'); osPos(); }
  // every later change comes from events, and never moves the OS out of 'none'. 'playing' is held while the
  // listener wants sound: loading, retrying, and between chapters.
  function osSync() {
    if (osState === 'none' || !state.track) return;
    osSend(state.failed ? 'paused' : (wantPlay ? 'playing' : 'paused'));
  }
  function osMeta(track) {
    if (MSP) {
      const img = (track.image && /^data:/i.test(String(track.image))) ? String(track.image) : APP_ICON;
      const type = (/^data:([^;,]+)/.exec(img) || [])[1] || 'image/jpeg';
      try { quiet(MSP.setMetadata({ title: track.title || '', artist: track.subtitle || '', album: track.album || 'TrinityOne', artwork: [{ src: img, sizes: '96x96', type }] })); } catch (e) {}
      return;
    }
    if (NAV && typeof MediaMetadata !== 'undefined') {
      try { NAV.metadata = new MediaMetadata({ title: track.title || '', artist: track.subtitle || '', album: track.album || 'TrinityOne',
        artwork: track.image ? [{ src: track.image, sizes: '512x512', type: 'image/png' }] : [] }); } catch (e) {}
    }
  }
  // on play, pause, seek, rate change and duration change only: never on timeupdate (4 Hz over the bridge)
  function osPos() {
    const d = el.duration;
    if (!(d > 0) || !isFinite(d)) return;
    const o = { duration: d, position: Math.max(0, Math.min(d, el.currentTime || 0)), playbackRate: rate };
    if (MSP) { try { quiet(MSP.setPositionState(o)); } catch (e) {} }
    else if (NAV && typeof NAV.setPositionState === 'function') { try { NAV.setPositionState(o); } catch (e) {} }
  }
  // explicit play and pause, never toggle: a "pause" that arrives while paused (headphones out, a car) must not start sound
  const OS_ACTIONS = {
    play: () => api.resume(),
    pause: () => api.pause(),
    seekbackward: (d) => api.seek(-((d && d.seekOffset) || 10)),
    seekforward: (d) => api.seek((d && d.seekOffset) || 10),
    seekto: (d) => { if (d && d.seekTime != null) seekAbs(Number(d.seekTime)); },
    previoustrack: () => api.prev(),
    nexttrack: () => api.next(),
    stop: () => api.stop(),
  };
  // registered ONCE, when the engine starts (they used to be re-registered on every track; on the plugin each one
  // keeps a native call alive and rebuilds the notification)
  function registerOsActions() {
    Object.keys(OS_ACTIONS).forEach(a => {
      const run = (d) => { try { OS_ACTIONS[a](d || {}); } catch (e) {} };
      if (MSP) { try { MSP.setActionHandler({ action: a }, run); } catch (e) {} }
      else if (NAV) { try { NAV.setActionHandler(a, run); } catch (e) {} }
    });
  }

  // start `track` at `at` seconds. play() is begin(track, list, 0); a re-resolve after a failure keeps its place.
  function begin(track, list, at, byEvent) {
    if (!track || (!track.src && typeof track.resolve !== 'function')) return;
    if (Array.isArray(list) && list.length) { queue = list; qi = Math.max(0, list.findIndex(t => t.id === track.id)); }
    else { queue = [track]; qi = 0; }
    const tok = ++playTok;
    pending = false;
    cancelRetry(); disarm();
    wantPlay = true; resumeAt = at || 0; attempts = 0; firstLoad = false;
    osMeta(track);
    if (byEvent) osSync(); else osTap();   // a chapter that follows by itself (ended) never starts the service
    const start = () => {
      if (resumeAt > 0) {
        const want = resumeAt;
        seekOnLoad = () => { clearSeek(); if (tok !== playTok) return; try { el.currentTime = want; } catch (e) {} };
        el.addEventListener('loadedmetadata', seekOnLoad);
      }
      if (el.src !== track.src) el.src = track.src;
      applyRate();
      set({ track, loading: true, failed: false, retrying: false, q: queue, qi });
      firstLoad = true; rearm();
      el.play().then(() => { if (tok === playTok) set({ playing: true, loading: false }); }).catch(onPlayReject(tok));
    };
    if (track.src) { start(); return; }
    // DETACH the old source while the new one downloads: otherwise Play / the scrubber would drive the
    // PREVIOUS sermon's element under the NEW title. Play and seek are also no-ops until it lands.
    pending = true;
    try { el.pause(); el.removeAttribute('src'); el.load(); } catch (e) {}
    set({ track, loading: true, playing: false, failed: false, retrying: false, t: 0, d: 0, q: queue, qi });
    // a resolve() that fails is not retried by itself: a sermon is a whole-file download, and small pipes come first
    const fail = () => { if (tok === playTok) { pending = false; set({ loading: false, playing: false, failed: true }); } };
    Promise.resolve().then(() => track.resolve()).then(src => {
      if (tok !== playTok) return;                  // the listener chose something else while this downloaded
      if (!src) { fail(); osSync(); return; }
      pending = false; track.src = src;
      if (!wantPlay) { el.src = src; applyRate(); set({ loading: false, playing: false }); osSync(); return; }   // paused (a video opened) while it downloaded
      start();
    }).catch(() => { fail(); osSync(); });
  }

  // an absolute seek (the lock-screen scrubber): like seekTo, in seconds
  function seekAbs(sec) {
    if (pending || !(sec >= 0)) return;
    if (errored()) { const d = state.d || 0; resumeAt = d ? Math.min(d, sec) : sec; set({ t: resumeAt }); retryNow(); return; }
    if (el.duration) { el.currentTime = Math.max(0, Math.min(el.duration, sec)); resumeAt = el.currentTime; }
  }

  const api = {
    // play a track now. `list` (optional) sets the queue so ended → next and the lock-screen skip work.
    // track = { id, title, subtitle, src, image, album }
    // A queued track may carry `resolve()` (async → src) instead of `src` — a sermon's audio is a gated
    // download, fetched only when its turn comes, so "next" works without downloading the whole list.
    play(track, list) { begin(track, list, 0); },
    rates: RATES.slice(),
    get rate() { return rate; },
    get retrySchedule() { return { retryMs: RETRY_MS.slice(), stallMs: STALL_MS }; },
    setRate(r) {
      r = Number(r); if (RATES.indexOf(r) < 0) return;
      rate = r; applyRate();
      try { localStorage.setItem(RATE_KEY, String(r)); } catch (e) {}
      set({ rate });
    },
    // ONE RULE PER CONTROL. toggle (the player's one button): retrying → stop retrying; errored/failed → retry now
    // (never el.play() on a dead element); otherwise play/pause. A fetch in flight ignores it.
    toggle() {
      if (!state.track || pending) return;
      if (state.retrying) { api.pause(); return; }
      if (el.error || state.failed) { retryNow(); return; }
      if (el.paused) api.resume(); else api.pause();
    },
    // explicit play (the OS / headphone play action): errored, retrying or failed → retry now
    resume() {
      if (!state.track) return;
      if (pending) { wantPlay = true; osTap(); return; }
      if (errored()) { retryNow(); return; }
      wantPlay = true;
      osTap();
      const tok = playTok;
      el.play().then(() => {}).catch(onPlayReject(tok));
    },
    // explicit pause: also cancels a pending retry, and nothing restarts by itself
    pause() {
      if (!state.track) return;
      wantPlay = false; cancelRetry(); disarm(); firstLoad = false;
      try { el.pause(); } catch (e) {}
      set({ playing: false, loading: pending ? state.loading : false, retrying: false });
      osSync();
    },
    // seeking while errored moves the place to resume from and reloads there, rather than doing nothing
    seek(delta) {
      if (pending) return;
      if (errored()) { const d = state.d || el.duration || 0; resumeAt = Math.max(0, d ? Math.min(d, resumeAt + delta) : resumeAt + delta); set({ t: resumeAt }); retryNow(); return; }
      if (el.duration) { el.currentTime = Math.max(0, Math.min(el.duration, (el.currentTime || 0) + delta)); resumeAt = el.currentTime; }
    },
    seekTo(frac) {
      if (pending) return;
      const f = Math.max(0, Math.min(1, frac));
      if (errored()) { const d = state.d || 0; if (!d) return; resumeAt = f * d; set({ t: resumeAt }); retryNow(); return; }
      if (el.duration) { el.currentTime = f * el.duration; resumeAt = el.currentTime; }
    },
    next() { if (qi >= 0 && qi + 1 < queue.length) api.play(queue[qi + 1], queue); },
    prev() {
      if (errored() && !pending) { if (resumeAt > 3 || qi <= 0) { resumeAt = 0; set({ t: 0 }); retryNow(); return; } api.play(queue[qi - 1], queue); return; }
      if (el.currentTime > 3) { el.currentTime = 0; resumeAt = 0; return; } if (qi > 0) api.play(queue[qi - 1], queue);
    },
    hasNext() { return qi >= 0 && qi + 1 < queue.length; },
    hasPrev() { return qi > 0; },
    stop() { playTok++; pending = false; wantPlay = false; resumeAt = 0; attempts = 0; firstLoad = false; cancelRetry(); disarm(); try { el.pause(); el.removeAttribute('src'); el.load(); } catch (e) {} queue = []; qi = -1; set({ track: null, playing: false, loading: false, failed: false, retrying: false, t: 0, d: 0, q: queue, qi }); osSend('none'); },
    get current() { return state.track; },
    subscribe(fn) { subs.add(fn); fn(state); return () => subs.delete(fn); },
  };
  registerOsActions();
  window.TrinityAudio = api;
})();

// React hook: subscribe a component to the audio engine's state
function useTrinityAudio() {
  const [s, setS] = React.useState(() => ({ track: window.TrinityAudio ? window.TrinityAudio.current : null, playing: false, loading: false, failed: false, retrying: false, t: 0, d: 0, rate: 1, q: [], qi: -1 }));
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
      {a.retrying
        ? <div role="status" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{'Reconnecting\u2026'}</div>
        : a.failed
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
  const headBtn = (which, label) => <button onClick={() => (busy ? stop() : all(which))} style={{ flex: 1, padding: '11px', borderRadius: 13, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13.5, background: busy === which ? 'var(--clay-deep)' : 'var(--clay)', color: 'var(--on-clay)' }}>{busy === which ? 'Stop' : label}</button>;
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
      <div style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)', flexShrink: 0, background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
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
window.sermonAudioTrack = sermonAudioTrack;
window.audioFmtTime = fmtTime;
window.playBibleChapter = playBibleChapter;
window.bibleChapterTrackId = (b, c) => 'bible:' + b + ':' + c;
window.AUDIO_BIBLE_OPTIONS = AUDIO_BIBLE_OPTIONS;
window.getAudioChoice = getAudioChoice;
window.TrinityAudioBible = { getWebManifest, downloadWebBook, removeWebBook, webBookState, webDownloadedBooks };
