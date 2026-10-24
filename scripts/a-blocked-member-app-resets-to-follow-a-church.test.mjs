// A BLOCKED MEMBER'S APP RESETS TO "FOLLOW A CHURCH" — ONLY ON A CONFIRMED BLOCK (owner, 2026-10-14).
//   Run: node --test scripts/a-blocked-member-app-resets-to-follow-a-church.test.mjs
//
// THE DEFECT. The relay already refuses a blocked reader everything private, but the phone never learned it was
// blocked, so it went on painting the whole church from stale cache. Owner: on learning it is blocked the app must
// RESET to the "follow a church" state — not stop at a dead-end "you have been removed" banner.
//
// THE PIECES, each driven as shipped:
//   ENGINE  — _checkIfBlocked / the re-follow guard, lifted from vendor/fellowship.js (the bundle, not src). It flips
//             only on a church-key-signed blocklist that names this phone's own key (positive confirmation, never
//             absence) and records the church in trinityone.blockedchurches.
//   APP     — the REAL App() from app/app.jsx (app-screens.mjs loads every script index.html lists). The engine's
//             subscribeAmBlocked callback is captured and fired; the church must leave the list, the active church
//             must move off it, the follow-a-church sheet must open, and the engine must be told to move on.
//   GUARD   — the REAL followChurch from that App. Manual retry (owner 2026-10-14): a DELIBERATE follow of a
//             blocked church clears the note and follows it (one-tap rejoin); only an AUTOMATIC re-follow
//             (opts.auto) is refused. No timer.
// Rule 3: nothing here matches text in app/*.jsx.
//
// Users of the shared code (rule 2): subscribeAmBlocked had ONE consumer (App, whose dead-end overlay this replaces);
// _checkIfBlocked is called from _publishAny and _outboxFlush on a "blocked" refusal (unchanged). followChurch's
// callers (the follow sheet, deep links, onboarding) pass no opts.auto, so each is a deliberate rejoin that clears
// the note; the note refuses only a programmatic re-follow that marks itself opts.auto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeReact, appBrowser, loadApp, nodes } from './app-screens.mjs';

const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

// ── ENGINE, lifted from the shipped bundle ─────────────────────────────────────────────────────────────────
const CP = 'c'.repeat(64), ME = 'a'.repeat(64), OTHER = 'b'.repeat(64);
function engine({ events = [], store = {} } = {}) {
  const from = BUNDLE.indexOf('var _amBlocked = false;');
  const to = BUNDLE.indexOf('var _flushing = false;');
  assert.ok(from > 0 && to > from, 're-anchor: the blocked-member block moved in vendor/fellowship.js');
  const body = BUNDLE.slice(from, to);
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const win = { Fellowship: { churchPub: CP } };
  const pool = { querySync: async () => events };
  const f = new Function('pub', 'pool', 'churchRelays', 'toPub', 'window', 'localStorage',
    body + '\nreturn { check: _checkIfBlocked, amBlocked: () => _amBlocked, isBlockedChurch: _isBlockedChurch, forgetBlocked: _forgetBlockedChurch, subs: _blockedSubs, notify: _notifyBlocked };')
    (ME, pool, () => ['wss://r'], (x) => (/^[0-9a-f]{64}$/i.test(String(x)) ? String(x).toLowerCase() : null), win, localStorage);
  const fired = [];
  f.subs.add((flag, cp) => fired.push([flag, cp]));
  return { ...f, fired, store };
}
const blockDoc = (author, pubkeys, d = 'trinityone/blocked:' + CP) => ({ pubkey: author, created_at: 100, tags: [['d', d]], content: JSON.stringify({ pubkeys }) });

test('ENGINE: a church-signed blocklist naming this phone flips the signal ONCE, with the church, and records the guard', async () => {
  const e = engine({ events: [blockDoc(CP, [ME])] });
  assert.equal(e.isBlockedChurch(CP), false, 'control: nothing recorded before the confirmation');
  await e.check();
  assert.equal(e.amBlocked(), true);
  assert.deepEqual(e.fired, [[true, CP]]);
  assert.equal(e.isBlockedChurch(CP), true, 'the re-follow guard did not record the church');
  assert.match(e.store['trinityone.blockedchurches'], new RegExp(CP));
});

test('ENGINE: nothing short of confirmation flips it — no document, a list not naming me, or a list not signed by the church', async () => {
  for (const [what, events] of [
    ['no blocklist document came back (a bare "blocked:" refusal with nothing to confirm it)', []],
    ['a church-signed list that names SOMEONE ELSE', [blockDoc(CP, [OTHER])]],
    ['a list naming me but signed by a stranger', [blockDoc(OTHER, [ME])]],
    ['a list naming me for a DIFFERENT church', [blockDoc(CP, [ME], 'trinityone/blocked:' + OTHER)]],
  ]) {
    const e = engine({ events });
    await e.check();
    assert.equal(e.amBlocked(), false, 'FLIPPED ON: ' + what);
    assert.deepEqual(e.fired, [], 'a subscriber was told "blocked" on: ' + what);
    assert.equal(e.isBlockedChurch(CP), false, 'the guard recorded the church on: ' + what);
  }
});

