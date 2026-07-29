// The member app must be able to say "that didn't work". Run: node --test scripts/member-failure-channel.test.mjs
//
// ARCHITECTURE-AUDIT-2026-07-30 A2. The two engines are the same shape and the same age, and only one grew a
// way to report failure. Measured before the fix, every CustomEvent each dispatches:
//
//     src/steward.src.js (console)          src/fellowship.src.js (member app)
//       steward-write-blocked  x4  <- fail    trinity-profiles        x8
//       steward-publish-error  x1  <- fail    trinity-relays          x1
//       steward-publish-ok     x1             trinity-reconnect       x1
//       steward-key/relays/networks/...       trinity-guardian-added  x1
//                                             trinity-church-trust    x1
//
// Three failure channels against zero. All five of the member app's events are data-update notifications, so
// of the three programs the one running on twenty people's phones was the only one that could not report a
// failure of any kind.
//
// That is the architectural root of this project's worst failure class — looks normal, shows nothing. A throw
// inside a docs-bus handler was caught and logged to a console THAT DOES NOT EXIST ON A PHONE, so the feature
// yielded an EMPTY result rather than a broken one: "this church has no groups" and "that code threw" were
// byte-identical on screen. It is how the member-restore bug survived for its entire life, and the same shape
// is on record against family rebuild and the blank-names failure.
//
// This drives the SHIPPED bundle — _featureFailed is lifted out of vendor/fellowship.js and executed — because
// a test that only read the source would pass with the plumbing disconnected, which is the same shape as
// "openMemberName had no callers".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const UI = readFileSync(new URL('../app/ui.jsx', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');

// Pull the REAL function out of the shipped bundle and run it, rather than a copy of its idea.
function realFeatureFailed(win) {
  const at = BUNDLE.indexOf('function _featureFailed(');
  assert.notEqual(at, -1, '_featureFailed is missing from the SHIPPED bundle — either it was removed, or ' +
    'vendor/fellowship.js is stale and the fix is not actually on anyone’s phone');
  let depth = 0, end = -1;
  for (let i = BUNDLE.indexOf('{', at); i < BUNDLE.length; i++) {
    const c = BUNDLE[i];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { end = i + 1; break; }
  }
  assert.notEqual(end, -1, 'could not find the end of _featureFailed');
  const errs = [];
  const fn = new Function('window', 'console', 'CustomEvent', '_FAILURES',
    BUNDLE.slice(at, end) + '; return _featureFailed;')(win, { error: (...a) => errs.push(a) },
    class { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } }, win.__F);
  return { fn, errs };
}
const fakeWindow = () => {
  const events = [];
  return { __F: [], events, dispatchEvent(e) { events.push(e); return true; } };
};

test('a swallowed failure now reaches a listener, naming the document that broke', () => {
  const win = fakeWindow();
  const { fn, errs } = realFeatureFailed(win);
  fn('live update', 'trinityone/group:abc', new Error('x is undefined'));
  assert.equal(win.events.length, 1, 'nothing was dispatched — the failure is still silent');
  const ev = win.events[0];
  assert.equal(ev.type, 'trinity-feature-failed', 'dispatched under an unexpected event name');
  assert.equal(ev.detail.doc, 'trinityone/group:abc', 'the event does not say WHICH document type failed, which is the whole diagnostic value');
  assert.equal(ev.detail.where, 'live update', 'the event does not say which stage failed');
  assert.match(ev.detail.message, /x is undefined/, 'the underlying error message was dropped');
  assert.equal(errs.length, 1, 'it stopped logging to the console — the new channel must ADD to that, not replace it');
});

test('it records to a buffer a phone can read without a console', () => {
  const win = fakeWindow();
  const { fn } = realFeatureFailed(win);
  fn('initial replay', 'trinityone/care:1', new Error('boom'));
  assert.equal(win.__F.length, 1, 'nothing was recorded; on a device there is no console, so this is the only trace');
  assert.equal(win.__F[0].doc, 'trinityone/care:1');
  assert.ok(typeof win.__F[0].at === 'number' && win.__F[0].at > 0, 'the record carries no timestamp');
});

