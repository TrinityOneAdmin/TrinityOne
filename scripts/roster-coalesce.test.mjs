// The member roster must not re-serialise itself for every arrival. Run: node --test scripts/roster-coalesce.test.mjs
//
// AUDIT-2026-07-31 P8. subscribeChurchMembers' emit() spreads the roster Map, filters, sorts, JSON.stringifies
// the whole thing into localStorage and calls setState. It ran ONCE PER INCOMING EVENT — so a fifty-member
// church loading did that fifty times, on the phone, while the member watched. The console's identical path
// was fixed on 2026-07-18 with a comment naming the cost, and _coalesce has sat 1,700 lines above in the same
// file the whole time, used by a dozen of this function's siblings.
//
// THE TRAP, and the reason this is not simply `emit = _coalesce(emit)`: _coalesce takes a zero-argument
// function and ignores what it is called with. Wrapping emit wholesale turns every `emit(true)` — the EOSE
// call that carries "the initial load has finished" — into `emit(undefined)`. The roster would arrive and the
// screen would sit on its spinner for ever. So the per-event path coalesces and EOSE stays immediate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

// _coalesce is the real one, lifted from the shipped bundle and driven with a fake clock.
function loadCoalesce() {
  const at = BUNDLE.indexOf('function _coalesce(');
  assert.notEqual(at, -1, '_coalesce is gone from the bundle — rebuild: bash scripts/build-fellowship.sh');
  let d = 0, i = BUNDLE.indexOf('{', at);
  for (; i < BUNDLE.length; i++) { const c = BUNDLE[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) break; } }
  const timers = [];
  const fn = new Function('setTimeout', 'clearTimeout', 'console',
    BUNDLE.slice(at, i + 1) + '; return _coalesce;')(
    (f) => { timers.push(f); return timers.length; },
    (id) => { timers[id - 1] = null; },
    { error() {} });
  return { _coalesce: fn, flush: () => { const q = timers.splice(0); for (const f of q) if (f) f(); } };
}

test('fifty arrivals cost ONE roster rebuild, not fifty', () => {
  const { _coalesce, flush } = loadCoalesce();
  let rebuilds = 0;
  const emitSoon = _coalesce(() => rebuilds++);
  for (let i = 0; i < 50; i++) emitSoon();
  flush();
  assert.equal(rebuilds, 1,
    'a fifty-member church loading rebuilt the roster ' + rebuilds + ' times — each one a full spread, filter, ' +
    'sort, JSON.stringify to localStorage and setState, on the member\'s phone while they wait.');
});

test('EOSE is NOT coalesced, and still carries `done`', () => {
  // The trap. _coalesce ignores arguments, so `emit = _coalesce(emit)` silently turns emit(true) into
  // emit(undefined) — the roster arrives and the screen keeps spinning.
  const at = SRC.indexOf('subscribeChurchMembers(churchNpub, onMembers)');
  assert.notEqual(at, -1, 're-anchor: subscribeChurchMembers moved');
  const fn = SRC.slice(at, SRC.indexOf('\n  },', at));
  assert.match(fn, /oneose\(\) \{ emitSoon\.cancel\(\); emit\(true\); \}/,
    'EOSE no longer calls emit(true) directly. If it is coalesced, `done` is lost and every screen that gates ' +
    '"loaded" on it waits for ever; if it is merely delayed, the roster appears after the spinner should have gone.');
  assert.match(fn, /onchange\(pk\) \{ ensureProfile\(pk\); emitSoon\(\); \}/,
    'per-event arrivals are no longer coalesced — this is the finding itself');
  assert.doesNotMatch(fn, /const emit = _coalesce/,
    'emit has been wrapped wholesale. _coalesce drops its arguments, so every emit(true) becomes emit(undefined).');
});

test('a pending rebuild is dropped at EOSE rather than landing after it', () => {
  // Otherwise the last coalesced emit(false) fires just after emit(true) and re-raises the spinner.
  const { _coalesce, flush } = loadCoalesce();
  const calls = [];
  const emitSoon = _coalesce(() => calls.push('soon'));
  emitSoon(); emitSoon();
  emitSoon.cancel(); calls.push('eose');
  flush();
  assert.deepEqual(calls, ['eose'],
    'a coalesced rebuild survived the cancel and ran after EOSE, so the screen was told the load finished and ' +
    'then handed a roster marked unfinished.');
});

test('unmounting cancels the pending rebuild', () => {
  // A timer that fires into a torn-down screen is the silent-error class this codebase keeps hitting.
  const at = SRC.indexOf('subscribeChurchMembers(churchNpub, onMembers)');
  const fn = SRC.slice(at, SRC.indexOf('\n  },', at));
  const ret = fn.slice(fn.lastIndexOf('return () =>'));
  assert.match(ret, /emitSoon\.cancel\(\)/,
    'the teardown does not cancel the coalesced rebuild, so it fires into a screen that has already gone');
});
