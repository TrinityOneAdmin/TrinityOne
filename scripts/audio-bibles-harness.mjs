// HARNESS FOR THE AUDIO-BIBLE TESTS (plan PLAN-AUDIO-BIBLES-2026-11-18 Build 1).
//
// What is REAL here: app/audio-store.jsx, app/screens-audio.jsx, app/screens-read.jsx and app/install-bible.jsx, each
// compiled from source and run (scripts/render-jsx-screen.mjs), and vendor/fflate.js — the same build the app loads.
// What is FAKED, and named:
//   · IndexedDB — a small in-memory implementation of exactly the calls the store makes (open, get, put, getAllKeys,
//     delete), asynchronous like the real one;
//   · the Capacitor Filesystem plugin — an in-memory "disk" of path → bytes with writeFile/appendFile/stat/readdir/
//     rmdir/deleteFile/rename/mkdir/getUri, base64 in and out like the bridge; this is THE SHIM the commit names: the
//     native file path is proved here and on the phone by the owner, nowhere else;
//   · fetch() for convertFileSrc addresses, answered from that disk (it records any Range header it is sent);
//   · a fake <audio> element (setting src reloads it, as in audio-controls-are-the-same-on-every-surface.test.mjs).
import { createRequire } from 'node:module';
import { loadScreen, miniReact } from './render-jsx-screen.mjs';

const require = createRequire(import.meta.url);
export const fflate = require('../vendor/fflate.js');
export const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

// ── audio bytes: the first bytes are what decides the type ──
export function mp3(tag, size = 64) { const u = new Uint8Array(Math.max(size, 16)); u.set([0x49, 0x44, 0x33]); u.set(new TextEncoder().encode(String(tag).slice(0, 12)), 3); return u; }
export function m4a(tag, size = 64) { const u = new Uint8Array(Math.max(size, 16)); u.set(new TextEncoder().encode('ftyp'), 4); u.set(new TextEncoder().encode(String(tag).slice(0, 6)), 8); return u; }
export const text = (s) => new TextEncoder().encode(s);
export const tagOf = (u8) => new TextDecoder().decode(u8.subarray(3, 15)).replace(/\0+$/, '');

