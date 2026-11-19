// THE PLAYER FOLLOWS THE PHONE'S AUDIO FOCUS — the WebView is the only focus owner (2026-11-19).
// Plan: TrinityOne-internal/PLAN-audio-focus-single-owner-2026-11-19.md (v3 + v2.1 + R3-1 govern).
// Run: node --test scripts/the-player-follows-the-phones-audio-focus.test.mjs
//
// The bug: on the Oppo every play paused itself a split second later. The vendored MediaSessionService requested
// audio focus AND the WebView's <audio> did (Chromium AudioFocusDelegate); each knocked the other out, and the
// service's loss fired "pause". The service no longer requests focus (that Java cannot run here; the device log is
// the proof). With the WebView owning focus, the SYSTEM now pauses and resumes the element itself on a call, and the
// engine must follow a pause it did not cause, and refuse a resume the listener did not want.
//
// HOW THIS ASSERTS (CLAUDE.md rules 1 and 3): the REAL app/screens-audio.jsx, the faithful fake <audio>
// (scripts/audio-engine-world.mjs: queued `pause`/`ended` as separate tasks, el.ended computed, no event for pausing a
// paused element, a load drops a queued pause, sysPause/sysResume for what Chromium does on focus changes), a fake
// MediaSession plugin with the real call shapes, the REAL MiniPlayer's buttons, the handlers the engine REGISTERED.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { find, reads, loadScreen } from './render-jsx-screen.mjs';
import { world } from './audio-engine-world.mjs';

const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
const byLabel = (tree, label) => find(tree, n => n.type === 'button' && n.props && n.props['aria-label'] === label);
const press = (tree, label) => { const b = byLabel(tree, label); assert.equal(b.length, 1, `expected exactly one "${label}" on the player, found ${b.length}`); b[0].props.onClick({ stopPropagation() {} }); };
const spinning = tree => find(tree, n => n.type === 'span' && n.props && n.props.style && /trinitySpin/.test(n.props.style.animation || '')).length > 0;

function fakePlugin({ refuseStart = false } = {}) {
  const calls = [], handlers = {};
  let n = 0, native = 'none';
  const P = {
    setMetadata(o) { calls.push(['meta', o]); return (o && Array.isArray(o.artwork) && o.artwork.every(a => /^data:/.test(a.src || ''))) ? Promise.resolve() : Promise.reject(new Error('artwork')); },
    setPlaybackState(o) {
      calls.push(['state', o.playbackState]);
      if (o.playbackState !== 'none' && native === 'none' && refuseStart) return Promise.reject(new Error('The playback service could not start'));
      native = o.playbackState; return Promise.resolve();
    },
    setPositionState(o) { calls.push(['pos', o]); return Promise.resolve(); },
    setActionHandler(opts, cb) {
      if (opts.remove) { delete handlers[opts.action]; return String(++n); }
      handlers[opts.action] = cb; return String(++n);
    },
  };
  return { P, handlers, states: () => calls.filter(c => c[0] === 'state').map(c => c[1]),
    cap: { isPluginAvailable: name => name === 'MediaSession', Plugins: { MediaSession: P } } };
}
const ch = (n) => ({ id: 'bible:43:' + n, title: 'John ' + n, subtitle: 'Audio Bible', src: 'https://cdn.test/JHN/' + n + '.mp3' });
const BOOK = [1, 2, 3].map(ch);
async function playing(opts, start = 0) {
  const f = fakePlugin(opts);
  const w = world({ capacitor: f.cap });
  w.el.lengthOf = () => 300;
  w.A.play(BOOK[start], BOOK); await settle();
  assert.equal(w.el.paused, false, 're-anchor: it did not start');
  w.el.tick(30);
  return { w, f };
}
const last = (f) => f.states()[f.states().length - 1];
const ALL_RETRIES = 2000 + 5000 + 15000 + 30000 + 45000;

