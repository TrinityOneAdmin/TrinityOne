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
// the source), so deleting one fails the suite. Verified to bite: removing any single guard turns this red.
//
// WHAT IT STILL CANNOT DO, AND WHO DOES IT INSTEAD (audit 2026-09-18). A structural rule reads the guard;
// it does not run it. This file passed 11/0 with subscribeAdmitted's guard DEAD — one token changed in the
// bundle (`byAuthor.get(e.pubkey)` → `byAuthor.get(e.id)`) makes `prev` permanently undefined, so nothing
// is ever skipped, and every word the rules below look for is still on the page. The rule that now catches
// that particular shape was added the same day (the clock must be read under the key it is written under),
// but the lesson stands: only running the handler can prove a comparison DOES anything.
// subscribeAdmitted is the one handler that IS driven for real, in
// scripts/approved-members-survive-a-steward-leaving.test.mjs — including an older document arriving from
// the SAME author after a newer one, which is the only arrangement that distinguishes a live guard from a
// dead one. The other five handlers here have no such test. Do not read this file's green as behaviour.
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
  // `if (e.created_at < 0)` would satisfy a naive presence check while never skipping anything. So for every
  // guard found, the thing it compares against must be FED from an event's created_at inside the same handler.
  //
  // TWO SHAPES, because there are two (both correct). The one-clock handlers keep a bare variable
  // (`latest = e.created_at`). subscribeAdmitted keeps a clock PER AUTHOR — b24f8c1, because the approved
  // list is a SET and two stewards approving different people a minute apart were losing one of them — so
  // its guard reads `e.created_at < prev.at` and the timestamp is written as an object FIELD inside a Map
  // entry (`byAuthor.set(e.pubkey, { at: e.created_at, … })`). The bare-variable rule cannot see that, and
  // when it was the only rule this assertion THREW on the second handler, which silently stopped the other
  // four — steward roster, guardian map, join policy, safeguard bundle — from ever being checked at all.
  //
  // Hence: findings are COLLECTED and reported together rather than thrown one at a time, so one bad handler
  // can never again hide the rest; and `checked` proves the scan was not vacuous — a regex that matched
  // nothing here would look green for ever.
  const problems = [];
  for (const name of Object.keys(REPLACEABLE_DOCS)) {
    const body = handlerBody(name);
    let checked = 0;
    for (const m of body.matchAll(/created_at\s*<\s*([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/g)) {
      const [, varName, field] = m;
      checked++;
      if (field) {
        // per-author clock: the field must be written from an event's created_at in this handler, either as
        // an object literal (`at: e.created_at`) or by assignment (`prev.at = e.created_at`).
        const fed = new RegExp('\\b' + field + '\\s*:\\s*[A-Za-z_$][\\w$]*\\.created_at')
          .test(body)
          || new RegExp('\\.' + field + '\\s*=\\s*[A-Za-z_$][\\w$]*\\.created_at').test(body);
        if (!fed) problems.push(
          `${name}: guard compares against '${varName}.${field}', but nothing in the handler ever writes ` +
          `'${field}' from an event's created_at — so it can never skip a stale copy.`);
        // …AND THE THING COMPARED MUST BE THE THING WRITTEN. Audit 2026-09-18: changing ONE token in the
        // bundle, `byAuthor.get(e.pubkey)` → `byAuthor.get(e.id)`, leaves every rule above satisfied while
        // `prev` is permanently undefined, so `e.created_at < prev.at` is never true and the guard is dead.
        // A per-author clock is only a clock if the entry is looked up under the SAME key it is stored
        // under; read it under anything else and every event looks like the first one from a new author.
        const from = new RegExp('\\b' + varName + '\\s*=\\s*([A-Za-z_$][\\w$]*)\\.get\\(((?:[^()]|\\([^()]*\\))*)\\)').exec(body);
        if (!from) problems.push(
          `${name}: guard compares against '${varName}.${field}', but '${varName}' is not read out of a map ` +
          `at all. Either the per-author clock has changed shape — re-anchor this rule — or the lookup has ` +
          `gone and the guard compares against something that can never hold a previous timestamp.`);
        else {
          const [, mapName, key] = from;
          const wrote = new RegExp('\\b' + mapName + '\\.set\\(\\s*' + key.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*,')
            .test(body);
          if (!wrote) problems.push(
            `${name}: the clock is READ as '${mapName}.get(${key.trim()})' but never WRITTEN under that same ` +
            `key — so the lookup always misses, '${varName}' is always undefined, and no stale copy is ever ` +
            `skipped. (This is the exact 2026-09-18 one-token sabotage; the behavioural proof is ` +
            `scripts/approved-members-survive-a-steward-leaving.test.mjs.)`);
        }
      } else {
        const fed = new RegExp('\\b' + varName + '\\s*=\\s*[A-Za-z_$][\\w$]*\\.created_at').test(body);
        if (!fed) problems.push(
          `${name}: guard compares against '${varName}', but nothing ever assigns it from an event's ` +
          `created_at — so it can never skip a stale copy.`);
      }
    }
    if (checked === 0) problems.push(
      `${name}: no created_at comparison was examined at all. Either the guard is gone, or it is written in ` +
      `a shape this test cannot see — and an unseen guard is an unchecked one.`);
  }
  assert.deepEqual(problems, [], '\n' + problems.join('\n'));
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