// zip builders. deflate (sizes in the local header) via zipSync; `descriptor:true` uses the streaming Zip, whose
// entries carry the data-descriptor flag (bit 3) — ZipDeflate for DEFLATE, ZipPassThrough for STORED.
export function zipOf(entries, { level = 1, descriptor = false, stored = false } = {}) {
  if (!descriptor) {
    const obj = {}; for (const [name, data] of entries) obj[name] = [data, { level: stored ? 0 : level }];
    return fflate.zipSync(obj);
  }
  const parts = []; let doneAll = false;
  const z = new fflate.Zip((err, dat, final) => { if (err) throw err; parts.push(dat); if (final) doneAll = true; });
  for (const [name, data] of entries) {
    const f = stored ? new fflate.ZipPassThrough(name) : new fflate.ZipDeflate(name, { level });
    z.add(f); f.push(data, true);
  }
  z.end();
  if (!doneAll) throw new Error('zip did not finish');
  const n = parts.reduce((a, p) => a + p.length, 0); const out = new Uint8Array(n); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
// a reader over bytes, cut into pieces of `size` (a small size splits headers across chunks)
export function readerOf(u8, size = 4096, state = {}) {
  let at = 0;
  return { read: async () => { state.reads = (state.reads || 0) + 1; if (at >= u8.length) return { done: true }; const v = u8.slice(at, at + size); at += size; return { done: false, value: v }; },
    cancel: async () => { state.cancelled = true; } };
}

// ── fake IndexedDB ──
export function fakeIdb(data = new Map()) {
  const later = (fn) => setTimeout(fn, 0);
  const db = {
    objectStoreNames: { contains: () => true }, createObjectStore() {},
    transaction() {
      const tx = { oncomplete: null, onerror: null, onabort: null };
      let open = 0; const finish = () => { if (--open === 0) later(() => tx.oncomplete && tx.oncomplete()); };
      const req = (fn) => { open++; const r = { onsuccess: null, onerror: null, result: undefined }; later(() => { r.result = fn(); r.onsuccess && r.onsuccess(); finish(); }); return r; };
      tx.objectStore = () => ({
        get: (k) => req(() => data.get(k)),
        put: (v, k) => req(() => { data.set(k, v); }),
        delete: (k) => req(() => { data.delete(k); }),
        getAllKeys: () => req(() => [...data.keys()]),
      });
      return tx;
    },
  };
  const indexedDB = { open() { const r = { result: db }; later(() => { r.onupgradeneeded && r.onupgradeneeded(); r.onsuccess && r.onsuccess(); }); return r; } };
  return { indexedDB, data };
}

// ── fake Capacitor Filesystem (the shim) ──
export function fakeFs(files = new Map(), { hang = null, hangAfter = null, failWrite = null, noOverwrite = false, failRename = null } = {}) {
  const dec = (b64) => new Uint8Array(Buffer.from(b64, 'base64'));
  const calls = []; const dirs = new Set();
  const gate = async (op, path, dir) => { calls.push(op + ' ' + path); if (dir) dirs.add(dir); if (hang && hang(op, path)) await new Promise(() => {}); };
  // hangAfter: the operation HAPPENS, then the process "dies" before the caller hears back
  const after = async (op, path) => { if (hangAfter && hangAfter(op, path)) await new Promise(() => {}); };
  const kids = (path) => {
    const pre = path ? path + '/' : ''; const out = new Map();
    for (const [p, b] of files) { if (!p.startsWith(pre)) continue; const rest = p.slice(pre.length); const i = rest.indexOf('/'); if (i < 0) out.set(rest, { name: rest, type: 'file', size: b.length }); else if (!out.has(rest.slice(0, i))) out.set(rest.slice(0, i), { name: rest.slice(0, i), type: 'directory', size: 0 }); }
    return [...out.values()];
  };
  const Filesystem = {
    async writeFile({ directory, path, data }) { await gate('writeFile', path, directory); if (failWrite && failWrite(path, 'writeFile')) throw new Error('ENOSPC: no space left on device'); files.set(path, dec(data)); return { uri: 'file:///data/' + path }; },
    async appendFile({ directory, path, data }) { await gate('appendFile', path, directory); if (failWrite && failWrite(path, 'appendFile')) throw new Error('ENOSPC: no space left on device'); const a = files.get(path) || new Uint8Array(0); const b = dec(data); const c = new Uint8Array(a.length + b.length); c.set(a); c.set(b, a.length); files.set(path, c); },
    async stat({ directory, path }) { await gate('stat', path, directory); if (!files.has(path)) throw new Error('File does not exist'); return { size: files.get(path).length, type: 'file', uri: 'file:///data/' + path }; },
    async readdir({ directory, path }) { await gate('readdir', path, directory); return { files: kids(path) }; },
    async rmdir({ directory, path }) { await gate('rmdir', path, directory); for (const p of [...files.keys()]) if (p === path || p.startsWith(path + '/')) files.delete(p); },
    async deleteFile({ directory, path }) { await gate('deleteFile', path, directory); if (!files.has(path)) throw new Error('File does not exist'); files.delete(path); },
    async rename({ from, to, directory }) { await gate('rename', from, directory); if (!files.has(from)) throw new Error('File does not exist'); if (noOverwrite && files.has(to)) throw new Error('Destination exists'); if (failRename && failRename(from, to)) throw new Error('rename failed'); files.set(to, files.get(from)); files.delete(from); await after('rename', to); },
    async mkdir() {},
    async getUri({ path }) { return { uri: 'file:///data/' + path }; },
  };
  const fetched = [];
  const fsFetch = async (url, init) => {
    const m = /^https:\/\/localhost\/_capacitor_file_\/data\/(.*)$/.exec(String(url));
    if (!m) throw new Error('unexpected fetch ' + url);
    fetched.push({ url, range: init && init.headers && (init.headers.Range || init.headers.range) });
    const b = files.get(decodeURIComponent(m[1]));
    if (!b) return { ok: false, status: 404 };
    return { ok: true, status: 200, blob: async () => new Blob([b], { type: '' }) };
  };
  const convertFileSrc = (uri) => 'https://localhost/_capacitor_file_' + String(uri).replace(/^file:\/\//, '');
  return { Filesystem, files, calls, dirs, fetched, fsFetch, convertFileSrc };
}

// ── a world: one localStorage, one IndexedDB, optionally the native disk; the store loaded for real ──
// backupExclude (iOS only): 'resolve' | 'reject' | 'false' (answers excluded:false) | 'hang' (never answers) | 'missing',
// or a function returning one of those at each call — a fake of PR #24's plugin
export function storeWorld({ native = false, platform = 'android', ls = new Map(), idbData = new Map(), disk = new Map(), fsOpts = {}, extra = {}, backupExclude = 'missing', excludeCalls = [] } = {}) {
  const idb = fakeIdb(idbData);
  const modeOf = () => (typeof backupExclude === 'function' ? backupExclude() : backupExclude);
  const fs = fakeFs(disk, fsOpts);
  const localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => { ls.set(k, String(v)); }, removeItem: (k) => { ls.delete(k); } };
  const win = {
    fflate, indexedDB: idb.indexedDB, crypto: globalThis.crypto, btoa: globalThis.btoa,
    Capacitor: native ? { isNativePlatform: () => true, getPlatform: () => platform, convertFileSrc: fs.convertFileSrc,
      isPluginAvailable: (n) => (n === 'BackupExclude' ? modeOf() !== 'missing' : n === 'Filesystem'),
      Plugins: { Filesystem: fs.Filesystem, get BackupExclude() { return modeOf() === 'missing' ? undefined : { exclude: async (o) => {
        const mode = modeOf();
        excludeCalls.push({ ...o, mode, fsCallsBefore: fs.calls.length });
        if (mode === 'hang') return new Promise(() => {});
        if (mode === 'reject') throw new Error('path must not be empty');
        return { path: o.path, excluded: mode === 'resolve' };
      } }; } } }
      : { isNativePlatform: () => false, getPlatform: () => 'web', Plugins: {} },
    ...extra,
  };
  const fetchImpl = async (url, init) => (win.fetchOverride ? win.fetchOverride(url, init) : fs.fsFetch(url, init));
  loadScreen('app/audio-store.jsx', [], { window: win, localStorage, fetch: fetchImpl, Blob, URL, crypto: globalThis.crypto, btoa: globalThis.btoa, indexedDB: idb.indexedDB, console });
  return { S: win.TrinityAudioStore, win, ls, localStorage, idb, fs, idbData, disk, fetchImpl };
}

// ── the fake <audio> element ──
export function fakeEl() {
  const h = {}; let _src = '';
  const el = {
    paused: true, currentTime: 0, duration: 0, defaultPlaybackRate: 1, playbackRate: 1, preload: '',
    addEventListener(t, f) { (h[t] = h[t] || []).push(f); }, setAttribute() {},
    get src() { return _src; },
    set src(v) { _src = v; el.playbackRate = el.defaultPlaybackRate; el.currentTime = 0; (h.loadstart || []).forEach(f => f()); },
    removeAttribute() { _src = ''; }, load() {},
    play() { el.paused = false; (h.play || []).forEach(f => f()); return Promise.resolve(); },
    pause() { el.paused = true; (h.pause || []).forEach(f => f()); },
    emit(t) { (h[t] || []).forEach(f => f()); },
  };
  return el;
}

const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
export { Stub };

// the store + screens-audio.jsx in ONE window, sharing one React (as the app does). `voice` = the saved choice.
export function audioWorld(opts = {}) {
  const w = storeWorld(opts);
  const { React, draw } = miniReact(opts.unmounts ? { unmounts: true } : undefined);
  const el = fakeEl();
  const NAME = { 1: 'Genesis', 19: 'Psalms', 40: 'Matthew', 41: 'Mark', 43: 'John', 57: 'Philemon', 66: 'Revelation' };
  const MAXCH = { 1: 50, 19: 150, 40: 28, 41: 16, 43: 21, 57: 1, 66: 22 };
  w.win.Bible = { bookName: b => NAME[b] || ('Book ' + b), maxChapter: b => MAXCH[b] || 1,
    bookMeta: () => Object.keys(NAME).map(Number).map(n => ({ num: n, name: NAME[n], abbr: NAME[n].slice(0, 3), group: n < 40 ? 'ot' : 'nt', ch: MAXCH[n] })) };
  const toasts = []; w.win.trinityToast = m => toasts.push(m);
  if (opts.voice) w.ls.set('trinityone.audioVoice', JSON.stringify(opts.voice));
  const lsGet = (k, d) => { const v = w.ls.get(k); if (v == null) return d; try { return JSON.parse(v); } catch (e) { return d; } };
  const lsSet = (k, v) => { w.ls.set(k, JSON.stringify(v)); };
  const base = {
    React, window: w.win, localStorage: w.localStorage, navigator: {}, MediaMetadata: class {},
    document: { createElement: () => el, body: { appendChild() {} } },
    Icon: Stub('Icon'), Overlay: ({ open, children }) => (open ? React.createElement('div', { 'data-overlay': true }, children) : null),
    IconBtn: Stub('IconBtn'), SectionLabel: ({ children }) => React.createElement('h3', {}, children),
    lsGet, lsSet, URL, Blob, console, fetch: w.fetchImpl,
    // the engine's own timers (the 45 s no-progress guard, the retry schedule, the 10-minute "paused -> none" of the
    // OS controls) run on real time here and must not keep node alive once the tests are done: unref'd, they still fire
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); if (t && t.unref) t.unref(); return t; }, clearTimeout,
  };
  const audio = loadScreen('app/screens-audio.jsx', ['MiniPlayer', 'useTrinityAudio', 'AudioBiblesScreen', 'playBibleChapter', 'getAudioChoice', 'sermonAudioTrack'], base);
  return { ...w, React, draw, el, base, audio, A: w.win.TrinityAudio, toasts, lsGet, lsSet };
}
