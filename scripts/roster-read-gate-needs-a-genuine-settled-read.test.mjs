// TEST A — THE READ-SETTLE GATE blocks on an unstable / incomplete / unauthenticated read.
//   Run: node --test scripts/roster-read-gate-needs-a-genuine-settled-read.test.mjs
//
// VERIFICATION OF A DIAGNOSED MECHANISM, not a fix. Shared root with relay-set-write-refused-when-church-not-hosted.test.mjs:
// a relay that does not genuinely serve the church. The READ side of that root is: the console's authenticated read
// never becomes "genuine + settled + complete", so window.rosterReadyFrom (commit 78d0e813) keeps the screens on
// "Checking…" / "member list still loading" instead of a count.
//
// WHAT RUNS (rule 3 — nothing here matches text in app/*.jsx to assert behaviour; every claim is a CALL):
//   · window.rosterReadyFrom    — the REAL function, brace-matched out of app/steward-root.jsx and executed
//   · _tokIsFresh, _listIsFresh, _listTag, _stampFor, _freshTok, Steward.listIsFresh/listComplete
//                               — the REAL functions, brace-matched out of the SHIPPED vendor/steward.js bundle
//   Only the module variables they read (pub, actingChurch, _keyReadEpoch, relays()) are stubbed, and admittedSeed.
//
// WHAT IS SYNTHETIC (be honest): the tokens. They are built with the engine's own _freshTok/_listTag/_stampFor, then
// the settle fields subscribeAdmitted / subscribeMembers write on a settle are set BY HAND (genuine, floored, at,
// relaySet). The subscriptions themselves are not run here (they need a pool); this pins the GATE, not the settle.
//
// FINDING THE BRIEF DID NOT ANTICIPATE (measured, pinned below as a characterisation): `relaySet` is recorded ONLY by
// subscribeMembers (src/steward.src.js:14261). subscribeAdmitted and subscribeBlocked tokens — the two lists
// rosterReadyFrom actually reads — carry NO relaySet, so a churned relay set does NOT make rosterReadyFrom false
// today. The relay-set compare bites the MEMBERS list (and anything else that records relaySet), not the roster gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const BUNDLE = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
const RT = readFileSync(join(ROOT, 'app/steward-root.jsx'), 'utf8');

const CHURCH = 'c'.repeat(64);
const RELAYS = ['wss://a.example', 'wss://b.example'];

// Build the gate. `sabotageTok` swaps the body of _tokIsFresh (scoped: sliced out of ITS OWN function, anchor asserted once).
function build({ sabotageTok = false } = {}) {
  let tok = fnBody(BUNDLE, 'function _tokIsFresh(t, since) {', '_tokIsFresh');
  if (sabotageTok) {
    const open = tok.indexOf('{');
    assert.equal(tok.split('function _tokIsFresh').length, 2, 'sabotage anchor must appear exactly once in the slice');
    tok = tok.slice(0, open + 1) + ' return true; }';
  }
  const lc = fnBody(BUNDLE, 'listComplete(list) {', 'listComplete').replace(/^listComplete\(list\)/, 'function listComplete(list)');
  const src = [
    tok,
    fnBody(BUNDLE, 'function _listIsFresh(list, since) {', '_listIsFresh'),
    fnBody(BUNDLE, 'function _listTag() {', '_listTag'),
    fnBody(BUNDLE, 'function _stampFor(list, tag) {', '_stampFor'),
    fnBody(BUNDLE, 'function _freshTok() {', '_freshTok'),
    lc,
    fnBody(BUNDLE, 'listIsFresh(list, since) {', 'listIsFresh').replace(/^listIsFresh\(list, since\)/, 'function listIsFresh(list, since)'),
  ].join('\n');
  const env = { pub: CHURCH, actingChurch: '', epoch: 0, relayList: RELAYS.slice(), seed: [] };
  const factory = new Function('env', `
    var pub = env.pub, actingChurch = env.actingChurch, _keyReadEpoch = env.epoch;
    var relays = () => env.relayList;
    ${src}
    return { _freshTok, _listTag, _stampFor, listComplete, listIsFresh };`);
  const eng = factory(env);
  const S = { listIsFresh: eng.listIsFresh, listComplete: eng.listComplete, admittedSeed: () => env.seed };
  const win = { Steward: S };
  new Function('window', fnBody(RT, 'window.rosterReadyFrom = function (admittedList, blockedList) {', 'rosterReadyFrom'))(win);
  assert.equal(typeof win.rosterReadyFrom, 'function', 'the lifted rosterReadyFrom did not define itself');

  // A list stamped the way subscribeAdmitted / subscribeBlocked stamp it (_listTag + tag.sub = tok + _stampFor),
  // with the settle fields the settle callback writes set by hand.
  const list = (items, settle = {}) => {
    const tag = eng._listTag(), t = eng._freshTok(); tag.sub = t;
    Object.assign(t, settle);
    return eng._stampFor(items.slice(), tag);
  };
  const settled = (extra = {}) => ({ genuine: true, at: Date.now(), floored: false, ...extra });
  return { env, win, list, settled, ready: (a, b) => win.rosterReadyFrom(a, b), S };
}