test('a SYSTEM pause (a call): the player shows Play with no spinner, the OS says "paused", and nothing restarts by itself', async () => {
  const { w, f } = await playing();
  w.el.emit('waiting');                                  // mid-buffer, so a spinner was showing
  w.el.sysPause(); await settle();
  const tree = w.player();
  assert.equal(byLabel(tree, 'Play').length, 1, 'THE PLAYER STILL SAYS PLAYING after the phone paused it');
  assert.equal(spinning(tree), false, 'an endless spinner after a system pause');
  assert.equal(last(f), 'paused', 'the lock screen still says playing');
  const loads = w.el.loads.length, plays = w.el.plays;
  await w.clock.advance(ALL_RETRIES);
  w.doc.fire('visibilitychange'); await settle();
  assert.equal(w.el.plays, plays, 'THE ENGINE STARTED SOUND DURING THE CALL');
  assert.equal(w.el.loads.length, loads, 'a retry/stall reload ran during the call');
  assert.equal(w.el.paused, true);
});

test('owner 2026-11-19: if the phone RESUMES after the call, the player resumes: OS "playing", the button says Pause', async () => {
  const { w, f } = await playing();
  w.el.sysPause(); await settle();
  w.el.sysResume(); await settle();
  assert.equal(w.el.paused, false, 'the player fought the phone\'s resume');
  assert.equal(last(f), 'playing', 'the OS was not told it is playing again');
  assert.equal(byLabel(w.player(), 'Pause').length, 1);
  // and it is an ordinary playing track again: a later stall is guarded, an error retries
  w.el.net = () => 'fail'; w.el.failNow(2);
  const loads = w.el.loads.length;
  await w.clock.advance(2000);
  assert.equal(w.el.loads.length, loads + 1, 'after the resume, an error no longer retries (held was never cleared)');
});

test('the listener PAUSES during the call: when the phone resumes, the player pauses again and stays paused', async () => {
  const { w, f } = await playing();
  w.el.sysPause(); await settle();
  press(w.player(), 'Play'); press(w.player(), 'Pause'); await settle();   // or the notification's Pause: the element is already paused
  const plays = w.el.plays;
  w.el.sysResume(); await settle();
  assert.equal(w.el.paused, true, 'THE PHONE RESUMED A PLAYER THE LISTENER HAD PAUSED');
  assert.equal(last(f), 'paused');
  assert.equal(byLabel(w.player(), 'Play').length, 1);
  assert.equal(w.el.plays, plays);
});

test('the registered "play" (headset, notification) during a held pause plays, and clears the hold', async () => {
  const { w, f } = await playing();
  w.el.sysPause(); await settle();
  f.handlers.play({ action: 'play' }); await settle();
  assert.equal(w.el.paused, false);
  assert.equal(last(f), 'playing');
  w.el.sysPause(); await settle();                       // a second call is still a system pause
  assert.equal(last(f), 'paused');
});

test('the end of a chapter (pause and ended as SEPARATE tasks) is not a system pause: it advances, and the OS never says "paused"', async () => {
  const { w, f } = await playing();
  w.el.tick(269); w.el.end(); await settle();
  assert.equal(w.A.current.id, BOOK[1].id, 'the next chapter did not start');
  assert.equal(w.el.paused, false);
  assert.deepEqual(f.states(), ['playing'], 'THE OS WAS TOLD "paused" BETWEEN CHAPTERS: ' + f.states().join(','));
});

test('a pause that follows a stream error is not a system pause: the retry runs as before', async () => {
  const { w } = await playing();
  w.el.net = () => 'fail'; w.el.failNow(2); await settle();
  assert.match(reads(w.player()), /Reconnecting/);
  const loads = w.el.loads.length;
  await w.clock.advance(2000);
  assert.equal(w.el.loads.length, loads + 1, 'the error retry did not run');
});

test('an error DURING a held pause: "Couldn\'t load", OS "paused", no retry; the listener\'s Play reloads', async () => {
  const { w, f } = await playing();
  w.el.sysPause(); await settle();
  w.el.net = () => 'fail'; w.el.failNow(2); await settle();
  const loads = w.el.loads.length, plays = w.el.plays;
  await w.clock.advance(ALL_RETRIES);
  assert.equal(w.el.loads.length, loads, 'A RETRY RAN DURING THE CALL');
  assert.equal(w.el.plays, plays);
  assert.match(reads(w.player()), /Couldn.t load/);
  assert.equal(last(f), 'paused');
  w.el.net = () => 'ok';
  press(w.player(), 'Play'); await settle();
  assert.equal(w.el.loads.length, loads + 1);
  assert.equal(w.el.paused, false);
  assert.equal(w.el.currentTime, 30, 'Play did not resume at the place');
});

