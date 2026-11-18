// LOCK-SCREEN, NOTIFICATION AND BLUETOOTH CONTROLS DRIVE THE ONE PLAYER, AND THE FOREGROUND SERVICE IS HELD WHILE
// THE LISTENER WANTS SOUND. (Plan: TrinityOne-internal/PLAN-AUDIO-PLAYBACK-FIXES-2026-11-18.html, Fix 2 + v3.)
// Run: node --test scripts/the-lock-screen-controls-drive-the-player.test.mjs
//
// HOW THIS ASSERTS (CLAUDE.md rules 1 and 3). Nothing matches text in app/*.jsx. The REAL app/screens-audio.jsx runs
// against the faithful fake <audio> (scripts/audio-engine-world.mjs) with a fake Capacitor MediaSession plugin that
// takes the real plugin's shapes: setActionHandler({ action }, cb) returns a callback id; setMetadata REJECTS when
// artwork is missing or not a data: URI (the two inputs that crashed the unpatched plugin, kept as a guard so the JS
// never leans on the native patch); setPlaybackState('playing') can be told to reject the way the patched plugin does
// when Android refuses the foreground start. The handlers invoked are the ones the engine REGISTERED; the buttons
// pressed are the REAL MiniPlayer's.
//
// The Java itself cannot run here. What it does is proved on the device (the plan's list). The manifest test below
// parses the two tracked manifests; the merged manifest exists only after a Gradle build of the untracked android/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { find } from './render-jsx-screen.mjs';
import { world } from './audio-engine-world.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
const byLabel = (tree, label) => find(tree, n => n.type === 'button' && n.props && n.props['aria-label'] === label);
const press = (tree, label) => { const b = byLabel(tree, label); assert.equal(b.length, 1, `expected exactly one "${label}" on the player, found ${b.length}`); b[0].props.onClick({ stopPropagation() {} }); };
const ACTIONS = ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack', 'stop'];
const FIXED = ACTIONS.filter(a => a !== 'previoustrack' && a !== 'nexttrack');   // registered once; the skips follow the queue (audit #9)

function fakePlugin({ refuseStart = false, rejectAll = false } = {}) {
  const calls = [], handlers = {}, rejects = [];
  let n = 0, native = 'none';
  const no = (why) => { rejects.push(why); return Promise.reject(new Error(why)); };
  const P = {
    setMetadata(o) {
      calls.push(['meta', o]);
      if (rejectAll) return no('setMetadata');
      if (!o || !Array.isArray(o.artwork)) return no('artwork missing');
      if (o.artwork.some(a => !a || !/^data:/.test(a.src || ''))) return no('artwork not data:');
      return Promise.resolve();
    },
    setPlaybackState(o) {
      calls.push(['state', o && o.playbackState]);
      if (rejectAll) return no('setPlaybackState');
      if (!o || !['none', 'paused', 'playing'].includes(o.playbackState)) return no('bad state');
      if (o.playbackState !== 'none' && native === 'none' && refuseStart) return no('The playback service could not start');
      native = o.playbackState; return Promise.resolve();
    },
    setPositionState(o) { calls.push(['pos', o]); return rejectAll ? no('setPositionState') : Promise.resolve(); },
    setActionHandler(opts, cb) {
      if (!opts || !opts.action || typeof cb !== 'function') throw new Error('setActionHandler({ action }, cb)');
      // the patched plugin's { action, remove: true } (build audit #9): the handler goes, the call resolves once
      if (opts.remove) { calls.push(['remove', opts.action]); delete handlers[opts.action]; return String(++n); }
      calls.push(['handler', opts.action]);
      handlers[opts.action] = cb; return String(++n);
    },
  };
  return { P, calls, handlers, rejects, cap: { isPluginAvailable: name => name === 'MediaSession', Plugins: { MediaSession: P } },
    states: () => calls.filter(c => c[0] === 'state').map(c => c[1]), count: k => calls.filter(c => c[0] === k).length };
}

const ch = (n) => ({ id: 'bible:43:' + n, title: 'John ' + n, subtitle: 'Audio Bible', src: 'https://cdn.test/JHN/' + n + '.mp3' });
const BOOK = [1, 2, 3].map(ch);
async function withPlugin(opts) {
  const f = fakePlugin(opts);
  const w = world({ capacitor: f.cap });
  w.el.lengthOf = () => 300;
  return { w, f };
}
// time passing on a phone: a playing element reports progress
async function playOn(w, ms) { for (let t = 0; t < ms; t += 5000) { await w.clock.advance(5000); if (!w.el.paused && !w.el.error) w.el.tick(5); } }

