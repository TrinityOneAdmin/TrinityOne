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
// REACHABILITY OF THE FULL CONTROLS. Today shows the docked MiniPlayer (previous / play / next), and tapping it
// opens the Listen screen, which draws the full AudioControls for any sermon in the church list (covered in
// audio-controls-are-the-same-on-every-surface.test.mjs). This file asserts the two halves that are App's own:
// App renders the MiniPlayer, and its tap target (ctx.openListen) puts the Listen screen on.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { fakeReact, appBrowser, loadApp, nodes } from './app-screens.mjs';

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

// newest first, as subscribeSermons delivers
const sermon = (id, i) => ({ id, title: 'Sermon ' + id, sha256: 'sha-' + id, hosts: ['https://h'], mime: 'audio/mp4', contentTs: 1000 - i });
const LIST = [sermon('new', 0), sermon('mid', 1), sermon('old', 2), sermon('oldest', 3), { ...sermon('vid', 4), mime: 'video/mp4' }];

test('Today card: the featured sermon starts with a queue, and Next plays the next OLDER sermon', async () => {
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
  A.next(); await settle();
  assert.equal(A.current.id, 'old', 'Next did not go to the next OLDER sermon');
  assert.equal(el.src, 'blob:sha-old', 'the older sermon was not fetched when its turn came');
  A.next(); await settle();
  assert.equal(A.current.id, 'oldest');
  assert.equal(A.hasNext(), false, 'the video sermon must not be in the audio queue');
  A.prev(); await settle();
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

test('Today: App renders the docked mini player, and its tap target opens the Listen screen (where the full controls live)', async () => {
  const names = (t) => nodes(t).map(n => n.type && n.type.name).filter(Boolean);
  window.TrinityAudio.stop();
  assert.ok(names(draw()).includes('MiniPlayer'), 'App no longer renders the mini player');
  const ctx = todayCtx();
  assert.equal(typeof ctx.openListen, 'function');
  ctx.openListen();
  const listen = nodes(draw()).filter(n => n.type && n.type.name === 'ListenScreen');
  assert.ok(listen.length && listen.some(n => n.props.open === true), 'openListen did not open the Listen screen');
});