function scenarios(g) {
  const out = {};
  const A = ['pk1', 'pk2', 'pk3'];
  g.env.relayList = RELAYS.slice(); g.env.seed = [];

  out.readyGenuine = g.ready(g.list(A, g.settled()), g.list([], g.settled()));
  // the settled-on relay set no longer equals the console's relays (tokens that DO record it: the members-style token)
  const setA = RELAYS.slice().sort().join(' ');
  const a1 = g.list(A, g.settled({ relaySet: setA })), b1 = g.list([], g.settled({ relaySet: setA }));
  out.readyWhenSetMatches = g.ready(a1, b1);
  g.env.relayList = [...RELAYS, 'wss://c.example'];            // the set churns
  out.notReadyWhenSetChurned = g.ready(a1, b1);
  g.env.relayList = RELAYS.slice();

  out.notReadyUnauthenticated = g.ready(g.list(A, g.settled({ genuine: false })), g.list([], g.settled()));
  out.notReadyFlooredEmptyOverKnownSeed = (() => { g.env.seed = ['pk1', 'pk2']; const r = g.ready(g.list([], g.settled({ floored: true })), g.list([], g.settled())); g.env.seed = []; return r; })();
  out.flooredListComplete = g.S.listComplete(g.list(A, g.settled({ floored: true })));
  out.notReadyBlockedUnread = g.ready(g.list(A, g.settled()), g.list([], { genuine: false }));
  return out;
}

test('READY: a genuine, settled-on-the-current-set, un-floored read lets the roster show (rosterReadyFrom === true)', () => {
  const o = scenarios(build());
  assert.equal(o.readyGenuine, true);
  assert.equal(o.readyWhenSetMatches, true, 'a token that recorded the current relay set must be ready');
});

test('NOT READY: the relay set churned after the read settled (token records relaySet) -> false', () => {
  const o = scenarios(build());
  assert.equal(o.notReadyWhenSetChurned, false, 'a read settled on a DIFFERENT relay set must not count as ready');
});

test('NOT READY: an unauthenticated read (genuine === false) -> false, even though the list may look populated', () => {
  assert.equal(scenarios(build()).notReadyUnauthenticated, false);
  assert.equal(scenarios(build()).notReadyBlockedUnread, false, 'one list unread is enough to hold the gate');
});

test('NOT READY: a floored read is not "complete" (listComplete false), and a floored EMPTY read over a known-non-empty seed -> false', () => {
  const o = scenarios(build());
  assert.equal(o.flooredListComplete, false, 'floored === true must make listComplete false');
  assert.equal(o.notReadyFlooredEmptyOverKnownSeed, false, 'the guard against collapsing a known roster');
});

test('CHARACTERISATION: a floored NON-empty read is trusted (ready) — the guard is only for the empty-over-seed case', () => {
  const g = build(); g.env.seed = ['pk1'];
  assert.equal(g.ready(g.list(['pk1'], g.settled({ floored: true })), g.list([], g.settled())), true);
});

test('CHARACTERISATION (real token shape): admitted/blocked tokens carry NO relaySet, so a churned set does NOT stale the roster gate', () => {
  // This is what subscribeAdmitted/subscribeBlocked actually build (src/steward.src.js:11238, 9921): no relaySet.
  const g = build();
  const a = g.list(['pk1'], g.settled()), b = g.list([], g.settled());
  assert.equal(g.ready(a, b), true);
  g.env.relayList = [...RELAYS, 'wss://churned.example'];
  assert.equal(g.ready(a, b), true,
    'if this ever flips to false, subscribeAdmitted/Blocked started recording relaySet — update the brief: the churn gate now reaches the roster');
  // …while the MEMBERS-style token (the one that does record relaySet) IS staled by the same churn:
  const set0 = RELAYS.slice().sort().join(' ');
  g.env.relayList = RELAYS.slice();
  const m = g.list(['pk1'], g.settled({ relaySet: set0 }));
  assert.equal(g.S.listIsFresh(m), true);
  g.env.relayList = [...RELAYS, 'wss://churned.example'];
  assert.equal(g.S.listIsFresh(m), false, 'a members-style token must go stale when the relay set changes');
});

test('TEETH (sabotage, in-process): with _tokIsFresh forced to `return true`, every NOT-ready case flips to ready', () => {
  const real = scenarios(build()), sab = scenarios(build({ sabotageTok: true }));
  for (const k of ['notReadyWhenSetChurned', 'notReadyUnauthenticated', 'notReadyBlockedUnread']) {
    assert.equal(real[k], false, k + ' (shipped)');
    assert.equal(sab[k], true, k + ' must FLIP to ready when the freshness gate is defeated — otherwise the test above is blind');
  }
  assert.equal(sab.flooredListComplete, false, 'listComplete still honours floored — that is its own check, not _tokIsFresh');
});

// ── TIE: the shared root. A read that never goes fresh and a write that is refused are the same cause. ──────────────
test('SHARED ROOT: every "not ready" above is a read that did not complete against relays that genuinely serve the church', () => {
  // The genuine flag is set only by _openKeyRead's settle (every connected relay answered AND the NIP-42 login was
  // accepted: _keyReadAuthedOn). A relay that does not host the church answers an authenticated read with nothing /
  // 'unauthed', so the token never reaches genuine === true and rosterReadyFrom stays false. The write-side twin is
  // relay-set-write-refused-when-church-not-hosted.test.mjs (the same relay refuses the church's writes).
  const o = scenarios(build());
  assert.equal(o.notReadyUnauthenticated, false);
});
