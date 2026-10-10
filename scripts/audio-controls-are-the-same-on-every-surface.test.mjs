// ONE SET OF AUDIO CONTROLS ON EVERY AUDIO SURFACE — Bible chapter, sermons, podcast.
// Run: node --test scripts/audio-controls-are-the-same-on-every-surface.test.mjs
//
// Owner decision 2026-10-10: the same controls everywhere — scrubber, back/forward 10 seconds, previous/next,
// play/pause, playback speed, and what is playing / up next. "Next" for sermons is the next sermon in the list
// it was started from. Chapter-level, never verse-level.
//
// HOW THIS ASSERTS (CLAUDE.md rules 1 and 3). Nothing here matches text in app/*.jsx. The REAL
// app/screens-audio.jsx is compiled and run against a fake <audio> element that behaves the way the browser
// does where it matters (setting `src` resets playbackRate to the default). The REAL ReadScreen, WatchView and
// ListenScreen are then rendered through the miniature React, playback is started the way a member starts it
// (the Bible headphones button, a sermon row, an episode row), and the buttons the screen drew are PRESSED.
// Deleting the controls from any one screen therefore fails that screen's test, not just the engine's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const settle = () => new Promise(r => setTimeout(r, 0));
const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

// A fake <audio>. Like a real one, assigning `src` reloads it: the rate falls back to defaultPlaybackRate and
// the position to zero. That is what makes "the chosen speed survives the next track" a real assertion.
function fakeEl() {
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

// The audio module, loaded for real, plus the fake element and a fake localStorage. Shares ONE React with
// every screen loaded through the same world, as the app does.
function world({ stored = {} } = {}) {
  const { React, draw } = miniReact();
  const el = fakeEl();
  const store = { ...stored };
  const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const NAME = { 1: 'Genesis', 43: 'John', 66: 'Revelation' }, MAXCH = { 1: 50, 43: 21, 66: 22 };
  const win = { Bible: { bookName: b => NAME[b], maxChapter: b => MAXCH[b] } };
  const toasts = [];
  win.trinityToast = m => toasts.push(m);
  const base = {
    React, window: win, localStorage, navigator: {}, MediaMetadata: class {},
    document: { createElement: () => el, body: { appendChild() {} } },
    Icon: Stub('Icon'), Overlay: Stub('Overlay'), IconBtn: Stub('IconBtn'), SectionLabel: Stub('SectionLabel'),
    lsGet: (k, d) => d, lsSet() {}, URL, Blob, console, Promise, Math, Date, JSON, Set, Map, Object, Array, Number, String, Boolean, RegExp,
  };
  const audio = loadScreen('app/screens-audio.jsx', ['AudioControls', 'MiniPlayer', 'sermonAudioTrack', 'useTrinityAudio'], base);
  return { React, draw, el, store, win, base, audio, A: win.TrinityAudio, toasts };
}

const trk = (id, extra) => ({ id, title: 'T-' + id, src: 'blob:' + id, ...(extra || {}) });
const byLabel = (tree, label) => find(tree, n => n.type === 'button' && n.props && n.props['aria-label'] === label);
const press = (tree, label) => { const b = byLabel(tree, label); assert.equal(b.length, 1, `expected exactly one control labelled "${label}" on this screen, found ${b.length}`); b[0].props.onClick({ stopPropagation() {} }); };
const sliders = tree => find(tree, n => n.props && n.props.role === 'slider');

// ─────────────────────────────────── ENGINE ───────────────────────────────────
test('ENGINE: the chosen speed is applied to the element, kept per device, and survives the next track', () => {
  const w = world();
  assert.deepEqual(w.A.rates, [0.75, 1, 1.25, 1.5, 2]);
  w.A.play(trk('a'), [trk('a'), trk('b')]);
  w.A.setRate(1.5);
  assert.equal(w.el.playbackRate, 1.5, 'setRate did not reach the audio element');
  assert.equal(w.store['trinityone.audioRate'], '1.5', 'the speed is not remembered for next time');
  w.A.next();
  assert.equal(w.el.src, 'blob:b', 'next() did not move to the second track');
  assert.equal(w.el.playbackRate, 1.5, 'THE SPEED WAS LOST WHEN THE TRACK CHANGED — the element reloads on a new src and falls back to 1x');
  w.A.setRate(3);
  assert.equal(w.el.playbackRate, 1.5, 'a speed outside the offered list was accepted');
});

test('ENGINE: a remembered speed is used from the very first play after a restart', () => {
  const w = world({ stored: { 'trinityone.audioRate': '1.25' } });
  assert.equal(w.A.rate, 1.25);
  w.A.play(trk('a'));
  assert.equal(w.el.playbackRate, 1.25);
  const bad = world({ stored: { 'trinityone.audioRate': 'banana' } });
  assert.equal(bad.A.rate, 1, 'a corrupt stored speed must fall back to normal speed');
});

test('ENGINE: a queued track with resolve() is fetched when its turn comes — not before — and a stale fetch cannot override a newer choice', async () => {
  const w = world();
  const calls = [];
  let release;
  const slow = new Promise(r => { release = r; });
  const q = [trk('a'),
    { id: 'b', title: 'T-b', resolve: async () => { calls.push('b'); return 'blob:b'; } },
    { id: 'c', title: 'T-c', resolve: async () => { calls.push('c'); await slow; return 'blob:c'; } }];
  w.A.play(q[0], q);
  assert.deepEqual(calls, [], 'the whole queue was downloaded up front');
  w.A.next(); await settle();
  assert.equal(w.el.src, 'blob:b'); assert.deepEqual(calls, ['b']);
  w.A.next();                      // c starts downloading…
  w.A.play(q[0], q);               // …and the listener picks the first one again
  release(); await settle();
  assert.equal(w.el.src, 'blob:a', 'a slow download finished late and replaced what the listener had chosen');
  assert.equal(w.A.current.id, 'a');
});

test('ENGINE: sermonAudioTrack resolves through the church fetcher, and a failure toasts and plays nothing', async () => {
  const w = world();
  const seen = [];
  w.win.Fellowship = { fetchSermon: async (m, o) => { seen.push([m.sha256, o.mime]); return 'blob:' + m.sha256; } };
  const toasts = [];
  const ok = w.audio.sermonAudioTrack({ id: 's1', title: 'One', sha256: 'aa', hosts: ['h'], mime: 'audio/mp4' }, { subtitle: 'St Mary’s', toast: m => toasts.push(m) });
  assert.equal(await ok.resolve(), 'blob:aa'); assert.deepEqual(seen, [['aa', 'audio/mp4']]);
  const bad = w.audio.sermonAudioTrack({ id: 's2', title: 'Two', hosts: [], mime: 'audio/mp4' }, { toast: m => toasts.push(m) });
  assert.equal(await bad.resolve(), null);
  assert.match(toasts.join('|'), /Couldn.t load/);
});

// ───────────────────────── the one control drill, run on every surface ─────────────────────────
// Presses the real buttons the screen drew and checks the ENGINE (the fake <audio> element) moved.
// `redraw()` returns a fresh tree; `want` names the sources the queue should produce.
async function drill({ redraw, w, want }) {
  const { el } = w;
  let tree = redraw();
  assert.ok(texts(tree).join(' ').includes('Up next'), 'no "Up next" list on this screen');
  assert.equal(find(tree, n => n.props && n.props['aria-current'] === 'true').length, 1, 'the current item is not marked in the list');

  el.duration = 100; el.currentTime = 20;
  press(tree, 'Forward 10 seconds'); assert.equal(el.currentTime, 30, '+10 did nothing');
  press(tree, 'Back 10 seconds'); assert.equal(el.currentTime, 20, '-10 did nothing');

  const sl = sliders(tree); assert.equal(sl.length, 1, 'no scrubber on this screen');
  sl[0].props.onPointerDown({ currentTarget: { getBoundingClientRect: () => ({ left: 10, width: 200 }), setPointerCapture() {} }, clientX: 60, pointerId: 1 });
  assert.equal(el.currentTime, 25, 'tapping the scrubber did not seek');
  sl[0].props.onPointerMove({ currentTarget: { getBoundingClientRect: () => ({ left: 10, width: 200 }) }, clientX: 110 });
  assert.equal(el.currentTime, 50, 'dragging the scrubber did not seek');
  sl[0].props.onPointerUp();

  press(tree, 'Speed 1.5 times'); assert.equal(el.playbackRate, 1.5, 'the speed buttons did not change the speed');

  press(tree, 'Next track'); await settle();
  assert.equal(el.src, want.next, 'NEXT went to the wrong place');
  assert.equal(el.playbackRate, 1.5, 'the speed was lost on the next track');
  tree = redraw();
  assert.equal(find(tree, n => n.props && n.props['aria-current'] === 'true').length, 1);

  press(tree, 'Play ' + want.jumpTitle); await settle();
  assert.equal(el.src, want.jump, 'tapping an item in Up next did not play it');
  tree = redraw();
  el.currentTime = 0;
  press(tree, 'Previous track'); await settle();
  assert.equal(el.src, want.prev, 'PREVIOUS went to the wrong place');
  tree = redraw();
  press(tree, 'Pause'); assert.equal(el.paused, true, 'pause did nothing');
  tree = redraw(); press(tree, 'Play'); assert.equal(el.paused, false, 'play did nothing');
}

// ─────────────────────────────────── BIBLE ───────────────────────────────────
test('POINT OF USE — Bible: listening to a chapter puts the shared controls on the reader, and next is the next CHAPTER', async () => {
  const w = world();
  const NAME = { 1: 'Genesis', 43: 'John', 66: 'Revelation' }, MAXCH = { 1: 50, 43: 21, 66: 22 }, BOOKS = [1, 43, 66];
  Object.assign(w.win, {
    Bible: { loaded: true, activeVersion: 'WEB', books: () => BOOKS, maxChapter: b => MAXCH[b], bookName: b => NAME[b], versions: () => [{ abbr: 'WEB' }],
      getVerses: () => [{ v: 1, text: 'In the beginning', html: 'In the beginning' }],
      bookMeta: () => BOOKS.map(n => ({ num: n, name: NAME[n], abbr: NAME[n].slice(0, 3), group: 'g', ch: MAXCH[n] })),
      getCommentary: () => [], commentaryList: () => [], searchDict: () => [], subscribe: () => () => {}, defaultLoc: () => ({ book: 43, chap: 1 }),
      refLabel: (l, v) => NAME[l.book] + ' ' + l.chap + (v != null ? ':' + v : ''), refKey: (l, v) => l.book + '.' + l.chap + '.' + v, step: () => null },
    speechSynthesis: null, innerWidth: 360, sanitizeHtml: h => h, getSelection: () => ({ toString: () => '' }), TrinityData: { CROSSREFS: {} },
  });
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React: w.React, window: {} });
  const globals = { ...w.base, Icon, window: w.win, document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '', clipboard: null }, location: { search: '' }, setTimeout, clearTimeout, setInterval, clearInterval, URLSearchParams,
    SpeechSynthesisUtterance: class {}, cx: (...a) => a.filter(Boolean).join(' '),
    useTrinityAudio: w.audio.useTrinityAudio, AudioControls: w.audio.AudioControls,
    ReadPlansTabs: Stub('ReadPlansTabs'), BottomSheet: Stub('BottomSheet'), useBackLayer: () => {}, Sheet: Stub('Sheet'), Modal: Stub('Modal'),
    Pill: Stub('Pill'), Row: Stub('Row'), Halo: Stub('Halo'), IconBtn: Stub('IconBtn') };
  const { ReadScreen } = loadScreen('app/screens-read.jsx', ['ReadScreen'], globals);
  const ctx = { loc: { book: 43, chap: 3 }, version: 'WEB', setLoc() {}, toast() {}, highlights: {}, notes: {}, bookmarks: [], toggleBookmark() {}, setHighlight() {}, setNote() {},
    openShareSheet() {}, desktop: false, readScale: 1, removeTranslation() {}, addModule() {}, setVersion() {} };
  const redraw = () => { w.draw(ReadScreen, { ctx }); return w.draw(ReadScreen, { ctx }); };
  let tree = redraw();
  assert.equal(byLabel(tree, 'Next track').length, 0, 'the audio controls are showing before anything is playing');
  const listen = find(tree, n => n.type && n.type.name === 'IconBtn' && n.props.name === 'headphones');
  assert.equal(listen.length, 1, 'no listen button on the reader — re-anchor this test');
  listen[0].props.onClick(); await settle();
  assert.equal(w.el.src, 'https://audio.bible.helloao.org/api/BSB/JHN/3/audio/david.mp3');
  await drill({ redraw, w, want: { next: 'https://audio.bible.helloao.org/api/BSB/JHN/4/audio/david.mp3', jumpTitle: 'John 6',
    jump: 'https://audio.bible.helloao.org/api/BSB/JHN/6/audio/david.mp3', prev: 'https://audio.bible.helloao.org/api/BSB/JHN/5/audio/david.mp3' } });
});