test('the plugin\'s action handlers are registered ONCE, at engine start, and never again per track', async () => {
  const { w, f } = await withPlugin();
  const fixed = () => f.calls.filter(c => c[0] === 'handler' && FIXED.includes(c[1])).map(c => c[1]);
  assert.deepEqual(fixed().sort(), FIXED.slice().sort(), 'not every OS action has a handler');
  w.A.play(BOOK[0], BOOK); await settle();
  press(w.player(), 'Next track'); await settle();
  w.A.play({ id: 's', title: 'Sermon', src: 'blob:s' }); await settle();
  assert.equal(fixed().length, FIXED.length, 'HANDLERS WERE RE-REGISTERED PER TRACK — each one leaks a kept-alive native call');
});

test('audit #9 — the plugin: Previous / Next exist only while the queue has one, and change only when that changes', async () => {
  const { w, f } = await withPlugin();
  const has = () => ['previoustrack', 'nexttrack'].filter(a => typeof f.handlers[a] === 'function');
  assert.deepEqual(has(), [], 'skip handlers before anything is queued');
  w.A.play(BOOK[0], BOOK); await settle();
  assert.deepEqual(has(), ['nexttrack'], 'the first chapter of a book: Next only');
  press(w.player(), 'Next track'); await settle();
  assert.deepEqual(has(), ['previoustrack', 'nexttrack']);
  const adds = f.count('handler');
  press(w.player(), 'Previous track'); w.el.currentTime = 0; press(w.player(), 'Next track'); await settle();
  assert.equal(f.count('handler'), adds + 1, 'a skip handler was re-sent although nothing changed');   // chapter 1 dropped Previous, chapter 2 added it back
  w.el.tick(299); w.el.end(); await settle();          // the last chapter
  assert.deepEqual(has(), ['previoustrack'], 'the last chapter still offers Next');
  w.A.play({ id: 's', title: 'One sermon', src: 'blob:s' }); await settle();
  assert.deepEqual(has(), [], 'A SINGLE SERMON SHOWS PREVIOUS/NEXT — a dead Next in the compact notification');
  assert.equal(typeof f.handlers.seekforward, 'function', 'the +10 s action went with them');
  w.A.play(BOOK[1], BOOK); await settle();
  press(w.player(), 'Close player');
  assert.deepEqual(has(), [], 'Close left the skip handlers registered');
});

test('audit #9 — the navigator path (iOS, web): a single sermon sets Previous / Next to null, so iOS keeps its +/-10 s buttons', async () => {
  const ms = { metadata: null, playbackState: 'none', h: {}, setActionHandler(a, fn) { this.h[a] = fn; } };
  const w = world({ mediaSession: ms });
  w.A.play({ id: 's', title: 'One sermon', src: 'blob:s' }); await settle();
  assert.equal(ms.h.nexttrack, null, 'nexttrack is set for a single sermon');
  assert.equal(ms.h.previoustrack, null, 'previoustrack is set for a single sermon');
  assert.equal(typeof ms.h.seekforward, 'function'); assert.equal(typeof ms.h.seekbackward, 'function');
  w.A.play(BOOK[1], BOOK); await settle();
  assert.equal(typeof ms.h.nexttrack, 'function'); assert.equal(typeof ms.h.previoustrack, 'function');
  ms.h.nexttrack(); await settle();
  assert.equal(w.el.src, BOOK[2].src);
  assert.equal(ms.h.nexttrack, null, 'the last chapter still has a Next handler');
});

test('every setMetadata carries artwork, as a data: URI — the app icon unless the track\'s own image is already data:', async () => {
  const { w, f } = await withPlugin();
  w.A.play(BOOK[0], BOOK); await settle();                                               // no image
  w.A.play({ id: 's1', title: 'Sermon', src: 'blob:s1', image: 'https://church.test/pic.jpg' }); await settle();   // a remote image
  w.A.play({ id: 's2', title: 'Sermon 2', src: 'blob:s2', image: 'data:image/png;base64,AAAA' }); await settle();   // already data:
  const metas = f.calls.filter(c => c[0] === 'meta').map(c => c[1]);
  assert.equal(metas.length, 3);
  for (const m of metas) {
    assert.ok(Array.isArray(m.artwork) && m.artwork.length >= 1, 'METADATA WITHOUT ARTWORK — the unpatched plugin crashed the app on this');
    for (const a of m.artwork) assert.match(a.src, /^data:/, 'a non-data: artwork reached the plugin (it would fetch it on the plugin thread)');
  }
  assert.equal(metas[1].artwork[0].src, metas[0].artwork[0].src, 'a remote sermon image must fall back to the app icon');
  assert.equal(metas[2].artwork[0].src, 'data:image/png;base64,AAAA', 'a data: sermon image was not used');
  assert.equal(metas[0].title, 'John 1');
  assert.deepEqual(f.rejects, []);
});