test('a seek on a held, errored track (the lock-screen scrubber, +10) moves the place silently', async () => {
  const { w, f } = await playing();
  w.el.sysPause(); await settle();
  w.el.net = () => 'fail'; w.el.failNow(2); await settle();
  w.el.net = () => 'ok';
  const plays = w.el.plays;
  f.handlers.seekto({ action: 'seekto', seekTime: 100 }); await settle();
  press(w.player(), 'Forward 10 seconds'); await settle();
  assert.equal(w.el.plays, plays, 'A SEEK DURING THE CALL STARTED SOUND');
  assert.equal(w.el.paused, true);
  assert.equal(w.el.currentTime, 110);
  assert.equal(last(f), 'paused');
});

test('Close during a held pause: the OS stays "none", and a late system resume is paused again with no state sent', async () => {
  const { w, f } = await playing();
  w.el.sysPause(); await settle();
  press(w.player(), 'Close player'); await settle();
  assert.equal(last(f), 'none');
  const n = f.states().length;
  w.el.sysPause(); w.el.sysResume(); await settle();
  assert.equal(f.states().length, n, 'A STATE WAS SENT AFTER CLOSE — the service would start again from the background');
  assert.equal(w.el.paused, true);
});

test('held past the 10-minute "none": a late system resume is paused again (no service to keep it alive), no state sent', async () => {
  const { w, f } = await playing();
  w.el.sysPause(); await settle();
  await w.clock.advance(10 * 60000);
  assert.equal(last(f), 'none');
  const n = f.states().length;
  w.el.sysResume(); await settle();
  assert.equal(w.el.paused, true, 'a resumed player played with no notification and no keep-awake');
  assert.equal(f.states().length, n);
  press(w.player(), 'Play'); await settle();            // the listener can still play from inside the app
  assert.equal(w.el.paused, false);
  assert.equal(last(f), 'playing');
});

test('R2-1 — a video opening while paused (no pause event) does not hide the next real call: it is still a system pause, and the resume plays', async () => {
  const { w, f } = await playing();
  press(w.player(), 'Pause'); await settle();
  const globals = { ...w.base, useTrinityAudio: w.audio.useTrinityAudio, fetch: async () => { throw new Error('no feed'); }, setTimeout, clearTimeout, AbortController };
  w.win.Bible.getVideos = async () => ({ channel: null, videos: [] });
  const { VideoPlayer } = loadScreen('app/screens-watch.jsx', ['VideoPlayer'], globals);
  const ctx = { church: { npub: 'npub1c', name: 'St Mary' }, toast() {} };
  w.draw(VideoPlayer, { video: { id: 'v', ytId: 'abcdefghijk', title: 'Sermon video' }, open: true, onClose() {}, ctx });   // pauses an already-paused player
  press(w.player(), 'Play'); await settle();
  assert.equal(w.el.paused, false);
  w.el.sysPause(); await settle();
  assert.equal(last(f), 'paused', 'THE CALL WAS NOT SEEN AS A SYSTEM PAUSE after the video opened');
  w.el.sysResume(); await settle();
  assert.equal(w.el.paused, false);
  assert.equal(last(f), 'playing');
});

test('R3-1 — the service failed to start ("none", not held): the next chapter still auto-advances and keeps playing', async () => {
  const { w, f } = await playing({ refuseStart: true });
  assert.deepEqual(f.states(), ['playing']);           // refused: the engine is back at 'none'
  w.el.tick(269); w.el.end(); await settle();
  assert.equal(w.A.current.id, BOOK[1].id);
  assert.equal(w.el.paused, false, 'THE NEXT CHAPTER WAS KILLED: an engine play in the no-service fallback was paused');
});

test('a call while the OS is at "none" (the service was refused): no state is sent, so nothing tries to start the service from the background', async () => {
  const { w, f } = await playing({ refuseStart: true });
  const n = f.states().length;
  w.el.sysPause(); await settle();
  assert.equal(f.states().length, n, 'A SYSTEM PAUSE SENT "paused" FROM "none" — that starts the foreground service from the background');
  assert.equal(byLabel(w.player(), 'Play').length, 1);
  // R3-1 as written: held + 'none' pauses again, whatever made it 'none'. So with no service (P5), the listener presses
  // Play after the call; Play from inside the app works.
  w.el.sysResume(); await settle();
  assert.equal(w.el.paused, true);
  press(w.player(), 'Play'); await settle();
  assert.equal(w.el.paused, false);
});
