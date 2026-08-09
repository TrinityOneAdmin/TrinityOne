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
  subscribeSafeguard: 4,    // minors + approved + nophoto + guardians ride one subscription, so FOUR
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

// AUTHOR DISCIPLINE (Fable audit 2026-07-22, HIGH). The `#church` subscription filter matches ANY author,
// so these church-signed authority docs must verify the signer — otherwise a forged copy on a non-enforcing
// relay is accepted as truth, and (with newest-wins) a FUTURE-dated forgery pins over the real doc forever.
// The correct signer per doc must mirror the relay's accept() exactly, so the wrong guard is as bad as none.
const OWNER_ONLY = ['subscribeBlocked', 'subscribeStewards', 'subscribeGuardians'];       // church key only
const STEWARD_WRITABLE = ['subscribeJoinPolicy', 'subscribeAdmitted'];                     // church OR a rostered steward
// subscribeSafeguard carries all four: minors/approved/guardians owner-only, nophoto steward-writable.
// Guardians joined it 2026-08-09 — it used to have its own subscription with byte-identical filters,
// which meant `loaded` could say nothing about whether the parent-link map had arrived, and the
// clearance back-fill guessed. Guessing emptied children's guardian lists.

test('every authority handler drops future-dated events (no forgery can pin)', () => {
  for (const name of Object.keys(REPLACEABLE_DOCS)) {
    assert.match(handlerBody(name), /_authFuture\(e\)/,
      `${name} has no future-timestamp clamp — a forgery dated far ahead can never be beaten on created_at ` +
      `and pins over the church's real doc for the life of the subscription.`);
  }
});

test('owner-only docs require the church key; steward-writable also accept a rostered steward', () => {
  for (const name of OWNER_ONLY) {
    const b = handlerBody(name);
    assert.match(b, /_byChurch\(e\)/, `${name} is owner-only but does not check the author is the church key`);
    assert.doesNotMatch(b, /_byChurchOrSteward\(e\)/, `${name} is owner-only but accepts steward authors — wider than the relay allows`);
  }
  for (const name of STEWARD_WRITABLE) {
    assert.match(handlerBody(name), /_byChurchOrSteward\(e\)/, `${name} is steward-writable but does not accept a rostered steward — it would drop legitimate delegated writes`);
  }
  // safeguard: minors+approved gated by _byChurch, nophoto by _byChurchOrSteward
  const sg = handlerBody('subscribeSafeguard');
  assert.equal((sg.match(/_byChurch\(e\)/g) || []).length, 3,
    'safeguard: minors + approved + guardians must each require the church key — a steward able to write ' +
    'the guardian map could name themselves a child\'s parent');
  assert.match(sg, /_byChurchOrSteward\(e\)/, 'safeguard: nophoto is steward-writable and must accept a rostered steward');
});

test('the author helpers actually compare pubkeys — not stubs', () => {
  assert.match(BUNDLE, /_byChurch\s*=\s*\(e\)\s*=>\s*e\.pubkey\s*===\s*pub/, '_byChurch must compare e.pubkey to the church key');
  assert.match(BUNDLE, /_byChurchOrSteward\s*=\s*\(e\)\s*=>\s*e\.pubkey\s*===\s*pub\s*\|\|\s*_careRoster\.has\(e\.pubkey\)/, '_byChurchOrSteward must accept the church key or a rostered steward');
  assert.match(BUNDLE, /_authFuture\s*=\s*\(e\)\s*=>\s*e\.created_at\s*>\s*now\(\)\s*\+/, '_authFuture must reject events dated beyond now + skew');
});

// CARE-KEY MINT RACE (Fable audit 2026-07-22, #2). subscribeCareKey used to DROP an envelope whose author
// wasn't yet in the (asynchronously-loaded) steward roster, then ensureCareKeyForMembers minted a fresh key
// over it — two competing care keys, every sealed need orphaned. The fix buffers unverifiable envelopes,
// blocks the mint while one is pending, and re-checks when the roster loads. Structural, over the shipped bundle.
test('care-key mint gate buffers unverified envelopes and refuses to mint while one is pending', () => {
  const sub = handlerBody('subscribeCareKey');
  assert.match(sub, /_careKeyPending\.push/, 'an author-unverified envelope must be BUFFERED, not dropped');
  assert.doesNotMatch(sub, /if \(e\.pubkey !== cp && !_careRoster\.has\(e\.pubkey\)\) return;/, 'the old silent-drop must be gone');
  const mint = handlerBody('ensureCareKeyForMembers');
  assert.match(mint, /_reCheckCareKeyPending\(\)/, 'the mint gate must re-check buffered envelopes before minting');
  assert.match(mint, /if \(_careKeyPending\.length\) return false/, 'the mint gate must refuse to mint while an envelope is pending');
  assert.match(BUNDLE, /setCareRoster\([^)]*\)\s*\{[^}]*_reCheckCareKeyPending\(\)/, 'setCareRoster must re-check the buffer when the roster changes');
});
