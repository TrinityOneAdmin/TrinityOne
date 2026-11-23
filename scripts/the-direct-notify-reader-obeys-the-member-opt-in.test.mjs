// THE DIRECT-MODE NOTIFY READER OBEYS THE MEMBER'S OPT-IN (Deliverable 2).
//   Run: node scripts/run-tests.mjs scripts/the-direct-notify-reader-obeys-the-member-opt-in.test.mjs
//
// bg-entry.js cannot be imported in node, so the REAL gate is lifted from the source and EXECUTED (CLAUDE.md rule 3):
// the pure predicate, the localStorage read, and the exact `if (...) return finish(...)` statement from __dpStart.
// Sabotage check done by hand: deleting that statement from __dpStart makes the "does not proceed" tests fail.
// Also pins the screen's "turn ON" decision (dpOnPlan, lifted from app/screens-extras.jsx and run).
// Callers: directPushOptedIn / readOptIn are used only by __dpStart; dpOnPlan only by NotifSettingsScreen.flipDirect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const SRC = readFileSync(new URL('../plugins/trinity-directpush/js/bg-entry.js', import.meta.url), 'utf8');
const EXT = readFileSync(new URL('../app/screens-extras.jsx', import.meta.url), 'utf8');

const KEY = SRC.match(/const DP_OPTIN_KEY = '([^']+)'/)[1];
const optedIn = new Function(fnBody(SRC, 'function directPushOptedIn(', 'directPushOptedIn') + '\nreturn directPushOptedIn;')();
const readOptInSrc = SRC.match(/const readOptIn = .*;\n/)[0];

// Slice the real gate statement out of __dpStart, scoped to that function.
const fn = SRC.slice(SRC.indexOf('window.__dpStart = async function'), SRC.indexOf('\nfunction finish('));
const gateLine = fn.split('\n').filter((l) => l.includes('directPushOptedIn(readOptIn())'));
assert.equal(gateLine.length, 1, 'the gate statement must appear exactly once in __dpStart');
assert.ok(gateLine[0].includes('return finish('), 'the gate must return before anything else runs');
// Everything before the first await in __dpStart must be only the gate: nothing connects ahead of it.
const body = fn.slice(fn.indexOf('try {') + 5);
assert.ok(body.indexOf('directPushOptedIn(readOptIn())') < body.indexOf('__dpSetMnemonic'), 'gate must precede mnemonic/Fellowship use');

// Run the gate against a fake localStorage; `touched` records whether anything after the gate ran.
function runGate(stored, throws) {
  const ls = { getItem: (k) => { if (throws) throw new Error('blocked'); return k === KEY ? stored : null; } };
  const finished = [];
  const run = new Function('localStorage', 'directPushOptedIn', 'finish', 'touched',
    'const DP_OPTIN_KEY = ' + JSON.stringify(KEY) + ';\n' + readOptInSrc + '\n' + 'if (true) {\n' + gateLine[0].trim() + '\n touched.push("proceeded"); }\n');
  const touched = [];
  run(ls, optedIn, (o) => { finished.push(o); return o; }, touched);
  return { finished, touched };
}

test('not opted in (absent, "0", garbage, storage throws) => the reader finishes quietly and does NOT proceed', () => {
  for (const [v, t] of [[null, false], ['0', false], ['', false], ['true', false], ['1 ', false], [null, true]]) {
    const r = runGate(v, t);
    assert.equal(r.touched.length, 0, 'must not proceed for ' + JSON.stringify(v) + (t ? ' (storage throws)' : ''));
    assert.deepEqual(r.finished, [{ verdict: 'not-opted-in', newSinceCursor: 0 }]);
  }
});

test('opted in ("1") => the reader proceeds past the gate and reports nothing', () => {
  const r = runGate('1', false);
  assert.deepEqual(r.touched, ['proceeded']);
  assert.equal(r.finished.length, 0);
});

test('the screen writes the same key the reader reads (they cannot drift apart)', () => {
  assert.equal(EXT.match(/const DP_OPTIN_KEY = '([^']+)'/)[1], KEY);
  assert.equal(KEY, 'trinityone.directpush.optin');
});

const dpOnPlan = new Function(fnBody(EXT, 'function dpOnPlan(', 'dpOnPlan') + '\nreturn dpOnPlan;')();
test('turning ON: no PIN or already remembered => just enable; PIN and not remembered => offer stay-open; PIN-locked => unlock first', () => {
  assert.equal(dpOnPlan(false, false, false, 0), 'enable');
  assert.equal(dpOnPlan(true, false, true, 9999999999), 'enable');
  assert.equal(dpOnPlan(true, false, true, 0), 'offer-remember');
  assert.equal(dpOnPlan(true, true, true, 0), 'unlock-first');
  assert.equal(dpOnPlan(true, false, false, 0), 'enable', 'web: remember is not offered, nothing to prompt');
});
