// ONE PLAYER: THE FLOATING ONE. Every audio surface starts playback; only the overlay drives it.
// Run: node --test scripts/audio-controls-are-the-same-on-every-surface.test.mjs
//
// Owner decision 2026-10-10: the same controls everywhere — scrubber, back/forward 10 seconds, previous/next,
// play/pause, playback speed, and what is playing / up next. "Next" for sermons is the next sermon in the list
// it was started from. Chapter-level, never verse-level.
// Owner decision 2026-10-11 (after using it on a phone): "we've kinda doubled up". The floating player above the
// tab bar is THE player — title, timeline, the controls row and a collapsible "Up next" — and the Bible reader,
// Watch and Listen pages draw NO control card of their own. Tapping the player no longer opens Listen.
//
// HOW THIS ASSERTS (CLAUDE.md rules 1 and 3). Nothing here matches text in app/*.jsx. The REAL
// app/screens-audio.jsx is compiled and run against a fake <audio> element that behaves the way the browser
// does where it matters (setting `src` resets playbackRate to the default). The REAL ReadScreen, WatchView and
// ListenScreen are rendered through the miniature React, playback is started the way a member starts it
// (the Bible headphones button, a sermon row, an episode row), each page is checked to carry NO controls of its
// own, and then the buttons the PLAYER drew are PRESSED. The Bible and Watch pages sit under the tab-bar player
// that App renders (App rendering it is asserted in today-sermon-has-the-shared-controls.test.mjs); Listen is a
// full-screen overlay that covers that dock, so it carries the same player at its own foot and the drill
// presses the player found INSIDE the Listen tree. Deleting the player from Listen fails the Listen tests;
// putting a control card back on any page fails that page's "no card" assertion.
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
  const audio = loadScreen('app/screens-audio.jsx', ['MiniPlayer', 'sermonAudioTrack', 'useTrinityAudio'], base);
  // THE player as App docks it above the tab bar. Drawn twice so effects / state settle, like every screen here.
  const player = (ctx = {}) => { draw(audio.MiniPlayer, { ctx }); return draw(audio.MiniPlayer, { ctx }); };
  return { React, draw, el, store, win, base, audio, A: win.TrinityAudio, toasts, player };
}

const trk = (id, extra) => ({ id, title: 'T-' + id, src: 'blob:' + id, ...(extra || {}) });
const byLabel = (tree, label) => find(tree, n => n.type === 'button' && n.props && n.props['aria-label'] === label);
const press = (tree, label) => { const b = byLabel(tree, label); assert.equal(b.length, 1, `expected exactly one control labelled "${label}" on the player, found ${b.length}`); b[0].props.onClick({ stopPropagation() {} }); };
// The speed control is ONE pill; its name carries the current rate, so find it by prefix and tap it.
const speedPill = tree => { const b = find(tree, n => n.type === 'button' && n.props && /^Playback speed /.test(n.props['aria-label'] || '')); assert.equal(b.length, 1, `expected exactly one speed pill, found ${b.length}`); return b[0]; };
const tapSpeed = tree => speedPill(tree).props.onClick({ stopPropagation() {} });
const sliders = tree => find(tree, n => n.props && n.props.role === 'slider');
const upNextList = tree => find(tree, n => n.props && n.props.role === 'list' && n.props['aria-label'] === 'Up next');
const isPlayer = n => typeof n.type === 'function' && n.type.name === 'MiniPlayer';

// EVERY player control, matched by what it does, so "the page has no controls" cannot be satisfied by renaming one.
const CONTROL_LABELS = ['Previous track', 'Back 10 seconds', 'Play', 'Pause', 'Forward 10 seconds', 'Next track', 'Up next'];
const isControl = n => !!(n && n.props && ((n.props.role === 'slider') || (n.props.role === 'list' && n.props['aria-label'] === 'Up next') ||
  (n.type === 'button' && (CONTROL_LABELS.includes(n.props['aria-label']) || /^Playback speed /.test(n.props['aria-label'] || '')))));
// Controls on the PAGE ITSELF: everything in the tree except what is inside a MiniPlayer.
function pageControls(n, out = []) {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(c => pageControls(c, out)); return out; }
  if (isPlayer(n)) return out;
  if (isControl(n)) out.push(n);
  (n.kids || []).forEach(c => pageControls(c, out));
  return out;
}
const assertNoCard = (tree, page) => {
  const c = pageControls(tree);
  assert.equal(c.length, 0, `THE ${page} PAGE DRAWS ITS OWN PLAYBACK CONTROLS (${c.map(n => n.props['aria-label'] || n.props.role).join(', ')}) — ` +
    'owner 2026-10-11: one player, the floating one; the page keeps its list and play buttons only');
  assert.equal(find(tree, n => typeof n.type === 'function' && n.type.name === 'AudioControls').length, 0, `an AudioControls card is back on the ${page} page`);
};

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