// ─────────────────────────────────── SERMONS (Watch tab) ───────────────────────────────────
const SERMONS = ['s1', 's2', 's3', 's4'].map((id, i) => ({ id, title: 'Sermon ' + 'ABCD'[i], mime: 'audio/mp4', sha256: 'sha-' + id, hosts: ['h'], contentTs: 1000 + i }));

test('POINT OF USE — Sermons (Watch): starting one from the list gives it the shared controls, and next is the next sermon in that list', async () => {
  const w = world();
  w.win.Fellowship = { subscribeSermons: (_n, cb) => { cb(SERMONS); return () => {}; }, gatewayBase: () => '', fetchSermon: async (m) => 'blob:' + m.sha256 };
  w.win.Bible.getVideos = async () => ({ channel: null, videos: [] });
  const globals = { ...w.base, useTrinityAudio: w.audio.useTrinityAudio, AudioControls: w.audio.AudioControls,
    fetch: async () => { throw new Error('no feed expected'); } };
  const { WatchView } = loadScreen('app/screens-watch.jsx', ['WatchView'], globals);
  const ctx = { church: { npub: 'npub1c', name: 'St Mary’s', channel: '' }, toast() {}, openVideo() {} };
  const redraw = () => { w.draw(WatchView, { ctx }); return w.draw(WatchView, { ctx }); };
  redraw(); await settle(); let tree = redraw();
  assert.equal(byLabel(tree, 'Next track').length, 0, 'the controls are showing before any sermon is playing');
  const row = find(tree, n => n.type === 'button' && texts(n).join(' ').includes('Sermon B'));
  assert.equal(row.length, 1, 'no row for the second sermon — re-anchor this test');
  row[0].props.onClick(); await settle();
  assert.equal(w.el.src, 'blob:sha-s2');
  assert.equal(w.A.current.id, 's2');
  // from s2 the list is [A, B, C, D]: next = C, jump to D, previous from D = C
  await drill({ redraw, w, want: { next: 'blob:sha-s3', jumpTitle: 'Sermon D', jump: 'blob:sha-s4', prev: 'blob:sha-s3' } });
});

