// B6 CLEAR-ON-SEEN: when the FOREGROUND app persists a message cursor that advances past its value at
// launch (or at the last clear), the home-screen widget's bare "N new messages" count is spent by the
// background reader's own definition, and the app tells the widget so at once instead of waiting for the
// next 15-minute poll. Run: node --test scripts/the-widget-count-clears-when-the-app-has-seen-the-messages.test.mjs
//
// Everything here is lifted from the SHIPPED vendor/fellowship.js and EXECUTED (CLAUDE.md rule 3): the
// shared hook _widgetSeen, the DM-seen writer _dmSeenNote, and BOTH persist chokepoints _docsHubSaveNow and
// _memHubSaveNow (plan-audit change 2: there are two, not one). Faked, and named: localStorage, window
// (Capacitor plugin bridge + Fellowship.churchPub), Date, setTimeout, _mayCache.
//
// Callers of the lifted code (rule 2):
//   _docsHubSaveNow — _hubDropSlices, _docsHubSaveSoon, _onChurchDocs teardown, _refullChurchHubs, flush
//     on lock; _memHubSaveNow — _memHubSaveSoon, _onChurchMembers teardown, _refullChurchHubs. The hook only
//     ADDS a side call before the write; what is saved is unchanged.
//   _widgetSeen — the two SaveNow functions and _dmSeenNote's debounced persist, nobody else.
//   _dmSeenNote — subscribeThread's deliver (incoming only) and subscribeDMs' handle (incoming only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stmt, deps } from './test-slice.mjs';

const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

const PARTS = [
  stmt(BUNDLE, 'var _wSeenRead =', '_wSeenRead'),   // esbuild renders the source's `const` as `var` at the bundle top level
  fnBody(BUNDLE, 'function _widgetSeen(', '_widgetSeen'),
  fnBody(BUNDLE, 'function _dmSeenNote(', '_dmSeenNote'),
  fnBody(BUNDLE, 'function _docsHubSaveNow(', '_docsHubSaveNow'),
  fnBody(BUNDLE, 'function _memHubSaveNow(', '_memHubSaveNow'),
].join('\n');
const PRE = deps(BUNDLE, PARTS, ['_wSeenRead', '_widgetSeen', '_dmSeenNote', '_docsHubSaveNow', '_memHubSaveNow',
  '_mayCache', 'localStorage', 'window', 'setTimeout', 'clearTimeout', 'Date', 'JSON', 'Math', 'Promise', 'console', 'Map']);
const factory = new Function('window', 'localStorage', '_mayCache', 'setTimeout', 'clearTimeout', 'Date',
  PRE + PARTS + '\nreturn { _widgetSeen, _dmSeenNote, _docsHubSaveNow, _memHubSaveNow };');

const CP = 'ab'.repeat(32);
const NOW0 = 1764000000000;   // ms

function rig({ churchPub = CP, plugin = true, locked = false, seed = {} } = {}) {
  const store = new Map(Object.entries(seed));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  const calls = [];
  const window = {
    Fellowship: { churchPub },
    Capacitor: plugin ? { Plugins: { TrinityWidget: { clearMessageCount: () => { calls.push(1); return Promise.resolve(); } } } } : undefined,
  };
  let nowMs = NOW0;
  const timers = [];
  const setTimeoutF = (fn, ms) => { timers.push(fn); return timers.length; };
  const fns = factory(window, localStorage, () => !locked, setTimeoutF, () => {}, { now: () => nowMs });
  return {
    fns, calls, store, timers,
    tick: (ms) => { nowMs += ms; },
    runTimers: () => { const t = timers.splice(0); for (const fn of t) fn(); },
    hub: (over) => ({ cp: churchPub, since: 0, fullAt: 0, dirty: true, saveT: null, buf: new Map(), byPub: new Map(), ...over }),
    rec: (key) => JSON.parse(store.get(key) || 'null'),
  };
}
const DOCS = 'trinityone.docshub.' + CP, MEMS = 'trinityone.memhub.' + CP, DMSEEN = 'trinityone.dmseen.' + CP;
const seeded = (s) => ({ [DOCS]: JSON.stringify({ v: 2, since: s, fullAt: 0, events: [] }) });

test('the DOCS save path: a cursor advanced past its launch value clears the widget count, and the save still lands', () => {
  const r = rig({ seed: seeded(100) });
  r.fns._docsHubSaveNow(r.hub({ since: 150 }));
  assert.equal(r.calls.length, 1, 'clearMessageCount was not called when the docs cursor advanced');
  assert.equal(r.rec(DOCS).since, 150, 'the save itself no longer lands');
});

