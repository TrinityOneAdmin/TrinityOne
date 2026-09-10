// A TAB CAN VANISH WHILE YOU ARE STANDING ON IT.
// Run: node --test scripts/serving-tab-survives-its-tab-vanishing.test.mjs
//
// Measured on the OPPO, 2026-08-27. A member sitting on Serving → Care when a steward switched Practical care
// off kept `tab === 'care'`, found no matching tab, and rendered NOTHING — an empty pane with no tab selected
// and nothing to say what to press:
//
//     tabs: Serving / Rota / Events / Calendar   — none with aria-selected, none highlighted
//     body: 422 characters, all of them belonging to the Today screen underneath
//
// It recovered by itself the moment the tab came back, so the state was stuck rather than corrupt. That is the
// silent-blank class: it looks like a working app that has decided to show you nothing.
//
// The same applies to Rota, which disappears when a church narrows rota visibility while somebody is reading it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../app/screens-serving.jsx', import.meta.url), 'utf8');

// `checkinRegister` ARRIVED IN THIS SLICE ON 2026-09-10, with slice 3's Kids tab. The tab list now derives
// `kidsOn` from ctx.checkinRegister, so the slice needs a `ctx` — without one this whole file failed on a
// ReferenceError at the fixture, five tests at once, and none of them on the assertion it exists to make.
// Defaults to the all-false register, which is what every member who does no children's work has.
const NO_KIDS = { cleared: false, notYet: false, keysHeld: 0 };
function runFallback({ tab, careOn, canSeeRota, checkinRegister = NO_KIDS }) {
  const a = SRC.indexOf('  // ── AND THE KIDS TAB, WHICH MOST PEOPLE NEVER SEE ─');
  assert.ok(a >= 0, 're-anchor: the tab list is no longer hoisted, so nothing can check it against the active tab');
  const b = SRC.indexOf('}, [_tabKeys, tab]);', a);
  assert.ok(b > a, 're-anchor: the fallback effect has moved');
  const body = SRC.slice(a, b + '}, [_tabKeys, tab]);'.length);
  assert.ok(body.includes('const _tabs = ['), 're-anchor: the slice no longer contains the tab list itself');
  const calls = [];
  // React.useEffect runs its callback immediately here — we only care what the callback decides.
  const React = { useEffect: (fn) => fn() };
  new Function('React', 'canSeeRota', 'careOn', 'tab', 'setTab', 'ctx', body)(
    React, canSeeRota, careOn, tab, (t) => calls.push(t), { checkinRegister });
  return calls;
}
// Which tabs that slice actually produced, so a test can assert the SET rather than only the fallback.
function tabsFrom(opts) {
  const a = SRC.indexOf('  // ── AND THE KIDS TAB, WHICH MOST PEOPLE NEVER SEE ─');
  const b = SRC.indexOf('  const _tabKeys =', a);
  assert.ok(b > a, 're-anchor: _tabKeys no longer follows the tab list');
  const React = { useEffect: () => {} };
  return new Function('React', 'canSeeRota', 'careOn', 'ctx',
    SRC.slice(a, b) + '\nreturn _tabs.map(t => t[0]);')(
    React, opts.canSeeRota !== false, !!opts.careOn, { checkinRegister: opts.checkinRegister || NO_KIDS });
}

test('switching care off while a member is ON the Care tab moves them somewhere real', () => {
  assert.deepEqual(runFallback({ tab: 'care', careOn: false, canSeeRota: true }), ['serving'],
    'the member is left on a tab that no longer exists — the pane renders nothing at all and no tab is selected');
});

test('a member already on Care is left alone while care is on', () => {
  assert.deepEqual(runFallback({ tab: 'care', careOn: true, canSeeRota: true }), [],
    'a member reading the Care tab was thrown off it for no reason');
});

test('the same holds for Rota when a church narrows who may see it', () => {
  assert.deepEqual(runFallback({ tab: 'rota', careOn: true, canSeeRota: false }), ['serving'],
    'narrowing rota visibility blanks the screen of whoever was reading the rota');
});

test('an ordinary tab is never disturbed', () => {
  for (const tab of ['serving', 'events', 'calendar']) {
    assert.deepEqual(runFallback({ tab, careOn: true, canSeeRota: true }), [],
      `the ${tab} tab was redirected for no reason — this would fight the member on every render`);
  }
});

// ── AND THE SAME INVARIANT FOR THE KIDS TAB, which is the newest way for a tab to vanish under somebody ──
// A children's worker whose clearance is withdrawn mid-morning, or whose church stands the session down, loses
// this tab while she is standing on it. That is the identical shape to Care being switched off, and it is
// reachable the moment slice 3 ships.
test('a worker cleared for check-in gets a Kids tab, and only she does', () => {
  assert.ok(tabsFrom({ checkinRegister: { cleared: true, notYet: false, keysHeld: 1 } }).includes('kids'),
    'the Kids tab is not produced for a cleared worker holding a session key');
  assert.equal(tabsFrom({}).includes('kids'), false,
    'the Kids tab is produced for a member the church has not cleared for children\'s check-in');
});

test('losing a check-in clearance while ON the Kids tab moves the worker somewhere real', () => {
  assert.deepEqual(runFallback({ tab: 'kids', careOn: true, canSeeRota: true }), ['serving'],
    'a worker whose clearance was withdrawn is left on a tab that no longer exists — the pane renders ' +
    'nothing at all and no tab is selected, which is the silent-blank class this file exists for');
});

test('a worker still cleared is left on the Kids tab', () => {
  assert.deepEqual(runFallback({ tab: 'kids', careOn: true, canSeeRota: true,
    checkinRegister: { cleared: true, notYet: false, keysHeld: 1 } }), [],
    'a worker reading the register was thrown off it for no reason — mid-session, at the door');
});

test('the fallback target is always a tab that actually exists', () => {
  // 'serving' happens to be first today. Assert the PROPERTY, not the value, so reordering the tabs later
  // cannot quietly send members to a tab that is switched off.
  const out = runFallback({ tab: 'care', careOn: false, canSeeRota: false });
  assert.equal(out.length, 1);
  assert.ok(['serving', 'events', 'calendar'].includes(out[0]),
    `fell back to "${out[0]}", which is not among the tabs available in that configuration`);
});