// ─────────────────────────────────── PODCAST + sermons (Listen screen) ───────────────────────────────────
async function listenWorld({ audioFeed, sermons }) {
  const w = world();
  w.win.Fellowship = { subscribeSermons: (_n, cb) => { cb(sermons || []); return () => {}; }, gatewayBase: () => 'http://gw', fetchSermon: async (m) => 'blob:' + m.sha256 };
  const eps = ['p1', 'p2', 'p3', 'p4'].map((id, i) => ({ id, title: 'Episode ' + (i + 1), audio: 'https://pod/' + id + '.mp3', published: '2026-01-0' + (i + 1) }));
  const globals = { ...w.base, useTrinityAudio: w.audio.useTrinityAudio, AudioControls: w.audio.AudioControls,
    Sheet: ({ children }) => children, Screen: ({ children }) => children, Overlay: ({ children }) => children,
    fetch: async () => ({ json: async () => ({ channel: { name: 'The Pod' }, episodes: eps }) }) };
  const { ListenScreen } = loadScreen('app/screens-extras.jsx', ['ListenScreen'], globals);
  const ctx = { church: { npub: 'npub1c', name: 'St Mary’s', audioFeed }, toast() {} };
  const redraw = () => { w.draw(ListenScreen, { open: true, onClose() {}, ctx }); return w.draw(ListenScreen, { open: true, onClose() {}, ctx }); };
  redraw(); await settle(); await settle(); redraw();
  return { w, redraw };
}

