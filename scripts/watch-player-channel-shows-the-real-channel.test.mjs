// The Watch player's Channel button must open the REAL YouTube channel, not nothing, and "Up next" must
// list the other videos.  Run: node --test scripts/watch-player-channel-shows-the-real-channel.test.mjs
//
// M-12. VideoPlayer used to read from Bible.getVideos() which returns the BUNDLED trinity-videos.json —
// always {"channel":null,"videos":[]}. The WatchView has the real channel data from the gateway's /feed
// endpoint, so the fix shares it via a module-level _lastFeed variable. This test renders the REAL
// WatchView and VideoPlayer from screens-watch.jsx and asserts at the screen level (CLAUDE.md rules 1+3):
// if the feature is deleted from the screen, this test fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { miniReact, find, texts, loadScreen } from './render-jsx-screen.mjs';

const CHANNEL = {
  name: 'St Rig Church', handle: '@strig', url: 'https://youtube.com/@strig',
  avatar: 'https://i.ytimg.com/vi/test/default.jpg',
};
const VIDEOS = [
  { id: 'v1', ytId: 'dQw4w9WgXcQ', title: 'Sunday sermon 1', published: '2026-09-01', thumb: '' },
  { id: 'v2', ytId: 'xvFZjo5PgG0', title: 'Sunday sermon 2', published: '2026-09-08', thumb: '' },
  { id: 'v3', ytId: 'abc12345678', title: 'Sunday sermon 3', published: '2026-09-15', thumb: '' },
];
const FEED = { channel: CHANNEL, videos: VIDEOS };

function setup() {
  const { React, draw } = miniReact();
  let opened = [];
  const win = {
    Fellowship: {
      subscribeSermons: (_npub, cb) => { cb([]); return () => {}; },
      gatewayBase: () => 'http://localhost:9999',
    },
    Bible: { getVideos: async () => ({ channel: null, videos: [] }) },
    TrinityAudio: { play() {} },
    open: (url) => { opened.push(url); },
  };
  // fetch stub: the WatchView calls /feed, and it should get our FEED data back
  const stubFetch = async (url) => ({
    json: async () => FEED,
    ok: true,
  });
  const globals = {
    React, window: win,
    Icon: () => null,
    SectionLabel: ({ children }) => React.createElement('div', { className: 'section-label' }, children),
    Overlay: ({ children, open }) => open ? React.createElement('div', { className: 'overlay' }, children) : null,
    BottomSheet: ({ children, open }) => open ? children : null,
    IconBtn: ({ name, onClick }) => React.createElement('button', { onClick, className: 'icon-btn-' + name }),
    SermonRow: () => null,
    safeCssColor: (c) => c || '#888',
    setTimeout, clearTimeout, fetch: stubFetch, encodeURIComponent,
    Math, Date, JSON, String, Number, Boolean, Object, Array, Set, Map, console, Promise, RegExp,
    URL: globalThis.URL,
  };
  const mod = loadScreen('app/screens-watch.jsx', ['WatchView', 'VideoPlayer'], globals);
  return { React, draw, mod, opened, win };
}

const settle = () => new Promise(r => setTimeout(r, 50));

test('CONTROL: WatchView tab header shows the real channel name and a working Channel button', async () => {
  const { React, draw, mod, opened } = setup();
  const ctx = { church: { npub: 'npub1c', name: 'St Rig Church', channel: 'https://youtube.com/@strig' }, toast() {}, openVideo() {} };
  draw(mod.WatchView, { ctx });
  await settle();
  const tree = draw(mod.WatchView, { ctx });
  const allText = texts(tree).join(' ');
  assert.match(allText, /St Rig Church/,
    'the WatchView tab header should show the real channel name. Got: ' + allText);
  // Find and click the Channel button in WatchView
  const btns = find(tree, n => n.type === 'button' && texts(n).join(' ').includes('Channel'));
  assert.ok(btns.length >= 1, 'no Channel button found in WatchView. Screen: ' + allText);
  btns[0].props.onClick();
  assert.ok(opened.length > 0, 'clicking Channel in WatchView did not open anything');
});

