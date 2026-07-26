// The member count must not include people who were blocked or are still queuing.
// Run: node --test scripts/member-count.test.mjs
//
// Reported 2026-07-26: a church with a handful of real members read "26 members", and every group's
// "who can see this" said the same. `subscribeMembers` returns every member doc the relay has ever served,
// which includes BLOCKED people and people still waiting for approval. The Members tab already filtered both
// when listing them; the Overview stat and the group subtitles did not.
//
// This executes the real rule out of app/stew-dashboard.jsx rather than restating it, because the subtle part
// is the rosterLoaded guard: on a hard reload the admitted/blocked sets are briefly empty, and a naive filter
// would report every member in the church as pending for a moment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

// Lift the filter expression out of useRealMemberCount and run it against synthetic rosters.
function realRule() {
  const at = DASH.indexOf('function useRealMemberCount()');
  assert.notEqual(at, -1, 'useRealMemberCount is gone — the count rule has no single home again');
  const m = DASH.slice(at, at + 1400).match(/return members\.filter\(m =>([\s\S]*?)\)\.length;/);
  assert.ok(m, 'could not find the filter expression');
  return new Function('members', 'blockedSet', 'admittedSet', 'joinApproval', 'rosterLoaded',
    `return members.filter(m => ${m[1]}).length;`);
}
const count = realRule();
const M = (...pks) => pks.map(p => ({ pubkey: p }));

test('blocked members are never counted', () => {
  const n = count(M('a', 'b', 'blocked1'), new Set(['blocked1']), new Set(['a', 'b', 'blocked1']), true, true);
  assert.equal(n, 2, 'a blocked person is still being counted as a member');
});

test('people still waiting for approval are not counted', () => {
  const n = count(M('a', 'b', 'waiting'), new Set(), new Set(['a', 'b']), true, true);
  assert.equal(n, 2, 'someone who has requested but not been approved is being counted as a member');
});

test('with approval OFF, everyone who joined counts (there is no queue)', () => {
  const n = count(M('a', 'b', 'c'), new Set(), new Set(), false, true);
  assert.equal(n, 3, 'with approval off nobody is pending, so all members count');
});

test('before the rosters arrive, nobody is assumed pending', () => {
  // The dangerous direction: on a hard reload admitted/blocked are empty for a moment. Treating everyone as
  // pending would flash "— members" at a church that has plenty, and the Overview would look broken.
  const n = count(M('a', 'b', 'c'), new Set(), new Set(), true, false);
  assert.equal(n, 3, 'the count must not collapse while the rosters are still loading');
});

test('blocked wins over admitted', () => {
  // Someone approved and later blocked is still blocked.
  const n = count(M('a', 'gone'), new Set(['gone']), new Set(['a', 'gone']), true, true);
  assert.equal(n, 1);
});

test('the Overview stat and the group subtitles both use the shared rule', () => {
  assert.match(DASH, /value=\{realCount \? String\(realCount\) : '—'\}/, 'the Members stat is not using the shared count');
  const uses = (DASH.match(/groupLiveSub\(g, realCount, rosters\)/g) || []).length;
  assert.equal(uses, 2, `expected both groupLiveSub call sites to use the real count, found ${uses}`);
  assert.doesNotMatch(DASH, /groupLiveSub\(g, members\.length/, 'a group subtitle still counts blocked/pending people');
});

test('the pending-requests list is bounded so it cannot push the page away', () => {
  // With a queue of requests the panel grew without limit and shoved the members list, the safeguarding note
  // and everything below it off-screen. The rows scroll inside the panel now.
  const at = DASH.indexOf('Requests to join · {pendingJoins.length}');
  assert.notEqual(at, -1, 'the requests panel is gone');
  const block = DASH.slice(at, at + 900);
  assert.match(block, /maxHeight: 268, overflowY: 'auto'/, 'the requests list is unbounded again');
});