test('the buffer is bounded — a failing handler must not eat the phone’s memory', () => {
  const win = fakeWindow();
  const { fn } = realFeatureFailed(win);
  // A handler that throws on every event throws on EVERY event: an unbounded log is a second bug.
  for (let i = 0; i < 250; i++) fn('live update', 'trinityone/group:' + i, new Error('e' + i));
  assert.ok(win.__F.length <= 50, 'the failure buffer is unbounded (' + win.__F.length + ' entries)');
  assert.match(win.__F[win.__F.length - 1].doc, /249$/, 'it kept the OLDEST failures and dropped the newest — backwards');
});

test('a listener that throws cannot break the handler loop', () => {
  // The reporter must never become the fault. This runs inside a `for (const h of handlers)` loop that other
  // features depend on continuing.
  const win = fakeWindow();
  win.dispatchEvent = () => { throw new Error('a listener blew up'); };
  const { fn } = realFeatureFailed(win);
  assert.doesNotThrow(() => fn('live update', 'trinityone/group:x', new Error('original')),
    'a throwing listener propagated out of the reporter and would kill the handler loop it was reporting from');
});

// ── and the swallow sites must actually GO THROUGH it ────────────────────────────────────────────────────
// A channel nobody dispatches on is worse than none: it reads as coverage. Same reasoning as
// shared-rules.test.mjs's "both engines must actually go through it".
test('every docs-bus catch reports, instead of swallowing or console-logging', () => {
  const from = SRC.indexOf('function _docsHubOpen');
  const to = SRC.indexOf('function _hubBufSet', from) > 0 ? SRC.indexOf('function _hubBufSet', from) : SRC.indexOf('window.Fellowship = {');
  assert.ok(from > 0 && to > from, 'could not isolate the docs-hub region — this guard is not reading what it claims');
  const region = SRC.slice(from, to);
  const handlerCalls = region.match(/try \{ h\.(onevent|oneose|onroster)[^}]*\} catch \(err\) \{([^}]*)\}/g) || [];
  assert.ok(handlerCalls.length >= 5, 'expected several handler invocations in the docs-hub region; found ' + handlerCalls.length);
  const silent = handlerCalls.filter(s => !s.includes('_featureFailed'));
  assert.deepEqual(silent, [],
    'these handler calls still swallow or only console.error. On a phone there is no console, so the feature\n' +
    '    returns EMPTY and nothing anywhere records that it broke — the exact shape that hid member restore');
});

test('the bundle exposes the failures to a device session', () => {
  assert.match(BUNDLE, /recentFailures:/, 'window.Fellowship.recentFailures is not in the shipped bundle');
});

// ── and one surface actually listens ─────────────────────────────────────────────────────────────────────
test('the member app renders a surface for it, and it is not the success toast', () => {
  assert.match(UI, /function FeatureTrouble\(/, 'the notice component is gone');
  assert.match(UI, /addEventListener\('trinity-feature-failed'/, 'the notice does not listen for the event the engine dispatches');
  assert.match(UI, /FeatureTrouble \}\);|, FeatureTrouble \}/, 'FeatureTrouble is not exported to the global scope, so app.jsx cannot render it');
  assert.match(APP, /<FeatureTrouble \/>/, 'nothing renders the notice — the engine would dispatch into an empty room');
  // Toast draws a tick. A tick over a failure is a lie, so they must stay separate components.
  const at = UI.indexOf('function FeatureTrouble(');
  assert.doesNotMatch(UI.slice(at, at + 2000), /name="check"/, 'the failure notice draws a success tick');
});

test('the notice does not show the raw error to a member', () => {
  // A member cannot act on "TypeError: x is undefined", and on the connections this product is built for a
  // scary string is worse than useless. The detail belongs in recentFailures(), not on the screen.
  const at = UI.indexOf('function FeatureTrouble(');
  const body = UI.slice(at, UI.indexOf('\n}', at));
  assert.doesNotMatch(body, /detail\.message|\.message\}/, 'the raw error message is rendered to the member');
  assert.match(body, /didn’t load|did not load/, 'the notice no longer says anything a member can understand');
});
