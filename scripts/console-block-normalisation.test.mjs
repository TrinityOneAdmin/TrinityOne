// Blocking a member must exclude them from every re-key, whatever case their pubkey is written in.
// Run: node --test scripts/console-block-normalisation.test.mjs
//
// ARCHITECTURE-AUDIT-2026-07-30 A3. `scripts/trinity-rules.mjs` exists because two copies of photo
// suppression disagreed about pubkey normalisation, and `scripts/shared-rules.test.mjs` pinned that fix — but
// its scope is three files (the two engines and the shared module) and it never reads app/. The console's
// members SCREEN builds its own membership sets straight from the raw lists, and `blockedSet` was built four
// separate times in app/stew-dashboard.jsx from the same source list, with only one of the four normalising.
//
// The two that mattered sat in the same function — block(), which removes a member and rotates every
// encrypted-group key away from them:
//
//     ~3353   !blockedSet.has(p)                             raw set, RAW key
//     ~3381   !blockedSet.has(String(p||'').toLowerCase())   raw set, LOWER-CASED key
//
// Whatever the intended rule was, those express different ones. The second feeds `recips` for
// publishGroupKey({rotate:true}), so a blocked member the lookup missed would have been handed the FRESHLY
// ROTATED key to the group they had just been removed from — the exact outcome the comment above it exists to
// prevent ("a blocked person's phone carried on decrypting every future message in every encrypted group —
// forever", AUDIT-2026-07-27).
//
// It was not reachable when found: every writer passes a roster pubkey, which comes from a signature-verified
// relay event and is lower-case hex, and there is no npub→hex conversion in that file. The photo-suppression
// bug was equally unreachable until a second way in was added, which is the whole reason this is guarded
// rather than left as a comment.
//
// This DRIVES THE SHIPPED LINES rather than describing them: the set builder and the lookup are lifted out of
// app/stew-dashboard.jsx by anchored regex and executed. Reverting either one to its raw form turns the
// behavioural tests red, not just the textual ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

// Lift the two real lines. Anchored on their names, not on line numbers — AUDIT-2026-07-28 F15 was eight
// fixed-width test windows that silently stopped covering the code they sliced.
function liftPredicate() {
  const setLine = SRC.match(/^\s*const blockedSet = new Set\(\(blockedList.*$/m);
  const fnLine = SRC.match(/^\s*const isBlocked = .*$/m);
  assert.ok(setLine, 'could not find the normalising `const blockedSet = new Set((blockedList …` line in ' +
    'app/stew-dashboard.jsx — either it was reverted to a raw `new Set(blockedList)`, or it was renamed and ' +
    'this guard is now measuring nothing');
  assert.ok(fnLine, 'could not find the `const isBlocked = …` lookup helper — if the call sites went back to ' +
    'querying blockedSet directly, the two readers can disagree again');
  // eslint-disable-next-line no-new-func
  return new Function('blockedList', `${setLine[0]}\n${fnLine[0]}\nreturn isBlocked;`);
}

const UPPER = 'AB'.repeat(32);            // 64 hex chars, upper case
const LOWER = UPPER.toLowerCase();
const OTHER = 'cd'.repeat(32);

test('CONTROL: the lifted predicate blocks an exactly-matching key', () => {
  // If this fails the extraction is wrong and every assertion below would pass or fail for the wrong reason.
  const isBlocked = liftPredicate()([LOWER]);
  assert.equal(isBlocked(LOWER), true, 'the lifted predicate does not block an exact match — the TEST is broken');
  assert.equal(isBlocked(OTHER), false, 'the lifted predicate blocks someone who was never on the list');
});

test('a blocked member is still blocked when the LIST holds their key in upper case', () => {
  const isBlocked = liftPredicate()([UPPER]);
  assert.equal(isBlocked(LOWER), true,
    'a blocked member was not recognised because the blocklist spelled their key differently. In block() this ' +
    'feeds `recips` for publishGroupKey({rotate:true}) — so they would receive the freshly rotated key to the ' +
    'encrypted group they were just removed from.');
});

test('a blocked member is still blocked when the LOOKUP is given upper case', () => {
  const isBlocked = liftPredicate()([LOWER]);
  assert.equal(isBlocked(UPPER), true, 'the lookup side is not normalised, so the two readers can still disagree');
});

test('normalising did not make it block people it should not', () => {
  // The other half: over-normalising that swallowed everything would pass every test above and quietly
  // exclude the whole congregation from each re-key.
  const isBlocked = liftPredicate()([UPPER]);
  assert.equal(isBlocked(OTHER), false, 'an unrelated member is now treated as blocked — every re-key would drop them');
  assert.equal(isBlocked(''), false, 'an empty pubkey counts as blocked');
  assert.equal(isBlocked(null), false, 'a null pubkey counts as blocked');
  assert.equal(liftPredicate()([])(LOWER), false, 'nobody is on the list and a member is still blocked');
});

// ── and the call sites must actually route through it ────────────────────────────────────────────────────
// A normalising helper nobody calls is worse than none, because it reads as agreement. Same reasoning as
// shared-rules.test.mjs's "both engines must actually GO THROUGH it".
test('the block-and-rotate path uses the helper, not its own lookup', () => {
  const block = SRC.slice(SRC.indexOf('const block = (pk) =>'));
  const body = block.slice(0, block.indexOf('\n  };'));
  assert.ok(body.length > 200 && body.includes('publishGroupKey'),
    'could not isolate block() — this guard is not reading the function it claims to');
  assert.doesNotMatch(body, /blockedSet\.has\(/,
    'block() queries blockedSet directly again. That is how its two lookups came to disagree: one raw, one ' +
    'hand-lower-cased, four lines apart. Go through isBlocked() so there is one spelling of the rule.');
  assert.match(body, /!isBlocked\(p\)/, 'block() no longer excludes blocked members via the shared helper');
});

test('the members screen has no raw pubkey Set left for the blocklist', () => {
  // Scoped to the blocklist deliberately. minors/approved/nophoto/admitted are still built raw in this file
  // and are recorded as latent in the audit — they are display-only here, and the relay normalises the
  // enforcing copies via toHexPub. Widening this to them is a separate, deliberate step.
  const raw = SRC.match(/const blockedSet = new Set\(blockedList\)/g) || [];
  assert.deepEqual(raw, [],
    'a raw `new Set(blockedList)` is back in the members screen — the set must normalise on the way in, which ' +
    'is also the fail-safe direction for a block');
});
