// A dangling active church must heal itself.
// Run: node --test scripts/active-church-heal.test.mjs
//
// Found on the test phone 2026-07-25, by accident, while verifying something else. Every church subscription
// resolves the active church with `churches.find(c => c.id === activeChurch)` and passes `.npub` on to
// Fellowship.setChurch(). When that find() misses, it passed null — so the app subscribed to NOTHING while the
// header still rendered a church name and every list (groups, care needs, care requests) sat empty. No error,
// no warning, nothing in the log: an app that looks completely normal and is completely blank, permanently.
//
// leaveChurch() re-points the id on the in-app path, but nothing repaired a stored id that went stale by any
// other route — a restored backup, a church dropped from the list, hand-edited storage — and it never
// recovered on its own.
//
// The behaviour itself was verified on hardware, on a phone genuinely in the broken state: before the fix all
// three subscriptions read 0; after it, the app corrected the stored id on launch and read 9 needs / 11 groups
// / 2 care requests. app/*.jsx are classic scripts loaded straight into the page, so there is no bundle for a
// test to drive — what this file guards is that the reconciliation is still THERE and still correct in shape,
// because the failure it prevents is silent and would not show up in any other test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');

test('the reconciliation effect is present', () => {
  assert.match(APP, /if \(!activeChurch \|\| churches\.find\(c => c\.id === activeChurch\)\) return;/,
    'the self-heal guard is gone — a stale active church would silently blank every church feature again');
  assert.match(APP, /setActiveChurch\(next\); lsSet\('trinityone\.activeChurch', next\);/,
    'the fallback must persist, or the app re-heals on every launch and never settles');
});

test('it prefers a real followed church, and cannot loop', () => {
  const at = APP.indexOf('if (!activeChurch || churches.find(c => c.id === activeChurch)) return;');
  assert.notEqual(at, -1);
  const block = APP.slice(at, at + 700);
  assert.match(block, /churches\.find\(c => c\.npub\)/,
    'the fallback must prefer a church with a real npub — a sample/demo church cannot be subscribed to');
  assert.match(block, /if \(next === activeChurch\) return;/,
    'without this guard the effect re-fires on its own state change and spins');
});

test('every activeChurch resolution still funnels through the same find()', () => {
  // If a new call site resolves the active church differently, it would not benefit from the heal above and
  // could reintroduce the silent-blank path on its own.
  const sites = [...APP.matchAll(/churches\.find\((\w+) => \1\.id === activeChurch\)/g)];
  assert.ok(sites.length >= 4, `expected the known resolution sites, found ${sites.length}`);
});
