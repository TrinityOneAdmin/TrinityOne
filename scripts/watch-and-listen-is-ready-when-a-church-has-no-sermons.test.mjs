// A CHURCH WITH NO SERMONS MUST GET THE "Nothing here yet" TAB, NOT A SPINNER THAT TURNS INTO A LIE.
//   Run: node --test scripts/watch-and-listen-is-ready-when-a-church-has-no-sermons.test.mjs
//
// ── WHAT BROKE, AND WHY IT WAS INVISIBLE ────────────────────────────────────────────────────────────────
// Option A (2026-09-25) rewrote `_openSermons` in src/fellowship.src.js to read the shared church-docs hub,
// copying the shape of its two nearest siblings, subscribeChurchGroups and subscribeChurchCategories:
//
//     oneose() { eosed = true; if (byId.size) emit(); }
//
// In those two the `if (byId.size)` guard is right: both paint from a localStorage cache first
// (`_seedFromCache`), and a reconnect's EOSE-before-events must not blank what is already on screen.
// `_openSermons` seeds from NO cache, and its caller gates a whole tab on the first callback —
// app/screens-watch.jsx holds `sermonsReady` false until `FS.subscribeSermons` calls back (U8: tell "still
// loading" apart from "genuinely none"), and renders the YouTube/Rumble feed behind the same gate. So for a
// church with zero sermons the callback never came: Watch & Listen span for 12 seconds and then said
// "Can't reach {church} right now — check your connection" over a relay that had answered perfectly, with a
// Try again that looped. Most pilot churches have no self-hosted sermons, so that was most churches.
//
// The whole suite stayed green. Every sermon test in this repo hands the reader at least one sermon, which
// is the one case the guard does not break — a defect that only exists when there is NOTHING to assert on
// is exactly the shape a test suite misses. Hence this file, and hence its second half.
//
// ── HOW THIS ASSERTS (CLAUDE.md rules 1 and 3) ──────────────────────────────────────────────────────────
// Two layers, because either alone would have passed over this bug at some point in its life:
//   ENGINE — the REAL `_openSermons`, lifted out of the shipped vendor/fellowship.js (not a mirror of it),
//     driven through a stub hub so the test can say exactly when EOSE happens and with what in the buffer.
//   POINT OF USE — the REAL `WatchView` out of app/screens-watch.jsx, mounted, with `window.Fellowship`
//     wired to that same lifted engine. This is the layer that fails if the fix is deleted from the SCREEN
//     rather than from the engine: nothing here matches text in a .jsx file (rule 3), it renders the
//     component and reads the tree.
// `subscribeSermons` — what the screen actually calls — is a two-line `_shared()` wrapper around
// `_openSermons`; the decision under test lives entirely in the latter, so the harness wires the screen
// straight to it and says so here rather than pretending to test the wrapper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';
import { miniReact, find, reads, loadScreen } from './render-jsx-screen.mjs';

const FELLOWSHIP_VENDOR = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const SERMON_D = 'trinityone/sermon:';
const FCP = 'c'.repeat(64);   // the church's pubkey — the only trusted author in these tests

const sermonDoc = (id, at) => ({
  id: 'x' + Math.random(), pubkey: FCP, created_at: at,
  content: JSON.stringify({ id, title: 'Sunday ' + id, sha256: 'aa', hosts: ['h'], mime: 'audio/mp4', size: 1 }),
  tags: [['d', SERMON_D + id]],
});

