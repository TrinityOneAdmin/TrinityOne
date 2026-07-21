// Replaceable church documents must resolve NEWEST-WINS, not last-to-arrive.
// Run: node --test scripts/steward-newest-wins.test.mjs
//
// Why this exists. The church's authority lists — blocklist, admitted members, steward roster, guardian
// links, join policy, safeguarding — are single replaceable kind-30078 documents, and the console reads
// them from EVERY relay at once. Each handler assigned its state from whichever copy arrived last. With
// two relays that is a race: if one is holding an older copy and answers second, the stale list wins and
// silently reverts the church's current state — reinstating a lifted block, dropping approved members back
// into "waiting to join", or restoring a steward whose access was revoked.
//
// What this test is, honestly: a STRUCTURAL guard, not a behavioural one. Driving the real handlers would
// need a fake relay socket underneath SimplePool; that is worth building, but this file does not do it. It
// asserts the ordering guard is present in the SHIPPED bundle (vendor/steward.js — what actually runs, not
// the source), so deleting one fails the suite. It cannot prove the comparison is correct, only that it is
// still there. Verified to bite: removing any single guard turns this red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

// name → how many independent documents that subscription resolves (one guard each)
const REPLACEABLE_DOCS = {
  subscribeBlocked: 1,      // who is banned — a stale copy reinstates a lifted block
  subscribeAdmitted: 1,     // who is approved — a stale copy un-approves members
  subscribeStewards: 1,     // delegated access; revocation is re-publishing without them
  subscribeGuardians: 1,    // child ↔ parent links
  subscribeJoinPolicy: 1,   // whether joining needs approval at all
  subscribeSafeguard: 3,    // minors + approved + nophoto ride one subscription, so THREE timestamps:
                            // one shared clock would let a fresh minors doc suppress a current approved doc
};

// The handler body, bounded by BRACE MATCHING rather than a fixed character window. A window is what the
// first version of this file used, and these methods sit ~20 lines apart in the bundle: the slice for
// subscribeAdmitted ran on into subscribeStewards and counted its guard too, failing a correct file.
function handlerBody(name) {
  const at = BUNDLE.indexOf(name + '(');
  assert.notEqual(at, -1, `${name} is missing from the shipped bundle`);
  const open = BUNDLE.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < BUNDLE.length; i++) {
    const c = BUNDLE[i];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return BUNDLE.slice(at, i + 1);
  }
  assert.fail(`could not find the end of ${name} in the bundle`);
}

for (const [name, docs] of Object.entries(REPLACEABLE_DOCS)) {
  test(`${name} resolves newest-wins (${docs} document${docs > 1 ? 's' : ''})`, () => {
    const body = handlerBody(name);
    const guards = (body.match(/created_at\s*<\s*[A-Za-z_$][\w$]*/g) || []).length;
    assert.equal(guards, docs,
      `${name} should compare created_at once per replaceable document (expected ${docs}, found ${guards}). ` +
      `Without it the copy that ARRIVES last wins instead of the one WRITTEN last, and a lagging relay ` +
      `silently reverts this church's state.`);
  });
}

test('the guard is a real comparison against a tracked timestamp, not a constant', () => {
  // `if (e.created_at < 0)` would satisfy a naive presence check while never skipping anything.
  for (const name of Object.keys(REPLACEABLE_DOCS)) {
    const body = handlerBody(name);
    for (const m of body.matchAll(/created_at\s*<\s*([A-Za-z_$][\w$]*)/g)) {
      const varName = m[1];
      assert.match(body, new RegExp(varName + '\\s*=\\s*\\w+\\.created_at'),
        `${name}: guard compares against '${varName}', but nothing ever assigns it from an event's created_at — ` +
        `so it can never skip a stale copy.`);
    }
  }
});