test('POINT OF USE — the speed pill on the player shows the current rate and a tap on the last speed wraps to the first', () => {
  const w = world();
  w.A.play(trk('a'), [trk('a'), trk('b')]);
  w.A.setRate(2);
  let tree = w.player();
  const pill = speedPill(tree);
  assert.ok(texts(tree).includes('2×'), 'the pill does not show the current rate');
  assert.equal(find(tree, n => n.props && n.props['aria-label'] === 'Playback speed').length, 0, 'the old chip group is still drawn');
  tapSpeed(tree);
  assert.equal(w.el.playbackRate, 0.75, 'tapping 2x did not wrap to 0.75x');
  assert.equal(w.store['trinityone.audioRate'], '0.75');
  tree = w.player();
  assert.ok(texts(tree).includes('0.75×'));
  assert.equal(pill.props.title.includes('tap to change'), true);
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

// ───────────────────────── the one control drill, run on the player for every surface ─────────────────────────
// Presses the real buttons THE PLAYER drew and checks the ENGINE (the fake <audio> element) moved.
// `redraw()` returns a fresh player tree; `want` names the sources the queue should produce.
async function drill({ redraw, w, want }) {
  const { el } = w;
  let tree = redraw();
  assert.equal(upNextList(tree).length, 0, 'Up next must start COLLAPSED on the player');
  press(tree, 'Up next');
  tree = redraw();
  assert.equal(upNextList(tree).length, 1, 'the "Up next" button did not open the queue on the player');
  assert.equal(find(tree, n => n.props && n.props['aria-current'] === 'true').length, 1, 'the current item is not marked in Up next');

  el.duration = 100; el.currentTime = 20;
  press(tree, 'Forward 10 seconds'); assert.equal(el.currentTime, 30, '+10 did nothing');
  press(tree, 'Back 10 seconds'); assert.equal(el.currentTime, 20, '-10 did nothing');

  const sl = sliders(tree); assert.equal(sl.length, 1, 'no timeline on the player');
  sl[0].props.onPointerDown({ currentTarget: { getBoundingClientRect: () => ({ left: 10, width: 200 }), setPointerCapture() {} }, clientX: 60, pointerId: 1 });
  assert.equal(el.currentTime, 25, 'tapping the timeline did not seek');
  sl[0].props.onPointerMove({ currentTarget: { getBoundingClientRect: () => ({ left: 10, width: 200 }) }, clientX: 110 });
  assert.equal(el.currentTime, 50, 'dragging the timeline did not seek');
  sl[0].props.onPointerUp();

  assert.equal(speedPill(tree).props['aria-label'], 'Playback speed 1×, tap to change');
  tapSpeed(tree); assert.equal(el.playbackRate, 1.25, 'one tap on the speed pill did not go 1 -> 1.25');
  tree = redraw(); assert.equal(speedPill(tree).props['aria-label'], 'Playback speed 1.25×, tap to change', 'the pill does not show the new rate');
  tapSpeed(tree); assert.equal(el.playbackRate, 1.5, 'the speed pill did not go 1.25 -> 1.5');

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
  // the title is the other way to fold the queue
  tree = redraw();
  press(tree, w.A.current.title);
  assert.equal(upNextList(redraw()).length, 0, 'tapping the title did not fold Up next');
}

// ─────────────────────────────────── BIBLE ───────────────────────────────────
test('POINT OF USE — Bible: listening to a chapter puts NO controls on the reader; the player drives it, and next is the next CHAPTER', async () => {
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
    useTrinityAudio: w.audio.useTrinityAudio,
    ReadPlansTabs: Stub('ReadPlansTabs'), BottomSheet: Stub('BottomSheet'), useBackLayer: () => {}, Sheet: Stub('Sheet'), Modal: Stub('Modal'),
    Pill: Stub('Pill'), Row: Stub('Row'), Halo: Stub('Halo'), IconBtn: Stub('IconBtn') };
  const { ReadScreen } = loadScreen('app/screens-read.jsx', ['ReadScreen'], globals);
  const ctx = { loc: { book: 43, chap: 3 }, version: 'WEB', setLoc() {}, toast() {}, highlights: {}, notes: {}, bookmarks: [], toggleBookmark() {}, setHighlight() {}, setNote() {},
    openShareSheet() {}, desktop: false, readScale: 1, removeTranslation() {}, addModule() {}, setVersion() {} };
  const page = () => { w.draw(ReadScreen, { ctx }); return w.draw(ReadScreen, { ctx }); };
  let tree = page();
  const listen = find(tree, n => n.type && n.type.name === 'IconBtn' && n.props.name === 'headphones');
  assert.equal(listen.length, 1, 'no listen button on the reader — re-anchor this test');
  listen[0].props.onClick(); await settle();
  assert.equal(w.el.src, 'https://audio.bible.helloao.org/api/BSB/JHN/3/audio/david.mp3');
  assertNoCard(page(), 'Bible reader');
  await drill({ redraw: () => w.player(), w, want: { next: 'https://audio.bible.helloao.org/api/BSB/JHN/4/audio/david.mp3', jumpTitle: 'John 6',
    jump: 'https://audio.bible.helloao.org/api/BSB/JHN/6/audio/david.mp3', prev: 'https://audio.bible.helloao.org/api/BSB/JHN/5/audio/david.mp3' } });
  assertNoCard(page(), 'Bible reader');
});

// ─────────────────────────────────── SERMONS (Watch tab) ───────────────────────────────────
const SERMONS = ['s1', 's2', 's3', 's4'].map((id, i) => ({ id, title: 'Sermon ' + 'ABCD'[i], mime: 'audio/mp4', sha256: 'sha-' + id, hosts: ['h'], contentTs: 1000 + i }));

test('POINT OF USE — Sermons (Watch): a sermon started from the list puts NO controls on the page; the player drives it, next = next sermon in that list', async () => {
  const w = world();
  w.win.Fellowship = { subscribeSermons: (_n, cb) => { cb(SERMONS); return () => {}; }, gatewayBase: () => '', fetchSermon: async (m) => 'blob:' + m.sha256 };
  w.win.Bible.getVideos = async () => ({ channel: null, videos: [] });
  const globals = { ...w.base, useTrinityAudio: w.audio.useTrinityAudio, fetch: async () => { throw new Error('no feed expected'); } };
  const { WatchView } = loadScreen('app/screens-watch.jsx', ['WatchView'], globals);
  const ctx = { church: { npub: 'npub1c', name: 'St Mary’s', channel: '' }, toast() {}, openVideo() {} };
  const page = () => { w.draw(WatchView, { ctx }); return w.draw(WatchView, { ctx }); };
  page(); await settle(); const tree = page();
  const row = find(tree, n => n.type === 'button' && texts(n).join(' ').includes('Sermon B'));
  assert.equal(row.length, 1, 'no row for the second sermon — re-anchor this test');
  row[0].props.onClick(); await settle();
  assert.equal(w.el.src, 'blob:sha-s2');
  assert.equal(w.A.current.id, 's2');
  assertNoCard(page(), 'Watch');
  // from s2 the list is [A, B, C, D]: next = C, jump to D, previous from D = C
  await drill({ redraw: () => w.player(), w, want: { next: 'blob:sha-s3', jumpTitle: 'Sermon D', jump: 'blob:sha-s4', prev: 'blob:sha-s3' } });
  assertNoCard(page(), 'Watch');
});

// ─────────────────────────────────── PODCAST + sermons (Listen screen) ───────────────────────────────────
// Listen covers the tab-bar dock, so it must carry THE player itself. `player()` returns the MiniPlayer found
// INSIDE the rendered Listen tree — if Listen stops docking it, there is nothing to press.
async function listenWorld({ audioFeed, sermons }) {
  const w = world();
  w.win.Fellowship = { subscribeSermons: (_n, cb) => { cb(sermons || []); return () => {}; }, gatewayBase: () => 'http://gw', fetchSermon: async (m) => 'blob:' + m.sha256 };
  const eps = ['p1', 'p2', 'p3', 'p4'].map((id, i) => ({ id, title: 'Episode ' + (i + 1), audio: 'https://pod/' + id + '.mp3', published: '2026-01-0' + (i + 1), duration: '42:10' }));
  const globals = { ...w.base, useTrinityAudio: w.audio.useTrinityAudio,
    Sheet: ({ children }) => children, Screen: ({ children }) => children, Overlay: ({ children }) => children,
    fetch: async () => ({ json: async () => ({ channel: { name: 'The Pod' }, episodes: eps }) }) };
  const { ListenScreen } = loadScreen('app/screens-extras.jsx', ['ListenScreen'], globals);
  const ctx = { church: { npub: 'npub1c', name: 'St Mary’s', audioFeed }, toast() {} };
  const page = () => { w.draw(ListenScreen, { open: true, onClose() {}, ctx }); return w.draw(ListenScreen, { open: true, onClose() {}, ctx }); };
  const player = () => { const p = find(page(), isPlayer); assert.equal(p.length, 1, 'THE LISTEN SCREEN CARRIES NO PLAYER — it covers the tab-bar dock, so without its own there are no controls at all'); return p[0]; };
  page(); await settle(); await settle(); page();
  return { w, page, player };
}

test('POINT OF USE — Podcast (Listen): an episode puts NO card on the page; the player docked on Listen drives it, next = next episode', async () => {
  const { w, page, player } = await listenWorld({ audioFeed: 'http://feed', sermons: [] });
  let tree = page();
  assert.equal(byLabel(tree, 'Next track').length, 0, 'a player is showing before anything is playing');
  const row = find(tree, n => n.type === 'button' && texts(n).join(' ').includes('Episode 2'));
  assert.equal(row.length, 1, 'no row for the second episode — re-anchor this test');
  row[0].props.onClick(); await settle();
  assert.equal(w.el.src, 'https://pod/p2.mp3');
  assertNoCard(page(), 'Listen');
  await drill({ redraw: player, w, want: { next: 'https://pod/p3.mp3', jumpTitle: 'Episode 4', jump: 'https://pod/p4.mp3', prev: 'https://pod/p3.mp3' } });
  assertNoCard(page(), 'Listen');
});

test('POINT OF USE — Sermons (Listen): started from this list, next is the next sermon in it — not a podcast episode', async () => {
  const { w, page, player } = await listenWorld({ audioFeed: 'http://feed', sermons: SERMONS });
  const row = find(page(), n => n.type === 'button' && texts(n).join(' ').includes('Sermon A'));
  assert.equal(row.length, 1, 'no row for the first sermon — re-anchor this test');
  row[0].props.onClick(); await settle();
  assert.equal(w.el.src, 'blob:sha-s1');
  assertNoCard(page(), 'Listen');
  await drill({ redraw: player, w, want: { next: 'blob:sha-s2', jumpTitle: 'Sermon D', jump: 'blob:sha-s4', prev: 'blob:sha-s3' } });
});

// ─────────────────────────────────── EDGES + the player itself ───────────────────────────────────
test('the player: a single track disables Next and has no Up next; the last item of a list disables Next too', () => {
  const w = world();
  w.A.play(trk('solo'));
  let tree = w.player();
  assert.equal(byLabel(tree, 'Next track')[0].props.disabled, true, 'Next is live with nothing to go to');
  assert.equal(byLabel(tree, 'Up next').length, 0, 'an "Up next" button for a single track');
  w.A.play(trk('b'), [trk('a'), trk('b')]);
  tree = w.player();
  assert.equal(byLabel(tree, 'Next track')[0].props.disabled, true, 'Next is live on the last item');
  w.A.play(trk('a'), [trk('a'), trk('b')]);
  tree = w.player();
  assert.equal(byLabel(tree, 'Next track')[0].props.disabled, false, 'Next is dead with an item still to come');
});

test('the player: every control has an accessible name AND a title, with Up next open', () => {
  const w = world();
  w.A.play(trk('a'), [trk('a'), trk('b')]);
  press(w.player(), 'Up next');
  const tree = w.player();
  assert.equal(upNextList(tree).length, 1);
  const ctl = find(tree, n => n.type === 'button' || (n.props && n.props.role === 'slider'));
  assert.ok(ctl.length >= 10, 'expected the full set of controls on the player, found ' + ctl.length);
  const bad = ctl.filter(n => !n.props['aria-label'] || !n.props.title);
  assert.equal(bad.length, 0, 'controls missing aria-label or title: ' + bad.map(n => n.props['aria-label'] || '?').join(', '));
});

test('the player: tapping it does NOT navigate to Listen; Close stops playback', () => {
  const w = world();
  const opened = [];
  w.A.play(trk('a'), [trk('a'), trk('b')]);
  const tree = w.player({ openListen: () => opened.push(1) });
  // every handler anywhere on the player except its own buttons/slider: none may open Listen
  const clickable = find(tree, n => n.props && typeof n.props.onClick === 'function' && n.type !== 'button');
  assert.equal(clickable.length, 0, 'something on the player other than a button takes a tap — the old "open Listen" target is back');
  press(tree, 'Close player');
  assert.equal(opened.length, 0, 'a player tap opened Listen');
  assert.equal(w.A.current, null, 'Close did not stop playback');
  assert.equal(find(w.player(), n => n.type === 'button').length, 0, 'the player is still drawn with nothing loaded');
});

// ───────────── a sermon still downloading must not let the PREVIOUS one play under its title ─────────────
async function watchWorld(fetchSermon) {
  const w = world();
  w.win.Fellowship = { subscribeSermons: (_n, cb) => { cb(SERMONS); return () => {}; }, gatewayBase: () => '', fetchSermon };
  w.win.Bible.getVideos = async () => ({ channel: null, videos: [] });
  const globals = { ...w.base, useTrinityAudio: w.audio.useTrinityAudio, fetch: async () => { throw new Error('no feed'); } };
  const { WatchView } = loadScreen('app/screens-watch.jsx', ['WatchView'], globals);
  const ctx = { church: { npub: 'npub1c', name: 'St Mary’s', channel: '' }, toast: m => w.toasts.push(m), openVideo() {} };
  const page = () => { w.draw(WatchView, { ctx }); return w.draw(WatchView, { ctx }); };
  page(); await settle(); const tree = page();
  find(tree, n => n.type === 'button' && texts(n).join(' ').includes('Sermon A'))[0].props.onClick(); await settle();
  assert.equal(w.el.src, 'blob:sha-s1', 'sermon A did not start — re-anchor this test');
  return { w, redraw: () => w.player(), page };
}

test('POINT OF USE — while the next sermon downloads, the player’s Play / seek / timeline cannot drive the previous one', async () => {
  let release; const gate = new Promise(r => { release = r; });
  const { w, redraw } = await watchWorld(async (m) => { if (m.sha256 === 'sha-s2') await gate; return 'blob:' + m.sha256; });
  w.el.duration = 100; w.el.currentTime = 40; w.el.emit('timeupdate');   // the timeline is at 40s of sermon A
  press(redraw(), 'Next track');                       // sermon B starts downloading
  const tree = redraw();
  assert.equal(w.A.current.id, 's2');
  assert.equal(w.el.src, '', 'the old sermon is still loaded in the element while the new one downloads');
  assert.equal(byLabel(tree, 'Play').length, 1, 'no Play button while loading');
  press(tree, 'Play'); assert.equal(w.el.paused, true, 'PLAY RESUMED THE PREVIOUS SERMON under the new title');
  w.el.duration = 100; w.el.currentTime = 40;
  press(tree, 'Forward 10 seconds'); assert.equal(w.el.currentTime, 40, '+10 moved the old sermon');
  sliders(tree)[0].props.onPointerDown({ currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 100 }), setPointerCapture() {} }, clientX: 90, pointerId: 1 });
  assert.equal(w.el.currentTime, 40, 'the timeline moved the old sermon');
  assert.equal(sliders(tree)[0].props['aria-valuenow'], 0, 'the timeline still shows the old position');
  release(); await settle();
  assert.equal(w.el.src, 'blob:sha-s2'); assert.equal(w.el.paused, false, 'the new sermon did not start once it arrived');
});