// Lift the shipped `_openSermons` and the store primitives it closes over. Same technique, and the same
// `with(scope)` proxy, as scripts/a-delegated-stewards-sermons-reach-a-member-phone.test.mjs — a name the
// lifted code needs and this harness has not stubbed is a loud ReferenceError naming it, never a silent
// undefined that would let a test assert about something that is not the shipped code.
function liftedEngine() {
  let handler = null;
  const stubs = {
    toPub: () => FCP,
    _churchRoster: new Map([[FCP, new Set()]]),   // roster known and empty: only the church key is trusted
    _onChurchDocs: (_cp, h) => { handler = h; return () => {}; },
    console,
  };
  const DECLARED = new Set(['handler', '_churchVoice', '_coalesce', '_pickWinner', '_reduceVersions',
    '_absorbById', '_forgetById', '_reduceAll', '_tombstoneTargets', 'SERMON_D']);
  const scope = new Proxy(stubs, {
    has: (t, k) => !DECLARED.has(String(k)) && ((k in t) || !(String(k) in globalThis)),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, ''); if (base in t) return t[base];
      throw new ReferenceError('the lifted code needs `' + String(k) + '` — add a stub for it in liftedEngine()'); },
  });
  const parts = [
    fnBody(FELLOWSHIP_VENDOR, 'function _churchVoice(cp, doc) {', '_churchVoice'),
    fnBody(FELLOWSHIP_VENDOR, 'function _coalesce(fn) {', '_coalesce'),
    fnBody(FELLOWSHIP_VENDOR, 'function _pickWinner(', '_pickWinner'),
    fnBody(FELLOWSHIP_VENDOR, 'function _reduceVersions(', '_reduceVersions'),
    fnBody(FELLOWSHIP_VENDOR, 'function _absorbById(', '_absorbById'),
    fnBody(FELLOWSHIP_VENDOR, 'function _forgetById(', '_forgetById'),
    fnBody(FELLOWSHIP_VENDOR, 'function _reduceAll(', '_reduceAll'),
    fnBody(FELLOWSHIP_VENDOR, 'function _tombstoneTargets(e) {', '_tombstoneTargets'),
  ].join('\n');
  const osBody = fnBody(FELLOWSHIP_VENDOR, '_openSermons(churchNpub, onSermons) {', '_openSermons');
  const names = Object.keys(stubs);
  const built = new Function(...names, 'scope', `
    ${parts}
    let SERMON_D = ${JSON.stringify(SERMON_D)};
    with (scope) { return ({ ${osBody} })._openSermons; }
  `)(...names.map(k => stubs[k]), scope);
  return {
    open: (cb) => built('npub1c', cb),
    fire: (e) => handler.onevent(e, (e.tags.find(t => t[0] === 'd') || [])[1]),
    eose: () => handler.oneose(),
    opened: () => !!handler,
  };
}

// `emit` is `_coalesce`d — it fires on a microtask, not synchronously — so every assertion waits a tick.
const settle = () => new Promise(r => setTimeout(r, 0));

test('ENGINE: a church with NO sermons gets an empty list at EOSE — the callback must arrive', async () => {
  const eng = liftedEngine();
  const calls = [];
  eng.open(l => calls.push(l));
  eng.eose();
  await settle();
  assert.equal(calls.length, 1,
    'THE READER NEVER CALLED BACK for a church with no sermons. app/screens-watch.jsx holds `sermonsReady` ' +
    'false until it does, so Watch & Listen spins for 12s and then blames the connection. Calls: ' + calls.length);
  assert.deepEqual(calls[0], [], 'the empty answer is not an empty list: ' + JSON.stringify(calls[0]));
});

test('ENGINE: …and it still does NOT paint an empty list BEFORE eose — the flash guard is intact', async () => {
  const eng = liftedEngine();
  const calls = [];
  eng.open(l => calls.push(l));
  await settle();
  assert.equal(calls.length, 0,
    'the reader painted "no sermons" before the relay had answered. On a slow relay a church WITH sermons ' +
    'would flash "Nothing here yet" first — the U8 defect this guard exists to prevent. Calls: ' + JSON.stringify(calls));
});