test('the MEMBERS save path: the same advance through _memHubSaveNow clears too (plan-audit change 2: both chokepoints)', () => {
  const r = rig({ seed: seeded(100) });
  r.fns._memHubSaveNow(r.hub({ since: 180 }));
  assert.equal(r.calls.length, 1, 'clearMessageCount was not called when the members cursor advanced');
  assert.equal(r.rec(MEMS).since, 180);
});

test('NO advance, no clear: a save at the launch cursor never touches the bridge, on either path', () => {
  const r = rig({ seed: seeded(100) });
  r.fns._docsHubSaveNow(r.hub({ since: 100 }));
  r.fns._memHubSaveNow(r.hub({ since: 90, dirty: true }));
  assert.equal(r.calls.length, 0, 'a save that advanced nothing still called the bridge');
  assert.equal(r.rec(DOCS).since, 100);
});

test('the launch baseline is the COMBINED cursor: a docs save below another record\'s persisted since does not clear', () => {
  const r = rig({ seed: { ...seeded(50), [MEMS]: JSON.stringify({ v: 2, since: 200, fullAt: 0, members: [] }) } });
  r.fns._docsHubSaveNow(r.hub({ since: 120 }));   // advanced its own record, but max(docs,mems,dmseen) is still 200
  assert.equal(r.calls.length, 0, 'cleared although the reader\'s max cursor never moved');
  r.fns._docsHubSaveNow(r.hub({ since: 250, dirty: true }));
  assert.equal(r.calls.length, 1, 'a save past the combined cursor must clear');
});

test('the throttle: save storms inside 10s make ONE bridge call; a later advance after the gap clears again', () => {
  const r = rig({ seed: seeded(100) });
  r.fns._docsHubSaveNow(r.hub({ since: 150 }));
  r.fns._docsHubSaveNow(r.hub({ since: 160, dirty: true }));
  r.fns._memHubSaveNow(r.hub({ since: 170, dirty: true }));
  assert.equal(r.calls.length, 1, 'the throttle did not hold inside the 10s window');
  r.tick(11000);
  r.fns._docsHubSaveNow(r.hub({ since: 300, dirty: true }));
  assert.equal(r.calls.length, 2, 'an advance after the throttle window must clear again');
});

test('the DM-SEEN marker: an incoming kind-4 writes trinityone.dmseen.<cp> (debounced) and fires the same clear hook', () => {
  const r = rig({ seed: { [DMSEEN]: JSON.stringify({ since: 100 }) } });
  r.fns._dmSeenNote({ created_at: 500, pubkey: 'cd'.repeat(32) });
  assert.equal(r.store.has(DMSEEN) && r.rec(DMSEEN).since, 100, 'the marker persisted before the debounce');
  r.runTimers();
  assert.equal(r.rec(DMSEEN).since, 500, 'the marker did not persist the newest DM time');
  assert.equal(r.calls.length, 1, 'a DM-only advance did not clear the widget count');
});

test('the marker is monotonic and clock-clamped, like _hubCursor: older DMs and far-future DMs advance nothing', () => {
  const nowS = Math.floor(NOW0 / 1000);
  const r = rig({ seed: { [DMSEEN]: JSON.stringify({ since: nowS - 50 }) } });
  r.fns._dmSeenNote({ created_at: nowS - 100 });            // older than the marker
  r.fns._dmSeenNote({ created_at: nowS + 3600 });           // past now + FUTURE_SKEW (900s)
  r.runTimers();
  assert.equal(r.rec(DMSEEN).since, nowS - 50, 'an older or future-dated DM moved the marker');
  assert.equal(r.calls.length, 0);
});

test('locked (_mayCache false): the marker writes nothing, so the lock purge is never undone', () => {
  const r = rig({ locked: true });
  r.fns._dmSeenNote({ created_at: 500 });
  r.runTimers();
  assert.equal(r.store.has(DMSEEN), false, 'a locked session recreated the purged DM-seen record');
  assert.equal(r.calls.length, 0);
});

test('web build / background WebView (no Capacitor bridge): the hook is inert and the save still lands', () => {
  const r = rig({ plugin: false, seed: seeded(100) });
  r.fns._docsHubSaveNow(r.hub({ since: 150 }));
  assert.equal(r.calls.length, 0);
  assert.equal(r.rec(DOCS).since, 150, 'the guard broke the save itself');
});

test('another church\'s hub advancing never clears the ACTIVE church\'s count', () => {
  const other = 'ef'.repeat(32);
  const r = rig({ seed: { ['trinityone.docshub.' + other]: JSON.stringify({ v: 2, since: 10, fullAt: 0, events: [] }) } });
  r.fns._docsHubSaveNow(r.hub({ cp: other, since: 900 }));
  assert.equal(r.calls.length, 0, 'a non-active church\'s save cleared the widget');
  assert.equal(JSON.parse(r.store.get('trinityone.docshub.' + other)).since, 900, 'the other church\'s save must still land');
});

