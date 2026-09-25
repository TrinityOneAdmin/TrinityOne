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
// THE REAL normalizeURL the engine imports — not a hand-rolled lookalike. A stub here would be testing my
// approximation of the pool's keying rule, which is the very thing that has gone wrong in the field twice.
import { normalizeURL } from 'nostr-tools/utils';
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
    eose: (reached = true) => handler.oneose(reached),   // `reached` = a relay actually answered; false = every socket failed
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

test('ENGINE: an EOSE with NO relay reached is NOT an empty church — it must stay silent', async () => {
  // In nostr-tools' abstract-pool a connection FAILURE calls handleClose(i), whose first act is
  // handleEose(i). So a phone with no signal receives a full, ordinary EOSE carrying nothing — identical,
  // at this callback, to a church that genuinely has no sermons. Telling a member their church has no
  // sermons because their train went into a tunnel is the second lie this reader could tell, and it is the
  // one main told for ever (`oneose() { emit(); }`, unconditional).
  const eng = liftedEngine();
  const calls = [];
  eng.open(l => calls.push(l));
  eng.eose(false);            // every socket failed
  await settle();
  assert.equal(calls.length, 0,
    'THE READER DECLARED THE CHURCH EMPTY OVER A DEAD CONNECTION. Nothing answered, so nothing is known — ' +
    'the screen must go on waiting and let its own watchdog say "Can\'t reach". Calls: ' + JSON.stringify(calls));
});

test('ENGINE: …but a sermon already in hand still paints on an unreachable EOSE', async () => {
  // The other half of the same rule: holding back the EMPTY must not hold back what we already have, or a
  // reconnect would blank a list that is perfectly good.
  const eng = liftedEngine();
  const calls = [];
  eng.open(l => calls.push(l));
  eng.fire(sermonDoc('s1', 1000));
  eng.eose(false);
  await settle();
  assert.ok(calls.length >= 1, 'a sermon already read was withheld because the socket later failed');
  assert.equal(calls[calls.length - 1].length, 1, 'the sermon vanished: ' + JSON.stringify(calls[calls.length - 1]));
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

// ── THE HUB'S OWN WIRING ────────────────────────────────────────────────────────────────────────────────
// The tests above stub `_onChurchDocs`, so they pin what each READER does with the answer and say nothing
// about whether the answer is ever right. That gap is real and was measured: replacing the hub's
// `h.oneose(hub.reached)` with `h.oneose(true)` — i.e. every reader told the relay answered, always — left
// the file 9/9 GREEN while restoring the exact bug these tests exist to prevent. A stub cannot be asked the
// question it is standing in for ([[stub-answers-the-question]]).
//
// So two more, against the shipped bundle rather than a lift of one function:
//   1. `_reachedRelay` itself, lifted and run — the normalizeURL trap, the never-dialled relay, the throw.
//   2. The fan-out, asserted as TEXT IN vendor/fellowship.js. That is sound here and only here: esbuild
//      removes dead code, so a line that stops being reached stops being in the bundle and the match fails
//      (CLAUDE.md rule 3's own parenthetical — it is `app/*.jsx` that ships unbundled and cannot be
//      asserted this way). It is a weaker test than running it, and it is the strongest available without
//      lifting _docsHubOpen's thirty-odd dependencies.
function liftedReached(statusMap, { throws = false } = {}) {
  const stubs = {
    pool: { listConnectionStatus: () => { if (throws) throw new Error('pool exploded'); return statusMap; } },
    normalizeURL,
  };
  // ⚠ THE BUNDLER RENAMES IMPORTS. esbuild emits the call as `normalizeURL2(url)` because the name collides
  // inside the bundle, and `_reachedRelay` swallows a ReferenceError in its own inner try/catch — so a
  // harness that supplies only `normalizeURL` gets a function that silently answers `false` for every
  // trailing-slash URL and looks like a real defect. It cost one red test to find, and the same
  // digit-stripping fallback is in the memberApp() harness of
  // scripts/a-delegated-stewards-sermons-reach-a-member-phone.test.mjs for exactly this reason.
  const scope = new Proxy(stubs, {
    has: () => true,
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, ''); if (base in t) return t[base];
      throw new ReferenceError('the lifted _reachedRelay needs `' + String(k) + '` — add a stub for it'); },
  });
  const body = fnBody(FELLOWSHIP_VENDOR, 'function _reachedRelay(urls) {', '_reachedRelay');
  return new Function('scope', `with (scope) { ${body}\nreturn _reachedRelay; }`)(scope);
}

