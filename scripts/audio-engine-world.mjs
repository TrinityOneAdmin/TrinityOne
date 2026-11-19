// THE AUDIO ENGINE, LOADED FOR REAL, AGAINST A FAKE <audio> THAT FAILS THE WAY A BROWSER FAILS.
//
// Lifted 2026-11-18 out of scripts/audio-controls-are-the-same-on-every-surface.test.mjs (which had its own
// fakeEl + world) so the recovery tests and the OS-controls tests drive the same element. Callers:
//   scripts/audio-controls-are-the-same-on-every-surface.test.mjs
//   scripts/the-audio-player-recovers.test.mjs
//   scripts/the-lock-screen-controls-drive-the-player.test.mjs (Fix 2)
//
// WHY THE FAKE HAD TO GET MORE FAITHFUL (plan audit, finding 14). The old fake modelled none of what the
// recovery bugs depend on, so a test on it would pass over the very defect being fixed. This one models,
// from the HTML media spec and from what the investigation measured in Chromium:
//   · assigning `src` (even the SAME value) runs the load algorithm: position 0, rate back to the default,
//     `error` cleared, any pending play() promise rejected with AbortError, paused set WITHOUT a pause event;
//   · `src` reads back ABSOLUTE;
//   · a load that fails sets `error` (code 4, MEDIA_ERR_SRC_NOT_SUPPORTED — what Chromium reports for a source
//     it cannot reach), fires `error`, and rejects pending play() with NotSupportedError;
//   · a stream that dies mid-play sets `error` (code 2), fires `error` and THEN `pause`;
//   · at the end, `pause` fires BEFORE `ended`;
//   · `error` stays set until the next load; play() on a code-4 element rejects NotSupportedError, and on a
//     code-2 element fires play + waiting and never fetches again (the investigation's "spinner for ever");
//   · removeAttribute('src') + load() empties the element and fires NO error.
// What each load does is the test's choice: `el.net = src => 'ok' | 'fail' | 'hang'` (default 'ok'), decided at
// the moment of the load and delivered on a microtask, like a fetch.
import { loadScreen, miniReact } from './render-jsx-screen.mjs';

const DOMEx = (name) => { try { return new DOMException(name, name); } catch (e) { const x = new Error(name); x.name = name; return x; } };

export function fakeAudio() {
  const h = {};
  let _src = '', gen = 0, pend = [];
  const fire = (t) => (h[t] || []).slice().forEach(f => f());
  // A QUEUED event, as Chromium dispatches `pause` and `ended`: it runs as its own task, after the current one and
  // its microtasks, and a load (src assignment / load()) started in between DROPS it (2026-11-19, audit R2-1).
  const queue = (t) => { const g = gen; setImmediate(() => { if (g === gen) fire(t); }); };
  const rejectAll = (name) => { const p = pend; pend = []; p.forEach(x => x.rej(DOMEx(name))); };
  const resolveAll = () => { const p = pend; pend = []; p.forEach(x => x.res()); };
  const abs = (v) => { v = String(v == null ? '' : v); if (!v) return ''; try { return new URL(v, 'https://localhost/').href; } catch (e) { return v; } };
  function loaded() {
    el.readyState = 4;
    const L = el.lengthOf(_src); if (L) { el.duration = L; fire('durationchange'); }
    fire('loadedmetadata'); fire('loadeddata'); fire('canplay');
    if (!el.paused) { fire('playing'); resolveAll(); }
  }
  function failLoad() {
    el.error = { code: 4 }; el.readyState = 0;
    fire('error');
    rejectAll('NotSupportedError');
  }
  function runLoad() {
    gen++;
    rejectAll('AbortError');
    el.paused = true;                       // no `pause` event from the load algorithm
    el.error = null; el.readyState = 0; el.currentTime = 0; el.playbackRate = el.defaultPlaybackRate;
    if (!_src) return;                      // emptied: no error
    fire('loadstart');
    el.loads.push(_src);
    const g = gen, outcome = el.net(_src);
    Promise.resolve().then(() => {
      if (g !== gen) return;
      if (outcome === 'ok') loaded();
      else if (outcome === 'fail') failLoad();
      // 'hang': nothing, ever — until the test calls el.finish()
    });
  }
  const el = {
    paused: true, currentTime: 0, duration: 0, defaultPlaybackRate: 1, playbackRate: 1, preload: '',
    error: null, readyState: 0,
    loads: [],                 // every src a load was started for, in order
    plays: 0,                  // every play() call
    net: () => 'ok',
    lengthOf: () => 0,
    policy: 'allow',           // 'deny' → play() rejects NotAllowedError (autoplay refused)
    addEventListener(t, f) { (h[t] = h[t] || []).push(f); },
    removeEventListener(t, f) { if (h[t]) h[t] = h[t].filter(x => x !== f); },
    listeners(t) { return (h[t] || []).length; },
    setAttribute() {},
    getAttribute(n) { return n === 'src' && _src ? _src : null; },
    get src() { return _src; },
    set src(v) { _src = abs(v); runLoad(); },
    removeAttribute(n) { if (n === 'src') _src = ''; },
    load() { runLoad(); },
    play() {
      el.plays++;
      if (el.policy === 'deny') return Promise.reject(DOMEx('NotAllowedError'));
      if (el.error && el.error.code === 4) return Promise.reject(DOMEx('NotSupportedError'));
      if (!el.paused) return el.readyState >= 3 ? Promise.resolve() : new Promise((res, rej) => pend.push({ res, rej }));
      el.paused = false;
      fire('play');
      if (el.paused) return Promise.reject(DOMEx('AbortError'));      // a `play` listener paused it again
      if (el.readyState >= 3 && !el.error) { fire('playing'); return Promise.resolve(); }
      fire('waiting');
      return new Promise((res, rej) => pend.push({ res, rej }));
    },
    // pausing a playing element QUEUES `pause`; pausing a paused one fires nothing (HTML "internal pause steps")
    pause() { rejectAll('AbortError'); if (!el.paused) { el.paused = true; queue('pause'); } },
    // computed, as in the spec: metadata known, at or past the end
    get ended() { return el.readyState >= 1 && el.duration > 0 && el.currentTime >= el.duration; },
    emit(t) { fire(t); },
    // ── test controls ──
    // a stream dying mid-play: `error`, then (queued) `pause`
    failNow(code = 2) { el.error = { code }; fire('error'); if (!el.paused) { el.paused = true; queue('pause'); } },
    // the SYSTEM pausing / resuming the element (Chromium's AudioFocusDelegate on a call): the engine did not ask
    sysPause() { if (!el.paused) { el.paused = true; rejectAll('AbortError'); queue('pause'); } },
    // Chromium's resume: `play` and `playing` are BOTH queued, so `playing` still arrives after a play listener paused it
    sysResume() { if (el.paused) { el.paused = false; queue('play'); if (el.readyState >= 3 && !el.error) queue('playing'); } },
    finish() { loaded(); },                                        // a 'hang' load completes (a completing load drops no queued event)
    tick(dt) { el.currentTime += dt; fire('timeupdate'); },
    // reaching the end: `pause` and `ended` are SEPARATE queued tasks (with el.ended already true for both)
    end() { if (!(el.duration > 0)) el.duration = Math.max(1, el.currentTime); el.currentTime = el.duration; fire('timeupdate'); el.paused = true; queue('pause'); queue('ended'); },
  };
  return el;
}

