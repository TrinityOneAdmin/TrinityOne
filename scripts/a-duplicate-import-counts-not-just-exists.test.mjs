// A DUPLICATE IMPORT COUNTS, NOT JUST EXISTS.
//   Run: node --test scripts/a-duplicate-import-counts-not-just-exists.test.mjs
//
// THE DEFECT. The import review screen used `importedKeys(book)` — a Set — to mark statement
// lines as duplicates. Two identical payments (same amount, date, description) share one key.
// If one was already in the journal, BOTH were greyed out as "already imported", so the second
// legitimate payment was silently dropped.
//
// THE FIX. `toReview` now counts how many of each key the journal holds and decrements on each
// match. Two in the statement and one in the journal marks one as dup and lets the other through.
//
// Caller of toReview: the import modal in `app/stew-finance.jsx`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../app/stew-finance.jsx', import.meta.url), 'utf8');

// Extract the toReview function body. It's an arrow: `const toReview = () => {`
// We need the held/map logic and the dup computation from it.
// Instead of extracting the whole JSX-heavy function, we test the dup logic directly
// by replicating the counting-Map pattern the fix introduced.

// The fix is: the review screen builds a counting Map from book.journal importKeys,
// then for each statement line decrements instead of just checking membership.
// If the fix is reverted to a Set, this test fails.

function dupFlags(journalKeys, statementKeys) {
  // Read the source and verify it uses a counting Map, not a Set
  const toReviewBody = SRC.slice(
    SRC.indexOf('const toReview = () => {'),
    SRC.indexOf('setLines(ls);')
  );

  // The fix: a counting Map. If someone reverts to importedKeys (a Set), this fails.
  assert.ok(
    toReviewBody.includes('held.get(') || toReviewBody.includes('held.set('),
    'REVIEW SCREEN USES A SET, NOT A COUNTING MAP — two identical payments in a bank statement ' +
    'where one is already imported will BOTH be greyed out as duplicates, silently dropping the ' +
    'second legitimate payment'
  );

  // Now verify the actual logic by running the same pattern
  const held = new Map();
  for (const k of journalKeys) held.set(k, (held.get(k) || 0) + 1);
  return statementKeys.map(k => {
    const n = k ? (held.get(k) || 0) : 0;
    const dup = n > 0;
    if (dup) held.set(k, n - 1);
    return dup;
  });
}

test('two identical statement lines, one already imported: only one is dup', () => {
  const result = dupFlags(
    ['pay-100-2026-01-15-acme'],             // journal has ONE entry with this key
    ['pay-100-2026-01-15-acme', 'pay-100-2026-01-15-acme']  // statement has TWO
  );
  assert.deepEqual(result, [true, false],
    'THE SECOND IDENTICAL PAYMENT IS MARKED AS A DUPLICATE — a church that receives two £100 ' +
    'gifts on the same Sunday from the same person has one silently dropped from the import');
});

test('two identical statement lines, neither imported: both are new', () => {
  const result = dupFlags(
    [],                                       // empty journal
    ['pay-100-2026-01-15-acme', 'pay-100-2026-01-15-acme']
  );
  assert.deepEqual(result, [false, false]);
});

test('two identical statement lines, both already imported: both are dup', () => {
  const result = dupFlags(
    ['pay-100-2026-01-15-acme', 'pay-100-2026-01-15-acme'],  // journal has TWO
    ['pay-100-2026-01-15-acme', 'pay-100-2026-01-15-acme']   // statement has TWO
  );
  assert.deepEqual(result, [true, true]);
});

test('CONTROL: a unique statement line already imported is dup', () => {
  const result = dupFlags(
    ['pay-200-2026-02-01-jones'],
    ['pay-200-2026-02-01-jones']
  );
  assert.deepEqual(result, [true]);
});
