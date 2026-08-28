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

function runFallback({ tab, careOn, canSeeRota }) {
  const a = SRC.indexOf('  const _tabs = [');
  assert.ok(a >= 0, 're-anchor: the tab list is no longer hoisted, so nothing can check it against the active tab');
  const b = SRC.indexOf('}, [_tabKeys, tab]);', a);
  assert.ok(b > a, 're-anchor: the fallback effect has moved');
  const body = SRC.slice(a, b + '}, [_tabKeys, tab]);'.length);
  const calls = [];
  // React.useEffect runs its callback immediately here — we only care what the callback decides.
  const React = { useEffect: (fn) => fn() };
  new Function('React', 'canSeeRota', 'careOn', 'tab', 'setTab', body)(
    React, canSeeRota, careOn, tab, (t) => calls.push(t));
  return calls;
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

test('the fallback target is always a tab that actually exists', () => {
  // 'serving' happens to be first today. Assert the PROPERTY, not the value, so reordering the tabs later
  // cannot quietly send members to a tab that is switched off.
  const out = runFallback({ tab: 'care', careOn: false, canSeeRota: false });
  assert.equal(out.length, 1);
  assert.ok(['serving', 'events', 'calendar'].includes(out[0]),
    `fell back to "${out[0]}", which is not among the tabs available in that configuration`);
});
