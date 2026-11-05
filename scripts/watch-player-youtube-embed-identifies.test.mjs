// The Watch player's YouTube embed must carry identification params (so the app's WebView is not shown the
// "confirm you're not a bot" wall), and it must offer an always-present "Watch on YouTube" escape hatch — for
// YouTube videos only, never for a self-hosted sermon.
// Run: node --test scripts/watch-player-youtube-embed-identifies.test.mjs
//
// D1 (embed-URL identification) + Option A (external-watch fallback). CLAUDE.md rules 1+3: these assert at the
// point of USE by LIFTING and RUNNING the real functions/components out of app/screens-watch.jsx — never by
// matching text in the .jsx, which ships unbundled so `false && ` leaves every word in place.
//   (1) lifts ytEmbedSrc and runs it — every param must be present;
//   (2) renders the REAL VideoPlayer and reads the iframe's src off the tree — it must be exactly what the
//       builder produces, so reverting the iframe to an inline string fails this;
//   (3) renders the REAL VideoPlayer and reads the "Watch on YouTube" control off the tree — present and
//       opening youtu.be/<ytId> for a YouTube video, absent for a self-hosted sermon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { miniReact, find, texts, loadScreen } from './render-jsx-screen.mjs';

function setup() {
  const { React, draw } = miniReact();
  let opened = [];
  const win = {
    Fellowship: {
      subscribeSermons: (_npub, cb) => { cb([]); return () => {}; },
      gatewayBase: () => 'http://localhost:9999',
      mediaDecryptor: async () => null,
      fetchSermon: async () => null,
    },
    Bible: { getVideos: async () => ({ channel: null, videos: [] }) },
    TrinityAudio: { play() {} },
    open: (url) => { opened.push(url); },
  };
  const globals = {
    React, window: win,
    Icon: () => null,
    SectionLabel: ({ children }) => React.createElement('div', { className: 'section-label' }, children),
    Overlay: ({ children, open }) => open ? React.createElement('div', { className: 'overlay' }, children) : null,
    BottomSheet: ({ children, open }) => open ? children : null,
    IconBtn: ({ name, onClick }) => React.createElement('button', { onClick, className: 'icon-btn-' + name }),
    SermonRow: () => null,
    safeCssColor: (c) => c || '#888',
    setTimeout, clearTimeout, fetch: async () => ({ json: async () => ({ channel: null, videos: [] }), ok: true }),
    encodeURIComponent,
    Math, Date, JSON, String, Number, Boolean, Object, Array, Set, Map, console, Promise, RegExp,
    URL: globalThis.URL, AbortController: globalThis.AbortController,
  };
  const mod = loadScreen('app/screens-watch.jsx', ['WatchView', 'VideoPlayer', 'ytEmbedSrc'], globals);
  return { React, draw, mod, opened };
}

const settle = () => new Promise(r => setTimeout(r, 50));

// ── (1) the builder itself ──────────────────────────────────────────────────────────────────────────────
test('ytEmbedSrc carries the no-cookie host, the original params, AND the identification params', () => {
  const { mod } = setup();
  const src = mod.ytEmbedSrc('dQw4w9WgXcQ');
  // cookieless host kept (privacy): never switch to youtube.com
  assert.match(src, /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/,
    'embed src must stay on the cookieless youtube-nocookie host. Got: ' + src);
  // the original three
  assert.match(src, /autoplay=1/, 'lost autoplay=1. Got: ' + src);
  assert.match(src, /rel=0/, 'lost rel=0. Got: ' + src);
  assert.match(src, /modestbranding=1/, 'lost modestbranding=1. Got: ' + src);
  // the three D1 identification params
  assert.match(src, /[?&]origin=https:\/\/com\.trinityone\.app/,
    'missing origin= (YouTube\'s WebView identification substitute). Got: ' + src);
  assert.match(src, /[?&]enablejsapi=1/, 'missing enablejsapi=1 (without it origin is ignored). Got: ' + src);
  assert.match(src, /[?&]widget_referrer=https:\/\/com\.trinityone\.app/,
    'missing widget_referrer= (analytics attribution). Got: ' + src);
});