test('POINT OF USE in the shipped bundle: each SaveNow persist path calls the shared hook exactly once, pre-write', () => {
  for (const name of ['_docsHubSaveNow', '_memHubSaveNow']) {
    const body = fnBody(BUNDLE, 'function ' + name + '(', name);
    const hits = body.split('_widgetSeen(hub.cp, hub.since)').length - 1;
    assert.equal(hits, 1, name + ' must call _widgetSeen(hub.cp, hub.since) exactly once');
    assert.ok(body.indexOf('_widgetSeen(hub.cp, hub.since)') < body.indexOf('localStorage.setItem(key, s)'),
      name + ': the hook must run BEFORE the write lands, so the first call can seed the launch baseline');
  }
});

// ── the DM ingest chokepoints reach the writer through window.Fellowship._dmSeen (the _dmUnwrap pattern;
// the call sites guard on the property, so the WIRING below is load-bearing and pinned here) ──────────────
test('POINT OF USE: the SHIPPED subscribeThread calls window.Fellowship._dmSeen for an incoming DM, never for my own', async () => {
  const sub = fnBody(BUNDLE, 'subscribeThread(peerPub, onMsg) {', 'subscribeThread');
  const ME = 'a'.repeat(64), PEER = 'b'.repeat(64);
  let handler;
  const pool = { subscribeMany: (_u, _f, h) => { handler = h.onevent; return { close() {} }; } };
  const seen = [];
  const window = { Fellowship: { relays: [], _dmSeen: (e) => seen.push(e.created_at), _dmUnwrap: (t) => ({ text: t }) } };
  const make = new Function('pool', 'window', 'pub', 'sk', '_dmDecrypt', 'dmReadRelays',
    'return ({ ' + sub + ' });');
  const o = make(pool, window, ME, new Uint8Array(32), async (_s, _p, ct) => ct, () => []);
  o.subscribeThread(PEER, () => {});
  await handler({ id: 'e1', kind: 4, pubkey: PEER, tags: [['p', ME]], created_at: 111, content: 'hi' });
  await handler({ id: 'e2', kind: 4, pubkey: ME, tags: [['p', PEER]], created_at: 222, content: 'yo' });
  assert.deepEqual(seen, [111], 'incoming must advance the marker; my own sent DM must not');
});

test('POINT OF USE: the SHIPPED subscribeDMs calls window.Fellowship._dmSeen for an incoming DM, never for my own', async () => {
  const sub = fnBody(BUNDLE, 'subscribeDMs(onConvos) {', 'subscribeDMs');
  const coalesce = /\n  function _coalesce\(fn\) \{[\s\S]*?\n  \}\n/.exec(BUNDLE);
  assert.ok(coalesce, '_coalesce not found in the bundle');
  const ME = 'a'.repeat(64), PEER = 'b'.repeat(64);
  let handler;
  const pool = { subscribeMany: (_u, _f, h) => { handler = h.onevent; return { close() {} }; } };
  const seen = [];
  const window = { Fellowship: { relays: [], _dmSeen: (e) => seen.push(e.created_at), _dmUnwrap: (t) => ({ text: t }) } };
  const make = new Function('pool', 'window', 'pub', 'sk', '_dmDecrypt', 'dmReadRelays',
    coalesce[0] + '\nreturn ({ ' + sub + ' });');
  const o = make(pool, window, ME, new Uint8Array(32), async (_s, _p, ct) => ct, () => []);
  o.subscribeDMs(() => {});
  await handler({ id: 'e1', kind: 4, pubkey: PEER, tags: [['p', ME]], created_at: 333, content: 'hi' });
  await handler({ id: 'e2', kind: 4, pubkey: ME, tags: [['p', PEER]], created_at: 444, content: 'yo' });
  assert.deepEqual(seen, [333], 'incoming must advance the marker; my own sent DM must not');
});

test('THE WIRING: the shipped bundle installs _dmSeenNote as window.Fellowship._dmSeen (the guarded call sites depend on it)', () => {
  assert.equal(BUNDLE.split('_dmSeen: _dmSeenNote').length - 1, 1, 'the _dmSeen wiring is gone from the bundle (or duplicated)');
});

test('the lock purge covers the new record: clearCommunityCache lists the trinityone.dmseen. prefix', () => {
  const body = fnBody(BUNDLE, 'clearCommunityCache() {', 'clearCommunityCache');
  assert.ok(body.includes('"trinityone.dmseen."') || body.includes("'trinityone.dmseen.'"), 'the lock purge no longer removes the DM-seen records');
});