test('VideoPlayer shows the real channel name, a working Channel button, and "Up next" — not "Church" with nothing', async () => {
  const { React, draw, mod, opened, win } = setup();
  // First render WatchView so _lastFeed is populated
  const ctx = { church: { npub: 'npub1c', name: 'St Rig Church', channel: 'https://youtube.com/@strig' }, toast() {}, openVideo() {} };
  draw(mod.WatchView, { ctx });
  await settle();
  draw(mod.WatchView, { ctx });

  // Now render VideoPlayer with one of those videos
  const video = { id: 'v1', ytId: 'dQw4w9WgXcQ', title: 'Sunday sermon 1', published: '2026-09-01' };
  draw(mod.VideoPlayer, { video, open: true, onClose: () => {}, ctx });
  await settle();
  const tree = draw(mod.VideoPlayer, { video, open: true, onClose: () => {}, ctx });
  const allText = texts(tree).join(' ');

  // The channel row must show the real channel name, not "Church"
  assert.match(allText, /St Rig Church/,
    'VideoPlayer should show the real channel name, not "Church". Got: ' + allText);
  assert.doesNotMatch(allText, /^Church\s*YouTube$/m,
    'VideoPlayer still shows the fallback "Church YouTube" — the feed data is not reaching it. Got: ' + allText);

  // The Channel button must exist and be clickable
  const channelBtns = find(tree, n => n.type === 'button' && texts(n).join(' ').includes('Channel'));
  assert.ok(channelBtns.length >= 1,
    'no Channel button in VideoPlayer — it is gone or hidden because ch.url is missing. Screen: ' + allText);
  channelBtns[0].props.onClick();
  assert.ok(opened.length > 0,
    'clicking Channel in VideoPlayer opened nothing — ch.url is still undefined');

  // "Up next" must list other videos
  assert.match(allText, /Up next/,
    'VideoPlayer has no "Up next" section — the video list is still empty. Screen: ' + allText);
  assert.match(allText, /Sunday sermon 2/,
    '"Up next" does not contain the second video. Screen: ' + allText);
});

test('VideoPlayer without _lastFeed and without a channel gracefully hides the Channel button', async () => {
  // A fresh load where WatchView has never been rendered — _lastFeed is null, and Bible.getVideos()
  // returns the bundled {channel:null,videos:[]}. The Channel button should NOT render (it used to
  // render and open nothing).
  const { React, draw, mod } = miniReact_fresh();
  const video = { id: 'v1', ytId: 'dQw4w9WgXcQ', title: 'Sunday sermon 1' };
  const ctx = { church: { npub: 'npub1c', name: 'Rig' }, toast() {}, openVideo() {} };
  draw(mod.VideoPlayer, { video, open: true, onClose: () => {}, ctx });
  await settle();
  const tree = draw(mod.VideoPlayer, { video, open: true, onClose: () => {}, ctx });
  // Because this is a FRESH module load, _lastFeed is null and data.channel is null,
  // so the Channel button should not render.
  const channelBtns = find(tree, n => n.type === 'button' && texts(n).join(' ').includes('Channel'));
  assert.equal(channelBtns.length, 0,
    'a Channel button is showing even though there is no channel data — it opens nothing and confuses');
});

// A second, independent module load where _lastFeed starts null.
function miniReact_fresh() {
  const { React, draw } = miniReact();
  const win = {
    Fellowship: {
      subscribeSermons: (_npub, cb) => { cb([]); return () => {}; },
      gatewayBase: () => '',
    },
    Bible: { getVideos: async () => ({ channel: null, videos: [] }) },
    TrinityAudio: { play() {} },
    open: () => {},
  };
  const globals = {
    React, window: win,
    Icon: () => null,
    SectionLabel: ({ children }) => React.createElement('div', {}, children),
    Overlay: ({ children, open }) => open ? React.createElement('div', {}, children) : null,
    BottomSheet: ({ children, open }) => open ? children : null,
    IconBtn: ({ name, onClick }) => React.createElement('button', { onClick }),
    SermonRow: () => null,
    safeCssColor: (c) => c || '#888',
    setTimeout, clearTimeout,
    fetch: async () => ({ json: async () => ({ channel: null, videos: [] }), ok: true }),
    encodeURIComponent,
    Math, Date, JSON, String, Number, Boolean, Object, Array, Set, Map, console, Promise, RegExp,
    URL: globalThis.URL,
  };
  const mod = loadScreen('app/screens-watch.jsx', ['VideoPlayer'], globals);
  return { React, draw, mod };
}