test('GUARD: the note NEVER expires (no timer) and is cleared only by forgetBlockedChurch — the manual retry', () => {
  // A year-old entry must STILL refuse: with manual-retry there is no 30-day lapse. The owner's decision
  // (2026-10-14) is that a member a church unblocks rejoins by TAPPING follow, which clears the note, not by
  // waiting out a timer.
  const e = engine({ store: { 'trinityone.blockedchurches': JSON.stringify({ [CP]: Date.now() - 400 * 24 * 3600 * 1000 }) } });
  assert.equal(e.isBlockedChurch(CP), true, 'an old entry lapsed — there must be NO timer any more');
  assert.equal(e.isBlockedChurch(OTHER), false, 'the guard is per church');
  e.forgetBlocked(CP);
  assert.equal(e.isBlockedChurch(CP), false, 'forgetBlockedChurch did not clear the note — the manual retry cannot work');
  assert.equal(e.store['trinityone.blockedchurches'], '{}', 'the entry was not removed from storage');
});

// ── APP: the real App() ────────────────────────────────────────────────────────────────────────────────────
const NPUB = 'npub1' + '0'.repeat(58);
function boot({ blockedGuard = () => false } = {}) {
  const r = fakeReact();
  const env = appBrowser(); const window = env.window;
  window.Bible = { loaded: true, activeVersion: 'KJV', subscribe: () => () => {}, books: () => ['John'], maxChapter: () => 21, defaultLoc: () => ({ book: 'John', chap: 1 }) };
  window.MyData = { seedIfEmpty() {}, on: () => () => {}, list: () => [], settings: { get: () => ({}) }, count: () => 0, set: () => {} };
  window.TrinityData = {};
  const App = loadApp({ React: r.React, window, expr: 'App' });
  window.TrinityData.CHURCHES = [{ id: NPUB, npub: NPUB, name: 'Test Church' }];
  window.localStorage.setItem('trinityone.activeChurch', JSON.stringify(NPUB));
  window.localStorage.setItem('trinityone.onboarded', 'true');
  const calls = {}; let blockedCb = null;
  window.Fellowship = new Proxy({
    myPubkey: 'dd'.repeat(32), CANONICAL_RELAYS: [], hasRelays: true, toPub: (x) => x,
    isBlockedChurch: (x) => blockedGuard(x),
    forgetBlockedChurch: (x) => { (calls.forgetBlockedChurch = calls.forgetBlockedChurch || []).push(x); },
    subscribeAmBlocked: (cb) => { blockedCb = cb; cb(false, ''); return () => {}; },
    forgetChurch: (x) => { (calls.forgetChurch = calls.forgetChurch || []).push(x); },
    ackAmBlocked: () => { calls.ack = (calls.ack || 0) + 1; },
  }, {
    get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'then' || typeof k === 'symbol') return undefined;
      return (...args) => { (calls[k] = calls[k] || []).push(args); return () => {}; };
    },
  });
  const draw = () => { r.reset(); const tree = App(); r.flush(); return tree; };
  return { window, calls, draw, fire: (flag, cp) => blockedCb(flag, cp) };
}
const ctxOf = (tree) => { const n = nodes(tree).find(x => x.props && x.props.ctx && 'churchNetworks' in x.props.ctx); assert.ok(n, 'no screen received a ctx — re-anchor this test'); return n.props.ctx; };
const switcherOf = (tree) => { const n = nodes(tree).find(x => x.props && 'initialMode' in x.props && 'onClose' in x.props); assert.ok(n, 'the church switcher is not in the tree — re-anchor this test'); return n.props; };
const settle = async (m) => { m.draw(); await new Promise(r => setTimeout(r, 1500)); m.draw(); return m.draw(); };

test('APP CONTROL: before any block the church is followed and the follow sheet is closed', async () => {
  const m = boot();
  const tree = await settle(m);
  assert.ok(ctxOf(tree).churches.some(c => c.id === NPUB), 'the fixture does not follow the church, so the reset below proves nothing');
  assert.equal(ctxOf(tree).activeChurch, NPUB);
  assert.equal(switcherOf(tree).open, false);
});

test('APP: a CONFIRMED block drops the church, un-activates it, opens "follow a church", and tells the engine to move on', async () => {
  const m = boot();
  await settle(m);
  m.fire(true, NPUB);
  const tree = m.draw(); m.draw();
  const t2 = m.draw();
  assert.ok(!ctxOf(t2).churches.some(c => c.id === NPUB), 'THE BLOCKED CHURCH IS STILL FOLLOWED — the phone keeps painting it from cache');
  assert.notEqual(ctxOf(t2).activeChurch, NPUB, 'the blocked church is still the active church');
  assert.equal(switcherOf(t2).open, true, 'the app did not return to the follow-a-church screen');
  assert.equal(switcherOf(t2).initialMode, 'follow');
  assert.deepEqual((m.calls.forgetChurch || []).map(a => a), [NPUB], 'the church’s local state was not forgotten through the engine');
  assert.equal(m.calls.ack, 1, 'the engine was not told the reset is done, so no later church could ever be checked');
  void tree;
});

