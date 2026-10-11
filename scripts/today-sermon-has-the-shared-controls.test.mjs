// THE TODAY CARD'S SERMON PLAYS WITH A QUEUE, SO IT HAS THE SAME CONTROLS AS EVERY OTHER AUDIO SURFACE.
//   Run: node --test scripts/today-sermon-has-the-shared-controls.test.mjs
//
// Owner decision 2026-10-10: tapping the featured sermon on Today starts it with the church's sermon list as the
// queue (newest first), so Next plays the next OLDER sermon, fetched only when its turn comes.
//
// HOW THIS REACHES IT (rule 1, rule 3). Mounts the REAL App with every app/*.jsx in index.html order (the same
// loader scripts/a-featured-sermon-shows-its-current-title.test.mjs uses) with the REAL audio engine on a fake
// <audio>. It delivers a pin and a sermon list the way the engine would, takes the ctx App hands the Today screen,
// and calls the `ctx.playSermon` that Today's card calls. Nothing reads app/*.jsx text.
//
// THE CONTROLS ARE ON THE PLAYER (owner 2026-10-11: one player, the floating one). App renders the docked
// MiniPlayer above the tab bar; this file takes THE MiniPlayer element App rendered (its own props), draws it
// through the expanding miniature React in render-jsx-screen.mjs, and PRESSES its controls — Next, Previous,
// seek, the timeline, the speed pill and an Up next jump — after starting the sermon the way Today's card
// does. Tapping the player no longer opens Listen, so nothing here asserts that any more.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fakeReact, appBrowser, loadApp, nodes } from './app-screens.mjs';
import { miniReact, find } from './render-jsx-screen.mjs';

const settle = () => new Promise(r => setTimeout(r, 0));
function fakeEl() {
  const h = {}; let _src = '';
  const el = {
    paused: true, currentTime: 0, duration: 0, defaultPlaybackRate: 1, playbackRate: 1,
    addEventListener(t, f) { (h[t] = h[t] || []).push(f); }, setAttribute() {},
    get src() { return _src; }, set src(v) { _src = v; el.playbackRate = el.defaultPlaybackRate; },
    removeAttribute() { _src = ''; }, load() {},
    play() { el.paused = false; (h.play || []).forEach(f => f()); return Promise.resolve(); },
    pause() { el.paused = true; (h.pause || []).forEach(f => f()); },
  };
  return el;
}

let App, window, reset, flush, el;
const calls = {};
const toasts = [];

before(() => {
  const r = fakeReact();
  reset = r.reset; flush = r.flush;
  window = appBrowser().window;
  el = fakeEl();
  const make = window.document.createElement;
  window.document.createElement = (t) => (t === 'audio' ? el : make(t));
  window.Bible = { loaded: true, activeVersion: 'KJV', subscribe: () => () => {}, books: () => ['John'], maxChapter: () => 21, defaultLoc: () => ({ book: 'John', chap: 1 }) };
  window.MyData = { seedIfEmpty() {}, on: () => () => {}, list: () => [], settings: { get: () => ({}) }, count: () => 0, set: () => {} };
  window.TrinityData = {};
  App = loadApp({ React: r.React, window, expr: 'App' });
  const np = 'npub1' + '0'.repeat(58);
  window.TrinityData.CHURCHES = [{ id: np, npub: np, name: 'Test Church' }];
  window.localStorage.setItem('trinityone.activeChurch', JSON.stringify(np));
  window.Fellowship = new Proxy({ myPubkey: 'deadbeef', CANONICAL_RELAYS: [], hasRelays: true, fetchSermon: async (m) => 'blob:' + m.sha256 }, {
    get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'then' || typeof k === 'symbol') return undefined;
      return (...args) => { (calls[k] = calls[k] || []).push(args); return () => {}; };
    },
  });
});

function draw() { reset(); const tree = App(); flush(); return tree; }
const deliver = (method, value) => (calls[method] || []).forEach(a => a.filter(x => typeof x === 'function').forEach(cb => cb(value)));
const todayCtx = () => {
  const screen = nodes(draw()).find(n => n.props && n.props.ctx && 'pinnedSermon' in n.props.ctx);
  assert.ok(screen, 'no screen received a ctx with pinnedSermon');
  return screen.props.ctx;
};

// THE player App rendered, drawn for real. The app's components resolve `React` from the shared global scope
// at call time, so the expanding miniature React is swapped in for the draw and the App's own fake put back.
const mini = miniReact();
function overlay() {
  const el0 = nodes(draw()).find(n => n.type && n.type.name === 'MiniPlayer');
  assert.ok(el0, 'App no longer renders the docked player');
  const saved = window.React; window.React = mini.React;
  try { mini.draw(el0.type, el0.props); return mini.draw(el0.type, el0.props); } finally { window.React = saved; }
}
const press = (tree, label) => {
  const b = find(tree, n => n.type === 'button' && n.props && n.props['aria-label'] === label);
  assert.equal(b.length, 1, `expected exactly one "${label}" on the player, found ${b.length}`);
  b[0].props.onClick({ stopPropagation() {} });
};

// newest first, as subscribeSermons delivers
const sermon = (id, i) => ({ id, title: 'Sermon ' + id, sha256: 'sha-' + id, hosts: ['https://h'], mime: 'audio/mp4', contentTs: 1000 - i });
const LIST = [sermon('new', 0), sermon('mid', 1), sermon('old', 2), sermon('oldest', 3), { ...sermon('vid', 4), mime: 'video/mp4' }];

