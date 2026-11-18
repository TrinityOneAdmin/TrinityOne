// THE AUDIO PLAYER RECOVERS: it keeps its place, retries by itself, says "Reconnecting…", and Play or Pause
// always does something. (Plan: TrinityOne-internal/PLAN-AUDIO-PLAYBACK-FIXES-2026-11-18.html, Fix 1 + v3.)
// Run: node --test scripts/the-audio-player-recovers.test.mjs
//
// The owner's reports: "randomly pausing and not starting up again", and "the next chapter not loading until I
// closed the player". The investigation reproduced both in Chromium: a network cut leaves the element in
// `error`, nothing reloads it, and Play calls el.play() on a dead element.
//
// HOW THIS ASSERTS (CLAUDE.md rules 1 and 3). Nothing matches text in app/*.jsx. The REAL app/screens-audio.jsx
// runs against the faithful fake <audio> in scripts/audio-engine-world.mjs (which fails the way the HTML spec
// and the investigation's Chromium traces say a real one does), on a fake clock. The buttons pressed are the
// ones the REAL MiniPlayer drew; the media-session handlers invoked are the ones the engine REGISTERED.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, find, reads } from './render-jsx-screen.mjs';
import { world } from './audio-engine-world.mjs';

const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
const byLabel = (tree, label) => find(tree, n => n.type === 'button' && n.props && n.props['aria-label'] === label);
const press = (tree, label) => { const b = byLabel(tree, label); assert.equal(b.length, 1, `expected exactly one control labelled "${label}" on the player, found ${b.length}`); b[0].props.onClick({ stopPropagation() {} }); };
const caption = tree => reads(tree);
const spinning = tree => find(tree, n => n.type === 'span' && n.props && n.props.style && /trinitySpin/.test(n.props.style.animation || '')).length > 0;
const RECONNECTING = /Reconnecting/;
const COULDNT = /Couldn.t load/;

// let time pass as it does on a phone: a playing element reports progress every few seconds
async function playOn(w, ms) { for (let t = 0; t < ms; t += 5000) { await w.clock.advance(5000); if (!w.el.paused && !w.el.error) w.el.tick(5); } }

const ch = (n) => ({ id: 'bible:43:' + n, title: 'John ' + n, subtitle: 'Audio Bible', src: 'https://cdn.test/JHN/' + n + '.mp3' });
const BOOK = [1, 2, 3].map(ch);

// a world with the book playing from chapter `start`, chapter length 300 s
async function playing(start = 1, opts) {
  const w = world(opts);
  w.el.lengthOf = () => 300;
  w.A.play(BOOK[start - 1], BOOK);
  await settle();
  assert.equal(w.el.paused, false, 'the chapter did not start — re-anchor this test');
  return w;
}

test('the shipped retry schedule is 2, 5, 15, 30 s and the no-progress guard is 45 s (the browser test shortens them through the hook)', () => {
  const w = world();
  assert.deepEqual(w.A.retrySchedule, { retryMs: [2000, 5000, 15000, 30000], stallMs: 45000 });
  const h = world({ hook: { retryMs: [10, 20], stallMs: 99 } });
  assert.deepEqual(h.A.retrySchedule, { retryMs: [10, 20], stallMs: 99 }, 'the documented test hook is not honoured');
});

test('POINT OF USE — a stream that dies mid-chapter says "Reconnecting…", retries by itself, and resumes AT ITS PLACE', async () => {
  const w = await playing(1);
  w.el.tick(120);
  w.el.net = () => 'fail';
  w.el.failNow(2);
  let tree = w.player();
  assert.match(caption(tree), RECONNECTING, 'the player does not say it is reconnecting');
  assert.equal(byLabel(tree, 'Pause').length, 1, 'while retrying the button must read Pause (it cancels)');
  assert.ok(spinning(tree), 'no spinner while retrying');
  const before = w.el.loads.length;
  await w.clock.advance(2000);
  assert.equal(w.el.loads.length, before + 1, 'NO RETRY 2 s after the error — the element was left dead');
  w.el.net = () => 'ok';
  await w.clock.advance(5000);
  assert.equal(w.el.loads.length, before + 2, 'the second retry did not run');
  assert.equal(w.el.src, BOOK[0].src, 'the retry loaded a different chapter');
  assert.equal(w.el.currentTime, 120, 'THE RETRY DID NOT RESUME AT ITS PLACE');
  assert.equal(w.el.paused, false, 'the retry did not play');
  tree = w.player();
  assert.doesNotMatch(caption(tree), RECONNECTING, '"Reconnecting" stayed after it recovered');
  assert.equal(byLabel(tree, 'Pause').length, 1);
});