// A clock the test drives. Only the audio engine is given it (WatchView and Listen keep the real timers).
export function fakeClock() {
  let now = 0, id = 0;
  const timers = new Map();
  const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
  return {
    setTimeout(fn, ms) { const k = ++id; timers.set(k, { at: now + (Number(ms) || 0), fn }); return k; },
    clearTimeout(k) { timers.delete(k); },
    get now() { return now; },
    count() { return timers.size; },
    async advance(ms) {
      const end = now + ms;
      await flush();
      for (;;) {
        let next = null;
        for (const [k, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [k, t];
        if (!next) break;
        timers.delete(next[0]); now = next[1].at;
        try { next[1].fn(); } catch (e) { throw e; }
        await flush();
      }
      now = end; await flush();
    },
  };
}

// The audio module, loaded for real, plus the fake element, a fake clock, a fake document and a fake
// localStorage. Shares ONE React with every screen loaded through the same world, as the app does.
// `capacitor` (optional) becomes window.Capacitor BEFORE the engine starts, as the native bridge does.
// `urlImpl` (optional) replaces URL for the engine, so a test can watch blob: addresses being created and revoked.
export function world({ stored = {}, capacitor, mediaSession, hook, urlImpl } = {}) {
  const { React, draw } = miniReact();
  const el = fakeAudio();
  const clock = fakeClock();
  const store = { ...stored };
  const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const NAME = { 1: 'Genesis', 43: 'John', 66: 'Revelation' }, MAXCH = { 1: 50, 43: 21, 66: 22 };
  const win = { Bible: { bookName: b => NAME[b], maxChapter: b => MAXCH[b] } };
  if (capacitor) win.Capacitor = capacitor;
  if (hook) win.__TRINITY_AUDIO_TEST__ = hook;
  const toasts = [];
  win.trinityToast = m => toasts.push(m);
  const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
  const base = {
    React, window: win, localStorage, navigator: mediaSession ? { mediaSession } : {}, MediaMetadata: class { constructor(o) { Object.assign(this, o); } },
    document: { createElement: () => el, body: { appendChild() {} } },
    Icon: Stub('Icon'), Overlay: Stub('Overlay'), IconBtn: Stub('IconBtn'), SectionLabel: Stub('SectionLabel'),
    lsGet: (k, d) => d, lsSet() {}, URL: urlImpl || URL, Blob, console, Promise, Math, Date, JSON, Set, Map, Object, Array, Number, String, Boolean, RegExp,
  };
  const docH = {};
  const doc = { createElement: () => el, body: { appendChild() {} }, visibilityState: 'visible',
    addEventListener(t, f) { (docH[t] = docH[t] || []).push(f); }, removeEventListener() {},
    fire(t) { (docH[t] || []).forEach(f => f()); } };
  const audio = loadScreen('app/screens-audio.jsx', ['MiniPlayer', 'sermonAudioTrack', 'useTrinityAudio', 'AudioButtons'],
    { ...base, document: doc, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  // THE player as App docks it above the tab bar. Drawn twice so effects / state settle, like every screen here.
  const player = (ctx = {}) => { draw(audio.MiniPlayer, { ctx }); return draw(audio.MiniPlayer, { ctx }); };
  return { React, draw, el, clock, doc, store, win, base, audio, A: win.TrinityAudio, toasts, player };
}
