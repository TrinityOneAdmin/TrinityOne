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

// The effect's own body, so assertions read what actually RUNS rather than what merely appears in the file.
function healBody() {
  const marker = 'if (!activeChurch || churches.find(c => c.id === activeChurch)) return;';
  const at = APP.indexOf(marker);
  assert.notEqual(at, -1, 'the self-heal guard is gone — a stale active church would silently blank every church feature again');
  const start = APP.lastIndexOf('useAE(() => {', at);
  assert.notEqual(start, -1, 'the guard is no longer inside an effect');
  const end = APP.indexOf('\n  }, [', start);
  assert.notEqual(end, -1);
  const depsEnd = APP.indexOf(');', end);
  return { body: APP.slice(start, end), deps: APP.slice(end, depsEnd + 2), guardAt: at, start };
}

test('the effect cannot be short-circuited before it heals', () => {
  // The previous version asserted the guard LINE existed. Inserting `if (true) return;` directly above it left
  // every regex satisfied while the effect did nothing at all — the silent-blank bug, fully restored, green suite.
  const { body, guardAt, start } = healBody();
  const before = APP.slice(start + 'useAE(() => {'.length, guardAt);
  assert.doesNotMatch(before, /\breturn\b/,
    'something returns BEFORE the heal guard — the effect would be inert while still matching every structural check');
  assert.match(body, /setActiveChurch\(next\);/, 'the effect must actually re-point the active church');
  assert.match(body, /lsSet\('trinityone\.activeChurch', next\);/, 'and persist it, or it re-heals on every launch');
});

test('the effect re-runs when the church list arrives', () => {
  // `churches` is populated asynchronously. With an empty dep array the heal fires once on mount — before the
  // followed churches load — and then never again, which is exactly the situation it exists to repair.
  const { deps } = healBody();
  assert.match(deps, /\[activeChurch, churches\]/,
    'the heal must depend on BOTH the active church and the church list, or it runs too early and never again');
});

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
  // An exact count, not a floor: the old `>= 4` passed while 26 of the 30 real sites could have been rewritten.
  const sites = [...APP.matchAll(/churches\.find\((\w+) => \1\.id === activeChurch\)/g)];
  // 30 → 32 on 2026-08-04: ctx.joinQueued and ctx.retryConnection both resolve the active church to answer
  // "is this member's join announce still queued?" and to RE-ANNOUNCE on "Check again". Both are ordinary
  // active-church reads and benefit from the same heal as the rest.
  // 32 → 33 on 2026-08-05: ctx.joinFailed, the third state of the same question ("did we give up on it?").
  // Identical shape to joinQueued directly above it, so it benefits from the heal for the same reason.
  assert.equal(sites.length, 33,
    `the active-church resolution sites changed (${sites.length} vs 33) — if that is deliberate, confirm each new one benefits from the heal, then update this count`);
});