test('POINT OF USE — the handler the bridge registered for "pause" pauses, and never toggles; "play" plays', async () => {
  const { w, f } = await withPlugin();
  w.A.play(BOOK[0], BOOK); await settle();
  f.handlers.pause({ action: 'pause' });
  assert.equal(w.el.paused, true);
  f.handlers.pause({ action: 'pause' }); await settle();
  assert.equal(w.el.paused, true, 'A SECOND "pause" (headphones out while paused) STARTED SOUND');
  f.handlers.play({ action: 'play' }); await settle();
  assert.equal(w.el.paused, false);
  f.handlers.play({ action: 'play' }); await settle();
  assert.equal(w.el.paused, false, 'a second "play" paused it');
  w.el.currentTime = 100;
  f.handlers.seekbackward({ action: 'seekbackward' }); assert.equal(w.el.currentTime, 90, 'the lock-screen back button is not 10 s');
  f.handlers.seekforward({ action: 'seekforward' }); assert.equal(w.el.currentTime, 100);
  f.handlers.seekto({ action: 'seekto', seekTime: 42 }); assert.equal(w.el.currentTime, 42, 'lock-screen scrubbing did nothing');
  f.handlers.nexttrack({ action: 'nexttrack' }); await settle();
  assert.equal(w.el.src, BOOK[1].src);
  f.handlers.stop({ action: 'stop' });
  assert.equal(w.A.current, null);
});

test('the FIRST "playing" is sent synchronously inside the tap; a media event never sends it from "none"', async () => {
  const { w, f } = await withPlugin();
  w.A.play(BOOK[0], BOOK);
  assert.deepEqual(f.states(), ['playing'], 'the first "playing" was not sent inside api.play() (Android 12+ refuses a background start)');
  await settle();
  press(w.player(), 'Pause');
  await w.clock.advance(10 * 60000);
  assert.equal(f.states().pop(), 'none');
  const before = f.states().length;
  w.el.play(); w.el.emit('playing'); await settle();      // the element starts by itself (an OS resume, say)
  assert.equal(f.states().length, before, 'A MEDIA EVENT SENT A STATE OUT OF "none" — that would start the service from the background');
  w.el.pause();
  press(w.player(), 'Play');
  assert.equal(f.states().pop(), 'playing', 'Play from "none" did not send "playing" in the tap');
});

test('"playing" is held through a chapter change and through a retry: no "paused" or "none" in between', async () => {
  const { w, f } = await withPlugin();
  w.A.play(BOOK[0], BOOK); await settle();
  w.el.tick(299); w.el.end(); await settle();               // chapter 1 → chapter 2
  assert.equal(w.A.current.id, BOOK[1].id);
  w.el.tick(50);
  w.el.net = () => 'fail'; w.el.failNow(2);                 // a retry
  await w.clock.advance(2000);
  w.el.net = () => 'ok'; await w.clock.advance(5000);
  assert.equal(w.el.paused, false, 're-anchor: it did not recover');
  assert.deepEqual(f.states(), ['playing'], 'THE OS WAS TOLD SOMETHING OTHER THAN "playing" WHILE THE LISTENER WANTED SOUND: ' + f.states().join(','));
});

test('"paused" on a pause and on a final failure', async () => {
  const { w, f } = await withPlugin();
  w.A.play(BOOK[0], BOOK); await settle();
  press(w.player(), 'Pause');
  assert.equal(f.states().pop(), 'paused');
  press(w.player(), 'Play'); await settle();
  assert.equal(f.states().pop(), 'playing');
  w.el.net = () => 'fail'; w.el.failNow(2);
  await w.clock.advance(2000 + 5000 + 15000 + 30000);
  assert.equal(f.states().pop(), 'paused', 'a final failure left the OS showing "playing"');
});