// ── (2) point of use: the iframe src comes from the builder, not an inline string ───────────────────────────
test('VideoPlayer renders the YouTube iframe with exactly the builder\'s src', async () => {
  const { draw, mod } = setup();
  const video = { id: 'v1', ytId: 'dQw4w9WgXcQ', title: 'Sunday sermon', published: '2026-09-01' };
  const ctx = { church: { npub: 'npub1c', name: 'St Rig' }, toast() {}, openVideo() {} };
  draw(mod.VideoPlayer, { video, open: true, onClose: () => {}, ctx });
  await settle();                       // effect sets liveId = video.ytId, so the iframe branch renders
  const tree = draw(mod.VideoPlayer, { video, open: true, onClose: () => {}, ctx });
  const iframes = find(tree, n => n.type === 'iframe');
  assert.equal(iframes.length, 1, 'expected exactly one YouTube iframe on the player; found ' + iframes.length);
  assert.equal(iframes[0].props.src, mod.ytEmbedSrc(video.ytId),
    'the iframe src is NOT the builder output — it has gone back to an inline string. Got: ' + iframes[0].props.src);
  assert.equal(iframes[0].props.referrerPolicy, 'strict-origin-when-cross-origin',
    'the iframe lost its referrerPolicy. Got: ' + iframes[0].props.referrerPolicy);
});

// ── (3) Option A: the "Watch on YouTube" fallback ───────────────────────────────────────────────────────────
test('VideoPlayer shows a "Watch on YouTube" control that opens youtu.be/<ytId> for a YouTube video', async () => {
  const { draw, mod, opened } = setup();
  const video = { id: 'v1', ytId: 'dQw4w9WgXcQ', title: 'Sunday sermon' };
  const ctx = { church: { npub: 'npub1c', name: 'St Rig' }, toast() {}, openVideo() {} };
  draw(mod.VideoPlayer, { video, open: true, onClose: () => {}, ctx });
  await settle();
  const tree = draw(mod.VideoPlayer, { video, open: true, onClose: () => {}, ctx });
  const btns = find(tree, n => n.type === 'button' && texts(n).join(' ').includes('Watch on YouTube'));
  assert.equal(btns.length, 1,
    'no "Watch on YouTube" control on the YouTube player — the escape hatch is gone. Screen: ' + texts(tree).join(' '));
  btns[0].props.onClick();
  assert.deepEqual(opened, ['https://youtu.be/dQw4w9WgXcQ'],
    'the control did not open youtu.be/<ytId>. Opened: ' + JSON.stringify(opened));
});

test('VideoPlayer does NOT show "Watch on YouTube" for a self-hosted sermon', async () => {
  const { draw, mod } = setup();
  const video = { id: 's1', _sermon: true, title: 'Members-only recording', sha256: 'abc', hosts: ['h'], mime: 'video/mp4' };
  const ctx = { church: { npub: 'npub1c', name: 'St Rig' }, toast() {}, openVideo() {} };
  draw(mod.VideoPlayer, { video, open: true, onClose: () => {}, ctx });
  await settle();
  const tree = draw(mod.VideoPlayer, { video, open: true, onClose: () => {}, ctx });
  const btns = find(tree, n => n.type === 'button' && texts(n).join(' ').includes('Watch on YouTube'));
  assert.equal(btns.length, 0,
    'a "Watch on YouTube" control is showing for a self-hosted sermon — it would send members off to YouTube. Screen: ' + texts(tree).join(' '));
  const iframes = find(tree, n => n.type === 'iframe');
  assert.equal(iframes.length, 0, 'a self-hosted sermon must not render a YouTube iframe');
});