test('POINT OF USE — Podcast (Listen): an episode gets the shared controls, and next is the next episode', async () => {
  const { w, redraw } = await listenWorld({ audioFeed: 'http://feed', sermons: [] });
  let tree = redraw();
  assert.equal(byLabel(tree, 'Next track').length, 0, 'the controls are showing before anything is playing');
  const row = find(tree, n => n.type === 'button' && texts(n).join(' ').includes('Episode 2'));
  assert.equal(row.length, 1, 'no row for the second episode — re-anchor this test');
  row[0].props.onClick(); await settle();
  assert.equal(w.el.src, 'https://pod/p2.mp3');
  await drill({ redraw, w, want: { next: 'https://pod/p3.mp3', jumpTitle: 'Episode 4', jump: 'https://pod/p4.mp3', prev: 'https://pod/p3.mp3' } });
});

test('POINT OF USE — Sermons (Listen): started from this list, next is the next sermon in it — not a podcast episode', async () => {
  const { w, redraw } = await listenWorld({ audioFeed: 'http://feed', sermons: SERMONS });
  let tree = redraw();
  const row = find(tree, n => n.type === 'button' && texts(n).join(' ').includes('Sermon A'));
  assert.equal(row.length, 1, 'no row for the first sermon — re-anchor this test');
  row[0].props.onClick(); await settle();
  assert.equal(w.el.src, 'blob:sha-s1');
  await drill({ redraw, w, want: { next: 'blob:sha-s2', jumpTitle: 'Sermon D', jump: 'blob:sha-s4', prev: 'blob:sha-s3' } });
});