test('"none" on Close, at the end of the queue, and after 10 minutes continuously paused', async () => {
  const a = await withPlugin();
  a.w.A.play(BOOK[0], BOOK); await settle();
  press(a.w.player(), 'Close player');
  assert.equal(a.f.states().pop(), 'none', 'Close left the notification and the foreground service up');

  const b = await withPlugin();
  b.w.A.play(BOOK[2], BOOK); await settle();
  b.w.el.tick(299); b.w.el.end(); await settle();
  assert.equal(b.f.states().pop(), 'none', 'the end of the book left the notification and the foreground service up');

  const c = await withPlugin();
  c.w.A.play(BOOK[0], BOOK); await settle();
  press(c.w.player(), 'Pause');
  await c.w.clock.advance(10 * 60000 - 1000);
  assert.equal(c.f.states().pop(), 'paused', '"none" came before 10 minutes');
  await c.w.clock.advance(1000);
  assert.equal(c.f.states().pop(), 'none', 'still holding the service after 10 minutes paused');
  // and a pause that is resumed inside the 10 minutes does not drop to 'none' later
  const d = await withPlugin();
  d.w.A.play(BOOK[0], BOOK); await settle();
  press(d.w.player(), 'Pause'); await d.w.clock.advance(5 * 60000);
  press(d.w.player(), 'Play'); await settle();
  await playOn(d.w, 10 * 60000);
  assert.equal(d.f.states().pop(), 'playing', 'an old pause timer dropped a playing track to "none"');
});

test('a plugin that rejects everything does not stop playback (and nothing goes unhandled)', async () => {
  const unhandled = [];
  const onU = (e) => unhandled.push(e);
  process.on('unhandledRejection', onU);
  try {
    const { w, f } = await withPlugin({ rejectAll: true });
    w.A.play(BOOK[0], BOOK); await settle();
    assert.equal(w.el.paused, false, 'a plugin reject stopped playback');
    press(w.player(), 'Pause'); press(w.player(), 'Play'); await settle();
    assert.equal(w.el.paused, false);
    w.el.tick(299); w.el.end(); await settle();
    assert.equal(w.A.current.id, BOOK[1].id);
    assert.ok(f.rejects.length > 3, 're-anchor: the plugin was not called');
    await settle();
  } finally { process.off('unhandledRejection', onU); }
  assert.deepEqual(unhandled.map(String), [], 'a plugin rejection went unhandled');
});

test('a refused foreground start: playback goes on; a media event does not retry it; the next tap does', async () => {
  const { w, f } = await withPlugin({ refuseStart: true });
  w.A.play(BOOK[0], BOOK); await settle();
  assert.equal(w.el.paused, false);
  assert.deepEqual(f.states(), ['playing']);
  w.el.tick(299); w.el.end(); await settle();               // the next chapter starts from a media event
  assert.equal(w.A.current.id, BOOK[1].id);
  assert.deepEqual(f.states(), ['playing'], 'A MEDIA EVENT RETRIED THE FOREGROUND START (from the background)');
  press(w.player(), 'Pause'); press(w.player(), 'Play');
  assert.deepEqual(f.states(), ['playing', 'playing'], 'the next tap did not try the service again');
});

test('setPositionState is sent on play / pause / duration, never on every timeupdate', async () => {
  const { w, f } = await withPlugin();
  w.A.play(BOOK[0], BOOK); await settle();
  w.el.emit('durationchange');
  const n = f.count('pos');
  assert.ok(n >= 1, 'no position was ever sent');
  for (let i = 0; i < 20; i++) w.el.tick(0.25);
  assert.equal(f.count('pos'), n, 'POSITION SENT ON timeupdate — 4 Hz over the bridge');
  press(w.player(), 'Pause');
  assert.ok(f.count('pos') > n, 'no position on pause');
});

test('WITHOUT the plugin (iOS, web, desktop): navigator.mediaSession gets metadata per track and handlers once', async () => {
  const set = [];
  const ms = { metadata: null, playbackState: 'none', setActionHandler(a, fn) { set.push(a); this['h_' + a] = fn; } };
  const w = world({ mediaSession: ms });
  w.A.play({ ...BOOK[0], image: 'https://church.test/pic.jpg' }, BOOK); await settle();
  assert.equal(ms.metadata.title, 'John 1');
  assert.equal(ms.metadata.artwork[0].src, 'https://church.test/pic.jpg', 'the web path lost the track image');
  w.A.next(); await settle();
  assert.equal(ms.metadata.title, 'John 2');
  const fixedSet = set.filter(a => FIXED.includes(a));
  assert.deepEqual(fixedSet.slice().sort(), FIXED.slice().sort(), 'handlers missing, or registered per track: ' + set.join(','));
  ms.h_pause(); assert.equal(w.el.paused, true);
  ms.h_pause(); await settle(); assert.equal(w.el.paused, true, 'navigator "pause" toggled');
  ms.h_play(); await settle(); assert.equal(w.el.paused, false);
  assert.equal(ms.playbackState, 'playing');
});