test('ENGINE: a church WITH a sermon still gets it — the fix did not trade one empty for another', async () => {
  const eng = liftedEngine();
  const calls = [];
  eng.open(l => calls.push(l));
  eng.fire(sermonDoc('s1', 1000));
  eng.eose();
  await settle();
  assert.ok(calls.length >= 1, 'a church with a sermon got no callback at all');
  const last = calls[calls.length - 1];
  assert.equal(last.length, 1, 'the sermon did not survive to the screen: ' + JSON.stringify(last));
  assert.equal(last[0].id, 's1', 'the wrong document arrived: ' + JSON.stringify(last));
});

// ── POINT OF USE ────────────────────────────────────────────────────────────────────────────────────────
// The real WatchView, mounted, reading the real engine. `ctx.church.channel` is '' so the screen takes the
// `window.Bible.getVideos()` branch for its OTHER gate (`data`) — a church with no YouTube channel and no
// sermons is precisely the pilot church this bug hit.
async function watchTab({ eose = true, sermons = [] } = {}) {
  const { React, draw } = miniReact();
  const eng = liftedEngine();
  const win = {
    Fellowship: {
      subscribeSermons: (_npub, cb) => eng.open(cb),   // the shipped wrapper is a `_shared()` passthrough to _openSermons
      gatewayBase: () => '',
    },
    Bible: { getVideos: async () => ({ channel: null, videos: [] }) },
    TrinityAudio: { play() {} },
  };
  const globals = {
    React, window: win,
    Icon: () => null, SectionLabel: ({ children }) => children, SermonRow: () => null,
    setTimeout, clearTimeout, fetch: async () => { throw new Error('the screen must not fetch a feed with no channel set'); },
    Math, Date, JSON, String, Number, Boolean, Object, Array, Set, Map, console, Promise, RegExp,
  };
  const mod = loadScreen('app/screens-watch.jsx', ['WatchView'], globals);
  const ctx = { church: { npub: 'npub1c', name: 'St Mary’s', channel: '' }, toast() {}, openVideo() {} };
  const render = () => draw(mod.WatchView, { ctx });
  render();                       // first draw registers the effects; the harness runs them after it
  await settle();                 // Bible.getVideos() resolves, and the engine's subscription is open
  assert.ok(eng.opened(), 'the screen never subscribed to sermons at all — re-anchor this test');
  for (const s of sermons) eng.fire(s);
  if (eose) eng.eose();
  await settle();
  const tree = render();
  return { said: reads(tree), spinners: find(tree, n => n.props && /trinitySpin/.test(String(n.props.style && n.props.style.animation || ''))).length };
}

test('POINT OF USE: Watch & Listen shows "Nothing here yet" for a church with no sermons', async () => {
  const p = await watchTab();
  assert.match(p.said, /Nothing here yet/,
    'THE TAB IS STILL STUCK for a church with no sermons — this is the bug, at the screen. Screen read: ' + JSON.stringify(p.said));
  assert.doesNotMatch(p.said, /check your connection/,
    'the tab is blaming the connection over a relay that answered. Screen read: ' + JSON.stringify(p.said));
  assert.equal(p.spinners, 0, 'the loading spinner is still on screen after the relay answered');
});

test('POINT OF USE: …and it DOES still spin while the relay has not answered — the test can tell them apart', async () => {
  const p = await watchTab({ eose: false });
  assert.doesNotMatch(p.said, /Nothing here yet/,
    'the tab decided a church has no sermons before the relay finished answering. Screen read: ' + JSON.stringify(p.said));
  assert.equal(p.spinners, 1, 'the loading spinner is not showing while the sermons feed is still loading');
});

test('POINT OF USE: a church WITH a sermon reaches the list, not the empty state', async () => {
  const p = await watchTab({ sermons: [sermonDoc('s1', 1000)] });
  assert.doesNotMatch(p.said, /Nothing here yet/,
    'a church WITH a sermon was told it has none. Screen read: ' + JSON.stringify(p.said));
  assert.match(p.said, /St Mary’s/, 'the church’s own section heading is missing. Screen read: ' + JSON.stringify(p.said));
});
