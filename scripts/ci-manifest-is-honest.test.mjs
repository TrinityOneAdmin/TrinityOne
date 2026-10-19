// THE CI MANIFEST'S OWN HONESTY GUARD.
//
// `scripts/ci-safe-tests.txt` is the list of safety-critical tests the GitHub release gate runs (see that
// file's header and test.yml). This test is ITSELF on that list, so it runs in CI — which makes it the thing
// that stops the gate being quietly hollowed out. The whole point of a release gate is defeated if the list
// it runs can drop to nothing and still go green ("green having run nothing" — the exact trap run-tests.mjs
// documents for an empty file list, and CLAUDE.md §8 for a silent test deletion). A NAMED file list bypasses
// run-tests.mjs's own count floor (that floor only applies to a full-suite run), so the floor has to live
// here instead.
//
// This test deliberately fails if:
//   * a listed file no longer exists (a rename/move/delete that would silently drop coverage);
//   * the list shrinks below a floor (bulk gutting);
//   * any of the NON-NEGOTIABLE invariants is missing from the list;
//   * the list has duplicate entries (a copy-paste slip that inflates the count).
// Any of these is a deliberate red: account for the change, then update this guard in the same commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
const manifestPath = fileURLToPath(new URL('./ci-safe-tests.txt', import.meta.url));

// Parse: one test-file name per line, relative to scripts/. '#' starts a comment; blank lines ignored.
function readManifest() {
  const raw = readFileSync(manifestPath, 'utf8');
  return raw.split('\n')
    .map(l => l.replace(/#.*$/, '').trim())
    .filter(Boolean);
}

// The floor is below the current real count (25) with headroom for a few legitimate removals, but well
// above a trivially-gutted list. Lower it ONLY alongside a reason in the manifest.
const FLOOR = 20;

// The invariants this gate exists to protect (test.yml header). Removing any of these from CI is never an
// accident — if one legitimately moves, rename it here in the same commit.
const CORE = [
  'relay-privacy.test.mjs',                       // the anonymous read gate
  'name-privacy.test.mjs',                        // names never leak to an anonymous reader
  'reads-only-reach-admitted-relays.test.mjs',    // reads don't fan out to unadmitted relays
  'dm-crypto.test.mjs',                           // DM sealing
  'recovery.test.mjs',                            // guardian (Shamir) recovery math
  'finance-ledger.test.mjs',                      // ledger integrity
  'vendor-freshness.test.mjs',                    // shipped bundle == source
  'an-adults-only-rooms-name-is-not-served-to-a-child.test.mjs', // child safety (CLAUDE.md §1 names this)
  'a-blocked-reader-gets-nothing-private.test.mjs',              // blocking — the owner's #1 open bug
];

test('every file in the CI manifest exists', () => {
  const entries = readManifest();
  const missing = entries.filter(f => !existsSync(scriptsDir + f));
  assert.deepEqual(missing, [], 'CI manifest names test files that do not exist: ' + missing.join(', '));
});

test('the CI manifest has not been gutted below the floor', () => {
  const entries = readManifest();
  assert.ok(entries.length >= FLOOR,
    `CI manifest has ${entries.length} tests, floor is ${FLOOR}. If a removal is intended, lower the floor WITH a reason (CLAUDE.md §8).`);
});

test('the CI manifest still runs every non-negotiable invariant', () => {
  const entries = new Set(readManifest());
  const absent = CORE.filter(f => !entries.has(f));
  assert.deepEqual(absent, [], 'CI manifest no longer runs core safety invariant(s): ' + absent.join(', '));
});

test('this test is itself in the manifest, so CI runs this guard', () => {
  const entries = new Set(readManifest());
  assert.ok(entries.has('ci-manifest-is-honest.test.mjs'),
    'the honesty guard must list itself, or CI stops running it and the whole guard is inert');
});

test('the CI manifest has no duplicate entries', () => {
  const entries = readManifest();
  const seen = new Set(), dupes = new Set();
  for (const e of entries) { if (seen.has(e)) dupes.add(e); seen.add(e); }
  assert.deepEqual([...dupes], [], 'CI manifest lists the same file twice: ' + [...dupes].join(', '));
});
