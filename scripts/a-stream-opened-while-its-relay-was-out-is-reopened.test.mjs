// A CONSOLE STREAM THAT OPENED WHILE ITS RELAY WAS OUT OF THE ADMITTED SET IS RE-OPENED WHEN THE RELAY COMES BACK.
//   Run: node --test scripts/a-stream-opened-while-its-relay-was-out-is-reopened.test.mjs
//
// THE BUG (2026-11-18, "the helper never gets the books until the owner reloads"). The reconnect ticker in
// app/steward-root.jsx re-opens the dashboard's streams when a relay is admitted AFTER they opened (_connRelayGrew,
// 1960a56f). It compared against a snapshot taken when the ticker last re-subscribed — but the gate can take the relay
// back OUT of the set after that snapshot and before the streams open. Measured in a real owner console (trace kept in
// the commit message): box admitted → snapshot {box} → box dropped → roster / blocklist / books-key streams open over
// NOTHING → box re-admitted → the ticker sees nothing new → those streams stay dead for the session.
//
// POINT OF USE. This lifts the SHIPPED code — the ticker, its wiring, and makeSub, the hook factory every console stream
// is opened through — out of app/steward-root.jsx and runs it with a fake React whose effects run at once. The stream is
// opened through makeSub exactly as useStewardStewards() opens it, so deleting the line in makeSub that narrows the
// snapshot fails this test, as does deleting the narrowing itself. Nothing here matches source text to decide a result:
// the anchors only find where to cut (CLAUDE.md rule 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function lift(steward) {
  const R = readFileSync(new URL('../app/steward-root.jsx', import.meta.url), 'utf8');
  // piece 1: the hook aliases, useStewardIdv, the reconnect ticker, its wiring and useStewardConn
  const a0 = R.indexOf('const { useState: useSt, useEffect: useStE } = React;');
  const a1 = R.indexOf('(function () {   // factory scope');
  // piece 2: makeSub and its shared caches, from inside the factory scope
  const b0 = R.indexOf('const _subCache = {};');
  const b1 = R.indexOf('window.stewardStreamLoaded = function');
  assert.ok(a0 >= 0 && a1 > a0 && b0 > a1 && b1 > b0, 're-anchor: the ticker or makeSub moved in app/steward-root.jsx');
  const src = R.slice(a0, a1) + '\n' + R.slice(b0, b1);
  // A fake React: state is a plain value, an effect runs immediately (one render, which is all this needs).
  const React = { useState: (init) => [typeof init === 'function' ? init() : init, () => {}], useEffect: (fn) => { fn(); } };
  const on = {};
  const timers = [];
  const win = { Steward: steward, addEventListener: (ev, fn) => { (on[ev] = on[ev] || []).push(fn); }, removeEventListener() {} };
  const doc = { visibilityState: 'visible', addEventListener() {} };
  const api = new Function('React', 'window', 'document', 'Date', 'setTimeout', 'setInterval', 'clearTimeout',
    src + '\nreturn { makeSub, useStewardConn, noteOpen: _connNoteOpen, listeners: _connListeners };'
  )(React, win, doc, { now: () => steward.clock }, (fn, ms) => { timers.push(fn); return timers.length; }, () => 0, () => {});
  let bumps = 0;
  api.listeners.add(() => { bumps++; });
  const fire = async (ev) => { for (const fn of (on[ev] || [])) await fn(); for (let i = 0; i < 5 && timers.length; i++) for (const fn of timers.splice(0)) await fn(); await new Promise(r => setTimeout(r, 0)); };
  return { ...api, fire, bumps: () => bumps };
}

// The engine, reduced to what the ticker and makeSub ask of it. The relay set is the variable under test; every other
// answer is the healthy one, so the ONLY reason left to re-subscribe is a relay the streams were never opened over.
function engine() {
  const st = { clock: 5e6, set: [], opened: [],
    relayList: () => st.set.slice(), relaysHealthy: () => true, relaysReplaced: () => false, markResubscribed() {},
    reconnectDownRelays: async () => false, churchPub: 'c'.repeat(64), actingChurch: '' };
  st.subscribeStewards = (cb) => { st.opened.push(st.set.slice()); cb([]); return () => {}; };
  return st;
}
const BOX = 'ws://127.0.0.1:7777/relay';

test('THE BUG: admitted, dropped, the roster stream opens over nothing, re-admitted — the stream is re-opened', async () => {
  const S = engine();
  const t = lift(S);
  S.set = [BOX];
  t.useStewardConn();                  // the first hook mounts: the ticker wires up
  t.noteOpen();                        // the profile hook initialises the snapshot: {box}
  S.set = [];                          // the gate takes the box out again
  t.makeSub(() => S, 'subscribeStewards', () => [])();   // the dashboard's roster stream opens — over nothing
  assert.deepEqual(S.opened, [[]], 'staging: the roster stream did not open over an empty set');
  S.set = [BOX];                       // the box is admitted again, and the gate says so
  await t.fire('steward-relay-returned');
  assert.equal(t.bumps(), 1, 'the stream that opened over nothing was never re-opened when its relay came back — the owner ' +
    'console never hears its roster change or reads the books-key envelope until it is reloaded');
});

test('CONTROL: streams that opened over the box are NOT re-opened when the gate re-announces it (no storm)', async () => {
  const S = engine();
  const t = lift(S);
  S.set = [BOX];
  t.useStewardConn();
  t.noteOpen();                        // profile hook initialises the snapshot: {box}
  t.makeSub(() => S, 'subscribeStewards', () => [])();
  assert.deepEqual(S.opened, [[BOX]], 'staging: the roster stream did not open over the box');
  await t.fire('steward-relay-returned');
  assert.equal(t.bumps(), 0, 'a relay the streams already hear was treated as new — every announcement would re-query the church');
});

test('CONTROL: a brand-new church whose box is admitted only after the streams opened is still re-opened (1960a56f)', async () => {
  const S = engine();
  const t = lift(S);
  S.set = [];
  t.useStewardConn();
  t.noteOpen();                        // profile hook initialises the snapshot: {} (empty)
  t.makeSub(() => S, 'subscribeStewards', () => [])();
  S.set = [BOX];
  await t.fire('steward-relay-returned');
  assert.equal(t.bumps(), 1, 'the admitted-late case this ticker already handled stopped working');
});