test('POINT OF USE — the next chapter\'s FIRST load fails: it retries THAT chapter, from 0:00, and never skips it', async () => {
  const w = await playing(1);
  w.el.tick(120);                      // chapter 1 at 2:00 …
  w.el.net = () => 'fail';
  w.el.tick(180);                      // … plays to its end
  w.el.end();
  await settle();
  assert.equal(w.A.current.id, BOOK[1].id, 'ended did not move to chapter 2');
  assert.match(caption(w.player()), RECONNECTING, 'a failed first load of the next chapter is not being retried');
  w.el.net = () => 'ok';
  await w.clock.advance(2000);
  assert.equal(w.el.src, BOOK[1].src, 'IT SKIPPED THE FAILED CHAPTER (or went back)');
  assert.equal(w.el.currentTime, 0, 'THE NEXT CHAPTER WAS SEEKED TO THE OLD CHAPTER\'S POSITION');
  assert.equal(w.el.paused, false);
  assert.equal(w.A.current.id, BOOK[1].id);
});

test('POINT OF USE — a dead source shows "Couldn\'t load" after 4 retries; then the player\'s Play reloads it', async () => {
  const w = await playing(2);
  w.el.tick(30);
  w.el.net = () => 'fail';
  w.el.failNow(2);
  const before = w.el.loads.length;
  await w.clock.advance(2000 + 5000 + 15000 + 30000);
  assert.equal(w.el.loads.length, before + 4, 'expected exactly 4 automatic retries');
  let tree = w.player();
  assert.match(caption(tree), COULDNT, 'a final failure is silent on the player');
  assert.equal(byLabel(tree, 'Play').length, 1);
  await w.clock.advance(10 * 60000);
  assert.equal(w.el.loads.length, before + 4, 'it kept retrying after it gave up');
  w.el.net = () => 'ok';
  const plays = w.el.plays;
  press(tree, 'Play'); await settle();
  assert.equal(w.el.loads.length, before + 5, 'PLAY ON A FAILED TRACK DID NOT RELOAD IT');
  assert.equal(w.el.currentTime, 30, 'Play after a failure did not resume at the place');
  assert.equal(w.el.paused, false);
  assert.ok(w.el.plays > plays);
  assert.doesNotMatch(caption(w.player()), COULDNT);
});

test('POINT OF USE — Pause during a retry stops it, and nothing restarts by itself; Play then reloads', async () => {
  const w = await playing(1);
  w.el.tick(50);
  w.el.net = () => 'fail';
  w.el.failNow(2);
  const before = w.el.loads.length;
  press(w.player(), 'Pause');
  let tree = w.player();
  assert.equal(byLabel(tree, 'Play').length, 1, 'Pause during a retry did not show Play');
  assert.doesNotMatch(caption(tree), RECONNECTING, 'still "Reconnecting" after Pause');
  assert.equal(spinning(tree), false);
  w.el.net = () => 'ok';
  await w.clock.advance(10 * 60000);
  w.doc.fire('visibilitychange');
  await settle();
  assert.equal(w.el.loads.length, before, 'A RETRY STARTED SOUND AFTER THE LISTENER PRESSED PAUSE');
  press(tree, 'Play'); await settle();
  assert.equal(w.el.loads.length, before + 1, 'Play on the errored element did not reload it');
  assert.equal(w.el.currentTime, 50);
});

test('POINT OF USE — Next during a retry: the new chapter is NOT seeked to the old position, and the old retry never fires', async () => {
  const w = await playing(1);
  w.el.tick(120);
  w.el.net = () => 'hang';
  w.el.failNow(2);
  await w.clock.advance(2000);          // the retry's reload is in flight, its seek-on-load listener waiting
  assert.equal(w.el.src, BOOK[0].src);
  w.el.net = () => 'ok';
  press(w.player(), 'Next track'); await settle();
  assert.equal(w.el.src, BOOK[1].src);
  assert.equal(w.el.currentTime, 0, 'THE NEW CHAPTER WAS SEEKED TO THE OLD ONE\'S POSITION');
  assert.equal(w.el.listeners('loadedmetadata'), 0, 'a seek-on-load listener was left behind');
  const loads = w.el.loads.length;
  await playOn(w, 60000);
  assert.equal(w.el.loads.length, loads, 'the old chapter\'s retry fired after Next');
  assert.equal(w.el.src, BOOK[1].src);
});

test('a slow resolve() (a sermon downloading for over 45 s) is not retried, and no second download starts', async () => {
  const w = world();
  let calls = 0, release;
  const gate = new Promise(r => { release = r; });
  const s = { id: 's', title: 'Sermon', resolve: async () => { calls++; await gate; return 'blob:s'; } };
  w.A.play(s, [s]);
  await settle();
  await w.clock.advance(120000);
  assert.equal(calls, 1, 'A SECOND DOWNLOAD STARTED while the first was still running');
  assert.equal(w.el.loads.length, 0);
  assert.doesNotMatch(caption(w.player()), RECONNECTING);
  release(); await settle();
  assert.equal(w.el.src, 'blob:s');
  assert.equal(w.el.paused, false);
});