// ─────────────────────────────────── EDGES + the mini player ───────────────────────────────────
test('a single track disables Next (and shows no Up next); the last item of a list disables it too', () => {
  const w = world();
  const draw = () => { const C = w.audio.AudioControls; w.draw(C, {}); return w.draw(C, {}); };
  w.A.play(trk('solo'));
  let tree = draw();
  assert.equal(byLabel(tree, 'Next track')[0].props.disabled, true, 'Next is live with nothing to go to');
  assert.ok(!texts(tree).join(' ').includes('Up next'), 'an "Up next" list for a single track');
  w.A.play(trk('b'), [trk('a'), trk('b')]);
  tree = draw();
  assert.equal(byLabel(tree, 'Next track')[0].props.disabled, true, 'Next is live on the last item');
  w.A.play(trk('a'), [trk('a'), trk('b')]);
  tree = draw();
  assert.equal(byLabel(tree, 'Next track')[0].props.disabled, false, 'Next is dead with an item still to come');
});

test('every control the shared component draws has an accessible name', () => {
  const w = world();
  w.A.play(trk('a'), [trk('a'), trk('b')]);
  w.draw(w.audio.AudioControls, {}); const tree = w.draw(w.audio.AudioControls, {});
  const unnamed = find(tree, n => (n.type === 'button' || (n.props && n.props.role === 'slider')) && !(n.props['aria-label']));
  assert.equal(unnamed.length, 0, 'controls with no aria-label: ' + unnamed.length);
});

test('the docked mini player carries previous / play / next from the same engine', () => {
  const w = world();
  w.A.play(trk('b'), [trk('a'), trk('b'), trk('c')]);
  const draw = () => { w.draw(w.audio.MiniPlayer, { ctx: {} }); return w.draw(w.audio.MiniPlayer, { ctx: {} }); };
  let tree = draw();
  press(tree, 'Next track'); assert.equal(w.el.src, 'blob:c');
  tree = draw(); w.el.currentTime = 0;
  press(tree, 'Previous track'); assert.equal(w.el.src, 'blob:b');
});
