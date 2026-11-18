// A LOCAL AUDIO-BIBLE CHAPTER THAT ERRORS IS RE-RESOLVED ONCE, AND LETS GO OF ITS OLD BLOB ADDRESS.
// Run: node --test scripts/a-local-chapter-that-errors-re-resolves-once.test.mjs
//
// Two branches meet here (merged into integration 2026-11-18):
//  · the audio-Bibles store (feat/audio-bibles-own): a chapter stored on the phone is a {bibleLocal:true} track with
//    resolve() and no src; the engine's release() revokes its blob address when the player moves on, so the phone
//    holds ONE chapter in memory at a time;
//  · the player recovers (fix/audio-player-recovers): a blob with resolve() that errors is NOT retried by itself, it
//    shows "Couldn't load", and Play drops track.src and re-resolves ONCE at its place.
// Combined, release() cannot revoke the old address on that re-resolve (the old and the new track are the same
// object, and release() skips old === new). retryNow() revokes it itself: the playback build audit's FINDING 1
// (TrinityOne-internal/AUDIT-build-audio-playback-fixes-2026-11-18.md), fixed by 0e4ef5d3. The second test below
// proves it (it was a `todo` on the candidate until that fix arrived).
//
// HOW (CLAUDE.md rules 1 and 3): the REAL app/screens-audio.jsx, the REAL playBibleChapter() (what Listen calls), the
// REAL MiniPlayer's Play button, against the faithful fake <audio> of scripts/audio-engine-world.mjs on a fake clock.
// Only the store is faked: chapterUrl() mints a fresh blob address per call, as URL.createObjectURL does, and URL's
// createObjectURL / revokeObjectURL are counted so "live blob addresses" is measured, not inferred.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, reads } from './render-jsx-screen.mjs';
import { fakeAudio, fakeClock } from './audio-engine-world.mjs';

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
const byLabel = (tree, label) => find(tree, n => n.type === 'button' && n.props && n.props['aria-label'] === label);
const press = (tree, label) => { const b = byLabel(tree, label); assert.equal(b.length, 1, `expected exactly one "${label}" on the player, found ${b.length}`); b[0].props.onClick({ stopPropagation() {} }); };
const COULDNT = /Couldn.t load/;

function localWorld() {
  const { React, draw } = miniReact();
  const el = fakeAudio();
  el.lengthOf = () => 300;
  const clock = fakeClock();
  // blob addresses: every one minted, every one revoked
  let n = 0;
  const minted = [], revoked = [];
  class CountingURL extends URL {
    static createObjectURL() { const u = 'blob:https://localhost/chapter-' + (++n); minted.push(u); return u; }
    static revokeObjectURL(u) { revoked.push(u); }
  }
  const live = () => minted.filter(u => !revoked.includes(u));
  // the store: World English, John 1-3 on this phone
  const resolves = [];
  const store = {
    listBook: async (id, book) => (id === 'WEB' && book === 43 ? [1, 2, 3].map(chap => ({ chap })) : []),
    chapterUrl: async (id, book, chap) => { resolves.push(book + ':' + chap); return CountingURL.createObjectURL(); },
    readySets: () => [],
  };
  const win = { Bible: { bookName: () => 'John', maxChapter: () => 21 }, TrinityAudioStore: store, trinityToast() {} };
  const Stub = nm => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: nm }); return f; };
  const doc = { createElement: () => el, body: { appendChild() {} }, visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  const base = {
    React, window: win, localStorage: { getItem: () => null, setItem() {} }, navigator: {}, MediaMetadata: class {},
    document: doc, Icon: Stub('Icon'), Overlay: Stub('Overlay'), IconBtn: Stub('IconBtn'), SectionLabel: Stub('SectionLabel'),
    lsGet: (k, d) => (k === 'trinityone.audioVoice' ? 'WEB/david' : d), lsSet() {},
    URL: CountingURL, Blob, console, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  };
  const audio = loadScreen('app/screens-audio.jsx', ['MiniPlayer', 'playBibleChapter'], base);
  const player = () => { draw(audio.MiniPlayer, { ctx: {} }); return draw(audio.MiniPlayer, { ctx: {} }); };
  return { el, clock, audio, A: win.TrinityAudio, player, minted, revoked, live, resolves };
}

async function failThenPlay(w) {
  assert.equal(await w.audio.playBibleChapter(43, 2), true, 'Listen did not play the stored chapter');
  await settle();
  assert.deepEqual(w.resolves, ['43:2'], 'the stored chapter was not read through resolve() — re-anchor this test');
  assert.equal(w.A.current.bibleLocal, true, 'the track is not a bibleLocal track — re-anchor this test');
  assert.equal(w.el.src, w.minted[0]);
  assert.equal(w.el.paused, false, 'the chapter did not start');
  w.el.tick(40);
  w.el.failNow(3);                                    // the stored file is bad / the decoder gave up
  let tree = w.player();
  assert.match(reads(tree), COULDNT, 'a broken local chapter must go straight to "Couldn\'t load"');
  await w.clock.advance(120000);
  assert.equal(w.resolves.length, 1, 'a local chapter was re-read by itself — it must wait for Play');
  tree = w.player();
  press(tree, 'Play');
  await settle();
}

test('POINT OF USE — a local chapter that errors: "Couldn\'t load", no retry by itself; Play re-resolves it ONCE and plays at its place; Next lets go of it', async () => {
  const w = localWorld();
  await failThenPlay(w);
  assert.deepEqual(w.resolves, ['43:2', '43:2'], 'Play must call resolve() exactly once more, for the same chapter');
  const second = w.minted[1];
  assert.equal(w.el.src, second, 'Play reused the broken blob instead of the re-resolved one');
  assert.equal(w.el.paused, false, 'the re-resolved chapter is not playing');
  assert.equal(w.el.currentTime, 40, 'the re-resolved chapter did not resume at its place');
  assert.doesNotMatch(reads(w.player()), COULDNT);
  await w.clock.advance(120000);
  assert.equal(w.resolves.length, 2, 'nothing may resolve again by itself');
  // the player moving on lets go of the re-resolved address (release())
  w.A.next(); await settle();
  assert.deepEqual(w.resolves, ['43:2', '43:2', '43:3']);
  assert.ok(w.revoked.includes(second), 'moving to the next chapter did not revoke the re-resolved address');
});

test('after that re-resolve the OLD blob address is revoked and exactly ONE live address remains', async () => {
  const w = localWorld();
  await failThenPlay(w);
  assert.equal(w.resolves.length, 2, 're-anchor: Play did not re-resolve');
  const [first, second] = w.minted;
  assert.ok(w.revoked.includes(first), 'THE OLD BLOB ADDRESS WAS NEVER REVOKED after the re-resolve (a leaked chapter in memory)');
  assert.deepEqual(w.live(), [second], 'exactly one live blob address must remain: the one playing');
  w.A.next(); await settle();
  assert.deepEqual(w.live(), [w.minted[2]], 'exactly one live blob address after Next');
});