test('HUB WIRING: _reachedRelay says yes only for a relay that is actually connected', () => {
  const live = new Map([['wss://a.example/relay', true]]);
  assert.equal(liftedReached(live)(['wss://a.example/relay']), true, 'a live socket was reported as unreachable');
  assert.equal(liftedReached(new Map([['wss://a.example/relay', false]]))(['wss://a.example/relay']), false,
    'a relay the pool reports as DOWN was treated as reached');
  assert.equal(liftedReached(new Map())(['wss://a.example/relay']), false,
    'A RELAY THE POOL NEVER DIALLED IS ABSENT FROM THE MAP, so `st.get()` is undefined — that must mean ' +
    'NOT reached. Reading undefined as "fine" is the exact defect relaysHealthy() records having shipped.');
  assert.equal(liftedReached(live)([]), false, 'no relays at all was reported as reached');
  assert.equal(liftedReached(live, { throws: true })(['wss://a.example/relay']), false,
    'it fails OPEN on an exception — the safe answer is "we did not reach anyone", which holds the screen');
});

test('HUB WIRING: a trailing slash still matches — the normalizeURL trap that shipped once already', () => {
  // The pool keys its map by normalizeURL(); relay lists hold whatever was typed, scanned or published. A
  // self-hosted church typing `wss://church.example/relay/` missed the map entirely and read as undefined,
  // which became a PERMANENT "Can't reach your church" over a live socket (see relaysHealthy's own note).
  const st = new Map([['wss://church.example/relay', true]]);
  assert.equal(liftedReached(st)(['wss://church.example/relay/']), true,
    'a relay entered with a trailing slash is invisible to the connection map — every self-hosted and ' +
    'LAN-only church would be told its own live relay is unreachable');
});

test('HUB WIRING: the docs hub computes the answer and hands it to every reader', () => {
  // TEXT, against the BUNDLE (see the note above this block). Sabotage-checked: rewriting the fan-out to
  // `h.oneose(true)` in src/ removes these lines from vendor/ and this test goes red.
  assert.match(FELLOWSHIP_VENDOR, /hub\.reached = _reachedRelay\(relaysForChurch\(cp\)\)/,
    'THE DOCS HUB NO LONGER ASKS whether a relay answered. Every reader on it then decides "is this church ' +
    'empty or is this phone offline?" from a value nobody computed.');
  const fanouts = FELLOWSHIP_VENDOR.match(/h\.oneose\(hub\.reached\)/g) || [];
  assert.equal(fanouts.length, 2,
    'expected the hub to pass its answer at BOTH eose paths — the live fan-out and the replay a handler ' +
    'gets when it registers after eose — found ' + fanouts.length + '. A reader registered late would ' +
    'otherwise be told `undefined`, i.e. "never reached", and hold a stale list for ever.');
});

// ── POINT OF USE ────────────────────────────────────────────────────────────────────────────────────────
// The real WatchView, mounted, reading the real engine. `ctx.church.channel` is '' so the screen takes the
// `window.Bible.getVideos()` branch for its OTHER gate (`data`) — a church with no YouTube channel and no
// sermons is precisely the pilot church this bug hit.
async function watchTab({ eose = true, reached = true, sermons = [] } = {}) {
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
  if (eose) eng.eose(reached);
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

test('POINT OF USE: an unreachable relay says "check your connection", NOT "Nothing here yet"', async () => {
  const p = await watchTab({ reached: false });
  assert.doesNotMatch(p.said, /Nothing here yet/,
    'THE TAB TOLD A MEMBER THEIR CHURCH HAS NO SERMONS BECAUSE THE PHONE IS OFFLINE. Screen read: ' + JSON.stringify(p.said));
  assert.equal(p.spinners, 1,
    'the tab left the loading state over a relay that never answered — the 12s watchdog can no longer put ' +
    'the honest "Can\'t reach" message up, because the gate it depends on has already been released');
});

test('POINT OF USE: a church WITH a sermon reaches the list, not the empty state', async () => {
  const p = await watchTab({ sermons: [sermonDoc('s1', 1000)] });
  assert.doesNotMatch(p.said, /Nothing here yet/,
    'a church WITH a sermon was told it has none. Screen read: ' + JSON.stringify(p.said));
  assert.match(p.said, /St Mary’s/, 'the church’s own section heading is missing. Screen read: ' + JSON.stringify(p.said));
});