// ── the native side, as far as it can be checked without a Gradle build ──
const attrsOf = (s) => Object.fromEntries([...s.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)].map(m => [m[1], m[2]]));
function elements(xml, tag) {
  const clean = xml.replace(/<!--[\s\S]*?-->/g, '');
  return [...clean.matchAll(new RegExp('<' + tag.replace('.', '\\.') + '(\\s[^>]*?)?/?>', 'g'))].map(m => attrsOf(m[1] || ''));
}

test('the manifests: both foreground-service permissions, a mediaPlayback service that is NOT exported, and the button receiver kept', () => {
  const app = readFileSync(join(ROOT, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  const plug = readFileSync(join(ROOT, 'native/trinity-media-session/android/src/main/AndroidManifest.xml'), 'utf8');
  const perms = new Set([...elements(app, 'uses-permission'), ...elements(plug, 'uses-permission')].map(a => a['android:name']));
  assert.ok(perms.has('android.permission.FOREGROUND_SERVICE'), 'FOREGROUND_SERVICE is missing');
  assert.ok(perms.has('android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'), 'FOREGROUND_SERVICE_MEDIA_PLAYBACK is missing: the service crashes on Android 14+');
  const svc = [...elements(app, 'service'), ...elements(plug, 'service')].filter(a => /MediaSessionService$/.test(a['android:name'] || ''));
  assert.equal(svc.length, 1, 'expected exactly one MediaSessionService');
  assert.equal(svc[0]['android:foregroundServiceType'], 'mediaPlayback');
  assert.equal(svc[0]['android:exported'], 'false', 'THE SERVICE IS EXPORTED');
  const rcv = elements(plug, 'receiver').filter(a => a['android:name'] === 'androidx.media.session.MediaButtonReceiver');
  assert.equal(rcv.length, 1, 'the MediaButtonReceiver was removed — every notification button would be dead (plan P4)');
  assert.equal(rcv[0]['android:exported'], 'true', 'the MediaButtonReceiver must stay exported to receive hardware buttons');
});

test('the plugin is wired as a local Capacitor plugin, and its Java is TRACKED (not swallowed by the android/ ignore)', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies['@trinityone/media-session'], 'file:native/trinity-media-session');
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages['node_modules/@trinityone/media-session'].resolved, 'native/trinity-media-session');
  const own = JSON.parse(readFileSync(join(ROOT, 'native/trinity-media-session/package.json'), 'utf8'));
  assert.equal(own.capacitor.android.src, 'android');
  assert.ok(existsSync(join(ROOT, 'native/trinity-media-session/LICENSE')), 'the GPL licence text is not shipped with the vendored code');
  const tracked = execFileSync('git', ['ls-files', 'native/trinity-media-session'], { cwd: ROOT, encoding: 'utf8' }).split('\n');
  for (const f of ['MediaSessionPlugin', 'MediaSessionService', 'MediaSessionCallback']) {
    assert.ok(tracked.includes(`native/trinity-media-session/android/src/main/java/io/github/jofr/capacitor/mediasessionplugin/${f}.java`), f + '.java is not tracked');
  }
  assert.ok(tracked.includes('native/trinity-media-session/android/src/main/AndroidManifest.xml'));
});

test('audit #3 on the lock screen — the registered "seekto" on a PAUSED, errored track moves the place silently', async () => {
  const { w, f } = await withPlugin();
  w.A.play(BOOK[0], BOOK); await settle();
  w.el.tick(50);
  w.el.net = () => 'fail'; w.el.failNow(2);
  f.handlers.pause({ action: 'pause' });
  w.el.net = () => 'ok';
  const plays = w.el.plays;
  f.handlers.seekto({ action: 'seekto', seekTime: 120 }); await settle();
  assert.equal(w.el.paused, true, 'THE LOCK-SCREEN SCRUBBER STARTED SOUND ON A PAUSED TRACK');
  assert.equal(w.el.plays, plays);
  assert.equal(w.el.currentTime, 120);
  f.handlers.play({ action: 'play' }); await settle();
  assert.equal(w.el.paused, false);
  assert.equal(w.el.currentTime, 120);
});