test('POINT OF USE — a sermon that fails to download says so ON THE PLAYER; the player’s Play retries it', async () => {
  let fail = true;
  const { w, redraw, page } = await watchWorld(async (m) => { if (m.sha256 === 'sha-s2' && fail) throw new Error('offline'); return 'blob:' + m.sha256; });
  press(redraw(), 'Next track'); await settle();
  let tree = redraw();
  assert.match(texts(tree).join(' '), /Couldn.t load/, 'a failed download is silent on the player');
  assert.match(w.toasts.join('|'), /Couldn.t load: offline/);
  assert.equal(w.el.paused, true);
  assertNoCard(page(), 'Watch');
  fail = false;
  press(tree, 'Play'); await settle();
  assert.equal(w.el.src, 'blob:sha-s2', 'Play did not retry the failed sermon');
  tree = redraw(); assert.doesNotMatch(texts(tree).join(' '), /Couldn.t load/, 'the failure notice stayed after a successful retry');
});

test('POINT OF USE — a failed sermon does not block the player’s Next: it moves on to the one after', async () => {
  const { w, redraw } = await watchWorld(async (m) => { if (m.sha256 === 'sha-s2') throw new Error('offline'); return 'blob:' + m.sha256; });
  press(redraw(), 'Next track'); await settle();
  press(redraw(), 'Next track'); await settle();
  assert.equal(w.el.src, 'blob:sha-s3');
});

test('POINT OF USE — Listen: the episode’s own length shows as the player’s total until the audio reports its duration', async () => {
  const { w, page, player } = await listenWorld({ audioFeed: 'http://feed', sermons: [] });
  find(page(), n => n.type === 'button' && texts(n).join(' ').includes('Episode 2'))[0].props.onClick(); await settle();
  w.el.duration = 0;
  assert.equal(find(player(), n => n.type === 'span' && (n.kids || []).includes('42:10')).length, 1, 'the total time is blank on the player before metadata loads');
});