test('the end of the queue clears "wants to play": a later error starts nothing', async () => {
  const w = await playing(3);
  w.el.tick(299);
  w.el.end(); await settle();
  assert.equal(w.A.current.id, BOOK[2].id);
  const loads = w.el.loads.length;
  w.el.failNow(2);
  await w.clock.advance(60000);
  w.doc.fire('visibilitychange'); await settle();
  assert.equal(w.el.loads.length, loads, 'THE PLAYER RESTARTED BY ITSELF AFTER THE BOOK ENDED');
  assert.equal(byLabel(w.player(), 'Play').length, 1);
});

test('a play() the browser refuses (NotAllowedError) clears "wants to play"; a later error starts nothing', async () => {
  const w = world();
  w.el.policy = 'deny';
  w.A.play(BOOK[0], BOOK); await settle();
  assert.equal(w.el.paused, true);
  const loads = w.el.loads.length;
  w.el.failNow(2);
  await w.clock.advance(60000);
  assert.equal(w.el.loads.length, loads, 'a refused play() still retried by itself');
  assert.equal(byLabel(w.player(), 'Play').length, 1);
});

test('a sermon blob (it has resolve) that errors is NOT retried by itself; Play re-resolves it ONCE and resumes', async () => {
  const w = world();
  let calls = 0;
  const s = { id: 's', title: 'Sermon', resolve: async () => { calls++; return 'blob:s' + calls; } };
  w.A.play(s, [s]); await settle();
  assert.equal(w.el.src, 'blob:s1');
  w.el.tick(40);
  w.el.failNow(3);
  let tree = w.player();
  assert.match(caption(tree), COULDNT, 'a broken blob must go straight to "Couldn\'t load"');
  await w.clock.advance(120000);
  assert.equal(calls, 1, 'a blob was re-downloaded by itself — a whole sermon on a small pipe');
  press(tree, 'Play'); await settle();
  assert.equal(calls, 2, 'Play did not re-resolve the sermon');
  assert.equal(w.el.src, 'blob:s2', 'Play reused the broken blob instead of resolving a new one');
  assert.equal(w.el.currentTime, 40, 'the re-resolved sermon did not resume at its place');
  await w.clock.advance(120000);
  assert.equal(calls, 2);
});

test('a blob with nothing to rebuild it from (no resolve): Play reloads the SAME blob', async () => {
  const w = world();
  const t = { id: 'x', title: 'First sermon', src: 'blob:x' };
  w.A.play(t, [t]); await settle();
  w.el.failNow(3);
  const tree = w.player();
  assert.match(caption(tree), COULDNT);
  const loads = w.el.loads.length;
  await w.clock.advance(60000);
  assert.equal(w.el.loads.length, loads, 'a blob retried by itself');
  press(tree, 'Play'); await settle();
  assert.equal(w.el.loads.length, loads + 1, 'Play did not reload the blob');
  assert.equal(w.el.loads[w.el.loads.length - 1], 'blob:x');
});

test('return to the app: a stream waiting to retry, or one that gave up, retries NOW (visibilitychange and the App plugin)', async () => {
  const appL = [];
  const capacitor = { Plugins: { App: { addListener: (ev, cb) => { appL.push([ev, cb]); return Promise.resolve({ remove() {} }); } } } };
  const w = await playing(1, { capacitor });
  assert.equal(appL.length, 1, 'the engine did not listen for appStateChange');
  assert.equal(appL[0][0], 'appStateChange');
  w.el.tick(60);
  w.el.net = () => 'fail';
  w.el.failNow(2);
  const before = w.el.loads.length;
  w.el.net = () => 'ok';
  w.doc.fire('visibilitychange'); await settle();
  assert.equal(w.el.loads.length, before + 1, 'coming back to the page did not retry at once');
  assert.equal(w.el.currentTime, 60);
  await playOn(w, 60000);
  assert.equal(w.el.loads.length, before + 1, 'the cancelled timer still fired a second reload');
  // gave up (4 failures), then the phone comes back to the app
  w.el.net = () => 'fail';
  w.el.failNow(2);
  await w.clock.advance(2000 + 5000 + 15000 + 30000);
  assert.match(caption(w.player()), COULDNT);
  w.el.net = () => 'ok';
  const n = w.el.loads.length;
  appL[0][1]({ isActive: false }); await settle();
  assert.equal(w.el.loads.length, n, 'going to the BACKGROUND retried');
  appL[0][1]({ isActive: true }); await settle();
  assert.equal(w.el.loads.length, n + 1, 'returning to the app did not retry a failed stream');
  assert.equal(w.el.paused, false);
});