test('APP: nothing happens on the "not blocked" signal — the reset keys off the confirmed flip only', async () => {
  const m = boot();
  await settle(m);
  m.fire(false, '');          // what subscribeAmBlocked and ackAmBlocked deliver when nothing is confirmed
  m.draw(); m.draw();
  const t2 = m.draw();
  assert.ok(ctxOf(t2).churches.some(c => c.id === NPUB), 'the church was dropped without a confirmed block');
  assert.equal(ctxOf(t2).activeChurch, NPUB);
  assert.equal(switcherOf(t2).open, false);
  assert.equal(m.calls.forgetChurch, undefined);
});

test('MANUAL RETRY AT THE POINT OF USE: a deliberate followChurch of a blocked church clears the note and follows; an AUTOMATIC re-follow is refused', async () => {
  const blocked = boot({ blockedGuard: () => true });
  await settle(blocked);
  const OTHERNPUB = 'npub1' + '3'.repeat(58);
  // an AUTOMATIC re-follow (opts.auto) of a church the guard holds is still refused — the bounce loop stays shut
  const before = ctxOf(blocked.draw()).churches.length;
  assert.equal(ctxOf(blocked.draw()).followChurch(OTHERNPUB, { auto: true }), false, 'an automatic re-follow of a blocked church was allowed — the bounce loop is open');
  assert.equal(ctxOf(blocked.draw()).churches.length, before, 'the auto re-follow still added the church');
  assert.equal((blocked.calls.forgetBlockedChurch || []).length, 0, 'an auto re-follow must NOT clear the note');
  // a DELIBERATE follow (no opts.auto) is the member choosing to rejoin: clear the note and follow it — one-tap rejoin
  ctxOf(blocked.draw()).followChurch(OTHERNPUB);
  assert.ok((blocked.calls.forgetBlockedChurch || []).includes(OTHERNPUB), 'a manual follow did not clear the block note');
  assert.equal(ctxOf(blocked.draw()).churches.length, before + 1, 'a manual follow of a blocked church did not follow it — the owner wants one-tap rejoin');
  // control, same App, guard open: the same code follows it, so the guard is the only thing in play
  const open = boot({ blockedGuard: () => false });
  await settle(open);
  const n0 = ctxOf(open.draw()).churches.length;
  ctxOf(open.draw()).followChurch(OTHERNPUB);
  assert.equal(ctxOf(open.draw()).churches.length, n0 + 1, 'control: with the guard open the church should be followed');
});

// THE RESET NOTICE MUST LINGER LONG ENOUGH TO READ (owner, 2026-10-14: it "flashed by before I could read it").
// Point of use (rule 3: lift and RUN the real function, never match app/*.jsx text). _applyBlockedReset is the one
// place that announces the reset; it is dependency-injected (app.jsx) precisely so a test can drive it. The fix is
// to mark the toast { error: true } — the app's toast() keeps an error up 6s (and draws a shield, not a success
// tick) while a plain string gets 1.9s. The sentence carries no failure word, so without the flag toastKind()
// classes it 'ok' and it flashes past. This fails if the flag is dropped.
test('APP at the point of use: the blocked-reset notice is marked to LINGER, not shown as a 1.9s success tick', () => {
  const r = fakeReact();
  const env = appBrowser(); const window = env.window;
  // the module defines functions at load; give it the same minimal globals boot() does so it evaluates clean
  window.Bible = { loaded: true, activeVersion: 'KJV', subscribe: () => () => {}, books: () => ['John'], maxChapter: () => 21, defaultLoc: () => ({ book: 'John', chap: 1 }) };
  window.MyData = { seedIfEmpty() {}, on: () => () => {}, list: () => [], settings: { get: () => ({}) }, count: () => 0, set: () => {} };
  window.TrinityData = {};
  const applyBlockedReset = loadApp({ React: r.React, window, expr: '_applyBlockedReset' });
  assert.equal(typeof applyBlockedReset, 'function', 'could not lift _applyBlockedReset — re-anchor this test');
  const toasts = [];
  const d = {
    F: { toPub: (x) => x, forgetChurch() {}, ackAmBlocked() {} },
    churches: [{ id: CP, npub: CP }],
    setChurches() {}, setActiveChurch() {}, lsSet() {}, openFollow() {},
    toast: (msg, opts) => toasts.push({ msg, opts }),
  };
  const ok = applyBlockedReset(CP, d);
  assert.equal(ok, true, 'the reset did not run on a valid church');
  assert.equal(toasts.length, 1, 'the reset said nothing to the member — they lose access with no explanation');
  assert.match(String(toasts[0].msg), /removed your access/, 'the reset notice wording changed unexpectedly');
  assert.equal(toasts[0].opts && toasts[0].opts.error, true,
    'the reset notice is NOT marked { error: true } — it will flash past in 1.9s with a success tick, which is the bug the owner reported');
});