test('Today card: the featured sermon starts with a queue, and the player\u2019s Next plays the next OLDER sermon', async () => {
  draw(); await new Promise(r => setTimeout(r, 1500)); draw();
  deliver('subscribeSermons', LIST);
  deliver('subscribePinnedSermon', { ...LIST[1], ts: 1 });
  const ctx = todayCtx();
  assert.equal(ctx.pinnedSermon.id, 'mid', 'fixture: the Today card should be showing the middle sermon');
  await ctx.playSermon(ctx.pinnedSermon);
  assert.equal(el.src, 'blob:sha-mid', 'the tapped sermon did not play');
  const A = window.TrinityAudio;
  assert.equal(A.current.id, 'mid');
  assert.equal(A.hasNext(), true, 'NO NEXT: the Today card still starts its sermon with no queue');
  assert.equal(A.hasPrev(), true, 'the newer sermon should be reachable with Previous');
  press(overlay(), 'Next track'); await settle();
  assert.equal(A.current.id, 'old', 'the player\u2019s Next did not go to the next OLDER sermon');
  assert.equal(el.src, 'blob:sha-old', 'the older sermon was not fetched when its turn came');
  press(overlay(), 'Next track'); await settle();
  assert.equal(A.current.id, 'oldest');
  assert.equal(find(overlay(), n => n.type === 'button' && n.props['aria-label'] === 'Next track')[0].props.disabled, true, 'the video sermon must not be in the audio queue');
  el.currentTime = 0;
  press(overlay(), 'Previous track'); await settle();
  assert.equal(A.current.id, 'old');
});

test('Today card: a pinned sermon that is not in the church list plays on its own (no queue, nothing breaks)', async () => {
  window.TrinityAudio.stop();
  deliver('subscribeSermons', [LIST[0]]);
  const solo = { ...sermon('solo', 9), ts: 1 };
  deliver('subscribePinnedSermon', solo);
  const ctx = todayCtx();
  await ctx.playSermon(ctx.pinnedSermon);
  assert.equal(el.src, 'blob:sha-solo');
  assert.equal(window.TrinityAudio.hasNext(), false);
});

test('Today: App renders THE player, and its timeline, \u00b110, speed pill and Up next drive the Today sermon', async () => {
  window.TrinityAudio.stop();
  deliver('subscribeSermons', LIST);
  deliver('subscribePinnedSermon', { ...LIST[0], ts: 1 });
  const ctx = todayCtx();
  await ctx.playSermon(ctx.pinnedSermon);
  assert.equal(el.src, 'blob:sha-new', 'the featured sermon did not start — re-anchor this test');
  let tree = overlay();
  el.duration = 100; el.currentTime = 20;
  press(tree, 'Forward 10 seconds'); assert.equal(el.currentTime, 30, 'the player\u2019s +10 did nothing');
  press(tree, 'Back 10 seconds'); assert.equal(el.currentTime, 20, 'the player\u2019s -10 did nothing');
  const sl = find(tree, n => n.props && n.props.role === 'slider');
  assert.equal(sl.length, 1, 'no timeline on the player');
  sl[0].props.onPointerDown({ currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 200 }), setPointerCapture() {} }, clientX: 150, pointerId: 1 });
  assert.equal(el.currentTime, 75, 'tapping the timeline did not seek');
  const pill = find(tree, n => n.type === 'button' && /^Playback speed /.test(n.props['aria-label'] || ''));
  assert.equal(pill.length, 1, 'no speed pill on the player');
  pill[0].props.onClick(); assert.equal(el.playbackRate, 1.25, 'the speed pill did nothing');
  assert.equal(find(tree, n => n.props && n.props.role === 'list').length, 0, 'Up next must start collapsed');
  press(tree, 'Up next');
  tree = overlay();
  assert.equal(find(tree, n => n.props && n.props.role === 'list' && n.props['aria-label'] === 'Up next').length, 1, 'Up next did not open');
  press(tree, 'Play Sermon oldest'); await settle();
  assert.equal(window.TrinityAudio.current.id, 'oldest', 'an Up next jump did not play that sermon');
  assert.equal(el.src, 'blob:sha-oldest');
});

// AUDIT OF e4a17a0, D1: the desktop layout (a wide window: fullscreen && width >= 900) had NO player, so with
// the page cards gone, audio started there could not be paused, skipped or stopped. App must render THE player
// in that layout too — inline, on its own row under the content — and its controls must work.
test('Desktop layout (window >= 900px): App renders THE player inline, and its Pause pauses', async () => {
  window.TrinityAudio.stop();
  window.innerWidth = 1200;
  window.dispatch('resize');
  try {
    draw(); draw();
    deliver('subscribeSermons', LIST);
    deliver('subscribePinnedSermon', { ...LIST[0], ts: 1 });
    const ctx = todayCtx();
    await ctx.playSermon(ctx.pinnedSermon);
    assert.equal(el.paused, false, 'the featured sermon did not start — re-anchor this test');
    const players = nodes(draw()).filter(n => n.type && n.type.name === 'MiniPlayer');
    assert.equal(players.length, 1, `THE DESKTOP LAYOUT HAS ${players.length} PLAYERS — with no control card on any page, none means audio cannot be stopped`);
    assert.equal(players[0].props.inline, true, 'the desktop player is the floating tab-bar one — desktop has no tab bar to dock above');
    const saved = window.React; window.React = mini.React;
    let tree;
    try { mini.draw(players[0].type, players[0].props); tree = mini.draw(players[0].type, players[0].props); } finally { window.React = saved; }
    press(tree, 'Pause');
    assert.equal(el.paused, true, 'the desktop player’s Pause did not pause');
  } finally { window.innerWidth = 390; window.dispatch('resize'); draw(); }
});