test('the no-progress guard: 45 s with no progress while playing is an error (and retries); steady timeupdates are not', async () => {
  const w = await playing(1);
  const before = w.el.loads.length;
  for (let i = 0; i < 12; i++) { await w.clock.advance(10000); w.el.tick(10); }
  assert.equal(w.el.loads.length, before, 'a steadily playing track was treated as stalled');
  await w.clock.advance(45000);
  assert.match(caption(w.player()), RECONNECTING, 'a silent stall of 45 s was not treated as an error');
  await w.clock.advance(2000);
  assert.equal(w.el.loads.length, before + 1, 'the stall did not retry');
  assert.equal(w.el.currentTime, 120);
  // and a PAUSED track is never "stalled"
  press(w.player(), 'Pause');
  const n = w.el.loads.length;
  await w.clock.advance(10 * 60000);
  assert.equal(w.el.loads.length, n, 'a paused track was "retried" by the no-progress guard');
});

test('POINT OF USE — +10 and Previous on an errored track move the place and reload there, rather than doing nothing', async () => {
  const w = await playing(2);
  w.el.tick(100);
  w.el.net = () => 'fail';
  w.el.failNow(2);
  await w.clock.advance(2000 + 5000 + 15000 + 30000);   // given up
  w.el.net = () => 'ok';
  press(w.player(), 'Forward 10 seconds'); await settle();
  assert.equal(w.el.currentTime, 110, '+10 on a failed track did not reload at the new place');
  assert.equal(w.el.paused, false);
  w.el.net = () => 'fail';
  w.el.failNow(2);
  w.el.net = () => 'ok';
  press(w.player(), 'Previous track'); await settle();
  assert.equal(w.el.src, BOOK[1].src, 'Previous at 1:50 must restart THIS chapter');
  assert.equal(w.el.currentTime, 0, 'Previous on an errored track did not reload at 0');
  assert.equal(w.el.paused, false);
});

test('the OS media actions: "pause" never starts sound and "play" never stops it; "play" during a retry retries now', async () => {
  const handlers = {};
  const ms = { setActionHandler: (a, fn) => { handlers[a] = fn; } };
  const w = await playing(1, { mediaSession: ms });
  assert.equal(typeof handlers.play, 'function'); assert.equal(typeof handlers.pause, 'function');
  handlers.play(); await settle();
  assert.equal(w.el.paused, false, 'the "play" action PAUSED a playing track — it is a toggle');
  handlers.pause();
  assert.equal(w.el.paused, true);
  handlers.pause(); await settle();
  assert.equal(w.el.paused, true, 'THE "pause" ACTION STARTED SOUND (headphones out, a car) — it is a toggle');
  handlers.play(); await settle();
  assert.equal(w.el.paused, false);
  w.el.tick(70);
  w.el.net = () => 'fail';
  w.el.failNow(2);
  w.el.net = () => 'ok';
  const before = w.el.loads.length;
  handlers.play(); await settle();
  assert.equal(w.el.loads.length, before + 1, '"play" during a pending retry did not retry at once');
  assert.equal(w.el.currentTime, 70);
});

test('POINT OF USE — opening the video player pauses the audio player, and its pending retry never starts sound', async () => {
  const w = await playing(1);
  w.el.tick(20);
  w.el.net = () => 'fail';
  w.el.failNow(2);                        // a retry is now pending
  w.el.net = () => 'ok';
  const globals = { ...w.base, useTrinityAudio: w.audio.useTrinityAudio, fetch: async () => { throw new Error('no feed'); },
    setTimeout, clearTimeout, AbortController };
  w.win.Bible.getVideos = async () => ({ channel: null, videos: [] });
  const { VideoPlayer } = loadScreen('app/screens-watch.jsx', ['VideoPlayer'], globals);
  const ctx = { church: { npub: 'npub1c', name: 'St Mary’s' }, toast() {} };
  w.draw(VideoPlayer, { video: null, open: false, onClose() {}, ctx });
  const loads = w.el.loads.length;
  assert.match(caption(w.player()), RECONNECTING, 'closed video player paused the audio — re-anchor');
  w.draw(VideoPlayer, { video: { id: 'v', ytId: 'abcdefghijk', title: 'Sermon video' }, open: true, onClose() {}, ctx });
  await w.clock.advance(60000);
  assert.equal(w.el.loads.length, loads, 'THE AUDIO RETRY STARTED SOUND OVER THE VIDEO');
  assert.equal(w.el.paused, true);
  assert.equal(byLabel(w.player(), 'Play').length, 1);
});
